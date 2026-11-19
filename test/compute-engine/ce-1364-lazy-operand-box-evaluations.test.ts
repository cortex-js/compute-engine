/**
 * CE-1364. Boxing a numeric operator over a lazy view asked whether the view
 * was a finite indexed collection before it asked whether it was lazy
 * (`inferNumericArgs()`, `couldBeUnkeyedCollectionOperand()`). The count of
 * `Range(1, Length(C))` reads its bounds with `.N()`, so each of those tests
 * evaluated `C`: five times for `Add`, ten times for `Sin` of a `Map`. A
 * document that built `C` by a long recursion froze when the expression was
 * created.
 *
 * `Spy` counts the evaluations of `C`. Boxing evaluates nothing; the values
 * of the evaluation are unchanged.
 */
import { ComputeEngine } from '../../src/compute-engine';

function engine() {
  const ce = new ComputeEngine();
  const counter = { calls: 0 };
  ce.declare('Spy', {
    signature: '(list<number>) -> list<number>',
    evaluate: (ops) => {
      counter.calls += 1;
      return ops[0].evaluate();
    },
  });
  ce.declare('C', {
    type: 'list<number>',
    value: ce.box(['Spy', ['List', 7, 8, 9]]),
  });
  return { ce, counter };
}

const range = ['Range', 1, ['Length', 'C']];
const map = [
  'Map',
  ['Function', ['At', 'C', 'j'], 'j'],
  ['Range', 1, ['Length', 'C'], 1],
];

describe('CE-1364: BOXING OVER A LAZY VIEW EVALUATES NO SOURCE', () => {
  test.each([
    ['Add', ['Add', 1, range], '[2,3,4]'],
    ['Multiply', ['Multiply', 2, range], '[2,4,6]'],
    ['Negate', ['Negate', range], '[-1,-2,-3]'],
    ['Divide', ['Divide', 1, range], '[1,1/2,1/3]'],
    ['Sin of a Map', ['Sin', map], '[sin(7),sin(8),sin(9)]'],
    ['Divide of a Map', ['Divide', 1, map], '[1/7,1/8,1/9]'],
    ['Conjugate', ['Conjugate', range], '[1,2,3]'],
  ] as const)('%s', (_name, json, value) => {
    const { ce, counter } = engine();
    const expr = ce.box(json as any);
    expect(counter.calls).toBe(0);
    expect(expr.evaluate().toString()).toBe(value);
  });

  test('Add of a symbol whose value is the Range', () => {
    const { ce, counter } = engine();
    ce.declare('R', { type: 'list<integer>', value: ce.box(range as any) });
    counter.calls = 0;
    const expr = ce.box(['Add', 'x', 'R']);
    expect(counter.calls).toBe(0);
    expect(expr.subs({ x: 1 }).evaluate().toString()).toBe('[2,3,4]');
  });
});
