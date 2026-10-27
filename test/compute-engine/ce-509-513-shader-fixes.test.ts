/**
 * Five shader defects that Tycho found while it compared the `glsl` (WebGL2)
 * and `wgsl` (WebGPU) targets on a GPU, on 2026-10-26. Each block names the
 * ROADMAP reference and the Tycho row.
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
  to: 'glsl' | 'wgsl'
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
 * and `y`. A scalar helper signature (`float f(float x, float y) {`, or
 * `fn f(x: f32, y: f32) -> f32 {`) becomes `function f(x, y) {`, and a
 * local `float r =` becomes `let r =`. The shader built-ins are passed in.
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
    .replace(
      /\bfn (\w+)\(x: f32(?:, y: f32)?\) -> f32 \{/g,
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

describe('CE-509 (Tycho row 454): WGSL tanh of a large argument', () => {
  it('calls the helper on WGSL, and keeps the built-in on GLSL', () => {
    const r = shader('\\tanh(x)', 'wgsl');
    expect(r.code).toBe('_gpu_tanh(x)');
    expect(r.preamble).toContain(
      'return select(tanh(x), sign(x), abs(x) > 10.0);'
    );
    expect(shader('\\tanh(x)', 'glsl').code).toBe('tanh(x)');
  });

  it('gives the right value where the WebGPU built-in did not', () => {
    // A built-in that is NaN above 44, as measured on WebGPU over Metal.
    const brokenTanh = (x: number) => (Math.abs(x) >= 44 ? NaN : Math.tanh(x));
    const f = asFunction(shader('\\tanh(x)', 'wgsl'), {
      select: (f, t, c) => (c ? t : f),
      tanh: brokenTanh,
      sign: Math.sign,
      abs: Math.abs,
    });
    for (const x of [-1e6, -45, -1, 0, 0.5, 9.5, 44, 45, 88, 1e6])
      expect([x, Math.fround(f(x, 0))]).toEqual([x, Math.fround(Math.tanh(x))]);
    // A NaN operand fails the comparison and stays NaN.
    expect(f(NaN, 0)).toBeNaN();
  });

  it('passes a compound operand once, and a vector to its own width', () => {
    expect(shader('\\tanh(\\sin(x)+y)', 'wgsl').code).toBe(
      '_gpu_tanh(y + _gpu_sin(x))'
    );
    const r = shader(['Tanh', 'v'], 'wgsl');
    expect(r.code).toBe('_gpu_tanh3(v)');
    expect(r.preamble).toContain('abs(x) > vec3f(10.0)');
  });

  it('draws a random operand once, in the order it is written', () => {
    // The seed varies per invocation, so the draws are not folded.
    const code = shader(
      ['WithRandomSeed', 'x', ['Tuple', ['Random'], ['Tanh', ['Random']]]],
      'wgsl'
    ).code;
    expect((code.match(/_gpu_rnd_draw/g) ?? []).length).toBe(2);
    expect(code.startsWith('vec2f(_gpu_rnd_draw(')).toBe(true);
  });

  it('a written list takes the helper of its width', () => {
    expect(shader(['Tanh', ['List', 'x', 'y']], 'wgsl').code).toBe(
      '_gpu_tanh2(vec2f(x, y))'
    );
    expect(shader(['Coth', ['List', 'x', 'y']], 'wgsl').code).toBe(
      '(1.0 / _gpu_tanh2(vec2f(x, y)))'
    );
  });

  it('Coth is 1/tanh on both targets, which stays finite above 89', () => {
    expect(shader('\\coth(x)', 'glsl').code).toBe('(1.0 / tanh(x))');
    expect(shader('\\coth(x)', 'wgsl').code).toBe('(1.0 / _gpu_tanh(x))');
  });
});

describe('CE-510 (Tycho row 455): a constant above the f32 maximum on WGSL', () => {
  it('is written as an infinity on WGSL', () => {
    const r = shader('\\exp(100)+x', 'wgsl');
    expect(r.code).toBe('x + _gpu_inf()');
    expect(r.preamble).toContain('fn _gpu_inf()');
    expect(shader('-10^{40}+x', 'wgsl').code).toBe('x + (-_gpu_inf())');
  });

  it('a value that rounds to the maximum is written as the maximum', () => {
    // 3.4028235e38 is above the maximum 3.4028234663852886e38 as a decimal.
    expect(shader(['Add', 'x', 3.4028235e38], 'wgsl').code).toBe(
      'x + 3.4028234663852886e+38'
    );
  });

  it('keeps a constant in range, and keeps the literal on GLSL', () => {
    expect(shader('3.4\\times10^{38}+x', 'wgsl').code).toBe('x + 3.4e+38');
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

  it('a divisor of one maps a result of 1.0 to 0 on both targets', () => {
    // In f32, `fract(-1e-20)` is `1 - 1e-20`, which rounds to 1.0.
    const f32Fract = (x: number) => Math.fround(fract(Math.fround(x)));
    for (const to of ['glsl', 'wgsl'] as const) {
      const r = shader(['Mod', 'x', 1], to);
      expect(r.code).toBe('fract(fract(x))');
      expect(asFunction(r, { fract: f32Fract })(-1e-20, 0)).toBe(0);
      expect(asFunction(r, { fract: f32Fract })(-0.25, 0)).toBe(0.75);
    }
  });
});

describe('CE-512 (Tycho row 457): WGSL Mod computes its operands once', () => {
  it('passes a user function call in the dividend once', () => {
    expect(shader('\\operatorname{mod}(g(x), y)', 'wgsl').code).toBe(
      '_gpu_fmod(_fn_g(x), y)'
    );
  });

  it('draws a random operand once', () => {
    const code = shader(
      ['WithRandomSeed', 'x', ['Mod', ['Random'], 'y']],
      'wgsl'
    ).code;
    expect((code.match(/_gpu_rnd_draw/g) ?? []).length).toBe(1);
  });
});

describe('a WGSL branch that draws a random value fails closed', () => {
  // `select` computes every branch, so a draw in a branch that is not taken
  // would advance the random stream and shift every later draw.
  const json = [
    'WithRandomSeed',
    'x',
    ['Tuple', ['If', ['Less', 'x', 0], ['Mod', ['Random'], 2], 0], ['Random']],
  ];

  it('declines on WGSL', () => {
    expect(() =>
      compile(ce.box(json as never), { to: 'wgsl', fallback: false } as never)
    ).toThrow(/a branch draws a random value/);
  });

  it('compiles on GLSL, whose ternary evaluates only the taken branch', () => {
    expect(shader(json, 'glsl').code).toContain('?');
  });

  it('writes a branch that draws once, alone in its statement, as an `if`', () => {
    // The hoisted `if` makes the draw only in the branch that is taken, and
    // no other draw of the statement can come between (Tycho row 466).
    const { code } = shader(
      ['WithRandomSeed', 'x', ['If', ['Less', 'x', 0], ['Random'], 0]],
      'wgsl'
    );
    expect(code).toMatch(
      /^var _tv\d+: f32;\nif \(x < 0\.0\) \{\n  _tv\d+ = _gpu_rnd_draw\(/
    );
    expect(code).not.toContain('select(');
    expect(code.split('_gpu_rnd_draw(').length - 1).toBe(1);
  });

  it('still agrees with the floored modulo', () => {
    const f = asFunction(shader(['Mod', 'x', 'y'], 'wgsl'), {
      sign: Math.sign,
      abs: Math.abs,
    });
    expect(f(-7, 3)).toBe(2);
    expect(f(7, -3)).toBe(-2);
    expect(f(-1e-200, 1e200) === 0).toBe(true);
  });
});

describe('CE-513 (Tycho row 458): a WGSL arm that calls a function is an if', () => {
  const piecewise =
    '\\begin{cases} g(x) & x<0 \\\\ 0 & \\text{otherwise}\\end{cases}';

  it('computes only the arm that is taken on WGSL', () => {
    expect(shader(piecewise, 'wgsl').code).toBe(
      'var _tv2: f32;\n' +
        'if (x < 0.0) {\n' +
        '  _tv2 = _fn_g(x);\n' +
        '} else {\n' +
        '  _tv2 = 0.0;\n' +
        '}\n' +
        'return _tv2;'
    );
  });

  it('keeps the ternary on GLSL, and select for a cheap arm', () => {
    expect(shader(piecewise, 'glsl').code).toBe(
      '((x < 0.0) ? (_fn_g(x)) : ((0.0)))'
    );
    expect(
      shader(
        '\\begin{cases} \\sin(x) & x<0 \\\\ 0 & \\text{otherwise}\\end{cases}',
        'wgsl'
      ).code
    ).toBe('select((0.0), _gpu_sin(x), x < 0.0)');
  });

  it('takes the if form for an arm with a costly helper', () => {
    for (const arm of [
      ['Zeta', 'x'],
      ['HurwitzZeta', 'x', 0.5],
    ])
      expect(shader(['If', ['Less', 'x', 2], arm, 0], 'wgsl').code).toMatch(
        /^var _tv\d+: f32;\nif \(x < 2\.0\) \{/
      );
  });
});
