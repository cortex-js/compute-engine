import { callableBindingInContext } from './binders.js';
import { isForwardCallReference } from './forward-call-reference.js';
import type {
  Expression,
  BoxedDefinition,
  IComputeEngine,
  OperandDescriptor,
} from '../global-types.js';
import type { FunctionInterface } from '../types-expression.js';
import type { Type } from '../../common/type/types.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  cannotHoldAList,
  isSubtype,
  provablyDisjoint,
  widen,
} from '../../common/type/subtype.js';
import { factsOf } from '../../common/type/facts.js';
import {
  type AliasDescent,
  collectionElementType,
  isWildcardFunctionType,
  resolveTypeAlias,
  stripMissingFromType,
  unfoldAliasOnDescent,
} from '../../common/type/utils.js';
import {
  deriveApplicationOf,
  describe,
  describeCallee,
  describedFunctionLiteral,
  describeType,
} from './operand-descriptor.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterNames,
  functionLiteralParameterType,
  functionLiteralReturnType,
  functionLiteralReturnMarker,
  functionLiteralDeclaredSignature,
  capturedSymbols,
  isRestParameter,
  isDestructuringParameter,
  isScalarType,
  isWideParameterType,
  optionalParameterDefault,
  optionalParameterTarget,
} from './function-literal.js';
import {
  isPointListArgumentType,
  isPointOrPointListArgumentType,
  isPointParameterType,
  isTupleShapedType,
  pointArity,
} from '../collection-utils.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { signatureParamsAreScalar } from './callback-broadcast-admission.js';
import { isDictionary, isFunction, isNumber, isSymbol } from './type-guards.js';
import { provisionalRecursionResult } from './declared-parameter-result.js';
import {
  noteStackDependentAnswer,
  stackDependentAnswerCount,
} from '../static-typing-view.js';

const cache = new WeakMap<
  IComputeEngine,
  {
    generation: number;
    literals: WeakMap<Expression, Map<string, Type | undefined>>;
  }
>();
const active = new WeakMap<IComputeEngine, Set<Expression>>();
/** For a map of results of `cache`, the keys of the results whose
 * derivation read an answer that depends on the derivations in progress
 * (`noteStackDependentAnswer()`, `static-typing-view.ts`): a read of such a
 * result is counted again. */
const stackDependentResults = new WeakMap<
  Map<string, Type | undefined>,
  Set<string>
>();
/** The number of derivations, per engine, that were declined because the
 * literal was already being derived (a recursive call). The body walk reads
 * it before and after a nested call to know whether the nested call reached
 * a recursion. */
const recursionDeclines = new WeakMap<IComputeEngine, number>();

function userFunctionLiteral(binding: BoxedDefinition | undefined) {
  const literal =
    binding &&
    ('operator' in binding
      ? (binding.operator as { _lambdaLiteral?: Expression })._lambdaLiteral
      : binding.value.value);
  return literal && isFunction(literal, 'Function') ? literal : undefined;
}

/** True when `expr` is a call of a user function whose literal is in
 * `running` (a function whose body a call-result derivation is walking), or
 * a symbol bound to such a function. */
function namesRunningLiteral(
  expr: Expression,
  running: ReadonlySet<Expression>
): boolean {
  const binding: BoxedDefinition | undefined =
    expr.valueDefinition !== undefined
      ? { value: expr.valueDefinition }
      : expr.operatorDefinition !== undefined
        ? { operator: expr.operatorDefinition }
        : undefined;
  const literal = userFunctionLiteral(binding);
  return literal !== undefined && running.has(literal);
}

/** True when `expr` holds a call of a user function whose literal is in
 * `running`, or a symbol bound to such a function
 * (`namesRunningLiteral`), directly or through the literals of the user
 * functions it calls: `x ↦ hb(x − 1)` in the body of `ha`, when `hb` calls
 * `ha`.
 *
 * Each node, a callee literal included, is read once (`seen`). An
 * expression can share a subexpression in several places (`Max(e, e)`
 * nested 30 deep has 31 distinct nodes and 2^30 paths), and a walk that
 * reads a node once per path does not finish. Skipping a node already read
 * is exact: `running` does not change during the walk, so a node that held
 * no such call when it was read holds none the second time (CE-594.1). */
function callsRunningLiteral(
  expr: Expression,
  running: ReadonlySet<Expression>,
  seen: Set<Expression> = new Set()
): boolean {
  if (seen.has(expr)) return false;
  seen.add(expr);
  if (namesRunningLiteral(expr, running)) return true;
  const binding: BoxedDefinition | undefined =
    expr.valueDefinition !== undefined
      ? { value: expr.valueDefinition }
      : expr.operatorDefinition !== undefined
        ? { operator: expr.operatorDefinition }
        : undefined;
  const callee = userFunctionLiteral(binding);
  if (callee !== undefined && callsRunningLiteral(callee, running, seen))
    return true;
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) => callsRunningLiteral(op, running, seen));
}

/**
 * The present part of an argument type with a `missing` arm: `missing | T`
 * reads as `T`. The index read `L[k]` of a declared `L: list<tuple<number,
 * number, number>>` is typed `missing | tuple<number, number, number>` (the
 * index may be out of range). The derivation types the body under the
 * present part, then once more with the parameter typed `missing`, and joins
 * the two (Tycho ledger row 374: `W(L[k], 2)` was typed from the declared
 * signature, with `broadcastable` components, because the union argument
 * stopped the derivation). The remaining arms are kept as the union they
 * were, not widened: `real | nan` stays a scalar union, which the parameter
 * guard below admits, where `widen` would make it `number`. A type with no
 * `missing` arm is returned unchanged.
 */
function presentPart(type: Type): Type {
  const t = resolveTypeAlias(type);
  if (typeof t === 'string' || t.kind !== 'union') return type;
  const arms = t.types.filter((x) => resolveTypeAlias(x) !== 'missing');
  if (arms.length === t.types.length || arms.length === 0) return type;
  return arms.length === 1 ? arms[0] : { kind: 'union', types: arms };
}

/** Lists may bind elementwise; only known atomic arguments can bind whole. */
function mayBroadcast(type: Type): boolean {
  const t = resolveTypeAlias(type);
  if (
    isSubtype(t, 'string') ||
    (typeof t === 'object' &&
      t.kind === 'tuple' &&
      t.elements.every((x) => isSubtype(x.type, 'number')))
  )
    return false;
  return factsOf(t).collection !== false;
}

/**
 * How an argument of type `type` (its absent arm removed) meets a parameter
 * declared with a wide type (`any`, `expression` or `value`), which
 * receives a collection whole. A string is not read as a collection. Unlike
 * {@link mayBroadcast}, a numeric tuple is a collection here.
 * - `'top'` when `type` is itself a wide type (`L` declared `any`, with the
 *   value `[1, 2]`), `unknown`, or when it can be a collection and can also
 *   be a value that is not one (`list<integer> | integer`). The walk of the
 *   body types `2t` as a number for such an argument, so it cannot tell
 *   whether the value is a collection, and the call is typed `any`. An
 *   `unknown` argument can hold a list: with `L` declared `list<unknown>`
 *   and the value `[[1, 2]]`, `L[1]` is `[1, 2]`.
 * - `'collection'` when every value of `type` is a collection
 *   (`list<integer>`, `tuple<integer, integer>`). The walk of the body,
 *   with the parameter typed as the argument, then describes the value.
 * - `undefined` when no value of `type` is a collection, and for `error`
 *   and `never`.
 *
 * Only an argument at a parameter declared with a wide type is read here,
 * so an `unknown` argument at another parameter keeps its typing.
 */
/**
 * `wideParameterArgument` for the argument `arg`, its absent arm removed.
 * A FREE symbol of type `unknown` (an undeclared `x`, the structure flag
 * `free`) is a generic value, as the `List` type handler reads it (a
 * number cell), so it does not make the call `any`: with `U` declared
 * `(any, any) -> tuple<number, number>`, `U(x, y)` keeps its declared
 * result. Any other `unknown` argument can hold a list, as `L[1]` with `L`
 * declared `list<unknown>` does, and gives `'top'`.
 */
function wideArgumentKind(
  arg: OperandDescriptor
): 'top' | 'collection' | undefined {
  const t = presentPart(arg.type);
  const kind = wideParameterArgument(t);
  if (kind !== 'top' || resolveTypeAlias(t) !== 'unknown') return kind;
  const structure = arg.structureOf?.();
  return structure?.kind === 'symbol' && structure.free === true
    ? undefined
    : kind;
}

function wideParameterArgument(type: Type): 'top' | 'collection' | undefined {
  if (isWideParameterType(type)) return 'top';
  const t = resolveTypeAlias(type);
  if (t === 'unknown') return 'top';
  if (t === 'error' || t === 'never') return undefined;
  if (isSubtype(t, 'string')) return undefined;
  const collection = factsOf(t).collection;
  if (collection === false) return undefined;
  return collection === true ? 'collection' : 'top';
}

/**
 * Does a call of `head` hand each argument to the body WHOLE, a collection
 * argument included? It does when the signature that decides the binding has
 * a parameter that is not a scalar (a collection, a point): the interpreter
 * then maps over no argument (`applyFunctionLiteral`). The deciding signature
 * is the declared one when there is one, the literal's own type otherwise
 * (a bare `function` declaration, whose literal infers `l: collection` from
 * a use such as `Length(l)`). A generic signature is not read here: its
 * instantiation types the call.
 */
function bindsArgumentsWhole(
  binding: BoxedDefinition | undefined,
  literal: Expression
): boolean {
  if (!binding) return false;
  let sig: Type | undefined;
  if ('operator' in binding) sig = binding.operator.signature?.type;
  else {
    const declared = binding.value.type?.type;
    sig =
      typeof declared === 'object' && declared.kind === 'signature'
        ? declared
        : literal.type.type;
  }
  return (
    typeof sig === 'object' &&
    sig.kind === 'signature' &&
    sig.typeParams === undefined &&
    !signatureParamsAreScalar(sig)
  );
}

/**
 * The parameter types of the signature DECLARED for `binding` (not one
 * inferred from the value), in order, required parameters first. A call
 * checks its arguments against them: with `f: (string) -> unknown`, `f(P)`
 * with `P` absent is an `incompatible-type` error, and with
 * `f: (real) -> unknown` the absent value is read as `NaN`, although the
 * function literal assigned to `f` has no annotation. `undefined` when no
 * signature was declared, or when it is generic.
 *
 * An operator definition whose literal annotates only some of its
 * parameters has a `_validationSignature`, the signature the arguments are
 * checked against: there a bare parameter is `any`, and its type in
 * `signature` was only inferred from the body. That signature is read, so
 * that an inferred type is not read as a contract.
 *
 * With `declaredOnly`, the `signature` of an operator definition is read
 * even when it has a `_validationSignature`: the `any` of a bare parameter
 * there is not a declaration, and the rule for a parameter declared with a
 * wide type (`argumentAtWideParameter`) must not read it as one. With
 * `ce.declare('k', { signature: '(unknown) -> unknown', evaluate })`, the
 * parameter of `k` is `unknown`, not `any`.
 */
function declaredParameterTypes(
  binding: BoxedDefinition | undefined,
  declaredOnly = false
): ReadonlyArray<Type> | undefined {
  if (!binding) return undefined;
  let sig: Type | undefined;
  if ('operator' in binding) {
    if (binding.operator.inferredSignature) return undefined;
    sig = declaredOnly
      ? binding.operator.signature?.type
      : (binding.operator._validationSignature ??
        binding.operator.signature?.type);
  } else {
    if (binding.value.inferredType) return undefined;
    sig = binding.value.type?.type;
  }
  if (
    typeof sig !== 'object' ||
    sig.kind !== 'signature' ||
    sig.typeParams !== undefined
  )
    return undefined;
  return [...(sig.args ?? []), ...(sig.optArgs ?? [])].map((a) => a.type);
}

/** Whether an argument in `args` is typed `missing` at a parameter of
 * `literal` whose type is numeric or a point (a tuple of numbers,
 * `pointArity()`). The type of the parameter is its annotation in the
 * literal, else its type in the declared signature of the function. A
 * parameter with a default value counts as any other: a default fills only
 * an argument that the call leaves out, so with `f := (x: integer = 2) ↦ x`,
 * `f(First([]))` is `Missing`. */
