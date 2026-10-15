import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import { packTensor } from '../../src/compute-engine/boxed-expression/tensor-view';

// A matrix of numbers is packed into cells of doubles (`float64`, or
// `complex128` for complex entries) before a matrix operator computes. A
// cell does not record whether its entry was exact, so the packed tensor
// records it once for all its cells: when an entry is a float (a number
// literal that is not exact, such as `1.5` or `2.0`), the tensor is a float
// tensor and every cell is read back as a float, also a cell whose value is
// an integer. A tensor computed from a float tensor is a float tensor too.
// Before, a cell with an integer value was read back as an exact integer, so
// `\det([[1.5, 0], [0, 2]])` was the exact `3`.
//
// A matrix of exact entries is not changed: its integer results stay exact.

const ce = new ComputeEngine();

// Every number literal in the expression, with a `~` after a float
function leaves(e: Expression): string {
  if (e.isNumberLiteral) return `${e.toString()}${e.isExact ? '' : '~'}`;
  if (e.ops) return `${e.operator}(${e.ops.map(leaves).join(', ')})`;
  return e.toString();
}

const M: MathJsonExpression = ['List', ['List', 1.5, 0], ['List', 0, 2]];

describe('A MATRIX WITH A FLOAT ENTRY IS A FLOAT TENSOR', () => {
  test.each([
    ['\\det([[1.5,0],[0,2]])', '3~'],
    ['\\operatorname{Trace}([[1.5,0],[0,2.5]])', '4~'],
    ['\\operatorname{Transpose}([[2.0,1.5],[3,4]])', 'List(List(2~, 3~), List(1.5~, 4~))'],
    ['\\det([[1.0+1.0i,0],[0,1.0-1.0i]])', '2~'],
    ['\\operatorname{Transpose}([[1.5+i,0],[0,2]])', 'List(List((1.5 + i)~, 0~), List(0~, 2~))'],
    ['\\operatorname{Inverse}([[2.5,0],[0,0.5]])', 'List(List(0.4~, 0~), List(0~, 2~))'],
    ['[[1.5,0],[0,2]]^2', 'List(List(2.25~, 0~), List(0~, 4~))'],
    ['\\operatorname{Dot}([1.5, 2],[2,1])', '5~'],
  ])('parse: %s', (latex, expected) => {
    expect(leaves(ce.parse(latex).evaluate())).toBe(expected);
    expect(leaves(ce.parse(latex).N())).toBe(expected);
  });

  test.each<[MathJsonExpression, string]>([
    [['Determinant', M], '3~'],
    [['Trace', M], '3.5~'],
    [['Transpose', M], 'List(List(1.5~, 0~), List(0~, 2~))'],
    [['MatrixPower', M, 2], 'List(List(2.25~, 0~), List(0~, 4~))'],
    [['MatrixMultiply', M, M], 'List(List(2.25~, 0~), List(0~, 4~))'],
    [['AdjugateMatrix', M], 'List(List(2~, 0~), List(0~, 1.5~))'],
    [['Reshape', M, ['Tuple', 4]], 'List(1.5~, 0~, 0~, 2~)'],
    [['Flatten', M], 'List(1.5~, 0~, 0~, 2~)'],
    [['Dot', ['List', 1.5, 2], ['List', 2, 1]], '5~'],
    // The 3×3 determinant is the expansion, the 4×4 one the elimination.
    [
      [
        'Determinant',
        ['List', ['List', 1.5, 0, 0], ['List', 0, 2, 0], ['List', 0, 0, 1]],
      ],
      '3~',
    ],
    [
      [
        'Determinant',
        [
          'List',
          ['List', 1.5, 0, 0, 0],
          ['List', 0, 2, 0, 0],
          ['List', 0, 0, 1, 0],
          ['List', 0, 0, 0, 1],
        ],
      ],
      '3~',
    ],
  ])('box: %j', (json, expected) => {
    expect(leaves(ce.box(json).evaluate())).toBe(expected);
  });

  test('the values are the ones computed in doubles', () => {
    // An independent computation: the determinant of a diagonal matrix is
    // the product of its diagonal, and the inverse of a diagonal matrix is
    // the matrix of the reciprocals.
    expect(ce.box(['Determinant', M]).evaluate().re).toBe(1.5 * 2);
    const inv = ce.box(['Inverse', M]).evaluate();
    expect(inv.ops![0].ops![0].re).toBeCloseTo(1 / 1.5, 15);
    expect(inv.ops![1].ops![1].re).toBe(1 / 2);
  });

  test('the packed tensor and the tensors computed from it hold a float', () => {
    const t = packTensor(ce, ce.box(M))!;
    expect(t.holdsFloat).toBe(true);
    expect(t.transpose()!.holdsFloat).toBe(true);
    expect(t.inverse()!.holdsFloat).toBe(true);
    expect(t.reshape(4).holdsFloat).toBe(true);
    expect(t.slice(1).holdsFloat).toBe(true);
    expect(t.add(t).holdsFloat).toBe(true);
    // A tensor computed from a float tensor and an exact one holds a float
    const exact = packTensor(ce, ce.box(['List', ['List', 1, 0], ['List', 0, 1]]), {
      numeric: true,
    })!;
    expect(exact.holdsFloat).toBe(false);
    expect(exact.add(t).holdsFloat).toBe(true);
  });

  test('a list of machine numbers with a float element', () => {
    const L = ce.list([1.5, 2]);
    expect(
      leaves(ce.function('Dot', [L, ce.list([2, 1])]).evaluate())
    ).toBe('5~');
  });

  test('an element-wise operation keeps the exactness of each element', () => {
    // `Add` and `Multiply` over lists are element-wise: each element of the
    // result follows its own operands. A float operand makes the element a
    // float, an exact element stays exact.
    expect(leaves(ce.box(['Add', M, M]).evaluate())).toBe(
      'List(List(3~, 0), List(0, 4))'
    );
    expect(leaves(ce.box(['Multiply', 2, M]).evaluate())).toBe(
      'List(List(3~, 0), List(0, 4))'
    );
  });
});

describe('A MATRIX OF EXACT ENTRIES IS NOT CHANGED', () => {
  test.each([
    ['\\det([[1,2],[3,4]])', '-2'],
    ['\\operatorname{Trace}([[1,2],[3,4]])', '5'],
    ['\\operatorname{Transpose}([[1,2],[3,4]])', 'List(List(1, 3), List(2, 4))'],
    ['\\operatorname{Inverse}([[2,1],[1,3]])', 'List(List(3/5, -1/5), List(-1/5, 2/5))'],
    ['[[1,2],[3,4]]^2', 'List(List(7, 10), List(15, 22))'],
  ])('%s', (latex, expected) => {
    expect(leaves(ce.parse(latex).evaluate())).toBe(expected);
  });

  test('a matrix of exact integers packed for .N() does not hold a float', () => {
    const t = packTensor(ce, ce.box(['List', ['List', 1, 2], ['List', 3, 4]]), {
      numeric: true,
    })!;
    expect(t.dtype).toBe('float64');
    expect(t.holdsFloat).toBe(false);
    expect(leaves(ce.parse('\\det([[1,2],[3,4]])').N())).toBe('-2');
  });
});
