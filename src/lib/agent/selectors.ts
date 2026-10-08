import { restaurantFinished } from "./reducer";
import { STEP_ORDER, type RestaurantPhase, type RestaurantResearch, type RunState, type StepStatus } from "./types";

const ACTIVE: readonly StepStatus[] = ["started", "progress"];

export function restaurantPhase(r: RestaurantResearch): RestaurantPhase {
  const touched = STEP_ORDER.some((s) => r.steps[s].status !== "idle") || r.menu.stages.length > 0 || r.menu.resolved !== undefined;
  if (!touched) return "waiting";

  if (restaurantFinished(r)) {
    const menuStatus = r.menu.resolved?.status;
    const unusableMenu = menuStatus === "unavailable" || menuStatus === "found_but_unreadable";
    if (r.steps.menu.status === "failed" && r.steps.reviews.status === "failed") return "failed";
    const anyWarning = STEP_ORDER.some((s) => r.steps[s].status === "warning" || r.steps[s].status === "failed");
    return unusableMenu || anyWarning ? "degraded" : "complete";
  }
  if (ACTIVE.includes(r.steps.reviews.status)) return "review_research";
  const reading =
    ACTIVE.includes(r.steps.translate.status) || ACTIVE.includes(r.steps.diet.status) || (r.menu.read !== undefined && r.menu.resolved === undefined);
  if (reading) return "menu_reading";
  const status = r.menu.resolved?.status;
  if (status === "found_but_unreadable") return "menu_unreadable";
  if (status === "unavailable") return "menu_unavailable";
  if (status === "found" || status === "partial") return "menu_found";
  return "researching";
}

export type RunNoticeKind = "no_results" | "places_unavailable" | "agent_timeout" | "partial_results" | "unexpected_error" | "request_problem" | "rate_limited" | "service_unavailable";

const REQUEST_CODES = new Set(["invalid_request", "invalid_json", "conflicting_request", "unsupported_city", "payload_too_large", "unsupported_media_type"]);
const RATE_CODES = new Set(["rate_limited", "already_running", "busy", "capacity"]);
const SERVICE_CODES = new Set(["not_configured", "network", "incomplete"]);

export function errorKind(code: string): "places_unavailable" | "timeout" | "request_problem" | "rate_limited" | "service_unavailable" | "unknown" {
  if (REQUEST_CODES.has(code)) return "request_problem";
  if (RATE_CODES.has(code)) return "rate_limited";
  if (SERVICE_CODES.has(code) || /^http_5/.test(code)) return "service_unavailable";
  if (code.startsWith("places_")) return "places_unavailable";
  if (code === "deadline" || code === "timeout" || code.endsWith("_timeout")) return "timeout";
  return "unknown";
}

export function runNotice(state: RunState): RunNoticeKind | undefined {
  if (state.discoveredCount === 0) return "no_results";
  if (state.status !== "error" || !state.error) return undefined;
  const kind = errorKind(state.error.code);
  const hasShortlist = state.shortlistOrder.length > 0;
  if (kind === "request_problem" || kind === "rate_limited" || kind === "service_unavailable") return kind;
  if (kind === "timeout") return hasShortlist ? "partial_results" : "agent_timeout";
  if (kind === "places_unavailable") return "places_unavailable";
  return hasShortlist ? "partial_results" : "unexpected_error";
}

export function researchCounts(state: RunState): { total: number; finished: number; waiting: number } {
  const all = state.shortlistOrder.map((id) => state.restaurants[id]);
  return {
    total: all.length,
    finished: all.filter((r) => restaurantFinished(r)).length,
    waiting: all.filter((r) => restaurantPhase(r) === "waiting").length,
  };
}

export function hasResearchEvents(state: RunState): boolean {
  return state.shortlistOrder.some((id) => restaurantPhase(state.restaurants[id]) !== "waiting");
}

export function isRunning(state: RunState): boolean {
  return state.status === "running";
}
