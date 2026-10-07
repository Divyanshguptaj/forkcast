import fs from 'node:fs';
import { fetchRaw, tavily, save, sniff, OUT } from './lib.mjs';
const res = JSON.parse(fs.readFileSync(OUT + '/t2_results.json'));
const imgs = res.flatMap(r => r.verified.filter(v => v.kind === 'image').map(v => ({ r: r.name, url: v.url, status: v.status, bytes: v.bytes })));
console.log('image candidates from site inspection:', imgs);
// Search for image menus
for (const q of ['carta restaurante Barcelona menú del día foto jpg', 'menu card image restaurant Barcelona jpg carta']) {
  const s = await tavily('search', { query: q, max_results: 8, include_images: true });
  console.log(q, s.status, (s.body.images || []).slice(0, 8));
}
// Tapas&paella images from extract
const e = await tavily('extract', { urls: ['https://tapasypaellabarceloneta.es/', 'https://www.restaurantcalboter.com/'], include_images: true });
for (const x of e.body.results || []) { console.log(x.url); (x.images || []).forEach(u => console.log('   ', u.slice(0, 120))); }
