import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// The finiteness of `FlatMap([1, 2], x ↦ Range(1, x))` is not known: the
// `isFinite` handler of `FlatMap` does not apply the callback, and the type
// of the callback result, `list<integer>`, does not show a finite length. A
// few consumers (`ListFrom`, `Count`, `Sum`, `Max`, `Reduce`, ...) list such
// a view by the walk of its materialization (`listedFlatMapView()`,
// `collection-utils.ts`). The other consumers stayed unevaluated: `Mean`,
// `Sort`, `Contains`, and every consumer of a view over the `FlatMap`
// (`ListFrom(Reverse(...))`).
//
// A standard-library handler that declines is now called again, with each
// such `FlatMap` among its operands, or in the source of a view among its
// operands, replaced by its list (`declinedOverListedFlatMaps()`,
// `boxed-function.ts`). The value is the value of the same operator over the
// listed elements `[1, 1, 2]`. `MaxBy`, `MinBy`, `ArgMax` and `ArgMin` are
// `lazy`, and list the view in their own handler.
//
// Every synchronous expectation runs inside a time limit, so a regression
// fails with a `Timeout exceeded` error instead of hanging the suite.

const ce = new ComputeEngine();

let calls = 0;
ce.declare('countedRange', {
  signature: '(integer) -> list<integer>',
  pure: false,
  evaluate: (ops, { engine }) => {
    calls += 1;
    return engine.function('Range', [engine.One, ops[0]]);
  },
});

ce.declare('slowF', {
  signature: '(integer) -> integer',
  evaluateAsync: async (ops, { engine }) => engine.number(10 * ops[0].re),
});

// A hang guard, not a measure of speed: far above the time of the work
// (milliseconds) and above a stall of a worker in a full run on a loaded
// machine (stalls of several seconds were seen), so that only an endless
// loop reaches it.
const LIMIT = { ms: 30_000, label: 'test:flatmap-all-consumers' };

type Json = Parameters<typeof ce.box>[0];

function box(json: unknown): Expression {
  return ce.box(json as Json);
}

function show(x: Expression): string {
  return JSON.stringify(x.json);
}

function evaluateLimited(json: unknown): Expression {
  return ce.withTimeLimit(LIMIT, () => box(json).evaluate());
}

const VIEW = ['FlatMap', ['List', 1, 2], ['Function', ['Range', 1, 'x'], 'x']];
const LISTED = ['List', 1, 1, 2];
const fn = (body: unknown) => ['Function', body, 'x'];

