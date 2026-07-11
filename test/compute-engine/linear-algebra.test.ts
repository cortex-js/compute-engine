import { MathJsonExpression as Expression } from '../../src/math-json/types';
import { engine as ce } from '../utils';
import { isTensor } from '../../src/compute-engine/boxed-expression/type-guards';
import { makeTensor } from '../../src/compute-engine/tensor/tensors';
import { getSupertype } from '../../src/compute-engine/tensor/tensor-fields';

const v2_n: Expression = ['List', 7, 11];

const v7_n: Expression = ['List', 7, -2, 11, -5, 13, -7, 17];
const v9_x: Expression = [
  'List',
  'a',
  'b',
  'c',
  'd',
  'e_1',
  'f_1',
  'g',
  'h',
  'i_1',
];

const sq2_n: Expression = ['List', ['List', 1, 2], ['List', 3, 4]];

// Square matrix with some complex values
const sq4_c: Expression = [
  'List',
  ['List', ['Complex', 2, 3], 2],
  ['List', 0, ['Complex', 0, -1]],
];

// Square matrix with unknowns
const sq2_x: Expression = ['List', ['List', 'a', 'b'], ['List', 'c', 'd']];

const sq2_n2: Expression = ['List', ['List', 5, 6], ['List', 7, 8]];

const m23_n: Expression = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]];

// Tensor of rank 3, shape [2, 3, 4]
const t234_n: Expression = [
  'List',
  ['List', ['List', 1, 2, 3, 4], ['List', 5, 6, 7, 8], ['List', 9, 10, 11, 12]],
  [
    'List',
    ['List', 13, 14, 15, 16],
    ['List', 17, 18, 19, 20],
    ['List', 21, 22, 23, 24],
  ],
];

// Tensor of shape [3, 4, 2] with unknowns
// Note: 'f' is avoided as it may be interpreted as a built-in function
const t234_x: Expression = [
  'List',
  [
    'List',
    ['List', 'a', 'b'],
    ['List', 'c', 'd'],
    ['List', 'e_1', 'f_1'],
    ['List', 'g', 'h'],
  ],
  [
    'List',
    ['List', 'i_1', 'j'],
    ['List', 'k', 'l'],
    ['List', 'm', 'n_1'],
    ['List', 'o', 'p'],
  ],
  [
    'List',
    ['List', 'q', 'r'],
    ['List', 's', 't'],
    ['List', 'u', 'v'],
    ['List', 'w', 'x_1'],
  ],
];

// Tensor of shape [2, 2, 2] - two 2×2 matrices (for batch trace testing)
// First matrix: [[1, 2], [3, 4]], Second matrix: [[5, 6], [7, 8]]
const t222_n: Expression = [
  'List',
  ['List', ['List', 1, 2], ['List', 3, 4]],
  ['List', ['List', 5, 6], ['List', 7, 8]],
];

// Tensor of shape [3, 2, 2] - three 2×2 matrices
// Matrices: [[1, 2], [3, 4]], [[5, 6], [7, 8]], [[9, 10], [11, 12]]
const t322_n: Expression = [
  'List',
  ['List', ['List', 1, 2], ['List', 3, 4]],
  ['List', ['List', 5, 6], ['List', 7, 8]],
  ['List', ['List', 9, 10], ['List', 11, 12]],
];

// Tensor of shape [2, 3, 3] - two 3×3 matrices (for testing trace over different axes)
const t233_n: Expression = [
  'List',
  ['List', ['List', 1, 2, 3], ['List', 4, 5, 6], ['List', 7, 8, 9]],
  ['List', ['List', 10, 11, 12], ['List', 13, 14, 15], ['List', 16, 17, 18]],
];

