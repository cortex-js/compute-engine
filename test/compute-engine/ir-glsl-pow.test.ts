/**
 * `Power` of the profile `ir` on the `glsl` target
 * (`src/compute-engine/compilation/ir/print-glsl.ts`, `_gpu_ir_pow`).
 *
 * - The printed form: a literal exponent from 1 to 16 is a product (the
 *   pass `strength`); a base `>= 0` (`nonnegative()` of `print.ts`) calls
 *   `_gpu_ir_pow_nonnegative`, another base `_gpu_ir_pow`. Both bodies are
 *   selects with no branch and no loop.
 * - The values in WebGL2 (the headless Chromium of
 *   `scripts/glsl-check/glsl-driver.ts`) against the interpreter: a negative
 *   base with an integer and a non-integer exponent, a zero base, a large
 *   exponent. NaN where the interpreter's value is not real; NaN or ±∞ at a
 *   pole. Without the browser, these tests are skipped.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import { interpret, makeEngine, type Point } from './ir-slice-oracle';

const ce = makeEngine();
const glsl = (json: unknown) =>
  compile(ce.box(json as never), {
    to: 'glsl',
    profile: 'ir',
    fallback: false,
  });

describe('IR profile on GLSL: the printed form of Power', () => {
  test.each([
    [['Power', 'x', 1], 'x'],
    [['Power', 'x', 2], '(x * x)'],
    [['Power', 'x', 3], '((x * x) * x)'],
    [['Power', ['Sin', 'x'], 2], 'float v1 = sin(x);\nreturn (v1 * v1);'],
  ])('%j is a product, with no helper', (json, code) => {
    const r = glsl(json);
    expect(r.code).toBe(code);
    expect(r.preamble ?? '').not.toMatch(/_gpu_ir_pow/);
  });

  test('a literal exponent of 16 is a product of 16 factors', () => {
    const r = glsl(['Power', 'x', 16]);
    expect(r.code.match(/\bx\b/g)).toHaveLength(16);
    expect(r.preamble ?? '').not.toMatch(/_gpu_ir_pow/);
  });

  test.each([
    [['Power', 'x', 'y'], '_gpu_ir_pow(x, y)'],
    [['Power', 'x', 17], '_gpu_ir_pow(x, 17.0)'],
    [['Power', 'x', -2], '_gpu_ir_pow(x, (-2.0))'],
    [['Power', 'x', 1.5], '_gpu_ir_pow(x, 1.5)'],
    [['Power', 'x', ['Divide', 1, 'y']], '_gpu_ir_pow(x, (1.0 / y))'],
    // A guard that does not bound the base.
    [['If', ['Less', 'y', 0], ['Power', 'x', 'y'], 0], /_gpu_ir_pow\(x, y\)/],
    [['If', ['Less', 'x', 1], ['Power', 'x', 'y'], 0], /_gpu_ir_pow\(x, y\)/],
    // The base is read in the else arm.
    [['If', ['Less', 0, 'x'], 0, ['Power', 'x', 'y']], /_gpu_ir_pow\(x, y\)/],
  ])('%j calls the general helper', (json, code) => {
    const r = glsl(json);
    if (typeof code === 'string') expect(r.code).toBe(code);
    else expect(r.code).toMatch(code);
    expect(r.preamble).toMatch(/^float _gpu_ir_pow\(float a, float b\) \{$/m);
    expect(r.preamble).not.toMatch(/_gpu_ir_pow_nonnegative/);
  });

  // A base `>= 0`: a constant, `abs`, `sqrt`, a square, a sum of such
  // values, or a value that the condition of an enclosing `if` bounds below
  // by a constant `>= 0`.
  test.each([
    [['Power', 2, 'x'], '_gpu_ir_pow_nonnegative(2.0, x)'],
    [['Power', ['Abs', 'x'], 'y'], '_gpu_ir_pow_nonnegative(abs(x), y)'],
    [['Power', ['Sqrt', 'x'], 'y'], '_gpu_ir_pow_nonnegative(sqrt(x), y)'],
    [
      ['Power', ['Multiply', 'x', 'x'], 'y'],
      '_gpu_ir_pow_nonnegative((x * x), y)',
    ],
    [
      ['Power', ['Add', 1, ['Multiply', 'x', 'x']], 'y'],
      '_gpu_ir_pow_nonnegative(((x * x) + 1.0), y)',
    ],
    [
      ['If', ['Less', 0, 'x'], ['Power', 'x', 'y'], 0],
      /_gpu_ir_pow_nonnegative\(x, y\)/,
    ],
    [
      ['If', ['GreaterEqual', 'x', 0.5], ['Power', 'x', 'y'], 0],
      /_gpu_ir_pow_nonnegative\(x, y\)/,
    ],
    [
      [
        'If',
        ['And', ['Less', 0, 'x'], ['Less', 'x', 1]],
        ['Power', 'x', 'y'],
        0,
      ],
      /_gpu_ir_pow_nonnegative\(x, y\)/,
    ],
    // A power of a base `>= 0`, under a guard.
    [
      ['If', ['Less', 0, 'x'], ['Power', ['Power', 'x', 'y'], 'y'], 0],
      /_gpu_ir_pow_nonnegative\(_gpu_ir_pow_nonnegative\(x, y\), y\)/,
    ],
  ])('%j calls the helper of a base >= 0', (json, code) => {
    const r = glsl(json);
    if (typeof code === 'string') expect(r.code).toBe(code);
    else expect(r.code).toMatch(code);
    expect(r.preamble).not.toMatch(/^float _gpu_ir_pow\(/m);
    expect(r.preamble).toMatch(
      /^float _gpu_ir_pow_nonnegative\(float a, float b\) \{$/m
    );
  });

  test('the helpers have no branch and no loop, and call pow once', () => {
    const r = glsl(['Add', ['Power', 'x', 'y'], ['Power', ['Abs', 'x'], 'y']]);
    for (const name of ['_gpu_ir_pow', '_gpu_ir_pow_nonnegative']) {
      const helper = new RegExp(`^float ${name}\\([\\s\\S]*?^\\}$`, 'm').exec(
        r.preamble ?? ''
      )![0];
      expect(helper).not.toMatch(/\b(if|for|while)\b/);
      expect(helper).not.toMatch(/\?/);
      expect(helper.match(/\bpow\(/g)).toHaveLength(1);
    }
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
const VALUES: [unknown, Point[], check?: 'exact' | 'ulps'][] = [
  [['Power', 'x', 'y'], [
    // A negative base: an integer exponent, in the product range and out
    // of it, positive and negative; a non-integer one (not real).
    { x: -2, y: 3 }, { x: -2, y: 4 }, { x: -1.5, y: 7 }, { x: -3, y: 15 },
    { x: -1.25, y: 16 }, { x: -1.25, y: 17 }, { x: -2, y: 20 }, { x: -2, y: -3 },
    { x: -0.5, y: -4 }, { x: -1.5, y: 2.5 }, { x: -2, y: 0.5 }, { x: -2, y: -0.5 },
    // A zero base.
    { x: 0, y: 2 }, { x: 0, y: 0.5 }, { x: 0, y: 17 }, { x: 0, y: 0 },
    { x: 0, y: -2 }, { x: 0, y: -0.5 },
    // A positive base; a large exponent.
    { x: 1.5, y: 2.5 }, { x: 3, y: -0.5 }, { x: 2, y: 0 }, { x: 1.1, y: 100 },
    { x: 0.99, y: 1000 }, { x: 3, y: 16 }, { x: 0.5, y: -20 }, { x: 7, y: 1 },
  ]],
  [['Power', 'x', 1.5], [{ x: -2 }, { x: 0 }, { x: 2.25 }]],
  [['Power', 'x', -2], [{ x: -2 }, { x: 0.5 }, { x: 0 }]],
  [['Power', 'x', 20], [{ x: -1.5 }, { x: 0.9 }]],
  // A base `>= 0`: `_gpu_ir_pow_nonnegative`.
  [['Power', ['Abs', 'x'], 'y'], [
    { x: -2, y: 2.5 }, { x: -0.5, y: -3 }, { x: -3, y: 2 }, { x: 0, y: 0 },
    { x: 0, y: -1 }, { x: 0, y: 1.5 }, { x: -1.1, y: 100 },
  ]],
  [['Power', 2, 'x'], [{ x: 10 }, { x: -3 }, { x: 0.5 }, { x: 0 }]],
  [['If', ['Less', 0, 'x'], ['Power', 'x', 'y'], 0], [
    { x: 0.5, y: -2 }, { x: 2, y: 3 }, { x: 3, y: 16 }, { x: 0.3, y: 0.7 },
    { x: -1, y: 2 }, { x: 0, y: -1 },
  ]],
  // A NaN base (`Ln` and `Sqrt` of a negative number): NaN, also for a
  // non-integer exponent and one above 16 (SwiftShader's `pow(NaN, 0.5)`
  // is finite).
  [['Power', ['Ln', 'x'], 'y'], [{ x: -1, y: 0.5 }, { x: -1, y: 0.25 }, { x: -1, y: 17 }, { x: 0.5, y: 0.5 }]],
  [['Power', ['Sqrt', 'x'], 'y'], [{ x: -1, y: 0.5 }, { x: -1, y: 17 }]],
  // An integer exponent from 1 to 16: of a base `>= 0`, the builtin, within
  // 8 ulps (10^3 is 999.99994, 3^14 is 4782966); otherwise the exact
  // product.
  [['Power', 10, 'n'], [1, 2, 3, 4, 5, 6, 7].map((n) => ({ n })), 'ulps'],
  [['Power', 3, 'n'], [{ n: 14 }, { n: 15 }], 'ulps'],
  [['Power', 'x', 'n'], [{ x: -3, n: 13 }, { x: 10, n: 5 }, { x: -10, n: 7 }, { x: -3, n: 14 }], 'exact'],
];

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile on GLSL: the values of Power in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the shaders give the interpreter values within single-float precision', async () => {
      const items = VALUES.flatMap(([json, points, check]) => {
        const r = glsl(json);
        const inputs = r.freeSymbols!;
        const body = r.code.includes(';') ? r.code : `return ${r.code};`;
        const source = [
          '#version 300 es',
          'precision highp float;',
          'precision highp int;',
          ...inputs.map((n) => `uniform float u_${n};`),
          'out vec4 fragColor;',
          r.preamble ?? '',
          `float userFn(${inputs.map((n) => `float ${n}`).join(', ')}) {`,
          body,
          '}',
          'void main() {',
          `  fragColor = vec4(userFn(${inputs.map((n) => `u_${n}`).join(', ')}), 0.0, 0.0, 0.0);`,
          '}',
        ].join('\n');
        return points.map((p) => ({
          name: `${JSON.stringify(json)} at ${JSON.stringify(p)}`,
          source,
          uniforms: Object.fromEntries(
            inputs.map((n) => [`u_${n}`, Number(p[n as keyof Point])])
          ),
          expected: interpret(ce, ce.box(json as never), p),
          check,
        }));
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected: e, check } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        // A pole: NaN or an infinity.
        if (e === 'complex-infinity' || e === Infinity || e === -Infinity) {
          if (Number.isFinite(v.value))
            failures.push(`${name}: ${v.value} vs ${String(e)}`);
          return;
        }
        // Not a real value: NaN.
        if (
          typeof e === 'object' ||
          (typeof e === 'number' && Number.isNaN(e))
        ) {
          if (!Number.isNaN(v.value))
            failures.push(`${name}: ${v.value} vs ${JSON.stringify(e)}`);
          return;
        }
        if (typeof e !== 'number')
          return failures.push(`${name}: interpreter ${String(e)}`);
        if (check === 'exact') {
          if (v.value !== Math.fround(e))
            failures.push(`${name}: ${v.value} vs exactly ${e}`);
          return;
        }
        if (check === 'ulps') {
          if (!(Math.abs(v.value - e) <= 8 * 2 ** -23 * Math.abs(e)))
            failures.push(`${name}: ${v.value} vs ${e} within 8 ulps`);
          return;
        }
        // The builtin is `exp2(b * log2(a))`: its relative error grows with
        // `|log2|` of the result (SwiftShader: 6e-5 at 0.99^1000), and it
        // gives 8e-20 for 0^0.5 (an absolute error below 1e-18 at 0).
        const scale =
          e === 0 ? 1 : Math.max(1, Math.abs(Math.log2(Math.abs(e))));
        if (
          !(
            Math.abs(v.value - e) <= Math.max(1e-18, 5e-6 * scale * Math.abs(e))
          )
        )
          failures.push(`${name}: ${v.value} vs ${e}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBe(70);
    }, 120_000);
  }
);
