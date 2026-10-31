/**
 * On `interval-js`, a `Loop` or a `Comprehension` over a collection input
 * `L` declared `list<number>` gave a wrong value. `run()` converts each
 * element of a list input to a `{lo, hi}` interval, and the loop body wrapped
 * the loop variable again as `_IA.point(k)`: an interval whose bounds are
 * objects. With `L = [1, 2, 3]`, the `Loop` row gave the bounds
 * `"5[object Object][object Object][object Object]"` and the
 * `Comprehension` row gave `empty` for each element. Now only a loop
 * variable over a `Range` is wrapped, because the iterable of a `Range` is
 * the one source that emits plain numbers (`compileElementLoops` in
 * `base-compiler.ts`).
 *
 * When `L` is absent, the run has no value, as on the JavaScript target:
 * the code answers `empty` before it runs (the `collectionReadInputs` test
 * in `compileToIntervalTarget`, `interval-javascript-target.ts`). Before,
 * the `Loop` answered `entire` and `Sum(L)` answered `undefined`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const LOOP = [
  'Block',
  ['Assign', 'c', 5],
  ['Loop', ['Assign', 'c', ['Add', 'c', 'k']], ['Element', 'k', 'L']],
  'c',
];
const COMPREHENSION = [
  'Comprehension',
  ['Multiply', 2, 'k'],
  ['Element', 'k', 'L'],
];

function compiled(json: unknown) {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<number>');
  const result = compile(ce.box(json as any), { to: 'interval-js' });
  expect(result.success).toBe(true);
  return result;
}

/** The value of the interpreter with `L = [1, 2, 3]`. A `Comprehension`
 * stays a lazy collection, so a collection value is read element by
 * element. */
function interpret(json: unknown): unknown {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<number>');
  ce.assign('L', ce.box(['List', 1, 2, 3]));
  const value = ce.box(json as any).evaluate();
  return value.isCollection ? [...value.each()].map((x) => x.json) : value.json;
}

const point = (v: number) => ({ kind: 'interval', value: { lo: v, hi: v } });

