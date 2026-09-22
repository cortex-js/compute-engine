import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * `Dot` broadcasts over a LIST OF POINTS (user ruling of 2026-09-22).
 *
 * A point list has two spellings and they must answer the same list. The
 * tuple spelling `(1, L)` with `L` a list of numbers is ONE point whose
 * coordinates broadcast; the `PointList(1, L)` spelling is a LIST of points,
 * which typed `error` before this ruling because `Dot` had no arm for a list
 * of points against a point. Both now answer `list<number>` — the inner
 * product of each point against the other operand.
 *
 * Two lists of points pair element by element; a mismatch in the number of
 * points, or in the width of a pair, is `incompatible-dimensions` (the
 * lifted-operator rule of `docs/BROADCAST-MODEL.md`).
 *
 * NOTE: declaring or assigning a symbol retypes it for the engine's lifetime,
 * so each block builds a FRESH engine rather than share one.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', 1, 2]));
  return ce;
}

/** The inner product as the interpreter answers it. */
function evaluated(expr: MathJsonExpression): string {
  return engine().box(expr).evaluate().toString();
}

/** The point list `PointList(1, L)` — the points `(1, 1)` and `(1, 2)`. */
const POINT_LIST: MathJsonExpression = ['PointList', 1, 'L'];
/** The same two points written out, so no symbol is needed. */
const LITERAL_POINT_LIST: MathJsonExpression = [
  'List',
  ['Tuple', 1, 1],
  ['Tuple', 1, 2],
];
/** The point `(3, 4)`, written with each spelling in turn. */
const POINT: MathJsonExpression = ['PointList', 3, 4];
const TUPLE_POINT: MathJsonExpression = ['Tuple', 3, 4];

