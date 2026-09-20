// Parse checks and the structural invariants the README's development notes call out.
//
// Isobar has no build step, so nothing else would catch a syntax error before the file
// reaches a browser. The invariants below are the rules that are easy to break by
// accident and silent when broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import path from 'node:path';
import { appScript, ROOT } from './extract.mjs';

const run = promisify(execFile);
const html = await readFile(path.join(ROOT, 'isobar.html'), 'utf8');
const script = await appScript();
const relay = await readFile(path.join(ROOT, 'isobar-relay.mjs'), 'utf8');

test('isobar.html: the inline script parses', () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'isobar.html' }));
});

test('isobar-relay.mjs: parses as a module', async () => {
  await run(process.execPath, ['--check', path.join(ROOT, 'isobar-relay.mjs')]);
});

test('isobar.html: tags are balanced', () => {
  for (const tag of ['style', 'script', 'body', 'html']) {
    const open = (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    assert.equal(open, close, `<${tag}> is unbalanced`);
  }
});

test('isobar.html: the global [hidden] rule survives', () => {
  // Called out in the development notes: without it, component display rules beat the
  // hidden attribute and panels or spinners never disappear.
  assert.match(html, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/,
    'the global [hidden] rule is gone; panels will stop hiding');
});

test('isobar.html: nothing shadows Leaflet\'s L', () => {
  // Also from the development notes. A local `L` silently breaks map calls below it.
  const bad = script.match(/^\s*(?:const|let|var)\s+L\s*[=;]/m);
  assert.equal(bad, null, `a local variable named L would shadow Leaflet: ${bad && bad[0]}`);
});

test('no API keys or tokens are committed', () => {
  // The app's whole premise is that it needs none, and the relay takes its key from
  // the environment. Anything key-shaped in either file is a mistake.
  for (const [name, src] of [['isobar.html', html], ['isobar-relay.mjs', relay]]) {
    assert.ok(!/AIza[0-9A-Za-z_-]{30,}/.test(src), `${name} contains a Google API key`);
    assert.ok(!/\b(?:ghp|gho|github_pat)_[0-9A-Za-z_]{20,}/.test(src), `${name} contains a GitHub token`);
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(src), `${name} contains a secret key`);
  }
  assert.match(relay, /process\.env\.YT_API_KEY/, 'the YouTube key must come from the environment');
});

test('isobar-relay.mjs: every route stays under the /isobar/ prefix', () => {
  // A copy hosted on Home Assistant must never call Home Assistant's own API;
  // failed requests there can trip its IP ban.
  const routes = [...relay.matchAll(/pathname === '([^']+)'/g)].map(m => m[1]);
  assert.ok(routes.length >= 4, 'expected to find the route table');
  for (const r of routes) {
    assert.ok(r === '/' || r === '/isobar.html' || r.startsWith('/isobar/'), `route "${r}" is outside /isobar/`);
  }
  assert.ok(!routes.some(r => r.startsWith('/api/')), 'a route under /api/ would collide with Home Assistant');
});

test('isobar-relay.mjs: has no runtime dependencies', () => {
  // "No dependencies" is a shipping promise: it has to run with a bare `node file.mjs`.
  for (const m of [...relay.matchAll(/^import .* from '([^']+)';/gm)].map(m => m[1])) {
    assert.ok(m.startsWith('node:'), `relay imports "${m}", which is not a built-in`);
  }
});

test('isobar.html: external scripts are pinned to a version', () => {
  // An unpinned CDN URL turns someone else's release into an outage here.
  for (const url of [...html.matchAll(/<script src="(https:\/\/[^"]+)"/g)].map(m => m[1])) {
    assert.match(url, /\d+\.\d+\.\d+/, `${url} is not pinned to an exact version`);
  }
});

test('isobar.html: the Open-Meteo attribution required by its licence is present', () => {
  // Model data is CC BY 4.0; attribution is a licence condition, not decoration.
  assert.match(html, /Open-Meteo/, 'the Open-Meteo credit is missing');
});

