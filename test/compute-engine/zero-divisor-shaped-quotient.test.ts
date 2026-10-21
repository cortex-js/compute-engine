import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// A quotient by a divisor that may be zero is `real | infinity | nan` for a
// real numerator: `1/0` is `~oo`, and `0/0` is `NaN`. The user decided this
// rule for scalar quotients on 2026-08-29
// (`docs/plans/2026-08-29-interval-division.md`), and on 2026-10-20 for the
// coordinates of a declared point and of a list of points, and for imaginary
// and complex quotients. Each case below checks the static type and that the
// value with a zero divisor matches it.

const POSSIBLY_ZERO = 'infinity | nan | real';

function typeAndValueAtZero(
  json: MathJsonExpression
): [type: string, value: string, holds: boolean] {
  const ce = new ComputeEngine();
  ce.declare('x', 'integer');
  ce.declare('z', 'imaginary');
  ce.declare('tup', 'tuple<integer, integer>');
  ce.declare('Q', 'list<tuple<integer, integer>>');
  const type = ce.box(json).type;
  ce.assign('x', 0);
  ce.assign('z', ce.box(['Complex', 0, 3]));
  ce.assign('tup', ce.box(['Tuple', 1, 2]));
  ce.assign('Q', ce.box(['List', ['Tuple', 0, 2]]));
  const value = ce.box(json).evaluate();
  return [type.toString(), value.toString(), value.type.matches(type)];
}

describe('A DIVISOR THAT MAY BE ZERO', () => {
  test.each<[MathJsonExpression, string, string]>([
    [['Divide', 1, 'x'], POSSIBLY_ZERO, '~oo'],
    [
      ['Divide', 'tup', 'x'],
      `tuple<${POSSIBLY_ZERO}, ${POSSIBLY_ZERO}>`,
      '(~oo, ~oo)',
    ],
    [['First', ['Divide', 'tup', 'x']], POSSIBLY_ZERO, '~oo'],
    [
      ['Floor', ['First', ['Divide', 'tup', 'x']]],
      'infinity | integer | nan',
      '~oo',
    ],
    [
      ['Divide', 'Q', 'x'],
      `list<tuple<${POSSIBLY_ZERO}, ${POSSIBLY_ZERO}>>`,
      '[(Indeterminate, ~oo)]',
    ],
    [['Divide', 'ImaginaryUnit', 'x'], 'imaginary | infinity', '~oo'],
    [['Divide', 'z', 'x'], 'imaginary | infinity', '~oo'],
    [['Divide', ['Complex', 1, 2], 'x'], 'number', '~oo'],
  ])('%j', (json, type, value) => {
    expect(typeAndValueAtZero(json)).toEqual([type, value, true]);
  });
});

describe('A DIVISOR PROVEN NOT TO BE ZERO KEEPS THE FINITE TYPE', () => {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer<1..>');
  ce.declare('r', 'real');
  ce.assume(ce.box(['Greater', 'r', 0]));
  ce.declare('tup', 'tuple<integer, integer>');
  // An imaginary number is never zero.
  ce.declare('w', 'complex');
  ce.declare('j', 'imaginary');
  test.each<[MathJsonExpression, string]>([
    [['Divide', 'w', 'j'], 'complex'],
    [['Divide', 'tup', 'j'], 'tuple<complex, complex>'],
    [['Divide', 'tup', 4], 'tuple<rational, rational>'],
    [['Divide', 'tup', 'n'], 'tuple<rational, rational>'],
    [['Divide', 'tup', 'r'], 'tuple<real, real>'],
    [['Divide', 'ImaginaryUnit', 'n'], 'imaginary'],
    [['Divide', ['Complex', 1, 2], 'n'], 'complex'],
    // The cells of a literal divisor are read one by one.
    [
      ['Divide', ['Tuple', 1, 2], ['List', 1, 2]],
      'list<tuple<rational, rational>^2>',
    ],
    [
      ['Divide', ['Tuple', 1, 2], ['List', 1, 0]],
      'list<tuple<infinity, infinity> | tuple<rational, rational>>',
    ],
  ])('%j', (json, type) => {
    expect(ce.box(json).type.toString()).toBe(type);
  });
});

