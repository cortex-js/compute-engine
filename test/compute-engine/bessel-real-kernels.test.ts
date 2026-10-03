import {
  besselJ,
  besselY,
} from '../../src/compute-engine/numerics/special-functions';

// The reference values are mpmath at 30 digits, rounded to the nearest
// double. The error is measured against max(|value|, √(2/(πx))), the size
// of the oscillation: next to a zero of the function only the absolute
// error is meaningful.

// [n, x, J_n(x), Y_n(x)]
const rows: [number, number, number, number][] = [
  [0, 11.5, -0.06765394811166522, -0.22523211169118787],
  [5, 18, -0.15537009877904934, -0.11248750441606524],
  [8, 27.75, -0.15293691277472263, 0.023707710080783474],
  [12, 40, -0.12697799611784807, -0.02362655484363334],
  [12, 16, 0.11240023492610679, 0.21597027298252575],
  [30, 60, 0.06819856782673352, 0.08717051871102699],
  [30, 150, -0.00940746499288182, -0.06513921207907812],
  [80, 40, 1.029563089370401e-17, -446270248643570.3],
  [0, 1.5, 0.5118276717359181, 0.38244892379775886],
  [1, 2.5, 0.49709410246427405, 0.1459181379667858],
  [3, 100, 0.07628420172033194, 0.02344578668776091],
  [0, 1000, 0.024786686152420176, 0.0047159179776228135],
  [-3, 7.5, 0.2580609131934603, -0.15970759193793513],
  [2, 0.01, 1.2499895833658854e-5, -12732.713800775047],
];

function error(actual: number, expected: number, x: number): number {
  const scale = Math.max(Math.abs(expected), Math.sqrt(2 / (Math.PI * x)));
  return Math.abs(actual - expected) / scale;
}

describe('REAL BESSEL KERNELS', () => {
  test.each(rows)('J_%p(%p)', (n, x, j) => {
    // J_80(40) is 10⁻¹⁷: its relative error is checked too.
    if (Math.abs(n) > x)
      expect(Math.abs(besselJ(n, x) / j - 1)).toBeLessThan(1e-14);
    else expect(error(besselJ(n, x), j, x)).toBeLessThan(2e-14);
  });

  test.each(rows)('Y_%p(%p)', (n, x, _, y) => {
    expect(error(besselY(n, x), y, x)).toBeLessThan(2e-14);
  });
});
