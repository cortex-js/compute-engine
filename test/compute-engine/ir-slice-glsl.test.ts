/**
 * The slice compiler, GLSL ES 3.00 printer.
 *
 * - Every IR operation of the operator table has a spelling in both
 *   printers, except those that GLSL declines.
 * - Six snapshots, each guarding a rule (named at each).
 * - When a headless Chromium is installed for `playwright-core`, the
 *   shaders run in WebGL2 (SwiftShader): their `f32` values are compared
 *   with the JavaScript printer's values, and the values with the passes on
 *   and off with each other, within the float tolerance (GLSL gives no
 *   order of evaluation and no rounding, so no bits are compared); integer
 *   programs within 2^24 give the interpreter's value exactly. WebGL also compiles each shader, which
 *   checks the GLSL text. Without the browser, these tests are skipped.
 */

import { existsSync } from 'node:fs';
import {
  compileSlice,
  Decline,
  OPERATORS,
} from '../../src/compute-engine/compilation/ir';
import { JS } from '../../src/compute-engine/compilation/ir/print-js';
import { GLSL } from '../../src/compute-engine/compilation/ir/print-glsl';
import { spellingOf } from '../../src/compute-engine/compilation/ir/print';
import {
  COMPLEX_FUNCTIONS,
  REAL_FUNCTIONS,
} from '../../src/compute-engine/compilation/ir/operators';
import {
  interpret,
  makeEngine,
  pointsFor,
  PROGRAMS,
  type Point,
} from './ir-slice-oracle';

const ce = makeEngine();

// prettier-ignore
const PINNED: [rule: string, program: unknown][] = [
  ['a loop counts with an int, each bound evaluated once', ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, ['Floor', 'y']]]],
  ['a conditional joins two locals, one result each', ['Block', ['Declare', 't', 'real', 0], ['Declare', 'u', 'real', 'y'],
    ['If', ['Less', 'x', 0], ['Assign', 't', 1], ['Assign', 'u', 5]], ['Add', 't', 'u']]],
  ['Round adds no 0.5 before floor', ['Round', 'x']],
  ['an integer Mod computes on ints', ['Mod', 'n', 'm']],
  ['parameter names are ASCII, with no __', ['Add', 'x', 'n']],
  ['an element-wise operation is one per element', ['Add', ['Sin', 'L'], 'x']],
];

describe('IR slice: GLSL text', () => {
  test('every IR operation has a spelling in both printers (GLSL declines a draw, a Range, a function with no builtin defined on every real, and the complex lane)', () => {
    // prettier-ignore
    const jsOnly = new Set(['draw', 'rangecount', 'at', 'log10', 'hypot', 'asin', 'acos',
      'acosh', 'atanh', ...Object.keys(REAL_FUNCTIONS).filter((f) => f !== 'fract'),
      ...Object.keys(COMPLEX_FUNCTIONS)]);
    for (const row of OPERATORS)
      for (const [, , op] of row.signatures) {
        expect(spellingOf(JS, op)).toBeDefined();
        if (!jsOnly.has(op)) expect(spellingOf(GLSL, op)).toBeDefined();
        else expect(spellingOf(GLSL, op)).toBeUndefined();
      }
  });
  test.each(PINNED)('%s', (_, json) => {
    expect(
      compileSlice(ce.box(json as never), { target: 'glsl' }).code
    ).toMatchSnapshot();
  });
});

//
// Running the shaders
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The fragment shader that writes the value of the function `f` at its
 *  uniforms to the first pixel. */
function shader(
  code: string,
  parameters: { name: string; type: string }[],
  returnType: string
): string {
  const uniforms = parameters.map((p) => {
    const [base, count] = p.type.split('[');
    return count === undefined
      ? `uniform ${base} ${p.name};`
      : `uniform ${base} ${p.name}[${count};`;
  });
  const call = `f(${parameters.map((p) => p.name).join(', ')})`;
  const pack: Record<string, string> = {
    'float': `vec4(${call}, 0.0, 0.0, 0.0)`,
    'bool': `vec4(${call} ? 1.0 : 0.0, 0.0, 0.0, 0.0)`,
    'float[3]': `vec4(r[0], r[1], r[2], 0.0)`,
    'bool[3]': `vec4(r[0] ? 1.0 : 0.0, r[1] ? 1.0 : 0.0, r[2] ? 1.0 : 0.0, 0.0)`,
  };
  const result = returnType.endsWith('[3]')
    ? `${returnType.replace('[3]', '')} r[3] = ${call};\n  `
    : '';
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...uniforms,
    'out vec4 color;',
    code,
    `void main() {\n  ${result}color = ${pack[returnType]};\n}`,
  ].join('\n');
}

