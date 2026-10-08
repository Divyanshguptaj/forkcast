"use client";

import { useRef } from "react";
import { usePointerParallax } from "@/hooks/usePointerParallax";
import { Chilli, Lemon, PizzaSlice, Tomato } from "./FoodArt";
import { Sticker } from "./Sticker";

export function HeroArt() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerParallax(ref);
  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible">
      <Sticker rotate={-14} depth={14} className="-top-3 right-2 sm:right-8 lg:right-24">
        <Tomato className="size-16 sm:size-24 lg:size-32" />
      </Sticker>
      <Sticker rotate={12} depth={-10} className="right-24 top-28 hidden sm:block lg:right-56 lg:top-36">
        <Lemon className="size-20 lg:size-24" />
      </Sticker>
      <Sticker rotate={-24} depth={18} className="right-2 top-40 hidden lg:block">
        <Chilli className="size-20" />
      </Sticker>
      <Sticker rotate={16} depth={-14} className="right-4 top-44 sm:hidden">
        <PizzaSlice className="size-14" />
      </Sticker>
    </div>
  );
}
