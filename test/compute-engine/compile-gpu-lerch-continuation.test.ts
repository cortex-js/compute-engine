/**
 * The GPU (GLSL and WGSL) LerchPhi and PolyLog helpers past the unit disk
 * and where the direct sums cancel: the positive integral (s > 0, and after
 * n integrations by parts for s <= 0), the rational closed form for a
 * non-positive integer s, the Hermite-type representation, for PolyLog
 * Jonquière's inversion formula, and last, for z < 0 and s <= −3, the sum
 * over the Fourier modes of the base point (see `GPU_LERCH_PREAMBLE_GLSL`,
 * `compilation/gpu-target.ts`). Also the GPU HurwitzZeta helper where its
 * Euler-Maclaurin terms cancel: Hermite's integral and Hurwitz's formula at
 * a base point in (0, 1] (see `GPU_ZETA_PREAMBLE_GLSL`).
 *
 * Shader text cannot run under jest. This file pins what the emitted text
 * must contain, and pins the algorithm's values through a statement-by-
 * statement f32 model of the GLSL helpers (`gpu-lerch-f32-model.ts`)
 * against mpmath: `lerchphi` / `polylog` / `zeta` at 40 digits, at the
 * f32-rounded operands (0.7 is 0.699999988079071 in f32, and so on). The
 * comment on each case carries the value mpmath reports.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import * as lerchModel from './gpu-lerch-f32-model';
import {
  gpuHurwitzZetaModel,
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
    '%s: the Fourier modes come after every other method',
    (_n, target) => {
      // They only answer where the other methods decline, so the values
      // those methods answer do not change.
      const preamble =
        target.compile(ce.box(['Add', LERCH, POLYLOG])).preamble ?? '';
      const modes = definition(preamble, '_gpu_lerch_modes');
      expect(modes).toMatch(/n <= 128;/);
      // 3e-5 of the value, as 500 (= 3e-5 / 6e-8) times the value: the two
      // sides of 6e-8 * rerr <= 3e-5 * |res| flush to 0 for a small |res|.
      expect(modes).toContain('rerr <= 500.0 * abs(res)');
      // The value must be a finite normal f32 (0 and inf passed the test).
      expect(modes).toContain('abs(res) >= 1.18e-38 && abs(res) < 3.4e38');
      const phi = definition(preamble, '_gpu_lerch_phi');
      expect(phi.indexOf('_gpu_lerch_core(')).toBeLessThan(
        phi.indexOf('_gpu_lerch_modes(')
      );
      const polyLog = definition(preamble, '_gpu_poly_log');
      expect(polyLog.indexOf('_gpu_poly_log_inversion(')).toBeLessThan(
        polyLog.indexOf('_gpu_lerch_modes(')
      );
      // PolyLog asks the modes for z Phi(z, s, 1) (c = 1), with the factor
      // z in the exponent, rather than multiplying an underflowing Phi by z.
      expect(polyLog).toContain('_gpu_lerch_modes(z, s, 1.0, 1.0)');
      expect(phi).toContain('_gpu_lerch_modes(z, s, a, 0.0)');
      // The inversion stops Li_s(1/z) on the ratio of the next term.
      expect(definition(preamble, '_gpu_poly_log_inversion')).toMatch(
        /pow\((float|f32)\(k \+ 1\) \/ (float|f32)\(k\), -s\)/
      );
      const names = definedNames(preamble);
      expect(names.indexOf('_gpu_lerch_modes')).toBeLessThan(
        names.indexOf('_gpu_lerch_phi')
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

describe('GPU HurwitzZeta where the Euler-Maclaurin terms cancel: emitted text', () => {
  const HURWITZ = ['HurwitzZeta', 'gl_s', 'gl_a'];

  test.each(targets)(
    '%s: HurwitzZeta defines the base-point helpers before their use',
    (_n, target, head) => {
      const r = target.compile(ce.box(HURWITZ));
      expect(r.success).toBe(true);
      expect(r.code).toBe('_gpu_hurwitz_zeta(gl_s, gl_a)');
      const preamble = r.preamble ?? '';
      const helpers = [
        '_gpu_zeta_gamma_2pi',
        '_gpu_zeta_em1',
        '_gpu_zeta_hermite',
        '_gpu_zeta_fourier',
        '_gpu_zeta_shifted',
        '_gpu_hurwitz_zeta',
      ];
      for (const name of helpers) expect(preamble).toMatch(head(name));
      const names = definedNames(preamble);
      for (let i = 1; i < helpers.length; i++)
        expect(names.indexOf(helpers[i - 1])).toBeLessThan(
          names.indexOf(helpers[i])
        );
      expect(names.indexOf('_gpu_riemann_zeta')).toBeGreaterThan(
        names.indexOf('_gpu_zeta_gamma_2pi')
      );
    }
  );

  test.each(targets)(
    '%s: the budgets the f32 model mirrors (40 Hermite panels, 64 Fourier terms, the 3e-5 estimate)',
    (_n, target) => {
      const preamble = target.compile(ce.box(HURWITZ)).preamble ?? '';
      expect(definition(preamble, '_gpu_zeta_hermite')).toMatch(/p < 40;/);
      expect(definition(preamble, '_gpu_zeta_fourier')).toMatch(/k <= 64;/);
      const shifted = definition(preamble, '_gpu_zeta_shifted');
      expect(shifted).toMatch(/j < 128;/);
      expect(shifted).toContain('3.0e-5 * abs(z)');
    }
  );

  test.each(targets)(
    '%s: s + (2b - 1) is kept from a fast-math reassociation',
    (_n, target) => {
      // An Apple GPU compiled s + (2.0 * b - 1.0) as (s + 2b) - 1, which
      // lost s next to s = 0: HurwitzZeta(-1e-6, 1/2) was 6.7% off.
      const preamble = target.compile(ce.box(HURWITZ)).preamble ?? '';
      expect(definition(preamble, '_gpu_zeta_hermite')).toContain(
        's + max(2.0 * b - 1.0, -1.0)'
      );
    }
  );
});

describe('GPU HurwitzZeta: f32 model of the GLSL helpers', () => {
  const TOL = 1.5e-5;
  const close = (v: number, ref: number) =>
    expect(Math.abs(v - ref) / Math.abs(ref)).toBeLessThan(TOL);

  test.each([
    // The Euler-Maclaurin sum cancelled at these (the model of the previous
    // helper was off by the relative error in the comment). mpmath at the
    // f32-rounded operands.
    // Hermite's integral; the previous helper answered 5.4e-9 (off by 1.0).
    // mpmath: -3.465743464788054e-7
    [9.999999974752427e-7, 0.5, -3.465743464788054e-7],
    // Hermite's integral; 1.3e-4 off before. mpmath: 0.002786862323028948
    [-0.8797968029975891, 0.75, 0.002786862323028948],
    // Hurwitz's formula; 7.6e-5 off before. mpmath: 0.019408293447053773
    [-13.929261207580566, 0.5, 0.019408293447053773],
    // Hurwitz's formula; 5.1e-5 off before. mpmath: 183.9371586310347
    [-21.856075286865234, 0.5, 183.9371586310347],
    // The three values the GPU had more than 1e-5 off (2.3e-5 at s = 1/2,
    // a zero of zeta(1/2, a) is at a = 0.3027).
    [0.5, 0.3, 0.011152731209085116], // mpmath: 0.011152731209085116
    [-1.999999, 0.3, -0.014000001599336594], // mpmath: -0.014000001599336594
    [-7.25, 0.3, 0.00032815810595483827], // mpmath: 0.00032815810595483827
    // A base point below 2^-10: b^(-s) + zeta(s, 1 + b) by the Taylor
    // series in b. mpmath: 0.0087946166131674659
    [-2.9, 1e-6, 0.0087946166131674659],
    // 47 passed-over terms. mpmath: -879792.04326700578
    [-2.9, 47.9, -879792.04326700578],
  ])('ζ(%p, %p) ≈ %p', (s, a, ref) => {
    close(gpuHurwitzZetaModel(s, a), ref);
  });

  test('next to a zero of zeta(s, a) the helper declines (NaN)', () => {
    // zeta(-23, 1/4) = -B_24(1/4)/24 = -2.15e-4, about 1e-7 of the size of
    // the terms of every method: the previous helper answered -8.9e-4 in the
    // model and 0.016 on the GPU. mpmath: -0.00021502435900862678
    expect(gpuHurwitzZetaModel(-23, 0.25)).toBeNaN();
  });

  test('LerchPhi at z = 1 is the Hurwitz zeta', () => {
    // mpmath: lerchphi(1, 0.5, 0.3) = 0.011152731209085116
    close(gpuLerchPhiModel(1, 0.5, 0.3), 0.011152731209085116);
  });

  describe('with pow and log2 a few ulp off', () => {
    beforeEach(() => setGpuErrorModel(true));
    afterEach(() => setGpuErrorModel(false));

    test('the reflection of zeta(s) takes Gamma(1 - s)/(2 pi)^(1 - s) from Stirling', () => {
      // The Lanczos Gamma(1 - s) was 3.3e-5 off here.
      // mpmath: zeta(-21.856075286865234) = -183.9372070856711
      close(gpuHurwitzZetaModel(-21.856075286865234, 1), -183.9372070856711);
    });
  });
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

  test.each([
    // Every other method declines here (NaN before); the Fourier modes of
    // the base point answer. The example of the ROADMAP entry:
    [-1, -6.5, 1.3, 0.10992389481309564], // mpmath: 0.10992389481309564
    [
      -622.1575927734375, -8.363997459411621, 0.17904040217399597,
      0.00048386402613201146,
    ], // mpmath: 0.00048386402613201146
    [
      -15.521754264831543, -11.620392799377441, 0.4291398823261261,
      -1.2519133506947626,
    ], // mpmath: -1.2519133506947626
    // An integer order where the rational form cancels. mpmath: -6115.304426678464
    [-0.9065679907798767, -14, 0.42796069383621216, -6115.304426678464],
    // a > 1: Phi(z,s,a) = z^(-3) (Phi(z,s,a-3) - the three terms before a).
    // mpmath: 3783741.2769188816
    [-1, -15.475152015686035, 3.661898612976074, 3783741.2769188816],
  ])('Φ(%p, %p, %p) ≈ %p from the Fourier modes', (z, s, a, ref) => {
    close(gpuLerchPhiModel(z, s, a), ref);
    expect(lerchModel.lastRoute).toBe('modes');
  });

  test.each([
    [-12.3, -2, 78.94559354594259], // mpmath: 78.94559354594259
    [-11.828727722167969, -37.46116256713867, 1.1035033838958594], // mpmath: 1.1035033838958594
    [-7.493428707122803, -26.884735107421875, 0.01480792971612818], // mpmath: 0.01480792971612818
  ])('Li_%p(%p) ≈ %p from the Fourier modes', (s, z, ref) => {
    close(gpuPolyLogModel(s, z), ref);
    expect(lerchModel.lastRoute).toBe('modes');
  });

  describe('far below z = -1: a value that is not a finite normal f32 declines', () => {
    // A value, or an intermediate that the value is scaled by, below the
    // smallest normal f32 (1.18e-38) or past 3.4e38: the helpers answered
    // 0, +inf or a subnormal, which the 3e-5 test passed. They must decline
    // (NaN), or answer within the tolerance. References: mpmath at 100
    // digits (polylog, or for LerchPhi the sum over the Fourier modes).
    const nanOrClose = (v: number, ref: number) => {
      if (!Number.isNaN(v)) close(v, ref);
    };

    test.each([
      // The modes answered -0. mpmath: -3.714720210741611e-25
      [-24.8, -1.125e35, -3.714720210741611e-25],
      // The modes answered -1.44e-19. mpmath: -5.6998503006119073e-20
      [-20.17, -1.03e26, -5.6998503006119073e-20],
    ])('Li_%p(%p) ≈ %p or NaN', (s, z, ref) => {
      nanOrClose(gpuPolyLogModel(s, z), ref);
    });

    test('Φ(z, s, 1) below 3.9e-34 goes to the inversion', () => {
      // The integral answered Φ = 0 (it is 1.35e-52), so Li was -0.
      // mpmath: -9.7089300653122579e-15
      close(gpuPolyLogModel(-8.94, -7.17e37), -9.7089300653122579e-15);
      expect(lerchModel.lastRoute).toBe('inversion');
    });

    test.each([
      // a > 1: z^(-2) = 3.1e-48 underflowed, the value was 0.
      // mpmath: 1.5274745351078843e-18
      [-5.7e23, -26.67, 2.67, 1.5274745351078843e-18],
      // The true value is subnormal; the modes answered 2.38e-44.
      // mpmath: 2.4010861556058437e-44
      [-6.7e34, -12.16, 0.776, 2.4010861556058437e-44],
      // a > 1 at |z| near 1e7: the five subtracted terms z^j (b+j)^(-s)
      // overflowed and the value was +inf. mpmath: 10190556.132763747
      [-7573717, -20.44, 5.78, 10190556.132763747],
    ])('Φ(%p, %p, %p) ≈ %p or NaN', (z, s, a, ref) => {
      nanOrClose(gpuLerchPhiModel(z, s, a), ref);
    });

    test.each([
      // a > 1 at |z| near 1e7, the value from the modes.
      // mpmath: 2574.1857669936879
      [-9057938, -18.296445846557617, 4.686798095703125, 2574.1857669936879],
      // |z| >= 1e20: Phi(z, s, b) is far below the terms that a > 1
      // subtracts, and its flush to 0 is counted, not a reason to decline.
      // mpmath: 1.3087081658266372e-36
      [
        -1.2256828986765422e22, -29.512062072753906, 1.3408564329147339,
        1.3087081658266372e-36,
      ],
    ])('Φ(%p, %p, %p) ≈ %p from the Fourier modes', (z, s, a, ref) => {
      close(gpuLerchPhiModel(z, s, a), ref);
      expect(lerchModel.lastRoute).toBe('modes');
    });
  });

  describe('the inversion: Li_s(1/z) stops on the ratio of the next term', () => {
    // The series of Li_s(1/z) stopped after its first term, since its bound
    // on the ratios of later terms was |1/z|: the second term is
    // 2^(-s)|1/z| times the first, more than half of it for s near -29.
    test('Li_s(z) at s = -22.77, z = -4.3e9', () => {
      // The inversion answered -1.44658e-10 (2e-3 off).
      // mpmath: -1.4437059596168485e-10
      close(
        gpuPolyLogModel(-22.76803970336914, -4309899264),
        -1.4437059596168485e-10
      );
      expect(lerchModel.lastRoute).toBe('inversion');
    });

    test.each([
      // 9.6 times too large before. mpmath: -7.3035472744622145e-11
      [-28.974454879760742, -866429376, -7.3035472744622145e-11],
      // 2.6 times too large before. mpmath: 2.4715680245525408e-10
      [-27.95, -7.97e8, 2.4715680245525408e-10],
    ])('Li_%p(%p) ≈ %p or NaN', (s, z, ref) => {
      const v = gpuPolyLogModel(s, z);
      if (!Number.isNaN(v)) close(v, ref);
    });
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
