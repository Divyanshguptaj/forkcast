import { z } from "zod";
import type { Env } from "@/config/env";
import type { CallContext, LlmPart, LlmProvider, LlmStructuredRequest, LlmStructuredResult } from "../types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const RETRY_BACKOFF_MS = [800, 1_600];
const MAX_RETRY_WINDOW_MS = 20_000;

export type GeminiErrorCode =
  | "missing_api_key"
  | "unavailable"
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
}

export interface GeminiClientOptions {
  apiKey: string;
  models: string[];
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
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

type Verdict = "retry" | "next_model" | "fatal";

function classify(status: number, body: z.infer<typeof ErrorBody> | undefined): Verdict {
  if (status === 429) {
    const details = JSON.stringify(body?.error?.details ?? []);
    return /PerDay/i.test(details) ? "next_model" : "retry";
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) return "retry";
  if (status === 404) return "next_model";
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
  readonly stats: GeminiStats = { requests: 0, retries: 0, inputTokens: 0, outputTokens: 0, byModel: {}, failures: {} };

  constructor(opts: GeminiClientOptions) {
    if (!opts.apiKey) throw new GeminiError("missing_api_key", "Gemini API key is not configured");
    this.#apiKey = opts.apiKey;
    this.#models = opts.models;
    this.#timeoutMs = opts.timeoutMs ?? 90_000;
    this.#baseUrl = opts.baseUrl ?? BASE_URL;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  toJSON(): { provider: string; models: string[] } {
    return { provider: "gemini", models: this.#models };
  }

  async generateStructured<T>(req: LlmStructuredRequest<T>, ctx: CallContext = {}): Promise<LlmStructuredResult<T>> {
    const started = Date.now();
    const chain = req.models?.length ? req.models : this.#models;
    let lastError: GeminiError | undefined;

    for (const model of chain) {
      const windowStart = Date.now();
      for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
        if (ctx.signal?.aborted) throw new GeminiError("aborted", "Gemini request aborted");
        try {
          const result = await this.#request(model, req, ctx);
          return { ...result, durationMs: Date.now() - started };
        } catch (err) {
          const failure = err instanceof GeminiHttpFailure ? err : undefined;
          if (!failure) throw err;
          this.stats.failures[`${model}:${failure.status}`] = (this.stats.failures[`${model}:${failure.status}`] ?? 0) + 1;
          lastError = new GeminiError("unavailable", `Gemini ${model} returned HTTP ${failure.status}${failure.apiStatus ? ` (${failure.apiStatus})` : ""}`, failure.status);
          if (failure.verdict === "fatal") throw new GeminiError("bad_request", lastError.message, failure.status);
          if (failure.verdict === "next_model") break;
          const backoff = RETRY_BACKOFF_MS[attempt];
          if (backoff === undefined || Date.now() - windowStart + backoff > MAX_RETRY_WINDOW_MS) break;
          this.stats.retries++;
          await this.#sleep(backoff);
        }
      }
    }
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

    if (!response.ok) {
      let parsed: z.infer<typeof ErrorBody> | undefined;
      try {
        const result = ErrorBody.safeParse(await response.json());
        parsed = result.success ? result.data : undefined;
      } catch {
        parsed = undefined;
      }
      const apiStatus = parsed?.error?.status && /^[A-Z_]{3,40}$/.test(parsed.error.status) ? parsed.error.status : undefined;
      throw new GeminiHttpFailure(response.status, classify(response.status, parsed), apiStatus);
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
    try {
      data = JSON.parse(text);
    } catch {
      throw new GeminiError("invalid_response", "Gemini returned text that is not valid JSON");
    }
    const validated = req.schema.safeParse(data);
    if (!validated.success) throw new GeminiError("invalid_response", "Gemini output did not match the expected schema");
    return { data: validated.data, model, inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount };
  }
}

class GeminiHttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly verdict: Verdict,
    readonly apiStatus?: string,
  ) {
    super(`HTTP ${status}`);
  }
}

export function createGeminiClient(env: Env, overrides: Partial<GeminiClientOptions> = {}): GeminiClient {
  return new GeminiClient({ apiKey: env.GEMINI_API_KEY ?? "", models: env.GEMINI_MODEL_CHAIN, ...overrides });
}
