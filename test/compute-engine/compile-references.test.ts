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
      ce.assign(
        'f',
        ce.box(['Function', ['Map', 'h', ['List', 1, 2, 3]], 'h'])
      );
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
  // A symbol the TARGET bakes into the emitted code is not an input the caller
  // has to supply. Most constants never reach the free-symbol branch — the
  // engine holds a value for `Pi` and friends, so they are folded first — but
  // the boolean literals have no engine value and did reach it, so
  // `Which(x > 0, 1, True, 2)` reported a phantom input named `True`.
  // Consumers derive a compiled function's variable list from `freeSymbols`
  // (this is how a plot picks its variables), and `True` is the idiomatic
  // `Which` fallback condition, so an ordinary piecewise grew a phantom
  // variable.
  //
  // The lookup behind this is `CompileTarget.constant`, deliberately distinct
  // from `var`: `var` falls back to a vars-object reference for any symbol it
  // does not recognize, so consulting it here would suppress EVERY free
  // symbol.
  describe('a constant the target inlines is not a free symbol', () => {
    const booleanShapes: [string, unknown][] = [
      ['bare', 'True'],
      [
        'Which fallback condition',
        ['Which', ['Greater', 'x', 0], 1, 'True', 2],
      ],
      ['conjunct', ['And', ['Greater', 'x', 0], 'True']],
      [
        'mask element',
        ['At', ['List', 10, 20, 30], ['List', 'False', 'True', 'True']],
      ],
    ];

    // Every target spells the boolean literals — `true` in JavaScript and both
    // shader languages, `True` in Python, and the `BoolInterval` string
    // `'true'` on the interval target — so none of them reports one as an
    // input. Before this, GLSL/WGSL emitted the undeclared identifier `True`
    // (a shader that fails to compile behind `success: true`) and the interval
    // target emitted a dangling `_.True` vars-object lookup that threw at run
    // time.
    for (const to of ['javascript', 'python', 'glsl', 'wgsl', 'interval-js']) {
      for (const [label, expr] of booleanShapes) {
        it(`${to}: ${label}`, () => {
          const ce = new ComputeEngine();
          const r = compile(ce.box(expr as never), { to: to as never });
          expect(r.freeSymbols ?? []).not.toContain('True');
          expect(r.freeSymbols ?? []).not.toContain('False');
        });
      }
    }

    it("emits each language's own spelling of the literal", () => {
      const ce = new ComputeEngine();
      const src = (to: string) =>
        String(compile(ce.box('True'), { to: to as never }).code ?? '');
      expect(src('javascript')).toBe('true');
      expect(src('python')).toBe('True');
      expect(src('glsl')).toBe('true');
      expect(src('wgsl')).toBe('true');
      // The interval target's boolean domain is `BoolInterval`
      // (`'true' | 'false' | 'maybe'`), so the value is the STRING.
      expect(src('interval-js')).toBe("'true'");
    });

    // The guard must key on what the TARGET inlines, not on whether the ENGINE
    // calls the symbol constant: a constant declared with no value is still an
    // input the caller must supply, because the emitted code references it.
    it('still reports a valueless declared constant', () => {
      const ce = new ComputeEngine();
      ce.declare('c', { type: 'real', isConstant: true });
      expect(compile(ce.parse('c + 1')).freeSymbols).toContain('c');
    });

    it('leaves ordinary free symbols alone', () => {
      const ce = new ComputeEngine();
      expect(compile(ce.parse('x + y')).freeSymbols!.sort()).toEqual([
        'x',
        'y',
      ]);
      // `Pi` has an engine value, so it is folded rather than filtered here.
      expect(compile(ce.parse('\\pi x')).freeSymbols).toEqual(['x']);
    });
  });
});

