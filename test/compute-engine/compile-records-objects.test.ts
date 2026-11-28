/**
 * Records as objects (stage 1 of
 * `docs/plans/2026-11-27-records-objects-and-held-lengths.md`;
 * `compilation/ir/README.md`, "Records"), and CE-1914.
 *
 * - On JavaScript a record with names (a named tuple, a dictionary) is an
 *   object of its fields in declaration order, and a field is read by its
 *   name; a record with no names is an array.
 * - A named tuple input of the entry is read by name, with no copy.
 * - The result of `run()` is the record as it is, but a field that can
 *   hold a complex number, which follows the result convention.
 * - A value of a declared record type (`type Fig = record{…}` with its
 *   constructor function) is the dictionary record of the constructor's
 *   body, of the nominal type `Fig`; a host function receives
 *   `Fig(Dictionary(…))`, the interpreter's value.
 * - A dictionary field of the value `Nothing` is `null`.
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
  type P = tuple<x: real, y: real>
  type Q = tuple<name: string, at: P>
  type H = tuple<name: string, pair: list>
  type Sample = tuple<value: complex, k: real>
  type Fig = record{__tag: string, kind: string, geom: tuple<real, real>}
  function Fig(kind: string, x: real, y: real) { {__tag -> "Figure", kind -> kind, geom -> (x, y)} }
  function mk(t: real) { P(cos(t), sin(t)) }
  function nested(t: real) { Q("a", P(t, 2 * t)) }
  function noNames(t: real) { H("b", [t, "s"]) }
  function readP(q: P) { q.x + 2 * q.y }
  function loopP(q: P) { let s = 0; for i in 1..10 { s = s + q.x * i + q.y }; s }
  function shift(q: P, d: real) { P(q.x + d, q.y) }
  function useShift(t: real) { let a = shift(P(t, 1), 2); a.x * a.y }
  function odd(t: real) { {"a b" -> t, c -> (t, "s")} }
  function oddRead(t: real) { let d = {"a b" -> t, c -> 2}; d["a b"] + d.c }
  function useFig(t: real) { Fig("dot", t, 0) }
  function readFig(t: real) { let f = Fig("dot", t, 0); f.geom[1] + f.geom[2] }
  function kindOf(t: real) { let f = Fig("dot", t, 0); f.kind }
  function raw(t: real) { Fig({__tag -> "Figure", kind -> "raw", geom -> (t, 1)}) }
  function withNothing(t: real) { {__tag -> "Figure", kind -> "dot", geom -> [t, 0], alpha -> nothing} }
  function mixed(t: real) { if t > 1 { Fig("dot", t, 0) } else { {__tag -> "Figure", kind -> "dot", geom -> (t, 0)} } }
  function spread(t: real) { let f = Fig("dot", t, 0); {...f, kind -> "x"} }
  function isFig(t: real) { let f = Fig("dot", t, 0); if f is Fig { 1 } else { 2 } }
  type G = record{a: real, b: real}
  function G(x: real) { let y = x * 2; {a -> y, b -> x} }
  function useG(t: real) { G(t) }
  type GI = record{a: integer}
  function GI(x: real) { let y = x * 2; {a -> y} }
  function useGI(t: real) { GI(t) }
`;

function engine(): { ce: ComputeEngine; received: Expression[] } {
  const ce = new ComputeEngine();
  const received: Expression[] = [];
  ce.declare('t', 'real');
  ce.declare('figureDraw', {
    signature: '(any) -> nothing',
    pure: false,
    evaluate: (ops) => {
      received.push(ops[0]);
      return ce.symbol('Nothing');
    },
  });
  const errors = executeEpsil(ce, PRELUDE).diagnostics.filter(
    (d) => d.severity === 'error'
  );
  if (errors.length > 0)
    throw new Error(`prelude: ${JSON.stringify(errors[0].message)}`);
  ce.declare('p', 'P');
  ce.declare('z', 'complex');
  return { ce, received };
}

const OPTIMIZE = [true, false];

function compileTo(
  ce: ComputeEngine,
  expr: any,
  optimize: boolean,
  mode?: string
): { ok: true; result: any } | { ok: false; message: string } {
  try {
    const result: any = compile(
      isFunction(expr) || isSymbol(expr) ? expr : ce.box(expr),
      {
        to: 'javascript',
        fallback: false,
        optimize,
        ...(mode === undefined ? {} : { mode }),
      } as any
    );
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
 *  `v`: an object for a value of a named tuple type, a dictionary, or a
 *  value of a declared record type (`Fig(Dictionary(…))`); an array for a
 *  list or a tuple; `null` for `Nothing`. */
