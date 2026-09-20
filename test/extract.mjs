// Pulls named top-level declarations out of isobar.html so Node can unit-test them.
//
// Isobar ships as one self-contained file with no build step, so there is nothing to
// import. Rather than adding a test hook to the app (which would live in every copy
// anyone hosts), this reads the inline script and lifts out the declarations by name.
//
// The app's script is consistently formatted: top-level declarations start at column 0
// and end at a closing brace in column 0. Extraction asserts that shape rather than
// assuming it, so a reformat breaks the tests loudly instead of silently testing stale
// or truncated code.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The inline <script> body of isobar.html, without the surrounding tags. */
export async function appScript() {
  const html = await readFile(path.join(ROOT, 'isobar.html'), 'utf8');
  const open = html.lastIndexOf('\n<script>\n');
  const close = html.lastIndexOf('\n</script>');
  if (open < 0 || close < open) throw new Error('isobar.html: could not find the inline <script> block');
  return html.slice(open + '\n<script>\n'.length, close);
}

// Blanks strings, template literals, regex literals and comments to spaces so brace
// counting cannot be fooled by a `}` inside `${...}` or a character class.
//
// Template literals need a mode stack, not a scan for the next backtick: `${`nested`}`
// is legal and common in this codebase, and a naive scan desynchronises on it and
// silently mis-masks the rest of the file.
function blank(src) {
  const out = src.split('');
  const wipe = i => { out[i] = src[i] === '\n' ? '\n' : ' '; };
  const stack = [];      // 'tmpl' inside a template, 'expr' inside its ${...}
  const depth = [];      // brace depth within the current ${...}
  const top = () => stack[stack.length - 1];
  let i = 0;

  const isRegexPos = () => {
    for (let k = i - 1; k >= 0; k--) {
      const c = src[k];
      if (c === ' ' || c === '\t' || c === '\n') continue;
      return !/[\w$)\]]/.test(c);
    }
    return true;
  };

  while (i < src.length) {
    const c = src[i], c2 = src[i + 1];

    if (top() === 'tmpl') {
      if (c === '\\') { wipe(i); if (i + 1 < src.length) wipe(i + 1); i += 2; continue; }
      if (c === '`') { wipe(i); stack.pop(); i++; continue; }
      if (c === '$' && c2 === '{') { wipe(i); wipe(i + 1); stack.push('expr'); depth.push(0); i += 2; continue; }
      wipe(i); i++; continue;
    }

    if (c === '/' && c2 === '/') { while (i < src.length && src[i] !== '\n') { wipe(i); i++; } continue; }
    if (c === '/' && c2 === '*') {
      wipe(i); wipe(i + 1); i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { wipe(i); i++; }
      if (i < src.length) { wipe(i); wipe(i + 1); i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c; wipe(i); i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { wipe(i); if (i + 1 < src.length) wipe(i + 1); i += 2; continue; }
        wipe(i); i++;
      }
      if (i < src.length) { wipe(i); i++; }
      continue;
    }
    if (c === '`') { wipe(i); stack.push('tmpl'); i++; continue; }
    if (c === '/' && isRegexPos()) {
      wipe(i); i++;
      let cls = false;
      while (i < src.length) {
        if (src[i] === '\\') { wipe(i); if (i + 1 < src.length) wipe(i + 1); i += 2; continue; }
        if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        else if (src[i] === '/' && !cls) break;
        else if (src[i] === '\n') break;
        wipe(i); i++;
      }
      if (i < src.length) { wipe(i); i++; }
      continue;
    }

    if (top() === 'expr') {
      // The expression is blanked too; only its braces matter, to find the closing }.
      if (c === '{') { depth[depth.length - 1]++; wipe(i); i++; continue; }
      if (c === '}') {
        if (depth[depth.length - 1] === 0) { wipe(i); stack.pop(); depth.pop(); i++; continue; }
        depth[depth.length - 1]--; wipe(i); i++; continue;
      }
      wipe(i); i++; continue;
    }

    i++;
  }
  return out.join('');
}

/**
 * Cuts one top-level declaration out of `src` by name.
 * Handles `function name(...)` and `const name = ...`.
 */
export function cut(src, name) {
  const masked = blank(src);
  const fn = new RegExp(`^function ${name}\\(`, 'm');
  const cn = new RegExp(`^const ${name} = `, 'm');
  const at = fn.exec(masked) || cn.exec(masked);
  if (!at) throw new Error(`extract: no top-level declaration named "${name}"`);
  const start = at.index;

  const isFn = masked[start] === 'f';
  let depth = 0, seen = false, end = -1;
  for (let i = start; i < masked.length && end < 0; i++) {
    const c = masked[i];
    if (c === '{' || c === '(' || c === '[') { depth++; seen = true; }
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth < 0) throw new Error(`extract: unbalanced brackets reading "${name}"`);
      // A function declaration ends at its closing brace; a const runs to its semicolon.
      if (isFn && seen && depth === 0 && c === '}') end = i;
    } else if (c === ';' && depth === 0 && !isFn) {
      // Note: no `seen` guard here. `const X = 5;` contains no brackets at all, and
      // requiring one made the cut run on into the next declaration.
      end = i;
    }
  }
  if (end < 0) throw new Error(`extract: never found the end of "${name}"`);
  const text = src.slice(start, end + 1);
  // Overshooting is silent and poisonous -- it would redeclare whatever it swallowed,
  // or quietly test the wrong function. Top-level declarations start at column 0, so
  // a second one inside the cut means the scan ran past the end.
  if (/\n(?:const|let|var|function|class)\s/.test(blank(text))) {
    throw new Error(`extract: the cut for "${name}" ran past its own declaration`);
  }
  return text;
}

/**
 * Builds a module from the named declarations and evaluates it.
 * `prelude` supplies bindings the app gets from elsewhere (e.g. `usStates`).
 */
export async function load(names, { prelude = '', expose = [] } = {}) {
  const src = await appScript();
  const parts = names.map(n => cut(src, n));
  const body = `${prelude}\n${parts.join('\n\n')}\nreturn { ${[...names, ...expose].join(', ')} };`;
  let make;
  try {
    make = new Function(body);
  } catch (e) {
    throw new Error(`extract: the assembled module does not parse (${e.message})`);
  }
  return make();
}
