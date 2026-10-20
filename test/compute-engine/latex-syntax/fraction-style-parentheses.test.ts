import { ComputeEngine, isNumber } from '../../../src/compute-engine';

/**
 * The `reciprocal` and `factor` fraction styles put parentheses only where
 * they are necessary.
 *
 * - `reciprocal` writes `a/b` as `a` times the inverse power of `b`. The
 *   denominator is the base of a power, so it gets parentheses where the
 *   `Power` serializer puts them around a base (a sum, a product, a power),
 *   and not around a symbol, a number or a function: `a\times b^{-1}`, not
 *   `a\times(b)^{-1}`.
 * - `factor` writes `a/b` as `\frac{1}{b}` followed by `a`. The numerator
 *   gets parentheses where a factor of a product gets them (a sum, a
 *   negative value): `\frac{1}{b}a`, not `\frac{1}{b}(a)`. A numerator that
 *   starts with a digit gets an explicit multiplication sign:
 *   `\frac{1}{3}\times2`.
 *
 * The output parses back to `Multiply(a, Divide(1, b))`, not to
 * `Divide(a, b)`, because the canonical form of a product keeps a
 * `Divide(1, b)` factor. The value is the same, which the tests check at
 * sample points.
 */

const ce = new ComputeEngine();

const POINTS = [
  { a: 1.3, b: 2.7, c: 0.4, x: 0.9, y: 1.7 },
  { a: -0.6, b: 0.35, c: 5.2, x: 2.1, y: -1.4 },
];

function expectSameValue(input: string, latex: string): void {
  // Parse in a new engine, so that no symbol has a type from the input.
  const back = new ComputeEngine().parse(latex);
  const expr = ce.parse(input);
  for (const point of POINTS) {
    const expected = expr.subs(point).N().re;
    const actual = back.subs(point).N().re;
    expect(Number.isFinite(expected)).toBe(true);
    expect(actual).toBeCloseTo(expected, 12);
  }
}

describe('RECIPROCAL FRACTION STYLE: PARENTHESES', () => {
  test.each([
    // No parentheses around a symbol, a number or a function
    ['a/b', 'a\\times b^{-1}'],
    ['\\frac{2}{b}', '2b^{-1}'],
    ['\\frac{2}{3}', '2\\times3^{-1}'],
    ['\\frac{x}{2}', 'x\\times2^{-1}'],
    ['\\frac{\\pi}{b}', '\\pi b^{-1}'],
    ['\\frac{1.5}{b}', '1.5\\times b^{-1}'],
    ['\\frac{1}{b}', 'b^{-1}'],
    ['\\frac{a}{\\sin b}', 'a\\times\\sin(b)^{-1}'],
    ['\\frac{a}{\\sqrt{b}}', 'a\\times\\sqrt{b}^{-1}'],
    ['\\frac{a}{|b|}', 'a\\times\\vert b\\vert^{-1}'],
    // Parentheses where they are necessary
    ['\\frac{a+c}{b}', '(a+c)b^{-1}'],
    ['\\frac{a}{b+c}', 'a\\times(b+c)^{-1}'],
    ['\\frac{a}{b-c}', 'a\\times(b-c)^{-1}'],
    ['\\frac{-a}{b}', '(-a)b^{-1}'],
    ['\\frac{a}{2b}', 'a\\times(2b)^{-1}'],
    ['\\frac{a}{xy}', 'a\\times(xy)^{-1}'],
    ['\\frac{x}{b^2}', 'x\\times(b^2)^{-1}'],
    ['\\frac{a}{2^x}', 'a\\times(2^{x})^{-1}'],
    ['\\frac{a}{(xy)^2}', 'a\\times((xy)^2)^{-1}'],
  ])('%s', (input, expected) => {
    const latex = ce.parse(input).toLatex({ fractionStyle: 'reciprocal' });
    expect(latex).toBe(expected);
    expectSameValue(input, latex);
  });

  test('a/b parses back to a times the inverse of b', () => {
    const latex = ce.parse('a/b').toLatex({ fractionStyle: 'reciprocal' });
    expect(ce.parse(latex).json).toEqual(['Multiply', 'a', ['Divide', 1, 'b']]);
  });
});

