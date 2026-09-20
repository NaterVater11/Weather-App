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
