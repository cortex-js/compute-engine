import type { Expression } from '../global-types.js';
import {
  isFoldBarrierProduct,
  isFunction,
  isNotationalProduct,
  isSymbol,
} from './type-guards.js';

/**
 *
 * Optionally make all the arguments canonical (default).
 *
 * "Lift" Sequence expressions to the top level.
 * e.g. `["Add", 1, ["Sequence", 2, 3]]` -> `["Add", 1, 2, 3]`
 *
 * Additionally, if an operator is provided, also lift nested expressions
 * with the same operator.
 *  e.g. `["f", a, ["f", b, c]]` -> `["f", a, b, c]`
 *
 * `preserveNothing` retains tuple coordinates; explicit Sequences still splice
 * and omit Nothing under their ordinary rules.
 *
 * Note: *not* recursive
 */
export function flatten<T extends ReadonlyArray<Expression> | Expression[]>(
  ops: T,
  operator?: string,
  canonicalize = true,
  preserveNothing = false
): T {
  // An explicit Sequence still splices (and uses its own omission rules),
  // even when it canonicalizes to Nothing before the outer tuple is built.
  if (preserveNothing && ops.some((x) => isFunction(x, 'Sequence'))) {
    const spliced: Expression[] = [];
    for (const x of ops) {
      if (isFunction(x, 'Sequence')) {
        for (const y of flatten([x], operator, canonicalize)) spliced.push(y);
      } else spliced.push(x);
    }
    return flatten(spliced, operator, canonicalize, true) as T;
  }
  // Optionally make all the arguments canonical.
  const xs: ReadonlyArray<Expression> =
    !canonicalize || ops.every((x) => x.isCanonical)
      ? ops
      : ops.map((x) => x.canonical);

  if (operator) {
    const shouldFlatten = (x: Expression) =>
      (!preserveNothing && isSymbol(x, 'Nothing')) ||
      x.operator === operator ||
      x.operator === 'Sequence';

    // Bypass memory allocation for the common case where there is nothing to flatten
    if (xs.every((x) => !shouldFlatten(x))) return xs as T;

    // Iterate over the list of expressions and flatten them
    const ys: Expression[] = [];
    for (const x of xs) {
      // Skip Nothing
      if (!preserveNothing && isSymbol(x, 'Nothing')) continue;

      // If the operator matches, flatten the expression
      if (
        isFunction(x) &&
        (x.operator === operator || x.operator === 'Sequence')
      )
        for (const y of flatten(x.ops, operator, canonicalize, preserveNothing))
          ys.push(y);
      else ys.push(x);
    }
    return ys as T;
  }

  if (
    xs.every(
      (x) =>
        !(
          (!preserveNothing && isSymbol(x, 'Nothing')) ||
          x.operator === 'Sequence'
        )
    )
  )
    return xs as T;

  // Iterate over the list of expressions and flatten them
  const ys: Expression[] = [];
  for (const x of xs) {
    // Skip Nothing
    if (!preserveNothing && isSymbol(x, 'Nothing')) continue;

    // If the operator matches, flatten the expression
    if (isFunction(x, 'Sequence'))
      for (const y of flatten(x.ops, operator, canonicalize, preserveNothing))
        ys.push(y);
    else ys.push(x);
  }
  return ys as T;
}

/**
 * Like {@link flatten}, but ellipsis-fold barriers are held back.
 *
 * Lifts `Sequence`/`Nothing` and nested `operator` applications recursively,
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
>(ops: T, operator: string, canonicalize = true): T {
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
    // Skip Nothing
    if (isSymbol(x, 'Nothing')) continue;
    // Lift the requested operator and `Sequence`, still holding barriers back
    if (isFunction(x) && (x.operator === operator || x.operator === 'Sequence'))
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
  operator: string
): Expression[] {
  const ys: Expression[] = [];
  for (const x of ops) {
    if (isNotationalProduct(x)) ys.push(x);
    else if (isSymbol(x, 'Nothing')) continue;
    else if (
      isFunction(x) &&
      (x.operator === operator || x.operator === 'Sequence')
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
