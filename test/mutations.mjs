#!/usr/bin/env node
// Mutation harness: breaks the app on purpose, one edit at a time, and checks that a
// test fails each time. Run with `npm run mutate`.
//
// A green suite only proves the tests ran. This proves they bite. Each entry is a
// realistic regression -- an inverted sign, a shifted threshold, a dropped guard --
// rather than random noise, so an escape names something genuinely unprotected.
//
// The harness refuses a mutation whose pattern is missing or whose edit changes
// nothing, because a no-op mutation "passes" for the wrong reason and quietly
// overstates the coverage.

import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'isobar.html', RELAY = 'isobar-relay.mjs';

const MUTATIONS = [
  // --- contouring and interpolation ---
  ['contour: level range becomes inclusive', APP, 'test/pure.test.mjs',
    'if (lev <= mn || lev > mx) continue;', 'if (lev < mn || lev > mx) continue;'],
  ['contour: drop the NaN guard', APP, 'test/pure.test.mjs',
    'if (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d)) continue;', 'if (false) continue;'],
  ['bilinear: clamp instead of returning NaN outside', APP, 'test/pure.test.mjs',
    'if (gx < 0 || gy < 0 || gx > nx - 1 || gy > ny - 1) return NaN;', 'if (false) return NaN;'],
  // --- sounding thermodynamics ---
  ['parcel: break the RK2 midpoint', APP, 'test/pure.test.mjs',
    'T -= k2 * step; p -= step;', 'T -= k1 * step; p -= step;'],
  ['barbs: flag threshold 50 -> 45 kt', APP, 'test/pure.test.mjs',
    'const flags = Math.floor(n / 50); n -= flags * 50;', 'const flags = Math.floor(n / 45); n -= flags * 45;'],
  ['ticks: drop the flat-range guard', APP, 'test/pure.test.mjs',
    'if (hi === lo) { hi = lo + 1; }', 'if (false) { hi = lo + 1; }'],
  // --- forum rules ---
  ['boards: shift the Virginia latitude split', APP, 'test/boards.test.mjs',
    "case '51': keys = lat < 37.3", "case '51': keys = lat < 36.3"],
  ['boards: shift the IA/MO/MN longitude split', APP, 'test/boards.test.mjs',
    "case '19': case '27': case '29': keys = lon > -93.6", "case '19': case '27': case '29': keys = lon > -90.6"],
  ['boards: territories fall through to Central/Western', APP, 'test/boards.test.mjs',
    "case '60': case '66': case '69': case '72': case '78': keys = []; break;",
    "case '60': case '66': case '69': case '72': case '78': keys = ['cw']; break;"],
  // --- documented invariants ---
  ['invariant: delete the global [hidden] rule', APP, 'test/syntax.test.mjs',
    '[hidden]{display:none!important}', '[hidden]{display:none}'],
  ["invariant: shadow Leaflet's L", APP, 'test/syntax.test.mjs',
    'const canvas = document.createElement', 'const L = 1;\nconst canvas = document.createElement'],
  // --- sun and moon ---
  ['sun: ignore refraction at sunrise', APP, 'test/derived.test.mjs',
    'sunrise: -0.833,', 'sunrise: 0,'],
  ['sun: wrong obliquity', APP, 'test/derived.test.mjs',
    'Math.sin(23.4397 * D2R)', 'Math.sin(23.0 * D2R)'],
  ['sun: drop the polar day and night branch', APP, 'test/derived.test.mjs',
    'return c > 1 ? NaN : c < -1 ? Infinity : Math.acos(c) * R2D / 360;',
    'return Math.acos(Math.max(-1, Math.min(1, c))) * R2D / 360;'],
  ['moon: name by even eighths again', APP, 'test/derived.test.mjs',
    '  return p < 0.25 ? MOON_NAMES[1] : p < 0.5 ? MOON_NAMES[3] : p < 0.75 ? MOON_NAMES[5] : MOON_NAMES[7];',
    '  return MOON_NAMES[Math.round(p * 8) % 8];'],
  // --- hodograph ---
  ['wind: direction treated as TOWARD, not FROM', APP, 'test/derived.test.mjs',
    '  return [-speed * Math.sin(r), -speed * Math.cos(r)];', '  return [speed * Math.sin(r), speed * Math.cos(r)];'],
  ['helicity: flip the sign convention', APP, 'test/derived.test.mjs',
    'sum += (w.u - motion.u) * (prev.v - motion.v) - (prev.u - motion.u) * (w.v - motion.v);',
    'sum -= (w.u - motion.u) * (prev.v - motion.v) - (prev.u - motion.u) * (w.v - motion.v);'],
  ['bunkers: deviation 7.5 -> 10 m/s', APP, 'test/derived.test.mjs', 'const D = 7.5;', 'const D = 10;'],
  ['bunkers: right mover deviates left', APP, 'test/derived.test.mjs',
    'right: { u: mean.u + D * sv / mag, v: mean.v - D * su / mag },',
    'right: { u: mean.u - D * sv / mag, v: mean.v + D * su / mag },'],
  ['windAt: extrapolate above the profile', APP, 'test/derived.test.mjs',
    '  }\n  return null;\n}\n\n/** Bulk wind difference',
    '  }\n  return { u: levels[levels.length - 1].u, v: levels[levels.length - 1].v };\n}\n\n/** Bulk wind difference'],
  // --- nowcast, air quality, saved places ---
  ['nowcast: ignore the horizon', APP, 'test/derived.test.mjs',
    'const end = Math.min(times.length, i + horizonH * 4);', 'const end = times.length;'],
  ['nowcast: drizzle counts as rain', APP, 'test/derived.test.mjs', 'const WET = 0.1;', 'const WET = 0;'],
  ['aqi: band boundary off by one', APP, 'test/derived.test.mjs',
    "  [50, 'Good', '#3fd37a'],", "  [51, 'Good', '#3fd37a'],"],
  ['places: stop deduping', APP, 'test/derived.test.mjs',
    '.concat(list.filter(p => placeKey(p.lat, p.lon) !== key))', '.concat(list)'],
  ['places: ignore the cap', APP, 'test/derived.test.mjs', '    .slice(0, max);', '    .slice(0, 9999);'],
  // --- the companion server's privacy boundary ---
  ['relay: let any URL scheme through', RELAY, 'test/relay.test.mjs',
    '/^https?:\\/\\/\\S+$/i.test(kv[2])', 'true'],
  ['relay: publish the raw tooltip', RELAY, 'test/relay.test.mjs',
    'out.push({ name, lat, lon, time, status, heading, web });',
    'out.push({ name, lat, lon, time, status, heading, web, tip });'],
  ['relay: status overwritten by contact lines', RELAY, 'test/relay.test.mjs',
    'if (!kv) { if (!status) status = l; continue; }', 'if (!kv) { if (!status) status = l; continue; } status = l;'],
  ['relay: keep stale positions', RELAY, 'test/relay.test.mjs',
    'if (ageMin > maxAgeMin || ageMin < -10) continue;', 'if (false) continue;'],
  ['relay: skip coordinate validation', RELAY, 'test/relay.test.mjs',
    'if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) continue;', '']
];

