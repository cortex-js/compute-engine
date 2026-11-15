/**
 * The profile `ir` of `compile()` on the `glsl` target (batches G1 and G2,
 * `src/compute-engine/compilation/ir/adapter-glsl.ts`): a scalar or list
 * result of scalar inputs and of inputs that are tuples or lists of 2 to 4
 * elements (a `vecN`), and the option `vars`.
 *
 * - The fields of the result: `code` is an expression or statements that end
 *   in `return`, an input is its bare name, every helper and function of
 *   `preamble` is named `_gpu_ir_…` or `_fn_ir_…` (no name of the existing
 *   target's preamble), two compilations give one text.
 * - The values: each result is assembled as a host does (`float userFn(float
 *   x, …) { return <code>; }` after the preamble) and run in WebGL2 with the
 *   headless Chromium of `scripts/glsl-check/glsl-driver.ts`, against the
 *   interpreter within single-float precision. Without the browser, these
 *   tests are skipped.
 * - One decline per declined cause; `fallback`; `canCompile()`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, canCompile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { _withIrProfileTestExtension } from '../../src/compute-engine/compilation/ir/adapter';
import { GLSL } from '../../src/compute-engine/compilation/ir/print-glsl';
import { _jsProfileShadowStats } from '../../src/compute-engine/js-profile-switch';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import { interpret, makeEngine, type Point } from './ir-slice-oracle';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

const ce = makeEngine();
// A user function that reads an input of the compilation.
ce.assign('rx', ce.box(['Function', ['Add', 'a', 'y'], 'a']));
ce.declare('v8', 'real');
ce.declare('float', 'real');
ce.declare('sin', 'real');
for (const word of ['active', 'common', 'sampler1D']) ce.declare(word, 'real');
// Points (batch G2): `L` is `list<real^3>`.
ce.declare('P', 'tuple<real, real>');
ce.declare('R', 'tuple<real, real>');
ce.declare('P3', 'tuple<real, real, real>');
ce.declare('V4', 'list<real^4>');
ce.declare('L5', 'list<real^5>');
ce.declare('B2', 'tuple<boolean, boolean>');
ce.declare('BL2', 'list<boolean^2>');
ce.declare('pf', '(tuple<real, real>) -> real');
ce.assign(
  'pf',
  ce.box(['Function', ['Add', ['At', 'a', 1], ['At', 'a', 2]], 'a'])
);
ce.assign(
  'pr',
  ce.box(['Function', ['Tuple', ['Cos', 'a'], ['Sin', 'a']], 'a'])
);

type Json = unknown;
const IR = { to: 'glsl', profile: 'ir', fallback: false } as const;
const glsl = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, ...options });

// prettier-ignore
const PROGRAMS: [Json, Point[]][] = [
  [['Add', ['Multiply', 'x', 'x'], ['Multiply', 'y', ['Sin', 'x']]], [{ x: 0.5, y: 2 }, { x: -1.25, y: 0.3 }]],
  [['Exp', ['Negate', ['Multiply', 'x', 'x']]], [{ x: 0.5 }, { x: -1.5 }]],
  [['Power', 'x', 'y'], [{ x: 1.5, y: 2.5 }, { x: 3, y: -0.5 }]],
  [['Power', 'x', 3], [{ x: -1.5 }, { x: 2 }]],
  [['Cos', ['Multiply', 2, 'x']], [{ x: 0.25 }, { x: 2 }]],
  [['If', ['Less', 'x', 0], ['Negate', 'x'], ['Sqrt', 'x']], [{ x: -2 }, { x: 2.25 }]],
  [['Which', ['Less', 'x', 0], 1, ['Less', 'x', 1], 2, 'True', 3], [{ x: -1 }, { x: 0.5 }, { x: 4 }]],
  [['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 10]], [{ x: 0.5 }, { x: -3 }]],
  [['Product', ['Add', 'k', 'x'], ['Limits', 'k', 1, 4]], [{ x: 0.5 }, { x: -0.25 }]],
  [['h2', 'x'], [{ x: 1.5 }, { x: -2 }]],
  [['Add', ['rx', 'x'], 1], [{ x: 1.5, y: 2 }, { x: -2, y: 0.25 }]],
  [['Less', ['Multiply', 'x', 'y'], 1], [{ x: 0.5, y: 1 }, { x: 2, y: 3 }]],
  [['And', 'p', ['Greater', 'x', 0]], [{ p: true, x: 1 }, { p: true, x: -1 }, { p: false, x: 1 }]],
  [['Mod', 'n', 3], [{ n: 7 }, { n: -7 }]],
  [['Add', 'n', ['Multiply', 'm', 'x']], [{ n: 3, m: -2, x: 0.5 }]],
  [['Add', 'x', 'h'], [{ x: 0.5 }]],
  [['Round', 'x'], [{ x: 2.5 }, { x: -2.5 }, { x: 0.25 }]],
  [['Block', ['Declare', 't', 'real', 0], ['If', ['Less', 'x', 0], ['Assign', 't', 1], ['Assign', 't', 5]], ['Add', 't', 'x']], [{ x: -1 }, { x: 1 }]],
];

describe('IR profile on GLSL: the result', () => {
  test.each(PROGRAMS.map(([json]) => [JSON.stringify(json), json]))(
    '%s',
    (_, json) => {
      const r = glsl(json);
      expect(r).toMatchObject({
        target: 'glsl',
        success: true,
        profile: 'ir',
        mode: 'strict',
        unsupported: [],
      });
      expect(r.run).toBeUndefined();
      // An expression, or statements that end in `return …;`.
      if (r.code.includes(';')) expect(r.code).toMatch(/return [^;]+;$/);
      else expect(r.code).not.toMatch(/\breturn\b/);
      // The inputs by their bare names, with their types.
      // (`rx` reads `y`.)
      const text = JSON.stringify(json);
      expect([...r.freeSymbols!].sort()).toEqual(
        ['m', 'n', 'p', 'x', 'y'].filter(
          (n) => text.includes(`"${n}"`) || (n === 'y' && text.includes('rx'))
        )
      );
      for (const name of r.freeSymbols!) {
        expect(`${r.code}\n${r.preamble ?? ''}`).toMatch(
          new RegExp(`\\b${name}\\b`)
        );
        expect(r.freeSymbolTypes![name]).toEqual({
          type:
            name === 'p' ? 'boolean' : /^[nm]$/.test(name) ? 'integer' : 'real',
          lowered: name === 'p' ? 'bool' : 'float',
          provenance: 'declared',
        });
      }
      expect(r.code).not.toMatch(/\bin\d+_/);
      // Every function of the preamble is a helper or a user function.
      const defined = [
        ...(r.preamble ?? '').matchAll(/^(?:float|bool) (\w+)\(/gm),
      ].map((m) => m[1]);
      for (const name of defined) expect(name).toMatch(/^(_gpu_ir_|_fn_ir_)/);
      // The same text twice.
      const again = glsl(json);
      expect([again.code, again.preamble]).toEqual([r.code, r.preamble]);
    }
  );

  test('a user function and a helper are spelled with their prefixes', () => {
    const r = glsl(['Add', ['h2', 'x'], ['Power', 'x', 'y']]);
    expect(r.code).toMatch(/_fn_ir_\w+\(x\)/);
    expect(r.code).toMatch(/_gpu_ir_pow\(x, y\)/);
    expect(r.preamble).toMatch(/^float _gpu_ir_pow\(/m);
    expect(r.preamble).toMatch(/^float _fn_ir_\w+_h2\(/m);
  });

  test("no helper of the GLSL syntax is a helper of the existing target's preamble", () => {
    const existing = readFileSync(
      join(__dirname, '../../src/compute-engine/compilation/gpu-preambles.ts'),
      'utf8'
    );
    const names = Object.keys(GLSL.helpers);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(/^_gpu_ir_/);
      expect(existing).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  test('a captured value fills symbolDeps', () => {
    const symbolDeps = new Set<string>();
    glsl(['Add', ['h2', 'x'], 'h'], { symbolDeps });
    expect([...symbolDeps].sort()).toEqual(['f', 'g', 'h', 'h2']);
  });
});

//
// The values in WebGL2
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The fragment shader of a host: the preamble, the code in a function of
 *  the inputs, called with the uniforms `u_<name>`. */
