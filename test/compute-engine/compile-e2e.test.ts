/**
 * End-to-end tests for real-world mathematical expressions.
 *
 * Each test parses a LaTeX expression, compiles it to JavaScript,
 * and (where applicable) executes the compiled function to verify
 * numeric correctness.
 */

import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('E2E: Real-world Expressions', () => {
  // ── Where clause + tuple (Klein bottle style) ──────────────────────

  describe('Where clause + tuple (Klein bottle style)', () => {
    const latex =
      '(r\\cos(u),\\; r\\sin(u),\\; \\sin(v)) \\text{ where } r \\coloneq 2 + \\cos(v)';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });

    it('run should return an array (tuple)', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      const out = result?.run?.({ u: 0, v: 0 });
      expect(Array.isArray(out)).toBe(true);
    });
  });

  // ── Semicolon block + tuple (Joukowski style) ─────────────────────

  describe('Semicolon block + tuple (Joukowski style)', () => {
    const latex =
      'a \\coloneq \\cos(t); b \\coloneq \\sin(t); s \\coloneq a^2 + b^2; (a + \\frac{a}{s},\\; b - \\frac{b}{s})';

    it('should parse as valid with no Nothing in parse tree', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
      // Ensure no Nothing leaked into the expression
      expect(expr.toString()).not.toContain('Nothing');
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });
  });

  // ── Semicolon block + ;\; spacing (the fixed bug) ─────────────────

  describe('Semicolon block + ;\\; spacing (fixed bug)', () => {
    const latex = 'a \\coloneq x^2;\\; (a+1)';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });

    it('run({x: 3}) should return 10', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.run?.({ x: 3 })).toBe(10);
    });
  });

  // ── Heaviside + where clause ──────────────────────────────────────

  describe('Heaviside + where clause', () => {
    const latex =
      '\\operatorname{Heaviside}(x) \\cdot (1 - \\exp(-x)) \\text{ where } x \\coloneq t - 1';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });
  });

  // ── Fourier-style sum ─────────────────────────────────────────────

  describe('Fourier-style sum', () => {
    const latex =
      '\\frac{4}{\\pi}\\sum_{k=0}^{5} \\frac{\\sin((2k+1)x)}{2k+1}';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });

    it('unknowns should be ["x"] (not ["k", "x"])', () => {
      const expr = ce.parse(latex);
      const unknowns = expr.unknowns;
      expect(unknowns).toContain('x');
      expect(unknowns).not.toContain('k');
    });
  });

  // ── Taylor series for sin(x) with alternating sign ────────────────

  describe('Taylor series for sin(x)', () => {
    const latex =
      '\\sum_{k=0}^{5} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });

    it('run({x: 0}) should be approximately 0', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.run?.({ x: 0 })).toBeCloseTo(0, 10);
    });

    it('run({x: Math.PI/2}) should be approximately 1', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.run?.({ x: Math.PI / 2 })).toBeCloseTo(1, 5);
    });
  });

  // ── Product with variable ─────────────────────────────────────────

  describe('Product with variable', () => {
    const latex = '\\prod_{k=1}^{3} (x - k)';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });

    it('run({x: 2}) should be 0 (since x-2 = 0)', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      // IEEE 754: (2-1)*0*(2-3) = 1*0*(-1) = -0, which equals 0 numerically
      expect(result?.run?.({ x: 2 })).toBeCloseTo(0, 10);
    });
  });

  // ── Cases / piecewise ─────────────────────────────────────────────

  describe('Cases / piecewise', () => {
    const latex =
      '\\begin{cases} x^2 & x \\geq 0 \\\\ -x & \\text{otherwise} \\end{cases}';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });
  });

  // ── If-then-else with \; spacing (the fixed bug) ──────────────────

  describe('If-then-else with \\; spacing (fixed bug)', () => {
    const latex =
      '\\text{if}\\; x \\geq 0 \\;\\text{then}\\; x^2 \\;\\text{else}\\; -x';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });

    it('run({x: 3}) should return 9', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.run?.({ x: 3 })).toBe(9);
    });

    it('run({x: -3}) should return 3', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.run?.({ x: -3 })).toBe(3);
    });
  });

  // ── Simple distance function with where ───────────────────────────

  describe('Simple distance function with where', () => {
    const latex =
      '\\frac{1}{r} \\text{ where } r \\coloneq \\sqrt{x^2 + y^2}';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });
  });

  // ── Vector field with semicolon blocks (Electric dipole style) ────

  describe('Vector field with semicolon blocks (Electric dipole style)', () => {
    const latex =
      'a \\coloneq ((x-1)^2 + y^2 + 0.1)^{1.5}; b \\coloneq ((x+1)^2 + y^2 + 0.1)^{1.5}; (\\frac{x-1}{a} - \\frac{x+1}{b},\\; \\frac{y}{a} - \\frac{y}{b})';

    it('should parse as valid', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
    });

    it('should compile to JS with success:true', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result?.success).toBe(true);
    });

    it('run should return an array (tuple)', () => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      const out = result?.run?.({ x: 0, y: 1 });
      expect(Array.isArray(out)).toBe(true);
    });
  });

  // ── Broadcast over a list operand ──────────────────────────────────

  describe('Broadcastable operator over a list (sin([x, 2x]))', () => {
    // Regression: the generated `.map()` callback read its element variable
    // off the vars object (`_.<temp>` → undefined → [null, null]) instead of
    // the callback parameter.
    it('compiled broadcast agrees with evaluate()', () => {
      const expr = ce.parse('\\sin([x, 2x])');
      const result = compile(expr);
      expect(result?.success).toBe(true);
      const out = result?.run?.({ x: 0.5 }) as unknown as number[];
      expect(out[0]).toBeCloseTo(Math.sin(0.5), 12);
      expect(out[1]).toBeCloseTo(Math.sin(1), 12);
    });
  });

  // Scalar↔list arithmetic broadcasts element-wise over a symbolic list
  // parameter (compiled via the `_SYS.bcast` runtime helper), matching the
  // interpreter. Previously these emitted scalar JS and returned garbage.
  describe('Scalar↔list arithmetic broadcast', () => {
    const list = (t: string) => {
      const e = new ComputeEngine();
      e.declare('L', 'list<number>');
      e.declare('M', 'list<number>');
      e.declare('x', 'number');
      e.declare('y', 'number');
      return compile(e.parse(t));
    };

    it('scalar − list, scalar · list, list^2, −list', () => {
      expect(list('x-L')?.run?.({ x: 1, L: [0, 2, 0] })).toEqual([1, -1, 1]);
      expect(list('2L')?.run?.({ L: [1, 2, 3] })).toEqual([2, 4, 6]);
      expect(list('L^2')?.run?.({ L: [1, 2, 3] })).toEqual([1, 4, 9]);
      expect(list('-L')?.run?.({ L: [1, 2, 3] })).toEqual([-1, -2, -3]);
    });

    it('list + list zips element-wise to the shortest length', () => {
      expect(list('L+M')?.run?.({ L: [1, 2, 3], M: [10, 20, 30] })).toEqual([
        11, 22, 33,
      ]);
      expect(list('L+M')?.run?.({ L: [1, 2, 3], M: [10, 20] })).toEqual([
        11, 22,
      ]);
    });

    it('nested list (matrix) broadcasts a scalar', () => {
      const e = new ComputeEngine();
      e.declare('A', 'list<list<number>>');
      expect(
        compile(e.parse('2A'))?.run?.({
          A: [
            [1, 2],
            [3, 4],
          ],
        })
      ).toEqual([
        [2, 4],
        [6, 8],
      ]);
    });

    it('end-to-end: per-candidate distances over a list of points', () => {
      // Item-15 point broadcast + scalar↔list arithmetic together — the Desmos
      // Voronoï shape `d = (x - V.x)^2 + (y - V.y)^2`, then `min(d)`.
      const e = new ComputeEngine();
      e.declare('V', 'list<tuple<number, number>>');
      e.declare('x', 'number');
      e.declare('y', 'number');
      const vars = {
        V: [
          [0, 0],
          [2, 0],
          [0, 2],
        ],
        x: 1,
        y: 1,
      };
      expect(compile(e.parse('(x-V.x)^2+(y-V.y)^2'))?.run?.(vars)).toEqual([
        2, 2, 2,
      ]);
      expect(
        compile(e.parse('\\min((x-V.x)^2+(y-V.y)^2)'))?.run?.(vars)
      ).toEqual(2);
    });

    it('a pure-scalar expression is unaffected (no broadcast wrapper)', () => {
      const e = new ComputeEngine();
      e.declare('a', 'number');
      e.declare('b', 'number');
      const r = compile(e.parse('a+b'));
      expect(r?.code).not.toContain('bcast');
      expect(r?.run?.({ a: 2, b: 3 })).toEqual(5);
    });
  });
});
