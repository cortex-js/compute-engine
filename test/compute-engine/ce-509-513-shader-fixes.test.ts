/**
 * Shader defects that Tycho found while it ran the `glsl` (WebGL2) target on
 * a GPU, on 2026-10-26. Each block names the ROADMAP reference and the Tycho
 * row.
 *
 * Shader text cannot run under jest. Where a fix is arithmetic, the test
 * runs the EMITTED text — the scalar helpers of the preamble and the call —
 * as JavaScript, with the shader built-ins written out, so it checks the
 * emission itself.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('v', 'vector<real^3>');
ce.assign('g', ce.parse('x \\mapsto \\sum_{i=1}^{300}\\cos(ix)'));

/** The compiled result; the compile must succeed. */
function shader(
  input: string | unknown,
  to: 'glsl'
): { code: string; preamble: string } {
  const expr =
    typeof input === 'string' ? ce.parse(input) : ce.box(input as never);
  const r = compile(expr, { to, fallback: false } as never);
  expect([to, r.success]).toEqual([to, true]);
  return {
    code: r.code!,
    preamble: (r as { preamble?: string }).preamble ?? '',
  };
}

/**
 * The emitted scalar helpers and expression as a JavaScript function of `x`
 * and `y`. A scalar helper signature (`float f(float x, float y) {`) becomes
 * `function f(x, y) {`, and a local `float r =` becomes `let r =`. The shader
 * built-ins are passed in.
 */
function asFunction(
  emitted: { code: string; preamble: string },
  builtins: Record<string, (...args: number[]) => number>
): (x: number, y: number) => number {
  const helpers = emitted.preamble
    .replace(
      /\bfloat (\w+)\(float x(?:, float y)?\) \{/g,
      (_, name) => `function ${name}(x, y) {`
    )
    .replace(/\bfloat (\w+) =/g, 'let $1 =');
  const names = Object.keys(builtins);
  const f = new Function(
    'x',
    'y',
    ...names,
    `${helpers}\nreturn ${emitted.code};`
  );
  return (x, y) => f(x, y, ...names.map((n) => builtins[n]));
}

const step = (edge: number, x: number) => (x < edge ? 0 : 1);
const fract = (x: number) => x - Math.floor(x);

describe('CE-509 (Tycho row 454): tanh of a large argument', () => {
  it('keeps the built-in on GLSL', () => {
    expect(shader('\\tanh(x)', 'glsl').code).toBe('tanh(x)');
  });

  it('Coth is 1/tanh on GLSL', () => {
    expect(shader('\\coth(x)', 'glsl').code).toBe('(1.0 / tanh(x))');
  });
});

describe('CE-510 (Tycho row 455): a constant above the f32 maximum', () => {
  it('keeps the literal on GLSL', () => {
    expect(shader('\\exp(100)+x', 'glsl').code).toBe(
      'x + 2.6881171418161356e+43'
    );
  });
});

describe('CE-511 (Tycho row 456): GLSL mod stays in the range of the divisor', () => {
  // The first `mod` returns the values measured on WebGL2 over ANGLE Metal
  // for the three witnesses; every other call computes GLSL's definition.
  const measured = new Map([
    ['100000000,3', -2],
    ['-1000000,1000', 1000],
    ['1e-20,-3', -3],
  ]);
  const glslMod = (x: number, y: number) =>
    measured.get(`${x},${y}`) ?? x - y * Math.floor(x / y);
  const builtins = { mod: glslMod, step, sign: Math.sign, abs: Math.abs };
  const emitted = shader(['Mod', 'x', 'y'], 'glsl');
  const f = asFunction(emitted, builtins);

  it('calls the helper', () => {
    expect(emitted.code).toBe('_gpu_fmod(x, y)');
  });

  it('corrects the measured driver results', () => {
    expect(f(1e8, 3)).toBe(1);
    expect(f(-1e6, 1000)).toBe(0);
    expect(f(1e-20, -3) === 0).toBe(true);
  });

  it('agrees with the floored modulo elsewhere', () => {
    expect(f(7, 3)).toBe(1);
    expect(f(-7, 3)).toBe(2);
    expect(f(7, -3)).toBe(-2);
    expect(f(-6, 3)).toBe(0);
    expect(f(-0.25, 1)).toBe(0.75);
  });

  it('keeps a zero divisor NaN', () => {
    expect(f(5, 0)).toBeNaN();
  });

  it('a nested Mod in a conditional arm grows linearly', () => {
    const code = shader(
      [
        'If',
        ['Less', 'x', 0],
        ['Mod', ['Mod', ['Mod', ['Multiply', 17, 'x'], 289], 289], 289],
        0,
      ],
      'glsl'
    ).code;
    expect((code.match(/17\.0 \* x/g) ?? []).length).toBe(1);
  });

  it('a divisor of one maps a result of 1.0 to 0', () => {
    // In f32, `fract(-1e-20)` is `1 - 1e-20`, which rounds to 1.0.
    const f32Fract = (x: number) => Math.fround(fract(Math.fround(x)));
    for (const to of ['glsl'] as const) {
      const r = shader(['Mod', 'x', 1], to);
      expect(r.code).toBe('fract(fract(x))');
      expect(asFunction(r, { fract: f32Fract })(-1e-20, 0)).toBe(0);
      expect(asFunction(r, { fract: f32Fract })(-0.25, 0)).toBe(0.75);
    }
  });
});

describe('a shader branch that draws a random value', () => {
  // A draw in a branch that is not taken would advance the random stream and
  // shift every later draw, so only the taken branch may draw.
  const json = [
    'WithRandomSeed',
    'x',
    ['Tuple', ['If', ['Less', 'x', 0], ['Mod', ['Random'], 2], 0], ['Random']],
  ];

  it('is declined by the GLSL fragment, which does not take `WithRandomSeed`', () => {
    expect(() =>
      compile(ce.box(json as never), { to: 'glsl', fallback: false } as never)
    ).toThrow(/outside the GLSL fragment/);
  });
});

describe('CE-513 (Tycho row 458): an arm that calls a function', () => {
  const piecewise =
    '\\begin{cases} g(x) & x<0 \\\\ 0 & \\text{otherwise}\\end{cases}';

  it('keeps the ternary on GLSL', () => {
    expect(shader(piecewise, 'glsl').code).toBe(
      '_gpu_passes = 0;\n' +
        'float _tv2 = ((x < 0.0) ? (_fn_g(x)) : ((0.0)));\n' +
        'return _gpu_passes > 10000 ? _gpu_nan() : _tv2;'
    );
  });
});
