/**
 * Two defects of a limit at a symbolic point (2026-10-18).
 *
 * 1. A direction marker on the last term of the limit point applies to the
 *    whole point: `\lim_{x\to a+1^+}` is `\lim_{x\to (a+1)^+}`. Before, the
 *    parser read `1^+` as `PseudoInverse(1)`, and the limit was two-sided at
 *    the point `a + PseudoInverse(1)`.
 *
 * 2. A limit at a symbolic point is the GENERIC answer (`lim_{x→a} 1/x` is
 *    `1/a`), except where that answer has a jump at a value the parameter
 *    can take (user decision of 2026-10-18, "generic, except jumps").
 *    `lim_{x→a} |x|/x` was `|a|/a`, which is `1` or `−1` and is not the
 *    limit at `a = 0`. The limit now stays unevaluated, unless the sign of
 *    `a` or an assumption `a ≠ 0` is known.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('a', 'real');
ce.declare('b', 'real');
ce.declare('c', 'real');
ce.declare('d', 'real');
ce.assume(ce.parse('b \\ne 0'));
ce.assume(ce.parse('c > 0'));
ce.assume(ce.parse('d < 0'));

const limit = (latex: string) => ce.parse(latex).evaluate();
const isInert = (latex: string) => expect(limit(latex).operator).toBe('Limit');

describe('A DIRECTION MARKER ON THE LAST TERM OF THE LIMIT POINT', () => {
  test('x \\to a+1^+ is x \\to (a+1)^+', () => {
    expect(ce.parse('\\lim_{x\\to a+1^+} x', { form: 'raw' }).json).toEqual([
      'Limit',
      ['Function', 'x', 'x'],
      ['Add', 'a', 1],
      1,
    ]);
  });

  test('x \\to a-1^- is from below', () => {
    expect(ce.parse('\\lim_{x\\to a-1^-} x', { form: 'raw' }).json).toEqual([
      'Limit',
      ['Function', 'x', 'x'],
      ['Subtract', 'a', 1],
      -1,
    ]);
  });

  test('x \\to -1^+ is -1 from above', () => {
    expect(ce.parse('\\lim_{x\\to -1^+} x', { form: 'raw' }).json).toEqual([
      'Limit',
      ['Function', 'x', 'x'],
      ['Negate', 1],
      1,
    ]);
    expect(limit('\\lim_{x\\to -1^+} \\frac{|x+1|}{x+1}').json).toBe(1);
  });

  test('x \\to 2\\pi^- is 2\\pi from below', () => {
    expect(ce.parse('\\lim_{x\\to 2\\pi^-} x', { form: 'raw' }).json).toEqual([
      'Limit',
      ['Function', 'x', 'x'],
      ['InvisibleOperator', 2, 'Pi'],
      -1,
    ]);
  });

  test('the one-sided limits at 1+1', () => {
    expect(limit('\\lim_{x\\to 1+1^+} \\frac{|x-2|}{x-2}').json).toBe(1);
    expect(limit('\\lim_{x\\to 1+1^-} \\frac{|x-2|}{x-2}').json).toBe(-1);
  });

  test('the forms that worked before are unchanged', () => {
    expect(ce.parse('\\lim_{x\\to 0^+} x', { form: 'raw' }).json).toEqual([
      'Limit',
      ['Function', 'x', 'x'],
      0,
      1,
    ]);
    expect(ce.parse('\\lim_{x\\to (a+1)^+} x', { form: 'raw' }).json).toEqual([
      'Limit',
      ['Function', 'x', 'x'],
      ['Delimiter', ['Add', 'a', 1]],
      1,
    ]);
  });

  test('a marker on a term that is not the last one is not a direction', () => {
    expect(ce.parse('\\lim_{x\\to a^+ + 1} x', { form: 'raw' }).json).toEqual([
      'Limit',
      ['Function', 'x', 'x'],
      ['Add', ['PseudoInverse', 'a'], 1],
    ]);
  });

  test('outside a limit point, 1^+ keeps its meaning', () => {
    expect(ce.parse('a+1^+', { form: 'raw' }).json).toEqual([
      'Add',
      'a',
      ['PseudoInverse', 1],
    ]);
  });

  test('the serialized one-sided limit parses back', () => {
    const e = ce.box(['Limit', ['Function', 'x', 'x'], ['Add', 'a', 1], 1]);
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });
});

describe('A LIMIT AT A SYMBOLIC POINT WITH A JUMP', () => {
  test('lim_{x→a} |x|/x stays unevaluated', () => {
    isInert('\\lim_{x\\to a} \\frac{|x|}{x}');
    isInert('\\lim_{x\\to a+1} \\frac{|x|}{x}');
    isInert('\\lim_{x\\to a} \\frac{|x-1|}{x-1}');
    isInert('\\lim_{x\\to 0} \\frac{|x+a|}{x+a}');
  });

  test('the other spellings of the sign', () => {
    isInert('\\lim_{x\\to a} \\frac{x}{|x|}');
    isInert('\\lim_{x\\to a} \\frac{|x|}{-x}');
    isInert('\\lim_{x\\to a} 2\\frac{|x|}{x}');
    isInert('\\lim_{x\\to a} \\frac{|x|^3}{x^3}');
    isInert('\\lim_{x\\to a} \\frac{\\sqrt{x^2}}{x}');
    isInert('\\lim_{x\\to a} \\operatorname{sgn}(x)');
    isInert('\\lim_{x\\to a} \\lfloor x \\rfloor');
  });

  test('with a ≠ 0 known, it is |a|/a', () => {
    expect(limit('\\lim_{x\\to b} \\frac{|x|}{x}').toString()).toBe('|b| / b');
    expect(limit('\\lim_{x\\to c} \\frac{|x|}{x}').json).toBe(1);
    expect(limit('\\lim_{x\\to d} \\frac{|x|}{x}').json).toBe(-1);
  });

  test('a jump that is in the body already is the limit', () => {
    expect(limit('\\lim_{x\\to 0} x + \\frac{|a|}{a}').toString()).toBe(
      '|a| / a'
    );
  });
});

describe('A LIMIT AT A SYMBOLIC POINT IS THE GENERIC ANSWER', () => {
  test('a pole or a removable singularity at a value of the parameter', () => {
    expect(limit('\\lim_{x\\to a} \\frac{1}{x}').toString()).toBe('1 / a');
    expect(limit('\\lim_{x\\to a} \\frac{\\sin x}{x}').toString()).toBe(
      'sin(a) / a'
    );
    expect(limit('\\lim_{x\\to 0} \\frac{1}{x+a}').toString()).toBe('1 / a');
    expect(limit('\\lim_{x\\to a} \\frac{x}{x^2+a^2}').toString()).toBe(
      '1 / (2a)'
    );
    expect(limit('\\lim_{x\\to a} \\tan x').toString()).toBe('tan(a)');
  });

  test('no singularity', () => {
    expect(limit('\\lim_{x\\to a} \\frac{1}{x^2+1}').toString()).toBe(
      '1 / (a^2 + 1)'
    );
    expect(limit('\\lim_{x\\to a} |x|').toString()).toBe('|a|');
    expect(limit('\\lim_{x\\to a} x^2+1').toString()).toBe('a^2 + 1');
    expect(limit('\\lim_{x\\to a} \\frac{x^2-a^2}{x-a}').toString()).toBe('2a');
    expect(limit('\\lim_{x\\to 0} \\frac{\\sin(a x)}{x}').toString()).toBe('a');
  });

  test('a numeric point is unchanged', () => {
    expect(limit('\\lim_{x\\to 0} \\frac{\\sin x}{x}').json).toBe(1);
    expect(limit('\\lim_{x\\to 0^+} \\frac{|x|}{x}').json).toBe(1);
    expect(limit('\\lim_{x\\to a^+} \\frac{1}{x-a}').json).toBe(
      'PositiveInfinity'
    );
    expect(limit('\\lim_{x\\to \\pi} \\frac{1}{x}').toString()).toBe('1 / pi');
  });
});
