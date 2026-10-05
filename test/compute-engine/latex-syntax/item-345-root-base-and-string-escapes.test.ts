import { ComputeEngine } from '../../../src/compute-engine';

/**
 * Two LaTeX serialization defects reported in GitHub issue 345.
 *
 * 1. Deep inside an expression (two lists down), a root is written in its
 *    exponent form, `2^{1/2}`. The half-integer power `2^{(1+x)/2}` was
 *    written as "the root, then an exponent", which gave `2^{1/2}^{1+x}`: a
 *    double superscript, which TeX rejects.
 *
 * 2. A control character or a private-use character in a string was written
 *    as it is inside `\text{…}`. TeX rejects most control characters and
 *    reads a tab or a line break as a space, so the string did not survive.
 */

const ce = new ComputeEngine();

const raw = (json: unknown) => ce.box(json as any, { form: 'raw' });

describe('ISSUE 345: A ROOT BASE DEEP INSIDE AN EXPRESSION', () => {
  const halfPower = [
    'Power',
    2,
    ['Multiply', ['Rational', 1, 2], ['Add', 1, 'x']],
  ];
  const nested = [
    'List',
    ['List', ['Multiply', ['Rational', 1, 2], halfPower]],
  ];

  test('no double superscript in a nested list', () => {
    const latex = raw(nested).latex;
    expect(latex).not.toMatch(/\^\{[^{}]*\}\^/);
    expect(latex).toBe(
      '\\bigl\\lbrack\\bigl\\lbrack\\frac{1}{2}(2^{(1+x)/2})\\bigr\\rbrack\\bigr\\rbrack'
    );
  });

  test('the nested form reads back as the same value', () => {
    const back = ce.parse(raw(nested).latex);
    expect(back.isSame(ce.box(nested as any))).toBe(true);
  });

  test('at the top level the radical form is kept', () => {
    expect(raw(halfPower).latex).toBe('\\sqrt{2}^{1+x}');
    expect(raw(['Power', 'x', ['Rational', 3, 2]]).latex).toBe('\\sqrt{x}^{3}');
  });

  test('a rational exponent three lists down', () => {
    const latex = raw([
      'List',
      ['List', ['List', ['Power', 'x', ['Rational', 3, 2]]]],
    ]).latex;
    expect(latex).not.toMatch(/\^\{[^{}]*\}\^/);
  });
});

describe('ISSUE 345: CONTROL AND PRIVATE-USE CHARACTERS IN A STRING', () => {
  test.each([
    ['a control character', 'a\u0001b', '\\text{a\\char"0001{}b}'],
    // The empty group ends the code point: `B` is a hexadecimal digit.
    ['before a hexadecimal digit', 'a\u0001B', '\\text{a\\char"0001{}B}'],
    ['a tab', 'a\tb', '\\text{a\\char"0009{}b}'],
    ['a line break', 'a\nb', '\\text{a\\char"000A{}b}'],
    ['delete', '\u007f', '\\text{\\char"007F{}}'],
    ['a private-use character', 'a\uE000b', '\\text{a\\char"E000{}b}'],
    ['plane 15', 'x\u{F0000}y', '\\text{x\\char"F0000{}y}'],
  ])('%s is written as its code point and reads back', (_, s, latex) => {
    const expr = ce.string(s);
    expect(expr.latex).toBe(latex);
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });

  test('a character value is written like the one-character string', () => {
    expect(ce.character('\t').latex).toBe('\\text{\\char"0009{}}');
    expect(ce.character('\u0001').latex).toBe('\\text{\\char"0001{}}');
    expect(ce.character('#').latex).toBe('\\text{\\#}');
    expect(ce.character('\\').latex).toBe('\\text{\\textbackslash{}}');
    for (const c of ['\t', '\u0001', '#', '\\', '{', 'x'])
      expect(ce.parse(ce.character(c).latex).isSame(ce.character(c))).toBe(
        true
      );
  });

  test('other characters are not changed', () => {
    expect(ce.string('é ∑ 😀').latex).toBe('\\text{é ∑ 😀}');
    expect(ce.string('50%').latex).toBe('\\text{50\\%}');
  });
});
