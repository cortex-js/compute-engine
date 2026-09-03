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
 * so literals narrow to `real`; a non-literal CONSTANT (π/2, π) can
 * sit exactly on a circular pole and keeps `number`; a symbolic real keeps
 * the generic-point convention — `Tan(r)`/`Sec(r)` claim `real` (their
 * pole set excludes 0), while the zero-pole operators require the sign to be
 * known (`Csc(r)` stays `number` unless r is provably nonzero).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';

const ce = new ComputeEngine();
ce.declare('r', 'real');
ce.declare('k', 'integer');
ce.declare('u', 'number');

/** The static claim of `expr` boxed from MathJSON. */
function typeOf(expr: any): string {
  return ce.box(expr).type.toString();
}

/** Assert the `.N()` value's own type is a subtype of the static claim.
 * The value's PUBLIC type is its bare tier (`2` is `integer`), which
 * cannot witness a ranged static claim such as `integer<0..>` even
 * when the value plainly satisfies it — so the value is judged by its
 * value-carrying handler type (`_literalType`) when it has one. */
function expectSound(expr: any): void {
  const e = ce.box(expr);
  const v = e.N();
  if (v.isNumber && v.numericValue !== undefined)
    expect(isSubtype(v._literalType ?? v.type.type, e.type.type)).toBe(true);
}

describe('TYPE AUDIT: pole reciprocals (Tan/Sec/Csc/Cot/Coth/Csch)', () => {
  it('narrows real literals to real (poles unreachable)', () => {
    expect(typeOf(['Tan', 2])).toBe('real');
    expect(typeOf(['Sec', ['Sqrt', 2]])).toBe('real');
    expect(typeOf(['Csc', 2])).toBe('real');
    expect(typeOf(['Cot', -2.5])).toBe('real');
    expect(typeOf(['Csch', 2])).toBe('real');
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
    expect(typeOf(['Coth', ['Divide', 'Pi', 2]])).toBe('real');
  });

  it('applies the generic-point ruling to symbolic reals', () => {
    expect(typeOf(['Tan', 'r'])).toBe('real');
    expect(typeOf(['Sec', 'r'])).toBe('real');
    // Zero-pole operators need the pole at 0 disproven.
    expect(typeOf(['Csc', 'r'])).toBe('number');
    expect(typeOf(['Coth', 'r'])).toBe('number');
    const e2 = new ComputeEngine();
    e2.declare('s', 'real');
    e2.assume(e2.parse('s > 0'));
    expect(e2.box(['Csc', 's']).type.toString()).toBe('real');
  });

  it('coth/csch are finite at real ±∞; circular give NaN → number', () => {
    expect(typeOf(['Coth', 'PositiveInfinity'])).toBe('real');
    expect(typeOf(['Csch', 'NegativeInfinity'])).toBe('real');
    expect(typeOf(['Tan', 'PositiveInfinity'])).toBe('number');
    expect(ce.box(['Coth', 'PositiveInfinity']).N().re).toBe(1);
  });
});

describe('TYPE AUDIT: pole-free hyperbolics at ±∞', () => {
  it('sinh/cosh send real ±∞ to a provable ±∞', () => {
    expect(typeOf(['Sinh', 'PositiveInfinity'])).toBe('signed_infinity');
    expect(typeOf(['Cosh', 'NegativeInfinity'])).toBe('signed_infinity');
    const sinhNegInf = ce.box(['Sinh', 'NegativeInfinity']).N();
    expect(sinhNegInf.isInfinity).toBe(true);
    expect(sinhNegInf.isNegative).toBe(true);
  });

  it('tanh/sech are finite real at ±∞', () => {
    expect(typeOf(['Tanh', 'PositiveInfinity'])).toBe('real');
    expect(typeOf(['Sech', 'PositiveInfinity'])).toBe('real');
    expect(ce.box(['Tanh', 'PositiveInfinity']).N().re).toBe(1);
  });
});