function alwaysAbsentAtNumericParameter(
  literal: Expression & FunctionInterface,
  binding: BoxedDefinition | undefined,
  args: readonly OperandDescriptor[]
): boolean {
  const params = literal.ops.slice(1);
  let declaredParams: ReadonlyArray<Type> | undefined | null = null;
  return args.some((a, i) => {
    if (resolveTypeAlias(a.type) !== 'missing' || i >= params.length)
      return false;
    if (declaredParams === null)
      declaredParams = declaredParameterTypes(binding);
    const p = functionLiteralParameterType(params[i]) ?? declaredParams?.[i];
    return (
      p !== undefined &&
      p !== 'never' &&
      (isSubtype(p, 'number') || pointArity(p) !== undefined)
    );
  });
}

/** Derive a call's result from its body without changing the callable contract.
 * Parameters and straight-line locals carry descriptors, never runtime values.
 * Unsupported control flow and recursive calls keep the declared result. */
export function callResultType(
  engine: IComputeEngine,
  head: string,
  args: readonly OperandDescriptor[],
  declared: Type,
  derive: (
    head: string,
    args: readonly OperandDescriptor[]
  ) => Type | undefined,
  binding?: BoxedDefinition
): Type | undefined {
  if (binding && 'value' in binding && isForwardCallReference(binding.value))
    binding = callableBindingInContext(engine, head, binding);
  binding ??= engine.lookupDefinition(head);
  const literal = userFunctionLiteral(binding);
  const inferred =
    literal !== undefined && inferredCallSignature(binding) !== undefined;
  // An argument that is an error: a call of a user function with an error
  // argument is that error (`docs/ERROR-MODEL.md`, section 3), whatever
  // its signature says. The body of `r := x ↦ If(x = 0, 0, r(x − 1) + 1)`
  // calls `r("s" − 1)`, and the derivation of `r("s")` reads that call.
  if (inferred && args.some((x) => x.type === 'error')) return 'error';
  // An argument that is always absent (typed `missing`) at a numeric or a
  // point parameter makes the call `Missing` whatever the body
  // (`absentAtNumericParameter()` in `boxed-function.ts`, and `apply()` in
  // `function-utils.ts`), so the call is typed `missing`. An error argument
  // outranks the absent value.
  if (
    literal !== undefined &&
    !args.some((x) => x.type === 'error') &&
    alwaysAbsentAtNumericParameter(literal, binding, args)
  )
    return 'missing';
  // A parameter whose uses require types that no value has (`n` in
  // `n ↦ Range(n) + n[1]`, a scalar bound and a collection) is typed
  // `never` (`narrowInferredType`, `boxed-symbol.ts`). Every call of such a
  // function is an error: a list argument at that parameter fails the scalar
  // use, and any other argument fails the index read. The result of the
  // signature, derived from a body with a parameter of type `never`, does
  // not describe that value.
  if (
    inferred &&
    !args.some((x) => mayBroadcast(presentPart(x.type))) &&
    literal.ops.slice(1).some((operand) => {
      // A parameter with a default value is read inside its `Optional`.
      const p = optionalParameterTarget(operand);
      return isSymbol(p) && p.type.type === 'never';
    })
  )
    return 'error';
  // A string or a boolean argument of a function whose signature was
  // inferred: the result of the signature can be false for it, and so can
  // the candidate result of a cycle of recursive calls, which was derived
  // with numeric arguments (`provisionalRecursionResult`). When the rules
  // below keep the result of the signature (`undefined`), the call is
  // typed from the body (`dataArgumentCallType`).
  const dataArgument = inferred && args.some((x) => isNonNumericDatum(x.type));
  const declined = { walk: false };
  let t = callResultTypeOfBinding(
    engine,
    args,
    declared,
    derive,
    binding,
    dataArgument,
    declined
  );
  // An inferred result is not a contract: see `mayDeriveUnbounded`. A
  // result type that the host declared for the function stays the bound.
  // Only when the walk bounded by the inferred result ran and gave no type:
  // when the result is a scalar and the arguments fit the signature, or
  // when the call maps over an argument, no walk runs and the rules that
  // decided so stand (the walk of a body can be narrower than the value:
  // `Mod(x, y)` is typed `real`, and is `NaN` for `y = 0`).
  if (
    declined.walk &&
    t === undefined &&
    inferred &&
    !dataArgument &&
    mayDeriveUnbounded(literal, args)
  )
    t = unboundedLiteralResultType(
      literal,
      args,
      derive,
      declaredParameterTypes(binding)
    );
  if (t !== undefined || !dataArgument) return t;
  return dataArgumentCallType(
    literalBodyResultType(
      engine,
      literal,
      args,
      'any',
      derive,
      declaredParameterTypes(binding)
    ),
    declared
  );
}

/** The part of `callResultType` that reads the binding of the called
 * function, after it is resolved. With `skipProvisional`, the candidate
 * result of a cycle of recursive calls is not read. */
function callResultTypeOfBinding(
  engine: IComputeEngine,
  args: readonly OperandDescriptor[],
  declared: Type,
  derive: (
    head: string,
    args: readonly OperandDescriptor[]
  ) => Type | undefined,
  binding: BoxedDefinition | undefined,
  skipProvisional: boolean,
  declined?: { walk: boolean }
): Type | undefined {
  // A call of a function of a cycle of calls whose result is verified is
  // typed by the candidate result of that function
  // (`provisionalRecursionResult`).
  const called = userFunctionLiteral(binding);
  const provisional =
    called === undefined || skipProvisional
      ? undefined
      : provisionalRecursionResult(called);
  if (provisional !== undefined) return provisional;
  const inferredSig = inferredPointSignature(binding);
  if (inferredSig !== undefined) {
    const t = inferredPointCallType(
      engine,
      binding,
      inferredSig,
      args,
      declared,
      derive
    );
    if (t !== undefined) return t;
  }
  // The result of an inferred signature describes only the arguments that
  // fit its parameters (`argumentOutsideInferredSignature`), so it does not
  // bound the type derived from the body for another argument. That type
  // replaces the scalar result only when the result does not hold it.
  // A collection at a parameter declared with a wide type is bound whole,
  // and the result of the signature, scalar or not, does not describe the
  // call (`argumentAtWideParameter`): the call is typed from the body with
  // no bound, else `any`.
  const wide = argumentAtWideParameter(called, binding, args);
  if (wide === 'top') return 'any';
  let scalar: Type | undefined;
  // A list at a parameter that receives it whole, under a scalar result
  // that the body is checked against (`listAtWholeParameter`).
  let listWhole = false;
  if (wide === 'collection') declared = 'any';
  else if (isScalarResult(declared)) {
    listWhole =
      declared !== 'never' && listAtWholeParameter(called, binding, args);
    if (!listWhole && !argumentOutsideInferredSignature(binding, args))
      return undefined;
    scalar = declared;
    declared = 'any';
  }
  const literal = userFunctionLiteral(binding);
  if (
    !literal ||
    (args.some((x) => mayBroadcast(presentPart(x.type))) &&
      !bindsArgumentsWhole(binding, literal))
  )
    return wide === 'collection' ? 'any' : undefined;
  const t = literalBodyResultType(
    engine,
    literal,
    args,
    declared,
    derive,
    declaredParameterTypes(binding)
  );
  if (wide === 'collection')
    return t === undefined || t === 'unknown' ? 'any' : t;
  // The walk of the body, bounded by a result that is not a scalar, ran and
  // gave no type (`mayDeriveUnbounded`).
  if (declined !== undefined && t === undefined && scalar === undefined)
    declined.walk = true;
  // When the walk gives no type, the type of the ascribed body does not
  // replace it: in a `Block` body the ascription holds only the last
  // statement, and the walk gives no type when that statement does not give
  // the value (an early `Return`, a loop).
  if (listWhole) return listAtWholeParameterResult(t, scalar!);
  return scalar === undefined ? t : outsideScalarResult(t, scalar);
}

/** `list<any>`: a list with any contents, nested lists included. */
const ANY_LIST: Type = { kind: 'list', elements: 'any' };

/**
 * Can a call of the function literal `literal` return a list that its
 * scalar result does not hold, because an argument that can be a list is
 * received whole?
 *
 * When the type of the body does not satisfy the declared result `R`, the
 * engine stores the body with a result ascription, `Typed(body, R)`, and
 * checks the value of each call against `R` (`ascriptionViolation`,
 * `library/core.ts`). That check admits a list whose elements conform to
 * `R`: it is `R` computed once per element of a list argument
 * (`conformsUnderBroadcast`). With `h` declared `(list) -> number` and
 * assigned `t ↦ 2t`, `h([1, 2, 3])` is `[2, 4, 6]`. So `R` does not hold the
 * value of the call, and the call is typed from the body
 * (`listAtWholeParameterResult`), as a call with a collection at a parameter
 * declared `any` is (`argumentAtWideParameter`).
 *
 * True when the literal has such an ascription (a marker that holds a full
 * signature is not checked, and is not one), and an argument that can be a
 * list meets a parameter that receives it whole: a parameter that is not a
 * scalar (`list`, `list<tuple<number, number>>`), as the literal annotates
 * it, else as the declared signature types it. A scalar parameter maps over
 * a list argument, and the broadcast rules type that call. A free symbol of
 * type `unknown` is read as a generic value, as in `wideArgumentKind`, and
 * does not count.
 */
function listAtWholeParameter(
  literal: Expression | undefined,
  binding: BoxedDefinition | undefined,
  args: readonly OperandDescriptor[]
): boolean {
  if (!isFunction(literal, 'Function')) return false;
  if (
    functionLiteralReturnMarker(literal) === undefined ||
    functionLiteralDeclaredSignature(literal) !== undefined
  )
    return false;
  const params = literal.ops.slice(1);
  let signatureTypes: ReturnType<typeof declaredParameterTypes> | null = null;
  for (let i = 0; i < args.length; i++) {
    const p = params[i];
    if (p === undefined) continue;
    let param = functionLiteralParameterType(p);
    if (param === undefined) {
      if (signatureTypes === null)
        signatureTypes = declaredParameterTypes(binding);
      param = signatureTypes?.[i];
    }
    if (param === undefined || isScalarParameter(param)) continue;
    const t = presentPart(args[i].type);
    if (t === 'error' || t === 'never' || cannotHoldAList(t)) continue;
    if (resolveTypeAlias(t) === 'unknown') {
      const structure = args[i].structureOf?.();
      if (structure?.kind === 'symbol' && structure.free === true) continue;
    }
    return true;
  }
  return false;
}

/**
 * The type of a call with a list at a parameter that receives it whole,
 * under the scalar result `scalar` that the body is checked against
 * (`listAtWholeParameter`). `t` is the type of the body with each parameter
 * typed as its argument, if the walk of the body gives one.
 *
 * The check refuses a scalar value outside `scalar`, so a `t` that cannot be
 * a list, or that `scalar` holds, gives `scalar`. A list `t` is kept when
 * its leaf elements can be values of `scalar`: the check admits a list only
 * when each element conforms to `scalar`, so `list<string>` under `number`
 * is not kept. Any other `t`, and no `t`, give `scalar | list<any>`, which
 * holds every value that the check admits.
 */
function listAtWholeParameterResult(t: Type | undefined, scalar: Type): Type {
  if (t === undefined || t === 'unknown' || t === 'any')
    return widen(scalar, ANY_LIST);
  if (isSubtype(t, scalar) || cannotHoldAList(t)) return scalar;
  if (isSubtype(t, ANY_LIST) && !provablyDisjoint(listLeafType(t), scalar))
    return t;
  return widen(scalar, ANY_LIST);
}

/**
 * The type of the leaves of the list type `t`: the element type, read
 * again while it is a list (`list<list<integer>>` gives `integer`). A union
 * gives the union of the leaves of its members. Any other type is its own
 * leaf.
 *
 * A self-referential alias (`nest = integer | list<nest>`) reaches itself
 * through its list elements, so each alias is unfolded on the descent
 * `seen` and the walk stops when the alias reaches itself. The occurrence
 * where it stops gives `any`, which no scalar type is disjoint from, so the
 * caller keeps the list type.
 */
function listLeafType(t: Type, seen: AliasDescent = undefined): Type {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return 'any';
  const r = unfolded.type;
  if (typeof r === 'string') return r;
  if (r.kind === 'list') return listLeafType(r.elements, unfolded.seen);
  if (r.kind === 'union')
    return {
      kind: 'union',
      types: r.types.map((x) => listLeafType(x, unfolded.seen)),
    };
  return r;
}

