import { ComputeEngine } from '../src/math-json';
import { latex } from './utils';

export const engine = new ComputeEngine();

const TOLERANCE = 2.220446049250313e-16;

const sameExprs = [
  [1, 1],
  [3.14159265, 3.14159265],
  [3.14159265, { num: '3.14159265' }],
  [{ num: '3.14159265' }, { num: '3.14159265' }],
  [3.14159265, { num: '+3.14159265' }],
  [3.14159265, 3.14159265 + TOLERANCE],
  [7, 7],

  ['Pi', 'Pi'],
  ['Pi', { sym: 'Pi' }],
  [{ sym: 'Pi' }, { sym: 'Pi', wikidata: 'Q167' }],

  [
    ['Add', 'x', 1],
    ['Add', 'x', 1],
  ],
  [{ fn: ['Add', 'x', 1] }, ['Add', 'x', 1]],
];

const notSameExprs = [
  [1, 0],
  [2, 5],

  [1, 'Pi'],
  ['Pi', 1],

  [1, 'x'],
  ['x', 1],
  ['x', 'y'],
  ['x', ['Foo']],
  [['Foo'], 'x'],

  [
    { sym: 'Pi', wikidata: 'Q168' }, // Greek letter π
    { sym: 'Pi', wikidata: 'Q167' }, // 3.14159265...
  ],

  [
    ['Add', 1, 'x'],
    ['Add', 'x', 1],
  ],
  [
    ['Add', 1],
    ['Add', 1, 2],
  ],
  [
    ['Add', 1, 2, 3],
    ['Add', 1, 2],
  ],
  [
    ['Add', 1, 2, 3],
    ['Add', 1, 2, 4],
  ],
];

describe('SAME', () => {
  for (const expr of sameExprs) {
    test(`same(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.same(expr[0], expr[1])).toBeTruthy();
    });
  }
});

describe('NOT SAME', () => {
  for (const expr of notSameExprs) {
    test(`same(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.same(expr[0], expr[1])).toBeFalsy();
    });
  }
});
