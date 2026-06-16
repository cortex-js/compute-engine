/**
 * Regression tests for compiling expressions that reference a symbol with an
 * **assigned value** in the engine (`ce.assign("a", 1.5)`).
 *
 * Such a symbol is omitted from `expr.unknowns` and folded by `evaluate()`.
 * `compile()` must agree: it folds the value into the generated code rather
 * than emitting a bare, dangling reference (an undeclared GLSL identifier, or
 * a bare JS global that throws `ReferenceError` at run time).
 *
 * The one exception is an explicit `vars` mapping, which always wins so a
 * mapped symbol stays a per-frame uniform / argument lookup (the GPU/JS live
 * path contract).
 *
 * See `TYCHO_ISSUE.md` for the original report.
 */

import { ComputeEngine } from '../../src/compute-engine';

describe('COMPILE: assigned-symbol folding', () => {
  describe('JavaScript target', () => {
    it('folds an assigned value instead of emitting a bare global', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x) - y');
      const js = ce.getCompilationTarget('javascript')!;
      const { code, run } = js.compile(expr);
      expect(code).toBe('-_.y + Math.sin(1.5 * _.x)');
      // run no longer throws ReferenceError; `a` is folded to its value.
      expect(run!({ x: 2, y: 0 })).toBeCloseTo(Math.sin(3), 12);
    });

    it('still emits _.a for a free (unassigned) symbol', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('\\sin(a x) - y');
      const js = ce.getCompilationTarget('javascript')!;
      expect(js.compile(expr).code).toBe('-_.y + Math.sin(_.a * _.x)');
    });

    it('folds a user-declared constant', () => {
      const ce = new ComputeEngine();
      ce.declare('c', { value: 3 });
      const expr = ce.parse('c x');
      expect(expr.unknowns).toEqual(['x']);
      expect(ce.getCompilationTarget('javascript')!.compile(expr).code).toBe(
        '3 * _.x'
      );
    });

    it('an explicit vars mapping wins over folding (live-path contract)', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x) - y');
      const code = ce
        .getCompilationTarget('javascript')!
        .compile(expr, { vars: { a: 7 } }).code;
      // The mapped literal (7), not the assigned value (1.5), is emitted.
      expect(code).toBe('-_.y + Math.sin(7 * _.x)');
    });
  });

  describe('GLSL target', () => {
    it('folds an assigned value instead of a dangling identifier', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x) - y');
      expect(ce.getCompilationTarget('glsl')!.compile(expr).code).toBe(
        '-y + sin(1.5 * x)'
      );
    });

    it('emits an integer assignment as a float literal', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 3);
      expect(ce.getCompilationTarget('glsl')!.compile(ce.parse('a x')).code).toBe(
        '3.0 * x'
      );
    });

    it('keeps a free symbol declarable (and listed in unknowns)', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('\\sin(a x) - y');
      expect(expr.unknowns).toEqual(['a', 'x', 'y']);
      expect(ce.getCompilationTarget('glsl')!.compile(expr).code).toBe(
        '-y + sin(a * x)'
      );
    });

    it('an explicit vars mapping wins over folding (uniform contract)', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x) - y');
      const code = ce
        .getCompilationTarget('glsl')!
        .compile(expr, { vars: { a: 'u_var_a' } }).code;
      expect(code).toBe('-y + sin(u_var_a * x)');
    });
  });

  describe('WGSL target', () => {
    it('folds an assigned value', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      expect(ce.getCompilationTarget('wgsl')!.compile(ce.parse('a x')).code).toBe(
        '1.5 * x'
      );
    });
  });

  describe('interval-js target', () => {
    it('folds an assigned value into an interval point', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const t = ce.getCompilationTarget('interval-js')!;
      const { code, run } = t.compile(ce.parse('a x'));
      expect(code).toBe('_IA.mul(_IA.point(1.5), _.x)');
      // x = 2 → [3, 3]
      const r = run!({ x: 2 }) as { value: { lo: number; hi: number } };
      expect(r.value.lo).toBeCloseTo(3, 12);
      expect(r.value.hi).toBeCloseTo(3, 12);
    });
  });

  it('compile() agrees with evaluate() on an assigned symbolic value', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('\\pi/2'));
    const expr = ce.parse('\\sin(a x)');
    // evaluate folds a → π/2; compile bakes the same value in.
    expect(ce.getCompilationTarget('javascript')!.compile(expr).code).toBe(
      'Math.sin(0.5 * Math.PI * _.x)'
    );
  });
});