// Each case builds the application over a collection: it is evaluated over
// the view and over the listed elements, and the two values must agree.
const CASES: [string, (xs: unknown) => unknown][] = [
  ['Mean', (xs) => ['Mean', xs]],
  ['Median', (xs) => ['Median', xs]],
  ['Variance', (xs) => ['Variance', xs]],
  ['StandardDeviation', (xs) => ['StandardDeviation', xs]],
  ['Mode', (xs) => ['Mode', xs]],
  ['Quartiles', (xs) => ['Quartiles', xs]],
  ['Covariance', (xs) => ['Covariance', xs, ['List', 1, 2, 3]]],
  ['BinCounts', (xs) => ['BinCounts', xs, 1]],
  ['Sort', (xs) => ['Sort', xs]],
  ['Sort with an order', (xs) => ['Sort', xs, 'Greater']],
  ['Ordering', (xs) => ['Ordering', xs]],
  ['Unique', (xs) => ['Unique', xs]],
  ['Tally', (xs) => ['Tally', xs]],
  ['SetFrom', (xs) => ['SetFrom', xs]],
  ['TupleFrom', (xs) => ['TupleFrom', xs]],
  ['Contains', (xs) => ['Contains', xs, 2]],
  ['Element', (xs) => ['Element', 2, xs]],
  ['Subset', (xs) => ['Subset', xs, ['Set', 1, 2, 3]]],
  ['CountIf', (xs) => ['CountIf', xs, fn(['Greater', 'x', 1])]],
  ['ContainsSequence', (xs) => ['ContainsSequence', xs, ['List', 1, 2]]],
  ['StartsWith', (xs) => ['StartsWith', xs, ['List', 1]]],
  ['EndsWith', (xs) => ['EndsWith', xs, ['List', 2]]],
  ['Chunk', (xs) => ['Chunk', xs, 2]],
  ['MaxBy', (xs) => ['MaxBy', xs, fn('x')]],
  ['MinBy', (xs) => ['MinBy', xs, fn('x')]],
  ['ArgMax', (xs) => ['ArgMax', xs]],
  ['ArgMin', (xs) => ['ArgMin', xs]],
  ['ListFrom of Reverse', (xs) => ['ListFrom', ['Reverse', xs]]],
  ['ListFrom of Rest', (xs) => ['ListFrom', ['Rest', xs]]],
  ['ListFrom of Most', (xs) => ['ListFrom', ['Most', xs]]],
  ['ListFrom of Drop', (xs) => ['ListFrom', ['Drop', xs, 1]]],
  ['ListFrom of Dedup', (xs) => ['ListFrom', ['Dedup', xs]]],
  ['ListFrom of Differences', (xs) => ['ListFrom', ['Differences', xs]]],
  ['ListFrom of Append', (xs) => ['ListFrom', ['Append', xs, 5]]],
  ['ListFrom of RotateLeft', (xs) => ['ListFrom', ['RotateLeft', xs, 1]]],
  ['ListFrom of Filter', (xs) => ['ListFrom', ['Filter', xs, fn(['Greater', 'x', 1])]]],
  ['ListFrom of Union', (xs) => ['ListFrom', ['Union', xs, ['Set', 5]]]],
  ['ListFrom of a Reverse of a Rest', (xs) => ['ListFrom', ['Reverse', ['Rest', xs]]]],
];

describe('a consumer of a FlatMap of unknown finiteness', () => {
  test('the finiteness of the view is not known', () => {
    expect(box(VIEW).isFiniteCollection).toBeUndefined();
  });

  test('the reported case: ListFrom(Reverse(view)) is [2, 1, 1]', async () => {
    const json = ['ListFrom', ['Reverse', VIEW]];
    expect(show(evaluateLimited(json))).toBe('["List",2,1,1]');
    expect(show(await box(json).evaluateAsync())).toBe('["List",2,1,1]');
  });

  test.each(CASES)('%s: the value over the listed elements', async (_, mk) => {
    const expected = show(box(mk(LISTED)).evaluate());
    // A control: the operator gives a value over the list.
    expect(box(mk(LISTED)).evaluate().operator).not.toBe(
      box(mk(LISTED)).operator
    );
    expect(show(evaluateLimited(mk(VIEW)))).toBe(expected);
    expect(show(await box(mk(VIEW)).evaluateAsync())).toBe(expected);
  });
});

describe('the callback of the view', () => {
  const COUNTED = [
    'FlatMap',
    ['List', 1, 2, 3],
    ['Function', ['countedRange', 'x'], 'x'],
  ];

  test.each([
    ['Mean', ['Mean', COUNTED], '["Rational",5,3]'],
    ['Sort', ['Sort', COUNTED], '["List",1,1,1,2,2,3]'],
    ['ListFrom of Reverse', ['ListFrom', ['Reverse', COUNTED]], '["List",3,2,1,2,1,1]'],
    ['MaxBy', ['MaxBy', COUNTED, fn('x')], '3'],
  ])('%s applies it once for each element of the source', async (_, json, expected) => {
    calls = 0;
    expect(show(evaluateLimited(json))).toBe(expected);
    expect(calls).toBe(3);
    calls = 0;
    expect(show(await box(json).evaluateAsync())).toBe(expected);
    expect(calls).toBe(3);
  });

  test('First reads a prefix: it applies the callback once', () => {
    calls = 0;
    expect(show(evaluateLimited(['First', COUNTED]))).toBe('1');
    expect(calls).toBe(1);
  });
});

