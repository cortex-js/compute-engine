import { spawnSync } from 'node:child_process';
import {
  existsSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import pkg from '../package.json' with { type: 'json' };
const manifestPath = 'dist/types/.outputs.json';
let outputs;
try {
  outputs = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {
  /* First build or clean. */
}
// Declaration literals are stamped by the build, so a version change must re-emit them.
if (
  outputs?.version !== pkg.version ||
  !outputs?.files.every((path) => existsSync(path))
)
  rmSync('dist/types/.tsbuildinfo', { force: true });
let compiler;
try {
  compiler = join(
    dirname(require.resolve('@typescript/native/package.json')),
    'bin/tsc'
  );
} catch {
  const git = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' }
  );
  if (git.status !== 0) throw new Error('Cannot locate TypeScript; run npm ci');
  compiler = join(
    dirname(git.stdout.trim()),
    'node_modules/@typescript/native/bin/tsc'
  );
}
const result = spawnSync(
  process.execPath,
  [compiler, '-p', 'tsconfig.types.json'],
  { stdio: 'inherit' }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (!process.exitCode) {
  const files = readdirSync('dist/types', { recursive: true })
    .filter((path) => path.endsWith('.d.ts'))
    .map((path) => `dist/types/${path}`);
  writeFileSync(manifestPath, JSON.stringify({ version: pkg.version, files }));
  console.log('PASS types');
}
