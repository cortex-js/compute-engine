/**
 * The profile `ir` of `compile()` on the `glsl` target (batch G1,
 * `src/compute-engine/compilation/ir/adapter-glsl.ts`): a scalar result of
 * scalar inputs.
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

const ce = makeEngine();
// A user function that reads an input of the compilation.
ce.assign('rx', ce.box(['Function', ['Add', 'a', 'y'], 'a']));
ce.declare('v8', 'real');
ce.declare('float', 'real');
ce.declare('sin', 'real');
for (const word of ['active', 'common', 'sampler1D']) ce.declare(word, 'real');

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
    ['a list result', ['List', 'x', 1], {}, /a list or tuple result/],
    ['a tuple result', ['Tuple', 'x', 'y'], {}, /a list or tuple result|Tuple/],
    ['a list input', ['Sum', 'L'], {}, /the list input `L`/],
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
    ['vars', ['Add', 'x', 1], { vars: { x: 'u_x' } }, /`vars`/],
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
      });
      expect(r.success).toBe(true);
      expect(r.profile).toBeUndefined();
      expect(r.code).toMatch(/u_x/);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/profile: ir.*`vars`/)
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
    const no = canCompile(ce.box(['List', 'x', 1]), options);
    expect(no.ok).toBe(false);
    expect(!no.ok && no.diagnostic.code).toBe('outside-profile');
  });

  test("the profile 'numeric-kernel' on glsl is still an error of the options", () => {
    expect(() =>
      compile(ce.box(['Sin', 'x']), { to: 'glsl', profile: 'numeric-kernel' })
    ).toThrow(/defined for the target "javascript" only/);
  });
});
