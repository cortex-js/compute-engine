/**
 * ROADMAP CE-398 (Tycho row 430): the type of an element-wise application
 * over an operand whose values are tensors of unknown rank.
 *
 * - A list whose elements are each a number or a tensor
 *   (`list<broadcastable<number>>`, `list<tensor<number>>`) is not one
 *   tensor: two elements can have different ranks (`[1, [2, 3], [[4]]]`).
 *   A broadcast over it pairs its elements with the elements of the other
 *   operands, so each element of the result is a number or a tensor, and the
 *   result is `list<broadcastable<…>>`. It was `list<broadcastable<number> |
 *   list<any>>` (Tycho row 430), and `Sin` of a `list<tensor<number>>` was a
 *   `tensor`, which a list of rows of different ranks is not.
 * - An operand typed `broadcastable<number>` may hold a tensor of any rank,
 *   and a broadcast then maps the other operands against it. Beside a
 *   vector, the result was typed with the shape of the vector (`U + B` was
 *   `vector<3>`, a 3 by 2 matrix when `B` holds one), and `U·B` had the
 *   cells of `U` (`real`, while `B` may be complex).
 *
 * Each case checks that the evaluated value is a value of the static type.
 */
import { ComputeEngine } from '../../src/compute-engine';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('U', 'vector<real^3>');
  ce.declare('L', 'list<real>');
  ce.declare('M', 'list<broadcastable<number>>');
  ce.declare('T', 'list<tensor<number>>');
  ce.declare('B', 'broadcastable<number>');
  return ce;
}

const VALUES: Record<string, unknown> = {
  U: ['List', 1, 2, 3],
  L: ['List', 1, 2, 3],
  M: ['List', 1, ['List', 2, 3], ['List', ['List', 4]]],
  T: ['List', ['List', 1, 2], ['List', ['List', 3]]],
};

function check(
  expr: unknown,
  expected: string,
  b: unknown,
  value?: string
): void {
  const ce = engine();
  const boxed = ce.box(expr as any);
  expect(boxed.type.toString()).toBe(expected);
  for (const [name, v] of Object.entries(VALUES))
    ce.assign(name, ce.box(v as any));
  ce.assign('B', ce.box(b as any));
  const result = boxed.evaluate();
  if (value !== undefined) expect(result.toString()).toBe(value);
  expect(result.type.matches(boxed.type)).toBe(true);
}

const MATRIX_3X2 = ['List', ['List', 1, 2], ['List', 3, 4], ['List', 5, 6]];

describe('CE-398: A LIST WHOSE ELEMENTS ARE TENSORS OF UNKNOWN RANK', () => {
  test('U + M is a list of broadcastables (Tycho row 430)', () =>
    check(
      ['Add', 'U', 'M'],
      'list<broadcastable<number>>',
      0,
      '[2,[4,5],[[7]]]'
    ));
  test('1 + M', () =>
    check(
      ['Add', 1, 'M'],
      'list<broadcastable<number>>',
      0,
      '[2,[3,4],[[5]]]'
    ));
  test('U - M', () =>
    check(['Subtract', 'U', 'M'], 'list<broadcastable<number>>', 0));
  test('Sin(M)', () => check(['Sin', 'M'], 'list<broadcastable<number>>', 0));
  test('Sin(T) is not one tensor', () =>
    check(['Sin', 'T'], 'list<broadcastable<number>>', 0));
  test('1 + T', () =>
    check(['Add', 1, 'T'], 'list<tensor>', 0, '[[2,3],[[4]]]'));
  test('M < 1', () =>
    check(['Less', 'M', 1], 'list<broadcastable<boolean>>', 0));
  test('a function whose result for one cell may be a tensor', () => {
    // `f(1)` may be `1` and `f(2)` may be `[2, 3]`, so `f([[1, 2]])` can be
    // `[[1, [2, 3]]]`: an element of the value is a nested list whose rows
    // differ in length, which no `broadcastable<number>` holds.
    const ce = engine();
    ce.declare('f', '(number) -> broadcastable<number>');
    expect(ce.box(['f', 'T']).type.toString()).toBe(
      'list<broadcastable<number> | list<any>>'
    );
  });
  test('a sum with a list of rank 1 keeps its type', () =>
    check(['Add', 'U', 'L'], 'list<real>', 0));
});

describe('CE-398: AN OPERAND TYPED broadcastable<number> BESIDE A VECTOR', () => {
  test('U + B, B a matrix', () =>
    check(['Add', 'U', 'B'], 'tensor', MATRIX_3X2, '[[2,3],[5,6],[8,9]]'));
  test('U + B, B a number', () => check(['Add', 'U', 'B'], 'tensor', 1));
  test('L + B, B a matrix', () =>
    check(['Add', 'L', 'B'], 'tensor', MATRIX_3X2));
  test('U < B, B a matrix', () =>
    check(['Less', 'U', 'B'], 'tensor<boolean>', MATRIX_3X2));
  test('U ^ B, B a matrix', () =>
    check(['Power', 'U', 'B'], 'tensor', MATRIX_3X2));
  test('M + B', () =>
    check(['Add', 'M', 'B'], 'list<broadcastable<number>>', 2));
  test('U·B has the cells of B: B = i', () =>
    check(['Multiply', 'U', 'B'], 'tensor', 'ImaginaryUnit', '[i,2i,3i]'));
  test('U·B with B a union that has a broadcastable arm', () => {
    const ce = engine();
    ce.declare('C', 'broadcastable<real> | integer');
    const boxed = ce.box(['Multiply', 'U', 'C']);
    expect(boxed.type.toString()).toBe('tensor<real>');
    ce.assign('U', ce.box(VALUES.U as any));
    ce.assign('C', ce.box(MATRIX_3X2 as any));
    expect(boxed.evaluate().type.matches(boxed.type)).toBe(true);
  });
  test('a float literal that holds an integer makes a rational cell real', () => {
    const ce = engine();
    ce.declare('b', 'broadcastable<rational>');
    const boxed = ce.parse('[1.0, 2] \\times b');
    expect(boxed.type.toString()).toBe('broadcastable<real>');
    ce.assign('b', ce.box(['Rational', 1, 3]));
    expect(boxed.evaluate().type.matches(boxed.type)).toBe(true);
  });
  test('a nested list factor contributes its cells', () => {
    const ce = engine();
    ce.declare('Q', 'matrix<real^(2x2)>');
    ce.declare('N', 'list<list<integer>>');
    ce.declare('R', 'broadcastable<real>');
    const boxed = ce.box(['Multiply', 'Q', 'N', 'R']);
    expect(boxed.type.toString()).toBe('broadcastable<real>');
    ce.assign('Q', ce.box(['List', ['List', 1, 0], ['List', 0, 1]]));
    ce.assign('N', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    ce.assign('R', ce.box(['Rational', 1, 2]));
    const value = boxed.evaluate();
    expect(value.toString()).toBe('[[1/2,1],[3/2,2]]');
    expect(value.type.matches(boxed.type)).toBe(true);
  });
  test('U + 2 keeps the shape of U', () => {
    const ce = engine();
    expect(ce.box(['Add', 'U', 2]).type.toString()).toBe('vector<real^3>');
  });
});
