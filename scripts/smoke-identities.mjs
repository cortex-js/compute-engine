#!/usr/bin/env node
// Smoke test for the `./identities` subpath build artifacts (plan M3).
//
// Imports the BUILT bundles from ./dist (run `npm run build` first) and
// verifies that `loadIdentities()` makes `Gamma(1/2)` simplify to `√π`.
//
// Usage: node ./scripts/smoke-identities.mjs

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../dist');

const { ComputeEngine } = await import(join(DIST, 'compute-engine.esm.js'));
const { loadIdentities, FUNGRIM_CORE, version } = await import(
  join(DIST, 'identities.esm.js')
);

function check(label, condition) {
  if (!condition) {
    console.error(`✘ ${label}`);
    process.exit(1);
  }
  console.log(`✔ ${label}`);
}

check('identities bundle exports loadIdentities', typeof loadIdentities === 'function');
check('identities bundle exports FUNGRIM_CORE', Array.isArray(FUNGRIM_CORE?.rules));
console.log(`  identities version: ${version}, rules in artifact: ${FUNGRIM_CORE.rules.length}`);

const ce = new ComputeEngine();
const report = loadIdentities(ce);
check('loadIdentities returns a report with loaded > 0', report.loaded > 0);
console.log(`  loaded: ${report.loaded}, byTarget: ${JSON.stringify(report.byTarget)}`);

const result = ce.expr(['Gamma', ['Rational', 1, 2]]).simplify();
const sqrtPi = ce.expr(['Sqrt', 'Pi']);
console.log(`  Gamma(1/2).simplify() → ${result.toString()}`);
check('Gamma(1/2).simplify() is √π', result.isSame(sqrtPi));

console.log('Smoke test passed.');
