/**
 * `HarmonicNumber(n)` and `HarmonicNumber(n, r)` on the GLSL printer of the
 * profile `ir` (`_gpu_ir_harmonic` and `_gpu_ir_harmonic2` in
 * `glsl-zeta-helpers.ts`).
 *
 * In WebGL 2 (SwiftShader, `scripts/glsl-check/glsl-driver.ts`) each point
 * gives the interpreter's value (`N()`) within 3e-5 of it (relative), or NaN
 * at a point of `NAN_POINTS`, where the terms of the method cancel; +∞ where
 * the interpreter gives `~oo`, NaN where it gives a complex value or leaves
 * the form unevaluated, and an infinity exactly. A shader evaluates 15
 * points, read from uniform arrays, and writes a code with one ternary digit
 * per point (0: the value, 1: NaN, 2: another value): a WebGL compilation of
 * the helpers takes about half a second.
 * Without the browser the value tests are skipped.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';

type Json = unknown;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');

const glsl = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), {
    profile: 'ir',
    fallback: false,
    to: 'glsl',
    ...options,
  } as never);

describe('HarmonicNumber compiles on GLSL', () => {
  test('of one and of two operands', () => {
    expect(glsl(['HarmonicNumber', 'x']).code).toBe('_gpu_ir_harmonic(x)');
    expect(glsl(['HarmonicNumber', 'x', 'y']).code).toBe(
      '_gpu_ir_harmonic2(x, y)'
    );
  });

  test('each helper is defined before the helpers that call it', () => {
    const r = glsl(['HarmonicNumber', 'x', 'y']);
    const defined = [...r.preamble!.matchAll(/^\w+ (_gpu_ir_\w+)\(/gm)].map(
      (m) => m[1]
    );
    expect(new Set(defined).size).toBe(defined.length);
    defined.forEach((name, k) => {
      const body = r.preamble!.split(/^\w+ _gpu_ir_\w+\(/m)[k + 1];
      for (const [, called] of body.matchAll(/\b(_gpu_ir_\w+)\(/g))
        if (called !== name)
          expect([name, defined.indexOf(called) < k]).toEqual([name, true]);
    });
  });

  // `HarmonicNumber(n, r)` of real operands can be complex (`n < -1` and a
  // non-integer `r`); the row has no complex signature.
  test('of two operands declines in the complex mode', () => {
    expect(() =>
      glsl(['HarmonicNumber', 'x', 'y'], { mode: 'complex' })
    ).toThrow(/HarmonicNumber of real, real/);
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
  if (Number.isInteger(v) || !Number.isFinite(v) || Math.abs(v) < 1e-6)
    return ce.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return ce.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

const BATCH = 15;

// 0 to 50, large integers, the bound of the direct sum (256), the bounds of
// the Taylor series of `HarmonicNumber(n)` (|n| = 0.1) and of the series of
// `HarmonicNumber(n, r)` (|n| = 0.5), non-integers, and below -1 (the
// reflection of `HarmonicNumber(n)`, the recurrence of `HarmonicNumber(n, r)`).
// prettier-ignore
const NS = [
  ...Array.from({ length: 51 }, (_, k) => k),
  100, 256, 257, 1000, 1e6, 1000.5, 1e6 + 0.5, 255.75, 256.75,
  0.05, -0.07, 0.0999, 0.1001, 0.3, -0.3, 0.4999, -0.4999, 0.5, -0.5, 0.75,
  -0.95, 2.5, 10.25, -1.5, -2.25, -7.75, -10.1,
];
const RS = [2, 3, 0.5, 1.5, -1];

/** `HarmonicNumber(n, ±∞)`: 1 for n > 0, -∞ for -1 < n < 0. */
// prettier-ignore
const R_INFINITE: number[][] = [
  [2, Infinity], [0.5, Infinity], [0, Infinity], [-0.5, Infinity],
  [-1.5, Infinity], [-2, Infinity], [2, -Infinity],
];

/** The interpreter's value at `p`: +∞ for `~oo`, NaN for a complex value or
 *  an unevaluated form, ±∞ past the largest float. */
