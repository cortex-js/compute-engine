/**
 * The shapes that the figure options of Tycho's drawing prelude meet in
 * compiled JavaScript (`docs/COMPILATION-MODEL.md`, "Records"):
 *
 * - a field declared with a union type (`string | color | nothing`) is
 *   opaque: a record that holds `Nothing` there and one that holds a string
 *   are one type, so a local, a loop and an `if` can hold either; the code
 *   only copies such a field;
 * - `N` of `Nothing` and of a dictionary literal, `Nothing` as the argument
 *   of a user function;
 * - a comparison of a length that the IR type states, decided when the code
 *   is emitted, as a test of a type;
 * - a list of strings read from a record field;
 * - `x is T` of a record, a list of records, a dictionary, and a field that
 *   holds a list;
 * - a key of a dictionary literal in its `keys`;
 * - a list of records as the result of a function of no stated result type.
 *
 * Each program is compiled and run, and its value is compared with the
 * interpreter's.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

const PRELUDE = `
type F = tuple<kind: string, fill: string | color | nothing, alpha: real | nothing, dash: list<real> | nothing, bad: list<string>>
function setFill(f: F) -> F { F(f.kind, "red", f.alpha, f.dash, f.bad) }
function plain(kind: string) { F(kind, nothing, nothing, nothing, []) }
function option(f: F, k: string, v: any) -> F {
  let bad = filter(f.bad, (s: string) => s != k)
  if k == "fill" && (v is nothing || v is string) {
    F(f.kind, N(v), f.alpha, f.dash, bad)
  } else if k == "alpha" && (v is nothing || v is real) {
    F(f.kind, f.fill, N(v, 15), f.dash, bad)
  } else {
    F(f.kind, f.fill, f.alpha, f.dash, [...bad, k])
  }
}
function styled(f: F, opts: dictionary) -> F {
  let out: F = f
  for k in keys(opts) { out = option(out, k, opts[k]) }
  out
}
function pick(c: boolean) -> F {
  let out = plain("a")
  if c { out = F("a", "red", 0.5, nothing, []) }
  out
}
function box(g: list) { if length(g) < 2 { nothing } else { (g[1], g[2]) } }
function isFig(x: any) -> real { if x is F { 1 } else { 2 } }
type G = tuple<v: real | string, w: real>
function mk(c: boolean) -> G { let o = G(1, 0); if c { o = G("x", 0) }; o }
function cpG(g: G) -> G { G(g.v, g.w + 1) }
function ga(c: boolean) -> G { let o = G(1, 0); if c { o = G("x", 0) }; o }
function gz(c: boolean) -> G { let o = G("x", 0); if c { o = G(1, 0) }; o }
function cp4(g: G) -> real { let a = G(g.v, 1); let b = [a, G(g.v, 2)]; if g.v == 1 { a.w + 10 } else { a.w + 20 } }
function cp5(g: G) { (G(g.v, 1), g.v) }
function cp8(r: G) -> real { let s = G(r.v, 1); if s.v is string { 1 } else { 2 } }
function hr(v: any) -> real { if v is real { 1 } else { 2 } }
function lk(opts: dictionary = {->}) -> real { hr(opts["n"]) }
function isDict(x: any) -> real { if x is dictionary { 1 } else { 2 } }
function lastIsDict(parts: list) -> real { if last(parts) is dictionary { 1 } else { 2 } }
function contentOf(figs: any, opts: any) {
  if !("content" in keys(opts)) { figs } else if opts["content"] is nothing { [] } else { opts["content"] }
}
`;

/** The leaves of the interpreter's MathJSON, in order: a function's head
 *  dropped, `Nothing` as `null`, a string unquoted. */
function leavesOfJson(j: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(j)) for (const x of j.slice(1)) leavesOfJson(x, out);
  else if (j !== null && typeof j === 'object' && 'num' in j)
    out.push(Number((j as { num: string }).num));
  else if (j !== null && typeof j === 'object' && 'dict' in j)
    for (const x of Object.values((j as { dict: object }).dict))
      leavesOfJson(x, out);
  else if (typeof j === 'string')
    out.push(
      j === 'Nothing'
        ? null
        : j === 'True'
          ? true
          : j === 'False'
            ? false
            : j.replace(/^'(.*)'$/s, '$1')
    );
  else out.push(j);
  return out;
}

