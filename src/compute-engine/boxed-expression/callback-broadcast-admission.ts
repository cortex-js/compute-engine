/**
 * The BROADCAST admission of a collection value at a callback slot (user
 * ruling of 2026-09-22), together with the scalar-parameter test it is gated
 * on.
 *
 * Two routes judge a callback operand against the slot an operator declares
 * for it, and both need this admission:
 *
 * - the LAZY route, inside the operator's own canonical handler
 *   (`callbackCompatibilityError`, `library/collections.ts`), which serves
 *   `Map`, `Filter`, `Reduce` and the rest of the lazy callback family;
 * - the EAGER route, in signature validation (`arrowSlotAdmission`,
 *   `boxed-expression/validate.ts`), which serves `Sort`, `Ordering`,
 *   `GroupBy` and `ChunkBy`.
 *
 * The file is a leaf on purpose. `validate.ts` cannot import
 * `boxed-function.ts` — that module imports `validate.ts` — so the scalar
 * parameter test lives here and `paramsAreScalar` delegates to it.
 */

import { isSubtype, widen } from '../../common/type/subtype.js';
import { callbackIncompatibility } from '../../common/type/compatibility.js';
import {
  collectionElementType,
  resolveTypeAlias,
} from '../../common/type/utils.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import type { ListType, Type } from '../../common/type/types.js';
import { isTupleShapedType, mayCarryDimensions } from '../collection-utils.js';
import { isScalarType } from './function-literal.js';
import { substituteDeclaredBounds } from './generic-instantiation.js';
import {
  freeTypeVariables,
  inferTypeArguments,
  isPolymorphicType,
  substituteTypeVariables,
} from '../../common/type/instantiate.js';

/**
 * Does every parameter of the signature `sigType` bind a SCALAR — so that an
 * application over a collection argument broadcasts element-wise instead of
 * binding the collection whole?
 *
 * This is the type-only core of `paramsAreScalar`
 * (`boxed-expression/boxed-function.ts`), which adds the reading of an
 * operator definition's signature and delegates here.
 */
export function signatureParamsAreScalar(sigType: Type): boolean {
  if (typeof sigType === 'string') return true;
  // A multi-clause definition's signature is the INTERSECTION of its clause
  // arms (`((0) -> integer) & ((n: unknown) -> number)`). Its parameters are
  // scalar only if EVERY arm's are: one clause declaring a collection
  // parameter (`f(xs: list<number>) = …`) consumes the whole collection, so
  // no call may broadcast over it and hand that clause an element instead.
  if (sigType.kind === 'intersection')
    return sigType.types.every((t) => signatureParamsAreScalar(t));
  if (sigType.kind !== 'signature') return true;
  const args = [
    ...(sigType.args ?? []),
    ...(sigType.optArgs ?? []),
    ...(sigType.variadicArg ? [sigType.variadicArg] : []),
  ];
  // A QUANTIFIED parameter is read at its declared bound (§4.5): `T:
  // indexed_collection` can only ever denote a collection, so `(T) -> T` binds
  // its argument WHOLE exactly as the ground `(indexed_collection) -> …` does,
  // and no site may lift/thread over it. An unbounded variable keeps the scalar
  // default, and a ground signature (no `typeParams`) is untouched.
  return args.every((arg) => {
    const t = substituteDeclaredBounds(sigType.typeParams, arg.type);
    // A FUNCTION-typed parameter is a higher-order CALLBACK slot: its argument
    // is a function, never a collection, so it can never itself be broadcast
    // over — and it must not veto broadcasting of the OTHER parameters. This
    // predicate is all-or-nothing across the parameter list, so without the
    // exemption a single `(A) -> B` annotation silently switched off
    // broadcasting for every parameter of the function: `map(f, t.children)`
    // stopped mapping the moment `f` was annotated.
    //
    // The INFERENCE path already takes exactly this position — see
    // `inferredCollectionParameterType` (effects-inference.ts), which exempts
    // "a function-typed one (a higher-order callback slot)" so the
    // `broadcastable<T>` lift keeps firing. Before this, a DECLARED `(A) -> B`
    // parameter disagreed with an INFERRED one of the same shape.
    //
    // A COLLECTION-typed parameter deliberately still vetoes: it consumes a
    // whole collection, and suppressing the lift is what keeps a nested
    // collection argument from being descended into elementwise.
    if (isSubtype(t, 'function')) return true;
    return isScalarType(t);
  });
}

/** How many ranks of collection the element peel below may descend. A type
 * cannot nest deeper than this in practice, and the bound keeps a recursive
 * alias from looping. */
