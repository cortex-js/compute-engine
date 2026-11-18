/**
 * The size rule of a compiled derivative application —
 * `Apply(Derivative(f, n), x)`, the parse of `f''(x)`.
 *
 * The symbolic route differentiates `f`'s body `n` times at COMPILE time and
 * compiles the closed form. That closed form multiplies out: each
 * differentiation applies the chain and product rules to every node of the
 * previous result, so for a composition such as
 * `√(x + √(x + √(x + √(x + x))))` the third derivative is a few hundred
 * kilobytes of MathJSON and takes tens of seconds to build and emit.
 *
 * `prefersJetDerivative()` tells the bodies whose closed form is of that
 * kind. The compiler (`ir/lower.ts`) declines such an application at an order
 * of 3 or more, before the closed form is asked for. The rule is named for
 * the forward-mode (Taylor-jet) lowering that a body of that size took in
 * the previous compiler.
 */

import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';

/**
 * Bodies at or below this many nodes keep the symbolic route. Their closed
 * forms stay small — the second derivative of `x² + 3x + 1` is the literal
 * `2` — and a closed form compiles to faster and more readable code than a
 * jet evaluation does. Above it the closed form is the shape that explodes:
 * the four-deep nested radical that motivated this lowering has a 14-node
 * body, and its third derivative is a 392 KB emitted expression.
 */
const JET_MIN_BODY_NODES = 10;

/** The number of nodes in `expr`, counted up to `cap` (then it stops). */
function nodeCount(expr: Expression, cap: number): number {
  let n = 1;
  if (isFunction(expr))
    for (const op of expr.ops) {
      if (n >= cap) return n;
      n += nodeCount(op, cap - n);
    }
  return n;
}

/**
 * Bodies with more nodes than this take the jet lowering at order ONE as
 * well. A single differentiation pass does not explode, but its closed form
 * still grows with the body — the first derivative of a twenty-deep nested
 * radical is a 376 KB kernel where the jet is 670 B — and past this size the
 * closed form is no longer the small, readable expression that makes the
 * symbolic route worth preferring.
 */
const JET_MIN_BODY_NODES_ORDER_ONE = 40;

/**
 * Whether the jet lowering is preferred over the symbolic closed form for
 * `Derivative(literal, order)`. Order 1 stays symbolic for a body of ordinary
 * size: one differentiation pass never explodes, and its closed form is the
 * exact expression callers expect to see emitted. A large body takes the jet
 * at order 1 too (`JET_MIN_BODY_NODES_ORDER_ONE`).
 */
export function prefersJetDerivative(
  literal: Expression,
  order: number
): boolean {
  if (order < 1) return false;
  if (!isFunction(literal, 'Function')) return false;
  const body = literal.ops[0];
  if (body === undefined) return false;
  const min = order < 2 ? JET_MIN_BODY_NODES_ORDER_ONE : JET_MIN_BODY_NODES;
  return nodeCount(body, min + 1) > min;
}
