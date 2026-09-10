import { ComputeEngine } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

/**
 * A point-coordinate accessor over an EMPTY collection.
 *
 * `PointX`/`PointY`/`PointZ` have two readings of a numeric collection. A
 * collection of POINTS broadcasts: `PointX([(1,2),(3,4)])` is `[1,3]`. A FLAT
 * numeric list is ONE point spelled flat: `PointX([3,4])` is `3`, element one.
 * The element type picks the reading.
 *
 * An empty collection has no element to look at, so the DECLARED element type
 * picks it there, and it picks the reading the NON-EMPTY case with that same
 * element type would take:
 *
 *  - a POINT-shaped element type (a tuple element, or the coordinate-row
 *    spelling `[[0,0],[3,4]]`), the bottom element type `never` (what the
 *    literal `[]` and an empty `Set()` carry) and an UNKNOWN element type (a
 *    bare `list`, a `list<any>`, an `unknown`-typed operand, which the
 *    compiled route decides at run time) all broadcast over zero points. The
 *    coordinate list of no points is `[]`. Desmos agrees (`[].x` is `[]`), and
 *    `2 · []` is `[]` in turn;
 *  - a NUMERIC element type is the flat-point reading, so an empty
 *    `list<number>` is a point whose coordinates are all absent and the
 *    accessor answers the position-preserving marker `Missing`, typed
 *    `number` — which a numeric consumer projects to `NaN`;
 *  - any OTHER element type element-indexes when non-empty
 *    (`PointX(["a","b"])` is `"a"`), so it indexes when empty too and answers
 *    the marker.
 *
 * The accessors used to read EVERY empty collection as an element ACCESS —
 * there is no first element to peek, so the broadcast-vs-index decision fell
 * to the index arm — and answered `Missing`. With the absence rule of 0.128.0,
 * where `Add`/`Multiply` absorb an evaluated `Missing` into `NaN`,
 * `2 · PointX([])` then evaluated to the scalar `NaN` (on 0.127.0 the product
 * stayed symbolic, which was wrong in its own way).
 *
 * A STRING is the remaining exception: its elements are characters, never
 * points, so the accessors element-index it (`PointX("abc")` is `"a"`) and an
 * empty string keeps the marker, as `First("")` does.
 */

