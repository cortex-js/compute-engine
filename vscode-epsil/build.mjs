#!/usr/bin/env node
// Bundles the VS Code extension client and the Epsil language server.
//
// The server bundles the Compute Engine *from the repo source* — it is not
// built against a published package. That is what lets the extension track
// the language as it evolves in-tree. `resolveExtensions` mirrors
// `scripts/build.mjs`: the engine's imports carry a `.js` suffix that has to
// resolve to the `.ts` file next to it.

import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const COMMON = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node18'],
  sourcemap: true,
  sourcesContent: false,
  logLevel: 'info',
  loader: { '.ts': 'ts' },
  resolveExtensions: ['.ts', '.js'],
};

/** @type {import('esbuild').BuildOptions[]} */
const CONFIGS = [
  {
    ...COMMON,
    entryPoints: ['./src/extension.ts'],
    outfile: './dist/extension.js',
    // Supplied by the VS Code runtime, never bundled.
    external: ['vscode'],
  },
  {
    ...COMMON,
    entryPoints: ['./src/server.ts'],
    outfile: './dist/server.js',
    // Everything, including the engine source, goes in the bundle: the
    // published extension has no `node_modules` to fall back on.
    external: [],
  },
  {
    ...COMMON,
    entryPoints: ['./src/debug-adapter.ts'],
    outfile: './dist/debug-adapter.js',
    // Like the server: the engine (and the DAP library) ride in the bundle.
    external: [],
  },
];

if (watch) {
  const contexts = await Promise.all(CONFIGS.map((x) => esbuild.context(x)));
  await Promise.all(contexts.map((x) => x.watch()));
  console.log('Watching for changes...');
} else {
  await Promise.all(CONFIGS.map((x) => esbuild.build(x)));
}
