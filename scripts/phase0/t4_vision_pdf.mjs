import fs from 'node:fs';
import { gemini, parseJson, save, OUT } from './lib.mjs';
import { menuSchema, SYSTEM_RULES } from './schemas.mjs';
const buf = fs.readFileSync(OUT + '/scanned_Barcelonet.pdf');
console.log('PDF MB', (buf.length / 1e6).toFixed(1));
const r = await gemini('gemini-2.5-flash', {
  systemInstruction: { parts: [{ text: SYSTEM_RULES }] },
  contents: [{ parts: [{ inlineData: { mimeType: 'application/pdf', data: buf.toString('base64') } }, { text: 'Extract the menu from this scanned PDF.' }] }],
  generationConfig: { responseMimeType: 'application/json', responseSchema: menuSchema, temperature: 0 } }, { label: 'vision scanned pdf' });
console.log('status', r.status, 'ms', r.ms, 'usage', JSON.stringify(r.usage));
const j = parseJson(r.text); save('t4_scanned_pdf.json', j || r.text || r);
if (!j) { console.log(r.error || r.text?.slice(0, 500)); process.exit(); }
console.log('languages', j.languages, 'legibility', j.legibility, 'kind', j.documentKind, 'items', j.items.length);
for (const i of j.items.slice(0, 40)) console.log(`  ${i.originalName} | ${i.translatedName} | ${i.priceRaw} -> ${i.price} | ${i.vegetarian} | conf ${i.readConfidence} | "${(i.evidence||'').slice(0,40)}"`);
