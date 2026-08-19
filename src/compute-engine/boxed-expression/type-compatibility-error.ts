import type { BoxedType } from '../../common/type/boxed-type.js';
import { typeToString } from '../../common/type/serialize.js';

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
    message: string,
    /** An actionable near-miss explanation ({@link unboundSignatureHint}),
     * carried so the `Assign`/`Declare` error-value route can repeat it. */
    readonly hint?: string
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
 * The near-miss behind most declared-FUNCTION-type mismatches: the declared
 * type is a signature but the value is not a function — typically
 * `f : (number) -> number = x^2 + 1`, where the author read the annotation as
 * if it bound `x`. A signature's parameters bind only when they are NAMED
 * (the Epsil "lambda lift" — see
 * `docs/LANGUAGE-MODEL.md`), so with an unnamed
 * annotation the initializer stays an ordinary expression: `x^2 + 1` is a
 * *number* in the unknown `x`, not a function of `x`. The mistake is
 * invisible to readers, who mentally auto-insert the missing name — the
 * message must spell out the contrast.
 *
 * Returns an actionable explanation — naming the exact rewrite when the
 * value's unknowns line up one-to-one with the signature's unnamed
 * parameters — or `undefined` when the mismatch is not this shape (the value
 * is a function, or the declared type is not a plain signature).
 */
export function unboundSignatureHint(
  value: {
    toString(): string;
    type: BoxedType;
    unknowns?: ReadonlyArray<string>;
  },
  declaredType: BoxedType
): string | undefined {
  const declared = declaredType.type;
  if (typeof declared === 'string' || declared.kind !== 'signature')
    return undefined;
  // A function-valued mismatch (wrong arity, wrong parameter types) is a
  // different problem with its own, better messages.
  const actual = value.type.type;
  if (actual === 'function') return undefined;
  if (typeof actual !== 'string' && actual.kind === 'signature')
    return undefined;

  const args = declared.args ?? [];
  const allUnnamed = args.length > 0 && args.every((a) => a.name === undefined);
  const unknowns = value.unknowns ?? [];
  const valueText = value.toString();
  const short = valueText.length <= 40 ? valueText : '…';

  const inUnknowns =
    unknowns.length === 0
      ? ''
      : unknowns.length === 1
        ? ` — an expression in the unknown "${unknowns[0]}", not a function of "${unknowns[0]}"`
        : ` — an expression in the unknowns ${unknowns.map((u) => `"${u}"`).join(', ')}, not a function of them`;
  const lead = `The declared type is a function signature, but the initializer is not a function: a signature's parameters bind only when they are named, so nothing in "${declaredType}" binds and "${short}" is an ordinary value${inUnknowns}`;

  // The exact rewrite, when the unknowns pair off with the unnamed
  // parameters (positionally — a guess beyond one parameter, but the
  // mechanism it demonstrates is what matters).
  if (
    allUnnamed &&
    declared.optArgs === undefined &&
    declared.variadicArg === undefined &&
    declared.typeParams === undefined &&
    unknowns.length === args.length
  ) {
    const named = `(${args.map((a, i) => `${unknowns[i]}: ${typeToString(a.type)}`).join(', ')}) -> ${typeToString(declared.result)}`;
    return `${lead}. Name the parameters — "${named}" — to bind them and make the initializer the function's body, or provide a function literal: "(${unknowns.join(', ')}) => ${short}"`;
  }
  if (allUnnamed)
    return `${lead}. Name the signature's parameters to bind them and make the initializer the function's body, or provide a function literal ("(x) => …")`;
  return `${lead}. Provide a function literal ("(x) => …") or a function-valued expression`;
}

/**
 * The declared-type mismatch, with the message every host route has always
 * thrown (`Symbol "x"\n|   The value …`) — plus, for the
 * signature-vs-non-function near-miss, the {@link unboundSignatureHint}
 * explanation as an additional line.
 */