// A view with an inner result that is provably infinite is not listed: the
// walk stops at that inner result, and the consumer stays unevaluated, as
// for any infinite collection.
describe('a FlatMap with an infinite inner result', () => {
  const INFINITE = [
    'FlatMap',
    ['List', 1, 2],
    [
      'Function',
      ['If', ['Equal', 'x', 1], ['Range', 1, 'x'], ['Range', 1, 'PositiveInfinity']],
      'x',
    ],
  ];
  test.each([
    ['Mean', ['Mean', INFINITE]],
    ['Sort', ['Sort', INFINITE]],
    ['Median', ['Median', INFINITE]],
    ['ListFrom of Reverse', ['ListFrom', ['Reverse', INFINITE]]],
    ['MaxBy', ['MaxBy', INFINITE, fn('x')]],
  ])('%s stays unevaluated', async (_, json) => {
    const op = (json as unknown[])[0];
    expect(evaluateLimited(json).operator).toBe(op);
    expect((await box(json).evaluateAsync()).operator).toBe(op);
  });
});

// The emptiness of a `FlatMap` whose callback result is a `Map` does not
// depend on the callback of the `Map`, so a `Map` callback that has only an
// `evaluateAsync` handler does not stop the walk of `IsEmpty`.
describe('IsEmpty of a FlatMap whose callback result maps an asynchronous-only function', () => {
  test('the view is not empty', async () => {
    const json = [
      'IsEmpty',
      ['FlatMap', ['List', 1, 2], fn(['Map', 'slowF', ['Range', 1, 'x']])],
    ];
    expect(show(evaluateLimited(json))).toBe('"False"');
    expect(show(await box(json).evaluateAsync())).toBe('"False"');
  });

  test('an asynchronous-only predicate of a Filter still stops the walk', async () => {
    const local = new ComputeEngine();
    local.declare('slowP', {
      signature: '(integer) -> boolean',
      evaluateAsync: async (_ops, { engine }) => engine.False,
    });
    const json = [
      'IsEmpty',
      ['FlatMap', ['List', 1, 2], fn(['Filter', ['Range', 1, 'x'], 'slowP'])],
    ] as Json;
    expect(local.box(json).evaluate().operator).toBe('IsEmpty');
    expect((await local.box(json).evaluateAsync()).operator).toBe('IsEmpty');
  });
});

// Under `evaluateAsync()`, the view is listed with the options of the
// evaluation (`listedFlatMapViewAsync()`). The walk of `FlatMap` is
// synchronous, so a signal that the callback aborts is read when the walk
// ends: the evaluation is canceled, and the consumer does not read the list.
describe('an abort signal during the listing of the view', () => {
  let controller = new AbortController();
  const local = new ComputeEngine();
  local.declare('abortingRange', {
    signature: '(integer) -> list<integer>',
    pure: false,
    evaluate: (ops, { engine }) => {
      controller.abort();
      return engine.function('Range', [engine.One, ops[0]]);
    },
  });
  const ABORTING = [
    'FlatMap',
    ['List', 1, 2, 3],
    ['Function', ['abortingRange', 'x'], 'x'],
  ];
  test.each([
    ['MaxBy', ['MaxBy', ABORTING, fn('x')]],
    ['MinBy', ['MinBy', ABORTING, fn('x')]],
    ['ArgMax', ['ArgMax', ABORTING]],
    ['ArgMin', ['ArgMin', ABORTING]],
    ['Sort', ['Sort', ABORTING]],
    ['Mean', ['Mean', ABORTING]],
  ])('%s is canceled', async (_, json) => {
    controller = new AbortController();
    await expect(
      local.box(json as Json).evaluateAsync({ signal: controller.signal })
    ).rejects.toThrow('Operation canceled');
  });
});

