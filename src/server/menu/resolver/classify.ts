import { normalizeText } from "@/lib/text";
import type { MenuMediaTypeValue, ResolverDocumentKindValue } from "@/schemas/menuResolution";
import type { ContentFacts } from "./htmlInspector";
import { DESSERT_TERMS, DRINKS_TERMS, MENU_TERMS, NEGATIVE_TERMS, SET_MENU_TERMS, URL_STEMS, urlHasStem } from "./lexicon";

export interface ClassifyInput {
  url: string;
  anchorText: string;
  title: string;
  context: string;
  mediaType: MenuMediaTypeValue;
  viaMenuPage: boolean;
  linkedFromOfficial: boolean;
  languageLabel?: boolean;
  readableHtml?: boolean;
  facts?: ContentFacts;
}

export interface Classification {
  documentKind: ResolverDocumentKindValue;
  menuLikelihood: number;
  signals: string[];
}

export const MENU_LIKELIHOOD_THRESHOLD = 0.55;
const FOOD_LIKE: readonly ResolverDocumentKindValue[] = ["food_menu", "set_menu_or_groups", "dessert_menu"];

export const isFoodLike = (kind: ResolverDocumentKindValue): boolean => FOOD_LIKE.includes(kind);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

export function classifyCandidate(input: ClassifyInput): Classification {
  const signals: string[] = [];
  const label = normalizeText(`${input.anchorText} ${input.title}`);
  const path = pathOf(input.url);
  const f = input.facts;

  const urlLegal = urlHasStem(path, URL_STEMS.legal);
  const labelLegal = NEGATIVE_TERMS.test(label);
  const drinks = urlHasStem(path, URL_STEMS.drinks) || DRINKS_TERMS.test(label);
  const dessert = urlHasStem(path, URL_STEMS.dessert) || DESSERT_TERMS.test(label);
  const set = urlHasStem(path, URL_STEMS.set) || SET_MENU_TERMS.test(label);
  const urlFood = urlHasStem(path, URL_STEMS.food);
  const labelFood = MENU_TERMS.test(label);
  const food = urlFood || labelFood;

  let kind: ResolverDocumentKindValue = "unknown";
  if ((urlLegal || labelLegal) && !(labelFood && !urlLegal)) {
    kind = "not_a_menu";
    signals.push("legal/negative terms in url or label");
  } else if (drinks) {
    kind = "drinks_or_wine";
    signals.push("drinks terms in url or label");
  } else if (dessert) {
    kind = "dessert_menu";
    signals.push("dessert terms in url or label");
  } else if (set) {
    kind = "set_menu_or_groups";
    signals.push("set-menu or group terms in url or label");
  } else if (food) {
    kind = "food_menu";
    signals.push("menu terms in url or label");
  }

  if (f) {
    const weakFood = f.sectionHits < 2;
    if (input.mediaType === "pdf" && f.legalHits >= 2 && weakFood) {
      kind = "not_a_menu";
      signals.push("legal text content");
    } else if (kind === "food_menu" || kind === "unknown") {
      if (f.drinksHits >= 5 && weakFood) {
        kind = "drinks_or_wine";
        signals.push("drinks-heavy content");
      } else if (f.groupHits >= 3 && f.sectionHits < 4) {
        kind = "set_menu_or_groups";
        signals.push("group/set-menu content");
      } else if (kind === "unknown" && f.dessertHits >= 3 && f.sectionHits <= 2) {
        kind = "dessert_menu";
        signals.push("dessert content");
      } else if (kind === "unknown" && f.sectionHits >= 3) {
        kind = "food_menu";
        signals.push("food section words in content");
      }
    }
  }

  const labelAny = labelFood || DESSERT_TERMS.test(label) || SET_MENU_TERMS.test(label) || DRINKS_TERMS.test(label);
  const urlAny = urlFood || urlHasStem(path, URL_STEMS.dessert) || urlHasStem(path, URL_STEMS.set) || urlHasStem(path, URL_STEMS.drinks);

  let score = 0;
  if (labelAny) {
    score += 0.3;
    signals.push("+menu anchor/title");
  }
  if (urlAny) {
    score += 0.2;
    signals.push("+menu url");
  }
  if ((input.mediaType === "pdf" || input.mediaType === "image") && (labelAny || urlAny)) {
    score += 0.1;
    signals.push("+menu-labelled document file");
  }
  if (input.viaMenuPage) {
    score += 0.2;
    signals.push("+linked from a menu page");
  }
  const isAsset = input.mediaType === "pdf" || input.mediaType === "image" || input.mediaType === "viewer" || input.mediaType === "external_host";
  if (input.linkedFromOfficial && isAsset) {
    score += 0.1;
    signals.push("+menu asset linked by official site");
    if (input.viaMenuPage) {
      score += 0.15;
      signals.push("+asset on a menu page");
    }
    if (input.languageLabel && input.viaMenuPage) {
      score += 0.1;
      signals.push("+language-labelled link on a menu page");
    }
  }
  if (f) {
    if (f.sectionHits >= 3) {
      score += 0.25;
      signals.push("+food section words");
    } else if (f.sectionHits >= 1) {
      score += 0.1;
    }
    if (f.dishLineCount >= 12) {
      score += 0.15;
      signals.push("+dish-like line density");
    }
    if (f.priceHits >= 3) {
      score += 0.05;
      signals.push("+prices (bonus)");
    }
  }

  if (input.readableHtml && f && f.sectionHits < 2 && f.dishLineCount < 8 && kind !== "not_a_menu") {
    score = Math.min(score, 0.45);
    signals.push("readable page with little menu content");
  }

  if (kind === "not_a_menu") score = Math.min(score, 0.15);
  else if (kind === "drinks_or_wine") score = Math.min(score, 0.3);
  else if (kind === "unknown") score = Math.min(score, 0.5);

  return { documentKind: kind, menuLikelihood: clamp01(Number(score.toFixed(3))), signals };
}
