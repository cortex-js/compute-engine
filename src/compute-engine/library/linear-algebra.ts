import { checkArity } from '../boxed-expression/validate';
import {
  BoxedExpression,
  IComputeEngine,
  IdentifierDefinitions,
} from '../public';

// matrix
// diagonal-matrix -- constructor or extract diagonal from matrix
// transpose
// cross-product
// outer-product
// determinant
// vector
// matrix
// rank
// scalar-matrix
// constant-matrix
// identity-matrix

// @todo: See also:
// - https://github.com/scalanlp/breeze/wiki/Linear-Algebra-Cheat-Sheet
// - http://sylvester.jcoglan.com/api/matrix.html#random
// - https://www.statmethods.net/advstats/matrix.html
export const LINEAR_ALGEBRA_LIBRARY: IdentifierDefinitions[] = [
  {
    Matrix: {
      complexity: 9000,
      hold: 'all',
      signature: {
        params: ['Lists'],
        optParams: ['Strings', 'Strings'],
        result: 'Lists',
        canonical: canonicalMatrix,
        evaluate: (_ce, ops) => ops[0].evaluate(),
        N: (_ce, ops) => ops[0].N(),
      },
    },
  },
];

function canonicalMatrix(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression | null {
  if (ops.length === 0) return ce._fn('Matrix', []);

  const body = ops[0].canonical;
  const delims = ops[1]?.canonical;
  const columns = ops[2]?.canonical;

  if (ops.length > 3) return ce._fn('Matrix', checkArity(ce, ops, 3));

  if (columns) return ce._fn('Matrix', [body, delims, columns]);
  if (delims) return ce._fn('Matrix', [body, delims]);
  return ce._fn('Matrix', [body]);
}