// The walk of the view would apply `slowF`, which has only an
// `evaluateAsync` handler, synchronously: the view is not listed, and the
// operator stays unevaluated on both routes.
describe('a FlatMap whose walk applies an asynchronous-only function', () => {
  const ASYNC_ONLY = [
    'FlatMap',
    ['List', 1, 2],
    fn(['Map', 'slowF', ['Range', 1, 'x']]),
  ];
  test.each([
    ['MaxBy', ['MaxBy', ASYNC_ONLY, fn('x')]],
    ['ArgMin', ['ArgMin', ASYNC_ONLY]],
    ['Sort', ['Sort', ASYNC_ONLY]],
    ['Mean', ['Mean', ASYNC_ONLY]],
  ])('%s stays unevaluated', async (_, json) => {
    const op = (json as unknown[])[0];
    expect(evaluateLimited(json).operator).toBe(op);
    expect((await box(json).evaluateAsync()).operator).toBe(op);
  });
});

// A handler can list a `FlatMap` and then decline. The second call of the
// handler over the listed views reads the listing of the first call, so the
// callback of each view is applied once for each element of its source.
describe('a handler that lists the view and declines', () => {
  let f = 0;
  let g = 0;
  const local = new ComputeEngine();
  local.declare('fR', {
    signature: '(integer) -> list<integer>',
    pure: false,
    evaluate: (ops, { engine }) => {
      f += 1;
      return engine.function('Range', [engine.One, ops[0]]);
    },
  });
  local.declare('gR', {
    signature: '(integer) -> list<integer>',
    pure: false,
    evaluate: (ops, { engine }) => {
      g += 1;
      return engine.function('Range', [engine.One, ops[0]]);
    },
  });
  local.declare('fInf', {
    signature: '(integer) -> list<integer>',
    pure: false,
    evaluate: (_ops, { engine }) => {
      f += 1;
      return engine.function('Range', [engine.One, engine.PositiveInfinity]);
    },
  });
  local.declare('xs', 'list<integer>');
  local.declare('a', 'integer');
  const F = ['FlatMap', ['List', 1, 2], fn(['fR', 'x'])];
  const G = ['FlatMap', ['List', 1, 2], fn(['gR', 'x'])];
  const F_INF = ['FlatMap', ['List', 1, 2], fn(['fInf', 'x'])];
  const BIG = ['FlatMap', ['Range', 1, 1000000], fn(['fR', 'x'])];
  // [label, expression, calls of fR or fInf, calls of gR, value]
  const CASES: [string, unknown, number, number, string][] = [
    ['ListFrom with a valueless operand', ['ListFrom', F, 'xs'], 2, 0, 'ListFrom'],
    ['Length', ['Length', F], 2, 0, '3'],
    ['Count', ['Count', F], 2, 0, '3'],
    ['Max of an infinite view', ['Max', F_INF], 1, 0, 'Max'],
    ['Max with a symbolic operand', ['Max', F, 'a'], 2, 0, '["Max",2,"a"]'],
    ['Sum of an infinite view', ['Sum', F_INF], 1, 0, 'Sum'],
    [
      'ListFrom of a view and of a Reverse of a view',
      ['ListFrom', F, ['Reverse', G]],
      2,
      2,
      '["List",1,1,2,2,1,1]',
    ],
    [
      'ListFrom of an empty prefix and of a Reverse of a view',
      ['ListFrom', ['Take', F, 0], ['Reverse', G]],
      0,
      2,
      '["List",2,1,1]',
    ],
    [
      'ListFrom of a prefix of a large view and of a Reverse of a view',
      ['ListFrom', ['Take', BIG, 5], ['Reverse', G]],
      3,
      2,
      '["List",1,1,2,1,2,2,1,1]',
    ],
    [
      'SetFrom of a prefix of a large view and of a Reverse of a view',
      ['SetFrom', ['Take', BIG, 5], ['Reverse', G]],
      3,
      2,
      '["Set",1,2]',
    ],
    // `fR` is applied twice, and `fInf` once: the view over `fInf` is not
    // listed, and the second call of the handler does not walk it again.
    [
      'ListFrom of a view and of a Reverse of an infinite view',
      ['ListFrom', F, ['Reverse', F_INF]],
      3,
      0,
      'ListFrom',
    ],
  ];
  const check = (x: Expression, expected: string) => {
    if (expected.startsWith('[') || /^\d/.test(expected))
      expect(show(x)).toBe(expected);
    else expect(x.operator).toBe(expected);
  };
  test.each(CASES)('%s', async (_, json, fCalls, gCalls, expected) => {
    f = 0;
    g = 0;
    check(
      local.withTimeLimit(LIMIT, () => local.box(json as Json).evaluate()),
      expected
    );
    expect([f, g]).toEqual([fCalls, gCalls]);
    f = 0;
    g = 0;
    check(await local.box(json as Json).evaluateAsync(), expected);
    expect([f, g]).toEqual([fCalls, gCalls]);
  });
});