function expectedAt(p: number[]): number {
  const v = ce.function('HarmonicNumber', p.map(exact)).N();
  if (v.re === Infinity && v.im === Infinity) return Infinity;
  if (v.im !== 0 || Number.isNaN(v.re)) return NaN;
  return Math.abs(v.re) > 3.4028235677973366e38 ? v.re * Infinity : v.re;
}

/** The points `[n]` and `[n, r]`, `r = 1` included (it is `[n]`), and
 *  points next to `r = 1`, of a large `r` and of a negative `r`. */
// prettier-ignore
const POINTS: number[][] = [
  ...NS.flatMap((n) => [[n], ...[...RS, 1].map((r) => [n, r])]),
  [10.5, 1.001], [10.5, 0.999], [200.5, 1.01], [0.6, 1.001], [-0.6, 0.999],
  [300, 1.001], [0.45, 50], [-0.45, 50], [0.6, 10], [1.5, 25], [-2.5, 25],
  [0.9, -24], [1.5, -2], [-0.5, -2], [0.5, -10], [-1.5, -10], [0.3, -15.5],
  [12.3, -11], [3.7, -3.5], [-24.78], [-4.689], [-1.5, 5],
  // Below -256.5 the terms ±(1/2)^-r of ζ(r, n + 1) cancel exactly for an
  // odd r.
  [-300.5, 15], [-256.5, 17], [-256.5, 11], [-257.5, 15], [-1000.5, 15],
  [-10000.5, 15], [-300.5, 3], [-1000.5, 5], [-400.25, 15],
  // Below -10^6 (a bound on the loops of ζ(r, n + 1)): NaN.
  [-1000000.5, 2],
  // Values above 1e36, where an error estimate in units of 6e-8 overflowed.
  [-68.704, -20], [181.196, -16], [-4.0129, 20], [38.216, -23], [255.5, -15.5],
  // The poles, a complex value, an unevaluated form and the infinities.
  [-3], [-3, 2], [-3, 1], [-2.5, 0.5], [-3, -1], [Infinity], [Infinity, 2],
  [Infinity, Infinity], [Infinity, 1],
  ...R_INFINITE,
].map((p) => p.map(fr));

test('HarmonicNumber(n, ±∞) on JavaScript gives the interpreter value', () => {
  const f = compile(ce.box(['HarmonicNumber', 'x', 'y']), {
    profile: 'ir',
    fallback: false,
  });
  const run = f.run as (v: object) => number;
  expect(R_INFINITE.map(([x, y]) => run({ x, y }))).toEqual(
    R_INFINITE.map(expectedAt)
  );
  expect(R_INFINITE.map(expectedAt)).toEqual([
    1,
    1,
    0,
    -Infinity,
    NaN,
    Infinity,
    NaN,
  ]);
});

function shader(json: Json, arity: number): string {
  const r = glsl(json);
  const args = arity === 1 ? 'u_x[i]' : 'u_x[i], u_y[i]';
  const params = arity === 1 ? 'float x' : 'float x, float y';
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    `uniform float u_x[${BATCH}];`,
    ...(arity === 2 ? [`uniform float u_y[${BATCH}];`] : []),
    `uniform float u_e[${BATCH}];`,
    `uniform float u_t[${BATCH}];`,
    'out vec4 fragColor;',
    r.preamble ?? '',
    `float userFn(${params}) { return ${r.code}; }`,
    'void main() {',
    '  float code = 0.0;',
    '  float p = 1.0;',
    `  for (int i = 0; i < ${BATCH}; i++) {`,
    `    float v = userFn(${args});`,
    '    float c = isnan(v) ? (isnan(u_e[i]) ? 0.0 : 1.0) : v == u_e[i] || abs(v - u_e[i]) <= u_t[i] ? 0.0 : 2.0;',
    '    code += c * p;',
    '    p *= 3.0;',
    '  }',
    '  fragColor = vec4(code, 0.0, 0.0, 0.0);',
    '}',
  ].join('\n');
}

/** The points where a helper is NaN and the interpreter has a finite real
 *  value: its terms cancel there (`glsl-zeta-helpers.ts`). */
