#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { AgentCard } from './io.js';
import { main } from './main.js';

// Each card ships beside the CLI bundle (`dist/*/cli/`); the second
// candidate covers running the CLI from source with tsx.
const CARD_FILES: Record<AgentCard, [bundled: string, source: string]> = {
  'epsil': ['./for-agents.md', '../epsil/docs/for-agents.md'],
  'compute-engine': [
    './compute-engine-for-agents.md',
    '../compute-engine/docs/for-agents.md',
  ],
};

// The kernel-worker bundle is a sibling of the `cli/` directory
// (`dist/*/kernel-worker.js`); the second candidate covers running the CLI
// from source with tsx, whose loader the worker inherits from the options of
// the process (`process.execArgv`).
const KERNEL_WORKER_FILES = ['../kernel-worker.js', '../kernel-worker.ts'];

function kernelWorkerUrl(): URL {
  for (const candidate of KERNEL_WORKER_FILES) {
    const url = new URL(candidate, import.meta.url);
    if (existsSync(fileURLToPath(url))) return url;
  }
  throw new Error('The kernel-worker file was not found.');
}

process.exitCode = await main(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  loadCard: async (card) => {
    for (const candidate of CARD_FILES[card]) {
      try {
        return await readFile(new URL(candidate, import.meta.url), 'utf8');
      } catch {
        // Try the next location.
      }
    }
    throw new Error(`The ${card} card for agents was not found.`);
  },
  createWorker: () => {
    const worker = new Worker(kernelWorkerUrl());
    return {
      postMessage: (message, transfer) => worker.postMessage(message, transfer),
      terminate: () => worker.terminate(),
      on: (event, handler) => worker.on(event, handler),
    };
  },
  installedVersion: () => {
    // The package root is three levels above the bundle (`dist/*/cli/`) and
    // two above the source (`src/cli/`).
    for (const candidate of ['../../../package.json', '../../package.json']) {
      try {
        const manifest = JSON.parse(
          readFileSync(new URL(candidate, import.meta.url), 'utf8')
        ) as { name?: unknown; version?: unknown };
        if (
          manifest.name === '@cortex-js/compute-engine' &&
          typeof manifest.version === 'string'
        )
          return manifest.version;
      } catch {
        // Try the next location.
      }
    }
    return undefined;
  },
});
