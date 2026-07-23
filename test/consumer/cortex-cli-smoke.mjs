#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'dist', 'esm-min', 'cli', 'cortex.js');
const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')
).version;

if (!existsSync(CLI)) fail(`${CLI} not found. Run the production build first.`);
if ((statSync(CLI).mode & 0o111) === 0) fail('CLI bundle is not executable.');

expectRun(['--version'], { stdout: `${PACKAGE_VERSION}\n` });
expectRun(['-e', 'let x = 1/2\nx + 1'], { stdout: '3/2\n' });
expectRun(['--json', '-e', '1/2 + 1'], {
  stdout: '[\n  "Rational",\n  3,\n  2\n]\n',
});
expectRun([], { input: 'let x = 3\nx^2\n', stdout: '9\n' });

const tempDirectory = mkdtempSync(join(tmpdir(), 'cortex-cli-smoke-'));
try {
  const sourceFile = join(tempDirectory, 'program.cx');
  writeFileSync(sourceFile, 'let radius = 3\nPi * radius^2\n');
  expectRun(['--cortex', sourceFile], { stdout: '9Pi\n' });
} finally {
  rmSync(tempDirectory, { recursive: true });
}

const syntaxError = run(['-e', '1 +']);
if (syntaxError.status !== 1)
  fail(`syntax error exited ${syntaxError.status}, expected 1`);
if (!syntaxError.stderr.includes('Unexpected symbol "+"'))
  fail(`syntax error diagnostic missing:\n${syntaxError.stderr}`);

console.log('cortex-cli-smoke: PASSED');

function expectRun(args, expected) {
  const result = run(args, expected.input);
  if (result.status !== 0)
    fail(
      `${args.join(' ')} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  if (result.stdout !== expected.stdout)
    fail(
      `${args.join(' ')} stdout mismatch\nexpected:\n${expected.stdout}\nactual:\n${result.stdout}`
    );
  if (result.stderr !== '')
    fail(`${args.join(' ')} wrote stderr:\n${result.stderr}`);
}

function run(args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    input,
    encoding: 'utf8',
  });
}

function fail(message) {
  console.error(`cortex-cli-smoke: FAILED — ${message}`);
  process.exit(1);
}
