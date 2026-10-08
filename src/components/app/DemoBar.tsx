"use client";

import { cx } from "@/lib/cx";
import { SCENARIO_LIST, type ScenarioId } from "@/mocks/replay/scenarios";

export const SPEEDS = [
  { value: 1, label: "1×" },
  { value: 3, label: "3×" },
  { value: 0, label: "Instant" },
] as const;

interface Props {
  scenario: ScenarioId;
  speed: number;
  onScenario(id: ScenarioId): void;
  onSpeed(speed: number): void;
}

export function DemoBar({ scenario, speed, onScenario, onSpeed }: Props) {
  const active = SCENARIO_LIST.find((s) => s.id === scenario);
  return (
    <details className="group rounded-card border-2 border-dashed border-line bg-surface/80 p-3 text-sm" data-testid="demo-bar">
      <summary className="cursor-pointer list-none font-semibold text-muted hover:text-ink">
        <span aria-hidden="true">🎬 </span>
        Demo controls <span className="font-normal">· replaying: {active?.label}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted">This preview replays recorded events. Forkcast is not connected to live research yet.</p>
        <div role="radiogroup" aria-label="Replay scenario" className="flex flex-wrap gap-2">
          {SCENARIO_LIST.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={scenario === s.id}
              title={s.description}
              onClick={() => onScenario(s.id)}
              className={cx(
                "min-h-9 rounded-full border-2 px-3 text-xs font-semibold",
                scenario === s.id ? "border-saffron bg-saffron/15 text-ink" : "border-line text-muted hover:border-ink/60 hover:text-ink",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Replay speed" className="flex flex-wrap gap-2">
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={speed === s.value}
              onClick={() => onSpeed(s.value)}
              className={cx(
                "min-h-9 rounded-full border-2 px-3 text-xs font-semibold",
                speed === s.value ? "border-saffron bg-saffron/15 text-ink" : "border-line text-muted hover:border-ink/60 hover:text-ink",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}