/**
 * How the arguments of a call of the function literal `literal` meet its
 * parameters declared with a wide type (`any`, `expression` or `value`).
 * The type of a parameter is the annotation of the literal, else the type
 * of the parameter in the signature declared for `binding`: the engine does
 * not copy a declared `any` onto the literal (`ce.declare('h', '(any) ->
 * number')`, then `h := t ↦ 2t`), and the parameter still receives a
 * collection whole.
 *
 * Such an argument is bound whole (`isScalarType` refuses these types), and
 * the result of the signature, inferred with the parameter read as that
 * wide type, does not describe the call: with `g := (t: expression) ↦ 2t`,
 * the result is inferred `number`, and `g([1, 2, 3])` is `[2, 4, 6]`; with
 * `(t: expression) ↦ [2t]`, the result is inferred a list of numbers, and
 * the value for `[1, 2]` is `[[2, 4]]`. The answer is:
 * - `'top'` when `wideParameterArgument` gives `'top'` for an argument at
 *   such a parameter (a wide type, or a type such as `list<integer> |
 *   integer` that can be a collection or not). The call is typed `any`.
 * - `'collection'` when an argument at such a parameter is certainly a
 *   collection. The call is then typed from the body with no bound, else
 *   `any`.
 * - `undefined` otherwise.
 */
function argumentAtWideParameter(
  literal: Expression | undefined,
  binding: BoxedDefinition | undefined,
  args: readonly OperandDescriptor[]
): 'top' | 'collection' | undefined {
  if (!isFunction(literal, 'Function')) return undefined;
  const params = literal.ops.slice(1);
  // The declared signature is read only for a parameter that the literal
  // does not annotate, and only once: this runs for every call typing.
  let signatureTypes: ReturnType<typeof declaredParameterTypes> | null = null;
  let result: 'collection' | undefined;
  for (let i = 0; i < args.length; i++) {
    const param = params[i];
    if (param === undefined) continue;
    let declared = functionLiteralParameterType(param);
    if (declared === undefined) {
      if (signatureTypes === null)
        signatureTypes = declaredParameterTypes(binding, true);
      declared = signatureTypes?.[i];
    }
    if (declared === undefined || !isWideParameterType(declared)) continue;
    const kind = wideArgumentKind(args[i]);
    if (kind === 'top') return 'top';
    if (kind === 'collection') result = 'collection';
  }
  return result;
}

/**
 * True when an argument of type `type` is a string or a boolean (an absent
 * arm aside): a value that is not a number and that a call does not map
 * over.
 */
function isNonNumericDatum(type: Type): boolean {
  const t = presentPart(type);
  if (t === 'never' || t === 'unknown' || t === 'any' || t === 'error')
    return false;
  return isSubtype(t, 'string') || isSubtype(t, 'boolean');
}

/** True when `t` is a tuple type with a slot of type `error`, or with a
 * slot that is such a tuple (`dataArgumentCallType`). */
function isTupleWithErrorSlot(t: Type): boolean {
  const r = resolveTypeAlias(t);
  return (
    typeof r === 'object' &&
    r.kind === 'tuple' &&
    r.elements.some((x) => x.type === 'error' || isTupleWithErrorSlot(x.type))
  );
}

/**
 * The type of a call of a function with an inferred signature that has a
 * string or a boolean argument, from `derived`, the type of the body with
 * each parameter typed as its argument (`literalBodyResultType`, with no
 * bound on the result).
 *
 * The engine infers the signature from the uses of each parameter in the
 * body, and a numeric use (`-x`) reads the parameter as a number. The
 * result of the signature is then a numeric type, which does not describe
 * a call with a string: with `f := x ↦ (-x, x)`, the signature is
 * `(x: unknown) -> tuple<number, number>`, and `f("s")` evaluates to
 * `(Error(incompatible-type), "s")`, which has the type `error`. So the
 * call is typed from the body. When the body gives no type, the call is
 * typed `any`, which holds every value. When the result of the signature,
 * `declared`, holds the derived type and is not `unknown` or `any`, the
 * call keeps that result
 * (`undefined` is returned): with `h := u ↦ 1`, `h("abc")` is typed
 * `integer`, not `1`.
 *
 * The derivation types the body `(-x, x)` as `tuple<error, string>`, a
 * tuple with an `error` slot. A tuple value with a failed cell has the type
 * `error`: only a `List` or a `Set` literal keeps a collection type for a
 * failed cell (`docs/ERROR-MODEL.md`, section 3). So a derived tuple type
 * with an `error` slot gives the type `error`, also when the slot is in a
 * nested tuple (`x ↦ ((-x, 1), x)`): the inner tuple is then an error, which
 * is a failed cell of the outer one.
 * (ROADMAP CE-490.)
 */
function dataArgumentCallType(
  derived: Type | undefined,
  declared: Type
): Type | undefined {
  if (derived === undefined || derived === 'unknown') return 'any';
  if (isTupleWithErrorSlot(derived)) return 'error';
  // Every type is a subtype of `unknown` and of `any`: such a result says
  // nothing, and the derived type is kept.
  if (declared === 'unknown' || declared === 'any') return derived;
  return isSubtype(derived, declared) ? undefined : derived;
}

/**
 * `t`, the type of a call derived from the body, when the scalar result
 * `scalar` of the signature does not hold it, and `undefined` (the caller
 * keeps `scalar`) when it does, or when `t` gives no type.
 */
function outsideScalarResult(
  t: Type | undefined,
  scalar: Type
): Type | undefined {
  if (t === undefined || t === 'unknown' || t === 'any') return undefined;
  return isSubtype(t, scalar) ? undefined : t;
}

/** For each signature type: does it have a point parameter (a tuple)? */
const HAS_POINT_PARAMETER = new WeakMap<object, boolean>();

/**
 * The signature of the function that `binding` holds, when the engine
 * INFERRED it (`inferredCallSignature`), it is not generic, and it has a
 * point parameter (a tuple type, as `d(a) := a[1] + a[2]` infers
 * `tuple<number, number>` from the index reads). `undefined` otherwise. The
 * rules of `inferredPointCallType` apply only to such a signature.
 */
export function inferredPointSignature(
  binding: BoxedDefinition | undefined
): Type | undefined {
  const sig = inferredCallSignature(binding);
  if (
    typeof sig !== 'object' ||
    sig.kind !== 'signature' ||
    sig.typeParams !== undefined
  )
    return undefined;
  let has = HAS_POINT_PARAMETER.get(sig);
  if (has === undefined) {
    has = [...(sig.args ?? []), ...(sig.optArgs ?? [])].some((x) =>
      isPointParameterType(x.type)
    );
    HAS_POINT_PARAMETER.set(sig, has);
  }
  return has ? sig : undefined;
}

/**
 * The type of a PARTIAL application (fewer arguments than parameters) of
 * the function that `binding` holds, whose type as the function of the
 * remaining parameters is `curried` (`curriedSignature`,
 * `boxed-function.ts`). Each route types a partial application with this
 * function before any other rule.
 *
 * When the signature was INFERRED and has a point parameter
 * (`inferredPointSignature`), the evaluation runs the point-list map before
 * it curries: an argument that maps (`inferredArgumentMaps`) gives a list
 * of functions. With `h(a, t) := a[1] + a[2] + t`, `h([(1, 2), (3, 4)])` is
 * `[t ↦ t + 3, t ↦ t + 7]`, a `list<(unknown) -> number>`, and
 * `h([1, 2])` is the function `t ↦ t + 3`. A list at a scalar parameter is
 * mapped to its cells, so when its elements may be lists the depth is not
 * known and the type is `list<any>`. An argument that may be a point or a
 * list of points gives `curried | list<curried>`. A DECLARED signature is a
 * contract and `curried` is returned unchanged.
 *
 * When the call does not map, the type is `curried`: the evaluation of a
 * partial application does not evaluate the body, and its value is the
 * function of the remaining parameters (`makeLambda` in
 * `function-utils.ts`). When the signature was INFERRED and the body, typed
 * with the given arguments, is `error` (`partialBodyIsError`), each call of
 * that function gives the error of the full call, so the result of `curried`
 * is `error`. With `h(a, t) := a[1] + a[2] + t`, `h(3)` is a function of
 * type `(t: unknown) -> error`, and each call of it is an
 * `incompatible-type` error, as the full call `h(3, 1)` is. `operands` are
 * the descriptors of the arguments, and `derive` types an application in
 * the body.
 */
export function partialApplicationType(
  engine: IComputeEngine,
  binding: BoxedDefinition | undefined,
  operands: readonly OperandDescriptor[],
  curried: Type,
  derive: (head: string, args: readonly OperandDescriptor[]) => Type | undefined
): Type {
  const types = operands.map((d) => d.type);
  // A supplied argument that is an error is evaluated at the partial
  // application, and the partial application gives that error before any
  // function of the other parameters is made: with `h(a, t) := a[1] + a[2] +
  // t` and `f(a, b) := a`, `f(h(3, 1))` is the `incompatible-type` error of
  // `h(3, 1)`.
  if (types.some((t) => t === 'error')) return 'error';
  // A function defined by a literal that holds its arguments (a `lazy`
  // operator) is not curried: its partial application is the `missing`
  // error (`makeLambda` in `function-utils.ts`).
  if (heldLiteral(binding)) return 'error';
  // The curried signature whose calls give the error of the body. It is
  // computed once, and the unmapped and the possibly mapped branches below
  // both use it.
  let signature: Type | undefined;
  const unmapped = (): Type =>
    (signature ??=
      typeof curried === 'object' &&
      curried.kind === 'signature' &&
      partialBodyIsError(engine, binding, operands, derive)
        ? { ...curried, result: 'error' }
        : curried);
  const sig = inferredPointSignature(binding);
  if (typeof sig !== 'object' || sig.kind !== 'signature') return unmapped();
  const slots = [...(sig.args ?? []), ...(sig.optArgs ?? [])].map(
    (x) => x.type
  );
  let maps = false;
  let maybe = false;
  for (let i = 0; i < types.length; i++) {
    const t = presentPart(types[i]);
    const m = inferredArgumentMaps(slots[i], t);
    if (m === undefined && isPointParameterType(slots[i] ?? 'any'))
      maybe = true;
    if (m !== true) continue;
    maps = true;
    if (!isPointParameterType(slots[i])) {
      const e = collectionElementType(t);
      if (e === undefined || !cannotHoldAList(e))
        return { kind: 'list', elements: 'any' };
    }
  }
  // Each cell of a mapped call is the partial application of one element,
  // whose type is not the type of the whole argument, so the cell keeps
  // `curried`. This applies to the list part of a call that may map too.
  if (maps) return { kind: 'list', elements: curried };
  if (maybe) return widen(unmapped(), { kind: 'list', elements: curried });
  return unmapped();
}

/**
 * True when `binding` is an operator definition that holds its arguments
 * (`lazy`) and whose evaluation is a function literal. A partial
 * application of it is the `missing` error, not a function.
 */
function heldLiteral(binding: BoxedDefinition | undefined): boolean {
  if (binding === undefined || !('operator' in binding)) return false;
  return (
    binding.operator.lazy === true && userFunctionLiteral(binding) !== undefined
  );
}

/**
 * True when the function that `binding` holds has a signature that the
 * engine INFERRED (`inferredCallSignature`), and its body, typed with the
 * first parameters typed as the arguments `operands` and each other
 * parameter typed as its parameter type, is `error`.
 *
 * A partial application of a function literal is the deferred residual
 * that applies the literal to all the arguments when the last one arrives
 * (`makeLambda` in `function-utils.ts`), so each call of the residual gives
 * the value of the full call, which is then that error. A body with an
 * effect is included: the residual also applies the literal. A declared
 * signature is a contract, and this function is false for it: the partial
 * application is typed as the function of the other parameters, with the
 * declared result.
 */
function partialBodyIsError(
  engine: IComputeEngine,
  binding: BoxedDefinition | undefined,
  operands: readonly OperandDescriptor[],
  derive: (head: string, args: readonly OperandDescriptor[]) => Type | undefined
): boolean {
  const sig = inferredCallSignature(binding);
  if (typeof sig !== 'object' || sig.kind !== 'signature') return false;
  const literal = userFunctionLiteral(binding);
  if (literal === undefined) return false;
  const params = sig.args ?? [];
  if (operands.length >= params.length) return false;
  const args = [
    ...operands,
    ...params.slice(operands.length).map((p) => describeType(p.type)),
  ];
  return (
    literalBodyResultType(
      engine,
      literal,
      args,
      'any',
      derive,
      declaredParameterTypes(binding),
      operands.length
    ) === 'error'
  );
}

