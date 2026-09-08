/**
 * Shader peepholes and per-function preamble inclusion.
 *
 * A shader preamble is compiled by the driver together with the shader, once
 * per program, so a helper definition nothing calls is paid for on every first
 * draw. Before the per-function pass a row that converted one colour space
 * carried all fourteen colour conversions (6.1 KB), a Mandelbrot row carried
 * the Julia iteration, and a three-element `Median` carried the seven median
 * networks. The emission peepholes below replace an idiom with the builtin the
 * hardware already has (`fract`, `dot`, `exp2`, the boolean-to-float cast), or
 * write an operand once where it was written twice.
 *
 * The Tycho code-generation audit of 2026-09-08 measured every one of these on
 * a corpus of plotted rows.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import {
  gpuLibrarySubset,
  GPU_COLOR_PREAMBLE_GLSL,
  GPU_COLOR_PREAMBLE_WGSL,
  GPU_MEDIAN_PREAMBLE_GLSL,
  GPU_BESSELJ_PREAMBLE_WGSL,
} from '../../src/compute-engine/compilation/gpu-target';

/**
 * A fresh engine per probe: `P` is ASSIGNED in the point-list probes, and the
 * assignment must not leak into the others.
 */
function fresh(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.declare('y', 'number');
  return ce;
}

const glsl = (expr: any, ce = fresh()) =>
  new GLSLTarget().compile(ce.box(expr));
const wgsl = (expr: any, ce = fresh()) =>
  new WGSLTarget().compile(ce.box(expr));

