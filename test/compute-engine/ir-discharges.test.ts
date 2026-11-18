/**
 * The discharges `IsMissing`, `Coalesce` and `AssertPresent` in compiled
 * code (`docs/COMPILATION-MODEL.md`, "Everything computed from an absent
 * value, except at a discharge"; README of
 * `src/compute-engine/compilation/ir/`, "The discharges").
 *
 * The test is chosen from the static type of the operand, as the producers
 * spell an absent value: NaN for a number, a point whose coordinates are
 * all NaN, `undefined` for a boolean on JavaScript. A discharge gives the
 * interpreter's value for an absent operand of each spelling; `AssertPresent`
 * of an absent value throws on JavaScript, where the interpreter gives the
 * error `expected-present`.
 *
 * - JavaScript: each value against the interpreter's.
 * - GLSL: the numeric forms, run in WebGL2 with the headless Chromium of
 *   `scripts/glsl-check/glsl-driver.ts` (skipped without the browser);
 *   `AssertPresent` of a value that can be absent declines.
 * - interval-js: declines (the operation `isnan` has no spelling there).
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isCollection,
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Inputs = Record<string, unknown>;

const ce = new ComputeEngine();
ce.declare('L', 'list<real>');
ce.declare('K', 'list<integer>');
ce.declare('P', 'list<tuple<real, real>>');
ce.declare('B', 'list<boolean>');
ce.declare('i', 'integer');
ce.declare('x', 'real');
ce.declare('z', 'complex');
ce.declare('n', 'number');
ce.declare('p', 'tuple<real, real>');
ce.declare('L3', 'list<real^3>');
// `w` holds the written absent value.
ce.declare('w', 'real');
ce.assign('w', ce.symbol('Missing'));

/** The value of an expression of the interpreter as the compiled code
 *  gives it: a number, a boolean, a list of numbers, `'Missing'`, or
 *  `'error'`. */
function read(v: Expression): unknown {
  if (isNumber(v)) return v.re;
  if (isSymbol(v, 'True')) return true;
  if (isSymbol(v, 'False')) return false;
  if (isSymbol(v, 'Missing')) return 'Missing';
  if (isFunction(v, 'Error')) return 'error';
  if (isFunction(v, 'Tuple')) return v.ops.map(read);
  if (isCollection(v)) return [...v.each()].map(read);
  return v.toString();
}

function interpret(json: Json, inputs: Inputs): unknown {
  const box = (v: unknown): Expression =>
    Array.isArray(v)
      ? ce.box([
          'List',
          ...v.map((t) => (Array.isArray(t) ? ['Tuple', ...t] : t)),
        ] as never)
      : typeof v === 'boolean'
        ? ce.symbol(v ? 'True' : 'False')
        : ce.number(v as number);
  let e = ce.box(json as never);
  for (const [k, v] of Object.entries(inputs)) e = e.subs({ [k]: box(v) });
  return read(e.evaluate());
}

const js = (json: Json) =>
  compile(ce.box(json as never), { to: 'javascript', fallback: false });

/** Run on JavaScript: the value, or `'throw'`. */
function run(json: Json, inputs: Inputs): unknown {
  const r = js(json);
  expect(r.success).toBe(true);
  try {
    return r.run!(inputs as never);
  } catch (error) {
    expect(String(error)).toMatch(/expected-present/);
    return 'throw';
  }
}

