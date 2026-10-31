import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// CE-661 (Tycho ledger row 477): the count and the elements of a family of
// points before evaluation.
//
// A body that adds a point to a list of points (`L + PointList(1.8, 0)`),
// joins such lists (`ListJoin`), takes their coordinates (`PointX`, `PointY`)
// and zips coordinates back into points (`PointList`) had no `count` above the
// literal lists, and `at(k)` evaluated the whole body to give one element.
//
// - The count of a broadcast reads a point beside a list as a lift, as the
//   evaluation does, for a head that combines points itself (`Add`,
//   `Multiply`, …).
// - `PointX(L)` has the count of the list of points `L`, and `PointList` with
//   list components has the smallest count of them (the zip rule).
// - `at(k)` of a broadcast, of `PointX`/`PointY`/`PointZ` and of `PointList`
//   builds the element from the elements of the operands, with no
//   evaluation. The evaluation of that element equals `evaluate().at(k)`.

const pt = (a: unknown, b: unknown) => ['Pair', a, b];

/** A literal list of `n` points in the free variables `u` and `v`. */
function points(n: number, offset: number): unknown[] {
  return [
    'List',
    ...Array.from({ length: n }, (_, i) =>
      pt(['Add', 'u', i + offset], ['Multiply', 'v', i + 1])
    ),
  ];
}

/** Every element read with `at(k)` evaluates to `evaluate().at(k)`. */
function expectElementsAgree(e: Expression, n: number): void {
  const value = e.evaluate();
  expect(value.count).toBe(n);
  for (let k = 1; k <= n; k++) {
    const element = e.at(k);
    expect(element).toBeDefined();
    const expected = value.at(k)!;
    expect(element!.evaluate().isSame(expected)).toBe(true);
    // With values for the free variables too.
    const at = { u: 0.25, v: -1.5 };
    expect(element!.subs(at).N().isSame(expected.subs(at).N())).toBe(true);
  }
}

