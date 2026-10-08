"use client";

import { EXAMPLE_QUERIES, type ExampleQuery } from "./composerModel";

interface Props {
  onPick(example: ExampleQuery): void;
}

export function ExampleQueries({ onPick }: Props) {
  return (
    <div>
      <p className="text-sm font-semibold text-muted">Need an idea? Tap one to fill the sentence and the filters.</p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-4">
        {EXAMPLE_QUERIES.map((ex, i) => (
          <li key={ex.id} className={i % 2 ? "rotate-1" : "-rotate-1"}>
            <button
              type="button"
              onClick={() => onPick(ex)}
              className="group relative inline-flex min-h-11 items-center gap-2 rounded-[4px] bg-paper px-3.5 py-2 text-left font-hand text-xl leading-tight text-paper-ink shadow-[3px_3px_0_rgb(0_0_0/0.55)] transition-transform duration-150 ease-snap hover:-translate-y-0.5 hover:rotate-0 active:translate-y-0.5 active:shadow-none"
            >
              <span aria-hidden="true" className="transition-transform duration-150 group-hover:rotate-12">
                {ex.emoji}
              </span>
              {ex.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
