/**
 * A call of a user function that reads an input, made where a local or the
 * index of a binder has the name of that input (CE-1479), or a parameter
 * of the function whose body has the call (CE-1502): the body reads the
 * binding of its own scope, the input, and the call passes the input, not
 * the local or the parameter (README of `src/compute-engine/compilation/ir/`,
 * "User functions"). A local function whose body reads the index declines.
 *
 * Each value is checked against the interpreter, which reads the inputs as
 * the values assigned to `x` and `y` in a separate engine (`subs()` does
 * not reach the body of a called function).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

type Json = unknown;

const X = 10;
const Y = 2;

/** An engine with `x, y: real` and the functions of the cases. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  const fn = (name: string, body: Json, ...params: string[]) =>
    ce.assign(name, ce.box(['Function', body, ...params] as never));
  // `k` reads the input `x`.
  fn('k', ['Add', 'v', 'x'], 'v');
  // `g` calls `k` in a `Sum` whose index is `x`.
  fn('g', ['Sum', ['Add', 't', ['k', 1]], ['Limits', 'x', 1, 3]], 't');
  // `m` calls `k`: it reads the input through `k`.
  fn('m', ['Multiply', 2, ['k', 'w']], 'w');
  // `h` calls `k` where its parameter is `x`.
  fn('h', ['k', 'x'], 'x');
  // The witness of CE-1502: `u` calls `k` where its parameter is `x`.
  // prettier-ignore
  fn('u', ['Add', ['Power', ['k', 0], 2], ['Power', 'y', 2]], 'x', 'y');
  // `n` calls `h` where its parameter is `x`: three bodies of a parameter
  // `x` (n, h) or a read of the input (k).
  fn('n', ['Multiply', 'x', ['h', 'x']], 'x');
  // `r` calls `k` where its parameter is `x`, and itself.
  // prettier-ignore
  fn('r', ['If', ['LessEqual', 'x', 0], ['k', 0], ['r', ['Subtract', 'x', 1]]], 'x');
  // `w` reads its parameter `x` and calls `k`.
  fn('w', ['Add', 'x', ['k', 0]], 'x');
  // `d` calls `k` twice where its parameter is `x`.
  fn('d', ['Add', ['k', 'x'], ['k', 1]], 'x');
  // `b` calls `k` in a `Sum` of its body whose index is `x` (a block
  // local `x` would declare the parameter again).
  // prettier-ignore
  fn('b', ['Add', 'x', ['Sum', ['Add', 'x', ['k', 0]], ['Limits', 'x', 1, 3]]], 'x');
  // `q` calls a local function whose body reads the parameter `x` of `q`.
  // prettier-ignore
  fn('q', ['Block', ['DefineFunction', 'p', ['Function', ['Add', 'v', 'x'], 'v']], ['p', 0]], 'x');
  return ce;
}

/** The interpreter's value of `json` with the inputs `x` at `X` and `y` at
 *  `Y`. */
function interpret(json: Json): number {
  const ce = engine();
  ce.assign('x', X);
  ce.assign('y', Y);
  return ce
    .box(json as never)
    .evaluate()
    .N().re;
}

/** The compiled value of `json` on `to` at `x = X`, `y = Y`, with
 *  `fallback: false`. */
function run(json: Json, to: 'javascript' | 'interval-js'): number {
  const r = compile(engine().box(json as never), {
    to,
    fallback: false,
    inputs: { x: 'real', y: 'real' },
  } as never) as { success: boolean; run: (a: object) => unknown };
  expect(r.success).toBe(true);
  if (to === 'javascript') return r.run({ x: X, y: Y }) as number;
  const v = r.run({ x: { lo: X, hi: X }, y: { lo: Y, hi: Y } }) as {
    value: { lo: number; hi: number };
  };
  expect(v.value.lo).toBe(v.value.hi);
  return v.value.lo;
}

