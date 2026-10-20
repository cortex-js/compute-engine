import { ComputeEngine } from '../../../src/compute-engine';
import type { FractionStyle } from '../../../src/compute-engine/latex-syntax/types';

/**
 * The `nice-solidus` fraction style writes `a/b` as `{}^{a}\!\!/\!{}_{b}`: a
 * raised numerator, a slash and a lowered denominator. The parser reads this
 * exact shape back as `Divide(a, b)`, so a LaTeX round trip gives the same
 * expression, as it does with the other fraction styles.
 *
 * Before, the parser read the empty group `{}` as white space and then found a
 * `^` with no base: `x/10` read back as `Superscript(Error('missing'), x)`.
 */

const ce = new ComputeEngine();

function serialize(latex: string, style: FractionStyle): string {
  return ce.parse(latex).toLatex({ fractionStyle: () => style });
}

/** Parse `latex`, write it with `style`, and parse the result again */
function roundTrip(latex: string, style: FractionStyle) {
  const expr = ce.parse(latex);
  const written = expr.toLatex({ fractionStyle: () => style });
  return { expr, written, back: ce.parse(written) };
}

describe('NICE-SOLIDUS SERIALIZATION', () => {
  test.each([
    ['x/10', '{}^{x}\\!\\!/\\!{}_{10}'],
    ['\\frac{3}{4}', '{}^{3}\\!\\!/\\!{}_{4}'],
    // A sum in the numerator or the denominator is in parentheses
    ['\\frac{x+1}{2}', '{}^{(x+1)}\\!\\!/\\!{}_{2}'],
    ['\\frac{a+b}{c+d}', '{}^{(a+b)}\\!\\!/\\!{}_{(c+d)}'],
    // The sign of a numeric fraction goes in front of it
    ['-\\frac{x}{3}', '-{}^{x}\\!\\!/\\!{}_{3}'],
    ['-\\frac{3}{4}', '-{}^{3}\\!\\!/\\!{}_{4}'],
    // With a symbolic denominator, the sign stays in the numerator
    ['\\frac{-1}{x}', '{}^{-1}\\!\\!/\\!{}_{x}'],
    // A fraction in an exponent, in a power, in a function argument
    ['2^{\\frac{x}{3}}', '2^{{}^{x}\\!\\!/\\!{}_{3}}'],
    ['\\frac{x}{y}^2', '({}^{x}\\!\\!/\\!{}_{y})^2'],
    ['\\sin\\frac{x}{2}', '\\sin({}^{x}\\!\\!/\\!{}_{2})'],
    ['\\sqrt{\\frac{x}{y}}', '\\sqrt{{}^{x}\\!\\!/\\!{}_{y}}'],
  ])('%s is written %s', (input, expected) => {
    expect(serialize(input, 'nice-solidus')).toBe(expected);
  });
});

