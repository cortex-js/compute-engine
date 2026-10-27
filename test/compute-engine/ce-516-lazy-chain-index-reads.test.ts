import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

//
// CE-516 (Tycho row 453): a chain of lazy `Map`/`Zip` collections that read
// each other through index lists (`A[I]`) computed each inner element again
// for each outer element. The number of `Map` element computations for the
// first read of the chain below was 160, 6 880 and 282 560 at depths 2, 3 and
// 4. An `at()` read of a pure lazy instance now keeps the element it computes
// in the element memo of the instance (`elementMemoComputeCell`,
// `boxed-expression/collection-element-memo.ts`), so the count grows
// linearly with the depth.
//
// These tests assert the number of calls of the `at` handler of `Map`, never
// the elapsed time, and they check every value against a JavaScript
// reference.
//

const N = 20;
// Cycles (1 … 9), (10), (11 … 15), (16 17), (18 19), (20).
const PERMUTATION = [
  2, 3, 4, 5, 6, 7, 8, 9, 1, 10, 12, 13, 14, 15, 11, 17, 16, 19, 18, 20,
];

/** JavaScript reference of `C_0` for a chain of `depth` levels over the
 * permutation `p` (1-based lists). */
function reference(depth: number, p: number[]): number[] {
  const L = Array.from({ length: N }, (_, k) => k + 1);
  const at = (A: number[], idx: number[]) => idx.map((i) => A[i - 1]);
  const max = (A: number[], B: number[]) => A.map((a, k) => Math.max(a, B[k]));
  const I = [...L].sort((a, b) => p[a - 1] - p[b - 1]);
  let C = max(I, max(L, p));
  for (let k = 1; k < depth; k++) C = max(at(C, I), max(C, at(C, p)));
  const U = [...new Set(C)];
  return C.map((c) => U.indexOf(c) + 1);
}

type MapHandlers = { at?: (...args: unknown[]) => unknown };

/** Wrap the `at` handler of `Map` on `ce` to count its calls. */
function countMapReads(ce: ComputeEngine): {
  reads: () => number;
  restore: () => void;
} {
  const def = ce.lookupDefinition('Map') as
    | { operator?: { collection?: MapHandlers } }
    | undefined;
  const handlers = def?.operator?.collection;
  const original = handlers?.at;
  if (handlers === undefined || typeof original !== 'function')
    throw new Error('Map has no `at` collection handler to count');
  let reads = 0;
  handlers.at = (...args: unknown[]) => {
    reads += 1;
    return original.apply(handlers, args);
  };
  return {
    reads: () => reads,
    restore: () => {
      handlers.at = original;
    },
  };
}

/** The definitions of the Tycho document `neyret/frqpa78i6s`, with a chain
 * of `depth` levels (the MathJSON that the Tycho import stores). */
function chainEngine(depth: number): ComputeEngine {
  const ce = new ComputeEngine();
  const maxOfPair = (v: string) => [
    'Function',
    ['Block', ['ElementMax', ['At', v, 1], ['At', v, 2]]],
    v,
  ];
  const level = (prev: string, name: string) =>
    ce.declare(name, {
      type: 'list',
      value: ce.box([
        'Map',
        maxOfPair('W'),
        [
          'Zip',
          ['At', prev, 'I'],
          ['Map', maxOfPair('Z'), ['Zip', prev, ['At', prev, 'L_1']]],
        ],
      ] as never),
    });
  ce.declare('N', 'real');
  ce.declare('L', { type: 'list<integer>', value: ce.box(['Range', 1, 'N']) });
  ce.declare('L_1', { type: 'list', value: ce.box(['List', ...PERMUTATION]) });
  ce.declare('I', {
    type: 'list',
    value: ce.box(['At', 'L', ['Ordering', 'L_1']]),
  });
  ce.declare('A_1', {
    type: 'list',
    value: ce.box([
      'Map',
      maxOfPair('W'),
      ['Zip', 'I', ['Map', maxOfPair('Z'), ['Zip', 'L', 'L_1']]],
    ] as never),
  });
  for (let k = 2; k <= depth; k++) level(`A_${k - 1}`, `A_${k}`);
  ce.declare('U', { type: 'list', value: ce.box(['Unique', `A_${depth}`]) });
  ce.declare('C_0', {
    value: ce.box([
      'Sum',
      ['Which', ['Equal', `A_${depth}`, ['At', 'U', 'i']], 'i', 'True', 0],
      ['Limits', 'i', 1, ['Length', 'U']],
    ]),
  });
  ce.assign('N', N);
  return ce;
}

function readC0(ce: ComputeEngine, k: number): number {
  return ce.box(['At', 'C_0', k]).evaluate().re;
}

