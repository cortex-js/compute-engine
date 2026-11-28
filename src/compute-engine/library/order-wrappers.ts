import { isLibraryOperator } from '../library-shadowing.js';
import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';

// The wrappers (`Sort`, `RandomShuffle`, `Reverse`, `Unique`) that an
// operator reads through when its result does not depend on the order of the
// elements. This module is separate from `collections.ts` so that
// `sets.ts`, which `collections.ts` imports, can read through them too.

// Canonical-time "peek" through eager collection wrappers that don't change
// the answer a consumer is about to read.
//
// Soundness: `Length`/`Count`/`IsEmpty` depend only on the multiset of
// elements, so any COUNT-PRESERVING wrapper (`Sort`, `RandomShuffle`, `Reverse`)
// can
// be stripped — the wrapped and unwrapped collections have the same number of
// elements, whether the operand is concrete or symbolic, evaluated or not.
// `Contains` depends only on the SET of elements, so it may additionally strip
// `Unique` (which drops duplicates but preserves membership). A source that
// can be a string is not stripped (see `peekWrappers`).
//
// Why it matters: consumers evaluate their operand first, so an EAGER wrapper
// (Sort/RandomShuffle) would materialize and reorder the whole collection before
// consumer reads a count/membership — e.g. `Count(Sort(Range(1,1e5)))` sorted
// 1e5 elements (~15s) only to discard the order. `Reverse` is lazy and cheap,
// but is included for structural uniformity (the same soundness argument
// applies); the real win is the eager wrappers.
//
// The strip keeps only the wrapper's first operand and drops any extra
// arguments (a `Sort` comparator) — by design, since those
// cannot change the count/membership. Loops to collapse nesting, e.g.
// `Count(Reverse(Sort(x))) → Count(x)`.
//
// Interaction with randomness, RULED (`docs/RANDOMNESS-MODEL.md` §5): stripping
// `RandomShuffle` means `Count(RandomShuffle(xs))` consumes ZERO draw indices,
// because the shuffle is never evaluated. That is correct — draw indices are
// consumed by evaluation and only by evaluation, exactly as an untaken `If`
// branch consumes none.
const COUNT_PRESERVING_WRAPPERS = ['Sort', 'RandomShuffle', 'Reverse'];
// The wrappers that require an indexed source (see `peekWrappers`).
const ORDER_WRAPPERS = ['Sort', 'RandomShuffle', 'Reverse'];
const MEMBERSHIP_PRESERVING_WRAPPERS = [
  'Sort',
  'RandomShuffle',
  'Reverse',
  'Unique',
];

function peekWrappers(
  op: Expression | undefined,
  wrappers: string[]
): Expression | undefined {
  let result = op;
  while (
    isFunction(result) &&
    wrappers.includes(result.operator) &&
    result.nops >= 1 &&
    // Only strip a wrapper whose own canonical form is valid. The operand
    // arriving here is already canonicalized, so an invalid wrapper argument
    // (e.g. a non-function `Sort` comparator) shows up as an error
    // subexpression. Stripping it would silently erase that static type error;
    // instead, stop peeking and let the validation path surface it.
    result.isValid &&
    // `Unique(xs, test)` drops the elements that the test relates to a kept
    // one, so it does not preserve membership.
    !(result.operator === 'Unique' && result.nops > 1) &&
    // `Sort`, `Reverse` and `RandomShuffle` accept only an indexed collection:
    // a set has no order, so `Sort(c)` with `c := Set(3, 1, 5)` is an
    // `incompatible-type` error. The static gate admits an operand whose type
    // only overlaps `indexed_collection` (`c` is checked when it is
    // evaluated), so stripping the wrapper from such an operand made
    // `Count(Sort(c))` answer `3` where `Sort(c)` is the error. Strip one of
    // these wrappers only when the type of its source is known to be an
    // indexed collection; otherwise the consumer evaluates the wrapper, which
    // sorts an untyped list to count it but reports the error for a set.
    (!ORDER_WRAPPERS.includes(result.operator) ||
      result.op1.type.matches('indexed_collection<any>')) &&
    // The elements of a string are its grapheme clusters, and a wrapper
    // returns a string whose clusters are formed again: a combining mark
    // moved after a letter joins it. So `Reverse` of the string U+0301 "a"
    // is "a" U+0301, one element where its source has two, and `Contains`
    // of it is false for "a". Strip a wrapper only when its source cannot
    // be a string.
    result.op1.type.isDisjointFrom('string')
  ) {
    result = result.op1;
  }
  return result;
}

// Strip count-preserving wrappers (Sort/RandomShuffle/Reverse) from `op`.
export const peekCountPreserving = (
  op: Expression | undefined
): Expression | undefined => peekWrappers(op, COUNT_PRESERVING_WRAPPERS);

// Strip membership-preserving wrappers (Sort/RandomShuffle/Reverse/Unique).
// NOTE: `Unique` is membership-preserving but NOT count-preserving, so it is
// only stripped for `Contains`, never for `Length`/`Count`/`IsEmpty`.
export const peekMembershipPreserving = (
  op: Expression | undefined
): Expression | undefined => peekWrappers(op, MEMBERSHIP_PRESERVING_WRAPPERS);

/**
 * The collection that an operator reads when its result does not depend on
 * the order of the elements (a sum, a product, an extremum, the count of a
 * value): `value`, or the source of `value` when `value` is a `Sort`,
 * `Reverse` or `RandomShuffle` that is not a collection.
 *
 * An evaluated `Sort` that cannot order its elements, `Sort([3, x, 1])` for
 * a variable `x`, stays a `Sort` call, and that call has no elements to
 * read. Its source has the same elements, so the sum of the source is the
 * sum of the sorted list. A wrapper is removed under the conditions of
 * `peekWrappers`, and only when its source is a collection: otherwise the
 * operator keeps the call as written.
 *
 * A lazy `Reverse` over such a call, `Reverse(Sort([3, x, 1]))`, is a
 * collection with no elements to read either, so its wrappers are removed
 * too. A view whose every wrapper is a collection is kept: its elements can
 * be read, and its order is the order of the walk.
 *
 * An operator whose result depends only on the set of the elements (a test
 * of membership) gives `peekMembershipPreserving` as `peek`, so that it also
 * reads through a `Unique` over such a `Sort`.
 */
export function orderIndependentSource(
  value: Expression,
  peek: (op: Expression) => Expression | undefined = peekCountPreserving
): Expression {
  const source = peek(value);
  if (source === undefined || source === value || !source.isCollection)
    return value;
  // The wrappers between `value` and `source` are a chain of first
  // operands. One of them that is not a collection has no elements, and no
  // view over it has any. Each wrapper must be the library operator: a user
  // `Sort` need not keep the elements of its source.
  let readable = true;
  for (let layer = value; layer !== source && isFunction(layer);) {
    if (!isLibraryOperator(layer)) return value;
    if (!layer.isCollection) readable = false;
    layer = layer.op1;
  }
  return readable ? value : source;
}
