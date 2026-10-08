"use client";

import { Skeleton } from "@/components/shared/Skeleton";
import type { RunState } from "@/lib/agent/types";
import { RestaurantResearchRow } from "./RestaurantResearchRow";

interface Props {
  state: RunState;
  mocked: boolean;
}

export function ShortlistBoard({ state, mocked }: Props) {
  const ids = state.shortlistOrder;

  if (ids.length === 0) {
    if (state.discoveredCount === undefined || state.discoveredCount === 0) return null;
    return (
      <section aria-label="Shortlist" aria-busy="true" className="space-y-3">
        <p className="text-sm font-semibold text-muted">Picking the places worth a closer look…</p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-card border-2 border-line bg-surface p-5">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section aria-labelledby="shortlist-heading" className="space-y-4">
      <div>
        <h2 id="shortlist-heading" className="text-3xl font-extrabold">
          {ids.length} place{ids.length === 1 ? "" : "s"} made the shortlist
        </h2>
        <p className="mt-1 text-muted">Research candidates, not recommendations yet. Forkcast is still reading their menus and checking diners.</p>
      </div>
      <ol className="space-y-3">
        {ids.map((id, i) => (
          <RestaurantResearchRow key={id} restaurant={state.restaurants[id]} index={i} reviewTerms={state.reviewTerms} mocked={mocked} />
        ))}
      </ol>
    </section>
  );
}
