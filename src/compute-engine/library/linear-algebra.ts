import { parseType } from '../../common/type/parse';
import { isSubtype } from '../../common/type/subtype';
import { ListType } from '../../common/type/types';
import { isBoxedTensor } from '../boxed-expression/boxed-tensor';
import { checkArity } from '../boxed-expression/validate';
import { isFiniteIndexedCollection } from '../collection-utils';
import {
  BoxedExpression,
  ComputeEngine,
  SymbolDefinitions,
  Sign,
} from '../global-types';

export const LINEAR_ALGEBRA_LIBRARY: SymbolDefinitions[] = [
  {
    Matrix: {
      complexity: 9000,
      lazy: true,
      signature: '(matrix, string?, string?) -> matrix',
      type: ([matrix]) => matrix.type,
      canonical: canonicalMatrix,
      evaluate: (ops, options) => ops[0].evaluate(options),
    },
    // Vector is a specialized collection to represent a column vector.
    // ["Vector", a, b, c] is a shorthand for ["List", ["List", a], ["List", b], ["List", c]]
    Vector: {
      complexity: 9000,
      lazy: true,
      signature: '(number+) -> vector',
      type: (elements) =>
        parseType(
          `vector<${elements.length}>`,
          elements[0].engine._typeResolver
        ),
      canonical: (ops, { engine: ce }) => {
        return ce._fn('Matrix', [
          ce.function(
            'List',
            ops.map((op) => ce.function('List', [op]))
          ),
        ]);
      },
    },
  },

  {
    // Corresponds to monadic Shape `⍴` in APL
    Shape: {
      complexity: 8200,
      signature: '(value) -> tuple',
      evaluate: ([xs], { engine: ce }) => ce.tuple(...xs.shape),
    },

    Rank: {
      description:
        'The length of the shape of the expression. Note this is not the matrix rank (the number of linearly independent rows or columns in the matrix)',
      complexity: 8200,
      signature: '(value) -> number',
      sgn: (): Sign => 'positive',
      evaluate: ([xs], { engine: ce }) => ce.number(xs.rank),
    },

    // Corresponds to ArrayReshape in Mathematica
    // and dyadic Shape `⍴` in APL
    Reshape: {
      complexity: 8200,
      signature: '(list<number>, tuple) -> value',
      type: ([value, shape]) => {
        if (!value.type.matches('list')) return 'nothing';
        const col = value.type.type as ListType;
        if (!isSubtype(col.elements, 'number')) return 'nothing';
        return parseType(
          `list<number^${shape.ops!.map((x) => x.toString()).join('x')}>`
        );
      },
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        let op1 = ops[0];
        const shape = ops[1].ops?.map((op) => op.re) ?? [];

        // If a finite indexable collection, convert to a list
        // -> BoxedTensor
        if (!isBoxedTensor(op1) && isFiniteIndexedCollection(op1))
          op1 = ce.function('List', [...op1.each()]);

        if (isBoxedTensor(op1)) {
          if (shape.join('x') === op1.shape.join('x')) return op1;
          return op1.tensor.reshape(...shape).expression;
        }

        return undefined;
      },
    },

    // Corresponds to Ravel `,` in APL
    // Also Enlist `∊``⍋` in APL
    Flatten: {
      complexity: 8200,
      signature: '(value) -> list',
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0];

        if (isBoxedTensor(op1))
          return ce.box([
            'List',
            ...op1.tensor.flatten().map((x) => ce.box(x)),
          ]);

        if (isFiniteIndexedCollection(op1))
          return ce.function('List', [...op1.each()]);

        return undefined;
      },
    },

    // Similar to Zip, but has a single argument, a matrix
    // Ex: Transpose([[a, b, c], [1, 2, 3]]) = [[a, 1], [b, 2], [c, 3]]
    Transpose: {
      complexity: 8200,
      signature: '(matrix|vector, axis1: integer?, axis2: integer?) -> matrix',
      evaluate: (ops, { engine: ce }) => {
        let op1 = ops[0];
        let axis1 = 1;
        let axis2 = 2;
        if (ops.length === 3) {
          axis1 = ops[1].re;
          axis2 = ops[2].re;
          console.assert(axis1 > 0 && axis2 > 0);
        }
        if (axis1 === axis2) return undefined;
        if (!isBoxedTensor(op1) && isFiniteIndexedCollection(op1))
          op1 = ce.function('List', [...op1.each()]);
        if (isBoxedTensor(op1)) {
          if (axis1 === 1 && axis2 === 2)
            return op1.tensor.transpose()?.expression;
          else return op1.tensor.transpose(axis1, axis2)?.expression;
        }
        return undefined;
      },
    },

    ConjugateTranspose: {
      complexity: 8200,
      signature: '(tensor, axis1: integer?, axis2: integer?) -> matrix',
      evaluate: (ops) => {
        const op1 = ops[0];
        let axis1 = 1;
        let axis2 = 2;
        if (ops.length === 3) {
          axis1 = ops[1].re;
          axis2 = ops[2].re;
          console.assert(axis1 > 0 && axis2 > 0);
        }
        if (axis1 === axis2) return undefined;

        if (isBoxedTensor(op1))
          return op1.tensor.conjugateTranspose(axis1, axis2)?.expression;

        return undefined;
      },
    },

    Determinant: {
      complexity: 8200,
      signature: '(matrix) -> number',
      evaluate: (ops) => {
        const op1 = ops[0];
        if (isBoxedTensor(op1)) return op1.tensor.determinant();

        return undefined;
      },
    },

    Inverse: {
      complexity: 8200,
      signature: '(matrix) -> matrix',
      type: ([matrix]) => matrix.type,
      evaluate: ([matrix]) => {
        if (isBoxedTensor(matrix)) return matrix.tensor.inverse()?.expression;

        return undefined;
      },
    },

    PseudoInverse: {
      complexity: 8200,
      signature: '(matrix) -> matrix',
      evaluate: ([matrix]) => {
        if (isBoxedTensor(matrix))
          return matrix.tensor.pseudoInverse()?.expression;

        return undefined;
      },
    },

    // Adjoint: {
    //   complexity: 8200,
    //   signature: {
    //     domain: ['FunctionOf', 'Values', 'Values'],
    //     evaluate: (ops) => {
    //       const op1 = ops[0];
    //       if (isBoxedTensor(op1)) return op1.adjoint()?.adjugateMatrix();

    //       return undefined;
    //     },
    //   },
    // },

    AdjugateMatrix: {
      complexity: 8200,
      signature: '(matrix) -> matrix',
      evaluate: (ops) => {
        const op1 = ops[0];
        if (isBoxedTensor(op1)) return op1.tensor.adjugateMatrix()?.expression;

        return undefined;
      },
    },

    // Minor: {
    //   complexity: 8200,
    //   signature: {
    //     domain: ['FunctionOf', 'Values', 'Values', 'Values'],
    //     evaluate: (ops) => {
    //       const op1 = ops[0];
    //       // if (isBoxedTensor(op1)) return op1.minor();

    //       return undefined;
    //     },
    //   },
    // },

    Trace: {
      complexity: 8200,
      signature: '(matrix) -> number',
      evaluate: (ops) => {
        const op1 = ops[0];
        if (isBoxedTensor(op1)) return op1.tensor.trace();

        return undefined;
      },
    },
  },
];

function canonicalMatrix(
  ops: BoxedExpression[],
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | null {
  const operator = 'Matrix';
  if (ops.length === 0) return ce._fn(operator, []);

  const body =
    ops[0].operator === 'Vector' ? ops[0].canonical.ops![0] : ops[0].canonical;
  const delims = ops[1]?.canonical;
  const columns = ops[2]?.canonical;

  if (ops.length > 3) return ce._fn(operator, checkArity(ce, ops, 3));

  if (columns) return ce._fn(operator, [body, delims, columns]);
  if (delims) return ce._fn(operator, [body, delims]);
  return ce._fn(operator, [body]);
}
