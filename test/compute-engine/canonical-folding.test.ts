import { ComputeEngine } from '../../src/compute-engine';
import { check, engine as ce } from '../utils';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

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

    test('x^0 → 1 is a generic-symbol fold: fires even while the symbol holds 0', () => {
      // Canonical structure never depends on a symbol's transient value
      // (same convention as x/x → 1): `z^0` folds to 1 even while `z := 0`.
      // Only the literal `0^0` is indeterminate.
      const eng = new ComputeEngine();
      eng.assign('z', 0);
      expect(eng.parse('z^0').json).toEqual(1);
      expect(eng.parse('0^0').isNaN).toBe(true);
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

  // ─── Divide of exact complex numbers ───────────────────────────
  // An exact complex number divided by an exact number (or an exact number
  // divided by an exact complex number) folds to an exact number literal, as
  // an exact real quotient does. A float operand keeps the operation, also
  // when its value is an integer, as `1.0 / 3` does.
  describe('Divide of exact complex numbers', () => {
    const json = (latex: string) => ce.parse(latex).json;

    test('an imaginary literal over a number', () => {
      expect(json('\\frac{i}{3}')).toEqual(['Complex', 0, ['Rational', 1, 3]]);
      expect(json('\\frac{2i}{3}')).toEqual(['Complex', 0, ['Rational', 2, 3]]);
      expect(json('\\frac{i}{1/2}')).toEqual(['Complex', 0, 2]);
      expect(json('\\frac{i}{\\sqrt2}')).toEqual([
        'Complex',
        0,
        ['Divide', ['Sqrt', 2], 2],
      ]);
      expect(json('\\frac{3+i}{2}')).toEqual([
        'Complex',
        ['Rational', 3, 2],
        ['Rational', 1, 2],
      ]);
      expect(json('\\frac{i}{3}\\cdot 3')).toEqual(['Complex', 0, 1]);
      expect(json('\\frac{i}{3}x')).toEqual([
        'Multiply',
        ['Complex', 0, ['Rational', 1, 3]],
        'x',
      ]);
    });

    test('a complex divisor', () => {
      expect(json('\\frac{2}{i}')).toEqual(['Complex', 0, -2]);
      // (3+i)(1+i)/2 = (2+4i)/2
      expect(json('\\frac{3+i}{1-i}')).toEqual(['Complex', 1, 2]);
    });

    test('the folded result is exact', () => {
      const v = ce.parse('\\frac{i}{3}');
      expect(v.isNumberLiteral).toBe(true);
      expect(v.isExact).toBe(true);
      expect(ce.parse('\\frac{3+i}{1-i}').isExact).toBe(true);
      expect(ce.parse('\\frac{i}{3}').latex).toBe('\\frac{1}{3}\\imaginaryI');
    });

    test('a zero divisor gives ComplexInfinity', () => {
      expect(json('\\frac{i}{0}')).toEqual('ComplexInfinity');
    });

    test('a symbolic divisor keeps the division', () => {
      expect(json('\\frac{i}{x}')).toEqual(['Divide', ['Complex', 0, 1], 'x']);
    });

    test('a float operand keeps the operation and stays inexact', () => {
      const q = ce.parse('\\frac{1.0i}{3}');
      expect(q.operator).toBe('Divide');
      expect(q.isExact).not.toBe(true);
      expect(ce.parse('\\frac{2.0i}{2}').operator).toBe('Divide');
      expect(ce.parse('\\frac{1.5i}{3}').operator).toBe('Divide');
      expect(ce.parse('\\frac{3}{1.0i}').operator).toBe('Divide');
      // The same rule for a product and a sum
      expect(ce.parse('1.0i\\cdot 3').operator).toBe('Multiply');
      expect(ce.parse('(2.0+1.0i)\\cdot 3').operator).toBe('Multiply');
      const s = ce.parse('1.0i+3');
      expect(s.isExact).not.toBe(true);
      expect([s.re, s.im]).toEqual([3, 1]);
    });

    test('an exact complex literal keeps folding in a product and a sum', () => {
      expect(json('3i\\cdot 2')).toEqual(['Complex', 0, 6]);
      expect(json('i\\cdot 3')).toEqual(['Complex', 0, 3]);
      expect(json('(3+i)\\cdot 2')).toEqual(['Complex', 6, 2]);
      expect(json('i+3')).toEqual(['Complex', 3, 1]);
      expect(ce.parse('i\\cdot 3').isExact).toBe(true);
      expect(ce.parse('i+3').isExact).toBe(true);
    });

    test('a float complex value makes exact arithmetic inexact', () => {
      // The parts of `1.0i` and `2.0+1.0i` are integers, but they are
      // floats: a sum, product or quotient with an exact value is a float,
      // as `1/3 + 1.0` is.
      const f = ce.parse('1.0i');
      const third = ce.number([1, 3]);
      for (const v of [
        third.add(f),
        third.mul(f),
        third.div(f),
        f.add(third),
        f.mul(third),
        ce.parse('\\sqrt2').mul(f),
        ce.number(3).mul(ce.parse('2.0+1.0i')),
      ]) {
        expect(v.isNumberLiteral).toBe(true);
        expect(v.isExact).toBe(false);
      }
      for (const latex of [
        '\\frac{1}{3}+1.0i',
        '\\frac{1}{2}+1.0i',
        '\\frac{1}{3}\\cdot(2.0+1.0i)',
        '\\frac{1.0i}{3}',
        '\\frac{3}{1.0i}',
        '1.0i\\cdot 3',
        '(2.0+1.0i)\\cdot 3',
        '\\sum_{k=1}^{3} \\frac{k}{2}\\cdot 1.0i',
      ]) {
        const v = ce.parse(latex).evaluate();
        expect([latex, v.isExact]).toEqual([latex, false]);
      }
      const third1 = ce.parse('\\frac{1.0i}{3}').evaluate();
      expect(third1.im).toBeCloseTo(1 / 3, 15);
      const m = ce
        .parse('\\begin{pmatrix}1.0i\\\\1\\end{pmatrix}+\\frac{1}{3}')
        .evaluate();
      expect(
        isFunction(m) && isFunction(m.ops[0]) && m.ops[0].ops[0].isExact
      ).toBe(false);
    });

    test('the structural form and Hold keep the Divide', () => {
      expect(
        ce.function('Divide', [ce.box(['Complex', 0, 1]), ce.number(3)], {
          form: 'structural',
        }).operator
      ).toBe('Divide');
      expect(ce.box(['Hold', ['Divide', ['Complex', 0, 1], 3]]).json).toEqual([
        'Hold',
        ['Divide', ['Complex', 0, 1], 3],
      ]);
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
