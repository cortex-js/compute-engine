import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

/**
 * The static result types of the linear-algebra operators whose type handler
 * reads the element type and the dimensions of the operands
 * (`library/linear-algebra.ts`).
 *
 * Each case checks the static type, then evaluates the expression and
 * checks that the type of the value is a subtype of the static type. The
 * value can be a matrix, a scalar, `NaN` cells, or the application itself
 * when it stays unevaluated (a singular matrix, a symbolic operand).
 *
 * An input that evaluates to an error is checked by `declines()`: the
 * handler does not narrow the declared result. No list or tuple type admits
 * an error, so the subtype test does not apply to it.
 *
 * Each `describe` block uses its own engine, because a use of a symbol in a
 * matrix context can change the type of the symbol for the lifetime of the
 * engine.
 */

type Input = string | unknown[];

const L = (...xs: unknown[]): unknown[] => ['List', ...xs];

/** Integer 2×2, invertible. */
const A = L(L(1, 2), L(3, 4));
/** Integer 2×2, singular. */
const S = L(L(1, 2), L(2, 4));
/** Integer 2×3. */
const R = L(L(1, 2, 3), L(4, 5, 6));
/** Integer 3×2. */
const T = L(L(1, 2), L(3, 4), L(5, 6));
/** Rational 2×2. */
const Q = L(L(['Rational', 1, 2], 1), L(1, 3));
/** Real 2×2 (a float entry), singular. */
const F = L(L(1.5, 2), L(3, 4));
/** Complex 2×2 (Hermitian). */
const C = L(L(1, 'ImaginaryUnit'), L(['Negate', 'ImaginaryUnit'], 2));
/** A matrix with a NaN cell. */
const N = L(L('NaN', 1), L(1, 1));
/** Integer 2×2, rotation by 90° (eigenvalues ±i). */
const Rot = L(L(0, -1), L(1, 0));
/** Integer 2×2, symmetric positive definite. */
const SPD = L(L(4, 2), L(2, 3));
/** Integer 3×3. */
const B3 = L(L(1, 2, 3), L(4, 5, 6), L(7, 8, 10));
/** Integer 3×3, a cyclic permutation (eigenvalues: the cube roots of 1). */
const Cyc = L(L(0, 1, 0), L(0, 0, 1), L(1, 0, 0));
/** Integer 4×4, tridiagonal. */
const T4 = L(L(2, 1, 0, 0), L(1, 2, 1, 0), L(0, 1, 2, 1), L(0, 0, 1, 2));
/** A rank-3 tensor. */
const Rk3 = L(L(L(1, 2), L(3, 4)), L(L(5, 6), L(7, 8)));
/** A ragged list. */
const Ragged = L(L(1), L(2, 3));
/** Entries typed `integer` that are floats: `1.5e308` is a machine number
 * with an integer value. Products of them overflow in machine precision. */
const Big = L(L(1.5e308, 1.5e308), L(1.5e308, -1.5e308));

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('m', 'matrix<integer>');
  ce.declare('q', 'matrix<integer^(2x2)>');
  ce.declare('r', 'matrix<real^(2x2)>');
  ce.declare('t', 'tensor<integer>');
  ce.declare('n', 'integer');
  ce.declare('L', 'list<integer>');
  return ce;
}

function expr(ce: ComputeEngine, input: Input): Expression {
  return typeof input === 'string' ? ce.parse(input) : ce.box(input as any);
}

/** The static type is `expected`, and the value of the expression has a
 * subtype of it. Returns the value. */
function sound(ce: ComputeEngine, input: Input, expected: string): Expression {
  const e = expr(ce, input);
  expect(e.type.toString()).toBe(expected);
  const value = e.evaluate();
  expect({
    value: value.toString(),
    type: value.type.toString(),
    subtype: isSubtype(value.type.type, e.type.type),
  }).toMatchObject({ subtype: true });
  return value;
}

/** The handler declines (the static type is the declared result `declared`)
 * and the value is an error. */
function declines(ce: ComputeEngine, input: Input, declared: string): void {
  const e = expr(ce, input);
  expect(e.type.toString()).toBe(declared);
  expect(e.evaluate().operator).toBe('Error');
}