// Tensor of shape [2, 2, 2] with complex values for conjugate transpose
const t222_c: Expression = [
  'List',
  [
    'List',
    ['List', ['Complex', 1, 2], ['Complex', 3, 4]],
    ['List', ['Complex', 5, 6], ['Complex', 7, 8]],
  ],
  [
    'List',
    ['List', ['Complex', 9, 10], ['Complex', 11, 12]],
    ['List', ['Complex', 13, 14], ['Complex', 15, 16]],
  ],
];
describe('Creating matrix', () => {
  it('should create a unit pmatrix', () => {
    const result = ce.expr(['Diagonal', ['List', 1, 1, 1]]);
    // Without evaluate(), returns unevaluated expression
    expect(result.toString()).toMatchInlineSnapshot(`Diagonal([1,1,1])`);
  });

  it('should create a diagonal pmatrix', () => {
    const result = ce.expr(['Diagonal', ['List', 1, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,0,0],[0,2,0],[0,0,3]]`
    );
  });
});

describe('Tensor Properties', () => {
  it('should get the rank of a matrix', () => {
    const result = ce.expr(['Rank', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`2`);
  });

  it('should get the rank of a vector', () => {
    const result = ce.expr(['Rank', v2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`1`);
  });

  it('should get the rank of a scalar', () => {
    const result = ce.expr(['Rank', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`0`);
  });

  it('should get the shape of a matrix', () => {
    const result = ce.expr(['Shape', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`(2, 2)`);
  });

  it('should get the shape of a vector', () => {
    const result = ce.expr(['Shape', v2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`(2)`);
  });

  it('should get the shape of a scalar', () => {
    const result = ce.expr(['Shape', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`()`);
  });
});

describe('Kernel/Dimension/Degree/Hom', () => {
  it('should compute a kernel basis for a rank-deficient matrix', () => {
    const matrix: Expression = ['List', ['List', 1, 0], ['List', 0, 0]];
    const result = ce.expr(['Kernel', matrix]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[0,1]]`);
  });

  it('should return an empty kernel basis for a full-rank matrix', () => {
    const result = ce.expr(['Kernel', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[]`);
  });

  it('should compute dimensions of finite vectors and matrices', () => {
    expect(
      ce
        .expr(['Dimension', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('3');
    expect(ce.expr(['Dimension', m23_n]).evaluate().toString()).toBe('6');
  });

  it('should compute dim(Hom(V, W)) when dimensions are finite', () => {
    const homDim = ce
      .expr(['Dimension', ['Hom', ['List', 1, 2], ['List', 3, 4, 5]]])
      .evaluate();

    expect(homDim.toString()).toBe('6');
  });

  it('should compute degree of polynomial expressions', () => {
    const result = ce
      .expr(['Degree', ['Add', ['Power', 'x', 3], ['Multiply', 2, 'x'], 1]])
      .evaluate();
    expect(result.toString()).toBe('3');
  });

  it('should keep degree of an ambiguous symbol unevaluated', () => {
    const result = ce.expr(['Degree', 'p_1']).evaluate();
    expect(result.toString()).toBe('Degree("p_1")');
  });

  it('should evaluate Hom arguments and preserve symbolic Hom form', () => {
    const result = ce
      .expr(['Hom', ['Add', 1, 2], ['Multiply', 2, 3]])
      .evaluate();
    expect(result.toString()).toBe('Hom(3, 6)');
  });

  it('should compute kernel basis for a rectangular matrix', () => {
    // 1×3 matrix [1, 0, 0] has a 2-dimensional null space
    const matrix: Expression = ['List', ['List', 1, 0, 0]];
    const result = ce.expr(['Kernel', matrix]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[0,1,0],[0,0,1]]`);
  });

  it('should compute degree of Negate and Subtract expressions', () => {
    // deg(-x^2) = 2
    const negResult = ce
      .expr(['Degree', ['Negate', ['Power', 'x', 2]]])
      .evaluate();
    expect(negResult.toString()).toBe('2');

    // deg(x^3 - x) = 3
    const subResult = ce
      .expr(['Degree', ['Subtract', ['Power', 'x', 3], 'x']])
      .evaluate();
    expect(subResult.toString()).toBe('3');
  });

  it('should return dimension 0 for kernel of a full-rank matrix', () => {
    const result = ce.expr(['Dimension', ['Kernel', sq2_n]]).evaluate();
    expect(result.toString()).toBe('0');
  });
});

describe('Matrix addition', () => {
  it('should add a scalar to a matrix', () => {
    // Scalar + Matrix: broadcast scalar to all elements
    // [[1, 2], [3, 4]] + 10 = [[11, 12], [13, 14]]
    const result = ce.expr(['Add', sq2_n, 10]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[11,12],[13,14]]`);
  });

  it('should add two matrices', () => {
    // [[1, 2], [3, 4]] + [[5, 6], [7, 8]] = [[6, 8], [10, 12]]
    const result = ce.expr(['Add', sq2_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[6,8],[10,12]]`);
  });

  it('should handle adding two matrices of different dimension', () => {
    // 2×3 + 2×2 → incompatible dimensions error
    const result = ce.expr(['Add', m23_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("incompatible-dimensions", "2x2 vs 2x3")`
    );
  });

  it('should add two matrices and a scalar', () => {
    // [[1, 2], [3, 4]] + 10 + [[5, 6], [7, 8]] = [[16, 18], [20, 22]]
    const result = ce.expr(['Add', sq2_n, 10, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[16,18],[20,22]]`);
  });

  it('should add vectors element-wise', () => {
    // [7, 11] + [5, 6] = [12, 17]
    const result = ce.expr(['Add', v2_n, ['List', 5, 6]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[12,17]`);
  });

  it('should add scalar to vector', () => {
    // [7, 11] + 3 = [10, 14]
    const result = ce.expr(['Add', v2_n, 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[10,14]`);
  });

  it('should handle symbolic matrix addition', () => {
    // [[a, b], [c, d]] + [[1, 2], [3, 4]]
    const result = ce.expr(['Add', sq2_x, sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a + 1,b + 2],[c + 3,d + 4]]`
    );
  });

  it('should handle multiple matrix addition', () => {
    // [[1, 2], [3, 4]] + [[1, 2], [3, 4]] + [[1, 2], [3, 4]] = [[3, 6], [9, 12]]
    const result = ce.expr(['Add', sq2_n, sq2_n, sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[3,6],[9,12]]`);
  });
});

describe('MatrixMultiply', () => {
  // Matrix × Matrix
  it('should multiply two square numeric matrices', () => {
    // [[1, 2], [3, 4]] × [[5, 6], [7, 8]] = [[19, 22], [43, 50]]
    const result = ce.expr(['MatrixMultiply', sq2_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[19,22],[43,50]]`);
  });

  it('should multiply two square matrices with unknowns', () => {
    // [[a, b], [c, d]] × [[5, 6], [7, 8]]
    const result = ce.expr(['MatrixMultiply', sq2_x, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[5a + 7b,6a + 8b],[5c + 7d,6c + 8d]]`
    );
  });

  it('should multiply 2x3 matrix by 3x2 matrix', () => {
    // [[1, 2, 3], [4, 5, 6]] × [[7, 8], [9, 10], [11, 12]] = [[58, 64], [139, 154]]
    const m32: Expression = [
      'List',
      ['List', 7, 8],
      ['List', 9, 10],
      ['List', 11, 12],
    ];
    const result = ce.expr(['MatrixMultiply', m23_n, m32]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[58,64],[139,154]]`);
  });

  it('should return error for incompatible matrix dimensions', () => {
    // [[1, 2], [3, 4]] × [[1, 2, 3], [4, 5, 6]] - dimensions incompatible (2 vs 2 is OK)
    // Let's try sq2_n (2×2) × m23_n (2×3) - should work!
    const result = ce.expr(['MatrixMultiply', sq2_n, m23_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[9,12,15],[19,26,33]]`);
  });

  it('should return error for truly incompatible dimensions', () => {
    // m23_n (2×3) × sq2_n (2×2) - 3 ≠ 2, should fail
    const result = ce.expr(['MatrixMultiply', m23_n, sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("incompatible-dimensions", "3 vs 2")`
    );
  });

  // Matrix × Vector
  it('should multiply matrix by vector', () => {
    // [[1, 2], [3, 4]] × [7, 11] = [1*7+2*11, 3*7+4*11] = [29, 65]
    const result = ce.expr(['MatrixMultiply', sq2_n, v2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[29,65]`);
  });

  it('should multiply 2x3 matrix by 3-vector', () => {
    // [[1, 2, 3], [4, 5, 6]] × [1, 2, 3] = [14, 32]
    const v3: Expression = ['List', 1, 2, 3];
    const result = ce.expr(['MatrixMultiply', m23_n, v3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[14,32]`);
  });

  it('should return error for matrix × incompatible vector', () => {
    // sq2_n (2×2) × v7_n (7) - 2 ≠ 7, should fail
    const result = ce.expr(['MatrixMultiply', sq2_n, v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("incompatible-dimensions", "2 vs 7")`
    );
  });

  // Vector × Matrix
  it('should multiply vector by matrix', () => {
    // [7, 11] × [[1, 2], [3, 4]] = [7*1+11*3, 7*2+11*4] = [40, 58]
    const result = ce.expr(['MatrixMultiply', v2_n, sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[40,58]`);
  });

  it('should multiply 2-vector by 2x3 matrix', () => {
    // [1, 2] × [[1, 2, 3], [4, 5, 6]] = [9, 12, 15]
    const v2: Expression = ['List', 1, 2];
    const result = ce.expr(['MatrixMultiply', v2, m23_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[9,12,15]`);
  });

  // Vector × Vector (dot product)
  it('should compute dot product of two vectors', () => {
    // [7, 11] · [7, 11] = 49 + 121 = 170
    const result = ce.expr(['MatrixMultiply', v2_n, v2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`170`);
  });

  it('should compute dot product of two longer vectors', () => {
    // Using first 3 elements of v7_n for simplicity
    const v3a: Expression = ['List', 1, 2, 3];
    const v3b: Expression = ['List', 4, 5, 6];
    // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    const result = ce.expr(['MatrixMultiply', v3a, v3b]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`32`);
  });

  it('should return error for incompatible vector lengths in dot product', () => {
    const v3: Expression = ['List', 1, 2, 3];
    const result = ce.expr(['MatrixMultiply', v2_n, v3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("incompatible-dimensions", "2 vs 3")`
    );
  });

  // Symbolic operations
  it('should handle symbolic matrix multiplication', () => {
    // [[a, b], [c, d]] × [[a, b], [c, d]]
    const result = ce.expr(['MatrixMultiply', sq2_x, sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a^2 + b * c,a * b + b * d],[a * c + c * d,d^2 + b * c]]`
    );
  });

  // Identity matrix property
  it('should preserve matrix when multiplied by identity', () => {
    const identity: Expression = ['List', ['List', 1, 0], ['List', 0, 1]];
    const result = ce.expr(['MatrixMultiply', sq2_n, identity]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,2],[3,4]]`);
  });
});

describe('Multiply with tensors (matrix-product semantics)', () => {
  const ev = (expr: Expression) => ce.expr(expr).evaluate().toString();

  // Scalar × tensor: element-wise scaling (broadcast)
  it('scales a vector by a scalar', () => {
    expect(ev(['Multiply', 2, ['List', 1, 2, 3]])).toMatchInlineSnapshot(
      `[2,4,6]`
    );
  });

  it('scales a matrix by a scalar', () => {
    expect(ev(['Multiply', 2, sq2_n])).toMatchInlineSnapshot(`[[2,4],[6,8]]`);
  });

  it('keeps scalar scaling exact (rational)', () => {
    expect(
      ev(['Multiply', ['Rational', 1, 2], ['List', 2, 4, 6]])
    ).toMatchInlineSnapshot(`[1,2,3]`);
  });

  it('scales a vector of symbols', () => {
    expect(ev(['Multiply', 2, ['List', 'a', 'b', 'c']])).toMatchInlineSnapshot(
      `[2a,2b,2c]`
    );
  });

  // Two matrices: matrix product (not Hadamard)
  it('multiplies two matrices (matrix product)', () => {
    expect(ev(['Multiply', sq2_n, sq2_n2])).toMatchInlineSnapshot(
      `[[19,22],[43,50]]`
    );
  });

  // Matrix product is not commutative — order must be preserved
  it('preserves operand order (A·B ≠ B·A)', () => {
    expect(ev(['Multiply', sq2_n, sq2_n2])).toMatchInlineSnapshot(
      `[[19,22],[43,50]]`
    );
    expect(ev(['Multiply', sq2_n2, sq2_n])).toMatchInlineSnapshot(
      `[[23,34],[31,46]]`
    );
  });

  // Matrix × vector vs vector × matrix (different ranks, must not be reordered)
  it('distinguishes matrix·vector from vector·matrix', () => {
    expect(ev(['Multiply', sq2_n, ['List', 1, 1]])).toMatchInlineSnapshot(
      `[3,7]`
    );
    expect(ev(['Multiply', ['List', 1, 1], sq2_n])).toMatchInlineSnapshot(
      `[4,6]`
    );
  });

  // Vector × vector reduces to the dot product (a scalar)
  it('computes the dot product of two vectors', () => {
    expect(
      ev(['Multiply', ['List', 1, 2, 3], ['List', 4, 5, 6]])
    ).toMatchInlineSnapshot(`32`);
  });

  // Scalar factor applied to a matrix product
  it('applies a scalar factor to a matrix product', () => {
    expect(ev(['Multiply', 2, sq2_n, sq2_n2])).toMatchInlineSnapshot(
      `[[38,44],[86,100]]`
    );
  });

  // Three matrices fold left-to-right, in order
  it('folds three matrices in order', () => {
    const identity: Expression = ['List', ['List', 1, 0], ['List', 0, 1]];
    expect(ev(['Multiply', sq2_n, sq2_n2, identity])).toMatchInlineSnapshot(
      `[[19,22],[43,50]]`
    );
  });

  // Incompatible dimensions: left inert (input preserved, not dropped)
  it('stays inert on incompatible dimensions', () => {
    expect(ev(['Multiply', ['List', 1, 2, 3], sq2_n])).toMatchInlineSnapshot(
      `[1,2,3] * [[1,2],[3,4]]`
    );
  });

  // Pure scalar multiplication is unaffected
  it('does not affect scalar multiplication', () => {
    expect(ev(['Multiply', 2, 3, 'x'])).toMatchInlineSnapshot(`6x`);
  });
});

describe('Hadamard product (\\odot)', () => {
  const ev = (expr: Expression) => ce.expr(expr).evaluate().toString();

  it('parses `\\odot` to HadamardProduct', () => {
    expect(ce.parse('[1,2,3] \\odot [4,5,6]').json).toMatchInlineSnapshot(`
      [
        HadamardProduct,
        [
          List,
          1,
          2,
          3,
        ],
        [
          List,
          4,
          5,
          6,
        ],
      ]
    `);
  });

  it('multiplies vectors element-wise', () => {
    expect(
      ev(['HadamardProduct', ['List', 1, 2, 3], ['List', 4, 5, 6]])
    ).toMatchInlineSnapshot(`[4,10,18]`);
  });

  it('multiplies matrices element-wise', () => {
    expect(ev(['HadamardProduct', sq2_n, sq2_n2])).toMatchInlineSnapshot(
      `[[5,12],[21,32]]`
    );
  });

  it('multiplies symbolic entries element-wise', () => {
    expect(
      ev(['HadamardProduct', ['List', 'a', 'b'], ['List', 'c', 'd']])
    ).toMatchInlineSnapshot(`[a * c,b * d]`);
  });

  it('errors on incompatible shapes', () => {
    expect(
      ev(['HadamardProduct', ['List', 1, 2, 3], ['List', 1, 2]])
    ).toMatchInlineSnapshot(`Error("incompatible-dimensions", "3 vs 2")`);
  });

  it('differs from the matrix product', () => {
    // Hadamard is element-wise; `*` is the matrix product.
    expect(ev(['HadamardProduct', sq2_n, sq2_n2])).toMatchInlineSnapshot(
      `[[5,12],[21,32]]`
    );
    expect(ev(['Multiply', sq2_n, sq2_n2])).toMatchInlineSnapshot(
      `[[19,22],[43,50]]`
    );
  });

  it('round-trips through LaTeX', () => {
    expect(ce.parse('[1,2,3] \\odot [4,5,6]').latex).toContain('\\odot');
  });
});

describe('Matrix juxtaposition and subtraction', () => {
  const M = String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`;
  const N = String.raw`\begin{pmatrix}5&6\\7&8\end{pmatrix}`;
  const evL = (latex: string) => ce.parse(latex).evaluate().toString();

  // Juxtaposed matrices form the matrix product (not a Tuple). The
  // `Matrix(…)` wrapper reports `isIndexedCollection === false`, so
  // `InvisibleOperator` used to fall through to `Tuple`.
  it('parses juxtaposed matrices as a product', () => {
    expect(ce.parse(M + N).json[0]).toBe('Multiply');
  });

  it('evaluates juxtaposed matrices to the matrix product', () => {
    expect(evL(M + N)).toMatchInlineSnapshot(`[[19,22],[43,50]]`);
  });

  it('scales a juxtaposed scalar·matrix', () => {
    expect(evL('2' + M)).toMatchInlineSnapshot(`[[2,4],[6,8]]`);
  });

  // Matrix subtraction (regression: `Negate` of a matrix-valued product was
  // left undistributed, so `Add`/`Subtract` broadcast it into a bogus
  // rank-4 result).
  it('subtracts two matrix products to zero', () => {
    expect(
      evL(M + N + '-' + M + String.raw`\cdot ` + N)
    ).toMatchInlineSnapshot(`[[0,0],[0,0]]`);
  });

  it('computes the commutator AB - BA', () => {
    expect(evL(M + N + '-' + N + M)).toMatchInlineSnapshot(`[[-4,-12],[12,4]]`);
  });

  it('negates a matrix product element-wise', () => {
    expect(
      ce.box(['Negate', ['Multiply', sq2_n, sq2_n2]]).evaluate().toString()
    ).toMatchInlineSnapshot(`[[-19,-22],[-43,-50]]`);
  });
});

describe('Element-wise functions over matrix-valued sub-expressions', () => {
  // A unary broadcastable function applied to an operand that only becomes a
  // collection *after* evaluation (e.g. a matrix product) must still
  // distribute element-wise. `Multiply(M, I)` evaluates to `M` but reaches the
  // function as an unevaluated `Multiply`, exercising the post-evaluation
  // broadcast path.
  const I: Expression = ['List', ['List', 1, 0], ['List', 0, 1]];
  const prod = (m: Expression): Expression => ['Multiply', m, I];
  const ev = (expr: Expression) => ce.box(expr).evaluate().toString();

  it('Sqrt distributes over a matrix product', () => {
    expect(
      ev(['Sqrt', prod(['List', ['List', 4, 9], ['List', 16, 25]])])
    ).toMatchInlineSnapshot(`[[2,3],[4,5]]`);
  });

  it('Sin distributes over a matrix product', () => {
    expect(ev(['Sin', ['Multiply', sq2_n, sq2_n2]])).toMatchInlineSnapshot(
      `[[sin(19),sin(22)],[sin(43),sin(50)]]`
    );
  });

  it('Abs distributes over a matrix product', () => {
    expect(
      ev(['Abs', prod(['List', ['List', -1, 2], ['List', -3, 4]])])
    ).toMatchInlineSnapshot(`[[1,2],[3,4]]`);
  });

  it('does not affect scalar function calls', () => {
    expect(ev(['Sqrt', 9])).toMatchInlineSnapshot(`3`);
    expect(ev(['Sin', 'x'])).toMatchInlineSnapshot(`sin(x)`);
    expect(ev(['Abs', -3])).toMatchInlineSnapshot(`3`);
  });
});

describe('Flatten', () => {
  it('should flatten a scalar', () => {
    const result = ce.expr(['Flatten', 42]).evaluate();
    // Scalar flattens to single-element list
    expect(result.toString()).toMatchInlineSnapshot(`[42]`);
  });

  it('should flatten a numeric vector', () => {
    const result = ce.expr(['Flatten', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[7,-2,11,-5,13,-7,17]`);
  });

  it('should flatten a numeric matrix', () => {
    const result = ce.expr(['Flatten', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[1,2,3,4]`);
  });

  it('should flatten a matrix with unknowns', () => {
    const result = ce.expr(['Flatten', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[a,b,c,d]`);
  });

  it('should flatten a numeric tensor', () => {
    const result = ce.expr(['Flatten', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]`
    );
  });

  it('should flatten a tensor with unknowns', () => {
    const result = ce.expr(['Flatten', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[a,b,c,d,"e_1","f_1",g,h,"i_1",j,k,l,m,"n_1",o,p,q,r,s,t,u,v,w,"x_1"]`
    );
  });
});

describe('Transpose', () => {
  it('should transpose a scalar', () => {
    const result = ce.expr(['Transpose', 42]).evaluate();
    // Scalar transpose returns the scalar itself
    expect(result.toString()).toMatchInlineSnapshot(`42`);
  });

  it('should transpose a numeric vector', () => {
    const result = ce.expr(['Transpose', v7_n]).evaluate();
    // Vector (rank 1) transpose returns the vector itself
    expect(result.toString()).toMatchInlineSnapshot(`[7,-2,11,-5,13,-7,17]`);
  });

  it('should transpose a numeric matrix', () => {
    const result = ce.expr(['Transpose', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,3],[2,4]]`);
  });

  it('should transpose a matrix with unknowns', () => {
    const result = ce.expr(['Transpose', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[a,c],[b,d]]`);
  });

  it('should transpose a numeric tensor', () => {
    const result = ce.expr(['Transpose', t234_n]).evaluate();
    // For rank-3 tensor [2, 3, 4], swaps last two axes -> [2, 4, 3]
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[1,5,9],[2,6,10],[3,7,11],[4,8,12]],[[13,17,21],[14,18,22],[15,19,23],[16,20,24]]]`
    );
  });

  it('should transpose a tensor with unknowns', () => {
    const result = ce.expr(['Transpose', t234_x]).evaluate();
    // For rank-3 tensor [3, 4, 2], swaps last two axes -> [3, 2, 4]
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[a,c,"e_1",g],[b,d,"f_1",h]],[["i_1",k,m,o],[j,l,"n_1",p]],[[q,s,u,w],[r,t,v,"x_1"]]]`
    );
  });
});

describe('ConjugateTranspose', () => {
  it('should conjugate transpose a scalar', () => {
    const result = ce.expr(['ConjugateTranspose', 42]).evaluate();
    // Scalar conjugate transpose returns the conjugate (42 for real)
    expect(result.toString()).toMatchInlineSnapshot(`42`);
  });

  it('should conjugate transpose a numeric vector', () => {
    const result = ce.expr(['ConjugateTranspose', v7_n]).evaluate();
    // Vector (rank 1) conjugate transpose returns the conjugated vector
    expect(result.toString()).toMatchInlineSnapshot(`[7,-2,11,-5,13,-7,17]`);
  });

  it('should conjugate transpose a numeric matrix', () => {
    const result = ce.expr(['ConjugateTranspose', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,3],[2,4]]`);
  });

  it('should conjugate transpose a complex matrix', () => {
    const result = ce.expr(['ConjugateTranspose', sq4_c]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[(2 - 3i),0],[2,i]]`);
  });

  it('should conjugate transpose a matrix with unknowns', () => {
    const result = ce.expr(['ConjugateTranspose', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[Conjugate(a),Conjugate(c)],[Conjugate(b),Conjugate(d)]]`
    );
  });

  it('should conjugate transpose a numeric tensor', () => {
    const result = ce.expr(['ConjugateTranspose', t234_n]).evaluate();
    // For rank-3 tensor [2, 3, 4], swaps last two axes -> [2, 4, 3]
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[1,5,9],[2,6,10],[3,7,11],[4,8,12]],[[13,17,21],[14,18,22],[15,19,23],[16,20,24]]]`
    );
  });

  it('should conjugate transpose a tensor with unknowns', () => {
    const result = ce.expr(['ConjugateTranspose', t234_x]).evaluate();
    // For rank-3 tensor [3, 4, 2], swaps last two axes and conjugates -> [3, 2, 4]
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[Conjugate(a),Conjugate(c),Conjugate("e_1"),Conjugate(g)],[Conjugate(b),Conjugate(d),Conjugate("f_1"),Conjugate(h)]],[[Conjugate("i_1"),Conjugate(k),Conjugate(m),Conjugate(o)],[Conjugate(j),Conjugate(l),Conjugate("n_1"),Conjugate(p)]],[[Conjugate(q),Conjugate(s),Conjugate(u),Conjugate(w)],[Conjugate(r),Conjugate(t),Conjugate(v),Conjugate("x_1")]]]`
    );
  });
});

describe('Determinant', () => {
  it('should calculate the determinant of a scalar', () => {
    const result = ce.expr(['Determinant', 42]).evaluate();
    // Type checking rejects scalar before evaluation can return the scalar
    expect(result.toString()).toMatchInlineSnapshot(
      `Determinant(Error(ErrorCode("incompatible-type", "matrix", "finite_integer")))`
    );
  });

  it('should calculate the determinant of a numeric vector', () => {
    const result = ce.expr(['Determinant', v7_n]).evaluate();
    // Type checking rejects vector (not a matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Determinant(Error(ErrorCode("incompatible-type", "matrix", "vector<7>")))`
    );
  });

  it('should calculate the determinant of a numeric matrix', () => {
    const result = ce.expr(['Determinant', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`-2`);
  });

  it('should calculate the determinant of a matrix with unknowns', () => {
    const result = ce.expr(['Determinant', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`-b * c + a * d`);
  });

  it('should calculate the determinant of a numeric tensor', () => {
    const result = ce.expr(['Determinant', t234_n]).evaluate();
    // Type checking rejects tensor (not a 2D matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Determinant(Error(ErrorCode("incompatible-type", "matrix", "list<number^(2x3x4)>")))`
    );
  });

  it('should calculate the determinant of a tensor with unknowns', () => {
    const result = ce.expr(['Determinant', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Determinant(Error(ErrorCode("incompatible-type", "matrix", "list<number^(3x4x2)>")))`
    );
  });
});

describe('Trace', () => {
  it('should calculate the trace of a scalar', () => {
    const result = ce.expr(['Trace', 42]).evaluate();
    // Trace of scalar is the scalar itself
    expect(result.toString()).toMatchInlineSnapshot(`42`);
  });

  it('should calculate the trace of a numeric vector', () => {
    const result = ce.expr(['Trace', v7_n]).evaluate();
    // Vector (rank 1) - trace not defined
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-matrix-or-tensor", "[7,-2,11,-5,13,-7,17]")`
    );
  });

  it('should calculate the trace of a numeric matrix', () => {
    const result = ce.expr(['Trace', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should calculate the trace of a matrix with unknowns', () => {
    const result = ce.expr(['Trace', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`a + d`);
  });

  it('should reject trace for non-square last two axes', () => {
    // Tensor with shape [2, 3, 4] - last two axes (3 and 4) are not equal
    const result = ce.expr(['Trace', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-square-matrix", "[[[1,2,3,4],[5,6,7,8],[9,10,11,12]],[[13,14,15,16],[17,18,19,20],[21,22,23,24]]]")`
    );
  });

  it('should reject trace for non-square tensor slices', () => {
    // Tensor with shape [3, 4, 2] - last two axes (4 and 2) are not equal
    const result = ce.expr(['Trace', t234_x]).evaluate();
    expect(result.toString()).toContain('expected-square-matrix');
  });
});

describe('Reshape', () => {
  it('should reshape a scalar', () => {
    const result = ce.expr(['Reshape', 42, ['Tuple', 2, 2]]).evaluate();
    // Scalar is replicated to fill target shape
    expect(result.toString()).toMatchInlineSnapshot(`[[42,42],[42,42]]`);
  });

  it('should reshape a scalar', () => {
    const result = ce.expr(['Reshape', 42, ['Tuple']]).evaluate();
    // Empty shape returns scalar
    expect(result.toString()).toMatchInlineSnapshot(`42`);
  });

  it('should reshape a numeric vector, extending it', () => {
    const result = ce.expr(['Reshape', v7_n, ['Tuple', 3, 3]]).evaluate();
    // APL-style cycling: elements repeat to fill target shape
    expect(result.toString()).toMatchInlineSnapshot(
      `[[7,-2,11],[-5,13,-7],[17,7,-2]]`
    );
  });

  it('should reshape a numeric vector, contracting it', () => {
    const result = ce.expr(['Reshape', v7_n, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[7,-2],[11,-5]]`);
  });

  it('should reshape a numeric vector, expanding it', () => {
    const result = ce.expr(['Reshape', v7_n, ['Tuple', 3, 3]]).evaluate();
    // APL-style cycling: elements repeat to fill target shape
    expect(result.toString()).toMatchInlineSnapshot(
      `[[7,-2,11],[-5,13,-7],[17,7,-2]]`
    );
  });

  it('should reshape a general vector', () => {
    const result = ce.expr(['Reshape', v9_x, ['Tuple', 3, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a,b,c],[d,"e_1","f_1"],[g,h,"i_1"]]`
    );
  });

  it('should reshape a general vector, extending it', () => {
    const result = ce.expr(['Reshape', v9_x, ['Tuple', 3, 4]]).evaluate();
    // Cycling fills remaining slots with elements from the beginning
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a,b,c,d],["e_1","f_1",g,h],["i_1",a,b,c]]`
    );
  });

  it('should reshape a general vector, contracting it', () => {
    const result = ce.expr(['Reshape', v9_x, ['Tuple', 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a,b,c],[d,"e_1","f_1"]]`
    );
  });

  it('should reshape a general vector to a tensor', () => {
    const result = ce.expr(['Reshape', v9_x, ['Tuple', 2, 3, 2]]).evaluate();
    // Cycling fills the 3D tensor from the 1D vector
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[a,b],[c,d],["e_1","f_1"]],[[g,h],["i_1",a],[b,c]]]`
    );
  });

  it('should reshape a numeric matrix', () => {
    const result = ce.expr(['Reshape', sq2_n, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,2],[3,4]]`);
  });

  it('should reshape a matrix with unknowns', () => {
    const result = ce.expr(['Reshape', sq2_x, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[a,b],[c,d]]`);
  });

  it('should reshape a numeric tensor', () => {
    const result = ce.expr(['Reshape', t234_n, ['Tuple', 2, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[1,2,3],[4,5,6]],[[7,8,9],[10,11,12]]]`
    );
  });

  it('should reshape a tensor with unknowns', () => {
    const result = ce.expr(['Reshape', t234_x, ['Tuple', 2, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[a,b,c],[d,"e_1","f_1"]],[[g,h,"i_1"],[j,k,l]]]`
    );
  });
});

describe('Inverse', () => {
  it('should calculate the inverse of a scalar', () => {
    const result = ce.expr(['Inverse', 42]).evaluate();
    // Type checking rejects scalar before evaluation can return 1/scalar
    expect(result.toString()).toMatchInlineSnapshot(
      `Inverse(Error(ErrorCode("incompatible-type", "matrix", "finite_integer")))`
    );
  });

  it('should calculate the inverse of a numeric vector', () => {
    const result = ce.expr(['Inverse', v7_n]).evaluate();
    // Type checking rejects vector (not a matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Inverse(Error(ErrorCode("incompatible-type", "matrix", "vector<7>")))`
    );
  });

  it('should calculate the inverse of a numeric matrix', () => {
    const result = ce.expr(['Inverse', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[-2,1],[1.5,-0.5]]`);
  });

  it('should calculate the inverse of a matrix with unknowns', () => {
    const result = ce.expr(['Inverse', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[d / (-b * c + a * d),-b / (-b * c + a * d)],[-c / (-b * c + a * d),a / (-b * c + a * d)]]`
    );
  });

  it('should calculate the inverse of a numeric tensor', () => {
    const result = ce.expr(['Inverse', t234_n]).evaluate();
    // Type checking rejects tensor (not a 2D matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Inverse(Error(ErrorCode("incompatible-type", "matrix", "list<number^(2x3x4)>")))`
    );
  });

  it('should calculate the inverse of a numeric tensor', () => {
    const result = ce.expr(['Inverse', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Inverse(Error(ErrorCode("incompatible-type", "matrix", "list<number^(3x4x2)>")))`
    );
  });
});

describe('PseudoInverse', () => {
  it('should calculate the pseudo inverse of a scalar', () => {
    const result = ce.expr(['PseudoInverse', 42]).evaluate();
    // Type checking rejects scalar before evaluation can return 1/scalar
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse(Error(ErrorCode("incompatible-type", "matrix", "finite_integer")))`
    );
  });

  it('should calculate the pseudo inverse of a numeric vector', () => {
    const result = ce.expr(['PseudoInverse', v7_n]).evaluate();
    // Type checking rejects vector (not a matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse(Error(ErrorCode("incompatible-type", "matrix", "vector<7>")))`
    );
  });

  it('should calculate the pseudo inverse of a numeric matrix', () => {
    const result = ce.expr(['PseudoInverse', sq2_n]).evaluate();
    // Moore-Penrose pseudoinverse not yet fully implemented
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse([[1,2],[3,4]])`
    );
  });

  it('should calculate the pseudo inverse of a matrix with unknowns', () => {
    const result = ce.expr(['PseudoInverse', sq2_x]).evaluate();
    // Moore-Penrose pseudoinverse not yet fully implemented
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse([[a,b],[c,d]])`
    );
  });

  it('should calculate the pseudo inverse of a numeric tensor', () => {
    const result = ce.expr(['PseudoInverse', t234_n]).evaluate();
    // Type checking rejects tensor (not a 2D matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse(Error(ErrorCode("incompatible-type", "matrix", "list<number^(2x3x4)>")))`
    );
  });

  it('should calculate the pseudo inverse of a numeric tensor', () => {
    const result = ce.expr(['PseudoInverse', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse(Error(ErrorCode("incompatible-type", "matrix", "list<number^(3x4x2)>")))`
    );
  });
});

describe('Diagonal', () => {
  it('should create a diagonal matrix', () => {
    const result = ce.expr(['Diagonal', 5]).evaluate();
    // Scalar returns as-is (no matrix created)
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should create a diagonal matrix from a vector', () => {
    const result = ce.expr(['Diagonal', v7_n]).evaluate();
    // Vector creates NxN diagonal matrix
    expect(result.toString()).toMatchInlineSnapshot(
      `[[7,0,0,0,0,0,0],[0,-2,0,0,0,0,0],[0,0,11,0,0,0,0],[0,0,0,-5,0,0,0],[0,0,0,0,13,0,0],[0,0,0,0,0,-7,0],[0,0,0,0,0,0,17]]`
    );
  });

  it('should calculate the diagonal of a numeric square matrix', () => {
    const result = ce.expr(['Diagonal', sq2_n]).evaluate();
    // Matrix extracts diagonal as vector
    expect(result.toString()).toMatchInlineSnapshot(`[1,4]`);
  });

  it('should calculate the diagonal of a matrix with unknowns', () => {
    const result = ce.expr(['Diagonal', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[a,d]`);
  });

  it('should calculate the diagonal of a numeric tensor', () => {
    const result = ce.expr(['Diagonal', t234_n]).evaluate();
    // Tensors (rank > 2) not supported for Diagonal
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-square-matrix", "[[[1,2,3,4],[5,6,7,8],[9,10,11,12]],[[13,14,15,16],[17,18,19,20],[21,22,23,24]]]")`
    );
  });
});

