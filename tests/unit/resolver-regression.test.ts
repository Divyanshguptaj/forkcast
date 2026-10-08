import { describe, expect, it } from "vitest";
import { resolveMenu, type ResolverDeps, type ResolverRestaurant } from "@/server/menu/resolver";
import { MenuResolutionSchema, type MenuResolution } from "@/schemas/menuResolution";
import { FOOD_LINES, PNG_BYTES, fakeFetcher, fakeSearch, html, makeTextPdf, nav, scannedPdf, type FakeSearchConfig, type Route } from "../helpers/resolverKit";

async function run(restaurant: ResolverRestaurant, routes: Record<string, Route | string | Uint8Array>, search: FakeSearchConfig = {}, extra: Partial<ResolverDeps> = {}) {
  const fetcher = fakeFetcher(routes);
  const provider = fakeSearch(search);
  const result = await resolveMenu(restaurant, { fetcher, search: provider, ...extra });
  expect(MenuResolutionSchema.safeParse(result).success, JSON.stringify(MenuResolutionSchema.safeParse(result).error?.issues.slice(0, 2))).toBe(true);
  return { result, fetcher, provider };
}

const urls = (r: MenuResolution) => r.selected.map((s) => s.url);
const kinds = (r: MenuResolution) => r.selected.map((s) => s.documentKind).sort();

const dessertLines = ["POSTRES", "Crema catalana", "Tarta de queso", "Helado de vainilla", "Flan casero", "Coulant de chocolate", "Brownie con helado", "Mousse de limón", "Sorbete de mango", "Tiramisú", "Fruta de temporada", "Café"];
const wineLines = ["VINS", "Tinto D.O. Montsant copa 6", "Blanco D.O. Penedès copa 5", "Cava Brut botella 24", "Cerveza 33 cl 3", "Vermut copa 4", "Rosado D.O. Empordà copa 5", "Gin tonic 9", "Whisky copa 8", "Refresco 3"];
const groupLines = ["MENÚ DE GRUPOS", "Mínimo 10 personas", "Precio por persona 35 euros IVA incluido", "Bebida incluida", "Entrantes al centro", "Segundos a elegir", "Postre del día", "Celebraciones y eventos", "Menú cerrado para grupos"];

