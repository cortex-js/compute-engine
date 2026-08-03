/**
 * Non-finite typing convention (SYM P2-23, option b — convention, not
 * lattice extension). See ARCHITECTURE.md § "Non-finite typing convention
 * for type handlers".
 *
 * - `non_finite_number` is claimed ONLY when the value is provably ±∞.
 * - When ±∞/`~oo`/NaN is merely possible — or the value is provably `~oo` —
 *   the claim is `number` (never a finite type, never `complex`, and never a
 *   speculative `non_finite_number`).
 * - Unknown finiteness is a generic point (finite); zero-ness must be proven.
 */
import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

function typeOf(expr: any): string {
  return ce.box(expr).type.toString();
}

describe('NON-FINITE TYPING CONVENTION', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('x_r', 'real'); // generic real: finiteness unknown, sign unknown
    ce.declare('z_f', 'finite_real'); // provably finite, sign unknown
    ce.assume(ce.box(['Greater', 'p_r', 0])); // provably positive real
  });
  afterAll(() => ce.popScope());

  describe('provably ±∞ → non_finite_number', () => {
    test('Ln(0) = −∞', () =>
      expect(typeOf(['Ln', 0])).toBe('non_finite_number'));

    test('Log(0, 3) = −∞', () =>
      expect(typeOf(['Log', 0, 3])).toBe('non_finite_number'));

    test('EllipticK(1) = +∞', () =>
      expect(typeOf(['EllipticK', 1])).toBe('non_finite_number'));

    test('Round/Floor of a real ±∞', () => {
      expect(typeOf(['Round', 'PositiveInfinity'])).toBe('non_finite_number');
      expect(typeOf(['Floor', 'NegativeInfinity'])).toBe('non_finite_number');
    });

    test('±∞ · provably non-zero real', () =>
      expect(typeOf(['Multiply', 'p_r', 'PositiveInfinity'])).toBe(
        'non_finite_number'
      ));

    test('±∞ + real terms (generic-point finiteness)', () =>
      expect(typeOf(['Add', 'x_r', 'PositiveInfinity'])).toBe(
        'non_finite_number'
      ));

    // A provably non-finite TERM may be visible only in its static type:
    // `Ln(0)` types `non_finite_number` while its structural `isFinite` stays
    // `undefined`. The Add/Multiply/Divide handlers must consult the type —
    // without it, `1 + Ln(0)` widened to `integer` and `2·Ln(0)` claimed
    // `finite_integer` (unsound; the value is −∞). Fixed 2026-07-31.
    test('a type-only-provable −∞ term: 1 + Ln(0)', () => {
      expect(typeOf(['Add', 1, ['Ln', 0]])).toBe('non_finite_number');
      expect(typeOf(['Add', 1, ['Artanh', 1]])).toBe('non_finite_number');
    });

    // Ruling 2026-08-03: a provably non-finite REAL factor is implicitly
    // non-zero (`±∞ ≠ 0` is a theorem), so a proven sign is required only of
    // the FINITE factors. `Ln(0)` has sgn `non-positive` — not a proven
    // non-zero sign — yet `2·Ln(0) = −∞`. Before the ruling both of these
    // widened to `number`.
    test('a provably non-finite real factor is implicitly nonzero (ruling 2026-08-03)', () => {
      expect(typeOf(['Multiply', 2, ['Ln', 0]])).toBe('non_finite_number');
      expect(typeOf(['Multiply', 2, ['Artanh', 1]])).toBe('non_finite_number');
      // `Ln(0)/2` canonicalizes to `Multiply(1/2, Ln(0))`, so this is the
      // Multiply handler too.
      expect(typeOf(['Divide', ['Ln', 0], 2])).toBe('non_finite_number');
    });

    test('non-finite real numerator over a finite non-zero real denominator', () => {
      // Canonically, `Ln(0)/π` no longer survives as a Divide: `canonicalDivide`
      // folds `±∞/finite-nonzero` to the numerator (`Ln(0)`), which types
      // `non_finite_number` on its own. The observable claim is unchanged.
      const canonical = ce.box(['Divide', ['Ln', 0], 'Pi']);
      expect(canonical.operator).toBe('Ln');
      expect(canonical.type.toString()).toBe('non_finite_number');
      // The structural route keeps the Divide head and exercises the Divide
      // type handler's tight branch directly.
      const structural = ce.function('Divide', [ce.box(['Ln', 0]), ce.Pi], {
        structural: true,
      });
      expect(structural.operator).toBe('Divide');
      expect(structural.type.toString()).toBe('non_finite_number');
    });

    test('negative controls: the non-finite factor must be REAL, finite factors keep their sign obligation', () => {
      // `∞·i = ~oo`, not a signed infinity — `isFinite === false` does not
      // imply real.
      expect(typeOf(['Multiply', 'ImaginaryUnit', 'PositiveInfinity'])).toBe(
        'number'
      );
      expect(typeOf(['Multiply', 'ImaginaryUnit', ['Ln', 0]])).toBe('number');
      expect(typeOf(['Multiply', 2, 'ComplexInfinity'])).toBe('number');
      // A possibly-zero FINITE factor still blocks the claim (0 · −∞ = NaN).
      expect(typeOf(['Multiply', 'x_r', ['Ln', 0]])).toBe('number');
      // Divide: an unknown-finiteness denominator admits ∞/∞ = NaN.
      expect(typeOf(['Divide', ['Ln', 0], 'x_r'])).toBe('number');
      // Divide: a provably finite denominator with no proven sign may be 0.
      expect(typeOf(['Divide', ['Ln', 0], 'z_f'])).toBe('number');
      // Divide: a non-real denominator (∞/i = ~oo).
      expect(
        ce
          .function('Divide', [ce.PositiveInfinity, ce.I], { structural: true })
          .type.toString()
      ).toBe('number');
      // Divide: a non-real NUMERATOR (~oo/5 = ~oo). Canonically this folds to
      // the ~oo value (which types `complex`, see the documented residual
      // below); the structural route exercises the handler's `isReal` guard.
      expect(typeOf(['Divide', 'ComplexInfinity', 5])).toBe('complex');
      expect(
        ce
          .function('Divide', [ce.ComplexInfinity, ce.box(5)], {
            structural: true,
          })
          .type.toString()
      ).toBe('number');
    });

    // Ruling 2026-08-03, symmetric case: `finite real / ±∞ = 0`.
    test('a provably finite real numerator over a real ±∞ is exactly 0', () => {
      // The canonical route folds `2/Ln(0)` to the literal `0`; the structural
      // route keeps the Divide head and exercises the type handler.
      expect(typeOf(['Divide', 2, ['Ln', 0]])).toBe('finite_integer');
      const structural = ce.function('Divide', [ce.box(2), ce.box(['Ln', 0])], {
        structural: true,
      });
      expect(structural.operator).toBe('Divide');
      expect(structural.type.toString()).toBe('finite_integer');
      // A provably finite (possibly zero) real numerator is still exactly 0.
      expect(
        ce
          .function('Divide', [ce.box('z_f'), ce.box(['Ln', 0])], {
            structural: true,
          })
          .type.toString()
      ).toBe('finite_integer');
    });

    test('negative controls for `finite/±∞`: numerator finiteness and realness are obligations', () => {
      const divide = (num: any, den: any) =>
        ce
          .function('Divide', [ce.box(num), ce.box(den)], { structural: true })
          .type.toString();
      // Unknown-finiteness numerator admits `∞/∞` = NaN.
      expect(divide('x_r', ['Ln', 0])).toBe('number');
      // Non-real numerator: `i/∞` is not claimed.
      expect(divide('ImaginaryUnit', ['Ln', 0])).toBe('number');
      // Non-real denominator: `2/~oo` is not claimed.
      expect(divide(2, 'ComplexInfinity')).toBe('number');
    });
  });

  describe('valueOf() projects only a proven direction', () => {
    // `valueOf()` used to project ANY direction-unproven infinity to `'~oo'`.
    // `Ln(0)` has sgn `non-positive` — not a proven `negative` — yet it is −∞.
    // For an infinity, `non-negative` implies `+∞` and `non-positive` implies
    // `-∞` (an infinity cannot be zero).
    test('a type-only-provable ±∞ projects to ±Infinity', () => {
      expect(ce.box(['Ln', 0]).valueOf()).toBe(-Infinity);
      expect(ce.box(['Negate', ['Ln', 0]]).valueOf()).toBe(Infinity);
    });

    test('signed-infinity symbols are unchanged', () => {
      expect(ce.symbol('PositiveInfinity').valueOf()).toBe(Infinity);
      expect(ce.symbol('NegativeInfinity').valueOf()).toBe(-Infinity);
    });

    test('`~oo` is projected only when the value is provably non-real', () => {
      expect(ce.symbol('ComplexInfinity').valueOf()).toBe('~oo');
      expect(ce.box(['Divide', 1, 0]).valueOf()).toBe('~oo');
    });

    test('a direction-unproven REAL infinity does not guess `~oo`', () => {
      ce.declare('nf_u', 'non_finite_number');
      // `nf_u + 1` is provably infinite and real, but its direction is
      // unproven: the projection falls through to the AsciiMath form instead
      // of guessing complex infinity (it used to return `'~oo'`).
      const e = ce.box(['Add', 'nf_u', 1]);
      expect(e.isInfinity).toBe(true);
      expect(e.isReal).toBe(true);
      expect(e.valueOf()).not.toBe('~oo');
      // A proven direction still projects: `|nf_u|` is non-negative, hence +∞.
      expect(ce.box(['Abs', 'nf_u']).valueOf()).toBe(Infinity);
    });
  });

  describe('possible (or provable) ~oo / NaN → number', () => {
    test('x · ∞ with possibly-zero x (0·∞ = NaN)', () => {
      expect(typeOf(['Multiply', 'x_r', 'PositiveInfinity'])).toBe('number');
      // Provably finite but possibly zero: still speculative.
      expect(typeOf(['Multiply', 'z_f', 'PositiveInfinity'])).toBe('number');
    });

    test('ElementMax/ElementMin/Clamp with a non-finite operand widen to number', () => {
      // Element-wise extrema use `numericTypeHandler`, which conservatively
      // widens to `number` when any operand may be non-finite (matching `Max`).
      expect(typeOf(['ElementMax', 'PositiveInfinity', 5])).toBe('number');
      expect(typeOf(['ElementMin', 'NegativeInfinity', 5])).toBe('number');
      expect(typeOf(['Clamp', 'x_r', 0, 'PositiveInfinity'])).toBe('number');
    });

    test('poles that evaluate to ~oo claim number, not complex/finite', () => {
      expect(typeOf(['Csc', 0])).toBe('number'); // was `complex`
      expect(typeOf(['Tan', ['Divide', 'Pi', 2]])).toBe('number'); // was `finite_real`
      expect(typeOf(['Sec', ['Divide', 'Pi', 2]])).toBe('number'); // was `finite_real`
      expect(typeOf(['Gamma', 0])).toBe('number'); // was `finite_real`
      expect(typeOf(['Gamma', -2])).toBe('number');
      expect(typeOf(['Zeta', 1])).toBe('number'); // was `finite_real`
      expect(typeOf(['Factorial', -2])).toBe('number'); // was `finite_real`
    });

    test('√(−∞) = i·∞ = ~oo claims number, not complex', () =>
      expect(typeOf(['Sqrt', 'NegativeInfinity'])).toBe('number'));

    test('Round of ~oo claims number, not non_finite_number', () =>
      expect(typeOf(['Round', 'ComplexInfinity'])).toBe('number'));

    test('∞/∞ (= NaN) stays number', () =>
      expect(typeOf(['Divide', 'PositiveInfinity', 'PositiveInfinity'])).toBe(
        'number'
      ));
  });

  describe('documented residual: the ~oo VALUE itself types complex', () => {
    // The lattice cannot represent `~oo` (non_finite_number = ±∞ only); the
    // ComplexInfinity symbol and numeric values keep their historical
    // `complex` placement until the deferred lattice refinement. Handlers
    // must not rely on this: possible-~oo results claim `number` (above).
    test('ComplexInfinity value/symbol', () => {
      expect(ce.ComplexInfinity.type.toString()).toBe('complex');
      // `1/0` canonicalizes directly to the ~oo value (`x/0 → ~∞` fold),
      // so this reports the value's type, not a Divide handler claim.
      expect(typeOf(['Divide', 1, 0])).toBe('complex');
    });
  });

  describe('complex values with a non-finite component type as complex', () => {
    // A finite complex number requires BOTH components finite. A non-finite
    // component (e.g. ∞ + i) is not `finite_complex`; it types as `complex`,
    // matching the ~oo convention (`isComplexInfinity` early-return in the
    // numeric-value type getters). `imaginary` is reserved for a finite
    // non-zero imaginary part paired with a zero real part.
    //
    // Both numeric-value lanes are exercised: the default engine (precision
    // 21) uses BigNumericValue; a machine-precision engine uses
    // MachineNumericValue.
    let savedPrecision: number;
    let ceMachine: ComputeEngine;
    beforeAll(() => {
      savedPrecision = BigDecimal.precision;
      ceMachine = new ComputeEngine();
      ceMachine.precision = 'machine';
    });
    afterAll(() => {
      BigDecimal.precision = savedPrecision;
    });

    const inf = { num: '+Infinity' };
    // A high-precision imaginary literal forces the BigNumericValue lane even
    // for the default engine.
    const hiPrec = { num: '1.00000000000000000000000001' };

    test('bignum lane (default engine, precision 21)', () => {
      expect(typeOf(['Complex', inf, 1])).toBe('complex'); // ∞ + i
      expect(typeOf(['Complex', 1, inf])).toBe('complex'); // 1 + ∞i
      expect(typeOf(['Complex', 0, inf])).toBe('complex'); // 0 + ∞i
      // ∞ real part with a high-precision (bignum) imaginary part
      expect(typeOf(['Complex', inf, hiPrec])).toBe('complex');
    });

    test('machine lane (precision = machine)', () => {
      const t = (expr: any) => ceMachine.box(expr).type.toString();
      expect(t(['Complex', inf, 1])).toBe('complex'); // ∞ + i
      expect(t(['Complex', 1, inf])).toBe('complex'); // 1 + ∞i
      expect(t(['Complex', 0, inf])).toBe('complex'); // 0 + ∞i
    });

    test('finite complex values keep their finite types', () => {
      expect(typeOf(['Complex', 2, 3])).toBe('finite_complex');
      expect(typeOf(['Complex', 0, 3])).toBe('imaginary');
    });
  });

  describe('generic-point convention and finite claims are preserved', () => {
    test('generic real symbol stays a generic (finite) point', () => {
      expect(typeOf(['Sin', 'x_r'])).toBe('finite_real');
      expect(typeOf(['Ceil', 'x_r'])).toBe('finite_integer');
      expect(typeOf(['Gamma', 'x_r'])).toBe('finite_real');
    });

    test('rounding a finite complex is finite_complex (was mistyped non_finite_number)', () => {
      expect(typeOf(['Round', 'ImaginaryUnit'])).toBe('finite_complex');
      expect(typeOf(['Truncate', ['Complex', 2.5, 1]])).toBe('finite_complex');
    });

    test('non-pole exact special values keep their finite types', () => {
      expect(typeOf(['Zeta', 2])).toBe('finite_real');
      expect(typeOf(['Gamma', ['Rational', 1, 2]])).toBe('finite_real');
      expect(typeOf(['EllipticK', ['Rational', 1, 2]])).toBe('finite_real');
    });
  });
});
