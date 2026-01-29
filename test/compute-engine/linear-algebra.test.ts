import { Expression } from '../../src/math-json/types.ts';
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
  'f',
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
const t234_x: Expression = [
  'List',
  [
    'List',
    ['List', 'a', 'b'],
    ['List', 'c', 'd'],
    ['List', 'e_1', 'f'],
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
  // Note: Matrix addition is not yet implemented in arithmetic.ts
  // These tests document current behavior (type errors)
  it('should add a scalar to a matrix', () => {
    const result = ce.box(['Add', sq2_n, 10]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error(ErrorCode("incompatible-type", "number", "matrix<2x2>")) + 10`
    ); // TODO: implement matrix arithmetic
  });

  it('should add two matrixes', () => {
    const result = ce.box(['Add', sq2_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error(ErrorCode("incompatible-type", "number", "matrix<2x2>")) + Error(ErrorCode("incompatible-type", "number", "matrix<2x2>"))`
    ); // TODO: implement matrix arithmetic
  });

  it('should handle adding two matrixes of different dimension', () => {
    const result = ce.box(['Add', m23_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error(ErrorCode("incompatible-type", "number", "matrix<2x3>")) + Error(ErrorCode("incompatible-type", "number", "matrix<2x2>"))`
    ); // TODO: implement matrix arithmetic
  });

  it('should add two matrixes and a scalar', () => {
    const result = ce.box(['Add', sq2_n, 10, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Error(ErrorCode("incompatible-type", "number", "matrix<2x2>")) + 10 + Error(ErrorCode("incompatible-type", "number", "matrix<2x2>"))`
    ); // TODO: implement matrix arithmetic
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
      `[a,b,c,d,"e_1",f,g,h,"i_1",j,k,l,m,"n_1",o,p,q,r,s,t,u,v,w,"x_1"]`
    );
  });
});

describe('Transpose', () => {
  it('should transpose a scalar', () => {
    const result = ce.box(['Transpose', 42]).evaluate();
    // Type checking rejects scalar before evaluation can return the scalar
    expect(result.toString()).toMatchInlineSnapshot(
      `Transpose(Error(ErrorCode("incompatible-type", "matrix | list<number>", "finite_integer")))`
    );
  });

  it('should transpose a numeric vector', () => {
    const result = ce.box(['Transpose', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Transpose([7,-2,11,-5,13,-7,17])`
    );
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
    expect(result.toString()).toMatchInlineSnapshot(
      `Transpose([[[1,2,3,4],[5,6,7,8],[9,10,11,12]],[[13,14,15,16],[17,18,19,20],[21,22,23,24]]])`
    );
  });

  it('should transpose a tensor with unknowns', () => {
    const result = ce.box(['Transpose', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Transpose([[[a,b],[c,d],["e_1",f],[g,h]],[["i_1",j],[k,l],[m,"n_1"],[o,p]],[[q,r],[s,t],[u,v],[w,"x_1"]]])`
    );
  });
});

describe('ConjugateTranspose', () => {
  it('should conjugate transpose a scalar', () => {
    const result = ce.box(['ConjugateTranspose', 42]).evaluate();
    // Type checking rejects scalar before evaluation
    expect(result.toString()).toMatchInlineSnapshot(
      `ConjugateTranspose(Error(ErrorCode("incompatible-type", "list<number>", "finite_integer")))`
    );
  });

  it('should conjugate transpose a numeric vector', () => {
    const result = ce.box(['ConjugateTranspose', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `ConjugateTranspose([7,-2,11,-5,13,-7,17])`
    );
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
    // Rank-3+ tensors not yet supported for conjugate transpose
    expect(result.toString()).toMatchInlineSnapshot(
      `ConjugateTranspose([[[1,2,3,4],[5,6,7,8],[9,10,11,12]],[[13,14,15,16],[17,18,19,20],[21,22,23,24]]])`
    );
  });

  it('should conjugate transpose a tensor with unnknowns', () => {
    const result = ce.box(['ConjugateTranspose', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `ConjugateTranspose([[[a,b],[c,d],["e_1",f],[g,h]],[["i_1",j],[k,l],[m,"n_1"],[o,p]],[[q,r],[s,t],[u,v],[w,"x_1"]]])`
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
    // Type checking rejects scalar before evaluation can return the scalar
    expect(result.toString()).toMatchInlineSnapshot(
      `Trace(Error(ErrorCode("incompatible-type", "matrix", "finite_integer")))`
    );
  });

  it('should calculate the trace of a numeric vector', () => {
    const result = ce.box(['Trace', v7_n]).evaluate();
    // Type checking rejects vector (not a matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Trace(Error(ErrorCode("incompatible-type", "matrix", "list<number>")))`
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

  it('should calculate the trace of a numeric tensor', () => {
    const result = ce.box(['Trace', t234_n]).evaluate();
    // Type checking rejects tensor (not a 2D matrix)
    expect(result.toString()).toMatchInlineSnapshot(
      `Trace(Error(ErrorCode("incompatible-type", "matrix", "list<number^(2x3x4)>")))`
    );
  });

  it('should calculate the trace of a numeric tensor', () => {
    const result = ce.box(['Trace', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `Trace(Error(ErrorCode("incompatible-type", "matrix", "list<number^(3x4x2)>")))`
    );
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
      `[[a,b,c],[d,"e_1",f],[g,h,"i_1"]]`
    );
  });

  it('should reshape a general vector, extending it', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 3, 4]]).evaluate();
    // Cycling fills remaining slots with elements from the beginning
    expect(result.toString()).toMatchInlineSnapshot(
      `[[a,b,c,d],["e_1",f,g,h],["i_1",a,b,c]]`
    );
  });

  it('should reshape a general vector, contracting it', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`[[a,b,c],[d,"e_1",f]]`);
  });

  it('should reshape a general vector to a tensor', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 2, 3, 2]]).evaluate();
    // Cycling fills the 3D tensor from the 1D vector
    expect(result.toString()).toMatchInlineSnapshot(
      `[[[a,b],[c,d],["e_1",f]],[[g,h],["i_1",a],[b,c]]]`
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
      `[[[a,b,c],[d,"e_1",f]],[[g,h,"i_1"],[j,k,l]]]`
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
