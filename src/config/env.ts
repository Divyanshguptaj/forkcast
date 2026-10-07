import { z } from "zod";

const boolFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );

const optionalKey = z
  .string()
  .trim()
  .min(8)
  .optional()
  .or(z.literal("").transform(() => undefined));

const envSchema = z.object({
  GOOGLE_PLACES_API_KEY: optionalKey,
  GEMINI_API_KEY: optionalKey,
  TAVILY_API_KEY: optionalKey,
  PLACES_REVIEWS_TO_LLM: boolFlag,
  GEMINI_MODEL_CHAIN: csv(
    "gemini-2.5-flash,gemini-flash-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite",
  ),
  GEMINI_PRICE_CHECK_MODEL: z.string().default("gemini-3.5-flash-lite"),
  DEFAULT_CITY: z.string().default("barcelona"),
  PLACES_REQUEST_VEGETARIAN_SIGNAL: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const result = envSchema.safeParse(present);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => i.path.join(".")))];
    throw new Error(`Invalid environment configuration: ${names.join(", ")}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
