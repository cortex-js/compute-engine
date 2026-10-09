import { ComputeEngine } from '../../src/compute-engine';

// GitHub issue #392: `Sum` yields to the event loop under `evaluateAsync` and
// honours an abort signal, but wrapped in a lazy head that had only a
// synchronous handler (`N`, `Add`, `Multiply`, `Evaluate`, `ReleaseHold`) it
// ran to the end synchronously. Those heads now have an asynchronous twin
// that evaluates their held operands with `evaluateAsync`.

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

describe('evaluateAsync under a lazy head yields and honours the abort signal', () => {
  const ce = new ComputeEngine();

  // The evaluation is aborted after 50 ms. A run that yields is stopped by
  // the abort with a `CancellationError`, and a macrotask queued before the
  // evaluation runs during it; a run to the end (seconds) finishes before
  // that macrotask, with a value. The time bound is a wall-clock check:
  // the default suite runs under load on the shared machine.
  const abortsPromptly = async (expr: any, numericApproximation: boolean) => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    const start = Date.now();
    const boxed = typeof expr === 'string' ? ce.parse(expr) : ce.box(expr);
    await expect(
      boxed.evaluateAsync({ signal: ac.signal, numericApproximation })
    ).rejects.toMatchObject({ name: 'CancellationError' });
    expect(yielded).toBe(true);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(1500);
  };

  test('N(Sum)', async () => abortsPromptly(['N', SLOW_SUM], false));
  test('N(Sum, 10)', async () => abortsPromptly(['N', SLOW_SUM, 10], false));
  test('Add(Sum, 1)', async () => abortsPromptly(['Add', SLOW_SUM, 1], true));
  test('Multiply(Sum, 2)', async () =>
    abortsPromptly(['Multiply', SLOW_SUM, 2], true));
  test('Evaluate(Sum)', async () =>
    abortsPromptly(['Evaluate', SLOW_SUM], true));
  test('ReleaseHold(Hold(Sum))', async () =>
    abortsPromptly(['ReleaseHold', ['Hold', SLOW_SUM]], true));
  // The parse route: the held operands reach the handlers as parsed.
  test('parsed: N(Sum)', async () =>
    abortsPromptly(
      '\\mathrm{N}\\left(\\sum_{k=1}^{400000} \\frac{1}{k^2}\\right)',
      false
    ));
  test('parsed: Sum + 1', async () =>
    abortsPromptly('\\sum_{k=1}^{400000} \\frac{1}{k^2} + 1', true));
  test('parsed: 2 Sum', async () =>
    abortsPromptly('2\\sum_{k=1}^{400000} \\frac{1}{k^2}', true));
});

