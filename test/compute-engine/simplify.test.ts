import { ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/math-json-format';
import { latex } from '../utils';

export const ce = new ComputeEngine();

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
      expect(ce.simplify(expr[0])).toEqual(expr[1]);
    });
  }
});

describe('SIMPLIFY - NO PRECISION LOSS', () => {
  test(`simplify(1 + 1e199)`, () => {
    //
    // Only small integers should get coalesced
    //
    expect(ce.simplify(ce.parse('1 + 1e199'))).toMatchInlineSnapshot(
      `['Add', 1, {num: '1e199'}]`
    );

    expect(ce.simplify(ce.parse('1.234 + 5678'))).toMatchInlineSnapshot(
      `['Add', 1.234, 5678]`
    );

    expect(ce.simplify(ce.parse('1.234 + 5.678'))).toMatchInlineSnapshot(
      `['Add', 1.234, 5.678]`
    );

    expect(ce.simplify(ce.parse('\\frac34 + \\frac12'))).toMatchInlineSnapshot(
      `['Divide', 5, 4]`
    );

    expect(ce.simplify(ce.parse('\\frac34 + 1e199'))).toMatchInlineSnapshot(
      `['Add', 'ThreeQuarter', {num: '1e199'}]`
    );

    expect(ce.simplify(ce.parse('\\frac34 + 2'))).toMatchInlineSnapshot(
      `['Divide', 11, 4]`
    );

    expect(ce.simplify(ce.parse('1234 + 5678'))).toMatchInlineSnapshot(`6912`);

    expect(ce.simplify(ce.parse('-1234 - 5678'))).toMatchInlineSnapshot(
      `-6912`
    );

    expect(ce.simplify(ce.parse('1e149 + 1e150'))).toMatchInlineSnapshot(
      `['Add', {num: '1e149'}, {num: '1e150'}]`
    );
  });
});
