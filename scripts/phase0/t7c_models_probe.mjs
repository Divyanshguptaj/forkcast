import { gemini } from './lib.mjs';
const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];
const rows = [];
for (const m of models) {
  const r = await gemini(m, { contents: [{ parts: [{ text: 'Reply with the single word OK' }] }], generationConfig: { maxOutputTokens: 200 } }, { retries: 0, label: 'probe ' + m });
  let info = ''; if (r.body?.error) { const msg = r.body.error.message; const lim = msg.match(/limit: (\d+)/)?.[1]; const q = r.body.error.details?.find(d => d.violations)?.violations?.[0]?.quotaId; info = `${(msg.match(/no longer available[^.]*/)||[''])[0]} limit=${lim || ''} ${q || ''}`.trim().slice(0, 140); }
  rows.push({ model: m, status: r.status, ms: r.ms, out: (r.text || '').trim().slice(0, 10), info }); 
}
console.table(rows);
