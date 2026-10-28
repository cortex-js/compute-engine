import { ComputeEngine } from '../../src/compute-engine';
import type { ComputeEngineGlobal } from '../../src/compute-engine';

// `ce.timeRemaining` and `ce.stepBudgetSpent` give a host the state of the
// current `withTimeLimit` / `withStepBudget` span, so that its own loops can
// stop on time and its caches can refuse a partial value. The global slot
// `Symbol.for('io.cortexjs.compute-engine')` lets a page find the engine
// without importing it (`ComputeEngineGlobal`).

function busyWait(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Wait without yielding: the span is synchronous.
  }
}

describe('ce.timeRemaining and ce.stepBudgetSpent', () => {
  test('outside any span', () => {
    const ce = new ComputeEngine();
    expect(ce.timeRemaining).toBe(Number.POSITIVE_INFINITY);
    expect(ce.stepBudgetSpent).toBe(false);
  });

  test('inside a time limit, before and after its deadline', () => {
    const ce = new ComputeEngine();
    // A long limit for the "before" read, so that a pause of a loaded
    // machine does not make it fail.
    ce.withTimeLimit(5_000, () => {
      expect(ce.timeRemaining).toBeGreaterThan(0);
      expect(ce.timeRemaining).toBeLessThanOrEqual(5_000);
      return 0;
    });
    ce.withTimeLimit(1, () => {
      busyWait(5);
      expect(ce.timeRemaining).toBeLessThanOrEqual(0);
      expect(ce.stepBudgetSpent).toBe(false);
      return 0;
    });
    expect(ce.timeRemaining).toBe(Number.POSITIVE_INFINITY);
  });

  test('a step budget with no time limit has no deadline', () => {
    const ce = new ComputeEngine();
    ce.withStepBudget({ steps: 1_000_000 }, () => {
      expect(ce.timeRemaining).toBe(Number.POSITIVE_INFINITY);
      expect(ce.stepBudgetSpent).toBe(false);
      return 0;
    });
  });

  test('a nested span reads the earliest deadline', () => {
    const ce = new ComputeEngine();
    ce.withTimeLimit(30, () =>
      ce.withTimeLimit(10_000, () => {
        expect(ce.timeRemaining).toBeLessThanOrEqual(30);
        return 0;
      })
    );
  });

  test('a spent step budget, after the cancellation was caught', () => {
    const ce = new ComputeEngine();
    let caught = false;
    ce.withTimeLimit(10_000, () =>
      ce.withStepBudget({ steps: 1 }, () => {
        try {
          ce.parse('\\sum_{k=1}^{2000} \\sin(kx)').evaluate();
        } catch {
          caught = true;
        }
        expect(ce.stepBudgetSpent).toBe(true);
        // A spent budget does not use up the time.
        expect(ce.timeRemaining).toBeGreaterThan(0);
        return 0;
      })
    );
    expect(caught).toBe(true);
    expect(ce.stepBudgetSpent).toBe(false);
  });
});

describe('ce.stepsLeft', () => {
  test('outside any step budget', () => {
    const ce = new ComputeEngine();
    expect(ce.stepsLeft).toBeUndefined();
    ce.withTimeLimit(5_000, () => {
      expect(ce.stepsLeft).toBeUndefined();
      return 0;
    });
  });

  test('reads the innermost budget, which tells this span from an enclosing one', () => {
    const ce = new ComputeEngine();
    ce.withStepBudget({ steps: 5_000 }, () => {
      expect(ce.stepsLeft).toBe(5_000);
      ce.withStepBudget({ steps: 1 }, () => {
        try {
          ce.parse('\\sum_{k=1}^{2000} \\sin(kx)').evaluate();
        } catch {
          // The inner budget is spent.
        }
        expect(ce.stepsLeft).toBeLessThan(0);
        return 0;
      });
      // The enclosing budget counted the steps of the inner span too, and
      // it is not spent.
      const left = ce.stepsLeft!;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThan(5_000);
      expect(ce.stepBudgetSpent).toBe(false);
      // A time limit nested in the span reads the same budget.
      ce.withTimeLimit(5_000, () => {
        expect(ce.stepsLeft).toBe(left);
        return 0;
      });
      return 0;
    });
    expect(ce.stepsLeft).toBeUndefined();
  });

  test('a budget the engine opens for its own search is skipped', () => {
    const ce = new ComputeEngine();
    ce.withStepBudget({ steps: 5_000, label: 'host' }, () => {
      // The integration and Rubi routes open a span like this one; host
      // code (an `evaluate` handler) can run inside it.
      (
        ce as unknown as {
          _withBudget: (
            limit: { steps: number; label: string },
            fn: () => number
          ) => number;
        }
      )._withBudget({ steps: 7, label: 'engine-search' }, () => {
        expect(ce.stepsLeft).toBe(5_000);
        return 0;
      });
      return 0;
    });
  });
});

describe('the global slot', () => {
  test('holds the documented members', () => {
    new ComputeEngine();
    const slot = (globalThis as Record<symbol, unknown>)[
      Symbol.for('io.cortexjs.compute-engine')
    ] as ComputeEngineGlobal;
    expect(typeof slot.ComputeEngine).toBe('function');
    expect(typeof slot.version).toBe('string');
    expect(typeof slot.compile).toBe('function');
    expect(typeof slot.isFunction).toBe('function');
    const ce = new slot.ComputeEngine();
    expect(ce.parse('1+1').evaluate().re).toBe(2);
  });
});