describe("Vegan Tulsi: official FlipHTML5 menu (Phase 0 regression)", () => {
  const tulsi: ResolverRestaurant = {
    placeId: "tulsi",
    name: "Vegan Tulsi Restaurant",
    address: "Carrer dels Àngels, 8, Ciutat Vella, 08001 Barcelona, Spain",
    city: "Barcelona",
    websiteUrl: "https://www.vegan-tulsi.com/",
  };
  const FLIP = "https://online.fliphtml5.com/zyrook/ESP-CARTA-2026-TULSI/";
  const routes = {
    "https://www.vegan-tulsi.com/": html(
      nav([["INICIO", "/"], ["RESERVAS", "/book-now"], ["CARTA", "/menus"], ["GALERÍA", "/gallery"], ["CONTACTO", "/contact"], ["¡DELIVERY!", "https://tulsi-vegan.eatkitch.com/"]]) +
        `<a href="https://www.instagram.com/tulsirestaurantevegano/"></a>`,
      { scripts: 3 },
    ),
    "https://www.vegan-tulsi.com/menus": html(
      `<h1>Vegan Tulsi Restaurant menú</h1><p>Puedes ver todos nuestros platos aquí. Recuerda que también puedes ordenar por Glovo, Just Eat y Uber Eats</p>
       <a href="${FLIP}">Castellano</a><a href="${FLIP}">English</a><a href="${FLIP}">Catalán</a><p>There are no items to show here yet.</p>`,
    ),
    "https://tulsi-vegan.eatkitch.com/": { error: "dns_failed" as const },
  };

  it("returns found_but_unreadable with the official URL, not unavailable", async () => {
    const { result } = await run(tulsi, routes);
    expect(result.status).toBe("found_but_unreadable");
    if (result.status !== "found_but_unreadable") return;
    expect(result.unreadableReason).toBe("flipbook_viewer");
    expect(result.officialMenuUrl).toBe(FLIP);
    expect(result.selected).toEqual([]);
  });

  it("keeps the flipbook as an official_linked viewer candidate and does not fetch it", async () => {
    const { result, fetcher } = await run(tulsi, routes);
    const flip = result.candidates.find((c) => c.url === FLIP)!;
    expect(flip).toMatchObject({ tier: "official_linked", mediaType: "viewer", readability: "viewer", documentKind: "food_menu" });
    expect(flip.menuLikelihood).toBeGreaterThanOrEqual(0.55);
    expect(fetcher.calls).not.toContain(FLIP);
    expect(result.candidates.filter((c) => c.url === FLIP)).toHaveLength(1);
  });

  it("does not select the landing page itself, and needs no Tavily or Gemini calls", async () => {
    const { result, provider } = await run(tulsi, routes);
    const landing = result.candidates.find((c) => c.url === "https://www.vegan-tulsi.com/menus")!;
    expect(landing.selected).toBe(false);
    expect(landing.menuLikelihood).toBeLessThan(0.55);
    expect(provider.searchCalls).toHaveLength(0);
    expect(provider.extractCalls).toHaveLength(0);
    expect(result.usage).toMatchObject({ tavilySearches: 0, tavilyExtracts: 0, geminiCalls: 0 });
    expect(result.usage.directFetches).toBeLessThanOrEqual(4);
  });

  it("never scrapes around the viewer", async () => {
    const { fetcher } = await run(tulsi, routes);
    expect(fetcher.calls.some((u) => u.includes("fliphtml5"))).toBe(false);
  });
});

describe("Vegan Tulsi aggregator with a different address (identity mismatch)", () => {
  const tulsi: ResolverRestaurant = { placeId: "tulsi2", name: "Vegan Tulsi Restaurant", address: "Carrer dels Àngels, 8, 08001 Barcelona", city: "Barcelona", websiteUrl: undefined };
  const AGG = "https://weur-cdn.carta.menu/storage/media/companies_menu_pdf/57390016/tulsi-vegan-barcelona-carta.pdf";
  const aggregatorText = "Carta de menús Tulsi Vegan Carrer Del Consell De Cent, 279, 08011 Barcelona (Barcelona) https://www.vegantulsi.com/ Aquí encontrarás el menú de Tulsi Vegan. Entrantes Sopas Gazpacho Platos Principales Postres Tapas";

  it("rejects the wrong-address source and reports an identity mismatch", async () => {
    const { result } = await run(
      tulsi,
      { [AGG]: { status: 403, body: "forbidden" } },
      {
        search: [{ match: "Tulsi", hits: [{ url: AGG, title: "Carta de menús Tulsi Vegan", snippet: "Tulsi Vegan Barcelona carta" }] }],
        extract: { [AGG]: `# Carta\n${aggregatorText}\n${FOOD_LINES.join("\n")}` },
      },
    );
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.unavailableReason).toBe("identity_mismatch");
    const agg = result.candidates.find((c) => c.url === AGG)!;
    expect(agg.rejectedReason).toMatch(/identity mismatch/);
    expect(agg.selected).toBe(false);
  });
});

