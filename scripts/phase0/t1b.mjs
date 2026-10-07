import { fetchRaw, tavily, save, sniff } from './lib.mjs';
import { parsePage } from './inspector.mjs';
import { extractText, getDocumentProxy } from 'unpdf';
const r = await fetchRaw('https://www.vegan-tulsi.com/menus');
const p = parsePage(r.buf.toString('utf8'), r.finalUrl);
console.log('menus page text:', p.text.slice(0, 600));
console.log('links:', p.links.map(l => l.url + ' [' + l.text + ']').slice(0, 30).join('\n'));
console.log('imgs:', p.imgs.slice(0, 40).map(i => i.url.slice(0, 100)).join('\n'));
console.log('iframes', p.iframes);
const pdf = await fetchRaw('https://weur-cdn.carta.menu/storage/media/companies_menu_pdf/57390016/tulsi-vegan-barcelona-carta.pdf');
console.log('PDF', pdf.status, pdf.type, pdf.buf?.length, sniff(pdf.buf || Buffer.alloc(4)), pdf.ms + 'ms');
if (pdf.ok) { save('tulsi.pdf', pdf.buf); const doc = await getDocumentProxy(new Uint8Array(pdf.buf)); const { text, totalPages } = await extractText(doc, { mergePages: false }); console.log('pages', totalPages, 'chars/page', text.map(t => t.length)); console.log(text.join('\n---\n').slice(0, 1500)); }
