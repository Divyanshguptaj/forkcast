import { researchCounts } from "@/lib/agent/selectors";
import type { RunState, StageId } from "@/lib/agent/types";
import type { UserRequest } from "@/schemas/request";

export interface StageView {
  id: StageId;
  emoji: string;
  short: string;
  title: string;
  detail?: string;
}

export function requestSummaryParts(r: UserRequest | undefined): string[] {
  if (!r) return [];
  const parts = [r.city];
  if (r.meal !== "any") parts.push(r.meal[0].toUpperCase() + r.meal.slice(1));
  parts.push(...r.diet.map((d) => d.replace("_", "-")), ...r.cuisines);
  if (r.budget) parts.push(`under €${r.budget.max}`);
  return parts;
}

function requestSummary(state: RunState): string | undefined {
  const parts = requestSummaryParts(state.request);
  return parts.length ? parts.join(" · ") : undefined;
}

export function stageViews(state: RunState): StageView[] {
  const s = state.stages;
  const city = state.city ?? "your city";
  const found = state.discoveredCount;
  const counts = researchCounts(state);
  const lastTool = state.tools.at(-1);

  const views: StageView[] = [
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
      title: s.research === "done" ? "Research finished" : "Checking menus and reading dishes",
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
  if (state.status !== "error") return views;
  return views.map((v) => (s[v.id] === "active" ? { ...v, title: "Search stopped", detail: undefined } : v));
}
