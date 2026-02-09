import { parseType } from '../../common/type/parse';
import { isSubtype } from '../../common/type/subtype';
import { ListType } from '../../common/type/types';
import { isBoxedTensor } from '../boxed-expression/boxed-tensor';
import { totalDegree } from '../boxed-expression/polynomial-degree';
import { checkArity } from '../boxed-expression/validate';
import { isFiniteIndexedCollection } from '../collection-utils';
import {
  BoxedExpression,
  IComputeEngine as ComputeEngine,
  SymbolDefinitions,
  Sign,
} from '../global-types';
import {
  isBoxedFunction,
  isBoxedString,
  isBoxedSymbol,
} from '../boxed-expression/type-guards';

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
        const shapeOps = isBoxedFunction(shape) ? shape.ops : undefined;
        if (value.isNumber) {
          // Scalar input
          return parseType(
            `list<number^${shapeOps?.map((x) => x.toString()).join('x') ?? ''}>`
          );
        }
        if (!value.type.matches('list')) return 'nothing';
        const col = value.type.type as ListType;
        if (!isSubtype(col.elements, 'number')) return 'nothing';
        return parseType(
          `list<number^${shapeOps?.map((x) => x.toString()).join('x') ?? ''}>`
        );
      },
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        let op1 = ops[0].evaluate();
        const targetShape = isBoxedFunction(ops[1])
          ? ops[1].ops.map((op) => op.re)
          : [];

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
        const op1 = ops[0].evaluate();

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
          if (op1.is(0)) return ce.Zero;
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
          if (typeof result === 'number') return ce.box(result);
          if (typeof result === 'boolean') return result ? ce.True : ce.False;

          // Check if it's a primitive value that needs boxing
          if (!('expression' in result)) return ce.box(result);

          // For tensor result (rank > 2), return the expression
          return result.expression;
        }

        return undefined;
      },
    },

    Kernel: {
      description: 'Kernel (null space) of a linear map',
      complexity: 8200,
      signature: '(value) -> list',
      evaluate: ([map], { engine: ce }) => {
        const op = map.evaluate();

        // Kernel of scalar map x -> a*x over R
        if (op.isNumber) {
          if (op.is(0)) return ce.box(['List', ['List', 1]]);
          return ce.box(['List']);
        }

        if (!isBoxedTensor(op)) return undefined;

        // Interpret vectors as 1×n matrices (linear forms)
        const shape = op.shape;
        if (shape.length > 2) return ce.error('expected-matrix', op.toString());

        const rowCount = shape.length === 1 ? 1 : shape[0];
        const columnCount = shape.length === 1 ? shape[0] : shape[1];
        const matrix = tensorToNumericMatrix(op, rowCount, columnCount);
        if (!matrix) return undefined;

        const basis = computeNullSpaceBasis(matrix);
        return ce.box([
          'List',
          ...basis.map((vector) =>
            ce.box(['List', ...vector.map((x) => ce.number(ce.chop(x)))])
          ),
        ]);
      },
    },

    Dimension: {
      description: 'Dimension of an object',
      complexity: 8200,
      signature: '(value) -> integer',
      sgn: (): Sign => 'non-negative',
      evaluate: ([object], { engine: ce }) => {
        const op = object.evaluate();

        // Structural check on the *unevaluated* expression: we pattern-match
        // on the literal Kernel(...) / Hom(...) form so that
        // Dimension(Kernel(M)) can compute the nullity directly from the
        // kernel basis.  If the kernel was computed earlier and stored in a
        // symbol this branch won't fire, which is acceptable — the generic
        // finiteDimension path below will handle it.
        if (isBoxedFunction(object) && object.operator === 'Kernel') {
          const kernelDim = kernelBasisDimension(op);
          if (kernelDim !== undefined) return ce.number(kernelDim);
        }

        // dim(Hom(V, W)) = dim(V) * dim(W) for finite-dimensional objects.
        // Same structural matching caveat as Kernel above.
        if (
          isBoxedFunction(object) &&
          object.operator === 'Hom' &&
          object.ops.length >= 2
        ) {
          const domainDim = finiteDimension(object.ops[0].evaluate());
          const codomainDim = finiteDimension(object.ops[1].evaluate());
          if (domainDim !== undefined && codomainDim !== undefined)
            return ce.number(domainDim * codomainDim);
        }

        const dim = finiteDimension(op);
        if (dim !== undefined) return ce.number(dim);

        return undefined;
      },
    },

    Degree: {
      description: 'Degree of an object',
      complexity: 8200,
      signature: '(value) -> integer',
      sgn: (): Sign => 'non-negative',
      evaluate: ([object], { engine: ce }) => {
        const op = object.evaluate();

        // Constants have degree 0
        if (op.unknowns.length === 0) return ce.Zero;

        // A bare symbol is ambiguous (variable vs named polynomial object),
        // keep it symbolic.
        if (isBoxedSymbol(op) && !op.isConstant) return undefined;

        if (!isPolynomialExpression(op)) return undefined;

        return ce.number(totalDegree(op));
      },
    },

    Hom: {
      description: 'Hom-set of morphisms between objects',
      complexity: 8200,
      signature: '(value*) -> value',
      evaluate: (ops, { engine: ce }) => {
        return ce._fn(
          'Hom',
          ops.map((op) => op.evaluate())
        );
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
            return ce.error('incompatible-dimensions', `${n} vs ${shapeB[0]}`);

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
            return ce.error('incompatible-dimensions', `${shapeA[0]} vs ${m}`);

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
            return ce.error('incompatible-dimensions', `${n1} vs ${n2}`);

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
          const normStr = isBoxedString(normTypeExpr)
            ? normTypeExpr.string
            : undefined;
          const normSym = isBoxedSymbol(normTypeExpr)
            ? normTypeExpr.symbol
            : undefined;
          if (
            normStr === 'Infinity' ||
            normSym === 'Infinity' ||
            normTypeExpr.re === Infinity
          ) {
            normType = 'infinity';
          } else if (normStr === 'Frobenius') {
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

    // Compute the eigenvalues of a square matrix
    // For 2×2 matrices: uses characteristic polynomial (symbolic)
    // For larger matrices: uses QR algorithm (numeric)
    Eigenvalues: {
      complexity: 8500,
      signature: '(matrix) -> list',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const M = ops[0].evaluate();

        if (!isBoxedTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a square matrix
        if (shape.length !== 2 || shape[0] !== shape[1]) {
          return ce.error('expected-square-matrix', M.toString());
        }

        const n = shape[0];

        // Special case: 1×1 matrix
        if (n === 1) {
          const val = M.tensor.at(1, 1);
          return ce.box(['List', val !== undefined ? ce.box(val) : ce.Zero]);
        }

        // Check if matrix is diagonal or triangular (eigenvalues are diagonal elements)
        const isDiagonalOrTriangular = checkDiagonalOrTriangular(M, n);
        if (isDiagonalOrTriangular) {
          const eigenvalues: BoxedExpression[] = [];
          for (let i = 0; i < n; i++) {
            const val = M.tensor.at(i + 1, i + 1);
            eigenvalues.push(val !== undefined ? ce.box(val) : ce.Zero);
          }
          return ce.box(['List', ...eigenvalues]);
        }

        // 2×2 case: solve characteristic polynomial analytically
        if (n === 2) {
          const a = getElement(M, 1, 1, ce);
          const b = getElement(M, 1, 2, ce);
          const c = getElement(M, 2, 1, ce);
          const d = getElement(M, 2, 2, ce);

          // trace = a + d
          const trace = a.add(d);
          // det = ad - bc
          const det = a.mul(d).sub(b.mul(c));
          // discriminant = trace² - 4*det
          const disc = trace.mul(trace).sub(det.mul(ce.number(4)));

          // λ = (trace ± √disc) / 2
          const sqrtDisc = ce.box(['Sqrt', disc]).evaluate();
          const lambda1 = trace.add(sqrtDisc).div(ce.number(2)).evaluate();
          const lambda2 = trace.sub(sqrtDisc).div(ce.number(2)).evaluate();

          return ce.box(['List', lambda1, lambda2]);
        }

        // 3×3 case: solve cubic characteristic polynomial
        if (n === 3) {
          return computeEigenvalues3x3(M, ce);
        }

        // For larger matrices: use numeric QR algorithm
        return computeEigenvaluesQR(M, n, ce);
      },
    },

    // Compute the eigenvectors of a square matrix
    // Returns a list of eigenvectors (as column vectors)
    Eigenvectors: {
      complexity: 8600,
      signature: '(matrix) -> list',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const M = ops[0].evaluate();

        if (!isBoxedTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a square matrix
        if (shape.length !== 2 || shape[0] !== shape[1]) {
          return ce.error('expected-square-matrix', M.toString());
        }

        const n = shape[0];

        // First compute eigenvalues
        const eigenvaluesExpr = ce.box(['Eigenvalues', M]).evaluate();
        if (
          eigenvaluesExpr.operator !== 'List' ||
          !isBoxedFunction(eigenvaluesExpr) ||
          eigenvaluesExpr.ops.length === 0
        ) {
          return undefined;
        }

        const eigenvalues = eigenvaluesExpr.ops;

        // For each eigenvalue, compute the corresponding eigenvector
        const eigenvectors: BoxedExpression[] = [];
        for (const lambda of eigenvalues) {
          const eigenvector = computeEigenvector(M, lambda, n, ce);
          if (eigenvector) {
            eigenvectors.push(eigenvector);
          } else {
            // If we can't compute the eigenvector, return undefined
            return undefined;
          }
        }

        return ce.box(['List', ...eigenvectors]);
      },
    },

    // Compute both eigenvalues and eigenvectors
    // Returns a tuple: [eigenvalues, eigenvectors]
    Eigen: {
      complexity: 8700,
      signature: '(matrix) -> tuple',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const M = ops[0].evaluate();

        if (!isBoxedTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a square matrix
        if (shape.length !== 2 || shape[0] !== shape[1]) {
          return ce.error('expected-square-matrix', M.toString());
        }

        const eigenvalues = ce.box(['Eigenvalues', M]).evaluate();
        const eigenvectors = ce.box(['Eigenvectors', M]).evaluate();

        if (eigenvalues.operator === 'Error') return eigenvalues;
        if (eigenvectors.operator === 'Error') return eigenvectors;

        return ce.box(['Tuple', eigenvalues, eigenvectors]);
      },
    },

    // LU Decomposition: A = LU (or PA = LU with pivoting)
    // Returns [L, U] for no pivoting or [P, L, U] with pivoting
    LUDecomposition: {
      complexity: 8600,
      signature: '(matrix) -> tuple',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const M = ops[0].evaluate();

        if (!isBoxedTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a square matrix
        if (shape.length !== 2 || shape[0] !== shape[1]) {
          return ce.error('expected-square-matrix', M.toString());
        }

        const n = shape[0];
        const result = computeLU(M, n, ce);
        if (!result) return undefined;

        const { P, L, U } = result;
        return ce.box(['Tuple', P, L, U]);
      },
    },

    // QR Decomposition: A = QR
    // Returns [Q, R] where Q is orthogonal and R is upper triangular
    QRDecomposition: {
      complexity: 8600,
      signature: '(matrix) -> tuple',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const M = ops[0].evaluate();

        if (!isBoxedTensor(M)) return undefined;

        const shape = M.shape;
        // Must be at least a 2D matrix
        if (shape.length !== 2) {
          return ce.error('expected-matrix', M.toString());
        }

        const [m, n] = shape;
        const result = computeQR(M, m, n, ce);
        if (!result) return undefined;

        const { Q, R } = result;
        return ce.box(['Tuple', Q, R]);
      },
    },

    // Cholesky Decomposition: A = LL^T (for positive definite matrices)
    // Returns L (lower triangular matrix)
    CholeskyDecomposition: {
      complexity: 8600,
      signature: '(matrix) -> matrix',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const M = ops[0].evaluate();

        if (!isBoxedTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a square matrix
        if (shape.length !== 2 || shape[0] !== shape[1]) {
          return ce.error('expected-square-matrix', M.toString());
        }

        const n = shape[0];
        return computeCholesky(M, n, ce);
      },
    },

    // Singular Value Decomposition: A = UΣV^T
    // Returns [U, Σ, V] where U and V are orthogonal, Σ is diagonal
    SVD: {
      complexity: 8700,
      signature: '(matrix) -> tuple',
      evaluate: (ops, { engine: ce }): BoxedExpression | undefined => {
        const M = ops[0].evaluate();

        if (!isBoxedTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a 2D matrix
        if (shape.length !== 2) {
          return ce.error('expected-matrix', M.toString());
        }

        const [m, n] = shape;
        const result = computeSVD(M, m, n, ce);
        if (!result) return undefined;

        const { U, S, V } = result;
        return ce.box(['Tuple', U, S, V]);
      },
    },
  },
];

/**
 * Compute LU decomposition with partial pivoting
 * Returns P, L, U such that PA = LU
 */
function computeLU(
  M: BoxedExpression,
  n: number,
  ce: ComputeEngine
): { P: BoxedExpression; L: BoxedExpression; U: BoxedExpression } | undefined {
  if (!isBoxedTensor(M)) return undefined;

  // Convert matrix to numeric array
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    A[i] = [];
    for (let j = 0; j < n; j++) {
      const val = M.tensor.at(i + 1, j + 1);
      const num =
        typeof val === 'number'
          ? val
          : typeof val === 'object' && 're' in val
            ? (val.re ?? 0)
            : 0;
      if (isNaN(num)) return undefined;
      A[i][j] = num;
    }
  }

  // Initialize L as identity, U as copy of A, P as identity permutation
  const L: number[][] = Array(n)
    .fill(null)
    .map((_, i) =>
      Array(n)
        .fill(0)
        .map((_, j) => (i === j ? 1 : 0))
    );
  const U: number[][] = A.map((row) => [...row]);
  const perm: number[] = Array(n)
    .fill(0)
    .map((_, i) => i);

  const eps = 1e-10;

  // Gaussian elimination with partial pivoting
  for (let k = 0; k < n - 1; k++) {
    // Find pivot
    let maxVal = Math.abs(U[k][k]);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(U[i][k]) > maxVal) {
        maxVal = Math.abs(U[i][k]);
        maxRow = i;
      }
    }

    if (maxVal < eps) continue; // Skip if column is zero

    // Swap rows in U and L (for L, only the part that's been filled)
    if (maxRow !== k) {
      [U[k], U[maxRow]] = [U[maxRow], U[k]];
      [perm[k], perm[maxRow]] = [perm[maxRow], perm[k]];
      // Swap the L entries for columns 0 to k-1
      for (let j = 0; j < k; j++) {
        [L[k][j], L[maxRow][j]] = [L[maxRow][j], L[k][j]];
      }
    }

    // Elimination
    for (let i = k + 1; i < n; i++) {
      const factor = U[i][k] / U[k][k];
      L[i][k] = factor;
      for (let j = k; j < n; j++) {
        U[i][j] -= factor * U[k][j];
      }
    }
  }

  // Build permutation matrix P
  const P: BoxedExpression[][] = [];
  for (let i = 0; i < n; i++) {
    P[i] = [];
    for (let j = 0; j < n; j++) {
      P[i][j] = perm[i] === j ? ce.One : ce.Zero;
    }
  }

  // Build result matrices
  const PExpr = ce.box(['List', ...P.map((row) => ce.box(['List', ...row]))]);
  const LExpr = ce.box([
    'List',
    ...L.map((row) => ce.box(['List', ...row.map((x) => ce.number(x))])),
  ]);
  const UExpr = ce.box([
    'List',
    ...U.map((row) => ce.box(['List', ...row.map((x) => ce.number(x))])),
  ]);

  return { P: PExpr, L: LExpr, U: UExpr };
}

