/**
 * Contract B carriers for the probability distributions: the five
 * constructor heads (`NormalDistribution` … `ExponentialDistribution`) and
 * the three operators that consume them (`PDF`, `CDF`, `Quantile`).
 *
 * The flip is recorded in
 * `docs/plans/2026-08-30-error-model-implementation.md`, Phase F, the
 * distributions record. Every parameter now carries its mathematical domain:
 * a distribution parameter is a finite real (a probability a `real<0..1>`),
 * an evaluation point is `real | signed_infinity`, and a quantile
 * probability is `real<0..1>`. `NaN` is refused in a parameter slot and
 * propagated in a point/probability slot.
 *
 * Two seams enforce that, and which one applies depends on whether the head
 * has a `canonical` handler:
 *
 * - `PDF`/`CDF`/`Quantile` have none, so the boxing-time signature
 *   validation refuses an off-carrier LITERAL and the dispatch-time
 *   conformance re-test refuses the value a SYMBOL holds.
 * - The five constructors have one, and `applyOperatorDefinition`
 *   (`boxed-expression/box.ts`) then re-runs only the lenient
 *   `checkNumericArgs` on the handler's result. The handler itself is
 *   therefore the enforcement seam, and it mints the same
 *   `incompatible-type` error the boxing seam would.
 *
 * A local engine per `describe`: a shared one leaks the symbol inference
 * these carriers now perform.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { infinitePoint } from '../../src/compute-engine/boxed-expression/infinite-point';

const NORMAL = ['NormalDistribution', 0, 1];
const UNIFORM = ['UniformDistribution', 0, 1];
const EXPONENTIAL = ['ExponentialDistribution', 2];
const POISSON = ['PoissonDistribution', 2];
const BINOMIAL = ['BinomialDistribution', 10, 0.5];

const ALL: [string, any][] = [
  ['NormalDistribution', NORMAL],
  ['UniformDistribution', UNIFORM],
  ['ExponentialDistribution', EXPONENTIAL],
  ['PoissonDistribution', POISSON],
  ['BinomialDistribution', BINOMIAL],
];

describe('Contract B — distribution constructor carriers', () => {
  const ce = new ComputeEngine();

  test('the declared carriers are the mathematical parameter domains', () => {
    // The carriers are RANGED where the domain is: a canonical-handler head
    // is validated against its declaration at boxing (the boxing validation
    // seam), so a symbol whose held value lies outside the range is refused
    // there, as a literal is refused by the handler. `a < b` for the uniform
    // distribution has no spelling in a type and stays the handler's.
    expect(
      ce.lookupDefinition('NormalDistribution')!.operator!.signature.toString()
    ).toBe('(real, real<0<..>) -> expression<NormalDistribution>');
    expect(
      ce
        .lookupDefinition('BinomialDistribution')!
        .operator!.signature.toString()
    ).toBe('(integer<0..>, real<0..1>) -> expression<BinomialDistribution>');
    expect(
      ce.lookupDefinition('PoissonDistribution')!.operator!.signature.toString()
    ).toBe('(real<0<..>) -> expression<PoissonDistribution>');
    expect(
      ce.lookupDefinition('UniformDistribution')!.operator!.signature.toString()
    ).toBe('(real, real) -> expression<UniformDistribution>');
    expect(
      ce
        .lookupDefinition('ExponentialDistribution')!
        .operator!.signature.toString()
    ).toBe('(real<0<..>) -> expression<ExponentialDistribution>');
  });

  test('every parameter slot rejects NaN', () => {
    for (const [name, arity] of [
      ['NormalDistribution', 2],
      ['BinomialDistribution', 2],
      ['PoissonDistribution', 1],
      ['UniformDistribution', 2],
      ['ExponentialDistribution', 1],
    ] as [string, number][]) {
      const def = ce.lookupDefinition(name)!.operator!;
      for (let i = 0; i < arity; i++)
        expect(def.resolvedNanBehaviorAt(i)).toBe('reject');
    }
  });

  test('a NaN, infinite or complex literal parameter is an incompatible-type error', () => {
    const e = new ComputeEngine();
    for (const mj of [
      ['NormalDistribution', 'NaN', 1],
      ['NormalDistribution', 0, 'NaN'],
      ['NormalDistribution', 'PositiveInfinity', 1],
      ['NormalDistribution', 0, 'PositiveInfinity'],
      ['NormalDistribution', 'ImaginaryUnit', 1],
      ['NormalDistribution', 0, 'ComplexInfinity'],
      ['PoissonDistribution', 'NaN'],
      ['PoissonDistribution', 'PositiveInfinity'],
      ['PoissonDistribution', 'ImaginaryUnit'],
      ['ExponentialDistribution', 'NaN'],
      ['ExponentialDistribution', 'PositiveInfinity'],
      ['ExponentialDistribution', 'ImaginaryUnit'],
      ['UniformDistribution', 'NaN', 1],
      ['UniformDistribution', 'NegativeInfinity', 'PositiveInfinity'],
      ['BinomialDistribution', 10, 'NaN'],
      ['BinomialDistribution', 'NaN', 0.5],
      ['BinomialDistribution', 'PositiveInfinity', 0.5],
    ]) {
      const x = e.box(mj as any);
      expect([mj.toString(), x.isValid]).toEqual([mj.toString(), false]);
      expect(x.toString()).toContain('incompatible-type');
      // The location names the head that raised it, as the statistics data
      // errors do (`dataConstraintError`). It used to carry the offending
      // literal alone, so the error read on its own said nothing about where
      // it came from.
      expect([mj.toString(), x.toString().includes(`${mj[0]}: `)]).toEqual([
        mj.toString(),
        true,
      ]);
    }
  });

  test('a non-integer trial count is off the `integer` carrier, a negative one out of range', () => {
    const e = new ComputeEngine();
    expect(e.box(['BinomialDistribution', 10.5, 0.5]).toString()).toContain(
      'incompatible-type'
    );
    expect(e.box(['BinomialDistribution', -1, 0.5]).toString()).toContain(
      'out-of-range'
    );
  });

  test('a probability outside [0, 1] is a carrier violation, not a range one', () => {
    // The whole condition `0 <= p <= 1` IS the carrier `real<0..1>` — the
    // `Rationalize` tolerance precedent. It used to be an `out-of-range`
    // check inside the canonical handler.
    const e = new ComputeEngine();
    for (const p of [2, -0.5]) {
      const x = e.box(['BinomialDistribution', 10, p]);
      expect(x.isValid).toBe(false);
      expect(x.toString()).toContain('incompatible-type');
    }
  });

  test('the inequality conditions the carriers cannot express stay range checks', () => {
    const e = new ComputeEngine();
    // `real<0..>` would admit sigma = 0, a degenerate distribution with no
    // density, so positivity is not expressible as the carrier.
    expect(e.box(['NormalDistribution', 0, -1]).toString()).toContain(
      'out-of-range'
    );
    expect(e.box(['NormalDistribution', 0, 0]).toString()).toContain(
      'out-of-range'
    );
    expect(e.box(['PoissonDistribution', -2]).toString()).toContain(
      'out-of-range'
    );
    expect(e.box(['ExponentialDistribution', 0]).toString()).toContain(
      'out-of-range'
    );
    expect(e.box(['UniformDistribution', 5, 2]).toString()).toContain(
      'out-of-range'
    );
  });

  test('a symbolic parameter is still admitted', () => {
    const e = new ComputeEngine();
    const x = e.box(['NormalDistribution', 'mu', 'sigma']);
    expect(x.isValid).toBe(true);
    expect(x.type.toString()).toBe('expression<NormalDistribution>');
  });

  test('an off-carrier value a symbol HOLDS is caught when the operand evaluates', () => {
    // The constructor's canonical handler does not read a symbol's value, so
    // nothing fires at boxing. Evaluating the application evaluates the
    // operand to its literal and re-canonicalizes, which does fire.
    const e = new ComputeEngine();
    e.declare('lam', 'real');
    const d = e.box(['PoissonDistribution', 'lam']);
    expect(d.isValid).toBe(true);
    e.assign('lam', -3);
    expect(d.evaluate().toString()).toContain('out-of-range');
    // And the NaN policy answers for a NaN value.
    const e2 = new ComputeEngine();
    e2.assign('bad', NaN);
    expect(e2.box(['PoissonDistribution', 'bad']).evaluate().operator).toBe(
      'Error'
    );
  });
});

describe('Contract B — PDF and CDF carriers', () => {
  const ce = new ComputeEngine();

  test('the declared carriers and per-slot NaN policies', () => {
    for (const [name, result] of [
      ['PDF', 'nan | real<0..>'],
      ['CDF', 'nan | real<0..1>'],
    ] as [string, string][]) {
      const def = ce.lookupDefinition(name)!.operator!;
      expect(def.signature.toString()).toBe(
        `(distribution, real | signed_infinity) -> ${result}`
      );
      // The distribution slot rejects (a distribution is not a number to
      // carry a NaN); the point slot propagates, which the derived default
      // would not give for a non-numeric first parameter.
      expect(def.resolvedNanBehaviorAt(0)).toBe('reject');
      expect(def.resolvedNanBehaviorAt(1)).toBe('propagate');
    }
  });

  test('a point off the `real | signed_infinity` carrier is refused at boxing', () => {
    const e = new ComputeEngine();
    for (const op of ['PDF', 'CDF'])
      for (const [, d] of ALL)
        for (const pt of ['ImaginaryUnit', 'ComplexInfinity']) {
          const x = e.box([op, d, pt] as any);
          expect([op, pt, x.isValid]).toEqual([op, pt, false]);
          expect(x.toString()).toContain('incompatible-type');
        }
  });

  test('a NaN point propagates to NaN', () => {
    const e = new ComputeEngine();
    for (const op of ['PDF', 'CDF'])
      for (const [name, d] of ALL) {
        const v = e.box([op, d, 'NaN'] as any).evaluate();
        expect([op, name, v.isNaN]).toEqual([op, name, true]);
        expect([op, name, e.box([op, d, 'NaN'] as any).N().isNaN]).toEqual([
          op,
          name,
          true,
        ]);
      }
  });

  test('every density vanishes at an infinite point', () => {
    const e = new ComputeEngine();
    for (const [name, d] of ALL)
      for (const pt of ['PositiveInfinity', 'NegativeInfinity']) {
        const x = e.box(['PDF', d, pt] as any);
        expect([name, pt, x.evaluate().re]).toEqual([name, pt, 0]);
        expect([name, pt, x.N().re]).toEqual([name, pt, 0]);
      }
  });

  test('a finite bignum beyond the double range is NOT an infinite point', () => {
    // `10^400` is a finite integer, but its machine projection `.re` is
    // `Infinity`, so a classification that read `.re` sent it through the
    // limit arms: the density answered the `±∞` constant `0` instead of the
    // closed form. `infinitePoint` reads the numeric value and declines.
    const e = new ComputeEngine();
    const big = e.number(10n ** 400n);
    expect(infinitePoint(big)).toBe(undefined);
    // The density of N(0, 10^500) at 10^400 is 1/(10^500·√(2π)) times
    // exp(−10^800/(2·10^1000)) = exp(−5·10^(−201)), that is
    // 3.9894228040143268·10^(−501) — not the `0` of the `±∞` arm.
    // Read as a STRING: `.re` is the double projection, which underflows a
    // magnitude below 10^(−324) to the very `0` this test distinguishes from.
    const d = e
      .box(['PDF', ['NormalDistribution', 0, e.number(10n ** 500n)], big])
      .N()
      .toString();
    expect(d).toMatch(/^3\.98942280401432\d*e-501$/);
    // And the CDF keeps the honest closed form rather than the `+∞` constant.
    expect(
      e
        .box(['CDF', ['NormalDistribution', 0, 1], big])
        .evaluate()
        .toString()
    ).toContain('Erf');
  });

  test('a support comparison uses the exact value, not the double projection', () => {
    // `10^400` and `10^500` both project `.re` to `Infinity`, so a support
    // test that compares the projections put `10^400` at or beyond the top
    // of the support of `UniformDistribution(0, 10^500)`: the CDF answered
    // the saturated `1` instead of `10^400 / 10^500`, and the density
    // answered `0` instead of `1/(b − a)`.
    const e = new ComputeEngine();
    const big = e.number(10n ** 400n);
    const u = ['UniformDistribution', 0, e.number(10n ** 500n)];
    const cdf = e.box(['CDF', u, big] as any);
    expect(cdf.evaluate().isSame(e.parse('\\frac{1}{10^{100}}'))).toBe(true);
    expect(cdf.N().toString()).toBe('1e-100');
    const pdf = e.box(['PDF', u, big] as any);
    expect(pdf.evaluate().isSame(e.parse('\\frac{1}{10^{500}}'))).toBe(true);
    // Below the support the answers stay the constants.
    expect(e.box(['CDF', u, -1] as any).evaluate().re).toBe(0);
    expect(e.box(['PDF', u, -1] as any).evaluate().re).toBe(0);
    // The exponential CDF at such a point is `1` to any precision. Its exact
    // form is the honest `1 − e^(−10^400)`, NOT a comparison against a
    // projected `Infinity`.
    expect(
      e.box(['CDF', ['ExponentialDistribution', 1], big] as any).N().re
    ).toBe(1);
  });

  test('a bignum parameter is on the carrier, an infinity is not', () => {
    // Carrier membership is a question about the VALUE. `10^400` is a finite
    // real standard deviation even though it has no double, so it must not
    // be rejected along with the genuinely off-carrier points.
    const e = new ComputeEngine();
    const big = e.number(10n ** 400n);
    expect(e.box(['NormalDistribution', 0, big] as any).isValid).toBe(true);
    expect(
      e.box(['NormalDistribution', 0, 'PositiveInfinity'] as any).toString()
    ).toContain('incompatible-type');
    // The inequalities the carrier cannot express are still checked at that
    // magnitude: σ > 0 and a < b.
    expect(
      e
        .box(['NormalDistribution', 0, e.number(-(10n ** 400n))] as any)
        .toString()
    ).toContain('out-of-range');
    expect(
      e
        .box(['UniformDistribution', e.number(10n ** 500n), big] as any)
        .toString()
    ).toContain('out-of-range');
    // ...and the ORDERED pair of the same two bounds is valid. `isLess`
    // compares the double projections, which are both `Infinity` here, so
    // `10^400 < 10^500` was not decided there and the pair was refused.
    const u = e.box(['UniformDistribution', big, e.number(10n ** 500n)] as any);
    expect(u.isValid).toBe(true);
    expect(u.toString()).not.toContain('out-of-range');
  });

  test('every CDF reaches 1 at +oo and 0 at -oo', () => {
    const e = new ComputeEngine();
    for (const [name, d] of ALL) {
      // The discrete CDFs used to leave an inert
      // `GammaRegularized(+oo, 2)` / `BetaRegularized(0.5, -oo, +oo)`; the
      // uniform answered the unclamped ramp (`+oo` / `-oo`).
      expect([
        name,
        e.box(['CDF', d, 'PositiveInfinity'] as any).evaluate().re,
      ]).toEqual([name, 1]);
      expect([
        name,
        e.box(['CDF', d, 'NegativeInfinity'] as any).evaluate().re,
      ]).toEqual([name, 0]);
      expect([
        name,
        e.box(['CDF', d, 'PositiveInfinity'] as any).N().re,
      ]).toEqual([name, 1]);
      expect([
        name,
        e.box(['CDF', d, 'NegativeInfinity'] as any).N().re,
      ]).toEqual([name, 0]);
    }
  });

  test('the uniform density is the piecewise, not the constant `1/(b-a)`', () => {
    const e = new ComputeEngine();
    const f = e.box(['PDF', ['UniformDistribution', 2, 5], 'x']).evaluate();
    expect(f.operator).toBe('Which');
    for (const [x, want] of [
      [-1, 0],
      [3.5, 1 / 3],
      [6, 0],
    ] as [number, number][])
      expect([x, f.subs({ x }).N().re]).toEqual([x, want]);
  });

  test('the uniform CDF is the CLAMPED ramp, not the bare ramp', () => {
    const e = new ComputeEngine();
    const f = e.box(['CDF', ['UniformDistribution', 2, 5], 'x']).evaluate();
    expect(f.operator).toBe('Which');
    for (const [x, want] of [
      [1, 0],
      [3.5, 0.5],
      [6, 1],
    ] as [number, number][])
      expect([x, f.subs({ x }).N().re]).toEqual([x, want]);
  });

  test('the exponential density and CDF vanish on the negative half-line', () => {
    const e = new ComputeEngine();
    const pdf = e.box(['PDF', EXPONENTIAL, 'x']).evaluate();
    const cdf = e.box(['CDF', EXPONENTIAL, 'x']).evaluate();
    expect(pdf.operator).toBe('Which');
    expect(cdf.operator).toBe('Which');
    for (const x of [-1, 0.5, 3]) {
      expect([x, pdf.subs({ x }).N().re]).toEqual([
        x,
        x < 0 ? 0 : 2 * Math.exp(-2 * x),
      ]);
      expect([x, cdf.subs({ x }).N().re]).toEqual([
        x,
        x < 0 ? 0 : 1 - Math.exp(-2 * x),
      ]);
    }
  });

  test('the Poisson mass is 0 off the non-negative integers', () => {
    const e = new ComputeEngine();
    // `PDF(PoissonDistribution(2), -1)` used to lower to `1/(~oo * e^2)`,
    // the closed form divided by `(-1)!`.
    expect(e.box(['PDF', POISSON, -1]).evaluate().re).toBe(0);
    expect(e.box(['PDF', POISSON, -3]).evaluate().re).toBe(0);
    expect(e.box(['PDF', POISSON, 2.5]).evaluate().re).toBe(0);
  });

  test('an off-scale Poisson index stays symbolic on the exact route', () => {
    // `Factorial(10^400)` has more digits than the machine can hold and does
    // not return, so the closed form is off limits at such an index. Under
    // `.N()` the answer is the underflow to `0`, the numeric route's honest
    // reading. The EXACT route used to give that same `0`, which is not the
    // value: at `k = lambda = 10^400` the mass is about `1/sqrt(2*pi*k)`, and
    // an exact result must not report a number the head did not compute.
    const e = new ComputeEngine();
    const big = e.number(10n ** 400n);
    const pdf = e.box(['PDF', POISSON, big] as any);
    expect(pdf.evaluate().operator).toBe('PDF');
    expect(pdf.N().re).toBe(0);
  });

  test('a support bound is decided by the exact value, not by equal doubles', () => {
    // `1 + 10^(-20)` and `1` round to the SAME double, so a support test that
    // compared the projections reported them EQUAL and put a point just
    // outside the support on its boundary.
    const e = new ComputeEngine();
    const above = e.parse('1+\\frac{1}{10^{20}}').evaluate();
    // Just above the top of `[0, 1]`: no density.
    expect(e.box(['PDF', UNIFORM, above] as any).evaluate().re).toBe(0);
    // Just above the bottom of `[1, 2]`: the honest ramp `10^(-20)`, where
    // the equal-double reading answered the clamped `0`.
    expect(
      e
        .box(['CDF', ['UniformDistribution', 1, 2], above] as any)
        .evaluate()
        .isSame(e.parse('\\frac{1}{10^{20}}'))
    ).toBe(true);
    // ...and the density there is the constant `1/(b - a)`, not `0`.
    expect(
      e
        .box(['PDF', ['UniformDistribution', 1, 2], above] as any)
        .evaluate()
        .isSame(1)
    ).toBe(true);
    // A point just BELOW the bottom of `[1, 2]` still has no density.
    const below = e.parse('1-\\frac{1}{10^{20}}').evaluate();
    expect(
      e.box(['PDF', ['UniformDistribution', 1, 2], below] as any).evaluate().re
    ).toBe(0);
  });

  test('the finite closed forms are unchanged', () => {
    const e = new ComputeEngine();
    // `Q(3, 2)` has the exact closed form `e^{-2}(1 + 2 + 2)` for a
    // positive-integer first operand, so the Poisson CDF evaluates to it;
    // `.N()` is the same 0.6767… either way.
    expect(e.box(['CDF', POISSON, 2.5]).evaluate().toString()).toBe('5 / e^2');
    expect(e.box(['CDF', BINOMIAL, 2.5]).evaluate().re).toBe(0.0546875);
    expect(e.box(['CDF', NORMAL, 'x']).evaluate().toString()).toBe(
      '1/2 * (Erf(sqrt(2)/2 * x) + 1)'
    );
  });

  test('a fresh symbol at the point slot is inferred `real | signed_infinity`', () => {
    const e = new ComputeEngine();
    e.box(['PDF', UNIFORM, 'pt']);
    expect(e.symbol('pt').type.toString()).toBe('real | signed_infinity');
  });
});

describe('Contract B — Quantile carrier', () => {
  const ce = new ComputeEngine();

  test('the declared carrier and per-slot NaN policies', () => {
    const def = ce.lookupDefinition('Quantile')!.operator!;
    expect(def.signature.toString()).toBe(
      '(collection<any> | distribution, real<0..1>) -> nan | real | signed_infinity'
    );
    expect(def.resolvedNanBehaviorAt(0)).toBe('reject');
    expect(def.resolvedNanBehaviorAt(1)).toBe('propagate');
  });

  test('a probability outside [0, 1] is refused at boxing, not at evaluation', () => {
    // It used to be an `out-of-range` Error the handler minted at
    // evaluation; the `real<0..1>` carrier settles it at boxing.
    const e = new ComputeEngine();
    for (const p of [1.5, -0.5, 'PositiveInfinity', 'ImaginaryUnit']) {
      const x = e.box(['Quantile', UNIFORM, p] as any);
      expect([p, x.isValid]).toEqual([p, false]);
      expect(x.toString()).toContain('incompatible-type');
    }
  });

  test('an out-of-range probability a SYMBOL holds is refused too', () => {
    const e = new ComputeEngine();
    e.assign('pp', 1.5);
    const x = e.box(['Quantile', UNIFORM, 'pp']).evaluate();
    expect(x.operator).toBe('Error');
    expect(x.toString()).toContain('incompatible-type');
  });

  test('a NaN probability propagates for every distribution', () => {
    const e = new ComputeEngine();
    for (const [name, d] of ALL) {
      // `Quantile(BinomialDistribution(...), NaN)` and the Poisson one were
      // inert before the policy applied.
      expect([
        name,
        e.box(['Quantile', d, 'NaN'] as any).evaluate().isNaN,
      ]).toEqual([name, true]);
      expect([name, e.box(['Quantile', d, 'NaN'] as any).N().isNaN]).toEqual([
        name,
        true,
      ]);
    }
  });

  test('the boundary probabilities keep their values', () => {
    const e = new ComputeEngine();
    for (const [d, at0, at1] of [
      [NORMAL, '-oo', '+oo'],
      [UNIFORM, '0', '1'],
      [EXPONENTIAL, '0', '+oo'],
      [BINOMIAL, '0', '10'],
      [POISSON, '0', '+oo'],
    ] as [any, string, string][]) {
      expect(e.box(['Quantile', d, 0]).evaluate().toString()).toBe(at0);
      expect(e.box(['Quantile', d, 1]).evaluate().toString()).toBe(at1);
    }
  });

  test('a discrete quantile searches under `.N()` only, agreeing with a direct cumulative sum', () => {
    // The search in `numerics/distributions.ts` compares the machine CDF
    // against `p` with a tolerance, so it cannot certify an EXACT integer:
    // an exact `p` a hair above a CDF jump would select the previous support
    // point. It therefore stays on the `.N()` route, where the answer is a
    // float, and `evaluate()` leaves the application symbolic.
    const e = new ComputeEngine();
    const fact = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
    const poiPmf = (k: number) => (Math.exp(-2) * 2 ** k) / fact[k];
    const binom = (n: number, k: number) => {
      let r = 1;
      for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
      return r;
    };
    const binPmf = (k: number) => binom(10, k) * 0.5 ** 10;
    for (const p of [0.1, 0.3, 0.5, 0.9, 0.99]) {
      let s = 0;
      let k = 0;
      while (s + poiPmf(k) < p) s += poiPmf(k++);
      expect([p, e.box(['Quantile', POISSON, p]).N().re]).toEqual([p, k]);
      let s2 = 0;
      let k2 = 0;
      while (s2 + binPmf(k2) < p) s2 += binPmf(k2++);
      expect([p, e.box(['Quantile', BINOMIAL, p]).N().re]).toEqual([p, k2]);
      expect([p, e.box(['Quantile', POISSON, p]).evaluate().operator]).toEqual([
        p,
        'Quantile',
      ]);
      expect([p, e.box(['Quantile', BINOMIAL, p]).evaluate().operator]).toEqual(
        [p, 'Quantile']
      );
    }
  });

  test('the empirical quantile absorbs an absent datum and an empty sample', () => {
    const e = new ComputeEngine();
    expect(
      e
        .box(['Quantile', ['List', 1, 2, 3, 4], 0.5])
        .evaluate()
        .toString()
    ).toBe('5/2');
    expect(
      e.box(['Quantile', ['List', 1, 'NaN', 3], 0.5]).evaluate().isNaN
    ).toBe(true);
    // An empty sample has no order statistics: `NaN`, where the application
    // used to stay inert.
    expect(e.box(['Quantile', ['List'], 0.5]).evaluate().isNaN).toBe(true);
  });

  test('the empirical quantile ranks its data verdicts as the statistics heads do', () => {
    // `collectData` (`library/statistics.ts`) ranks ERROR > ABSENT > INERT,
    // and `Quantile` has to reach the same verdict for the same sample as
    // `Median` does. It used to treat every non-literal datum as provably
    // non-numeric, so a valueless symbol and a `Missing` were both refused
    // with an `incompatible-type` error.
    const e = new ComputeEngine();
    e.declare('y', 'number');
    // INERT: a valueless symbol could still be a number, so a later
    // assignment must be able to answer.
    const inert = e.box(['Quantile', ['List', 1, 'y', 3], 0.5]).evaluate();
    expect(inert.operator).toBe('Quantile');
    // ...and a numeric expression with no literal reading yet, likewise.
    expect(
      e.box(['Quantile', ['List', 1, ['Sqrt', -2], 3], 0.5]).evaluate().operator
    ).toBe('Quantile');
    // ABSENT: `Missing` makes the whole aggregate `NaN` (§3.C), as the `NaN`
    // datum already did.
    expect(
      e.box(['Quantile', ['List', 1, 'Missing', 3], 0.5]).evaluate().isNaN
    ).toBe(true);
    // ERROR still outranks ABSENT: a refused datum is diagnosed even with an
    // absent one beside it.
    const err = e
      .box(['Quantile', ['List', 'Missing', { str: 'a' }, 3], 0.5])
      .evaluate();
    expect(err.operator).toBe('Error');
    expect(err.toString()).toContain('incompatible-type');
  });

  test('the empirical quantile refuses a non-numeric datum by VALUE', () => {
    // A string IS a `collection<any>`, so the carrier admits it and the
    // refusal has to come from the handler. It used to stay inert.
    const e = new ComputeEngine();
    for (const mj of [
      ['Quantile', { str: 'abc' }, 0.5],
      ['Quantile', ['List', 1, { str: 'a' }, 3], 0.5],
      ['Quantile', ['List', 1, 'True', 3], 0.5],
    ]) {
      const x = e.box(mj as any).evaluate();
      expect([mj.toString(), x.operator]).toEqual([mj.toString(), 'Error']);
      expect(x.toString()).toContain('incompatible-type');
      // The constraint names `number`, not `real`: the datum is not a number
      // at all. `real` is for a NUMERIC datum with no finite real reading —
      // the complex case below. Same split as the statistics heads.
      expect([mj.toString(), x.toString().includes('"number"')]).toEqual([
        mj.toString(),
        true,
      ]);
    }
  });

  test('a complex datum is still refused, and the boundary exits never hand one back', () => {
    const e = new ComputeEngine();
    const x = e
      .box(['Quantile', ['List', 1, ['Complex', 1, 2], 3], 0.5])
      .evaluate();
    expect(x.operator).toBe('Error');
    expect(x.toString()).toContain('"real"');
  });
});

describe('Contract B — distribution moments are unaffected by the flip', () => {
  test('Mean, Variance and StandardDeviation keep their closed forms', () => {
    const e = new ComputeEngine();
    const want: [any, string, string, string][] = [
      [NORMAL, '0', '1', '1'],
      [UNIFORM, '1/2', '1/12', 'sqrt(3)/6'],
      [EXPONENTIAL, '1/2', '1/4', '1/2'],
      [POISSON, '2', '2', 'sqrt(2)'],
      [BINOMIAL, '5', '2.5', '1.581138830084189666'],
    ];
    for (const [d, mean, variance, sd] of want) {
      expect(e.box(['Mean', d]).evaluate().toString()).toBe(mean);
      expect(e.box(['Variance', d]).evaluate().toString()).toBe(variance);
      expect(e.box(['StandardDeviation', d]).evaluate().toString()).toBe(sd);
    }
  });
});

describe('exact rationals at the edge of the double range in a CDF', () => {
  // Both points used to answer through a `Divide` fold that read the double
  // projection of the exact argument (`asBigint`, `boxed-expression/numerics.ts`).
  test('CDF(Uniform(0, 1), 10^-400) is 10^-400, not 0', () => {
    const e = new ComputeEngine();
    const tiny = e.box(['Power', 10, -400]).evaluate();
    const cdf = e.box(['CDF', UNIFORM, tiny] as any).evaluate();
    expect(cdf.isSame(tiny)).toBe(true);
    expect(cdf.isSame(0)).toBe(false);
  });

  test('CDF(Uniform(0, 1), 1 - 10^-20) is 1 - 10^-20, not 1', () => {
    const e = new ComputeEngine();
    const below = e.parse('1-\\frac{1}{10^{20}}').evaluate();
    const cdf = e.box(['CDF', UNIFORM, below] as any).evaluate();
    expect(cdf.isSame(below)).toBe(true);
    expect(cdf.isSame(1)).toBe(false);
  });
});

describe('a discrete pmf or CDF at a symbolic point agrees with the literal route', () => {
  // The bare closed forms used to be the continuous interpolation: with
  // `x := 0.5` afterwards, `PDF(PoissonDistribution(2), x)` answered `0.216`
  // where the literal `PDF(PoissonDistribution(2), 0.5)` answers `0`, and the
  // CDF omitted the `Floor` the literal route applies. The symbolic forms now
  // carry the same support guard (`Which` on integrality and sign, `Floor`
  // in the CDF), and drop each clause the point's type already proves.
  const at = (form: any, x: number) =>
    form.subs({ x: x }).N().re as number;

  test('Poisson pmf', () => {
    const e = new ComputeEngine();
    const sym = e.box(['PDF', POISSON, 'x']).evaluate();
    expect(sym.operator).toBe('Which');
    for (const x of [0, 1, 3, 0.5, 2.5, -1]) {
      const lit = e.box(['PDF', POISSON, x]).N().re as number;
      expect(at(sym, x)).toBeCloseTo(lit, 12);
    }
    expect(at(sym, 0.5)).toBe(0);
    expect(at(sym, -1)).toBe(0);
  });

  test('Poisson CDF', () => {
    const e = new ComputeEngine();
    const sym = e.box(['CDF', POISSON, 'x']).evaluate();
    expect(sym.operator).toBe('Which');
    for (const x of [0, 1, 3, 0.5, 2.5, -1, -0.5]) {
      const lit = e.box(['CDF', POISSON, x]).N().re as number;
      expect(at(sym, x)).toBeCloseTo(lit, 12);
    }
    expect(at(sym, -1)).toBe(0);
  });

  test('binomial pmf and CDF, with the top of the support', () => {
    const e = new ComputeEngine();
    const B = ['BinomialDistribution', 5, 0.5];
    const pmf = e.box(['PDF', B, 'x']).evaluate();
    const cdf = e.box(['CDF', B, 'x']).evaluate();
    expect(pmf.operator).toBe('Which');
    expect(cdf.operator).toBe('Which');
    for (const x of [0, 2, 5, 2.5, 6, -1]) {
      expect(at(pmf, x)).toBeCloseTo(e.box(['PDF', B, x]).N().re as number, 12);
      expect(at(cdf, x)).toBeCloseTo(e.box(['CDF', B, x]).N().re as number, 12);
    }
    expect(at(pmf, 6)).toBe(0);
    expect(at(cdf, 6)).toBe(1);
    expect(at(cdf, -1)).toBe(0);
  });

  test('a point whose type proves the support keeps the bare closed form', () => {
    const e = new ComputeEngine();
    e.declare('m', 'integer<0..>');
    expect(e.box(['PDF', POISSON, 'm']).evaluate().operator).not.toBe('Which');
    expect(e.box(['CDF', POISSON, 'm']).evaluate().operator).toBe(
      'GammaRegularized'
    );
    // An integer of unknown sign keeps only the sign clause, and no `Floor`.
    e.declare('k', 'integer');
    const cdf = e.box(['CDF', POISSON, 'k']).evaluate();
    expect(cdf.operator).toBe('Which');
    expect(cdf.toString()).not.toContain('floor');
  });
});
