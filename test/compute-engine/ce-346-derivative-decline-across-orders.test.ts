/**
 * A derivative that declines at one order declines at every higher order of
 * the same function, in the same engine state, and the higher orders do not
 * differentiate the body again.
 *
 * `Derivative(f, n)` differentiates the body of `f` n times. The size limit
 * of the differentiator (`MAX_DERIVATIVE_NODES`, symbolic/derivative.ts)
 * stops a body whose derivative grows too large, and the node stays inert;
 * an application of it then goes to the numeric stencil (`.N()` and the
 * compiled `_SYS.nd`). The decline of each order was cached, but a request
 * of another order did not use it: `f''` after `f'` declined started again
 * from order 0 and ran into the limit again. For a deeply nested body, each
 * order then cost up to one second or more (Tycho item 177: a Taylor
 * polynomial of a nested radical paid it once per order).
 *
 * The body used here is a nested quotient: at depth 6 its first derivative
 * is over the limit after about 0.3 s; at depth 4 the first derivative
 * closes and the second one is over the limit.
 *
 * Each test counts the calls of the differentiation entry point
 * `derivative()`, which is where the cost is.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import * as DerivativeModule from '../../src/compute-engine/symbolic/derivative';

/** `(x + e) / (1 + x·e)`, nested `depth` times, starting from `x`. */
function nestedQuotient(depth: number): unknown {
  let e: unknown = 'x';
  for (let i = 0; i < depth; i++)
    e = ['Divide', ['Add', 'x', e], ['Add', 1, ['Multiply', 'x', e]]];
  return e;
}

/** An engine with `h := x ↦ factor · nestedQuotient(depth)`. */
function engineWith(depth: number, factor?: string): ComputeEngine {
  const ce = new ComputeEngine();
  if (factor !== undefined) ce.declare(factor, 'real');
  const q = nestedQuotient(depth);
  const body = factor === undefined ? q : ['Multiply', factor, q];
  ce.assign('h', ce.box(['Function', body, 'x'] as never));
  return ce;
}

/** Count the calls of `derivative()` made while `run` runs. */
function derivativeCalls(run: () => void): number {
  const spy = jest.spyOn(DerivativeModule, 'derivative');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

function derivativeOf(ce: ComputeEngine, order: number) {
  return ce.box(['Derivative', 'h', order]).evaluate();
}

describe('CE-346: a derivative decline answers the higher orders', () => {
  test('after the first order declines, the second and third do not differentiate again', () => {
    const ce = engineWith(6);
    expect(derivativeOf(ce, 1).operator).toBe('Derivative');
    let second, third;
    const calls = derivativeCalls(() => {
      second = derivativeOf(ce, 2);
      third = derivativeOf(ce, 3);
    });
    expect(calls).toBe(0);
    // The nodes stay inert, as on a fresh engine.
    expect(second!.toString()).toBe(derivativeOf(engineWith(6), 2).toString());
    expect(third!.operator).toBe('Derivative');
  });

  test('orders requested from the highest down use the decline of the highest', () => {
    // The derivatives of `h'(a) + h''(a) + h'''(a)` are requested in this
    // order: the canonical order of the sum puts the highest first.
    const ce = engineWith(6);
    expect(derivativeOf(ce, 3).operator).toBe('Derivative');
    const calls = derivativeCalls(() => {
      expect(derivativeOf(ce, 2).operator).toBe('Derivative');
      expect(derivativeOf(ce, 1).operator).toBe('Derivative');
    });
    expect(calls).toBe(0);
  });

  test('a decline at the second order answers the third, and the first keeps its closed form', () => {
    const ce = engineWith(4);
    expect(derivativeOf(ce, 1).operator).toBe('Function');
    expect(derivativeOf(ce, 2).operator).toBe('Derivative');
    const calls = derivativeCalls(() => {
      expect(derivativeOf(ce, 3).operator).toBe('Derivative');
    });
    expect(calls).toBe(0);
    expect(derivativeOf(ce, 1).operator).toBe('Function');
  });

  test('an assignment to a free symbol of the body is not answered by the decline', () => {
    const ce = engineWith(6, 'a');
    expect(derivativeOf(ce, 1).operator).toBe('Derivative');
    // With `a = 0` the body is 0, so every derivative is 0.
    ce.assign('a', 0);
    const second = derivativeOf(ce, 2);
    expect(second.operator).toBe('Function');
    expect(second.toString()).toBe('(x) => 0');
  });

  test('a compiled sum of the first three derivatives at a point is the interpreted value', () => {
    const ce = engineWith(6);
    const sum = ce.box([
      'Add',
      ['Apply', ['Derivative', 'h', 1], 0.5],
      ['Apply', ['Derivative', 'h', 2], 0.5],
      ['Apply', ['Derivative', 'h', 3], 0.5],
    ]);
    let result: ReturnType<typeof compile> | undefined;
    const calls = derivativeCalls(() => {
      result = compile(sum as never);
    });
    expect(result!.success).toBe(true);
    // One differentiation for the three orders: the first request finds the
    // decline, and the other two orders use it.
    expect(calls).toBe(1);
    const interpreted = [1, 2, 3]
      .map((k) => ce.box(['Apply', ['Derivative', 'h', k], 0.5]).N().re)
      .reduce((a, b) => a + b, 0);
    expect(Object.is(result!.run!() as number, interpreted)).toBe(true);
  });
});
