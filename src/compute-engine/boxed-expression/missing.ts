import type { MathJsonSymbol } from '../../math-json/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';

/**
 * The operators handled by `makeNumericFunction`'s short path in `box.ts`
 * (they bypass the definition lookup and go straight to their `canonicalXxx`
 * builder). Several of them (`Add`, `Negate`) carry a `value`-typed signature
 * rather than a `number`-typed one, so `allParamsNumeric()` does not
 * recognize them: they are enumerated here instead.
 */
export const NUMERIC_SHORTCUT_OPERATORS = new Set<MathJsonSymbol>([
  'Add',
  'Multiply',
  'Negate',
  'Square',
  'Sqrt',
  'Exp',
  'Ln',
  'Log',
  'Power',
  'Root',
  'Divide',
]);

/**
 * The DATA-CONSUMING aggregates (`Max`, `Mean`, …) through which `Missing`
 * propagates. They cannot be recognized by `allParamsNumeric()`: their
 * signatures are deliberately wide (`(value*)`, `((collection|number)+)`) so
 * they accept a collection operand, and `missing` is a unit type that is not a
 * subtype of `value`/`number` — so a `Missing` operand would otherwise be
 * rejected with an `incompatible-type` error instead of propagating.
 *
 * A COLLECTION operand containing `Missing` is not covered here (the operand
 * is a `List`, not the `Missing` symbol): each handler re-checks its flattened
 * data with `missingDatum()` from `library/missing-data.ts`. This set covers
 * the variadic-SCALAR call shape, `Max(1, Missing, 3)`.
 *
 * Keep in sync with the handlers that call `missingDatum()`.
 */
export const MISSING_PROPAGATING_AGGREGATES = new Set<MathJsonSymbol>([
  // library/arithmetic.ts (`evaluateMinMax`)
  'Max',
  'Min',
  'Supremum',
  'Infimum',
  // library/statistics.ts
  'Mean',
  'Median',
  'Variance',
  'PopulationVariance',
  'StandardDeviation',
  'PopulationStandardDeviation',
  'Kurtosis',
  'Skewness',
  'Mode',
  'Quartiles',
  'InterquartileRange',
]);

/**
 * True when every declared parameter of a signature (required, optional and
 * variadic) is a numeric type (a subtype of `number`). Used to restrict the
 * post-canonical argument re-validation in `makeCanonicalFunction` to the
 * pure-numeric operators (`Sin`, `Factorial`, …) whose custom canonical
 * handlers historically only checked arity — and, in `propagatesMissing()`,
 * to select the operators through which `Missing` propagates. A signature with
 * no parameters, or any non-numeric parameter, returns `false` so
 * structural/higher-order operators are left untouched.
 */
export function allParamsNumeric(signature: Type): boolean {
  if (typeof signature === 'string') return false;
  if (signature.kind !== 'signature') return false;
  const params: Type[] = [
    ...(signature.args?.map((x) => x.type) ?? []),
    ...(signature.optArgs?.map((x) => x.type) ?? []),
    ...(signature.variadicArg ? [signature.variadicArg.type] : []),
  ];
  if (params.length === 0) return false;
  return params.every((t) => isSubtype(t, 'number'));
}

/**
 * True when `Missing` (a position-preserving absent value) PROPAGATES through
 * this operator, i.e. an application with a `Missing` operand is itself
 * `Missing`: `Missing + 1` is `Missing`, `Sin(Missing)` is `Missing`.
 *
 * Only pure-numeric operators and the data-consuming aggregates
 * (`MISSING_PROPAGATING_AGGREGATES`) propagate. Structural/higher-order
 * operators — `List`, `At`, `Equal`, the big-op containers — keep `Missing` as
 * an ordinary operand, which is what makes `[1, Missing, 3]` a 3-element list.
 *
 * Callers MUST check for a `Missing` operand FIRST: this predicate walks the
 * signature and allocates, and sits on the canonicalization/evaluation hot
 * path.
 */
export function propagatesMissing(
  name: MathJsonSymbol,
  signature: Type,
  inferredSignature: boolean
): boolean {
  if (NUMERIC_SHORTCUT_OPERATORS.has(name)) return true;
  if (MISSING_PROPAGATING_AGGREGATES.has(name)) return true;
  if (inferredSignature) return false;
  return allParamsNumeric(signature);
}
