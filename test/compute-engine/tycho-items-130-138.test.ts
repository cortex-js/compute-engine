import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Tycho item 130 (follow-through) and item 138 — the POINT-LIST operators.
 *
 * The field witness is `min(distance(S, p))` over a list of points:
 * `Distance` broadcasts, one distance per point, on BOTH routes. Item 138
 * asked for the sibling operators to be aligned in the same pass:
 *
 *  - both SPELLINGS of a point list — a list of tuples `[(0,0),(3,4)]` and the
 *    list of lists `[[0,0],[3,4]]` a data import produces — reach the same
 *    answer for the point-ONLY operators (`Distance`, `PointX`/`PointY`/
 *    `PointZ`), which have no competing matrix meaning;
 *  - `Norm`/`Abs` of a list of TUPLES is one norm per point on both routes
 *    (the compiled route used to flatten / go component-wise behind
 *    `success: true`), while the list-of-LISTS spelling keeps its matrix
 *    semantics (Frobenius / element-wise `abs`) on both routes.
 *
 * Every table row is checked on the INTERPRETED and the COMPILED (js) route,
 * because the two disagreeing silently is the soundness hole item 138 reports.
 */

const ce = new ComputeEngine();

/** A list of points, tuple spelling. */
const S_TUPLES = ['List', ['Tuple', 0, 0], ['Tuple', 3, 4], ['Tuple', 6, 8]];
/** The same list of points, list-of-lists spelling (a data import). */
const S_LISTS = ['List', ['List', 0, 0], ['List', 3, 4], ['List', 6, 8]];
const P = ['Tuple', 1, 2];

/** The interpreted value as plain JSON (numbers / nested arrays). */
function interpreted(expr: any): unknown {
  const toPlain = (e: any): unknown => {
    if (e.operator === 'Error') return 'Error';
    if (e.operator === 'Tuple') return e.ops.map(toPlain);
    if (e.isFiniteCollection === true && e.isIndexedCollection === true)
      return [...e.each()].map(toPlain);
    return e.N().re;
  };
  return toPlain(ce.box(expr).evaluate());
}

/** The compiled (js) value, or the string `'declined'`. */
function compiled(expr: any): unknown {
  const boxed = ce.box(expr);
  if (!boxed.isValid) return 'declined';
  const r = compile(boxed, { fallback: true });
  if (!r?.success) return 'declined';
  return r.run?.({});
}

/** Both routes must answer the same thing — the item-138 soundness contract. */
function bothRoutes(expr: any): unknown {
  const i = interpreted(expr);
  const c = compiled(expr);
  expect(c).toEqual(i);
  return i;
}