/**
 * Whether an argument of type `t` at the parameter `slot` of an INFERRED
 * signature with a point parameter makes the call map: `true` when its
 * type says so, `false` when its type says it does not, `undefined` when
 * the type does not say. The call maps over a list of points at a point
 * parameter, and over a list at a scalar parameter (the point-list map of
 * the evaluation, `pointListParamSlots` in `boxed-function.ts`).
 */
export function inferredArgumentMaps(
  slot: Type | undefined,
  t: Type
): boolean | undefined {
  if (slot === undefined) return false;
  if (isPointParameterType(slot)) {
    if (isPointOrPointListArgumentType(t, slot)) return undefined;
    return isPointListArgumentType(t, slot);
  }
  if (!isScalarType(slot)) return false;
  if (isSubtype(t, 'string') || isTupleShapedType(t)) return false;
  if (isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)) return true;
  return factsOf(t).collection === false ? false : undefined;
}

/**
 * True when an argument of type `t` at the point parameter `point` of an
 * INFERRED signature is bound whole to the parameter, and the signature
 * does not describe the call. The engine inferred the parameter type from
 * the uses in the body, so it is not a contract: the call does not check
 * the argument against it, and the body computes with the argument as it
 * is. The type of such a call is derived from the body
 * (`inferredPointCallType`).
 *
 * The signature describes these arguments, and this function is false for
 * them:
 *
 * - an argument of the parameter type (a point);
 * - a list whose elements are numbers, or of unknown type (`[1, 2]`,
 *   `[x, x]` with `x` of unknown type): the body reads it by index as a
 *   point;
 * - a list of points, or an argument that may be a point or a list of
 *   points: the call maps over the points (`inferredArgumentMaps`);
 * - an argument of type `unknown`, `any`, `error` or `never`: nothing in
 *   the type shows that the signature does not describe it.
 *
 * Every other argument is bound whole: a list whose elements may be lists
 * (`[[1, 2], [3, 4]]`, `list<any>`, a `tensor<U>`), a set, an `Interval`,
 * a string, a number (`NaN` included), a boolean, an absent value.
 */
export function bindsWholeAtInferredPoint(t: Type, point: Type): boolean {
  if (t === 'unknown' || t === 'any' || t === 'error' || t === 'never')
    return false;
  if (inferredArgumentMaps(point, t) !== false) return false;
  if (isSubtype(t, point)) return false;
  const element = indexedElementType(t);
  if (element === undefined) return true;
  const e = stripMissingFromType(element);
  return e !== 'unknown' && !isSubtype(e, 'number');
}

/**
 * True when the argument of type `t` at the point parameter `point` of an
 * inferred signature is not of the parameter type, mapping does not apply
 * to it, and the body of `literal` reads parameter `i` whole, not only by
 * index. The parameter type was inferred from the index reads
 * (`P[1]` gives `tuple<number>`), so it states only the components that the
 * body reads. A body that reads the parameter whole computes with the
 * argument as it is, and its value has the shape of the argument: with
 * `c := P ↦ P/(P[1] − 1)` (inferred `(tuple<number>) -> tuple<number>`),
 * `c((3, 2))` is `(3/2, 1)` and `c([3, 2])` is `[3/2, 1]`, which
 * `tuple<number>` does not hold. Such a call is typed from the body
 * (`inferredPointCallType`).
 */
function readsOtherPointWhole(
  literal: (Expression & FunctionInterface) | undefined,
  i: number,
  t: Type,
  point: Type
): boolean {
  if (literal === undefined) return false;
  if (t === 'unknown' || t === 'any' || t === 'error' || t === 'never')
    return false;
  if (isSubtype(t, point)) return false;
  if (inferredArgumentMaps(point, t) === true) return false;
  const param = literal.ops[i + 1];
  if (param === undefined) return false;
  const name = functionLiteralParameterName(param);
  if (!name) return false;
  // A read of the parameter that is not the collection of an index read
  // `At(P, k)`. A nested function literal that binds the same name hides
  // the parameter.
  const visit = (e: Expression): boolean => {
    if (isSymbol(e)) return e.symbol === name;
    if (!isFunction(e)) return false;
    if (
      e.operator === 'Function' &&
      e.ops
        .slice(1)
        .some((p) => functionLiteralParameterNames(p).includes(name))
    )
      return false;
    if (e.operator === 'At' && isSymbol(e.op1) && e.op1.symbol === name)
      return e.ops.slice(1).some(visit);
    return e.ops.some(visit);
  };
  return visit(literal.op1);
}

/**
 * True when the argument of type `t` at parameter `i`, whose type `point`
 * was inferred as a point, is bound whole by the call of the function that
 * `binding` holds, and the signature result does not describe the call:
 * the argument is not a point and the call does not map over it
 * (`bindsWholeAtInferredPoint`), or it is of another point type and the
 * body reads the parameter whole (`readsOtherPointWhole`). Both routes
 * that type a call (the boxed call and the descriptor route) ask this
 * question, so that they agree.
 */
export function bindsWholeAtInferredPointParameter(
  binding: BoxedDefinition | undefined,
  i: number,
  t: Type,
  point: Type
): boolean {
  return (
    bindsWholeAtInferredPoint(t, point) ||
    readsOtherPointWhole(userFunctionLiteral(binding), i, t, point)
  );
}

/**
 * The element type of `t` when it is a collection that the body can read
 * by index (a list, a tuple, not a string, not a set). `undefined`
 * otherwise.
 */
function indexedElementType(t: Type): Type | undefined {
  if (factsOf(t).collection !== true || isSubtype(t, 'string'))
    return undefined;
  if (!isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE) && !isTupleShapedType(t))
    return undefined;
  return collectionElementType(t);
}

/**
 * The type of a call of the function that `binding` holds, whose signature
 * `sig` the engine INFERRED and has a point parameter
 * (`inferredPointSignature`). An inferred signature is not a contract: the
 * engine inferred it from the uses in the body, and it does not prove what
 * the body does with an argument of another type. `undefined` when the
 * signature describes the call (`declared` is the signature result), and
 * the caller types it as any other call.
 *
 * With `d(a) := a[1] + a[2]` (inferred `(tuple<number, number>) ->
 * number`):
 *
 * - `d([1, 2])` and `d((1, 2))`: `undefined`, the signature result
 *   `number` describes the call.
 * - `d([[1, 2], [3, 4]])` binds the matrix whole (`bindsWholeAtInferredPoint`),
 *   and the type is derived from the body with the parameter typed as the
 *   argument: `vector<integer^2>`, for the value `[4, 6]`. `d(3)`,
 *   `d("ab")`, `d(Interval(0, 1))` are typed from the body in the same way,
 *   and the body gives an error type for each. When the body gives no type,
 *   the type is `any`, never the signature result, and never `error` from
 *   the signature alone: with `f(a, b) := If(b, a[1] + a[2], 42)`,
 *   `f(3, False)` is `42`.
 * - A list whose elements may be numbers (`list<any>`, `list<number |
 *   list<number>>`) may be read as a point, so the signature result is
 *   joined to the type. A list whose elements may be points may be mapped
 *   over by the evaluation, which reads the type of the VALUE, so
 *   `list<R>` is joined to the type, with `R` the signature result.
 * - When another argument makes the call map (`inferredArgumentMaps`), the
 *   type is the list of the results of one call: the type derived from
 *   the body with each mapped argument typed as one of its elements (a
 *   point at a point parameter, an element of the list at a scalar
 *   parameter), and each other argument typed as itself. With
 *   `h(a, t) := a[1] + a[2] + t`, `h([[1, 2], [3, 4]], [10, 20])` is
 *   `[[14, 16], [24, 26]]`, a `list<vector<integer^2>>`, and `h(P, 1)`
 *   with `P` a list of points is a `list<number>`. When the body gives no
 *   type, each element is `any` if an argument is bound whole, else the
 *   signature result. An element at a scalar parameter that may be a list
 *   is mapped to its cells, at a depth that the type does not say, and a
 *   point argument whose elements may be points may be mapped too: the
 *   type is then `any`.
 * - When an argument may make the call map, and the type does not say if
 *   it does (an argument of type `unknown` at a scalar parameter, a point
 *   or a list of points at a point parameter), and another argument is
 *   bound whole or maps, the type is `any`.
 *
 * A PARTIAL application (fewer arguments than parameters) gives
 * `undefined`: each route types it first as the function of the remaining
 * parameters (`curriedSignature`, `boxed-function.ts`).
 *
 * The boxed route (`type()` in `boxed-function.ts`) types the map of a
 * list of points itself (`pointListApplicationType`), with the element
 * type that this function gives for one element of the map.
 */
function inferredPointCallType(
  engine: IComputeEngine,
  binding: BoxedDefinition | undefined,
  sig: Type,
  args: readonly OperandDescriptor[],
  declared: Type,
  derive: (head: string, args: readonly OperandDescriptor[]) => Type | undefined
): Type | undefined {
  if (typeof sig !== 'object' || sig.kind !== 'signature') return undefined;
  const slots = [...(sig.args ?? []), ...(sig.optArgs ?? [])].map(
    (x) => x.type
  );
  if (args.length < (sig.args?.length ?? 0) || args.length > slots.length)
    return undefined;
  const types = args.map((a) => presentPart(a.type));
  const mapping = args.map((_, i) => inferredArgumentMaps(slots[i], types[i]));
  const whole = args.map(
    (_, i) =>
      isPointParameterType(slots[i]) &&
      bindsWholeAtInferredPointParameter(binding, i, types[i], slots[i])
  );
  const maps = mapping.some((x) => x === true);
  const bindsWhole = whole.some((x) => x);
  if (!maps && !bindsWhole) return undefined;
  if (mapping.some((x) => x === undefined)) return 'any';
  // The values that the call may give besides the one derived from the
  // body, for each argument bound whole whose elements may be numbers or
  // points (see above).
  let numbers = false;
  let points = 0;
  whole.forEach((w, i) => {
    const element = w ? indexedElementType(types[i]) : undefined;
    if (element === undefined) return;
    const e = stripMissingFromType(element);
    if (!provablyDisjoint(e, 'number')) numbers = true;
    if (!provablyDisjoint(e, slots[i])) points += 1;
  });
  // With two such arguments, or one beside a mapped argument, the call may
  // map over one of them and bind the other whole, and no type above
  // describes that value.
  if (points > 1 || (points > 0 && maps)) return 'any';
  const elementArgs: OperandDescriptor[] = [];
  for (let i = 0; i < args.length; i++) {
    if (mapping[i] !== true) {
      elementArgs.push(args[i]);
      continue;
    }
    const slot = slots[i];
    if (isPointParameterType(slot)) {
      elementArgs.push(describeType(slot));
      continue;
    }
    const e = collectionElementType(types[i]);
    if (e === undefined || !cannotHoldAList(e))
      return { kind: 'list', elements: 'any' };
    elementArgs.push(describeType(e));
  }
  const literal = userFunctionLiteral(binding);
  const body =
    literal === undefined
      ? undefined
      : literalBodyResultType(
          engine,
          literal,
          elementArgs,
          'any',
          derive,
          declaredParameterTypes(binding)
        );
  // A body typed `unknown` gives no type: `unknown` marks a type not
  // inferred yet (`d(3)` reads `3[1]`, which the derivation types
  // `unknown`).
  let result =
    body === undefined || body === 'unknown'
      ? bindsWhole
        ? 'any'
        : declared
      : body;
  if (numbers) result = widen(result, declared);
  if (points > 0) result = widen(result, { kind: 'list', elements: declared });
  return maps ? { kind: 'list', elements: result } : result;
}

/**
 * The signature that the value binding `def` derives for the RECURSIVE
 * function literal it holds when it is declared with the bare `function`
 * type, or `undefined` (then a call reads the literal's own type, which is
 * an inferred signature).
 *
 * The literal's own type reads the recursive call of its body as the type
 * the literal had before it was assigned. With a callee whose body calls
 * another user function, `R(3)` was typed `any`, where an assignment to an
 * undeclared name typed it `number`. The binding derives the signature as
 * for a declaration `(unknown) -> unknown`, which checks the recursion
 * (`_wildcardRecursiveSignature`, `boxed-value-definition.ts`), and the
 * call sites read that signature as a declared one. The method is internal
 * to the definition class, so it is read through a structural type.
 */