function shader(r: ReturnType<typeof glsl>, result: string): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.map((n) => `uniform ${type(n)} u_${n};`),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `${result} userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(float(userFn(${inputs.map((n) => `u_${n}`).join(', ')})), 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile on GLSL: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the shaders give the interpreter values within single-float precision', async () => {
      const items = PROGRAMS.flatMap(([json, points]) => {
        const r = glsl(json);
        const expected = points.map((p) =>
          interpret(ce, ce.box(json as never), p)
        );
        const result = expected.some((v) => typeof v === 'boolean')
          ? 'bool'
          : 'float';
        const source = shader(r, result);
        return points.map((p, k) => ({
          name: `${JSON.stringify(json)} at ${JSON.stringify(p)}`,
          source,
          uniforms: Object.fromEntries(
            r.freeSymbols!.map((n) => [`u_${n}`, Number(p[n as keyof Point])])
          ),
          expected: expected[k],
        }));
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        const e = typeof expected === 'boolean' ? Number(expected) : expected;
        if (typeof e !== 'number')
          return failures.push(`${name}: interpreter ${String(e)}`);
        const tolerance = /(Sin|Cos)/.test(name) ? 1e-3 : 1e-5;
        if (!(Math.abs(v.value - e) <= tolerance * Math.max(1, Math.abs(e))))
          failures.push(`${name}: ${v.value} vs ${e}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(30);
    }, 120_000);
  }
);

