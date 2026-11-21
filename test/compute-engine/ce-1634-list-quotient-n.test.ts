/**
 * Under `.N()`, the product of an exact integer or rational literal and a
 * collection folds the literal with each element before it rounds, as the
 * scalar product does: `(1/3)·3` is `1`, so the last element of
 * `[1, 2, 3]/3` is `1`, not `0.999…9`.
 *
 * The list route is the tensor kernel of `Multiply` (`mulTensors()`), and
 * the `Range` route is the broadcast lift of `BoxedFunction`
 * (`evaluateBroadcastLiftsOnce()`). Both approximated the literal first.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();

function n(expr: unknown): unknown {
  return ce.box(expr as any).N().json;
}

const third = { num: '0.333333333333333333333' };
const twoThirds = { num: '0.666666666666666666667' };

describe('CE-1634: N of a list divided by a number', () => {
  test('a list divided by 3', () => {
    expect(n(['Divide', ['List', 1, 2, 3], 3])).toEqual([
      'List',
      third,
      twoThirds,
      1,
    ]);
  });

  test('each element is the scalar product', () => {
    expect(n(['Divide', 2, 3])).toEqual(twoThirds);
    expect(n(['Multiply', ['Rational', 1, 3], 3])).toEqual(1);
  });

  test('a matrix divided by 3', () => {
    expect(n(['Divide', ['List', ['List', 1, 2], ['List', 3, 6]], 3])).toEqual([
      'List',
      ['List', third, twoThirds],
      ['List', 1, 2],
    ]);
  });

  test('a range divided by 3', () => {
    expect(n(['Divide', ['Range', 1, 3], 3])).toEqual([
      'List',
      third,
      twoThirds,
      1,
    ]);
  });

  test('a range divided by 3, asynchronously', async () => {
    const r = await ce
      .box(['Divide', ['Range', 1, 3], 3])
      .evaluateAsync({ numericApproximation: true });
    expect(r.json).toEqual(['List', third, twoThirds, 1]);
  });

  test('a lazy range divided by 3', () => {
    const r = ce.box(['Divide', ['Range', 1, 300], 3]).N();
    expect(r.at(2)?.json).toEqual(twoThirds);
    expect(r.at(3)?.json).toEqual(1);
  });

  test('a comparison of the result after N', () => {
    expect(
      ce
        .box(['Equal', ['At', ['N', ['Divide', ['List', 1, 2, 3], 3]], 3], 1])
        .evaluate().json
    ).toEqual('True');
  });

  test('evaluate() keeps the products exact', () => {
    // The kernel for a list of exact integers runs only under `.N()`.
    const expected = ['List', ['Rational', 1, 3], ['Rational', 2, 3], 1];
    const product: MathJsonExpression = [
      'Multiply',
      ['Rational', 1, 3],
      ['List', 1, 2, 3],
    ];
    expect(ce.box(product).evaluate().json).toEqual(expected);
    const m = new ComputeEngine();
    m.precision = 'machine';
    expect(m.box(product).evaluate().json).toEqual(expected);
  });

  test.each(['machine', 21, 50] as const)(
    'at precision %s, each cell is the scalar product',
    (precision: 'machine' | number) => {
      const m = new ComputeEngine();
      m.precision = precision;
      const cells = [-7, -3, -1, 0, 1, 2, 3, 6, 10, 9007199];
      for (const [p, q] of [
        [1, 3],
        [-2, 3],
        [5, 7],
        [7, 10],
        [1, 49],
        [1, 2],
        [-3, 4],
      ]) {
        // A list of machine numbers, so that the product is computed by the
        // kernel for a list of exact integers (`scaleMachineVector()`).
        const r = m
          .box(['Multiply', ['Rational', p, q], ['List', ...cells]])
          .N();
        cells.forEach((v, i) => {
          const cell = m.box(['Multiply', ['Rational', p, q], v]).N();
          // The JSON of an exact integer (`1`) differs from that of a float
          // (`{num: '1.0'}`), so this compares the exactness too.
          expect(r.at(i + 1)?.json).toEqual(cell.json);
        });
      }
    }
  );

  test('at machine precision', () => {
    const m = new ComputeEngine();
    m.precision = 'machine';
    expect(
      m.box(['Divide', ['List', 1, 2, 3, 4, 5, 6, 7], 7]).N().json
    ).toEqual(['List', ...[1, 2, 3, 4, 5, 6].map((k) => k / 7), 1]);
  });
});
