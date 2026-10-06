/**
 * GitHub issue #420.
 *
 * 1. The `Prime` and `Derivative` serializers attach the prime mark as a
 *    superscript (`^{\prime}`), so a compound operand must be fenced like
 *    the base of a `Power`: `x^2^{\prime}` is a double superscript that TeX
 *    rejects, and `x\mapsto x^2^{\prime}` reads as a prime on the body.
 *    Symbols and function names stay bare.
 * 2. The Unicode double-struck letters ℕ ℤ ℚ ℝ ℂ parse as the matching
 *    `\mathbb{…}` number set, not as a string.
 * 3. (Found on the way) `\mathbb{Z}^-` and `\mathbb{R}^-` name the same sets
 *    as the terse `\Z^-` and `\R^-`, and `ℕ^*` is `PositiveIntegers` as
 *    `\mathbb{N}^*` and `\N^*` are.
 */
import { ComputeEngine } from '../../../src/compute-engine';
import type { MathJsonExpression } from '../../../src/math-json/types';

const ce = new ComputeEngine();

const latex = (expr: MathJsonExpression) => ce.box(expr, { form: 'raw' }).latex;

describe('issue #420: prime on a compound operand', () => {
  test('a symbol or a function name stays bare', () => {
    expect(latex(['Prime', 'f'])).toBe('f^{\\prime}');
    expect(latex(['Prime', 'Sin'])).toBe('\\sin^{\\prime}');
    expect(latex(['Derivative', 'f'])).toBe('f^{\\prime}');
    expect(latex(['Derivative', 'f', 2])).toBe('f^{\\doubleprime}');
    expect(latex(['Derivative', 'f', 4])).toBe('f^{(4)}');
    expect(latex(['Prime', ['Subscript', 'f', 0]])).toBe('f_{0}^{\\prime}');
  });

  test('a power, a lambda, a sum or a product is fenced', () => {
    expect(latex(['Prime', ['Power', 'x', 2]])).toBe('(x^2)^{\\prime}');
    expect(latex(['Derivative', ['Function', ['Power', 'x', 2], 'x']])).toBe(
      '(x\\mapsto x^2)^{\\prime}'
    );
    expect(latex(['Derivative', ['Function', ['Power', 'x', 2], 'x'], 2])).toBe(
      '(x\\mapsto x^2)^{\\doubleprime}'
    );
    expect(latex(['Prime', ['Add', 'x', 2]])).toBe('(x+2)^{\\prime}');
    expect(latex(['Prime', ['Negate', 'x']])).toBe('(-x)^{\\prime}');
    expect(latex(['Prime', ['Multiply', 2, 'x']])).toBe('(2x)^{\\prime}');
    expect(latex(['Prime', ['Factorial', 'n']])).toBe('(n!)^{\\prime}');
  });

  test('a base that already ends with a superscript is fenced', () => {
    expect(latex(['Prime', ['Prime', 'f']])).toBe('(f^{\\prime})^{\\prime}');
    expect(latex(['Prime', ['Transpose', 'A']])).toBe('(A^T)^{\\prime}');
    // A symbol whose spelling ends with a superscript is fenced too.
    expect(latex(['Prime', 'PositiveIntegers'])).toBe(
      '(\\mathbb{N}^*)^{\\prime}'
    );
    expect(latex(['Prime', 'x__2'])).toBe('(x^2)^{\\prime}');
  });

  test('a single-group base stays bare', () => {
    expect(latex(['Prime', ['Sqrt', 'x']])).toBe('\\sqrt{x}^{\\prime}');
    expect(latex(['Prime', ['Abs', 'x']])).toBe('\\vert x\\vert^{\\prime}');
    expect(latex(['Prime', ['Delimiter', ['Add', 'x', 1]]])).toBe(
      '(x+1)^{\\prime}'
    );
  });

  test('the fenced form round-trips through the parser', () => {
    const d = ce.box(['Derivative', ['Function', ['Power', 'x', 2], 'x']]);
    expect(ce.parse(d.latex).isSame(d)).toBe(true);
  });
});