//
// Points: a tuple or a list of 2 to 4 numbers is a `vecN` (batch G2)
//

type PointValue = Record<string, number | number[]>;
// Tycho's options for a parametric curve.
const TYCHO = { inputs: { t: 'real<0..7>' }, symbolic: ['t'] };
/** The globals that the `vars` texts of `POINTS` name. */
const GLOBALS = 'float g_x;\nstruct G { vec2 P; };\nG g;\nfloat g_a[2];';

// prettier-ignore
const POINTS: [label: string, json: Json, options: object, points: PointValue[]][] = [
  ['the parametric witness', ['Tuple', ['Cos', 't'], ['Sin', 't']], TYCHO, [{ t: 0.5 }, { t: 2 }, { t: 6 }]],
  ['a 3-tuple', ['Tuple', 'x', ['Sin', 'x'], ['Multiply', 2, 'y']], {}, [{ x: 0.5, y: 2 }, { x: -1.5, y: 0.25 }]],
  ['a 4-list', ['List', 'x', 1, 'y', ['Exp', 'x']], {}, [{ x: 0.5, y: 2 }]],
  ['a list of 5 numbers', ['List', 'x', 1, 'y', 2, 3], {}, [{ x: 0.5, y: 2 }]],
  ['PointList of scalars', ['PointList', 'x', ['Cos', 'x']], {}, [{ x: 0.5 }, { x: -2 }]],
  ['an If between two points', ['If', ['Less', 'x', 0], ['Tuple', 'x', 1], ['Tuple', 1, 'x']], {}, [{ x: -1 }, { x: 2 }]],
  ['an If with a point arm and no else', ['If', ['Less', 'x', 0], ['Tuple', 'x', 1]], {}, [{ x: -1 }, { x: -0.25 }]],
  ['a point through a Block local', ['Block', ['Declare', 'q', 'unknown', ['Tuple', ['Cos', 'x'], ['Sin', 'x']]], ['Add', ['Multiply', 2, 'q'], ['Tuple', 'y', 1]]], {}, [{ x: 0.5, y: 2 }, { x: 3, y: -1 }]],
  ['a boolean tuple', ['Tuple', ['Less', 'x', 0], ['Less', 'x', 1]], {}, [{ x: -1 }, { x: 0.5 }, { x: 2 }]],
  ['2·P + R', ['Add', ['Multiply', 2, 'P'], 'R'], {}, [{ P: [1, 2], R: [0.5, -1] }, { P: [-3, 0.25], R: [2, 7] }]],
  ['At(P, 2)', ['At', 'P', 2], {}, [{ P: [1, 2] }, { P: [-3, 0.25] }]],
  ['Sin of a 3-tuple input, times x', ['Multiply', 'x', ['Sin', 'P3']], {}, [{ x: 2, P3: [0.5, 1, -2] }]],
  ['a list<real^3> and a list<real^4> input', ['Add', ['At', 'L', 3], ['At', 'V4', -1]], {}, [{ L: [1, 2, 3], V4: [4, 5, 6, 7] }]],
  ['a vars scalar', ['Add', 'x', 'y'], { vars: { x: 'g_x' } }, [{ x: 0.5, y: 2 }, { x: -1, y: 3 }]],
  ['a vars point (a member)', ['Add', ['Multiply', 'y', 'P'], 'R'], { vars: { P: 'g.P' } }, [{ y: 2, P: [1, 2], R: [0.5, -1] }]],
  ['a vars element read in a user function', ['rx', 'x'], { vars: { y: 'g_a[1]' } }, [{ x: 0.5, y: 2 }, { x: -1, y: 3 }]],
  // A boolean input element is 1 (True) or 0 (False) in a point.
  ['a tuple<boolean, boolean> input', ['If', ['At', 'B2', 1], 'x', 'y'], {}, [{ B2: [1, 0], x: 0.5, y: 2 }, { B2: [0, 1], x: 0.5, y: 2 }]],
  ['a list<boolean^2> input', ['If', ['At', 'BL2', 2], 'x', 'y'], {}, [{ BL2: [1, 0], x: 0.5, y: 2 }, { BL2: [0, 1], x: 0.5, y: 2 }]],
];

