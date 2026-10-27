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
import { shaderFunctions } from './gpu-shader-f32-eval';

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

  it('the Gamma pole test covers every finite negative integer', () => {
    // A finite f32 integer below -3.0e38 is a pole too. The bound must be
    // the most negative finite f32, so that only -Infinity is excluded.
    for (const r of [glsl(['Gamma', 'x']), wgsl(['Gamma', 'x'])]) {
      expect(r.preamble).toContain('z >= -3.4028234663852886e38');
      expect(r.preamble).not.toContain('3.0e38');
    }
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
    expect(glsl(['Mod', 'x', 1]).code).toBe('fract(fract(x))');
    expect(wgsl(['Mod', 'x', 1]).code).toBe('fract(fract(x))');
    // Any other divisor keeps the general lowering.
    expect(glsl(['Mod', 'x', 2]).code).toBe('_gpu_fmod(x, 2.0)');
    expect(wgsl(['Mod', 'x', 2]).code).toBe('_gpu_fmod(x, 2.0)');
    // A `vecN` dividend takes the peephole too (CE-254): the lowering
    // declares that `fract` leaves the divisor out of the call, so the
    // operand-shape check judges `fract(v)` against the dividend alone.
    const cev = fresh();
    cev.declare('v', 'vector<2>');
    expect(glsl(['Mod', 'v', 1], cev).code).toBe('fract(fract(v))');
    expect(wgsl(['Mod', 'v', 1], cev).code).toBe('fract(fract(v))');
    // A dividend with no `fract` overload (a matrix) still declines.
    cev.declare('M', 'matrix<real^(2x2)>');
    expect(() => glsl(['Mod', 'M', 1], cev)).toThrow(
      /`fract` .* has no `matN` overload/
    );
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
    expect(glsl(['Multiply', 0, ['Cos', 'x']]).code).toBe('0.0 * _gpu_cos(x)');
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
      'select(_gpu_nan(), 0.5, (x < 1.0) || (x < 2.0) || (x < 3.0))'
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
      'float _gpu_round(float x) {\n  float a = abs(x);\n  float m = floor(a);\n' +
        '  return sign(x) * (m + step(0.5, a - m));\n}'
    );
    expect(wgsl(['Round', 'x']).code).toBe('_gpu_round(x)');
  });

  it('the helper rounds halves the way the interpreter does', () => {
    // The interpreter rounds half AWAY from zero; both languages' own
    // `round()` rounds a half to the even neighbour, which is why the helper
    // exists. Check the helper's expression against the interpreter.
    // The helper does not add 0.5 to the operand, which is rounded for a
    // large operand: `floor(2^52 + 1 + 0.5)` is `2^52 + 2`.
    const ce = fresh();
    const step = (edge: number, d: number) => (d < edge ? 0 : 1);
    const helper = (v: number) => {
      const a = Math.abs(v);
      const m = Math.floor(a);
      return Math.sign(v) * (m + step(0.5, a - m));
    };
    for (const v of [
      -2.5,
      -1.5,
      -0.5,
      0.5,
      1.5,
      2.5,
      -0.4,
      0.4,
      2 ** 52 + 1,
      -(2 ** 52 + 1),
    ]) {
      // `+ 0` normalizes the negative zero `sign(-0.4) * floor(0.9)` gives.
      expect(helper(v) + 0).toBe(ce.box(['Round', v]).evaluate().re! + 0);
    }
  });

  it('a vector operand keeps the componentwise expression', () => {
    // `_gpu_round` is declared over `float`, and the shape gate declines a
    // vector handed to a scalar-only helper; every piece of the inline form
    // is componentwise, so it stays valid there. `ceil(0.5 + 0.5 * sign(d -
    // 0.5))` is 1 when the distance `d` to the floor is at least 0.5.
    const ce = fresh();
    ce.declare('v', 'vector<2>');
    expect(glsl(['Round', 'v'], ce).code).toBe(
      '(sign(v) * (floor(abs(v)) + ' +
        'ceil(0.5 + 0.5 * sign(abs(v) - floor(abs(v)) - 0.5))))'
    );
  });
});