describe('Shape', () => {
  const ce = engine();
  test('a matrix has two integer extents', () => {
    expect(sound(ce, ['Shape', R], 'tuple<integer, integer>').toString()).toBe(
      '(2, 3)'
    );
  });
  test('a vector has one', () => {
    expect(sound(ce, ['Shape', L(1, 2, 3)], 'tuple<integer>').toString()).toBe(
      '(3)'
    );
  });
  test('empty lists', () => {
    expect(sound(ce, ['Shape', L()], 'tuple<integer>').toString()).toBe('(0)');
    expect(
      sound(ce, ['Shape', L(L(), L())], 'tuple<integer, integer>').toString()
    ).toBe('(2, 0)');
  });
  test('a declared matrix with no value', () => {
    sound(ce, ['Shape', 'm'], 'tuple<integer, integer>');
  });
  test('an unevaluated matrix-valued application', () => {
    sound(ce, ['Shape', ['Inverse', S]], 'tuple<integer, integer>');
  });
  test('a scalar, a ragged list and a tensor of unknown rank decline', () => {
    expect(sound(ce, ['Shape', 5], 'tuple').toString()).toBe('()');
    sound(ce, ['Shape', Ragged], 'tuple');
    sound(ce, ['Shape', 't'], 'tuple');
  });
});

describe('PseudoInverse', () => {
  const ce = engine();
  test('a real cell gives number cells: a subnormal cell has an infinite reciprocal', () => {
    // `1 / 1.5e-320` overflows to `+∞`, which `real` does not admit.
    const v = sound(ce, ['PseudoInverse', L(L(1.5e-320))], 'matrix<1x1>');
    expect(v.evaluate().toString()).toBe('[[+oo]]');
    sound(ce, ['LinearSolve', L(L(1.5e-320, 0), L(0, 1.5)), L(1, 1)], 'vector<2>');
  });
  test('an m×n matrix gives an n×m matrix', () => {
    sound(ce, ['PseudoInverse', T], 'matrix<real^(2x3)>');
    sound(ce, ['PseudoInverse', R], 'matrix<real^(3x2)>');
  });
  test('an exact matrix gives rational cells, a subtype of real', () => {
    expect(
      sound(ce, ['PseudoInverse', A], 'matrix<real^(2x2)>').type.toString()
    ).toBe('matrix<rational^(2x2)>');
  });
  test('a cell typed integer that is a float gives float cells', () => {
    expect(
      sound(
        ce,
        '\\mathrm{PseudoInverse}(\\begin{pmatrix}2.0 & 1\\\\ 1 & 3\\end{pmatrix})',
        'matrix<real^(2x2)>'
      ).type.toString()
    ).toBe('matrix<real^(2x2)>');
  });
  test('a rank-deficient matrix stays unevaluated', () => {
    expect(sound(ce, ['PseudoInverse', S], 'matrix<real^(2x2)>').operator).toBe(
      'PseudoInverse'
    );
  });
  test('complex cells give number cells', () => {
    sound(ce, ['PseudoInverse', C], 'matrix<2x2>');
  });
  test('a declared matrix of unknown extents', () => {
    sound(ce, ['PseudoInverse', 'm'], 'matrix<real>');
  });
  test('symbolic and NaN cells decline', () => {
    sound(ce, ['PseudoInverse', L(L('x', 1), L(0, 1))], 'matrix');
    sound(ce, ['PseudoInverse', N], 'matrix');
  });
});

describe('LinearSolve', () => {
  const ce = engine();
  test('the solution has the shape of the right side', () => {
    sound(ce, ['LinearSolve', L(L(2, 1), L(1, 3)), L(3, 5)], 'vector<real^2>');
    sound(ce, ['LinearSolve', A, L(L(1, 0), L(0, 1))], 'matrix<real^(2x2)>');
    sound(
      ce,
      '\\mathrm{LinearSolve}(\\begin{pmatrix}2.0 & 1\\\\ 1 & 3\\end{pmatrix}, \\begin{pmatrix}1 \\\\ 1\\end{pmatrix})',
      'matrix<real^(2x1)>'
    );
  });
  test('a singular matrix stays unevaluated', () => {
    expect(
      sound(ce, ['LinearSolve', S, L(3, 5)], 'vector<real^2>').operator
    ).toBe('LinearSolve');
  });
  test('complex cells give number cells', () => {
    sound(ce, ['LinearSolve', C, L(3, 5)], 'vector<2>');
  });
  test('the length comes from the right side when the matrix has none', () => {
    sound(ce, ['LinearSolve', 'm', L(1, 2, 3)], 'vector<real^3>');
  });
  test('a non-square matrix or a length mismatch declines', () => {
    declines(ce, ['LinearSolve', R, L(3, 5)], 'value');
    declines(ce, ['LinearSolve', A, L(1, 2, 3)], 'value');
  });
});

