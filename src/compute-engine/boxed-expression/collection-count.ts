import type { Expression } from '../global-types.js';

/**
 * Put a collection count in its public form.
 *
 * The `count` of a collection is a `number` or a `bigint`. A `bigint` is used
 * only for a finite count that is NOT a safe integer (larger than
 * `Number.MAX_SAFE_INTEGER`), because a `number` cannot hold that count
 * exactly. A count that is a safe integer is always a `number`, and an
 * infinite count is `Infinity` (a `number`).
 *
 * A `count` collection handler can return a `bigint` for any count. The
 * `count` getters call this function, so a small `bigint` from a handler
 * becomes a `number` and every reader of `expr.count` can rely on the rule
 * above.
 */
export function normalizeCount(
  count: number | bigint | undefined
): number | bigint | undefined {
  if (typeof count !== 'bigint') return count;
  if (
    count <= BigInt(Number.MAX_SAFE_INTEGER) &&
    count >= -BigInt(Number.MAX_SAFE_INTEGER)
  )
    return Number(count);
  return count;
}

/**
 * The count of `expr` as a `number`, or `undefined` when the count is not
 * known or is a `bigint` (a finite count that is not a safe integer).
 *
 * Use this function, not `expr.count`, when the count is used in arithmetic,
 * as an index, as a loop bound, with `Math.min()`/`Math.max()` or to allocate
 * an array. JavaScript throws a `TypeError` when an expression mixes a
 * `bigint` and a `number`, and a count that large cannot be walked or
 * allocated. For these readers, a very large count is the same as an unknown
 * count.
 *
 * A reader that only compares the count (`count === 0`, `count > limit`) can
 * read `expr.count` directly: a comparison between a `bigint` and a `number`
 * is valid in JavaScript and gives the mathematically correct answer.
 */
export function smallCount(expr: Expression): number | undefined {
  const count = expr.count;
  return typeof count === 'bigint' ? undefined : count;
}

/**
 * True when `count` is a finite count: a finite `number` or a `bigint`.
 *
 * Use this function, not `Number.isFinite()`, to test a collection count:
 * `Number.isFinite()` returns `false` for every `bigint`, so a very large
 * finite collection would read as infinite.
 */
export function isFiniteCount(count: number | bigint | undefined): boolean {
  return typeof count === 'bigint' || Number.isFinite(count);
}
