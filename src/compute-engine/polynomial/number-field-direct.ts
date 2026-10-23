import {
  FieldPolynomials,
  integerGcd,
  PolynomialBudgetExceeded,
  PolynomialInvariantError,
  rationalCoefficient as q,
  type RationalCoefficient,
} from './exact-field.js';
import type {
  NumberFieldElement,
  RationalNumberField,
} from './rational-number-field.js';
import { NumberFieldWork } from './number-field-work.js';
import { finiteExtension, factorFiniteExtension } from './finite-extension.js';
import { SmallPrimePolynomials } from './small-prime.js';
import {
  NumberFieldHenselTree,
  NumberFieldResidueRing,
  type ResiduePolynomial,
} from './number-field-hensel.js';
import {
  numberFieldRationalReconstructor,
  numberFieldDivisibilityFilter,
} from './number-field-modular.js';
import { numberFieldLatticePartition } from './number-field-lattice.js';

const lcm = (a: bigint, b: bigint) => (a / integerGcd(a, b)) * b;
const abs = (a: bigint) => (a < 0n ? -a : a);

function boundedPower(
  base: bigint,
  exponent: number,
  work: NumberFieldWork
): bigint {
  let result = 1n;
  while (exponent) {
    work.tick();
    if (exponent % 2)
      result = work.rational.fromInteger(result * base).numerator;
    exponent = Math.floor(exponent / 2);
    if (exponent) base = work.rational.fromInteger(base * base).numerator;
  }
  return result;
}

export interface DirectNumberFieldStatistics {
  primeAttempts: number;
  prime?: number;
  modularFactors: number;
  lifts: number;
  subsets: number;
  precisionBits: number;
  boundBits?: number;
  latticeProbes?: number;
  latticeColumns?: number;
  latticeRank?: number;
  recoveryCandidates?: number;
  recoveryRejections?: number;
  exactDivisions?: number;
  certificate?:
    | 'modular-irreducibility'
    | 'modular-atoms'
    | 'bounded-recombination'
    | 'lattice-recombination';
  fallback?: string;
}

interface IntegralModel {
  defining: bigint[];
  polynomial: ResiduePolynomial;
  generatorScale: bigint;
  variableScale: bigint;
}

/** beta=D*alpha and y=T*x make both defining and input polynomials integral. */
function integralModel(
  field: RationalNumberField,
  f: readonly NumberFieldElement[],
  work: NumberFieldWork
): IntegralModel {
  const d = field.degree,
    n = f.length - 1;
  const D = field.definingPolynomial.reduce(
    (s, c) => work.rational.fromInteger(lcm(s, c.denominator)).numerator,
    1n
  );
  const powers = Array.from({ length: Math.max(d, n) + 1 }, (_, i) =>
    boundedPower(D, i, work)
  );
  const defining = field.definingPolynomial.map(
    (c, i) =>
      work.rational.fromInteger((c.numerator * powers[d - i]) / c.denominator)
        .numerator
  );
  let T = 1n;
  for (const c of f.slice(0, -1))
    for (const [j, a] of c.coefficients.entries()) {
      work.tick();
      T = work.rational.fromInteger(
        lcm(T, q(a.numerator, a.denominator * powers[j]).denominator)
      ).numerator;
    }
  const polynomial = f.map((c, i) =>
    c.coefficients.map((a, j) => {
      const value = work.rational.mul(
        a,
        q(boundedPower(T, n - i, work), powers[j])
      );
      if (value.denominator !== 1n)
        throw new PolynomialInvariantError(
          'Nonintegral number field transform'
        );
      return value.numerator;
    })
  );
  return { defining, polynomial, generatorScale: D, variableScale: T };
}

/**
 * Bounds all coefficients of every monic divisor, not only the input's factors.
 * Trace-dual coordinates give L*c_j integral even for nonmaximal power orders.
 */
