/**
 * Regression pins for the 2026-07-30 type-handler audit: operator type
 * handlers must not claim a type that excludes the actual value (soundness),
 * and should not claim the top type where a narrower one is provable
 * (precision). Companion to `real-domain-types.test.ts` /
 * `inverse-trig-domain-type.test.ts` (bounded inverse-trig domains) and
 * `non-finite-typing.test.ts` (non-finite convention); this file covers the
 * remaining families: the pole reciprocals (Tan/Sec/Csc/Cot/Coth/Csch),
 * Haversine/InverseHaversine/Hypot/Degrees, the complex part extractors,
 * Erf-family/elliptic integrals, Binomial/Pochhammer, Rank, and the
 * Max/Min extremum join.
 *
 * Pole-reciprocal convention (user ruling 2026-07-30): a number literal can
 * only land on the pole at 0 (all other poles are irrational multiples of π),
 * so literals narrow to `finite_real`; a non-literal CONSTANT (π/2, π) can
 * sit exactly on a circular pole and keeps `number`; a symbolic real keeps
 * the generic-point convention — `Tan(r)`/`Sec(r)` claim `finite_real` (their
 * pole set excludes 0), while the zero-pole operators require the sign to be
 * known (`Csc(r)` stays `number` unless r is provably nonzero).
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('r', 'real');
ce.declare('k', 'integer');
ce.declare('u', 'number');

/** The static claim of `expr` boxed from MathJSON. */
function typeOf(expr: any): string {
  return ce.box(expr).type.toString();
}

/** Assert the `.N()` value's own type is a subtype of the static claim. */
function expectSound(expr: any): void {
  const e = ce.box(expr);
  const v = e.N();
  if (v.isNumber && v.numericValue !== undefined)
    expect(v.type.matches(e.type)).toBe(true);
}

describe('TYPE AUDIT: pole reciprocals (Tan/Sec/Csc/Cot/Coth/Csch)', () => {
  it('narrows real literals to finite_real (poles unreachable)', () => {
    expect(typeOf(['Tan', 2])).toBe('finite_real');
    expect(typeOf(['Sec', ['Sqrt', 2]])).toBe('finite_real');
    expect(typeOf(['Csc', 2])).toBe('finite_real');
    expect(typeOf(['Cot', -2.5])).toBe('finite_real');
    expect(typeOf(['Csch', 2])).toBe('finite_real');
    for (const x of [2, -2.5]) {
      expectSound(['Tan', x]);
      expectSound(['Csc', x]);
    }
  });

  it('keeps number at the literal-reachable pole 0', () => {
    expect(typeOf(['Csc', 0])).toBe('number');
    expect(typeOf(['Cot', 0])).toBe('number');
    expect(typeOf(['Csch', 0])).toBe('number');
    expect(typeOf(['Coth', 0])).toBe('number');
  });

  it('keeps number for π-multiple constants (they sit on circular poles)', () => {
    expect(typeOf(['Tan', ['Divide', 'Pi', 2]])).toBe('number');
    expect(typeOf(['Tan', 'Pi'])).toBe('number');
    expect(typeOf(['Csc', 'Pi'])).toBe('number');
    expect(typeOf(['Cot', 'Pi'])).toBe('number');
  });

  it('hyperbolic constants are off the (0-only) pole and narrow', () => {
    expect(typeOf(['Coth', ['Divide', 'Pi', 2]])).toBe('finite_real');
  });

  it('applies the generic-point ruling to symbolic reals', () => {
    expect(typeOf(['Tan', 'r'])).toBe('finite_real');
    expect(typeOf(['Sec', 'r'])).toBe('finite_real');
    // Zero-pole operators need the pole at 0 disproven.
    expect(typeOf(['Csc', 'r'])).toBe('number');
    expect(typeOf(['Coth', 'r'])).toBe('number');
    const e2 = new ComputeEngine();
    e2.declare('s', 'real');
    e2.assume(e2.parse('s > 0'));
    expect(e2.box(['Csc', 's']).type.toString()).toBe('finite_real');
  });

  it('coth/csch are finite at real ±∞; circular give NaN → number', () => {
    expect(typeOf(['Coth', 'PositiveInfinity'])).toBe('finite_real');
    expect(typeOf(['Csch', 'NegativeInfinity'])).toBe('finite_real');
    expect(typeOf(['Tan', 'PositiveInfinity'])).toBe('number');
    expect(ce.box(['Coth', 'PositiveInfinity']).N().re).toBe(1);
  });
});