describe("Can Culleretes: several legitimate menu PDFs", () => {
  const r: ResolverRestaurant = { placeId: "culleretes", name: "Restaurant Can Culleretes", address: "Carrer d'en Quintana, 5, Barcelona", city: "Barcelona", websiteUrl: "https://culleretes.com/" };
  const base = "https://culleretes.com/wp-content/uploads/2023/03";
  const routes = {
    "https://culleretes.com/": html(nav([["Carta", `${base}/CanCulleretes_Carta_2023.pdf`], ["Menús", `${base}/CanCulleretes_Menus.pdf`], ["Nit de Tapes", `${base}/CanCulleretes_NitTapes.pdf`], ["Contacto", "/contacto"]])),
    [`${base}/CanCulleretes_Carta_2023.pdf`]: makeTextPdf([FOOD_LINES]),
    [`${base}/CanCulleretes_Menus.pdf`]: makeTextPdf([FOOD_LINES]),
    [`${base}/CanCulleretes_NitTapes.pdf`]: makeTextPdf([["TAPAS", ...FOOD_LINES]]),
  };

  it("keeps all three documents with official_site tier and pdf media type", async () => {
    const { result, provider } = await run(r, routes);
    expect(result.status).toBe("resolved");
    expect(result.selected).toHaveLength(3);
    expect(result.selected.every((s) => s.tier === "official_site" && s.mediaType === "pdf" && s.readability === "readable")).toBe(true);
    expect(provider.searchCalls).toHaveLength(0);
  });
});

describe("Ca l'Estevet: food vs dessert vs wine", () => {
  const r: ResolverRestaurant = { placeId: "estevet", name: "Ca l'Estevet", address: "Carrer d'Valldonzella, 46, Barcelona", city: "Barcelona", websiteUrl: "https://www.restaurantestevet.com/" };
  const base = "https://www.restaurantestevet.com/wp-content/uploads";
  const routes = {
    "https://www.restaurantestevet.com/": html(nav([["Carta", `${base}/cartaESTEVETestiu26web.pdf`], ["Postres", `${base}/postresESTEVET26web.pdf`], ["Vins", `${base}/vinsESTEVETestiu26web.pdf`]])),
    [`${base}/cartaESTEVETestiu26web.pdf`]: makeTextPdf([FOOD_LINES]),
    [`${base}/postresESTEVET26web.pdf`]: makeTextPdf([dessertLines]),
    [`${base}/vinsESTEVETestiu26web.pdf`]: makeTextPdf([wineLines]),
  };

  it("selects the food and dessert menus but not the wine list", async () => {
    const { result } = await run(r, routes);
    expect(result.status).toBe("resolved");
    expect(kinds(result)).toEqual(["dessert_menu", "food_menu"]);
    const wine = result.candidates.find((c) => c.url.includes("vins"))!;
    expect(wine.documentKind).toBe("drinks_or_wine");
    expect(wine.selected).toBe(false);
  });
});

describe("Gloria Osteria: legal PDF is not a menu", () => {
  const r: ResolverRestaurant = { placeId: "gloria", name: "Gloria Osteria Barcelona", address: "Carrer de Fígols, 8, Barcelona", city: "Barcelona", websiteUrl: "https://gloria-osteria.com/" };
  const MENU = "https://gloria-osteria.com/bg13/production/8e6b35a42024b209e4d76bc1f79e70b0b17a1a47.pdf";
  const LEGAL = "https://gloria-osteria.com/Gloria-Osteria-Legal-en.pdf";
  const routes = {
    "https://gloria-osteria.com/": html(nav([["Menu", MENU], ["Legal", LEGAL]])),
    [MENU]: makeTextPdf([FOOD_LINES]),
    [LEGAL]: makeTextPdf([["Política de privacidad", "Aviso legal", "Protección de datos"]]),
  };

  it("selects only the hash-named menu and never downloads the legal file", async () => {
    const { result, fetcher } = await run(r, routes);
    expect(urls(result)).toEqual([MENU]);
    const legal = result.candidates.find((c) => c.url === LEGAL)!;
    expect(legal.documentKind).toBe("not_a_menu");
    expect(legal.selected).toBe(false);
    expect(fetcher.calls).not.toContain(LEGAL);
  });
});

