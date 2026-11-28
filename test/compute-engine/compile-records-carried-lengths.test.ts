/**
 * Carried field lengths (stage 2 of
 * `docs/plans/2026-11-27-records-objects-and-held-lengths.md`;
 * `compilation/ir/README.md`, "Records").
 *
 * - A list field of a record whose first-axis length is not a constant has
 *   a carried length (`'carried'` in the field's IR type): the array holds
 *   the length, and a read of the field reads it first (`field.len`,
 *   `r.geom.length`).
 * - Two field types of one lane and one rank whose first-axis lengths
 *   differ join to a carried length (an `if` of two records, a local).
 * - Such a record is a parameter and a result of a user function, a local,
 *   an arm of an `if`, and the `self` of a protocol method.
 * - A parameter of a declared record type (`f: Fig`) takes a `Fig`, and a
 *   nominal tuple type with its own constructor function compiles.
 *
 * Every compiled value is compared with the interpreter's value, with
 * `optimize` on and off.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  isDictionary,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

const PRELUDE = `
  type T = tuple<kind: string, geom: list<real>>
  type Q = tuple<kind: string, pts: list>
  protocol Headed {
    function head(self: Self) -> real
  }
  type H = tuple<kind: string, geom: list<real>> is Headed {
    function head(self: H) -> real { self.geom[1] + length(self.geom) }
  }
  type Fig = record{__tag: string, kind: string, geom: list<real>}
  function Fig(kind: string, g: list<real>) { {__tag -> "Figure", kind -> kind, geom -> g} }
  type Dot = record{__tag: string, kind: string, geom: tuple<real, real>}
  function Dot(kind: string, x: real, y: real) { {__tag -> "Figure", kind -> kind, geom -> (x, y)} }
  type V2 = tuple<x: real, y: real>
  function V2(r: real) { (r, 2 * r) }
  type Tag = tuple<kind: string, geom: list<real>>
  function Tag(g: list<real>) { ("tag", g) }

  function mk(kind: string, g: list<real>) { T(kind, g) }
  function readHere(g: list<real>) { let r = T("a", g); r.geom[1] + length(r.geom) }
  function readThere(r: T) { r.geom[1] + length(r.geom) }
  function sumThere(r: T) { length(r.geom) + sum(r.geom) }
  function viaCall(g: list<real>) { readThere(mk("a", g)) }
  function viaLocal(g: list<real>) { let r = mk("a", g); r.geom[2] * length(r.geom) }
  function taken(n: integer) { sumThere(T("a", take([1, 2, 3, 4], n))) }
  function empty(t: real) { sumThere(T("a", [])) + t }
  function pickG(t: real, g: list<real>) { if t > 1 { T("a", [1, 2]) } else { T("b", g) } }
  function pick23(t: real) { if t > 1 { T("a", [1, 2]) } else { T("b", [1, 2, 3]) } }
  function readPick(t: real, g: list<real>) { readThere(pickG(t, g)) }
  function readPick23(t: real) { let r = pick23(t); r.geom[2] + length(r.geom) }
  function pickM(k: integer, g: list<real>) { match k { 1 => T("a", [1, 2]); _ => T("b", g) } }
  function readM(k: integer, g: list<real>) { readThere(pickM(k, g)) }
  function pickR(c: boolean, t: real) { if c { T("a", [t]) } else { T("b", [t, t]) } }
  function inlined2(t: real) { let s = 0; for i in 1..3 { s = s + length(pickR(true, t).geom) }; s }
  function inlined3(t: real) { pickR(t > 0, t).geom[1] + length(pickR(false, t).geom) }
  function both(t: real) { readThere(T("a", [t, 2])) + readThere(T("b", [t, 2, 3])) }
  function headOf(g: list<real>) { H("h", g).head() }
  function plus(f: T, h: T) { f.geom + h.geom }
  function addTwo(a: list<real>, b: list<real>) { plus(T("a", a), T("b", b)) }
  function pts(g: list<real>) { Q("p", [(x, 2 * x) for x in g]) }
  function readPts(q: Q) { q.pts[1][2] + length(q.pts) }
  function usePts(g: list<real>) { readPts(pts(g)) }
  function matField(t: real) { Q("m", M) }
  function figGeom(f: Fig) { f.geom[1] + length(f.geom) }
  function useFigGeom(g: list<real>) { figGeom(Fig("dot", g)) }
  function dotGeom(f: Dot) { f.geom[1] + f.geom[2] }
  function useDotGeom(t: real) { dotGeom(Dot("dot", t, 0)) }
  function mkV2(t: real) { V2(t) }
  function readV2(t: real) { let v = V2(t); v.x + v.y }
  function rawV2(t: real) { V2(t, 1) }
  function mkTag(g: list<real>) { Tag(g) }
`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'real');
  ce.declare('n', 'integer');
  ce.declare('g', 'list<real>');
  ce.declare('a', 'list<real>');
  ce.declare('b', 'list<real>');
  ce.declare('M', 'matrix<real>');
  const errors = executeEpsil(ce, PRELUDE).diagnostics.filter(
    (d) => d.severity === 'error'
  );
  if (errors.length > 0)
    throw new Error(`prelude: ${JSON.stringify(errors[0].message)}`);
  return ce;
}

const OPTIMIZE = [true, false];

type Inputs = Record<string, number | number[]>;

function compileTo(
  ce: ComputeEngine,
  expr: any,
  optimize: boolean
): { ok: true; result: any } | { ok: false; message: string } {
  try {
    const result: any = compile(ce.box(expr), {
      to: 'javascript',
      fallback: false,
      optimize,
    } as any);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** The field names of the named tuple type of the value `v`. */
