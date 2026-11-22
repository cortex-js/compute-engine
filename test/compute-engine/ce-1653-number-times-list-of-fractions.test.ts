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

  test('a matrix product of fractions is a matrix of floats', () => {
    // The exact product is rounded once (the review of CE-1653: the cells
    // stayed exact rationals under `.N()`).
    const M = [
      'List',
      ['List', third, ['Rational', 1, 2]],
      ['List', ['Rational', 1, 5], ['Rational', 1, 7]],
    ];
    expect(
      N(['Multiply', M, ['List', ['List', 3, 2], ['List', 5, 7]]])
    ).toEqual([
      'List',
      ['List', 3.5, { num: '4.16666666666666666667' }],
      ['List', { num: '1.31428571428571428571' }, 1.4],
    ]);
  });

  test('beside an irrational factor, the scalar products', () => {
    ce.precision = 'machine';
    try {
      expect(N(['Multiply', ['Sqrt', 2], ['List', third]])).toEqual([
        'List',
        N(['Multiply', ['Sqrt', 2], third]),
      ]);
    } finally {
      ce.precision = 21;
    }
  });

  test('a long list of fractions and a float', () => {
    // A list of fractions is not read by the big-decimal kernel, whose
    // columns hold no denominator: each cell is 1/3 + 0.5, not 1 + 0.5.
    const L = ['List', ...Array.from({ length: 150 }, () => third)];
    for (const [op, value] of [
      ['Add', '0.83333333333333333333'],
      ['Multiply', '0.16666666666666666666'],
    ]) {
      const r = ce.box([op, L, 0.5]).evaluate();
      const cell = (r.operator === 'Map' ? r.at(1)! : r.ops![0]).N();
      expect(cell.toString().startsWith(value)).toBe(true);
    }
  });
});
