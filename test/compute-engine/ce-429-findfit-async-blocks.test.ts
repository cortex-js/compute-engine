import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine';
import {
  linearScanSolve,
  linearScanSolveSteps,
  type FitScanProblem,
} from '../../src/compute-engine/fit-scan';

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

describe('CE-429: FindFit.evaluateAsync() on the calling thread', () => {
  test('one grid point yields between rows, with the result of the solve', () => {
    // A slow model, as an interpreted one is: about 0.2 ms per call. The
    // step form yields every few rows once a millisecond passed; the
    // synchronous form, which the workers run, never yields. (A bound on the
    // time between two turns of the event loop depended on the load of the
    // machine.)
    const slow = (r: Record<string, number>): number => {
      const end = performance.now() + 0.2;
      while (performance.now() < end);
      return r.a * Math.cos(r.b * r.x) + r.d * r.x;
    };
    const n = 64;
    const x = Float64Array.from({ length: n }, (_, i) => i / 8);
    const y = Float64Array.from(x, (v) => 2 * Math.cos(2.2 * v) + 0.1 * v);
    const problem: FitScanProblem = {
      units: [
        {
          varFresh: ['x'],
          rows: { x: [x], y },
          model: slow,
          columns: [(r) => Math.cos(r.b * r.x), (r) => r.x],
        },
      ],
      paramFresh: ['a', 'b', 'd'],
      linearIdx: [0, 2],
      gridIdx: [1],
      lo: [-Infinity, 0, -Infinity],
      hi: [Infinity, 10, Infinity],
      start: [1, 1, 0],
      phases: [],
    };
    const steps = linearScanSolveSteps(problem, [2.2], true, () => {}, true);
    let yields = 0;
    let step = steps.next();
    while (!step.done) {
      yields += 1;
      step = steps.next();
    }
    expect(yields).toBeGreaterThan(3);
    expect(step.value).toEqual(linearScanSolve(problem, [2.2], true, () => {}));
    // The synchronous run never stops.
    const sync = linearScanSolveSteps(problem, [2.2], true, () => {}, false);
    expect(sync.next().done).toBe(true);
  });

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
        ['Multiply', 2, 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
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
