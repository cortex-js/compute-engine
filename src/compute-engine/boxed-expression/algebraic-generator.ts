import type { Expression } from '../global-types.js';
import { isFunction, isNumber } from './type-guards.js';
import { asRational } from './numerics.js';
import { bigint } from '../numerics/bigint.js';
import {
  FieldPolynomials,
  rationalCoefficient as q,
  rationalField as Q,
  type RationalCoefficient,
} from '../polynomial/exact-field.js';
import { certifiedGeneratorField } from '../polynomial/boxed-number-field.js';

/**
 * The largest exponent that is reduced. The remainder of t^k divided by the
 * defining polynomial costs about k·n exact operations, and its coefficients
 * grow with k, so a larger power stays as it is.
 */
const MAX_REDUCED_EXPONENT = 128;

/** An exact rational literal, or `undefined`. */
function rational(e: Expression): RationalCoefficient | undefined {
  if (!isNumber(e) || !e.isExact || !e.isRational) return undefined;
  const r = asRational(e);
  if (!r) return undefined;
  const n = bigint(r[0]),
    d = bigint(r[1]);
  return n === null || d === null ? undefined : q(n, d);
}

/**
 * The power α^k of an `AlgebraicGenerator` α, reduced modulo its defining
 * polynomial m when k is an integer with deg m ≤ k ≤ 128.
 *
 * The generator is a root of m, so m(α) = 0, and α^k is the remainder of t^k
 * divided by m(t), evaluated at α: for a root of t² - 2, α² is 2 and α³ is
 * 2α. This holds for every root of m, so the reduction does not choose a
 * root. It is the reduction that the engine does for a radical, where (√2)²
 * is 2, and it is exact in every mode, `.N()` included: the result keeps the
 * generator, which has no numeric value.
 *
 * Only a generator that `AlgebraicGenerator` accepts is reduced: its
 * polynomial must be proved irreducible (`certifiedGeneratorField()`, cached).
 * A malformed or reducible descriptor stays as it is, so that its
 * `invalid-algebraic-generator` error is not folded away (the square of a
 * root of the reducible t² - 1 would otherwise become 1). The reduction uses
 * the monic form of the polynomial of the field, so trailing zero
 * coefficients do not change the degree.
 *
 * Returns `undefined` when the power has another form: the base is not such
 * a generator, or the exponent is not such an integer.
 */
export function reduceAlgebraicGeneratorPower(
  base: Expression,
  exponent: Expression | number
): Expression | undefined {
  if (!isFunction(base, 'AlgebraicGenerator') || base.ops.length !== 1)
    return undefined;
  let k: number;
  if (typeof exponent === 'number') k = exponent;
  else {
    const r = rational(exponent);
    if (!r || r.denominator !== 1n) return undefined;
    k = Number(r.numerator);
  }
  if (!Number.isInteger(k) || k < 1 || k > MAX_REDUCED_EXPONENT)
    return undefined;

  const field = certifiedGeneratorField(base);
  if (!field || k < field.degree) return undefined;
  const m = field.definingPolynomial;

  const P = new FieldPolynomials(Q);
  const power = [...Array<RationalCoefficient>(k).fill(Q.zero), Q.one];
  const remainder = P.divrem(power, m)[1];

  const ce = base.engine;
  return ce.function(
    'Add',
    remainder.flatMap((c, j) => {
      if (c.numerator === 0n) return [];
      const coefficient = ce.number([c.numerator, c.denominator]);
      if (j === 0) return [coefficient];
      const term = j === 1 ? base : ce.function('Power', [base, ce.number(j)]);
      return [ce.function('Multiply', [coefficient, term])];
    })
  );
}
