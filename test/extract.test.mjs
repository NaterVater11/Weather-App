// Tests for the extractor itself.
//
// Every other suite reads the app through this file, so a bug here does not fail --
// it quietly tests the wrong code, or code that was silently truncated. It has been
// wrong twice: once on a declaration with no brackets, once on nested template
// literals. Both are pinned below.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cut, appScript, load } from './extract.mjs';

test('cut: a plain function', () => {
  const src = 'function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n';
  assert.equal(cut(src, 'a'), 'function a() {\n  return 1;\n}');
  assert.equal(cut(src, 'b'), 'function b() {\n  return 2;\n}');
});

test('cut: a scalar const with no brackets at all', () => {
  // The first bug. Requiring a bracket before accepting the semicolon made this run
  // on into whatever came next.
  const src = 'const A = 29.5;\nconst B = 3;\nfunction c() {\n  return A + B;\n}\n';
  assert.equal(cut(src, 'A'), 'const A = 29.5;');
  assert.equal(cut(src, 'B'), 'const B = 3;');
});

test('cut: a multi-line object and a multi-declarator line', () => {
  const src = "const T = {\n  a: 1,\n  b: { c: 2 }\n};\nconst X = 1, Y = 2, Z = 3;\nfunction f() {}\n";
  assert.equal(cut(src, 'T'), 'const T = {\n  a: 1,\n  b: { c: 2 }\n};');
  assert.equal(cut(src, 'X'), 'const X = 1, Y = 2, Z = 3;');
});

test('cut: nested template literals', () => {
  // The second bug. Scanning for the next backtick desynchronises on `${`...`}` and
  // mis-masks everything after it, so later declarations become invisible.
  const src = [
    'function render(rows) {',
    '  return `<ul>${rows.map(r => `<li>${r.name}</li>`).join("")}</ul>`;',
    '}',
    '',
    'const AFTER = 42;'
  ].join('\n');
  assert.equal(cut(src, 'AFTER'), 'const AFTER = 42;');
  assert.ok(cut(src, 'render').endsWith('}'));
  assert.ok(cut(src, 'render').includes('<li>'));
});

test('cut: braces hidden in strings, templates, regexes and comments', () => {
  const src = [
    'function tricky() {',
    '  const a = "}";',
    "  const b = '{';",
    '  const c = `a ${ { d: "}" } } b`;',
    '  const e = /[}{]/;',
    '  // }',
    '  /* } */',
    '  return a + b + c + e;',
    '}',
    'const NEXT = 1;'
  ].join('\n');
  const got = cut(src, 'tricky');
  assert.ok(got.startsWith('function tricky()'));
  assert.ok(got.endsWith('return a + b + c + e;\n}'), `cut ended early:\n${got}`);
  assert.equal(cut(src, 'NEXT'), 'const NEXT = 1;');
});

test('cut: an arrow function with a block body', () => {
  const src = 'const f = (a, b) => {\n  return a + b;\n};\nconst g = 2;\n';
  assert.equal(cut(src, 'f'), 'const f = (a, b) => {\n  return a + b;\n};');
  assert.equal(cut(src, 'g'), 'const g = 2;');
});

test('cut: refuses a name it cannot find', () => {
  assert.throws(() => cut('const a = 1;\n', 'missing'), /no top-level declaration named "missing"/);
  // An indented declaration is not top-level and must not be picked up.
  assert.throws(() => cut('function outer() {\n  const inner = 1;\n}\n', 'inner'), /no top-level declaration/);
});

test('cut: refuses a cut that swallows the next declaration', () => {
  // The guard that turns a silent overshoot into a loud failure.
  const src = 'const A = 1\nconst B = 2;\n'; // missing semicolon on A
  assert.throws(() => cut(src, 'A'), /ran past its own declaration/);
});

test('cut: a declaration at the very end of the source', () => {
  assert.equal(cut('const LAST = 9;', 'LAST'), 'const LAST = 9;');
  assert.equal(cut('function last() {\n  return 1;\n}', 'last'), 'function last() {\n  return 1;\n}');
});

test('appScript: returns the inline script, not the markup', async () => {
  const src = await appScript();
  assert.ok(!src.includes('<!doctype html>'), 'the page leaked into the script');
  assert.ok(!src.includes('</script>'), 'the closing tag leaked in');
  assert.ok(src.includes('function contourSegments('), 'the script body is missing');
  assert.ok(src.length > 50000, `the script looks truncated at ${src.length} characters`);
});

test('load: the assembled module parses and returns what was asked for', async () => {
  const m = await load(['hex', 'niceTicks'], { prelude: 'const extra = 7;', expose: ['extra'] });
  assert.deepEqual(Object.keys(m).sort(), ['extra', 'hex', 'niceTicks']);
  assert.equal(m.extra, 7);
  assert.deepEqual(m.hex('#ffffff'), [255, 255, 255]);
});

test('load: a name that is not there fails loudly', async () => {
  await assert.rejects(() => load(['definitelyNotThere']), /no top-level declaration/);
});

test('every declaration the suites rely on can still be cut', async () => {
  // A reformat of the app that breaks extraction should fail here first, with a name,
  // rather than as a confusing cascade in whichever suite happens to run first.
  const src = await appScript();
  const needed = [
    'contourSegments', 'bilinear', 'upsample', 'barbMarkup', 'colorAt', 'niceTicks',
    'moistDTdp', 'moistPath', 'liftParcel', 'hex', 'mkScale', 'miles', 'SCALES',
    'stateAt', 'boardsFor', 'BOARDS', 'QUANTITY', 'UNIT_SYSTEMS', 'FIELDS', 'FIELD',
    'MODELS', 'MODEL', 'fmtQty', 'unitLabel', 'toDisplay', 'chartSVG',
    'sunTimes', 'moonPhase', 'moonName', 'moonSVG', 'uvFromWind', 'windProfile',
    'windAt', 'bulkShear', 'meanWind', 'bunkersMotion', 'stormRelativeHelicity',
    'severeParams', 'hodographSVG', 'nowcast', 'aqiBand', 'dominantPollutant',
    'addPlace', 'removePlace', 'hasPlace', 'placeKey',
    'parseView', 'buildView', 'nearestTimeIndex', 'owns',
    'WMO', 'WMO_GROUP', 'weatherIcon', 'rangeBar', 'hourlySlice', 'dailyRows'
  ];
  const broken = [];
  for (const n of needed) {
    try {
      const text = cut(src, n);
      if (!new RegExp(`^(?:const|function) ${n}\\b`).test(text)) broken.push(`${n} (cut starts wrong)`);
    } catch (e) { broken.push(`${n}: ${e.message}`); }
  }
  assert.deepEqual(broken, [], `\n  ${broken.join('\n  ')}\n`);
});
