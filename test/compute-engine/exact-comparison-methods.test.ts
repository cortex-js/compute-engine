import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// Two EXACT numbers (integers, rationals, rationals times the square root of
// an integer, and pure expressions that evaluate to them) are compared
// exactly, with no tolerance, by the methods `isEqual()`, `isLess()`,
// `isLessEqual()`, `isGreater()`, `isGreaterEqual()` and
// `isIdenticallyEqual()`, as they are by the operators `Equal`, `Less`…
// The engine tolerance applies only when a float is involved. `is()` keeps
// its tolerance, and `isSame()` stays structural. (User decision
// 2026-09-30.)

const ce = new ComputeEngine();

const BIG_SQRT2: MathJsonExpression = [
  'Divide',
  { num: '1414213562373095048801689' },
  ['Power', 10, 24],
];

// [a, b, order of a and b]
const EXACT_PAIRS: [string, MathJsonExpression, MathJsonExpression, number][] =
  [
    [
      '1/3 vs 3333333333333/10^13',
      ['Rational', 1, 3],
      ['Rational', 3333333333333, 10000000000000],
      1,
    ],
    [
      '1/2 - 10^-30 vs 1/2',
      ['Subtract', ['Rational', 1, 2], ['Power', 10, -30]],
      ['Rational', 1, 2],
      -1,
    ],
    ['sqrt(2) vs its 24-digit decimal', ['Sqrt', 2], BIG_SQRT2, -1],
  ];

describe('EXACT COMPARISON METHODS', () => {
  for (const [label, x, y, order] of EXACT_PAIRS) {
    test(`methods agree with the operators: ${label}`, () => {
      const a = ce.box(x);
      const b = ce.box(y);
      expect(a.isEqual(b)).toBe(false);
      expect(a.isIdenticallyEqual(b)).toBe(false);
      expect(a.isLess(b)).toBe(order < 0);
      expect(a.isLessEqual(b)).toBe(order < 0);
      expect(a.isGreater(b)).toBe(order > 0);
      expect(a.isGreaterEqual(b)).toBe(order > 0);
      // The reversed operand order gives the opposite relation
      expect(b.isEqual(a)).toBe(false);
      expect(b.isLess(a)).toBe(order > 0);
      expect(b.isGreater(a)).toBe(order < 0);

      const op = (name: string) => ce.box([name, x, y]).evaluate().symbol;
      expect(op('Equal')).toBe(a.isEqual(b) ? 'True' : 'False');
      expect(op('Less')).toBe(a.isLess(b) ? 'True' : 'False');
      expect(op('Greater')).toBe(a.isGreater(b) ? 'True' : 'False');
      expect(op('LessEqual')).toBe(a.isLessEqual(b) ? 'True' : 'False');
      expect(op('GreaterEqual')).toBe(a.isGreaterEqual(b) ? 'True' : 'False');
    });
  }

  test('is() keeps the tolerance, isSame() stays structural', () => {
    for (const [, x, y] of EXACT_PAIRS) {
      expect(ce.box(x).is(ce.box(y))).toBe(true);
      expect(ce.box(x).isSame(ce.box(y))).toBe(false);
    }
  });

  test('two equal exact numbers are equal', () => {
    const a = ce.box(['Rational', 1, 2]);
    expect(a.isEqual(ce.box(['Divide', 2, 4]))).toBe(true);
    expect(a.isLessEqual(ce.box(['Rational', 1, 2]))).toBe(true);
    expect(a.isLess(ce.box(['Rational', 1, 2]))).toBe(false);
    expect(
      ce.box(['Sqrt', 8]).isEqual(ce.box(['Multiply', 2, ['Sqrt', 2]]))
    ).toBe(true);
    expect(ce.box(['Add', 2, 3]).isEqual(5)).toBe(true);
  });

  test('an expression that evaluates to an exact number', () => {
    // `(25! − 1)/24!` is `25 − 1/24!`: its float is 25
    const f = ce.parse('\\frac{25!-1}{24!}');
    expect(f.isEqual(25)).toBe(false);
    expect(f.isEqual(ce.number(25))).toBe(false);
    expect(f.isLess(25)).toBe(true);
    expect(f.isGreaterEqual(25)).toBe(false);

    const held = ce.box(['Subtract', ['Rational', 1, 2], ['Power', 10, -30]], {
      form: 'structural',
    });
    expect(held.isEqual(ce.box(['Rational', 1, 2]))).toBe(false);
    expect(held.isLess(ce.box(['Rational', 1, 2]))).toBe(true);
  });

  test('a float keeps the tolerance', () => {
    const tenth = ce.box(['Rational', 1, 10]);
    expect(tenth.isEqual(0.1)).toBe(true);
    expect(tenth.isEqual(ce.number(0.1))).toBe(true);
    expect(tenth.isLess(0.1)).toBe(false);
    expect(tenth.isGreater(0.1)).toBe(false);
    expect(ce.box(['Equal', ['Rational', 1, 10], 0.1]).evaluate().symbol).toBe(
      'True'
    );
    const nearHalf = ce.box([
      'Subtract',
      ['Rational', 1, 2],
      ['Power', 10, -30],
    ]);
    expect(nearHalf.isEqual(0.5)).toBe(true);
    expect(nearHalf.isLess(0.5)).toBe(false);
  });

  test('a constant that is not an exact number keeps the tolerance', () => {
    expect(ce.box('Pi').isEqual(ce.parse('3.14159265358979323846'))).toBe(true);
  });
});
