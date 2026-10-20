import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

//
// A comprehension evaluates the domain of each clause when its elements are
// read. A domain that evaluates to an error value is a failure of the whole
// comprehension, not one of its elements: the error is the value of every
// read that walks the comprehension (`Length`, `Count`, `Sum`, `First`, an
// element read, a materialization), on the synchronous and the
// asynchronous route. A `Loop` over such a domain stops, and the error is
// its value.
//
// Before, the walk gave the error as the only element: `Length` was `1`.
//

const ce = new ComputeEngine();
ce.declare('h', {
  signature: '() -> list<integer>',
  evaluate: () => ce.error('boom'),
});

const isBoom = (x: Expression): boolean =>
  x.operator === 'Error' && JSON.stringify(x.json).includes('boom');

// One clause over the failing domain.
const ONE = ['Comprehension', ['Multiply', 2, 'x'], ['Element', 'x', ['h']]];
// An independent second clause over the failing domain.
const TWO = [
  'Comprehension',
  ['Add', 'x', 'y'],
  ['Element', 'x', ['List', 1, 2]],
  ['Element', 'y', ['h']],
];
// A dependent second clause that fails for the second element of the first
// clause only.
const DEPENDENT = [
  'Comprehension',
  ['Add', 'x', 'y'],
  ['Element', 'x', ['List', 1, 2]],
  ['Element', 'y', ['If', ['Equal', 'x', 2], ['h'], ['List', 5]]],
];

describe('A COMPREHENSION OVER A DOMAIN THAT IS AN ERROR VALUE', () => {
  test.each([
    ['one clause', ONE],
    ['two clauses', TWO],
    ['a dependent clause', DEPENDENT],
  ])('%s: a walk of the comprehension is the error', (_name, c) => {
    for (const op of ['Length', 'Count', 'Sum', 'Max'])
      expect(isBoom(ce.box([op, c] as never).evaluate())).toBe(true);
    expect(isBoom(ce.box(['At', c, 1] as never).evaluate())).toBe(true);
    expect(isBoom(ce.box(c as never).evaluate({ materialization: true }))).toBe(
      true
    );
  });

  test.each([
    ['one clause', ONE],
    ['two clauses', TWO],
    ['a dependent clause', DEPENDENT],
  ])('%s: the asynchronous route agrees', async (_name, c) => {
    for (const op of ['Length', 'Count', 'Sum'])
      expect(isBoom(await ce.box([op, c] as never).evaluateAsync())).toBe(true);
    expect(
      isBoom(await ce.box(c as never).evaluateAsync({ materialization: true }))
    ).toBe(true);
  });

  test('the error is not an element of the comprehension', () => {
    expect([...ce.box(ONE as never).each()]).toEqual([]);
    expect([...ce.box(TWO as never).each()]).toEqual([]);
    // The elements before the failed clause are given as the walk reaches
    // them; the read that walks to the end is the error.
    expect([...ce.box(DEPENDENT as never).each()].map((x) => x.json)).toEqual([
      6,
    ]);
    expect(ce.box(['First', DEPENDENT] as never).evaluate().json).toEqual(6);
  });

  test('a loop over the domain stops, and the error is its value', async () => {
    for (const c of [ONE, TWO, DEPENDENT]) {
      const loop = ['Loop', ['Add', 'x', 1], ...c.slice(2)];
      expect(isBoom(ce.box(loop as never).evaluate())).toBe(true);
      expect(isBoom(await ce.box(loop as never).evaluateAsync())).toBe(true);
    }
  });

  test('a comprehension over a valid domain is not changed', () => {
    const c = [
      'Comprehension',
      ['Multiply', 2, 'x'],
      ['Element', 'x', ['List', 1, 2, 3]],
    ];
    expect(ce.box(['Length', c] as never).evaluate().json).toEqual(3);
    expect(ce.box(['Sum', c] as never).evaluate().json).toEqual(12);
  });
});

describe('A LAZY VIEW OVER A LOCAL OF A FUNCTION BODY READ BEFORE ITS ASSIGNMENT', () => {
  // `n = <read>; t = [1]; n` in the body of a function literal: `t` has no
  // value when the view is read. The error is the value of the read, on the
  // synchronous and the asynchronous route.
  const lambda = ['Function', ['Multiply', 2, 'x'], 'x'];
  const isReadBefore = (x: Expression): boolean =>
    x.operator === 'Error' &&
    JSON.stringify(x.json).includes('read-before-declaration');
  test.each([
    ['Length of a Map', ['Length', ['Map', lambda, 't']]],
    ['Sum of a Map', ['Sum', ['Map', lambda, 't']]],
    ['an element of a Map', ['At', ['Map', lambda, 't'], 1]],
    [
      'Count of a Filter',
      ['Count', ['Filter', 't', ['Function', ['Greater', 'x', 0], 'x']]],
    ],
  ])('%s', async (_name, read) => {
    const fn = ce.box([
      'Function',
      ['Block', ['Assign', 'n', read], ['Assign', 't', ['List', 1]], 'n'],
    ] as never);
    expect(isReadBefore(ce.function('Apply', [fn]).evaluate())).toBe(true);
    expect(isReadBefore(await ce.function('Apply', [fn]).evaluateAsync())).toBe(
      true
    );
  });
});

describe('A DESTRUCTURING CLAUSE OVER AN ELEMENT OF ANOTHER SHAPE', () => {
  // An element that does not match the pattern of the clause is a failed
  // cell of the comprehension, in its position, and the walk goes on, as a
  // `Map` with a destructuring callback does. A `for` loop stops on it.
  const C = [
    'Comprehension',
    ['Add', 'p', 'q'],
    [
      'Element',
      ['Tuple', 'p', 'q'],
      ['List', ['Tuple', 1, 2], 5, ['Tuple', 3, 4]],
    ],
  ];
  const isShapeError = (x: Expression): boolean =>
    x.operator === 'Error' &&
    JSON.stringify(x.json).includes('incompatible-type');

  test('the element is a failed cell, and the walk goes on', () => {
    const elements = [...ce.box(C as never).each()];
    expect(elements).toHaveLength(3);
    expect(elements[0].json).toEqual(3);
    expect(isShapeError(elements[1])).toBe(true);
    expect(elements[2].json).toEqual(7);
    expect(ce.box(['Length', C] as never).evaluate().json).toEqual(3);
    expect(ce.box(['At', C, 3] as never).evaluate().json).toEqual(7);
  });

  test('an operator that demands every cell is the error', () => {
    expect(isShapeError(ce.box(['Sum', C] as never).evaluate())).toBe(true);
  });

  test('a loop stops on the element, and the error is its value', () => {
    const loop = ['Loop', ['Add', 'p', 'q'], ...C.slice(2)];
    expect(isShapeError(ce.box(loop as never).evaluate())).toBe(true);
  });
});
