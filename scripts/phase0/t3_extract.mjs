import fs from 'node:fs';
import { fetchRaw, tavily, save, OUT } from './lib.mjs';
import { parsePage, dishLines } from './inspector.mjs';
const res = JSON.parse(fs.readFileSync(OUT + '/t2_results.json'));
const targets = res.filter(r => ['no_candidate', 'candidates_unreadable', 'needs_js_or_vision'].includes(r.outcome));
const rep = [];
for (const r of targets) {
  console.log(`\n=== ${r.name} ${r.site} [${r.outcome}]`);
  for (const v of r.verified.slice(0, 3)) console.log('  direct cand:', v.kind, v.verdict, v.status, (v.url || '').slice(0, 90), v.textChars ?? '');
  // Tavily extract: homepage + top 2 internal candidates
  const urls = [r.site, ...r.verified.filter(v => v.url && v.url !== r.site).slice(0, 2).map(v => v.url)];
  const e = await tavily('extract', { urls, include_images: true });
  const row = { name: r.name, extractMs: e.ms, results: [] };
  for (const x of e.body.results || []) { const dl = dishLines(x.raw_content); row.results.push({ url: x.url.slice(0, 80), chars: x.raw_content.length, dishLines: dl, images: (x.images || []).length }); console.log('  tavily OK  ', x.url.slice(0, 80), 'chars', x.raw_content.length, 'dishLines', dl, 'images', (x.images || []).length); }
  for (const f of e.body.failed_results || []) { row.results.push({ url: f.url.slice(0, 80), failed: f.error }); console.log('  tavily FAIL', f.url.slice(0, 80), f.error); }
  // targeted search
  const s = await tavily('search', { query: `"${r.name.split('|')[0].trim()}" Barcelona carta menú`, max_results: 5 });
  row.search = (s.body.results || []).map(x => x.url.slice(0, 90));
  console.log('  search:', row.search.join('\n          '));
  rep.push(row);
}
save('t3_results.json', rep);
