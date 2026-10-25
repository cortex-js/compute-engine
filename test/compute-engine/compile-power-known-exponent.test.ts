import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A `Power` whose exponent reads a symbol with an assigned value is compiled
 * with the value of the exponent (user decision 2026-10-23, ROADMAP CE-213).
 * The lane rules of `Power` read a number literal exponent: an unknown-sign
 * base under a non-integer exponent promotes to the complex lane, and an
 * exponent with an odd denominator gives the real root of a negative base.
 * Before the change, `y^{k/2 − 1}` with `k = 1` compiled to the real
 * `pow(y, -0.5)`, which is `NaN` for a negative `y`, where the interpreter
 * and the compiled `y^{−1/2}` give the principal complex value. A free
 * symbol in the exponent keeps the real lane.
 */

type Run = {
  success: boolean;
  code: string;
  run: (v: Record<string, unknown>) => unknown;
};

function js(
  ce: ComputeEngine,
  latexOrJson: string | unknown,
  options: Record<string, unknown> = {}
): Run {
  const expr =
    typeof latexOrJson === 'string'
      ? ce.parse(latexOrJson)
      : ce.box(latexOrJson as any);
  return compile(expr, {
    to: 'javascript',
    fallback: false,
    ...options,
  } as any) as unknown as Run;
}

function asComplex(v: unknown): { re: number; im: number } {
  if (typeof v === 'number') return { re: v, im: 0 };
  return v as { re: number; im: number };
}

describe('CE-213: a power whose exponent reads an assigned symbol', () => {
  test('the compiled power takes the complex lane, as the interpreter does', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 1);
    const r = js(ce, 'y^{k/2-1}');
    expect(r.success).toBe(true);
    for (const y of [-2, -0.5, 3]) {
      const interp = ce
        .box(['Power', y, ['Subtract', ['Divide', 'k', 2], 1]])
        .N();
      const v = asComplex(r.run({ y }));
      expect(v.re).toBeCloseTo(interp.re, 12);
      expect(v.im).toBeCloseTo(interp.im, 12);
    }
    // The same value as the exponent written as a number (which
    // canonicalizes to `1/√y`, so the last bit can differ).
    const literal = asComplex(js(ce, 'y^{-1/2}').run({ y: -2 }));
    const symbolic = asComplex(r.run({ y: -2 }));
    expect(symbolic.re).toBeCloseTo(literal.re, 14);
    expect(symbolic.im).toBeCloseTo(literal.im, 14);
  });

  test('an odd denominator gives the real root of a negative base', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 1);
    const r = js(ce, ['Power', 'y', ['Divide', 'k', 3]]);
    expect(r.run({ y: -8 })).toBeCloseTo(-2, 14);
    expect(ce.box(['Power', -8, ['Divide', 'k', 3]]).N().re).toBeCloseTo(
      -2,
      14
    );
  });

  test('strict mode keeps the real lane', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 1);
    const r = js(ce, 'y^{k/2-1}', { mode: 'strict' });
    expect(r.success).toBe(true);
    expect(Number.isNaN(r.run({ y: -2 }) as number)).toBe(true);
    expect(r.run({ y: 4 })).toBeCloseTo(0.5, 14);
  });

  test('a free symbol in the exponent keeps the real lane', () => {
    const ce = new ComputeEngine();
    const r = js(ce, 'y^{m/2-1}');
    expect(r.code).not.toContain('cpow');
    expect(Number.isNaN(r.run({ y: -2, m: 1 }) as number)).toBe(true);
  });

  test('a vars input is not replaced by the value of the engine symbol', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 1);
    const r = js(ce, 'y^{k/2}', { vars: { k: '_.k' } });
    expect(r.run({ y: 4, k: 4 })).toBe(4 ** 2);
  });

  test('an exponent that calls a caller-overridden function is not replaced', () => {
    // The engine evaluation of `f(k)` applies the engine body `t/2`, which
    // gives `1/2`; the compiled code must call the caller's `f` instead.
    const ce = new ComputeEngine();
    ce.assign('k', 1);
    ce.declare('f', 'function');
    ce.assign('f', ce.parse('t \\mapsto t/2'));
    const r = js(ce, ['Power', 'x', ['f', 'k']], {
      functions: { f: (t: number) => 2 * t },
    });
    expect(r.success).toBe(true);
    expect(r.run({ x: 3 })).toBe(9);
  });

  test('a parameter of a lambda is not replaced by the value of the engine symbol', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 1);
    const r = js(ce, [
      'Map',
      ['Function', ['Power', 'y', ['Divide', 'k', 2]], 'k'],
      ['List', 1, 2, 3],
    ]);
    expect(r.run({ y: 4 })).toEqual([2, 4, 8]);
  });

  test('a parameter of a user function is not replaced by the value of the engine symbol', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 1);
    ce.parse('f(k) \\coloneq y^{k/2-1}').evaluate();
    const r = js(ce, 'f(3)');
    expect(r.run({ y: 4 })).toBeCloseTo(2, 14);
  });

  test('an integer value keeps the exponent: 0^0 stays NaN', () => {
    // The literal lowering of `x^0` is `1`; the interpreter computes
    // `x^{k − 1}` at `x = 0`, `k = 1` as `0^0`, which has no value.
    const ce = new ComputeEngine();
    ce.assign('k', 1);
    const r = js(ce, 'x^{k-1}');
    expect(Number.isNaN(r.run({ x: 0 }) as number)).toBe(true);
    expect(ce.parse('0^{k-1}').N().isNaN).toBe(true);
  });

  test('the chi-square tail with k = 1 is complex below 0 on the interpreted route', () => {
    // The interpreter compiles the integrand internally. With the exponent
    // read as `-1/2`, the integral of `y^{-1/2}·…` on an interval that holds
    // negative values has the same complex value as the integral written
    // with the number `-1/2`.
    const ce = new ComputeEngine();
    ce.assign('k', 1);
    const symbolic =
      '\\int_{-0.2}^{\\infty}\\frac{y^{\\frac{k}{2}-1}e^{-\\frac{y}{2}}}{2^{\\frac{k}{2}}\\Gamma(\\frac{k}{2})}dy';
    const literal =
      '\\int_{-0.2}^{\\infty}\\frac{y^{-\\frac{1}{2}}e^{-\\frac{y}{2}}}{2^{\\frac{1}{2}}\\Gamma(\\frac{1}{2})}dy';
    const a = ce.parse(symbolic).N();
    const b = ce.parse(literal).N();
    expect(a.re).toBeCloseTo(b.re, 8);
    expect(a.im).toBeCloseTo(b.im, 8);
    expect(a.im).toBeCloseTo(-0.369084, 5);
  });
});
