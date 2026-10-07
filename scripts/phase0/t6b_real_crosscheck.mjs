import fs from 'node:fs';
import { gemini, parseJson, OUT } from './lib.mjs';
const A = JSON.parse(fs.readFileSync(OUT + '/t4e_0.json'));
const b64 = fs.readFileSync(OUT + '/real_0.jpg').toString('base64');
const priceSchema = { type: 'OBJECT', properties: { lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { dish: { type: 'STRING' }, priceAsPrinted: { type: 'STRING', nullable: true } }, required: ['dish', 'priceAsPrinted'] } } }, required: ['lines'] };
const num = (s) => s == null ? null : parseFloat(String(s).replace(/[^\d,.]/g, '').replace(',', '.'));
for (const model of ['gemini-3.5-flash-lite', 'gemini-2.5-flash']) {
  const cfg = { responseMimeType: 'application/json', responseSchema: priceSchema, temperature: 0 }; if (model.startsWith('gemini-2.5')) cfg.thinkingConfig = { thinkingBudget: 0 };
  const B = await gemini(model, { contents: [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }, { text: 'List every dish and its price EXACTLY as printed. Prices may sit in a column to the right or left of dish names; match carefully row by row. If a price is not clearly attributable to a dish use null.' }] }], generationConfig: cfg }, { label: 'B real ' + model });
  const jb = parseJson(B.text); const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '');
  let agree = 0, dis = 0; const ex = [];
  for (const a of A.items) { const b = jb?.lines.find(l => norm(l.dish).startsWith(norm(a.originalName).slice(0, 8))); if (!b) continue; if (num(b.priceAsPrinted) === a.price) agree++; else { dis++; if (ex.length < 6) ex.push(`${a.originalName}: A=${a.price} B=${num(b.priceAsPrinted)}`); } }
  console.log(model, B.status, B.ms + 'ms', 'items matched agree', agree, 'disagree', dis, ex);
}
