/**
 * The shapes of the figure constructors of Tycho's drawing prelude in
 * compiled JavaScript (`docs/COMPILATION-MODEL.md`, "Records"):
 *
 * - CE-1918: an empty list literal at a field of a list type, or as the
 *   value of a local;
 * - CE-1919: a local that holds a record, which later statements replace
 *   with whole values, also in a loop or an `if`;
 * - CE-1920: a loop over the keys of a dictionary literal, unrolled per key,
 *   and a string in a list literal of strings.
 *
 * Each program is compiled and run, and its value is compared with the
 * interpreter's.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

const PRELUDE = `
type T = tuple<kind: string, geom: list<real>, bad: list<string>>
type U = tuple<kind: string, n: real>
type W = tuple<kind: string, xs: list<real>>
type V = tuple<kind: string, fill: any>
function g(v: any) -> real { if v is string { 1 } else { 2 } }
function h(v: any) -> real { if v is integer { 1 } else { 2 } }
function withLocal(f: U) -> U { let out: U = f; for k in 1..2 { out = U(out.kind, out.n + 1) }; out }
function withLocalNoType(f: U) -> U { let out = f; for k in 1..2 { out = U(out.kind, out.n + 1) }; out }
function grow(w: W, m: integer) -> W { let out = w; for k in 1..m { out = W(out.kind, [...out.xs, k]) }; out }
function pick(f: U, c: boolean) -> U { let out = f; if c { out = U("b", 10) }; out }
function count(n: real, opts: dictionary = {->}) -> real {
  let s = n
  for k in keys(opts) { s = s + g(opts[k]) }
  s
}
function skip(n: real, opts: dictionary = {->}) -> real {
  let s = n
  for k in keys(opts) { if !(k in ["range", "smooth"]) { s = s + 10 } }
  s
}
function intTest(opts: dictionary = {->}) -> real { h(opts["n"]) }
`;

function run(
  program: string,
  t = 3
): { compiled?: unknown; error?: string; expected: unknown } {
  const ce = new ComputeEngine();
  const diags = [
    ...executeEpsil(ce, PRELUDE).diagnostics,
    ...executeEpsil(ce, `let frame = (t: real) => ${program}`).diagnostics,
  ].filter((d) => d.severity === 'error');
  if (diags.length > 0) throw new Error(diags.map((d) => d.message).join('; '));
  const expected = ce.expr(['frame', t]).evaluate().json;
  try {
    const r = compile(ce.expr('frame').evaluate(), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    return { compiled: r.run(t), expected };
  } catch (e) {
    return { error: (e as Error).message.split('\n')[0], expected };
  }
}

function same(program: string, t = 3) {
  const r = run(program, t);
  expect(r.error).toBeUndefined();
  expect(r.compiled).toEqual(r.expected);
}

describe('CE-1918: an empty list literal', () => {
  test('at a field of type list<string> of a named tuple', () => {
    same('length(T("c", [t], []).bad) + t');
  });
  test('at a field of type list<real> of a named tuple', () => {
    same('length(T("c", [], ["x"]).geom) + t');
  });
  test('as the value of a local', () => {
    same('do { let b = []; t }');
  });
});

describe('CE-1919: a record local written with whole values', () => {
  test('of a stated type, in a loop', () => {
    same('withLocal(U("c", t)).n');
  });
  test('of no stated type, in a loop', () => {
    same('withLocalNoType(U("c", t)).n');
  });
  test('whose list field changes length in a loop', () => {
    same('length(grow(W("w", [t]), 3).xs)');
    same('grow(W("w", [t]), 3).xs[4]');
  });
  test('in an if, either arm', () => {
    same('pick(U("c", t), t > 2).n', 3);
    same('pick(U("c", t), t > 2).n', 1);
  });
  test('a write of a field declines', () => {
    const r = run('do { let out = U("c", t); out.n = 4; out.n }');
    expect(r.error).toBeDefined();
  });
  test('a write of a record of other field types declines', () => {
    // `fill` is `nothing`, then a string: two shapes of one local (R6).
    const r = run('do { let out = V("c", Nothing); out = V("c", "red"); 0 }');
    expect(r.error).toMatch(/written to a local that holds a record/);
  });
});

describe('CE-1920: a loop over the keys of a dictionary literal', () => {
  test('of the default {->}: no pass', () => {
    same('count(t)');
  });
  test('of a literal: one pass per key, a test of the type of each value', () => {
    same('count(t, {fill -> "red", opacity -> 0.5, width -> 2})');
  });
  test('a key in a list literal of strings', () => {
    same('skip(t, {fill -> "red", smooth -> true, range -> 1})');
  });
  test('a test of a type that the lane does not decide declines', () => {
    expect(run('intTest({n -> t / 2})').error).toMatch(/MatchesType/);
    same('intTest({n -> 3})');
  });
  test('each key is a pass of the iteration budget', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, PRELUDE);
    executeEpsil(ce, 'let frame = (t: real) => count(t, {a -> 1, b -> 2})');
    const at = (budget: number) =>
      compile(ce.expr('frame').evaluate(), {
        to: 'javascript',
        fallback: false,
        iterationBudget: budget,
      } as any) as any;
    expect(() => at(1).run(3)).toThrow(/iteration/);
    expect(at(2).run(3)).toBe(7);
  });
});
