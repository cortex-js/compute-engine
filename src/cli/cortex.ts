#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

import { main } from './main.js';

process.exitCode = await main(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  // The language card ships beside the CLI bundle (`dist/*/cli/`); the
  // second candidate covers running the CLI from source with tsx.
  loadCard: async () => {
    for (const candidate of [
      new URL('./for-agents.md', import.meta.url),
      new URL('../cortex/docs/for-agents.md', import.meta.url),
    ]) {
      try {
        return await readFile(candidate, 'utf8');
      } catch {
        // Try the next location.
      }
    }
    throw new Error('The language card (for-agents.md) was not found.');
  },
});