describe("Xup Xup: groups, drinks and executive menus", () => {
  const r: ResolverRestaurant = { placeId: "xup", name: "Xup Xup Restaurant", address: "Carrer de Sants, 1, Barcelona", city: "Barcelona", websiteUrl: "https://xupxup.example/" };
  const base = "https://gruparenal.com/wp-content/uploads";
  const routes = {
    "https://xupxup.example/": html(nav([["Menús de grupos", `${base}/2026/01/menus-grupos-xup-xup-restaurant-enero-2026.pdf`], ["Carta de bebidas", `${base}/2026/07/carta-bebidas-xup-xup-restaurant-julio-26.pdf`], ["Menú ejecutivo", `${base}/2026/09/menu-ejecutivo-xupxup-restaurant-sept-26.pdf`]])),
    [`${base}/2026/01/menus-grupos-xup-xup-restaurant-enero-2026.pdf`]: makeTextPdf([groupLines]),
    [`${base}/2026/07/carta-bebidas-xup-xup-restaurant-julio-26.pdf`]: makeTextPdf([wineLines]),
    [`${base}/2026/09/menu-ejecutivo-xupxup-restaurant-sept-26.pdf`]: makeTextPdf([["MENÚ EJECUTIVO", ...FOOD_LINES]]),
  };

  it("keeps the set menus linked from the official site and excludes drinks", async () => {
    const { result } = await run(r, routes);
    expect(result.status).toBe("resolved");
    expect(kinds(result)).toEqual(["set_menu_or_groups", "set_menu_or_groups"]);
    const drinks = result.candidates.find((c) => c.url.includes("bebidas"))!;
    expect(drinks.documentKind).toBe("drinks_or_wine");
    expect(drinks.selected).toBe(false);
    expect(result.selected.every((s) => s.tier === "official_linked")).toBe(true);
  });
});

describe("Cal Boter: Catalan HTML menu without prices", () => {
  const r: ResolverRestaurant = { placeId: "calboter", name: "Restaurant Cal Boter", address: "Carrer de Tordera, 29, Barcelona", city: "Barcelona", websiteUrl: "https://www.restaurantcalboter.com/" };
  const menjars = html(
    `<h1>Carta de menjars</h1>` +
      ["Les nostres Amanides", "Xatonada", "Endivia arrissada amb bacallà salat i anxoves", "Entrants freds", "Escalivada amb oli d'oliva", "Esqueixada de bacallà amb ceba", "Plats elaborats", "Canelons de la casa", "Les nostres Carns", "Botifarra amb mongetes", "Acompanyaments", "Patates fregides", "Salses", "Salsa romesco", "Postres", "Crema catalana", "Flam de la casa", "Torrada de brioix", "Sopes", "Escudella"]
        .map((l) => `<p>${l}</p>`)
        .join(""),
  );
  const routes = {
    "https://www.restaurantcalboter.com/": html(nav([["Carta de menjars", "/carta-de-menjars.html"], ["Carta de vins", "/carta-de-vins.html"], ["Cuina tradicional", "/cuina-tradicional.html"]])),
    "https://www.restaurantcalboter.com/carta-de-menjars.html": menjars,
    "https://www.restaurantcalboter.com/carta-de-vins.html": html(`<h1>Carta de vins</h1>${wineLines.map((l) => `<p>${l}</p>`).join("")}`),
  };

  it("recognises the page as a food menu even though it has no prices", async () => {
    const { result } = await run(r, routes);
    expect(result.status).toBe("resolved");
    expect(urls(result)).toEqual(["https://www.restaurantcalboter.com/carta-de-menjars.html"]);
    const sel = result.selected[0];
    expect(sel.documentKind).toBe("food_menu");
    expect(sel.menuLikelihood).toBeGreaterThanOrEqual(0.55);
    expect(sel.signals.join(" ")).not.toMatch(/price/i);
    const wine = result.candidates.find((c) => c.url.endsWith("carta-de-vins.html"))!;
    expect(wine.selected).toBe(false);
  });
});

