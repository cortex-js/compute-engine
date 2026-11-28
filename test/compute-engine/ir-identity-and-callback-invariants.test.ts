/**
 * Forms of the emitted code found in Tycho's codegen audit of CE 0.204.3
 * (`~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/2026-11-28-ce-0.204.3-report.md`):
 *
 * - a real or integer scalar `x * 1` or `x / 1` is `x` (`identityOperand()`
 *   of `passes.ts`), so a loop index of step 1 is `1 + i`, not `1 + (i * 1)`;
 * - `(-c) + x` is printed `x - c`, as `x + (-c)` is, and `((-c) * y) + x` is
 *   printed `x - (c * y)`;
 * - a GLSL loop bound that is a literal is its `int`, with no `clamp`;
 * - a build of a literal length below 2^32 prints no guard of its length;
 * - a pure instruction of an integrand that does not read the variable of
 *   integration is computed once, before the quadrature (`CALLBACK_REGIONS`),
 *   also from a small user function that the integrand calls;
 * - `Sign` of a complex compiles on GLSL (`_gpu_ir_csign`).
 *
 * Each value is the one of the code before the change: the identities are
 * exact in IEEE arithmetic, and the hoisted values are pure.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type Result = {
  success: boolean;
  code: string;
  preamble?: string;
  run: (vars: Record<string, number>) => unknown;
};

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('k', 'real<0..10>');
ce.declare('G', 'function');
ce.assign('G', ce.parse('t \\mapsto (t-1)!'));

const js = (latex: string, options: object = {}): Result =>
  compile(ce.parse(latex), {
    to: 'javascript',
    fallback: false,
    ...options,
  } as never) as unknown as Result;

describe('an identity operand', () => {
  test('a loop index of step 1 has no product by 1', () => {
    const r = js(
      '\\left[\\cos(\\frac{\\pi j}{18})x \\operatorname{for} j=1..2000\\right]'
    );
    expect(r.code).toContain('(1 + v');
    expect(r.code).not.toMatch(/\* 1\)/);
    const v = r.run({ x: 2 }) as number[];
    expect(v).toHaveLength(2000);
    expect(v[0]).toBe(2 * Math.cos(Math.PI / 18));
    expect(v[1999]).toBe(2 * Math.cos((Math.PI * 2000) / 18));
  });

  test('a build of a literal length prints no guard of its length', () => {
    const r = js(
      '\\left[\\cos(\\frac{\\pi j}{18})x \\operatorname{for} j=1..2000\\right]'
    );
    expect(r.code).not.toContain('2^32');
  });

  test('a build of a run-time length keeps the guard', () => {
    ce.declare('n', 'integer');
    const r = js('\\left[j x \\operatorname{for} j=1..n\\right]');
    expect(r.code).toContain('2^32');
  });

  test('(-c) + x is x - c', () => {
    const r = js('-1.69+\\sin(x)');
    expect(r.code).toContain('(Math.sin(_.x) - 1.69)');
    expect(r.run({ x: 1 })).toBe(Math.sin(1) - 1.69);
  });

  test('x + 0 is kept: it is not x at x = -0', () => {
    // A held -0 is 0 in the canonical form, so `x + c` is `0 + x`.
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.declare('c', 'real');
    engine.assign('c', -0);
    const r = compile(engine.box(['Add', 'x', 'c']), {
      to: 'javascript',
      fallback: false,
    } as never) as unknown as Result;
    expect(r.code).toContain('0 + _.x');
    expect(Object.is(r.run({ x: -0 }), 0)).toBe(true);
  });
});

describe('a product by a negative constant, x / 1, literal GLSL bounds', () => {
  test('((-c) * y) + x is printed x - (c * y), with the same bits', () => {
    const r = js('1-0.4y');
    expect(r.code).toBe('(1 - (0.4 * _.y))');
    for (const y of [0, -0, 1, -2.5, 1e308, -Infinity, Infinity, NaN, 3.3])
      expect(Object.is(r.run({ y }), -0.4 * y + 1)).toBe(true);
    expect(js('x-2.5y+3').code).toBe('((_.x - (2.5 * _.y)) + 3)');
  });

  test('x / 1 is x', () => {
    const r = js('\\sum_{k=1}^{3} \\frac{\\sin(kx)}{k}');
    expect(r.code).toContain('(0 + Math.sin(_.x))');
    // The `0 +` stays: the interpreter's sum at x = -0 is 0, not -0.
    expect(Object.is(r.run({ x: -0 }), 0)).toBe(true);
  });

  test('a GLSL loop bound that is a literal is its int', () => {
    const r = compile(ce.parse('\\sum_{k=1}^{15} \\frac{\\sin(kx)}{k}'), {
      to: 'glsl',
      fallback: false,
    } as never) as unknown as Result;
    expect(r.code).toContain('_hi = 15;');
    expect(r.code).toMatch(/for \(int v\d+_i = 1;/);
    expect(r.code).not.toContain('clamp(');
    const n = compile(ce.parse('\\sum_{k=1}^{n} kx'), {
      to: 'glsl',
      fallback: false,
    } as never) as unknown as Result;
    expect(n.code).toContain('int(clamp(n, -1073741824.0, 1073741824.0))');
    // A negative literal bound, `(-3.0)` in the GLSL text, is its int.
    const neg = compile(ce.parse('\\sum_{k=-3}^{5} kx'), {
      to: 'glsl',
      fallback: false,
    } as never) as unknown as Result;
    expect(neg.code).toContain('_hi = 5;');
    expect(neg.code).toMatch(/for \(int v\d+_i = -3;/);
  });
});

describe('a pure instruction of an integrand moves out of it', () => {
  const tail =
    '\\int_{x}^{\\infty}\\!\\frac{\\exp(-\\frac{y}{2})y^{k/2-1}}{\\Gamma(\\frac{k}{2})\\times2^{\\frac{k}{2}}}\\, \\mathrm{d}y';

  test('the denominator is computed once, before the quadrature', () => {
    const r = js(tail, { inputs: { x: 'real', k: 'real<0..10>' } });
    const [before, integrand] = r.code.split('_SYS.irIntegrate(');
    expect(before).toContain('_SYS.ir.gamma(');
    expect(integrand).not.toContain('gamma(');
    // The chi-square tail of 3 degrees of freedom at 1.
    expect(r.run({ x: 1, k: 3 })).toBeCloseTo(0.8012519569012009, 8);
  });

  test('so is the body of a small user function that it calls', () => {
    const r = js(tail.replace('\\Gamma', 'G'), {
      inputs: { x: 'real', k: 'real<0..10>' },
    });
    const [before, integrand] = r.code.split('_SYS.irIntegrate(');
    expect(before).toContain('factorial(');
    expect(integrand).not.toContain('factorial(');
    expect(integrand).not.toContain('u0_');
    expect(r.run({ x: 1, k: 3 })).toBeCloseTo(0.8012519569012009, 8);
  });

  test('on interval-js too, with a finite bound', () => {
    const r = compile(
      ce.parse(tail.replace('\\Gamma', 'G').replace('\\infty', '10')),
      {
        to: 'interval-js',
        fallback: false,
        inputs: { x: 'real', k: 'real<0..10>' },
      } as never
    ) as unknown as Result;
    const [before, integrand] = r.code.split('_IA.integrate(');
    expect(before).toContain('_IA.factorial(');
    expect(integrand).not.toContain('factorial(');
  });

  test('not on interval-js with an infinite bound: the integrand never runs', () => {
    const r = compile(ce.parse(tail.replace('\\Gamma', 'G')), {
      to: 'interval-js',
      fallback: false,
      inputs: { x: 'real', k: 'real<0..10>' },
    } as never) as unknown as Result;
    const [before] = r.code.split('_IA.integrate(');
    expect(before).not.toContain('factorial(');
  });
});

describe('Sign of a complex on GLSL', () => {
  test('compiles to the helper of z/|z|', () => {
    const cz = new ComputeEngine();
    cz.declare('z', 'complex');
    const r = compile(cz.box(['Sign', 'z']), {
      to: 'glsl',
      fallback: false,
    } as never) as unknown as Result;
    expect(r.success).toBe(true);
    expect(r.code).toContain('_gpu_ir_csign(');
    expect(r.preamble).toContain('return u / length(u);');
  });
});
