/**
 * Compiled-vs-interpreted parity for `At` with a COLLECTION-valued index
 * (a list of integer indices, or a boolean mask).
 *
 * `_SYS.at` used to assume a scalar index, so a collection index was garbled by
 * JS coercion: `p[[1,2,3]]` returned `undefined`, `p[[2]]` returned the scalar
 * `20` instead of the 1-element list `[20]`, and a boolean mask threw. Each
 * case below asserts the compiled result EQUALS the interpreted one, so the
 * suite pins parity (D6: compiled = interpreted, or refuse) rather than
 * restating one side's expectations.
 *
 * Projection convention: out-of-band access is POSITION-PRESERVING and yields
 * the absence marker on BOTH routes — for a numeric collection that marker is
 * literally `NaN`, so an out-of-range scalar index and an out-of-range gather
 * entry agree between interpreter and compiler with no projection at all. A
 * DECLINED `At` (a non-integer entry in a collection index leaves `At`
 * unevaluated) has no numeric equivalent and still projects to a scalar NaN.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

const P = ['List', 10, 20, 30];

/** The interpreted value of `expr`, projected the way a real target would. */
function interpreted(expr: BoxedExpression): number | number[] {
  const v = expr.evaluate();
  if (v.operator === 'List') return (v.ops ?? []).map((x) => x.re as number);
  // An unevaluated `At` (declined: non-integer entry) means "no value" — NaN
  // on a real target. (The absence marker for a numeric collection is already
  // `NaN`, so no projection is needed for out-of-band access.)
  if (v.operator === 'At') return NaN;
  return v.re as number;
}

/** Compile `expr`, run it, and assert it matches interpretation. */
function parity(expr: BoxedExpression): number | number[] {
  const r = compile(expr);
  expect(r?.success).toBe(true);
  const compiled = r!.run!() as number | number[];
  expect(compiled).toEqual(interpreted(expr));
  return compiled;
}

const at = (index: any) => ce.box(['At', P, index] as any);

describe('At with a collection index — gather', () => {
  test('all entries in range', () => {
    expect(parity(at(['List', 1, 2, 3]))).toEqual([10, 20, 30]);
  });

  test('a single-entry index yields a 1-element LIST, not a scalar', () => {
    expect(parity(at(['List', 2]))).toEqual([20]);
  });

  test('order is preserved', () => {
    expect(parity(at(['List', 3, 1]))).toEqual([30, 10]);
  });

  test('negative entries count from the end', () => {
    expect(parity(at(['List', 2, -1]))).toEqual([20, 30]);
  });

  // BREAKING (2026-07-22): a gather is POSITION-PRESERVING — an out-of-range
  // entry yields the absence marker in place (`NaN` for this numeric source)
  // instead of being dropped, so the result always has the index list's
  // length. Both routes agree.
  test('out-of-range entries yield the absence marker in place', () => {
    expect(parity(at(['List', 0, 1, 2]))).toEqual([NaN, 10, 20]);
    expect(parity(at(['List', 1, 2, 4]))).toEqual([10, 20, NaN]);
    expect(parity(at(['List', 10]))).toEqual([NaN]);
  });
});

describe('At with a collection index — boolean mask', () => {
  test('keeps the flagged elements', () => {
    expect(parity(at(['List', 'False', 'True', 'True']))).toEqual([20, 30]);
  });

  test('an all-False mask yields an empty list', () => {
    expect(parity(at(['List', 'False', 'False', 'False']))).toEqual([]);
  });

  test('a mask shorter than the source selects from its prefix', () => {
    expect(parity(at(['List', 'True', 'False']))).toEqual([10]);
  });

  test('mask entries past the end contribute nothing', () => {
    expect(parity(at(['List', 'True', 'True', 'True', 'True']))).toEqual([
      10, 20, 30,
    ]);
  });
});

describe('At with an empty index list', () => {
  // An empty index takes the mask branch (`every` on an empty array is true).
  test('yields an empty list on both routes', () => {
    expect(parity(at(['List']))).toEqual([]);
  });
});

