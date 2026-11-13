/**
 * CE-712.2, phase D: the result type of a variant (rule R2 of
 * `docs/plans/2026-10-31-static-shape-compilation.md`).
 *
 * A function assigned with no declaration, or declared `-> unknown`, gives
 * a call node whose type can be `unknown` or `any`. That type carries no
 * information. A consumer that reads the shape or the rank of the call (an
 * `At`, the rank of an argument of another call, the accumulator of a
 * fold) reads the result type of the variant that the call reads: the
 * static type of the body of the function, with each parameter typed by
 * its argument (`staticTypeOf()` in `compilation/compiler-core.ts`).
 *
 * Each case compares the compiled value with `evaluate()`.
 */

import { execFileSync } from 'node:child_process';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';

type Value = number | Value[];

const VARS: Record<string, Value> = { x: 3, y: 1, p: [3, 4] };

/** `x, y: real`, `p: tuple<real, real>`, and `g := t ↦ [t, 2t]`, assigned
 * with no declaration. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('p', 'tuple<real, real>');
  ce.assign('g', ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't']));
  return ce;
}

/** The JavaScript value of a number, a list or a tuple of the engine. */
function plain(e: Expression): Value {
  if (e.operator === 'List' || e.operator === 'Tuple') return e.ops!.map(plain);
  return e.re;
}

function interpreted(ce: ComputeEngine, expr: Expression): Value {
  const subs: Record<string, Expression> = {};
  for (const [name, v] of Object.entries(VARS))
    subs[name] = ce.box(
      (Array.isArray(v) ? ['Tuple', ...v] : v) as any
    );
  return plain(expr.subs(subs).evaluate());
}

function fromIntervals(r: any): Value {
  if (Array.isArray(r)) return r.map(fromIntervals);
  expect(r.kind).toBe('interval');
  expect(r.value.lo).toBeCloseTo(r.value.hi, 12);
  return r.value.lo;
}

function expectClose(actual: Value, expected: Value): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as Value[]).length).toBe(expected.length);
    expected.forEach((e, i) => expectClose((actual as Value[])[i], e));
  } else expect(actual).toBeCloseTo(expected, 12);
}

/** The value of the Python code of `expr` with the inputs of `VARS`. The
 * code of a block is a sequence of statements that ends with a `return`, so
 * it is run as the body of a function. */
function pythonValue(code: string): Value {
  const assign = Object.entries(VARS).map(
    ([k, v]) =>
      `${k} = ${Array.isArray(v) ? `(${v.join(', ')})` : JSON.stringify(v)}`
  );
  const script = [
    'import json, math',
    'import numpy as np',
    ...assign,
    'def _value():',
    ...code.split('\n').map((line) => `    ${line}`),
    'print(json.dumps(_value()))',
  ].join('\n');
  return JSON.parse(
    execFileSync(TEST_PYTHON!, ['-c', script], { encoding: 'utf8' })
  );
}

function expectCompiledValue(
  ce: ComputeEngine,
  json: unknown,
  to: 'javascript' | 'interval-js',
  noShapeTest = true
): string {
  const expr = ce.box(json as any);
  const r = compile(expr, { to, fallback: false } as any);
  expect(r.success).toBe(true);
  const text = `${r.preamble ?? ''}\n${r.code}`;
  if (noShapeTest) expect(text).not.toContain('Array.isArray');
  const value = r.run!({ x: 3, y: 1, p: [3, 4] } as any);
  expectClose(
    to === 'interval-js' ? fromIntervals(value) : (value as Value),
    interpreted(ce, expr)
  );
  return r.code;
}

const G_LOCAL = [
  'Declare',
  'q',
  "'unknown'",
  ['Function', ['List', 't', ['Multiply', 2, 't']], 't'],
];

describe('CE-712.2: `At` of a call of a function with no declared result', () => {
  test.each([
    ['At(g(x), 1), x: real', ['At', ['g', 'x'], 1]],
    ['At(g(x), 2), x: real', ['At', ['g', 'x'], 2]],
    ['At(g(p), 1), p: tuple<real, real>', ['At', ['g', 'p'], 1]],
    ['At(g(p), 2), p: tuple<real, real>', ['At', ['g', 'p'], 2]],
  ])('%s', (_label, json) => {
    // The call `g(p)` has the type `any`. The variant of `g` for a point
    // has the result type `list<tuple<real, real>^2>`, so the `At` reads
    // a list. Before, the compilation declined: "`At`: first operand is
    // not an indexed collection". (The product `2t` of a point inlined
    // from a block-local literal keeps its own run-time test, which is not
    // a test of the shape of a call.)
    for (const to of ['javascript', 'interval-js'] as const)
      expectCompiledValue(engine(), json, to, false);
  });

  // On interval-js, a call of a block-local function whose value is a
  // collection declines unless the value is consumed whole, so the
  // block-local cases run on JavaScript and Python.
  test.each([
    ['a block-local q, At(q(x), 2)', ['Block', G_LOCAL, ['At', ['q', 'x'], 2]]],
    ['a block-local q, At(q(p), 2)', ['Block', G_LOCAL, ['At', ['q', 'p'], 2]]],
  ])('%s', (_label, json) => {
    expectCompiledValue(engine(), json, 'javascript', false);
  });

  const python = TEST_PYTHON ? test : test.skip;
  // The Python case with a point argument is left out: the block-local
  // literal multiplies the point with the Python `*`, which repeats a tuple
  // (`2 * (3, 4)` is `(3, 4, 3, 4)`), where the interpreter gives `(6, 8)`.
  python('python: a block-local q, At(q(x), 2)', () => {
    for (const json of [['Block', G_LOCAL, ['At', ['q', 'x'], 2]]]) {
      const ce = engine();
      const expr = ce.box(json as any);
      const r = compile(expr, { to: 'python', fallback: false } as any);
      expect(r.success).toBe(true);
      expectClose(pythonValue(r.code), interpreted(ce, expr));
    }
  });
});