// A second decline, over the listed elements, gives the decline of the first
// call: the application keeps its `FlatMap` operand, on both routes.
test.each([['Sort'], ['Median'], ['Mode']])(
  '%s that declines over the listed elements keeps the view',
  async (op) => {
    const local = new ComputeEngine();
    local.declare('a', 'integer');
    local.declare('b', 'integer');
    const json = [op, ['FlatMap', ['List', 1, 2], fn(['List', 'a', 'b'])]];
    const sync = local.box(json as Json).evaluate();
    expect(sync.operator).toBe(op);
    expect(sync.op1.operator).toBe('FlatMap');
    expect(show(await local.box(json as Json).evaluateAsync())).toBe(show(sync));
  }
);

// The second call is made with the definition that the application is bound
// to, also when another definition of the name is in the current scope.
test('the second call keeps the binding of the application', async () => {
  const local = new ComputeEngine();
  const mean = local.box(['Mean', VIEW] as Json);
  const sorted = local.box(['Sort', ['Reverse', VIEW]] as Json);
  local.pushScope();
  try {
    local.declare('Mean', {
      signature: '(any) -> integer',
      evaluate: (_ops, { engine }) => engine.number(99),
    });
    local.declare('Reverse', {
      signature: '(any) -> integer',
      evaluate: (_ops, { engine }) => engine.number(99),
    });
    expect(show(mean.evaluate())).toBe('["Rational",4,3]');
    expect(show(await mean.evaluateAsync())).toBe('["Rational",4,3]');
    expect(show(sorted.evaluate())).toBe('["List",1,1,2]');
    expect(show(await sorted.evaluateAsync())).toBe('["List",1,1,2]');
  } finally {
    local.popScope();
  }
});

// The evaluation of the view is an error when its callback symbol holds an
// error value. The consumer answers with that error, as it does for a list
// that holds the error.
test('Mean of a view whose evaluation is an error is that error', async () => {
  const local = new ComputeEngine();
  local.assign('w', local.box(['Ln', "'a'"]).evaluate());
  const LN_ERROR = `["ErrorCode","'incompatible-type'","'number'","'string'"]`;
  const overList = local.box(['Mean', ['List', 'w', 1]]).evaluate();
  expect(overList.operator).toBe('Error');
  expect(show(overList)).toContain(LN_ERROR);
  const json = ['Mean', ['FlatMap', ['List', 1, 2], 'w']] as Json;
  for (const value of [
    local.box(json).evaluate(),
    await local.box(json).evaluateAsync(),
  ]) {
    expect(value.operator).toBe('Error');
    expect(show(value)).toContain(LN_ERROR);
    expect(show(value)).toContain(`["ErrorFrame","'Mean'",1]`);
  }
});