describe('TYPE AUDIT: pole-free hyperbolics at ±∞', () => {
  it('sinh/cosh send real ±∞ to a provable ±∞', () => {
    expect(typeOf(['Sinh', 'PositiveInfinity'])).toBe('non_finite_number');
    expect(typeOf(['Cosh', 'NegativeInfinity'])).toBe('non_finite_number');
    const sinhNegInf = ce.box(['Sinh', 'NegativeInfinity']).N();
    expect(sinhNegInf.isInfinity).toBe(true);
    expect(sinhNegInf.isNegative).toBe(true);
  });

  it('tanh/sech are finite real at ±∞', () => {
    expect(typeOf(['Tanh', 'PositiveInfinity'])).toBe('finite_real');
    expect(typeOf(['Sech', 'PositiveInfinity'])).toBe('finite_real');
    expect(ce.box(['Tanh', 'PositiveInfinity']).N().re).toBe(1);
  });
});

describe('TYPE AUDIT: Haversine / InverseHaversine / Hypot / Degrees', () => {
  it('Haversine widens on a non-finite argument (hav(±∞) is NaN)', () => {
    expect(typeOf(['Haversine', 'PositiveInfinity'])).toBe('number');
    expect(typeOf(['Haversine', 2])).toBe('finite_real');
    expect(ce.box(['Haversine', 'PositiveInfinity']).N().isNaN).toBe(true);
  });

  it('InverseHaversine is real only on [0, 1]', () => {
    expect(typeOf(['InverseHaversine', 0.5])).toBe('finite_real');
    expect(typeOf(['InverseHaversine', 1])).toBe('finite_real');
    expect(typeOf(['InverseHaversine', -1])).toBe('finite_complex');
    expect(typeOf(['InverseHaversine', 2.5])).toBe('finite_complex');
    expect(typeOf(['InverseHaversine', 'PositiveInfinity'])).toBe('number');
    // Honest domain join for a symbolic real (user ruling 2026-07-30 (b)):
    // same convention as the Arcsin family, and the compiled JS path emits
    // complex code for it (see compile-angular-unit.test.ts).
    expect(typeOf(['InverseHaversine', 'r'])).toBe('finite_complex');
    expect(ce.box(['InverseHaversine', -1]).N().im).not.toBe(0);
    expectSound(['InverseHaversine', -1]);
    expectSound(['InverseHaversine', 2.5]);
  });

  it('Hypot follows operand finiteness (Hypot(∞, 2) = +∞)', () => {
    expect(typeOf(['Hypot', 2, 'PositiveInfinity'])).toBe('number');
    expect(typeOf(['Hypot', 2, 3])).toBe('finite_real');
    const hypotInf = ce.box(['Hypot', 2, 'PositiveInfinity']).N();
    expect(hypotInf.isInfinity).toBe(true);
    expect(hypotInf.isPositive).toBe(true);
  });

  it('Degrees of a non-real argument does not claim real', () => {
    const e = ce.box(['Degrees', 'ImaginaryUnit']);
    expect(e.type.matches('real')).toBe(false);
    expectSound(['Degrees', 'ImaginaryUnit']);
  });
});

