// Tests for the companion server: the Spotter Network placefile parser, the YouTube
// mapping, and the HTTP routes.
//
// The parser is the privacy boundary of this project. Spotters publish phone numbers,
// email addresses, IM handles and free-text notes in the same tooltip as their name,
// and none of it may reach the app. That is asserted here against the whole payload,
// not field by field, so a future field can't slip through unnoticed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { ROOT } from './extract.mjs';

const FIX = path.join(ROOT, 'test/fixtures');
const feed = await readFile(path.join(FIX, 'spotter-gr.txt'), 'utf8');
const collapsed = await readFile(path.join(FIX, 'spotter-collapsed.txt'), 'utf8');

// Fixed clock: the fixture's timestamps are relative to this instant.
const NOW = Date.UTC(2026, 6, 13, 18, 0, 0);

const { parseSpotterPlacefile } = await import('../isobar-relay.mjs?relay=parse');
const parse = (text = feed, now = NOW, maxAge = 120) => parseSpotterPlacefile(text, now, maxAge);
const byName = (list, n) => list.find(c => c.name === n);

/* ------------------------------------------------------------------ */
/* Placefile parsing                                                   */
/* ------------------------------------------------------------------ */

test('parser: reads position, name, time and status', () => {
  const c = byName(parse(), 'Moving Chaser');
  assert.ok(c, 'the freshest chaser should be parsed');
  assert.equal(c.lat, 35.18);
  assert.equal(c.lon, -97.44);
  assert.equal(c.status, 'CHASING');
  assert.equal(c.time, Date.UTC(2026, 6, 13, 17, 58, 52));
});

test('parser: a moving chaser gets a heading, a stationary one does not', () => {
  assert.equal(byName(parse(), 'Moving Chaser').heading, 177);
  assert.equal(byName(parse(), 'Stationary Chaser').heading, null);
});

test('parser: contact details never reach the output', () => {
  // The single most important assertion in this file.
  const out = parse();
  const blob = JSON.stringify(out);
  for (const secret of [
    '555-867-5309', 'chaser@example.com', 'someone@chat.example',
    'Phone', 'Email', 'IM:', 'truck stop'
  ]) {
    assert.ok(!blob.includes(secret), `"${secret}" leaked into the chaser feed`);
  }
  // And the fields themselves are the only ones published.
  for (const c of out) {
    assert.deepEqual(Object.keys(c).sort(), ['heading', 'lat', 'lon', 'name', 'status', 'time', 'web']);
  }
});

test('parser: a free-text note is not mistaken for a status', () => {
  // "Notes: ..." is a key/value line, so it must be dropped rather than shown.
  const c = byName(parse(), 'Stationary Chaser');
  assert.equal(c.status, 'STATIONARY');
});

test('parser: keeps an http or https website', () => {
  assert.equal(byName(parse(), 'Moving Chaser').web, 'https://example.com/moving');
  assert.equal(byName(parse(), 'Quoted "Nickname" Chaser').web, 'http://example.com/plain');
});

test('parser: rejects a javascript: or other non-http link', () => {
  assert.equal(byName(parse(), 'Script Link').web, null);
  assert.equal(byName(parse(), 'Ftp Link').web, null);
  assert.ok(!JSON.stringify(parse()).includes('javascript:'), 'a script URL reached the output');
});

test('parser: unescapes quotes inside a tooltip', () => {
  assert.ok(byName(parse(), 'Quoted "Nickname" Chaser'), 'escaped quotes broke the name');
});

test('parser: drops positions older than the age limit', () => {
  assert.ok(!byName(parse(), 'Too Old'), '3-hour-old position should be dropped');
  assert.ok(byName(parse(), 'Edge Of Window'), '110-minute position should be kept');
  // Tightening the window drops the edge case too.
  assert.ok(!byName(parse(feed, NOW, 60), 'Edge Of Window'));
});

test('parser: drops positions dated in the future', () => {
  // A clock-skewed reporter shouldn't sort to the top of the list forever.
  assert.ok(!byName(parse(), 'From The Future'));
});

test('parser: drops impossible coordinates', () => {
  assert.ok(!byName(parse(), 'Bad Latitude'));
  for (const c of parse()) {
    assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180, `${c.name} has bad coordinates`);
  }
});

test('parser: skips a block with no tooltip', () => {
  assert.ok(!byName(parse(), 'No Tooltip'));
});

test('parser: sorts newest first', () => {
  const out = parse();
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].time >= out[i].time, 'positions are out of order');
  }
  assert.equal(out[0].name, 'Moving Chaser');
});

test('parser: reads the collapsed single-line form the same way', () => {
  const [c] = parse(collapsed);
  assert.equal(c.name, 'Collapsed Form');
  assert.equal(c.lat, 33.4484);
  assert.equal(c.lon, -112.074);
  assert.equal(c.heading, 90);
  assert.equal(c.status, 'CHASING');
  assert.equal(c.web, 'https://example.com/collapsed');
});

