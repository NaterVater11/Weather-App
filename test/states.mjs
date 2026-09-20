// Loads the real us-atlas state shapes and wires them into the app's forum matcher.
//
// This is the same file the app fetches at runtime
// (cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json), pinned here as a devDependency so
// the boards tests run against real geometry rather than a hand-drawn stand-in.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as topojson from 'topojson-client';
import { load, ROOT } from './extract.mjs';

/** Mirrors the bbox pass the app runs over the decoded features. */
export function withBboxes(us) {
  return topojson.feature(us, us.objects.states).features.map(f => {
    const b = [180, 90, -180, -90];
    const walk = c => {
      if (typeof c[0] === 'number') {
        b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]);
        b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
      } else c.forEach(walk);
    };
    walk(f.geometry.coordinates);
    f.bbox = b;
    return f;
  });
}

export async function forumMatcher() {
  const us = JSON.parse(await readFile(path.join(ROOT, 'node_modules/us-atlas/states-10m.json'), 'utf8'));
  const app = await load(['stateAt', 'boardsFor', 'BOARDS'], {
    prelude: 'let usStates = null;\nconst setStates = s => { usStates = s; };',
    expose: ['setStates']
  });
  app.setStates(withBboxes(us));
  return app;
}
