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
      signature: '(value, tuple) -> value',
      type: ([value, shape]) => {
        if (value.isNumber) {
          // Scalar input
          return parseType(
            `list<number^${shape.ops!.map((x) => x.toString()).join('x')}>`
          );
        }
        if (!value.type.matches('list')) return 'nothing';
        const col = value.type.type as ListType;
        if (!isSubtype(col.elements, 'number')) return 'nothing';
        return parseType(
          `list<number^${shape.ops!.map((x) => x.toString()).join('x')}>`
        );
      },
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        let op1 = ops[0].evaluate();
        const targetShape = ops[1].ops?.map((op) => op.re) ?? [];

        // Handle empty shape tuple - return scalar
        if (targetShape.length === 0) {
          if (op1.isNumber) return op1;
          if (isBoxedTensor(op1)) {
            // Return first element as scalar
            const flatData = op1.tensor.flatten();
            return flatData.length > 0 ? ce.box(flatData[0]) : ce.Zero;
          }
          return undefined;
        }

        // Handle scalar - replicate to fill target shape
        if (op1.isNumber) {
          return reshapeWithCycling(ce, [op1], targetShape);
        }

        // If a finite indexable collection, convert to a list
        // -> BoxedTensor
        if (!isBoxedTensor(op1) && isFiniteIndexedCollection(op1))
          op1 = ce.function('List', [...op1.each()]);

        if (isBoxedTensor(op1)) {
          // If shapes match, return as-is
          if (targetShape.join('x') === op1.shape.join('x')) return op1;

          // Flatten tensor data and reshape with cycling
          // Use tensor.flatten() to get all scalar elements
          const flatData = op1.tensor.flatten();
          const flatElements = flatData.map((x) => ce.box(x));
          return reshapeWithCycling(ce, flatElements, targetShape);
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
        let op1 = ops[0].evaluate();

        // Handle scalar - return single-element list
        if (op1.isNumber) return ce.box(['List', op1]);

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
        let op1 = ops[0].evaluate();

        // Transpose of scalar is the scalar itself
        if (op1.isNumber) return op1;

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
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Conjugate transpose of scalar is its conjugate
        if (op1.isNumber) return ce.box(['Conjugate', op1]).evaluate();

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
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Determinant of scalar (1x1 matrix) is the scalar itself
        if (op1.isNumber) return op1;

        if (isBoxedTensor(op1)) {
          const shape = op1.shape;
          // Vector: not a square matrix
          if (shape.length === 1)
            return ce.error('expected-square-matrix', op1.toString());
          // Tensor (rank > 2): not a square matrix
          if (shape.length > 2)
            return ce.error('expected-square-matrix', op1.toString());
          // Non-square matrix
          if (shape.length === 2 && shape[0] !== shape[1])
            return ce.error('expected-square-matrix', op1.toString());

          return op1.tensor.determinant();
        }

        return undefined;
      },
    },

    Inverse: {
      complexity: 8200,
      signature: '(matrix) -> matrix',
      type: ([matrix]) => matrix.type,
      evaluate: ([matrix], { engine: ce }) => {
        const op1 = matrix.evaluate();

        // Inverse of scalar is 1/scalar
        if (op1.isNumber) return ce.box(['Divide', 1, op1]).evaluate();

        if (isBoxedTensor(op1)) {
          const shape = op1.shape;
          // Vector: not a square matrix
          if (shape.length === 1)
            return ce.error('expected-square-matrix', op1.toString());
          // Tensor (rank > 2): not a square matrix
          if (shape.length > 2)
            return ce.error('expected-square-matrix', op1.toString());
          // Non-square matrix
          if (shape.length === 2 && shape[0] !== shape[1])
            return ce.error('expected-square-matrix', op1.toString());

          return op1.tensor.inverse()?.expression;
        }

        return undefined;
      },
    },

    PseudoInverse: {
      complexity: 8200,
      signature: '(matrix) -> matrix',
      evaluate: ([matrix], { engine: ce }) => {
        const op1 = matrix.evaluate();

        // Pseudoinverse of scalar is 1/scalar (or 0 if scalar is 0)
        if (op1.isNumber) {
          if (op1.isZero) return ce.Zero;
          return ce.box(['Divide', 1, op1]).evaluate();
        }

        if (isBoxedTensor(op1)) return op1.tensor.pseudoInverse()?.expression;

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
        const op1 = ops[0].evaluate();
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
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Trace of scalar is the scalar itself
        if (op1.isNumber) return op1;

        if (isBoxedTensor(op1)) {
          const shape = op1.shape;
          // Vector: not a square matrix
          if (shape.length === 1)
            return ce.error('expected-square-matrix', op1.toString());
          // Tensor (rank > 2): not a square matrix
          if (shape.length > 2)
            return ce.error('expected-square-matrix', op1.toString());
          // Non-square matrix
          if (shape.length === 2 && shape[0] !== shape[1])
            return ce.error('expected-square-matrix', op1.toString());

          return op1.tensor.trace();
        }

        return undefined;
      },
    },

    // Matrix multiplication: A (m×n) × B (n×p) → result (m×p)
    // Handles matrix × matrix, matrix × vector, vector × matrix
    MatrixMultiply: {
      complexity: 8300,
      signature: '(matrix|vector, matrix|vector) -> matrix|vector',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const A = ops[0].evaluate();
        const B = ops[1].evaluate();

        // Both operands must be tensors
        if (!isBoxedTensor(A) || !isBoxedTensor(B)) return undefined;

        const shapeA = A.shape;
        const shapeB = B.shape;

        // Handle vector × vector (inner product / dot product)
        if (shapeA.length === 1 && shapeB.length === 1) {
          if (shapeA[0] !== shapeB[0])
            return ce.error(
              'incompatible-dimensions',
              `${shapeA[0]} vs ${shapeB[0]}`
            );

          // Dot product: sum of element-wise products
          const n = shapeA[0];
          let sum: BoxedExpression = ce.Zero;
          for (let i = 0; i < n; i++) {
            const aVal = A.tensor.at(i + 1) ?? ce.Zero;
            const bVal = B.tensor.at(i + 1) ?? ce.Zero;
            sum = sum.add(ce.box(aVal).mul(ce.box(bVal)));
          }
          return sum.evaluate();
        }

        // Handle matrix × vector: A (m×n) × v (n) → result (m)
        if (shapeA.length === 2 && shapeB.length === 1) {
          const [m, n] = shapeA;
          if (n !== shapeB[0])
            return ce.error(
              'incompatible-dimensions',
              `${n} vs ${shapeB[0]}`
            );

          const result: BoxedExpression[] = [];
          for (let i = 0; i < m; i++) {
            let sum: BoxedExpression = ce.Zero;
            for (let k = 0; k < n; k++) {
              const aVal = A.tensor.at(i + 1, k + 1) ?? ce.Zero;
              const bVal = B.tensor.at(k + 1) ?? ce.Zero;
              sum = sum.add(ce.box(aVal).mul(ce.box(bVal)));
            }
            result.push(sum.evaluate());
          }
          return ce.box(['List', ...result]);
        }

        // Handle vector × matrix: v (m) × B (m×n) → result (n)
        // Treat vector as 1×m row vector
        if (shapeA.length === 1 && shapeB.length === 2) {
          const [m, n] = shapeB;
          if (shapeA[0] !== m)
            return ce.error(
              'incompatible-dimensions',
              `${shapeA[0]} vs ${m}`
            );

          const result: BoxedExpression[] = [];
          for (let j = 0; j < n; j++) {
            let sum: BoxedExpression = ce.Zero;
            for (let k = 0; k < m; k++) {
              const aVal = A.tensor.at(k + 1) ?? ce.Zero;
              const bVal = B.tensor.at(k + 1, j + 1) ?? ce.Zero;
              sum = sum.add(ce.box(aVal).mul(ce.box(bVal)));
            }
            result.push(sum.evaluate());
          }
          return ce.box(['List', ...result]);
        }

        // Handle matrix × matrix: A (m×n) × B (n×p) → result (m×p)
        if (shapeA.length === 2 && shapeB.length === 2) {
          const [m, n1] = shapeA;
          const [n2, p] = shapeB;
          if (n1 !== n2)
            return ce.error(
              'incompatible-dimensions',
              `${n1} vs ${n2}`
            );

          const n = n1;
          const rows: BoxedExpression[] = [];
          for (let i = 0; i < m; i++) {
            const row: BoxedExpression[] = [];
            for (let j = 0; j < p; j++) {
              let sum: BoxedExpression = ce.Zero;
              for (let k = 0; k < n; k++) {
                const aVal = A.tensor.at(i + 1, k + 1) ?? ce.Zero;
                const bVal = B.tensor.at(k + 1, j + 1) ?? ce.Zero;
                sum = sum.add(ce.box(aVal).mul(ce.box(bVal)));
              }
              row.push(sum.evaluate());
            }
            rows.push(ce.box(['List', ...row]));
          }
          return ce.box(['List', ...rows]);
        }

        // Unsupported tensor ranks
        return undefined;
      },
    },

    // Diagonal can be used to:
    // 1. Create a diagonal matrix from a vector
    // 2. Extract the diagonal from a matrix as a vector
    // 3. For a scalar, return the scalar (or could create 1x1 matrix)
    Diagonal: {
      complexity: 8200,
      signature: '(value) -> value',
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Scalar → return as-is
        if (op1.isNumber) return op1;

        if (isBoxedTensor(op1)) {
          const shape = op1.shape;

          // Vector → create diagonal matrix
          if (shape.length === 1) {
            const n = shape[0];
            const rows: BoxedExpression[] = [];
            const elements = [...op1.each()];
            for (let i = 0; i < n; i++) {
              const row: BoxedExpression[] = [];
              for (let j = 0; j < n; j++) {
                row.push(i === j ? elements[i] : ce.Zero);
              }
              rows.push(ce.box(['List', ...row]));
            }
            return ce.box(['List', ...rows]);
          }

          // Matrix → extract diagonal as vector
          if (shape.length === 2) {
            const [m, n] = shape;
            const minDim = Math.min(m, n);
            const diagonal: BoxedExpression[] = [];
            for (let i = 0; i < minDim; i++) {
              diagonal.push(op1.tensor.at(i + 1, i + 1) ?? ce.Zero);
            }
            return ce.box(['List', ...diagonal]);
          }

          // Tensor (rank > 2): not supported
          return ce.error('expected-square-matrix', op1.toString());
        }

        return undefined;
      },
    },

    // Creates an n×n identity matrix
    IdentityMatrix: {
      complexity: 8100,
      signature: '(integer) -> matrix',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const nExpr = ops[0].evaluate();
        const n = nExpr.re;

        if (n === undefined || !Number.isInteger(n) || n < 1)
          return ce.error('expected-positive-integer', nExpr.toString());

        const rows: BoxedExpression[] = [];
        for (let i = 0; i < n; i++) {
          const row: BoxedExpression[] = [];
          for (let j = 0; j < n; j++) {
            row.push(i === j ? ce.One : ce.Zero);
          }
          rows.push(ce.box(['List', ...row]));
        }
        return ce.box(['List', ...rows]);
      },
    },

    // Creates an m×n matrix of zeros
    ZeroMatrix: {
      complexity: 8100,
      signature: '(integer, integer?) -> matrix',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const mExpr = ops[0].evaluate();
        const m = mExpr.re;

        if (m === undefined || !Number.isInteger(m) || m < 1)
          return ce.error('expected-positive-integer', mExpr.toString());

        // If only one argument, create m×m matrix
        let n = m;
        if (ops.length > 1) {
          const nExpr = ops[1].evaluate();
          n = nExpr.re ?? m;
          if (!Number.isInteger(n) || n < 1)
            return ce.error('expected-positive-integer', nExpr.toString());
        }

        const rows: BoxedExpression[] = [];
        for (let i = 0; i < m; i++) {
          const row: BoxedExpression[] = [];
          for (let j = 0; j < n; j++) {
            row.push(ce.Zero);
          }
          rows.push(ce.box(['List', ...row]));
        }
        return ce.box(['List', ...rows]);
      },
    },

    // Creates an m×n matrix of ones
    OnesMatrix: {
      complexity: 8100,
      signature: '(integer, integer?) -> matrix',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const mExpr = ops[0].evaluate();
        const m = mExpr.re;

        if (m === undefined || !Number.isInteger(m) || m < 1)
          return ce.error('expected-positive-integer', mExpr.toString());

        // If only one argument, create m×m matrix
        let n = m;
        if (ops.length > 1) {
          const nExpr = ops[1].evaluate();
          n = nExpr.re ?? m;
          if (!Number.isInteger(n) || n < 1)
            return ce.error('expected-positive-integer', nExpr.toString());
        }

        const rows: BoxedExpression[] = [];
        for (let i = 0; i < m; i++) {
          const row: BoxedExpression[] = [];
          for (let j = 0; j < n; j++) {
            row.push(ce.One);
          }
          rows.push(ce.box(['List', ...row]));
        }
        return ce.box(['List', ...rows]);
      },
    },
  },
];

