import type { NamedElement, Type } from '../../common/type/types.js';
import { isInternedType } from '../../common/type/intern.js';
import { narrow, resolveTypeAlias } from '../../common/type/utils.js';

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
 * The rule does not apply when `current` is not an index-read tuple, when
 * `param` is not a tuple, is itself an index-read tuple or is not longer
 * than `current` (the ordinary narrowing handles a tuple of the same
 * length), or when a component of the reads has no common value with the
 * component of `param` (the call is then an error, as for any other
 * conflict).
 */
export function indexReadTupleExtension(
  current: Type,
  param: Type
): Type | undefined {
  if (typeof current !== 'object' || current.kind !== 'tuple') return undefined;
  if (!isIndexReadTuple(current)) return undefined;
  const p = resolveTypeAlias(param);
  if (typeof p !== 'object' || p.kind !== 'tuple' || isIndexReadTuple(p))
    return undefined;
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
