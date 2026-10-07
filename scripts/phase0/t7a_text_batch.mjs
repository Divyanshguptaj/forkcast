import fs from 'node:fs';
import { gemini, parseJson, save, OUT } from './lib.mjs';
import { SYSTEM_RULES } from './schemas.mjs';
const MODEL = process.env.MODEL || 'gemini-2.5-flash';
const files = { 'Can Culleretes': 'textmenu_Restaurant.txt', "Ca l'Estevet": 'textmenu_CalEstevet.txt', 'Gioia': 'textmenu_GioiaBarce.txt', 'Xup Xup': 'textmenu_XupXupRest.txt' };
const docs = Object.entries(files).map(([name, f]) => ({ name, text: fs.readFileSync(OUT + '/' + f, 'utf8').slice(0, 24000) }));
console.log(docs.map(d => `${d.name}: ${d.text.length} chars`).join(' | '));
const item = { type: 'OBJECT', properties: { originalName: { type: 'STRING' }, translatedName: { type: 'STRING' }, section: { type: 'STRING', nullable: true }, priceRaw: { type: 'STRING', nullable: true }, price: { type: 'NUMBER', nullable: true }, vegetarian: { type: 'STRING', enum: ['confirmed_vegetarian', 'likely_vegetarian', 'unknown'] }, vegan: { type: 'STRING', enum: ['confirmed_vegan', 'likely_vegan', 'unknown', 'not_vegan'] }, evidence: { type: 'STRING' } }, required: ['originalName', 'translatedName', 'vegetarian', 'vegan', 'evidence'] };
const one = { type: 'OBJECT', properties: { languages: { type: 'ARRAY', items: { type: 'STRING' } }, omittedMeatFishCount: { type: 'INTEGER' }, items: { type: 'ARRAY', items: item } }, required: ['languages', 'omittedMeatFishCount', 'items'] };
const batchSchema = { type: 'OBJECT', properties: { restaurants: { type: 'ARRAY', items: { type: 'OBJECT', properties: { restaurant: { type: 'STRING' }, ...one.properties }, required: ['restaurant', ...one.required] } } }, required: ['restaurants'] };
const sys = SYSTEM_RULES + '\nThe user is vegetarian: return ONLY dishes that are NOT clearly meat/fish/shellfish; count the omitted ones in omittedMeatFishCount. No descriptions. Max 40 items per restaurant.';
const cfg = (s) => ({ responseMimeType: 'application/json', responseSchema: s, temperature: 0, ...(MODEL.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) });
const verify = (items, text) => { const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); let nameOk = 0, priceOk = 0, priced = 0; for (const i of items) { if (t.includes(i.originalName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) nameOk++; if (i.price != null) { priced++; const re = String(i.price.toFixed(2)).replace('.', '[.,]'); if (new RegExp(re.replace(/0$/, '0?')).test(text) || new RegExp(String(i.price).replace('.', '[.,]')).test(text)) priceOk++; } } return { n: items.length, nameInText: nameOk, priced, priceInText: priceOk }; };
// separate, in parallel
const t0 = Date.now();
const sep = await Promise.all(docs.map(d => gemini(MODEL, { systemInstruction: { parts: [{ text: sys }] }, contents: [{ parts: [{ text: `<DOCUMENT restaurant="${d.name}">\n${d.text}\n</DOCUMENT>\nExtract the menu.` }] }], generationConfig: cfg(one) }, { label: 'sep ' + d.name })));
console.log('SEPARATE parallel total', Date.now() - t0, 'ms');
sep.forEach((r, i) => { const j = parseJson(r.text); console.log(' ', docs[i].name, r.status, r.ms + 'ms', 'out', r.usage?.candidatesTokenCount, JSON.stringify(j ? verify(j.items, docs[i].text) : r.error), 'omitted', j?.omittedMeatFishCount, 'langs', j?.languages); });
// batched single call
const t1 = Date.now();
const big = await gemini(MODEL, { systemInstruction: { parts: [{ text: sys }] }, contents: [{ parts: [{ text: docs.map(d => `<DOCUMENT restaurant="${d.name}">\n${d.text}\n</DOCUMENT>`).join('\n') + '\nExtract each restaurant\'s menu separately.' }] }], generationConfig: cfg(batchSchema) }, { label: 'batched 4 menus' });
console.log('BATCHED single call', big.status, big.ms + 'ms', 'in', big.usage?.promptTokenCount, 'out', big.usage?.candidatesTokenCount, big.error || '');
const jb = parseJson(big.text); save('t7a_batched.json', jb || big);
for (const r of jb?.restaurants || []) { const d = docs.find(x => x.name === r.restaurant); console.log(' ', r.restaurant, JSON.stringify(d ? verify(r.items, d.text) : '?'), 'omitted', r.omittedMeatFishCount); }
const sample = (jb?.restaurants?.[1]?.items || []).slice(0, 8); sample.forEach(i => console.log('   ', i.originalName, '|', i.translatedName, '|', i.price, '|', i.vegetarian, '|', i.vegan, '|', (i.evidence || '').slice(0, 40)));
save('t7a_sep.json', sep.map(r => parseJson(r.text)));