test('parser: survives junk input without throwing', () => {
  for (const junk of ['', 'Title: nothing here', 'Object:', 'Object: abc,def\nEnd:', '\u0000\u0001']) {
    assert.deepEqual(parse(junk), [], `junk input produced output: ${JSON.stringify(junk)}`);
  }
});

/* ------------------------------------------------------------------ */
/* YouTube mapping                                                     */
/* ------------------------------------------------------------------ */

const ytItem = (id, title, channel) => ({
  id: { videoId: id },
  snippet: { title, channelTitle: channel, thumbnails: { medium: { url: `https://i.example/${id}.jpg` } } }
});

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('live: with no API key the feature reports itself off', async () => {
  delete process.env.YT_API_KEY;
  const { getLive } = await import('../isobar-relay.mjs?relay=nokey');
  assert.deepEqual(await getLive(), { enabled: false, streams: [] });
});

test('live: maps the API response and decodes HTML entities', async () => {
  process.env.YT_API_KEY = 'test-key';
  const { getLive } = await import('../isobar-relay.mjs?relay=key');
  const body = {
    items: [
      ytItem('aaa', 'Tornado &amp; hail &quot;live&quot;', 'Storm &#39;Chaser&#39;'),
      { id: {}, snippet: { title: 'no video id', channelTitle: 'x' } },
      ytItem('bbb', 'Second stream', 'Another')
    ]
  };
  const out = await withFetch(async () => ({ ok: true, json: async () => body }), getLive);
  assert.equal(out.enabled, true);
  assert.equal(out.streams.length, 2, 'items without a videoId should be dropped');
  assert.equal(out.streams[0].title, 'Tornado & hail "live"');
  assert.equal(out.streams[0].channel, "Storm 'Chaser'");
  assert.equal(out.streams[0].thumb, 'https://i.example/aaa.jpg');
});

test('live: sends the documented query parameters', async () => {
  process.env.YT_API_KEY = 'test-key';
  const { getLive } = await import('../isobar-relay.mjs?relay=key');
  let seen;
  await withFetch(async u => { seen = new URL(u); return { ok: true, json: async () => ({ items: [] }) }; }, getLive);
  assert.equal(seen.searchParams.get('eventType'), 'live');
  assert.equal(seen.searchParams.get('type'), 'video');
  assert.equal(seen.searchParams.get('key'), 'test-key');
  assert.equal(seen.searchParams.get('safeSearch'), 'moderate');
});

test('live: a quota error surfaces the reason', async () => {
  process.env.YT_API_KEY = 'test-key';
  const { getLive } = await import('../isobar-relay.mjs?relay=key');
  await assert.rejects(
    () => withFetch(async () => ({
      ok: false, status: 403,
      json: async () => ({ error: { message: 'The request cannot be completed because you have exceeded your quota.' } })
    }), getLive),
    /403.*quota/s
  );
});

test('live: a missing thumbnail is null rather than a crash', async () => {
  process.env.YT_API_KEY = 'test-key';
  const { getLive } = await import('../isobar-relay.mjs?relay=key');
  const out = await withFetch(async () => ({
    ok: true, json: async () => ({ items: [{ id: { videoId: 'c' }, snippet: { title: 't', channelTitle: 'c' } }] })
  }), getLive);
  assert.equal(out.streams[0].thumb, null);
});

/* ------------------------------------------------------------------ */
/* HTTP routes (the real server, in a child process)                   */
/* ------------------------------------------------------------------ */

/**
 * Re-dates the fixture so its positions are as far from *now* as they are from NOW.
 * The parser takes an injectable clock, but the running server uses Date.now(), so a
 * fixed-date fixture would read as months stale the day after it was written.
 */
function freshen(text, now = Date.now()) {
  const delta = now - NOW, p2 = n => String(n).padStart(2, '0');
  return text.replace(/(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) UTC/g, (_, Y, M, D, h, m, s) => {
    const d = new Date(Date.UTC(+Y, +M - 1, +D, +h, +m, +s) + delta);
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} `
      + `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC`;
  });
}

test('freshen: the test fixture keeps its shape when re-dated', () => {
  // Guards the harness itself -- a broken freshen would make the route tests vacuous.
  const out = parse(freshen(feed, NOW), NOW);
  assert.equal(out.length, 6);
  assert.equal(out[0].name, 'Moving Chaser');
});

/** Serves the placefile fixture and counts how often it was asked for. */
function fixtureFeed() {
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(freshen(feed));
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () =>
    resolve({ url: `http://127.0.0.1:${srv.address().port}/gr.txt`, hits: () => hits, close: () => srv.close() })));
}

function startRelay(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'isobar-relay.mjs')], {
    env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const to = setTimeout(() => reject(new Error(`relay did not start:\n${out}`)), 10000);
    child.stdout.on('data', d => {
      out += d;
      if (out.includes('is running')) { clearTimeout(to); resolve({ child, out: () => out }); }
    });
    child.on('error', reject);
    child.on('exit', c => { clearTimeout(to); reject(new Error(`relay exited early (${c}):\n${out}`)); });
  });
}

