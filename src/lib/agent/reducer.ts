import type { AgentEvent } from "@/schemas/events";
import {
  STAGE_ORDER,
  STEP_ORDER,
  type OrphanEvent,
  type RestaurantResearch,
  type RunAction,
  type RunState,
  type StageId,
  type StageStatus,
  type StepId,
  type StepStatus,
} from "./types";

const MAX_TOOL_HISTORY = 12;
const STAGE_RANK: Record<StageStatus, number> = { pending: 0, active: 1, done: 2 };
const STEP_RANK: Record<StepStatus, number> = { idle: 0, started: 1, progress: 2, warning: 3, failed: 3, done: 4 };

export function createInitialRunState(): RunState {
  return {
    status: "idle",
    ended: false,
    seen: {},
    stages: { understand: "pending", search: "pending", shortlist: "pending", research: "pending", compare: "pending", ready: "pending" },
    placesCalls: 0,
    tools: [],
    shortlistOrder: [],
    restaurants: {},
    pending: {},
    reviewTerms: [],
    rankDone: false,
    explainDone: false,
  };
}

function createRestaurant(id: string, name: string): RestaurantResearch {
  const steps = Object.fromEntries(STEP_ORDER.map((s) => [s, { status: "idle" }])) as RestaurantResearch["steps"];
  return { id, name, steps, menu: { stages: [], items: [] } };
}

function setStage(stages: RunState["stages"], id: StageId, status: StageStatus): RunState["stages"] {
  if (STAGE_RANK[status] <= STAGE_RANK[stages[id]]) return stages;
  return { ...stages, [id]: status };
}

function finishEarlier(stages: RunState["stages"], upTo: StageId): RunState["stages"] {
  let next = stages;
  for (const id of STAGE_ORDER) {
    if (id === upTo) break;
    next = setStage(next, id, "done");
  }
  return next;
}

function advanceStep(current: RestaurantResearch["steps"][StepId], status: StepStatus, detail?: string) {
  if (STEP_RANK[status] < STEP_RANK[current.status]) return current;
  return { status, detail: detail ?? current.detail };
}

function applyRestaurantEvent(r: RestaurantResearch, event: OrphanEvent): RestaurantResearch {
  switch (event.type) {
    case "restaurant.step":
      return { ...r, steps: { ...r.steps, [event.step]: advanceStep(r.steps[event.step], event.status, event.detail) } };
    case "menu.stage": {
      const exists = r.menu.stages.some((s) => s.stage === event.stage);
      const stages = exists
        ? r.menu.stages.map((s) => (s.stage === event.stage ? { stage: event.stage, found: event.found, candidates: event.candidates } : s))
        : [...r.menu.stages, { stage: event.stage, found: event.found, candidates: event.candidates }];
      return { ...r, menu: { ...r.menu, stages } };
    }
    case "menu.read":
      return { ...r, menu: { ...r.menu, read: { format: event.format, languages: event.languages, usedVision: event.usedVision } } };
    case "menu.items":
      return { ...r, menu: { ...r.menu, items: event.items } };
    case "menu.resolved":
      return {
        ...r,
        menu: {
          ...r.menu,
          resolved: { status: event.status, documentCount: event.documentCount, officialMenuUrl: event.officialMenuUrl },
        },
      };
    case "reviews.read":
      return { ...r, reviews: { positive: event.positive, negative: event.negative, relevant: event.relevant } };
    case "tool":
      return { ...r, activity: event.label };
    default:
      return r;
  }
}

function withRestaurantEvent(state: RunState, event: OrphanEvent): RunState {
  const id = event.id;
  if (!id) return state;
  const existing = state.restaurants[id];
  if (!existing) {
    const queue = state.pending[id] ?? [];
    return { ...state, pending: { ...state.pending, [id]: [...queue, event] } };
  }
  return { ...state, restaurants: { ...state.restaurants, [id]: applyRestaurantEvent(existing, event) } };
}

function isTerminalStep(status: StepStatus): boolean {
  return status === "done" || status === "warning" || status === "failed";
}

export function restaurantFinished(r: RestaurantResearch): boolean {
  const resolved = r.menu.resolved;
  const menuSettled = isTerminalStep(r.steps.menu.status) || resolved?.status === "unavailable" || resolved?.status === "found_but_unreadable";
  const reviewsSettled = isTerminalStep(r.steps.reviews.status);
  return menuSettled && reviewsSettled;
}

