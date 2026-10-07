import { fetchRaw, tavily } from './lib.mjs';
const ek = await fetchRaw('https://tulsi-vegan.eatkitch.com/'); console.log('eatkitch direct', ek.status, ek.error);
const e = await tavily('extract', { urls: ['https://tulsi-vegan.eatkitch.com/', 'https://www.ubereats.com/es-en/store/vegan-tulsi-restaurant/Y3XcQmP1WSayoc2f97AW8A'] });
console.log(e.status, e.ms + 'ms');
for (const r of e.body.results || []) console.log('OK', r.url.slice(0, 80), 'chars', r.raw_content.length, '|', r.raw_content.slice(0, 700).replace(/\s+/g, ' '));
for (const f of e.body.failed_results || []) console.log('FAIL', f.url.slice(0, 80), f.error);
