// Tests for the derived-quantity engine: sun and moon, the hodograph and its
// severe-weather parameters, the precipitation nowcast, air quality and saved places.
//
// None of this can be checked by looking at the map. A sunrise that is twenty minutes
// out, or a helicity with the wrong sign, renders perfectly and is simply wrong, so the
// numbers are pinned against published values and against physics that cannot drift.

import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const app = await load([
  'D2R', 'toJulian', 'fromJulian', 'SUN_ALT', 'sunPosition', 'sunTimes',
  'MOON_NAMES', 'SYNODIC', 'moonPhase', 'moonName', 'moonSVG',
  'KT2MS', 'uvFromWind', 'windFromUV', 'windProfile', 'windAt', 'bulkShear',
  'meanWind', 'bunkersMotion', 'stormRelativeHelicity', 'severeParams',
  'HODO_BANDS', 'hodographSVG',
  'WET', 'nowcast', 'AQI_BANDS', 'aqiBand', 'AQ_POLLUTANTS', 'dominantPollutant',
  'MAX_SAVED', 'placeKey', 'addPlace', 'removePlace', 'hasPlace'
], { expose: ['R2D', 'J2000'] });

const close = (a, b, eps, msg) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg || ''}: ${a} is not within ${eps} of ${b}`);
const MIN = 60000;
const utc = s => new Date(s);

/* ------------------------------------------------------------------ */
/* Sun                                                                 */
/* ------------------------------------------------------------------ */

test('sunTimes: matches published sunrise and sunset', () => {
  // Checked against the US Naval Observatory / timeanddate values for these dates.
  const nyc = app.sunTimes(utc('2026-06-21T12:00:00Z'), 40.7128, -74.0060);
  close(+nyc.sunrise, +utc('2026-06-21T09:25:00Z'), 2 * MIN, 'NYC solstice sunrise');
  close(+nyc.sunset, +utc('2026-06-22T00:31:00Z'), 2 * MIN, 'NYC solstice sunset');

  const london = app.sunTimes(utc('2026-06-21T12:00:00Z'), 51.5074, -0.1278);
  close(+london.sunrise, +utc('2026-06-21T03:43:00Z'), 2 * MIN, 'London solstice sunrise');
  close(+london.sunset, +utc('2026-06-21T20:21:00Z'), 2 * MIN, 'London solstice sunset');
});

test('sunTimes: day length swings the right way through the year', () => {
  const h = d => d / 3600000;
  const summer = app.sunTimes(utc('2026-06-21T12:00:00Z'), 40.7128, -74.0060);
  const winter = app.sunTimes(utc('2026-12-21T12:00:00Z'), 40.7128, -74.0060);
  close(h(summer.dayLength), 15.05, 0.15, 'NYC longest day');
  close(h(winter.dayLength), 9.25, 0.15, 'NYC shortest day');
  // The southern hemisphere must be the other way round.
  const sydSummer = app.sunTimes(utc('2026-12-21T12:00:00Z'), -33.8688, 151.2093);
  const sydWinter = app.sunTimes(utc('2026-06-21T12:00:00Z'), -33.8688, 151.2093);
  assert.ok(sydSummer.dayLength > sydWinter.dayLength, 'Sydney should have a long December day');
});

test('sunTimes: the equator gets an even day at the equinox', () => {
  const eq = app.sunTimes(utc('2026-03-20T12:00:00Z'), 0, 0);
  // Slightly over twelve hours: sunrise is defined at -0.833 degrees, which buys a few
  // minutes at each end for refraction and the sun's own radius.
  close(eq.dayLength / 3600000, 12.1, 0.1, 'equinox day length');
  close(Math.abs(eq.declination), 0, 0.5, 'declination should be near zero at the equinox');
});

test('sunTimes: solar noon tracks longitude at four minutes per degree', () => {
  const a = app.sunTimes(utc('2026-04-15T12:00:00Z'), 40, 0);
  const b = app.sunTimes(utc('2026-04-15T12:00:00Z'), 40, -15);
  close(+b.solarNoon - +a.solarNoon, 60 * MIN, 2 * MIN, '15 degrees should be one hour');
});

test('sunTimes: polar day and night are reported, not invented', () => {
  const june = app.sunTimes(utc('2026-06-21T12:00:00Z'), 78.2, 15.6);
  assert.equal(june.polar, 'day');
  assert.equal(june.sunrise, null, 'there is no sunrise during the midnight sun');
  assert.equal(june.sunset, null);
  assert.equal(june.dayLength, 86400000);

  const december = app.sunTimes(utc('2026-12-21T12:00:00Z'), 78.2, 15.6);
  assert.equal(december.polar, 'night');
  assert.equal(december.sunrise, null);
  assert.equal(december.dayLength, 0);
});

test('sunTimes: the events of the day come in the right order', () => {
  const s = app.sunTimes(utc('2026-09-15T12:00:00Z'), 39.7392, -104.9903);
  const order = ['nightEnd', 'nauticalDawn', 'dawn', 'sunrise', 'goldenEnd', 'solarNoon',
    'goldenStart', 'sunset', 'dusk', 'nauticalDusk', 'nightStart'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(s[order[i]] && s[order[i - 1]], `${order[i]} is missing`);
    assert.ok(+s[order[i]] >= +s[order[i - 1]], `${order[i - 1]} should come before ${order[i]}`);
  }
  assert.equal(+s.sunset - +s.sunrise, s.dayLength, 'dayLength must match its own endpoints');
});

test('sunTimes: golden hour sits just inside sunrise and sunset', () => {
  const s = app.sunTimes(utc('2026-05-10T12:00:00Z'), 35.4676, -97.5164);
  assert.ok(+s.goldenEnd > +s.sunrise && +s.goldenEnd < +s.solarNoon);
  assert.ok(+s.goldenStart < +s.sunset && +s.goldenStart > +s.solarNoon);
});

/* ------------------------------------------------------------------ */
/* Moon                                                                */
/* ------------------------------------------------------------------ */

test('moonPhase: stays inside its range and agrees with its own illumination', () => {
  for (let d = 0; d < 60; d++) {
    const m = app.moonPhase(new Date(Date.UTC(2026, 0, 1) + d * 86400000));
    assert.ok(m.phase >= 0 && m.phase < 1, `phase ${m.phase} out of range`);
    assert.ok(m.illum >= 0 && m.illum <= 1, `illum ${m.illum} out of range`);
    close(m.illum, (1 - Math.cos(m.phase * 2 * Math.PI)) / 2, 1e-12, 'illum vs phase');
    assert.ok(m.age >= 0 && m.age < app.SYNODIC, 'age should be within one cycle');
    assert.ok(app.MOON_NAMES.includes(m.name), `unexpected name ${m.name}`);
  }
});

test('moonPhase: completes a cycle in one synodic month', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const a = app.moonPhase(new Date(t0)).phase;
  const b = app.moonPhase(new Date(t0 + app.SYNODIC * 86400000)).phase;
  close(b, a, 0.01, 'phase after one synodic month');
});

test('moonPhase: advances steadily and wraps exactly once per cycle', () => {
  let wraps = 0, prev = app.moonPhase(new Date(Date.UTC(2026, 0, 1))).phase;
  for (let h = 6; h <= 24 * 30; h += 6) {
    const p = app.moonPhase(new Date(Date.UTC(2026, 0, 1) + h * 3600000)).phase;
    if (p < prev) wraps++;
    else assert.ok(p > prev, 'phase should advance');
    prev = p;
  }
  assert.equal(wraps, 1, 'a 30-day span should wrap through new moon exactly once');
});

test('moonName: the principal phases get a narrow window, not an eighth each', () => {
  // A two-thirds lit moon must not be called "last quarter".
  assert.equal(app.moonName(0), 'New moon');
  assert.equal(app.moonName(0.25), 'First quarter');
  assert.equal(app.moonName(0.5), 'Full moon');
  assert.equal(app.moonName(0.75), 'Last quarter');
  assert.equal(app.moonName(0.125), 'Waxing crescent');
  assert.equal(app.moonName(0.375), 'Waxing gibbous');
  assert.equal(app.moonName(0.625), 'Waning gibbous');
  assert.equal(app.moonName(0.696), 'Waning gibbous', '67% lit is gibbous, not a quarter');
  assert.equal(app.moonName(0.875), 'Waning crescent');
  assert.equal(app.moonName(0.94), 'Waning crescent', '4% lit and waning is still a crescent');
});

test('moonName: wraps cleanly around the ends of the cycle', () => {
  assert.equal(app.moonName(0.999), 'New moon');
  assert.equal(app.moonName(1), 'New moon');
  assert.equal(app.moonName(1.25), 'First quarter');
  assert.equal(app.moonName(-0.005), 'New moon');
});

test('moonSVG: draws a disc at every phase without a NaN', () => {
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const svg = app.moonSVG(p);
    assert.match(svg, /^<svg /);
    assert.ok(!svg.includes('NaN'), `NaN in the moon path at phase ${p}`);
    assert.ok(svg.includes('<path'), 'the terminator path is missing');
  }
});

/* ------------------------------------------------------------------ */
/* Wind components                                                     */
/* ------------------------------------------------------------------ */

test('uvFromWind: a meteorological direction is where the wind comes FROM', () => {
  // A south wind blows toward the north: positive v.
  const [su, sv] = app.uvFromWind(10, 180);
  close(su, 0, 1e-9, 'south wind u'); close(sv, 10, 1e-9, 'south wind v');
  // A west wind blows toward the east: positive u.
  const [wu, wv] = app.uvFromWind(10, 270);
  close(wu, 10, 1e-9, 'west wind u'); close(wv, 0, 1e-9, 'west wind v');
  const [nu, nv] = app.uvFromWind(10, 0);
  close(nu, 0, 1e-9, 'north wind u'); close(nv, -10, 1e-9, 'north wind v');
});

test('windFromUV: inverts uvFromWind', () => {
  for (const dir of [0, 45, 90, 180, 240, 315, 359]) {
    const [u, v] = app.uvFromWind(23, dir);
    const back = app.windFromUV(u, v);
    close(back.speed, 23, 1e-9, `speed at ${dir}`);
    close((back.dir + 360) % 360, dir, 1e-9, `direction at ${dir}`);
  }
});

/* ------------------------------------------------------------------ */
/* Wind profile and shear                                              */
/* ------------------------------------------------------------------ */

/** A synthetic sounding: direction and speed as functions of the level index. */
const mkProf = (dirFn, spdFn, n = 12) => {
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ p: 1000 - i * 40, z: 200 + i * 500, ws: spdFn(i), wd: dirFn(i) });
  return out;
};
const veering = mkProf(i => 180 + i * 7.5, i => 10 + i * 3);
const backing = mkProf(i => 180 - i * 7.5, i => 10 + i * 3);
const straight = mkProf(() => 180, i => 10 + i * 3);

test('windProfile: heights come back above ground and in order', () => {
  const lv = app.windProfile(veering);
  assert.equal(lv.length, veering.length);
  assert.equal(lv[0].agl, 0, 'the lowest level is the ground');
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i].agl > lv[i - 1].agl, 'heights must increase');
  close(lv[lv.length - 1].agl, 6000, 1e-9, 'top of the profile');
});

test('windProfile: levels missing a height or a wind are dropped', () => {
  const holes = [
    { p: 1000, z: 200, ws: 10, wd: 180 },
    { p: 925, z: NaN, ws: 20, wd: 200 },
    { p: 850, z: 1500, ws: NaN, wd: 220 },
    { p: 700, z: 3000, ws: 30, wd: undefined },
    { p: 500, z: 5500, ws: 40, wd: 260 }
  ];
  assert.equal(app.windProfile(holes).length, 2);
  assert.deepEqual(app.windProfile([]), []);
});

test('windProfile: an unsorted profile is sorted by height', () => {
  const shuffled = [veering[5], veering[0], veering[9], veering[2]];
  const lv = app.windProfile(shuffled);
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i].agl > lv[i - 1].agl);
});

test('windAt: interpolates, holds at the ground, and refuses to extrapolate', () => {
  const lv = app.windProfile(straight);
  const a = app.windAt(lv, 0), b = app.windAt(lv, 500), mid = app.windAt(lv, 250);
  close(mid.u, (a.u + b.u) / 2, 1e-9, 'u at the midpoint');
  close(mid.v, (a.v + b.v) / 2, 1e-9, 'v at the midpoint');
  assert.deepEqual(app.windAt(lv, -100), { u: a.u, v: a.v }, 'below ground holds the surface wind');
  assert.equal(app.windAt(lv, 99999), null, 'above the profile must not extrapolate');
  assert.equal(app.windAt([], 100), null);
});

test('bulkShear: matches the vector difference across the layer', () => {
  const lv = app.windProfile(veering);
  const a = app.windAt(lv, 0), b = app.windAt(lv, 6000);
  close(app.bulkShear(lv, 0, 6000), Math.hypot(b.u - a.u, b.v - a.v), 1e-9, '0-6 km shear');
  close(app.bulkShear(lv, 0, 0), 0, 1e-9, 'a zero-depth layer has no shear');
  assert.ok(Number.isNaN(app.bulkShear(lv, 0, 99999)), 'shear above the profile is unknown');
});

test('bulkShear: a unidirectional profile still shears with speed alone', () => {
  const lv = app.windProfile(straight);
  // 10 kt at the ground to 46 kt at 6 km, all from the south.
  close(app.bulkShear(lv, 0, 6000), 36 * app.KT2MS, 0.01, 'speed shear');
});

test('meanWind: a constant wind averages to itself', () => {
  const lv = app.windProfile(mkProf(() => 210, () => 25));
  const m = app.meanWind(lv, 0, 6000);
  const [u, v] = app.uvFromWind(25 * app.KT2MS, 210);
  close(m.u, u, 1e-9); close(m.v, v, 1e-9);
  assert.equal(app.meanWind(lv, 0, 99999), null, 'a layer past the top has no mean');
});

/* ------------------------------------------------------------------ */
/* Storm motion and helicity                                           */
/* ------------------------------------------------------------------ */

test('bunkersMotion: deviates 7.5 m/s from the mean wind, either side', () => {
  for (const prof of [veering, backing, straight]) {
    const lv = app.windProfile(prof);
    const m = app.bunkersMotion(lv);
    const dR = Math.hypot(m.right.u - m.mean.u, m.right.v - m.mean.v);
    const dL = Math.hypot(m.left.u - m.mean.u, m.left.v - m.mean.v);
    close(dR, 7.5, 1e-9, 'right-mover deviation');
    close(dL, 7.5, 1e-9, 'left-mover deviation');
    // The two movers straddle the mean.
    close((m.right.u + m.left.u) / 2, m.mean.u, 1e-9, 'movers straddle the mean in u');
    close((m.right.v + m.left.v) / 2, m.mean.v, 1e-9, 'movers straddle the mean in v');
  }
});

test('bunkersMotion: the right mover sits to the right of the shear vector', () => {
  const lv = app.windProfile(straight);
  const m = app.bunkersMotion(lv);
  const low = app.meanWind(lv, 0, 500), high = app.meanWind(lv, 5500, 6000);
  const su = high.u - low.u, sv = high.v - low.v;
  const du = m.right.u - m.mean.u, dv = m.right.v - m.mean.v;
  // Perpendicular to the shear, and clockwise from it (cross product negative).
  close(su * du + sv * dv, 0, 1e-9, 'deviation must be perpendicular to the shear');
  assert.ok(su * dv - sv * du < 0, 'the right mover must be clockwise of the shear vector');
});

test('bunkersMotion: gives up rather than guessing on a windless profile', () => {
  assert.equal(app.bunkersMotion(app.windProfile(mkProf(() => 180, () => 0))), null);
  assert.equal(app.bunkersMotion([]), null);
});

test('stormRelativeHelicity: veering is positive, backing is its mirror image', () => {
  // Measured against the mean wind, the two profiles are exact opposites. This is the
  // sign convention the whole panel rests on: veering winds mean a right-moving
  // supercell environment in the northern hemisphere.
  const lvV = app.windProfile(veering), lvB = app.windProfile(backing);
  const srhV = app.stormRelativeHelicity(lvV, 3000, app.meanWind(lvV, 0, 6000));
  const srhB = app.stormRelativeHelicity(lvB, 3000, app.meanWind(lvB, 0, 6000));
  assert.ok(srhV > 0, `veering SRH should be positive, got ${srhV}`);
  assert.ok(srhB < 0, `backing SRH should be negative, got ${srhB}`);
  close(srhV, -srhB, 1e-6, 'the mirrored profile should mirror the helicity');
});

test('stormRelativeHelicity: a straight hodograph has none, measured along itself', () => {
  const lv = app.windProfile(straight);
  close(app.stormRelativeHelicity(lv, 3000, app.meanWind(lv, 0, 6000)), 0, 1e-9,
    'no turning means no helicity when the storm rides the hodograph');
});

test('stormRelativeHelicity: a straight hodograph still has some against a deviant mover', () => {
  // Not a bug, and worth pinning: the Bunkers motion sits off the hodograph, so the
  // storm-relative winds curve even when the ground-relative ones do not. This is why
  // supercells form on straight hodographs at all.
  const sp = app.severeParams(straight);
  assert.ok(sp.srh3 > 20, `expected real storm-relative helicity, got ${sp.srh3}`);
});

test('stormRelativeHelicity: grows with depth through a veering layer', () => {
  const lv = app.windProfile(veering);
  const motion = app.meanWind(lv, 0, 6000);
  const one = app.stormRelativeHelicity(lv, 1000, motion);
  const three = app.stormRelativeHelicity(lv, 3000, motion);
  assert.ok(three > one, '0-3 km should exceed 0-1 km in a uniformly veering profile');
  assert.ok(Number.isNaN(app.stormRelativeHelicity(lv, 3000, null)), 'no motion, no answer');
});

test('severeParams: reports the full set, or nothing at all', () => {
  const sp = app.severeParams(veering);
  for (const k of ['shear1', 'shear3', 'shear6', 'srh1', 'srh3']) {
    assert.ok(Number.isFinite(sp[k]), `${k} should be a number`);
  }
  assert.ok(sp.shear6 > sp.shear1, 'deeper layers shear more here');
  close(sp.top, 6000, 1e-9);
  assert.equal(app.severeParams([]), null);
  assert.equal(app.severeParams([{ p: 1000, z: 200, ws: 10, wd: 180 }]), null, 'one level is not a profile');
});

test('severeParams: survives a profile that stops below 6 km', () => {
  // NBM and some short soundings do not reach the top; the panel must not throw.
  const shallow = mkProf(i => 180 + i * 10, i => 10 + i * 4, 3); // tops out near 1.5 km
  const sp = app.severeParams(shallow);
  assert.ok(sp, 'a shallow profile should still produce something');
  assert.ok(Number.isFinite(sp.shear1), '0-1 km shear is still available');
  assert.ok(Number.isNaN(sp.shear6), '0-6 km shear is not, and must say so');
  assert.equal(sp.motion, null, 'no storm motion without a 6 km layer');
  assert.ok(Number.isNaN(sp.srh3));
});

test('hodographSVG: draws without a NaN, and nothing at all without data', () => {
  for (const prof of [veering, backing, straight]) {
    const svg = app.hodographSVG(app.severeParams(prof));
    assert.match(svg, /^<svg /);
    assert.ok(!svg.includes('NaN'), 'NaN reached the hodograph');
    assert.ok(svg.includes('<polyline'), 'the trace is missing');
    assert.equal((svg.match(/<svg/g) || []).length, 1);
  }
  assert.equal(app.hodographSVG(null), '');
  // A shallow profile has no storm motion; the trace should still draw.
  const shallow = app.hodographSVG(app.severeParams(mkProf(i => 180 + i * 10, i => 10 + i * 4, 3)));
  assert.ok(!shallow.includes('NaN'), 'NaN in the shallow hodograph');
});

/* ------------------------------------------------------------------ */
/* Precipitation nowcast                                               */
/* ------------------------------------------------------------------ */

/** Quarter-hourly series aligned to now; `wet` decides which slots have rain. */
const series = (wet, n = 48) => {
  const t0 = Math.floor(Date.now() / 1000 / 900) * 900;
  const time = [], precip = [];
  for (let i = 0; i < n; i++) { time.push(t0 + i * 900); precip.push(wet(i) ? 0.5 : 0); }
  return { time, precip };
};

test('nowcast: says when rain starts', () => {
  const s = series(i => i >= 8);
  const out = app.nowcast(s.time, s.precip);
  assert.equal(out.raining, false);
  assert.match(out.text, /^Rain starting/);
  close(out.changesIn, 120, 16, 'eight quarter hours out');
});

test('nowcast: says when rain stops', () => {
  const s = series(i => i < 6);
  const out = app.nowcast(s.time, s.precip);
  assert.equal(out.raining, true);
  assert.match(out.text, /^Rain easing/);
});

test('nowcast: reports a dry stretch and a wet one', () => {
  const dry = series(() => false);
  assert.match(app.nowcast(dry.time, dry.precip).text, /No rain in the next \d+ h/);
  assert.equal(app.nowcast(dry.time, dry.precip).changesIn, null);

  const wet = series(() => true);
  assert.match(app.nowcast(wet.time, wet.precip).text, /Rain continuing/);
});

test('nowcast: imminent rain reads as minutes, not a rounded zero', () => {
  const s = series(i => i >= 1);
  assert.match(app.nowcast(s.time, s.precip).text, /within minutes|in about \d+ min/);
});

test('nowcast: drizzle below the threshold does not count as rain', () => {
  const s = series(() => false);
  s.precip = s.precip.map(() => app.WET / 2);
  assert.equal(app.nowcast(s.time, s.precip).raining, false, 'a trace should not read as rain');
  s.precip = s.precip.map(() => app.WET);
  assert.equal(app.nowcast(s.time, s.precip).raining, true, 'the threshold itself counts');
});

test('nowcast: looks no further ahead than its horizon', () => {
  const s = series(i => i >= 40); // ten hours out, past the six-hour horizon
  const out = app.nowcast(s.time, s.precip);
  assert.equal(out.changesIn, null, 'rain beyond the horizon is not a nowcast');
  assert.match(out.text, /No rain in the next/);
});

test('nowcast: refuses missing or stale data instead of guessing', () => {
  assert.equal(app.nowcast([], []), null);
  assert.equal(app.nowcast(null, null), null);
  const old = series(() => true);
  assert.equal(app.nowcast(old.time, old.precip, Date.now() + 30 * 86400000), null,
    'a series that ended weeks ago is not a forecast');
});

test('nowcast: gaps in the data do not read as rain', () => {
  const s = series(() => true);
  s.precip = s.precip.map((v, i) => (i > 4 ? null : v));
  const out = app.nowcast(s.time, s.precip);
  assert.equal(out.raining, true);
  assert.match(out.text, /easing/);
});

/* ------------------------------------------------------------------ */
/* Air quality                                                         */
/* ------------------------------------------------------------------ */

test('aqiBand: the EPA boundaries land in the right band', () => {
  const pairs = [[0, 'Good'], [50, 'Good'], [50.1, 'Moderate'], [100, 'Moderate'],
    [101, 'Unhealthy for sensitive groups'], [150, 'Unhealthy for sensitive groups'],
    [151, 'Unhealthy'], [200, 'Unhealthy'], [201, 'Very unhealthy'], [300, 'Very unhealthy'],
    [301, 'Hazardous'], [500, 'Hazardous']];
  for (const [v, name] of pairs) assert.equal(app.aqiBand(v).name, name, `AQI ${v}`);
});

test('aqiBand: every band has a colour and no gaps', () => {
  for (let v = 0; v <= 520; v += 7) {
    const b = app.aqiBand(v);
    assert.ok(b && b.name && /^#[0-9a-f]{6}$/i.test(b.color), `AQI ${v} has no band`);
  }
});

test('aqiBand: a missing reading has no band', () => {
  for (const v of [NaN, null, undefined, 'x']) assert.equal(app.aqiBand(v), null);
});

test('dominantPollutant: names the worst one present', () => {
  assert.deepEqual(app.dominantPollutant({ us_aqi_pm2_5: 42, us_aqi_o3: 77, us_aqi_no2: 12 }),
    { key: 'us_aqi_o3', label: 'Ozone', value: 77 });
  assert.equal(app.dominantPollutant({ us_aqi_pm2_5: 30 }).label, 'PM2.5');
});

test('dominantPollutant: ignores missing values and empty input', () => {
  assert.equal(app.dominantPollutant({ us_aqi_pm2_5: null, us_aqi_o3: undefined }), null);
  assert.equal(app.dominantPollutant({}), null);
  assert.equal(app.dominantPollutant(null), null);
  assert.equal(app.dominantPollutant({ us_aqi_pm2_5: NaN, us_aqi_o3: 5 }).value, 5);
});

/* ------------------------------------------------------------------ */
/* Saved places                                                        */
/* ------------------------------------------------------------------ */

const NY = { lat: 40.7128, lon: -74.0060, name: 'New York' };
const CHI = { lat: 41.8781, lon: -87.6298, name: 'Chicago' };

test('addPlace: newest first, and never stored twice', () => {
  let list = app.addPlace([], NY);
  list = app.addPlace(list, CHI);
  assert.deepEqual(list.map(p => p.name), ['Chicago', 'New York']);
  // The same spot to three decimals is the same place, whatever it is called now.
  list = app.addPlace(list, { lat: 40.71281, lon: -74.00604, name: 'Manhattan' });
  assert.deepEqual(list.map(p => p.name), ['Manhattan', 'Chicago'], 'it should move to the front, not duplicate');
});

test('addPlace: keeps the list to its cap', () => {
  let list = [];
  for (let i = 0; i < app.MAX_SAVED + 6; i++) list = app.addPlace(list, { lat: i, lon: i, name: `P${i}` });
  assert.equal(list.length, app.MAX_SAVED);
  assert.equal(list[0].name, `P${app.MAX_SAVED + 5}`, 'the newest survives');
  assert.ok(!list.some(p => p.name === 'P0'), 'the oldest is dropped');
});

test('addPlace: stores numbers even when handed strings', () => {
  const [p] = app.addPlace([], { lat: '40.7128', lon: '-74.0060', name: 'New York' });
  assert.equal(typeof p.lat, 'number');
  assert.equal(typeof p.lon, 'number');
  assert.equal(p.key, app.placeKey(40.7128, -74.006));
});

test('removePlace and hasPlace: agree on what counts as the same spot', () => {
  const list = app.addPlace(app.addPlace([], NY), CHI);
  assert.ok(app.hasPlace(list, 40.7128, -74.006));
  assert.ok(app.hasPlace(list, 40.71284, -74.00599), 'a few metres away is the same place');
  assert.ok(!app.hasPlace(list, 40.8, -74.006));
  const after = app.removePlace(list, 40.71284, -74.00599);
  assert.deepEqual(after.map(p => p.name), ['Chicago']);
  assert.ok(!app.hasPlace(after, 40.7128, -74.006));
  assert.deepEqual(app.removePlace(list, 0, 0).length, 2, 'removing an absent place changes nothing');
});

test('placeKey: is stable and rounds to about a hundred metres', () => {
  assert.equal(app.placeKey(40.7128, -74.006), app.placeKey(40.71281, -74.00604));
  assert.notEqual(app.placeKey(40.7128, -74.006), app.placeKey(40.7138, -74.006));
});

/* ------------------------------------------------------------------ */
/* Weather icons and the forecast strips                               */
/* ------------------------------------------------------------------ */

const wx = await load(['WMO', 'wmoText', 'WMO_GROUP', 'wmoGroup', 'ICON_ART', 'weatherIcon',
  'rangeBar', 'hourlySlice', 'dailyRows']);

// Every code Open-Meteo documents for weather_code.
const ALL_WMO = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67,
  71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];

test('WMO: the text and icon tables cover exactly the same codes', () => {
  // If one gains a code and the other does not, a forecast row shows a word with no
  // picture or a picture with no word, depending which way it drifted.
  assert.deepEqual(Object.keys(wx.WMO).map(Number).sort((a, b) => a - b),
    Object.keys(wx.WMO_GROUP).map(Number).sort((a, b) => a - b));
});

test('WMO: every documented code has text and an icon group', () => {
  for (const code of ALL_WMO) {
    assert.ok(wx.WMO[code], `code ${code} has no description`);
    assert.ok(wx.wmoGroup(code), `code ${code} has no icon group`);
    assert.ok(wx.ICON_ART[wx.wmoGroup(code)], `group for ${code} has no artwork`);
  }
});

test('WMO: every group in the table has artwork, and none is unused', () => {
  const used = new Set(Object.values(wx.WMO_GROUP));
  assert.deepEqual([...used].sort(), Object.keys(wx.ICON_ART).sort());
});

test('wmoGroup: an unknown number falls back, a non-number does not', () => {
  assert.equal(wx.wmoGroup(7), 'cloudy', 'an unexpected code still gets a picture');
  assert.equal(wx.wmoGroup(NaN), null);
  assert.equal(wx.wmoGroup(null), null);
  assert.equal(wx.wmoGroup(undefined), null);
});

test('weatherIcon: draws valid markup for every code, day and night', () => {
  for (const code of ALL_WMO) {
    for (const day of [true, false]) {
      const svg = wx.weatherIcon(code, day);
      assert.match(svg, /^<svg /, `code ${code} produced no svg`);
      assert.ok(svg.trim().endsWith('</svg>'), `code ${code} is unterminated`);
      assert.ok(!svg.includes('NaN'), `NaN in the icon for ${code}`);
      assert.ok(!svg.includes('undefined'), `undefined in the icon for ${code}`);
      assert.equal((svg.match(/<svg/g) || []).length, 1, `nested svg for ${code}`);
      assert.match(svg, /aria-label="[^"]+"/, `code ${code} has no label`);
    }
  }
});

test('weatherIcon: clear skies differ between day and night', () => {
  assert.notEqual(wx.weatherIcon(0, true), wx.weatherIcon(0, false), 'a night sun would be odd');
  // Overcast looks the same either way, and should.
  assert.equal(wx.weatherIcon(3, true), wx.weatherIcon(3, false));
});

test('weatherIcon: nothing to draw for a missing code', () => {
  for (const c of [NaN, null, undefined]) assert.equal(wx.weatherIcon(c), '');
});

test('rangeBar: places a day on the shared scale', () => {
  // A week from 30 to 80: a 50-to-60 day starts 40% along and covers 20%.
  const b = wx.rangeBar(50, 60, 30, 80);
  close(b.x, 40, 1e-9, 'bar start');
  close(b.w, 20, 1e-9, 'bar width');
});

test('rangeBar: the coldest and warmest days touch the ends', () => {
  const cold = wx.rangeBar(30, 40, 30, 80);
  close(cold.x, 0, 1e-9);
  const warm = wx.rangeBar(70, 80, 30, 80);
  close(warm.x + warm.w, 100, 1e-9);
});

test('rangeBar: never runs off the end of its track', () => {
  for (const [lo, hi] of [[-50, 200], [-999, -998], [500, 900], [0, 0]]) {
    const b = wx.rangeBar(lo, hi, 30, 80);
    assert.ok(b.x >= 0 && b.x <= 100, `bar starts off the track at ${b.x}`);
    assert.ok(b.w > 0 && b.x + b.w <= 100.0001, `bar ends off the track at ${b.x + b.w}`);
  }
});

test('rangeBar: a flat week fills the track rather than vanishing', () => {
  assert.deepEqual(wx.rangeBar(50, 50, 50, 50), { x: 0, w: 100 });
});

test('rangeBar: a reversed high and low still draws', () => {
  const b = wx.rangeBar(60, 50, 30, 80);
  close(b.x, 40, 1e-9);
  close(b.w, 20, 1e-9);
});

test('rangeBar: missing numbers draw nothing', () => {
  assert.equal(wx.rangeBar(NaN, 60, 30, 80), null);
  assert.equal(wx.rangeBar(50, 60, NaN, 80), null);
  assert.equal(wx.rangeBar(null, undefined, 30, 80), null);
});

/** An hourly block starting at the top of the current hour. */
const hourlyFixture = (n = 48, now = Date.now()) => {
  const t0 = Math.floor(now / 3600000) * 3600;
  const time = [], temperature_2m = [], weather_code = [], precipitation_probability = [], is_day = [];
  for (let i = 0; i < n; i++) {
    time.push(t0 + i * 3600);
    temperature_2m.push(10 + i);
    weather_code.push(i % 2 ? 61 : 0);
    precipitation_probability.push(i * 2);
    is_day.push(i % 24 < 12 ? 1 : 0);
  }
  return { time, temperature_2m, weather_code, precipitation_probability, is_day };
};

test('hourlySlice: returns the next 24 hours from now', () => {
  const out = wx.hourlySlice(hourlyFixture());
  assert.equal(out.length, 24);
  assert.ok(out[0].time + 3600000 > Date.now(), 'the first entry should not be in the past');
  assert.equal(out[0].temp, 10);
  assert.equal(typeof out[0].isDay, 'boolean');
});

test('hourlySlice: honours a shorter request and a short series', () => {
  assert.equal(wx.hourlySlice(hourlyFixture(), Date.now(), 6).length, 6);
  assert.equal(wx.hourlySlice(hourlyFixture(3)).length, 3, 'it cannot invent hours it does not have');
});

test('hourlySlice: a series that has already ended gives nothing', () => {
  assert.deepEqual(wx.hourlySlice(hourlyFixture(24), Date.now() + 40 * 86400000), []);
});

test('hourlySlice: missing blocks come back as NaN, not a crash', () => {
  const bare = { time: hourlyFixture(4).time };
  const out = wx.hourlySlice(bare);
  assert.equal(out.length, 4);
  assert.ok(Number.isNaN(out[0].temp));
  assert.equal(out[0].isDay, true, 'daylight is assumed when the flag is absent');
});

test('hourlySlice: refuses empty or malformed input', () => {
  for (const h of [null, undefined, {}, { time: [] }, { time: 'nope' }]) {
    assert.deepEqual(wx.hourlySlice(h), []);
  }
});

const dailyFixture = (n = 7) => {
  const t0 = Math.floor(Date.now() / 86400000) * 86400;
  const out = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [], precipitation_probability_max: [] };
  for (let i = 0; i < n; i++) {
    out.time.push(t0 + i * 86400);
    out.weather_code.push(i === 2 ? 95 : 2);
    out.temperature_2m_max.push(60 + i * 3);
    out.temperature_2m_min.push(40 + i * 2);
    out.precipitation_sum.push(i * 0.1);
    out.precipitation_probability_max.push(i * 10);
  }
  return out;
};

test('dailyRows: reads the week and its temperature range', () => {
  const { rows, min, max } = wx.dailyRows(dailyFixture());
  assert.equal(rows.length, 7);
  assert.equal(min, 40, 'the coldest low of the week');
  assert.equal(max, 78, 'the warmest high of the week');
  assert.equal(rows[2].code, 95);
});

test('dailyRows: stops at the limit and at the data', () => {
  assert.equal(wx.dailyRows(dailyFixture(), 3).rows.length, 3);
  assert.equal(wx.dailyRows(dailyFixture(2)).rows.length, 2);
});

test('dailyRows: a missing temperature block leaves the range unknown', () => {
  const d = dailyFixture();
  delete d.temperature_2m_max; delete d.temperature_2m_min;
  const { rows, min, max } = wx.dailyRows(d);
  assert.equal(rows.length, 7);
  assert.ok(Number.isNaN(min) && Number.isNaN(max), 'no temperatures, no scale');
  assert.equal(wx.rangeBar(rows[0].lo, rows[0].hi, min, max), null, 'and so no bar');
});

test('dailyRows: refuses empty or malformed input', () => {
  for (const d of [null, undefined, {}, { time: [] }]) {
    assert.deepEqual(wx.dailyRows(d), { rows: [], min: NaN, max: NaN });
  }
});

test('the week always fits its own bars', () => {
  // The property that matters on screen: every row lands inside the track.
  const { rows, min, max } = wx.dailyRows(dailyFixture());
  for (const r of rows) {
    const b = wx.rangeBar(r.lo, r.hi, min, max);
    assert.ok(b && b.x >= 0 && b.x + b.w <= 100.0001, `${r.lo}-${r.hi} does not fit`);
  }
});

/* ------------------------------------------------------------------ */
/* Local time at the spot                                              */
/* ------------------------------------------------------------------ */
// Looking up tomorrow in Tulsa from a sofa in London should give Tulsa's sunrise, on
// Tulsa's calendar. Everything in the conditions tab is formatted in the spot's own
// time, not the reader's, by shifting the instant and formatting it as UTC.

const tz = await load(['shifted', 'fmtClock', 'fmtHour', 'fmtDay']);

test('shifted: moves an instant by a whole offset', () => {
  const base = Date.UTC(2026, 5, 1, 12, 0, 0);
  assert.equal(+tz.shifted(base, 0), base);
  assert.equal(+tz.shifted(base, -6 * 3600), base - 6 * 3600000, 'six hours behind');
  assert.equal(+tz.shifted(base, 5.5 * 3600), base + 5.5 * 3600000, 'a half-hour zone');
  assert.equal(+tz.shifted(base, 45 * 60), base + 45 * 60000, 'a quarter-hour zone');
});

test('shifted: a missing offset is no offset, not NaN', () => {
  const base = Date.UTC(2026, 5, 1, 12, 0, 0);
  for (const off of [undefined, null, 0, NaN]) {
    const out = +tz.shifted(base, off);
    assert.ok(Number.isFinite(out), `offset ${off} produced an invalid date`);
  }
  assert.equal(+tz.shifted(base, undefined), base);
});

test('fmtClock: reads the spot clock, not the machine clock', () => {
  // 12:00 UTC is 06:00 in Tulsa in summer and 13:00 in London.
  const noonUTC = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
  const tulsa = tz.fmtClock(noonUTC, -5 * 3600);
  const london = tz.fmtClock(noonUTC, 1 * 3600);
  assert.match(tulsa, /\b7\b/, `expected 7 o'clock in Tulsa, got "${tulsa}"`);
  assert.match(london, /\b13\b|\b1\b/, `expected 1 pm in London, got "${london}"`);
  assert.notEqual(tulsa, london, 'two zones must not read the same');
});

