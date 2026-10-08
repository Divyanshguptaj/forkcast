import type { AgentEvent } from "@/schemas/events";
import type { MenuItemPreview } from "@/schemas/menu";
import type { RecommendationResponse } from "@/schemas/recommendation";
import type { UserRequest } from "@/schemas/request";

export const STAGE_ORDER = ["understand", "search", "shortlist", "research", "compare", "ready"] as const;
export type StageId = (typeof STAGE_ORDER)[number];
export type StageStatus = "pending" | "active" | "done";

export type StepId = "details" | "menu" | "translate" | "diet" | "reviews";
export const STEP_ORDER: readonly StepId[] = ["details", "menu", "translate", "diet", "reviews"];
export type StepStatus = "idle" | "started" | "progress" | "done" | "warning" | "failed";

export interface StepState {
  status: StepStatus;
  detail?: string;
}

export interface MenuStageNote {
  stage: "site" | "search" | "assets" | "third_party";
  found: boolean;
  candidates: number;
}

export interface MenuResolution {
  status: "found" | "partial" | "found_but_unreadable" | "unavailable";
  documentCount: number;
  officialMenuUrl?: string;
}

export interface RestaurantResearch {
  id: string;
  name: string;
  rating?: number;
  ratingCount?: number;
  priceLevel?: number;
  distanceKm?: number;
  address?: string;
  primaryType?: string;
  mapsUrl?: string;
  steps: Record<StepId, StepState>;
  menu: {
    stages: MenuStageNote[];
    read?: { format: string; languages: string[]; usedVision: boolean };
    items: MenuItemPreview[];
    resolved?: MenuResolution;
  };
  reviews?: { positive: number; negative: number; relevant: number };
  activity?: string;
}

export type RestaurantPhase =
  | "waiting"
  | "researching"
  | "menu_found"
  | "menu_reading"
  | "menu_unreadable"
  | "menu_unavailable"
  | "review_research"
  | "complete"
  | "degraded"
  | "failed";

export interface ToolActivity {
  seq: number;
  name: "places" | "web_search" | "web_extract" | "fetch" | "gemini" | "vision";
  label: string;
  restaurantId?: string;
}

export interface RunError {
  code: string;
  message: string;
  recoverable: boolean;
}

export type OrphanEvent = Extract<
  AgentEvent,
  { type: "restaurant.step" | "menu.stage" | "menu.read" | "menu.items" | "menu.resolved" | "reviews.read" | "tool" }
>;

export interface RunState {
  runId?: string;
  status: "idle" | "running" | "complete" | "error";
  ended: boolean;
  seen: Record<number, true>;
  stages: Record<StageId, StageStatus>;
  request?: UserRequest;
  city?: string;
  discoveredCount?: number;
  placesCalls: number;
  tools: ToolActivity[];
  shortlistOrder: string[];
  restaurants: Record<string, RestaurantResearch>;
  pending: Record<string, OrphanEvent[]>;
  reviewTerms: string[];
  rankDone: boolean;
  explainDone: boolean;
  result?: RecommendationResponse;
  error?: RunError;
}

export type RunAction = { type: "event"; event: AgentEvent } | { type: "source.ended" } | { type: "reset" };
