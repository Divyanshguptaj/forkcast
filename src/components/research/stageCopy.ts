import { researchCounts } from "@/lib/agent/selectors";
import type { RunState, StageId } from "@/lib/agent/types";

export interface StageView {
  id: StageId;
  emoji: string;
  short: string;
  title: string;
  detail?: string;
}

function requestSummary(state: RunState): string | undefined {
  const r = state.request;
  if (!r) return undefined;
  const parts = [r.city];
  if (r.meal !== "any") parts.push(r.meal[0].toUpperCase() + r.meal.slice(1));
  parts.push(...r.diet.map((d) => d.replace("_", "-")), ...r.cuisines);
  if (r.budget) parts.push(`under €${r.budget.max}`);
  return parts.join(" · ");
}

export function stageViews(state: RunState): StageView[] {
  const s = state.stages;
  const city = state.city ?? "your city";
  const found = state.discoveredCount;
  const counts = researchCounts(state);
  const lastTool = state.tools.at(-1);

  return [
    {
      id: "understand",
      emoji: "🧠",
      short: "Understand",
      title: s.understand === "done" ? "Request understood" : "Understanding your request",
      detail: requestSummary(state),
    },
    {
      id: "search",
      emoji: "📍",
      short: "Search",
      title: s.search === "done" ? `Searched ${city}` : `Searching ${city}`,
      detail: found !== undefined ? `${found} restaurant${found === 1 ? "" : "s"} found` : s.search === "active" ? lastTool?.label : undefined,
    },
    {
      id: "shortlist",
      emoji: "✨",
      short: "Shortlist",
      title: s.shortlist === "done" ? "Shortlist ready" : "Shortlisting promising matches",
      detail: s.shortlist === "done" && found !== undefined ? `${found} → ${state.shortlistOrder.length} restaurants` : undefined,
    },
    {
      id: "research",
      emoji: "🍽️",
      short: "Research",
      title: s.research === "done" ? "Research finished" : "Researching menus and diners",
      detail:
        s.research === "pending" && s.shortlist === "done"
          ? "Waiting for menu research"
          : counts.total > 0 && s.research !== "pending"
            ? `${counts.finished} of ${counts.total} restaurants done`
            : undefined,
    },
    {
      id: "compare",
      emoji: "⚖️",
      short: "Compare",
      title: s.compare === "done" ? "Finalists compared" : "Comparing the finalists",
    },
    {
      id: "ready",
      emoji: "🏆",
      short: "Ready",
      title: s.ready === "done" ? "Recommendations ready" : "Preparing recommendations",
    },
  ];
}
