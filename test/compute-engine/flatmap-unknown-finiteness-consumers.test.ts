import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// The `isFinite` handler of `FlatMap` answers `true` only when the type of the
// callback result shows that each inner result is finite: a scalar, a tuple,
// or a list of fixed length. It does not apply the callback. So for
// `FlatMap([1, 2], x ↦ Range(1, x))`, whose callback result is typed
// `list<integer>`, the finiteness is not known, and the consumers that need
// every element (`ListFrom`, `Count`, `Sum`, `Max`, `Reduce`) stayed
// unevaluated, although `evaluate({ materialization: true })` of the view
// gives `[1, 1, 2]`.
//
// These consumers now list such a view, when its source is finite, by the
// walk of its materialization (`listedFlatMapView()`, `collection-utils.ts`):
// - every inner result listed: the consumer reads the list;
// - an inner result that is provably infinite (`Range(1, ∞)`): the consumer
//   gives the `out-of-range` error "a finite collection" of that walk, as
//   under `materialization: true`;
// - more than `maxCollectionSize` elements: the consumer stays unevaluated.
// A view that reads a prefix (`Take`, `First`) stays lazy, and applies the
// callback only to the elements that it reads.
//
// Every expectation runs inside a time limit, so a regression fails with a
// `Timeout exceeded` error instead of hanging the suite.

const ce = new ComputeEngine();
ce.declare('g', '(integer) -> list<integer>');
ce.assign('g', ce.parse('x \\mapsto [x, x]'));

let calls = 0;
ce.declare('countedRange', {
  signature: '(integer) -> list<integer>',
  pure: false,
  evaluate: (ops, { engine }) => {
    calls += 1;
    return engine.function('Range', [engine.One, ops[0]]);
  },
});

let predicateCalls = 0;
ce.declare('countedPositive', {
  signature: '(integer) -> boolean',
  pure: false,
  evaluate: (ops, { engine }) => {
    predicateCalls += 1;
    return (ops[0].re ?? 0) > 0 ? engine.True : engine.False;
  },
});

const LIMIT = { ms: 5000, label: 'test:flatmap-unknown-finiteness' };

function limited<T>(fn: () => T): T {
  return ce.withTimeLimit(
    LIMIT,
    fn as () => T extends Promise<unknown> ? never : T
  );
}

function box(json: unknown): Expression {
  return ce.box(json as Parameters<typeof ce.box>[0]);
}

function show(x: Expression): string {
  return JSON.stringify(x.json);
}

const SOURCE = ['List', 1, 2];

const CASES: [string, unknown, unknown, Record<string, string>][] = [
  [
    'x ↦ Range(1, x)',
    SOURCE,
    ['Function', ['Range', 1, 'x'], 'x'],
    {
      ListFrom: '["List",1,1,2]',
      Count: '3',
      Length: '3',
      Sum: '4',
      Max: '2',
      Reduce: '4',
    },
  ],
  [
    'x ↦ If(x > 1, [x, x], [x])',
    SOURCE,
    [
      'Function',
      ['If', ['Greater', 'x', 1], ['List', 'x', 'x'], ['List', 'x']],
      'x',
    ],
    {
      ListFrom: '["List",1,2,2]',
      Count: '3',
      Length: '3',
      Sum: '5',
      Max: '2',
      Reduce: '5',
    },
  ],
  [
    'declared g: (integer) -> list<integer>',
    SOURCE,
    'g',
    {
      ListFrom: '["List",1,1,2,2]',
      Count: '4',
      Length: '4',
      Sum: '6',
      Max: '2',
      Reduce: '6',
    },
  ],
  [
    'nested-list source',
    ['List', ['List', 1, 2], ['List', 3, 4]],
    ['Function', ['List', 'x', 'x'], 'x'],
    {
      ListFrom: '["List",["List",1,2],["List",1,2],["List",3,4],["List",3,4]]',
      Count: '4',
      Length: '4',
      Sum: '["List",8,12]',
      Max: '4',
      Reduce: '["List",8,12]',
    },
  ],
];

function consumer(op: string, view: unknown): unknown {
  return op === 'Reduce' ? ['Reduce', view, 'Add', 0] : [op, view];
}

