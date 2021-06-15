import { ComputeEngine } from '../src/compute-engine';
import { Expression } from '../src/public';
import { latex } from './utils';

export const engine = new ComputeEngine();

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
      expect(engine.simplify(expr[0])).toEqual(expr[1]);
    });
  }
});