function hostValue(v: Expression): unknown {
  if (isSymbol(v, 'Nothing')) return null;
  if (isString(v)) return v.string;
  if (isNumber(v)) return v.im === 0 ? v.re : { re: v.re, im: v.im };
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

/** `got` is `expected`, numbers within 1e-12, the keys of an object in the
 *  same order. */
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

/** `expr` compiles on JavaScript, with `optimize` on and off, and gives the
 *  interpreter's value at each value of `t`. Returns the result of the
 *  first compilation. */
function expectAgrees(ce: ComputeEngine, expr: any, ts = [1, -0.3, 2.5]) {
  const results = OPTIMIZE.map((optimize) => {
    const js = compileTo(ce, expr, optimize);
    if (!js.ok) throw new Error(js.message);
    for (const t of ts) {
      const expected = hostValue(ce.box(expr).subs({ t }).evaluate().N());
      expectClose(js.result.run({ t }), expected);
    }
    return js.result;
  });
  return results[0];
}

function expectDeclines(ce: ComputeEngine, expr: any, reason: RegExp) {
  for (const optimize of OPTIMIZE) {
    const r = compileTo(ce, expr, optimize);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(reason);
  }
}

/** `got` is the engine value `expected`: the same operators, keys,
 *  strings and symbols, and numbers within 1e-12. */
function expectSameValue(got: Expression, expected: Expression) {
  if (isNumber(expected)) {
    expect(isNumber(got)).toBe(true);
    expect(Math.abs((got as any).re - expected.re)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs((got as any).im - expected.im)).toBeLessThanOrEqual(1e-12);
  } else if (isDictionary(expected)) {
    expect(isDictionary(got)).toBe(true);
    expect((got as typeof expected).keys).toEqual(expected.keys);
    for (const k of expected.keys)
      expectSameValue((got as typeof expected).get(k)!, expected.get(k)!);
  } else if (isFunction(expected)) {
    expect(isFunction(got) && got.operator).toBe(expected.operator);
    expect((got as typeof expected).nops).toBe(expected.nops);
    expected.ops.forEach((x, k) =>
      expectSameValue((got as typeof expected).ops[k], x)
    );
  } else expect(got.isSame(expected)).toBe(true);
}

describe('records with names are objects', () => {
  const { ce } = engine();

  test('a named tuple: an object of its fields in declaration order', () => {
    const r = expectAgrees(ce, ['mk', 't']);
    const v = r.run({ t: 1 });
    expect(Array.isArray(v)).toBe(false);
    expect(Object.keys(v)).toEqual(['x', 'y']);
    // Made as an object literal, read by name.
    expect(`${r.preamble}\n${r.code}`).toContain('{ x: Math.cos(');
  });

  test('a field read in another function, by name', () => {
    const r = expectAgrees(ce, ['useShift', 't']);
    expect(r.preamble).toMatch(/v\d+\.x \* v\d+\.y/);
  });

  test('a nested record with names, and a nested record with none', () => {
    expect(
      Object.keys(expectAgrees(ce, ['nested', 't']).run({ t: 1 }).at)
    ).toEqual(['x', 'y']);
    // `[t, "s"]` is a record with no names: an array in the object.
    const r = expectAgrees(ce, ['noNames', 't']);
    expect(Array.isArray(r.run({ t: 1 }).pair)).toBe(true);
  });

  test('a dictionary with a key that is not an identifier', () => {
    const r = expectAgrees(ce, ['odd', 't']);
    expect(Object.keys(r.run({ t: 1 }))).toEqual(['a b', 'c']);
    expect(r.preamble).toContain('"a b": ');
    expectAgrees(ce, ['oddRead', 't']);
  });

  test('a complex field follows the result convention', () => {
    for (const optimize of OPTIMIZE) {
      const js = compileTo(ce, ['Sample', 'z', 't'], optimize, 'complex');
      if (!js.ok) throw new Error(js.message);
      for (const [re, im] of [
        [2, 0],
        [1, 2],
      ]) {
        const expected = hostValue(
          ce
            .box(['Sample', 'z', 't'])
            .subs({ z: ce.number(ce.complex(re, im)), t: 3 })
            .evaluate()
            .N()
        );
        expectClose(js.result.run({ z: { re, im }, t: 3 }), expected);
      }
      expect(js.result.run({ z: { re: 2, im: 0 }, t: 3 })).toEqual({
        value: 2,
        k: 3,
      });
    }
  });
});

describe('a named tuple input', () => {
  const { ce } = engine();

  test('is read by name, with no copy', () => {
    for (const name of ['readP', 'loopP']) {
      for (const optimize of OPTIMIZE) {
        const js = compileTo(ce, [name, 'p'], optimize);
        if (!js.ok) throw new Error(js.message);
        const text = `${js.result.preamble}\n${js.result.code}`;
        expect(text).not.toContain('_.p["x"]');
        expect(text).toMatch(/\.x\b/);
        for (const [x, y] of [
          [3, 4],
          [-0.5, 2],
        ]) {
          const expected = hostValue(
            ce
              .box([name, 'p'])
              .subs({ p: ce.box(['P', x, y]) })
              .evaluate()
              .N()
          );
          expectClose(js.result.run({ p: { x, y } }), expected);
        }
      }
    }
  });
});

describe('the field __proto__ declines', () => {
  test('of a named tuple, a declared record type and a dictionary', () => {
    const { ce } = engine();
    executeEpsil(
      ce,
      `
      type Bad = tuple<__proto__: real, y: real>
      type BadR = record{__proto__: real, y: real}
      function BadR(a: real, b: real, c: real) { {__proto__ -> a, y -> b + c} }
      function badTuple(t: real) { Bad(t, 1) }
      function badRecord(t: real) { BadR(t, 1, 2) }
      function badDict(t: real) { {__proto__ -> t, y -> 1} }
    `
    );
    expectDeclines(ce, ['badTuple', 't'], /__proto__/);
    expectDeclines(ce, ['badRecord', 't'], /__proto__/);
    expectDeclines(ce, ['badDict', 't'], /__proto__/);
  });
});

describe('values of a declared record type (CE-1914)', () => {
  const { ce, received } = engine();

  test('a call of the constructor function compiles', () => {
    const r = expectAgrees(ce, ['useFig', 't']);
    expect(r.run({ t: 2 })).toEqual({
      __tag: 'Figure',
      kind: 'dot',
      geom: [2, 0],
    });
    expectAgrees(ce, ['readFig', 't']);
    expectAgrees(ce, ['kindOf', 't']);
    expectAgrees(ce, ['isFig', 't']);
  });

  test('a field that a local of a wider static type gives is proven by its lane', () => {
    // `y` is inferred `number`; its lane `real` proves the field `a: real`.
    expectAgrees(ce, ['useG', 't']);
    // A lane `real` does not prove `integer`: the interpreter checks the
    // value, so the call declines.
    expectDeclines(ce, ['useGI', 't'], /does not prove/);
  });

  test('the raw payload Fig({…}) compiles, the body does not run', () => {
    expectAgrees(ce, ['raw', 't']);
  });

  test('a dictionary field of the value Nothing is null', () => {
    const r = expectAgrees(ce, ['withNothing', 't']);
    expect(r.run({ t: 2 }).alpha).toBeNull();
  });

  test('a Fig and an untyped dictionary are two types', () => {
    expectDeclines(ce, ['mixed', 't'], /arms of two types/);
  });

  test('the spread of a Fig declines (CE-1913)', () => {
    expectDeclines(ce, ['spread', 't'], /DictionaryFrom/);
  });

  test('a host function receives Fig(Dictionary(…))', () => {
    for (const source of [
      '(t: real) => figureDraw(Fig("dot", t, 0))',
      '(t: real) => figureDraw(Fig({__tag -> "Figure", kind -> "raw", geom -> (t, 1)}))',
      '(t: real) => figureDraw({a -> t, b -> nothing, c -> P(t, 2 * t)})',
    ]) {
      const f = executeEpsil(ce, source).value!;
      for (const optimize of OPTIMIZE) {
        const js = compileTo(ce, f, optimize);
        if (!js.ok) throw new Error(js.message);
        for (const t of [1, -0.5, 2.5]) {
          received.length = 0;
          ce.box(['Apply', f, t] as any).evaluate();
          const expected = [...received];
          received.length = 0;
          js.result.run(t);
          expect(received.length).toBe(expected.length);
          expected.forEach((x, k) => expectSameValue(received[k], x));
          // The value is the constructor applied to its payload.
          if (source.includes('Fig('))
            expect(received[0]?.operator).toBe('Fig');
        }
      }
    }
  });
});