test('fmtClock: the same instant in two zones differs by the offset', () => {
  const t = new Date(Date.UTC(2026, 0, 15, 18, 30, 0));
  assert.equal(tz.fmtClock(t, 0), tz.fmtClock(t, 24 * 3600), 'a whole day apart reads the same');
  assert.notEqual(tz.fmtClock(t, 0), tz.fmtClock(t, 3600));
});

test('fmtClock: a missing time is a dash', () => {
  assert.equal(tz.fmtClock(null, 0), '–');
  assert.equal(tz.fmtClock(undefined, -18000), '–');
});

test('fmtDay: the calendar rolls on the spot clock', () => {
  // 02:00 UTC on the 2nd is still the evening of the 1st five hours west.
  const ms = Date.UTC(2026, 5, 2, 2, 0, 0);
  const west = tz.fmtDay(ms, 1, -5 * 3600);
  const utc = tz.fmtDay(ms, 1, 0);
  assert.notEqual(west, utc, 'the two zones are on different days');
  assert.match(utc, /Tue/);
  assert.match(west, /Mon/);
});

test('fmtDay: the first row is always Today, whatever the zone', () => {
  const ms = Date.UTC(2026, 5, 2, 2, 0, 0);
  for (const off of [-43200, -18000, 0, 3600, 50400]) {
    assert.equal(tz.fmtDay(ms, 0, off), 'Today');
  }
});

test('fmtHour: follows the spot clock too', () => {
  const ms = Date.UTC(2026, 5, 1, 12, 0, 0);
  assert.notEqual(tz.fmtHour(ms, 0), tz.fmtHour(ms, -5 * 3600));
  assert.equal(tz.fmtHour(ms, 0), tz.fmtHour(ms, 0));
});

test('local time formatting never produces an invalid date', () => {
  const ms = Date.UTC(2026, 5, 1, 12, 0, 0);
  for (const off of [-50400, -43200, -18000, -1800, 0, 1800, 19800, 45900, 50400]) {
    for (const out of [tz.fmtHour(ms, off), tz.fmtDay(ms, 1, off), tz.fmtClock(new Date(ms), off)]) {
      assert.ok(out && !/Invalid/.test(out), `offset ${off} produced "${out}"`);
    }
  }
});
