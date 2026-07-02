import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();

describe('COMPILE When', () => {
  describe('JavaScript target', () => {
    it('should compile When(x, x > 0) and return x when positive, NaN otherwise', () => {
      const expr = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 5 })).toBe(5);
      expect(Number.isNaN(result.run!({ x: -1 }))).toBe(true);
    });

    it('should compile When(5, True) and evaluate to 5', () => {
      const expr = ce.expr(['When', 5, 'True']);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({})).toBe(5);
    });

    it('should compile When(5, False) and evaluate to NaN', () => {
      const expr = ce.expr(['When', 5, 'False']);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(Number.isNaN(result.run!({}))).toBe(true);
    });

    it('should generate ternary code', () => {
      const expr = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const result = compile(expr)!;
      expect(result.code).toContain('?');
      expect(result.code).toContain(':');
      expect(result.code).toContain('NaN');
    });

    it('should compile When nested in an expression', () => {
      // When(x, x > 0) + 1 should be x+1 for x>0, NaN+1=NaN otherwise
      const expr = ce.expr([
        'Add',
        ['When', 'x', ['Greater', 'x', 0]],
        1,
      ]);
      const result = compile(expr)!;
      expect(result.success).toBe(true);
      expect(result.run!({ x: 3 })).toBe(4);
      expect(Number.isNaN(result.run!({ x: -2 }))).toBe(true);
    });
  });

  describe('GLSL target', () => {
    it('should generate ternary code for When', () => {
      const expr = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const code = glsl.compile(expr).code;
      expect(code).toContain('?');
      expect(code).toContain(':');
    });

    it('should compile When(x, True) to just x in GLSL', () => {
      const expr = ce.expr(['When', 'x', 'True']);
      const code = glsl.compile(expr).code;
      // Condition is True (1 in boolean context) so x is always returned
      expect(code).toContain('x');
    });
  });

  // CO-P2-24: like Which, a non-boolean When condition fails closed on the JS
  // target (matching the interpreter's throw) rather than silently returning
  // NaN via the else branch.
  describe('non-boolean condition (JS) fails closed', () => {
    it('guards a numeric/NaN condition with _SYS.cond and rethrows', () => {
      const expr = ce.expr(['When', 5, ['Divide', 'x', 'y']]);
      const result = compile(expr, { fallback: false })!;
      expect(result.code).toContain('_SYS.cond(');
      expect(() => result.run!({ x: 0, y: 0 })).toThrow();
    });

    it('leaves a relational condition unguarded', () => {
      const expr = ce.expr(['When', 'x', ['Greater', 'x', 0]]);
      const result = compile(expr, { fallback: false })!;
      expect(result.code).not.toContain('_SYS.cond');
      expect(result.run!({ x: 5 })).toBe(5);
      expect(Number.isNaN(result.run!({ x: -1 }))).toBe(true);
    });
  });
});
