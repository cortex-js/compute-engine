import { ComputeEngine } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

/**
 * Which route a compiled point-coordinate accessor takes over a NON-EMPTY
 * collection.
 *
 * `PointX`/`PointY`/`PointZ` have two readings. A collection of POINTS
 * broadcasts: `PointX([(1,2),(3,4)])` is `[1,3]`. A FLAT scalar list is read by
 * element index — one point spelled flat for a numeric list (`PointX([3,4])` is
 * `3`), the First/Second/Third fallback for a non-numeric one
 * (`PointX(["a","b"])` is `"a"`).
 *
 * The interpreter (`pointComponentAt`, `library/collections.ts`) picks the
 * reading from the CONCRETE elements, not from the declared type. So the
 * compiled code may settle it statically only where the type PROVES one
 * reading, and must hand every other operand to the run-time dispatch
 * `_SYS.pointComponent`, which reads the value exactly as the interpreter does.
 * The static gate therefore fails OPEN (`mayBePointList`): it settles on the
 * direct index only for an element type no point can have — a scalar one, and
 * a row type whose cells the type proves non-numeric (`list<list<string>>`),
 * since a row is a point only when every cell holds a number.
 *
 * A gate that fails CLOSED reads a list of points as ONE point and answers its
 * first ROW: `PointX(L)` over `[[1,2],[3,4]]` answered `[1,2]` where the
 * interpreter answers `[1,3]`, for every element type that is neither provably
 * numeric nor a declared tuple — `list<list<any>>`, and a union of a number
 * with a tuple.
 *
 * The EMPTY case is a different question with a stricter answer, because no
 * route has an element to look at there: see
 * `point-accessor-empty-list.test.ts`. The two answers disagree for a nested
 * element type — a `list<list<any>>` broadcasts when its rows hold numbers, and
 * element-indexes when it is empty — so the compiled operand takes the run-time
 * dispatch AND carries the empty-case answer into it (the third argument of
 * `_SYS.pointComponent`). The last block below pins that parity.
 */

const ROWS_JSON = ['List', ['List', 1, 2], ['List', 3, 4]];
const TUPLES_JSON = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
const ROWS_RUN = [
  [1, 2],
  [3, 4],
];

/** The interpreter's answer for `PointX(sym)` with `sym` declared `type` and
 *  bound to `value`. */
function interpreted(name: string, type: string, value: any): string {
  const ce = new ComputeEngine();
  ce.declare(name, type as any);
  ce.assign(name, ce.box(value));
  return ce.box(['PointX', name]).evaluate().toString();
}

