import { z } from "zod";
import type { Env } from "@/config/env";
import type { CallContext, LlmPart, LlmProvider, LlmStructuredRequest, LlmStructuredResult } from "../types";
import { COOLDOWN_MS, QuotaBreaker, sharedQuotaBreaker } from "./quotaBreaker";
import { salvageTruncatedJson } from "./salvage";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const RETRY_BACKOFF_MS = [800, 1_600];
const MAX_RETRY_WINDOW_MS = 20_000;
const WARM_UP_GATE_MS = 1_500;

export type GeminiErrorCode =
  | "missing_api_key"
  | "unavailable"
  | "quota_exhausted"
  | "bad_request"
  | "timeout"
  | "aborted"
  | "network"
  | "invalid_response"
  | "blocked";

export class GeminiError extends Error {
  constructor(
    readonly code: GeminiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export interface GeminiStats {
  requests: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  byModel: Record<string, number>;
  failures: Record<string, number>;
  skippedByBreaker: number;
}

export interface GeminiClientOptions {
  apiKey: string;
  models: string[];
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  breaker?: QuotaBreaker;
}

const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional() }).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

const ErrorBody = z.object({
  error: z
    .object({
      status: z.string().optional(),
      message: z.string().optional(),
      details: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
});

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function toParts(parts: LlmPart[]) {
  return parts.map((p) => (p.kind === "text" ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: toBase64(p.data) } }));
}

type Verdict = "retry" | "rate_limit" | "daily_quota" | "not_found" | "next_model" | "fatal";

function parseRetryDelay(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return match ? Math.round(Number(match[1]) * 1000) : undefined;
}

