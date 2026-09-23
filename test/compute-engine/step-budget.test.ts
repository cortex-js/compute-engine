import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';
import { checkDeadline } from '../../src/common/interruptible';
import {
  RubiDriver,
  RUBI_STEP_BUDGET,
} from '../../src/compute-engine/rubi/driver';
import { compileRuleDocs } from '../../src/compute-engine/rubi/compile';
import RUBI_RULES_DATA from '../../src/compute-engine/rubi/rubi-rules-data.json';

//
// STEP BUDGETS
//
// An internal search that gives up when a wall-clock budget runs out gives a
// different answer on a fast machine and on a slow or loaded one. A step
// budget (`engine._withBudget({ steps })`) counts the deadline checks of the
// engine instead, so the search gives up at the same point everywhere. The
// Rubi integration driver and the compiler's closed-form attempt use one.
//

/** Run `fn` and return the error it throws. */
function thrown(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('the step budget of a span', () => {
  const ce = new ComputeEngine();

  test('a spent budget throws a timeout with the label of its span', () => {
    let checks = 0;
    const e = thrown(() =>
      ce._withBudget({ steps: 3, label: 'search' }, () => {
        for (;;) {
          checkDeadline(ce._deadlineFrame);
          checks += 1;
        }
      })
    );
    expect(checks).toBe(3);
    expect(e).toMatchObject({
      name: 'CancellationError',
      cause: 'timeout',
      message: 'Step budget exhausted',
      attribution: 'search',
    });
  });

  test('a spent budget stays spent', () => {
    ce._withBudget({ steps: 0, label: 'search' }, () => {
      expect(thrown(() => checkDeadline(ce._deadlineFrame))).toBeDefined();
      expect(ce._shouldContinueExecution()).toBe(false);
      expect(thrown(() => checkDeadline(ce._deadlineFrame))).toBeDefined();
    });
    // Outside the span, nothing is armed.
    expect(ce._shouldContinueExecution()).toBe(true);
    expect(ce._timeRemaining).toBe(Infinity);
  });

  test('a spent budget leaves no time for a generator loop', () => {
    ce._withBudget({ steps: 0, label: 'search' }, () => {
      thrown(() => checkDeadline(ce._deadlineFrame));
      expect(ce._timeRemaining).toBe(0);
    });
  });

  test('a step counts against every active budget', () => {
    const e = thrown(() =>
      ce._withBudget({ steps: 5, label: 'outer' }, () => {
        for (let i = 0; i < 4; i++) checkDeadline(ce._deadlineFrame);
        // The inner span has steps to spare, but the outer one runs out.
        ce._withBudget({ steps: 100, label: 'inner' }, () => {
          for (let i = 0; i < 10; i++) checkDeadline(ce._deadlineFrame);
        });
      })
    );
    expect(e?.attribution).toBe('outer');
  });

  test('a span with no steps keeps the budget of its parent', () => {
    const e = thrown(() =>
      ce._withBudget({ steps: 2, label: 'outer' }, () =>
        ce.withTimeLimit({ ms: 60_000, label: 'inner' }, () => {
          for (let i = 0; i < 10; i++) checkDeadline(ce._deadlineFrame);
        })
      )
    );
    expect(e?.attribution).toBe('outer');
    // The error lists the spans active when the budget ran out.
    expect(e?.spans).toEqual(['outer', 'inner']);
  });
});

describe('the step budget of the Rubi driver', () => {
  const ce = new ComputeEngine();
  const rules = compileRuleDocs(ce, RUBI_RULES_DATA as any).rules;
  const integrand = ce.parse('\\frac{x^3}{(1+x^2)^2}');

  test('the same integral spends the same number of steps', () => {
    const driver = new RubiDriver(ce, rules);
    expect(driver.int(integrand, 'x')).not.toBeNull();
    const first = driver.stats.steps!;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(RUBI_STEP_BUDGET);
    // Other work in between, on the same driver and engine, does not change
    // the count: every stride counter lives on the span's frame.
    driver.int(ce.parse('\\sin(x)^3'), 'x');
    driver.int(ce.parse('\\frac{1}{x^4+1}'), 'x');
    expect(driver.int(integrand, 'x')).not.toBeNull();
    expect(driver.stats.steps).toBe(first);
  });

  test('a budget too small gives no result, and no error', () => {
    const driver = new RubiDriver(ce, rules, { stepBudget: 5 });
    expect(driver.int(integrand, 'x')).toBeNull();
    expect(driver.stats.steps).toBe(6);
  });

  test("a caller's spent budget propagates out of the driver", () => {
    const driver = new RubiDriver(ce, rules);
    const e = thrown(() =>
      ce._withBudget({ steps: 50, label: 'caller' }, () =>
        driver.int(integrand, 'x')
      )
    );
    expect(e).toMatchObject({ cause: 'timeout', attribution: 'caller' });
  });

  test('loadIntegrationRules passes its step budget on', () => {
    // Only the Rubi rules close this integral.
    const latex = '\\int \\frac{1}{x\\sqrt{1+x}} dx';
    const full = new ComputeEngine();
    loadIntegrationRules(full);
    expect(full.parse(latex).evaluate().has('Integrate')).toBe(false);
    const small = new ComputeEngine();
    loadIntegrationRules(small, { stepBudget: 5 });
    expect(small.parse(latex).evaluate().has('Integrate')).toBe(true);
  });

  test('loadIntegrationRules rejects a step budget that is not a count', () => {
    const e = new ComputeEngine();
    for (const stepBudget of [NaN, -1, 2.5])
      expect(() => loadIntegrationRules(e, { stepBudget })).toThrow(RangeError);
    expect(() =>
      loadIntegrationRules(e, { stepBudget: Infinity })
    ).not.toThrow();
  });
});
