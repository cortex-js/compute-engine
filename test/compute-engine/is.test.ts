import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/math-json/types';

export const engine = new ComputeEngine();

const tests: [Expression, Expression | number | bigint | boolean, boolean][] = [
  [1, 1, true],
  [1, 1n, true],
  [1, 2, false],
  [1, false, false],
  [1, 1.0, true],
  [1, 1.0000000000000001, true],
  [1, 1.0000000000000002, false],
  ['one', 1, true],
  ['one', 'one', true],
  ['one', 'zero', false],
  ['one', 1n, true],
  ['one', 2, false],
  ['zero', 0, true],
  ['zero', 0n, true],
  ['zero', 1, false],
  ['x', 1, false],
  ['boolean', true, true],
  ['boolean', false, false],
  ['boolean', 1, false],
  ['string', "'hello'", true],
  ['string', "'world'", false],
  ['string', 1, false],
  ['undeclared', 1, false],
  ['nan', NaN, true],
  ['nan', 1, false],
  [['Divide', 84, 2], 42, true],
  [['Divide', 'x', 2], 42, false],
  ['nan', 'nan', true],
];

describe('is()', () => {
  beforeAll(() => {
    engine.declare('x', 'real');
    engine.assign('one', 1);
    engine.assign('zero', 0);
    engine.assign('boolean', true);
    engine.assign('string', "'hello'");
    engine.assign('nan', NaN);
    engine.assign('infinity', Infinity);
  });

  // https://jestjs.io/docs/next/api#testeachtablename-fn-timeout
  test.each(tests)('is("%p")', (a, b, expected) => {
    const expr = engine.box(a);
    if (
      typeof b === 'number' ||
      typeof b === 'bigint' ||
      typeof b === 'boolean'
    ) {
      expect(expr.is(b)).toBe(expected);
    } else {
      expect(expr.is(engine.box(b))).toBe(expected);
    }
  });
});
