/**
 * CE-1534: the functions of a complex number and the special functions of
 * the zeta family that 0.193.0's GPU target compiled, on the GLSL printer of
 * the profile `ir` (`print-glsl.ts`, `glsl-zeta-helpers.ts`).
 *
 * - The complex lane: `Sec`, `Csc`, their composition `Csc(Sec(x + iy))`
 *   (a Desmos domain colouring, Tycho D-263), `Sech`, `Csch`, `Coth`, the
 *   inverse trigonometric and hyperbolic functions, `Log` of base 10 and
 *   `Root` compile with a complex operand, in the strict and in the complex
 *   mode; `Tan` and `Tanh` divide by a sum of squares (CE-1506).
 * - The zeta family of real operands: `PolyGamma`, `HurwitzZeta`,
 *   `Zeta(s, a)`, `LerchPhi` and `PolyLog`.
 *
 * In WebGL 2 (SwiftShader, `scripts/glsl-check/glsl-driver.ts`) each shader
 * gives the interpreter's value (`N()`) within the tolerance of its case:
 * SwiftShader's `sin` and `cos` are exact to an absolute 1e-7 only, which
 * is 1e-4 relative at 1e-3 (`sin(1e-3)`) and next to a pole. Without the
 * browser the value tests are skipped.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';

type Json = unknown;
type Cx = { re: number; im: number };

const ce = new ComputeEngine();
ce.declare('w', 'complex');
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('t', 'real');
ce.declare('n', 'integer');

const glsl = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), {
    profile: 'ir',
    fallback: false,
    to: 'glsl',
    ...options,
  } as never);

const Z: Json = ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'y']];

const COMPLEX_HEADS = [
  'Sec',
  'Csc',
  'Tan',
  'Tanh',
  'Sech',
  'Csch',
  'Coth',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Arsinh',
  'Arcosh',
  'Artanh',
  'Arccsc',
  'Arcsec',
  'Arsech',
  'Arcoth',
  'Log',
  'Lg',
  'Log10',
];

describe('CE-1534: the complex functions compile on GLSL', () => {
  test('Csc(Sec(x + iy)), in the strict and in the complex mode', () => {
    for (const mode of ['strict', 'complex']) {
      const r = glsl(['Csc', ['Sec', Z]], { mode });
      expect(r.success).toBe(true);
      expect(r.code).toMatch(/^_gpu_ir_ccsc\(_gpu_ir_csec\(/);
    }
  });

  test.each(COMPLEX_HEADS)('%s of a complex', (head) => {
    for (const mode of ['strict', 'complex']) {
      expect(glsl([head, 'w'], { mode }).success).toBe(true);
      expect(glsl([head, Z], { mode }).success).toBe(true);
    }
  });

  test('Root of a complex radicand', () => {
    for (const mode of ['strict', 'complex']) {
      expect(glsl(['Root', 'w', 3], { mode }).code).toMatch(/_gpu_ir_croot/);
      expect(glsl(['Root', 'w', 't'], { mode }).code).toMatch(/_gpu_ir_croot/);
    }
  });

  test('each helper is defined before the helpers that call it', () => {
    const r = glsl(['Add', ['Arccsc', 'w'], ['Arsech', 'w'], ['Arctan', 'w']]);
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
});

describe('CE-1534: the zeta family compiles on GLSL', () => {
  test.each([
    ['PolyGamma', ['PolyGamma', 'n', 'x']],
    ['HurwitzZeta', ['HurwitzZeta', 'x', 'y']],
    ['Zeta(s, a)', ['Zeta', 'x', 'y']],
    ['LerchPhi', ['LerchPhi', 'x', 'y', 't']],
    ['PolyLog', ['PolyLog', 'x', 'y']],
  ])('%s', (_, json) => {
    // The inputs `x`, `y` and `t`: the ported helpers carry no comment, in
    // which an input name could read as a call (`x (x+1)`), which the
    // adapter refuses.
    expect(glsl(json).success).toBe(true);
  });
});

test('CE-1534: Zeta(s, a) on JavaScript gives the interpreter value', () => {
  const f = compile(ce.box(['Zeta', 'x', 'y']), {
    profile: 'ir',
    fallback: false,
  });
  for (const [s, a] of [
    [2, 0.5],
    [2, -0.5],
    [0.5, 0],
    [-1.5, -2.25],
    [3, 10],
    [0, -3],
  ]) {
    const want = ce.box(['Zeta', s, a]).N().re;
    const got = (f.run as (v: object) => number)({ x: s, y: a });
    expect([s, a, Math.abs(got - want) <= 1e-12 * Math.abs(want)]).toEqual([
      s,
      a,
      true,
    ]);
  }
  // The pole at s = 1 is +∞.
  expect((f.run as (v: object) => number)({ x: 1, y: 2 })).toBe(Infinity);
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
const P = (re: number, im: number): Cx => ({ re: fr(re), im: fr(im) });
const H = Math.PI / 2;
// Off the axes, on the axes and the cuts, next to the poles (of `sec` at
// π/2, of `csc` at 0 and π, of `tanh` and `sech` at iπ/2, of `csch` and
// `coth` at iπ), next to the branch points ±1, and far from 0.
const POINTS: Cx[] = [
  P(0.5, -0.75), P(-1.25, 0.4), P(2, 1.5), P(0.3, 0.2), P(-3, -2.5),
  P(10, 0.5), P(0.1, 30), P(-0.7, -30), P(40, 0.2), P(-40, -1.3),
  P(2, 0), P(-2, 0), P(0.5, 0), P(-0.5, 0), P(0, 2), P(0, -2), P(0, 0.5),
  P(1e-3, 1e-3), P(H - 1e-3, 1e-3), P(H - 1e-4, 1e-4), P(Math.PI - 1e-3, -1e-3),
  P(1e-3, H - 1e-3), P(1e-3, Math.PI - 1e-3), P(1, 1e-3), P(-1, -1e-3),
  P(0.999, 0), P(1.001, 0), P(-0.999, 0), P(-1.001, 0),
  // Far from 0 and next to 0, where an intermediate overflows or
  // underflows (`Cot(0.3 + 90i)`, `Cot(1e-30)`, CE-1547).
  P(0.3, 90), P(1e-30, 0), P(0, 1e-30),
];

// prettier-ignore
const COMPLEX_CASES: [label: string, json: Json, rel: number][] = [
  ['Sec', ['Sec', 'w'], 1e-3],
  ['Cot', ['Cot', 'w'], 1e-3],
  ['Ln', ['Ln', 'w'], 1e-4],
  ['Root(w, 2)', ['Root', 'w', 2], 1e-6],
  ['Csc', ['Csc', 'w'], 1e-3],
  ['Csc(Sec(w))', ['Csc', ['Sec', 'w']], 1e-3],
  ['Tan', ['Tan', 'w'], 1e-3],
  ['Tanh', ['Tanh', 'w'], 1e-3],
  ['Sech', ['Sech', 'w'], 1e-3],
  ['Csch', ['Csch', 'w'], 1e-3],
  ['Coth', ['Coth', 'w'], 1e-3],
  ['Arcsin', ['Arcsin', 'w'], 1e-6],
  ['Arccos', ['Arccos', 'w'], 1e-6],
  ['Arctan', ['Arctan', 'w'], 1e-6],
  ['Arsinh', ['Arsinh', 'w'], 1e-6],
  ['Arcosh', ['Arcosh', 'w'], 1e-6],
  ['Artanh', ['Artanh', 'w'], 1e-6],
  ['Arccsc', ['Arccsc', 'w'], 1e-6],
  ['Arcsec', ['Arcsec', 'w'], 1e-6],
  ['Arsech', ['Arsech', 'w'], 1e-6],
  ['Arcoth', ['Arcoth', 'w'], 1e-6],
  ['Log', ['Log', 'w'], 1e-4],
  ['Root(w, 3)', ['Root', 'w', 3], 1e-3],
];

/** The interpreter's value at `w`, or `undefined` where it is not finite
 *  (a value that underflows or overflows a double there). */
