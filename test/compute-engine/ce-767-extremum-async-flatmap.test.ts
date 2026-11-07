import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// Under `evaluateAsync()`, the extremum or the sum of a `FlatMap` whose
// callback applies an operator that has only an `evaluateAsync` handler
// stayed unevaluated: `Max(FlatMap([1, 2], x ↦ [x, slowF(x)]))` was
// `max(2, slowF(1), slowF(2))`. The consumer read the elements of the view
// with the synchronous `each()`, which does not await the callback. Now the
// `evaluateAsync` handler of `FlatMap` awaits each application of the
// callback, and `Max`, `Min`, `Supremum`, `Infimum` and `Sum` list such a
// view with it (`listedFlatMapViewAsync()`, `collection-utils.ts`) before
// they read it. The synchronous route does not change.

type Json = Parameters<ComputeEngine['box']>[0];

const show = (x: Expression) => JSON.stringify(x.json);

function engine() {
  const ce = new ComputeEngine();
  // The arguments of each call, in order.
  const calls: number[] = [];
  ce.declare('slowF', {
    signature: '(integer) -> integer',
    evaluateAsync: async (ops, { engine: e }) => {
      calls.push(ops[0].re);
      return e.number(10 * ops[0].re);
    },
  });
  ce.declare('slowRange', {
    signature: '(integer) -> list<integer>',
    evaluateAsync: async (ops, { engine: e }) => {
      calls.push(ops[0].re);
      return e.function('Range', [e.One, ops[0]]);
    },
  });
  ce.declare('v', 'list<integer>');
  return { ce, calls };
}

// Each callback result is a list of two elements, so the view is known to be
// finite.
const view = (source: Json): Json => [
  'FlatMap',
  source,
  ['Function', ['List', 'x', ['slowF', 'x']], 'x'],
];
const VIEW = view(['List', 1, 2]);

describe('the witness', () => {
  test.each([
    ['Max', '20'],
    ['Min', '1'],
    ['Supremum', '20'],
    ['Infimum', '1'],
    ['Sum', '33'],
    ['Product', '400'],
  ])('%s is %s under evaluateAsync', async (op, expected) => {
    const { ce, calls } = engine();
    expect(show(await ce.box([op, VIEW]).evaluateAsync())).toBe(expected);
    // The callback is applied once for each element of the source.
    expect(calls).toEqual([1, 2]);
  });

  test.each(['Max', 'Min', 'Sum'])(
    '%s keeps the synchronous elements under evaluate',
    (op) => {
      const { ce, calls } = engine();
      const value = ce.box([op, VIEW]).evaluate();
      expect(value.toString()).toContain('slowF(1)');
      expect(calls).toEqual([]);
    }
  );
});

test('the materialization of the view awaits the callback', async () => {
  const { ce, calls } = engine();
  expect(
    show(await ce.box(VIEW).evaluateAsync({ materialization: true }))
  ).toBe('["List",1,10,2,20]');
  expect(calls).toEqual([1, 2]);
  // The synchronous materialization gives the synchronous elements.
  expect(ce.box(VIEW).evaluate({ materialization: true }).toString()).toBe(
    '[1,slowF(1),2,slowF(2)]'
  );
});

test('Max lists each view operand in the order of the operands', async () => {
  const { ce, calls } = engine();
  const json: Json = ['Max', 3, VIEW, ['slowF', 5], view(['List', 3, 4])];
  expect(show(await ce.box(json).evaluateAsync())).toBe('50');
  expect(calls).toEqual([5, 1, 2, 3, 4]);
});

test('Max of a view whose finiteness is not known awaits the callback', async () => {
  const { ce, calls } = engine();
  const json: Json = ['Max', ['FlatMap', ['List', 1, 2], 'slowRange'], 1];
  expect(show(await ce.box(json).evaluateAsync())).toBe('2');
  expect(calls).toEqual([1, 2]);
});

// `v` has no value, so the walk of `Join([x], v)` misses elements, and the
// answer cannot be known. The walk is made by the synchronous part of the
// handler, which measures it as the asynchronous route measures a
// synchronous handler.
describe('a walk that misses elements', () => {
  const joined: Json = [
    'Take',
    [
      'FlatMap',
      ['List', 1, 2],
      ['Function', ['Join', ['List', 'x'], 'v'], 'x'],
    ],
    3,
  ];

  test.each(['Max', 'Min'])('%s stays unevaluated', async (op) => {
    const { ce } = engine();
    expect((await ce.box([op, joined]).evaluateAsync()).operator).toBe(op);
    expect(ce.box([op, joined]).evaluate().operator).toBe(op);
  });

  // The handler lists the first operand, then the walk of the second operand
  // misses elements. The handler answers the unevaluated `Max(…)`, so the
  // route does not call it again, and the callback of the first operand is
  // applied once for each element.
  test('after a listing, Max stays unevaluated and applies each callback once', async () => {
    const { ce, calls } = engine();
    const json: Json = [
      'Max',
      ['FlatMap', ['List', 1, 2], 'slowRange'],
      joined,
    ];
    expect((await ce.box(json).evaluateAsync()).operator).toBe('Max');
    expect(calls).toEqual([1, 2]);
  });

  // The unevaluated `Max(…)` keeps the definition that the call is bound
  // to: a `Max` declared in a scope that is current when the walk ends is
  // not used, also when the answer is evaluated again.
  test('the unevaluated answer keeps the binding of the call', async () => {
    const { ce } = engine();
    const expr = ce.box(['Max', VIEW, joined]);
    const library = expr.operatorDefinition;
    ce.pushScope();
    ce.declare('Max', {
      signature: '(value*) -> number',
      evaluate: (_ops, { engine: e }) => e.number(42),
    });
    const value = await expr.evaluateAsync();
    expect(value.operator).toBe('Max');
    expect(value.operatorDefinition).toBe(library);
    expect((await value.evaluateAsync()).operator).toBe('Max');
    ce.popScope();
  });
});

