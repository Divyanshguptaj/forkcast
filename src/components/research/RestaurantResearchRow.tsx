"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { Badge } from "@/components/shared/Badge";
import { restaurantPhase } from "@/lib/agent/selectors";
import type { RestaurantResearch } from "@/lib/agent/types";
import { MenuResearchState } from "./MenuResearchState";
import { PHASE_COPY } from "./phaseCopy";
import { PipelineChips } from "./PipelineChips";
import { ReviewResearchState } from "./ReviewResearchState";

interface Props {
  restaurant: RestaurantResearch;
  index: number;
  reviewTerms: string[];
  mocked: boolean;
}

function prettyType(type: string | undefined): string | undefined {
  if (!type) return undefined;
  const text = type.replace(/_/g, " ");
  return text[0].toUpperCase() + text.slice(1);
}

export function formatFacts(r: RestaurantResearch): string[] {
  const facts: string[] = [];
  if (r.rating !== undefined) {
    facts.push(`⭐ ${r.rating.toFixed(1)}${r.ratingCount !== undefined ? ` (${r.ratingCount.toLocaleString("en-US")} reviews)` : ""}`);
  }
  if (r.priceLevel !== undefined && r.priceLevel > 0) facts.push("€".repeat(r.priceLevel));
  if (r.distanceKm !== undefined) facts.push(`📍 ${r.distanceKm.toFixed(1)} km from the center`);
  const type = prettyType(r.primaryType);
  if (type) facts.push(type);
  return facts;
}

export function RestaurantResearchRow({ restaurant: r, index, reviewTerms, mocked }: Props) {
  const reduce = usePrefersReducedMotion();
  const [showDishes, setShowDishes] = useState(true);
  const phase = restaurantPhase(r);
  const copy = PHASE_COPY[phase];
  const facts = formatFacts(r);
  const hasItems = r.menu.items.length > 0;

  return (
    <motion.li
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: reduce ? 0 : index * 0.08 }}
      data-restaurant={r.id}
      data-phase={phase}
      className="rounded-card border-2 border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 -rotate-3 items-center justify-center rounded-lg border-2 border-ink bg-saffron font-display text-lg font-extrabold text-bg"
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <h3 className="text-balance font-display text-xl font-extrabold leading-tight sm:text-2xl">
              <span aria-hidden="true">🍽️ </span>
              {r.name}
            </h3>
            <Badge tone={copy.tone} icon={copy.icon} role="status" aria-label={`Research status: ${copy.label}`}>
              {copy.label}
            </Badge>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {facts.map((f) => (
              <span key={f} className={f.startsWith("€") ? "tabular font-bold text-ink" : undefined}>
                {f}
              </span>
            ))}
            {r.mapsUrl ? (
              <a
                href={r.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-saffron"
              >
                Google Maps <ExternalLink aria-hidden="true" className="size-3.5" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
          </p>

          <div className="mt-3">
            <PipelineChips steps={r.steps} />
          </div>

          <div className="mt-3 space-y-3 border-t-2 border-dashed border-line pt-3">
            <MenuResearchState restaurant={r} mocked={mocked} showItems={showDishes} />
            <ReviewResearchState restaurant={r} terms={reviewTerms} />
            {hasItems ? (
              <button
                type="button"
                onClick={() => setShowDishes((v) => !v)}
                aria-expanded={showDishes}
                className="text-sm font-semibold text-muted underline decoration-line underline-offset-4 hover:text-ink"
              >
                {showDishes ? "Hide dishes" : `Show ${r.menu.items.length} dishes`}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </motion.li>
  );
}
