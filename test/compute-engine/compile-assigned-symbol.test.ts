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
 * Also covers two adjacent issues in the same failure class:
 *  - folding on the direct-target `compile(expr, { target })` path; and
 *  - emitting non-finite numbers (`∞`, `NaN`) on GPU targets, which have no
 *    such LITERALS but can make the values from a bit pattern, through the same
 *    overridable symbols a masked `When`/`Which` branch already used.
 *
 * See `TYCHO_ISSUE.md` for the original report.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('COMPILE: assigned-symbol folding', () => {
  describe('JavaScript target', () => {
    it('folds an assigned value instead of emitting a bare global', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x) - y');
      const js = ce._getCompilationTarget('javascript')!;
      const { code, run } = js.compile(expr);
      expect(code).toBe('-_.y + Math.sin(1.5 * _.x)');
      // run no longer throws ReferenceError; `a` is folded to its value.
      expect(run!({ x: 2, y: 0 })).toBeCloseTo(Math.sin(3), 12);
    });

    it('still emits _.a for a free (unassigned) symbol', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('\\sin(a x) - y');
      const js = ce._getCompilationTarget('javascript')!;
      expect(js.compile(expr).code).toBe('-_.y + Math.sin(_.a * _.x)');
    });

    it('folds a user-declared constant', () => {
      const ce = new ComputeEngine();
      ce.declare('c', { value: 3 });
      const expr = ce.parse('c x');
      expect(expr.unknowns).toEqual(['x']);
      expect(ce._getCompilationTarget('javascript')!.compile(expr).code).toBe(
        '3 * _.x'
      );
    });

    it('an explicit vars mapping wins over folding (live-path contract)', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x) - y');
      const code = ce
        ._getCompilationTarget('javascript')!
        .compile(expr, { vars: { a: 7 } }).code;
      // The mapped literal (7), not the assigned value (1.5), is emitted.
      expect(code).toBe('-_.y + Math.sin(7 * _.x)');
    });

    it('a string vars mapping is spliced as source, keeping the symbol live', () => {
      // The live-path contract for JS: `{ a: '_.a' }` keeps `a` a runtime
      // argument of the compiled function even though it has an assigned
      // value — one engine state serves both the compile-once path and the
      // fold-early evaluate path. (Previously the source string was
      // JSON-stringified into a string literal, yielding NaN at run time.)
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x) - y');
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(expr, { vars: { a: '_.a' } });
      expect(r.code).toBe('-_.y + Math.sin(_.a * _.x)');
      expect(r.run!({ a: 2, x: 1, y: 0 })).toBeCloseTo(Math.sin(2), 12);
    });
  });

  describe('GLSL target', () => {
    it('folds an assigned value instead of a dangling identifier', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x) - y');
      expect(ce._getCompilationTarget('glsl')!.compile(expr).code).toBe(
        '-y + sin(1.5 * x)'
      );
    });

    it('emits an integer assignment as a float literal', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 3);
      expect(
        ce._getCompilationTarget('glsl')!.compile(ce.parse('a x')).code
      ).toBe('3.0 * x');
    });

    it('keeps a free symbol declarable (and listed in unknowns)', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('\\sin(a x) - y');
      expect(expr.unknowns).toEqual(['a', 'x', 'y']);
      expect(ce._getCompilationTarget('glsl')!.compile(expr).code).toBe(
        '-y + sin(a * x)'
      );
    });

    it('an explicit vars mapping wins over folding (uniform contract)', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x) - y');
      const code = ce
        ._getCompilationTarget('glsl')!
        .compile(expr, { vars: { a: 'u_var_a' } }).code;
      expect(code).toBe('-y + sin(u_var_a * x)');
    });
  });

  describe('WGSL target', () => {
    it('folds an assigned value', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      expect(
        ce._getCompilationTarget('wgsl')!.compile(ce.parse('a x')).code
      ).toBe('1.5 * x');
    });
  });

  describe('interval-js target', () => {
    it('folds an assigned value into an interval point', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const t = ce._getCompilationTarget('interval-js')!;
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
    // evaluate folds a → π/2; compile bakes the same value in. The folded
    // compound value parenthesizes itself so it stays correct when spliced into
    // a surrounding operator (the redundant parens here are harmless).
    // `constantFold: false`: the spliced value `π/2` is itself a
    // variable-free subtree, so compile-time constant folding would collapse
    // it to `1.5707963267948966` and the parenthesization this test pins
    // would no longer be observable. The splicing under test is unaffected.
    expect(
      ce
        ._getCompilationTarget('javascript')!
        .compile(expr, { constantFold: false }).code
    ).toBe('Math.sin((0.5 * Math.PI) * _.x)');
  });

  // A symbol assigned a *symbolic* value whose value itself references a free
  // symbol (`b = c + 1`, then compile `b·x`). Two failure modes the fold must
  // avoid: (1) splicing the compound value in without parentheses
  // (`c + 1 * x` ≠ `(c + 1) * x`) — a silently wrong result; and (2) emitting
  // the inner free symbol `c` bare — `c` is hidden behind `b`'s value so it is
  // absent from `expr.unknowns`, yet it must still route through the
  // free-symbol plumbing (`_.c`), not a bare global that throws.
  describe('transitive folding (assigned value references a free symbol)', () => {
    const freshEngine = () => {
      const ce = new ComputeEngine();
      ce.assign('b', ce.parse('c + 1'));
      return ce;
    };

    it('parenthesizes the compound value in a product', () => {
      const ce = freshEngine();
      const r = ce._getCompilationTarget('javascript')!.compile(ce.parse('b x'));
      expect(r.code).toBe('(_.c + 1) * _.x');
      expect(r.run!({ c: 2, x: 3 })).toBe(9); // (2+1)*3
    });

    it('parenthesizes the compound value under a coefficient and a power', () => {
      const ce = freshEngine();
      const js = ce._getCompilationTarget('javascript')!;
      expect(js.compile(ce.parse('2 b')).run!({ c: 2 })).toBe(6); // 2*(2+1)
      expect(js.compile(ce.parse('b^2')).run!({ c: 2 })).toBe(9); // (2+1)^2
    });

    it('routes the inner free symbol through the vars object (not a bare global)', () => {
      const ce = freshEngine();
      const r = ce._getCompilationTarget('javascript')!.compile(ce.parse('b x'));
      expect(r.code).toContain('_.c');
      expect(r.code).not.toMatch(/(^|[^.\w])c([^\w]|$)/); // no bare `c`
      // freeSymbols surfaces the transitively-referenced input.
      expect(r.freeSymbols!.sort()).toEqual(['c', 'x']);
    });

    it('keeps the GLSL precedence correct (free symbol stays a bare uniform there)', () => {
      const ce = freshEngine();
      const r = ce._getCompilationTarget('glsl')!.compile(ce.parse('b x'));
      expect(r.code).toBe('(c + 1.0) * x');
    });
  });

  // The direct-target path — `compile(expr, { target })` with a raw target —
  // bypasses each LanguageTarget's `compile()`; folding must still happen
  // (BaseCompiler resolves it), while a free symbol stays bare.
  describe('direct-target path: compile(expr, { target })', () => {
    it('folds an assigned value (GLSL and JS raw targets)', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const expr = ce.parse('\\sin(a x)');
      const glslRaw = ce._getCompilationTarget('glsl')!.createTarget();
      const jsRaw = ce._getCompilationTarget('javascript')!.createTarget();
      expect(compile(expr, { target: glslRaw }).code).toBe('sin(1.5 * x)');
      expect(compile(expr, { target: jsRaw }).code).toBe('Math.sin(1.5 * x)');
    });

    it('leaves a free symbol bare', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('\\sin(a x)');
      const glslRaw = ce._getCompilationTarget('glsl')!.createTarget();
      expect(compile(expr, { target: glslRaw }).code).toBe('sin(a * x)');
    });
  });
});

