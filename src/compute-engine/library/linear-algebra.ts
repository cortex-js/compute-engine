import { isBoxedTensor } from '../boxed-expression/boxed-tensor';
import { checkArity } from '../boxed-expression/validate';
import {
  BoxedExpression,
  IComputeEngine,
  IdentifierDefinitions,
} from '../public';

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
  {
    // Corresponds to monadic Shape `⍴` in APL
    Shape: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Tuples'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];

          if (isBoxedTensor(op1)) return ce.tuple(op1.shape);

          return ce.tuple([]);
        },
      },
    },

    Rank: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Numbers'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];

          if (isBoxedTensor(op1)) return ce.number(op1.rank);

          return ce.number(0);
        },
      },
    },

    // Corresponds to ArrayReshape in Mathematica
    // and dyadic Shape `⍴` in APL
    Reshape: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values', 'Values'],
        evaluate: (_ce, _ops) => {
          // @todo
          return undefined;
        },
      },
    },

    // Corresponds to Ravel `,` in APL
    // Also Enlist `∊``⍋` in APL
    Flatten: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (_ce, _ops) => {
          // @todo
          return undefined;
        },
      },
    },

    // Similar to Zip, but has a single argument, a matrix
    // Ex: Transpose([[a, b, c], [1, 2, 3]]) = [[a, 1], [b, 2], [c, 3]]
    Transpose: {
      complexity: 8200,
      signature: {
        domain: [
          'FunctionOf',
          'Values',
          ['OptArg', 'Numbers', 'Numbers'],
          'Values',
        ],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          let axis1 = 1;
          let axis2 = 2;
          if (ops.length === 3) {
            axis1 = ops[1].value as number;
            axis2 = ops[2].value as number;
            console.assert(axis1 > 0 && axis2 > 0);
          }
          if (axis1 === axis2) return undefined;
          if (axis1 === 1 && axis2 === 2) {
          } else {
          }
          // if (isBoxedTensor(op1)) return op1.transpose();

          return undefined;
        },
      },
    },

    ConjugateTranspose: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          let axis1 = 1;
          let axis2 = 2;
          if (ops.length === 3) {
            axis1 = ops[1].value as number;
            axis2 = ops[2].value as number;
            console.assert(axis1 > 0 && axis2 > 0);
          }
          if (axis1 === axis2) return undefined;
          if (isBoxedTensor(op1)) return undefined; // op1.conjugateTranspose(axis1, axis2);

          // @todo
          return undefined;
        },
      },
    },

    Determinant: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          if (isBoxedTensor(op1)) return op1.determinant();

          return undefined;
        },
      },
    },

    Inverse: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          // if (isBoxedTensor(op1)) return op1.inverse();

          return undefined;
        },
      },
    },

    PseudoInverse: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          // if (isBoxedTensor(op1)) return op1.pseudoInverse();

          return undefined;
        },
      },
    },

    Adjoint: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          // if (isBoxedTensor(op1)) return op1.adjoint();

          return undefined;
        },
      },
    },

    AdjugateMatrix: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          // if (isBoxedTensor(op1)) return op1.adjugateMatrix();

          return undefined;
        },
      },
    },

    Minor: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values', 'Values'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          // if (isBoxedTensor(op1)) return op1.minor();

          return undefined;
        },
      },
    },

    Trace: {
      complexity: 8200,
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          // if (isBoxedTensor(op1)) return op1.trace();

          return undefined;
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
