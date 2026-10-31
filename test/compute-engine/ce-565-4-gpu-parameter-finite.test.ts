/**
 * CE-565.4 and CE-565.1: inside the body of a user function that the shader
 * targets emit as a function of its own (`_fn_F`), `sin`, `cos`, `min` and
 * the other operations with a NaN-safe helper call the built-in for a
 * parameter that is finite for certain (`gpuProvablyFinite` and
 * `gpuRecordCallSiteFacts` in `compilation/gpu-target.ts`):
 * every call of the function in the compiled expression passes an
 * argument that is finite for certain at that position. Tycho declares its
 * document functions with the bare type `function`. A declared signature
 * (`(real, real) -> real`) is not enough: `F(exp(x), y)` passes a `real`
 * that overflows to `+∞` in f32. A symbol that the compiled code writes
 * (`x ≔ exp(x)`) is not finite by its declared type either.
 *
 * A parameter keeps the helper when one call passes an argument that is
 * not finite for certain, and the product of two parameters with no bound
 * keeps it (f32 overflow). The emitted code gives the same values as the
 * JavaScript target on finite inputs.
 *
 * Every test builds its OWN engine: these tests assign symbols.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const TARGETS = ['glsl', 'wgsl'] as const;
type Target = (typeof TARGETS)[number];

/** `F := (a, b) ↦ sin(a) + cos(b) + min(a, b)` */
const F_LITERAL = [
  'Function',
  ['Add', ['Sin', 'a'], ['Cos', 'b'], ['Min', 'a', 'b']],
  'a',
  'b',
];

/** `P := (a, b) ↦ sin(a·b) + cos(b)` */
const P_LITERAL = [
  'Function',
  ['Add', ['Sin', ['Multiply', 'a', 'b']], ['Cos', 'b']],
  'a',
  'b',
];

/** `F(x, y) + F(x + 1, y) + F(y, x)` */
const F_ROW = [
  'Add',
  ['F', 'x', 'y'],
  ['F', ['Add', 'x', 1], 'y'],
  ['F', 'y', 'x'],
];

/**
 * An engine with `x`, `y` declared `real` and `name` assigned `literal`,
 * after the declaration `declaration` of `name` (none when `undefined`).
 */
function engineWith(
  name: string,
  literal: unknown,
  declaration?: string
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  if (declaration !== undefined) ce.declare(name, declaration);
  ce.assign(name, ce.expr(literal as never));
  return ce;
}

function shader(
  ce: ComputeEngine,
  json: unknown,
  to: Target,
  options: object = {}
): { code: string; preamble: string } {
  const r = compile(ce.expr(json as never), {
    to,
    fallback: false,
    ...options,
  } as never) as { success: boolean; code?: string; preamble?: string };
  expect(r.success).toBe(true);
  return { code: r.code ?? '', preamble: r.preamble ?? '' };
}

