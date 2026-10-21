import { ComputeEngine } from '../../src/compute-engine';
import type { EvaluateOptions, Expression } from '../../src/compute-engine';

// The result of evaluating a call whose head has no value stays symbolic for
// the rest of the top-level evaluation that produced it, even when the name
// is assigned later in that evaluation (a later statement of a nested block,
// a later term of a `Sum`). A later top-level evaluation (a host call of
// `evaluate()`, the next statement of an Epsil program or of a block that
// the host evaluates) resolves it again. The original, unevaluated call is
// never sticky. Decided in
// `docs/plans/2026-10-21-function-declaration-hoisting.md`, rule 1.

/** `z ↦ z²` */
const SQUARE = ['Function', ['Power', 'z', 2], 'z'];

/** A nested block (the operand of a `List`, so not a program block) that
 * stores `g(3)`, then assigns `g`, then reads the stored value. */
const STORED_THEN_ASSIGNED = [
  'List',
  ['Block', ['Assign', 'r', ['g', 3]], ['Assign', 'g', SQUARE], 'r'],
];

/** The `Sum` of `test/compute-engine/batch9-evaluation.test.ts`: the term
 * `h(1)` is evaluated while `h` has no value, `h` is assigned at `k = 2`,
 * and the final fold evaluates `h(1)` again. */
const SUM_THAT_ASSIGNS = [
  'Sum',
  [
    'Block',
    [
      'If',
      ['Equal', 'k', 2],
      ['Assign', 'h', ['Function', ['Multiply', 2, 'z'], 'z']],
    ],
    ['h', 'k'],
  ],
  'k',
  1,
  3,
];

describe('inside one top-level evaluation, the result stays symbolic', () => {
  test('a stored result read after the assignment in a nested block', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(STORED_THEN_ASSIGNED as never)
        .evaluate()
        .toString()
    ).toBe('[g(3)]');
  });

  test('a term of a sum keeps the value it had before the assignment', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(SUM_THAT_ASSIGNS as never)
        .evaluate()
        .toString()
    ).toBe('10 + h(1)');
  });

  test('the other terms of a stored sum still evaluate', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'List',
        [
          'Block',
          ['Assign', 'r', ['Add', ['g', 3], 'x']],
          ['Assign', 'x', 1],
          ['Assign', 'g', SQUARE],
          'r',
        ],
      ] as never)
      .evaluate();
    expect(value.toString()).toBe('[1 + g(3)]');
  });

  test('the operands of a sticky result still evaluate', () => {
    // `k` is assigned after `r ≔ h(k + 1)`, and the read of `r` evaluates
    // the operand `k + 1` to `3`, but does not resolve `h`.
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'List',
        [
          'Block',
          ['Assign', 'r', ['h', ['Add', 'k', 1]]],
          ['Assign', 'k', 2],
          ['Assign', 'h', SQUARE],
          'r',
        ],
      ] as never)
      .evaluate();
    expect(value.toString()).toBe('[h(3)]');
  });

  test('a sticky result is not checked against a later definition', () => {
    // `g` is declared as a function with no definition. The function
    // assigned after the result was stored takes a string, and the stored
    // `g(3)` is not boxed again against it: it stays `g(3)`, with no
    // `incompatible-type` error.
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    const value = ce
      .box([
        'List',
        [
          'Block',
          ['Assign', 'r', ['g', 3]],
          ['Assign', 'g', ['Function', 'x', ['Typed', 'x', { str: 'string' }]]],
          'r',
        ],
      ] as never)
      .evaluate();
    expect(value.toString()).toBe('[g(3)]');
  });
});

describe('a later top-level evaluation resolves the result again', () => {
  test('a stored host result and the original call', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('g(3)');
    const r = e.evaluate();
    expect(r.toString()).toBe('g(3)');
    ce.assign('g', ce.parse('k \\mapsto k^2'));
    expect(r.evaluate().toString()).toBe('9');
    expect(e.evaluate().toString()).toBe('9');
  });

  test('the box route agrees', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['g', 3]);
    const r = e.evaluate();
    ce.assign('g', ce.parse('k \\mapsto k^2'));
    expect(r.evaluate().toString()).toBe('9');
    expect(e.evaluate().toString()).toBe('9');
  });

  test('a stored result that holds other terms', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('g(3) + x').evaluate();
    ce.assign('x', 1);
    ce.assign('g', ce.parse('k \\mapsto k^2'));
    expect(r.evaluate().toString()).toBe('10');
  });

  test('a result whose head still has no value stays symbolic', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('h(k + 1)');
    const r = e.evaluate();
    ce.assign('k', 2);
    expect(r.evaluate().toString()).toBe('h(3)');
    expect(r.evaluate().evaluate().toString()).toBe('h(3)');
  });
});

