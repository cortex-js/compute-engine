/**
 * An outer variable whose value is the empty list compiles on JavaScript
 * (CE-1808; `compilation/ir/README.md`, "Lists"). The value of a free name
 * is lowered as a literal, and `List()` has no type of its own: it takes the
 * lane of its place in the type of the name (`placeEmptyLists()` of
 * `lower.ts`), and it is a build of no element. A list of no stated element
 * type takes the integer lane. GLSL and the interval mode decline, as they
 * do for every list of a run-time length.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

type Target = 'javascript' | 'glsl' | 'interval-js';

/** An engine in which `source` ran: the outer variables and the function
 *  `f` of `t: real`. */
function engine(source: string) {
  const ce = new ComputeEngine();
  const errors = executeEpsil(ce, source).diagnostics.filter(
    (d) => d.severity === 'error'
  );
  if (errors.length > 0)
    throw new Error(`source: ${JSON.stringify(errors[0].message)}`);
  return ce;
}

/** `f(t)` compiled to `to`, or the message of its decline. */
function compileTo(
  ce: ComputeEngine,
  to: Target = 'javascript'
): { ok: true; result: any } | { ok: false; message: string } {
  try {
    const result: any = compile(ce.box(['f', 't']) as any, {
      to,
      fallback: false,
    } as any);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** The value of the interpreter for `f(t)`, as the value that the compiled
 *  code gives: a number (NaN for a value that is not a number) or an array
 *  of them. */
function interpreted(ce: ComputeEngine, t: number): unknown {
  const v = ce.box(['f', t]).evaluate();
  const json = v.json;
  if (Array.isArray(json) && json[0] === 'List') return json.slice(1);
  return v.re;
}

/** `f` of `source` compiles on JavaScript and gives the interpreter's value
 *  at each `t`. */
function expectAgrees(source: string, ts: number[] = [2, -0.5]) {
  const ce = engine(source);
  const r = compileTo(ce);
  if (!r.ok) throw new Error(r.message);
  for (const t of ts) expect(r.result.run({ t })).toEqual(interpreted(ce, t));
}

describe('an outer variable whose value is the empty list', () => {
  test.each([
    // The three cases of the issue.
    'let x: list<string> = []\nfunction f(t: real) { length(x) + t }',
    'let fig = ("circle", [])\nfunction f(t: real) { length(fig[2]) + t }',
    'let pts = []\nfunction f(t: real) { length(pts) + t }',
    // Each lane of a stated element type.
    'let x: list<real> = []\nfunction f(t: real) { sum(x) + t }',
    'let x: list<integer> = []\nfunction f(t: real) { product(x) + t }',
    'let x: list<boolean> = []\nfunction f(t: real) { length(x) + t }',
    // A reduction and an element read with no value: NaN.
    'let x: list<real> = []\nfunction f(t: real) { max(x) + t }',
    'let x: list<real> = []\nfunction f(t: real) { x[1] + t }',
    'let x: list<real> = []\nfunction f(t: real) { mean(x) + t }',
    // A list made from the empty one.
    'let x: list<real> = []\nfunction f(t: real) { [...x, t] }',
    'let pts = []\nfunction f(t: real) { [...pts, t] }',
    'let x: list<real> = []\nfunction f(t: real) { if t > 0 { x } else { [t, t] } }',
    // The empty list as the result of the function.
    'let x: list<real> = []\nfunction f(t: real) { x }',
    // A string read of each element (none).
    'let x: list<string> = []\nfunction f(t: real) { sum([length(s) for s in x]) + t }',
    // A name whose value is the value of another name.
    'let x: list<string> = []\nlet y = x\nfunction f(t: real) { length(y) + t }',
  ])('%s', (source) => expectAgrees(source));

  test('two empty lists of two element types in one function', () => {
    // The memo of the lowering has no entry for a placed `List()`: each
    // one is of the lane of its own place.
    expectAgrees(
      'let x: list<string> = []\nlet y: list<real> = []\nfunction f(t: real) { length(x) + length(y) + sum(y) + t }'
    );
    expectAgrees(
      'let a = ("circle", [])\nlet y: list<real> = []\nfunction f(t: real) { length(a[2]) + sum(y) + t }'
    );
  });

  test('a root function literal reads the variable (a timer callback)', () => {
    const ce = engine('let x: list<string> = []');
    const f = executeEpsil(ce, '(t: real) => length(x) + t').value!;
    const result: any = compile(f as any, {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(result.run(2)).toBe(2);
  });
});

describe('a record with a field that is the empty list', () => {
  const FIG = 'type Fig = tuple<kind: string, xs: list<real>>\n';

  test.each([
    // The field read where the record is made.
    'let fig = Fig("circle", [])\nfunction f(t: real) { length(fig.xs) + t }',
    'type Figure = tuple<kind: string, bad: list<string>>\nlet fig = Figure("circle", [])\nfunction f(t: real) { length(fig.bad) + t }',
    // The field read in another function: the read is the empty list of
    // the lane of the field, since no value has a stated length of 0.
    'let fig = Fig("circle", [])\nfunction g(r: Fig) { sum(r.xs) }\nfunction f(t: real) { g(fig) + t }',
    'let fig = Fig("circle", [])\nfunction g(r: Fig) { length(r.xs) }\nfunction f(t: real) { g(fig) + t }',
    'let fig = Fig("circle", [])\nfunction g(r: Fig) { max(r.xs) }\nfunction f(t: real) { g(fig) + t }',
    'let fig = Fig("circle", [])\nfunction g(r: Fig, k: integer) { r.xs[k] }\nfunction f(t: real) { g(fig, 1) + t }',
    'let fig = Fig("circle", [])\nfunction g(r: Fig, t: real) { [...r.xs, t] }\nfunction f(t: real) { g(fig, t) }',
    // The function returns the empty list.
    'let fig = Fig("circle", [])\nfunction g(r: Fig) { r.xs }\nfunction f(t: real) { g(fig) }',
  ])('%s', (source) => expectAgrees(FIG + source));

  test('the record as the result of the program', () => {
    const ce = engine(
      `${FIG}let fig = Fig("circle", [])\nfunction g(r: Fig) { r }\nfunction f(t: real) { g(fig) }`
    );
    const r = compileTo(ce);
    if (!r.ok) throw new Error(r.message);
    expect(r.result.run({ t: 2 })).toEqual({ kind: 'circle', xs: [] });
  });
});

describe('what still declines', () => {
  /** `f` of `source` declines on `to` with a message that matches
   *  `reason`. */
  function expectDeclines(
    source: string,
    reason: RegExp,
    to: Target = 'javascript'
  ) {
    const r = compileTo(engine(source), to);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(reason);
  }

  test('an empty list of points, and one at a union type', () => {
    expectDeclines(
      'let x: list<tuple<real, real>> = []\nfunction f(t: real) { length(x) + t }',
      /an empty list/
    );
    expectDeclines(
      'type Figure = tuple<kind: string, bad: list<string> | nothing>\nlet fig = Figure("circle", [])\nfunction f(t: real) { length(fig.bad) + t }',
      /an empty list/
    );
  });

  test('an empty list of no stated type beside strings or points', () => {
    // The integer lane does not join the lane of the other operand: a
    // decline, never a value of another lane.
    expectDeclines(
      'let pts = []\nfunction f(t: real) { [...pts, "a"] }',
      /arms of two types/
    );
    expectDeclines(
      'let pts = []\nfunction f(t: real) { [...pts, (t, t)] }',
      /arms of two types/
    );
  });

  test('an empty list of lists at a position of a tuple', () => {
    expectDeclines(
      'let fig: tuple<string, list<list<real^2>>> = ("a", [])\nfunction f(t: real) { length(fig[2]) + t }',
      /an empty list/
    );
  });

  test('`ListFrom` of the arguments of a rest parameter', () => {
    // The record of the arguments has a field of the stated length 0, which
    // no value has.
    expectDeclines(
      'let x: list<real> = []\nfunction c(...args) { listFrom(args)[1] }\nfunction f(t: real) { c(t, x) + t }',
      /ListFrom of arguments with an empty list/
    );
  });

  test('`List()` written in the function, as an argument', () => {
    expectDeclines(
      'function g(xs: list<real>) { length(xs) }\nfunction f(t: real) { g([]) + t }',
      /an empty list/
    );
  });

  test.each(['glsl', 'interval-js'] as const)('%s', (to) => {
    const r = compileTo(
      engine('let x: list<real> = []\nfunction f(t: real) { sum(x) + t }'),
      to
    );
    expect(r.ok).toBe(false);
  });
});
