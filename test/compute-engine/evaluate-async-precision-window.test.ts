import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

// GitHub issue #392, the last part: `N(x, p)` with a working precision above
// the precision of the engine, and a goal `N(x, [p, a])`, ran synchronously
// under `evaluateAsync`, because the precision of the big decimals is one
// value for the whole module and was raised for the time of the computation
// (`_withTransientPrecision`), which could not span an `await`. The working
// precision now travels with the options of the evaluation
// (`EvaluateOptions._precisionWindow`), and each synchronous slice of the
// evaluation raises it when it starts and restores it when it returns
// (`runWithEvaluationEffects`).

const SLOW_SUM = [
  'Sum',
  ['Divide', 1, ['Power', 'k', 2]],
  ['Limits', 'k', 1, 400000],
];
const sum = (body: any, n: number) => ['Sum', body, ['Limits', 'k', 1, n]];

describe('N(x, p) above the precision of the engine, and a goal, yield under evaluateAsync', () => {
  const ce = new ComputeEngine();

  // The evaluation is aborted after 50 ms (see
  // `evaluate-async-lazy-heads.test.ts` for the shape of this check).
  const abortsPromptly = async (expr: any) => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    const start = Date.now();
    await expect(
      ce.box(expr).evaluateAsync({ signal: ac.signal })
    ).rejects.toMatchObject({ name: 'CancellationError' });
    expect(yielded).toBe(true);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(1500);
    // The precision of the engine and of the big decimals is restored, also
    // when the evaluation is aborted, and no request of digits is left.
    expect(ce.precision).toBe(21);
    expect(BigDecimal.precision).toBe(21);
    expect((ce as any)._requestedPrecision).toBeUndefined();
  };

  test('N(Sum, 30)', async () => abortsPromptly(['N', SLOW_SUM, 30]));
  test('N(Sum, [10, 5])', async () =>
    abortsPromptly(['N', SLOW_SUM, ['List', 10, 5]]));
  test('N(Sum, [30, PositiveInfinity])', async () =>
    abortsPromptly(['N', SLOW_SUM, ['List', 30, 'PositiveInfinity']]));
});

describe('the asynchronous windows give the value of the synchronous handler', () => {
  const ce = new ComputeEngine();
  const same = async (mj: any) => {
    const sync = ce.box(mj).evaluate().toString();
    const async = (await ce.box(mj).evaluateAsync()).toString();
    expect(async).toBe(sync);
    return async;
  };

  test('digits above the precision of the engine', async () => {
    expect(await same(['N', 'Pi', 30])).toBe('3.14159265358979323846264338328');
    expect(await same(['N', ['Divide', 1, 3], 50])).toBe(
      '0.33333333333333333333333333333333333333333333333333'
    );
    expect(await same(['N', ['Sqrt', 2], 60])).toBe(
      '1.41421356237309504880168872420969807856967187537694807317668'
    );
    // A float in a symbolic result shows its digits.
    expect(await same(['N', ['Add', 'x', 'Pi'], 50])).toBe(
      'x + 3.1415926535897932384626433832795028841971693993751'
    );
    // The guard digits: `N(Exp(i), 30)` had a real part that ended with
    // ...444 when computed at 30 digits.
    expect(await same(['N', ['Exp', 'ImaginaryUnit'], 30])).toBe(
      '(0.540302305868139717400936607443 + 0.84147098480789650665250232163i)'
    );
    // A long operand, computed term by term inside the window.
    expect(
      await same(['N', sum(['Divide', 1, ['Power', 'k', 2]], 200), 40])
    ).toBe('1.63994654601499726794569455282818613229');
  });

  test('a nested request applies to its operand only', async () => {
    expect(await same(['N', ['Add', ['N', 'Pi', 3], 1], 8])).toBe('4.14');
    expect(await same(['N', ['Add', ['N', 'Pi', 30], 1], 40])).toBe(
      ce
        .box(['N', ['Add', ['N', 'Pi', 30], 1], 40])
        .evaluate()
        .toString()
    );
  });

  test('goals', async () => {
    expect(await same(['N', 'Pi', ['List', 5, 10]])).toBe('3.1416');
    expect(
      await same([
        'N',
        sum(['Divide', 1, ['Power', 'k', 2]], 200),
        ['List', 30, 'PositiveInfinity'],
      ])
    ).toBe('1.63994654601499726794569455283');
    // A value with no float needs no second evaluation.
    expect(await same(['N', 2, ['List', 'PositiveInfinity', 20]])).toBe('2');
    // A cancellation at the first working precisions: the precision is
    // raised until the float is not `0`.
    expect(
      await same([
        'N',
        ['Subtract', ['Exp', ['Power', 10, -100]], 1],
        ['List', 20, 'PositiveInfinity'],
      ])
    ).toBe('1e-100');
  });

  test('a constant is not cached at the raised precision', async () => {
    await ce.box(['N', 'Pi', 60]).evaluateAsync();
    expect(ce.box('Pi').N().toString()).toBe('3.14159265358979323846');
    expect(ce.precision).toBe(21);
    expect(BigDecimal.precision).toBe(21);
  });
});

