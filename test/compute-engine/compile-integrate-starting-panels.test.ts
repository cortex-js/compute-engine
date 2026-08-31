/**
 * The scalar `javascript` target's nested-quadrature evaluation budget.
 *
 * `_SYS.integrate` runs one full adaptive GK15 quadrature per evaluation of the
 * enclosing integrand, so every level of nesting MULTIPLIES the work: at the
 * default seeding of 16 starting panels a smooth integrand costs 240 integrand
 * evaluations at one level, ~5.8·10⁴ at two (measured 6 ms), ~1.4·10⁷ at three
 * (measured ~1.2 s) and ~3.3·10⁹ at four — minutes to hours of synchronous work
 * that never yields to the caller.
 *
 * Nesting written into one `Integrate` node's limits is visible in the tree, and
 * the emitter sizes ITS starting panels down by that depth (4 per level for a
 * double, 3 for a triple — see the depth-sizing describe below), which is why
 * the figures above apply in full only to nesting reached BY REFERENCE: `∫ p(x)
 * dx` where the compiled `p` computes an integral of its own shows no nested
 * `Integrate` node anywhere, and the composition only happens per runtime call.
 * No tree walk can size that, so the runtime carries a shared
 * evaluand budget (`NESTED_QUADRATURE_BUDGET`,
 * `compilation/javascript-target.ts`) armed at the OUTERMOST integration entry
 * and consumed by every evaluation a nested integral performs; once it is gone
 * a nested integral answers `NaN` — the scalar target's "no value" spelling —
 * which propagates outward instead of spinning. The budget re-arms at the next
 * outermost entry, so one exhausted call does not poison the integrals that
 * follow it.
 *
 * The interval target has the same mechanism with `entire` in place of `NaN`
 * (`interval/integrate.ts`, tested in `compile-interval-integrate.test.ts`).
 *
 * The verdicts below are VALUES, never elapsed milliseconds — a wall-clock
 * threshold measures the machine, not the engine. What the budget buys is that
 * the pathological case RETURNS: with the budget removed, this file did not
 * finish within 600 s (the un-budgeted work is ~3.3·10⁹ integrand evaluations,
 * 240× the measured ~1 s depth-3 cost), and jest's per-test timeout cannot end
 * it, because a synchronous JavaScript call cannot be interrupted from outside.
 * So the generous timeouts below are labels, not backstops: a run that reaches
 * its assertions at all has already shown the bound holds.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import * as GaussKronrodModule from '../../src/compute-engine/numerics/gauss-kronrod';

const ce = new ComputeEngine();

/** Compile a definite integral to a real-valued runner, with the emitted code
 *  for the assertions that pin WHICH lowering is under test. */
function compileReal(
  latex: string,
  options?: { vars?: Record<string, string>; quadrature?: 'monte-carlo' }
): { code: string; run: (args?: Record<string, unknown>) => number } {
  const r = compile(ce.parse(latex), options);
  expect(r.success).toBe(true);
  return {
    code: String(r.code),
    run: (args = {}) => r.run!(args) as number,
  };
}

/**
 * Run `fn` and return how many integrand evaluations the adaptive quadrature
 * performed while it ran.
 *
 * The compiled runner reaches quadrature through `_SYS.integrate`, a private
 * module-level helper that cannot be replaced from a test — but it calls
 * `adaptiveQuadrature` as an ordinary module import, resolved at call time, so
 * replacing that on its module here is observed by the runner (the same
 * technique `compile-integrate.test.ts` uses). The original is restored in a
 * `finally`, so a throwing test cannot leave the instrumentation behind.
 */
function countQuadratureEvals(fn: () => void): number {
  const gk = GaussKronrodModule as {
    adaptiveQuadrature: typeof GaussKronrodModule.adaptiveQuadrature;
  };
  const original = gk.adaptiveQuadrature;
  let evals = 0;
  gk.adaptiveQuadrature = (f, ...rest) =>
    original(
      (x) => {
        evals += 1;
        return f(x);
      },
      ...rest
    );
  try {
    fn();
  } finally {
    gk.adaptiveQuadrature = original;
  }
  return evals;
}

/**
 * Declare a three-deep chain of integrals composed BY REFERENCE — each body
 * integrates a call to the previous one — and return an outermost integral over
 * the last, for four levels of quadrature in all.
 *
 * `e^{-u^4}` has no elementary antiderivative, so no level closes symbolically
 * and each one really does emit a `_SYS.integrate` call at run time. Nothing in
 * the outermost expression's tree shows that nesting: its compiled code is a
 * single `_SYS.integrate` over a call to `_fn_p_3`.
 */
function byReferenceChain(): string {
  ce.parse('p_{1}(w) \\coloneq \\int_0^1 e^{-(w+x)^4}\\,dx').evaluate();
  ce.parse('p_{2}(w) \\coloneq \\int_0^1 e^{-(p_{1}(x)+w)^4}\\,dx').evaluate();
  ce.parse('p_{3}(w) \\coloneq \\int_0^1 e^{-(p_{2}(x)+w)^4}\\,dx').evaluate();
  return '\\int_0^1 p_{3}(t+s)\\,dt';
}


