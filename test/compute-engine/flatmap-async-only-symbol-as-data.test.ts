import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// A `FlatMap` over a finite source whose finiteness is not known (the
// callback result is typed as a list of unknown length) is counted and
// listed by one walk of the view (`listedFlatMapView()`,
// `collection-utils.ts`). The synchronous walk declines when the walk
// applies an operator that has only an `evaluateAsync` handler; under
// `evaluateAsync()` the walk awaits the callback, and lists the view when
// only the callback applies such an operator. Before, the synchronous walk
// also declined when the callback held such an operator
// as data: in `x ↦ [x, slowF]` the symbol `slowF` is one element, and it is
// not applied. `Count(FlatMap([1, 2], x ↦ [x, slowF]))` stayed unevaluated
// under `evaluate()` and `evaluateAsync()`, although the materialization of
// the view is `[1, slowF, 2, slowF]`.

const engine = new ComputeEngine();
engine.declare('slowF', {
  signature: '(integer) -> integer',
  evaluateAsync: async (ops, { engine: e }) => e.number(10 * ops[0].re),
});
engine.declare('slowRange', {
  signature: '(integer) -> list<integer>',
  evaluateAsync: async (ops, { engine: e }) =>
    e.function('Range', [e.One, ops[0]]),
});

type Json = Parameters<typeof engine.box>[0];

const show = (x: Expression) => JSON.stringify(x.json);

const DATA_VIEW: Json = [
  'FlatMap',
  ['List', 1, 2],
  ['Function', ['List', 'x', 'slowF'], 'x'],
];

describe('a FlatMap whose callback gives an asynchronous-only symbol as data', () => {
  test('the finiteness of the view is not known', () => {
    expect(engine.box(DATA_VIEW).isFiniteCollection).toBeUndefined();
  });

  test.each([
    ['Count', '4'],
    ['Length', '4'],
    ['ListFrom', '["List",1,"slowF",2,"slowF"]'],
  ])(
    '%s lists the view under evaluate and evaluateAsync',
    async (op, expected) => {
      expect(show(engine.box([op, DATA_VIEW]).evaluate())).toBe(expected);
      expect(show(await engine.box([op, DATA_VIEW]).evaluateAsync())).toBe(
        expected
      );
    }
  );

  test('a symbol as data in one branch of an If is listed', async () => {
    const view: Json = [
      'FlatMap',
      ['List', 1, 2],
      [
        'Function',
        ['If', ['Greater', 'x', 0], ['Range', 1, 'x'], ['List', 'slowF']],
        'x',
      ],
    ];
    expect(show(engine.box(['Count', view]).evaluate())).toBe('3');
    expect(show(await engine.box(['Count', view]).evaluateAsync())).toBe('3');
  });
});

// The views whose walk applies an asynchronous-only operator decline on the
// synchronous route: the synchronous walk cannot run it, so the elements are
// not known. Under `evaluateAsync()`, the walk of `FlatMap` awaits its
// callback, so a callback that applies the operator is listed. A callback
// result that is itself a view (`Map(slowF, Range(1, x))`) has elements that
// are computed synchronously when they are read: that view still declines on
// both routes.
describe('a FlatMap whose walk applies an asynchronous-only operator', () => {
  test.each([
    ['an application in the callback', ['Function', ['slowRange', 'x'], 'x']],
    ['the callback given by name', 'slowRange'],
  ] as [string, Json][])(
    '%s: Count stays unevaluated, and is 3 under evaluateAsync',
    async (_, fn) => {
      const json: Json = ['Count', ['FlatMap', ['List', 1, 2], fn]];
      expect(engine.box(json).evaluate().operator).toBe('Count');
      expect(show(await engine.box(json).evaluateAsync())).toBe('3');
    }
  );

  test('a symbol at the callback parameter of Map: Count stays unevaluated', async () => {
    const fn: Json = ['Function', ['Map', 'slowF', ['Range', 1, 'x']], 'x'];
    const json: Json = ['Count', ['FlatMap', ['List', 1, 2], fn]];
    expect(engine.box(json).evaluate().operator).toBe('Count');
    expect((await engine.box(json).evaluateAsync()).operator).toBe('Count');
  });
});

// A named user function whose body gives the symbol as data is examined by
// the same rule as an inline callback: its body is `[x, slowF]`, and `slowF`
// is not applied.
test('a named callback whose body gives the symbol as data is listed', async () => {
  const ce = new ComputeEngine();
  ce.declare('slowF', {
    signature: '(integer) -> integer',
    evaluateAsync: async (ops, { engine: e }) => e.number(10 * ops[0].re),
  });
  ce.declare('f', '(integer) -> list');
  ce.assign('f', ce.box(['Function', ['List', 'x', 'slowF'], 'x']));
  const json: Json = ['Count', ['FlatMap', ['List', 1, 2], 'f']];
  expect(show(ce.box(json).evaluate())).toBe('4');
  expect(show(await ce.box(json).evaluateAsync())).toBe('4');
});

