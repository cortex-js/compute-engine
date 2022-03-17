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

describe('SIMPLIFY - no loss of precision', () => {
  test(`simplify(1 + 1e199)`, () =>
    expect(simplifyToJson('1 + 1e999')).toEqual(['Add', 1, { num: '1e+999' }]));

  test(`1.234 + 5678`, () =>
    expect(simplifyToJson('1.234 + 5678')).toEqual(['Add', 1.234, 5678]));

  test(`1.234 + 5.678`, () =>
    expect(simplifyToJson('1.234 + 5.678')).toEqual(['Add', 1.234, 5.678]));

  test(`\\frac34 + \\frac12`, () =>
    expect(simplifyToJson('\\frac34 + \\frac12')).toEqual(['Rational', 5, 4]));

  test(`\\frac34 + 1e199`, () =>
    expect(simplifyToJson('\\frac34 + 1e199')).toEqual([
      'Add',
      ['Rational', 3, 4],
      1e199,
    ]));

  test(`\\frac34 + 2`, () =>
    expect(simplifyToJson('\\frac34 + 2')).toEqual(['Rational', 11, 4]));

  test(`1234 + 5678`, () =>
    expect(simplifyToJson('1234 + 5678')).toEqual(6912));

  test(`1234 + 5678  + 1.0000000000001`, () =>
    expect(simplifyToJson('1234 + 5678  + 1.0000000000001')).toEqual([
      'Add',
      1.0000000000001,
      6912,
    ]));

  test(`-1234 - 5678`, () =>
    expect(simplifyToJson('-1234 - 5678')).toEqual(-6912));

  test(`1e149 + 1e150`, () =>
    expect(simplifyToJson('1e149 + 1e150')).toEqual(['Add', 1e149, 1e150]));
});