describe('interval-js: a loop over a list input', () => {
  test('Loop: the elements are the point intervals of L', () => {
    expect(interpret(LOOP)).toBe(11);
    expect(compiled(LOOP).run!({ L: [1, 2, 3] })).toEqual(point(11));
  });

  test('Comprehension: each element is a point interval', () => {
    expect(interpret(COMPREHENSION)).toEqual([2, 4, 6]);
    expect(compiled(COMPREHENSION).run!({ L: [1, 2, 3] })).toEqual([
      point(2),
      point(4),
      point(6),
    ]);
  });

  test('an element given as an interval is not wrapped again', () => {
    expect(compiled(LOOP).run!({ L: [{ lo: 1, hi: 2 }, 3] as any })).toEqual({
      kind: 'interval',
      value: { lo: 9, hi: 10 },
    });
  });

  test('a caller-mapped source of plain numbers is wrapped at its use', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const fn = compile(ce.box(LOOP as any), {
      to: 'interval-js',
      vars: { L: '[1, 2, 3]' },
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual(point(11));
  });

  test('a mapping to the vars-object spelling is still tested', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const fn = compile(ce.box(['Sum', 'L']), {
      to: 'interval-js',
      vars: { L: '_.L' },
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual({ kind: 'empty' });
    expect(fn.run!({ L: [1, 2, 3] })).toEqual(point(6));
  });

  test('a loop over a Range still wraps its plain-number counter', () => {
    const json = [
      'Block',
      ['Assign', 'c', 0],
      [
        'Loop',
        ['Assign', 'c', ['Add', 'c', 'k']],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      'c',
    ];
    expect(compiled(json).run!({})).toEqual(point(6));
  });

  test.each([
    ['Loop', LOOP],
    ['Comprehension', COMPREHENSION],
    ['Sum', ['Sum', 'L']],
  ])('%s with L absent has no value', (_name, json) => {
    expect(compiled(json).run!({})).toEqual({ kind: 'empty' });
  });
});

/** `Block(c := 0, Loop(c := c + body, ...clauses), c)`. */
function sumLoop(body: unknown, ...clauses: unknown[]) {
  return [
    'Block',
    ['Assign', 'c', 0],
    ['Loop', ['Assign', 'c', ['Add', 'c', body]], ...clauses],
    'c',
  ];
}

describe('interval-js: a loop over a literal collection', () => {
  // The interval target spells a literal collection only where it is
  // consumed whole (`CompileTarget.compileCollectionValue`); a loop source
  // is such a position.
  test.each([
    ['List', ['List', 1, 2, 3], 6],
    ['Tuple', ['Tuple', 1, 2, 3], 6],
    [
      'Map',
      ['Map', ['Function', ['Multiply', 2, 'u'], 'u'], ['List', 1, 2, 3]],
      12,
    ],
  ])('a %s source', (_name, source, value) => {
    const json = sumLoop('k', ['Element', 'k', source]);
    expect(interpret(json)).toBe(value);
    expect(compiled(json).run!({})).toEqual(point(value as number));
  });

  test('a symbol whose assigned value is a list', () => {
    const ce = new ComputeEngine();
    ce.assign('A', ce.box(['List', 1, 2, 3]));
    const fn = compile(ce.box(sumLoop('k', ['Element', 'k', 'A']) as any), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual(point(6));
  });

  test('a list of lists: each element is an array of intervals', () => {
    const json = sumLoop(
      ['Sum', 'k'],
      ['Element', 'k', ['List', ['List', 1, 2], ['List', 3, 4]]]
    );
    expect(compiled(json).run!({})).toEqual(point(10));
  });

  test('an inner literal list that reads the outer loop variable', () => {
    // j runs over [1, 2], then over [1, 3].
    const json = sumLoop(
      'j',
      ['Element', 'k', 'L'],
      ['Element', 'j', ['List', 1, 'k']]
    );
    expect(compiled(json).run!({ L: [2, 3] })).toEqual(point(7));
  });

  test('a Map and a Tuple whose elements read an input', () => {
    // An input keeps the constant pass from computing the source, so the
    // run-time spelling of the `Map` and of the `Tuple` runs.
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    const map = sumLoop('k', [
      'Element',
      'k',
      ['Map', ['Function', ['Multiply', 2, 'u'], 'u'], ['List', 1, 'n', 3]],
    ]);
    const tuple = sumLoop('k', ['Element', 'k', ['Tuple', 1, 'n', 3]]);
    for (const [json, value] of [
      [map, 18],
      [tuple, 9],
    ] as const) {
      const fn = compile(ce.box(json as any), { to: 'interval-js' });
      expect(fn.success).toBe(true);
      expect(fn.run!({ n: 5 })).toEqual(point(value));
    }
  });

  test.each([
    ['When', ['When', ['List', 1, 2], ['Less', 't', 1]]],
    ['If', ['If', ['Less', 't', 1], ['List', 1, 2], 7]],
  ])(
    'a %s source declines: its value is not always an array',
    (_name, source) => {
      const ce = new ComputeEngine();
      ce.declare('t', 'real');
      const fn = compile(
        ce.box(sumLoop('k', ['Element', 'k', source]) as any),
        { to: 'interval-js', fallback: false }
      );
      expect(fn.success).toBe(false);
    }
  );

  test('a comprehension over a list with an input', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'real');
    const fn = compile(
      ce.box([
        'Comprehension',
        ['Multiply', 2, 'k'],
        ['Element', 'k', ['List', 1, 'n', 3]],
      ]),
      { to: 'interval-js' }
    );
    expect(fn.success).toBe(true);
    expect(fn.run!({ n: 5 })).toEqual([point(2), point(10), point(6)]);
  });
});
