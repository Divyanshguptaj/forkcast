export const FLIPBOOK_VIEWER_HOSTS = [
  "fliphtml5.com",
  "online.fliphtml5.com",
  "issuu.com",
  "calameo.com",
  "flipsnack.com",
  "heyzine.com",
  "canva.com",
] as const;

export const MENU_HOST_HINTS = [
  "avocaty.io",
  "cartaqr",
  "menuqr",
  "qrmenu",
  "carta.menu",
  "eatkitch.com",
] as const;

export const THIRD_PARTY_ALLOWLIST = [
  "thefork.com",
  "tripadvisor.com",
  "tripadvisor.es",
  "ubereats.com",
  "glovoapp.com",
  "just-eat.es",
] as const;

export const SOCIAL_AND_MAP_HOSTS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "pinterest.com",
  "maps.google.com",
  "goo.gl",
  "google.com",
  "apple.com",
  "wa.me",
  "whatsapp.com",
  "t.me",
  "wixsite.com/dashboard",
] as const;

export const MENU_LEXICON = [
  "menu",
  "menú",
  "carta",
  "cartes",
  "la-carta",
  "food",
  "comida",
  "brunch",
  "desayunos",
  "plats",
  "platos",
] as const;

export function hostMatches(hostname: string, list: readonly string[]): boolean {
  const h = hostname.toLowerCase();
  return list.some((d) => h === d || h.endsWith(`.${d}`) || h.includes(d));
}