// `IsEmpty` walks the view up to its first element, with the same check.
test('IsEmpty of a view that gives the symbol as data is False', async () => {
  const json: Json = ['IsEmpty', DATA_VIEW];
  expect(show(engine.box(json).evaluate())).toBe('"False"');
  expect(show(await engine.box(json).evaluateAsync())).toBe('"False"');
});

// The source of the view is examined too. The synchronous `Map` gives the
// distinct unevaluated elements `slowF(1)` and `slowF(2)`, but `slowF`
// returns `0` for both, so the set of values has one element. A count of the
// unevaluated source would be wrong: the view stays unevaluated.
test('a source that applies an asynchronous-only symbol is not listed', async () => {
  const ce = new ComputeEngine();
  ce.declare('slowF', {
    signature: '(integer) -> integer',
    evaluateAsync: async (_ops, { engine: e }) => e.Zero,
  });
  const json: Json = [
    'Count',
    [
      'FlatMap',
      ['Map', 'slowF', ['Set', 1, 2]],
      ['Function', ['Range', 1, 2], 'x'],
    ],
  ];
  expect(ce.box(json).evaluate().operator).toBe('Count');
  expect((await ce.box(json).evaluateAsync()).operator).toBe('Count');
});

// A symbol counts as data only at a position known to hold data (an operand
// of `List`, `Tuple` or `Set` at a data position, ...). At any other operand
// position an operator can apply it, also when it is not a lazy operator or
// its parameter is typed with the bare `function`: the view stays
// unevaluated on both routes.
describe('a symbol at an operand position that can apply it', () => {
  const ce = new ComputeEngine();
  ce.declare('slowF', {
    signature: '(integer) -> integer',
    evaluateAsync: async (ops, { engine: e }) => e.number(10 * ops[0].re),
  });
  ce.declare('slowLess', {
    signature: '(integer, integer) -> boolean',
    evaluateAsync: async (ops, { engine: e }) =>
      ops[0].re < ops[1].re ? e.True : e.False,
  });
  ce.declare('alias', 'function');
  ce.assign('alias', ce.box('slowF'));

  // The callback result is the value of `Sort`, a list: under
  // `evaluateAsync()` the walk of `FlatMap` awaits the callback, and `Sort`
  // awaits its comparator.
  test('the comparator of Sort', async () => {
    const json: Json = [
      'ListFrom',
      [
        'FlatMap',
        ['List', 1, 2],
        ['Function', ['Sort', ['List', 'x', 3, 1], 'slowLess'], 'x'],
      ],
    ];
    expect(ce.box(json).evaluate().operator).toBe('ListFrom');
    expect(show(await ce.box(json).evaluateAsync())).toBe(
      '["List",1,1,3,1,2,3]'
    );
  });

  test.each([
    [
      'the generator of Tabulate',
      [
        'Sum',
        [
          'FlatMap',
          ['List', 1, 2],
          ['Function', ['Tabulate', 'slowF', 'x'], 'x'],
        ],
      ],
    ],
    [
      'the function of Iterate',
      [
        'ListFrom',
        [
          'FlatMap',
          ['List', 1, 2],
          ['Function', ['Take', ['Iterate', 'slowF', 'x'], 2], 'x'],
        ],
      ],
    ],
    [
      'an alias at the callback of Map in the source',
      [
        'Count',
        [
          'FlatMap',
          ['Map', 'alias', ['Set', 1, 2]],
          ['Function', ['Range', 1, 2], 'x'],
        ],
      ],
    ],
  ] as [string, Json][])('%s', async (_, json) => {
    const op = (json as [string])[0];
    expect(ce.box(json).evaluate().operator).toBe(op);
    expect((await ce.box(json).evaluateAsync()).operator).toBe(op);
  });
});

// The callback can be an application that computes a function: `mk(0)`, with
// `mk := n ↦ slowEmpty`, gives the asynchronous-only `slowEmpty` as the
// callback, which `FlatMap` applies. The body of `mk` is not the body of the
// callback, so `slowEmpty` there is not data. `slowEmpty` gives `[]`, so the
// view is empty: a walk that read `slowEmpty(1)` unevaluated as one element
// gave `IsEmpty` as `False`. Under `evaluateAsync()` the walk of `FlatMap`
// awaits the callback, and the view is listed as empty.
test.each([
  ['IsEmpty', '"True"'],
  ['Count', '0'],
])(
  '%s of a FlatMap whose callback is an application stays unevaluated, and is %s under evaluateAsync',
  async (op, expected) => {
    const ce = new ComputeEngine();
    ce.declare('slowEmpty', {
      signature: '(integer) -> list<integer>',
      evaluateAsync: async (_ops, { engine: e }) => e.function('List', []),
    });
    ce.declare('mk', '(integer) -> function');
    ce.assign('mk', ce.box(['Function', 'slowEmpty', 'n']));
    const json: Json = [op, ['FlatMap', ['List', 1], ['mk', 0]]];
    expect(ce.box(json).evaluate().operator).toBe(op);
    expect(show(await ce.box(json).evaluateAsync())).toBe(expected);
  }
);
