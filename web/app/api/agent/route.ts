import { NextResponse } from "next/server";
import { AgentInputError, runAgent } from "@/lib/server/agent";
import { agentRequestSchema } from "@/lib/validation";

export const maxDuration = 60;

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = agentRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid agent request." },
      { status: 400 },
    );
  }

  try {
    const result = await runAgent({
      message: parsed.data.message,
      tasks: parsed.data.tasks,
      history: parsed.data.history,
      model: parsed.data.model,
      apiKey: process.env.GEMINI_API_KEY,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AgentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error:
          "The agent could not complete the request. The server did not expose any API key.",
      },
      { status: 500 },
    );
  }
}
