import type { BoxedType } from '../../common/type/boxed-type.js';

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

/**
 * Raised when a value cannot be installed under a symbol's DECLARED type:
 * either the value's type does not fit the declaration (per-axis, see
 * `matchesDeclaredTypeAxes`), or the symbol is a minted type constructor,
 * which no value may clobber (nominal-types design, D5).
 *
 * The `ce.assign` / `ce.declare` HOST routes let this throw, matching every
 * other registration-time conflict. The `Assign` / `Declare` OPERATOR routes
 * turn it into an `incompatible-type` error VALUE — the errors-are-values
 * posture programs rely on — through {@link typeCompatibilityErrorValue}. This
 * is the same throw/value split the effect-contract check makes with
 * `EffectContractError` (`effects-inference.ts`).
 */
export class TypeCompatibilityError extends Error {
  /** Identifies the class by STRING, not `instanceof`: a plugin bundle
   * re-bundles the engine, so a cross-bundle `instanceof` check fails (see the
   * cross-bundle identity hazard in CLAUDE.md). */
  readonly name = 'TypeCompatibilityError';

  constructor(
    readonly symbol: string,
    /** The type the symbol is declared with — for a minted constructor, the
     * constructor's own signature. */
    readonly declaredType: BoxedType,
    /** The type of the offending value, when one was boxed. */
    readonly valueType: BoxedType | undefined,
    /** `'constructor'` for the minted-constructor guard, `'value'` for a
     * declared-type mismatch, `'generic-overload-literal'` for G11. */
    readonly kind: 'value' | 'constructor' | 'generic-overload-literal',
    message: string
  ) {
    super(message);
  }
}

/** True when `e` is a {@link TypeCompatibilityError}, checked by name so the
 * test survives a host/plugin bundle boundary. */
export function isTypeCompatibilityError(
  e: unknown
): e is TypeCompatibilityError {
  return (
    e instanceof Error &&
    (e as Error).name === 'TypeCompatibilityError' &&
    'declaredType' in e
  );
}

/**
 * The declared-type mismatch, with the message every host route has always
 * thrown (`Symbol "x"\n|   The value …`).
 */
export function declaredTypeError(
  symbol: string,
  value: { toString(): string; type: BoxedType },
  declaredType: BoxedType
): TypeCompatibilityError {
  return new TypeCompatibilityError(
    symbol,
    declaredType,
    value.type,
    'value',
    [
      `Symbol "${symbol}"`,
      `The value "${value.toString()}" of type "${value.type}" is not compatible with the type "${declaredType}"`,
    ].join('\n|   ')
  );
}

/**
 * G11 (§2.4 of
 * `docs/plans/2026-08-04-generic-function-literals-design.md`) — the
 * single-arm restriction.
 *
 * A function literal may implement a polymorphic declared type only when that
 * type is a SINGLE-ARM signature. An intersection (an overload set) with a
 * polymorphic arm has no single erased body that could satisfy every arm's
 * clause, bounds and result, so generic overload arms stay evaluate-handler
 * territory in this milestone.
 *
 * This constant supersedes the retired v1 `GENERIC_FUNCTION_LITERAL_MESSAGE`
 * (D7), whose whole-feature rejection the generic-literal install path
 * replaced.
 */
export const GENERIC_OVERLOAD_LITERAL_MESSAGE =
  'A generic OVERLOAD SET cannot take a function-literal body; supply an `evaluate` handler, or declare a single generic signature';

/**
 * The rule a rejected generic spelling on a function LITERAL states
 * (`docs/plans/2026-08-04-generic-function-literals-design.md` §3.4).
 *
 * A type variable enters a literal ONLY through a whole-signature `forall`
 * clause (G6) — never through a per-parameter annotation, which would be a
 * rank-2 spelling.
 */
export const TYPE_VARIABLE_INTRODUCTION_MESSAGE =
  'Type variables are introduced by a whole-signature `forall` clause on the function literal (or by the `function f<T>(…)` form), never by a per-parameter annotation';

/**
 * A whole-signature `forall` marker on a literal that is not well-formed
 * (§2.3): the marker is the literal's contract of record, so its shape is
 * checked — a plain signature, with as many arguments as the literal has
 * parameters.
 */
export const INVALID_GENERIC_MARKER_MESSAGE =
  'A generic function-literal signature must be a plain signature (no optional or variadic arguments) with one argument per literal parameter';

/**
 * §2.4 rule 4, on the E2 route — a GROUND parameter annotation sitting at a
 * QUANTIFIED marker position that does not COVER the variable's bound.
 *
 * Erasure drops such an annotation in favour of the marker, so the coverage
 * question has to be answered before it is dropped: by the time the
 * declaration boundary (`acceptsGenericFunctionLiteral`) reads the literal's
 * parameters, the contradicting annotation is gone. `(x: integer)` at a
 * `forall T: number` position must not silently become "accepts every
 * number".
 */
export const GENERIC_ANNOTATION_COVERAGE_MESSAGE =
  'A parameter annotation at a quantified position must accept every admitted instantiation: the type variable’s bound must be a subtype of the annotation';

/**
 * G5 (§2.5) — currying a generic function literal is not supported.
 *
 * A variable consumed by the supplied prefix cannot be recovered in the
 * residual arrow: `forall T, U. (T, U) -> U` curried at one argument leaves a
 * clause whose `T` occurs nowhere, which is unsolvable. Partial INSTANTIATION
 * (solve the prefix, substitute, prune the clause) is the principled lift.
 */
export const GENERIC_PARTIAL_APPLICATION_MESSAGE =
  'Partial application of a generic function is not supported: supply every argument';

/** G11 — a function-literal body assigned to a symbol declared at a
 * polymorphic OVERLOAD SET. */
export function genericOverloadLiteralError(
  symbol: string,
  valueType: BoxedType | undefined,
  declaredType: BoxedType
): TypeCompatibilityError {
  return new TypeCompatibilityError(
    symbol,
    declaredType,
    valueType,
    'generic-overload-literal',
    [
      `Symbol "${symbol}"`,
      `The declared type "${declaredType}" is a generic overload set. ${GENERIC_OVERLOAD_LITERAL_MESSAGE}`,
    ].join('\n|   ')
  );
}

/** The minted-constructor guard (D5). */
export function constructorAssignmentError(
  symbol: string,
  declaredType: BoxedType
): TypeCompatibilityError {
  return new TypeCompatibilityError(
    symbol,
    declaredType,
    undefined,
    'constructor',
    `Cannot assign a value to the constructor of type "${symbol}"`
  );
}

/**
 * The `incompatible-type` error VALUE a rejected declared type yields on the
 * `Assign` / `Declare` operator routes — the same shape and channel as the
 * call-boundary type check (`createTypeErrorExpression`), so Cortex's
 * diagnostic machinery classifies it as `incompatible-type` rather than an
 * opaque message string.
 */
export function typeCompatibilityErrorValue(
  ce: ComputeEngine,
  e: TypeCompatibilityError
): Expression {
  // G11 keeps the `incompatible-type` code and its three-part payload
  // (Cortex's diagnostic machinery keys on both), but carries the DEDICATED
  // sentence in the `where` slot so the message is the same on every route —
  // a host throw and an `Assign`/`Declare` error value read alike.
  if (e.kind === 'generic-overload-literal')
    return ce.typeError(
      e.declaredType.type,
      e.valueType,
      `${e.symbol}: ${GENERIC_OVERLOAD_LITERAL_MESSAGE}`
    );
  return ce.typeError(e.declaredType.type, e.valueType, e.symbol);
}
