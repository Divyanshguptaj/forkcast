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
  live?: boolean;
  pending?: boolean;
  resultsFirst?: boolean;
  typedText?: string;
  onEdit?(): void;
  onRetry?(): void;
  onCancel?(): void;
  children?: ReactNode;
}

export function AgentResearchView({ state, mockedStages = false, live = false, pending = false, resultsFirst = false, typedText, onEdit, onRetry, onCancel, children }: Props) {
  const notice = runNotice(state);
  const views = stageViews(state);
  const active = views.find((v) => state.stages[v.id] === "active");
  const running = state.status === "running" || pending;
  const shortlistOnly = !live && state.ended && state.shortlistOrder.length > 0 && !hasResearchEvents(state) && !notice;

  const actions = (
    <>
      {onRetry && notice !== "request_problem" ? <Button onClick={onRetry} size="sm">Try again</Button> : null}
      {onEdit ? <Button onClick={onEdit} size="sm" variant="secondary">Edit search</Button> : null}
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border-2 border-line bg-surface px-4 py-3">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
          <span aria-hidden="true">🔎</span>
          {requestSummaryParts(state.request).length === 0 && typedText ? <span className="min-w-0 truncate text-ink">“{typedText.slice(0, 90)}”</span> : null}
          {requestSummaryParts(state.request).map((part, i) => (
            <span key={`${part}-${i}`} className="rounded-full border border-line px-2.5 py-0.5 text-ink">
              {part}
            </span>
          ))}
        </p>
        {live && running && onCancel ? (
          <Button onClick={onCancel} size="sm" variant="secondary">
            Cancel search
          </Button>
        ) : onEdit ? (
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
          {live ? null : (
            <p className="flex flex-wrap items-center gap-2 rounded-control border-2 border-dashed border-saffron/60 px-3 py-2 text-sm text-muted">
              <DemoSticker />
              {mockedStages
                ? "Replay of a recorded Barcelona run. Discovery events are real; menu and diner research below is simulated."
                : "Replay of a recorded run. Nothing is being searched right now."}
            </p>
          )}

          {pending ? (
            <p role="status" className="rounded-control border-2 border-line bg-surface px-3 py-2 text-sm text-muted">
              <span aria-hidden="true">⏳ </span>Starting your search…
            </p>
          ) : null}

          {notice ? <StatusNotice kind={notice} actions={actions} body={live && (notice === "request_problem" || notice === "rate_limited" || notice === "service_unavailable") ? state.error?.message : undefined} /> : null}

          {resultsFirst ? children : null}

          {resultsFirst ? (
            <details className="rounded-card border-2 border-dashed border-line bg-surface/70 p-4" data-testid="research-details">
              <summary className="cursor-pointer list-none font-semibold text-muted hover:text-ink">
                <span className="underline decoration-line underline-offset-4">How we researched these {state.shortlistOrder.length} restaurants</span>
              </summary>
              <div className="mt-4 space-y-6">
                {state.discoveredCount ? <DiscoveryFunnel discovered={state.discoveredCount} shortlisted={state.shortlistOrder.length} /> : null}
                <ShortlistBoard state={state} mocked={mockedStages} />
              </div>
            </details>
          ) : (
            <>
              {state.discoveredCount ? <DiscoveryFunnel discovered={state.discoveredCount} shortlisted={state.shortlistOrder.length} /> : null}
              {live ? null : <ToolActivityStrip tools={state.tools} running={running} />}
              <ShortlistBoard state={state} mocked={mockedStages} />

              {shortlistOnly ? (
                <p className="rounded-card border-2 border-dashed border-line p-4 text-sm text-muted">
                  <span aria-hidden="true">🚧 </span>
                  Discovery is complete. Menu reading and diner research arrive in the next release, so these places are still candidates.
                </p>
              ) : null}

              {children}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
