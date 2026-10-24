import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil';

// ROADMAP CE-314.1, first step: `executeEpsilAsync()` runs a program as
// `executeEpsil()` does, with each top-level statement evaluated by
// `evaluateAsync()`. Both run the same generator (`executeEpsilRun` in
// src/epsil/execute-epsil.ts); only the evaluation of a statement differs.

/** What a host reads of a result: the value, its source range and the
 * diagnostics. */
const summary = (r: ReturnType<typeof executeEpsil>) => ({
  value: String(r.value),
  valueRange: r.valueRange,
  diagnostics: r.diagnostics.map((d) => [d.severity, d.message, d.range]),
});

describe('executeEpsilAsync gives the result of executeEpsil', () => {
  test.each([
    ['one expression', '1 + 2'],
    ['declarations across statements', 'let a = 3\nlet b = a^2\na + b'],
    [
      'a function declared after its use',
      'let y = g(4)\nfunction g(k) { k^2 + 1 }\ny',
    ],
    ['a loop', 'let c = 0\nfor i in 1..50 { c = c + i }\nc'],
    ['a map', '1..5 |> map(x => x^2)'],
    ['an error in a non-final statement', 'let xs = [1, 2]\nxs[5] = 1\n7'],
    ['an error as the final value', 'let k: integer = 2\nk = "a"'],
    ['a constant assignment', 'const k = 1\nk = 2'],
    ['a parse error', 'let = 3'],
    ['an unknown function', 'quartile([1, 2, 3])'],
    [
      'a nested statement whose error is discarded',
      'function g(x) { 1/x }\nfunction f(n) { let tmp = [g("a")]; n }\nf(1)',
    ],
    [
      'a field assignment',
      'type Point = object{x: real, y: real}\nlet p = Point(x: 1, y: 2)\np.x = 5\np.x',
    ],
  ])('%s', async (_name, source) => {
    const sync = executeEpsil(new ComputeEngine(), source);
    const async_ = await executeEpsilAsync(new ComputeEngine(), source);
    expect(summary(async_)).toEqual(summary(sync));
  });

  test('two runs on one engine keep the declarations of the first', async () => {
    const ce = new ComputeEngine();
    await executeEpsilAsync(ce, 'let a = 5');
    const r = await executeEpsilAsync(ce, 'a * 2');
    expect(String(r.value)).toBe('10');
  });

  test('a statement of FindFit runs its asynchronous handler', async () => {
    // The record of the asynchronous route of `FindFit` has a `route` entry;
    // the synchronous record has none.
    const source = [
      'let data = [(0, 1), (1, 3), (2, 5), (3, 7)]',
      'findFit(data, a * t + b, [a, b], [t])',
    ].join('\n');
    const sync = executeEpsil(new ComputeEngine(), source);
    const r = await executeEpsilAsync(new ComputeEngine(), source);
    expect(sync.value.get('route')).toBeUndefined();
    expect(r.value.get('route')?.string).toBe('calling-thread');
    expect(String(r.value.get('parameters'))).toBe(
      String(sync.value.get('parameters'))
    );
  });
});

describe('executeEpsilAsync: time limit and abort', () => {
  test('the time limit of an enclosing span applies after the span closes', async () => {
    const ce = new ComputeEngine();
    ce.iterationLimit = 100_000_000;
    // The span closes when `executeEpsilAsync` returns its promise; the
    // loop runs in a later statement, after a wait.
    let p: Promise<ReturnType<typeof executeEpsil>> | undefined;
    ce.withTimeLimit({ ms: 50, label: 'test:epsil-async-timeout' }, () => {
      p = executeEpsilAsync(ce, 'let c = 0\nwhile c >= 0 { c = c + 1 }');
      return 0;
    });
    const { value } = await p!;
    expect(value.operator).toBe('Error');
    expect(value.op2?.string).toBe('timeout');
    // The engine has no deadline once the run is over.
    expect(ce._deadlineFrame).toBeUndefined();
  }, 30_000);

  test('an aborted signal rejects before the program runs', async () => {
    const ce = new ComputeEngine();
    const controller = new AbortController();
    controller.abort('stop');
    await expect(
      executeEpsilAsync(ce, 'let x = 1', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'CancellationError', cause: 'stop' });
    expect(ce.box('x').value).toBeUndefined();
  });

  test('an abort during a statement rejects, and later statements do not run', async () => {
    const ce = new ComputeEngine();
    const controller = new AbortController();
    // An interpreted fit with a global search: seconds of work on this
    // thread, which gives the event loop a turn every few milliseconds.
    const xs = [1, 3.22, 5.27, 10.49, 7.12];
    const ys = [4.3, 1.18, 0.01, 1.48, 3.44];
    const data = xs.map((x, i) => `(${x}, ${ys[i]})`).join(', ');
    const source = [
      `let data = [${data}]`,
      'let r = findFit(data, a * cos(b * x + c) + d * logGamma(x + c), [a, b, c, d], [x], {"global" -> {"b" -> [0.1, 6], "c" -> [0, 6.28]}})',
      'let after = 1',
    ].join('\n');
    setTimeout(() => controller.abort('stop'), 30);
    const t0 = Date.now();
    await expect(
      executeEpsilAsync(ce, source, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'CancellationError', cause: 'stop' });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(ce.box('after').value).toBeUndefined();
    // The fields of the run are restored.
    expect(ce._epsilStatementResultHook).toBeUndefined();
    expect(ce._epsilDeclarationRoute).toBeFalsy();
  }, 30_000);

  test('the deadline frame of the span is not in place while the run waits', async () => {
    const ce = new ComputeEngine();
    const before = ce._epsilBatchId;
    let p: Promise<ReturnType<typeof executeEpsil>> | undefined;
    ce.withTimeLimit({ ms: 5000, label: 'test:epsil-async-wait' }, () => {
      p = executeEpsilAsync(ce, 'let a = 1\nlet b = 2\na + b');
      return 0;
    });
    // The span has closed and `executeEpsilAsync` waits on its first
    // statement: the engine has no deadline frame.
    expect(ce._deadlineFrame).toBeUndefined();
    const r = await p!;
    expect(String(r.value)).toBe('3');
    // The fields the run set are restored when it ends.
    expect(ce._epsilBatchId).toBe(before);
    expect(ce._epsilStatementResultHook).toBeUndefined();
    expect(ce._deadlineFrame).toBeUndefined();
  });
});