describe('the asynchronous route agrees', () => {
  test('inside one top-level evaluation', async () => {
    const ce = new ComputeEngine();
    expect(
      (await ce.box(STORED_THEN_ASSIGNED as never).evaluateAsync()).toString()
    ).toBe('[g(3)]');
    expect(
      (await ce.box(SUM_THAT_ASSIGNS as never).evaluateAsync()).toString()
    ).toBe('10 + h(1)');
  });

  test('across top-level evaluations', async () => {
    const ce = new ComputeEngine();
    const e = ce.parse('g(3)');
    const r = await e.evaluateAsync();
    expect(r.toString()).toBe('g(3)');
    ce.assign('g', ce.parse('k \\mapsto k^2'));
    expect((await r.evaluateAsync()).toString()).toBe('9');
    expect((await e.evaluateAsync()).toString()).toBe('9');
  });
});

describe('a rebuilt expression', () => {
  test('a rebuilt expression resolves its head', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('h(k + 1)').evaluate();
    ce.assign('h', ce.parse('k \\mapsto k^2'));
    expect(r.subs({ k: 2 }).evaluate().toString()).toBe('9');
  });
});

describe('a program block that is not canonical', () => {
  // A `Block` that the host evaluates directly is a program: each of its
  // statements is its own top-level evaluation, so the stored `fn(3)`
  // resolves when the last statement reads it. A block that is not
  // canonical is evaluated by its canonical form, one evaluation deeper;
  // it is still a program (`runsAsProgram()`, `library/control-structures.ts`).
  const PROGRAM = [
    'Block',
    ['Assign', 'r', ['fn', 3]],
    ['Assign', 'fn', ['Function', ['Multiply', 2, 'z'], 'z']],
    ['Tuple', 'r', ['fn', 3]],
  ];
  const routes: [
    string,
    (ce: ComputeEngine) => ReturnType<ComputeEngine['box']>,
  ][] = [
    ['canonical', (ce) => ce.box(PROGRAM as never)],
    ['raw', (ce) => ce.box(PROGRAM as never, { form: 'raw' })],
    ['structural', (ce) => ce.box(PROGRAM as never, { form: 'structural' })],
    [
      'structural ce.function',
      (ce) =>
        ce.function(
          'Block',
          PROGRAM.slice(1).map((s) => ce.box(s as never, { form: 'raw' })),
          { form: 'structural' }
        ),
    ],
  ];

  test.each(routes)('the %s route, synchronous', (_, make) => {
    const ce = new ComputeEngine();
    expect(make(ce).evaluate().toString()).toBe('(6, 6)');
  });

  test.each(routes)('the %s route, asynchronous', async (_, make) => {
    const ce = new ComputeEngine();
    expect((await make(ce).evaluateAsync()).toString()).toBe('(6, 6)');
  });

  test('a block that is not canonical, nested in a list, is not a program', async () => {
    const ce = new ComputeEngine();
    const raw = ce.box(STORED_THEN_ASSIGNED as never, { form: 'raw' });
    expect(raw.evaluate().toString()).toBe('[g(3)]');
    const ce2 = new ComputeEngine();
    const raw2 = ce2.box(STORED_THEN_ASSIGNED as never, { form: 'raw' });
    expect((await raw2.evaluateAsync()).toString()).toBe('[g(3)]');
  });
});

describe('the result of an unresolved call over the same operands', () => {
  test('keeps the source offsets of the call', () => {
    // A call whose head is not defined yet (a forward reference in a
    // block), with source offsets from a MathJSON object. Its evaluation
    // over the same operands is a copy of the call (the original is never
    // marked as a sticky result), and the copy keeps the metadata of the
    // call. A `ce.parse()` call (`f(x)`) carries no source offsets, and its
    // evaluation rebuilds the call through `ce.function()` instead of
    // copying it.
    const ce = new ComputeEngine();
    const call = { fn: ['h', 'y'], sourceOffsets: [5, 9] };
    const expr = ce.box([
      'List',
      ['Block', ['Assign', 'r', call], 'r'],
    ] as never);
    const original = expr.ops![0].ops![0].ops![1];
    expect(original.toString()).toBe('h(y)');
    expect(original.sourceOffsets).toEqual([5, 9]);
    const result = expr.evaluate().ops![0];
    expect(result.toString()).toBe('h(y)');
    expect(result).not.toBe(original);
    expect(result.sourceOffsets).toEqual([5, 9]);
  });
});