const MAX_ELEMENT_BROADCAST_RANK = 8;

/**
 * The type a value of type `t` reaches a SCALAR parameter as, once the
 * broadcast of a scalar-parameter function over a collection argument has
 * descended to the leaves, together with the number of ranks it descended
 * (`0` when `t` is not descended into at all).
 *
 * The descent stops where the run-time broadcast stops
 * (`isFiniteBroadcastParticipant`, `collection-utils.ts`): a tuple is an
 * atomic value bound whole, a string is a text atom rather than a list of
 * characters, and a non-indexed collection (a set) supplies no positions to
 * zip. Anything else with a readable element type is one rank of a broadcast.
 *
 * `budget` is the number of ranks this call may still descend. The depth
 * check of a union (`unionElementType`) calls this function again for each
 * arm, with a smaller budget, so a recursive alias such as
 * `R = list<R | list<integer>>` stops when the budget runs out instead of
 * recursing until the stack overflows.
 */
function broadcastLeafType(
  t: Type,
  budget: number = MAX_ELEMENT_BROADCAST_RANK
): { leaf: Type; rank: number } {
  let leaf = t;
  let rank = 0;
  while (rank < budget) {
    if (isTupleShapedType(leaf)) break;
    if (isSubtype(leaf, 'string')) break;
    if (!isSubtype(leaf, INDEXED_COLLECTION_SHAPE_TYPE)) break;
    const element =
      collectionElementType(leaf) ?? unionElementType(leaf, budget - rank - 1);
    if (element === undefined) break;
    leaf = element;
    rank += 1;
  }
  return { leaf, rank };
}

/** `t` without its `missing` arms: the one remaining arm, the union of the
 * remaining arms, or `t` itself when it has no `missing` arm. */
function withoutMissingArms(t: Type): Type {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string' || r.kind !== 'union') return r;
  const arms = r.types.filter((x) => x !== 'missing');
  if (arms.length === r.types.length) return r;
  return arms.length === 1 ? arms[0] : { kind: 'union', types: arms };
}

/**
 * The element type of a union of indexed collections (the caller has
 * checked that `t` is a subtype of the indexed collections): the widening of
 * the element types of its arms, or `undefined` when `t` is not a union or
 * an arm has no element type. A ragged list literal is typed with such a
 * union for its rows: the rows of `[[1, 4], [9]]` are
 * `vector<integer^1> | vector<integer^2>`, and `collectionElementType`
 * answers nothing for a union. Without this, the broadcast descent stopped
 * at the row, and `Map(Sqrt, [[1, 4], [9]])` was an `incompatible-type`
 * error, while `Map(Sqrt, [[1, 4], [9, 16]])` was admitted.
 *
 * `budget` is the number of ranks the depth check of each arm may descend
 * (see `broadcastLeafType`); with no budget left, the union is not descended
 * into.
 */
function unionElementType(t: Type, budget: number): Type | undefined {
  if (budget <= 0) return undefined;
  if (typeof t === 'string' || t.kind !== 'union') return undefined;
  const elements: Type[] = [];
  let rank: number | undefined;
  for (const arm of t.types) {
    // Each arm follows the rules of the descent for one type
    // (`broadcastLeafType`): a tuple arm and a string arm are atomic values,
    // bound whole, so a union with such an arm is not descended into.
    // `tuple<integer, integer> | tuple<integer, integer, integer>` stays a
    // point at a `(x: integer)` callback, which refuses it.
    if (
      isTupleShapedType(arm) ||
      isSubtype(arm, 'string') ||
      !isSubtype(arm, INDEXED_COLLECTION_SHAPE_TYPE)
    )
      return undefined;
    const e = collectionElementType(arm);
    if (e === undefined) return undefined;
    // The arms must reach the same broadcast depth: widened before their
    // depths are known, `list<integer> | list<list<integer>>` gave the
    // leaf `integer | list<integer>` at one rank, and the result of a
    // broadcast callback was typed without the nested lists of the deeper
    // arm. Arms of different depths are not descended into.
    const depth = broadcastLeafType(arm, budget).rank;
    if (rank === undefined) rank = depth;
    else if (depth !== rank) return undefined;
    elements.push(e);
  }
  return widen(...elements);
}

/** `t` with the result of every signature arm wrapped in `rank` list layers —
 * the type a callback answers once it is broadcast over an argument that is
 * `rank` collection ranks deep. */