describe('FACTOR FRACTION STYLE: PARENTHESES', () => {
  test.each([
    // No parentheses around a symbol, a function, a power or a product
    ['a/b', '\\frac{1}{b}a'],
    ['\\frac{\\pi}{b}', '\\frac{1}{b}\\pi'],
    ['\\frac{x}{2}', '\\frac{1}{2}x'],
    ['\\frac{x^2}{b}', '\\frac{1}{b}x^2'],
    ['\\frac{\\sin x}{b}', '\\frac{1}{b}\\sin(x)'],
    ['\\frac{xy}{b}', '\\frac{1}{b}xy'],
    ['\\frac{|a|}{b}', '\\frac{1}{b}\\vert a\\vert'],
    ['\\frac{a}{b+c}', '\\frac{1}{b+c}a'],
    ['\\frac{a}{2b}', '\\frac{1}{2b}a'],
    ['\\frac{(a+c)(a-c)}{b}', '\\frac{1}{b}(a+c)(a-c)'],
    // A numerator 1 is not written
    ['\\frac{1}{b}', '\\frac{1}{b}'],
    // A numerator that starts with a digit gets an explicit sign
    ['\\frac{2}{b}', '\\frac{1}{b}\\times2'],
    ['\\frac{2}{3}', '\\frac{1}{3}\\times2'],
    ['\\frac{1.5}{b}', '\\frac{1}{b}\\times1.5'],
    ['\\frac{2x}{b}', '\\frac{1}{b}\\times2x'],
    ['\\frac{2^x}{b}', '\\frac{1}{b}\\times2^{x}'],
    // Parentheses where they are necessary
    ['\\frac{a+c}{b}', '\\frac{1}{b}(a+c)'],
    ['\\frac{-a}{b}', '\\frac{1}{b}(-a)'],
    ['\\frac{-2x}{b}', '\\frac{1}{b}(-2x)'],
  ])('%s', (input, expected) => {
    const latex = ce.parse(input).toLatex({ fractionStyle: 'factor' });
    expect(latex).toBe(expected);
    expectSameValue(input, latex);
  });

  test('a/b parses back to a times the inverse of b', () => {
    const latex = ce.parse('a/b').toLatex({ fractionStyle: 'factor' });
    expect(ce.parse(latex).json).toEqual(['Multiply', 'a', ['Divide', 1, 'b']]);
  });

  test('a factor style fraction inside a sum and a power', () => {
    const style = { fractionStyle: 'factor' } as const;
    expect(ce.parse('\\frac{a}{b}+1').toLatex(style)).toBe('\\frac{1}{b}a+1');
    expect(ce.parse('(\\frac{a}{b})^2').toLatex(style)).toBe(
      '(\\frac{1}{b}a)^2'
    );
    expectSameValue('\\frac{a}{b}+1', '\\frac{1}{b}a+1');
    expectSameValue('(\\frac{a}{b})^2', '(\\frac{1}{b}a)^2');
  });
});

/**
 * A big operator (`\sum`, `\prod`, `\lim`) reads its body up to the end of
 * the product it stands in. In the `reciprocal` style, a big operator as the
 * numerator or the denominator therefore gets parentheses: without them,
 * `\lim_{x\to1}2x^{-1}` reads back as the limit of `2/x`, and
 * `\prod_{i=1}^{n}i\times b^{-1}` as the product of `i/b`.
 */
describe('FRACTION STYLES: A BIG OPERATOR IN A FRACTION', () => {
  const BIG_POINTS = [
    { n: 3, b: 2 },
    { n: 4, b: 0.5 },
  ];
  test.each([
    ['\\frac{1}{\\lim_{x\\to1}2x}', 'reciprocal', '(\\lim_{x\\to1}2x)^{-1}'],
    ['\\frac{1}{\\sum_{i=1}^{n}i}', 'reciprocal', '(\\sum_{i=1}^{n}i)^{-1}'],
    [
      '\\frac{\\prod_{i=1}^{n}i}{b}',
      'reciprocal',
      '(\\prod_{i=1}^{n}i)\\times b^{-1}',
    ],
    [
      '\\frac{\\lim_{t\\to0}\\frac{\\sin t}{t}}{b}',
      'reciprocal',
      '(\\lim_{t\\to0}\\sin(t)\\times t^{-1})\\times b^{-1}',
    ],
    ['\\frac{\\prod_{i=1}^{n}i}{b}', 'factor', '\\frac{1}{b}\\prod_{i=1}^{n}i'],
    ['\\frac{1}{\\lim_{x\\to1}2x}', 'factor', '\\frac{1}{\\lim_{x\\to1}2x}'],
  ] as const)('%s (%s)', (input, style, expected) => {
    const latex = ce.parse(input).toLatex({ fractionStyle: style });
    expect(latex).toBe(expected);
    const back = new ComputeEngine().parse(latex);
    const expr = ce.parse(input);
    for (const point of BIG_POINTS) {
      const expected = expr.subs(point).N().re;
      expect(Number.isFinite(expected)).toBe(true);
      expect(back.subs(point).N().re).toBeCloseTo(expected, 12);
    }
  });
});

