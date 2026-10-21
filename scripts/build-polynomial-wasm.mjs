import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Install the pinned compiler separately: npm install --prefix
// build/factoring-toolchain --ignore-scripts assemblyscript@0.28.9
const compiler = resolve(
  'build/factoring-toolchain/node_modules/assemblyscript/bin/asc.js'
);
mkdirSync('build/polynomial-wasm', { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    compiler,
    'wasm/polynomial/assembly/index.ts',
    '--outFile',
    'build/polynomial-wasm/factor.wasm',
    '--optimize',
    '--exportRuntime',
    '--runtime',
    'incremental',
    '--maximumMemory',
    '512',
  ],
  { stdio: 'inherit' }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
