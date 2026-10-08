import type { ScoreComponent } from "@/schemas/recommendations";

export function ScoreBreakdown({ components, score }: { components: ScoreComponent[]; score: number }) {
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer list-none font-semibold text-muted hover:text-ink">
        <span className="underline decoration-line underline-offset-4 group-open:decoration-saffron">How the score of {score} is built</span>
      </summary>
      <ul className="mt-2 space-y-2">
        {components.map((c) => (
          <li key={c.key} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-ink">{c.label}</span>
              <span className="tabular text-xs text-muted">
                {c.value === null ? "n/a" : c.value.toFixed(2)} × {Math.round(c.weight * 100)}% = {c.contribution.toFixed(1)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div className="h-full rounded-full bg-basil" style={{ width: `${Math.round((c.value ?? 0) * 100)}%` }} />
            </div>
            <p className="text-xs text-muted">{c.note}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Restaurants are ordered by match category first (confirmed matches always come before ones that need checking), then by score.</p>
    </details>
  );
}