export function numberFieldReconstructionBound(
  defining: readonly bigint[],
  polynomial: readonly (readonly bigint[])[],
  work: NumberFieldWork
): { denominator: bigint; bound: bigint; logarithmBounds: bigint[][] } {
  const Q = new FieldPolynomials(work.rational, work);
  const m = defining.map((c) => q(c)),
    d = m.length - 1;
  const inverse = Q.inverseMod(Q.derivative(m), m);
  const dual = Array.from(
    { length: d },
    (_, j) => Q.divrem(Q.mul(m.slice(j + 1), inverse), m)[1]
  );
  const denominator = dual
    .flat()
    .reduce(
      (s, c) => work.rational.fromInteger(lcm(s, c.denominator)).numerator,
      1n
    );
  const R =
    1n + defining.slice(0, -1).reduce((s, c) => (abs(c) > s ? abs(c) : s), 0n);
  const norm = (cs: readonly bigint[]) => {
    let value = 0n;
    for (let i = cs.length - 1; i >= 0; i--) {
      work.tick();
      value = work.rational.fromInteger(value * R + abs(cs[i])).numerator;
    }
    return value;
  };
  const A = polynomial.slice(0, -1).reduce((s, c) => {
    const a = norm(c);
    return a > s ? a : s;
  }, 0n);
  // Every conjugate root has modulus <= 1+A; an elementary symmetric
  // coefficient of any monic divisor is bounded by (1+(1+A))^n.
  const conjugateBound = boundedPower(2n + A, polynomial.length - 1, work);
  const dualBounds = dual.map((row) =>
    norm(row.map((c) => c.numerator * (denominator / c.denominator)))
  );
  const dualBound = dualBounds.reduce((s, a) => (a > s ? a : s), 0n);
  const n = polynomial.length - 1;
  const inputNorm = polynomial.reduce(
    (s, c) => work.rational.fromInteger(s + norm(c)).numerator,
    0n
  );
  let choose = 1n;
  // For every embedding, Mahler(F) <= ||F||_1. The kth coefficient of
  // F*g'/g is at most n*binomial(n-1,k)*Mahler(F). Applying the trace-dual
  // coordinate formula bounds the integer L*c_j without choosing embeddings.
  const logarithmBounds = Array.from({ length: n }, (_, k) => {
    if (k) choose = (choose * BigInt(n - k)) / BigInt(k);
    return dualBounds.map(
      (b) =>
        work.rational.fromInteger(BigInt(d * n) * choose * inputNorm * b)
          .numerator
    );
  });
  return {
    denominator,
    logarithmBounds,
    bound: work.rational.fromInteger(BigInt(d) * conjugateBound * dualBound)
      .numerator,
  };
}

