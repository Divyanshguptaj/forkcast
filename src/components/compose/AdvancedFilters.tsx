"use client";

import { useState } from "react";
import { Chip } from "@/components/shared/Chip";
import { MUST_HAVE_OPTIONS, toggleIn, type ComposerState } from "./composerModel";

interface Props {
  state: ComposerState;
  onChange(patch: Partial<ComposerState>): void;
}

export function AdvancedFilters({ state, onChange }: Props) {
  const [draft, setDraft] = useState("");

  function addAllergy() {
    const value = draft.trim();
    if (value && !state.allergies.some((a) => a.toLowerCase() === value.toLowerCase())) {
      onChange({ allergies: [...state.allergies, value] });
    }
    setDraft("");
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">Allergies</legend>
        <p className="text-sm text-muted">Forkcast flags what menus say and don&apos;t say. It can&apos;t guarantee allergen safety.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Allergies added">
          {state.allergies.map((a) => (
            <Chip key={a} selected tone="tomato" aria-label={`Remove allergy ${a}`} onClick={() => onChange({ allergies: state.allergies.filter((v) => v !== a) })}>
              {a}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="allergy-add" className="sr-only">
            Add an allergy
          </label>
          <input
            id="allergy-add"
            value={draft}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAllergy();
              }
            }}
            placeholder="e.g. peanuts, shellfish"
            className="min-h-10 flex-1 rounded-control border-2 border-line bg-bg px-3 text-sm text-ink placeholder:text-muted/70 focus:border-saffron"
          />
          <button type="button" onClick={addAllergy} className="min-h-10 rounded-control border-2 border-line px-3 text-sm font-semibold text-muted hover:border-ink/60 hover:text-ink">
            Add
          </button>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">Nice to have</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Nice to have">
          {MUST_HAVE_OPTIONS.map((m) => (
            <Chip key={m} selected={state.mustHave.includes(m)} onClick={() => onChange({ mustHave: toggleIn(state.mustHave, m) })}>
              {m}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-1">
          <label htmlFor="party-size" className="text-sm font-semibold text-ink">
            Party size
          </label>
          <input
            id="party-size"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            value={state.partySize ?? ""}
            onChange={(e) => onChange({ partySize: e.target.value ? Math.min(50, Math.max(1, Number(e.target.value))) : null })}
            className="tabular min-h-10 w-20 rounded-control border-2 border-line bg-bg px-3 text-sm text-ink focus:border-saffron"
          />
        </div>
      </fieldset>
    </div>
  );
}
