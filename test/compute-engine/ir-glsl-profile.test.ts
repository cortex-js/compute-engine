/**
 * The profile `ir` of `compile()` on the `glsl` target (batches G1 to G3 and
 * G5: `storage`, point and list results of user functions, `callerLocals`;
 * `src/compute-engine/compilation/ir/adapter-glsl.ts`): a scalar or list
 * result of scalar inputs and of inputs that are tuples or lists of a
 * stated length (a `vecN` or a `float[n]`), `At` with a run-time index, the
 * cap on passes, a point parameter of a user function, the
 * `float32-unsafe-argument` warning, and the option `vars`.
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
import { compileSlice } from '../../src/compute-engine/compilation/ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import { agrees, interpret, makeEngine, type Point } from './ir-slice-oracle';
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
// Batch G3: an array input and a run-time index.
ce.declare('L6', 'list<real^6>');
ce.declare('ix', 'real');
// Batch G5: a list in a sampler (`storage`), and the functions that read
// it; point and list results of user functions.
ce.declare('S', 'list<real^7>');
ce.declare('S7', 'list<real^7>');
ce.assign('gs', ce.box(['Function', ['At', 'S', 'a'], 'a']));
ce.declare('gq', '(list<real^7>) -> real');
ce.assign(
  'gq',
  ce.box(['Function', ['Add', ['At', 'q', 2], ['At', 'q', -1]], 'q'])
);
ce.declare('same', '(list<real^7>) -> list<real^7>');
ce.assign('same', ce.box(['Function', 'q', 'q']));
ce.declare('pt', '(real) -> tuple<real, real>');
ce.assign(
  'pt',
  ce.box(['Function', ['Tuple', ['Cos', 'a'], ['Sin', 'a']], 'a'])
);
ce.declare('pl', '(real) -> list<real^3>');
ce.assign(
  'pl',
  ce.box(['Function', ['List', 'a', ['Multiply', 2, 'a'], 3], 'a'])
);
ce.declare('pc', '(real) -> tuple<complex, complex>');
ce.assign(
  'pc',
  ce.box(['Function', ['Tuple', ['Cos', 'a'], ['Sin', 'a']], 'a'])
);
ce.declare('pi2', '(real) -> tuple<integer, integer>');
ce.assign(
  'pi2',
  ce.box(['Function', ['Tuple', ['Cos', 'a'], ['Sin', 'a']], 'a'])
);
ce.declare('E64', 'list<real^64>');
ce.declare('E65', 'list<real^65>');
// A function that reads a list input of 6 elements (lifted).
ce.assign('gL', ce.box(['Function', ['At', 'L6', 'a'], 'a']));
ce.declare('rt', '(real) -> tuple<real, real>');
ce.assign(
  'rt',
  ce.box([
    'Function',
    ['If', ['Less', 'a', 0], ['rt', ['Add', 'a', 1]], ['Tuple', 'a', 'a']],
    'a',
  ])
);
// `callerLocals`: functions that read an input of the compilation.
ce.assign('gx', ce.box(['Function', ['Add', 'u', 'x'], 'u']));
ce.assign('gy', ce.box(['Function', ['Multiply', 2, ['gx', 'u']], 'u']));
ce.assign(
  'gp',
  ce.box(['Function', ['Add', 'u', ['At', 'P', 1], ['At', 'P', 2]], 'u'])
);
ce.assign('gpm', ce.box(['Function', ['Multiply', 'u', 'P'], 'u']));
// A sine hash in the body of a user function.
ce.assign(
  'fh',
  ce.box([
    'Function',
    ['Mod', ['Multiply', 10000, ['Sin', ['Multiply', 10000, 't']]], 1],
    't',
  ])
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
            /^(L|L6|V4|BL2|S)$/.test(k) ? 'List' : 'Tuple',
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
  const size = (n: string) =>
    Number(
      /^b?vec(\d)$|\[(\d+)\]$/.exec(type(n))?.find((x, k) => k > 0 && x) ?? 1
    );
  const value = (n: string) =>
    !/vec|\[/.test(type(n))
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
// Batch G3: an array input of another stated length, `At` with a run-time
// index, the cap on passes, a point parameter of a user function
//

const L6 = [1.5, 2, 3, 4, 5, 6.5];
const SUM_N = ['Sum', ['Multiply', 'j', 'x'], ['Limits', 'j', 1, 'n']];
// prettier-ignore
const G3: [label: string, json: Json, options: object, points: PointValue[]][] = [
  ['At(L6, ix)', ['At', 'L6', 'ix'], {}, [1, 6, -1, -6, 0, 7, -7, 2.5].map((ix) => ({ L6, ix }))],
  ['At(P3, ix)', ['At', 'P3', 'ix'], {}, [1, 3, -2, 0, 4, 1.5].map((ix) => ({ P3: [0.5, 1, -2], ix }))],
  ['Sum(L6)', ['Sum', 'L6'], {}, [{ L6 }]],
  ['Max(L6)', ['Max', 'L6'], {}, [{ L6 }, { L6: [-1, -2, -3, -4, -5, -0.5] }]],
  ['2·L6', ['Multiply', 2, 'L6'], {}, [{ L6 }]],
  ['Length(L6) + x', ['Add', ['Length', 'L6'], 'x'], {}, [{ x: 0.5, L6 }]],
  ['a Sum under and over the default cap', SUM_N, {}, [{ n: 100, x: 0.5 }, { n: 10000, x: 1 }, { n: 10001, x: 1 }, { n: 20000, x: 1 }]],
  ['a Sum under and over an iterationBudget', SUM_N, { iterationBudget: 50 }, [{ n: 50, x: 0.5 }, { n: 51, x: 0.5 }]],
  ['a Loop within the budget', ['Block', ['Declare', 's', 'real', 0], ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', 'j', 'x']]], ['Element', 'j', ['Range', 1, 5]]], 's'], { iterationBudget: 5 }, [{ x: 0.5 }]],
  ['a point parameter', ['pf', 'P'], {}, [{ P: [1, 2] }, { P: [-3, 0.25] }]],
  ['a point argument', ['pf', ['Tuple', 'x', ['Sin', 'x']]], {}, [{ x: 0.5 }, { x: -2 }]],
  ['a nest of 220 passes', ['Sum', ['Sum', ['Multiply', 'i', 'j', 'x'], ['Limits', 'j', 1, 10]], ['Limits', 'i', 1, 20]], {}, [{ x: 0.5 }]],
];

// A user function that reads the point input `P3` at a constant index.
ce.assign(
  'gAt',
  ce.box(['Function', ['If', ['Greater', 't', 0], ['At', 'P3', 0], 0.5], 't'])
);

/** `At` with a constant index (also one that the passes fold) that is 0,
 *  not an integer or past the stated length of its list: declined, a rule
 *  of the profile (README, "Selecting the pipeline"), in the entry and in a
 *  user function. */
