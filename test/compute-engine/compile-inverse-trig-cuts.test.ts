/**
 * The compiled inverse trigonometric and inverse hyperbolic functions of a
 * complex argument on the GLSL target agree with the
 * interpreter: the same value, and the same side of each branch cut.
 *
 * GPU: the helpers `_gpu_casin` and the others (`compilation/gpu-target.ts`)
 * used the textbook logarithm formulas in f32, and gave `asin(1000)` a real
 * part of 1.66 instead of π/2, `asin(10⁴)` a real part of π, `asinh(−10⁴)`
 * the value −∞, `acosh(−1.5)` a negative real part, and the other side of
 * the cut for `asin(1.5)` (`π/2 + 0.962i` instead of `π/2 − 0.962i`). They
 * now use the formulas of W. Kahan, as the interpreter does. Shader text
 * cannot run under jest: `gpu-shader-f32-eval.ts` runs the EMITTED shader
 * text with every operation rounded to f32.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { shaderFunctions } from './gpu-shader-f32-eval';
import * as fs from 'fs';
import * as path from 'path';

const ce = new ComputeEngine();
ce.declare('z', 'complex');
ce.declare('L', 'list<complex>');

/** The interpreter's value of `head(x + iy)`. */
function reference(head: string, x: number, y: number): [number, number] {
  const v = ce.function(head, [ce.number(ce.complex(x, y))]).N();
  return [v.re, v.im];
}

describe('GPU: inverse trigonometric functions of a complex argument', () => {
  const HEADS = [
    'Arcsin',
    'Arccos',
    'Arctan',
    'Arsinh',
    'Arcosh',
    'Artanh',
    'Arccsc',
    'Arcsec',
    'Arsech',
    'Arcoth',
  ];

  // |z| in {0.5, 1.5, 10, 10⁴, 10¹⁰, 10³⁰} at several angles, the points
  // exactly on the axes (where the cuts are), and points with a small part.
  const POINTS: [number, number][] = [];
  for (const m of [0.5, 1.5, 10, 1e4, 1e10, 1e30]) {
    POINTS.push([m, 0], [-m, 0], [0, m], [0, -m]);
    for (const a of [0.3, 1, 2, -0.4, -2.5])
      POINTS.push([m * Math.cos(a), m * Math.sin(a)]);
  }
  for (const m of [0.5, 1.5, 10, 1e4])
    for (const s of [1e-6, -1e-6, 1e-20])
      POINTS.push([m, s], [-m, s], [s, m], [s, -m]);
  POINTS.push([0, 1e-6], [1e-6, 0], [0, 2], [0, -2], [3e38, 0], [0, 3e38]);
  // Next to the branch points ±1 and ±i. `Arccsc`, `Arcsec`, `Arsech` and
  // `Arcoth` computed `w = 1/z` and then the function of `w`: the rounding of
  // `1/z` was amplified there (`arcsec(−1 + 10⁻⁴i)` had a relative error of
  // `5·10⁻⁵`, `arcoth(−1 + 10⁻⁴i)` of `6·10⁻⁵`).
  for (const s of [1, -1])
    for (const d of [1e-3, -1e-3, 1e-5, -1e-5])
      POINTS.push([s + d, 0], [s, d], [s + d, d]);
  POINTS.push([-1, 1e-4], [1, 1e-6], [0, 1], [0, -1]);
  for (const a of [1e-3, -1e-3])
    for (const b of [1, -1]) POINTS.push([a, b], [0, b + a]);
  // A small modulus.
  POINTS.push([1e-30, 0], [0, 1e-30], [-1e-30, 1e-30]);
  // A subnormal modulus: `1/z` overflows, and `Arccsc`, `Arcsec` and
  // `Arsech` use their expansion at `1/z = ∞` (`arsech(10⁻⁴⁰)` is 92.80, it
  // was NaN). A GPU that flushes a subnormal input to zero computes the
  // value at 0 instead.
  POINTS.push([1e-40, 0], [-1e-40, 0], [0, 1e-40], [1e-40, -1e-40]);

  for (const [language, Target, fn] of [
    [
      'glsl',
      GLSLTarget,
      (code: string) => `vec2 _main(vec2 z) { return ${code}; }`,
    ],
  ] as const)
    for (const head of HEADS)
      it(`${language}: ${head}(z) agrees with the interpreter in f32`, () => {
        const r = new Target().compile(ce.function(head, ['z']));
        const run = shaderFunctions(`${r.preamble}\n${fn(r.code)}`, language);
        const failures: string[] = [];
        for (const [x0, y0] of POINTS) {
          const x = Math.fround(x0);
          const y = Math.fround(y0);
          const [re, im] = reference(head, x, y);
          if (!Number.isFinite(re) || !Number.isFinite(im)) continue;
          const v = run('_main', { x, y }) as { x: number; y: number };
          // A relative error of 1e-6 (about 8 units in the last place of an
          // f32) in each part. A part below the f32 normal range
          // (1.2·10⁻³⁸) cannot be represented and is 0 or subnormal.
          const close = (a: number, b: number) =>
            Math.abs(a - b) <= 1e-6 * Math.abs(b) ||
            (Math.abs(b) < 1e-37 && Math.abs(a) < 1e-37);
          if (!close(v.x, re) || !close(v.y, im))
            failures.push(
              `${head}(${x} + ${y}i): ${v.x} + ${v.y}i, expected ${re} + ${im}i`
            );
        }
        expect(failures).toEqual([]);
      });

  // The interpreter's `arsech 0` is `+∞` (the loop above skips a value that
  // is not finite); it was NaN.
  for (const [language, Target] of [['glsl', GLSLTarget]] as const)
    it(`${language}: Arsech(0) is +∞`, () => {
      const r = new Target().compile(ce.function('Arsech', ['z']));
      const main = `vec2 _main(vec2 z) { return ${r.code}; }`;
      const run = shaderFunctions(`${r.preamble}\n${main}`, language);
      expect(run('_main', { x: 0, y: 0 })).toEqual({ x: Infinity, y: 0 });
      expect(reference('Arsech', 0, 0)).toEqual([Infinity, 0]);
    });

  it('the values of the report', () => {
    const run = shaderFunctions(
      new GLSLTarget().compile(
        ce.function('Add', [
          ce.function('Arcsin', ['z']),
          ce.function('Arcosh', ['z']),
          ce.function('Arsinh', ['z']),
          ce.function('Artanh', ['z']),
        ])
      ).preamble,
      'glsl'
    );
    const at = (f: string, x: number, y = 0) =>
      run(f, { x, y }) as { x: number; y: number };
    // The real part was 1.66, and π for 10⁴.
    expect(at('_gpu_casin', 1000).x).toBeCloseTo(Math.PI / 2, 6);
    expect(at('_gpu_casin', 1e4).x).toBeCloseTo(Math.PI / 2, 6);
    // The side below the cut for x > 1: the imaginary part was +0.962.
    expect(at('_gpu_casin', 1.5).y).toBeCloseTo(-0.9624236501192069, 6);
    // It was −∞.
    expect(at('_gpu_casinh', -1e4).x).toBeCloseTo(-9.903487555036127, 5);
    // The real part of acosh is never negative: it was −0.962.
    expect(at('_gpu_cacosh', -1.5).x).toBeCloseTo(0.9624236501192069, 6);
    // It was NaN.
    expect(at('_gpu_catanh', 1e20).x).toBeCloseTo(1e-20, 26);
  });
});

