import { MPoly } from '../boxed-expression/multivariate-poly.js';
import {
  FieldPolynomials,
  integerGcd,
  PolynomialBudgetExceeded,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from './exact-field.js';
import {
  factorRationalPolynomial,
  type RationalFactorOptions,
} from './factor-rational.js';

export interface SparseRationalPolynomial {
  variables: readonly string[];
  terms: readonly {
    exponents: readonly number[];
    coefficient: RationalCoefficient;
  }[];
}
export interface SparseRationalFactorization {
  domain: 'QQ';
  status: 'complete' | 'zero' | 'incomplete';
  coefficient: RationalCoefficient;
  factors: { polynomial: SparseRationalPolynomial; multiplicity: number }[];
  reason?: string;
}

function divide(a: MPoly, b: MPoly, work: PolynomialWork): MPoly | null {
  const leading = b.leadingLex()!;
  let remainder = a.clone();
  const quotient = new MPoly(a.vars);
  while (!remainder.isZero()) {
    work.tick(remainder.nbTerms + b.nbTerms);
    const term = remainder.leadingLex()!;
    if (term.c % leading.c || term.exp.some((e, i) => e < leading.exp[i]))
      return null;
    const key = MPoly.key(term.exp.map((e, i) => e - leading.exp[i])),
      coefficient = term.c / leading.c;
    quotient.terms.set(key, (quotient.terms.get(key) ?? 0n) + coefficient);
    const monomial = new MPoly(a.vars, new Map([[key, coefficient]]));
    remainder = remainder.sub(b.mul(monomial));
  }
  return quotient;
}

function* selections(
  counts: number[],
  size: number,
  i = 0,
  prefix: number[] = []
): Generator<number[]> {
  if (i === counts.length) {
    if (size === 0) yield prefix;
    return;
  }
  for (let k = 0; k <= Math.min(size, counts[i]); k++)
    yield* selections(counts, size - k, i + 1, [...prefix, k]);
}

/**
 * Certified Kronecker substitution and exhaustive divisor recombination.
 * This general bounded algorithm prioritizes completeness over sparse scaling;
 * high-dimensional inputs explicitly decline before dense encoding allocation.
 */
export function factorSparseRationalPolynomial(
  input: SparseRationalPolynomial,
  options: RationalFactorOptions = {}
): SparseRationalFactorization {
  if (
    new Set(input.variables).size !== input.variables.length ||
    input.variables.some((v) => !v)
  )
    throw new RangeError('Distinct variable names required');
  const work = new PolynomialWork(
    options.maxOperations ?? 2_000_000,
    options.check
  );
  const result: SparseRationalFactorization = {
    domain: 'QQ',
    status: 'complete',
    coefficient: Q.one,
    factors: [],
  };
  try {
    const terms = new Map<string, RationalCoefficient>();
    for (const t of input.terms) {
      work.tick();
      if (
        t.exponents.length !== input.variables.length ||
        t.exponents.some((e) => !Number.isSafeInteger(e) || e < 0)
      )
        throw new RangeError('Invalid monomial exponents');
      const key = MPoly.key([...t.exponents]);
      terms.set(
        key,
        Q.add(
          terms.get(key) ?? Q.zero,
          q(t.coefficient.numerator, t.coefficient.denominator)
        )
      );
    }
    let denominator = 1n;
    for (const c of terms.values())
      denominator =
        (denominator / integerGcd(denominator, c.denominator)) * c.denominator;
    const polynomial = new MPoly([...input.variables]);
    for (const [key, c] of terms)
      if (c.numerator)
        polynomial.terms.set(key, c.numerator * (denominator / c.denominator));
    if (polynomial.isZero())
      return { ...result, status: 'zero', coefficient: Q.zero };
    let content = polynomial.contentInteger();
    if (polynomial.leadingLex()!.c < 0n) content = -content;
    result.coefficient = q(content, denominator);
    let remaining = polynomial.divExactInteger(content);
    const bases = input.variables.map((_, i) => polynomial.degreeIn(i) + 1);
    const strides: number[] = [];
    let size = 1;
    for (const b of bases) {
      strides.push(size);
      size *= b;
      if (!Number.isSafeInteger(size) || size - 1 > (options.maxDegree ?? 128))
        throw new PolynomialBudgetExceeded('kronecker-degree-limit');
    }
    const coefficients = Array<bigint>(size).fill(0n);
    for (const [key, c] of remaining.terms)
      coefficients[MPoly.exp(key).reduce((s, e, i) => s + e * strides[i], 0)] =
        c;
    const encoded = factorRationalPolynomial(
      coefficients.map((c) => q(c)),
      { ...options, maxOperations: work.limit - work.operations }
    );
    work.tick(encoded.statistics.operations);
    if (encoded.status === 'incomplete')
      throw new PolynomialBudgetExceeded(encoded.reason!);
    const counts = encoded.factors.map((f) => f.multiplicity);
    const P = new FieldPolynomials(Q, work);
    const decode = (a: readonly RationalCoefficient[]): MPoly => {
      const f = new MPoly([...input.variables]);
      for (let j = 0; j < a.length; j++) {
        if (!a[j].numerator) continue;
        if (a[j].denominator !== 1n)
          throw new Error('Nonintegral Kronecker factor');
        let index = j;
        const exponents = bases.map((b) => {
          const e = index % b;
          index = Math.floor(index / b);
          return e;
        });
        if (index) throw new Error('Kronecker factor exceeds degree bounds');
        f.terms.set(MPoly.key(exponents), a[j].numerator);
      }
      return f.primitivePartInteger();
    };
    const found: MPoly[] = [];
    for (let k = 1; 2 * k <= counts.reduce((a, b) => a + b, 0);) {
      let accepted = false;
      for (const selection of selections(counts, k)) {
        work.tick();
        let candidate = [Q.one];
        for (let i = 0; i < counts.length; i++)
          for (let j = 0; j < selection[i]; j++)
            candidate = P.mul(
              candidate,
              encoded.factors[i].coefficients.map((c) => q(c))
            );
        const f = decode(candidate),
          quotient = divide(remaining, f, work);
        if (!quotient) continue;
        found.push(f);
        remaining = quotient;
        for (let i = 0; i < counts.length; i++) counts[i] -= selection[i];
        accepted = true;
        k = 1;
        break;
      }
      if (!accepted) k++;
    }
    const constant = remaining.asConstant();
    if (constant !== undefined)
      result.coefficient = Q.mul(result.coefficient, q(constant));
    else found.push(remaining.primitivePartInteger());
    // Preserve any sign remaining after primitive normalization.
    if (constant === undefined && remaining.leadingLex()!.c < 0n)
      result.coefficient = Q.neg(result.coefficient);
    const unique: { f: MPoly; multiplicity: number }[] = [];
    for (const f of found) {
      const previous = unique.find((g) => g.f.equals(f));
      if (previous) previous.multiplicity++;
      else unique.push({ f, multiplicity: 1 });
    }
    result.factors = unique.map(({ f, multiplicity }) => ({
      multiplicity,
      polynomial: {
        variables: [...input.variables],
        terms: [...f.terms].map(([key, c]) => ({
          exponents: MPoly.exp(key),
          coefficient: q(c),
        })),
      },
    }));
    let reconstructed = MPoly.constant([...input.variables], 1n);
    for (const { f, multiplicity } of unique)
      for (let i = 0; i < multiplicity; i++) {
        work.tick(reconstructed.nbTerms * f.nbTerms);
        reconstructed = reconstructed.mul(f);
      }
    if (
      !reconstructed
        .scaleInt(result.coefficient.numerator * denominator)
        .equals(polynomial.scaleInt(result.coefficient.denominator))
    )
      throw new Error('Multivariate reconstruction failed');
  } catch (e) {
    if (!(e instanceof PolynomialBudgetExceeded)) throw e;
    return {
      domain: 'QQ',
      status: 'incomplete',
      coefficient: Q.one,
      factors: [],
      reason: e.reason,
    };
  }
  return result;
}