export function declaredTypeError(
  symbol: string,
  value: {
    toString(): string;
    type: BoxedType;
    unknowns?: ReadonlyArray<string>;
  },
  declaredType: BoxedType
): TypeCompatibilityError {
  const hint = unboundSignatureHint(value, declaredType);
  return new TypeCompatibilityError(
    symbol,
    declaredType,
    value.type,
    'value',
    [
      `Symbol "${symbol}"`,
      `The value "${value.toString()}" of type "${value.type}" is not compatible with the type "${declaredType}"`,
      ...(hint !== undefined ? [hint] : []),
    ].join('\n|   '),
    hint
  );
}

/**
 * G11 (§2.4 of
 * `docs/TYPE-SYSTEM.md`) — the
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
 * (`docs/TYPE-SYSTEM.md`).
 *
 * A type variable enters a literal ONLY through a whole-signature `where`
 * clause (G6) — never through a per-parameter annotation, which would be a
 * rank-2 spelling.
 */
export const TYPE_VARIABLE_INTRODUCTION_MESSAGE =
  'Type variables are introduced by a whole-signature `where` clause on the function literal (or by the `function f<T>(…)` form), never by a per-parameter annotation';

/**
 * A whole-signature marker on a literal that is not well-formed (§2.3): the
 * marker is the literal's contract of record — quantified or ground — so its
 * shape is checked: a plain signature, with as many arguments as the literal
 * has parameters. (A return type that merely HAPPENS to be an arrow is spelled
 * GROUPED and is not a marker at all.)
 */
export const INVALID_SIGNATURE_MARKER_MESSAGE =
  'A function-literal signature marker must be a plain signature (no optional or variadic arguments) with one argument per literal parameter';

/**
 * §2.4 rule 4, on the E2 route — a GROUND parameter annotation sitting at a
 * QUANTIFIED marker position that does not COVER the variable's bound.
 *
 * Erasure drops such an annotation in favour of the marker, so the coverage
 * question has to be answered before it is dropped: by the time the
 * declaration boundary (`acceptsGenericFunctionLiteral`) reads the literal's
 * parameters, the contradicting annotation is gone. `(x: integer)` at a
 * `where T: number` position must not silently become "accepts every
 * number".
 */
export const GENERIC_ANNOTATION_COVERAGE_MESSAGE =
  'A parameter annotation at a quantified position must accept every admitted instantiation: the type variable’s bound must be a subtype of the annotation';

/**
 * G5 (§2.5) — currying a generic function literal is not supported.
 *
 * A variable consumed by the supplied prefix cannot be recovered in the
 * residual arrow: `(T, U) -> U where T, U` curried at one argument leaves a
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
 * call-boundary type check (`createTypeErrorExpression`), so Epsil's
 * diagnostic machinery classifies it as `incompatible-type` rather than an
 * opaque message string.
 */
export function typeCompatibilityErrorValue(
  ce: ComputeEngine,
  e: TypeCompatibilityError
): Expression {
  // G11 keeps the `incompatible-type` code and its three-part payload
  // (Epsil's diagnostic machinery keys on both), but carries the DEDICATED
  // sentence in the `where` slot so the message is the same on every route —
  // a host throw and an `Assign`/`Declare` error value read alike.
  if (e.kind === 'generic-overload-literal')
    return ce.typeError(
      e.declaredType.type,
      e.valueType,
      `${e.symbol}: ${GENERIC_OVERLOAD_LITERAL_MESSAGE}`
    );
  // The signature-vs-non-function near-miss carries its explanation in the
  // `where` slot, exactly as G11 does, so the error value is as actionable
  // as the host throw.
  if (e.hint !== undefined)
    return ce.typeError(
      e.declaredType.type,
      e.valueType,
      `${e.symbol}: ${e.hint}`
    );
  return ce.typeError(e.declaredType.type, e.valueType, e.symbol);
}