function interpreted(json: Json, w: Cx): Cx | undefined {
  const v = ce
    .box(json as never)
    .subs({ w: ce.number(ce.complex(w.re, w.im)) })
    .N();
  return Number.isFinite(v.re) && Number.isFinite(v.im)
    ? { re: v.re, im: v.im }
    : undefined;
}

function complexShader(code: string, preamble: string, part: '.x' | '.y') {
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'uniform float u_re;',
    'uniform float u_im;',
    'out vec4 fragColor;',
    preamble,
    `vec2 userFn(vec2 w) { ${code.includes(';') ? code : `return ${code};`} }`,
    `void main() { fragColor = vec4(userFn(vec2(u_re, u_im))${part}, 0.0, 0.0, 0.0); }`,
  ].join('\n');
}

/** The double `v` as an exact rational (a decimal literal is not the
 *  float that the shader reads). */
function exact(v: number) {
  if (Number.isInteger(v) || !Number.isFinite(v) || Math.abs(v) < 1e-6)
    return ce.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return ce.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

const grid = (...ls: number[][]): number[][] =>
  ls.reduce<number[][]>(
    (acc, l) => acc.flatMap((p) => l.map((v) => [...p, v])),
    [[]]
  );

type RealCase = {
  op: string;
  inputs: string[];
  points: number[][];
};

// prettier-ignore
const REAL_CASES: RealCase[] = [
  { op: 'PolyGamma', inputs: ['n', 'x'],
    points: grid([-1, 0, 1, 2, 3, 5, 10], [0.5, 1, 2.5, 10, 100, -0.5, -1.25, -2.75, 0, -3, 1e-3, 7.3]) },
  { op: 'HurwitzZeta', inputs: ['x', 'y'],
    points: [...grid([2, 3.5, 0.5, -1, -2.5, 1.5, 0, 1, 10, -7.5], [0.3, 1, 2.5, 10, 50]),
      // A negative base point: an integer order (another one is complex).
      ...grid([-1, -2, -3, -6, -11, -20, -22, -24], [-0.5, -1.5, -2.25, -7.75])] },
  { op: 'Zeta', inputs: ['x', 'y'],
    points: [...grid([2, 3.5, 0.5, -1, -2.5, 1.5, 0, 1], [0.3, 1, 2.5, 0, -0.5, -2]),
      ...grid([-1, -3, -6, -20, -24], [-0.5, -1.5, -2.25])] },
  { op: 'LerchPhi', inputs: ['x', 'y', 't'],
    points: grid([0.5, -0.5, -1, -3, 0.9, 0, -50], [2, 1, 0.5, -1, -2.5, 3], [1, 0.5, 3]) },
  { op: 'PolyLog', inputs: ['x', 'y'],
    points: grid([2, 3, 1, 0, -1, -2.5, 0.5, 1.5], [0.5, -0.5, -1, -5, 0.9, -100, 0, 0.99]) },
];

(chromiumAvailable() ? describe : describe.skip)(
  'CE-1534: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the complex functions give the interpreter value', async () => {
      const items = COMPLEX_CASES.flatMap(([label, json, rel]) => {
        const r = glsl(json);
        return POINTS.flatMap((w) => {
          const want = interpreted(json, w);
          // Past the largest float the shader overflows.
          const scale = want && Math.hypot(want.re, want.im);
          if (want === undefined || !(scale! < 3.4e38)) return [];
          return (['.x', '.y'] as const).map((part) => ({
            name: `${label} at (${w.re}, ${w.im})${part}`,
            source: complexShader(r.code, r.preamble ?? '', part),
            uniforms: { u_re: w.re, u_im: w.im },
            expected: part === '.x' ? want.re : want.im,
            // Below the smallest float, any value that rounds there.
            tolerance: rel * scale + 1.2e-38,
          }));
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected, tolerance } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (!(Math.abs(v.value - expected) <= tolerance))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThan(1000);
    }, 300_000);

    test('Sqrt and Ln of a complex with no overflow or underflow of |z|^2 (CE-1547)', async () => {
      // prettier-ignore
      const cases: [Json, Cx][] = [
        [['Root', 'w', 2], P(1e-30, 0)], [['Root', 'w', 2], P(0, 1e-30)],
        [['Root', 'w', 2], P(-1e37, 3e37)], [['Root', 'w', 2], P(1e20, 1)],
        [['Ln', 'w'], P(1e-30, 0)], [['Ln', 'w'], P(-1e37, 3e37)], [['Ln', 'w'], P(1e20, 1)],
      ];
      const items = cases.flatMap(([json, w]) => {
        const r = glsl(json);
        const want = interpreted(json, w)!;
        const scale = Math.hypot(want.re, want.im);
        return (['.x', '.y'] as const).map((part) => ({
          name: `${JSON.stringify(json)} at (${w.re}, ${w.im})${part}`,
          source: complexShader(r.code, r.preamble ?? '', part),
          uniforms: { u_re: w.re, u_im: w.im },
          expected: part === '.x' ? want.re : want.im,
          tolerance: 1e-6 * scale,
        }));
      });
      const values = await driver.evaluate(items);
      const failures = values.flatMap((v, k) =>
        v.ok && Math.abs(v.value - items[k].expected) <= items[k].tolerance
          ? []
          : [`${items[k].name}: ${v.ok ? v.value : v.log} vs ${items[k].expected}`]
      );
      expect(failures).toEqual([]);
    }, 120_000);

    test('PolyLog(1, z) / z next to 0 is about 1', async () => {
      const r = glsl(['Divide', ['PolyLog', 'x', 'y'], 'y']);
      const source = [
        '#version 300 es',
        'precision highp float;',
        'precision highp int;',
        'uniform float u_x;',
        'uniform float u_y;',
        'out vec4 fragColor;',
        r.preamble ?? '',
        `void main() { float x = u_x; float y = u_y; fragColor = vec4(${r.code}, 0.0, 0.0, 0.0); }`,
      ].join('\n');
      const points = [1e-8, -1e-8, 1e-4, -0.2, 0.2, 0.3].map(fr);
      const values = await driver.evaluate(
        points.map((y) => ({ name: `${y}`, source, uniforms: { u_x: 1, u_y: y } }))
      );
      values.forEach((v, k) => {
        const y = points[k];
        const want = -Math.log1p(-y) / y;
        expect([y, v.ok && Math.abs(v.value - want) <= 1e-6 * want]).toEqual([y, true]);
      });
    }, 120_000);

    test('the zeta family: small values, and a truncated integral', async () => {
      // prettier-ignore
      const cases: [Json, number[], 'value' | 'value-or-nan'][] = [
        // A leading term of 5e-39, which a GPU flushes to 0.
        [['PolyGamma', 'n', 'x'], [20, 500], 'value'],
        // (1 - z)² overflows.
        [['PolyLog', 'x', 'y'], [-1, -1e20], 'value'],
        // The integral stopped where the tail of Gamma(50) passes 3e-5.
        [['LerchPhi', 'x', 'y', 't'], [-3, 50, 1], 'value-or-nan'],
      ];
      const items = cases.map(([json, point, kind]) => {
        const inputs = (json as string[]).slice(1);
        const r = glsl(json);
        const p = point.map(fr);
        const head = (json as string[])[0];
        return {
          kind,
          name: `${head}(${p.join(', ')})`,
          source: [
            '#version 300 es',
            'precision highp float;',
            'precision highp int;',
            ...inputs.map((n) => `uniform float u_${n};`),
            'out vec4 fragColor;',
            r.preamble ?? '',
            `void main() { ${inputs.map((n) => `float ${n} = u_${n};`).join(' ')} fragColor = vec4(${r.code}, 0.0, 0.0, 0.0); }`,
          ].join('\n'),
          uniforms: Object.fromEntries(inputs.map((n, k) => [`u_${n}`, p[k]])),
          expected: ce.function(head, p.map(exact)).N().re,
        };
      });
      const values = await driver.evaluate(items);
      const failures = values.flatMap((v, k) => {
        const { kind, name, expected } = items[k];
        if (!v.ok) return [`${name}: ${v.log}`];
        if (kind === 'value-or-nan' && Number.isNaN(v.value)) return [];
        return Math.abs(v.value - expected) <= 1e-4 * Math.abs(expected)
          ? []
          : [`${name}: ${v.value} vs ${expected}`];
      });
      expect(failures).toEqual([]);
    }, 120_000);

    test('the zeta family gives the interpreter value', async () => {
      const items = REAL_CASES.flatMap((c) => {
        const r = glsl([c.op, ...c.inputs]);
        const source = [
          '#version 300 es',
          'precision highp float;',
          'precision highp int;',
          ...c.inputs.map((n) => `uniform float u_${n};`),
          'out vec4 fragColor;',
          r.preamble ?? '',
          `void main() { ${c.inputs.map((n) => `float ${n} = u_${n};`).join(' ')} fragColor = vec4(${r.code}, 0.0, 0.0, 0.0); }`,
        ].join('\n');
        return c.points.flatMap((p) => {
          const point = p.map(fr);
          const v = ce.function(c.op, point.map(exact)).N();
          // A complex value or a pole: the shader's NaN or +∞ is checked
          // by the JavaScript target's tests of the same kernels.
          if (!(Number.isFinite(v.re) && v.im === 0)) return [];
          // Past the largest float, the shader's value is ±∞.
          const expected =
            Math.abs(v.re) > 3.4028235677973366e38 ? v.re * Infinity : v.re;
          return [
            {
              c,
              name: `${c.op}(${point.join(', ')})`,
              source,
              uniforms: Object.fromEntries(
                c.inputs.map((n, k) => [`u_${n}`, point[k]])
              ),
              expected,
            },
          ];
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      const nan: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (Number.isNaN(v.value)) return nan.push(name);
        if (!Number.isFinite(expected)) {
          if (v.value !== expected) failures.push(`${name}: ${v.value} vs ${expected}`);
          return;
        }
        // Relative, and absolute for a value below 1: next to a zero the
        // error is that of the terms, which SwiftShader's `sin` (in the
        // Hermite integral) makes about 2e-5 (`HurwitzZeta(0.5, 0.3)`).
        const d = Math.abs(v.value - expected);
        if (!(d <= 3e-5 * Math.max(Math.abs(expected), 1)))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(nan).toEqual(NAN_POINTS);
    }, 600_000);
  }
);

/** The points where a helper is NaN and the interpreter has a finite
 *  value: its terms cancel there, or no method vouches for the value
 *  (`glsl-zeta-helpers.ts`). */
const NAN_POINTS: string[] = [
  // The terms of both signs cancel at a negative half-integer for an even
  // order (README of 0.193.0's `GPU_POLYGAMMA_PREAMBLE_GLSL`).
  'PolyGamma(2, -0.5)',
  'PolyGamma(10, -0.5)',
  // Next to a zero of ζ(s, a), where the terms of the Taylor series and of
  // the shift cancel (the value is 0.5^20 to 0.5^24).
  'HurwitzZeta(-20, -0.5)',
  'HurwitzZeta(-22, -0.5)',
  'HurwitzZeta(-24, -0.5)',
  // Zeta(s, a) of a < 0 adds |a + k|^-s to ζ(s, a + n), which is NaN where
  // it is 0 or next to a zero (ζ(-6, 1/2) = 0): the error estimate of
  // `_gpu_ir_zeta_shifted` is relative to that term alone.
  'Zeta(-3, -2.25)',
  'Zeta(-6, -0.5)',
  'Zeta(-6, -1.5)',
  'Zeta(-20, -0.5)',
  'Zeta(-20, -1.5)',
  'Zeta(-24, -0.5)',
  'Zeta(-24, -1.5)',
  // Next to a zero (Φ(-1, -1, 1/2) = 0), and two points where the error
  // estimate of the methods, with SwiftShader's builtins, passes 3e-5.
  'LerchPhi(-0.5, -2.5, 1)',
  'LerchPhi(-1, -1, 0.5)',
  'PolyLog(-2.5, -0.5)',
];
