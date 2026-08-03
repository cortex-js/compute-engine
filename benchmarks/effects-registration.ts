/**
 * Engine-configuration microbenchmark: the "document manager" shape.
 *
 * Reproduces the convert-time cost profile a host reports when it configures an
 * engine the way a notebook/document manager does — NOT the raw-row shape a
 * fresh engine sees:
 *
 *   1. **registration** — ~120 interdependent user functions registered by
 *      `declare(name, { signature })` followed by `assign(name, lambda)`, each
 *      body calling the previously registered ones (call chains 5–10 deep);
 *   2. **composition rows** — re-parsing/canonicalizing rows that apply those
 *      functions (`M(u,v) · R_3(…)`), the shape whose per-row cost regressed;
 *   3. **seeded-random rows** — `WithRandomSeed(seed, RandomChoice(…))` rows,
 *      which exercise the frame/discharge paths of the effect channel;
 *   4. **re-registration** — the document lifecycle: pop the scope, push a
 *      fresh one, and register everything again.
 *
 * Plus a **box microloop canary** (the ≈0.02 ms/iter plain-boxing baseline), so
 * a regression in generic boxing can be told apart from one in the effect
 * channel.
 *
 * Run: `npx tsx benchmarks/effects-registration.ts`
 * Env: `ROUNDS` (default 7), `FNS` (default 120), `ROWS` (default 40).
 */

import { ComputeEngine } from '../src/compute-engine.js';
import type { MathJsonExpression } from '../src/math-json/types.js';

const ROUNDS = Number(process.env.ROUNDS ?? 7);
const FNS = Number(process.env.FNS ?? 120);
const ROWS = Number(process.env.ROWS ?? 40);

/** Wall-clock ms of `fn`. */
function time(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** The LaTeX body of function `i`: a two-argument function calling the two
 * previously registered ones, so a call chain is as deep as the index. */
function body(i: number): string {
  if (i === 0) return '(u, v) \\mapsto u + v';
  if (i === 1) return '(u, v) \\mapsto f_0(u, v) \\cdot 2 + v';
  return `(u, v) \\mapsto f_{${i - 1}}(u + 1, v) + f_{${i - 2}}(u, 2v) \\cdot u`;
}

/** A composition row: a product of applications of deeply nested functions. */
function compositionRow(i: number): string {
  const a = FNS - 1 - (i % 12);
  const b = FNS - 5 - (i % 7);
  const c = FNS - 9 - (i % 5);
  return `f_{${a}}(u, v) \\cdot f_{${b}}(v, u) + f_{${c}}(u + v, u v)`;
}

/** A seeded-random row: the draw is wrapped in applications of the registered
 * functions, so the discharge/frame paths of the effect channel run over a
 * subtree of user-function heads rather than over a bare `RandomChoice`. */
function seedRow(i: number): MathJsonExpression {
  const a = FNS - 1 - (i % 9);
  const b = FNS - 4 - (i % 6);
  return [
    'WithRandomSeed',
    17 + i,
    [
      `f_${a}`,
      ['RandomChoice', ['List', 1, 2, 3, 5, 8, 13], 2],
      [`f_${b}`, ['Random'], 3],
    ],
  ];
}

function register(ce: ComputeEngine): void {
  for (let i = 0; i < FNS; i++) {
    const name = `f_${i}`;
    ce.declare(name, { signature: '(number, number) -> number' });
    ce.assign(name, ce.parse(body(i)));
  }
}

const results: Record<string, number[]> = {
  registration: [],
  compositionRows: [],
  seedRows: [],
  reRegistration: [],
  boxMicroloop: [],
};

for (let round = 0; round < ROUNDS; round++) {
  const ce = new ComputeEngine();

  results.registration.push(time(() => register(ce)));

  results.compositionRows.push(
    time(() => {
      for (let i = 0; i < ROWS; i++) {
        const row = ce.parse(compositionRow(i));
        // A host asks these two questions of every row it converts.
        row.type;
        row.isPure;
      }
    })
  );

  results.seedRows.push(
    time(() => {
      for (let i = 0; i < ROWS; i++) {
        const row = ce.box(seedRow(i));
        row.type;
        row.isPure;
      }
    })
  );

  results.reRegistration.push(
    time(() => {
      ce.popScope();
      ce.pushScope();
      register(ce);
    })
  );

  // Canary: plain boxing must stay at the ≈0.02 ms/iter baseline.
  const N = 500;
  results.boxMicroloop.push(
    time(() => {
      for (let i = 0; i < N; i++)
        ce.box(['Add', ['Multiply', 2, 'x'], ['Power', 'y', 3], i]);
    }) / N
  );
}

const label: Record<string, string> = {
  registration: `registration (${FNS} fns)`,
  compositionRows: `composition rows (${ROWS})`,
  seedRows: `WithRandomSeed rows (${ROWS})`,
  reRegistration: `re-registration (${FNS} fns)`,
  boxMicroloop: 'box microloop (ms/iter)',
};

process.stdout.write(
  `\nEngine-configuration benchmark — ${ROUNDS} rounds, warm median\n\n`
);
for (const key of Object.keys(results)) {
  const xs = results[key];
  const unit = key === 'boxMicroloop' ? '' : ' ms';
  process.stdout.write(
    `  ${label[key].padEnd(28)} ${median(xs).toFixed(key === 'boxMicroloop' ? 4 : 1)}${unit}` +
      `   (min ${Math.min(...xs).toFixed(key === 'boxMicroloop' ? 4 : 1)}, max ${Math.max(...xs).toFixed(key === 'boxMicroloop' ? 4 : 1)})\n`
  );
}
process.stdout.write('\n');
