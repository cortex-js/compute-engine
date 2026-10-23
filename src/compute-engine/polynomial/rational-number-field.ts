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
import { NumberFieldWork } from './number-field-work.js';

export interface NumberFieldElement {
  readonly field: RationalNumberField;
  readonly coefficients: readonly RationalCoefficient[];
}

const certifiedField = Symbol('certified-number-field');

/** An abstract exact field Q[a]/(m), without an assumed real/complex embedding. */
export class RationalNumberField implements ExactField<NumberFieldElement> {
  private readonly elements = new WeakSet<NumberFieldElement>();
  readonly degree: number;
  readonly zero: NumberFieldElement;
  readonly one: NumberFieldElement;
  readonly generator: NumberFieldElement;
  private readonly arithmetic: ExactField<NumberFieldElement>;
  private constructor(
    readonly definingPolynomial: readonly RationalCoefficient[],
    readonly certificationOperations: number,
    certification: symbol
  ) {
    if (certification !== certifiedField)
      throw new RangeError(
        'Use RationalNumberField.create to certify the defining polynomial'
      );
    this.degree = definingPolynomial.length - 1;
    this.zero = Object.freeze({ field: this, coefficients: Object.freeze([]) });
    this.one = Object.freeze({
      field: this,
      coefficients: Object.freeze([Object.freeze(q(1n))]),
    });
    this.elements.add(this.zero);
    this.elements.add(this.one);
    this.arithmetic = this.withWork(
      new PolynomialWork(Number.MAX_SAFE_INTEGER)
    );
    this.generator = this.element([Q.zero, Q.one]);
    Object.freeze(this);
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
      Object.freeze(normalized.map((c) => Object.freeze(c))),
      proof.statistics.operations,
      certifiedField
    );
  }
  element(
    coefficients: readonly RationalCoefficient[],
    work = new PolynomialWork()
  ): NumberFieldElement {
    const p = new FieldPolynomials(
      work instanceof NumberFieldWork ? work.rational : Q,
      work
    ).divrem(
      coefficients.map((c) => q(c.numerator, c.denominator)),
      this.definingPolynomial
    )[1];
    const result = Object.freeze({
      field: this,
      coefficients: Object.freeze(p.map((c) => Object.freeze(c))),
    });
    this.elements.add(result);
    return result;
  }
  /** Share a computation's budget through all coefficient-field arithmetic. */
  withWork(work: PolynomialWork): ExactField<NumberFieldElement> {
    const P = new FieldPolynomials(
      work instanceof NumberFieldWork ? work.rational : Q,
      work
    );
    const check = (a: NumberFieldElement): void => {
      if (a.field !== this || !this.elements.has(a))
        throw new RangeError(
          'Number field elements require an explicit embedding'
        );
    };
    const make = (a: readonly RationalCoefficient[]): NumberFieldElement => {
      const coefficients =
        a.length <= this.degree
          ? P.trim(a)
          : P.divrem(a, this.definingPolynomial)[1];
      if (!coefficients.length) return this.zero;
      if (
        coefficients.length === 1 &&
        coefficients[0].numerator === 1n &&
        coefficients[0].denominator === 1n
      )
        return this.one;
      const result = Object.freeze({
        field: this,
        coefficients: Object.freeze(coefficients.map((c) => Object.freeze(c))),
      });
      this.elements.add(result);
      return result;
    };
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
        if (a.coefficients.length === 1)
          return make(P.scale(b.coefficients, a.coefficients[0]));
        if (b.coefficients.length === 1)
          return make(P.scale(a.coefficients, b.coefficients[0]));
        return make(P.mul(a.coefficients, b.coefficients));
      },
      inv: (a) => {
        check(a);
        if (a.coefficients.length === 1)
          return make([P.field.inv(a.coefficients[0])]);
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