test('routes: health, chasers, live, the app itself, and the error paths', async t => {
  const fix = await fixtureFeed();
  const port = 18787;
  const { child } = await startRelay({ PORT: String(port), HOST: '127.0.0.1', SN_URL: fix.url, YT_API_KEY: '' });
  const base = `http://127.0.0.1:${port}`;
  try {
    await t.test('/isobar/health reports what the server can do', async () => {
      const r = await fetch(`${base}/isobar/health`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ok: true, app: 'isobar-relay', youtube: false });
    });

    await t.test('/isobar/chasers returns parsed positions', async () => {
      const r = await fetch(`${base}/isobar/chasers`);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.source, 'Spotter Network');
      assert.equal(j.chasers.length, 6, 'stale, future, bad-coordinate and tooltip-less blocks should be gone');
      assert.ok(!JSON.stringify(j).includes('555-867-5309'), 'contact details served over HTTP');
    });

    await t.test('/isobar/chasers is cached, not refetched every time', async () => {
      const before = fix.hits();
      await Promise.all([fetch(`${base}/isobar/chasers`), fetch(`${base}/isobar/chasers`), fetch(`${base}/isobar/chasers`)]);
      assert.equal(fix.hits(), before, 'the 60-second cache should have absorbed these');
    });

    await t.test('/isobar/live is off without a key', async () => {
      assert.deepEqual(await (await fetch(`${base}/isobar/live`)).json(), { enabled: false, streams: [] });
    });

    await t.test('/ serves the app', async () => {
      const r = await fetch(`${base}/`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.match(await r.text(), /<title>Isobar<\/title>/);
    });

    await t.test('responses are CORS-open so a Home Assistant copy can call in', async () => {
      const r = await fetch(`${base}/isobar/health`);
      assert.equal(r.headers.get('access-control-allow-origin'), '*');
    });

    await t.test('an unknown path is a 404, not the app', async () => {
      const r = await fetch(`${base}/isobar/nope`);
      assert.equal(r.status, 404);
      assert.deepEqual(await r.json(), { error: 'Not found' });
    });

    await t.test('nothing is served from outside the /isobar/ prefix', async () => {
      // A copy hosted on Home Assistant must never provoke calls to HA's own API.
      for (const p of ['/api/states', '/api/', '/isobar-relay.mjs', '/../package.json']) {
        assert.equal((await fetch(`${base}${p}`)).status, 404, `${p} should not be served`);
      }
    });

    await t.test('a write method is refused', async () => {
      const r = await fetch(`${base}/isobar/chasers`, { method: 'POST' });
      assert.equal(r.status, 405);
    });

    await t.test('preflight is answered', async () => {
      const r = await fetch(`${base}/isobar/chasers`, { method: 'OPTIONS' });
      assert.equal(r.status, 204);
      assert.equal(r.headers.get('access-control-allow-methods'), 'GET');
    });
  } finally {
    child.kill();
    fix.close();
  }
});

test('routes: an upstream failure is reported as a 502, not a crash', async () => {
  const dead = http.createServer((req, res) => { res.writeHead(500); res.end('nope'); });
  await new Promise(r => dead.listen(0, '127.0.0.1', r));
  const port = 18788;
  const { child } = await startRelay({
    PORT: String(port), HOST: '127.0.0.1',
    SN_URL: `http://127.0.0.1:${dead.address().port}/gr.txt`, YT_API_KEY: ''
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/isobar/chasers`);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /500/);
    // The server must still be alive afterwards.
    assert.equal((await fetch(`http://127.0.0.1:${port}/isobar/health`)).status, 200);
  } finally {
    child.kill();
    dead.close();
  }
});

test('--check prints what came back and exits cleanly', async () => {
  const fix = await fixtureFeed();
  try {
    const out = await new Promise((resolve, reject) => {
      const c = spawn(process.execPath, [path.join(ROOT, 'isobar-relay.mjs'), '--check'], {
        env: { ...process.env, SN_URL: fix.url, YT_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe']
      });
      let s = '';
      c.stdout.on('data', d => s += d);
      c.on('error', reject);
      c.on('exit', code => resolve({ code, s }));
    });
    assert.equal(out.code, 0, `--check should succeed:\n${out.s}`);
    assert.match(out.s, /Spotter Network/);
    assert.match(out.s, /6 positions updated in the last 120 min/);
    assert.match(out.s, /Moving Chaser/);
    assert.match(out.s, /skipped: set YT_API_KEY/);
    assert.ok(!out.s.includes('555-867-5309'), '--check printed contact details');
  } finally {
    fix.close();
  }
});