describe('AN INFINITE DIVISOR', () => {
  test('i over a divisor that may be infinite is not typed imaginary', () => {
    // `i / +oo` is `0`, which is not `imaginary`.
    const ce = new ComputeEngine();
    ce.declare('h', 'real | +oo | -oo');
    expect(ce.box(['Divide', 'ImaginaryUnit', 'h']).type.toString()).toBe(
      'number'
    );
  });
});

describe('A COLLECTION DIVIDED BY ITSELF', () => {
  // `x / x` is `1` for a symbol with no collection type: a documented
  // convention (ARCHITECTURE.md, "Generic-symbol conventions at
  // canonicalization"). A collection divided by itself is a collection, so
  // the fold does not apply to it.
  test('L / L stays a quotient and gives a list', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<integer>');
    const e = ce.box(['Divide', 'L', 'L']);
    expect(e.toString()).toBe('L / L');
    expect(e.type.toString()).toBe('list<number>');
    ce.assign('L', ce.box(['List', 1, 2]));
    expect(ce.box(['Divide', 'L', 'L']).evaluate().toString()).toBe('[1,1]');
    ce.assign('L', ce.box(['List', 0, 2]));
    expect(ce.box(['Divide', 'L', 'L']).evaluate().toString()).toBe(
      '[Indeterminate,1]'
    );
  });

  test('a symbol with no collection type still folds', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'any');
    expect(ce.box(['Divide', 'y', 'y']).toString()).toBe('1');
    expect(ce.box(['Divide', 'u', 'u']).toString()).toBe('1');
  });
});

describe('MORE DIVISORS THAT CANNOT BE ZERO', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'complex');
  ce.assume(ce.box(['NotEqual', 'c', 0]));
  ce.declare('t', 'tuple<integer, integer>');
  test.each<[MathJsonExpression, string]>([
    // An assumption `c ≠ 0` gives `c` the type `complex & !0`.
    [['Divide', ['Complex', 1, 2], 'c'], 'complex'],
    // A complex literal other than `0`.
    [['Divide', 't', ['Complex', 1, 2]], 'tuple<complex, complex>'],
    [['Divide', 't', 'ImaginaryUnit'], 'tuple<complex, complex>'],
  ])('%j', (json, type) => {
    expect(ce.box(json).type.toString()).toBe(type);
  });
});

describe('A NUMERATOR THAT MAY BE INFINITE', () => {
  test.each<[MathJsonExpression, string, MathJsonExpression]>([
    // `+∞ / i` is `~oo`.
    [['Divide', 'r', 'z'], 'number', 'ComplexInfinity'],
    // A coordinate that may be infinite: `+∞ / 2` is `+∞`.
    [
      ['Divide', 'p', 2],
      'tuple<infinity | nan | real, real>',
      ['Tuple', 'PositiveInfinity', ['Rational', 1, 2]],
    ],
  ])('%j', (json, type, value) => {
    const ce = new ComputeEngine();
    ce.declare('r', 'real | +oo | -oo');
    ce.declare('z', 'imaginary');
    ce.declare('p', 'tuple<real | +oo | -oo, real>');
    const e = ce.box(json);
    expect(e.type.toString()).toBe(type);
    ce.assign('r', ce.box('PositiveInfinity'));
    ce.assign('z', ce.box('ImaginaryUnit'));
    ce.assign('p', ce.box(['Tuple', 'PositiveInfinity', 1]));
    const v = ce.box(json).evaluate();
    expect(v.isSame(ce.box(value))).toBe(true);
    expect(v.type.matches(e.type)).toBe(true);
  });
});

describe('A POINT DIVIDED BY A LIST WITH A CELL THAT MAY BE ZERO', () => {
  test('the type states no length, as the type of the value', () => {
    // `[(Indeterminate, ~oo), (0, 1)]` has points of two tuple types, and
    // the type of such a list states no length.
    const ce = new ComputeEngine();
    ce.declare('v', 'vector<integer^2>');
    const e = ce.box(['Divide', ['Tuple', 1, 2], 'v']);
    expect(e.type.toString()).toBe(
      'list<tuple<infinity | nan | real, infinity | nan | real>>'
    );
    ce.assign('v', ce.box(['List', 0, 1]));
    const v = ce.box(['Divide', ['Tuple', 1, 2], 'v']).evaluate();
    expect(v.toString()).toBe('[(~oo, ~oo),(1, 2)]');
    expect(v.type.matches(e.type)).toBe(true);
  });
});
