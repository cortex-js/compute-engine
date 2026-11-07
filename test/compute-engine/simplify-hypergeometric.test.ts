import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();

const F = (a: Expression, w: Expression, swap = false) =>
  ce.function(
    'Hypergeometric2F1',
    swap ? [a, ce.One, a.add(1), w] : [ce.One, a, a.add(1), w]
  );

function hypergeometricCount(e: Expression): number {
  if (e.operator === 'Hypergeometric2F1') return 1;
  return (e.ops ?? []).reduce((n, x) => n + hypergeometricCount(x), 0);
}

// Rubi's antiderivative of (1 + x²)/(x² + x⁹) is
//   F(x) = x·₂F₁(1, 1/7; 8/7; −x⁷) − (x⁶/6)·₂F₁(1, 6/7; 13/7; −x⁷) − 1/x,
// and ∫_{1/b}^{b} (1 + x²)/(x² + x⁹) dx = b − 1/b. The sum F(b) − F(1/b) holds
// ₂F₁ at −b⁷ and at −1/b⁷.
function rubiDefiniteIntegral(b: bigint): Expression {
  const at = (x: Expression) => {
    const w = x.pow(7).neg();
    return ce.function('Add', [
      x.mul(F(ce.number([1, 7]), w)),
      x.pow(6).div(6).neg().mul(F(ce.number([6, 7]), w)),
      x.inv().neg(),
    ]);
  };
  const B = ce.number(b);
  return ce.function('Subtract', [at(B), at(B.inv())]).evaluate();
}

