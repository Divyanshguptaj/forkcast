import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = path.join(ROOT, 'scripts/phase0/out');
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const save = (name, data) => fs.writeFileSync(path.join(OUT, name), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2));

export async function fetchRaw(url, { timeout = 10000, maxBytes = 15e6, headers = {} } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Phase0Research/0.1)', 'Accept-Language': 'es,ca,en;q=0.8', ...headers } });
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: r.ok, status: r.status, finalUrl: r.url, type: r.headers.get('content-type') || '', buf: buf.subarray(0, maxBytes), ms: Date.now() - t0 };
  } catch (e) { return { ok: false, status: 0, error: String(e.cause?.code || e.message), ms: Date.now() - t0 }; }
}
export const sniff = (buf) => buf.subarray(0,4).toString('latin1') === '%PDF' ? 'pdf' : (buf[0]===0xFF&&buf[1]===0xD8) ? 'jpeg' : (buf[0]===0x89&&buf.subarray(1,4).toString()==='PNG') ? 'png' : (buf.subarray(0,4).toString()==='RIFF'&&buf.subarray(8,12).toString()==='WEBP') ? 'webp' : 'html/text';

export async function tavily(pathName, body) {
  const t0 = Date.now();
  const r = await fetch('https://api.tavily.com/' + pathName, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TAVILY_API_KEY }, body: JSON.stringify(body) });
  const txt = await r.text(); let b; try { b = JSON.parse(txt); } catch { b = txt.slice(0, 300); }
  return { status: r.status, body: b, ms: Date.now() - t0 };
}

export const stats = { gemini: [] };
export async function gemini(model, body, { retries = 3, label = '' } = {}) {
  for (let a = 0; a <= retries; a++) {
    const t0 = Date.now();
    let r, b;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      b = await r.json();
    } catch (e) { stats.gemini.push({ label, model, status: 'neterr', ms: Date.now() - t0 }); if (a === retries) return { status: 0, error: e.message }; await sleep(1000 * 2 ** a); continue; }
    const ms = Date.now() - t0;
    stats.gemini.push({ label, model, status: r.status, ms, attempt: a });
    if (r.ok) return { status: 200, ms, body: b, text: b.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') ?? '', usage: b.usageMetadata };
    if ((r.status === 429 || r.status === 503 || r.status === 500) && a < retries) { await sleep(1500 * 2 ** a + Math.random() * 500); continue; }
    return { status: r.status, ms, error: b.error?.message?.slice(0, 300), body: b };
  }
}
export const parseJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
