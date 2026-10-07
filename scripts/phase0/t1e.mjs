import { fetchRaw, gemini } from './lib.mjs';
import { parsePage, dishLines } from './inspector.mjs';
// A: delivery menu linked from the official page
const ek = await fetchRaw('https://tulsi-vegan.eatkitch.com/');
const p = parsePage(ek.buf?.toString('utf8') || '', ek.finalUrl || '');
console.log('eatkitch', ek.status, ek.type, 'chars', p.text.length, 'dishLines', dishLines(p.text), p.text.slice(0, 300));
// B: Gemini urlContext on the flipbook
const g = await gemini('gemini-2.5-flash', { contents: [{ parts: [{ text: 'Open this URL and list up to 8 dishes with prices exactly as printed. If you cannot read the content, say CANNOT_READ. URL: https://online.fliphtml5.com/zyrook/ESP-CARTA-2026-TULSI/' }] }], tools: [{ urlContext: {} }] }, { label: 'urlContext flipbook' });
console.log('urlContext', g.status, g.ms + 'ms', (g.text || g.error || '').slice(0, 600));
console.log(JSON.stringify(g.body?.candidates?.[0]?.urlContextMetadata || {}).slice(0, 300));