describe('the imaginary unit times a complex factor', () => {
  // `i·X` was emitted as `vec2(0.0, X)` (and `t + i·X` as `vec2(t, X)`)
  // whatever the type of `X`. When `X` is complex its code is a `vec2`, and a
  // vec2 constructor reads only the first component of a vec2 argument in its
  // second slot: the shader computed `(0, Re X)` where `i·X` is
  // `(−Im X, Re X)`. Tycho ledger row 398.
  function complexEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    ce.declare('t', 'real');
    return ce;
  }
  const cases: [string, string, string][] = [
    // A plain identifier is rotated by a swizzle, which reads it twice at no
    // cost; a call goes through `_gpu_cmul` so that it is evaluated once.
    ['iz', 'vec2(-z.y, z.x)', 'vec2f(-z.y, z.x)'],
    ['2iz', '(2.0 * vec2(-z.y, z.x))', '(2.0 * vec2f(-z.y, z.x))'],
    [
      'i\\tanh(z)',
      '_gpu_cmul(vec2(0.0, 1.0), _gpu_ctanh(z))',
      '_gpu_cmul(vec2f(0.0, 1.0), _gpu_ctanh(z))',
    ],
    [
      't+i\\tanh(z)',
      'vec2(t, 0.0) + _gpu_cmul(vec2(0.0, 1.0), _gpu_ctanh(z))',
      'vec2f(t, 0.0) + _gpu_cmul(vec2f(0.0, 1.0), _gpu_ctanh(z))',
    ],
    // Controls: a real factor keeps the `vec2(0.0, X)` shortcut, and a
    // product with a complex literal other than `k·i` keeps `_gpu_cmul`.
    ['it', 'vec2(0.0, t)', 'vec2f(0.0, t)'],
    ['t+2it', 'vec2(t, 2.0 * t)', 'vec2f(t, 2.0 * t)'],
    [
      '(1+i)\\tanh(z)',
      '_gpu_cmul(vec2(1.0, 1.0), _gpu_ctanh(z))',
      '_gpu_cmul(vec2f(1.0, 1.0), _gpu_ctanh(z))',
    ],
  ];
  for (const [latex, glslCode, wgslCode] of cases) {
    it(`${latex} on both shader targets`, () => {
      const ce = complexEngine();
      expect(new GLSLTarget().compile(ce.parse(latex)).code).toBe(glslCode);
      expect(new WGSLTarget().compile(ce.parse(latex)).code).toBe(wgslCode);
    });
  }

  it('the emitted shader computes the value of the interpreter', () => {
    // Run the emitted text with the f32 shader interpreter, and compare with
    // the engine's own value at the same point. The interpreter has no
    // `sinh`/`cosh` built-in, so the call operand is `exp(z)` here, which
    // takes the same `_gpu_cmul` lowering as `tanh(z)` above.
    const z = { re: 1, im: 2 };
    const t = 0.5;
    for (const latex of ['iz', '2iz', '-iz', 'i\\exp(z)', 't+i\\exp(z)']) {
      const ce = complexEngine();
      ce.assign('z', ce.number(ce.complex(z.re, z.im)));
      ce.assign('t', t);
      const expected = ce.parse(latex).N();
      for (const [language, Target, main] of [
        [
          'glsl',
          GLSLTarget,
          (code: string) => `vec2 _main(vec2 z, float t) { return ${code}; }`,
        ],
        [
          'wgsl',
          WGSLTarget,
          (code: string) =>
            `fn _main(z: vec2f, t: f32) -> vec2f { return ${code}; }`,
        ],
      ] as const) {
        const r = new Target().compile(complexEngine().parse(latex));
        const run = shaderFunctions(
          `${r.preamble ?? ''}\n${main(r.code)}`,
          language
        );
        const v = run('_main', { x: z.re, y: z.im }, t) as {
          x: number;
          y: number;
        };
        expect([latex, language, v.x]).toEqual([
          latex,
          language,
          expect.closeTo(expected.re, 5),
        ]);
        expect([latex, language, v.y]).toEqual([
          latex,
          language,
          expect.closeTo(expected.im, 5),
        ]);
      }
    }
    // `i·(1 + 2i)` is `−2 + i`.
    const r = new GLSLTarget().compile(complexEngine().parse('iz'));
    const run = shaderFunctions(
      `${r.preamble ?? ''}\nvec2 _main(vec2 z) { return ${r.code}; }`,
      'glsl'
    );
    expect(run('_main', { x: 1, y: 2 })).toEqual({ x: -2, y: 1 });
  });
});
