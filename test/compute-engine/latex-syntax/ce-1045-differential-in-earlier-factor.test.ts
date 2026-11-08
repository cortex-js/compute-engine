import { ComputeEngine } from '../../../src/compute-engine';

// CE-1045: the parser searches a product for the differential of an integral
// only at the end of the product and in its last factor. When a factor that
// holds the differential is followed by another factor
// (`\int_1^2 \frac{dx}{x}\cdot 2`), no differential was found, the `d` stayed
// a free symbol, and the canonical form took it as the integration variable:
// the integral evaluated to 3, not 2 ln 2. Now such a factor is replaced by an
// `unexpected-differential` error, as a differential at the end of a
// denominator is, and the expression is not valid.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;
const ERROR = ['Error', "'unexpected-differential'"];

describe('CE-1045 differential in a factor before another factor', () => {
  test('a fraction with the differential before an explicit product', () => {
    expect(raw('\\int_1^2 \\frac{dx}{x}\\cdot 2')).toEqual([
      'Integrate',
      ['Multiply', ERROR, 2],
      ['Tuple', 'Nothing', 1, 2],
    ]);
    const expr = ce.parse('\\int_1^2 \\frac{dx}{x}\\cdot 2');
    expect(expr.isValid).toBe(false);
    expect(expr.evaluate().operator).toBe('Error');
  });

  test('a fraction with the differential before an invisible product', () => {
    expect(raw('\\int_1^2 \\frac{dx}{x} 2')).toEqual([
      'Integrate',
      ['InvisibleOperator', ERROR, 2],
      ['Tuple', 'Nothing', 1, 2],
    ]);
    expect(ce.parse('\\int_1^2 \\frac{dx}{x} 2').isValid).toBe(false);
  });

  test('the differential in parentheses before another factor', () => {
    expect(raw('\\int_0^1 (x\\,dx) 3')).toEqual([
      'Integrate',
      ['InvisibleOperator', ERROR, 3],
      ['Tuple', 'Nothing', 0, 1],
    ]);
  });

  test('a product inside the last factor', () => {
    expect(raw('\\int_0^1 2(\\frac{dx}{x} 3)')).toEqual([
      'Integrate',
      ['InvisibleOperator', 2, ['Delimiter', ['InvisibleOperator', ERROR, 3]]],
      ['Tuple', 'Nothing', 0, 1],
    ]);
  });

  test('a term after the product', () => {
    expect(ce.parse('\\int_0^1 \\frac{dx}{x}\\cdot 2 + 1').isValid).toBe(
      false
    );
  });

  test('the differential in the last factor is still taken out', () => {
    expect(ce.parse('\\int_1^2 2\\frac{dx}{x}').evaluate().json).toEqual([
      'Multiply',
      2,
      ['Ln', 2],
    ]);
  });

  test('parentheses after a symbol that hold more than the differential', () => {
    // `parseSubintegrand()` takes the differential out of `x(x\,dx)` when it
    // is the last factor, so before another factor it is misplaced.
    expect(raw('\\int_1^2 x(x\\,dx) 2')).toEqual([
      'Integrate',
      ['InvisibleOperator', 'x', ERROR, 2],
      ['Tuple', 'Nothing', 1, 2],
    ]);
    expect(ce.parse('\\int_1^2 f(x\\,dx) 2').isValid).toBe(false);
  });

  test('an inner integral that takes the differential of the last factor', () => {
    // The inner integral takes `dy`; the outer one finds no differential,
    // and `\frac{dx}{x}` before the last factor is misplaced.
    expect(
      ce.parse('\\int_1^2\\int_1^3 \\frac{dx}{x}\\frac{dy}{y}').isValid
    ).toBe(false);
  });

  test('a double integral sign that finds one of its two differentials', () => {
    expect(raw('\\iint_1^2 \\frac{dx}{x}\\frac{dy}{y}')).toEqual([
      'Integrate',
      ['Multiply', ERROR, ['Divide', 1, 'y']],
      ['Tuple', 'y', 1, 2],
    ]);
  });

  test('parentheses after a symbol are a call, not a misplaced differential', () => {
    // `f(dx)` can be a call of the function `f`: parentheses that hold only
    // the differential after a symbol are not marked, as they are not taken
    // out when they are the last factor.
    expect(raw('\\int_0^1 f(dx) 2')).toEqual([
      'Integrate',
      [
        'InvisibleOperator',
        'f',
        ['Delimiter', ['InvisibleOperator', 'd', 'x']],
        2,
      ],
      ['Tuple', 'Nothing', 0, 1],
    ]);
  });
});