/**
 * Only an exact numerator or denominator 1 is left out. A float `1.0` and a
 * decimal that rounds to 1 as a double are written, so that the value read
 * back is still inexact.
 */
describe('FRACTION STYLES: A FLOAT 1 IS NOT DROPPED', () => {
  test.each([
    ['\\frac{1.0}{b}', 'reciprocal', '1.0\\times b^{-1}', 0.5],
    ['\\frac{1.0}{b}', 'factor', '\\frac{1}{b}\\times1.0', 0.5],
    [
      '\\frac{1.0000000000000001}{b}',
      'reciprocal',
      '1.000\\,000\\,000\\,000\\,000\\,1\\times b^{-1}',
      0.5,
    ],
    [
      '\\frac{1.0000000000000001}{b}',
      'factor',
      '\\frac{1}{b}\\times1.000\\,000\\,000\\,000\\,000\\,1',
      0.5,
    ],
    ['\\frac{a}{1.0}', 'factor', '\\frac{1}{1.0}a', 3],
  ] as const)('%s (%s)', (input, style, expected, numeric) => {
    const latex = ce.parse(input).toLatex({ fractionStyle: style });
    expect(latex).toBe(expected);
    const back = new ComputeEngine().parse(latex);
    const value = back.subs({ a: 3, b: 2 }).evaluate();
    expect(isNumber(value) && value.isExact).toBe(false);
    expect(value.N().re).toBeCloseTo(numeric, 12);
  });

  test('an exact 1 is still left out', () => {
    expect(
      ce.parse('\\frac{1}{b}').toLatex({ fractionStyle: 'reciprocal' })
    ).toBe('b^{-1}');
    expect(ce.parse('\\frac{1}{b}').toLatex({ fractionStyle: 'factor' })).toBe(
      '\\frac{1}{b}'
    );
  });
});

/**
 * The parser reads an integer followed by a fraction of two integers as a
 * mixed number: `2\frac{1}{3}` is `2 + 1/3`. The non-canonical form of that
 * input is `InvisibleOperator(2, Divide(1, 3))`. Whatever the fraction style
 * is, the fraction is written `\frac{1}{3}`, so the LaTeX reads back as the
 * mixed number: `2\times3^{-1}` (reciprocal) and `2\times1/3` (inline
 * solidus) read back as `2/3`.
 */
