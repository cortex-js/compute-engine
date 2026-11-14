import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

// PartitionsQ(n): partitions of n into distinct parts (Wolfram `PartitionsQ`,
// OEIS A000009).

const ce = new ComputeEngine();

const ev = (json: unknown) => ce.box(json as any).evaluate();

// OEIS A000009, n = 0..20
const A000009 = [
  1, 1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 27, 32, 38, 46, 54, 64,
];

describe('PartitionsQ', () => {
  test('small values match OEIS A000009', () => {
    A000009.forEach((q, n) =>
      expect(ev(['PartitionsQ', n]).toString()).toBe(String(q))
    );
  });

  test('q(100) and q(1000) are exact', () => {
    expect(ev(['PartitionsQ', 100]).toString()).toBe('444793');
    expect(ev(['PartitionsQ', 1000]).toString()).toBe('8635565795744155161506');
  });

  test('Euler: as many partitions into odd parts as into distinct parts', () => {
    // Σ q(n) xⁿ = ∏ 1/(1 − x^(2k−1)); count odd-part partitions by a DP.
    const N = 200;
    const odd: bigint[] = new Array(N + 1).fill(0n);
    odd[0] = 1n;
    for (let part = 1; part <= N; part += 2)
      for (let m = part; m <= N; m++) odd[m] += odd[m - part];
    for (const n of [0, 1, 17, 64, 199, 200])
      expect(ev(['PartitionsQ', n]).toString()).toBe(String(odd[n]));
  });

  test('it is 0 for a negative integer', () => {
    expect(ev(['PartitionsQ', -1]).toString()).toBe('0');
    expect(ev(['PartitionsQ', -50]).toString()).toBe('0');
  });

  test('an operand that is not an integer is not evaluated', () => {
    // A symbol with no value stays as it is.
    const x = ev(['PartitionsQ', 'x']);
    expect(x.operator).toBe('PartitionsQ');
    expect(x.op1.symbol).toBe('x');
    // A non-integer fails the signature, as it does for `NPartition`.
    expect(ev(['PartitionsQ', { num: '2.5' }]).operator).toBe(
      ev(['NPartition', { num: '2.5' }]).operator
    );
    expect(ev(['PartitionsQ', { num: '2.5' }]).isNumber).toBe(false);
  });

  test('a float operand gives a float', () => {
    const v = ev(['PartitionsQ', { num: '10.0' }]);
    expect(isNumber(v) && v.isExact).toBe(false);
    expect(v.re).toBe(10);
  });

  test('it broadcasts over a list', () => {
    expect(ev(['PartitionsQ', ['List', 1, 2, 3, 4, 5, 6, 7, 8]]).json).toEqual([
      'List',
      1,
      1,
      2,
      2,
      3,
      4,
      5,
      6,
    ]);
  });

  test('it declines past the work cap, and for an operand beyond a number', () => {
    expect(ev(['PartitionsQ', 10000000]).operator).toBe('PartitionsQ');
    expect(ev(['PartitionsQ', { num: '1' + '0'.repeat(400) }]).operator).toBe(
      'PartitionsQ'
    );
  });
});
