/**
 * The complex lane of the profile `ir` on GLSL (batch G8; README of
 * `src/compute-engine/compilation/ir/`, "The complex lane"), and the
 * shortest float literal of the GLSL printer.
 *
 * - The text: a complex value is a `vec2` (re, im), a complex input a `vec2`
 *   parameter, a helper `_gpu_ir_c…` only when used.
 * - The values: each program, assembled as a host assembles it, runs in
 *   WebGL2 (the headless Chromium of `scripts/glsl-check/glsl-driver.ts`),
 *   and the re and the im agree with the profile's JavaScript code within
 *   single-float precision; the JavaScript code agrees with the interpreter
 *   on a subset. Without the browser, these tests are skipped.
 * - The declines; the three robustness tests; the float literal.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import type { Expression } from '../../src/compute-engine/global-types';

type Json = unknown;
type Cx = { re: number; im: number };
type Point = Record<string, number | Cx>;

const ce = new ComputeEngine();
ce.declare('z', 'complex');
ce.declare('w', 'complex');
ce.declare('x', 'real');
ce.declare('n', 'integer');
ce.declare('Lz', 'list<complex^3>');
ce.declare('fz', '(complex) -> complex');
ce.assign('fz', ce.box(['Function', ['Add', ['Multiply', 'a', 'a'], 1], 'a']));
ce.declare('pc', '(real) -> tuple<complex, complex>');
ce.assign('pc', ce.box(['Function', ['Tuple', ['Complex', 0, 1], 'a'], 'a']));

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, ...options });
const glsl = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, to: 'glsl', ...options });

/** The diagnostic of a compilation that throws, or `undefined`. */
function failure(
  f: () => unknown
): { code: string; message: string } | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { code: string; message: string } }).diagnostic;
  }
  return undefined;
}

/** A value of a run as a complex number (a real is `{re, im: 0}`). */
const cx = (v: unknown): Cx =>
  typeof v === 'number' ? { re: v, im: 0 } : (v as Cx);

const Z1 = { re: 0.5, im: -0.75 };
const Z2 = { re: -1.25, im: 0.4 };
const Z3 = { re: 2, im: 1.5 };
// The points on the axes: ±3, ±2i.
const AXES: Point[] = [
  { z: { re: 3, im: 0 } },
  { z: { re: -3, im: 0 } },
  { z: { re: 0, im: 2 } },
  { z: { re: 0, im: -2 } },
];