describe('DISTANCE broadcasts over a point list (Tycho item 130)', () => {
  test('two points still answer one exact scalar', () => {
    expect(
      ce.box(['Distance', ['Tuple', 0, 0], ['Tuple', 1, 1]]).evaluate().toString()
    ).toBe('sqrt(2)');
    expect(bothRoutes(['Distance', ['Tuple', 0, 0], ['Tuple', 3, 4]])).toEqual(5);
  });

  test('Distance(S, p) — list of TUPLES', () => {
    expect(bothRoutes(['Distance', S_TUPLES, P])).toEqual([
      Math.sqrt(5),
      Math.sqrt(8),
      Math.sqrt(61),
    ]);
  });

  test('Distance(p, S) — the operand order is symmetric', () => {
    expect(bothRoutes(['Distance', P, S_TUPLES])).toEqual([
      Math.sqrt(5),
      Math.sqrt(8),
      Math.sqrt(61),
    ]);
  });

  test('Distance(S, p) — list of LISTS (the data-import spelling)', () => {
    expect(bothRoutes(['Distance', S_LISTS, P])).toEqual([
      Math.sqrt(5),
      Math.sqrt(8),
      Math.sqrt(61),
    ]);
    expect(bothRoutes(['Distance', P, S_LISTS])).toEqual([
      Math.sqrt(5),
      Math.sqrt(8),
      Math.sqrt(61),
    ]);
  });

  test('the broadcast result is exact under evaluate()', () => {
    expect(
      ce.box(['Distance', S_TUPLES, ['Tuple', 0, 0]]).evaluate().toString()
    ).toBe('[0,5,10]');
  });

  test('a flat numeric list is a POINT, not a list of points', () => {
    expect(bothRoutes(['Distance', ['List', 0, 0], ['List', 3, 4]])).toEqual(5);
  });

  test('two point lists zip PAIRWISE and must have the same length', () => {
    expect(
      bothRoutes([
        'Distance',
        S_TUPLES,
        ['List', ['Tuple', 0, 0], ['Tuple', 0, 0], ['Tuple', 0, 0]],
      ])
    ).toEqual([0, 5, 10]);
    // No truncation to the shortest (docs/BROADCAST-MODEL.md: a LIFTED
    // operator is strict): the interpreter errors, the compiled leg throws.
    const short = ['Distance', S_TUPLES, ['List', ['Tuple', 0, 0]]];
    expect(ce.box(short).evaluate().operator).toBe('Error');
    const r = compile(ce.box(short), { fallback: false });
    expect(() => r?.run?.({})).toThrow(/dimension mismatch/);
  });

  test('the result TYPE is a list when an operand is a point list', () => {
    expect(ce.box(['Distance', S_TUPLES, P]).type.toString()).toBe(
      'list<number>'
    );
    expect(ce.box(['Distance', S_LISTS, P]).type.toString()).toBe(
      'list<number>'
    );
    expect(ce.box(['Distance', P, P]).type.toString()).toBe('number');
  });

  test('the scalar/string boundary stays rejected', () => {
    expect(ce.box(['Distance', 3, 5]).evaluate().operator).toBe('Error');
    expect(ce.box(['Distance', { str: 'a' }, P]).evaluate().operator).toBe(
      'Error'
    );
    expect(ce.box(['Distance', P, { str: 'a' }]).evaluate().operator).toBe(
      'Error'
    );
    // A dimension mismatch between two points is an error, not a NaN
    expect(
      ce.box(['Distance', ['Tuple', 1, 2], ['Tuple', 1, 2, 3]]).evaluate()
        .operator
    ).toBe('Error');
  });

  test('min(Distance(S, p)) — the field witness — on both routes', () => {
    expect(ce.box(['Min', ['Distance', S_TUPLES, P]]).evaluate().toString()).toBe(
      'sqrt(5)'
    );
    expect(bothRoutes(['Min', ['Distance', S_TUPLES, P]])).toEqual(Math.sqrt(5));
    expect(bothRoutes(['Min', ['Distance', S_LISTS, P]])).toEqual(Math.sqrt(5));
  });

  // Route parity: a lazy/held operand reaches an evaluate handler unbound on
  // the box and parse routes but not through `ce.function(pre-boxed)`, so all
  // three are probed.
  test('box, parse and function routes agree', () => {
    const expected = ['List', 5, 5];
    const pts = ['List', ['Tuple', 0, 0], ['Tuple', 6, 8]];
    const q = ['Tuple', 3, 4];
    expect(ce.box(['Distance', pts, q]).evaluate().json).toEqual(expected);
    expect(
      ce
        .function('Distance', [ce.box(pts), ce.box(q)])
        .evaluate().json
    ).toEqual(expected);
    expect(
      ce
        .parse(
          '\\mathrm{Distance}(\\left\\lbrack (0,0),(6,8)\\right\\rbrack, (3,4))'
        )
        .evaluate().json
    ).toEqual(expected);
    // The list-of-lists spelling, through the parser too
    expect(
      ce
        .parse(
          '\\mathrm{Distance}(\\left\\lbrack \\left\\lbrack 0,0\\right\\rbrack,\\left\\lbrack 6,8\\right\\rbrack\\right\\rbrack, (3,4))'
        )
        .evaluate().json
    ).toEqual(expected);
  });
});

