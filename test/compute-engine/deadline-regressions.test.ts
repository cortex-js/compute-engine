import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';
import { loadIntegrationRules } from '../../src/integration-rules';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { RubiDriver } from '../../src/compute-engine/rubi/driver';
import {
  installCaches,
  zeroQ,
} from '../../src/compute-engine/rubi/rubi-utils';

/**
 * Regression tests for WP-2.11 / EX-14 (P0-19): a family of bignum
 * Gamma/GammaLn/Zeta kernels (`numerics/special-functions.ts`) and
 * combinatorics loops (`library/combinatorics.ts`) ignored the evaluation
 * deadline and ran for 15s+ before being interrupted (the originally-documented
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
 * used to be extremely slow — `BigDecimal.prototype.toFixed`'s `shift >= 0`
 * branch built `absSig * 10n ** BigInt(shift)` and then stringified that
 * multi-million-digit bigint, even though the answer is just the
 * significand's digits followed by `shift` zeros. `BigNumericValue`'s
 * `decimalToString` helper (`numeric-value/big-numeric-value.ts`) calls
 * `toFixed(0)` speculatively on every integer whose `toString()` used
 * scientific notation, to decide whether a "few trailing zeros" fixed-point
 * rendering would be nicer — so this fired on every `.toString()`/`.json`
 * call for a huge-exponent bignum (WP-2.18, same class as EX-15). Fixed in
 * `src/big-decimal/big-decimal.ts` (`toFixed`) by building the digit string
 * directly instead of round-tripping through a bigint, mirroring the
 * already-efficient equivalent branch in `toString()`. These tests still
 * lean on the cheap structural getters (`.re`, `.isFinite`, `.isInfinity`,
 * `.operator`) and `.bignumRe.toString()` where a value's *magnitude* (not
 * its serialization performance) is what's being checked; the
 * `.toString()`/`.json` serialization performance itself is covered by the
 * "huge-exponent serialization" describe block below.
 */

// Each case below asserts an OUTCOME — a thrown `CancellationError`, ±∞, an
// inert symbolic form, or a specific finite value — and every one of those is
// unreachable from the bug it guards, which was an unbounded loop that never
// returned. So the outcome is the whole assertion, and the only role left for
// wall-clock time is to stop a regressed run from blocking the suite forever.
// That role belongs to the jest timeout, raised here well above the real cost
// of these cases (tens to hundreds of milliseconds each) so that load on the
// machine cannot turn a correct run red: elapsed-millisecond assertions in
// these tests used to fail under a parallel full-suite run and pass in
// isolation, which made a red suite uninformative.
jest.setTimeout(60_000);

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