describe('the inversion identity of 2F1(1, a; a + 1; w) in a sum', () => {
  test.each([
    [2n, '3/2'],
    [5n, '24/5'],
    [2022n, '4088483/2022'],
  ])('Rubi definite integral from 1/b to b, b = %s', (b, expected) => {
    const sum = rubiDefiniteIntegral(b);
    expect(hypergeometricCount(sum)).toBe(4);
    expect(sum.simplify().toString()).toBe(expected);
    // The reversed bounds give the negated value.
    expect(sum.neg().simplify().toString()).toBe(`-${expected}`);
  });

  // z^a·G_a(z)/a + z^(a−1)·G_(1−a)(1/z)/(1 − a) = π/sin(πa), with
  // G_a(z) = 2F1(1, a; a + 1; −z). Each case has z^a rational.
  test.each([
    // a < 0: z = 8, z^a = 1/2. The parameters of the first term are given in
    // the order (a, 1).
    [[-1, 3], 8, [1, 2], [1, 16], true],
    // a > 1: z = 128, z^a = 2^13, sin(13π/7) = −sin(π/7).
    [[13, 7], 128, [8192, 1], [64, 1], false],
    // a = 1/2 is its own partner parameter: 1 − a = a.
    [[1, 2], 4, [2, 1], [1, 2], false],
  ] as const)(
    'a = %j, z = %d gives π/sin(πa)',
    (a, z, za, zam1, swap) => {
      const A = ce.number(a as [number, number]);
      const Z = ce.number(z);
      const oneMinusA = ce.One.sub(A);
      const sum = ce.function('Add', [
        ce.number(za as [number, number]).div(A).mul(F(A, Z.neg(), swap)),
        ce
          .number(zam1 as [number, number])
          .div(oneMinusA)
          .mul(F(oneMinusA, Z.inv().neg())),
      ]);
      const result = sum.simplify();
      expect(hypergeometricCount(result)).toBe(0);
      const expected = ce.Pi.div(ce.function('Sin', [ce.Pi.mul(A)])).N().re;
      expect(result.N().re).toBeCloseTo(expected, 12);
      expect(sum.N().re).toBeCloseTo(expected, 12);
    }
  );

  test('a negated term and a symbolic cofactor', () => {
    // With a = 1/3 and z = 8: z^a = 2 and z^(a−1) = 1/4, so
    // 6·G_(1/3)(8) + (3/8)·G_(2/3)(1/8) = π/sin(π/3) = 2π/√3, and
    // −G_(1/3)(8) − (1/16)·G_(2/3)(1/8) is −1/6 of it.
    const a = ce.number([1, 3]);
    const b = ce.number([2, 3]);
    const negated = ce.function('Add', [
      F(a, ce.number(-8)).neg(),
      ce.number([-1, 16]).mul(F(b, ce.number([-1, 8]))),
    ]);
    expect(hypergeometricCount(negated.simplify())).toBe(0);
    expect(negated.simplify().N().re).toBeCloseTo(
      -Math.PI / 6 / Math.sin(Math.PI / 3),
      12
    );

    const x = ce.symbol('x');
    const symbolic = ce.function('Add', [
      x.mul(6).mul(F(a, ce.number(-8))),
      x.mul(ce.number([3, 8])).mul(F(b, ce.number([-1, 8]))),
    ]);
    const result = symbolic.simplify();
    expect(hypergeometricCount(result)).toBe(0);
    expect(result.subs({ x: 3 }).N().re).toBeCloseTo(
      (3 * 2 * Math.PI) / Math.sqrt(3),
      12
    );
  });

  test('a partner with its first two parameters swapped combines', () => {
    // 4·G_(1/2)(4) + G_(1/2)(1/4) = π
    const half = ce.number([1, 2]);
    const sum = ce.function('Add', [
      ce.number(4).mul(F(half, ce.number(-4))),
      F(half, ce.number([-1, 4]), true),
    ]);
    const result = sum.simplify();
    expect(hypergeometricCount(result)).toBe(0);
    expect(result.N().re).toBeCloseTo(Math.PI, 12);
  });

  test('a term whose cofactor draws a random number is not rewritten', () => {
    // Without the random factors, the sum is 2π/√3 (see the test above).
    // The two `Random()` calls are two draws. The rewrite of the first term
    // would copy its draw into two terms, so the rule declines a cofactor
    // that is not pure.
    const sum = ce.function('Add', [
      ce
        .function('Random', [])
        .mul(6)
        .mul(F(ce.number([1, 3]), ce.number(-8))),
      ce
        .function('Random', [])
        .mul(ce.number([3, 8]))
        .mul(F(ce.number([2, 3]), ce.number([-1, 8]))),
    ]);
    expect(hypergeometricCount(sum.simplify())).toBe(2);
  });

  test('a family whose terms do not cancel is not rewritten beside one that does', () => {
    const sum = ce.function('Add', [
      rubiDefiniteIntegral(2n),
      F(ce.number([1, 3]), ce.number(-3)),
      F(ce.number([2, 3]), ce.number([-1, 3])),
    ]);
    const result = sum.simplify();
    expect(result.isSame(
      ce.function('Add', [
        ce.number([3, 2]),
        F(ce.number([1, 3]), ce.number(-3)),
        F(ce.number([2, 3]), ce.number([-1, 3])),
      ])
    )).toBe(true);
  });

  test('a term alone is not rewritten', () => {
    const f = F(ce.number([1, 7]), ce.number(-128));
    expect(f.simplify().isSame(f)).toBe(true);
  });

  test('a term without its partner is not rewritten', () => {
    // The partner of 2F1(1, 1/7; 8/7; −128) is 2F1(1, 6/7; 13/7; −1/128).
    const sum = ce.function('Add', [
      F(ce.number([1, 7]), ce.number(-128)),
      F(ce.number([1, 7]), ce.number([-1, 128])),
    ]);
    expect(sum.simplify().isSame(sum)).toBe(true);
  });

  test('a symbolic argument is not rewritten', () => {
    const w = ce.symbol('w');
    const sum = ce.function('Add', [
      F(ce.number([1, 7]), w),
      F(ce.number([6, 7]), w.inv()),
    ]);
    expect(hypergeometricCount(sum.simplify())).toBe(2);
  });
});
