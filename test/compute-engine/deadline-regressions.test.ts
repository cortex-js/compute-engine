import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';

/**
 * Regression tests for WP-2.11 / EX-14 (P0-19): a family of bignum
 * Gamma/GammaLn/Zeta kernels (`numerics/special-functions.ts`) and
 * combinatorics loops (`library/combinatorics.ts`) ignored `ce.timeLimit`
 * and ran for 15s+ before being interrupted (the originally-documented
 * repro was `Gamma(1e300).N()`).
 *
 * Each case is fixed at one (or both) of two layers:
 *  - Layer 1 — a `checkDeadline` call inserted into the hot loop, so a
 *    runaway computation throws `CancellationError` instead of hanging.
 *  - Layer 2 — a cheap magnitude pre-check (digit-count estimate) that
 *    keeps the expression symbolic *before* any loop starts, mirroring
 *    `MAX_EXACT_POW_DIGITS` in `boxed-expression/arithmetic-power.ts`.
 *
 * The comment on each `it` records which outcome the fix produces
 * (thrown cancellation / symbolic inert form / ±oo / a genuine finite
 * value) — never a silently wrong finite value, and always within a
 * bounded wall-clock time.
 *
 * NOTE on large results: several of these produce BigDecimal values with
 * enormous *exponents* (e.g. Gamma(1e7) at precision 500 is a value with a
 * ~6.5×10⁷-digit exponent). Calling `.toString()`/`.json` on such a result
 * is itself extremely slow (a pre-existing, separate bug in the generic
 * BoxedNumber/BigNumericValue serialization path — same class as EX-15 —
 * `pow10(hugeExponent)`), so these tests deliberately assert on cheap
 * structural getters (`.re`, `.isFinite`, `.isInfinity`, `.operator`) and
 * `.bignumRe.toString()` (the raw BigDecimal formatter, which *is* cheap —
 * see BigDecimal.prototype.toString) rather than on `.toString()` /
 * `.json` of the boxed result.
 */

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
  ce.timeLimit = 2000;
});