describe('WP-2.11 / EX-14: Gamma/GammaLn/Zeta bignum kernels', () => {
  // Layer 2: bigGamma's exact-integer factorial fast path is gated by
  // MAX_EXACT_FACTORIAL_N and falls through to the general (precision-
  // scaled, magnitude-independent) Stirling path. gammalnCore(1e300) is
  // itself large enough (~6.9e302) that BigDecimal.exp()'s own saturation
  // guard fires. Outcome: +Infinity (matches the machine-lane behavior for
  // a huge Gamma argument).
  it('Gamma(1e300).N() overflows to +Infinity instead of hanging', () => {
    const r = ce.box(['Gamma', 1e300]).N();
    expect(r.isInfinity).toBe(true);
    expect(r.isFinite).toBe(false);
  });

  // Layer 2: gammalnCore's exact-integer branch is gated the same way;
  // unlike Gamma, ln(Gamma(z)) does NOT overflow for huge z — it is a
  // genuine (large but representable) finite BigDecimal value. Outcome: a
  // correct finite value (~6.8977552789821374×10³⁰²), not a hang.
  it('GammaLn(1e300).N() returns a correct finite value instead of hanging', () => {
    const r = ce.box(['GammaLn', 1e300]).N();
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
    const r = ce.box(['Zeta', 1e300]).N();
    expect(r.isFinite).toBe(true);
    expect(r.re).toBeCloseTo(1, 10);
  });

  // Layer 2: for huge negative even integers, zetaCore short-circuits to
  // the exact trivial zero (ζ(-2n) = 0) via an exact bigint parity check,
  // rather than going through the functional equation where huge-magnitude
  // sin(πs/2)·Γ(1-s) meets 0·∞ and rounds to NaN. Outcome: exactly 0.
  it('Zeta(-1e300).N() returns the exact trivial zero instead of hanging', () => {
    const r = ce.box(['Zeta', -1e300]).N();
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
        const r = ce.box(['Gamma', 1e7]).N();
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
    const r = ce.box(['Fibonacci', 1_000_000_000]).evaluate();
    expect(r.operator).toBe('Fibonacci');
  });

  // Layer 2: Binomial(2e9, 1e9) has ~6×10⁸ digits (estimated via lgamma),
  // far past the threshold. Outcome: stays symbolic (inert).
  it('Binomial(2e9, 1e9) stays symbolic instead of hanging', () => {
    const r = ce.box(['Binomial', 2_000_000_000, 1_000_000_000]).evaluate();
    expect(r.operator).toBe('Binomial');
  });

  // Layer 1: BellNumber(20000) has "only" ~57000 digits (under the 1e6
  // magnitude-guard threshold), but the O(n²) Bell-triangle cost is what
  // actually blows the budget — the `checkDeadline` inside the triangle
  // loop is what catches this one. Outcome: thrown CancellationError.
  it('BellNumber(20000) throws CancellationError instead of hanging', () => {
    expect(() =>
      ce.withTimeLimit({ ms: 2000, label: 'test:bellnumber-deadline' }, () =>
        ce.box(['BellNumber', 20_000]).evaluate()
      )
    ).toThrow(CancellationError);
  });

  // Layer 2: !n has the same order of magnitude as n! — Subfactorial(1e6)
  // is estimated (via lgamma) at ~5.6×10⁶ digits, past the threshold.
  // Outcome: stays symbolic (inert).
  it('Subfactorial(1e6) stays symbolic instead of hanging', () => {
    const r = ce.box(['Subfactorial', 1_000_000]).evaluate();
    expect(r.operator).toBe('Subfactorial');
  });

});

describe('WP-2.18 / P0-19 residual: DigitSum and siblings (library/number-theory.ts)', () => {
  // DigitSum(2^1e6): used to hang (>20s). `Power(2, 1_000_000)` itself
  // evaluates exactly (~301,030 digits, under `MAX_EXACT_POW_DIGITS`), so
  // `DigitSum` received a real 301,030-digit bigint. The naive
  // repeated-mod-and-divide loop is O(digits²) on a shrinking bigint —
  // quadratic enough to turn that into a 30s+ hang. Fixed via a single
  // O(digits) pass built on the bigint's own (efficient) `toString(base)`.
  // Outcome: a correct finite value, well within the 2s time limit.
  it('DigitSum(2^1000000) completes with the correct value instead of hanging', () => {
    const r = ce.box(['DigitSum', ['Power', 2, 1_000_000]]).evaluate();
    expect(r.operator).toBe('Integer');
    expect(r.re).toBe(1351546);
  });

  // Above MAX_DIGIT_ITERATION_DIGITS the pre-check keeps the expression
  // symbolic rather than even attempting the (now-fast, but still O(digits))
  // pass — e.g. a base-2 DigitSum of a huge power has ~3.3× as many digits
  // as the decimal count, so it can cross the threshold well before the
  // decimal case does.
  it('DigitSum(2^10000000, 2) stays symbolic instead of hanging', () => {
    const r = ce.box(['DigitSum', ['Power', 2, 10_000_000], 2]).evaluate();
    expect(r.operator).toBe('DigitSum');
  });

  // Control: a genuine 39-digit Mersenne prime (2^127 - 1) — same value
  // exercised by test/compute-engine/number-theory.test.ts and
  // exactness-regressions.test.ts — must still be exact and fast after the
  // algorithm swap (not just the pathologically large cases).
  it('DigitSum(2^127 - 1) is still exact (154)', () => {
    const m127 = 2n ** 127n - 1n;
    const r = ce.box(['DigitSum', ce.number(m127)]).evaluate();
    expect(r.toString()).toBe('154');
  });

  // Control: a small, everyday case must remain trivially correct.
  it('DigitSum(12345) is still exact (15)', () => {
    expect(ce.box(['DigitSum', 12345]).evaluate().toString()).toBe('15');
  });
});

