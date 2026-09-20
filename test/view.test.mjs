// Tests for the shareable view codec.
//
// A hash arrives from whoever sent the link, so parseView is an input boundary: a model
// key it lets through that does not exist would crash `model()` on the first render,
// and coordinates it does not bound would send Leaflet somewhere undefined. Everything
// here is checked for what it rejects as much as for what it accepts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const app = await load([
  'MODELS', 'MODEL', 'VARS', 'hex', 'mkScale', 'SCALES', 'FIELDS', 'FIELD',
  'QUANTITY', 'UNIT_SYSTEMS', 'KT2MPH', 'DETAIL',
  'owns', 'parseView', 'buildView', 'nearestTimeIndex'
]);

/* ------------------------------------------------------------------ */
/* parseView                                                           */
/* ------------------------------------------------------------------ */

test('parseView: reads a full view', () => {
  const v = app.parseView('#z=6.5&c=35.4676,-97.5164&m=hrrr&f=cape&t=1789000000&p=35.2,-97.4&u=metric');
  assert.equal(v.zoom, 6.5);
  assert.deepEqual(v.center, { lat: 35.4676, lon: -97.5164 });
  assert.equal(v.model, 'hrrr');
  assert.equal(v.field, 'cape');
  assert.equal(v.time, 1789000000);
  assert.deepEqual(v.point, { lat: 35.2, lon: -97.4 });
  assert.equal(v.units, 'metric');
});

test('parseView: works with or without the leading hash', () => {
  assert.deepEqual(app.parseView('#m=gfs'), app.parseView('m=gfs'));
});

test('parseView: an empty or missing hash is an empty view, not a crash', () => {
  for (const h of ['', '#', null, undefined, 0, '#&&&']) {
    assert.deepEqual(app.parseView(h), {}, `${JSON.stringify(h)} should parse to nothing`);
  }
});

test('parseView: a model or field that does not exist is dropped', () => {
  // The important one. `model()` looks the key up directly and would return undefined.
  for (const bad of ['nope', '', '__proto__', 'constructor', 'toString']) {
    const v = app.parseView(`#m=${encodeURIComponent(bad)}&f=${encodeURIComponent(bad)}`);
    assert.equal(v.model, undefined, `model "${bad}" should not survive`);
    assert.equal(v.field, undefined, `field "${bad}" should not survive`);
  }
  // Every real key does survive.
  for (const m of app.MODELS) assert.equal(app.parseView(`#m=${m.key}`).model, m.key);
  for (const f of app.FIELDS) assert.equal(app.parseView(`#f=${f.key}`).field, f.key);
});

test('parseView: an unknown unit system is dropped', () => {
  assert.equal(app.parseView('#u=imperial').units, undefined);
  assert.equal(app.parseView('#u=').units, undefined);
  for (const u of app.UNIT_SYSTEMS) assert.equal(app.parseView(`#u=${u}`).units, u);
});

test('parseView: coordinates outside the world are refused', () => {
  for (const bad of ['91,0', '-91,0', '0,181', '0,-181', 'abc,def', '35.4', '1,2,3', '', ',', 'NaN,NaN', 'Infinity,0']) {
    assert.equal(app.parseView(`#c=${encodeURIComponent(bad)}`).center, undefined, `"${bad}" should be refused`);
    assert.equal(app.parseView(`#p=${encodeURIComponent(bad)}`).point, undefined, `"${bad}" should be refused as a point`);
  }
  // The edges themselves are legal.
  assert.deepEqual(app.parseView('#c=90,180').center, { lat: 90, lon: 180 });
  assert.deepEqual(app.parseView('#c=-90,-180').center, { lat: -90, lon: -180 });
});

test('parseView: zoom and time are bounded', () => {
  for (const bad of ['0', '21', '-3', 'abc', 'NaN', 'Infinity', '1e9']) {
    assert.equal(app.parseView(`#z=${bad}`).zoom, undefined, `zoom "${bad}" should be refused`);
  }
  assert.equal(app.parseView('#z=3').zoom, 3);
  assert.equal(app.parseView('#t=-1').time, undefined, 'a negative time is not a time');
  assert.equal(app.parseView('#t=9999999999').time, undefined, 'a time far past any run is refused');
  assert.equal(app.parseView('#t=0').time, 0);
});

test('parseView: junk and injection attempts come back as nothing', () => {
  const nasty = [
    '#<script>alert(1)</script>',
    '#m=<img src=x onerror=alert(1)>',
    '#c=javascript:alert(1)',
    '#' + 'a'.repeat(5000),
    '#%%%%',
    '#m=hrrr&m=nope',
    '#=&=&='
  ];
  for (const h of nasty) {
    const v = app.parseView(h);
    assert.equal(typeof v, 'object', `${h} should still parse to an object`);
    for (const key of Object.keys(v)) {
      assert.ok(['zoom', 'center', 'model', 'field', 'time', 'point', 'units'].includes(key), `unexpected key ${key}`);
    }
    if (v.model) assert.ok(app.MODEL[v.model], 'a surviving model must be real');
    if (v.field) assert.ok(app.FIELD[v.field], 'a surviving field must be real');
  }
});

