/**
 * A folded symbol value is emitted ONCE on the JavaScript-family targets.
 *
 * `tryFoldKnownSymbol` bakes an assigned value into the generated code the
 * way `evaluate()` folds it. Generated source is text, so a value shared by
 * several references used to be written out once per reference PATH — a
 * tower `f(k) := f(k-1) + 2 f(k-1)` quadrupled per level and was refused by
 * the fold-size guard from depth 13 (see `compile-fold-size-guard.test.ts`).
 * A target that owns the default user-function registry now holds each
 * folded compound pure value as a preamble local (`const _val_f7 = …;`),
 * beside the `_fn_*` definitions, and every reference reads the name.
 *
 * What stays inline, and why:
 * - a leaf value (number, symbol): no shorter as a name;
 * - an impure value (`Random()`): a preamble local is evaluated once per call
 *   of the compiled function, which would stop the re-sampling at each
 *   reference that the interpreter performs;
 * A stored value keeps the binding it was written against (ruled
 * 2026-09-21), so a binder the fold sits under must NOT rebind one of the
 * value's names: `a := n + 1` under `Sum(a, n, 1, 3)` reads the global `n`,
 * which is why the local is written outside the loop. Where no lowering can
 * put it outside the binder — inside a compiled lambda, whose preamble sits
 * in the lambda body, and on the shader targets, which have no preamble at
 * all — the compile DECLINES rather than reading the binder.
 *
 * The constant-folding pre-pass is part of the same story: it saw no
 * `unknowns` in the tower (a symbol with a value is not unknown) and ran an
 * exponential `N()` at every level until its budget expired; and it saw
 * `r + r` with `r := Random()` as pure and baked one sample. It now looks
 * through assigned values for a free symbol or an impure operation before
 * evaluating, and prices a value-carrying symbol at the cost of its value.
 *
 * The `Function`-literal route (`x ↦ …`) places the emitted definitions in
 * `code`, which is how the tests below inspect them; the expression route
 * keeps them in the runner's preamble and is checked through its values.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** `compile()` to `interval-js`, with the call shape of a target's `compile()`. */
const INTERVAL_JS = {
  compile: (expr: any, options: Record<string, unknown> = {}) =>
    compile(expr, { ...options, to: 'interval-js' } as any) as any,
};

/** `f0 := base`, then `f(k) := f(k-1) + 2 f(k-1)` up to `depth`, stored RAW
 * so each level references the previous one as a symbol. Level `k` is worth
 * `3^k · base`. */
function towerEngine(
  depth: number,
  base: string | number = 'x'
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.assign('f0', ce.box(base));
  for (let k = 1; k <= depth; k++)
    ce.assign(
      `f${k}`,
      ce.box(['Add', ['Multiply', `f${k - 1}`, 2], `f${k - 1}`], {
        form: 'raw',
      })
    );
  return ce;
}

describe('COMPILE: folded symbol values are bound once', () => {

  it('a deep tower compiles in linear time with the right value', () => {
    // Level 30 expands to 4 294 967 293 nodes inline; bound, it is 31 locals.
    const ce = towerEngine(30);
    const started = Date.now();
    const result = compile(ce.box('f30'));
    const elapsed = Date.now() - started;
    expect(result.success).toBe(true);
    expect(result.run!({ x: 2 })).toBe(2 * 3 ** 30);
    // Measured at ~50 ms after start-up; only an exponential regression
    // (the inline fold, or a per-path analysis) can reach this ceiling. The
    // time depends on the load of the machine, so the ceiling is asserted only
    // in a `CE_PERF=1` run. The success and value checks above do not depend
    // on time.
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(4000);
  });

  it('a value that refers to its own symbol fails closed on both routes', () => {
    // Storable in raw form only; the interpreter leaves `b` unevaluated
    // (`b + 1`). The compiler used to overflow the stack on it.
    const ce = new ComputeEngine();
    ce.assign('b', ce.box(['Add', 'b', 1], { form: 'raw' }));
    expect(ce.box('b').evaluate().toString()).toBe('b + 1');
    // The public route degrades to the interpreter, whose numeric answer for
    // the unevaluable symbol is NaN.
    const result = compile(ce.box('b'));
    expect(result.success).toBe(false);
    expect(result.run!({})).toBeNaN();
  });

  it('a value under a lambda parameter of the same name DECLINES', () => {
    // The top-level lambda binds `n` and so does the Sum, and the value
    // `a := n + 1` names `n` too. The preamble of a compiled lambda sits
    // INSIDE the lambda body (`userFunctions.valueRoot`), which is the one
    // place a compiled lambda can hold a binding at all: it takes only its
    // declared parameters, so a free symbol has no channel there. A local
    // written in that preamble would read the lambda's parameter, where the
    // interpreter reads the global `n` and answers `3n + 3` — so the compile
    // fails closed rather than answering 18.
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('n + 1'));
    const expr = ce.parse('(n) \\mapsto \\sum_{n=1}^{3} a');
    expect(ce.box(['Apply', expr, 5]).evaluate().toString()).toBe('3n + 3');
    expect(() => compile(expr, { fallback: false })).toThrow(/Could not compile/);
    // The public route degrades to the interpreter, whose answer here is the
    // symbolic `3n + 3` — no number, so `NaN`. It is NOT the 18 the captured
    // local used to produce.
    const result = compile(expr);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reads n, a local or a parameter here/);
    expect((result.run as (n: number) => number)(5)).toBeNaN();
  });

  it('a lambda whose own parameter shadows a name of the value DECLINES', () => {
    // Same shape with no binder inside the body: the lambda's parameter `t`
    // is the only thing that spells `t`, and the value `a := 3t + 1` was
    // written against the global one. `Apply(expr, 5)` is `3t + 6` in the
    // interpreter — a symbolic answer in that global `t`, which a compiled
    // lambda of one parameter cannot express at all.
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('3t + 1'));
    const expr = ce.parse('(t) \\mapsto t + a');
    expect(ce.box(['Apply', expr, 5]).evaluate().toString()).toBe('3t + 6');
    expect(() => compile(expr, { fallback: false })).toThrow(/Could not compile/);
  });

  it('a shader target DECLINES the value its emitted function would capture', () => {
    // The shader targets declare statically typed functions and have no
    // place for an untyped preamble local, so the value is folded INLINE —
    // inside `_fn_g`, whose parameter is spelled `t` too. A free symbol is a
    // bare uniform identifier there, so resolving the value's names outside
    // the function does not help: the spliced text reads the parameter.
    // `float _fn_g(float t) { return (3.0 * t + 1.0) + t; }` answered `7` for
    // `g(2)` where the interpreter answers `3t + 3`.
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('3t + 1'));
    ce.assign('g', ce.parse('(t) \\mapsto t + a'));
    expect(ce.parse('g(2)').evaluate().toString()).toBe('3t + 3');
    for (const to of ['glsl'] as const) {
      expect(() => compile(ce.parse('g(2)'), { to, fallback: false })).toThrow(
        /Could not compile/
      );
      // The public route answers through the interpreter: `3t + 3` at
      // `t = 1` is 6, where the captured shader code answered 7.
      const result = compile(ce.parse('g(2)'), { to });
      expect(result.success).toBe(false);
      expect(result.run!({ t: 1 })).toBe(6);
    }
  });
});
