import type { Expression } from '../global-types.js';
import { isLibraryOperator, sameOperator } from '../library-shadowing.js';
import {
  isFoldBarrierProduct,
  isFunction,
  isNotationalProduct,
} from './type-guards.js';

/**
 * The associative operator whose nested calls {@link flatten} splices into
 * the operand list. A nested call is spliced only when it is a call of this
 * operator, which is a question about its definition, not its name: in
 * `Add(Add_user(2, 3), 1)`, where `Add_user` is a call of a user function
 * named `Add` (made in a scope that is now popped, or the value of an
 * argument of the qualified call `std::Add`), the operand is a value, and
 * splicing its operands would give `Add(2, 3, 1)`.
 *
 * - A call node, or an object with the same three fields: an operand is
 *   spliced when it is a call of the same operator, `sameOperator()` (the
 *   same name and the same definition). The canonical form of an operator
 *   with no canonical handler (`box.ts`) passes the definition of the call
 *   that it builds, and the evaluation of the operands of a call
 *   (`hold.ts`) passes the call.
 * - A name: the library operator of that name. An operand is spliced when
 *   it is a call bound to the system-scope definition of the name, or to an
 *   extension or a copy of it that keeps its handlers
 *   (`isLibraryOperator()`). A canonical handler of the library (`Add`,
 *   `Multiply`, `And`, `Union`, …) passes its name: it runs for a call of
 *   the library operator, and the associativity that it applies is a fact
 *   about that operator. A name that a caller-supplied library defines is
 *   read as the definition of that library.
 *
 * In both cases, an operand with no definition (a non-canonical operand) is
 * spliced when its name is the name of the operator: it has no binding to
 * compare, and its name is the only identity it has.
 */
export type FlattenOperator =
  | string
  | {
      readonly operator: string;
      readonly operatorDefinition: object | undefined;
      readonly valueDefinition: object | undefined;
    };

/** The name of the operator `operator`. */
function operatorName(operator: FlattenOperator): string {
  return typeof operator === 'string' ? operator : operator.operator;
}

/** True when `x` is a call of the operator `operator` (see
 * {@link FlattenOperator}), so that its operands are spliced. */
function isCallOf(x: Expression, operator: FlattenOperator): boolean {
  if (typeof operator !== 'string') return sameOperator(x, operator);
  if (x.operator !== operator) return false;
  if (x.operatorDefinition === undefined && x.valueDefinition === undefined)
    return true;
  return isLibraryOperator(x, operator, { customLibrary: false });
}

/**
 *
 * Optionally make all the arguments canonical (default).
 *
 * "Lift" Sequence expressions to the top level.
 * e.g. `["Add", 1, ["Sequence", 2, 3]]` -> `["Add", 1, 2, 3]`
 *
 * Additionally, if an operator is provided, also lift nested expressions
 * with the same operator: calls of the same definition, see
 * {@link FlattenOperator}.
 *  e.g. `["f", a, ["f", b, c]]` -> `["f", a, b, c]`
 *
 * `Nothing` is an operand like any other and is kept: `[1, Nothing]` has two
 * elements. A `Sequence` operand is spliced: `Add(1, Sequence())` has the one
 * operand `1`.
 *
 * Note: *not* recursive
 */
export function flatten<T extends ReadonlyArray<Expression> | Expression[]>(
  ops: T,
  operator?: FlattenOperator,
  canonicalize = true
): T {
  // Optionally make all the arguments canonical.
  const xs: ReadonlyArray<Expression> =
    !canonicalize || ops.every((x) => x.isCanonical)
      ? ops
      : ops.map((x) => x.canonical);

  if (operator) {
    const name = operatorName(operator);
    // A test of the names only: the definition is compared below, for an
    // operand that has the name.
    const shouldFlatten = (x: Expression) =>
      x.operator === name || x.operator === 'Sequence';

    // Bypass memory allocation for the common case where there is nothing to flatten
    if (xs.every((x) => !shouldFlatten(x))) return xs as T;

    // Iterate over the list of expressions and flatten them
    const ys: Expression[] = [];
    for (const x of xs) {
      // If the operator matches, flatten the expression
      if (
        isFunction(x) &&
        (x.operator === 'Sequence' || isCallOf(x, operator))
      )
        for (const y of flatten(x.ops, operator, canonicalize)) ys.push(y);
      else ys.push(x);
    }
    return ys as T;
  }

  if (xs.every((x) => x.operator !== 'Sequence')) return xs as T;

  // Iterate over the list of expressions and flatten them
  const ys: Expression[] = [];
  for (const x of xs) {
    // If the operator matches, flatten the expression
    if (isFunction(x, 'Sequence'))
      for (const y of flatten(x.ops, operator, canonicalize)) ys.push(y);
    else ys.push(x);
  }
  return ys as T;
}

