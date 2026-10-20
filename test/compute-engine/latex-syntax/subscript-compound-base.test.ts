import { ComputeEngine } from '../../../src/compute-engine';
import type { MathJsonExpression } from '../../../src/math-json/types';

/**
 * The base of a `Subscript` is written in parentheses when it is compound, as
 * the base of a power is. A subscript binds to the last token before it, so
 * without the parentheses `Subscript(x+1, 2)` was written `x+1_{2}`, which
 * reads back as `x + BaseForm(1, 2)`.
 */

const ce = new ComputeEngine();

describe('SUBSCRIPT OF A COMPOUND BASE', () => {
  test.each<[MathJsonExpression, string]>([
    [['Subscript', ['Add', 'x', 1], 2], '(x+1)_{2}'],
    [['Subscript', ['Subtract', 'a', 'b'], 'k'], '(a-b)_{k}'],
    [['Subscript', ['Multiply', 2, 'x'], 1], '(2x)_{1}'],
    [['Subscript', ['Negate', 'x'], 1], '(-x)_{1}'],
    [['Subscript', -2, 'k'], '(-2)_{k}'],
    [['Subscript', ['Power', 'x', 2], 1], '(x^2)_{1}'],
    [['Subscript', ['Divide', 'x', 'y'], 1], '(\\frac{x}{y})_{1}'],
    [['Subscript', ['Rational', 1, 2], 3], '(\\frac{1}{2})_{3}'],
    [['Subscript', ['Factorial', 'n'], 1], '(n!)_{1}'],
  ])('%j is written %s and reads back', (input, latex) => {
    const expr = ce.box(input);
    expect(expr.toLatex()).toBe(latex);
    expect(ce.parse(latex).json).toEqual(expr.json);
  });

  // A base that is a symbol, a number, or ends with a closing delimiter is
  // not fenced
  test.each<[MathJsonExpression, string]>([
    [['Subscript', 'A', ['Add', 'n', 1]], 'A_{n+1}'],
    [['Subscript', 1.5, 'k'], '1.5_{k}'],
    [['Subscript', ['Sin', 'x'], 1], '\\sin(x)_{1}'],
    [['Subscript', ['Sqrt', 'x'], 1], '\\sqrt{x}_{1}'],
    [['Subscript', ['Abs', 'x'], 1], '\\vert x\\vert_{1}'],
    [['Subscript', ['Set', 1, 2], 1], '\\lbrace1, 2\\rbrace_{1}'],
    // The conjugate of a number is braced, so that it does not read as a
    // residue class
    [['Subscript', ['Conjugate', 3], 5], '{\\overline{3}}_{5}'],
  ])('%j is written %s and reads back', (input, latex) => {
    const expr = ce.box(input);
    expect(expr.toLatex()).toBe(latex);
    expect(ce.parse(latex).json).toEqual(expr.json);
  });

  // The fence of a negative number uses the configured group style, as the
  // fence of a compound base does
  test.each<[MathJsonExpression, string]>([
    [['Subscript', -2, 'k'], '\\Bigl(-2\\Bigr)_{k}'],
    [['Subscript', ['Add', 'x', 1], 2], '\\Bigl(x+1\\Bigr)_{2}'],
  ])('with the big group style, %j is written %s', (input, latex) => {
    const expr = ce.box(input);
    expect(expr.toLatex({ groupStyle: () => 'big' })).toBe(latex);
    expect(ce.parse(latex).json).toEqual(expr.json);
  });

  test('a solidus fraction as a base is fenced', () => {
    const expr = ce.box(['Subscript', ['Divide', 'x', 'y'], 1]);
    const latex = expr.toLatex({ fractionStyle: () => 'inline-solidus' });
    expect(latex).toBe('(x/y)_{1}');
    expect(ce.parse(latex).json).toEqual(expr.json);
  });
});

/**
 * A function application written as a name followed by a parenthesized
 * argument list is fenced when the parser reads the name as a symbol: on a
 * new engine where `g` is not declared, `g(x+1)_{k}` reads back as the
 * product of `g` and `Subscript((x+1), k)`. A base that ends with a
 * superscript is fenced too: `\exponentialE^{x}_{1}` reads back as
 * `Power(Subscript(e, 1), x)`. A function whose LaTeX command parses its own
 * arguments (`\sin`, `\max`) is not fenced.
 */
describe('SUBSCRIPT OF A FUNCTION APPLICATION', () => {
  test.each<[MathJsonExpression, string]>([
    [['Subscript', ['g', ['Add', 'x', 1]], 'k'], '(g(x+1))_{k}'],
    [['Subscript', ['Overline', 'x'], 1], '(\\mathrm{Overline}(x))_{1}'],
    [['Subscript', ['Gamma', 'x'], 1], '(\\Gamma(x))_{1}'],
    [['Subscript', ['Exp', 'x'], 1], '(\\exponentialE^{x})_{1}'],
    [['Subscript', ['Sin', 'x'], 1], '\\sin(x)_{1}'],
    [['Subscript', ['Max', 'x', 'y'], 1], '\\max(x, y)_{1}'],
  ])('%j is written %s and reads back on a new engine', (input, latex) => {
    const expr = new ComputeEngine().box(input);
    expect(expr.toLatex()).toBe(latex);
    expect(new ComputeEngine().parse(latex).json).toEqual(expr.json);
  });
});