describe("Barceloneta: PDF without a .pdf extension", () => {
  const r: ResolverRestaurant = { placeId: "barceloneta", name: "Barceloneta restaurant", address: "Passeig Joan de Borbó, 1, Barcelona", city: "Barcelona", websiteUrl: "https://restaurantbarceloneta.com/" };
  const routes = {
    "https://restaurantbarceloneta.com/": html(nav([["Carta", "/barceloneta-carta-esp/"], ["Reservas", "/reservas"]])),
    "https://restaurantbarceloneta.com/barceloneta-carta-esp/": { body: scannedPdf(), declaredType: "text/html" },
  };

  it("detects the PDF from its bytes, including a scanned one", async () => {
    const { result } = await run(r, routes);
    expect(result.status).toBe("resolved");
    expect(result.selected[0]).toMatchObject({ mediaType: "pdf", documentKind: "food_menu", tier: "official_site", readability: "readable" });
    expect(result.selected[0].signals.join(" ")).toMatch(/scanned/);
  });
});

describe("Pepa Tomate: JS shell, then a QR host through Tavily", () => {
  const r: ResolverRestaurant = { placeId: "paella", name: "Paella Bar Boqueria", address: "Carrer de la Boqueria, 12, Barcelona", city: "Barcelona", websiteUrl: "https://www.pepatomategrup.com/es/" };
  const QR = "https://carta.avocaty.io/paellabar/7YYVGarIxQ5r0GHk6G2c";
  const shell = html(`<div id="app"></div>`, { scripts: 12 });
  const routes = {
    "https://www.pepatomategrup.com/es/": html(nav([["Carta", "/es/carta/?sede=gracia"], ["Carta grupos", "/es/carta/?sede=gracia&view=groups"]]), { scripts: 3 }),
    "https://www.pepatomategrup.com/es/carta/?sede=gracia": shell,
    "https://www.pepatomategrup.com/es/carta/?sede=gracia&view=groups": shell,
    [QR]: html(`<div id="root"></div>`, { scripts: 36 }),
  };
  const searchConfig: FakeSearchConfig = {
    search: [{ match: "Paella Bar Boqueria", hits: [{ url: QR, title: "Carta | Paella Bar Boqueria", snippet: "Carta de Paella Bar Boqueria Barcelona. Entrantes, arroces y tapas." }] }],
    extract: {
      "https://www.pepatomategrup.com/es/carta/?sede=gracia": "# Carta",
      "https://www.pepatomategrup.com/es/carta/?sede=gracia&view=groups": "# Carta",
      [QR]: `# Carta\n## Entrantes\n${FOOD_LINES.map((l) => `${l} 8,50 €`).join("\n")}\nPaella Bar Boqueria`,
    },
  };

  it("treats the direct shell as insufficient and resolves the QR host via search plus extract", async () => {
    const { result, provider } = await run(r, routes, searchConfig);
    expect(result.status).toBe("resolved");
    expect(result.selected[0].url).toBe(QR);
    expect(result.selected[0].tier).toBe("unverified_asset");
    expect(result.selected[0].mediaType).toBe("external_host");
    expect(provider.searchCalls.length).toBeGreaterThanOrEqual(1);
    expect(provider.extractCalls.flat()).toContain(QR);
    expect(result.usage.tavilySearches).toBe(provider.searchCalls.length);
    if (result.status === "resolved") expect(result.officialMenuUrl).toContain("pepatomategrup.com");
  });

  it("lists the JS-only official pages as unreadable candidates", async () => {
    const { result } = await run(r, routes, searchConfig);
    const official = result.candidates.filter((c) => c.tier === "official_site" && c.url.includes("carta"));
    expect(official.length).toBeGreaterThan(0);
    expect(official.every((c) => c.readability === "js_only")).toBe(true);
  });
});