export function wildcardRecursiveSignature(def: object): Type | undefined {
  return (
    def as { _wildcardRecursiveSignature?: () => Type | undefined }
  )._wildcardRecursiveSignature?.();
}

/**
 * The signature of the function that `binding` holds, when the engine
 * INFERRED it from the body and the author did not declare it. `undefined`
 * when the signature is a contract, or when `binding` holds no function.
 *
 * - An operator definition: its signature, when `inferredSignature` is set
 *   (`d(a) := a[1] + a[2]`, or a function literal with no annotation that
 *   is assigned to a name that was not declared).
 * - A value definition (a symbol that holds a function literal): the type
 *   of the literal, when the symbol was declared as a bare `function` (or
 *   its type was inferred) and no parameter of the literal has a type
 *   annotation. With `ce.declare('d', 'function')` and then
 *   `(a) ↦ a[1] + a[2]` assigned to `d`, the parameter type
 *   `tuple<number, number>` was inferred from the index reads, as for the
 *   operator definition above. A symbol declared with a signature
 *   (`ce.declare('k', '(tuple<number, number>) -> number')`) has a
 *   contract, and so does a literal that annotates a parameter.
 */
export function inferredCallSignature(
  binding: BoxedDefinition | undefined
): Type | undefined {
  if (!binding) return undefined;
  if ('operator' in binding)
    return binding.operator.inferredSignature
      ? binding.operator.signature?.type
      : undefined;
  const value = binding.value;
  if (!value.inferredType && !isWildcardFunctionType(value.type?.type))
    return undefined;
  const literal = value.value;
  if (!literal || !isFunction(literal, 'Function')) return undefined;
  if (literal.ops.slice(1).some((p) => functionLiteralParameterType(p)))
    return undefined;
  // A recursive literal under a bare `function` declaration: the signature
  // derived with the recursion check (`wildcardRecursiveSignature`). It is
  // still an inferred signature, not a contract: the checks of an error, a
  // string or a boolean argument of `callResultType` apply to it.
  return wildcardRecursiveSignature(value) ?? literal.type.type;
}

/**
 * True when the signature of the function that `binding` holds was
 * INFERRED (`inferredCallSignature`), and the type of an argument in `args`
 * is outside the type of its parameter there, with a parameter that is not
 * a scalar (a collection or a point), so that the argument is bound whole.
 *
 * The engine infers a parameter type from the uses of the parameter in the
 * body, and the inferred result is the result for such arguments only. An
 * argument outside the parameter type can give another value. With `k`
 * declared `(tuple<number, number>) -> number` and `U(L) := k(First(L))`,
 * the inferred signature of `U` is
 * `(L: indexed_collection<tuple<number, number>>) -> number`. With the
 * argument `[[(1, 2), (3, 4)]]`, `First(L)` is a list of points, the call of
 * `k` maps over it, and the value of `U([[(1, 2), (3, 4)]])` is `[3, 7]`,
 * which the inferred result `number` does not hold. A
 * caller then types the call from the body.
 *
 * An argument typed `unknown`, `any` or `error` shows nothing, and a
 * scalar parameter maps over a collection argument, which the broadcast
 * rules type: neither is read here.
 */
function argumentOutsideInferredSignature(
  binding: BoxedDefinition | undefined,
  args: readonly OperandDescriptor[]
): boolean {
  const sig = inferredCallSignature(binding);
  if (
    typeof sig !== 'object' ||
    sig.kind !== 'signature' ||
    sig.typeParams !== undefined ||
    signatureParamsAreScalar(sig)
  )
    return false;
  const params = [...(sig.args ?? []), ...(sig.optArgs ?? [])];
  return args.some((d, i) => {
    const param = params[i]?.type;
    if (param === undefined) return false;
    const t = presentPart(d.type);
    if (t === 'unknown' || t === 'any' || t === 'error' || t === 'never')
      return false;
    return !isScalarParameter(param) && !isSubtype(t, param);
  });
}

/** True when a call maps over a collection argument at a parameter of type
 * `t` (`signatureParamsAreScalar`, read for one parameter). */
function isScalarParameter(t: Type): boolean {
  return signatureParamsAreScalar({
    kind: 'signature',
    args: [{ type: t }],
    result: 'any',
  });
}

/** Scalar declarations already describe their result's representation. This
 * analysis refines collection alternatives, not numeric domains. */
function isScalarResult(declared: Type): boolean {
  return (
    ['number', 'boolean', 'string'].some((t) =>
      isSubtype(declared, t as 'number' | 'boolean' | 'string')
    ) || declared === 'never'
  );
}

/**
 * The value of the `Declare` whose operands are `ops`: the positional
 * value of `Declare(name, type, value)`, else the `value` key of a
 * dictionary of attributes as the last operand. `undefined` when the
 * declaration has no value.
 */
function declaredValueOf(
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  let rest = ops.slice(1);
  let attributesValue: Expression | undefined;
  const last = rest[rest.length - 1];
  if (last !== undefined && isDictionary(last)) {
    attributesValue = last.get('value');
    rest = rest.slice(0, -1);
  }
  return rest[1] ?? attributesValue;
}

/**
 * The type of `Apply(fn, …args)`, where `fn` is the descriptor of a function
 * literal written in place (`x ↦ …`, not a name), derived from the literal's
 * body as `callResultType` derives the result of a call of a user function:
 * each parameter is typed as its argument, and the body is walked under the
 * same rules (an early `Return` other than a last statement, a loop, an
 * assignment to a name that is not a parameter or a local, and an operator
 * that binds a variable other than `Sum`, `Product` and `Comprehension` stop
 * the derivation; an assignment to a parameter retypes it). `declared` is the
 * result type of the literal's signature, and the derived type is used only
 * when it fits it.
 *
 * The literal's signature types a parameter from the uses in its body,
 * before any argument is known: in `a ↦ Map(p, a)` the parameter is typed
 * `collection<unknown>` by the signature of `Map`, and so is the result.
 * Applied to a `list<real>`, the body is `Map(p, M)` with `M` a list of
 * reals, a `list<number>` (Tycho ledger row 426).
 *
 * `undefined` (the caller keeps `declared`) when `fn` is not a canonical
 * function literal, when the signature is generic (its instantiation types
 * the call), when the literal maps over a collection argument (its
 * parameters are scalars: the mapping types the call), and when an argument
 * does not fit the type of its parameter, the contract of the literal.
 * There is one exception to the last case, and it is the only case in which
 * a scalar result is not kept: when the result is a scalar and an argument
 * is outside the type of a parameter that the literal does not annotate and
 * that is not a scalar, the type is derived from the body, and it can be
 * `error` (see the comment in the function).
 */
export function appliedLiteralResultType(
  fn: OperandDescriptor,
  args: readonly OperandDescriptor[],
  declared: Type,
  derive: (head: string, args: readonly OperandDescriptor[]) => Type | undefined
): Type | undefined {
  const sig = fn.type;
  if (
    typeof sig !== 'object' ||
    sig.kind !== 'signature' ||
    sig.typeParams !== undefined
  )
    return undefined;
  if (
    args.some((x) => mayBroadcast(presentPart(x.type))) &&
    signatureParamsAreScalar(sig)
  )
    return undefined;
  const literal = describedFunctionLiteral(fn);
  if (!isFunction(literal, 'Function')) return undefined;
  // A parameter that the literal does not annotate has a type inferred from
  // its uses in the body, and the literal binds an argument outside that
  // type too, when the parameter is not a scalar (a point or a collection):
  // the type is not a contract. When the result of the signature is a
  // scalar, it then does not bound the result of this application, which
  // is typed from the body when the result of the signature does not hold
  // that type (`outsideScalarResult`). With `k` declared
  // `(tuple<number, number>) -> number`, `L ↦ k(L)` has the signature
  // `(L: tuple<number, number>) -> number`, and applied to a list of points
  // its value is a list of numbers. That type can be `error`: applied to
  // `3`, the body `k(3)` is an `incompatible-type` error, and so is the
  // value of the application.
  // An argument outside an annotated parameter, or outside a scalar one,
  // keeps the result of the signature. So does an argument outside the
  // parameter type when the result of the signature is not a scalar.
  const slots = [...(sig.args ?? []), ...(sig.optArgs ?? [])];
  let outside = false;
  let wideCollection = false;
  let keep = false;
  for (let i = 0; i < args.length; i++) {
    const slot = slots[i]?.type;
    if (slot === undefined) continue;
    const t = presentPart(args[i].type);
    // A collection at a parameter declared `any`, `expression` or `value`
    // is bound whole (`isScalarType` refuses these types). The result of the
    // signature was inferred with the parameter read as that wide type, and
    // it does not describe this call, scalar or not: with `t: expression`,
    // the body `2t` is typed `number`, but applied to `[1, 2, 3]` its value
    // is `[2, 4, 6]`. When the argument is certainly a collection, the call
    // is typed from the body with no bound, else `any`. When the argument
    // can be a collection but is not certainly one (a wide type, or
    // `list<integer> | integer`), the walk of the body types `2t` as a
    // number, so it cannot tell whether the value is a collection, and the
    // call is typed `any` (`wideArgumentKind`; `argumentAtWideParameter`
    // has the same rule for a named function).
    if (isWideParameterType(slot)) {
      const kind = wideArgumentKind(args[i]);
      if (kind === 'top') return 'any';
      if (kind === 'collection') {
        wideCollection = true;
        continue;
      }
    }
    if (isSubtype(t, slot)) continue;
    if (
      t === 'unknown' ||
      t === 'any' ||
      t === 'error' ||
      functionLiteralParameterType(literal.ops[i + 1]) !== undefined ||
      isScalarParameter(slot)
    ) {
      // The result of the signature is kept, unless another argument is a
      // collection at a parameter declared with a wide type.
      keep = true;
      continue;
    }
    outside = true;
  }
  if (keep) return wideCollection ? 'any' : undefined;
  // A string or a boolean argument at a parameter that the literal does not
  // annotate: when the rules below keep the result of the signature, that
  // result was inferred with the parameter read as a number, so the call is
  // typed from the body (`dataArgumentCallType`).
  const dataArgument = args.some(
    (x, i) =>
      isNonNumericDatum(x.type) &&
      functionLiteralParameterType(literal.ops[i + 1]) === undefined
  );
  let scalar: Type | undefined;
  let derives = true;
  if (isScalarResult(declared)) {
    if (!outside) derives = false;
    else scalar = declared;
  } else if (outside) derives = false;
  if (!derives && !dataArgument && !wideCollection) return undefined;
  // An applied literal in the body of another is typed by this function
  // again, and the walk of its body is not memoized across the different
  // argument types it meets. Beyond a depth of 8 the result type of the
  // literal is kept, which bounds the work (`any` for a collection at a
  // parameter declared with a wide type, whose result the literal does not
  // describe).
  if (appliedLiteralDepth >= 8) return wideCollection ? 'any' : undefined;
  appliedLiteralDepth += 1;
  try {
    if (wideCollection) {
      const t = literalBodyResultType(
        literal.engine,
        literal,
        args,
        'any',
        derive
      );
      return t === undefined || t === 'unknown' ? 'any' : t;
    }
    if (derives) {
      let t = literalBodyResultType(
        literal.engine,
        literal,
        args,
        scalar === undefined ? declared : 'any',
        derive
      );
      if (
        t === undefined &&
        scalar === undefined &&
        mayDeriveUnbounded(literal, args)
      )
        t = unboundedLiteralResultType(literal, args, derive);
      const result = scalar === undefined ? t : outsideScalarResult(t, scalar);
      if (result !== undefined || !dataArgument) return result;
    }
    return dataArgumentCallType(
      literalBodyResultType(literal.engine, literal, args, 'any', derive),
      declared
    );
  } finally {
    appliedLiteralDepth -= 1;
  }
}

