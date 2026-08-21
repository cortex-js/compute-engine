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

  // ── Factorial of a non-integer (Tycho item 99) ─────────────────────

  describe('Factorial extends to Γ(x+1) (Tycho item 99)', () => {
    // The compiled runtime bound `Factorial` to the integer-only `factorial()`
    // helper, so `(1/2 - 1)!` returned NaN with `success: true` while the
    // interpreter answered Γ(1/2) = √π. A chi-squared normalizing constant
    // `(k/2 - 1)!` at k = 1 made a whole compiled integrand NaN.
    it('compiled (1/2-1)! is √π', () => {
      const expr = ce.parse('(\\frac{1}{2}-1)!');
      expect(expr.N().re).toBeCloseTo(Math.sqrt(Math.PI), 12);
      expect(compile(expr)?.run?.({})).toBe(1.7724538509055159);
    });

    it('compiled non-integer factorials match .N()', () => {
      for (const latex of ['(-0.5)!', '(2.5)!', '(-1.5)!', '(1.5)!']) {
        const expr = ce.parse(latex);
        const expected = expr.N().re;
        const actual = compile(expr)?.run?.({});
        expect(typeof actual).toBe('number');
        expect(Math.abs(actual! / expected - 1)).toBeLessThan(1e-12);
      }
    });

    it('a run-time non-integer argument goes through Γ too', () => {
      const e = new ComputeEngine();
      e.declare('x', 'number');
      const f = compile(e.parse('x!'));
      expect(f?.run?.({ x: -0.5 })).toBe(1.7724538509055159);
      expect(f?.run?.({ x: 2.5 })).toBe(3.3233509704478448);
      expect(f?.run?.({ x: 5 })).toBe(120);
    });

    it('integer factorials are unchanged', () => {
      // `constantFold: false`: these arguments are all variable-free, so
      // compile-time constant folding would answer from the interpreter
      // instead of the EMITTED integer fast path whose saturation behaviour is
      // what this test pins.
      const v = (latex: string) =>
        compile(ce.parse(latex), { constantFold: false })?.run?.({});
      expect(v('0!')).toBe(1);
      expect(v('1!')).toBe(1);
      expect(v('5!')).toBe(120);
      // `170!` ≈ 7.26e306 is the largest double-representable factorial and
      // stays finite (the historical `n ≥ 170` cap wrongly saturated it);
      // the loop's rounding differs from the interpreter's correctly-rounded
      // 7.257415615307999e306 only in the last ulps. `171!` overflows.
      expect(v('170!')).toBe(7.257415615307994e306);
      expect(v('171!')).toBe(Infinity);
    });

    it('a negative integer (a pole of Γ) compiles to NaN', () => {
      // The interpreter answers ComplexInfinity (`~oo`); the compiled runner
      // is real-valued, and a pole has no real value, which the real lane
      // spells `NaN`. Every spelling agrees — the constant, the derived pole,
      // and a pole under a parent — because `~oo` types `number` throughout,
      // so no parent is tricked into complex codegen by a pole.
      expect(ce.parse('(-1)!').N().toString()).toBe('~oo');
      expect(compile(ce.parse('\\tilde\\infty'))?.run?.({})).toBeNaN();
      expect(compile(ce.parse('(-1)!'))?.run?.({})).toBeNaN();
      expect(compile(ce.parse('(-2)!'))?.run?.({})).toBeNaN();
    });

    // A pole under a parent is where the old inconsistency showed: the pole's
    // node typed `number` while its VALUE was complex-shaped, so the constant
    // fold emitted a `{re, im}` object into real arithmetic and the two
    // compile paths disagreed with each other (`1 + (-1)!` folded to the
    // object but lowered structurally to NaN). With `~oo` typing `number`
    // everywhere, every spelling and BOTH paths answer NaN.
    it('a pole under a parent agrees on both compile paths', () => {
      expect(ce.parse('1 + (-1)!').N().toString()).toBe('~oo');
      const both = (latex: string) => [
        compile(ce.parse(latex))?.run?.({}),
        compile(ce.parse(latex), { constantFold: false })?.run?.({}),
      ];
      // A MULTIPLIED pole is included: `2·~oo` is `~oo` (an undirected
      // infinity takes no sign from its coefficient), so the fold reaches the
      // same pole the structural lowering does. While `Multiply` still gave
      // that product a sign, this row answered `Infinity` folded and `NaN`
      // structurally.
      for (const latex of ['1 + (-1)!', '1 + \\tilde\\infty', '2(-1)!'])
        for (const v of both(latex)) expect(v).toBeNaN();
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

    it('list + list zips element-wise, and a length mismatch is an error', () => {
      expect(list('L+M')?.run?.({ L: [1, 2, 3], M: [10, 20, 30] })).toEqual([
        11, 22, 33,
      ]);
      // Was `[11, 22]` — zip-to-shortest silently dropped `L`'s tail while the
      // interpreter already answered `incompatible-dimensions` for this shape.
      // The 2026-07-24 ruling made both sides agree: no truncation, and the
      // error projects onto a real target as NaN.
      expect(list('L+M')?.run?.({ L: [1, 2, 3], M: [10, 20] })).toBeNaN();
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
