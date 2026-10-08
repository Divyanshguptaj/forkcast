"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/shared/Button";
import type { RecommendRequestBodyType } from "@/schemas/request";
import { ExampleQueries } from "./ExampleQueries";
import { PreferenceChips } from "./PreferenceChips";
import { DEFAULT_COMPOSER, hasRequest, toRecommendBody, type ComposerState, type ExampleQuery } from "./composerModel";

interface Props {
  initial?: Partial<ComposerState>;
  busy?: boolean;
  allowEmpty?: boolean;
  submitLabel?: string;
  onSubmit(body: RecommendRequestBodyType, state: ComposerState): void;
}

const PLACEHOLDER = "I'm in Barcelona and want vegetarian Italian food for dinner under €30. Somewhere not too crowded.";

export function SearchComposer({ initial, busy = false, allowEmpty = false, submitLabel = "Find my table", onSubmit }: Props) {
  const [state, setState] = useState<ComposerState>({ ...DEFAULT_COMPOSER, ...initial });

  const [problem, setProblem] = useState<string | undefined>();
  const textRef = useRef<HTMLTextAreaElement>(null);

  const patch = (p: Partial<ComposerState>) => {
    setProblem(undefined);
    setState((s) => ({ ...s, ...p }));
  };

  function pick(example: ExampleQuery) {
    setState((s) => ({ ...s, ...example.patch, text: example.text }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!allowEmpty && !hasRequest(state)) {
      setProblem("Describe what you are hungry for, or choose at least a meal, diet, cuisine or budget.");
      textRef.current?.focus();
      return;
    }
    onSubmit(toRecommendBody(state), state);
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-label="Describe what you're hungry for">
      <div className="relative rounded-card border-2 border-ink bg-surface p-3 shadow-pop sm:p-4">
        <div aria-hidden="true" className="tabular mb-2 flex justify-between border-b-2 border-dashed border-line pb-2 text-[11px] uppercase tracking-[0.14em] text-muted">
          <span>Order no. 042</span>
          <span>Table for 1 · Barcelona</span>
        </div>
        <label htmlFor="craving" className="sr-only">
          What are you hungry for?
        </label>
        <textarea
          ref={textRef}
          id="craving"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "craving-problem" : "craving-help"}
          rows={3}
          value={state.text}
          maxLength={1000}
          onChange={(e) => patch({ text: e.target.value })}
          placeholder={PLACEHOLDER}
          className="block w-full resize-none bg-transparent font-display text-xl leading-snug text-ink placeholder:text-muted/60 focus:outline-none sm:text-2xl"
        />
        <div className="mt-3 flex flex-col-reverse items-stretch gap-3 border-t-2 border-dashed border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p id="craving-help" className="text-xs text-muted">
            Write it the way you would say it. The filters below are optional and add to your sentence.
          </p>
          <Button type="submit" disabled={busy} className="min-h-14 -rotate-1 px-7 text-lg shadow-pop hover:-rotate-2 sm:shrink-0">
            <Search aria-hidden="true" className="size-5" />
            {submitLabel}
            <ArrowRight aria-hidden="true" className="size-5" />
          </Button>
        </div>
      </div>

      {problem ? (
        <p id="craving-problem" role="alert" className="rounded-control border-2 border-chili/60 bg-chili/8 px-3 py-2 text-sm text-ink">
          {problem}
        </p>
      ) : null}

      <PreferenceChips state={state} onChange={patch} />
      <ExampleQueries onPick={pick} />
    </form>
  );
}