// prettier-ignore
const PROGRAMS: [label: string, json: Json, points: Point[], options?: object][] = [
  ['Add', ['Add', 'z', 'w'], [{ z: Z1, w: Z2 }]],
  ['Subtract a real', ['Subtract', 'z', 'x'], [{ z: Z1, x: 0.3 }, { z: Z2, x: -2 }]],
  ['Negate', ['Negate', 'z'], [{ z: Z2 }]],
  ['a real times a complex', ['Multiply', 'x', 'z'], [{ x: 1.5, z: Z1 }, { x: -3, z: Z3 }]],
  ['Multiply', ['Multiply', 'z', 'w'], [{ z: Z1, w: Z2 }, { z: Z3, w: Z1 }]],
  ['Divide', ['Divide', 'z', 'w'], [{ z: Z1, w: Z2 }, { z: Z3, w: Z1 }]],
  ['a real over a complex', ['Divide', 'x', 'z'], [{ x: 2, z: Z3 }]],
  ['Exp', ['Exp', 'z'], [{ z: Z1 }, { z: Z3 }]],
  ['Ln', ['Ln', 'z'], [{ z: Z1 }, { z: Z2 }, { z: Z3 }]],
  ['Sqrt', ['Sqrt', 'z'], [{ z: Z1 }, { z: Z2 }, { z: { re: -4, im: 0.5 } }, { z: { re: 3, im: -2 } }, { z: { re: 4, im: 1e-3 } }]],
  ['a power of an integer exponent', ['Power', 'z', 3], [{ z: Z1 }, { z: Z2 }]],
  ['a step of an escape-time iteration, at z = 0 too', ['Add', ['Power', 'z', 2], 'w'], [{ z: { re: 0, im: 0 }, w: Z2 }, { z: Z1, w: Z2 }]],
  ['a power of a real exponent', ['Power', 'z', 'x'], [{ z: Z1, x: 0.5 }, { z: Z3, x: -1.5 }]],
  ['a power of a complex exponent', ['Power', 'z', 'w'], [{ z: Z1, w: Z2 }, { z: Z3, w: Z1 }]],
  ['Sin', ['Sin', 'z'], [{ z: Z1 }, { z: Z3 }]],
  ['Cos', ['Cos', 'z'], [{ z: Z1 }, { z: Z2 }]],
  ['Tan', ['Tan', 'z'], [{ z: Z1 }, { z: Z2 }]],
  // Near the pole at 0: no cancellation in the denominator on GLSL.
  ['Cot', ['Cot', 'z'], [{ z: Z1 }, { z: Z2 }, { z: Z3 }, { z: { re: 0.001, im: 0.001 } }]],
  ['Sinh', ['Sinh', 'z'], [{ z: Z1 }, { z: Z3 }]],
  ['Cosh', ['Cosh', 'z'], [{ z: Z1 }, { z: Z2 }]],
  ['Tanh', ['Tanh', 'z'], [{ z: Z1 }, { z: Z2 }]],
  ['Real, Imaginary', ['Add', ['Real', ['Exp', 'z']], ['Multiply', 10, ['Imaginary', ['Sin', 'z']]]], [{ z: Z1 }, { z: Z2 }]],
  ['Abs', ['Abs', ['Multiply', 'z', 'w']], [{ z: Z1, w: Z2 }]],
  ['Argument', ['Argument', 'z'], [{ z: Z1 }, { z: Z2 }, { z: Z3 }]],
  ['Conjugate', ['Multiply', ['Conjugate', 'z'], 'w'], [{ z: Z1, w: Z2 }]],
  ['mixed real and complex operands', ['Add', ['Multiply', 2, 'z'], 'x', ['Complex', 1, -2]], [{ z: Z1, x: 0.25 }]],
  ['a complex constant of imaginary part 0 times a complex', ['Multiply', ['Sqrt', ['Negate', 4]], ['Sqrt', ['Negate', 4]], 'z'], [{ z: Z1 }]],
  ['a real result through the complex lane', ['Abs', ['Exp', ['Multiply', ['Complex', 0, 1], 'x']]], [{ x: 0.7 }, { x: 3 }]],
  ['If over complex values', ['If', ['Less', 'x', 0], ['Exp', 'z'], ['Multiply', 'z', 'z']], [{ x: -1, z: Z1 }, { x: 1, z: Z1 }]],
  ['If with a real arm', ['If', ['Less', 'x', 0], 'x', ['Exp', 'z']], [{ x: -1, z: Z1 }, { x: 1, z: Z1 }]],
  ['Equal of complex values', ['If', ['Equal', 'z', 'w'], 1, 2], [{ z: Z1, w: Z1 }, { z: Z1, w: Z2 }]],
  ['a Sum of complex values', ['Sum', ['Divide', ['Power', 'z', 'k'], ['Factorial', 'k']], ['Limits', 'k', 0, 8]], [{ z: Z1 }, { z: Z2 }]],
  ['a Product of complex values', ['Product', ['Add', 'z', 'k'], ['Limits', 'k', 1, 3]], [{ z: Z1 }, { z: Z2 }]],
  ['a Which of complex values', ['Which', ['Less', 'x', 0], 'z', 'True', ['Sin', 'z']], [{ x: -1, z: Z3 }, { x: 1, z: Z3 }]],
  ['a complex value inside a Sum of reals', ['Sum', ['Abs', ['Power', 'z', 'k']], ['Limits', 'k', 1, 4]], [{ z: Z1 }, { z: Z3 }]],
  ['a user function of a complex parameter and result', ['fz', ['Add', 'z', 1]], [{ z: Z1 }, { z: Z2 }]],
  ['Sqrt of a real in the complex mode', ['Sqrt', 'x'], [{ x: -4 }, { x: 2.25 }], { mode: 'complex' }],
  ['Ln of a real in the complex mode', ['Add', ['Ln', 'x'], 1], [{ x: -0.5 }, { x: 3 }], { mode: 'complex' }],
  // The axes: `Negate`, `Conjugate` and a product make a zero part -0,
  // where a renderer's `atan(y, x)` is wrong (`_gpu_ir_carg`).
  ['Argument of a negation on the axes', ['Argument', ['Negate', 'z']], AXES],
  // Not at z = -3, on the cut: JavaScript follows the -0 part of the
  // conjugate (im -π), the interpreter and GLSL give π.
  ['Ln of a conjugate on the axes', ['Ln', ['Conjugate', 'z']], AXES.filter((p) => (p.z as Cx).re !== -3)],
  ['Argument of a real times a complex on the axes', ['Argument', ['Multiply', 'x', 'z']], AXES.map((p) => ({ ...p, x: -1.5 }))],
  ['a power of a large exponent of a negation', ['Power', ['Negate', 'z'], 17], [{ z: { re: 3, im: 0 } }]],
  ['Argument of a conjugate', ['Argument', ['Conjugate', 'z']], [{ z: { re: 3, im: 0 } }]],
  ['Ln of a square', ['Ln', ['Square', 'z']], [{ z: { re: -3, im: 0 } }]],
  ['Argument of 0', ['Argument', 'z'], [{ z: { re: 0, im: 0 } }]],
  ['Ln of a conjugate of a root in the complex mode', ['Ln', ['Conjugate', ['Sqrt', 'x']]], [{ x: 2 }, { x: 0.5 }], { mode: 'complex' }],
  ['Ln of a negated root in the complex mode', ['Ln', ['Negate', ['Sqrt', 'x']]], [{ x: -4 }, { x: -0.25 }], { mode: 'complex' }],
  // The largest float, of both signs.
  ['the largest float', ['Subtract', 3.4028235e38, 'x'], [{ x: 1e38 }]],
  ['the largest negative float', ['Add', -3.4028235e38, 'x'], [{ x: 1e38 }]],
];

