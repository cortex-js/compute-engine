/**
 * CE-565.4 and CE-565.1: inside the body of a user function that the shader
 * targets emit as a function of its own (`_fn_F`), `sin`, `cos`, `min` and
 * the other operations with a NaN-safe helper call the built-in for an
 * operand that reads a parameter when the parameter is finite for certain:
 * every call of the function in the compiled expression passes a value that
 * is finite for certain at its position, proven from the declarations of
 * the host (`gpuRecordCallSiteFacts` in `compilation/gpu-finite-proof.ts`),
 * or the host declared the parameter with a range
 * (`F: (real<-1..1>) -> real`). A bare declared `real` parameter is not
 * enough: `F(exp(x), y)` passes a `real` that overflows to `+∞` in f32. A
 * symbol that the compiled code writes (`x ≔ exp(x)`) is not finite by its
 * declared type. The body of a function is not read to prove its result.
 *
 * At a call site, a call of a user function whose result type the host
 * declared with a range (`F: (real, real) -> real<-2..2>`) is finite, of
 * magnitude at most the bound of that range, and `sin(F(x, y))` calls the
 * built-in. A result type with no range (`(real) -> real`) is not enough:
 * the body is computed in f32 and can overflow. The helper gives the same values as
 * the built-in, and as the JavaScript target, on finite inputs.
 *
 * Every test builds its OWN engine: these tests assign symbols.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { shaderFunctions } from './gpu-shader-f32-eval';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const TARGETS = ['glsl'] as const;
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
  ce.declare('n', 'real | signed_infinity | nan');
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
    new RegExp(`(?:float|vec2) ${name}\\s*\\(`)
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
  return `float _main(${params.map((p) => `float ${p}`).join(', ')}) {\n${body}\n}`;
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
  describe('a parameter that every call bounds calls the built-in', () => {
    // Every call passes a value that is finite for certain from the
    // declarations of `x` and `y`, whatever the declaration of `F`.
    for (const declaration of [
      undefined,
      'function',
      '(real, real) -> real',
      '(a: real, b: real) -> real',
    ])
      it(`with F declared ${declaration ?? 'nothing'} and finite calls`, () => {
        const ce = engineWith('F', F_LITERAL, declaration);
        const { preamble } = shader(
          ce,
          [...F_ROW, ['F', 1, ['Add', 'y', 0.5]], ['F', 'x', -2.5]],
          to
        );
        expect(returned(preamble, '_fn_F')).toBe(
          'sin(a) + cos(b) + min(a, b)'
        );
      });

    it('with a ranged signature and ranged arguments', () => {
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

    it('with a slider that `vars` maps to its own name', () => {
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

    it("with a call from another body that passes that body's parameter", () => {
      const ce = engineWith('F', F_LITERAL, 'function');
      ce.declare('G', 'function');
      ce.assign(
        'G',
        ce.expr([
          'Function',
          ['Add', ['Sin', 'c'], ['F', 'c', ['Multiply', 2, 'c']]],
          'c',
        ])
      );
      const { preamble } = shader(
        ce,
        ['Add', ['G', 'x'], ['G', 'y'], ['F', 'x', 'y']],
        to
      );
      // `c` is finite (every call of `G` passes `x` or `y`), so `a` is.
      // `2c` can overflow in f32, since `c` has no bound: `b` is not
      // finite for certain, and keeps the helpers.
      expect(returned(preamble, '_fn_F')).toBe(
        'sin(a) + _gpu_cos(b) + _gpu_min(a, b)'
      );
      expect(returned(preamble, '_fn_G')).toMatch(/^sin\(c\) \+ /);
    });

    it('with a parameter that a call bounds through another body', () => {
      // `c` is at most 10, so `2c` is at most 20, and `b` is finite.
      const ce = engineWith('F', F_LITERAL, 'function');
      ce.declare('k', 'real<0..10>');
      ce.declare('G', 'function');
      ce.assign(
        'G',
        ce.expr([
          'Function',
          ['Add', ['Sin', 'c'], ['F', 'c', ['Multiply', 2, 'c']]],
          'c',
        ])
      );
      const { preamble } = shader(ce, ['Add', ['G', 'k'], ['F', 'k', 1]], to);
      expect(returned(preamble, '_fn_F')).toBe('sin(a) + cos(b) + min(a, b)');
    });
  });

  describe('a parameter keeps the helper', () => {
    it('when one call passes a value that can overflow in f32', () => {
      // `exp(x)` with `x` declared `real` is `+∞` in f32 for `x > 88.7`.
      const ce = engineWith('F', ['Function', ['Sin', 'a'], 'a'], 'function');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'x'], ['F', ['Exp', 'y']]],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe('_gpu_sin(a)');
    });

    it('when a call passes a symbol with no declared type', () => {
      // The host can pass NaN for the uniform `z`.
      const ce = engineWith('F', ['Function', ['Sin', 'a'], 'a'], 'function');
      const { preamble } = shader(ce, ['F', 'z'], to);
      expect(returned(preamble, '_fn_F')).toBe('_gpu_sin(a)');
    });

    it('when a call passes a value that can be NaN or infinite', () => {
      // `n` is declared `real | signed_infinity | nan`, as a host declares a
      // value that a document can make NaN.
      const ce = engineWith('F', ['Function', ['Sin', 'a'], 'a'], 'function');
      const { preamble } = shader(ce, ['Add', ['F', 'x'], ['F', 'n']], to);
      expect(returned(preamble, '_fn_F')).toBe('_gpu_sin(a)');
    });

    it('when a body passes a value that the angular unit makes large', () => {
      // In degree mode the shader computes `arctan(c)` as
      // `57.29578 * atan(c)`, up to 90, not π/2: `1e37·a·a` then overflows
      // in f32. The call sites are read from the body that the shader
      // compiles.
      const ce = new ComputeEngine();
      ce.angularUnit = 'deg';
      ce.declare('x', 'real');
      ce.declare('F', 'function');
      ce.assign(
        'F',
        ce.expr([
          'Function',
          ['Sin', ['Multiply', 1e37, 'a', 'a']],
          'a',
        ] as never)
      );
      ce.declare('G', 'function');
      ce.assign(
        'G',
        ce.expr(['Function', ['Add', ['F', ['Arctan', 'c']], 'c'], 'c'] as never)
      );
      const { preamble } = shader(ce, ['G', 'x'], to);
      expect(returned(preamble, '_fn_F')).toMatch(/^_gpu_sin\(/);
    });

    it('when a call passes a point', () => {
      // `G(q)` with a point `q` takes a copy of `G` where `Abs(p)` is the
      // norm `length(p)`, which can overflow in f32.
      const ce = engineWith('F', ['Function', ['Sin', 'a'], 'a'], 'function');
      ce.declare('q', 'tuple<real, real>');
      ce.declare('G', 'function');
      ce.assign('G', ce.expr(['Function', ['F', ['Abs', 'p']], 'p'] as never));
      const { preamble } = shader(ce, ['G', 'q'], to);
      expect(returned(preamble, '_fn_F')).toBe('_gpu_sin(a)');
    });

    it('with a loop index as the argument', () => {
      const ce = engineWith('F', ['Function', ['Sin', 'a'], 'a'], 'function');
      const { preamble } = shader(
        ce,
        ['Add', ['F', 'x'], ['Sum', ['F', 'k'], ['Limits', 'k', 1, 300]]],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe('_gpu_sin(a)');
    });

    it('a mutually recursive pair is still refused', () => {
      // The shader languages have no recursion.
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.parse('f(a) := \\sin(a) + g(a)').evaluate();
      ce.parse('g(b) := \\cos(b) + f(b)').evaluate();
      const r = compile(ce.parse('f(x)'), { to });
      expect(r.success).toBe(false);
    });
  });

  describe('a call with a declared result type', () => {
    // The host declares the result type of `F` with a range: the call is a
    // finite real of known magnitude, and the guarded call of it is the
    // built-in. The body of `F` is not read to prove the call; its own
    // operands are proven from the calls (`F(x)` passes a finite `x`).
    it('(real) -> real<-1..1> calls the built-in', () => {
      const ce = engineWith(
        'F',
        ['Function', ['Divide', ['Cos', 'a'], 2], 'a'],
        '(real) -> real<-1..1>'
      );
      const { code, preamble } = shader(ce, ['Sin', ['F', 'x']], to);
      expect(code).toBe('sin(_fn_F(x))');
      expect(returned(preamble, '_fn_F')).toBe('0.5 * cos(a)');
    });

    it('the range of the result type bounds a product', () => {
      // `|1000·F(x)|` is at most 1000.
      const ce = engineWith(
        'F',
        ['Function', ['Divide', ['Cos', 'a'], 2], 'a'],
        '(real) -> real<-1..1>'
      );
      expect(shader(ce, ['Sin', ['Multiply', 1000, ['F', 'x']]], to).code).toBe(
        'sin(1000.0 * _fn_F(x))'
      );
    });

    it('a result type with no range keeps the helper', () => {
      // The body is computed in f32: `exp(a)` is `+∞` for `a > 88.7`,
      // although the declared result type is `real`.
      const ce = engineWith(
        'F',
        ['Function', ['Exp', 'a'], 'a'],
        '(real) -> real'
      );
      expect(shader(ce, ['Sin', ['F', 'x']], to).code).toBe(
        '_gpu_sin(_fn_F(x))'
      );
    });

    for (const declaration of [undefined, 'function'])
      it(`F declared ${declaration ?? 'nothing'} keeps the helper`, () => {
        // The call is typed `number`.
        const ce = engineWith(
          'F',
          ['Function', ['Divide', ['Cos', 'a'], 2], 'a'],
          declaration
        );
        expect(shader(ce, ['Sin', ['F', 'x']], to).code).toBe(
          '_gpu_sin(_fn_F(x))'
        );
      });

    it('a range that the body gives to F declared `function` keeps the helper', () => {
      // With `h: function`, the engine types the call `h(x)` from the body:
      // `Fract(p)` with `p: real` gives `real<0..1>`. That range is not a
      // declaration of the host, so it does not make the call finite.
      const ce = engineWith(
        'h',
        ['Function', ['Fract', 'p'], ['Typed', 'p', "'real'"]],
        'function'
      );
      expect(ce.expr(['h', 'x']).type.toString()).toBe('real<0..1>');
      expect(shader(ce, ['Sin', ['h', 'x']], to).code).toBe(
        '_gpu_sin(_fn_h(x))'
      );
    });

    it('an argument that is not finite for certain keeps the helper', () => {
      // `z` is a uniform with no declared type: the host can pass NaN.
      const ce = engineWith(
        'F',
        ['Function', ['Divide', ['Cos', 'a'], 2], 'a'],
        '(real) -> real<-1..1>'
      );
      expect(shader(ce, ['Sin', ['F', 'z']], to).code).toBe(
        '_gpu_sin(_fn_F(z))'
      );
    });
  });

  describe('a value that the code writes', () => {
    // `w ≔ exp(x)` assigns `+∞` (in f32) to the local `w` for x > 88.7:
    // the declared type of `x` says nothing about the value of `w`. (A
    // compiled block does not write the input `x` itself.)
    const WRITE = ['Assign', 'w', ['Exp', 'x']];

    it('keeps the guard at the root', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const { code } = shader(ce, ['Block', WRITE, ['Sin', 'w']], to);
      expect(code).toMatch(/_gpu_sin\(w\)/);
    });

    it('keeps the guard in the body of a function it is passed to', () => {
      const ce = engineWith('F', ['Function', ['Sin', 'a'], 'a'], 'function');
      const { preamble } = shader(ce, ['Block', WRITE, ['F', 'w']], to);
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

  describe('a declared parameter range', () => {
    // The declared range of a parameter is a promise of the host, as the
    // declared range of an input is: `a` is in [-1, 1], so `sin(1000·a)` is
    // the built-in, whatever the argument. An argument outside the range is
    // a value outside its declared type.
    it('calls the built-in for an argument with no bound', () => {
      const ce = engineWith(
        'F',
        ['Function', ['Sin', ['Multiply', 1000, 'a']], 'a'],
        '(real<-1..1>) -> real'
      );
      const { preamble } = shader(ce, ['F', ['Exp', 'x']], to);
      expect(returned(preamble, '_fn_F')).toBe('sin(1000.0 * a)');
    });

    it('bounds only the parameter that has a range', () => {
      const ce = engineWith('F', P_LITERAL, '(real<0..10>, real) -> real');
      const { preamble } = shader(
        ce,
        ['F', ['Exp', 'x'], ['Exp', 'y']],
        to
      );
      expect(returned(preamble, '_fn_F')).toBe(
        '_gpu_cos(b) + _gpu_sin(a * b)'
      );
    });

    it('keeps the guard on the compileFunction route', () => {
      // This route opens no session of the common-subexpression pass, and
      // without one the proof proves no operand: a declared range does not
      // change that.
      const ce = engineWith(
        'F',
        ['Function', ['Sin', 'a'], 'a'],
        '(real<-5..5>) -> real'
      );
      const src = new GLSLTarget().compileFunction(
        ce.box(['F', 'x']) as never,
        'f',
        'float',
        [['x', 'float']]
      );
      expect(returned(src, '_fn_F')).toBe('_gpu_sin(a)');
    });
  });

  describe('compileFunction', () => {
    // This route records no call sites, and a bare `real` parameter is not
    // a range, so `F` keeps the guard.
    it('keeps the guard in the body of a called function', () => {
      const ce = engineWith(
        'F',
        ['Function', ['Sin', 'a'], 'a'],
        '(real) -> real'
      );
      const src = new GLSLTarget().compileFunction(
        ce.box(['F', 'x']) as never,
        'f',
        'float',
        [['x', 'float']]
      );
      expect(returned(src, '_fn_F')).toBe('_gpu_sin(a)');
    });
  });

  describe('a per-call copy (CE-565.1)', () => {
    // `R(V, t)` binds a list `V` whole, so a list argument takes a copy of
    // `R` with a `vec2` parameter. Its scalar parameter `t` is finite for
    // certain, since every call passes the declared `phi`.
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

    it('calls the built-ins when every call passes a finite scalar', () => {
      const ce = engineWith('R', R_LITERAL, 'function');
      ce.declare('phi', 'real');
      // The GLSL fragment has a `Sum` only over integer index ranges, and
      // the body of `R` sums a list.
      expect(() => shader(ce, rowOf('phi'), to)).toThrow(
        /`Sum` is in the GLSL fragment only over one or more integer index ranges/
      );
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
      expectSameValues(
        ce,
        ['Add', ['G', 'x'], ['G', 'y'], ['F', 'x', 'y']],
        to,
        POINTS
      );
    });

    it('of a call with a declared result type match the JavaScript target', () => {
      // `sin(a·b) + cos(b)` is in [-2, 2].
      const ce = engineWith('F', P_LITERAL, '(real, real) -> real<-2..2>');
      const row = ['Sin', ['F', 'x', 'y']];
      expect(shader(ce, row, to).code).toBe('sin(_fn_F(x, y))');
      expectSameValues(ce, row, to, POINTS);
    });
  });
});
