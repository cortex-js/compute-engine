import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';
import type { Rational } from '../numerics/types.js';
import { isZero } from '../numerics/rationals.js';
import { SMALL_INTEGER } from '../numerics/numeric.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { isNumber } from './type-guards.js';

/**
 * Ensure all expressions in the array are in canonical form
 */
export function canonical(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>,
  scope?: Scope
): ReadonlyArray<Expression> {
  // Avoid memory allocation if possible
  if (xs.every((x) => x.isCanonical)) return xs;

  return xs.map((x) => ce.expr(x, { scope }));
}

/**
 * The exact real component (`rational · √radical`) of a boxed expression that
 * is an exact real number literal, or `null` for anything else (an inexact
 * float, a complex value, NaN, an infinity, a non-number). Used to build exact
 * complex literals from their components.
 */
export function exactRealComponent(
  op: Expression
): { rational: Rational; radical: number } | null {
  if (!isNumber(op)) return null;
  const nv = op.numericValue;
  if (typeof nv === 'number') {
    if (!Number.isInteger(nv)) return null;
    return { rational: [nv, 1], radical: 1 };
  }
  if (nv.im !== 0) return null;
  const exact = nv.asExact;
  if (!(exact instanceof ExactNumericValue)) return null;
  if (exact.isNaN || exact.isPositiveInfinity || exact.isNegativeInfinity)
    return null;
  return { rational: exact.rational, radical: exact.radical };
}

/** The two exact real components of `re + im·i`, when both operands are exact
 * real literals and the imaginary part is not zero; `null` otherwise. */
export function exactComplexParts(
  reOp: Expression,
  imOp: Expression
): {
  re: { rational: Rational; radical: number };
  im: { rational: Rational; radical: number };
} | null {
  const re = exactRealComponent(reOp);
  if (re === null) return null;
  const im = exactRealComponent(imOp);
  if (im === null || isZero(im.rational)) return null;
  return { re, im };
}

/**
 * The EXACT complex literal `re + im·i` built from two exact components, or
 * `null` when one exact literal cannot hold the pair. One literal holds a
 * pure-imaginary value, or two components with the same radical (`√2 + √2·i`);
 * two different radicals (`√2 + √3·i`) do not fit, and a radical past
 * `SMALL_INTEGER` is not reduced. This is what makes
 * `ExactNumericValue.toJSON()` lossless: `['Complex', ['Rational', 1, 2], 3]`
 * re-boxes to the exact `1/2 + 3i`, not a machine float.
 */
export function exactComplexLiteral(
  ce: ComputeEngine,
  parts: NonNullable<ReturnType<typeof exactComplexParts>>,
  options?: Parameters<ComputeEngine['number']>[1]
): Expression | null {
  const { re, im } = parts;
  if (!(isZero(re.rational) || re.radical === im.radical)) return null;
  if (im.radical > SMALL_INTEGER || re.radical > SMALL_INTEGER) return null;
  return ce.number(
    ce._numericValue({
      rational: re.rational,
      radical: re.radical,
      imRational: im.rational,
      imRadical: im.radical,
    }),
    options
  );
}

/**
 * The number literal `coefficient · i` (a pure imaginary number) for a
 * number-literal coefficient.
 *
 * An exact coefficient (an integer of any size, a rational, a radical) gives
 * the EXACT pure-imaginary literal, the same value that `["Complex", 0, c]`
 * boxes to and that `i · c` multiplies to, so that `√(4i)` is `√2(1 + i)` and
 * `(4i)²` is computed exactly. `ce.complex()` builds an INEXACT
 * (floating-point) value, which is what an inexact coefficient (`1.5i`) must
 * remain. A zero coefficient is the real zero.
 */
export function imaginaryNumber(
  ce: ComputeEngine,
  coefficient: Expression,
  options?: Parameters<ComputeEngine['number']>[1]
): Expression {
  const c = exactRealComponent(coefficient);
  if (c !== null) {
    if (isZero(c.rational)) return ce.Zero;
    if (c.radical <= SMALL_INTEGER)
      return ce.number(
        ce._numericValue({
          rational: [0, 1],
          imRational: c.rational,
          imRadical: c.radical,
        }),
        options
      );
  }
  return ce.number(ce.complex(0, coefficient.re ?? NaN), options);
}