describe('FRACTION STYLES: A MIXED NUMBER IN AN INVISIBLE OPERATOR', () => {
  const STYLES = [
    'quotient',
    'block-quotient',
    'inline-quotient',
    'inline-solidus',
    'nice-solidus',
    'reciprocal',
    'factor',
  ] as const;

  test.each(STYLES)('2 1/3 (%s)', (style) => {
    for (const fraction of [
      ['Divide', 1, 3],
      ['Rational', 1, 3],
    ]) {
      const expr = ce.box(['InvisibleOperator', 2, fraction], { form: 'raw' });
      const latex = expr.toLatex({ fractionStyle: () => style });
      expect(latex).toBe('2\\frac{1}{3}');
      expect(ce.parse(latex).evaluate().json).toEqual(['Rational', 7, 3]);
    }
  });

  test.each(STYLES)('-2 1/3 (%s)', (style) => {
    const expr = ce.parse('-2\\frac{1}{3}', { form: 'raw' });
    expect(expr.json).toEqual([
      'InvisibleOperator',
      ['Negate', 2],
      ['Divide', 1, 3],
    ]);
    const latex = expr.toLatex({ fractionStyle: () => style });
    expect(latex).toBe('-2\\frac{1}{3}');
    expect(ce.parse(latex).evaluate().json).toEqual(['Rational', -7, 3]);
  });

  test('a symbol followed by a fraction is not a mixed number', () => {
    const expr = ce.box(['InvisibleOperator', 'x', ['Divide', 1, 3]], {
      form: 'raw',
    });
    expect(expr.toLatex({ fractionStyle: () => 'quotient' })).toBe(
      'x\\frac{1}{3}'
    );
    expect(expr.toLatex({ fractionStyle: () => 'reciprocal' })).toBe('x3^{-1}');
    expect(expr.toLatex({ fractionStyle: () => 'inline-solidus' })).toBe(
      'x1/3'
    );
  });

  // In the factor style, `1.5/3` is written `\frac{1}{3}\times1.5`. After an
  // integer, the `\frac{1}{3}` must not be read as part of a mixed number.
  test('an integer followed by a factor-style fraction', () => {
    const expr = ce.box(['InvisibleOperator', 2, ['Divide', 1.5, 3]], {
      form: 'raw',
    });
    const latex = expr.toLatex({ fractionStyle: () => 'factor' });
    expect(latex).toBe('2\\times\\frac{1}{3}\\times1.5');
    expect(ce.parse(latex).N().re).toBeCloseTo(1, 12);
  });

  // In the factor style, `3/4` is written `\frac{1}{4}\times3` and `3/x` is
  // written `\frac{1}{x}\times3`. The text before the next fraction ends with
  // a digit, so a multiplication sign is written before that fraction, or
  // `3\frac{1}{2}` reads back as the mixed number `7/2`.
  test('a factor-style fraction that ends with a digit, then a fraction', () => {
    const style = { fractionStyle: () => 'factor' as const };
    let expr = ce.box(
      ['InvisibleOperator', 2, ['Divide', 3, 4], ['Divide', 1, 2]],
      { form: 'raw' }
    );
    let latex = expr.toLatex(style);
    expect(latex).toBe('2\\times\\frac{1}{4}\\times3\\times\\frac{1}{2}');
    expect(ce.parse(latex).N().re).toBeCloseTo(3 / 4, 12);

    expr = ce.box(['InvisibleOperator', ['Divide', 3, 'x'], ['Divide', 1, 2]], {
      form: 'raw',
    });
    latex = expr.toLatex(style);
    expect(latex).toBe('\\frac{1}{x}\\times3\\times\\frac{1}{2}');
    expect(ce.parse(latex).subs({ x: 2 }).N().re).toBeCloseTo(3 / 4, 12);
  });

  // A float numerator is not part of a mixed number: the fraction is written
  // with the float, and reads back as a product that keeps the float.
  test.each(['1.0', '1.0000000000000001'])(
    'an integer followed by a fraction with the float numerator %s',
    (num) => {
      const expr = ce.box(['InvisibleOperator', 2, ['Divide', { num }, 3]], {
        form: 'raw',
      });
      const latex = expr.toLatex({ fractionStyle: () => 'quotient' });
      expect(latex).not.toBe('2\\frac{1}{3}');
      const back = ce.parse(latex);
      expect(back.json).toEqual(['Multiply', 2, ['Divide', { num }, 3]]);
      expect(back.N().re).toBeCloseTo(2 / 3, 12);
      expect(back.N().isExact).toBe(false);
    }
  );
});

/**
 * In an `InvisibleOperator`, a part after the first that starts with a minus
 * sign is written in parentheses. Without them, `InvisibleOperator(2,
 * Divide(-3, 4))`, which is `-3/2`, was written `2-\frac{3}{4}` and read back
 * as `5/4`.
 */
describe('FRACTION STYLES: A NEGATIVE FRACTION AFTER AN INTEGER', () => {
  const STYLES = [
    'quotient',
    'block-quotient',
    'inline-quotient',
    'inline-solidus',
    'nice-solidus',
    'reciprocal',
    'factor',
  ] as const;

  test.each(STYLES)('2 times -3/4 (%s)', (style) => {
    for (const fraction of [
      ['Divide', -3, 4],
      ['Divide', 3, -4],
    ]) {
      const expr = ce.box(['InvisibleOperator', 2, fraction], { form: 'raw' });
      const latex = expr.toLatex({ fractionStyle: () => style });
      expect(latex.startsWith('2(-')).toBe(true);
      expect(ce.parse(latex).evaluate().json).toEqual(['Rational', -3, 2]);
    }
  });
});