// The programs whose JavaScript value is compared with the interpreter.
const INTERPRETED = new Set([
  'Multiply',
  'Divide',
  'Exp',
  'Ln',
  'Sqrt',
  'a power of a real exponent',
  'a power of a complex exponent',
  'a step of an escape-time iteration, at z = 0 too',
  'Sin',
  'Tan',
  'Cot',
  'Tanh',
  'Argument',
  'mixed real and complex operands',
  'If over complex values',
  'a Sum of complex values',
  'Argument of a negation on the axes',
  'Ln of a conjugate on the axes',
  'Argument of a real times a complex on the axes',
  'a power of a large exponent of a negation',
  'Argument of a conjugate',
  'Ln of a square',
  'Argument of 0',
  'Ln of a conjugate of a root in the complex mode',
  'Ln of a negated root in the complex mode',
]);

/** The interpreter's value of `json` at `point`, numerically. */
function interpreted(json: Json, point: Point): Cx {
  const subs = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      typeof v === 'number' ? ce.number(v) : ce.number(ce.complex(v.re, v.im)),
    ])
  );
  const value = ce
    .box(json as never)
    .subs(subs)
    .N();
  return { re: value.re, im: value.im };
}

const close = (a: Cx, b: Cx, tolerance: number) => {
  const scale = Math.max(1, Math.hypot(b.re, b.im));
  return (
    Math.abs(a.re - b.re) <= tolerance * scale &&
    Math.abs(a.im - b.im) <= tolerance * scale
  );
};

