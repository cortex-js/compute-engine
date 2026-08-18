/**
 * Declarative "is this compiled result self-contained?" signal:
 * `result.freeSymbols` (identifiers the caller must supply) and
 * `result.unsupported` (operators the target cannot lower), plus `error` on a
 * failed compile. See the `CompilationResult` type and
 * `BaseCompiler.analyzeReferences`.
 *
 * Related ask B in `TYCHO_ISSUE.md`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('COMPILE reference analysis (freeSymbols / unsupported)', () => {
  describe('freeSymbols on a successful compile', () => {
    it('lists the genuinely free symbols', () => {
      const ce = new ComputeEngine();
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.parse('\\sin(a x) - y'));
      expect(r.freeSymbols!.sort()).toEqual(['a', 'x', 'y']);
      expect(r.unsupported).toEqual([]);
    });

    it('omits an assigned symbol (its value is folded in)', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.parse('\\sin(a x) - y'));
      expect(r.code).toContain('1.5');
      expect(r.freeSymbols!.sort()).toEqual(['x', 'y']);
    });

    it('omits constants', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.parse('2 \\cos(\\pi / 5)'))!;
      expect(r.freeSymbols).toEqual([]);
      expect(r.unsupported).toEqual([]);
    });

    it('lists a vars-mapped symbol as a required external input', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.parse('\\sin(a x) - y'), { vars: { a: 'u_var_a' } });
      // The vars mapping wins over folding, so `a` is referenced and must be
      // supplied — it appears in freeSymbols even though it has a value.
      expect(r.freeSymbols!.sort()).toEqual(['a', 'x', 'y']);
    });

    it('surfaces a free symbol reachable only through a folded value (which `unknowns` misses)', () => {
      const ce = new ComputeEngine();
      ce.assign('b', ce.parse('c + 1'));
      const expr = ce.parse('b x');
      expect(expr.unknowns).toEqual(['x']); // `c` is hidden behind `b`'s value
      const r = ce._getCompilationTarget('javascript')!.compile(expr);
      expect(r.freeSymbols!.sort()).toEqual(['c', 'x']);
    });

    it('excludes a lambda parameter', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(['Function', ['Multiply', 2, 't'], 't']))!;
      expect(r.freeSymbols).toEqual([]);
    });

    it('excludes a Sum index but keeps a free bound', () => {
      const ce = new ComputeEngine();
      const r = compile(
        ce.box(['Sum', ['Power', 'i', 2], ['Limits', 'i', 1, 'n']])
      )!;
      expect(r.freeSymbols).toEqual(['n']);
    });
  });

  describe('unsupported / error on failure', () => {
    it('reports an unsupported operator declaratively (no throw) via compile()', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(['Gamma', ['__NotAnOp', 'x']]) as any, {
        to: 'glsl',
      });
      expect(r.success).toBe(false);
      expect(r.unsupported).toContain('__NotAnOp');
      expect(typeof r.error).toBe('string');
      expect(r.error).toMatch(/__NotAnOp/);
    });

    it('GLSL cannot lower the JS-only integral special functions', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(['SinIntegral', 'x']), { to: 'glsl' });
      expect(r.success).toBe(false);
      expect(r.unsupported).toContain('SinIntegral');
      // Same source compiles fine on the JavaScript target (Related ask A).
      const js = compile(ce.box(['SinIntegral', 'x']));
      expect(js.success).toBe(true);
      expect(js.unsupported).toEqual([]);
    });
  });

  // A user-defined function used as a first-class VALUE (a higher-order
  // operand to Map/Filter), not just as a call head, resolves to the shared
  // emitted local `_fn_<name>` rather than a dangling `_.<name>` free var.
  describe('user-defined function as a higher-order operand', () => {
    it('Map(userFn, list) references the shared local and runs', () => {
      const ce = new ComputeEngine();
      ce.parse('h(x) := x^2').evaluate();
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.box(['Map', 'h', ['List', 'a', 'b']]));
      expect(r.success).toBe(true);
      expect(r.code).toContain('_fn_h');
      expect(r.code).not.toContain('_.h');
      expect(r.run!({ a: 3, b: 4 })).toEqual([9, 16]);
      // The function name is NOT a required external input.
      expect(r.freeSymbols).not.toContain('h');
    });

    it('Filter(list, userFn) references the shared local and runs', () => {
      const ce = new ComputeEngine();
      ce.parse('p(x) := x > 2').evaluate();
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.box(['Filter', ['List', 'a', 'b', 'c'], 'p']));
      expect(r.success).toBe(true);
      expect(r.run!({ a: 1, b: 3, c: 5 })).toEqual([3, 5]);
    });

    it("surfaces a free symbol referenced only in the operand function's body", () => {
      const ce = new ComputeEngine();
      ce.parse('q(x) := x + k').evaluate();
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.box(['Map', 'q', ['List', 'a', 'b']]));
      // `k` (free in q's body) is surfaced; `q` itself is not free.
      expect(r.freeSymbols!.sort()).toEqual(['a', 'b', 'k']);
      expect(r.run!({ a: 1, b: 2, k: 10 })).toEqual([11, 12]);
    });

    it('still compiles an inline lambda operand', () => {
      const ce = new ComputeEngine();
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.parse('\\mathrm{Map}(x \\mapsto x^2, [1,2,3])'));
      expect(r.run!({})).toEqual([1, 4, 9]);
    });

    // A bound parameter whose name collides with a global user function must
    // resolve to the PARAMETER, not silently shadow it with the global `_fn_`.
    it('a parameter shadowing a same-named global function wins over the global', () => {
      const ce = new ComputeEngine();
      ce.parse('h(x) := x^2').evaluate(); // global `h`
      // f(h) := Map(h, [1,2,3]) — `h` here is f's (function-valued) parameter.
      ce.assign('f', ce.box(['Function', ['Map', 'h', ['List', 1, 2, 3]], 'h']));
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.box(['f', ['Function', ['Add', 'y', 10], 'y']]));
      // The passed function (y ↦ y+10) must be used, not the global h(x)=x².
      expect(r.run!({})).toEqual([11, 12, 13]);
    });

    // An explicit `vars` mapping is the caller's external-input contract and
    // always wins, even when its key collides with a user-function name.
    it('a `vars` mapping wins over a same-named user function', () => {
      const ce = new ComputeEngine();
      ce.parse('h(x) := x^2').evaluate();
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.box(['Map', 'h', ['List', 'a', 'b']]), {
          vars: { h: 'EXTERNAL_H' },
        });
      // Resolves to the mapped source, not the shared local `_fn_h`.
      expect(r.code).not.toContain('_fn_h');
      expect(r.freeSymbols).toContain('h');
    });

    // A Typed-annotated parameter of the operand function must still be treated
    // as bound (excluded from freeSymbols), matching the codegen path.
    // The element type of the mapped source must be PROVABLE and must satisfy
    // the annotation, or the callback-annotation gate declines the whole shape
    // (`BaseCompiler.assertCallbackAnnotations`) — the compiled callback drops
    // the `Typed` enforcement the interpreter performs per element. `a`/`b` are
    // therefore declared `integer` here; that is orthogonal to what this test
    // pins (the parameter is BOUND, not free).
    it('excludes a Typed-annotated parameter of the operand function from freeSymbols', () => {
      const ce = new ComputeEngine();
      ce.declare('a', 'integer');
      ce.declare('b', 'integer');
      ce.assign(
        'p',
        ce.box(['Function', ['Add', 'x', 'k'], ['Typed', 'x', 'integer']])
      );
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.box(['Map', 'p', ['List', 'a', 'b']]));
      // `x` is the bound (typed) parameter; only `a`, `b`, `k` are free.
      expect(r.freeSymbols!.sort()).toEqual(['a', 'b', 'k']);
    });
  });

  // A custom per-operator `compile` handler may decline for a given target
  // language (returning `undefined`). The analysis must PROBE the handler, not
  // assume any head with a handler is lowerable everywhere — otherwise it
  // under-reports `unsupported` on the targets the handler doesn't cover.
  describe('custom compile handler language support (probed)', () => {
    it('reports a JS-only handler head as unsupported on glsl but not javascript', () => {
      const ce = new ComputeEngine();
      // `Quadrance` has no built-in mapping on any target, so the ONLY lowering
      // is this handler — and it emits code for javascript only.
      ce.declare('Quadrance', {
        signature: '(number, number) -> number',
        compile: (args, c, { language }) =>
          language === 'javascript'
            ? `((${c(args[0])})**2 + (${c(args[1])})**2)`
            : undefined,
      });
      const expr = ce.parse('\\mathrm{Quadrance}(x, y)');

      // JavaScript: the handler emits code → not unsupported.
      const js = compile(expr);
      expect(js.success).toBe(true);
      expect(js.unsupported).toEqual([]);

      // GLSL: the handler declines (returns undefined) and there is no built-in
      // Quadrance lowering → the probe surfaces it as unsupported.
      const glsl = compile(expr, { to: 'glsl' });
      expect(glsl.unsupported).toContain('Quadrance');
      expect(glsl.success).toBe(false);
    });

    it('a handler covering both languages is unsupported on neither', () => {
      const ce = new ComputeEngine();
      ce.declare('Quadrance2', {
        signature: '(number, number) -> number',
        compile: (args, c) => `((${c(args[0])})**2 + (${c(args[1])})**2)`,
      });
      const expr = ce.parse('\\mathrm{Quadrance2}(x, y)');
      expect(compile(expr).unsupported).toEqual([]);
      expect(compile(expr, { to: 'glsl' }).unsupported).toEqual([]);
    });
  });
});
