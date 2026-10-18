/**
 * `Sinh`, `Cosh`, `Tanh`, `Csch`, `Sech` and `Coth` of `i·π·u` compile with
 * the angle `u` in half-turns, reduced exactly: `sinh(iθ) = i·sin θ` and
 * `cosh(iθ) = cos θ`. At an integer or a half-integer `u`, a zero is exact
 * and a pole is the compiled spelling of the interpreter's `~oo`
 * (`{re: ∞, im: ∞}`). The complex kernel computed `1/(i·sin(π))` with
 * `sin(π)` as the double `1.2·10⁻¹⁶`, and gave `{re: NaN, im: ∞}` for
 * `Csch(iπx)` at `x = 1`.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { shaderFunctions } from './gpu-shader-f32-eval';
import { TEST_PYTHON } from './test-python';
import { execFileSync } from 'child_process';

const ce = new ComputeEngine();

const HEADS = ['Sinh', 'Cosh', 'Tanh', 'Csch', 'Sech', 'Coth'];
/** Integers and half-integers, where a part is zero or the value a pole. */
const EXACT_POINTS = [0, 0.5, 1, 1.5, 2, -1, -0.5, 7];
/** Points with no zero part. */
const GENERIC_POINTS = [0.3, -0.7, 2.7];

const arg = (u: any) => ['Multiply', 'ImaginaryUnit', 'Pi', u];

/** The interpreter's value at `u`, read with an exact `u` at an integer or
 * a half-integer, as `[re, im]`. A pole (`~oo`) is `[∞, ∞]`. */
function reference(head: string, u: number): [number, number] {
  const exact = Number.isInteger(2 * u) ? ['Rational', 2 * u, 2] : u;
  const v = ce.box([head, arg(exact)] as any).N();
  if (v.isInfinity === true) return [Infinity, Infinity];
  return [v.re, v.im];
}

/** A finite part within a relative error of `tol` (or an absolute one near
 * zero); a zero part exactly zero; an infinity exactly. */
function same(a: number, b: number, tol: number): boolean {
  if (b === 0) return a === 0;
  if (!Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= tol * Math.abs(b);
}

function parts(v: unknown): [number, number] {
  if (typeof v === 'number') return [v, 0];
  const z = v as { re: number; im: number };
  return [z.re, z.im];
}

describe('JAVASCRIPT: HYPERBOLIC FUNCTIONS OF iπu', () => {
  for (const declared of [false, true]) {
    const engine = new ComputeEngine();
    if (declared) engine.declare('x', 'real');
    for (const head of HEADS)
      test(`${head}(iπx), x ${declared ? 'real' : 'undeclared'}`, () => {
        const c = compile(engine.box([head, arg('x')] as any), {
          fallback: false,
        }) as any;
        expect(c.success).toBe(true);
        for (const u of [...EXACT_POINTS, ...GENERIC_POINTS]) {
          const [re, im] = parts(c.run({ x: u }));
          const [eRe, eIm] = reference(head, u);
          expect([u, same(re, eRe, 1e-14), same(im, eIm, 1e-14)]).toEqual([
            u,
            true,
            true,
          ]);
        }
      });
  }

  test('the reported value: Csch(iπx) at x = 1 is the pole', () => {
    const c = compile(ce.box(['Csch', arg('x')] as any)) as any;
    expect(c.run({ x: 1 })).toEqual({ re: Infinity, im: Infinity });
    expect(ce.box(['Csch', arg(1)] as any).N().toString()).toBe('~oo');
  });

  test('a factor of i other than 1, and a u that is not finite', () => {
    // `Csch(2iπx)` is `Csch(iπ·2x)`: a pole at every half-integer `x`.
    const c = compile(
      ce.box(['Csch', ['Multiply', ['Complex', 0, 2], 'Pi', 'x']] as any)
    ) as any;
    expect(c.run({ x: 0.5 })).toEqual({ re: Infinity, im: Infinity });
    const [, im] = parts(c.run({ x: 0.25 }));
    expect(im).toBeCloseTo(-1, 15);
    const s = compile(ce.box(['Sinh', arg('x')] as any)) as any;
    const v = s.run({ x: NaN }) as { re: number; im: number };
    expect(Number.isNaN(v.re) && Number.isNaN(v.im)).toBe(true);
  });
});

describe('GPU: HYPERBOLIC FUNCTIONS OF iπu', () => {
  const engine = new ComputeEngine();
  engine.declare('x', 'real');
  for (const [language, Target, main] of [
    [
      'glsl',
      GLSLTarget,
      (code: string) => `vec2 _main(float x) { return ${code}; }`,
    ],
    [
      'wgsl',
      WGSLTarget,
      (code: string) => `fn _main(x: f32) -> vec2f { return ${code}; }`,
    ],
  ] as const)
    for (const head of HEADS)
      test(`${language}: ${head}(iπx) agrees with the interpreter in f32`, () => {
        const r = new Target().compile(engine.box([head, arg('x')] as any));
        expect(r.code).toBe(`_gpu_ipi_${head.toLowerCase()}(x)`);
        const run = shaderFunctions(`${r.preamble}\n${main(r.code)}`, language);
        for (const u of [...EXACT_POINTS, ...GENERIC_POINTS]) {
          const v = run('_main', Math.fround(u)) as { x: number; y: number };
          const [eRe, eIm] = reference(head, u);
          expect([u, same(v.x, eRe, 1e-6), same(v.y, eIm, 1e-6)]).toEqual([
            u,
            true,
            true,
          ]);
        }
      });
});

describe('PYTHON: HYPERBOLIC FUNCTIONS OF iπu', () => {
  (TEST_PYTHON === undefined ? it.skip : it)(
    'every head agrees with the interpreter, for a scalar and an array',
    () => {
      const py = new PythonTarget({ includeImports: true });
      const points = [...EXACT_POINTS, ...GENERIC_POINTS];
      let program = '';
      for (const h of HEADS)
        program +=
          py.compileFunction(ce.box([h, arg('x')] as any), `f_${h}`, ['x']) +
          '\n';
      program += 'import json\nout = []\n';
      program += `for h in ${JSON.stringify(HEADS)}:\n`;
      program += `  f = globals()['f_' + h]\n`;
      program += `  out.append([[complex(f(u)).real, complex(f(u)).imag] for u in ${JSON.stringify(points)}])\n`;
      program += `  out.append([[complex(v).real, complex(v).imag] for v in f(np.array(${JSON.stringify(points)}, dtype=float))])\n`;
      program += 'print(json.dumps(out))\n';
      const out = JSON.parse(
        execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
          .replace(/-Infinity/g, '-1e999')
          .replace(/Infinity/g, '1e999')
      );
      HEADS.forEach((h, k) => {
        for (const values of [out[2 * k], out[2 * k + 1]])
          points.forEach((u, i) => {
            const [eRe, eIm] = reference(h, u);
            const [re, im] = values[i];
            expect([h, u, same(re, eRe, 1e-14), same(im, eIm, 1e-14)]).toEqual(
              [h, u, true, true]
            );
          });
      });
    }
  );
});