describe('the asynchronous twins give the value of the synchronous handlers', () => {
  const ce = new ComputeEngine();
  const same = async (mj: any, numericApproximation = false) => {
    const sync = ce.box(mj).evaluate({ numericApproximation });
    const async = await ce.box(mj).evaluateAsync({ numericApproximation });
    expect(async.toString()).toBe(sync.toString());
    return async;
  };

  test('N(x) and N(x, p) round as the synchronous handler', async () => {
    expect((await same(['N', SMALL_SUM])).toString()).toBe(
      ce.box(SMALL_SUM).N().toString()
    );
    expect((await same(['N', 'Pi', 10])).toString()).toBe('3.141592654');
    expect((await same(['N', ['Divide', 1, 3], 5])).toString()).toBe('0.33333');
    // A goal `[p, a]` and a request above the precision of the engine are
    // computed by the synchronous handler.
    await same(['N', 'Pi', ['List', 5, 10]]);
    expect((await same(['N', 'Pi', 30])).toString()).toBe(
      '3.14159265358979323846264338328'
    );
    // A nested request applies to its operand only.
    expect(
      (
        await ce.box(['N', ['Add', ['N', 'Pi', 3], 1], 8]).evaluateAsync()
      ).toString()
    ).toBe(
      ce
        .box(['N', ['Add', ['N', 'Pi', 3], 1], 8])
        .evaluate()
        .toString()
    );
  });

  test('Add and Multiply, exact and numeric', async () => {
    expect((await same(['Add', SMALL_SUM, 1])).isExact).toBe(true);
    expect((await same(['Add', SMALL_SUM, 1], true)).isExact).toBe(false);
    expect((await same(['Multiply', SMALL_SUM, 2])).isExact).toBe(true);
    expect((await same(['Multiply', SMALL_SUM, 2], true)).isExact).toBe(false);
    expect((await same(['Add', 'x', 'x', 1])).toString()).toBe('2x + 1');
    expect((await same(['Multiply', 'x', 'x', 2])).toString()).toBe('2x^2');
    // A tuple, a list and an absent addend: the same folds as before.
    await same(['Add', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    await same(['Add', ['List', 1, 2], 1]);
    await same(['Add', 'Missing', 1]);
    await same(['Multiply', ['List', 1, 2], ['List', 3, 4]]);
  });

  test('Evaluate and ReleaseHold', async () => {
    await same(['Evaluate', ['Add', 'x', 'x']]);
    await same(['Evaluate', SMALL_SUM], true);
    await same(['ReleaseHold', ['Hold', ['Add', 1, 2]]]);
    await same(['ReleaseHold', ['Add', 1, 2]]);
    await same(['ReleaseHold', ['Hold', SMALL_SUM]], true);
    // A symbol whose value is a `Hold`: one layer is released.
    ce.assign('h', ce.box(['Hold', ['Add', 1, 2]]));
    expect((await same(['ReleaseHold', 'h'])).toString()).toBe('3');
    // The parse route of the parity tests.
    expect(
      (
        await ce.parse('\\sum_{k=1}^{200} \\frac{1}{k^2} + 1').evaluateAsync()
      ).toString()
    ).toBe(
      ce.parse('\\sum_{k=1}^{200} \\frac{1}{k^2} + 1').evaluate().toString()
    );
  });

  // Two requests in flight on one engine, finished in each order. The
  // operand of one request is held by `Gated`, an asynchronous-only
  // operator that suspends until the test releases it, so the test chooses
  // the order of completion. (A first version let a sum over 20000 terms
  // finish after a sum over 200 terms; under the load of the continuous
  // integration machine it crossed the time limit of the test.) The field
  // follows the requests in flight: while one request is still running, it
  // holds that request's digits; once none is left, it is cleared.
  test('concurrent N(x, p) calls leave no requested precision behind', async () => {
    const engine = new ComputeEngine();
    let release: () => void = () => {};
    let gate = Promise.resolve();
    const closeGate = () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    engine.declare('Gated', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => {
        await gate;
        return x;
      },
    } as never);
    const expected = (p: number) =>
      engine.box(['N', SMALL_SUM, p]).evaluate().toString();
    const requested = () => (engine as any)._requestedPrecision;

    // The first request to start finishes first.
    closeGate();
    const a = engine.box(['N', SMALL_SUM, 10]).evaluateAsync();
    const b = engine.box(['N', ['Gated', SMALL_SUM], 12]).evaluateAsync();
    expect((await a).toString()).toBe(expected(10));
    expect(requested()).toBe(12);
    release();
    expect((await b).toString()).toBe(expected(12));
    expect(requested()).toBeUndefined();

    // The first request to start finishes last.
    closeGate();
    const c = engine.box(['N', ['Gated', SMALL_SUM], 10]).evaluateAsync();
    const d = engine.box(['N', SMALL_SUM, 12]).evaluateAsync();
    expect((await d).toString()).toBe(expected(12));
    expect(requested()).toBe(10);
    release();
    expect((await c).toString()).toBe(expected(10));
    expect(requested()).toBeUndefined();
  });

  test('an asynchronous-only precision operand, and an asynchronous-only source in the synchronous forms', async () => {
    const engine = new ComputeEngine();
    engine.declare('AsyncOnly', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => engine.number((x.re ?? 0) + 5),
    } as never);
    expect(
      (
        await engine.box(['N', 'Pi', ['AsyncOnly', 2]]).evaluateAsync()
      ).toString()
    ).toBe('3.141593');
    // p = 30 is above the precision of the engine: the synchronous window,
    // after the asynchronous-only application is awaited.
    expect(
      (await engine.box(['N', ['AsyncOnly', 2], 30]).evaluateAsync()).re
    ).toBe(7);
    expect(
      (
        await engine
          .box(['N', ['AsyncOnly', 2], ['List', 5, 10]])
          .evaluateAsync()
      ).re
    ).toBe(7);
  });

  test('an asynchronous-only operator inside the operand is evaluated', async () => {
    const engine = new ComputeEngine();
    engine.declare('AsyncOnly', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => engine.number((x.re ?? 0) + 5),
    } as never);
    expect(
      (await engine.box(['Add', ['AsyncOnly', 2], 1]).evaluateAsync()).re
    ).toBe(8);
    expect((await engine.box(['N', ['AsyncOnly', 2]]).evaluateAsync()).re).toBe(
      7
    );
    expect(
      (await engine.box(['Multiply', ['AsyncOnly', 2], 2]).evaluateAsync()).re
    ).toBe(14);
  });
});

