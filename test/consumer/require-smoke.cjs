#!/usr/bin/env node
// CommonJS consumer smoke test.
//
// The package is ESM only (since 2026-10-26): there is no UMD or CommonJS
// build, and the `exports` map has no `require` condition. A CommonJS
// consumer (a NestJS application, say; see issue 292) reaches the ESM entries
// through Node's `require()` of an ES module, which Node supports since
// 22.12, the floor in `engines.node`. This test loads the *built* entries the
// way such a consumer does and checks three things:
//
// 1. `require()` of each entry returns its named exports (an entry with a
//    top-level `await` would throw ERR_REQUIRE_ASYNC_MODULE instead).
// 2. `core.js` and `compile.js` share the engine: both import a common chunk
//    (the code-splitting build of `scripts/build.mjs`). Before 2026-10-26 each
//    was a single-entry build with its own copy of the engine, so a host that
//    imported both loaded two engines.
// 3. A GLSL target imported from `./compile` compiles an expression of an
//    engine made from `./core`, once registered on that engine.
// 4. A `JavaScriptTarget` imported from `./compile` recognizes an exact
//    rational of an expression boxed by the full entry, so a division by an
//    integer literal stays a division (issue 480).

const { readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const DIST = join(resolve(__dirname, '..', '..'), 'dist', 'esm-min');

function fail(message) {
  console.error(`require-smoke: FAILED — ${message}`);
  process.exit(1);
}

const ENTRIES = {
  'compute-engine': ['ComputeEngine', 'compile', 'parse', 'GLSLTarget'],
  core: ['ComputeEngine', 'simplify'],
  compile: ['compile', 'GLSLTarget', 'WGSLTarget', 'PythonTarget'],
  'math-json': ['isSymbolObject'],
  'latex-syntax': ['LatexSyntax', 'parse'],
  interval: ['ok', 'point'],
  numerics: ['NumericValue'],
  runtime: ['createJavaScriptRuntime', 'runtimeVersion'],
  identities: ['loadIdentities'],
  'integration-rules': ['loadIntegrationRules'],
  epsil: ['ComputeEngine', 'executeEpsil', 'parseEpsil'],
};

for (const name of [...Object.keys(ENTRIES), 'kernel-worker']) {
  if (!existsSync(join(DIST, `${name}.js`)))
    fail(`${name}.js not found. Run \`npm run build production\` first.`);
}

const loaded = {};
function load(name) {
  let mod;
  try {
    mod = require(join(DIST, `${name}.js`));
  } catch (e) {
    fail(`require() of ${name}.js threw: ${e && e.message}`);
  }
  for (const symbol of ENTRIES[name]) {
    if (mod[symbol] === undefined)
      fail(`${name}.js: require() gave no \`${symbol}\` export`);
  }
  loaded[name] = mod;
}

// `core` and `compile` first, and the core engine below is made BEFORE the
// full entry loads: a program that loads `./core` alone has the two built-in
// targets. The full entry then adds `glsl`, `wgsl` and `python` to the
// program-wide table of default targets, which every engine reads on each
// lookup, so the same core engine resolves them afterwards (checked below).
for (const name of ['core', 'compile']) load(name);

// 2. One engine chunk for the entries that bundle the engine.
function chunksOf(name) {
  const source = readFileSync(join(DIST, `${name}.js`), 'utf8');
  return new Set(source.match(/\.\/chunks\/[A-Za-z0-9_-]+\.js/g) ?? []);
}
const coreChunks = chunksOf('core');
const compileChunks = chunksOf('compile');
if (coreChunks.size === 0) fail('core.js imports no chunk; it bundles its own engine');
if (compileChunks.size === 0)
  fail('compile.js imports no chunk; it bundles its own engine');
if (![...coreChunks].some((c) => compileChunks.has(c)))
  fail('core.js and compile.js import no common chunk');
for (const name of ['runtime', 'kernel-worker']) {
  if (chunksOf(name).size !== 0) fail(`${name}.js must be self-contained`);
}

// 3. A `./core` engine, a `./compile` target.
const ce = new loaded.core.ComputeEngine();
const names = ce._listCompilationTargets();
if (names.join(',') !== 'javascript,interval-js')
  fail(`a core engine registers ${JSON.stringify(names)}, expected javascript and interval-js`);
ce.registerCompilationTarget('glsl', new loaded.compile.GLSLTarget());
const glsl = loaded.compile.compile(
  ce.box(['Add', 'x', 1]),
  { to: 'glsl', fallback: false }
);
if (!glsl.success || !/x \+ 1\.0/.test(glsl.code))
  fail(`the GLSL target did not compile x + 1 on a core engine: ${glsl.code}`);

// 1. (continued) The other entries, the full entry among them.
for (const name of Object.keys(ENTRIES)) if (!loaded[name]) load(name);

// Once the full entry is loaded, every engine of the program has the five
// targets: one made after the load, and the core engine made before it (the
// default engine that the free functions of `./core` cache is in the same
// position, so `compile(…, { to: 'python' })` of the full entry must not
// throw on it).
const full = new loaded['compute-engine'].ComputeEngine();
const fullNames = full._listCompilationTargets();
if (fullNames.join(',') !== 'javascript,interval-js,glsl,wgsl,python')
  fail(`a full-entry engine registers ${JSON.stringify(fullNames)}`);
const upgraded = ce._listCompilationTargets();
if (upgraded.join(',') !== 'javascript,interval-js,glsl,wgsl,python')
  fail(`the core engine made before the full entry loaded registers ${JSON.stringify(upgraded)}`);
const wgsl = loaded.compile.compile(ce.box(['Add', 'x', 1]), { to: 'wgsl', fallback: false });
if (!wgsl.success) fail('the core engine made before the full entry loaded does not compile to WGSL');
loaded.core.expr(1); // the free functions of `./core` cache a default engine
const viaFreeFunction = loaded['compute-engine'].compile(
  loaded['compute-engine'].parse('x + 1'),
  { to: 'python', fallback: false }
);
if (!viaFreeFunction.success)
  fail('the default engine of the free functions does not compile to Python');

const js = loaded['compute-engine'].compile(full.parse('x^2 + 1'));
if (!js.success || js.run({ x: 3 }) !== 10)
  fail('the JavaScript target did not compile x^2 + 1 on a full-entry engine');

// 4. The compiler reads `Rational(1, 6)` with an `instanceof` test on the
// numeric value. When `compile.js` had its own copy of the engine, the test
// failed for a value made by the full entry: `n(n-1)(n-2)/6` compiled to
// `0.16666666666666666 * …`, which gives 559.9999999999999 at n = 16.
full.declare('n', 'integer');
const cubic = new loaded.compile.JavaScriptTarget().compile(
  full.box(['Divide', ['Multiply', 'n', ['Subtract', 'n', 1], ['Subtract', 'n', 2]], 6])
);
if (!/\/ 6$/.test(cubic.code) || cubic.run({ n: 16 }) !== 560)
  fail(`n(n-1)(n-2)/6 from the ./compile target is ${cubic.code}, ${cubic.run({ n: 16 })} at n = 16`);

console.log('require-smoke: OK');
