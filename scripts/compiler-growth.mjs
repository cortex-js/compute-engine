#!/usr/bin/env node
/**
 * compiler-growth.mjs — measure the two numbers of the compiler growth guard
 * in the current tree, and print them as one line of JSON:
 *
 *   {"compilerCodeLines":95413,"compileDepthLimit":344,"depthRuns":2,"depthSeconds":11.8}
 *
 *   node scripts/compiler-growth.mjs [--depth-hint <n>] [--no-depth]
 *
 * `scripts/ci-nightly.sh` runs it after the full suite and keeps the result
 * with the run. `~/.claude/scripts/suite-status.mjs` reports a rise of the
 * first number or a fall of the second between two runs.
 *
 * compilerCodeLines: the lines of the `.ts` files under
 * `src/compute-engine/compilation` that are not blank and do not start
 * (after white space) with `//`, `*` or `/*`. This is the count of
 * `docs/plans/2026-11-01-language-axes-survey.md` §1 (95,413 lines at commit
 * d83338f6699c4959e27dab87f6639bd91c462624). A line that has code before a
 * comment counts; a line inside a block comment that does not start with
 * `*` counts too.
 *
 * compileDepthLimit: the deepest `Sin`/`Cos` chain that compiles when its
 * compile is the first compile in a warm Jest worker. The compiler is
 * recursive, and that first compile has the smallest stack budget (the
 * comment in `test/compute-engine/compile-deep-nesting.test.ts` explains
 * why). Each step of the search is one Jest run, with one worker process,
 * of a few compile test files followed by
 * `test/compute-engine/probes/compile-depth-probe.test.ts`, which compiles
 * one chain of the depth under test. `--workerIdleMemoryLimit` makes Jest
 * use a worker process even with one worker: without it Jest runs the files
 * in its own process, where the limit differs (on 2026-11-02, 354 in that
 * process and 343 in a worker). The search tests the hint (the limit of the
 * previous run) and the hint plus one first: when the limit did not change,
 * that is two Jest runs. Otherwise it widens the range and bisects it to
 * one level.
 *
 * On 2026-11-02 at d83338f6699c4959e27dab87f6639bd91c462624, with the 3
 * warm-up files that this script uses, the limit was 344 (345 failed) in
 * seven searches out of seven. With 0, 5 or 20 warm-up files it was 343 in
 * every search. So the result repeats exactly for one set of warm-up files,
 * and a change of one level between two runs with the same files is a real
 * change. A change of the warm-up files (a compile test file added or
 * renamed at the start of the path order) can move it by one level. The
 * test's own comment gives 325 (passed) and 350 (failed) for the full
 * compile suite on two workers, which agrees.
 *
 * Cost on 2026-11-02 (Apple M5 Max): one Jest run takes
 * about 2.5 s; with the hint of the previous run, the search takes 2 runs
 * (about 5 s) when the limit did not change, and 13 to 14 runs (about 35 s)
 * without a hint or with a hint 44 levels off.
 *
 * A number that could not be measured is `null`, and the reason is printed
 * on stderr. The exit code is 0 unless the arguments are wrong.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const COMPILER_DIR = join(ROOT, 'src/compute-engine/compilation');
const PROBE = 'test/compute-engine/probes/compile-depth-probe.test.ts';
const SEQUENCER = join(ROOT, 'scripts/compiler-growth-sequencer.cjs');
// The warm-up files: the first WARMUP_FILES compile test files in path
// order. Their number and choice did not change the limit on 2026-11-02;
// they are there so that the probe's compile is not the first work of the
// worker, as in the full suite.
const WARMUP_FILES = 3;
// The search range when there is no hint.
const LOW = 50;
const HIGH = 3000;
// The time limit of one run. One run takes about 2.5 s.
const RUN_TIMEOUT_MS = 60_000;
// The time limit of the whole depth search. One search takes about 5 s with a
// correct hint and about 35 s without one. The budget only stops a search on a
// broken or very slow machine, so that it cannot push the nightly run past its
// deadline.
const DEPTH_BUDGET_MS = 300_000;
let searchStart = Date.now();

const args = process.argv.slice(2);
let hint;
let measureDepth = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--no-depth') measureDepth = false;
  else if (args[i] === '--depth-hint') hint = Number(args[++i]);
  else {
    console.error(`compiler-growth: unknown argument ${args[i]}`);
    process.exit(2);
  }
}
if (hint !== undefined && !(Number.isInteger(hint) && hint > 0))
  hint = undefined;

/** The `.ts` files under `dir`, recursively. */
function tsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return tsFiles(p);
    return d.isFile() && d.name.endsWith('.ts') ? [p] : [];
  });
}

function codeLines() {
  let n = 0;
  for (const file of tsFiles(COMPILER_DIR))
    for (const line of readFileSync(file, 'utf8').split('\n'))
      if (!/^\s*($|\/\/|\*|\/\*)/.test(line)) n++;
  return n;
}

const tmp = mkdtempSync(join(tmpdir(), 'compiler-growth-'));
let runs = 0;
// The process group of the Jest run in progress, or 0.
let activeGroup = 0;

