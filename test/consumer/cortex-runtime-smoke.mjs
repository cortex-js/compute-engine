#!/usr/bin/env node
// Cortex runtime dist smoke test.
//
// The sibling `nodenext-smoke.mjs` covers `/cortex` TYPE resolution only. This
// test covers the RUNTIME: it imports the *built* production bundles (never
// `src/` via tsx) and actually executes a tiny Cortex program, asserting the
// result and that no diagnostics were produced.
//
// It mirrors how the benchmark harness (`benchmarks/report.mjs`) consumes a
// packed CE release — a direct import of the minified ESM bundle under
// `dist/esm-min/` — rather than inventing a new consumption mechanism.
//
// Two properties are asserted:
//
//   1. Execution works end-to-end: `let x = 1/2` then an `if` expression
//      evaluates to the exact `3/2` with an empty diagnostics list.
//
//   2. Cross-subpath engine-class identity: the `ComputeEngine` is created from
//      the MAIN entry (`compute-engine.js`) and handed to `executeCortex` from
//      the `/cortex` subpath (`cortex.js`). This only works if the two bundles
//      share the engine chunk (code-split ESM) instead of each re-bundling their
//      own copy — a key ship property. We assert it by checking that the boxed
//      result value's `.engine` is the very instance we created.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// The built bundles the package's `exports` map points `.` and `./cortex` at.
const MAIN_BUNDLE = join(REPO_ROOT, 'dist', 'esm-min', 'compute-engine.js');
const CORTEX_BUNDLE = join(REPO_ROOT, 'dist', 'esm-min', 'cortex.js');

for (const bundle of [MAIN_BUNDLE, CORTEX_BUNDLE]) {
  if (!existsSync(bundle)) {
    console.error(
      `cortex-runtime-smoke: ${bundle} not found. Run \`npm run build production\` first.`
    );
    process.exit(1);
  }
}

function fail(message) {
  console.error(`cortex-runtime-smoke: FAILED — ${message}`);
  process.exit(1);
}

const { ComputeEngine } = await import(pathToFileURL(MAIN_BUNDLE).href);
const { executeCortex } = await import(pathToFileURL(CORTEX_BUNDLE).href);

if (typeof ComputeEngine !== 'function')
  fail('ComputeEngine is not exported from the main bundle.');
if (typeof executeCortex !== 'function')
  fail('executeCortex is not exported from the /cortex bundle.');

// Engine from the MAIN entry, executor from the /cortex subpath.
const ce = new ComputeEngine();
const program = 'let x = 1/2\nif (x < 1) { x + 1 } else { 0 }';
const result = executeCortex(ce, program);

// 1. Execution result.
const actual = result.value.toString();
if (actual !== '3/2')
  fail(`expected \`3/2\`, got \`${actual}\` for program:\n${program}`);

if (!Array.isArray(result.diagnostics) || result.diagnostics.length !== 0)
  fail(
    `expected no diagnostics, got ${JSON.stringify(result.diagnostics)}`
  );

// 2. Cross-subpath engine-class identity: the value produced by the /cortex
//    bundle must be bound to the engine we created from the main bundle. If the
//    bundles re-bundled the engine separately, this would be a different
//    instance.
if (result.value.engine !== ce)
  fail(
    'cross-subpath engine identity broken — the /cortex bundle did not use ' +
      'the ComputeEngine instance from the main bundle (bundles are not ' +
      'sharing the engine chunk).'
  );

console.log(
  'cortex-runtime-smoke: PASSED — /cortex executes on the built bundle and ' +
    'shares the engine with the main entry.'
);
