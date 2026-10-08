import { menuYear } from "@/lib/menuYear";
import { normalizeText } from "@/lib/text";
import type { DishDiet, ExtractedDish, ExtractedDocument, ExtractionUsage, MenuExtraction, SetMenu } from "@/schemas/menuExtraction";
import type { MenuItemPreview } from "@/schemas/menu";
import type { CandidateSummary, MenuResolution } from "@/schemas/menuResolution";
import type { EventEmitter } from "../../agent/events";
import { GeminiError } from "../../providers/gemini/client";
import type { Fetcher, LlmProvider, LlmStructuredResult } from "../../providers/types";
import { ResolverBudget, DEFAULT_RESOLVER_LIMITS } from "../resolver/budget";
import { ResolverFetcher, createSharedCache, type ResolverSharedCache } from "../resolver/fetcher";
import { assessIdentity } from "../resolver/identity";
import { createLimiter } from "../resolver/limiter";
import type { ResolverRestaurant } from "../resolver/resolver";
import { splitIntoChunks } from "./chunk";
import { representativeDishes } from "./coverage";
import { mergeDishes } from "./dedupe";
import { deterministicDocument } from "./deterministic";
import { DEFAULT_EXTRACT_LIMITS, type ExtractLimits } from "./limits";
import { loadDocument, type LoadedDocument } from "./loader";
import { ExtractionCache, contentKey } from "./modelCache";
import { ModelExtractionSchema, extractionJsonSchema, PRICE_CHECK_JSON_SCHEMA, PriceCheckSchema, mergeModelDocuments, type ModelDocument } from "./modelSchema";
import { parsePriceText } from "./price";
import { PRICE_CHECK_SYSTEM, buildPriceCheckParts, buildSystemPrompt, buildTextParts, buildVisionParts, type ExtractionFocus, type PromptDocument } from "./prompts";
import { buildFromModel, type SourceDoc } from "./validate";

export interface ExtractInput {
  restaurant: ResolverRestaurant;
  resolution: MenuResolution;
}

export interface ExtractDeps {
  fetcher: Fetcher;
  sharedCache?: ResolverSharedCache;
  modelCache?: ExtractionCache;
  llm?: LlmProvider;
  priceCheckModel?: string;
  emitter?: EventEmitter;
  signal?: AbortSignal;
  limits?: Partial<ExtractLimits>;
  focus?: ExtractionFocus;
  verifyImagePrices?: boolean;
  requestedDiets?: readonly string[];
  now?: () => number;
}

export interface ModelCallRecord {
  label: string;
  model?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  truncated: boolean;
}

export interface ExtractionRunStats {
  llmRequests: number;
  visionRequests: number;
  priceCheckRequests: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  cacheHits: number;
  quotaSkipped: number;
  truncatedResponses: number;
  modelLatencyMs: number;
  calls: ModelCallRecord[];
}

interface ChunkOutcome {
  model?: ModelDocument;
  failure?: string;
}

interface Work {
  input: ExtractInput;
  index: number;
  candidate: CandidateSummary;
  documentId: string;
  loaded?: LoadedDocument;
  source?: SourceDoc;
  chunks?: string[];
  outcomes?: ChunkOutcome[];
  doc: ExtractedDocument;
  dishes: ExtractedDish[];
  setMenus: SetMenu[];
}

interface Job {
  works: Work[];
  chunkIndex: number;
  texts: string[];
  part?: { index: number; count: number };
}

const emptyUsage = (): ExtractionUsage => ({ geminiRequests: 0, visionRequests: 0, priceCheckRequests: 0, inputTokens: 0, outputTokens: 0, bytesFetched: 0 });

const FORMAT_FOR: Record<string, "html" | "pdf_text" | "pdf_scanned" | "image"> = { html_text: "html", pdf_text: "pdf_text" };

