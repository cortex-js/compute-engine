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
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isValueDef } from '../../src/compute-engine/boxed-expression/definition-guards';
import {
  withDeclaredTypeOnly,
  withShieldedValues,
} from '../../src/compute-engine/boxed-expression/constraint-subject';

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
      // A constant point factor multiplies through the point-scaling kernel.
      expect(code).toBe('_IA.scale(_k1, _.x)');
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
    // The JavaScript target binds the compound value once and reads it by
    // name; Python folds it inline, which is where the parenthesization
    // shows.
    const js = ce
      ._getCompilationTarget('javascript')!
      .compile(expr, { constantFold: false });
    expect(js.code).toBe('Math.sin(_val_a * _.x)');
    expect(js.preamble).toContain('const _val_a = 0.5 * Math.PI;');
    expect(
      ce._getCompilationTarget('python')!.compile(expr, { constantFold: false })
        .code
    ).toBe('np.sin((0.5 * np.pi) * x)');
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
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.parse('b x'));
      // Bound once on JavaScript; spliced inline (parenthesized) on Python.
      expect(r.code).toBe('_val_b * _.x');
      expect(r.preamble).toContain('const _val_b = _.c + 1;');
      expect(r.run!({ c: 2, x: 3 })).toBe(9); // (2+1)*3
      expect(
        ce._getCompilationTarget('python')!.compile(ce.parse('b x')).code
      ).toBe('(c + 1) * x');
    });

    it('parenthesizes the compound value under a coefficient and a power', () => {
      const ce = freshEngine();
      const js = ce._getCompilationTarget('javascript')!;
      expect(js.compile(ce.parse('2 b')).run!({ c: 2 })).toBe(6); // 2*(2+1)
      expect(js.compile(ce.parse('b^2')).run!({ c: 2 })).toBe(9); // (2+1)^2
    });

    it('routes the inner free symbol through the vars object (not a bare global)', () => {
      const ce = freshEngine();
      const r = ce
        ._getCompilationTarget('javascript')!
        .compile(ce.parse('b x'));
      const artifact = (r.preamble ?? '') + r.code;
      expect(artifact).toContain('_.c');
      expect(artifact).not.toMatch(/(^|[^.\w])c([^\w]|$)/); // no bare `c`
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
    wgsl: '_gpu_nan()',
  } as const;
  const INF_CODE = {
    glsl: '_gpu_inf()',
    wgsl: '_gpu_inf()',
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
    const r = ce
      ._getCompilationTarget('glsl')!
      .compile(ce.parse('x + \\infty'));
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

/**
 * A `vars`-mapped input reached THROUGH an assigned value or a user-function
 * body (Tycho item 328, 2026-09-28).
 *
 * The compile-time folder evaluates a subtree through the engine, and the
 * engine reads every assigned value it reaches. With `a := sin(y_0)` and
 * `y_0` a mapped input that also holds a value, `cos(a)` mentions no mapped
 * name itself, so the folder used to bake `y_0`'s current value into the
 * code — the input existed in the argument bag but changing it changed
 * nothing (a slider-dependent document definition drew outdated geometry).
 * The guard is now transitive (`BaseCompiler.reachesExcludedName`): the value
 * is compiled as code that reads the input, on every target.
 */
describe('COMPILE: a mapped input reached through an assigned value (item 328)', () => {
  // `y_0` holds a value AND is mapped: the shape that folded. A valueless
  // `y_0` never folded, because the engine could not evaluate `sin(y_0)`.
  function engine() {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('y_0', 'real');
    ce.assign('y_0', ce.box(0.5));
    ce.assign('a', ce.parse('\\sin(y_0)'));
    ce.assign('c', ce.parse('2a'));
    ce.declare('u', '(real) -> real');
    ce.assign('u', ce.parse('L \\mapsto 2L - a'));
    return ce;
  }
  const vars = { y_0: '_.y_0' };

  it('control: with no mapping, the value-dependent subtree still folds', () => {
    const ce = engine();
    const code = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('\\cos(a)')).code;
    expect(code).toBe(String(Math.cos(Math.sin(0.5))));
  });

  it('JavaScript: the value is bound as code reading the input, at the top level and in a function body', () => {
    const ce = engine();
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('\\cos(a) + u(y_0)'), { vars });
    expect(r.preamble).toContain('const _val_a = Math.sin(_.y_0)');
    expect(r.preamble).toContain('const _fn_u = (L) => 2 * L + -_val_a');
    expect(r.code).toContain('Math.cos(_val_a)');
    expect(r.freeSymbols).toEqual(['y_0']);
    const f = (y: number) => Math.cos(Math.sin(y)) + 2 * y - Math.sin(y);
    expect(r.run!({ y_0: 0.5 })).toBeCloseTo(f(0.5), 12);
    expect(r.run!({ y_0: 1 })).toBeCloseTo(f(1), 12);
  });

  it('JavaScript: a call with a constant argument is not folded when the body reads such a value', () => {
    const ce = engine();
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('u(1)'), { vars });
    expect(r.code).toBe('_fn_u(1)');
    expect(r.preamble).toContain('Math.sin(_.y_0)');
    expect(r.run!({ y_0: 0.5 })).toBeCloseTo(2 - Math.sin(0.5), 12);
    expect(r.run!({ y_0: 1 })).toBeCloseTo(2 - Math.sin(1), 12);
  });

  it('JavaScript: the dependency is followed through a chain of values', () => {
    const ce = engine();
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('c + y_0'), { vars });
    expect(r.preamble).toContain('const _val_a = Math.sin(_.y_0)');
    expect(r.preamble).toContain('const _val_c = 2 * _val_a');
    expect(r.run!({ y_0: 1 })).toBeCloseTo(2 * Math.sin(1) + 1, 12);
  });

  it('JavaScript: a definite integral over such a value reads the input at run time', () => {
    // `y_0` is declared, so the compilation hides its value: `a`'s value
    // `sin(y_0)` is symbolic there, and the closed form `sin(y_0)/2` reads the
    // input instead of baking 0.5.
    const ce = engine();
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('\\int_0^1 a x\\,dx'), { vars });
    expect(r.code).not.toContain('_SYS.integrate');
    expect((r.preamble ?? '') + r.code).toContain('Math.sin(_.y_0)');
    expect(r.run!({ y_0: 0.5 })).toBeCloseTo(Math.sin(0.5) / 2, 8);
    expect(r.run!({ y_0: 1 })).toBeCloseTo(Math.sin(1) / 2, 8);
  });

  it('JavaScript: a run-time integral over such a value reads the input too', () => {
    // `e^{sin x}` has no closed form, so this stays a quadrature.
    const ce = engine();
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('\\int_0^1 a e^{\\sin x}\\,dx'), { vars });
    expect(r.code).toContain('_SYS.integrate(');
    expect(r.preamble).toContain('Math.sin(_.y_0)');
    const integral = new ComputeEngine()
      .parse('\\int_0^1 e^{\\sin x}\\,dx')
      .N().re;
    expect(r.run!({ y_0: 0.5 })).toBeCloseTo(Math.sin(0.5) * integral, 8);
    expect(r.run!({ y_0: 1 })).toBeCloseTo(Math.sin(1) * integral, 8);
  });

  it('GLSL: the value is emitted inline as code reading the uniform', () => {
    const ce = engine();
    const r = ce
      ._getCompilationTarget('glsl')!
      .compile(ce.parse('\\cos(a) + u(y_0)'), { vars: { y_0: 'u_y0' } });
    expect(r.code).toBe('cos(sin(u_y0)) + _fn_u(u_y0)');
    expect(r.preamble).toContain('return 2.0 * L + -sin(u_y0);');
  });

  it('interval-js: unchanged — it never folded through the value', () => {
    const ce = engine();
    const r = ce
      ._getCompilationTarget('interval-js')!
      .compile(ce.parse('\\cos(a) + u(y_0)'), { vars });
    expect(r.preamble).toContain('const _val_a = _IA.sin(_.y_0)');
    expect(r.code).toBe('_IA.add(_IA.cos(_val_a), _fn_u(_.y_0))');
  });

  it('a caller-overridden function reached through a value runs the caller’s code', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('g', '(real) -> real');
    ce.assign('g', ce.parse('t \\mapsto t^2'));
    ce.assign('q', ce.parse('g(3)'));
    expect(ce.parse('q + 1').evaluate().re).toBe(10);
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('q + 1'), { functions: { g: '((t) => 100)' } });
    // Folding `q` would evaluate the engine's `g` (10), bypassing the
    // caller's implementation the `functions` option promises to run.
    expect(r.run!({})).toBe(101);
  });

  it('the mapped name itself is read inside a called function body on every target (the item as filed)', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('y_0', 'real');
    ce.declare('a', 'real');
    ce.assign('a', ce.box(0.7));
    ce.declare('u', '(real) -> real');
    ce.assign('u', ce.parse('L \\mapsto 2L - a'));
    const expr = ce.parse('\\cos(a) + u(y_0)');
    const js = ce
      ._getCompilationTarget('javascript')!
      .compile(expr, { vars: { a: '_.a' } });
    expect(js.preamble).toContain('const _fn_u = (L) => 2 * L + -_.a');
    expect(js.freeSymbols).toEqual(['a', 'y_0']);
    expect(js.run!({ a: 0.1, y_0: 0.2 })).toBeCloseTo(
      Math.cos(0.1) + 0.4 - 0.1,
      12
    );
    const glsl = ce
      ._getCompilationTarget('glsl')!
      .compile(expr, { vars: { a: 'u_a' } });
    expect(glsl.code).toBe('cos(u_a) + _fn_u(y_0)');
    expect(glsl.preamble).toContain('return 2.0 * L + -u_a;');
    const ia = ce
      ._getCompilationTarget('interval-js')!
      .compile(expr, { vars: { a: '_.a' } });
    expect(ia.preamble).toContain('_IA.sub(_IA.scale(_k1, L), _.a)');
  });
});

