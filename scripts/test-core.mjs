import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = readFileSync(
  new URL('../config/core-tests.txt', import.meta.url),
  'utf8'
)
  .split(/\r?\n/)
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter(Boolean);
if (!files.length)
  throw new Error('config/core-tests.txt contains no test files');
for (const file of files) {
  if (!existsSync(new URL(`../${file}`, import.meta.url)))
    throw new Error(`Missing core test: ${file}`);
}
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/jest/bin/jest.js', import.meta.url)),
    '--maxWorkers=4',
    '--runTestsByPath',
    ...files,
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit' }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
