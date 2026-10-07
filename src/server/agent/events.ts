import { randomUUID } from "node:crypto";
import { AgentEventSchema, type AgentEvent } from "@/schemas/events";

export type EventSink = (event: AgentEvent) => void;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type EventInput = DistributiveOmit<AgentEvent, "runId" | "seq" | "ts">;

export interface EventEmitter {
  runId: string;
  emit(event: EventInput): AgentEvent;
}

export function createEventEmitter(sink: EventSink, runId: string = randomUUID(), now: () => Date = () => new Date()): EventEmitter {
  let seq = 0;
  return {
    runId,
    emit(event) {
      const full = AgentEventSchema.parse({ ...event, runId, seq: seq++, ts: now().toISOString() });
      sink(full);
      return full;
    },
  };
}
