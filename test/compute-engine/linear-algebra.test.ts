import { engine as ce } from '../utils';

const v2_n = ['List', 7, 11];

const v7_n = ['List', 7, -2, 11, -5, 13, -7, 17];
const v9_x = ['List', 'a', 'b', 'c', 'd', 'e_1', 'f', 'g', 'h', 'i_1'];

const sq2_n = ['List', ['List', 1, 2], ['List', 3, 4]];

// Square matrix with some complex values
const sq4_c = [
  'List',
  ['List', ['Complex', 2, 3], 2],
  ['List', 0, ['Complex', 0, -1]],
];

// Square matrix with unknowns
const sq2_x = ['List', ['List', 'a', 'b'], ['List', 'c', 'd']];

const sq2_n2 = ['List', ['List', 5, 6], ['List', 7, 8]];

const m23_n = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]];

// Tensor of rank 3, shape [2, 3, 4]
const t234_n = [
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
const t234_x = [
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
    expect(result.toString()).toMatchInlineSnapshot(
      `["Diagonal",["List",1,1,1]]`
    ); // @todo
  });

  it('should create a diagonal pmatrix', () => {
    const result = ce.box(['Diagonal', ['List', 1, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Diagonal",["List",1,2,3]]`
    ); // @todo
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
    expect(result.toString()).toMatchInlineSnapshot(`["Pair",2,2]`);
  });

  it('should get the shape of a vector', () => {
    const result = ce.box(['Shape', v2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Single",2]`);
  });

  it('should get the shape of a scalar', () => {
    const result = ce.box(['Shape', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Tuple"]`);
  });
});

describe('Matrix addition', () => {
  it('should add a scalar to a matrix', () => {
    const result = ce.box(['Add', sq2_n, 10]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Add",["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",1,2],["List",3,4]]],10]`
    ); // @todo: should not return error
  });

  it('should add two matrixes', () => {
    const result = ce.box(['Add', sq2_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Add",["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",1,2],["List",3,4]]],["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",5,6],["List",7,8]]]]`
    ); // @todo: should not return error
  });

  it('should handle adding two matrixes of different dimension', () => {
    const result = ce.box(['Add', m23_n, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Add",["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",1,2,3],["List",4,5,6]]],["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",5,6],["List",7,8]]]]`
    ); // @todo: should not return error
  });

  it('should add two matrixes and a scalar', () => {
    const result = ce.box(['Add', sq2_n, 10, sq2_n2]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Add",["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",1,2],["List",3,4]]],10,["Error",["ErrorCode","'incompatible-domain'","Numbers","Lists"],["List",["List",5,6],["List",7,8]]]]`
    ); // @todo: should not return error
  });
});

describe('Flatten', () => {
  it('should flatten a scalar', () => {
    const result = ce.box(['Flatten', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Flatten",42]`);
  }); // @todo: should return ["List", 42]

  it('should flatten a numeric vector', () => {
    const result = ce.box(['Flatten', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",7,-2,11,-5,13,-7,17]`
    );
  });

  it('should flatten a numeric matrix', () => {
    const result = ce.box(['Flatten', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["List",1,2,3,4]`);
  });

  it('should flatten a matrix with unknowns', () => {
    const result = ce.box(['Flatten', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["List","a","b","c","d"]`);
  });

  it('should flatten a numeric tensor', () => {
    const result = ce.box(['Flatten', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]`
    );
  });

  it('should flatten a tensor with unknowns', () => {
    const result = ce.box(['Flatten', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List","a","b","c","d","e_1","f","g","h","i_1","j","k","l","m","n_1","o","p","q","r","s","t","u","v","w","x_1"]`
    );
  });
});

describe('Transpose', () => {
  it('should transpose a scalar', () => {
    const result = ce.box(['Transpose', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Transpose",42]`);
  }); // @todo should return 42

  it('should transpose a numeric vector', () => {
    const result = ce.box(['Transpose', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Transpose",["List",7,-2,11,-5,13,-7,17]]`
    );
  });

  it('should transpose a numeric matrix', () => {
    const result = ce.box(['Transpose', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",1,3],["List",2,4]]`
    );
  });

  it('should transpose a matrix with unknowns', () => {
    const result = ce.box(['Transpose', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List","a","c"],["List","b","d"]]`
    );
  });

  it('should transpose a numeric tensor', () => {
    const result = ce.box(['Transpose', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Transpose",["List",["List",["List",1,2,3,4],["List",5,6,7,8],["List",9,10,11,12]],["List",["List",13,14,15,16],["List",17,18,19,20],["List",21,22,23,24]]]]`
    );
  }); // @todo fails

  it('should transpose a tensor with unknowns', () => {
    const result = ce.box(['Transpose', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Transpose",["List",["List",["List","a","b"],["List","c","d"],["List","e_1","f"],["List","g","h"]],["List",["List","i_1","j"],["List","k","l"],["List","m","n_1"],["List","o","p"]],["List",["List","q","r"],["List","s","t"],["List","u","v"],["List","w","x_1"]]]]`
    );
  });
}); // @todo fails

describe('ConjugateTranspose', () => {
  it('should conjugate transpose a scalar', () => {
    const result = ce.box(['ConjugateTranspose', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["ConjugateTranspose",42]`
    );
  }); // @todo should return 42

  it('should conjugate transpose a numeric vector', () => {
    const result = ce.box(['ConjugateTranspose', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["ConjugateTranspose",["List",7,-2,11,-5,13,-7,17]]`
    );
  });

  it('should conjugate transpose a numeric matrix', () => {
    const result = ce.box(['ConjugateTranspose', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",1,3],["List",2,4]]`
    );
  });

  it('should conjugate transpose a complex matrix', () => {
    const result = ce.box(['ConjugateTranspose', sq4_c]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",["Complex",2,-3],0],["List",2,["Complex",0,1]]]`
    );
  });

  it('should conjugate transpose a matrix with unknowns', () => {
    const result = ce.box(['ConjugateTranspose', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",["Conjugate","a"],["Conjugate","c"]],["List",["Conjugate","b"],["Conjugate","d"]]]`
    );
  });

  it('should conjugate transpose a numeric tensor', () => {
    const result = ce.box(['ConjugateTranspose', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["ConjugateTranspose",["List",["List",["List",1,2,3,4],["List",5,6,7,8],["List",9,10,11,12]],["List",["List",13,14,15,16],["List",17,18,19,20],["List",21,22,23,24]]]]`
    );
  }); // @todo fails

  it('should conjugate transpose a tensor with unnknowns', () => {
    const result = ce.box(['ConjugateTranspose', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["ConjugateTranspose",["List",["List",["List","a","b"],["List","c","d"],["List","e_1","f"],["List","g","h"]],["List",["List","i_1","j"],["List","k","l"],["List","m","n_1"],["List","o","p"]],["List",["List","q","r"],["List","s","t"],["List","u","v"],["List","w","x_1"]]]]`
    );
  });
}); // @todo fails

describe('Determinant', () => {
  it('should calculate the determinant of a scalar', () => {
    const result = ce.box(['Determinant', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Determinant",42]`);
  }); // @todo should return 42

  it('should calculate the determinant of a numeric vector', () => {
    const result = ce.box(['Determinant', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Determinant",["List",7,-2,11,-5,13,-7,17]]`
    );
  }); // @todo should return 'expected-square-matrix'

  it('should calculate the determinant of a numeric matrix', () => {
    const result = ce.box(['Determinant', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`-2`);
  });

  it('should calculate the determinant of a matrix with unknowns', () => {
    const result = ce.box(['Determinant', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Subtract",["Multiply","a","d"],["Multiply","b","c"]]`
    );
  });

  it('should calculate the determinant of a numeric tensor', () => {
    const result = ce.box(['Determinant', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Determinant",["List",["List",["List",1,2,3,4],["List",5,6,7,8],["List",9,10,11,12]],["List",["List",13,14,15,16],["List",17,18,19,20],["List",21,22,23,24]]]]`
    );
  }); // @todo fails

  it('should calculate the determinant of a tensor with unknowns', () => {
    const result = ce.box(['Determinant', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Determinant",["List",["List",["List","a","b"],["List","c","d"],["List","e_1","f"],["List","g","h"]],["List",["List","i_1","j"],["List","k","l"],["List","m","n_1"],["List","o","p"]],["List",["List","q","r"],["List","s","t"],["List","u","v"],["List","w","x_1"]]]]`
    );
  });
});

describe('Trace', () => {
  it('should calculate the trace of a scalar', () => {
    const result = ce.box(['Trace', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Trace",42]`);
  }); // @todo should return 42

  it('should calculate the trace of a numeric vector', () => {
    const result = ce.box(['Trace', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Trace",["List",7,-2,11,-5,13,-7,17]]`
    );
  }); // @todo should return 'expected-square-matrix'

  it('should calculate the trace of a numeric matrix', () => {
    const result = ce.box(['Trace', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`5`);
  });

  it('should calculate the trace of a matrix with unknowns', () => {
    const result = ce.box(['Trace', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Add","a","d"]`);
  });

  it('should calculate the trace of a numeric tensor', () => {
    const result = ce.box(['Trace', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Trace",["List",["List",["List",1,2,3,4],["List",5,6,7,8],["List",9,10,11,12]],["List",["List",13,14,15,16],["List",17,18,19,20],["List",21,22,23,24]]]]`
    );
  }); // @todo fails, should be sum of matrixes on diagonal

  it('should calculate the trace of a numeric tensor', () => {
    const result = ce.box(['Trace', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Trace",["List",["List",["List","a","b"],["List","c","d"],["List","e_1","f"],["List","g","h"]],["List",["List","i_1","j"],["List","k","l"],["List","m","n_1"],["List","o","p"]],["List",["List","q","r"],["List","s","t"],["List","u","v"],["List","w","x_1"]]]]`
    );
  });
}); // @todo fails

describe('Reshape', () => {
  it('should reshape a scalar', () => {
    const result = ce.box(['Reshape', 42, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Reshape",42,["Pair",2,2]]`
    );
  }); // @todo: fails should return a 2x2 matrix filled with 42

  it('should reshape a scalar', () => {
    const result = ce.box(['Reshape', 42, ['Tuple']]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Reshape",42,["Tuple"]]`);
  }); // @todo should return 42

  it('should reshape a numeric vector, extending it', () => {
    const result = ce.box(['Reshape', v7_n, ['Tuple', 3, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",7,-2,11],["List",-5,13,-7],["List",17]]`
    );
  });

  it('should reshape a numeric vector, contracting it', () => {
    const result = ce.box(['Reshape', v7_n, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",7,-2],["List",11,-5]]`
    );
  });

  it('should reshape a numeric vector, expanding it', () => {
    const result = ce.box(['Reshape', v7_n, ['Tuple', 3, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",7,-2,11],["List",-5,13,-7],["List",17]]`
    );
  }); // @todo. Should cycle the ravel

  it('should reshape a general vector', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 3, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List","a","b","c"],["List","d","e_1","f"],["List","g","h","i_1"]]`
    );
  });

  it('should reshape a general vector, extending it', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 3, 4]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List","a","b","c","d"],["List","e_1","f","g","h"],["List","i_1"]]`
    );
  }); // @todo fails, should cycle the ravel

  it('should reshape a general vector, contracting it', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List","a","b","c"],["List","d","e_1","f"]]`
    );
  });

  it('should reshape a general vector to a tensor', () => {
    const result = ce.box(['Reshape', v9_x, ['Tuple', 2, 3, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",["List","a","b"],["List","c","d"],["List","e_1","f"]],["List",["List","g","h"],["List","i_1"],["List"]]]`
    );
  }); // @todo fails, should cycle the ravel

  it('should reshape a numeric matrix', () => {
    const result = ce.box(['Reshape', sq2_n, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",1,2],["List",3,4]]`
    );
  });

  it('should reshape a matrix with unknowns', () => {
    const result = ce.box(['Reshape', sq2_x, ['Tuple', 2, 2]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List","a","b"],["List","c","d"]]`
    );
  });

  it('should reshape a numeric tensor', () => {
    const result = ce.box(['Reshape', t234_n, ['Tuple', 2, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",["List",1,2,3],["List",4,5,6]],["List",["List",7,8,9],["List",10,11,12]]]`
    );
  });

  it('should reshape a tensor with unknowns', () => {
    const result = ce.box(['Reshape', t234_x, ['Tuple', 2, 2, 3]]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",["List","a","b","c"],["List","d","e_1","f"]],["List",["List","g","h","i_1"],["List","j","k","l"]]]`
    );
  });
});

describe('Inverse', () => {
  it('should calculate the inverse of a scalar', () => {
    const result = ce.box(['Inverse', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Inverse",42]`);
  }); // @todo should return 1/42

  it('should calculate the inverse of a numeric vector', () => {
    const result = ce.box(['Inverse', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Inverse",["List",7,-2,11,-5,13,-7,17]]`
    );
  }); // @todo should return `expected-square-matrix`

  it('should calculate the inverse of a numeric matrix', () => {
    const result = ce.box(['Inverse', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",-2,1],["List",1.5,-0.5]]`
    );
  });

  it('should calculate the inverse of a matrix with unknowns', () => {
    const result = ce.box(['Inverse', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["List",["List",["Divide","d",["Subtract",["Multiply","a","d"],["Multiply","b","c"]]],["Divide",["Negate","b"],["Subtract",["Multiply","a","d"],["Multiply","b","c"]]]],["List",["Divide",["Negate","c"],["Subtract",["Multiply","a","d"],["Multiply","b","c"]]],["Divide","a",["Subtract",["Multiply","a","d"],["Multiply","b","c"]]]]]`
    );
  });

  it('should calculate the inverse of a numeric tensor', () => {
    const result = ce.box(['Inverse', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Inverse",["List",["List",["List",1,2,3,4],["List",5,6,7,8],["List",9,10,11,12]],["List",["List",13,14,15,16],["List",17,18,19,20],["List",21,22,23,24]]]]`
    );
  }); // @todo 'expected-square-matrix'

  it('should calculate the inverse of a numeric tensor', () => {
    const result = ce.box(['Inverse', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Inverse",["List",["List",["List","a","b"],["List","c","d"],["List","e_1","f"],["List","g","h"]],["List",["List","i_1","j"],["List","k","l"],["List","m","n_1"],["List","o","p"]],["List",["List","q","r"],["List","s","t"],["List","u","v"],["List","w","x_1"]]]]`
    );
  });
}); // @todo `expected-square-matrix`

describe('PseudoInverse', () => {
  it('should calculate the pseudo inverse of a scalar', () => {
    const result = ce.box(['PseudoInverse', 42]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["PseudoInverse",42]`);
  }); // @todo

  it('should calculate the pseudo inverse of a numeric vector', () => {
    const result = ce.box(['PseudoInverse', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["PseudoInverse",["List",7,-2,11,-5,13,-7,17]]`
    );
  }); // @todo

  it('should calculate the pseudo inverse of a numeric matrix', () => {
    const result = ce.box(['PseudoInverse', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["PseudoInverse",["List",["List",1,2],["List",3,4]]]`
    );
  }); // @todo

  it('should calculate the pseudo inverse of a matrix with unknowns', () => {
    const result = ce.box(['PseudoInverse', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["PseudoInverse",["List",["List","a","b"],["List","c","d"]]]`
    );
  }); // @todo

  it('should calculate the pseudo inverse of a numeric tensor', () => {
    const result = ce.box(['PseudoInverse', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["PseudoInverse",["List",["List",["List",1,2,3,4],["List",5,6,7,8],["List",9,10,11,12]],["List",["List",13,14,15,16],["List",17,18,19,20],["List",21,22,23,24]]]]`
    );
  }); // @todo

  it('should calculate the pseudo inverse of a numeric tensor', () => {
    const result = ce.box(['PseudoInverse', t234_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["PseudoInverse",["List",["List",["List","a","b"],["List","c","d"],["List","e_1","f"],["List","g","h"]],["List",["List","i_1","j"],["List","k","l"],["List","m","n_1"],["List","o","p"]],["List",["List","q","r"],["List","s","t"],["List","u","v"],["List","w","x_1"]]]]`
    );
  });
}); // @todo

describe('Diagonal', () => {
  it('should create a diagonal matrix', () => {
    const result = ce.box(['Diagonal', 5]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(`["Diagonal",5]`);
  }); // @todo

  it('should create a diagonal matrix from a vector', () => {
    const result = ce.box(['Diagonal', v7_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Diagonal",["List",7,-2,11,-5,13,-7,17]]`
    );
  }); // @todo

  it('should calculate the diagonal of a numeric square matrix', () => {
    const result = ce.box(['Diagonal', sq2_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Diagonal",["List",["List",1,2],["List",3,4]]]`
    );
  }); // @todo

  it('should calculate the diagonal of a matrix with unknowns', () => {
    const result = ce.box(['Diagonal', sq2_x]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Diagonal",["List",["List","a","b"],["List","c","d"]]]`
    );
  }); // @todo

  it('should calculate the diagonal of a numeric tensor', () => {
    const result = ce.box(['Diagonal', t234_n]).evaluate();
    expect(result.toString()).toMatchInlineSnapshot(
      `["Diagonal",["List",["List",["List",1,2,3,4],["List",5,6,7,8],["List",9,10,11,12]],["List",["List",13,14,15,16],["List",17,18,19,20],["List",21,22,23,24]]]]`
    );
  }); // @todo `expected-square-matrix`
});