// prettier-ignore
const AT_OUTSIDE_INPUT: [label: string, json: Json, options: object, cause: string][] = [
  ['At(L6, 0)', ['At', 'L6', 0], {}, 'the index 0 of At is outside the 6 elements of its list'],
  ['At(L6, 7)', ['At', 'L6', 7], {}, 'the index 7 of At is outside the 6 elements of its list'],
  ['At(L6, -7)', ['At', 'L6', -7], {}, 'the index -7 of At'],
  ['At(L6, 1.5)', ['At', 'L6', 1.5], {}, 'the index 1.5 of At'],
  ['At(P3, 5)', ['At', 'P3', 5], {}, 'the index 5 of At is outside the 3 elements of its list'],
  ['At(P3, 0)', ['At', 'P3', 0], {}, 'the index 0 of At'],
  ['At(L6, k) with k a local of value 7', ['Block', ['Declare', 'k', 'integer', 7], ['At', 'L6', 'k']], {}, 'the index 7 of At'],
  ['At(L6, Length(L6) + 1)', ['At', 'L6', ['Add', ['Length', 'L6'], 1]], {}, 'the index 7 of At'],
  ['At(L6, 7) with constantFold: false', ['At', 'L6', 7], { constantFold: false }, 'the index 7 of At'],
  ['At(S, 8) of a list in storage', ['Multiply', 'x', ['At', 'S', 8]], { storage: { S: 'sampler2D' } }, 'the index 8 of At is outside the 7 elements of its list'],
  ['At(P3, 0) in a user function', ['gAt', 'x'], {}, 'the index 0 of At is outside the 3 elements of its list'],
  ['At(List(x, y, 3), 4) of a literal list', ['At', ['List', 'x', 'y', 3], 4], {}, 'the index 4 of At is outside the 3 elements of its list'],
];

describe('IR profile on GLSL: At with a constant index outside its list', () => {
  test.each(AT_OUTSIDE_INPUT)('%s declines', (_, json, options, cause) => {
    let d: { code: string; message: string } | undefined;
    try {
      glsl(json, options);
    } catch (x) {
      d = (x as { diagnostic?: { code: string; message: string } }).diagnostic;
    }
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toContain(cause);
  });

  test('an index in range, from the end, or at run time compiles', () => {
    expect(glsl(['At', 'L6', -6]).code).toBe('L6[int(0.0)]');
    expect(glsl(['At', 'L6', 6]).code).toBe('L6[int(5.0)]');
    expect(glsl(['At', 'L6', 'ix']).success).toBe(true);
  });
});

/** The interpreter's value at `point`; a `Sum` of more passes than the cap
 *  (`iterationBudget`, 10,000 by default) is NaN, as on the existing
 *  target. */
function interpretG3(json: Json, options: object, point: PointValue): unknown {
  const budget = (options as { iterationBudget?: number }).iterationBudget;
  if (json === SUM_N && (point.n as number) > (budget ?? 10_000)) return NaN;
  return interpretPoint(json, point);
}

