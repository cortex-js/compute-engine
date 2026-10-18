import type { NamedElement, TupleType, Type } from '../../common/type/types.js';
import { isInternedType } from '../../common/type/intern.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { reduceType } from '../../common/type/reduce.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  collectionElementType,
  narrow,
  resolveTypeAlias,
} from '../../common/type/utils.js';

/**
 * The tuple types that only the index reads of a bare function parameter
 * made.
 *
 * Index reads such as `p[1] + p[2]` type a bare parameter `p` as
 * `tuple<number, number>` (`parameterIndexReadType()` in
 * `library/collections.ts`), but they do not prove that the argument is a
 * tuple of that length: a list of three numbers is read correctly too. A
 * call such as `g(p)` with `g: (tuple<number, number>) -> number`, or an
 * annotation, does prove it. So a FREE symbol passed at the slot of such a
 * parameter learns one element type when the tuple came from index reads
 * only (`indexed_collection<number>`, user decision of 2026-10-15), and the
 * tuple itself otherwise (`oneElementTypeOf()` in `boxed-expression/box.ts`).
 *
 * The origin is recorded on the type OBJECT. The parameter's definition
 * stores the object that the index reads made, and the inferred signature
 * of the function literal uses that same object for the parameter's slot, so
 * the mark reaches the slot with no other bookkeeping. A parameter that
 * forwards its argument (`q ↦ h(q)`) receives the same object from the slot
 * of `h`, so it keeps the index-read origin too.
 *
 * Any other write gives the parameter a different object, which has no mark:
 * a call that narrows the components, or a call whose tuple requirement the
 * type already meets (the narrow write then stores a copy, see
 * {@link contractTupleOfNarrow}).
 *
 * An interned type (`common/type/intern.ts`) is shared by every type with
 * the same spelling, so a mark on it would reach types that index reads did
 * not make. A marked object that was interned later counts as unmarked: the
 * free symbol then learns the tuple, which is the type the slot states.
 */
const INDEX_READ_TUPLES = new WeakSet<object>();

/** Record that the tuple type `t` was made by index reads only. Returns `t`. */
export function markIndexReadTuple(t: Type): Type {
  if (typeof t === 'object' && t.kind === 'tuple') INDEX_READ_TUPLES.add(t);
  return t;
}

/** True when `t` is a tuple type that index reads only made. */
export function isIndexReadTuple(t: Readonly<Type>): boolean {
  return (
    typeof t === 'object' &&
    t.kind === 'tuple' &&
    INDEX_READ_TUPLES.has(t) &&
    !isInternedType(t)
  );
}

/**
 * The type that a narrow write with the requirement `requirement` stores,
 * given the meet `t` of the current type and the requirement.
 *
 * When the requirement is a tuple that index reads did not make (a call such
 * as `g(p)` with a `tuple<number, number>` parameter), the result is a
 * contract. `narrow` returns the current object when the requirement adds
 * nothing, and that object can carry the index-read mark, so a copy without
 * the mark is returned instead. Without the copy, the origin would depend on
 * the order of the uses: `p ↦ {p[1] + p[2]; g(p)}` would keep the index-read
 * origin, and `p ↦ {g(p); p[1] + p[2]}` would not.
 *
 * A requirement that is itself an index-read tuple (a parameter `q` passed to
 * a function `h` whose slot index reads made) proves nothing more, and the
 * mark stays.
 */
export function contractTupleOfNarrow(t: Type, requirement: Type): Type {
  if (typeof t !== 'object' || t.kind !== 'tuple' || !isIndexReadTuple(t))
    return t;
  const r = resolveTypeAlias(requirement);
  if (typeof r !== 'object' || r.kind !== 'tuple' || isIndexReadTuple(r))
    return t;
  return { ...t };
}

/**
 * The index-read tuples that `current` holds, and its other members: the
 * tuple itself when `current` is an index-read tuple, or the marked tuple
 * members of a union with at least one (the type a parameter takes after a
 * union collection slot, `indexReadTupleAtCollectionSlot`). `undefined` when
 * `current` holds no index-read tuple: the two index-read rules do not apply.
 */
