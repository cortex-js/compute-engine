import { ComputeEngine } from '../../src/compute-engine';
import { check, engine as ce } from '../utils';

describe('CANONICAL FOLDING', () => {
  // ─── Add folding ───────────────────────────────────────────────
  describe('Add folding', () => {
    test('integer + integer', () => {
      expect(ce.parse('2 + 3').json).toEqual(5);
    });

    test('rational + rational', () => {
      expect(ce.parse('\\frac{1}{3} + \\frac{2}{3}').json).toEqual(1);
    });

    test('radical grouping: √2 + √2 → 2√2', () => {
      expect(ce.expr(['Add', ['Sqrt', 2], ['Sqrt', 2]]).json).toEqual([
        'Multiply',
        2,
        ['Sqrt', 2],
      ]);
    });

    test('different radicals preserved: √2 + √3 → Add(√2, √3)', () => {
      const result = ce.expr(['Add', ['Sqrt', 2], ['Sqrt', 3]]);
      expect(result.operator).toBe('Add');
    });

    test('fold integers with symbolic: 2 + x + 5 → Add(x, 7)', () => {
      expect(ce.parse('2 + x + 5').json).toEqual(['Add', 'x', 7]);
    });

    test('floats NOT folded: 1.5 + x + 0.5', () => {
      const result = ce.expr(['Add', 1.5, 'x', 0.5]);
      // Floats are not folded — should remain separate operands
      expect(result.operator).toBe('Add');
      const json = result.json;
      expect(Array.isArray(json)).toBe(true);
      if (Array.isArray(json)) {
        expect(json).toContain(0.5);
        expect(json).toContain(1.5);
      }
    });

    test('zero elimination: 0 + x → x', () => {
      expect(ce.parse('0 + x').json).toEqual('x');
    });
  });

  // ─── Multiply folding ──────────────────────────────────────────
  describe('Multiply folding', () => {
    test('integer × integer', () => {
      expect(ce.parse('2 \\times 3').json).toEqual(6);
    });

    test('product = 1, identity: 1/2 * 2 * x → x', () => {
      expect(ce.expr(['Multiply', ['Rational', 1, 2], 2, 'x']).json).toEqual(
        'x'
      );
    });

    test('fold integers with symbolic: 2 * x * 5 → Multiply(10, x)', () => {
      expect(ce.expr(['Multiply', 2, 'x', 5]).json).toEqual([
        'Multiply',
        10,
        'x',
      ]);
    });

    test('float NOT folded: 1.5 * x * 2', () => {
      const result = ce.expr(['Multiply', 1.5, 'x', 2]);
      const json = result.json;
      expect(Array.isArray(json)).toBe(true);
      if (Array.isArray(json)) {
        // Float 1.5 is not folded with integer 2
        expect(json).toContain(1.5);
        expect(json).toContain(2);
      }
    });

    test('0 * x stays as Multiply(0, x)', () => {
      // Note: 0 * x is not folded to 0 at canonicalization — requires simplification
      expect(ce.expr(['Multiply', 0, 'x']).json).toEqual(['Multiply', 0, 'x']);
    });

    test('1 * x → x', () => {
      expect(ce.expr(['Multiply', 1, 'x']).json).toEqual('x');
    });
  });

  // ─── Power folding ─────────────────────────────────────────────
  describe('Power folding', () => {
    test('Power(2, 3) → 8', () => {
      expect(ce.expr(['Power', 2, 3]).json).toEqual(8);
    });

    test('Power(3, 2) → 9', () => {
      expect(ce.expr(['Power', 3, 2]).json).toEqual(9);
    });

    test('Power(1/2, 2) → 1/4 (rational base)', () => {
      expect(ce.expr(['Power', ['Rational', 1, 2], 2]).json).toEqual([
        'Rational',
        1,
        4,
      ]);
    });

    test('Power(2, -1) → 1/2 (negative exponent)', () => {
      expect(ce.expr(['Power', 2, -1]).json).toEqual(['Rational', 1, 2]);
    });

    test('Power(x, 2) stays as Power (non-numeric base, no fold)', () => {
      const result = ce.expr(['Power', 'x', 2]);
      expect(result.operator).toBe('Power');
    });

    test('Power(2, 100) stays as Power (exceeds exponent limit of 64)', () => {
      const result = ce.expr(['Power', 2, 100]);
      expect(result.operator).toBe('Power');
    });

    test('Power(-2, 2) → 4 (negative base, even exponent)', () => {
      expect(ce.expr(['Power', -2, 2]).json).toEqual(4);
    });

    test('Power(-2, 3) → -8 (negative base, odd exponent)', () => {
      expect(ce.expr(['Power', -2, 3]).json).toEqual(-8);
    });

    test('Power(10, 10) → 10000000000 (large but safe integer)', () => {
      expect(ce.expr(['Power', 10, 10]).json).toEqual(10000000000);
    });
  });

  // ─── Complex promotion ─────────────────────────────────────────
  describe('Complex promotion', () => {
    test('adjacent: 1 + i → Complex(1, 1)', () => {
      const result = ce.parse('1 + i');
      expect(result.re).toEqual(1);
      expect(result.im).toEqual(1);
    });

    test('combined: 2 + 3i → Complex(2, 3)', () => {
      const result = ce.parse('2 + 3i');
      expect(result.re).toEqual(2);
      expect(result.im).toEqual(3);
    });

    test('non-adjacent real+imaginary: first real pairs with imaginary', () => {
      // x + 1 + 2i → Add(x, Complex(1, 2))
      const result = ce.expr(['Add', 'x', 1, ce.expr(['Complex', 0, 2])]);
      const json = result.json;
      expect(Array.isArray(json)).toBe(true);
      if (Array.isArray(json)) {
        expect(json[0]).toBe('Add');
        // The real 1 should be combined with the imaginary 2i
        expect(json).toContainEqual(['Complex', 1, 2]);
      }
    });
  });

  // ─── NumericValue 0 * ∞ ────────────────────────────────────────
  describe('NumericValue 0 × Infinity', () => {
    test('0 * ∞ → NaN', () => {
      const zero = ce._numericValue(0);
      const inf = ce._numericValue(Infinity);
      expect(zero.mul(inf).isNaN).toBe(true);
    });

    test('∞ * 0 → NaN', () => {
      const zero = ce._numericValue(0);
      const inf = ce._numericValue(Infinity);
      expect(inf.mul(zero).isNaN).toBe(true);
    });

    test('0 * -∞ → NaN', () => {
      const zero = ce._numericValue(0);
      const negInf = ce._numericValue(-Infinity);
      expect(zero.mul(negInf).isNaN).toBe(true);
    });

    test('-∞ * 0 → NaN', () => {
      const zero = ce._numericValue(0);
      const negInf = ce._numericValue(-Infinity);
      expect(negInf.mul(zero).isNaN).toBe(true);
    });

    test('0 * ∞ → NaN (literal zero)', () => {
      const inf = ce._numericValue(Infinity);
      expect(inf.mul(0).isNaN).toBe(true);
    });

    test('∞ * 0 (literal zero) → NaN', () => {
      const zero = ce._numericValue(0);
      const inf = ce._numericValue(Infinity);
      // NumericValue(0) * literal infinity handled by other === Infinity path
      expect(zero.mul(inf).isNaN).toBe(true);
    });

    test('Bignum: 0 * ∞ → NaN', () => {
      const bce = new ComputeEngine({ precision: 200 });
      const zero = bce._numericValue(0);
      const inf = bce._numericValue(Infinity);
      expect(zero.mul(inf).isNaN).toBe(true);
      expect(inf.mul(zero).isNaN).toBe(true);
    });

    test('ExactNumericValue: 0 * ∞ → NaN', () => {
      const zero = ce._numericValue({ rational: [0, 1], radical: 1 });
      const inf = ce._numericValue(Infinity);
      expect(zero.mul(inf).isNaN).toBe(true);
      expect(inf.mul(zero).isNaN).toBe(true);
    });
  });
});
