import type { Expression } from '../global-types.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';

/**
 * The value of a `Sum` or `Product` whose range has no term.
 *
 * When the static type of `expression` (the `Sum` or `Product`) is a vector
 * of a known length with number elements, the value is a list of that length
 * with the identity of the operation in each element. With
 * `n: integer<0..10>`, `Sum(i·[x, y, z], i, 1, n)` has the type
 * `vector<real^3>`, and at `n = 0` its value is `[0, 0, 0]`; the `Product`
 * of the same body is `[1, 1, 1]`. For any other type (a scalar, a matrix, a
 * tensor, a list of unknown length or with elements that are not numbers),
 * the value is the scalar identity, `0` or `1`.
 *
 * The scalar identity for a vector body is a value outside the static type,
 * and a consumer that reads the shape then gives another value than compiled
 * code, which takes the empty value from the static type:
 * `Norm(Product(i·[x, y, z], i, 1, n))` at `n = 0` would be `1` and not `√3`.
 * Compiled code gives the identity in every element when the body is a
 * vector with number elements whose width it can count
 * (`vectorBodyWidth()` in `compilation/javascript-target.ts`). That test
 * reads the body, not the type of the `Sum`, so the two tests are not the
 * same function, but a body of the static type `vector<real^n>` passes both.
 */
export function emptyBigOpValue(
  expression: Expression,
  operator: 'Sum' | 'Product'
): Expression {
  const ce = expression.engine;
  const identity = operator === 'Sum' ? ce.Zero : ce.One;
  const t = resolveTypeAlias(expression.type.type);
  if (typeof t !== 'object' || t.kind !== 'list') return identity;
  const dims = t.dimensions;
  if (!Array.isArray(dims) || dims.length !== 1) return identity;
  const width = dims[0];
  // A length of `-1` is an open length.
  if (!(width > 0)) return identity;
  if (!isSubtype(t.elements, 'number')) return identity;
  return ce._fn('List', Array(width).fill(identity));
}
