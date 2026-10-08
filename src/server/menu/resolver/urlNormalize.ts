const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "dclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "yclid",
  "_ga",
  "_gl",
  "tracking",
  "g_mp",
  "ref",
  "ref_src",
  "source",
]);

const TWO_LEVEL_SUFFIXES = new Set(["com.es", "org.es", "nom.es", "co.uk", "org.uk", "com.ar", "com.mx", "com.br", "co.za", "com.au"]);

export interface NormalizedUrl {
  originalUrl: string;
  normalizedUrl: string;
  comparisonKey: string;
  host: string;
  registrableDomain: string;
}

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

const PRIVATE_SUFFIXES = [
  "dish.co", "wixsite.com", "wix.com", "wordpress.com", "blogspot.com", "squarespace.com", "weebly.com", "godaddysites.com", "business.site", "webflow.io",
  "netlify.app", "vercel.app", "github.io", "herokuapp.com", "carrd.co", "jimdosite.com", "jimdofree.com", "site123.me", "webnode.es", "myshopify.com", "web.app", "firebaseapp.com", "pages.dev",
];

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "").split(".");
  const joined = labels.join(".");
  const platform = PRIVATE_SUFFIXES.find((suffix) => joined.endsWith(`.${suffix}`));
  if (platform) return labels.slice(-(platform.split(".").length + 1)).join(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

export function resolveUrl(href: string, base: string): string | undefined {
  const trimmed = href.trim();
  if (!trimmed || /^(mailto:|tel:|javascript:|data:|sms:|whatsapp:|#)/i.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeUrl(input: string, base?: string): NormalizedUrl | undefined {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;

  const original = url.toString();
  url.hash = "";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  url.hostname = host;
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";

  const kept = [...url.searchParams.entries()].filter(([name]) => !isTrackingParam(name)).sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [name, value] of kept) url.searchParams.append(name, value);

  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;

  const normalizedUrl = url.toString().replace(/\/$/, url.search ? "/" : "");
  const bareHost = host.replace(/^www\./, "");
  const comparisonKey = `${bareHost}${path}${url.search}`.toLowerCase();

  return { originalUrl: original, normalizedUrl, comparisonKey, host, registrableDomain: registrableDomain(host) };
}

export function sameSite(a: string, b: string): boolean {
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  return Boolean(na && nb && na.registrableDomain === nb.registrableDomain);
}

export function httpsVariant(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return undefined;
    parsed.protocol = "https:";
    if (parsed.port === "80") parsed.port = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}
