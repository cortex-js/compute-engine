import {
  determinant,
  spectralNorm,
} from '../../src/compute-engine/numerics/linear-algebra';

// `determinant()` is part of the public `numerics` entry point. It expands
// along the first row. Each minor must have its rows created before they are
// filled: before that, every matrix of size 3 or more threw a `TypeError`.
describe('NUMERICS DETERMINANT', () => {
  test('1×1 and 2×2', () => {
    expect(determinant([[7]])).toBe(7);
    expect(
      determinant([
        [1, 2],
        [3, 4],
      ])
    ).toBe(-2);
  });

  test('3×3', () => {
    expect(
      determinant([
        [1, 3, 7],
        [2, -1, 4],
        [5, 0, 2],
      ])
    ).toBe(81);
    // 1·(50 − 48) − 2·(40 − 42) + 3·(32 − 35) = −3
    expect(
      determinant([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 10],
      ])
    ).toBe(-3);
  });

  test('4×4 diagonal is the product of the diagonal', () => {
    expect(
      determinant([
        [2, 0, 0, 0],
        [0, 3, 0, 0],
        [0, 0, 4, 0],
        [0, 0, 0, 5],
      ])
    ).toBe(120);
  });
});

// `spectralNorm()` forms the Gram matrix, which squares the entries. The
// matrix is scaled by its largest entry first, so that an entry above about
// 1e154 does not overflow to infinity and an entry below about 1e-154 does
// not underflow to zero. The expected values were checked against
// `np.linalg.norm(A, 2)`.
describe('NUMERICS SPECTRAL NORM — entries far from 1', () => {
  const zeros = (m: number, n: number) =>
    Array.from({ length: m }, () => new Array(n).fill(0));

  test('large entries do not overflow', () => {
    expect(
      spectralNorm(
        [
          [1e200, 1],
          [1, 1e200],
        ],
        zeros(2, 2)
      )
    ).toBeCloseTo(1e200, -188);
  });

  test('small entries do not underflow', () => {
    expect(
      spectralNorm(
        [
          [1e-200, 0],
          [0, 1e-200],
        ],
        zeros(2, 2)
      ) / 1e-200
    ).toBeCloseTo(1, 12);
    expect(
      spectralNorm(
        [
          [1e-170, 2e-170],
          [3e-170, 4e-170],
        ],
        zeros(2, 2)
      ) / 1e-170
    ).toBeCloseTo(5.464985704219043, 12);
  });

  test('a complex matrix and a zero matrix', () => {
    // [[1e200, 1e200·i], [0, 1e200]] is 1e200 · [[1, i], [0, 1]], whose
    // norm is the golden ratio.
    expect(
      spectralNorm(
        [
          [1e200, 0],
          [0, 1e200],
        ],
        [
          [0, 1e200],
          [0, 0],
        ]
      ) / 1e200
    ).toBeCloseTo((1 + Math.sqrt(5)) / 2, 12);
    expect(spectralNorm(zeros(2, 3), zeros(2, 3))).toBe(0);
  });
});
