/**
 * `Mandelbrot(c, n)` and `Julia(z, c, n)` in the profile `ir` (CE-1523):
 * the smooth escape time of `z -> z^2 + c`, the interpreter's
 * `escapeTime()` (`numerics/fractal-smooth.ts`), on the complex lane.
 *
 * JavaScript gives the interpreter's value at each point. Where the
 * interpreter leaves the call unevaluated (a point that is not finite, a
 * count that is not positive), compiled code gives NaN. In WebGL 2 (SwiftShader) each shader gives the
 * interpreter's value within 1e-4, at points whose orbit escapes far from
 * the escape radius or stays inside the set, where single precision does
 * not change the iteration at which the orbit escapes. The interval target
 * has no complex lane, and declines.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('n', 'integer');

const IR = { profile: 'ir', fallback: false } as const;

const POINT = ['Add', 'x', ['Multiply', 'y', 'ImaginaryUnit']];

// prettier-ignore
const PROGRAMS: [label: string, json: unknown][] = [
  ['Mandelbrot of x + y·i', ['Mandelbrot', POINT, 256]],
  ['Mandelbrot of a count input', ['Mandelbrot', POINT, 'n']],
  ['Mandelbrot of a real', ['Mandelbrot', 'x', 'n']],
  ['Julia of x + y·i', ['Julia', POINT, ['Complex', -0.8, 0.156], 'n']],
];

// prettier-ignore
const POINTS = [
  { x: -1, y: 0.3, n: 50 }, { x: 0.3, y: 0.5, n: 20 }, { x: -0.1, y: 0.1, n: 30 },
  { x: 0.5, y: 0.5, n: 64 }, { x: -2.5, y: 0.25, n: 40 }, { x: 0, y: 1.2, n: 100 },
  { x: 3, y: -3, n: 10 }, { x: -0.75, y: 0.2, n: 256 },
];

/** Points where the interpreter leaves the call unevaluated: NaN. */
const UNEVALUATED = [{ x: 2, y: 2, n: 0 }, { x: Infinity, y: 0, n: 10 }];

function interpreted(json: unknown, point: Record<string, number>) {
  const v = ce
    .box(json as never)
    .subs(point as never)
    .evaluate()
    .N();
  return isNumber(v) ? v.re : NaN;
}

describe('IR profile, Mandelbrot and Julia', () => {
  test.each(PROGRAMS)('%s gives the interpreter value', (_, json) => {
    const r = compile(ce.box(json as never), IR);
    expect(r.success).toBe(true);
    for (const p of [...POINTS, ...UNEVALUATED]) {
      const got = r.run!(p as never) as number;
      expect(got).toBe(interpreted(json, p));
    }
  });

  test('a count that is not positive gives NaN', () => {
    const r = compile(ce.box(['Mandelbrot', POINT, 'n'] as never), IR);
    expect(r.run!({ x: 2, y: 2, n: 0 } as never)).toBeNaN();
    expect(r.run!({ x: 2, y: 2, n: -3 } as never)).toBeNaN();
    // The interpreter leaves the call unevaluated.
    expect(
      ce.box(['Mandelbrot', 2, 0] as never).evaluate().operator
    ).toBe('Mandelbrot');
  });

  test('a constant point folds', () => {
    const r = compile(ce.box(['Mandelbrot', ['Complex', -1, 0.3], 50]), IR);
    expect(r.run!({} as never)).toBe(interpreted(['Mandelbrot', ['Complex', -1, 0.3], 50], {}));
  });

  test('GLSL calls the escape-time helper', () => {
    const r = compile(ce.box(['Mandelbrot', POINT, 'n'] as never), {
      ...IR,
      to: 'glsl',
    });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/^_gpu_ir_julia\(vec2\(0\.0\), /);
    expect(r.preamble).toMatch(/float _gpu_ir_fractal_smooth\(/);
  });

  test('the interval target declines', () => {
    expect(() =>
      compile(ce.box(['Mandelbrot', POINT, 'n'] as never), {
        ...IR,
        to: 'interval-js',
      })
    ).toThrow(/complex/);
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

(chromiumAvailable() ? describe : describe.skip)(
  'Mandelbrot and Julia in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the shaders give the interpreter values within 1e-4', async () => {
      const items = PROGRAMS.flatMap(([label, json]) => {
        const r = compile(ce.box(json as never), { ...IR, to: 'glsl' });
        const source = [
          '#version 300 es',
          'precision highp float;',
          'precision highp int;',
          'uniform float u_x;',
          'uniform float u_y;',
          'uniform float u_n;',
          'out vec4 fragColor;',
          r.preamble ?? '',
          `void main() { float x = u_x; float y = u_y; float n = u_n; fragColor = vec4(${r.code}, 0.0, 0.0, 0.0); }`,
        ].join('\n');
        return [...POINTS, ...UNEVALUATED].map((p) => {
          const q = { x: Math.fround(p.x), y: Math.fround(p.y), n: p.n };
          return {
            name: `${label} at ${JSON.stringify(q)}`,
            source,
            uniforms: { u_x: q.x, u_y: q.y, u_n: q.n },
            expected: interpreted(json, q),
          };
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (Number.isNaN(expected)) {
          if (!Number.isNaN(v.value)) failures.push(`${name}: ${v.value} vs NaN`);
        } else if (!(Math.abs(v.value - expected) <= 1e-4))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
    }, 60_000);
  }
);
