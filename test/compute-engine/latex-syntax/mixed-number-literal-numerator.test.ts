import { ComputeEngine } from '../../../src/compute-engine';

const ce = new ComputeEngine();

// A mixed number is written with integer literals only. An integer followed
// by a fraction whose numerator or denominator is an expression is a product.
describe('MIXED NUMBER: THE FRACTION MUST BE WRITTEN WITH LITERALS', () => {
  test('2\\frac{1}{3} is the mixed number 7/3', () => {
    expect(ce.parse('2\\frac{1}{3}').N().re).toBeCloseTo(7 / 3, 12);
  });

  test('-2\\frac{1}{3} is the mixed number -7/3', () => {
    expect(ce.parse('-2\\frac{1}{3}').N().re).toBeCloseTo(-7 / 3, 12);
  });

  test('2\\frac{1+1}{3} is the product 4/3', () => {
    expect(ce.parse('2\\frac{1+1}{3}').N().re).toBeCloseTo(4 / 3, 12);
  });

  test('2\\frac{2}{1+2} is the product 4/3', () => {
    expect(ce.parse('2\\frac{2}{1+2}').N().re).toBeCloseTo(4 / 3, 12);
  });

  test('2\\frac{x}{3} is still a product', () => {
    expect(ce.parse('2\\frac{x}{3}').json).toEqual([
      'Multiply',
      ['Rational', 2, 3],
      'x',
    ]);
  });
});

// A mixed number is written with EXACT integer literals only. A float in the
// integer part, the numerator or the denominator makes the juxtaposition a
// product, and the product stays inexact.
describe('MIXED NUMBER: A FLOAT LITERAL MAKES A PRODUCT', () => {
  test.each(['2\\frac{1.0}{3}', '2.0\\frac{1}{3}', '2\\frac{1}{3.0}'])(
    '%s is the product 2/3',
    (latex) => {
      const expr = ce.parse(latex);
      expect(expr.operator).toBe('Multiply');
      const value = expr.N();
      expect(value.re).toBeCloseTo(2 / 3, 12);
      expect(value.isExact).toBe(false);
    }
  );
});
