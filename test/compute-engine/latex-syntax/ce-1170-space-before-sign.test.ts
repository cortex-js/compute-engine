import { ComputeEngine } from '../../../src/compute-engine';

// CE-1170: visual space (`\,`, `\quad`, `\hspace{1em}`, …) between an operand
// and a `+` or a `-` does not change the sign into a factor. The number
// reader skips visual space before the sign of a number, so after an operand
// it read `\, - 1` as the number -1, and `a\, - 1` was the product `a·(-1)`.

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;
const structural = (s: string) => ce.parse(s, { form: 'structural' }).json;
const canonical = (s: string) => ce.parse(s).json;

describe('CE-1170 visual space before a plus or a minus sign', () => {
  test('the sign is an infix operator, and the raw form keeps the space', () => {
    expect(raw('a\\, + 1')).toEqual([
      'Add',
      ['InvisibleOperator', 'a', ['HorizontalSpacing', 3]],
      1,
    ]);
    expect(raw('a\\, - 1')).toEqual([
      'Subtract',
      ['InvisibleOperator', 'a', ['HorizontalSpacing', 3]],
      1,
    ]);
    // The form is the one of a sign with no number after it.
    expect(raw('a\\, - b')).toEqual([
      'Subtract',
      ['InvisibleOperator', 'a', ['HorizontalSpacing', 3]],
      'b',
    ]);
    expect(structural('a\\, - 1')).toEqual(['Subtract', 'a', 1]);
  });

  test.each([
    ['a\\, + 1', 'a + 1'],
    ['a\\, - 1', 'a - 1'],
    ['a\\,+\\,1', 'a + 1'],
    ['a\\,-1', 'a - 1'],
    ['a\\,\\,-1', 'a - 1'],
    ['a \\quad + 1', 'a + 1'],
    ['a \\qquad - 1', 'a - 1'],
    ['a\\!-1', 'a - 1'],
    ['a\\hspace{1em}+1', 'a + 1'],
    ['a\\kern3mu-1', 'a - 1'],
    // A number with a fractional part, and a number before a symbol
    ['a\\,+.5', 'a + 0.5'],
    ['a\\,-2b', 'a - 2b'],
    // Two signs: the first is the operator, the second the sign of the number
    ['a\\,--1', 'a + 1'],
    ['a\\,+-1', 'a - 1'],
    // Each kind of left operand
    ['x^2\\, + 1', 'x^2 + 1'],
    ['(a)\\, - 1', '(a) - 1'],
    ['f(x)\\,-1', 'f(x) - 1'],
    ['a!\\, - 1', 'a! - 1'],
    ['\\frac{a}{b}\\, - 1', '\\frac{a}{b} - 1'],
    ['\\sqrt{x}\\,+2', '\\sqrt{x} + 2'],
    ['a\\,b\\, - 1', 'ab - 1'],
    ['a\\cdot b\\, - 1', 'a\\cdot b - 1'],
    // The implicit argument of a function ends before the sign
    ['\\sin x\\, - 1', '\\sin x - 1'],
    ['\\sum_{i=1}^n i\\, - 1', '\\sum_{i=1}^n i - 1'],
    // After the differential of an integral
    ['\\int x\\,dx\\, + 1', '\\int x\\,dx + 1'],
    ['\\int_0^1 x\\,dx\\, - 1', '\\int_0^1 x\\,dx - 1'],
    // Several terms, and inside a group
    ['a\\,-1\\,+2\\,-3', 'a - 1 + 2 - 3'],
    ['(a\\, - 1)(b\\, + 2)', '(a - 1)(b + 2)'],
    ['x\\,-1=0', 'x - 1 = 0'],
  ])('%s is %s', (spaced, plain) => {
    expect(canonical(spaced)).toEqual(canonical(plain));
  });

  test('a value', () => {
    ce.assign('a', 5);
    try {
      expect(ce.parse('a\\, - 1').evaluate().json).toEqual(4);
      expect(ce.parse('a\\, + 1').evaluate().json).toEqual(6);
    } finally {
      ce.forget('a');
    }
  });

  test.each([
    ['\\,-1', '-1'],
    ['x=\\,-1', 'x=-1'],
    ['a+\\,-1', 'a+-1'],
    ['a\\cdot\\,-1', 'a\\cdot -1'],
  ])('with no left operand, the sign of %s is a prefix sign', (spaced, plain) => {
    expect(raw(spaced)).toEqual(raw(plain));
    expect(canonical(spaced)).toEqual(canonical(plain));
  });

  test('visual space before a number with no sign is still skipped', () => {
    expect(raw('a\\,5')).toEqual(['InvisibleOperator', 'a', 5]);
    expect(raw('2\\,x')).toEqual(['InvisibleOperator', 2, 'x']);
    expect(raw('1\\,000')).toEqual(1000);
    expect(raw('2\\, - 1')).toEqual(['Subtract', 2, 1]);
  });
});
