import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// √(−c)/d was NaN: `(1/d)·√(−c)` went to the float lane, which took
// `Math.sqrt(−c)`. A negative integer radical is the exact imaginary value
// (√c/d)·i. Reference values are mpmath.

// [name, expression, exact JSON, imaginary part (mpmath), real part]
const cases: [string, any, any, number, number][] = [
  [
    'Sqrt(-13)/3',
    ['Divide', ['Sqrt', -13], 3],
    ['Complex', 0, ['Divide', ['Sqrt', 13], 3]],
    1.2018504251546631,
    0,
  ],
  [
    'Sqrt(-2)/3',
    ['Divide', ['Sqrt', -2], 3],
    ['Complex', 0, ['Divide', ['Sqrt', 2], 3]],
    0.47140452079103168,
    0,
  ],
  [
    'Sqrt(-13)/2',
    ['Divide', ['Sqrt', -13], 2],
    ['Complex', 0, ['Divide', ['Sqrt', 13], 2]],
    1.8027756377319946,
    0,
  ],
  [
    'Sqrt(-13)/-3',
    ['Divide', ['Sqrt', -13], -3],
    ['Complex', 0, ['Negate', ['Divide', ['Sqrt', 13], 3]]],
    -1.2018504251546631,
    0,
  ],
  [
    'Sqrt(-13)*Rational(1,3)',
    ['Multiply', ['Sqrt', -13], ['Rational', 1, 3]],
    ['Complex', 0, ['Divide', ['Sqrt', 13], 3]],
    1.2018504251546631,
    0,
  ],
  // These already worked
  [
    'Sqrt(-1)/2',
    ['Divide', ['Sqrt', -1], 2],
    ['Complex', 0, ['Rational', 1, 2]],
    0.5,
    0,
  ],
  [
    'Sqrt(-13)/Sqrt(3)',
    ['Divide', ['Sqrt', -13], ['Sqrt', 3]],
    ['Complex', 0, ['Divide', ['Sqrt', 39], 3]],
    2.0816659994661326,
    0,
  ],
  // √3/√(−3) = −i; √(−13)/√(−3) = +√39/3 (the sign was wrong)
  [
    'Sqrt(3)/Sqrt(-3)',
    ['Divide', ['Sqrt', 3], ['Sqrt', -3]],
    ['Complex', 0, -1],
    -1,
    0,
  ],
  [
    'Sqrt(-13)/Sqrt(-3)',
    ['Divide', ['Sqrt', -13], ['Sqrt', -3]],
    ['Divide', ['Sqrt', 39], 3],
    0,
    2.0816659994661326,
  ],
  [
    '3/Sqrt(-13)',
    ['Divide', 3, ['Sqrt', -13]],
    ['Complex', 0, ['Multiply', ['Rational', -3, 13], ['Sqrt', 13]]],
    -0.8320502943378437,
    0,
  ],
];

describe('SQRT OF A NEGATIVE INTEGER OVER AN INTEGER', () => {
  for (const [name, expr, json, im, re] of cases) {
    // `Multiply` keeps its canonical shape and folds under evaluate
    if (expr[0] !== 'Multiply')
      test(`${name} = ${JSON.stringify(json)} (canonical)`, () => {
        expect(ce.expr(expr).json).toEqual(json);
      });
    test(`${name} = ${JSON.stringify(json)} (evaluate)`, () => {
      expect(ce.expr(expr).evaluate().json).toEqual(json);
    });
    test(`${name} = ${re} + ${im}i (.N())`, () => {
      const v = ce.expr(expr).N() as any;
      expect(v.re).toBeCloseTo(re, 13);
      expect(v.im).toBeCloseTo(im, 13);
    });
    test(`${name} (simplify)`, () => {
      const v = ce.expr(expr).simplify() as any;
      expect(v.N().re).toBeCloseTo(re, 13);
      expect(v.N().im).toBeCloseTo(im, 13);
    });
  }

  test('Sqrt(-13)/3.0 = 1.2018504251546631i (a float divisor)', () => {
    const v = ce.expr(['Divide', ['Sqrt', -13], 3.0]).N() as any;
    expect(v.re).toBeCloseTo(0, 13);
    expect(v.im).toBeCloseTo(1.2018504251546631, 13);
  });

  test('Sqrt(-13)/3 under the parse route', () => {
    const e = ce.parse('\\frac{\\sqrt{-13}}{3}');
    expect((e.N() as any).im).toBeCloseTo(1.2018504251546631, 13);
  });

  test('Arcosh(Sqrt(-13)/3) = 1.0171572086841316 + 1.5707963267948966i', () => {
    const v = ce.expr(['Arcosh', ['Divide', ['Sqrt', -13], 3]]).N() as any;
    expect(v.re).toBeCloseTo(1.0171572086841316, 13);
    expect(v.im).toBeCloseTo(1.5707963267948966, 13);
  });

  test('Sqrt(-13)/3 compiled', () => {
    const r = compile(ce.expr(['Divide', ['Sqrt', -13], 3]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    const v = r.run!() as any;
    expect(v.re).toBeCloseTo(0, 13);
    expect(v.im).toBeCloseTo(1.2018504251546631, 13);
  });
});

// A negative radical whose absolute value is at least SMALL_INTEGER (10⁶).
// The numeric value takes the square factors out of the imaginary radical,
// as it does for a real radical, and goes to the float lane when the
// square-free part is still at least 10⁶. `evaluate()` of the expression
// keeps the radical symbolic (`Multiply(1/3, Sqrt(-52000000))`), so the
// exact reduction is checked on the numeric value itself.
describe('SQRT OF A LARGE NEGATIVE INTEGER OVER AN INTEGER', () => {
  test('Sqrt(-52000000)/3 = (2000√13/3)·i: the square factor 2000² comes out', () => {
    const v = ce.number(
      ce._numericValue({ rational: [1, 3], radical: -52000000 })
    );
    expect(v.json).toEqual([
      'Complex',
      0,
      ['Multiply', ['Rational', 2000, 3], ['Sqrt', 13]],
    ]);
    const n = ce.expr(['Divide', ['Sqrt', -52000000], 3]).N() as any;
    expect(n.re).toBe(0);
    expect(n.im).toBeCloseTo((2000 * Math.sqrt(13)) / 3, 9);
  });

  test('Sqrt(-1000003)/3: a square-free radicand past 10⁶ goes to the float lane', () => {
    const v = ce._numericValue({ rational: [1, 3], radical: -1000003 });
    expect(v.isExact).toBe(false);
    expect(v.re).toBe(0);
    expect(v.im).toBeCloseTo(Math.sqrt(1000003) / 3, 9);
    const e = ce.expr(['Divide', ['Sqrt', -1000003], 3]);
    expect(e.evaluate().isNaN).not.toBe(true);
    const n = e.N() as any;
    expect(n.re).toBe(0);
    expect(n.im).toBeCloseTo(Math.sqrt(1000003) / 3, 9);
  });
});
