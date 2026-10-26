import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

if (process.versions.node.split('.')[0] !== '26')
  throw new Error(
    'Group-theory validation requires Node 26; current runtime: ' +
      process.version
  );
const root = fileURLToPath(new URL('../../', import.meta.url));
const env = {
  ...process.env,
  PATH: dirname(process.execPath) + delimiter + process.env.PATH,
};
const mode = process.argv[2] ?? 'test';
console.log(
  JSON.stringify({ node: process.version, v8: process.versions.v8, mode })
);
function run(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (mode === 'test') {
  const tests = readdirSync(join(root, 'test/compute-engine')).filter((x) =>
    /^group-theory-.*\.test\.ts$/.test(x)
  );
  run(process.execPath, [
    'node_modules/jest/bin/jest.js',
    '--config',
    'config/jest.config.cjs',
    '--runInBand',
    '--reporters=default',
    '--runTestsByPath',
    ...tests.map((x) => 'test/compute-engine/' + x),
  ]);
} else if (mode === 'typecheck') {
  run(
    process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash',
    ['scripts/typecheck.sh']
  );
} else if (mode === 'bench' || mode === 'smoke') {
  const directory = mkdtempSync(join(tmpdir(), 'epsil-group-node26-'));
  const output = join(directory, mode + '.mjs');
  await build({
    absWorkingDir: root,
    entryPoints: [
      'scripts/group-theory/' +
        (mode === 'bench' ? 'benchmark.ts' : 'runtime-smoke.ts'),
    ],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    minify: true,
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  run(process.execPath, [output, ...process.argv.slice(3)]);
} else throw new Error('Expected test, typecheck, bench or smoke');
