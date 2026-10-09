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

  // The asynchronous route runs first: a synchronous application of a pure
  // function to numbers fills the application memo, and the asynchronous
  // route would then answer from the memo without running its body.
  const same = async (mj: any, numericApproximation = false) => {
    const expr = typeof mj === 'string' ? ce.parse(mj) : ce.box(mj);
    const async = await expr.evaluateAsync({ numericApproximation });
    const sync = expr.evaluate({ numericApproximation });
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

describe('a chain stops where the synchronous route stops', () => {
  // `Less(3, 2, X)` is `False` at its first pair: `X` is never evaluated
  // by `evaluate()`, and not by `evaluateAsync()` either.
  test('the operands after a False pair do not run', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', { type: 'integer', value: 0 });
    const expr = ce.box([
      'Less',
      3,
      2,
      ['Block', ['Assign', 'n', ['Add', 'n', 1]], 'n'],
    ]);
    expect(expr.evaluate().toString()).toBe('"False"');
    expect((await expr.evaluateAsync()).toString()).toBe('"False"');
    expect(ce.box('n').evaluate().toString()).toBe('0');
    // A long third operand: the chain answers at once, no abort.
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const long = ce.box(['Less', 3, 2, SLOW_SUM]);
    const start = Date.now();
    expect((await long.evaluateAsync({ signal: ac.signal })).toString()).toBe(
      '"False"'
    );
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(1000);
  });

  // A `Missing` operand next to a long one: the long operand runs once, on
  // the asynchronous route, and the comparison is `Missing`.
  test('an absent operand next to a long one still yields', async () => {
    const ce = new ComputeEngine();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await expect(
      ce.box(['Less', 'Missing', SLOW_SUM]).evaluateAsync({ signal: ac.signal })
    ).rejects.toMatchObject({ name: 'CancellationError' });
    expect(
      (await ce.box(['Less', 'Missing', SMALL_SUM]).evaluateAsync()).toString()
    ).toBe('"Missing"');
    expect(
      (
        await ce.box(['IdenticallyEqual', 'Missing', SMALL_SUM]).evaluateAsync()
      ).toString()
    ).toBe('"Missing"');
  });
});

describe('a suspended application does not hold back other applications', () => {
  // While `f(400000)` is suspended, `f(y)` with `y` free stays inert on the
  // synchronous route (its recursion guard sees no re-entry), and the same
  // literal on another engine yields and aborts on its own.
  test('a concurrent application with a free symbol stays inert', async () => {
    const ce = new ComputeEngine();
    defineSumFunction(ce);
    const ac = new AbortController();
    const suspended = ce
      .box(['f', 400000])
      .evaluateAsync({ signal: ac.signal });
    // Let the application reach its first `await`.
    await new Promise((resolve) => setImmediate(resolve));
    // The same answer as on an engine with nothing suspended: the body
    // applied to `y`, and no `SymbolicRecursion` escaping `evaluate()`.
    const alone = new ComputeEngine();
    defineSumFunction(alone);
    expect(ce.box(['f', 'y']).evaluate().toString()).toBe(
      alone.box(['f', 'y']).evaluate().toString()
    );
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('49/36');
    ac.abort();
    await expect(suspended).rejects.toMatchObject({
      name: 'CancellationError',
    });
  });

  test('an identical literal on another engine yields too', async () => {
    const ce1 = new ComputeEngine();
    const ce2 = new ComputeEngine();
    defineSumFunction(ce1);
    defineSumFunction(ce2);
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const first = ce1.box(['f', 400000]).evaluateAsync({ signal: ac1.signal });
    await new Promise((resolve) => setImmediate(resolve));
    setTimeout(() => ac2.abort(), 50);
    await expect(
      ce2.box(['f', 400000]).evaluateAsync({ signal: ac2.signal })
    ).rejects.toMatchObject({ name: 'CancellationError' });
    ac1.abort();
    await expect(first).rejects.toMatchObject({ name: 'CancellationError' });
  });

  // A value the body reads is reassigned while the application is
  // suspended: the result of that application is not kept in the memo, so
  // the next application sees the new value.
  test('a result computed before a concurrent assignment is not memoized', async () => {
    const ce = new ComputeEngine();
    ce.assign('a', 1);
    // `Multiply` reads `a` before it awaits the sum (about 300 ms).
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Multiply',
            'a',
            ['Sum', ['Divide', 1, ['Power', 'k', 2]], ['Limits', 'k', 1, 'n']],
          ],
        ],
        'n',
      ])
    );
    const sum = ce
      .box(['Sum', ['Divide', 1, ['Power', 'k', 2]], ['Limits', 'k', 1, 1200]])
      .evaluate();
    const pending = ce.box(['g', 1200]).evaluateAsync();
    await new Promise((resolve) => setImmediate(resolve));
    ce.assign('a', 2);
    expect((await pending).isSame(sum)).toBe(true);
    expect(ce.box(['g', 1200]).evaluate().isSame(sum.mul(2))).toBe(true);
    // Without interference the asynchronous route memoizes: a second
    // application, to an argument no synchronous application has seen, is
    // answered from the memo.
    const start = Date.now();
    const value = await ce.box(['g', 1000]).evaluateAsync();
    const first = Date.now() - start;
    const again = Date.now();
    expect((await ce.box(['g', 1000]).evaluateAsync()).isSame(value)).toBe(
      true
    );
    if (process.env.CE_PERF === '1')
      expect(Date.now() - again).toBeLessThan(first / 4);
  }, 30000);
});

