export type SniffedKind = "html" | "text" | "pdf" | "jpeg" | "png" | "webp" | "unknown";

const HTML_MARKERS = [
  "<!doctype html",
  "<html",
  "<head",
  "<body",
  "<meta",
  "<title",
  "<div",
  "<script",
  "<a ",
  "<p>",
];

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 2048);
  if (sample.length === 0) return false;
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / sample.length < 0.02;
}

export function sniffKind(bytes: Uint8Array): SniffedKind {
  if (bytes.length === 0) return "unknown";
  const head = bytes.subarray(0, 1024);
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (!looksLikeText(bytes)) return "unknown";
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 2048)).toLowerCase();
  if (HTML_MARKERS.some((m) => text.includes(m))) return "html";
  return "text";
}

export const IMAGE_KINDS: readonly SniffedKind[] = ["jpeg", "png", "webp"];

export function isImageKind(kind: SniffedKind): boolean {
  return IMAGE_KINDS.includes(kind);
}

export function mimeForKind(kind: SniffedKind): string | undefined {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "html":
      return "text/html";
    case "text":
      return "text/plain";
    default:
      return undefined;
  }
}
