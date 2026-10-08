"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { cx } from "@/lib/cx";
import { AdvancedFilters } from "./AdvancedFilters";
import { BudgetPanel, CityPanel, CuisinePanel, DietPanel, MealPanel } from "./PreferencePanels";
import { DIET_OPTIONS, MEAL_OPTIONS, advancedCount, type ComposerState } from "./composerModel";

type PanelId = "city" | "meal" | "diet" | "cuisine" | "budget" | "more";

interface Props {
  state: ComposerState;
  onChange(patch: Partial<ComposerState>): void;
}

interface Trigger {
  id: PanelId;
  emoji: string;
  label: string;
  value: string;
  active: boolean;
}

function triggers(state: ComposerState): Trigger[] {
  const meal = MEAL_OPTIONS.find((m) => m.value === state.meal);
  const diets = state.diet.map((d) => DIET_OPTIONS.find((o) => o.value === d)?.label ?? d);
  const extra = advancedCount(state);
  return [
    { id: "city", emoji: "📍", label: "City", value: state.city, active: true },
    { id: "meal", emoji: meal?.emoji ?? "🍽️", label: "Meal", value: meal?.label ?? "Any meal", active: state.meal !== "any" },
    { id: "diet", emoji: "🌱", label: "Diet", value: diets.length ? diets.join(", ") : "No preference", active: diets.length > 0 },
    { id: "cuisine", emoji: "🍝", label: "Cuisine", value: state.cuisines.length ? state.cuisines.join(", ") : "Anything", active: state.cuisines.length > 0 },
    { id: "budget", emoji: "💶", label: "Budget", value: state.budgetMax === null ? "Any" : `Under €${state.budgetMax}`, active: state.budgetMax !== null },
    { id: "more", emoji: "＋", label: "More filters", value: extra ? `${extra} set` : "Allergies, extras", active: extra > 0 },
  ];
}

export function PreferenceChips({ state, onChange }: Props) {
  const [open, setOpen] = useState<PanelId | null>(null);
  const baseId = useId();

  return (
    <div>
      <ul className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" aria-label="Preferences">
        {triggers(state).map((t) => {
          const expanded = open === t.id;
          return (
            <li key={t.id} className="min-w-0 sm:flex-none">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`${baseId}-${t.id}`}
                onClick={() => setOpen(expanded ? null : t.id)}
                className={cx(
                  "flex min-h-14 w-full items-center gap-2.5 rounded-lg border-2 py-2 pl-0 pr-3 text-left transition-[transform,border-color,background-color] duration-150 ease-snap hover:-translate-y-px sm:w-auto",
                  expanded ? "border-ink bg-surface-2" : t.active ? "border-saffron/70 bg-surface" : "border-line bg-surface hover:border-ink/50",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx("flex min-h-10 w-10 shrink-0 items-center justify-center self-stretch border-r-2 border-dashed border-line text-lg leading-none", t.active ? "bg-saffron/20" : "bg-surface-2")}
                >
                  {t.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">{t.label}</span>
                  <span className="block max-w-40 truncate text-sm font-semibold text-ink sm:max-w-52">{t.value}</span>
                </span>
                <ChevronDown aria-hidden="true" className={cx("ml-auto size-4 shrink-0 text-muted transition-transform", expanded && "rotate-180")} />
              </button>
            </li>
          );
        })}
      </ul>

      {open ? (
        <motion.div
          key={open}
          id={`${baseId}-${open}`}
          role="region"
          aria-label={`${triggers(state).find((t) => t.id === open)?.label} options`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
          className="mt-3 rounded-card border-2 border-line bg-surface p-4"
        >
          {open === "city" && <CityPanel state={state} onChange={onChange} />}
          {open === "meal" && <MealPanel state={state} onChange={onChange} />}
          {open === "diet" && <DietPanel state={state} onChange={onChange} />}
          {open === "cuisine" && <CuisinePanel state={state} onChange={onChange} />}
          {open === "budget" && <BudgetPanel state={state} onChange={onChange} />}
          {open === "more" && <AdvancedFilters state={state} onChange={onChange} />}
        </motion.div>
      ) : null}
    </div>
  );
}
