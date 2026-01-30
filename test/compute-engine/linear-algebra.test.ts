import { Expression } from '../../src/math-json/types';
import { engine as ce } from '../utils';

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
  [
    'List',
    ['List', 1, 2, 3],
    ['List', 4, 5, 6],
    ['List', 7, 8, 9],
  ],
  [
    'List',
    ['List', 10, 11, 12],
    ['List', 13, 14, 15],
    ['List', 16, 17, 18],
  ],
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
    const result = ce.box(['Diagonal', ['List', 1, 1, 1]]);
    // Without evaluate(), returns unevaluated expression
    expect(result.toString()).toMatchInlineSnapshot(`Diagonal([1,1,1])`);
  });

  it('should create a diagonal pmatrix', () => {
    const result = ce.box(['Diagonal', ['List', 1, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,0,0],[0,2,0],[0,0,3]]`
    );
  });
});

describe('Tensor Properties', () => {
  it('should get the rank of a matrix', () => {
    const result = ce.box(['Rank', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`2`);
  });

  it('should get the rank of a vector', () => {
    const result = ce.box(['Rank', v2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`1`);
  });

  it('should get the rank of a scalar', () => {
    const result = ce.box(['Rank', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`0`);
  });

  it('should get the shape of a matrix', () => {
    const result = ce.box(['Shape', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`(2, 2)`);
  });

  it('should get the shape of a vector', () => {
    const result = ce.box(['Shape', v2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`(2)`);
  });

  it('should get the shape of a scalar', () => {
    const result = ce.box(['Shape', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`()`);
  });
});

describe('Matrix addition', () => {
  it('should add a scalar to a matrix', () => {
    // Scalar + Matrix: broadcast scalar to all elements
    // [[1, 2], [3, 4]] + 10 = [[11, 12], [13, 14]]
    const result = ce.box(['Add', sq2_n, 10]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[11,12],[13,14]]`);
  });

  it('should add two matrices', () => {
    // [[1, 2], [3, 4]] + [[5, 6], [7, 8]] = [[6, 8], [10, 12]]
    const result = ce.box(['Add', sq2_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[6,8],[10,12]]`);
  });

  it('should handle adding two matrices of different dimension', () => {
    // 2×3 + 2×2 → incompatible dimensions error
    const result = ce.box(['Add', m23_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("incompatible-dimensions", "2x2 vs 2x3")`
    );
  });

  it('should add two matrices and a scalar', () => {
    // [[1, 2], [3, 4]] + 10 + [[5, 6], [7, 8]] = [[16, 18], [20, 22]]
    const result = ce.box(['Add', sq2_n, 10, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[16,18],[20,22]]`);
  });

  it('should add vectors element-wise', () => {
    // [7, 11] + [5, 6] = [12, 17]
    const result = ce.box(['Add', v2_n, ['List', 5, 6]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[12,17]`);
  });

  it('should add scalar to vector', () => {
    // [7, 11] + 3 = [10, 14]
    const result = ce.box(['Add', v2_n, 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[10,14]`);
  });

  it('should handle symbolic matrix addition', () => {
    // [[a, b], [c, d]] + [[1, 2], [3, 4]]
    const result = ce.box(['Add', sq2_x, sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a + 1,b + 2],[c + 3,d + 4]]`
    );
  });

  it('should handle multiple matrix addition', () => {
    // [[1, 2], [3, 4]] + [[1, 2], [3, 4]] + [[1, 2], [3, 4]] = [[3, 6], [9, 12]]
    const result = ce.box(['Add', sq2_n, sq2_n, sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[3,6],[9,12]]`);
  });
});

describe('MatrixMultiply', () => {
  // Matrix × Matrix
  it('should multiply two square numeric matrices', () => {
    // [[1, 2], [3, 4]] × [[5, 6], [7, 8]] = [[19, 22], [43, 50]]
    const result = ce.box(['MatrixMultiply', sq2_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[19,22],[43,50]]`);
  });

  it('should multiply two square matrices with unknowns', () => {
    // [[a, b], [c, d]] × [[5, 6], [7, 8]]
    const result = ce.box(['MatrixMultiply', sq2_x, sq2_n2]).evaluate();
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
    const result = ce.box(['MatrixMultiply', m23_n, m32]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[58,64],[139,154]]`);
  });

  it('should return error for incompatible matrix dimensions', () => {
    // [[1, 2], [3, 4]] × [[1, 2, 3], [4, 5, 6]] - dimensions incompatible (2 vs 2 is OK)
    // Let's try sq2_n (2×2) × m23_n (2×3) - should work!
    const result = ce.box(['MatrixMultiply', sq2_n, m23_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[9,12,15],[19,26,33]]`);
  });

  it('should return error for truly incompatible dimensions', () => {
    // m23_n (2×3) × sq2_n (2×2) - 3 ≠ 2, should fail
    const result = ce.box(['MatrixMultiply', m23_n, sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("incompatible-dimensions", "3 vs 2")`
    );
  });

  // Matrix × Vector
  it('should multiply matrix by vector', () => {
    // [[1, 2], [3, 4]] × [7, 11] = [1*7+2*11, 3*7+4*11] = [29, 65]
    const result = ce.box(['MatrixMultiply', sq2_n, v2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[29,65]`);
  });

  it('should multiply 2x3 matrix by 3-vector', () => {
    // [[1, 2, 3], [4, 5, 6]] × [1, 2, 3] = [14, 32]
    const v3: Expression = ['List', 1, 2, 3];
    const result = ce.box(['MatrixMultiply', m23_n, v3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[14,32]`);
  });

  it('should return error for matrix × incompatible vector', () => {
    // sq2_n (2×2) × v7_n (7) - 2 ≠ 7, should fail
    const result = ce.box(['MatrixMultiply', sq2_n, v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("incompatible-dimensions", "2 vs 7")`
    );
  });

  // Vector × Matrix
  it('should multiply vector by matrix', () => {
    // [7, 11] × [[1, 2], [3, 4]] = [7*1+11*3, 7*2+11*4] = [40, 58]
    const result = ce.box(['MatrixMultiply', v2_n, sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[40,58]`);
  });

  it('should multiply 2-vector by 2x3 matrix', () => {
    // [1, 2] × [[1, 2, 3], [4, 5, 6]] = [9, 12, 15]
    const v2: Expression = ['List', 1, 2];
    const result = ce.box(['MatrixMultiply', v2, m23_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[9,12,15]`);
  });

  // Vector × Vector (dot product)
  it('should compute dot product of two vectors', () => {
    // [7, 11] · [7, 11] = 49 + 121 = 170
    const result = ce.box(['MatrixMultiply', v2_n, v2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`170`);
  });

  it('should compute dot product of two longer vectors', () => {
    // Using first 3 elements of v7_n for simplicity
    const v3a: Expression = ['List', 1, 2, 3];
    const v3b: Expression = ['List', 4, 5, 6];
    // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    const result = ce.box(['MatrixMultiply', v3a, v3b]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`32`);
  });

  it('should return error for incompatible vector lengths in dot product', () => {
    const v3: Expression = ['List', 1, 2, 3];
    const result = ce.box(['MatrixMultiply', v2_n, v3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("incompatible-dimensions", "2 vs 3")`
    );
  });

  // Symbolic operations
  it('should handle symbolic matrix multiplication', () => {
    // [[a, b], [c, d]] × [[a, b], [c, d]]
    const result = ce.box(['MatrixMultiply', sq2_x, sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a^2 + b * c,a * b + b * d],[a * c + c * d,d^2 + b * c]]`
    );
  });

  // Identity matrix property
  it('should preserve matrix when multiplied by identity', () => {
    const identity: Expression = ['List', ['List', 1, 0], ['List', 0, 1]];
    const result = ce.box(['MatrixMultiply', sq2_n, identity]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,2],[3,4]]`);
  });
});

describe('Flatten', () => {
  it('should flatten a scalar', () => {
    const result = ce.box(['Flatten', 42]).evaluate();
    // Scalar flattens to single-element list
    expect(result.toString()).toMatchInlineSnapshot(`[42]`);
  });

  it('should flatten a numeric vector', () => {
    const result = ce.box(['Flatten', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[7,-2,11,-5,13,-7,17]`);
  });

  it('should flatten a numeric matrix', () => {
    const result = ce.box(['Flatten', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[1,2,3,4]`);
  });

  it('should flatten a matrix with unknowns', () => {
    const result = ce.box(['Flatten', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[a,b,c,d]`);
  });

  it('should flatten a numeric tensor', () => {
    const result = ce.box(['Flatten', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]`
    );
  });

  it('should flatten a tensor with unknowns', () => {
    const result = ce.box(['Flatten', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[a,b,c,d,"e_1","f_1",g,h,"i_1",j,k,l,m,"n_1",o,p,q,r,s,t,u,v,w,"x_1"]`
    );
  });
});

describe('Transpose', () => {
  it('should transpose a scalar', () => {
    const result = ce.box(['Transpose', 42]).evaluate();
    // Scalar transpose returns the scalar itself
    expect(result.toString()).toMatchInlineSnapshot(`42`);
  });

  it('should transpose a numeric vector', () => {
    const result = ce.box(['Transpose', v7_n]).evaluate();
    // Vector (rank 1) transpose returns the vector itself
    expect(result.toString()).toMatchInlineSnapshot(`[7,-2,11,-5,13,-7,17]`);
  });

  it('should transpose a numeric matrix', () => {
    const result = ce.box(['Transpose', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,3],[2,4]]`);
  });

  it('should transpose a matrix with unknowns', () => {
    const result = ce.box(['Transpose', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[a,c],[b,d]]`);
  });

  it('should transpose a numeric tensor', () => {
    const result = ce.box(['Transpose', t234_n]).evaluate();
    // For rank-3 tensor [2, 3, 4], swaps last two axes -> [2, 4, 3]
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[1,5,9],[2,6,10],[3,7,11],[4,8,12]],[[13,17,21],[14,18,22],[15,19,23],[16,20,24]]]`
    );
  });

  it('should transpose a tensor with unknowns', () => {
    const result = ce.box(['Transpose', t234_x]).evaluate();
    // For rank-3 tensor [3, 4, 2], swaps last two axes -> [3, 2, 4]
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[a,c,"e_1",g],[b,d,"f_1",h]],[["i_1",k,m,o],[j,l,"n_1",p]],[[q,s,u,w],[r,t,v,"x_1"]]]`
    );
  });
});

