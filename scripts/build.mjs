#!/usr/bin/env node
// @ts-nocheck

import * as esbuild from 'esbuild';
import { chmod, copyFile } from 'node:fs/promises';

import pkg from '../package.json' with { type: 'json' };
const SDK_VERSION = pkg.version || 'v?.?.?';

// The package is ESM only (since 2026-10-26). There is no UMD or CommonJS
// build: Node loads an ESM entry through `require()` since Node 22.12, which
// is the floor in `engines.node`, and the `exports` map has no `require`
// condition, so a CommonJS consumer falls through to the `default` ESM file.
// None of the entries uses a top-level `await` (the kernel worker's
// `await import()` runs inside a function), which is what `require()` of an
// ESM module forbids.

const BUILD_OPTIONS = {
  banner: {
    js: `/** Compute Engine ${SDK_VERSION} ${
      process.env.GIT_VERSION ? ' -- ' + process.env.GIT_VERSION : ''
    }*/`,
  },
  bundle: true,
  define: {
    ENV: JSON.stringify(process.env.BUILD),
    SDK_VERSION: JSON.stringify(SDK_VERSION),
    GIT_VERSION: JSON.stringify(process.env.GIT_VERSION || '?.?.?'),
  },
  loader: { '.ts': 'ts' },
  sourcemap: false,
  sourceRoot: '../src',
  sourcesContent: false,
  target: ['es2022'],
  resolveExtensions: ['.ts', '.js'],
};

// Minification settings shared by every `*-min` variant.
const MIN_OPTIONS = {
  drop: ['debugger'],
  pure: ['console.assert', 'console.log'],
  minify: true,
};

// Every entry that shares code with the engine is built in ONE esbuild
// invocation per variant with code splitting, so each shared module is
// emitted once into a chunk that the entries import. A consumer that imports
// two of them (`./core` and `./compile`, say, or the full entry and
// `./integration-rules`, or `./numerics` and the full entry) then loads one
// copy of each class. Without the split, each entry re-bundles what it uses,
// and the duplicate class definitions break cross-bundle `instanceof`
// checks: a host-created `BigDecimal` fails `instanceof BigDecimal` inside
// the plugin's own engine code, `executeEpsil(ce, …)` receives an engine of
// the other copy, and a `NumericValue` made from `./numerics` fails the
// engine's `instanceof NumericValue` tests (`src/compute-engine/index.ts`).
// Measured on 0.169.2, before `core` and `compile` joined the split:
// `core.js` was 5.2 MB and `compile.js` 3.5 MB, each with its own engine.
const SPLIT_ENTRIES = [
  'compute-engine',
  'core',
  'compile',
  'epsil',
  'integration-rules',
  'group-theory',
  'identities',
  'math-json',
  'latex-syntax',
  'interval',
  'numerics',
];

// The two entries that must stay a single file and import no chunk:
// `runtime` (its smoke test, `test/consumer/js-runtime-smoke.mjs`, asserts
// that it imports nothing, so that compiled code can run without the engine)
// and `kernel-worker` (a host copies the file next to its own files and
// starts it with `new Worker(url, { type: 'module' })`). Each has its own
// copy of the modules it uses; neither exchanges class instances with the
// engine, so the duplicate definitions do no harm there.
const STANDALONE_ENTRIES = ['runtime', 'kernel-worker'];

// The published layout puts the variant marker in the DIRECTORY, not the
// filename: `esm/<name>.js` and `esm-min/<name>.js`. Each ESM directory is
// self-contained (its own `chunks/`).
const builds = [];

for (const [outdir, extra] of [
  ['./dist/esm', {}],
  ['./dist/esm-min', MIN_OPTIONS],
]) {
  builds.push(
    esbuild.build({
      ...BUILD_OPTIONS,
      ...extra,
      entryPoints: SPLIT_ENTRIES.map((name) => `./src/${name}.ts`),
      outdir,
      format: 'esm',
      splitting: true,
      entryNames: '[name]',
      chunkNames: 'chunks/[name]-[hash]',
    })
  );
  for (const name of STANDALONE_ENTRIES) {
    builds.push(
      esbuild.build({
        ...BUILD_OPTIONS,
        ...extra,
        entryPoints: [`./src/${name}.ts`],
        outfile: `${outdir}/${name}.js`,
        format: 'esm',
      })
    );
  }
}

// Node CLI. Keep this as a small bundle of the command-line implementation,
// with the Epsil library entry external: the output lives under `cli/`, so
// its preserved `../epsil.js` import resolves to the sibling library bundle.
// This avoids shipping a second ~2 MB copy of the Compute Engine in the
// executable.
for (const [outdir, extra] of [
  ['./dist/esm', {}],
  ['./dist/esm-min', MIN_OPTIONS],
]) {
  builds.push(
    esbuild.build({
      ...BUILD_OPTIONS,
      ...extra,
      entryPoints: ['./src/cli/epsil.ts'],
      outfile: `${outdir}/cli/epsil.js`,
      format: 'esm',
      platform: 'node',
      external: ['../epsil.js'],
    })
  );
}

//
// Build all variants in parallel for maximum performance
//
await Promise.all(builds);
await Promise.all([
  chmod('./dist/esm/cli/epsil.js', 0o755),
  chmod('./dist/esm-min/cli/epsil.js', 0o755),
  // The agent-facing cards (the Epsil language card and the Compute Engine
  // API card) are served by `epsil mcp` as resources; the CLI resolves them
  // relative to its own bundle.
  copyFile('./src/epsil/docs/for-agents.md', './dist/esm/cli/for-agents.md'),
  copyFile(
    './src/epsil/docs/for-agents.md',
    './dist/esm-min/cli/for-agents.md'
  ),
  copyFile(
    './src/compute-engine/docs/for-agents.md',
    './dist/esm/cli/compute-engine-for-agents.md'
  ),
  copyFile(
    './src/compute-engine/docs/for-agents.md',
    './dist/esm-min/cli/compute-engine-for-agents.md'
  ),
]);
