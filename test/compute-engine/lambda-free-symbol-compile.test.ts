import { ComputeEngine } from '../../src/compute-engine';

/**
 * A compiled expression with unknowns is called with a vars object
 * (`f({ x: 1 })`), so a free symbol compiles to a `_.<id>` lookup on that
 * object. A compiled `Function` LITERAL is called with its declared
 * parameters only — there is no vars object in scope — so the same lookup is
 * a dangling reference that threw a raw `ReferenceError: _ is not defined`
 * out of generated code (Tycho item 131).
 *
 * The quadrature path was the route that reached it: it compiles the integrand
 * as a lambda, and a free symbol inside a USER FUNCTION's body is invisible to
 * the surface `unknowns` check that was supposed to gate it.
 */

describe('a lambda body with an unbound free symbol', () => {
  test('does not escape a ReferenceError out of .N()', () => {
    const ce = new ComputeEngine();
    // `q` is never assigned; it lives in `n`'s BODY, so the integrand
    // `n(x, 0.5)` has no free symbol of its own.
    ce.assign('n', ce.parse('\\left(x,r\\right)\\mapsto q + x + r'));
    const integral = ce.parse('\\int_{-1}^{1} n(x,0.5)\\mathrm{d}x');
    expect(() => integral.N()).not.toThrow();
    // Nothing to integrate numerically: stay symbolic, as the equivalent
    // inline integrand `∫(q + x)dx` already did.
    expect(integral.N().toString()).toContain('n(x, 0.5)');
  });

  test('sees a free symbol reachable only through an assigned value', () => {
    const ce = new ComputeEngine();
    ce.assign('b', ce.parse('c + 1')); // `c` is free inside `b`'s value
    ce.assign('n', ce.parse('x \\mapsto b + x'));
    const integral = ce.parse('\\int_{-1}^{1} n(x)\\mathrm{d}x');
    expect(() => integral.N()).not.toThrow();
    expect(integral.N().toString()).toContain('n(x)');
  });

  test('a callee capture is not mistaken for the integration variable', () => {
    const ce = new ComputeEngine();
    // `n`'s body captures the GLOBAL `x`, which is unassigned. The integration
    // variable is also spelled `x`, but it is a different binding — dropping
    // the capture because the names match would numericize to NaN.
    ce.assign('n', ce.parse('t \\mapsto x + t'));
    const integral = ce.parse('\\int_{-1}^{1} n(x)\\mathrm{d}x');
    // Stays symbolic. Filtering the flattened free-symbol set by the
    // integration variable's name instead numericized this to `NaN ± NaN`.
    expect(integral.N().toString()).toContain('n(x)');
    expect(integral.N().toString()).not.toContain('NaN');
  });

  test('CONTROL: assigning the symbol makes it numeric again', () => {
    const ce = new ComputeEngine();
    ce.assign('q', 0.5);
    ce.assign('n', ce.parse('\\left(x,r\\right)\\mapsto q + x + r'));
    expect(ce.parse('\\int_{-1}^{1} n(x,0.5)\\mathrm{d}x').N().re).toBeCloseTo(
      2,
      10
    );
  });

  test('the compiler declines the lambda rather than emitting a broken one', () => {
    const ce = new ComputeEngine();
    const refs = new Set<string>();
    expect(() =>
      ce._compile(ce.parse('x \\mapsto q + x'), {
        fallback: false,
        varsObjectRefs: refs,
      })
    ).toThrow(/unbound free symbol/);
    // The offending symbols are reported even though the compile failed: a
    // caller distinguishes "retry once assigned" from "never compilable".
    expect([...refs]).toEqual(['q']);
  });

  test('a free symbol inside a NESTED lambda is still caught', () => {
    const ce = new ComputeEngine();
    // The dangling-reference check runs when the compile ROOT is a lambda; the
    // set it consults is shared by reference through the nested target spreads,
    // so an inner lambda's free symbol must surface at the outer check.
    const refs = new Set<string>();
    expect(() =>
      ce._compile(ce.parse('x \\mapsto \\left(y \\mapsto y + q\\right)(x)'), {
        fallback: false,
        varsObjectRefs: refs,
      })
    ).toThrow(/unbound free symbol/);
    expect([...refs]).toEqual(['q']);
  });

  test('CONTROL: an expression (not a lambda) still takes the vars object', () => {
    const ce = new ComputeEngine();
    const compiled = ce._compile(ce.parse('x + q'));
    expect((compiled.run as (v: unknown) => number)({ x: 1, q: 2 })).toEqual(3);
  });

  test('CONTROL: lambdas without free symbols still compile', () => {
    const ce = new ComputeEngine();
    const plain = ce._compile(ce.parse('x \\mapsto x^2 + 1'));
    expect((plain.run as (x: number) => number)(3)).toEqual(10);

    // An ASSIGNED symbol is folded into the body, not a vars lookup.
    ce.assign('q', 5);
    const folded = ce._compile(ce.parse('x \\mapsto q + x'));
    expect((folded.run as (x: number) => number)(1)).toEqual(6);

    // A `vars` mapping supplies the value explicitly.
    const ce2 = new ComputeEngine();
    const mapped = ce2._compile(ce2.parse('x \\mapsto q + x'), {
      vars: { q: '7' },
    });
    expect((mapped.run as (x: number) => number)(1)).toEqual(8);
  });
});
