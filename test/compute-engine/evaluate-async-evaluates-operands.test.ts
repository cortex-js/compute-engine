import { ComputeEngine } from '../../src/compute-engine';

// GitHub issue #392, second part: a lazy operator whose handler only
// evaluates its held operands (`evaluatesOperands`: the relations), and the
// application of a user function (its body statements), yield to the event
// loop under `evaluateAsync` and honour an abort signal. Before, they ran
// their operands to the end synchronously.

const SLOW_SUM = [
  'Sum',
  ['Divide', 1, ['Power', 'k', 2]],
  ['Limits', 'k', 1, 400000],
];
const SMALL_SUM = [
  'Sum',
  ['Divide', 1, ['Power', 'k', 2]],
  ['Limits', 'k', 1, 200],
];

// Defines `f(n) = Σ_{k=1}^{n} 1/k²`.
function defineSumFunction(ce: ComputeEngine, name = 'f') {
  ce.assign(
    name,
    ce.box([
      'Function',
      [
        'Block',
        ['Sum', ['Divide', 1, ['Power', 'k', 2]], ['Limits', 'k', 1, 'n']],
      ],
      'n',
    ])
  );
}

describe('a relation over a long operand yields and honours the abort signal', () => {
  const ce = new ComputeEngine();

  // Aborted after 50 ms: a run that yields rejects with a
  // `CancellationError`, and a macrotask queued before the evaluation runs
  // during it. A run to the end (seconds) finishes with a value first.
  const abortsPromptly = async (expr: any) => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    const start = Date.now();
    const boxed = typeof expr === 'string' ? ce.parse(expr) : ce.box(expr);
    await expect(
      boxed.evaluateAsync({ signal: ac.signal })
    ).rejects.toMatchObject({ name: 'CancellationError' });
    expect(yielded).toBe(true);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(1500);
  };

  const cases: [string, any][] = [
    ['Less(Sum, 2)', ['Less', SLOW_SUM, 2]],
    ['Less(2, Sum)', ['Less', 2, SLOW_SUM]],
    ['LessEqual(Sum, 2)', ['LessEqual', SLOW_SUM, 2]],
    ['Greater(Sum, 2)', ['Greater', SLOW_SUM, 2]],
    ['GreaterEqual(Sum, 2)', ['GreaterEqual', SLOW_SUM, 2]],
    ['Equal(Sum, 2)', ['Equal', SLOW_SUM, 2]],
    ['NotEqual(Sum, 2)', ['NotEqual', SLOW_SUM, 2]],
    ['IdenticallyEqual(Sum, 2)', ['IdenticallyEqual', SLOW_SUM, 2]],
    ['Less(1, Sum, 3), a chain', ['Less', 1, SLOW_SUM, 3]],
    ['Less(1, 2 + Sum), a nested operand', ['Less', 1, ['Add', 2, SLOW_SUM]]],
    ['parsed: Sum < 2', '\\sum_{k=1}^{400000} \\frac{1}{k^2} < 2'],
    ['parsed: Sum = 2', '\\sum_{k=1}^{400000} \\frac{1}{k^2} = 2'],
  ];
  for (const [name, expr] of cases)
    test(name, async () => abortsPromptly(expr));
});

describe('the application of a user function yields and honours the abort signal', () => {
  const abortsPromptly = async (
    setup: (ce: ComputeEngine) => any,
    numericApproximation = false
  ) => {
    const ce = new ComputeEngine();
    defineSumFunction(ce);
    const boxed = setup(ce);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    await expect(
      boxed.evaluateAsync({ signal: ac.signal, numericApproximation })
    ).rejects.toMatchObject({ name: 'CancellationError' });
    expect(yielded).toBe(true);
    // The frame of the call left the engine's stack: the function is usable.
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('49/36');
  };

  test('f(400000)', async () => abortsPromptly((ce) => ce.box(['f', 400000])));
  test('f(400000), numeric', async () =>
    abortsPromptly((ce) => ce.box(['f', 400000]), true));
  test('parsed f(400000)', async () =>
    abortsPromptly((ce) => ce.parse('f(400000)')));
  test('f(Sum), a long argument', async () =>
    abortsPromptly((ce) => ce.box(['f', ['Floor', SLOW_SUM]])));
  test('1 + f(400000)', async () =>
    abortsPromptly((ce) => ce.box(['Add', 1, ['f', 400000]])));
  // A name declared `function` and assigned a literal is a value, not an
  // operator definition: its application takes another route.
  test('a function held as a value', async () =>
    abortsPromptly((ce) => {
      ce.declare('v', 'function');
      ce.assign(
        'v',
        ce.box([
          'Function',
          [
            'Block',
            ['Sum', ['Divide', 1, ['Power', 'k', 2]], ['Limits', 'k', 1, 'n']],
          ],
          'n',
        ])
      );
      return ce.box(['v', 400000]);
    }));
  test('Less(f(400000), 2)', async () =>
    abortsPromptly((ce) => ce.box(['Less', ['f', 400000], 2])));
});