describe("Antic Pitarra: no menu anywhere", () => {
  const r: ResolverRestaurant = { placeId: "pitarra", name: "Antic Pitarra", address: "Carrer d'Avinyó, 56, Barcelona", city: "Barcelona", websiteUrl: "https://anticpitarra.cat/" };
  const routes = {
    "https://anticpitarra.cat/": html(`<h1>Restaurante Antic Pitarra</h1><nav><a href="#menu">Nuestro Menú</a><a href="#about">Sobre Nosotros</a></nav><img src="/images/Storefront1.png"><p>Tapas Especialidades Carnes</p>`, { scripts: 6 }),
  };
  const search: FakeSearchConfig = {
    search: [
      {
        match: "Antic Pitarra",
        hits: [
          { url: "https://www.tripadvisor.es/Restaurant_Review-Antic_Pitarra", title: "Antic Pitarra - Tripadvisor", snippet: "Reseñas" },
          { url: "https://www.opentable.com/r/antic-pitarra-barcelona", title: "Antic Pitarra - OpenTable", snippet: "Reserva" },
          { url: "https://www.thefork.com/restaurant/antic-pitarra-r841482", title: "Antic Pitarra, Barcelona - TheFork", snippet: "Reserva ahora" },
          { url: "https://www.instagram.com/popular/antic-pitarra-menu", title: "Antic Pitarra menu", snippet: "Instagram" },
          { url: "https://anticpitarra.cat", title: "Restaurante Antic Pitarra", snippet: "Desde 1890" },
        ],
      },
    ],
  };

  it("resolves gracefully as unavailable, after trying every stage", async () => {
    const { result } = await run(r, routes, search);
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.unavailableReason).toBe("no_menu_found");
    expect(result.stages.map((s) => s.stage)).toEqual(["site", "search", "assets", "third_party"]);
    expect(result.stages.every((s) => !s.found)).toBe(true);
    expect(result.usage.tavilySearches).toBeLessThanOrEqual(4);
    expect(result.candidates.every((c) => !c.url.includes("instagram"))).toBe(true);
  });
});

describe("Ostaia: menu on the homepage", () => {
  const r: ResolverRestaurant = { placeId: "ostaia", name: "Ostaia - Eixample", address: "Carrer de Muntaner, 1, Barcelona", city: "Barcelona", websiteUrl: "https://www.ostaia.com/" };
  it("uses the homepage as the menu document", async () => {
    const body = html(`<h1>Ostaia</h1>${FOOD_LINES.map((l) => `<p>${l} 11,00 €</p>`).join("")}`, { scripts: 2 });
    const { result } = await run(r, { "https://www.ostaia.com/": body });
    expect(result.status).toBe("resolved");
    expect(result.selected[0]).toMatchObject({ mediaType: "html", tier: "official_site", discoveredVia: "places_website" });
  });
});

describe("images and unsupported files", () => {
  const r: ResolverRestaurant = { placeId: "img", name: "Imagen", city: "Barcelona", websiteUrl: "https://imagen.example/" };

  it("recognises an image menu without reading it", async () => {
    const { result } = await run(r, {
      "https://imagen.example/": html(nav([["Carta", "/uploads/carta-2026.png"]])),
      "https://imagen.example/uploads/carta-2026.png": { body: PNG_BYTES, declaredType: "image/png" },
    });
    expect(result.status).toBe("resolved");
    expect(result.selected[0]).toMatchObject({ mediaType: "image", readability: "readable" });
  });

  it("reports an unsupported format as unreadable rather than missing", async () => {
    const { result } = await run(r, {
      "https://imagen.example/": html(nav([["Carta", "/uploads/carta.docx"]])),
      "https://imagen.example/uploads/carta.docx": { body: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(1200).fill(7)]), declaredType: "application/zip" },
    });
    expect(result.status).toBe("found_but_unreadable");
    if (result.status === "found_but_unreadable") expect(result.unreadableReason).toBe("unsupported_format");
  });
});
