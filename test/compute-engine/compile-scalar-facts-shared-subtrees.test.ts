// A boxed expression can hold the same node object at several positions (a
// DAG). `e_k = Add(e_(k-1), e_(k-1))` repeated `d` times has about `d`
// distinct nodes but about `2^d` paths. The shape predicates of
// `compilation/javascript-value-facts.ts` (`isScalarValue`,
// `integerRange`, and the statement test of `blockValueKind`) followed every
// path, so the compilation of such an expression took exponential time: 1 s
// at depth 18, and about an hour at depth 30. Each predicate now remembers its
// answer for each node object and depth during one question, so the time is
// linear in the distinct nodes.
//
// The time limits below are generous on purpose (the measured times are under
// 20 ms); they only have to separate linear from exponential behavior. Each
// test compiles at depth 22 first: without the memo that takes several
// seconds, so the test fails at that step instead of running for an hour at
// depth 30.
//
// One wall-clock measurement can exceed the limit on a loaded machine (a full
// test run with many workers, a garbage-collection pause): a full run once
// measured 1176 ms for a compilation that takes under 20 ms alone. So
// `fastestCompile()` compiles a new copy of the expression again, up to three
// times, while the time is over the limit, and keeps the fastest time. An
// exponential compilation is slow at every attempt, so the retries do not
// hide it.
//
// Constant folding is off: with folding on, other walks of the compiler
// (in `base-compiler.ts`) still follow every path of the folded value.

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

/**
 * Compile `make()` and return the result with the fastest time of at most
 * three attempts. A new attempt runs only while the time is at or over
 * `TIME_LIMIT_MS`. Each attempt compiles a new expression from `make()`, so
 * a value that an earlier compilation stored on the node objects cannot make
 * a later attempt fast.
 */
function fastestCompile(make: () => Expression) {
  let best = timedCompile(make());
  for (let i = 1; i < 3 && best.ms >= TIME_LIMIT_MS; i++) {
    const next = timedCompile(make());
    if (next.ms < best.ms) best = next;
  }
  return best;
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
      const { result, ms } = fastestCompile(() => doubled(base, d));
      expect(ms).toBeLessThan(TIME_LIMIT_MS);
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
      const { result, ms } = fastestCompile(makeBlock);
      expect(ms).toBeLessThan(TIME_LIMIT_MS);
      expect(result.success).toBe(true);
      // At x = 1: (1 + 1)·2^d·2
      expect(result.run!({ x: 1 })).toBe(2 ** (d + 2));
    }
  });
});
