#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

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
