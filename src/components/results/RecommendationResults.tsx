"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { MatchedRestaurant, RecommendationSet } from "@/schemas/recommendations";
import { RestaurantMatchCard } from "./RestaurantMatchCard";

function Notice({ children }: { children: React.ReactNode }) {
  return <li className="rounded-control border-2 border-dashed border-saffron/60 bg-saffron/8 px-3 py-2 text-sm text-ink">{children}</li>;
}

function CardList({ items }: { items: MatchedRestaurant[] }) {
  const reduce = usePrefersReducedMotion();
  return (
    <ol className="space-y-5">
      {items.map((r, i) => (
        <motion.li key={r.restaurantId} initial={reduce ? false : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: reduce ? 0 : i * 0.12 }}>
          <RestaurantMatchCard r={r} />
        </motion.li>
      ))}
    </ol>
  );
}

const HEADING: Record<RecommendationSet["outcome"], string> = {
  exact_matches: "🏆 Your best matches",
  alternatives_only: "🤔 No exact match",
  none: "😕 Nothing we can recommend yet",
};

export function RecommendationResults({ set }: { set: RecommendationSet }) {
  const exact = set.recommendations.filter((r) => r.tier === "exact");
  const others = set.recommendations.filter((r) => r.tier !== "exact");
  const hard = set.constraints.filter((c) => c.strength === "hard");
  const soft = set.constraints.filter((c) => c.strength === "soft");

  return (
    <section aria-labelledby="results-heading" className="space-y-6" data-testid="recommendation-results" data-outcome={set.outcome}>
      <div className="space-y-3">
        <h2 id="results-heading" className="text-4xl font-extrabold">
          {HEADING[set.outcome]}
        </h2>
        <p className="text-sm text-muted">
          Checked {set.stats.considered} restaurant{set.stats.considered === 1 ? "" : "s"}; {set.stats.withMenu} had a readable menu. Everything below comes from the menus and Google data we read, and the ranking is computed without AI.
        </p>
        {set.constraints.length > 0 ? (
          <dl className="space-y-1.5 text-sm">
            {hard.length > 0 ? (
              <div className="flex flex-wrap items-baseline gap-2">
                <dt className="font-semibold text-ink">Must have</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {hard.map((c) => (
                    <span key={c.id} className="rounded-full border border-ink/60 px-2.5 py-0.5 text-ink">
                      {c.label}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
            {soft.length > 0 ? (
              <div className="flex flex-wrap items-baseline gap-2">
                <dt className="font-semibold text-muted">Nice to have</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {soft.map((c) => (
                    <span key={c.id} className="rounded-full border border-line px-2.5 py-0.5 text-muted">
                      {c.label}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {set.notices.length > 0 ? (
        <ul className="space-y-2" aria-label="Notes about these results">
          {set.notices.map((n) => (
            <Notice key={n}>{n}</Notice>
          ))}
        </ul>
      ) : null}

      {exact.length > 0 ? <CardList items={exact} /> : null}

      {others.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-2xl font-extrabold">{set.outcome === "alternatives_only" ? "Closest options" : "Also worth a look"}</h3>
          <p className="text-sm text-muted">
            {set.outcome === "alternatives_only"
              ? "None of these satisfies everything. Each one says what it is missing, and your diet and budget are never loosened silently."
              : "These don't meet every requirement or the menu doesn't confirm it. Each one says why."}
          </p>
          <CardList items={others} />
        </div>
      ) : null}

      {set.excluded.length > 0 ? (
        <details className="rounded-card border-2 border-dashed border-line bg-surface/70 p-4 text-sm" data-testid="excluded-list">
          <summary className="cursor-pointer list-none font-semibold text-muted hover:text-ink">
            <span className="underline decoration-line underline-offset-4">Not recommended ({set.excluded.length})</span>
          </summary>
          <ul className="mt-3 space-y-2">
            {set.excluded.map((e) => (
              <li key={e.restaurantId} className="[overflow-wrap:anywhere]">
                <span className="font-semibold text-ink">{e.name}</span>
                <span className="text-muted"> — {e.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
