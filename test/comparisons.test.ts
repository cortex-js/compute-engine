import { ComputeEngine } from '../src/math-json';
import { latex, printExpression } from './utils';

export const engine = new ComputeEngine();

beforeEach(() => {
  jest.spyOn(console, 'assert').mockImplementation((assertion) => {
    if (!assertion) debugger;
  });
  jest.spyOn(console, 'log').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'info').mockImplementation(() => {
    debugger;
  });
});
expect.addSnapshotSerializer({
  // test: (val): boolean => Array.isArray(val) || typeof val === 'object',
  test: (_val): boolean => true,

  serialize: (val, _config, _indentation, _depth, _refs, _printer): string => {
    return printExpression(val);
  },
});

/*
    [a, b, compare(a,b)]
*/
const exprs = [
  [1, 1, 0], // 1 === 1
  [1, 0, 1], // 1 > 0
  [2, 5, -1],
  [5, 2, 1],
  [7, 7, 0],

  [1, 'Pi', -1],
  ['Pi', 'Pi', 0],
  [4, 'Pi', 1],
  ['Pi', 1, 1],
  ['Pi', 4, -1],

  [1, 'x', undefined],
  ['x', 1, undefined],
  ['x', 'y', undefined],
  ['x', ['Foo'], undefined],
  [['Foo'], 'x', undefined],

  [['Add', 'x', 1], ['Add', 'x', 1], 0],
  [['Add', 1, 'x'], ['Add', 'x', 1], -1],
];

describe.skip('COMPARE', () => {
  for (const expr of exprs) {
    test(`equal(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.compare(expr[0], expr[1])).toEqual(expr[2]);
    });
  }
});

describe.skip('EQUAL', () => {
  for (const expr of exprs) {
    test(`equal(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.equal(expr[0], expr[1])).toEqual(
        expr[2] === undefined ? undefined : expr[2] === 0 ? true : false
      );
    });
  }
});

describe.skip('LESS THAN', () => {
  for (const expr of exprs) {
    test(`less(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.less(expr[0], expr[1])).toEqual(
        expr[2] === undefined ? undefined : expr[2] < 0 ? true : false
      );
    });
  }
});

describe.skip('LESS EQUAL', () => {
  for (const expr of exprs) {
    test(`lessEqual(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.lessEqual(expr[0], expr[1])).toEqual(
        expr[2] === undefined ? undefined : expr[2] <= 0 ? true : false
      );
    });
  }
});

describe.skip('GREATER', () => {
  for (const expr of exprs) {
    test(`greater(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.greater(expr[0], expr[1])).toEqual(
        expr[2] === undefined ? undefined : expr[2] > 0 ? true : false
      );
    });
  }
});

describe.skip('GREATER EQUAL', () => {
  for (const expr of exprs) {
    test(`greaterEqual(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.greaterEqual(expr[0], expr[1])).toEqual(
        expr[2] === undefined ? undefined : expr[2] >= 0 ? true : false
      );
    });
  }
});
