import { NextResponse } from "next/server";
import {
  callGemini,
  friendlyGeminiError,
  geminiText,
  resolveModel,
} from "@/lib/server/gemini";
import { testRequestSchema } from "@/lib/validation";

export const maxDuration = 60;

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = testRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid test request." },
      { status: 400 },
    );
  }

  let model: string;
  try {
    model = resolveModel(parsed.data.model);
  } catch (error) {
    return NextResponse.json(
      { ok: false, model: parsed.data.model ?? null, message: friendlyGeminiError(error) },
      { status: 400 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      model,
      message:
        "No Gemini API key is configured. Add GEMINI_API_KEY to web/.env.local (or the Vercel project settings) and restart/redeploy.",
    });
  }

  const startedAt = Date.now();
  try {
    const response = await callGemini({
      model,
      apiKey,
      body: {
        contents: [{ role: "user", parts: [{ text: "Reply with exactly the word OK." }] }],
      },
      timeoutMs: 30_000,
    });
    const text = geminiText(response);
    if (!text) {
      return NextResponse.json({
        ok: false,
        model,
        message: "Gemini responded, but no text was returned.",
      });
    }
    return NextResponse.json({
      ok: true,
      model,
      latencyMs: Date.now() - startedAt,
      message: `Connected to ${model}. Gemini replied successfully.`,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      model,
      latencyMs: Date.now() - startedAt,
      message: friendlyGeminiError(error, model),
    });
  }
}
