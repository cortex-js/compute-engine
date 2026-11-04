import { ComputeEngine } from '../../src/compute-engine';

// Sign of a power whose exponent is not provably real (the `sgn` handler of
// `Power` in library/arithmetic.ts). A positive base raised to a non-real
// exponent b is e^(b·ln a), which can be anywhere off the origin, on or off
// the real axis: `2^(ln(-3))` is about -1.22 + 1.76i, and `2^(iπ/ln 2)` is
// -1. So no sign follows from a positive base alone. The rules that read the
// sign from the base apply only to a real exponent.
//
// The first four cases are from a sweep of closed constants by a host
// (Tycho): each one had a real sign and a non-real value (ROADMAP CE-795).

describe('SGN OF A POWER WITH A NON-REAL EXPONENT', () => {
  const ce = new ComputeEngine();

  it.each([
    '2^{\\ln(-3)}',
    '(\\sqrt{2})^{\\sqrt[4]{-1}}',
    '(e^{-1})^{\\sqrt{-e}}',
    '(|\\pi|)^{\\ln(-3)}',
  ])('%s has no sign, and its value is not real', (latex) => {
    const expr = ce.parse(latex);
    expect(expr.sgn).toBeUndefined();
    // The value has a non-zero imaginary part: a real sign would be wrong.
    expect(Math.abs(expr.N().im)).toBeGreaterThan(0.1);
  });

  it('a positive base with a complex exponent can be real', () => {
    // The exponent ln(-1)/ln 2 = iπ/ln 2 has the type `complex`, and
    // 2^(iπ/ln 2) = e^(iπ) = -1: so the sign is not `unsigned` either.
    const expr = ce.parse('2^{\\frac{\\ln(-1)}{\\ln 2}}');
    expect(expr.op2.type.toString()).toBe('complex');
    expect(expr.sgn).toBeUndefined();
    expect(expr.N().re).toBeCloseTo(-1, 10);
  });

  it('a real exponent keeps the sign rules', () => {
    expect(ce.parse('2^{\\sqrt{2}}').sgn).toBe('positive');
    // An odd numerator and an odd denominator keep the sign of the base.
    // (`(-2)^{1/3}` is not a test of `Power`: it becomes a `Root`.)
    expect(ce.parse('(-2)^{\\frac{3}{5}}').sgn).toBe('negative');
    // A negative base with an irrational real exponent is not real.
    expect(ce.parse('(-2)^{\\sqrt{2}}').sgn).toBe('unsigned');
  });
});