describe('CE-661: count and at() of a family of points', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  describe('the input shape of the entry', () => {
    let body: Expression;
    beforeEach(() => {
      ce.declare('T', 'tuple<real, real, real>');
      ce.assign('T', ce.box(['Triple', 1, 2, 3]));
      const J = [
        'ListJoin',
        points(20, 0),
        ['Add', points(4, 1), ['PointList', 1.8, 0]],
        ['Add', points(4, 2), ['PointList', 3.57, 0]],
        ['Add', points(4, 3), ['PointList', 5.01, 0]],
        points(2, 4),
      ];
      const P = ['PointList', ['PointX', J], ['PointY', J]];
      body = ce.box([
        'Add',
        'T',
        [
          'PointList',
          ['Add', ['Multiply', 'c', ['PointX', P]], 1],
          ['Add', ['Multiply', 3, ['PointY', P]], 'v'],
          0.4,
        ],
      ]);
    });

    test('the count is 34 (20 + 3 × 4 + 2)', () => {
      expect(body.count).toBe(34);
    });

    test('each element is read without evaluation of the body', () => {
      const evaluate = jest.spyOn(body, 'evaluate');
      // The element is the evaluation of one point: a 3-D `Tuple`.
      for (const k of [1, 21, 25, 34, -1]) {
        const element = body.at(k);
        expect(element?.operator).toBe('Tuple');
        expect(element?.nops).toBe(3);
      }
      expect(body.at(35)).toBeUndefined();
      expect(body.at(-35)).toBeUndefined();
      expect(evaluate).not.toHaveBeenCalled();
    });

    test('each element evaluates to the element of the evaluation', () => {
      expectElementsAgree(body, 34);
      expect(body.at(-1)!.evaluate().isSame(body.evaluate().at(34)!)).toBe(
        true
      );
    });
  });

  describe('the count of a broadcast reads a point as a lift', () => {
    test('a point beside a list of points', () => {
      expect(ce.box(['Add', points(4, 0), ['PointList', 1.8, 0]]).count).toBe(
        4
      );
      expect(ce.box(['Add', points(4, 0), ['Tuple', 1.8, 0]]).count).toBe(4);
      expect(ce.box(['Subtract', points(3, 0), ['Tuple', 1, 0]]).count).toBe(
        3
      );
    });

    test('a scalar list times a point', () => {
      const e = ce.box(['Multiply', ['List', 3, 4, 5], ['Tuple', 1, 2]]);
      expect(e.count).toBe(3);
      expectElementsAgree(e, 3);
    });

    test('a point plus a point keeps the count of the point', () => {
      expect(ce.box(['Add', ['Tuple', 1, 2], ['Tuple', 3, 4]]).count).toBe(2);
    });

    test('a head that reads a point by position is unchanged', () => {
      // `Power((1, 2), [3, 4])` is `[1, 16]`: the point supplies cells.
      expect(ce.box(['Power', ['Tuple', 1, 2], ['List', 3, 4]]).count).toBe(2);
    });
  });

  describe('PointX, PointY, PointZ and PointList', () => {
    test('PointX of a list of points has the count of the list', () => {
      const e = ce.box(['PointX', points(4, 0)]);
      expect(e.count).toBe(4);
      expect(ce.box(['PointY', points(4, 0)]).count).toBe(4);
      const evaluate = jest.spyOn(e, 'evaluate');
      expect(e.at(2)?.toString()).toBe('u + 1');
      expect(evaluate).not.toHaveBeenCalled();
      expectElementsAgree(e, 4);
    });

    test('PointZ of a list of 3-D points', () => {
      const e = ce.box([
        'PointZ',
        ['List', ['Triple', 1, 2, 3], ['Triple', 'u', 'v', 6]],
      ]);
      expect(e.count).toBe(2);
      expectElementsAgree(e, 2);
    });

    test('PointX of a list of numbers has no count', () => {
      // It reads the first element of the list (`PointX([3, 4])` is 3).
      expect(ce.box(['PointX', ['List', 3, 4]]).count).toBeUndefined();
    });

    test('PointList zips to its shortest list component', () => {
      const e = ce.box([
        'PointList',
        ['List', 1, 2, 3],
        ['List', 'u', 'v'],
        0.4,
      ]);
      expect(e.count).toBe(2);
      const evaluate = jest.spyOn(e, 'evaluate');
      expect(e.at(2)?.toString()).toBe('(2, v, 0.4)');
      expect(evaluate).not.toHaveBeenCalled();
      expectElementsAgree(e, 2);
    });

    test('PointList with no list component has no count', () => {
      expect(ce.box(['PointList', 1.8, 0]).count).toBeUndefined();
    });

    test('PointList with a list component of unknown count has no count', () => {
      ce.declare('u', 'real');
      const e = ce.box([
        'PointList',
        ['Range', 1, ['Floor', 'u']],
        ['List', 1, 2, 3],
      ]);
      expect(e.count).toBeUndefined();
    });
  });

  describe('a When gap stays at its position', () => {
    test('a decided gap and an undecided restriction', () => {
      const L = [
        'List',
        ['When', pt('u', 1), ['Less', 0, 'u']],
        ['When', pt(1, 1), ['Less', 1, 0]],
        pt(2, 3),
      ];
      const sum = ce.box(['Add', L, ['PointList', 1.8, 0]]);
      expect(sum.count).toBe(3);
      expectElementsAgree(sum, 3);
      expect(sum.evaluate().at(2)!.symbol).toBe('Missing');
      expect(sum.at(2)!.evaluate().symbol).toBe('Missing');

      const x = ce.box(['PointX', L]);
      expect(x.count).toBe(3);
      expectElementsAgree(x, 3);

      const join = ce.box(['ListJoin', points(2, 0), sum]);
      expect(join.count).toBe(5);
      expectElementsAgree(join, 5);
    });

    test('a restricted number in a broadcast', () => {
      const A = [
        'List',
        ['When', 1, ['Less', 1, 0]],
        ['When', 'u', ['Less', 0, 'u']],
        3,
      ];
      const sum = ce.box(['Add', A, 1]);
      expect(sum.count).toBe(3);
      expectElementsAgree(sum, 3);
    });
  });

  describe('when the structural read does not apply', () => {
    test('a count that depends on a free variable is undefined', () => {
      ce.declare('u', 'real');
      const e = ce.box(['Add', ['Range', 1, ['Floor', 'u']], 1]);
      expect(e.count).toBeUndefined();
      const join = ce.box([
        'ListJoin',
        ['List', 1, 2],
        ['Add', ['Range', 1, ['Floor', 'u']], 1],
      ]);
      expect(join.count).toBeUndefined();
    });

    test('a body that draws random numbers is evaluated', () => {
      // `L + Random()` is not pure, so the structural read does not apply:
      // `at()` evaluates the whole body, as it did before.
      const e = ce.box(['Add', ['List', 1, 2, 3], ['Random']]);
      expect(e.count).toBe(3);
      const evaluate = jest.spyOn(e, 'evaluate');
      expect(e.at(1)).toBeDefined();
      expect(evaluate).toHaveBeenCalled();

      // An impure participant: the evaluation is declined, as before.
      const shuffled = ce.box([
        'Add',
        ['RandomShuffle', ['List', 1, 2, 3]],
        1,
      ]);
      expect(shuffled.at(1)).toBeUndefined();
    });

    test('a matrix product is not read by row', () => {
      // `Multiply(M, v)` is the matrix product `[17, 39]`, not one product
      // for each row of `M`.
      const e = ce.box([
        'Multiply',
        ['List', ['List', 1, 2], ['List', 3, 4]],
        ['List', 5, 6],
      ]);
      expect(e.at(1)?.re).toBe(17);
      expect(e.at(2)?.re).toBe(39);
    });

    test('a vector times a matrix has the length of the product', () => {
      // `[1, 2]·M` with `M` a 2×3 matrix is the product `[9, 12, 15]`, with
      // 3 elements: the length of the vector (2) is not the length of the
      // result, and `at(3)` is an element.
      const e = ce.box([
        'Multiply',
        ['List', 1, 2],
        ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]],
      ]);
      const value = e.evaluate();
      expect(value.count).toBe(3);
      expect(e.count === undefined || e.count === 3).toBe(true);
      for (let k = 1; k <= 3; k++)
        expect(e.at(k)?.isSame(value.at(k)!)).toBe(true);
      expect(e.at(3)?.re).toBe(15);
    });

    test('a sum of two matrices keeps the count of its rows', () => {
      // The tensor route of `Add` is element by element: `M + N` has the
      // rows of `M` and `N`, so its count is known before evaluation.
      const e = ce.box([
        'Add',
        ['List', ['List', 1, 2], ['List', 3, 4]],
        ['List', ['List', 5, 6], ['List', 7, 8]],
      ]);
      const value = e.evaluate();
      expect(value.count).toBe(2);
      expect(e.count).toBe(2);
      for (let k = 1; k <= 2; k++)
        expect(e.at(k)?.isSame(value.at(k)!)).toBe(true);
    });

    test('a tuple with a list component is not a point', () => {
      // `(-6, n)` with `n` a list is a list of points when it is evaluated,
      // not a point, so `P + W` is not `P` with each point moved by `W`.
      // Its evaluation is an error: there is no count and no element.
      ce.declare('P', 'list<tuple<real, real>>');
      ce.assign('P', ce.box(['List', pt(1, 2), pt(3, 4), pt(5, 6)]));
      for (const [name, n] of [
        ['n', [10, 20, 30]],
        ['m', [10, 20]],
      ] as const) {
        ce.declare(name, 'list<real>');
        ce.assign(name, ce.box(['List', ...n]));
      }
      ce.declare('W', 'any');
      ce.assign('W', ce.box(['Tuple', -6, 'n'], { canonical: false }));
      ce.declare('V', 'any');
      ce.assign('V', ce.box(['Tuple', -6, 'm'], { canonical: false }));
      for (const tuple of ['W', 'V']) {
        const e = ce.box(['Add', 'P', tuple]);
        const value = e.evaluate();
        expect(value.count).toBeUndefined();
        expect(e.count).toBeUndefined();
        for (let k = 1; k <= 3; k++) expect(e.at(k)).toBe(value.at(k));
      }

      // A symbol of type `any` whose value is a point is lifted.
      ce.declare('Q', 'any');
      ce.assign('Q', ce.box(['Tuple', -6, 1]));
      const e = ce.box(['Add', 'P', 'Q']);
      expect(e.count).toBe(3);
      for (let k = 1; k <= 3; k++)
        expect(e.at(k)?.isSame(e.evaluate().at(k)!)).toBe(true);
    });

    test('a cached evaluation is read, not the operands', () => {
      // After `_materializedAt` cached the evaluation for the current
      // generation, `at()` reads the element of that value: it does not read
      // the element of the list operand to build a new element.
      const e = ce.box(['Add', points(3, 0), ['Tuple', 1, 2]]);
      const list = e.ops!.find((op) => op.operator === 'List')!;
      const operandAt = jest.spyOn(list, 'at');
      expect(e.at(2)?.isSame(e.evaluate().at(2)!)).toBe(true);
      expect(operandAt).toHaveBeenCalled();
      (e as unknown as { _materializedAt(k: number): unknown })._materializedAt(
        1
      );
      operandAt.mockClear();
      expect(e.at(3)?.isSame(e.evaluate().at(3)!)).toBe(true);
      expect(operandAt).not.toHaveBeenCalled();
    });
  });
});