describe('IR profile, complex lane: JavaScript against the interpreter', () => {
  test.each(PROGRAMS.filter(([l]) => INTERPRETED.has(l)))(
    '%s',
    (...[, json, points, options]) => {
      const r = js(json, options);
      for (const p of points) {
        const got = cx(r.run!(p as never));
        const want = interpreted(json, p);
        if (!close(got, want, 1e-10))
          throw new Error(
            `${JSON.stringify(p)}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`
          );
      }
    }
  );
});

//
// GLSL: the text
//

describe('IR profile, complex lane on GLSL: the text', () => {
  test('a complex input is a vec2 parameter; a real read as a complex is vec2(x, 0.0)', () => {
    const r = glsl(['Multiply', 'x', 'z']);
    expect(r).toMatchObject({
      success: true,
      profile: 'ir',
      unsupported: [],
      mode: 'strict',
    });
    expect(r.code).toBe('_gpu_ir_cmul(vec2(x, 0.0), z)');
    expect(r.preamble).toMatch(/^vec2 _gpu_ir_cmul\(vec2 a, vec2 b\) \{/);
    expect(r.freeSymbolTypes).toEqual({
      x: { type: 'real', lowered: 'float', provenance: 'declared' },
      z: { type: 'complex', lowered: 'vec2', provenance: 'declared' },
    });
  });

  test('the operations of vec2 are inline', () => {
    expect(glsl(['Add', 'z', 'x']).code).toBe('(vec2(x, 0.0) + z)');
    // The canonical form of `z - w` is `-w + z`.
    expect(glsl(['Subtract', 'z', 'w']).code).toBe('((-w) + z)');
    expect(glsl(['Subtract', 'z', 'x']).code).toBe('(vec2((-x), 0.0) + z)');
    expect(glsl(['Negate', 'z']).code).toBe('(-z)');
    expect(glsl(['Add', ['Real', 'z'], ['Imaginary', 'w']]).code).toBe(
      '(w.y + z.x)'
    );
    expect(glsl(['Conjugate', 'z']).code).toBe('(z * vec2(1.0, -1.0))');
    expect(glsl(['Abs', 'z']).code).toBe('length(z)');
    // The argument is a helper, also in `Ln` and `Power`, defined first.
    expect(glsl(['Argument', 'z']).code).toBe('_gpu_ir_carg(z)');
    expect(glsl(['Ln', 'z']).preamble).toMatch(
      /^(float _gpu_ir_chypot\(float x, float y\) \{[^]*\n)?float _gpu_ir_carg\(vec2 a\) \{[^]*\nvec2 _gpu_ir_cln\(vec2 a\) \{/
    );
    // The largest float is not written above itself (`3.4028235e+38`).
    expect(glsl(['Subtract', 3.4028235e38, 'x']).code).toMatch(
      /3\.4028234663852886e\+38/
    );
    expect(glsl(['Add', 'z', ['Complex', 1, -2]]).code).toBe(
      '(z + vec2(1.0, (-2.0)))'
    );
  });

  test('a helper only when used, each a function of vec2', () => {
    const r = glsl(['Divide', ['Multiply', 'z', 'w'], ['Exp', 'z']]);
    expect(r.code).toBe('_gpu_ir_cdiv(_gpu_ir_cmul(w, z), _gpu_ir_cexp(z))');
    const defined = [...r.preamble!.matchAll(/^(\w+) (\w+)\(/gm)].map(
      (m) => `${m[1]} ${m[2]}`
    );
    expect(defined.sort()).toEqual([
      'vec2 _gpu_ir_cdiv',
      'vec2 _gpu_ir_cexp',
      'vec2 _gpu_ir_cmul',
    ]);
    for (const [head, helper] of [
      ['Sqrt', 'csqrt'],
      ['Ln', 'cln'],
      ['Sin', 'csin'],
      ['Cos', 'ccos'],
      ['Tan', 'ctan'],
      ['Cot', 'ccot'],
      ['Sinh', 'csinh'],
      ['Cosh', 'ccosh'],
      ['Tanh', 'ctanh'],
    ]) {
      const s = glsl([head, 'z']);
      expect(s.code).toBe(`_gpu_ir_${helper}(z)`);
      expect(s.preamble).toMatch(
        new RegExp(`^vec2 _gpu_ir_${helper}\\(vec2 a\\) \\{`, 'm')
      );
    }
    expect(glsl(['Power', 'z', 'x']).code).toBe(
      '_gpu_ir_cpow(z, vec2(x, 0.0))'
    );
    // An integer exponent is a product in the helper, as on the real
    // lane: no `ln` of 0.
    const square = glsl(['Power', 'z', 2]);
    expect(square.code).toBe('_gpu_ir_cpow(z, vec2(2.0, 0.0))');
    expect(square.preamble).toMatch(/b\.x <= 16\.0/);
    expect(glsl(['Power', 'z', 'w']).code).toBe('_gpu_ir_cpow(z, w)');
  });

  test('a complex result, an If of complex arms, a function of complex values', () => {
    const r = glsl(['If', ['Less', 'x', 0], 'z', ['Exp', 'z']]);
    expect(r.code).toMatch(/^vec2 v\d+;\nif \(\(x < 0\.0\)\) \{/);
    const f = glsl(['fz', 'z']);
    expect(f.preamble).toMatch(/^vec2 _fn_ir_\w+\(vec2 \w+\) \{/m);
  });

  test('a closed complex value is a vec2 constant', () => {
    expect(glsl(['Add', 'x', ['Sqrt', ['Negate', 3]]]).code).toBe(
      '(vec2(x, 0.0) + vec2(0.0, 1.7320508))'
    );
  });

  test('the complex mode: an input of no declared type is complex', () => {
    const r = glsl(['Sqrt', 'y'], { mode: 'complex' });
    expect(r.mode).toBe('complex');
    expect(r.code).toBe('_gpu_ir_csqrt(y)');
    expect(r.freeSymbolTypes!.y.lowered).toBe('vec2');
    // A real input stays real.
    expect(
      glsl(['Add', 'x', 1], { mode: 'complex' }).freeSymbolTypes!.x.lowered
    ).toBe('float');
  });
});

//
// GLSL: the values in WebGL2
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The fragment shader of a host: a complex input is two float uniforms
 *  (`u_z_re`, `u_z_im`), and the output is the part `part` of the result
 *  (`x` or `y` of a `vec2`, or the `float`). */
function shader(r: ReturnType<typeof glsl>, part: '' | '.x' | '.y'): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  const uniform = (n: string) =>
    type(n) === 'vec2'
      ? [`uniform float u_${n}_re;`, `uniform float u_${n}_im;`]
      : [`uniform ${type(n)} u_${n};`];
  const arg = (n: string) =>
    type(n) === 'vec2' ? `vec2(u_${n}_re, u_${n}_im)` : `u_${n}`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.flatMap(uniform),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `${part === '' ? 'float' : 'vec2'} userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${inputs.map(arg).join(', ')})${part}, 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

function uniforms(
  r: ReturnType<typeof glsl>,
  p: Point
): Record<string, number> {
  return Object.fromEntries(
    r.freeSymbols!.flatMap((n) => {
      const v = p[n];
      return typeof v === 'number'
        ? [[`u_${n}`, v]]
        : [
            [`u_${n}_re`, v.re],
            [`u_${n}_im`, v.im],
          ];
    })
  );
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, complex lane on GLSL: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test("the re and the im of the profile's shader agree with the JavaScript value within single-float precision", async () => {
      const items = PROGRAMS.flatMap(([label, json, points, options]) => {
        const f = js(json, options);
        const r = glsl(json, options);
        // A complex result: a `{re, im}` object at one of the points.
        // The result type of the profile's GLSL function.
        const complex =
          compileSlice(ce.box(json as never), {
            target: 'glsl',
            ...(options as { mode?: 'complex' }),
          }).returnType === 'vec2';
        return points.flatMap((p) => {
          const v = cx(f.run!(p as never));
          const parts: ['' | '.x' | '.y', number][] = complex
            ? [
                ['.x', v.re],
                ['.y', v.im],
              ]
            : [['', v.re]];
          return parts.map(([part, expected]) => ({
            name: `${label} at ${JSON.stringify(p)}${part}`,
            source: shader(r, part),
            uniforms: uniforms(r, p),
            expected,
            scale: Math.max(1, Math.hypot(v.re, v.im)),
          }));
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, source, expected, scale } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        // SwiftShader computes `sin`, `cos` and `tan` to about 1e-4 (as in
        // `ir-slice-glsl.test.ts`): `sin(1.5)` is off by 1.4e-4 relative.
        const tolerance = /\b(sin|cos|tan)\(/.test(source) ? 1e-3 : 1e-4;
        if (!(Math.abs(v.value - expected) <= tolerance * scale))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(100);
    }, 120_000);
  }
);

//
// Declines
//

// prettier-ignore
const DECLINES: [label: string, json: Json, cause: RegExp, options?: object][] = [
  ['Arccot', ['Arccot', 'z'], /Arccot \(the operation cacot\) on glsl/],
  ['Arcsch', ['Arcsch', 'z'], /Arcsch \(the operation cacsch\)/],
  ['the upper incomplete Gamma of a complex', ['Gamma', 2, 'z'], /Gamma \(the operation cgammaupper\) on glsl/],
  ['a comparison of complex values', ['Less', 'z', 'w'], /Less of complex/],
  ['a list of complex values', ['List', 'z', 'w'], /a list of complex numbers on glsl/],
  ['a tuple of complex values', ['Tuple', 'z', ['Exp', 'z']], /a list of complex numbers on glsl/],
  ['an input list of complex numbers', ['At', 'Lz', 1], /Lz|complex/],
  ['a tuple<complex, complex> result of a user function', ['At', ['pc', 'x'], 1], /the result of pc is not a scalar/],
  ['the bigint mode', ['Add', 'n', 1], /the bigint mode on glsl/, { mode: 'bigint' }],
];

describe('IR profile, complex lane on GLSL: the declines', () => {
  // A rest parameter: a callback with more parameters than a row has
  // elements is given Jest's `done`.
  test.each(DECLINES)('%s', (...[name, json, cause, options]) => {
    const d = failure(() => glsl(json, options));
    // A mode that GLSL does not offer has the code of the existing compiler.
    expect(d?.code).toBe(
      name === 'the bigint mode' ? 'unsupported-mode' : 'outside-profile'
    );
    expect(d?.message).toMatch(cause);
  });
});

//
// Robustness
//

describe('IR profile, complex lane on GLSL: robustness', () => {
  const quick = (e: Expression) => {
    const start = performance.now();
    let r: ReturnType<typeof compile> | undefined;
    const d = failure(() => (r = compile(e, { ...IR, to: 'glsl' })));
    const ms = performance.now() - start;
    if (d !== undefined) expect(d.code).toBe('outside-profile');
    return { r, d, ms };
  };

  test('a shared graph of 2^20 paths compiles in bounded text and time', () => {
    let e: Expression = ce.box('z');
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [e, ce.function('Sin', [e])]);
    const { r, ms } = quick(e);
    expect(r!.code.length + (r!.preamble ?? '').length).toBeLessThan(10_000);
    // The pipeline takes about 1 ms; the engine's `isFinite` of the root,
    // read by its type, walks the 2^20 paths first (about 0.5 s, CE-1200).
    expect(ms).toBeLessThan(5_000);
  });

  test('a chain of 1,000 nested complex operations compiles or declines as too deep', () => {
    let e: Expression = ce.box('z');
    for (let i = 0; i < 1_000; i++)
      e = ce.function('Multiply', [ce.function('Exp', [e]), ce.box('w')]);
    const { r, d, ms } = quick(e);
    if (d !== undefined)
      expect(d.message).toMatch(/too deep to compile|nodes to lower/);
    else expect(r!.code.length).toBeLessThan(1_000_000);
    expect(ms).toBeLessThan(5_000);
    // 1,000 operands.
    const sum = ce.function(
      'Add',
      Array.from({ length: 1_000 }, (_, k) =>
        ce.function('Multiply', [ce.number(k + 1), ce.box('z')])
      )
    );
    expect(quick(sum).ms).toBeLessThan(5_000);
  });

  test('a nested loop of complex values compiles within the pass bound, and declines over it', () => {
    const nested = (n: number) => [
      'Sum',
      ['Sum', ['Multiply', 'j', ['Power', 'z', 'k']], ['Limits', 'k', 1, n]],
      ['Limits', 'j', 1, n],
    ];
    const start = performance.now();
    expect(glsl(nested(10)).success).toBe(true);
    expect(performance.now() - start).toBeLessThan(1_000);
    const d = failure(() => glsl(nested(1_000)));
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(/iterationBudget/);
  });
});

//
// The float literal
//

describe('IR profile, GLSL: the shortest float literal', () => {
  /** The literals of a `float[n]` table of `values`, as printed. */
  const table = (values: number[]): string[] => {
    const r = glsl(['At', ['List', ...values], 'n']);
    const open = `float[${values.length}](`;
    const start = r.code.indexOf(open) + open.length;
    if (start < open.length) throw new Error(r.code.slice(0, 200));
    // To the parenthesis that closes the constructor.
    let depth = 1;
    let end = start;
    while (depth > 0) {
      if (r.code[end] === '(') depth += 1;
      if (r.code[end] === ')') depth -= 1;
      end += 1;
    }
    return r.code.slice(start, end - 1).split(', ');
  };
  const read = (s: string) => {
    const t = s.replace(/^\((.*)\)$/, '$1');
    expect(t).toMatch(/^-?\d+(\.\d+)?(e[-+]\d+)?$/);
    expect(t).toMatch(/[.e]/);
    return Math.fround(Number(t));
  };

  test('each literal reads back to the same float32', () => {
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const edges = [
      1e-45, 1.401298464324817e-45, 1.1754942e-38, 1.17549435e-38, 3.4028235e38,
      -3.4028235e38, 16777216, 16777217, 0.1, -0.1, 0.5, 1, 2, 250, 1e-7,
      123456.789, 0.3333333333,
    ];
    const values = [
      ...edges,
      ...Array.from({ length: 1_000 }, () => random()),
      ...Array.from(
        { length: 1_000 },
        () => (random() - 0.5) * 10 ** (Math.floor(random() * 60) - 30)
      ),
      ...Array.from({ length: 1_000 }, () => Math.round(random() * 1e6) / 1e3),
    ];
    for (let k = 0; k < values.length; k += 1_000) {
      const chunk = values.slice(k, k + 1_000);
      const printed = table(chunk);
      expect(printed).toHaveLength(chunk.length);
      chunk.forEach((x, j) => {
        if (read(printed[j]) !== Math.fround(x))
          throw new Error(`${x}: ${printed[j]}`);
      });
    }
  });

  test('a table of 1,024 numbers prints under 13 characters per element', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const values = Array.from({ length: 1_024 }, () => random());
    const text = table(values).join(', ');
    expect(text.length / 1_024).toBeLessThan(13);
  });
});
