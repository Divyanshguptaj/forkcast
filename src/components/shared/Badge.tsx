import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";

export type BadgeTone = "neutral" | "basil" | "saffron" | "tomato" | "chili" | "ink";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-2 text-muted",
  basil: "border-basil/60 bg-basil/12 text-basil",
  saffron: "border-saffron/60 bg-saffron/12 text-saffron",
  tomato: "border-tomato/60 bg-tomato/12 text-tomato",
  chili: "border-chili/60 bg-chili/12 text-chili",
  ink: "border-ink bg-ink text-bg",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
}

export function Badge({ tone = "neutral", icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

export function DemoSticker({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex -rotate-2 items-center rounded-md border-2 border-bg bg-saffron px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-bg",
        className,
      )}
    >
      Demo data
    </span>
  );
}
