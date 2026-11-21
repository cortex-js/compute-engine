/**
 * The special functions of the profile `ir` on GLSL (`print-glsl.ts`): the
 * reciprocal inverse trigonometric and hyperbolic functions, `Haversine`,
 * `Erf`, `Erfc`, `Gamma`, `GammaLn`, `Factorial` of a real,
 * `Factorial2`, `Zeta`, `Binomial`, `Choose` and `LCM` of integers, `GCD`
 * and `LCM` of reals, `Heaviside`, `Remainder` (integers and reals),
 * `Smoothstep`,
 * `InverseHaversine`, `ErfInv`, `Beta`, `Digamma`, `Trigamma` and
 * `BesselJ` of an integer order. `PolyGamma` declines: the deleted GPU
 * helper is NaN where its terms cancel (`PolyGamma(2, -0.5)`), where the
 * interpreter has a value.
 *
 * In WebGL 2 (SwiftShader) each shader gives the interpreter's value
 * (`N()`; where it is not a finite real, the value of the compiled
 * JavaScript: NaN outside the real domain, ±∞ at a pole) within the
 * tolerance of its case: single-float precision, scaled by the condition
 * of the formula where it has one (an exponential of a large argument, a
 * sum that cancels next to a zero).
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('z', 'real');
ce.declare('n', 'integer');
ce.declare('m', 'integer');

const IR_GLSL = { to: 'glsl', profile: 'ir', fallback: false } as const;

/** The double `v` as an exact rational (a decimal literal is not the
 *  float that the shader reads). */
