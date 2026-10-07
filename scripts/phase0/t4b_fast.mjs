import fs from 'node:fs';
import { gemini, parseJson, save, OUT } from './lib.mjs';
import { menuSchema, SYSTEM_RULES } from './schemas.mjs';
const buf = fs.readFileSync(OUT + '/scanned_Barcelonet.pdf');
const base = JSON.parse(fs.readFileSync(OUT + '/t4_scanned_pdf.json'));
const schema = JSON.parse(JSON.stringify(menuSchema)); schema.properties.omittedMeatFishCount = { type: 'INTEGER' }; schema.required.push('omittedMeatFishCount');
const variants = {
  'nothink_all': { extra: '', thinking: 0, sch: menuSchema },
  'nothink_vegfocus': { extra: '\nIMPORTANT: The user is vegetarian. OMIT every dish that clearly contains meat, fish or shellfish; instead report how many you omitted in omittedMeatFishCount. Keep vegetarian, likely, unknown and ambiguous dishes.', thinking: 0, sch: schema },
};
for (const [k, v] of Object.entries(variants)) {
  const r = await gemini('gemini-2.5-flash', { systemInstruction: { parts: [{ text: SYSTEM_RULES + v.extra }] },
    contents: [{ parts: [{ inlineData: { mimeType: 'application/pdf', data: buf.toString('base64') } }, { text: 'Extract the menu from this scanned PDF.' }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: v.sch, temperature: 0, thinkingConfig: { thinkingBudget: v.thinking } } }, { label: 'scanned ' + k });
  const j = parseJson(r.text); save(`t4b_${k}.json`, j || r);
  console.log(`\n[${k}] status ${r.status} ${r.ms}ms thoughts=${r.usage?.thoughtsTokenCount} out=${r.usage?.candidatesTokenCount} items=${j?.items?.length} omitted=${j?.omittedMeatFishCount}`);
  if (j) {
    const bm = new Map(base.items.map(i => [i.originalName, i]));
    let same = 0, diff = [], missing = 0;
    for (const i of j.items) { const b = bm.get(i.originalName); if (!b) { missing++; continue; } if (b.price === i.price) same++; else diff.push(`${i.originalName}: ${b.price} vs ${i.price}`); }
    console.log(` price agreement with baseline run: ${same} same, ${diff.length} differ, ${missing} name not in baseline`, diff.slice(0, 5));
    const veg = j.items.filter(i => i.vegetarian !== 'contains_meat_or_fish'); console.log(' non-meat items:', veg.length); veg.slice(0, 12).forEach(i => console.log('   ', i.originalName, '|', i.translatedName, '|', i.price, '|', i.vegetarian, '|', i.vegan));
  }
}
