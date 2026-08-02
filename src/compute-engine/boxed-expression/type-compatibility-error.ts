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
     * declared-type mismatch. */
    readonly kind: 'value' | 'constructor',
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
  return ce.typeError(e.declaredType.type, e.valueType, e.symbol);
}