function liftCallbackResultType(t: Type, rank: number): Type {
  if (typeof t === 'string') return t;
  if (t.kind === 'signature') {
    let result = t.result;
    for (let i = 0; i < rank; i++)
      result = { kind: 'list', elements: result } as ListType;
    return { ...t, result };
  }
  if (t.kind === 'union' || t.kind === 'intersection')
    return { ...t, types: t.types.map((x) => liftCallbackResultType(x, rank)) };
  return t;
}

/**
 * The result type of a call of a callback of signature `sigType` on one
 * element of type `element`, when the callback broadcasts over that element
 * (its parameters are all scalar, `signatureParamsAreScalar`, and the
 * element is a collection that the broadcast descends into,
 * `broadcastLeafType`): the declared result wrapped in one list per rank
 * descended. `undefined` when the call does not broadcast.
 *
 * `Map(f, [[1, 2], [3, 4, 5]])` with `f: (number) -> number` applies `f`
 * to each row, which broadcasts, so each element of the result is a list of
 * numbers. The admission above already reads the call this way; the type of
 * the `Map` must too, or it claims numbers for a list of lists.
 */
export function broadcastCallbackResultType(
  sigType: Type,
  element: Type
): Type | undefined {
  if (typeof sigType === 'string' || sigType.kind !== 'signature')
    return undefined;
  if (!signatureParamsAreScalar(sigType)) return undefined;
  const { leaf, rank } = broadcastLeafType(element);
  if (rank === 0) return undefined;
  // A leaf that is not a scalar type (`any`, `unknown`, `value`) can still
  // hold collections, and the run-time broadcast descends into them: with
  // `rows: list<list<any>>` holding `[[[1, 2]]]`, `Map(f, rows)` gives
  // `[[[2, 4]]]`, one level deeper than the descent counted. Declined, so
  // the existing derivation decides. A function leaf is an atomic value too:
  // the broadcast does not descend into it, and it reaches a parameter typed
  // as a function (a callback of a higher-order function).
  //
  // `isScalarType` accepts the top types, so they are tested here. A leaf
  // typed `unknown` is declined for the same reason as `any`: it can hold a
  // ragged list or a list of non-numeric values, so no fixed depth of the
  // result can be stated.
  const presentLeaf = withoutMissingArms(leaf);
  if (
    presentLeaf === 'any' ||
    presentLeaf === 'value' ||
    presentLeaf === 'expression' ||
    presentLeaf === 'unknown'
  )
    return undefined;
  if (!isScalarType(leaf) && !isSubtype(leaf, 'function')) return undefined;
  let signature: Type = sigType;
  // A polymorphic signature (`(T) -> T where T`, `(T) -> T where T:
  // number`) is applied to each leaf of the element, so its type variables
  // are bound to the leaf type before the result is lifted. Lifted as it
  // is, the result named `T` outside its quantifier, and boxing the type
  // threw `unresolved-type-variable`. Only a callback of one parameter is
  // read this way: the variables of several parameters need a solve.
  if (isPolymorphicType(sigType)) {
    const params = [...(sigType.args ?? []), ...(sigType.optArgs ?? [])];
    if (params.length !== 1 || sigType.variadicArg !== undefined)
      return undefined;
    // The leaf is the value of a type variable when the parameter is that
    // variable itself (`(T) -> T`). A parameter that mentions it in another
    // type (`((integer) -> T) -> T`) is solved against the leaf
    // (`inferTypeArguments`): with the leaf `(x) -> number`, `T` is
    // `number`. Another variable, unbound here, declines below when the
    // result names it.
    const parameter = params[0].type;
    let bindings: Record<string, Type> = Object.create(null);
    if (typeof parameter !== 'string' && parameter.kind === 'variable') {
      for (const p of sigType.typeParams ?? []) {
        if (p.name !== parameter.name) continue;
        // A leaf that breaks the declared bound (`where T: number` over
        // strings) cannot be the variable's value: the call is not read
        // here, and the existing call derivation decides.
        if (p.bound !== undefined && !isSubtype(leaf, p.bound))
          return undefined;
        bindings[p.name] = leaf;
      }
    } else {
      // A leaf that the solve refuses (a callback of another parameter
      // type, or a variable bound outside its declared bound) is declined,
      // and the existing call derivation decides.
      const solved = inferTypeArguments(sigType, [leaf]);
      if (solved === null) return undefined;
      bindings = { ...solved };
    }
    signature = {
      ...sigType,
      typeParams: undefined,
      result: substituteTypeVariables(sigType.result, bindings),
    };
  }
  if (typeof signature === 'string' || signature.kind !== 'signature')
    return undefined;
  if (freeTypeVariables(signature.result).size > 0) return undefined;
  // An unresolved result (`unknown`, or a top type) says nothing about the
  // leaf results: an inferred identity callback over rows of `list<any>`
  // keeps a nested `Missing`, which `list<unknown>` excludes. Declined, so
  // the fallback of `Map` for an unknown result decides.
  if (
    signature.result === 'unknown' ||
    signature.result === 'any' ||
    signature.result === 'expression'
  )
    return undefined;
  // An element that is a tensor with fixed lengths, with exactly the ranks
  // that the broadcast descends (`vector<((x) -> number)^1>`, a row of a
  // matrix of callbacks), gives a result with the same lengths, when the
  // result can be a cell of a tensor (`mayCarryDimensions`). A union that is
  // not a number type states no length, as for a list literal. Lifted with
  // plain lists, the `Map` of each row of a 1 by 1 matrix of callbacks was
  // typed `list<list<number>>` and not `matrix<number^(1x1)>`.
  const shape = resolveTypeAlias(element);
  const result = resolveTypeAlias(signature.result);
  if (
    typeof shape !== 'string' &&
    shape.kind === 'list' &&
    Array.isArray(shape.dimensions) &&
    shape.dimensions.length === rank &&
    shape.dimensions.every((n) => n >= 0) &&
    mayCarryDimensions(signature.result) &&
    (typeof result === 'string' ||
      result.kind !== 'union' ||
      isSubtype(result, 'number'))
  )
    return {
      kind: 'list',
      elements: signature.result,
      dimensions: [...shape.dimensions],
    };
  const lifted = liftCallbackResultType(signature, rank);
  return typeof lifted !== 'string' && lifted.kind === 'signature'
    ? lifted.result
    : undefined;
}