describe('TYPE AUDIT: Haversine / InverseHaversine / Hypot / Degrees', () => {
  // `Haversine` and `InverseHaversine` declare a bare `real` parameter,
  // which since the finite-by-default flip means a FINITE real, so an
  // infinite argument is rejected at the signature instead of reaching the
  // handler (ruling L9(a) of the numeric-lattice ratification:
  // signature-level rejection is the declared contract doing its job).
  // `Hypot` is the exception, and the reason the exception exists: its value
  // at an infinite argument is well defined, so it declares the finite reals
  // plus every infinity instead (see its own test below). The finite-argument
  // claims below are unchanged, and they are what these heads exist to
  // describe.
  it('Haversine rejects a non-finite argument at the signature', () => {
    expect(typeOf(['Haversine', 'PositiveInfinity'])).toBe('error');
    expect(typeOf(['Haversine', 2])).toBe('real');
  });

  it('InverseHaversine is real only on [0, 1]', () => {
    expect(typeOf(['InverseHaversine', 0.5])).toBe('real');
    expect(typeOf(['InverseHaversine', 1])).toBe('real');
    expect(typeOf(['InverseHaversine', -1])).toBe('complex');
    expect(typeOf(['InverseHaversine', 2.5])).toBe('complex');
    expect(typeOf(['InverseHaversine', 'PositiveInfinity'])).toBe('error');
    // Honest domain join for a symbolic real (user ruling 2026-07-30 (b)):
    // same convention as the Arcsin family, and the compiled JS path emits
    // complex code for it (see compile-angular-unit.test.ts).
    expect(typeOf(['InverseHaversine', 'r'])).toBe('complex');
    expect(ce.box(['InverseHaversine', -1]).N().im).not.toBe(0);
    expectSound(['InverseHaversine', -1]);
    expectSound(['InverseHaversine', 2.5]);
  });

  it('Hypot admits every infinity: its carrier is `real | infinity`', () => {
    // `Hypot(2, ∞) = +∞` is a well-defined value, so the old `(real, real)`
    // parameters — finite since the lattice flip — cost a real capability
    // rather than correcting a domain. The carrier gained the signed
    // infinities first (user ruling 2026-08-31), so an infinite leg is
    // admitted and makes the hypotenuse infinite whatever the other leg is.
    // The unsigned `~oo` joined them on 2026-09-02 ("IEEE everywhere"):
    // `|~oo| = +∞`, so the hypotenuse is defined there too.
    expect(typeOf(['Hypot', 2, 'PositiveInfinity'])).toBe(
      'real | signed_infinity'
    );
    const value = (expr: any) => ce.box(expr).evaluate().toString();
    expect(value(['Hypot', 2, 'PositiveInfinity'])).toBe('+oo');
    // `-∞` is admitted as an OPERAND and still norms to `+∞`: the result is
    // non-negative, which is why the declared result is `real | +oo`.
    expect(value(['Hypot', 2, 'NegativeInfinity'])).toBe('+oo');
    expect(value(['Hypot', 'PositiveInfinity', 'NegativeInfinity'])).toBe(
      '+oo'
    );
    // An infinite leg wins over a NaN leg, in either operand order: that is
    // what `Math.hypot(Infinity, NaN) === Infinity` says, and the compiled
    // lane emits `Math.hypot`, so any other answer here would be a route
    // divergence. This is why `Hypot` declares `nanBehavior: 'handle'` —
    // under `propagate` the generic gate answers NaN before the handler
    // runs (see error-model-declarations.test.ts).
    expect(value(['Hypot', 'PositiveInfinity', 'NaN'])).toBe('+oo');
    expect(value(['Hypot', 'NaN', 'PositiveInfinity'])).toBe('+oo');
    expect(value(['Hypot', 'NegativeInfinity', 'NaN'])).toBe('+oo');
    expect(value(['Hypot', 'NaN', 'NegativeInfinity'])).toBe('+oo');
    expect(ce.box(['Hypot', 'PositiveInfinity', 'NaN']).N().toString()).toBe(
      '+oo'
    );
    // With no infinite leg, a NaN leg still makes the result NaN, on both
    // routes.
    expect(ce.box(['Hypot', 'NaN', 1]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Hypot', 1, 'NaN']).evaluate().isNaN).toBe(true);
    expect(ce.box(['Hypot', 'NaN', 1]).N().isNaN).toBe(true);
    expectSound(['Hypot', 'NaN', 1]);
    expectSound(['Hypot', 'PositiveInfinity', 'NaN']);
    // A point leg enters the sum of squares through its norm, so the same
    // precedence applies to it: `Norm((∞, 3))` is `+oo`, which makes the
    // hypotenuse infinite whatever the other leg is.
    expect(value(['Hypot', ['Tuple', 'PositiveInfinity', 3], 'NaN'])).toBe(
      '+oo'
    );
    expect(value(['Hypot', 'NaN', ['Tuple', 3, 'PositiveInfinity']])).toBe(
      '+oo'
    );
    expect(value(['Hypot', ['Tuple', 3, 'NegativeInfinity'], 'NaN'])).toBe(
      '+oo'
    );
    // Control: a FINITE point leg withholds the proof, so the NaN leg wins.
    expect(ce.box(['Hypot', ['Tuple', 3, 4], 'NaN']).evaluate().isNaN).toBe(
      true
    );
    // A point that carries a NaN alongside the infinity is infinite too:
    // `Norm((∞, NaN))` is `+oo`, because an infinite component dominates a
    // NaN component in every Euclidean norm (user ruling 2026-09-02), and
    // `Hypot` agrees with the norm it is defined through.
    expect(value(['Hypot', ['Tuple', 'PositiveInfinity', 'NaN'], 2])).toBe(
      '+oo'
    );
    // `~oo` counts as an infinite component for the same reason: its modulus
    // is `+∞`.
    expect(value(['Hypot', ['Tuple', 'ComplexInfinity', 3], 'NaN'])).toBe(
      '+oo'
    );
    // The finite claim is unchanged, and it is what this head exists to
    // describe.
    expect(typeOf(['Hypot', 2, 3])).toBe('real');
    // A bare `~oo` leg is admitted by the carrier and norms to `+∞`.
    expect(value(['Hypot', 2, 'ComplexInfinity'])).toBe('+oo');
    expect(value(['Hypot', 'ComplexInfinity', 'NaN'])).toBe('+oo');
    expect(ce.box(['Hypot', 2, 'ComplexInfinity']).type.toString()).not.toBe(
      'error'
    );
    // The carrier stops at the infinities: a FINITE complex leg has no
    // real-valued hypotenuse and is still refused at the signature.
    expect(typeOf(['Hypot', 2, 'ImaginaryUnit'])).toBe('error');
  });

  it('Degrees of a non-real argument does not claim real', () => {
    const e = ce.box(['Degrees', 'ImaginaryUnit']);
    expect(e.type.matches('real')).toBe(false);
    expectSound(['Degrees', 'ImaginaryUnit']);
  });
});

describe('TYPE AUDIT: complex part extractors', () => {
  // `~oo` has no real part, no imaginary part and no phase angle: the
  // extractors answer NaN there and claim exactly `nan` (they used to
  // answer `+∞`, `+∞` and NaN under the top type `number`). An anonymous
  // infinity (`∞ + i`) reads its components.
  it('Real follows operand finiteness', () => {
    expect(typeOf(['Real', ['Complex', 2, 1]])).toBe('real');
    expect(typeOf(['Real', 'PositiveInfinity'])).toBe('signed_infinity');
    expect(typeOf(['Real', 'ComplexInfinity'])).toBe('nan');
    expect(typeOf(['Real', ['Complex', 'PositiveInfinity', 1]])).toBe(
      'signed_infinity'
    );
    expectSound(['Real', 'PositiveInfinity']);
    expectSound(['Real', 'ComplexInfinity']);
  });

  it('Imaginary: finite for finite numbers and for real ±∞ (Im = 0)', () => {
    expect(typeOf(['Imaginary', ['Complex', 2, 1]])).toBe('real');
    expect(typeOf(['Imaginary', 'PositiveInfinity'])).toBe('real');
    expect(typeOf(['Imaginary', 'ComplexInfinity'])).toBe('nan');
    expect(typeOf(['Imaginary', ['Complex', 'PositiveInfinity', 1]])).toBe(
      'real'
    );
    expect(ce.box(['Imaginary', 'PositiveInfinity']).N().re).toBe(0);
    expectSound(['Imaginary', 'ComplexInfinity']);
  });

  it('Argument: finite for finite numbers and real ±∞; NaN for ~oo', () => {
    expect(typeOf(['Argument', -2])).toBe('real');
    expect(typeOf(['Argument', 'NegativeInfinity'])).toBe('real');
    expect(typeOf(['Argument', 'ComplexInfinity'])).toBe('nan');
    expect(ce.box(['Argument', 'ComplexInfinity']).N().isNaN).toBe(true);
    expectSound(['Argument', 'ComplexInfinity']);
  });
});

describe('TYPE AUDIT: Erf family and elliptic integrals', () => {
  it('ErfInv: real inside (−1, 1), ±∞ poles at ±1, symbolic outside', () => {
    expect(typeOf(['ErfInv', 0.5])).toBe('real');
    expect(typeOf(['ErfInv', 1])).toBe('signed_infinity');
    expect(typeOf(['ErfInv', -1])).toBe('signed_infinity');
    // Outside [−1, 1] the value exists (erf is entire) but the real kernel
    // cannot compute it: the application stays symbolic, under N() too
    // (it used to answer NaN).
    expect(typeOf(['ErfInv', 2])).toBe('number');
    expect(ce.box(['ErfInv', 2]).N().operator).toBe('ErfInv');
    // No limit at any infinity: a decided NaN, claimed exactly.
    expect(typeOf(['ErfInv', 'PositiveInfinity'])).toBe('nan');
    expect(ce.box(['ErfInv', 'PositiveInfinity']).N().isNaN).toBe(true);
    const erfInvPole = ce.box(['ErfInv', 1]).evaluate();
    expect(erfInvPole.isInfinity).toBe(true);
    expect(erfInvPole.isPositive).toBe(true);
  });

  it('Erf/Erfc/Erfi do not claim real for an unproven-real operand', () => {
    expect(ce.box(['Erf', 'u']).type.matches('real')).toBe(false);
    expect(ce.box(['Erfc', 'u']).type.matches('real')).toBe(false);
    expect(ce.box(['Erfi', 'u']).type.matches('real')).toBe(false);
    // …but still claim real for real operands.
    expect(typeOf(['Erf', 'r'])).toBe('real');
    expect(typeOf(['Erfc', 'ImaginaryUnit'])).toBe('complex');
  });

  it('EllipticK: real below 1, +∞ pole at 1, complex above', () => {
    expect(typeOf(['EllipticK', 0.5])).toBe('real');
    expect(typeOf(['EllipticK', 1])).toBe('signed_infinity');
    expect(typeOf(['EllipticK', 2])).toBe('complex');
    const kPole = ce.box(['EllipticK', 1]).evaluate();
    expect(kPole.isInfinity).toBe(true);
    expect(kPole.isPositive).toBe(true);
    expect(ce.box(['EllipticK', 2]).N().im).not.toBe(0);
  });

  it('EllipticF/EllipticPi/AGM hedge where real args can be complex', () => {
    // F(1.5|2) is complex (m·sin²φ > 1): the claim must admit it.
    const f = ce.box(['EllipticF', 1.5, 2]);
    expect(f.type.toString()).toBe('number');
    expect(f.N().type.matches(f.type)).toBe(true);
    // Π has a +∞ pole at n = 1; away from it the finite hedge applies.
    expect(typeOf(['EllipticPi', 1, 0.5])).toBe('number');
    expect(ce.box(['EllipticPi', 1, 0.5]).N().isInfinity).toBe(true);
    expect(typeOf(['EllipticPi', 1.5, 0.5])).toBe('number');
    // AGM: real for non-negative reals, complex for a negative operand.
    expect(typeOf(['AGM', 1, 2])).toBe('real');
    const agmNeg = ce.box(['AGM', 1, -2]);
    expect(agmNeg.type.toString()).toBe('number');
    expect(agmNeg.N().type.matches(agmNeg.type)).toBe(true);
    expect(typeOf(['AGM', 1, 'PositiveInfinity'])).toBe('number');
  });

  it('EllipticE: real on m ≤ 1, complex above; 2-arg form hedges finite', () => {
    expect(typeOf(['EllipticE', 1])).toBe('real');
    expect(typeOf(['EllipticE', 2])).toBe('complex');
    expect(ce.box(['EllipticE', 1]).evaluate().re).toBe(1);
    // Incomplete E(φ|m) with m·sin²φ > 1 is complex: the hedge must admit it.
    const e = ce.box(['EllipticE', 1.5, 2]);
    expect(e.type.toString()).toBe('number');
    expect(e.N().type.matches(e.type)).toBe(true);
  });
});

describe('TYPE AUDIT: Binomial / Pochhammer / Rank', () => {
  it('Binomial: integer for integer args, real for real args, number at Γ poles/∞', () => {
    expect(typeOf(['Binomial', 5, 2])).toBe('integer');
    expect(typeOf(['Binomial', -5, 2])).toBe('integer');
    expect(typeOf(['Binomial', 0.5, 2.5])).toBe('real');
    // Negative integer n with non-integer k reaches the Γ(n+1) pole.
    expect(typeOf(['Binomial', -2, ['Rational', 1, 2]])).toBe('number');
    expect(typeOf(['Binomial', 2, 'PositiveInfinity'])).toBe('number');
    // `C(n, +∞) = 0` for a finite real n > −1 (|C(n, k)| decays like
    // k^(−n−1)); the old `NaN` was the Γ-ratio kernel's answer to an
    // `Infinity` argument, not a limit. The claim stays the wide `number`:
    // for n ≤ −1 the same point is `NaN`.
    expect(ce.box(['Binomial', 2, 'PositiveInfinity']).N().isSame(0)).toBe(true);
    expectSound(['Binomial', 0.5, 2.5]);
  });

  it('Pochhammer: a finite product for non-negative integer k', () => {
    expect(typeOf(['Pochhammer', 5, 3])).toBe('integer');
    expect(typeOf(['Pochhammer', ['Rational', 2, 3], 3])).toBe('rational');
    expect(typeOf(['Pochhammer', 2.5, 3])).toBe('real');
    expect(typeOf(['Pochhammer', 2, -1])).toBe('number');
  });

  it('Rank is always a non-negative integer (was: operand passthrough)', () => {
    expect(typeOf(['Rank', 'ImaginaryUnit'])).toBe('integer');
    expect(ce.box(['Rank', 'ImaginaryUnit']).evaluate().re).toBe(0);
    expect(ce.box(['Rank', ['List', 1, 2]]).evaluate().re).toBe(1);
  });
});

describe('TYPE AUDIT: Max/Min extremum join', () => {
  it('narrows to the join tier when all operands are scalar numbers', () => {
    expect(typeOf(['Max', 'r', 'k'])).toBe('real');
    expect(typeOf(['Supremum', 'r', 'k'])).toBe('real');
    expect(typeOf(['Min', 1, 2.5])).toBe('real');
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
    // Real operands keep their claims. Si is bounded, so it claims the finite
    // reals. Ci is real only on the NON-NEGATIVE axis (a negative argument
    // gives the principal value `Ci(x) + iπ`, ruled 2026-09-01), so a real
    // operand of unknown sign keeps `number`; a proven non-negative one has
    // a pole at 0 (`Ci(0) = −∞`), so it claims the EXTENDED real line — the
    // bare name `real` denotes the finite reals and would exclude the pole.
    expect(typeOf(['SinIntegral', 'r'])).toBe('real');
    expect(typeOf(['CosIntegral', 'r'])).toBe('number');
    ce.declare('ciArg', 'real<0..>');
    expect(typeOf(['CosIntegral', 'ciArg'])).toBe('real | signed_infinity');
    const ciPole = ce.box(['CosIntegral', 0]);
    expect(ciPole.evaluate().isInfinity).toBe(true);
    expect(ciPole.evaluate().type.matches(ciPole.type)).toBe(true);
  });

  it('SinhIntegral/CoshIntegral/Erfi admit their infinities', () => {
    // Shi and Erfi are entire: finite on a FINITE real, ±∞ only at ±∞.
    expect(typeOf(['SinhIntegral', 'r'])).toBe('real');
    expect(typeOf(['Erfi', 'r'])).toBe('real');
    for (const f of ['SinhIntegral', 'Erfi']) {
      const at = ce.box([f, 'PositiveInfinity']);
      expect(at.evaluate().isInfinity).toBe(true);
      expect(at.evaluate().type.matches(at.type)).toBe(true);
    }
    // Chi is real only on the NON-NEGATIVE axis (a negative argument gives
    // the principal value `Chi(x) + iπ`, ruled 2026-09-01), so a real
    // operand of unknown sign keeps `number`. A proven non-negative one has
    // a pole at 0 as well as Chi(+∞) = +∞, so proving the argument finite
    // does not buy a finite claim.
    expect(typeOf(['CoshIntegral', 'r'])).toBe('number');
    ce.declare('chiArg', 'real<0..>');
    expect(typeOf(['CoshIntegral', 'chiArg'])).toBe('real | signed_infinity');
    const chiPole = ce.box(['CoshIntegral', 0]);
    expect(chiPole.evaluate().isInfinity).toBe(true);
    expect(chiPole.evaluate().type.matches(chiPole.type)).toBe(true);
  });
});

describe('TYPE AUDIT: Abs (magnitude)', () => {
  // |x| preserves the numeric TIER of a real operand as well as its
  // finiteness. Before the 2026-07-31 co-fix the handler only tracked
  // finiteness, so `|k|` claimed `real` for an integer `k` — which blocked
  // the exact-mode Map compile tier's integer-closedness probe.
  ce.declare('aq', 'rational');
  ce.declare('afq', 'rational');
  ce.declare('afk', 'integer');
  ce.declare('afr', 'real');
  ce.declare('az', 'complex');

  // Since the ranged-result round (ROADMAP "Ranged types should carry
  // sign…", item 4) each tier claim carries `<0..>`: |x| ≥ 0 is now part of
  // the TYPE, which is what lets `√|x|` type `real` and the GPU
  // lowering keep the real kernel without consulting the sgn channel.
  it('preserves the integer/rational/real tier of a real operand', () => {
    expect(typeOf(['Abs', 'afk'])).toBe('integer<0..>');
    expect(typeOf(['Abs', 'k'])).toBe('integer<0..>');
    expect(typeOf(['Abs', 'afq'])).toBe('rational<0..>');
    expect(typeOf(['Abs', 'aq'])).toBe('rational<0..>');
    expect(typeOf(['Abs', 'afr'])).toBe('real<0..>');
    expect(typeOf(['Abs', 'r'])).toBe('real<0..>');
  });

  it('narrows literals to their own tier — and, since the interval round, to their own point', () => {
    // A literal operand carries a point interval, and `Abs` reflects it:
    // the claim is the SINGLETON range at the magnitude (true — `|−2|` is
    // 2 — and a handler-result singleton is the same shape as an author
    // narrowing, which the storage walker deliberately passes through).
    expect(typeOf(['Abs', 2])).toBe('integer<2..2>');
    expect(typeOf(['Abs', -2])).toBe('integer<2..2>');
    // The RATIONAL tier is the one exception: a singleton range on
    // `rational` is the exact-rational LITERAL spelling (ruling
    // O9), so `widenValueTypes` widens it to its tier at the storage
    // boundary — a handler-computed rational point cannot survive there,
    // by the same rule that keeps literal cargo out of stored contracts.
    expect(typeOf(['Abs', ['Rational', -1, 2]])).toBe('rational');
    expect(typeOf(['Abs', -2.5])).toBe('real<2.5..2.5>');
    expect(
      ce
        .box(['Abs', ['Rational', -1, 2]])
        .evaluate()
        .toString()
    ).toBe('1/2');
    expectSound(['Abs', -2]);
    expectSound(['Abs', -2.5]);
  });

  it('keeps the finiteness rungs (complex magnitude, ±∞, ~oo, NaN)', () => {
    // A finite COMPLEX magnitude is real but neither rational nor integer.
    expect(typeOf(['Abs', 'ImaginaryUnit'])).toBe('real<0..>');
    expect(typeOf(['Abs', 'az'])).toBe('real<0..>');
    expect(typeOf(['Abs', 'PositiveInfinity'])).toBe('signed_infinity');
    // `|~oo| = +∞`, and the claim has to admit that value: a bare tier
    // denotes the FINITE values alone, so `real<0..>` would exclude the
    // very value this expression evaluates to.
    expect(typeOf(['Abs', 'ComplexInfinity'])).toBe('signed_infinity');
    expect(ce.box(['Abs', 'ComplexInfinity']).evaluate().toString()).toBe(
      '+oo'
    );
    expectSound(['Abs', 'ComplexInfinity']);
    expect(typeOf(['Abs', { num: 'NaN' }])).toBe('number');
    // An operand typed the top `number` may hold `±∞` or `~oo`, so its
    // magnitude may be `+∞`; the claim is the union of the finite and the
    // infinite outcome. (`number` also admits NaN, which this claim does
    // NOT cover — a hole the pre-flip `real<0..>` had as well, since NaN
    // was never a member of `real`.)
    expect(typeOf(['Abs', 'u'])).toBe('(real<0..>) | signed_infinity');
    // The claim admits `+∞`, the value `Abs` of such an operand can reach.
    expect(
      isSubtype(
        ce.box('PositiveInfinity').type.type,
        ce.box(['Abs', 'u']).type.type
      )
    ).toBe(true);
    expectSound(['Abs', 'ImaginaryUnit']);
    expectSound(['Abs', 'PositiveInfinity']);
  });
});

describe('TYPE AUDIT: Ceil (and the inert `Ceiling` alias)', () => {
  // NOT a handler gap: `Ceil` already narrows exactly like `Floor`/`Round`/
  // `Truncate`. The 2026-07-31 review reported `Ceiling(k) → unknown` as a
  // missing narrowing; the real cause is that `Ceiling` is not an operator at
  // all — it is a deliberately INERT Mathematica alias (see
  // `src/epsil/docs/from-mathematica.md`). Pinned so the next reader does not
  // "fix" a handler that is already correct, and so the exact-mode Map compile
  // tier's interval table keeps keying on the name that exists.
  ce.declare('cfk', 'integer');
  ce.declare('cfr', 'real');

  it('Ceil narrows to integer like the other rounding functions', () => {
    for (const op of ['Floor', 'Ceil', 'Round', 'Truncate']) {
      expect([op, typeOf([op, 'cfk'])]).toEqual([op, 'integer']);
      expect([op, typeOf([op, 'cfr'])]).toEqual([op, 'integer']);
      expect([op, typeOf([op, 2.5])]).toEqual([op, 'integer']);
    }
    expect(ce.box(['Ceil', 2.5]).evaluate().re).toBe(3);
  });

  it('`Ceiling` has no definition — it is inert, not a narrowing gap', () => {
    expect(ce.lookupDefinition('Ceiling')).toBeUndefined();
    expect(typeOf(['Ceiling', 'cfk'])).toBe('unknown');
  });
});

describe('TYPE AUDIT: Mod (floored remainder)', () => {
  // `Mod`'s only reachable pole is a zero modulus (NaN), and any non-finite
  // operand also yields NaN, so narrowing requires provably-finite operand
  // TYPES and a provably nonzero modulus (the zero-pole sgn convention).
  ce.declare('fk', 'integer');
  ce.declare('fm', 'integer');
  ce.declare('fr', 'real');

  it('narrows finite-typed operands over a provably nonzero modulus', () => {
    expect(typeOf(['Mod', 'fk', 900])).toBe('integer');
    expect(typeOf(['Mod', 'fr', 2])).toBe('real');
    expect(typeOf(['Mod', 'fk', ['Rational', 5, 2]])).toBe('rational');
  });

  it('narrows compound operands from their STATIC type', () => {
    // The value predicates (`isFinite`, `isInteger`) are type-blind on
    // compound operands; the handler must read `.type`. This chain is the
    // broadcast witness body — the exact-mode compile tier keys on it.
    expect(typeOf(['Mod', ['Add', 'fk', 29], 900])).toBe('integer');
    expect(typeOf(['Add', 1, ['Mod', ['Add', 'fk', 29], 900]])).toBe('integer');
  });

  it('a possibly-zero symbolic modulus admits the marker (Mod(k, 0) is NaN)', () => {
    // The handler declines the claim, and the declared `real` result gains
    // the `| nan` arm while the `definedWhen` condition (a non-zero modulus)
    // is undischarged.
    const t = ce.box(['Mod', 'fk', 'fm']).type;
    expect(t.matches('real | nan')).toBe(true);
    expect(t.matches('real')).toBe(false);
  });

  it('NaN outcomes claim nan; off-carrier operands are boxing errors', () => {
    // The carrier is `(real, real)`: a zero modulus is the one failure
    // inside it (the `definedWhen` marker, typed exactly `nan`), a NaN
    // operand propagates (typed `nan`), and a non-real or infinite operand
    // is outside it — an `incompatible-type` error at boxing.
    expect(typeOf(['Mod', ['Rational', 1, 2], 0])).toBe('nan');
    expect(typeOf(['Mod', 'fk', { num: 'NaN' }])).toBe('nan');
    expect(ce.box(['Mod', 'ImaginaryUnit', 'ImaginaryUnit']).isValid).toBe(
      false
    );
    expect(ce.box(['Mod', { num: '+Infinity' }, 5]).isValid).toBe(false);
    // A bare `integer` operand is finite — every bare numeric name is — so it
    // narrows like the other finite-typed operands above. It kept `number`
    // while the retired `finite_integer` spelling existed alongside it: the
    // handler's gate named that spelling, and `integer` was not a subtype of
    // it.
  });
});

describe('TYPE AUDIT: Sqrt over a closed (unknowns-free) radicand', () => {
  // Machine floats are deliberately not folded at canonicalization, so the
  // radicand of `√(1 − 0.2²)` reaches the type handler unevaluated and its
  // `sgn` is undecided — and the handler claims the `complex` hedge
  // for it, exactly as it does for any other unknown-sign real radicand. A
  // type derivation never evaluates: the `closedRealSign` fold that used to
  // numericize a closed radicand here (Tycho 0.100.0 adoption item 137) was
  // retired once the compile targets learned to fold constants before
  // reading a node's type (§5.4 `Sqrt` row and §5.8 A5 of
  // `docs/plans/2026-08-22-type-handlers-on-types.md`) — the compiled bytes
  // are pinned unchanged in the item-137 block below.
  it('an unfolded non-negative float radicand proves its sign through interval arithmetic', () => {
    // This claimed the `complex` hedge until the interval round
    // (2026-08-27): the radicand `1 − 0.2²` now carries a computed range
    // (`0.2` is a point interval, `Power`/`Add` fold it to ~[0.96, 0.96]),
    // so `Sqrt` proves the radicand non-negative without evaluation.
    expect(typeOf(['Sqrt', ['Subtract', 1, ['Power', 0.2, 2]]])).toBe('real');
    // …while a literal radicand, whose sign is statically known, still
    // claims `real` — no evaluation is needed to see `0.96 ≥ 0`
    expect(typeOf(['Sqrt', 0.96])).toBe('real');
    expectSound(['Sqrt', ['Subtract', 1, ['Power', 0.2, 2]]]);
  });

  it('a negative radicand stays complex', () => {
    expect(typeOf(['Sqrt', ['Subtract', ['Power', 0.2, 2], 1]])).toBe(
      'complex'
    );
    expect(typeOf(['Sqrt', -2])).toBe('complex');
    // …including one whose sign only evaluation could decide
    // (`ln 2 − 1 = −0.306…`): the hedge covers it without evaluating
    expect(typeOf(['Sqrt', ['Subtract', ['Ln', 2], 1]])).toBe('complex');
    expectSound(['Sqrt', ['Subtract', ['Power', 0.2, 2], 1]]);
  });

  it('a radicand with unknowns hedges the same way', () => {
    expect(typeOf(['Sqrt', 'x'])).toBe('number');
    expect(typeOf(['Sqrt', ['Subtract', 1, ['Power', 'r', 2]]])).toBe(
      'complex'
    );
  });

  it('does not claim a finite type for a non-finite closed radicand', () => {
    expect(typeOf(['Sqrt', ['Divide', 1, 0.0]])).toBe('number');
  });

  it('an IMPURE radicand draws no random (the type path never evaluates)', () => {
    // `√(Random() − 0.5)` has no unknowns; a type derivation that evaluated
    // it would consume a draw (and give an unstable answer). This pin is the
    // regression guard for the no-evaluation contract itself.
    const engine = new ComputeEngine();
    const claimed: string[] = [];
    const drawn = withRandomSeedFrame(engine, 7, () => {
      claimed.push(
        engine.box(['Sqrt', ['Subtract', ['Random'], 0.5]]).type.toString()
      );
      return engine._randomFrame!.next;
    });
    expect(drawn).toBe(0);
    // …and the claim is the conservative hedge
    expect(claimed).toEqual(['complex']);
  });
});

describe('Tycho item 137: the GLSL band of a Which over a float radicand', () => {
  it('the raw and the folded radicand compile to the same bytes', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const glsl = engine._getCompilationTarget('glsl')!;
    const branch = (radicand: string) =>
      engine.parse(
        `\\begin{cases} \\sqrt{${radicand}} & x > 0 \\\\ 0 & \\text{otherwise}\\end{cases}`
      );

    const raw = branch('1-0.2^2');
    const folded = branch('0.96');
    // The TYPES now differ — the raw radicand's sign is statically unknown,
    // Both spellings now type `real` — the raw one through the
    // computed radicand interval (2026-08-27 interval round; it typed the
    // `complex` hedge before). What item 137 actually needs is the
    // COMPILED band: the compiler folds the constant subtree itself, so
    // both spellings emit the identical real scalar — byte for byte.
    expect(raw.type.toString()).toBe('real');
    expect(folded.type.toString()).toBe('real');
    const rawCode = glsl.compile(raw).code;
    const foldedCode = glsl.compile(folded).code;
    expect(rawCode).toBeTruthy();
    expect(rawCode).toBe(foldedCode);
  });
});
