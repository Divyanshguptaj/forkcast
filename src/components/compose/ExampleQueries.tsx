"use client";

import { EXAMPLE_QUERIES, type ExampleQuery } from "./composerModel";

interface Props {
  onPick(example: ExampleQuery): void;
}

export function ExampleQueries({ onPick }: Props) {
  return (
    <div>
      <p className="text-sm font-semibold text-muted">Need an idea? Tap one to fill the sentence and the filters.</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {EXAMPLE_QUERIES.map((ex) => (
          <li key={ex.id}>
            <button
              type="button"
              onClick={() => onPick(ex)}
              className="group inline-flex min-h-10 items-center gap-2 rounded-full border-2 border-dashed border-line px-3.5 py-1.5 text-left text-sm text-muted transition-[border-color,color,transform] duration-150 ease-snap hover:-translate-y-px hover:border-saffron hover:text-ink"
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
