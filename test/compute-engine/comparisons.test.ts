import { ComputeEngine } from '../../src/compute-engine.ts';
import { Expression } from '../../src/math-json/types.ts';
import { latex } from '../utils.ts';

export const engine = new ComputeEngine();

/*
    [a, b, compare(a,b)]
*/
const exprs: [Expression, Expression, number | undefined][] = [
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
];

// describe.skip('COMPARE', () => {
//   for (const expr of exprs) {
//     test(`compare(${latex(expr[0])}, ${latex(expr[1])})`, () => {
//       expect(engine.compare(expr[0], expr[1])).toEqual(expr[2]);
//     });
//   }
// });

describe.skip('EQUAL', () => {
  for (const expr of exprs) {
    test(`equal(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.box(expr[0]).isEqual(engine.box(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] === 0 ? true : false
      );
    });
  }
});

describe.skip('LESS THAN', () => {
  for (const expr of exprs) {
    test(`less(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.box(expr[0]).isLess(engine.box(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] < 0 ? true : false
      );
    });
  }
});

describe.skip('LESS EQUAL', () => {
  for (const expr of exprs) {
    test(`lessEqual(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.box(expr[0]).isLessEqual(engine.box(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] <= 0 ? true : false
      );
    });
  }
});

describe.skip('GREATER', () => {
  for (const expr of exprs) {
    test(`greater(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.box(expr[0]).isGreater(engine.box(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] > 0 ? true : false
      );
    });
  }
});

describe.skip('GREATER EQUAL', () => {
  for (const expr of exprs) {
    test(`greaterEqual(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.box(expr[0]).isGreaterEqual(engine.box(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] >= 0 ? true : false
      );
    });
  }
});
