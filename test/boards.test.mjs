// Tests the American Weather forum matcher against real geometry.
//
// boardsFor is a hand-written rule table with latitude and longitude splits for the
// nine states two boards share. It is exactly the kind of code that looks right and
// quietly sends half of New Jersey to the wrong forum, so every rule gets a real city.

import test from 'node:test';
import assert from 'node:assert/strict';
import { forumMatcher } from './states.mjs';
import { load } from './extract.mjs';

const app = await forumMatcher();
const keysAt = (lat, lon) => app.boardsFor(lat, lon).keys;

/* Each row is [city, lat, lon, expected board keys in order]. The expected values
   follow the coverage each board publishes, quoted in BOARDS[].covers. */
const CITIES = [
  // New England: all six states, one board.
  ['Boston, MA', 42.3601, -71.0589, ['ne']],
  ['Portland, ME', 43.6591, -70.2568, ['ne']],
  ['Burlington, VT', 44.4759, -73.2121, ['ne']],
  ['Concord, NH', 43.2081, -71.5376, ['ne']],
  ['Hartford, CT', 41.7658, -72.6734, ['ne']],
  ['Providence, RI', 41.8240, -71.4128, ['ne']],

  // New York splits at the NYC metro corner: lat < 41.4 and lon > -74.5.
  ['New York, NY', 40.7128, -74.0060, ['nyc']],
  ['Islip, NY', 40.7298, -73.2107, ['nyc']],
  ['White Plains, NY', 41.0340, -73.7629, ['nyc']],
  ['Albany, NY', 42.6526, -73.7562, ['upny']],
  ['Buffalo, NY', 42.8864, -78.8784, ['upny']],
  ['Binghamton, NY', 42.0987, -75.9180, ['upny']],

  // New Jersey runs north to south through a shared band.
  ['Newark, NJ', 40.7357, -74.1724, ['nyc']],
  ['Princeton, NJ', 40.3573, -74.6672, ['nyc', 'phl']],
  ['Trenton, NJ', 40.2206, -74.7597, ['phl', 'nyc']],
  ['Atlantic City, NJ', 39.3643, -74.4229, ['phl']],
  ['Cape May, NJ', 38.9351, -74.9060, ['phl']],

  // Pennsylvania: Philly corner, then a south-central band, then everything else.
  ['Philadelphia, PA', 39.9526, -75.1652, ['phl', 'upny']],
  ['Harrisburg, PA', 40.2732, -76.8867, ['upny', 'phl']],
  ['Scranton, PA', 41.4090, -75.6624, ['upny']],
  ['Pittsburgh, PA', 40.4406, -79.9959, ['upny']],
  ['Erie, PA', 42.1292, -80.0851, ['upny']],

  // Delaware splits at the top of the state.
  ['Wilmington, DE', 39.7459, -75.5466, ['phl', 'ma']],
  ['Dover, DE', 39.1582, -75.5244, ['ma']],

  // Mid Atlantic proper.
  ['Washington, DC', 38.9072, -77.0369, ['ma']],
  ['Baltimore, MD', 39.2904, -76.6122, ['ma']],
  ['Charleston, WV', 38.3498, -81.6326, ['ma']],

  // Virginia has two latitude splits.
  ['Arlington, VA', 38.8816, -77.0910, ['ma']],
  ['Richmond, VA', 37.5407, -77.4360, ['ma', 'se']],
  ['Norfolk, VA', 36.8508, -76.2859, ['se', 'ma']],

  // Southeast.
  ['Raleigh, NC', 35.7796, -78.6382, ['se']],
  ['Columbia, SC', 34.0007, -81.0348, ['se']],
  ['Atlanta, GA', 33.7490, -84.3880, ['se']],
  ['Miami, FL', 25.7617, -80.1918, ['se']],
  ['Tampa, FL', 27.9506, -82.4572, ['se']],

  // Alabama has two splits; Mississippi one.
  ['Huntsville, AL', 34.7304, -86.5861, ['tn', 'se']],
  ['Birmingham, AL', 33.5186, -86.8104, ['se', 'tn']],
  ['Mobile, AL', 30.6954, -88.0399, ['se']],
  ['Tupelo, MS', 34.2576, -88.7034, ['tn', 'se']],
  ['Jackson, MS', 32.2988, -90.1848, ['se']],

  // Tennessee is whole; Kentucky splits north and south.
  ['Nashville, TN', 36.1627, -86.7816, ['tn']],
  ['Memphis, TN', 35.1495, -90.0490, ['tn']],
  ['Knoxville, TN', 35.9606, -83.9207, ['tn']],
  ['Bowling Green, KY', 36.9903, -86.4436, ['tn', 'ov']],
  ['Louisville, KY', 38.2527, -85.7585, ['ov', 'tn']],

  // Lakes / Ohio Valley.
  ['Chicago, IL', 41.8781, -87.6298, ['ov']],
  ['Indianapolis, IN', 39.7684, -86.1581, ['ov']],
  ['Detroit, MI', 42.3314, -83.0458, ['ov']],
  ['Columbus, OH', 39.9612, -82.9988, ['ov']],
  ['Milwaukee, WI', 43.0389, -87.9065, ['ov']],

  // IA / MO / MN share a longitude split at -93.6.
  ['Davenport, IA', 41.5236, -90.5776, ['ov', 'cw']],
  ['Sioux City, IA', 42.4999, -96.4003, ['cw', 'ov']],
  ['St. Louis, MO', 38.6270, -90.1994, ['ov', 'cw']],
  ['Kansas City, MO', 39.0997, -94.5786, ['cw', 'ov']],
  ['Minneapolis, MN', 44.9778, -93.2650, ['ov', 'cw']],
  ['Duluth, MN', 46.7867, -92.1005, ['ov', 'cw']],

  // Central / West catches everything else.
  ['Fargo, ND', 46.8772, -96.7898, ['cw']],
  ['Dallas, TX', 32.7767, -96.7970, ['cw']],
  ['New Orleans, LA', 29.9511, -90.0715, ['cw']],
  ['Little Rock, AR', 34.7465, -92.2896, ['cw']],
  ['Denver, CO', 39.7392, -104.9903, ['cw']],
  ['Seattle, WA', 47.6062, -122.3321, ['cw']],
  ['Los Angeles, CA', 34.0522, -118.2437, ['cw']],
  ['Phoenix, AZ', 33.4484, -112.0740, ['cw']],
  ['Anchorage, AK', 61.2181, -149.9003, ['cw']],
  ['Honolulu, HI', 21.3099, -157.8581, ['cw']]
];