describe('POINT ACCESSORS over both spellings (Tycho item 138)', () => {
  const R_TUPLES = [
    'List',
    ['Tuple', 10, 11],
    ['Tuple', 20, 21],
    ['Tuple', 30, 31],
  ];
  const R_LISTS = [
    'List',
    ['List', 10, 11],
    ['List', 20, 21],
    ['List', 30, 31],
  ];

  test('PointX/PointY PROJECT a column over a list of lists (not a row)', () => {
    expect(bothRoutes(['PointX', R_TUPLES])).toEqual([10, 20, 30]);
    expect(bothRoutes(['PointX', R_LISTS])).toEqual([10, 20, 30]);
    expect(bothRoutes(['PointY', R_TUPLES])).toEqual([11, 21, 31]);
    expect(bothRoutes(['PointY', R_LISTS])).toEqual([11, 21, 31]);
  });

  test('the projected TYPE drops the inner dimension', () => {
    expect(ce.box(['PointX', R_LISTS]).type.toString()).toBe('vector<3>');
    expect(ce.box(['PointX', R_TUPLES]).type.toString()).toBe('vector<3>');
  });

  test('PointZ over a 3-D row list projects the third coordinate', () => {
    expect(
      bothRoutes(['PointZ', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]])
    ).toEqual([3, 6]);
    expect(
      bothRoutes([
        'PointZ',
        ['List', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]],
      ])
    ).toEqual([3, 6]);
  });

  // REVERSED (item 138 clarified ask, 2026-08-02): the 2026-07-22 ruling made
  // an out-of-band coordinate POSITION-PRESERVING — the numeric marker `NaN`
  // rather than `Nothing`, which would misalign the coordinate list. That
  // ruling weighed marker vs `Nothing` and never weighed a typed error. It
  // does now: a statically-absent component is a TYPE-level fact, so `PointZ`
  // of a provably 2-D point (or list of them) is `incompatible-dimensions` at
  // type-check time, and the compiled route fails closed on the invalid
  // expression. A 2-D document should never emit `PointZ` — reaching it is a
  // defect signal, and `NaN` hid it.
  test('PointZ over 2-D points is an incompatible-dimensions error, and js declines', () => {
    for (const e of [['PointZ', P], ['PointZ', S_TUPLES], ['PointZ', S_LISTS]]) {
      const boxed = ce.box(e as any);
      expect(boxed.isValid).toBe(false);
      expect(boxed.evaluate().toString()).toMatch(/incompatible-dimensions/);
      expect(compiled(e)).toBe('declined');
    }
  });

  test('a list of SCALARS still element-indexes, like First/Second', () => {
    expect(bothRoutes(['PointX', ['List', 7, 8, 9]])).toEqual(7);
    expect(bothRoutes(['PointY', ['List', 7, 8, 9]])).toEqual(8);
  });
});