describe('COMPILE: a mapped input reached through a multi-clause function body', () => {
  it('walks every clause body: the call is not folded and the input is reported', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('y_0', 'real');
    ce.assign('y_0', ce.box(0.5));
    ce.assign('a', ce.parse('\\sin(y_0)'));
    executeEpsil(
      ce,
      'function w(x: number) { x - a }\nfunction w(x: number, y: number) { x + y }'
    );
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.box(['w', 1]), { vars: { y_0: '_.y_0' } });
    expect(r.code).toBe('_fn_w(1)');
    expect(r.preamble).toContain('const _val_a = Math.sin(_.y_0)');
    // The reference analysis had no notion of a clause set, so `y_0`, read
    // only through a clause body, was missing from `freeSymbols`.
    expect(r.freeSymbols).toEqual(['y_0']);
    expect(r.run!({ y_0: 0.5 })).toBeCloseTo(1 - Math.sin(0.5), 12);
    expect(r.run!({ y_0: 1 })).toBeCloseTo(1 - Math.sin(1), 12);
  });
});

/**
 * A `vars`-mapped symbol with a DECLARED type compiles as the valueless input
 * of that type, even when it holds a value (Tycho row 354, 2026-10-01).
 *
 * The compiled code reads the input, never the engine value, but every
 * analysis the compiler ran on the expression used to see the value: with
 * `a: real` and `a := 4`, `√a` saw a non-negative operand and compiled to the
 * real-only `Math.sqrt(_.a)`, which gives `NaN` when the input goes negative.
 * The target's `compile()` now hides the value for the compilation
 * (`withVarsValuesHidden`, `compilation/vars-inputs.ts`), so the output is the
 * same as for the symbol declared with no value. The value is restored
 * afterwards, also when the compilation throws.
 */