/**
 * Whether a call of `literal`, whose signature was inferred, may be typed by
 * the walk of its body with no bound (`unboundedLiteralResultType`) when the
 * walk bounded by the inferred result declines.
 *
 * An inferred result is read from the body before any argument is known, and
 * it can be narrower than the value: in `v ↦ PointList(PointY(v), PointX(v))`
 * the components are typed `unknown`, which `PointList` reads as numbers, so
 * the inferred result is `tuple<unknown, unknown>`; applied to a list of
 * points the value is a list of points, which the walk types
 * `list<tuple<integer, integer>>` (ROADMAP CE-514). Two cases keep the
 * inferred result as the bound:
 * - the literal writes its result type: that is a contract;
 * - the literal reads a symbol from outside (`capturedSymbols`): its inferred
 *   result records the types those symbols had, and a call whose captured
 *   symbol has since changed type is refused against it (ROADMAP CE-473 (c)),
 *   which a type derived from the current values would hide.
 *
 * The arguments must be numbers or lists (`isNumberOrListArgument`) that
 * hold no string, boolean or character (`mayHoldDatum`). The other
 * arguments keep the inferred result, because the walk of the body does not
 * describe their value:
 * - a tuple binds whole to a scalar parameter, and the call is typed by the
 *   rules for that case (`lambdaBroadcastType`, `boxed-function.ts`, which
 *   answers `any`, and `componentwiseTupleCallType`). Typing such a call
 *   from the body gave wrong narrow types for a nested user call in a list
 *   when it was tried on 2026-09-26 (the comment in `lambdaBroadcastType`
 *   has the record);
 * - a call does not map over a set: `f(Set(1, 2))` for `f := x ↦ x + 1` is
 *   an `incompatible-type` error, which the walk types as a set;
 * - an abstract collection (`collection<integer>`) may hold a tuple or a
 *   set;
 * - a numeric operation on a string, a boolean or a character is an error
 *   that the walk does not always type as one.
 */
function mayDeriveUnbounded(
  literal: Expression & FunctionInterface,
  args: readonly OperandDescriptor[]
): boolean {
  return (
    functionLiteralReturnType(literal) === undefined &&
    capturedSymbols(literal).length === 0 &&
    args.every((x) => isNumberOrListArgument(x.type) && !mayHoldDatum(x.type))
  );
}

/** Whether each arm of `t` is a number type, `missing`, or a list type. */
function isNumberOrListArgument(t: Readonly<Type>): boolean {
  const r = resolveTypeAlias(t as Type);
  if (typeof r === 'object' && r.kind === 'union')
    return r.types.every((x) => isNumberOrListArgument(x));
  if (typeof r === 'object' && r.kind === 'list') return true;
  if (r === 'missing') return true;
  return r !== 'never' && isSubtype(r, 'number');
}

/**
 * Whether a value of type `t` may hold a string, a boolean or a character,
 * at the top or in a slot at any depth. A type that does not name its
 * contents (`list`, `tuple`, `any`, `unknown`) may.
 *
 * The walk of a body types each operation from the types of its operands,
 * and a numeric operation on an element of a bare `list` (`-x` in
 * `x ↦ (-x, x)`) is typed as if the element held a number. When the element
 * is a string, the value has an `incompatible-type` error there, which the
 * derived type does not hold. So the unbounded walk (`mayDeriveUnbounded`)
 * runs only for arguments that answer false.
 */
function mayHoldDatum(t: Readonly<Type>, depth = 0): boolean {
  if (depth > 8) return true;
  const r = resolveTypeAlias(t as Type);
  if (typeof r === 'string') {
    if (
      r === 'any' ||
      r === 'unknown' ||
      r === 'value' ||
      r === 'expression' ||
      r === 'tuple' ||
      r === 'record' ||
      r === 'list' ||
      r === 'set' ||
      r === 'collection' ||
      r === 'indexed_collection' ||
      r === 'dictionary'
    )
      return true;
  }
  for (const datum of ['string', 'boolean', 'character'] as const)
    if (isSubtype(r, datum) || isSubtype(datum, r)) return true;
  if (typeof r === 'string') return false;
  switch (r.kind) {
    case 'union':
      return r.types.some((x) => mayHoldDatum(x, depth + 1));
    case 'tuple':
      return r.elements.some((x) => mayHoldDatum(x.type, depth + 1));
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
      return mayHoldDatum(r.elements, depth + 1);
    case 'dictionary':
      return mayHoldDatum(r.values, depth + 1);
    case 'record':
      return Object.values(r.elements).some((x) => mayHoldDatum(x, depth + 1));
    case 'intersection':
    case 'negation':
      return true;
    default:
      return false;
  }
}

/**
 * The type of the body of `literal` with its parameters typed as `args`,
 * not bounded by the result of its signature, or `undefined` when the walk
 * declines or its type says nothing (`unknown`, `any` or `error`). See
 * `mayDeriveUnbounded`. `declaredParams` are the parameter types declared
 * for the called function, if any.
 */
function unboundedLiteralResultType(
  literal: Expression & FunctionInterface,
  args: readonly OperandDescriptor[],
  derive: (
    head: string,
    args: readonly OperandDescriptor[]
  ) => Type | undefined,
  declaredParams?: ReadonlyArray<Type>
): Type | undefined {
  const t = literalBodyResultType(
    literal.engine,
    literal,
    args,
    'any',
    derive,
    declaredParams
  );
  if (t === undefined) return undefined;
  const r = resolveTypeAlias(t);
  // A tuple with an `error` slot is not a value: the call is an error as a
  // whole (`dataArgumentCallType`), so the walk says nothing here.
  return r === 'unknown' ||
    r === 'any' ||
    r === 'error' ||
    isTupleWithErrorSlot(t)
    ? undefined
    : t;
}

/** The number of `appliedLiteralResultType` derivations in progress, one
 * inside the body of the other. */
let appliedLiteralDepth = 0;

/**
 * Whether the function literal `literal` reads a symbol named in `names`,
 * other than one of its own parameters or the parameters of a literal
 * nested in it.
 */
function readsAnyName(
  literal: Expression & FunctionInterface,
  names: ReadonlyMap<string, unknown>
): boolean {
  // A subexpression shared by several operands is visited once for each set
  // of shadowed names, not once per path.
  const seen = new Map<ReadonlySet<string>, Set<Expression>>();
  const visit = (e: Expression, shadowed: ReadonlySet<string>): boolean => {
    if (isSymbol(e)) return names.has(e.symbol) && !shadowed.has(e.symbol);
    if (!isFunction(e)) return false;
    let done = seen.get(shadowed);
    if (done === undefined) seen.set(shadowed, (done = new Set()));
    if (done.has(e)) return false;
    done.add(e);
    if (e.operator === 'Function') {
      const inner = new Set(shadowed);
      for (const p of e.ops.slice(1))
        for (const n of functionLiteralParameterNames(p)) inner.add(n);
      return visit(e.op1, inner);
    }
    return e.ops.some((op) => visit(op, shadowed));
  };
  return visit(literal, new Set());
}

