import { gemini, sleep } from './lib.mjs';
const r = await gemini('gemini-2.5-flash', { contents: [{ parts: [{ text: 'Say OK' }] }], generationConfig: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 5 } }, { retries: 0, label: 'probe' });
console.log(r.status, r.ms + 'ms');
if (r.status === 429) { const e = r.body.error; console.log(e.message.split('\n').slice(0, 8).join('\n')); for (const d of e.details || []) { if (d['@type']?.includes('QuotaFailure')) console.log('violations:', JSON.stringify(d.violations?.map(v => ({ metric: v.quotaMetric?.split('/').pop(), id: v.quotaId, dim: v.quotaDimensions }))).slice(0, 600)); if (d['@type']?.includes('RetryInfo')) console.log('retryDelay', d.retryDelay); } }
