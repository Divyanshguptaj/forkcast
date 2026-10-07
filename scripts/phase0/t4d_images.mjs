import { fetchRaw, gemini, parseJson, save, sniff } from './lib.mjs';
import { menuSchema, SYSTEM_RULES } from './schemas.mjs';
const base = 'https://tapasypaellabarceloneta.es/wp-content/uploads/2026/07/';
const names = ['Photo-22-6-26-12-50-17.png', 'Photo-22-6-26-12-50-17-2.png', 'Photo-22-6-26-12-50-17-1.png', 'Photo-22-6-26-12-50-17-3.png', 'Photo-22-6-26-12-50-17-4.png', 'Photo-22-6-26-12-52-21.png', 'Photo-22-6-26-12-50-17-8.png', 'Photo-22-6-26-12-50-17-8-1.png', 'Photo-22-6-26-12-50-17-9.png'];
const imgs = [];
for (const n of names) { const r = await fetchRaw(base + n); console.log(n, r.status, sniff(r.buf || Buffer.alloc(4)), r.buf?.length, r.ms + 'ms'); if (r.ok) { imgs.push({ n, buf: r.buf }); save('img_' + n, r.buf); } }
// one call with ALL images (batched)
const parts = imgs.map(i => ({ inlineData: { mimeType: 'image/png', data: i.buf.toString('base64') } }));
const r = await gemini('gemini-2.5-flash', { systemInstruction: { parts: [{ text: SYSTEM_RULES + '\nThe user is vegetarian: return only dishes that are NOT clearly meat/fish; ignore drinks.' }] }, contents: [{ parts: [...parts, { text: 'These images are pages/photos of one restaurant menu. Extract the menu.' }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: menuSchema, temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }, { label: 'image menu batch' });
console.log('status', r.status, r.ms + 'ms', JSON.stringify(r.usage), r.error || '');
const j = parseJson(r.text); save('t4d_images.json', j || r);
if (j) { console.log(j.languages, j.legibility, j.documentKind, j.items.length); j.items.slice(0, 30).forEach(i => console.log(`  ${i.originalName} | ${i.translatedName} | ${i.priceRaw}->${i.price} | ${i.vegetarian} | ${i.readConfidence}`)); }