describe('TYPE AUDIT: complex part extractors', () => {
  it('Real follows operand finiteness', () => {
    expect(typeOf(['Real', ['Complex', 2, 1]])).toBe('finite_real');
    expect(typeOf(['Real', 'PositiveInfinity'])).toBe('non_finite_number');
    expect(typeOf(['Real', 'ComplexInfinity'])).toBe('number');
    expectSound(['Real', 'PositiveInfinity']);
  });

  it('Imaginary: finite for finite numbers and for real ±∞ (Im = 0)', () => {
    expect(typeOf(['Imaginary', ['Complex', 2, 1]])).toBe('finite_real');
    expect(typeOf(['Imaginary', 'PositiveInfinity'])).toBe('finite_real');
    expect(typeOf(['Imaginary', 'ComplexInfinity'])).toBe('number');
    expect(ce.box(['Imaginary', 'PositiveInfinity']).N().re).toBe(0);
  });

  it('Argument: finite for finite numbers and real ±∞; NaN for ~oo', () => {
    expect(typeOf(['Argument', -2])).toBe('finite_real');
    expect(typeOf(['Argument', 'NegativeInfinity'])).toBe('finite_real');
    expect(typeOf(['Argument', 'ComplexInfinity'])).toBe('number');
    expect(ce.box(['Argument', 'ComplexInfinity']).N().isNaN).toBe(true);
  });
});

describe('TYPE AUDIT: Erf family and elliptic integrals', () => {
  it('ErfInv: real inside (−1, 1), ±∞ poles at ±1, NaN outside', () => {
    expect(typeOf(['ErfInv', 0.5])).toBe('finite_real');
    expect(typeOf(['ErfInv', 1])).toBe('non_finite_number');
    expect(typeOf(['ErfInv', -1])).toBe('non_finite_number');
    expect(typeOf(['ErfInv', 2])).toBe('number');
    expect(typeOf(['ErfInv', 'PositiveInfinity'])).toBe('number');
    expect(ce.box(['ErfInv', 2]).N().isNaN).toBe(true);
    const erfInvPole = ce.box(['ErfInv', 1]).evaluate();
    expect(erfInvPole.isInfinity).toBe(true);
    expect(erfInvPole.isPositive).toBe(true);
  });

  it('Erf/Erfc/Erfi do not claim real for an unproven-real operand', () => {
    expect(ce.box(['Erf', 'u']).type.matches('real')).toBe(false);
    expect(ce.box(['Erfc', 'u']).type.matches('real')).toBe(false);
    expect(ce.box(['Erfi', 'u']).type.matches('real')).toBe(false);
    // …but still claim real for real operands.
    expect(typeOf(['Erf', 'r'])).toBe('finite_real');
    expect(typeOf(['Erfc', 'ImaginaryUnit'])).toBe('finite_complex');
  });

  it('EllipticK: real below 1, +∞ pole at 1, complex above', () => {
    expect(typeOf(['EllipticK', 0.5])).toBe('finite_real');
    expect(typeOf(['EllipticK', 1])).toBe('non_finite_number');
    expect(typeOf(['EllipticK', 2])).toBe('finite_complex');
    const kPole = ce.box(['EllipticK', 1]).evaluate();
    expect(kPole.isInfinity).toBe(true);
    expect(kPole.isPositive).toBe(true);
    expect(ce.box(['EllipticK', 2]).N().im).not.toBe(0);
  });

  it('EllipticF/EllipticPi/AGM hedge where real args can be complex', () => {
    // F(1.5|2) is complex (m·sin²φ > 1): the claim must admit it.
    const f = ce.box(['EllipticF', 1.5, 2]);
    expect(f.type.toString()).toBe('finite_number');
    expect(f.N().type.matches(f.type)).toBe(true);
    // Π has a +∞ pole at n = 1; away from it the finite hedge applies.
    expect(typeOf(['EllipticPi', 1, 0.5])).toBe('number');
    expect(ce.box(['EllipticPi', 1, 0.5]).N().isInfinity).toBe(true);
    expect(typeOf(['EllipticPi', 1.5, 0.5])).toBe('finite_number');
    // AGM: real for non-negative reals, complex for a negative operand.
    expect(typeOf(['AGM', 1, 2])).toBe('finite_real');
    const agmNeg = ce.box(['AGM', 1, -2]);
    expect(agmNeg.type.toString()).toBe('finite_number');
    expect(agmNeg.N().type.matches(agmNeg.type)).toBe(true);
    expect(typeOf(['AGM', 1, 'PositiveInfinity'])).toBe('number');
  });

  it('EllipticE: real on m ≤ 1, complex above; 2-arg form hedges finite', () => {
    expect(typeOf(['EllipticE', 1])).toBe('finite_real');
    expect(typeOf(['EllipticE', 2])).toBe('finite_complex');
    expect(ce.box(['EllipticE', 1]).evaluate().re).toBe(1);
    // Incomplete E(φ|m) with m·sin²φ > 1 is complex: the hedge must admit it.
    const e = ce.box(['EllipticE', 1.5, 2]);
    expect(e.type.toString()).toBe('finite_number');
    expect(e.N().type.matches(e.type)).toBe(true);
  });
});

