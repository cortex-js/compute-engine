import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('COMPILE Which', () => {
  describe('JavaScript target', () => {
    it('should compile a 2-branch Which with default (True)', () => {
      // Which: if x > 0 then 1, else -1
      const expr = ce.box([
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
      const expr = ce.box([
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
      const expr = ce.box([
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
      const expr = ce.box([
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
      const expr = ce.box([
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
      const expr = ce.box([
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
      const expr = ce.box([
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
      const expr = ce.box([
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
});
