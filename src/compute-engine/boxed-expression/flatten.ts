import type { Expression } from '../global-types';
import { isFunction, isSymbol } from './type-guards';

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
 * Note: *not* recursive
 */
export function flatten<T extends ReadonlyArray<Expression> | Expression[]>(
  ops: T,
  operator?: string,
  canonicalize = true
): T {
  // Optionally make all the arguments canonical.
  const xs: ReadonlyArray<Expression> =
    !canonicalize || ops.every((x) => x.isCanonical)
      ? ops
      : ops.map((x) => x.canonical);

  if (operator) {
    const shouldFlatten = (x: Expression) =>
      isSymbol(x, 'Nothing') ||
      x.operator === operator ||
      x.operator === 'Sequence';

    // Bypass memory allocation for the common case where there is nothing to flatten
    if (xs.every((x) => !shouldFlatten(x))) return xs as T;

    // Iterate over the list of expressions and flatten them
    const ys: Expression[] = [];
    for (const x of xs) {
      // Skip Nothing
      if (isSymbol(x, 'Nothing')) continue;

      // If the operator matches, flatten the expression
      if (
        isFunction(x) &&
        (x.operator === operator || x.operator === 'Sequence')
      )
        ys.push(...flatten(x.ops, operator, canonicalize));
      else ys.push(x);
    }
    return ys as T;
  }

  if (xs.every((x) => !(isSymbol(x, 'Nothing') || x.operator === 'Sequence')))
    return xs as T;

  // Iterate over the list of expressions and flatten them
  const ys: Expression[] = [];
  for (const x of xs) {
    // Skip Nothing
    if (isSymbol(x, 'Nothing')) continue;

    // If the operator matches, flatten the expression
    if (isFunction(x, 'Sequence'))
      ys.push(...flatten(x.ops, operator, canonicalize));
    else ys.push(x);
  }
  return ys as T;
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
        else ys.push(...flattenSequence(seq));
      } else ys.push(x.op1);
    } else if (isFunction(x, 'Sequence')) {
      ys.push(...x.ops);
    } else ys.push(x);
  }
  return ys;
}
