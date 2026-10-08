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
// About a quarter of a second: long enough to finish after a small sum.
const MEDIUM_SUM = [
  'Sum',
  ['Divide', 1, ['Power', 'k', 2]],
  ['Limits', 'k', 1, 20000],
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

  test('concurrent N(x, p) calls leave no requested precision behind', async () => {
    const engine = new ComputeEngine();
    const a = engine.box(['N', SMALL_SUM, 10]).evaluateAsync();
    const b = engine.box(['N', SMALL_SUM, 12]).evaluateAsync();
    const [va, vb] = await Promise.all([a, b]);
    expect(va.toString()).toBe(
      engine.box(['N', SMALL_SUM, 10]).evaluate().toString()
    );
    expect(vb.toString()).toBe(
      engine.box(['N', SMALL_SUM, 12]).evaluate().toString()
    );
    expect((engine as any)._requestedPrecision).toBeUndefined();
    // The other order of completion.
    const c = engine.box(['N', MEDIUM_SUM, 10]).evaluateAsync();
    const d = engine.box(['N', SMALL_SUM, 12]).evaluateAsync();
    await Promise.all([d, c]);
    expect((engine as any)._requestedPrecision).toBeUndefined();
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
