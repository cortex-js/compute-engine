import {
  FieldPolynomials,
  PolynomialBudgetExceeded,
  PolynomialInvariantError,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from './exact-field.js';
import {
  factorRationalPolynomial,
  type RationalFactorOptions,
} from './factor-rational.js';
import {
  NumberFieldWork,
  type NumberFieldProfile,
} from './number-field-work.js';
import { modularNumberFieldGcd } from './number-field-modular.js';
import { modularPolynomialDeterminant } from './modular-polynomial-determinant.js';
import {
  factorNumberFieldDirect,
  type DirectNumberFieldStatistics,
} from './number-field-direct.js';

import {
  RationalNumberField,
  type NumberFieldElement,
} from './rational-number-field.js';

export { RationalNumberField, type NumberFieldElement };

/**
 * The limits that stop the direct (inert-prime Hensel) method but leave the
 * Trager norm method worth trying: see `factorNumberFieldPolynomial()`.
 */
const DIRECT_ONLY_LIMITS = new Set([
  'intermediate-coefficient-limit',
  'number-field-lift-limit',
  'finite-extension-dimension-limit',
]);

/** Inherited lifting/recombination overrides configure the rational norm engine. */
export interface NumberFieldFactorOptions extends RationalFactorOptions {
  /** Direct unramified prime-ideal lifting with Trager fallback by default. */
  numberFieldStrategy?: 'auto' | 'trager' | 'hensel';
  /** Direct recombination strategy; separate from rational norm recombination. */
  numberFieldRecombination?: 'auto' | 'subsets' | 'lattice';
  /** Disable the one-sided modular recovery filter for matched diagnostics. */
  numberFieldRecovery?: 'auto' | 'unfiltered';
  /** Bounded prime search, preferring an inert prime; default 24. */
  maxNumberFieldPrimes?: number;
  /** Maximum precision doublings in the direct path; default 12. */
  maxNumberFieldLifts?: number;
  /** Maximum degree of a norm actually computed; default 128. */
  maxNormDegree?: number;
  /** Maximum separating shifts per square-free component; default 16. */
  maxShifts?: number;
  /** Bit limit during rational extension arithmetic; default 16384. */
  maxIntermediateCoefficientBits?: number;
  /** Modular GCD reconstruction with a bounded Euclidean fallback by default. */
  gcdStrategy?: 'auto' | 'euclidean';
  /** Norm determinant strategy, retained for matched diagnostics. */
  normStrategy?: 'auto' | 'bareiss' | 'modular';
}
export interface NumberFieldFactorization {
  domain: 'NumberField';
  status: 'complete' | 'zero' | 'incomplete';
  field: RationalNumberField;
  coefficient: NumberFieldElement;
  factors: { coefficients: NumberFieldElement[]; multiplicity: number }[];
  reason?: string;
  operations: number;
  remainder?: NumberFieldElement[];
  statistics: {
    shifts: number;
    norms: number;
    rationalFactorizations: number;
    direct: DirectNumberFieldStatistics[];
    phases?: NumberFieldProfile;
  };
}

function validateOptions(options: NumberFieldFactorOptions): void {
  if (!['auto', 'unfiltered'].includes(options.numberFieldRecovery ?? 'auto'))
    throw new RangeError('Invalid number field recovery strategy');
  for (const [name, value, minimum] of [
    ['maxOperations', options.maxOperations ?? 5_000_000, 0],
    ['maxDegree', options.maxDegree ?? 128, 0],
    ['maxNormDegree', options.maxNormDegree ?? 128, 0],
    ['maxShifts', options.maxShifts ?? 16, 0],
    ['maxNumberFieldPrimes', options.maxNumberFieldPrimes ?? 24, 0],
    ['maxNumberFieldLifts', options.maxNumberFieldLifts ?? 12, 0],
    ['maxCoefficientBits', options.maxCoefficientBits ?? 4096, 1],
    [
      'maxIntermediateCoefficientBits',
      options.maxIntermediateCoefficientBits ?? 16384,
      1,
    ],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum)
      throw new RangeError(`Invalid ${name}`);
  }
  if (
    !['auto', 'linear', 'quadratic'].includes(options.lifting ?? 'auto') ||
    !['auto', 'subsets', 'lattice'].includes(options.recombination ?? 'auto')
  )
    throw new RangeError('Invalid factorization strategy');
  if (!['auto', 'euclidean'].includes(options.gcdStrategy ?? 'auto'))
    throw new RangeError('Invalid GCD strategy');
  if (
    !['auto', 'subsets', 'lattice'].includes(
      options.numberFieldRecombination ?? 'auto'
    )
  )
    throw new RangeError('Invalid number field recombination strategy');
  if (!['auto', 'bareiss', 'modular'].includes(options.normStrategy ?? 'auto'))
    throw new RangeError('Invalid norm strategy');
  if (
    !['auto', 'trager', 'hensel'].includes(
      options.numberFieldStrategy ?? 'auto'
    )
  )
    throw new RangeError('Invalid number field strategy');
}

class CallerException extends Error {
  constructor(readonly original: unknown) {
    super('Factorization callback failed');
  }
}

export function shiftPolynomial<T>(
  f: readonly T[],
  c: T,
  P: FieldPolynomials<T>
): T[] {
  let result: T[] = [];
  for (let i = f.length - 1; i >= 0; i--)
    result = P.add(P.mul(result, [c, P.field.one]), [f[i]]);
  return result;
}

/** Norm as the determinant of multiplication by f on the power basis. */
export function numberFieldPolynomialNorm(
  field: RationalNumberField,
  f: readonly NumberFieldElement[],
  work = new PolynomialWork(),
  strategy: 'auto' | 'bareiss' | 'modular' = 'auto'
): RationalCoefficient[] {
  const K = field.withWork(work),
    P = new FieldPolynomials(
      work instanceof NumberFieldWork ? work.rational : Q,
      work
    ),
    n = field.degree;
  const matrix: RationalCoefficient[][][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => [])
  );
  let basis = K.one;
  for (let j = 0; j < n; j++) {
    const products = f.map((c) => K.mul(c, basis));
    for (let i = 0; i < n; i++)
      matrix[i][j] = P.trim(products.map((c) => c.coefficients[i] ?? Q.zero));
    basis = K.mul(basis, field.generator);
  }
  if (strategy === 'modular' || (strategy === 'auto' && n >= 4))
    return modularPolynomialDeterminant(matrix, work);
  let previous = [Q.one],
    negative = false;
  for (let k = 0; k < n - 1; k++) {
    let pivotRow = k;
    while (pivotRow < n && matrix[pivotRow][k].length === 0) pivotRow++;
    if (pivotRow === n) return [];
    if (pivotRow !== k) {
      [matrix[k], matrix[pivotRow]] = [matrix[pivotRow], matrix[k]];
      negative = !negative;
    }
    const pivot = matrix[k][k];
    for (let i = k + 1; i < n; i++)
      for (let j = k + 1; j < n; j++) {
        matrix[i][j] = P.exactDivide(
          P.sub(P.mul(pivot, matrix[i][j]), P.mul(matrix[i][k], matrix[k][j])),
          previous
        );
      }
    for (let i = k + 1; i < n; i++) matrix[i][k] = [];
    previous = pivot;
  }
  return negative
    ? P.scale(matrix[n - 1][n - 1], q(-1n))
    : matrix[n - 1][n - 1];
}