describe('NORM / ABS of a point list agree on both routes (item 138)', () => {
  test('Norm of a list of TUPLES is one norm per point', () => {
    expect(bothRoutes(['Norm', S_TUPLES])).toEqual([0, 5, 10]);
    expect(ce.box(['Norm', S_TUPLES]).evaluate().toString()).toBe('[0,5,10]');
    expect(ce.box(['Norm', S_TUPLES]).type.toString()).toBe('list<number>');
  });

  test('Abs of a list of TUPLES is one norm per point', () => {
    expect(bothRoutes(['Abs', S_TUPLES])).toEqual([0, 5, 10]);
  });

  test('an explicit norm order broadcasts per point too', () => {
    expect(bothRoutes(['Norm', S_TUPLES, 1])).toEqual([0, 7, 14]);
  });

  // The list-of-lists spelling is a MATRIX: `Norm` is its Frobenius norm and
  // `Abs` is element-wise. Unlike the point-only accessors, these two heads
  // have a competing matrix meaning, and it wins — on both routes.
  test('Norm of a list of LISTS stays the Frobenius norm', () => {
    expect(bothRoutes(['Norm', S_LISTS])).toBeCloseTo(Math.sqrt(125), 10);
    expect(ce.box(['Norm', S_LISTS]).evaluate().toString()).toBe('5sqrt(5)');
    expect(
      bothRoutes(['Norm', ['List', ['List', 3, 0], ['List', 0, 4]]])
    ).toEqual(5);
  });

  test('Abs of a list of LISTS stays element-wise', () => {
    expect(bothRoutes(['Abs', S_LISTS])).toEqual([
      [0, 0],
      [3, 4],
      [6, 8],
    ]);
  });

  test('a single point and a plain vector are unchanged', () => {
    expect(bothRoutes(['Norm', ['Tuple', 3, 4]])).toEqual(5);
    expect(bothRoutes(['Abs', ['Tuple', 3, 4]])).toEqual(5);
    expect(bothRoutes(['Norm', ['List', 3, 4]])).toEqual(5);
    expect(bothRoutes(['Abs', ['List', 3, -4]])).toEqual([3, 4]);
  });

  test('a DECLARED point-list symbol compiles to the per-point norm', () => {
    const e = new ComputeEngine();
    e.declare('P', 'list<tuple<number, number>>');
    for (const head of ['Norm', 'Abs']) {
      const r = compile(e.box([head, 'P']), { fallback: false });
      expect(r?.success).toBe(true);
      expect(r?.run?.({ P: [[0, 0], [3, 4]] })).toEqual([0, 5]);
    }
  });

  // Every non-JS target declines rather than answer a flattened scalar or a
  // component-wise array (the GPU targets already declined; python's
  // `np.linalg.norm` would have flattened).
  test('the other targets fail closed on a point list', () => {
    const e = new ComputeEngine();
    for (const lang of ['glsl', 'wgsl', 'python', 'interval-js']) {
      const target = e.getCompilationTarget(lang as any);
      for (const head of ['Norm', 'Abs']) {
        expect(
          target.compile(e.box([head, S_TUPLES]), { fallback: true }).success
        ).toBe(false);
      }
      expect(
        target.compile(e.box(['Distance', S_TUPLES, P]), { fallback: true })
          .success
      ).toBe(false);
    }
  });
});

/**
 * Item 138, part 3 (clarified ask, 2026-08-02).
 *
 * `PointZ` of a point with no z-coordinate is a DIMENSION mismatch, not an
 * absent slot: it answers a typed `incompatible-dimensions` error.
 *
 *  - STATIC (type-check time) when the operand type PROVES the point is 2-D —
 *    `tuple<number, number>`, a list/set of such, or a rank-2 numeric tensor
 *    whose rows are 2 wide. The expression is then invalid, so every compile
 *    target fails closed on it (an honest decline: a 2-D document should never
 *    emit `PointZ`, and reaching it is the consumer's defect signal).
 *  - EVALUATION time when the type was not decisive (a bare `tuple`, a
 *    `list<tuple>`, an `unknown`-declared symbol) but the concrete value is
 *    2-D. The WHOLE application errors — not one marker per point.
 *  - The COMPILED numeric kernel keeps the `NaN` absence marker for the
 *    residual dynamically-shaped case (see the DOMAIN-conditional pin in
 *    `pointlist-compile-zip.test.ts`); GLSL cannot throw.
 *
 * Scope: `PointZ` only. `PointX`/`PointY`, and every 3-D point, are unchanged.
 */
