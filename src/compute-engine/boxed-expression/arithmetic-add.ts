import type { BoxedExpression, IComputeEngine } from '../public.ts';
import { getImaginaryFactor } from './utils.ts';
import { isIndexableCollection } from '../collection-utils.ts';

import { flatten } from './flatten.ts';
import { addOrder } from './order.ts';
import { Terms } from './terms.ts';
import { Type } from '../../common/type/types.ts';
import { widen } from '../../common/type/utils.ts';
import { isSubtype } from '../../common/type/subtype.ts';

/**
 *
 * The canonical form of `Add`:
 * - canonicalize the arguments
 * - remove `0`
 * - capture complex numbers (`a + ib` or `ai + b`)
 * - sort the terms
 *
 */
export function canonicalAdd(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Make canonical, flatten, and lift nested expressions
  ops = flatten(ops, 'Add');

  // Remove literal 0
  ops = ops.filter((x) => x.numericValue === null || !x.is(0));

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
        (isSubtype(nv.type, 'real') && !nv.isExact) ||
        isSubtype(nv.type, 'integer')
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
              xs.push(ce.number(ce._numericValue({ re, im: im ?? 0 })));
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

export function addType(args: ReadonlyArray<BoxedExpression>): Type {
  if (args.length === 0) return 'finite_integer'; // = 0
  if (args.length === 1) return args[0].type;
  return widen(...args.map((x) => x.type));
}

export function add(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  if (!xs.every((x) => x.isValid)) return xs[0].engine._fn('Add', xs);
  return new Terms(xs[0].engine, xs).asExpression();
}

export function addN(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  if (!xs.every((x) => x.isValid)) return xs[0].engine._fn('Add', xs);
  // Don't N() the number literals (fractions) to avoid losing precision
  xs = xs.map((x) => (x.isNumberLiteral ? x.evaluate() : x.N()));
  return new Terms(xs[0].engine, xs).N();
}
