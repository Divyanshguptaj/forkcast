import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";

type Tone = "tomato" | "saffron" | "basil";

const SELECTED: Record<Tone, string> = {
  tomato: "border-tomato bg-tomato/15 text-ink",
  saffron: "border-saffron bg-saffron/15 text-ink",
  basil: "border-basil bg-basil/15 text-ink",
};

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  selected?: boolean;
  tone?: Tone;
  emoji?: string;
  children: ReactNode;
}

export function Chip({ selected = false, tone = "saffron", emoji, className, children, type = "button", ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        "inline-flex min-h-10 items-center gap-2 rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-[transform,background-color,border-color] duration-150 ease-snap",
        "hover:-translate-y-px active:scale-95",
        selected ? SELECTED[tone] : "border-line bg-surface text-muted hover:border-ink/60 hover:text-ink",
        className,
      )}
      {...rest}
    >
      {emoji ? (
        <span aria-hidden="true" className="text-base leading-none">
          {emoji}
        </span>
      ) : null}
      <span>{children}</span>
      {selected ? (
        <span aria-hidden="true" className="text-xs text-ink/80">
          ✓
        </span>
      ) : null}
    </button>
  );
}