describe('AdjugateMatrix', () => {
  const ce = engine();
  test('an integer matrix gives an integer matrix', () => {
    sound(ce, ['AdjugateMatrix', A], 'matrix<integer^(2x2)>');
    sound(ce, ['AdjugateMatrix', S], 'matrix<integer^(2x2)>');
    sound(ce, ['AdjugateMatrix', 'q'], 'matrix<integer^(2x2)>');
  });
  test('the adjugate of a 1×1 matrix is [[1]]', () => {
    expect(
      sound(ce, ['AdjugateMatrix', L(L(5))], 'matrix<integer^(1x1)>').toString()
    ).toBe('[[1]]');
  });
  test('rational cells give real cells', () => {
    sound(ce, ['AdjugateMatrix', Q], 'matrix<real^(2x2)>');
    sound(
      ce,
      '\\mathrm{AdjugateMatrix}(\\begin{pmatrix}2.0 & \\frac13\\\\ 1 & 3\\end{pmatrix})',
      'matrix<real^(2x2)>'
    );
  });
  test('complex cells give number cells', () => {
    sound(ce, ['AdjugateMatrix', C], 'matrix<2x2>');
  });
  test('a matrix of known unequal extents declines', () => {
    expect(sound(ce, ['AdjugateMatrix', R], 'matrix').operator).toBe(
      'AdjugateMatrix'
    );
  });
});

describe('Kernel', () => {
  const ce = engine();
  test('a basis of vectors with one cell for each column', () => {
    expect(sound(ce, ['Kernel', S], 'list<vector<2>>').toString()).toBe(
      '[[-2,1]]'
    );
    sound(ce, ['Kernel', R], 'list<vector<3>>');
    sound(ce, ['Kernel', L(L(0, 0), L(0, 0))], 'list<vector<2>>');
  });
  test('a matrix of full column rank has an empty kernel', () => {
    expect(sound(ce, ['Kernel', A], 'list<vector<2>>').toString()).toBe('[]');
    sound(ce, ['Kernel', T], 'list<vector<2>>');
  });
  test('a vector is a linear form', () => {
    sound(ce, ['Kernel', L(1, 2, 3)], 'list<vector<3>>');
  });
  test('a scalar', () => {
    expect(sound(ce, ['Kernel', 0], 'list<vector<integer^1>>').toString()).toBe(
      '[[1]]'
    );
    expect(sound(ce, ['Kernel', 5], 'list<vector<integer^1>>').toString()).toBe(
      '[]'
    );
  });
  test('float cells', () => {
    sound(ce, ['Kernel', F], 'list<vector<2>>');
    sound(
      ce,
      ['Kernel', L(L(1.5e308, 1.5e308, 1), L(1.5e308, -1.5e308, 1))],
      'list<vector<3>>'
    );
  });
  test('symbolic cells and a rank-3 tensor decline', () => {
    sound(ce, ['Kernel', L(L('x', 1), L(0, 1))], 'list');
    declines(ce, ['Kernel', Rk3], 'list');
  });
});

describe('MatrixMultiply', () => {
  const ce = engine();
  test('matrix times matrix', () => {
    sound(ce, ['MatrixMultiply', A, A], 'matrix<integer^(2x2)>');
    sound(ce, ['MatrixMultiply', R, T], 'matrix<integer^(2x2)>');
    sound(ce, ['MatrixMultiply', T, R], 'matrix<integer^(3x3)>');
  });
  test('matrix times vector and vector times matrix', () => {
    sound(ce, ['MatrixMultiply', A, L(3, 5)], 'vector<integer^2>');
    sound(ce, ['MatrixMultiply', L(3, 5), R], 'vector<integer^3>');
  });
  test('rational cells give real cells', () => {
    expect(
      sound(ce, ['MatrixMultiply', Q, A], 'matrix<real^(2x2)>').type.toString()
    ).toBe('matrix<rational^(2x2)>');
  });
  test('complex cells give number cells, also after an overflow', () => {
    sound(ce, ['MatrixMultiply', C, A], 'matrix<2x2>');
    const z = ['Complex', 1.5e200, 1.5e200];
    sound(ce, ['MatrixMultiply', L(L(z)), L(L(z))], 'matrix<1x1>');
  });
  test('declared matrices of unknown extents', () => {
    sound(ce, ['MatrixMultiply', 'm', 'm'], 'matrix<integer>');
    sound(ce, ['MatrixMultiply', 'm', L(1, 2, 3)], 'vector<integer>');
  });
  test('an inner extent mismatch declines', () => {
    declines(ce, ['MatrixMultiply', R, A], 'matrix | number | vector');
  });
  test('two vectors give a scalar, their inner product', () => {
    const e = ce.box(['MatrixMultiply', L(1, 2, 3), L(1, 2, 3)]);
    expect(e.type.toString()).toBe('integer');
    expect(e.evaluate().toString()).toBe('14');
    sound(ce, ['MatrixMultiply', L(['Rational', 1, 2], 1), L(1, 3)], 'real');
  });
});