describe('WP-2.18: huge-exponent BigDecimal serialization (src/big-decimal/big-decimal.ts)', () => {
  // Gamma(1e7) = (1e7 - 1)!, an exact integer represented (at precision 500)
  // by a ~500-digit significand and an exponent of ~6.5×10⁷. `.N()` itself
  // is fast (the computation is precision-scaled, not magnitude-scaled);
  // what used to be slow (~9s) was `.toString()`/`.json` afterwards, via
  // `BigNumericValue`'s `decimalToString` helper speculatively calling
  // `BigDecimal.toFixed(0)` — see the file-level NOTE. The fix keeps the
  // *output* the same (scientific notation, since the number has far more
  // than 5 trailing zeros) while making the underlying `toFixed` O(digits)
  // instead of O(digits) BigInt-exponentiation-and-back-to-string.
  describe('Gamma(1e7).N() at precision 500', () => {
    const savedPrecision = { value: 21 };
    beforeAll(() => {
      savedPrecision.value = new ComputeEngine().precision;
    });

    it('.toString() and JSON.stringify(.json) are fast and use scientific notation', () => {
      ce.precision = 500;
      try {
        const r = ce.box(['Gamma', 1e7]).N();

        const t0 = Date.now();
        const s = r.toString();
        const toStringMs = Date.now() - t0;

        const t1 = Date.now();
        const j = JSON.stringify(r.json);
        const jsonMs = Date.now() - t1;

        // Output form: scientific notation (`d.ddd…e+N`), not a
        // ~6.5×10⁷-character string of mostly zeros.
        expect(s.startsWith('1.202423400515903456')).toBe(true);
        expect(s.endsWith('e+65657052')).toBe(true);
        expect(s.length).toBeLessThan(1000);

        expect(j).toContain('"num"');
        expect(j).toContain('e+65657052');
        expect(j.length).toBeLessThan(1000);

        // This is the one place in this file where wall-clock time cannot be
        // replaced by a counter. The defect it guards did not change the
        // OUTPUT and did not change which functions were CALLED: `toFixed(0)`
        // was, and still is, invoked speculatively on this value. What changed
        // is how `toFixed` builds its digits — a bigint exponentiation and
        // re-stringification of ~6.5×10⁷ digits, versus an O(digits) pass —
        // so the only observable difference is duration. The bound is
        // therefore set as a backstop, four orders of magnitude above the
        // few milliseconds these calls actually take and still far below the
        // ~9 s the defect produced, so that machine load cannot decide it.
        expect(toStringMs).toBeLessThan(5000);
        expect(jsonMs).toBeLessThan(5000);
      } finally {
        ce.precision = savedPrecision.value; // BigDecimal.precision is process-global
      }
    });
  });

  // Ordinary (non-pathological) numbers must serialize byte-identically to
  // before the `toFixed` change — the fast path only changes *how* the
  // "shift >= 0, no rounding" digit string is built, not its value.
  it('ordinary numbers still serialize the same, across precisions', () => {
    const savedPrecision = ce.precision;
    try {
      const cases: Array<[number, number, string]> = [
        [1, 15, '1'],
        [0.5, 15, '0.5'],
        [1e21, 15, '1e+21'],
        [1e-300, 15, '1e-300'],
        [123.456, 15, '123.456'],
        [1, 21, '1'],
        [0.5, 21, '0.5'],
        [1e21, 21, '1e+21'],
        [1e-300, 21, '1e-300'],
        [123.456, 21, '123.456'],
        [1, 50, '1'],
        [0.5, 50, '0.5'],
        [1e21, 50, '1e+21'],
        [1e-300, 50, '1e-300'],
        [123.456, 50, '123.456'],
      ];
      for (const [val, prec, expected] of cases) {
        ce.precision = prec;
        const r = ce.box(val).N();
        expect(r.toString()).toBe(expected);
        // At these precisions the value is in machine range, so `.json` is
        // the plain JS number itself (not a `{num: "..."}` bignum literal).
        expect(r.json).toBe(val);
      }
    } finally {
      ce.precision = savedPrecision;
    }
  });
});

