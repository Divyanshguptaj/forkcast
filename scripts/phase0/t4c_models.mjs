import fs from 'node:fs';
import { gemini, parseJson, save, OUT } from './lib.mjs';
import { SYSTEM_RULES } from './schemas.mjs';
const buf = fs.readFileSync(OUT + '/scanned_Barcelonet.pdf'); const b64 = buf.toString('base64');
const base = JSON.parse(fs.readFileSync(OUT + '/t4_scanned_pdf.json'));
const baseMap = new Map(base.items.map(i => [i.originalName.toLowerCase(), i.price]));
const lean = { type: 'OBJECT', properties: { languages: { type: 'ARRAY', items: { type: 'STRING' } }, omittedMeatFishCount: { type: 'INTEGER' }, items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  originalName: { type: 'STRING' }, translatedName: { type: 'STRING' }, section: { type: 'STRING', nullable: true }, priceRaw: { type: 'STRING', nullable: true }, price: { type: 'NUMBER', nullable: true },
  vegetarian: { type: 'STRING', enum: ['confirmed_vegetarian', 'likely_vegetarian', 'unknown'] }, vegan: { type: 'STRING', enum: ['confirmed_vegan', 'likely_vegan', 'unknown', 'not_vegan'] }, evidence: { type: 'STRING' } },
  required: ['originalName', 'translatedName', 'vegetarian', 'vegan', 'evidence'] } } }, required: ['languages', 'items', 'omittedMeatFishCount'] };
const extra = '\nIMPORTANT: The user is vegetarian. Return ONLY dishes that are NOT clearly meat/fish/shellfish (confirmed, likely or unknown). Count the clearly meat/fish dishes you leave out in omittedMeatFishCount. Do not output descriptions.';
const rows = [];
for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']) {
  const cfg = { responseMimeType: 'application/json', responseSchema: lean, temperature: 0 };
  if (model.startsWith('gemini-2.5')) cfg.thinkingConfig = { thinkingBudget: 0 }; else cfg.thinkingConfig = { thinkingLevel: 'minimal' };
  let r = await gemini(model, { systemInstruction: { parts: [{ text: SYSTEM_RULES + extra }] }, contents: [{ parts: [{ inlineData: { mimeType: 'application/pdf', data: b64 } }, { text: 'Extract the menu.' }] }], generationConfig: cfg }, { label: 'lean ' + model, retries: 2 });
  if (r.status === 400 && model.startsWith('gemini-3')) { delete cfg.thinkingConfig; r = await gemini(model, { systemInstruction: { parts: [{ text: SYSTEM_RULES + extra }] }, contents: [{ parts: [{ inlineData: { mimeType: 'application/pdf', data: b64 } }, { text: 'Extract the menu.' }] }], generationConfig: cfg }, { label: 'lean ' + model + ' nothink-cfg', retries: 2 }); }
  const j = parseJson(r.text); save(`t4c_${model}.json`, j || r);
  let agree = 0, dis = [], nomatch = 0;
  for (const i of j?.items || []) { const k = i.originalName.toLowerCase(); if (!baseMap.has(k)) { nomatch++; continue; } if (baseMap.get(k) === i.price) agree++; else dis.push(`${i.originalName}: ${baseMap.get(k)} vs ${i.price}`); }
  const row = { model, status: r.status, ms: r.ms, outTokens: r.usage?.candidatesTokenCount, thoughts: r.usage?.thoughtsTokenCount ?? 0, items: j?.items?.length, omitted: j?.omittedMeatFishCount, priceAgree: agree, priceDisagree: dis.length, nameNoMatch: nomatch, err: r.error?.slice(0, 80) };
  rows.push(row); console.log(JSON.stringify(row), dis.slice(0, 3));
}
console.table(rows);