/** The body walk shared by `callResultType` and `appliedLiteralResultType`. */
function literalBodyResultType(
  engine: IComputeEngine,
  literal: Expression & FunctionInterface,
  args: readonly OperandDescriptor[],
  declared: Type,
  derive: (
    head: string,
    args: readonly OperandDescriptor[]
  ) => Type | undefined,
  // The parameter types of the declared signature of the called function,
  // when it has one (`declaredParameterTypes`). They decide, with the
  // annotations of the literal, how an absent argument is bound.
  declaredParams?: ReadonlyArray<Type>,
  // The number of arguments of a PARTIAL application (`partialBodyIsError`).
  // Each parameter from this index on has no argument, and its descriptor
  // in `args` is its parameter type. Such a parameter is typed by that
  // type even when it is `unknown`: the caller reads only an `error` result.
  partialArgCount?: number
): Type | undefined {
  // A number literal argument is typed by its tier (`integer`, `real`, …),
  // not by its value: the result of `(x ↦ (2x, x))(3)` is a pair of
  // integers, the type of the value it gives, and a call with another
  // literal shares the cache entry.
  args = args.map((a) => {
    const s = a.structureOf?.();
    return s?.kind === 'number' ? describeType(s.tier) : a;
  });
  const params = literal.ops.slice(1);
  if (
    params.length !== args.length ||
    params.some((p) => isRestParameter(p) || isDestructuringParameter(p))
  )
    return undefined;
  const running = active.get(engine) ?? new Set<Expression>();
  if (running.has(literal)) {
    recursionDeclines.set(engine, (recursionDeclines.get(engine) ?? 0) + 1);
    // The answer depends on the derivation in progress: a type that reads
    // it is not kept under the type version (`static-typing-view.ts`).
    noteStackDependentAnswer();
    return undefined;
  }
  active.set(engine, running);
  // Each parameter is typed as the PRESENT part of its argument. An argument
  // that may be absent (`missing | T`) is derived a second time below with
  // that parameter typed as the call binds an absent value (`missing`, or
  // `nan` at a numeric parameter), and the two results are joined: a body
  // that passes the parameter through (`p ↦ p`) or stores it (`(p, s) ↦
  // (p, s)`) gives the absent value back, and the first derivation alone
  // would type the call as if the argument were always present.
  const names: string[] = [];
  const present: Type[] = [];
  let env = new Map<string, OperandDescriptor>();
  for (let i = 0; i < params.length; i++) {
    const name = functionLiteralParameterName(params[i]);
    if (!name) return undefined;
    const t = presentPart(args[i].type);
    names.push(name);
    present.push(t);
    // Unknown arguments may be collections at runtime. Do not infer a scalar
    // result by treating an unknown parameter as a numeric operand. A union
    // whose every member is a scalar (`real | nan`, the type of a value that
    // may be undefined) cannot be a collection, so it is typed like any other
    // scalar argument. A union whose every member is an indexed collection
    // (`list<P^1> | list<P^2>`, an element of a ragged list of lists) is a
    // collection, and is typed as it is: an operator of the body reads the
    // members of the union.
    if (
      (partialArgCount === undefined || i < partialArgCount) &&
      (t === 'unknown' ||
        t === 'any' ||
        t === 'value' ||
        (typeof t === 'object' &&
          (t.kind === 'broadcastable' ||
            (t.kind === 'union' &&
              !isSubtype(t, 'number') &&
              !isSubtype(t, 'boolean') &&
              !isSubtype(t, 'string') &&
              !isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)))))
    )
      return undefined;
    env.set(name, describeType(t));
  }
  const generation = engine._cacheGeneration();
  let stored = cache.get(engine);
  if (!stored || stored.generation !== generation) {
    stored = { generation, literals: new WeakMap() };
    cache.set(engine, stored);
  }
  let results = stored.literals.get(literal);
  if (!results) {
    results = new Map();
    stored.literals.set(literal, results);
  }
  // The declared parameter types decide how an absent argument is bound, and
  // one literal can be the value of several functions declared differently.
  const key =
    [declared, ...args.map((x) => x.type), ...(declaredParams ?? [])]
      .map((t) => typeToString(t))
      .join(';') +
    (partialArgCount === undefined ? '' : `;partial ${partialArgCount}`);
  if (results.has(key)) {
    // A result derived from an answer that depends on the derivations in
    // progress makes the reader depend on them too.
    if (stackDependentResults.get(results)?.has(key))
      noteStackDependentAnswer();
    return results.get(key);
  }
  const stackDependentBefore = stackDependentAnswerCount();
  running.add(literal);
  try {
    const memo = new Map<Expression, OperandDescriptor | undefined>();
    // The descriptors of the calls typed `unknown` because they reached a
    // recursion (see the test on `If` and `Which` below).
    const recursive = new WeakSet<OperandDescriptor>();
    let blockDepth = 0;
    const walk = (expr: Expression): OperandDescriptor | undefined => {
      if (isSymbol(expr)) {
        const local = env.get(expr.symbol);
        if (local !== undefined) return local;
        // A function whose body is being walked, passed by name (`p` in
        // `p := n ↦ If(n < 1, 0, Map(p, [n − 1]))`), is typed by its
        // signature, which was derived with this call typed `unknown`. The
        // derivation stops there, and the call keeps the result of the
        // signature: `p(2)` was typed `integer | list<unknown^1>` for the
        // value `[[0]]`.
        if (namesRunningLiteral(expr, running)) return undefined;
        return describe(expr);
      }
      if (!isFunction(expr)) return describe(expr);
      if (expr.operator === 'Block') {
        const saved = env;
        env = new Map(env);
        const locals = new Set<string>();
        blockDepth++;
        try {
          let result: OperandDescriptor | undefined;
          for (const op of expr.ops) {
            if (isFunction(op, 'Declare') && isSymbol(op.op1)) {
              locals.add(op.op1.symbol);
              // A `Declare` with a value types the local as its value, as
              // a first `Assign` does: `Declare(q, "unknown", v)` is the
              // declaration `q := v`. A `Declare` with no value (the
              // signature of a function that a definition statement of the
              // block defines) types the local `unknown`.
              const value = declaredValueOf(op.ops);
              if (value === undefined) {
                env.set(op.op1.symbol, describeType('unknown'));
                continue;
              }
              result = walk(value);
              if (!result) return undefined;
              env.set(op.op1.symbol, result);
              memo.clear();
              continue;
            }
            if (isFunction(op, 'Assign') && isSymbol(op.op1)) {
              if (
                !env.has(op.op1.symbol) ||
                (blockDepth > 1 && !locals.has(op.op1.symbol))
              )
                return undefined;
              result = walk(op.op2);
              if (!result) return undefined;
              env.set(op.op1.symbol, result);
              memo.clear();
              continue;
            }
            if (isFunction(op, 'Return'))
              return blockDepth === 1 && op.nops === 1
                ? walk(op.op1)
                : undefined;
            result = walk(op);
            if (!result) return undefined;
          }
          // A block whose last statement is an assignment or a declaration
          // has the value `Nothing`, not the value of the statement.
          const last = expr.ops[expr.ops.length - 1];
          if (isFunction(last, 'Assign') || isFunction(last, 'Declare'))
            return describeType('nothing');
          return result;
        } finally {
          blockDepth--;
          env = saved;
          memo.clear();
        }
      }
      if (
        (expr.operator === 'Sum' || expr.operator === 'Product') &&
        expr.nops === 2
      ) {
        const spec = expr.op2;
        if (
          (!isFunction(spec, 'Tuple') && !isFunction(spec, 'Limits')) ||
          !isSymbol(spec.op1)
        )
          return undefined;
        const saved = env;
        env = new Map(env);
        env.set(spec.op1.symbol, describeType('integer'));
        memo.clear();
        try {
          const body = walk(expr.op1);
          if (!body) return undefined;
          const t = derive(expr.operator, [body, describe(spec)]);
          return t === undefined ? undefined : describeType(t);
        } finally {
          env = saved;
          memo.clear();
        }
      }
      // A comprehension over `Element(i, source)` clauses: each index is
      // typed as an element of its source (a later clause sees the earlier
      // indexes), and the body is typed under those indexes. The
      // `Comprehension` type handler reads the body's type and nothing else.
      if (expr.operator === 'Comprehension' && expr.nops >= 2) {
        const saved = env;
        env = new Map(env);
        memo.clear();
        try {
          for (const clause of expr.ops.slice(1)) {
            if (
              !isFunction(clause, 'Element') ||
              clause.nops !== 2 ||
              !isSymbol(clause.op1)
            )
              return undefined;
            const source = walk(clause.op2);
            const element =
              source === undefined
                ? undefined
                : collectionElementType(source.type);
            if (element === undefined) return undefined;
            env.set(clause.op1.symbol, describeType(element));
            memo.clear();
          }
          const body = walk(expr.op1);
          if (!body) return undefined;
          const t = derive(expr.operator, [
            body,
            ...expr.ops.slice(1).map((x) => describe(x)),
          ]);
          return t === undefined ? undefined : describeType(t);
        } finally {
          env = saved;
          memo.clear();
        }
      }
      if (expr.operator === 'Typed') return walk(expr.op1);
      // A nested function literal (the callback of `Map(u ↦ 2u, a)`) that
      // reads no name of the walk (a parameter or a local of the outer
      // literal) is an operand of its own type, its signature: its body runs
      // when it is applied, and its `Return` statements and assignments are
      // its own. One that reads such a name (`u ↦ At(b, 1)` with `b` a
      // parameter) has a signature typed with that name at its declared or
      // inferred type, not at the type of the argument, so its result says
      // nothing about this call and the derivation stops.
      // The derivation also stops at a nested literal that calls a function
      // whose body is being walked (a recursive call in a callback). The
      // type of such a literal is cached, and it can have been computed while
      // the signature of that function was not yet derived, with the call
      // typed `unknown`. A join with `unknown` keeps only the other arm, so
      // the callback of `m := n ↦ Map(x ↦ If(x < 1, 0, m(x − 1)), [n])` was
      // typed `-> integer`, and `m(8)` was typed `list<integer | vector<1>>`
      // for the value `[[[[[[[[[0]]]]]]]]]` (CE-479). The call then keeps
      // the result of the signature, which the derivation of the signature
      // verifies (`verifiedListHypothesis`, `declared-parameter-result.ts`).
      if (expr.operator === 'Function')
        return readsAnyName(expr, env) || callsRunningLiteral(expr, running)
          ? undefined
          : describe(expr);
      if (
        expr.operatorDefinition?.scoped ||
        ['Assign', 'Declare', 'Return', 'Loop', 'Break', 'Continue'].includes(
          expr.operator
        )
      )
        return undefined;
      // A call whose head is a parameter or a local of the literal (a
      // function-valued parameter `h` in `(h, a) ↦ h(a)`) is not a call of
      // the function of that name in the engine's scope: nothing is known
      // about it here, and `derive` would read the global one.
      if (env.has(expr.operator)) return undefined;
      if (memo.has(expr)) return memo.get(expr);
      const children = expr.ops.map(walk);
      if (children.some((x) => x === undefined)) {
        // A failed child also settles this node in the current environment.
        memo.set(expr, undefined);
        return undefined;
      }
      const operands = children as OperandDescriptor[];
      // A call that reaches a function whose body is being derived (a
      // self-call, or a call of a mutually recursive function) has no
      // derived type: it is typed `unknown`. A join with `unknown` keeps
      // only the other arm, so a conditional with such a call as a branch
      // would be typed by its other branch alone: with
      // `f(n, s) = s if n == 0 else f(n - 1, [1, 2])`, `f(1, [0])` was typed
      // `vector<integer^1>`, and it evaluates to `[1, 2]`. So the derivation
      // stops there, and the call keeps its declared result.
      //
      // A branch typed `unknown` that has no structure stops the derivation
      // too. The `If` and `Which` handlers cannot tell such a branch from a
      // recursive call, so they leave it out of the join. But the call can
      // be a call of a function whose result type is settled as `unknown`,
      // or a call that reached a recursion in an earlier pass of this walk,
      // whose type a cache answers with no new decline. With
      // `f := n ↦ If(n = 0, 1/2, g(n − 1))` assigned before
      // `g := n ↦ If(n = 0, 2, f(n − 1))`, both are typed `-> unknown`, and
      // `g(1)` was typed `integer` by its other branch, for the value `1/2`
      // (CE-836).
      const stops = (x: OperandDescriptor): boolean =>
        recursive.has(x) ||
        (x.type === 'unknown' && x.structureOf === undefined);
      if (
        (expr.operator === 'If' && operands.slice(1).some(stops)) ||
        (expr.operator === 'Which' &&
          operands.some((x, i) => i % 2 === 1 && stops(x)))
      )
        return undefined;
      // A branch typed `error` is an error only when it is selected. A type
      // that holds an error and another value does not exist (the join of
      // `error` and `integer` is `error`), so a conditional with an `error`
      // branch and a branch that is not an error has no type here, and the
      // derivation stops. With `f(a, b) := If(b, a[1] + a[2], 42)`, the
      // value of `f(3, False)` is `42`, and the branch `3[1] + 3[2]` is
      // typed `error`. An `If` with no else branch, and a `Which` whose last
      // condition is not the literal `True`, also have an outcome that is
      // not written: when no branch is selected, the value is `Missing`.
      // That outcome is a branch that is not an error: with
      // `f(a, b) := If(b, a[1] + a[2])`, the value of `f(3, False)` is
      // `Missing`.
      if (expr.operator === 'If' || expr.operator === 'Which') {
        const branches = operands.filter((_, i) =>
          expr.operator === 'If' ? i > 0 : i % 2 === 1
        );
        const errors = branches.filter((x) => x.type === 'error').length;
        const noMatchOutcome =
          expr.operator === 'If'
            ? expr.nops < 3
            : expr.nops % 2 === 1 ||
              expr.nops < 2 ||
              !isSymbol(expr.ops[expr.nops - 2], 'True');
        if (errors > 0 && (errors < branches.length || noMatchOutcome))
          return undefined;
      }
      // An application over an ABSENT operand (a parameter typed `missing`,
      // or a value derived as absent) is typed as the evaluation of the body
      // answers it: `missing`. At evaluation, an operator that propagates
      // absence answers `Missing` (`absentScalarMarker`, `validate.ts`):
      // `Missing` is a result only, and an operator over it gives `Missing`.
      // The condition is the evaluation's (step 4a of `BoxedFunction.
      // evaluate`): no operand is a collection (beside one, the absence
      // lands in each cell through the operator's own kernel); a
      // broadcastable operator answers for an absent operand anywhere, any
      // other only for one at a position that strips `missing`
      // (`Contains(c, Missing)` runs its handler: a search for an absent
      // value finds nothing). An operator that handles or passes absence
      // through (a container such as `Tuple`, `IsMissing`, a user function)
      // is typed by its handler.
      const absentAt = (i: number) =>
        resolveTypeAlias(operands[i].type) === 'missing';
      const absentOperand = operands.some((_, i) => absentAt(i));
      if (absentOperand && !operands.some((x) => mayBroadcast(x.type))) {
        const def = expr.operatorDefinition as
          | {
              resolvedMissingBehavior: string;
              broadcastable: boolean;
              signature: { type: Type };
              stripsMissingAt?: (i: number) => boolean;
            }
          | undefined;
        if (
          def?.resolvedMissingBehavior === 'propagate' &&
          (def.broadcastable ||
            operands.some(
              (_, i) => absentAt(i) && def.stripsMissingAt?.(i) === true
            ))
        ) {
          const result = describeType('missing');
          memo.set(expr, result);
          return result;
        }
      }
      const callee = describeCallee(expr);
      const declines = recursionDeclines.get(engine) ?? 0;
      let t = deriveApplicationOf({ head: expr.operator, callee }, operands, {
        engine,
        derive,
      });
      if (callee !== undefined) {
        const binding =
          expr.valueDefinition !== undefined
            ? { value: expr.valueDefinition }
            : expr.operatorDefinition !== undefined
              ? { operator: expr.operatorDefinition }
              : undefined;
        if (binding !== undefined)
          t =
            callResultType(
              engine,
              expr.operator,
              operands,
              t ?? 'unknown',
              derive,
              binding
            ) ?? t;
      }
      // A list literal keeps its structure, with the descriptors of its
      // elements as derived here: the type of an enclosing list literal
      // then reads its rows, and `[[t, 1], [2, 3]]` with `t: integer` is a
      // `matrix<integer^(2x2)>`, not a `list<vector<integer^2>>`.
      const shape =
        t !== undefined && expr.operator === 'List'
          ? describe(expr).structureOf?.()
          : undefined;
      // A `Derivative` keeps its structure too: the type of an application
      // of it reads the head, because the derivative is a whole function
      // that maps over a list argument (`appliedCalleeMapType`, `core.ts`).
      // In `(a: list<real>) ↦ Apply(Derivative(b ↦ b^2), a)` applied to
      // `[1, 2]`, the call is a list, not a number.
      const result =
        t === undefined
          ? undefined
          : shape?.kind === 'list-literal'
            ? {
                ...describeType(t),
                structureOf: () => ({
                  kind: 'list-literal' as const,
                  shape: shape.shape,
                  elements: operands,
                }),
              }
            : expr.operator === 'Derivative'
              ? { ...describeType(t), structureOf: describe(expr).structureOf }
              : describeType(t);
      if (
        result !== undefined &&
        t === 'unknown' &&
        (recursionDeclines.get(engine) ?? 0) !== declines
      )
        recursive.add(result);
      memo.set(expr, result);
      return result;
    };
    // The arms: for every combination of the arguments that may be absent
    // (each one present or absent on its own), the body is typed with those
    // parameters typed as an absent value, and the results are joined. With
    // `(p, q) ↦ (p, q)` over two index reads, one absent and one present
    // gives a tuple with one absent coordinate, which neither the all-present
    // nor the all-absent arm contains. More than three such arguments (eight
    // combinations) is declined: the call keeps the declared result. An
    // argument typed `missing` (always absent) is absent in every arm.
    //
    // The parameter of an absent argument is typed as the call binds the
    // absent value. The type of the parameter is its annotation in the
    // literal, else its type in the declared signature of the function.
    // With no type, the absent value is bound as it is, so the parameter is
    // typed `missing`. At a numeric type the call is `Missing` whatever the
    // body (`apply()`, `function-utils.ts`), so the arm is `missing`, and
    // the same at a point (a tuple of numbers, `pointArity()`). At any other
    // type (a list, a string) the call is an `incompatible-type`
    // error, so a combination with an absent argument there gives no value
    // and adds nothing to the type. Before, the parameter was typed
    // `missing` in every case, and `f(P)` with
    // `f: (broadcastable<tuple<number, number>>) -> unknown`, the body
    // `a ↦ (a.x + 1, a.y + 1)` and `P: tuple<number, number> | missing` was
    // typed `tuple<missing, missing> | tuple<number, number>`.
    //
    // A parameter with a default value receives its default in place of an
    // absent argument, so it is typed as its annotation, else as the type
    // of the default.
    const absentType = (i: number): Type | 'call' | undefined => {
      const fallback = optionalParameterDefault(params[i]);
      if (fallback !== undefined)
        return functionLiteralParameterType(params[i]) ?? fallback.type.type;
      const annotation =
        functionLiteralParameterType(params[i]) ?? declaredParams?.[i];
      if (
        annotation === undefined ||
        annotation === 'unknown' ||
        isSubtype('missing', annotation)
      )
        return 'missing';
      if (
        isSubtype(annotation, 'number') ||
        pointArity(annotation) !== undefined
      )
        return 'call';
      return undefined;
    };
    // The type of the body when the arguments at `absentAt` are absent:
    // `null` when the call refuses one of them (no value, nothing to add),
    // `undefined` when the body gives no type.
    const armType = (
      absentAt: ReadonlySet<number>
    ): Type | undefined | null => {
      const types: Type[] = [];
      for (let i = 0; i < names.length; i++) {
        if (!absentAt.has(i)) {
          types.push(present[i]);
          continue;
        }
        const t = absentType(i);
        if (t === undefined) return null;
        if (t === 'call') return 'missing';
        types.push(t);
      }
      env = new Map(names.map((name, i) => [name, describeType(types[i])]));
      memo.clear();
      return walk(literal.op1)?.type;
    };
    const alwaysAbsent = args
      .map((a, i) => (resolveTypeAlias(a.type) === 'missing' ? i : -1))
      .filter((i) => i >= 0);
    const gated = args
      .map((a, i) =>
        !alwaysAbsent.includes(i) && presentPart(a.type) !== a.type ? i : -1
      )
      .filter((i) => i >= 0);
    // The declared result bounds the PRESENT values, so each arm is checked
    // against it with its `missing` arms stripped: `missing` is a subtype of
    // no values-only type.
    let result: Type | undefined;
    let declined = gated.length > 3;
    for (let mask = 0; !declined && mask < 1 << gated.length; mask++) {
      const absentAt = new Set([
        ...alwaysAbsent,
        ...gated.filter((_, j) => (mask >> j) & 1),
      ]);
      const arm = armType(absentAt);
      if (arm === null) continue;
      if (
        arm === undefined ||
        !isSubtype(stripMissingFromType(arm), declared)
      ) {
        declined = true;
        break;
      }
      result = result === undefined ? arm : widen(result, arm);
    }
    const refined =
      declined || result === undefined || result === 'never'
        ? undefined
        : result;
    // Repeated calls with literal argument types must not retain an unbounded
    // set of entries for one engine generation.
    if (results.size >= 256) results.delete(results.keys().next().value!);
    results.set(key, refined);
    let dependent = stackDependentResults.get(results);
    if (stackDependentAnswerCount() !== stackDependentBefore) {
      if (dependent === undefined) {
        dependent = new Set();
        stackDependentResults.set(results, dependent);
      }
      dependent.add(key);
    } else dependent?.delete(key);
    return refined;
  } finally {
    running.delete(literal);
  }
}

