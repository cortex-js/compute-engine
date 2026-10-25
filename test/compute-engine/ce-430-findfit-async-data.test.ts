import { ComputeEngine } from '../../src/compute-engine';

// ROADMAP CE-430: the asynchronous route of `FindFit` evaluated its data
// operand with `evaluateAsync()` in one block. An `await` gives a turn to the
// microtasks only, so no timer ran and an abort was not seen until the whole
// list was evaluated. Two changes:
// - written-out data (a list of points with number coordinates,
//   `_isLiteralData()`) is its own value on the asynchronous route, as on
//   the synchronous route: no walk, and the same node;
// - the asynchronous walk of the operands (`holdMapAsync()`) and the
//   `evaluateAsync` handler of `List` wait for a macrotask about every 8 ms,
//   and an aborted signal stops them there.

const ce = new ComputeEngine();

/** The count of the calls of `Slow`, an operator that takes about 0.05 ms
 * per call and returns its operand. */
let calls = 0;
ce.declare('Slow', {
  signature: '(number) -> number',
  evaluate: ([x]) => {
    calls += 1;
    const end = performance.now() + 0.05;
    while (performance.now() < end);
    return x;
  },
});

const N = 2000;

/** `N` points `(i, Slow(2i + 1))`: not written-out data, so each element is
 * evaluated. About 100 ms in all. */
const slowData = [
  'List',
  ...Array.from({ length: N }, (_, i) => ['Tuple', i, ['Slow', 2 * i + 1]]),
];

const fitCall = (data: unknown[]): unknown[] => [
  'FindFit',
  data,
  ['Add', ['Multiply', 'a', 'x'], 'b'],
  ['List', 'a', 'b'],
  ['List', 'x'],
];

/** Start `run` with a timer of 0 ms armed before it, and return the count
 * of `Slow` calls when the timer ran (`-1` if it did not run before the
 * end of `run`). */
async function callsWhenTimerRan(run: () => Promise<unknown>): Promise<number> {
  calls = 0;
  let firedAt = -1;
  setTimeout(() => {
    firedAt = calls;
  }, 0);
  await run();
  return firedAt;
}

describe('CE-430: the asynchronous evaluation of a large data operand', () => {
  test('written-out data is its own value on the asynchronous route', async () => {
    const data = ce.box([
      'List',
      ...Array.from({ length: 50 }, (_, i) => ['Tuple', i, i / 3]),
    ]);
    expect(await data.evaluateAsync()).toBe(data);
    expect(
      await data.evaluateAsync({ signal: new AbortController().signal })
    ).toBe(data);
    // The coordinates are machine numbers: a numeric approximation gives
    // the same node.
    expect(await data.evaluateAsync({ numericApproximation: true })).toBe(data);
    // An exact rational is not its own numeric approximation: the general
    // route gives a new list, with floats.
    const exact = ce.box(['List', ['Tuple', 1, ['Rational', 1, 3]]]);
    expect(await exact.evaluateAsync()).toBe(exact);
    const approx = await exact.evaluateAsync({ numericApproximation: true });
    expect(approx).not.toBe(exact);
    expect(approx.toString()).toBe(
      exact.evaluate({ numericApproximation: true }).toString()
    );
  });

  test('a timer runs during the evaluation of a large list', async () => {
    const firedAt = await callsWhenTimerRan(() =>
      ce.box(slowData).evaluateAsync()
    );
    expect(calls).toBe(N);
    expect(firedAt).toBeGreaterThanOrEqual(0);
    expect(firedAt).toBeLessThan(N);
  });

  test('a timer runs during the evaluation of a large tuple', async () => {
    // `Tuple` is not lazy: its operands are evaluated by `holdMapAsync()`.
    const firedAt = await callsWhenTimerRan(() =>
      ce
        .box(['Tuple', ...Array.from({ length: N }, (_, i) => ['Slow', i])])
        .evaluateAsync()
    );
    expect(calls).toBe(N);
    expect(firedAt).toBeGreaterThanOrEqual(0);
    expect(firedAt).toBeLessThan(N);
  });

  test('a timer runs during the preparation of the data of FindFit', async () => {
    let record = '';
    const firedAt = await callsWhenTimerRan(async () => {
      record = (await ce.box(fitCall(slowData)).evaluateAsync()).toString();
    });
    expect(calls).toBe(N);
    expect(firedAt).toBeGreaterThanOrEqual(0);
    expect(firedAt).toBeLessThan(N);
    // The record is the one of the synchronous route, with the `route` and
    // `reason` entries of the asynchronous route.
    expect(record).toBe(
      ce
        .box(fitCall(slowData))
        .evaluate()
        .toString()
        .replace(/}$/, ', "route" -> "calling-thread", "reason" -> "no-pool"}')
    );
    expect(record).toMatch(/"a" -> 2/);
  });

  test('an abort during the preparation of the data of FindFit rejects', async () => {
    calls = 0;
    const controller = new AbortController();
    setTimeout(() => controller.abort('stop'), 0);
    await expect(
      ce.box(fitCall(slowData)).evaluateAsync({ signal: controller.signal })
    ).rejects.toMatchObject({ name: 'CancellationError', cause: 'stop' });
    // The abort was seen before the end of the data.
    expect(calls).toBeLessThan(N);
  });
});
