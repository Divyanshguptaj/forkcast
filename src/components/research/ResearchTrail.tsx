"use client";

import { Check } from "lucide-react";
import { motion } from "motion/react";
import { cx } from "@/lib/cx";
import type { RunState, StageStatus } from "@/lib/agent/types";
import { stageViews } from "./stageCopy";

const NODE: Record<StageStatus, string> = {
  pending: "border-line bg-surface text-muted",
  active: "pulse-ring border-saffron bg-saffron/20 text-ink",
  done: "border-basil bg-basil text-bg",
};

export function ResearchTrail({ state }: { state: RunState }) {
  const views = stageViews(state);
  return (
    <nav aria-label="Research progress">
      <ol className="flex w-full lg:flex-col">
        {views.map((v, i) => {
          const status = state.stages[v.id];
          const last = i === views.length - 1;
          return (
            <li
              key={v.id}
              aria-current={status === "active" ? "step" : undefined}
              data-stage={v.id}
              data-status={status}
              className="relative flex min-w-0 flex-1 flex-col items-stretch gap-1.5 text-center last:flex-none lg:flex-none lg:flex-row lg:items-start lg:gap-4 lg:text-left"
            >
              <div className="flex items-center lg:flex-col lg:self-stretch">
                <motion.span
                  layout
                  className={cx("relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-lg transition-colors duration-300 lg:size-11 lg:text-xl", NODE[status])}
                  animate={status === "done" ? { scale: [1, 1.12, 1] } : undefined}
                  transition={{ duration: 0.35 }}
                >
                  {status === "done" ? <Check aria-hidden="true" className="size-5 stroke-[3]" /> : <span aria-hidden="true">{v.emoji}</span>}
                </motion.span>
                {!last ? (
                  <span
                    aria-hidden="true"
                    className={cx(
                      "mx-1 h-0.5 min-w-2 flex-1 rounded-full transition-colors duration-500 lg:mx-0 lg:my-1 lg:h-full lg:min-h-7 lg:w-0.5 lg:flex-none",
                      state.stages[views[i + 1].id] !== "pending" || status === "done" ? "bg-basil" : "bg-line",
                    )}
                  />
                ) : null}
              </div>
              <div className="min-w-0 lg:pb-5 lg:pt-1.5">
                <p className={cx("-ml-3 w-16 text-center text-[11px] font-semibold lg:hidden", status === "pending" ? "text-muted" : "text-ink")}>{v.short}</p>
                <p className={cx("hidden font-display text-lg font-bold leading-tight lg:block", status === "pending" ? "text-muted/70" : "text-ink")}>{v.title}</p>
                {v.detail && status !== "pending" ? <p className="hidden max-w-60 text-sm text-muted lg:block">{v.detail}</p> : null}
                {status === "pending" ? <span className="sr-only"> (not started)</span> : null}
                {status === "done" ? <span className="sr-only"> (done)</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
