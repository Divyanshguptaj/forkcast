import { StatusNotice } from "@/components/states/StatusNotice";
import type { RestaurantResearch } from "@/lib/agent/types";

interface Props {
  restaurant: RestaurantResearch;
  terms: string[];
}

export function ReviewResearchState({ restaurant: r, terms }: Props) {
  const status = r.steps.reviews.status;
  if (status === "idle") return null;
  if (status === "failed") return <StatusNotice kind="reviews_unavailable" compact />;

  const searching = status === "started" || status === "progress";
  return (
    <div className="space-y-2">
      {searching && terms.length > 0 ? (
        <p className="text-sm text-muted">
          <span aria-hidden="true">🔎 </span>
          Looking for comments about{" "}
          {terms.map((t, i) => (
            <span key={t}>
              <strong className="font-semibold text-ink">{t}</strong>
              {i < terms.length - 1 ? " · " : ""}
            </span>
          ))}
        </p>
      ) : null}
      {searching && terms.length === 0 ? <p className="text-sm text-muted">💬 Checking what diners say…</p> : null}
      {r.reviews ? (
        <p className="text-sm text-ink">
          <span aria-hidden="true">💬 </span>
          <strong>{r.reviews.positive}</strong> praise · <strong>{r.reviews.negative}</strong> critical ·{" "}
          <strong>{r.reviews.relevant}</strong> about what you asked for
        </p>
      ) : null}
    </div>
  );
}
