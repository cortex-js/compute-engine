import { BoxedExpression, ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/types.ts';
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
  //
  // Arithmetic operations
  // - integers and float are simplified
  // - rational and square root of integers are preserved
  // (same behavior as Mathematica)
  //
  ['-23', -23], // Integers should stay as is
  ['0.3', 0.3], // Floating point should stay as is
  ['3/4', '3/4'], // Rational are reduced
  ['6/8', '3/4'], // Rational are reduced (during canonicalization)
  ['\\sqrt3', '\\sqrt3'],
  ['\\sqrt{3.1}', { num: '1.76068168616590091458' }],

  ['x+0', 'x'], // Zero is removed from addition
  ['-1234 - 5678', -6912],
  ['1.234 + 5678', 5679.234],
  ['1.234 + 5.678', 6.912],
  ['1.234 + 5.678 + 1.0001', 7.9121],
  ['2 + 4', 6],
  ['1/2 + 0.5', 1], // Floating point and exact should get simplified
  ['\\sqrt3 + 0.3', { num: '2.0320508075688772' }],
  ['\\sqrt3 + 1/2', '\\sqrt3 + 1/2'],
  ['\\sqrt3 + 3', '\\sqrt3 + 3'],
  ['3/4 + 2', '11/4'], // Rational are reduced, but preserved as exact values
  ['3/4 + 5/7', '41/28'], // Rational are reduced, but preserved as exact values

  ['3.1/2.8', '1.10714285714285714286'], // Floating point division

  [' 2x\\times x \\times 3 \\times x', '6x^3'], // Product of x should be simplified
  ['2(13.1+x)', '26.2+2x'], // Product of floating point should be simplified
  ['2(13.1+x) - 26.2 - 2x', 0],

  //
  // Numeric literals
  //
  ['\\sqrt3 - 2', '\\sqrt3 - 2'], // Should stay exact
  ['\\frac{\\sqrt5+1}{4}', '\\frac{\\sqrt5}{4}+\\frac14'], // Should stay exact

  //
  // Other simplifications
  //

  ['\\ln(3)+\\ln(\\frac{1}{3})', '0'],
  //  ['\\frac{\\ln(9)}{\\ln(3)}', 2],
  //  ['e e^x e^{-x}', 'e'],
  //  ['e^x e^{-x}', 1],
  // [['Add', 1, 2, 1.0001], 4.0001],
  // ['2\\left(13.1+x\\right)-\\left(26.2+2x\\right)', 0],
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

    test(`simplify("${typeof expr[0] === 'string' ? expr[0] : a.toString()}") = "${typeof expr[1] === 'string' ? expr[1] : b.toString()}"`, () =>
      expect(a.simplify().json).toEqual(b.json));
  }
});

describe('SIMPLIFY', () => {
  test(`simplify(1 + 1e999) (expect precision loss)`, () =>
    expect(simplify('1 + 1e999')).toMatchInlineSnapshot(`
      {
        num: "1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
      }
    `));

  test(`\\frac34 + \\frac12`, () =>
    expect(simplify('\\frac34 + \\frac12')).toMatchInlineSnapshot(
      `["Rational", 5, 4]`
    ));

  test(`\\frac34 + 1e99`, () =>
    expect(simplify('\\frac34 + 1e99')).toMatchInlineSnapshot(`
      [
        "Rational",
        {
          num: "4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003"
        },
        4
      ]
    `));

  test(`1e149 + 1e150`, () =>
    expect(simplify('1e149 + 1e150')).toMatchInlineSnapshot(
      `{num: "11e+149"}`
    ));
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
