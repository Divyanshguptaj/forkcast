import type { ResolverDocumentKindValue } from "@/schemas/menuResolution";
import { isSelectable, type Candidate, type CandidateTable } from "./candidateTable";
import { MENU_LIKELIHOOD_THRESHOLD } from "./classify";

export interface AmbiguousCandidate {
  id: string;
  restaurantName: string;
  url: string;
  anchorText: string;
  mediaType: string;
  signals: string[];
}

export type AmbiguityDecisions = Record<string, ResolverDocumentKindValue>;

export type AmbiguityClassifier = (batch: AmbiguousCandidate[]) => Promise<AmbiguityDecisions>;

export const AMBIGUOUS_RANGE = { min: 0.35, max: MENU_LIKELIHOOD_THRESHOLD } as const;

export function findAmbiguous(table: CandidateTable): Candidate[] {
  return table
    .all()
    .filter((c) => !c.rejectedReason && !isSelectable(c) && c.likelihood >= AMBIGUOUS_RANGE.min && c.likelihood < AMBIGUOUS_RANGE.max && (c.kind === "unknown" || c.kind === "food_menu"));
}

export function applyAmbiguityDecisions(table: CandidateTable, decisions: AmbiguityDecisions): number {
  let applied = 0;
  for (const [id, kind] of Object.entries(decisions)) {
    const candidate = table.byId(id);
    if (!candidate) continue;
    candidate.kind = kind;
    if (kind === "food_menu" || kind === "set_menu_or_groups" || kind === "dessert_menu") {
      candidate.likelihood = Math.max(candidate.likelihood, MENU_LIKELIHOOD_THRESHOLD);
      candidate.signals.push("document kind decided by batched classifier");
    }
    applied++;
  }
  return applied;
}
