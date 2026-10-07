import fs from 'node:fs';
import { gemini, parseJson, save, OUT } from './lib.mjs';
import { menuSchema, SYSTEM_RULES } from './schemas.mjs';
const truth = JSON.parse(fs.readFileSync(OUT + '/synth_truth.json'));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(v\)/g, '').replace(/[^a-z0-9 ]/g, '').trim();
const find = (name, list, key = 'originalName') => { const n = norm(name); return list.find(x => { const m = norm(x[key]); return m === n || m.startsWith(n.slice(0, 14)) || n.startsWith(m.slice(0, 14)); }); };
const priceSchema = { type: 'OBJECT', properties: { lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { dish: { type: 'STRING' }, priceAsPrinted: { type: 'STRING', nullable: true } }, required: ['dish', 'priceAsPrinted'] } } }, required: ['lines'] };
const variants = [['synth_clean.png', 'image/png'], ['synth_lowres.jpg', 'image/jpeg'], ['synth_photo.jpg', 'image/jpeg']];
const summary = [];
for (const [file, mime] of variants) {
  const b64 = fs.readFileSync(OUT + '/' + file).toString('base64');
  const A = await gemini('gemini-2.5-flash', { systemInstruction: { parts: [{ text: SYSTEM_RULES }] }, contents: [{ parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: 'Extract the menu.' }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: menuSchema, temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }, { label: 'A ' + file });
  const ja = parseJson(A.text);
  // pass B: independent price read with a different model/prompt
  let model = 'gemini-3.5-flash-lite';
  const B = await gemini(model, { contents: [{ parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: 'List every dish and its price EXACTLY as printed (digit by digit, keep the decimal comma). If no price, null. Do not guess.' }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: priceSchema, temperature: 0 } }, { label: 'B ' + file });
  const jb = parseJson(B.text);
  let aOk = 0, bOk = 0, agree = 0, agreeOk = 0, disputed = 0, disputedWrongA = 0, aWrong = [], found = 0;
  const num = (s) => s == null ? null : parseFloat(String(s).replace(/[^\d,.]/g, '').replace(',', '.'));
  for (const t of truth) {
    const a = ja && find(t.name, ja.items); const b = jb && find(t.name, jb.lines, 'dish');
    const pa = a?.price ?? null, pb = b ? num(b.priceAsPrinted) : null;
    if (a) found++;
    const okA = pa === t.price, okB = pb === t.price; if (okA) aOk++; else aWrong.push(`${t.name}: truth ${t.price} A=${pa}`); if (okB) bOk++;
    if (pa != null && pb != null && pa === pb) { agree++; if (okA) agreeOk++; } else { disputed++; if (!okA) disputedWrongA++; }
  }
  const dietNote = ja ? ja.items.filter(i => /Pa amb|Escalivada|Samfaina|Amanida de tom|Croquetes|Canelons|Arròs de verd|Escudella|Truita/.test(i.originalName)).map(i => `${i.originalName} → ${i.translatedName} [${i.vegetarian}] ev="${(i.evidence || '').slice(0, 30)}"`) : [];
  const row = { file, aMs: A.ms, bMs: B.ms, bStatus: B.status, itemsFound: `${found}/${truth.length}`, priceCorrect_A: `${aOk}/${truth.length}`, priceCorrect_B: `${bOk}/${truth.length}`, agree, agreeButWrong: agree - agreeOk, disputed, disputedWhereAWrong: disputedWrongA, langs: ja?.languages, legib: ja?.legibility };
  summary.push(row); console.log(JSON.stringify(row)); if (aWrong.length) console.log('  A wrong:', aWrong.slice(0, 6)); 
  if (file === 'synth_clean.png') { console.log('  Catalan/diet sample:'); dietNote.forEach(x => console.log('   ', x)); }
  save('t56_' + file + '.json', { ja, jb });
}
console.table(summary);
