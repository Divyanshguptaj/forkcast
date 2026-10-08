import type { AgentEvent } from "@/schemas/events";

export interface AgentEventHandlers {
  onEvent(event: AgentEvent): void;
  onEnd(): void;
}

export interface AgentEventSource {
  start(handlers: AgentEventHandlers): () => void;
}