/** The leaves of a value of `run()`: an array's elements, an object's
 *  fields. */
function leavesOfRun(v: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) for (const x of v) leavesOfRun(x, out);
  else if (v !== null && typeof v === 'object')
    for (const x of Object.values(v)) leavesOfRun(x, out);
  else out.push(v === undefined ? null : v);
  return out;
}

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

/** The program compiles, and its value has the interpreter's leaves. */
function same(program: string, t = 3) {
  const r = run(program, t);
  expect(r.error).toBeUndefined();
  expect(leavesOfRun(r.compiled)).toEqual(leavesOfJson(r.expected));
}

describe('a field declared with a union type is opaque', () => {
  test('a local replaced in a loop with records whose union fields differ', () => {
    same('styled(plain("c"), {fill -> "red", alpha -> t / 4})');
  });
  test('an option that sets nothing, and an unknown key', () => {
    same('styled(plain("c"), {fill -> nothing, foo -> 1})');
  });
  test('the arms of an if hold records whose union fields differ', () => {
    same('pick(t > 2)');
    same('pick(t > 4)');
  });
  test('a read of an opaque field other than a copy declines', () => {
    expect(run('styled(plain("c"), {fill -> "red"}).fill').error).toMatch(
      /a read of the field fill of F, of a union type/
    );
  });
  test('a copy of a field that holds a list in one arm and nothing in the other', () => {
    same(
      'setFill(if t > 2 { F("c", nothing, nothing, [t, 2], []) } else { plain("c") })'
    );
    same(
      'setFill(if t > 4 { F("c", nothing, nothing, [t, 2], []) } else { plain("c") })'
    );
  });
  test('copies of records whose union field was joined from arms in either order', () => {
    same('(cpG(ga(t > 4)), cpG(gz(t > 4)))');
    same('(cpG(ga(t > 2)), cpG(gz(t > 2)))');
    same(
      'do { let s = 0; for i in 1..2 { s = s + cpG(ga(t > 2)).w + cpG(gz(t > 2)).w }; s }'
    );
  });
  test('a read after a copy declines, whatever the order of the reads', () => {
    // The interpreter gives 14, 1 and 5 at t = 3: the copy into `G(g.v, 1)`
    // does not make a later read of `g.v`, or of the copy, a value of one
    // type.
    for (const p of [
      'cp4(mk(t > 4)) + t',
      'cp5(mk(t > 4))',
      'cp8(mk(t > 4)) + t',
    ])
      expect(run(p).error).toMatch(
        /a read of the field v of G, of a union type/
      );
  });
  test('a colour at a union field is not opaque: two records decline', () => {
    expect(
      run(
        'if t > 2 { F("a", rgb(t, 0, 0), nothing, nothing, []) } else { plain("a") }'
      ).error
    ).toBeDefined();
  });
});

describe('the tests and values that the options meet', () => {
  test('a comparison of a length that the IR type states', () => {
    same('box([t, 2, 3])');
  });
  test('x is T of a record, of a dictionary, of the last of a list', () => {
    same('isFig(plain("a")) + isDict({a -> t}) + isDict(t) + t');
    same('lastIsDict([plain("a"), plain("b")]) + t');
  });
  test('a key in the keys of a dictionary, and a list field tested for nothing', () => {
    same('contentOf([plain("a")], {grid -> true})');
    same('contentOf([plain("a")], {content -> [plain("b"), plain("c")]})');
  });
  test('N of a dictionary literal of scalars', () => {
    same('N({grid -> true, size -> t}, 15)');
  });
});

describe('CE-1924: a number read from a dictionary literal at a parameter of type any', () => {
  test('of a static type that proves real: x is real is decided', () => {
    same('lk({n -> t / 2}) + t');
    same('lk({n -> 3}) + t');
  });
  test('of a value that the interpreter does not give as a real declines', () => {
    // `sqrt(-2)` is imaginary and `3 / 0` is ComplexInfinity there.
    expect(run('lk({n -> sqrt(t - 5)}) + t').error).toBeDefined();
    expect(run('lk({n -> t / 0}) + t').error).toBeDefined();
    expect(run('lk({n -> t / 2}) + lk({n -> t / 0}) + t').error).toBeDefined();
  });
});