// A view with more than `maxCollectionSize` elements is not listed. Its walk
// stops at the limit, once, and the consumer stays unevaluated.
test('a view larger than maxCollectionSize is walked once and not listed', async () => {
  const local = new ComputeEngine();
  local.maxCollectionSize = 3;
  let c = 0;
  local.declare('cR', {
    signature: '(integer) -> list<integer>',
    pure: false,
    evaluate: (ops, { engine }) => {
      c += 1;
      return engine.function('Range', [engine.One, ops[0]]);
    },
  });
  const json = [
    'Mean',
    ['FlatMap', ['List', 1, 2, 3, 4], fn(['cR', 'x'])],
  ] as Json;
  expect(
    local.withTimeLimit(LIMIT, () => local.box(json).evaluate()).operator
  ).toBe('Mean');
  expect(c).toBe(3);
  c = 0;
  expect((await local.box(json).evaluateAsync()).operator).toBe('Mean');
  expect(c).toBe(3);
});

// The operands of `ListFrom` are walked from left to right, so the callbacks
// of their views run in that order: the callback of the `Map` assigns `n`
// before the `FlatMap` reads it.
test('ListFrom walks its operands from left to right', async () => {
  for (const route of ['sync', 'async']) {
    const local = new ComputeEngine();
    local.declare('n', 'integer');
    local.assign('n', 1);
    const json = [
      'ListFrom',
      ['Map', fn(['Block', ['Assign', 'n', 2], 9]), ['List', 1]],
      ['FlatMap', ['List', 0], fn(['Range', 1, 'n'])],
    ] as Json;
    const value =
      route === 'sync'
        ? local.box(json).evaluate()
        : await local.box(json).evaluateAsync();
    expect(show(value)).toBe('["List",9,1,2]');
  }
});

// The second call of the handler runs in the same step as the first call,
// on both routes: an exception becomes an error value, a walk that missed
// elements keeps the decline, and `materialization: true` applies to the
// answer.
describe('the second call of the handler', () => {
  const run = async (
    local: ComputeEngine,
    json: unknown,
    route: string,
    options: { materialization?: boolean } = {}
  ) =>
    route === 'sync'
      ? local.box(json as Json).evaluate(options)
      : await local.box(json as Json).evaluateAsync(options);

  test('an exception in the second call is the same error value on both routes', async () => {
    const local = new ComputeEngine();
    local.declare('boom', {
      signature: '(integer) -> integer',
      evaluate: () => {
        throw new TypeError('boom');
      },
    });
    const json = ['ListFrom', ['Reverse', VIEW], ['Map', 'boom', ['List', 0]]];
    const sync = await run(local, json, 'sync');
    expect(show(sync)).toContain('Error');
    expect(show(await run(local, json, 'async'))).toBe(show(sync));
  });

  test('a walk that misses elements keeps the decline', async () => {
    const local = new ComputeEngine();
    local.declare('v', 'list<integer>');
    const json = [
      'ListFrom',
      ['Take', ['FlatMap', ['List', 1, 2], fn(['Join', ['List', 'x'], 'v'])], 3],
      ['FlatMap', ['List', 1], ['Function', ['Range', 1, 'y'], 'y']],
    ];
    for (const route of ['sync', 'async'])
      expect((await run(local, json, route)).operator).toBe('ListFrom');
  });

  test.each([
    ['Chunk', ['Chunk', VIEW, 2], '["List",["List",1,1],["List",2]]'],
    ['Sort of a Reverse', ['Sort', ['Reverse', VIEW]], '["List",1,1,2]'],
  ])('%s under materialization: true', async (_, json, expected) => {
    for (const route of ['sync', 'async'])
      expect(show(await run(ce, json, route, { materialization: true }))).toBe(
        expected
      );
  });
});

