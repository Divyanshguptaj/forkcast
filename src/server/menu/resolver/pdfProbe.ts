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
