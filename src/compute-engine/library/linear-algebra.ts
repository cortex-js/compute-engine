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
    // For rank > 2: Default swaps last two axes, or specify explicit axes
    Transpose: {
      complexity: 8200,
      signature: '(value, axis1: integer?, axis2: integer?) -> value',
      evaluate: (ops, { engine: ce }) => {
        let op1 = ops[0].evaluate();

        // Transpose of scalar is the scalar itself
        if (op1.isNumber) return op1;

        if (!isBoxedTensor(op1) && isFiniteIndexedCollection(op1))
          op1 = ce.function('List', [...op1.each()]);

        if (isBoxedTensor(op1)) {
          const rank = op1.shape.length;

          // For rank 1 (vectors), transpose is identity
          if (rank === 1) return op1;

          // Default: swap last two axes (for rank-2, that's axes 1 and 2)
          let axis1 = rank - 1; // second-to-last axis (1-based)
          let axis2 = rank; // last axis (1-based)

          if (ops.length === 3) {
            axis1 = ops[1].re ?? axis1;
            axis2 = ops[2].re ?? axis2;
            console.assert(axis1 > 0 && axis2 > 0);
          }

          if (axis1 === axis2) return op1;
          if (axis1 <= 0 || axis1 > rank) return undefined;
          if (axis2 <= 0 || axis2 > rank) return undefined;

          return op1.tensor.transpose(axis1, axis2)?.expression;
        }
        return undefined;
      },
    },

    // Conjugate transpose (Hermitian adjoint): transpose + complex conjugate
    // For rank > 2: Default swaps last two axes, or specify explicit axes
    ConjugateTranspose: {
      complexity: 8200,
      signature: '(value, axis1: integer?, axis2: integer?) -> value',
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Conjugate transpose of scalar is its conjugate
        if (op1.isNumber) return ce.box(['Conjugate', op1]).evaluate();

        if (isBoxedTensor(op1)) {
          const rank = op1.shape.length;

          // For rank 1 (vectors), conjugate transpose is just element-wise conjugate
          if (rank === 1) {
            const elements = [...op1.each()].map((el) =>
              ce.box(['Conjugate', el]).evaluate()
            );
            return ce.box(['List', ...elements]);
          }

          // Default: swap last two axes
          let axis1 = rank - 1; // second-to-last axis (1-based)
          let axis2 = rank; // last axis (1-based)

          if (ops.length === 3) {
            axis1 = ops[1].re ?? axis1;
            axis2 = ops[2].re ?? axis2;
            console.assert(axis1 > 0 && axis2 > 0);
          }

          if (axis1 === axis2) return op1;
          if (axis1 <= 0 || axis1 > rank) return undefined;
          if (axis2 <= 0 || axis2 > rank) return undefined;

          return op1.tensor.conjugateTranspose(axis1, axis2)?.expression;
        }

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

    // Trace: sum of diagonal elements
    // For matrices: returns scalar
    // For rank > 2 tensors: returns tensor of traces over last two axes (batch trace)
    // Optional axis1, axis2 to specify which axes to trace over (default: last two)
    Trace: {
      complexity: 8200,
      signature: '(value, axis1: integer?, axis2: integer?) -> value',
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Trace of scalar is the scalar itself
        if (op1.isNumber) return op1;

        if (isBoxedTensor(op1)) {
          const shape = op1.shape;

          // Vector: trace not defined
          if (shape.length === 1)
            return ce.error('expected-matrix-or-tensor', op1.toString());

          // Get optional axis parameters (1-based)
          let axis1 = shape.length - 1; // Default: second-to-last axis
          let axis2 = shape.length; // Default: last axis
          if (ops.length >= 3) {
            axis1 = ops[1].re ?? axis1;
            axis2 = ops[2].re ?? axis2;
          }

          // Validate axes are within bounds
          if (axis1 <= 0 || axis1 > shape.length)
            return ce.error('invalid-axis', axis1.toString());
          if (axis2 <= 0 || axis2 > shape.length)
            return ce.error('invalid-axis', axis2.toString());
          if (axis1 === axis2)
            return ce.error('invalid-axis', 'axes must be different');

          // Check that the two axes have the same size
          if (shape[axis1 - 1] !== shape[axis2 - 1])
            return ce.error('expected-square-matrix', op1.toString());

          const result = op1.tensor.trace(axis1, axis2);
          if (result === undefined) return undefined;

          // For scalar result (rank 2), box the value
          if (typeof result === 'number' || typeof result === 'boolean')
            return ce.box(result);

          // Check if it's a primitive value that needs boxing
          if (!('expression' in result)) return ce.box(result);

          // For tensor result (rank > 2), return the expression
          return result.expression;
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

    // Computes vector and matrix norms
    // For vectors:
    //   - L2 (Euclidean, default): √(Σ|xi|²)
    //   - L1: Σ|xi|
    //   - L∞ (max): max(|xi|)
    //   - Lp: (Σ|xi|^p)^(1/p)
    // For matrices:
    //   - Frobenius (default): √(ΣΣ|aij|²)
    Norm: {
      complexity: 8200,
      signature: '(value, number|string?) -> number',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const x = ops[0].evaluate();
        const normTypeExpr = ops.length > 1 ? ops[1].evaluate() : undefined;

        // Scalar: |x| (absolute value)
        if (x.isNumber) {
          return ce.box(['Abs', x]).evaluate();
        }

        if (!isBoxedTensor(x)) return undefined;

        const shape = x.shape;

        // Determine norm type
        let normType: number | string = 2; // Default to L2/Frobenius
        if (normTypeExpr) {
          if (
            normTypeExpr.string === 'Infinity' ||
            normTypeExpr.symbol === 'Infinity' ||
            normTypeExpr.re === Infinity
          ) {
            normType = 'infinity';
          } else if (normTypeExpr.string === 'Frobenius') {
            normType = 'frobenius';
          } else if (normTypeExpr.re !== undefined) {
            normType = normTypeExpr.re;
          }
        }

        // Vector norm (rank 1)
        if (shape.length === 1) {
          const elements: BoxedExpression[] = [];
          const n = shape[0];
          for (let i = 0; i < n; i++) {
            const val = x.tensor.at(i + 1);
            elements.push(val !== undefined ? ce.box(val) : ce.Zero);
          }

          if (normType === 1) {
            // L1 norm: sum of absolute values
            let sum: BoxedExpression = ce.Zero;
            for (const el of elements) {
              sum = sum.add(ce.box(['Abs', el]).evaluate());
            }
            return sum.evaluate();
          }

          if (normType === 2) {
            // L2 norm: sqrt of sum of squares
            let sumSq: BoxedExpression = ce.Zero;
            for (const el of elements) {
              const absEl = ce.box(['Abs', el]).evaluate();
              sumSq = sumSq.add(absEl.mul(absEl));
            }
            return ce.box(['Sqrt', sumSq]).evaluate();
          }

          if (normType === 'infinity') {
            // L∞ norm: max absolute value
            let maxVal: BoxedExpression = ce.Zero;
            for (const el of elements) {
              const absEl = ce.box(['Abs', el]).evaluate();
              // Compare: use numeric comparison
              const absNum = absEl.re ?? 0;
              const maxNum = maxVal.re ?? 0;
              if (absNum > maxNum) {
                maxVal = absEl;
              }
            }
            return maxVal;
          }

          // General Lp norm: (Σ|xi|^p)^(1/p)
          if (typeof normType === 'number' && normType > 0) {
            const p = normType;
            let sumPow: BoxedExpression = ce.Zero;
            for (const el of elements) {
              const absEl = ce.box(['Abs', el]).evaluate();
              sumPow = sumPow.add(ce.box(['Power', absEl, p]).evaluate());
            }
            // Use Root for integer p values, Power for non-integer
            // Use .N() to get numeric result for non-perfect roots
            if (Number.isInteger(p)) {
              return ce.box(['Root', sumPow, p]).N();
            }
            return ce.box(['Power', sumPow, ce.box(['Divide', 1, p])]).N();
          }

          return undefined;
        }

        // Matrix norm (rank 2)
        if (shape.length === 2) {
          const [m, n] = shape;

          // Frobenius norm (default for matrices): √(ΣΣ|aij|²)
          if (normType === 2 || normType === 'frobenius') {
            let sumSq: BoxedExpression = ce.Zero;
            for (let i = 0; i < m; i++) {
              for (let j = 0; j < n; j++) {
                const val = x.tensor.at(i + 1, j + 1);
                const el = val !== undefined ? ce.box(val) : ce.Zero;
                const absEl = ce.box(['Abs', el]).evaluate();
                sumSq = sumSq.add(absEl.mul(absEl));
              }
            }
            return ce.box(['Sqrt', sumSq]).evaluate();
          }

          // L1 (max column sum of absolute values)
          if (normType === 1) {
            let maxColSum = 0;
            for (let j = 0; j < n; j++) {
              let colSum = 0;
              for (let i = 0; i < m; i++) {
                const val = x.tensor.at(i + 1, j + 1);
                const el = val !== undefined ? ce.box(val) : ce.Zero;
                const absEl = ce.box(['Abs', el]).evaluate();
                colSum += absEl.re ?? 0;
              }
              if (colSum > maxColSum) maxColSum = colSum;
            }
            return ce.number(maxColSum);
          }

          // L∞ (max row sum of absolute values)
          if (normType === 'infinity') {
            let maxRowSum = 0;
            for (let i = 0; i < m; i++) {
              let rowSum = 0;
              for (let j = 0; j < n; j++) {
                const val = x.tensor.at(i + 1, j + 1);
                const el = val !== undefined ? ce.box(val) : ce.Zero;
                const absEl = ce.box(['Abs', el]).evaluate();
                rowSum += absEl.re ?? 0;
              }
              if (rowSum > maxRowSum) maxRowSum = rowSum;
            }
            return ce.number(maxRowSum);
          }

          return undefined;
        }

        // Higher-rank tensors: not supported yet
        return undefined;
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
