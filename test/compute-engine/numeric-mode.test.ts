import { ComputeEngine } from '../../src/compute-engine';
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
      canonical = ["Multiply", ["Rational", 1, 4], "Pi"]
      eval-auto = 1/4 * pi
      eval-mach = 1/4 * pi
      N-auto    = 0.785398163397448309616
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

  // The exact result is finite but astronomically large (~4.6·10^20 digits),
  // far beyond the exact-power materialization guard, so evaluate() keeps it
  // symbolic (an inert Power) rather than falsely overflowing to +oo; only
  // N() (a float approximation) overflows to +oo.
  test(`12345678901234567890^{23456789012345678901}`, () =>
    expect(check('12345678901234567890^{23456789012345678901}'))
      .toMatchInlineSnapshot(`
      box       = ["Power", {num: "12345678901234567890"}, {num: "23456789012345678901"}]
      eval-auto = 12345678901234567890^(23456789012345678901)
      eval-mach = 12345678901234567890^(23456789012345678901)
      N-auto    = +oo
      N-mach    = +oo
    `));

  test(`\\cos(555555^{-1})`, () =>
    expect(check('\\cos(555555^{-1})')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Power", 555555, -1]]
      canonical = ["Cos", ["Rational", 1, 555555]]
      eval-auto = cos(1/555555)
      eval-mach = cos(1/555555)
      N-auto    = 0.99999999999837999676
      N-mach    = 0.99999999999838
    `));

  // Since D12-A `3+4i` is an EXACT Gaussian integer literal, so under the
  // exactness contract `evaluate()` stays symbolic (like `cos(2)`) and only
  // `N()` numericizes.
  test(`\\cos(3+4i)`, () =>
    expect(check('\\cos(3+4i)')).toMatchInlineSnapshot(`
      box       = ["Cos", ["Add", 3, ["InvisibleOperator", 4, "i"]]]
      canonical = ["Cos", ["Complex", 3, 4]]
      eval-auto = cos((3 + 4i))
      eval-mach = cos((3 + 4i))
      N-auto    = (-27.034945603074224 - 3.851153334811777i)
      N-mach    = (-27.034945603074224 - 3.851153334811777i)
    `));

  test(`\\sqrt{-1}`, () =>
    expect(check('\\sqrt{-1}')).toMatchInlineSnapshot(`
      box       = ["Sqrt", -1]
      simplify  = i
    `));

  test('e^{i\\pi}', () =>
    expect(check('e^{i\\pi}')).toMatchInlineSnapshot(`
      box       = ["Power", "e", ["InvisibleOperator", "i", "Pi"]]
      canonical = ["Exp", ["Multiply", ["Complex", 0, 1], "Pi"]]
      eval-auto = -1
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
    expect(N('\\frac{1}{7}')).toMatchInlineSnapshot(`0.142857142857143`));

  test(`\\frac{\\pi}{4}`, () =>
    expect(N('\\frac{\\pi}{4}')).toMatchInlineSnapshot(`0.7853981633974483`));

  test('e^{i\\pi}', () => expect(N('e^{i\\pi}')).toMatchInlineSnapshot(`-1`));
});

//
// Regression: the `["N", expr]` operator must numerically evaluate its
// operand, just like the `.N()` method. The operator is lazy, so its operand
// is held unbound; previously the handler called `.N()` on that unbound
// expression, which is a no-op (e.g. `["N", "Pi"]` returned `Pi` unchanged).
// The handler now canonicalizes (binds) the operand first.
//
describe('N OPERATOR numericizes its operand', () => {
  test('["N", "Pi"]', () => {
    const result = engine.box(['N', 'Pi']).evaluate();
    expect(result.isNumberLiteral).toBe(true);
    expect(result.re).toBeCloseTo(Math.PI, 10);
  });

  test('["N", ["Sqrt", 2]]', () => {
    const result = engine.box(['N', ['Sqrt', 2]]).evaluate();
    expect(result.isNumberLiteral).toBe(true);
    expect(result.re).toBeCloseTo(Math.SQRT2, 10);
  });

  test('["N", ["Sin", 1]]', () => {
    const result = engine.box(['N', ['Sin', 1]]).evaluate();
    expect(result.isNumberLiteral).toBe(true);
    expect(result.re).toBeCloseTo(Math.sin(1), 10);
  });

  test('["N", expr] matches expr.N()', () => {
    expect(engine.box(['N', 'Pi']).evaluate().isSame(engine.box('Pi').N())).toBe(
      true
    );
  });
});

//
// `["N", expr, precision]`: the optional precision argument is a count of
// significant digits. When it exceeds the engine's working precision, the
// working precision is raised (and kept, since display precision is global);
// when it is at or below the working precision, the result is rounded down to
// that many significant digits without touching the global precision.
// Fresh engines isolate the (intentional) global precision mutation.
//
describe('N OPERATOR with a precision argument', () => {
  afterAll(() => {
    engine.precision = 'auto'; // reset process-global bignum precision
  });

  test('precision above working precision raises and keeps it', () => {
    const ce = new ComputeEngine();
    const result = ce.box(['N', 'Pi', 50]).evaluate();
    expect(result.toString()).toBe(
      '3.1415926535897932384626433832795028841971693993751'
    );
    expect(ce.precision).toBe(50);
  });

  test('precision at or below working precision rounds the value down', () => {
    const ce = new ComputeEngine();
    const before = ce.precision;
    expect(ce.box(['N', 'Pi', 5]).evaluate().toString()).toBe('3.1416');
    expect(ce.box(['N', 'Pi', 3]).evaluate().toString()).toBe('3.14');
    expect(ce.box(['N', ['Rational', 1, 3], 4]).evaluate().toString()).toBe(
      '0.3333'
    );
    expect(ce.precision).toBe(before); // global precision untouched
  });

  test('the precision argument may be a non-literal expression', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['N', 'Pi', ['Add', 2, 3]]).evaluate().toString()).toBe(
      '3.1416'
    );
  });

  test('complex operand rounds each component', () => {
    const ce = new ComputeEngine();
    const result = ce.box(['N', ['Complex', 3.14159, 2.71828], 3]).evaluate();
    expect(result.re).toBeCloseTo(3.14, 6);
    expect(result.im).toBeCloseTo(2.72, 6);
  });

  test('symbolic operand is unaffected by the precision argument', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['N', 'x', 5]).evaluate().toString()).toBe('x');
  });

  test('an invalid precision is ignored', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['N', 'Pi', 0]).evaluate().toString()).toBe(
      ce.box('Pi').N().toString()
    );
  });
});
