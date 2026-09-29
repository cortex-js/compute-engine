import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  CancellationError,
  isTimeoutCancellation,
} from '../../src/common/interruptible';

/**
 * `ce.withStepBudget({ steps, label }, fn)` — the public, deterministic hang
 * guard (Tycho item 326, 2026-09-28). A step is one cooperative cancellation
 * check, so the count of a computation on one engine state is the same on
 * every machine; a spent budget throws a `CancellationError` with
 * `cause: 'step-budget'`, distinct from the wall clock's `'timeout'`, and the
 * span's label as its attribution.
 */
describe('withStepBudget', () => {
  // A sum with enough terms to cross several amortized checks.
  const SUM = '\\sum_{k=1}^{20000} k^2';
  const EXACT = (20000 * 20001 * 40001) / 6;

  function cancellation(fn: () => unknown): any {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return undefined;
  }

  test('a generous budget returns the value unchanged', () => {
    const ce = new ComputeEngine();
    const v = ce.withStepBudget({ steps: 1_000_000 }, () =>
      ce.parse(SUM).evaluate()
    );
    expect(v.re).toBe(EXACT);
  });

  test('a spent budget throws a CancellationError with its own cause and the label', () => {
    const ce = new ComputeEngine();
    const e = cancellation(() =>
      ce.withStepBudget({ steps: 0, label: 'classify' }, () =>
        ce.parse(SUM).evaluate()
      )
    );
    expect(e).toBeDefined();
    expect(e.name).toBe('CancellationError');
    expect(e.cause).toBe('step-budget');
    expect(e.attribution).toBe('classify');
    expect(e.spans).toEqual(['classify']);
    expect(e.message).toBe('Step budget exhausted');
  });

  test('the count is deterministic: the same computation spends the same steps on two engines', () => {
    // The smallest budget that admits the computation. Throwing is monotone
    // in the budget (`left` only decreases), so an exponential probe finds
    // an admitting budget and a binary search narrows to the threshold.
    function threshold(ce: ComputeEngine): number {
      const expr = ce.parse(SUM);
      const admits = (steps: number): boolean => {
        const e = cancellation(() =>
          ce.withStepBudget({ steps }, () => expr.evaluate())
        );
        if (e !== undefined) expect(e.cause).toBe('step-budget');
        return e === undefined;
      };
      let hi = 1;
      while (!admits(hi)) {
        hi *= 2;
        if (hi > 1 << 24) throw new Error('no budget admitted the sum');
      }
      let lo = 0; // `steps: 0` throws (pinned above)
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (admits(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    const engine = new ComputeEngine();
    const a = threshold(engine);
    expect(a).toBeGreaterThan(0);
    expect(threshold(engine)).toBe(a); // the same engine, run again
    expect(threshold(new ComputeEngine())).toBe(a); // a fresh engine
  });

  test('spans nest: the inner budget fires with its own label', () => {
    const ce = new ComputeEngine();
    const e = cancellation(() =>
      ce.withStepBudget({ steps: 1_000_000, label: 'outer' }, () =>
        ce.withStepBudget({ steps: 0, label: 'inner' }, () =>
          ce.parse(SUM).evaluate()
        )
      )
    );
    expect(e.cause).toBe('step-budget');
    expect(e.attribution).toBe('inner');
    expect(e.spans).toEqual(['outer', 'inner']);
  });

  test('a step counts against every active budget: the outer one can fire first', () => {
    const ce = new ComputeEngine();
    const e = cancellation(() =>
      ce.withStepBudget({ steps: 0, label: 'outer' }, () =>
        ce.withStepBudget({ steps: 1_000_000, label: 'inner' }, () =>
          ce.parse(SUM).evaluate()
        )
      )
    );
    expect(e.cause).toBe('step-budget');
    expect(e.attribution).toBe('outer');
  });

  test('inside a time limit, a spent step budget is reported as the step budget', () => {
    const ce = new ComputeEngine();
    const e = cancellation(() =>
      ce.withTimeLimit({ ms: 60_000, label: 'guard' }, () =>
        ce.withStepBudget({ steps: 0, label: 'budget' }, () =>
          ce.parse(SUM).evaluate()
        )
      )
    );
    expect(e.cause).toBe('step-budget');
    expect(e.attribution).toBe('budget');
    expect(e.spans).toEqual(['guard', 'budget']);
  });

  test('the span is restored on every exit', () => {
    const ce = new ComputeEngine();
    cancellation(() =>
      ce.withStepBudget({ steps: 0 }, () => ce.parse(SUM).evaluate())
    );
    // Outside the span the same computation is unbounded again.
    expect(ce.parse(SUM).evaluate().re).toBe(EXACT);
  });

  test('a budget that is not a non-negative integer is a contract error, not a cancellation', () => {
    const ce = new ComputeEngine();
    expect(() => ce.withStepBudget({ steps: -1 }, () => 1)).toThrow(
      /non-negative integer/
    );
    expect(() => ce.withStepBudget({ steps: 1.5 }, () => 1)).toThrow(
      /non-negative integer/
    );
    expect(() => ce.withStepBudget({ steps: Infinity }, () => 1)).toThrow(
      /non-negative integer/
    );
    expect(() => ce.withStepBudget({ steps: NaN }, () => 1)).toThrow(
      /non-negative integer/
    );
  });

  test('a spent step budget is an expired budget for the internal fallbacks, a cap breach is not', () => {
    const ce = new ComputeEngine();
    const spent = cancellation(() =>
      ce.withStepBudget({ steps: 0 }, () => ce.parse(SUM).evaluate())
    );
    expect(isTimeoutCancellation(spent)).toBe(true);
    expect(
      isTimeoutCancellation(new CancellationError({ cause: 'timeout' }))
    ).toBe(true);
    expect(
      isTimeoutCancellation(
        new CancellationError({ cause: 'iteration-limit-exceeded' })
      )
    ).toBe(false);
  });

  test('an Epsil program under a spent budget answers an error value naming the budget', () => {
    const ce = new ComputeEngine();
    const r = ce.withStepBudget({ steps: 0, label: 'epsil' }, () =>
      executeEpsil(ce, 'sum(k^2 for k in 1..20000)')
    );
    expect(r.value.operator).toBe('Error');
    expect(r.value.ops?.[1]?.string).toBe('step-budget');
  });
});
