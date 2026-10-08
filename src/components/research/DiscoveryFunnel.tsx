"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { CountUp } from "@/components/shared/CountUp";
import { cx } from "@/lib/cx";

interface Props {
  discovered: number;
  shortlisted: number;
}

const MAX_DOTS = 60;

function pickedIndexes(total: number, picked: number): Set<number> {
  const set = new Set<number>();
  if (picked <= 0 || total <= 0) return set;
  const step = total / Math.min(picked, total);
  for (let i = 0; i < Math.min(picked, total); i++) set.add(Math.floor(i * step + step / 2));
  return set;
}

export function DiscoveryFunnel({ discovered, shortlisted }: Props) {
  const reduce = usePrefersReducedMotion();
  const shown = Math.min(discovered, MAX_DOTS);
  const picked = pickedIndexes(shown, shortlisted);

  if (discovered === 0) return null;

  return (
    <section aria-label="Discovery summary" className="rounded-card border-2 border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-display text-3xl font-extrabold text-ink">
          <CountUp value={discovered} /> <span className="text-xl font-bold text-muted">places discovered</span>
        </p>
        {shortlisted > 0 ? (
          <motion.p initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="font-display text-2xl font-extrabold text-tomato">
            → {shortlisted} <span className="text-sm font-bold text-saffron">made the shortlist</span>
          </motion.p>
        ) : (
          <p className="text-sm text-muted">Comparing the promising ones…</p>
        )}
      </div>
      <ul aria-hidden="true" className="mt-4 flex flex-wrap gap-1.5">
        {Array.from({ length: shown }, (_, i) => {
          const isPicked = picked.has(i);
          return (
            <motion.li
              key={i}
              initial={reduce ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: isPicked ? 1.25 : 1, opacity: 1 }}
              transition={{ delay: reduce ? 0 : Math.min(i * 0.012, 0.6), type: "spring", stiffness: 420, damping: 20 }}
              className={cx("size-3 rounded-full transition-colors duration-500", isPicked ? "bg-saffron shadow-[0_0_0_2px_var(--color-bg),0_0_0_4px_var(--color-saffron)]" : "bg-line")}
            />
          );
        })}
      </ul>
      <p className="sr-only">
        {discovered} places discovered{shortlisted > 0 ? `, ${shortlisted} shortlisted` : ""}.
      </p>
    </section>
  );
}