describe('consumers of a FlatMap whose finiteness is not known', () => {
  describe.each(CASES)('%s', (_label, source, callback, expected) => {
    const view = ['FlatMap', source, callback];

    test('the finiteness is not known', () => {
      expect(box(view).isFiniteCollection).toBeUndefined();
    });

    test.each(Object.entries(expected))('%s', (op, value) => {
      const json = consumer(op, view);
      expect(show(limited(() => box(json).evaluate()))).toBe(value);
      expect(
        show(limited(() => box(json).evaluate({ materialization: true })))
      ).toBe(value);
    });

    test.each(Object.entries(expected))(
      '%s, evaluateAsync',
      async (op, value) => {
        const json = consumer(op, view);
        expect(show(await box(json).evaluateAsync())).toBe(value);
      }
    );
  });
});

describe('a FlatMap with an infinite inner result', () => {
  const view = [
    'FlatMap',
    SOURCE,
    ['Function', ['Range', 1, 'PositiveInfinity'], 'x'],
  ];
  const ERROR = `["ErrorCode","'out-of-range'","'a finite collection'","'[1,2,3,4,5,...]'"]`;

  test('ListFrom is the error of the materialization', () => {
    const json = ['ListFrom', view];
    const value = limited(() => box(json).evaluate());
    expect(value.operator).toBe('Error');
    expect(JSON.stringify(value.json)).toContain(ERROR);
    expect(JSON.stringify(value.json)).toContain(
      `["ErrorFrame","'ListFrom'",1]`
    );
    expect(
      show(limited(() => box(json).evaluate({ materialization: true })))
    ).toBe(show(value));
  });

  // As for any other infinite collection: `Sum(Range(1, ∞))` stays
  // unevaluated, and `Count(Range(1, ∞))` is `+∞`.
  test.each(['Sum', 'Max', 'Min', 'Reduce'])('%s stays unevaluated', (op) => {
    const json = consumer(op, view);
    expect(limited(() => box(json).evaluate()).operator).toBe(op);
    expect(
      limited(() => box(json).evaluate({ materialization: true })).operator
    ).toBe(op);
  });

  test.each(['Count', 'Length'])('%s is +∞', (op) => {
    const json = consumer(op, view);
    expect(show(limited(() => box(json).evaluate()))).toBe(
      '"PositiveInfinity"'
    );
    expect(
      show(limited(() => box(json).evaluate({ materialization: true })))
    ).toBe('"PositiveInfinity"');
  });

  test('IsEmpty reads the first element only', () => {
    expect(show(limited(() => box(['IsEmpty', view]).evaluate()))).toBe(
      '"False"'
    );
  });

  test('evaluateAsync gives the same answers', async () => {
    expect((await box(['Sum', view]).evaluateAsync()).operator).toBe('Sum');
    expect(
      (await box(['Reduce', view, 'Add', 0]).evaluateAsync()).operator
    ).toBe('Reduce');
    expect(show(await box(['Count', view]).evaluateAsync())).toBe(
      '"PositiveInfinity"'
    );
    const listed = await box(['ListFrom', view]).evaluateAsync();
    expect(JSON.stringify(listed.json)).toContain(ERROR);
  });
});

// A `Filter` over an infinite source can be finite, but its walk never ends:
// it stops at `maxCollectionSize`, or with the `iteration-limit-exceeded`
// cancellation of `Filter` after a long run of rejected elements. Then every
// consumer stays unevaluated, as for the `Filter` itself. The cancellation
// escaped from `Count`, and from the materialization of the view.
describe('a FlatMap with an inner Filter over an infinite source', () => {
  const NEG = ['Function', ['Less', 'y', 0], 'y'];
  const POS = ['Function', ['Greater', 'y', 0], 'y'];
  const CASES: [string, unknown][] = [
    [
      'Filter over Range(1, ∞)',
      ['Filter', ['Range', 1, 'PositiveInfinity'], NEG],
    ],
    [
      'Filter over a Filter over Range(1, ∞)',
      ['Filter', ['Filter', ['Range', 1, 'PositiveInfinity'], POS], NEG],
    ],
  ];
  describe.each(CASES)('%s', (_label, inner) => {
    const view = ['FlatMap', ['List', 1], ['Function', inner, 'x']];
    test.each([
      'Count',
      'Length',
      'Sum',
      'Max',
      'ListFrom',
      'Reduce',
      'IsEmpty',
    ])('%s stays unevaluated', (op) => {
      const json = consumer(op, view);
      expect(limited(() => box(json).evaluate()).operator).toBe(op);
      expect(
        limited(() => box(json).evaluate({ materialization: true })).operator
      ).toBe(op);
    });
    test('the materialization of the view stays lazy', () => {
      expect(
        limited(() => box(view).evaluate({ materialization: true })).operator
      ).toBe('FlatMap');
    });
  });
});

