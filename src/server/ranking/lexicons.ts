import { normalizeText } from "@/lib/text";
import type { DishRoleValue } from "@/schemas/recommendations";

const wordRegexCache = new Map<string, RegExp>();

export function hasWord(normalizedText: string, words: readonly string[]): boolean {
  const key = words.join("|");
  let re = wordRegexCache.get(key);
  if (!re) {
    const body = words.map((w) => normalizeText(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
    re = new RegExp(`(?<![a-z])(?:${body})(?:s|es)?(?![a-z])`);
    wordRegexCache.set(key, re);
  }
  return re.test(normalizedText);
}

export function matchedWords(normalizedText: string, words: readonly string[]): string[] {
  return words.map((w) => normalizeText(w)).filter((w) => hasWord(normalizedText, [w]));
}

const DRINK_SECTION_WORDS = ["bebida", "bebidas", "begudes", "beverage", "drink", "cocktail", "coctel", "cocteles", "vino", "vinos", "vi", "wine", "cerveza", "cervezas", "cervesa", "beer", "licor", "licores", "spirits", "infusiones", "refrescos", "cafes", "coffee", "bar"];
const DRINK_NAME_WORDS = ["spritz", "aperol", "vermut", "vermouth", "cocktail", "coctel", "negroni", "mojito", "sangria", "cava", "cerveza", "cervesa", "beer", "vino", "wine", "whisky", "whiskey", "gin tonic", "sake", "limonada", "limonata", "lemonade", "zumo", "suc", "juice", "refresco", "soda", "coca cola", "agua mineral", "kombucha", "espresso", "cappuccino", "latte"];

const ROLE_WORDS: Array<[Exclude<DishRoleValue, "set_menu" | "other" | "drink">, readonly string[]]> = [
  ["dessert", ["postre", "dessert", "dolci", "dolc", "tiramisu", "helado", "gelat", "gelato", "ice cream", "sorbet", "flan", "tarta", "pastis", "cake", "cheesecake", "brownie", "mousse", "coulant", "panna cotta", "crema catalana", "churro", "cannoli", "pudding", "brulee", "sweet", "nachspeise", "sobremesa", "dessert"]],
  ["side", ["guarnicion", "guarnicions", "acompanamiento", "acompanyament", "side", "sides", "contorni", "beilage", "fries", "patatas fritas"]],
  ["starter", ["entrante", "entrants", "starter", "appetizer", "appetiser", "aperitivo", "aperitiu", "tapas", "tapes", "para compartir", "per compartir", "antipasti", "antipasto", "picoteo", "ensalada", "amanida", "salad", "sopa", "soup", "croquetas", "croquetes", "bruschetta", "per comencar", "para empezar", "mezze", "vorspeise", "entree francais", "dim sum", "samosa", "edamame", "hummus"]],
  ["main", ["principal", "plat principal", "main", "mains", "segundos", "secondi", "primi", "primeros", "primers", "plato", "plats", "plat", "piatti", "prato", "hauptgericht", "pasta", "pizza", "pinsa", "calzone", "risotto", "arroz", "arros", "paella", "fideua", "hamburguesa", "burger", "carnes", "pescados", "lasagna", "lasana", "gnocchi", "ravioli", "canelones", "canelons", "tagliatelle", "spaghetti", "fettuccine", "linguine", "penne", "rigatoni", "parmigiana", "wok", "curry", "biryani", "masala", "tikka", "korma", "thali", "ramen", "udon", "soba", "pho", "noodle", "burrito", "taco", "enchilada", "fajita", "quesadilla", "bowl", "poke", "sandwich", "bocadillo", "wrap", "tagine", "tajine", "moussaka", "stew", "estofado", "guiso", "cocido", "steak", "entrecot", "schnitzel", "roast", "grill", "casserole", "gratin"]],
];

export function dishRole(section: string | undefined, name: string, offering: "a_la_carte" | "set_menu" | "dessert", course?: string): DishRoleValue {
  if (offering === "set_menu") return "set_menu";
  if (offering === "dessert") return "dessert";
  const bySection = section ? normalizeText(section) : "";
  if (bySection && hasWord(bySection, DRINK_SECTION_WORDS)) return "drink";
  if (hasWord(normalizeText(name), DRINK_NAME_WORDS)) return "drink";
  for (const [role, words] of ROLE_WORDS) if (bySection && hasWord(bySection, words)) return role;
  if (course === "starter" || course === "main" || course === "side" || course === "dessert") return course;
  const byName = normalizeText(name);
  for (const [role, words] of ROLE_WORDS) if (hasWord(byName, words)) return role;
  return "other";
}

export const ROLE_WEIGHT: Record<DishRoleValue, number> = { main: 1, set_menu: 1, starter: 0.6, other: 0.6, side: 0.4, dessert: 0.25, drink: 0 };

const LIGHT_MEAL_ROLES: ReadonlySet<DishRoleValue> = new Set<DishRoleValue>(["main", "set_menu", "starter"]);
const FULL_MEAL_ROLES: ReadonlySet<DishRoleValue> = new Set<DishRoleValue>(["main", "set_menu"]);

export function mealRoles(meal: string): { roles: ReadonlySet<DishRoleValue>; label: string } {
  return meal === "lunch" || meal === "dinner" ? { roles: FULL_MEAL_ROLES, label: "main course" } : { roles: LIGHT_MEAL_ROLES, label: "main course or starter" };
}

export const CUISINE_DISH_WORDS: Record<string, readonly string[]> = {
  italian: ["pizza", "pasta", "risotto", "gnocchi", "lasagna", "lasana", "ravioli", "tagliatelle", "spaghetti", "carbonara", "bruschetta", "tiramisu", "burrata", "caprese", "focaccia", "parmigiana", "penne", "pesto", "panna cotta", "arancini", "calzone", "antipasti", "fettuccine", "rigatoni", "tortellini", "cannoli"],
  japanese: ["sushi", "ramen", "tempura", "udon", "gyoza", "miso", "sashimi", "teriyaki", "maki", "nigiri", "yakitori", "edamame"],
  mexican: ["taco", "burrito", "quesadilla", "guacamole", "nachos", "enchilada", "fajitas", "tamal"],
  indian: ["curry", "masala", "tikka", "naan", "biryani", "paneer", "samosa", "tandoori", "korma", "dal"],
  spanish: ["tortilla de patatas", "croquetas", "paella", "patatas bravas", "gazpacho", "pimientos de padron", "pan con tomate", "fideua", "bravas"],
  catalan: ["escalivada", "pa amb tomaquet", "calcots", "fideua", "crema catalana", "botifarra", "esqueixada", "samfaina", "canelons"],
  mediterranean: ["hummus", "falafel", "tabbouleh", "couscous", "tzatziki", "moussaka", "escalivada", "paella"],
  thai: ["pad thai", "tom yum", "green curry", "red curry", "satay", "massaman"],
  chinese: ["dim sum", "wonton", "chow mein", "kung pao", "bao", "dumpling"],
  greek: ["moussaka", "souvlaki", "gyros", "tzatziki", "spanakopita", "feta"],
  french: ["quiche", "ratatouille", "crepe", "croissant", "bourguignon", "souffle"],
};

export const KNOWN_CUISINES = Object.keys(CUISINE_DISH_WORDS);

const ALLERGENS: Record<string, readonly string[]> = {
  peanuts: ["cacahuete", "cacauet", "peanut", "mani"],
  nuts: ["nuez", "nueces", "nous", "almendra", "ametlla", "avellana", "avellanes", "pistacho", "pinon", "pinyo", "anacardo", "cashew", "walnut", "almond", "hazelnut", "nuts", "frutos secos", "fruits secs", "pecan", "pistachio"],
  dairy: ["queso", "formatge", "leche", "llet", "nata", "mantequilla", "mantega", "yogur", "iogurt", "cheese", "milk", "cream", "butter", "mozzarella", "burrata", "parmesano", "parmigiano", "ricotta", "gorgonzola", "mascarpone", "feta"],
  eggs: ["huevo", "ou", "ous", "egg", "mayonesa", "maionesa", "tortilla", "carbonara", "tiramisu"],
  gluten: ["pan", "pa", "pizza", "pasta", "espagueti", "tallarines", "macarrones", "canelones", "canelons", "ravioli", "gnocchi", "lasana", "lasagna", "rebozado", "empanado", "arrebossat", "croquetas", "croquetes", "harina", "farina", "cuscus", "bocadillo", "sandwich", "hamburguesa", "burger", "tostada", "torrada", "focaccia", "bruschetta", "crepe", "tempura", "seitan", "bread", "flour", "noodles", "tiramisu", "brownie"],
  shellfish: ["gamba", "langostino", "marisco", "marisc", "mejillon", "musclo", "almeja", "cloissa", "cangrejo", "cranc", "bogavante", "langosta", "ostra", "shrimp", "prawn", "crab", "lobster", "mussel", "clam", "oyster", "seafood", "calamar", "pulpo", "sepia"],
  fish: ["pescado", "peix", "bacalao", "bacalla", "atun", "tonyina", "anchoa", "anxova", "sardina", "salmon", "merluza", "llus", "dorada", "lubina", "fish", "tuna", "cod", "anchovy", "caviar", "surimi", "sushi"],
  soy: ["soja", "soy", "tofu", "edamame", "miso"],
  sesame: ["sesamo", "sesam", "sesame", "tahini"],
};

const ALLERGY_ALIASES: Array<[RegExp, string]> = [
  [/peanut|cacahuete|cacauet|mani\b/, "peanuts"],
  [/tree nut|nut|nuez|fruto seco|fruit sec/, "nuts"],
  [/dairy|lactos|milk|leche|llet|cheese|queso/, "dairy"],
  [/egg|huevo|ou\b/, "eggs"],
  [/gluten|celiac|coeliac|wheat|trigo/, "gluten"],
  [/shellfish|crustacean|marisco|seafood/, "shellfish"],
  [/fish|pescado|peix/, "fish"],
  [/soy|soja/, "soy"],
  [/sesame|sesamo/, "sesame"],
];

export function allergenWords(allergy: string): { key: string; words: readonly string[] } {
  const norm = normalizeText(allergy);
  for (const [re, key] of ALLERGY_ALIASES) if (re.test(norm)) return { key, words: ALLERGENS[key] };
  return { key: norm, words: [norm] };
}

const DISLIKE_SYNONYMS: Record<string, readonly string[]> = {
  mushroom: ["champinon", "seta", "bolet", "funghi", "mushroom", "portobello"],
  cilantro: ["cilantro", "coriandre", "coriander", "culantro"],
  coriander: ["cilantro", "coriandre", "coriander"],
  onion: ["cebolla", "ceba", "onion", "cebolleta"],
  olive: ["aceituna", "oliva", "olive"],
  tomato: ["tomate", "tomaquet", "tomato"],
  garlic: ["ajo", "garlic", "alioli", "allioli"],
  eggplant: ["berenjena", "albergina", "eggplant", "aubergine"],
  aubergine: ["berenjena", "albergina", "eggplant", "aubergine"],
  pepper: ["pimiento", "pebrot", "pepper", "pimientos"],
  cheese: ["queso", "formatge", "cheese"],
  spicy: ["picante", "picant", "spicy", "chili", "chile", "guindilla"],
  pineapple: ["pina", "pineapple", "anana"],
};

export function dislikeWords(food: string): readonly string[] {
  const norm = normalizeText(food).replace(/s$/, "");
  return DISLIKE_SYNONYMS[norm] ?? [normalizeText(food)];
}
