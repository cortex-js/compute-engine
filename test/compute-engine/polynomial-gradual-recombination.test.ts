import { factorRationalPolynomial } from '../../src/compute-engine/polynomial/factor-rational';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field';

const mul = (a: bigint[], b: bigint[]) => {
  const result = Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) result[i + j] += a[i] * b[j];
  return result;
};

function signedRootPolynomial(primes: bigint[]): bigint[] {
  let f = [0n, 1n];
  for (const p of primes) {
    // Multiply f(x+sqrt(p)) by its conjugate using exact quadratic pairs.
    let a = [f.at(-1)!],
      b = [0n];
    for (let i = f.length - 2; i >= 0; i--) {
      const nextA = [f[i], ...a],
        nextB = [0n, ...b];
      for (let j = 0; j < b.length; j++) nextA[j] += p * b[j];
      for (let j = 0; j < a.length; j++) nextB[j] += a[j];
      a = nextA;
      b = nextB;
    }
    const aa = mul(a, a),
      bb = mul(b, b);
    f = aa.map((c, i) => c - p * (bb[i] ?? 0n));
    while (f.at(-1) === 0n) f.pop();
  }
  return f;
}

test.each([
  [2n, 3n, 5n, 7n, 11n, 13n],
  [2n, 3n, 5n, 7n, 11n, 17n],
])(
  'certifies a multiquadratic irreducible with many modular pieces: %j',
  (...primes) => {
    // Independent prime squareclasses have 64 distinct signed sums, proving
    // irreducibility without using a reference factorizer or recognizing a name.
    const f = signedRootPolynomial(primes);
    expect(f).toHaveLength(65);
    const result = factorRationalPolynomial(f.map((c) => q(c)));
    expect(result.status).toBe('complete');
    expect(result.factors).toEqual([{ coefficients: f, multiplicity: 1 }]);
    expect(result.statistics.latticeCompletions).toBeGreaterThan(0);
  }
);

test('recovers distinct rational factors instead of treating a large modular partition as irreducible', () => {
  const a = signedRootPolynomial([2n, 3n, 5n, 7n]);
  const b = signedRootPolynomial([2n, 3n, 5n, 11n]);
  const result = factorRationalPolynomial(
    mul(a, b).map((c) => q(c)),
    { recombination: 'lattice' }
  );
  expect(result.status).toBe('complete');
  expect(result.factors.map((f) => f.coefficients.join(',')).sort()).toEqual(
    [a.join(','), b.join(',')].sort()
  );
});

test('resource exhaustion never upgrades an incomplete recombination to irreducible', () => {
  const f = signedRootPolynomial([2n, 3n, 5n, 7n, 11n, 13n]);
  const result = factorRationalPolynomial(
    f.map((c) => q(c)),
    { maxOperations: 1_000_000 }
  );
  expect(result.status).toBe('incomplete');
  expect(result.reason).toBe('operation-limit');
  expect(result.factors).toEqual([]);
});

test('lifts beyond reconstruction precision when a reducible family needs stronger lattice constraints', () => {
  const a = signedRootPolynomial([2n, 3n, 5n, 7n]);
  const unshifted = signedRootPolynomial([2n, 3n, 5n, 7n, 11n]);
  let b = [unshifted.at(-1)!];
  for (let i = unshifted.length - 2; i >= 0; i--) {
    b = mul(b, [1n, 1n]);
    b[0] += unshifted[i];
  }
  const result = factorRationalPolynomial(mul(a, b).map((c) => q(c)));
  expect(result.status).toBe('complete');
  expect(result.factors.map((f) => f.coefficients.join(',')).sort()).toEqual(
    [a.join(','), b.join(',')].sort()
  );
  expect(result.statistics.latticeCompletions).toBeGreaterThan(0);
});
