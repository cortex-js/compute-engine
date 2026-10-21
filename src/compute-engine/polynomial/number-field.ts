import {
  FieldPolynomials,
  PolynomialBudgetExceeded,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type ExactField,
  type RationalCoefficient,
} from './exact-field.js';
import {
  factorRationalPolynomial,
  type RationalFactorOptions,
} from './factor-rational.js';

export interface NumberFieldElement {
  readonly field: RationalNumberField;
  readonly coefficients: readonly RationalCoefficient[];
}

/** An abstract exact field Q[a]/(m), without an assumed real/complex embedding. */
export class RationalNumberField implements ExactField<NumberFieldElement> {
  readonly degree: number;
  readonly zero: NumberFieldElement;
  readonly one: NumberFieldElement;
  readonly generator: NumberFieldElement;
  private readonly arithmetic: ExactField<NumberFieldElement>;
  private constructor(
    readonly definingPolynomial: readonly RationalCoefficient[]
  ) {
    this.degree = definingPolynomial.length - 1;
    this.zero = Object.freeze({ field: this, coefficients: Object.freeze([]) });
    this.one = Object.freeze({
      field: this,
      coefficients: Object.freeze([Q.one]),
    });
    this.arithmetic = this.withWork(
      new PolynomialWork(Number.MAX_SAFE_INTEGER)
    );
    this.generator = this.element([Q.zero, Q.one]);
  }
  static create(
    polynomial: readonly RationalCoefficient[],
    options: RationalFactorOptions = {}
  ): RationalNumberField {
    const normalized = new FieldPolynomials(Q).monic(
      polynomial.map((c) => q(c.numerator, c.denominator))
    );
    if (normalized.length < 2)
      throw new RangeError(
        'Number field requires a nonconstant defining polynomial'
      );
    const proof = factorRationalPolynomial(normalized, options);
    if (proof.status !== 'complete')
      throw new PolynomialBudgetExceeded(`field-certification-${proof.reason}`);
    if (proof.factors.length !== 1 || proof.factors[0].multiplicity !== 1)
      throw new RangeError(
        'Number field defining polynomial must be irreducible'
      );
    return new RationalNumberField(
      Object.freeze(normalized.map((c) => Object.freeze(c)))
    );
  }
  element(coefficients: readonly RationalCoefficient[]): NumberFieldElement {
    const p = new FieldPolynomials(Q).divrem(
      coefficients.map((c) => q(c.numerator, c.denominator)),
      this.definingPolynomial
    )[1];
    return Object.freeze({
      field: this,
      coefficients: Object.freeze(p.map((c) => Object.freeze(c))),
    });
  }
  /** Share a computation's budget through all coefficient-field arithmetic. */
  withWork(work: PolynomialWork): ExactField<NumberFieldElement> {
    const P = new FieldPolynomials(Q, work);
    const check = (a: NumberFieldElement): void => {
      if (a.field !== this)
        throw new RangeError(
          'Number field elements require an explicit embedding'
        );
    };
    const make = (a: readonly RationalCoefficient[]): NumberFieldElement =>
      Object.freeze({
        field: this,
        coefficients: Object.freeze(
          P.divrem(a, this.definingPolynomial)[1].map((c) => Object.freeze(c))
        ),
      });
    return {
      zero: this.zero,
      one: this.one,
      add: (a, b) => {
        check(a);
        check(b);
        return make(P.add(a.coefficients, b.coefficients));
      },
      neg: (a) => {
        check(a);
        return make(P.scale(a.coefficients, q(-1n)));
      },
      mul: (a, b) => {
        check(a);
        check(b);
        return make(P.mul(a.coefficients, b.coefficients));
      },
      inv: (a) => {
        check(a);
        return make(P.inverseMod(a.coefficients, this.definingPolynomial));
      },
      isZero: (a) => {
        check(a);
        return !a.coefficients.length;
      },
      fromInteger: (a) => make([q(a)]),
    };
  }
  add(a: NumberFieldElement, b: NumberFieldElement): NumberFieldElement {
    return this.arithmetic.add(a, b);
  }
  neg(a: NumberFieldElement): NumberFieldElement {
    return this.arithmetic.neg(a);
  }
  mul(a: NumberFieldElement, b: NumberFieldElement): NumberFieldElement {
    return this.arithmetic.mul(a, b);
  }
  inv(a: NumberFieldElement): NumberFieldElement {
    return this.arithmetic.inv(a);
  }
  isZero(a: NumberFieldElement): boolean {
    return this.arithmetic.isZero(a);
  }
  fromInteger(a: bigint): NumberFieldElement {
    return this.arithmetic.fromInteger(a);
  }
  equals(a: NumberFieldElement, b: NumberFieldElement): boolean {
    return this.isZero(this.add(a, this.neg(b)));
  }
}

