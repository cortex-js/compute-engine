/**
 * A parameter of a user function with no stated type (or of type `unknown`
 * or `number`) takes the lane of its argument: a call with a real argument
 * calls a function whose parameter is real, a call with a complex argument
 * a function whose parameter is complex, one IR function per lane of such
 * parameters (CE-1476; README of `src/compute-engine/compilation/ir/`,
 * "User functions").
 *
 * Each case checks the compiled value against the interpreter's value at
 * the same inputs.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

type Json = unknown;
type Cx = { re: number; im: number };

const IY = ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'y']];

/** An engine with `x, y: real` and the function `f` of the parameter list
 *  `params` (`['w']` by default) and the body `body`, assigned after a
 *  declaration of `f` as `decl`. */
function engine(body: Json, decl = 'function', params: Json[] = ['w']) {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('f', decl as never);
  ce.box(['Assign', 'f', ['Function', body, ...params]] as never).evaluate();
  return ce;
}

/** The interpreter's value of `json` at `at`, as a complex number. */
function interpret(ce: ComputeEngine, json: Json, at: Record<string, number>) {
  const subs = Object.fromEntries(
    Object.entries(at).map(([k, v]) => [k, ce.number(v)])
  );
  const v = ce
    .box(json as never)
    .subs(subs)
    .N();
  return { re: v.re, im: v.im };
}

/** The compiled value of `json` at `at`, with `fallback: false`. */
function run(
  ce: ComputeEngine,
  json: Json,
  at: Record<string, number>,
  options: object = {}
): Cx {
  const r = compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
    inputs: { x: 'real', y: 'real' },
    ...options,
  } as never) as { success: boolean; run: (a: object) => number | Cx };
  expect(r.success).toBe(true);
  const v = r.run(at);
  return typeof v === 'number' ? { re: v, im: 0 } : v;
}

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

function expectClose(a: Cx, b: Cx) {
  expect(a.re).toBeCloseTo(b.re, 12);
  expect(a.im).toBeCloseTo(b.im, 12);
}

const COMPLEX = { mode: 'complex' };

