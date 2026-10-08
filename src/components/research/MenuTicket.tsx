"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { DemoSticker } from "@/components/shared/Badge";
import { DishPreview } from "@/components/results/DishPreview";
import type { MenuItemPreview } from "@/schemas/menu";

interface Props {
  items: MenuItemPreview[];
  demo?: boolean;
  caption?: string;
}

export function MenuTicket({ items, demo = false, caption }: Props) {
  const reduce = usePrefersReducedMotion();
  if (items.length === 0) return null;
  return (
    <figure className="scallop-bottom relative mb-2 rounded-control border-2 border-ink bg-surface-2 px-4 pb-3 pt-3 shadow-soft">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-dashed border-line pb-2">
        <span className="font-display text-sm font-extrabold uppercase tracking-widest text-saffron">🧾 Menu ticket</span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {caption}
          {demo ? <DemoSticker /> : null}
        </span>
      </figcaption>
      <motion.ul
        initial={reduce ? false : "hidden"}
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.12 } } }}
      >
        {items.map((item) => (
          <motion.li
            key={item.originalName}
            variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
            transition={{ duration: 0.25 }}
            className="border-b border-dashed border-line py-3 last:border-b-0"
          >
            <DishPreview item={item} />
          </motion.li>
        ))}
      </motion.ul>
    </figure>
  );
}
