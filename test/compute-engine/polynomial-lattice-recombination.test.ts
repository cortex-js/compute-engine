import { latticeFactorPartition } from '../../src/compute-engine/polynomial/lattice-recombination';
import {
  HenselTree,
  ModularPolynomials,
} from '../../src/compute-engine/polynomial/hensel';
import { factorFiniteField } from '../../src/compute-engine/polynomial/finite-field';
import {
  PolynomialWork,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';
import { factorRationalPolynomial as factor } from '../../src/compute-engine/polynomial/factor-rational';

function lifted(f: bigint[], prime = 5) {
  const work = new PolynomialWork(10_000_000),
    R = new ModularPolynomials(BigInt(prime), work);
  const base = factorFiniteField(R.normalize(f), prime, work);
  const tree = new HenselTree(base, prime, work);
  for (let k = 0; k < 5; k++) tree.lift(f);
  return { work, base, tree };
}

test('proves modular pieces inseparable for an irreducible rational polynomial', () => {
  const f = [1n, 0n, 0n, 0n, 1n]; // Phi_8, irreducible over Q.
  const { work, base, tree } = lifted(f);
  expect(base.length).toBeGreaterThan(1);
  expect(latticeFactorPartition(f, tree.factors(), tree.modulus, work)).toEqual(
    [base.map((_, i) => i)]
  );
});

test('recovers correct blocks rather than mistaking modular pieces for rational factors', () => {
  const f = [2n, 0n, 3n, 0n, 1n];
  const { work, tree } = lifted(f);
  const groups = latticeFactorPartition(f, tree.factors(), tree.modulus, work)!;
  expect(groups).not.toBeNull();
  const R = new ModularPolynomials(tree.modulus, work),
    fs = tree.factors();
  const recovered = groups.map((g) =>
    g.reduce((a, i) => R.mul(a, fs[i]), [1n])
  );
  expect(recovered.map((g) => g.join(',')).sort()).toEqual(['1,0,1', '2,0,1']);
});

test('every certified block respects independent known irreducible factors', () => {
  for (let a = 1n; a <= 8n; a++) {
    const b = a + 1n,
      f = [a * b, 0n, a + b, 0n, 1n];
    const prime = [5, 7, 11, 13].find((p) => a % BigInt(p) && b % BigInt(p))!;
    const { work, base, tree } = lifted(f, prime);
    const groups = latticeFactorPartition(
      f,
      tree.factors(),
      tree.modulus,
      work
    );
    if (!groups) continue;
    const R = new ModularPolynomials(BigInt(prime), work);
    const belongsToA = base.map(
      (g) => R.divrem([a, 0n, 1n], g)[1].length === 0
    );
    for (const group of groups)
      expect(new Set(group.map((i) => belongsToA[i])).size).toBe(1);
  }
});

test('insufficient precision and probe limits are inconclusive, while cancellation propagates', () => {
  const f = [1n, 0n, 0n, 0n, 1n],
    { work, base, tree } = lifted(f);
  expect(latticeFactorPartition(f, base, 5n, work)).toBeNull();
  expect(
    latticeFactorPartition(f, tree.factors(), tree.modulus, work, 2, 100_000, 2)
  ).toBeNull();
  expect(
    latticeFactorPartition(f, tree.factors(), tree.modulus, work, 2, 0)
  ).toBeNull();
  expect(() =>
    latticeFactorPartition(
      f,
      tree.factors(),
      tree.modulus,
      new PolynomialWork(0)
    )
  ).toThrow('operation-limit');
  expect(() =>
    latticeFactorPartition(
      f,
      tree.factors(),
      tree.modulus,
      new PolynomialWork(100_000, () => {
        throw Error('cancelled');
      })
    )
  ).toThrow('cancelled');
  expect(() =>
    latticeFactorPartition(
      f,
      [
        [1n, 1n],
        [2n, 1n],
      ],
      tree.modulus,
      work
    )
  ).toThrow('reconstruct');
});

test.each(['linear', 'quadratic'] as const)(
  'lattice and exhaustive strategies preserve exact answers with %s lifting',
  (lifting) => {
    for (const f of [
      [1n, 0n, 0n, 0n, 1n],
      [2n, 0n, 3n, 0n, 1n],
      [-1n, ...Array<bigint>(11).fill(0n), 1n],
      [4n, 0n, 0n, 0n, 1n],
    ]) {
      const input = f.map((n) => q(n));
      const plain = factor(input, { lifting, recombination: 'subsets' });
      const lattice = factor(input, { lifting, recombination: 'lattice' });
      expect(lattice.status).toBe('complete');
      expect(lattice.coefficient).toEqual(plain.coefficient);
      expect(
        lattice.factors.map((g) => g.coefficients.join(',')).sort()
      ).toEqual(plain.factors.map((g) => g.coefficients.join(',')).sort());
    }
  }
);
