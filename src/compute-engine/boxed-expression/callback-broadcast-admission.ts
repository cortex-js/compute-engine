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

import { isSubtype } from '../../common/type/subtype.js';
import { callbackIncompatibility } from '../../common/type/compatibility.js';
import { collectionElementType } from '../../common/type/utils.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import type { ListType, Type } from '../../common/type/types.js';
import { isTupleShapedType } from '../collection-utils.js';
import { isScalarType } from './function-literal.js';
import { substituteDeclaredBounds } from './generic-instantiation.js';

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
 */
function broadcastLeafType(t: Type): { leaf: Type; rank: number } {
  let leaf = t;
  let rank = 0;
  while (rank < MAX_ELEMENT_BROADCAST_RANK) {
    if (isTupleShapedType(leaf)) break;
    if (isSubtype(leaf, 'string')) break;
    if (!isSubtype(leaf, INDEXED_COLLECTION_SHAPE_TYPE)) break;
    const element = collectionElementType(leaf);
    if (element === undefined) break;
    leaf = element;
    rank += 1;
  }
  return { leaf, rank };
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