describe('evaluatesOperands is declared on a lazy operator', () => {
  test('the flag defaults to false, and the chainable relations have an evaluateAsync twin instead', () => {
    const ce = new ComputeEngine();
    const def = (name: string) => (ce.lookupDefinition(name) as any)?.operator;
    expect(def('IdenticallyEqual').evaluatesOperands).toBe(true);
    for (const name of ['Equal', 'NotEqual', 'Less', 'LessEqual']) {
      expect(def(name).evaluatesOperands).toBe(false);
      expect(typeof def(name).evaluateAsync).toBe('function');
    }
    for (const name of ['Numerator', 'IsSame', 'Same', 'Add'])
      expect(def(name).evaluatesOperands).toBe(false);
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

// The audit of the lazy operators with a synchronous handler only (issue
// #392, third part). An operator whose handler demands and evaluates every
// held operand takes the `evaluatesOperands` route; one that evaluates only
// some of its operands, or stops early, has an `evaluateAsync` twin that
// shares its code with the synchronous handler.

// A callback that is long for a collection operator: for the element `k`, the
// sum has `200 k` terms.
const SLOW_TERM = [
  'Sum',
  ['Divide', 1, ['Power', 'j', 2]],
  ['Limits', 'j', 1, ['Multiply', 200, 'k']],
];
const SLOW_CALLBACK = ['Function', ['Less', SLOW_TERM, 0], 'k'];
const SLOW_KEY = ['Function', ['Negate', SLOW_TERM], 'k'];
const SLOW_ROWS = ['Range', 1, 5000];
const FLOOR_SUM = ['Floor', ['Multiply', 100, SLOW_SUM]];

describe('the audited operators yield and honour the abort signal', () => {
  const ce = new ComputeEngine();

  const abortsPromptly = async (expr: any) => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    await expect(
      ce.box(expr).evaluateAsync({ signal: ac.signal })
    ).rejects.toMatchObject({ name: 'CancellationError' });
    expect(yielded).toBe(true);
  };

  const cases: [string, any][] = [
    // The flag route
    ['Measurement(Sum, 0.1)', ['Measurement', SLOW_SUM, 0.1]],
    ['PowerMod(Floor(Sum), 3, 7)', ['PowerMod', FLOOR_SUM, 3, 7]],
    ['PowerModList(Floor(Sum), 1, 7)', ['PowerModList', FLOOR_SUM, 1, 7]],
    ['ResidueClass(Floor(Sum), 7)', ['ResidueClass', FLOOR_SUM, 7]],
    // The twins that evaluate one operand, or the operands in order
    [
      'Annotated(Sum, style)',
      ['Annotated', SLOW_SUM, ['Dictionary', ['Tuple', "'color'", "'blue'"]]],
    ],
    ["Typed(Sum, 'real')", ['Typed', SLOW_SUM, "'real'"]],
    ['Delimiter(Sum)', ['Delimiter', SLOW_SUM]],
    ['Delimiter(Sequence(Sum, 1))', ['Delimiter', ['Sequence', SLOW_SUM, 1]]],
    ['IsError(Sum)', ['IsError', SLOW_SUM]],
    ['Simplify(Sum)', ['Simplify', SLOW_SUM]],
    [
      'Matrix([[Sum, 2], [3, 4]])',
      ['Matrix', ['List', ['List', SLOW_SUM, 2], ['List', 3, 4]]],
    ],
    ["Quantity(Sum, 'm')", ['Quantity', SLOW_SUM, 'm']],
    [
      "UnitConvert(Quantity(Sum, 'm'), 'km')",
      ['UnitConvert', ['Quantity', SLOW_SUM, 'm'], 'km'],
    ],
    // The twins that walk a collection, one element at a time
    ['Any(xs, slow callback)', ['Any', SLOW_ROWS, SLOW_CALLBACK]],
    [
      'All(xs, slow callback)',
      ['All', SLOW_ROWS, ['Function', ['Not', ['Less', SLOW_TERM, 0]], 'k']],
    ],
    ['MaxBy(xs, slow key)', ['MaxBy', SLOW_ROWS, SLOW_KEY]],
    ['MinBy(xs, slow key)', ['MinBy', SLOW_ROWS, SLOW_KEY]],
    ['ArgMax(xs, slow key)', ['ArgMax', SLOW_ROWS, SLOW_KEY]],
    ['ArgMin(xs, slow key)', ['ArgMin', SLOW_ROWS, SLOW_KEY]],
    [
      'Reduce(xs, (a, k) => a + Sum, 0)',
      ['Reduce', SLOW_ROWS, ['Function', ['Add', 'a', SLOW_TERM], 'a', 'k'], 0],
    ],
    [
      'Fold((a, k) => a + Sum, 0, xs)',
      ['Fold', ['Function', ['Add', 'a', SLOW_TERM], 'a', 'k'], 0, SLOW_ROWS],
    ],
  ];
  for (const [name, expr] of cases)
    test(name, async () => abortsPromptly(expr));
});

describe('the audited operators give the values of evaluate()', () => {
  const small = [
    'Sum',
    ['Divide', 1, ['Power', 'k', 2]],
    ['Limits', 'k', 1, 20],
  ];
  const addK = ['Function', ['Add', 'a', 'k'], 'a', 'k'];
  const cases: [string, any][] = [
    ['Measurement', ['Measurement', small, 0.1]],
    ['PowerMod', ['PowerMod', ['Floor', ['Multiply', 100, small]], 3, 7]],
    ['PowerMod, inert (modulus 0)', ['PowerMod', ['Add', 2, 3], 3, 0]],
    ['PowerMod, symbolic', ['PowerMod', 'x', 3, 7]],
    [
      'PowerModList',
      ['PowerModList', ['Floor', ['Multiply', 100, small]], 1, 7],
    ],
    ['PowerModList, inert', ['PowerModList', ['Add', 2, 3], 1, 'y']],
    ['ResidueClass', ['ResidueClass', ['Floor', ['Multiply', 100, small]], 7]],
    ['ResidueClass, symbolic', ['ResidueClass', ['Add', 'x', 1], 7]],
    [
      'Annotated',
      ['Annotated', small, ['Dictionary', ['Tuple', "'color'", "'blue'"]]],
    ],
    ['Typed', ['Typed', small, "'real'"]],
    ['Delimiter', ['Delimiter', small]],
    ['Delimiter of a Sequence', ['Delimiter', ['Sequence', small, 1]]],
    ['IsError', ['IsError', small]],
    ['Simplify', ['Simplify', ['Add', small, 'x', ['Negate', 'x']]]],
    [
      'Simplify under an assumption',
      ['Simplify', ['Sqrt', ['Power', 'x', 2]], ['Greater', 'x', 0]],
    ],
    ['Matrix', ['Matrix', ['List', ['List', small, 2], ['List', 3, 4]]]],
    ['Quantity', ['Quantity', small, 'm']],
    ['UnitConvert', ['UnitConvert', ['Quantity', small, 'm'], 'km']],
    ['UnitConvert of a number', ['UnitConvert', 5, 'km']],
    ['Any', ['Any', ['Range', 1, 5], ['Function', ['Equal', 'k', 3], 'k']]],
    [
      'Any, none',
      ['Any', ['Range', 1, 5], ['Function', ['Equal', 'k', 9], 'k']],
    ],
    ['All', ['All', ['Range', 1, 5], ['Function', ['Less', 'k', 3], 'k']]],
    ['All, empty', ['All', ['List'], ['Function', ['Less', 'k', 3], 'k']]],
    ['MaxBy', ['MaxBy', ['List', 3, 1, 2], ['Function', ['Negate', 'k'], 'k']]],
    ['MinBy', ['MinBy', ['List', 3, 1, 2], ['Function', ['Negate', 'k'], 'k']]],
    ['ArgMax', ['ArgMax', ['List', 3, 1, 2]]],
    ['ArgMin', ['ArgMin', ['List', 3, 1, 2]]],
    ['Reduce', ['Reduce', ['Range', 1, 5], addK, 0]],
    ['Reduce, no seed', ['Reduce', ['Range', 1, 5], 'Add']],
    ['Fold', ['Fold', addK, small, ['Range', 1, 5]]],
    ['Fold, empty', ['Fold', addK, ['Add', 1, 2], ['List']]],
  ];
  for (const [name, expr] of cases) {
    for (const numeric of [false, true]) {
      test(`${name}${numeric ? ', N' : ''}`, async () => {
        const ce = new ComputeEngine();
        const sync = ce
          .box(expr)
          .evaluate({ numericApproximation: numeric })
          .toString();
        const async_ = (
          await ce.box(expr).evaluateAsync({ numericApproximation: numeric })
        ).toString();
        expect(async_).toBe(sync);
      });
    }
  }

  test('MemberCall: the resolved call is evaluated', async () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('[3, 1, 2].Sort()');
    expect((await expr.evaluateAsync()).toString()).toBe(
      expr.evaluate().toString()
    );
  });
});

describe('the audited twins stop where the synchronous handler stops', () => {
  const probed = () => {
    const ce = new ComputeEngine();
    const calls: number[] = [];
    ce.declare('Probe', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        calls.push(x.re);
        return x;
      },
    } as never);
    return { ce, calls };
  };

  const cases: [string, any, string][] = [
    [
      'Any stops at the first True',
      ['Any', ['Range', 1, 5], ['Function', ['Equal', ['Probe', 'k'], 2], 'k']],
      'True',
    ],
    [
      'All stops at the first False',
      ['All', ['Range', 1, 5], ['Function', ['Less', ['Probe', 'k'], 3], 'k']],
      'False',
    ],
    // The unit stays as written: it is not evaluated.
    ['Quantity does not evaluate its unit', ['Quantity', 2, ['Probe', 3]], ''],
    [
      'UnitConvert does not evaluate its target',
      ['UnitConvert', ['Quantity', 2, 'm'], ['Probe', 3]],
      '',
    ],
  ];
  for (const [name, expr, expected] of cases)
    test(name, async () => {
      const a = probed();
      const sync = a.ce.box(expr).evaluate();
      const b = probed();
      const async_ = await b.ce.box(expr).evaluateAsync();
      expect(async_.toString()).toBe(sync.toString());
      if (expected) expect(async_.toString()).toBe(`"${expected}"`);
      expect(b.calls).toEqual(a.calls);
    });

  test('the elements after the decision are not visited', async () => {
    const { ce, calls } = probed();
    await ce
      .box([
        'Any',
        ['Range', 1, 5],
        ['Function', ['Equal', ['Probe', 'k'], 2], 'k'],
      ])
      .evaluateAsync();
    expect(calls).toEqual([1, 2]);
  });
});