describe('WP-2.11 / EX-14: Gamma/GammaLn/Zeta bignum kernels', () => {
  // Layer 2: bigGamma's exact-integer factorial fast path is gated by
  // MAX_EXACT_FACTORIAL_N and falls through to the general (precision-
  // scaled, magnitude-independent) Stirling path. gammalnCore(1e300) is
  // itself large enough (~6.9e302) that BigDecimal.exp()'s own saturation
  // guard fires. Outcome: +Infinity (matches the machine-lane behavior for
  // a huge Gamma argument).
  it('Gamma(1e300).N() overflows to +Infinity instead of hanging', () => {
    const start = Date.now();
    const r = ce.box(['Gamma', 1e300]).N();
    expect(Date.now() - start).toBeLessThan(4000);
    expect(r.isInfinity).toBe(true);
    expect(r.isFinite).toBe(false);
  });

  // Layer 2: gammalnCore's exact-integer branch is gated the same way;
  // unlike Gamma, ln(Gamma(z)) does NOT overflow for huge z — it is a
  // genuine (large but representable) finite BigDecimal value. Outcome: a
  // correct finite value (~6.8977552789821374×10³⁰²), not a hang.
  it('GammaLn(1e300).N() returns a correct finite value instead of hanging', () => {
    const start = Date.now();
    const r = ce.box(['GammaLn', 1e300]).N();
    expect(Date.now() - start).toBeLessThan(4000);
    expect(r.isFinite).toBe(true);
    // ln(Gamma(1e300)) ≈ (1e300 - 1/2)·ln(1e300) - 1e300 + ln(2π)/2
    expect(r.re).toBeCloseTo(6.897755278982137e302, -288);
    const gammaLnStr = r.bignumRe!.toString();
    expect(gammaLnStr.startsWith('6.8977552789821374')).toBe(true);
  });

  // Layer 2: zetaCore's exact positive-even-integer closed form (which
  // needs the Bernoulli number B_s) is gated by MAX_EXACT_ZETA_EVEN_N and
  // falls through to the general Cohen-Villegas-Zagier series, which is
  // magnitude-independent. ζ(s) → 1 as s → +∞. Outcome: a correct finite
  // value (1), not a hang.
  it('Zeta(1e300).N() returns 1 (its asymptotic limit) instead of hanging', () => {
    const start = Date.now();
    const r = ce.box(['Zeta', 1e300]).N();
    expect(Date.now() - start).toBeLessThan(4000);
    expect(r.isFinite).toBe(true);
    expect(r.re).toBeCloseTo(1, 10);
  });

  // Layer 2: for huge negative even integers, zetaCore short-circuits to
  // the exact trivial zero (ζ(-2n) = 0) via an exact bigint parity check,
  // rather than going through the functional equation where huge-magnitude
  // sin(πs/2)·Γ(1-s) meets 0·∞ and rounds to NaN. Outcome: exactly 0.
  it('Zeta(-1e300).N() returns the exact trivial zero instead of hanging', () => {
    const start = Date.now();
    const r = ce.box(['Zeta', -1e300]).N();
    expect(Date.now() - start).toBeLessThan(4000);
    expect(r.isFinite).toBe(true);
    expect(r.re).toBe(0);
  });

  // Layer 2 (+ layer 1 backstop): a *moderate* argument (1e7) at very high
  // precision (500) also hit the same unguarded exact-integer factorial
  // loop. Once gated, the general Stirling series computes a genuine
  // correct finite bignum value (BigDecimal represents magnitude via an
  // exponent field, so a ~6.5×10⁷-digit number is not itself an overflow —
  // only its *materialized digit-string serialization* is pathological,
  // see the file-level NOTE above, which is why this assertion avoids
  // `.toString()`/`.json` on `r` itself).
  describe('Gamma(1e7).N() at high precision', () => {
    const savedPrecision = { value: 21 };
    beforeAll(() => {
      savedPrecision.value = new ComputeEngine().precision;
    });

    it('completes and returns a correct finite value instead of hanging', () => {
      ce.precision = 500;
      try {
        const start = Date.now();
        const r = ce.box(['Gamma', 1e7]).N();
        expect(Date.now() - start).toBeLessThan(4000);
        expect(r.isFinite).toBe(true);
        expect(r.isInfinity).toBe(false);
        // The raw BigDecimal formatter is cheap (no huge-exponent
        // materialization) — the boxed `.toString()`/`.json` path is not
        // (see file-level NOTE).
        const s = r.bignumRe!.toString();
        expect(s.startsWith('1.202423400515903456')).toBe(true);
        expect(s.endsWith('e+65657052')).toBe(true);
      } finally {
        ce.precision = savedPrecision.value; // BigDecimal.precision is process-global
      }
    });
  });
});

