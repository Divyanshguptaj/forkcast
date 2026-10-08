import { connection } from "next/server";
import { loadEnv } from "@/config/env";

export async function GET() {
  await connection();

  try {
    const env = loadEnv();
    return Response.json({
      ok: true,
      keys: {
        googlePlaces: Boolean(env.GOOGLE_PLACES_API_KEY),
        gemini: Boolean(env.GEMINI_API_KEY),
        tavily: Boolean(env.TAVILY_API_KEY),
      },
    });
  } catch {
    return Response.json({ ok: false, error: "Invalid configuration" }, { status: 500 });
  }
}
