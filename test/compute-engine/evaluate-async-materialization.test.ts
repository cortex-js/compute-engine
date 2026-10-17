import { ComputeEngine } from '../../src/compute-engine';

// The `materialization` option lists the elements of a lazy view. The walk
// enumerates the view with its synchronous iterator, which cannot run an
// operator that has only an `evaluateAsync` handler: the elements of
// `Map(AsyncOnly, [1, 2])` are the applications `AsyncOnly(1)` and
// `AsyncOnly(2)`, and `evaluate()` leaves them as they are. Before,
// `evaluateAsync({ materialization: true })` stored these applications
// unevaluated, `[AsyncOnly(1), AsyncOnly(2)]`. The asynchronous route now
// awaits each element of the walk, for a view at the top level, a view in a
// list literal and a view in a spread. The synchronous route does not
// change: it cannot await, and it keeps the applications as they are.

/** An engine with `AsyncOnly(x) = 10x`, an operator that has only an
 * `evaluateAsync` handler, and `h`, a multi-clause user function with
 * `h(0) = 0` and `h(n) = AsyncOnly(n)` for an integer `n`. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('AsyncOnly', {
    signature: '(number) -> number',
    evaluateAsync: async ([x]) => ce.number(x.re * 10),
  });
  ce.box([
    'DefineFunction',
    'h',
    ['Function', 0, ['Typed', 'z', { str: '0' }]],
  ] as any).evaluate();
  ce.box([
    'DefineFunction',
    'h',
    ['Function', ['AsyncOnly', 'n'], ['Typed', 'n', { str: 'integer' }]],
  ] as any).evaluate();
  return ce;
}

const BY_NAME = ['Map', 'AsyncOnly', ['List', 1, 2]];
const BY_LAMBDA = [
  'Map',
  ['Function', ['AsyncOnly', 'x'], 'x'],
  ['List', 1, 2],
];
const BY_CLAUSES = ['Map', 'h', ['List', 0, 1, 2]];

describe('evaluateAsync({ materialization: true }) awaits the elements of a view', () => {
  const cases: [string, any, string, string][] = [
    ['by name', BY_NAME, '[10,20]', '[AsyncOnly(1),AsyncOnly(2)]'],
    ['by lambda', BY_LAMBDA, '[10,20]', '[AsyncOnly(1),AsyncOnly(2)]'],
    [
      'by a multi-clause function',
      BY_CLAUSES,
      '[0,10,20]',
      '[0,AsyncOnly(1),AsyncOnly(2)]',
    ],
    [
      'in a list literal, by name',
      ['List', BY_NAME, 3],
      '[[10,20],3]',
      '[[AsyncOnly(1),AsyncOnly(2)],3]',
    ],
    [
      'in a list literal, by lambda',
      ['List', BY_LAMBDA],
      '[[10,20]]',
      '[[AsyncOnly(1),AsyncOnly(2)]]',
    ],
    [
      'in a list literal, by a multi-clause function',
      ['List', BY_CLAUSES],
      '[[0,10,20]]',
      '[[0,AsyncOnly(1),AsyncOnly(2)]]',
    ],
    [
      'in a spread, by name',
      ['List', ['Spread', BY_NAME], 3],
      '[10,20,3]',
      '[AsyncOnly(1),AsyncOnly(2),3]',
    ],
    [
      'in a spread, by lambda',
      ['List', ['Spread', BY_LAMBDA]],
      '[10,20]',
      '[AsyncOnly(1),AsyncOnly(2)]',
    ],
    [
      'in a spread, by a multi-clause function',
      ['List', ['Spread', BY_CLAUSES], 3],
      '[0,10,20,3]',
      '[0,AsyncOnly(1),AsyncOnly(2),3]',
    ],
    [
      'in a tuple',
      ['Tuple', BY_NAME, 3],
      '([10,20],3)',
      '([AsyncOnly(1),AsyncOnly(2)],3)',
    ],
  ];

  const compact = (s: string) => s.replace(/\s/g, '');

  test.each(cases)('%s', async (_, expr, asyncValue, syncValue) => {
    const ce = engine();
    const x = ce.box(expr);
    const value = await x.evaluateAsync({ materialization: true });
    expect(compact(value.toString())).toBe(asyncValue);
    // The synchronous route keeps the applications unevaluated, as before.
    expect(compact(x.evaluate({ materialization: true }).toString())).toBe(
      syncValue
    );
  });
});

// The listing of a lazy element of a list literal (or of a spread) keeps a
// view lazy when its callback can reach an operator that has only an
// `evaluateAsync` handler: the listing is synchronous and would store the
// applications unevaluated. The check now looks into each clause of a
// multi-clause user function too. Before, it found no such operator in `h`,
// and the literal was `[[0, AsyncOnly(1), AsyncOnly(2)]]` on both routes.
describe('a view whose callback is a multi-clause function stays lazy in a literal', () => {
  test('in a list literal', async () => {
    const ce = engine();
    const literal = ce.box(['List', BY_CLAUSES]);
    expect(literal.evaluate().op1.operator).toBe('Map');
    expect((await literal.evaluateAsync()).op1.operator).toBe('Map');
  });

  test('in a spread', async () => {
    const ce = engine();
    const literal = ce.box(['List', ['Spread', BY_CLAUSES], 3]);
    expect(literal.evaluate().operator).toBe('ListJoin');
    expect((await literal.evaluateAsync()).operator).toBe('ListJoin');
  });
});

// A call of a multi-clause user function on the asynchronous route awaits
// the body of the selected clause, as a call of a single-clause function
// does. Before, the asynchronous route ran the synchronous clause selector,
// and an operator that has only an `evaluateAsync` handler in the body
// stayed unevaluated: `h(1).evaluateAsync()` was `AsyncOnly(1)`. The
// selection is the same on both routes, so a hold function and the fold of
// an associative function are awaited too.
describe('evaluateAsync() awaits the body of a multi-clause function', () => {
  test.each([
    ['a call', ['h', 1], '10'],
    ['a call in a sum', ['Add', ['h', 1], 1], '11'],
    ['a call in a Sum', ['Sum', ['h', 'k'], ['Limits', 'k', 0, 2]], '30'],
    ['the other clause', ['h', 0], '0'],
  ])('%s', async (_, expr, expected) => {
    const ce = engine();
    expect((await ce.box(expr as any).evaluateAsync()).toString()).toBe(
      expected
    );
  });

  test('a hold function', async () => {
    const ce = engine();
    ce.box([
      'DefineFunction',
      'hf',
      ['Function', ['Add', ['AsyncOnly', 'e'], 1], 'e'],
      { dict: { hold: 'True' } },
    ] as any).evaluate();
    const value = await ce.box(['hf', ['Add', 1, 2]]).evaluateAsync();
    expect(value.toString()).toBe('31');
  });

  // `op(1, 2, 3)` is folded as `op(op(1, 2), 3)`, which is
  // `AsyncOnly(AsyncOnly(1) + 2) + 3 = 10 · 12 + 3`.
  test('the fold of an associative function', async () => {
    const ce = engine();
    ce.box([
      'DefineFunction',
      'op',
      ['Function', ['Add', ['AsyncOnly', 'a'], 'b'], 'a', 'b'],
      { dict: { associative: 'True' } },
    ] as any).evaluate();
    const value = await ce.box(['op', 1, 2, 3]).evaluateAsync();
    expect(value.toString()).toBe('123');
  });
});

// The body of an application with awaited statements runs in the body
// scope of the literal, re-parented to the call frame of the application.
// Before, a second application of the same literal that started while the
// first one was suspended ran synchronously, and an operator that has only
// an `evaluateAsync` handler in its body stayed unevaluated: for two
// overlapping calls `h(1)` and `h(2)`, the second one was `AsyncOnly(2)`,
// and a recursive call in the body was not awaited either. Now a recursive
// call is awaited in the frame of its caller, and an application of another
// evaluation starts when the suspended one ends.
describe('evaluateAsync() of overlapping applications of a user function', () => {
  test('two overlapping calls of a multi-clause function', async () => {
    const ce = engine();
    const first = ce.box(['h', 1]).evaluateAsync();
    const second = ce.box(['h', 2]).evaluateAsync();
    expect((await first).toString()).toBe('10');
    expect((await second).toString()).toBe('20');
  });

  test('three overlapping calls of a single-clause function', async () => {
    const ce = engine();
    ce.box([
      'DefineFunction',
      'g',
      [
        'Function',
        ['Add', ['AsyncOnly', 'n'], 'n'],
        ['Typed', 'n', { str: 'integer' }],
      ],
    ] as any).evaluate();
    const values = await Promise.all(
      [1, 2, 3].map((n) => ce.box(['g', n]).evaluateAsync())
    );
    expect(values.map((x) => x.toString())).toEqual(['11', '22', '33']);
  });

  // The applications of a broadcast start on the evaluation-context stack
  // of their caller, the second one while the first one is suspended.
  test('a broadcast of a single-clause function over a list', async () => {
    const ce = engine();
    ce.box([
      'DefineFunction',
      'g',
      [
        'Function',
        ['Add', ['AsyncOnly', 'n'], 'n'],
        ['Typed', 'n', { str: 'integer' }],
      ],
    ] as any).evaluate();
    const value = await ce.box(['g', ['List', 1, 2, 3]]).evaluateAsync();
    expect(value.toString()).toBe('[11,22,33]');
  });

  // f(n) = 10n + f(n − 1), f(0) = 0, so f(3) = 30 + 20 + 10 = 60.
  test('a recursive multi-clause function', async () => {
    const ce = engine();
    ce.box([
      'DefineFunction',
      'f',
      ['Function', 0, ['Typed', 'z', { str: '0' }]],
    ] as any).evaluate();
    ce.box([
      'DefineFunction',
      'f',
      [
        'Function',
        ['Add', ['AsyncOnly', 'n'], ['f', ['Subtract', 'n', 1]]],
        ['Typed', 'n', { str: 'integer' }],
      ],
    ] as any).evaluate();
    expect((await ce.box(['f', 3]).evaluateAsync()).toString()).toBe('60');
    // Two overlapping recursions.
    const a = ce.box(['f', 2]).evaluateAsync();
    const b = ce.box(['f', 4]).evaluateAsync();
    expect((await a).toString()).toBe('30');
    expect((await b).toString()).toBe('100');
  });

  // t(n) = 10 + 2 t(n − 1), t(0) = 0: the body calls itself twice, one
  // call after the other, so t(3) = 10 + 2 (10 + 2 (10 + 2 · 10)) = 70.
  test('a recursive function that calls itself twice', async () => {
    const ce = engine();
    ce.box([
      'DefineFunction',
      't',
      [
        'Function',
        [
          'If',
          ['Equal', 'n', 0],
          0,
          [
            'Add',
            ['AsyncOnly', 1],
            ['t', ['Subtract', 'n', 1]],
            ['t', ['Subtract', 'n', 1]],
          ],
        ],
        ['Typed', 'n', { str: 'integer' }],
      ],
    ] as any).evaluate();
    expect((await ce.box(['t', 3]).evaluateAsync()).toString()).toBe('70');
  });
});