describe('POINTZ on a 2-D point is a dimension error (item 138 part 3)', () => {
  const TWO_D_STATIC: [string, any][] = [
    ['a single tuple', ['Tuple', 1, 2]],
    ['a list of 2-tuples', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
    ['a set of 2-tuples', ['Set', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
    ['a list of 2-element coordinate rows', S_LISTS],
  ];

  test.each(TWO_D_STATIC)('STATIC: PointZ of %s errors at type-check time', (
    _label,
    operand
  ) => {
    const e = new ComputeEngine();
    const boxed = e.box(['PointZ', operand]);
    expect(boxed.isValid).toBe(false);
    expect(boxed.toString()).toMatch(/incompatible-dimensions/);
    // `.evaluate()` propagates the same error — no second, different answer.
    expect(boxed.evaluate().toString()).toMatch(/incompatible-dimensions/);
  });

  test('STATIC: the js compile of a statically-2-D PointZ declines', () => {
    const e = new ComputeEngine();
    for (const [, operand] of TWO_D_STATIC) {
      const boxed = e.box(['PointZ', operand]);
      expect(boxed.isValid).toBe(false);
      expect(compiled(['PointZ', operand])).toBe('declined');
      expect(compile(boxed, { fallback: true })?.success).not.toBe(true);
    }
  });

  test('STATIC: a declared `tuple<number, number>` symbol errors unbound', () => {
    const e = new ComputeEngine();
    e.declare('p2', 'tuple<number, number>');
    expect(e.box(['PointZ', 'p2']).isValid).toBe(false);
  });

  test('EVALUATE: a loosely-typed operand holding a 2-tuple errors on evaluation', () => {
    const e = new ComputeEngine();
    e.declare('u', 'unknown');
    e.assign('u', e.box(['Tuple', 1, 2]));
    const boxed = e.box(['PointZ', 'u']);
    // The declared type proves nothing, so type-check stays INERT…
    expect(boxed.isValid).toBe(true);
    // …and the concrete value is what errors.
    expect(boxed.evaluate().toString()).toMatch(/incompatible-dimensions/);
  });

  test('EVALUATE: a `list<tuple>` of 2-tuples errors ONCE, not per point', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<tuple>');
    e.assign('L', e.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    const boxed = e.box(['PointZ', 'L']);
    expect(boxed.isValid).toBe(true);
    const r = boxed.evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/incompatible-dimensions/);
  });

  test('INERT: an unknown / unbound operand is neither error nor marker', () => {
    const e = new ComputeEngine();
    e.declare('bt', 'tuple');
    e.declare('lt', 'list<number> | tuple<number, number>');
    for (const s of ['bt', 'lt']) {
      const boxed = e.box(['PointZ', s]);
      expect(boxed.isValid).toBe(true);
      expect(boxed.evaluate().toString()).not.toMatch(/incompatible-dimensions/);
    }
  });

  test('UNCHANGED: 3-D points still project, on both routes and spellings', () => {
    expect(bothRoutes(['PointZ', ['Tuple', 1, 2, 3]])).toEqual(3);
    expect(
      bothRoutes(['PointZ', ['List', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]]])
    ).toEqual([3, 6]);
    expect(
      bothRoutes(['PointZ', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]])
    ).toEqual([3, 6]);
  });

  test('UNCHANGED: PointX/PointY on 2-D points, and element indexing', () => {
    expect(bothRoutes(['PointX', P])).toEqual(1);
    expect(bothRoutes(['PointY', P])).toEqual(2);
    expect(bothRoutes(['PointX', S_TUPLES])).toEqual([0, 3, 6]);
    expect(bothRoutes(['PointY', S_LISTS])).toEqual([0, 4, 8]);
    // A list of SCALARS still element-indexes, like First/Second/Third — a
    // 2-element numeric list is NOT a point here, so `PointZ` keeps the
    // out-of-range marker rather than erroring.
    expect(ce.box(['PointZ', ['List', 7, 8, 9]]).evaluate().json).toEqual(9);
    expect(ce.box(['PointZ', ['List', 7, 8]]).isValid).toBe(true);
  });

  test('ROUTE PARITY: box and parse agree', () => {
    const e = new ComputeEngine();
    expect(e.parse('(1,2).z').isValid).toBe(false);
    expect(e.parse('(1,2).z').toString()).toMatch(/incompatible-dimensions/);
    expect(e.parse('(1,2,3).z').evaluate().json).toEqual(3);
    expect(e.parse('(1,2).x').evaluate().json).toEqual(1);
  });
});
