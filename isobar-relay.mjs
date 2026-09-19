#!/usr/bin/env node
// Isobar companion server.
//
// Serves isobar.html and relays feeds a web page can't read directly (sites have to opt in
// before a browser lets another site's page read them, and these don't):
//   GET /isobar/chasers  Spotter Network chaser positions as JSON (refreshed at most once a minute)
//   GET /isobar/live     Storm-chasing YouTube streams that are live now (needs YT_API_KEY)
//   GET /isobar/health   What this server can do
//
// Routes live under /isobar/ rather than /api/ so a copy of the app hosted on Home Assistant
// never pokes Home Assistant's own API (failed API requests there can trip its IP ban).
//
// No dependencies. Needs Node 18 or newer.
//   node isobar-relay.mjs            start the server
//   node isobar-relay.mjs --check    fetch each live source once and print what came back
//
// Settings (environment variables):
//   PORT=8787  HOST=0.0.0.0  YT_API_KEY=...  YT_QUERY="storm chasing live"
//   CHASER_MAX_AGE_MIN=120   SN_URL=... (override the feed, for testing)

import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const YT_KEY = process.env.YT_API_KEY || '';
const YT_QUERY = process.env.YT_QUERY || 'storm chasing live';
const MAX_AGE_MIN = Number(process.env.CHASER_MAX_AGE_MIN || 120);
const SN_URLS = process.env.SN_URL ? [process.env.SN_URL]
  : ['https://www.spotternetwork.org/feeds/gr.txt', 'https://www.spotternetwork.org/feeds/gr-all.txt'];
const UA = 'Isobar/1.0 (personal weather map companion server)';

/* ---------------------------------------------------------------- */
/* Spotter Network placefile -> JSON                                 */
/* ---------------------------------------------------------------- */
// The feed is a GRLevelX placefile. Each chaser is a block like:
//   Object: 35.18,-97.44
//   Icon: 0,0,177,2,15,                         <- heading arrow (icon file 2) when moving
//   Icon: 0,0,000,6,10,"Name\n2026-07-13 17:58:52 UTC\nSTATIONARY\nPhone: ...\nWeb: https://..."
//   Text: 15, 10, 1, "Name"
//   End:
// Only the name, time, status, heading and website are kept. Phone, email, IM and notes that
// some spotters publish are deliberately dropped.
export function parseSpotterPlacefile(text, now = Date.now(), maxAgeMin = MAX_AGE_MIN) {
  const out = [];
  const iconRe = /Icon:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*"((?:[^"\\]|\\.)*)")?/g;
  for (const chunk of text.split(/Object:/).slice(1)) {
    const block = chunk.split(/\bEnd:/)[0];
    const pos = block.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!pos) continue;
    const lat = Number(pos[1]), lon = Number(pos[2]);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) continue;
    let heading = null, tip = null, m;
    iconRe.lastIndex = 0;
    while ((m = iconRe.exec(block))) {
      if (Number(m[4]) === 2) heading = Number(m[3]) % 360;
      if (m[6] != null) tip = m[6];
    }
    if (!tip) continue;
    const lines = tip.split('\\n').map(s => s.replace(/\\(.)/g, '$1').trim()).filter(Boolean);
    const name = lines[0];
    const tm = lines[1] && lines[1].match(/(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/);
    if (!name || !tm) continue;
    const time = Date.UTC(+tm[1], +tm[2] - 1, +tm[3], +tm[4], +tm[5], +tm[6]);
    const ageMin = (now - time) / 60e3;
    if (ageMin > maxAgeMin || ageMin < -10) continue;
    let status = '', web = null;
    for (const l of lines.slice(2)) {
      const kv = l.match(/^([A-Za-z ]+):\s*(.*)$/);
      if (!kv) { if (!status) status = l; continue; }
      if (/^web$/i.test(kv[1]) && /^https?:\/\/\S+$/i.test(kv[2])) web = kv[2];
    }
    out.push({ name, lat, lon, time, status, heading, web });
  }
  out.sort((a, b) => b.time - a.time);
  return out;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.text();
}