describe('At with a non-integer entry in the index', () => {
  // The interpreter DECLINES (leaves `At` unevaluated, producing no value at
  // all), so the compiled form returns a scalar NaN for the whole result —
  // never a per-slot NaN, which would invent an element interpretation never
  // produces.
  test('a lone non-integer entry', () => {
    const expr = at(['List', 1.5]);
    expect(expr.evaluate().operator).toBe('At');
    expect(parity(expr)).toBeNaN();
  });

  test('a non-integer entry mixed with integers', () => {
    const expr = at(['List', 1, 1.5]);
    expect(expr.evaluate().operator).toBe('At');
    expect(parity(expr)).toBeNaN();
  });
});

describe('At with a scalar index (regression — unchanged)', () => {
  test('in range', () => {
    expect(parity(at(2))).toBe(20);
  });

  test('negative counts from the end', () => {
    expect(parity(at(-1))).toBe(30);
  });

  test('a zero index yields the absence marker (NaN here) on both routes', () => {
    expect(at(0).evaluate().isNaN).toBe(true);
    expect(parity(at(0))).toBeNaN();
  });

  test('an out-of-range index yields the absence marker (NaN here) on both routes', () => {
    expect(at(4).evaluate().isNaN).toBe(true);
    expect(parity(at(4))).toBeNaN();
  });
});

describe('At with a non-integer SCALAR index', () => {
  // The interpreter's scalar path (Case C) accepts a primitive integer only.
  // Anything else declines, so the compiled form must project a scalar NaN
  // rather than let JS index coercion invent a value: `true` would otherwise
  // read slot 0 (`true > 0`, `true - 1 === 0`) and a fractional index would
  // read a non-existent property and yield `undefined`.
  test('a boolean index declines on both routes', () => {
    const expr = at('True');
    expect(expr.evaluate().operator).toBe('At');
    expect(parity(expr)).toBeNaN();
  });

  test('a fractional index declines on both routes', () => {
    const expr = at(1.5);
    expect(expr.evaluate().operator).toBe('At');
    expect(parity(expr)).toBeNaN();
  });
});

describe('a collection-valued At is typed as a LIST, so parents compose', () => {
  // Reporting the bare element type here would claim a scalar for a value that
  // is actually a list: parent operators would skip broadcasting (compiled
  // `At(p, I) + 1` degenerating to JS array-plus-number string concatenation)
  // and collection operators would fail closed on a genuine list.
  test('a collection index yields a list type, a scalar index does not', () => {
    expect(at(['List', 1, 3]).type.toString()).toBe('list<finite_integer>');
    expect(at(['List', 'True', 'False', 'True']).type.toString()).toBe(
      'list<finite_integer>'
    );
    expect(at(2).type.toString()).toBe('finite_integer');
  });

  test('arithmetic over a gather broadcasts elementwise', () => {
    expect(parity(ce.box(['Add', at(['List', 1, 3]), 1] as any))).toEqual([
      11, 31,
    ]);
  });

  test('arithmetic over a mask broadcasts elementwise', () => {
    expect(
      parity(ce.box(['Multiply', at(['List', 'True', 'False', 'True']), 2]))
    ).toEqual([20, 60]);
  });

  test('a collection operator accepts the gather', () => {
    expect(parity(ce.box(['Length', at(['List', 1, 3])] as any))).toBe(2);
  });
});

