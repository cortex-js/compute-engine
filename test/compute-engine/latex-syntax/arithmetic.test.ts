import { Expression } from '../../../src/math-json';
import { engine } from '../../utils';

function evaluate(s: string): Expression {
  return engine.parse(s).evaluate()?.json ?? 'ERROR';
}

describe('SUM', () => {
  test('k is an Integer (as the index) and used a a Number (in the fraction)', () => {
    expect(evaluate(`\\sum_{k=0}^{10}\\frac{k}{2}`)).toMatchInlineSnapshot(
      `["Rational", 55, 2]`
    );
  });

  test('i is a valid index', () => {
    expect(evaluate(`\\sum_{i=0}^{10}\\frac{i}{2}`)).toMatchInlineSnapshot(
      `["Rational", 55, 2]`
    );
  });

  test('sum of a collection', () => {
    expect(
      evaluate(`\\sum \\lbrack 1, 2, 3, 4, 5\\rbrack`)
    ).toMatchInlineSnapshot(`15`);
  });
});

describe('PRODUCT', () => {
  test('k is an Integer (as the index) and used a a Number (in the fraction)', () => {
    expect(evaluate(`\\prod_{k=1}^{10}\\frac{k}{2}`)).toMatchInlineSnapshot(
      `["Rational", 14175, 4]`
    );
  });

  test('i is a valid index', () => {
    expect(evaluate(`\\prod_{i=1}^{10}\\frac{i}{2}`)).toMatchInlineSnapshot(
      `["Rational", 14175, 4]`
    );
  });

  test('product of a collection', () => {
    expect(
      evaluate(`\\prod \\lbrack 1, 2, 3, 4, 5\\rbrack`)
    ).toMatchInlineSnapshot(`120`);
  });
});
