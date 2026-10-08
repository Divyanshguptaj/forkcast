"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { agentReducer, createInitialRunState } from "@/lib/agent/reducer";
import type { AgentEventSource } from "@/lib/agent/source";

export function useAgentRun() {
  const [state, dispatch] = useReducer(agentReducer, undefined, createInitialRunState);
  const stopRef = useRef<(() => void) | undefined>(undefined);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = undefined;
  }, []);

  const start = useCallback(
    (source: AgentEventSource) => {
      stop();
      dispatch({ type: "reset" });
      stopRef.current = source.start({
        onEvent: (event) => dispatch({ type: "event", event }),
        onEnd: () => dispatch({ type: "source.ended" }),
      });
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    dispatch({ type: "reset" });
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { state, start, reset };
}
