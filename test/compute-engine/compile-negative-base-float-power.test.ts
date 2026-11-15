/**
 * A negative real base under a FLOAT exponent. The interpreter recovers the
 * rational `p/q` that the double came from (`realPowerBranchTerms()`,
 * `boxed-expression/arithmetic-power.ts`): when `q` is odd the value is the
 * real root `±|x|^e`, negative when `p` is odd (`(−8)^{0.4}` is `2.297`,
 * `(−8)^{0.3333333333333333}` is `−2`), and otherwise the principal complex
 * value (`(−8)^{0.25}` is `1.189 + 1.189i`). The compiled code follows the
 * same rule on every target that can decide it:
 * - JavaScript at run time (`_SYS.pow`, `_SYS.cpow`);
 * - GLSL for a constant exponent, when the code is generated. A shader
 *   cannot decide it for a variable exponent, which it holds as an f32, and
 *   keeps `pow`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { shaderFunctions } from './gpu-shader-f32-eval';

// [base, exponent]
const POINTS: [number, number][] = [
  [-8, 0.3333333333333333],
  [-8, 0.4],
  [-8, 0.25],
  [-8, 5 / 3],
  [-2, 1.5],
  [-1, 0.5],
  [-3, Math.SQRT2],
  [2, 0.5],
  [-2, 3],
];

function interpreted(
  ce: ComputeEngine,
  x: number,
  y: number
): { re: number; im: number } {
  const v = ce
    .function('Power', [ce.number(x), ce.number(y)], { form: 'structural' })
    .N();
  return { re: v.re, im: v.im };
}

function close(a: number, b: number, tolerance = 4e-16): boolean {
  return (
    a === b ||
    (Number.isNaN(a) && Number.isNaN(b)) ||
    Math.abs(a - b) <= tolerance * Math.abs(b)
  );
}

describe('JavaScript', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('z', 'complex');
  ce.declare('w', 'complex');

  test.each(POINTS)('real lane: x^y at (%p, %p)', (x, y) => {
    const out = compile(ce.box(['Power', 'x', 'y']), { fallback: false }).run!({
      x,
      y,
    }) as number;
    const i = interpreted(ce, x, y);
    // The real lane has no value where the interpreter's is complex.
    if (i.im !== 0) expect(out).toBeNaN();
    else expect(close(out, i.re)).toBe(true);
  });

  test.each(POINTS)('complex lane: z^w at (%p, %p)', (x, y) => {
    const out = compile(ce.box(['Power', 'z', 'w']), { fallback: false }).run!({
      z: { re: x, im: 0 },
      w: { re: y, im: 0 },
    }) as number | { re: number; im: number };
    const c = typeof out === 'number' ? { re: out, im: 0 } : out;
    const i = interpreted(ce, x, y);
    expect([c.re === 0, c.im === 0]).toEqual([i.re === 0, i.im === 0]);
    expect(close(c.re, i.re) && close(c.im, i.im)).toBe(true);
  });
});

describe('GLSL', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('z', 'complex');

  for (const [language, Target] of [['glsl', GLSLTarget]] as const) {
    it(`${language}: x^0.4 and x^0.3333333333333333 (real lane)`, () => {
      for (const e of [0.4, 0.3333333333333333]) {
        const r = new Target().compile(ce.box(['Power', 'x', e]));
        const main = `float _main(float x) { return ${r.code}; }`;
        const run = shaderFunctions(`${r.preamble ?? ''}\n${main}`, language);
        for (const x of [-8, 8, -0.001]) {
          const v = run('_main', Math.fround(x)) as number;
          const i = interpreted(ce, x, e);
          expect(i.im).toBe(0);
          expect(close(v, i.re, 1e-6)).toBe(true);
        }
      }
    });

    it(`${language}: z^0.4 (complex lane)`, () => {
      const r = new Target().compile(ce.box(['Power', 'z', 0.4]));
      expect(r.code).toContain('_gpu_cpowrr(');
      const main = `vec2 _main(vec2 z) { return ${r.code}; }`;
      const run = shaderFunctions(`${r.preamble}\n${main}`, language);
      for (const [x, y] of [
        [-8, 0],
        [8, 0],
        [-8, 1],
      ]) {
        const v = run('_main', { x, y }) as { x: number; y: number };
        const i = ce
          .function('Power', [ce.number(ce.complex(x, y)), ce.number(0.4)], {
            form: 'structural',
          })
          .N();
        expect(close(v.x, i.re, 1e-5)).toBe(true);
        expect(close(v.y, i.im, 1e-5)).toBe(true);
      }
    });

    it(`${language}: a variable exponent keeps \`pow\``, () => {
      expect(new Target().compile(ce.box(['Power', 'x', 'y'])).code).toBe(
        'pow(x, y)'
      );
    });
  }
});

describe('the complex power at a large integer exponent', () => {
  // Repeated squaring is used only for |n| ≤ 64: past that, the rounding
  // error of each product grows with the number of products after it, and
  // `(1 + 10⁻⁹i)^(10⁹)` had a relative error of 10⁻⁹. Values of mpmath at
  // 40 digits, for the double inputs.
  const ce = new ComputeEngine();
  ce.declare('z', 'complex');
  ce.declare('w', 'complex');
  test.each([
    [1e-9, 1e9, 0.54030230613829082, 0.84147098522863203],
    [1e-17, 1e17, 0.54030230586813966, 0.84147098480789655],
  ])('(1 + %pi)^%p', (eps, n, expRe, expIm) => {
    const out = compile(ce.box(['Power', 'z', 'w']), { fallback: false }).run!({
      z: { re: 1, im: eps },
      w: { re: n, im: 0 },
    }) as { re: number; im: number };
    expect(close(out.re, expRe, 1e-15)).toBe(true);
    expect(close(out.im, expIm, 1e-15)).toBe(true);
  });
});
