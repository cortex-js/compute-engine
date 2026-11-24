import { ComputeEngine } from '../../src/compute-engine';

// CE-1018: a product with no factor of negative exponent is written with no
// numerator-denominator split (`mulImpl`,
// src/compute-engine/boxed-expression/arithmetic-mul-div.ts). The split put
// the denominator of the coefficient back as the coefficient, and it folded a
// number term with the coefficient; the product written with no split must
// give the same values.

describe('CE-1018: a product with a fraction as its coefficient', () => {
  test('a power with a negative exponent of a bound index gives the coefficient', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Sum',
      ['Multiply', ['Power', 2, ['Negate', 'n']], ['Abs', ['Sin', 'x']]],
      ['Limits', 'n', 3, 3],
    ]);
    expect(expr.evaluate().json).toEqual([
      'Multiply',
      ['Rational', 1, 8],
      ['Abs', ['Sin', 'x']],
    ]);
  });

  test('radicals that merge into a number are folded with the coefficient', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Multiply',
      ['Rational', 1, 2],
      ['Power', 2, ['Rational', 1, 3]],
      ['Power', 2, ['Rational', 2, 3]],
    ]);
    const value = expr.evaluate();
    expect(value.json).toEqual(1);
    expect(value.re).toBe(1);
  });
});