describe('HadamardProduct', () => {
  const ce = engine();
  test('the product has the shape of its operands', () => {
    sound(ce, ['HadamardProduct', A, A], 'matrix<integer^(2x2)>');
    sound(ce, ['HadamardProduct', L(1, 2, 3), L(4, 5, 6)], 'vector<integer^3>');
  });
  test('rational and float cells give real cells', () => {
    sound(ce, ['HadamardProduct', Q, Q], 'matrix<real^(2x2)>');
    sound(ce, ['HadamardProduct', F, F], 'matrix<real^(2x2)>');
  });
  test('complex cells give number cells', () => {
    sound(ce, ['HadamardProduct', C, A], 'matrix<2x2>');
  });
  test('a known extent of one operand is the extent of the result', () => {
    sound(ce, ['HadamardProduct', 'm', A], 'matrix<integer^(2x2)>');
  });
  test('a shape mismatch declines', () => {
    declines(ce, ['HadamardProduct', R, T], 'matrix | vector');
    declines(ce, ['HadamardProduct', A, L(1, 2)], 'matrix | vector');
  });
  test('operands of different tensor dtypes are multiplied cell by cell', () => {
    // A float matrix and a matrix of exact entries have different dtypes.
    // The product used to read its operation from the first operand's field
    // before the two were aligned, which gave `undefined` cells, and reading
    // the type of the value threw a `TypeError` (`elementwise()`,
    // `tensor/tensors.ts`).
    const v = sound(ce, ['HadamardProduct', L(L(0.5, 1), L(1, 3)), A], 'matrix<real^(2x2)>');
    expect(v.evaluate().toString()).toBe('[[0.5,2],[3,12]]');
    const w = sound(ce, ['HadamardProduct', A, L(L(0.5, 1), L(1, 3))], 'matrix<real^(2x2)>');
    expect(w.evaluate().toString()).toBe('[[0.5,2],[3,12]]');
  });
});

describe('RowReduce', () => {
  const ce = engine();
  test('the result has the shape of the operand', () => {
    sound(ce, ['RowReduce', R], 'matrix<2x3>');
    sound(ce, ['RowReduce', T], 'matrix<3x2>');
    sound(ce, ['RowReduce', S], 'matrix<2x2>');
  });
  test('float cells', () => {
    sound(ce, ['RowReduce', F], 'matrix<2x2>');
  });
  test('an overflow in machine precision gives NaN cells', () => {
    expect(sound(ce, ['RowReduce', Big], 'matrix<2x2>').toString()).toContain(
      'NaN'
    );
  });
  test('complex cells stay unevaluated, symbolic cells decline', () => {
    sound(ce, ['RowReduce', C], 'matrix<2x2>');
    sound(ce, ['RowReduce', L(L('x', 1), L(0, 1))], 'matrix');
  });
});

describe('Diagonal', () => {
  const ce = engine();
  test('the diagonal of a matrix', () => {
    sound(ce, ['Diagonal', A], 'vector<integer^2>');
    sound(ce, ['Diagonal', R], 'vector<integer^2>');
    sound(ce, ['Diagonal', 'm'], 'vector<integer>');
  });
  test('the diagonal matrix of a vector', () => {
    sound(ce, ['Diagonal', L(1, 2, 3)], 'matrix<integer^(3x3)>');
    sound(
      ce,
      ['Diagonal', L(['Rational', 1, 2], 'ImaginaryUnit')],
      'matrix<complex^(2x2)>'
    );
  });
  test('a number is returned as is', () => {
    sound(ce, ['Diagonal', 5], 'integer');
    sound(ce, ['Diagonal', 'n'], 'integer');
  });
  test('a vector whose diagonal matrix is lazy declines', () => {
    const v = L(...Array.from({ length: 101 }, (_, i) => i + 1));
    sound(ce, ['Diagonal', v], 'value');
  });
  test('a rank-3 tensor declines', () => {
    declines(ce, ['Diagonal', Rk3], 'value');
  });
});

