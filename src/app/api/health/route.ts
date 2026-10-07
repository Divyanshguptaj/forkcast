import { connection } from "next/server";
import { loadEnv } from "@/config/env";
import { flagsFromEnv } from "@/config/flags";
import { FETCH_LIMITS, RUN_LIMITS } from "@/config/limits";

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
      flags: flagsFromEnv(env),
      models: { chain: env.GEMINI_MODEL_CHAIN, priceCheck: env.GEMINI_PRICE_CHECK_MODEL },
      limits: {
        geminiCallsExpected: RUN_LIMITS.geminiCallsExpected,
        geminiCallsCeiling: RUN_LIMITS.geminiCallsCeiling,
        fetchTimeoutMs: FETCH_LIMITS.timeoutMs,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid configuration";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