// `arctan` and `arccot` are odd on their cuts (the imaginary axis outside
// and inside [−i, i]): each half of a cut takes the side it is continuous
// with, as in mpmath. Before, both halves took the side right of the axis,
// and `arctan(−2i)` was `π/2 − 0.549i`. `[head, y, re, im]`: the value of
// `head(iy)` from `mpmath.atan` and `mpmath.acot`.
const ODD_ON_CUT: [string, number, number, number][] = [
  ['Arctan', 2, 1.5707963267948966, 0.54930614433405485],
  ['Arctan', -2, -1.5707963267948966, -0.54930614433405485],
  ['Arctan', -10, -1.5707963267948966, -0.10033534773107558],
  ['Arctan', -1e20, -1.5707963267948966, -1e-20],
  ['Arccot', 0.5, -1.5707963267948966, -0.54930614433405485],
  ['Arccot', -0.5, 1.5707963267948966, 0.54930614433405485],
];

describe('GPU: arctan is odd on its branch cut', () => {
  // The shader targets have no complex `Arccot` (it is in
  // `GPU_REAL_ONLY_LOWERINGS`, `compilation/gpu-target.ts`).
  for (const [language, Target, fn] of [
    [
      'glsl',
      GLSLTarget,
      (code: string) => `vec2 _main(vec2 z) { return ${code}; }`,
    ],
  ] as const)
    it(`${language}: the value of mpmath on each half of the cut`, () => {
      const r = new Target().compile(ce.function('Arctan', ['z']));
      const run = shaderFunctions(`${r.preamble}\n${fn(r.code)}`, language);
      for (const [head, y, re, im] of ODD_ON_CUT) {
        if (head !== 'Arctan') continue;
        const v = run('_main', { x: 0, y }) as { x: number; y: number };
        expect(v.x).toBeCloseTo(re, 6);
        expect(v.y).toBeCloseTo(im, 6);
      }
    });
});

describe('GPU: the language checks of the f32 shader interpreter', () => {
  const REJECTED: [string, 'glsl', string][] = [
    ['float f(float x) { return 2 * x; }', 'glsl', 'integer literal'],
    [
      'float f(float x) { return g(x); }\nfloat g(float x) { return x; }',
      'glsl',
      'order',
    ],
    ['float f(float x) { let y = x; return y; }', 'glsl', 'let'],
    ['float f(float x) { return atan2(x, 1.0); }', 'glsl', 'atan2'],
  ];
  for (const [src, language, what] of REJECTED)
    it(`${language}: rejects ${what}`, () => {
      expect(() => shaderFunctions(src, language)).toThrow();
    });

  it('accepts the same functions written by the rules', () => {
    expect(() =>
      shaderFunctions(
        'float g(float x) { return x; }\nfloat f(float x) { return x > 0.0 ? g(x) : atan(x, 1.0); }',
        'glsl'
      )
    ).not.toThrow();
  });
});
