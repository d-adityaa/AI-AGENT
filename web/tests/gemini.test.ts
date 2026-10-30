import { describe, expect, it, vi } from "vitest";
import {
  GeminiError,
  callGemini,
  friendlyGeminiError,
  resolveModel,
} from "@/lib/server/gemini";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Gemini request handling", () => {
  it("posts to the selected model with the server-only key header", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }),
    ) as unknown as typeof fetch;

    const data = await callGemini({
      model: "gemini-3.8-flash",
      apiKey: "server-secret-key",
      body: { contents: [] },
      fetchImpl,
    });

    expect(data.candidates?.[0].content?.parts?.[0].text).toBe("OK");
    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "server-secret-key",
    );
  });

  it("reports rate limits honestly", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "quota exceeded" } }, 429),
    ) as unknown as typeof fetch;

    await expect(
      callGemini({
        model: "gemini-3.8-flash",
        apiKey: "key",
        body: {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "GeminiError",
      kind: "rate_limit",
    });

    try {
      await callGemini({
        model: "gemini-3.8-flash",
        apiKey: "key",
        body: {},
        fetchImpl,
      });
    } catch (error) {
      expect(friendlyGeminiError(error)).toMatch(/rate limit/i);
    }
  });

  it("reports invalid keys with 401", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "API key not valid" } }, 401),
    ) as unknown as typeof fetch;

    await expect(
      callGemini({
        model: "gemini-3.8-flash",
        apiKey: "key",
        body: {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("reports unavailable models with 404", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "model not found" } }, 404),
    ) as unknown as typeof fetch;

    await expect(
      callGemini({
        model: "gemini-3.8-flash",
        apiKey: "key",
        body: {},
        fetchImpl,
      }),
    ).rejects.toThrow(/not available/i);
  });

  it("reports network failures without a fake answer", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;

    await expect(
      callGemini({
        model: "gemini-3.8-flash",
        apiKey: "key",
        body: {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: "network" });
  });

  it("rejects malformed JSON responses", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("not-json", { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(
      callGemini({
        model: "gemini-3.8-flash",
        apiKey: "key",
        body: {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("redacts the API key from provider error text", async () => {
    const key = "super-secret-api-key";
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: `bad request with ${key}` } }, 400),
    ) as unknown as typeof fetch;

    try {
      await callGemini({
        model: "gemini-3.8-flash",
        apiKey: key,
        body: {},
        fetchImpl,
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(GeminiError);
      expect((error as Error).message).not.toContain(key);
      expect((error as Error).message).toContain("[redacted]");
    }
  });

  it("requires a key before making a request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      callGemini({ model: "gemini-3.8-flash", apiKey: "", body: {}, fetchImpl }),
    ).rejects.toMatchObject({ kind: "missing_key" });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("validates the model against the supported allowlist", () => {
    expect(resolveModel("gemini-3.8-flash")).toBe("gemini-3.8-flash");
    expect(() => resolveModel("gpt-4o")).toThrow(/not valid|unsupported model/i);
    expect(() => resolveModel("gemini-../../bad")).toThrow(/not valid|unsupported/i);
  });
});