/** The helper functions a preamble declares, in order. */
function declaredIn(preamble: string | undefined): string[] {
  return [
    ...String(preamble ?? '').matchAll(
      /^(?:fn[ \t]+([A-Za-z_]\w*)|[A-Za-z_]\w*(?:\[\d+\])?[ \t]+([A-Za-z_]\w*))[ \t]*\(/gm
    ),
  ].map((m) => m[1] ?? m[2]);
}

describe('per-function preamble inclusion', () => {
  it('a colour row carries only the conversions it reaches', () => {
    const r = glsl(['AsRgb', ['Hsv', 'x', 0.5, 0.5]]);
    expect(r.code).toBe(
      '_gpu_srgb_roundtrip(_gpu_hsv_to_rgb(vec3(x, 0.5, 0.5)))'
    );
    // `_gpu_hsv_to_rgb` and the round trip are named by the code; everything
    // else here is called from the round trip's own body.
    expect(declaredIn(r.preamble)).toEqual([
      '_gpu_srgb_to_linear',
      '_gpu_linear_to_srgb',
      '_gpu_srgb_to_oklab',
      '_gpu_oklab_to_srgb',
      '_gpu_oklab_to_oklch',
      '_gpu_oklch_to_oklab',
      '_gpu_srgb_to_oklch',
      '_gpu_oklch_to_srgb',
      '_gpu_hsv_to_rgb',
      '_gpu_srgb_roundtrip',
    ]);
    expect(r.preamble).not.toContain('_gpu_rgb_to_hsl');
    expect(r.preamble).not.toContain('_gpu_rgb_to_hsv');
    expect(r.preamble).not.toContain('_gpu_hsl_to_rgb');
    expect(r.preamble).not.toContain('_gpu_color_mix');
    expect(r.preamble).not.toContain('_gpu_apca');
  });

  it('a Mandelbrot row does not carry the Julia iteration, and the reverse', () => {
    const m = glsl(['Mandelbrot', ['Complex', 'x', 'y'], 50]);
    expect(m.code).toBe('_fractal_mandelbrot(vec2(x, y), 50)');
    expect(declaredIn(m.preamble)).toEqual(['_fractal_mandelbrot']);

    const j = wgsl(['Julia', ['Complex', 'x', 'y'], ['Complex', 0.3, 0.5], 50]);
    expect(declaredIn(j.preamble)).toEqual(['_fractal_julia']);
  });

  it('a three-element Median carries one median network', () => {
    const r = glsl(['Median', ['List', 1.5, 'x', 3.5]]);
    expect(r.code).toBe('_gpu_median_3(1.5, x, 3.5)');
    expect(declaredIn(r.preamble)).toEqual(['_gpu_median_3']);
  });

  it('Gamma does not carry the log-gamma approximation', () => {
    const r = glsl(['Gamma', 'x']);
    // `_gpu_inf` comes with `_gpu_gamma`: the helper returns it at a pole.
    expect(declaredIn(r.preamble)).toEqual(['_gpu_inf', '_gpu_gamma']);
  });

  it('a subset naming every function reproduces the library exactly', () => {
    for (const library of [
      GPU_COLOR_PREAMBLE_GLSL,
      GPU_COLOR_PREAMBLE_WGSL,
      GPU_MEDIAN_PREAMBLE_GLSL,
      GPU_BESSELJ_PREAMBLE_WGSL,
    ]) {
      const all = declaredIn(library).join(' ');
      expect(gpuLibrarySubset(all, library)).toBe(library);
    }
  });

  it('a library nothing names contributes nothing', () => {
    expect(gpuLibrarySubset('sin(x)', GPU_COLOR_PREAMBLE_GLSL)).toBe('');
  });

  it('the closure follows calls, not just the named function', () => {
    // `_gpu_besselJ` calls the series and asymptotic arms, which call the
    // factorial; naming only the entry point must still bring all four.
    expect(
      declaredIn(
        gpuLibrarySubset('_gpu_besselJ(x, 1)', GPU_BESSELJ_PREAMBLE_WGSL)
      )
    ).toEqual([
      '_gpu_factorial',
      '_gpu_besselJ_series',
      '_gpu_besselJ_asymptotic',
      '_gpu_besselJ',
    ]);
  });
});

describe('sum of squared components is a dot product', () => {
  /** `P` assigned a two-point list makes `PointX(P)` a `vec2`. */
  function withPoints(): ComputeEngine {
    const ce = fresh();
    ce.assign('P', ce.parse('\\lbrack(-1,2),(-3,4)\\rbrack'));
    return ce;
  }

  it('GLSL binds the vector once and calls dot', () => {
    const ce = withPoints();
    const code = new GLSLTarget().compile(
      ce.parse('\\sum\\left(\\left(x-\\mathrm{PointX}(P)\\right)^2\\right)')
    ).code;
    expect(code).toBe(
      'vec2 _tv1 = x + vec2(1.0, 3.0);\nreturn dot(_tv1, _tv1);'
    );
  });

  it('WGSL binds the vector once and calls dot', () => {
    const ce = withPoints();
    const code = new WGSLTarget().compile(
      ce.parse('\\sum\\left(\\left(x-\\mathrm{PointX}(P)\\right)^2\\right)')
    ).code;
    expect(code).toBe(
      'var _tv1: vec2f = x + vec2f(1.0, 3.0);\nreturn dot(_tv1, _tv1);'
    );
  });

  it('a bare vector symbol is named twice, with no temporary', () => {
    const ce = fresh();
    ce.declare('v', 'vector<2>');
    expect(glsl(['Sum', ['Power', 'v', 2]], ce).code).toBe('dot(v, v)');
  });

  it('a caller-mapped square keeps the component fold', () => {
    // The rewrite reads the square structurally and compiles the base alone,
    // so it must not run when the caller supplies its own `Power`. Here the
    // caller's builtin takes a vec2 base and a scalar exponent, which the
    // shader genType rule refuses, and the reduction fails closed instead of
    // silently emitting `dot`.
    const ce = fresh();
    ce.declare('v', 'vector<2>');
    const r = new GLSLTarget().compile(ce.box(['Sum', ['Power', 'v', 2]]), {
      fallback: true,
      functions: { Power: 'myPow' },
    });
    expect(r.code ?? '').not.toContain('dot(');
    expect(r.success).toBe(false);
  });

  it('a Product of the same square keeps the component fold', () => {
    const ce = fresh();
    ce.declare('v', 'vector<2>');
    // The square of a bare vector symbol inlines as `v * v`, and the
    // component fold reads the product's components back out of a temporary.
    expect(glsl(['Product', ['Power', 'v', 2]], ce).code).toBe(
      'vec2 _tv1 = (v * v);\nreturn ((_tv1.x) * (_tv1.y));'
    );
  });
});

describe('small emission peepholes', () => {
  it('a modulus of one is the fractional part', () => {
    expect(glsl(['Mod', 'x', 1]).code).toBe('fract(x)');
    expect(wgsl(['Mod', 'x', 1]).code).toBe('fract(x)');
    // Any other divisor keeps the general lowering.
    expect(glsl(['Mod', 'x', 2]).code).toBe('mod(x, 2.0)');
    expect(wgsl(['Mod', 'x', 2]).code).toBe(
      '((((x) % (2.0)) + (2.0)) % (2.0))'
    );
    // A `vecN` dividend keeps it too: `fract` takes one argument, and the
    // operand-shape gate reads the emitted call against the head's two
    // operands, so a one-argument call beside a scalar divisor is judged a
    // genType mismatch and declines.
    const cev = fresh();
    cev.declare('v', 'vector<2>');
    expect(glsl(['Mod', 'v', 1], cev).code).toBe('mod(v, 1.0)');
  });

  it('the fractional part agrees with the interpreter below zero', () => {
    // `mod(x, 1)` is `x - 1 * floor(x)` and `fract(x)` is `x - floor(x)`, so
    // the peephole must reproduce the interpreter's floored answer.
    const ce = fresh();
    for (const v of [-0.25, -1.5, 2.75, -3]) {
      const interpreted = ce.box(['Mod', v, 1]).evaluate().re;
      expect(interpreted).toBeCloseTo(v - Math.floor(v), 12);
    }
  });

  it('a conditional between one and zero is a cast of the condition', () => {
    expect(glsl(['If', ['Greater', 'x', 0], 1, 0]).code).toBe('float(0.0 < x)');
    expect(wgsl(['If', ['Greater', 'x', 0], 1, 0]).code).toBe('f32(0.0 < x)');
  });

  it('a small integer power of a symbol is repeated multiplication', () => {
    expect(glsl(['Power', 'x', 5]).code).toBe('(x * x * x * x * x)');
    expect(glsl(['Power', 'x', 8]).code).toBe(
      '(x * x * x * x * x * x * x * x)'
    );
    // Past the inline limit, and for a compound base at any size, the
    // sign-preserving helper still evaluates the base once.
    expect(glsl(['Power', 'x', 9]).code).toBe('_gpu_powi(x, 9.0)');
    expect(glsl(['Power', ['Add', 'x', 1], 5]).code).toBe(
      '_gpu_powi(x + 1.0, 5.0)'
    );
  });

  it('a power of two is exp2', () => {
    expect(glsl(['Power', 2, 'x']).code).toBe('exp2(x)');
    expect(wgsl(['Power', 2, 'x']).code).toBe('exp2(x)');
    // Another base keeps `pow`.
    expect(glsl(['Power', 3, 'x']).code).toBe('pow(3.0, x)');
  });

  it('a product with a literal zero keeps the multiplication', () => {
    // Neither target folds it away: the interpreter does not canonicalize
    // `0·x` to zero, and `0 * ∞` is NaN on the hardware, so folding would
    // answer 0 where the interpreter answers NaN.
    expect(glsl(['Multiply', 0, ['Cos', 'x']]).code).toBe('0.0 * cos(x)');
  });
});

describe('Which clauses that answer the same value', () => {
  it('consecutive identical arms merge into one disjunction', () => {
    const expr = [
      'Which',
      ['Less', 'x', 1],
      0.5,
      ['Less', 'x', 2],
      0.5,
      ['Less', 'x', 3],
      0.5,
    ];
    expect(glsl(expr).code).toBe(
      '(((x < 1.0) || (x < 2.0) || (x < 3.0)) ? (0.5) : (_gpu_nan()))'
    );
    expect(wgsl(expr).code).toBe(
      'select(bitcast<f32>(0x7fc00000u), 0.5, (x < 1.0) || (x < 2.0) || (x < 3.0))'
    );
  });

  it('different arms keep their own clauses', () => {
    const expr = ['Which', ['Less', 'x', 1], 0.5, ['Less', 'x', 2], 0.25];
    expect(glsl(expr).code).toBe(
      '((x < 1.0) ? (0.5) : (((x < 2.0) ? (0.25) : (_gpu_nan()))))'
    );
  });

  it('the merged form answers what the interpreter answers', () => {
    // `||` short-circuits in both languages, so the merged condition selects
    // the same clause the nested selection did, at every sample point.
    const ce = fresh();
    for (const v of [0.5, 1.5, 2.5, 3.5]) {
      const value = ce
        .box([
          'Which',
          ['Less', v, 1],
          0.5,
          ['Less', v, 2],
          0.5,
          ['Less', v, 3],
          0.5,
        ])
        .evaluate();
      // Below three every clause answers 0.5; past it the `Which` falls
      // through, which the shader spells as its NaN.
      expect(value.re).toBe(v < 3 ? 0.5 : NaN);
    }
  });
});

describe('argument of a complex value, and rounding', () => {
  it('a vec2 built in place is read apart, not built twice', () => {
    const ce = fresh();
    const code = new GLSLTarget().compile(
      ce.parse('\\arg((x - 0.3127) + i(y - 0.329))')
    ).code;
    expect(code).toBe('atan((y + -0.329), -0.3127 + x)');
  });

  it('WGSL spells the two-argument arc tangent atan2', () => {
    // WGSL declares `atan(e)` and `atan2(y, x)`; a two-argument `atan` is not
    // a WGSL builtin at all, so the GLSL spelling does not compile there.
    expect(wgsl(['Arctan2', 'y', 'x']).code).toBe('atan2(y, x)');
    const ce = fresh();
    ce.declare('z', 'complex');
    expect(wgsl(['Argument', 'z'], ce).code).toBe('atan2(z.y, z.x)');
  });

  it('rounding goes through a helper that writes its operand once', () => {
    const r = glsl(['Round', 'x']);
    expect(r.code).toBe('_gpu_round(x)');
    expect(r.preamble).toContain(
      'float _gpu_round(float x) {\n  return sign(x) * floor(abs(x) + 0.5);\n}'
    );
    expect(wgsl(['Round', 'x']).code).toBe('_gpu_round(x)');
  });

  it('the helper rounds halves the way the interpreter does', () => {
    // The interpreter rounds half AWAY from zero; both languages' own
    // `round()` rounds a half to the even neighbour, which is why the helper
    // exists. Check the helper's expression against the interpreter.
    const ce = fresh();
    const helper = (v: number) => Math.sign(v) * Math.floor(Math.abs(v) + 0.5);
    for (const v of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5, -0.4, 0.4]) {
      // `+ 0` normalizes the negative zero `sign(-0.4) * floor(0.9)` gives.
      expect(helper(v) + 0).toBe(ce.box(['Round', v]).evaluate().re! + 0);
    }
  });

  it('a vector operand keeps the componentwise expression', () => {
    // `_gpu_round` is declared over `float`, and the shape gate declines a
    // vector handed to a scalar-only helper; every piece of the inline form
    // is componentwise, so it stays valid there.
    const ce = fresh();
    ce.declare('v', 'vector<2>');
    expect(glsl(['Round', 'v'], ce).code).toBe(
      '(sign(v) * floor(abs(v) + 0.5))'
    );
  });
});
