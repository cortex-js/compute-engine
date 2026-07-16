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
