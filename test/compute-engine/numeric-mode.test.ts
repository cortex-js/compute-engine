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
      simplify  = 0.30000000000000004
    `));

  test(`\\frac{1}{7}`, () =>
    expect(check('\\frac{1}{7}')).toMatchInlineSnapshot(`
      box       = ["Divide", 1, 7]
      canonical = ["Rational", 1, 7]
      N-auto    = 0.(142857)
      N-mach    = 0.14285714285714285
    `));

  test(`\\frac{1.5}{7.8}`, () =>
    expect(check('\\frac{1}{7}')).toMatchInlineSnapshot(`
      box       = ["Divide", 1, 7]
      canonical = ["Rational", 1, 7]
      N-auto    = 0.(142857)
      N-mach    = 0.14285714285714285
    `));

  test(`\\frac{\\pi}{4}`, () =>
    expect(check('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`
      box       = ["Divide", "Pi", 4]
      N-auto    = 0.7853981633974483
    `));

  test(`\\frac{12345678901234567890}{23456789012345678901}`, () =>
    expect(check('\\frac{1}{7}')).toMatchInlineSnapshot(`
      box       = ["Divide", 1, 7]
      canonical = ["Rational", 1, 7]
      N-auto    = 0.(142857)
      N-mach    = 0.14285714285714285
    `));

  test(`12345678901234567890^{23456789012345678901}`, () =>
    expect(check('12345678901234567890^{23456789012345678901}'))
      .toMatchInlineSnapshot(`
      box       = ["Power", "12345678901234567890", "23456789012345678901"]
      N-auto    = PositiveInfinity
    `));

  test(`\\cos(555555^{-1})`, () =>
    expect(check('\\cos(555555^{-1})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Power", 555555, -1]]
      canonical = ["Cos", ["Rational", 1, 555555]]
      N-auto    = 0.9999999999983799967599955773952695962267595445677797188360289660653376695437160992108222980221295701
      N-mach    = 0.99999999999838
    `));

  test(`\\cos(3+4i)`, () =>
    expect(check('\\cos(3+4i)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Add", 3, ["InvisibleOperator", 4, "i"]]]
      canonical = ["Cos", ["Complex", 3, 4]]
      N-auto    = ["Complex", -27.034945603074224, -3.851153334811777]
      N-big     = NaN
      N-cplx    = ["Complex", -27.034945603074224, -3.851153334811777]
    `));

  test(`\\sqrt{-1}`, () =>
    expect(check('\\sqrt{-1}')).toMatchInlineSnapshot(`
      box       = ["Sqrt", -1]
      simplify  = ["Complex", 0, 1]
      evaluate  = ["Complex", 0, 1]
      eval-big  = NaN
      eval-mach = NaN
      eval-cplx = ["Complex", 0, 1]
    `));

  test('e^{i\\pi}', () =>
    expect(check('e^{i\\pi}')).toMatchInlineSnapshot(`
      box       = ["Power", "e", ["InvisibleOperator", "i", "Pi"]]
      canonical = ["Exp", ["Multiply", "ImaginaryUnit", "Pi"]]
      evaluate  = ["Exp", ["Multiply", ["Complex", 0, 1], "Pi"]]
      N-auto    = -1
      eval-big  = ["Exp", "NaN"]
      N-big     = NaN
      eval-mach = ["Exp", "NaN"]
      eval-cplx = ["Exp", ["Multiply", ["Complex", 0, 1], "Pi"]]
      N-cplx    = -1
    `));
});

//
// Minimum  precision is 15 digits
//
describe('NUMERIC MODE bignum 7', () => {
  beforeAll(() => {
    engine.numericMode = 'bignum';
    engine.precision = 7;
  });
  afterAll(() => {
    engine.numericMode = 'auto';
    engine.precision = 100;
  });

  test(`0.1 + 0.2`, () =>
    expect(N('0.1 + 0.2')).toMatchInlineSnapshot(`0.30000000000000004`));

  test(`\\sqrt{-1}`, () =>
    expect(N('\\sqrt{-1}')).toMatchInlineSnapshot(`NaN`));

  test(`\\frac{1}{7}`, () =>
    expect(N('\\frac{1}{7}')).toMatchInlineSnapshot(`0.142857142857143`));

  test(`\\frac{\\pi}{4}`, () =>
    expect(N('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`0.7853981633974475`));

  test('', () => expect(N('e^{i\\pi}')).toMatchInlineSnapshot(`NaN`));
});
