"use client";

import { animate } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useEffect, useState } from "react";

interface Props {
  value: number;
  className?: string;
}

export function CountUp({ value, className }: Props) {
  const reduce = usePrefersReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const controls = animate(0, value, { duration: 0.8, ease: "easeOut", onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [value, reduce]);

  return <span className={className}>{reduce ? value : shown}</span>;
}
