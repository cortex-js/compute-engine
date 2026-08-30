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
 * - a fold requested from inside a binder whose bound names differ from the
 *   root's (a `Sum` index): the interpreter resolves a value's free symbols
 *   at the point of use, so `a := n + 1` under `Sum(a, n, 1, 3)` reads the
 *   index, and a preamble local outside the binder could not.
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

/** `f0 := base`, then `f(k) := f(k-1) + 2 f(k-1)` up to `depth`, stored RAW
 * so each level references the previous one as a symbol. Level `k` is worth
 * `3^k · base`. */
function towerEngine(
  depth: number,
  base: string | number = 'x'
): ComputeEngine {
  const ce = new ComputeEngine();
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

function occurrences(s: string, needle: string): number {
  return s.split(needle).length - 1;
}

describe('COMPILE: folded symbol values are bound once', () => {
  it('a compound value is emitted once as a local and read by name', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('3x + 1'));
    const result = compile(ce.parse('x \\mapsto a^2 + a'), {
      fallback: false,
    });
    expect(result.success).toBe(true);
    expect(result.code).toContain('const _val_a = 3 * x + 1;');
    expect(occurrences(result.code, '3 * x')).toBe(1);
    expect((result.run as (x: number) => number)(4)).toBe(13 * 13 + 13);
  });

  it('a value referencing another value emits each level once, dependencies first', () => {
    const ce = towerEngine(3);
    const result = compile(ce.box(['Function', ['Add', 'f3', 'f2'], 'x']), {
      fallback: false,
    });
    expect(result.success).toBe(true);
    expect(result.code.match(/const _val_f\d/g)).toEqual([
      'const _val_f1',
      'const _val_f2',
      'const _val_f3',
    ]);
    expect(result.code).toMatch(/const _val_f2 = [^;]*_val_f1[^;]*_val_f1;/);
    expect((result.run as (x: number) => number)(1)).toBe(27 + 9);
  });

  it('the expression route reads the value by name and computes it', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('3x + 1'));
    const js = ce._getCompilationTarget('javascript')!;
    const { code, run } = js.compile(ce.parse('a^2 + a'));
    expect(code).toBe('(_val_a * _val_a) + _val_a');
    expect(run!({ x: 4 })).toBe(13 * 13 + 13);
  });

  it('a deep tower compiles in linear time with the right value', () => {
    // Level 30 expands to 4 294 967 293 nodes inline; bound, it is 31 locals.
    const ce = towerEngine(30);
    const started = Date.now();
    const result = compile(ce.box('f30'));
    const elapsed = Date.now() - started;
    expect(result.success).toBe(true);
    expect(result.run!({ x: 2 })).toBe(2 * 3 ** 30);
    // Measured at ~50 ms after start-up; only an exponential regression
    // (the inline fold, or a per-path analysis) can reach this ceiling.
    expect(elapsed).toBeLessThan(4000);
  });

  it('a value tower over a constant base constant-folds when cheap, and binds when not', () => {
    // Depth 6: the pre-pass evaluates the symbol (cost ≈ 2⁷ units) to a
    // literal, so no level is emitted at all.
    const shallow = towerEngine(6, 2);
    const folded = compile(shallow.box(['Function', 'f6', 'x']), {
      fallback: false,
    });
    expect(folded.code).toBe(`(x) => ${2 * 3 ** 6}`);
    // Depth 30 with constant folding off: the tower is emitted bound and
    // computes at run time. (With folding on, every level the estimate admits
    // — about 2¹⁷ units — is still evaluated once, each within the fold
    // budget; the interpreter is slow on these RAW values, so that route is
    // not timed here.)
    const deep = towerEngine(30, 2);
    const started = Date.now();
    const bound = deep
      ._getCompilationTarget('javascript')!
      .compile(deep.box('f30'), { constantFold: false });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(bound.code).toBe('_val_f30');
    expect(bound.preamble).toContain('const _val_f30 = ');
    expect(bound.run!({})).toBe(2 * 3 ** 30);
  });

  it('the interval target binds too', () => {
    const ce = towerEngine(4);
    const target = ce._getCompilationTarget('interval-js')!;
    const { code } = target.compile(ce.box('f4'));
    expect(code).toBe('_val_f4');
  });

  it('a leaf value stays inline', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box('x'));
    const js = ce._getCompilationTarget('javascript')!;
    expect(js.compile(ce.parse('a + a')).code).toBe('_.x + _.x');
  });

  it('an impure value stays inline so each reference re-samples', () => {
    const ce = new ComputeEngine();
    ce.assign('r', ce.box(['Random']));
    const js = ce._getCompilationTarget('javascript')!;
    const { code, run } = js.compile(ce.box(['Add', 'r', 'r']));
    expect(code).not.toContain('_val_');
    // Two draws per call, as the interpreter performs — and NOT a baked
    // constant: the fold pre-pass now sees the impurity through the value.
    expect(code).toBe(
      '_SYS.drawNextRandomNumber() + _SYS.drawNextRandomNumber()'
    );
    expect(run!({})).not.toBe(run!({}));
  });

  it('a value that refers to its own symbol fails closed on both routes', () => {
    // Storable in raw form only; the interpreter leaves `b` unevaluated
    // (`b + 1`). The compiler used to overflow the stack on it.
    const ce = new ComputeEngine();
    ce.assign('b', ce.box(['Add', 'b', 1], { form: 'raw' }));
    expect(ce.box('b').evaluate().toString()).toBe('b + 1');
    const js = ce._getCompilationTarget('javascript')!;
    expect(() => js.compile(ce.box('b'))).toThrow(/refers to itself/);
    const py = ce._getCompilationTarget('python')!;
    expect(() => py.compile(ce.box('b'))).toThrow(/refers to itself/);
    // The public route degrades to the interpreter, whose numeric answer for
    // the unevaluable symbol is NaN.
    const result = compile(ce.box('b'));
    expect(result.success).toBe(false);
    expect(result.run!({})).toBeNaN();
  });

  it('a value that is impure THROUGH another value stays inline', () => {
    // `a` itself is pure (its symbol `r` is), but `r := Random()`: sharing
    // `a` once would draw two samples per call where the interpreter draws
    // two at EVERY reference of `a`.
    const ce = new ComputeEngine();
    ce.assign('r', ce.box(['Random']));
    ce.assign('a', ce.box(['Add', 'r', 'r']));
    const js = ce._getCompilationTarget('javascript')!;
    const { code, preamble } = js.compile(ce.box(['Add', 'a', 'a']));
    expect(preamble ?? '').not.toContain('_val_');
    expect(occurrences(code, 'drawNextRandomNumber')).toBe(4);
  });

  it('two symbols whose names sanitize alike get distinct locals', () => {
    const ce = new ComputeEngine();
    // (A bare non-ASCII string in MathJSON is a string literal; the symbols
    // are built with `ce.symbol`.)
    ce.assign('xα', ce.parse('x + 1'));
    ce.assign('xβ', ce.parse('2x'));
    const js = ce._getCompilationTarget('javascript')!;
    const { preamble, run } = js.compile(
      ce.function('Add', [ce.symbol('xα'), ce.symbol('xβ')])
    );
    expect(preamble).toContain('const _val_x_ = ');
    expect(preamble).toContain('const _val_x__2 = ');
    expect(run!({ x: 1 })).toBe(2 + 2);
  });

  it('a binder that rebinds a root parameter name keeps the value inline', () => {
    // The lambda binds `n` and so does the Sum: the value `a := n + 1` reads
    // the Sum index in the interpreter, so it must not be hoisted to the
    // lambda body where `n` is the parameter.
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('n + 1'));
    const expr = ce.parse('(n) \\mapsto \\sum_{n=1}^{3} a');
    expect(ce.box(['Apply', expr, 5]).evaluate().re).toBe(9);
    const result = compile(expr, { fallback: false });
    expect(result.success).toBe(true);
    expect(result.code).not.toContain('_val_a');
    expect((result.run as (n: number) => number)(5)).toBe(9);
  });

  it('a value read inside a user function binds at the root only when it mentions no parameter', () => {
    const engine = () => {
      const ce = new ComputeEngine();
      ce.assign('a', ce.parse('3t + 1'));
      ce.assign('g', ce.parse('(t) \\mapsto t + a'));
      return ce;
    };
    // Inside the emitted `_fn_g`, `a` is folded inline and reads g's own `t`
    // (2 → a = 7, g(2) = 9), as it did before values were bound; at the root
    // it reads the free `t` through the bound local. (The interpreter reads
    // the GLOBAL `t` inside `g` — symbol-value resolution skips a foreign
    // call-frame activation — so it answers 10 here; that compiled-vs-
    // interpreted divergence predates value binding and is recorded in
    // ROADMAP.md under "Compiling a DAG-shared symbol value".)
    const ce = engine();
    const js = ce._getCompilationTarget('javascript')!;
    const { preamble, run } = js.compile(ce.parse('g(2) + a'));
    expect(preamble).toContain('const _fn_g = (t) => (3 * t + 1) + t;');
    expect(preamble).toContain('const _val_a = 3 * _.t + 1;');
    expect(run!({ t: 1 })).toBe(13);
  });

  it('a fold under a Sum index keeps the interpreter capture (inline)', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('n + 1'));
    const expr = ce.parse('\\sum_{n=1}^{3} a');
    expect(expr.evaluate().re).toBe(9);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).not.toContain('_val_a');
    expect(result.run!({})).toBe(9);
  });

  it('a value read from inside an emitted user function binds at the root, once', () => {
    const ce = new ComputeEngine();
    // A closed value, with constant folding off so it is emitted as code.
    ce.assign('a', ce.parse('\\sin(1) + 1'));
    ce.assign('g', ce.parse('(t) \\mapsto t + a'));
    const result = compile(ce.parse('x \\mapsto g(x) + a'), {
      fallback: false,
      constantFold: false,
    });
    expect(result.success).toBe(true);
    // The value precedes the function that reads it, and is emitted once.
    expect(result.code).toContain('const _val_a = 1 + Math.sin(1);');
    expect(result.code.indexOf('const _val_a')).toBeLessThan(
      result.code.indexOf('const _fn_g')
    );
    expect(occurrences(result.code, 'const _val_a')).toBe(1);
    expect((result.run as (x: number) => number)(1)).toBeCloseTo(
      1 + 2 * (Math.sin(1) + 1)
    );
  });
});