function fieldNames(v: Expression): string[] | undefined {
  const t = v.type.type;
  if (typeof t !== 'object' || t.kind !== 'reference') return undefined;
  const elements = t.def?.kind === 'tuple' ? t.def.elements : undefined;
  return elements?.every((x) => x.name !== undefined)
    ? elements.map((x) => x.name!)
    : undefined;
}

/** The JavaScript value that `run()` gives for the interpreter's value
 *  `v`. */
function hostValue(v: Expression): unknown {
  if (isSymbol(v, 'Nothing')) return null;
  if (isString(v)) return v.string;
  if (isNumber(v)) return v.re;
  if (isDictionary(v))
    return Object.fromEntries(v.keys.map((k) => [k, hostValue(v.get(k)!)]));
  if (isFunction(v)) {
    if (v.nops === 1 && isDictionary(v.ops[0])) return hostValue(v.ops[0]);
    const items = v.ops.map(hostValue);
    if (v.operator === 'List' || v.operator === 'Tuple') return items;
    const names = fieldNames(v);
    if (names !== undefined)
      return Object.fromEntries(names.map((n, k) => [n, items[k]]));
  }
  throw new Error(`no host value for ${v.toString()}`);
}

function expectClose(got: unknown, expected: unknown) {
  if (typeof expected === 'number') {
    expect(typeof got).toBe('number');
    expect(Math.abs((got as number) - expected)).toBeLessThanOrEqual(1e-12);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(got)).toBe(true);
    expect((got as unknown[]).length).toBe(expected.length);
    expected.forEach((x, k) => expectClose((got as unknown[])[k], x));
  } else if (expected !== null && typeof expected === 'object') {
    expect(got !== null && typeof got === 'object' && !Array.isArray(got)).toBe(
      true
    );
    expect(Object.keys(got as object)).toEqual(Object.keys(expected));
    for (const [k, x] of Object.entries(expected))
      expectClose((got as any)[k], x);
  } else expect(got).toBe(expected);
}

/** The interpreter's value of `expr` at the inputs `inputs`. */
function interpreted(ce: ComputeEngine, expr: any, inputs: Inputs) {
  const subs = Object.fromEntries(
    Object.entries(inputs).map(([k, x]) => [
      k,
      Array.isArray(x) ? ce.box(['List', ...x]) : ce.number(x),
    ])
  );
  return ce.box(expr).subs(subs).evaluate().N();
}

/** `expr` compiles on JavaScript, with `optimize` on and off, and gives the
 *  interpreter's value at each of `cases`. Returns the code of the first
 *  compilation. */
function expectAgrees(ce: ComputeEngine, expr: any, cases: Inputs[]) {
  const results = OPTIMIZE.map((optimize) => {
    const js = compileTo(ce, expr, optimize);
    if (!js.ok) throw new Error(js.message);
    for (const inputs of cases)
      expectClose(
        js.result.run(inputs),
        hostValue(interpreted(ce, expr, inputs))
      );
    return js.result;
  });
  return `${results[0].preamble ?? ''}\n${results[0].code}`;
}

function expectDeclines(ce: ComputeEngine, expr: any, reason: RegExp) {
  for (const optimize of OPTIMIZE) {
    const r = compileTo(ce, expr, optimize);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(reason);
  }
}

const G = [{ g: [3, 4.5] }, { g: [-1, 2, 7] }, { g: [5] }];

