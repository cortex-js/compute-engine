import { mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Install the pinned compiler separately: npm install --prefix
// build/factoring-toolchain --ignore-scripts assemblyscript@0.28.9
const compiler = resolve(
  'build/factoring-toolchain/node_modules/assemblyscript/bin/asc.js'
);
const compilerRoot = resolve(
  'build/factoring-toolchain/node_modules/assemblyscript'
);
if (
  JSON.parse(readFileSync(resolve(compilerRoot, 'package.json'), 'utf8'))
    .version !== '0.28.9'
)
  throw new Error('Expected AssemblyScript 0.28.9');
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
if (result.status === 0) {
  // The kernel algorithm is first-party; compiled runtime support retains
  // AssemblyScript's license and attribution alongside the optional binary.
  copyFileSync(
    resolve(compilerRoot, 'LICENSE'),
    'build/polynomial-wasm/ASSEMBLYSCRIPT-LICENSE'
  );
  copyFileSync(
    resolve(compilerRoot, 'NOTICE'),
    'build/polynomial-wasm/ASSEMBLYSCRIPT-NOTICE'
  );
  copyFileSync('LICENSE', 'build/polynomial-wasm/LICENSE');
}
process.exitCode = result.status ?? 1;
