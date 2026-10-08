import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  ItemDietSchema,
  MenuCandidateSchema,
  MenuDocumentSchema,
  MenuItemSchema,
  MenuResultSchema,
  RecommendRequestBody,
  RecommendationResponseSchema,
  ReviewInsightSchema,
  SourceSchema,
  UserRequestSchema,
  sourced,
} from "@/schemas";
import { z } from "zod";

const NOW = "2026-10-07T12:00:00.000Z";

const diet = (over: Record<string, unknown> = {}) => ({
  vegetarian: "likely_vegetarian",
  vegan: "unknown",
  evidence: "",
  confidence: 0.6,
  ...over,
});

const item = (over: Record<string, unknown> = {}) => ({
  originalName: "Pa amb tomàquet",
  translatedName: "Bread with tomato",
  originalLanguage: "ca",
  price: 4.5,
  priceRaw: "4,50 €",
  priceStatus: "verified",
  diet: diet(),
  extractionConfidence: 0.9,
  documentId: "doc1",
  sourceUrl: "https://example.com/carta.pdf",
  ...over,
});

const doc = (over: Record<string, unknown> = {}) => ({
  id: "doc1",
  url: "https://example.com/carta.pdf",
  tier: "official_site",
  format: "pdf_text",
  documentKind: "food_menu",
  languages: ["ca", "es"],
  readQuality: "good",
  confidence: 0.9,
  hasPrices: true,
  sourceId: "src1",
  items: [item()],
  ...over,
});

