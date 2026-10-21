import {
  FieldPolynomials,
  PolynomialBudgetExceeded,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from './exact-field.js';
import { factorRationalPolynomial } from './factor-rational.js';
import {
  RationalNumberField,
  factorNumberFieldPolynomial,
  numberFieldPolynomialNorm,
  shiftPolynomial,
  type NumberFieldElement,
  type NumberFieldFactorOptions,
} from './number-field.js';

export interface SplittingFieldOptions extends NumberFieldFactorOptions {
  maxFieldDegree?: number;
}
export interface NumberFieldEmbedding {
  source: RationalNumberField;
  target: RationalNumberField;
  generatorImage: NumberFieldElement;
}
export interface SplittingFieldResult {
  status: 'complete' | 'incomplete';
  field: RationalNumberField;
  roots: { value: NumberFieldElement; multiplicity: number }[];
  embeddings: NumberFieldEmbedding[];
  reason?: string;
  operations: number;
}

function evaluate<T>(
  f: readonly T[],
  x: T,
  K: { zero: T; add(a: T, b: T): T; mul(a: T, b: T): T }
): T {
  let result = K.zero;
  for (let i = f.length - 1; i >= 0; i--)
    result = K.add(K.mul(result, x), f[i]);
  return result;
}

/** Apply an explicitly checked map between two abstract number fields. */
export function embedNumberFieldElement(
  embedding: NumberFieldEmbedding,
  value: NumberFieldElement,
  work = new PolynomialWork()
): NumberFieldElement {
  if (
    value.field !== embedding.source ||
    embedding.generatorImage.field !== embedding.target
  )
    throw new RangeError('Embedding field mismatch');
  embedding.source.isZero(value);
  const K = embedding.target.withWork(work);
  const modulus = embedding.source.definingPolynomial.map((c) =>
    embedding.target.element([c], work)
  );
  if (!K.isZero(evaluate(modulus, embedding.generatorImage, K)))
    throw new RangeError(
      'Generator image does not satisfy defining polynomial'
    );
  return evaluate(
    value.coefficients.map((c) => embedding.target.element([c], work)),
    embedding.generatorImage,
    K
  );
}

/** Adjoin a root of a certified irreducible polynomial using a primitive element. */
function adjoinRoot(
  field: RationalNumberField,
  polynomial: NumberFieldElement[],
  options: SplittingFieldOptions,
  work: PolynomialWork
): { field: RationalNumberField; embedding: NumberFieldEmbedding } {
  const degree = (polynomial.length - 1) * field.degree;
  if (degree > (options.maxFieldDegree ?? 24))
    throw new PolynomialBudgetExceeded('field-degree-limit');
  const K = field.withWork(work),
    P = new FieldPolynomials(K, work);
  for (let index = 0; index < (options.maxShifts ?? 16); index++) {
    const s = index === 0 ? 0 : index % 2 ? (index + 1) / 2 : -index / 2;
    // beta = root + s*a. A square-free norm of its polynomial is
    // irreducible over Q when the input is irreducible over Q[a].
    const shift = K.mul(K.fromInteger(BigInt(s)), field.generator);
    const norm = numberFieldPolynomialNorm(
      field,
      shiftPolynomial(polynomial, K.neg(shift), P),
      work
    );
    const proof = factorRationalPolynomial(norm, {
      ...options,
      maxOperations: Math.max(0, work.limit - work.operations),
    });
    work.tick(proof.statistics.operations);
    if (proof.status !== 'complete')
      throw new PolynomialBudgetExceeded(`primitive-element-${proof.reason}`);
    if (proof.factors.length !== 1 || proof.factors[0].multiplicity !== 1)
      continue;
    const target = RationalNumberField.create(norm, {
      ...options,
      maxOperations: Math.max(0, work.limit - work.operations),
    });
    work.tick(target.certificationOperations);
    // Recover a as the common root of m(T) and g(beta-s*T). Its GCD
    // is linear precisely when beta generates the full extension.
    const L = target.withWork(work),
      R = new FieldPolynomials(L, work);
    const argument = [target.generator, L.fromInteger(-BigInt(s))];
    let relation: NumberFieldElement[] = [];
    for (let i = polynomial.length - 1; i >= 0; i--) {
      relation = R.add(
        R.mul(relation, argument),
        polynomial[i].coefficients.map((c) => target.element([c], work))
      );
    }
    const gcd = R.gcd(
      field.definingPolynomial.map((c) => target.element([c], work)),
      relation
    );
    if (gcd.length !== 2)
      throw new Error('Primitive element embedding is not linear');
    const image = L.neg(gcd[0]);
    const embedding = { source: field, target, generatorImage: image };
    const root = L.add(
      target.generator,
      L.neg(L.mul(L.fromInteger(BigInt(s)), image))
    );
    const mapped = polynomial.map((c) =>
      embedNumberFieldElement(embedding, c, work)
    );
    if (!L.isZero(evaluate(mapped, root, L)))
      throw new Error('Adjoined root does not satisfy polynomial');
    return { field: target, embedding };
  }
  throw new PolynomialBudgetExceeded('primitive-element-shift-limit');
}

/**
 * Construct the splitting field over Q by adjoining roots of certified
 * irreducible factors. Degree bounds prevent silently constructing an
 * unexpectedly large field. Roots and base-field maps are exact and abstract.
 */
export function splittingField(
  input: readonly RationalCoefficient[],
  options: SplittingFieldOptions = {}
): SplittingFieldResult {
  const work = new PolynomialWork(
    options.maxOperations ?? 10_000_000,
    options.check
  );
  const f = new FieldPolynomials(Q, work).trim(
    input.map((c) => q(c.numerator, c.denominator))
  );
  if (f.length === 0)
    throw new RangeError(
      'The zero polynomial has no finite set of roots to split'
    );
  if (
    !Number.isSafeInteger(options.maxFieldDegree ?? 24) ||
    (options.maxFieldDegree ?? 24) < 1
  )
    throw new RangeError('Invalid field degree limit');
  let field = RationalNumberField.create([Q.zero, Q.one]);
  const result: SplittingFieldResult = {
    status: 'complete',
    field,
    roots: [],
    embeddings: [],
    operations: 0,
  };
  try {
    while (true) {
      work.tick();
      const polynomial = f.map((c) => field.element([c], work));
      const factors = factorNumberFieldPolynomial(field, polynomial, {
        ...options,
        maxOperations: Math.max(0, work.limit - work.operations),
      });
      work.tick(factors.operations);
      if (factors.status !== 'complete')
        throw new PolynomialBudgetExceeded(
          `splitting-factor-${factors.reason}`
        );
      const next = factors.factors.find((g) => g.coefficients.length > 2);
      if (!next) {
        const K = field.withWork(work),
          P = new FieldPolynomials(K, work);
        let reconstructed = [factors.coefficient];
        result.roots = factors.factors.map((g) => ({
          value: K.neg(g.coefficients[0]),
          multiplicity: g.multiplicity,
        }));
        for (const root of result.roots) {
          if (!K.isZero(evaluate(polynomial, root.value, K)))
            throw new Error('Splitting field root verification failed');
          for (let i = 0; i < root.multiplicity; i++)
            reconstructed = P.mul(reconstructed, [K.neg(root.value), K.one]);
        }
        if (P.sub(reconstructed, polynomial).length)
          throw new Error('Splitting field reconstruction failed');
        break;
      }
      const extension = adjoinRoot(field, next.coefficients, options, work);
      result.embeddings.push(extension.embedding);
      field = extension.field;
      result.field = field;
    }
  } catch (e) {
    if (!(e instanceof PolynomialBudgetExceeded)) throw e;
    result.status = 'incomplete';
    result.reason = e.reason;
    result.roots = [];
  }
  result.operations = work.operations;
  return result;
}