describe('IR profile on GLSL: arrays, At, the cap, point parameters', () => {
  test.each(G3.map(([label, json, options]) => [label, json, options]))(
    '%s: the fields of the existing target',
    (label, json, options) => {
      const r = glsl(json, options as object);
      expect(r.profile).toBe('ir');
      // A Sum, a Max and an element-wise operation of a `float[6]` decline
      // on the existing target.
      if (/^(Sum|Max)\(L6\)$|2·L6/.test(label as string)) return;
      const existing = compile(ce.box(json as never), {
        to: 'glsl',
        fallback: false,
        ...(options as object),
      });
      expect(r.freeSymbolTypes).toEqual(existing.freeSymbolTypes);
    }
  );

  test('an array input is a float[6], as on the existing target; At with a run-time index reads the array in range only', () => {
    const r = glsl(['At', 'L6', 'ix']);
    const existing = compile(ce.box(['At', 'L6', 'ix']), { to: 'glsl' });
    expect(r.freeSymbolTypes).toEqual(existing.freeSymbolTypes);
    expect(r.freeSymbolTypes!.L6.lowered).toBe('float[6]');
    expect(r.code).toMatch(/\? L6\[.*\] : uintBitsToFloat\(0x7fc00000u\)\)$/);
    expect(glsl(['At', 'P3', 'ix']).code).toMatch(
      /abs\(ix\) <= float\(3\) \? P3\[clamp\(ix > 0\.0 \? int\(ix\) - 1 : 3 \+ int\(ix\), 0, 3 - 1\)\]/
    );
    expect(glsl(['Multiply', 2, 'L6']).code).toMatch(/^float\[6\]\(/);
  });

  test('the cap: a Sum of a run-time count tests its count, a Loop over the cap declines', () => {
    expect(glsl(SUM_N).code).toMatch(
      /^float v\d+;\nif \(\(\(n - 1\.0\) < 10000\.0\)\) \{/
    );
    expect(glsl(SUM_N, { iterationBudget: 50 }).code).toMatch(/< 50\.0/);
    // `Infinity`: no cap (`compile()` refuses `NaN` and 0 before any
    // target).
    expect(glsl(SUM_N, { iterationBudget: Infinity }).code).not.toMatch(
      /10000/
    );
  });

  test('a point parameter on JavaScript: the same function, an array', () => {
    for (const json of [
      ['pf', 'P'],
      ['pf', ['Tuple', 'x', ['Sin', 'x']]],
    ]) {
      const r = compile(ce.box(json as never), {
        profile: 'ir',
        fallback: false,
      });
      expect(r.profile).toBe('ir');
      for (const p of [
        { P: [1, 2], x: 0.5 },
        { P: [-3, 0.25], x: -2 },
      ])
        expect(r.run!(p as never)).toBeCloseTo(
          interpretPoint(json, p) as number,
          12
        );
    }
  });
});

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile on GLSL: arrays, At, the cap, point parameters in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('each component gives the interpreter value (NaN where it is NaN)', async () => {
      const items = G3.flatMap(([label, json, options, points]) => {
        const r = glsl(json, options);
        const sources = pointShaders(r, {}, interpretPoint(json, points[0]));
        return points.flatMap((p) => {
          const expected = [interpretG3(json, options, p)].flat();
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
        // A float32 sum of 10,000 terms is off by about 4e-5, and the `sin`
        // of SwiftShader by about 3e-5 (`2·sin(-2)`), as in the first test.
        const tolerance = /default cap|point argument/.test(name) ? 1e-3 : 1e-5;
        if (typeof expected !== 'number')
          return failures.push(`${name}: interpreter ${String(expected)}`);
        if (Number.isNaN(expected) !== Number.isNaN(v.value))
          return failures.push(`${name}: ${v.value} vs ${expected}`);
        if (
          !Number.isNaN(expected) &&
          !(
            Math.abs(v.value - expected) <=
            tolerance * Math.max(1, Math.abs(expected))
          )
        )
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(36);
    }, 120_000);
  }
);

//
// The float32-unsafe warning (`gpu-exact-trig.ts`, `isAmplifiedTrig()`)
//

describe('IR profile on GLSL: the float32-unsafe warning', () => {
  const codes = (r: ReturnType<typeof glsl>) =>
    r.warnings?.map((w) => [w.code, w.kind]);
  const existing = (json: Json) =>
    compile(typeof json === 'string' ? ce.parse(json) : ce.box(json as never), {
      to: 'glsl',
    });
  const ir = (json: Json) =>
    typeof json === 'string' ? compile(ce.parse(json), IR) : glsl(json);
  const WARNED = [['float32-unsafe-argument', 'correctness']];

  // From `compile-glsl-exact-trig.test.ts`.
  test.each([
    '\\operatorname{mod}(10^4\\tan(x),1)',
    '\\operatorname{mod}(10^4\\sin(10^4x),2)',
    '\\operatorname{mod}(10^4y\\sin(x),1)',
    '\\operatorname{mod}(43758.5453\\sin(12.9898x^2),1)',
  ])('%s: warned, as on the existing target', (latex) => {
    expect(codes(existing(latex))).toEqual(WARNED);
    expect(codes(ir(latex))).toEqual(WARNED);
  });

  test('an operand with an exact form on the existing target warns on the profile, which has none', () => {
    const latex = '\\operatorname{mod}(10^4\\sin(10^4x),1)';
    expect(existing(latex).float32Bounds).toEqual([
      { operand: 'x', maxAbs: 2600 },
    ]);
    const r = ir(latex);
    expect(codes(r)).toEqual(WARNED);
    expect(r.float32Bounds).toBeUndefined();
    expect(codes(glsl(['Fract', ['Multiply', 1e4, ['Sin', 'x']]]))).toEqual(
      WARNED
    );
  });

  test('one warning per operand, also in the body of a user function', () => {
    const r = ir(
      '\\operatorname{mod}(43758.5453\\tan(y),1)+\\operatorname{mod}(43758.5453\\sin(x^2),1)+\\operatorname{mod}(43758.5453\\tan(y),1)'
    );
    expect(r.warnings?.map((w) => w.value).sort()).toEqual(
      existing(
        '\\operatorname{mod}(43758.5453\\tan(y),1)+\\operatorname{mod}(43758.5453\\sin(x^2),1)+\\operatorname{mod}(43758.5453\\tan(y),1)'
      )
        .warnings?.map((w) => w.value)
        .sort()
    );
    expect(codes(glsl(['fh', 'x']))).toEqual(WARNED);
  });

  test('a closed operand warns only with constantFold: false, where it stays shader arithmetic', () => {
    // Tycho's witness: a fixed pseudo-random number per curve, which the
    // lowering folds in doubles.
    for (const json of [
      ['Mod', ['Multiply', 10000, ['Sin', 1]], 2],
      ['Mod', ['Multiply', 10000, ['Sin', 100000]], 1],
      ['Fract', ['Multiply', 43758.5, ['Sin', ['Multiply', 12.9898, 'Pi']]]],
    ]) {
      expect(codes(glsl(json, { constantFold: false }))).toEqual(WARNED);
      expect(glsl(json).warnings).toBeUndefined();
    }
    // A closed operand under a call or an operator out of the rows warns,
    // and so does a closed dividend of a `Mod` by an input, which is not
    // folded (it is the float32 literal 8414710.0).
    for (const json of [
      ['Mod', ['Multiply', 10000, ['Sin', ['h2', 1]]], 1],
      ['Mod', ['Multiply', 10000000, ['Sin', 1]], 'x'],
    ])
      expect(codes(glsl(json))).toEqual(WARNED);
  });

  test('a shared graph of depth 40 (CE-584) is walked once per node', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    let e = engine.symbol('x') as Expression;
    for (let i = 0; i < 40; i++)
      e = engine.function('Add', [e, engine.function('Sin', [e])]);
    const start = performance.now();
    const r = compile(e, IR);
    expect(r.success).toBe(true);
    expect(performance.now() - start).toBeLessThan(5_000);
  });

  test('no warning: an operand that is not amplified, no Mod, no trigonometric function', () => {
    for (const json of [
      '\\operatorname{mod}(\\sin(x)+1,1)',
      '\\operatorname{mod}(1000x+\\sin(y),1)',
      ['Sin', ['Multiply', 1e4, 'x']],
      ['Add', ['Multiply', 'x', 'x'], 1],
    ])
      expect(ir(json).warnings).toBeUndefined();
  });
});

//
// Batch G5: `storage` (a list in a sampler), point and list results of user
// functions
//

const SV = [1.5, -2, 3.25, 4, 5.5, -6, 7.75];
const STORAGE = { storage: { S: 'sampler2D' } } as const;
// prettier-ignore
const STORED: [label: string, json: Json, points: PointValue[]][] = [
  ['At(S, ix)', ['At', 'S', 'ix'], [1, 7, -1, -7, 0, 8, -8, 2.5].map((ix) => ({ ix }))],
  ['At(S, 3) + At(S, -2)', ['Add', ['At', 'S', 3], ['At', 'S', -2]], [{}]],
  ['a Sum of At over Limits', ['Sum', ['Multiply', ['At', 'S', 'j'], 'x'], ['Limits', 'j', 1, 7]], [{ x: 0.5 }]],
  ['a function that reads S', ['gs', 'ix'], [{ ix: 2 }, { ix: -1 }, { ix: 9 }]],
  ['S passed to a list parameter', ['gq', 'S'], [{}]],
  ['Sum(S)', ['Sum', 'S'], [{}]],
  ['Max(S)', ['Max', 'S'], [{}]],
  ['2·S + x', ['Add', ['Multiply', 2, 'S'], 'x'], [{ x: 0.5 }]],
  ['Length(S) + x', ['Add', ['Length', 'S'], 'x'], [{ x: 0.5 }]],
];
/** `head` of `n` reads `At(S, Mod(ix + i, 7) + 1)`, each in range at an
 *  integer `ix`: the element `(ix + i) mod 7` from 0. */
const chain = (head: string, n = 1_000) =>
  ce.function(
    head,
    Array.from({ length: n }, (_, i) =>
      ce.box([
        'At',
        'S',
        ['Add', ['Mod', ['Add', 'ix', i], 7], 1],
      ] as never)
    )
  );
/** The value of the `Add` chain. */
const chainValue = (ix: number, n = 1_000) =>
  Array.from({ length: n }, (_, i) => SV[(ix + i) % 7]).reduce(
    (a, b) => a + b,
    0
  );
/** The programs that the existing target declines (it reads a list in a
 *  sampler only with `At`). */
const STORED_DECLINED = /^(Sum|Max)\(S\)$|2·S/;

/** The shaders of a host for a result read from `S`: `uniform sampler2D
 *  S;` and `precision highp sampler2D;` (a lowp fetch quantizes), the other
 *  inputs `float` uniforms; one shader per component of the result. */
function storageShaders(
  r: ReturnType<typeof glsl>,
  expected: unknown,
  sampler = 'S'
) {
  const scalars = r.freeSymbols!.filter((n) => n !== sampler);
  const count = Array.isArray(expected) ? expected.length : undefined;
  const result =
    count === undefined ? 'float' : count <= 4 ? `vec${count}` : `float[${count}]`;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return Array.from({ length: count ?? 1 }, (_, k) =>
    [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      'precision highp sampler2D;',
      `uniform sampler2D ${sampler};`,
      ...scalars.map((n) => `uniform float u_${n};`),
      'out vec4 fragColor;',
      r.preamble ?? '',
      `${result} userFn(${scalars.map((n) => `float ${n}`).join(', ')}) {`,
      body,
      '}',
      'void main() {',
      `  fragColor = vec4(float(userFn(${scalars.map((n) => `u_${n}`).join(', ')})${count === undefined ? '' : `[${k}]`}), 0.0, 0.0, 0.0);`,
      '}',
    ].join('\n')
  );
}

describe('IR profile on GLSL: storage', () => {
  test.each(STORED.map(([label, json]) => [label, json]))(
    '%s: the fields of the existing target',
    (label, json) => {
      const r = glsl(json, STORAGE);
      expect(r.profile).toBe('ir');
      // A list in a sampler is read through the helper only.
      expect(r.code).not.toMatch(/\bS\[/);
      if (label !== 'Length(S) + x')
        expect(`${r.code}\n${r.preamble}`).toMatch(/_gpu_ir_texel\(/);
      const existing = () =>
        compile(ce.box(json as never), {
          to: 'glsl',
          fallback: false,
          ...STORAGE,
        });
      if (STORED_DECLINED.test(label as string))
        return void expect(existing).toThrow();
      expect(r.freeSymbolTypes).toEqual(existing().freeSymbolTypes);
      expect(r.freeSymbolTypes!.S.lowered).toBe('float[7]');
    }
  );

  test('the helper: one for every length; a function parameter is a sampler2D', () => {
    const r = glsl(['Add', ['At', 'S', 'ix'], ['gs', 'x']], STORAGE);
    expect(r.preamble!.match(/float _gpu_ir_texel\(/g)).toHaveLength(1);
    expect(r.preamble).toMatch(/^float _fn_ir_\w+_gs\(float \w+, sampler2D \w+\)/m);
    expect(glsl(['gq', 'S'], STORAGE).preamble).toMatch(
      /^float _fn_ir_\w+_gq\(sampler2D \w+\)/m
    );
  });

  // prettier-ignore
  test.each([
    ['S as a value', 'S', STORAGE, /a list in storage as a value/],
    ['S in an arm of an If', ['If', ['Less', 'x', 0], 'S', ['Multiply', 2, 'S']], STORAGE, /a list in storage as a value/],
    ['a function that returns S', ['At', ['same', 'S'], 1], STORAGE, /a list in storage as a value/],
    ['one function called with S and with a uniform array', ['Add', ['gq', 'S'], ['gq', 'S7']], STORAGE, /a call of \w+ with a list in storage and one not/],
    ['a boolean list in storage', ['If', ['At', 'BL2', 1], 'x', 'y'], { storage: { BL2: 'sampler2D' } }, /the storage of BL2, which is not a list of numbers/],
    ['a name in vars and in storage', ['At', 'S', 1], { ...STORAGE, vars: { S: 'u_s' } }, /the vars entry of S in storage/],
  ])('declined: %s', (_, json, options, message) => {
    const d = declined(json, options);
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(message);
  });

  test('the option has no effect on JavaScript', () => {
    const r = compile(ce.box(['Add', ['At', 'S', 'ix'], ['gs', 2]]), {
      profile: 'ir',
      fallback: false,
      ...STORAGE,
    });
    expect(r.profile).toBe('ir');
    expect(r.run!({ S: SV, ix: -1 } as never)).toBe(7.75 - 2);
  });

  test('a shared graph of depth 20 with a read of S compiles in bounded text', () => {
    let e = ce.function('Add', [
      ce.function('At', [ce.symbol('S'), ce.symbol('ix')]),
      ce.symbol('x'),
    ]);
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [e, ce.function('Sin', [e])]);
    const r = compile(e, { ...IR, ...STORAGE });
    expect(r.success).toBe(true);
    expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(10_000);
  });

  test('a chain of 1,000 reads of S (Add, Max) compiles', () => {
    for (const head of ['Add', 'Max'])
      expect(compile(chain(head), { ...IR, ...STORAGE }).success).toBe(true);
  });

  test('an element-wise operation over a list of more than 64 elements declines; of 64, compiles', () => {
    const sum = (E: string) => ['Sum', ['Add', ['Multiply', 2, E], 'x']];
    expect(glsl(sum('E64'), { storage: { E64: 'sampler2D' } }).success).toBe(
      true
    );
    for (const options of [{ storage: { E65: 'sampler2D' } }, {}]) {
      const d = declined(sum('E65'), options);
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(
        /an element-wise Multiply over a list of more than 64 elements/
      );
    }
    // A reduction and At are a loop and a read.
    expect(glsl(['Sum', 'E65'], { storage: { E65: 'sampler2D' } }).success).toBe(
      true
    );
  });

  test('a function that reads a list input of 6 elements declines on GLSL and compiles on JavaScript', () => {
    expect(declined(['gL', 'ix'])?.message).toMatch(
      /the function gL reads the input L6, a list of 6 elements, which glsl would copy at each call/
    );
    const r = compile(ce.box(['gL', 'ix']), { profile: 'ir', fallback: false });
    expect(r.run!({ L6, ix: -1 } as never)).toBe(6.5);
  });

  test('a recursive function with a tuple result: the cause', () => {
    expect(declined(['rt', 'x'])?.message).toMatch(
      /a recursive call of rt, a function with a list or tuple result/
    );
  });

  test('a loop over S in a Sum: within the pass bound, or declined', () => {
    const nested = (hi: Json) => [
      'Sum',
      ['Multiply', ['Sum', 'S'], 'j'],
      ['Limits', 'j', 1, hi],
    ];
    // 10 passes of 1 + 7 passes.
    expect(glsl(nested(10), STORAGE).success).toBe(true);
    expect(declined(nested('n'), STORAGE)?.message).toMatch(
      /more passes than the iterationBudget \(10000\)/
    );
    expect(
      glsl(
        ['Sum', ['Sum', ['Multiply', ['At', 'S', 'i'], ['At', 'S', 'j']], ['Limits', 'j', 1, 7]], ['Limits', 'i', 1, 7]],
        STORAGE
      ).success
    ).toBe(true);
  });
});

// prettier-ignore
const RESULTS: [label: string, json: Json, points: PointValue[]][] = [
  ['a point result', ['pt', 'x'], [{ x: 0.5 }, { x: -2 }]],
  ['2·pt(x) + (1, x)', ['Add', ['Multiply', 2, ['pt', 'x']], ['Tuple', 1, 'x']], [{ x: 0.5 }]],
  ['At(pt(x), 2)', ['At', ['pt', 'x'], 2], [{ x: 0.5 }, { x: 3 }]],
  ['a list<real^3> result', ['pl', 'x'], [{ x: 0.5 }, { x: -1.25 }]],
  ['Sum(pl(x))', ['Sum', ['pl', 'x']], [{ x: 0.5 }]],
];

describe('IR profile: a point or list result of a user function', () => {
  test.each(RESULTS.map(([label, json, points]) => [label, json, points]))(
    '%s on JavaScript',
    (_, json, points) => {
      const r = compile(ce.box(json as never), { profile: 'ir', fallback: false });
      expect(r.profile).toBe('ir');
      for (const p of points as PointValue[]) {
        const value = [r.run!(p as never)].flat() as number[];
        const expected = [interpretPoint(json, p)].flat() as number[];
        expect(value).toHaveLength(expected.length);
        value.forEach((v, k) => expect(v).toBeCloseTo(expected[k], 12));
      }
    }
  );

  test('the GLSL function returns a vec2 or a vec3', () => {
    expect(glsl(['pt', 'x']).preamble).toMatch(/^vec2 _fn_ir_\w+_pt\(float/m);
    expect(glsl(['pl', 'x']).preamble).toMatch(/^vec3 _fn_ir_\w+_pl\(float/m);
  });
});

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile on GLSL: storage and function results in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    /** NaN where the interpreter is NaN, else within `tolerance`. */
    const failuresOf = (
      values: { ok: boolean; value?: number; log?: string }[],
      items: { name: string; expected: unknown }[],
      tolerance: number
    ) => {
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (typeof expected !== 'number')
          return failures.push(`${name}: interpreter ${String(expected)}`);
        if (Number.isNaN(expected) !== Number.isNaN(v.value!))
          return failures.push(`${name}: ${v.value} vs ${expected}`);
        if (
          !Number.isNaN(expected) &&
          !(Math.abs(v.value! - expected) <= tolerance * Math.max(1, Math.abs(expected)))
        )
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      return failures;
    };

    test('a list in a texture of width 1, 3, 7 or 10 gives the interpreter values; the existing target reads the same values from the same texture', async () => {
      const items: (Parameters<GlslDriver['evaluate']>[0][number] & {
        expected: unknown;
      })[] = [];
      for (const [label, json, points] of STORED) {
        const r = glsl(json, STORAGE);
        const existing = STORED_DECLINED.test(label)
          ? undefined
          : compile(ce.box(json as never), { to: 'glsl', fallback: false, ...STORAGE });
        const first = interpretPoint(json, { ...points[0], S: SV });
        for (const p of points)
          for (const width of [1, 3, 7, 10]) {
            const expected = [interpretPoint(json, { ...p, S: SV })].flat();
            const uniforms = Object.fromEntries(
              Object.entries(p).map(([n, v]) => [`u_${n}`, v as number])
            );
            const textures = { S: { width, values: SV } };
            const at = `${label} at ${JSON.stringify(p)}, width ${width}`;
            storageShaders(r, first).forEach((source, k) =>
              items.push({ name: `${at} [${k}]`, source, uniforms, textures, expected: expected[k] })
            );
            // The same host shader with the existing target's text.
            if (existing !== undefined)
              items.push({
                name: `${at}, existing target`,
                source: storageShaders(existing, first)[0],
                uniforms,
                textures,
                expected: expected[0],
              });
          }
      }
      const values = await driver.evaluate(items);
      expect(failuresOf(values, items, 1e-5)).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(100);
    }, 120_000);

    test('Sum(2·E64 + x) and a chain of 100 reads give their values', async () => {
      const E = Array.from({ length: 64 }, (_, i) => Math.sin(i) * 3);
      const sum = compile(
        ce.box(['Sum', ['Add', ['Multiply', 2, 'E64'], 'x']] as never),
        { ...IR, storage: { E64: 'sampler2D' } }
      );
      const items = [
        {
          name: 'Sum(2·E64 + x)',
          source: storageShaders(sum, 0, 'E64')[0],
          uniforms: { u_x: 0.5 },
          textures: { E64: { width: 10, values: E } },
          expected: E.reduce((a, e) => a + 2 * e + 0.5, 0),
        },
        // A chain of 100 reads: SwiftShader takes about 50 s to compile one
        // of 1,000, which the test above compiles without running.
        {
          name: 'Add of 100 reads at ix = 3',
          source: storageShaders(compile(chain('Add', 100), { ...IR, ...STORAGE }), 0)[0],
          uniforms: { u_ix: 3 },
          textures: { S: { width: 3, values: SV } },
          expected: chainValue(3, 100),
        },
      ];
      const values = await driver.evaluate(items);
      expect(failuresOf(values, items, 1e-5)).toEqual([]);
    }, 120_000);

    test('a point or list result of a user function gives the interpreter values', async () => {
      const items = RESULTS.flatMap(([label, json, points]) => {
        const r = glsl(json);
        const sources = pointShaders(r, {}, interpretPoint(json, points[0]));
        return points.flatMap((p) => {
          const expected = [interpretPoint(json, p)].flat();
          return sources.map((source, k) => ({
            name: `${label} [${k}] at ${JSON.stringify(p)}`,
            source,
            uniforms: Object.fromEntries(
              Object.entries(p).map(([n, v]) => [`u_${n}_0`, v as number])
            ),
            expected: expected[k],
          }));
        });
      });
      const values = await driver.evaluate(items);
      expect(failuresOf(values, items, 1e-3)).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(15);
    }, 120_000);
  }
);

//
// `callerLocals`: no effect on the profile, whose functions take each input
// that their bodies read as a parameter
//

// prettier-ignore
const CALLER: [label: string, json: Json, options: object, points: PointValue[]][] = [
  ['g(u) := u + x', ['gx', 1], { callerLocals: ['x'] }, [{ x: 0.5 }, { x: -2 }]],
  ['x read through a function that calls g', ['Add', ['gy', 'y'], 'x'], { callerLocals: ['x', 'y'] }, [{ x: 0.5, y: 2 }]],
  ['a callerLocals name with a vars text', ['gx', 'y'], { callerLocals: ['x'], vars: { x: 'g_x' } }, [{ x: 0.5, y: 2 }]],
  ['a point callerLocals name', ['gp', 'y'], { callerLocals: ['P'] }, [{ y: 2, P: [3, -4] }]],
  ['a point callerLocals name in a point result', ['gpm', 'y'], { callerLocals: ['P'] }, [{ y: 2, P: [3, -4] }]],
];

describe('IR profile on GLSL: callerLocals', () => {
  test('a function that reads x takes it as a parameter, and the call passes it', () => {
    const r = glsl(['gx', 1], { callerLocals: ['x'] });
    expect(r.code).toMatch(/_fn_ir_\w+_gx\(1\.0, x\)/);
    expect(r.preamble).toMatch(/^float _fn_ir_\w+_gx\(float \w+, float \w+\)/m);
    expect(glsl(['gx', 'y'], CALLER[2][2]).code).toMatch(/_gx\(y, g_x\)/);
    expect(glsl(['gp', 'y'], { callerLocals: ['P'] }).preamble).toMatch(
      /^float _fn_ir_\w+_gp\(float \w+, vec2 \w+\)/m
    );
  });

  test('declined: the name under a binder of the same name', () => {
    const d = declined(
      ['Sum', ['Add', 'x', ['gx', 'x']], ['Limits', 'x', 1, 3]],
      { callerLocals: ['x'] }
    );
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(
      /a call of gx, which reads the input x, where x is a local or a parameter/
    );
  });
});

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile on GLSL: callerLocals in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the inputs as parameters of the host function give the interpreter values', async () => {
      const items = CALLER.flatMap(([label, json, options, points]) => {
        const vars = (options as { vars?: Record<string, string> }).vars ?? {};
        const r = glsl(json, options);
        const sources = pointShaders(r, vars, interpretPoint(json, points[0]));
        return points.flatMap((p) => {
          const expected = [interpretPoint(json, p)].flat();
          const uniforms = Object.fromEntries(
            r.freeSymbols!.flatMap((n) =>
              [p[n]].flat().map((x, j) => [`u_${n}_${j}`, x])
            )
          );
          return sources.map((source, k) => ({
            name: `${label} [${k}] at ${JSON.stringify(p)}`,
            source,
            uniforms,
            expected: expected[k] as number,
          }));
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (!(Math.abs(v.value - expected) <= 1e-5 * Math.max(1, Math.abs(expected))))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(7);
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
    ['a tuple<complex, complex> result of a user function', ['At', ['pc', 'x'], 1], {}, /the result of pc is not a scalar/],
    ['a tuple<integer, integer> result of a real body', ['At', ['pi2', 'x'], 1], {}, /a body of pi2 that is not tuple<integer, integer>/],
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
    ['strictTypes', ['Add', 'x', 1], { strictTypes: true }, /`strictTypes`/],
    ['broadcast', ['Add', 'x', 1], { broadcast: true }, /`broadcast`/],
    ['mode', ['Add', 'x', 1], { mode: 'bigint' }, /the bigint mode on glsl/],
    ['a Loop of more passes than the iterationBudget', ['Block', ['Declare', 's', 'real', 0],
      ['Loop', ['Assign', 's', ['Add', 's', 'k']], ['Element', 'k', ['Range', 1, 5]]], 's'],
      { iterationBudget: 4 }, /more passes than the iterationBudget \(4\)/],
    ['a Loop of more passes than the default cap', ['Block', ['Declare', 's', 'real', 0],
      ['Loop', ['Assign', 's', ['Add', 's', 'k']], ['Element', 'k', ['Range', 1, 20000]]], 's'],
      {}, /more passes than the iterationBudget \(10000\)/],
    ['a Loop in a Sum of a run-time count', ['Sum', ['Block', ['Declare', 's', 'real', 0],
      ['Loop', ['Assign', 's', ['Add', 's', 'k']], ['Element', 'k', ['Range', 1, 5]]], 's'], ['Limits', 'j', 1, 'n']],
      {}, /more passes than the iterationBudget \(10000\)/],
    ['two nested Sums of 10,000 passes', ['Sum', ['Sum', ['Multiply', 'i', 'j', 'x'], ['Limits', 'j', 1, 10000]], ['Limits', 'i', 1, 10000]],
      {}, /more passes than the iterationBudget \(10000\)/],
    ['two nested Sums of run-time counts', ['Sum', ['Sum', ['Multiply', 'i', 'j', 'x'], ['Limits', 'j', 1, 'm']], ['Limits', 'i', 1, 'n']],
      {}, /more passes than the iterationBudget \(10000\)/],
    ['a Loop of 10,000 passes around a Sum of a run-time count', ['Block', ['Declare', 's', 'real', 0],
      ['Loop', ['Assign', 's', ['Add', 's', ['Sum', ['Multiply', 'j', 'x'], ['Limits', 'j', 1, 'n']]]], ['Element', 'k', ['Range', 1, 10000]]], 's'],
      {}, /more passes than the iterationBudget \(10000\)/],
    ['a reduction in a Sum of a run-time count', ['Sum', ['Multiply', ['Max', 'L6'], 'j'], ['Limits', 'j', 1, 'n']],
      {}, /more passes than the iterationBudget \(10000\)/],
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
          head: 'Sinc',
          arity: 1 as const,
          signatures: [[['real'], 'real', 'broken']] as never,
          threads: false,
          effect: 'pure' as const,
        },
      ],
      spellings: { broken: { text: 'x', helpers: 1 as never } },
    };
    _withIrProfileTestExtension(broken, () => {
      expect(declined(['Sinc', 'x'])?.code).toBe('compile-error');
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const r = compile(ce.box(['Sinc', 'x']), { to: 'glsl', profile: 'ir' });
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

  test('a chain of 1,000 inlined values (CE-584: Max of 1,000 copies of x under two Ifs) compiles; a tree too deep declines, on both targets', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const x = engine.symbol('x');
    let e = engine.function(
      'Max',
      Array.from({ length: 1_000 }, () => x)
    );
    for (let i = 0; i < 2; i++)
      e = engine.function('If', [
        engine.function('Greater', [x, engine.number(i)]),
        e,
        engine.function('Sin', [e]),
      ]);
    let deep = x as Expression;
    for (let i = 0; i < 20_000; i++) deep = engine.function('Sin', [deep]);
    for (const to of ['glsl', 'javascript'] as const) {
      const r = compile(e, { to, profile: 'ir', fallback: false });
      expect(r.success).toBe(true);
      if (to === 'javascript')
        expect(r.run!({ x: 0.5 } as never)).toBeCloseTo(Math.sin(0.5), 12);
      let d: { code: string; message: string } | undefined;
      try {
        compile(deep, { to, profile: 'ir', fallback: false });
      } catch (x) {
        d = (x as { diagnostic?: { code: string; message: string } })
          .diagnostic;
      }
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(/too deep to compile/);
    }
  });

  test('canCompile() answers for the profile on glsl', () => {
    const options = { to: 'glsl', profile: 'ir' } as const;
    expect(canCompile(ce.box(['Sin', 'x']), options).ok).toBe(true);
    const no = canCompile(ce.box(['Sum', 'D']), options);
    expect(no.ok).toBe(false);
    expect(!no.ok && no.diagnostic.code).toBe('outside-profile');
  });

  test("the removed profile 'numeric-kernel' is an unknown profile", () => {
    expect(() =>
      compile(ce.box(['Sin', 'x']), {
        to: 'glsl',
        profile: 'numeric-kernel' as 'ir',
      })
    ).toThrow(/Invalid compilation option "profile": expected "ir"/);
  });
});

//
// Batch G6: the real functions on GLSL, the hyperbolic and reciprocal rows,
// a valued name read in a function body, `PointX`, a tuple value
//

/** An engine for batch G6: `x`, `y`, `t`, `u` real, `n` integer; `av`
 *  holds 2, `lv` a list, `P0` a point; `Xa(u, t)` reads `av` (Tycho's
 *  shape), `Ls(s)` reads `lv`, `Pt(s)` returns a point. */
function g6Engine(): ComputeEngine {
  const e = new ComputeEngine();
  for (const name of ['x', 'y', 't', 'u']) e.declare(name, 'real');
  e.declare('n', 'integer');
  e.declare('av', 'real');
  e.assign('av', 2);
  e.assign('lv', e.box(['List', 1, 2.5, -4]));
  e.assign('P0', e.box(['Tuple', 2.64, 17]));
  e.assign(
    'Xa',
    e.box(['Function', ['Add', 'u', ['Multiply', 'av', 't']], 'u', 't'])
  );
  e.assign('Ls', e.box(['Function', ['Multiply', 's', ['At', 'lv', 2]], 's']));
  e.declare('Pt', '(real) -> tuple<real, real>');
  e.assign(
    'Pt',
    e.box(['Function', ['Tuple', ['Cos', 's'], ['Sin', 's']], 's'])
  );
  return e;
}
const e6 = g6Engine();
const TYCHO_G6 = { symbolic: ['t', 'x', 'y'] };

// The rows on both targets: three ordinary points each, and for a GLSL
// spelling with a domain one point outside it, where it writes NaN.
// prettier-ignore
const G6_ROWS: [json: Json, points: Point[], outside?: Point][] = [
  [['Arcsin', 'x'], [{ x: 0.5 }, { x: -0.3 }, { x: 0.9 }], { x: 1.5 }],
  [['Arccos', 'x'], [{ x: 0.5 }, { x: -0.3 }, { x: 0.9 }], { x: -2 }],
  [['Arctan2', 'y', 'x'], [{ y: 1, x: 2 }, { y: -1, x: -1 }, { y: 0.5, x: -2 }, { y: 0, x: 0 }]],
  [['Arcosh', 'x'], [{ x: 1.5 }, { x: 3 }, { x: 10 }], { x: 0.5 }],
  // The builtin `asinh` is wrong for a large negative argument (NaN at -5000
  // on a GPU, -88 in the software renderer): the spelling is the odd form.
  [['Arsinh', 'x'], [{ x: 3 }, { x: -3 }, { x: -50 }, { x: -5000 }, { x: 5000 }]],
  [['Artanh', 'x'], [{ x: 0.5 }, { x: -0.3 }, { x: 0.9 }], { x: 2 }],
  [['Log', 'x'], [{ x: 2 }, { x: 100 }, { x: 0.5 }], { x: -1 }],
  [['Log', 'x', 2], [{ x: 8 }, { x: 3 }, { x: 0.25 }], { x: -1 }],
  [['Log', 'x', 'y'], [{ x: 8, y: 3 }, { x: 0.5, y: 10 }, { x: 7, y: 0.5 }]],
  [['Log', 'x', 10], [{ x: 1000 }, { x: 1e6 }, { x: 0.01 }], { x: -1 }],
  [['Log', 'x', 2], [{ x: 1024 }, { x: 2 ** 20 }, { x: 0.125 }]],
  [['Tanh', ['Multiply', 100, 'x']], [{ x: 1 }, { x: -1 }, { x: 0.005 }]],
  [['Coth', ['Multiply', 100, 'x']], [{ x: 1 }, { x: -1 }, { x: 0.005 }]],
  [['Root', 'x', 20], [{ x: 0 }, { x: 1 }, { x: 5 }]],
  [['Ln', 'x'], [{ x: 2 }, { x: 0.1 }, { x: 50 }], { x: -2 }],
  [['Root', 'x', 3], [{ x: -8 }, { x: 27 }, { x: 0.5 }]],
  [['Root', 'x', 'y'], [{ x: -8, y: 3 }, { x: 16, y: 4 }, { x: 2, y: 0.5 }], { x: -8, y: 2 }],
  [['Hypot', 'x', 'y'], [{ x: 3, y: 4 }, { x: -1, y: 2 }, { x: 0.5, y: 0.25 }]],
  [['Sinh', 'x'], [{ x: 0.5 }, { x: -1.25 }, { x: 2 }]],
  [['Cosh', 'x'], [{ x: 0.5 }, { x: -1.25 }, { x: 2 }]],
  [['Tanh', 'x'], [{ x: 0.5 }, { x: -1.25 }, { x: 2 }]],
  [['Sec', 'x'], [{ x: 0.5 }, { x: -1.25 }, { x: 2 }]],
  [['Csc', 'x'], [{ x: 0.5 }, { x: -1.25 }, { x: 2 }]],
  [['Coth', 'x'], [{ x: 0.5 }, { x: -1.25 }, { x: 2 }]],
  [['Sech', 'x'], [{ x: 0.5 }, { x: -1.25 }, { x: 2 }]],
  [['Csch', 'x'], [{ x: 0.5 }, { x: -1.25 }, { x: 2 }]],
  [['Factorial', ['Floor', 'x']], [{ x: 5.5 }, { x: 0 }, { x: 10.2 }]],
  [['GCD', ['Round', 'x'], ['Round', 'y']], [{ x: 12.4, y: 18.2 }, { x: -12, y: 8 }, { x: 0, y: 5 }]],
  [['PointX', ['Tuple', ['Cos', 'x'], ['Sin', 'x']]], [{ x: 0.5 }, { x: -2 }, { x: 3 }]],
  [['PointY', ['Pt', 'x']], [{ x: 0.5 }, { x: -2 }, { x: 3 }]],
  [['PointZ', ['Tuple', 'x', 'y', ['Multiply', 2, 'x']]], [{ x: 0.5, y: 1 }, { x: -2, y: 3 }, { x: 3, y: 0 }]],
  [['Multiply', 't', ['PointY', 'P0']], [{ t: 2 }, { t: -0.5 }, { t: 3 }]],
  [['Xa', 0, 't'], [{ t: 2 }, { t: -0.5 }, { t: 3 }]],
  [['Ls', 'x'], [{ x: 2 }, { x: -0.5 }, { x: 3 }]],
];
// The angular unit in degrees, for the trigonometric rows.
// prettier-ignore
const G6_DEGREES: [json: Json, points: Point[]][] = [
  [['Sec', 'x'], [{ x: 60 }, { x: -30 }, { x: 100 }]],
  [['Csc', 'x'], [{ x: 30 }, { x: -45 }, { x: 100 }]],
  [['Arcsin', 'x'], [{ x: 0.5 }, { x: -0.3 }, { x: 0.9 }]],
  [['Arctan2', 'y', 'x'], [{ y: 1, x: 1 }, { y: -1, x: -1 }, { y: 0.5, x: -2 }]],
];

/** The compilation of `json` in the engine of batch G6, on `to`. */
const g6 = (json: Json, to: 'glsl' | 'javascript', options: object = {}) =>
  compile(e6.box(json as never), {
    to,
    profile: 'ir',
    fallback: false,
    ...TYCHO_G6,
    ...options,
  } as never) as CompilationResult<'javascript'>;

/** `f()` with the angular unit of `e6` in degrees. */
function inDegrees<T>(f: () => T): T {
  e6.angularUnit = 'deg';
  try {
    return f();
  } finally {
    e6.angularUnit = 'rad';
  }
}

/** The diagnostic of a compilation that throws, or `undefined`. */
function thrown(
  f: () => unknown
): { code: string; message: string } | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { code: string; message: string } }).diagnostic;
  }
  return undefined;
}