/** The message of the decline of `json` on `to`. */
function declined(json: Json, to = 'javascript'): string {
  try {
    compile(engine().box(json as never), {
      to,
      fallback: false,
      inputs: { x: 'real', y: 'real' },
    } as never);
  } catch (e) {
    return (e as Error).message;
  }
  return 'compiled';
}

const SUM = (body: Json) => ['Sum', body, ['Limits', 'x', 1, 3]];

describe('a call that reads an input under a local of its name', () => {
  // prettier-ignore
  const cases: [string, Json, number][] = [
    // The witness of CE-1479: (1 + 2 + 3) + 3·(1 + 10).
    ['the witness', SUM(['Add', 'x', ['k', 1]]), 39],
    ['the index as the argument', SUM(['k', 'x']), 36],
    ['through another function', SUM(['m', 'x']), 72],
    ['in a function body', ['g', 5], 48],
    ['a call outside the Sum first', ['Add', ['k', 0], SUM(['k', 'x'])], 46],
    ['a call outside the Sum last', ['Add', SUM(['k', 'x']), ['k', 0]], 46],
    ['nested sums', SUM(['Sum', ['Add', ['k', 'x'], 'y'], ['Limits', 'y', 1, 2]]), 81],
    ['a block local', ['Block', ['Declare', 'x', 'real', 2], ['Add', 'x', ['k', 1]]], 13],
  ];
  test.each(cases)('%s', (_, json, value) => {
    expect(interpret(json)).toBe(value);
    expect(run(json, 'javascript')).toBe(value);
    expect(run(json, 'interval-js')).toBe(value);
  });

  test('the witness compiles on GLSL, the call reading the input', () => {
    const r = compile(engine().box(SUM(['Add', 'x', ['k', 1]]) as never), {
      to: 'glsl',
      fallback: false,
      inputs: { x: 'real' },
    } as never) as { success: boolean; code: string };
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/\(1\.0 \+ x\)/);
  });

  test('declined: a local function whose body reads the index', () => {
    // The body of `q` reads the index of the `Sum`, not the input.
    const json = SUM([
      'Block',
      ['DefineFunction', 'q', ['Function', ['Add', 'v', 'x'], 'v']],
      ['q', 1],
    ]);
    expect(interpret(json)).toBe(9);
    // It declines before the scope check, as a local definition.
    expect(declined(json)).toMatch(
      /a function definition that is not the binding of its calls/
    );
  });
});

describe('a call that reads an input under a parameter of its name', () => {
  // prettier-ignore
  const cases: [string, Json, number][] = [
    // The witness of CE-1502: (0 + 10)^2 + 2^2, not (0 + x)^2 + y^2 at the
    // arguments.
    ['the witness', ['u', 'x', 'y'], 104],
    ['other arguments', ['u', 3, 1], 101],
    ['the parameter as the argument', ['h', 2], 12],
    ['the parameter read in the body', ['w', 2], 12],
    ['two calls', ['d', 2], 23],
    ['through another function with the parameter', ['n', 2], 24],
    ['a recursive function', ['r', 3], 10],
    ['a Sum index in the body', ['b', 2], 38],
    ['in a Sum whose index is x', SUM(['h', 'x']), 36],
    ['beside a direct call', ['Add', ['k', 1], ['u', 'x', 'y']], 115],
  ];
  test.each(cases)('%s', (_, json, value) => {
    expect(interpret(json)).toBe(value);
    expect(run(json, 'javascript')).toBe(value);
    expect(run(json, 'interval-js')).toBe(value);
  });

  test('the witness compiles on GLSL, the call reading the input', () => {
    const r = compile(engine().box(['u', 'x', 'y'] as never), {
      to: 'glsl',
      fallback: false,
      inputs: { x: 'real', y: 'real' },
    } as never) as { success: boolean; code: string };
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/\bx\b/);
  });

  test('declined: a local function whose body reads the parameter', () => {
    // The body of `p` reads the parameter `x` of `q`, not the input.
    expect(interpret(['q', 2])).toBe(2);
    expect(declined(['q', 2])).not.toBe('compiled');
  });
});
