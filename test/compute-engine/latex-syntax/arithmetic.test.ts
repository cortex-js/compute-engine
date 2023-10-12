import { Expression } from '../../../src/math-json';
import { engine } from '../../utils';

function evaluate(s: string): Expression {
  return engine.parse(s).evaluate()?.json ?? 'ERROR';
}

describe('SUM AND PRODUCT', () => {
  test('k is an Integer (as the index) and used a a Number (in the fraction)', () => {
    expect(evaluate(`\\sum_{k=0}^{10}\\frac{k}{2}`)).toMatchInlineSnapshot(
      `27.5`
    );
  });
  test('i is a valid index', () => {
    expect(evaluate(`\\sum_{i=0}^{10}\\frac{i}{2}`)).toMatchInlineSnapshot(
      `27.5`
    );
  });
});