/** The text of the emitted definition `name` (`_fn_F`) in `preamble`. */
function definition(preamble: string, name: string): string {
  const start = preamble.search(
    new RegExp(`(?:float|vec2f?|fn) ${name}\\s*\\(`)
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const end = preamble.indexOf('\n}', start);
  return preamble.slice(start, end + 2);
}

/** The return expression of a one-line definition `name`. */
function returned(preamble: string, name: string): string {
  const m = /return (.*);/.exec(definition(preamble, name));
  expect(m).not.toBeNull();
  return m![1];
}

/** The emitted root code as one shader function `_main` of `params`. */
function mainFunction(code: string, params: string[], to: Target): string {
  const body = /\breturn\b/.test(code) ? code : `return ${code};`;
  return to === 'glsl'
    ? `float _main(${params.map((p) => `float ${p}`).join(', ')}) {\n${body}\n}`
    : `fn _main(${params.map((p) => `${p}: f32`).join(', ')}) -> f32 {\n${body}\n}`;
}

/** The shader agrees with the JavaScript target at `points` (`[x, y]`). */
function expectSameValues(
  ce: ComputeEngine,
  json: unknown,
  to: Target,
  points: [number, number][]
): void {
  const { code, preamble } = shader(ce, json, to);
  const js = compile(ce.expr(json as never), { to: 'javascript' });
  const run = shaderFunctions(
    `${preamble}\n${mainFunction(code, ['x', 'y'], to)}`,
    to
  );
  for (const [x, y] of points) {
    const want = js.run!({ x, y }) as number;
    const got = run('_main', x, y) as number;
    expect(Math.abs(got - want)).toBeLessThan(1e-5);
  }
}

const POINTS: [number, number][] = [
  [0.3, 0.2],
  [-0.7, 0.4],
  [1.1, -0.6],
  [-1.3, -2.8],
  [3.5, 0.05],
];

describe.each(TARGETS)('CE-565.4 on %s', (to) => {
  // With a declared signature, the facts still come from the call sites
  // (here every call passes a finite argument); the declaration alone proves
  // nothing.
  describe('a declared signature', () => {
    for (const declaration of [
      '(real, real) -> real',
      '(a: real, b: real) -> real',
    ])
      it(`with ${declaration} and finite calls uses the built-ins`, () => {
        const ce = engineWith('F', F_LITERAL, declaration);
        const { preamble } = shader(ce, F_ROW, to);
        expect(returned(preamble, '_fn_F')).toBe('sin(a) + cos(b) + min(a, b)');
        expect(preamble).not.toMatch(/_gpu_/);
      });

    it('ranged arguments bound the product of two parameters', () => {
      const ce = engineWith(
        'F',
        P_LITERAL,
        '(real<0..10>, real<-1..1>) -> real'
      );
      ce.declare('k', 'real<0..10>');
      ce.declare('s', 'real<-1..1>');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'k', 's'], ['F', 2, 's'], ['F', 'k', 0.5]],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe('cos(b) + sin(a * b)');
    });

    it('a declared `real` is not enough when an argument can overflow f32', () => {
      // `exp(x)` is typed `real`, and is `+∞` in f32 for x > 88.7.
      const ce = engineWith('F', F_LITERAL, '(real, real) -> real');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'x', 'y'], ['F', ['Exp', 'x'], 'y']],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe(
        '_gpu_sin(a) + cos(b) + _gpu_min(a, b)'
      );
      const finite = shader(ce, ['F', 'x', 'y'], to).preamble;
      expect(returned(finite, '_fn_F')).toBe('sin(a) + cos(b) + min(a, b)');
    });

    it('a declared `real` with no range keeps the guard of a product', () => {
      const ce = engineWith('F', P_LITERAL, '(real, real) -> real');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'x', 'y'], ['F', 'y', 'x']],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe('cos(b) + _gpu_sin(a * b)');
    });
  });

  describe('the call sites', () => {
    for (const declaration of ['function', undefined])
      it(`prove the parameters of F declared ${declaration ?? 'nothing'}`, () => {
        const ce = engineWith('F', F_LITERAL, declaration);
        const { preamble } = shader(
          ce,
          [...F_ROW, ['F', 1, ['Add', 'y', 0.5]], ['F', 'x', -2.5]],
          to
        );
        expect(returned(preamble, '_fn_F')).toBe('sin(a) + cos(b) + min(a, b)');
        expect(preamble).not.toMatch(/_gpu_/);
      });

    it('an argument that can overflow f32 keeps the helper (CE-619.1)', () => {
      // `2x` is `+∞` in f32 for `x ≥ 1.8·10³⁸`: `a` is not finite for
      // certain, so `sin(a)` and `min(a, b)` keep their helpers.
      const ce = engineWith('F', F_LITERAL, 'function');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'x', 'y'], ['F', ['Multiply', 2, 'x'], 'y']],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe(
        '_gpu_sin(a) + cos(b) + _gpu_min(a, b)'
      );
    });

    it('a parameter bounds a product only with the size of its arguments (CE-619.1)', () => {
      // `F(p) := sin(H·p)` called as `F(H·x)`: `p` holds `H·x`, so the
      // operand is `H²·x`, `+∞` in f32 from `x ≈ 4`.
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('H', 'real<0..1e19>');
      ce.declare('F', 'function');
      ce.parse('F(p) := \\sin(Hp)').evaluate();
      const { preamble } = shader(ce, ['F', ['Multiply', 'H', 'x']], to);
      expect(returned(preamble, '_fn_F')).toBe('_gpu_sin(H * p)');
      // An argument of known size bounds the parameter: `|p| ≤ 10`.
      ce.declare('s', 'real<-10..10>');
      const bounded = shader(ce, ['F', 's'], to).preamble;
      expect(returned(bounded, '_fn_F')).toBe('sin(H * p)');
    });

    it('one argument that is not finite for certain keeps its helper only', () => {
      // `exp(x)` overflows f32 for x > 88.7.
      const ce = engineWith('F', F_LITERAL, 'function');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'x', 'y'], ['F', ['Exp', 'x'], 'y']],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe(
        '_gpu_sin(a) + cos(b) + _gpu_min(a, b)'
      );
    });

    it('an undeclared symbol argument keeps the helper', () => {
      // `z` is a uniform with no declared type: the host can pass NaN.
      const ce = engineWith('F', F_LITERAL, 'function');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'x', 'y'], ['F', 'x', 'z']],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe(
        'sin(a) + _gpu_cos(b) + _gpu_min(a, b)'
      );
    });

    it('the product of two parameters with no bound keeps the guard', () => {
      const ce = engineWith('F', P_LITERAL, 'function');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'x', 'y'], ['F', 'y', 'x']],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe('cos(b) + _gpu_sin(a * b)');
    });

    it('a remainder by a parameter keeps the guard', () => {
      // `mod(a, b)` is NaN for `b = 0`, whatever the finite `a`. The
      // arguments have a declared range, so that `mod(a, 2)` has a dividend
      // of known size (CE-619.4).
      const ce = engineWith(
        'F',
        [
          'Function',
          ['Add', ['Sin', ['Mod', 'a', 'b']], ['Cos', ['Mod', 'a', 2]]],
          'a',
          'b',
        ],
        'function'
      );
      ce.declare('u', 'real<-10..10>');
      ce.declare('v', 'real<-10..10>');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'u', 'v'], ['F', 'v', 'u']],
        to
      );
      const body = definition(preamble, '_fn_F');
      expect(body).toMatch(/_gpu_sin\(/);
      expect(body).not.toMatch(/_gpu_cos\(/);
      // A dividend of unknown size: the quotient `a / 2` and the product
      // that `mod` computes from it can round past the largest f32.
      const unbounded = shader(
        ce,
        ['Add', ['F', 'x', 'y'], ['F', 'y', 'x']],
        to
      ).preamble;
      expect(definition(unbounded, '_fn_F')).toMatch(/_gpu_cos\(/);
    });

    it('a slider that `vars` maps to its own name bounds a product', () => {
      // `k: real<0..10>` passed as a uniform of its declared type: `a` is
      // at most 20 in magnitude, and `b` at most 1, so `a·b` cannot
      // overflow f32.
      const ce = engineWith('F', P_LITERAL, 'function');
      ce.declare('k', 'real<0..10>');
      ce.declare('s', 'real<-1..1>');
      const { code, preamble } = shader(
        ce,
        ['Add', ['F', 'k', 's'], ['F', ['Multiply', 2, 'k'], 's']],
        to,
        { vars: { k: 'k' } }
      );
      expect(code).toMatch(/_fn_F\(k, s\)/);
      expect(returned(preamble, '_fn_F')).toBe('cos(b) + sin(a * b)');
    });

    it('a slider that `vars` maps to other source keeps the helper', () => {
      const ce = engineWith('F', F_LITERAL, 'function');
      ce.declare('k', 'real<0..10>');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'k', 'x'], ['F', 'y', 'x']],
        to,
        { vars: { k: 'uK' } }
      );
      expect(returned(preamble, '_fn_F')).toBe(
        '_gpu_sin(a) + cos(b) + _gpu_min(a, b)'
      );
    });

    it("a call from another body passes that body's parameter", () => {
      // `G(c) := sin(c) + F(c, 2c) + F(c, exp(c))`: `c` is finite (G is
      // called with `x` and `y`), so `a` of F is; `exp(c)` is not, so `b`
      // keeps the helper.
      const ce = engineWith('F', F_LITERAL, 'function');
      ce.declare('G', 'function');
      ce.assign(
        'G',
        ce.expr([
          'Function',
          [
            'Add',
            ['Sin', 'c'],
            ['F', 'c', ['Multiply', 2, 'c']],
            ['F', 'c', ['Exp', 'c']],
          ],
          'c',
        ])
      );
      const { preamble } = shader(
        ce,
        ['Add', ['G', 'x'], ['G', 'y'], ['F', 'x', 'y']],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe(
        'sin(a) + _gpu_cos(b) + _gpu_min(a, b)'
      );
      expect(returned(preamble, '_fn_G')).toMatch(/^sin\(c\) \+ /);
    });

    it('a call with a loop index as its argument keeps the helper', () => {
      // The index of a loop is bound by the loop: the walk of the call sites
      // does not prove an argument that reads it.
      const ce = engineWith('F', ['Function', ['Sin', 'a'], 'a'], 'function');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'x'], ['Sum', ['F', 'k'], ['Limits', 'k', 1, 'n']]],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe('_gpu_sin(a)');
    });

    it('a mutually recursive pair is still refused', () => {
      // The shader languages have no recursion: the facts change nothing
      // for such a pair, whose compilation fails as before.
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.parse('f(a) := \\sin(a) + g(a)').evaluate();
      ce.parse('g(b) := \\cos(b) + f(b)').evaluate();
      const r = compile(ce.parse('f(x)'), { to });
      expect(r.success).toBe(false);
    });
  });

  describe('a value that the code writes', () => {
    // `x ≔ exp(x)` assigns `+∞` (in f32) to `x` for x > 88.7: the declared
    // type of `x` describes the value that the host passes, not this one.
    const WRITE = ['Assign', 'x', ['Exp', 'x']];

    it('keeps the guard at the root', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const { code } = shader(ce, ['Block', WRITE, ['Sin', 'x']], to);
      expect(code).toMatch(/_gpu_sin\(_tv\d+\)/);
    });

    it('keeps the guard in the body of a function it is passed to', () => {
      const ce = engineWith('F', ['Function', ['Sin', 'a'], 'a'], 'function');
      const { preamble } = shader(ce, ['Block', WRITE, ['F', 'x']], to);
      expect(returned(preamble, '_fn_F')).toBe('_gpu_sin(a)');
    });
  });

  describe('a function whose name `vars` maps', () => {
    // A `vars` entry maps a symbol: the call `F(x)` still emits the engine
    // definition of `F`, which calls `G(exp(a))`. So `G` is not proven by
    // its call `G(x)` alone.
    it('is followed as a caller', () => {
      const ce = engineWith('G', ['Function', ['Sin', 'b'], 'b'], 'function');
      ce.declare('F', 'function');
      ce.assign('F', ce.expr(['Function', ['G', ['Exp', 'a']], 'a']));
      const { preamble } = shader(ce, ['Add', ['G', 'x'], ['F', 'x']], to, {
        vars: { F: 'uF' },
      });
      expect(returned(preamble, '_fn_F')).toBe('_fn_G(exp(a))');
      expect(returned(preamble, '_fn_G')).toBe('_gpu_sin(b)');
    });
  });

  describe('compileFunction', () => {
    // The route records no call sites: the parameters of `x` come from the
    // host, so `F` keeps the guard even with a declared signature.
    it('keeps the guard in the body of a called function', () => {
      const ce = engineWith(
        'F',
        ['Function', ['Sin', 'a'], 'a'],
        '(real) -> real'
      );
      const src =
        to === 'glsl'
          ? new GLSLTarget().compileFunction(
              ce.box(['F', 'x']) as never,
              'f',
              'float',
              [['x', 'float']]
            )
          : new WGSLTarget().compileFunction(
              ce.box(['F', 'x']) as never,
              'f',
              'f32',
              [['x', 'f32']]
            );
      expect(returned(src, '_fn_F')).toBe('_gpu_sin(a)');
    });
  });

  describe('a per-call copy (CE-565.1)', () => {
    // `R(V, t)` binds a list `V` whole, so a list argument takes a copy of
    // `R` with a `vec2` parameter. Its scalar parameter `t` is finite for
    // certain when every call passes a finite `t`.
    const R_LITERAL = [
      'Function',
      [
        'Block',
        [
          'List',
          [
            'Sum',
            ['Multiply', 'V', ['List', ['Cos', 't'], ['Negate', ['Sin', 't']]]],
          ],
          ['Sum', ['Multiply', 'V', ['List', ['Sin', 't'], ['Cos', 't']]]],
        ],
      ],
      'V',
      't',
    ];
    const rowOf = (t: string) => [
      'Sum',
      ['Power', ['R', ['Add', ['List', 'x', 'y'], ['List', -0.57, 2.8]], t], 2],
    ];

    it('uses the built-ins when every call passes a finite scalar', () => {
      const ce = engineWith('R', R_LITERAL, 'function');
      ce.declare('phi', 'real');
      const { preamble } = shader(ce, rowOf('phi'), to);
      const body = definition(preamble, '_fn_R_\\w+');
      expect(body).toMatch(/\bcos\(t\)/);
      expect(body).toMatch(/\bsin\(t\)/);
      expect(preamble).not.toMatch(/_gpu_/);
    });

    it('keeps the helpers when a call passes a `number`', () => {
      const ce = engineWith('R', R_LITERAL, 'function');
      ce.declare('phi', 'real');
      ce.declare('u', 'number');
      const { preamble } = shader(ce, ['Add', rowOf('phi'), rowOf('u')], to);
      const body = definition(preamble, '_fn_R_\\w+');
      expect(body).toMatch(/_gpu_cos\(t\)/);
      expect(body).toMatch(/_gpu_sin\(t\)/);
    });
  });

  describe('the values', () => {
    it('of F with the built-ins match the JavaScript target', () => {
      const ce = engineWith('F', F_LITERAL, 'function');
      expect(returned(shader(ce, F_ROW, to).preamble, '_fn_F')).toBe(
        'sin(a) + cos(b) + min(a, b)'
      );
      expectSameValues(ce, F_ROW, to, POINTS);
    });

    it('of a body that calls another body match the JavaScript target', () => {
      const ce = engineWith('F', F_LITERAL, 'function');
      ce.declare('G', 'function');
      ce.assign(
        'G',
        ce.expr([
          'Function',
          ['Add', ['Sin', 'c'], ['F', 'c', ['Add', 'c', 1]]],
          'c',
        ])
      );
      const row = ['Add', ['G', 'x'], ['G', 'y'], ['F', 'x', 'y']];
      expect(shader(ce, row, to).preamble).not.toMatch(/_gpu_/);
      expectSameValues(ce, row, to, POINTS);
    });

    it('of a product with literal arguments match the JavaScript target', () => {
      const ce = engineWith('F', P_LITERAL, 'function');
      const row = ['Add', ['F', 0.5, 'x'], ['F', -1.5, 'y']];
      // `b` has no known size: `a·b` keeps the helper (CE-619.2), which
      // gives the same values on finite inputs.
      expect(returned(shader(ce, row, to).preamble, '_fn_F')).toBe(
        'cos(b) + _gpu_sin(a * b)'
      );
      expectSameValues(ce, row, to, POINTS);
    });
  });
});