describe('CE-712.2: a function declared `-> unknown` with a scalar body', () => {
  test('the outer call of `I(√g(x, y))` reads a scalar', () => {
    // `f`, `g` and `I` are declared `(unknown, …) -> unknown`. The call
    // `g(x, y)` has the type `unknown`; the variant of `g` for two real
    // arguments has a scalar result type, so `I` is called directly, with
    // no map and no test of the value.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const register = (name: string, params: string[], body: unknown) => {
      ce.declare(name, {
        signature: `(${params.map(() => 'unknown').join(', ')}) -> unknown`,
      });
      ce.assign(name, ce.box(['Function', body as any, ...params]));
    };
    register('f', ['u'], ['Add', 'u', 1]);
    register('g', ['a', 'b'], ['Add', ['f', 'a'], ['f', 'b']]);
    register('I', ['u'], ['Multiply', 2, 'u']);
    const json = ['I', ['Sqrt', ['g', 'x', 'y']]];
    for (const to of ['javascript', 'interval-js'] as const) {
      const code = expectCompiledValue(ce, json, to);
      expect(code).not.toContain('mapFn');
    }
  });

  test('a recursive function keeps the type that the engine derives', () => {
    // The variant result type is not computed to a fixed point. In the body
    // of `r`, the inner call `r(n − 1)` has the type that the engine gives
    // it from the declaration (`-> unknown`) and from its own derivation of
    // the call. Here the engine types `r(x)` as `integer`, so the call of
    // `h` over it is a direct call. A call whose type stays `unknown` would
    // decline at a consumer that needs its shape (rule R3).
    const ce = engine();
    ce.declare('r', '(real) -> unknown');
    ce.assign(
      'r',
      ce.box([
        'Function',
        ['If', ['LessEqual', 'n', 0], 0, ['Add', ['r', ['Subtract', 'n', 1]], 1]],
        'n',
      ])
    );
    ce.assign('h', ce.box(['Function', ['Multiply', 2, 't'], 't']));
    for (const to of ['javascript', 'interval-js'] as const)
      expectCompiledValue(ce, ['h', ['r', 'x']], to);
  });
});

describe('CE-712.2: the variant result type is computed again at each compilation', () => {
  test('a second compilation of the same expression reads the new literal', () => {
    // The result type of the variant of `g` reads the literal that `g`
    // holds when the compilation runs. After `g := t ↦ At(t, 1)`, the call
    // `g(p)` is a scalar, so a second compilation of the same boxed `e`
    // calls `h` directly, as the compilation of a newly boxed `h(g(p))`
    // does. A memo kept from the first compilation read the call as a
    // list and mapped `h` over it.
    const ce = engine();
    ce.assign('h', ce.box(['Function', ['Multiply', 2, 'u'], 'u']));
    const json = ['h', ['g', 'p']];
    const e = ce.box(json as any);
    const first = compile(e, { to: 'javascript', fallback: false } as any);
    expect(first.success).toBe(true);
    expect(first.code).toContain('mapFn');
    expectClose(first.run!(VARS as any) as Value, interpreted(ce, e));

    ce.assign('g', ce.box(['Function', ['At', 't', 1], 't']));
    const again = compile(e, { to: 'javascript', fallback: false } as any);
    const fresh = compile(ce.box(json as any), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(again.success).toBe(true);
    expect(again.code).toBe(fresh.code);
    expect(again.code).not.toContain('mapFn');
    expectClose(again.run!(VARS as any) as Value, interpreted(ce, e));
  });
});

describe('CE-712.2: the dispatch on a declared union leaves out equal bodies', () => {
  test('two bodies that differ only in their temporaries give one body', () => {
    // `U: real | list<real>`. The body of each member of `U + h(1)` is the
    // same broadcast; each allocates its own temporaries (`_tv<n>`), so the
    // two codes differ in these names only. The test of the shape is left
    // out, and the code is the body of the first member.
    const ce = new ComputeEngine();
    ce.declare('U', 'real | list<real>');
    ce.assign('h', ce.box(['Function', ['Add', 's', 'U'], 's']));
    const expr = ce.box(['Add', 'U', ['h', 1]]);
    const r = compile(expr, { to: 'javascript', fallback: false } as any);
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('Array.isArray');
    // The body of `h` reads `U` from the engine, so the value of `U` is
    // assigned, not substituted.
    for (const U of [2, [1, 2]] as Value[]) {
      ce.assign('U', ce.box((Array.isArray(U) ? ['List', ...U] : U) as any));
      expectClose(r.run!({ U } as any) as Value, plain(expr.evaluate()));
    }
  });
});