/**
 * Compute QR decomposition using Gram-Schmidt process
 * For m×n matrix, returns Q (m×m orthogonal) and R (m×n upper triangular)
 */
function computeQR(
  M: BoxedExpression,
  m: number,
  n: number,
  ce: ComputeEngine
): { Q: BoxedExpression; R: BoxedExpression } | undefined {
  if (!isBoxedTensor(M)) return undefined;

  // Convert matrix to numeric array
  const A: number[][] = [];
  for (let i = 0; i < m; i++) {
    A[i] = [];
    for (let j = 0; j < n; j++) {
      const val = M.tensor.at(i + 1, j + 1);
      const num =
        typeof val === 'number'
          ? val
          : typeof val === 'object' && 're' in val
            ? (val.re ?? 0)
            : 0;
      if (isNaN(num)) return undefined;
      A[i][j] = num;
    }
  }

  // Use Householder reflections for better numerical stability
  const Q: number[][] = Array(m)
    .fill(null)
    .map((_, i) =>
      Array(m)
        .fill(0)
        .map((_, j) => (i === j ? 1 : 0))
    );
  const R: number[][] = A.map((row) => [...row]);

  const minMN = Math.min(m, n);

  for (let k = 0; k < minMN; k++) {
    // Compute the Householder vector for column k
    let norm = 0;
    for (let i = k; i < m; i++) {
      norm += R[i][k] * R[i][k];
    }
    norm = Math.sqrt(norm);

    if (norm < 1e-10) continue;

    const sign = R[k][k] >= 0 ? 1 : -1;
    const u0 = R[k][k] + sign * norm;

    // Compute v = [u0, R[k+1][k], ..., R[m-1][k]] / u0
    const v: number[] = Array(m).fill(0);
    v[k] = 1;
    for (let i = k + 1; i < m; i++) {
      v[i] = R[i][k] / u0;
    }

    // beta = 2 / (v'v)
    let vTv = 1;
    for (let i = k + 1; i < m; i++) {
      vTv += v[i] * v[i];
    }
    const beta = 2 / vTv;

    // Apply H = I - beta * v * v' to R
    for (let j = k; j < n; j++) {
      let vTr = 0;
      for (let i = k; i < m; i++) {
        vTr += v[i] * R[i][j];
      }
      for (let i = k; i < m; i++) {
        R[i][j] -= beta * v[i] * vTr;
      }
    }

    // Apply H to Q (Q = Q * H)
    for (let i = 0; i < m; i++) {
      let qTv = 0;
      for (let j = k; j < m; j++) {
        qTv += Q[i][j] * v[j];
      }
      for (let j = k; j < m; j++) {
        Q[i][j] -= beta * qTv * v[j];
      }
    }
  }

  // Clean up small values in R below diagonal
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < Math.min(i, n); j++) {
      if (Math.abs(R[i][j]) < 1e-10) R[i][j] = 0;
    }
  }

  // Build result matrices
  const QExpr = ce.box([
    'List',
    ...Q.map((row) => ce.box(['List', ...row.map((x) => ce.number(x))])),
  ]);
  const RExpr = ce.box([
    'List',
    ...R.map((row) => ce.box(['List', ...row.map((x) => ce.number(x))])),
  ]);

  return { Q: QExpr, R: RExpr };
}

