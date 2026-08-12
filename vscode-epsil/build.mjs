#!/usr/bin/env node
// Bundles the VS Code extension client and the Epsil language server.
//
// The server bundles the Compute Engine *from the repo source* — it is not
// built against a published package. That is what lets the extension track
// the language as it evolves in-tree. `resolveExtensions` mirrors
// `scripts/build.mjs`: the engine's imports carry a `.js` suffix that has to
// resolve to the `.ts` file next to it.

import * as esbuild from 'esbuild';
import { copyFile, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

// The engine's version, stamped into the CLI bundle the same way the main
// build does it (`scripts/build.sh` substitutes `{{SDK_VERSION}}` in dist).
const SDK_VERSION = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
).version;

// Runs after every (re)build of the CLI bundle, including in watch mode:
// stamp the version placeholder and put the agent-facing language card next
// to the bundle, where the CLI's `loadCard` looks for it.
const CLI_FINALIZE = {
  name: 'cli-finalize',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      const bundle = await readFile('./dist/cli.mjs', 'utf8');
      await writeFile(
        './dist/cli.mjs',
        bundle.replaceAll('{{SDK_VERSION}}', SDK_VERSION)
      );
      await copyFile('../src/epsil/docs/for-agents.md', './dist/for-agents.md');
    });
  },
};

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
    // The DAP endpoint only — the engine lives in the worker bundle.
    external: [],
  },
  {
    ...COMMON,
    entryPoints: ['./src/debug-worker.ts'],
    outfile: './dist/debug-worker.js',
    // The debuggee: engine bundled from repo source, like the server.
    external: [],
  },
  {
    ...COMMON,
    entryPoints: ['./src/inline-runner.ts'],
    outfile: './dist/inline-runner.js',
    // Inline-results runner: engine bundled from repo source.
    external: [],
  },
  {
    ...COMMON,
    entryPoints: ['../src/cli/epsil.ts'],
    outfile: './dist/cli.mjs',
    // The CLI that `Epsil: Run File` executes with `node` in the integrated
    // terminal, so it runs the same engine build as the language server,
    // inline results, and the debugger. ESM, not CJS like the other
    // bundles: the entry uses top-level await and `import.meta.url`.
    format: 'esm',
    external: [],
    plugins: [CLI_FINALIZE],
  },
];

if (watch) {
  const contexts = await Promise.all(CONFIGS.map((x) => esbuild.context(x)));
  await Promise.all(contexts.map((x) => x.watch()));
  console.log('Watching for changes...');
} else {
  await Promise.all(CONFIGS.map((x) => esbuild.build(x)));
}