describe('TYPE AUDIT: Binomial / Pochhammer / Rank', () => {
  it('Binomial: integer for integer args, real for real args, number at Γ poles/∞', () => {
    expect(typeOf(['Binomial', 5, 2])).toBe('finite_integer');
    expect(typeOf(['Binomial', -5, 2])).toBe('finite_integer');
    expect(typeOf(['Binomial', 0.5, 2.5])).toBe('finite_real');
    // Negative integer n with non-integer k reaches the Γ(n+1) pole.
    expect(typeOf(['Binomial', -2, ['Rational', 1, 2]])).toBe('number');
    expect(typeOf(['Binomial', 2, 'PositiveInfinity'])).toBe('number');
    expect(ce.box(['Binomial', 2, 'PositiveInfinity']).N().isNaN).toBe(true);
    expectSound(['Binomial', 0.5, 2.5]);
  });

  it('Pochhammer: a finite product for non-negative integer k', () => {
    expect(typeOf(['Pochhammer', 5, 3])).toBe('finite_integer');
    expect(typeOf(['Pochhammer', ['Rational', 2, 3], 3])).toBe(
      'finite_rational'
    );
    expect(typeOf(['Pochhammer', 2.5, 3])).toBe('finite_real');
    expect(typeOf(['Pochhammer', 2, -1])).toBe('number');
  });

  it('Rank is always a non-negative integer (was: operand passthrough)', () => {
    expect(typeOf(['Rank', 'ImaginaryUnit'])).toBe('finite_integer');
    expect(ce.box(['Rank', 'ImaginaryUnit']).evaluate().re).toBe(0);
    expect(ce.box(['Rank', ['List', 1, 2]]).evaluate().re).toBe(1);
  });
});

describe('TYPE AUDIT: Max/Min extremum join', () => {
  it('narrows to the join tier when all operands are scalar numbers', () => {
    expect(typeOf(['Max', 'r', 'k'])).toBe('real');
    expect(typeOf(['Supremum', 'r', 'k'])).toBe('real');
    expect(typeOf(['Min', 1, 2.5])).toBe('finite_real');
  });

  it('keeps number when a collection or unknown-number operand is present (§3.C)', () => {
    // A collection may be empty or contain Missing → NaN absorption applies.
    expect(typeOf(['Max', ['List', 1, 2]])).toBe('number');
    // A `number`-typed symbol may be NaN.
    expect(typeOf(['Max', 'u', 1])).toBe('number');
  });
});

describe('TYPE AUDIT: integral special functions with unproven-real operands', () => {
  it('SinIntegral/CosIntegral do not claim real for a number-typed symbol', () => {
    expect(ce.box(['SinIntegral', 'u']).type.matches('real')).toBe(false);
    expect(ce.box(['CosIntegral', 'u']).type.toString()).toBe('number');
    // Real operands keep their claims.
    expect(typeOf(['SinIntegral', 'r'])).toBe('finite_real');
    expect(typeOf(['CosIntegral', 'r'])).toBe('real');
  });
});
