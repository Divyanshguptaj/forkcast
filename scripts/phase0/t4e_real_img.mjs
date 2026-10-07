import { fetchRaw, gemini, parseJson, save, sniff } from './lib.mjs';
import { menuSchema, SYSTEM_RULES } from './schemas.mjs';
const urls = ['https://heelsfirsttravel.boardingarea.com/wp-content/uploads/2016/07/Cafe-Viena-Barcelona-Restaurant-menu.jpg', 'https://media-cdn.tripadvisor.com/media/photo-s/15/c2/a7/41/carta-menu-1.jpg', 'https://heleninspain.com/wp-content/uploads/2017/01/carta-del-menu-del-dia.jpg'];
for (const [i, u] of urls.entries()) {
  const r = await fetchRaw(u); const k = r.buf ? sniff(r.buf) : null; console.log(i, r.status, k, r.buf?.length);
  if (!r.ok || !['jpeg', 'png', 'webp'].includes(k)) continue;
  save(`real_${i}.${k === 'jpeg' ? 'jpg' : k}`, r.buf);
  const A = await gemini('gemini-2.5-flash', { systemInstruction: { parts: [{ text: SYSTEM_RULES }] }, contents: [{ parts: [{ inlineData: { mimeType: 'image/' + (k === 'jpeg' ? 'jpeg' : k), data: r.buf.toString('base64') } }, { text: 'Extract the menu.' }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: menuSchema, temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }, { label: 'real img ' + i });
  const j = parseJson(A.text); save(`t4e_${i}.json`, j || A);
  console.log(`  ${A.status} ${A.ms}ms langs=${j?.languages} legib=${j?.legibility} kind=${j?.documentKind} items=${j?.items?.length}`);
  (j?.items || []).slice(0, 8).forEach(x => console.log(`    ${x.originalName} | ${x.translatedName} | ${x.priceRaw} | ${x.vegetarian} | rc=${x.readConfidence}`));
}
