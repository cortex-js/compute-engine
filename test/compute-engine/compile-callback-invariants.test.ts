/**
 * Two callback lowerings that used to recompute work on every call:
 *
 * - A `Function` literal a handler SYNTHESIZES at emission time (the numeric
 *   derivative fallback wraps its operand in `Function(body, x)`) is not part
 *   of the tree the CSE harvest walked, so its body compiled with no
 *   candidates: a subexpression repeated in the body was emitted, and
 *   evaluated, once per occurrence (the stencil callback of Tycho corpus
 *   document `lwuwgb9ic5` spelled the same minimum of twenty distances
 *   twenty-one times). Such a body now gets a nested harvest of its own.
 * - The integrand of a quadrature lowering (`_SYS.integrate`, `_IA.integrate`)
 *   runs once per sample, and a subexpression of it that mentions no
 *   integration variable was recomputed at every sample (`Γ(k/2)·√2^k`, 300
 *   times per integral in document `thpezd39zq`). It is now bound once, next
 *   to the lambda, on its first call.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('an integrand computes its loop invariants once', () => {
  const ce = new ComputeEngine();
  ce.declare('k', 'number');

  test('a nested integral with a dependent bound keeps its value', () => {
    // The inner integrand reads the outer variable, so the inner bindings
    // are declared inside the outer lambda, once per outer sample.
    const nested =
      '\\int_{0}^{1}\\int_{0}^{x}\\Gamma(k/2)\\,x\\,y\\,\\mathrm{d}y\\,\\mathrm{d}x';
    const fn = compile(ce.parse(nested), { to: 'javascript' });
    expect(fn.success).toBe(true);
    const plain = compile(ce.parse(nested), { to: 'javascript', cse: false });
    expect(fn.run!({ k: 5 }) as number).toBeCloseTo(
      plain.run!({ k: 5 }) as number,
      10
    );
  });

  test('an empty range evaluates no invariant', () => {
    // `Gamma(0)` is a pole: the unhoisted integrand never evaluated it when
    // quadrature asked for no sample, and neither may the bindings.
    const empty = '\\int_{3}^{3}\\frac{y}{\\Gamma(k)}\\,\\mathrm{d}y';
    const fn = compile(ce.parse(empty), { to: 'javascript' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ k: 0 })).toBe(0);
  });
});