/** The programs that the existing GLSL target does not compile, so their
 *  fields are not compared with its fields. */
const NOT_COMPARED = new Set([
  'a boolean tuple',
  'a tuple<boolean, boolean> input',
  'a list<boolean^2> input',
]);

/** The interpreter's value: a tuple or a list is an array; an input array
 *  is a `Tuple` for a tuple input, a `List` otherwise. */
function interpretPoint(json: Json, point: PointValue): unknown {
  const read = (e: Expression): unknown =>
    isFunction(e, 'Tuple') || isFunction(e, 'List')
      ? e.ops.map(read)
      : isSymbol(e, 'True') || isSymbol(e, 'False')
        ? isSymbol(e, 'True')
        : (e as { re: number }).re;
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function(
            /^(L|V4|BL2)$/.test(k) ? 'List' : 'Tuple',
            v.map((n) =>
              /^B/.test(k) ? (n ? ce.True : ce.False) : ce.number(n)
            )
          )
        : ce.number(v),
    ])
  );
  return ce.withValues(values as never, () =>
    read(
      ce
        .box(json as never)
        .evaluate()
        .N()
    )
  );
}

/** One fragment shader per component of the result: the host's function
 *  `<result> userFn(<inputs>)`, whose point inputs are `vecN` parameters
 *  made from `float` uniforms (`u_P_0`, `u_P_1`), and whose `vars` inputs
 *  are globals that `main()` sets. */