/**
 * Reshape a flat array of elements into the target shape,
 * cycling through elements if the target needs more elements than available.
 * (APL-style ravel cycling)
 */
function reshapeWithCycling(
  ce: ComputeEngine,
  flatElements: BoxedExpression[],
  targetShape: number[]
): BoxedExpression {
  const totalNeeded = targetShape.reduce((a, b) => a * b, 1);

  // Cycle the elements to fill target shape
  const cycledElements: BoxedExpression[] = [];
  for (let i = 0; i < totalNeeded; i++) {
    cycledElements.push(flatElements[i % flatElements.length]);
  }

  // Build nested structure according to target shape
  return buildNestedList(ce, cycledElements, targetShape, 0);
}

/**
 * Recursively build a nested List structure from flat data.
 */
function buildNestedList(
  ce: ComputeEngine,
  data: BoxedExpression[],
  shape: number[],
  offset: number
): BoxedExpression {
  if (shape.length === 1) {
    // Base case: return a single list
    return ce.box(['List', ...data.slice(offset, offset + shape[0])]);
  }

  // Recursive case: build lists of lists
  const outerSize = shape[0];
  const innerShape = shape.slice(1);
  const innerSize = innerShape.reduce((a, b) => a * b, 1);
  const rows: BoxedExpression[] = [];

  for (let i = 0; i < outerSize; i++) {
    rows.push(buildNestedList(ce, data, innerShape, offset + i * innerSize));
  }

  return ce.box(['List', ...rows]);
}

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