/**
 * Compute Cholesky decomposition: A = LL^T
 * Only works for positive definite matrices
 */
function computeCholesky(
  M: BoxedExpression,
  n: number,
  ce: ComputeEngine
): BoxedExpression | undefined {
  if (!isBoxedTensor(M)) return undefined;

  // Convert matrix to numeric array
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    A[i] = [];
    for (let j = 0; j < n; j++) {
      const val = M.tensor.at(i + 1, j + 1);
      const num =
        typeof val === 'number'
          ? val
          : typeof val === 'object' && 're' in val
            ? (val.re ?? 0)
            : 0;
      if (isNaN(num)) return undefined;
      A[i][j] = num;
    }
  }

  // Initialize L as zero matrix
  const L: number[][] = Array(n)
    .fill(null)
    .map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;

      if (j === i) {
        // Diagonal element
        for (let k = 0; k < j; k++) {
          sum += L[j][k] * L[j][k];
        }
        const val = A[j][j] - sum;
        if (val < 0) {
          // Matrix is not positive definite
          return ce.error('expected-positive-definite-matrix', M.toString());
        }
        L[j][j] = Math.sqrt(val);
      } else {
        // Off-diagonal element
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }
        if (Math.abs(L[j][j]) < 1e-10) {
          return ce.error('expected-positive-definite-matrix', M.toString());
        }
        L[i][j] = (A[i][j] - sum) / L[j][j];
      }
    }
  }

  // Build result matrix
  return ce.box([
    'List',
    ...L.map((row) => ce.box(['List', ...row.map((x) => ce.number(x))])),
  ]);
}