describe('IdentityMatrix, ZeroMatrix, OnesMatrix', () => {
  const ce = engine();
  test('literal extents', () => {
    sound(ce, ['IdentityMatrix', 3], 'matrix<integer^(3x3)>');
    sound(ce, ['IdentityMatrix', 1], 'matrix<integer^(1x1)>');
    sound(ce, ['ZeroMatrix', 2, 3], 'matrix<integer^(2x3)>');
    sound(ce, ['ZeroMatrix', 3], 'matrix<integer^(3x3)>');
    sound(ce, ['OnesMatrix', 2, 3], 'matrix<integer^(2x3)>');
    sound(ce, ['OnesMatrix', 2], 'matrix<integer^(2x2)>');
  });
  test('the largest eager matrix', () => {
    sound(ce, ['IdentityMatrix', 100], 'matrix<integer^(100x100)>');
    sound(ce, ['ZeroMatrix', 100, 100], 'matrix<integer^(100x100)>');
  });
  test('a lazy matrix declines', () => {
    // The lazy `Tabulate` is typed `list<list<integer>>`, which the declared
    // `matrix` does not admit either.
    expect(ce.box(['IdentityMatrix', 101]).type.toString()).toBe('matrix');
    expect(ce.box(['ZeroMatrix', 100, 101]).type.toString()).toBe('matrix');
    expect(ce.box(['OnesMatrix', 101]).type.toString()).toBe('matrix');
  });
  test('a symbolic or non-positive extent declines', () => {
    declines(ce, ['IdentityMatrix', 'n'], 'matrix');
    declines(ce, ['IdentityMatrix', 0], 'matrix');
    declines(ce, ['ZeroMatrix', 2, 'n'], 'matrix');
    declines(ce, ['OnesMatrix', -1], 'matrix');
  });
});

describe('Eigenvalues, Eigenvectors, Eigen', () => {
  const ce = engine();
  test('an n×n matrix has n eigenvalues', () => {
    sound(ce, ['Eigenvalues', A], 'vector<2>');
    sound(ce, ['Eigenvalues', L(L(5))], 'vector<1>');
    sound(ce, ['Eigenvalues', T4], 'vector<4>');
    sound(ce, ['Eigenvalues', 'm'], 'vector');
  });
  test('the eigenvalues of an integer matrix can be complex', () => {
    sound(ce, ['Eigenvalues', Rot], 'vector<2>');
    sound(ce, ['Eigenvalues', Cyc], 'vector<3>');
  });
  test('an overflow in machine precision gives NaN eigenvalues', () => {
    sound(
      ce,
      [
        'Eigenvalues',
        L(L(1.5e308, 1.5e308, 1), L(1.5e308, -1.5e308, 1), L(1, 2, 3)),
      ],
      'vector<3>'
    );
  });
  test('the eigenvectors of an n×n matrix are n×n', () => {
    sound(ce, ['Eigenvectors', SPD], 'matrix<2x2>');
    sound(ce, ['Eigenvectors', Rot], 'matrix<2x2>');
    sound(ce, ['Eigenvectors', L(L(2, 1), L(0, 2))], 'matrix<2x2>');
    sound(ce, ['Eigenvectors', B3], 'matrix<3x3>');
    sound(ce, ['Eigenvectors', Cyc], 'matrix<3x3>');
  });
  test('Eigen is the pair of both', () => {
    sound(ce, ['Eigen', SPD], 'tuple<vector<2>, matrix<2x2>>');
    sound(ce, ['Eigen', L(L(5))], 'tuple<vector<1>, matrix<1x1>>');
    sound(ce, ['Eigen', T4], 'tuple<vector<4>, matrix<4x4>>');
  });
  test('NaN cells decline', () => {
    sound(ce, ['Eigenvalues', N], 'list');
    sound(ce, ['Eigen', N], 'tuple');
  });
  test('a non-square matrix declines', () => {
    declines(ce, ['Eigenvalues', R], 'list');
    declines(ce, ['Eigenvectors', R], 'list');
    declines(ce, ['Eigen', R], 'tuple');
  });
});