/**
 * Like {@link flatten}, but ellipsis-fold barriers are held back.
 *
 * Lifts `Sequence` and nested `operator` applications recursively,
 * exactly like `flatten`, EXCEPT that an operand which is a fold-barrier
 * product (a `Multiply` carrying a `ContinuationPlaceholder` at any depth) is
 * pushed back WHOLE: splicing it would smuggle the placeholder into the
 * enclosing fold. Because the lift is recursive, a barrier wrapped in a
 * `Sequence` — e.g. `Multiply(Sequence(Multiply(a, ContinuationPlaceholder)), b)`
 * — is caught too, which a top-level-only barrier check would miss.
 *
 * The third argument mirrors `flatten`'s: when `true` (the default) the
 * operands are made canonical before being examined.
 */
export function flattenHoldingBarriers<
  T extends ReadonlyArray<Expression> | Expression[],
>(ops: T, operator: FlattenOperator, canonicalize = true): T {
  const xs: ReadonlyArray<Expression> =
    !canonicalize || ops.every((x) => x.isCanonical)
      ? ops
      : ops.map((x) => x.canonical);

  const ys: Expression[] = [];
  for (const x of xs) {
    // Hold barrier-bearing products back, whole
    if (isFoldBarrierProduct(x)) {
      ys.push(x);
      continue;
    }
    // Lift the requested operator and `Sequence`, still holding barriers back
    if (
      isFunction(x) &&
      (x.operator === 'Sequence' || isCallOf(x, operator))
    )
      for (const y of flattenHoldingBarriers(x.ops, operator, canonicalize))
        ys.push(y);
    else ys.push(x);
  }
  return ys as T;
}

/**
 * Like {@link flatten} with no canonicalization, but a product with a direct
 * `ContinuationPlaceholder` operand (`isNotationalProduct()`, such as
 * `2 · 4 · … · 2n`) is kept whole. Its operands are not lifted, because the
 * enclosing product would then read the last sample `2n` as the two factors
 * `2` and `n`. Other nested applications of `operator` and `Sequence`
 * operands are lifted recursively, so a notational product inside them is
 * found and kept whole too: `3 · (5 · (2 · 4 · … · 2n))` gives the operands
 * `3`, `5` and `2 · 4 · … · 2n`.
 */
export function flattenKeepingNotationalProducts(
  ops: ReadonlyArray<Expression>,
  operator: FlattenOperator
): Expression[] {
  const ys: Expression[] = [];
  for (const x of ops) {
    if (isNotationalProduct(x)) ys.push(x);
    else if (
      isFunction(x) &&
      (x.operator === 'Sequence' || isCallOf(x, operator))
    )
      ys.push(...flattenKeepingNotationalProducts(x.ops, operator));
    else ys.push(x);
  }
  return ys;
}

export function flattenSequence(
  xs: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  // Bypass memory allocation for the common case where there are no sequences or delimiters
  if (xs.every((x) => x.operator !== 'Sequence' && x.operator !== 'Delimiter'))
    return xs;

  const ys: Expression[] = [];
  for (const x of xs) {
    if (!x.isValid) ys.push(x);
    else if (isFunction(x, 'Delimiter')) {
      if (x.op1.operator === 'Sequence') {
        const seq = isFunction(x.op1) ? x.op1.ops : [];
        // If this is an empty delimiter, i.e. `()`, preserve it as a tuple, don't flatten it.
        if (seq.length === 0) ys.push(x.engine.expr(['Tuple']));
        else for (const y of flattenSequence(seq)) ys.push(y);
      } else ys.push(x.op1);
    } else if (isFunction(x, 'Sequence')) {
      ys.push(...x.ops);
    } else ys.push(x);
  }
  return ys;
}