describe('COMPILE: a declared vars-mapped input compiles as if it had no value (row 354)', () => {
  function engine(withValue: boolean) {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('a', 'real');
    ce.declare('n', 'real');
    ce.declare('x', 'real');
    if (withValue) {
      ce.assign('a', 4);
      ce.assign('n', 2);
    }
    return ce;
  }
  const vars = { a: '_.a', n: '_.n' };

  it('JavaScript: √a keeps the complex lane of a real input', () => {
    const ce = engine(true);
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('\\sqrt{a}'), { vars });
    expect(r.code).toBe('_SYS.csqrt(({ re: _.a, im: 0 }))');
    expect(r.run!({ a: -4 })).toEqual({ re: 0, im: 2 });
    expect(r.run!({ a: 4 })).toBe(2);
    // The value is back, with the facts it implies.
    expect(ce.symbol('a').value?.re).toBe(4);
    expect(ce.symbol('a').isPositive).toBe(true);
  });

  const sources = [
    '\\sqrt{a}',
    '\\lfloor n\\rfloor + x',
    '\\ln(a) + x',
    '\\int_0^x a t\\,dt',
    'a^{1/2} + n x',
  ];
  for (const to of ['javascript', 'python', 'glsl', 'wgsl', 'interval-js']) {
    it(`${to}: the output is the same with and without the held value`, () => {
      for (const src of sources) {
        const emit = (withValue: boolean) => {
          const ce = engine(withValue);
          const target = ce._getCompilationTarget(to)!;
          try {
            return target.compile(ce.parse(src), { vars }).code;
          } catch (e) {
            return `DECLINED ${(e as Error).message}`;
          }
        };
        expect([src, emit(true)]).toEqual([src, emit(false)]);
      }
    });
  }

  it('the standalone compile() and a direct custom target see no value', () => {
    const ce = engine(true);
    const expr = ce.parse('\\sqrt{a}');
    expect(compile(expr, { vars }).code).toBe(
      '_SYS.csqrt(({ re: _.a, im: 0 }))'
    );
    // A direct target resolves symbols with its own `var` hook, which knows
    // nothing of `vars`: the symbol is emitted by name. The held value used to
    // be folded into the code (`2`).
    const target = ce._getCompilationTarget('javascript')!.createTarget();
    const direct = compile(expr, { target, vars, fallback: false } as never);
    expect(direct.code).toBe('Math.sqrt(a)');
    expect(ce.symbol('a').value?.re).toBe(4);
  });

  it('an undeclared mapped symbol is not folded on a direct custom target', () => {
    // `u := 4` with no declaration keeps its value during the compilation,
    // but a `vars` key is a live input: the symbol read must not fold it.
    // The keys are stamped on the caller's target for this call only: the
    // previous value (here, none) is restored when the call ends.
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('u', 4);
    const target = ce._getCompilationTarget('javascript')!.createTarget();
    const expr = ce.parse('\\sqrt{u} + 1');
    const direct = compile(expr, {
      target,
      vars: { u: '_.u' },
      fallback: false,
    } as never);
    expect(direct.code).toBe('Math.sqrt(u) + 1');
    expect(target.varsKeys).toBeUndefined();
    // Without `vars`, the value is folded, as before.
    expect(compile(expr, { target, fallback: false } as never).code).toBe('3');
  });

  it('a class-instance direct target keeps its prototype methods with `vars`', () => {
    // The `var` hook is a method on the class prototype and writes to `this`.
    // The target is not copied for the call: a copy made with object spread
    // would lose the method, and the symbol would be emitted by name.
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('u', 4);
    const inner = ce._getCompilationTarget('javascript')!.createTarget();
    const previousKeys = new Set<string>();
    class ClassTarget {
      reads: string[] = [];
      constructor() {
        for (const [k, v] of Object.entries(inner))
          if (k !== 'var') (this as Record<string, unknown>)[k] = v;
      }
      var(id: string): string | undefined {
        this.reads.push(id);
        return id === 'u' ? 'input.u' : inner.var?.(id);
      }
    }
    const target = new ClassTarget() as ClassTarget & {
      varsKeys?: ReadonlySet<string>;
    };
    target.varsKeys = previousKeys;
    const direct = compile(ce.parse('\\sqrt{u} + 1'), {
      target,
      vars: { u: '_.u' },
      fallback: false,
    } as never);
    expect(direct.code).toBe('Math.sqrt(input.u) + 1');
    expect(target.reads).toContain('u');
    // The caller's previous `varsKeys` is restored after the call.
    expect(target.varsKeys).toBe(previousKeys);
  });

  it('JavaScript: an integral over a mapped input keeps its closed form (row 355)', () => {
    const ce = engine(true);
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('\\int_0^x a t\\,dt'), { vars });
    expect(r.code).toBe('(0.5 * _.a * (_.x * _.x))');
    expect(r.run!({ a: -2, x: 3 })).toBeCloseTo(-9, 12);
  });

  it('a value put in force by an assumption is hidden too', () => {
    // `assume(a = 4)` puts the value in force without storing it, and its
    // fact types `a` as an integer: `⌊a⌋ + x` compiled to `_.x + _.a`.
    const emit = (to: string, assumed: boolean) => {
      const ce = new ComputeEngine();
      ce.pushScope();
      ce.declare('a', 'real');
      ce.declare('x', 'real');
      if (assumed) ce.assume(ce.parse('a = 4'));
      const code = ce
        ._getCompilationTarget(to)!
        .compile(ce.parse('\\lfloor a\\rfloor + \\sqrt{a} + x'), {
          vars: { a: to === 'glsl' ? 'u_a' : '_.a' },
        }).code;
      if (assumed) expect(ce.symbol('a').value?.re).toBe(4);
      return code;
    };
    expect(emit('javascript', true)).toBe(emit('javascript', false));
    expect(emit('javascript', true)).toContain('Math.floor(_.a)');
    expect(emit('glsl', true)).toBe(emit('glsl', false));
    expect(emit('glsl', true)).toContain('floor(u_a)');
  });

  it('only the compile marker drops the facts from the type, not the assume() shield', () => {
    // `assume()` hides the values of the names it records a fact about
    // (`withShieldedValues`), including a value an assumption put in force.
    // While it does so, the facts must still type the symbol. Only the marker
    // a compilation sets on a `vars`-mapped input (`withDeclaredTypeOnly`)
    // gives the declared type.
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assume(ce.parse('a = 4'));
    const def = ce.lookupDefinition('a')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    const defs = new Set([def.value]);
    expect(ce.symbol('a').type.toString()).toBe('integer');
    expect(withShieldedValues(defs, () => def.value.type.toString())).toBe(
      'integer'
    );
    expect(withDeclaredTypeOnly(defs, () => def.value.type.toString())).toBe(
      'real'
    );
    expect(ce.symbol('a').type.toString()).toBe('integer');
  });

  it('the value is restored when the compilation throws', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('in', 'real');
    ce.assign('in', 0.5);
    expect(() =>
      ce
        ._getCompilationTarget('glsl')!
        .compile(ce.parse('x + \\sin(\\mathrm{in})'), { vars: { in: 'in' } })
    ).toThrow(/reserved word/);
    expect(ce.symbol('in').value?.re).toBe(0.5);
  });

  it('a symbol whose type was inferred from its value keeps the value (current behavior)', () => {
    // `ce.assign('u', 4)` with no declaration types `u` from the value
    // (`integer`). Such a symbol is not hidden: a valueless inferred binding
    // could be narrowed by a use inside the compilation, and that write would
    // outlive it.
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('u', 4);
    const r = ce
      ._getCompilationTarget('javascript')!
      .compile(ce.parse('\\sqrt{u}'), { vars: { u: '_.u' } });
    expect(r.code).toBe('Math.sqrt(_.u)');
  });
});
