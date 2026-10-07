import { fetchRaw, save, sniff } from './lib.mjs';
import { inspectSite, parsePage, dishLines } from './inspector.mjs';
const qs = ['traditional Catalan restaurant Barcelona', 'paella restaurant Barceloneta', 'Italian restaurant Eixample Barcelona', 'brunch Gràcia Barcelona', 'tapas bar El Born Barcelona', 'seafood restaurant Barcelona', 'vegetarian friendly restaurant Gothic Quarter Barcelona'];
const seen = new Map();
for (const q of qs) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': 'places.id,places.displayName,places.websiteUri' }, body: JSON.stringify({ textQuery: q, includedType: 'restaurant', pageSize: 6 }) });
  for (const p of (await r.json()).places || []) if (p.websiteUri && !seen.has(p.id) && !/instagram|facebook|linktr/.test(p.websiteUri)) seen.set(p.id, { name: p.displayName.text, site: p.websiteUri.split('?')[0] });
}
const list = [...seen.values()].slice(0, 12);
console.log('sites:', list.length);
const results = [];
for (const x of list) {
  const t0 = Date.now();
  const r = await inspectSite(x.site);
  // fetch & verify top candidates (max 4): pdf/image/link
  const ranked = r.candidates.slice().sort((a, b) => (b.kind === 'pdf') - (a.kind === 'pdf') || (b.internal === true) - (a.internal === true));
  const verified = [];
  for (const c of ranked.slice(0, 4)) {
    if (c.kind === 'homepage_has_menu') { verified.push({ ...c, verdict: 'html_menu_on_homepage' }); continue; }
    const f = await fetchRaw(c.url, { timeout: 12000 });
    const s = f.buf ? sniff(f.buf) : null;
    let v = { url: c.url, kind: c.kind, via: c.via, status: f.status, sniff: s, bytes: f.buf?.length };
    if (f.ok && s === 'html/text') { const pp = parsePage(f.buf.toString('utf8'), f.finalUrl); v.textChars = pp.text.length; v.dishLines = dishLines(pp.text); v.verdict = v.dishLines >= 6 ? 'html_menu' : pp.text.length < 400 ? 'js_or_empty' : (pp.imgs.length > 3 ? 'maybe_image_menu' : 'weak_html'); }
    else if (f.ok && s === 'pdf') v.verdict = 'pdf';
    else if (f.ok && ['jpeg','png','webp'].includes(s)) v.verdict = 'image';
    else v.verdict = f.status === 403 ? 'blocked_403' : 'fetch_failed';
    verified.push(v);
  }
  const best = verified.find(v => ['html_menu','html_menu_on_homepage','pdf','image'].includes(v.verdict));
  const row = { name: x.name, site: x.site, home: r.home, nCandidates: r.candidates.length, outcome: best ? best.verdict : (r.blocked ? 'blocked' : verified.some(v => ['js_or_empty','maybe_image_menu'].includes(v.verdict)) ? 'needs_js_or_vision' : r.candidates.length ? 'candidates_unreadable' : 'no_candidate'), bestUrl: best?.url, verified, ms: Date.now() - t0 };
  results.push(row);
  console.log(`${x.name.slice(0, 32).padEnd(32)} home:${r.home.status}${r.home.jsShell ? ' JS?' : ''} cands:${r.candidates.length} -> ${row.outcome} ${best ? best.url.slice(0, 70) : ''} (${row.ms}ms)`);
}
save('t2_results.json', results);
const tally = {}; for (const r of results) tally[r.outcome] = (tally[r.outcome] || 0) + 1; console.log(tally);
