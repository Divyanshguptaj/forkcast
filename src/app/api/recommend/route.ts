import { connection } from "next/server";
import { getEnv, type Env } from "@/config/env";
import { RateLimiter } from "@/server/http/rateLimit";
import { createRecommendHandler, type Providers } from "@/server/http/recommendHandler";
import { sharedExtractionCache } from "@/server/menu/extract/modelCache";
import { defaultFetcher } from "@/server/menu/resolver";
import { createGeminiClient } from "@/server/providers/gemini/client";
import { createPlacesClient } from "@/server/providers/places/client";
import { createTavilyClient } from "@/server/providers/tavily/client";

export const maxDuration = 120;

function providers(env: Env): Providers | undefined {
  if (!env.GOOGLE_PLACES_API_KEY) return undefined;
  return {
    places: createPlacesClient(env),
    search: env.TAVILY_API_KEY ? createTavilyClient(env) : undefined,
    llm: env.GEMINI_API_KEY ? createGeminiClient(env) : undefined,
    fetcher: defaultFetcher,
  };
}

let handler: ReturnType<typeof createRecommendHandler> | undefined;

function getHandler() {
  if (!handler) {
    const env = getEnv();
    const limiter = new RateLimiter({ maxRequests: env.RATE_LIMIT_MAX_REQUESTS, windowMs: env.RATE_LIMIT_WINDOW_SEC * 1000, maxConcurrentTotal: env.MAX_CONCURRENT_RUNS, globalMaxRequests: env.GLOBAL_MAX_SEARCHES_PER_DAY });
    handler = createRecommendHandler({ env: getEnv, providers, limiter, modelCache: sharedExtractionCache });
  }
  return handler;
}

export async function POST(req: Request) {
  await connection();
  try {
    return await getHandler()(req);
  } catch {
    return Response.json({ error: { code: "not_configured", message: "Forkcast is not configured on this server." } }, { status: 503 });
  }
}
