import { fetchRaw, save, sniff } from './lib.mjs';
const fb = 'https://online.fliphtml5.com/zyrook/ESP-CARTA-2026-TULSI/';
const cfg = (await fetchRaw(fb + 'javascript/config.js')).buf.toString('utf8');
const m = cfg.match(/"fliphtml5_pages"\s*:\s*(\[.*?\])\s*[,}]/s) || cfg.match(/fliphtml5_pages\s*=\s*(\[.*?\]);/s);
console.log('has pages array:', !!m, 'len', cfg.length, 'idx', cfg.indexOf('fliphtml5_pages'));
console.log(cfg.slice(cfg.indexOf('fliphtml5_pages') - 50, cfg.indexOf('fliphtml5_pages') + 400));
const names = [...cfg.matchAll(/"n"\s*:\s*\["([^"]+)"/g)].map(x => x[1]);
console.log('page file names', names);
for (const n of names.slice(0, 3)) {
  for (const dir of ['files/large/', 'files/page/', 'files/']) {
    const r = await fetchRaw(fb + dir + n);
    console.log(dir + n, r.status, r.type, r.buf?.length, r.buf ? sniff(r.buf) : '');
    if (r.ok && sniff(r.buf) !== 'html/text') { save('tulsi_p' + names.indexOf(n) + '.' + sniff(r.buf), r.buf); break; }
  }
}
