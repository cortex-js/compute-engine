import { PolynomialWork, type RationalCoefficient } from './exact-field.js';
import {
  type NumberFieldElement,
  type RationalNumberField,
} from './number-field.js';

/** An explicitly certified abstract field map, with no numerical root selection. */
export class CertifiedNumberFieldEmbedding {
  private constructor(
    readonly source: RationalNumberField,
    readonly target: RationalNumberField,
    readonly generatorImage: NumberFieldElement,
    private readonly powers: readonly NumberFieldElement[]
  ) {
    Object.freeze(this);
  }

  static create(
    source: RationalNumberField,
    target: RationalNumberField,
    generatorImage: NumberFieldElement,
    options: { maxOperations?: number; check?: () => void } = {}
  ): CertifiedNumberFieldEmbedding {
    target.isZero(generatorImage);
    const work = new PolynomialWork(options.maxOperations, options.check);
    const K = target.withWork(work);
    let value = K.zero;
    for (let i = source.definingPolynomial.length - 1; i >= 0; i--)
      value = K.add(
        K.mul(value, generatorImage),
        target.element([source.definingPolynomial[i]], work)
      );
    if (!K.isZero(value))
      throw new RangeError(
        'Generator image does not satisfy defining polynomial'
      );
    const powers = [K.one];
    for (let i = 1; i < source.degree; i++)
      powers.push(K.mul(powers[i - 1], generatorImage));
    return new CertifiedNumberFieldEmbedding(
      source,
      target,
      generatorImage,
      Object.freeze(powers)
    );
  }

  apply(value: NumberFieldElement): NumberFieldElement {
    this.source.isZero(value);
    return this.evaluate(value.coefficients);
  }

  private evaluate(
    coefficients: readonly RationalCoefficient[]
  ): NumberFieldElement {
    let value = this.target.zero;
    for (let i = 0; i < coefficients.length; i++)
      value = this.target.add(
        value,
        this.target.mul(this.target.element([coefficients[i]]), this.powers[i])
      );
    return value;
  }
}
