import { getEnv, type Env } from "./env";

export interface FeatureFlags {
  placesReviewsToLlm: boolean;
}

export function flagsFromEnv(env: Env): FeatureFlags {
  return { placesReviewsToLlm: env.PLACES_REVIEWS_TO_LLM };
}

export function getFlags(): FeatureFlags {
  return flagsFromEnv(getEnv());
}
