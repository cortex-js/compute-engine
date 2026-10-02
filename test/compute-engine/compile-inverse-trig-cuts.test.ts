/**
 * The compiled inverse trigonometric and inverse hyperbolic functions of a
 * complex argument on the GLSL, WGSL and Python targets agree with the
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
 *
 * Python: `cmath` picks the side of a cut from the sign of a zero part, so
 * `cmath.asin(complex(2, 0))` was `π/2 + 1.317i`, and the interpreter gives
 * `π/2 − 1.317i`. The compiled code now gives a zero part the sign that
 * selects the interpreter's side. The Python part runs the emitted code with
 * the repo's `./venv/bin/python3`, and is skipped when that is not
 * available.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { shaderFunctions } from './gpu-shader-f32-eval';
import { execFileSync } from 'child_process';
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
    [
      'wgsl',
      WGSLTarget,
      (code: string) => `fn _main(z: vec2f) -> vec2f { return ${code}; }`,
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
  for (const [language, Target] of [
    ['glsl', GLSLTarget],
    ['wgsl', WGSLTarget],
  ] as const)
    it(`${language}: Arsech(0) is +∞`, () => {
      const r = new Target().compile(ce.function('Arsech', ['z']));
      const main =
        language === 'glsl'
          ? `vec2 _main(vec2 z) { return ${r.code}; }`
          : `fn _main(z: vec2f) -> vec2f { return ${r.code}; }`;
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
    [
      'wgsl',
      WGSLTarget,
      (code: string) => `fn _main(z: vec2f) -> vec2f { return ${code}; }`,
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
  const REJECTED: [string, 'glsl' | 'wgsl', string][] = [
    ['fn f(x: f32) -> f32 { return x > 0.0 ? x : -x; }', 'wgsl', '?:'],
    ['fn f(x: f32) -> f32 { if (x > 0.0) return x; return -x; }', 'wgsl', 'if'],
    ['fn f(x: f32) -> f32 { x = 2.0 * x; return x; }', 'wgsl', 'parameter'],
    ['fn f(x: f32) -> f32 { let y = x; y = 1.0; return y; }', 'wgsl', 'let'],
    ['fn f(x: f32) -> f32 { return atan(x, 1.0); }', 'wgsl', 'atan'],
    ['fn f(x: f32) -> f32 { return 2 * x; }', 'wgsl', 'integer literal'],
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
        'fn f(x: f32) -> f32 { var y = x; if (y < 0.0) { y = -y; } return select(y, 2.0 * y, y > 1.0); }',
        'wgsl'
      )
    ).not.toThrow();
    expect(() =>
      shaderFunctions(
        'float g(float x) { return x; }\nfloat f(float x) { return x > 0.0 ? g(x) : atan(x, 1.0); }',
        'glsl'
      )
    ).not.toThrow();
  });
});

// The Python with NumPy: `CE_PYTHON` when it is set (a git worktree has no
// `venv` of its own), else the repo's `./venv/bin/python3`.
const VENV_PYTHON = [
  process.env.CE_PYTHON,
  path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
  path.join(process.cwd(), 'venv', 'bin', 'python3'),
].find((p) => p !== undefined && p !== '' && fs.existsSync(p));

describe('PYTHON: inverse trigonometric functions of a complex argument', () => {
  const HEADS = [
    'Arcsin',
    'Arccos',
    'Arctan',
    'Arsinh',
    'Arcosh',
    'Artanh',
    'Arccsc',
    'Arcsec',
    'Arccot',
    'Arcsch',
    'Arsech',
    'Arcoth',
  ];

  // On each cut (the real axis and the imaginary axis), on both sides of it,
  // at the branch points, at a large and a tiny modulus, and off the axes.
  const POINTS: [number, number][] = [];
  for (const v of [0.5, 1, 1.5, 2, 10, 1e6, 1e200])
    for (const s of [1, -1])
      for (const e of [0, 1e-12, -1e-12]) POINTS.push([s * v, e], [e, s * v]);
  POINTS.push([0.3, 0.4], [-2, 1], [-1, 1], [1, -2], [-0.5, -0.25]);
  POINTS.push([1e-300, 0], [0, -1e-300], [1e200, 1e-12], [-1e200, 1e-12]);
  POINTS.push([0, 0]);

  // The points where the compiled value differs from the interpreter's on
  // purpose. The poles of `arccot` (±i): the interpreter gives the unsigned
  // infinity `~oo`, held with the parts `0 ∓ ∞i`; the compiled code spells
  // `~oo` as `∞ + ∞i`, which is also the parts of the interpreter's `~oo` at
  // the poles of `atan`.
  // `z = 0`: the interpreter gives `NaN` (with a zero imaginary part) for
  // `Arccsc` and `Arcsec`, and `~oo` for `Arcsch`; the compiled code answers
  // `nan + nan·i`.
  const OVERRIDES: Record<string, [number, number]> = {
    'Arccot(0, 1)': [Infinity, Infinity],
    'Arccot(0, -1)': [Infinity, Infinity],
    'Arccsc(0, 0)': [NaN, NaN],
    'Arcsec(0, 0)': [NaN, NaN],
    'Arcsch(0, 0)': [NaN, NaN],
  };
  const expected = (h: string, x: number, y: number): [number, number] =>
    OVERRIDES[`${h}(${x}, ${y})`] ?? reference(h, x, y);

  function run(program: string): any {
    const out = execFileSync(VENV_PYTHON!, ['-c', program], {
      encoding: 'utf8',
    });
    return JSON.parse(
      out
        .replace(/-Infinity/g, '-1e999')
        .replace(/Infinity/g, '1e999')
        .replace(/NaN/g, 'null')
    );
  }

  // A finite value within a relative error of 1e-12; a NaN or an infinity
  // exactly.
  const same = (a: number | null, b: number) =>
    a === null
      ? Number.isNaN(b)
      : Number.isFinite(b)
        ? Math.abs(a - b) <= 1e-12 * Math.abs(b)
        : a === b;

  (VENV_PYTHON === undefined ? it.skip : it)(
    'every head agrees with the interpreter, on each side of each cut',
    () => {
      const py = new PythonTarget({ includeImports: true });
      let program = '';
      for (const h of HEADS)
        program +=
          py.compileFunction(ce.function(h, ['z']), `f_${h}`, ['z']) + '\n';
      program += 'import json\nout = []\n';
      program += `for h in ${JSON.stringify(HEADS)}:\n`;
      program += `  for (x, y) in ${JSON.stringify(POINTS)}:\n`;
      program += `    r = complex(globals()['f_' + h](complex(x, y)))\n`;
      program += `    out.append([r.real, r.imag])\n`;
      program += 'print(json.dumps(out))\n';
      const values = run(program);
      const failures: string[] = [];
      let i = 0;
      for (const h of HEADS)
        for (const [x, y] of POINTS) {
          const [re, im] = values[i++];
          const [er, ei] = expected(h, x, y);
          if (!same(re, er) || !same(im, ei))
            failures.push(
              `${h}(${x} + ${y}i): ${re} + ${im}i, expected ${er} + ${ei}i`
            );
        }
      expect(failures).toEqual([]);
    }
  );

  (VENV_PYTHON === undefined ? it.skip : it)(
    'arctan and arccot have the value of mpmath on each half of their cut',
    () => {
      const py = new PythonTarget({ includeImports: true });
      let program = '';
      for (const h of ['Arctan', 'Arccot'])
        program +=
          py.compileFunction(ce.function(h, ['z']), `f_${h}`, ['z']) + '\n';
      program += 'import json\nout = []\n';
      program += `for (h, y) in ${JSON.stringify(ODD_ON_CUT.map(([h, y]) => [h, y]))}:\n`;
      program += `  r = complex(globals()['f_' + h](complex(0, y)))\n`;
      program += `  out.append([r.real, r.imag])\n`;
      program += 'print(json.dumps(out))\n';
      const values = run(program);
      ODD_ON_CUT.forEach(([, , re, im], k) => {
        expect(same(values[k][0], re)).toBe(true);
        expect(same(values[k][1], im)).toBe(true);
      });
    }
  );

  (VENV_PYTHON === undefined ? it.skip : it)(
    'a list of complex values takes the same code on each element',
    () => {
      const py = new PythonTarget({ includeImports: true });
      const xs: [number, number][] = [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
        [-1, 1],
        [0, 0],
      ];
      let program = '';
      for (const h of HEADS)
        program +=
          py.compileFunction(ce.function(h, ['L']), `f_${h}`, ['L']) + '\n';
      program += 'import json\nout = []\n';
      program += `L = [complex(x, y) for (x, y) in ${JSON.stringify(xs)}]\n`;
      program += `for h in ${JSON.stringify(HEADS)}:\n`;
      program += `  out.append([[complex(r).real, complex(r).imag] for r in globals()['f_' + h](L)])\n`;
      program += 'print(json.dumps(out))\n';
      const values = run(program);
      const failures: string[] = [];
      HEADS.forEach((h, k) =>
        xs.forEach(([x, y], j) => {
          const [re, im] = values[k][j];
          const [er, ei] = expected(h, x, y);
          if (!same(re, er) || !same(im, ei))
            failures.push(
              `${h}(${x} + ${y}i): ${re} + ${im}i, expected ${er} + ${ei}i`
            );
        })
      );
      expect(failures).toEqual([]);
    }
  );
});