/** A block that stores `h(k)`, then assigns `h`, then reads the stored
 * value. As a program, the last statement resolves the stored call
 * (`2k`); as a nested block, it stays `h(k)`. */
function storeThenAssign(h: string): unknown[] {
  return [
    'Block',
    ['Assign', 'r', [h, 'k']],
    ['Assign', h, ['Function', ['Multiply', 2, 'z'], 'z']],
    'r',
  ];
}

describe('a block that is a value of a dictionary is not a program', () => {
  // The values of a dictionary are evaluated one level deeper, as the
  // operands of a `List` or a `Tuple` are, so the block is a nested block.
  // Before: the dictionary evaluated its values at the depth of the host
  // call, and `{"a" -> B}` was `{"a" -> 2k}` where `(B, 1)` is `(h(k), 1)`.
  const DICTIONARY = [
    'Dictionary',
    ['KeyValuePair', "'a'", storeThenAssign('h')],
  ];

  test('synchronous', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(DICTIONARY as never)
        .evaluate()
        .toString()
    ).toBe('{"a" -> h(k)}');
    expect(
      ce
        .box(['Tuple', storeThenAssign('h'), 1] as never)
        .evaluate()
        .toString()
    ).toBe('(h(k), 1)');
  });

  test('asynchronous', async () => {
    const ce = new ComputeEngine();
    expect((await ce.box(DICTIONARY as never).evaluateAsync()).toString()).toBe(
      '{"a" -> h(k)}'
    );
  });
});

/** An engine with `Tick()`, an operator that has only an `evaluateAsync`
 * handler, which waits for a timer: an asynchronous evaluation that reads it
 * gives control back, and another evaluation runs before it goes on. */
function engineWithTick(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('Tick', {
    signature: '() -> number',
    pure: false,
    evaluateAsync: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return ce.Zero;
    },
  } as never);
  return ce;
}

