/**
 * A call of a user function that reads an input, made where a local or the
 * index of a binder has the name of that input (CE-1479): the body reads
 * the binding of its own scope, the input, and the call passes the input,
 * not the local (README of `src/compute-engine/compilation/ir/`, "User
 * functions"). A local function whose body reads the index, and a call
 * where a parameter has the name, decline.
 *
 * Each value is checked against the interpreter, which reads the input as
 * the value assigned to `x` in a separate engine (`subs()` does not reach
 * the body of a called function).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

type Json = unknown;

const X = 10;

/** An engine with `x: real` and the functions of the cases. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
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
  return ce;
}

/** The interpreter's value of `json` with the input `x` at `X`. */
function interpret(json: Json): number {
  const ce = engine();
  ce.assign('x', X);
  return ce
    .box(json as never)
    .evaluate()
    .N().re;
}

/** The compiled value of `json` on `to` at `x = X`, with `fallback: false`. */
function run(json: Json, to: 'javascript' | 'interval-js'): number {
  const r = compile(engine().box(json as never), {
    to,
    fallback: false,
    inputs: { x: 'real' },
  } as never) as { success: boolean; run: (a: object) => unknown };
  expect(r.success).toBe(true);
  if (to === 'javascript') return r.run({ x: X }) as number;
  const v = r.run({ x: { lo: X, hi: X } }) as {
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
      inputs: { x: 'real' },
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

  test('declined: a parameter of the name at the call', () => {
    // The interpreter gives 12 (`k` reads the input); the input is hidden
    // in the body of `h`.
    expect(interpret(['h', 2])).toBe(12);
    expect(declined(['h', 2])).toMatch(
      /a call of k, which reads the input x, where x is a local or a parameter/
    );
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
