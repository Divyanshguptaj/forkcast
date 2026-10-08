"use client";

import type { ReactNode } from "react";
import { DemoSticker } from "@/components/shared/Badge";
import { Button } from "@/components/shared/Button";
import { StatusNotice } from "@/components/states/StatusNotice";
import { hasResearchEvents, runNotice } from "@/lib/agent/selectors";
import type { RunState } from "@/lib/agent/types";
import { DiscoveryFunnel } from "./DiscoveryFunnel";
import { ResearchTrail } from "./ResearchTrail";
import { ShortlistBoard } from "./ShortlistBoard";
import { requestSummaryParts, stageViews } from "./stageCopy";
import { ToolActivityStrip } from "./ToolActivityBadge";

interface Props {
  state: RunState;
  mockedStages?: boolean;
  onEdit?(): void;
  onRetry?(): void;
  children?: ReactNode;
}

export function AgentResearchView({ state, mockedStages = false, onEdit, onRetry, children }: Props) {
  const notice = runNotice(state);
  const views = stageViews(state);
  const active = views.find((v) => state.stages[v.id] === "active");
  const running = state.status === "running";
  const shortlistOnly = state.ended && state.shortlistOrder.length > 0 && !hasResearchEvents(state) && !notice;

  const actions = (
    <>
      {onRetry ? <Button onClick={onRetry} size="sm">Try again</Button> : null}
      {onEdit ? <Button onClick={onEdit} size="sm" variant="secondary">Edit search</Button> : null}
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border-2 border-line bg-surface px-4 py-3">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
          <span aria-hidden="true">🔎</span>
          {requestSummaryParts(state.request).map((part, i) => (
            <span key={`${part}-${i}`} className="rounded-full border border-line px-2.5 py-0.5 text-ink">
              {part}
            </span>
          ))}
        </p>
        {onEdit ? (
          <Button onClick={onEdit} size="sm" variant="ghost">
            Edit search
          </Button>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {active ? `${active.title}. ${active.detail ?? ""}` : state.stages.ready === "done" ? "Recommendations ready." : ""}
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <ResearchTrail state={state} />
          {active ? (
            <div className="mt-3 rounded-control border-2 border-line bg-surface p-3 lg:hidden" aria-hidden="true">
              <p className="font-display text-lg font-bold">{active.title}</p>
              {active.detail ? <p className="text-sm text-muted">{active.detail}</p> : null}
            </div>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-6">
          <p className="flex flex-wrap items-center gap-2 rounded-control border-2 border-dashed border-saffron/60 px-3 py-2 text-sm text-muted">
            <DemoSticker />
            {mockedStages
              ? "Replay of a recorded Barcelona run. Discovery events are real; menu and diner research below is simulated."
              : "Replay of a recorded discovery run. Nothing is being searched right now."}
          </p>

          {notice ? <StatusNotice kind={notice} actions={actions} /> : null}

          {state.discoveredCount ? <DiscoveryFunnel discovered={state.discoveredCount} shortlisted={state.shortlistOrder.length} /> : null}
          <ToolActivityStrip tools={state.tools} running={running} />
          <ShortlistBoard state={state} mocked={mockedStages} />

          {shortlistOnly ? (
            <p className="rounded-card border-2 border-dashed border-line p-4 text-sm text-muted">
              <span aria-hidden="true">🚧 </span>
              Discovery is complete. Menu reading and diner research arrive in the next release, so these places are still candidates.
            </p>
          ) : null}

          {children}
        </div>
      </div>
    </div>
  );
}