/**
 * Compute Singular Value Decomposition: A = UΣV^T
 * Uses iterative algorithm based on QR iteration
 */
function computeSVD(
  M: BoxedExpression,
  m: number,
  n: number,
  ce: ComputeEngine
): { U: BoxedExpression; S: BoxedExpression; V: BoxedExpression } | undefined {
  if (!isBoxedTensor(M)) return undefined;

  // Convert matrix to numeric array
  const A: number[][] = [];
  for (let i = 0; i < m; i++) {
    A[i] = [];
    for (let j = 0; j < n; j++) {
      const val = M.tensor.at(i + 1, j + 1);
      const num =
        typeof val === 'number'
          ? val
          : typeof val === 'object' && 're' in val
            ? (val.re ?? 0)
            : 0;
      if (isNaN(num)) return undefined;
      A[i][j] = num;
    }
  }

  // Compute A^T * A for right singular vectors
  const AtA: number[][] = Array(n)
    .fill(null)
    .map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < m; k++) {
        AtA[i][j] += A[k][i] * A[k][j];
      }
    }
  }

  // Compute A * A^T for left singular vectors
  const AAt: number[][] = Array(m)
    .fill(null)
    .map(() => Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < n; k++) {
        AAt[i][j] += A[i][k] * A[j][k];
      }
    }
  }

  // Use QR iteration to find eigenvalues/eigenvectors of A^T*A
  const maxIter = 100;
  const tol = 1e-10;

  // Initialize V as identity
  let V: number[][] = Array(n)
    .fill(null)
    .map((_, i) =>
      Array(n)
        .fill(0)
        .map((_, j) => (i === j ? 1 : 0))
    );
  let B = AtA.map((row) => [...row]);

  for (let iter = 0; iter < maxIter; iter++) {
    // QR decomposition of B
    const { Q, R } = qrDecomposition(B, n);

    // B = R * Q
    const newB: number[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < n; k++) {
          newB[i][j] += R[i][k] * Q[k][j];
        }
      }
    }

    // V = V * Q
    const newV: number[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < n; k++) {
          newV[i][j] += V[i][k] * Q[k][j];
        }
      }
    }

    // Check convergence
    let maxOffDiag = 0;
    for (let i = 1; i < n; i++) {
      for (let j = 0; j < i; j++) {
        maxOffDiag = Math.max(maxOffDiag, Math.abs(newB[i][j]));
      }
    }

    B = newB;
    V = newV;

    if (maxOffDiag < tol) break;
  }

  // Singular values are sqrt of diagonal of B (eigenvalues of A^T*A)
  const singularValues: number[] = [];
  for (let i = 0; i < n; i++) {
    singularValues.push(Math.sqrt(Math.max(0, B[i][i])));
  }

  // Compute U = A * V * Σ^(-1)
  const U: number[][] = Array(m)
    .fill(null)
    .map(() => Array(m).fill(0));

  for (let j = 0; j < Math.min(m, n); j++) {
    if (singularValues[j] > tol) {
      // Compute j-th column of U
      for (let i = 0; i < m; i++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += A[i][k] * V[k][j];
        }
        U[i][j] = sum / singularValues[j];
      }
    }
  }

  // Complete U to orthogonal basis if m > n
  if (m > n) {
    // Use Gram-Schmidt to add orthogonal columns
    for (let j = n; j < m; j++) {
      // Start with a unit vector
      const col: number[] = Array(m).fill(0);
      col[j] = 1;

      // Orthogonalize against existing columns
      for (let k = 0; k < j; k++) {
        let dotProd = 0;
        for (let i = 0; i < m; i++) {
          dotProd += col[i] * U[i][k];
        }
        for (let i = 0; i < m; i++) {
          col[i] -= dotProd * U[i][k];
        }
      }

      // Normalize
      let norm = 0;
      for (let i = 0; i < m; i++) {
        norm += col[i] * col[i];
      }
      norm = Math.sqrt(norm);
      if (norm > tol) {
        for (let i = 0; i < m; i++) {
          U[i][j] = col[i] / norm;
        }
      }
    }
  }

  // Build Σ matrix (m x n diagonal matrix)
  const S: number[][] = Array(m)
    .fill(null)
    .map(() => Array(n).fill(0));
  for (let i = 0; i < Math.min(m, n); i++) {
    S[i][i] = singularValues[i];
  }

  // Build result matrices
  const UExpr = ce.box([
    'List',
    ...U.map((row) => ce.box(['List', ...row.map((x) => ce.number(x))])),
  ]);
  const SExpr = ce.box([
    'List',
    ...S.map((row) => ce.box(['List', ...row.map((x) => ce.number(x))])),
  ]);
  const VExpr = ce.box([
    'List',
    ...V.map((row) => ce.box(['List', ...row.map((x) => ce.number(x))])),
  ]);

  return { U: UExpr, S: SExpr, V: VExpr };
}

