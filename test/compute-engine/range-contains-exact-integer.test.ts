import { ComputeEngine } from '../../src/compute-engine';

// `Range.contains` (`library/collections.ts`) read the target as a double
// and tested the grid index `(t − lower) / step` within the tolerance: past
// the safe integers the index keeps no fractional digit, and the answer was
// `undefined` for `2⁵⁴ + 4` in `Range(0, +oo, 1)`, which the `Element`
// operator decided through its own route. An exact integer target on an
// integer grid is now decided in `bigint` arithmetic.
describe('Range.contains with an exact integer target', () => {
  const ce = new ComputeEngine();
  ce.tolerance = 0;
  const contains = (range: unknown[], n: bigint | number) =>
    (ce.box(range) as any).contains(ce.number(n));

  test('past the safe integers', () => {
    expect(contains(['Range', 0, 'PositiveInfinity', 1], 2n ** 54n + 4n)).toBe(
      true
    );
    expect(contains(['Range', 0, 'PositiveInfinity', 2], 2n ** 54n + 3n)).toBe(
      false
    );
    expect(contains(['Range', 1, 'PositiveInfinity', 2], 2n ** 53n + 1n)).toBe(
      true
    );
    expect(
      ce
        .box([
          'Element',
          ce.number(2n ** 54n + 4n),
          ['Range', 0, 'PositiveInfinity', 1],
        ])
        .evaluate().json
    ).toBe('True');
  });

  test('the target and the bounds are read exactly, not through a rounding', () => {
    // `10⁴⁰ + 1` read through the working precision is `10⁴⁰`; the double
    // of `2⁵⁴ + 1` is `2⁵⁴`.
    expect(contains(['Range', 1, 'PositiveInfinity', 2], 10n ** 40n + 1n)).toBe(
      true
    );
    expect(contains(['Range', 1, 'PositiveInfinity', 2], 10n ** 40n)).toBe(
      false
    );
    const lower = ce.number(2n ** 54n + 1n);
    const upper = ce.number(2n ** 54n + 11n);
    expect(contains(['Range', lower, upper, 2], 2n ** 54n + 1n)).toBe(true);
    expect(contains(['Range', lower, upper, 2], 2n ** 54n + 2n)).toBe(false);
    expect(contains(['Range', lower, upper, 2], 2n ** 54n + 11n)).toBe(true);
    expect(contains(['Range', 0, lower], 2n ** 54n + 1n)).toBe(true);
  });

  test('a finite upper bound is a bound, not a grid point', () => {
    expect(contains(['Range', 1, 5, 3], 4)).toBe(true);
    expect(contains(['Range', 1, 5, 3], 5)).toBe(false);
    expect(contains(['Range', 0, 10, 3], 12)).toBe(false);
  });

  test('a step that runs away from the infinite end: an empty range', () => {
    expect(contains(['Range', 1, 'PositiveInfinity', -1], 0)).toBe(false);
    expect(contains(['Range', 1, 'NegativeInfinity', 1], 5)).toBe(false);
    expect(contains(['Range', 1, 'NegativeInfinity', 1], 1)).toBe(false);
  });

  test('a descending range', () => {
    expect(contains(['Range', 5, 1, -2], 3)).toBe(true);
    expect(contains(['Range', 5, 1, -2], 7)).toBe(false);
    expect(contains(['Range', 5, 1, -2], 4)).toBe(false);
  });
});
