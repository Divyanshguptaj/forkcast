import { normalizeText } from "@/lib/text";

function terms(list: string[]): RegExp {
  const body = list.map((t) => normalizeText(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_-]*")).join("|");
  return new RegExp(`(?:^|[^a-z0-9])(?:${body})(?=$|[^a-z0-9])`, "i");
}

export const MENU_TERMS = terms([
  "menu",
  "menus",
  "carta",
  "cartas",
  "la carta",
  "nuestra carta",
  "nostra carta",
  "cartes",
  "food",
  "foods",
  "comida",
  "comidas",
  "menjar",
  "dinner",
  "lunch",
  "brunch",
  "breakfast",
  "desayunos",
  "almuerzo",
  "cena",
  "sopar",
  "dinar",
  "esmorzar",
  "gastronomia",
  "gastronomy",
  "gastronomia",
  "platos",
  "plats",
  "tapas",
  "tapes",
  "entrantes",
  "entrants",
  "ver carta",
  "veure carta",
  "view menu",
  "see menu",
  "our menu",
  "qr",
  "carta qr",
]);

export const DRINKS_TERMS = terms([
  "bebidas",
  "begudes",
  "drinks",
  "beverages",
  "vinos",
  "vins",
  "vino",
  "wine",
  "wines",
  "carta de vinos",
  "carta de vins",
  "cocktails",
  "coctel",
  "cocteles",
  "cervezas",
  "cerveses",
  "beer",
  "cava",
  "licores",
  "spirits",
  "wine list",
]);

export const DESSERT_TERMS = terms(["postres", "postre", "desserts", "dessert", "dolcos", "dolços", "postres de la casa", "sweets"]);

export const SET_MENU_TERMS = terms([
  "menu del dia",
  "menu diario",
  "menu ejecutivo",
  "menu executiu",
  "menu del dia",
  "menu grupo",
  "menus grupos",
  "menu grupos",
  "grupos",
  "grups",
  "groups",
  "group menu",
  "eventos",
  "events",
  "celebraciones",
  "celebracions",
  "banquetes",
  "catering",
  "degustacion",
  "degustacio",
  "tasting",
  "menu cerrado",
  "prefixed",
  "preu fix",
  "precio fijo",
  "set menu",
  "navidad",
  "nadal",
]);

export const NEGATIVE_TERMS = terms([
  "privacy",
  "privacidad",
  "privacitat",
  "legal",
  "aviso legal",
  "avis legal",
  "terms",
  "terminos",
  "condiciones",
  "condicions",
  "cookies",
  "cookie",
  "politica",
  "careers",
  "trabaja",
  "trabajo",
  "jobs",
  "empleo",
  "press",
  "prensa",
  "premsa",
  "newsletter",
  "blog",
  "noticias",
  "gift",
  "regalo",
  "bono",
  "alergenos",
  "allergens",
  "accessibility",
  "accesibilidad",
  "sitemap",
  "reservas",
  "reservations",
  "reserva",
  "contact",
  "contacto",
  "contacte",
  "galeria",
  "gallery",
]);

export const LEGAL_CONTENT_TERMS = [
  "politica de privacidad",
  "aviso legal",
  "proteccion de datos",
  "responsable del tratamiento",
  "terms and conditions",
  "condiciones generales",
  "derechos arco",
  "privacy policy",
];

export const SECTION_WORDS = [
  "entrantes",
  "entrants",
  "primeros",
  "primers",
  "segundos",
  "segons",
  "principales",
  "platos principales",
  "postres",
  "ensaladas",
  "amanides",
  "carnes",
  "carns",
  "pescados",
  "peixos",
  "arroces",
  "arrossos",
  "tapas",
  "tapes",
  "pizzas",
  "pastas",
  "bocadillos",
  "entrepans",
  "sopas",
  "sopes",
  "guarniciones",
  "acompanyaments",
  "starters",
  "mains",
  "desserts",
  "salads",
  "sides",
  "rice",
  "pasta",
  "platos",
  "plats",
  "torrades",
  "tostadas",
  "croquetas",
  "croquetes",
  "bravas",
  "gyozas",
  "antipasti",
  "secondi",
  "primi",
  "dolci",
];

export const DRINK_CONTENT_TERMS = ["d.o.", "do ", "tinto", "negre", "blanco", "blanc", "rosado", "cerveza", "cervesa", "cava", "cl.", "copa", "botella", "ampolla", "licor", "vermut", "gin", "whisky", "refresco"];
export const GROUP_CONTENT_TERMS = ["grupos", "grups", "minimo", "minim", "personas", "persones", "por persona", "per persona", "menu cerrado", "celebracion", "evento", "bebida incluida", "iva incluido", "precio por"];
export const DESSERT_CONTENT_TERMS = ["tarta", "pastis", "helado", "gelat", "flan", "crema catalana", "coulant", "brownie", "tiramisu", "mousse", "sorbete", "sorbet"];

export function countMatches(normalizedText: string, words: readonly string[]): number {
  let hits = 0;
  for (const word of words) {
    const w = normalizeText(word);
    if (w && normalizedText.includes(w)) hits++;
  }
  return hits;
}

export const matches = (re: RegExp, text: string): boolean => re.test(normalizeText(text));

export const URL_STEMS = {
  food: ["menu", "carta", "tapas", "tapes", "brunch", "desayun", "almuerzo"],
  drinks: ["bebidas", "begudes", "drinks", "vinos", "vins", "wine", "cocktail", "coctel", "cerveza", "cervez"],
  dessert: ["postres", "postre", "dessert", "dolcos", "dolços"],
  set: ["grupos", "grups", "groups", "ejecutivo", "executiu", "evento", "event", "menudia", "menudeldia", "menudiario", "degustacion", "tasting", "celebracion", "banquete", "catering", "navidad", "nadal"],
  legal: ["legal", "privacy", "privacidad", "privacitat", "cookies", "terms", "condiciones", "condicions", "aviso", "alergen", "allergen", "politica", "careers", "empleo", "jobs", "press-kit", "presskit", "newsletter"],
} as const;

export function urlHasStem(url: string, stems: readonly string[]): boolean {
  const target = normalizeText(decodeURIComponentSafe(url));
  return stems.some((s) => target.includes(normalizeText(s)));
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
