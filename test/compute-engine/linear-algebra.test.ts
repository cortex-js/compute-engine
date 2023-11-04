import { engine as ce } from '../utils';

const v2_1 = ['List', 7, 11];

const v7 = ['List', 7, -2, 11, -5, 13, -7, 17];
const v9_x = ['List', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i_1'];

const m4_1 = ['List', ['List', 1, 2], ['List', 3, 4]];

// Matrix with complex values
const m4_c = [
  'List',
  ['List', ['Complex', 2, 3], 2],
  ['List', 0, ['Complex', 0, -1]],
];

const m4_2 = ['List', ['List', 5, 6], ['List', 7, 8]];

const m6_1 = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]];

// Tensor of rank 3, shape [2, 3, 4]
const t3 = [
  'List',
  ['List', ['List', 1, 2, 3, 4], ['List', 5, 6, 7, 8], ['List', 9, 10, 11, 12]],
  [
    'List',
    ['List', 13, 14, 15, 16],
    ['List', 17, 18, 19, 20],
    ['List', 21, 22, 23, 24],
  ],
];

// Matrix with unknowns
const m4_x = ['List', ['List', 'a', 'b'], ['List', 'c', 'd']];

// Tensor of shape [3, 4, 2] with unknowns
const t3_x = [
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
    const result = ce.parse('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
    expect(result.toString()).toMatchInlineSnapshot(
      `["Matrix",["List",["List",["a","b"]],["List",["c","d"]]]]`
    );
  });

  it('should create a diagonal pmatrix', () => {
    const result = ce.parse('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
    expect(result.toString()).toMatchInlineSnapshot(
      `["Matrix",["List",["List",["a","b"]],["List",["c","d"]]]]`
    );
  });
});

describe('Info about matrix', () => {
  it('should get the rank of a matrix', () => {
    const result = ce.box(['Rank', m4_1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Rank",["List",["List",1,2],["List",3,4]]]`
    );
  });

  it('should get the rank of a vector', () => {
    const result = ce.box(['Rank', v2_1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Rank",["List",7,11]]`);
  });

  it('should get the rank of a scalar', () => {
    const result = ce.box(['Rank', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Rank",5]`);
  });

  it('should get the dimensions of a matrix', () => {
    const result = ce.box(['Dimensions', m4_1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Dimensions",["List",["List",1,2],["List",3,4]]]`
    );
  });

  it('should get the dimensions of a vector', () => {
    const result = ce.box(['Dimensions', v2_1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Dimensions",["List",7,11]]`
    );
  });

  it('should get the dimensions of a scalar', () => {
    const result = ce.box(['Dimensions', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Dimensions",5]`);
  });
});

describe('Matrix addition', () => {
  it('should add a scalar to a matrix', () => {
    const result = ce.box(['Add', m4_1, 10]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Add",["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",1,2],["List",3,4]]],10]`
    );
  });

  it('should add two matrixes', () => {
    const result = ce.box(['Add', m4_1, m4_2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Add",["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",1,2],["List",3,4]]],["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",5,6],["List",7,8]]]]`
    );
  });

  it('should handle adding two matrixes of different dimension', () => {
    const result = ce.box(['Add', m6_1, m4_2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Add",["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",1,2,3],["List",4,5,6]]],["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",5,6],["List",7,8]]]]`
    );
  });

  it('should add two matrixes and a scalar', () => {
    const result = ce.box(['Add', m4_1, 10, m4_2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Add",["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",1,2],["List",3,4]]],10,["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",5,6],["List",7,8]]]]`
    );
  });
});

describe('Flatten', () => {
  it('should flatten a scalar', () => {
    const result = ce.box(['Flatten', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should flatten a numeric vector', () => {
    const result = ce.box(['Flatten', v7]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should flatten a numeric matrix', () => {
    const result = ce.box(['Flatten', m4_1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should flatten a matrix with unknowns', () => {
    const result = ce.box(['Flatten', m4_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should flatten a numeric tensor', () => {
    const result = ce.box(['Flatten', t3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should flatten a numeric tensor', () => {
    const result = ce.box(['Flatten', t3_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });
});

describe('Transpose', () => {
  it('should transpose a scalar', () => {
    const result = ce.box(['Transpose', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should transpose a numeric vector', () => {
    const result = ce.box(['Transpose', v7]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should transpose a numeric matrix', () => {
    const result = ce.box(['Transpose', m4_1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should transpose a matrix with unknowns', () => {
    const result = ce.box(['Transpose', m4_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should transpose a numeric tensor', () => {
    const result = ce.box(['Transpose', t3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should transpose a numeric tensor', () => {
    const result = ce.box(['Transpose', t3_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });
});

describe('ConjugateTranspose', () => {
  it('should conjugate transpose a scalar', () => {
    const result = ce.box(['ConjugateTranspose', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should conjugate transpose a numeric vector', () => {
    const result = ce.box(['ConjugateTranspose', v7]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should conjugate transpose a numeric matrix', () => {
    const result = ce.box(['ConjugateTranspose', m4_1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should conjugate transpose a complex matrix', () => {
    const result = ce.box(['ConjugateTranspose', m4_c]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should conjugate transpose a matrix with unknowns', () => {
    const result = ce.box(['ConjugateTranspose', m4_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should conjugate transpose a numeric tensor', () => {
    const result = ce.box(['ConjugateTranspose', t3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should conjugate transpose a numeric tensor', () => {
    const result = ce.box(['ConjugateTranspose', t3_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });
});

describe('Determinant', () => {
  it('should calculate the determinant of a scalar', () => {
    const result = ce.box(['Determinant', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the determinant of a numeric vector', () => {
    const result = ce.box(['Determinant', v7]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the determinant of a numeric matrix', () => {
    const result = ce.box(['Determinant', m4_1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the determinant of a matrix with unknowns', () => {
    const result = ce.box(['Determinant', m4_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the determinant of a numeric tensor', () => {
    const result = ce.box(['Determinant', t3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the determinant of a numeric tensor', () => {
    const result = ce.box(['Determinant', t3_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });
});

describe('Trace', () => {
  it('should calculate the trace of a scalar', () => {
    const result = ce.box(['Trace', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the trace of a numeric vector', () => {
    const result = ce.box(['Trace', v7]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the trace of a numeric matrix', () => {
    const result = ce.box(['Trace', m4_1]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the trace of a matrix with unknowns', () => {
    const result = ce.box(['Trace', m4_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the trace of a numeric tensor', () => {
    const result = ce.box(['Trace', t3]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should calculate the trace of a numeric tensor', () => {
    const result = ce.box(['Trace', t3_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });
});

describe('Reshape', () => {
  it('should reshape a scalar', () => {
    const result = ce.box(['Reshape', 42, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a scalar', () => {
    const result = ce.box(['Reshape', 42, ['Tuple']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a numeric vector, extending it', () => {
    const result = ce.box(['Reshape', v7, ['Tuple', 3, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a numeric vector, contracting it', () => {
    const result = ce.box(['Reshape', v7, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a general vector', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 3, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a general vector, extending it', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 3, 4]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a general vector, contracting it', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a general vector to a tensor', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 2, 3, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a numeric matrix', () => {
    const result = ce.box(['Reshape', m4_1, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a matrix with unknowns', () => {
    const result = ce.box(['Reshape', m4_x, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a numeric tensor', () => {
    const result = ce.box(['Reshape', t3, ['Tuple', 2, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });

  it('should reshape a tensor with unknowns', () => {
    const result = ce.box(['Reshape', t3_x, ['Tuple', 2, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot();
  });
});
