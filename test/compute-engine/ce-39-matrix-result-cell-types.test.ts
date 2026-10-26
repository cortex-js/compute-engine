/**
 * The result type handlers of `Inverse`, `MatrixPower` and `Determinant`
 * read the cell type of the result from the same table as the other matrix
 * operators
 * (`matrixResultCellType()` in `library/linear-algebra.ts`). That table
 * never claims `rational` for a product or a quotient of cells, because a
 * cell typed `integer` can be a float with an integer value: `2.0` and
 * `1.5e308` are typed `integer`. The typing of a float literal does not
 * change.
 *
 * Before the change, `Inverse([[2.0, 1], [1, 3]])` was typed
 * `matrix<rational^(2x2)>` and its value `matrix<real^(2x2)>`, and
 * `Determinant([[2.0, 1/3], [1, 3]])` was typed `rational` and its value
 * was a float.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';
import { isSubtype } from '../../src/common/type/subtype';

const ce = new ComputeEngine();

/** The static type, after a check that the value is a member of it. */
function typeOf(expr: Expression): string {
  const value = expr.evaluate();
  expect(isSubtype(value.type.type, expr.type.type)).toBe(true);
  return expr.type.toString();
}

const box = (json: MathJsonExpression) => typeOf(ce.box(json));

const FLOAT_INT: MathJsonExpression = [
  'List',
  ['List', { num: '2.0' }, 1],
  ['List', 1, 3],
];
const FLOAT_RATIONAL: MathJsonExpression = [
  'List',
  ['List', { num: '2.0' }, ['Rational', 1, 3]],
  ['List', 1, 3],
];
const INTEGER: MathJsonExpression = ['List', ['List', 2, 1], ['List', 1, 3]];
const RATIONAL: MathJsonExpression = [
  'List',
  ['List', ['Rational', 1, 2], 1],
  ['List', 1, 3],
];
const LARGE: MathJsonExpression = [
  'List',
  ['List', { num: '1.5e308' }, 0],
  ['List', 0, { num: '1.5e308' }],
];
const SUBNORMAL: MathJsonExpression = [
  'List',
  ['List', { num: '1.5e-320' }, 0],
  ['List', 0, 1],
];
const SYMBOLIC: MathJsonExpression = [
  'List',
  ['List', 'x', 1],
  ['List', 1, 3],
];

describe('MATRIX RESULT CELL TYPES: INVERSE AND NEGATIVE MATRIX POWERS', () => {
  test('a float cell with an integer value gives real cells', () => {
    expect(box(['Inverse', FLOAT_INT])).toBe('matrix<real^(2x2)>');
    expect(box(['MatrixPower', FLOAT_INT, -1])).toBe('matrix<real^(2x2)>');
    expect(box(['MatrixPower', FLOAT_INT, -2])).toBe('matrix<real^(2x2)>');
    expect(box(['Inverse', FLOAT_RATIONAL])).toBe('matrix<real^(2x2)>');
    expect(box(['Inverse', LARGE])).toBe('matrix<real^(2x2)>');
  });

  test('an exact matrix gives real cells too', () => {
    expect(box(['Inverse', INTEGER])).toBe('matrix<real^(2x2)>');
    expect(box(['Inverse', RATIONAL])).toBe('matrix<real^(2x2)>');
    expect(box(['MatrixPower', INTEGER, -2])).toBe('matrix<real^(2x2)>');
  });

  test('a real cell can be subnormal: no cell tier is claimed', () => {
    // The value is `[[+oo, 0], [0, 1]]`.
    expect(box(['Inverse', SUBNORMAL])).toBe('matrix<2x2>');
    expect(box(['MatrixPower', SUBNORMAL, -1])).toBe('matrix<2x2>');
  });

  test('a symbolic matrix keeps the shape only', () => {
    expect(box(['Inverse', SYMBOLIC])).toBe('matrix<2x2>');
    expect(box(['MatrixPower', SYMBOLIC, -1])).toBe('matrix<2x2>');
  });

  test('the parse route agrees with the box route', () => {
    const latex =
      '\\begin{pmatrix}2.0 & 1\\\\ 1 & 3\\end{pmatrix}^{-1}';
    expect(typeOf(ce.parse(latex))).toBe('matrix<real^(2x2)>');
    expect(
      typeOf(
        ce.parse(
          '\\operatorname{Inverse}(\\lbrack\\lbrack 2.0,1\\rbrack,\\lbrack 1,3\\rbrack\\rbrack)'
        )
      )
    ).toBe('matrix<real^(2x2)>');
  });
});

describe('MATRIX RESULT CELL TYPES: NON-NEGATIVE MATRIX POWERS', () => {
  test('integer cells stay integer, including float cells', () => {
    expect(box(['MatrixPower', INTEGER, 2])).toBe('matrix<integer^(2x2)>');
    expect(box(['MatrixPower', FLOAT_INT, 2])).toBe('matrix<integer^(2x2)>');
    expect(box(['MatrixPower', LARGE, 2])).toBe('matrix<integer^(2x2)>');
  });

  test('rational cells give real cells', () => {
    expect(box(['MatrixPower', RATIONAL, 2])).toBe('matrix<real^(2x2)>');
    // The value is `[[4.333…, 1.666…], [5, 28/3]]`.
    expect(box(['MatrixPower', FLOAT_RATIONAL, 2])).toBe('matrix<real^(2x2)>');
  });
});

describe('MATRIX RESULT CELL TYPES: DETERMINANT', () => {
  test('integer cells give an integer, including float cells', () => {
    expect(box(['Determinant', INTEGER])).toBe('integer');
    expect(box(['Determinant', FLOAT_INT])).toBe('integer');
    expect(box(['Determinant', LARGE])).toBe('integer');
  });

  test('rational cells give a real', () => {
    // The value is the float `5.666…`.
    expect(box(['Determinant', FLOAT_RATIONAL])).toBe('real');
    expect(box(['Determinant', RATIONAL])).toBe('real');
  });

  test('a symbolic matrix declines to the declared number', () => {
    expect(box(['Determinant', SYMBOLIC])).toBe('number');
  });

  test('the parse route agrees with the box route', () => {
    expect(
      typeOf(
        ce.parse(
          '\\det\\begin{pmatrix}2.0 & \\frac13\\\\ 1 & 3\\end{pmatrix}'
        )
      )
    ).toBe('real');
  });
});