describe('IR profile, batch G6: the rows on JavaScript', () => {
  const check = (json: Json, points: Point[]) => {
    const r = g6(json, 'javascript');
    for (const p of points) {
      const expected = interpret(e6, e6.box(json as never), p);
      expect([p, agrees(r.run!(p as never), expected)]).toEqual([p, true]);
    }
  };
  test.each(
    G6_ROWS.map(
      ([json, points]) => [JSON.stringify(json), json, points] as const
    )
  )('%s', (_, json, points) => check(json, points));
  test.each(
    G6_DEGREES.map(
      ([json, points]) => [JSON.stringify(json), json, points] as const
    )
  )('%s in degrees', (_, json, points) => inDegrees(() => check(json, points)));
  test('Log of base 2 and 10 is exact at a power of the base', () => {
    // `Ln(x)/Ln(b)` gave 30 for `Ceil(Log(2^29, 2))` and 2 for
    // `Floor(Log(1000, 10))`.
    const cases: [Json, Point[]][] = [
      [['Ceil', ['Log', 'x', 2]], [29, 31, 39, 47, 51].map((k) => ({ x: 2 ** k }))],
      [['Floor', ['Log', 'x', 10]], [{ x: 1000 }, { x: 1e6 }, { x: 1e15 }]],
      [['Equal', ['Log', 'x', 10], 3], [{ x: 1000 }]],
    ];
    for (const [json, points] of cases) check(json, points);
    expect(g6(['Ceil', ['Log', 'x', 2]], 'javascript').run!({ x: 2 ** 29 } as never)).toBe(29);
    expect(g6(['Equal', ['Log', 'x', 10], 3], 'javascript').run!({ x: 1000 } as never)).toBe(true);
  });
  test('the complex lane of the hyperbolic and reciprocal rows', () => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    for (const head of ['Sinh', 'Cosh', 'Tanh', 'Sec', 'Csc', 'Sech', 'Csch']) {
      const expr = engine.box([head, 'z']);
      const r = compile(expr, { profile: 'ir', fallback: false });
      const p = { z: { re: 0.5, im: -0.75 } } as never;
      expect([head, agrees(r.run!(p), interpret(engine, expr, p))]).toEqual([
        head,
        true,
      ]);
    }
  });
});