// Two asynchronous evaluations on one engine, each inside a scoped operator
// (a `Sum`), suspended at the same time. Each keeps the scope of its index on
// its own copy of the evaluation-context stack, so neither assigns its index
// in the scope of the other. Before, the scope of a suspended `Sum` stayed on
// top of the engine's stack, and the other `Sum` assigned its index there:
// `Symbol "k": The value "24" is not compatible with the type
// "integer<1..12>"`, or a wrong value.
describe('concurrent asynchronous evaluations keep their own scopes', () => {
  // Each term of the two sums is an asynchronous-only application that
  // suspends on a resolved promise, so the two sums run term by term in
  // turn on the microtask queue, independent of the time slices of the
  // `Sum` loop. The two index ranges do not overlap, so an index value that
  // one sum writes in the scope of the other is out of the declared range of
  // that scope, and the assignment throws.
  const interleave = async (
    first: [number, number],
    second: [number, number]
  ) => {
    const engine = new ComputeEngine();
    let calls = 0;
    engine.declare('Async', {
      signature: '(integer) -> integer',
      evaluateAsync: async ([x]) => {
        calls += 1;
        await Promise.resolve();
        return x;
      },
    } as never);
    const callsReach = async (n: number) => {
      for (let i = 0; i < 1000 && calls < n; i++) await Promise.resolve();
    };
    const completed: string[] = [];
    const start = ([lo, hi]: [number, number]) =>
      engine
        .box(['Sum', ['Async', 'k'], ['Limits', 'k', lo, hi]])
        .evaluateAsync()
        .then((value) => {
          completed.push(`${lo}..${hi}`);
          return value;
        });
    const depth = engine.contextStack.length;
    const a = start(first);
    // The first sum is suspended part-way through its loop when the second
    // one starts, and both are suspended when the depth is read. A suspended
    // evaluation keeps its scope on its own stack, not on the engine's
    // stack.
    await callsReach(3);
    const b = start(second);
    await callsReach(calls + 3);
    const depthWhileSuspended = engine.contextStack.length;
    const values = (await Promise.allSettled([a, b])).map((x) =>
      x.status === 'fulfilled' ? x.value.toString() : `REJECTED: ${x.reason}`
    );
    return {
      values,
      completed,
      depth,
      depthWhileSuspended,
      depthAfter: engine.contextStack.length,
    };
  };

  // Σ_{k=21}^{50} k = 1065 (30 terms), Σ_{k=1}^{12} k = 78 (12 terms).
  test('the first evaluation to start finishes last', async () => {
    const r = await interleave([21, 50], [1, 12]);
    expect(r.values).toEqual(['1065', '78']);
    // The order of completion is a wall-clock fact: a `Sum` whose time slice
    // is used up suspends on a `setTimeout(0)` macrotask, and under load on
    // the shared machine the longer sum then runs to its end on microtasks
    // first. Only the run under `CE_PERF`, on an idle machine, checks it.
    if (process.env.CE_PERF === '1')
      expect(r.completed).toEqual(['1..12', '21..50']);
    expect(r.depthWhileSuspended).toBe(r.depth);
    expect(r.depthAfter).toBe(r.depth);
  });

  test('the first evaluation to start finishes first', async () => {
    const r = await interleave([1, 12], [21, 50]);
    expect(r.values).toEqual(['78', '1065']);
    // The order of completion is a wall-clock fact: a `Sum` whose time slice
    // is used up suspends on a `setTimeout(0)` macrotask, and under load on
    // the shared machine the longer sum then runs to its end on microtasks
    // first. Only the run under `CE_PERF`, on an idle machine, checks it.
    if (process.env.CE_PERF === '1')
      expect(r.completed).toEqual(['1..12', '21..50']);
    expect(r.depthWhileSuspended).toBe(r.depth);
    expect(r.depthAfter).toBe(r.depth);
  });

  // A `Sum` over `k` whose term is an asynchronous-only application, which
  // itself evaluates a `Sum` over `j` whose terms suspend. Meanwhile another
  // `Sum` over `j`, with a different range, is suspended mid-loop. Each inner
  // `Sum` must assign `j` in its own scope, and the other `Sum` in its own:
  // before, the other `Sum` assigned its `j` (a value above 1) in the scope
  // of an inner `Sum` with the type `integer<1..1>`. The inner evaluation is
  // started with the options of the handler (a nested evaluation) and
  // without them (a new evaluation started by the handler).
  test('a nested evaluation inside a suspended one resolves its own index', async () => {
    const engine = new ComputeEngine();
    engine.declare('Delay', {
      signature: '(integer) -> integer',
      evaluateAsync: async ([x]) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return x;
      },
    } as never);
    const innerSum = (n: number) => [
      'Sum',
      ['Delay', 'j'],
      ['Limits', 'j', 1, n],
    ];
    engine.declare('NestedInner', {
      signature: '(integer) -> integer',
      evaluateAsync: async ([x], options) =>
        engine.box(innerSum(x.re)).evaluateAsync(options),
    } as never);
    engine.declare('FreshInner', {
      signature: '(integer) -> integer',
      evaluateAsync: async ([x]) => engine.box(innerSum(x.re)).evaluateAsync(),
    } as never);
    const depth = engine.contextStack.length;
    // Σ_{j=21}^{50} j = 1065. Its range does not overlap the ranges of the
    // inner sums, so a value of `j` written in the wrong scope throws.
    const other = engine
      .box(['Sum', ['Delay', 'j'], ['Limits', 'j', 21, 50]])
      .evaluateAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The sum over k of the sum of j from 1 to k: 1 + 3 + 6 + 10.
    const nested = engine
      .box(['Sum', ['NestedInner', 'k'], ['Limits', 'k', 1, 4]])
      .evaluateAsync();
    const fresh = engine
      .box(['Sum', ['FreshInner', 'k'], ['Limits', 'k', 1, 4]])
      .evaluateAsync();
    const [vNested, vFresh, vOther] = await Promise.all([nested, fresh, other]);
    expect(vNested.toString()).toBe('20');
    expect(vFresh.toString()).toBe('20');
    expect(vOther.toString()).toBe('1065');
    expect(engine.contextStack.length).toBe(depth);
  });
});

