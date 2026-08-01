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
 * Projection convention: the interpreter's "no value" outcomes have no numeric
 * equivalent, so they compile to NaN — `Nothing` (scalar out-of-range index)
 * and a DECLINED `At` (a non-integer entry in a collection index leaves `At`
 * unevaluated) both project to a scalar NaN.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();

const P = ['List', 10, 20, 30];

/** The interpreted value of `expr`, projected the way a real target would. */
function interpreted(expr: BoxedExpression): number | number[] {
  const v = expr.evaluate();
  if (v.operator === 'List') return (v.ops ?? []).map((x) => x.re as number);
  // The absence marker (`Missing`/`NaN`, out-of-band access), an unevaluated
  // `At` (declined: non-integer entry), and a runtime `Error` (a mask-length
  // mismatch) all mean "no value" — NaN on a real target.
  if (
    v.symbol === 'Nothing' ||
    v.symbol === 'Missing' ||
    v.operator === 'At' ||
    v.operator === 'Error'
  )
    return NaN;
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
  // entry contributes the marker (`NaN` for a numeric collection) in place, so
  // the result has the same length as the index list (was dropped/shorter).
  test('out-of-range entries yield the marker in place (length preserved)', () => {
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

  // BREAKING (2026-07-22): a mask's length must EQUAL the collection length; a
  // mismatch is an error (interpreter), projected to a whole-result NaN on a
  // real target. Both routes agree.
  test('a mask shorter than the source is an error (→ NaN)', () => {
    expect(parity(at(['List', 'True', 'False']))).toBeNaN();
  });

  test('a mask longer than the source is an error (→ NaN)', () => {
    expect(parity(at(['List', 'True', 'True', 'True', 'True']))).toBeNaN();
  });
});

describe('At with an empty index list', () => {
  // An empty index is a gather (not a mask — a mask requires a matching source
  // length), and an empty gather yields the empty list.
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

  // BREAKING (2026-07-22): out-of-band scalar access yields the marker (`NaN`
  // for a numeric collection), not `Nothing`.
  test('a zero index yields NaN (interpreted marker)', () => {
    expect(at(0).evaluate().isNaN).toBe(true);
    expect(parity(at(0))).toBeNaN();
  });

  test('an out-of-range index yields NaN (interpreted marker)', () => {
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
    // §3.C: a gather is `list<T | marker(T)>`; a numeric `T` absorbs its
    // absence value (I6/Q2), so the element type widens to `number`. A mask
    // filters (no marker), but its element type still widens under Q2 because
    // the source element type is numeric. A scalar index is `T | marker(T)`.
    expect(at(['List', 1, 3]).type.toString()).toBe('list<number>');
    expect(at(['List', 'True', 'False', 'True']).type.toString()).toBe(
      'list<finite_integer>'
    );
    expect(at(2).type.toString()).toBe('number');
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
    // X-1 = [0, 1, 2]; index 0 is out of range → the marker (NaN) in place
    // (POSITION-PRESERVING gather, BREAKING). Both routes agree.
    const expr = engine.parse('p_{X-1}');
    const r = compile(expr);
    expect(r?.success).toBe(true);
    expect(r!.run!()).toEqual([NaN, 10, 20]);
    expect(r!.run!()).toEqual(interpreted(expr));
  });
});

describe('At with a runtime-generated boolean mask (the Desmos filter form)', () => {
  // The form the `At` canonical handler cites as its motivation:
  // `L[|[1...n]-k|>0]`. Its mask is a COMPUTED comparison, which a raw JS `<`
  // over an array stringifies into a scalar `false`, making `_SYS.at` return
  // NaN — a silent wrong answer. That made the form fail closed; it now
  // compiles element-wise through `_SYS.bcast` (see
  // `compiled-elementwise-boolean.test.ts`).
  const engine = new ComputeEngine();
  engine.assign('L', engine.box(['List', 10, 20, 30] as any));
  engine.assign('k', engine.box(2 as any));

  test('the mask form compiles and agrees with the interpreter', () => {
    const expr = engine.parse('L[|[1...3]-k|>0]');
    expect(parity(expr)).toEqual([10, 30]);
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
    // §3.C: the final scalar step is `T | marker(T)`; a numeric `T` absorbs to
    // `number` (I6/Q2).
    const expr = ce.box(['At', M, 1, 2] as any);
    expect(expr.evaluate().re).toBe(2);
    expect(expr.type.toString()).toBe('number');
  });

  test('a gather at a later step yields a list', () => {
    const expr = ce.box(['At', M, 1, ['List', 1, 2]] as any);
    expect(expr.evaluate().toString()).toBe('[1,2]');
    expect(expr.type.toString()).toBe('list<number>');
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
    // A gather is `list<T | marker(T)>`; numeric `T` absorbs to `number`.
    expect(expr.type.toString()).toBe('list<number>');
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

describe('Route parity with the GLSL lowering (`At` on the GPU)', () => {
  // `docs/plans/2026-08-01-at-gpu-compile-design.md` § D5: the shader lowering
  // is new, the interpreter and `_SYS.at` are untouched, and `_SYS.at` remains
  // the PARITY ORACLE — the GPU targets the same projection, so the two must
  // agree on every shape both can answer. Only fully constant-folded GPU
  // emissions can be compared here (jest runs no shader), which is exactly the
  // set of literal-base/literal-index shapes.
  const glsl = new GLSLTarget();

  /**
   * The value a constant-folded GLSL emission denotes.
   *
   * Anything else THROWS: falling through to `Number(s)` answered `NaN` for
   * every unrecognized emission, and the NaN-projection parities below would
   * then have passed against arbitrary source.
   */
  function glslFold(src: string): number | number[] {
    const s = src.trim();
    if (s === '_gpu_nan()') return NaN;
    const ctor = /^vec[234]\((.*)\)$/.exec(s);
    // Every component here is a float literal or `_gpu_nan()` — neither
    // contains a comma, so a flat split is enough.
    if (ctor !== null)
      return ctor[1].split(',').map((c) => glslFold(c) as number);
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s))
      throw new Error(
        `Not a constant-folded GLSL emission: \`${src}\` — the parity oracle ` +
          `can only compare a fold, and \`Number(…)\` would answer NaN for ` +
          `this and agree with the NaN projection by accident`
      );
    return Number(s);
  }

  /** Compiled JS === interpreted projection === the folded GLSL emission. */
  function tripleParity(expr: BoxedExpression): void {
    expect(glslFold(glsl.compile(expr).code!)).toEqual(parity(expr));
  }

  test('a scalar index agrees on both routes', () => {
    tripleParity(at(2)); // GLSL folds to `20.0`
    tripleParity(at(-1));
  });

  test('an out-of-band scalar index agrees on the NaN projection', () => {
    tripleParity(at(0));
    tripleParity(at(4));
  });

  // The interpreter leaves `At` UNEVALUATED here (no value at all). Parity is
  // against the PROJECTION of that — NaN — on both targets, never against the
  // unevaluated form.
  test('a non-integer scalar index agrees on the NaN projection', () => {
    expect(at(1.5).evaluate().operator).toBe('At');
    tripleParity(at(1.5));
  });

  test('a literal gather agrees, position-preservingly', () => {
    tripleParity(at(['List', 1, 3]));
    tripleParity(at(['List', 2, -1]));
    tripleParity(at(['List', 1, 9])); // → [10, NaN] / `vec2(10.0, _gpu_nan())`
  });

  test('a literal mask agrees', () => {
    tripleParity(at(['List', 'False', 'True', 'True']));
  });

  test('the JS route still lowers through `_SYS.at` (unchanged)', () => {
    expect(compile(at(2))!.code).toMatch(/_SYS\.at\(/);
    expect(compile(at(['List', 1, 3]))!.code).toMatch(/_SYS\.at\(/);
  });
});
