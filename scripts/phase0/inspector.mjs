import * as cheerio from 'cheerio';
import { fetchRaw, sniff } from './lib.mjs';
const LEX = /(menu|men[uú]s?|carta|cartes|la-carta|nuestra-carta|food|comida|bebida|drink|brunch|desayun|lunch|almuerzo|dinner|cena|qr|order|pedir|plats|platos|dishes)/i;
const HOSTS = /(qr|cartaqr|menuqr|flipsnack|issuu|yumpingo|gloria|cover|thefork|menulog|tiendup|mnu\.|carta\.|menu\.|pdf|calameo|canva\.com|linktr\.ee|bit\.ly)/i;
const abs = (b, h) => { try { return new URL(h, b).toString().split('#')[0]; } catch { return null; } };
const reg = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').split('.').slice(-2).join('.'); } catch { return ''; } };
export function parsePage(html, base) {
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const links = [];
  $('a[href]').each((_, a) => { const href = abs(base, $(a).attr('href')); if (!href || !/^https?:/.test(href)) return; links.push({ url: href, text: $(a).text().trim().slice(0, 60) }); });
  const imgs = [];
  $('img').each((_, i) => { const src = abs(base, $(i).attr('data-src') || $(i).attr('src')); if (!src) return; imgs.push({ url: src, alt: ($(i).attr('alt') || '').slice(0, 60), w: +$(i).attr('width') || 0 }); });
  const iframes = []; $('iframe[src]').each((_, f) => { const s = abs(base, $(f).attr('src')); if (s) iframes.push(s); });
  const $2 = cheerio.load(html); const scripts = $2('script[src]').map((_, s) => $2(s).attr('src')).get().length;
  return { text, links, imgs, iframes, scripts, title: $('title').text().trim().slice(0, 80) };
}
export const dishLines = (t) => (t.match(/[A-Za-zÀ-ÿ][^\n€\d]{3,60}\s?(\d{1,3}[.,]\d{2}|\d{1,3}\s?€|€\s?\d{1,3})/g) || []).length;

export async function inspectSite(website) {
  const out = { website, steps: [], candidates: [] };
  const home = await fetchRaw(website);
  out.home = { status: home.status, ms: home.ms, error: home.error, finalUrl: home.finalUrl, bytes: home.buf?.length };
  if (!home.ok) { out.blocked = home.status === 403 || home.status === 429 || home.status === 503; return out; }
  const kind = sniff(home.buf);
  if (kind !== 'html/text') { out.candidates.push({ url: home.finalUrl, kind, via: 'website_is_asset' }); return out; }
  const html = home.buf.toString('utf8');
  const p = parsePage(html, home.finalUrl);
  const official = reg(home.finalUrl);
  out.home.textChars = p.text.length; out.home.links = p.links.length; out.home.imgs = p.imgs.length; out.home.scripts = p.scripts;
  out.home.jsShell = p.text.length < 400;
  out.home.dishLines = dishLines(p.text);
  const add = (c) => { if (!out.candidates.some(x => x.url === c.url)) out.candidates.push(c); };
  for (const l of p.links) {
    const isPdf = /\.pdf(\?|$)/i.test(l.url), host = HOSTS.test(l.url) && reg(l.url) !== official;
    if (isPdf || LEX.test(l.url) || LEX.test(l.text) || host) add({ url: l.url, anchor: l.text, kind: isPdf ? 'pdf' : 'link', internal: reg(l.url) === official, externalHost: host, via: 'site_link' });
  }
  for (const i of p.imgs) if (/(menu|carta|men%C3%BA|menú)/i.test(i.url + ' ' + i.alt)) add({ url: i.url, alt: i.alt, kind: 'image', via: 'site_img' });
  for (const f of p.iframes) if (HOSTS.test(f) || LEX.test(f)) add({ url: f, kind: 'iframe', via: 'iframe' });
  if (p.text.length > 0 && /(carta|menu|menú)/i.test(p.text) && out.home.dishLines >= 6) add({ url: home.finalUrl, kind: 'homepage_has_menu', via: 'homepage_dishes' });
  // one level deep on top 3 internal HTML menu-ish links
  const deep = out.candidates.filter(c => c.kind === 'link' && c.internal).slice(0, 3);
  for (const c of deep) {
    const r = await fetchRaw(c.url);
    c.fetch = { status: r.status, ms: r.ms, type: r.type.split(';')[0], sniff: r.buf ? sniff(r.buf) : null };
    if (r.ok && sniff(r.buf) === 'html/text') {
      const pp = parsePage(r.buf.toString('utf8'), r.finalUrl);
      c.textChars = pp.text.length; c.dishLines = dishLines(pp.text); c.jsShell = pp.text.length < 400;
      for (const l of pp.links) if (/\.pdf(\?|$)/i.test(l.url) || (HOSTS.test(l.url) && reg(l.url) !== official)) add({ url: l.url, anchor: l.text, kind: /\.pdf/i.test(l.url) ? 'pdf' : 'link', internal: reg(l.url) === official, via: 'deep_link' });
      for (const i of pp.imgs) if (/(menu|carta)/i.test(i.url + ' ' + i.alt)) add({ url: i.url, kind: 'image', via: 'deep_img' });
    }
  }
  return out;
}