describe('LUDecomposition, QRDecomposition, CholeskyDecomposition', () => {
  const ce = engine();
  test('LU of an n×n matrix', () => {
    sound(
      ce,
      ['LUDecomposition', A],
      'tuple<matrix<integer^(2x2)>, matrix<2x2>, matrix<2x2>>'
    );
    sound(
      ce,
      ['LUDecomposition', B3],
      'tuple<matrix<integer^(3x3)>, matrix<3x3>, matrix<3x3>>'
    );
    sound(
      ce,
      ['LUDecomposition', L(L(5))],
      'tuple<matrix<integer^(1x1)>, matrix<1x1>, matrix<1x1>>'
    );
  });
  test('an overflow in machine precision gives an infinite cell', () => {
    expect(
      sound(
        ce,
        ['LUDecomposition', Big],
        'tuple<matrix<integer^(2x2)>, matrix<2x2>, matrix<2x2>>'
      ).toString()
    ).toContain('oo');
  });
  test('QR of an m×n matrix', () => {
    sound(ce, ['QRDecomposition', A], 'tuple<matrix<2x2>, matrix<2x2>>');
    sound(ce, ['QRDecomposition', R], 'tuple<matrix<2x2>, matrix<2x3>>');
    sound(ce, ['QRDecomposition', T], 'tuple<matrix<3x3>, matrix<3x2>>');
    sound(ce, ['QRDecomposition', C], 'tuple<matrix<2x2>, matrix<2x2>>');
  });
  test('Cholesky of an n×n matrix', () => {
    sound(ce, ['CholeskyDecomposition', SPD], 'matrix<2x2>');
    sound(ce, ['CholeskyDecomposition', S], 'matrix<2x2>');
    sound(ce, ['CholeskyDecomposition', L(L(5))], 'matrix<1x1>');
    sound(ce, ['CholeskyDecomposition', C], 'matrix<2x2>');
  });
  test('a matrix that is not positive definite is an error', () => {
    // The declared `matrix` does not admit the error either.
    const e = ce.box(['CholeskyDecomposition', A]);
    expect(e.type.toString()).toBe('matrix<2x2>');
    expect(e.evaluate().operator).toBe('Error');
  });
  test('a non-square matrix declines', () => {
    declines(ce, ['LUDecomposition', R], 'tuple');
    declines(ce, ['CholeskyDecomposition', R], 'matrix');
  });
});

describe('SingularValues', () => {
  const ce = engine();
  test('an m×n matrix has min(m, n) singular values', () => {
    sound(ce, ['SingularValues', A], 'vector<2>');
    sound(ce, ['SingularValues', R], 'vector<2>');
    sound(ce, ['SingularValues', T], 'vector<2>');
    sound(
      ce,
      ['SingularValues', L(L(1.5, 2, 3, 4), L(4, 5, 6, 7), L(7, 8, 10, 1))],
      'vector<3>'
    );
  });
  test('an exact 3×3 matrix stays unevaluated', () => {
    expect(sound(ce, ['SingularValues', B3], 'vector<3>').operator).toBe(
      'SingularValues'
    );
  });
  test('complex cells', () => {
    sound(ce, ['SingularValues', C], 'vector<2>');
  });
  test('unknown extents', () => {
    sound(ce, ['SingularValues', 'm'], 'vector');
  });
});

describe('CharacteristicPolynomial', () => {
  const ce = engine();
  test('a polynomial in a numeric variable is a number', () => {
    expect(
      sound(ce, ['CharacteristicPolynomial', A], 'number').toString()
    ).toBe('x^2 - 5x - 2');
    sound(ce, ['CharacteristicPolynomial', A, 's'], 'number');
    sound(ce, ['CharacteristicPolynomial', Rot], 'number');
    sound(ce, ['CharacteristicPolynomial', L(L(5))], 'number');
    sound(ce, ['CharacteristicPolynomial', F], 'number');
  });
  test('NaN cells decline', () => {
    sound(ce, ['CharacteristicPolynomial', N], 'expression');
  });
  test('a non-square matrix or a list variable declines', () => {
    declines(ce, ['CharacteristicPolynomial', R], 'expression');
    declines(ce, ['CharacteristicPolynomial', A, 'L'], 'expression');
  });
});
