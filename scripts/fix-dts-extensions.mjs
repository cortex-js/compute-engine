#!/usr/bin/env node
// Post-process emitted TypeScript declaration files so their relative module
// specifiers carry an explicit `.js` extension. tsc's declaration emit uses
// extensionless specifiers (e.g. `from './x'`), which breaks consumers that
// use `moduleResolution: nodenext` (TS2834), or silently collapses every
// imported type to `any` under `skipLibCheck`. See GitHub issue
// cortex-js/compute-engine#318.
//
// Source imports are intentionally left untouched; only the published
// `dist/types/**/*.d.ts` are rewritten. If any relative specifier cannot be
// resolved to an emitted declaration, the script prints every failure and
// exits non-zero so the build fails loud rather than shipping broken types.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES_DIR = resolve(__dirname, '..', 'dist', 'types');

// Recursively collect every .d.ts file under `dir`.
function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.d.ts')) result.push(full);
  }
  return result;
}

// Resolve a relative specifier `spec` found in file `file` to its rewritten
// form. Returns the new specifier, or null if it should be left as-is, or an
// object `{ error }` if it cannot be resolved.
function resolveSpecifier(file, spec) {
  // Only rewrite relative specifiers.
  if (!spec.startsWith('.')) return null;
  // Already extensioned.
  if (spec.endsWith('.js') || spec.endsWith('.d.ts')) return null;

  const target = resolve(dirname(file), spec);

  // A specifier whose final segment is empty (trailing slash), '.' or '..'
  // names a directory, not a file. Appending '.js' would produce garbage
  // (e.g. '..' -> '...js'), and the file check below can spuriously match a
  // sibling `<dir>.d.ts` one level up, so resolve these to the directory
  // index directly.
  const lastSegment = spec.split('/').pop();
  const isDirectoryRef =
    lastSegment === '' || lastSegment === '.' || lastSegment === '..';
  if (isDirectoryRef) {
    if (existsSync(join(target, 'index.d.ts'))) {
      const sep = spec.endsWith('/') ? '' : '/';
      return `${spec}${sep}index.js`;
    }
    return { error: `${file}: cannot resolve relative specifier '${spec}'` };
  }

  // File takes priority over directory index, matching tsc/node resolution.
  if (existsSync(`${target}.d.ts`)) return `${spec}.js`;
  if (existsSync(join(target, 'index.d.ts'))) return `${spec}/index.js`;
  return { error: `${file}: cannot resolve relative specifier '${spec}'` };
}

const files = existsSync(TYPES_DIR) ? walk(TYPES_DIR) : [];
if (files.length === 0) {
  console.error(
    `fix-dts-extensions: no .d.ts files found under ${TYPES_DIR}. Did the declaration build run?`
  );
  process.exit(1);
}

// Matches the specifier (capture group 2) in each of the three syntactic
// forms, preserving the surrounding syntax and quote style:
//   1. static:   from './x'   import './x'   export ... from './x'
//   2. augment:  declare module './x'
//   3. dynamic:  import('./x')  typeof import('./x')  import('./x').Foo
const PATTERNS = [
  // `from 'S'`, `import 'S'`, `declare module 'S'`
  /\b(from|import|declare\s+module)\s+(['"])([^'"]+)\2/g,
  // `import('S')`
  /\b(import)\s*\(\s*(['"])([^'"]+)\2\s*\)/g,
];

const errors = [];
let rewrittenSpecifiers = 0;
let rewrittenFiles = 0;

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  let changed = false;

  const updated = PATTERNS.reduce((content, pattern) => {
    return content.replace(pattern, (match, _keyword, quote, spec) => {
      const outcome = resolveSpecifier(file, spec);
      if (outcome === null) return match;
      if (typeof outcome === 'object') {
        errors.push(outcome.error);
        return match;
      }
      rewrittenSpecifiers++;
      changed = true;
      return match.replace(`${quote}${spec}${quote}`, `${quote}${outcome}${quote}`);
    });
  }, original);

  if (changed) {
    writeFileSync(file, updated);
    rewrittenFiles++;
  }
}

if (errors.length > 0) {
  console.error(
    `fix-dts-extensions: ${errors.length} unresolved relative specifier(s):`
  );
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `fix-dts-extensions: rewrote ${rewrittenSpecifiers} specifier(s) across ${rewrittenFiles} file(s).`
);
