/**
 * The step budget of the built-in antiderivative (`ANTIDERIVATIVE_STEP_BUDGET`)
 * and of the variation-of-parameters step of `DSolve`
 * (`DSOLVE_VARIATION_STEP_BUDGET`).
 *
 * A step is one `checkDeadline` call on the engine frame, so the assertions
 * below count steps, not time. A spent budget gives the unevaluated
 * `Integrate` (or `DSolve`), not an error. A deadline or a step budget of the
 * caller keeps its own behavior: its expiry goes to the caller.
 *
 * The tests that spend a budget set a small one (`antiderivativeBudget`,
 * `dSolveVariationBudget`), so that they end in a short time. The default
 * budgets are about 10 times the most steps that an integral or a
 * variation-of-parameters step of the test suite takes.
 */
import { ComputeEngine } from '../../src/compute-engine';
import {
  ANTIDERIVATIVE_STEP_BUDGET,
  antiderivativeBudget,
  antiderivativeStats,
} from '../../src/compute-engine/symbolic/antiderivative';
import {
  DSOLVE_VARIATION_STEP_BUDGET,
  dSolveVariationBudget,
  dSolveVariationStats,
} from '../../src/compute-engine/symbolic/differential-equations';
import { RubiDriver } from '../../src/compute-engine/rubi/driver';
import { compileRuleDocs } from '../../src/compute-engine/rubi/compile';
import RUBI_RULES_DATA from '../../src/compute-engine/rubi/rubi-rules-data.json';

// An integrand with no elementary antiderivative that the integrator
// explores for a long time: the integration by parts and the
// u-substitution simplify products of the expanded 12th power. Without a
// budget, it ran for more than 5 s. Most of that work is rule scans of
// `simplify()`, which the budget counts as rule steps (one per rule tried).
const NO_PROGRESS = '\\int (1+\\sin(y)+\\cos(2y))^{12} e^y\\,dy';

afterEach(() => {
  antiderivativeBudget.steps = ANTIDERIVATIVE_STEP_BUDGET;
  dSolveVariationBudget.steps = DSOLVE_VARIATION_STEP_BUDGET;
});

describe('ANTIDERIVATIVE STEP BUDGET', () => {
  test('a spent budget gives the unevaluated integral', () => {
    const ce = new ComputeEngine();
    antiderivativeBudget.steps = 100;
    const result = ce.parse(NO_PROGRESS).evaluate();
    expect(result.operator).toBe('Integrate');
    expect(result.toString()).toBe(
      'int(e^y * (sin(y) + cos(2y) + 1)^(12) dy)'
    );
    expect(antiderivativeStats.spent).toBe(true);
    expect(antiderivativeStats.steps).toBeGreaterThan(100);
  }, 120_000);

  test('the default budget stops an integrand that makes no progress', () => {
    // Each rule that `replace()` tries is a step of this budget, so the
    // default is spent in about 1 s on the development machine (without the
    // rule steps it took about 15 minutes).
    const ce = new ComputeEngine();
    const result = ce.parse(NO_PROGRESS).evaluate();
    expect(result.toString()).toBe(
      'int(e^y * (sin(y) + cos(2y) + 1)^(12) dy)'
    );
    expect(antiderivativeStats.spent).toBe(true);
    expect(antiderivativeStats.steps).toBeGreaterThan(
      ANTIDERIVATIVE_STEP_BUDGET
    );
  }, 120_000);

  test('an integral that closes stays far below the default budget', () => {
    const ce = new ComputeEngine();
    const result = ce.parse('\\int x e^x\\,dx').evaluate();
    expect(result.has('Integrate')).toBe(false);
    expect(antiderivativeStats.spent).toBe(false);
    expect(antiderivativeStats.steps).toBeGreaterThan(0);
    expect(antiderivativeStats.steps).toBeLessThan(
      ANTIDERIVATIVE_STEP_BUDGET / 100
    );
  });

  test('a deadline of the caller goes to the caller', () => {
    const ce = new ComputeEngine();
    let error: any;
    try {
      ce.withTimeLimit({ ms: 0, label: 'test:caller' }, () =>
        ce.parse(NO_PROGRESS).evaluate()
      );
    } catch (e) {
      error = e;
    }
    expect(error?.name).toBe('CancellationError');
    expect(error?.cause).toBe('timeout');
    expect(error?.attribution).toBe('test:caller');
  });

  test('a step budget of the caller goes to the caller', () => {
    const ce = new ComputeEngine();
    let error: any;
    try {
      ce.withStepBudget({ steps: 50, label: 'test:caller-steps' }, () =>
        ce.parse(NO_PROGRESS).evaluate()
      );
    } catch (e) {
      error = e;
    }
    expect(error?.name).toBe('CancellationError');
    expect(error?.cause).toBe('step-budget');
    expect(error?.attribution).toBe('test:caller-steps');
    // The budget of the antiderivative was not the one that was spent.
    expect(antiderivativeStats.spent).toBe(false);
  }, 120_000);
});

