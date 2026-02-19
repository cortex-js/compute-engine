/**
 * End-to-end tests for real-world mathematical expressions.
 *
 * Each test parses a LaTeX expression, compiles it to JavaScript,
 * and (where applicable) executes the compiled function to verify
 * numeric correctness.
 */

import { engine as ce } from '../utils';
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
});