/**
 * The BROADCAST admission of a collection value at a callback slot (user
 * ruling of 2026-09-22): is the callback typed `opType` usable at a slot that
 * supplies the arguments `supply` states, once the broadcast a scalar-parameter
 * callback performs is taken into account?
 *
 * A callback whose parameters are all scalar broadcasts over a collection
 * argument instead of binding it whole — that is what `f([1, 2])` answers
 * `[2, 4]` for a `f: (number) -> number`. A callback POSITION is an
 * application too, so the same admission applies there: with the same `f`,
 * `Map(f, [[1, 2], [3, 4]])` applies `f` to each row, which broadcasts, and
 * answers `[[2, 4], [6, 8]]`. Before this ruling the check compared the row
 * type against the parameter type and reported `incompatible-type`.
 *
 * So each supply position is descended to its leaf and compared with the
 * parameter there, while the callback's own RESULT is lifted by the ranks
 * descended — a broadcast answers a collection of what the body answers. Both
 * halves matter:
 *
 * - The leaf comparison keeps a parameter the element can never reach out of
 *   the admission: a `(string) -> string` callback over `[[1, 2], [3, 4]]`
 *   still reports the error, because the leaf `integer` is disjoint from
 *   `string`.
 * - The lifted result keeps a slot that needs a SCALAR answer out of it:
 *   `Filter`'s predicate slot requires `boolean`, and a broadcast predicate
 *   answers `list<boolean>`, which is disjoint from it. That is the same
 *   verdict an untyped lambda already got at that slot, whose inferred result
 *   type is the list.
 *
 * `signatureParamsAreScalar` is the gate, the predicate the direct application
 * uses (`applyFunctionLiteral`, `boxed-expression/boxed-function.ts`): a
 * callback with a collection-, tuple- or `broadcastable<T>`-typed parameter
 * binds its argument whole and is therefore never admitted here.
 *
 * `elementPositions`, when given, marks which of the `args` positions carry a
 * SOURCE ELEMENT; a position it does not mark is left alone. The lazy route
 * uses it to keep a reducer's ACCUMULATOR out of the descent, because nothing
 * of the source comes out at that position. Omitting it descends every
 * position, which is sound in its own right: a scalar-parameter callback
 * broadcasts over ANY collection argument at application time, whatever the
 * operator supplies there, and the lifted result states what that broadcast
 * answers.
 */
