#!/usr/bin/env node
// JavaScript runtime dist smoke test.
//
// Imports the *built* `/runtime` bundle, checks that it is self-contained (it
// imports nothing, so no engine chunk is loaded), and runs stored code from a
// compilation by the *built* main bundle: the same seeded program gives the
// same values with `run()` and on the engine-free runtime.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(resolve(__dirname, '..', '..'), 'dist', 'esm-min');
const RUNTIME_BUNDLE = join(DIST, 'runtime.js');
const MAIN_BUNDLE = join(DIST, 'compute-engine.js');

for (const bundle of [RUNTIME_BUNDLE, MAIN_BUNDLE]) {
  if (!existsSync(bundle)) {
    console.error(
      `js-runtime-smoke: ${bundle} not found. Run \`npm run build production\` first.`
    );
    process.exit(1);
  }
}

function fail(message) {
  console.error(`js-runtime-smoke: FAILED — ${message}`);
  process.exit(1);
}

const source = readFileSync(RUNTIME_BUNDLE, 'utf8');
if (/^\s*import\s|\bfrom\s*["'][./]/m.test(source))
  fail('runtime.js imports another module; it must be self-contained');

const { createJavaScriptRuntime, runtimeVersion } = await import(
  pathToFileURL(RUNTIME_BUNDLE).href
);
const { ComputeEngine, compile } = await import(
  pathToFileURL(MAIN_BUNDLE).href
);

const ce = new ComputeEngine();
const result = compile(
  ce.box(['WithRandomSeed', 7, ['RandomShuffle', ['Range', 1, 10]]]),
  { fallback: false, constantFold: false }
);
if (!result?.success) fail('the seeded program did not compile');
if (result.runtimeVersion !== runtimeVersion)
  fail(`runtimeVersion ${result.runtimeVersion} !== ${runtimeVersion}`);
// Both sides could carry the same unreplaced placeholder.
if (!/^\d+\.\d+\.\d+/.test(runtimeVersion))
  fail(`the build did not replace the version: ${runtimeVersion}`);

const viaRun = JSON.stringify(result.run());
const viaRuntime = JSON.stringify(createJavaScriptRuntime().load(result)());
if (viaRun !== viaRuntime) fail(`${viaRun} !== ${viaRuntime}`);

// The bundles have separate number libraries: what depends on the engine's
// precision or declarations must travel with the result.
const same = (what, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    fail(`${what}: run() ${JSON.stringify(a)}, runtime ${JSON.stringify(b)}`);
};

// A negative base's float exponent is read to 15 digits at machine precision;
// the runtime's own precision would pick 17.
const machine = new ComputeEngine();
machine.precision = 'machine';
const power = compile(machine.box(['Power', -2, 'x']), { fallback: false });
if (!power?.success) fail('(-2)^x did not compile');
const x = 33.3333333333333;
const powerViaRun = power.run({ x });
if (!Number.isFinite(powerViaRun)) fail(`(-2)^x via run(): ${powerViaRun}`);
same('(-2)^x', powerViaRun, createJavaScriptRuntime().load(power)({ x }));

// The conversions run() applies at entry: a real for a complex symbol, a
// typed array for a list symbol.
const typed = new ComputeEngine();
typed.declare('z', 'complex');
typed.declare('L', 'list<real>');
const square = compile(typed.parse('z^2+z'), { fallback: false });
same(
  'z^2+z',
  square.run({ z: 2 }),
  createJavaScriptRuntime().load(square)({ z: 2 })
);
const total = compile(
  typed.box(['Sum', ['At', 'L', 'i'], ['Limits', 'i', 1, 3]]),
  {
    fallback: false,
  }
);
if (!total?.success) fail('the list sum did not compile');
const list = new Float64Array([1, 2, 3]);
same(
  'list sum',
  total.run({ L: list }),
  createJavaScriptRuntime().load(total)({ L: list })
);

console.log('js-runtime-smoke: OK');