/** The `Map` element computations of the first read `C_0[1]`, and whether
 * every value `C_0[1]` … `C_0[N]` matches the reference. */
function firstReadCount(depth: number): { reads: number; values: number[] } {
  const ce = chainEngine(depth);
  const counter = countMapReads(ce);
  try {
    const values = [readC0(ce, 1)];
    const reads = counter.reads();
    for (let k = 2; k <= N; k++) values.push(readC0(ce, k));
    return { reads, values };
  } finally {
    counter.restore();
  }
}

describe('CE-516: chained lazy collections read by index', () => {
  test('one more level of the chain adds a bounded number of reads', () => {
    const d3 = firstReadCount(3);
    const d4 = firstReadCount(4);
    expect(d3.values).toEqual(reference(3, PERMUTATION));
    expect(d4.values).toEqual(reference(4, PERMUTATION));
    // Before the fix: 6 880 and 282 560 reads. A linear evaluation reads
    // each of the 20 elements of the two `Map`s of a level a bounded number
    // of times (measured: 100 and 160).
    expect(d3.reads).toBeGreaterThan(0);
    expect(d4.reads).toBeLessThanOrEqual(3 * d3.reads);
    expect(d4.reads).toBeLessThanOrEqual(8 * 4 * N);
  });

  test('a write to a dependency of the chain is honored', () => {
    const ce = chainEngine(3);
    expect(Array.from({ length: N }, (_, k) => readC0(ce, k + 1))).toEqual(
      reference(3, PERMUTATION)
    );
    // Another permutation: the cycles (1 2), (3 … 20).
    const other = [
      2, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 3,
    ];
    ce.assign('L_1', ce.box(['List', ...other]));
    expect(Array.from({ length: N }, (_, k) => readC0(ce, k + 1))).toEqual(
      reference(3, other)
    );
  });
});

describe('CE-516: the element memo of an at() read', () => {
  const ce = new ComputeEngine();

  test('a second at() of the same position computes nothing', () => {
    const xs = ce.box([
      'Map',
      ['Function', ['Add', 'x', 1], 'x'],
      ['List', 1, 2, 3],
    ]) as Expression;
    const counter = countMapReads(ce);
    try {
      expect(xs.at(2)?.toString()).toBe('3');
      expect(xs.at(2)?.toString()).toBe('3');
      expect(xs.at(3)?.toString()).toBe('4');
      expect(counter.reads()).toBe(2);
    } finally {
      counter.restore();
    }
  });

  test('an assignment to a free symbol of the callback is honored', () => {
    ce.declare('c', { type: 'integer', value: 1 });
    const xs = ce.box([
      'Map',
      ['Function', ['Add', 'x', 'c'], 'x'],
      ['List', 1, 2, 3],
    ]) as Expression;
    expect(xs.at(2)?.toString()).toBe('3');
    ce.assign('c', 10);
    expect(xs.at(2)?.toString()).toBe('12');
    expect(ce.box(['At', xs, 2]).evaluate().toString()).toBe('12');
  });

  test('an assignment to the source of a view is honored', () => {
    ce.declare('ys', { type: 'list', value: ce.box(['List', 1, 2, 3]) });
    const xs = ce.box([
      'Map',
      ['Function', ['Multiply', 'x', 2], 'x'],
      'ys',
    ]) as Expression;
    expect(xs.at(3)?.toString()).toBe('6');
    ce.assign('ys', ce.box(['List', 5, 6, 7]));
    expect(xs.at(3)?.toString()).toBe('14');
  });

  test('a map over an infinite range stays lazy', () => {
    const xs = ce.box([
      'Map',
      ['Function', ['Square', 'x'], 'x'],
      ['Range', 1, 'PositiveInfinity'],
    ]) as Expression;
    expect(xs.isFiniteCollection).toBe(false);
    expect(xs.at(5)?.toString()).toBe('25');
    expect(xs.at(1000)?.toString()).toBe('1000000');
    expect(xs.at(5)?.toString()).toBe('25');
  });

  test('an impure instance draws again at each at() read', () => {
    // The memo keeps an at() element of a PURE instance only: a later
    // complete walk of an impure instance draws again, and an element kept
    // from an at() read would disagree with it.
    const xs = ce.box([
      'Map',
      ['Function', ['Add', 'x', ['Random']], 'x'],
      ['List', 1, 2, 3],
    ]) as Expression;
    expect(xs.isPure).toBe(false);
    const counter = countMapReads(ce);
    try {
      xs.at(1);
      xs.at(1);
      expect(counter.reads()).toBe(2);
    } finally {
      counter.restore();
    }
  });
});