describe('windows of different precisions interleave on one engine', () => {
  // Both evaluations are suspended at the gate at the same time, so each
  // slice that follows the release runs with the other window open.
  const gated = (ce: ComputeEngine) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ce.declare('Gated', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => {
        await gate;
        return x;
      },
    } as never);
    return () => release();
  };

  test('each evaluation computes at its own working precision', async () => {
    const ce = new ComputeEngine();
    const release = gated(ce);
    const s2 = sum(['Divide', 1, ['Power', 'k', 2]], 600);
    const s3 = sum(['Divide', 1, ['Power', 'k', 3]], 600);
    const s4 = sum(['Divide', 1, ['Power', 'k', 4]], 600);
    const a = ce.box(['N', ['Add', ['Gated', 0], s2], 40]).evaluateAsync();
    const b = ce.box(['N', ['Add', ['Gated', 0], s3], 25]).evaluateAsync();
    const c = ce
      .box(['Add', ['Gated', 0], s4])
      .evaluateAsync({ numericApproximation: true });
    // Nothing of a window is left on the engine while the evaluations are
    // suspended.
    expect(ce.precision).toBe(21);
    expect(BigDecimal.precision).toBe(21);
    expect((ce as any)._requestedPrecision).toBeUndefined();
    release();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra.toString()).toBe(ce.box(['N', s2, 40]).evaluate().toString());
    expect(rb.toString()).toBe(ce.box(['N', s3, 25]).evaluate().toString());
    expect(rc.toString()).toBe(ce.box(s4).N().toString());
    expect(ra.toString()).toBe('1.643268788298844149091592070251938120721');
    expect(rb.toString()).toBe('1.202055516583591200766103');
    expect(rc.toString()).toBe('1.08232323217178205298');
    expect(ce.precision).toBe(21);
    expect(BigDecimal.precision).toBe(21);
    expect((ce as any)._requestedPrecision).toBeUndefined();
  });

  test('a goal and a window at the same time', async () => {
    const ce = new ComputeEngine();
    const release = gated(ce);
    const s2 = sum(['Divide', 1, ['Power', 'k', 2]], 600);
    const goal = [
      'N',
      ['Add', ['Gated', 0], s2],
      ['List', 30, 'PositiveInfinity'],
    ];
    const a = ce.box(goal).evaluateAsync();
    const b = ce.box(['N', ['Add', ['Gated', 0], 'Pi'], 50]).evaluateAsync();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.toString()).toBe(
      ce
        .box(['N', s2, ['List', 30, 'PositiveInfinity']])
        .evaluate()
        .toString()
    );
    expect(rb.toString()).toBe(ce.box(['N', 'Pi', 50]).evaluate().toString());
    expect(ce.precision).toBe(21);
  });

  test('the handlers of each evaluation receive its own requested digits', async () => {
    // `ce._requestedPrecision` is one engine field: it is installed for each
    // slice from the window the evaluation carries, so a handler that reads
    // `options.precision` sees the digits of ITS call, not the digits of
    // the request that started last.
    const ce = new ComputeEngine();
    const release = gated(ce);
    const seen: number[] = [];
    // Impure, so that `Probe(1)` is never folded at canonicalization (a
    // pure application over a literal is), where it would see no request.
    ce.declare('Probe', {
      signature: '(number) -> number',
      pure: false,
      evaluate: ([x], { precision }) => {
        seen.push(precision ?? -1);
        return x;
      },
    } as never);
    const a = ce.box(['N', ['Probe', ['Gated', 1]], 30]).evaluateAsync();
    const b = ce.box(['N', ['Probe', ['Gated', 1]], 50]).evaluateAsync();
    const c = ce.box(['N', ['Probe', ['Gated', 1]], 10]).evaluateAsync();
    const d = ce
      .box(['Probe', ['Gated', 1]])
      .evaluateAsync({ numericApproximation: true });
    expect((ce as any)._requestedPrecision).toBeUndefined();
    release();
    await Promise.all([a, b, c, d]);
    // Each window's probe saw that window's digits, once; every other probe
    // (the plain evaluation, and a probe at canonicalization) saw the
    // precision of the engine. The order of the slices after the release is
    // not fixed.
    for (const digits of [30, 50, 10])
      expect(seen.filter((p) => p === digits)).toHaveLength(1);
    expect(seen.every((p) => [30, 50, 10, 21].includes(p))).toBe(true);
    expect(seen.filter((p) => p === 21).length).toBeGreaterThanOrEqual(1);
    expect((ce as any)._requestedPrecision).toBeUndefined();
  });
});