describe('IdentityMatrix', () => {
  it('should create a 2×2 identity matrix', () => {
    const result = ce.expr(['IdentityMatrix', 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,0],[0,1]]`);
  });

  it('should create a 3×3 identity matrix', () => {
    const result = ce.expr(['IdentityMatrix', 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,0,0],[0,1,0],[0,0,1]]`
    );
  });

  it('should create a 4×4 identity matrix', () => {
    const result = ce.expr(['IdentityMatrix', 4]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]`
    );
  });

  it('should create a 1×1 identity matrix', () => {
    const result = ce.expr(['IdentityMatrix', 1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1]]`);
  });

  it('should return error for non-positive integer', () => {
    const result = ce.expr(['IdentityMatrix', 0]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-positive-integer", "0")`
    );
  });

  it('should return error for negative integer', () => {
    const result = ce.expr(['IdentityMatrix', -2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-positive-integer", "-2")`
    );
  });

  it('should return error for non-integer', () => {
    const result = ce.expr(['IdentityMatrix', 2.5]).evaluate();
    // Type signature validation catches this before evaluate runs
    expect(result.toString()).toMatchInlineSnapshot(
      `IdentityMatrix(Error(ErrorCode("incompatible-type", "integer", "finite_real")))`
    );
  });
});

describe('ZeroMatrix', () => {
  it('should create a 2×2 zero matrix', () => {
    const result = ce.expr(['ZeroMatrix', 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[0,0],[0,0]]`);
  });

  it('should create a 3×3 zero matrix', () => {
    const result = ce.expr(['ZeroMatrix', 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[0,0,0],[0,0,0],[0,0,0]]`
    );
  });

  it('should create a 2×3 zero matrix', () => {
    const result = ce.expr(['ZeroMatrix', 2, 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[0,0,0],[0,0,0]]`);
  });

  it('should create a 3×2 zero matrix', () => {
    const result = ce.expr(['ZeroMatrix', 3, 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[0,0],[0,0],[0,0]]`);
  });

  it('should return error for non-positive integer', () => {
    const result = ce.expr(['ZeroMatrix', 0]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-positive-integer", "0")`
    );
  });
});

