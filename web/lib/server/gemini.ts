export const DEFAULT_MODEL = "gemini-3.8-flash";
export const SUPPORTED_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
] as const;
export const MODEL_DOCS_URL = "https://ai.google.dev/gemini-api/docs/models";

const MODEL_NAME = /^gemini-[a-z0-9.-]{1,60}$/;

export type GeminiErrorKind =
  | "missing_key"
  | "auth"
  | "rate_limit"
  | "model"
  | "network"
  | "invalid_response"
  | "invalid_request"
  | "unavailable"
  | "unknown";

export class GeminiError extends Error {
  kind: GeminiErrorKind;
  status: number | null;

  constructor(kind: GeminiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "GeminiError";
    this.kind = kind;
    this.status = status;
  }
}

export interface GeminiPart {
  text?: string;
  functionCall?: {
    name?: string;
    args?: Record<string, unknown>;
    id?: string;
  };
  [key: string]: unknown;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiResponse {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: GeminiPart[];
    };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export function serverDefaultModel(): string {
  const configured = process.env.GEMINI_MODEL?.trim();
  return configured && MODEL_NAME.test(configured) ? configured : DEFAULT_MODEL;
}

export function supportedModels(): string[] {
  const configured = serverDefaultModel();
  return Array.from(new Set([configured, ...SUPPORTED_MODELS]));
}

export function resolveModel(requested?: string | null): string {
  const model = (requested?.trim() || serverDefaultModel()).trim();
  if (!MODEL_NAME.test(model)) {
    throw new GeminiError("invalid_request", "The selected model name is not valid.");
  }
  const allowed = supportedModels();
  if (!allowed.includes(model)) {
    throw new GeminiError(
      "invalid_request",
      `Unsupported model. Choose one of: ${allowed.join(", ")}.`,
    );
  }
  return model;
}

function redact(value: string, apiKey: string): string {
  if (!apiKey) return value;
  return value.split(apiKey).join("[redacted]");
}

function detailFromBody(body: string, apiKey: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return redact(parsed.error?.message ?? "", apiKey).slice(0, 240);
  } catch {
    return redact(body, apiKey).replace(/\s+/g, " ").trim().slice(0, 240);
  }
}

function errorForStatus(status: number, body: string, apiKey: string, model: string): GeminiError {
  if (status === 429) {
    return new GeminiError(
      "rate_limit",
      "Gemini rate limit reached (HTTP 429). Free-tier quotas are limited and not guaranteed. Wait a minute and try again, or check your quota in Google AI Studio.",
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new GeminiError(
      "auth",
      "Gemini rejected the API key or the project does not have access (HTTP 401/403). Check GEMINI_API_KEY in the server environment.",
      status,
    );
  }
  if (status === 404) {
    return new GeminiError(
      "model",
      `Gemini model '${model}' was not available for this key (HTTP 404). Set GEMINI_MODEL to a model available in your Google AI Studio project.`,
      status,
    );
  }
  if (status === 400) {
    const detail = detailFromBody(body, apiKey);
    return new GeminiError(
      "invalid_request",
      `Gemini rejected the request (HTTP 400)${detail ? `: ${detail}` : "."}`,
      status,
    );
  }
  if (status >= 500) {
    return new GeminiError(
      "unavailable",
      `Gemini is temporarily unavailable (HTTP ${status}). Try again shortly.`,
      status,
    );
  }
  const detail = detailFromBody(body, apiKey);
  return new GeminiError(
    "unknown",
    `Gemini request failed (HTTP ${status})${detail ? `: ${detail}` : "."}`,
    status,
  );
}

export async function callGemini(options: {
  model: string;
  body: unknown;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<GeminiResponse> {
  const { model, body, apiKey, fetchImpl = fetch, timeoutMs = 45_000 } = options;
  if (!apiKey.trim()) {
    throw new GeminiError(
      "missing_key",
      "No Gemini API key is configured. Add GEMINI_API_KEY to the server environment and reload.",
    );
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new GeminiError(
      "network",
      timedOut
        ? "The Gemini request timed out. Check your connection and try again."
        : "Could not reach the Gemini API. Check your internet connection and try again.",
    );
  }

  const raw = await response.text();
  if (!response.ok) {
    throw errorForStatus(response.status, raw, apiKey, model);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new GeminiError(
      "invalid_response",
      "Gemini returned a response that was not valid JSON.",
      response.status,
    );
  }
  if (!data || typeof data !== "object") {
    throw new GeminiError(
      "invalid_response",
      "Gemini returned an unexpected empty response.",
      response.status,
    );
  }
  return data as GeminiResponse;
}

export function geminiText(response: GeminiResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function geminiFunctionCalls(response: GeminiResponse): Array<{
  name: string;
  args: Record<string, unknown>;
  id?: string;
}> {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part.functionCall)
    .map((part) => ({
      name: part.functionCall?.name ?? "",
      args: part.functionCall?.args ?? {},
      id: part.functionCall?.id,
    }));
}

export function friendlyGeminiError(error: unknown, model?: string): string {
  if (error instanceof GeminiError) return error.message;
  if (error instanceof Error) {
    const message = error.message || error.name;
    return `Gemini request failed: ${message.slice(0, 240)}`;
  }
  return `Gemini request failed${model ? ` for ${model}` : ""}.`;
}
