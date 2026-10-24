import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine';

// ROADMAP CE-429: on the asynchronous route of `FindFit`, one grid point of
// the separable scan ran as one block on the calling thread (about 110 ms
// for an interpreted model over 200 rows), and so did the setup (the data
// rows, the compilation of the model and of its derivatives). The grid
// point now runs through `linearScanSolveSteps()` (src/compute-engine/
// fit-scan.ts), which yields between rows, and the setup is a step function
// (`findFitSetupSteps`, src/compute-engine/nonlinear-fit.ts). The records
// do not change.

/** `a cos(b x + c) + d LogGamma(x + c)`: `LogGamma` does not compile, so
 * every function of the fit is interpreted. Linear in `a` and `d`. */
const SLOW_MODEL = [
  'Add',
  ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
  ['Multiply', 'd', ['LogGamma', ['Add', 'x', 'c']]],
];

function rows(n: number): { xs: number[]; ys: number[] } {
  const xs = Array.from({ length: n }, (_, i) => 1 + (9 * i) / (n - 1));
  const ys = xs.map((x) => 2 * Math.cos(2.2 * x + 0.5) + 0.3 * x);
  return { xs, ys };
}

const fitCall = (
  n: number,
  ranges: Record<string, number[]> | undefined
): unknown[] => {
  const { xs, ys } = rows(n);
  return [
    'FindFit',
    ['List', ...xs.map((x, i) => ['Tuple', x, ys[i]])],
    SLOW_MODEL,
    ['List', 'a', 'b', 'c', 'd'],
    ['List', 'x'],
    ...(ranges ? [{ dict: { global: { dict: ranges } } }] : []),
  ];
};

/** Evaluate `expr` asynchronously under a time limit of `ms`, and return
 * the record with the longest time between two turns of the event loop. */
async function longestBlock(
  ce: ComputeEngine,
  expr: BoxedExpression,
  ms: number
): Promise<{ record: BoxedExpression; longest: number }> {
  let longest = 0;
  let last = performance.now();
  let on = true;
  const tick = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (on) setImmediate(tick);
  };
  setImmediate(tick);
  let p: Promise<BoxedExpression> | undefined;
  ce.withTimeLimit({ ms, label: 'test:ce-429' }, () => {
    p = expr.evaluateAsync();
    return 0;
  });
  try {
    return { record: await p!, longest };
  } finally {
    on = false;
  }
}

describe('CE-429: FindFit.evaluateAsync() on the calling thread', () => {
  test('one grid point of an interpreted model does not block the event loop', async () => {
    const ce = new ComputeEngine();
    const expr = ce.box(fitCall(200, { b: [0.1, 6], c: [0, 6.28] }) as any);
    const { record, longest } = await longestBlock(ce, expr, 600);
    expect(record.get('timedOut')?.symbol).toBe('True');
    // One grid point took about 110 ms when it ran in one piece; the walk
    // now yields every few rows once a millisecond passed. The bound leaves
    // room for a loaded machine.
    expect(longest).toBeLessThan(80);
  }, 30_000);

  test.each([
    ['a separable scan', { b: [1, 3, 0.5], c: [0, 6.28, 1.5] }],
    ['no global option', undefined],
  ] as [string, Record<string, number[]> | undefined][])(
    'interpreted model, %s: the record of evaluateAsync() is the record of evaluate()',
    async (_name, ranges) => {
      const call = fitCall(12, ranges);
      const sync = new ComputeEngine().box(call as any).evaluate();
      const rec = await new ComputeEngine().box(call as any).evaluateAsync();
      const params = (r: BoxedExpression) =>
        ['a', 'b', 'c', 'd'].map((p) =>
          Number(r.get('parameters')?.get(p)?.re)
        );
      expect(params(rec)).toEqual(params(sync));
      expect(rec.get('residualNorm')?.re).toBe(sync.get('residualNorm')?.re);
      expect(rec.get('iterations')?.re).toBe(sync.get('iterations')?.re);
    },
    30_000
  );

  test('a joint fit (two models): the record of evaluateAsync() is the record of evaluate()', async () => {
    const { xs, ys } = rows(30);
    const call = [
      'FindFit',
      [
        'List',
        ['List', ...xs.map((x, i) => ['Tuple', x, ys[i]])],
        ['List', ...xs.map((x, i) => ['Tuple', x, 2 * ys[i]])],
      ],
      [
        'List',
        ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
        [
          'Multiply',
          2,
          'a',
          ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']],
        ],
      ],
      ['List', 'a', 'b', 'c'],
      ['List', 'x'],
      { dict: { global: { dict: { b: [0.5, 4] } } } },
    ];
    const sync = new ComputeEngine().box(call as any).evaluate();
    const rec = await new ComputeEngine().box(call as any).evaluateAsync();
    expect(rec.get('residualNorm')?.re).toBe(sync.get('residualNorm')?.re);
    expect(String(rec.get('parameters'))).toBe(String(sync.get('parameters')));
  }, 30_000);

  test('FindRoot.evaluateAsync() gives the root of evaluate()', async () => {
    const call = [
      'FindRoot',
      ['List', ['Subtract', ['Cos', 'b'], ['Multiply', 0.3, 'b']]],
      ['List', ['Tuple', 'b', 1]],
    ];
    const sync = new ComputeEngine().box(call as any).evaluate();
    const rec = await new ComputeEngine().box(call as any).evaluateAsync();
    expect(String(rec.get('parameters'))).toBe(String(sync.get('parameters')));
    expect(rec.get('residualNorm')?.re).toBe(sync.get('residualNorm')?.re);
  });
});