const SYSTEM_PROMPT_TOKENS = 1_100;
const VISION_INPUT_TOKENS = 2_000;
const estimateTokens = (chars: number) => Math.ceil(chars / 3.2);

function offeringFor(verdict: ModelDocument["verdict"], kind: CandidateSummary["documentKind"]): ExtractedDish["offering"] {
  if (verdict === "set_menu" || kind === "set_menu_or_groups") return "set_menu";
  if (verdict === "dessert_menu" || kind === "dessert_menu") return "dessert";
  return "a_la_carte";
}

function previewOf(d: ExtractedDish): MenuItemPreview {
  const first = d.prices[0];
  const veg = d.diet.vegetarian.status;
  return {
    originalName: d.originalName,
    translatedName: d.translatedName ?? d.originalName,
    ...(first?.amount !== undefined ? { price: first.amount } : {}),
    priceStatus: first?.status ?? "absent",
    vegetarian: veg === "confirmed" ? "confirmed_vegetarian" : veg === "possible" ? "likely_vegetarian" : veg === "not_suitable" ? "contains_meat_or_fish" : "unknown",
  };
}

const RELEVANCE: Record<string, number> = { confirmed: 0, possible: 1, unknown: 2, not_suitable: 3 };

export function previewDishes(dishes: ExtractedDish[], diet: keyof DishDiet = "vegetarian", max = 12): MenuItemPreview[] {
  return [...dishes]
    .sort((a, b) => RELEVANCE[a.diet[diet].status] - RELEVANCE[b.diet[diet].status])
    .slice(0, max)
    .map(previewOf);
}

const KIND_PRIORITY: Record<string, number> = { food_menu: 0, set_menu_or_groups: 1, dessert_menu: 2 };

export function dropOutdatedDocuments(selected: CandidateSummary[]): CandidateSummary[] {
  const newest = Math.max(0, ...selected.filter((c) => c.documentKind === "food_menu").map((c) => menuYear(c.url) ?? 0));
  if (newest === 0) return selected;
  return selected.filter((c) => c.documentKind !== "food_menu" || (menuYear(c.url) ?? newest) >= newest);
}

export function chooseDocuments(selected: CandidateSummary[], max: number): CandidateSummary[] {
  return [...dropOutdatedDocuments(selected)].sort((a, b) => (KIND_PRIORITY[a.documentKind] ?? 3) - (KIND_PRIORITY[b.documentKind] ?? 3) || b.confidence - a.confidence).slice(0, max);
}

export function selectDocuments(inputs: ExtractInput[], limits: Pick<ExtractLimits, "maxDocsPerRestaurant" | "maxDocsTotal"> & { includeSecondaryMenus?: boolean }): Map<ExtractInput, CandidateSummary[]> {
  const ranked = new Map<ExtractInput, CandidateSummary[]>();
  for (const input of inputs) {
    if (input.resolution.status === "resolved") ranked.set(input, chooseDocuments(input.resolution.selected, limits.maxDocsPerRestaurant));
  }
  const chosen = new Map<ExtractInput, CandidateSummary[]>();
  let total = 0;
  for (const [input, docs] of ranked) {
    if (docs[0] && total < limits.maxDocsTotal) {
      chosen.set(input, [docs[0]]);
      total++;
    }
  }
  for (let round = 1; round < limits.maxDocsPerRestaurant; round++) {
    for (const [input, docs] of ranked) {
      const next = docs[round];
      if (!next || total >= limits.maxDocsTotal || (next.documentKind !== "food_menu" && !limits.includeSecondaryMenus) || !chosen.has(input)) continue;
      chosen.get(input)!.push(next);
      total++;
    }
  }
  return chosen;
}

function failureReason(err: unknown): string {
  if (err instanceof GeminiError) return err.code === "quota_exhausted" ? "model daily quota exhausted" : `model ${err.code}`;
  return "model error";
}

