/**
 * `FresnelC` and `FresnelS` in the profile `ir`: on JavaScript the kernels
 * `fresnelC` and `fresnelS` (`_SYS.ir.fresnelc`, `_SYS.ir.fresnels`), on
 * GLSL the helpers `_gpu_ir_fresnelc` and `_gpu_ir_fresnels` (every
 * coefficient table a `float[12]`, CE-1168); the interval mode declines.
 *
 * JavaScript gives the interpreter's value (`N()`, at the default precision
 * of 21 digits) within the error of the double kernel, which the
 * interpreter at machine precision gives exactly; GLSL gives it in WebGL 2
 * within single-float precision (1.8e-7 at most at the 12 points).
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';

const ce = new ComputeEngine();
ce.declare('x', 'real');
const machine = new ComputeEngine();
machine.precision = 'machine';
machine.declare('x', 'real');

const OPERATORS = ['FresnelC', 'FresnelS'] as const;

/** The double `v` as an exact rational: a decimal literal is not the
 *  double that compiled code reads (at x = 42.9877 the values differ by
 *  3e-15). */
function exact(engine: ComputeEngine, v: number) {
  // A tiny double as a rational has a denominator of a thousand bits, which
  // the interpreter does not finish; its decimal is close enough.
  if (Number.isInteger(v) || Math.abs(v) < 1e-6) return engine.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return engine.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

/** The interpreter's value at `x`. */
const interpret = (op: string, x: number, engine = ce): number =>
  engine.function(op, [exact(engine, x)]).N().re;

// 0, tiny, both branches of the kernel (|x| < 1.6 and above), the old GLSL
// cutoff 36, and large arguments.
// prettier-ignore
const SPECIAL = [0, 1e-300, -1e-300, 1e-8, -1e-8, 0.3, 1.5999, 1.6, -1.6, 2,
  -2.5, 5, 10, 35.9, 36, 36.1, 40, 49.99, 50, -50, 1e3, -1e6, 1e9, 1e17];
const GRID = Array.from({ length: 401 }, (_, k) => -50 + k / 4 + 0.0123);

describe('FresnelC and FresnelS on JavaScript', () => {
  test.each(OPERATORS)('%s: the kernel of the runtime', (op) => {
    const r = compile(ce.box([op, 'x'] as never), {
      profile: 'ir',
      fallback: false,
    });
    expect(r.code).toContain(`_SYS.ir.${op.toLowerCase()}(_.x)`);
    const run = r.run as unknown as (p: { x: number }) => number;
    let worst = 0;
    for (const x of [...SPECIAL, ...GRID]) {
      const got = run({ x });
      // The interpreter at machine precision computes with the same kernel
      // (and has no -0).
      expect(got + 0).toBe(interpret(op, x, machine));
      worst = Math.max(worst, Math.abs(got - interpret(op, x)));
    }
    // The error of the double kernel: 5.6e-16 at most at these points.
    expect(worst).toBeLessThan(1e-15);
  });

  test.each(OPERATORS)('%s of a constant is folded', (op) => {
    const r = compile(ce.box([op, 2] as never), {
      profile: 'ir',
      fallback: false,
    });
    expect(r.code).not.toContain('fresnel');
    expect((r.run as unknown as () => number)()).toBe(
      interpret(op, 2, machine)
    );
  });
});

const IR_GLSL = { to: 'glsl', profile: 'ir', fallback: false } as const;

describe('FresnelC and FresnelS on GLSL', () => {
  test.each(OPERATORS)('%s: a helper of float[12] tables', (op) => {
    const r = compile(ce.box([op, 'x'] as never), IR_GLSL);
    expect(r.success).toBe(true);
    expect(r.code).toBe(`_gpu_ir_${op.toLowerCase()}(x)`);
    expect(r.preamble).toContain(
      'float _gpu_ir_polevl(float x, float c[12], int n)'
    );
    // Every table is a `float[12]`: the only array size that the helper
    // accepts.
    expect(
      r.preamble!.match(/float\[\d+\]/g)!.every((t) => t === 'float[12]')
    ).toBe(true);
  });
});

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

// prettier-ignore
const GLSL_POINTS = [0, 1e-6, -0.3, 1, 1.5999, 1.6, -2.5, 7.3, 35.9, 36.5,
  -44.7, 50, 1000.3, 4097.25, -100000.3, 9999999, 1e7];

(chromiumAvailable() ? describe : describe.skip)(
  'FresnelC and FresnelS in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the shaders give the interpreter values within single-float precision', async () => {
      const items = OPERATORS.flatMap((op) => {
        const r = compile(ce.box([op, 'x'] as never), IR_GLSL);
        const source = [
          '#version 300 es',
          'precision highp float;',
          'precision highp int;',
          'uniform float u_x;',
          'out vec4 fragColor;',
          r.preamble ?? '',
          `void main() { float x = u_x; fragColor = vec4(${r.code}, 0.0, 0.0, 0.0); }`,
        ].join('\n');
        return GLSL_POINTS.map((x) => ({
          name: `${op}(${x})`,
          source,
          uniforms: { u_x: x },
          expected: interpret(op, Math.fround(x)),
        }));
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      let worst = 0;
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        const d = Math.abs(v.value - expected);
        worst = Math.max(worst, d);
        // A few ulps of a float in [0.5, 1) (the builtin `sin` of
        // SwiftShader is wrong by 1e-5).
        if (!(d <= 4e-7)) failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBe(2 * GLSL_POINTS.length);
    }, 120_000);
  }
);

// The kernels `_IA.fresnelC` and `_IA.fresnelS` move each end one ulp
// outward, and the double kernel can be wrong by more: `_IA.fresnelS` of
// [1.5, 1.7] has the upper end 0.6975049600820927, below S(1.5) =
// 0.6975049600820931. The mode declines rather than give an enclosure that
// misses.
describe('FresnelC and FresnelS in the interval mode', () => {
  test.each(OPERATORS)('%s declines', (op) => {
    expect(() =>
      compile(ce.box([op, 'x'] as never), {
        to: 'interval-js',
        profile: 'ir',
        fallback: false,
      } as never)
    ).toThrow(
      new RegExp(
        `${op} \\(the operation ${op.toLowerCase()}\\).* on interval-js$`
      )
    );
  });
});
