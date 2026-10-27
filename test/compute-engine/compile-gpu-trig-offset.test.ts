/**
 * The shader targets reduce a constant term of a trigonometric argument by
 * whole periods at compile time (`gpuReduceTrigOffset`,
 * `compilation/gpu-target.ts`).
 *
 * A shader computes in float32. In `sin(x + 10^6)` the sum `x + 10^6` is
 * rounded to a multiple of 1/16 before `sin` reads it, so the value is off by
 * up to 0.03 for every `x`. `10^6 − 2π·159155 ≈ −0.3576`, so the emitted
 * code is `sin(x + -0.35756418)`, and `x` keeps its own precision.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';

const TARGETS = [
  ['glsl', GLSLTarget],
  ['wgsl', WGSLTarget],
] as const;

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
  ce.declare('x', 'real');
});

function code(latex: string, Target: typeof GLSLTarget | typeof WGSLTarget) {
  return new Target().compile(ce.parse(latex)).code;
}

describe('the emitted argument', () => {
  test.each(TARGETS)('%s', (_, Target) => {
    expect(code('\\sin(x+10^6)', Target)).toBe('_gpu_sin(x + -0.35756418)');
    expect(code('\\cos(x-10^6)', Target)).toBe('_gpu_cos(x + 0.35756418)');
    // tan has the period π.
    expect(code('\\tan(x+10^6)', Target)).toBe('tan(x + -0.35756418)');
    expect(code('\\sec(x+10^6)', Target)).toBe(
      '(1.0 / _gpu_cos(x + -0.35756418))'
    );
    expect(code('\\csc(x+10^6)', Target)).toBe(
      '(1.0 / _gpu_sin(x + -0.35756418))'
    );
    expect(code('\\cot(x+10^6)', Target)).toBe(
      '(_gpu_cos(x + -0.35756418) / _gpu_sin(x + -0.35756418))'
    );
    // `k·(u + c)` reduces `c` by `P/k`.
    expect(code('\\sin(2(x+10^6))', Target)).toBe(
      '_gpu_sin(2.0 * (x + -0.35756418))'
    );
    // `e^{iπu}` reduces `u` by 2.
    expect(code('e^{i\\pi(x+10^6)}', Target)).toBe('_gpu_cossinpi(x)');
    // A whole number of periods disappears.
    expect(code('\\sin(x+10^6\\pi)', Target)).toBe('_gpu_sin(x)');
    // The half-turn helpers reduce their argument by 2 (sin, cos) or 1 (tan).
    expect(code('\\sin(\\pi(x+10^6))', Target)).toBe('_gpu_sinpi(x)');
    expect(code('\\tan(\\pi(x+10^6+\\frac{1}{4}))', Target)).toBe(
      '_gpu_tanpi(x + 0.25)'
    );
    // An offset already within half a period is left as written.
    expect(code('\\sin(x+1)', Target)).toBe('_gpu_sin(x + 1.0)');
    expect(code('\\tan(x-1)', Target)).toBe('tan(x + -1.0)');
  });
});

describe('the value of the emitted shader, in float32', () => {
  // Each x is rounded to a float32, so the reference sees the same input. No
  // x is a multiple of 1/16: float32 holds `x + 10^6` exactly at such a
  // point, and the error that the reduction removes would not show.
  const POINTS = [-2.718, -0.3, 0.1, 0.777, 1.2345, 3.0001].map(Math.fround);
  const CASES = [
    '\\sin(x+10^6)',
    '\\cos(x-10^6)',
    '\\sec(x+10^6)',
    '\\csc(x+10^6)',
    '\\cot(x+10^6)',
    // An exact constant that a double does not hold exactly.
    '\\sin(x+10^{20}+1)',
    '\\cos(x+\\frac{10^7}{3})',
    '\\sin(x+10^6\\sqrt{2})',
    '\\sin(x+10^6\\pi+10^6)',
    '\\sin(\\pi(x+10^6+\\frac{1}{3}))',
    '\\cos(\\pi(x-10^5+\\frac{1}{3}))',
    '\\sin(2(x+10^6))',
    // Larger than a double: reduced from its exact value.
    '\\sin(x+10^{400})',
  ];

  // The reference: the exact expression at the point, to 500 digits (the
  // 10^{400} case needs more than 400).
  function reference(latex: string, x: number): number {
    const saved = ce.precision;
    ce.precision = 500;
    try {
      return ce
        .parse(latex)
        .subs({ x: ce.number(x) })
        .N().re;
    } finally {
      ce.precision = saved;
    }
  }

  for (const [language, Target] of TARGETS)
    test.each(CASES)(`${language}: %s`, (latex) => {
      const r = new Target().compile(ce.parse(latex));
      const main =
        language === 'glsl'
          ? `float _main(float x) { return ${r.code}; }`
          : `fn _main(x: f32) -> f32 { return ${r.code}; }`;
      const run = shaderFunctions(`${r.preamble ?? ''}\n${main}`, language);
      for (const x of POINTS) {
        const got = run('_main', x) as number;
        const want = reference(latex, x);
        // Before the reduction, the error was up to 0.03 for every case
        // with a 10^6 offset. A float32 rounding δ of the argument moves the
        // value by about δ·f′, and near a pole of csc or cot f′ is about f²:
        // at one of these points the value is 29.
        expect(Math.abs(got - want)).toBeLessThan(
          1e-6 * Math.max(1, Math.abs(want)) + 4e-7 * want * want
        );
      }
    });
});

describe('terms that are not constants, and other routes', () => {
  test('a Random() term is drawn at run time, not at compile time', () => {
    const e = ce.box(['Sin', ['Add', 'x', ['Multiply', 100, ['Random']]]]);
    const first = compile(e, { to: 'glsl' }).code;
    expect(first).toContain('_gpu_rnd_draw');
    expect(compile(e, { to: 'glsl' }).code).toBe(first);
  });

  test('a function the caller maps to its own code is kept', () => {
    const e = ce.box(['Sin', ['Add', 'x', ['Gamma', 20]]]);
    expect(
      compile(e, { to: 'glsl', functions: { Gamma: 'myGamma' } }).code
    ).toBe('_gpu_sin(x + myGamma(20.0))');
  });

  test('degree mode: the offset is reduced by 360', () => {
    const cd = new ComputeEngine();
    cd.angularUnit = 'deg';
    cd.declare('x', 'real');
    const latex = '\\sin(x+10^6)';
    const r = new GLSLTarget().compile(cd.parse(latex));
    expect(r.code).toBe('_gpu_sin(0.017453292 * (x + -80.0))');
    const run = shaderFunctions(
      `${r.preamble ?? ''}\nfloat _main(float x) { return ${r.code}; }`,
      'glsl'
    );
    for (const x of [-2.718, 0.1, 1.2345].map(Math.fround)) {
      const want = cd
        .parse(latex)
        .subs({ x: cd.number(x) })
        .N().re;
      expect(Math.abs((run('_main', x) as number) - want)).toBeLessThan(1e-6);
    }
  });
});
