import type { AgentEvent } from "@/schemas/events";
import type { AgentEventSource } from "./source";

export interface ReplayStep {
  at: number;
  event: AgentEvent;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ReplayOptions {
  speed?: number;
  scheduler?: Scheduler;
  tailMs?: number;
}

const browserScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

export function createReplaySource(steps: readonly ReplayStep[], options: ReplayOptions = {}): AgentEventSource {
  const speed = options.speed ?? 1;
  const scheduler = options.scheduler ?? browserScheduler;
  const sorted = [...steps].sort((a, b) => a.at - b.at || a.event.seq - b.event.seq);

  return {
    start({ onEvent, onEnd }) {
      const handles: unknown[] = [];
      const delay = (ms: number) => (speed <= 0 ? 0 : Math.round(ms / speed));
      for (const step of sorted) {
        handles.push(scheduler.setTimeout(() => onEvent(step.event), delay(step.at)));
      }
      const last = sorted.at(-1)?.at ?? 0;
      handles.push(scheduler.setTimeout(onEnd, delay(last + (options.tailMs ?? 200))));
      return () => {
        for (const h of handles) scheduler.clearTimeout(h);
      };
    },
  };
}

type EventInput = Record<string, unknown> & { type: AgentEvent["type"] };

export interface TimelineEntry {
  at: number;
  event: EventInput;
}

const BASE_TS = Date.parse("2026-10-07T12:00:00.000Z");

export function buildTimeline(runId: string, entries: readonly TimelineEntry[]): ReplayStep[] {
  const ordered = entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.at - b.entry.at || a.index - b.index);
  return ordered.map(({ entry }, seq) => ({
    at: entry.at,
    event: { ...entry.event, runId, seq, ts: new Date(BASE_TS + entry.at).toISOString() } as unknown as AgentEvent,
  }));
}
