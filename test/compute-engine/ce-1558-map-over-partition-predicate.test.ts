import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * CE-1558: a lazy consumer over the predicate form of `Partition` reads its
 * groups as it reads an equal literal list.
 *
 * The predicate form has no lazy view, and its collection handlers answered
 * "unknown" for every facet. `Map` does not evaluate a source that has
 * collection handlers (`mapSource()`), so `Map(f, Partition(xs, p))` had no
 * count and no finiteness and stayed unevaluated, while the same over
 * `Chunk`, which has no collection handlers, was evaluated. The handlers of
 * the predicate form now read the facets of the value of the call
 * (`partitionPredicateFormHandlers()` in `library/collections.ts`).
 */

const ce = new ComputeEngine();

const len: MathJsonExpression = ['Function', ['Length', 'r'], 'r'];
const lessThan3: MathJsonExpression = ['Function', ['Less', 't', 3], 't'];
const longerThan1: MathJsonExpression = [
  'Function',
  ['Greater', ['Length', 'u'], 1],
  'u',
];

const sources: [string, MathJsonExpression, MathJsonExpression][] = [
  [
    'predicate',
    ['Partition', ['List', 1, 2, 3, 4, 5], lessThan3],
    ['List', ['List', 1, 2], ['List', 3, 4, 5]],
  ],
  [
    'size',
    ['Partition', ['List', 1, 2, 3, 4, 5], 2],
    ['List', ['List', 1, 2], ['List', 3, 4], ['List', 5]],
  ],
  [
    'size and step',
    ['Partition', ['List', 1, 2, 3, 4, 5], 2, 1],
    ['List', ['List', 1, 2], ['List', 2, 3], ['List', 3, 4], ['List', 4, 5]],
  ],
  [
    'Chunk',
    ['Chunk', ['List', 1, 2, 3, 4, 5], 2],
    ['List', ['List', 1, 2, 3], ['List', 4, 5]],
  ],
];

function value(expr: MathJsonExpression): MathJsonExpression {
  return ce.box(expr).evaluate().json;
}

describe('CE-1558: consumers over Partition and Chunk agree with a literal list', () => {
  const consumers: [string, (s: MathJsonExpression) => MathJsonExpression][] = [
    ['Map', (s) => ['ListFrom', ['Map', len, s]]],
    ['At of Map', (s) => ['At', ['Map', len, s], 1]],
    ['Count of Map', (s) => ['Count', ['Map', len, s]]],
    ['Reduce of Map', (s) => ['Reduce', ['Map', len, s], 'Add']],
    ['Sum of Map', (s) => ['Sum', ['Map', len, s]]],
    ['First of Map', (s) => ['First', ['Map', len, s]]],
    ['Filter', (s) => ['ListFrom', ['Filter', s, longerThan1]]],
    ['Count of Filter', (s) => ['Count', ['Filter', s, longerThan1]]],
    ['Reduce', (s) => ['Reduce', s, 'Join']],
    ['Reverse', (s) => ['Reverse', s]],
    ['Count', (s) => ['Count', s]],
  ];
  for (const [form, source, literal] of sources)
    for (const [name, consumer] of consumers)
      test(`${name} over the ${form} form`, () => {
        const expected = value(consumer(literal));
        // The literal list gives a value, so the comparison is not between
        // two unevaluated forms.
        expect(JSON.stringify(expected)).not.toMatch(/Partition|Chunk|Map/);
        expect(value(consumer(source))).toEqual(expected);
      });
});

describe('CE-1558: the predicate form with no value stays unevaluated', () => {
  test('an infinite source', () => {
    const p: MathJsonExpression = [
      'Partition',
      ['Range', 1, 'PositiveInfinity'],
      lessThan3,
    ];
    expect(ce.box(['Count', p]).evaluate().operator).toBe('Count');
    expect(ce.box(['Count', ['Map', len, p]]).evaluate().operator).toBe(
      'Count'
    );
  });

  test('an undecided predicate', () => {
    ce.declare('n', 'integer');
    const p: MathJsonExpression = [
      'Partition',
      ['List', 1, 2, 3],
      ['Function', ['Less', 't', 'n'], 't'],
    ];
    expect(ce.box(['Count', ['Map', len, p]]).evaluate().operator).toBe(
      'Count'
    );
  });

  test('a string source gives groups of strings', () => {
    const isDigit: MathJsonExpression = [
      'Function',
      ['IsSame', 'c', "'1'"],
      'c',
    ];
    expect(
      value(['ListFrom', ['Map', len, ['Partition', { str: 'a1b1' }, isDigit]]])
    ).toEqual(['List', 2, 2]);
  });
});

describe('CE-1558: the size forms keep the handlers of their lazy view', () => {
  test('a size computed by host code is evaluated once per read', () => {
    // A host operator that is not pure counts its evaluations. Each read
    // evaluates the size once, as before the fix: telling the predicate
    // form from the size forms evaluates nothing.
    let calls = 0;
    const te = new ComputeEngine();
    te.declare('ChunkSize', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => te.number(++calls),
    });
    const p = te.box(['Partition', ['List', 1, 2, 3, 4, 5, 6], ['ChunkSize']]);
    calls = 0;
    expect(p.count).toBe(6);
    expect(calls).toBe(1);
    calls = 0;
    expect(p.isFiniteCollection).toBe(true);
    expect(calls).toBe(1);
  });

  test('an invalid size or step answers "unknown" and walks nothing', () => {
    ce.declare('k', 'integer');
    for (const expr of [
      ['Partition', ['List', 1, 2, 3], 0],
      ['Partition', ['List', 1, 2, 3], 'k'],
      ['Partition', ['List', 1, 2, 3], 2, 0],
    ] as MathJsonExpression[]) {
      const p = ce.box(expr);
      expect(p.isCollection).toBe(true);
      expect(p.count).toBeUndefined();
      expect(p.isFiniteCollection).toBeUndefined();
      expect(p.isEmptyCollection).toBeUndefined();
      expect(p.at(1)).toBeUndefined();
      expect([...p.each()]).toEqual([]);
    }
  });
});
