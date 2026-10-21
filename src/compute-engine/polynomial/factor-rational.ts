import {
  FieldPolynomials,
  integerGcd,
  PolynomialBudgetExceeded,
  PolynomialWork,
  rationalCoefficient as rational,
  rationalField as Q,
  type RationalCoefficient,
} from './exact-field.js';
import {
  factorFiniteField,
  primeField,
  type ModularFactorBackend,
} from './finite-field.js';

export interface RationalFactorOptions {
  maxOperations?: number;
  maxDegree?: number;
  maxCoefficientBits?: number;
  check?: () => void;
  modularBackend?: ModularFactorBackend;
}
export interface RationalPolynomialFactor {
  /** Primitive integer coefficients, ascending in degree, positive leading coefficient. */
  coefficients: bigint[];
  multiplicity: number;
}
export interface RationalFactorization {
  domain: 'QQ';
  status: 'complete' | 'zero' | 'incomplete';
  coefficient: RationalCoefficient;
  factors: RationalPolynomialFactor[];
  /** Present only when no complete factorization was certified. */
  remainder?: RationalCoefficient[];
  reason?: string;
  statistics: {
    operations: number;
    primes: number;
    lifts: number;
    subsets: number;
  };
}

const abs = (x: bigint) => (x < 0n ? -x : x);
const trim = (a: readonly bigint[]): bigint[] => {
  let n = a.length;
  while (n && !a[n - 1]) n--;
  return a.slice(0, n);
};
const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;

function multiply(
  a: readonly bigint[],
  b: readonly bigint[],
  work: PolynomialWork
): bigint[] {
  if (!a.length || !b.length) return [];
  const r = Array<bigint>(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    work.tick(b.length);
    for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
  }
  return trim(r);
}

function integerQuotient(
  a: readonly bigint[],
  b: readonly bigint[],
  work: PolynomialWork
): bigint[] | null {
  const r = [...a],
    q = Array<bigint>(Math.max(0, a.length - b.length + 1)).fill(0n);
  for (let i = q.length - 1; i >= 0; i--) {
    work.tick(b.length);
    const c = r[i + b.length - 1];
    if (c % b[b.length - 1] !== 0n) return null;
    q[i] = c / b[b.length - 1];
    for (let j = 0; j < b.length; j++) r[i + j] -= q[i] * b[j];
  }
  return r.every((x) => x === 0n) ? trim(q) : null;
}

function primitive(a: readonly RationalCoefficient[]): bigint[] {
  let d = 1n;
  for (const c of a) d = (d / integerGcd(d, c.denominator)) * c.denominator;
  const ints = a.map((c) => c.numerator * (d / c.denominator));
  let g = 0n;
  for (const c of ints) g = integerGcd(g, c);
  if (!g) return [];
  if (ints[ints.length - 1] < 0n) g = -g;
  return ints.map((c) => c / g);
}

function primitiveInteger(a: readonly bigint[]): bigint[] {
  const f = trim(a);
  if (!f.length) return [];
  let content = 0n;
  for (const c of f) content = integerGcd(content, c);
  if (f[f.length - 1] < 0n) content = -content;
  return f.map((c) => c / content);
}

function integerPolynomialGcd(
  a: bigint[],
  b: bigint[],
  work: PolynomialWork
): bigint[] {
  let x = primitiveInteger(a),
    y = primitiveInteger(b);
  while (y.length) {
    let r = x;
    while (r.length >= y.length) {
      work.tick(r.length + y.length);
      const d = r.length - y.length,
        leading = r[r.length - 1],
        scale = y[y.length - 1];
      const next = r.map((c) => c * scale);
      for (let i = 0; i < y.length; i++) next[i + d] -= leading * y[i];
      // Primitive pseudo-remainders avoid the coefficient swell of a
      // rational Euclidean remainder sequence, without changing the Q-GCD.
      r = primitiveInteger(next);
    }
    x = y;
    y = r;
  }
  return primitiveInteger(x);
}

function integerSquareFree(
  f: bigint[],
  work: PolynomialWork
): { polynomial: bigint[]; multiplicity: number }[] {
  if (f.length <= 1) return [];
  const derivative = f.slice(1).map((c, i) => c * BigInt(i + 1));
  // A degree-preserving square-free reduction certifies square-freeness
  // over Q. Repeated factors cannot disappear at such a good prime.
  for (const prime of [2, 3, 5, 7, 11]) {
    const K = primeField(prime),
      R = new FieldPolynomials(K, work);
    if (K.isZero(f[f.length - 1])) continue;
    if (R.gcd(f.map(K.fromInteger), derivative.map(K.fromInteger)).length === 1)
      return [{ polynomial: f, multiplicity: 1 }];
  }
  let c = integerPolynomialGcd(f, derivative, work);
  let w = integerQuotient(f, c, work)!;
  const parts: { polynomial: bigint[]; multiplicity: number }[] = [];
  for (let multiplicity = 1; w.length > 1; multiplicity++) {
    const y = integerPolynomialGcd(w, c, work);
    const z = integerQuotient(w, y, work)!;
    if (z.length > 1) parts.push({ polynomial: z, multiplicity });
    w = y;
    c = integerQuotient(c, y, work)!;
  }
  return parts;
}