describe('WP-2.11 / EX-14: controls (must remain correct/fast, unaffected)', () => {
  it('LucasL(1e9) stays symbolic instead of grinding to a deadline', () => {
    // This control used to pin that the linear loop CANCELS via its
    // deadline check after ~2 s. `LucasL` now pre-checks the result's digit
    // count and stays symbolic for huge indices — the `Fibonacci` digit-cap
    // convention — so the loop is never entered and no deadline is needed:
    // the answer is immediate on every route, deadline or not (the
    // no-deadline route, compile-time constant folding included, used to
    // run this loop unbounded).
    const r = ce.withTimeLimit({ ms: 2000, label: 'test:lucasl-deadline' }, () =>
      ce.box(['LucasL', 1_000_000_000]).evaluate()
    );
    expect(r.toString()).toBe('LucasL(1000000000)');
    // A moderate index is still exact.
    expect(ce.box(['LucasL', 30]).evaluate().toString()).toBe('1860498');
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

/**
 * A caller's `withTimeLimit` deadline must reach the caller as a
 * `CancellationError`. A component can change a timeout into a fallback result
 * only when the time span that expired is a span that the component opened
 * itself (`docs/TIMEOUT-MODEL.md` §2 and §7.3).
 *
 * Each test enters the component directly, with the input built outside the
 * span, so that the first deadline check happens inside the component. An
 * already-expired span (`ms: 0`) makes the result deterministic.
 */
describe('A caller deadline propagates through components with a fallback', () => {
  /** Run `fn` and return the `CancellationError` it throws, or `undefined`. */
  function cancellationOf(fn: () => unknown): CancellationError | undefined {
    try {
      fn();
    } catch (e) {
      if (e instanceof CancellationError) return e;
      throw e;
    }
    return undefined;
  }

  describe('Rubi rule driver', () => {
    const rubiCe = new ComputeEngine();
    loadIntegrationRules(rubiCe);
    const provide = (latex: string) => {
      const integrand = rubiCe.parse(latex);
      return () => rubiCe._integrationProvider!(integrand, 'x');
    };

    it('the recursion throws the caller cancellation (non-rational integrand)', () => {
      // No native fallback applies to `x e^x`, so only the check at the start
      // of each recursion step can see the expired caller deadline.
      const run = provide('xe^x');
      const e = cancellationOf(() =>
        rubiCe.withTimeLimit({ ms: 0, label: 'test:caller' }, run)
      );
      expect(e?.cause).toBe('timeout');
      expect(e?.attribution).toBe('test:caller');
    });

    it('the top-level driver call does not change a caller cancellation to "no result"', () => {
      const run = provide('\\frac{1}{x^2+1}');
      const e = cancellationOf(() =>
        rubiCe.withTimeLimit({ ms: 0, label: 'test:caller' }, run)
      );
      expect(e?.attribution).toBe('test:caller');
    });

    it('an unlabelled caller span also propagates', () => {
      // The error of an unlabelled span has no attribution, the same as the
      // error of the rule matcher's own time budget.
      const run = provide('\\frac{1}{x^2+1}');
      const e = cancellationOf(() => rubiCe.withTimeLimit(0, run));
      expect(e?.cause).toBe('timeout');
    });

    it('the driver answers normally outside a caller span', () => {
      expect(provide('\\frac{1}{x^2+1}')()?.toString()).toBe('arctan(x)');
    });

    // The two Rubi sub-spans are called directly on a driver with no rules.
    // An unlabelled caller span gives an error with no attribution, the same
    // as Rubi's own errors, so only the expiry of the caller frame shows that
    // the timeout is the caller's.
    it('the native fallback span lets an unlabelled caller span propagate', () => {
      const driver = new RubiDriver(rubiCe, []);
      const integrand = rubiCe.parse('\\frac{1}{x^2+1}');
      const e = cancellationOf(() =>
        rubiCe.withTimeLimit(0, () =>
          (driver as any).nativeRationalFallback(integrand, 'x')
        )
      );
      expect(e?.cause).toBe('timeout');
    });

    it('the clean-expansion span lets an unlabelled caller span propagate', () => {
      const driver = new RubiDriver(rubiCe, []);
      const F = rubiCe.parse('(x+1)^2 - x^2');
      const e = cancellationOf(() =>
        rubiCe.withTimeLimit(0, () => (driver as any).cleanExpansionResult(F))
      );
      expect(e?.cause).toBe('timeout');
      // Outside a caller span, the result is simplified as before.
      expect((driver as any).cleanExpansionResult(F).toString()).toBe(
        '2x + 1'
      );
    });
  });

  describe('Integrate evaluation with a plugin provider', () => {
    it('a cancellation from a copy of the class in another bundle propagates', () => {
      // A plugin bundle has its own copy of the `CancellationError` class, so
      // its errors are not `instanceof` the class of the engine.
      const pce = new ComputeEngine();
      const foreign = new Error('Timeout exceeded');
      foreign.name = 'CancellationError';
      pce._integrationProvider = () => {
        throw foreign;
      };
      const integral = pce.parse('\\int x\\,dx');
      let thrown: unknown;
      try {
        integral.evaluate();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(foreign);
    });
  });

  describe('Rubi bounded simplification (zeroQ)', () => {
    const zce = new ComputeEngine();
    const d = zce.parse('(x+1)^2 - x^2 - 2x - 1');

    it('throws the caller cancellation and does not cache the result', () => {
      const simplify = new Map();
      installCaches({ zeroQ: new Map(), simplify });
      try {
        const e = cancellationOf(() =>
          zce.withTimeLimit({ ms: 0, label: 'test:caller' }, () => zeroQ(d))
        );
        expect(e?.attribution).toBe('test:caller');
        expect(simplify.size).toBe(0);
      } finally {
        installCaches(undefined);
      }
    });

    it('a cancellation that is not the caller one gives the unsimplified form, not cached', () => {
      // A cancellation from a time budget inside the simplification, while
      // the enclosing span is still open, is not the caller's.
      const x = zce.parse('\\sin(x)^2 + \\cos(x)^2 - 1');
      const inner = new CancellationError({ cause: 'timeout' });
      const probe = Object.create(x, {
        simplify: {
          value: () => {
            throw inner;
          },
        },
      });
      const simplify = new Map();
      const zeroQCache = new Map();
      installCaches({ zeroQ: zeroQCache, simplify });
      try {
        expect(() => zeroQ(probe)).not.toThrow();
        expect(simplify.size).toBe(0);
        expect(zeroQCache.size).toBe(0);
      } finally {
        installCaches(undefined);
      }
    });
  });

  describe('compiler closed-form integral attempt', () => {
    const integral = (ce: ComputeEngine) =>
      ce.box(['Integrate', ['Multiply', 2, 'x'], ['Tuple', 'x', 0, 't']]);

    it('throws the caller cancellation instead of falling back to quadrature', () => {
      const ce = new ComputeEngine();
      ce.declare('t', 'real');
      const target = ce._getCompilationTarget('javascript')!;
      const args = integral(ce).ops!;
      const e = cancellationOf(() =>
        ce.withTimeLimit({ ms: 0, label: 'test:caller' }, () =>
          BaseCompiler.closedFormIntegral(args, target)
        )
      );
      expect(e?.attribution).toBe('test:caller');
    });

    it('an unlabelled caller span also propagates', () => {
      const ce = new ComputeEngine();
      ce.declare('t', 'real');
      const target = ce._getCompilationTarget('javascript')!;
      const args = integral(ce).ops!;
      const e = cancellationOf(() =>
        ce.withTimeLimit(0, () => BaseCompiler.closedFormIntegral(args, target))
      );
      expect(e?.cause).toBe('timeout');
    });

    it('a timeout of its own span still falls back (returns undefined)', () => {
      const ce = new ComputeEngine();
      ce.declare('t', 'real');
      const target = ce._getCompilationTarget('javascript')!;
      const args = integral(ce).ops!;
      BaseCompiler.setAntiderivativeAttemptBudgetForTesting(0);
      try {
        expect(
          ce.withTimeLimit({ ms: 60_000, label: 'test:caller' }, () =>
            BaseCompiler.closedFormIntegral(args, target)
          )
        ).toBeUndefined();
      } finally {
        BaseCompiler.setAntiderivativeAttemptBudgetForTesting();
      }
    });
  });
});
