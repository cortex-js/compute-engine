import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * Conformance pins for the combinatorial and regularized special functions
 * after their `docs/ERROR-MODEL.md` Contract B signature flip (Phase F batch
 * 12): `Binomial`, `Choose`, `Pochhammer`, `GammaRegularized` and
 * `BetaRegularized`.
 *
 * Every numeric slot of the five heads now takes the Γ-family carrier
 * `complex | infinity`, `NaN` propagates explicitly, and the declared result
 * stays the wide `number`. The consequence the rows below pin: an infinite
 * operand is a VALUE in the carrier, not a boxing error, so each head answers
 * it from its own limit table — the same answer on `evaluate()` and on
 * `.N()`, decided before any numeric kernel sees an `Infinity` argument. A
 * point with no limit answers `NaN`; a point the head simply cannot compute
 * (a complex operand with no complex kernel, a real region outside the
 * kernel's domain) stays SYMBOLIC, because reporting a capability gap as
 * `NaN` would claim a defined value is indeterminate.
 *
 * Every limit here was verified against an independent high-precision
 * computation at 10², 10⁴ and 10⁶ before it was encoded, and — where the
 * approach passes a line of poles — at several offsets between consecutive
 * poles. The comments carry the sample values.
 */

const POS = 'PositiveInfinity';
const NEG = 'NegativeInfinity';
const COO = 'ComplexInfinity';
/** An "anonymous" infinity: a complex literal with an infinite component. */
const ANON = ['Complex', POS, 1];

/** Assert that `expr` gives the same answer on `evaluate()` and on `.N()`. */
function bothRoutes(
  ce: ComputeEngine,
  expr: any,
  check: (v: Expression) => boolean
): void {
  expect(check(ce.box(expr).evaluate())).toBe(true);
  expect(check(ce.box(expr).N())).toBe(true);
}

const isValue = (n: any) => (v: Expression) => v.isSame(n);
const isSymbolic = (head: string) => (v: Expression) => v.operator === head;

describe('Binomial / Choose at the infinite points', () => {
  const ce = new ComputeEngine();
  const isNaNv = (v: Expression) => v.isSame(ce.NaN);
  const isPos = isValue(ce.PositiveInfinity);
  const isNeg = isValue(ce.NegativeInfinity);
  const isCoo = isValue(ce.ComplexInfinity);

  // `Binomial` and `Choose` share `evaluateBinomial` and are documented to
  // agree, so every row runs against both names.
  const heads = ['Binomial', 'Choose'];

  test('C(+∞, k) follows C(n, k) ~ n^k/Γ(k+1)', () => {
    for (const h of heads) {
      // k > 0 diverges (C(10⁶, 0.5) = 1128, C(10⁶, 3) = 1.7·10¹⁷).
      bothRoutes(ce, [h, POS, 2], isPos);
      bothRoutes(ce, [h, POS, 2.5], isPos);
      // k = 0 is the empty product (C(10⁶, 0) = 1).
      bothRoutes(ce, [h, POS, 0], isValue(1));
      // k < 0 vanishes (C(10⁶, −2.5) = 4.2·10⁻¹⁶).
      bothRoutes(ce, [h, POS, -2.5], isValue(0));
    }
  });

  test('C(−∞, k) has a limit only on the polynomial arm', () => {
    for (const h of heads) {
      // A non-negative integer k makes C(n, k) the polynomial
      // n(n−1)⋯(n−k+1)/k!, which has no poles: (−1)^k·∞
      // (C(−10⁶, 2) = +5·10¹¹, C(−10⁶, 3) = −1.7·10¹⁷).
      bothRoutes(ce, [h, NEG, 0], isValue(1));
      bothRoutes(ce, [h, NEG, 2], isPos);
      bothRoutes(ce, [h, NEG, 3], isNeg);
      // A non-integer k crosses the poles of Γ(n+1): the value oscillates in
      // sign and modulus without settling (C(−10⁶−0.1, 0.5) = +3473,
      // C(−10⁶−0.5, 0.5) = 0, C(−10⁶−0.9, 0.5) = −3473).
      bothRoutes(ce, [h, NEG, 2.5], isNaNv);
      bothRoutes(ce, [h, NEG, -2.5], isNaNv);
    }
  });

  test('C(~oo, k): the polynomial arm again, direction-less', () => {
    for (const h of heads) {
      bothRoutes(ce, [h, COO, 0], isValue(1));
      bothRoutes(ce, [h, COO, 2], isCoo);
      bothRoutes(ce, [h, COO, 2.5], isNaNv);
    }
  });

  test('a negative integer k makes C(n, k) the zero function', () => {
    for (const h of heads) {
      // 1/Γ(k+1) = 0 at every pole of Γ, so the value is 0 at EVERY n, the
      // infinite ones included.
      bothRoutes(ce, [h, POS, -2], isValue(0));
      bothRoutes(ce, [h, NEG, -2], isValue(0));
      bothRoutes(ce, [h, COO, -2], isValue(0));
      // The finite points had answered overflow garbage: C(2.5, −2) was
      // −2.1·10⁻⁵¹ through the naive Γ ratio.
      bothRoutes(ce, [h, 2.5, -2], isValue(0));
    }
  });

  test('C(n, ±∞) is 0 exactly when n > −1', () => {
    for (const h of heads) {
      // |C(n, k)| ~ |Γ(n+1)/π|·|sin(π(n−k+1))|·k^(−n−1): for n > −1 the power
      // wins (C(0.5, −10⁶) = 2.8·10⁻¹⁰, C(5, 10⁶) = 0).
      bothRoutes(ce, [h, 5, POS], isValue(0));
      bothRoutes(ce, [h, 5, NEG], isValue(0));
      bothRoutes(ce, [h, 0.5, POS], isValue(0));
      bothRoutes(ce, [h, -0.5, POS], isValue(0));
      // For n ≤ −1 the power diverges while the sine oscillates: no limit
      // (C(−2.5, 10⁶) = 7.5·10⁸ against C(−2.5, 10⁶+0.5) = 0; C(−1, k) is
      // (−1)^k).
      bothRoutes(ce, [h, -1, POS], isNaNv);
      bothRoutes(ce, [h, -2.5, POS], isNaNv);
      bothRoutes(ce, [h, -3, POS], isNaNv);
      bothRoutes(ce, [h, -3, NEG], isNaNv);
    }
  });

  test('C(n, ~oo), two infinite operands and an anonymous infinity are NaN', () => {
    for (const h of heads) {
      // The modulus wanders with the direction (C(5, 10⁶·e^i) = 10¹¹⁴⁸⁰⁴⁸
      // against C(5, −10⁶) = 1.5·10⁻⁴⁴).
      bothRoutes(ce, [h, 5, COO], isNaNv);
      bothRoutes(ce, [h, POS, POS], isNaNv);
      bothRoutes(ce, [h, POS, NEG], isNaNv);
      bothRoutes(ce, [h, ANON, 2], isNaNv);
      bothRoutes(ce, [h, 2, ANON], isNaNv);
    }
  });

  test('a NaN operand propagates', () => {
    for (const h of heads) {
      bothRoutes(ce, [h, 'NaN', 2], isNaNv);
      bothRoutes(ce, [h, 2, 'NaN'], isNaNv);
      // Even where the value would otherwise be decided without the operand.
      bothRoutes(ce, [h, 'NaN', 0], isNaNv);
    }
  });

  test('a complex finite operand stays symbolic (no complex kernel)', () => {
    bothRoutes(ce, ['Binomial', ['Complex', 0, 1], 2], isSymbolic('Binomial'));
    bothRoutes(ce, ['Binomial', 5, ['Complex', 0, 1]], isSymbolic('Binomial'));
  });
});

describe('the simplify twins of the Binomial value rules', () => {
  const ce = new ComputeEngine();

  // `simplifyBinomial` (symbolic/simplify-factorial.ts) rewrites patterns
  // without looking at values, so its two folds to the CONSTANT 1 had to gain
  // the same non-finite guard the evaluate handler carries. The two rewrites
  // that return an OPERAND (`C(n, 1) → n`, `C(n, n−1) → n`) agree with
  // evaluate() at every point and are deliberately left unguarded.

  test('C(n, n) → 1 no longer fires at a non-finite literal', () => {
    for (const h of ['Binomial', 'Choose'])
      for (const n of [POS, NEG, COO, 'NaN', ANON]) {
        // evaluate() answers NaN on the diagonal at every infinite point
        // (C(10⁶, 10⁶+d) is 0 or unbounded depending on d, so there is no
        // limit) and propagates a NaN operand. simplify() used to answer 1.
        expect(ce.box([h, n, n] as any).simplify().operator).toBe(h);
        expect(ce.box([h, n, n] as any).evaluate().isSame(ce.NaN)).toBe(true);
      }
  });

  test('C(n, n) → 1 still fires for a symbolic n', () => {
    expect(ce.box(['Binomial', 'nfree', 'nfree']).simplify().isSame(1)).toBe(
      true
    );
    expect(ce.box(['Choose', 'nfree', 'nfree']).simplify().isSame(1)).toBe(true);
  });

  test('C(n, 0) → 1 keeps the infinities and drops only the NaN points', () => {
    // C(±∞, 0) and C(~oo, 0) ARE 1 — evaluate() says so — so the rewrite
    // stays; only the points evaluate() answers NaN for are excluded.
    for (const n of [POS, NEG, COO])
      expect(ce.box(['Binomial', n, 0] as any).simplify().isSame(1)).toBe(true);
    for (const n of ['NaN', ANON]) {
      expect(ce.box(['Binomial', n, 0] as any).simplify().operator).toBe(
        'Binomial'
      );
      expect(ce.box(['Binomial', n, 0] as any).evaluate().isSame(ce.NaN)).toBe(
        true
      );
    }
    expect(ce.box(['Binomial', 'nfree', 0]).simplify().isSame(1)).toBe(true);
  });

  test('the operand-returning rewrites agree with evaluate everywhere', () => {
    expect(ce.box(['Binomial', 'NaN', 1]).simplify().isSame(ce.NaN)).toBe(true);
    expect(
      ce.box(['Binomial', POS, 1]).simplify().isSame(ce.PositiveInfinity)
    ).toBe(true);
    expect(ce.box(['Binomial', 'nfree', 1]).simplify().symbol).toBe('nfree');
  });
});

describe('Binomial at a Γ pole of a finite point', () => {
  const ce = new ComputeEngine();

  test('both operands negative integers: the two poles cancel', () => {
    // `1/Γ(k+1)` vanishes for a negative integer k — but where `Γ(n+1)` is a
    // pole too the quotient is finite: (−1)^(n−k)·C(−k−1, −n−1) for n ≥ k,
    // and 0 for n < k, where `Γ(n−k+1)` puts a second pole in the
    // denominator. Verified against a high-precision reference over the
    // whole −6..0 square. The `k < 0 → 0` short cut used to apply
    // "regardless of n", so `C(−3, −3)` answered 0 while simplify's own
    // `C(n, n) → 1` answered 1 — the engine contradicted itself.
    const rows: [number, number, number][] = [
      [-3, -3, 1],
      [-3, -4, -3],
      [-3, -5, 6],
      [-1, -1, 1],
      [-2, -5, -4],
      [-4, -4, 1],
      [-5, -3, 0],
      [-6, -2, 0],
    ];
    for (const [n, k, v] of rows)
      bothRoutes(ce, ['Binomial', n, k], isValue(v));
    // A non-negative n keeps the plain vanishing rule.
    bothRoutes(ce, ['Binomial', 5, -2], isValue(0));
    bothRoutes(ce, ['Binomial', 0, -3], isValue(0));
  });

  test('a pole in the DENOMINATOR makes the quotient 0', () => {
    // C(n, k) = Γ(n+1)/(Γ(k+1)·Γ(n−k+1)). At n = −2.5, k = −1.5 the third
    // factor is Γ(0), a pole, so the value is 0 — the limit crosses zero
    // there (C(−2.5, −1.49) = +0.0066, C(−2.5, −1.51) = −0.0067). This point
    // used to answer NaN.
    bothRoutes(ce, ['Binomial', -2.5, -1.5], isValue(0));
    bothRoutes(ce, ['Binomial', ['Rational', -5, 2], ['Rational', -3, 2]], isValue(0));
  });

  test('a pole in the NUMERATOR alone is the unsigned ~oo', () => {
    // Γ(n+1) on a pole (n a negative integer) with a non-integer k: the
    // engine's spelling of a Γ pole, as `Gamma(0)` and `Beta(−1, 2)` give.
    // These used to answer overflow garbage (C(−3, 0.5) was −8.9·10⁴⁸).
    bothRoutes(ce, ['Binomial', -3, 0.5], isValue(ce.ComplexInfinity));
    bothRoutes(ce, ['Binomial', -3, -0.5], isValue(ce.ComplexInfinity));
    bothRoutes(
      ce,
      ['Binomial', -3, ['Rational', 1, 2]],
      isValue(ce.ComplexInfinity)
    );
  });

  test('the ordinary finite values are unchanged', () => {
    expect(ce.box(['Binomial', 5, 2]).evaluate().isSame(10)).toBe(true);
    expect(ce.box(['Binomial', -5, 2]).evaluate().isSame(15)).toBe(true);
    expect(ce.box(['Binomial', 5, -2]).evaluate().isSame(0)).toBe(true);
    expect(ce.box(['Binomial', 5.5, 2]).evaluate().re).toBeCloseTo(12.375, 12);
    // An exact non-integer operand has no closed form: symbolic on
    // evaluate(), numeric under .N() (the exactness contract).
    expect(ce.box(['Binomial', ['Rational', 1, 2], 2]).evaluate().operator).toBe(
      'Binomial'
    );
    expect(ce.box(['Binomial', ['Rational', 1, 2], 2]).N().re).toBeCloseTo(
      -0.125,
      12
    );
    expect(ce.box(['Binomial', 5, 2.5]).evaluate().re).toBeCloseTo(
      10.864977448406722,
      12
    );
  });
});

describe('Pochhammer', () => {
  const ce = new ComputeEngine();
  const isNaNv = (v: Expression) => v.isSame(ce.NaN);
  const isPos = isValue(ce.PositiveInfinity);
  const isNeg = isValue(ce.NegativeInfinity);

  test('(±∞)_k and (~oo)_k follow (a)_k ~ a^k', () => {
    // (10⁶)_{0.5} = 1000, (10⁶)_{−2.5} = 10⁻¹⁵.
    bothRoutes(ce, ['Pochhammer', POS, 2], isPos);
    bothRoutes(ce, ['Pochhammer', POS, 2.5], isPos);
    bothRoutes(ce, ['Pochhammer', POS, 0], isValue(1));
    bothRoutes(ce, ['Pochhammer', POS, -2], isValue(0));
    // At −∞ and ~oo only the integer arm has a limit: (−10⁶−½)_3 = −10¹⁸,
    // (−10⁶−½)_{−2} = +10⁻¹², while (−10⁶−¼)_{0.5} = −1000 against
    // (−10⁶−¾)_{0.5} = +1000 with a pole between them.
    bothRoutes(ce, ['Pochhammer', NEG, 0], isValue(1));
    bothRoutes(ce, ['Pochhammer', NEG, 2], isPos);
    bothRoutes(ce, ['Pochhammer', NEG, 3], isNeg);
    bothRoutes(ce, ['Pochhammer', NEG, -2], isValue(0));
    bothRoutes(ce, ['Pochhammer', NEG, 2.5], isNaNv);
    bothRoutes(ce, ['Pochhammer', COO, 0], isValue(1));
    bothRoutes(ce, ['Pochhammer', COO, 2], isValue(ce.ComplexInfinity));
    bothRoutes(ce, ['Pochhammer', COO, -2], isValue(0));
    bothRoutes(ce, ['Pochhammer', COO, 2.5], isNaNv);
  });

  test('(a)_{+∞} carries the sign of Γ(a)', () => {
    // (a)_k = Γ(a+k)/Γ(a): the numerator diverges, so the sign is Γ(a)'s.
    bothRoutes(ce, ['Pochhammer', 3, POS], isPos);
    // Γ(−2.5) = −0.95, and (−2.5)_{10⁶} is negative.
    bothRoutes(ce, ['Pochhammer', -2.5, POS], isNeg);
    // Γ(−1.5) = +2.36.
    bothRoutes(ce, ['Pochhammer', -1.5, POS], isPos);
    // 1/Γ(a) = 0 at a non-positive integer a: the value is 0 there.
    bothRoutes(ce, ['Pochhammer', -3, POS], isValue(0));
    bothRoutes(ce, ['Pochhammer', 0, POS], isValue(0));
  });

  test('(a)_{−∞} is 0 only at a pole of Γ(a)', () => {
    // Γ(a+k) has a pole at every k with a+k a non-positive integer, so for a
    // generic a the value is unbounded arbitrarily far out
    // ((0.5)_{−10⁶} = 2·10^(−5565706) but (0.5)_{−10⁶−½} = ∞). Those poles
    // are cancelled by the pole of Γ(a) exactly when a is a non-positive
    // integer, and there the value decays to 0 ((−3)_{−10⁶} → 0).
    bothRoutes(ce, ['Pochhammer', -3, NEG], isValue(0));
    bothRoutes(ce, ['Pochhammer', 0, NEG], isValue(0));
    bothRoutes(ce, ['Pochhammer', 3, NEG], isNaNv);
    bothRoutes(ce, ['Pochhammer', 0.5, NEG], isNaNv);
    // (a)_{~oo}: |Γ(a+k)| decays like e^(−π|Im k|/2) in the imaginary
    // direction and diverges along the positive real axis — no limit.
    bothRoutes(ce, ['Pochhammer', 3, COO], isNaNv);
  });

  test('two infinite operands, an anonymous infinity and NaN', () => {
    bothRoutes(ce, ['Pochhammer', POS, POS], isNaNv);
    bothRoutes(ce, ['Pochhammer', ANON, 2], isNaNv);
    bothRoutes(ce, ['Pochhammer', 3, ANON], isNaNv);
    // `nanBehavior: 'propagate'` — this used to stay inert.
    bothRoutes(ce, ['Pochhammer', 3, 'NaN'], isNaNv);
    bothRoutes(ce, ['Pochhammer', 'NaN', 3], isNaNv);
  });

  test('a negative integer k is the reciprocal falling product', () => {
    // (a)_{−m} = 1/((a−1)(a−2)⋯(a−m)): (3)_{−2} = 1/((3−1)(3−2)) = 1/2.
    // This used to stay inert on both routes.
    expect(ce.box(['Pochhammer', 3, -2]).evaluate().isSame(ce.box(['Rational', 1, 2]))).toBe(true);
    expect(ce.box(['Pochhammer', 3, -2]).N().re).toBeCloseTo(0.5, 12);
    // A factor of 0 in that product is a pole of Γ(a+k): a is a positive
    // integer not larger than m, so `a + k` lands on a non-positive integer.
    expect(ce.box(['Pochhammer', 2, -3]).evaluate().isSame(ce.ComplexInfinity)).toBe(
      true
    );
    // A symbolic first operand keeps the factored form.
    expect(ce.box(['Pochhammer', 'a', -2]).evaluate().toString()).toBe(
      '1 / ((a - 1) * (a - 2))'
    );
  });

  test('a non-integer or large k numericizes through the Γ ratio', () => {
    // (2.5)_{1.5} = Γ(4)/Γ(2.5) = 4.5135…; inexact operands numericize under
    // plain evaluate() too. Both used to stay inert on both routes.
    expect(ce.box(['Pochhammer', 2.5, 1.5]).evaluate().re).toBeCloseTo(
      4.51351666838205,
      10
    );
    // (3)_{100} = Γ(103)/Γ(3) = 4.807…·10¹⁶¹. Past the exact-expansion cap
    // the evaluate route stays symbolic; .N() answers.
    expect(ce.box(['Pochhammer', 3, 100]).evaluate().operator).toBe(
      'Pochhammer'
    );
    expect(ce.box(['Pochhammer', 3, 100]).N().re / 4.807233357517563e161).toBeCloseTo(
      1,
      12
    );
  });

  test('a Γ pole at a finite point', () => {
    // Γ(a) on a pole and Γ(a+k) not: 1/Γ(a) = 0, so the value is 0.
    // ((−3)_{0.5} = 0; this used to stay inert.)
    bothRoutes(ce, ['Pochhammer', -3, 0.5], isValue(0));
    // Γ(a+k) on a pole and Γ(a) not: the unsigned ~oo.
    bothRoutes(
      ce,
      ['Pochhammer', 0.5, -100.5],
      isValue(ce.ComplexInfinity)
    );
  });

  test('the ordinary finite values are unchanged', () => {
    expect(ce.box(['Pochhammer', 3, 2]).evaluate().isSame(12)).toBe(true);
    expect(ce.box(['Pochhammer', -3, 5]).evaluate().isSame(0)).toBe(true);
    expect(
      ce.box(['Pochhammer', ['Rational', 1, 2], 2]).evaluate().toString()
    ).toBe('3/4');
    expect(ce.box(['Pochhammer', 'a', 3]).evaluate().toString()).toBe(
      'a * (a + 1) * (a + 2)'
    );
    // A complex first operand with a small integer k folds through the same
    // finite product: (i)_2 = i(i+1) = −1 + i.
    expect(
      ce
        .box(['Pochhammer', ['Complex', 0, 1], 2])
        .evaluate()
        .isSame(ce.box(['Complex', -1, 1]))
    ).toBe(true);
  });
});

describe('GammaRegularized', () => {
  const ce = new ComputeEngine();
  const isNaNv = (v: Expression) => v.isSame(ce.NaN);

  test('the infinite points', () => {
    // Q(a, +∞) = 0 for every PROVABLY finite a (Q(2, 10⁶) = 10^(−434289)).
    bothRoutes(ce, ['GammaRegularized', 2, POS], isValue(0));
    // Q(+∞, z) = 1 for every provably finite z, a negative one included
    // (Q(10⁶, −5) = 1).
    bothRoutes(ce, ['GammaRegularized', POS, 2], isValue(1));
    bothRoutes(ce, ['GammaRegularized', POS, -5], isValue(1));
    // Q(a, −∞) for a NON-INTEGER a: complex on the negative half-line
    // (Q(0.5, −1) = 1 − 1.65i), so no limit on the extended real line.
    bothRoutes(ce, ['GammaRegularized', 0.5, NEG], isNaNv);
    // Q(−∞, z): identically 0 at every negative integer a, diverging to −∞
    // between consecutive poles (Q(−10⁶−¼, 2) = −7·10^5264672).
    bothRoutes(ce, ['GammaRegularized', NEG, 2], isNaNv);
    bothRoutes(ce, ['GammaRegularized', COO, 2], isNaNv);
    bothRoutes(ce, ['GammaRegularized', 2, COO], isNaNv);
    bothRoutes(ce, ['GammaRegularized', POS, POS], isNaNv);
    bothRoutes(ce, ['GammaRegularized', ANON, 2], isNaNv);
    bothRoutes(ce, ['GammaRegularized', 2, ANON], isNaNv);
    bothRoutes(ce, ['GammaRegularized', 'NaN', 2], isNaNv);
    bothRoutes(ce, ['GammaRegularized', 2, 'NaN'], isNaNv);
  });

  test('Q(n, −∞) diverges with the sign of the leading term', () => {
    // Q(n, z) = e^{−z}·Σ_{k<n} z^k/k! for a positive integer n, so at
    // z → −∞ the sum takes the sign of z^{n−1}, that is (−1)^{n−1}, while
    // e^{−z} grows without bound. Measured at z = −10², −10⁴ and −10⁶:
    // n = 1 → +2.7·10^43, +8.8·10^4342, +3.0·10^434294;
    // n = 2 → −2.7·10^45, −8.8·10^4346, −3.0·10^434300;
    // n = 3 → +1.3·10^47, +4.4·10^4350, +1.5·10^434306;
    // n = 4 → −4.3·10^48, −1.5·10^4354, −5.1·10^434311.
    // The whole family used to answer NaN.
    bothRoutes(ce, ['GammaRegularized', 1, NEG], isValue(ce.PositiveInfinity));
    bothRoutes(ce, ['GammaRegularized', 2, NEG], isValue(ce.NegativeInfinity));
    bothRoutes(ce, ['GammaRegularized', 3, NEG], isValue(ce.PositiveInfinity));
    bothRoutes(ce, ['GammaRegularized', 4, NEG], isValue(ce.NegativeInfinity));
  });

  test('Q(a, −∞) classifies `a`, and only a LITERAL one', () => {
    // The row above holds for a positive INTEGER `a`, so the −∞ arm has to
    // read `a` the way the +∞ arm reads its partner: it used to answer `NaN`
    // for everything that was not a positive-integer literal.
    //
    // A non-positive integer `a` is a pole of Γ, where `1/Γ(a) = 0` makes
    // `Q(a, z)` vanish at every nonzero finite `z` (pinned below in "Q(a, z)
    // vanishes at a pole of Γ(a)"), so the limit at `z → −∞` is 0 too.
    bothRoutes(ce, ['GammaRegularized', -1, NEG], isValue(0));
    bothRoutes(ce, ['GammaRegularized', 0, NEG], isValue(0));
    bothRoutes(ce, ['GammaRegularized', -3, NEG], isValue(0));
    // A real literal that is provably not an integer keeps `NaN`.
    bothRoutes(ce, ['GammaRegularized', 2.5, NEG], isNaNv);
    // A SYMBOL stays symbolic: it may hold a positive integer, whose value
    // here is ±∞, and `NaN` could not be taken back.
    const e = new ComputeEngine();
    e.declare('nint', 'integer');
    expect(e.box(['GammaRegularized', 'nint', NEG]).evaluate().operator).toBe(
      'GammaRegularized'
    );
    expect(e.box(['GammaRegularized', 'nint', NEG]).N().operator).toBe(
      'GammaRegularized'
    );
    expect(e.box(['GammaRegularized', 'fresh', NEG]).evaluate().operator).toBe(
      'GammaRegularized'
    );
  });

  test('an unproven finite partner keeps the +∞ arm symbolic', () => {
    // `Q(a, +∞) = 0` and `Q(+∞, z) = 1` hold for a FINITE partner only — an
    // infinite one has no limit (NaN) — so the fold needs the finiteness
    // proven. A symbol declared `real` proves it; one whose type admits an
    // infinity does not, and folding on `isFinite === undefined` would be
    // irreversible. Both used to fold on any partner that was not provably
    // infinite.
    const e = new ComputeEngine();
    e.declare('afin', 'real');
    e.declare('ainf', 'real | signed_infinity');
    e.declare('zfin', 'real');
    e.declare('zinf', 'real | signed_infinity');
    expect(e.box(['GammaRegularized', 'afin', POS]).evaluate().isSame(0)).toBe(
      true
    );
    expect(e.box(['GammaRegularized', 'ainf', POS]).evaluate().operator).toBe(
      'GammaRegularized'
    );
    expect(e.box(['GammaRegularized', POS, 'zfin']).evaluate().isSame(1)).toBe(
      true
    );
    expect(e.box(['GammaRegularized', POS, 'zinf']).evaluate().operator).toBe(
      'GammaRegularized'
    );
  });

  test('Q(a, 0) = 1 needs a provably positive a', () => {
    bothRoutes(ce, ['GammaRegularized', 3, 0], isValue(1));
    // A non-positive integer a puts a pole in BOTH Γ(a, 0) and Γ(a): an ∞/∞
    // with no value. This used to fold to 1.
    bothRoutes(ce, ['GammaRegularized', -1, 0], isNaNv);
    bothRoutes(ce, ['GammaRegularized', 0, 0], isNaNv);
    // A negative non-integer a diverges there (Q(−0.5, 10⁻⁶) = −563, growing
    // like sign(Γ(a))·z^a). The whole a < 0 region is a capability gap in
    // this head, so it stays symbolic rather than answer at this one point.
    bothRoutes(
      ce,
      ['GammaRegularized', -0.5, 0],
      isSymbolic('GammaRegularized')
    );
    // An unproven symbolic a no longer folds either.
    expect(
      ce.box(['GammaRegularized', 'a', 0]).evaluate().operator
    ).toBe('GammaRegularized');
  });

  test('Q(a, z) = 0 at every non-positive integer a', () => {
    // 1/Γ(a) = 0 there. These used to be inert on evaluate() and NaN under
    // .N() — a route split AND a misreport.
    bothRoutes(ce, ['GammaRegularized', -1, 2], isValue(0));
    bothRoutes(ce, ['GammaRegularized', 0, 2], isValue(0));
    bothRoutes(ce, ['GammaRegularized', -2, 5], isValue(0));
  });

  test('Q(n, z) for a positive integer n is a finite closed form', () => {
    // Q(n, z) = e^{−z}·Σ_{k<n} z^k/k!, exact on the whole real line — the
    // z < 0 half the kernel cannot reach included.
    expect(ce.box(['GammaRegularized', 2, -1]).evaluate().isSame(0)).toBe(true);
    expect(ce.box(['GammaRegularized', 3, -1]).N().re).toBeCloseTo(
      1.35914091423,
      10
    );
    expect(ce.box(['GammaRegularized', 4, -2]).N().re).toBeCloseTo(
      -2.46301869964,
      10
    );
    // It agrees with the kernel on the z > 0 half.
    expect(ce.box(['GammaRegularized', 2, 3]).evaluate().toString()).toBe(
      '4 / e^3'
    );
    expect(ce.box(['GammaRegularized', 2, 3]).N().re).toBeCloseTo(
      0.199148273471455,
      12
    );
    expect(ce.box(['GammaRegularized', 3, 10]).N().re).toBeCloseTo(
      0.002769395715511576,
      15
    );
  });

  test('a region the kernel does not cover stays SYMBOLIC, never NaN', () => {
    // Q(−0.5, 2) = −0.0085, a perfectly good finite real the real kernel
    // (which needs a > 0) cannot compute; it used to answer NaN on both
    // routes. Q(0.5, −1) = 1 − 1.65i is complex; there is no complex kernel.
    bothRoutes(
      ce,
      ['GammaRegularized', -0.5, 2],
      isSymbolic('GammaRegularized')
    );
    bothRoutes(
      ce,
      ['GammaRegularized', 0.5, -1],
      isSymbolic('GammaRegularized')
    );
    bothRoutes(
      ce,
      ['GammaRegularized', ['Complex', 1, 1], 2],
      isSymbolic('GammaRegularized')
    );
  });
});

describe('BetaRegularized', () => {
  const ce = new ComputeEngine();
  const isNaNv = (v: Expression) => v.isSame(ce.NaN);

  test('the +∞ limits of the two shape parameters', () => {
    // I_x(a, +∞) → 1 for 0 < x ≤ 1 (I_{0.001}(2, 10⁶) = 1), 0 at x = 0: the
    // Beta(a, b) law concentrates at 0.
    bothRoutes(ce, ['BetaRegularized', 0.3, 2, POS], isValue(1));
    bothRoutes(ce, ['BetaRegularized', 1, 2, POS], isValue(1));
    bothRoutes(ce, ['BetaRegularized', 0, 2, POS], isValue(0));
    // I_x(+∞, b) → 0 for 0 ≤ x < 1 (I_{0.9}(10⁶, 3) = 10⁻⁴⁵⁷⁴⁸), 1 at x = 1.
    bothRoutes(ce, ['BetaRegularized', 0.3, POS, 3], isValue(0));
    bothRoutes(ce, ['BetaRegularized', 0, POS, 3], isValue(0));
    bothRoutes(ce, ['BetaRegularized', 1, POS, 3], isValue(1));
    // Both +∞: the limit follows the ratio a/(a+b) rather than either
    // operand — I_{0.3}(R, R) → 0 while I_{0.5}(R, R) = 0.5 for every R.
    bothRoutes(ce, ['BetaRegularized', 0.3, POS, POS], isNaNv);
    // The two endpoints survive that indeterminacy: I_0(a, b) = 0 and
    // I_1(a, b) = 1 for every positive a and b, limits included.
    bothRoutes(ce, ['BetaRegularized', 0, POS, POS], isValue(0));
    bothRoutes(ce, ['BetaRegularized', 1, POS, POS], isValue(1));
  });

  test('both +∞ claims NaN only inside the open unit interval', () => {
    // The indeterminacy is established for x in (0, 1) and nowhere else. At a
    // symbolic x, a complex x, or a real x outside [0, 1] the head has
    // nothing to say at a FINITE a and b either, so it stays symbolic — a
    // capability gap reported as NaN would claim a defined value is
    // indeterminate. Every one of these used to answer NaN.
    bothRoutes(ce, ['BetaRegularized', ['Rational', 1, 2], POS, POS], isNaNv);
    for (const expr of [
      ['BetaRegularized', 'bx', POS, POS],
      ['BetaRegularized', 2, POS, POS],
      ['BetaRegularized', -1, POS, POS],
      ['BetaRegularized', ['Complex', 0, 1], POS, POS],
    ])
      bothRoutes(ce, expr, isSymbolic('BetaRegularized'));
  });

  test('an unproven partner parameter keeps the +∞ arm symbolic', () => {
    // The +∞ limits above hold for a positive finite partner; nothing is
    // proven for a symbolic or non-positive one.
    bothRoutes(
      ce,
      ['BetaRegularized', 0.3, 'a', POS],
      isSymbolic('BetaRegularized')
    );
    bothRoutes(
      ce,
      ['BetaRegularized', 0.3, -1, POS],
      isSymbolic('BetaRegularized')
    );
    // Outside x ∈ [0, 1] there is no arm either.
    bothRoutes(
      ce,
      ['BetaRegularized', 2, 2, POS],
      isSymbolic('BetaRegularized')
    );
  });

  test('every other infinite point stays SYMBOLIC, never NaN', () => {
    // The head answers on x ∈ [0, 1], a > 0, b > 0 and is symbolic outside it
    // at finite points too. `NaN` would misreport a capability gap: for
    // integer a and b, I_x(a, b) is a polynomial in x with a good real limit
    // at ±∞ (I_x(2, 3) = 3x⁴ − 8x³ + 6x² → +∞ at both ends, measured
    // 3.0·10²⁴ at x = ±10⁶).
    for (const expr of [
      ['BetaRegularized', POS, 2, 3],
      ['BetaRegularized', NEG, 2, 3],
      ['BetaRegularized', COO, 2, 3],
      ['BetaRegularized', 0.3, NEG, 3],
      ['BetaRegularized', 0.3, 2, NEG],
      ['BetaRegularized', 0.3, COO, 3],
      ['BetaRegularized', 0.3, ANON, 3],
    ])
      bothRoutes(ce, expr, isSymbolic('BetaRegularized'));
  });

  test('I_0 = 0 and I_1 = 1 need provably positive a and b', () => {
    bothRoutes(ce, ['BetaRegularized', 0, 2, 3], isValue(0));
    bothRoutes(ce, ['BetaRegularized', 1, 2, 3], isValue(1));
    // Below zero the incomplete integral diverges at the endpoint and the
    // endpoint values are not 0 and 1 (I_1(−1, 3) and I_1(2, −1) are NaN in a
    // high-precision reference). These used to fold unconditionally.
    for (const expr of [
      ['BetaRegularized', 0, -1, 3],
      ['BetaRegularized', 1, -1, 3],
      ['BetaRegularized', 0, 2, -1],
      ['BetaRegularized', 1, 2, -1],
      ['BetaRegularized', 0, 'a', 'b'],
      ['BetaRegularized', 1, 'a', 'b'],
    ])
      bothRoutes(ce, expr, isSymbolic('BetaRegularized'));
  });

  test('a NaN operand propagates', () => {
    bothRoutes(ce, ['BetaRegularized', 'NaN', 2, 3], isNaNv);
    bothRoutes(ce, ['BetaRegularized', 0.3, 'NaN', 3], isNaNv);
    bothRoutes(ce, ['BetaRegularized', 0.3, 2, 'NaN'], isNaNv);
  });

  test('the ordinary finite values are unchanged', () => {
    expect(ce.box(['BetaRegularized', 0.3, 2, 3]).N().re).toBeCloseTo(
      0.3483,
      12
    );
    expect(
      ce.box(['BetaRegularized', ['Rational', 3, 10], 2, 3]).evaluate().operator
    ).toBe('BetaRegularized');
  });
});

describe('the flipped declarations and the routes', () => {
  test('every numeric slot takes the Γ-family carrier', () => {
    const ce = new ComputeEngine();
    for (const [head, arity] of [
      ['Binomial', 2],
      ['Choose', 2],
      ['Pochhammer', 2],
      ['GammaRegularized', 2],
      ['BetaRegularized', 3],
    ] as const) {
      const sig = ce.box(head).type.toString();
      expect(sig).toContain('complex | infinity');
      expect(sig.endsWith('-> number')).toBe(true);
      // An infinite operand is a VALUE in the carrier, so the application is
      // valid at boxing rather than an `incompatible-type` Error.
      const ops = Array.from({ length: arity }, () => POS);
      expect(ce.box([head, ...ops] as any).isValid).toBe(true);
    }
  });

  test('a fresh symbol used as an operand infers the carrier', () => {
    // The flipped carrier is what a valueless symbol narrows to on use.
    const ce = new ComputeEngine();
    ce.box(['Binomial', 'nFresh', 'kFresh']).evaluate();
    expect(ce.box('nFresh').type.toString()).toBe('complex | infinity');
    expect(ce.box('kFresh').type.toString()).toBe('complex | infinity');
  });

  test('the box, parse and function routes agree', () => {
    const ce = new ComputeEngine();
    const rows: [any, string, string][] = [
      [['Binomial', POS, 2], '\\binom{\\infty}{2}', '+oo'],
      [['Binomial', 5, NEG], '\\binom{5}{-\\infty}', '0'],
      [['Pochhammer', 3, -2], '\\operatorname{Pochhammer}(3,-2)', '1/2'],
      [
        ['GammaRegularized', -1, 2],
        '\\operatorname{GammaRegularized}(-1,2)',
        '0',
      ],
      [
        ['BetaRegularized', 0.3, 2, POS],
        '\\operatorname{BetaRegularized}(0.3,2,\\infty)',
        '1',
      ],
    ];
    for (const [json, latex, expected] of rows) {
      expect(ce.box(json).evaluate().toString()).toBe(expected);
      expect(ce.parse(latex).evaluate().toString()).toBe(expected);
      const [head, ...ops] = json as any[];
      expect(
        ce
          .function(
            head,
            ops.map((o) => ce.box(o))
          )
          .evaluate()
          .toString()
      ).toBe(expected);
    }
  });

  test('the discrete CDFs that delegate here are unchanged', () => {
    // CDF(Poisson(λ), k) lowers to Q(k+1, λ) and CDF(Binomial(n, p), k) to
    // I_{1−p}(n−k, k+1); their finite values must not move.
    const ce = new ComputeEngine();
    expect(
      ce.box(['CDF', ['PoissonDistribution', 2], 3]).N().re
    ).toBeCloseTo(0.857123460498547, 12);
    expect(
      ce.box(['CDF', ['BinomialDistribution', 10, 0.3], 4]).N().re
    ).toBeCloseTo(0.8497316674, 9);
    expect(
      ce
        .box(['CDF', ['BinomialDistribution', 15, ['Rational', 3, 4]], 12])
        .N().re
    ).toBeCloseTo(0.7639121888205409, 10);
  });
});
