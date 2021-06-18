import { ComputeEngine, match } from '../src/compute-engine';
import { Expression } from '../src/public';
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
    ['Add', 1, 'x'],
    ['Add', 'x', 1],
  ],
  [{ fn: ['Add', 'x', 1] }, ['Add', 'x', 1]],
  [{ dict: { Alpha: 'a', Beta: 'b' } }, { dict: { Alpha: 'a', Beta: 'b' } }],
];

const notSameExprs: Expression[] = [
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
  [
    { dict: { Alpha: 'a', Beta: 'b' } },
    { dict: { Alpha: 'a', Beta: 'b', Gamma: 'g' } },
  ],
  [{ dict: { Alpha: 'a', Beta: 'b' } }, { dict: { Alpha: 'a', Beta: 'c' } }],
  ['Nothing', { dict: { Alpha: 'a', Beta: 'b', Gamma: 'g' } }],
  [['Add', 2, 'x'], { dict: { Alpha: 'a', Beta: 'b', Gamma: 'g' } }],
];

describe('MATCH', () => {
  for (const expr of sameExprs) {
    test(`match(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(
        match(engine.canonical(expr[0])!, engine.canonical(expr[1])!) !== null
      ).toBeTruthy();
    });
  }
});

describe('NOT SAME', () => {
  for (const expr of notSameExprs) {
    test(`match(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(
        match(engine.canonical(expr[0])!, engine.canonical(expr[1])!)
      ).toBeNull();
    });
  }
});
