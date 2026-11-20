/**
 * A parameter of an outer function literal that the body of a literal nested
 * two levels down reads, under a lazy `Map` that `Sum`, `Max` or another
 * reducer holds, was left free: the callback `v ↦ Apply(t ↦ …, v)` is
 * lowered by `Map`, so its own scope is never an activation, and the frame
 * of the inner literal chained to a template that holds no value of the outer
 * parameter (`definingScopeOf`, `function-utils.ts`).
 */
import { ComputeEngine } from '../../src/compute-engine';

const F = (...ops: unknown[]) => ['Function', ...ops];
const RANGE = ['Range', 1, 2];
const LIST = ['List', 2, 3, 4, 4];

// `reduce(Map(v ↦ Apply(t ↦ Length(Filter(s, u ↦ u = t)), v), 1..2), ...rest)`
const outer = (reduce: string, ...rest: unknown[]) => [
  'Apply',
  F(
    [
      reduce,
      [
        'Map',
        F(
          [
            'Apply',
            F(['Length', ['Filter', 's', F(['Equal', 'u', 't'], 'u')]], 't'),
            'v',
          ],
          'v'
        ),
        RANGE,
      ],
      ...rest,
    ],
    ['Typed', 's', "'list<integer>'"]
  ),
  LIST,
];

// From the program that reported it: the argument of the middle literal reads
// `image` too, and the innermost literal reads the middle one's parameter.
const indegree = [
  'Apply',
  F(['If', ['GreaterEqual', 'indegree', 2], 'indegree', 0], 'indegree'),
  ['Count', ['Filter', 'image', F(['Equal', 'u', 'target'], 'u')]],
];
const indegreeSum = [
  'Apply',
  F(
    [
      'Sum',
      ['Map', F(['Apply', F(indegree, 'target'), 'v'], 'v'), ['Range', 1, 4]],
    ],
    'image'
  ),
  LIST,
];

const evaluate = (expr: unknown, canonical = true) =>
  new ComputeEngine().box(expr as any, { canonical }).evaluate().json;

describe('NESTED APPLY OF A FUNCTION LITERAL UNDER A LAZY MAP', () => {
  test('Sum', () => expect(evaluate(outer('Sum'))).toEqual(1));
  test('Max', () => expect(evaluate(outer('Max'))).toEqual(1));
  test('Reduce', () =>
    expect(evaluate(outer('Reduce', 'Add', 0))).toEqual(1));
  test('not canonical', () =>
    expect(evaluate(outer('Sum'), false)).toEqual(1));
  test('indegree sum', () => expect(evaluate(indegreeSum)).toEqual(2));
  test('a literal one level up already worked', () =>
    expect(
      evaluate([
        'Apply',
        F(
          [
            'Sum',
            [
              'Map',
              F(['Length', ['Filter', 's', F(['Equal', 'u', 'v'], 'u')]], 'v'),
              RANGE,
            ],
          ],
          ['Typed', 's', "'list<integer>'"]
        ),
        LIST,
      ])
    ).toEqual(1));
});
