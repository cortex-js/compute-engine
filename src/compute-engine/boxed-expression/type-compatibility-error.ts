import type { BoxedType } from '../../common/type/boxed-type.js';
import { typeToString } from '../../common/type/serialize.js';
import { reduceType } from '../../common/type/reduce.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import {
  collectionElementType,
  resolveTypeAlias,
} from '../../common/type/utils.js';

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  isDictionary,
  isExpression,
  isFunction,
  isSymbol,
} from './type-guards.js';

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

/**
 * Raised when a definition that read a name before the name was a function is
 * rebuilt when the name becomes a function, and the rebuilt body is invalid.
 * With `g(t) := 2a(t)` defined first, `a(t)` is read as a product; the
 * definition `a(x, y) := x + y` rebuilds the body of `g`, where `a(t)` is now
 * a partial application (a function), so `2a(t)` is a type error. The
 * dependent keeps its previous definition (`repairWave`, `function-utils.ts`).
 *
 * The host routes (`ce.assign`, `ce.declare`) let this throw. The
 * `DefineFunction` and `Assign` operator routes answer with `errorValue`, the
 * first error of the rebuilt body, so a program gets the same error value in
 * either order of the two definitions: when `a` is defined first, the
 * definition of `g` evaluates to that error.
 */
export class DependentRebuildError extends Error {
  /** Identifies the class by STRING, not `instanceof` (see
   * {@link TypeCompatibilityError}). */
  readonly name = 'DependentRebuildError';

  constructor(
    /** The first error of the rebuilt body, with its breadcrumb. */
    readonly errorValue: Expression,
    message: string
  ) {
    super(message);
  }
}

/** True when `e` is a {@link DependentRebuildError}, checked by name so the
 * test survives a host/plugin bundle boundary. */
