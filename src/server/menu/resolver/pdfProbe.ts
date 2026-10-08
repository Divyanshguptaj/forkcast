import { extractText, getDocumentProxy } from "unpdf";

export interface PdfSample {
  pageCount: number;
  sampleText: string;
  avgCharsPerPage: number;
  looksScanned: boolean;
}

const SAMPLE_PAGES = 2;
const SAMPLE_CHARS = 6_000;
const SCANNED_CHARS_PER_PAGE = 150;

export interface PdfPages {
  pageCount: number;
  pages: string[];
  avgCharsPerPage: number;
  looksScanned: boolean;
}

export async function extractPdfPages(bytes: Uint8Array, maxPages: number): Promise<PdfPages | undefined> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    const pageCount = doc.numPages;
    const { text } = await extractText(doc, { mergePages: false });
    const all = Array.isArray(text) ? text : [text];
    const pages = all.slice(0, maxPages);
    const avg = Math.round(pages.reduce((n, p) => n + p.length, 0) / Math.max(1, pages.length));
    return { pageCount, pages, avgCharsPerPage: avg, looksScanned: avg < SCANNED_CHARS_PER_PAGE };
  } catch {
    return undefined;
  }
}

export async function samplePdf(bytes: Uint8Array): Promise<PdfSample | undefined> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    const pageCount = doc.numPages;
    const { text } = await extractText(doc, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    const sampled = pages.slice(0, SAMPLE_PAGES);
    const sampleText = sampled.join("\n").slice(0, SAMPLE_CHARS);
    const avg = Math.round(sampled.reduce((n, p) => n + p.length, 0) / Math.max(1, sampled.length));
    return { pageCount, sampleText, avgCharsPerPage: avg, looksScanned: avg < SCANNED_CHARS_PER_PAGE };
  } catch {
    return undefined;
  }
}