describe('a parameter of no stated type takes the lane of its argument', () => {
  // prettier-ignore
  test.each<[string, Json, Json, Record<string, number>, string?, Json[]?]>([
    // The witness of CE-1476: a call with a complex and a call with a real
    // argument; the interpreter gives 1.3308390005411683.
    ['the witness', ['Power', 'w', 2], ['Add', ['Arg', ['f', IY]], ['f', 'x']], { x: 0.5, y: 0.3 }],
    ['a real call first', ['Power', 'w', 2], ['Add', ['f', 'x'], ['Arg', ['f', IY]]], { x: 0.5, y: 0.3 }],
    ['a radical, real and complex calls', ['Sqrt', 'w'], ['Add', ['f', 'x'], ['f', IY]], { x: 2, y: 0.3 }],
    ['a logarithm, complex and real calls', ['Ln', 'w'], ['Add', ['f', IY], ['f', 'x']], { x: 2, y: 0.5 }],
    ['a complex call only', ['Multiply', 'w', ['Exp', 'w']], ['f', IY], { x: 0.25, y: -1.5 }],
    ['a call of a call', ['Add', ['Power', 'w', 2], 1], ['f', ['f', IY]], { x: 0.5, y: 0.3 }],
    ['a declared parameter number', ['Power', 'w', 3], ['Add', ['Arg', ['f', IY]], ['f', 'x']], { x: 0.5, y: 0.3 }, '(number) -> number'],
    ['two parameters of two lanes', ['Add', ['Multiply', 'a', 'b'], 'a'], ['Add', ['f', IY, 'x'], ['f', 'x', IY], ['f', 'x', 'x']], { x: 0.5, y: 0.3 }, 'function', ['a', 'b']],
  ])('%s', (_, body, json, at, decl = 'function', params = ['w']) => {
    const ce = engine(body, decl, params);
    expectClose(run(ce, json, at, COMPLEX), interpret(ce, json, at));
    // The strict mode (the default) declines a complex value at a parameter
    // of no stated type (`compile-mode-strict.test.ts`).
    expect(failure(() => run(ce, json, at))).toMatch(/an argument of f that is not real/);
  });

  // The real call of a negative real: the interpreter's value is complex,
  // which the function of a real parameter gives in `mode: 'complex'`.
  // prettier-ignore
  test.each<[string, Json, Json, Record<string, number>]>([
    ['a radical of a negative real and of a complex', ['Sqrt', 'w'], ['Add', ['f', 'x'], ['f', IY]], { x: -1, y: 0.3 }],
    ['a logarithm of a complex and of a negative real', ['Ln', 'w'], ['Add', ['f', IY], ['f', 'x']], { x: -2, y: 0.5 }],
  ])('%s, in mode complex', (_, body, json, at) => {
    const ce = engine(body);
    expectClose(run(ce, json, at, COMPLEX), interpret(ce, json, at));
  });

  // A recursive function with no declared result has a real result
  // (`UserFunction.guess`): the function of a complex parameter, whose
  // body is complex, declines, as a complex body of a recursive function
  // declined before.
  test('a recursive call with a complex argument declines', () => {
    const ce = engine(
      [
        'If',
        ['LessEqual', 'n', 0],
        'w',
        ['f', ['Multiply', 'ImaginaryUnit', 'w'], ['Subtract', 'n', 1]],
      ],
      'function',
      ['w', 'n']
    );
    expect(failure(() => run(ce, ['f', 'x', 2], { x: 0.5 }, COMPLEX))).toMatch(
      /a recursive call of f, which has no declared result type/
    );
  });

  test('an integer argument is a real', () => {
    const ce = engine(['Sqrt', 'w']);
    const json = ['Add', ['f', 3], ['f', IY]];
    const at = { x: 0.5, y: 0.3 };
    expectClose(run(ce, json, at, COMPLEX), interpret(ce, json, at));
  });

  test('the witness compiles on GLSL', () => {
    const ce = engine(['Power', 'w', 2]);
    const r = compile(
      ce.box(['Add', ['Arg', ['f', IY]], ['f', 'x']] as never),
      {
        to: 'glsl',
        fallback: false,
        mode: 'complex',
        inputs: { x: 'real', y: 'real' },
      } as never
    );
    expect(r.success).toBe(true);
  });

  test('a declared real parameter still declines a complex argument', () => {
    const ce = engine(['Power', 'w', 2], '(real) -> real');
    expect(
      failure(() => run(ce, ['Arg', ['f', IY]], { x: 0.5, y: 0.3 }, COMPLEX))
    ).toMatch(/an argument of f that is not real/);
  });

  test('a recursive call back to a lane still being lowered declines', () => {
    // The real lane of `f` calls its complex lane, which calls the real
    // lane again, whose inputs are not settled yet.
    const I = 'ImaginaryUnit';
    const ce = engine(
      [
        'If',
        ['Greater', 'n', 0],
        [
          'Add',
          ['Real', ['f', ['Multiply', I, 'w'], ['Subtract', 'n', 1]]],
          ['f', ['Real', 'w'], ['Subtract', 'n', 1]],
        ],
        ['Add', ['Real', 'w'], 'x'],
      ],
      '(number, number) -> real',
      ['w', 'n']
    );
    expect(
      failure(() => run(ce, ['f', 1, 2], { x: 0.5, y: 0 }, COMPLEX))
    ).toMatch(/a recursive call of f between the lanes of its parameters/);
  });
});

describe('a parameter of no stated type on the real lane', () => {
  // A real argument where the interpreter's value is complex: the radical,
  // the logarithm, a power of 1/2 and the inverse sine of a negative real
  // (or of 2). In `mode: 'complex'` the function of a real parameter gives
  // the complex value; in the default mode it gives NaN, as the operator
  // applied to the real input directly (`docs/COMPILATION-MODEL.md`).
  // prettier-ignore
  test.each<[string, Json, number]>([
    ['Sqrt', ['Sqrt', 'w'], -1],
    ['Ln', ['Ln', 'w'], -1],
    ['Power of 0.5', ['Power', 'w', 0.5], -1],
    ['Arcsin', ['Arcsin', 'w'], 2],
  ])('%s', (_, body, x) => {
    const ce = engine(body);
    const at = { x };
    expectClose(run(ce, ['f', 'x'], at, COMPLEX), interpret(ce, ['f', 'x'], at));
    const direct = (body as Json[]).map((a) => (a === 'w' ? 'x' : a));
    expect(run(ce, ['f', 'x'], at).re).toBeNaN();
    expect(run(ce, direct, at).re).toBeNaN();
  });

  test('Re of a radical of a negative real', () => {
    const ce = engine(['Sqrt', 'w']);
    const json = ['Real', ['f', 'x']];
    expectClose(
      run(ce, json, { x: -1 }, COMPLEX),
      interpret(ce, json, { x: -1 })
    );
  });
});