export async function extractMenus(inputs: ExtractInput[], deps: ExtractDeps): Promise<{ results: MenuExtraction[]; stats: ExtractionRunStats }> {
  const now = deps.now ?? Date.now;
  const started = now();
  const limits: ExtractLimits = { ...DEFAULT_EXTRACT_LIMITS, ...deps.limits };
  const focus = deps.focus ?? "plant_based";
  const cache = deps.sharedCache ?? createSharedCache();
  const modelCache = deps.modelCache ?? new ExtractionCache();
  const budget = new ResolverBudget({ ...DEFAULT_RESOLVER_LIMITS, maxDirectFetches: 60, maxHtmlPages: 60, maxBytes: 300 * 1024 * 1024 });
  const fetchLimiter = createLimiter(limits.fetchConcurrency);
  const llmLimiter = createLimiter(limits.llmConcurrency);
  const fetcher = new ResolverFetcher(deps.fetcher, budget, fetchLimiter, deps.signal, {}, cache.fetch);
  const stats: ExtractionRunStats = { llmRequests: 0, visionRequests: 0, priceCheckRequests: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, cacheHits: 0, quotaSkipped: 0, truncatedResponses: 0, modelLatencyMs: 0, calls: [] };
  const warnings = new Map<string, string[]>();
  const usage = new Map<string, ExtractionUsage>();
  const usageFor = (id: string) => usage.get(id) ?? usage.set(id, emptyUsage()).get(id)!;
  const warn = (id: string, message: string) => warnings.set(id, [...(warnings.get(id) ?? []), message.slice(0, 200)]);
  const emit = deps.emitter?.emit.bind(deps.emitter);
  let committedInputTokens = 0;

  // 1. select documents
  const works: Work[] = [];
  const chosen = selectDocuments(inputs, limits);
  for (const input of inputs) {
    if (input.resolution.status !== "resolved") continue;
    (chosen.get(input) ?? []).forEach((candidate, index) => {
      works.push({
        input,
        index,
        candidate,
        documentId: candidate.id,
        dishes: [],
        setMenus: [],
        doc: {
          documentId: candidate.id,
          url: candidate.url,
          tier: candidate.tier,
          mediaType: candidate.mediaType,
          documentKind: candidate.documentKind,
          status: "skipped",
          languages: [],
          dishCount: 0,
          omittedNonMatchingCount: 0,
          droppedDishCount: 0,
          warnings: [],
        },
      });
    });
  }

  // 2. load documents
  await Promise.all(
    works.map(async (w) => {
      const id = w.input.restaurant.placeId;
      if (deps.signal?.aborted) {
        w.doc.reason = "aborted";
        return;
      }
      try {
        w.loaded = await loadDocument(w.candidate, { fetcher, extractedText: cache.extractedText, limits });
      } catch {
        w.loaded = { kind: "skip", reason: "document could not be loaded" };
      }
      if (w.loaded.kind === "skip") {
        w.doc.status = "failed";
        w.doc.reason = w.loaded.reason;
        return;
      }
      usageFor(id).bytesFetched += w.loaded.bytes;
      w.doc.method = w.loaded.method;
      w.doc.pageCount = w.loaded.pageCount;
      w.source = {
        documentId: w.documentId,
        restaurantId: id,
        url: w.candidate.url,
        tier: w.candidate.tier,
        documentKind: w.candidate.documentKind,
        method: w.loaded.method,
        text: w.loaded.kind === "text" ? w.loaded.text : undefined,
      };
      if (w.loaded.kind === "text" && w.candidate.tier !== "official_site" && w.candidate.tier !== "official_linked") {
        const r = w.input.restaurant;
        const identity = assessIdentity({ name: r.name, address: r.address, city: r.city, websiteUrl: r.websiteUrl }, { url: w.candidate.url, text: w.loaded.text, linkedFromOfficial: false });
        if (identity.mismatch) {
          w.doc.status = "skipped";
          w.doc.reason = "content appears to belong to a different restaurant";
          w.loaded = { kind: "skip", reason: w.doc.reason };
        }
      }
    }),
  );

  // 3. plan model jobs
  const visionPerRestaurant = new Map<string, number>();
  const textWorks: Work[] = [];
  const visionWorks: Work[] = [];
  for (const w of works) {
    if (!w.loaded || w.loaded.kind === "skip") continue;
    if (w.loaded.kind === "text") textWorks.push(w);
    else {
      const id = w.input.restaurant.placeId;
      const used = visionPerRestaurant.get(id) ?? 0;
      if (used >= limits.maxVisionDocsPerRestaurant) {
        w.doc.status = "skipped";
        w.doc.reason = "vision limit per restaurant reached";
        continue;
      }
      visionPerRestaurant.set(id, used + 1);
      visionWorks.push(w);
    }
  }

  const jobs: Job[] = [];
  const singles: Work[] = [];
  for (const w of textWorks) {
    const text = w.loaded?.kind === "text" ? w.loaded.text : "";
    const { chunks, droppedChars } = splitIntoChunks(text, limits.chunkChars, limits.maxChunksPerDoc);
    w.chunks = chunks;
    w.outcomes = chunks.map(() => ({}));
    if (droppedChars > 0) w.doc.warnings.push(`The last ${droppedChars} characters of this menu were not read`);
    if (chunks.length > 1) chunks.forEach((chunk, i) => jobs.push({ works: [w], chunkIndex: i, texts: [chunk], part: { index: i + 1, count: chunks.length } }));
    else singles.push(w);
  }
  let current: Work[] = [];
  let chars = 0;
  const flush = () => {
    if (current.length) jobs.push({ works: current, chunkIndex: 0, texts: current.map((w) => w.chunks![0]) });
    current = [];
    chars = 0;
  };
  for (const w of singles) {
    const len = w.chunks![0].length;
    if (current.length >= limits.maxTextDocsPerCall || (current.length > 0 && chars + len > limits.maxCharsPerCall)) flush();
    current.push(w);
    chars += len;
  }
  flush();

  const budgetLeft = () => limits.maxLlmRequests - (stats.llmRequests + stats.priceCheckRequests);

  const promptDoc = (w: Work, text?: string, part?: Job["part"]): PromptDocument => ({
    documentId: w.documentId,
    restaurant: { name: w.input.restaurant.name, address: w.input.restaurant.address, city: w.input.restaurant.city },
    documentKind: w.candidate.documentKind,
    sourceUrl: w.candidate.url,
    text,
    part,
  });

  const startSteps = (list: Work[], label: string, vision: boolean) => {
    const ids = [...new Set(list.map((w) => w.input.restaurant.placeId))];
    for (const id of ids) {
      emit?.({ type: "tool", id, name: vision ? "vision" : "gemini", label });
      emit?.({ type: "restaurant.step", id, step: "translate", status: "started" });
      emit?.({ type: "restaurant.step", id, step: "diet", status: "started" });
    }
  };

  const withVegan = deps.requestedDiets?.includes("vegan") ?? true;
  const system = buildSystemPrompt(focus, { vegan: withVegan });
  const jsonSchema = extractionJsonSchema({ vegan: withVegan }) as unknown as Record<string, unknown>;

  const callModel = async <T>(label: string, run: () => Promise<LlmStructuredResult<T>>): Promise<LlmStructuredResult<T>> => {
    const out = await llmLimiter.run(async () => {
      if (deps.llm?.available?.() === false) {
        stats.quotaSkipped++;
        throw new GeminiError("quota_exhausted", "Every configured Gemini model is paused", 429);
      }
      return run();
    });
    stats.inputTokens += out.inputTokens ?? 0;
    stats.outputTokens += out.outputTokens ?? 0;
    stats.modelLatencyMs += out.durationMs;
    if (out.truncated) stats.truncatedResponses++;
    stats.calls.push({ label, model: out.model, latencyMs: out.durationMs, inputTokens: out.inputTokens ?? 0, outputTokens: out.outputTokens ?? 0, truncated: Boolean(out.truncated) });
    return out;
  };

  const applyModel = (w: Work, model: ModelDocument | undefined, fallbackReason: string) => {
    const source = w.source!;
    if (!model) {
      w.doc.status = "failed";
      w.doc.reason = fallbackReason;
      return;
    }
    w.doc.languages = model.languages.filter((l, i, a) => a.indexOf(l) === i);
    w.doc.omittedNonMatchingCount = model.omittedNonMatchingCount;
    if (model.verdict === "drinks_only" || model.verdict === "legal_or_other" || model.verdict === "wrong_restaurant") {
      w.doc.status = "skipped";
      w.doc.reason = `${model.verdict.replace(/_/g, " ")}${model.reason ? `: ${model.reason}` : ""}`.slice(0, 200);
      return;
    }
    if (model.verdict === "unreadable" && model.dishes.length === 0) {
      w.doc.status = "empty";
      w.doc.reason = model.reason ?? "document could not be read";
      return;
    }
    const built = buildFromModel(model, { source, offeringDefault: offeringFor(model.verdict, w.candidate.documentKind), setMenuIds: new Set() });
    const kept = representativeDishes(built.dishes, limits.maxDishesPerDocument);
    w.dishes = kept;
    w.setMenus = built.setMenus;
    w.doc.dishCount = kept.length;
    w.doc.droppedDishCount = built.dropped;
    w.doc.warnings = [...w.doc.warnings, ...built.warnings, ...(kept.length < built.dishes.length ? [`Kept ${kept.length} of ${built.dishes.length} dishes, spread across menu sections`] : [])].slice(0, 5);
    if (kept.length === 0) {
      w.doc.status = "empty";
      w.doc.reason = built.dropped > 0 ? "every extracted dish failed validation" : "no dishes found";
    } else {
      w.doc.status = built.dropped > kept.length ? "partial" : "extracted";
    }
  };

  const finalizeText = (w: Work) => {
    const chunks = w.chunks!;
    const outcomes = w.outcomes!;
    const parts: ModelDocument[] = [];
    let fallbackReason: string | undefined;
    let fallbackChunks = 0;
    outcomes.forEach((outcome, i) => {
      if (outcome.model) {
        parts.push(outcome.model);
        return;
      }
      fallbackChunks++;
      fallbackReason ??= outcome.failure ?? "model unavailable";
      parts.push(deterministicDocument(w.documentId, chunks[i]));
    });
    applyModel(w, mergeModelDocuments(w.documentId, parts), fallbackReason ?? "model unavailable");
    if (fallbackChunks > 0 && w.doc.status !== "failed") {
      w.doc.status = w.doc.status === "extracted" ? "partial" : w.doc.status;
      w.doc.reason = `${fallbackReason}; ${fallbackChunks === chunks.length ? "read with the deterministic parser only (no translation or dietary reading)" : "part of the menu was read with the deterministic parser"}`.slice(0, 200);
    }
  };

  const runJob = async (job: Job): Promise<void> => {
    const outcomeOf = (w: Work) => w.outcomes![job.chunkIndex];
    const fail = (reason: string) => {
      for (const w of job.works) outcomeOf(w).failure = reason;
    };
    if (!deps.llm || budgetLeft() < 1 || deps.signal?.aborted) {
      fail(deps.llm ? "model request budget reached" : "model unavailable");
      return;
    }
    if (deps.llm.available?.() === false) {
      stats.quotaSkipped++;
      fail("model daily quota exhausted");
      return;
    }
    const estimated = SYSTEM_PROMPT_TOKENS + estimateTokens(job.texts.reduce((n, t) => n + t.length, 0));
    if (committedInputTokens + estimated > limits.maxInputTokensPerRun) {
      fail("input token budget reached");
      return;
    }

    const single = job.works.length === 1;
    const w0 = job.works[0];
    const request = (docs: PromptDocument[]) => ({
      label: "menu-extract-text",
      system,
      parts: buildTextParts(docs),
      schema: ModelExtractionSchema,
      jsonSchema,
      timeoutMs: limits.llmTimeoutMs,
      maxOutputTokens: limits.maxOutputTokens,
    });

    startSteps(job.works, job.part ? `Reading menu text (part ${job.part.index} of ${job.part.count})` : "Reading menu text", false);
    try {
      if (single) {
        const key = contentKey(focus, String(withVegan), w0.input.restaurant.name, w0.input.restaurant.address ?? "", w0.candidate.documentKind, job.texts[0]);
        const { doc, hit } = await modelCache.getOrRun(key, async () => {
          committedInputTokens += estimated;
          stats.llmRequests++;
          usageFor(w0.input.restaurant.placeId).geminiRequests++;
          const out = await callModel("menu-extract-text", () => deps.llm!.generateStructured(request([promptDoc(w0, job.texts[0], job.part)]), { signal: deps.signal }));
          usageFor(w0.input.restaurant.placeId).inputTokens += out.inputTokens ?? 0;
          usageFor(w0.input.restaurant.placeId).outputTokens += out.outputTokens ?? 0;
          const found = out.data.documents.find((d) => d.documentId === w0.documentId) ?? out.data.documents[0];
          if (!found) throw new GeminiError("invalid_response", "The model did not return this document");
          return found;
        });
        if (hit) stats.cacheHits++;
        outcomeOf(w0).model = { ...doc, documentId: w0.documentId };
        return;
      }
      committedInputTokens += estimated;
      stats.llmRequests++;
      for (const w of job.works) usageFor(w.input.restaurant.placeId).geminiRequests++;
      const out = await callModel("menu-extract-text", () => deps.llm!.generateStructured(request(job.works.map((w, i) => promptDoc(w, job.texts[i]))), { signal: deps.signal }));
      for (const w of job.works) {
        usageFor(w.input.restaurant.placeId).inputTokens += Math.ceil((out.inputTokens ?? 0) / job.works.length);
        usageFor(w.input.restaurant.placeId).outputTokens += Math.ceil((out.outputTokens ?? 0) / job.works.length);
        const found = out.data.documents.find((d) => d.documentId === w.documentId);
        if (found) outcomeOf(w).model = found;
        else outcomeOf(w).failure = "the model did not return this document";
      }
    } catch (err) {
      const reason = failureReason(err);
      for (const w of job.works) {
        outcomeOf(w).failure = reason;
        warn(w.input.restaurant.placeId, `Menu text model call failed (${reason}); used the deterministic parser`);
      }
    }
  };

  const runVision = async (w: Work): Promise<void> => {
    const loaded = w.loaded;
    if (!loaded || loaded.kind !== "vision") return;
    const id = w.input.restaurant.placeId;
    if (!deps.llm || budgetLeft() < 1 || deps.signal?.aborted) {
      w.doc.status = "failed";
      w.doc.reason = deps.llm ? "model request budget reached" : "vision unavailable";
      return;
    }
    if (deps.llm.available?.() === false) {
      stats.quotaSkipped++;
      w.doc.status = "failed";
      w.doc.reason = "model daily quota exhausted";
      return;
    }
    if (committedInputTokens + VISION_INPUT_TOKENS > limits.maxInputTokensPerRun) {
      w.doc.status = "failed";
      w.doc.reason = "input token budget reached";
      return;
    }
    startSteps([w], loaded.mimeType === "application/pdf" ? "Reading a scanned menu" : "Reading an image menu", true);
    try {
      const key = contentKey(focus, String(withVegan), w.input.restaurant.name, w.input.restaurant.address ?? "", w.candidate.documentKind, loaded.data);
      const { doc, hit } = await modelCache.getOrRun(key, async () => {
        committedInputTokens += VISION_INPUT_TOKENS;
        stats.llmRequests++;
        stats.visionRequests++;
        usageFor(id).geminiRequests++;
        usageFor(id).visionRequests++;
        const out = await callModel("menu-extract-vision", () =>
          deps.llm!.generateStructured(
            { label: "menu-extract-vision", system, parts: buildVisionParts(promptDoc(w), loaded.mimeType, loaded.data), schema: ModelExtractionSchema, jsonSchema, timeoutMs: limits.llmTimeoutMs, maxOutputTokens: limits.maxOutputTokens },
            { signal: deps.signal },
          ),
        );
        usageFor(id).inputTokens += out.inputTokens ?? 0;
        usageFor(id).outputTokens += out.outputTokens ?? 0;
        const found = out.data.documents.find((d) => d.documentId === w.documentId) ?? out.data.documents[0];
        if (!found) throw new GeminiError("invalid_response", "The model did not return this document");
        return found;
      });
      if (hit) stats.cacheHits++;
      applyModel(w, { ...doc, documentId: w.documentId }, "the model did not return this document");
    } catch (err) {
      w.doc.status = "failed";
      w.doc.reason = failureReason(err);
      return;
    }
    if (deps.verifyImagePrices !== false && w.dishes.some((d) => d.prices.some((p) => p.amount !== undefined))) await crossCheckPrices(w, loaded);
  };

  const crossCheckPrices = async (w: Work, loaded: Extract<LoadedDocument, { kind: "vision" }>): Promise<void> => {
    const id = w.input.restaurant.placeId;
    if (!deps.llm || budgetLeft() < 1 || deps.llm.available?.() === false) {
      w.doc.warnings.push("prices were not cross-checked");
      return;
    }
    stats.priceCheckRequests++;
    usageFor(id).priceCheckRequests++;
    const relevant = (d: ExtractedDish) => focus === "all" || d.diet.vegetarian.status !== "not_suitable";
    const names = w.dishes.filter((d) => relevant(d) && d.prices.some((p) => p.amount !== undefined)).map((d) => d.originalName).slice(0, 60);
    if (names.length === 0) return;
    try {
      const out = await callModel("menu-price-check", () =>
        deps.llm!.generateStructured(
          { label: "menu-price-check", system: PRICE_CHECK_SYSTEM, parts: buildPriceCheckParts(loaded.mimeType, loaded.data, names), schema: PriceCheckSchema, jsonSchema: PRICE_CHECK_JSON_SCHEMA as unknown as Record<string, unknown>, models: deps.priceCheckModel ? [deps.priceCheckModel] : undefined, timeoutMs: limits.llmTimeoutMs, maxOutputTokens: limits.priceCheckMaxOutputTokens },
          { signal: deps.signal },
        ),
      );
      const second = new Map(out.data.lines.map((l) => [normalizeText(l.dish), l.price]));
      for (const d of w.dishes) {
        if (!names.includes(d.originalName)) continue;
        const other = second.get(normalizeText(d.originalName));
        const otherAmounts = other ? parsePriceText(other).map((p) => p.amount) : [];
        d.prices = d.prices.map((p) => {
          if (p.amount === undefined) return p;
          if (otherAmounts.length === 0) return p;
          if (otherAmounts.includes(p.amount)) return { ...p, status: "ocr_agreed" as const, basis: "image_agreed" as const, confidence: 0.85 };
          return { ...p, status: "disputed" as const, basis: "image_conflict" as const, confidence: 0.3, alternateAmount: otherAmounts[0] };
        });
        if (d.prices.some((p) => p.status === "disputed")) d.extractionConfidence = Math.min(d.extractionConfidence, 0.4);
        else if (d.prices.some((p) => p.status === "ocr_agreed")) d.extractionConfidence = Math.max(d.extractionConfidence, 0.8);
      }
    } catch {
      w.doc.warnings.push("price cross-check failed; prices are unverified");
    }
  };

  // 4. run model jobs
  await Promise.all([...jobs.map((j) => runJob(j)), ...visionWorks.map((w) => runVision(w))]);
  for (const w of textWorks) finalizeText(w);

  // 5. assemble per restaurant
  const results: MenuExtraction[] = [];
  for (const input of inputs) {
    const r = input.restaurant;
    const mine = works.filter((w) => w.input === input);
    const docs = mine.map((w) => w.doc);

    for (const w of mine) {
      if (w.doc.status === "extracted" || w.doc.status === "partial") {
        const m = w.doc.method;
        const vision = m === "vision";
        emit?.({
          type: "menu.read",
          id: r.placeId,
          format: vision ? (w.loaded?.kind === "vision" && w.loaded.mimeType === "application/pdf" ? "pdf_scanned" : "image") : FORMAT_FOR[m ?? "html_text"],
          languages: w.doc.languages,
          usedVision: vision,
          dishCount: w.doc.dishCount,
        });
      }
    }

    if (input.resolution.status !== "resolved") {
      const res = input.resolution;
      const reason = res.status === "found_but_unreadable" ? `menu found but not readable (${res.unreadableReason})` : res.status === "unavailable" ? `no menu available (${res.unavailableReason})` : "menu resolution failed";
      results.push({ restaurantId: r.placeId, restaurantName: r.name, status: res.status === "failed" ? "failed" : "unavailable", reason, documents: [], dishes: [], setMenus: [], warnings: [], usage: emptyUsage(), durationMs: 0 });
      continue;
    }

    const dishes = representativeDishes(mergeDishes(mine.flatMap((w) => w.dishes)), limits.maxDishesPerRestaurant);
    const setMenus = mine.flatMap((w) => w.setMenus);
    const good = docs.filter((d) => d.status === "extracted" || d.status === "partial");
    const problems = docs.filter((d) => d.status === "failed" || d.status === "empty" || d.status === "partial");
    const status: MenuExtraction["status"] = docs.length === 0 ? "unavailable" : good.length === 0 ? (docs.every((d) => d.status === "failed") ? "failed" : "unavailable") : problems.length > 0 ? "partial" : "extracted";
    const reason = status === "extracted" ? undefined : [...new Set(docs.map((d) => d.reason).filter(Boolean))].slice(0, 2).join("; ") || "no readable menu documents";

    results.push({
      restaurantId: r.placeId,
      restaurantName: r.name,
      status,
      ...(reason ? { reason: reason.slice(0, 200) } : {}),
      documents: docs,
      dishes,
      setMenus,
      warnings: (warnings.get(r.placeId) ?? []).slice(0, 5),
      usage: usageFor(r.placeId),
      durationMs: now() - started,
    });

    if (dishes.length > 0) emit?.({ type: "menu.items", id: r.placeId, items: previewDishes(dishes, "vegetarian", 12) });
    const stepStatus = status === "extracted" ? "done" : status === "partial" ? "warning" : "failed";
    const detail = status === "extracted" ? `${dishes.length} dishes read` : status === "partial" ? `${dishes.length} dishes read; some documents could not be read` : reason;
    if (works.some((w) => w.input === input)) {
      emit?.({ type: "restaurant.step", id: r.placeId, step: "translate", status: stepStatus, ...(detail ? { detail: detail.slice(0, 200) } : {}) });
      emit?.({ type: "restaurant.step", id: r.placeId, step: "diet", status: stepStatus });
    }
    emit?.({ type: "menu.extracted", id: r.placeId, status, documentCount: good.length, skippedCount: docs.length - good.length, dishCount: dishes.length, ...(reason ? { reason: reason.slice(0, 200) } : {}) });
  }

  stats.durationMs = now() - started;
  return { results, stats };
}
