import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('COMPILE Which', () => {
  describe('JavaScript target', () => {
    it('should compile a 2-branch Which with default (True)', () => {
      // Which: if x > 0 then 1, else -1
      const expr = ce.expr([
        'Which',
        ['Greater', 'x', 0],
        1,
        'True',
        -1,
      ]);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 5 })).toBe(1);
      expect(result.run!({ x: -3 })).toBe(-1);
    });

    it('should compile a 3-branch Which with default', () => {
      // Which: if x < 0 then -1, if x == 0 then 0, else 1
      const expr = ce.expr([
        'Which',
        ['Less', 'x', 0],
        -1,
        ['Equal', 'x', 0],
        0,
        'True',
        1,
      ]);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: -2 })).toBe(-1);
      expect(result.run!({ x: 0 })).toBe(0);
      expect(result.run!({ x: 5 })).toBe(1);
    });

    it('should return NaN when no branch matches and no default', () => {
      // Which: if x > 0 then 1, if x < 0 then -1
      // (no default, so x=0 should give NaN)
      const expr = ce.expr([
        'Which',
        ['Greater', 'x', 0],
        1,
        ['Less', 'x', 0],
        -1,
      ]);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 5 })).toBe(1);
      expect(result.run!({ x: -3 })).toBe(-1);
      expect(result.run!({ x: 0 })).toBeNaN();
    });

    it('should compile Which nested in an expression', () => {
      // abs(x) + 1 = Which(x > 0, x, True, -x) + 1
      const expr = ce.expr([
        'Add',
        ['Which', ['Greater', 'x', 0], 'x', 'True', ['Negate', 'x']],
        1,
      ]);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 3 })).toBe(4); // 3 + 1
      expect(result.run!({ x: -5 })).toBe(6); // 5 + 1
    });

    it('should compile Which from parsed LaTeX cases', () => {
      // \begin{cases} x^2 & x \geq 0 \\ -x & \text{otherwise} \end{cases}
      const expr = ce.parse(
        '\\begin{cases} x^2 & x \\geq 0 \\\\ -x & \\text{otherwise} \\end{cases}'
      );
      expect(expr.operator).toBe('Which');
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 3 })).toBe(9); // 3^2
      expect(result.run!({ x: -4 })).toBe(4); // -(-4)
      expect(result.run!({ x: 0 })).toBe(0); // 0^2
    });

    it('should generate chained ternary code', () => {
      const expr = ce.expr([
        'Which',
        ['Greater', 'x', 0],
        1,
        'True',
        -1,
      ]);
      const result = compile(expr)!;
      expect(result.code).toContain('?');
      expect(result.code).toContain(':');
    });
  });

  describe('Interval JavaScript target', () => {
    it('should compile Which to a closure-free interval conditional', () => {
      const expr = ce.expr([
        'Which',
        ['Greater', 'x', 0],
        1,
        'True',
        -1,
      ]);
      const result = compile(expr, { to: 'interval-js' })!;
      expect(result.success).toBe(true);
      expect(result.code).toContain("=== 'true' ?");
      expect(result.code).not.toContain('() =>');

      // Test execution with point intervals
      // piecewise returns IntervalResult: {kind: 'interval', value: {lo, hi}}
      const positiveResult = result.run!({ x: 5 }) as any;
      const posVal = positiveResult.kind === 'interval' ? positiveResult.value : positiveResult;
      expect(posVal.lo).toBe(1);
      expect(posVal.hi).toBe(1);

      const negativeResult = result.run!({ x: -3 }) as any;
      const negVal = negativeResult.kind === 'interval' ? negativeResult.value : negativeResult;
      expect(negVal.lo).toBe(-1);
      expect(negVal.hi).toBe(-1);
    });

    it('should compile multi-branch Which to nested conditionals', () => {
      const expr = ce.expr([
        'Which',
        ['Less', 'x', 0],
        -1,
        ['Equal', 'x', 0],
        0,
        'True',
        1,
      ]);
      const result = compile(expr, { to: 'interval-js' })!;
      expect(result.success).toBe(true);
      // One nested conditional per condition, each with its own tri-state
      // temporary. The temporaries are counted rather than the occurrences:
      // the lowering writes each arm twice — once in the branch that selects
      // it, once in the hull an undecided condition takes — so the inner
      // conditional's text appears twice inside the outer one.
      const conditionals = new Set(result.code.match(/_tv\d+ =/g) ?? []);
      expect(conditionals.size).toBe(2); // Two conditions, one default
    });

    it('should compile Which nested inside Add', () => {
      // Which(x > 0, x, True, -x) + 1
      const expr = ce.expr([
        'Add',
        ['Which', ['Greater', 'x', 0], 'x', 'True', ['Negate', 'x']],
        1,
      ]);
      const result = compile(expr, { to: 'interval-js' })!;
      expect(result.success).toBe(true);
      expect(result.code).toContain("=== 'true' ?");
      expect(result.code).toContain('_IA.add');

      // x=3 → 3 + 1 = 4
      const positiveResult = result.run!({ x: 3 }) as any;
      const posVal = positiveResult.kind === 'interval' ? positiveResult.value : positiveResult;
      expect(posVal.lo).toBeCloseTo(4, 10);
      expect(posVal.hi).toBeCloseTo(4, 10);

      // x=-5 → 5 + 1 = 6
      const negativeResult = result.run!({ x: -5 }) as any;
      const negVal = negativeResult.kind === 'interval' ? negativeResult.value : negativeResult;
      expect(negVal.lo).toBeCloseTo(6, 10);
      expect(negVal.hi).toBeCloseTo(6, 10);
    });
  });

  // CO-P2-24: a condition that is not exactly `true` or `false` must never take
  // the default branch. A compiled ternary used to treat it as falsy and
  // return 9. Two later rulings settled the shape of the answer, and a
  // condition now meets whichever of them applies first:
  //
  //  - a condition whose static TYPE proves it is not a boolean (`x / y` is a
  //    number) is an `incompatible-type` error operand at boxing, so the whole
  //    `Which` is invalid and never compiles (ruling 2026-09-02, restoring the
  //    diagnostic the 2026-08-31 inertness ruling removed);
  //  - a condition the type admits but the run-time VALUE leaves undecided
  //    takes no branch and answers NaN (ruling 2026-09-02). The interpreter
  //    holds such a `Which` unevaluated, so neither lane answers the default
  //    arm (D6).
  describe('a condition that is not True or False never takes a branch', () => {
    it('a provably non-boolean condition is rejected at boxing', () => {
      // The condition x/y is numeric, so it can never select a clause.
      const expr = ce.expr(['Which', ['Divide', 'x', 'y'], 5, 'True', 9]);
      expect(expr.isValid).toBe(false);
      expect(expr.toString()).toContain('incompatible-type');
      // The interpreter does not answer the default arm either.
      expect(
        ce.box(['Which', ['Divide', 0, 0], 5, 'True', 9]).N().operator
      ).not.toBe('Number');
    });

    it('a boolean-typed condition that is undecided at run time answers NaN', () => {
      // `b` is declared `boolean`, so the boxing check passes; the VALUE the
      // caller supplies still need not be a boolean, and an unsupplied one is
      // `undefined`.
      const engine = new ComputeEngine();
      engine.declare('b', 'boolean');
      const expr = engine.expr(['Which', 'b', 5, 'True', 9]);
      const result = compile(expr, { fallback: false })!;
      expect(result.success).toBe(true);
      expect(result.run!({ b: true })).toBe(5);
      expect(result.run!({ b: false })).toBe(9);
      expect(result.run!({} as any)).toBeNaN();
      expect(result.run!({ b: 'a' } as any)).toBeNaN();
    });

    it('needs no `_SYS.cond` guard, and answers NaN for an unsupplied operand', () => {
      // A relation is boolean-valued, so it never needed the throwing
      // `_SYS.cond` guard; what it needs is the operand test, because an
      // absent operand makes the comparison answer an ordinary `false`.
      // `2r` is `real`-typed and the type says it is never NaN, but that
      // promise does not survive an absent `r`: `2 * undefined` IS NaN.
      // A NaN operand decides the comparison `false` (user decision
      // 2026-10-20), so the test is on the variable the operand reads,
      // `_.r !== undefined`, and the product is computed once, in the
      // comparison. Before the decision the product was bound to a temporary
      // and tested for NaN.
      const engine = new ComputeEngine();
      engine.declare('r', 'real');
      const expr = engine.expr([
        'Which',
        ['Greater', ['Multiply', 2, 'r'], 0],
        1,
        'True',
        -1,
      ]);
      const result = compile(expr, { fallback: false })!;
      expect(result.code).not.toContain('_SYS.cond');
      expect(result.code).toBe(
        '((_.r !== undefined) ? ((0 < 2 * _.r) ? (1) : (-1)) : NaN)'
      );
      expect(result.run!({ r: 5 })).toBe(1);
      expect(result.run!({ r: -3 })).toBe(-1);
      expect(result.run!({} as any)).toBeNaN();
      expect(result.run!({ r: NaN })).toBe(-1);
    });

    it('a name bound by a Sum or a parameter is not an input, even when a global of that name holds a value', () => {
      // The operand test lists the variables the condition reads. A `Sum`
      // index named `k` is not a read of the global `k`, so the inputs of
      // the global's value (`m`) are not tested: before, the walk followed
      // the global's value through the bound name, and `m` unsupplied made
      // the branch take no arm (ROADMAP, Tycho row 413, found 2026-10-21).
      const engine = new ComputeEngine();
      engine.declare('m', 'real');
      engine.assign('k', engine.parse('2m'));
      const sum = engine.parse(
        '\\begin{cases} 1 & \\sum_{k=1}^{3} k > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'
      );
      const compiledSum = compile(sum, { fallback: false })!;
      expect(compiledSum.code).not.toContain('_.m');
      expect(compiledSum.run!({} as any)).toBe(1);

      // A parameter of a called function literal named like the global.
      engine.assign('g', engine.parse('k \\mapsto k + 1'));
      const call = engine.parse(
        '\\begin{cases} 1 & g(2) > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'
      );
      const compiledCall = compile(call, { fallback: false })!;
      expect(compiledCall.code).not.toContain('_.m');
      expect(compiledCall.run!({} as any)).toBe(1);

      // A free global read by a called function's body is still an input:
      // the body's block declares its free symbols in its own scope, which
      // must not hide them.
      engine.assign('h', engine.parse('k \\mapsto k + m'));
      const body = engine.parse(
        '\\begin{cases} 1 & h(2) > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'
      );
      const compiledBody = compile(body, { fallback: false })!;
      expect(compiledBody.code).toContain('_.m !== undefined');
      expect(compiledBody.run!({} as any)).toBeNaN();
      expect(compiledBody.run!({ m: 1 })).toBe(1);

      // The variable of `D`, the coefficient of an integral and a free symbol
      // of a `Limit` body are inputs, although each operator scopes a name.
      for (const [latex, name] of [
        ['\\frac{d}{dx} x^2 > 0', 'x'],
        ['\\int_0^1 a t\\,dt > 0', 'a'],
        ['\\lim_{t \\to 0} (q + t) > 0', 'q'],
      ] as const) {
        const scoped = engine.parse(
          '\\begin{cases} 1 & ' + latex + ' \\\\ 0 & \\text{otherwise} \\end{cases}'
        );
        const compiledScoped = compile(scoped, { fallback: false })!;
        expect(compiledScoped.code).toContain('_.' + name + ' !== undefined');
        expect(compiledScoped.run!({} as any)).toBeNaN();
      }

      // A read of the global itself still tests the input of its value.
      const read = engine.parse(
        '\\begin{cases} 1 & k > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'
      );
      const compiledRead = compile(read, { fallback: false })!;
      expect(compiledRead.code).toContain('_.m !== undefined');
      expect(compiledRead.run!({} as any)).toBeNaN();
      expect(compiledRead.run!({ m: 1 })).toBe(1);
    });
  });
});
