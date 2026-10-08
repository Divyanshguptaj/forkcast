import type { CandidateSummary } from "@/schemas/menuResolution";
import { analyzeHtml } from "../resolver/htmlInspector";
import { ResolverFetcher } from "../resolver/fetcher";
import { extractPdfPages } from "../resolver/pdfProbe";
import { normalizeUrl } from "../resolver/urlNormalize";
import type { ExtractLimits } from "./limits";

export type LoadedDocument =
  | { kind: "text"; method: "html_text" | "pdf_text"; text: string; pageCount?: number; truncated: boolean; bytes: number }
  | { kind: "vision"; method: "vision"; mimeType: string; data: Uint8Array; pageCount?: number; bytes: number }
  | { kind: "skip"; reason: string };

export interface LoaderDeps {
  fetcher: ResolverFetcher;
  extractedText: Map<string, string>;
  limits: ExtractLimits;
}

const MIN_HTML_TEXT = 400;
const MIN_PDF_CHARS_PER_PAGE = 40;

function withPageMarkers(pages: string[]): string {
  return pages.map((p, i) => `[page ${i + 1}]\n${p.trim()}`).join("\n\n");
}

export async function loadDocument(candidate: CandidateSummary, deps: LoaderDeps): Promise<LoadedDocument> {
  const { limits } = deps;
  const key = normalizeUrl(candidate.url)?.comparisonKey ?? candidate.url;

  const cached = deps.extractedText.get(key);
  if (candidate.readVia === "tavily_extract" && cached) {
    const text = cached.slice(0, limits.maxTextChars);
    return { kind: "text", method: "html_text", text, truncated: cached.length > text.length, bytes: cached.length };
  }

  const out = await deps.fetcher.get(candidate.url, { html: candidate.mediaType !== "pdf" && candidate.mediaType !== "image" });
  if (!out.result || !out.result.ok) return { kind: "skip", reason: out.errorCode === "budget_exhausted" ? "download budget exhausted" : "download failed" };
  const res = out.result;

  if (res.kind === "pdf") {
    const pdf = await extractPdfPages(res.bytes, limits.maxPdfPages);
    if (!pdf) return { kind: "skip", reason: "PDF could not be parsed" };
    if (pdf.avgCharsPerPage >= MIN_PDF_CHARS_PER_PAGE) {
      const text = withPageMarkers(pdf.pages).slice(0, limits.maxTextChars);
      return { kind: "text", method: "pdf_text", text, pageCount: pdf.pageCount, truncated: pdf.pageCount > pdf.pages.length || text.length >= limits.maxTextChars, bytes: res.bytes.byteLength };
    }
    if (pdf.pageCount > limits.maxVisionPages) return { kind: "skip", reason: `scanned PDF has ${pdf.pageCount} pages (limit ${limits.maxVisionPages})` };
    if (res.bytes.byteLength > limits.maxVisionBytes) return { kind: "skip", reason: "scanned PDF is too large to send" };
    return { kind: "vision", method: "vision", mimeType: "application/pdf", data: res.bytes, pageCount: pdf.pageCount, bytes: res.bytes.byteLength };
  }

  if (res.kind === "jpeg" || res.kind === "png" || res.kind === "webp") {
    if (res.bytes.byteLength > limits.maxVisionBytes) return { kind: "skip", reason: "image is too large to send" };
    return { kind: "vision", method: "vision", mimeType: `image/${res.kind}`, data: res.bytes, bytes: res.bytes.byteLength };
  }

  if (res.kind === "html" || res.kind === "text") {
    const raw = Buffer.from(res.bytes).toString("utf8");
    const page = res.kind === "html" ? analyzeHtml(raw, res.url) : undefined;
    const text = (page?.text ?? raw).slice(0, limits.maxTextChars);
    if (text.length < MIN_HTML_TEXT) {
      const fallback = deps.extractedText.get(key);
      if (fallback && fallback.length >= MIN_HTML_TEXT) {
        return { kind: "text", method: "html_text", text: fallback.slice(0, limits.maxTextChars), truncated: fallback.length > limits.maxTextChars, bytes: fallback.length };
      }
      return { kind: "skip", reason: "page has almost no readable text (needs scripts)" };
    }
    return { kind: "text", method: "html_text", text, truncated: (page?.text ?? raw).length > text.length, bytes: res.bytes.byteLength };
  }

  return { kind: "skip", reason: "unsupported file type" };
}
