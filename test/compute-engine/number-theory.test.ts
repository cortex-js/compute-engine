import { engine as ce } from '../utils';

const isOctahedral = (n: number | bigint) =>
  ce
    .expr(['IsOctahedral', ce.number(n)])
    .evaluate()
    .toString()
    .replace(/"/g, '');

describe('IsOctahedral — REVIEW.md B11', () => {
  // The m-th octahedral number is O(m) = m(2m² + 1)/3:
  // 1, 6, 19, 44, 85, 146, 231, … (OEIS A005900). The previous code tested a
  // perfect square of 3n+1, which is unrelated to octahedral numbers.
  const octahedral = [1, 6, 19, 44, 85, 146, 231];
  for (const n of octahedral) {
    test(`IsOctahedral(${n}) is True`, () =>
      expect(isOctahedral(n)).toEqual('True'));
  }

  const nonOctahedral = [2, 5, 7, 18, 20, 45, 100];
  for (const n of nonOctahedral) {
    test(`IsOctahedral(${n}) is False`, () =>
      expect(isOctahedral(n)).toEqual('False'));
  }

  test('n < 1 is False', () => {
    expect(isOctahedral(0)).toEqual('False');
    expect(isOctahedral(-6)).toEqual('False');
  });

  test('large octahedral numbers are detected exactly (bigint)', () => {
    // O(100000) = 100000·(2·100000² + 1)/3.
    const m = 100000n;
    const o = (2n * m * m * m + m) / 3n;
    expect(isOctahedral(o)).toEqual('True');
    expect(isOctahedral(o + 1n)).toEqual('False');
  });
});

// REVIEW.md B21: IsHappy threw on negative input (`BigInt('-')`).
describe('IsHappy on non-positive input (REVIEW.md B21)', () => {
  it('returns False for negative/zero instead of throwing', () => {
    expect(ce.expr(['IsHappy', -7]).evaluate().json).toBe('False');
    expect(ce.expr(['IsHappy', 0]).evaluate().json).toBe('False');
  });
  it('still identifies positive happy numbers', () => {
    expect(ce.expr(['IsHappy', 7]).evaluate().json).toBe('True');
    expect(ce.expr(['IsHappy', 4]).evaluate().json).toBe('False');
  });
});