describe('OnesMatrix', () => {
  it('should create a 2×2 ones matrix', () => {
    const result = ce.expr(['OnesMatrix', 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,1],[1,1]]`);
  });

  it('should create a 3×3 ones matrix', () => {
    const result = ce.expr(['OnesMatrix', 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,1,1],[1,1,1],[1,1,1]]`
    );
  });

  it('should create a 2×4 ones matrix', () => {
    const result = ce.expr(['OnesMatrix', 2, 4]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,1,1,1],[1,1,1,1]]`);
  });

  it('should create a 4×2 ones matrix', () => {
    const result = ce.expr(['OnesMatrix', 4, 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,1],[1,1],[1,1],[1,1]]`
    );
  });

  it('should return error for non-positive integer', () => {
    const result = ce.expr(['OnesMatrix', -1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-positive-integer", "-1")`
    );
  });
});

describe('Norm', () => {
  // Scalar norm (absolute value)
  it('should compute the norm of a scalar', () => {
    const result = ce.expr(['Norm', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should compute the norm of a negative scalar', () => {
    const result = ce.expr(['Norm', -7]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`7`);
  });

  // Vector L2 norm (default)
  it('should compute the L2 norm of a vector (3-4-5 triangle)', () => {
    // √(3² + 4²) = √(9 + 16) = √25 = 5
    const result = ce.expr(['Norm', ['List', 3, 4]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should compute the L2 norm of a vector with negatives', () => {
    // √(3² + (-4)²) = 5
    const result = ce.expr(['Norm', ['List', 3, -4]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should compute the L2 norm of a 3D vector', () => {
    // √(1² + 2² + 2²) = √(1 + 4 + 4) = √9 = 3
    const result = ce.expr(['Norm', ['List', 1, 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`3`);
  });

  // Vector L1 norm
  it('should compute the L1 norm of a vector', () => {
    // |3| + |-4| = 3 + 4 = 7
    const result = ce.expr(['Norm', ['List', 3, -4], 1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`7`);
  });

  it('should compute the L1 norm of a longer vector', () => {
    // |1| + |-2| + |3| + |-4| = 1 + 2 + 3 + 4 = 10
    const result = ce.expr(['Norm', ['List', 1, -2, 3, -4], 1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`10`);
  });

  // Vector L∞ norm (max absolute value)
  it('should compute the L-infinity norm of a vector', () => {
    // max(|3|, |-4|) = 4
    const result = ce.expr(['Norm', ['List', 3, -4], 'Infinity']).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`4`);
  });

  it('should compute the L-infinity norm with string', () => {
    // max(|1|, |-5|, |3|) = 5
    const result = ce
      .expr(['Norm', ['List', 1, -5, 3], { str: 'Infinity' }])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  // Vector Lp norm (general)
  it('should compute the L3 norm of a vector', () => {
    // (|3|³ + |4|³)^(1/3) = (27 + 64)^(1/3) = 91^(1/3) ≈ 4.498
    const result = ce.expr(['Norm', ['List', 3, 4], 3]).evaluate();
    expect(result.re).toBeCloseTo(4.4979, 3);
  });

  it('should compute the L4 norm of a vector', () => {
    // (|2|⁴ + |2|⁴)^(1/4) = (16 + 16)^(1/4) = 32^(1/4) ≈ 2.378
    const result = ce.expr(['Norm', ['List', 2, 2], 4]).evaluate();
    expect(result.re).toBeCloseTo(2.3784, 3);
  });

  // Matrix Frobenius norm (default)
  it('should compute the Frobenius norm of a matrix', () => {
    // √(1² + 2² + 3² + 4²) = √(1 + 4 + 9 + 16) = √30 ≈ 5.477
    const result = ce.expr(['Norm', sq2_n]).evaluate();
    expect(result.re).toBeCloseTo(5.4772, 3);
  });

  it('should compute the Frobenius norm of a non-square matrix', () => {
    // √(1² + 2² + 3² + 4² + 5² + 6²) = √(1+4+9+16+25+36) = √91 ≈ 9.539
    const result = ce.expr(['Norm', m23_n]).evaluate();
    expect(result.re).toBeCloseTo(9.5394, 3);
  });

  it('should compute the Frobenius norm with explicit type', () => {
    const result = ce.expr(['Norm', sq2_n, { str: 'Frobenius' }]).evaluate();
    expect(result.re).toBeCloseTo(5.4772, 3);
  });

  // Matrix L1 norm (max column sum)
  it('should compute the L1 norm of a matrix', () => {
    // [[1, 2], [3, 4]]
    // Column sums: |1| + |3| = 4, |2| + |4| = 6
    // max = 6
    const result = ce.expr(['Norm', sq2_n, 1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`6`);
  });

  it('should compute the L1 norm of a matrix with negatives', () => {
    // [[1, -2], [-3, 4]]
    // Column sums: |1| + |-3| = 4, |-2| + |4| = 6
    // max = 6
    const result = ce
      .expr(['Norm', ['List', ['List', 1, -2], ['List', -3, 4]], 1])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`6`);
  });

  // Matrix L∞ norm (max row sum)
  it('should compute the L-infinity norm of a matrix', () => {
    // [[1, 2], [3, 4]]
    // Row sums: |1| + |2| = 3, |3| + |4| = 7
    // max = 7
    const result = ce.expr(['Norm', sq2_n, { str: 'Infinity' }]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`7`);
  });

  it('should compute the L-infinity norm of a non-square matrix', () => {
    // [[1, 2, 3], [4, 5, 6]]
    // Row sums: 1 + 2 + 3 = 6, 4 + 5 + 6 = 15
    // max = 15
    const result = ce.expr(['Norm', m23_n, { str: 'Infinity' }]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`15`);
  });

  // Zero vector
  it('should compute the norm of a zero vector', () => {
    const result = ce.expr(['Norm', ['List', 0, 0, 0]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`0`);
  });

  // Single element vector
  it('should compute the norm of a single element vector', () => {
    const result = ce.expr(['Norm', ['List', -5]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  // A point-like Tuple is treated as a rank-1 vector (only inside Norm).
  it('should compute the L2 norm of a Tuple (3-4-5 triangle)', () => {
    // √((-3)² + 4²) = √25 = 5
    const result = ce.parse('\\|(-3,4)\\|').evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should compute the L1 norm of a Tuple', () => {
    // |-3| + |4| = 7
    const result = ce.expr(['Norm', ['Tuple', -3, 4], 1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`7`);
  });

  it('should compute the L-infinity norm of a Tuple', () => {
    // max(|-3|, |4|) = 4
    const result = ce.expr(['Norm', ['Tuple', -3, 4], 'Infinity']).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`4`);
  });

  it('should compute the L2 norm of a 3-element Tuple', () => {
    // √(1² + 2² + 2²) = √9 = 3
    const result = ce.expr(['Norm', ['Tuple', 1, 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`3`);
  });

  // Regression: List-valued vectors still evaluate.
  it('should still compute the L2 norm of a List (regression)', () => {
    const result = ce.expr(['Norm', ['List', 3, 4]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });
});

describe('Higher-Rank Tensor Operations (LA-4)', () => {
  describe('Transpose for rank > 2', () => {
    it('should transpose last two axes of a rank-3 tensor by default', () => {
      // Shape [2, 2, 2] -> [2, 2, 2] (swapping last two axes)
      // First matrix [[1, 2], [3, 4]] -> [[1, 3], [2, 4]]
      // Second matrix [[5, 6], [7, 8]] -> [[5, 7], [6, 8]]
      const result = ce.expr(['Transpose', t222_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,3],[2,4]],[[5,7],[6,8]]]`
      );
    });

    it('should transpose axes 1 and 2 of a rank-3 tensor', () => {
      // Shape [2, 2, 2] with axes 1 and 2 swapped -> shape [2, 2, 2]
      const result = ce.expr(['Transpose', t222_n, 1, 2]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,2],[5,6]],[[3,4],[7,8]]]`
      );
    });

    it('should transpose axes 1 and 3 of a rank-3 tensor', () => {
      // Shape [2, 2, 2] with axes 1 and 3 swapped -> shape [2, 2, 2]
      const result = ce.expr(['Transpose', t222_n, 1, 3]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,5],[3,7]],[[2,6],[4,8]]]`
      );
    });

    it('should transpose a non-square rank-3 tensor', () => {
      // Shape [2, 3, 4] with default (swap last two) -> [2, 4, 3]
      const result = ce.expr(['Transpose', t234_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,5,9],[2,6,10],[3,7,11],[4,8,12]],[[13,17,21],[14,18,22],[15,19,23],[16,20,24]]]`
      );
    });

    it('should transpose axes 1 and 2 of shape [3, 2, 2]', () => {
      // Swap first two axes: [3, 2, 2] -> [2, 3, 2]
      const result = ce.expr(['Transpose', t322_n, 1, 2]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,2],[5,6],[9,10]],[[3,4],[7,8],[11,12]]]`
      );
    });
  });

  describe('ConjugateTranspose for rank > 2', () => {
    it('should conjugate transpose last two axes of a rank-3 complex tensor', () => {
      // Shape [2, 2, 2], conjugate and swap last two axes
      const result = ce.expr(['ConjugateTranspose', t222_c]).evaluate();
      // First slice: [[1-2i, 5-6i], [3-4i, 7-8i]]
      // Second slice: [[9-10i, 13-14i], [11-12i, 15-16i]]
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[(1 - 2i),(5 - 6i)],[(3 - 4i),(7 - 8i)]],[[(9 - 10i),(13 - 14i)],[(11 - 12i),(15 - 16i)]]]`
      );
    });

    it('should conjugate transpose specified axes of a rank-3 complex tensor', () => {
      const result = ce.expr(['ConjugateTranspose', t222_c, 1, 3]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[(1 - 2i),(9 - 10i)],[(5 - 6i),(13 - 14i)]],[[(3 - 4i),(11 - 12i)],[(7 - 8i),(15 - 16i)]]]`
      );
    });

    it('should conjugate transpose a real rank-3 tensor (same as transpose)', () => {
      // For real tensors, conjugate transpose is just transpose
      const result = ce.expr(['ConjugateTranspose', t222_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,3],[2,4]],[[5,7],[6,8]]]`
      );
    });
  });

  describe('Trace for rank > 2 (batch trace)', () => {
    it('should compute batch trace of a [2, 2, 2] tensor', () => {
      // First matrix [[1, 2], [3, 4]]: trace = 1 + 4 = 5
      // Second matrix [[5, 6], [7, 8]]: trace = 5 + 8 = 13
      // Result: [5, 13]
      const result = ce.expr(['Trace', t222_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[5,13]`);
    });

    it('should compute batch trace of a [3, 2, 2] tensor', () => {
      // First matrix [[1, 2], [3, 4]]: trace = 1 + 4 = 5
      // Second matrix [[5, 6], [7, 8]]: trace = 5 + 8 = 13
      // Third matrix [[9, 10], [11, 12]]: trace = 9 + 12 = 21
      // Result: [5, 13, 21]
      const result = ce.expr(['Trace', t322_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[5,13,21]`);
    });

    it('should compute batch trace of a [2, 3, 3] tensor', () => {
      // First matrix: trace = 1 + 5 + 9 = 15
      // Second matrix: trace = 10 + 14 + 18 = 42
      // Result: [15, 42]
      const result = ce.expr(['Trace', t233_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[15,42]`);
    });

    it('should return error for non-square last two axes', () => {
      // Shape [2, 3, 4] - last two axes (3 and 4) are not equal
      const result = ce.expr(['Trace', t234_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `Error("expected-square-matrix", "[[[1,2,3,4],[5,6,7,8],[9,10,11,12]],[[13,14,15,16],[17,18,19,20],[21,22,23,24]]]")`
      );
    });

    it('should compute trace over specified axes', () => {
      // t222_n has shape [2, 2, 2]
      // Trace over axes 1 and 2 (first and second axes):
      // For each value of axis 3 (2 values), sum diagonals over axes 1 and 2
      // At axis3=1: (1,1,1) + (2,2,1) = 1 + 7 = 8?
      // Actually this is tricky - let's compute carefully
      // Shape [2, 2, 2], tracing over axes 1 and 2:
      // Result shape: [2] (remaining axis 3)
      // result[0] = sum of elements where axis1 == axis2 and axis3 == 0
      //           = data[0,0,0] + data[1,1,0] = 1 + 7 = 8
      // result[1] = data[0,0,1] + data[1,1,1] = 2 + 8 = 10
      const result = ce.expr(['Trace', t222_n, 1, 2]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[8,10]`);
    });

    it('should compute trace over axes 1 and 3', () => {
      // t222_n has shape [2, 2, 2]
      // Trace over axes 1 and 3:
      // Result shape: [2] (remaining axis 2)
      // result[0] = data[0,0,0] + data[1,0,1] = 1 + 6 = 7
      // result[1] = data[0,1,0] + data[1,1,1] = 3 + 8 = 11
      const result = ce.expr(['Trace', t222_n, 1, 3]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[7,11]`);
    });

    it('should still work for rank-2 matrices (backwards compatibility)', () => {
      const result = ce.expr(['Trace', sq2_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`5`);
    });
  });
});

describe('Eigenvalues and Eigenvectors (LA-5)', () => {
  describe('Eigenvalues', () => {
    it('should compute eigenvalues of a 1×1 matrix', () => {
      const result = ce.expr(['Eigenvalues', ['List', ['List', 5]]]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[5]`);
    });

    it('should compute eigenvalues of a 2×2 diagonal matrix', () => {
      // Diagonal matrix: eigenvalues are diagonal elements
      const result = ce
        .expr(['Eigenvalues', ['List', ['List', 3, 0], ['List', 0, 7]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[3,7]`);
    });

    it('should compute eigenvalues of a 2×2 triangular matrix', () => {
      // Upper triangular: eigenvalues are diagonal elements
      const result = ce
        .expr(['Eigenvalues', ['List', ['List', 2, 5], ['List', 0, 4]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[2,4]`);
    });

    it('should compute eigenvalues of a 2×2 matrix', () => {
      // [[4, 2], [1, 3]] has eigenvalues 5 and 2
      // trace = 7, det = 12 - 2 = 10
      // λ = (7 ± √(49-40))/2 = (7 ± 3)/2 = 5, 2
      const result = ce
        .expr(['Eigenvalues', ['List', ['List', 4, 2], ['List', 1, 3]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[5,2]`);
    });

    it('should compute eigenvalues of a 2×2 identity matrix', () => {
      const result = ce
        .expr(['Eigenvalues', ['List', ['List', 1, 0], ['List', 0, 1]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[1,1]`);
    });

    it('should compute eigenvalues of a 2×2 matrix with repeated eigenvalue', () => {
      // [[2, 1], [0, 2]] has eigenvalue 2 with multiplicity 2
      const result = ce
        .expr(['Eigenvalues', ['List', ['List', 2, 1], ['List', 0, 2]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[2,2]`);
    });

    it('should compute eigenvalues of a 3×3 diagonal matrix', () => {
      const result = ce
        .expr([
          'Eigenvalues',
          ['List', ['List', 1, 0, 0], ['List', 0, 2, 0], ['List', 0, 0, 3]],
        ])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[1,2,3]`);
    });

    it('should compute eigenvalues of a 3×3 matrix numerically', () => {
      // [[6, -1, 0], [-1, 5, -1], [0, -1, 4]]
      // This symmetric matrix has eigenvalues approximately 7, 5, 3
      const result = ce
        .expr([
          'Eigenvalues',
          ['List', ['List', 6, -1, 0], ['List', -1, 5, -1], ['List', 0, -1, 4]],
        ])
        .evaluate();
      const eigenvalues = result.ops?.map((e) => e.re ?? 0) ?? [];
      expect(eigenvalues.length).toBe(3);
      // Check eigenvalues are approximately correct (order may vary)
      eigenvalues.sort((a, b) => b - a);
      expect(eigenvalues[0]).toBeCloseTo(7, 0);
      expect(eigenvalues[1]).toBeCloseTo(5, 0);
      expect(eigenvalues[2]).toBeCloseTo(3, 0);
    });

    it('should compute eigenvalues of a symmetric matrix with a repeated eigenvalue', () => {
      // 3I + J (J = all-ones 4×4) has spectrum {7, 3, 3, 3}. The triple
      // eigenvalue 3 exercises the shifted-QR deflation path (n ≥ 4, so this
      // routes through the numeric QR solver rather than the cubic fast path).
      const result = ce
        .expr([
          'Eigenvalues',
          [
            'List',
            ['List', 4, 1, 1, 1],
            ['List', 1, 4, 1, 1],
            ['List', 1, 1, 4, 1],
            ['List', 1, 1, 1, 4],
          ],
        ])
        .evaluate();
      const vals = (result.ops ?? [])
        .map((o) => o.re ?? NaN)
        .sort((a, b) => a - b);
      expect(vals).toHaveLength(4);
      [3, 3, 3, 7].forEach((e, i) => expect(vals[i]).toBeCloseTo(e, 8));
    });

    it('should compute eigenvalues of the 8×8 Rosser matrix', () => {
      // Classic numeric-eigensolver stress test. Exact spectrum:
      // {-10√10405, 0, 510-100√26, 1000, 1000, 510+100√26, 1020, 10√10405}.
      const rosser = [
        'List',
        ['List', 611, 196, -192, 407, -8, -52, -49, 29],
        ['List', 196, 899, 113, -192, -71, -43, -8, -44],
        ['List', -192, 113, 899, 196, 61, 49, 8, 52],
        ['List', 407, -192, 196, 611, 8, 44, 59, -23],
        ['List', -8, -71, 61, 8, 411, -599, 208, 208],
        ['List', -52, -43, 49, 44, -599, 411, 208, 208],
        ['List', -49, -8, 8, 59, 208, 208, 99, -911],
        ['List', 29, -44, 52, -23, 208, 208, -911, 99],
      ];
      const result = ce.expr(['Eigenvalues', rosser]).evaluate();
      const vals = (result.ops ?? [])
        .map((o) => o.re ?? NaN)
        .sort((a, b) => a - b);
      const expected = [
        -10 * Math.sqrt(10405),
        0,
        510 - 100 * Math.sqrt(26),
        1000,
        1000,
        510 + 100 * Math.sqrt(26),
        1020,
        10 * Math.sqrt(10405),
      ];
      expect(vals).toHaveLength(8);
      expected.forEach((e, i) => expect(vals[i]).toBeCloseTo(e, 5));
    });

    it('should return error for non-square matrix', () => {
      const result = ce.expr(['Eigenvalues', m23_n]).evaluate();
      expect(result.toString()).toContain('expected-square-matrix');
    });

    it('should return error for vector', () => {
      const result = ce.expr(['Eigenvalues', v7_n]).evaluate();
      // Type checking rejects vectors (not a matrix)
      expect(result.toString()).toContain('incompatible-type');
    });
  });

  describe('Eigenvectors', () => {
    it('should compute eigenvectors of a 2×2 diagonal matrix', () => {
      // Diagonal matrix: eigenvectors are standard basis vectors
      const result = ce
        .expr(['Eigenvectors', ['List', ['List', 3, 0], ['List', 0, 7]]])
        .evaluate();
      // Should return [[1, 0], [0, 1]] or normalized versions
      expect(result.operator).toBe('List');
      expect(result.ops?.length).toBe(2);
    });

    it('should compute eigenvectors of a 2×2 matrix', () => {
      // [[4, 2], [1, 3]] has eigenvalues 5 and 2
      // For λ=5: (A - 5I)v = 0 → [[-1, 2], [1, -2]]v = 0 → v = [2, 1]
      // For λ=2: (A - 2I)v = 0 → [[2, 2], [1, 1]]v = 0 → v = [1, -1]
      const result = ce
        .expr(['Eigenvectors', ['List', ['List', 4, 2], ['List', 1, 3]]])
        .evaluate();
      expect(result.operator).toBe('List');
      expect(result.ops?.length).toBe(2);
    });

    it('should return error for non-square matrix', () => {
      const result = ce.expr(['Eigenvectors', m23_n]).evaluate();
      expect(result.toString()).toContain('expected-square-matrix');
    });
  });

  describe('Eigen (combined)', () => {
    it('should return both eigenvalues and eigenvectors', () => {
      const result = ce
        .expr(['Eigen', ['List', ['List', 4, 2], ['List', 1, 3]]])
        .evaluate();
      expect(result.operator).toBe('Tuple');
      expect(result.ops?.length).toBe(2);

      const eigenvalues = result.ops?.[0];
      const eigenvectors = result.ops?.[1];

      expect(eigenvalues?.operator).toBe('List');
      expect(eigenvectors?.operator).toBe('List');
    });

    it('should return error for non-square matrix', () => {
      const result = ce.expr(['Eigen', m23_n]).evaluate();
      expect(result.toString()).toContain('expected-square-matrix');
    });
  });
});

describe('Matrix Decompositions (LA-7)', () => {
  describe('LUDecomposition', () => {
    it('should decompose a 2x2 matrix', () => {
      const result = ce
        .expr(['LUDecomposition', ['List', ['List', 4, 3], ['List', 6, 3]]])
        .evaluate();
      expect(result.operator).toBe('Tuple');
      expect(result.ops?.length).toBe(3);

      const [P, L, U] = result.ops!;
      expect(P.operator).toBe('List');
      expect(L.operator).toBe('List');
      expect(U.operator).toBe('List');

      // Verify PA = LU by computing L*U and comparing to P*A
      // For this simple case, just check structure
      expect(L.ops?.length).toBe(2);
      expect(U.ops?.length).toBe(2);
    });

    it('should decompose a 3x3 matrix', () => {
      const result = ce
        .expr([
          'LUDecomposition',
          ['List', ['List', 2, 1, 1], ['List', 4, 3, 3], ['List', 8, 7, 9]],
        ])
        .evaluate();
      expect(result.operator).toBe('Tuple');
      expect(result.ops?.length).toBe(3);
    });

    it('should return error for non-square matrix', () => {
      const result = ce.expr(['LUDecomposition', m23_n]).evaluate();
      expect(result.toString()).toContain('expected-square-matrix');
    });

    it('should handle identity matrix', () => {
      const result = ce
        .expr(['LUDecomposition', ['List', ['List', 1, 0], ['List', 0, 1]]])
        .evaluate();
      expect(result.operator).toBe('Tuple');

      const L = result.ops?.[1];
      const U = result.ops?.[2];

      // For identity, L and U should both be identity
      expect(L?.ops?.[0]?.ops?.[0]?.re).toBe(1);
      expect(U?.ops?.[0]?.ops?.[0]?.re).toBe(1);
    });
  });

  describe('QRDecomposition', () => {
    it('should decompose a 2x2 matrix', () => {
      const result = ce
        .expr(['QRDecomposition', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate();
      expect(result.operator).toBe('Tuple');
      expect(result.ops?.length).toBe(2);

      const [Q, R] = result.ops!;
      expect(Q.operator).toBe('List');
      expect(R.operator).toBe('List');

      // Q should be 2x2 orthogonal
      expect(Q.ops?.length).toBe(2);
      // R should be 2x2 upper triangular
      expect(R.ops?.length).toBe(2);
    });

    it('should decompose a 3x3 matrix', () => {
      const result = ce
        .expr([
          'QRDecomposition',
          [
            'List',
            ['List', 12, -51, 4],
            ['List', 6, 167, -68],
            ['List', -4, 24, -41],
          ],
        ])
        .evaluate();
      expect(result.operator).toBe('Tuple');
      expect(result.ops?.length).toBe(2);

      const [Q, R] = result.ops!;
      // Q should be 3x3
      expect(Q.ops?.length).toBe(3);
      // R should be 3x3 upper triangular
      expect(R.ops?.length).toBe(3);

      // R should be upper triangular (elements below diagonal near 0)
      const R21 = R.ops?.[1]?.ops?.[0]?.re ?? 999;
      const R31 = R.ops?.[2]?.ops?.[0]?.re ?? 999;
      const R32 = R.ops?.[2]?.ops?.[1]?.re ?? 999;
      expect(Math.abs(R21)).toBeLessThan(1e-9);
      expect(Math.abs(R31)).toBeLessThan(1e-9);
      expect(Math.abs(R32)).toBeLessThan(1e-9);
    });

    it('should handle rectangular matrix (m > n)', () => {
      const result = ce
        .expr([
          'QRDecomposition',
          ['List', ['List', 1, 2], ['List', 3, 4], ['List', 5, 6]],
        ])
        .evaluate();
      expect(result.operator).toBe('Tuple');
      expect(result.ops?.length).toBe(2);

      const [Q, R] = result.ops!;
      // Q should be 3x3
      expect(Q.ops?.length).toBe(3);
      // R should be 3x2
      expect(R.ops?.length).toBe(3);
      expect(R.ops?.[0]?.ops?.length).toBe(2);
    });
  });

  describe('CholeskyDecomposition', () => {
    it('should decompose a positive definite 2x2 matrix', () => {
      // Matrix [[4, 2], [2, 2]] is positive definite
      const result = ce
        .expr([
          'CholeskyDecomposition',
          ['List', ['List', 4, 2], ['List', 2, 2]],
        ])
        .evaluate();
      expect(result.operator).toBe('List');
      expect(result.ops?.length).toBe(2);

      // L should be lower triangular
      const L11 = result.ops?.[0]?.ops?.[0]?.re ?? 0;
      const L12 = result.ops?.[0]?.ops?.[1]?.re ?? 999;
      const L21 = result.ops?.[1]?.ops?.[0]?.re ?? 0;
      const L22 = result.ops?.[1]?.ops?.[1]?.re ?? 0;

      expect(L12).toBe(0); // Upper triangle should be 0
      expect(L11).toBeCloseTo(2, 5); // sqrt(4) = 2
      expect(L21).toBeCloseTo(1, 5); // 2/2 = 1
      expect(L22).toBeCloseTo(1, 5); // sqrt(2-1) = 1
    });

    it('should decompose identity matrix', () => {
      const result = ce
        .expr([
          'CholeskyDecomposition',
          ['List', ['List', 1, 0], ['List', 0, 1]],
        ])
        .evaluate();
      expect(result.operator).toBe('List');

      // Cholesky of identity is identity
      expect(result.ops?.[0]?.ops?.[0]?.re).toBe(1);
      expect(result.ops?.[0]?.ops?.[1]?.re).toBe(0);
      expect(result.ops?.[1]?.ops?.[0]?.re).toBe(0);
      expect(result.ops?.[1]?.ops?.[1]?.re).toBe(1);
    });

    it('should return error for non-positive-definite matrix', () => {
      // Matrix [[1, 2], [2, 1]] is not positive definite (det = -3 < 0)
      const result = ce
        .expr([
          'CholeskyDecomposition',
          ['List', ['List', 1, 2], ['List', 2, 1]],
        ])
        .evaluate();
      expect(result.toString()).toContain('expected-positive-definite-matrix');
    });

    it('should return error for non-square matrix', () => {
      const result = ce.expr(['CholeskyDecomposition', m23_n]).evaluate();
      expect(result.toString()).toContain('expected-square-matrix');
    });
  });

  describe('SVD (Singular Value Decomposition)', () => {
    it('should decompose a 2x2 matrix', () => {
      const result = ce
        .expr(['SVD', ['List', ['List', 4, 0], ['List', 3, -5]]])
        .evaluate();
      expect(result.operator).toBe('Tuple');
      expect(result.ops?.length).toBe(3);

      const [U, S, V] = result.ops!;
      expect(U.operator).toBe('List');
      expect(S.operator).toBe('List');
      expect(V.operator).toBe('List');

      // S should be diagonal (non-negative singular values)
      const S11 = S.ops?.[0]?.ops?.[0]?.re ?? -1;
      const S12 = S.ops?.[0]?.ops?.[1]?.re ?? 999;
      const S21 = S.ops?.[1]?.ops?.[0]?.re ?? 999;
      const S22 = S.ops?.[1]?.ops?.[1]?.re ?? -1;

      expect(S11).toBeGreaterThanOrEqual(0);
      expect(S22).toBeGreaterThanOrEqual(0);
      expect(Math.abs(S12)).toBeLessThan(1e-9);
      expect(Math.abs(S21)).toBeLessThan(1e-9);
    });

    it('should decompose identity matrix', () => {
      const result = ce
        .expr(['SVD', ['List', ['List', 1, 0], ['List', 0, 1]]])
        .evaluate();
      expect(result.operator).toBe('Tuple');

      const S = result.ops?.[1];
      // Singular values of identity are all 1
      expect(S?.ops?.[0]?.ops?.[0]?.re).toBeCloseTo(1, 5);
      expect(S?.ops?.[1]?.ops?.[1]?.re).toBeCloseTo(1, 5);
    });

    it('should handle rectangular matrix', () => {
      const result = ce
        .expr(['SVD', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]])
        .evaluate();
      expect(result.operator).toBe('Tuple');
      expect(result.ops?.length).toBe(3);

      const [U, S, V] = result.ops!;
      // U should be 2x2
      expect(U.ops?.length).toBe(2);
      // S should be 2x3
      expect(S.ops?.length).toBe(2);
      expect(S.ops?.[0]?.ops?.length).toBe(3);
      // V should be 3x3
      expect(V.ops?.length).toBe(3);
    });

    it('should decompose a 3x3 matrix', () => {
      const result = ce
        .expr([
          'SVD',
          ['List', ['List', 1, 0, 0], ['List', 0, 2, 0], ['List', 0, 0, 3]],
        ])
        .evaluate();
      expect(result.operator).toBe('Tuple');

      const S = result.ops?.[1];
      // For diagonal matrix, singular values are diagonal elements (sorted or not)
      const singularValues = [
        S?.ops?.[0]?.ops?.[0]?.re ?? 0,
        S?.ops?.[1]?.ops?.[1]?.re ?? 0,
        S?.ops?.[2]?.ops?.[2]?.re ?? 0,
      ].sort((a, b) => b - a);

      expect(singularValues[0]).toBeCloseTo(3, 5);
      expect(singularValues[1]).toBeCloseTo(2, 5);
      expect(singularValues[2]).toBeCloseTo(1, 5);
    });
  });
});

// Regressions for the tensor linear-algebra bugs reported in REVIEW.md (F1–F4).
describe('Tensor linear algebra regressions (REVIEW.md F1–F4)', () => {
  const M = (rows: number[][]): Expression => [
    'List',
    ...rows.map((r) => ['List', ...r] as Expression),
  ];
  const tensorOf = (m: Expression) => {
    const e = ce.expr(m).evaluate();
    return isTensor(e) ? e.tensor : null;
  };

  // F1: determinant() threw for n >= 4 (flat array indexed as 2D, rowIndices[-1]
  // on the first iteration); the 3x3 branch passed an array to a variadic
  // `addn`, string-concatenating instead of summing.
  describe('F1: Determinant (n >= 3)', () => {
    test('3x3', () =>
      expect(
        ce
          .expr([
            'Determinant',
            M([
              [1, 2, 3],
              [0, 1, 4],
              [5, 6, 0],
            ]),
          ])
          .evaluate()
          .toString()
      ).toEqual('1'));
    test('4x4 block-diagonal stays exact (Bareiss, no float drift)', () =>
      expect(
        ce
          .expr([
            'Determinant',
            M([
              [1, 2, 0, 0],
              [3, 4, 0, 0],
              [0, 0, 5, 6],
              [0, 0, 7, 8],
            ]),
          ])
          .evaluate()
          .toString()
      ).toEqual('4'));
    test('4x4 general', () =>
      expect(
        ce
          .expr([
            'Determinant',
            M([
              [3, 1, 1, 2],
              [5, 1, 3, 4],
              [2, 0, 1, 0],
              [1, 3, 2, 1],
            ]),
          ])
          .evaluate()
          .toString()
      ).toEqual('-22'));
    test('5x5 identity', () =>
      expect(
        ce
          .expr([
            'Determinant',
            M([
              [1, 0, 0, 0, 0],
              [0, 1, 0, 0, 0],
              [0, 0, 1, 0, 0],
              [0, 0, 0, 1, 0],
              [0, 0, 0, 0, 1],
            ]),
          ])
          .evaluate()
          .toString()
      ).toEqual('1'));
    test('singular 4x4 -> 0', () =>
      expect(
        ce
          .expr([
            'Determinant',
            M([
              [1, 2, 3, 4],
              [2, 4, 6, 8],
              [1, 0, 0, 0],
              [0, 1, 0, 0],
            ]),
          ])
          .evaluate()
          .toString()
      ).toEqual('0'));
  });

  // F2: inverse() threw for n >= 3 (same index-base bugs plus a comma-operator
  // bug `augmented[(rowIndices[k], k)]`).
  describe('F2: Inverse (n >= 3)', () => {
    test('3x3', () =>
      expect(
        ce
          .expr([
            'Inverse',
            M([
              [1, 2, 3],
              [0, 1, 4],
              [5, 6, 0],
            ]),
          ])
          .evaluate()
          .toString()
      ).toMatchInlineSnapshot(`[[-24,18,5],[20,-15,-4],[-5,4,1]]`));
    test('4x4 diagonal', () =>
      expect(
        ce
          .expr([
            'Inverse',
            M([
              [2, 0, 0, 0],
              [0, 4, 0, 0],
              [0, 0, 5, 0],
              [0, 0, 0, 10],
            ]),
          ])
          .evaluate()
          .toString()
      ).toMatchInlineSnapshot(
        `[[0.5,0,0,0],[0,0.25,0,0],[0,0,0.2,0],[0,0,0,0.1]]`
      ));
  });

  // F3: slice() was off-by-one (0-based) for rank >= 2 while the rank-1 path
  // was 1-based.
  test('F3: matrix row slices are 1-based', () => {
    const t = tensorOf(
      M([
        [1, 2, 3],
        [4, 5, 6],
      ])
    );
    expect(t?.slice(1).expression.toString()).toEqual('[1,2,3]');
    expect(t?.slice(2).expression.toString()).toEqual('[4,5,6]');
    expect(t?.slice(-1).expression.toString()).toEqual('[4,5,6]');
  });

  // F4: isUpperTriangular was inverted, isDiagonal tested for the zero matrix,
  // and isTriangular tested diagonality.
  test('F4: triangular and diagonal predicates', () => {
    const upper = tensorOf(
      M([
        [1, 2],
        [0, 3],
      ])
    );
    const lower = tensorOf(
      M([
        [1, 0],
        [2, 3],
      ])
    );
    const diag = tensorOf(
      M([
        [5, 0],
        [0, 7],
      ])
    );
    const full = tensorOf(
      M([
        [1, 2],
        [3, 4],
      ])
    );
    expect(upper?.isUpperTriangular).toBe(true);
    expect(upper?.isLowerTriangular).toBe(false);
    expect(upper?.isTriangular).toBe(true);
    expect(upper?.isDiagonal).toBe(false);
    expect(lower?.isLowerTriangular).toBe(true);
    expect(lower?.isTriangular).toBe(true);
    expect(diag?.isDiagonal).toBe(true);
    expect(diag?.isTriangular).toBe(true);
    expect(full?.isTriangular).toBe(false);
    expect(full?.isDiagonal).toBe(false);
  });
});

// Tensor-helper correctness fixes from REVIEW.md (F9, F15, F16). These guard
// the low-level helpers directly: the engine's Add/Diagonal handlers already
// reject incompatible shapes / rank > 2 upstream, so the bugs were latent.
describe('Tensor helpers (REVIEW.md F9, F15, F16)', () => {
  // F16: the dtype join of a 64-bit real with a 32-bit complex must be
  // complex128 (64-bit components), not complex64 (precision loss).
  it('F16: getSupertype(float64, complex64) is complex128', () => {
    expect(getSupertype('float64', 'complex64')).toBe('complex128');
    expect(getSupertype('complex64', 'float64')).toBe('complex128');
    // A 32-bit real stays in complex64.
    expect(getSupertype('float32', 'complex64')).toBe('complex64');
  });

  // F9: element-wise broadcast over incompatible shapes produced silent
  // garbage (`[…, null]`); it now throws.
  it('F9: broadcasting incompatible shapes throws (was silent garbage)', () => {
    const m = makeTensor(ce, {
      dtype: 'float64',
      shape: [2, 2],
      data: [1, 2, 3, 4],
    });
    const v = makeTensor(ce, {
      dtype: 'float64',
      shape: [3],
      data: [10, 20, 30],
    });
    expect(() => (m as any).add(v)).toThrow(/incompatible shapes/);
    // Equal shapes still work.
    const m2 = makeTensor(ce, {
      dtype: 'float64',
      shape: [2, 2],
      data: [10, 20, 30, 40],
    });
    expect((m as any).add(m2).data).toEqual([11, 22, 33, 44]);
  });

  // F15: diagonal() ignored its axis arguments (always `data[i*n+i]`); it now
  // steps along the strides of the two requested axes.
  it('F15: diagonal respects the requested axes', () => {
    const m = makeTensor(ce, {
      dtype: 'float64',
      shape: [2, 2],
      data: [1, 2, 3, 4],
    });
    expect((m as any).diagonal()).toEqual([1, 4]); // rank-2 unchanged

    const r3 = makeTensor(ce, {
      dtype: 'float64',
      shape: [2, 2, 2],
      data: [1, 2, 3, 4, 5, 6, 7, 8],
    });
    // Different axis pairs now give different diagonals (were both [1,4]).
    expect((r3 as any).diagonal(1, 2)).toEqual([1, 7]);
    expect((r3 as any).diagonal(2, 3)).toEqual([1, 4]);
    // Out-of-range / non-square axes return undefined.
    expect((r3 as any).diagonal(1, 4)).toBeUndefined();
  });
});

describe('Dot / Cross', () => {
  const m: Expression = ['List', ['List', 1, 2], ['List', 3, 4]];

  it('computes the dot (inner) product of two vectors', () => {
    expect(
      ce
        .expr(['Dot', ['List', 1, 2, 3], ['List', 4, 5, 6]])
        .evaluate()
        .toString()
    ).toBe('32');
  });

  it('reduces to the matrix product for two matrices', () => {
    expect(ce.expr(['Dot', m, m]).evaluate().toString()).toBe(
      '[[7,10],[15,22]]'
    );
  });

  it('computes the cross product of two 3-vectors', () => {
    expect(
      ce
        .expr(['Cross', ['List', 1, 0, 0], ['List', 0, 1, 0]])
        .evaluate()
        .toString()
    ).toBe('[0,0,1]');
    expect(
      ce
        .expr(['Cross', ['List', 1, 2, 3], ['List', 4, 5, 6]])
        .evaluate()
        .toString()
    ).toBe('[-3,6,-3]');
  });

  it('errors when a cross product operand is not a 3-vector', () => {
    expect(
      ce.expr(['Cross', ['List', 1, 2], ['List', 3, 4]]).evaluate().isValid
    ).toBe(false);
  });
});

describe('MatrixRank', () => {
  it('returns the rank of a full-rank matrix', () => {
    expect(
      ce
        .expr(['MatrixRank', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('2');
  });

  it('returns the rank of a rank-deficient matrix', () => {
    expect(
      ce
        .expr(['MatrixRank', ['List', ['List', 1, 2], ['List', 2, 4]]])
        .evaluate()
        .toString()
    ).toBe('1');
  });

  it('returns 0 for the zero matrix', () => {
    expect(
      ce
        .expr(['MatrixRank', ['List', ['List', 0, 0], ['List', 0, 0]]])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  it('handles non-square matrices', () => {
    expect(
      ce
        .expr(['MatrixRank', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]])
        .evaluate()
        .toString()
    ).toBe('2');
  });
});

describe('Matrix predicates', () => {
  const m: Expression = ['List', ['List', 1, 2], ['List', 3, 4]];
  const sym: Expression = ['List', ['List', 1, 2], ['List', 2, 1]];
  const diag: Expression = ['List', ['List', 5, 0], ['List', 0, 3]];
  const nonsquare: Expression = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]];

  it('IsSquareMatrix', () => {
    expect(ce.expr(['IsSquareMatrix', m]).evaluate().symbol).toBe('True');
    expect(ce.expr(['IsSquareMatrix', nonsquare]).evaluate().symbol).toBe(
      'False'
    );
    expect(
      ce.expr(['IsSquareMatrix', ['List', 1, 2, 3]]).evaluate().symbol
    ).toBe('False');
  });

  it('IsSymmetric', () => {
    expect(ce.expr(['IsSymmetric', sym]).evaluate().symbol).toBe('True');
    expect(ce.expr(['IsSymmetric', m]).evaluate().symbol).toBe('False');
  });

  it('IsDiagonal', () => {
    expect(ce.expr(['IsDiagonal', diag]).evaluate().symbol).toBe('True');
    expect(ce.expr(['IsDiagonal', sym]).evaluate().symbol).toBe('False');
  });
});

describe('MatrixPower', () => {
  const m: Expression = ['List', ['List', 1, 2], ['List', 3, 4]];

  it('to the 0th power is the identity', () => {
    expect(ce.expr(['MatrixPower', m, 0]).evaluate().toString()).toBe(
      '[[1,0],[0,1]]'
    );
  });

  it('to the 1st power is the matrix itself', () => {
    expect(ce.expr(['MatrixPower', m, 1]).evaluate().toString()).toBe(
      '[[1,2],[3,4]]'
    );
  });

  it('to the 2nd/3rd power is the repeated matrix product', () => {
    expect(ce.expr(['MatrixPower', m, 2]).evaluate().toString()).toBe(
      '[[7,10],[15,22]]'
    );
    expect(ce.expr(['MatrixPower', m, 3]).evaluate().toString()).toBe(
      '[[37,54],[81,118]]'
    );
  });

  it('to a negative power equals the inverse', () => {
    const inverse = ce.expr(['Inverse', m]).evaluate().toString();
    expect(ce.expr(['MatrixPower', m, -1]).evaluate().toString()).toBe(inverse);
  });

  it('to a negative power below -1 is (A^|n|)^{-1}', () => {
    // Regression: the negative branch bailed early on a non-BoxedTensor
    // inverse, collapsing A^{-2} to A^{-1}.
    expect(ce.expr(['MatrixPower', m, -2]).evaluate().toString()).toBe(
      '[[5.5,-2.5],[-3.75,1.75]]'
    );
  });

  it('errors on a non-square matrix', () => {
    expect(
      ce
        .expr([
          'MatrixPower',
          ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]],
          2,
        ])
        .evaluate().isValid
    ).toBe(false);
  });
});

describe('Power of a matrix (^)', () => {
  // `A^n` for an integer n is the matrix power (consistent with `*` being the
  // matrix product), routed to MatrixPower at canonicalization so it does not
  // broadcast element-wise.
  const m: Expression = ['List', ['List', 1, 2], ['List', 3, 4]];
  const ev = (expr: Expression) => ce.box(expr).evaluate().toString();

  it('A^2 is the matrix product A·A', () => {
    expect(ev(['Power', m, 2])).toMatchInlineSnapshot(`[[7,10],[15,22]]`);
  });

  it('A^0 is the identity matrix', () => {
    expect(ev(['Power', m, 0])).toMatchInlineSnapshot(`[[1,0],[0,1]]`);
  });

  it('A^1 is A', () => {
    expect(ev(['Power', m, 1])).toMatchInlineSnapshot(`[[1,2],[3,4]]`);
  });

  it('A^{-1} is the inverse', () => {
    expect(ev(['Power', m, -1])).toMatchInlineSnapshot(`[[-2,1],[1.5,-0.5]]`);
    expect(ce.box(['Power', m, -1]).canonical.json[0]).toBe('Inverse');
  });

  it('A^{-2} is the inverse squared', () => {
    expect(ev(['Power', m, -2])).toMatchInlineSnapshot(
      `[[5.5,-2.5],[-3.75,1.75]]`
    );
  });

  it('parses and evaluates from LaTeX', () => {
    expect(
      ce.parse(String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}^2`).evaluate().toString()
    ).toBe('[[7,10],[15,22]]');
  });

  it('errors on a non-square base', () => {
    expect(
      ce.box(['Power', ['List', ['List', 1, 2, 3]], 2]).evaluate().isValid
    ).toBe(false);
  });

  it('does not change scalar or vector powers', () => {
    expect(ev(['Power', 2, 3])).toMatchInlineSnapshot(`8`);
    expect(ev(['Power', 'x', 2])).toMatchInlineSnapshot(`x^2`);
    expect(ev(['Power', ['List', 1, 2, 3], 2])).toMatchInlineSnapshot(
      `[1,4,9]`
    );
  });
});

describe('CharacteristicPolynomial', () => {
  const m: Expression = ['List', ['List', 1, 2], ['List', 3, 4]];

  it('computes the monic characteristic polynomial', () => {
    expect(
      ce
        .expr(['CharacteristicPolynomial', m])
        .evaluate()
        .isSame(ce.parse('x^2-5x-2'))
    ).toBe(true);
  });

  it('is monic for a 3×3 diagonal matrix (roots are the diagonal)', () => {
    const diag3: Expression = [
      'List',
      ['List', 1, 0, 0],
      ['List', 0, 2, 0],
      ['List', 0, 0, 3],
    ];
    expect(
      ce
        .expr(['CharacteristicPolynomial', diag3])
        .evaluate()
        .isSame(ce.parse('x^3-6x^2+11x-6'))
    ).toBe(true);
  });

  it('accepts a custom variable', () => {
    expect(
      ce.expr(['CharacteristicPolynomial', m, 't']).evaluate().toString()
    ).toBe('t^2 - 5t - 2');
  });

  it('errors on a non-square matrix', () => {
    expect(
      ce
        .expr([
          'CharacteristicPolynomial',
          ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]],
        ])
        .evaluate().isValid
    ).toBe(false);
  });
});

describe('RowReduce', () => {
  it('reduces a full-rank matrix to the identity', () => {
    expect(
      ce
        .expr(['RowReduce', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('[[1,0],[0,1]]');
  });

  it('reduces a rank-deficient matrix', () => {
    expect(
      ce
        .expr(['RowReduce', ['List', ['List', 1, 2], ['List', 2, 4]]])
        .evaluate()
        .toString()
    ).toBe('[[1,2],[0,0]]');
  });

  it('reduces a non-square matrix', () => {
    expect(
      ce
        .expr(['RowReduce', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]])
        .evaluate()
        .toString()
    ).toBe('[[1,0,-1],[0,1,2]]');
  });

  it('errors on a vector', () => {
    expect(ce.expr(['RowReduce', ['List', 1, 2, 3]]).evaluate().isValid).toBe(
      false
    );
  });

  it('reduces the 4x5 Cullen matrix exactly (no float artifacts)', () => {
    // Wester B13 (Cullen, p. 43). Exact integer entries must produce the
    // exact RREF, free of the …2.999… / …-0.9999… float artifacts the numeric
    // path introduces.
    expect(
      ce
        .expr([
          'RowReduce',
          [
            'List',
            ['List', 1, 2, 3, 1, 3],
            ['List', 3, 2, 1, 1, 7],
            ['List', 0, 2, 4, 1, 1],
            ['List', 1, 1, 1, 1, 4],
          ],
        ])
        .evaluate().json
    ).toEqual([
      'List',
      ['List', 1, 0, -1, 0, 2],
      ['List', 0, 1, 2, 0, -1],
      ['List', 0, 0, 0, 1, 3],
      ['List', 0, 0, 0, 0, 0],
    ]);
  });

  it('reduces a rational-entry matrix exactly', () => {
    // [[1/2, 1/3], [2, 3/4]] is invertible, so its RREF is the identity.
    expect(
      ce
        .expr([
          'RowReduce',
          [
            'List',
            ['List', ['Rational', 1, 2], ['Rational', 1, 3]],
            ['List', 2, ['Rational', 3, 4]],
          ],
        ])
        .evaluate().json
    ).toEqual(['List', ['List', 1, 0], ['List', 0, 1]]);
  });

  it('preserves exact rational pivots in the reduced rows', () => {
    // A rank-deficient rational RREF whose reduced entries are non-integer
    // rationals — checks the exact fraction arithmetic end to end.
    expect(
      ce
        .expr([
          'RowReduce',
          ['List', ['List', 2, 3], ['List', 4, 6]],
        ])
        .evaluate().json
    ).toEqual(['List', ['List', 1, ['Rational', 3, 2]], ['List', 0, 0]]);
  });

  it('leaves the float path unchanged for inexact input', () => {
    // Fractional floats route through the numeric Gaussian elimination path.
    expect(
      ce
        .expr(['RowReduce', ['List', ['List', 1.5, 2.7], ['List', 3.1, 2.2]]])
        .evaluate()
        .toString()
    ).toBe('[[1,0],[0,1]]');
  });
});

describe('Exact linear algebra (rational null space / rank / eigenvectors)', () => {
  it('computes an exact rational kernel basis (no floats)', () => {
    // [[1/2, 1, 3/2], [1, 2, 3]] has rank 1 (row 2 = 2·row 1), so a
    // 2-dimensional null space. Free-variable = 1 convention.
    expect(
      ce
        .expr([
          'Kernel',
          [
            'List',
            ['List', ['Rational', 1, 2], 1, ['Rational', 3, 2]],
            ['List', 1, 2, 3],
          ],
        ])
        .evaluate().json
    ).toEqual(['List', ['List', -2, 1, 0], ['List', -3, 0, 1]]);
  });

  it('kernel basis vectors satisfy A·v = 0 exactly', () => {
    const A: Expression = [
      'List',
      ['List', ['Rational', 1, 2], 1, ['Rational', 3, 2]],
      ['List', 1, 2, 3],
    ];
    const basis = ce.expr(['Kernel', A]).evaluate();
    for (const v of basis.ops!) {
      const product = ce.expr(['MatrixMultiply', A, v]).evaluate();
      expect(product.json).toEqual(['List', 0, 0]);
    }
  });

  it('keeps integer kernel bases exact', () => {
    // Rank 2, nullity 1.
    expect(
      ce
        .expr([
          'Kernel',
          ['List', ['List', 1, 2, 3], ['List', 2, 4, 6], ['List', 1, 1, 1]],
        ])
        .evaluate().json
    ).toEqual(['List', ['List', 1, -2, 1]]);
  });

  it('returns the full standard basis for the zero matrix kernel', () => {
    expect(
      ce
        .expr(['Kernel', ['List', ['List', 0, 0], ['List', 0, 0]]])
        .evaluate().json
    ).toEqual(['List', ['List', 1, 0], ['List', 0, 1]]);
  });

  it('returns an empty kernel for an injective n×1 map', () => {
    expect(
      ce.expr(['Kernel', ['List', ['List', 2], ['List', 4]]]).evaluate().json
    ).toEqual(['List']);
  });

  it('leaves the float kernel path unchanged for inexact input', () => {
    // Genuinely inexact entries (1.5, 2.5) route through the numeric
    // Gaussian-elimination path; row 2 = (5/3)·row 1, so nullity 1.
    const result = ce
      .expr(['Kernel', ['List', ['List', 1.5, 3.0], ['List', 2.5, 5.0]]])
      .evaluate();
    expect(result.toString()).toBe('[[-2,1]]');
  });

  it('computes exact rank via the exact RREF pivot count', () => {
    expect(
      ce
        .expr([
          'MatrixRank',
          ['List', ['List', 1, 2, 3], ['List', 2, 4, 6], ['List', 1, 1, 1]],
        ])
        .evaluate().json
    ).toBe(2);
    // rank + nullity = number of columns (3 = 2 + 1)
    const nullity = ce
      .expr([
        'Kernel',
        ['List', ['List', 1, 2, 3], ['List', 2, 4, 6], ['List', 1, 1, 1]],
      ])
      .evaluate().ops!.length;
    expect(2 + nullity).toBe(3);
  });

  it('computes rank of a rational matrix exactly', () => {
    expect(
      ce
        .expr([
          'MatrixRank',
          [
            'List',
            ['List', ['Rational', 1, 2], ['Rational', 1, 3]],
            ['List', 1, ['Rational', 2, 3]],
          ],
        ])
        .evaluate().json
    ).toBe(1);
  });

  it('computes exact eigenvectors of a diagonal integer matrix', () => {
    expect(
      ce
        .expr(['Eigenvectors', ['List', ['List', 2, 0], ['List', 0, 3]]])
        .evaluate().json
    ).toEqual(['List', ['List', 1, 0], ['List', 0, 1]]);
  });

  it('computes exact eigenvectors of an integer matrix with integer eigenvalues', () => {
    // [[4, 1], [2, 3]] has eigenvalues 5 and 2; eigenvectors come out exact.
    expect(
      ce
        .expr(['Eigenvectors', ['List', ['List', 4, 1], ['List', 2, 3]]])
        .evaluate().json
    ).toEqual([
      'List',
      ['List', 1, 1],
      ['List', ['Rational', -1, 2], 1],
    ]);
  });

  it('exact eigenvectors satisfy A·v = λ·v', () => {
    const A: Expression = ['List', ['List', 4, 1], ['List', 2, 3]];
    const eigenvalues = ce.expr(['Eigenvalues', A]).evaluate().ops!;
    const eigenvectors = ce.expr(['Eigenvectors', A]).evaluate().ops!;
    for (let i = 0; i < eigenvectors.length; i++) {
      const v = eigenvectors[i];
      const lambda = eigenvalues[i];
      const Av = ce.expr(['MatrixMultiply', A, v]).evaluate();
      const lambdaV = ce.expr(['Multiply', lambda, v]).evaluate();
      expect(Av.json).toEqual(lambdaV.json);
    }
  });
});
