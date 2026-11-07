import { ComputeEngine } from '../../src/compute-engine';

/**
 * CE-1066: `simplify()` of a sum or a product simplifies each logarithm term
 * before it collects the like terms, so `log(x^3)` becomes `3log(x)` and
 * `log(x^3) - 3log(x)` becomes 0. A logarithm term is an `Ln`, or a `Log` of
 * any base, alone, negated or with a number-literal coefficient. Before, only
 * an `Ln` (or a `Log` of base e) alone was selected: `log(x^3) - 3log(x)`,
 * `3ln(x) - ln(x^3)` and `2ln(x^3) - 6ln(x)` stayed unchanged. The power rule
 * of the logarithm still does not apply to a declared-complex or a negative
 * base, so the sum stays unchanged for such a base.
 */

describe('CE-1066: a logarithm term of a sum is simplified', () => {
  const ce = new ComputeEngine();

  test.each([
    '\\log(x^3)-3\\log(x)',
    '3\\log(x)-\\log(x^3)',
    '\\ln(x^3)-3\\ln(x)',
    '3\\ln(x)-\\ln(x^3)',
    '2\\ln(x^3)-6\\ln(x)',
    '2\\log(x^3)-6\\log(x)',
    '\\log_2(x^3)-3\\log_2(x)',
    '\\log_e(x^3)-3\\ln(x)',
    '\\frac{1}{2}\\log(x^4)-\\log(x^2)',
  ])('%s simplifies to 0', (latex) => {
    expect(ce.parse(latex).simplify().json).toEqual(0);
  });

  test('\\log(x^3) - \\log(x) simplifies to 2log(x)', () => {
    expect(ce.parse('\\log(x^3)-\\log(x)').simplify().json).toEqual([
      'Multiply',
      2,
      ['Log', 'x'],
    ]);
  });

  test('\\log_2(x^3) + y keeps the base 2', () => {
    expect(ce.parse('\\log_2(x^3)+y').simplify().json).toEqual([
      'Add',
      'y',
      ['Multiply', 3, ['Log', 'x', 2]],
    ]);
  });

  // `ln()` of `boxed-function.ts` and `boxed-symbol.ts` left out every base
  // whose real part is 10, also the float `10.0`. A `Log` term of a sum is now
  // simplified, so that defect also changed the base of such a term.
  test.each([
    [['Log', 'x', { num: '10.0' }], ['Log', 'x', { num: '10.0' }]],
    [
      ['Log', ['Abs', 'x'], { num: '10.0' }],
      ['Log', ['Abs', 'x'], { num: '10.0' }],
    ],
    [
      ['Add', 'y', ['Log', ['Power', 'x', 3], { num: '10.0' }]],
      ['Add', 'y', ['Multiply', 3, ['Log', 'x', { num: '10.0' }]]],
    ],
  ])('the float base 10.0 of %j stays', (input, expected) => {
    expect(ce.box(input as any).simplify().json).toEqual(expected);
  });
});

describe('CE-1066: the sum stays when the power rule does not apply', () => {
  test.each([
    '\\log(z^3)-3\\log(z)',
    '3\\log(z)-\\log(z^3)',
    '\\ln(z^3)-3\\ln(z)',
  ])('%s with z complex is not 0', (latex) => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    expect(ce.parse(latex).simplify().json).not.toEqual(0);
  });

  test.each(['\\log(x^3)-3\\log(x)', '3\\ln(x)-\\ln(x^3)'])(
    '%s with x < 0 is not 0',
    (latex) => {
      const ce = new ComputeEngine();
      ce.assume(ce.parse('x<0'));
      expect(ce.parse(latex).simplify().json).not.toEqual(0);
    }
  );
});