function retryAfterMs(headers: Headers, body: z.infer<typeof ErrorBody> | undefined, now: number): number | undefined {
  const fromBody = (body?.error?.details ?? []).map((d) => parseRetryDelay(d.retryDelay)).find((v) => v !== undefined);
  if (fromBody !== undefined) return fromBody;
  const header = headers.get("retry-after");
  if (!header) return undefined;
  if (/^\d+$/.test(header.trim())) return Number(header) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function classify(status: number, body: z.infer<typeof ErrorBody> | undefined): Verdict {
  if (status === 429) {
    const details = JSON.stringify(body?.error?.details ?? []);
    return /PerDay/i.test(details) ? "daily_quota" : "rate_limit";
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) return "retry";
  if (status === 404) return "not_found";
  if (status === 400 || status === 401 || status === 403) return "fatal";
  return "next_model";
}

export class GeminiClient implements LlmProvider {
  readonly #apiKey: string;
  readonly #models: string[];
  readonly #timeoutMs: number;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #breaker: QuotaBreaker;
  readonly #gates = new Map<string, { promise: Promise<void>; release: () => void }>();
  readonly #answered = new Set<string>();
  readonly stats: GeminiStats = { requests: 0, retries: 0, inputTokens: 0, outputTokens: 0, byModel: {}, failures: {}, skippedByBreaker: 0 };

  constructor(opts: GeminiClientOptions) {
    if (!opts.apiKey) throw new GeminiError("missing_api_key", "Gemini API key is not configured");
    this.#apiKey = opts.apiKey;
    this.#models = opts.models;
    this.#timeoutMs = opts.timeoutMs ?? 90_000;
    this.#baseUrl = opts.baseUrl ?? BASE_URL;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#breaker = opts.breaker ?? new QuotaBreaker();
  }

  toJSON(): { provider: string; models: string[] } {
    return { provider: "gemini", models: this.#models };
  }

  available(): boolean {
    return this.#models.some((m) => !this.#breaker.blocked(m));
  }

  blockedModels(): Record<string, { reason: string; remainingMs: number }> {
    return this.#breaker.snapshot();
  }

  async #warmUp(model: string): Promise<void> {
    if (this.#answered.has(model)) return;
    const existing = this.#gates.get(model);
    if (existing) {
      await existing.promise;
      return;
    }
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    const timer = setTimeout(() => gate.release(), WARM_UP_GATE_MS);
    const gate = {
      promise,
      release: () => {
        clearTimeout(timer);
        this.#gates.delete(model);
        open();
      },
    };
    this.#gates.set(model, gate);
  }

  async generateStructured<T>(req: LlmStructuredRequest<T>, ctx: CallContext = {}): Promise<LlmStructuredResult<T>> {
    const started = Date.now();
    const chain = req.models?.length ? req.models : this.#models;
    let lastError: GeminiError | undefined;
    let dailyOnly = chain.length > 0;

    for (const model of chain) {
      await this.#warmUp(model);
      const blocked = this.#breaker.blocked(model);
      if (blocked) {
        this.#gates.get(model)?.release();
        this.stats.skippedByBreaker++;
        if (blocked.reason !== "daily_quota") dailyOnly = false;
        lastError ??= new GeminiError("unavailable", `Gemini ${model} is paused (${blocked.reason.replace(/_/g, " ")})`);
        continue;
      }
      const windowStart = Date.now();
      let modelDaily = false;
      for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
        if (ctx.signal?.aborted) throw new GeminiError("aborted", "Gemini request aborted");
        try {
          const result = await this.#request(model, req, ctx);
          this.#breaker.clear(model);
          this.#gates.get(model)?.release();
          return { ...result, durationMs: Date.now() - started };
        } catch (err) {
          const failure = err instanceof GeminiHttpFailure ? err : undefined;
          if (!failure) throw err;
          this.stats.failures[`${model}:${failure.status}`] = (this.stats.failures[`${model}:${failure.status}`] ?? 0) + 1;
          lastError = new GeminiError("unavailable", `Gemini ${model} returned HTTP ${failure.status}${failure.apiStatus ? ` (${failure.apiStatus})` : ""}`, failure.status);
          if (failure.verdict === "fatal") {
            this.#gates.get(model)?.release();
            throw new GeminiError("bad_request", lastError.message, failure.status);
          }
          if (failure.verdict === "daily_quota") {
            this.#breaker.block(model, "daily_quota", Math.max(failure.retryAfterMs ?? 0, COOLDOWN_MS.daily_quota));
            this.#gates.get(model)?.release();
            modelDaily = true;
            break;
          }
          if (failure.verdict === "not_found") {
            this.#breaker.block(model, "not_found");
            break;
          }
          if (failure.verdict === "next_model") break;
          const rateLimited = failure.verdict === "rate_limit";
          const wait = rateLimited && failure.retryAfterMs !== undefined ? failure.retryAfterMs : RETRY_BACKOFF_MS[attempt];
          if (wait === undefined || Date.now() - windowStart + wait > MAX_RETRY_WINDOW_MS) {
            this.#breaker.block(model, rateLimited ? "rate_limit" : "unavailable", rateLimited ? (failure.retryAfterMs ?? COOLDOWN_MS.rate_limit) : COOLDOWN_MS.unavailable);
            break;
          }
          this.stats.retries++;
          await this.#sleep(wait);
        }
      }
      this.#gates.get(model)?.release();
      if (!modelDaily) dailyOnly = false;
    }
    if (dailyOnly) throw new GeminiError("quota_exhausted", "Every configured Gemini model has hit its daily quota", 429);
    throw lastError ?? new GeminiError("unavailable", "No Gemini model is configured");
  }

  async #request<T>(model: string, req: LlmStructuredRequest<T>, ctx: CallContext): Promise<Omit<LlmStructuredResult<T>, "durationMs">> {
    const generationConfig: Record<string, unknown> = {
      responseMimeType: "application/json",
      responseSchema: req.jsonSchema,
      temperature: 0,
    };
    if (/2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: req.thinkingBudget ?? 0 };
    if (req.maxOutputTokens) generationConfig.maxOutputTokens = req.maxOutputTokens;

    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: toParts(req.parts) }],
      generationConfig,
    };

    const timeout = AbortSignal.timeout(req.timeoutMs ?? this.#timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout;
    this.stats.requests++;
    this.stats.byModel[model] = (this.stats.byModel[model] ?? 0) + 1;

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.#apiKey },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (ctx.signal?.aborted) throw new GeminiError("aborted", "Gemini request aborted");
      if (timeout.aborted) throw new GeminiError("timeout", `Gemini request timed out after ${req.timeoutMs ?? this.#timeoutMs} ms`);
      throw new GeminiHttpFailure(0, "retry");
    }

    this.#answered.add(model);
    if (!response.ok) {
      let parsed: z.infer<typeof ErrorBody> | undefined;
      try {
        const result = ErrorBody.safeParse(await response.json());
        parsed = result.success ? result.data : undefined;
      } catch {
        parsed = undefined;
      }
      const apiStatus = parsed?.error?.status && /^[A-Z_]{3,40}$/.test(parsed.error.status) ? parsed.error.status : undefined;
      throw new GeminiHttpFailure(response.status, classify(response.status, parsed), apiStatus, retryAfterMs(response.headers, parsed, Date.now()));
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new GeminiError("invalid_response", "Gemini response was not valid JSON");
    }
    const envelope = ResponseSchema.safeParse(json);
    if (!envelope.success) throw new GeminiError("invalid_response", "Gemini response had an unexpected shape");
    if (envelope.data.promptFeedback?.blockReason) throw new GeminiError("blocked", `Gemini blocked the request (${envelope.data.promptFeedback.blockReason})`);

    const text = envelope.data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const usage = envelope.data.usageMetadata;
    this.stats.inputTokens += usage?.promptTokenCount ?? 0;
    this.stats.outputTokens += usage?.candidatesTokenCount ?? 0;

    let data: unknown;
    let truncated = false;
    try {
      data = JSON.parse(text);
    } catch {
      truncated = envelope.data.candidates?.[0]?.finishReason === "MAX_TOKENS";
      data = truncated ? salvageTruncatedJson(text) : undefined;
      if (data === undefined) throw new GeminiError("invalid_response", "Gemini returned text that is not valid JSON");
    }
    const validated = req.schema.safeParse(data);
    if (!validated.success) throw new GeminiError("invalid_response", "Gemini output did not match the expected schema");
    return { data: validated.data, model, inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount, ...(truncated ? { truncated } : {}) };
  }
}

class GeminiHttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly verdict: Verdict,
    readonly apiStatus?: string,
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status}`);
  }
}

export function createGeminiClient(env: Env, overrides: Partial<GeminiClientOptions> = {}): GeminiClient {
  return new GeminiClient({ apiKey: env.GEMINI_API_KEY ?? "", models: env.GEMINI_MODEL_CHAIN, breaker: sharedQuotaBreaker, ...overrides });
}
