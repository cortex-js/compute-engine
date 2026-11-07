import { ComputeEngine } from '../../../src/compute-engine';

// CE-1030: the differential of an integral can be at the end of the last
// factor of a product: `\int_1^2 2\frac{dx}{x}`, `\int 3(x\,dx)`. Before the
// fix, the parser searched only the end of the product, found no
// differential, and the canonical form took the free symbol `d` as the
// integration variable: `\int_1^2 2\frac{dx}{x}` evaluated to 3, not 2 ln 2.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;
const value = (s: string) => ce.parse(s).evaluate().json;

describe('CE-1030 differential in the last factor of a product', () => {
  test('a constant before a fraction that holds the differential', () => {
    expect(raw('\\int_1^2 2\\frac{dx}{x}')).toEqual([
      'Integrate',
      ['Multiply', 2, ['Divide', 1, 'x']],
      ['Tuple', 'x', 1, 2],
    ]);
    expect(value('\\int_1^2 2\\frac{dx}{x}')).toEqual(
      value('\\int_1^2 \\frac{2dx}{x}')
    );
    expect(value('\\int_1^2 2\\frac{dx}{x}')).toEqual([
      'Multiply',
      2,
      ['Ln', 2],
    ]);
  });

  test('an indefinite integral', () => {
    expect(value('\\int 2\\frac{dx}{x}')).toEqual([
      'Multiply',
      2,
      ['Ln', ['Abs', 'x']],
    ]);
  });

  test('the numerator keeps its other factors', () => {
    expect(raw('\\int_0^1 2\\frac{x dx}{3}')).toEqual([
      'Integrate',
      ['Multiply', 2, ['Divide', 'x', 3]],
      ['Tuple', 'x', 0, 1],
    ]);
    expect(value('\\int_0^1 2\\frac{x dx}{3}')).toEqual(['Rational', 1, 3]);
  });

  test('an explicit product and a negative constant', () => {
    expect(value('\\int_1^2 2\\cdot\\frac{dx}{x}')).toEqual([
      'Multiply',
      2,
      ['Ln', 2],
    ]);
    expect(value('\\int_1^2 -2\\frac{dx}{x}')).toEqual([
      'Multiply',
      -2,
      ['Ln', 2],
    ]);
  });

  test('a variable before the fraction', () => {
    expect(value('\\int_1^2 x\\frac{dx}{x^2}')).toEqual(['Ln', 2]);
  });

  test('a term after the integral', () => {
    expect(raw('\\int_1^2 2\\frac{dx}{x} + 1')).toEqual([
      'Add',
      [
        'Integrate',
        ['Multiply', 2, ['Divide', 1, 'x']],
        ['Tuple', 'x', 1, 2],
      ],
      1,
    ]);
  });

  test('the differential in parentheses at the end of a product', () => {
    expect(raw('\\int_0^1 3(x dx)')).toEqual([
      'Integrate',
      ['InvisibleOperator', 3, ['Delimiter', 'x']],
      ['Tuple', 'x', 0, 1],
    ]);
    expect(value('\\int_0^1 3(x dx)')).toEqual(['Rational', 3, 2]);
    // Parentheses that hold only the differential after a number are
    // removed.
    expect(raw('\\int_0^1 3(dx)')).toEqual(['Integrate', 3, ['Tuple', 'x', 0, 1]]);
    expect(value('\\int_0^1 3(dx)')).toEqual(3);
  });

  test('an integer before a numeric fraction is a product, not a mixed number', () => {
    // `2\frac{1}{3}` is the mixed number 7/3, but `2\frac{dx}{3}` is 2/3.
    expect(raw('\\int_0^1 2\\frac{dx}{3}')).toEqual([
      'Integrate',
      ['Multiply', 2, ['Divide', 1, 3]],
      ['Tuple', 'x', 0, 1],
    ]);
    expect(value('\\int_0^1 2\\frac{dx}{3}')).toEqual(['Rational', 2, 3]);
    expect(value('\\int_0^1 -2\\frac{dx}{3}')).toEqual(['Rational', -2, 3]);
    expect(value('\\int_0^1 2\\frac{3dx}{4}')).toEqual(['Rational', 3, 2]);
  });

  test('a function call keeps its argument', () => {
    // `f(x dx)` is the call `f(x)`, not the product `f·x`.
    expect(raw('\\int_0^1 2f(x dx)')).toEqual([
      'Integrate',
      ['InvisibleOperator', 2, 'f', ['Delimiter', 'x']],
      ['Tuple', 'x', 0, 1],
    ]);
    expect(ce.parse('\\int_0^1 2f(x dx)').json).toEqual([
      'Integrate',
      ['Function', ['Block', ['Multiply', 2, ['f', 'x']]], 'x'],
      ['Limits', 'x', 0, 1],
    ]);
    // Parentheses that hold only the differential after a symbol are not
    // taken out: `f` can be a function, and removing them would leave `2f`.
    expect(raw('\\int_0^1 2f(dx)')).toEqual([
      'Integrate',
      [
        'InvisibleOperator',
        2,
        'f',
        ['Delimiter', ['InvisibleOperator', 'd', 'x']],
      ],
      ['Tuple', 'Nothing', 0, 1],
    ]);
  });

  test('a function argument that is only the differential is not taken out', () => {
    // Taking `dx` out of `\sin(dx)` would leave `\sin` with no argument.
    const json = raw('\\int_0^1 2x\\sin(dx)');
    expect(json).toEqual([
      'Integrate',
      ['InvisibleOperator', 2, 'x', ['Sin', ['InvisibleOperator', 'd', 'x']]],
      ['Tuple', 'Nothing', 0, 1],
    ]);
  });

  test('a differential at the end of a denominator is still an error', () => {
    expect(raw('\\int_1^2 2\\frac{x}{3dx}')).toEqual([
      'Integrate',
      [
        'InvisibleOperator',
        2,
        ['Divide', 'x', ['Error', "'unexpected-differential'"]],
      ],
      ['Tuple', 'Nothing', 1, 2],
    ]);
  });
});
