"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";

interface Props {
  rotate: number;
  depth: number;
  className?: string;
  children: ReactNode;
}

export function Sticker({ rotate, depth, className, children }: Props) {
  const [wobble, setWobble] = useState(false);
  return (
    <span
      aria-hidden="true"
      className={cx("pointer-events-none absolute", className)}
      style={{ transform: `translate(calc(var(--px, 0) * ${depth}px), calc(var(--py, 0) * ${depth}px))` }}
    >
      <span
        className={cx("pointer-events-auto block drop-shadow-[4px_4px_0_var(--color-ink)]", wobble && "animate-[wobble_0.5s_ease-in-out]")}
        style={{ transform: `rotate(${rotate}deg)` }}
        onPointerEnter={() => setWobble(true)}
        onAnimationEnd={() => setWobble(false)}
      >
        {children}
      </span>
    </span>
  );
}