describe('At on the parse route (subscript access)', () => {
  // The motivating witness: with `p` and `X` assigned, `p_{X}` compiles the
  // index straight to an array literal, while `p_{X-1}` compiles it to a
  // `_SYS.bcast(...)` call — an index that is only a collection at RUN time,
  // which is why the dispatch lives in `_SYS.at` rather than the handler.
  const engine = new ComputeEngine();
  engine.assign('p', engine.box(['List', 10, 20, 30] as any));
  engine.assign('X', engine.box(['List', 1, 2, 3] as any));

  test('p_{X} — literal index array', () => {
    const expr = engine.parse('p_{X}');
    const r = compile(expr);
    expect(r?.success).toBe(true);
    expect(r!.run!()).toEqual([10, 20, 30]);
    expect(r!.run!()).toEqual(interpreted(expr));
  });

  test('p_{X-1} — index computed at run time (bcast)', () => {
    // `X-1` is `[0,1,2]`: the 0 entry is out of range and now yields the
    // marker in place, so the result keeps the index list's length.
    const expr = engine.parse('p_{X-1}');
    const r = compile(expr);
    expect(r?.success).toBe(true);
    expect(r!.run!()).toEqual([NaN, 10, 20]);
    expect(r!.run!()).toEqual(interpreted(expr));
  });
});

describe('At with a runtime-generated boolean mask (the Desmos filter form)', () => {
  // The form the `At` canonical handler cites as its motivation:
  // `L[|[1...n]-k|>0]`. Its mask is a COMPUTED comparison, which the compiler
  // refuses (a raw JS `<` over an array stringifies it and yields a scalar
  // `false`, which then made `_SYS.at` return NaN — a silent wrong answer).
  // Refusal means the engine falls back to the interpreter, which is correct.
  // Compiling this form element-wise is tracked in ROADMAP.md,
  // "Element-wise compiled comparisons".
  const engine = new ComputeEngine();
  engine.assign('L', engine.box(['List', 10, 20, 30] as any));
  engine.assign('k', engine.box(2 as any));

  test('the mask form fails closed rather than answering wrongly', () => {
    const expr = engine.parse('L[|[1...3]-k|>0]');
    expect(compile(expr)?.success).toBe(false);
    // The interpreter is unaffected and correct.
    expect(interpreted(expr)).toEqual([10, 30]);
  });

  test('a LITERAL mask still compiles — only computed masks are refused', () => {
    expect(parity(at(['List', 'False', 'True', 'True']))).toEqual([20, 30]);
  });
});

describe('At index/source admissibility — fail closed, never diverge', () => {
  // The interpreter validates an index through `.re`, so a complex index whose
  // real part is an integer selects an element (the imaginary part is silently
  // dropped). `_SYS.at` reproduces that at RUN time rather than gating at
  // compile time: a static "provably real" gate was tried and reverted, because
  // an index's declared type is routinely far wider than its runtime value
  // (a comprehension variable types as `boolean | indexed_collection | number
  // | string`), so it rejected ordinary compilable code like `P[n]`.
  test('a complex scalar index indexes by its real part, as interpreted', () => {
    expect(parity(at(['Complex', 1, 2]))).toBe(10);
  });

  test('a complex entry in a gather indexes by its real part', () => {
    expect(parity(at(['List', ['Complex', 1, 2]]))).toEqual([10]);
  });

  test('a real gather is unaffected', () => {
    expect(parity(at(['List', 1, 3]))).toEqual([10, 30]);
  });

  test('a wide-typed index still matches interpretation at run time', () => {
    // `list<number>` is a subtype of NEITHER `list<complex>` nor `list<real>`
    // (`number` is a supertype of both), so no static gate can classify it —
    // which is exactly why the projection lives at run time.
    const engine = new ComputeEngine();
    engine.declare('ys', 'list<number>');
    const r = compile(engine.box(['At', P, 'ys'] as any));
    expect(r?.success).toBe(true);
    expect(r!.run!({ ys: [1, { re: 1, im: 2 }] })).toEqual([10, 10]);
  });

  // A dictionary source takes the `isDictionary` branch at evaluate, which
  // accepts a plain string key only and declines any collection-shaped index.
  // The type must not advertise `list<T>` for a shape the interpreter never
  // produces.
  const D = ['Dictionary', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 2]];

  test('a dictionary source with a collection index is not typed as a list', () => {
    const expr = ce.box(['At', D, ['List', { str: 'a' }, { str: 'b' }]] as any);
    expect(expr.type.toString()).not.toMatch(/^list</);
    expect(expr.evaluate().operator).toBe('At'); // declines
  });

  test('a dictionary source with a string key still types as the value', () => {
    const expr = ce.box(['At', D, { str: 'a' }] as any);
    expect(expr.type.toString()).not.toMatch(/^list</);
    expect(expr.evaluate().re).toBe(1);
  });

  test('a tuple source with a collection index types as a list', () => {
    const expr = ce.box(['At', ['Tuple', 10, 20, 30], ['List', 1, 3]] as any);
    expect(expr.type.toString()).toMatch(/^list</);
  });

  // Regression: a comprehension variable's declared type is a wide union, so
  // a static "provably real index" gate silently stopped `P[n]` — an ordinary,
  // correctly-compiling expression — from compiling at all.
  test('an index whose declared type is a wide union still compiles', () => {
    const engine = new ComputeEngine();
    engine.declare('P', engine.type('list<number>'));
    const r = compile(
      engine.parse(
        '\\left[([P[n],P[n]]).\\operatorname{total} \\operatorname{for} n=\\left[1...3\\right]\\right]'
      )
    );
    expect(r?.success).toBe(true);
    expect(r!.run!({ P: [1, 2, 3] })).toEqual([2, 4, 6]);
  });
});