/**
 * Get element from matrix at 1-based indices
 */
function getElement(
  M: BoxedExpression,
  i: number,
  j: number,
  ce: ComputeEngine
): BoxedExpression {
  if (!isBoxedTensor(M)) return ce.Zero;
  const val = M.tensor.at(i, j);
  return val !== undefined ? ce.box(val) : ce.Zero;
}

/**
 * Check if matrix is diagonal or triangular
 */
function checkDiagonalOrTriangular(M: BoxedExpression, n: number): boolean {
  if (!isBoxedTensor(M)) return false;

  let isUpperTriangular = true;
  let isLowerTriangular = true;

  for (let i = 0; i < n && (isUpperTriangular || isLowerTriangular); i++) {
    for (let j = 0; j < n; j++) {
      const val = M.tensor.at(i + 1, j + 1);
      const isZero =
        val === undefined ||
        val === 0 ||
        (typeof val === 'object' && 're' in val && val.re === 0);

      if (i > j && !isZero) isUpperTriangular = false;
      if (i < j && !isZero) isLowerTriangular = false;
    }
  }

  return isUpperTriangular || isLowerTriangular;
}

/**
 * Compute eigenvalues for a 3×3 matrix using Cardano's formula
 */
function computeEigenvalues3x3(
  M: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | undefined {
  if (!isBoxedTensor(M)) return undefined;

  // Get matrix elements
  const a11 = getElement(M, 1, 1, ce).re ?? 0;
  const a12 = getElement(M, 1, 2, ce).re ?? 0;
  const a13 = getElement(M, 1, 3, ce).re ?? 0;
  const a21 = getElement(M, 2, 1, ce).re ?? 0;
  const a22 = getElement(M, 2, 2, ce).re ?? 0;
  const a23 = getElement(M, 2, 3, ce).re ?? 0;
  const a31 = getElement(M, 3, 1, ce).re ?? 0;
  const a32 = getElement(M, 3, 2, ce).re ?? 0;
  const a33 = getElement(M, 3, 3, ce).re ?? 0;

  // If any element is not numeric, fall back to QR
  if (
    [a11, a12, a13, a21, a22, a23, a31, a32, a33].some(
      (x) => x === undefined || isNaN(x)
    )
  ) {
    return computeEigenvaluesQR(M, 3, ce);
  }

  // Characteristic polynomial: -λ³ + c₂λ² + c₁λ + c₀ = 0
  // where c₂ = trace(A), c₁ = -(minor sums), c₀ = det(A)
  const trace = a11 + a22 + a33;

  // Sum of principal 2×2 minors
  const m1 = a11 * a22 - a12 * a21;
  const m2 = a11 * a33 - a13 * a31;
  const m3 = a22 * a33 - a23 * a32;
  const minorSum = m1 + m2 + m3;

  // Determinant
  const det =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31);

  // Convert to depressed cubic t³ + pt + q = 0 where λ = t + trace/3
  const p = minorSum - (trace * trace) / 3;
  const q = (2 * trace * trace * trace) / 27 - (trace * minorSum) / 3 + det;

  // Solve using Cardano's formula or trigonometric method
  const eigenvalues = solveCubic(p, q, trace / 3);

  return ce.box([
    'List',
    ce.number(eigenvalues[0]),
    ce.number(eigenvalues[1]),
    ce.number(eigenvalues[2]),
  ]);
}