function indexReadMembers(
  current: Type
): { marked: TupleType[]; others: Type[] } | undefined {
  if (typeof current !== 'object') return undefined;
  if (current.kind === 'tuple')
    return isIndexReadTuple(current)
      ? { marked: [current], others: [] }
      : undefined;
  if (current.kind !== 'union') return undefined;
  const marked: TupleType[] = [];
  const others: Type[] = [];
  for (const m of current.types) {
    if (typeof m === 'object' && m.kind === 'tuple' && isIndexReadTuple(m))
      marked.push(m);
    else others.push(m);
  }
  return marked.length === 0 ? undefined : { marked, others };
}

/**
 * The union of `types` as a parameter type: the one type when there is one,
 * else the reduced union (`reduceType`: duplicates and subsumed members
 * dropped, members sorted). The reducer rebuilds each member, so the
 * index-read mark of a tuple in `marked` is put back on the member that
 * spells it.
 */
function unionOfResults(types: Type[], marked: ReadonlyArray<Type>): Type {
  if (types.length === 1) return types[0];
  const reduced = reduceType({ kind: 'union', types });
  const remark = (t: Type): Type =>
    typeof t === 'object' &&
    t.kind === 'tuple' &&
    marked.some((f) => isSubtype(f, t) && isSubtype(t, f))
      ? markIndexReadTuple(t)
      : t;
  if (typeof reduced === 'object' && reduced.kind === 'union')
    reduced.types.forEach(remark);
  return remark(reduced);
}

/**
 * The type that a parameter whose current type `current` is an index-read
 * tuple takes at a call that requires the LONGER tuple `param`, or
 * `undefined` when the rule does not apply.
 *
 * Index reads do not prove the length of the argument, so a call such as
 * `g(p)` with `g: (tuple<number, number>) -> number` after the single read
 * `p[1] + 1` is not a conflict: the call proves the length. The result has
 * the components of `param`, each narrowed by the component that the reads
 * gave at the same position (an `unknown` component takes the component of
 * `param`). It is a contract, so it carries no index-read mark.
 *
 * When `current` is the union a union collection slot stored
 * (`indexReadTupleAtCollectionSlot`), each index-read tuple member is
 * extended, and the other members are kept only when `param` admits them:
 * after `g(p)` with `g: (indexed_collection<integer> | list<real>) ->
 * number` stored `list<real> | tuple<integer, integer>`, the call `h(p)`
 * with `h: (tuple<integer, integer, integer>) -> number` gives
 * `tuple<integer, integer, integer>`, as it did before the slot kept the
 * list alternative.
 *
 * The rule does not apply when `current` holds no index-read tuple, when
 * `param` is not a tuple, is itself an index-read tuple or is not longer
 * than every index-read tuple of `current` (the ordinary narrowing handles
 * a tuple of the same length), or when a component of the reads has no
 * common value with the component of `param` (the call is then an error,
 * as for any other conflict).
 */
export function indexReadTupleExtension(
  current: Type,
  param: Type
): Type | undefined {
  const members = indexReadMembers(current);
  if (members === undefined) return undefined;
  const p = resolveTypeAlias(param);
  if (typeof p !== 'object' || p.kind !== 'tuple' || isIndexReadTuple(p))
    return undefined;
  const results: Type[] = [];
  for (const tuple of members.marked) {
    const extended = extendIndexReadTuple(tuple, p);
    if (extended !== undefined) results.push(extended);
  }
  if (results.length === 0) return undefined;
  for (const other of members.others)
    if (isSubtype(other, param)) results.push(other);
  return unionOfResults(results, []);
}

/** The extension of the one index-read tuple `current` to the longer tuple
 * `p` (see `indexReadTupleExtension`), or `undefined`. */
