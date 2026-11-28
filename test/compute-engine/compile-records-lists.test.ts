/**
 * Lists of records (stage 3 of
 * `docs/plans/2026-11-27-records-objects-and-held-lengths.md`;
 * `compilation/ir/README.md`, "Records").
 *
 * - A value of the lane `record` and the shape `[n]` is a list of records
 *   of one record type: a JavaScript array of the records. A build, a
 *   filter and a literal of records of one type make one.
 * - Its readers: `At` and the element of a loop over it, `Length`, a
 *   `Comprehension` or a `Map` over it, a parameter (of no stated type or
 *   `any`) and a result of a user function, the entry result. A call of a
 *   function whose parameter is a record maps over the list, as the
 *   interpreter maps it.
 * - A record is never absent in compiled code: a discharge of a record in a
 *   program that reads an element of a list of records at an index that
 *   can be out of range declines.
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
  type P = tuple<k: integer, x: real>
  type Fig = record{__tag: string, kind: string, geom: list<real>}
  function Fig(kind: string, g: list<real>) { {__tag -> "Figure", kind -> kind, geom -> g} }
  function circle(p: real, r: real) { Fig("circle", [p, r]) }
  function poly(g: list<real>) { Fig("polygon", g) }
  function area(f: Fig) { f.geom[1] * length(f.geom) }

  function figs(t: real) { [P(k, t * k) for k in 1..3] }
  function figsN(n: integer) { [P(k, k / 2) for k in 1..n] }
  function lit(t: real) { [P(1, t), P(2, 2 * t)] }
  function sumX(t: real) { let L = figs(t); L[1].x + L[3].x + length(L) }
  function mapX(t: real) { map((p) => p.x + p.k, figs(t)) }
  function readX(n: integer) { [p.x * p.k for p in figsN(n)] }
  function kept(n: integer, t: real) { filter(figsN(n), (p) => p.x > t) }
  function keptX(n: integer, t: real) { [p.k for p in filter(figsN(n), (p) => p.x > t)] }
  function elementX(n: integer, i: integer) { figsN(n)[i].x }
  function circles(g: list<real>) { [circle(p, 1) for p in g] }
  function areas(g: list<real>) { [area(f) for f in circles(g)] }
  function areaAll(g: list<real>) { area(circles(g)) }
  function shapes(g: list<real>) { [circle(1, 2), poly(g)] }
  function lengths(g: list<real>) { [length(f.geom) for f in shapes(g)] }
  function size(L: any) { length(L) }
  function counts(t: real, n: integer) { size(figs(t)) + size(figsN(n)) }
  function cx(t: real) { [{a -> k + t * ImaginaryUnit} for k in 1..2] }
  function missingAt(n: integer, i: integer) { isMissing(figsN(n)[i]) }
  function coalesceAt(n: integer, i: integer) { (figsN(n)[i] ?? P(0, 0)).x }
  function assertAt(n: integer, i: integer) { let f = figsN(n)[i]?!; f.x }
  function missingIn(t: real) { isMissing(figs(t)[2]) }
  function nestedLists(n: integer) { [figsN(k) for k in 1..n] }
  function listField(n: integer) { {a -> figsN(n)} }
  function readField(n: integer) { let r = listField(n); length(r.a) + r.a[1].x }
  function readAny(r: any) { length(r.a) + r.a[1].x }
  function readThere(n: integer) { readAny(listField(n)) + readAny({a -> figs(1)}) }
  type Leaf = tuple<geom: list, options: list<real>>
  type Group = tuple<parts: list>
  function group(t: real) { Group([Leaf([t], []), Leaf([1, t], [2])]) }
  function readGroup(t: real) { let g = group(t); g.parts[2].geom[2] + length(g.parts) }
  function pickItems(t: real) { if t > 0 { {items -> [P(1, t)]} } else { {items -> [P(1, t), P(2, 2 * t)]} } }
  function joinedLength(t: real) { let r = pickItems(t); length(r.items) + r.items[length(r.items)].x }
  function row(...a) { a }
  function rows(t: real) { let L = [row(t, "a"), row(t, "b"), row(t, "c")]; length(L) }
`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'real');
  ce.declare('n', 'integer');
  ce.declare('i', 'integer');
  ce.declare('g', 'list<real>');
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

const N = [{ n: 0 }, { n: 1 }, { n: 3 }];
const G = [{ g: [3, 4.5] }, { g: [-1, 2, 7] }, { g: [] }];

describe('a list of records is a value of the program', () => {
  const ce = engine();

  test('a comprehension of a named tuple, as the entry result', () => {
    expectAgrees(ce, ['figs', 't'], [{ t: 2 }, { t: -0.5 }]);
    expectAgrees(ce, ['figsN', 'n'], N);
  });

  test('a literal list of records of one type', () => {
    expectAgrees(ce, ['lit', 't'], [{ t: 2 }]);
  });

  test('a list of records returned by a user function and read by the caller', () => {
    expectAgrees(ce, ['sumX', 't'], [{ t: 2 }, { t: -1 }]);
  });

  test('Map and a Comprehension over a list of records read each element', () => {
    expectAgrees(ce, ['mapX', 't'], [{ t: 2 }]);
    expectAgrees(ce, ['readX', 'n'], N);
  });

  test('a filter of records, also one that keeps no record', () => {
    const cases = [
      { n: 4, t: 0.7 },
      { n: 4, t: 9 },
      { n: 0, t: 0 },
    ];
    expectAgrees(ce, ['kept', 'n', 't'], cases);
    expectAgrees(ce, ['keptX', 'n', 't'], cases);
  });

  test('Length of a list of records', () => {
    expectAgrees(ce, ['Length', ['figsN', 'n']], N);
  });

  test('an element in range, also at a negative index', () => {
    expectAgrees(
      ce,
      ['elementX', 'n', 'i'],
      [
        { n: 3, i: 1 },
        { n: 3, i: 3 },
        { n: 3, i: -1 },
        { n: 3, i: -3 },
      ]
    );
  });

  test('a parameter of type any takes the list whole', () => {
    expectAgrees(
      ce,
      ['counts', 't', 'n'],
      [
        { t: 1, n: 0 },
        { t: 1, n: 5 },
      ]
    );
  });

  test('a field that is a list of records', () => {
    // (The interpreter holds the comprehension of `listField(n)`
    // unevaluated in the dictionary, so only its reads are compared.)
    expectAgrees(ce, ['readField', 'n'], [{ n: 1 }, { n: 3 }]);
    expectAgrees(ce, ['readThere', 'n'], [{ n: 1 }, { n: 3 }]);
    expectAgrees(ce, ['group', 't'], [{ t: 2 }]);
    expectAgrees(ce, ['readGroup', 't'], [{ t: 2 }]);
  });

  test('a list of records with a complex field as the entry result', () => {
    expectAgrees(ce, ['cx', 't'], [{ t: 2 }, { t: 0.5 }]);
  });
});

describe('figures (the witness of the plan)', () => {
  const ce = engine();

  test('a comprehension of figures, and a read of each figure', () => {
    expectAgrees(ce, ['circles', 'g'], G);
    expectAgrees(ce, ['areas', 'g'], G);
  });

  test('area(figs) with area(f: Fig) maps over the list', () => {
    expectAgrees(ce, ['areaAll', 'g'], G);
  });

  test('figures whose fields have lengths 2 and 3 are one list', () => {
    expectAgrees(ce, ['shapes', 'g'], G);
    expectAgrees(ce, ['lengths', 'g'], G);
  });
});

describe('what declines', () => {
  const ce = engine();

  test('a discharge of an element at an index that can be out of range', () => {
    // The interpreter's value out of range is `Missing`; a record is never
    // absent in compiled code.
    expect(
      interpreted(ce, ['missingAt', 'n', 'i'], { n: 2, i: 5 }).symbol
    ).toBe('True');
    expectDeclines(ce, ['missingAt', 'n', 'i'], /IsMissing of a record/);
    expectDeclines(ce, ['coalesceAt', 'n', 'i'], /Coalesce of a record/);
    expectDeclines(ce, ['assertAt', 'n', 'i'], /AssertPresent of a record/);
  });

  test('a discharge of an element at an index proven in range compiles', () => {
    expectAgrees(ce, ['missingIn', 't'], [{ t: 1 }]);
  });

  test('a list of lists of records', () => {
    expectDeclines(
      ce,
      ['nestedLists', 'n'],
      /lists of run-time length|lists of records/
    );
  });
});

describe('a function of the host', () => {
  test('takes a literal list of records as the List of the records', () => {
    const ce = engine();
    const received: string[] = [];
    ce.declare('drawAll', {
      signature: '(any) -> nothing',
      pure: false,
      evaluate: (ops) => {
        received.push(ops[0].toString());
        return ce.symbol('Nothing');
      },
    });
    executeEpsil(
      ce,
      `function draws(t: real) { drawAll([P(1, t), P(2, 2 * t)]); 1 }
       function drawsBuilt(t: real) { drawAll([P(k, t) for k in 1..2]); 1 }`
    );
    ce.box(['draws', 3]).evaluate();
    const expected = [...received];
    for (const optimize of OPTIMIZE) {
      const js = compileTo(ce, ['draws', 't'], optimize);
      if (!js.ok) throw new Error(js.message);
      received.length = 0;
      expect(js.result.run({ t: 3 })).toBe(1);
      expect(received).toEqual(expected);
    }
    // The interpreter can hold a comprehension as a lazy collection.
    expectDeclines(ce, ['drawsBuilt', 't'], /lazy collection/);
  });
});

describe('lengths of lists of records', () => {
  test('a join of two record fields that are lists of records of different lengths carries the length', () => {
    expectAgrees(engine(), ['joinedLength', 't'], [{ t: 2 }, { t: -3 }]);
  });
  test('the length of a local list of records counts the records, not their fields', () => {
    expectAgrees(engine(), ['rows', 't'], [{ t: 2 }]);
  });
});
