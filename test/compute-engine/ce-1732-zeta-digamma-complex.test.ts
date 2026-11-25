/**
 * CE-1732: the two-argument `Zeta(s, a)` of a complex `s` and a real `a`
 * (`\zeta(z, a)`), and `Digamma(z)` of a complex `z`, compile on JavaScript
 * and GLSL. They declined with "Zeta of complex, real" and "Digamma of
 * complex", while `HurwitzZeta(z, a)` and `PolyGamma(0, z)` compiled.
 *
 * On JavaScript each one is the interpreter's kernel, so it gives the
 * interpreter's value. In WebGL 2 (SwiftShader,
 * `scripts/glsl-check/glsl-driver.ts`) `Digamma` is within float32
 * precision of the interpreter's value (relative to the larger of the value
 * and 1, as `PolyGamma(0, z)` in `ce-1600-glsl-complex-zeta.test.ts`).
 * `Zeta(s, a)` is within 3e-5 of the sum of the sizes of its terms (those
 * left of 0 and the Euler-Maclaurin terms of the Hurwitz zeta), as
 * `HurwitzZeta(s, a)` there: absolute, not relative to the value. Without
 * the browser the value tests are skipped.
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
ce.declare('a', 'real');

const compileTo = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), {
    fallback: false,
    ...options,
  } as never) as unknown as {
    success: boolean;
    code: string;
    preamble?: string;
    run: (v: object) => Cx | number;
  };

const asCx = (v: Cx | number): Cx =>
  typeof v === 'number' ? { re: v, im: 0 } : v;

describe('CE-1732: Zeta(z, a) and Digamma(z) of a complex z compile', () => {
  test.each([
    ['Zeta(z, a)', ['Zeta', 'z', 'a'], '_gpu_ir_czeta_generalized(z, a)'],
    [
      'Zeta(z, -5/2)',
      ['Zeta', 'z', ['Rational', -5, 2]],
      '_gpu_ir_czeta_generalized(',
    ],
    ['Digamma(z)', ['Digamma', 'z'], '_gpu_ir_cpolygamma(0.0, z)'],
  ])('%s on GLSL', (_, json, call) => {
    for (const mode of ['strict', 'complex']) {
      const r = compileTo(json, { to: 'glsl', mode });
      expect(r.success).toBe(true);
      expect(r.code).toContain(call);
    }
  });

  test('the LaTeX of the witness', () => {
    for (const latex of ['\\zeta(z, a)', '\\operatorname{Digamma}(z)'])
      expect(
        compile(ce.parse(latex), {
          to: 'glsl',
          mode: 'complex',
          fallback: false,
        } as never).success
      ).toBe(true);
  });

  test('a real operand stays on the real helpers', () => {
    ce.declare('x', 'real');
    const glsl = (json: Json) => compileTo(json, { to: 'glsl' }).code;
    expect(glsl(['Zeta', 'x', 'a'])).toMatch(/^_gpu_ir_zeta_generalized\(/);
    expect(glsl(['Digamma', 'x'])).toMatch(/^_gpu_ir_digamma\(/);
  });

  test('a complex a declines', () => {
    ce.declare('w', 'complex');
    expect(() => compileTo(['Zeta', 'z', 'w'], { to: 'glsl' })).toThrow(
      'Zeta of complex, complex'
    );
    expect(() => compileTo(['Zeta', 'z', 'w'])).toThrow(
      'Zeta of complex, complex'
    );
  });
});

describe('CE-1732: the values on JavaScript', () => {
  const zeta = compileTo(['Zeta', 'z', 'a']);
  const digamma = compileTo(['Digamma', 'z']);

  test('they compile', () => {
    expect(zeta.success).toBe(true);
    expect(digamma.success).toBe(true);
  });

  test.each([
    [2, 3, 0.5],
    [0.5, 14, -2.3],
    [-1.5, 2, -0.7],
    [0.5, 1, 0],
    [2, 1, -3],
    [-3, -10, -4.25],
  ])('Zeta(%d + %di, %d) is the interpreter value', (re, im, a) => {
    const want = ce.box(['Zeta', ['Complex', re, im], a]).N();
    expect(asCx(zeta.run({ z: ce.complex(re, im), a }))).toEqual({
      re: want.re,
      im: want.im,
    });
  });

  // On the real axis, given as a complex input: the real kernel of the
  // real lane, within the rounding of the interpreter's big decimals.
  test.each([
    [3, -2.5],
    [-1.5, 0.75],
  ])('Zeta(%d + 0i, %d) is the real kernel', (re, a) => {
    const want = ce.box(['Zeta', re, a]).N().re;
    const got = asCx(zeta.run({ z: ce.complex(re, 0), a }));
    expect(got.im).toBe(0);
    expect(Math.abs(got.re - want)).toBeLessThanOrEqual(1e-14 * Math.abs(want));
  });

  test.each([
    [2, 3],
    [-2.5, 0.3],
    [0.5, -40],
    [-7.25, -0.5],
    [3, 0],
    [-2.5, 0],
  ])('Digamma(%d + %di) is the interpreter value', (re, im) => {
    const want = ce.box(['Digamma', ['Complex', re, im]]).N();
    const got = asCx(digamma.run({ z: ce.complex(re, im) }));
    expect(Math.abs(got.re - want.re)).toBeLessThanOrEqual(
      1e-14 * Math.abs(want.re)
    );
    expect(Math.abs(got.im - want.im)).toBeLessThanOrEqual(
      1e-14 * Math.abs(want.im)
    );
  });

  test('Digamma at a pole is +∞, and Zeta(s, a) at s = 1', () => {
    expect(asCx(digamma.run({ z: ce.complex(-2, 0) })).re).toBe(Infinity);
    expect(
      Number.isFinite(asCx(zeta.run({ z: ce.complex(1, 0), a: -1.5 })).re)
    ).toBe(false);
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

const size = (v: Cx) => Math.hypot(v.re, v.im);

/** The sum of the sizes of the terms of `_gpu_ir_czeta_generalized`: those
 *  left of 0, and the Euler-Maclaurin terms of `_gpu_ir_churwitz_em` at
 *  the first base point c >= 0 (its shift rule, in doubles). */