export function isDependentRebuildError(
  e: unknown
): e is DependentRebuildError {
  return (
    e instanceof Error &&
    (e as Error).name === 'DependentRebuildError' &&
    'errorValue' in e
  );
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
  // An invalid value (for example a lambda whose body holds an `Error`) has
  // the type `error`. It may well be a function, so the "not a function" hint
  // would be wrong; the error inside the value is the problem to report.
  if (actual === 'error') return undefined;
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
 * The declared type of one part of a value declared with the type `t`, for
 * {@link failedElementRefusedBy}. `read` gives the type of the part for a
 * type that is not a union and not an alias, or `undefined` when that type
 * has no such part. `any` and `unknown` place no constraint on their
 * contents and are their own part type. A union is read arm by arm, and the
 * part types of the arms are joined and reduced; an arm without the part
 * adds nothing, and an arm whose part is `any` or `unknown` makes the part
 * `any` or `unknown`. `undefined` when no arm gives a part type (a nominal
 * type, for example). `seen` stops the walk at an alias that names itself
 * through a union arm (`type alias cyc = cyc | list<integer>`).
 */
function declaredPartType(
  t: Readonly<Type>,
  read: (t: Type) => Type | undefined,
  seen: Set<Readonly<Type>> = new Set()
): Type | undefined {
  if (t === 'any' || t === 'unknown') return t;
  if (seen.has(t)) return undefined;
  seen.add(t);
  const r = resolveTypeAlias(t);
  if (typeof r === 'object' && r.kind === 'union') {
    const arms: Type[] = [];
    for (const arm of r.types) {
      const part = declaredPartType(arm, read, seen);
      if (part === 'any' || part === 'unknown') return part;
      if (part !== undefined) arms.push(part);
    }
    if (arms.length === 0) return undefined;
    return arms.length === 1
      ? arms[0]
      : reduceType({ kind: 'union', types: arms });
  }
  return read(r);
}

/**
 * The declared type of slot `i` of a `Tuple` literal declared with the type
 * `r`: the slot type of a tuple type, and the element type of a collection
 * type (a tuple is a collection of its slots). A `broadcastable<T>` is read
 * through `T`.
 */
function tupleSlotPart(i: number): (r: Type) => Type | undefined {
  const read = (r: Type): Type | undefined => {
    if (r === 'tuple' || r === 'collection' || r === 'indexed_collection')
      return 'any';
    if (typeof r !== 'object') return undefined;
    if (r.kind === 'tuple') return r.elements[i]?.type;
    if (r.kind === 'collection' || r.kind === 'indexed_collection')
      return r.elements;
    if (r.kind === 'broadcastable') return declaredPartType(r.elements, read);
    return undefined;
  };
  return read;
}

/**
 * The declared type of the value at `key` of a dictionary literal declared
 * with the type `r`: the value type of a dictionary type, the field type of
 * a record type, and the value slot of the entry tuple of a collection type
 * (the elements of a dictionary are its `(key, value)` entries).
 */
function dictionaryValuePart(key: string): (r: Type) => Type | undefined {
  return (r: Type): Type | undefined => {
    if (
      r === 'dictionary' ||
      r === 'record' ||
      r === 'collection' ||
      r === 'indexed_collection'
    )
      return 'any';
    if (typeof r !== 'object') return undefined;
    if (r.kind === 'dictionary') return r.values;
    if (r.kind === 'record') return r.elements[key];
    if (r.kind === 'collection' || r.kind === 'indexed_collection')
      return declaredPartType(r.elements, tupleSlotPart(1));
    return undefined;
  };
}

/**
 * The element type of a `List` or `Set` literal declared with the type `r`:
 * read by `collectionElementType()` for a type that such a literal can have
 * (a list, a tensor, a set, a `collection`, an `indexed_collection`, a
 * `broadcastable`). The other collection kinds are not read: a `List` or
 * `Set` literal cannot be a tuple, a dictionary or a record, and
 * `collectionElementType()` builds the entry type of a dictionary by parsing
 * the spelling of its value type, which fails for a user alias
 * (`dictionary<json>`).
 */
function literalElementPart(r: Type): Type | undefined {
  const literalKind =
    typeof r === 'string'
      ? r === 'list' ||
        r === 'set' ||
        r === 'collection' ||
        r === 'indexed_collection'
      : r.kind === 'list' ||
        r.kind === 'set' ||
        r.kind === 'collection' ||
        r.kind === 'indexed_collection' ||
        r.kind === 'broadcastable';
  return literalKind ? collectionElementType(r) : undefined;
}

/**
 * The number of {@link withoutFailedElementCheck} calls in progress. While it
 * is not zero, {@link failedElementRefusedBy} finds nothing.
 */
let failedElementCheckSuspensions = 0;

/**
 * Run `fn` with the failed-element check of a declared type suspended.
 *
 * The check is a contract on a declared VARIABLE: `s := [1, Error(…)]` with
 * `s: list<number>` is refused. A call that binds a parameter declared
 * `list<number>` to the argument `[1, Error(…)]` is not refused: the call
 * runs, and the body reads the failed element as a value, as it did before
 * the type of such a list left the failed element out. The binding is made
 * with `ce.declare()`, which runs the same declared-type check
 * (`matchesDeclaredTypeAxes`), so the binding suspends the failed-element
 * part of it (`declareParameterActivation`, `function-utils.ts`). The
 * counter is module state, and `fn` runs synchronously, so the suspension
 * ends when `fn` returns or throws.
 */
export function withoutFailedElementCheck<T>(fn: () => T): T {
  failedElementCheckSuspensions += 1;
  try {
    return fn();
  } finally {
    failedElementCheckSuspensions -= 1;
  }
}

/** The deepest level of nested literals the failed-element walk reads. A
 * deeper value is not checked past this level. This bounds the walk for a
 * value the memo does not stop. */
const MAX_FAILED_ELEMENT_DEPTH = 256;

/** The result of a walk in progress, for a value that holds itself through
 * symbols (`y := [z]`, `z := [y]`). */
const IN_PROGRESS = Symbol('in-progress');

/**
 * The state of one failed-element walk. `memo` holds, for each literal
 * visited and each declared type it was read against (by its spelling), the
 * result of that visit, or `IN_PROGRESS` while the visit runs. A literal
 * shared by several parents (`t := List(u, u)`, repeated) is then read once
 * per declared type, not once per path, and a cycle through symbol values
 * ends at its first repeat.
 */
type FailedElementWalk = {
  memo: Map<
    Expression,
    Map<string, Expression | undefined | typeof IN_PROGRESS>
  >;
  depth: number;
};

/**
 * The first failed element in `parts` (the parts of a value, each with its
 * declared type) that the declared type does not admit, read through the
 * literals nested in each part.
 */
function firstRefusedPart(
  parts: Iterable<[Expression, Type | undefined]>,
  walk: FailedElementWalk
): Expression | undefined {
  for (const [part, declared] of parts) {
    if (declared === undefined || declared === 'any' || declared === 'unknown')
      continue;
    if (part.type.type === 'error') {
      if (!isSubtype('error', declared)) return part;
      continue;
    }
    const inner = refusedFailedElement(part, declared, walk);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

/**
 * The first failed element of the collection literal `value` that the
 * declared type `declared` does not admit, or `undefined` when there is none.
 *
 * A failed element is an element whose type is exactly `error` (an `Error`
 * expression, or an application that failed, such as `1/"a"`). The type of
 * a `List` or `Set` literal leaves such an element out
 * (`docs/ERROR-MODEL.md` §4: a type describes the successful values), so
 * `[1, Error(…)]` is typed `vector<integer^2>`, which a `list<number>`
 * admits. A declared type is a contract on every value the symbol holds, so
 * the declared-type check reads the elements themselves as well: the value
 * is refused when it holds a failed element at a position whose declared
 * element type is not a supertype of `error`. `list<number>` and
 * `list<expression>` refuse `[1, Error(…)]`, and `list<list<number>>`
 * refuses `[[1, Error(…)]]`. A declared element type `any` or `unknown`, or
 * one with an explicit `error` arm (`list<number | error>`), admits it, and
 * so does the bare `list`, whose element type is `any`.
 *
 * The walk reads the value, not its type: a `List` or `Set` literal and the
 * literals nested in it, the literal a restriction (`When`) holds, and the
 * literal a symbol holds as its value (`s := fs`, with `fs` holding
 * `[1, Error(…)]`). It also reads the slots of a tuple literal and the
 * values of a dictionary literal, whose types are built from the types of
 * their parts, so a list with a failed element inside them is read too:
 * `tuple<list<number>, integer>` refuses `([1, Error(…)], 2)`, and
 * `dictionary<list<number>>` refuses `{"k" -> [1, Error(…)]}`; a tuple
 * declared as a collection (`collection<list<number>>`) has each slot read
 * against the element type. An element whose type is a union with an
 * `error` arm is not a failed element. A position whose declared type
 * cannot be read (a nominal type) is not checked.
 *
 * A declared union is read arm by arm: the value is refused unless one arm
 * that its type matches also admits its failed elements. So
 * `list<number> | set<any>` refuses `[1, Error(…)]`: the list matches the
 * arm `list<number>`, which refuses the failed element, and does not match
 * the arm `set<any>`. When the type of the value matches no arm on its own,
 * the arms are read together.
 *
 * Nothing is found while a parameter binding suspends the check
 * ({@link withoutFailedElementCheck}).
 */
export function failedElementRefusedBy(
  value: Expression,
  declared: Readonly<Type>
): Expression | undefined {
  if (failedElementCheckSuspensions > 0) return undefined;
  return refusedFailedElement(value, declared, { memo: new Map(), depth: 0 });
}

function refusedFailedElement(
  value: Expression,
  declared: Readonly<Type>,
  walk: FailedElementWalk
): Expression | undefined {
  // Read through restrictions and symbol values to the literal they hold.
  // The number of steps is bounded: a chain of symbols could hold itself.
  let held = value;
  for (let step = 0; step < 16; step++) {
    if (isFunction(held, 'When') && held.nops === 2) held = held.op1;
    else if (isSymbol(held) && held.value !== undefined && held.value !== held)
      held = held.value;
    else break;
  }
  const literal =
    isFunction(held, 'List') ||
    isFunction(held, 'Set') ||
    isFunction(held, 'Tuple') ||
    isDictionary(held);
  if (!literal || walk.depth >= MAX_FAILED_ELEMENT_DEPTH) return undefined;

  const key = typeToString(declared as Type);
  let byType = walk.memo.get(held);
  if (byType === undefined) {
    byType = new Map();
    walk.memo.set(held, byType);
  }
  const known = byType.get(key);
  if (known === IN_PROGRESS) return undefined;
  if (byType.has(key)) return known;
  byType.set(key, IN_PROGRESS);
  walk.depth += 1;
  let result: Expression | undefined;
  try {
    result = refusedInLiteral(held, declared, walk);
  } finally {
    walk.depth -= 1;
  }
  byType.set(key, result);
  return result;
}

/** The body of {@link refusedFailedElement} for the literal `held`. */
function refusedInLiteral(
  held: Expression,
  declared: Readonly<Type>,
  walk: FailedElementWalk
): Expression | undefined {
  const resolved = resolveTypeAlias(declared);
  if (typeof resolved === 'object' && resolved.kind === 'union') {
    const valueType = held.type.type;
    const matching = resolved.types.filter((arm) => isSubtype(valueType, arm));
    if (matching.length > 0) {
      let first: Expression | undefined;
      for (const arm of matching) {
        const found = refusedFailedElement(held, arm, walk);
        if (found === undefined) return undefined;
        first ??= found;
      }
      return first;
    }
  }
  if (isFunction(held, 'List') || isFunction(held, 'Set')) {
    const elements = declaredPartType(declared, literalElementPart);
    return firstRefusedPart(
      held.ops.map((op): [Expression, Type | undefined] => [op, elements]),
      walk
    );
  }
  if (isFunction(held, 'Tuple')) {
    return firstRefusedPart(
      held.ops.map((op, i): [Expression, Type | undefined] => [
        op,
        declaredPartType(declared, tupleSlotPart(i)),
      ]),
      walk
    );
  }
  if (isDictionary(held)) {
    return firstRefusedPart(
      held.entries.map(([key, v]): [Expression, Type | undefined] => [
        v,
        declaredPartType(declared, dictionaryValuePart(key)),
      ]),
      walk
    );
  }
  return undefined;
}

/**
 * The declared-type mismatch, with the message every host route has always
 * thrown (`Symbol "x"\n|   The value …`) — plus an explanation as an
 * additional line: the {@link unboundSignatureHint} explanation for the
 * signature-vs-non-function near-miss, or, for a collection that holds a
 * failed element the declared type does not admit
 * ({@link failedElementRefusedBy}), the name of that element.
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
  const failed = isExpression(value)
    ? failedElementRefusedBy(value, declaredType.type)
    : undefined;
  // The type of a collection with a failed element leaves that element out,
  // and can match the declared type. Then the failed element is the only
  // reason for the refusal: the message does not state the type of the
  // value, and the error has no value type, so that the `Assign`/`Declare`
  // error value does not read "expected `list<number>`, got
  // `vector<integer^2>`". When the type does not match either, the message
  // states it, and the failed element follows.
  const onlyFailed = failed !== undefined && value.type.matches(declaredType);
  const hint =
    unboundSignatureHint(value, declaredType) ??
    (failed !== undefined
      ? `The value holds the failed element "${failed.toString()}". The type "${declaredType}" does not admit an error at the position of this element`
      : undefined);
  return new TypeCompatibilityError(
    symbol,
    declaredType,
    onlyFailed ? undefined : value.type,
    'value',
    [
      `Symbol "${symbol}"`,
      onlyFailed
        ? `The value "${value.toString()}" is not compatible with the type "${declaredType}"`
        : `The value "${value.toString()}" of type "${value.type}" is not compatible with the type "${declaredType}"`,
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
