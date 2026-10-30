// Origin case of probeCache (symbolic/limit.ts, commit a2b789283,
// 2026-07-02): nested-exponential (Gruntz-class) limits, whose growth
// probes were moved from BigDecimal `.N()` to compiled machine floats
// ("~18 minutes of CPU to ~4 ms"). Tests of the commit: Gruntz #1 and #2
// (calculus/limit tests, "HARD GRUNTZ LIMITS RESPECT THE DEADLINE"); and
// ce-601-shared-evaluation.test.ts "One Limit compiles each probe once"
// (ln(ln x)/ln x). The cache keeps the compiled probe of each expression;
// with it off, the probe is compiled again at each probe point.
// A new engine per run; the time limit is 2 s per limit, as in the test.
import { ComputeEngine } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine.ts';
import * as limitModule from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine/symbolic/limit.ts';
import { measure } from './harness.mts';

const gruntz1 = ['Divide', ['Subtract', ['Exp', ['Divide', ['Multiply', 'x', ['Exp', ['Negate', 'x']]], ['Add', ['Exp', ['Negate', 'x']], ['Exp', ['Divide', ['Multiply', -2, ['Power', 'x', 2]], ['Add', 'x', 1]]]]]], ['Exp', 'x']], 'x'];
const gruntz2 = ['Divide', ['Multiply', 'x', ['Ln', 'x'], ['Power', ['Ln', ['Subtract', ['Multiply', 'x', ['Exp', 'x']], ['Power', 'x', 2]]], 2]], ['Ln', ['Ln', ['Add', ['Power', 'x', 2], ['Multiply', 2, ['Exp', ['Exp', ['Multiply', 3, ['Power', 'x', 3], ['Ln', 'x']]]]]]]]];
const bodies: any[] = [
  ['Divide', ['Ln', ['Ln', 'x']], ['Ln', 'x']],
  ['Divide', ['Exp', ['Exp', 'x']], ['Exp', ['Exp', ['Subtract', 'x', 1]]]],
  ['Divide', ['Power', 'x', 3], ['Exp', 'x']],
  ['Divide', ['Exp', ['Multiply', 2, 'x']], ['Power', 'x', 3]],
  gruntz1,
  gruntz2,
];

const which = process.env.LIMIT_SET ?? 'all';
const selected = which === 'easy' ? bodies.slice(0, 4) : bodies;

await measure(
  `limit-gruntz set=${which}`,
  () => {
    const ce = new ComputeEngine();
    ce.timeLimit = 2000;
    return ce;
  },
  (ce) => {
    const before = (limitModule as any).limitProbeCompileCount;
    const out = selected.map((b) => {
      let r: string;
      try {
        r = ce.box(['Limit', ['Function', b, 'x'], 'PositiveInfinity']).evaluate().toString();
      } catch (e) {
        r = `threw ${(e as Error).constructor.name}`;
      }
      return r.slice(0, 120);
    });
    const compiles = (limitModule as any).limitProbeCompileCount - before;
    // The compile count goes to stderr: it differs on/off by design.
    console.error(`compiles=${compiles}`);
    return out.join('\n');
  }
);
