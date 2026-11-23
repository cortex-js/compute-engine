/**
 * CE-1467: a definite `Integrate` compiles on GLSL as the closed form that
 * the engine gives at compile time, with the guards of the JavaScript
 * target (`integral()` of `ir/lower.ts`). GLSL has no quadrature: an
 * integral with no closed form, or whose closed form a guard refuses, and
 * every `NIntegrate`, decline. Where the closed form is NaN (an integrable
 * singularity at a bound), GLSL gives NaN; JavaScript runs the quadrature
 * there.
 *
 * In WebGL 2 (SwiftShader, `scripts/glsl-check/glsl-driver.ts`) each shader
 * gives the interpreter's value (`N()`) within the precision of the target:
 * the native `cos` of SwiftShader has an absolute error of about 2e-4.
 * Without the browser the value tests are skipped.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';

type Json = unknown;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('a', 'real');

const glsl = (json: Json) =>
  compile(ce.box(json as never), { fallback: false, to: 'glsl' } as never);
const js = (json: Json) =>
  compile(ce.box(json as never), {
    fallback: false,
    to: 'javascript',
  } as never);

const sinFromZero = [
  'Integrate',
  ['Function', ['Sin', 't'], 't'],
  ['Limits', 't', 0, 'x'],
];
const gaussian = [
  'Integrate',
  ['Function', ['Exp', ['Negate', ['Power', 't', 2]]], 't'],
  ['Limits', 't', 0, 'x'],
];
const lnFromA = [
  'Integrate',
  ['Function', ['Ln', 't'], 't'],
  ['Limits', 't', 'a', 2],
];

describe('CE-1467: Integrate on GLSL', () => {
  test('an integral up to an input is its closed form', () => {
    const r = glsl(sinFromZero);
    expect(r.success).toBe(true);
    expect(r.code).toBe('((-cos(x)) + 1.0)');
  });

  test('a closed form with a special function', () => {
    const r = glsl(gaussian);
    expect(r.success).toBe(true);
    expect(r.code).toContain('_gpu_ir_erf(x)');
  });

  test('a body in the name of the Limits', () => {
    const r = glsl(['Integrate', ['Power', 't', 2], ['Limits', 't', 'a', 'x']]);
    expect(r.success).toBe(true);
  });

  test('a closed form that is NaN at a bound has no NaN arm', () => {
    // `a − a·ln(a) − 2 + 2·ln(2)`: GLSL has no quadrature to run at a = 0.
    const r = glsl(lnFromA);
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('isnan');
  });

  test('an integral with no closed form declines', () => {
    expect(() =>
      glsl([
        'Integrate',
        ['Function', ['Exp', ['Sin', 't']], 't'],
        ['Limits', 't', 0, 'x'],
      ])
    ).toThrow(/the region integrate/);
  });

  test('a closed form that a guard refuses declines', () => {
    // The guard refuses `sin(a·x)/a`, a divisor that the integrand does
    // not have (NaN at a = 0).
    expect(() =>
      glsl([
        'Integrate',
        ['Function', ['Cos', ['Multiply', 'a', 't']], 't'],
        ['Limits', 't', 0, 'x'],
      ])
    ).toThrow(/the region integrate/);
  });

  test('NIntegrate declines', () => {
    expect(() =>
      glsl(['NIntegrate', ['Function', ['Sin', 't'], 't'], 0, 'x'])
    ).toThrow(/the region integrate/);
  });

  test('JavaScript keeps the quadrature where the closed form is NaN', () => {
    const r = js(sinFromZero);
    expect(r.success).toBe(true);
    expect(r.code).toContain('Number.isNaN(');
    expect(r.code).toContain('_SYS.irIntegrate(');
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

function realShader(code: string, preamble: string, input: string) {
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    `uniform float ${input};`,
    'out vec4 fragColor;',
    preamble,
    `void main() { fragColor = vec4(${code}, 0.0, 0.0, 0.0); }`,
  ].join('\n');
}

/** The interpreter's value of `json` with `input` assigned `value`. */
function interpreter(json: Json, input: string, value: number): number {
  const engine = new ComputeEngine();
  engine.declare(input, 'real');
  engine.assign(input, value);
  return engine.box(json as never).N().re;
}

(chromiumAvailable() ? describe : describe.skip)(
  'CE-1467: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test.each([
      ['∫₀ˣ sin t dt', sinFromZero, 'x', [-3, -0.5, 0.25, 1, 2.5, 6]],
      ['∫₀ˣ e^(−t²) dt', gaussian, 'x', [-2, -0.3, 0.1, 0.8, 3]],
      ['∫ₐ² ln t dt', lnFromA, 'a', [0.25, 0.5, 1, 1.75]],
    ] as const)(
      '%s gives the interpreter value',
      async (label, json, input, points) => {
        const r = glsl(json);
        const items = points.map((p) => ({
          name: `${label} at ${p}`,
          source: realShader(r.code, r.preamble ?? '', input),
          uniforms: { [input]: p },
        }));
        const values = await driver.evaluate(items);
        const failures: string[] = [];
        points.forEach((p, k) => {
          const got = values[k];
          if (!got.ok) return failures.push(`${label} at ${p}: ${got.log}`);
          const want = interpreter(json, input, p);
          // SwiftShader's `cos` has an absolute error of about 2e-4.
          if (
            !(Math.abs(got.value - want) <= 5e-4 * Math.max(1, Math.abs(want)))
          )
            failures.push(`${label} at ${p}: ${got.value} vs ${want}`);
        });
        expect(failures).toEqual([]);
      },
      60_000
    );

    test('a closed form that is NaN at a bound is NaN', async () => {
      // The interpreter's value is 2·ln 2 − 2, about −0.6137: the quadrature,
      // which GLSL does not have.
      const r = glsl(lnFromA);
      const [v] = await driver.evaluate([
        {
          name: '∫₀² ln t dt',
          source: realShader(r.code, r.preamble ?? '', 'a'),
          uniforms: { a: 0 },
        },
      ]);
      expect(v.ok && Number.isNaN(v.value)).toBe(true);
    }, 60_000);
  }
);
