import { AlertTriangle, Check, X } from "lucide-react";
import { cx } from "@/lib/cx";
import { STEP_ORDER, type RestaurantResearch, type StepId, type StepStatus } from "@/lib/agent/types";

const LABELS: Record<StepId, string> = {
  details: "Details",
  menu: "Menu",
  translate: "Translate",
  diet: "Diet",
  reviews: "Diners",
};

const STATUS_WORD: Record<StepStatus, string> = {
  idle: "waiting",
  started: "in progress",
  progress: "in progress",
  done: "done",
  warning: "needs a look",
  failed: "failed",
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <Check aria-hidden="true" className="size-3.5 stroke-[3]" />;
  if (status === "warning") return <AlertTriangle aria-hidden="true" className="size-3.5" />;
  if (status === "failed") return <X aria-hidden="true" className="size-3.5 stroke-[3]" />;
  if (status === "idle") return <span aria-hidden="true" className="size-2 rounded-full border-2 border-current" />;
  return <span aria-hidden="true" className="pulse-ring size-2.5 rounded-full bg-saffron" />;
}

const TONES: Record<StepStatus, string> = {
  idle: "border-line text-muted/70",
  started: "border-saffron text-ink",
  progress: "border-saffron text-ink",
  done: "border-basil/70 text-basil",
  warning: "border-saffron/70 text-saffron",
  failed: "border-chili/70 text-chili",
};

export function PipelineChips({ steps }: { steps: RestaurantResearch["steps"] }) {
  const hidden = (id: StepId) => id === "reviews" && steps.reviews.status === "done" && steps.reviews.detail === "skipped";
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Research steps">
      {STEP_ORDER.filter((id) => !hidden(id)).map((id) => {
        const s = steps[id];
        return (
          <li
            key={id}
            title={s.detail}
            className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors duration-300", TONES[s.status])}
          >
            <StepIcon status={s.status} />
            {LABELS[id]}
            <span className="sr-only">: {STATUS_WORD[s.status]}</span>
          </li>
        );
      })}
    </ul>
  );
}
