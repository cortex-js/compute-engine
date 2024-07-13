import { BoxedExpression, ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/math-json-format';
import { simplify } from '../utils';

export const ce = new ComputeEngine();

// \frac{\sin ^4\left(x\right)-\cos ^4\left(x\right)}{\sin ^2\left(x\right)-\cos ^2\left(x\right)}
// -> 1
// \frac{\sec \left(x\right)\sin ^2\left(x\right)}{1+\sec \left(x\right)}
// -> 1 - cos x
// \tan ^4\left(x\right)+2\tan ^2\left(x\right)+1
// -> \sec ^4\left(x\right)
// \tan ^2\left(x\right)\cos ^2\left(x\right)+\cot ^2\left(x\right)\sin ^2\left(x\right)
// -> 1

/**
 * A set of test cases for the simplification of expressions.
 * Each test case is a tuple of two expressions:
 * - The first expression is the input expression to simplify.
 * - The second expression is the expected simplified expression.
 */
const TEST_CASES: [Expression, Expression][] = [
  ['\\ln{3}+\\ln{\\frac{1}{3}}', '0'],
  ['\\frac{\\ln{9}}{\\ln{3}}', 2],
  ['e e^x e^{-x}', 'e'],
  ['e^x e^{-x}', 1],
  ['0.3', 0.3], // Floating point should stay as is
  ['\\sqrt3 + 0.3', '\\sqrt3+0.3'], // Exact + floating point should stay as is
  ['1+0', 1], // Zero is removed from addition
  ['x+0', 'x'], // Zero is removed from addition
  ['\\sqrt3 - 2', '\\sqrt3 - 2'], // Should stay exact
  ['\\frac{\\sqrt5+1}{4}', '\\frac{\\sqrt5+1}{4}'],
  // [['Add', 1, 2, 1.0001], 4.0001],
  ['\\frac{3.1}{2.8}', '\\frac{3.1}{2.8}'], // Floating point division
  [' 2x\\times x \\times 3 \\times x', '6x^3'], // Product of x should be simplified
  ['2(13.1+x)', '26.2+2x'], // Product of floating point should be simplified
  ['2(13.1+x)-26.2+2x', 0],
  // ['2\\left(13.1+x\\right)-\\left(26.2+2x\\right)', 0],
  ['\\frac12 + 0.5', 1], // Floating point and exact should get simplified
  // ['\\sqrt{3}(\\sqrt2x + x)', '(\\sqrt3+\\sqrt6)x'],
  // ['\\sqrt[4]{16b^{4}}', '2b'],
];

describe('SIMPLIFY', () => {
  for (const expr of TEST_CASES) {
    let a: BoxedExpression;
    let b: BoxedExpression;
    if (typeof expr[0] === 'string') a = ce.parse(expr[0]);
    else a = ce.box(expr[0]);
    if (typeof expr[1] === 'string') b = ce.parse(expr[1]);
    else b = ce.box(expr[1]);
    test(`simplify("${a.latex}") = "${b.latex}"`, () => {
      expect(a.json).toEqual(b.json);
    });
  }
});

describe('SIMPLIFY', () => {
  test(`simplify(1 + 1e199) (precision loss)`, () =>
    expect(simplify('1 + 1e999')).toMatchInlineSnapshot(`PositiveInfinity`));

  test(`1.234 + 5678`, () =>
    expect(simplify('1.234 + 5678')).toMatchInlineSnapshot(`5679.234`));

  test(`1.234 + 5.678`, () =>
    expect(simplify('1.234 + 5.678')).toMatchInlineSnapshot(`6.912`));

  test(`\\frac34 + \\frac12`, () =>
    expect(simplify('\\frac34 + \\frac12')).toMatchInlineSnapshot(
      `["Rational", 5, 4]`
    ));

  test(`\\frac34 + 1e99`, () =>
    expect(simplify('\\frac34 + 1e99')).toMatchInlineSnapshot(`1e+99`));

  test(`\\frac34 + 2`, () =>
    expect(simplify('\\frac34 + 2')).toMatchInlineSnapshot(
      `["Rational", 11, 4]`
    ));

  test(`1234 + 5678`, () =>
    expect(simplify('1234 + 5678')).toMatchInlineSnapshot(`6912`));

  test(`-1234 - 5678`, () =>
    expect(simplify('-1234 - 5678')).toMatchInlineSnapshot(`-6912`));

  test(`1234 + 5678  + 1.0000000000001`, () =>
    expect(simplify('1234 + 5678  + 1.0000000000001')).toMatchInlineSnapshot(
      `6913`
    ));

  test(`1e149 + 1e150`, () =>
    expect(simplify('1e149 + 1e150')).toMatchInlineSnapshot(`1.1e+150`));
});

describe('RELATIONAL OPERATORS', () => {
  // Simplify common coefficient
  test(`2a < 4b`, () =>
    expect(simplify('2a \\lt 4b')).toMatchInlineSnapshot(
      `["Less", "a", ["Multiply", 2, "b"]]`
    ));

  // Simplify coefficient with a common factor
  test(`2x^2 < 4x^3`, () =>
    expect(simplify('2x^2 \\lt 4x^3')).toMatchInlineSnapshot(
      `["Less", ["Add", ["Multiply", -2, ["Square", "x"]], "x"], 0]`
    ));

  test(`2a < 4ab`, () =>
    expect(simplify('2a < 4ab')).toMatchInlineSnapshot(
      `["Less", 1, ["Multiply", 2, "b"]]`
    ));
});
