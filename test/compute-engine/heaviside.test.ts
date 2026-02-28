/**
 * Tests for Heaviside step function: H(x) = 0 for x < 0, 1/2 for x = 0, 1 for x > 0
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('Heaviside evaluation', () => {
  test('negative input → 0', () => {
    expect(ce.expr(['Heaviside', -5]).evaluate().json).toBe(0);
    expect(ce.expr(['Heaviside', -0.001]).evaluate().json).toBe(0);
  });

  test('zero input → 1/2', () => {
    const result = ce.expr(['Heaviside', 0]).evaluate();
    expect(result.re).toBe(0.5);
  });

  test('positive input → 1', () => {
    expect(ce.expr(['Heaviside', 3]).evaluate().json).toBe(1);
    expect(ce.expr(['Heaviside', 0.001]).evaluate().json).toBe(1);
  });
});

describe('Heaviside LaTeX', () => {
  test('parse \\operatorname{Heaviside}(x)', () => {
    const expr = ce.parse('\\operatorname{Heaviside}(x)');
    expect(expr.operator).toBe('Heaviside');
  });

  test('serialize', () => {
    const latex = ce.expr(['Heaviside', 'x']).latex;
    expect(latex).toContain('Heaviside');
  });
});

describe('Heaviside JS compilation', () => {
  test('compiles successfully', () => {
    const result = compile(ce.expr(['Heaviside', 'x']));
    expect(result.success).toBe(true);
    expect(result.code).toContain('heaviside');
  });

  test('negative → 0', () => {
    const result = compile(ce.expr(['Heaviside', 'x']));
    expect(result.run!({ x: -5 })).toBe(0);
  });

  test('zero → 0.5', () => {
    const result = compile(ce.expr(['Heaviside', 'x']));
    expect(result.run!({ x: 0 })).toBe(0.5);
  });

  test('positive → 1', () => {
    const result = compile(ce.expr(['Heaviside', 'x']));
    expect(result.run!({ x: 3 })).toBe(1);
  });

  test('in expression: H(x) * x = ramp function', () => {
    const expr = ce.expr(['Multiply', ['Heaviside', 'x'], 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: -3 })).toBe(-0); // 0 * -3 = -0 (IEEE 754)
    expect(result.run!({ x: 0 })).toBe(0); // 0.5 * 0 = 0
    expect(result.run!({ x: 5 })).toBe(5); // 1 * 5 = 5
  });
});

describe('Heaviside interval-js compilation', () => {
  test('compiles successfully', () => {
    const result = compile(ce.expr(['Heaviside', 'x']), { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.code).toContain('_IA.heaviside');
  });

  test('negative → {lo: 0, hi: 0}', () => {
    const result = compile(ce.expr(['Heaviside', 'x']), { to: 'interval-js' });
    const out = result.run!({ x: -5 }) as any;
    const val = out.kind === 'interval' ? out.value : out;
    expect(val.lo).toBe(0);
    expect(val.hi).toBe(0);
  });

  test('zero → {lo: 0.5, hi: 0.5}', () => {
    const result = compile(ce.expr(['Heaviside', 'x']), { to: 'interval-js' });
    const out = result.run!({ x: 0 }) as any;
    const val = out.kind === 'interval' ? out.value : out;
    expect(val.lo).toBe(0.5);
    expect(val.hi).toBe(0.5);
  });

  test('positive → {lo: 1, hi: 1}', () => {
    const result = compile(ce.expr(['Heaviside', 'x']), { to: 'interval-js' });
    const out = result.run!({ x: 3 }) as any;
    const val = out.kind === 'interval' ? out.value : out;
    expect(val.lo).toBe(1);
    expect(val.hi).toBe(1);
  });

  test('singularity at 0 for spanning interval', () => {
    const result = compile(ce.expr(['Heaviside', 'x']), { to: 'interval-js' });
    // Input interval [-1, 1] spans the discontinuity
    const out = result.run!({ x: { lo: -1, hi: 1 } }) as any;
    const val = out.kind === 'interval' ? out.value : out;
    expect(val.kind).toBe('singular');
    expect(val.at).toBe(0);
  });
});