async function getChasers() {
  let lastErr;
  for (const url of SN_URLS) {
    try {
      const chasers = parseSpotterPlacefile(await fetchText(url));
      return { source: 'Spotter Network', fetched: Date.now(), chasers };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* ---------------------------------------------------------------- */
/* YouTube live streams                                              */
/* ---------------------------------------------------------------- */
const decodeEntities = s => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export async function getLive() {
  if (!YT_KEY) return { enabled: false, streams: [] };
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  const params = { part: 'snippet', eventType: 'live', type: 'video', q: YT_QUERY, maxResults: '25',
    regionCode: 'US', relevanceLanguage: 'en', safeSearch: 'moderate', key: YT_KEY };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`YouTube answered ${r.status}${j.error && j.error.message ? `: ${j.error.message}` : ''}`);
  const streams = (j.items || []).filter(i => i.id && i.id.videoId).map(i => ({
    id: i.id.videoId,
    title: decodeEntities(i.snippet.title),
    channel: decodeEntities(i.snippet.channelTitle),
    thumb: (i.snippet.thumbnails && (i.snippet.thumbnails.medium || i.snippet.thumbnails.default) || {}).url || null
  }));
  return { enabled: true, fetched: Date.now(), streams };
}

/* ---------------------------------------------------------------- */
/* Small cache: one upstream request at a time, stale copy on error */
/* ---------------------------------------------------------------- */
const cache = new Map();
function cached(key, ttlMs, fn) {
  const c = cache.get(key) || {};
  if (c.value && Date.now() - c.at < ttlMs) return Promise.resolve(c.value);
  if (c.pending) return c.pending;
  c.pending = fn()
    .then(v => { c.value = v; c.at = Date.now(); return v; })
    .catch(e => { if (c.value) return { ...c.value, stale: true }; throw e; })
    .finally(() => { c.pending = null; });
  cache.set(key, c);
  return c.pending;
}

/* ---------------------------------------------------------------- */
/* HTTP                                                              */
/* ---------------------------------------------------------------- */
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*' });
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  try {
    if (pathname === '/' || pathname === '/isobar.html') {
      return send(res, 200, await readFile(path.join(DIR, 'isobar.html')), 'text/html; charset=utf-8');
    }
    if (pathname === '/isobar/health') return send(res, 200, { ok: true, app: 'isobar-relay', youtube: !!YT_KEY });
    if (pathname === '/isobar/chasers') return send(res, 200, await cached('chasers', 60e3, getChasers));
    if (pathname === '/isobar/live') return send(res, 200, await cached('live', 20 * 60e3, getLive));
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'Put isobar.html next to isobar-relay.mjs.', 'text/plain; charset=utf-8');
    return send(res, 502, { error: String(e.message || e) });
  }
}

async function check() {
  console.log('Spotter Network…');
  try {
    const { chasers } = await getChasers();
    console.log(`  ${chasers.length} positions updated in the last ${MAX_AGE_MIN} min`);
    for (const c of chasers.slice(0, 5)) {
      console.log(`  ${c.name.padEnd(24)} ${Math.round((Date.now() - c.time) / 60e3)} min ago  ${c.status || ''}${c.heading != null ? `  heading ${c.heading}°` : ''}`);
    }
    if (!chasers.length) console.log('  (none right now; quiet weather days often have none)');
  } catch (e) { console.log(`  failed: ${e.message}`); process.exitCode = 1; }
  console.log('YouTube…');
  if (!YT_KEY) console.log('  skipped: set YT_API_KEY to list live streams');
  else {
    try { const { streams } = await getLive(); console.log(`  ${streams.length} live streams for "${YT_QUERY}"`); for (const s of streams.slice(0, 5)) console.log(`  ${s.channel}: ${s.title}`); }
    catch (e) { console.log(`  failed: ${e.message}`); process.exitCode = 1; }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--check')) await check();
  else http.createServer(handle).listen(PORT, HOST, () => {
    const addrs = HOST !== '0.0.0.0' ? [HOST] : Object.values(os.networkInterfaces()).flat()
      .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    const host = os.hostname();
    console.log('Isobar companion server is running. Open it at:');
    console.log(`  http://localhost:${PORT}/            (on this Mac)`);
    console.log(`  http://${host.endsWith('.local') ? host : host + '.local'}:${PORT}/   (other devices at home)`);
    for (const a of addrs) console.log(`  http://${a}:${PORT}/`);
    console.log(YT_KEY ? 'YouTube live streams: on' : 'YouTube live streams: off (set YT_API_KEY to turn on)');
  });
}