describe('At with a CHAINED (multi-)index — result type follows the chain', () => {
  // `evaluate` walks the indices, peeling one collection level per step. The
  // type handler used to consult `ops[1]` only, so a chained form reported the
  // type of a whole intermediate row for a value that is a single element or a
  // gathered sub-list.
  const M = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]];

  test('a chained scalar index yields the scalar element type', () => {
    const expr = ce.box(['At', M, 1, 2] as any);
    expect(expr.evaluate().re).toBe(2);
    expect(expr.type.toString()).toBe('finite_integer');
  });

  test('a gather at a later step yields a list', () => {
    const expr = ce.box(['At', M, 1, ['List', 1, 2]] as any);
    expect(expr.evaluate().toString()).toBe('[1,2]');
    expect(expr.type.toString()).toBe('list<finite_integer>');
  });

  test('a single index into a matrix still yields the row type', () => {
    const expr = ce.box(['At', M, 1] as any);
    expect(expr.evaluate().toString()).toBe('[1,2,3]');
    expect(expr.type.toString()).toMatch(/\^3>$/);
  });

  // The step must be applied PER INDEX, not accumulated into one "did any step
  // gather" flag: a gather followed by a scalar index selects one entry OUT of
  // the gathered list, so the result is a whole row — not a list of scalars.
  test('a gather followed by a scalar index yields the ROW type', () => {
    const expr = ce.box(['At', M, ['List', 1, 2], 1] as any);
    expect(expr.evaluate().toString()).toBe('[1,2,3]');
    expect(expr.type.toString()).toMatch(/\^3>$/);
  });

  test('a gather at the outer level yields a list of rows', () => {
    const expr = ce.box(['At', M, ['List', 1, 2]] as any);
    expect(expr.evaluate().toString()).toBe('[[1,2,3],[4,5,6]]');
    expect(expr.type.toString()).toMatch(/^list</);
  });

  // A tuple IS an `indexed_collection`, so it must be excluded from the walk
  // explicitly — `elementType()` has slot-aware handling a generic peel loses.
  test('a tuple source keeps its slot-aware typing', () => {
    const expr = ce.box(['At', ['Tuple', 10, 20, 30], ['List', 1, 3]] as any);
    expect(expr.evaluate().toString()).toBe('[10,30]');
    expect(expr.type.toString()).toBe('list<finite_integer>');
    expect(ce.box(['At', ['Tuple', 10, 20, 30], 2] as any).type.toString()).toBe(
      'finite_integer'
    );
  });
});

describe('Last (shares `_SYS.at`) — regression', () => {
  test('still compiles and matches interpretation', () => {
    expect(parity(ce.box(['Last', P] as any))).toBe(30);
  });
});