function extendIndexReadTuple(
  current: TupleType,
  p: TupleType
): Type | undefined {
  if (p.elements.length <= current.elements.length) return undefined;
  const elements: NamedElement[] = [];
  for (const [i, e] of p.elements.entries()) {
    const read = current.elements[i]?.type;
    const type =
      read === undefined || read === 'unknown' ? e.type : narrow(read, e.type);
    if (type === 'never') return undefined;
    elements.push({ ...e, type });
  }
  return { kind: 'tuple', elements };
}

/**
 * The type that a parameter whose current type `current` is an index-read
 * tuple takes at a slot that requires a collection that is not a tuple
 * (`Drop(p, 2)` requires `indexed_collection<number> | string`), or
 * `undefined` when the rule does not apply.
 *
 * `p[2] + 1` types `p` as `tuple<unknown, number>`, and a tuple with an
 * `unknown` component is not a subtype of `indexed_collection<number>`, so
 * every collection operator refused the parameter (issue #448). Index reads
 * prove neither the length of the argument nor the type of the components
 * they did not read, so a collection requirement is not a conflict with
 * them. The parameter takes the tuple whose unread components are the
 * required element type and whose read components are narrowed by it, when
 * that tuple satisfies the slot; it keeps the index-read mark, so later
 * reads are still recorded per index. When the slot requires a collection
 * constructor that a tuple is not (`list<number>`), the parameter takes the
 * required arm itself, as a parameter typed `indexed_collection<number>`
 * narrows to it; the per-index types are then lost, as after a read at an
 * index that is not a literal.
 *
 * When more than one arm of a union requirement admits the parameter
 * (`indexed_collection<integer> | list<real>` after `p[2] + 1`), the result
 * is the union of the types each arm gives (`tuple<integer, integer> |
 * list<real>`), so the choice does not depend on the order of the arms and
 * a later use that requires one of them is still admitted. Each filled
 * tuple is checked against its own arm, and an arm that a tuple does not
 * satisfy contributes the arm itself. The union is reduced and the
 * index-read mark is put back on each tuple member (`unionOfResults`).
 *
 * When `current` is already such a union, each index-read tuple member is
 * filled at the arms, and the other members are kept when the requirement
 * admits them (a member it does not admit is dropped, as a narrowing drops
 * it). A parameter typed by a union is not a tuple, so a later read at an
 * index is not recorded per index.
 *
 * The rule does not apply when `current` holds no index-read tuple, when
 * no arm of the requirement is an indexed collection other than a tuple or a
 * string with a known element type, or when a read component has no common
 * value with the required element type (the use is then an error, as for any
 * other conflict).
 */
export function indexReadTupleAtCollectionSlot(
  current: Type,
  param: Type
): Type | undefined {
  const members = indexReadMembers(current);
  if (members === undefined) return undefined;
  const p = resolveTypeAlias(param);
  const arms = typeof p === 'object' && p.kind === 'union' ? p.types : [p];
  const filledTuples: Type[] = [];
  const results: Type[] = [];
  for (const tuple of members.marked) {
    for (const arm of arms) {
      const a = resolveTypeAlias(arm);
      if (typeof a === 'object' && a.kind === 'tuple') continue;
      if (!isSubtype(a, INDEXED_COLLECTION_SHAPE_TYPE)) continue;
      if (isSubtype(a, 'string')) continue;
      const elt = collectionElementType(a);
      if (elt === undefined) continue;
      const elements: NamedElement[] = [];
      let conflict = false;
      for (const e of tuple.elements) {
        const type = e.type === 'unknown' ? elt : narrow(e.type, elt);
        if (type === 'never') {
          conflict = true;
          break;
        }
        elements.push({ ...e, type });
      }
      if (conflict) continue;
      const filled = markIndexReadTuple({ kind: 'tuple', elements });
      if (isSubtype(filled, a)) {
        filledTuples.push(filled);
        results.push(filled);
      } else results.push(a);
    }
  }
  if (results.length === 0) return undefined;
  for (const other of members.others)
    if (isSubtype(other, param)) results.push(other);
  return unionOfResults(results, filledTuples);
}