/** Certified direct or norm-based factoring in an explicitly specified field. */
export function factorNumberFieldPolynomial(
  field: RationalNumberField,
  input: readonly NumberFieldElement[],
  options: NumberFieldFactorOptions = {}
): NumberFieldFactorization {
  validateOptions(options);
  const check = options.check
    ? () => {
        try {
          options.check!();
        } catch (e) {
          throw new CallerException(e);
        }
      }
    : undefined;
  const work = new NumberFieldWork(
    options.maxOperations ?? 5_000_000,
    check,
    options.profile ?? false,
    options.maxIntermediateCoefficientBits ?? 16384
  );
  const K = field.withWork(work),
    P = new (class extends FieldPolynomials<NumberFieldElement> {
      override gcd(
        a: readonly NumberFieldElement[],
        b: readonly NumberFieldElement[]
      ): NumberFieldElement[] {
        const x = this.trim(a),
          y = this.trim(b);
        if (
          options.gcdStrategy !== 'euclidean' &&
          x.length > 1 &&
          y.length > 1
        ) {
          const g = work.scope('modular', () =>
            modularNumberFieldGcd(field, x, y, this, work)
          );
          if (g) return g;
        }
        return super.gcd(x, y);
      }
    })(K, work);
  const result: NumberFieldFactorization = {
    domain: 'NumberField',
    status: 'complete',
    field,
    coefficient: K.one,
    factors: [],
    operations: 0,
    statistics: {
      shifts: 0,
      norms: 0,
      rationalFactorizations: 0,
      direct: [],
      phases: work.phases,
    },
  };
  // Validate field ownership before resource handling: malformed input is not
  // a computation that merely ran out of time or arithmetic budget.
  for (const c of input) field.isZero(c);
  const f = P.trim(input);
  try {
    work.tick(0);
    const bits = options.maxCoefficientBits ?? 4096;
    for (const c of [
      ...field.definingPolynomial,
      ...f.flatMap((c) => c.coefficients),
    ])
      if (
        (c.numerator < 0n ? -c.numerator : c.numerator).toString(2).length >
          bits ||
        c.denominator.toString(2).length > bits
      )
        throw new PolynomialBudgetExceeded('coefficient-limit');
    if (!f.length) {
      result.status = 'zero';
      result.coefficient = K.zero;
      return result;
    }
    if (f.length - 1 > (options.maxDegree ?? 128))
      throw new PolynomialBudgetExceeded('degree-limit');
    result.coefficient = f[f.length - 1];
    for (const part of P.squareFree(f)) {
      if (part.polynomial.length === 2) {
        result.factors.push({
          coefficients: part.polynomial,
          multiplicity: part.multiplicity,
        });
        continue;
      }
      if (options.numberFieldStrategy !== 'trager') {
        const stats: DirectNumberFieldStatistics = {
          primeAttempts: 0,
          modularFactors: 0,
          lifts: 0,
          subsets: 0,
          precisionBits: 0,
        };
        result.statistics.direct.push(stats);
        let direct: NumberFieldElement[][] | undefined;
        try {
          direct = factorNumberFieldDirect(
            field,
            part.polynomial,
            P,
            work,
            stats,
            options.maxNumberFieldPrimes ?? 24,
            options.maxNumberFieldLifts ?? 12,
            options.numberFieldRecombination ?? 'auto',
            options.numberFieldRecovery !== 'unfiltered'
          );
        } catch (e) {
          // A limit of the direct method alone (its reconstruction bound
          // exceeds the coefficient size limit, too many lifts, a finite
          // extension too large) does not stop the Trager route, which works
          // with other numbers. The operation limit is shared, so it stops
          // both: it is rethrown, like any other error.
          if (
            options.numberFieldStrategy === 'hensel' ||
            !(e instanceof PolynomialBudgetExceeded) ||
            !DIRECT_ONLY_LIMITS.has(e.reason)
          )
            throw e;
          stats.fallback = e.reason;
        }
        if (direct) {
          result.factors.push(
            ...direct.map((coefficients) => ({
              coefficients,
              multiplicity: part.multiplicity,
            }))
          );
          continue;
        }
        if (options.numberFieldStrategy === 'hensel')
          throw new PolynomialBudgetExceeded(
            stats.fallback ?? 'direct-factorization-unavailable'
          );
      }
      let finished = false;
      if (
        (part.polynomial.length - 1) * field.degree >
        (options.maxNormDegree ?? 128)
      )
        throw new PolynomialBudgetExceeded('norm-degree-limit');
      // For rational coefficients the unshifted norm is F^d, hence never
      // square-free when d>1. Spend the shift budget on separating shifts.
      const skipZero =
        field.degree > 1 &&
        part.polynomial.every((c) => c.coefficients.length <= 1);
      for (let index = 0; index < (options.maxShifts ?? 16); index++) {
        work.phase('norm');
        result.statistics.shifts++;
        const shiftIndex = index + (skipZero ? 1 : 0);
        const s =
          shiftIndex === 0
            ? 0
            : shiftIndex % 2
              ? (shiftIndex + 1) / 2
              : -shiftIndex / 2;
        const shift = K.mul(K.fromInteger(BigInt(s)), field.generator);
        const shifted = shiftPolynomial(part.polynomial, K.neg(shift), P);
        const norm = numberFieldPolynomialNorm(
          field,
          shifted,
          work,
          options.normStrategy
        );
        result.statistics.norms++;
        work.phase('rational-factorization');
        result.statistics.rationalFactorizations++;
        const rationalFactors = factorRationalPolynomial(norm, {
          ...options,
          check,
          maxDegree: options.maxNormDegree ?? 128,
          profile: false,
          maxOperations: Math.max(0, work.limit - work.operations),
        });
        work.tick(rationalFactors.statistics.operations);
        if (rationalFactors.status !== 'complete')
          throw new PolynomialBudgetExceeded(`norm-${rationalFactors.reason}`);
        if (rationalFactors.factors.some((g) => g.multiplicity !== 1)) continue;
        work.phase('recovery');
        const factors: NumberFieldElement[][] = [];
        for (const g of rationalFactors.factors) {
          const d = P.gcd(shifted, g.coefficients.map(K.fromInteger));
          if (d.length > 1) factors.push(shiftPolynomial(d, shift, P));
        }
        const product = factors.reduce((a, b) => P.mul(a, b), [K.one]);
        if (P.sub(product, part.polynomial).length)
          throw new PolynomialInvariantError(
            'Number field factor reconstruction failed'
          );
        result.factors.push(
          ...factors.map((coefficients) => ({
            coefficients,
            multiplicity: part.multiplicity,
          }))
        );
        finished = true;
        break;
      }
      if (!finished) throw new PolynomialBudgetExceeded('shift-limit');
    }
    work.phase('verification');
    let reconstructed = [result.coefficient];
    for (const g of result.factors)
      for (let i = 0; i < g.multiplicity; i++)
        reconstructed = P.mul(reconstructed, g.coefficients);
    if (P.sub(reconstructed, f).length)
      throw new PolynomialInvariantError(
        'Number field multiplicity reconstruction failed'
      );
  } catch (e) {
    if (e instanceof CallerException) throw e.original;
    if (
      !(e instanceof PolynomialBudgetExceeded) &&
      !(e instanceof PolynomialInvariantError)
    )
      throw e;
    result.status = 'incomplete';
    result.reason =
      e instanceof PolynomialBudgetExceeded ? e.reason : 'verification-failed';
    result.factors = [];
    result.coefficient = field.one;
    result.remainder = f;
  } finally {
    work.phase('verification');
    result.operations = work.operations;
  }
  return result;
}