export function broadcastAdmitsCollectionElement(
  supply: Type,
  opType: Type,
  elementPositions?: ReadonlyArray<boolean>
): boolean {
  if (typeof supply === 'string' || supply.kind !== 'signature') return false;
  if (!signatureParamsAreScalar(opType)) return false;
  if (admitsWholeSupply(supply, opType, elementPositions)) return true;
  // An element position whose type is a union (`matrix<integer> |
  // vector<integer>`, the elements of `Rest(p)` for
  // `p: broadcastable<matrix<integer>>`) holds a value of one arm: the
  // callback is admitted when it is admitted for each arm, directly or by
  // the broadcast. Read as one union, the leaf of the union was not found,
  // and `Product(Rest(p))` was an `incompatible-type` error for `Multiply`.
  // A union of tensors with a dimension list and numbers is read arm by
  // arm: each arm has a known rank. A union with plain list arms of
  // different depths (`list<integer> | list<list<integer>>`, the elements
  // of `Rest(p)` for `p: broadcastable<list<list<integer>>>`) is read arm
  // by arm only for a fold, a callback with a position that is not an
  // element (the accumulator of `Reduce` or `Fold`): the fold's result is
  // the accumulator, whose type the callback's lifted result does not
  // decide. A `Map` over such elements is still declined: its result type
  // would have no single depth.
  const isFold =
    elementPositions !== undefined && elementPositions.some((e) => e !== true);
  const isTensorOrNumber = (arm: Type): boolean => {
    const a = resolveTypeAlias(arm);
    if (typeof a !== 'string' && a.kind === 'list')
      return isFold || !!a.dimensions;
    return isSubtype(a, 'number');
  };
  // The union may also be below one or more list levels of the element: the
  // elements of a list of ragged lists, `[[M, v], [N, w]]` with `M`, `N`
  // matrices and `v`, `w` vectors, are typed `list<matrix<integer^(2x2)> |
  // vector<integer^1>>`. The broadcast descent stops at that union, because
  // its arms have different depths (`unionElementType`). Each arm is then
  // read inside the same list levels (`list<matrix<…>>`, `list<vector<…>>`).
  // Without this, `Product` of such a list was an `incompatible-type` error
  // for `Multiply`, while the product of its elements has a value.
  const unionArms = (t: Type): Type[] | undefined => {
    const u = resolveTypeAlias(t);
    if (typeof u === 'string' || u.kind !== 'union') return undefined;
    return u.types.every(isTensorOrNumber) ? u.types : undefined;
  };
  const armsAt = (t: Type): Type[] | undefined => {
    const top = unionArms(t);
    if (top !== undefined) return top;
    const { leaf, rank } = broadcastLeafType(t);
    if (rank === 0) return undefined;
    const arms = unionArms(leaf);
    if (arms === undefined) return undefined;
    return arms.map((arm) => {
      let wrapped = arm;
      for (let i = 0; i < rank; i++)
        wrapped = { kind: 'list', elements: wrapped } as ListType;
      return wrapped;
    });
  };
  let arms: Type[] | undefined;
  const unionAt = (supply.args ?? []).findIndex((arg, position) => {
    if (elementPositions !== undefined && elementPositions[position] !== true)
      return false;
    arms = armsAt(arg.type);
    return arms !== undefined;
  });
  if (unionAt !== -1 && arms !== undefined) {
    return arms.every((arm) => {
      const args = supply.args!.map((arg, i) =>
        i === unionAt ? { ...arg, type: arm } : arg
      );
      const armSupply = { ...supply, args };
      return (
        callbackIncompatibility(armSupply, opType) === undefined ||
        broadcastAdmitsCollectionElement(armSupply, opType, elementPositions)
      );
    });
  }
  return false;
}

/**
 * The admission of {@link broadcastAdmitsCollectionElement} for the supply
 * read as it is: each element position is descended to its leaf, and the
 * callback, with its result lifted by the ranks descended, is compared with
 * the supply.
 */
function admitsWholeSupply(
  supply: Extract<Type, { kind: 'signature' }>,
  opType: Type,
  elementPositions?: ReadonlyArray<boolean>
): boolean {
  let rank = 0;
  const peel = <T extends { type: Type }>(arg: T, position: number): T => {
    if (elementPositions !== undefined && elementPositions[position] !== true)
      return arg;
    const leaf = broadcastLeafType(arg.type);
    if (leaf.rank > rank) rank = leaf.rank;
    return { ...arg, type: leaf.leaf };
  };
  const args = supply.args?.map(peel);
  const nArgs = args?.length ?? 0;
  const optArgs = supply.optArgs?.map((arg, i) => peel(arg, nArgs + i));
  const variadicArg =
    supply.variadicArg === undefined
      ? undefined
      : peel(supply.variadicArg, nArgs + (optArgs?.length ?? 0));
  // Nothing was descended into: no broadcast happens, so there is nothing to
  // admit that the caller's own check did not already judge.
  if (rank === 0) return false;
  return (
    callbackIncompatibility(
      { ...supply, args, optArgs, variadicArg },
      liftCallbackResultType(opType, rank)
    ) === undefined
  );
}
