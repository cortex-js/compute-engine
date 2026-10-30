// Origin case of `approximations` (boxed-expression/compare.ts, commit
// 5e29489a6, 2026-09-24): `Sort` of exact constants that are closer than the
// rounding error of the working precision, so `exactOrder` compares them at
// a raised precision (`orderAtRaisedPrecision`) and alternates between two
// keys. Test of the same commit: exact-ordering-fixes.test.ts, "TWO RADICALS
// CLOSER THAN THE PRECISION" (√(2 + 10⁻³⁰) vs √2).
// The approximations are keyed by the expression object, so a new list is
// boxed for each run (outside the timer).
import { ComputeEngine } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine.ts';
import { measure } from './harness.mts';

const N = Number(process.env.APPROX_N ?? 24);
// A fixed permutation of 0..N-1.
const perm = Array.from({ length: N }, (_, k) => (k * 7 + 3) % N);
const elements = perm.map((k) => ['Sqrt', ['Add', 2, ['Multiply', k, ['Power', 10, -30]]]]);
// Far-apart constants too: the common case of the cache.
const spread = perm.map((k) => ['Add', ['Sqrt', k + 2], ['Ln', k + 2]]);

const ce = new ComputeEngine();
await measure(
  `approx-sort-close N=${N}`,
  () => ({
    close: ce.box(['Sort', ['List', ...elements]]),
    spread: ce.box(['Sort', ['List', ...spread]]),
    max: ce.box(['Max', ...elements]),
  }),
  (s) => {
    const a = s.close.evaluate();
    const b = s.spread.evaluate();
    const c = s.max.evaluate();
    return [a, b, c].map((x) => x.toString()).join('\n');
  }
);
