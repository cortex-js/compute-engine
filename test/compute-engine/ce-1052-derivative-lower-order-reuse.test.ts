/**
 * `Derivative(f, n)` continues from the highest lower order that an earlier
 * request computed, when that result is still valid.
 *
 * The `Derivative` handler declares the hole `_` in a scope that it discards
 * after each request, so each request differentiates with respect to a new
 * definition of `_`. A result of an earlier request depended on the old
 * definition and was rejected, so `Derivative(f, 3)` after
 * `Derivative(f, 2)` computed the orders 1 and 2 again. The result is now
 * used with its hole replaced by the new one (`finishedOverNewVariable()` in
 * `src/compute-engine/symbolic/derivative.ts`).
 *
 * The tests check that the result is the one that a new engine computes,
 * that the lower orders are not simplified again (the number of calls of
 * `simplify()`, not the time, so the check does not depend on the load of
 * the machine), and that a lower order is not used when the state that its
 * simplification read has changed.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { BoxedFunction } from '../../src/compute-engine/boxed-expression/boxed-function';

const RADICAL = [
  'Function',
  ['Sqrt', ['Add', 'x', ['Sqrt', ['Add', 'x', ['Sqrt', ['Add', 'x', 1]]]]]],
  'x',
];

/** Its orders 1 to 4 take the reuse path that those of `RADICAL` take, in
 *  less time. */
const SMALL_RADICAL = [
  'Function',
  ['Sqrt', ['Add', 'x', ['Sqrt', ['Add', 'x', 1]]]],
  'x',
];

const SIN_EXP = ['Function', ['Multiply', ['Sin', 'x'], ['Exp', 'x']], 'x'];

function engineWith(fn: unknown): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('f', ce.box(fn as any));
  return ce;
}

function orderOf(ce: ComputeEngine, n: number): string {
  return JSON.stringify(ce.box(['Derivative', 'f', n]).evaluate().json);
}

/** The number of calls of `simplify()` on a function expression, recursive
 * calls included, made while `run` runs. */
function simplifyCalls(run: () => void): number {
  const spy = jest.spyOn(BoxedFunction.prototype, 'simplify');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

describe('CE-1052: a derivative continues from a lower order of an earlier request', () => {
  test.each([
    ['a nested radical', SMALL_RADICAL],
    ['sin(x)·exp(x)', SIN_EXP],
  ])('the orders 2 to 4 of %s equal those of a new engine', (_, fn) => {
    const warm = engineWith(fn);
    for (const n of [1, 2, 3, 4]) {
      const result = orderOf(warm, n);
      expect(result).toBe(orderOf(engineWith(fn), n));
      expect(result).not.toContain('Derivative');
    }
  });

  test('order 3 after order 2 does not simplify the lower orders again', () => {
    const cold = engineWith(RADICAL);
    const coldCalls = simplifyCalls(() => orderOf(cold, 3));

    const warm = engineWith(RADICAL);
    orderOf(warm, 2);
    const warmCalls = simplifyCalls(() => orderOf(warm, 3));

    // A cold request simplifies the derivatives of order 1 and 2 before it
    // differentiates them. Without the reuse, the warm request did too.
    expect(coldCalls - warmCalls).toBeGreaterThanOrEqual(2);
  });

  test('a lower order computed with the facts in force is not used with them hidden', () => {
    // `sin(πb)` is 0 for an integer `b`, so the order 2 of `x³·sin(πb)` is 0
    // when the fact `b ∈ ℤ` is in force. Order 3 with the facts hidden must
    // not continue from that 0.
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    ce.assume(ce.parse('b \\in \\Z'));
    ce.parse('f(x):=x^3\\sin(b\\pi)').evaluate();
    expect(orderOf(ce, 2)).not.toContain('Sin');
    const hidden = ce._withoutFacts(() => orderOf(ce, 3));
    expect(hidden).toContain('Sin');
  });

  test('a lower order is not used after the type of a free symbol is widened', () => {
    // With `b` an integer, the order 2 of `x⁴·sin(πb)` simplifies to 0, and
    // order 3 must not continue from that 0 once `b` is a real. The write
    // advances the definition version of the engine, which empties the cache
    // of the function (`derivativeChainCache()`). The check of the symbol
    // dependencies in `finishedOverNewVariable()` is a second guard, for a
    // write that bumps only the version of the definition of `b`.
    const ce = new ComputeEngine();
    ce.declare('b', 'integer');
    ce.parse('f(x):=x^4\\sin(b\\pi)').evaluate();
    expect(orderOf(ce, 2)).not.toContain('Sin');
    ce.box('b').valueDefinition!.type = ce.type('real');
    expect(orderOf(ce, 3)).toContain('Sin');
  });

  test('declares nothing in the caller scope', () => {
    const ce = engineWith(RADICAL);
    orderOf(ce, 2);
    orderOf(ce, 3);
    expect(ce.lookupDefinition('_')).toBeUndefined();
  });
});