type Job = {
  source: string;
  points: {
    name: string;
    type: string;
    value: number | boolean | number[];
  }[][];
};

/** The job of the GLSL compilation of `json` at `points`. */
function job(json: unknown, points: Point[], passes = true): Job {
  const g = compileSlice(ce.box(json as never), {
    target: 'glsl',
    passes: passes ? undefined : false,
  });
  return {
    source: shader(g.code, g.parameters, g.returnType),
    points: points.map((p) =>
      g.parameters.map((q) => ({
        name: q.name,
        type: q.type,
        value: p[q.input],
      }))
    ),
  };
}

/** Runs in the page: compile each shader, draw one pixel per point, and
 *  read it back as four floats. */
function runJobs(jobs: Job[]): ({ error: string } | { values: number[][] })[] {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2')!;
  gl.getExtension('EXT_color_buffer_float');
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  gl.viewport(0, 0, 1, 1);
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(
    vs,
    '#version 300 es\nvoid main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }'
  );
  gl.compileShader(vs);
  return jobs.map((job) => {
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, job.source);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS))
      return { error: gl.getShaderInfoLog(fs) ?? '?' };
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      return { error: gl.getProgramInfoLog(program) ?? '?' };
    gl.useProgram(program);
    const values = job.points.map((point) => {
      for (const u of point) {
        const at = gl.getUniformLocation(program, u.name);
        if (at === null) continue;
        if (Array.isArray(u.value)) gl.uniform1fv(at, u.value);
        else if (typeof u.value === 'boolean')
          gl.uniform1i(at, u.value ? 1 : 0);
        else gl.uniform1f(at, u.value);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const out = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
      return [...out];
    });
    return { values };
  });
}

/** Whether the `f32` value `g` of the shader agrees with the double `v` of
 *  the JavaScript printer: within `tolerance` relative, with an absolute
 *  floor of `tolerance` (the precision of the target, the first caveat of
 *  compiled code). */
function close(g: number, v: number | boolean, tolerance: number): boolean {
  if (typeof v === 'boolean') return g === (v ? 1 : 0);
  return Math.abs(g - v) <= tolerance * Math.max(1, Math.abs(v));
}

/** The tolerance of a program: 1e-5 (`f32` arithmetic), or 1e-3 when it
 *  calls `sin`, `cos` or `tan`, which SwiftShader computes to about 1e-4
 *  (GLSL ES 3.00 states no precision for them). */
