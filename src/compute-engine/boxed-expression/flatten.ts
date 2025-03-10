import type { BoxedExpression } from '../global-types';

/**
 *
 * Make all the arguments canonical.
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
export function flatten<
  T extends ReadonlyArray<BoxedExpression> | BoxedExpression[],
>(ops: T, operator?: string): T {
  // Make all the arguments canonical.
  const xs: ReadonlyArray<BoxedExpression> = ops.every((x) => x.isCanonical)
    ? ops
    : ops.map((x) => x.canonical);

  if (operator) {
    const shouldFlatten = (x: BoxedExpression) =>
      x.symbol === 'Nothing' ||
      x.operator === operator ||
      x.operator === 'Sequence';

    // Bypass memory allocation for the common case where there is nothing to flatten
    if (xs.every((x) => !shouldFlatten(x))) return xs as T;

    // Iterate over the list of expressions and flatten them
    const ys: BoxedExpression[] = [];
    for (const x of xs) {
      // Skip Nothing
      if (x.symbol === 'Nothing') continue;

      // If the operator matches, flatten the expression
      if (x.ops && (x.operator === operator || x.operator === 'Sequence'))
        ys.push(...flatten(x.ops, operator));
      else ys.push(x);
    }
    return ys as T;
  }

  if (xs.every((x) => !(x.symbol === 'Nothing' || x.operator === 'Sequence')))
    return xs as T;

  // Iterate over the list of expressions and flatten them
  const ys: BoxedExpression[] = [];
  for (const x of xs) {
    // Skip Nothing
    if (x.symbol === 'Nothing') continue;

    // If the operator matches, flatten the expression
    if (x.ops && x.operator === 'Sequence')
      ys.push(...flatten(x.ops, operator));
    else ys.push(x);
  }
  return ys as T;
}

/**
 * Flatten the arguments.
 * @fixme replace with just flatten.
 * @fixme consider adding flatternSort()
 */

export function flattenOps<
  T extends ReadonlyArray<BoxedExpression> | BoxedExpression[],
>(ops: T, operator: string): T {
  if (!operator) return ops;
  // Bypass memory allocation for the common case where there is nothing to flatten
  if (ops.every((x) => !x.ops || x.operator !== operator)) return ops;

  const result: BoxedExpression[] = [];
  for (const arg of ops) {
    if (!arg.ops || arg.operator !== operator) result.push(arg);
    else {
      // ["f", a, ["f", b, c]] -> ["f", a, b, c]
      // or ["f", ["f", a]] -> ["f", a]
      result.push(...flattenOps(arg.ops, operator));
    }
  }

  // If number of arguments didn't change, we didn't flatten
  console.assert(result.length !== ops.length); // @todo check below may not be necessary
  if (result.length === ops.length) return ops;

  return result as T;
}

/**
 * @todo: this function should probably not be recursive. As it, it is semi-recursive.
 */
export function flattenSequence(
  xs: ReadonlyArray<BoxedExpression>
): ReadonlyArray<BoxedExpression> {
  // Bypass memory allocation for the common case where there are no sequences or delimiters
  if (xs.every((x) => x.operator !== 'Sequence' && x.operator !== 'Delimiter'))
    return xs;

  const ys: BoxedExpression[] = [];
  for (const x of xs) {
    if (!x.isValid) ys.push(x);
    else if (x.operator === 'Delimiter') {
      if (x.op1.operator === 'Sequence') {
        const seq = x.op1.ops ?? [];
        // If this is an empty delimiter, i.e. `()`, preserve it as a tuple, don't flatten it.
        if (seq.length === 0) ys.push(x.engine.box(['Tuple']));
        else ys.push(...flattenSequence(seq));
      } else ys.push(x.op1);
    } else if (x.operator === 'Sequence') {
      if (x.ops) ys.push(...x.ops);
    } else ys.push(x);
  }
  return ys;
}
