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
// https://ctan.math.illinois.edu/macros/latex/required/tools/array.pdf
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
    // Vector is a specialized collection to represent a column vector.
    // ["Vector", a, b, c] is a shorthand for ["List", ["List", a], ["List", b], ["List", c]]
    Vector: {
      complexity: 9000,
      hold: 'all',
      signature: {
        restParam: 'Anything',
        result: 'Lists',
        canonical: (ce, ops) => {
          return ce._fn('Matrix', [
            ce._fn(
              'List',
              ce.canonical(ops).map((op) => ce._fn('List', [op]))
            ),
          ]);
        },
      },
    },
  },
];

function canonicalMatrix(
  ce: IComputeEngine,
  ops: BoxedExpression[],
  head = 'Matrix'
): BoxedExpression | null {
  if (ops.length === 0) return ce._fn(head, []);

  const body =
    ops[0].head === 'Vector' ? ops[0].canonical.ops![0] : ops[0].canonical;
  const delims = ops[1]?.canonical;
  const columns = ops[2]?.canonical;

  if (ops.length > 3) return ce._fn(head, checkArity(ce, ops, 3));

  if (columns) return ce._fn(head, [body, delims, columns]);
  if (delims) return ce._fn(head, [body, delims]);
  return ce._fn(head, [body]);
}