function* subsets(
  n: number,
  k: number,
  start = 0,
  prefix: number[] = []
): Generator<number[]> {
  if (!k) {
    yield prefix;
    return;
  }
  for (let i = start; i <= n - k; i++)
    yield* subsets(n, k - 1, i + 1, [...prefix, i]);
}

function factorMonic(
  f: bigint[],
  work: PolynomialWork,
  backend: ModularFactorBackend,
  stats: RationalFactorization['statistics']
): bigint[][] {
  if (f.length <= 2) return [f];
  let prime = 2,
    chosen = 0,
    base: bigint[][] | undefined;
  // Several good primes avoid unnecessary recombination when a small prime
  // splits a rationally irreducible factor into many pieces.
  for (let candidate = 2; candidate <= 251 && chosen < 3; candidate++) {
    let isPrime = true;
    for (let d = 2; d * d <= candidate; d++)
      if (candidate % d === 0) {
        isPrime = false;
        break;
      }
    if (!isPrime) continue;
    const K = primeField(candidate),
      P = new FieldPolynomials(K, work);
    const reduced = f.map(K.fromInteger);
    if (P.gcd(reduced, P.derivative(reduced)).length !== 1) continue;
    stats.primes++;
    chosen++;
    const factors = backend(reduced, candidate, work);
    // A backend is an accelerator, not a trusted proof source: replay the
    // Frobenius irreducibility criterion and reconstruct before lifting.
    verifyModularFactors(reduced, factors, candidate, work);
    if (!base || factors.length < base.length) {
      prime = candidate;
      base = factors;
    }
    if (factors.length === 1) return [f];
  }
  if (!base) throw new PolynomialBudgetExceeded('no-good-prime');
  const p = BigInt(prime),
    K = primeField(prime),
    P = new FieldPolynomials(K, work);
  const inverses = base.map((b, i) => {
    let other = [1n];
    for (let j = 0; j < base!.length; j++)
      if (j !== i) other = P.mul(other, base![j]);
    return P.inverseMod(P.divrem(other, b)[1], b);
  });
  let lifted = base.map((b) => [...b]),
    modulus = p;
  // Every coefficient of a monic factor is bounded by 2^degree * ||f||_2.
  // The L1 norm is a conservative integer upper bound; M > 2B makes
  // symmetric reconstruction unique for every possible rational factor.
  const bound =
    (1n << BigInt(f.length - 1)) * f.reduce((s, x) => s + abs(x), 0n);
  while (modulus <= 2n * bound) {
    work.tick();
    stats.lifts++;
    const product = lifted.reduce((a, b) => multiply(a, b, work), [1n]);
    const error = f.map((c, i) => {
      const e = c - (product[i] ?? 0n);
      if (e % modulus !== 0n) throw new Error('Invalid Hensel congruence');
      return K.fromInteger(e / modulus);
    });
    lifted = lifted.map((b, i) => {
      const correction = P.divrem(P.mul(error, inverses[i]), base![i])[1];
      return b.map((c, j) => c + modulus * (correction[j] ?? 0n));
    });
    modulus *= p;
  }
  const factors: bigint[][] = [];
  let remaining = f,
    pool = lifted;
  for (let k = 1; 2 * k <= pool.length;) {
    let found = false;
    for (const indices of subsets(pool.length, k)) {
      work.tick();
      stats.subsets++;
      let candidate = [1n];
      for (const i of indices)
        candidate = multiply(candidate, pool[i], work).map((c) =>
          mod(c, modulus)
        );
      candidate = candidate.map((c) => (c > modulus / 2n ? c - modulus : c));
      const quotient = integerQuotient(remaining, candidate, work);
      if (!quotient) continue;
      factors.push(candidate);
      remaining = quotient;
      const removed = new Set(indices);
      pool = pool.filter((_, i) => !removed.has(i));
      found = true;
      k = 1;
      break;
    }
    if (!found) k++;
  }
  if (remaining.length > 1) factors.push(remaining);
  return factors;
}