/** The unary functions that, applied to a numeric tuple, give the tuple of
 * their values at each component: `Sin((1, 2))` is `(Sin(1), Sin(2))`.
 * `Abs` is not one of them: `Abs((3, 4))` is the norm, `5`. Each was
 * checked by evaluation (`Floor((1.5, -2))` is `(1, -2)`). */
const COMPONENTWISE_UNARY = new Set([
  'Negate',
  'Sin',
  'Cos',
  'Tan',
  'Sec',
  'Csc',
  'Cot',
  'Arctan',
  'Sinh',
  'Cosh',
  'Tanh',
  'Exp',
  'Ln',
  'Sqrt',
  'Square',
  'Floor',
  'Ceil',
  'Round',
  'Truncate',
  'Sign',
]);

/** The operators whose value is a number for operands that are numbers,
 * tuples or lists: each reads the elements of a tuple or a list operand as
 * operands, at any depth. Checked by evaluation: `Max(1, (2, (5, 9)))` is
 * `9`, `Min(1, (2, 3))` is `1`, and `Max(1, (q, 3))` is the symbolic
 * `max(3, q)`, typed `number` (`componentwiseTupleCallType`). */
const TUPLE_FLATTENING_EXTREMA = new Set(['Max', 'Min']);

/**
 * Whether `Max`/`Min` read a number from an operand of type `t`: a number, a
 * collection of numbers, or a tuple whose coordinates are of these kinds. A
 * tuple whose coordinate types are known but can hold something else (a
 * `Measurement`, a dictionary, a string) is refused: `Max` over it gives that
 * value, an error or a symbolic `max(…)` that holds a string. A bare `tuple`
 * is accepted: it is the `tuple` arm of the open form
 * `number | tuple | list<…>` (ROADMAP CE-502), which stands for a point, a
 * tuple of numbers (user decision 2026-10-27, recorded in ROADMAP CE-545).
 */
function extremumReadsANumber(t: Readonly<Type>): boolean {
  if (t === 'tuple') return true;
  if (isSubtype(t, 'number') || isSubtype(t, 'collection<number>')) return true;
  if (typeof t === 'object' && t.kind === 'tuple')
    return t.elements.every((e) =>
      extremumReadsANumber(resolveTypeAlias(e.type))
    );
  return false;
}

/**
 * The type of a call of the function literal `literal` when exactly one
 * argument is a numeric tuple with `n` number components, the other
 * arguments are numbers, and the body computes the tuple component by
 * component: `tuple<number, …>` with `n` components. `undefined` when the
 * body has another form, and the caller keeps its answer (`any`).
 *
 * The body must be built from these forms only, where `P` is a form that
 * gives a tuple of `n` numbers and `S` is a number that does not read the
 * tuple parameter:
 *
 * - the tuple parameter;
 * - `Negate(P)` and a function of `COMPONENTWISE_UNARY` applied to `P`;
 * - `Multiply(S, …, P, …, S)`, with one `P` operand;
 * - `Add(P, …, P)` and `Subtract(P, P)`: every operand reads the same
 *   tuple, so the lengths agree;
 * - `Divide(P, S)`;
 * - `Power(P, k)` with a number literal `k ≥ 0`, and `Power(S, P)`.
 *
 * The other forms can fail or give a value of another shape: `x + 1` is an
 * `incompatible-type` error, `x·x` is the error `no-product-between-points`,
 * `2/x` and `x^(-1)` are the error `no-division-by-point`, and `|x|` is the
 * norm of the tuple.
 *
 * With `h := x ↦ 2x`, `h((1, 2))` is `(2, 4)`: the call is typed
 * `tuple<number, number>`, and it was typed `any` (ROADMAP CE-47). A
 * component of the value can be a complex number (`Sqrt((1, -2))`), an
 * infinity (`(1, 2)/0`) or `NaN`, which the type `number` holds.
 *
 * A body that is a call of `Max` or `Min` (`TUPLE_FLATTENING_EXTREMA`),
 * typed as a number, gives a number when each of its operands is a
 * parameter, or reads no parameter and is a number, and each argument is a
 * number, a collection of numbers or a tuple of these
 * (`extremumReadsANumber`): these operators read the elements of a tuple or
 * a list operand as operands, at any depth. An operand that computes on a
 * parameter (`Max(a, b + 1)`) is refused, because the arithmetic over a tuple
 * argument gives an error. With `S := (a, b) ↦ Max(a, b)`, `S(1, (2, 3))` is `3`, and the
 * call is typed `number`. A recursive call typed with the open form
 * `number | tuple | list<…>` (ROADMAP CE-502) is an argument of this kind
 * on its `tuple` arm, so `S(1, R(i − 1))` is not typed `any` (ROADMAP
 * CE-543). An argument that may be absent is not read here.
 */
export function componentwiseTupleCallType(
  literal: Expression | undefined,
  argTypes: ReadonlyArray<Type>
): Type | undefined {
  if (literal === undefined || !isFunction(literal, 'Function'))
    return undefined;
  const params = literal.ops.slice(1);
  if (params.length !== argTypes.length) return undefined;
  const names: string[] = [];
  for (const p of params) {
    if (isRestParameter(p) || isDestructuringParameter(p)) return undefined;
    const name = functionLiteralParameterName(p);
    if (!name) return undefined;
    names.push(name);
  }
  let root = literal.ops[0];
  while (isFunction(root, 'Block') && root.nops === 1) root = root.ops[0];
  if (
    isFunction(root) &&
    TUPLE_FLATTENING_EXTREMA.has(root.operator) &&
    isSubtype(root.type.type, 'number') &&
    root.ops.every(
      (op) =>
        (isSymbol(op) && names.includes(op.symbol)) ||
        (names.every((n) => !op.has(n)) && isSubtype(op.type.type, 'number'))
    ) &&
    argTypes.every((t) => extremumReadsANumber(resolveTypeAlias(t)))
  )
    return 'number';
  let tupleName: string | undefined;
  let arity = 0;
  for (let i = 0; i < argTypes.length; i++) {
    const t = resolveTypeAlias(argTypes[i]);
    if (isSubtype(t, 'number')) continue;
    if (
      tupleName !== undefined ||
      typeof t !== 'object' ||
      t.kind !== 'tuple' ||
      t.elements.length === 0 ||
      !t.elements.every((e) => isSubtype(e.type, 'number'))
    )
      return undefined;
    tupleName = names[i];
    arity = t.elements.length;
  }
  if (tupleName === undefined) return undefined;
  const scalarNames = new Set(names.filter((n) => n !== tupleName));
  const tuple = tupleName;
  // The form of `e`: 'point' for a tuple of `arity` numbers, 'scalar' for a
  // number that does not read the tuple parameter, `undefined` otherwise.
  const formOf = (e: Expression): 'point' | 'scalar' | undefined => {
    if (isSymbol(e)) {
      const s = e.symbol;
      if (s === tuple) return 'point';
      if (scalarNames.has(s)) return 'scalar';
      return isSubtype(e.type.type, 'number') ? 'scalar' : undefined;
    }
    if (!isFunction(e)) {
      return isSubtype(e.type.type, 'number') ? 'scalar' : undefined;
    }
    if (!e.has(tuple)) {
      // A number computed from the other parameters, which hold numbers.
      return isSubtype(e.type.type, 'number') ? 'scalar' : undefined;
    }
    const op = e.operator;
    const forms = e.ops.map(formOf);
    if (forms.some((f) => f === undefined)) return undefined;
    if (op === 'Block') return e.nops === 1 ? forms[0] : undefined;
    if (COMPONENTWISE_UNARY.has(op))
      return e.nops === 1 && forms[0] === 'point' ? 'point' : undefined;
    if (op === 'Multiply')
      return forms.filter((f) => f === 'point').length === 1
        ? 'point'
        : undefined;
    if (op === 'Add' || op === 'Subtract')
      return forms.every((f) => f === 'point') ? 'point' : undefined;
    if (op === 'Divide')
      return e.nops === 2 && forms[0] === 'point' && forms[1] === 'scalar'
        ? 'point'
        : undefined;
    if (op === 'Power' && e.nops === 2) {
      if (forms[0] === 'scalar' && forms[1] === 'point') return 'point';
      const k = e.ops[1];
      if (forms[0] === 'point' && isNumber(k) && k.isNonNegative === true)
        return 'point';
    }
    return undefined;
  };
  if (formOf(literal.ops[0]) !== 'point') return undefined;
  return {
    kind: 'tuple',
    elements: Array.from({ length: arity }, () => ({ type: 'number' })),
  };
}