/**
 * Solve depressed cubic t³ + pt + q = 0, return roots shifted by shift
 */
function solveCubic(p: number, q: number, shift: number): number[] {
  const eps = 1e-10;

  // Check for special cases
  if (Math.abs(p) < eps && Math.abs(q) < eps) {
    return [shift, shift, shift];
  }

  const discriminant = (q * q) / 4 + (p * p * p) / 27;

  if (discriminant > eps) {
    // One real root, two complex conjugates
    const sqrtD = Math.sqrt(discriminant);
    const u = Math.cbrt(-q / 2 + sqrtD);
    const v = Math.cbrt(-q / 2 - sqrtD);
    const realRoot = u + v + shift;
    // Return only real part for complex roots (they come in conjugate pairs)
    const realPart = -(u + v) / 2 + shift;
    return [realRoot, realPart, realPart];
  } else if (discriminant < -eps) {
    // Three distinct real roots - use trigonometric method
    const r = Math.sqrt((-p * p * p) / 27);
    const theta = Math.acos(-q / 2 / r);
    const cbrtR = Math.cbrt(r);

    const t1 = 2 * cbrtR * Math.cos(theta / 3);
    const t2 = 2 * cbrtR * Math.cos((theta + 2 * Math.PI) / 3);
    const t3 = 2 * cbrtR * Math.cos((theta + 4 * Math.PI) / 3);

    return [t1 + shift, t2 + shift, t3 + shift];
  } else {
    // Discriminant ≈ 0: repeated root
    const u = Math.cbrt(-q / 2);
    return [2 * u + shift, -u + shift, -u + shift];
  }
}

/**
 * Compute eigenvalues using QR algorithm (numeric)
 */
function computeEigenvaluesQR(
  M: BoxedExpression,
  n: number,
  ce: ComputeEngine
): BoxedExpression | undefined {
  if (!isBoxedTensor(M)) return undefined;

  // Convert matrix to numeric array
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    A[i] = [];
    for (let j = 0; j < n; j++) {
      const val = M.tensor.at(i + 1, j + 1);
      const num =
        typeof val === 'number'
          ? val
          : typeof val === 'object' && 're' in val
            ? (val.re ?? 0)
            : 0;
      if (isNaN(num)) return undefined; // Can't compute numerically
      A[i][j] = num;
    }
  }

  // QR iteration
  const maxIterations = 100;
  const tolerance = 1e-10;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Check for convergence (matrix is nearly upper triangular)
    let maxOffDiag = 0;
    for (let i = 1; i < n; i++) {
      for (let j = 0; j < i; j++) {
        maxOffDiag = Math.max(maxOffDiag, Math.abs(A[i][j]));
      }
    }
    if (maxOffDiag < tolerance) break;

    // QR decomposition using Gram-Schmidt
    const { Q, R } = qrDecomposition(A, n);

    // A = R * Q
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        A[i][j] = 0;
        for (let k = 0; k < n; k++) {
          A[i][j] += R[i][k] * Q[k][j];
        }
      }
    }
  }

  // Eigenvalues are on the diagonal
  const eigenvalues: BoxedExpression[] = [];
  for (let i = 0; i < n; i++) {
    eigenvalues.push(ce.number(A[i][i]));
  }

  return ce.box(['List', ...eigenvalues]);
}

/**
 * QR decomposition using Gram-Schmidt process
 */
function qrDecomposition(
  A: number[][],
  n: number
): { Q: number[][]; R: number[][] } {
  const Q: number[][] = Array(n)
    .fill(null)
    .map(() => Array(n).fill(0));
  const R: number[][] = Array(n)
    .fill(null)
    .map(() => Array(n).fill(0));

  // Copy columns of A
  const columns: number[][] = [];
  for (let j = 0; j < n; j++) {
    columns[j] = [];
    for (let i = 0; i < n; i++) {
      columns[j][i] = A[i][j];
    }
  }

  // Gram-Schmidt orthogonalization
  const U: number[][] = [];
  for (let j = 0; j < n; j++) {
    U[j] = [...columns[j]];

    // Subtract projections onto previous vectors
    for (let k = 0; k < j; k++) {
      const dotUU = dot(U[k], U[k]);
      if (Math.abs(dotUU) > 1e-10) {
        const proj = dot(columns[j], U[k]) / dotUU;
        R[k][j] = proj * Math.sqrt(dotUU);
        for (let i = 0; i < n; i++) {
          U[j][i] -= proj * U[k][i];
        }
      }
    }

    // Normalize
    const norm = Math.sqrt(dot(U[j], U[j]));
    R[j][j] = norm;
    if (norm > 1e-10) {
      for (let i = 0; i < n; i++) {
        Q[i][j] = U[j][i] / norm;
      }
    }
  }

  return { Q, R };
}

/**
 * Dot product of two vectors
 */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Compute eigenvector for a given eigenvalue
 */
