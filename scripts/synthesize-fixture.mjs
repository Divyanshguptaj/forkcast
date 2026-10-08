// Turns a local recording (raw provider output, never committed) into a synthetic fixture:
// fictional restaurant identities and URLs, synthetic Google-style fields, original menu wording kept.
// Usage: node scripts/synthesize-fixture.mjs <raw-recording.json> <synthetic-output.json>
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/synthesize-fixture.mjs <raw.json> <out.json>");

const PROFILES = [
  { match: /made in sicily/i, name: "Trattoria Marina", host: "trattoria-marina.example", rating: 4.6, count: 2140, hours: [12, 23.5] },
  { match: /paisano/i, name: "Bistró Paloma", host: "bistro-paloma.example", rating: 4.5, count: 1380, hours: [12, 23] },
  { match: /cantina/i, name: "La Cantina Azzurra", host: "cantina-azzurra.example", rating: 4.4, count: 640, hours: [13, 23] },
  { match: /circolo/i, name: "Osteria Alba", host: "osteria-alba.example", rating: 4.7, count: 3120, hours: [12, 24] },
  { match: /ana's/i, name: "Elio's - Restaurant italianà a Barcelona i Bar de Còctels", host: "elio.example", rating: 4.3, count: 410, hours: [18, 24] },
];

const raw = JSON.parse(readFileSync(input, "utf8"));
const extFor = (url) => (/\.pdf(\?|$)/i.test(url) ? "pdf" : /\.(png|jpe?g|webp)(\?|$)/i.test(url) ? "png" : "html");

let text = JSON.stringify(raw);
const candidates = raw.candidates.map((c, i) => {
  const profile = PROFILES.find((p) => p.match.test(c.restaurant.name)) ?? { name: `Restaurante Sintético ${i + 1}`, host: `synthetic-${i + 1}.example`, rating: 4.2, count: 300, hours: [12, 23] };
  return { c, i, profile, id: `synthetic-${String(i + 1).padStart(3, "0")}` };
});

const replaceAll = (from, to) => {
  if (from) text = text.split(from).join(to);
};

for (const { c, profile, id } of candidates) {
  const urls = new Set();
  for (const d of c.extraction?.documents ?? []) urls.add(d.url);
  for (const d of c.extraction?.dishes ?? []) for (const s of d.sources ?? []) urls.add(s.url);
  let k = 0;
  for (const url of [...urls].sort((a, b) => b.length - a.length)) replaceAll(JSON.stringify(url).slice(1, -1), `https://${profile.host}/carta-${++k}.${extFor(url)}`);
  if (c.restaurant.websiteUrl) replaceAll(JSON.stringify(c.restaurant.websiteUrl).slice(1, -1), `https://${profile.host}/`);
  if (c.restaurant.mapsUrl) replaceAll(JSON.stringify(c.restaurant.mapsUrl).slice(1, -1), `https://maps.example/${id}`);
  replaceAll(c.restaurant.placeId, id);
  replaceAll(c.restaurant.sourceId, `synthetic:${id}`);
  replaceAll(JSON.stringify(c.restaurant.name).slice(1, -1), profile.name);
  if (c.restaurant.address) replaceAll(JSON.stringify(c.restaurant.address).slice(1, -1), `Carrer d'Exemple ${10 + c.restaurant.placeId.length % 20}, 08001 Barcelona`);
}

replaceAll("Iaia Cristina", "Azzurra");
const synthetic = JSON.parse(text);
synthetic.recordedAt = "synthetic";
synthetic.run = undefined;
synthetic.candidates = synthetic.candidates.map((c, i) => {
  const { profile } = candidates[i];
  const periods = Array.from({ length: 7 }, (_, day) => ({ open: { day, hour: Math.floor(profile.hours[0]), minute: (profile.hours[0] % 1) * 60 }, close: { day, hour: Math.floor(profile.hours[1]) % 24, minute: (profile.hours[1] % 1) * 60 } }));
  return {
    ...c,
    restaurant: {
      ...c.restaurant,
      location: { lat: 41.3874 + (i - 2) * 0.004, lng: 2.1686 + (i - 2) * 0.003 },
      rating: profile.rating,
      ratingCount: profile.count,
      openingHours: { weekdayText: [], periods },
      sampledReviews: [],
    },
  };
});

writeFileSync(output, `${JSON.stringify(synthetic, null, 2)}\n`);
console.log(`${synthetic.candidates.length} synthetic restaurants written to ${output}`);
