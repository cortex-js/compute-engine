import { parseType } from '../../common/type/parse.js';
import { isSubtype } from '../../common/type/subtype.js';
import { ListType } from '../../common/type/types.js';
import { isTensor } from '../boxed-expression/boxed-tensor.js';
import { totalDegree } from '../boxed-expression/polynomial-degree.js';
import { checkArity } from '../boxed-expression/validate.js';
import { isFiniteIndexedCollection } from '../collection-utils.js';
import {
  Expression,
  IComputeEngine as ComputeEngine,
  SymbolDefinitions,
  Sign,
} from '../global-types.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { asRational } from '../boxed-expression/numerics.js';

export const LINEAR_ALGEBRA_LIBRARY: SymbolDefinitions[] = [
  {
    Matrix: {
      description: 'Matrix constructor and canonicalizer.',
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
      description: 'Construct a column vector.',
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
      description: 'Return the shape tuple of an expression.',
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
      description: 'Reshape a tensor or collection to a target shape.',
      complexity: 8200,
      signature: '(value, tuple) -> value',
      type: ([value, shape]) => {
        const shapeOps = isFunction(shape) ? shape.ops : undefined;
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
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        let op1 = ops[0].evaluate();
        const targetShape = isFunction(ops[1])
          ? ops[1].ops.map((op) => op.re)
          : [];

        // Handle empty shape tuple - return scalar
        if (targetShape.length === 0) {
          if (op1.isNumber) return op1;
          if (isTensor(op1)) {
            // Return first element as scalar
            const flatData = op1.tensor.flatten();
            return flatData.length > 0 ? ce.expr(flatData[0]) : ce.Zero;
          }
          return undefined;
        }

        // Handle scalar - replicate to fill target shape
        if (op1.isNumber) {
          return reshapeWithCycling(ce, [op1], targetShape);
        }

        // If a finite indexable collection, convert to a list
        // -> BoxedTensor
        if (!isTensor(op1) && isFiniteIndexedCollection(op1))
          op1 = ce.function('List', [...op1.each()]);

        if (isTensor(op1)) {
          // If shapes match, return as-is
          if (targetShape.join('x') === op1.shape.join('x')) return op1;

          // Flatten tensor data and reshape with cycling
          // Use tensor.flatten() to get all scalar elements
          const flatData = op1.tensor.flatten();
          const flatElements = flatData.map((x) => ce.expr(x));
          return reshapeWithCycling(ce, flatElements, targetShape);
        }

        return undefined;
      },
    },

    // Corresponds to Ravel `,` in APL
    // Also Enlist `∊``⍋` in APL
    Flatten: {
      description: 'Flatten a tensor or collection into a list.',
      complexity: 8200,
      signature: '(value) -> list',
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Handle scalar - return single-element list
        if (op1.isNumber) return ce.expr(['List', op1]);

        if (isTensor(op1))
          return ce.expr([
            'List',
            ...op1.tensor.flatten().map((x) => ce.expr(x)),
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
      description: 'Transpose a matrix or swap two tensor axes.',
      complexity: 8200,
      signature: '(value, axis1: integer?, axis2: integer?) -> value',
      evaluate: (ops, { engine: ce }) => {
        let op1 = ops[0].evaluate();

        // Transpose of scalar is the scalar itself
        if (op1.isNumber) return op1;

        if (!isTensor(op1) && isFiniteIndexedCollection(op1))
          op1 = ce.function('List', [...op1.each()]);

        if (isTensor(op1)) {
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
      description:
        'Conjugate transpose (Hermitian adjoint) of a matrix or tensor.',
      complexity: 8200,
      signature: '(value, axis1: integer?, axis2: integer?) -> value',
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Conjugate transpose of scalar is its conjugate
        if (op1.isNumber) return ce.expr(['Conjugate', op1]).evaluate();

        if (isTensor(op1)) {
          const rank = op1.shape.length;

          // For rank 1 (vectors), conjugate transpose is just element-wise conjugate
          if (rank === 1) {
            const elements = [...op1.each()].map((el) =>
              ce.expr(['Conjugate', el]).evaluate()
            );
            return ce.expr(['List', ...elements]);
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
      description: 'Determinant of a square matrix.',
      complexity: 8200,
      signature: '(matrix) -> number',
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Determinant of scalar (1x1 matrix) is the scalar itself
        if (op1.isNumber) return op1;

        if (isTensor(op1)) {
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

          // Symbolic Vandermonde matrices: return the closed-form difference
          // product ∏_{i<j}(nodeⱼ − nodeᵢ) directly. The general symbolic
          // determinant (fraction-free elimination) otherwise yields a
          // value-correct but unfactored rational form carrying a division
          // artifact, which Factor/simplify cannot recover. Gated to symbolic
          // matrices so numeric determinants keep their existing fast path.
          if (op1.tensor.dtype === 'expression') {
            const vdm = vandermondeDifferenceProduct(op1, shape[0], ce);
            if (vdm !== undefined) return vdm;
          }

          const det = op1.tensor.determinant();
          // `determinant()` returns a raw field value (e.g. a JS number for a
          // numeric matrix); box it so the operator yields a usable expression.
          return det === undefined
            ? undefined
            : op1.tensor.field.expression(det);
        }

        return undefined;
      },
    },

    Inverse: {
      description: 'Multiplicative inverse of a square matrix.',
      complexity: 8200,
      signature: '(matrix) -> matrix',
      type: ([matrix]) => matrix.type,
      evaluate: ([matrix], { engine: ce }) => {
        const op1 = matrix.evaluate();

        // Inverse of scalar is 1/scalar
        if (op1.isNumber) return ce.expr(['Divide', 1, op1]).evaluate();

        if (isTensor(op1)) {
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
      description: 'Moore-Penrose pseudoinverse of a matrix.',
      complexity: 8200,
      signature: '(matrix) -> matrix',
      evaluate: ([matrix], { engine: ce }) => {
        const op1 = matrix.evaluate();

        // Pseudoinverse of scalar is 1/scalar (or 0 if scalar is 0)
        if (op1.isNumber) {
          if (op1.isSame(0)) return ce.Zero;
          return ce.expr(['Divide', 1, op1]).evaluate();
        }

        if (isTensor(op1)) return op1.tensor.pseudoInverse()?.expression;

        return undefined;
      },
    },

    // Adjoint: {
    //   complexity: 8200,
    //   signature: {
    //     domain: ['FunctionOf', 'Values', 'Values'],
    //     evaluate: (ops) => {
    //       const op1 = ops[0];
    //       if (isTensor(op1)) return op1.adjoint()?.adjugateMatrix();

    //       return undefined;
    //     },
    //   },
    // },

    AdjugateMatrix: {
      description: 'Adjugate (classical adjoint) of a square matrix.',
      complexity: 8200,
      signature: '(matrix) -> matrix',
      evaluate: (ops) => {
        const op1 = ops[0].evaluate();
        if (isTensor(op1)) return op1.tensor.adjugateMatrix()?.expression;

        return undefined;
      },
    },

    // Minor: {
    //   complexity: 8200,
    //   signature: {
    //     domain: ['FunctionOf', 'Values', 'Values', 'Values'],
    //     evaluate: (ops) => {
    //       const op1 = ops[0];
    //       // if (isTensor(op1)) return op1.minor();

    //       return undefined;
    //     },
    //   },
    // },

    // Trace: sum of diagonal elements
    // For matrices: returns scalar
    // For rank > 2 tensors: returns tensor of traces over last two axes (batch trace)
    // Optional axis1, axis2 to specify which axes to trace over (default: last two)
    Trace: {
      description: 'Trace of a matrix or pair of tensor axes.',
      complexity: 8200,
      signature: '(value, axis1: integer?, axis2: integer?) -> value',
      // The trace of a rank-2 matrix (or a scalar 1×1) is a scalar `number`;
      // tracing a pair of axes of a higher-rank tensor reduces two axes and
      // stays a collection, so only claim `number` for the matrix/scalar case
      // and otherwise defer to the general `value`.
      type: ([m]) => {
        if (m === undefined) return 'value';
        const t = m.type.type;
        if (typeof t !== 'string' && t.kind === 'list') {
          // A matrix carries 2 dimensions (e.g. `matrix` = `[-1, -1]`); a
          // vector (rank-1 list) has no `dimensions` and has no trace.
          if (t.dimensions?.length === 2) return 'number';
          return 'value';
        }
        if (m.isNumber) return 'number';
        return 'value';
      },
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Trace of scalar is the scalar itself
        if (op1.isNumber) return op1;

        if (isTensor(op1)) {
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
          if (typeof result === 'number') return ce.expr(result);
          if (typeof result === 'boolean') return result ? ce.True : ce.False;

          // Check if it's a primitive value that needs boxing
          if (!('expression' in result)) return ce.expr(result);

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
          if (op.isSame(0)) return ce.expr(['List', ['List', 1]]);
          return ce.expr(['List']);
        }

        if (!isTensor(op)) return undefined;

        // Interpret vectors as 1×n matrices (linear forms)
        const shape = op.shape;
        if (shape.length > 2) return ce.error('expected-matrix', op.toString());

        const rowCount = shape.length === 1 ? 1 : shape[0];
        const columnCount = shape.length === 1 ? shape[0] : shape[1];

        // Exact path: when every entry is an exact integer/rational, compute
        // the null-space basis with exact rational arithmetic so the result is
        // free of float artifacts. Floats-in → numeric path unchanged.
        const rationalMatrix = tensorToRationalMatrix(op, rowCount, columnCount);
        if (rationalMatrix) {
          const basis = exactRationalNullSpaceBasis(rationalMatrix);
          return ce.expr([
            'List',
            ...basis.map((vector) =>
              ce.expr(['List', ...vector.map(([n, d]) => ce.number([n, d]))])
            ),
          ]);
        }

        const matrix = tensorToNumericMatrix(op, rowCount, columnCount);
        if (!matrix) return undefined;

        const basis = computeNullSpaceBasis(matrix);
        return ce.expr([
          'List',
          ...basis.map((vector) =>
            ce.expr(['List', ...vector.map((x) => ce.number(ce.chop(x)))])
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
        if (isFunction(object, 'Kernel')) {
          const kernelDim = kernelBasisDimension(op);
          if (kernelDim !== undefined) return ce.number(kernelDim);
        }

        // dim(Hom(V, W)) = dim(V) * dim(W) for finite-dimensional objects.
        // Same structural matching caveat as Kernel above.
        if (isFunction(object, 'Hom') && object.ops.length >= 2) {
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
        if (isSymbol(op) && !op.isConstant) return undefined;

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
      description: 'Matrix and vector multiplication.',
      complexity: 8300,
      signature: '(matrix|vector, matrix|vector) -> matrix|vector',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const A = ops[0].evaluate();
        const B = ops[1].evaluate();

        // Both operands must be tensors
        if (!isTensor(A) || !isTensor(B)) return undefined;

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
          let sum: Expression = ce.Zero;
          for (let i = 0; i < n; i++) {
            const aVal = A.tensor.at(i + 1) ?? ce.Zero;
            const bVal = B.tensor.at(i + 1) ?? ce.Zero;
            sum = sum.add(ce.expr(aVal).mul(ce.expr(bVal)));
          }
          return sum.evaluate();
        }

        // Handle matrix × vector: A (m×n) × v (n) → result (m)
        if (shapeA.length === 2 && shapeB.length === 1) {
          const [m, n] = shapeA;
          if (n !== shapeB[0])
            return ce.error('incompatible-dimensions', `${n} vs ${shapeB[0]}`);

          const result: Expression[] = [];
          for (let i = 0; i < m; i++) {
            let sum: Expression = ce.Zero;
            for (let k = 0; k < n; k++) {
              const aVal = A.tensor.at(i + 1, k + 1) ?? ce.Zero;
              const bVal = B.tensor.at(k + 1) ?? ce.Zero;
              sum = sum.add(ce.expr(aVal).mul(ce.expr(bVal)));
            }
            result.push(sum.evaluate());
          }
          return ce.expr(['List', ...result]);
        }

        // Handle vector × matrix: v (m) × B (m×n) → result (n)
        // Treat vector as 1×m row vector
        if (shapeA.length === 1 && shapeB.length === 2) {
          const [m, n] = shapeB;
          if (shapeA[0] !== m)
            return ce.error('incompatible-dimensions', `${shapeA[0]} vs ${m}`);

          const result: Expression[] = [];
          for (let j = 0; j < n; j++) {
            let sum: Expression = ce.Zero;
            for (let k = 0; k < m; k++) {
              const aVal = A.tensor.at(k + 1) ?? ce.Zero;
              const bVal = B.tensor.at(k + 1, j + 1) ?? ce.Zero;
              sum = sum.add(ce.expr(aVal).mul(ce.expr(bVal)));
            }
            result.push(sum.evaluate());
          }
          return ce.expr(['List', ...result]);
        }

        // Handle matrix × matrix: A (m×n) × B (n×p) → result (m×p)
        if (shapeA.length === 2 && shapeB.length === 2) {
          const [m, n1] = shapeA;
          const [n2, p] = shapeB;
          if (n1 !== n2)
            return ce.error('incompatible-dimensions', `${n1} vs ${n2}`);

          const n = n1;
          const rows: Expression[] = [];
          for (let i = 0; i < m; i++) {
            const row: Expression[] = [];
            for (let j = 0; j < p; j++) {
              let sum: Expression = ce.Zero;
              for (let k = 0; k < n; k++) {
                const aVal = A.tensor.at(i + 1, k + 1) ?? ce.Zero;
                const bVal = B.tensor.at(k + 1, j + 1) ?? ce.Zero;
                sum = sum.add(ce.expr(aVal).mul(ce.expr(bVal)));
              }
              row.push(sum.evaluate());
            }
            rows.push(ce.expr(['List', ...row]));
          }
          return ce.expr(['List', ...rows]);
        }

        // Unsupported tensor ranks
        return undefined;
      },
    },

    Dot: {
      description: 'Dot product (vector inner product) or matrix product.',
      complexity: 8300,
      signature: '(matrix|vector, matrix|vector) -> value',
      // `Dot` is Mathematica's `.`: it reduces to the inner product for two
      // vectors and to the matrix product otherwise — exactly what
      // `MatrixMultiply` already computes.
      evaluate: (ops, { engine: ce }) =>
        ce.function('MatrixMultiply', ops).evaluate(),
    },

    HadamardProduct: {
      description:
        'Hadamard (element-wise) product of two vectors or matrices of the same shape.',
      complexity: 8300,
      signature: '(matrix|vector, matrix|vector) -> matrix|vector',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const A = ops[0].evaluate();
        const B = ops[1].evaluate();

        // Both operands must be tensors of the same shape.
        if (!isTensor(A) || !isTensor(B)) return undefined;

        const shapeA = A.shape;
        const shapeB = B.shape;
        if (
          shapeA.length !== shapeB.length ||
          shapeA.some((d, i) => d !== shapeB[i])
        )
          return ce.error(
            'incompatible-dimensions',
            `${shapeA.join('x')} vs ${shapeB.join('x')}`
          );

        // Element-wise product (reuses the tensor field's broadcast multiply).
        return A.tensor.multiply(B.tensor).expression;
      },
    },

    MatrixRank: {
      description:
        'Rank of a matrix (number of linearly independent rows/columns).',
      complexity: 8200,
      signature: '(value) -> integer',
      sgn: (): Sign => 'non-negative',
      evaluate: ([map], { engine: ce }) => {
        const op = map.evaluate();

        // Rank of a scalar map x ↦ a·x: 1 if non-zero, 0 if zero.
        if (op.isNumber) return ce.number(op.isSame(0) ? 0 : 1);

        if (!isTensor(op)) return undefined;

        const shape = op.shape;
        if (shape.length > 2) return ce.error('expected-matrix', op.toString());

        // Interpret a vector as a 1×n matrix (linear form), as `Kernel` does.
        const rowCount = shape.length === 1 ? 1 : shape[0];
        const columnCount = shape.length === 1 ? shape[0] : shape[1];

        // Exact path: for an exact integer/rational matrix, the rank is the
        // number of pivots in the exact RREF (no tolerance ambiguity).
        const rationalMatrix = tensorToRationalMatrix(op, rowCount, columnCount);
        if (rationalMatrix) {
          const { pivotCols } = exactRationalRref(rationalMatrix);
          return ce.number(pivotCols.length);
        }

        const matrix = tensorToNumericMatrix(op, rowCount, columnCount);
        if (matrix) {
          // Rank–nullity theorem: rank = (number of columns) − dim(kernel).
          const nullity = computeNullSpaceBasis(matrix).length;
          return ce.number(columnCount - nullity);
        }

        // Symbolic path: entries could not be reduced to numbers (e.g. a
        // matrix of trig functions). Use the symbolic determinant to decide
        // full rank vs. rank-deficiency for a small square matrix. Stay
        // conservative: only conclude when the simplified determinant is
        // literally 0 or a literal nonzero constant; otherwise return
        // undefined (stay symbolic), as before.
        if (rowCount !== columnCount || rowCount < 2 || rowCount > 3)
          return undefined;

        let det = ce.function('Determinant', [op]).evaluate().simplify();
        // A trig determinant may be identically zero yet only collapse under
        // TrigReduce (which normalizes products/powers of trig to a linear
        // combination of multiple-angle terms), which simplify() does not
        // apply. Fall back to it before giving up on a zero determinant.
        if (!det.isSame(0)) {
          const reduced = ce.function('TrigReduce', [det]).evaluate();
          if (reduced.isSame(0)) det = reduced;
        }

        if (det.isSame(0)) {
          // Rank-deficient. Reaching the symbolic path guarantees at least
          // one non-numeric entry (a numeric — incl. all-zero — matrix takes
          // the rational/numeric paths above), so the matrix is not the zero
          // matrix and its rank is ≥ 1. For a 2×2 that pins the rank at 1;
          // for a 3×3 the rank could be 1 or 2, which the determinant alone
          // cannot distinguish, so stay symbolic.
          if (rowCount === 2) return ce.number(1);
          return undefined;
        }

        // A literal nonzero determinant ⇒ full rank. A symbolic (non-literal)
        // nonzero determinant is left undetermined.
        if (isNumber(det)) return ce.number(rowCount);
        return undefined;
      },
    },

    IsSquareMatrix: {
      description: 'Whether the value is a square matrix.',
      complexity: 8200,
      signature: '(value) -> boolean',
      evaluate: ([m], { engine: ce }) => {
        const op = m.evaluate();
        if (!isTensor(op)) return ce.False;
        return op.tensor.isSquare ? ce.True : ce.False;
      },
    },

    IsSymmetric: {
      description: 'Whether the matrix is symmetric (A equals its transpose).',
      complexity: 8200,
      signature: '(value) -> boolean',
      evaluate: ([m], { engine: ce }) => {
        const op = m.evaluate();
        if (!isTensor(op)) return ce.False;
        return op.tensor.isSymmetric ? ce.True : ce.False;
      },
    },

    IsDiagonal: {
      description:
        'Whether the matrix is diagonal (all off-diagonal entries are zero).',
      complexity: 8200,
      signature: '(value) -> boolean',
      evaluate: ([m], { engine: ce }) => {
        const op = m.evaluate();
        if (!isTensor(op)) return ce.False;
        return op.tensor.isDiagonal ? ce.True : ce.False;
      },
    },

    Cross: {
      description: 'Cross product of two 3-vectors.',
      complexity: 8300,
      signature: '(vector, vector) -> vector',
      evaluate: ([a, b], { engine: ce }) => {
        const A = a.evaluate();
        const B = b.evaluate();
        if (!isTensor(A) || !isTensor(B)) return undefined;
        if (
          A.shape.length !== 1 ||
          A.shape[0] !== 3 ||
          B.shape.length !== 1 ||
          B.shape[0] !== 3
        )
          return ce.error(
            'incompatible-dimensions',
            'cross product requires two 3-vectors'
          );

        const a1 = ce.expr(A.tensor.at(1) ?? ce.Zero);
        const a2 = ce.expr(A.tensor.at(2) ?? ce.Zero);
        const a3 = ce.expr(A.tensor.at(3) ?? ce.Zero);
        const b1 = ce.expr(B.tensor.at(1) ?? ce.Zero);
        const b2 = ce.expr(B.tensor.at(2) ?? ce.Zero);
        const b3 = ce.expr(B.tensor.at(3) ?? ce.Zero);

        return ce
          .function('List', [
            a2.mul(b3).sub(a3.mul(b2)),
            a3.mul(b1).sub(a1.mul(b3)),
            a1.mul(b2).sub(a2.mul(b1)),
          ])
          .evaluate();
      },
    },

    MatrixPower: {
      description:
        'Square matrix raised to an integer power (repeated matrix product).',
      complexity: 8300,
      signature: '(matrix, integer) -> matrix',
      evaluate: ([mat, exponent], { engine: ce }) => {
        const A = mat.evaluate();
        if (!isTensor(A)) return undefined;
        if (!A.tensor.isSquare)
          return ce.error('expected-square-matrix', A.toString());

        const n = exponent.re;
        if (n === undefined || !Number.isInteger(n)) return undefined;

        const size = A.shape[0];
        if (n === 0)
          return ce.function('IdentityMatrix', [ce.number(size)]).evaluate();

        // Compute the positive power A^|n| by repeated multiplication, always
        // multiplying by the original matrix `A` (a clean `matrix` operand).
        // Exponents are small in practice; the loop keeps results exact for
        // symbolic/rational entries.
        let result: Expression = A;
        for (let i = 1; i < Math.abs(n); i++)
          result = ce.function('MatrixMultiply', [result, A]).evaluate();

        // Negative exponent: A^{-n} = (A^n)^{-1}. Inverting the final result
        // (rather than threading the inverse back through MatrixMultiply, whose
        // signature rejects the inverse's `list<list<…>>` type) keeps this
        // exact and well-typed.
        if (n < 0) return ce.function('Inverse', [result]).evaluate();
        return result;
      },
    },

    CharacteristicPolynomial: {
      description:
        'Characteristic polynomial det(x·I − A) of a square matrix (monic).',
      complexity: 8700,
      // The variable is accepted as `any` (not `symbol`): an undeclared symbol
      // is inferred to have a numeric type, which would fail a `symbol`
      // signature check. The evaluate handler validates it with `isSymbol`.
      signature: '(matrix, any?) -> expression',
      evaluate: ([mat, variable], { engine: ce }) => {
        const A = mat.evaluate();
        if (!isTensor(A)) return undefined;
        if (!A.tensor.isSquare)
          return ce.error('expected-square-matrix', A.toString());

        const x = variable && isSymbol(variable) ? variable : ce.symbol('x');
        const n = A.shape[0];

        // Build x·I − A symbolically, then take its determinant (which already
        // returns an expanded polynomial for symbolic entries).
        const rows: Expression[] = [];
        for (let i = 0; i < n; i++) {
          const row: Expression[] = [];
          for (let j = 0; j < n; j++) {
            const entry = ce.expr(A.tensor.at(i + 1, j + 1) ?? ce.Zero);
            row.push(i === j ? x.sub(entry) : entry.neg());
          }
          rows.push(ce.function('List', row));
        }
        return ce
          .function('Determinant', [ce.function('List', rows)])
          .evaluate();
      },
    },

    RowReduce: {
      description: 'Reduced row echelon form (RREF) of a matrix.',
      complexity: 8200,
      signature: '(matrix) -> matrix',
      evaluate: ([m], { engine: ce }) => {
        const op = m.evaluate();
        if (!isTensor(op)) return undefined;

        const shape = op.shape;
        if (shape.length !== 2)
          return ce.error('expected-matrix', op.toString());

        // Exact path: when every entry is an exact integer/rational, compute
        // the RREF with exact rational arithmetic (fraction pivoting) so the
        // result is free of the float artifacts (…2.999…) that a numeric
        // Gaussian elimination introduces. Floats-in → numeric path unchanged.
        const rationalMatrix = tensorToRationalMatrix(op, shape[0], shape[1]);
        if (rationalMatrix) {
          const { matrix: reduced } = exactRationalRref(rationalMatrix);
          return ce.expr([
            'List',
            ...reduced.map((row) =>
              ce.expr(['List', ...row.map(([n, d]) => ce.number([n, d]))])
            ),
          ]);
        }

        const matrix = tensorToNumericMatrix(op, shape[0], shape[1]);
        if (!matrix) return undefined;

        const { matrix: reduced } = rref(matrix);
        return ce.expr([
          'List',
          ...reduced.map((row) =>
            ce.expr(['List', ...row.map((value) => ce.number(ce.chop(value)))])
          ),
        ]);
      },
    },

    // Diagonal can be used to:
    // 1. Create a diagonal matrix from a vector
    // 2. Extract the diagonal from a matrix as a vector
    // 3. For a scalar, return the scalar (or could create 1x1 matrix)
    Diagonal: {
      description: 'Extract a matrix diagonal or build a diagonal matrix.',
      complexity: 8200,
      signature: '(value) -> value',
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0].evaluate();

        // Scalar → return as-is
        if (op1.isNumber) return op1;

        if (isTensor(op1)) {
          const shape = op1.shape;

          // Vector → create diagonal matrix
          if (shape.length === 1) {
            const n = shape[0];
            const rows: Expression[] = [];
            const elements = [...op1.each()];
            for (let i = 0; i < n; i++) {
              const row: Expression[] = [];
              for (let j = 0; j < n; j++) {
                row.push(i === j ? elements[i] : ce.Zero);
              }
              rows.push(ce.expr(['List', ...row]));
            }
            return ce.expr(['List', ...rows]);
          }

          // Matrix → extract diagonal as vector
          if (shape.length === 2) {
            const [m, n] = shape;
            const minDim = Math.min(m, n);
            const diagonal: Expression[] = [];
            for (let i = 0; i < minDim; i++) {
              diagonal.push(ce.expr(op1.tensor.at(i + 1, i + 1) ?? ce.Zero));
            }
            return ce.expr(['List', ...diagonal]);
          }

          // Tensor (rank > 2): not supported
          return ce.error('expected-square-matrix', op1.toString());
        }

        return undefined;
      },
    },

    // Creates an n×n identity matrix
    IdentityMatrix: {
      description: 'n-by-n identity matrix.',
      complexity: 8100,
      signature: '(integer) -> matrix',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const nExpr = ops[0].evaluate();
        const n = nExpr.re;

        if (n === undefined || !Number.isInteger(n) || n < 1)
          return ce.error('expected-positive-integer', nExpr.toString());

        const rows: Expression[] = [];
        for (let i = 0; i < n; i++) {
          const row: Expression[] = [];
          for (let j = 0; j < n; j++) {
            row.push(i === j ? ce.One : ce.Zero);
          }
          rows.push(ce.expr(['List', ...row]));
        }
        return ce.expr(['List', ...rows]);
      },
    },

    // Creates an m×n matrix of zeros
    ZeroMatrix: {
      description: 'Matrix filled with zeros.',
      complexity: 8100,
      signature: '(integer, integer?) -> matrix',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
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

        const rows: Expression[] = [];
        for (let i = 0; i < m; i++) {
          const row: Expression[] = [];
          for (let j = 0; j < n; j++) {
            row.push(ce.Zero);
          }
          rows.push(ce.expr(['List', ...row]));
        }
        return ce.expr(['List', ...rows]);
      },
    },

    // Creates an m×n matrix of ones
    OnesMatrix: {
      description: 'Matrix filled with ones.',
      complexity: 8100,
      signature: '(integer, integer?) -> matrix',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
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

        const rows: Expression[] = [];
        for (let i = 0; i < m; i++) {
          const row: Expression[] = [];
          for (let j = 0; j < n; j++) {
            row.push(ce.One);
          }
          rows.push(ce.expr(['List', ...row]));
        }
        return ce.expr(['List', ...rows]);
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
      description: 'Vector or matrix norm.',
      complexity: 8200,
      signature: '(value, number|string?) -> number',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const x = ops[0].evaluate();
        const normTypeExpr = ops.length > 1 ? ops[1].evaluate() : undefined;

        // Scalar: |x| (absolute value)
        if (x.isNumber) {
          return ce.expr(['Abs', x]).evaluate();
        }

        // Determine norm type
        let normType: number | string = 2; // Default to L2/Frobenius
        if (normTypeExpr) {
          const normStr = isString(normTypeExpr)
            ? normTypeExpr.string
            : undefined;
          const normSym = isSymbol(normTypeExpr)
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

        // Compute a rank-1 (vector) norm from a list of element expressions.
        // Shared by the tensor rank-1 branch and the Tuple branch.
        const vectorNorm = (
          elements: readonly Expression[]
        ): Expression | undefined => {
          if (normType === 1) {
            // L1 norm: sum of absolute values
            let sum: Expression = ce.Zero;
            for (const el of elements) {
              sum = sum.add(ce.expr(['Abs', el]).evaluate());
            }
            return sum.evaluate();
          }

          if (normType === 2) {
            // L2 norm: sqrt of sum of squares
            let sumSq: Expression = ce.Zero;
            for (const el of elements) {
              const absEl = ce.expr(['Abs', el]).evaluate();
              sumSq = sumSq.add(absEl.mul(absEl));
            }
            return ce.expr(['Sqrt', sumSq]).evaluate();
          }

          if (normType === 'infinity') {
            // L∞ norm: max absolute value
            let maxVal: Expression = ce.Zero;
            for (const el of elements) {
              const absEl = ce.expr(['Abs', el]).evaluate();
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
            let sumPow: Expression = ce.Zero;
            for (const el of elements) {
              const absEl = ce.expr(['Abs', el]).evaluate();
              sumPow = sumPow.add(ce.expr(['Power', absEl, p]).evaluate());
            }
            // Use Root for integer p values, Power for non-integer
            // Use .N() to get numeric result for non-perfect roots
            if (Number.isInteger(p)) {
              return ce.expr(['Root', sumPow, p]).N();
            }
            return ce.expr(['Power', sumPow, ce.expr(['Divide', 1, p])]).N();
          }

          return undefined;
        };

        // A point-like Tuple is treated as a rank-1 vector — but only inside
        // Norm (no general Tuple→vector coercion is introduced elsewhere).
        if (isFunction(x, 'Tuple')) return vectorNorm(x.ops);

        if (!isTensor(x)) return undefined;

        const shape = x.shape;

        // Vector norm (rank 1)
        if (shape.length === 1) {
          const elements: Expression[] = [];
          const n = shape[0];
          for (let i = 0; i < n; i++) {
            const val = x.tensor.at(i + 1);
            elements.push(val !== undefined ? ce.expr(val) : ce.Zero);
          }
          return vectorNorm(elements);
        }

        // Matrix norm (rank 2)
        if (shape.length === 2) {
          const [m, n] = shape;

          // Frobenius norm (default for matrices): √(ΣΣ|aij|²)
          if (normType === 2 || normType === 'frobenius') {
            let sumSq: Expression = ce.Zero;
            for (let i = 0; i < m; i++) {
              for (let j = 0; j < n; j++) {
                const val = x.tensor.at(i + 1, j + 1);
                const el = val !== undefined ? ce.expr(val) : ce.Zero;
                const absEl = ce.expr(['Abs', el]).evaluate();
                sumSq = sumSq.add(absEl.mul(absEl));
              }
            }
            return ce.expr(['Sqrt', sumSq]).evaluate();
          }

          // L1 (max column sum of absolute values)
          if (normType === 1) {
            let maxColSum = 0;
            for (let j = 0; j < n; j++) {
              let colSum = 0;
              for (let i = 0; i < m; i++) {
                const val = x.tensor.at(i + 1, j + 1);
                const el = val !== undefined ? ce.expr(val) : ce.Zero;
                const absEl = ce.expr(['Abs', el]).evaluate();
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
                const el = val !== undefined ? ce.expr(val) : ce.Zero;
                const absEl = ce.expr(['Abs', el]).evaluate();
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
      description: 'Eigenvalues of a square matrix.',
      complexity: 8500,
      signature: '(matrix) -> list',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const M = ops[0].evaluate();

        if (!isTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a square matrix
        if (shape.length !== 2 || shape[0] !== shape[1]) {
          return ce.error('expected-square-matrix', M.toString());
        }

        const n = shape[0];

        // Special case: 1×1 matrix
        if (n === 1) {
          const val = M.tensor.at(1, 1);
          return ce.expr(['List', val !== undefined ? ce.expr(val) : ce.Zero]);
        }

        // Check if matrix is diagonal or triangular (eigenvalues are diagonal elements)
        const isDiagonalOrTriangular = checkDiagonalOrTriangular(M, n);
        if (isDiagonalOrTriangular) {
          const eigenvalues: Expression[] = [];
          for (let i = 0; i < n; i++) {
            const val = M.tensor.at(i + 1, i + 1);
            eigenvalues.push(val !== undefined ? ce.expr(val) : ce.Zero);
          }
          return ce.expr(['List', ...eigenvalues]);
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
          const sqrtDisc = ce.expr(['Sqrt', disc]).evaluate();
          const lambda1 = trace.add(sqrtDisc).div(ce.number(2)).evaluate();
          const lambda2 = trace.sub(sqrtDisc).div(ce.number(2)).evaluate();

          return ce.expr(['List', lambda1, lambda2]);
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
      description: 'Eigenvectors of a square matrix.',
      complexity: 8600,
      signature: '(matrix) -> list',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const M = ops[0].evaluate();

        if (!isTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a square matrix
        if (shape.length !== 2 || shape[0] !== shape[1]) {
          return ce.error('expected-square-matrix', M.toString());
        }

        const n = shape[0];

        // First compute eigenvalues
        const eigenvaluesExpr = ce.expr(['Eigenvalues', M]).evaluate();
        if (
          eigenvaluesExpr.operator !== 'List' ||
          !isFunction(eigenvaluesExpr) ||
          eigenvaluesExpr.ops.length === 0
        ) {
          return undefined;
        }

        const eigenvalues = eigenvaluesExpr.ops;

        // For each eigenvalue, compute the corresponding eigenvector
        const eigenvectors: Expression[] = [];
        for (const lambda of eigenvalues) {
          const eigenvector = computeEigenvector(M, lambda, n, ce);
          if (eigenvector) {
            eigenvectors.push(eigenvector);
          } else {
            // If we can't compute the eigenvector, return undefined
            return undefined;
          }
        }

        return ce.expr(['List', ...eigenvectors]);
      },
    },

    // Compute both eigenvalues and eigenvectors
    // Returns a tuple: [eigenvalues, eigenvectors]
    Eigen: {
      description: 'Eigenvalue-eigenvector decomposition of a square matrix.',
      complexity: 8700,
      signature: '(matrix) -> tuple',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const M = ops[0].evaluate();

        if (!isTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a square matrix
        if (shape.length !== 2 || shape[0] !== shape[1]) {
          return ce.error('expected-square-matrix', M.toString());
        }

        const eigenvalues = ce.expr(['Eigenvalues', M]).evaluate();
        const eigenvectors = ce.expr(['Eigenvectors', M]).evaluate();

        if (eigenvalues.operator === 'Error') return eigenvalues;
        if (eigenvectors.operator === 'Error') return eigenvectors;

        return ce.expr(['Tuple', eigenvalues, eigenvectors]);
      },
    },

    // LU Decomposition: A = LU (or PA = LU with pivoting)
    // Returns [L, U] for no pivoting or [P, L, U] with pivoting
    LUDecomposition: {
      description: 'LU decomposition of a square matrix.',
      complexity: 8600,
      signature: '(matrix) -> tuple',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const M = ops[0].evaluate();

        if (!isTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a square matrix
        if (shape.length !== 2 || shape[0] !== shape[1]) {
          return ce.error('expected-square-matrix', M.toString());
        }

        const n = shape[0];
        const result = computeLU(M, n, ce);
        if (!result) return undefined;

        const { P, L, U } = result;
        return ce.expr(['Tuple', P, L, U]);
      },
    },

    // QR Decomposition: A = QR
    // Returns [Q, R] where Q is orthogonal and R is upper triangular
    QRDecomposition: {
      description: 'QR decomposition of a matrix.',
      complexity: 8600,
      signature: '(matrix) -> tuple',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const M = ops[0].evaluate();

        if (!isTensor(M)) return undefined;

        const shape = M.shape;
        // Must be at least a 2D matrix
        if (shape.length !== 2) {
          return ce.error('expected-matrix', M.toString());
        }

        const [m, n] = shape;
        const result = computeQR(M, m, n, ce);
        if (!result) return undefined;

        const { Q, R } = result;
        return ce.expr(['Tuple', Q, R]);
      },
    },

    // Cholesky Decomposition: A = LL^T (for positive definite matrices)
    // Returns L (lower triangular matrix)
    CholeskyDecomposition: {
      description: 'Cholesky decomposition of a positive-definite matrix.',
      complexity: 8600,
      signature: '(matrix) -> matrix',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const M = ops[0].evaluate();

        if (!isTensor(M)) return undefined;

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
      description: 'Singular value decomposition of a matrix.',
      complexity: 8700,
      signature: '(matrix) -> tuple',
      evaluate: (ops, { engine: ce }): Expression | undefined => {
        const M = ops[0].evaluate();

        if (!isTensor(M)) return undefined;

        const shape = M.shape;
        // Must be a 2D matrix
        if (shape.length !== 2) {
          return ce.error('expected-matrix', M.toString());
        }

        const [m, n] = shape;
        const result = computeSVD(M, m, n, ce);
        if (!result) return undefined;

        const { U, S, V } = result;
        return ce.expr(['Tuple', U, S, V]);
      },
    },
  },
];

/**
 * Compute LU decomposition with partial pivoting
 * Returns P, L, U such that PA = LU
 */
function computeLU(
  M: Expression,
  n: number,
  ce: ComputeEngine
): { P: Expression; L: Expression; U: Expression } | undefined {
  if (!isTensor(M)) return undefined;

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
  const P: Expression[][] = [];
  for (let i = 0; i < n; i++) {
    P[i] = [];
    for (let j = 0; j < n; j++) {
      P[i][j] = perm[i] === j ? ce.One : ce.Zero;
    }
  }

  // Build result matrices
  const PExpr = ce.expr(['List', ...P.map((row) => ce.expr(['List', ...row]))]);
  const LExpr = ce.expr([
    'List',
    ...L.map((row) => ce.expr(['List', ...row.map((x) => ce.number(x))])),
  ]);
  const UExpr = ce.expr([
    'List',
    ...U.map((row) => ce.expr(['List', ...row.map((x) => ce.number(x))])),
  ]);

  return { P: PExpr, L: LExpr, U: UExpr };
}

/**
 * Compute QR decomposition using Gram-Schmidt process
 * For m×n matrix, returns Q (m×m orthogonal) and R (m×n upper triangular)
 */
function computeQR(
  M: Expression,
  m: number,
  n: number,
  ce: ComputeEngine
): { Q: Expression; R: Expression } | undefined {
  if (!isTensor(M)) return undefined;

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
  const QExpr = ce.expr([
    'List',
    ...Q.map((row) => ce.expr(['List', ...row.map((x) => ce.number(x))])),
  ]);
  const RExpr = ce.expr([
    'List',
    ...R.map((row) => ce.expr(['List', ...row.map((x) => ce.number(x))])),
  ]);

  return { Q: QExpr, R: RExpr };
}

/**
 * Compute Cholesky decomposition: A = LL^T
 * Only works for positive definite matrices
 */
function computeCholesky(
  M: Expression,
  n: number,
  ce: ComputeEngine
): Expression | undefined {
  if (!isTensor(M)) return undefined;

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
  return ce.expr([
    'List',
    ...L.map((row) => ce.expr(['List', ...row.map((x) => ce.number(x))])),
  ]);
}

/**
 * Compute Singular Value Decomposition: A = UΣV^T
 * Uses iterative algorithm based on QR iteration
 */
function computeSVD(
  M: Expression,
  m: number,
  n: number,
  ce: ComputeEngine
): { U: Expression; S: Expression; V: Expression } | undefined {
  if (!isTensor(M)) return undefined;

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
  const UExpr = ce.expr([
    'List',
    ...U.map((row) => ce.expr(['List', ...row.map((x) => ce.number(x))])),
  ]);
  const SExpr = ce.expr([
    'List',
    ...S.map((row) => ce.expr(['List', ...row.map((x) => ce.number(x))])),
  ]);
  const VExpr = ce.expr([
    'List',
    ...V.map((row) => ce.expr(['List', ...row.map((x) => ce.number(x))])),
  ]);

  return { U: UExpr, S: SExpr, V: VExpr };
}

/**
 * Get element from matrix at 1-based indices
 */
function getElement(
  M: Expression,
  i: number,
  j: number,
  ce: ComputeEngine
): Expression {
  if (!isTensor(M)) return ce.Zero;
  const val = M.tensor.at(i, j);
  return val !== undefined ? ce.expr(val) : ce.Zero;
}

/**
 * Check if matrix is diagonal or triangular
 */
function checkDiagonalOrTriangular(M: Expression, n: number): boolean {
  if (!isTensor(M)) return false;

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
  M: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!isTensor(M)) return undefined;

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

  // Characteristic polynomial λ³ − tr·λ² + m·λ − det = 0 as a depressed
  // cubic t³ + pt + q = 0 via λ = t + tr/3:
  //   p = m − tr²/3,  q = −2tr³/27 + tr·m/3 − det
  // (A sign-flipped q mirrors every root about tr/3 — invisible for spectra
  // symmetric about their mean, e.g. {1,2,3}, but wrong in general.)
  const p = minorSum - (trace * trace) / 3;
  const q = -(2 * trace * trace * trace) / 27 + (trace * minorSum) / 3 - det;

  // Solve using Cardano's formula or trigonometric method
  const eigenvalues = solveCubic(p, q, trace / 3);

  return ce.expr([
    'List',
    ...eigenvalues.map((r) =>
      typeof r === 'number' ? ce.number(r) : ce.number(ce.complex(r[0], r[1]))
    ),
  ]);
}

/**
 * Solve depressed cubic t³ + pt + q = 0, return roots shifted by shift.
 * A complex root is returned as a `[re, im]` pair (a real 3×3 matrix can
 * have one real eigenvalue and a complex-conjugate pair).
 */
function solveCubic(
  p: number,
  q: number,
  shift: number
): (number | [number, number])[] {
  const eps = 1e-10;

  // Check for special cases
  if (Math.abs(p) < eps && Math.abs(q) < eps) {
    return [shift, shift, shift];
  }

  const discriminant = (q * q) / 4 + (p * p * p) / 27;

  if (discriminant > eps) {
    // One real root and a complex-conjugate pair
    const sqrtD = Math.sqrt(discriminant);
    const u = Math.cbrt(-q / 2 + sqrtD);
    const v = Math.cbrt(-q / 2 - sqrtD);
    const realRoot = u + v + shift;
    const re = -(u + v) / 2 + shift;
    const im = (Math.sqrt(3) / 2) * (u - v);
    return [realRoot, [re, im], [re, -im]];
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
  M: Expression,
  n: number,
  ce: ComputeEngine
): Expression | undefined {
  if (!isTensor(M)) return undefined;

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

  // Reduce to upper Hessenberg form, then run the shifted (Francis
  // double-shift) QR algorithm with deflation. The double shift is an implicit
  // Wilkinson-style shift built from the trailing 2×2 block, so the iteration
  // converges on matrices where the naive unshifted QR stalls (e.g. the 8×8
  // Rosser matrix) and correctly resolves clustered/repeated eigenvalues. It
  // also handles real matrices with complex-conjugate eigenvalue pairs.
  reduceToHessenberg(A, n);
  const spectrum = hessenbergEigenvalues(A, n);
  if (spectrum === undefined) return undefined;

  const eigenvalues: Expression[] = spectrum.map((r) =>
    typeof r === 'number' ? ce.number(r) : ce.number(ce.complex(r[0], r[1]))
  );

  return ce.expr(['List', ...eigenvalues]);
}

/**
 * Reduce a real square matrix to upper Hessenberg form in place using
 * orthogonal Householder similarity transformations `A ← PAP` (which preserve
 * the spectrum). For a symmetric input the result is tridiagonal.
 */
function reduceToHessenberg(A: number[][], n: number): void {
  const sign = (x: number) => (x >= 0 ? 1 : -1);
  for (let k = 0; k < n - 2; k++) {
    // Norm of the sub-column A[k+1..n-1][k] to be reduced.
    let xnorm = 0;
    for (let i = k + 1; i < n; i++) xnorm += A[i][k] * A[i][k];
    xnorm = Math.sqrt(xnorm);
    if (xnorm === 0) continue;

    // Householder vector v (nonzero on rows k+1..n-1), reflecting the
    // sub-column onto the first coordinate. The sign avoids cancellation.
    const alpha = -sign(A[k + 1][k]) * xnorm;
    const v: number[] = new Array(n).fill(0);
    for (let i = k + 1; i < n; i++) v[i] = A[i][k];
    v[k + 1] -= alpha;

    let vnorm2 = 0;
    for (let i = k + 1; i < n; i++) vnorm2 += v[i] * v[i];
    if (vnorm2 === 0) continue;
    const beta = 2 / vnorm2;

    // Apply from the left: A ← A − β v (vᵀA).
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = k + 1; i < n; i++) s += v[i] * A[i][j];
      s *= beta;
      for (let i = k + 1; i < n; i++) A[i][j] -= v[i] * s;
    }
    // Apply from the right: A ← A − β (Av) vᵀ.
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = k + 1; j < n; j++) s += A[i][j] * v[j];
      s *= beta;
      for (let j = k + 1; j < n; j++) A[i][j] -= s * v[j];
    }
  }
}

/**
 * Eigenvalues of a real upper-Hessenberg matrix via the Francis double-shift
 * QR algorithm with deflation (the classic `hqr` scheme). Returns each
 * eigenvalue as a real `number`, or a `[re, im]` pair for members of a
 * complex-conjugate pair. Returns `undefined` if the iteration fails to
 * converge within the iteration budget.
 *
 * `a` is modified in place.
 */
function hessenbergEigenvalues(
  a: number[][],
  n: number
): (number | [number, number])[] | undefined {
  const wr = new Array<number>(n).fill(0);
  const wi = new Array<number>(n).fill(0);
  const sign = (x: number, y: number) =>
    y >= 0 ? Math.abs(x) : -Math.abs(x);

  // Matrix norm used for the deflation test.
  let anorm = 0;
  for (let i = 0; i < n; i++)
    for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);

  let nn = n - 1; // index of the current bottom-right of the active submatrix
  let t = 0; // accumulated exceptional-shift offset
  let l = 0;
  let p = 0;
  let q = 0;
  let r = 0;

  while (nn >= 0) {
    let its = 0;
    do {
      // Search for a negligible subdiagonal element to deflate at.
      for (l = nn; l >= 1; l--) {
        let s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) + s === s) {
          a[l][l - 1] = 0;
          break;
        }
      }

      let x = a[nn][nn];
      if (l === nn) {
        // One real eigenvalue has converged.
        wr[nn] = x + t;
        wi[nn] = 0;
        nn--;
      } else {
        let y = a[nn - 1][nn - 1];
        let w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          // A 2×2 block has converged: extract its two eigenvalues.
          p = 0.5 * (y - x);
          q = p * p + w;
          let z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            // Real pair.
            z = p + sign(z, p);
            wr[nn - 1] = wr[nn] = x + z;
            if (z !== 0) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            // Complex-conjugate pair.
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn] = z;
            wi[nn - 1] = -z;
          }
          nn -= 2;
        } else {
          // No convergence yet: perform a Francis double-shift QR step.
          if (its >= 60) return undefined;
          if (its === 10 || its === 20 || its === 30 || its === 40) {
            // Exceptional shift to break out of a cycle.
            t += x;
            for (let i = 0; i <= nn; i++) a[i][i] -= x;
            const s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;

          // Determine the start `m` of the bulge chase.
          let m: number;
          for (m = nn - 2; m >= l; m--) {
            const z = a[m][m];
            r = x - z;
            let s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s;
            r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s;
            q /= s;
            r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            const vv =
              Math.abs(p) *
              (Math.abs(a[m - 1][m - 1]) +
                Math.abs(z) +
                Math.abs(a[m + 1][m + 1]));
            if (u + vv === vv) break;
          }

          for (let i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0;
            if (i !== m + 2) a[i][i - 3] = 0;
          }

          // Chase the bulge from row m down to nn.
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = 0;
              if (k + 1 !== nn) r = a[k + 2][k - 1];
              x = Math.abs(p) + Math.abs(q) + Math.abs(r);
              if (x !== 0) {
                p /= x;
                q /= x;
                r /= x;
              }
            }
            const s = sign(Math.sqrt(p * p + q * q + r * r), p);
            if (s === 0) continue;
            if (k === m) {
              if (l !== m) a[k][k - 1] = -a[k][k - 1];
            } else {
              a[k][k - 1] = -s * x;
            }
            p += s;
            x = p / s;
            y = q / s;
            const z = r / s;
            q /= p;
            r /= p;
            // Row modification.
            for (let j = k; j <= nn; j++) {
              p = a[k][j] + q * a[k + 1][j];
              if (k + 1 !== nn) {
                p += r * a[k + 2][j];
                a[k + 2][j] -= p * z;
              }
              a[k + 1][j] -= p * y;
              a[k][j] -= p * x;
            }
            const mmin = nn < k + 3 ? nn : k + 3;
            // Column modification.
            for (let i = l; i <= mmin; i++) {
              p = x * a[i][k] + y * a[i][k + 1];
              if (k + 1 !== nn) {
                p += z * a[i][k + 2];
                a[i][k + 2] -= p * r;
              }
              a[i][k + 1] -= p * q;
              a[i][k] -= p;
            }
          }
        }
      }
    } while (l < nn - 1);
  }

  const result: (number | [number, number])[] = [];
  for (let i = 0; i < n; i++)
    result.push(wi[i] === 0 ? wr[i] : [wr[i], wi[i]]);
  return result;
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
 * Compute an eigenvector for `lambda` using exact rational arithmetic, or
 * `undefined` when the matrix or eigenvalue is not an exact rational (in which
 * case the caller falls back to the numeric path).
 *
 * A − λI is exact when both M and λ are exact rationals; its null space is
 * found from the exact RREF, and the first basis vector (free variable = 1,
 * pivots back-substituted — the same convention as `Kernel`) is returned.
 */
function exactEigenvector(
  M: Expression,
  lambda: Expression,
  n: number,
  ce: ComputeEngine
): Expression | undefined {
  if (!isTensor(M)) return undefined;

  // λ must be an exact rational (integers included).
  if (!isNumber(lambda) || !lambda.isExact) return undefined;
  const lam = asRational(lambda);
  if (lam === undefined) return undefined;
  const lambdaRat: BigRat = [
    typeof lam[0] === 'bigint' ? lam[0] : BigInt(lam[0]),
    typeof lam[1] === 'bigint' ? lam[1] : BigInt(lam[1]),
  ];

  // M must be an exact rational matrix.
  const A = tensorToRationalMatrix(M, n, n);
  if (!A) return undefined;

  // Build A − λI exactly.
  const AminusLambdaI: BigRat[][] = A.map((row, i) =>
    row.map((v, j) => (i === j ? ratSub(v, lambdaRat) : v))
  );

  const basis = exactRationalNullSpaceBasis(AminusLambdaI);
  if (basis.length === 0) return undefined;

  const v = basis[0];
  return ce.expr(['List', ...v.map(([num, den]) => ce.number([num, den]))]);
}

/**
 * Compute eigenvector for a given eigenvalue
 */
function computeEigenvector(
  M: Expression,
  lambda: Expression,
  n: number,
  ce: ComputeEngine
): Expression | undefined {
  if (!isTensor(M)) return undefined;

  // Exact path: when M and λ are both exact rationals, A − λI is exact, so the
  // eigenvector (a null-space vector of A − λI) can be computed with exact
  // fraction arithmetic. Irrational/complex λ falls through to the float path.
  const exact = exactEigenvector(M, lambda, n, ce);
  if (exact) return exact;

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

  return ce.expr(['List', ...eigenvector.map((x) => ce.number(x))]);
}

/**
 * Compute eigenvector for 2×2 matrix symbolically
 */
function computeEigenvector2x2Symbolic(
  M: Expression,
  lambda: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!isTensor(M)) return undefined;

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
    return ce.expr(['List', b, v2]);
  }

  const cVal = c.re;
  if (cVal !== undefined && Math.abs(cVal) > 1e-10) {
    // v = [λ - d, c]
    const d = getElement(M, 2, 2, ce);
    const v1 = lambda.sub(d).evaluate();
    return ce.expr(['List', v1, c]);
  }

  // Diagonal matrix case
  const aVal = a.re;
  const lambdaVal = lambda.re;
  if (aVal !== undefined && lambdaVal !== undefined) {
    if (Math.abs(aVal - lambdaVal) < 1e-10) {
      return ce.expr(['List', ce.One, ce.Zero]);
    } else {
      return ce.expr(['List', ce.Zero, ce.One]);
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
 * {re, im} for complex128, boolean for bool, or Expression for
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
/**
 * If `tensor` is an n×n Vandermonde matrix, return its determinant in closed
 * form as the difference product ∏_{i<j}(nodeⱼ − nodeᵢ); otherwise return
 * undefined.
 *
 * Both orientations are recognized:
 *   - row-power:    M[i][j] = nodeⱼ^(i−1), nodes taken from the 2nd row
 *   - column-power: M[i][j] = nodeᵢ^(j−1), nodes taken from the 2nd column
 * (the determinant is transpose-invariant, so both share the same product).
 *
 * Entries are compared structurally (`isSame`) against the expected monomial,
 * so the pattern must be presented already in `Power`/literal form (as it is
 * after evaluate()). No `.simplify()` is called.
 */
function vandermondeDifferenceProduct(
  tensor: Expression,
  n: number,
  ce: ComputeEngine
): Expression | undefined {
  if (!isTensor(tensor) || n < 2) return undefined;

  const at = (i: number, j: number): Expression | undefined =>
    tensor.tensor.at(i, j) as Expression | undefined;

  for (const rowPower of [true, false]) {
    const nodes: Expression[] = [];
    for (let k = 1; k <= n; k++) {
      const node = rowPower ? at(2, k) : at(k, 2);
      if (node === undefined) return undefined;
      nodes.push(node);
    }

    let matches = true;
    for (let i = 1; i <= n && matches; i++) {
      for (let j = 1; j <= n; j++) {
        const power = rowPower ? i - 1 : j - 1;
        const node = rowPower ? nodes[j - 1] : nodes[i - 1];
        const expected =
          power === 0
            ? ce.number(1)
            : power === 1
              ? node
              : ce.function('Power', [node, ce.number(power)]);
        const entry = at(i, j);
        if (entry === undefined || !entry.isSame(expected)) {
          matches = false;
          break;
        }
      }
    }

    if (matches) {
      const diffs: Expression[] = [];
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++)
          diffs.push(ce.function('Subtract', [nodes[b], nodes[a]]));
      return ce.function('Multiply', diffs);
    }
  }

  return undefined;
}

function tensorToNumericMatrix(
  tensor: Expression,
  rowCount: number,
  columnCount: number
): number[][] | undefined {
  if (!isTensor(tensor)) return undefined;

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
 * An exact rational `[numerator, denominator]`, with `denominator > 0` and the
 * fraction in lowest terms.
 */
type BigRat = [bigint, bigint];

function ratGcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function ratNorm(n: bigint, d: bigint): BigRat {
  if (d === 0n) return [0n, 1n]; // unreachable in RREF; defensive
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return [0n, 1n];
  const g = ratGcd(n, d);
  return [n / g, d / g];
}

function ratSub([an, ad]: BigRat, [bn, bd]: BigRat): BigRat {
  return ratNorm(an * bd - bn * ad, ad * bd);
}
function ratMul([an, ad]: BigRat, [bn, bd]: BigRat): BigRat {
  return ratNorm(an * bn, ad * bd);
}
function ratDiv([an, ad]: BigRat, [bn, bd]: BigRat): BigRat {
  return ratNorm(an * bd, ad * bn);
}

/**
 * Extract an exact rational matrix from a rank-2 tensor, or `undefined` if any
 * entry is not an exact integer/rational (e.g. an inexact float, a radical, a
 * symbol). Used to gate the exact RREF path.
 */
function tensorToRationalMatrix(
  tensor: Expression,
  rows: number,
  cols: number
): BigRat[][] | undefined {
  if (!isTensor(tensor)) return undefined;
  const ce = tensor.engine;
  const matrix: BigRat[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: BigRat[] = [];
    for (let j = 0; j < cols; j++) {
      const value =
        tensor.rank === 1
          ? tensor.tensor.at(j + 1)
          : tensor.tensor.at(i + 1, j + 1);
      const boxed = ce.box(value as Expression);
      if (!isNumber(boxed) || !boxed.isExact) return undefined;
      const r = asRational(boxed);
      if (r === undefined) return undefined;
      const [n, d] = r;
      row.push([
        typeof n === 'bigint' ? n : BigInt(n),
        typeof d === 'bigint' ? d : BigInt(d),
      ]);
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * Reduced row echelon form using exact rational arithmetic. Because the
 * arithmetic is exact, pivot selection can simply take the first nonzero entry
 * in the column (no numeric magnitude/tolerance considerations).
 */
function exactRationalRref(matrix: BigRat[][]): {
  matrix: BigRat[][];
  pivotCols: number[];
} {
  const rowCount = matrix.length;
  const colCount = matrix[0]?.length ?? 0;
  const out = matrix.map((row) => row.map((v) => [v[0], v[1]] as BigRat));
  const pivotCols: number[] = [];

  let pivotRow = 0;
  for (let col = 0; col < colCount && pivotRow < rowCount; col++) {
    // Find the first row at or below pivotRow with a nonzero entry in `col`.
    let sel = -1;
    for (let row = pivotRow; row < rowCount; row++) {
      if (out[row][col][0] !== 0n) {
        sel = row;
        break;
      }
    }
    if (sel === -1) continue;

    if (sel !== pivotRow) [out[pivotRow], out[sel]] = [out[sel], out[pivotRow]];

    // Normalize the pivot row so the pivot entry is 1.
    const pivot = out[pivotRow][col];
    for (let j = col; j < colCount; j++)
      out[pivotRow][j] = ratDiv(out[pivotRow][j], pivot);

    // Eliminate the pivot column from every other row.
    for (let row = 0; row < rowCount; row++) {
      if (row === pivotRow) continue;
      const factor = out[row][col];
      if (factor[0] === 0n) continue;
      for (let j = col; j < colCount; j++)
        out[row][j] = ratSub(out[row][j], ratMul(factor, out[pivotRow][j]));
    }

    pivotCols.push(col);
    pivotRow++;
  }

  return { matrix: out, pivotCols };
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
 * Return a basis of the null space of an exact rational matrix A as row
 * vectors, computed with exact rational (fraction) arithmetic.
 *
 * Each basis vector corresponds to a free column of the exact RREF: that free
 * variable is set to 1 and the pivot variables are back-substituted. This is
 * the same "free variable = 1" convention as the numeric
 * `computeNullSpaceBasis`, so the exact and float paths agree on the basis
 * (the exact path just returns exact rationals instead of floats).
 */
function exactRationalNullSpaceBasis(matrix: BigRat[][]): BigRat[][] {
  const colCount = matrix[0]?.length ?? 0;
  if (colCount === 0) return [];

  const { matrix: reduced, pivotCols } = exactRationalRref(matrix);
  const pivotSet = new Set(pivotCols);
  const freeCols: number[] = [];
  for (let col = 0; col < colCount; col++)
    if (!pivotSet.has(col)) freeCols.push(col);
  if (freeCols.length === 0) return [];

  const basis: BigRat[][] = [];
  for (const freeCol of freeCols) {
    const vector: BigRat[] = Array.from(
      { length: colCount },
      () => [0n, 1n] as BigRat
    );
    vector[freeCol] = [1n, 1n];
    for (let row = 0; row < pivotCols.length; row++) {
      const [n, d] = reduced[row][freeCol];
      vector[pivotCols[row]] = [-n, d]; // v[pivotCol] = -reduced[row][freeCol]
    }
    basis.push(vector);
  }
  return basis;
}

/**
 * Infer the finite dimension of a value when possible.
 */
function finiteDimension(value: Expression): number | undefined {
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

  if (isTensor(value)) {
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
function kernelBasisDimension(value: Expression): number | undefined {
  if (isFunction(value, 'List')) {
    if (value.ops.length === 0) return 0;
    if (value.ops.every((op) => isFunction(op, 'List'))) {
      return value.ops.length;
    }
  }

  if (isTensor(value) && (value.rank === 1 || value.rank === 2))
    return value.shape[0];

  return undefined;
}

/**
 * Return true if `value` is a polynomial expression in its unknowns.
 */
function isPolynomialExpression(value: Expression): boolean {
  if (value.isNumber) return true;
  if (isSymbol(value)) return !value.isConstant;
  if (!isFunction(value)) return false;
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
  flatElements: Expression[],
  targetShape: number[]
): Expression {
  const totalNeeded = targetShape.reduce((a, b) => a * b, 1);

  // Cycle the elements to fill target shape
  const cycledElements: Expression[] = [];
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
  data: Expression[],
  shape: number[],
  offset: number
): Expression {
  if (shape.length === 1) {
    // Base case: return a single list
    return ce.expr(['List', ...data.slice(offset, offset + shape[0])]);
  }

  // Recursive case: build lists of lists
  const outerSize = shape[0];
  const innerShape = shape.slice(1);
  const innerSize = innerShape.reduce((a, b) => a * b, 1);
  const rows: Expression[] = [];

  for (let i = 0; i < outerSize; i++) {
    rows.push(buildNestedList(ce, data, innerShape, offset + i * innerSize));
  }

  return ce.expr(['List', ...rows]);
}

function canonicalMatrix(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | null {
  const operator = 'Matrix';
  if (ops.length === 0) return ce._fn(operator, []);

  const canonOp0 = ops[0].canonical;
  const body =
    ops[0].operator === 'Vector' && isFunction(canonOp0)
      ? canonOp0.ops[0]
      : canonOp0;
  const delims = ops[1]?.canonical;
  const columns = ops[2]?.canonical;

  if (ops.length > 3) return ce._fn(operator, checkArity(ce, ops, 3));

  if (columns) return ce._fn(operator, [body, delims, columns]);
  if (delims) return ce._fn(operator, [body, delims]);
  return ce._fn(operator, [body]);
}
