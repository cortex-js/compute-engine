/**
 * The GPU (GLSL and WGSL) LerchPhi and PolyLog helpers past the unit disk
 * and where the direct sums cancel: the positive integral (s > 0, and after
 * n integrations by parts for s <= 0), the rational closed form for a
 * non-positive integer s, the Hermite-type representation and, for
 * PolyLog, Jonquière's inversion formula (see
 * `GPU_LERCH_PREAMBLE_GLSL`, `compilation/gpu-target.ts`).
 *
 * Shader text cannot run under jest. This file pins what the emitted text
 * must contain, and pins the algorithm's values through a statement-by-
 * statement f32 model of the GLSL helpers (`gpu-lerch-f32-model.ts`)
 * against mpmath: `lerchphi` / `polylog` at 40 digits, at the f32-rounded
 * operands (0.7 is 0.699999988079071 in f32, and so on). The comment on each
 * case carries the value mpmath reports.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import * as lerchModel from './gpu-lerch-f32-model';
import {
  gpuLerchPhiModel,
  gpuPolyLogModel,
  setGpuErrorModel,
} from './gpu-lerch-f32-model';

const ce = new ComputeEngine();
ce.declare('gl_z', 'real');
ce.declare('gl_s', 'real');
ce.declare('gl_a', 'real');
ce.declare('gl_w', 'real');

const LERCH = ['LerchPhi', 'gl_z', 'gl_s', 'gl_a'];
const POLYLOG = ['PolyLog', 'gl_s', 'gl_z'];

const targets = [
  [
    'GLSL',
    new GLSLTarget(),
    (name: string) => new RegExp(`^(?:float|vec2|vec4|void) ${name}\\(`, 'm'),
  ],
  [
    'WGSL',
    new WGSLTarget(),
    (name: string) => new RegExp(`^fn ${name}\\(`, 'm'),
  ],
] as const;

/** The names of the top-level functions a preamble defines, in order. */
function definedNames(preamble: string): string[] {
  const names: string[] = [];
  for (const m of preamble.matchAll(
    /^(?:fn[^\S\n]+([A-Za-z_]\w*)|[A-Za-z_]\w*[^\S\n]+([A-Za-z_]\w*))[^\S\n]*\(/gm
  ))
    names.push(m[1] ?? m[2]);
  return names;
}

/** The source of the top-level function `name` in `preamble`. */
function definition(preamble: string, name: string): string {
  const start = preamble.search(
    new RegExp(`^(?:fn |[A-Za-z_]\\w* )${name}\\(`, 'm')
  );
  if (start < 0) return '';
  const end = preamble.indexOf('\n}\n', start);
  return preamble.slice(start, end + 2);
}

describe('GPU LerchPhi / PolyLog continuation: emitted text', () => {
  const lerchHelpers = [
    '_gpu_lerch_series',
    '_gpu_lerch_euler',
    '_gpu_lerch_em',
    '_gpu_lerch_lgamma',
    '_gpu_lerch_g',
    '_gpu_lerch_pstep',
    '_gpu_lerch_poly',
    '_gpu_lerch_rational',
    '_gpu_lerch_integral',
    '_gpu_lerch_h_integer',
    '_gpu_lerch_h_series',
    '_gpu_lerch_h_cf',
    '_gpu_lerch_hermite',
    '_gpu_lerch_negative',
    '_gpu_lerch_core',
    '_gpu_lerch_phi',
  ];

  test.each(targets)(
    '%s: LerchPhi defines the continuation helpers',
    (_n, target, head) => {
      const r = target.compile(ce.box(LERCH));
      expect(r.success).toBe(true);
      expect(r.code).toBe('_gpu_lerch_phi(gl_z, gl_s, gl_a)');
      for (const name of lerchHelpers)
        expect(r.preamble ?? '').toMatch(head(name));
      // The inversion formula is PolyLog's alone.
      expect(r.preamble ?? '').not.toContain('_gpu_poly_log_inversion');
    }
  );

  test.each(targets)(
    '%s: PolyLog defines the inversion and the Lerch core',
    (_n, target, head) => {
      const r = target.compile(ce.box(POLYLOG));
      expect(r.success).toBe(true);
      expect(r.code).toBe('_gpu_poly_log(gl_s, gl_z)');
      const preamble = r.preamble ?? '';
      for (const name of [
        '_gpu_poly_log',
        '_gpu_poly_log_inversion',
        '_gpu_lerch_core',
        '_gpu_lerch_integral',
        '_gpu_lerch_hermite',
      ])
        expect(preamble).toMatch(head(name));
      // Each definition precedes its first use (GLSL and WGSL both need it).
      const names = definedNames(preamble);
      expect(names.indexOf('_gpu_lerch_core')).toBeLessThan(
        names.indexOf('_gpu_poly_log_inversion')
      );
      expect(names.indexOf('_gpu_poly_log_inversion')).toBeLessThan(
        names.indexOf('_gpu_poly_log')
      );
    }
  );

  test.each(targets)(
    '%s: LerchPhi next to a complex operation defines every helper once',
    (_n, target) => {
      // Exp(i w) pulls in the complex preamble; the Lerch helpers do their
      // complex arithmetic inline and must not collide with it.
      const r = target.compile(
        ce.box([
          'Add',
          LERCH,
          ['Re', ['Exp', ['Multiply', 'ImaginaryUnit', 'gl_w']]],
          POLYLOG,
        ])
      );
      expect(r.success).toBe(true);
      const names = definedNames(r.preamble ?? '');
      expect(names).toContain('_gpu_cexp');
      expect(names).toContain('_gpu_lerch_phi');
      expect(names).toContain('_gpu_poly_log');
      const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
      expect(duplicates).toEqual([]);
    }
  );

  test('GLSL: no variable is named `out` (a GLSL keyword: the shader would not compile)', () => {
    const r = new GLSLTarget().compile(ce.box(['Add', LERCH, POLYLOG]));
    expect(r.preamble ?? '').not.toMatch(/\b(?:float|int|vec2|vec4)\s+out\b/);
  });

  test('WGSL: NaN and Infinity come from the _gpu_nan / _gpu_inf helpers', () => {
    // A bitcast of a CONSTANT to a non-finite f32 is a shader-creation error
    // in WGSL ("value nan cannot be represented as 'f32'"), so no helper may
    // spell it inline; the helpers bitcast a let.
    const r = new WGSLTarget().compile(ce.box(['Add', LERCH, POLYLOG]));
    const preamble = r.preamble ?? '';
    expect(preamble).not.toMatch(/bitcast<f32>\(0x/);
    expect(preamble).toContain('fn _gpu_nan() -> f32');
    expect(preamble).toContain('fn _gpu_inf() -> f32');
    expect(definition(preamble, '_gpu_lerch_phi')).toContain('_gpu_nan()');
  });

  test.each(targets)(
    '%s: at z = -1 the series incomplete gamma takes arg x from the sign of Im x',
    (_n, target) => {
      // At z = -1, Re x is -0.0, and the two-argument arctangent of Apple's
      // GPU answers +pi/2 for atan(-3.5, -0.0), where -pi/2 is right.
      const r = target.compile(ce.box(LERCH));
      expect(definition(r.preamble ?? '', '_gpu_lerch_h_series')).toMatch(
        /x\.x == 0\.0/
      );
    }
  );

  test.each(targets)(
    '%s: the budgets the f32 model mirrors (28 integral panels, 16 Hermite panels, the 3e-5 estimate)',
    (_n, target) => {
      const preamble = target.compile(ce.box(LERCH)).preamble ?? '';
      const integral = definition(preamble, '_gpu_lerch_integral');
      const hermite = definition(preamble, '_gpu_lerch_hermite');
      expect(integral).toMatch(/p < 28;/);
      expect(integral).toContain('3.0e-5 * abs(res)');
      expect(hermite).toMatch(/p < 16;/);
      expect(hermite).toContain('3.0e-5 * abs(res)');
    }
  );
});

describe('GPU LerchPhi / PolyLog continuation: f32 model of the GLSL helpers', () => {
  // The standard of the shader helpers: 1.5e-5 relative wherever they answer.
  const TOL = 1.5e-5;
  const close = (v: number, ref: number) =>
    expect(Math.abs(v - ref) / Math.abs(ref)).toBeLessThan(TOL);

  test.each([
    // z < -1, s > 0: the positive integral
    [-3, 1.5, 0.7, 1.1065756307517613], // mpmath: 1.1065756307517613
    [-1e6, 2, 1, 9.7079099055459641e-5], // mpmath: 9.7079099055459641e-5
    [-37.5, 12, 0.05, 4095999267578175.3], // mpmath: 4095999267578175.3
    [-1e4, 0.01, 0.05, 0.0066261028012426648], // mpmath: 0.0066261028012426648
    [-5, 3, -2.5, -1094.1099249861732], // a < 0, integer s; mpmath: -1094.1099249861732
    // 0 < z < 1 close to 1, where the series runs out of terms: the integral
    [0.9999, 0.5, 1.3, 175.43451564572285], // mpmath: 175.43451564572285
    // s < 0: the integral after n integrations by parts
    [-3, -0.5, 2.5, 0.33335479466844458], // mpmath: 0.33335479466844458
    [-2.5, -1.3, 3.5, 1.0766284618096222], // mpmath: 1.0766284618096222
    [-0.5, -2.5, 0.3, -0.11068958878185215], // mpmath: -0.11068958878185215
    [-1, -0.5, 0.7, 0.27892205824250239], // z = -1; mpmath: 0.27892205824250239
    [-1, -11.5, 0.5, 118.13126772564069], // z = -1, the Hermite form; mpmath: 118.13126772564069
    [0.99999, -1.5, 2, 4189536678373.296], // mpmath: 4189536678373.296
    [0.99999, -2.5, 1.5, 1.045953243320539e18], // mpmath: 1.045953243320539e+18
    [-5, -3.5, 1, 0.015533087472043121], // the Hermite form declined; mpmath: 0.015533087472043121
    [-2.5, -7.3, 3.5, 318.28309285484509], // mpmath: 318.28309285484509
    // A non-positive integer s: the rational closed form
    [2, -3, 1, 13], // z > 1 (no cut); mpmath: 13.0
    [4.5, -7, 2.25, 5.4648706646908825], // mpmath: 5.4648706646908825
    [-40, -9, 0.75, -0.0063926238686361377], // mpmath: -0.0063926238686361377
    [-7, -11, -3.5, -798781.11740880832], // a < 0; mpmath: -798781.11740880832
    // The direct series answered 1155547136 on a GPU (its terms cancel);
    // mpmath: 1154901726.226322
    [-0.6448838710784912, -10, 8.993898391723633, 1154901726.226322],
    // The s = -2 closed form a²/w + 2az/w² + z(1+z)/w³ cancelled to
    // 2.9e-5 relative; mpmath: 1.5694176601164853e-5
    [-95.0697250366211, -2, 1.0982577800750732, 1.5694176601164853e-5],
  ])('Φ(%p, %p, %p) ≈ %p', (z, s, a, ref) => {
    close(gpuLerchPhiModel(z, s, a), ref);
  });

  test.each([
    [2, -1e6, -97.079099055459641], // the integral; mpmath: -97.079099055459641
    [3, -50, -16.433187329371039], // mpmath: -16.433187329371039
    [0.5, -1e4, -3.406764570319366], // mpmath: -3.406764570319366
    [2, 0.9999, 1.643912831406464], // mpmath: 1.643912831406464
    [-0.5, -3, -0.44628968441466369], // the Hermite form; mpmath: -0.44628968441466369
    [-2.5, -1e5, -0.001078970044485083], // the inversion; mpmath: -0.001078970044485083
    [-1.5, -1e20, 0.00090531324641723091], // the inversion; mpmath: 0.00090531324641723091
    [-6.5, -50, 0.019465793471527279], // mpmath: 0.019465793471527279
    // Past |z| = 1e21 the integral used to run out of panels; the panels
    // now follow the step at t = ln(-z). mpmath: -2387.4990848215695
    [2, -1e30, -2387.4990848215695],
    [3, -1e35, -87369.410800674179], // mpmath: -87369.410800674179
    // An Eulerian closed form at |z| > 1, which overflowed f32 before
    // (1 - z)^10 was summed in 1/(1 - z); mpmath: -0.00011075118134210417
    [-9, -8487, -0.00011075118134210417],
  ])('Li_%p(%p) ≈ %p', (s, z, ref) => {
    close(gpuPolyLogModel(s, z), ref);
  });

  test('a genuinely complex value is NaN', () => {
    // mpmath: lerchphi(3, 2.5, 1) = 1.0942742369637423 - 0.90711i
    expect(gpuLerchPhiModel(3, 2.5, 1)).toBeNaN();
    // mpmath: lerchphi(-2, 1.5, -0.5) = -4.4407914276052568 + 2.8284i
    expect(gpuLerchPhiModel(-2, 1.5, -0.5)).toBeNaN();
    // mpmath: polylog(2.5, 3) = 3.2828227108912269 - 2.7213i
    expect(gpuPolyLogModel(2.5, 3)).toBeNaN();
  });

  describe('a GPU flushes a term below 1.2e-38 to zero', () => {
    // With the GPU option, the model flushes every result below the smallest
    // normal f32 (1.2e-38) to zero. The series and the Euler transform then
    // lost their later terms and stopped early: 0.72% off at
    // Φ(0.5, 12, 1000), 0.053% off at Φ(-0.5, 30, 15). They must decline
    // there, and the value comes from the integral. The GPU option is a
    // pessimistic GPU (log2 2.5 ulp off), where the integral is within
    // 2.4e-5 (see `GPU_LERCH_PREAMBLE_GLSL`).
    beforeEach(() => setGpuErrorModel(true));
    afterEach(() => setGpuErrorModel(false));

    test.each([
      [0.5, 12, 1000, 1.9764587361368077e-36], // mpmath: 1.9764587361368077112e-36
      [0.9, 20, 60, 7.8836129774974112e-36], // mpmath: 7.8836129774974112137e-36
      [0.3, 30, 15, 5.452405100763458853e-36], // mpmath: 5.452405100763458853e-36
      [-0.5, 30, 15, 4.8669478437637309911e-36], // mpmath: 4.8669478437637309911e-36
    ])('Φ(%p, %p, %p): the sums decline', (z, s, a, ref) => {
      const v = gpuLerchPhiModel(z, s, a);
      expect(['series', 'euler']).not.toContain(lerchModel.lastRoute);
      if (!Number.isNaN(v))
        expect(Math.abs(v - ref) / Math.abs(ref)).toBeLessThan(2.5e-5);
    });

    test('a value of ordinary size still comes from the series', () => {
      // mpmath: lerchphi(0.5, 2, 1) = 1.1644810529300250118
      close(gpuLerchPhiModel(0.5, 2, 1), 1.164481052930025);
      expect(lerchModel.lastRoute).toBe('series');
    });
  });
});
