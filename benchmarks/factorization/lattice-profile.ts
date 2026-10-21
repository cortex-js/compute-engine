import { challengeCorpus } from './challenge-corpus.js';
import { recombinationCorpus } from './recombination-corpus.js';
import { PolynomialWork } from '../../src/compute-engine/polynomial/exact-field.js';
import { factorFiniteField } from '../../src/compute-engine/polynomial/finite-field.js';
import { SmallPrimePolynomials } from '../../src/compute-engine/polynomial/small-prime.js';
import { HenselTree } from '../../src/compute-engine/polynomial/hensel.js';
import {
  gradualLatticePartition,
  minimumLatticeModulus,
} from '../../src/compute-engine/polynomial/lattice-recombination.js';

const id = process.argv[2] ?? 'challenge-041';
const c = (
  id.startsWith('recombination-') ? recombinationCorpus() : challengeCorpus()
).find((c) => c.id === id);
if (!c) throw new Error('Unknown diagnostic case');
const f = c.coefficients.map(([n]) => BigInt(n));
const work = new PolynomialWork(20_000_000);
let prime = 2;
for (; ; prime++) {
  if (
    Array.from(
      { length: Math.max(0, Math.floor(Math.sqrt(prime)) - 1) },
      (_, i) => i + 2
    ).some((d) => prime % d === 0)
  )
    continue;
  const P = new SmallPrimePolynomials(prime, work);
  const reduced = P.fromIntegers(f);
  if (P.gcd(reduced, P.derivative(reduced)).length === 1) break;
}
const start = performance.now();
const factors = factorFiniteField(f, prime, work);
console.log({
  prime,
  factors: factors.length,
  modularMs: performance.now() - start,
});
const tree = new HenselTree(factors, prime, work);
const bound =
  (1n << BigInt(f.length - 1)) * f.reduce((s, c) => s + (c < 0n ? -c : c), 0n);
while (
  tree.modulus <= 2n * bound ||
  tree.modulus < minimumLatticeModulus(f, factors.length)
)
  tree.lift(f);
const before = work.operations,
  t = performance.now();
console.log({
  bits: tree.modulus.toString(2).length,
  liftMs: t - start,
  work: before,
});
console.log({
  groups: gradualLatticePartition(
    f,
    tree.factors(),
    tree.modulus,
    work,
    (column, rank, operations) =>
      console.log({ column, rank, operations: operations - before })
  ),
  ms: performance.now() - t,
  operations: work.operations - before,
});
