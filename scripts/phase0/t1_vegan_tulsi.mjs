import { fetchRaw, tavily, save, sniff } from './lib.mjs';
import { inspectSite, parsePage, dishLines } from './inspector.mjs';
const site = 'https://www.vegan-tulsi.com/';
console.log('--- Stage 1: inspect official site');
const r = await inspectSite(site);
console.log(JSON.stringify({ home: r.home, nCandidates: r.candidates.length }, null, 1));
for (const c of r.candidates.slice(0, 15)) console.log(' ', c.kind, c.via, c.url.slice(0, 110), c.dishLines != null ? `dishLines=${c.dishLines} chars=${c.textChars}` : '');
save('t1_inspect.json', r);
console.log('--- Stage 2: Tavily search (old approach + new multilingual)');
for (const q of ['"Vegan Tulsi" Barcelona menu', '"Vegan Tulsi" Barcelona carta', '"Vegan Tulsi" Barcelona menú', 'site:vegan-tulsi.com menu', 'site:vegan-tulsi.com carta', '"Vegan Tulsi" Barcelona carta filetype:pdf']) {
  const s = await tavily('search', { query: q, max_results: 6 });
  console.log(`[${s.status}] ${q} (${s.ms}ms)`);
  for (const x of s.body.results || []) console.log('    ', x.url.slice(0, 110), '|', (x.title || '').slice(0, 50));
}