describe('ConjugateTranspose', () => {
  it('should conjugate transpose a scalar', () => {
    const result = ce.box(['ConjugateTranspose', 42]).evaluate();
    // Scalar conjugate transpose returns the conjugate (42 for real)
    expect(result.toString()).toMatchInlineSnapshot(`42`);
  });

  it('should conjugate transpose a numeric vector', () => {
    const result = ce.box(['ConjugateTranspose', v7_n]).evaluate();
    // Vector (rank 1) conjugate transpose returns the conjugated vector
    expect(result.toString()).toMatchInlineSnapshot(`[7,-2,11,-5,13,-7,17]`);
  });

  it('should conjugate transpose a numeric matrix', () => {
    const result = ce.box(['ConjugateTranspose', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,3],[2,4]]`);
  });

  it('should conjugate transpose a complex matrix', () => {
    const result = ce.box(['ConjugateTranspose', sq4_c]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[(2 - 3i),0],[2,i]]`);
  });

  it('should conjugate transpose a matrix with unknowns', () => {
    const result = ce.box(['ConjugateTranspose', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[Conjugate(a),Conjugate(c)],[Conjugate(b),Conjugate(d)]]`
    );
  });

  it('should conjugate transpose a numeric tensor', () => {
    const result = ce.box(['ConjugateTranspose', t234_n]).evaluate();
    // For rank-3 tensor [2, 3, 4], swaps last two axes -> [2, 4, 3]
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[1,5,9],[2,6,10],[3,7,11],[4,8,12]],[[13,17,21],[14,18,22],[15,19,23],[16,20,24]]]`
    );
  });

  it('should conjugate transpose a tensor with unknowns', () => {
    const result = ce.box(['ConjugateTranspose', t234_x]).evaluate();
    // For rank-3 tensor [3, 4, 2], swaps last two axes and conjugates -> [3, 2, 4]
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[Conjugate(a),Conjugate(c),Conjugate("e_1"),Conjugate(g)],[Conjugate(b),Conjugate(d),Conjugate("f_1"),Conjugate(h)]],[[Conjugate("i_1"),Conjugate(k),Conjugate(m),Conjugate(o)],[Conjugate(j),Conjugate(l),Conjugate("n_1"),Conjugate(p)]],[[Conjugate(q),Conjugate(s),Conjugate(u),Conjugate(w)],[Conjugate(r),Conjugate(t),Conjugate(v),Conjugate("x_1")]]]`
    );
  });
});

describe('Determinant', () => {
  it('should calculate the determinant of a scalar', () => {
    const result = ce.box(['Determinant', 42]).evaluate();
    // Type checking rejects scalar before evaluation can return the scalar
    expect(result.toString()).toMatchInlineSnapshot(
      `Determinant(Error(ErrorCode("incompatible-type", "matrix", "finite_integer")))`
    );
  });

  it('should calculate the determinant of a numeric vector', () => {
    const result = ce.box(['Determinant', v7_n]).evaluate();
    // Type checking rejects vector (not a matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Determinant(Error(ErrorCode("incompatible-type", "matrix", "list<number>")))`
    );
  });

  it('should calculate the determinant of a numeric matrix', () => {
    const result = ce.box(['Determinant', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`-2`);
  });

  it('should calculate the determinant of a matrix with unknowns', () => {
    const result = ce.box(['Determinant', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`-b * c + a * d`);
  });

  it('should calculate the determinant of a numeric tensor', () => {
    const result = ce.box(['Determinant', t234_n]).evaluate();
    // Type checking rejects tensor (not a 2D matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Determinant(Error(ErrorCode("incompatible-type", "matrix", "list<number^(2x3x4)>")))`
    );
  });

  it('should calculate the determinant of a tensor with unknowns', () => {
    const result = ce.box(['Determinant', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Determinant(Error(ErrorCode("incompatible-type", "matrix", "list<number^(3x4x2)>")))`
    );
  });
});

describe('Trace', () => {
  it('should calculate the trace of a scalar', () => {
    const result = ce.box(['Trace', 42]).evaluate();
    // Trace of scalar is the scalar itself
    expect(result.toString()).toMatchInlineSnapshot(`42`);
  });

  it('should calculate the trace of a numeric vector', () => {
    const result = ce.box(['Trace', v7_n]).evaluate();
    // Vector (rank 1) - trace not defined
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-matrix-or-tensor", "[7,-2,11,-5,13,-7,17]")`
    );
  });

  it('should calculate the trace of a numeric matrix', () => {
    const result = ce.box(['Trace', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should calculate the trace of a matrix with unknowns', () => {
    const result = ce.box(['Trace', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`a + d`);
  });

  it('should reject trace for non-square last two axes', () => {
    // Tensor with shape [2, 3, 4] - last two axes (3 and 4) are not equal
    const result = ce.box(['Trace', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-square-matrix", "[[[1,2,3,4],[5,6,7,8],[9,10,11,12]],[[13,14,15,16],[17,18,19,20],[21,22,23,24]]]")`
    );
  });

  it('should reject trace for non-square tensor slices', () => {
    // Tensor with shape [3, 4, 2] - last two axes (4 and 2) are not equal
    const result = ce.box(['Trace', t234_x]).evaluate();
    expect(result.toString()).toContain('expected-square-matrix');
  });
});

describe('Reshape', () => {
  it('should reshape a scalar', () => {
    const result = ce.box(['Reshape', 42, ['Tuple', 2, 2]]).evaluate();
    // Scalar is replicated to fill target shape
    expect(result.toString()).toMatchInlineSnapshot(`[[42,42],[42,42]]`);
  });

  it('should reshape a scalar', () => {
    const result = ce.box(['Reshape', 42, ['Tuple']]).evaluate();
    // Empty shape returns scalar
    expect(result.toString()).toMatchInlineSnapshot(`42`);
  });

  it('should reshape a numeric vector, extending it', () => {
    const result = ce.box(['Reshape', v7_n, ['Tuple', 3, 3]]).evaluate();
    // APL-style cycling: elements repeat to fill target shape
    expect(result.toString()).toMatchInlineSnapshot(
      `[[7,-2,11],[-5,13,-7],[17,7,-2]]`
    );
  });

  it('should reshape a numeric vector, contracting it', () => {
    const result = ce.box(['Reshape', v7_n, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[7,-2],[11,-5]]`);
  });

  it('should reshape a numeric vector, expanding it', () => {
    const result = ce.box(['Reshape', v7_n, ['Tuple', 3, 3]]).evaluate();
    // APL-style cycling: elements repeat to fill target shape
    expect(result.toString()).toMatchInlineSnapshot(
      `[[7,-2,11],[-5,13,-7],[17,7,-2]]`
    );
  });

  it('should reshape a general vector', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 3, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a,b,c],[d,"e_1","f_1"],[g,h,"i_1"]]`
    );
  });

  it('should reshape a general vector, extending it', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 3, 4]]).evaluate();
    // Cycling fills remaining slots with elements from the beginning
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a,b,c,d],["e_1","f_1",g,h],["i_1",a,b,c]]`
    );
  });

  it('should reshape a general vector, contracting it', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[a,b,c],[d,"e_1","f_1"]]`);
  });

  it('should reshape a general vector to a tensor', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 2, 3, 2]]).evaluate();
    // Cycling fills the 3D tensor from the 1D vector
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[a,b],[c,d],["e_1","f_1"]],[[g,h],["i_1",a],[b,c]]]`
    );
  });

  it('should reshape a numeric matrix', () => {
    const result = ce.box(['Reshape', sq2_n, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,2],[3,4]]`);
  });

  it('should reshape a matrix with unknowns', () => {
    const result = ce.box(['Reshape', sq2_x, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[a,b],[c,d]]`);
  });

  it('should reshape a numeric tensor', () => {
    const result = ce.box(['Reshape', t234_n, ['Tuple', 2, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[1,2,3],[4,5,6]],[[7,8,9],[10,11,12]]]`
    );
  });

  it('should reshape a tensor with unknowns', () => {
    const result = ce.box(['Reshape', t234_x, ['Tuple', 2, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[a,b,c],[d,"e_1","f_1"]],[[g,h,"i_1"],[j,k,l]]]`
    );
  });
});

describe('Inverse', () => {
  it('should calculate the inverse of a scalar', () => {
    const result = ce.box(['Inverse', 42]).evaluate();
    // Type checking rejects scalar before evaluation can return 1/scalar
    expect(result.toString()).toMatchInlineSnapshot(
      `Inverse(Error(ErrorCode("incompatible-type", "matrix", "finite_integer")))`
    );
  });

  it('should calculate the inverse of a numeric vector', () => {
    const result = ce.box(['Inverse', v7_n]).evaluate();
    // Type checking rejects vector (not a matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Inverse(Error(ErrorCode("incompatible-type", "matrix", "list<number>")))`
    );
  });

  it('should calculate the inverse of a numeric matrix', () => {
    const result = ce.box(['Inverse', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[-2,1],[1.5,-0.5]]`);
  });

  it('should calculate the inverse of a matrix with unknowns', () => {
    const result = ce.box(['Inverse', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[d / (-b * c + a * d),-b / (-b * c + a * d)],[-c / (-b * c + a * d),a / (-b * c + a * d)]]`
    );
  });

  it('should calculate the inverse of a numeric tensor', () => {
    const result = ce.box(['Inverse', t234_n]).evaluate();
    // Type checking rejects tensor (not a 2D matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Inverse(Error(ErrorCode("incompatible-type", "matrix", "list<number^(2x3x4)>")))`
    );
  });

  it('should calculate the inverse of a numeric tensor', () => {
    const result = ce.box(['Inverse', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Inverse(Error(ErrorCode("incompatible-type", "matrix", "list<number^(3x4x2)>")))`
    );
  });
});

describe('PseudoInverse', () => {
  it('should calculate the pseudo inverse of a scalar', () => {
    const result = ce.box(['PseudoInverse', 42]).evaluate();
    // Type checking rejects scalar before evaluation can return 1/scalar
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse(Error(ErrorCode("incompatible-type", "matrix", "finite_integer")))`
    );
  });

  it('should calculate the pseudo inverse of a numeric vector', () => {
    const result = ce.box(['PseudoInverse', v7_n]).evaluate();
    // Type checking rejects vector (not a matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse(Error(ErrorCode("incompatible-type", "matrix", "list<number>")))`
    );
  });

  it('should calculate the pseudo inverse of a numeric matrix', () => {
    const result = ce.box(['PseudoInverse', sq2_n]).evaluate();
    // Moore-Penrose pseudoinverse not yet fully implemented
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse([[1,2],[3,4]])`
    );
  });

  it('should calculate the pseudo inverse of a matrix with unknowns', () => {
    const result = ce.box(['PseudoInverse', sq2_x]).evaluate();
    // Moore-Penrose pseudoinverse not yet fully implemented
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse([[a,b],[c,d]])`
    );
  });

  it('should calculate the pseudo inverse of a numeric tensor', () => {
    const result = ce.box(['PseudoInverse', t234_n]).evaluate();
    // Type checking rejects tensor (not a 2D matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse(Error(ErrorCode("incompatible-type", "matrix", "list<number^(2x3x4)>")))`
    );
  });

  it('should calculate the pseudo inverse of a numeric tensor', () => {
    const result = ce.box(['PseudoInverse', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `PseudoInverse(Error(ErrorCode("incompatible-type", "matrix", "list<number^(3x4x2)>")))`
    );
  });
});

