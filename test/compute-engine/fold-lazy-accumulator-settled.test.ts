import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

/**
 * Issue #444: a `Fold` whose step wraps the accumulator in a lazy view
 * (`Join(acc, Map(k ↦ … acc …, 1..3))`) doubled its cost at each step. The
 * step substitutes the VALUE of the accumulator into the new row, so the row
 * held a copy of the previous accumulator, which held the copies the earlier
 * steps made. The accumulator is now a value between two steps: a step result
 * that is a finite lazy view is listed into the literal of its kind
 * (`settledAccumulator`, `library/collections.ts`).
 *
 * The tests assert on structure and on callback counts, never on time: the
 * suite runs under load on a shared machine.
 */

const row = [
  'Map',
  [
    'Function',
    [
      'Add',
      [
        'At',
        ['Take', ['Drop', 'acc', ['Multiply', ['Subtract', 'i', 1], 3]], 3],
        'k',
      ],
      1,
    ],
    'k',
  ],
  ['Range', 1, 3, 1],
];

const issueFold = (n: number) => [
  'Fold',
  ['Function', ['Join', 'acc', row], 'acc', 'i'],
  ['List', 0, 0, 0],
  ['Range', 1, n, 1],
];

const expectedRows = (n: number): number[] => {
  const xs: number[] = [0, 0, 0];
  for (let i = 1; i <= n; i++) xs.push(i, i, i);
  return xs;
};

/** The number of nodes of the expression tree, each shared node counted at
 * each of its positions, as every structural walk costs. */
const treeSize = (x: Expression): number => {
  let n = 0;
  const walk = (e: Expression) => {
    n += 1;
    if ('ops' in e && Array.isArray(e.ops)) for (const op of e.ops) walk(op);
  };
  walk(x);
  return n;
};

