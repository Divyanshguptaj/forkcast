"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/shared/Button";
import type { RecommendRequestBodyType } from "@/schemas/request";
import { ExampleQueries } from "./ExampleQueries";
import { PreferenceChips } from "./PreferenceChips";
import { DEFAULT_COMPOSER, toRecommendBody, type ComposerState, type ExampleQuery } from "./composerModel";

interface Props {
  initial?: Partial<ComposerState>;
  busy?: boolean;
  submitLabel?: string;
  onSubmit(body: RecommendRequestBodyType, state: ComposerState): void;
}

const PLACEHOLDER = "I'm in Barcelona and want vegetarian Italian food for dinner under €30. Somewhere not too crowded.";

export function SearchComposer({ initial, busy = false, submitLabel = "Find my table", onSubmit }: Props) {
  const [state, setState] = useState<ComposerState>({ ...DEFAULT_COMPOSER, ...initial });

  const patch = (p: Partial<ComposerState>) => setState((s) => ({ ...s, ...p }));

  function pick(example: ExampleQuery) {
    setState((s) => ({ ...s, ...example.patch, text: example.text }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    onSubmit(toRecommendBody(state), state);
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-label="Describe what you're hungry for">
      <div className="rounded-card border-2 border-ink bg-surface p-3 shadow-pop sm:p-4">
        <label htmlFor="craving" className="sr-only">
          What are you hungry for?
        </label>
        <textarea
          id="craving"
          rows={3}
          value={state.text}
          maxLength={1000}
          onChange={(e) => patch({ text: e.target.value })}
          placeholder={PLACEHOLDER}
          className="block w-full resize-none bg-transparent font-display text-xl leading-snug text-ink placeholder:text-muted/60 focus:outline-none sm:text-2xl"
        />
        <div className="mt-3 flex flex-col-reverse items-stretch gap-3 border-t-2 border-dashed border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            Preview build: Forkcast reads the filters below. Understanding free-text sentences comes in a later release.
          </p>
          <Button type="submit" disabled={busy} className="sm:shrink-0">
            <Search aria-hidden="true" className="size-5" />
            {submitLabel}
          </Button>
        </div>
      </div>

      <PreferenceChips state={state} onChange={patch} />
      <ExampleQueries onPick={pick} />
    </form>
  );
}
