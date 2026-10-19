/**
 * `e^{iπx}` and `Exp(iπx)` with a symbol `x` that has no declared type
 * compile with the angle `x` in half-turns, reduced exactly, as when `x` is
 * declared `real`, and as the hyperbolic functions of `iπx` compile with an
 * undeclared `x`. So the value at an integer or a half-integer `x` has an
 * exact zero part and exact units: `e^{iπx}` at `x = 1` is `−1`, where the
 * complex kernel gave `−1 + 1.2·10⁻¹⁶i`.
 *
 * `e^{−iπx}` gets the same lowering: the factor `−1` of the exponent is a
 * `Negate` after canonicalization, and the angle is `−x`.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { shaderFunctions } from './gpu-shader-f32-eval';
import { TEST_PYTHON } from './test-python';
import { execFileSync } from 'child_process';

const iPiX = (scale: any, x: any) => [
  'Multiply',
  scale,
  'ImaginaryUnit',
  'Pi',
  x,
];

/** [name, MathJSON of the expression in `x` (and `y`)]. */
const CASES: [string, (x: any) => any][] = [
  ['e^{iπx}', (x) => ['Power', 'ExponentialE', iPiX(1, x)]],
  ['Exp(iπx)', (x) => ['Exp', iPiX(1, x)]],
  ['e^{−iπx}', (x) => ['Power', 'ExponentialE', iPiX(-1, x)]],
  ['e^{2iπx}', (x) => ['Exp', iPiX(2, x)]],
  ['e^{iπx/2}', (x) => ['Exp', iPiX(['Rational', 1, 2], x)]],
  ['e^{y + iπx}', (x) => ['Exp', ['Add', 'y', iPiX(1, x)]]],
];

/** [x, x as an exact rational p/q]. */
const POINTS: [number, [number, number]][] = [
  [0, [0, 1]],
  [1, [1, 1]],
  [2, [2, 1]],
  [0.5, [1, 2]],
  [1.5, [3, 2]],
  [-3, [-3, 1]],
  [-0.5, [-1, 2]],
  [0.25, [1, 4]],
];

/** The interpreter's value at the exact `x`, with `y = 0`. */
function interpreted(
  ce: ComputeEngine,
  make: (x: any) => any,
  [p, q]: [number, number]
): { re: number; im: number } {
  const v = ce
    .box(make(['Rational', p, q]))
    .subs({ y: 0 })
    .N();
  return { re: v.re, im: v.im };
}

/** A zero part exactly zero, a unit exactly a unit, other parts within a
 * relative error of `tol`. */
function same(
  a: { re: number; im: number },
  b: { re: number; im: number },
  tol = 4e-16
) {
  const close = (u: number, v: number) =>
    v === 0 || Math.abs(v) === 1
      ? Object.is(u, v)
      : Math.abs(u - v) <= tol * Math.abs(v);
  return close(a.re, b.re) && close(a.im, b.im);
}

describe('JAVASCRIPT: e^{iπx} WITH x UNDECLARED', () => {
  for (const declared of [false, true])
    for (const [name, make] of CASES)
      test(`${name}, x ${declared ? 'real' : 'undeclared'}`, () => {
        const ce = new ComputeEngine();
        if (declared) ce.declare('x', 'real');
        const c = compile(ce.box(make('x')), { fallback: false }) as any;
        expect(c.success).toBe(true);
        expect(c.code).toContain('_SYS.cexppi(');
        for (const [x, exact] of POINTS) {
          const out = c.run({ x, y: 0 }) as number | { re: number; im: number };
          const v = typeof out === 'number' ? { re: out, im: 0 } : out;
          const i = interpreted(ce, make, exact);
          expect([x, v, same(v, i)]).toEqual([x, v, true]);
        }
      });

  test('the reported value: e^{iπx} at x = 1 is −1', () => {
    const ce = new ComputeEngine();
    const c = compile(ce.parse('e^{i\\pi x}'), { fallback: false }) as any;
    expect(c.run({ x: 1 })).toBe(-1);
    expect(c.run({ x: 0.5 })).toEqual({ re: 0, im: 1 });
  });

  test('a complex x keeps the complex kernel', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const c = compile(ce.parse('e^{i\\pi z}'), { fallback: false }) as any;
    expect(c.code).not.toContain('cexppi');
  });
});

describe('PYTHON: e^{iπx} WITH x UNDECLARED', () => {
  (TEST_PYTHON === undefined ? it.skip : it)(
    'each case agrees with the interpreter',
    () => {
      const ce = new ComputeEngine();
      const py = new PythonTarget({ includeImports: true });
      let program = '';
      CASES.forEach(([, make], k) => {
        program += py.compileFunction(ce.box(make('x')), `f${k}`, ['x', 'y']);
        program += '\n';
      });
      program += 'import json\nout = []\n';
      program += `for x in ${JSON.stringify(POINTS.map(([x]) => x))}:\n`;
      CASES.forEach((_, k) => {
        program += `  r = complex(f${k}(float(x), 0.0))\n  out.append([r.real, r.imag])\n`;
      });
      program += 'print(json.dumps(out))\n';
      const values = JSON.parse(
        execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
      ) as [number, number][];
      const failures: string[] = [];
      let n = 0;
      for (const [x, exact] of POINTS)
        for (const [name, make] of CASES) {
          const [re, im] = values[n++];
          const i = interpreted(ce, make, exact);
          if (!same({ re, im }, i))
            failures.push(
              `${name} at ${x}: ${re} + ${im}i, expected ${i.re} + ${i.im}i`
            );
        }
      expect(failures).toEqual([]);
    }
  );
});

describe('GPU: e^{iπx} WITH x UNDECLARED', () => {
  for (const [language, Target] of [
    ['glsl', GLSLTarget],
    ['wgsl', WGSLTarget],
  ] as const)
    test(`${language}: an integer or a half-integer x has exact parts`, () => {
      const ce = new ComputeEngine();
      for (const [name, make] of CASES) {
        const r = new Target().compile(ce.box(make('x')));
        expect([name, r.code.includes('_gpu_cossinpi(')]).toEqual([name, true]);
        const main =
          language === 'glsl'
            ? `vec2 _main(float x, float y) { return ${r.code}; }`
            : `fn _main(x: f32, y: f32) -> vec2f { return ${r.code}; }`;
        const run = shaderFunctions(`${r.preamble ?? ''}\n${main}`, language);
        for (const [x, exact] of POINTS) {
          if (x === 0.25) continue;
          const v = run('_main', x, 0) as { x: number; y: number };
          const i = interpreted(ce, make, exact);
          // A part that is not zero or a unit is an f32.
          expect([name, x, same({ re: v.x, im: v.y }, i, 1e-7)]).toEqual([
            name,
            x,
            true,
          ]);
        }
      }
    });
});