function termScale(s: Complex, a: number): number {
  let size = 0;
  let w = new Complex(a, 0);
  while (w.re < 0) {
    size += w.neg().pow(s.neg()).abs();
    w = w.add(1);
  }
  if (w.re === 0) w = new Complex(1, 0);
  const r = Math.max(3, (1.1 * (s.abs() + 32)) / (2 * Math.PI));
  const n = Math.max(0, Math.ceil(r - w.re));
  for (let k = 0; k < n; k++) {
    size += w.pow(s.neg()).abs();
    w = w.add(1);
  }
  const p = w.pow(s.neg());
  return size + p.mul(w).div(s.sub(1)).abs() + 0.5 * p.abs();
}

type ValueCase = {
  label: string;
  json: Json;
  points: number[][];
  value: (re: number, im: number) => Cx;
  tolerance: (re: number, im: number, v: Cx) => number;
};

// prettier-ignore
const VALUE_CASES: ValueCase[] = [
  ...[0.5, 0, -0.75, -2.25, -3, -7.5].map((a): ValueCase => ({
    label: `Zeta(z, ${a})`,
    json: ['Zeta', 'z', exact(fr(a)).json],
    points: grid(steps(-4, 5, 0.5), steps(-40, 40, 5)),
    value: (re, im) => ce.function('Zeta', [complexOf(re, im), exact(fr(a))]).N(),
    // At a = 0 `Zeta(z)`; elsewhere within 3e-5 of the sizes of the terms.
    tolerance: (re, im, v) =>
      a === 0 ? 1e-4 * Math.max(1, size(v)) : 3e-5 * termScale(new Complex(re, im), fr(a)),
  })),
  {
    label: 'Digamma',
    json: ['Digamma', 'z'],
    points: [
      ...grid(steps(-6.5, 5, 0.75), [-8, -2, -0.5, -0.01, 0.01, 0.3, 1, 3, 10, 25]),
      ...grid([-2.5, -0.5, 0.25, 3], [0]),
    ],
    value: (re, im) => ce.function('Digamma', [complexOf(re, im)]).N(),
    tolerance: (_re, _im, v) => 1e-4 * Math.max(1, size(v)),
  },
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
  'CE-1732: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test.each(VALUE_CASES.map((c) => [c.label, c] as const))(
      '%s gives the interpreter value',
      async (_, c) => {
        const r = compileTo(c.json, { to: 'glsl' });
        const points = c.points
          .map((p) => p.map(fr))
          .map(([re, im]) => ({ re, im, v: c.value(re, im) }))
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
          if (im === 0 && Number.isNaN(got.re)) return;
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

    test('every term left of 0 down to a = -4200, NaN below', async () => {
      const at = (a: number) => {
        const r = compileTo(['Zeta', 'z', exact(a).json], { to: 'glsl' });
        return (['.x', '.y'] as const).map((part) => ({
          name: `Zeta(2 + i, ${a})${part}`,
          source: complexShader(r.code, r.preamble ?? '', part),
          uniforms: { u_re: 2, u_im: 1 },
        }));
      };
      const [x, y, nx, ny] = await driver.evaluate([
        ...at(-4200),
        ...at(-4200.5),
      ]);
      const v = ce.function('Zeta', [complexOf(2, 1), exact(-4200)]).N();
      expect(x.ok && y.ok && nx.ok && ny.ok).toBe(true);
      const err = Math.hypot(x.value - v.re, y.value - v.im);
      expect(err).toBeLessThanOrEqual(
        3e-5 * termScale(new Complex(2, 1), -4200)
      );
      expect([Number.isNaN(nx.value), Number.isNaN(ny.value)]).toEqual([
        true,
        true,
      ]);
    }, 120_000);
  }
);
