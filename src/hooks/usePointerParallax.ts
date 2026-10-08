"use client";

import { useEffect, type RefObject } from "react";

const FINE_HOVER = "(hover: hover) and (pointer: fine)";
const REDUCED = "(prefers-reduced-motion: reduce)";

export function usePointerParallax(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia(FINE_HOVER).matches || window.matchMedia(REDUCED).matches) return;

    let frame = 0;
    let nx = 0;
    let ny = 0;
    const apply = () => {
      frame = 0;
      el.style.setProperty("--px", nx.toFixed(3));
      el.style.setProperty("--py", ny.toFixed(3));
    };
    const onMove = (e: PointerEvent) => {
      nx = (e.clientX / window.innerWidth) * 2 - 1;
      ny = (e.clientY / window.innerHeight) * 2 - 1;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
