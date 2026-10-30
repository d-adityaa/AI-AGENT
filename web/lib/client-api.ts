import type { AgentResponse, AgentStatus, Task } from "@/lib/types";

async function readJSON(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  if (data && typeof data === "object" && "message" in data) {
    const value = (data as { message?: unknown }).message;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export async function fetchAgentStatus(): Promise<AgentStatus> {
  const response = await fetch("/api/status", { cache: "no-store" });
  const data = await readJSON(response);
  if (!response.ok) {
    throw new Error(errorMessage(data, "Could not load the AI provider status."));
  }
  return data as AgentStatus;
}

export async function requestAgent(options: {
  message: string;
  tasks: Task[];
  model: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<AgentResponse> {
  let response: Response;
  try {
    response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "Could not reach the app server. Check that the Next.js server is running and try again.",
    );
  }
  const data = await readJSON(response);
  if (!response.ok) {
    throw new Error(errorMessage(data, "The agent request failed."));
  }
  if (!data || typeof data !== "object") {
    throw new Error("The agent returned an unexpected empty response.");
  }
  const parsed = data as Partial<AgentResponse>;
  return {
    mode: parsed.mode === "gemini" ? "gemini" : "fallback",
    message:
      typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message
        : "The agent returned no message.",
    warning: typeof parsed.warning === "string" ? parsed.warning : null,
    providerError:
      typeof parsed.providerError === "string" ? parsed.providerError : null,
    model: typeof parsed.model === "string" ? parsed.model : "unknown",
    proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    toolEvents: Array.isArray(parsed.toolEvents) ? parsed.toolEvents : [],
    plan: parsed.plan ?? null,
  };
}

export interface ConnectionTestResult {
  ok: boolean;
  model?: string | null;
  latencyMs?: number;
  message: string;
}

export async function testGeminiConnection(model: string): Promise<ConnectionTestResult> {
  let response: Response;
  try {
    response = await fetch("/api/agent/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      message:
        "Could not reach the app server. Check that the Next.js server is running and try again.",
    };
  }
  const data = (await readJSON(response)) as Partial<ConnectionTestResult> | null;
  if (!data || typeof data.message !== "string") {
    return { ok: false, message: "The connection test returned an unexpected response." };
  }
  return {
    ok: Boolean(data.ok),
    model: data.model ?? null,
    latencyMs: data.latencyMs,
    message: data.message,
  };
}