describe('the asynchronous windows agree with the synchronous route in the cases the review found', () => {
  const ce = new ComputeEngine();
  const same = async (mj: any) => {
    const sync = ce.box(mj).evaluate().toString();
    const async = (await ce.box(mj).evaluateAsync()).toString();
    expect(async).toBe(sync);
    return async;
  };

  test('a nested call computes at the wider of the two windows', async () => {
    // The inner window (35 digits) is narrower than the outer one (110): the
    // inner operand is computed at 110 digits, where the cancellation
    // `e^(10^-40) - 1` keeps its value.
    expect(
      await same([
        'N',
        ['N', ['Subtract', ['Exp', ['Power', 10, -40]], 1], 30],
        100,
      ])
    ).toBe('1e-40');
    expect(
      await same([
        'N',
        ['List', ['N', ['Subtract', ['Exp', ['Power', 10, -20]], 1], 25]],
        50,
      ])
    ).toBe('[1.000000000000000000005e-20]');
  });

  test('the sum and product finalizations run inside the window', async () => {
    expect(
      await same([
        'N',
        ['Sum', ['List', ['Divide', 1, 3], ['Power', 10, -200]]],
        60,
      ])
    ).toBe('0.333333333333333333333333333333333333333333333333333333333333');
    expect(
      await same([
        'N',
        [
          'Product',
          ['Add', 1, ['Divide', 1, ['Power', 'k', 3]]],
          ['Limits', 'k', 1, 30],
        ],
        60,
      ])
    ).toBe('2.42688537476131272141184646750822858729251746899693110694858');
  });

  test('an operand evaluation a handler starts with its own options keeps the window', async () => {
    ce.declare('Id', {
      signature: '(number) -> number',
      evaluate: ([x], o) =>
        x.evaluate({ numericApproximation: o.numericApproximation }),
      evaluateAsync: async ([x], o) =>
        x.evaluateAsync({
          numericApproximation: o.numericApproximation,
          signal: o.signal,
        }),
    } as never);
    // A sum long enough to be suspended once at least (`runAsync` yields
    // every 16 ms): the slices after the suspension must still run inside
    // the window.
    expect(
      await same(['N', ['Id', sum(['Divide', 1, ['Power', 'k', 2]], 1500)], 40])
    ).toBe('1.644267622354399280368161372582398611868');
    expect(await same(['N', ['Id', 'Pi'], 40])).toBe(
      '3.141592653589793238462643383279502884197'
    );
  }, 20000);

  test('an asynchronous-only application is evaluated before the synchronous re-evaluations', async () => {
    ce.declare('AsyncOnly', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => ce.number((x.re ?? 0) + 5),
    } as never);
    // The exact value of the goal run sees the application evaluated: the
    // true zero is not taken for a cancellation.
    expect(
      (
        await ce
          .box([
            'N',
            ['Sin', ['Multiply', 'Pi', ['Subtract', ['AsyncOnly', 2], 6]]],
            ['List', 10, 'PositiveInfinity'],
          ])
          .evaluateAsync()
      ).toString()
    ).toBe('0');
    expect(
      (
        await ce.box(['N', ['Add', ['AsyncOnly', 2], 'Pi'], 30]).evaluateAsync()
      ).toString()
    ).toBe('10.1415926535897932384626433833');
  });
});