describe('compiled point accessor — the non-empty dispatch fails open', () => {
  const js = new JavaScriptTarget();

  test('a list of rows typed `list<list<any>>` broadcasts', () => {
    // `list<any>` elements are not provably scalar, so the reading belongs to
    // the value. Failing closed here answered the first row, `[1, 2]`.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<list<any>>');
    const r = js.compile(ce.box(['PointX', 'L']));
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.pointComponent(_.L, 0');
    expect((r.run as (s: any) => unknown)({ L: ROWS_RUN })).toEqual([1, 3]);
    expect(interpreted('L', 'list<list<any>>', ROWS_JSON)).toBe('[1,3]');
  });

  test('a union of a number and a tuple broadcasts', () => {
    // `number | tuple<number, number>` admits a point, so the value decides.
    const ce = new ComputeEngine();
    ce.declare('M', 'list<number | tuple<number,number>>');
    const r = js.compile(ce.box(['PointX', 'M']));
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.pointComponent(_.M, 0');
    expect((r.run as (s: any) => unknown)({ M: ROWS_RUN })).toEqual([1, 3]);
    expect(
      interpreted('M', 'list<number | tuple<number,number>>', TUPLES_JSON)
    ).toBe('[1,3]');
  });

  test('a union of collection and tuple spellings keeps the dispatch', () => {
    // The carrier type a point-list producer hands a consumer: the operand may
    // be one point or a list of them, and only the value says which.
    const t =
      'indexed_collection<tuple<number,number>> | list<tuple<number,number>> | tuple<number,number>';
    const ce = new ComputeEngine();
    ce.declare('U', t);
    const r = js.compile(ce.box(['PointX', 'U']));
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.pointComponent(_.U, 0)');
    expect((r.run as (s: any) => unknown)({ U: ROWS_RUN })).toEqual([1, 3]);
    expect(interpreted('U', t, TUPLES_JSON)).toBe('[1,3]');
    // One point, through the same emitted code.
    expect((r.run as (s: any) => unknown)({ U: [3, 4] })).toBe(3);
  });

  test('a numeric element type keeps the direct index — one flat point', () => {
    // `number` proves no element is a point, so the flat-point reading is
    // settled statically and costs no dispatch.
    const ce = new ComputeEngine();
    ce.declare('N', 'list<number>');
    const r = js.compile(ce.box(['PointX', 'N']));
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.pointComponent');
    expect((r.run as (s: any) => unknown)({ N: [3, 4] })).toBe(3);
    expect(interpreted('N', 'list<number>', ['List', 3, 4])).toBe('3');
  });

  test('a string element type keeps the direct index — element access', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'list<string>');
    const r = js.compile(ce.box(['PointX', 'S']));
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.pointComponent');
    expect((r.run as (s: any) => unknown)({ S: ['a', 'b'] })).toBe('a');
  });

  test('a STRING operand answers its first character', () => {
    // A string is an indexed collection whose elements are characters, never
    // points, so it takes the direct index — and the run-time dispatch would
    // answer `NaN` for it, since a string is not a JS array.
    const ce = new ComputeEngine();
    ce.declare('s', 'string');
    const r = js.compile(ce.box(['PointX', 's']));
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.pointComponent');
    expect((r.run as (s: any) => unknown)({ s: 'abc' })).toBe('a');
    const ce2 = new ComputeEngine();
    expect(
      ce2
        .box(['PointX', ['String', "'abc'"]])
        .evaluate()
        .toString()
    ).toBe('"a"');
  });

  test('a list of rows the type proves non-numeric keeps the direct index', () => {
    // A row of strings is not a point (`isPointLike` admits a row only when
    // its element type is a subtype of `number`), so the type PROVES the
    // element-index reading here, one level down, exactly as a scalar element
    // type proves it one level up. The operand must therefore stay off the
    // dispatch: that dispatch reads an empty array as a list of no points, and
    // the direct route answers the absence marker the interpreter answers —
    // `undefined`, the projection for a coordinate the type proves non-numeric
    // (pinned in the empty-case block below and in
    // `point-accessor-empty-list.test.ts`).
    const ce = new ComputeEngine();
    ce.declare('R', 'list<list<string>>');
    const r = js.compile(ce.box(['PointX', 'R']));
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.pointComponent');
    expect((r.run as (s: any) => unknown)({ R: [['a'], ['b']] })).toEqual([
      'a',
    ]);
    expect(
      interpreted('R', 'list<list<string>>', [
        'List',
        ['List', ['String', "'a'"]],
        ['List', ['String', "'b'"]],
      ])
    ).toBe('["a"]');
  });

  test('a row of MIXED cells is no point, on both routes', () => {
    // The dispatch classifies the first row by ALL of its cells, as
    // `isPointLike` does: a row is a point only when every cell holds a
    // number. Testing the first cell alone answered the coordinate list
    // `[1, 3]` for `[[1, "a"], [3, "b"]]`, where the interpreter answers the
    // first ROW. The declared type cannot settle this — `list<list<any>>`
    // admits both — so the value has to.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<list<any>>');
    const r = js.compile(ce.box(['PointX', 'L']));
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.pointComponent(_.L, 0');
    expect(
      (r.run as (s: any) => unknown)({
        L: [
          [1, 'a'],
          [3, 'b'],
        ],
      })
    ).toEqual([1, 'a']);
    // The interpreter, on the value itself. A mixed row is not assignable to a
    // symbol declared `list<list<any>>` — the literal types as a rank-2
    // `list<integer | string>` — and the reading is taken from the value in
    // any case, so the literal is the operand here.
    const ce2 = new ComputeEngine();
    expect(
      ce2
        .box([
          'PointX',
          [
            'List',
            ['List', 1, ['String', "'a'"]],
            ['List', 3, ['String', "'b'"]],
          ],
        ])
        .evaluate()
        .toString()
    ).toBe('[1,"a"]');
    // The all-numeric rows the same emitted code broadcasts over.
    expect((r.run as (s: any) => unknown)({ L: ROWS_RUN })).toEqual([1, 3]);
  });
});

describe('compiled point accessor — the dispatch carries the empty reading', () => {
  const js = new JavaScriptTarget();

  test('an element type that indexes when empty answers the absence marker', () => {
    // Both readings spell an empty collection `[]`, so the value cannot settle
    // that case and the declared element type does — as it does in the
    // interpreter. `list<list<any>>` and `number | tuple<…>` element-index when
    // empty, so the coordinate is absent: `NaN`, this target's projection of
    // the interpreter's `Missing`.
    for (const [name, type] of [
      ['L', 'list<list<any>>'],
      ['M', 'list<number | tuple<number,number>>'],
    ]) {
      const ce = new ComputeEngine();
      ce.declare(name, type as any);
      const r = js.compile(ce.box(['PointX', name]));
      expect(r.success).toBe(true);
      expect(r.code).toContain(`_SYS.pointComponent(_.${name}, 0, false)`);
      expect((r.run as (s: any) => unknown)({ [name]: [] })).toBeNaN();
      expect(interpreted(name, type, ['List'])).toBe('"Missing"');
    }
  });

  test('a row type proved non-numeric answers the marker off the direct route', () => {
    // `list<list<string>>` element-indexes when empty too, but it never
    // reaches the dispatch: its rows hold no coordinates, so the type settles
    // the non-empty reading as well and the operand takes the direct access.
    // The marker there is the DOMAIN-aware one — `undefined` for a coordinate
    // the type proves non-numeric, not the numeric `NaN`
    // (`pointComponentAbsence`) — which is the same marker the flat
    // `list<string>` case answers in `point-accessor-empty-list.test.ts`.
    const ce = new ComputeEngine();
    ce.declare('R', 'list<list<string>>');
    const r = js.compile(ce.box(['PointX', 'R']));
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.pointComponent');
    expect((r.run as (s: any) => unknown)({ R: [] })).toBeUndefined();
    expect(interpreted('R', 'list<list<string>>', ['List'])).toBe('"Missing"');
  });

  test('an element type that broadcasts when empty answers the empty list', () => {
    // A tuple element type, an unknown one, and an operand whose type states no
    // element type at all: the empty coordinate list, on both routes. The
    // broadcast reading is the dispatch default and is left unspoken.
    const t =
      'indexed_collection<tuple<number,number>> | list<tuple<number,number>> | tuple<number,number>';
    for (const [name, type] of [
      ['U', t],
      ['B', 'list'],
      ['V', 'unknown'],
    ]) {
      const ce = new ComputeEngine();
      ce.declare(name, type as any);
      const r = js.compile(ce.box(['PointX', name]));
      expect(r.success).toBe(true);
      expect(r.code).toContain(`_SYS.pointComponent(_.${name}, 0)`);
      expect((r.run as (s: any) => unknown)({ [name]: [] })).toEqual([]);
      expect(interpreted(name, type, ['List'])).toBe('[]');
    }
  });
});
