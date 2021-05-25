import {
  MULTIPLY,
  PI,
  ADD,
  SUBTRACT,
  NEGATE,
  POWER,
  DIVIDE,
  LATEX_TOKENS,
} from '../src/common/utils';
import { expression, latex } from './utils';

describe('LATEX SERIALIZING', () => {
  test('Numbers', () => {
    expect(latex(1)).toMatchInlineSnapshot(`'1'`);
    expect(latex(+1)).toMatchInlineSnapshot(`'1'`);
    expect(latex(-123)).toMatchInlineSnapshot(`'-123'`);
    expect(latex(-1234567.89)).toMatchInlineSnapshot(`'-1,234,567.89'`);
    expect(latex(-1234567.89e-123)).toMatchInlineSnapshot(
      `'-1.234,567,89\\cdot10^{-117}'`
    );
    expect(latex({ num: '-1234567.890e-123' })).toMatchInlineSnapshot(
      `'-1,234,567.890\\cdot10^{-123}'`
    );
    expect(
      latex({ num: '-123456789012345678901234567890.890e-123' })
    ).toMatchInlineSnapshot(
      `'-123,456,789,012,345,678,901,234,567,890\\cdot10^{-123}'`
    );
    expect(latex({ num: 'Infinity' })).toMatchInlineSnapshot(`'\\infty'`);
    expect(latex({ num: '-Infinity' })).toMatchInlineSnapshot(`'-\\infty'`);
    expect(latex({ num: 'NaN' })).toMatchInlineSnapshot(
      `'\\operatorname{NaN}'`
    );
    expect(latex({ num: 'Infinity' })).toMatchInlineSnapshot(`'\\infty'`);

    // Repeating patern
    expect(
      latex({ num: '3.123456785678567856785678567856785678' })
    ).toMatchInlineSnapshot(`'3.123,456,785,678,5\\ldots'`);

    expect(
      latex({ num: '0.1234567872368237462387623876' })
    ).toMatchInlineSnapshot(`'0.123,456,787,236,8\\ldots'`);

    expect(expression('  - 1 2')).toMatchInlineSnapshot(`['Multiply', -1, 2]`);
    expect(expression('-123,456.789,012')).toMatchInlineSnapshot(
      `-123456.789012`
    );
    expect(expression('-1,23456.7890,12')).toMatchInlineSnapshot(
      `-123456.789012`
    );
  });
  // Leave space between pi and x
  test('Spacing', () => {
    expect(latex([MULTIPLY, PI, 'x'])).toMatchInlineSnapshot(`'\\pi x'`);
  });

  test('Symbols', () => {
    expect(latex('x')).toMatchInlineSnapshot(`'x'`);
    expect(latex('symbol')).toMatchInlineSnapshot(`'\\operatorname{symbol}'`);
    expect(latex({ sym: 'x' })).toMatchInlineSnapshot(`'x'`);
    expect(latex({ sym: 'symbol' })).toMatchInlineSnapshot(
      `'\\operatorname{symbol}'`
    );
  });

  test('Functions', () => {
    expect(latex(['f', 'x', 1, 0])).toMatchInlineSnapshot(`'f(x, 1, 0)'`);
    expect(latex(['\\foo', 'x', 1, 0])).toMatchInlineSnapshot(
      `'\\foo{x}{1}{0}'`
    );
    expect(latex(['\\frac', 'n', 4])).toMatchInlineSnapshot(`'\\frac{n}{4}'`);

    expect(expression('\\foo[0]{1}{2}')).toMatchInlineSnapshot(
      `['\\foo', 1, 2, 0]`
    );

    // Head as expression
    expect(latex([['g', 'f'], 'x', 1, 0])).toMatchInlineSnapshot(
      `'g(f)(x, 1, 0)'`
    );
  });

  test('Basic operations', () => {
    expect(latex([ADD, 'a', 'b'])).toMatchInlineSnapshot(`'a+b'`);
    // Invisible operator
    expect(latex([MULTIPLY, 'a', 'b'])).toMatchInlineSnapshot(`'ab'`);
    expect(
      latex([MULTIPLY, [ADD, 'x', 1], [SUBTRACT, 'x', 1]])
    ).toMatchInlineSnapshot(`'(x+1)(x-1)'`);
    expect(
      latex([ADD, [MULTIPLY, 'x', -1], [MULTIPLY, 'x', 2]])
    ).toMatchInlineSnapshot(`'-x\\times1+x\\times2'`);
    expect(latex([SUBTRACT, [NEGATE, 'x'], -1])).toMatchInlineSnapshot(
      `'-x--1'`
    );
  });
  test('Power', () => {
    expect(latex([POWER, 'x', -2])).toMatchInlineSnapshot(`'\\frac{1}{x^{2}}'`);
    expect(latex([POWER, 'x', [DIVIDE, 1, 2]])).toMatchInlineSnapshot(
      `'\\sqrt{x}'`
    );
    expect(latex([POWER, [ADD, 'x', 1], [DIVIDE, 1, 2]])).toMatchInlineSnapshot(
      `'\\sqrt{x+1}'`
    );
    expect(
      latex([POWER, [MULTIPLY, 2, 'x'], [DIVIDE, 1, 2]])
    ).toMatchInlineSnapshot(`'\\sqrt{2x}'`);
    expect(
      latex([POWER, [MULTIPLY, 2, 'x'], [SUBTRACT, 1, 'n']])
    ).toMatchInlineSnapshot(`'(2x)^{1-n}'`);
  });
  test('Missing', () => {
    expect(
      latex(['Equal', ['Multiply', 2, 2], 'Missing'])
    ).toMatchInlineSnapshot(`'2\\times2=\\placeholder'`);
  });
});

describe('LATEX', () => {
  test('Latex Valid forms', () => {
    expect(latex([LATEX_TOKENS, 3, 4])).toMatchInlineSnapshot(`'34'`);
    expect(latex([LATEX_TOKENS, 'x', 3])).toMatchInlineSnapshot(`'x3'`);
    expect(
      latex([LATEX_TOKENS, "'\\frac'", "'<{>'", 42.12, "'<}>'"])
    ).toMatchInlineSnapshot(`'\\frac{42.12}'`);
    expect(latex([LATEX_TOKENS, ['Divide', 'Pi', 2]])).toMatchInlineSnapshot(
      `'\\frac{\\pi}{2}'`
    );
  });
});
