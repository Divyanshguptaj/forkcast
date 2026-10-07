import { fetchRaw, tavily, save, sniff } from './lib.mjs';
import { parsePage } from './inspector.mjs';
const fb = 'https://online.fliphtml5.com/zyrook/ESP-CARTA-2026-TULSI/';
const r = await fetchRaw(fb);
console.log('flipbook', r.status, r.type, r.buf?.length, r.ms + 'ms');
if (r.ok) { const p = parsePage(r.buf.toString('utf8'), r.finalUrl); console.log('text chars', p.text.length, p.text.slice(0, 300)); console.log('imgs', p.imgs.slice(0, 5)); }
const cfg = await fetchRaw(fb + 'javascript/config.js');
console.log('config.js', cfg.status, cfg.buf?.length, cfg.buf?.toString('utf8').slice(0, 500));
console.log('--- Tavily extract flipbook');
const e1 = await tavily('extract', { urls: [fb], include_images: true });
console.log(e1.status, e1.ms + 'ms', JSON.stringify(e1.body).slice(0, 900));
console.log('--- Tavily extract carta.menu PDF');
const e2 = await tavily('extract', { urls: ['https://weur-cdn.carta.menu/storage/media/companies_menu_pdf/57390016/tulsi-vegan-barcelona-carta.pdf'] });
console.log(e2.status, e2.ms + 'ms', JSON.stringify(e2.body).slice(0, 1500));
save('t1c_extract_pdf.json', e2.body);