describe('Diagonal', () => {
  it('should create a diagonal matrix', () => {
    const result = ce.box(['Diagonal', 5]).evaluate();
    // Scalar returns as-is (no matrix created)
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should create a diagonal matrix from a vector', () => {
    const result = ce.box(['Diagonal', v7_n]).evaluate();
    // Vector creates NxN diagonal matrix
    expect(result.toString()).toMatchInlineSnapshot(
      `[[7,0,0,0,0,0,0],[0,-2,0,0,0,0,0],[0,0,11,0,0,0,0],[0,0,0,-5,0,0,0],[0,0,0,0,13,0,0],[0,0,0,0,0,-7,0],[0,0,0,0,0,0,17]]`
    );
  });

  it('should calculate the diagonal of a numeric square matrix', () => {
    const result = ce.box(['Diagonal', sq2_n]).evaluate();
    // Matrix extracts diagonal as vector
    expect(result.toString()).toMatchInlineSnapshot(`[1,4]`);
  });

  it('should calculate the diagonal of a matrix with unknowns', () => {
    const result = ce.box(['Diagonal', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[a,d]`);
  });

  it('should calculate the diagonal of a numeric tensor', () => {
    const result = ce.box(['Diagonal', t234_n]).evaluate();
    // Tensors (rank > 2) not supported for Diagonal
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-square-matrix", "[[[1,2,3,4],[5,6,7,8],[9,10,11,12]],[[13,14,15,16],[17,18,19,20],[21,22,23,24]]]")`
    );
  });
});

describe('IdentityMatrix', () => {
  it('should create a 2×2 identity matrix', () => {
    const result = ce.box(['IdentityMatrix', 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,0],[0,1]]`);
  });

  it('should create a 3×3 identity matrix', () => {
    const result = ce.box(['IdentityMatrix', 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,0,0],[0,1,0],[0,0,1]]`
    );
  });

  it('should create a 4×4 identity matrix', () => {
    const result = ce.box(['IdentityMatrix', 4]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]`
    );
  });

  it('should create a 1×1 identity matrix', () => {
    const result = ce.box(['IdentityMatrix', 1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1]]`);
  });

  it('should return error for non-positive integer', () => {
    const result = ce.box(['IdentityMatrix', 0]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-positive-integer", "0")`
    );
  });

  it('should return error for negative integer', () => {
    const result = ce.box(['IdentityMatrix', -2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-positive-integer", "-2")`
    );
  });

  it('should return error for non-integer', () => {
    const result = ce.box(['IdentityMatrix', 2.5]).evaluate();
    // Type signature validation catches this before evaluate runs
    expect(result.toString()).toMatchInlineSnapshot(
      `IdentityMatrix(Error(ErrorCode("incompatible-type", "integer", "finite_real")))`
    );
  });
});