// prettier-ignore
const CASES: [label: string, json: Json, inputs: Inputs, expected: unknown][] = [
  ['a real read out of range', ['IsMissing', ['At', 'L', 'i']], { L: [1, 2, 3], i: 5 }, true],
  ['a real read in range', ['IsMissing', ['At', 'L', 'i']], { L: [1, 2, 3], i: 2 }, false],
  ['an integer read out of range', ['IsMissing', ['At', 'K', 'i']], { K: [1, 2], i: 0 }, true],
  ['a point read out of range', ['IsMissing', ['At', 'P', 'i']], { P: [[1, 2]], i: 4 }, true],
  ['a point read in range', ['IsMissing', ['At', 'P', 'i']], { P: [[1, 2]], i: 1 }, false],
  ['a boolean read out of range', ['IsMissing', ['At', 'B', 'i']], { B: [true], i: 4 }, true],
  ['a boolean read in range', ['IsMissing', ['At', 'B', 'i']], { B: [false], i: 1 }, false],
  ['the written Missing', ['IsMissing', 'Missing'], {}, true],
  ['a real input', ['IsMissing', 'x'], { x: 2 }, false],
  ['a real input at NaN', ['IsMissing', 'x'], { x: NaN }, true],
  ['a complex input', ['IsMissing', 'z'], { z: 1 }, false],
  ['a point input', ['IsMissing', 'p'], { p: [1, 2] }, false],
  ['a list input', ['IsMissing', 'L'], { L: [1] }, false],
  ['an If with no arm taken', ['If', ['IsMissing', ['If', ['Greater', 'x', 0], 3]], 1, 0], { x: -1 }, 1],
  ['a name that holds Missing', ['If', ['IsMissing', 'w'], 1, 0], {}, 1],
  ['Coalesce of a real read out of range', ['Coalesce', ['At', 'L', 'i'], 0], { L: [1, 2, 3], i: 5 }, 0],
  ['Coalesce of a real read in range', ['Coalesce', ['At', 'L', 'i'], 0], { L: [1, 2, 3], i: -1 }, 3],
  ['Coalesce of three operands', ['Coalesce', ['At', 'L', 'i'], ['At', 'L', 7], 9], { L: [1, 2, 3], i: 5 }, 9],
  ['Coalesce of the written Missing', ['Coalesce', 'Missing', 3], {}, 3],
  ['Coalesce of a name that holds Missing', ['Coalesce', 'w', 5], {}, 5],
  ['Coalesce of a Which with no arm', ['Coalesce', ['Which', ['Greater', 'x', 0], 3], 7], { x: -1 }, 7],
  ['Coalesce of a boolean', ['Coalesce', ['At', 'B', 'i'], 'True'], { B: [false], i: 4 }, true],
  ['Coalesce of a point', ['Coalesce', ['At', 'P', 'i'], ['Tuple', 0, 0]], { P: [[1, 2]], i: 4 }, [0, 0]],
  ['Coalesce of a point in range', ['Coalesce', ['At', 'P', 'i'], ['Tuple', 0, 0]], { P: [[1, 2]], i: 1 }, [1, 2]],
  ['Coalesce in Map', ['Map', ['Function', ['Coalesce', ['At', 'L', 'k'], 0], 'k'], ['List', 1, 5, 2]], { L: [10, 20] }, [10, 0, 20]],
  ['Coalesce of a fallback with an effect, not taken', ['Coalesce', ['At', 'L', 'i'], ['Random']], { L: [1, 2, 3], i: 1 }, 1],
  ['AssertPresent of a real in range', ['AssertPresent', ['At', 'L', 'i']], { L: [1, 2, 3], i: 1 }, 1],
  ['AssertPresent of a point in range', ['AssertPresent', ['At', 'P', 'i']], { P: [[1, 2]], i: 1 }, [1, 2]],
  ['AssertPresent of a list', ['AssertPresent', 'L'], { L: [1] }, [1]],
];

// prettier-ignore
const THROWS: [label: string, json: Json, inputs: Inputs][] = [
  ['a real read out of range', ['AssertPresent', ['At', 'L', 'i']], { L: [1, 2, 3], i: 5 }],
  ['a point read out of range', ['AssertPresent', ['At', 'P', 'i']], { P: [[1, 2]], i: 3 }],
  ['a boolean read out of range', ['AssertPresent', ['At', 'B', 'i']], { B: [true], i: 3 }],
];