/** Check a modular backend's factorization using exact Frobenius identities. */
export function verifyModularFactors(
  f: readonly bigint[],
  factors: readonly bigint[][],
  prime: number,
  work = new PolynomialWork()
): void {
  const K = primeField(prime),
    P = new FieldPolynomials(K, work);
  let product = [1n];
  for (const g of factors) {
    if (
      g.length < 2 ||
      g[g.length - 1] !== 1n ||
      g.some((c) => c < 0n || c >= BigInt(prime))
    )
      throw new Error('Invalid modular factor');
    const n = g.length - 1;
    const x = P.divrem([0n, 1n], g)[1];
    let h = x;
    for (let i = 1; i <= n; i++) {
      h = P.powmod(h, BigInt(prime), g);
      if (i <= Math.floor(n / 2) && P.gcd(g, P.sub(h, x)).length !== 1)
        throw new Error('Reducible modular factor');
    }
    if (P.sub(h, x).length) throw new Error('Invalid Frobenius identity');
    product = P.mul(product, g);
  }
  if (P.sub(product, f).length)
    throw new Error('Modular factors do not reconstruct input');
}

/**
 * Factor a univariate rational polynomial into primitive irreducible integer
 * factors. Completion uses modular irreducibility or exhaustive bounded
 * Zassenhaus recombination, not numerical roots or reconstruction alone.
 */
export function factorRationalPolynomial(
  input: readonly RationalCoefficient[],
  options: RationalFactorOptions = {}
): RationalFactorization {
  const work = new PolynomialWork(
    options.maxOperations ?? 2_000_000,
    options.check
  );
  const P = new FieldPolynomials(Q, work);
  const coefficients = P.trim(
    input.map((c) => rational(c.numerator, c.denominator))
  );
  const stats = { operations: 0, primes: 0, lifts: 0, subsets: 0 };
  const result: RationalFactorization = {
    domain: 'QQ',
    status: 'complete',
    coefficient: rational(1n),
    factors: [],
    statistics: stats,
  };
  if (!coefficients.length)
    return { ...result, status: 'zero', coefficient: rational(0n) };
  try {
    const maxDegree = options.maxDegree ?? 128,
      maxBits = options.maxCoefficientBits ?? 4096;
    if (
      !Number.isSafeInteger(maxDegree) ||
      maxDegree < 0 ||
      !Number.isSafeInteger(maxBits) ||
      maxBits < 1
    )
      throw new RangeError('Invalid polynomial size limit');
    if (coefficients.length - 1 > maxDegree)
      throw new PolynomialBudgetExceeded('degree-limit');
    if (
      coefficients.some(
        (c) =>
          abs(c.numerator).toString(2).length > maxBits ||
          c.denominator.toString(2).length > maxBits
      )
    )
      throw new PolynomialBudgetExceeded('coefficient-limit');
    result.coefficient = coefficients[coefficients.length - 1];
    const normalized = primitive(coefficients);
    if (normalized.some((c) => abs(c).toString(2).length > maxBits * 4))
      throw new PolynomialBudgetExceeded('normalized-coefficient-limit');
    for (const part of integerSquareFree(normalized, work)) {
      const integers = part.polynomial,
        n = integers.length - 1,
        a = integers[n];
      // y = a*x converts an arbitrary primitive polynomial into a monic
      // integer polynomial. Mapping its factors back preserves irreducibility.
      const monic = integers.map((c, i) =>
        i === n ? 1n : c * a ** BigInt(n - 1 - i)
      );
      if (monic.some((c) => abs(c).toString(2).length > maxBits * 4))
        throw new PolynomialBudgetExceeded('transformed-coefficient-limit');
      for (const f of factorMonic(
        monic,
        work,
        options.modularBackend ?? factorFiniteField,
        stats
      )) {
        const mapped = primitive(f.map((c, i) => rational(c * a ** BigInt(i))));
        result.factors.push({
          coefficients: mapped,
          multiplicity: part.multiplicity,
        });
        result.coefficient = Q.mul(
          result.coefficient,
          rational(1n, mapped[mapped.length - 1] ** BigInt(part.multiplicity))
        );
      }
    }
    if (!reconstructsRationalFactorization(coefficients, result, work))
      throw new Error('Rational factor reconstruction failed');
  } catch (e) {
    if (!(e instanceof PolynomialBudgetExceeded)) throw e;
    result.status = 'incomplete';
    result.reason = e.reason;
    result.coefficient = rational(1n);
    result.factors = [];
    result.remainder = coefficients;
  }
  stats.operations = work.operations;
  return result;
}

/** Reconstruction only: this does not certify the factors' irreducibility. */
export function reconstructsRationalFactorization(
  input: readonly RationalCoefficient[],
  result: RationalFactorization,
  work = new PolynomialWork()
): boolean {
  if (result.status === 'incomplete') return false;
  const P = new FieldPolynomials(Q, work);
  let product = [result.coefficient];
  for (const f of result.factors) {
    if (
      !Number.isSafeInteger(f.multiplicity) ||
      f.multiplicity < 1 ||
      f.coefficients.length < 2
    )
      return false;
    for (let i = 0; i < f.multiplicity; i++)
      product = P.mul(
        product,
        f.coefficients.map((x) => rational(x))
      );
  }
  return P.sub(product, input).length === 0;
}