test('parseView: unknown keys are ignored', () => {
  const v = app.parseView('#m=gfs&exec=rm&theme=dark&z=5');
  assert.deepEqual(Object.keys(v).sort(), ['model', 'zoom']);
});

/* ------------------------------------------------------------------ */
/* buildView                                                           */
/* ------------------------------------------------------------------ */

test('buildView: writes only what it was given', () => {
  assert.equal(app.buildView({}), '', 'an empty view needs no hash');
  assert.equal(app.buildView({ model: 'hrrr' }), '#m=hrrr');
  assert.equal(app.buildView({ units: 'metric' }), '#u=metric');
});

test('buildView: keeps commas readable rather than escaping them', () => {
  const h = app.buildView({ center: { lat: 35.4676, lon: -97.5164 } });
  assert.equal(h, '#c=35.4676,-97.5164');
  assert.ok(!h.includes('%2C'), 'an escaped comma makes the link ugly for no gain');
});

test('buildView: rounds coordinates and zoom to something sane', () => {
  const h = app.buildView({ zoom: 6.123456, center: { lat: 35.46761234, lon: -97.51649999 } });
  assert.equal(h, '#z=6.1&c=35.4676,-97.5165');
});

test('buildView: ignores values it cannot use', () => {
  assert.equal(app.buildView({ zoom: NaN, time: NaN }), '');
  assert.equal(app.buildView({ zoom: Infinity }), '');
  assert.equal(app.buildView({ point: null, center: null }), '');
});

/* ------------------------------------------------------------------ */
/* Round trip                                                          */
/* ------------------------------------------------------------------ */

test('a view survives a round trip unchanged', () => {
  const view = {
    zoom: 6.5,
    center: { lat: 35.4676, lon: -97.5164 },
    model: 'nam',
    field: 'snowTot',
    time: 1789000000,
    point: { lat: 41.8781, lon: -87.6298 },
    units: 'metric'
  };
  const back = app.parseView(app.buildView(view));
  assert.deepEqual(back, view);
  // And a second trip changes nothing further.
  assert.equal(app.buildView(back), app.buildView(view));
});

test('a link built for every model and field parses back', () => {
  for (const m of app.MODELS) {
    for (const f of app.FIELDS) {
      const h = app.buildView({ model: m.key, field: f.key });
      const v = app.parseView(h);
      assert.equal(v.model, m.key);
      assert.equal(v.field, f.key);
    }
  }
});

test('the antimeridian and the poles survive a round trip', () => {
  for (const c of [{ lat: 0, lon: 180 }, { lat: 0, lon: -180 }, { lat: 90, lon: 0 }, { lat: -90, lon: 0 }]) {
    assert.deepEqual(app.parseView(app.buildView({ center: c })).center, c);
  }
});

/* ------------------------------------------------------------------ */
/* nearestTimeIndex                                                    */
/* ------------------------------------------------------------------ */

test('nearestTimeIndex: finds the closest frame', () => {
  const times = [1000, 4600, 8200, 11800]; // hourly
  assert.equal(app.nearestTimeIndex(times, 1000), 0, 'an exact hit');
  assert.equal(app.nearestTimeIndex(times, 4500), 1, 'just before a frame');
  assert.equal(app.nearestTimeIndex(times, 4700), 1, 'just after a frame');
  assert.equal(app.nearestTimeIndex(times, 6000), 1, 'below the midpoint');
  assert.equal(app.nearestTimeIndex(times, 7000), 2, 'above the midpoint');
});

test('nearestTimeIndex: clamps rather than running off either end', () => {
  const times = [1000, 4600, 8200];
  assert.equal(app.nearestTimeIndex(times, -99999), 0, 'a time before the run');
  assert.equal(app.nearestTimeIndex(times, 99999999), 2, 'a time after the run');
});

test('nearestTimeIndex: falls back to the first frame when it cannot choose', () => {
  assert.equal(app.nearestTimeIndex([], 5000), 0);
  assert.equal(app.nearestTimeIndex(null, 5000), 0);
  assert.equal(app.nearestTimeIndex([1000, 2000], NaN), 0);
  assert.equal(app.nearestTimeIndex([1000, 2000], null), 0);
  assert.equal(app.nearestTimeIndex([1000, 2000], undefined), 0);
});

test('nearestTimeIndex: always returns a usable index', () => {
  // The result indexes state.times directly; an out-of-range answer renders nothing.
  const times = [1000, 4600, 8200, 11800];
  for (const t of [-1e9, 0, 999, 1000, 5000, 1e9, NaN]) {
    const i = app.nearestTimeIndex(times, t);
    assert.ok(Number.isInteger(i) && i >= 0 && i < times.length, `index ${i} is out of range for ${t}`);
  }
});
