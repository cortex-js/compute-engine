import { ComputeEngine } from '../../src/compute-engine';

/**
 * CE-1060: a rule of the `Log` simplifier (`simplify-log.ts`) writes its
 * result without a base when the base is 10, as the parser does for
 * `\log_{10}` and as `ln()` does for a base of 10. Before, the power rule
 * built `Log(|x|, 10)`: `\log(x^2)` simplified to `2 log_10(|x|)`, and
 * `2\log(|x|)` to `2 log(|x|)`, two forms of one value that are not the same
 * expression. The rules for `log(10^x y)`, `log(10^x / y)`, `log(y / 10^x)`
 * and the base `1/10` built the base 10 in the same way. The quotient rule for
 * two positive operands uses the same helper, but no test here reaches it:
 * the cost function of `simplify()` keeps `log(p/q)`. A float base `10.0`
 * stays, because it asks for a numeric value.
 */

const ce = new ComputeEngine();

function simplified(latex: string): unknown {
  return ce.parse(latex).simplify().json;
}

describe('CE-1060: the Log rules leave out a base of 10', () => {
  test.each([
    ['\\log(x^2)', ['Multiply', 2, ['Log', ['Abs', 'x']]]],
    ['\\log_{10}(x^2)', ['Multiply', 2, ['Log', ['Abs', 'x']]]],
    ['\\log(x^3)', ['Multiply', 3, ['Log', 'x']]],
    [
      '\\log(x^{2/3})',
      ['Multiply', ['Rational', 2, 3], ['Log', ['Abs', 'x']]],
    ],
    ['\\log(10^x y)', ['Add', 'x', ['Log', 'y']]],
    ['\\log(\\frac{10^x}{y})', ['Add', 'x', ['Negate', ['Log', 'y']]]],
    ['\\log(\\frac{y}{10^x})', ['Add', ['Negate', 'x'], ['Log', 'y']]],
  ])('%s simplifies to a Log with no base', (latex, expected) => {
    expect(simplified(latex)).toEqual(expected);
  });

  test('the simplified forms of `\\log(x^2)` and `2\\log(|x|)` are the same', () => {
    expect(
      ce.parse('\\log(x^2)').simplify().isSame(ce.parse('2\\log(|x|)').simplify())
    ).toBe(true);
  });

  test('the base 1/10 gives -log(a) with no base', () => {
    expect(ce.box(['Log', 'x', ['Rational', 1, 10]]).simplify().json).toEqual(
      ['Negate', ['Log', 'x']]
    );
  });

  test('a base other than 10 stays', () => {
    expect(simplified('\\log_2(x^2)')).toEqual([
      'Multiply',
      2,
      ['Log', ['Abs', 'x'], 2],
    ]);
    expect(ce.box(['Log', 'x', ['Rational', 1, 2]]).simplify().json).toEqual(
      ['Negate', ['Log', 'x', 2]]
    );
  });

  test('a float base 10.0 stays, and the value stays numeric', () => {
    const expr = ce.box(['Log', ['Power', 'x', 2], { num: '10.0' }]);
    const result = expr.simplify();
    expect(result.json).toEqual([
      'Multiply',
      2,
      ['Log', ['Abs', 'x'], { num: '10.0' }],
    ]);
    expect(result.subs({ x: 2 }).evaluate().re).toBeCloseTo(Math.log10(4), 12);
  });
});