describe('WP-2.11 / EX-14: combinatorics magnitude guards', () => {
  // Layer 2: F(m) has ~m·log10(φ) digits (~2×10⁸ for m=1e9), far past
  // MAX_EXACT_COMBINATORICS_DIGITS — the evaluate handler returns
  // `undefined` before the loop starts. Outcome: stays symbolic (inert).
  it('Fibonacci(1e9) stays symbolic instead of hanging', () => {
    const start = Date.now();
    const r = ce.box(['Fibonacci', 1_000_000_000]).evaluate();
    expect(Date.now() - start).toBeLessThan(4000);
    expect(r.operator).toBe('Fibonacci');
  });

  // Layer 2: Binomial(2e9, 1e9) has ~6×10⁸ digits (estimated via lgamma),
  // far past the threshold. Outcome: stays symbolic (inert).
  it('Binomial(2e9, 1e9) stays symbolic instead of hanging', () => {
    const start = Date.now();
    const r = ce.box(['Binomial', 2_000_000_000, 1_000_000_000]).evaluate();
    expect(Date.now() - start).toBeLessThan(4000);
    expect(r.operator).toBe('Binomial');
  });

  // Layer 1: BellNumber(20000) has "only" ~57000 digits (under the 1e6
  // magnitude-guard threshold), but the O(n²) Bell-triangle cost is what
  // actually blows the budget — the `checkDeadline` inside the triangle
  // loop is what catches this one. Outcome: thrown CancellationError.
  it('BellNumber(20000) throws CancellationError instead of hanging', () => {
    const start = Date.now();
    expect(() => ce.box(['BellNumber', 20_000]).evaluate()).toThrow(
      CancellationError
    );
    expect(Date.now() - start).toBeLessThan(4000);
  });

  // Layer 2: !n has the same order of magnitude as n! — Subfactorial(1e6)
  // is estimated (via lgamma) at ~5.6×10⁶ digits, past the threshold.
  // Outcome: stays symbolic (inert).
  it('Subfactorial(1e6) stays symbolic instead of hanging', () => {
    const start = Date.now();
    const r = ce.box(['Subfactorial', 1_000_000]).evaluate();
    expect(Date.now() - start).toBeLessThan(4000);
    expect(r.operator).toBe('Subfactorial');
  });

  // DigitSum(2^1e6): observed to hang (>20s) — the exact same class of bug
  // (an unguarded O(digits) loop over the argument's own magnitude), but
  // the implementation lives in `library/number-theory.ts`, which is
  // outside this fix's file scope (combinatorics.ts / special-functions.ts
  // only — see WP-2.11 hard constraints). Left unfixed and documented here
  // rather than silently patched out of scope; tracked separately.
  it.skip('DigitSum(Power(2, 1e6)) — known hang, out of scope for this fix (number-theory.ts)', () => {
    ce.box(['DigitSum', ['Power', 2, 1_000_000]]).evaluate();
  });
});

describe('WP-2.11 / EX-14: controls (must remain correct/fast, unaffected)', () => {
  it('LucasL(1e9) still cancels via its existing deadline check (~2s)', () => {
    const start = Date.now();
    expect(() => ce.box(['LucasL', 1_000_000_000]).evaluate()).toThrow(
      CancellationError
    );
    expect(Date.now() - start).toBeLessThan(4000);
  });

  it('Fibonacci(100) is still exact', () => {
    expect(ce.box(['Fibonacci', 100]).evaluate().toString()).toBe(
      '354224848179261915075'
    );
  });

  it('Binomial(50, 25) is still exact', () => {
    expect(ce.box(['Binomial', 50, 25]).evaluate().toString()).toBe(
      '126410606437752'
    );
  });

  it('BellNumber(20) is still exact', () => {
    expect(ce.box(['BellNumber', 20]).evaluate().toString()).toBe(
      '51724158235372'
    );
  });

  it('Subfactorial(10) is still exact', () => {
    expect(ce.box(['Subfactorial', 10]).evaluate().toString()).toBe('1334961');
  });

  it('Gamma(10.5).N() is still correct at default (machine) precision', () => {
    const r = ce.box(['Gamma', ['Rational', 21, 2]]).N();
    expect(r.re).toBeCloseTo(1133278.3889487855, 6);
  });

  it('Zeta(3).N() is still correct at default (machine) precision', () => {
    const r = ce.box(['Zeta', 3]).N();
    expect(r.re).toBeCloseTo(1.2020569031595942, 12);
  });

  it('Zeta(3).N() is still correct at precision 50 (bignum lane)', () => {
    const savedPrecision = ce.precision;
    try {
      ce.precision = 50;
      const r = ce.box(['Zeta', 3]).N();
      expect(r.bignumRe!.toString()).toBe(
        '1.2020569031595942853997381615114499907649862923405'
      );
    } finally {
      ce.precision = savedPrecision; // BigDecimal.precision is process-global
    }
  });

  it('Gamma(170).N() (near machine-overflow boundary) is unchanged', () => {
    const r = ce.box(['Gamma', 170]).N();
    expect(r.isFinite).toBe(true);
    expect(r.re).toBeCloseTo(4.269068009004705e304, -290);
  });
});