describe('point accessors over an empty collection — interpreter', () => {
  test('every accessor position answers the empty list', () => {
    const ce = new ComputeEngine();
    for (const head of ['PointX', 'PointY', 'PointZ']) {
      const expr = ce.box([head, ['List']]);
      expect(expr.evaluate().toString()).toBe('[]');
      // The empty list literal itself types `list<never>`; the accessor
      // answers that same type, in the type handler and in the value.
      expect(expr.type.toString()).toBe('list<never>');
      expect(expr.evaluate().type.toString()).toBe('list<never>');
    }
    expect(ce.box(['List']).type.toString()).toBe('list<never>');
  });

  test('a product with the empty coordinate list stays a list', () => {
    // The pin the defect report is about: `NaN` before the fix.
    const ce = new ComputeEngine();
    const expr = ce.box(['Multiply', 2, ['PointX', ['List']]]);
    expect(expr.evaluate().toString()).toBe('[]');
    expect(expr.evaluate().type.toString()).toBe('list<never>');
  });

  test('`.N()` answers the empty list too', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['PointX', ['List']]).N().toString()).toBe('[]');
  });

  test('a non-empty list is read exactly as before', () => {
    const ce = new ComputeEngine();
    // A list of points broadcasts...
    expect(
      ce.box(['PointX', ['List', ['Tuple', 1, 2]]]).evaluate().toString()
    ).toBe('[1]');
    // ...while a flat list of numbers is ONE point, read by element index.
    expect(ce.box(['PointX', ['List', 3, 4]]).evaluate().toString()).toBe('3');
    expect(ce.box(['PointX', ['List', 3]]).evaluate().toString()).toBe('3');
    expect(ce.box(['PointY', ['List', 3, 4]]).evaluate().toString()).toBe('4');
  });

  test('an empty Set answers the empty list', () => {
    // A Set is not indexed, so the element-index reading was an
    // `incompatible-type` error here, not even the marker.
    const ce = new ComputeEngine();
    const expr = ce.box(['PointX', ['Set']]);
    expect(expr.evaluate().toString()).toBe('[]');
    expect(expr.type.toString()).toBe('list<never>');
  });

  test('a collection that BECAME empty answers the empty list', () => {
    const ce = new ComputeEngine();
    // The symbolic `PointList` form of an empty point list.
    expect(
      ce
        .box(['PointX', ['PointList', ['List'], ['List']]])
        .evaluate()
        .toString()
    ).toBe('[]');
    // A `Map` over no elements, and a `Filter` that kept none.
    expect(
      ce
        .box(['PointX', ['Map', ['Function', 'p', 'p'], ['List']]])
        .evaluate()
        .toString()
    ).toBe('[]');
    expect(
      ce
        .box([
          'PointX',
          ['Filter', ['List', ['Tuple', 1, 2]], ['Function', 'False', 'p']],
        ])
        .evaluate()
        .toString()
    ).toBe('[]');
  });

  test('a declared list of points bound to the empty list', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<tuple<number,number>>');
    ce.assign('L', ce.box(['List']));
    expect(ce.box(['PointX', 'L']).evaluate().toString()).toBe('[]');
    expect(
      ce.box(['Multiply', 2, ['PointX', 'L']]).evaluate().toString()
    ).toBe('[]');
  });

  test('an empty `list<number>` is one FLAT point, not a list of none', () => {
    // The flat-point reading: `PointX([3, 4])` is `3`, so an empty
    // `list<number>` is that point with every coordinate absent. The value and
    // the static type agree — a mismatch is what this pin is here to catch.
    const ce = new ComputeEngine();
    ce.declare('v', 'list<number>');
    ce.assign('v', ce.box(['List']));
    for (const head of ['PointX', 'PointY', 'PointZ']) {
      const expr = ce.box([head, 'v']);
      expect(expr.type.toString()).toBe('number');
      expect(expr.evaluate().toString()).toBe('"Missing"');
    }
    // A numeric consumer projects the marker to `NaN`, which is the value the
    // compiled route answers for the same input.
    expect(
      ce.box(['Multiply', 2, ['PointX', 'v']]).evaluate().toString()
    ).toBe('NaN');
  });

  test('an empty `list<string>` element-indexes, like a full one', () => {
    // A string element type is not point-shaped, so the accessors element-index
    // such a collection: `PointX(["a","b"])` is `"a"`, the First/Second/Third
    // fallback. Removing the last element cannot change that reading, so the
    // empty one indexes as well and answers the absence marker — and the marker
    // is what the type says, `missing | string`. Answering `[]` here would
    // contradict both the non-empty reading and the type.
    const ce = new ComputeEngine();
    ce.declare('S', 'list<string>');
    ce.assign('S', ce.box(['List']));
    const expr = ce.box(['PointX', 'S']);
    expect(expr.type.toString()).toBe('missing | string');
    expect(expr.evaluate().toString()).toBe('"Missing"');
    // The non-empty reading it has to agree with.
    expect(
      ce
        .box(['PointX', ['List', ['String', "'a'"], ['String', "'b'"]]])
        .evaluate()
        .toString()
    ).toBe('"a"');
  });

  test('a point-shaped or unknown element type still broadcasts', () => {
    // The other two arms of the rule, against the `list<string>` case above:
    // a coordinate-ROW element type is point-shaped, and a bare `list` says
    // nothing about its elements.
    const ce = new ComputeEngine();
    ce.declare('R', 'list<list<number>>');
    ce.assign('R', ce.box(['List']));
    expect(ce.box(['PointX', 'R']).evaluate().toString()).toBe('[]');
    ce.declare('U', 'list');
    ce.assign('U', ce.box(['List']));
    expect(ce.box(['PointX', 'U']).evaluate().toString()).toBe('[]');
  });

  test('an empty STRING keeps the absence marker', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['PointX', "''"]).evaluate().toString()).toBe('"Missing"');
    // ...because a string is element-indexed, not broadcast over.
    expect(ce.box(['PointX', ["String", "'abc'"]]).evaluate().toString()).toBe(
      '"a"'
    );
  });

  test('`First` of an empty list is unchanged', () => {
    // The accessors broadcast; `First`/`Second`/`Third` index, and an empty
    // collection has no first element.
    const ce = new ComputeEngine();
    expect(ce.box(['First', ['List']]).evaluate().toString()).toBe('"Missing"');
  });
});

