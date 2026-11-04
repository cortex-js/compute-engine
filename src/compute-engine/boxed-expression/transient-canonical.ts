import type { Expression, Scope } from '../global-types.js';

/** The canonical forms of one `canonical` read, by raw node, each with the
 * lexical scope that was current when it was made (see `memo`). */
export type CanonicalReadMemo = Map<
  Expression,
  { scope: Scope; result: Expression }
>;

/**
 * The canonical forms that the CURRENT top-level `canonical` read of a raw
 * node made, by raw node, each with the lexical scope that was current when
 * it was made. `undefined` when no `canonical` read is in progress. The
 * `canonical` getter of `BoxedFunction` reads and writes it
 * (`boxed-function.ts`).
 *
 * The `canonical` getter of a raw node rebuilds it from its operands, and
 * each operand is canonicalized through its own getter. A raw node that is
 * an operand more than once (`Pair(t, t)`, with `t` built the same way at
 * each level) was canonicalized once for each path from the root, so the
 * canonical form was a tree with a number of nodes exponential in the depth.
 * A function literal with such a raw body of depth 24 took 4.9 s to
 * canonicalize; with this map, 1.8 ms.
 *
 * A raw node that the read meets again is given the canonical form it got
 * the first time, if the lexical scope is the same: the canonical form of a
 * raw node depends on the scope that resolves its names, and an occurrence
 * below a binder (the index of a `Sum`) is canonicalized in another scope.
 * The canonical form also depends on the parameter frame that a function
 * literal pushes before it canonicalizes its body (the parameter names and
 * their declared or inferred types), which is not a lexical scope. So the
 * body of a literal is canonicalized with a map of its own
 * (`withSeparateCanonicalReads()`).
 *
 * The outermost read creates the map and drops it before it returns, also
 * when it throws, so the map keeps no expression after that read, as the
 * map of `structural` reads does.
 */
let memo: CanonicalReadMemo | undefined = undefined;

/** The map of the current `canonical` read, or `undefined` (see `memo`). */
export function canonicalReadMemo(): CanonicalReadMemo | undefined {
  return memo;
}

/** Replace the map of the current `canonical` read (see `memo`). */
export function setCanonicalReadMemo(
  value: CanonicalReadMemo | undefined
): void {
  memo = value;
}

/**
 * Run `fn` with no `canonical` read in progress, so the reads inside `fn`
 * share a map of their own, and neither give nor take the canonical forms
 * of the reads outside `fn`. The map of the reads outside is restored after
 * `fn`, also when it throws.
 *
 * A function literal canonicalizes its body this way, because the canonical
 * form of the body depends on the parameter frame of the literal. The fold
 * refinement (`fixpointLiteral`, `library/collections.ts`) canonicalizes
 * the same raw literal once per step, each time with another inferred type
 * for the accumulator. With one shared map, every step got the body of the
 * first step when the body was a raw `Block`: in `Reduce(1..3, (f, v) ↦
 * Block(If(f = 0, v, f)), 0)` inside an enclosing literal, the accumulator
 * `f` stayed `unknown`, and the fold was typed `unknown`, not `number`.
 */
export function withSeparateCanonicalReads<T>(fn: () => T): T {
  const outer = memo;
  memo = undefined;
  try {
    return fn();
  } finally {
    memo = outer;
  }
}
