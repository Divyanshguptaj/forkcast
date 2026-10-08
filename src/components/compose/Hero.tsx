import { HeroArt } from "@/components/art/HeroArt";
import { Squiggle } from "@/components/art/FoodArt";

export function Hero() {
  return (
    <header className="relative space-y-4">
      <HeroArt />
      <p className="relative inline-flex items-center gap-2 rounded-full border-2 border-line bg-surface px-3 py-1 text-sm font-semibold text-muted">
        <span aria-hidden="true">🍴</span> Forkcast <span className="text-line" aria-hidden="true">/</span> Barcelona first
      </p>
      <h1 className="relative text-balance text-5xl font-extrabold leading-[0.98] tracking-tight sm:text-7xl lg:text-8xl">
        Tell us what you&apos;re{" "}
        <span className="mx-1 inline-block -rotate-2 rounded-control bg-tomato px-3 pb-1 text-bg shadow-pop-sm sm:px-4">hungry</span> for.
        <Squiggle className="mt-2 block h-3 w-28 sm:w-40" />
      </h1>
      <p className="relative max-w-2xl text-pretty text-lg text-muted sm:text-xl">
        Forkcast researches real restaurants, reads their menus dish by dish, then shows you which places truly fit and why.
      </p>
      <ol className="relative flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm font-semibold text-ink" aria-label="How it works">
        <li>
          <span aria-hidden="true">📍 </span>Search
        </li>
        <li>
          <span aria-hidden="true">📖 </span>Read menus
        </li>
        <li>
          <span aria-hidden="true">🥗 </span>Match your diet
        </li>
        <li>
          <span aria-hidden="true">🏆 </span>Rank
        </li>
      </ol>
    </header>
  );
}
