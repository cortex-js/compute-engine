/**
 * The `callerLocals` option of the GLSL target (decision M7 of
 * `docs/plans/2026-11-12-macro-kind-spec.md`, section 5c).
 *
 * A host wraps the compiled code in a function of its own
 * (`float userFn(float x, float y) { … }`), so `x` and `y` are locals of
 * that function. An emitted shader function (`_fn_g`) is declared at file
 * scope and cannot see them: with the option, a shader function that reads
 * one takes it as a trailing parameter, and each call passes it.
 *
 * Values are checked by running the emitted text with the f32 interpreter
 * of `gpu-shader-f32-eval.ts`, against the interpreter of the engine, where
 * the text has no loop (the f32 interpreter has none).
 */

import '../utils'; // For snapshot serializers
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  canCompile,
  compile,
} from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { shaderFunctions, type Value } from './gpu-shader-f32-eval';

/** An engine with the inputs and the functions of these tests. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('n', 'integer');
  ce.declare('p', 'tuple<real, real>');
  ce.declare('z', 'complex');
  ce.assign('g', ce.parse('u \\mapsto u + x'));
  // A parameter spelled like the caller local `x`.
  ce.assign('h', ce.parse('x \\mapsto g(x) \\cdot y'));
  // A read through a second function.
  ce.assign('k', ce.parse('u \\mapsto 2 g(u)'));
  ce.assign('m', ce.parse('u \\mapsto u y + x'));
  ce.assign('pg', ce.box(['Function', ['Add', 'u', ['At', 'p', 1]], 'u']));
  ce.assign('zg', ce.box(['Function', ['Add', 'z', 'u'], 'u']));
  // A stored value that reads a caller local, read in a function body.
  ce.assign('a', ce.box(['Add', 'x', 1]));
  ce.assign('ga', ce.box(['Function', ['Add', 'a', 'u'], 'u']));
  return ce;
}

type Result = { success: boolean; code: string; preamble?: string };

function glsl(
  ce: ComputeEngine,
  src: string | Expression,
  options: Record<string, unknown> = {}
): Result {
  const expr = typeof src === 'string' ? ce.parse(src) : src;
  return compile(expr, {
    to: 'glsl',
    fallback: false,
    ...options,
  } as never) as unknown as Result;
}

/** The text of the definition of `name` in `preamble`. */
function definition(preamble: string | undefined, name: string): string {
  const at = (preamble ?? '').indexOf(` ${name}(`);
  expect(at).toBeGreaterThan(0);
  const start = preamble!.lastIndexOf('\n', at) + 1;
  return preamble!.slice(start, preamble!.indexOf('\n}', at) + 2);
}

/** Run the code of `r` as the body of `float _main(<params>)`. */
function run(r: Result, params: string, ...args: Value[]): number {
  const body = /\breturn\b/.test(r.code) ? r.code : `return ${r.code};`;
  const main = `float _main(${params}) {\n${body}\n}`;
  const f = shaderFunctions(`${r.preamble ?? ''}\n${main}`, 'glsl');
  return f('_main', ...args) as number;
}

/** The value of `latex` in the interpreter, with `x` and `y` given. */
function interpreted(latex: string, x: number, y: number): number {
  const ce = engine();
  ce.assign('x', x);
  ce.assign('y', y);
  return ce.parse(latex).evaluate().re;
}

const XY = ['x', 'y'];