describe('two host asynchronous evaluations of blocks at the same time', () => {
  // Each asynchronous evaluation has its own top-level evaluation number,
  // carried by its context stack (`evaluation-epoch.ts`), and each block
  // that the host evaluates is a program, whatever other evaluations are
  // pending. Before, asynchronous evaluations that ran at the same time
  // shared one number, the two blocks ran as nested blocks, and the stored
  // calls stayed unresolved: `h(k)` and `q(k)`.
  test('at the same time, each block is a program', async () => {
    const ce = new ComputeEngine();
    const [a, b] = await Promise.all([
      ce.box(storeThenAssign('h') as never).evaluateAsync(),
      ce.box(storeThenAssign('q') as never).evaluateAsync(),
    ]);
    expect([a.toString(), b.toString()]).toEqual(['2k', '2k']);
  });

  test('at the same time, with statements that wait', async () => {
    // `Tick()` gives control back after the first statement of each block,
    // so the statements of the two blocks alternate.
    const ce = engineWithTick();
    const waiting = (h: string): unknown[] => [
      'Block',
      ['Assign', 'r', [h, 'k']],
      ['Tick'],
      ['Assign', h, ['Function', ['Multiply', 2, 'z'], 'z']],
      'r',
    ];
    const [a, b] = await Promise.all([
      ce.box(waiting('h') as never).evaluateAsync(),
      ce.box(waiting('q') as never).evaluateAsync(),
    ]);
    expect([a.toString(), b.toString()]).toEqual(['2k', '2k']);
  });

  test('a synchronous evaluation while an asynchronous one is pending', async () => {
    // Before, a synchronous evaluation of a block that started while an
    // asynchronous evaluation was pending was not a program: `q(k)`.
    const ce = engineWithTick();
    const pending = ce
      .box([
        'Block',
        ['Assign', 'r', ['h', 'k']],
        ['Tick'],
        ['Assign', 'h', ['Function', ['Multiply', 2, 'z'], 'z']],
        'r',
      ] as never)
      .evaluateAsync();
    expect(
      ce
        .box(storeThenAssign('q') as never)
        .evaluate()
        .toString()
    ).toBe('2k');
    expect((await pending).toString()).toBe('2k');
  });

  test('a nested block stays nested while another evaluation is pending', async () => {
    // The block in a `Tuple` is not a program, on either route, whatever
    // other evaluation is pending.
    const ce = engineWithTick();
    const nested = ['Tuple', storeThenAssign('h'), 1];
    const [a, b] = await Promise.all([
      ce.box(nested as never).evaluateAsync(),
      ce.box(storeThenAssign('q') as never).evaluateAsync(),
    ]);
    expect([a.toString(), b.toString()]).toEqual(['(h(k), 1)', '2k']);
    const pending = ce.box(['Block', ['Tick'], 1] as never).evaluateAsync();
    expect(
      ce
        .box(nested as never)
        .evaluate()
        .toString()
    ).toBe('(h(k), 1)');
    await pending;
  });

  test('a loop body keeps its local in each evaluation', async () => {
    // `t` is assigned only in the body of the loop, so it is a local of the
    // body block, which keeps its value from one iteration to the next
    // inside one evaluation. The asynchronous route runs the body of a loop
    // synchronously, and gives control back between two time slices. Each
    // iteration waits longer than a time slice (`Slow()`), so the iterations
    // of the two asynchronous evaluations, and a synchronous evaluation,
    // alternate. Each evaluation has its own number, and reads only the
    // local of its own runs. Before, the synchronous evaluation of the same
    // block between two iterations removed the locals of the asynchronous
    // evaluations, which then gave `t + 2`.
    const ce = new ComputeEngine();
    let started!: () => void;
    const first = new Promise<void>((resolve) => {
      started = resolve;
    });
    ce.declare('Slow', {
      signature: '() -> number',
      pure: false,
      evaluate: () => {
        started();
        const end = Date.now() + 25;
        while (Date.now() < end) {
          // Wait
        }
        return ce.Zero;
      },
    });
    // One expression, so that the runs of the three evaluations are runs of
    // one block scope.
    const expr = ce.box([
      'Block',
      ['Assign', 'last', 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 't', ['Add', 't', 1]],
          ['Slow'],
          ['Assign', 'last', 't'],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      'last',
    ] as never);
    const one = expr.evaluateAsync();
    const two = expr.evaluateAsync();
    await first;
    expect(expr.evaluate().toString()).toBe('t + 3');
    const values = await Promise.all([one, two]);
    expect(values.map((v) => v.toString())).toEqual(['t + 3', 't + 3']);
    expect((await expr.evaluateAsync()).toString()).toBe('t + 3');
  });

  test('one after the other, each block is a program', async () => {
    const ce = new ComputeEngine();
    const a = await ce.box(storeThenAssign('h') as never).evaluateAsync();
    const b = await ce.box(storeThenAssign('q') as never).evaluateAsync();
    expect([a.toString(), b.toString()]).toEqual(['2k', '2k']);
  });
});

