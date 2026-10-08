"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { DemoSticker } from "@/components/shared/Badge";
import { RecommendationCardShell, type RecommendationCardShellProps } from "./RecommendationCardShell";

export function ResultsPreview({ cards }: { cards: RecommendationCardShellProps[] }) {
  const reduce = usePrefersReducedMotion();
  return (
    <section aria-labelledby="results-heading" className="space-y-4">
      <div className="space-y-2">
        <h2 id="results-heading" className="text-4xl font-extrabold">
          🏆 Your best matches
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <DemoSticker /> Design preview with invented data. Real ranking arrives in a later release.
        </p>
      </div>
      <ol className="space-y-5">
        {cards.map((card, i) => (
          <motion.li
            key={card.name}
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: reduce ? 0 : i * 0.15 }}
          >
            <RecommendationCardShell {...card} />
          </motion.li>
        ))}
      </ol>
    </section>
  );
}