// A signal (the nightly run's deadline, Ctrl-C) stops this script. The Jest
// run is in a process group of its own (see runGroup), so the signal that
// stops the nightly run does not reach it: kill it here, and remove the
// temporary folder, before the script ends.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (activeGroup) {
      try {
        process.kill(-activeGroup, 'SIGKILL');
      } catch {}
    }
    rmSync(tmp, { recursive: true, force: true });
    process.exit(128 + os.constants.signals[signal]);
  });
}

/**
 * Runs `command` in a process group of its own, and waits at most
 * `timeoutMs` for it. Then it kills the whole group: a time limit on the
 * Jest process alone would leave its worker process alive when the worker
 * is stuck in a synchronous compile, and that worker would keep a core busy
 * after the nightly run has released the box lock. The group is killed
 * after a normal end too, which does nothing when no process is left.
 */
function runGroup(command, args, options, timeoutMs) {
  return new Promise((done) => {
    const child = spawn(command, args, { ...options, detached: true });
    activeGroup = child.pid ?? 0;
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const killGroup = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    const timer = setTimeout(killGroup, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      activeGroup = 0;
      done({ status: null, signal: null, output: e.message });
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      killGroup();
      activeGroup = 0;
      done({ status, signal, output });
    });
  });
}

/** One Jest run: true when a chain of `depth` levels compiled. */
async function compiles(depth, warmup) {
  const remaining = DEPTH_BUDGET_MS - (Date.now() - searchStart);
  if (remaining <= 0)
    throw new Error(
      `the depth search took longer than ${DEPTH_BUDGET_MS / 1000} s; stopped`
    );
  runs++;
  const out = join(tmp, `probe-${runs}.txt`);
  const r = await runGroup(
    process.execPath,
    [
      join(ROOT, 'node_modules/jest/bin/jest.js'),
      '--config',
      './config/jest.config.cjs',
      '-w',
      '1',
      '--workerIdleMemoryLimit=8GB',
      '--testSequencer',
      SEQUENCER,
      '--',
      ...warmup,
      PROBE,
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        CE_COMPILE_DEPTH_PROBE: String(depth),
        CE_COMPILE_DEPTH_PROBE_OUT: out,
      },
    },
    Math.min(RUN_TIMEOUT_MS, remaining)
  );
  let line = '';
  try {
    line = readFileSync(out, 'utf8').trim();
  } catch {}
  if (line === `${depth} ok`) return true;
  if (line === `${depth} fail`) return false;
  const tail = r.output.trim().split('\n').slice(-15).join('\n');
  throw new Error(
    `the probe at depth ${depth} gave no result (status ${r.status}, signal ${r.signal ?? 'none'})\n${tail}`
  );
}

/** The deepest chain that compiles, by a search that starts at `hint`. */
async function depthLimit() {
  const warmup = readdirSync(join(ROOT, 'test/compute-engine'))
    .filter(
      (f) =>
        /^compile-.*\.test\.ts$/.test(f) && f !== 'compile-deep-nesting.test.ts'
    )
    .sort()
    .slice(0, WARMUP_FILES)
    .map((f) => `test/compute-engine/${f}`);
  // lo compiles and hi does not.
  let lo;
  let hi;
  if (hint !== undefined) {
    if (await compiles(hint, warmup)) {
      lo = hint;
      if (!(await compiles(hint + 1, warmup))) return hint;
      lo = hint + 1;
      // Widen upward by doubling the step.
      let step = 2;
      for (;;) {
        const d = hint + step;
        if (d >= HIGH) {
          if (await compiles(HIGH, warmup)) return HIGH;
          hi = HIGH;
          break;
        }
        if (await compiles(d, warmup)) lo = d;
        else {
          hi = d;
          break;
        }
        step *= 2;
      }
    } else {
      hi = hint;
      let step = 1;
      for (;;) {
        const d = hint - step;
        if (d <= LOW) {
          if (!(await compiles(LOW, warmup)))
            throw new Error(`a chain of ${LOW} levels does not compile`);
          lo = LOW;
          break;
        }
        if (await compiles(d, warmup)) {
          lo = d;
          break;
        }
        hi = d;
        step *= 2;
      }
    }
  } else {
    if (!(await compiles(LOW, warmup)))
      throw new Error(`a chain of ${LOW} levels does not compile`);
    if (await compiles(HIGH, warmup)) return HIGH;
    lo = LOW;
    hi = HIGH;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await compiles(mid, warmup)) lo = mid;
    else hi = mid;
  }
  return lo;
}

const result = {
  compilerCodeLines: null,
  compileDepthLimit: null,
  depthRuns: 0,
  depthSeconds: 0,
};
try {
  result.compilerCodeLines = codeLines();
} catch (e) {
  console.error(
    `compiler-growth: could not count the code lines: ${e.message}`
  );
}
if (measureDepth) {
  searchStart = Date.now();
  try {
    result.compileDepthLimit = await depthLimit();
  } catch (e) {
    console.error(
      `compiler-growth: could not measure the compile depth limit: ${e.message}`
    );
  }
  result.depthRuns = runs;
  result.depthSeconds = Math.round((Date.now() - searchStart) / 100) / 10;
}
rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify(result));