function refreshResearchStages(state: RunState): RunState {
  const ids = state.shortlistOrder;
  if (ids.length === 0 || state.stages.shortlist !== "done") return state;
  const touched = ids.some((id) => STEP_ORDER.some((s) => state.restaurants[id].steps[s].status !== "idle"));
  let stages = state.stages;
  if (touched) stages = setStage(stages, "research", "active");
  if (touched && ids.every((id) => restaurantFinished(state.restaurants[id]))) {
    stages = setStage(setStage(stages, "research", "done"), "compare", "active");
  }
  return stages === state.stages ? state : { ...state, stages };
}

function handleEvent(state: RunState, event: AgentEvent): RunState {
  switch (event.type) {
    case "run.started":
      return { ...state, status: "running", stages: setStage(state.stages, "understand", "active") };
    case "understood":
      return {
        ...state,
        request: event.request,
        city: event.request.city,
        stages: setStage(setStage(state.stages, "understand", "done"), "search", "active"),
      };
    case "discover.started":
      return { ...state, city: event.city, stages: setStage(finishEarlier(state.stages, "search"), "search", "active") };
    case "discover.found":
      return {
        ...state,
        discoveredCount: event.count,
        stages: setStage(setStage(finishEarlier(state.stages, "search"), "search", "done"), "shortlist", event.count > 0 ? "active" : "pending"),
      };
    case "shortlist.done": {
      let next: RunState = state;
      const order: string[] = [];
      const restaurants = { ...state.restaurants };
      for (const item of event.restaurants) {
        order.push(item.id);
        const base = restaurants[item.id] ?? createRestaurant(item.id, item.name);
        restaurants[item.id] = {
          ...base,
          name: item.name,
          rating: item.rating,
          ratingCount: item.ratingCount,
          priceLevel: item.priceLevel,
          distanceKm: item.distanceKm,
          address: item.address,
          primaryType: item.primaryType,
          mapsUrl: item.mapsUrl,
        };
      }
      next = {
        ...state,
        shortlistOrder: order,
        restaurants,
        stages: setStage(setStage(finishEarlier(state.stages, "shortlist"), "shortlist", "done"), "research", "pending"),
      };
      for (const id of order) {
        const queued = next.pending[id];
        if (!queued) continue;
        const { [id]: _drop, ...rest } = next.pending;
        void _drop;
        next = { ...next, pending: rest };
        for (const e of queued) next = withRestaurantEvent(next, e);
      }
      return refreshResearchStages(next);
    }
    case "restaurant.step":
    case "menu.stage":
    case "menu.read":
    case "menu.items":
    case "menu.resolved":
    case "reviews.read":
      return refreshResearchStages(withRestaurantEvent(state, event));
    case "reviews.terms":
      return { ...state, reviewTerms: event.terms };
    case "tool": {
      const activity = { seq: event.seq, name: event.name, label: event.label, restaurantId: event.id };
      const tools = [...state.tools, activity].slice(-MAX_TOOL_HISTORY);
      const placesCalls = state.placesCalls + (event.name === "places" ? 1 : 0);
      const next = { ...state, tools, placesCalls };
      return event.id ? withRestaurantEvent(next, event) : next;
    }
    case "rank.done":
      return { ...state, rankDone: true, stages: setStage(setStage(finishEarlier(state.stages, "compare"), "compare", "done"), "ready", "active") };
    case "explain.done":
      return { ...state, explainDone: true, stages: setStage(finishEarlier(state.stages, "ready"), "ready", "done") };
    case "result":
      return { ...state, result: event.payload, stages: setStage(finishEarlier(state.stages, "ready"), "ready", "done") };
    case "error":
      return { ...state, status: "error", error: { code: event.code, message: event.message, recoverable: event.recoverable } };
  }
}

export function agentReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "reset":
      return createInitialRunState();
    case "source.ended": {
      if (state.status === "running") {
        return { ...state, ended: true, status: "complete" };
      }
      return { ...state, ended: true };
    }
    case "event": {
      const { event } = action;
      if (event.type === "run.started" && state.runId !== event.runId) {
        const fresh = { ...createInitialRunState(), runId: event.runId };
        return handleEvent({ ...fresh, seen: { [event.seq]: true } }, event);
      }
      if (state.runId === undefined) {
        return handleEvent({ ...state, runId: event.runId, seen: { ...state.seen, [event.seq]: true } }, event);
      }
      if (event.runId !== state.runId) return state;
      if (state.seen[event.seq]) return state;
      return handleEvent({ ...state, seen: { ...state.seen, [event.seq]: true } }, event);
    }
  }
}