describe('the evaluation number on the routes that copy the context stack', () => {
  // An asynchronous evaluation keeps its frames on copies of its context
  // stack, and each copy must carry the number of the evaluation
  // (`copyContextStack`, `evaluation-epoch.ts`). Before, the application of
  // a function literal made a copy that carried no number: the operand after
  // the first `await` started a new evaluation, and the block in it ran as a
  // program (`2k`), where the synchronous route keeps it nested (`h(k)`).
  test('a block in an operand of a function literal', async () => {
    const pair = ['Function', ['Tuple', 'a', 'b'], 'a', 'b'];
    const sync = engineWithTick();
    const async = engineWithTick();
    const direct = (h: string): unknown[] => [
      'Apply',
      pair,
      ['Tick'],
      storeThenAssign(h),
    ];
    expect(
      sync
        .box(direct('h') as never)
        .evaluate()
        .toString()
    ).toBe('(Tick(), h(k))');
    expect(
      (await async.box(direct('h') as never).evaluateAsync()).toString()
    ).toBe('(0, h(k))');
  });

  test('a block in an operand of a declared function', async () => {
    const declare = (ce: ComputeEngine): void => {
      ce.declare('f', '(any, any) -> any');
      ce.assign('f', ce.box(['Function', ['Tuple', 'a', 'b'], 'a', 'b']));
    };
    const sync = engineWithTick();
    declare(sync);
    const async = engineWithTick();
    declare(async);
    const call = ['f', ['Tick'], storeThenAssign('h')];
    expect(
      sync
        .box(call as never)
        .evaluate()
        .toString()
    ).toBe('(Tick(), h(k))');
    expect((await async.box(call as never).evaluateAsync()).toString()).toBe(
      '(0, h(k))'
    );
  });

  test('a result read again after an `await` stays sticky', async () => {
    // `ReadAgain(h(k))` evaluates `h(k)`, evaluates the result again (the
    // sticky route), assigns `h`, and evaluates that second result. The
    // three steps are one evaluation, so the call stays unresolved. Before,
    // the asynchronous route marked the second result after an `await`,
    // with the number of the engine instead of the number of the
    // evaluation, and the last step resolved it: `2k`.
    const make = (): ComputeEngine => {
      const ce = new ComputeEngine();
      const double = ce.box(['Function', ['Multiply', 2, 'z'], 'z']);
      ce.declare('ReadAgain', {
        signature: '(any) -> any',
        lazy: true,
        pure: false,
        evaluate: ([x]: ReadonlyArray<Expression>) => {
          const second = x.evaluate().evaluate();
          ce.assign('h', double);
          return second.evaluate();
        },
        evaluateAsync: async (
          [x]: ReadonlyArray<Expression>,
          options: Partial<EvaluateOptions>
        ) => {
          const first = await x.evaluateAsync(options);
          const second = await first.evaluateAsync(options);
          ce.assign('h', double);
          return second.evaluateAsync(options);
        },
      } as never);
      return ce;
    };
    const expr = ['ReadAgain', ['h', 'k']];
    expect(
      make()
        .box(expr as never)
        .evaluate()
        .toString()
    ).toBe('h(k)');
    expect(
      (
        await make()
          .box(expr as never)
          .evaluateAsync()
      ).toString()
    ).toBe('h(k)');
  });

  test('a symbol that holds a program block', async () => {
    // The read of the symbol starts the asynchronous evaluation, and the
    // block it holds is the outermost evaluation of it: a program, as on
    // the synchronous route. Before, the read gave the value a copy of the
    // engine's stack that carried no evaluation, and the block ran as a
    // nested block: `q(k)`.
    const sync = new ComputeEngine();
    sync.assign('p', sync.box(storeThenAssign('h') as never, { form: 'raw' }));
    expect(sync.symbol('p').evaluate().toString()).toBe('2k');
    const async = new ComputeEngine();
    async.assign(
      'p',
      async.box(storeThenAssign('q') as never, { form: 'raw' })
    );
    expect((await async.symbol('p').evaluateAsync()).toString()).toBe('2k');
  });

  test('runs of two evaluations with the same run key alternate', async () => {
    // The first statement of the program starts an evaluation of `body`
    // that it does not await (`Spawn()`); the second statement, a new
    // top-level evaluation, evaluates `body` too. The runs of the loop body
    // of the two evaluations have the same run key (the frame of the
    // program block) and alternate, because each iteration waits longer
    // than a time slice (`Slow()`). Each keeps its own local `t`. Before,
    // the locals were kept for one evaluation per run key, and each
    // evaluation lost its local when the other one ran: `(t + 1, t + 1)`.
    const ce = new ComputeEngine();
    ce.declare('Slow', {
      signature: '() -> number',
      pure: false,
      evaluate: () => {
        const end = Date.now() + 25;
        while (Date.now() < end) {
          // Wait
        }
        return ce.Zero;
      },
    });
    const body = ce.box([
      'Block',
      ['Assign', 'last', 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 't', ['Add', 't', 1]],
          ['Slow'],
          ['Assign', 'last', 't'],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      'last',
    ] as never);
    let spawned: Promise<Expression> | undefined;
    ce.declare('Spawn', {
      signature: '() -> number',
      pure: false,
      evaluateAsync: async (
        _ops: ReadonlyArray<Expression>,
        options: Partial<EvaluateOptions>
      ) => {
        spawned = body.evaluateAsync(options);
        return ce.Zero;
      },
    } as never);
    ce.declare('RunBody', {
      signature: '() -> any',
      pure: false,
      evaluateAsync: async (
        _ops: ReadonlyArray<Expression>,
        options: Partial<EvaluateOptions>
      ) => body.evaluateAsync(options),
    } as never);
    ce.declare('Join', {
      signature: '() -> any',
      pure: false,
      evaluateAsync: async () => spawned ?? ce.Nothing,
    } as never);
    const program = ce.box([
      'Block',
      ['Spawn'],
      ['Assign', 'b', ['RunBody']],
      ['Tuple', ['Join'], 'b'],
    ] as never);
    expect((await program.evaluateAsync()).toString()).toBe('(t + 3, t + 3)');
  });
});
