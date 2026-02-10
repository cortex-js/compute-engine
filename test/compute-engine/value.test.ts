import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression as Expression } from '../../src/math-json/types';

export const engine = new ComputeEngine();

// An expression, and its expected `value` and `valueOf()`
const tests: [
  Expression,
  string | undefined,
  number | number[] | number[][] | number[][][] | string | boolean,
][] = [
  [1, '1', 1],
  ['True', undefined, true],
  ['False', undefined, false],
  ['0.123456789123456789', '0.123456789123456789', 0.123456789123456789],
  ['undeclared', undefined, 'undeclared'],
  ['x', undefined, 'x'],
  ['one', '1', 1],
  ['zero', '0', 0],
  ['boolean', '"True"', true],
  ['string', '"hello"', 'hello'],
  [['Add', 'x', 1], undefined, 'x + 1'],
  [['Add', 2, 1], '3', 3],
];

describe('value and valueOf()', () => {
  beforeAll(() => {
    engine.pushScope();
    engine.declare('x', 'real');
    engine.assign('one', 1);
    engine.assign('zero', 0);
    engine.assign('boolean', true);
    engine.assign('string', { str: 'hello' });
    engine.assign('nan', NaN);
    engine.assign('infinity', Infinity);
  });
  afterAll(() => {
    engine.popScope();
  });

  // https://jestjs.io/docs/next/api#testeachtablename-fn-timeout
  test.each(tests)('is("%p")', (a, v, vOf) => {
    const expr = engine.box(a);
    expect(expr.value?.toString()).toEqual(v);
    expect(expr.valueOf()).toEqual(vOf);
  });
});
