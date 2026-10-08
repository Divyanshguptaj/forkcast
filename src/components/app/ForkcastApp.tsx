"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { MotionConfig } from "motion/react";
import { Hero } from "@/components/compose/Hero";
import { SearchComposer } from "@/components/compose/SearchComposer";
import type { ComposerState } from "@/components/compose/composerModel";
import { AgentResearchView } from "@/components/research/AgentResearchView";
import { RecommendationResults } from "@/components/results/RecommendationResults";
import { ResultsPreview } from "@/components/results/ResultsPreview";
import { useAgentRun } from "@/hooks/useAgentRun";
import { createReplaySource } from "@/lib/agent/replay";
import { createSseSource } from "@/lib/agent/sse";
import type { RecommendRequestBodyType } from "@/schemas/request";
import { getScenario, type ScenarioId } from "@/mocks/replay/scenarios";
import { RESULT_PREVIEW } from "@/mocks/replay/resultPreview";
import { DemoBar } from "./DemoBar";

type View = "compose" | "research";

const subscribeNever = () => () => undefined;
const readSearch = () => window.location.search;

export function ForkcastApp() {
  const { state, start, reset } = useAgentRun();
  const [view, setView] = useState<View>("compose");
  const search = useSyncExternalStore(subscribeNever, readSearch, () => "");
  const [scenarioOverride, setScenarioId] = useState<ScenarioId | null>(null);
  const [speedOverride, setSpeed] = useState<number | null>(null);
  const params = new URLSearchParams(search);
  const replay = params.has("scenario");
  const scenarioId = scenarioOverride ?? getScenario(params.get("scenario") ?? undefined).id;
  const urlSpeed = params.get("speed");
  const speed = speedOverride ?? (urlSpeed !== null && Number.isFinite(Number(urlSpeed)) ? Number(urlSpeed) : 1);
  const [composer, setComposer] = useState<ComposerState | undefined>(undefined);
  const lastBody = useRef<RecommendRequestBodyType | undefined>(undefined);

  const scenario = getScenario(scenarioId);

  const begin = useCallback(
    (body: RecommendRequestBodyType | undefined, id: ScenarioId, pace: number) => {
      if (replay) start(createReplaySource(getScenario(id).steps, { speed: pace }));
      else if (body) start(createSseSource(body));
    },
    [replay, start],
  );

  function submit(body: RecommendRequestBodyType, composerState: ComposerState) {
    lastBody.current = body;
    setComposer(composerState);
    setView("research");
    begin(body, scenarioId, speed);
    window.scrollTo({ top: 0 });
  }

  function edit() {
    reset();
    setView("compose");
  }

  const running = state.status === "running";
  const done = state.stages.ready === "done";

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between pb-6">
          <Link href="/" className="inline-flex items-center gap-2 rounded-md font-display text-2xl font-extrabold">
            <span aria-hidden="true" className="inline-block -rotate-6">
              🍴
            </span>
            Forkcast
          </Link>
        </div>

        <main id="main" className="flex-1">
          {view === "compose" ? (
            <div className="mx-auto max-w-3xl space-y-8 pb-10 pt-2 sm:pt-6">
              <Hero />
              <SearchComposer key={composer ? "edit" : "new"} initial={composer} allowEmpty={replay} onSubmit={submit} />
            </div>
          ) : (
            <div className="pb-10">
              <h1 className="sr-only">{running ? "Forkcast is researching your request" : done ? "Your recommendations" : "Forkcast search"}</h1>
              <AgentResearchView
                state={state}
                mockedStages={replay && scenario.mockedStages}
                live={!replay}
                pending={!replay && state.status === "idle"}
                resultsFirst={Boolean(state.recommendations)}
                onEdit={edit}
                onCancel={edit}
                onRetry={() => begin(lastBody.current, scenarioId, speed)}
              >
                {state.recommendations ? <RecommendationResults set={state.recommendations} metrics={state.metrics} /> : null}
                {replay && done && !state.recommendations && scenario.withResultsPreview ? <ResultsPreview cards={RESULT_PREVIEW} /> : null}
              </AgentResearchView>
            </div>
          )}
        </main>

        {replay ? (
          <footer className="pt-6">
            <DemoBar scenario={scenarioId} speed={speed} onScenario={setScenarioId} onSpeed={setSpeed} />
          </footer>
        ) : null}
      </div>
    </MotionConfig>
  );
}