describe('a field of a run-time length is carried', () => {
  const ce = engine();

  test('a field from a list<real> parameter, read where it was made', () => {
    expectAgrees(ce, ['readHere', 'g'], G);
  });

  test('a field read in another function reads its length first', () => {
    const code = expectAgrees(ce, ['viaCall', 'g'], G);
    expect(code).toMatch(/\.geom\.length/);
    expectAgrees(ce, ['viaLocal', 'g'], [{ g: [3, 4.5] }, { g: [1, 2, 3] }]);
  });

  test('a field from take(L, n), of 0 and 2 elements, and an empty list', () => {
    expectAgrees(ce, ['taken', 'n'], [{ n: 0 }, { n: 2 }, { n: 4 }]);
    expectAgrees(ce, ['empty', 't'], [{ t: 1 }]);
  });

  test('the record as the result of a user function and of the entry', () => {
    expectAgrees(ce, ['mk', "'a'", 'g'], [...G, { g: [] }]);
  });

  test('an if of a constant length and a carried one (D2)', () => {
    const cases = [
      { t: 2, g: [5, 6, 7] },
      { t: 0, g: [5, 6, 7] },
      { t: 0, g: [8] },
    ];
    expectAgrees(ce, ['pickG', 't', 'g'], cases);
    expectAgrees(ce, ['readPick', 't', 'g'], cases);
  });

  test('an if of two constant lengths (D2)', () => {
    expectAgrees(ce, ['pick23', 't'], [{ t: 2 }, { t: 0 }]);
    expectAgrees(ce, ['readPick23', 't'], [{ t: 2 }, { t: 0 }]);
  });

  test('the arms of a match (D2)', () => {
    const cases = [
      { n: 1, g: [5, 6, 7] },
      { n: 2, g: [5, 6, 7] },
      { n: 2, g: [] },
    ];
    expectAgrees(ce, ['pickM', 'n', 'g'], cases);
    expectAgrees(ce, ['readM', 'n', 'g'], cases.slice(0, 2));
  });

  test('a carried read of a record that a decided if makes of a static length', () => {
    // The passes put the record of the arm taken, of a static field
    // length, where the call's carried one was read.
    expectAgrees(ce, ['inlined2', 't'], [{ t: 2 }, { t: -1 }]);
    expectAgrees(ce, ['inlined3', 't'], [{ t: 2 }, { t: -1 }]);
  });

  test('one user function called with fields of lengths 2 and 3', () => {
    expectAgrees(ce, ['both', 't'], [{ t: 1 }, { t: -2.5 }]);
  });

  test('a protocol method reads self.geom[1]', () => {
    expectAgrees(ce, ['headOf', 'g'], G);
  });

  test('f.geom + g.geom: equal lengths add, unequal lengths throw', () => {
    expectAgrees(
      ce,
      ['addTwo', 'a', 'b'],
      [
        { a: [1, 2], b: [10, 20] },
        { a: [], b: [] },
      ]
    );
    // The interpreter's value is an `incompatible-dimensions` error.
    const expected = interpreted(ce, ['addTwo', 'a', 'b'], {
      a: [1, 2],
      b: [1, 2, 3],
    });
    expect(JSON.stringify(expected.json)).toMatch(/incompatible-dimensions/);
    for (const optimize of OPTIMIZE) {
      const js = compileTo(ce, ['addTwo', 'a', 'b'], optimize);
      if (!js.ok) throw new Error(js.message);
      expect(() => js.result.run({ a: [1, 2], b: [1, 2, 3] })).toThrow(
        /incompatible-dimensions/
      );
    }
  });

  test('a list of points in a field: a carried first axis, an inner 2', () => {
    // (The interpreter holds the comprehension of `pts(g)` unevaluated in
    // the record, so only its reads are compared.)
    expectAgrees(ce, ['usePts', 'g'], G);
  });

  test('a field of rank 2 of a run-time inner length declines (D3)', () => {
    expectDeclines(ce, ['matField', 't'], /run-time length/);
  });
});

describe('parameters and constructors of declared types', () => {
  const ce = engine();

  test('a parameter of a declared record type', () => {
    expectAgrees(ce, ['useFigGeom', 'g'], G);
    expectAgrees(ce, ['useDotGeom', 't'], [{ t: 1 }, { t: -2 }]);
  });

  test('a nominal tuple type with its own constructor function', () => {
    expectAgrees(ce, ['mkV2', 't'], [{ t: 1 }, { t: -2 }]);
    expectAgrees(ce, ['readV2', 't'], [{ t: 1 }, { t: -2 }]);
    // The raw arm: the operands are the fields.
    expectAgrees(ce, ['rawV2', 't'], [{ t: 1 }]);
    expectAgrees(ce, ['mkTag', 'g'], G);
  });
});