// With a source of more elements than `maxCollectionSize`, the walk of
// `FlatMap` does not start: the materialization that follows applies the
// callback only to the elements that it reads, once each.
test('a source larger than the cap applies the callback once for each element read', async () => {
  const { ce, calls } = engine();
  ce.maxCollectionSize = 2;
  const json: Json = ['FlatMap', ['Range', 1, 3], 'slowF'];
  await ce.box(json).evaluateAsync({ materialization: 1 });
  expect(calls).toEqual([1]);
});

test('an abort while the callback runs cancels the evaluation', async () => {
  const ce = new ComputeEngine();
  const controller = new AbortController();
  ce.declare('slowF', {
    signature: '(integer) -> integer',
    evaluateAsync: async (ops, { engine: e }) => {
      controller.abort();
      return e.number(10 * ops[0].re);
    },
  });
  await expect(
    ce.box(['Max', VIEW]).evaluateAsync({ signal: controller.signal })
  ).rejects.toThrow();
});

// `FlatMap` holds its operands. Its `evaluateAsync` handler awaits the
// asynchronous-only applications in them before the walk, so the callback
// reads the value `10` of `slowF(1)`, not the unevaluated call.
test('an asynchronous-only application in the source is awaited', async () => {
  const { ce } = engine();
  const json: Json = [
    'FlatMap',
    ['List', ['slowF', 1]],
    ['Function', ['List', ['String', 'x']], 'x'],
  ];
  expect(
    show(await ce.box(json).evaluateAsync({ materialization: true }))
  ).toBe(`["List","'10'"]`);
});

// `tick` is a synchronous host operator: it records each call.
function tickingEngine() {
  const { ce, calls } = engine();
  const ticks: string[] = [];
  ce.declare('tick', {
    signature: '(integer) -> integer',
    pure: false,
    evaluate: (ops) => {
      ticks.push(`tick(${ops[0].re})`);
      return ops[0];
    },
  });
  ce.declare('tickRange', {
    signature: '(integer) -> list<integer>',
    pure: false,
    evaluate: (ops, { engine: e }) => {
      ticks.push(`tickRange(${ops[0].re})`);
      return e.function('Range', [e.One, ops[0]]);
    },
  });
  return { ce, calls, ticks };
}

// The listing of a `FlatMap` operand is made at its position among the
// operands: the callback of the `Map` before it runs first, as on the
// synchronous route.
test('Max applies the callbacks of its operands in their order', async () => {
  const json: Json = [
    'Max',
    ['Map', ['Function', ['tick', 'y'], 'y'], ['Range', 1, 200]],
    ['FlatMap', ['List', 1], 'tickRange'],
  ];
  const sync = tickingEngine();
  expect(show(sync.ce.box(json).evaluate())).toBe('200');
  const async_ = tickingEngine();
  expect(show(await async_.ce.box(json).evaluateAsync())).toBe('200');
  expect(async_.ticks).toEqual(sync.ticks);
  expect(async_.ticks.at(-1)).toBe('tickRange(1)');
});

// After a walk that missed elements, the handler is not called a second
// time: the callback of a view that is not listed runs once on each route.
test('a walk that misses elements applies each callback once', async () => {
  const json: Json = [
    'Max',
    ['FlatMap', ['List', 1, 2], ['Function', ['Range', 1, 'x'], 'x']],
    [
      'Take',
      [
        'FlatMap',
        ['List', 1, 2],
        ['Function', ['Join', ['List', ['tick', 'x']], 'v'], 'x'],
      ],
      3,
    ],
  ];
  const sync = tickingEngine();
  expect(sync.ce.box(json).evaluate().operator).toBe('Max');
  const async_ = tickingEngine();
  expect((await async_.ce.box(json).evaluateAsync()).operator).toBe('Max');
  expect(async_.ticks).toEqual(sync.ticks);
});

// When the asynchronous walk of `FlatMap` gives no list (here, more elements
// than `maxCollectionSize`), the synchronous read would give the string of
// the unevaluated call `slowF(1)`, of length 8. The extremum stays
// unevaluated instead.
test('a FlatMap that applies an asynchronous-only operator and is not listed stays unevaluated', async () => {
  const { ce } = engine();
  ce.maxCollectionSize = 2;
  const json: Json = [
    'Max',
    [
      'FlatMap',
      ['Range', 1, 3],
      ['Function', ['List', ['Length', ['String', ['slowF', 'x']]]], 'x'],
    ],
  ];
  expect((await ce.box(json).evaluateAsync()).operator).toBe('Max');
});