function pointShaders(
  r: ReturnType<typeof glsl>,
  vars: Record<string, string>,
  expected: unknown
): string[] {
  const type = (n: string) => r.freeSymbolTypes![n].lowered!;
  const size = (n: string) => Number(/^b?vec(\d)$/.exec(type(n))?.[1] ?? 1);
  const value = (n: string) =>
    size(n) === 1
      ? `u_${n}_0`
      : `${type(n)}(${Array.from({ length: size(n) }, (_, k) => `u_${n}_${k}`).join(', ')})`;
  const params = r.freeSymbols!.filter((n) => vars[n] === undefined);
  // The type of the result, from the interpreter's value.
  const count = Array.isArray(expected) ? expected.length : undefined;
  const scalar =
    [expected].flat()[0] === true || [expected].flat()[0] === false
      ? 'bool'
      : 'float';
  const result =
    count === undefined
      ? scalar
      : count >= 2 && count <= 4
        ? `${scalar === 'bool' ? 'b' : ''}vec${count}`
        : `${scalar}[${count}]`;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return Array.from({ length: Number(count ?? 1) }, (_, k) =>
    [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      ...r.freeSymbols!.flatMap((n) =>
        Array.from({ length: size(n) }, (_, j) => `uniform float u_${n}_${j};`)
      ),
      GLOBALS,
      'out vec4 fragColor;',
      r.preamble ?? '',
      `${result} userFn(${params.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
      body,
      '}',
      'void main() {',
      ...Object.entries(vars).map(([n, text]) => `  ${text} = ${value(n)};`),
      `  fragColor = vec4(float(userFn(${params.map(value).join(', ')})${count === undefined ? '' : `[${k}]`}), 0.0, 0.0, 0.0);`,
      '}',
    ].join('\n')
  );
}

describe('IR profile on GLSL: points', () => {
  test.each(POINTS.map(([label, json, options]) => [label, json, options]))(
    '%s: the fields of the existing target',
    (label, json, options) => {
      const r = glsl(json, options as object);
      expect(r.profile).toBe('ir');
      let existing: ReturnType<typeof glsl> | undefined;
      try {
        existing = compile(ce.box(json as never), {
          to: 'glsl',
          fallback: false,
          ...(options as object),
        });
      } catch {
        existing = undefined;
      }
      // `lowered` (the uniform type the host declares) and the type are the
      // existing target's for each program it compiles.
      expect(existing === undefined).toBe(NOT_COMPARED.has(label as string));
      if (existing !== undefined) {
        expect([...r.freeSymbols!].sort()).toEqual(
          [...existing.freeSymbols!].sort()
        );
        expect(r.freeSymbolTypes).toEqual(existing.freeSymbolTypes);
      }
      const again = glsl(json, options as object);
      expect([again.code, again.preamble]).toEqual([r.code, r.preamble]);
    }
  );

  test('the parametric witness is the code of the existing target', () => {
    const json = ['Tuple', ['Cos', 't'], ['Sin', 't']];
    expect(glsl(json, TYCHO).code).toBe('vec2(cos(t), sin(t))');
    expect(compile(ce.box(json as never), { to: 'glsl', ...TYCHO }).code).toBe(
      'vec2(cos(t), sin(t))'
    );
  });

  test('a point input is a vec2, a list<real^3> input a vec3; the vars text is written for the name, which stays an input', () => {
    const r = glsl(['Add', ['Multiply', 'y', 'P'], 'R'], {
      vars: { P: 'g.P' },
    });
    expect(r.freeSymbolTypes!.P.lowered).toBe('vec2');
    expect(r.freeSymbols).toContain('P');
    expect(r.code).toMatch(/g\.P\[/);
    expect(r.code).not.toMatch(/(?<!\.)\bP\b/);
    expect(glsl(['At', 'L', 1]).freeSymbolTypes!.L.lowered).toBe('vec3');
    for (const B of ['B2', 'BL2'])
      expect(
        glsl(['If', ['At', B, 1], 'x', 'y']).freeSymbolTypes![B].lowered
      ).toBe('bvec2');
    const s = glsl(['Add', 'x', 'y'], { vars: { x: 'u_x' } });
    expect(s.code).toBe('(u_x + y)');
    expect(s.freeSymbols).toEqual(['x', 'y']);
  });
});

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile on GLSL: points in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('each component gives the interpreter value within single-float precision', async () => {
      const items = POINTS.flatMap(([label, json, options, points]) => {
        const vars = (options as { vars?: Record<string, string> }).vars ?? {};
        const r = glsl(json, options);
        const sources = pointShaders(r, vars, interpretPoint(json, points[0]));
        return points.flatMap((p) => {
          const expected = [interpretPoint(json, p)].flat();
          expect(expected.length).toBe(sources.length);
          const uniforms = Object.fromEntries(
            r.freeSymbols!.flatMap((n) =>
              [p[n]].flat().map((x, j) => [`u_${n}_${j}`, x])
            )
          );
          return sources.map((source, k) => ({
            name: `${label} [${k}] at ${JSON.stringify(p)}`,
            source,
            uniforms,
            expected: expected[k],
          }));
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        const e = typeof expected === 'boolean' ? Number(expected) : expected;
        if (typeof e !== 'number' || Number.isNaN(e))
          return failures.push(`${name}: interpreter ${String(e)}`);
        if (!(Math.abs(v.value - e) <= 1e-3 * Math.max(1, Math.abs(e))))
          failures.push(`${name}: ${v.value} vs ${e}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(50);
    }, 120_000);
  }
);

