import {
  HenselTree,
  ModularPolynomials,
} from '../../src/compute-engine/polynomial/hensel';
import {
  PolynomialWork,
  FieldPolynomials,
  rationalField as Q,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';
import { factorFiniteField } from '../../src/compute-engine/polynomial/finite-field';
import { factorRationalPolynomial as factor } from '../../src/compute-engine/polynomial/factor-rational';

test.each([2, 3, 5, 7])(
  'quadratic lifts preserve exact congruences over powers of %i',
  (prime) => {
    const work = new PolynomialWork(10_000_000);
    // A square-free reduction with uneven factor degrees; coefficients above p
    // require several precision doublings and exercise lifted inverses.
    const f = [-1n, ...Array<bigint>(6).fill(0n), 1n];
    if (prime === 7) f[1] = 1n;
    const R = new ModularPolynomials(BigInt(prime), work);
    const base = factorFiniteField(R.normalize(f), prime, work);
    const tree = new HenselTree(base, prime, work);
    for (let i = 0; i < 5; i++) {
      tree.lift(f);
      const S = new ModularPolynomials(tree.modulus, work);
      expect(tree.factors().map((g) => g.length)).toEqual(
        base.map((g) => g.length)
      );
      const product = tree.factors().reduce((a, b) => S.mul(a, b), [1n]);
      expect(product).toEqual(S.normalize(f));
      tree.factors().forEach((g, j) => expect(R.normalize(g)).toEqual(base[j]));
    }
  }
);

test('prime-power division does not assume nonzero coefficients are invertible', () => {
  const R = new ModularPolynomials(16n, new PolynomialWork());
  const a = [2n, 4n, 1n],
    b = [8n, 1n];
  const product = R.mul(a, b);
  expect(R.divrem(product, b)).toEqual([a, []]);
  expect(() => R.divrem(product, [1n, 2n])).toThrow('monic');
});

test('invalid targets and cancelled lifts do not commit partial tree state', () => {
  let cancel = false;
  const work = new PolynomialWork(100_000, () => {
    if (cancel) throw Error('cancelled');
  });
  const tree = new HenselTree(
    [
      [1n, 1n],
      [2n, 1n],
    ],
    5,
    work
  );
  const before = tree.factors();
  expect(() => tree.lift([3n, 3n, 1n])).toThrow('congruence');
  cancel = true;
  expect(() => tree.lift([2n, 3n, 1n])).toThrow('cancelled');
  expect(tree.modulus).toBe(5n);
  expect(tree.factors()).toEqual(before);
  cancel = false;
  tree.lift([2n, 3n, 1n]);
  expect(tree.modulus).toBe(25n);
  expect(
    () =>
      new HenselTree(
        [
          [1n, 1n],
          [1n, 1n],
        ],
        5,
        work
      )
  ).toThrow();
});

test('linear and quadratic strategies agree on nonmonic, repeated and large factors', () => {
  const P = new FieldPolynomials(Q, new PolynomialWork(10_000_000));
  for (let i = 1n; i <= 12n; i++) {
    const a = [q(i), q(1n), q(3n)],
      b = [q(2n ** (i + 20n) + 1n), q(0n), q(1n)];
    const f = P.mul(P.mul(a, a), b);
    const linear = factor(f, { lifting: 'linear' }),
      quadratic = factor(f, { lifting: 'quadratic' });
    const signature = (r: typeof linear) =>
      r.factors
        .map((g) => `${g.coefficients.join(',')}^${g.multiplicity}`)
        .sort();
    expect(linear.status).toBe('complete');
    expect(quadratic.status).toBe('complete');
    expect(signature(quadratic)).toEqual(signature(linear));
    expect(quadratic.coefficient).toEqual(linear.coefficient);
  }
});