describe('point accessors over an empty collection — compiled JavaScript', () => {
  const js = new JavaScriptTarget();

  test('an empty literal list compiles to the empty list', () => {
    const ce = new ComputeEngine();
    for (const head of ['PointX', 'PointY', 'PointZ']) {
      const r = js.compile(ce.box([head, ['List']]));
      expect(r.success).toBe(true);
      const run = r.run as () => unknown;
      expect(run()).toEqual([]);
      // Interpreter parity: the same empty list.
      expect(ce.box([head, ['List']]).evaluate().toString()).toBe('[]');
    }
  });

  test('a declared list of points bound to `[]` at run time', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<tuple<number,number>>');
    const r = js.compile(ce.box(['PointX', 'L']));
    expect(r.success).toBe(true);
    const run = r.run as (s: Record<string, unknown>) => unknown;
    expect(run({ L: [] })).toEqual([]);
    expect(run({ L: [[1, 2], [3, 4]] })).toEqual([1, 3]);
  });

  test('an operand whose shape is settled at RUN time', () => {
    // An `unknown`-typed operand takes the `_SYS.pointComponent` dispatch,
    // which decides point-vs-list on the value: an empty array is the empty
    // list of points, so every coordinate of it is the empty list. The
    // flat-point reading cannot reach that dispatch — it is asked for by an
    // element type that proves numbers, and such an operand is settled
    // statically (see the `list<number>` case below).
    const ce = new ComputeEngine();
    ce.declare('v', 'unknown');
    for (const head of ['PointX', 'PointY', 'PointZ']) {
      const r = js.compile(ce.box([head, 'v']));
      expect(r.success).toBe(true);
      const run = r.run as (s: Record<string, unknown>) => unknown;
      expect(run({ v: [] })).toEqual([]);
    }
  });

  test('a declared `list<number>` keeps the direct-index route', () => {
    // The flat-point reading compiles to `v[k] ?? NaN`, so an empty array
    // answers `NaN` — the numeric projection of the interpreter's `Missing`,
    // and the parity the two routes are meant to hold.
    const ce = new ComputeEngine();
    ce.declare('v', 'list<number>');
    const r = js.compile(ce.box(['PointX', 'v']));
    expect(r.success).toBe(true);
    const run = r.run as (s: Record<string, unknown>) => unknown;
    expect(run({ v: [] })).toBeNaN();
    // The non-empty flat point is element one, unchanged.
    expect(run({ v: [3, 4] })).toBe(3);

    const ce2 = new ComputeEngine();
    ce2.declare('v', 'list<number>');
    ce2.assign('v', ce2.box(['List']));
    expect(
      ce2.box(['Multiply', 2, ['PointX', 'v']]).evaluate().toString()
    ).toBe('NaN');
  });

  test('a declared `list<string>` keeps the direct-index route too', () => {
    // An element type that element-indexes must not reach `_SYS.pointComponent`
    // — that dispatch decides on the VALUE, and it reads an empty array as a
    // list of no points, which would answer `[]` where the interpreter answers
    // the marker. The direct access answers the marker instead: for a coordinate
    // the type proves NON-numeric, this target's absence value is `undefined`
    // rather than `NaN` (`pointComponentAbsence`).
    const ce = new ComputeEngine();
    ce.declare('S', 'list<string>');
    const r = js.compile(ce.box(['PointX', 'S']));
    expect(r.success).toBe(true);
    const run = r.run as (s: Record<string, unknown>) => unknown;
    expect(run({ S: [] })).toBeUndefined();
    expect(run({ S: ['a', 'b'] })).toBe('a');
  });
});
