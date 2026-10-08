"use client";

import { useState } from "react";
import { Chip } from "@/components/shared/Chip";
import { cx } from "@/lib/cx";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  CITY_OPTIONS,
  CUISINE_OPTIONS,
  DIET_OPTIONS,
  MEAL_OPTIONS,
  toggleIn,
  type ComposerState,
} from "./composerModel";

interface PanelProps {
  state: ComposerState;
  onChange(patch: Partial<ComposerState>): void;
}

export function CityPanel({ state, onChange }: PanelProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="City">
      {CITY_OPTIONS.map((city) => (
        <Chip key={city} emoji="📍" selected={state.city === city} tone="tomato" onClick={() => onChange({ city })}>
          {city}
        </Chip>
      ))}
      <span className="self-center text-sm text-muted">More European cities are on the way.</span>
    </div>
  );
}

export function MealPanel({ state, onChange }: PanelProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Meal">
      {MEAL_OPTIONS.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={state.meal === m.value}
          onClick={() => onChange({ meal: m.value })}
          className={cx(
            "inline-flex min-h-10 items-center gap-2 rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition-[transform,border-color,background-color] duration-150 ease-snap hover:-translate-y-px active:scale-95",
            state.meal === m.value ? "border-saffron bg-saffron/15 text-ink" : "border-line bg-surface text-muted hover:border-ink/60 hover:text-ink",
          )}
        >
          <span aria-hidden="true">{m.emoji}</span>
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function DietPanel({ state, onChange }: PanelProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Dietary preferences">
      {DIET_OPTIONS.map((d) => (
        <Chip
          key={d.value}
          emoji={d.emoji}
          tone="basil"
          selected={state.diet.includes(d.value)}
          onClick={() => onChange({ diet: toggleIn(state.diet, d.value) })}
        >
          {d.label}
        </Chip>
      ))}
    </div>
  );
}

export function CuisinePanel({ state, onChange }: PanelProps) {
  const [draft, setDraft] = useState("");
  const custom = state.cuisines.filter((c) => !CUISINE_OPTIONS.some((o) => o.value === c));

  function addCustom() {
    const value = draft.trim();
    if (!value || state.cuisines.some((c) => c.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange({ cuisines: [...state.cuisines, value] });
    setDraft("");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Cuisines">
        {CUISINE_OPTIONS.map((c) => (
          <Chip key={c.value} emoji={c.emoji} selected={state.cuisines.includes(c.value)} onClick={() => onChange({ cuisines: toggleIn(state.cuisines, c.value) })}>
            {c.value}
          </Chip>
        ))}
        {custom.map((c) => (
          <Chip key={c} selected onClick={() => onChange({ cuisines: state.cuisines.filter((v) => v !== c) })} aria-label={`Remove ${c}`}>
            {c}
          </Chip>
        ))}
      </div>
      <div className="flex gap-2">
        <label htmlFor="cuisine-add" className="sr-only">
          Add another cuisine
        </label>
        <input
          id="cuisine-add"
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Something else? e.g. Peruvian"
          className="min-h-10 flex-1 rounded-control border-2 border-line bg-bg px-3 text-sm text-ink placeholder:text-muted/70 focus:border-saffron"
        />
        <button type="button" onClick={addCustom} className="min-h-10 rounded-control border-2 border-line px-3 text-sm font-semibold text-muted hover:border-ink/60 hover:text-ink">
          Add
        </button>
      </div>
    </div>
  );
}

export function BudgetPanel({ state, onChange }: PanelProps) {
  const any = state.budgetMax === null;
  const value = state.budgetMax ?? 30;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Chip selected={any} tone="tomato" onClick={() => onChange({ budgetMax: any ? 30 : null })}>
          Any budget
        </Chip>
        <p className="tabular text-lg font-bold text-ink" aria-live="polite">
          {any ? "No limit" : `Under €${value} per person`}
        </p>
      </div>
      <div className={cx("transition-opacity", any && "opacity-40")}>
        <label htmlFor="budget-range" className="sr-only">
          Maximum budget per person in euros
        </label>
        <input
          id="budget-range"
          type="range"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={5}
          value={value}
          disabled={any}
          onChange={(e) => onChange({ budgetMax: Number(e.target.value) })}
          className="h-2 w-full cursor-pointer accent-tomato disabled:cursor-not-allowed"
        />
        <div className="tabular mt-1 flex justify-between text-xs text-muted">
          <span>€{BUDGET_MIN}</span>
          <span>€{BUDGET_MAX}+</span>
        </div>
      </div>
    </div>
  );
}