// The same view at two operand positions is walked at each position, from
// left to right, as without the second call: the `setter` assigns `n`
// between the two walks of `s`. The two operands `v` are one instance of
// the random view (an impure lazy view whose operands did not change
// evaluates to itself), and one instance has one set of draws
// (`docs/RANDOMNESS-MODEL.md` §6, CE-1125): the second walk of `v` gives the
// draws of the first.
describe('the same view at two operand positions', () => {
  const setter = ['Map', fn(['Block', ['Assign', 'n', 2], 9]), ['List', 0]];
  test.each([
    ['ListFrom', '["List",1,9,2]'],
    ['TupleFrom', '["Tuple",1,9,2]'],
    ['SetFrom', '["Set",1,2,9]'],
  ])('%s walks it twice', async (op, expected) => {
    for (const route of ['sync', 'async']) {
      const local = new ComputeEngine();
      local.declare('n', 'integer');
      local.assign('n', 1);
      local.assign('s', local.box(['Take', ['Map', fn('n'), ['List', 0]], 1]));
      const json = [op, 's', setter, 's'] as Json;
      const value =
        route === 'sync'
          ? local.box(json).evaluate()
          : await local.box(json).evaluateAsync();
      expect(show(value)).toBe(expected);
    }
  });

  test('ListFrom(v, v) draws two values and lists them twice', async () => {
    for (const route of ['sync', 'async']) {
      const local = new ComputeEngine();
      local.assign('v', local.box(['Map', fn(['Random']), ['List', 1, 2]]));
      const json = ['ListFrom', 'v', 'v'] as Json;
      const value =
        route === 'sync'
          ? local.box(json).evaluate()
          : await local.box(json).evaluateAsync();
      const draws = value.ops!.map((x) => x.re);
      expect(draws).toHaveLength(4);
      expect(new Set(draws).size).toBe(2);
      expect(draws.slice(2)).toEqual(draws.slice(0, 2));
    }
  });
});

// A first call that read a walk that missed elements is not called again,
// on either route: the view in the later operand is not listed, and the
// callbacks run the same number of times on both routes.
test('a first call that read an incomplete walk is not called again', async () => {
  const local = new ComputeEngine();
  local.declare('v', 'list<integer>');
  let f = 0;
  let g = 0;
  local.declare('fR', {
    signature: '(integer) -> list<integer>',
    pure: false,
    evaluate: (ops, { engine }) => {
      f += 1;
      return engine.function('Range', [engine.One, ops[0]]);
    },
  });
  local.declare('gR', {
    signature: '(integer) -> list<integer>',
    pure: false,
    evaluate: (ops, { engine }) => {
      g += 1;
      return engine.function('Range', [engine.One, ops[0]]);
    },
  });
  const json = [
    'ListFrom',
    ['Take', ['FlatMap', ['List', 1, 2], fn(['Join', ['fR', 'x'], 'v'])], 3],
    ['Reverse', ['FlatMap', ['List', 1], ['Function', ['gR', 'y'], 'y']]],
  ] as Json;
  expect(local.box(json).evaluate().operator).toBe('ListFrom');
  const counts = [f, g];
  expect(g).toBe(0);
  f = 0;
  g = 0;
  expect((await local.box(json).evaluateAsync()).operator).toBe('ListFrom');
  expect([f, g]).toEqual(counts);
});

// A second call that reads an incomplete walk keeps the decline on both
// routes, also when a later operand calls a host function that throws. The
// host function throws a `TypeError`, which its own evaluation makes an
// error value, so no exception reaches the handler of `ListFrom`.
test('a second call that reads an incomplete walk keeps the decline', async () => {
  const local = new ComputeEngine();
  local.declare('v', 'list<integer>');
  local.declare('boom', {
    signature: '(integer) -> integer',
    evaluate: () => {
      throw new TypeError('boom');
    },
  });
  const json = [
    'ListFrom',
    ['Reverse', VIEW],
    ['Take', ['FlatMap', ['List', 1, 2], fn(['Join', ['List', 'x'], 'v'])], 3],
    ['Map', 'boom', ['List', 0]],
  ] as Json;
  const sync = local.box(json).evaluate();
  expect(sync.operator).toBe('ListFrom');
  expect(show(await local.box(json).evaluateAsync())).toBe(show(sync));
});
