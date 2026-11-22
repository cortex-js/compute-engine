/**
 * CE-1653: the numeric value of a product of a list of fractions keeps the
 * fractions exact until each cell product, as the scalar product does.
 * `3·[1/3, 2/3]` gave `[0.999…9, 2.000…1]`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const N = (json: unknown) => ce.box(json as never).N().json;
const third = ['Rational', 1, 3];
const twoThirds = ['Rational', 2, 3];

describe('a product with a list of fractions, at 21 digits', () => {
  test('a number times a list of fractions', () => {
    expect(N(['Multiply', 3, ['List', third, twoThirds]])).toEqual([
      'List',
      1,
      2,
    ]);
  });

  test('a matrix of fractions times a number', () => {
    expect(
      N([
        'Multiply',
        ['List', ['List', third, twoThirds], ['List', twoThirds, third]],
        3,
      ])
    ).toEqual(['List', ['List', 1, 2], ['List', 2, 1]]);
  });

  test('a list of fractions times a list', () => {
    expect(N(['Multiply', ['List', third, twoThirds], ['List', 3, 3]])).toEqual(
      ['List', 1, 2]
    );
  });

  test('a fraction times a point', () => {
    expect(N(['Multiply', third, ['Tuple', 3, 6]])).toEqual(['Tuple', 1, 2]);
  });

  test('a fraction times a list of floats', () => {
    // As `Multiply(1/3, 1.5).N()`, `0.5`: rounding the fraction first gave
    // `0.4999999999999999999995` and `0.8333333333333333333325`.
    expect(N(['Multiply', third, ['List', 1.5, 2.5]])).toEqual([
      'List',
      0.5,
      { num: '0.833333333333333333333' },
    ]);
  });
});
