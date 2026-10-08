import { normalizeText } from "@/lib/text";

const MEAT = [
  "jamon", "pernil", "serrano", "iberico", "cerdo", "porc", "cochinillo", "lechon", "panceta", "cansalada", "bacon", "beicon", "tocino", "chorizo", "xoriço", "xorico",
  "morcilla", "botifarra", "butifarra", "sobrasada", "sobrassada", "longaniza", "salchicha", "salsitxa", "embutido", "embotit", "fuet", "lomo", "llom", "ternera",
  "vedella", "buey", "vaca", "carne", "carn", "pollo", "pollastre", "pavo", "gall dindi", "pato", "anec", "conejo", "conill", "cordero", "xai", "cabrito", "cabrit",
  "foie", "higado", "fetge", "callos", "rabo de toro", "cua de bou", "costilla", "costella", "entrecot", "solomillo", "steak", "beef", "pork", "chicken", "lamb", "ham",
  "sausage", "meatball", "albondiga", "albondigas", "mandonguilla", "mandonguilles", "prosciutto", "salami", "pepperoni", "pancetta", "guanciale", "speck", "mortadella",
  "nduja", "bresaola", "ragu", "bolognesa", "bolonyesa", "bolognese", "carbonara", "amatriciana", "cecina", "bacon", "pastrami", "kebab", "gyro",
];

const FISH = [
  "pescado", "peix", "bacalao", "bacalla", "atun", "tonyina", "anchoa", "anchoas", "anxova", "anxoves", "boqueron", "boquerones", "sardina", "sardines", "salmon", "salmo",
  "merluza", "llus", "rape", "dorada", "orada", "lubina", "llobarro", "calamar", "calamares", "chipiron", "chipirones", "sepia", "pulpo", "pop", "gamba", "gambas",
  "langostino", "llagosti", "marisco", "marisc", "mejillon", "mejillones", "musclo", "musclos", "almeja", "almejas", "cloissa", "navaja", "navalla", "ostra", "ostras",
  "cangrejo", "cranc", "bogavante", "llamantol", "langosta", "llagosta", "cigala", "escamarla", "vieira", "zarzuela", "suquet", "fumet", "brandada", "esqueixada", "xato",
  "bonito", "bonitol", "ventresca", "caballa", "verat", "trucha", "caviar", "tarama", "surimi", "sushi", "sashimi", "tuna", "shrimp", "prawn", "prawns", "crab", "lobster",
  "mussels", "anchovy", "anchovies", "seafood", "fish", "cod", "squid", "octopus", "oyster", "oysters", "clams", "calamari", "scallop", "scallops", "tartar de salmon",
];

const ANIMAL_PRODUCTS = [
  "huevo", "huevos", "ou", "ous", "ovo", "tortilla", "truita de patates", "queso", "quesos", "formatge", "formatges", "mozzarella", "parmesano", "parmigiano", "grana",
  "burrata", "ricotta", "gorgonzola", "mato", "requeson", "nata", "leche", "llet", "mantequilla", "mantega", "butter", "yogur", "iogurt", "miel", "mel", "honey",
  "mayonesa", "maionesa", "flan", "natillas", "helado", "gelat", "cheese", "egg", "eggs", "milk", "cream", "tiramisu", "crema catalana", "benedict", "brioche", "pesto",
  "gelatina", "gelatin", "crema",
];

const AMBIGUOUS = [
  "caldo", "brodo", "sopa", "sopes", "arroz", "arros", "paella", "fideua", "fideos", "risotto", "croquetas", "croquetes", "empanadilla", "empanadillas", "canelones",
  "canelons", "lentejas", "llenties", "garbanzos", "cigrons", "judias", "mongetes", "alubias", "pisto", "sofrito", "sofregit", "salsa", "cuajada", "rebozado", "arrebossat",
  "patatas bravas", "braves", "ensaladilla", "ensalada mixta", "amanida mixta", "cesar", "caesar", "alcachofas", "carxofes", "habas", "faves", "hamburguesa", "burger",
  "wrap", "bocadillo", "entrepa", "sandwich", "plato del dia", "plat del dia", "alioli", "allioli", "pasta", "gnocchi", "lasana", "ravioli", "pizza",
];

const GLUTEN = [
  "pan", "pa", "pizza", "pasta", "espagueti", "espaguetis", "tallarines", "macarrones", "canelones", "canelons", "ravioli", "gnocchi", "lasana", "rebozado", "empanado",
  "arrebossat", "croquetas", "croquetes", "empanadilla", "empanadillas", "harina", "farina", "cuscus", "bocadillo", "entrepa", "sandwich", "hamburguesa", "burger", "tostada",
  "torrada", "focaccia", "bruschetta", "crepe", "tempura", "fideua", "fideos", "seitan", "cerveza", "galleta", "tarta", "pastis", "brioche", "wrap", "pita", "bread", "flour",
  "noodles", "dumpling", "gyoza", "gyozas", "tiramisu", "coulant", "brownie", "bunyols",
];

const VEG_LABELS = /(?:^|[\s(\[])(?:\(v\)|\(v(?:\s*[,/]\s*[a-z]{1,3})+\)|\(ve\)|\(vg\)|\[v\]|vegetarian[oa]?s?|vegetarià|vegetaria|veggie|vegan[oa]?s?|plant[- ]based|100\s?%\s?vegetal)(?=$|[\s)\].,;:])/i;
const VEGAN_LABELS = /(?:^|[\s(\[])(?:\(ve\)|\(vg\)|vegan[oa]?s?|plant[- ]based|100\s?%\s?vegetal)(?=$|[\s)\].,;:])/i;
const GF_LABELS = /(?:^|[\s(\[])(?:sin gluten|sense gluten|gluten[- ]free|\(sg\)|\(gf\)|apto celiacos|per a cel[·.]?l[ií]acs)(?=$|[\s)\].,;:])/i;

function matcher(words: string[]): RegExp {
  const body = words.map((w) => normalizeText(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
  return new RegExp(`(?<![a-z])(?:${body})(?:s|es)?(?![a-z])`, "g");
}

const RE = { meat: matcher(MEAT), fish: matcher(FISH), animal: matcher(ANIMAL_PRODUCTS), ambiguous: matcher(AMBIGUOUS), gluten: matcher(GLUTEN) };

function find(re: RegExp, text: string): string[] {
  re.lastIndex = 0;
  const out = new Set<string>();
  for (const m of text.matchAll(re)) out.add(m[0].trim());
  return [...out];
}

export interface LexiconReading {
  meat: string[];
  fish: string[];
  animalProducts: string[];
  ambiguous: string[];
  gluten: string[];
  vegLabel?: string;
  veganLabel?: string;
  glutenFreeLabel?: string;
}

export function readLexicon(...texts: Array<string | undefined>): LexiconReading {
  const raw = texts.filter(Boolean).join(" ");
  const norm = normalizeText(raw);
  return {
    meat: find(RE.meat, norm),
    fish: find(RE.fish, norm),
    animalProducts: find(RE.animal, norm),
    ambiguous: find(RE.ambiguous, norm),
    gluten: find(RE.gluten, norm),
    vegLabel: VEG_LABELS.exec(raw)?.[0].trim(),
    veganLabel: VEGAN_LABELS.exec(raw)?.[0].trim(),
    glutenFreeLabel: GF_LABELS.exec(normalizeText(raw))?.[0].trim() ?? GF_LABELS.exec(raw)?.[0].trim(),
  };
}