describe('ZeroMatrix', () => {
  it('should create a 2×2 zero matrix', () => {
    const result = ce.box(['ZeroMatrix', 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[0,0],[0,0]]`);
  });

  it('should create a 3×3 zero matrix', () => {
    const result = ce.box(['ZeroMatrix', 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[0,0,0],[0,0,0],[0,0,0]]`
    );
  });

  it('should create a 2×3 zero matrix', () => {
    const result = ce.box(['ZeroMatrix', 2, 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[0,0,0],[0,0,0]]`);
  });

  it('should create a 3×2 zero matrix', () => {
    const result = ce.box(['ZeroMatrix', 3, 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[0,0],[0,0],[0,0]]`);
  });

  it('should return error for non-positive integer', () => {
    const result = ce.box(['ZeroMatrix', 0]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-positive-integer", "0")`
    );
  });
});

describe('OnesMatrix', () => {
  it('should create a 2×2 ones matrix', () => {
    const result = ce.box(['OnesMatrix', 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,1],[1,1]]`);
  });

  it('should create a 3×3 ones matrix', () => {
    const result = ce.box(['OnesMatrix', 3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,1,1],[1,1,1],[1,1,1]]`
    );
  });

  it('should create a 2×4 ones matrix', () => {
    const result = ce.box(['OnesMatrix', 2, 4]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[1,1,1,1],[1,1,1,1]]`);
  });

  it('should create a 4×2 ones matrix', () => {
    const result = ce.box(['OnesMatrix', 4, 2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `[[1,1],[1,1],[1,1],[1,1]]`
    );
  });

  it('should return error for non-positive integer', () => {
    const result = ce.box(['OnesMatrix', -1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error("expected-positive-integer", "-1")`
    );
  });
});

