import * as cheerio from "cheerio";
import { normalizeText } from "@/lib/text";
import { countMatches, DESSERT_CONTENT_TERMS, DRINK_CONTENT_TERMS, GROUP_CONTENT_TERMS, LEGAL_CONTENT_TERMS, SECTION_WORDS } from "./lexicon";
import { resolveUrl } from "./urlNormalize";

export type LinkKind = "anchor" | "iframe" | "embedded" | "image";

export interface PageLink {
  url: string;
  kind: LinkKind;
  anchorText: string;
  title: string;
  context: string;
}

export interface ContentFacts {
  textChars: number;
  sectionHits: number;
  dishLineCount: number;
  priceHits: number;
  drinksHits: number;
  groupHits: number;
  dessertHits: number;
  legalHits: number;
}

export interface PageAnalysis {
  title: string;
  text: string;
  links: PageLink[];
  scriptCount: number;
  isJsShell: boolean;
  facts: ContentFacts;
}

const MAX_TEXT_CHARS = 60_000;
const MAX_LINKS = 400;
const EMBEDDED_URL = /https?:\/\/[^\s"'<>\\)]+/gi;
const EMBEDDED_HINT = /\.pdf(?:[?#]|$)|menu|carta|qr|flip|issuu|calameo|canva|avocaty|cover|thefork|eatkitch/i;
const ASSET_EXT = /\.(?:js|mjs|css|json|map|svg|ico|woff2?|ttf|otf|eot|xml|mp4|webm|gif)(?:[?#]|$)/i;
const PRICE = /(?:\d{1,3}[.,]\d{2}\s?€?|€\s?\d{1,3}(?:[.,]\d{1,2})?|\d{1,3}\s?€)/g;

function clean(value: string | undefined, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function contentFactsFromText(text: string): ContentFacts {
  const limited = text.slice(0, MAX_TEXT_CHARS);
  const normalized = normalizeText(limited);
  const lines = limited
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const dishLines = lines.filter((l) => l.length >= 8 && l.length <= 110 && /[a-zA-ZÀ-ÿ]{3}/.test(l) && /\s/.test(l) && !/^(https?:|www\.)/i.test(l));
  return {
    textChars: limited.length,
    sectionHits: countMatches(normalized, SECTION_WORDS),
    dishLineCount: dishLines.length,
    priceHits: (limited.match(PRICE) ?? []).length,
    drinksHits: countMatches(normalized, DRINK_CONTENT_TERMS),
    groupHits: countMatches(normalized, GROUP_CONTENT_TERMS),
    dessertHits: countMatches(normalized, DESSERT_CONTENT_TERMS),
    legalHits: countMatches(normalized, LEGAL_CONTENT_TERMS),
  };
}

export function analyzeHtml(html: string, baseUrl: string): PageAnalysis {
  const $ = cheerio.load(html);
  const title = clean($("title").first().text(), 160);
  const scriptCount = $("script").length;

  const links: PageLink[] = [];
  const seen = new Set<string>();
  const push = (link: PageLink) => {
    if (links.length >= MAX_LINKS) return;
    const key = `${link.kind}|${link.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };

  $("a[href]").each((_, el) => {
    const url = resolveUrl($(el).attr("href") ?? "", baseUrl);
    if (!url) return;
    const parentText = clean($(el).parent().text(), 120);
    push({
      url,
      kind: "anchor",
      anchorText: clean($(el).text() || $(el).attr("aria-label") || $(el).attr("title"), 120),
      title: clean($(el).attr("title") ?? $(el).attr("aria-label"), 120),
      context: parentText,
    });
  });

  $("iframe[src], embed[src], object[data]").each((_, el) => {
    const url = resolveUrl($(el).attr("src") ?? $(el).attr("data") ?? "", baseUrl);
    if (url) push({ url, kind: "iframe", anchorText: "", title: clean($(el).attr("title"), 120), context: "" });
  });

  $("img[src], img[data-src]").each((_, el) => {
    const url = resolveUrl($(el).attr("data-src") ?? $(el).attr("src") ?? "", baseUrl);
    if (!url) return;
    const alt = clean($(el).attr("alt"), 120);
    const hint = `${alt} ${url}`;
    if (/menu|carta|men%C3%BA|menú/i.test(hint)) push({ url, kind: "image", anchorText: alt, title: alt, context: "" });
  });

  const embeddedSources: string[] = [];
  $("script:not([src])").each((_, el) => {
    embeddedSources.push($(el).text().slice(0, 50_000));
  });
  $("*").each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
    for (const [name, value] of Object.entries(attribs)) {
      if (name === "href" || name === "src" || name === "class" || name === "style" || name.length > 40) continue;
      if (value.length < 2000) embeddedSources.push(value);
    }
  });
  for (const source of embeddedSources) {
    for (const raw of source.match(EMBEDDED_URL) ?? []) {
      const trimmed = raw.replace(/[.,;]+$/, "").split("\\u002F").join("/").split("\\/").join("/");
      if (!EMBEDDED_HINT.test(trimmed) || ASSET_EXT.test(trimmed)) continue;
      const url = resolveUrl(trimmed, baseUrl);
      if (url) push({ url, kind: "embedded", anchorText: "", title: "", context: "" });
    }
  }

  const forText = cheerio.load(html);
  forText("script, style, noscript, template").remove();
  forText("br").replaceWith("\n");
  forText("p, li, h1, h2, h3, h4, h5, h6, div, tr, td, th, section, article, dt, dd, figcaption").each((_, el) => {
    forText(el).append("\n");
  });
  const text = forText("body").text().replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").slice(0, MAX_TEXT_CHARS);
  const facts = contentFactsFromText(text);

  const isJsShell = scriptCount >= 8 && facts.dishLineCount < 8 && facts.sectionHits < 2 && facts.textChars < 2500;

  return { title, text, links, scriptCount, isJsShell, facts };
}

export function parseSitemapUrls(xml: string, max: number): { urls: string[]; childSitemaps: string[] } {
  const urls: string[] = [];
  const childSitemaps: string[] = [];
  const blocks = xml.match(/<(?:url|sitemap)>[\s\S]*?<\/(?:url|sitemap)>/gi) ?? [];
  for (const block of blocks) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(block)?.[1];
    if (!loc) continue;
    const decoded = loc.replace(/&amp;/g, "&");
    if (/^<sitemap>/i.test(block)) childSitemaps.push(decoded);
    else if (urls.length < max) urls.push(decoded);
  }
  return { urls, childSitemaps };
}
