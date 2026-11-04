// Shared nodes must retain compact generated code and the same numeric value.
// Deterministic operand-read budgets are in shared-traversal-work.test.ts.
// Wall-clock ceilings run only in the serial CE_PERF suite; they detect large
// slowdowns, while the serial benchmark measures smaller performance drift.
// Scalar proofs include recursion depth in their memo key because they decline
// beyond a depth limit. Constant folding is disabled to isolate these proofs.

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();

/** `Add(e, e)` applied `d` times, with the SAME node object twice. */
function doubled(base: Expression, d: number): Expression {
  let e = base;
  for (let i = 0; i < d; i++) e = ce._fn('Add', [e, e]);
  return e;
}

const TIME_LIMIT_MS = 1000;

function timedCompile(expr: Expression) {
  const start = performance.now();
  const result = compile(expr, { constantFold: false });
  return { result, ms: performance.now() - start };
}

describe('COMPILE: SCALAR FACTS OF AN EXPRESSION WITH SHARED SUBTREES', () => {
  test('a constant sum of a shared subtree compiles in linear time', () => {
    const base = ce.function('Add', [
      ce.number(2),
      ce.function('Sqrt', [ce.number(3)]),
    ]);
    for (const d of [22, 30]) {
      const e = doubled(base, d);
      expect(e.ops![0]).toBe(e.ops![1]);
      const { result, ms } = timedCompile(doubled(base, d));
      if (process.env.CE_PERF === '1') expect(ms).toBeLessThan(TIME_LIMIT_MS);
      expect(result.success).toBe(true);
      // (2 + √3)·2^d
      const expected = (2 + Math.sqrt(3)) * 2 ** d;
      expect(Math.abs(Number(result.run!()) - expected)).toBeLessThan(
        expected * 1e-12
      );
    }
  });

  test('a block local assigned a shared subtree compiles in linear time', () => {
    const x = ce.symbol('x');
    const a = ce.symbol('a');
    for (const d of [22, 30]) {
      const makeBlock = () =>
        ce._fn('Block', [
          ce._fn('Declare', [a, ce.string('real')]),
          ce._fn('Assign', [a, doubled(ce.function('Add', [x, ce.One]), d)]),
          ce._fn('Multiply', [a, ce.number(2)]),
        ]);
      const { result, ms } = timedCompile(makeBlock());
      if (process.env.CE_PERF === '1') expect(ms).toBeLessThan(TIME_LIMIT_MS);
      expect(result.success).toBe(true);
      // At x = 1: (1 + 1)·2^d·2
      expect(result.run!({ x: 1 })).toBe(2 ** (d + 2));
    }
  });
});
