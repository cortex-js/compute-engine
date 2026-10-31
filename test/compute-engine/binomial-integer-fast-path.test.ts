import { binomial } from '../../src/compute-engine/numerics/special-functions';

// The integer loop as it was before the exact fast step: a gcd per step.
function oldInteger(n: number, k: number): number {
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i++) {
    let a = result;
    let b = i;
    while (b !== 0) [a, b] = [b, a % b];
    const g = a;
    result = (result / g) * ((n - kk + i) / (i / g));
    if (!Number.isFinite(result)) return result;
  }
  return result;
}

function check(n: number, k: number) {
  expect(Object.is(binomial(n, k), oldInteger(n, k))).toBe(true);
}

describe('integer binomial exact fast step', () => {
  test('every k for n up to 200, edge and middle k up to 1100', () => {
    for (let n = 0; n <= 200; n++) for (let k = 0; k <= n; k++) check(n, k);
    for (let n = 201; n <= 1100; n += 7) {
      const ks = [0, 1, 2, 3, 10, 30, 100, n >> 1, (n >> 1) + 3, n - 1, n];
      for (const k of ks) if (k <= n) check(n, k);
    }
  });

  test('large n with small k, around and past 2^53', () => {
    const ns = [
      2 ** 31,
      2 ** 40,
      2 ** 52,
      2 ** 53 - 1,
      2 ** 53,
      2 ** 53 + 2,
      2 ** 60,
      1e20,
      1e100,
      1e300,
      Number.MAX_VALUE,
    ];
    for (const n of ns) for (let k = 0; k <= 40; k++) check(n, k);
  });

  test('overflow to Infinity', () => {
    for (const [n, k] of [
      [2000, 1000],
      [1030, 515],
      [1e7, 100],
      [1e5, 200],
    ]) {
      check(n, k);
      expect(binomial(n, k)).toBe(Infinity);
    }
  });
});