describe('issue #420: Unicode double-struck set letters', () => {
  test.each([
    ['ℕ', 'NonNegativeIntegers'],
    ['ℤ', 'Integers'],
    ['ℚ', 'RationalNumbers'],
    ['ℝ', 'RealNumbers'],
    ['ℂ', 'ComplexNumbers'],
  ])('%s parses as %s', (input, name) => {
    expect(ce.parse(input, { form: 'raw' }).json).toBe(name);
  });

  test('the letters compose like \\mathbb{…}', () => {
    expect(ce.parse('x \\in ℝ').json).toEqual(['Element', 'x', 'RealNumbers']);
    expect(ce.parse('ℤ[\\omega]').json).toEqual(
      ce.parse('\\mathbb{Z}[\\omega]').json
    );
    expect(ce.parse('ℤ/5ℤ').json).toEqual(
      ce.parse('\\mathbb{Z}/5\\mathbb{Z}').json
    );
    expect(ce.parse('ℝ^2').json).toEqual(ce.parse('\\mathbb{R}^2').json);
    expect(ce.parse('ℝ^+').json).toBe('PositiveNumbers');
    expect(ce.parse('ℤ^+').json).toBe('PositiveIntegers');
    expect(ce.parse('ℂ^+').json).toBe('UpperHalfPlane');
  });

  test('the sets serialize in the \\mathbb{…} spelling', () => {
    expect(ce.parse('x \\in ℝ').latex).toBe('x\\in\\mathbb{R}');
  });
});

describe('issue #420: signed-set superscripts on the \\mathbb spelling', () => {
  test.each([
    ['\\mathbb{Z}^-', 'NegativeIntegers'],
    ['\\mathbb{Z}^{-}', 'NegativeIntegers'],
    ['ℤ^-', 'NegativeIntegers'],
    ['\\mathbb{R}^-', 'NegativeNumbers'],
    ['ℝ^{-}', 'NegativeNumbers'],
    ['\\mathbb{N}^*', 'PositiveIntegers'],
    ['ℕ^*', 'PositiveIntegers'],
  ])('%s parses as %s', (input, name) => {
    expect(ce.parse(input).json).toBe(name);
  });

  test('the terse spellings agree', () => {
    expect(ce.parse('\\Z^-').json).toBe('NegativeIntegers');
    expect(ce.parse('\\R^-').json).toBe('NegativeNumbers');
    expect(ce.parse('\\N^*').json).toBe('PositiveIntegers');
  });

  test('sets without a signed counterpart keep the general modifier', () => {
    expect(ce.parse('\\mathbb{C}^-').json).toEqual([
      'Superminus',
      'ComplexNumbers',
    ]);
    expect(ce.parse('\\mathbb{Z}^*').json).toEqual(['Superstar', 'Integers']);
  });

  test('a non-set base is untouched', () => {
    expect(ce.parse('x^-').json).toEqual(['Superminus', 'x']);
    expect(ce.parse('A^*').json).toEqual(['Superstar', 'A']);
    // A symbol named like an inherited object property is not a set.
    expect(ce.parse('\\operatorname{constructor}^-').json).toEqual([
      'Superminus',
      'constructor',
    ]);
    expect(ce.parse('\\operatorname{constructor}^+').json).toEqual([
      'PseudoInverse',
      'constructor',
    ]);
  });

  test('in non-strict mode the Unicode letter is a command base', () => {
    // A one-letter base makes `^- x` a lenient negative exponent; a
    // `\mathbb{…}` command base keeps the postfix reading, and so does the
    // Unicode letter that spells it.
    const lenient = (s: string) => ce.parse(s, { strict: false }).json;
    expect(lenient('ℤ^- x')).toEqual(lenient('\\mathbb{Z}^- x'));
    expect(lenient('ℝ^- x')).toEqual(lenient('\\R^- x'));
    expect(lenient('ℝ^- x')).toEqual(['Tuple', 'NegativeNumbers', 'x']);
  });

  test('membership evaluates', () => {
    expect(ce.parse('-2 \\in ℤ^-').evaluate().json).toBe('True');
    expect(ce.parse('-2 \\in \\mathbb{Z}^-').evaluate().json).toBe('True');
  });
});