test(`boardsFor: ${CITIES.length} real cities land on the right boards`, () => {
  const wrong = [];
  for (const [name, lat, lon, want] of CITIES) {
    const got = keysAt(lat, lon);
    if (got.join() !== want.join()) wrong.push(`${name}: expected [${want}], got [${got}]`);
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}\n`);
});

test('boardsFor: names the state it matched', () => {
  assert.equal(app.boardsFor(41.8781, -87.6298).place, 'Illinois');
  assert.equal(app.boardsFor(38.9072, -77.0369).place, 'District of Columbia');
});

test('boardsFor: the Pacific territories match but have no board', () => {
  // The forums cover the CONUS only. Territories must resolve to a place with an
  // empty board list, not fall through to Central/Western.
  for (const [name, lat, lon] of [
    ['Puerto Rico', 18.2340, -66.0390],
    ['Guam', 13.4750, 144.7500],
    ['US Virgin Islands', 18.3410, -64.9300],
    ['American Samoa', -14.2760, -170.7020]
  ]) {
    const r = app.boardsFor(lat, lon);
    assert.ok(r.place, `${name} should still be identified`);
    assert.deepEqual(r.keys, [], `${name} should have no board`);
  }
});

test('boardsFor: open water matches nothing', () => {
  for (const [lat, lon] of [[35, -60], [26, -90], [45, -140], [0, 0]]) {
    assert.deepEqual(app.boardsFor(lat, lon), { place: null, keys: [] });
  }
});

test('boardsFor: never returns a key that has no board', () => {
  for (const [, lat, lon] of CITIES) {
    for (const k of keysAt(lat, lon)) {
      assert.ok(app.BOARDS[k], `"${k}" is not a board`);
    }
  }
});

test('boardsFor: results have no duplicates and never exceed two boards', () => {
  for (const [name, lat, lon] of CITIES) {
    const keys = keysAt(lat, lon);
    assert.equal(new Set(keys).size, keys.length, `${name} lists a board twice`);
    assert.ok(keys.length <= 2, `${name} returned ${keys.length} boards`);
  }
});

test('boardsFor: every board in the table is reachable from some city', () => {
  const reached = new Set(CITIES.flatMap(([, lat, lon]) => keysAt(lat, lon)));
  for (const k of Object.keys(app.BOARDS)) {
    assert.ok(reached.has(k), `no test city lands on "${k}"`);
  }
});

test('boardsFor: split states are ordered, not just present', () => {
  // The first key drives the panel heading, so order is the whole point of the rule.
  const pairs = [
    ['Princeton then Trenton, NJ', [40.3573, -74.6672], [40.2206, -74.7597]],
    ['Richmond then Norfolk, VA', [37.5407, -77.4360], [36.8508, -76.2859]],
    ['Huntsville then Birmingham, AL', [34.7304, -86.5861], [33.5186, -86.8104]],
    ['Louisville then Bowling Green, KY', [38.2527, -85.7585], [36.9903, -86.4436]],
    ['Davenport then Sioux City, IA', [41.5236, -90.5776], [42.4999, -96.4003]]
  ];
  for (const [label, a, b] of pairs) {
    const ka = keysAt(...a), kb = keysAt(...b);
    assert.equal(ka.length, 2, `${label}: first point should be in a split band`);
    assert.equal(kb.length, 2, `${label}: second point should be in a split band`);
    assert.deepEqual(ka, [...kb].reverse(), `${label}: the two sides should invert`);
  }
});

test('stateAt: returns null before the atlas has loaded', async () => {
  // The forums panel renders before the borders fetch resolves.
  const cold = await load(['stateAt', 'boardsFor'], { prelude: 'let usStates = null;' });
  assert.equal(cold.stateAt(41.88, -87.63), null);
  assert.deepEqual(cold.boardsFor(41.88, -87.63), { place: null, keys: [] });
});

test('stateAt: the bbox prefilter does not reject points it should match', () => {
  // Every city must resolve; a too-tight bbox would silently drop coastal points.
  for (const [name, lat, lon] of CITIES) {
    assert.ok(app.stateAt(lat, lon), `${name} matched no state`);
  }
});