describe('COMPILE: non-finite numbers on GPU targets', () => {
  // GLSL/WGSL have no infinity or NaN LITERAL — but both can MAKE those values
  // from a bit pattern, which is what the masked (`When`/`Which` else) branch
  // already does. A non-finite CONSTANT is the same value reached by another
  // route, so it goes through the same symbols (`gpuNonFiniteLiteral`) instead
  // of failing the compilation: GLSL through the overridable `_gpu_nan()` /
  // `_gpu_inf()` preamble helpers, WGSL through an inline `bitcast`.
  const NAN_CODE = {
    glsl: '_gpu_nan()',
    wgsl: 'bitcast<f32>(0x7fc00000u)',
  } as const;
  const INF_CODE = {
    glsl: '_gpu_inf()',
    wgsl: 'bitcast<f32>(0x7f800000u)',
  } as const;

  for (const target of ['glsl', 'wgsl'] as const) {
    describe(target, () => {
      it('emits +∞ as a bit pattern, never a `1.0 / 0.0` a driver may fold', () => {
        const ce = new ComputeEngine();
        const t = ce._getCompilationTarget(target)!;
        const r = t.compile(ce.parse('x + \\infty'));
        expect(r.code).toBe(`x + ${INF_CODE[target]}`);
        expect(r.code).not.toContain('/ 0.0');
      });

      it('emits −∞ as the negation of the same symbol', () => {
        const ce = new ComputeEngine();
        const t = ce._getCompilationTarget(target)!;
        expect(t.compile(ce.parse('x - \\infty')).code).toBe(
          `x + (-${INF_CODE[target]})`
        );
      });

      it('emits NaN through the same mechanism as a masked branch', () => {
        const ce = new ComputeEngine();
        const t = ce._getCompilationTarget(target)!;
        expect(t.compile(ce.box('NaN')).code).toBe(NAN_CODE[target]);
      });

      it('the free compile() reports success:true', () => {
        const ce = new ComputeEngine();
        const r = compile(ce.parse('x + \\infty'), { to: target });
        expect(r.success).toBe(true);
      });
    });
  }

  it('GLSL declares the `_gpu_inf()` helper in the preamble (host-overridable)', () => {
    const ce = new ComputeEngine();
    const r = ce._getCompilationTarget('glsl')!.compile(ce.parse('x + \\infty'));
    expect(r.preamble ?? '').toContain('float _gpu_inf()');
    expect(r.preamble ?? '').toContain('intBitsToFloat(0x7F800000)');
  });

  it('JavaScript still emits Infinity (a valid global)', () => {
    const ce = new ComputeEngine();
    const code = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('x + \\infty')).code;
    expect(code).toContain('Infinity');
  });
});
