/**
 * CE-1600: `Zeta`, `HurwitzZeta`, `PolyGamma`, `Gamma`, `LerchPhi` and
 * `PolyLog` of a complex operand compile on GLSL
 * (`glsl-complex-special-helpers.ts`), and
 * `PolyGamma(n, z)` of a complex `z` on JavaScript (`cpolygamma`, the
 * interpreter's kernels).
 *
 * In WebGL 2 (SwiftShader, `scripts/glsl-check/glsl-driver.ts`) each shader
 * gives the interpreter's value (`N()`) within float32 precision: relative
 * for `Gamma`, and for `Zeta` and `PolyGamma` relative to the larger of the
 * value and 1 (next to a zero of ζ the error is absolute). `HurwitzZeta` is
 * within 3e-5 of the sum of the sizes of its Euler-Maclaurin terms, which
 * grow as |a + N|^(1 - Re s): for Re s < 0 its error relative to the value
 * is up to a few percent (`docs/COMPILATION-MODEL.md`, known limitations).
 * `LerchPhi` and `PolyLog` are within 3e-5 of the value, or NaN in the
 * regions that no method of theirs covers (the `nan` field of a case).
 * Without the browser the value tests are skipped.
 */

import { existsSync } from 'node:fs';
import { Complex } from 'complex.js';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';

type Json = unknown;
type Cx = { re: number; im: number };

const ce = new ComputeEngine();
ce.declare('z', 'complex');
ce.declare('w', 'complex');
ce.declare('n', 'integer');
ce.declare('t', 'real');

const glsl = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), {
    fallback: false,
    to: 'glsl',
    ...options,
  } as never);