describe('DSOLVE VARIATION-OF-PARAMETERS STEP BUDGET', () => {
  const dsolve = (ce: ComputeEngine, rhs: unknown) =>
    ce
      .expr([
        'DSolve',
        ['Equal', ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['y', 'x']], rhs],
        'y',
        'x',
      ])
      .evaluate();

  test('the default budget solves y″ + y = tan x', () => {
    const ce = new ComputeEngine();
    const result = dsolve(ce, ['Tan', 'x']);
    expect(result.toString()).toBe(
      '[y(x) == "c_1" * cos(x) + "c_2" * sin(x) - cos(x) * ln(|tan(x) + sec(x)|)]'
    );
    expect(dSolveVariationStats.spent).toBe(false);
    // 1,160 steps, rule steps included.
    expect(dSolveVariationStats.steps).toBeLessThan(
      DSOLVE_VARIATION_STEP_BUDGET / 10
    );
  });

  test('a spent budget gives the unevaluated DSolve', () => {
    const ce = new ComputeEngine();
    dSolveVariationBudget.steps = 30;
    const result = dsolve(ce, ['Tan', 'x']);
    expect(result.operator).toBe('DSolve');
    expect(dSolveVariationStats.spent).toBe(true);
    expect(dSolveVariationStats.steps).toBeGreaterThan(30);
  });

  test('a forcing term with no closed form spends the budget and stays inert', () => {
    // y″ + y = xˣ: variation of parameters needs ∫ xˣ·sin x dx and
    // ∫ xˣ·cos x dx, which have no closed form.
    const ce = new ComputeEngine();
    dSolveVariationBudget.steps = 30;
    const result = dsolve(ce, ['Power', 'x', 'x']);
    expect(result.operator).toBe('DSolve');
    expect(dSolveVariationStats.spent).toBe(true);
    expect(dSolveVariationStats.steps).toBeGreaterThan(30);
  }, 120_000);
});

describe('RULE STEPS AND THE OTHER BUDGETS', () => {
  // A rule step counts only against a budget that is calibrated with rule
  // steps. Inside such a budget, the Rubi driver spends the same steps as at
  // the top level, while the enclosing budget counts the rule steps too.
  // Measured: 520 steps for x³/(1 + x²)², 37,267 for (e + f·x)³·sinh(c + d·x),
  // and an enclosing budget that counts rule steps spends 598 and 40,778.
  const ce = new ComputeEngine();
  const rules = compileRuleDocs(ce, RUBI_RULES_DATA as any).rules;

  test('the Rubi driver does not count rule steps', () => {
    const integrand = ce.parse('\\frac{x^3}{(1+x^2)^2}');
    const top = new RubiDriver(ce, rules);
    expect(top.int(integrand, 'x')).not.toBeNull();
    const steps = top.stats.steps!;
    expect(steps).toBeGreaterThan(0);

    const nested = new RubiDriver(ce, rules);
    let enclosingSpent = 0;
    ce._withBudget(
      { steps: 1_000_000, label: 'test:rule-steps', ruleSteps: true },
      () => {
        expect(nested.int(integrand, 'x')).not.toBeNull();
        enclosingSpent = 1_000_000 - ce._deadlineFrame!.budgets!.at(-1)!.left;
      }
    );
    expect(nested.stats.steps).toBe(steps);
    // The enclosing budget counted the rule steps of the scan as well.
    expect(enclosingSpent).toBeGreaterThan(steps);
  });
});