describe('the reference analysis probes a caller compile handler without compiling its operands', () => {
  // A caller-mapped head (Tycho overrides `At`) is probed by
  // `analyzeReferences` to learn whether the handler claims the shape. The
  // probe used to hand the handler the real operand compiler, so every
  // operand of every such node was compiled twice — once for the probe,
  // once for the emission — and a folded value holding thousands of nested
  // `At` reads ran the process out of memory. The probe now hands the
  // handler a placeholder compiler.
  test('the handler sees the real operand code exactly once per node', () => {
    const ce = new ComputeEngine();
    // `Which` is a head the analysis probes on the JavaScript target (`At`
    // is not: the target maps it, so its handler is consulted by the compile
    // path alone).
    const def = ce.lookupDefinition('Which') as any;
    const saved = def.operator.compile;
    const realConditionCodes: string[] = [];
    def.operator.compile = (
      args: any[],
      compile: (e: any) => string,
      context: { language: string }
    ) => {
      if (context.language !== 'javascript') return undefined;
      const condition = compile(args[0]);
      if (condition !== '0') realConditionCodes.push(condition);
      return `((${condition})?(${compile(args[1])}):(${compile(args[3])}))`;
    };
    try {
      const r = compile(
        ce.box([
          'Add',
          ['Which', ['Greater', 'x', 0], 1, 'True', 2],
          ['Which', ['Greater', 'y', 0], 3, 'True', 4],
        ]),
        { to: 'javascript' }
      );
      expect(r.success).toBe(true);
      expect(r.code).toContain('?(');
      // Two `Which` nodes, two real compiles of their conditions — not four.
      expect(realConditionCodes).toHaveLength(2);
      expect(r.freeSymbols!.sort()).toEqual(['x', 'y']);
      expect(r.unsupported ?? []).toEqual([]);
    } finally {
      def.operator.compile = saved;
    }
  });

  // A value can be a DAG: the same sub-expression object as an operand of
  // many parents. A caller that substitutes helper bodies into a published
  // value builds one (Tycho's terrain height map: 236,663 distinct nodes,
  // 2.5e10 as a tree). The analysis must walk each node once per binding
  // frame, or the walk expands the DAG as a tree and never finishes.
  test('a shared-node value is walked once per node, not once per path', () => {
    const ce = new ComputeEngine();
    // A caller's handler may read an operand's MathJSON, which serializes
    // the shared value as a tree. The compile never reaches a node of a
    // value it refuses to bake in, so the analysis must not run the handler
    // on one either.
    const def = ce.lookupDefinition('Which') as any;
    const saved = def.operator.compile;
    let serialized = 0;
    def.operator.compile = (
      args: any[],
      compile: (e: any) => string,
      context: { language: string }
    ) => {
      if (context.language !== 'javascript') return undefined;
      // Tycho's `Which` handler does this on its conditions.
      void args[0].json;
      serialized++;
      return `((${compile(args[0])})?(${compile(args[1])}):(${compile(args[3])}))`;
    };
    try {
      // 36 levels of `Sin(p) + {p > 0: p, 1}` over the same `p`: about 2^37
      // nodes as a tree, 5 distinct nodes per level. Walked as a tree this
      // never returns, and one `.json` of the top level never finishes
      // either.
      let node = ce.box(['Multiply', 'x', 2]);
      for (let i = 0; i < 36; i++)
        node = ce.function('Add', [
          ce.function('Sin', [node]),
          ce.function('Which', [
            ce.function('Greater', [node, 0]),
            node,
            ce.True,
            1,
          ]),
        ]);
      ce.assign('H', node);
      const r = compile(ce.parse('H + 1'), { to: 'javascript' });
      // The fold-size guard refuses to bake the value in (its text would be
      // exponential); the reference analysis still reports what it reads.
      expect(r.success).toBe(false);
      expect(r.error).toContain('above the fold-size limit');
      expect(r.freeSymbols).toEqual(['x']);
      // The handler is probed with operands it cannot read; it reads one and
      // is taken as claiming the shape.
      expect(r.unsupported ?? []).toEqual([]);
      expect(serialized).toBe(0);
    } finally {
      def.operator.compile = saved;
    }
  });

  test('inside an oversized value, a handler that declines on the language is honored', () => {
    const ce = new ComputeEngine();
    // Only a handler lowers this head, and only on JavaScript (`Which` is
    // lowered by the glsl target itself, so it cannot witness this).
    ce.declare('Clamp01', {
      signature: '(number) -> number',
      compile: (args, c, { language }) =>
        language === 'javascript'
          ? `Math.min(1, Math.max(0, ${c(args[0])}))`
          : undefined,
    });
    let node = ce.box(['Multiply', 'x', 2]);
    for (let i = 0; i < 36; i++)
      node = ce.function('Add', [
        ce.function('Sin', [node]),
        ce.function('Clamp01', [node]),
      ]);
    ce.assign('H', node);
    const js = compile(ce.parse('H + 1'), { to: 'javascript' });
    expect(js.success).toBe(false);
    expect(js.error).toContain('above the fold-size limit');
    expect(js.unsupported ?? []).toEqual([]);
    const g = compile(ce.parse('H + 1'), { to: 'glsl' });
    expect(g.success).toBe(false);
    expect(g.unsupported).toEqual(['Clamp01']);
  });

  // A handler may compile a SYNTHESIZED expression rather than its operands:
  // the derivative handler compiles the closed form it computed and declines
  // when the target cannot lower it. The probe must compile such an
  // expression for real, or the decline never reaches the report.
  test('a handler that compiles a synthesized expression still declines', () => {
    const ce = new ComputeEngine();
    // `d/dx Γ(x) = Γ(x)ψ(x)`: a closed form, but glsl has no `Digamma`.
    const expr = ce.box(['D', ['Gamma', 'x'], 'x']);
    const js = compile(expr, { to: 'javascript' });
    expect(js.success).toBe(true);
    expect(js.unsupported ?? []).toEqual([]);
    const g = compile(expr, { to: 'glsl' });
    expect(g.success).toBe(false);
    expect(g.unsupported).toEqual(['D']);
  });
});
