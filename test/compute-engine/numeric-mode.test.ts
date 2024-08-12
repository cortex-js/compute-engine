import { engine, check } from '../utils';

function N(s: string) {
  return engine.parse(s).N();
}

//
// Auto should use machine when possible, Decimal or Complex when necessary
//

describe('NUMERIC MODE', () => {
  test(`0.1 + 0.2`, () =>
    expect(check('0.1 + 0.2')).toMatchInlineSnapshot(`
      box       = ["Add", 0.1, 0.2]
      simplify  = 0.3
      eval-auto = 0.3
      eval-mach = 0.30000000000000004
    `));

  test(`\\frac{1}{7}`, () =>
    expect(check('\\frac{1}{7}')).toMatchInlineSnapshot(`
      box       = ["Divide", 1, 7]
      canonical = ["Rational", 1, 7]
      eval-auto = 1/7
      eval-mach = 1/7
      N-auto    = 0.142857142857142857143
      N-mach    = 0.142857142857143
    `));

  test(`\\frac{1.5}{7.8}`, () =>
    expect(check('\\frac{1}{7}')).toMatchInlineSnapshot(`
      box       = ["Divide", 1, 7]
      canonical = ["Rational", 1, 7]
      eval-auto = 1/7
      eval-mach = 1/7
      N-auto    = 0.142857142857142857143
      N-mach    = 0.142857142857143
    `));

  test(`\\frac{\\pi}{4}`, () =>
    expect(check('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`
      box       = ["Divide", "Pi", 4]
      eval-auto = pi / 4
      eval-mach = pi / 4
      N-auto    = 0.785398163397448309615
      N-mach    = 0.7853981633974483
    `));

  test(`\\frac{12345678901234567890}{23456789012345678901}`, () =>
    expect(check('\\frac{1}{7}')).toMatchInlineSnapshot(`
      box       = ["Divide", 1, 7]
      canonical = ["Rational", 1, 7]
      eval-auto = 1/7
      eval-mach = 1/7
      N-auto    = 0.142857142857142857143
      N-mach    = 0.142857142857143
    `));

  test(`12345678901234567890^{23456789012345678901}`, () =>
    expect(
      check('12345678901234567890^{23456789012345678901}')
    ).toMatchInlineSnapshot(
      `["Power", {num: "12345678901234567890"}, {num: "23456789012345678901"}]`
    ));

  test(`\\cos(555555^{-1})`, () =>
    expect(check('\\cos(555555^{-1})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Divide", 1, 555555]]
      simplify  = cos(1/555555)
      eval-auto = 0.99999999999837999676
      eval-mach = 0.99999999999838
    `));

  test(`\\cos(3+4i)`, () =>
    expect(check('\\cos(3+4i)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Add", 3, ["InvisibleOperator", 4, "i"]]]
      canonical = ["Cos", ["Complex", 3, 4]]
      eval-auto = (-27.034945603074224 - 3.851153334811777i)
    `));

  test(`\\sqrt{-1}`, () =>
    expect(check('\\sqrt{-1}')).toMatchInlineSnapshot(`
      box       = ["Sqrt", -1]
      canonical = ["Complex", 0, 1]
    `));

  test('e^{i\\pi}', () =>
    expect(check('e^{i\\pi}')).toMatchInlineSnapshot(`
      box       = ["Power", "e", ["InvisibleOperator", "i", "Pi"]]
      canonical = ["Exp", ["Multiply", ["Complex", 0, 1], "Pi"]]
      simplify  = -1
    `));
});

//
// Minimum  precision is 15 digits
//
describe('NUMERIC MODE bignum 7', () => {
  beforeAll(() => {
    engine.precision = 7;
  });
  afterAll(() => {
    engine.precision = 'auto';
  });

  test(`0.1 + 0.2`, () =>
    expect(N('0.1 + 0.2')).toMatchInlineSnapshot(`0.30000000000000004`));

  test(`\\sqrt{-1}`, () =>
    expect(N('\\sqrt{-1}')).toMatchInlineSnapshot(`["Complex", 0, 1]`));

  test(`\\frac{1}{7}`, () =>
    expect(N('\\frac{1}{7}')).toMatchInlineSnapshot(`0.14285714285714285`));

  test(`\\frac{\\pi}{4}`, () =>
    expect(N('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`0.7853981633974483`));

  test('e^{i\\pi}', () => expect(N('e^{i\\pi}')).toMatchInlineSnapshot(`-1`));
});
