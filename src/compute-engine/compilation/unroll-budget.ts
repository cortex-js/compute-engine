import type { Expression } from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';

/**
 * The size limit on the unrolled form of a `Sum` or `Product`, shared by the
 * JavaScript, interval and GPU targets.
 *
 * Each target unrolls a clause of at most 100 terms (its own term limit), but
 * each term holds a copy of the body, and a body that holds an unrolled big
 * operator of its own multiplies again. Without a limit on the total,
 * `Σ_{a=1}^{60} Σ_{b=1}^{60} Σ_{c=1}^{60}` emitted 216,000 terms (18 MB of
 * JavaScript, 12.7 s to compile), and a body whose subtree is shared under a
 * `Sum` and a `Product` of two terms each emitted four copies of that subtree
 * per level of sharing (55 s at 10 levels, ROADMAP CE-458). A clause above
 * the limit is emitted as a loop, which holds the body once.
 */

/**
 * Maximum number of expression nodes that the terms of one unrolled clause
 * may hold in total, as `unrolledTermSize` counts them.
 */
export const MAX_UNROLLED_NODES = 10_000;

/**
 * The term limit of one clause that the estimate assumes for a NESTED clause.
 * It is the term limit of every target that reads this module.
 */
const NESTED_TERM_LIMIT = 100;

/**
 * Whether a clause of `termCount` terms, each of `termSize` nodes, is
 * unrolled: at most `termLimit` terms, and at most `MAX_UNROLLED_NODES` nodes
 * in all.
 */
export function unrollFits(
  termCount: number,
  termSize: number,
  termLimit = NESTED_TERM_LIMIT
): boolean {
  return termCount <= termLimit && termCount * termSize <= MAX_UNROLLED_NODES;
}

/**
 * The number of terms of a `Limits` clause, for the estimate: the term count
 * when both bounds are number literals, read with the `Math.floor` that the
 * targets apply (`BaseCompiler.bigOpBoundConstant`); `'unknown'` when a bound
 * is not a literal; `undefined` for a clause that is not a `Limits` clause or
 * has a non-finite bound, which no target unrolls.
 *
 * The estimate does not read the value of a bound that is not a literal, so
 * that its result depends on the node alone and can be kept per node.
 */
function literalTermCount(clause: Expression): number | 'unknown' | undefined {
  if (!isFunction(clause, 'Limits') || clause.ops.length < 3) return undefined;
  const [, lower, upper] = clause.ops;
  if (!isNumber(lower) || !isNumber(upper)) return 'unknown';
  const lo = lower.re;
  const hi = upper.re;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
  return Math.floor(hi) - Math.floor(lo) + 1;
}

/** The answers of `unrolledSize`, by node. An answer depends only on the
 * node. */
const unrolledSizeMemo = new WeakMap<Expression, number>();

/**
 * An estimate of the number of nodes a target writes for `node`, when every
 * nested `Sum`/`Product` clause that fits `unrollFits` is unrolled. A subtree
 * reached through several parents is counted once for each parent, because
 * the target writes it once for each. The answers are kept per node, so the
 * estimate takes time linear in the number of distinct nodes.
 */
function unrolledSize(node: Expression): number {
  const cached = unrolledSizeMemo.get(node);
  if (cached !== undefined) return cached;
  let size = 1;
  if (
    isFunction(node) &&
    (node.operator === 'Sum' || node.operator === 'Product') &&
    node.ops.length >= 2
  )
    size += unrolledTermSize(node.ops[0], node.ops.slice(1));
  else if (isFunction(node))
    for (const op of node.ops) size += unrolledSize(op);
  unrolledSizeMemo.set(node, size);
  return size;
}

/**
 * The estimated size of ONE term of a clause whose body is `body` and whose
 * nested clauses are `clauses`, outermost first (empty when the term is the
 * body): the size of the body, multiplied by the term count of each nested
 * clause that is unrolled.
 */
export function unrolledTermSize(
  body: Expression,
  clauses: ReadonlyArray<Expression> = []
): number {
  let size = unrolledSize(body);
  for (let i = clauses.length - 1; i >= 0; i--) {
    const loopSize = size + unrolledSize(clauses[i]);
    const n = literalTermCount(clauses[i]);
    if (n === 'unknown') {
      // A target can fold a bound that is not a literal (a symbol with a
      // constant value, `Length(L)`) and then unroll the clause. The
      // estimate cannot know that value, so it takes the largest size that
      // the clause can have: the most terms that `unrollFits` accepts, or
      // the loop. This can only make an enclosing clause a loop more often.
      const maxTerms = Math.min(
        NESTED_TERM_LIMIT,
        Math.floor(MAX_UNROLLED_NODES / size)
      );
      size = Math.max(loopSize, maxTerms * size);
      continue;
    }
    if (n !== undefined && n >= 1 && unrollFits(n, size)) size *= n;
    else size = loopSize;
  }
  return size;
}
