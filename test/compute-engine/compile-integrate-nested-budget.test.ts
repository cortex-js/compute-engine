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

describe('COMPILE Integrate — nested-quadrature evaluation budget', () => {
  test('a single integral is untouched by the budget', () => {
    // The `vars` mapping forbids folding a live runtime input into a baked
    // closed form, which is what keeps this on the quadrature emitter — the
    // path the budget wraps. Only the OUTERMOST level runs here, and an
    // outermost level never consumes budget.
    const r = compileReal('\\int_0^k \\sin t\\,dt', { vars: { k: '_.k' } });
    expect(r.code).toContain('_SYS.integrate(');

    // ∫₀¹ sin t dt = 1 − cos 1.
    expect(r.run({ k: 1 })).toBeCloseTo(1 - Math.cos(1), 12);
    // ∫₀^{π} sin t dt = 2.
    expect(r.run({ k: Math.PI })).toBeCloseTo(2, 12);
  });

  test('a two-level nested integral keeps its value', () => {
    // 60 outer evaluations (4 starting panels, sized by the tree-visible depth
    // of two), each a full inner quadrature: 3600 nested evaluations, four
    // orders of magnitude inside the budget. The reference is the interpreter's
    // own value for the same expression, which reaches quadrature by a
    // different route (its own panel seeding), not a recalled constant.
    const latex = '\\int_0^1\\int_0^1 e^{-x y^2}\\,dy\\,dx';
    const r = compileReal(latex);
    expect(r.code.match(/_SYS\.integrate\(/g)?.length).toBe(2);

    const expected = ce.parse(latex).N().re;
    expect(Number.isFinite(expected)).toBe(true);
    const out = r.run();
    expect(Number.isFinite(out)).toBe(true);
    expect(out).toBeCloseTo(expected, 8);
  });

  test('by-reference composition is bounded: the innermost level answers NaN', () => {
    // Four levels of quadrature want ~3.3·10⁹ integrand evaluations. The
    // budget cuts the nested work after ~3.4·10⁷ and the innermost integral
    // answers `NaN`, which the enclosing quadratures carry outward — so the
    // pin is that this returns at all, with a value that does not pretend to
    // be an estimate.
    //
    // A finite result here would mean the composition stopped nesting (a level
    // gained a closed form, say), not that the budget failed — check the level
    // count before touching the budget.
    const r = compileReal(byReferenceChain(), { vars: { s: '_.s' } });
    expect(r.code).toContain('_SYS.integrate(');

    expect(Number.isNaN(r.run({ s: 0 }))).toBe(true);
  }, 60000);

  test('a fresh outermost integral gets a fresh budget', () => {
    // The budget is armed per OUTERMOST entry, so an exhausted run must not
    // leave the counter negative for the integrals that follow it. Exhaust it,
    // then run an ordinary nested integral and require its full value back.
    const exhausting = compileReal(byReferenceChain(), { vars: { s: '_.s' } });
    expect(Number.isNaN(exhausting.run({ s: 0 }))).toBe(true);

    const latex = '\\int_0^1\\int_0^1 e^{-x y^2}\\,dy\\,dx';
    const expected = ce.parse(latex).N().re;
    const after = compileReal(latex).run();
    expect(Number.isFinite(after)).toBe(true);
    expect(after).toBeCloseTo(expected, 8);

    // And the exhausting artifact itself is still usable: its own next call
    // starts from a full budget too (it exhausts it again, so `NaN` again —
    // what matters is that it took the same path, not a poisoned one).
    expect(Number.isNaN(exhausting.run({ s: 0 }))).toBe(true);
  }, 60000);

  // `quadrature: 'monte-carlo'` emits `_SYS.integrateMC` instead, and it joins
  // the same activation accounting: without that, every one of its 10⁷ samples
  // looked like an outermost entry and re-armed the budget, so an integral
  // reached from inside a Monte-Carlo integrand was bounded by nothing.
  test('a plain Monte-Carlo integral spends none of its own budget', () => {
    // The samples of an OUTERMOST integral are free — `budgetedIntegrand`
    // charges an evaluation only while another integral is already running —
    // so all 10⁷ are drawn and the estimate stands. (Charging them would
    // exhaust a 2²⁵ budget a third of the way through and answer `NaN`.)
    const r = compileReal('\\int_0^1 e^{-k x^2}\\,dx', {
      quadrature: 'monte-carlo',
      vars: { k: '_.k' },
    });
    expect(r.code).toContain('_SYS.integrateMC(');

    // ∫₀¹ e^{-x²} dx = √π·erf(1)/2 = 0.746824132812427. Monte Carlo is
    // stochastic (~10⁻⁴ here), so the tolerance is the estimator's, not the
    // quadrature's.
    expect(r.run({ k: 1 })).toBeCloseTo(0.746824132812427, 3);
  }, 60000);

  test('by-reference composition under Monte Carlo is bounded too', () => {
    // Two levels of deterministic quadrature reached by reference from inside a
    // Monte-Carlo integrand: 10⁷ samples × a full two-level nest is ~10¹¹
    // integrand evaluations, hours of synchronous work. With `integrateMC`
    // counted as an activation, those nested evaluations consume the shared
    // budget, the nested integrals answer `NaN` once it is gone, and the
    // estimate — built on refused samples — is `NaN` rather than a number.
    ce.parse('g_{1}(w) \\coloneq \\int_0^1 \\sin((w+x)^2)\\,dx').evaluate();
    ce.parse(
      'g_{2}(w) \\coloneq \\int_0^1 \\sin((g_{1}(x)+w)^2)\\,dx'
    ).evaluate();

    const r = compileReal('\\int_0^1 g_{2}(t+s)\\,dt', {
      quadrature: 'monte-carlo',
      vars: { s: '_.s' },
    });
    expect(r.code).toContain('_SYS.integrateMC(');

    // Measured ~5 s: the budget's 3.4·10⁷ nested evaluations, then the
    // remaining samples answered without integrating. As everywhere in this
    // file the verdict is the VALUE — that the call returns at all is what the
    // accounting buys, and the timeout is a label, not a backstop.
    expect(Number.isNaN(r.run({ s: 0 }))).toBe(true);
  }, 60000);
});