/**
 * Tree-visible nesting is sized at COMPILE time instead: the emitter counts the
 * `Integrate` nodes nested in the expression and seeds each level with
 * `initialPanelsForDimensions(depth)` starting panels (16 at one level, 4 at
 * two, 3 at three), so the starting-panel floor applies to the whole iterated
 * integral rather than multiplying across its levels. This mirrors the
 * interpreter (`library/calculus.ts`) and the interval target, which size the
 * same way; the runtime budget above stays responsible for the by-reference
 * composition no tree walk can see.
 *
 * Adaptive quadrature refines from those starting panels to the same tolerance,
 * so the accuracy pins below are the point of the sizing test: fewer panels must
 * buy speed, never a looser answer.
 */
describe('COMPILE Integrate — starting panels sized by tree-visible depth', () => {
  // The `vars` mapping keeps these on the quadrature emitter: without it the
  // integrand is elementary and the antiderivative-first path folds the whole
  // integral to a closed form, and there is no quadrature left to size. The
  // closed forms are exact: ∫₀¹e^x dx = e − 1, so the d-fold integral of
  // k·e^{x₁+…+x_d} over the unit cube is k(e − 1)^d.
  const E = Math.E;

  test('a tree-visible double keeps its value and costs an order less', () => {
    const r = compileReal('\\int_0^1\\int_0^1 k e^{x+y}\\,dy\\,dx', {
      vars: { k: '_.k' },
    });
    expect(r.code.match(/_SYS\.integrate\(/g)?.length).toBe(2);
    // The panel count is part of the emitted call — pin it, so a regression in
    // the sizing shows up as a codegen difference and not only as a cost.
    expect(r.code).toContain(', 0, 1, 4)');

    let value = 0;
    const evals = countQuadratureEvals(() => {
      value = r.run({ k: 1 });
    });
    expect(value).toBeCloseTo((E - 1) ** 2, 8);
    expect(r.run({ k: 3 })).toBeCloseTo(3 * (E - 1) ** 2, 8);

    // A count of zero would mean the instrumentation missed the path the runner
    // took, not that the run was free. Measured: 57 600 evaluations before the
    // sizing (16 panels per level), 3600 after — the bound is an order of
    // magnitude below the old cost, with room for panel-seeding tweaks.
    expect(evals).toBeGreaterThan(0);
    expect(evals).toBeLessThan(5760);
  });

  test('a tree-visible triple keeps its value and costs two orders less', () => {
    const r = compileReal(
      '\\int_0^1\\int_0^1\\int_0^1 k e^{x+y+z}\\,dz\\,dy\\,dx',
      { vars: { k: '_.k' } }
    );
    expect(r.code.match(/_SYS\.integrate\(/g)?.length).toBe(3);
    expect(r.code).toContain(', 0, 1, 3)');

    let value = 0;
    const evals = countQuadratureEvals(() => {
      value = r.run({ k: 1 });
    });
    expect(value).toBeCloseTo((E - 1) ** 3, 8);
    expect(r.run({ k: 3 })).toBeCloseTo(3 * (E - 1) ** 3, 8);

    // Measured: 1.38·10⁷ evaluations before the sizing (~0.9 s), 91 125 after
    // (~10 ms) — the interpreter's own cost for the same shape is ~2·10⁴.
    expect(evals).toBeGreaterThan(0);
    expect(evals).toBeLessThan(1_400_000);
  });

  test('a single integral keeps the full starting-panel seeding', () => {
    // One level has nothing to multiply against, so it stays at the quadrature
    // default — and the emitted call carries no panel argument at all, which is
    // what keeps single-integral codegen unchanged.
    const r = compileReal('\\int_0^k \\sin(t^2)\\,dt', { vars: { k: '_.k' } });
    expect(r.code).toContain('_SYS.integrate(');
    expect(r.code).toContain(', 0, _.k)');

    // ∫₀¹ sin(t²) dt = 0.310268301723381 (Fresnel S, verified against the
    // interpreter's own evaluation of the same integral).
    expect(r.run({ k: 1 })).toBeCloseTo(0.310268301723381, 10);
  });

  test('an Integrate node inside another integrand is sized too', () => {
    // The nesting here is two SEPARATE `Integrate` nodes, not one node with two
    // limits — the inner one still runs once per outer panel node, so the depth
    // walk must count it. Value: ∫₀¹(x + ∫₀¹k e^{y} dy) dx = 1/2 + k(e − 1).
    const r = compileReal(
      '\\int_0^1 \\left(x + \\int_0^1 k e^{y}\\,dy\\right)\\,dx',
      { vars: { k: '_.k' } }
    );
    expect(r.code.match(/_SYS\.integrate\(/g)?.length).toBe(2);
    expect(r.code).toContain(', 0, 1, 4)');
    expect(r.run({ k: 1 })).toBeCloseTo(0.5 + (E - 1), 8);
  });
});