describe('every lazy operator with a synchronous handler is accounted for', () => {
  // The lazy operators that have a synchronous handler and neither an
  // `evaluateAsync` twin nor `evaluatesOperands`, and that no other route
  // covers (`selectsOperands`, `scoped`, `holdClass: 'quote'`). Each reads
  // the structure of its operand, builds a definition or a binding, or hands
  // the operand to a synchronous computation. Adding a lazy operator means
  // deciding which of the three routes it takes, and adding it here if none.
  const SYNCHRONOUS = new Set([
    'About',
    'Apart',
    'Assign',
    'Assume',
    'Cancel',
    'CoefficientList',
    'Condition',
    'Conforms',
    'Declare',
    'DeclareConformance',
    'DeclareProtocol',
    'DeclareSumType',
    'DeclareType',
    'DefineFunction',
    'Denominator',
    'Derivative',
    'Discriminant',
    'Distribute',
    'DSolve',
    'EvaluateAt',
    'Expand',
    'ExpandAll',
    'Factor',
    'FindFit',
    'FindRoot',
    'FlatMap',
    'Function',
    'Head',
    'HoldValues',
    'InterpolatingFunction',
    'Interpret',
    'InverseFunction',
    'IsCompatibleUnit',
    'IsSame',
    'JacobianMatrix',
    'Limit',
    'Match',
    'MatchesType',
    'ND',
    'NDSolve',
    'NIntegrate',
    'NLimit',
    'Numerator',
    'NumeratorDenominator',
    'NumericApproximation',
    'PartialFraction',
    'Pipe',
    'Polynomial',
    'PolynomialDegree',
    'PolynomialGCD',
    'PolynomialQuotient',
    'PolynomialRemainder',
    'PolynomialRoots',
    'Predicate',
    'ReplaceAll',
    'Residue',
    'Resultant',
    'RSolve',
    'Rule',
    'Same',
    'Signature',
    'Solve',
    'Spread',
    'Subscript',
    'Symbol',
    'Tail',
    'Timing',
    'Together',
    'TrigExpand',
    'TrigReduce',
    'TrigToExp',
    'Type',
    'Unevaluated',
    'UnitDimension',
    'When',
    'WithRandomSeed',
  ]);

  test('the set is exact', () => {
    const ce = new ComputeEngine() as any;
    const found: string[] = [];
    for (
      let scope = ce.context.lexicalScope;
      scope !== undefined;
      scope = scope.parent
    )
      for (const [name, def] of scope.bindings) {
        const d = def.operator ?? def;
        if (
          d?.lazy === true &&
          d.evaluate !== undefined &&
          d.evaluateAsync === undefined &&
          !d.evaluatesOperands &&
          !d.selectsOperands &&
          !d.scoped &&
          d.holdClass !== 'quote'
        )
          found.push(name);
      }
    expect(found.sort()).toEqual([...SYNCHRONOUS].sort());
  });

  test('the operators with the flag, and the twins', () => {
    const ce = new ComputeEngine();
    const def = (name: string) => (ce.lookupDefinition(name) as any)?.operator;
    for (const name of [
      'IdenticallyEqual',
      'Measurement',
      'PowerMod',
      'PowerModList',
      'ResidueClass',
    ]) {
      expect(def(name).evaluatesOperands).toBe(true);
      expect(def(name).evaluateAsync).toBeUndefined();
    }
    for (const name of [
      'Annotated',
      'Typed',
      'Delimiter',
      'IsError',
      'Simplify',
      'Matrix',
      'Quantity',
      'UnitConvert',
      'MemberCall',
      'Any',
      'All',
      'MaxBy',
      'MinBy',
      'ArgMax',
      'ArgMin',
      'Reduce',
    ]) {
      expect(def(name).evaluatesOperands).toBe(false);
      expect(typeof def(name).evaluateAsync).toBe('function');
    }
  });
});
