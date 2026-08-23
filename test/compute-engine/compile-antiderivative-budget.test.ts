/**
 * The shared antiderivative-first pool
 * (`ANTIDERIVATIVE_COMPILATION_BUDGET_MS`) is module-static state consumed by
 * every symbolic closed-form attempt in a compilation. It must start fresh at
 * EVERY outermost compilation, whatever route entered it — the reset lives at
 * the depth-0 boundary of `BaseCompiler.compile`, the one choke point all
 * routes cross.
 *
 * The regression this pins: registered targets invoked directly
 * (`ce._getCompilationTarget('javascript').compile(...)`) enter through
 * `compileCseRoot`, and when the reset hung off `compileRoot` and the public
 * `compile()` entry only, a compilation that drained the pool left every
 * later direct-target compilation skipping the symbolic attempt permanently:
 * `∫ 2x dx` emitted the runtime quadrature `_SYS.integrate(...)` where a
 * fresh pool emits the closed form `t²`.
 *
 * The pool is drained here by writing the counter, not by burning 4 s of
 * wall-clock: what is under test is the reset's PLACEMENT, not the
 * consumption mechanics.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** Simulate a prior compilation having spent the whole pool. */
function drainPool(): void {
  (BaseCompiler as any).antiderivativeBudgetLeftMs = 0;
}

function closedFormIntegral(ce: ComputeEngine) {
  // ∫₀ᵗ 2x dx = t² — an integral the symbolic attempt closes instantly.
  return ce.box(['Integrate', ['Multiply', 2, 'x'], ['Tuple', 'x', 0, 't']]);
}

describe('COMPILE: the shared antiderivative pool resets per compilation', () => {
  it('a drained pool does not leak into a registered-target DIRECT compilation', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const target = ce._getCompilationTarget('javascript')!;
    drainPool();
    const code = target.compile(closedFormIntegral(ce)).code!;
    expect(code).not.toContain('_SYS.integrate');
    expect(code).toContain('_.t * _.t');
  });

  it('a drained pool does not leak into the public compile() entry either', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    drainPool();
    const code = compile(closedFormIntegral(ce)).code!;
    expect(code).not.toContain('_SYS.integrate');
    expect(code).toContain('_.t * _.t');
  });

  it('CONSECUTIVE compilations each get a fresh pool', () => {
    // Every outermost entry — including each attempt of an auto-mode
    // escalation, which re-enters `BaseCompiler.compile` at depth 0 per
    // attempt (`auto-escalation.ts` re-runs the target's whole compile) —
    // starts full. Pin the repeatable core: drain, compile, drain, compile;
    // both compilations close the integral symbolically.
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const target = ce._getCompilationTarget('javascript')!;
    for (let i = 0; i < 2; i++) {
      drainPool();
      const code = target.compile(closedFormIntegral(ce)).code!;
      expect(code).not.toContain('_SYS.integrate');
    }
  });

  it('the symbolic attempt still CONSUMES from the pool after the reset move', () => {
    // The per-compilation bound is only real if attempts decrement the
    // counter the reset refills. Consumption is wall-clock
    // (`performance.now()` deltas), so a trivial attempt may complete within
    // one timer tick — the pin is therefore ≤ full (never refilled above
    // full mid-compilation) and > 0 (one cheap integral cannot drain 4 s);
    // the strict below-full case is real work's normal outcome but is not
    // asserted, per the repo's wall-clock test doctrine. (No `constantFold`
    // manipulation is needed: the integral's `t` is free, so the constant
    // fold never intercepts the node and the antiderivative attempt always
    // runs.)
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const target = ce._getCompilationTarget('javascript')!;
    target.compile(closedFormIntegral(ce));
    const left = (BaseCompiler as any).antiderivativeBudgetLeftMs as number;
    expect(left).toBeLessThanOrEqual(
      (BaseCompiler as any).ANTIDERIVATIVE_COMPILATION_BUDGET_MS
    );
    expect(left).toBeGreaterThan(0);
  });
});
