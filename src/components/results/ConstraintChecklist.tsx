import { Check, CircleHelp, X } from "lucide-react";
import { cx } from "@/lib/cx";
import type { ConstraintOutcome } from "@/schemas/recommendations";

const VERDICT = {
  met: { Icon: Check, label: "Confirmed", className: "text-basil" },
  uncertain: { Icon: CircleHelp, label: "Not confirmed", className: "text-saffron" },
  unmet: { Icon: X, label: "Not met", className: "text-chili" },
} as const;

export function ConstraintChecklist({ outcomes }: { outcomes: ConstraintOutcome[] }) {
  if (outcomes.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {outcomes.map((o) => {
        const v = VERDICT[o.verdict];
        return (
          <li key={o.constraintId} className="flex gap-2 text-sm">
            <v.Icon aria-hidden="true" className={cx("mt-0.5 size-4 shrink-0 stroke-[3]", v.className)} />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold text-ink">{o.label}</span>
              <span className="sr-only"> ({v.label})</span>
              <span className="text-muted"> — {o.note}</span>
              {o.strength === "soft" ? <span className="text-muted"> (preference)</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