function computeEigenvector(
  M: BoxedExpression,
  lambda: BoxedExpression,
  n: number,
  ce: ComputeEngine
): BoxedExpression | undefined {
  if (!isBoxedTensor(M)) return undefined;

  const lambdaNum = lambda.re;
  if (lambdaNum === undefined || isNaN(lambdaNum)) {
    // Try symbolic computation for 2×2
    if (n === 2) {
      return computeEigenvector2x2Symbolic(M, lambda, ce);
    }
    return undefined;
  }

  // Build (A - λI) matrix
  const AminusLambdaI: number[][] = [];
  for (let i = 0; i < n; i++) {
    AminusLambdaI[i] = [];
    for (let j = 0; j < n; j++) {
      const num = asRealNumber(M.tensor.at(i + 1, j + 1)) ?? 0;
      AminusLambdaI[i][j] = num - (i === j ? lambdaNum : 0);
    }
  }

  // Solve (A - λI)v = 0 using Gaussian elimination to find null space
  const eigenvector = solveNullSpace(AminusLambdaI, n);
  if (!eigenvector) return undefined;

  return ce.box(['List', ...eigenvector.map((x) => ce.number(x))]);
}

/**
 * Compute eigenvector for 2×2 matrix symbolically
 */
function computeEigenvector2x2Symbolic(
  M: BoxedExpression,
  lambda: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | undefined {
  if (!isBoxedTensor(M)) return undefined;

  const a = getElement(M, 1, 1, ce);
  const b = getElement(M, 1, 2, ce);
  const c = getElement(M, 2, 1, ce);

  // (A - λI)v = 0
  // First row: (a - λ)v₁ + b*v₂ = 0
  // If b ≠ 0: v = [b, λ - a] (or [-b, a - λ])
  // If b = 0 and c ≠ 0: v = [λ - d, c]
  // If b = 0 and c = 0: v = [1, 0] or [0, 1]

  const bVal = b.re;
  if (bVal !== undefined && Math.abs(bVal) > 1e-10) {
    // v = [b, λ - a]
    const v2 = lambda.sub(a).evaluate();
    return ce.box(['List', b, v2]);
  }

  const cVal = c.re;
  if (cVal !== undefined && Math.abs(cVal) > 1e-10) {
    // v = [λ - d, c]
    const d = getElement(M, 2, 2, ce);
    const v1 = lambda.sub(d).evaluate();
    return ce.box(['List', v1, c]);
  }

  // Diagonal matrix case
  const aVal = a.re;
  const lambdaVal = lambda.re;
  if (aVal !== undefined && lambdaVal !== undefined) {
    if (Math.abs(aVal - lambdaVal) < 1e-10) {
      return ce.box(['List', ce.One, ce.Zero]);
    } else {
      return ce.box(['List', ce.Zero, ce.One]);
    }
  }

  return undefined;
}

/**
 * Find a non-trivial solution to Ax = 0 (null space vector).
 * Delegates to computeNullSpaceBasis and returns the first basis vector,
 * normalized to unit length.
 */
function solveNullSpace(A: number[][], n: number): number[] | undefined {
  const basis = computeNullSpaceBasis(A);
  if (basis.length === 0) {
    // Matrix has full rank, no null space (shouldn't happen for eigenvalue).
    // Return unit vector as fallback.
    const result = Array(n).fill(0);
    result[0] = 1;
    return result;
  }

  const result = basis[0];

  // Normalize to unit length
  let norm = 0;
  for (let i = 0; i < result.length; i++) norm += result[i] * result[i];
  norm = Math.sqrt(norm);
  if (norm > 1e-10) {
    for (let i = 0; i < result.length; i++) result[i] /= norm;
  }

  return result;
}

/**
 * Convert a raw tensor storage value to a JS number.
 *
 * `tensor.tensor.at()` (AbstractTensor.at) returns raw storage values
 * whose type depends on the tensor's dtype: number for float64,
 * {re, im} for complex128, boolean for bool, or BoxedExpression for
 * expression tensors. This function handles all those cases via
 * duck-typing, which is the appropriate strategy for raw storage values.
 */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof value.toNumber === 'function'
  ) {
    const n = value.toNumber();
    return typeof n === 'number' ? n : undefined;
  }
  return undefined;
}

/**
 * Convert a tensor element to a real number.
 * Complex values with non-zero imaginary part are rejected.
 */
function asRealNumber(value: unknown): number | undefined {
  if (typeof value === 'object' && value !== null && 're' in value) {
    const re = asNumber(value.re);
    const im = 'im' in value ? (asNumber(value.im) ?? 0) : 0;
    if (im !== 0) return undefined;
    return re;
  }
  return asNumber(value);
}

/**
 * Convert a boxed vector/matrix tensor into a numeric matrix.
 */
function tensorToNumericMatrix(
  tensor: BoxedExpression,
  rowCount: number,
  columnCount: number
): number[][] | undefined {
  if (!isBoxedTensor(tensor)) return undefined;

  const matrix: number[][] = [];
  for (let i = 0; i < rowCount; i++) {
    matrix[i] = [];
    for (let j = 0; j < columnCount; j++) {
      const value =
        tensor.rank === 1
          ? tensor.tensor.at(j + 1)
          : tensor.tensor.at(i + 1, j + 1);
      const num = asRealNumber(value);
      if (num === undefined || isNaN(num)) return undefined;
      matrix[i][j] = num;
    }
  }

  return matrix;
}

/**
 * Compute RREF and return the pivot columns.
 */