/** Direct Zassenhaus over an inert good prime, with an explicit no-prime fallback. */
export function factorNumberFieldDirect(
  field: RationalNumberField,
  f: readonly NumberFieldElement[],
  P: FieldPolynomials<NumberFieldElement>,
  work: NumberFieldWork,
  stats: DirectNumberFieldStatistics,
  maxPrimes: number,
  maxLifts: number,
  recombination: 'auto' | 'subsets' | 'lattice' = 'auto',
  filterRecovery = true
): NumberFieldElement[][] | undefined {
  const model = work.scope('preprocessing', () =>
    integralModel(field, f, work)
  );
  const { defining, polynomial, generatorScale: D, variableScale: T } = model;
  let selected:
    | {
        prime: number;
        factors: number[][][];
        field: NonNullable<ReturnType<typeof finiteExtension>>;
      }
    | undefined;
  work.scope('finite-factorization', () => {
    for (let p = 3; stats.primeAttempts < maxPrimes && p <= 65521; p += 2) {
      let prime = true;
      for (let j = 3; j * j <= p; j += 2)
        if (p % j === 0) {
          prime = false;
          break;
        }
      if (!prime) continue;
      stats.primeAttempts++;
      work.tick();
      if (D % BigInt(p) === 0n || T % BigInt(p) === 0n) continue;
      const S = new SmallPrimePolynomials(p, work);
      const K = finiteExtension(S.fromIntegers(defining), p, work);
      if (!K) continue;
      const R = new FieldPolynomials(K, work);
      const reduced = polynomial.map((c) => S.fromIntegers(c));
      if (R.gcd(reduced, R.derivative(reduced)).length !== 1) continue;
      selected = {
        prime: p,
        factors: factorFiniteExtension(reduced, R, p, field.degree),
        field: K,
      };
      break;
    }
  });
  if (!selected) {
    stats.fallback = 'no-inert-good-prime';
    return undefined;
  }
  const { prime, factors, field: residueField } = selected;
  stats.prime = prime;
  stats.precisionBits = BigInt(prime).toString(2).length;
  stats.modularFactors = factors.length;
  if (factors.length === 1) {
    stats.certificate = 'modular-irreducibility';
    return [[...f]];
  }
  const tree = work.scope(
    'hensel',
    () =>
      new NumberFieldHenselTree(factors, prime, defining, residueField, work)
  );
  const result: NumberFieldElement[][] = [];
  let remaining = [...f],
    active = factors.map((_, i) => i);
  let bounds: ReturnType<typeof numberFieldReconstructionBound> | undefined;
  let reconstruct = numberFieldRationalReconstructor(tree.modulus);
  const generatorPowers = [1n],
    variablePowers = [1n];
  const power = (base: bigint, exponent: number, cache: bigint[]): bigint => {
    while (cache.length <= exponent) {
      work.tick();
      cache.push(work.rational.fromInteger(cache.at(-1)! * base).numerator);
    }
    return cache[exponent];
  };
  const makeFilter = () =>
    filterRecovery
      ? numberFieldDivisibilityFilter(field, remaining, work, prime)
      : () => true;
  let plausible = makeFilter();
  const decode = (
    g: ResiduePolynomial,
    certified: boolean
  ): NumberFieldElement[] | undefined =>
    work.scope('reconstruction', () => {
      const degree = g.length - 1;
      const cs: NumberFieldElement[] = [];
      for (let i = 0; i < g.length; i++) {
        if (i === degree) {
          cs.push(field.one);
          continue;
        }
        const row: RationalCoefficient[] = [];
        for (const [j, residue] of g[i].entries()) {
          let c: RationalCoefficient | undefined;
          if (certified) {
            let v = (residue * bounds!.denominator) % tree.modulus;
            if (v > tree.modulus / 2n) v -= tree.modulus;
            c = q(v, bounds!.denominator);
          } else c = reconstruct(residue);
          if (!c) return undefined;
          row.push(
            work.rational.mul(
              c,
              q(
                power(D, j, generatorPowers),
                power(T, degree - i, variablePowers)
              )
            )
          );
        }
        cs.push(field.element(row, work));
      }
      return cs;
    });
  const take = (
    indices: number[],
    candidate: NumberFieldElement[] | undefined
  ): boolean => {
    if (!candidate) return false;
    stats.recoveryCandidates = (stats.recoveryCandidates ?? 0) + 1;
    if (!work.scope('recovery-filter', () => plausible(candidate))) {
      stats.recoveryRejections = (stats.recoveryRejections ?? 0) + 1;
      return false;
    }
    stats.exactDivisions = (stats.exactDivisions ?? 0) + 1;
    const [quotient, remainder] = work.scope('trial-division', () =>
      P.divrem(remaining, candidate)
    );
    if (remainder.length) return false;
    result.push(candidate);
    remaining = quotient;
    plausible = makeFilter();
    active = active.filter((i) => !indices.includes(i));
    return true;
  };
  while (true) {
    stats.precisionBits = tree.modulus.toString(2).length;
    const lifted = tree.factors();
    const done = work.scope('recombination', () => {
      // A recovered single modular atom is irreducible without a size bound.
      for (const i of [...active]) take([i], decode(lifted[i], false));
      if (active.length <= 1) {
        if (active.length) result.push(remaining);
        stats.certificate = 'modular-atoms';
        return true;
      }
      // Cheap exact recovery often finishes before a global bound is needed.
      if (stats.lifts < Math.min(2, maxLifts)) return false;
      bounds ??= numberFieldReconstructionBound(defining, polynomial, work);
      stats.boundBits = bounds.bound.toString(2).length;
      if (bounds.denominator % BigInt(prime) === 0n)
        throw new PolynomialInvariantError(
          'Ramified reconstruction denominator'
        );
      if (
        recombination !== 'subsets' &&
        active.length <= 64 &&
        bounds.logarithmBounds.some((row) =>
          row.some((b) => tree.modulus / b >= 256n)
        )
      ) {
        stats.latticeProbes = (stats.latticeProbes ?? 0) + 1;
        const R = new NumberFieldResidueRing(tree.modulus, defining, work);
        let recovered: NumberFieldElement[][] | undefined;
        const accept = (groups: number[][]): boolean => {
          // One inseparable block certifies the already exact remaining input.
          if (groups.length === 1) {
            recovered = [remaining];
            return true;
          }
          let rest = remaining;
          const candidates: NumberFieldElement[][] = [];
          for (const group of groups) {
            const product = group.reduce(
              (a, i) => R.mul(a, lifted[active[i]]),
              [[1n]]
            );
            const g = decode(product, tree.modulus > 2n * bounds!.bound);
            if (!g || g.length < 2) return false;
            const [quotient, remainder] = P.divrem(rest, g);
            if (remainder.length) return false;
            candidates.push(g);
            rest = quotient;
          }
          if (rest.length !== 1 || !field.equals(rest[0], field.one))
            return false;
          recovered = candidates;
          return true;
        };
        const groups = work.scope('lattice', () =>
          numberFieldLatticePartition(
            defining,
            polynomial,
            active.map((i) => lifted[i]),
            tree.modulus,
            bounds!.denominator,
            bounds!.logarithmBounds,
            work,
            accept,
            (_, rank) => {
              stats.latticeColumns = (stats.latticeColumns ?? 0) + 1;
              stats.latticeRank = rank;
            }
          )
        );
        if (groups && (recovered || accept(groups))) {
          result.push(...recovered!);
          stats.certificate = 'lattice-recombination';
          return true;
        }
      }
      if (recombination === 'lattice') return false;
      if (tree.modulus <= 2n * bounds.bound) return false;
      const R = new NumberFieldResidueRing(tree.modulus, defining, work);
      while (active.length > 1) {
        let found = false;
        // Exhaustion below a proven coefficient bound is the certificate.
        // Taking the first divisor in cardinality order makes it irreducible.
        for (
          let count = 1;
          count <= Math.floor(active.length / 2) && !found;
          count++
        ) {
          const visit = (
            start: number,
            chosen: number[],
            product: ResiduePolynomial
          ): boolean => {
            work.tick();
            if (chosen.length === count) {
              stats.subsets++;
              return take(chosen, decode(product, true));
            }
            for (
              let j = start;
              j <= active.length - (count - chosen.length);
              j++
            ) {
              const index = active[j];
              if (
                visit(j + 1, [...chosen, index], R.mul(product, lifted[index]))
              )
                return true;
            }
            return false;
          };
          found = visit(0, [], [[1n]]);
        }
        if (!found) {
          result.push(remaining);
          active = [];
          break;
        }
      }
      if (active.length) result.push(remaining);
      stats.certificate = 'bounded-recombination';
      return true;
    });
    if (done) return result;
    if (stats.lifts >= maxLifts)
      throw new PolynomialBudgetExceeded('number-field-lift-limit');
    work.scope('hensel', () => tree.lift(polynomial));
    reconstruct = numberFieldRationalReconstructor(tree.modulus);
    stats.lifts++;
  }
}