describe('CE-1600: the complex special functions compile on GLSL', () => {
  test.each([
    ['Zeta(z)', ['Zeta', 'z'], '_gpu_ir_czeta('],
    [
      'HurwitzZeta(z, 1/2)',
      ['HurwitzZeta', 'z', ['Rational', 1, 2]],
      '_gpu_ir_churwitz_zeta(',
    ],
    ['HurwitzZeta(z, w)', ['HurwitzZeta', 'z', 'w'], '_gpu_ir_churwitz_zeta('],
    ['PolyGamma(n, z)', ['PolyGamma', 'n', 'z'], '_gpu_ir_cpolygamma('],
    ['PolyGamma(1, z)', ['PolyGamma', 1, 'z'], '_gpu_ir_cpolygamma('],
    ['Gamma(z)', ['Gamma', 'z'], '_gpu_ir_cgamma('],
    ['LerchPhi(z, 2, 1)', ['LerchPhi', 'z', 2, 1], '_gpu_ir_clerch_phi('],
    [
      'LerchPhi(z, w, 1/2)',
      ['LerchPhi', 'z', 'w', ['Rational', 1, 2]],
      '_gpu_ir_clerch_phi(',
    ],
    ['PolyLog(2, z)', ['PolyLog', 2, 'z'], '_gpu_ir_cpolylog('],
    ['PolyLog(w, z)', ['PolyLog', 'w', 'z'], '_gpu_ir_cpolylog('],
    [
      '|Zeta(1/2 + it)|',
      [
        'Abs',
        [
          'Zeta',
          ['Add', ['Rational', 1, 2], ['Multiply', 'ImaginaryUnit', 't']],
        ],
      ],
      '_gpu_ir_czeta(',
    ],
  ])('%s', (_, json, helper) => {
    for (const mode of ['strict', 'complex']) {
      const r = glsl(json, { mode });
      expect(r.success).toBe(true);
      expect(r.code).toContain(helper);
    }
  });

  test('each helper is defined once, before the helpers that call it', () => {
    const r = glsl([
      'Add',
      ['Zeta', 'z'],
      ['HurwitzZeta', 'z', 'w'],
      ['PolyGamma', 'n', 'z'],
      ['Gamma', 'z'],
      ['LerchPhi', 'z', 'w', 'z'],
      ['PolyLog', 'w', 'z'],
    ]);
    const defined = [...r.preamble!.matchAll(/^\w+ (_gpu_ir_\w+)\(/gm)].map(
      (m) => m[1]
    );
    expect(new Set(defined).size).toBe(defined.length);
    defined.forEach((name, k) => {
      const body = r.preamble!.split(/^\w+ _gpu_ir_\w+\(/m)[k + 1];
      for (const [, called] of body.matchAll(/\b(_gpu_ir_\w+)\(/g))
        if (called !== name)
          expect([
            name,
            called,
            defined.indexOf(called) >= 0 && defined.indexOf(called) < k,
          ]).toEqual([name, called, true]);
    });
  });

  test('a real operand stays on the real helpers in the strict mode', () => {
    ce.declare('x', 'real');
    expect(glsl(['PolyGamma', 'n', 'x']).code).toMatch(/^_gpu_ir_polygamma\(/);
    expect(glsl(['Gamma', 'x']).code).toMatch(/^_gpu_ir_gamma\(/);
    expect(glsl(['Zeta', 'x']).code).toMatch(/^_gpu_ir_zeta\(/);
  });
});

describe('CE-1600: PolyGamma of a complex argument on JavaScript', () => {
  const f = compile(ce.box(['PolyGamma', 'n', 'z']), {
    fallback: false,
  } as never) as unknown as {
    success: boolean;
    run: (v: object) => Cx | number;
  };

  const interpreter = (n: number, re: number, im: number): Cx => {
    const v = ce.box(['PolyGamma', n, ['Complex', re, im]]).N();
    return { re: v.re, im: v.im };
  };

  test('it compiles', () => expect(f.success).toBe(true));

  // Off the real axis, the interpreter's kernel: the same value.
  test.each([
    [0, -2.5, 0.3],
    [0, 3, 40],
    [1, 0.5, 2],
    [1, -7.25, -0.5],
    [2, 0.1, 0.1],
    [3, -3.2, -1],
    [10, 1, 1],
    [-1, -2.5, 1],
    [-1, 4, -30],
  ])('ψ^(%d)(%d + %di) is the interpreter value', (n, re, im) => {
    expect(f.run({ n, z: ce.complex(re, im) })).toEqual(interpreter(n, re, im));
  });

  test('on the real axis, the real kernel; a pole is +∞', () => {
    for (const [n, x] of [
      [0, 3],
      [1, -2.5],
      [3, 0.25],
      [-1, 2],
    ]) {
      const got = f.run({ n, z: ce.complex(x, 0) });
      const value = typeof got === 'number' ? got : got.re;
      const want = interpreter(n, x, 0).re;
      expect(Math.abs(value - want)).toBeLessThanOrEqual(
        1e-14 * Math.abs(want)
      );
    }
    for (const n of [0, 1, 2]) {
      const got = f.run({ n, z: ce.complex(-2, 0) });
      expect(typeof got === 'number' ? got : got.re).toBe(Infinity);
    }
  });

  test('the order -1 at a negative real is LogGamma, complex', () => {
    const got = f.run({ n: -1, z: ce.complex(-2.5, 0) }) as Cx;
    const want = interpreter(-1, -2.5, 0);
    expect(Math.abs(got.re - want.re)).toBeLessThan(1e-13);
    expect(Math.abs(got.im - want.im)).toBeLessThan(1e-13);
  });

  test('an order below -1 is NaN', () => {
    const got = f.run({ n: -2, z: ce.complex(1, 1) });
    expect(Number.isNaN(typeof got === 'number' ? got : got.re)).toBe(true);
  });
});

//
// The values in WebGL 2
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const fr = Math.fround;

/** The double `v` as an exact rational (a decimal literal is not the
 *  float that the shader reads). */
function exact(v: number) {
  if (Number.isInteger(v) || !Number.isFinite(v)) return ce.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return ce.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

const complexOf = (re: number, im: number) =>
  ce.function('Add', [
    exact(re),
    ce.function('Multiply', [exact(im), ce.box('ImaginaryUnit')]),
  ]);

const steps = (from: number, to: number, step: number): number[] =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, k) =>
    Number((from + k * step).toFixed(6))
  );

const grid = (xs: number[], ys: number[]): number[][] =>
  xs.flatMap((x) => ys.map((y) => [x, y]));

/** The sum of the sizes of the Euler-Maclaurin terms of
 *  `_gpu_ir_churwitz_em` (its shift rule, in doubles): the float32 scale
 *  of ζ(s, a). */
function termScale(s: Complex, a: Complex): number {
  const r = Math.max(3, (1.1 * (s.abs() + 32)) / (2 * Math.PI));
  const n = Math.max(0, Math.ceil(r - a.re));
  let size = 0;
  let w = a;
  for (let k = 0; k < n; k++) {
    if (w.abs() > 0) size += w.pow(s.neg()).abs();
    w = w.add(1);
  }
  const p = w.pow(s.neg());
  return size + p.mul(w).div(s.sub(1)).abs() + 0.5 * p.abs();
}

type ValueCase = {
  label: string;
  json: Json;
  points: number[][];
  /** The interpreter's value at the point (re, im) of `z`. */
  value: (re: number, im: number) => Cx;
  /** The largest error allowed at the point, for the value `v`. */
  tolerance: (re: number, im: number, v: Cx) => number;
  /** Where the helper may give NaN (a region it does not cover). */
  nan?: (re: number, im: number) => boolean;
};

const size = (v: Cx) => Math.hypot(v.re, v.im);

// prettier-ignore
const ZETA_POINTS = [
  ...grid(steps(-4, 5, 0.5), steps(-40, 40, 2.5)),
  // Next to the first zeros, next to the pole, on the real axis.
  [0.5, 14.134725], [0.5, 14.13], [0.5, 21.02204], [0.5, 21.02],
  [1.001, 0.001], [1, 0.01], [1, 1e-4], [0.999, 0], [1.01, 0],
  [-3, 0], [-2, 0], [2, 0], [0.5, 0],
  // Next to 0, where 1 - s rounds (the real helper takes -s).
  [-1e-6, 0], [1e-6, 0], [-1e-5, 0],
  // Off the real axis, the functional equation takes -s too.
  [-1e-6, 1e-7], [-1e-4, 1e-4], [-1e-3, -2e-3],
];

const HURWITZ_A: [number, number][] = [
  [0.5, 0],
  [0.25, 0.5],
  [-1.3, 0.2],
];

// prettier-ignore
const VALUE_CASES: ValueCase[] = [
  {
    label: 'Zeta',
    json: ['Zeta', 'z'],
    points: ZETA_POINTS,
    value: (re, im) => ce.function('Zeta', [complexOf(re, im)]).N(),
    tolerance: (_re, _im, v) => 1e-4 * Math.max(1, size(v)),
  },
  ...HURWITZ_A.map(([ar, ai]): ValueCase => {
    const a = new Complex(fr(ar), fr(ai));
    return {
      label: `HurwitzZeta(z, ${ar} + ${ai}i)`,
      json: ['HurwitzZeta', 'z', ['Complex', ar, ai]],
      points: grid(steps(-4, 5, 0.5), steps(-40, 40, 5)),
      value: (re, im) =>
        ce.function('HurwitzZeta', [complexOf(re, im), complexOf(a.re, a.im)]).N(),
      tolerance: (re, im) => 3e-5 * termScale(new Complex(re, im), a),
    };
  }),
  ...[0, 1, 2, 3].map((n): ValueCase => ({
    label: `PolyGamma(${n}, z)`,
    json: ['PolyGamma', n, 'z'],
    points: [
      ...grid(steps(-6.5, 5, 0.75), [-8, -2, -0.5, -0.01, 0.01, 0.3, 1, 3, 10, 25]),
      // On the real axis, the real helper.
      ...grid([-2.5, -0.5, 0.25, 3], [0]),
    ],
    value: (re, im) => ce.function('PolyGamma', [ce.number(n), complexOf(re, im)]).N(),
    tolerance: (_re, _im, v) => 1e-4 * Math.max(1, size(v)),
  })),
  {
    label: 'Gamma',
    json: ['Gamma', 'z'],
    points: [
      ...grid(steps(-6, 8, 0.5), [-30, -20, -10, -3, -1, -0.4, 0.001, 0.1, 0.7, 1.5, 5, 15, 30]),
      // Next to the poles.
      [-2.001, 0.001], [-3, 0.01], [0, 0.001], [-1.0001, 0], [0.5, 0], [-0.5, 0],
    ],
    value: (re, im) => ce.function('Gamma', [complexOf(re, im)]).N(),
    // Below the smallest float, any value that rounds there.
    tolerance: (_re, _im, v) => 1e-4 * size(v) + 1.2e-38,
  },
  // The plane to |z| = 6: the series, the expansion in ln z, the inversion
  // formula; on the cut z > 1 the side Im z < 0.
  ...([[2, 0], [3, 0], [1, 0], [0.5, 0], [-2, 0], [-5, 0], [2.5, 0], [0.5, 3]] as const).map(
    ([sr, si]): ValueCase => ({
      label: `PolyLog(${sr} + ${si}i, z)`,
      json: ['PolyLog', ['Complex', sr, si], 'z'],
      points: si === 0 ? grid(steps(-6, 6, 0.75), steps(-6, 6, 0.75)) : grid(steps(-4, 4, 1), steps(-4, 4, 1)),
      value: (re, im) => ce.function('PolyLog', [complexOf(sr, si), complexOf(re, im)]).N(),
      tolerance: (_re, _im, v) => 3e-5 * size(v),
      // The inversion formula for a Re s > 1 that is not an integer.
      nan: (re, im) => sr === 2.5 && Math.hypot(Math.log(Math.hypot(re, im)), Math.atan2(im, re)) > 3.5,
    })
  ),
  // A large |Im s|: the value, or NaN where the error of the factors could
  // pass 3e-5 of it (it was 8.8e-5 at -6 - 2.25i).
  {
    label: 'PolyLog(4 + 10i, z)',
    json: ['PolyLog', ['Complex', 4, 10], 'z'],
    points: [...grid(steps(-6, 6, 2), steps(-6, 6, 2)), [-6, -2.25], [-5.25, -1.5]],
    value: (re, im) => ce.function('PolyLog', [complexOf(4, 10), complexOf(re, im)]).N(),
    tolerance: (_re, _im, v) => 3e-5 * size(v),
    nan: () => true,
  },
  // The inversion formula next to the order 0: 1 - s rounds in float32,
  // and the pole term of ζ(1 - s, q) takes the exact distance -s.
  {
    label: 'PolyLog(-1e-6, z)',
    json: ['PolyLog', fr(-1e-6), 'z'],
    points: grid([-40, -10, -3, 3, 10, 40], [-5, -1, 0.5, 1, 5, 20]),
    value: (re, im) => ce.function('PolyLog', [exact(fr(-1e-6)), complexOf(re, im)]).N(),
    tolerance: (_re, _im, v) => 3e-5 * size(v),
  },
  // The unit disk: the series, then the asymptotic expansion; NaN past
  // the unit circle for a != 1.
  ...([[2, 0, 1, 0], [2, 0, 0.3, 0.2], [0.5, 8, 0.7, 0], [3, 0, -2.3, 0.5], [1.5, 0, 0.2, 6]] as const).map(
    ([sr, si, ar, ai]): ValueCase => ({
      label: `LerchPhi(z, ${sr} + ${si}i, ${ar} + ${ai}i)`,
      json: ['LerchPhi', 'z', ['Complex', sr, si], ['Complex', ar, ai]],
      points: grid(steps(-1.2, 1.2, 0.15), steps(-1.2, 1.2, 0.15)),
      value: (re, im) =>
        ce.function('LerchPhi', [complexOf(re, im), complexOf(sr, si), complexOf(fr(ar), fr(ai))]).N(),
      tolerance: (_re, _im, v) => 3e-5 * size(v),
      nan: (re, im) => !(ar === 1 && ai === 0) && Math.hypot(re, im) > 1,
    })
  ),
];

function complexShader(code: string, preamble: string, part: '.x' | '.y') {
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'uniform float u_re;',
    'uniform float u_im;',
    'out vec4 fragColor;',
    preamble,
    `vec2 userFn(vec2 z) { return ${code}; }`,
    `void main() { fragColor = vec4(userFn(vec2(u_re, u_im))${part}, 0.0, 0.0, 0.0); }`,
  ].join('\n');
}

(chromiumAvailable() ? describe : describe.skip)(
  'CE-1600: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test.each(VALUE_CASES.map((c) => [c.label, c] as const))(
      '%s gives the interpreter value',
      async (_, c) => {
        const r = glsl(c.json);
        const points = c.points
          .map((p) => p.map(fr))
          .map(([re, im]) => ({ re, im, v: c.value(re, im) }))
          // Next to the largest float an intermediate overflows (NaN).
          .filter(({ v }) => size(v) < 1e37 || !Number.isFinite(size(v)));
        const items = points.flatMap(({ re, im }) =>
          (['.x', '.y'] as const).map((part) => ({
            name: `${c.label} at (${re}, ${im})${part}`,
            source: complexShader(r.code, r.preamble ?? '', part),
            uniforms: { u_re: re, u_im: im },
          }))
        );
        const values = await driver.evaluate(items);
        const failures: string[] = [];
        points.forEach(({ re, im, v }, k) => {
          const [x, y] = [values[2 * k], values[2 * k + 1]];
          const name = `${c.label} at (${re}, ${im})`;
          if (!x.ok || !y.ok)
            return failures.push(
              `${name}: ${x.ok ? '' : x.log}${y.ok ? '' : y.log}`
            );
          const got = { re: x.value, im: y.value };
          // On the real axis the real helper, which gives NaN where its
          // terms cancel (the strict real lane gives the same NaN).
          if (im === 0 && Number.isNaN(got.re) && Number.isNaN(got.im)) return;
          if (c.nan?.(re, im) && Number.isNaN(got.re) && Number.isNaN(got.im))
            return;
          // A pole: an infinite part.
          if (!Number.isFinite(size(v))) {
            if (Number.isFinite(size(got)))
              failures.push(`${name}: ${got.re}, ${got.im} at a pole`);
            return;
          }
          const err = Math.hypot(got.re - v.re, got.im - v.im);
          if (!(err <= c.tolerance(re, im, v)))
            failures.push(`${name}: ${got.re}, ${got.im} vs ${v.re}, ${v.im}`);
        });
        expect(failures).toEqual([]);
        expect(points.length).toBeGreaterThan(30);
      },
      300_000
    );

    test('on the real axis, NaN where the real helper refuses (its terms cancel)', async () => {
      // The Euler-Maclaurin sum does not detect the cancellation: before,
      // `PolyGamma(10, -2.5)` gave 416.14 where N() gives -4.0267.
      // prettier-ignore
      const cases: [Json, Cx][] = [
        [['PolyGamma', 10, 'z'], { re: -2.5, im: 0 }],
        [['PolyGamma', 12, 'z'], { re: -1.5, im: 0 }],
        [['HurwitzZeta', 25, 'z'], { re: -1.5, im: 0 }],
        [['HurwitzZeta', 9, 'z'], { re: -2.5, im: 0 }],
      ];
      const items = cases.map(([json, p]) => {
        const r = glsl(json);
        return {
          name: JSON.stringify(json),
          source: complexShader(r.code, r.preamble ?? '', '.x'),
          uniforms: { u_re: p.re, u_im: p.im },
        };
      });
      const values = await driver.evaluate(items);
      expect(
        values.map((v, k) => [items[k].name, v.ok && Number.isNaN(v.value)])
      ).toEqual(items.map((i) => [i.name, true]));
    }, 120_000);

    test('NaN where no method of LerchPhi or PolyLog applies', async () => {
      // prettier-ignore
      const cases: [Json, Cx][] = [
        // Past the unit circle for a != 1.
        [['LerchPhi', 'z', 2, ['Rational', 1, 2]], { re: 0, im: 1.5 }],
        // Next to z = 1 for a != 1 (the base point would pass 4,200 terms).
        [['LerchPhi', 'z', 2, ['Rational', 1, 2]], { re: 0.999, im: 0.001 }],
        // The inversion formula for a Re s > 1 that is not an integer.
        [['PolyLog', ['Rational', 5, 2], 'z'], { re: -6, im: 0.75 }],
        // For Re s < 0 the terms of Φ grow as k^(-Re s) and cancel.
        [['LerchPhi', 'z', -2, ['Rational', 1, 2]], { re: -0.9, im: 0.3 }],
        // ζ(-20 - k) overflows: NaN, not the +∞ of a pole.
        [['PolyLog', -20, 'z'], { re: -2, im: 0.1 }],
      ];
      const items = cases.map(([json, p]) => {
        const r = glsl(json);
        return {
          name: `${JSON.stringify(json)} at ${p.re} + ${p.im}i`,
          source: complexShader(r.code, r.preamble ?? '', '.x'),
          uniforms: { u_re: fr(p.re), u_im: fr(p.im) },
        };
      });
      const values = await driver.evaluate(items);
      expect(
        values.map((v, k) => [items[k].name, v.ok && Number.isNaN(v.value)])
      ).toEqual(items.map((i) => [i.name, true]));
    }, 120_000);

    test('the poles are infinite', async () => {
      // prettier-ignore
      const cases: [Json, Cx][] = [
        [['Zeta', 'z'], { re: 1, im: 0 }],
        [['HurwitzZeta', 'z', ['Complex', 0.25, 0.5]], { re: 1, im: 0 }],
        [['Gamma', 'z'], { re: -3, im: 0 }],
        [['PolyGamma', 0, 'z'], { re: -2, im: 0 }],
        [['PolyGamma', 2, 'z'], { re: 0, im: 0 }],
      ];
      const items = cases.map(([json, p]) => {
        const r = glsl(json);
        return {
          name: JSON.stringify(json),
          source: complexShader(r.code, r.preamble ?? '', '.x'),
          uniforms: { u_re: p.re, u_im: p.im },
        };
      });
      const values = await driver.evaluate(items);
      expect(values.map((v, k) => [items[k].name, v.ok && v.value])).toEqual(
        items.map((i) => [i.name, Infinity])
      );
    }, 120_000);
  }
);
