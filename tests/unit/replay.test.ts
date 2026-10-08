import { describe, expect, it, vi } from "vitest";
import { buildTimeline, createReplaySource, type Scheduler } from "@/lib/agent/replay";
import type { AgentEvent } from "@/schemas/events";

function fakeScheduler() {
  const queue: Array<{ id: number; fn: () => void; ms: number; cancelled: boolean }> = [];
  let next = 1;
  const scheduler: Scheduler = {
    setTimeout(fn, ms) {
      const item = { id: next++, fn, ms, cancelled: false };
      queue.push(item);
      return item;
    },
    clearTimeout(handle) {
      (handle as { cancelled: boolean }).cancelled = true;
    },
  };
  const flush = () => {
    for (const item of [...queue].sort((a, b) => a.ms - b.ms || a.id - b.id)) if (!item.cancelled) item.fn();
  };
  return { scheduler, queue, flush };
}

const timeline = buildTimeline("r1", [
  { at: 500, event: { type: "discover.found", count: 3 } },
  { at: 0, event: { type: "run.started" } },
  { at: 100, event: { type: "discover.started", city: "Barcelona" } },
]);

describe("buildTimeline", () => {
  it("orders by time and assigns sequence numbers", () => {
    expect(timeline.map((s) => s.event.type)).toEqual(["run.started", "discover.started", "discover.found"]);
    expect(timeline.map((s) => s.event.seq)).toEqual([0, 1, 2]);
    expect(timeline.every((s) => s.event.runId === "r1")).toBe(true);
  });
});

describe("createReplaySource", () => {
  it("delivers events in order, then ends", () => {
    const { scheduler, flush } = fakeScheduler();
    const seen: string[] = [];
    const onEnd = vi.fn();
    createReplaySource(timeline, { scheduler }).start({ onEvent: (e: AgentEvent) => seen.push(e.type), onEnd });
    flush();
    expect(seen).toEqual(["run.started", "discover.started", "discover.found"]);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("scales delays by speed", () => {
    const { scheduler, queue } = fakeScheduler();
    createReplaySource(timeline, { scheduler, speed: 2 }).start({ onEvent: () => undefined, onEnd: () => undefined });
    expect(queue.map((q) => q.ms)).toEqual([0, 50, 250, 350]);
  });

  it("delivers everything immediately at speed 0", () => {
    const { scheduler, queue } = fakeScheduler();
    createReplaySource(timeline, { scheduler, speed: 0 }).start({ onEvent: () => undefined, onEnd: () => undefined });
    expect(queue.every((q) => q.ms === 0)).toBe(true);
  });

  it("stops delivering after the returned stop function is called", () => {
    const { scheduler, flush } = fakeScheduler();
    const onEvent = vi.fn();
    const onEnd = vi.fn();
    const stop = createReplaySource(timeline, { scheduler }).start({ onEvent, onEnd });
    stop();
    flush();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("can be started more than once with independent timers", () => {
    const { scheduler, flush } = fakeScheduler();
    const source = createReplaySource(timeline, { scheduler });
    const a = vi.fn();
    const b = vi.fn();
    source.start({ onEvent: a, onEnd: () => undefined });
    source.start({ onEvent: b, onEnd: () => undefined });
    flush();
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(3);
  });
});
