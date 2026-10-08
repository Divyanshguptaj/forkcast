import type { Env } from "@/config/env";
import { REQUEST_LIMITS } from "@/config/limits";
import type { AgentEvent } from "@/schemas/events";
import { RecommendRequestBody } from "@/schemas/request";
import { createEventEmitter } from "../agent/events";
import { runRecommendation, toPublicMetrics, type RunDeps, type RunOutcome } from "../agent/run";
import { RateLimiter } from "./rateLimit";

export interface Providers {
  places: RunDeps["places"];
  search?: RunDeps["search"];
  llm?: RunDeps["llm"];
  fetcher: RunDeps["fetcher"];
}

export interface HandlerDeps {
  env(): Env;
  providers(env: Env): Providers | undefined;
  limiter: RateLimiter;
  run?: typeof runRecommendation;
  modelCache?: RunDeps["modelCache"];
  limits?: RunDeps["limits"];
  log?(line: Record<string, unknown>): void;
}

const HEARTBEAT_MS = 15_000;
const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" };

function json(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function clientKey(req: Request, trustProxy = true): string {
  if (!trustProxy) return "local";
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = req.headers.get("x-real-ip")?.trim();
  return (forwarded || real || "local").slice(0, 64);
}

async function readCapped(req: Request, max: number): Promise<string | "too_large"> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) return "too_large";
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export function encodeEvent(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createRecommendHandler(deps: HandlerDeps) {
  const run = deps.run ?? runRecommendation;
  const log = deps.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));

  return async function handle(req: Request): Promise<Response> {
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return json(415, "unsupported_media_type", "Send the request as JSON.");

    const raw = await readCapped(req, REQUEST_LIMITS.maxBodyBytes);
    if (raw === "too_large") return json(413, "payload_too_large", "That request is too large.");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return json(400, "invalid_json", "The request was not valid JSON.");
    }
    const body = RecommendRequestBody.safeParse(parsedJson);
    if (!body.success) {
      const issues = body.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message }));
      return json(400, "invalid_request", "Tell Forkcast what you are looking for, or pick a few filters.", { issues });
    }
    const form = body.data.form;
    const hasFilters = Boolean(form?.diet?.length || form?.cuisines?.length || form?.budget !== undefined || (form?.meal && form.meal !== "any"));
    if (!body.data.text && !hasFilters) return json(400, "invalid_request", "Describe what you are hungry for, or choose at least a meal, diet, cuisine or budget.");

    let env: Env;
    try {
      env = deps.env();
    } catch {
      return json(503, "not_configured", "Forkcast is not configured on this server.");
    }
    const providers = deps.providers(env);
    if (!providers) return json(503, "not_configured", "Forkcast is not configured on this server.");

    const admission = deps.limiter.tryStart(clientKey(req, env.TRUST_PROXY_HEADERS));
    if (!admission.ok) {
      const message =
        admission.reason === "already_running"
          ? "A search is already running. Wait for it to finish or cancel it first."
          : admission.reason === "busy"
            ? "Forkcast is busy right now. Please try again in a moment."
            : "You have searched a lot recently. Please wait a little before searching again.";
      return json(429, admission.reason, message, { retryAfterSec: admission.retryAfterSec }, { "retry-after": String(admission.retryAfterSec) });
    }

    const encoder = new TextEncoder();
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    req.signal.addEventListener("abort", onAbort, { once: true });
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (chunk: string) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            open = false;
          }
        };
        heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
        const emitter = createEventEmitter((event) => send(encodeEvent(event)));
        const started = Date.now();
        let outcome: RunOutcome = "failed";
        let metrics: ReturnType<typeof toPublicMetrics> | undefined;
        try {
          const result = await run(body.data, { env, ...providers, emitter, signal: abort.signal, modelCache: deps.modelCache, limits: deps.limits });
          outcome = result.outcome;
          metrics = result.metrics ? toPublicMetrics(result.metrics) : undefined;
        } catch {
          outcome = "failed";
          if (!abort.signal.aborted) emitter.emit({ type: "error", code: "internal", message: "Something went wrong while researching. Please try again.", recoverable: true });
        } finally {
          clearInterval(heartbeat);
          req.signal.removeEventListener("abort", onAbort);
          admission.release();
          log({ evt: "recommend.run", outcome, wallMs: Date.now() - started, ...metrics });
          if (open) {
            try {
              controller.close();
            } catch {
              open = false;
            }
          }
        }
      },
      cancel() {
        abort.abort();
        clearInterval(heartbeat);
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  };
}
