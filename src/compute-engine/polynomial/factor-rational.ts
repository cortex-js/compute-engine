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
  type ModularFactorBackend,
} from './finite-field.js';
import { SmallPrimePolynomials } from './small-prime.js';

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
    work.tick();
    if (a[i] === 0n) continue;
    work.tick(b.length);
    for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
  }
  return trim(r);
}

/** Coefficients of f(x + shift), by exact Horner composition. */
function translate(
  f: readonly bigint[],
  shift: bigint,
  work: PolynomialWork
): bigint[] {
  let result: bigint[] = [];
  for (let i = f.length - 1; i >= 0; i--) {
    const next = Array<bigint>(result.length + 1).fill(0n);
    work.tick(result.length + 1);
    for (let j = 0; j < result.length; j++) {
      next[j] += shift * result[j];
      next[j + 1] += result[j];
    }
    next[0] += f[i];
    result = next;
  }
  return trim(result);
}

function integerQuotient(
  a: readonly bigint[],
  b: readonly bigint[],
  work: PolynomialWork
): bigint[] | null {
  // Every integer divisor's constant coefficient divides the input constant.
  // This inexpensive necessary condition rejects most recombination subsets.
  if (b[0] !== 0n && a[0] % b[0] !== 0n) return null;
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
    const R = new SmallPrimePolynomials(prime, work);
    if (R.field.fromInteger(f[f.length - 1]) === 0) continue;
    if (R.gcd(R.fromIntegers(f), R.fromIntegers(derivative)).length === 1)
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
  stats: RationalFactorization['statistics'],
  seed?: { prime: number; factors: bigint[][] }
): bigint[][] {
  if (f.length <= 2) return [f];
  if (!seed) {
    // Center a large root cluster before modular work. Translation preserves
    // irreducibility and can dramatically reduce the required lifting height.
    const shift = -f[f.length - 2] / BigInt(f.length - 1);
    if (abs(shift) > 1n) {
      const centered = translate(f, shift, work);
      const norm = (g: readonly bigint[]) => g.reduce((s, c) => s + abs(c), 0n);
      if (4n * norm(centered) < norm(f))
        return factorMonic(centered, work, backend, stats).map((g) =>
          translate(g, -shift, work)
        );
    }
  }
  // Eisenstein is a sufficient certificate, never a heuristic classification.
  // Trial primes are bounded; an unsuccessful search falls through normally.
  let content = 0n;
  for (let i = 0; i < f.length - 1 && content !== 1n; i++) {
    work.tick();
    content = integerGcd(content, f[i]);
  }
  if (content > 1n) {
    for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n]) {
      work.tick();
      if (content % p === 0n && f[0] % (p * p) !== 0n) return [f];
    }
  }
  let prime = seed?.prime ?? 2,
    chosen = seed ? 3 : 0,
    base: bigint[][] | undefined = seed?.factors;
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
    const P = new SmallPrimePolynomials(candidate, work);
    const reduced = P.fromIntegers(f);
    if (P.gcd(reduced, P.derivative(reduced)).length !== 1) continue;
    stats.primes++;
    chosen++;
    const factors = backend(reduced.map(BigInt), candidate, work);
    // A backend is an accelerator, not a trusted proof source: replay the
    // Frobenius irreducibility criterion and reconstruct before lifting.
    verifyModularFactors(reduced.map(BigInt), factors, candidate, work);
    if (!base || factors.length < base.length) {
      prime = candidate;
      base = factors;
    }
    if (factors.length === 1) return [f];
    // With at most four modular factors, exhaustive recombination is small;
    // another full Berlekamp decomposition usually costs more than it saves.
    if (factors.length <= 4) break;
  }
  if (!base) throw new PolynomialBudgetExceeded('no-good-prime');
  const p = BigInt(prime),
    P = new SmallPrimePolynomials(prime, work),
    K = P.field;
  const modular = base.map((b) => b.map(Number));
  const makeInverses = () => {
    const reduced = P.fromIntegers(f);
    return modular.map((b) =>
      P.inverseMod(P.divrem(P.exactDivide(reduced, b), b)[1], b)
    );
  };
  let inverses = makeInverses();
  let lifted = base.map((b) => [...b]),
    modulus = p;
  const factors: bigint[][] = [];
  const norm = (g: readonly bigint[]) => g.reduce((s, c) => s + abs(c), 0n);
  const symmetric = (g: readonly bigint[]) =>
    g.map((c) => (c > modulus / 2n ? c - modulus : c));
  const possibleSubset = (
    indices: readonly number[],
    pool: readonly bigint[][],
    height: bigint
  ): boolean => {
    let degree = 0,
      trace = 0n,
      constant = 1n;
    work.tick(indices.length);
    for (const i of indices) {
      const g = pool[i];
      degree += g.length - 1;
      trace += g[g.length - 2];
      constant = mod(constant * g[0], modulus);
    }
    trace = mod(trace, modulus);
    if (trace > modulus / 2n) trace -= modulus;
    if (constant > modulus / 2n) constant -= modulus;
    // For a monic degree-d divisor g, |g_0| <= M(g) <= ||f||_1 and
    // |g_(d-1)| <= d*M(g), where M is Mahler measure. The least-absolute
    // modular representatives cannot exceed these bounds for an actual factor.
    return abs(trace) <= BigInt(degree) * height && abs(constant) <= height;
  };
  // Every coefficient of a monic factor is bounded by 2^degree * ||f||_2.
  // The L1 norm is a conservative integer upper bound; M > 2B makes
  // symmetric reconstruction unique for every possible rational factor.
  const coefficientBound = () => (1n << BigInt(f.length - 1)) * norm(f);
  let bound = coefficientBound(),
    exponent = 1,
    nextRecovery = 1;
  while (modulus <= 2n * bound) {
    work.tick();
    if (exponent >= nextRecovery) {
      nextRecovery *= 2;
      let removed = false;
      for (let i = lifted.length - 1; i >= 0; i--) {
        const candidate = symmetric(lifted[i]);
        stats.subsets++;
        const quotient = integerQuotient(f, candidate, work);
        if (!quotient) continue;
        // A single verified irreducible modular factor certifies this exact
        // divisor over Q, even before the global coefficient bound is reached.
        factors.push(candidate);
        f = quotient;
        lifted.splice(i, 1);
        modular.splice(i, 1);
        removed = true;
      }
      if (lifted.length <= 1) {
        if (f.length > 1) factors.push(f);
        return factors;
      }
      // A small early subset search discovers exact splits, not certificates.
      // Re-factor both proper divisors to prove irreducibility. This cannot
      // return a reducible factor merely because reconstruction succeeded.
      let attempts = 0;
      const height = norm(f);
      earlySearch: for (
        let size = 2;
        size <= Math.min(4, Math.floor(lifted.length / 2));
        size++
      ) {
        for (const indices of subsets(lifted.length, size)) {
          if (++attempts > 256) break earlySearch;
          stats.subsets++;
          if (!possibleSubset(indices, lifted, height)) continue;
          const candidate = symmetric(
            indices.reduce(
              (g, i) =>
                multiply(g, lifted[i], work).map((c) => mod(c, modulus)),
              [1n]
            )
          );
          const quotient = integerQuotient(f, candidate, work);
          if (quotient)
            return [
              ...factors,
              // These already-verified modular factors partition the two
              // exact divisors. Reuse them rather than factor modulo p again.
              ...factorMonic(candidate, work, backend, stats, {
                prime,
                factors: indices.map((i) => modular[i].map(BigInt)),
              }),
              ...factorMonic(quotient, work, backend, stats, {
                prime,
                factors: modular
                  .filter((_, i) => !indices.includes(i))
                  .map((g) => g.map(BigInt)),
              }),
            ];
        }
      }
      if (removed) {
        inverses = makeInverses();
        bound = coefficientBound();
      }
    }
    stats.lifts++;
    const product = lifted.reduce((a, b) => multiply(a, b, work), [1n]);
    const error = f.map((c, i) => {
      const e = c - (product[i] ?? 0n);
      if (e % modulus !== 0n) throw new Error('Invalid Hensel congruence');
      return K.fromInteger(e / modulus);
    });
    lifted = lifted.map((b, i) => {
      const reducedError = P.divrem(error, modular[i])[1];
      const correction = P.divrem(
        P.mul(reducedError, inverses[i]),
        modular[i]
      )[1];
      return b.map((c, j) => c + modulus * BigInt(correction[j] ?? 0));
    });
    modulus *= p;
    exponent++;
  }
  let remaining = f,
    pool = lifted,
    remainingHeight = norm(f);
  for (let k = 1; 2 * k <= pool.length;) {
    let found = false;
    for (const indices of subsets(pool.length, k)) {
      work.tick();
      stats.subsets++;
      if (!possibleSubset(indices, pool, remainingHeight)) continue;
      let candidate = [1n];
      for (const i of indices)
        candidate = multiply(candidate, pool[i], work).map((c) =>
          mod(c, modulus)
        );
      candidate = symmetric(candidate);
      const quotient = integerQuotient(remaining, candidate, work);
      if (!quotient) continue;
      factors.push(candidate);
      remaining = quotient;
      remainingHeight = norm(remaining);
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
  const P = new SmallPrimePolynomials(prime, work);
  let product = [1];
  for (const factor of factors) {
    if (
      factor.length < 2 ||
      factor[factor.length - 1] !== 1n ||
      factor.some((c) => c < 0n || c >= BigInt(prime))
    )
      throw new Error('Invalid modular factor');
    const g = factor.map(Number),
      n = g.length - 1;
    if (n === 1) {
      product = P.mul(product, g);
      continue;
    }
    const x = P.divrem([0, 1], g)[1];
    // Rabin's criterion needs gcd tests only at n/q for prime divisors q
    // of n, together with the final x^(p^n) = x congruence.
    const checks = new Set<number>();
    let degree = n;
    for (let q = 2; q * q <= degree; q++) {
      if (degree % q !== 0) continue;
      checks.add(n / q);
      while (degree % q === 0) degree /= q;
    }
    if (degree > 1) checks.add(n / degree);
    let h = x;
    for (let i = 1; i <= n; i++) {
      h = P.powmod(h, BigInt(prime), g);
      if (checks.has(i) && P.gcd(g, P.sub(h, x)).length !== 1)
        throw new Error('Reducible modular factor');
    }
    if (P.sub(h, x).length) throw new Error('Invalid Frobenius identity');
    product = P.mul(product, g);
  }
  if (P.sub(product, P.fromIntegers(f)).length)
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
  if (result.coefficient.denominator <= 0n) return false;
  let product = [1n];
  for (const f of result.factors) {
    if (
      !Number.isSafeInteger(f.multiplicity) ||
      f.multiplicity < 1 ||
      f.coefficients.length < 2 ||
      f.coefficients[f.coefficients.length - 1] === 0n
    )
      return false;
    for (let i = 0; i < f.multiplicity; i++)
      product = multiply(product, f.coefficients, work);
  }
  // Integer convolution followed by cross multiplication avoids normalizing a
  // rational after every multiply-add, while checking exactly the same identity.
  const scalar = result.coefficient;
  for (let i = 0; i < Math.max(product.length, input.length); i++) {
    work.tick();
    const c = input[i] ?? Q.zero;
    if (
      (product[i] ?? 0n) * scalar.numerator * c.denominator !==
      c.numerator * scalar.denominator
    )
      return false;
  }
  return true;
}