function tolerance(source: string): number {
  return /\b(sin|cos|tan)\(/.test(source) ? 1e-3 : 1e-5;
}

// prettier-ignore
const INTEGER_PROGRAMS: [unknown, Point[]][] = [
  [['Mod', 'n', 7], [{ n: 16777215 }, { n: -16777215 }, { n: 12345 }]],
  [['Mod', 'n', 'm'], [{ n: 16777215, m: 3 }, { n: 16777214, m: -5 }, { n: -7, m: 3 }, { n: -15000000, m: 6000001 }]],
  [['Floor', ['Divide', 'n', 'm']], [{ n: 16777215, m: 3 }, { n: -7, m: 2 }, { n: 16777213, m: 4096 }]],
  [['Add', 'n', 'm'], [{ n: 16777214, m: 1 }, { n: -16777215, m: 16777215 }]],
  [['Multiply', 'n', 'm'], [{ n: 4095, m: 4097 }, { n: -4096, m: 4096 }]],
  [['Sum', 'k', ['Limits', 'k', 1, 'n']], [{ n: 5000 }, { n: 0 }, { n: -3 }]],
  [['Product', 'k', ['Limits', 'k', 1, 'n']], [{ n: 10 }, { n: 0 }]],
  [['Round', 'x'], [{ x: 2.5 }, { x: -2.5 }, { x: 0.49999997 }, { x: 4194304.5 }, { x: -0.5 }]],
  [['Equal', 'n', 'm'], [{ n: 16777215, m: 16777214 }, { n: 16777215, m: 16777215 }]],
  [['Mod', ['Negate', 'n'], 4], [{ n: 7 }, { n: 16777215 }]],
];

(chromiumAvailable() ? describe : describe.skip)(
  'IR slice: GLSL run in WebGL2',
  () => {
    let browser: {
      newPage(): Promise<{
        evaluate: (f: unknown, a: unknown) => Promise<unknown>;
      }>;
      close(): Promise<void>;
    };
    let run: (
      jobs: Job[]
    ) => Promise<{ error?: string; values?: number[][] }[]>;
    beforeAll(async () => {
      const { chromium } = require('playwright-core');
      browser = await chromium.launch({
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      });
      const page = await browser.newPage();
      run = (jobs) => page.evaluate(runJobs, jobs) as never;
    }, 60_000);
    afterAll(async () => browser?.close());

    test('the shaders give the JavaScript values, with the passes on and off', async () => {
      // The programs whose JavaScript values at every point are finite: a
      // shader's NaN and infinity are not specified by GLSL ES 3.00.
      const cases = PROGRAMS.flatMap((json) => {
        const expr = ce.box(json as never);
        // A list of run-time length, a Map, a recursion: GLSL declines.
        try {
          compileSlice(expr, { target: 'glsl' });
        } catch (e) {
          if (e instanceof Decline) return [];
          throw e;
        }
        const points = pointsFor(expr);
        const { run: js } = compileSlice(expr, { target: 'javascript' });
        const expected = points.map(
          (p) => [js(p)].flat(2) as (number | boolean)[]
        );
        if (
          expected
            .flat()
            .some((v) => typeof v === 'number' && !Number.isFinite(v))
        )
          return [];
        return [
          {
            json,
            points,
            expected,
            on: job(json, points),
            off: job(json, points, false),
          },
        ];
      });
      const on = await run(cases.map((c) => c.on));
      const off = await run(cases.map((c) => c.off));
      const failures: string[] = [];
      cases.forEach((c, i) => {
        const r = on[i];
        if (r.error !== undefined)
          return failures.push(`${JSON.stringify(c.json)}: ${r.error}`);
        const t = tolerance(c.on.source);
        if (
          !r.values!.every((row, j) =>
            row.every((g, k) => close(g, off[i].values![j][k], t))
          )
        )
          failures.push(
            `${JSON.stringify(c.json)}: passes on ${JSON.stringify(r.values)}, off ${JSON.stringify(off[i].values)}`
          );
        c.expected.forEach((e, j) => {
          const got = r.values![j].slice(0, e.length);
          if (!e.every((v, k) => close(got[k], v, t)))
            failures.push(
              `${JSON.stringify(c.json)} at ${JSON.stringify(c.points[j])}: ${got} vs ${e}`
            );
        });
      });
      const points = cases.reduce((n, c) => n + c.points.length, 0);
      console.log(
        `GLSL: ${cases.length} programs at ${points} points, ${failures.length} failures`
      );
      expect(cases.length).toBeGreaterThanOrEqual(30);
      expect(failures).toEqual([]);
    }, 180_000);

    test('integer programs within 2^24 give the interpreter value exactly', async () => {
      const results = await run(
        INTEGER_PROGRAMS.map(([json, points]) => job(json, points))
      );
      const failures: string[] = [];
      INTEGER_PROGRAMS.forEach(([json, points], i) => {
        const r = results[i];
        if (r.error !== undefined)
          return failures.push(`${JSON.stringify(json)}: ${r.error}`);
        points.forEach((p, j) => {
          const expected = interpret(ce, ce.box(json as never), p);
          const got = r.values![j][0];
          if (
            got !==
            (typeof expected === 'boolean' ? Number(expected) : expected)
          )
            failures.push(
              `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${got} vs ${String(expected)}`
            );
        });
      });
      expect(failures).toEqual([]);
    }, 60_000);
  }
);
