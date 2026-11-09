import { ComputeEngine } from '../../../src/compute-engine';

// CE-1172: visual space (`\,`, `\quad`, `\hspace{1em}`, …) at the start of an
// expression, before a prefix operator, is skipped. The primary parser read
// the spacing command as an operand, and the infix loop read the sign with
// that operand on its left: `x = \, -b` was
// `Equal(x, Subtract(HorizontalSpacing(3), b))`, whose canonical form is
// `x == -b + Error(…)`.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;
const canonical = (s: string) => ce.parse(s).json;

describe('CE-1172 visual space before a prefix operator', () => {
  test.each([
    ['\\,-b', '-b'],
    ['x=\\,-b', 'x=-b'],
    ['x = \\, -b', 'x = -b'],
    ['a+\\,-b', 'a+-b'],
    ['a-\\,-b', 'a--b'],
    ['\\,+b', '+b'],
    ['\\,-\\frac{1}{2}', '-\\frac{1}{2}'],
    ['\\,-\\sin x', '-\\sin x'],
    ['\\,-1', '-1'],
    // Each spacing command, and several in a row
    ['\\quad -b', '-b'],
    ['\\;-b', '-b'],
    ['\\!-b', '-b'],
    ['\\hspace{1em}-b', '-b'],
    ['\\,\\,-b', '-b'],
    // In a group, an exponent, an argument and an item of a list
    ['\\sqrt{\\,-b}', '\\sqrt{-b}'],
    ['\\frac{\\,-b}{2}', '\\frac{-b}{2}'],
    ['x^{\\,-b}', 'x^{-b}'],
    ['\\sin\\,-x', '\\sin -x'],
    ['f(a,\\,-b)', 'f(a,-b)'],
    ['\\int_0^1\\,-x\\,dx', '\\int_0^1 -x\\,dx'],
    // Another prefix operator
    ['\\,\\neg p', '\\neg p'],
    ['\\,\\pm b', '\\pm b'],
  ])('%s is %s', (spaced, plain) => {
    expect(raw(spaced)).toEqual(raw(plain));
    expect(canonical(spaced)).toEqual(canonical(plain));
  });

  test('a value', () => {
    ce.assign('b', 5);
    try {
      expect(ce.parse('\\,-b').evaluate().json).toEqual(-5);
      expect(ce.parse('2+\\,-b').evaluate().json).toEqual(-3);
    } finally {
      ce.forget('b');
    }
  });

  test('after an operand, the sign is an infix operator', () => {
    expect(raw('a\\, - b')).toEqual([
      'Subtract',
      ['InvisibleOperator', 'a', ['HorizontalSpacing', 3]],
      'b',
    ]);
    expect(canonical('a\\, - b')).toEqual(canonical('a - b'));
    // The operand of the first sign ends before the second one.
    expect(canonical('\\,-b\\,-c')).toEqual(canonical('-b-c'));
    // A prefix operator that is not also an infix operator does not join
    // the operand before it, with or without the space.
    expect(canonical('a\\,\\neg p')).toEqual(canonical('a\\neg p'));
  });

  test('visual space with no prefix operator after it stays an operand', () => {
    expect(raw('\\,b')).toEqual([
      'InvisibleOperator',
      ['HorizontalSpacing', 3],
      'b',
    ]);
    expect(raw('\\,')).toEqual(['HorizontalSpacing', 3]);
    expect(raw('\\,\\sin x')).toEqual([
      'InvisibleOperator',
      ['HorizontalSpacing', 3],
      ['Sin', 'x'],
    ]);
  });
});
