import { ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/math-json-format';
import { latex, simplifyToJson } from '../utils';

export const ce = new ComputeEngine();

function simplifyExpr(expr: Expression): Expression {
  return ce.box(expr).simplify()?.json ?? 'Error';
}

// \frac{\sin ^4\left(x\right)-\cos ^4\left(x\right)}{\sin ^2\left(x\right)-\cos ^2\left(x\right)}
// -> 1
// \frac{\sec \left(x\right)\sin ^2\left(x\right)}{1+\sec \left(x\right)}
// -> 1 - cos x
// \tan ^4\left(x\right)+2\tan ^2\left(x\right)+1
// -> \sec ^4\left(x\right)
// \tan ^2\left(x\right)\cos ^2\left(x\right)+\cot ^2\left(x\right)\sin ^2\left(x\right)
// -> 1

const exprs: [Expression, Expression][] = [
  [['Add', 'x', 0], 'x'],
  [['Add', 1, 0], 1],
  [
    ['Add', 1, 2, 1.0001],
    ['Add', 1.0001, 3],
  ],
];

describe('SIMPLIFY', () => {
  for (const expr of exprs) {
    test(`simplify(${latex(expr[0])}) = ${latex(expr[1])})`, () => {
      expect(simplifyExpr(expr[0])).toEqual(expr[1]);
    });
  }
});

describe('SIMPLIFY', () => {
  test(`simplify(1 + 1e199) (precision loss)`, () =>
    expect(simplifyToJson('1 + 1e999')).toMatchInlineSnapshot(
      `{num: "1e+999"}`
    ));

  test(`1.234 + 5678`, () =>
    expect(simplifyToJson('1.234 + 5678')).toMatchInlineSnapshot(
      `["Add", 1.234, 5678]`
    ));

  test(`1.234 + 5.678`, () =>
    expect(simplifyToJson('1.234 + 5.678')).toMatchInlineSnapshot(`6.912`));

  test(`\\frac34 + \\frac12`, () =>
    expect(simplifyToJson('\\frac34 + \\frac12')).toMatchInlineSnapshot(
      `["Rational", 5, 4]`
    ));

  test(`\\frac34 + 1e99`, () =>
    expect(simplifyToJson('\\frac34 + 1e99')).toMatchInlineSnapshot(`
      [
        "Rational",
        {
          num: "4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003"
        },
        4
      ]
    `));

  test(`\\frac34 + 2`, () =>
    expect(simplifyToJson('\\frac34 + 2')).toMatchInlineSnapshot(
      `["Rational", 11, 4]`
    ));

  test(`1234 + 5678`, () =>
    expect(simplifyToJson('1234 + 5678')).toMatchInlineSnapshot(`6912`));

  test(`-1234 - 5678`, () =>
    expect(simplifyToJson('-1234 - 5678')).toMatchInlineSnapshot(`-6912`));

  test(`1234 + 5678  + 1.0000000000001`, () =>
    expect(
      simplifyToJson('1234 + 5678  + 1.0000000000001')
    ).toMatchInlineSnapshot(`["Add", 1.0000000000001, 6912]`));

  test(`1e149 + 1e150`, () =>
    expect(simplifyToJson('1e149 + 1e150')).toMatchInlineSnapshot(`1.1e+150`));
});
