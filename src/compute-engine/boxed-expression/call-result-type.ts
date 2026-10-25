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
  collectionElementType,
  isWildcardFunctionType,
  resolveTypeAlias,
  stripMissingFromType,
} from '../../common/type/utils.js';
import { absentMarkerIsNumeric } from './validate.js';
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
  isRestParameter,
  isDestructuringParameter,
  isScalarType,
} from './function-literal.js';
import {
  isPointListArgumentType,
  isPointOrPointListArgumentType,
  isPointParameterType,
  isTupleShapedType,
} from '../collection-utils.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { signatureParamsAreScalar } from './callback-broadcast-admission.js';
import { isFunction, isSymbol } from './type-guards.js';

const cache = new WeakMap<
  IComputeEngine,
  {
    generation: number;
    literals: WeakMap<Expression, Map<string, Type | undefined>>;
  }
>();
const active = new WeakMap<IComputeEngine, Set<Expression>>();
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
 */
function declaredParameterTypes(
  binding: BoxedDefinition | undefined
): ReadonlyArray<Type> | undefined {
  if (!binding) return undefined;
  let sig: Type | undefined;
  if ('operator' in binding) {
    if (binding.operator.inferredSignature) return undefined;
    sig =
      binding.operator._validationSignature ??
      binding.operator.signature?.type;
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
  if (isScalarResult(declared)) return undefined;
  const literal = userFunctionLiteral(binding);
  if (
    !literal ||
    (args.some((x) => mayBroadcast(presentPart(x.type))) &&
      !bindsArgumentsWhole(binding, literal))
  )
    return undefined;
  return literalBodyResultType(
    engine,
    literal,
    args,
    declared,
    derive,
    declaredParameterTypes(binding)
  );
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
 */
export function partialApplicationType(
  binding: BoxedDefinition | undefined,
  types: ReadonlyArray<Type>,
  curried: Type
): Type {
  const sig = inferredPointSignature(binding);
  if (typeof sig !== 'object' || sig.kind !== 'signature') return curried;
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
  if (maps) return { kind: 'list', elements: curried };
  return maybe ? widen(curried, { kind: 'list', elements: curried }) : curried;
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
      bindsWholeAtInferredPoint(types[i], slots[i])
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
  return literal.type.type;
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
 * function literal, when its result is a scalar, when the signature is
 * generic (its instantiation types the call), when the literal maps over a
 * collection argument (its parameters are scalars: the mapping types the
 * call), and when an argument does not fit the type of its parameter, the
 * contract of the literal.
 */
export function appliedLiteralResultType(
  fn: OperandDescriptor,
  args: readonly OperandDescriptor[],
  declared: Type,
  derive: (head: string, args: readonly OperandDescriptor[]) => Type | undefined
): Type | undefined {
  if (isScalarResult(declared)) return undefined;
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
  const slots = [...(sig.args ?? []), ...(sig.optArgs ?? [])];
  for (let i = 0; i < args.length; i++) {
    const slot = slots[i]?.type;
    if (slot !== undefined && !isSubtype(presentPart(args[i].type), slot))
      return undefined;
  }
  const literal = describedFunctionLiteral(fn);
  if (!isFunction(literal, 'Function')) return undefined;
  // An applied literal in the body of another is typed by this function
  // again, and the walk of its body is not memoized across the different
  // argument types it meets. Beyond a depth of 8 the result type of the
  // literal is kept, which bounds the work.
  if (appliedLiteralDepth >= 8) return undefined;
  appliedLiteralDepth += 1;
  try {
    return literalBodyResultType(
      literal.engine,
      literal,
      args,
      declared,
      derive
    );
  } finally {
    appliedLiteralDepth -= 1;
  }
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
  derive: (head: string, args: readonly OperandDescriptor[]) => Type | undefined,
  // The parameter types of the declared signature of the called function,
  // when it has one (`declaredParameterTypes`). They decide, with the
  // annotations of the literal, how an absent argument is bound.
  declaredParams?: ReadonlyArray<Type>
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
    // scalar argument.
    if (
      t === 'unknown' ||
      t === 'any' ||
      t === 'value' ||
      (typeof t === 'object' &&
        (t.kind === 'broadcastable' ||
          (t.kind === 'union' &&
            !isSubtype(t, 'number') &&
            !isSubtype(t, 'boolean') &&
            !isSubtype(t, 'string'))))
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
  const key = [
    declared,
    ...args.map((x) => x.type),
    ...(declaredParams ?? []),
  ]
    .map((t) => typeToString(t))
    .join(';');
  if (results.has(key)) return results.get(key);
  running.add(literal);
  try {
    const memo = new Map<Expression, OperandDescriptor | undefined>();
    // The descriptors of the calls typed `unknown` because they reached a
    // recursion (see the test on `If` and `Which` below).
    const recursive = new WeakSet<OperandDescriptor>();
    let blockDepth = 0;
    const walk = (expr: Expression): OperandDescriptor | undefined => {
      if (isSymbol(expr)) return env.get(expr.symbol) ?? describe(expr);
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
              env.set(op.op1.symbol, describeType('unknown'));
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
      if (expr.operator === 'Function')
        return readsAnyName(expr, env) ? undefined : describe(expr);
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
      if (children.some((x) => x === undefined)) return undefined;
      const operands = children as OperandDescriptor[];
      // A call that reaches a function whose body is being derived (a
      // self-call, or a call of a mutually recursive function) has no
      // derived type: it is typed `unknown`. A join with `unknown` keeps
      // only the other arm, so a conditional with such a call as a branch
      // would be typed by its other branch alone: with
      // `f(n, s) = s if n == 0 else f(n - 1, [1, 2])`, `f(1, [0])` was typed
      // `vector<integer^1>`, and it evaluates to `[1, 2]`. So the derivation
      // stops there, and the call keeps its declared result.
      if (
        (expr.operator === 'If' &&
          operands.slice(1).some((x) => recursive.has(x))) ||
        (expr.operator === 'Which' &&
          operands.some((x, i) => i % 2 === 1 && recursive.has(x)))
      )
        return undefined;
      // An application over an ABSENT operand (a parameter typed `missing`,
      // or a value derived as absent) is typed as the evaluation of the body
      // answers it, not as the operator's type handler types a literal
      // `Missing` operand. At evaluation, an operator that propagates
      // absence answers the marker of its codomain read off the type of the
      // application AS WRITTEN in the body (`absentMarkerIsNumeric`,
      // `validate.ts`): `NaN` when that type is numeric, `Missing` otherwise.
      // The written type is fixed by the parameter's declared type: inside
      // `(p, s) ↦ (s·PointX(p), …)` with `p` inferred `collection<any> |
      // tuple`, `PointX(p)` is typed `unknown` and its absent value is
      // `Missing`, where the type handler of `PointX` over a literal
      // `Missing` says `number` (the top-level `PointX(Missing)` is `NaN`).
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
          const result = describeType(
            absentMarkerIsNumeric(expr.type.type, def.signature.type)
              ? 'number'
              : 'missing'
          );
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
    // At a numeric type the absent value is read as `NaN` (`apply()`,
    // `function-utils.ts`), so the parameter is typed `nan`. With no type,
    // or a type with a `missing` member, it is typed `missing`. At any other
    // type (a point, a list, a string) the call is an `incompatible-type`
    // error, so a combination with an absent argument there gives no value
    // and adds nothing to the type. Before, the parameter was typed
    // `missing` in every case, and `f(P)` with
    // `f: (broadcastable<tuple<number, number>>) -> unknown`, the body
    // `a ↦ (a.x + 1, a.y + 1)` and `P: tuple<number, number> | missing` was
    // typed `tuple<missing, missing> | tuple<number, number>`.
    const absentType = (i: number): Type | undefined => {
      const annotation =
        functionLiteralParameterType(params[i]) ?? declaredParams?.[i];
      if (
        annotation === undefined ||
        annotation === 'unknown' ||
        isSubtype('missing', annotation)
      )
        return 'missing';
      if (isSubtype(annotation, 'number')) return 'nan';
      return undefined;
    };
    // The type of the body when the arguments at `absentAt` are absent:
    // `null` when the call refuses one of them (no value, nothing to add),
    // `undefined` when the body gives no type. With `forBound`, an absent
    // argument is typed `missing` even where it is read as `NaN`, for the
    // check against the declared result below.
    const armType = (
      absentAt: ReadonlySet<number>,
      forBound: boolean
    ): Type | undefined | null => {
      const types: Type[] = [];
      for (let i = 0; i < names.length; i++) {
        if (!absentAt.has(i)) {
          types.push(present[i]);
          continue;
        }
        const t = absentType(i);
        if (t === undefined) return null;
        types.push(forBound ? 'missing' : t);
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
    // no values-only type. An argument that a numeric parameter reads as
    // `NaN` is typed `missing` for that check (with `f: (real) -> unknown`
    // and `a ↦ (a, 1)`, the inferred result is `tuple<real, integer>`, and
    // `f(Missing)` is `(NaN, 1)`, whose `nan` coordinate is outside it).
    let result: Type | undefined;
    let declined = gated.length > 3;
    for (let mask = 0; !declined && mask < 1 << gated.length; mask++) {
      const absentAt = new Set([
        ...alwaysAbsent,
        ...gated.filter((_, j) => (mask >> j) & 1),
      ]);
      const arm = armType(absentAt, false);
      if (arm === null) continue;
      const bound = [...absentAt].some((i) => absentType(i) === 'nan')
        ? armType(absentAt, true)
        : arm;
      if (
        arm === undefined ||
        bound === undefined ||
        bound === null ||
        !isSubtype(stripMissingFromType(bound), declared)
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
    return refined;
  } finally {
    running.delete(literal);
  }
}