describe('a fold whose step wraps the accumulator in a lazy view (issue #444)', () => {
  const ce = new ComputeEngine();

  test('the result is the listed value, not a view holding every earlier accumulator', () => {
    const r = ce.box(issueFold(8)).evaluate();
    expect(r.operator).toBe('List');
    expect(r.json).toEqual(['List', ...expectedRows(8)]);
    // One `List` node and its 27 number elements: the tree grows by three
    // nodes per step, where it doubled (5742 nodes at n = 8).
    expect(treeSize(r)).toBe(1 + 27);
    // Row 8 holds the last three cells, 25 to 27.
    expect(ce.function('At', [r, 27]).evaluate().json).toBe(8);
  });

  test('the row callback runs once per cell, at the step', () => {
    let ticks = 0;
    const engine = new ComputeEngine();
    engine.declare('Tick', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        ticks += 1;
        return x;
      },
    });
    const tickedRow = [
      'Map',
      ['Function', ['Tick', ['Add', ['At', 'acc', 'k'], 'i']], 'k'],
      ['Range', 1, 3, 1],
    ];
    const r = engine
      .box([
        'Fold',
        ['Function', ['Join', 'acc', tickedRow], 'acc', 'i'],
        ['List', 0, 0, 0],
        ['Range', 1, 5, 1],
      ])
      .evaluate();
    expect(r.operator).toBe('List');
    expect(ticks).toBe(15);
    // A later read of the value calls nothing. Each row reads the first
    // cell of the accumulator, `0`, so row `i` is `[i, i, i]`.
    expect(engine.function('At', [r, 18]).evaluate().json).toBe(5);
    expect(ticks).toBe(15);
  });

  test('the asynchronous route answers the same value', async () => {
    const r = await ce.box(issueFold(5)).evaluateAsync();
    expect(r.json).toEqual(['List', ...expectedRows(5)]);
  });

  test('`.N()` answers the listed value with numeric elements', () => {
    const r = ce.box(issueFold(4)).N();
    expect(r.operator).toBe('List');
    expect(r.ops!.map((x) => x.re)).toEqual(expectedRows(4));
  });

  test('a step that builds a lazy view over a finite source answers the listed value', () => {
    const r = ce
      .box([
        'Fold',
        ['Function', ['Take', 'a', 'k'], 'a', 'k'],
        ['Range', 1, 10],
        ['List', 3, 2],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 1, 2]);
    const nested = ce
      .box([
        'Fold',
        [
          'Function',
          ['Map', ['Function', ['Multiply', 'x', 'k'], 'x'], 'a'],
          'a',
          'k',
        ],
        ['List', 1, 2],
        ['List', 2, 3],
      ])
      .evaluate();
    expect(nested.json).toEqual(['List', 6, 12]);
  });

  test('a view over an infinite source keeps its lazy form', () => {
    const r = ce
      .box([
        'Fold',
        [
          'Function',
          ['Map', ['Function', ['Multiply', 'x', 'k'], 'x'], 'a'],
          'a',
          'k',
        ],
        ['Range', 1, 1000000000],
        ['List', 2, 3],
      ])
      .evaluate();
    expect(r.operator).toBe('Map');
    expect(ce.function('At', [r, 2]).evaluate().json).toBe(12);
  });

  test('a set-kind accumulator is listed into a `Set`', () => {
    const r = ce
      .box([
        'Fold',
        ['Function', ['Join', 'a', ['Set', 'k', 1]], 'a', 'k'],
        ['Set'],
        ['List', 2, 3],
      ])
      .evaluate();
    expect(r.operator).toBe('Set');
    expect([...r.ops!.map((x) => x.re)].sort()).toEqual([1, 2, 3]);
  });

  test('a keyed accumulator is listed into a `Dictionary` with the merged entries', () => {
    const r = ce
      .box([
        'Fold',
        [
          'Function',
          ['Join', 'a', ['Dictionary', ['Tuple', { str: 'b' }, 'k']]],
          'a',
          'k',
        ],
        ['Dictionary', ['Tuple', { str: 'a' }, 1]],
        ['List', 2, 3],
      ])
      .evaluate();
    expect(r.operator).toBe('Dictionary');
    expect(r.toString()).toBe('{"a" -> 1, "b" -> 3}');
  });

  test('an impure row is listed at the step, so the value is stable on later reads', () => {
    const r = ce
      .box([
        'Fold',
        [
          'Function',
          [
            'Join',
            'a',
            ['Map', ['Function', ['Random'], 'u'], ['Range', 1, 2]],
          ],
          'a',
          'k',
        ],
        ['List'],
        ['Range', 1, 2],
      ])
      .evaluate();
    expect(r.operator).toBe('List');
    expect(r.nops).toBe(4);
    const first = ce.function('At', [r, 1]).evaluate().re;
    expect(ce.function('At', [r, 1]).evaluate().re).toBe(first);
  });

  test('an accumulator past the collection size cap keeps its view', () => {
    const engine = new ComputeEngine();
    engine.maxCollectionSize = 10;
    const r = engine
      .box([
        'Fold',
        ['Function', ['Join', 'a', ['Range', 1, 6]], 'a', 'k'],
        ['List'],
        ['Range', 1, 2],
      ])
      .evaluate();
    // The first step lists six elements; the second would list twelve.
    expect(r.operator).toBe('Join');
    expect(r.ops![0].json).toEqual(['List', 1, 2, 3, 4, 5, 6]);
    expect(engine.function('At', [r, 12]).evaluate().json).toBe(6);
  });

  test('a `Range` step result is kept as the compact range', () => {
    const r = ce
      .box([
        'Fold',
        ['Function', ['Range', 1, ['Multiply', 1000, 'k']], 'a', 'k'],
        0,
        ['List', 1, 5],
      ])
      .evaluate();
    expect(r.operator).toBe('Range');
    expect(r.json).toEqual(['Range', 1, 5000]);
  });

  test('a step past the cap runs no callback of the new row', () => {
    let ticks = 0;
    const engine = new ComputeEngine();
    engine.maxCollectionSize = 10;
    engine.declare('Tick', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        ticks += 1;
        return x;
      },
    });
    const r = engine
      .box([
        'Fold',
        [
          'Function',
          [
            'Join',
            'a',
            ['Map', ['Function', ['Tick', 'x'], 'x'], ['Range', 1, 6]],
          ],
          'a',
          'k',
        ],
        ['List'],
        ['Range', 1, 3],
      ])
      .evaluate();
    // The first step lists six cells. The second and the third would list
    // twelve and eighteen, past the cap of ten: the cheap counts of the
    // operands decide before any walk, so their rows run no callback.
    expect(r.operator).toBe('Join');
    expect(ticks).toBe(6);
  });

  test('an empty tuple operand counts as one element in the size bound', () => {
    const engine = new ComputeEngine();
    engine.maxCollectionSize = 2;
    // A tuple operand is one element of a join, whatever its own count:
    // `Join([], (), Map(u ↦ Random(), 1..2))` would hold three elements,
    // past a cap of two, so the view is kept and the random row never runs.
    let draws = 0;
    engine.declare('Draw', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        draws += 1;
        return x;
      },
    });
    const r = engine
      .box([
        'Fold',
        [
          'Function',
          [
            'Join',
            'a',
            ['Tuple'],
            ['Map', ['Function', ['Draw', ['Random']], 'u'], ['Range', 1, 2]],
          ],
          'a',
          'k',
        ],
        ['List'],
        ['Range', 1, 1],
      ])
      .evaluate();
    expect(r.operator).toBe('Join');
    expect(draws).toBe(0);
  });

  test('a list literal holding an impure join lists it when a callback-free bound fits', () => {
    const engine = new ComputeEngine();
    engine.assign('xs', engine.box(['List', 1, 2]));
    const r = engine
      .box([
        'List',
        ['Join', 'xs', ['Map', ['Function', ['Random'], 'u'], ['Range', 1, 2]]],
      ])
      .evaluate();
    expect(r.ops![0].operator).toBe('List');
    expect(r.ops![0].nops).toBe(4);
  });

  test('`Scan` settles each cumulative element the same way', () => {
    const r = ce
      .box([
        'Scan',
        ['List', 1, 2],
        [
          'Function',
          ['Join', 'a', ['Map', ['Function', ['Add', 'x', 'k'], 'x'], 'a']],
          'a',
          'k',
        ],
        ['List', 0],
      ])
      .evaluate();
    const second = ce.function('At', [r, 2]).evaluate();
    expect(second.operator).toBe('List');
    expect(second.json).toEqual(['List', 0, 1, 2, 3]);
    expect(r.evaluate({ materialization: true }).json).toEqual([
      'List',
      ['List', 0, 1],
      ['List', 0, 1, 2, 3],
    ]);
  });
});