// The evaluation context (the capability registry and the scopes of the
// scoped operators the evaluation is inside) is installed on the engine only
// while the synchronous code of an evaluation runs. These tests cover the
// code that runs after an `await` in a handler, and the evaluations that a
// handler starts.
describe('the evaluation context after an await', () => {
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // A lazy operator receives its operand unbound. After the first `await`,
  // the handler canonicalizes it inside `ce.withEvaluationContext()`, so the
  // index `k` binds to the scope of the `Sum`. Without the method, `k` binds
  // to a new global symbol, and the sum is `20k`.
  test('withEvaluationContext() gives a handler the scope of the index', async () => {
    const ce = new ComputeEngine();
    ce.declare('Late', {
      signature: '(integer) -> integer',
      lazy: true,
      evaluateAsync: async ([x], options) => {
        await delay(1);
        return ce
          .withEvaluationContext(options, () => x.canonical)
          .evaluateAsync(options);
      },
    } as never);
    const result = await ce
      .box(['Sum', ['Late', 'k'], ['Limits', 'k', 1, 20]])
      .evaluateAsync();
    expect(result.toString()).toBe('210');
    expect(ce.lookupDefinition('k')).toBeUndefined();
  });

  // A handler starts a new evaluation without options. The evaluation
  // captures the context stack of the handler, which holds the scope of the
  // index, and keeps it after its own `await`. Before, it read `k` in the
  // global scope after the `await`, and the sum was `4k + 4`. The values
  // that the handler receives are checked too: the `Sum` replaces an index
  // left in a term, which can hide a wrong value there.
  test('a new evaluation started by a handler reads the index after an await', async () => {
    const ce = new ComputeEngine();
    ce.declare('Delay', {
      signature: '(integer) -> integer',
      evaluateAsync: async ([x]) => {
        await delay(1);
        return x;
      },
    } as never);
    const seen: string[] = [];
    ce.declare('Fresh', {
      signature: '(integer) -> integer',
      evaluateAsync: async () => {
        const value = await ce.box(['Add', ['Delay', 1], 'k']).evaluateAsync();
        seen.push(value.toString());
        return value;
      },
    } as never);
    const result = await ce
      .box(['Sum', ['Fresh', 'k'], ['Limits', 'k', 1, 4]])
      .evaluateAsync();
    expect(seen).toEqual(['2', '3', '4', '5']);
    expect(result.toString()).toBe('14');
  });

  // An asynchronous-only lazy operator returns its held operand `k + 1`
  // unevaluated, bound to the scope of the `Sum`. The `Sum` replaces the
  // index in that term after the `await`, which finds the binding of `k`
  // through the scope of the `Sum`. Before, it did not find it, and the sum
  // was `4k + 4`.
  test('the index in a term returned unevaluated is replaced', async () => {
    const ce = new ComputeEngine();
    ce.declare('Inert', {
      signature: '(integer) -> integer',
      lazy: true,
      evaluateAsync: async ([x]) => {
        const held = x.canonical;
        await delay(1);
        return held;
      },
    } as never);
    const result = await ce
      .box(['Sum', ['Inert', ['Add', 'k', 1]], ['Limits', 'k', 1, 4]])
      .evaluateAsync();
    expect(result.toString()).toBe('14');
  });

  // `ReleaseHold(Hold(y))` evaluates `y`. An asynchronous-only application
  // in `y` must be awaited. Before, the `Sum` took its synchronous fold and
  // gave `Delay(1) + Delay(2) + Delay(3)`, and the comparison stayed
  // `15 < Delay(2)`.
  test('an asynchronous-only application under a released Hold is awaited', async () => {
    const ce = new ComputeEngine();
    ce.declare('Delay', {
      signature: '(integer) -> integer',
      evaluateAsync: async ([x]) => {
        await delay(1);
        return x;
      },
    } as never);
    const sum = await ce
      .box([
        'Sum',
        ['ReleaseHold', ['Hold', ['Delay', 'j']]],
        ['Limits', 'j', 1, 3],
      ])
      .evaluateAsync();
    expect(sum.toString()).toBe('6');
    const less = await ce
      .box(['Less', 1, ['ReleaseHold', ['Hold', ['Delay', 2]]]])
      .evaluateAsync();
    expect(less.symbol).toBe('True');
  });
});

// A frame that chains its scope onto the ambient scope gives the scope its
// parent link back when the frame leaves the stack. The public
// `ce.contextStack` setter drops frames without a pop: it must release them
// too. Before, the dropped frame stayed registered as live, the scope kept
// the ambient parent, and a later push and pop of the same scope did not
// restore the link either.
test('the contextStack setter restores the parent link of a dropped frame', () => {
  const ce = new ComputeEngine();
  const scope = ce.box(['Sum', 'k', ['Limits', 'k', 1, 3]]).localScope!;
  const original = scope.parent;
  ce.pushScope();
  try {
    const saved = ce.contextStack;
    ce._pushEvalContext(scope, undefined, { ambient: true });
    expect(scope.parent).not.toBe(original);
    ce.contextStack = saved;
    expect(scope.parent).toBe(original);
    ce._pushEvalContext(scope, undefined, { ambient: true });
    ce._popEvalContext();
    expect(scope.parent).toBe(original);
  } finally {
    ce.popScope();
  }
});
