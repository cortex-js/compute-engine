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
    it('should compile Which to interval-js with piecewise', () => {
      const expr = ce.expr([
        'Which',
        ['Greater', 'x', 0],
        1,
        'True',
        -1,
      ]);
      const result = compile(expr, { to: 'interval-js' })!;
      expect(result.success).toBe(true);
      expect(result.code).toContain('_IA.piecewise');

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

    it('should compile multi-branch Which to nested piecewise', () => {
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
      // Should contain nested piecewise calls
      const piecewiseCount = (result.code.match(/_IA\.piecewise/g) || [])
        .length;
      expect(piecewiseCount).toBe(2); // Two conditions, one default
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
      expect(result.code).toContain('_IA.piecewise');
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
      // `_SYS.cond` guard; what it needs is the operand test, because a NaN
      // or absent operand makes the comparison answer an ordinary `false`.
      // `2r` is `real`-typed and the type says it is never NaN, but that
      // promise does not survive an absent `r`: `2 * undefined` IS NaN.
      // The operand is not a bare name, so it is bound to a temporary: the
      // condition and the operand test would otherwise compute the product
      // three times per call.
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
        '((_tv1) => ((_tv1 === _tv1) ? ((0 < _tv1) ? (1) : (-1)) : NaN))(2 * _.r)'
      );
      expect(result.run!({ r: 5 })).toBe(1);
      expect(result.run!({ r: -3 })).toBe(-1);
      expect(result.run!({} as any)).toBeNaN();
    });
  });
});
