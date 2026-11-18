/**
 * The sine hash on the shader targets (`compilation/gpu-exact-trig.ts`).
 *
 * `Mod(u, 1)` whose operand is a sine or a cosine amplified by a constant of
 * magnitude ≥ 1000 has no float32 value related to its exact value. On GLSL,
 * the shapes `O·sin(Σ K·x + c)` (or `cos`, or with a `Dot`) compile to exact
 * arithmetic built from float32, and the result lists the bound of each
 * operand (`float32Bounds`); every other flagged operand keeps the usual
 * float32 code and the result has a warning
 * (`warnings`, code `float32-unsafe-argument`). User decision 2026-10-18: a
 * decline moved Tycho's 2-D noise fields to the CPU at up to 2.7 s per zoom.
 *
 * The values cannot be checked here: the exact form depends on `uint`
 * arithmetic, and on a GPU compiler that reorders float arithmetic, which no
 * jest interpreter reproduces. The emitted code was run in WebGL2 on
 * 2026-10-18, on an Apple M5 Max (ANGLE on Metal) and on SwiftShader, at
 * 4,096 inputs per shape: every shape matched the float64 value within 10⁻³
 * (maximum error 9.5·10⁻⁵ to 6.3·10⁻⁴, including B and C across their whole
 * bound), and every input beyond the bound gave NaN. Details in the ROADMAP
 * entry for Tycho ledger rows 382 and 384.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
  for (const s of ['x', 'y', 'z']) ce.declare(s, 'real');
  ce.declare('p', 'tuple<real, real, real>');
});

function glsl(e: unknown) {
  const expr = typeof e === 'string' ? ce.parse(e) : ce.box(e as any);
  return compile(expr, { to: 'glsl', fallback: true });
}

describe('a warning where no exact form exists', () => {
  // The usual float32 code, a successful result, and the warning.
  const warned = (r: ReturnType<typeof glsl>) => {
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_gpu_xhash');
    expect(r.float32Bounds).toBe(undefined);
    expect(r.warnings?.map((w) => [w.code, w.kind])).toEqual([
      ['float32-unsafe-argument', 'correctness'],
    ]);
  };

  test('each warning names its operand, once', () => {
    const r = glsl(
      '\\operatorname{mod}(43758.5453\\tan(y),1)+\\operatorname{mod}(43758.5453\\sin(x^2),1)+\\operatorname{mod}(43758.5453\\tan(y),1)'
    );
    expect(r.warnings?.map((w) => w.value).sort()).toEqual([
      '43758.5453 * sin(x^2)',
      '43758.5453 * tan(y)',
    ]);
  });

  test('GLSL: another shape', () => {
    // tan, a divisor other than 1, and an outer factor that is not a number.
    warned(glsl('\\operatorname{mod}(10^4\\tan(x),1)'));
    warned(glsl('\\operatorname{mod}(10^4\\sin(10^4x),2)'));
    warned(glsl('\\operatorname{mod}(10^4y\\sin(x),1)'));
    // A divisor of magnitude ≤ 10⁻³, and a factor that is not a literal.
    warned(glsl(['Mod', ['Divide', ['Sin', 'x'], 0.0001], 1]));
    warned(glsl(['Mod', ['Multiply', ['Sin', 'x'], ['Power', 10, 40]], 1]));
    // An outer factor above 5·10^4.
    warned(
      glsl(['Mod', ['Multiply', 1.9e9, ['Sin', ['Multiply', 10000, 'x']]], 1])
    );
  });
});
