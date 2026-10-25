/**
 * The test environment (`config/jest-environment.cjs`) makes the `vm` context
 * of each test file with an ordinary global object. With the stock jest
 * environment, the global object is a contextified proxy, and each read of a
 * global name (`Math`, `Number`, `console`, …) goes through an interceptor
 * that V8 cannot cache: engine code ran 5 to 10 times slower under jest than
 * from source (measured 2026-10-24: a loop of 1e7 `Math.sin` calls took
 * 2.2 s under jest and 0.4 s under `tsx`; the nested integral
 * `\int_0^{10}\int_3^4 (y-x)^{-2} dx dy` took 24 s and 1 s).
 *
 * The test compares a loop that reads `Math` as a global with the same loop
 * that reads it from a local constant. In an ordinary global object the two
 * take about the same time; in the stock environment the first one is about
 * 20 to 40 times slower (measured 2026-10-24). A ratio is less sensitive to the load of the machine
 * than a time, but it is still a time measurement, so it is asserted only in
 * a `CE_PERF=1` run.
 */

function globalReads(n: number): number {
  let acc = 0;
  for (let i = 0; i < n; i++) acc += Math.sin(i);
  return acc;
}

function localReads(n: number): number {
  const M = Math;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += M.sin(i);
  return acc;
}

function time(f: (n: number) => number, n: number): number {
  const t0 = performance.now();
  f(n);
  return performance.now() - t0;
}

describe('THE TEST ENVIRONMENT', () => {
  test('a read of a global name costs about the same as a local read', () => {
    const n = 2_000_000;
    // Warm up both loops, so that both are optimized before they are timed.
    globalReads(n / 10);
    localReads(n / 10);
    // The fastest of five runs of each loop, interleaved: a run that another
    // process slowed down is not the fastest one.
    let global = Infinity;
    let local = Infinity;
    for (let k = 0; k < 5; k++) {
      global = Math.min(global, time(globalReads, n));
      local = Math.min(local, time(localReads, n));
    }
    expect(globalReads(10)).toBeCloseTo(localReads(10));
    if (process.env.CE_PERF === '1') expect(global / local).toBeLessThan(2);
  });
});
