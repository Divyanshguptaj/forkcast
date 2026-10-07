import { httpUrl } from "@/schemas/common";

export interface NormalizedWebsite {
  original?: string;
  httpsCandidate?: string;
}

export function normalizeWebsite(raw: string | undefined): NormalizedWebsite {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (!httpUrl.safeParse(trimmed).success) return {};
  const url = new URL(trimmed);
  if (url.protocol === "https:") return { original: trimmed };
  url.protocol = "https:";
  if (url.port === "80") url.port = "";
  return { original: trimmed, httpsCandidate: url.toString() };
}
