import { connection, NextResponse } from "next/server";
import {
  MODEL_DOCS_URL,
  serverDefaultModel,
  supportedModels,
} from "@/lib/server/gemini";

export async function GET() {
  await connection();
  return NextResponse.json(
    {
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      provider: "Google Gemini",
      model: serverDefaultModel(),
      supportedModels: supportedModels(),
      docsUrl: MODEL_DOCS_URL,
      storage: "Browser localStorage (single browser, single user demonstration)",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
