"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

const LINES = [
  "Reading menus so you don't have to.",
  "Investigating suspiciously good pasta...",
  "Doing important tomato research.",
];

export function PlayfulStatus() {
  const reduce = usePrefersReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((n) => (n + 1) % LINES.length), 4500);
    return () => clearInterval(id);
  }, [reduce]);
  return (
    <p aria-hidden="true" className="-rotate-1 font-hand text-2xl text-saffron">
      {LINES[i]}
    </p>
  );
}
