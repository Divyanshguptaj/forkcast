import fs from 'node:fs';
import { fetchRaw, save, sniff, OUT } from './lib.mjs';
import { dishLines } from './inspector.mjs';
import { extractText, getDocumentProxy } from 'unpdf';
const res = JSON.parse(fs.readFileSync(OUT + '/t2_results.json'));
const report = [];
for (const r of res) {
  const pdfs = r.verified.filter(v => v.verdict === 'pdf').slice(0, 3);
  for (const v of pdfs) {
    const f = await fetchRaw(v.url, { timeout: 20000 });
    if (!f.ok) { report.push({ name: r.name, url: v.url, err: f.status }); continue; }
    try {
      const doc = await getDocumentProxy(new Uint8Array(f.buf));
      const { text, totalPages } = await extractText(doc, { mergePages: false });
      const chars = text.map(t => t.length); const avg = Math.round(chars.reduce((a, b) => a + b, 0) / totalPages);
      const joined = text.join('\n'); const dl = dishLines(joined);
      const kind = avg < 150 ? 'SCANNED/IMAGE' : dl >= 6 ? 'TEXT_MENU' : 'TEXT_NON_MENU?';
      report.push({ name: r.name, url: v.url.slice(-60), pages: totalPages, avgChars: avg, dishLines: dl, kind, mb: +(f.buf.length / 1e6).toFixed(2) });
      if (kind === 'SCANNED/IMAGE' && !fs.existsSync(OUT + '/scanned_' + r.name.replace(/\W/g, '').slice(0, 10) + '.pdf')) save('scanned_' + r.name.replace(/\W/g, '').slice(0, 10) + '.pdf', f.buf);
      if (kind === 'TEXT_MENU') save('textmenu_' + r.name.replace(/\W/g, '').slice(0, 10) + '.txt', joined);
    } catch (e) { report.push({ name: r.name, url: v.url.slice(-60), err: e.message.slice(0, 80) }); }
  }
}
console.table(report);
save('t2b_pdfs.json', report);