describe('the asynchronous windows agree with the synchronous route: second review round', () => {
  const ce = new ComputeEngine();
  const same = async (mj: any) => {
    const sync = ce.box(mj).evaluate().toString();
    const async = (await ce.box(mj).evaluateAsync()).toString();
    expect(async).toBe(sync);
    return async;
  };

  test('a fixed float local to a Block is seen by the reference decision', async () => {
    // The decision whether the rounding needs a reference value resolves
    // the names of the operand through the context stack of the evaluation,
    // so it runs in a slice. A fixed float shows the precision of the engine
    // on both routes.
    expect(
      await same([
        'Block',
        ['Declare', 'c', 'real'],
        ['Assign', 'c', { num: '1.234567890123456789012345678901234' }],
        ['N', ['Add', 'c', 'x'], 30],
      ])
    ).toBe('x + 1.23456789012345678901');
  });

  test('a goal whose values cancel to zero awaits the exact value', async () => {
    expect(
      await same([
        'N',
        [
          'Sum',
          ['Subtract', ['Exp', ['Divide', 'k', ['Power', 10, 100]]], 1],
          ['Limits', 'k', 1, 50],
        ],
        ['List', 10, 'PositiveInfinity'],
      ])
    ).toBe('1.275e-97');
    // The exact value of a long operand is awaited, so the goal still
    // honours the abort signal when its first values are a float `0`.
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await expect(
      ce
        .box([
          'N',
          [
            'Sum',
            ['Subtract', ['Exp', ['Divide', 'k', ['Power', 10, 100]]], 1],
            ['Limits', 'k', 1, 400000],
          ],
          ['List', 10, 'PositiveInfinity'],
        ])
        .evaluateAsync({ signal: ac.signal })
    ).rejects.toMatchObject({ name: 'CancellationError' });
    expect(ce.precision).toBe(21);
    expect(BigDecimal.precision).toBe(21);
  });

  test('the plain form evaluates an asynchronous-only application in order with its siblings', async () => {
    // Only the window and goal forms resolve the asynchronous-only
    // applications of the operand ahead of its evaluation; the plain form
    // and a request within the precision of the engine evaluate the operand
    // whole, so a synchronous sibling with an effect runs first, as in the
    // evaluation of the list itself.
    let counter = 0;
    ce.declare('Tick', {
      signature: '() -> number',
      pure: false,
      evaluate: () => {
        counter += 1;
        return ce.number(counter);
      },
    } as never);
    ce.declare('AsyncRead', {
      signature: '() -> number',
      pure: false,
      evaluateAsync: async () => ce.number(counter),
    } as never);
    const list = ['List', ['Tick'], ['AsyncRead']];
    counter = 0;
    const reference = (
      await ce.box(list).evaluateAsync({ numericApproximation: true })
    ).toString();
    counter = 0;
    expect((await ce.box(['N', list]).evaluateAsync()).toString()).toBe(
      reference
    );
    counter = 0;
    expect((await ce.box(['N', list, 10]).evaluateAsync()).toString()).toBe(
      reference
    );
    expect(reference).toBe('[1,1]');
  });

  test('opaque pure handlers compute in the window and allow reference evaluations', async () => {
    const syncSeen: number[] = [];
    const asyncSeen: number[] = [];
    ce.declare('SyncPi', {
      signature: '() -> number',
      evaluate: () => {
        syncSeen.push(ce.precision);
        return ce.box('Pi').N();
      },
    });
    ce.declare('AsyncPi', {
      signature: '() -> number',
      evaluateAsync: async () => {
        asyncSeen.push(ce.precision);
        return ce.box('Pi').N();
      },
    } as never);
    const sync = ce.box(['N', ['Add', ['SyncPi'], 0], 50]).evaluate();
    const async = await ce
      .box(['N', ['Add', ['AsyncPi'], 0], 50])
      .evaluateAsync();
    expect(async.toString()).toBe(sync.toString());
    expect(async.toString()).toBe(
      '3.1415926535897932384626433832795028841971693993751'
    );
    expect(syncSeen).toEqual([55, 21]);
    // An opaque handler can return a stored float instead of computing at
    // the working precision. Both routes need a base-precision reference
    // to distinguish those cases. The async route also awaits the exact
    // value before the rounding slice, where another await is not possible.
    // A pure handler does not have a single-invocation contract.
    expect(asyncSeen[0]).toBe(55);
    expect(asyncSeen).toContain(21);
    expect(
      asyncSeen.every((precision) => precision === 55 || precision === 21)
    ).toBe(true);
    expect(ce.precision).toBe(21);
  });

  test('opaque handlers returning a fixed float retain its base display precision', async () => {
    const fixed = ce.box({
      num: '1.234567890123456789012345678901234567890123456789',
    });
    ce.declare('SyncFixed', {
      signature: '() -> number',
      evaluate: () => fixed,
    });
    ce.declare('AsyncFixed', {
      signature: '() -> number',
      evaluateAsync: async () => fixed,
    } as never);
    const sync = ce.box(['N', ['Add', ['SyncFixed'], 0], 50]).evaluate();
    const async = await ce
      .box(['N', ['Add', ['AsyncFixed'], 0], 50])
      .evaluateAsync();
    expect(async.toString()).toBe(sync.toString());
    expect(async.toString()).toBe('1.23456789012345678901');
    expect(ce.precision).toBe(21);
  });
});
