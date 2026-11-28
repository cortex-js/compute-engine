/**
 * CE-1921: a parameter or a result declared a list type that settles no IR
 * type (`list`, `list<real | string>`) holds a list literal of numbers and
 * a string (a record of no names, `compilation/ir/README.md`, "Records")
 * and a list of records, whose lanes the type admits; a field `geom: list`
 * takes such a value held at a parameter of type `any`. Tycho's drawing
 * prelude passes `[x, y, text]` to `figureOf(kind: string, geom: list)`.
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
  type T = tuple<k: string, geom: list>
  type P = tuple<x: real, y: real>
  type Figure = tuple<kind: string, geom: list>
  function g(geom: list) { geom }
  function gr(geom: list<real>) { geom }
  function grs(geom: list<real | string>) { geom }
  function wrap(geom: list) { T("x", geom) }
  function wrapAny(geom: any) { T("x", geom) }
  function figureOf(kind: string, geom: list) { Figure(kind, geom) }
  function label(p, text) { figureOf("label", [N(p[1], 15), N(p[2], 15), text]) }
  function third(geom: list) { geom[3] }
  function size(geom: list) { length(geom) }
  function asRS(xs: list) -> list<real | string> { xs }
`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'real');
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

const LAZY = ['Comprehension', 'Filter', 'Map', 'Take', 'Range'];

/** The JavaScript value that `run()` gives for the interpreter's value
 *  `v`. A complex number is `{ re, im }` (the result convention). */
function hostValue(v: Expression): unknown {
  if (isSymbol(v, 'Nothing')) return null;
  if (isSymbol(v, 'True')) return true;
  if (isSymbol(v, 'False')) return false;
  if (isString(v)) return v.string;
  if (isNumber(v)) return v.im === 0 ? v.re : { re: v.re, im: v.im };
  if (isDictionary(v))
    return Object.fromEntries(v.keys.map((k) => [k, hostValue(v.get(k)!)]));
  if (isFunction(v)) {
    // A lazy collection of the interpreter (a `Comprehension`, a `Filter`):
    // its elements.
    if (LAZY.includes(v.operator)) return [...v.each()].map(hostValue);
    if (v.nops === 1 && isDictionary(v.ops[0])) return hostValue(v.ops[0]);
    const items = v.ops.map(hostValue);
    if (v.operator === 'List' || v.operator === 'Tuple') return items;
    const names = fieldNames(v);
    if (names !== undefined)
      return Object.fromEntries(names.map((n, k) => [n, items[k]]));
  }
  throw new Error(`no host value for ${v.toString()} (${v.operator})`);
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

const AT = [{ t: 3 }, { t: -1.5 }];
const mixed = ['List', 't', 2, "'a'"];

describe('CE-1921: the witness table', () => {
  const ce = engine();
  test('control: the literal alone', () => {
    expectAgrees(ce, mixed, AT);
  });
  test('control: the literal in a field list', () => {
    expectAgrees(ce, ['T', "'x'", mixed], AT);
  });
  test('control: a list of numbers at a parameter list, in a field', () => {
    expectAgrees(ce, ['wrap', ['List', 't', 2]], AT);
  });
  test('a mixed list at a parameter list, in a field', () => {
    expectAgrees(ce, ['wrap', mixed], AT);
  });
  test('a mixed list at a parameter list, returned', () => {
    expectAgrees(ce, ['g', mixed], AT);
  });
  test('a list of numbers returned as list', () => {
    expectAgrees(ce, ['g', ['List', 't', 2]], AT);
  });
  test('a parameter any into a field list', () => {
    expectAgrees(ce, ['wrapAny', mixed], AT);
    expectAgrees(ce, ['wrapAny', ['List', 't', 2]], AT);
  });
});

describe('CE-1921: Tycho label', () => {
  const ce = engine();
  test('figureOf("label", [N(p[1], 15), N(p[2], 15), text]) from label(p, text)', () => {
    expectAgrees(ce, ['label', ['Tuple', 't', 0], "'a'"], AT);
  });
  test('two labels of two texts: one function per record type', () => {
    expectAgrees(
      ce,
      [
        'List',
        ['label', ['Tuple', 't', 0], "'a'"],
        ['figureOf', "'label'", ['List', 't', "'b'", 1]],
      ],
      AT
    );
  });
});

describe('CE-1921: element types and other arguments', () => {
  const ce = engine();
  test('a list of an element type that admits the elements', () => {
    expectAgrees(ce, ['grs', ['List', 't', "'a'"]], AT);
  });
  test('a list of records at a parameter list', () => {
    expectAgrees(ce, ['g', ['List', ['P', 't', 1], ['P', 2, 3]]], AT);
    expectAgrees(ce, ['wrap', ['List', ['P', 't', 1], ['P', 2, 3]]], AT);
  });
  test('a list of strings and a nested list at a parameter list', () => {
    expectAgrees(ce, ['g', ['List', "'a'", "'b'"]], AT);
    expectAgrees(ce, ['g', ['List', 't', ['List', 1, 2], "'a'"]], AT);
  });
  test('an element of the held list', () => {
    expectAgrees(ce, ['third', mixed], AT);
  });
  test('two calls of two record types', () => {
    expectAgrees(ce, ['List', ['g', mixed], ['g', ['List', 't', "'b'"]]], AT);
  });
});

describe('CE-1921: the declines that remain', () => {
  const ce = engine();
  test('an element type that does not admit the elements (the interpreter gives an error)', () => {
    expectDeclines(ce, ['gr', ['List', 't', "'a'"]], /a scalar argument of gr/);
  });
  test('a tuple at a parameter list: an error of the canonical form', () => {
    expectDeclines(ce, ['g', ['Tuple', 't', "'a'"]], /incompatible-type/);
  });
  test('the length of a held record of no names', () => {
    expectDeclines(ce, ['size', mixed], /a scalar where a list is required/);
    // A body that the declared list result does not admit (the interpreter:
    // incompatible-type).
    expectDeclines(ce, ['asRS', ['List', 't', 'True']], /the result of asRS/);
  });
});