function exact(v: number) {
  if (Number.isInteger(v) || !Number.isFinite(v) || Math.abs(v) < 1e-6)
    return ce.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return ce.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

type Case = {
  op: string;
  inputs: string[];
  /** The program, when it is not `op` applied to the inputs. */
  json?: unknown;
  points: number[][];
  /** Relative tolerance, and an absolute one for values near 0. */
  rel: number;
  abs: number;
};

// prettier-ignore
const CASES: Case[] = [
  { op: 'Arccot', inputs: ['x'], rel: 4e-7, abs: 1e-7,
    points: [[0], [1e-6], [-1e-6], [0.5], [-0.5], [1], [-1], [3.7], [-3.7], [1e6], [-1e6]] },
  { op: 'Arcsec', inputs: ['x'], rel: 1e-6, abs: 1e-7,
    points: [[1], [-1], [1.5], [-1.5], [2], [-10], [1e6], [0.5], [0], [-0.99]] },
  { op: 'Arccsc', inputs: ['x'], rel: 1e-6, abs: 1e-7,
    points: [[1], [-1], [1.5], [-1.5], [2], [-10], [1e6], [0.5], [0], [-0.99]] },
  { op: 'Arcoth', inputs: ['x'], rel: 1e-6, abs: 1e-7,
    points: [[1], [-1], [1.001], [-1.5], [2], [9.9], [10.1], [-1e6], [0.5], [0]] },
  { op: 'Arsech', inputs: ['x'], rel: 1e-6, abs: 1e-7,
    points: [[0], [1e-20], [0.001], [0.5], [0.9], [0.999], [1], [1.5], [-0.5]] },
  { op: 'Arcsch', inputs: ['x'], rel: 1e-6, abs: 1e-7,
    points: [[0], [1e-20], [-1e-20], [0.001], [0.5], [-2], [10], [1e6], [-1e6]] },
  { op: 'Haversine', inputs: ['x'], rel: 1e-6, abs: 1e-7,
    points: [[0], [0.1], [1], [-2.5], [3.1], [6], [-20]] },
  { op: 'Erf', inputs: ['x'], rel: 1e-6, abs: 1e-12,
    points: [[0], [1e-8], [-1e-3], [0.25], [0.4999], [0.5], [-0.75], [1], [2], [-3.5], [5], [12]] },
  { op: 'Erfc', inputs: ['x'], rel: 4e-6, abs: 1e-38,
    points: [[0], [1e-8], [-1e-3], [0.25], [0.5], [-0.75], [1], [2], [-3.5], [5], [9], [12]] },
  { op: 'Gamma', inputs: ['x'], rel: 4e-6, abs: 1e-30,
    points: [[0], [-1], [-2], [1e-4], [0.5], [0.75], [1], [1.5], [2], [3.3], [5], [10.5], [20], [33.9], [36],
      [-0.5], [-1.5], [-2.0001], [-7.25], [-30.5]] },
  { op: 'GammaLn', inputs: ['x'], rel: 2e-6, abs: 1e-6,
    points: [[0], [-3], [1e-4], [0.1], [0.5], [1], [1.5], [2], [3.3], [7.9], [8], [10.5], [100], [1e6],
      [-0.5], [-2.5], [-10.25]] },
  { op: 'Factorial', inputs: ['x'], rel: 4e-6, abs: 1e-30,
    points: [[0], [1], [5], [10], [20], [34], [35], [-1], [-3], [0.5], [2.5], [-0.5], [-1.5], [30.25]] },
  { op: 'Factorial2', inputs: ['x'], rel: 1e-6, abs: 1e-30,
    points: [[0], [1], [2], [7], [8], [20], [31], [55], [56], [57], [-1], [-3], [-7], [-2], [-4], [2.5]] },
  { op: 'Zeta', inputs: ['x'], rel: 1e-5, abs: 1e-6,
    points: [[1], [1.0001], [0.9999], [2], [3.5], [10], [40], [0.5], [0], [0.25], [-1], [-2], [-3.5], [-10],
      [-20.5], [-31], [-40.5]] },
  { op: 'Binomial', inputs: ['n', 'm'], rel: 1e-6, abs: 0,
    points: [[5, 2], [10, 3], [7, 0], [6, 6], [20, 10], [3, 5], [-3, 2], [-3, -5], [-5, -3], [4, -1],
      [30, 15], [60, 30], [200, 100], [300, 140]] },
  { op: 'Choose', inputs: ['n', 'm'], rel: 1e-6, abs: 0,
    points: [[5, 2], [10, 3], [20, 10], [-4, 3]] },
  { op: 'LCM', inputs: ['n', 'm'], rel: 0, abs: 0,
    points: [[12, 8], [7, 3], [4, 6], [0, 5], [-4, 6], [1000, 999]] },
  // Of reals that hold integers, the value is exact, also where a float
  // division is not (`LCM(406, 7)`) and for an odd quotient from 2^23, which
  // an addition of 0.5 rounds to an even one (`LCM(8388609, 1)`);
  // 2147483520 is the largest float below 2^31.
  { op: 'GCD', inputs: ['x', 'y'], rel: 0, abs: 0,
    points: [[12, 18], [-12, 8], [0, 5], [5, 0], [0, 0], [17, 5], [406, 7], [1000, 999], [16777216, 3],
      [2147483520, 2147483392]] },
  { op: 'LCM', inputs: ['x', 'y'], rel: 0, abs: 0,
    points: [[12, 18], [-12, 8], [0, 5], [5, 0], [0, 0], [17, 5], [406, 7], [1000, 999], [8388609, 1],
      [8388607, 1], [16777215, 1], [4194305, 3]] },
  // Of other reals: operands with a common divisor that is far above 1e-6
  // of the larger one, where a rounding of the shader cannot change which
  // remainder ends the loop.
  { op: 'GCD', inputs: ['x', 'y'], rel: 1e-6, abs: 0,
    points: [[12.5, 18], [7.5, 2], [-7.5, -2], [1.5, 2.5], [0.75, 0.5], [0.3, 0.1], [123456.75, 0.25], [0, 2.5],
      [1e30, 0.5], [0.5, 1e30]] },
  { op: 'LCM', inputs: ['x', 'y'], rel: 1e-6, abs: 0,
    points: [[12.5, 18], [7.5, 2], [-7.5, -2], [1.5, 2.5], [0.75, 0.5], [0.3, 0.1], [0, 2.5]] },
  // The colour of the multiplication table mod a slider `z`, which is a
  // real: at an integer `z` each operand of `GCD` holds an integer.
  { op: 'GCD', inputs: ['x', 'y', 'z'], rel: 1e-6, abs: 0,
    json: ['GCD', ['Mod', ['Multiply', ['Floor', ['Multiply', 'z', 'x']], ['Floor', ['Multiply', 'z', 'y']]], 'z'], 'z'],
    points: [[0.5, 0.5, 6], [0.9, 0.7, 12], [0.34, 0.77, 30], [0.2, 0.8, 7], [0.99, 0.99, 100], [0.5, 0.5, 6.5]] },
  { op: 'Heaviside', inputs: ['x'], rel: 0, abs: 0,
    points: [[-2], [-1e-30], [0], [1e-30], [3]] },
  { op: 'Remainder', inputs: ['n', 'm'], rel: 0, abs: 0,
    points: [[7, 3], [-7, 3], [7, -3], [-7, -3], [0, 3], [5, 2], [-5, 2], [5, -2], [-5, -2], [9, 6], [3, 6],
      [1000001, 7], [5, 0]] },
  { op: 'Remainder', inputs: ['x', 'y'], rel: 1e-6, abs: 1e-6,
    points: [[7.5, 2], [-7.5, 2], [7, 4], [-7, 4], [5.5, 1.5], [-0.25, 0.5], [0.25, 0.5], [100.3, 7], [1, 0],
      [3.75, -0.5]] },
  { op: 'Smoothstep', inputs: ['x', 'y', 'z'], rel: 1e-6, abs: 1e-7,
    points: [[0, 1, -0.5], [0, 1, 0], [0, 1, 0.25], [0, 1, 0.5], [0, 1, 1], [0, 1, 2], [2, -1, 0.5], [1, 1, 0.5],
      [1, 1, 1], [1, 1, 2]] },
  { op: 'InverseHaversine', inputs: ['x'], rel: 1e-6, abs: 1e-7,
    points: [[0], [1e-6], [0.25], [0.5], [0.9], [0.999], [1], [-0.5], [1.5]] },
  { op: 'ErfInv', inputs: ['x'], rel: 1e-6, abs: 1e-7,
    points: [[0], [1e-6], [-0.1], [0.3], [0.5], [-0.75], [0.9], [0.99], [-0.999], [0.999999], [1], [-1], [1.5]] },
  { op: 'Beta', inputs: ['x', 'y'], rel: 2e-5, abs: 1e-30,
    points: [[1, 1], [2, 3], [0.5, 0.5], [5, 2], [10.5, 12.25], [30, 40], [-0.5, 2], [-3, 2], [-1, 2], [0.1, 7]] },
  { op: 'Digamma', inputs: ['x'], rel: 4e-6, abs: 1e-6,
    points: [[0], [-1], [1], [2], [0.5], [1e-4], [5], [10.5], [100], [-0.5], [-2.25], [-10.75]] },
  { op: 'Trigamma', inputs: ['x'], rel: 1e-6, abs: 1e-7,
    points: [[0], [-1], [1], [2], [0.5], [1e-4], [5], [10.5], [100], [-0.5], [-2.25], [-10.75]] },
  { op: 'BesselJ', inputs: ['n', 'x'], rel: 1e-5, abs: 1e-6,
    points: [[0, 0], [1, 0], [0, 1], [0, 2.5], [0, 5], [1, 7.5], [2, 10], [0, 30], [1, -3], [-1, 3], [3, 0.5],
      [5, 12], [10, 30], [0, 100],
      // Near x = n + 5, where a power series cancels in single precision.
      [25, 29.9], [15, 19.9], [20, 24], [10, 14.5], [8, 12.5], [6, 10.5],
      [20, 200], [18, 180], [10, 7], [30, 10]] },
];

const programOf = (c: Case) =>
  ce.box((c.json ?? [c.op, ...c.inputs]) as never);

const compiledGlsl = (c: Case) => compile(programOf(c), IR_GLSL);

describe('the special functions compile on GLSL', () => {
  test.each(CASES.map((c) => [c.op, c] as const))('%s', (_, c) => {
    const r = compiledGlsl(c);
    expect(r.success).toBe(true);
  });
});

/** The value of the interpreter where it is a finite real, else the value
 *  of the compiled JavaScript. */
function expected(c: Case, point: number[]): number {
  const v =
    c.json === undefined
      ? ce.function(c.op, point.map(exact)).N()
      : programOf(c)
          .subs(
            Object.fromEntries(c.inputs.map((n, k) => [n, exact(point[k])]))
          )
          .N();
  // Past the largest float, the shader's value is ±∞.
  if (Number.isFinite(v.re) && (v.im ?? 0) === 0)
    return Math.abs(v.re) > 3.4028235677973366e38 ? v.re * Infinity : v.re;
  const js = compile(programOf(c), {
    profile: 'ir',
    fallback: false,
  });
  const args = Object.fromEntries(c.inputs.map((n, k) => [n, point[k]]));
  return Number((js.run as unknown as (a: object) => unknown)(args));
}

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

(chromiumAvailable() ? describe : describe.skip)(
  'the special functions in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the shaders give the interpreter values within the tolerance of each case', async () => {
      const items = CASES.flatMap((c) => {
        const r = compiledGlsl(c);
        const source = [
          '#version 300 es',
          'precision highp float;',
          'precision highp int;',
          ...c.inputs.map((n) => `uniform float u_${n};`),
          'out vec4 fragColor;',
          r.preamble ?? '',
          `void main() { ${c.inputs.map((n) => `float ${n} = u_${n};`).join(' ')} fragColor = vec4(${r.code}, 0.0, 0.0, 0.0); }`,
        ].join('\n');
        return c.points.map((p) => {
          const point = p.map(Math.fround);
          return {
            c,
            name: `${c.op}(${point.join(', ')})`,
            source,
            uniforms: Object.fromEntries(
              c.inputs.map((n, k) => [`u_${n}`, point[k]])
            ),
            expected: expected(c, point),
          };
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      const worst: Record<string, number> = {};
      values.forEach((v, k) => {
        const { c, name, expected: want } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        const got = v.value;
        if (!Number.isFinite(want) || !Number.isFinite(got)) {
          if (
            !Object.is(got, want) &&
            !(Number.isNaN(got) && Number.isNaN(want))
          )
            failures.push(`${name}: ${got} vs ${want}`);
          return;
        }
        const d = Math.abs(got - want);
        const e = d / Math.max(Math.abs(want), c.abs / (c.rel || 1));
        worst[c.op] = Math.max(
          worst[c.op] ?? 0,
          d / Math.max(Math.abs(want), 1e-300)
        );
        if (!(d <= Math.max(c.abs, c.rel * Math.abs(want))))
          failures.push(`${name}: ${got} vs ${want} (relative ${e})`);
      });
      if (process.env.CE_GLSL_SPECIAL_WORST) console.log(worst);
      expect(failures).toEqual([]);
    }, 120_000);
  }
);