function rref(
  matrix: number[][],
  tolerance = 1e-10
): {
  matrix: number[][];
  pivotCols: number[];
} {
  const rowCount = matrix.length;
  const colCount = matrix[0]?.length ?? 0;
  const out = matrix.map((row) => [...row]);
  const pivotCols: number[] = [];

  let pivotRow = 0;
  for (let col = 0; col < colCount && pivotRow < rowCount; col++) {
    let maxRow = pivotRow;
    let maxVal = Math.abs(out[pivotRow][col] ?? 0);
    for (let row = pivotRow + 1; row < rowCount; row++) {
      const v = Math.abs(out[row][col] ?? 0);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxVal <= tolerance) continue;

    if (maxRow !== pivotRow)
      [out[pivotRow], out[maxRow]] = [out[maxRow], out[pivotRow]];

    const pivot = out[pivotRow][col];
    for (let j = col; j < colCount; j++) out[pivotRow][j] /= pivot;

    for (let row = 0; row < rowCount; row++) {
      if (row === pivotRow) continue;
      const factor = out[row][col];
      if (Math.abs(factor) <= tolerance) {
        out[row][col] = 0;
        continue;
      }
      for (let j = col; j < colCount; j++) {
        out[row][j] -= factor * out[pivotRow][j];
      }
    }

    pivotCols.push(col);
    pivotRow++;
  }

  // Chop tiny values introduced by floating point noise.
  for (let i = 0; i < rowCount; i++) {
    for (let j = 0; j < colCount; j++) {
      if (Math.abs(out[i][j]) <= tolerance) out[i][j] = 0;
    }
  }

  return { matrix: out, pivotCols };
}

/**
 * Return a basis of the null space of A as row vectors.
 */
function computeNullSpaceBasis(A: number[][]): number[][] {
  const colCount = A[0]?.length ?? 0;
  if (colCount === 0) return [];

  const { matrix, pivotCols } = rref(A);
  const pivotSet = new Set(pivotCols);
  const freeCols: number[] = [];
  for (let col = 0; col < colCount; col++) {
    if (!pivotSet.has(col)) freeCols.push(col);
  }
  if (freeCols.length === 0) return [];

  const basis: number[][] = [];
  for (const freeCol of freeCols) {
    const vector = Array(colCount).fill(0);
    vector[freeCol] = 1;
    for (let row = 0; row < pivotCols.length; row++) {
      const pivotCol = pivotCols[row];
      vector[pivotCol] = -matrix[row][freeCol];
    }
    basis.push(vector);
  }
  return basis;
}

/**
 * Infer the finite dimension of a value when possible.
 */
function finiteDimension(value: BoxedExpression): number | undefined {
  if (value.isNumber) return 1;

  // Access the internal type representation. BoxedType.type returns the
  // underlying TypeNode union; for list types it is a ListType object with
  // { kind: 'list', dimensions, ... }.  This couples to the internal
  // TypeNode representation in common/type/types.ts.
  const type = value.type.type;
  if (
    typeof type === 'object' &&
    type !== null &&
    'kind' in type &&
    type.kind === 'list'
  ) {
    const dimensions = (type as ListType).dimensions;
    if (
      dimensions !== undefined &&
      dimensions.length > 0 &&
      dimensions.every((d) => Number.isInteger(d) && d >= 0)
    ) {
      return dimensions.reduce((a, b) => a * b, 1);
    }
  }

  if (isBoxedTensor(value)) {
    if (value.shape.length === 0) return 1;
    return value.shape.reduce((a, b) => a * b, 1);
  }

  if (isFiniteIndexedCollection(value)) {
    let count = 0;
    for (const _ of value.each()) count += 1;
    return count;
  }

  return undefined;
}

/**
 * Infer the dimension of a kernel basis representation.
 */
function kernelBasisDimension(value: BoxedExpression): number | undefined {
  if (isBoxedFunction(value) && value.operator === 'List') {
    if (value.ops.length === 0) return 0;
    if (
      value.ops.every((op) => isBoxedFunction(op) && op.operator === 'List')
    ) {
      return value.ops.length;
    }
  }

  if (isBoxedTensor(value) && (value.rank === 1 || value.rank === 2))
    return value.shape[0];

  return undefined;
}

/**
 * Return true if `value` is a polynomial expression in its unknowns.
 */
function isPolynomialExpression(value: BoxedExpression): boolean {
  if (value.isNumber) return true;
  if (isBoxedSymbol(value)) return !value.isConstant;
  if (!isBoxedFunction(value)) return false;
  if (value.unknowns.length === 0) return true;

  if (
    value.operator === 'Add' ||
    value.operator === 'Subtract' ||
    value.operator === 'Multiply'
  )
    return value.ops.every((op) => isPolynomialExpression(op));

  if (value.operator === 'Negate') return isPolynomialExpression(value.op1);

  if (value.operator === 'Divide')
    return isPolynomialExpression(value.op1) && value.op2.unknowns.length === 0;

  if (value.operator === 'Power') {
    const exp = value.op2.re;
    return (
      isPolynomialExpression(value.op1) &&
      value.op2.unknowns.length === 0 &&
      exp !== undefined &&
      Number.isInteger(exp) &&
      exp >= 0
    );
  }

  return false;
}

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

  const canonOp0 = ops[0].canonical;
  const body =
    ops[0].operator === 'Vector' && isBoxedFunction(canonOp0)
      ? canonOp0.ops[0]
      : canonOp0;
  const delims = ops[1]?.canonical;
  const columns = ops[2]?.canonical;

  if (ops.length > 3) return ce._fn(operator, checkArity(ce, ops, 3));

  if (columns) return ce._fn(operator, [body, delims, columns]);
  if (delims) return ce._fn(operator, [body, delims]);
  return ce._fn(operator, [body]);
}