describe("UserRequest", () => {
  it("applies defaults", () => {
    const r = UserRequestSchema.parse({ city: "Barcelona" });
    expect(r.meal).toBe("any");
    expect(r.diet).toEqual([]);
    expect(r.allergies).toEqual([]);
    expect(r.reviewSearchTerms).toEqual([]);
  });

  it("rejects an inverted budget range", () => {
    const r = UserRequestSchema.safeParse({ city: "Barcelona", budget: { min: 40, max: 20, currency: "EUR" } });
    expect(r.success).toBe(false);
  });

  it("accepts a full request", () => {
    const r = UserRequestSchema.safeParse({
      city: "Barcelona",
      meal: "dinner",
      diet: ["vegetarian"],
      allergies: ["peanuts"],
      cuisines: ["Italian"],
      budget: { max: 30, currency: "EUR" },
      preferences: ["quiet"],
      partySize: 2,
      location: { lat: 41.38, lng: 2.17 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown meals, diets and non-EUR currencies", () => {
    expect(UserRequestSchema.safeParse({ city: "X", meal: "snack" }).success).toBe(false);
    expect(UserRequestSchema.safeParse({ city: "X", diet: ["keto"] }).success).toBe(false);
    expect(UserRequestSchema.safeParse({ city: "X", budget: { max: 10, currency: "USD" } }).success).toBe(false);
  });

  it("body requires text or form and caps text length", () => {
    expect(RecommendRequestBody.safeParse({}).success).toBe(false);
    expect(RecommendRequestBody.safeParse({ text: "vegetarian dinner" }).success).toBe(true);
    expect(RecommendRequestBody.safeParse({ text: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("Source and provenance", () => {
  it("accepts a retrieved https source", () => {
    const s = SourceSchema.safeParse({
      id: "s1",
      provider: "official_website",
      url: "https://example.com/menu",
      fetchedAt: NOW,
      tier: "official_site",
      label: "Official menu",
    });
    expect(s.success).toBe(true);
  });

  it("rejects non-http URLs", () => {
    for (const url of ["javascript:alert(1)", "ftp://example.com/x", "data:text/html,hi", "not a url"]) {
      const s = SourceSchema.safeParse({ id: "s1", provider: "tavily_search", url, fetchedAt: NOW, label: "x" });
      expect(s.success, url).toBe(false);
    }
  });

  it("sourced() supports retrieved | extracted | inferred", () => {
    const schema = sourced(z.number());
    for (const kind of ["retrieved", "extracted", "inferred"]) {
      expect(schema.safeParse({ value: 1, sourceId: "s1", kind }).success).toBe(true);
    }
    expect(schema.safeParse({ value: 1, sourceId: "s1", kind: "guessed" }).success).toBe(false);
  });
});

describe("Dietary evidence", () => {
  it("requires evidence for confirmed statuses", () => {
    expect(ItemDietSchema.safeParse(diet({ vegetarian: "confirmed_vegetarian", evidence: "" })).success).toBe(false);
    expect(ItemDietSchema.safeParse(diet({ vegan: "confirmed_vegan", evidence: "  " })).success).toBe(false);
    expect(
      ItemDietSchema.safeParse(diet({ vegetarian: "confirmed_vegetarian", evidence: "(V) = vegetarià" })).success,
    ).toBe(true);
  });

  it("allows likely/unknown/meat statuses without evidence", () => {
    for (const vegetarian of ["likely_vegetarian", "unknown", "contains_meat_or_fish"]) {
      expect(ItemDietSchema.safeParse(diet({ vegetarian })).success).toBe(true);
    }
  });

  it("rejects out-of-range confidence", () => {
    expect(ItemDietSchema.safeParse(diet({ confidence: 1.2 })).success).toBe(false);
  });
});

describe("MenuItem prices", () => {
  it("accepts every price status that carries a price", () => {
    for (const priceStatus of ["verified", "ocr_agreed", "unverified"]) {
      expect(MenuItemSchema.safeParse(item({ priceStatus })).success, priceStatus).toBe(true);
    }
  });

  it("supports menus without prices", () => {
    const r = MenuItemSchema.safeParse(item({ price: undefined, priceRaw: undefined, priceStatus: "absent" }));
    expect(r.success).toBe(true);
  });

  it("keeps a disputed price visible but requires a number for it", () => {
    expect(MenuItemSchema.safeParse(item({ priceStatus: "disputed" })).success).toBe(true);
    expect(MenuItemSchema.safeParse(item({ price: undefined, priceStatus: "disputed" })).success).toBe(false);
    expect(MenuItemSchema.safeParse(item({ priceStatus: "absent" })).success).toBe(false);
  });

  it("rejects absent price status with a number and priced status without one", () => {
    expect(MenuItemSchema.safeParse(item({ priceStatus: "absent" })).success).toBe(false);
    expect(MenuItemSchema.safeParse(item({ price: undefined, priceStatus: "verified" })).success).toBe(false);
  });

  it("rejects implausible or non-positive prices", () => {
    expect(MenuItemSchema.safeParse(item({ price: 0 })).success).toBe(false);
    expect(MenuItemSchema.safeParse(item({ price: 5000 })).success).toBe(false);
  });

  it("keeps original and translated names", () => {
    const parsed = MenuItemSchema.parse(item());
    expect(parsed.originalName).toBe("Pa amb tomàquet");
    expect(parsed.translatedName).toBe("Bread with tomato");
  });
});

describe("MenuDocument", () => {
  it("accepts all document kinds, formats and read qualities", () => {
    for (const documentKind of ["food_menu", "drinks_or_wine", "set_menu_or_groups", "not_a_menu"]) {
      expect(MenuDocumentSchema.safeParse(doc({ documentKind })).success, documentKind).toBe(true);
    }
    for (const format of ["html", "pdf_text", "pdf_scanned", "image", "third_party_html"]) {
      expect(MenuDocumentSchema.safeParse(doc({ format })).success, format).toBe(true);
    }
    for (const readQuality of ["good", "partial", "poor"]) {
      expect(MenuDocumentSchema.safeParse(doc({ readQuality })).success, readQuality).toBe(true);
    }
  });

  it("models an image menu with low confidence and a disputed price", () => {
    const d = MenuDocumentSchema.safeParse(
      doc({
        format: "image",
        readQuality: "poor",
        confidence: 0.3,
        imageCount: 2,
        items: [item({ priceStatus: "disputed", extractionConfidence: 0.4 })],
      }),
    );
    expect(d.success).toBe(true);
  });

  it("rejects an invalid document kind", () => {
    expect(MenuDocumentSchema.safeParse(doc({ documentKind: "wine" })).success).toBe(false);
  });
});

describe("MenuResult", () => {
  const base = { stagesTried: [{ stage: "site", found: true, candidates: 3 }], confidence: 0.8, hasPrices: true };

  it("accepts found with multiple documents", () => {
    const r = MenuResultSchema.safeParse({
      ...base,
      status: "found",
      documents: [doc(), doc({ id: "doc2", documentKind: "drinks_or_wine" })],
    });
    expect(r.success).toBe(true);
  });

  it("requires at least one document for found and partial", () => {
    expect(MenuResultSchema.safeParse({ ...base, status: "found", documents: [] }).success).toBe(false);
    expect(MenuResultSchema.safeParse({ ...base, status: "partial", documents: [] }).success).toBe(false);
  });

  it.each(["flipbook_viewer", "blocked", "js_only"])("accepts found_but_unreadable (%s)", (unreadableReason) => {
    const r = MenuResultSchema.safeParse({
      ...base,
      confidence: 0,
      hasPrices: false,
      status: "found_but_unreadable",
      officialMenuUrl: "https://online.fliphtml5.com/zyrook/ESP-CARTA-2026-TULSI/",
      unreadableReason,
    });
    expect(r.success).toBe(true);
  });

  it("found_but_unreadable needs the official URL and a reason", () => {
    const common = { ...base, status: "found_but_unreadable" };
    expect(MenuResultSchema.safeParse({ ...common, unreadableReason: "blocked" }).success).toBe(false);
    expect(MenuResultSchema.safeParse({ ...common, officialMenuUrl: "https://example.com/menu" }).success).toBe(false);
    expect(
      MenuResultSchema.safeParse({ ...common, officialMenuUrl: "https://example.com/menu", unreadableReason: "magic" })
        .success,
    ).toBe(false);
  });

  it("unavailable carries a reason and no documents", () => {
    const ok = MenuResultSchema.safeParse({ ...base, hasPrices: false, status: "unavailable", unavailableReason: "no_menu_found" });
    expect(ok.success).toBe(true);
    const bad = MenuResultSchema.safeParse({
      ...base,
      status: "unavailable",
      unavailableReason: "no_menu_found",
      documents: [doc()],
    });
    expect(bad.success).toBe(false);
  });

  it("records stages tried", () => {
    const r = MenuResultSchema.parse({
      ...base,
      hasPrices: false,
      status: "unavailable",
      unavailableReason: "no_menu_found",
      stagesTried: [
        { stage: "site", found: false, candidates: 0 },
        { stage: "search", found: false, candidates: 4 },
        { stage: "assets", found: false, candidates: 0 },
        { stage: "third_party", found: false, candidates: 1 },
      ],
    });
    expect(r.stagesTried).toHaveLength(4);
  });
});

describe("MenuCandidate", () => {
  it("accepts a candidate with an identity check", () => {
    const c = MenuCandidateSchema.safeParse({
      id: "c1",
      url: "https://example.com/carta",
      discoveredVia: "site_link",
      tier: "official_site",
      identity: { domainMatchesOfficial: true, nameMatch: true, cityMatch: true },
    });
    expect(c.success).toBe(true);
  });
});

describe("ReviewInsight", () => {
  const insight = {
    sampleSize: 5,
    analyzedSampleSize: 0,
    positiveSummary: [],
    negativeSummary: [],
    contextRelevant: [],
    contextSentiment: null,
    evidenceStrength: "none",
    placesReviewTextAnalyzed: false,
  };

  it("accepts an empty insight when Places review text is not analyzed", () => {
    expect(ReviewInsightSchema.safeParse(insight).success).toBe(true);
  });

  it("requires citations on insight points", () => {
    const bad = { ...insight, positiveSummary: [{ text: "Great", supportingReviewIds: [] }] };
    expect(ReviewInsightSchema.safeParse(bad).success).toBe(false);
  });
});

describe("AgentEvent", () => {
  const b = { runId: "r1", seq: 1, ts: NOW };

  it("parses each event type", () => {
    const events = [
      { ...b, type: "run.started" },
      { ...b, type: "understood", request: { city: "Barcelona" } },
      { ...b, type: "discover.started", city: "Barcelona" },
      { ...b, type: "discover.found", count: 18 },
      { ...b, type: "shortlist.done", restaurants: [{ id: "p1", name: "A", rating: 4.5 }] },
      { ...b, type: "restaurant.step", id: "p1", step: "menu", status: "started" },
      { ...b, type: "menu.stage", id: "p1", stage: "site", found: true, candidates: 3 },
      { ...b, type: "menu.read", id: "p1", format: "pdf_scanned", languages: ["ca"], usedVision: true },
      {
        ...b,
        type: "menu.items",
        id: "p1",
        items: [
          { originalName: "Pa amb tomàquet", translatedName: "Bread with tomato", price: 4.5, priceStatus: "verified", vegetarian: "likely_vegetarian" },
        ],
      },
      { ...b, type: "menu.resolved", id: "p1", status: "found_but_unreadable", documentCount: 0, officialMenuUrl: "https://example.com/menu" },
      { ...b, type: "reviews.terms", terms: ["vegetarian", "queue"] },
      { ...b, type: "reviews.read", id: "p1", positive: 2, negative: 1, relevant: 1 },
      { ...b, type: "tool", name: "vision", label: "Reading scanned PDF" },
      { ...b, type: "rank.done" },
      { ...b, type: "explain.done" },
      { ...b, type: "error", code: "deadline", message: "Run deadline reached", recoverable: true },
    ];
    for (const e of events) expect(AgentEventSchema.safeParse(e).success, e.type).toBe(true);
  });

  it("rejects unknown event types and missing envelope fields", () => {
    expect(AgentEventSchema.safeParse({ ...b, type: "thinking", text: "hmm" }).success).toBe(false);
    expect(AgentEventSchema.safeParse({ type: "rank.done" }).success).toBe(false);
  });

  it("result event carries a RecommendationResponse", () => {
    const payload = {
      query: { city: "Barcelona" },
      recommendations: [],
      excluded: [{ name: "X", placeId: "p9", reason: "Closed at dinner time" }],
      sources: [],
      disclaimers: [],
      stats: { candidates: 18, shortlisted: 5, geminiCalls: 10, tavilyCredits: 12, durationMs: 41000 },
    };
    expect(RecommendationResponseSchema.safeParse(payload).success).toBe(true);
    expect(AgentEventSchema.safeParse({ ...b, type: "result", payload }).success).toBe(true);
  });
});
