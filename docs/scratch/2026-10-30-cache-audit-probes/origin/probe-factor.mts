// Origin case of FACTOR_MEMO (boxed-expression/factor.ts, commit 458389f6c,
// 2026-09-22; comment at the declaration; test
// factor-nested-quotients.test.ts "the nested-radical derivative witness"):
// derivatives of f(x) = √(x+√(x+√(x+√(x+x)))). Without the memo the 2nd
// derivative factored 20,678 expressions (51 distinct), the 3rd 1,166,395.
// A new engine per run, as in the test (the memo is per engine).
import { ComputeEngine } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine.ts';
import { factorComputationCount } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine/boxed-expression/factor.ts';
import { measure } from './harness.mts';

const ORDER = Number(process.env.FACTOR_ORDER ?? 2);
const F = '\\sqrt{x+\\sqrt{x+\\sqrt{x+\\sqrt{x+x}}}}';

await measure(
  `factor-nested-radical-derivative order=${ORDER}`,
  () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse(`x \\mapsto ${F}`));
    return ce;
  },
  (ce) => {
    const before = factorComputationCount();
    const d = ce.box(['Derivative', 'f', ORDER]).evaluate();
    const v1 = ce.box(['Apply', d, 0.7]).N().re;
    const v2 = ce.box(['Apply', d, 2.3]).N().re;
    console.error(`factorizations=${factorComputationCount() - before}`);
    return `${d.toString()}\n${v1}\n${v2}`;
  }
);
