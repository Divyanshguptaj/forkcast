import { AgentEventSchema, type AgentEvent } from "@/schemas/events";
import type { RecommendRequestBodyType } from "@/schemas/request";
import type { AgentEventSource } from "./source";

export interface SseOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  clientTimeoutMs?: number;
}

const CLIENT_RUN = "client";

function clientEvents(code: string, message: string, recoverable: boolean, runId?: string): AgentEvent[] {
  const base = { runId: runId ?? CLIENT_RUN, ts: new Date().toISOString() };
  const error: AgentEvent = { ...base, seq: runId ? 100_000 : 1, type: "error", code, message: message.slice(0, 300), recoverable };
  return runId ? [error] : [{ ...base, seq: 0, type: "run.started" }, error];
}

export function parseSseFrame(frame: string): AgentEvent | undefined {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  try {
    const parsed = AgentEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function errorFromResponse(res: Response): Promise<AgentEvent[]> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ?? `http_${res.status}`;
    return clientEvents(code, body.error?.message ?? "The search could not be started.", res.status === 429 || res.status >= 500);
  } catch {
    return clientEvents(`http_${res.status}`, "The search could not be started.", res.status >= 500);
  }
}

export function createSseSource(body: RecommendRequestBodyType, options: SseOptions = {}): AgentEventSource {
  const url = options.url ?? "/api/recommend";
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  return {
    start({ onEvent, onEnd }) {
      const controller = new AbortController();
      let stopped = false;
      let runId: string | undefined;
      const timer = setTimeout(() => controller.abort(), options.clientTimeoutMs ?? 150_000);

      void (async () => {
        try {
          const res = await doFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
          if (!res.ok || !res.body) {
            for (const e of await errorFromResponse(res)) if (!stopped) onEvent(e);
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let sawFinal = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
            let at = buffer.indexOf("\n\n");
            while (at >= 0) {
              const event = parseSseFrame(buffer.slice(0, at));
              buffer = buffer.slice(at + 2);
              if (event && !stopped) {
                runId = event.runId;
                if (event.type === "explain.done" || event.type === "error" || (event.type === "discover.found" && event.count === 0)) sawFinal = true;
                onEvent(event);
              }
              at = buffer.indexOf("\n\n");
            }
          }
          if (!sawFinal && !stopped) {
            for (const e of clientEvents("incomplete", "The connection ended before the results were ready.", true, runId)) onEvent(e);
          }
        } catch {
          if (!stopped) for (const e of clientEvents("network", controller.signal.aborted ? "The search took too long and was stopped." : "Couldn't reach Forkcast. Check your connection and try again.", true, runId)) onEvent(e);
        } finally {
          clearTimeout(timer);
          if (!stopped) onEnd();
        }
      })();

      return () => {
        stopped = true;
        clearTimeout(timer);
        controller.abort();
      };
    },
  };
}