describe('the callback is applied only to the elements that are read', () => {
  const view = ['FlatMap', ['Range', 1, 10], 'countedRange'];

  test('the finiteness is not known', () => {
    expect(box(view).isFiniteCollection).toBeUndefined();
  });

  test('Take reads a prefix', () => {
    calls = 0;
    expect(
      show(box(['Take', view, 2]).evaluate({ materialization: true }))
    ).toBe('["List",1,1]');
    expect(calls).toBe(2);
  });

  test('Sum of a Take reads a prefix', () => {
    calls = 0;
    expect(show(box(['Sum', ['Take', view, 2]]).evaluate())).toBe('2');
    expect(calls).toBe(2);
  });

  test('First reads one inner result', () => {
    calls = 0;
    expect(show(box(['First', view]).evaluate())).toBe('1');
    expect(calls).toBe(1);
  });

  // A facet does not apply a callback: the finiteness of a `FlatMap` over a
  // `Filter` is not read from the emptiness of the `Filter`, which applies
  // its predicate.
  test('isFinite does not apply the predicate of a Filter source', () => {
    predicateCalls = 0;
    const filtered = box([
      'FlatMap',
      ['Filter', ['List', 1, 2], 'countedPositive'],
      ['Function', ['Range', 1, 'x'], 'x'],
    ]);
    expect(filtered.isFiniteCollection).toBeUndefined();
    expect(predicateCalls).toBe(0);
  });

  test('Count and Sum apply the callback once for each element', () => {
    calls = 0;
    expect(show(box(['Count', view]).evaluate())).toBe('55');
    expect(calls).toBe(10);
    calls = 0;
    expect(show(box(['Sum', view]).evaluate())).toBe('220');
    expect(calls).toBe(10);
  });
});

// The synchronous walk of `FlatMap` does not await a callback whose result
// holds an operator with only an `evaluateAsync` handler: under `evaluate()`
// the view stays lazy. Before, the unevaluated calls were listed as
// elements: `FlatMap([1, 2], x ↦ slowRange(x))` was
// `[slowRange(1), slowRange(2)]`. The `evaluateAsync` handler of `FlatMap`
// awaits the callback, so under `evaluateAsync()` the view is listed as
// `[1, 1, 2]`, and each consumer reads that list.
describe('a FlatMap whose callback is asynchronous only', () => {
  const engine = new ComputeEngine();
  let slowCalls = 0;
  engine.declare('slowRange', {
    signature: '(integer) -> list<integer>',
    evaluateAsync: async (ops, { engine: e }) => {
      slowCalls += 1;
      return e.function('Range', [e.One, ops[0]]);
    },
  });
  const view = [
    'FlatMap',
    SOURCE,
    ['Function', ['slowRange', 'x'], 'x'],
  ] as Parameters<typeof engine.box>[0];

  test('the synchronous materialization stays lazy', () => {
    expect(engine.box(view).evaluate({ materialization: true }).operator).toBe(
      'FlatMap'
    );
  });

  test('the asynchronous materialization awaits the callback', async () => {
    slowCalls = 0;
    expect(
      show(await engine.box(view).evaluateAsync({ materialization: true }))
    ).toBe('["List",1,1,2]');
    expect(slowCalls).toBe(2);
  });

  test.each([
    ['Sum', '4'],
    ['Reduce', '4'],
    ['ListFrom', '["List",1,1,2]'],
    ['Count', '3'],
    ['Max', '2'],
    ['Min', '1'],
  ])(
    '%s stays unevaluated under evaluate, and is %s under evaluateAsync',
    async (op, expected) => {
      const json = consumer(op, view) as Parameters<typeof engine.box>[0];
      expect(engine.box(json).evaluate().operator).toBe(op);
      slowCalls = 0;
      expect(show(await engine.box(json).evaluateAsync())).toBe(expected);
      expect(slowCalls).toBe(2);
    }
  );
});