describe('the discharges on JavaScript', () => {
  test.each(CASES)('%s', (_, json, inputs, expected) => {
    expect(interpret(json, inputs)).toEqual(expected);
    expect(run(json, inputs)).toEqual(expected);
  });

  test.each(THROWS)(
    'AssertPresent of %s throws where the interpreter fails',
    (_, json, inputs) => {
      expect(interpret(json, inputs)).toBe('error');
      expect(run(json, inputs)).toBe('throw');
    }
  );

  test('the test is the static type: NaN for a number, undefined for a boolean', () => {
    expect(js(['IsMissing', ['At', 'L', 'i']]).code).toMatch(/Number\.isNaN/);
    expect(js(['IsMissing', ['At', 'B', 'i']]).code).toMatch(/=== undefined/);
  });

  test('the fallback is evaluated only when it is taken', () => {
    expect(
      js(['Coalesce', ['At', 'L', 'i'], ['Multiply', 2, 'x']]).code
    ).toMatch(/if \(Number\.isNaN\(\w+\)\) \{\s+\w+ = \(2 \* _\.x\);/);
  });

  test('operands of two shapes decline', () => {
    const r = compile(ce.box(['Coalesce', ['At', 'P', 'i'], 0] as never), {
      to: 'javascript',
    });
    expect(r.success).toBe(false);
    expect(
      interpret(['Coalesce', ['At', 'P', 'i'], 0], { P: [[1, 2]], i: 4 })
    ).toBe(0);
  });
});

// A NaN on the real lane is also a complex value of the interpreter
// (`Sqrt(x)` at `x = -4` is `2i`), which is not absent: the discharge of a
// computed value whose type admits a complex value declines, on JavaScript
// and GLSL. An input is real by its type, and `mode: 'complex'` compiles the
// value on the complex lane.
describe('a value that can be complex on the real lane', () => {
  // prettier-ignore
  const DECLINES: Json[] = [
    ['IsMissing', ['Sqrt', 'x']],
    ['Coalesce', ['Sqrt', 'x'], 0],
    ['AssertPresent', ['Sqrt', 'x']],
    ['IsMissing', ['Arcsin', 'x']],
    ['IsMissing', ['Power', 'x', 0.5]],
  ];
  test.each(['javascript', 'glsl'] as const)('declines on %s', (to) => {
    for (const json of DECLINES) {
      const r = compile(ce.box(json as never), { to });
      expect([JSON.stringify(json), r.success]).toEqual([
        JSON.stringify(json),
        false,
      ]);
    }
  });

  test('the interpreter value', () => {
    expect(interpret(['IsMissing', ['Sqrt', 'x']], { x: -4 })).toBe(false);
    const v = ce
      .box(['Coalesce', ['Sqrt', 'x'], 0])
      .subs({ x: -4 })
      .evaluate();
    expect([v.re, v.im]).toEqual([0, 2]);
  });

  test('a real value, an input of type number, the complex mode', () => {
    expect(run(['IsMissing', ['Sqrt', ['Abs', 'x']]], { x: -4 })).toBe(false);
    expect(run(['IsMissing', ['Divide', 1, 'x']], { x: 0 })).toBe(false);
    expect(run(['IsMissing', 'n'], { n: 2 })).toBe(false);
    const r = compile(ce.box(['Coalesce', ['Sqrt', 'x'], 0] as never), {
      to: 'javascript',
      mode: 'complex',
      fallback: false,
    });
    expect(r.run!({ x: -4 } as never)).toEqual({ re: 0, im: 2 });
  });
});

describe('the written Missing as a coordinate of a tuple declines', () => {
  test.each(['javascript', 'glsl'] as const)('%s', (to) => {
    const json = ['IsMissing', ['Tuple', 'Missing', 'Missing']];
    expect(compile(ce.box(json as never), { to }).success).toBe(false);
    expect(interpret(json, {})).toBe(false);
  });
});

describe('the discharges in the bigint mode decline', () => {
  test.each([
    ['IsMissing', ['IsMissing', ['At', 'K', 'i']]],
    ['Coalesce', ['Coalesce', ['At', 'K', 'i'], 0]],
    ['AssertPresent', ['AssertPresent', ['At', 'K', 'i']]],
  ])('%s', (_, json) => {
    const r = compile(ce.box(json as never), {
      to: 'javascript',
      mode: 'bigint',
    });
    expect(r.success).toBe(false);
  });
});

describe('the discharges on interval-js decline', () => {
  test.each([
    ['IsMissing', ['IsMissing', 'x']],
    ['Coalesce', ['Coalesce', 'Missing', 3]],
  ])('%s', (_, json) => {
    const r = compile(ce.box(json as never), { to: 'interval-js' });
    expect(r.success).toBe(false);
  });
});

//
// GLSL
//

const glsl = (json: Json) =>
  compile(ce.box(json as never), { to: 'glsl', fallback: false });

describe('the discharges on GLSL', () => {
  test('the NaN test of a number', () => {
    expect(glsl(['IsMissing', ['At', 'L3', 'i']]).code).toMatch(/isnan\(/);
  });

  test('AssertPresent of a value that can be absent declines', () => {
    const r = compile(ce.box(['AssertPresent', 'x'] as never), { to: 'glsl' });
    expect(r.success).toBe(false);
  });

  test('no compiled list is absent', () => {
    expect(glsl(['IsMissing', 'L3']).code).toBe('false');
    expect(glsl(['AssertPresent', 'L3']).success).toBe(true);
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

/** The fragment shader of a host: each input a uniform per coordinate, the
 *  code in a function of the inputs. */
function shader(r: ReturnType<typeof glsl>, result: 'float' | 'bool'): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered!;
  const size = (n: string) => Number(/^vec(\d)$/.exec(type(n))?.[1] ?? 1);
  const value = (n: string) =>
    size(n) === 1
      ? `u_${n}_0`
      : `${type(n)}(${Array.from({ length: size(n) }, (_, k) => `u_${n}_${k}`).join(', ')})`;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.flatMap((n) =>
      Array.from({ length: size(n) }, (_, j) => `uniform float u_${n}_${j};`)
    ),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `${result} userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(float(userFn(${inputs.map(value).join(', ')})), 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

// prettier-ignore
const GLSL_CASES: [json: Json, inputs: Inputs][] = [
  [['IsMissing', ['At', 'L3', 'i']], { L3: [1, 2, 3], i: 5 }],
  [['IsMissing', ['At', 'L3', 'i']], { L3: [1, 2, 3], i: -1 }],
  [['IsMissing', 'Missing'], {}],
  [['IsMissing', 'x'], { x: 0.5 }],
  [['Coalesce', ['At', 'L3', 'i'], ['Multiply', 2, 'x']], { L3: [1, 2, 3], i: 5, x: 4 }],
  [['Coalesce', ['At', 'L3', 'i'], ['Multiply', 2, 'x']], { L3: [1, 2, 3], i: 2, x: 4 }],
  [['Coalesce', ['At', 'L3', 'i'], ['At', 'L3', ['Add', 'i', 1]], -1], { L3: [1, 2, 3], i: 3 }],
  [['Coalesce', ['At', 'L3', 'i'], ['At', 'L3', ['Add', 'i', 1]], -1], { L3: [1, 2, 3], i: 4 }],
  [['Coalesce', ['Which', ['Greater', 'x', 0], 3], 7], { x: -1 }],
  [['If', ['IsMissing', ['If', ['Greater', 'x', 0], 3]], 1, 0], { x: -1 }],
  [['Coalesce', 'Missing', 3], {}],
];

(chromiumAvailable() ? describe : describe.skip)(
  'the discharges on GLSL in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('each value is the interpreter value', async () => {
      const items = GLSL_CASES.map(([json, inputs]) => {
        const r = glsl(json);
        expect(r.success).toBe(true);
        const expected = interpret(json, inputs);
        const uniforms = Object.fromEntries(
          r.freeSymbols!.flatMap((n) =>
            [inputs[n]].flat().map((x, j) => [`u_${n}_${j}`, x])
          )
        );
        return {
          name: `${JSON.stringify(json)} at ${JSON.stringify(inputs)}`,
          source: shader(r, typeof expected === 'boolean' ? 'bool' : 'float'),
          uniforms,
          expected,
        };
      });
      const values = await driver.evaluate(items as never);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        const e = typeof expected === 'boolean' ? Number(expected) : expected;
        if (v.value !== e) failures.push(`${name}: ${v.value} vs ${e}`);
      });
      expect(failures).toEqual([]);
    }, 120_000);
  }
);