describe('NICE-SOLIDUS PARSING', () => {
  test('the exact shape is a division', () => {
    expect(ce.parse('{}^{x}\\!\\!/\\!{}_{10}', { form: 'raw' }).json).toEqual([
      'Divide',
      'x',
      10,
    ]);
    expect(ce.parse('{}^{x}\\!\\!/\\!{}_{10}').json).toEqual([
      'Multiply',
      ['Rational', 1, 10],
      'x',
    ]);
  });

  test('the negative thin spaces are optional', () => {
    expect(ce.parse('{}^{x}/{}_{10}', { form: 'raw' }).json).toEqual([
      'Divide',
      'x',
      10,
    ]);
  });

  test('a fraction after a factor is a product', () => {
    expect(ce.parse('x{}^{a}\\!\\!/\\!{}_{b}', { form: 'raw' }).json).toEqual([
      'InvisibleOperator',
      'x',
      ['Divide', 'a', 'b'],
    ]);
  });

  test('an empty numerator is missing', () => {
    expect(ce.parse('{}^{}\\!\\!/\\!{}_{b}', { form: 'raw' }).json).toEqual([
      'Divide',
      ['Error', "'missing'"],
      'b',
    ]);
  });

  // Out of the exact shape, `{}^{a}` and `{}_{b}` keep their usual reading
  test.each([
    [
      '{}^{x}',
      ['Superscript', ['Error', "'missing'", ['LatexString', "'^'"]], 'x'],
    ],
    ['{}_{x}', ['InvisibleOperator', '_', 'x']],
    ['a{}^{x}', ['Power', 'a', 'x']],
    ['\\alpha{}_{01}', ['Subscript', 'alpha', 1]],
    [
      '{}^{x}\\!\\!/\\!y',
      ['Superscript', ['Error', "'missing'", ['LatexString', "'^'"]], 'x'],
    ],
    [
      '{}^{x}\\!\\!/\\!{}^{10}',
      ['Superscript', ['Error', "'missing'", ['LatexString', "'^'"]], 'x'],
    ],
    // Only `\!` may surround the slash
    [
      '{}^{x}\\,/\\,{}_{10}',
      ['Superscript', ['Error', "'missing'", ['LatexString', "'^'"]], 'x'],
    ],
  ])('%s keeps its reading', (input, expected) => {
    expect(ce.parse(input, { form: 'raw' }).json).toEqual(expected);
  });

  // The braces match the shape, but the parse of the numerator stops on the
  // `&` or the `)` and recovers at the `}` of the nested group `{b}`. The
  // input keeps the reading it had before the parser knew the shape, and the
  // negative thin spaces do not show in the result.
  test.each([
    [
      '{}^{a & {b}}\\!\\!/\\!{}_{c}',
      [
        'Superscript',
        ['Error', "'missing'", ['LatexString', "'^'"]],
        [
          'InvisibleOperator',
          'a',
          [
            'Error',
            "'expected-closing-delimiter'",
            ['LatexString', "'{a & {b}'"],
          ],
        ],
      ],
    ],
    [
      '{}^{a ) {b}}\\!\\!/\\!{}_{c}',
      [
        'Superscript',
        ['Error', "'missing'", ['LatexString', "'^'"]],
        [
          'InvisibleOperator',
          'a',
          [
            'Error',
            "'expected-closing-delimiter'",
            ['LatexString', "'{a ) {b}'"],
          ],
        ],
      ],
    ],
  ])('%s keeps its reading when a group does not parse', (input, expected) => {
    const json = ce.parse(input, { form: 'raw' }).json;
    expect(JSON.stringify(json)).not.toContain('HorizontalSpacing');
    expect(json).toEqual(expected);
  });
});

/** Inputs whose LaTeX round trip gives the same canonical expression */
const ROUND_TRIP_INPUTS = [
  'x/10',
  '\\frac{3}{4}',
  '-\\frac{3}{4}',
  '\\frac{x+1}{2}',
  '\\frac{a+b}{c+d}',
  '-\\frac{x}{3}',
  '\\frac{1}{x}',
  '\\frac{-1}{x}',
  '\\frac{1}{2}x',
  '\\frac{a}{b}+1',
  '\\frac{x}{y}-\\frac{z}{w}',
  '\\frac{\\frac{a}{b}}{c}',
  '\\frac{x^2}{y_1}',
  '\\frac{\\sin x}{\\cos y}',
  '2^{\\frac{x}{3}}',
  '\\frac{x}{y}^2',
  '\\frac{x}{y}!',
  '\\sin\\frac{x}{2}',
  '\\sqrt{\\frac{x}{y}}',
  '[\\frac{x}{y}, 2]',
];

describe('NICE-SOLIDUS ROUND TRIP', () => {
  test.each(ROUND_TRIP_INPUTS)('%s', (input) => {
    const { expr, written, back } = roundTrip(input, 'nice-solidus');
    expect(written).toContain('\\!\\!/\\!');
    expect(back.json).toEqual(expr.json);
  });
});

describe('OTHER FRACTION STYLES ROUND TRIP', () => {
  const styles: FractionStyle[] = [
    'quotient',
    'block-quotient',
    'inline-quotient',
    'inline-solidus',
  ];
  for (const style of styles) {
    test.each(ROUND_TRIP_INPUTS)(`${style}: %s`, (input) => {
      const { expr, back } = roundTrip(input, style);
      expect(back.json).toEqual(expr.json);
    });
  }
});