describe('GLSL callerLocals: a shader function takes the caller locals it reads', () => {
  test('a direct read', () => {
    const r = glsl(engine(), 'g(1)', { callerLocals: XY });
    expect(definition(r.preamble, '_fn_g')).toMatchInlineSnapshot(`
      float _fn_g(float u, float _in_x) {
        return u + _in_x;
      }
    `);
    expect(r.code).toBe('_fn_g(1.0, x)');
    expect(run(r, 'float x, float y', 10, 3)).toBe(interpreted('g(1)', 10, 3));
  });

  test('a read through a second function', () => {
    const r = glsl(engine(), 'k(2)', { callerLocals: XY });
    expect(definition(r.preamble, '_fn_k')).toMatchInlineSnapshot(`
      float _fn_k(float u, float _in_x) {
        return 2.0 * _fn_g(u, _in_x);
      }
    `);
    expect(r.code).toBe('_fn_k(2.0, x)');
    expect(run(r, 'float x, float y', 10, 3)).toBe(interpreted('k(2)', 10, 3));
  });

  test('a parameter spelled like the caller local still receives the input', () => {
    const r = glsl(engine(), 'h(3)', { callerLocals: XY });
    expect(definition(r.preamble, '_fn_h')).toMatchInlineSnapshot(`
      float _fn_h(float x, float _in_x, float _in_y) {
        return _in_y * _fn_g(x, _in_x);
      }
    `);
    expect(r.code).toBe('_fn_h(3.0, x, y)');
    // g reads the input x (10), not the parameter of h (3): (3 + 10) · 3.
    expect(run(r, 'float x, float y', 10, 3)).toBe(39);
    expect(interpreted('h(3)', 10, 3)).toBe(39);
  });

  test('two caller locals are parameters in the sorted order of the names', () => {
    const r = glsl(engine(), 'm(2)', { callerLocals: ['y', 'x'] });
    expect(definition(r.preamble, '_fn_m')).toMatchInlineSnapshot(`
      float _fn_m(float u, float _in_x, float _in_y) {
        return u * _in_y + _in_x;
      }
    `);
    expect(r.code).toBe('_fn_m(2.0, x, y)');
    expect(run(r, 'float x, float y', 10, 3)).toBe(interpreted('m(2)', 10, 3));
  });

  test('a name that is not in the option is read by its name', () => {
    const r = glsl(engine(), 'm(2)', { callerLocals: ['x'] });
    expect(definition(r.preamble, '_fn_m')).toMatchInlineSnapshot(`
      float _fn_m(float u, float _in_x) {
        return u * y + _in_x;
      }
    `);
    expect(r.code).toBe('_fn_m(2.0, x)');
  });

  test('without the option, or with an empty one, the text is unchanged', () => {
    const ce = engine();
    const before = glsl(ce, 'g(1) + h(y)');
    expect(definition(before.preamble, '_fn_g')).toMatchInlineSnapshot(`
      float _fn_g(float u) {
        return u + x;
      }
    `);
    expect(before.code).toBe('_fn_h(y) + _fn_g(1.0)');
    const empty = glsl(ce, 'g(1) + h(y)', { callerLocals: [] });
    expect(empty).toEqual(before);
    // A name the compiled code does not reach changes nothing either.
    expect(glsl(ce, 'g(1) + h(y)', { callerLocals: ['w'] })).toEqual(before);
  });

  test('a call in the code passes the `vars` source of the name', () => {
    const r = glsl(engine(), 'g(1)', {
      callerLocals: XY,
      vars: { x: 'q.x' },
    });
    expect(definition(r.preamble, '_fn_g')).toContain('float _in_x');
    expect(r.code).toBe('_fn_g(1.0, q.x)');
  });

  test('a `vars` source that is caller code declines', () => {
    expect(() =>
      glsl(engine(), 'g(1)', { callerLocals: XY, vars: { x: 'next()' } })
    ).toThrow(/caller local "x".*not a read of a variable/);
  });

  test('under an unrolled Sum whose index has the name of the caller local', () => {
    const latex = '\\sum_{x=1}^{3} (x + g(x))';
    const r = glsl(engine(), latex, { callerLocals: XY });
    expect(r.code).toMatchInlineSnapshot(`
      float _tv1 = x;
      return ((1.0 + _fn_g(1.0, _tv1)) + (2.0 + _fn_g(2.0, _tv1)) + (3.0 + _fn_g(3.0, _tv1)));
    `);
    // The x of g is the input (10), not the index.
    expect(run(r, 'float x, float y', 10, 3)).toBe(42);
    expect(interpreted(latex, 10, 3)).toBe(42);
  });

  test('under a loop-form Sum whose index has the name of the caller local', () => {
    const latex = '\\sum_{x=1}^{300} (x + g(x))';
    const r = glsl(engine(), latex, { callerLocals: XY });
    // The loop declares `int x`: the input is held in a temporary declared
    // before the loop.
    expect(r.code).toMatchInlineSnapshot(`
      _gpu_passes = 0;
      float _tv2 = x;
      float _tv1 = 0.0;
      for (int x = 1; x <= 300; x++) {
        if (++_gpu_passes > 10000) break;
        _tv1 += float(x) + _fn_g(float(x), _tv2);
      }
      float _tv3 = _tv1;
      return _gpu_passes > 10000 ? _gpu_nan() : _tv3;
    `);
    // The value the text computes: x + (x + X) summed, with the input X.
    expect(interpreted(latex, 10, 3)).toBe(2 * 45150 + 300 * 10);
  });

  test('under a loop-form Sum with a symbolic bound', () => {
    const r = glsl(engine(), '\\sum_{x=1}^{n} g(x)', { callerLocals: XY });
    const alias = /^float (_tv\d+) = x;$/m.exec(r.code)?.[1];
    expect(alias).toBeDefined();
    expect(r.code.indexOf(`float ${alias} = x;`)).toBeLessThan(
      r.code.indexOf('for (int x')
    );
    expect(r.code).toContain(`_fn_g(float(x), ${alias})`);
  });

  test('a call under a binder inside a function body passes its parameter', () => {
    const ce = engine();
    ce.assign('s', ce.parse('u \\mapsto \\sum_{x=1}^{300} u g(x)'));
    const r = glsl(ce, 's(y)', { callerLocals: XY });
    const s = definition(r.preamble, '_fn_s');
    expect(s).toContain('float _fn_s(float u, float _in_x)');
    expect(s).toContain('for (int x');
    expect(s).toContain('_fn_g(float(x), _in_x)');
    expect(r.code).toContain('_fn_s(y, x)');
  });

  test('the element-wise wrapper takes and passes the caller locals', () => {
    const r = glsl(engine(), 'g([1, 2, 3])', { callerLocals: XY });
    expect(definition(r.preamble, '_fn_g_each3_1')).toMatchInlineSnapshot(`
      vec3 _fn_g_each3_1(vec3 a0, float _in_x) {
        return vec3(_fn_g(a0.x, _in_x), _fn_g(a0.y, _in_x), _fn_g(a0.z, _in_x));
      }
    `);
    expect(r.code).toBe('_fn_g_each3_1(vec3(1.0, 2.0, 3.0), x)');
  });

  test('a function called from two places has one definition', () => {
    const r = glsl(engine(), 'g(1) \\cdot g(y)', { callerLocals: XY });
    expect(r.preamble!.split('float _fn_g(').length - 1).toBe(1);
    expect(r.code).toContain('_fn_g(1.0, x)');
    expect(r.code).toContain('_fn_g(y, x)');
  });

  test('the same function compiled from two expressions has the same text', () => {
    const ce = engine();
    const one = glsl(ce, 'g(1)', { callerLocals: XY });
    const two = glsl(ce, '\\sum_{x=1}^{300} h(x) + k(y)', {
      callerLocals: XY,
    });
    expect(definition(two.preamble, '_fn_g')).toBe(
      definition(one.preamble, '_fn_g')
    );
  });

  test('a point and a complex caller local', () => {
    const ce = engine();
    const r = glsl(ce, ce.box(['pg', 2]), { callerLocals: ['p', 'x'] });
    expect(definition(r.preamble, '_fn_pg')).toMatchInlineSnapshot(`
      float _fn_pg(float u, vec2 _in_p) {
        return u + _in_p.x;
      }
    `);
    expect(r.code).toBe('_fn_pg(2.0, p)');
    expect(run(r, 'vec2 p', { x: 4, y: 5 })).toBe(6);

    const c = glsl(ce, ce.box(['zg', 'y']), { callerLocals: ['z'] });
    expect(definition(c.preamble, '_fn_zg')).toMatchInlineSnapshot(`
      vec2 _fn_zg(float u, vec2 _in_z) {
        return vec2(u, 0.0) + _in_z;
      }
    `);
    expect(c.code).toBe('_fn_zg(y, z)');
  });

  test('a boolean caller local', () => {
    const ce = engine();
    ce.declare('b', 'boolean');
    ce.assign('gb', ce.box(['Function', ['If', 'b', 'u', 0], 'u']));
    const r = glsl(ce, ce.box(['gb', 'y']), { callerLocals: ['b'] });
    expect(definition(r.preamble, '_fn_gb')).toContain(
      'float _fn_gb(float u, bool _in_b)'
    );
    expect(r.code).toBe('_fn_gb(y, b)');
  });

  test('a caller local with no shader value type declines', () => {
    const ce = engine();
    ce.declare('H', 'list<number^1600>');
    expect(
      executeEpsil(
        ce,
        'function gh(H: list<integer>, u: real) -> real { H[1600] * u + y }'
      ).diagnostics
    ).toEqual([]);
    // `y` is passed to the variant that reads the input `H` itself.
    const r = glsl(ce, ce.box(['gh', 'H', 'x']), {
      callerLocals: XY,
      storage: { H: 'sampler2D' },
    });
    expect(r.code).toBe('_fn_gh_bind0_H(x, y)');
    expect(definition(r.preamble, '_fn_gh_bind0_H')).toContain(
      'float _fn_gh_bind0_H(float u, float _in_y)'
    );
    // `H` is a texture, which a shader function cannot take.
    expect(() =>
      glsl(ce, ce.box(['gh', 'H', 'x']), {
        callerLocals: ['H', 'x', 'y'],
        storage: { H: 'sampler2D' },
      })
    ).toThrow(/reads the caller local "H".*no GLSL value type/);
  });

  test('a stored value read in a function body reads the parameter', () => {
    const ce = engine();
    const r = glsl(ce, ce.box(['ga', 'y']), { callerLocals: XY });
    expect(definition(r.preamble, '_fn_ga')).toMatchInlineSnapshot(`
      float _fn_ga(float u, float _in_x) {
        return (_in_x + 1.0) + u;
      }
    `);
    expect(r.code).toBe('_fn_ga(y, x)');
    // (10 + 1) + 3
    expect(run(r, 'float x, float y', 10, 3)).toBe(14);
    const ce2 = engine();
    ce2.assign('x', 10);
    expect(ce2.box(['ga', 3]).evaluate().re).toBe(14);
  });

  test('a block local function is outside the GLSL fragment', () => {
    // A function literal has no GLSL lowering, so a block local function
    // never becomes a shader function that could read a caller local.
    const ce = engine();
    expect(() =>
      glsl(
        ce,
        ce.box([
          'Block',
          ['Assign', 'q', ['Function', ['Multiply', 'u', 'x'], 'u']],
          ['q', 'y'],
        ]),
        { callerLocals: XY }
      )
    ).toThrow(/outside the GLSL fragment/);
  });

  test('an invariant-prefix variant takes the caller locals after its extra parameters', () => {
    const ce = engine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Add', ['Multiply', ['Sin', ['Add', 'a', 'y']], 'b'], 'x'],
        'a',
        'b',
      ])
    );
    const r = glsl(
      ce,
      ce.box(['Sum', ['f', 'y', 'k'], ['Limits', 'k', 1, 300]]),
      {
        callerLocals: XY,
      }
    );
    const variant =
      /float (_fn_f_inv\d+)\(float a, float b, float (_tv\d+), float _in_x\)/.exec(
        r.preamble!
      );
    expect(variant).not.toBeNull();
    expect(r.code).toMatch(
      new RegExp(`${variant![1]}\\(y, float\\(k\\), _tv\\d+, x\\)`)
    );
  });

  test('a function parameter spelled like the reserved parameter name', () => {
    const ce = engine();
    ce.assign('w', ce.box(['Function', ['Add', '_in_x', 'x'], '_in_x']));
    const r = glsl(ce, ce.box(['w', 2]), { callerLocals: XY });
    expect(definition(r.preamble, '_fn_w')).toMatchInlineSnapshot(`
      float _fn_w(float _in_x, float _in_x_2) {
        return _in_x + _in_x_2;
      }
    `);
    expect(r.code).toBe('_fn_w(2.0, x)');
  });

  test('compileFunction: a declared parameter is passed by its name', () => {
    const ce = engine();
    const target = new GLSLTarget();
    const text = target.compileFunction(
      ce.parse('g(1) + h(2)'),
      'userFn',
      'float',
      [
        ['x', 'float'],
        ['y', 'float'],
      ],
      { callerLocals: XY }
    );
    expect(text).toContain('float _fn_g(float u, float _in_x)');
    expect(text).toContain('float _fn_h(float x, float _in_x, float _in_y)');
    expect(text).toContain(
      'float userFn(float x, float y) {\n  return _fn_h(2.0, x, y) + _fn_g(1.0, x);\n}'
    );
    // An integer parameter is read through a float conversion.
    const int = target.compileFunction(
      ce.parse('g(1)'),
      'userFn',
      'float',
      [['x', 'int']],
      { callerLocals: ['x'] }
    );
    expect(int).toContain('return _fn_g(1.0, float(x));');
  });

  test('canCompile() accepts what compile() compiles with the option', () => {
    const ce = engine();
    expect(
      canCompile(ce.parse('g(1)'), {
        to: 'glsl',
        callerLocals: XY,
      } as never)
    ).toEqual({ ok: true });
  });

  test('canCompile() gives the decline of a `vars` source that is caller code', () => {
    const ce = engine();
    const answer = canCompile(ce.parse('g(1)'), {
      to: 'glsl',
      callerLocals: XY,
      vars: { x: 'next()' },
    } as never);
    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.diagnostic.code).toBe('caller-local-source');
    expect(!answer.ok && answer.diagnostic.binding).toBe('x');
  });

  test('canCompile() gives the decline of a caller local with no value type', () => {
    const ce = engine();
    ce.declare('H', 'list<number^1600>');
    expect(
      executeEpsil(
        ce,
        'function gh(H: list<integer>, u: real) -> real { H[1600] * u + y }'
      ).diagnostics
    ).toEqual([]);
    const answer = canCompile(ce.box(['gh', 'H', 'x']), {
      to: 'glsl',
      callerLocals: ['H', 'x', 'y'],
      storage: { H: 'sampler2D' },
    } as never);
    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.diagnostic.code).toBe('caller-local-type');
    expect(!answer.ok && answer.diagnostic.binding).toBe('H');
  });

  test('the other targets ignore the option', () => {
    const ce = engine();
    const js = (options: object) =>
      (
        compile(ce.parse('g(1) + h(y)'), {
          to: 'javascript',
          fallback: false,
          ...options,
        } as never) as unknown as { code: string }
      ).code;
    expect(js({ callerLocals: XY })).toBe(js({}));
  });
});