//
// Declines, fallback, canCompile()
//

/** The diagnostic of the decline of `json` with `options`. */
function declined(json: Json, options: object = {}) {
  try {
    glsl(json, options);
  } catch (e) {
    return (e as { diagnostic?: { code: string; message: string } }).diagnostic;
  }
  return undefined;
}

describe('IR profile on GLSL: declines', () => {
  // prettier-ignore
  test.each([
    ['a tuple of several shapes', ['Tuple', 'x', 'L'], {}, /a Tuple of elements of several shapes/],
    ['a list input of run-time length', ['Sum', 'D'], {}, /the list D has a run-time length/],
    ['a list input of 5 elements', ['At', 'L5', 1], {}, /the list input `L5`/],
    ['a tuple argument of a user function', ['pf', 'P'], {}, /the parameter a of pf is not a scalar/],
    ['a tuple result of a user function', ['At', ['pr', 'x'], 1], {}, /the result of pr is not a scalar/],
    ['a vars text that is an expression', ['Add', 'x', 1], { vars: { x: '(u_x + 1.0)' } }, /the vars entry of x/],
    ['a vars text that calls', ['Add', 'x', 1], { vars: { x: 'f(u)' } }, /the vars entry of x/],
    ['a vars name with a value', ['Add', 'h', 'x'], { vars: { h: 'u_h' } }, /the vars entry of h/],
    ['a vars text named as a word of GLSL', ['Add', 'x', 1], { vars: { x: 'float' } }, /the vars entry of x/],
    ['a vars member named as a word of GLSL', ['Add', 'x', 1], { vars: { x: 'u.sample' } }, /the vars entry of x/],
    ['a vars member with a gl_ prefix', ['Add', 'x', 1], { vars: { x: 'u.gl_x' } }, /the vars entry of x/],
    ['a vars member with __', ['Add', 'x', 1], { vars: { x: 'u.a__b' } }, /the vars entry of x/],
    ['a root Function literal', ['Function', ['Add', 'u', 1], 'u'], {}, /a Function literal/],
    ['functions', ['Add', 'x', 1], { functions: { s: 'float s(float t) { return t; }' } }, /`functions`/],
    ['operators', ['Add', 'x', 1], { operators: { Add: ['+', 11] } }, /`operators`/],
    ['imports', ['Add', 'x', 1], { imports: ['a'] }, /`imports`/],
    ['preamble', ['Add', 'x', 1], { preamble: 'float q;' }, /`preamble`/],
    ['storage', ['At', 'L', 'n'], { storage: { L: 'sampler2D' } }, /`storage`/],
    ['callerLocals', ['Add', 'x', 1], { callerLocals: ['x'] }, /`callerLocals`/],
    ['strictTypes', ['Add', 'x', 1], { strictTypes: true }, /`strictTypes`/],
    ['broadcast', ['Add', 'x', 1], { broadcast: true }, /`broadcast`/],
    ['mode', ['Add', 'x', 1], { mode: 'complex' }, /`mode` with the value 'complex'/],
    ['an iterationBudget with a Loop', ['Block', ['Declare', 's', 'real', 0],
      ['Loop', ['Assign', 's', ['Add', 's', 'k']], ['Element', 'k', ['Range', 1, 5]]], 's'],
      { iterationBudget: 100 }, /`iterationBudget` with a Loop/],
    ['an input named v8', ['Add', 'v8', 1], {}, /the input name `v8`/],
    ['an input named float', ['Add', 'float', 1], {}, /the input name `float`/],
    ['an input named as a function the code calls', ['Add', 'sin', ['Sin', 'x']], {}, /the input name `sin`/],
    ['an input named active (reserved in GLSL ES 3.00)', ['Add', 'active', 1], {}, /the input name `active`/],
    ['an input named common', ['Add', 'common', 1], {}, /the input name `common`/],
    ['an input named sampler1D', ['Add', 'sampler1D', 1], {}, /the input name `sampler1D`/],
  ])('%s', (_, json, options, message) => {
    const d = declined(json, options);
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(message);
  });

  test('admitted: a Loop without iterationBudget, a Sum with one', () => {
    expect(
      glsl([
        'Block',
        ['Declare', 's', 'real', 0],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', 'k']],
          ['Element', 'k', ['Range', 1, 5]],
        ],
        's',
      ]).success
    ).toBe(true);
    const r = glsl(['Sum', 'k', ['Limits', 'k', 1, 'n']], {
      iterationBudget: 10,
    });
    expect(r.success).toBe(true);
  });

  test('fallback: true gives the result of the existing GLSL target, with a warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = compile(ce.box(['Add', 'x', 1] as never), {
        to: 'glsl',
        profile: 'ir',
        vars: { x: 'u_x' },
        preamble: '// host',
      });
      expect(r.success).toBe(true);
      expect(r.profile).toBeUndefined();
      expect(r.code).toMatch(/u_x/);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/profile: ir.*`preamble`/)
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('an internal error of the pipeline is a compile-error; with fallback, the existing target compiles', () => {
    // A spelling whose helper list is not a list: the printer throws.
    const broken = {
      rows: [
        {
          head: 'Sinh',
          arity: 1 as const,
          signatures: [[['real'], 'real', 'broken']] as never,
          threads: false,
          effect: 'pure' as const,
        },
      ],
      spellings: { broken: { text: 'x', helpers: 1 as never } },
    };
    _withIrProfileTestExtension(broken, () => {
      expect(declined(['Sinh', 'x'])?.code).toBe('compile-error');
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const r = compile(ce.box(['Sinh', 'x']), { to: 'glsl', profile: 'ir' });
        expect([r.success, r.profile]).toEqual([true, undefined]);
      } finally {
        warn.mockRestore();
      }
    });
  });

  test('the shadow measure counts a compile() with inputs once, on each target', () => {
    const engine = new ComputeEngine();
    engine._jsProfileShadow = 'ir';
    const count = (consumer: string) => {
      const s = _jsProfileShadowStats(engine)[consumer];
      return s === undefined ? 0 : s.attempts + s.baselineDeclined;
    };
    for (const to of ['glsl', 'javascript'] as const)
      compile(engine.box(['Add', 'x', 1]), { to, inputs: { x: 'real' } });
    expect([count('glsl:public'), count('public')]).toEqual([1, 1]);
  });

  test('a shared graph of depth 20 (CE-584) compiles or declines in bounded time and text, on both targets', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.declare('c', 'real');
    // `e_{k+1} = e_k + sin(e_k)`: 2^20 paths, one lowering per node.
    let e = engine.function('Add', [engine.symbol('x'), engine.symbol('c')]);
    // `e_{k+1} = If(x > k, e_k, sin(e_k))`: each arm lowers `e_k` again.
    let b = e;
    for (let i = 0; i < 20; i++) {
      e = engine.function('Add', [e, engine.function('Sin', [e])]);
      b = engine.function('If', [
        engine.function('Greater', [engine.symbol('x'), engine.number(i)]),
        b,
        engine.function('Sin', [b]),
      ]);
    }
    for (const to of ['glsl', 'javascript'] as const) {
      const start = performance.now();
      const r = compile(e, { to, profile: 'ir', fallback: false });
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(10_000);
      let d: { code: string; message: string } | undefined;
      try {
        compile(b, { to, profile: 'ir', fallback: false });
      } catch (x) {
        d = (x as { diagnostic?: { code: string; message: string } })
          .diagnostic;
      }
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(/more than 50000 nodes to lower/);
      expect(performance.now() - start).toBeLessThan(30_000);
    }
  });

  test('canCompile() answers for the profile on glsl', () => {
    const options = { to: 'glsl', profile: 'ir' } as const;
    expect(canCompile(ce.box(['Sin', 'x']), options).ok).toBe(true);
    const no = canCompile(ce.box(['Sum', 'D']), options);
    expect(no.ok).toBe(false);
    expect(!no.ok && no.diagnostic.code).toBe('outside-profile');
  });

  test("the profile 'numeric-kernel' on glsl is still an error of the options", () => {
    expect(() =>
      compile(ce.box(['Sin', 'x']), { to: 'glsl', profile: 'numeric-kernel' })
    ).toThrow(/defined for the target "javascript" only/);
  });
});
