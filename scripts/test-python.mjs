import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const python = process.env.CE_PYTHON || resolve('venv/bin/python3');
if (!existsSync(python))
  throw new Error('Set CE_PYTHON to a Python interpreter with NumPy and SciPy');
const probe = spawnSync(python, ['-c', 'import numpy, scipy'], {
  stdio: 'inherit',
});
if (probe.error || probe.status !== 0)
  throw new Error('Python requires NumPy and SciPy');
const files = readdirSync('test/compute-engine')
  .filter(
    (name) =>
      name.endsWith('.test.ts') &&
      /(?:from|import).*test-python/.test(
        readFileSync(`test/compute-engine/${name}`, 'utf8')
      )
  )
  .map((name) => `test/compute-engine/${name}`);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/jest/bin/jest.js',
    '--runTestsByPath',
    ...files,
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, CE_TEST_PYTHON: '1', CE_PYTHON: python },
  }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