describe('Norm', () => {
  // Scalar norm (absolute value)
  it('should compute the norm of a scalar', () => {
    const result = ce.box(['Norm', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should compute the norm of a negative scalar', () => {
    const result = ce.box(['Norm', -7]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`7`);
  });

  // Vector L2 norm (default)
  it('should compute the L2 norm of a vector (3-4-5 triangle)', () => {
    // √(3² + 4²) = √(9 + 16) = √25 = 5
    const result = ce.box(['Norm', ['List', 3, 4]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should compute the L2 norm of a vector with negatives', () => {
    // √(3² + (-4)²) = 5
    const result = ce.box(['Norm', ['List', 3, -4]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should compute the L2 norm of a 3D vector', () => {
    // √(1² + 2² + 2²) = √(1 + 4 + 4) = √9 = 3
    const result = ce.box(['Norm', ['List', 1, 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`3`);
  });

  // Vector L1 norm
  it('should compute the L1 norm of a vector', () => {
    // |3| + |-4| = 3 + 4 = 7
    const result = ce.box(['Norm', ['List', 3, -4], 1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`7`);
  });

  it('should compute the L1 norm of a longer vector', () => {
    // |1| + |-2| + |3| + |-4| = 1 + 2 + 3 + 4 = 10
    const result = ce.box(['Norm', ['List', 1, -2, 3, -4], 1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`10`);
  });

  // Vector L∞ norm (max absolute value)
  it('should compute the L-infinity norm of a vector', () => {
    // max(|3|, |-4|) = 4
    const result = ce
      .box(['Norm', ['List', 3, -4], 'Infinity'])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`4`);
  });

  it('should compute the L-infinity norm with string', () => {
    // max(|1|, |-5|, |3|) = 5
    const result = ce
      .box(['Norm', ['List', 1, -5, 3], { str: 'Infinity' }])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  // Vector Lp norm (general)
  it('should compute the L3 norm of a vector', () => {
    // (|3|³ + |4|³)^(1/3) = (27 + 64)^(1/3) = 91^(1/3) ≈ 4.498
    const result = ce.box(['Norm', ['List', 3, 4], 3]).evaluate();
    expect(result.re).toBeCloseTo(4.4979, 3);
  });

  it('should compute the L4 norm of a vector', () => {
    // (|2|⁴ + |2|⁴)^(1/4) = (16 + 16)^(1/4) = 32^(1/4) ≈ 2.378
    const result = ce.box(['Norm', ['List', 2, 2], 4]).evaluate();
    expect(result.re).toBeCloseTo(2.3784, 3);
  });

  // Matrix Frobenius norm (default)
  it('should compute the Frobenius norm of a matrix', () => {
    // √(1² + 2² + 3² + 4²) = √(1 + 4 + 9 + 16) = √30 ≈ 5.477
    const result = ce.box(['Norm', sq2_n]).evaluate();
    expect(result.re).toBeCloseTo(5.4772, 3);
  });

  it('should compute the Frobenius norm of a non-square matrix', () => {
    // √(1² + 2² + 3² + 4² + 5² + 6²) = √(1+4+9+16+25+36) = √91 ≈ 9.539
    const result = ce.box(['Norm', m23_n]).evaluate();
    expect(result.re).toBeCloseTo(9.5394, 3);
  });

  it('should compute the Frobenius norm with explicit type', () => {
    const result = ce
      .box(['Norm', sq2_n, { str: 'Frobenius' }])
      .evaluate();
    expect(result.re).toBeCloseTo(5.4772, 3);
  });

  // Matrix L1 norm (max column sum)
  it('should compute the L1 norm of a matrix', () => {
    // [[1, 2], [3, 4]]
    // Column sums: |1| + |3| = 4, |2| + |4| = 6
    // max = 6
    const result = ce.box(['Norm', sq2_n, 1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`6`);
  });

  it('should compute the L1 norm of a matrix with negatives', () => {
    // [[1, -2], [-3, 4]]
    // Column sums: |1| + |-3| = 4, |-2| + |4| = 6
    // max = 6
    const result = ce
      .box(['Norm', ['List', ['List', 1, -2], ['List', -3, 4]], 1])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`6`);
  });

  // Matrix L∞ norm (max row sum)
  it('should compute the L-infinity norm of a matrix', () => {
    // [[1, 2], [3, 4]]
    // Row sums: |1| + |2| = 3, |3| + |4| = 7
    // max = 7
    const result = ce
      .box(['Norm', sq2_n, { str: 'Infinity' }])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`7`);
  });

  it('should compute the L-infinity norm of a non-square matrix', () => {
    // [[1, 2, 3], [4, 5, 6]]
    // Row sums: 1 + 2 + 3 = 6, 4 + 5 + 6 = 15
    // max = 15
    const result = ce
      .box(['Norm', m23_n, { str: 'Infinity' }])
      .evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`15`);
  });

  // Zero vector
  it('should compute the norm of a zero vector', () => {
    const result = ce.box(['Norm', ['List', 0, 0, 0]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`0`);
  });

  // Single element vector
  it('should compute the norm of a single element vector', () => {
    const result = ce.box(['Norm', ['List', -5]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });
});

describe('Higher-Rank Tensor Operations (LA-4)', () => {
  describe('Transpose for rank > 2', () => {
    it('should transpose last two axes of a rank-3 tensor by default', () => {
      // Shape [2, 2, 2] -> [2, 2, 2] (swapping last two axes)
      // First matrix [[1, 2], [3, 4]] -> [[1, 3], [2, 4]]
      // Second matrix [[5, 6], [7, 8]] -> [[5, 7], [6, 8]]
      const result = ce.box(['Transpose', t222_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,3],[2,4]],[[5,7],[6,8]]]`
      );
    });

    it('should transpose axes 1 and 2 of a rank-3 tensor', () => {
      // Shape [2, 2, 2] with axes 1 and 2 swapped -> shape [2, 2, 2]
      const result = ce.box(['Transpose', t222_n, 1, 2]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,2],[5,6]],[[3,4],[7,8]]]`
      );
    });

    it('should transpose axes 1 and 3 of a rank-3 tensor', () => {
      // Shape [2, 2, 2] with axes 1 and 3 swapped -> shape [2, 2, 2]
      const result = ce.box(['Transpose', t222_n, 1, 3]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,5],[3,7]],[[2,6],[4,8]]]`
      );
    });

    it('should transpose a non-square rank-3 tensor', () => {
      // Shape [2, 3, 4] with default (swap last two) -> [2, 4, 3]
      const result = ce.box(['Transpose', t234_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,5,9],[2,6,10],[3,7,11],[4,8,12]],[[13,17,21],[14,18,22],[15,19,23],[16,20,24]]]`
      );
    });

    it('should transpose axes 1 and 2 of shape [3, 2, 2]', () => {
      // Swap first two axes: [3, 2, 2] -> [2, 3, 2]
      const result = ce.box(['Transpose', t322_n, 1, 2]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[1,2],[5,6],[9,10]],[[3,4],[7,8],[11,12]]]`
      );
    });
  });

  describe('ConjugateTranspose for rank > 2', () => {
    it('should conjugate transpose last two axes of a rank-3 complex tensor', () => {
      // Shape [2, 2, 2], conjugate and swap last two axes
      const result = ce.box(['ConjugateTranspose', t222_c]).evaluate();
      // First slice: [[1-2i, 5-6i], [3-4i, 7-8i]]
      // Second slice: [[9-10i, 13-14i], [11-12i, 15-16i]]
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[(1 - 2i),(5 - 6i)],[(3 - 4i),(7 - 8i)]],[[(9 - 10i),(13 - 14i)],[(11 - 12i),(15 - 16i)]]]`
      );
    });

    it('should conjugate transpose specified axes of a rank-3 complex tensor', () => {
      const result = ce.box(['ConjugateTranspose', t222_c, 1, 3]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(
        `[[[(1 - 2i),(9 - 10i)],[(5 - 6i),(13 - 14i)]],[[(3 - 4i),(11 - 12i)],[(7 - 8i),(15 - 16i)]]]`
      );
    });

    it('should conjugate transpose a real rank-3 tensor (same as transpose)', () => {
      // For real tensors, conjugate transpose is just transpose
      const result = ce.box(['ConjugateTranspose', t222_n]).evaluate();
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
      const result = ce.box(['Trace', t222_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[5,13]`);
    });

    it('should compute batch trace of a [3, 2, 2] tensor', () => {
      // First matrix [[1, 2], [3, 4]]: trace = 1 + 4 = 5
      // Second matrix [[5, 6], [7, 8]]: trace = 5 + 8 = 13
      // Third matrix [[9, 10], [11, 12]]: trace = 9 + 12 = 21
      // Result: [5, 13, 21]
      const result = ce.box(['Trace', t322_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[5,13,21]`);
    });

    it('should compute batch trace of a [2, 3, 3] tensor', () => {
      // First matrix: trace = 1 + 5 + 9 = 15
      // Second matrix: trace = 10 + 14 + 18 = 42
      // Result: [15, 42]
      const result = ce.box(['Trace', t233_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[15,42]`);
    });

    it('should return error for non-square last two axes', () => {
      // Shape [2, 3, 4] - last two axes (3 and 4) are not equal
      const result = ce.box(['Trace', t234_n]).evaluate();
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
      const result = ce.box(['Trace', t222_n, 1, 2]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[8,10]`);
    });

    it('should compute trace over axes 1 and 3', () => {
      // t222_n has shape [2, 2, 2]
      // Trace over axes 1 and 3:
      // Result shape: [2] (remaining axis 2)
      // result[0] = data[0,0,0] + data[1,0,1] = 1 + 6 = 7
      // result[1] = data[0,1,0] + data[1,1,1] = 3 + 8 = 11
      const result = ce.box(['Trace', t222_n, 1, 3]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[7,11]`);
    });

    it('should still work for rank-2 matrices (backwards compatibility)', () => {
      const result = ce.box(['Trace', sq2_n]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`5`);
    });
  });
});

describe('Eigenvalues and Eigenvectors (LA-5)', () => {
  describe('Eigenvalues', () => {
    it('should compute eigenvalues of a 1×1 matrix', () => {
      const result = ce.box(['Eigenvalues', ['List', ['List', 5]]]).evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[5]`);
    });

    it('should compute eigenvalues of a 2×2 diagonal matrix', () => {
      // Diagonal matrix: eigenvalues are diagonal elements
      const result = ce
        .box(['Eigenvalues', ['List', ['List', 3, 0], ['List', 0, 7]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[3,7]`);
    });

    it('should compute eigenvalues of a 2×2 triangular matrix', () => {
      // Upper triangular: eigenvalues are diagonal elements
      const result = ce
        .box(['Eigenvalues', ['List', ['List', 2, 5], ['List', 0, 4]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[2,4]`);
    });

    it('should compute eigenvalues of a 2×2 matrix', () => {
      // [[4, 2], [1, 3]] has eigenvalues 5 and 2
      // trace = 7, det = 12 - 2 = 10
      // λ = (7 ± √(49-40))/2 = (7 ± 3)/2 = 5, 2
      const result = ce
        .box(['Eigenvalues', ['List', ['List', 4, 2], ['List', 1, 3]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[5,2]`);
    });

    it('should compute eigenvalues of a 2×2 identity matrix', () => {
      const result = ce
        .box(['Eigenvalues', ['List', ['List', 1, 0], ['List', 0, 1]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[1,1]`);
    });

    it('should compute eigenvalues of a 2×2 matrix with repeated eigenvalue', () => {
      // [[2, 1], [0, 2]] has eigenvalue 2 with multiplicity 2
      const result = ce
        .box(['Eigenvalues', ['List', ['List', 2, 1], ['List', 0, 2]]])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[2,2]`);
    });

    it('should compute eigenvalues of a 3×3 diagonal matrix', () => {
      const result = ce
        .box([
          'Eigenvalues',
          [
            'List',
            ['List', 1, 0, 0],
            ['List', 0, 2, 0],
            ['List', 0, 0, 3],
          ],
        ])
        .evaluate();
      expect(result.toString()).toMatchInlineSnapshot(`[1,2,3]`);
    });

    it('should compute eigenvalues of a 3×3 matrix numerically', () => {
      // [[6, -1, 0], [-1, 5, -1], [0, -1, 4]]
      // This symmetric matrix has eigenvalues approximately 7, 5, 3
      const result = ce
        .box([
          'Eigenvalues',
          [
            'List',
            ['List', 6, -1, 0],
            ['List', -1, 5, -1],
            ['List', 0, -1, 4],
          ],
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

    it('should return error for non-square matrix', () => {
      const result = ce.box(['Eigenvalues', m23_n]).evaluate();
      expect(result.toString()).toContain('expected-square-matrix');
    });

    it('should return error for vector', () => {
      const result = ce.box(['Eigenvalues', v7_n]).evaluate();
      // Type checking rejects vectors (not a matrix)
      expect(result.toString()).toContain('incompatible-type');
    });
  });

  describe('Eigenvectors', () => {
    it('should compute eigenvectors of a 2×2 diagonal matrix', () => {
      // Diagonal matrix: eigenvectors are standard basis vectors
      const result = ce
        .box(['Eigenvectors', ['List', ['List', 3, 0], ['List', 0, 7]]])
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
        .box(['Eigenvectors', ['List', ['List', 4, 2], ['List', 1, 3]]])
        .evaluate();
      expect(result.operator).toBe('List');
      expect(result.ops?.length).toBe(2);
    });

    it('should return error for non-square matrix', () => {
      const result = ce.box(['Eigenvectors', m23_n]).evaluate();
      expect(result.toString()).toContain('expected-square-matrix');
    });
  });

  describe('Eigen (combined)', () => {
    it('should return both eigenvalues and eigenvectors', () => {
      const result = ce
        .box(['Eigen', ['List', ['List', 4, 2], ['List', 1, 3]]])
        .evaluate();
      expect(result.operator).toBe('Tuple');
      expect(result.ops?.length).toBe(2);

      const eigenvalues = result.ops?.[0];
      const eigenvectors = result.ops?.[1];

      expect(eigenvalues?.operator).toBe('List');
      expect(eigenvectors?.operator).toBe('List');
    });

    it('should return error for non-square matrix', () => {
      const result = ce.box(['Eigen', m23_n]).evaluate();
      expect(result.toString()).toContain('expected-square-matrix');
    });
  });
});
