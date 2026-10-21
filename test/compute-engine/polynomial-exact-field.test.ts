import {
  FieldPolynomials,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
} from '../../src/compute-engine/polynomial/exact-field';

describe('Exact coefficient field and polynomial arithmetic', () => {
  const p = new FieldPolynomials(Q);
  const poly = (a: number[]) => a.map((x) => q(BigInt(x)));
  test('normalizes rational signs, zero and large integers', () => {
    expect(q(6n, -9n)).toEqual(q(-2n, 3n));
    expect(q(0n, -9n)).toEqual(q(0n));
    expect(Q.mul(q(2n ** 150n, 3n), q(3n))).toEqual(q(2n ** 150n));
    expect(() => q(1n, 0n)).toThrow();
    expect(() => Q.inv(q(0n))).toThrow();
  });
  test('exact division reconstructs with a remainder', () => {
    const a = poly([1, 2, 3, 4]),
      b = poly([2, 3]);
    const [quotient, remainder] = p.divrem(a, b);
    expect(p.add(p.mul(quotient, b), remainder)).toEqual(a);
    expect(() => p.exactDivide(a, b)).toThrow();
  });
  test('GCD normalizes units and accepts zero operands', () => {
    expect(p.gcd(poly([-2, 0, 2]), poly([-3, 3]))).toEqual(poly([-1, 1]));
    expect(p.gcd([], [])).toEqual([]);
    expect(p.gcd(poly([2, 2]), [])).toEqual(poly([1, 1]));
  });
  test('square-free decomposition recovers multiplicities', () => {
    const a = poly([-1, 1]),
      b = poly([1, 0, 1]);
    const f = p.mul(p.mul(a, a), p.mul(p.mul(b, b), b));
    expect(p.squareFree(f)).toEqual([
      { polynomial: a, multiplicity: 2 },
      { polynomial: b, multiplicity: 3 },
    ]);
  });
  test('modular inverse and exponentiation use exact coefficients', () => {
    const x = poly([0, 1]),
      m = poly([1, 0, 1]);
    expect(p.inverseMod(x, m)).toEqual(poly([0, -1]));
    expect(p.powmod(x, 4n, m)).toEqual(poly([1]));
    expect(() => p.inverseMod([], m)).toThrow();
  });
  test('work budgets and cancellation are local and observable', () => {
    expect(() =>
      new FieldPolynomials(Q, new PolynomialWork(1)).mul(
        poly([1, 1]),
        poly([1, 1])
      )
    ).toThrow('operation-limit');
    const check = jest.fn(() => {
      throw new Error('cancelled');
    });
    expect(() =>
      new FieldPolynomials(Q, new PolynomialWork(100, check)).gcd(
        poly([1, 1]),
        poly([1])
      )
    ).toThrow('cancelled');
    expect(p.mul(poly([1]), poly([1]))).toEqual(poly([1]));
  });
});