describe('the operators and the functions give the values of the synchronous route', () => {
  const ce = new ComputeEngine();
  defineSumFunction(ce);
  ce.assign(
    'fib',
    ce.box([
      'Function',
      [
        'Block',
        [
          'If',
          ['Less', 'n', 2],
          'n',
          ['Add', ['fib', ['Subtract', 'n', 1]], ['fib', ['Subtract', 'n', 2]]],
        ],
      ],
      'n',
    ])
  );
  ce.assign('g', ce.parse('(a, b) \\mapsto a + b'));
  ce.assign('h', ce.parse('x \\mapsto x + 1'));

  const same = async (mj: any, numericApproximation = false) => {
    const expr = typeof mj === 'string' ? ce.parse(mj) : ce.box(mj);
    const sync = expr.evaluate({ numericApproximation });
    const async = await expr.evaluateAsync({ numericApproximation });
    expect(async.toString()).toBe(sync.toString());
    // `toString()` quotes the symbols `True` and `False`.
    return async.toString().replace(/"/g, '');
  };

  const relations: [string, any, string][] = [
    ['Less(Sum, 2)', ['Less', SMALL_SUM, 2], 'True'],
    ['Less(2, Sum)', ['Less', 2, SMALL_SUM], 'False'],
    ['LessEqual(Sum, Sum)', ['LessEqual', SMALL_SUM, SMALL_SUM], 'True'],
    ['Greater(Sum, 1)', ['Greater', SMALL_SUM, 1], 'True'],
    ['Equal(Sum, Sum)', ['Equal', SMALL_SUM, SMALL_SUM], 'True'],
    ['NotEqual(Sum, 2)', ['NotEqual', SMALL_SUM, 2], 'True'],
    [
      'IdenticallyEqual(1 + 1, 2)',
      ['IdenticallyEqual', ['Add', 1, 1], 2],
      'True',
    ],
    // A comparison that cannot be decided stays inert over the VALUES of its
    // operands, as on the synchronous route.
    [
      'Equal(x^2, 2 + 2)',
      ['Equal', ['Power', 'x', 2], ['Add', 2, 2]],
      'x^2 == 4',
    ],
    ['Less(x, 1 + 1)', ['Less', 'x', ['Add', 1, 1]], 'x < 2'],
    // A chain; the verdict does not depend on the operands after a `False`.
    ['Less(1, 2, 3)', ['Less', 1, 2, 3], 'True'],
    ['Less(3, 2, Sum)', ['Less', 3, 2, SMALL_SUM], 'False'],
    ['Equal(1, 2, Sum)', ['Equal', 1, 2, SMALL_SUM], 'False'],
    // Collections broadcast; absent operands are Kleene.
    ['Less(List, 3)', ['Less', ['List', 1, 5], 3], '[True,False]'],
    ['Equal(List, List)', ['Equal', ['List', 1, 2], ['List', 1, 2]], 'True'],
    ['Equal(Missing, 1)', ['Equal', 'Missing', 1], 'Missing'],
    ['Less(NaN, 1)', ['Less', 'NaN', 1], 'False'],
  ];
  for (const [name, mj, expected] of relations)
    test(`${name} = ${expected}`, async () => {
      expect(await same(mj)).toBe(expected);
    });

  // Under `.N()` a comparison near a tie re-reads the operand as written to
  // decide it exactly: the operands stay with the handler there.
  test('N(1/2 - 10^-30 < 1/2) decides the near tie exactly', async () => {
    const tie = [
      'Less',
      ['Subtract', ['Rational', 1, 2], ['Power', 10, -30]],
      ['Rational', 1, 2],
    ];
    expect(await same(tie, true)).toBe('True');
    expect(await same(['Equal', ['Rational', 1, 10], 0.1], true)).toBe('True');
  });

  // The type of the operand as written decides what an absent value is: a
  // `number | missing` operand reads as `NaN` (a comparison with it is
  // `False`), not as the Kleene `Missing`.
  test('an operand typed number | missing that is Missing reads as NaN', async () => {
    const engine = new ComputeEngine();
    engine.declare('m', { type: 'number | missing' });
    engine.assign('m', engine.Missing);
    const expr = engine.box(['Less', 'm', 1]);
    const sync = expr.evaluate().toString();
    expect((await expr.evaluateAsync()).toString()).toBe(sync);
  });

  test('a user function: values, currying, rest, recursion', async () => {
    expect(await same(['f', 200])).toBe(
      ce.box(['f', 200]).evaluate().toString()
    );
    expect(await same(['f', 200], true)).toBe(
      ce.box(['f', 200]).evaluate({ numericApproximation: true }).toString()
    );
    expect(await same(['g', 1, 2])).toBe('3');
    expect(await same(['g', 1])).toBe(ce.box(['g', 1]).evaluate().toString());
    expect(await same(['h', ['Add', 1, 2]])).toBe('4');
    // A symbolic argument keeps the application, as it does synchronously.
    await same(['h', 'y']);
    await same(['f', 'y']);
    // A recursive body: the inner applications run synchronously.
    expect(await same(['fib', 12])).toBe('144');
    // An application inside a comparison.
    expect(await same(['Less', ['f', 200], 2])).toBe('True');
    // A list argument maps.
    await same(['h', ['List', 1, 2, 3]]);
    // The parse route.
    expect(await same('f(100) + h(1)')).toBe(
      ce.parse('f(100) + h(1)').evaluate().toString()
    );
  });

  test('a function called twice at once, finished in either order', async () => {
    const engine = new ComputeEngine();
    defineSumFunction(engine);
    const expected = (n: number) => engine.box(['f', n]).evaluate().toString();
    const a = engine.box(['f', 800]).evaluateAsync();
    const b = engine.box(['f', 20]).evaluateAsync();
    const c = engine.box(['Add', ['f', 30], ['f', 40]]).evaluateAsync();
    expect((await b).toString()).toBe(expected(20));
    expect((await a).toString()).toBe(expected(800));
    expect((await c).toString()).toBe(
      engine
        .box(['Add', ['f', 30], ['f', 40]])
        .evaluate()
        .toString()
    );
    expect(engine.contextStack.length).toBe(
      new ComputeEngine().contextStack.length
    );
  });

  // The operators that read the structure of an operand do not take the
  // route: an operand of `Numerator` is not evaluated first.
  test('operators that read the structure of an operand are unaffected', async () => {
    expect(
      await same(['Numerator', ['Divide', ['Add', 'x', 1], ['Add', 'x', 2]]])
    ).toBe('x + 1');
    await same(['Numerator', ['Divide', 4, 6]]);
    expect(await same(['IsSame', ['Add', 1, 1], 2])).toBe('False');
    expect(await same(['Same', ['Add', 'x', 1], 1])).toBe('False');
  });
});

describe('evaluatesOperands is declared on a lazy operator', () => {
  test('the flag defaults to false and is set on the relations', () => {
    const ce = new ComputeEngine();
    const flag = (name: string) =>
      (ce.lookupDefinition(name) as any)?.operator?.evaluatesOperands;
    for (const name of [
      'Equal',
      'NotEqual',
      'Less',
      'LessEqual',
      'IdenticallyEqual',
    ])
      expect(flag(name)).toBe(true);
    for (const name of ['Numerator', 'IsSame', 'Same', 'Add'])
      expect(flag(name)).toBe(false);
  });

  test('a declared operator takes the route', async () => {
    const ce = new ComputeEngine();
    ce.declare('Twice', {
      signature: '(number) -> number',
      lazy: true,
      evaluatesOperands: true,
      evaluate: ([x]) => ce.number(2 * (x.evaluate().re ?? 0)),
    } as never);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await expect(
      ce.box(['Twice', SLOW_SUM]).evaluateAsync({ signal: ac.signal })
    ).rejects.toMatchObject({ name: 'CancellationError' });
    expect((await ce.box(['Twice', SMALL_SUM]).evaluateAsync()).re).toBeCloseTo(
      2 * 1.6399,
      3
    );
  });
});
