/**
 * `Sinc` in the profile `ir`: on JavaScript the kernel `sinc` of the runtime
 * (`_SYS.ir.sinc`, 0 at ±∞), on GLSL its Taylor polynomial below 0.5 and
 * `sin(x) / x` above; the
 * interval mode declines (`_IA.sinc` misses the extrema, CE-1436). The
 * operand is in radians under every angular unit, as the interpreter's.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { _jsProfileStats } from '../../src/compute-engine/js-profile-switch';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';

const ce = new ComputeEngine();
ce.declare('x', 'real');
const machine = new ComputeEngine({ precision: 'machine' });

/** The double `v` as an exact rational (a decimal literal is not the
 *  double that compiled code reads). */
function exact(engine: ComputeEngine, v: number) {
  if (Number.isInteger(v) || Math.abs(v) < 1e-6) return engine.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return engine.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

/** The interpreter's value at `x`. */
const interpret = (x: number, engine = ce): number =>
  engine.function('Sinc', [exact(engine, x)]).N().re;

const IR = { profile: 'ir', fallback: false } as const;

// prettier-ignore
const SPECIAL = [0, 5e-324, 1e-300, -1e-300, 1e-8, -1e-8, 0.3, 1, Math.PI, -2.5,
  4.493409457909064, 10, -50, 1e3, -1e6];
const GRID = Array.from({ length: 201 }, (_, k) => -50 + k / 2 + 0.0123);

describe('Sinc on JavaScript', () => {
  const r = compile(ce.box(['Sinc', 'x']), IR);
  const run = r.run as unknown as (p: { x: number }) => number;

  test('the kernel of the runtime', () => {
    expect(r.code).toContain('_SYS.ir.sinc(_.x)');
    let worst = 0;
    for (const x of [...SPECIAL, ...GRID]) {
      const got = run({ x });
      // The interpreter at machine precision computes with the same kernel.
      expect(got + 0).toBe(interpret(x, machine) + 0);
      worst = Math.max(worst, Math.abs(got - interpret(x)));
    }
    expect(worst).toBeLessThan(1e-15);
  });

  test('at 0, at large arguments and at ±∞', () => {
    expect(run({ x: 0 })).toBe(1);
    expect(run({ x: -0 })).toBe(1);
    expect(run({ x: 1e-300 })).toBe(1);
    expect(run({ x: 1e300 })).toBe(interpret(1e300, machine));
    expect(Math.abs(run({ x: 1e300 }))).toBeLessThanOrEqual(1e-300);
    expect(run({ x: Infinity })).toBe(0);
    expect(run({ x: -Infinity })).toBe(0);
    expect(run({ x: NaN })).toBeNaN();
  });

  test('a constant is folded', () => {
    const c = compile(ce.box(['Sinc', 2]), IR);
    expect(c.code).not.toContain('sinc');
    expect((c.run as unknown as () => number)()).toBe(interpret(2, machine));
  });

  test('the operand is in radians under the angular unit deg', () => {
    const deg = new ComputeEngine();
    deg.angularUnit = 'deg';
    deg.declare('x', 'real');
    const d = compile(deg.box(['Sinc', 'x']), IR);
    const f = d.run as unknown as (p: { x: number }) => number;
    expect(f({ x: 2 })).toBe(Math.sin(2) / 2);
    expect(f({ x: 2 })).toBeCloseTo(
      deg.function('Sinc', [deg.number(2)]).N().re,
      15
    );
  });
});

describe('NLimit of Sinc with the compiled path', () => {
  test.each([
    ['NegativeInfinity', ['Negate', 'PositiveInfinity']],
    ['PositiveInfinity', 'PositiveInfinity'],
    ['0', 0],
  ])('at %s', (_, point) => {
    const e = new ComputeEngine({ precision: 'machine' });
    e._jsProfile = {};
    const json = ['NLimit', ['Function', ['Sinc', 'x'], 'x'], point];
    const v = e.box(json as never).N().re;
    expect(_jsProfileStats(e).nlimit).toMatchObject({
      admitted: 1,
      declined: 0,
      failed: 0,
    });
    if (point === 0) expect(v).toBeCloseTo(1, 12);
    else expect(Math.abs(v)).toBeLessThan(1e-9);
    // The existing compiler gives the same samples.
    const off = new ComputeEngine({ precision: 'machine' });
    off._jsProfile = undefined;
    expect(v).toBe(off.box(json as never).N().re);
  });
});

const IR_GLSL = { to: 'glsl', profile: 'ir', fallback: false } as const;

describe('Sinc on GLSL', () => {
  test('the interpreter’s definition', () => {
    const r = compile(ce.box(['Sinc', 'x']), IR_GLSL);
    expect(r.success).toBe(true);
    expect(r.code).toMatch(
      /^\(abs\(x\) < 0\.5 \? 1\.0 - x \* x \* .* : sin\(x\) \/ x\)$/
    );
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
const GLSL_POINTS = [0, 1e-30, 1e-6, -0.3, 1, 2.5, -4.4934, 7.3, 35.9, -44.7,
  1000.3, 1e5];

(chromiumAvailable() ? describe : describe.skip)('Sinc in WebGL2', () => {
  let driver: GlslDriver;
  beforeAll(async () => {
    driver = await GlslDriver.start();
  }, 60_000);
  afterAll(async () => driver?.stop());

  test('the shader gives the interpreter values within single-float precision', async () => {
    const r = compile(ce.box(['Sinc', 'x']), IR_GLSL);
    const source = [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      'uniform float u_x;',
      'out vec4 fragColor;',
      r.preamble ?? '',
      `void main() { float x = u_x; fragColor = vec4(${r.code}, 0.0, 0.0, 0.0); }`,
    ].join('\n');
    const items = GLSL_POINTS.map((x) => ({
      name: `Sinc(${x})`,
      source,
      uniforms: { u_x: x },
      expected: interpret(Math.fround(x)),
    }));
    const values = await driver.evaluate(items);
    const failures: string[] = [];
    values.forEach((v, k) => {
      const { name, expected } = items[k];
      if (!v.ok) return failures.push(`${name}: ${v.log}`);
      // A few ulps of a float below 0.5 (the polynomial); above, the error
      // of the builtin `sin` of the renderer divided by |x| (SwiftShader
      // computes `sin` to about 1e-4, 1.8e-4 at x = -4.4934 and 35.9; as
      // `ir-slice-glsl.test.ts` allows for `Sin`).
      const x = Math.abs(GLSL_POINTS[k]);
      if (!(Math.abs(v.value - expected) <= 4e-7 + (x < 0.5 ? 0 : 2e-4 / x)))
        failures.push(`${name}: ${v.value} vs ${expected}`);
    });
    expect(failures).toEqual([]);
  }, 120_000);
});

describe('Sinc in the interval mode', () => {
  test('declines', () => {
    expect(() =>
      compile(ce.box(['Sinc', 'x']), {
        to: 'interval-js',
        profile: 'ir',
        fallback: false,
      } as never)
    ).toThrow(/Sinc \(the operation sinc\).* on interval-js$/);
  });
});