export interface NumberFieldFactorOptions extends RationalFactorOptions {
  maxNormDegree?: number;
  maxShifts?: number;
}
export interface NumberFieldFactorization {
  status: 'complete' | 'zero' | 'incomplete';
  field: RationalNumberField;
  coefficient: NumberFieldElement;
  factors: { coefficients: NumberFieldElement[]; multiplicity: number }[];
  reason?: string;
  operations: number;
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
  work = new PolynomialWork()
): RationalCoefficient[] {
  const K = field.withWork(work),
    P = new FieldPolynomials(Q, work),
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

/** Trager factorization over an explicitly certified abstract number field. */
export function factorNumberFieldPolynomial(
  field: RationalNumberField,
  input: readonly NumberFieldElement[],
  options: NumberFieldFactorOptions = {}
): NumberFieldFactorization {
  const work = new PolynomialWork(
    options.maxOperations ?? 5_000_000,
    options.check
  );
  const K = field.withWork(work),
    P = new FieldPolynomials(K, work);
  const result: NumberFieldFactorization = {
    status: 'complete',
    field,
    coefficient: K.one,
    factors: [],
    operations: 0,
  };
  try {
    for (const c of input) K.isZero(c);
    const f = P.trim(input);
    if (!f.length) return { ...result, status: 'zero', coefficient: K.zero };
    if ((f.length - 1) * field.degree > (options.maxNormDegree ?? 128))
      throw new PolynomialBudgetExceeded('norm-degree-limit');
    result.coefficient = f[f.length - 1];
    for (const part of P.squareFree(f)) {
      if (part.polynomial.length === 2) {
        result.factors.push({
          coefficients: part.polynomial,
          multiplicity: part.multiplicity,
        });
        continue;
      }
      let finished = false;
      for (let index = 0; index < (options.maxShifts ?? 16); index++) {
        const s = index === 0 ? 0 : index % 2 ? (index + 1) / 2 : -index / 2;
        const shift = K.mul(K.fromInteger(BigInt(s)), field.generator);
        const shifted = shiftPolynomial(part.polynomial, K.neg(shift), P);
        const norm = numberFieldPolynomialNorm(field, shifted, work);
        const rationalFactors = factorRationalPolynomial(norm, {
          ...options,
          maxOperations: Math.max(0, work.limit - work.operations),
        });
        work.tick(rationalFactors.statistics.operations);
        if (rationalFactors.status !== 'complete')
          throw new PolynomialBudgetExceeded(`norm-${rationalFactors.reason}`);
        if (rationalFactors.factors.some((g) => g.multiplicity !== 1)) continue;
        const factors: NumberFieldElement[][] = [];
        for (const g of rationalFactors.factors) {
          const d = P.gcd(shifted, g.coefficients.map(K.fromInteger));
          if (d.length > 1) factors.push(shiftPolynomial(d, shift, P));
        }
        const product = factors.reduce((a, b) => P.mul(a, b), [K.one]);
        if (P.sub(product, part.polynomial).length)
          throw new Error('Number field factor reconstruction failed');
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
    let reconstructed = [result.coefficient];
    for (const g of result.factors)
      for (let i = 0; i < g.multiplicity; i++)
        reconstructed = P.mul(reconstructed, g.coefficients);
    if (P.sub(reconstructed, f).length)
      throw new Error('Number field multiplicity reconstruction failed');
  } catch (e) {
    if (!(e instanceof PolynomialBudgetExceeded)) throw e;
    result.status = 'incomplete';
    result.reason = e.reason;
    result.factors = [];
    result.coefficient = field.one;
  }
  result.operations = work.operations;
  return result;
}