// A callback symbol that holds an error value makes the view evaluate to that
// error before the walk of `FlatMap` runs. That error is not a proof that the
// view is infinite: every consumer answers with it, with its own frame. Only
// the error of the walk for an infinite inner result is read as "infinite".
describe('a FlatMap whose callback symbol holds an error value', () => {
  const engine = new ComputeEngine();
  engine.assign('w', engine.box(['Ln', "'a'"]).evaluate());
  const view = ['FlatMap', SOURCE, 'w'];
  const LN_ERROR = `["ErrorCode","'incompatible-type'","'number'","'string'"]`;

  test.each(['Count', 'Length', 'Sum', 'Max', 'Reduce', 'ListFrom'])(
    '%s is the error of the callback',
    async (op) => {
      const json = consumer(op, view) as Parameters<typeof engine.box>[0];
      const value = engine.box(json).evaluate();
      expect(value.operator).toBe('Error');
      expect(JSON.stringify(value.json)).toContain(LN_ERROR);
      expect(JSON.stringify(value.json)).toContain(
        `["ErrorFrame","'${op}'",1]`
      );
      const asyncValue = await engine.box(json).evaluateAsync();
      expect(asyncValue.operator).toBe('Error');
      expect(JSON.stringify(asyncValue.json)).toContain(LN_ERROR);
    }
  );
});

// The start of the fold of `Reduce` reads the reducer. On the asynchronous
// route it runs after the `await` of the listing, inside the context of the
// evaluation, so the local `f` of the `Block` is found.
test('async Reduce over a listed FlatMap reads a reducer local to a Block', async () => {
  const block = ce.box([
    'Block',
    ['Declare', 'f', "'unknown'", ['Function', ['Add', 'a', 'b'], 'a', 'b']],
    [
      'Reduce',
      ['FlatMap', SOURCE, ['Function', ['Range', 1, 'x'], 'x']],
      'f',
      0,
    ],
  ]);
  expect(show(block.evaluate())).toBe('4');
  expect(show(await block.evaluateAsync())).toBe('4');
});

// The callback of an operator inside the inner result can be a symbol that
// names an operator with only an `evaluateAsync` handler: the view stays
// lazy, as for a callback that calls it directly.
describe('a FlatMap whose inner result maps an asynchronous-only symbol', () => {
  const engine = new ComputeEngine();
  engine.declare('slowF', {
    signature: '(integer) -> integer',
    evaluateAsync: async (ops, { engine: e }) => e.number(10 * ops[0].re),
  });
  const view = [
    'FlatMap',
    SOURCE,
    ['Function', ['Map', 'slowF', ['Range', 1, 'x']], 'x'],
  ] as Parameters<typeof engine.box>[0];

  test('the materialization stays lazy', async () => {
    expect(engine.box(view).evaluate({ materialization: true }).operator).toBe(
      'FlatMap'
    );
    expect(
      (await engine.box(view).evaluateAsync({ materialization: true })).operator
    ).toBe('FlatMap');
  });

  test.each(['Sum', 'ListFrom', 'Count'])(
    '%s stays unevaluated',
    async (op) => {
      const json = [op, view] as Parameters<typeof engine.box>[0];
      expect(engine.box(json).evaluate().operator).toBe(op);
      expect((await engine.box(json).evaluateAsync()).operator).toBe(op);
    }
  );
});

// A function symbol that the callback returns as data is not applied: it is
// one element, and the walk goes on. The walk stopped after the callback had
// run, and the materialization then walked the view again, so the callback
// ran twice for each element.
test('a callback that returns an asynchronous-only symbol as data runs once per element', () => {
  const engine = new ComputeEngine();
  engine.declare('slowF', {
    signature: '(integer) -> integer',
    evaluateAsync: async (ops, { engine: e }) => e.number(10 * ops[0].re),
  });
  let tagged = 0;
  engine.declare('tag', {
    signature: '(integer) -> tuple<integer, function>',
    pure: false,
    evaluate: (ops, { engine: e }) => {
      tagged += 1;
      return e.tuple(ops[0], e.symbol('slowF'));
    },
  });
  const value = engine
    .box(['FlatMap', SOURCE, 'tag'])
    .evaluate({ materialization: true });
  expect(show(value)).toBe('["List",1,"slowF",2,"slowF"]');
  expect(tagged).toBe(2);
});

// The error of the evaluation of the view has the same trace under
// `evaluate()` and `evaluateAsync()`.
test('Sum of a FlatMap whose callback holds an error: same trace sync and async', async () => {
  const engine = new ComputeEngine();
  engine.assign('w', engine.box(['Ln', "'a'"]).evaluate());
  const json = ['Sum', ['FlatMap', SOURCE, 'w']] as Parameters<
    typeof engine.box
  >[0];
  const sync = engine.box(json).evaluate();
  const async_ = await engine.box(json).evaluateAsync();
  expect(sync.operator).toBe('Error');
  expect(JSON.stringify(async_.json)).toBe(JSON.stringify(sync.json));
});
