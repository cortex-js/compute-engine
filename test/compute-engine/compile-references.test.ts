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
        .getCompilationTarget('javascript')!
        .compile(ce.parse('\\sin(a x) - y'));
      expect(r.freeSymbols!.sort()).toEqual(['a', 'x', 'y']);
      expect(r.unsupported).toEqual([]);
    });

    it('omits an assigned symbol (its value is folded in)', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const r = ce
        .getCompilationTarget('javascript')!
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
        .getCompilationTarget('javascript')!
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
      const r = ce.getCompilationTarget('javascript')!.compile(expr);
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
    it('Map(list, userFn) references the shared local and runs', () => {
      const ce = new ComputeEngine();
      ce.parse('h(x) := x^2').evaluate();
      const r = ce
        .getCompilationTarget('javascript')!
        .compile(ce.box(['Map', ['List', 'a', 'b'], 'h']));
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
        .getCompilationTarget('javascript')!
        .compile(ce.box(['Filter', ['List', 'a', 'b', 'c'], 'p']));
      expect(r.success).toBe(true);
      expect(r.run!({ a: 1, b: 3, c: 5 })).toEqual([3, 5]);
    });

    it("surfaces a free symbol referenced only in the operand function's body", () => {
      const ce = new ComputeEngine();
      ce.parse('q(x) := x + k').evaluate();
      const r = ce
        .getCompilationTarget('javascript')!
        .compile(ce.box(['Map', ['List', 'a', 'b'], 'q']));
      // `k` (free in q's body) is surfaced; `q` itself is not free.
      expect(r.freeSymbols!.sort()).toEqual(['a', 'b', 'k']);
      expect(r.run!({ a: 1, b: 2, k: 10 })).toEqual([11, 12]);
    });

    it('still compiles an inline lambda operand', () => {
      const ce = new ComputeEngine();
      const r = ce
        .getCompilationTarget('javascript')!
        .compile(ce.parse('\\mathrm{Map}([1,2,3], x \\mapsto x^2)'));
      expect(r.run!({})).toEqual([1, 4, 9]);
    });

    // A bound parameter whose name collides with a global user function must
    // resolve to the PARAMETER, not silently shadow it with the global `_fn_`.
    it('a parameter shadowing a same-named global function wins over the global', () => {
      const ce = new ComputeEngine();
      ce.parse('h(x) := x^2').evaluate(); // global `h`
      // f(h) := Map([1,2,3], h) — `h` here is f's (function-valued) parameter.
      ce.assign('f', ce.box(['Function', ['Map', ['List', 1, 2, 3], 'h'], 'h']));
      const r = ce
        .getCompilationTarget('javascript')!
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
        .getCompilationTarget('javascript')!
        .compile(ce.box(['Map', ['List', 'a', 'b'], 'h']), {
          vars: { h: 'EXTERNAL_H' },
        });
      // Resolves to the mapped source, not the shared local `_fn_h`.
      expect(r.code).not.toContain('_fn_h');
      expect(r.freeSymbols).toContain('h');
    });

    // A Typed-annotated parameter of the operand function must still be treated
    // as bound (excluded from freeSymbols), matching the codegen path.
    it('excludes a Typed-annotated parameter of the operand function from freeSymbols', () => {
      const ce = new ComputeEngine();
      ce.assign(
        'p',
        ce.box(['Function', ['Add', 'x', 'k'], ['Typed', 'x', 'integer']])
      );
      const r = ce
        .getCompilationTarget('javascript')!
        .compile(ce.box(['Map', ['List', 'a', 'b'], 'p']));
      // `x` is the bound (typed) parameter; only `a`, `b`, `k` are free.
      expect(r.freeSymbols!.sort()).toEqual(['a', 'b', 'k']);
    });
  });
});
