import type { BoxedDomain, BoxedExpression, IComputeEngine } from '../public';
import { getImaginaryFactor } from './utils';
import { widen } from './boxed-domain';
import { isIndexableCollection } from '../collection-utils';

import { flatten } from './flatten';
import { addOrder } from './order';

/**
 *
 * The canonical form of `Add`:
 * - canonicalizes the arguments
 * - removes `0`
 * - captures complex numbers (`a + ib` or `ai + b`)
 * - sorts the terms
 *
 */
export function canonicalAdd(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Make canonical, flatten, and lift nested expressions
  ops = flatten(ops, 'Add');

  // Remove literal 0
  ops = ops.filter((x) => x.numericValue === null || x.isZero !== true);

  if (ops.length === 0) return ce.Zero;
  if (ops.length === 1 && !isIndexableCollection(ops[0])) return ops[0];

  // Iterate over the terms and check if any are complex numbers
  // (a real number followed by an imaginary number)
  const xs: BoxedExpression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.isNumberLiteral) {
      const nv = op.numericValue!;

      if (
        typeof nv === 'number' ||
        (nv.type === 'real' && !nv.isExact) ||
        nv.type === 'integer'
      ) {
        // We have a number such as 4, 3.14, etc. but not 2/3, √2, etc.
        // Check the following term to see if it's an imaginary number

        const next = ops[i + 1];
        if (next) {
          const fac = getImaginaryFactor(next)?.numericValue;
          if (fac !== undefined) {
            const im = typeof fac === 'number' ? fac : fac?.re;
            if (im !== 0) {
              const re = typeof nv === 'number' ? nv : nv.re;
              xs.push(ce.number(ce._numericValue({ decimal: re, im })));
              i++;
              continue;
            }
          }
        }
      }
    }
    xs.push(op);
  }

  if (xs.length === 1) return xs[0];

  // Commutative: sort
  return ce._fn('Add', [...xs].sort(addOrder));
}

export function domainAdd(
  _ce: IComputeEngine,
  args: (undefined | BoxedDomain)[]
): BoxedDomain | null | undefined {
  let dom: BoxedDomain | null | undefined = null;
  for (const arg of args) {
    if (!arg?.isNumeric) return null;
    dom = widen(dom, arg);
  }
  return dom;
}
