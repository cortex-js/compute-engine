/**
 * CE-1718: at the default precision, a complex big decimal times an exact
 * rational was the product with the rounded quotient, and its digits were
 * wrong past the working precision: `N((1/3)·√-2)` was `0.471…682933i`
 * where `√2/3` is `0.471…682934`. The product is now `(x·p)/q` with guard
 * digits, as the product of two real values is.
 *
 * Each expected value is the true value rounded to 21 digits.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression as Json } from '../../src/math-json/types';

const ce = new ComputeEngine();
const n = (json: Json) => ce.box(json).N().toString();

describe('CE-1718: a complex big decimal times an exact rational', () => {
  test('the witness', () => {
    expect(n(['Multiply', ['Rational', 1, 3], ['Sqrt', -2]])).toBe(
      '0.471404520791031682934i'
    );
    expect(n(['Divide', ['Sqrt', -2], 3])).toBe('0.471404520791031682934i');
  });

  test('a complex value with a real part', () => {
    // cos(1)/3 = 0.18010076862271323913364…, sin(1)/3 = 0.28049032826929883555083…
    expect(
      n(['Multiply', ['Rational', 1, 3], ['Exp', ['Complex', 0, 1]]])
    ).toBe('(0.180100768622713239134 + 0.280490328269298835551i)');
  });

  test('a product that is exact', () => {
    expect(n(['Multiply', ['Rational', 1, 3], ['Complex', 0, 1.5]])).toBe(
      '0.5i'
    );
  });

  test('an exact Gaussian rational factor', () => {
    // ((1 + 2i)/3)·√2·i = −2√2/3 + (√2/3)i
    expect(
      n(['Multiply', ['Divide', ['Complex', 1, 2], 3], ['Sqrt', -2]])
    ).toBe('(-0.942809041582063365868 + 0.471404520791031682934i)');
  });

  test('the cells of a list', () => {
    expect(
      n(['Multiply', ['Sqrt', -2], ['List', ['Rational', 1, 3], 0.5]])
    ).toBe('[0.471404520791031682934i,0.707106781186547524401i]');
  });
});
