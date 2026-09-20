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

// Strips strings, template literals, regex literals and comments to spaces so brace
// counting can't be fooled by a `}` inside `${...}` or a character class.
function blank(src) {
  const out = src.split('');
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
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') out[i++] = ' '; continue; }
    if (c === '/' && src[i + 1] === '*') { out[i++] = ' '; out[i++] = ' '; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) out[i++] = ' '; out[i++] = ' '; out[i++] = ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out[i++] = ' ';
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { out[i++] = ' '; if (i < src.length) out[i++] = ' '; continue; }
        out[i] = src[i] === '\n' ? '\n' : ' '; i++;
      }
      out[i++] = ' '; continue;
    }
    if (c === '/' && isRegexPos()) {
      out[i++] = ' '; let cls = false;
      while (i < src.length) {
        if (src[i] === '\\') { out[i++] = ' '; if (i < src.length) out[i++] = ' '; continue; }
        if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
        else if (src[i] === '/' && !cls) break;
        else if (src[i] === '\n') break;
        out[i++] = ' ';
      }
      out[i++] = ' '; continue;
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

  let depth = 0, seen = false;
  for (let i = start; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{' || c === '(' || c === '[') { depth++; seen = true; }
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth < 0) throw new Error(`extract: unbalanced brackets reading "${name}"`);
    } else if (c === ';' && depth === 0 && seen) return src.slice(start, i + 1);
    if (seen && depth === 0 && c === '}') {
      // A function declaration ends at its closing brace; a const ends at the semicolon.
      if (masked[start] === 'f') return src.slice(start, i + 1);
    }
  }
  throw new Error(`extract: never found the end of "${name}"`);
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
