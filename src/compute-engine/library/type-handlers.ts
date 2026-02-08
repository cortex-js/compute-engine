import type { BoxedExpression } from '../global-types';
import type { Type } from '../../common/type/types';

/** Real inputs → finite_real, otherwise → finite_number. */
export function numericTypeHandler(
  ops: ReadonlyArray<BoxedExpression>
): Type {
  if (ops.every((x) => x.type.matches('real'))) return 'finite_real';
  return 'finite_number';
}