test('README documents every model the app ships', async () => {
  const readme = await readFile(path.join(ROOT, 'README.md'), 'utf8');
  const names = [...script.matchAll(/\bname: '([^']+)', ids: \[/g)].map(m => m[1]);
  assert.ok(names.length >= 9, `expected the model table, found ${names.length} entries`);
  for (const n of names) {
    assert.ok(readme.includes(n), `model "${n}" is not in the README table`);
  }
});

/* ------------------------------------------------------------------ */
/* Markup wiring                                                       */
/* ------------------------------------------------------------------ */
// There is no browser coverage yet, so these stand in for the class of bug a
// screenshot would catch instantly: a selector pointing at an element that is not
// there. A mistyped id fails silently at runtime -- the button simply does nothing.

test('every $("#id") in the script points at an id that exists', () => {
  const refs = new Set([...script.matchAll(/\$\$?\('#([A-Za-z][\w-]*)/g)].map(m => m[1]));
  const defined = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  assert.ok(refs.size > 20, `expected to find the selectors, found ${refs.size}`);
  const missing = [...refs].filter(r => !defined.has(r));
  assert.deepEqual(missing, [], `these selectors match nothing: ${missing.join(', ')}`);
});

test('every tab has the panel it claims to control', () => {
  const tabs = [...html.matchAll(/role="tab"[^>]*aria-controls="([^"]+)"/g)].map(m => m[1]);
  const panels = [...html.matchAll(/role="tabpanel"[^>]*id="([^"]+)"|id="([^"]+)"[^>]*role="tabpanel"/g)]
    .map(m => m[1] || m[2]);
  assert.ok(tabs.length >= 5, `expected the tab lists, found ${tabs.length}`);
  for (const t of tabs) assert.ok(panels.includes(t), `tab controls "${t}", which is not a tabpanel`);
  for (const p of panels) assert.ok(tabs.includes(p), `tabpanel "${p}" has no tab`);
});

test('every data-tab button is handled by showTab', () => {
  // A tab whose panel showTab never unhides would open to a blank sheet.
  const buttons = [...html.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(buttons)].sort(), ['compare', 'now', 'sounding']);
  const body = script.slice(script.indexOf('function showTab('));
  for (const t of buttons) {
    assert.ok(body.includes(`tab !== '${t}'`), `showTab never hides the "${t}" panel`);
  }
});

test('the point panel tabs and the remembered tab agree', () => {
  // state.tab is restored from localStorage; a value showTab cannot handle would
  // leave the panel stuck on an invisible tab.
  const stored = script.match(/tab: \[([^\]]+)\]\.includes\(store\.get\('tab'\)\)/);
  assert.ok(stored, 'the remembered tab should be validated against a list');
  const allowed = stored[1].split(',').map(s => s.trim().replace(/'/g, '')).sort();
  const buttons = [...new Set([...html.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]))].sort();
  assert.deepEqual(allowed, buttons, 'the allowed tabs and the tab buttons have drifted apart');
});

test('every data source the app fetches from is key-free', () => {
  // The whole premise is that Isobar needs no accounts. Any new data endpoint has to
  // hold that line; the one keyed service (YouTube) stays behind the companion server.
  // Only fetched hosts matter here -- outbound links to chaser sites are not requests.
  const fetched = new Set([...script.matchAll(/fetch\(\s*`?'?https:\/\/([a-z0-9.-]+)/g)].map(m => m[1]));
  const allowed = new Set([
    'api.open-meteo.com',              // models, point forecasts, soundings, conditions
    'air-quality-api.open-meteo.com',  // US AQI
    'geocoding-api.open-meteo.com',    // place search
    'api.weather.gov',                 // warnings and place names
    'mesonet.agron.iastate.edu',       // radar, satellite, MRMS
    'cdn.jsdelivr.net'                 // the state and country shapes
  ]);
  assert.ok(fetched.size >= 5, `expected to find the data sources, found ${fetched.size}`);
  for (const h of fetched) {
    assert.ok(allowed.has(h), `the app fetches from a new host, ${h}: confirm it needs no key`);
  }
  assert.ok(!/[?&]key=/.test(script), 'the app itself must never send an API key');
  assert.ok(!/[?&]appid=/i.test(script), 'the app itself must never send an API key');
});