describe('IR profile, batch G6: GLSL', () => {
  test('each row has a GLSL form', () => {
    for (const [json] of G6_ROWS)
      expect([json, g6(json, 'glsl').success]).toEqual([json, true]);
  });
  test('a domain is written in the spelling; Arctan2 at (0, 0) is 0', () => {
    expect(g6(['Arcsin', 'x'], 'glsl').code).toBe(
      '(abs(x) <= 1.0 ? asin(x) : uintBitsToFloat(0x7fc00000u))'
    );
    expect(g6(['Arctan2', 'y', 'x'], 'glsl').code).toBe(
      '(y == 0.0 && x == 0.0 ? 0.0 : atan(y, x))'
    );
    // An operand read twice is named, not computed twice.
    const r = g6(['Arcsin', ['Sin', ['Multiply', 3, 'x']]], 'glsl');
    expect(r.code.match(/\bsin\(/g)).toHaveLength(1);
  });
  test('declined: the factorial of a real, a coordinate of a list', () => {
    for (const json of [
      ['Factorial', 'x'],
      ['PointX', ['List', 'x', 'y']],
    ])
      expect([json, thrown(() => g6(json, 'glsl'))?.code]).toEqual([
        json,
        'outside-profile',
      ]);
    // Of a literal list of points, the list of the coordinates (batch G22).
    expect(
      g6(['PointX', ['List', ['Tuple', 'x', 'y'], ['Tuple', 'y', 'x']]], 'glsl')
        .code
    ).toBe('vec2(x, y)');
    // On JavaScript, the factorial of a real is the Gamma function.
    expect(
      g6(['Factorial', 'x'], 'javascript').run!({ x: 2.5 } as never)
    ).toBeCloseTo(3.3233509704478426, 12);
  });
});

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G6: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    const items = (
      json: Json,
      points: Point[],
      expected: (p: Point) => number
    ) => {
      const r = g6(json, 'glsl') as unknown as ReturnType<typeof glsl>;
      const source = shader(r, 'float');
      return points.map((p) => ({
        name: `${JSON.stringify(json)} at ${JSON.stringify(p)}`,
        source,
        uniforms: Object.fromEntries(
          r.freeSymbols!.map((n) => [`u_${n}`, Number(p[n])])
        ),
        expected: expected(p),
      }));
    };
    const number = (json: Json) => (p: Point) => {
      const v = interpret(e6, e6.box(json as never), p);
      return typeof v === 'number' ? v : NaN;
    };

    test('each row against the interpreter, and NaN outside its domain', async () => {
      const all = [
        ...G6_ROWS.flatMap(([json, points, outside]) => [
          ...items(json, points, number(json)),
          ...(outside === undefined ? [] : items(json, [outside], () => NaN)),
        ]),
        ...inDegrees(() =>
          G6_DEGREES.flatMap(([json, points]) =>
            items(json, points, number(json))
          )
        ),
      ];
      const values = await driver.evaluate(all);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = all[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (Number.isNaN(expected)) {
          if (!Number.isNaN(v.value))
            failures.push(`${name}: ${v.value} vs NaN`);
          return;
        }
        // The trigonometric builtins of a software renderer are
        // approximate (as in the tests above); 1e-4 elsewhere, since its
        // `acos` and reciprocal trigonometric functions are off by up to
        // 8e-5 relative.
        const tolerance = /\b(sin|cos|tan)\(/.test(all[k].source) ? 1e-3 : 1e-4;
        if (
          !(
            Math.abs(v.value - expected) <=
            tolerance * Math.max(1, Math.abs(expected))
          )
        )
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(all.length).toBeGreaterThanOrEqual(90);
    }, 120_000);
  }
);

describe('IR profile, batch G6: a valued name read in a function body', () => {
  test("Tycho's shape: X(0, t) whose body reads a document value av, on both targets", () => {
    for (const to of ['glsl', 'javascript'] as const) {
      const symbolDeps = new Set<string>();
      const r = g6(['Xa', 0, 't'], to, { symbolDeps });
      expect(r.freeSymbols).toEqual(['t']);
      expect([...symbolDeps].sort()).toEqual(['Xa', 'av']);
      if (to === 'javascript') expect(r.run!({ t: 3 } as never)).toBe(6);
    }
    // A list value.
    expect(g6(['Ls', 'x'], 'javascript').run!({ x: 2 } as never)).toBe(5);
  });

  test('the README witness: a value that is an expression of another name reads the binding of the value', () => {
    const e = g6Engine();
    e.assign('a2', 2);
    e.assign('v2', e.box(['Add', 'a2', 1]));
    e.assign('fv', e.box(['Function', ['Multiply', 's', 'v2'], 's']));
    e.pushScope();
    e.declare('a2', 'real');
    e.assign('a2', 10);
    for (const json of [
      ['fv', 'x'],
      ['Multiply', 'x', 'v2'],
    ]) {
      const expr = e.box(json as never);
      expect(interpret(e, expr, { x: 1 })).toBe(3);
      // `compile()` runs in the scope that the names of the expression are
      // read from (`compilationScope()`), where `a2` is 2, as in the value
      // of `v2` (`compileSlice()` declines: ir-slice-complex.test.ts).
      for (const to of ['glsl', 'javascript'] as const) {
        const r = compile(expr, { to, profile: 'ir', fallback: false });
        expect(r.success).toBe(true);
        if (to === 'javascript') expect(r.run!({ x: 1 } as never)).toBe(3);
      }
    }
    e.popScope();
  });

  test('a function defined outside a pushed scope that declares the name again reads its own binding', () => {
    const e = g6Engine();
    e.pushScope();
    e.declare('av', 'real');
    e.assign('av', 100);
    const expr = e.box(['Xa', 0, 't']);
    expect(interpret(e, expr, { t: 3 })).toBe(6);
    // `compile()` runs in the scope of the body's binding
    // (`compilationScope()`).
    const js = compile(expr, { profile: 'ir', fallback: false });
    expect(js.run!({ t: 3 } as never)).toBe(6);
    const gl = compile(expr, { to: 'glsl', profile: 'ir', fallback: false });
    expect(`${gl.code}\n${gl.preamble}`).not.toMatch(/100/);
    // The direct compilation reads the name where it runs: it declines.
    let cause = '';
    try {
      compileSlice(expr, { target: 'javascript' });
    } catch (x) {
      cause = (x as Error).message;
    }
    expect(cause).toMatch(/reads av, which is not a parameter/);
    e.popScope();
  });

  test('a value changed after the compilation: the code keeps the old one', () => {
    const e = g6Engine();
    const r = compile(e.box(['Xa', 0, 't']), {
      profile: 'ir',
      fallback: false,
    });
    e.assign('av', 5);
    expect(r.run!({ t: 3 } as never)).toBe(6);
  });

  test('a name of symbolic keeps its treatment: an input that each call passes', () => {
    const r = g6(['Xa', 0, 't'], 'javascript', { symbolic: ['t', 'av'] });
    expect([...r.freeSymbols!].sort()).toEqual(['av', 't']);
    expect(r.run!({ t: 3, av: 4 } as never)).toBe(12);
  });
});

describe('IR profile, batch G6: robustness', () => {
  test('a shared graph of depth 20 through Sinh compiles in bounded text, on both targets', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    let e = engine.symbol('x') as Expression;
    for (let i = 0; i < 20; i++)
      e = engine.function('Add', [e, engine.function('Sinh', [e])]);
    for (const to of ['glsl', 'javascript'] as const) {
      const start = performance.now();
      const r = compile(e, { to, profile: 'ir', fallback: false });
      expect(r.success).toBe(true);
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(20_000);
      expect(performance.now() - start).toBeLessThan(10_000);
    }
  });

  test('Add of 1,000 Arctan2(x, k) compiles or declines with outside-profile', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const e = engine.function(
      'Add',
      Array.from({ length: 1_000 }, (_, k) =>
        engine.function('Arctan2', [engine.symbol('x'), engine.number(k + 1)])
      )
    );
    for (const to of ['glsl', 'javascript'] as const) {
      const d = thrown(() => {
        const r = compile(e, { to, profile: 'ir', fallback: false });
        if (to === 'javascript') {
          let sum = 0;
          for (let k = 1; k <= 1000; k++) sum += Math.atan2(0.5, k);
          expect(r.run!({ x: 0.5 } as never)).toBeCloseTo(sum, 9);
        }
      });
      expect([to, d?.code ?? 'compiled']).not.toEqual([to, 'compile-error']);
      expect(['compiled', 'outside-profile']).toContain(d?.code ?? 'compiled');
    }
  });

  test('a function that reads a valued name, called in a nested loop within the pass bound', () => {
    const json = [
      'Sum',
      ['Sum', ['Xa', 'j', 'k'], ['Limits', 'k', 1, 10]],
      ['Limits', 'j', 1, 10],
    ];
    expect(interpret(e6, e6.box(json as never), {})).toBe(1650);
    expect(g6(json, 'javascript').run!({} as never)).toBe(1650);
    expect(g6(json, 'glsl').success).toBe(true);
  });
});
