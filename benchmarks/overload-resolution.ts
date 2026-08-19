/**
 * Overload-resolution microbenchmark — the per-call cost of applying an
 * operator whose signature is an OVERLOAD SET (an intersection of function
 * signatures), across arm counts and operand categories.
 *
 * A SELF-comparison harness (like `effects-registration.ts`): run it on two
 * builds of the engine and compare. It is the microbenchmark half of the
 * phase-2c perf gate in `docs/TYPE-SYSTEM.md`
 * ("trial-based overload resolution"): the gate requires the per-call cost
 * after the trial mechanism to stay ≤ 2× the write-free-filter baseline,
 * measured here, and the canonicalization corpus (`effects-registration.ts`)
 * to regress ≤ 3% median.
 *
 * Scenarios: overload sets of 2 / 4 / 8 arms × operand categories —
 *   exact      the operand's type is exactly the most-specific arm's param
 *   subtype    the operand is a strict subtype of the matching arm's param
 *   inferred   an inferred (undeclared) symbol operand, narrowed by the call
 *   generic    the set's arms carry `where` clauses (per-call instantiation)
 *   rejected   no arm admits the operand (the diagnosis path)
 * plus a single-signature control (`plain`) and a plain-boxing canary, so a
 * generic boxing/canonicalization regression can be told apart from one in
 * resolution itself.
 *
 * Protocol: for each scenario, WARM-UP once, then time RUNS runs of ITERS
 * calls each and report the MEDIAN run, in µs/call. Each call re-boxes its
 * MathJSON input (`ce.box(...)` — function expressions are never interned, so
 * every call performs real canonicalization + validation).
 *
 *   npx tsx benchmarks/overload-resolution.ts            # RUNS=5 ITERS=2000
 *   RUNS=7 ITERS=5000 npx tsx benchmarks/overload-resolution.ts
 */

import { ComputeEngine } from '../src/compute-engine';
import type { MathJsonExpression } from '../src/math-json/types';

const RUNS = Number(process.env.RUNS ?? 5);
const ITERS = Number(process.env.ITERS ?? 2000);

/** Ground overload arms, most specific last so declaration order is not the
 * trivial winner. Arity-1 except two arity-2 arms in the 8-arm set, so the
 * arity filter does real work there. */
const ARMS_2 = '((integer) -> integer) & ((string) -> string)';
const ARMS_4 =
  '((integer) -> integer) & ((string) -> string) & ' +
  '((boolean) -> boolean) & ((list<integer>) -> integer)';
const ARMS_8 =
  '((integer) -> integer) & ((string) -> string) & ' +
  '((boolean) -> boolean) & ((list<integer>) -> integer) & ' +
  '((real) -> real) & ((tuple<integer, integer>) -> integer) & ' +
  '((real, real) -> real) & ((string, string) -> string)';
/** Generic sets, one per arm count: instantiation + (after 2c) trials on
 * solved instances. All unary so the measured growth is the per-arm
 * solve/trial cost, not an arity mix. */
const ARMS_GENERIC_2 =
  '((T) -> T where T: integer) & ((U) -> U where U: string)';
const ARMS_GENERIC_4 =
  ARMS_GENERIC_2 +
  ' & ((V) -> V where V: boolean) & ((W) -> W where W: list<integer>)';
const ARMS_GENERIC_8 =
  ARMS_GENERIC_4 +
  ' & ((X) -> X where X: real) & ((Y) -> Y where Y: tuple<integer, integer>)' +
  ' & ((Z) -> Z where Z: set<real>) & ((C) -> C where C: collection)';
const PLAIN = '(integer) -> integer';

type Scenario = {
  name: string;
  signature: string;
  /** MathJSON input boxed on every iteration. */
  input: () => MathJsonExpression;
  /** Extra per-engine setup (operand declarations). */
  setup?: (ce: ComputeEngine) => void;
};

function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const [label, signature] of [
    ['2-arm', ARMS_2],
    ['4-arm', ARMS_4],
    ['8-arm', ARMS_8],
  ] as const) {
    // exact: integer literal → the integer arm.
    out.push({ name: `${label} exact`, signature, input: () => ['f', 7] });
    // subtype: operand declared at a strict subtype of the matching param.
    out.push({
      name: `${label} subtype`,
      signature,
      setup: (ce) => ce.declare('k', 'integer<0..10>'),
      input: () => ['f', 'k'],
    });
    // inferred: an undeclared symbol, narrowed by the call. Declared fresh
    // once per engine; after the first call the narrow is a no-op re-check,
    // which is the steady-state cost of symbol-heavy corpora.
    out.push({
      name: `${label} inferred`,
      signature,
      input: () => ['f', 'y'],
    });
    // rejected: no arm admits a function-typed operand — diagnosis path.
    out.push({
      name: `${label} rejected`,
      signature,
      setup: (ce) => ce.declare('g', '(number) -> number'),
      input: () => ['f', 'g'],
    });
  }
  for (const [label, signature] of [
    ['2-arm generic', ARMS_GENERIC_2],
    ['4-arm generic', ARMS_GENERIC_4],
    ['8-arm generic', ARMS_GENERIC_8],
  ] as const)
    out.push({ name: label, signature, input: () => ['f', 7] });
  out.push({
    name: 'plain control',
    signature: PLAIN,
    input: () => ['f', 7],
  });
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function timeScenario(s: Scenario): number {
  // One engine per scenario: declaration cost is outside the timed region,
  // and inference writes (the `inferred` category) reach a steady state
  // during warm-up rather than polluting run-to-run variance.
  const ce = new ComputeEngine();
  ce.declare('f', s.signature as Parameters<typeof ce.declare>[1]);
  s.setup?.(ce);
  const input = s.input();

  // Warm-up (JIT + first-call inference writes).
  for (let i = 0; i < Math.min(ITERS, 500); i++) ce.box(input);

  const runs: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    for (let i = 0; i < ITERS; i++) ce.box(input);
    runs.push(((performance.now() - t0) / ITERS) * 1000); // µs/call
  }
  return median(runs);
}

function timeBoxingCanary(): number {
  const ce = new ComputeEngine();
  const input: MathJsonExpression = ['Add', 'x', ['Multiply', 2, 'y'], 1];
  for (let i = 0; i < Math.min(ITERS, 500); i++) ce.box(input);
  const runs: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    for (let i = 0; i < ITERS; i++) ce.box(input);
    runs.push(((performance.now() - t0) / ITERS) * 1000);
  }
  return median(runs);
}

console.log(
  `overload-resolution microbenchmark — median of ${RUNS} runs × ${ITERS} calls, µs/call`
);
console.log('');
const rows: [string, number][] = [];
for (const s of scenarios()) rows.push([s.name, timeScenario(s)]);
rows.push(['boxing canary (Add/Mul)', timeBoxingCanary()]);
const width = Math.max(...rows.map(([n]) => n.length));
for (const [name, us] of rows)
  console.log(`${name.padEnd(width)}  ${us.toFixed(2)} µs/call`);