const NAN_POINTS: string[] = [
  // Next to the zero of H(n) between -25 and -24 (H(-24.78) is -0.031),
  // where H(-n - 1) and π cot(πn) cancel.
  'HarmonicNumber(-24.780000686645508)',
  // ζ(r) and ζ(r, n + 1) cancel next to r = 1, past the recurrence (|n| > 256).
  'HarmonicNumber(300, 1.0010000467300415)',
  // The terms ±2^25 of the recurrence cancel to about 1.
  'HarmonicNumber(-2.5, 25)',
  // H(n, -2k) is 0 at n = -1/2, and below 1e-3 around it.
  'HarmonicNumber(-0.5, -2)',
  'HarmonicNumber(0.5, -10)',
  'HarmonicNumber(-1.5, -10)',
  // Below -256.5, the terms ±(1/2)^-r of ζ(r, n + 1) cancel exactly for an
  // odd r: at r = 11 the terms are ±2^11 and the value is 1.0005.
  'HarmonicNumber(-300.5, 15)',
  'HarmonicNumber(-256.5, 17)',
  'HarmonicNumber(-256.5, 11)',
  'HarmonicNumber(-257.5, 15)',
  'HarmonicNumber(-1000.5, 15)',
  'HarmonicNumber(-10000.5, 15)',
  // Below -10^6, the bound of the loops of ζ(r, n + 1).
  'HarmonicNumber(-1000000.5, 2)',
];

(chromiumAvailable() ? describe : describe.skip)(
  'HarmonicNumber: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the interpreter value, or NaN where the terms cancel', async () => {
      const cases = POINTS.map((p) => {
        const expected = expectedAt(p);
        return {
          name: `HarmonicNumber(${p.join(', ')})`,
          p,
          expected,
          // An infinity or NaN only by equality; a floor far below the
          // values of the points.
          tolerance: Number.isFinite(expected)
            ? 3e-5 * Math.abs(expected) + 1e-30
            : 0,
        };
      });
      const items = [1, 2].flatMap((arity) => {
        const source = shader(
          ['HarmonicNumber', ...['x', 'y'].slice(0, arity)],
          arity
        );
        const own = cases.filter((c) => c.p.length === arity);
        const batches: (typeof own)[] = [];
        for (let k = 0; k < own.length; k += BATCH)
          batches.push(own.slice(k, k + BATCH));
        return batches.map((batch) => {
          const full = Array.from(
            { length: BATCH },
            (_, k) => batch[k] ?? batch[0]
          );
          const column = (f: (c: (typeof own)[0]) => number) => full.map(f);
          return {
            batch,
            name: batch[0].name,
            source,
            uniforms: {
              u_x: column((c) => c.p[0]),
              ...(arity === 2 ? { u_y: column((c) => c.p[1]) } : {}),
              u_e: column((c) => c.expected),
              u_t: column((c) => c.tolerance),
            },
          };
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      const wrong: (typeof cases)[0][] = [];
      const nan: string[] = [];
      values.forEach((v, k) => {
        const { batch } = items[k];
        if (!v.ok) return failures.push(`${items[k].name}: ${v.log}`);
        let code = v.value;
        batch.forEach((c) => {
          const digit = code % 3;
          code = (code - digit) / 3;
          if (digit === 1) nan.push(c.name);
          else if (digit === 2) wrong.push(c);
        });
      });
      // The value of each wrong point, for the report.
      const got = await driver.evaluate(
        wrong.map((c) => {
          const r = glsl(['HarmonicNumber', ...['x', 'y'].slice(0, c.p.length)]);
          const inputs = ['x', 'y'].slice(0, c.p.length);
          return {
            name: c.name,
            source: [
              '#version 300 es',
              'precision highp float;',
              'precision highp int;',
              ...inputs.map((n) => `uniform float u_${n};`),
              'out vec4 fragColor;',
              r.preamble ?? '',
              `void main() { ${inputs.map((n) => `float ${n} = u_${n};`).join(' ')} fragColor = vec4(${r.code}, 0.0, 0.0, 0.0); }`,
            ].join('\n'),
            uniforms: Object.fromEntries(inputs.map((n, k) => [`u_${n}`, c.p[k]])),
          };
        })
      );
      got.forEach((v, k) =>
        failures.push(
          `${wrong[k].name}: ${v.ok ? v.value : v.log} vs ${wrong[k].expected}`
        )
      );
      expect(failures).toEqual([]);
      expect(nan).toEqual(NAN_POINTS);
      expect(cases.length).toBeGreaterThan(400);
    }, 300_000);
  }
);