const only = process.argv[2];
const list = only ? MUTATIONS.filter(m => m[0].includes(only)) : MUTATIONS;
if (!list.length) { console.error(`No mutation matches "${only}"`); process.exit(2); }

// Back the originals up outside the tree, so a crash cannot leave the repo mutated.
const safe = mkdtempSync(path.join(tmpdir(), 'isobar-mutate-'));
for (const f of [APP, RELAY]) copyFileSync(path.join(ROOT, f), path.join(safe, f));
const restore = () => { for (const f of [APP, RELAY]) copyFileSync(path.join(safe, f), path.join(ROOT, f)); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130); });

let caught = 0, escaped = [], broken = [];
try {
  for (const [name, file, suite, from, to] of list) {
    const target = path.join(ROOT, file);
    const before = readFileSync(target, 'utf8');
    if (!before.includes(from)) { broken.push(`${name} (pattern not found)`); continue; }
    const after = before.replace(from, to);
    if (after === before) { broken.push(`${name} (edit changed nothing)`); continue; }
    writeFileSync(target, after);
    let failed = false;
    try { execFileSync(process.execPath, ['--test', suite], { cwd: ROOT, stdio: 'pipe' }); }
    catch { failed = true; }
    restore();
    if (failed) { caught++; console.log(`  caught   ${name}`); }
    else { escaped.push(name); console.log(`  ESCAPED  ${name}`); }
  }
} finally {
  restore();
  rmSync(safe, { recursive: true, force: true });
}

console.log(`\ncaught ${caught} / escaped ${escaped.length} / broken ${broken.length} of ${list.length}`);
for (const b of broken) console.log(`  broken:  ${b}`);
for (const e of escaped) console.log(`  escaped: ${e}`);
process.exit(escaped.length || broken.length ? 1 : 0);
