import { describe, expect, it } from "vitest";
import { loadEnv } from "@/config/env";
import { flagsFromEnv } from "@/config/flags";
import { FETCH_LIMITS, RUN_LIMITS } from "@/config/limits";
import { getCity } from "@/config/cities";

describe("env", () => {
  it("loads with no variables set", () => {
    const env = loadEnv({});
    expect(env.GOOGLE_PLACES_API_KEY).toBeUndefined();
    expect(env.DEFAULT_CITY).toBe("barcelona");
    expect(env.GEMINI_MODEL_CHAIN.length).toBeGreaterThan(1);
  });

  it("treats empty keys as unset", () => {
    expect(loadEnv({ GEMINI_API_KEY: "" }).GEMINI_API_KEY).toBeUndefined();
  });

  it("splits the model chain", () => {
    const env = loadEnv({ GEMINI_MODEL_CHAIN: "a-model, b-model ,,c-model" });
    expect(env.GEMINI_MODEL_CHAIN).toEqual(["a-model", "b-model", "c-model"]);
  });

  it("rejects malformed flag values without echoing them", () => {
    expect(() => loadEnv({ PLACES_REVIEWS_TO_LLM: "yes-please" })).toThrow(/PLACES_REVIEWS_TO_LLM/);
    try {
      loadEnv({ PLACES_REVIEWS_TO_LLM: "yes-please" });
    } catch (e) {
      expect(String(e)).not.toContain("yes-please");
    }
  });

  it("does not echo key values in errors", () => {
    try {
      loadEnv({ TAVILY_API_KEY: "short" });
    } catch (e) {
      expect(String(e)).not.toContain("short");
      expect(String(e)).toContain("TAVILY_API_KEY");
    }
  });
});

describe("feature flags", () => {
  it("PLACES_REVIEWS_TO_LLM defaults to false", () => {
    expect(flagsFromEnv(loadEnv({})).placesReviewsToLlm).toBe(false);
  });

  it("is enabled only by the literal value true", () => {
    expect(flagsFromEnv(loadEnv({ PLACES_REVIEWS_TO_LLM: "true" })).placesReviewsToLlm).toBe(true);
    expect(flagsFromEnv(loadEnv({ PLACES_REVIEWS_TO_LLM: "false" })).placesReviewsToLlm).toBe(false);
    expect(flagsFromEnv(loadEnv({ PLACES_REVIEWS_TO_LLM: "" as string })).placesReviewsToLlm).toBe(false);
  });
});

describe("limits and cities", () => {
  it("keeps the Gemini call budget expectation below the emergency ceiling", () => {
    expect(RUN_LIMITS.geminiCallsExpected).toBeLessThanOrEqual(15);
    expect(RUN_LIMITS.geminiCallsCeiling).toBe(45);
    expect(RUN_LIMITS.geminiCallsExpected).toBeLessThan(RUN_LIMITS.geminiCallsCeiling);
  });

  it("only allows standard web ports", () => {
    expect([...FETCH_LIMITS.allowedPorts]).toEqual([80, 443]);
  });

  it("resolves Barcelona from config, case-insensitively", () => {
    expect(getCity("Barcelona")?.menuLanguages).toContain("ca");
    expect(getCity("atlantis")).toBeUndefined();
  });
});
