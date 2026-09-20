// Unit tests for the pure functions inside isobar.html: contouring, interpolation,
// parcel thermodynamics, chart ticks, wind barbs and color scales.

import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const app = await load([
  'contourSegments', 'bilinear', 'upsample', 'barbMarkup', 'colorAt',
  'niceTicks', 'moistDTdp', 'moistPath', 'liftParcel', 'hex', 'mkScale', 'miles'
]);

const close = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${a} within ${eps} of ${b}`);

/* ------------------------------------------------------------------ */
/* Contouring (marching squares)                                       */
/* ------------------------------------------------------------------ */

test('contourSegments: a horizontal gradient contours across the cell', () => {
  // One cell. Top row 0, bottom row 10; the 5-line sits halfway down.
  const segs = app.contourSegments([0, 0, 10, 10], 2, 2, [5]);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], [[0, 0.5], [1, 0.5]]);
});

test('contourSegments: a vertical gradient contours down the cell', () => {
  const segs = app.contourSegments([0, 10, 0, 10], 2, 2, [5]);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], [[0.5, 0], [0.5, 1]]);
});

test('contourSegments: a saddle emits two separate segments', () => {
  // Opposite corners high: the level splits into two arcs, not one crossing line.
  const segs = app.contourSegments([0, 10, 10, 0], 2, 2, [5]);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs, [[[0, 0.5], [0.5, 0]], [[0.5, 1], [1, 0.5]]]);
});

test('contourSegments: a flat field has no contours at any level', () => {
  const flat = new Float32Array(16).fill(7);
  assert.equal(app.contourSegments(flat, 4, 4, [6, 7, 8]).length, 0);
});

test('contourSegments: cells touching NaN are skipped, not interpolated', () => {
  const vals = [0, 0, NaN, 10, 10, 10, 10, 10, 10];
  // The two cells of the top row touch the NaN; the bottom row is flat.
  assert.equal(app.contourSegments(vals, 3, 3, [5]).length, 1);
});

test('contourSegments: a level sitting exactly on grid values draws nothing', () => {
  // Documented edge case, not an accident to "fix" casually. The guard admits
  // lev === mx, but the corner test is strict (`a > lev`), so every corner classifies
  // as below and the cell comes out as case 0. The level range is therefore open at
  // both ends. It is harmless in practice: pressure_msl arrives as floats, so a 4 mb
  // isobar effectively never coincides with a sample value. A synthetic integer field
  // does coincide, and gets no line. Switching the corner test to `>=` (and the guard
  // to `lev < mn`) would close it -- this test will fail loudly if anyone does.
  assert.equal(app.contourSegments([0, 0, 10, 10], 2, 2, [10]).length, 0);
  assert.equal(app.contourSegments([0, 0, 10, 10], 2, 2, [0]).length, 0);
  // A hair to either side contours normally.
  assert.equal(app.contourSegments([0, 0, 10, 10], 2, 2, [9.999]).length, 1);
  assert.equal(app.contourSegments([0, 0, 10, 10], 2, 2, [0.001]).length, 1);
});

test('contourSegments: a linear field contours exactly on the level', () => {
  // f(x, y) = x, so the 3.5-contour must be the straight line x = 3.5.
  const nx = 9, ny = 5, vals = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) vals[j * nx + i] = i;
  const segs = app.contourSegments(vals, nx, ny, [3.5]);
  assert.ok(segs.length >= ny - 1, 'expected a segment in each row of cells');
  for (const [p, q] of segs) for (const pt of [p, q]) close(pt[0], 3.5, 1e-6, 'contour x');
});

test('contourSegments: a cone contours on a circle of the right radius', () => {
  // Accuracy check against a curved field: every point on the r = 3 contour
  // should sit 3 cells from the center, within linear-interpolation error.
  const n = 25, c = 12, vals = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vals[j * n + i] = Math.hypot(i - c, j - c);
  const segs = app.contourSegments(vals, n, n, [3]);
  assert.ok(segs.length > 12, `expected a closed ring, got ${segs.length} segments`);
  let worst = 0;
  for (const [p, q] of segs) for (const pt of [p, q]) worst = Math.max(worst, Math.abs(Math.hypot(pt[0] - c, pt[1] - c) - 3));
  assert.ok(worst < 0.06, `worst radial error ${worst.toFixed(4)} cells`);
});

test('contourSegments: every requested level is drawn', () => {
  // Offset by half a unit so no level lands exactly on a sample (see the test above).
  const nx = 12, ny = 12, vals = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) vals[j * nx + i] = i * 2 + 0.5;
  for (const lev of [4, 8, 12, 16]) {
    assert.ok(app.contourSegments(vals, nx, ny, [lev]).length > 0, `level ${lev} produced nothing`);
  }
  // Isobars are drawn every 4 mb; all four levels together must not lose any.
  const all = app.contourSegments(vals, nx, ny, [4, 8, 12, 16]);
  assert.equal(all.length, [4, 8, 12, 16].reduce((s, l) => s + app.contourSegments(vals, nx, ny, [l]).length, 0));
});

/* ------------------------------------------------------------------ */
/* Interpolation                                                       */
/* ------------------------------------------------------------------ */

test('bilinear: corners return the grid values exactly', () => {
  const v = [1, 2, 3, 4];
  assert.equal(app.bilinear(v, 2, 2, 0, 0), 1);
  assert.equal(app.bilinear(v, 2, 2, 1, 0), 2);
  assert.equal(app.bilinear(v, 2, 2, 0, 1), 3);
  assert.equal(app.bilinear(v, 2, 2, 1, 1), 4);
});

test('bilinear: the cell center is the mean of its corners', () => {
  close(app.bilinear([1, 2, 3, 4], 2, 2, 0.5, 0.5), 2.5, 1e-9);
});

test('bilinear: points outside the grid are NaN, not clamped', () => {
  for (const [gx, gy] of [[-0.01, 0], [0, -0.01], [1.01, 0], [0, 1.01]]) {
    assert.ok(isNaN(app.bilinear([1, 2, 3, 4], 2, 2, gx, gy)), `expected NaN at ${gx},${gy}`);
  }
});

test('bilinear: a NaN corner falls back to the nearest neighbour', () => {
  // Nearest-neighbour keeps an edge usable instead of punching a hole in the field.
  const v = [NaN, 2, 3, 4];
  assert.equal(app.bilinear(v, 2, 2, 0.9, 0.1), 2);
  assert.equal(app.bilinear(v, 2, 2, 0.1, 0.9), 3);
  assert.equal(app.bilinear(v, 2, 2, 0.9, 0.9), 4);
  assert.ok(isNaN(app.bilinear(v, 2, 2, 0.1, 0.1)), 'the NaN corner itself stays NaN');
});

test('upsample: output dimensions follow (n - 1) * U + 1', () => {
  const { out, NX, NY } = app.upsample(new Float32Array(12).fill(1), 4, 3, 5);
  assert.equal(NX, 16);
  assert.equal(NY, 11);
  assert.equal(out.length, 16 * 11);
});

test('upsample: a linear field stays linear', () => {
  // Isobars upsample 3x before contouring; a linear ramp must survive untouched.
  const nx = 5, ny = 4, U = 3, vals = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) vals[j * nx + i] = i * 3 + j;
  const { out, NX, NY } = app.upsample(vals, nx, ny, U);
  for (let J = 0; J < NY; J++) for (let I = 0; I < NX; I++) {
    close(out[J * NX + I], (I / U) * 3 + (J / U), 1e-4, `at ${I},${J}`);
  }
});

/* ------------------------------------------------------------------ */
/* Parcel thermodynamics (Bolton 1980)                                 */
/* ------------------------------------------------------------------ */

test('liftParcel: a saturated parcel has its LCL at the surface', () => {
  close(app.liftParcel(1000, 30, 30).pl, 1000, 0.01);
});

test('liftParcel: a dew point above the temperature is clamped, not extrapolated', () => {
  // Supersaturated input would otherwise drive the LCL above the starting pressure.
  close(app.liftParcel(1000, 30, 35).pl, 1000, 0.01);
});

test('liftParcel: the LCL matches the 125 m per degree rule of thumb', () => {
  // 10 C of dew point depression puts cloud base near 1250 m, about 865 mb.
  close(app.liftParcel(1000, 30, 20).pl, 865, 5);
});

test('liftParcel: a drier parcel lifts to a higher cloud base', () => {
  let prev = Infinity;
  for (const td of [29, 25, 20, 15, 10, 5]) {
    const pl = app.liftParcel(1000, 30, td).pl;
    assert.ok(pl < prev, `LCL should rise as the parcel dries (td=${td})`);
    prev = pl;
  }
});

test('liftParcel: the sub-LCL path follows a dry adiabat', () => {
  const p0 = 1000, t0 = 30, { pl, pts } = app.liftParcel(p0, t0, 20);
  const T0 = t0 + 273.15;
  for (const [p, t] of pts) {
    if (p < pl) break;
    close(t + 273.15, T0 * Math.pow(p / p0, 0.2857), 0.02, `dry adiabat at ${p} mb`);
  }
});

test('liftParcel: the parcel path rises monotonically and reaches the top', () => {
  const { pts } = app.liftParcel(1000, 30, 20);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] < pts[i - 1][0], 'pressure must decrease');
  assert.ok(pts[pts.length - 1][0] <= 105, 'parcel should be integrated to about 100 mb');
});

test('moistDTdp: saturated ascent cools more slowly than dry ascent', () => {
  // The latent heat release is the whole point; moist lapse must be the smaller one.
  const p = 900, T = 295;
  const dry = 287.04 * T / (1005.7 * p);
  assert.ok(app.moistDTdp(p, T) < dry, 'moist lapse rate should be below the dry rate');
  assert.ok(app.moistDTdp(p, T) > 0, 'a parcel must cool as it rises');
});

test('moistDTdp: the cold, dry top of the sounding approaches the dry rate', () => {
  // Almost no vapour left at 200 mb and 220 K, so the two rates converge to within
  // a few percent -- the residual gap is the vapour term, which is small but not zero.
  const p = 200, T = 220;
  const dry = 287.04 * T / (1005.7 * p);
  close(app.moistDTdp(p, T), dry, dry * 0.04, 'high-altitude moist lapse');
  assert.ok(app.moistDTdp(p, T) < dry, 'still below the dry rate');
});

test('moistPath: a warm saturated parcel cools about 24 C from 1000 to 500 mb', () => {
  const pts = app.moistPath(1000, 300, 500, 5);
  const [pEnd, tEnd] = pts[pts.length - 1];
  assert.equal(pEnd, 500);
  close(tEnd, 300 - 273.15 - 24, 1.5, 'moist adiabat top temperature');
});

test('moistPath: halving the step changes the answer only slightly', () => {
  // The Skew-T background draws adiabats at step 10 and the parcel at step 5.
  // If those disagreed visibly the parcel would not line up with the background.
  const coarse = app.moistPath(1000, 300, 400, 10);
  const fine = app.moistPath(1000, 300, 400, 5);
  close(coarse[coarse.length - 1][1], fine[fine.length - 1][1], 0.1, 'RK2 step sensitivity');
});

test('moistPath: stops at or above the requested top, never below it', () => {
  for (const step of [5, 10, 7]) {
    const pts = app.moistPath(1000, 300, 200, step);
    assert.ok(pts[pts.length - 1][0] >= 200, `overshot the top with step ${step}`);
  }
});

/* ------------------------------------------------------------------ */
/* Chart ticks                                                         */
/* ------------------------------------------------------------------ */

test('niceTicks: spans the range with round numbers', () => {
  assert.deepEqual(app.niceTicks(0, 10), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(app.niceTicks(3, 7), [3, 4, 5, 6, 7]);
  assert.deepEqual(app.niceTicks(0, 0.3), [0, 0.1, 0.2, 0.3]);
});

test('niceTicks: always brackets the data', () => {
  for (const [lo, hi] of [[-12, 37], [0.02, 0.09], [-1, 1], [990, 1042], [0, 1e4]]) {
    const t = app.niceTicks(lo, hi);
    assert.ok(t[0] <= lo, `first tick ${t[0]} is above lo ${lo}`);
    assert.ok(t[t.length - 1] >= hi, `last tick ${t[t.length - 1]} is below hi ${hi}`);
  }
});

test('niceTicks: a flat series still produces a usable axis', () => {
  // Every model agreeing exactly (0 in. of snow, say) must not collapse the axis.
  const t = app.niceTicks(5, 5);
  assert.ok(t.length > 1, 'a flat range needs more than one tick');
  assert.ok(t.includes(5));
});

test('niceTicks: ticks are free of floating-point noise', () => {
  for (const [lo, hi] of [[0, 1], [0, 0.7], [0, 3], [-0.3, 0.3]]) {
    for (const v of app.niceTicks(lo, hi)) {
      assert.equal(v, +v.toFixed(6), `tick ${v} carries float noise`);
    }
  }
});

test('niceTicks: step comes from the 1 / 2 / 2.5 / 5 / 10 family', () => {
  for (const [lo, hi] of [[0, 1], [0, 4], [0, 9], [0, 23], [0, 60], [0, 400]]) {
    const t = app.niceTicks(lo, hi);
    const step = t[1] - t[0];
    const mag = 10 ** Math.floor(Math.log10(step));
    const mant = +(step / mag).toFixed(6);
    assert.ok([1, 2, 2.5, 5, 10].includes(mant), `step ${step} is not a nice number`);
  }
});

/* ------------------------------------------------------------------ */
/* Wind barbs                                                          */
/* ------------------------------------------------------------------ */

const barbs = svg => ({
  flags: (svg.match(/<polygon/g) || []).length,
  lines: (svg.match(/<line/g) || []).length - 1, // minus the staff
  circle: svg.includes('<circle')
});

test('barbMarkup: calm wind draws a circle, not a staff', () => {
  const s = app.barbMarkup(1, 180);
  assert.ok(barbs(s).circle);
  assert.ok(!s.includes('<polygon'));
});

test('barbMarkup: missing wind draws nothing', () => {
  for (const [kt, dir] of [[null, 180], [NaN, 180], [10, null], [10, NaN]]) {
    assert.equal(app.barbMarkup(kt, dir), '');
  }
});

test('barbMarkup: standard speeds get the right feathers', () => {
  assert.deepEqual(barbs(app.barbMarkup(5, 0)), { flags: 0, lines: 1, circle: false });
  assert.deepEqual(barbs(app.barbMarkup(10, 0)), { flags: 0, lines: 1, circle: false });
  assert.deepEqual(barbs(app.barbMarkup(15, 0)), { flags: 0, lines: 2, circle: false });
  assert.deepEqual(barbs(app.barbMarkup(25, 0)), { flags: 0, lines: 3, circle: false });
  assert.deepEqual(barbs(app.barbMarkup(50, 0)), { flags: 1, lines: 0, circle: false });
  assert.deepEqual(barbs(app.barbMarkup(65, 0)), { flags: 1, lines: 2, circle: false });
  assert.deepEqual(barbs(app.barbMarkup(100, 0)), { flags: 2, lines: 0, circle: false });
});

test('barbMarkup: speeds round to the nearest 5 knots', () => {
  assert.equal(app.barbMarkup(12, 0), app.barbMarkup(10, 0));
  assert.equal(app.barbMarkup(13, 0), app.barbMarkup(15, 0));
});

test('barbMarkup: the barb is rotated to the wind direction', () => {
  assert.ok(app.barbMarkup(20, 270).includes('rotate(270)'));
  assert.ok(app.barbMarkup(20, 45.4).includes('rotate(45)'), 'direction is rounded for compact markup');
});

test('barbMarkup: markup is well formed and closes every tag', () => {
  for (const kt of [0, 3, 5, 10, 35, 50, 95, 150]) {
    const s = app.barbMarkup(kt, 180);
    if (!s) continue;
    const open = (s.match(/<g[ >]/g) || []).length, closeG = (s.match(/<\/g>/g) || []).length;
    assert.equal(open, closeG, `unbalanced <g> at ${kt} kt`);
    assert.ok(!s.includes('NaN'), `NaN leaked into the markup at ${kt} kt`);
  }
});

/* ------------------------------------------------------------------ */
/* Color scales                                                        */
/* ------------------------------------------------------------------ */

test('hex: parses a color into bytes', () => {
  assert.deepEqual(app.hex('#4C8DFF'), [0x4c, 0x8d, 0xff]);
  assert.deepEqual(app.hex('000000'), [0, 0, 0]);
});

test('colorAt: interpolates linearly between two stops', () => {
  const sc = app.mkScale([[0, '#000000'], [10, '#ffffff']]);
  const out = new Float64Array(4);
  assert.ok(app.colorAt(sc, 5, out));
  close(out[0], 127.5, 0.01);
  close(out[3], 1, 1e-9);
});

test('colorAt: clamps outside the scale', () => {
  const sc = app.mkScale([[0, '#102030'], [10, '#a0b0c0']]);
  const out = new Float64Array(4);
  app.colorAt(sc, -100, out);
  assert.deepEqual([...out.slice(0, 3)], [0x10, 0x20, 0x30]);
  app.colorAt(sc, 1e6, out);
  assert.deepEqual([...out.slice(0, 3)], [0xa0, 0xb0, 0xc0]);
});

test('colorAt: NaN paints nothing', () => {
  const sc = app.mkScale([[0, '#000000'], [10, '#ffffff']]);
  assert.equal(app.colorAt(sc, NaN, new Float64Array(4)), false);
});

test('colorAt: clearBelow feathers the bottom edge instead of cutting it', () => {
  // Light precipitation should fade out rather than end in a hard stair-step.
  const sc = app.mkScale([[10, '#ffffff']], { clearBelow: true });
  const out = new Float64Array(4);
  assert.equal(app.colorAt(sc, 3.9, out), false, 'well below the threshold paints nothing');
  assert.ok(app.colorAt(sc, 7, out), 'just below the threshold still paints');
  close(out[3], 0.5, 1e-9, 'alpha should be halfway through the feather');
  app.colorAt(sc, 10, out);
  close(out[3], 1, 1e-9, 'at the threshold the color is solid');
});

test('colorAt: alpha from the stops is carried through', () => {
  const sc = app.mkScale([[0, '#ffffff', 0], [10, '#ffffff', 1]]);
  const out = new Float64Array(4);
  app.colorAt(sc, 5, out);
  close(out[3], 0.5, 1e-9);
});

test('SCALES: every scale is sorted and its labels lie inside it', async () => {
  const s = await load(['hex', 'mkScale', 'SCALES'], { expose: [] });
  for (const [name, sc] of Object.entries(s.SCALES)) {
    const vs = sc.stops.map(st => st[0]);
    assert.deepEqual(vs, [...vs].sort((a, b) => a - b), `${name} stops are out of order`);
    assert.equal(new Set(vs).size, vs.length, `${name} has a duplicate stop`);
    for (const st of sc.stops) {
      assert.equal(st[1].length, 4, `${name} stop ${st[0]} is not RGBA`);
      for (const ch of st[1].slice(0, 3)) assert.ok(Number.isFinite(ch) && ch >= 0 && ch <= 255, `${name} has a bad channel`);
    }
    for (const lab of sc.labels || []) {
      assert.ok(lab >= vs[0] && lab <= vs[vs.length - 1], `${name} label ${lab} falls outside the scale`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Distance                                                            */
/* ------------------------------------------------------------------ */

test('miles: known city pairs come out right', () => {
  close(app.miles(40.7128, -74.006, 34.0522, -118.2437), 2451, 15, 'NYC to LA');
  close(app.miles(41.88, -87.63, 39.74, -104.99), 920, 10, 'Chicago to Denver');
  assert.equal(app.miles(35, -97, 35, -97), 0);
});

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */
// The app fetches and colours in US units and converts on the way to the screen, so a
// broken converter shows a wrong number over a correct map -- invisible without tests.

const units = await load(['QUANTITY', 'UNIT_SYSTEMS', 'KT2MPH', 'FIELDS', 'FIELD', 'quantity', 'unitLabel', 'toDisplay', 'fmtQty'], {
  prelude: "const state = { units: 'us' };\nconst setUnits = u => { state.units = u; };",
  expose: ['setUnits', 'state']
});
const asUS = fn => { units.setUnits('us'); try { return fn(); } finally { units.setUnits('us'); } };
const asMetric = fn => { units.setUnits('metric'); try { return fn(); } finally { units.setUnits('us'); } };

test('QUANTITY: every kind covers every unit system', () => {
  for (const [kind, systems] of Object.entries(units.QUANTITY)) {
    for (const sys of units.UNIT_SYSTEMS) {
      const entry = systems[sys];
      assert.ok(Array.isArray(entry) && entry.length === 3, `${kind}.${sys} is malformed`);
      const [label, to, dp] = entry;
      assert.ok(typeof label === 'string' && label.length, `${kind}.${sys} has no label`);
      assert.equal(typeof to, 'function', `${kind}.${sys} has no converter`);
      assert.ok(Number.isInteger(dp) && dp >= 0, `${kind}.${sys} has bad precision`);
    }
  }
});

test('QUANTITY: US units are the identity, because they are what is stored', () => {
  for (const [kind, systems] of Object.entries(units.QUANTITY)) {
    for (const v of [-40, 0, 1, 33.3, 250]) {
      assert.equal(systems.us[1](v), v, `${kind} should not convert in US units`);
    }
  }
});

test('QUANTITY: the metric conversions are the real ones', () => {
  const t = units.QUANTITY.temp.metric[1];
  close(t(32), 0, 1e-9, 'freezing');
  close(t(212), 100, 1e-9, 'boiling');
  close(t(-40), -40, 1e-9, 'where the scales cross');
  close(units.QUANTITY.speed.metric[1](1), 1.609344, 1e-9, 'mph to km/h');
  close(units.QUANTITY.depth.metric[1](1), 25.4, 1e-9, 'inch to mm');
  close(units.QUANTITY.rate.metric[1](1), 25.4, 1e-9, 'in/hr to mm/hr');
  close(units.QUANTITY.snow.metric[1](1), 2.54, 1e-9, 'inch to cm');
  // Pressure and energy are the same number in both; only the label moves.
  close(units.QUANTITY.press.metric[1](1013), 1013, 1e-9);
  close(units.QUANTITY.energy.metric[1](2500), 2500, 1e-9);
  assert.equal(units.QUANTITY.press.metric[0], 'hPa');
  assert.equal(units.QUANTITY.press.us[0], 'mb');
});

test('KT2MPH: knots convert to mph correctly', () => {
  close(units.KT2MPH, 1.150779, 1e-6);
  close(50 * units.KT2MPH, 57.539, 0.01, '50 knots in mph');
});

test('FIELDS: every field names a kind and a scale that exist', () => {
  // A typo here would render a legend with "undefined" on it, or throw on the hover.
  for (const f of units.FIELDS) {
    if (!f.v) continue; // the radar tile layer has no sampled value
    assert.ok(f.kind, `${f.key} has no kind`);
    assert.ok(units.QUANTITY[f.kind], `${f.key} has kind "${f.kind}", which is not a quantity`);
    assert.ok(f.scale, `${f.key} has no colour scale`);
  }
});

test('FIELDS: the lookup table matches the list', () => {
  assert.deepEqual(Object.keys(units.FIELD).sort(), units.FIELDS.map(f => f.key).sort());
});

test('fmtQty: degrees and percentages close up, the rest take a space', () => {
  asUS(() => {
    assert.equal(units.fmtQty('temp', 72.4), '72°F');
    assert.equal(units.fmtQty('ratio', 55), '55%');
    assert.equal(units.fmtQty('speed', 12.6), '13 mph');
    assert.equal(units.fmtQty('press', 1013.2), '1013 mb');
    assert.equal(units.fmtQty('depth', 0.257), '0.26 in');
  });
});

test('fmtQty: reads the current unit system', () => {
  asUS(() => assert.equal(units.fmtQty('temp', 32), '32°F'));
  asMetric(() => {
    assert.equal(units.fmtQty('temp', 32), '0°C');
    assert.equal(units.fmtQty('speed', 10), '16 km/h');
    assert.equal(units.fmtQty('snow', 4), '10.2 cm');
    assert.equal(units.fmtQty('press', 1013.2), '1013 hPa');
  });
});

test('fmtQty: a missing value is a dash, never NaN on screen', () => {
  for (const v of [NaN, null, undefined]) {
    assert.equal(units.fmtQty('temp', v), '–', `${v} should render as a dash`);
  }
  assert.equal(units.fmtQty(null, 5), '–', 'a field with no kind has nothing to show');
});

test('fmtQty: can drop the unit for a column that carries it in the header', () => {
  asUS(() => assert.equal(units.fmtQty('speed', 40), '40 mph'));
  asUS(() => assert.equal(units.fmtQty('speed', 40, false), '40'));
  asMetric(() => assert.equal(units.fmtQty('temp', 50, false), '10'));
});

test('unitLabel and toDisplay: agree with the table and with each other', () => {
  asMetric(() => {
    assert.equal(units.unitLabel('temp'), '°C');
    close(units.toDisplay('temp', 212), 100, 1e-9);
    assert.equal(units.unitLabel(null), '', 'a field with no kind has no unit');
  });
});

test('toDisplay: converting a span is not the same as converting a value', () => {
  // The chart floors its axis with a minimum span. Temperature has an offset, so the
  // span has to be converted as a difference or a 10 degree floor becomes 250.
  asMetric(() => {
    const zero = units.toDisplay('temp', 0);
    const span = Math.abs(units.toDisplay('temp', 10) - zero);
    close(span, 10 * 5 / 9, 1e-9, '10 F of span is 5.6 C');
    assert.ok(span < 10, 'a converted span must not inflate the axis');
  });
});

/* ------------------------------------------------------------------ */
/* Comparison charts                                                   */
/* ------------------------------------------------------------------ */
// chartSVG is where the unit conversion meets the axis. A span floor converted as if
// it were a value turns a 10-degree minimum into a 250-degree one, which looks like a
// flat line on an absurd axis -- a rendering bug no unit test of the converters sees.

const charts = await load(['niceTicks', 'esc', 'QUANTITY', 'quantity', 'toDisplay', 'chartSVG'], {
  prelude: "const state = { units: 'us', hidden: new Set(), compare: null };\n"
    + "const setUnits = u => { state.units = u; };\n"
    + "const setCompare = c => { state.compare = c; };",
  expose: ['setUnits', 'setCompare', 'state']
});

/** One model, one series, so the axis is entirely predictable. */
function fakeCompare(values) {
  const s = { temp: Float32Array.from(values) };
  return { t0: Math.floor(Date.UTC(2026, 0, 1) / 1000), N: values.length,
    rows: [{ m: { key: 'x', name: 'Model', color: '#4C8DFF' }, s }] };
}
const yTicks = svg => [...svg.matchAll(/class="yl"[^>]*>([^<]+)</g)].map(m => Number(m[1]));

test('chartSVG: draws a labelled axis and one path per model', () => {
  charts.setCompare(fakeCompare([40, 45, 50, 55, 60]));
  const svg = charts.chartSVG({ title: 'Temperature', key: 'temp', fmt: v => Math.round(v), minSpan: 10 });
  assert.match(svg, /<figure class="chart"/);
  assert.equal((svg.match(/<path /g) || []).length, 1);
  assert.ok(!svg.includes('NaN'), 'NaN reached the chart');
  const ticks = yTicks(svg);
  assert.ok(ticks.length >= 2, 'the axis needs ticks');
  assert.ok(Math.min(...ticks) <= 40 && Math.max(...ticks) >= 60, 'the axis must contain the data');
});

test('chartSVG: the minimum span is honoured on a flat series', () => {
  charts.setCompare(fakeCompare([50, 50, 50, 50]));
  const svg = charts.chartSVG({ title: 'Temperature', key: 'temp', fmt: v => Math.round(v), minSpan: 10 });
  const ticks = yTicks(svg);
  close(Math.max(...ticks) - Math.min(...ticks), 10, 2.5, 'a flat series should still span the floor');
});

test('chartSVG: a converted span does not inflate the axis', () => {
  // The whole point: 10 degrees Fahrenheit of floor is 5.6 Celsius, not 10.
  charts.setCompare(fakeCompare([50, 50, 50, 50]));
  const opts = { title: 'Temperature', key: 'temp', fmt: v => Math.round(v), minSpan: 10 };
  const us = yTicks(charts.chartSVG({ ...opts, conv: v => charts.toDisplay('temp', v) }));
  charts.setUnits('metric');
  const metric = yTicks(charts.chartSVG({ ...opts, conv: v => charts.toDisplay('temp', v) }));
  charts.setUnits('us');
  const spanUS = Math.max(...us) - Math.min(...us);
  const spanM = Math.max(...metric) - Math.min(...metric);
  assert.ok(spanM < spanUS, `metric span ${spanM} should be smaller than ${spanUS}`);
  assert.ok(spanM <= 8, `a 10 F floor must not become a ${spanM} C axis`);
  // And the axis must still sit around the converted value, 10 C.
  assert.ok(Math.min(...metric) <= 10 && Math.max(...metric) >= 10, 'the axis lost its data');
});

test('chartSVG: values are converted, not just the labels', () => {
  charts.setCompare(fakeCompare([32, 122, 212]));
  charts.setUnits('metric');
  const svg = charts.chartSVG({ title: 'T', key: 'temp', fmt: v => Math.round(v), conv: v => charts.toDisplay('temp', v) });
  charts.setUnits('us');
  const ticks = yTicks(svg);
  assert.ok(Math.min(...ticks) <= 0, 'freezing should be on the axis as 0');
  assert.ok(Math.max(...ticks) >= 100, 'boiling should be on the axis as 100');
});

test('chartSVG: a hidden model is left out, and an empty chart is empty', () => {
  charts.setCompare(fakeCompare([40, 50, 60]));
  charts.state.hidden.add('x');
  assert.equal(charts.chartSVG({ title: 'T', key: 'temp', fmt: v => v }), '', 'no visible series, no chart');
  charts.state.hidden.delete('x');
  charts.setCompare(fakeCompare([NaN, NaN]));
  assert.equal(charts.chartSVG({ title: 'T', key: 'temp', fmt: v => v }), '', 'all-NaN series, no chart');
});
