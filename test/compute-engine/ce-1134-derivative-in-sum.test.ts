import { ComputeEngine } from '../../src/compute-engine';

/**
 * CE-1134: the evaluate handler of `D` hides the value of its variable, so
 * with `x = 5` the value of `D(x^2, x)` is `2x`. A `Sum` or a `Product` of such
 * terms evaluated the sum (the product) of the terms again, and that second
 * evaluation read `x`: `Sum(D(x^2, x), (i, 1, 2))` was `20`, not `4x`. The
 * values of the symbols in the evaluated terms are now hidden for that
 * evaluation (`evaluateFoldOfValues()`, `library/arithmetic.ts`). A symbol of
 * the body that the evaluation of a term reads still gives its value.
 */

const ce = new ComputeEngine();
ce.assign('x', 5);
ce.assign('x_1', 5);

function evaluate(latex: string): string {
  return ce.parse(latex).evaluate().toString();
}

describe('CE-1134: a derivative in a sum or a product keeps its variable', () => {
  test('a derivative alone', () => {
    expect(evaluate('\\frac{d}{dx}x^2')).toBe('2x');
  });

  test('a sum of derivatives', () => {
    expect(evaluate('\\sum_{i=1}^{2}\\frac{d}{dx}x^2')).toBe('4x');
    expect(evaluate('\\sum_{i=1}^{2}\\frac{d}{dx}\\frac{x^2}{2}')).toBe('2x');
    expect(evaluate('\\sum_{i=1}^{2} i\\frac{d}{dx}x^2')).toBe('6x');
  });

  test('a product of derivatives', () => {
    expect(evaluate('\\prod_{i=1}^{2}\\frac{d}{dx}x^2')).toBe('4x^2');
  });

  test('a partial derivative by an indexed variable', () => {
    expect(
      ce
        .parse('\\sum_{i=1}^{2}\\frac{\\partial}{\\partial x_i}x_i^2')
        .evaluate()
        .latex
    ).toBe('2x_1+2x_2');
  });

  test('a numeric approximation', () => {
    expect(ce.parse('\\sum_{i=1}^{2}\\frac{d}{dx}x^2').N().toString()).toBe(
      '4x'
    );
    expect(ce.parse('\\prod_{i=1}^{2}\\frac{d}{dx}x^2').N().toString()).toBe(
      '4x^2'
    );
  });

  test('the asynchronous evaluation', async () => {
    const sum = await ce
      .parse('\\sum_{i=1}^{2}\\frac{d}{dx}x^2')
      .evaluateAsync();
    expect(sum.toString()).toBe('4x');
    const product = await ce
      .parse('\\prod_{i=1}^{2}\\frac{d}{dx}x^2')
      .evaluateAsync();
    expect(product.toString()).toBe('4x^2');
  });

  test('a symbol of the body still gives its value', () => {
    expect(evaluate('\\sum_{i=1}^{2} x')).toBe('10');
    expect(evaluate('\\sum_{i=1}^{2} (x + i)')).toBe('13');
    expect(evaluate('\\prod_{i=1}^{2} x')).toBe('25');
    expect(ce.box(['Sum', ['List', 'x', 'x']]).evaluate().toString()).toBe(
      '10'
    );
  });
});
