import type { SafeFetchErrorCode, SafeFetchResult } from "@/server/providers/http/safeFetch";
import { SafeFetchError } from "@/server/providers/http/safeFetch";
import { sniffKind } from "@/server/providers/http/sniff";
import type { ExtractedPage, Fetcher, SearchHit, WebSearchProvider } from "@/server/providers/types";
import { TavilyError } from "@/server/providers/tavily/client";
import { normalizeUrl } from "@/server/menu/resolver/urlNormalize";

export interface Route {
  status?: number;
  body?: string | Uint8Array;
  error?: SafeFetchErrorCode;
  delayMs?: number;
  declaredType?: string;
}

export interface FakeFetcher extends Fetcher {
  calls: string[];
  active: number;
  peak: number;
}

const key = (url: string) => `${url.startsWith("http:") ? "http" : "https"}://${normalizeUrl(url)?.comparisonKey ?? url}`;

export function fakeFetcher(routes: Record<string, Route | string | Uint8Array>): FakeFetcher {
  const table = new Map<string, Route>();
  for (const [url, value] of Object.entries(routes)) {
    table.set(key(url), typeof value === "string" || value instanceof Uint8Array ? { body: value } : value);
  }
  const fetcher: FakeFetcher = {
    calls: [],
    active: 0,
    peak: 0,
    async fetch(url, opts) {
      fetcher.calls.push(url);
      fetcher.active++;
      fetcher.peak = Math.max(fetcher.peak, fetcher.active);
      try {
        const route = table.get(key(url));
        if (route?.delayMs) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, route.delayMs);
            opts?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new SafeFetchError("aborted", "aborted"));
            });
          });
        }
        if (opts?.signal?.aborted) throw new SafeFetchError("aborted", "aborted");
        if (!route) throw new SafeFetchError("network", "no route");
        if (route.error) throw new SafeFetchError(route.error, route.error);
        const status = route.status ?? 200;
        const bytes = typeof route.body === "string" ? new TextEncoder().encode(route.body) : (route.body ?? new Uint8Array());
        const ok = status >= 200 && status < 300;
        const result: SafeFetchResult = {
          ok,
          status,
          url,
          redirects: [],
          declaredType: route.declaredType ?? "text/html",
          kind: sniffKind(bytes),
          bytes,
          blockedByServer: status === 401 || status === 403 || status === 429,
          durationMs: 1,
        };
        return result;
      } finally {
        fetcher.active--;
      }
    },
  };
  return fetcher;
}

export interface FakeSearch extends WebSearchProvider {
  searchCalls: string[];
  extractCalls: string[][];
}

export interface FakeSearchConfig {
  search?: Array<{ match: string; hits: SearchHit[] }>;
  extract?: Record<string, string | "fail">;
  failSearch?: boolean;
}

export function fakeSearch(config: FakeSearchConfig = {}): FakeSearch {
  const provider: FakeSearch = {
    searchCalls: [],
    extractCalls: [],
    async search(query) {
      provider.searchCalls.push(query);
      if (config.failSearch) throw new TavilyError("server", "boom", 500);
      return config.search?.find((s) => query.includes(s.match))?.hits ?? [];
    },
    async extract(urls) {
      provider.extractCalls.push(urls);
      const pages: ExtractedPage[] = [];
      const failed: Array<{ url: string; error: string }> = [];
      for (const url of urls) {
        const value = config.extract?.[url] ?? config.extract?.[key(url)];
        if (value === undefined || value === "fail") failed.push({ url, error: "Failed to fetch url" });
        else pages.push({ url, text: value, imageUrls: [], linkUrls: [...value.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]) });
      }
      return { pages, failed };
    },
  };
  return provider;
}

export function html(body: string, opts: { title?: string; scripts?: number } = {}): string {
  const scripts = Array.from({ length: opts.scripts ?? 0 }, (_, i) => `<script src="/s${i}.js"></script>`).join("");
  return `<!doctype html><html><head><title>${opts.title ?? "Restaurant"}</title>${scripts}</head><body>${body}</body></html>`;
}

export function nav(links: Array<[string, string]>): string {
  return `<nav>${links.map(([text, href]) => `<a href="${href}">${text}</a>`).join("")}</nav>`;
}

function pdfString(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch === "€" ? 128 : ch.charCodeAt(0);
    if (ch === "\\" || ch === "(" || ch === ")") out += "\\" + ch;
    else if (code >= 0x20 && code <= 0x7e) out += ch;
    else if (code >= 0xa0 && code <= 0xff) out += "\\" + code.toString(8);
    else if (code === 128) out += "\\200";
    else out += "?";
  }
  return out;
}

export function makeTextPdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const kids: number[] = [];
  const fontId = 3;
  let id = 4;
  const pageObjects: string[] = [];
  for (const lines of pages) {
    const pageId = id++;
    const contentId = id++;
    kids.push(pageId);
    const stream = lines.length ? `BT /F1 12 Tf 40 760 Td 14 TL ${lines.map((l) => `(${pdfString(l)}) '`).join(" ")} ET` : "";
    pageObjects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>\nendobj\n`,
      `${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  }
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>\nendobj\n`);
  objects.push(`${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);
  objects.push(...pageObjects);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(out.length);
    out += o;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export const scannedPdf = (): Uint8Array => makeTextPdf([[]]);

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(1200).fill(1)]);
export const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(1200).fill(7)]);

export const FOOD_LINES = [
  "ENTRANTES",
  "Croquetas de la casa",
  "Ensalada de tomate y burrata",
  "Patatas bravas",
  "PRIMEROS",
  "Arroz de verduras",
  "Pasta fresca al pesto",
  "SEGUNDOS",
  "Merluza a la plancha",
  "Tortilla de patatas",
  "POSTRES",
  "Crema catalana",
  "Tarta de queso",
  "Helado de vainilla",
  "Fruta de temporada",
  "Pan con tomate",
  "Berenjenas fritas",
  "Calamares a la romana",
];