describe('Dot over a list of points', () => {
  describe('the two spellings agree', () => {
    test('the tuple spelling types a list of numbers', () => {
      const e = engine().box(['Dot', ['Tuple', 1, 'L'], TUPLE_POINT]);
      expect(e.type.matches('list<number>')).toBe(true);
      expect(e.evaluate().toString()).toBe('[7,11]');
    });

    test('the PointList spelling types a list of numbers (was `error`)', () => {
      const e = engine().box(['Dot', POINT_LIST, POINT]);
      expect(e.isValid).toBe(true);
      expect(e.type.matches('list<number>')).toBe(true);
    });

    test('the PointList spelling evaluates to the same list (was an error)', () => {
      expect(evaluated(['Dot', POINT_LIST, POINT])).toBe('[7,11]');
    });

    test('.N() of the PointList spelling gives the same list', () => {
      expect(
        engine().box(['Dot', POINT_LIST, POINT]).N().toString()
      ).toBe('[7,11]');
    });

    test('an inexact coordinate numericizes under .N()', () => {
      const ce = new ComputeEngine();
      ce.assign('L', ce.box(['List', 1.5, 2]));
      const e = ce.box(['Dot', ['PointList', 1, 'L'], POINT]);
      expect(e.N().toString()).toBe('[9,11]');
    });

    test('the point may be written as a plain tuple', () => {
      expect(evaluated(['Dot', POINT_LIST, TUPLE_POINT])).toBe('[7,11]');
    });
  });

  describe('the point operand is lifted over the list, in either order', () => {
    test('a list of points against a point', () => {
      expect(evaluated(['Dot', LITERAL_POINT_LIST, TUPLE_POINT])).toBe(
        '[7,11]'
      );
    });

    test('a point against a list of points answers the same list', () => {
      expect(evaluated(['Dot', TUPLE_POINT, LITERAL_POINT_LIST])).toBe(
        '[7,11]'
      );
    });

    test('the flipped order types a list of numbers too', () => {
      const e = engine().box(['Dot', POINT, POINT_LIST]);
      expect(e.type.matches('list<number>')).toBe(true);
    });
  });

  describe('two lists of points pair element by element', () => {
    test('same length answers the element-wise inner products', () => {
      expect(
        evaluated([
          'Dot',
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
          ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
        ])
      ).toBe('[17,53]');
    });

    test('the PointList spelling pairs the same way', () => {
      expect(evaluated(['Dot', POINT_LIST, POINT_LIST])).toBe('[2,5]');
    });

    test('a different number of points is incompatible-dimensions', () => {
      expect(
        evaluated([
          'Dot',
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
          ['List', ['Tuple', 5, 6]],
        ])
      ).toBe('Error("incompatible-dimensions", "2 vs 1")');
    });

    test('points of different widths are incompatible-dimensions', () => {
      expect(
        evaluated([
          'Dot',
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
          ['Tuple', 5, 6, 7],
        ])
      ).toBe('Error("incompatible-dimensions", "2 vs 3")');
    });
  });

  describe('the unchanged routes', () => {
    test('two points still answer a number', () => {
      const e = engine().box(['Dot', ['Tuple', 1, 2], TUPLE_POINT]);
      expect(e.type.toString()).toBe('integer');
      expect(e.evaluate().toString()).toBe('11');
    });

    test('two vectors still answer a number', () => {
      const e = engine().box(['Dot', ['List', 1, 2], ['List', 3, 4]]);
      expect(e.type.toString()).toBe('integer');
      expect(e.evaluate().toString()).toBe('11');
    });

    test('two matrices still answer the matrix product', () => {
      expect(
        evaluated([
          'Dot',
          ['List', ['List', 1, 2], ['List', 3, 4]],
          ['List', ['List', 5, 6], ['List', 7, 8]],
        ])
      ).toBe('[[19,22],[43,50]]');
    });

    test('a matrix against a vector still contracts as a matrix', () => {
      // A list of LISTS is a matrix, not a list of points: its element type
      // is a list, so the broadcast arm does not claim it.
      expect(
        evaluated([
          'Dot',
          ['List', ['List', 1, 2], ['List', 3, 4]],
          ['List', 5, 6],
        ])
      ).toBe('[17,39]');
    });
  });

  describe('what stays undecided', () => {
    test('a valueless point list stays symbolic, as the tuple spelling does', () => {
      const ce = new ComputeEngine();
      ce.declare('L', 'list<number>');
      const pointList = ce.box(['Dot', ['PointList', 1, 'L'], POINT]);
      const tuple = ce.box(['Dot', ['Tuple', 1, 'L'], TUPLE_POINT]);
      expect(pointList.type.matches('list<number>')).toBe(true);
      expect(tuple.type.matches('list<number>')).toBe(true);
      expect(pointList.evaluate().toString()).toBe('Dot(PointList(1, L), (3, 4))');
      expect(tuple.evaluate().toString()).toBe('Dot((1, L), (3, 4))');
    });

    test('a list of non-numeric points keeps `value` and stays symbolic', () => {
      // The signature admits a list of tuples, so this is no longer an
      // `incompatible-type` error at boxing; the handlers refuse to claim a
      // number for a pair of strings, and no product is computed.
      const e = new ComputeEngine().box([
        'Dot',
        ['List', ['Tuple', { str: 'a' }, { str: 'b' }]],
        ['Tuple', 1, 2],
      ]);
      expect(e.isValid).toBe(true);
      expect(e.type.toString()).toBe('value');
      expect(e.evaluate().operator).toBe('Dot');
    });

    test('a TUPLE of points is one point, not a list of points', () => {
      // The rest of the engine reads `((1, 2), (3, 4))` as one point with
      // nested coordinates — `Norm` flattens it into a four-component vector
      // and `PointX` of it is `(1, 2)` — so the broadcast must not claim it.
      const e = new ComputeEngine().box([
        'Dot',
        ['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ['Tuple', 5, 6],
      ]);
      expect(e.type.toString()).toBe('value');
      expect(e.evaluate().operator).toBe('Dot');
    });

    test('a point with a symbolic coordinate stays symbolic', () => {
      const e = new ComputeEngine().box([
        'Dot',
        ['List', ['Tuple', 'x', 2]],
        ['Tuple', 1, 2],
      ]);
      expect(e.evaluate().operator).toBe('Dot');
    });

    test('a BARE `list<tuple>` declaration keeps `value` and still computes', () => {
      // A bare `tuple` element says nothing about the coordinates, so no
      // numeric claim is sound and the type stays the wide `value` — which a
      // list inhabits. The value is computed once the points are there, so
      // the type is wider than the value here, never narrower.
      const ce = new ComputeEngine();
      ce.declare('P', 'list<tuple>');
      ce.assign('P', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
      const e = ce.box(['Dot', 'P', ['Tuple', 5, 6]]);
      expect(e.type.toString()).toBe('value');
      expect(e.evaluate().toString()).toBe('[17,39]');
    });
  });

  describe('a point list against a vector or a matrix has no arm', () => {
    // `Dot` broadcasts a point list against a POINT and against another point
    // list, and against nothing else. A plain `List` operand is a vector or a
    // row of a matrix, whose product is a different contraction, so all three
    // routes must agree that there is no answer here.
    const cases: Array<[string, MathJsonExpression]> = [
      ['a vector on the right', ['Dot', POINT_LIST, ['List', 3, 4]]],
      ['a vector on the left', ['Dot', ['List', 3, 4], POINT_LIST]],
      [
        'a matrix on the right',
        ['Dot', POINT_LIST, ['List', ['List', 1, 0], ['List', 0, 1]]],
      ],
    ];

    test.each(cases)('types `value` and stays symbolic with %s', (_l, expr) => {
      const ce = new ComputeEngine();
      ce.declare('L', 'list<number>');
      const e = ce.box(expr);
      expect(e.type.toString()).toBe('value');
      expect(e.evaluate().operator).toBe('Dot');
    });

    test.each(cases)(
      'the compiled route fails closed with %s, rather than answer a list',
      (_l, expr) => {
        const ce = new ComputeEngine();
        ce.declare('L', 'list<number>');
        expect(() =>
          compile(ce.box(expr), { fallback: false, constantFold: false })
        ).toThrow(/list of points/);
      }
    );
  });

  describe('the compiled JavaScript route agrees with the interpreter', () => {
    function compiled(expr: MathJsonExpression, vars: Record<string, unknown>) {
      const ce = new ComputeEngine();
      ce.declare('L', 'list<number>');
      const r = compile(ce.box(expr), {
        fallback: false,
        constantFold: false,
      });
      expect(r.success).toBe(true);
      return r.run!(vars as any);
    }

    test('a run-time point list against a point', () => {
      expect(compiled(['Dot', POINT_LIST, POINT], { L: [1, 2] })).toEqual([
        7, 11,
      ]);
    });

    test('a point against a run-time point list', () => {
      expect(compiled(['Dot', POINT, POINT_LIST], { L: [1, 2] })).toEqual([
        7, 11,
      ]);
    });

    test('two run-time point lists', () => {
      expect(compiled(['Dot', POINT_LIST, POINT_LIST], { L: [1, 2] })).toEqual([
        2, 5,
      ]);
    });

    test('the tuple spelling compiles to the same list', () => {
      expect(
        compiled(['Dot', ['Tuple', 1, 'L'], TUPLE_POINT], { L: [1, 2] })
      ).toEqual([7, 11]);
    });

    test('a written-out list of points takes the same lowering', () => {
      const ce = new ComputeEngine();
      const r = compile(ce.box(['Dot', LITERAL_POINT_LIST, TUPLE_POINT]), {
        fallback: false,
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.code).toContain('_SYS.pointdot');
      expect(r.run!({})).toEqual([7, 11]);
    });

    test('a different number of points yields NaN at run time', () => {
      // The compiled targets project the interpreter's
      // `incompatible-dimensions` onto NaN, as the rest of the linear-algebra
      // runtime does.
      const ce = new ComputeEngine();
      ce.declare('L', 'list<number>');
      ce.declare('M', 'list<number>');
      const r = compile(ce.box(['Dot', ['PointList', 1, 'L'], ['PointList', 1, 'M']]), {
        fallback: false,
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.run!({ L: [1, 2], M: [1, 2, 3] } as any)).toBeNaN();
    });

    test('two points and two vectors still compile to a number', () => {
      expect(compiled(['Dot', ['Tuple', 1, 2], TUPLE_POINT], {})).toBe(11);
      expect(compiled(['Dot', ['List', 1, 2], ['List', 3, 4]], {})).toBe(11);
    });

    test('two matrices still compile to the matrix product', () => {
      const ce = new ComputeEngine();
      const r = compile(
        ce.box([
          'Dot',
          ['List', ['List', 1, 2], ['List', 3, 4]],
          ['List', ['List', 5, 6], ['List', 7, 8]],
        ]),
        { fallback: false, constantFold: false }
      );
      expect(r.success).toBe(true);
      expect(r.code).toContain('_SYS.matmul');
      expect(r.run!({})).toEqual([
        [19, 22],
        [43, 50],
      ]);
    });

    describe('an EMPTY point list answers the empty list', () => {
      // Which operand is the list comes from the static type, not from a
      // run-time test of the first element: an empty list has no first
      // element, so sniffing the nesting read `[]` as a single point and
      // answered NaN, and two empty lists answered the scalar `0`.
      function emptyRun(expr: MathJsonExpression, vars: Record<string, any>) {
        const ce = new ComputeEngine();
        ce.declare('P', 'list<tuple<number, number>>');
        ce.declare('Q', 'list<tuple<number, number>>');
        const r = compile(ce.box(expr), {
          fallback: false,
          constantFold: false,
        });
        expect(r.success).toBe(true);
        return r.run!(vars as any);
      }

      test('a point list on the left', () => {
        expect(emptyRun(['Dot', 'P', TUPLE_POINT], { P: [] })).toEqual([]);
      });

      test('a point list on the right', () => {
        expect(emptyRun(['Dot', TUPLE_POINT, 'P'], { P: [] })).toEqual([]);
      });

      test('two empty point lists', () => {
        expect(emptyRun(['Dot', 'P', 'Q'], { P: [], Q: [] })).toEqual([]);
      });

      test('the same lowering still answers the products when points arrive', () => {
        expect(
          emptyRun(['Dot', 'P', TUPLE_POINT], { P: [[1, 1], [1, 2]] })
        ).toEqual([7, 11]);
      });

      test('an operand the type called a list but that is not an array is NaN', () => {
        expect(emptyRun(['Dot', 'P', TUPLE_POINT], { P: 3 })).toBeNaN();
      });
    });

    describe('non-numeric and complex coordinates are declined', () => {
      // The compiled `*` answers a number for a pair of strings (`"1" * "2"`
      // is `2`) where the interpreter leaves the product symbolic, and
      // answers NaN for a `{ re, im }` object with nothing to say why. The
      // sibling tuple broadcast (`BaseCompiler.compileBroadcastInnerProduct`)
      // declines complex coordinates with the same message.
      test('string coordinates fail closed, where the interpreter stays symbolic', () => {
        const ce = new ComputeEngine();
        const expr = ce.box([
          'Dot',
          ['List', ['Tuple', { str: '1' }, { str: '2' }]],
          TUPLE_POINT,
        ]);
        expect(expr.evaluate().operator).toBe('Dot');
        expect(() =>
          compile(expr, { fallback: false, constantFold: false })
        ).toThrow(/is not a number/);
      });

      test('complex coordinates fail closed', () => {
        const ce = new ComputeEngine();
        ce.declare('P', 'list<tuple<complex, complex>>');
        expect(() =>
          compile(ce.box(['Dot', 'P', TUPLE_POINT]), {
            fallback: false,
            constantFold: false,
          })
        ).toThrow(/complex point coordinates/);
      });

      test('a bare `list<tuple>` names no coordinate type and fails closed', () => {
        const ce = new ComputeEngine();
        ce.declare('P', 'list<tuple>');
        expect(() =>
          compile(ce.box(['Dot', 'P', TUPLE_POINT]), {
            fallback: false,
            constantFold: false,
          })
        ).toThrow(/does not name its coordinate types/);
      });
    });
  });

  describe('a walk that supplies no element is not an empty list', () => {
    // Finite with a known count is not proof that the elements can be
    // walked: an unassigned `P: list<tuple<number, number>^2>` has count 2
    // and an iterator that yields nothing, and `Take(P, 2)` inherits both.
    // The operator must stay symbolic there, not answer `[]`.
    test('Take of an unassigned point list stays symbolic', () => {
      const ce = new ComputeEngine();
      ce.declare('P', 'list<tuple<number, number>^2>');
      const taken = ce.box(['Take', 'P', 2]);
      expect(taken.isFiniteCollection).toBe(true);
      expect(taken.count).toBe(2);
      expect(ce.box(['Dot', ['Take', 'P', 2], ['Tuple', 1, 2]]).evaluate().operator).toBe(
        'Dot'
      );
    });

    test('the unassigned point list itself stays symbolic', () => {
      const ce = new ComputeEngine();
      ce.declare('P', 'list<tuple<number, number>^2>');
      expect(ce.box(['Dot', 'P', ['Tuple', 1, 2]]).evaluate().operator).toBe(
        'Dot'
      );
    });

    test('a genuinely empty point list still answers the empty list', () => {
      const ce = new ComputeEngine();
      expect(
        ce
          .box(['Dot', ['Take', LITERAL_POINT_LIST, 0], TUPLE_POINT])
          .evaluate()
          .toString()
      ).toBe('[]');
    });
  });
});
