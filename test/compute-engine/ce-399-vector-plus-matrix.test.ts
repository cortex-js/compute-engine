/**
 * ROADMAP CE-399 (user decision 2026-10-23): a sum of tensors whose shapes
 * nest adds element by element along the first axes on every route.
 *
 * Element `i` of a vector is added to row `i` of a matrix:
 * `[1, 2] + [[1, 2, 3], [4, 5, 6]]` is `[[2, 3, 4], [6, 7, 8]]`. The sum of
 * two list literals was an `incompatible-dimensions` error, while the same
 * sum of symbols that held these values took the element-wise broadcast and
 * gave the matrix, as compiled JavaScript does and as `Less` does on both
 * routes. Shapes that do not nest (`[3]` against `[2, 2]`, `2x2` against
 * `2x3`) are still an error. The static type is the shape of the deepest
 * tensor, not the join `matrix<integer^(2x3)> | vector<integer^2>`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const L = (...xs: unknown[]) => ['List', ...xs];
const M23 = L(L(1, 2, 3), L(4, 5, 6));

function literal(expr: unknown): { value: string; type: string; n: string } {
  const ce = new ComputeEngine();
  const boxed = ce.box(expr as any);
  const value = boxed.evaluate();
  expect(value.type.matches(boxed.type)).toBe(true);
  return {
    value: value.toString(),
    type: boxed.type.toString(),
    n: boxed.N().toString(),
  };
}

function symbols(u: unknown, m: unknown): string {
  const ce = new ComputeEngine();
  ce.declare('U', 'broadcastable<number>');
  ce.declare('M', 'broadcastable<number>');
  ce.assign('U', ce.box(u as any));
  ce.assign('M', ce.box(m as any));
  return ce.box(['Add', 'U', 'M']).evaluate().toString();
}

describe('CE-399: A VECTOR PLUS A MATRIX', () => {
  test('literals add row by row', () => {
    expect(literal(['Add', L(1, 2), M23])).toEqual({
      value: '[[2,3,4],[6,7,8]]',
      type: 'matrix<integer^(2x3)>',
      n: '[[2,3,4],[6,7,8]]',
    });
  });
  test('the order of the operands does not matter', () =>
    expect(literal(['Add', M23, L(1, 2)]).value).toBe('[[2,3,4],[6,7,8]]'));
  test('a difference', () => {
    expect(literal(['Subtract', M23, L(1, 2)]).value).toBe('[[0,1,2],[2,3,4]]');
    expect(literal(['Subtract', L(1, 2), M23]).value).toBe(
      '[[0,-1,-2],[-2,-3,-4]]'
    );
  });
  test('three tensors and a scalar', () =>
    expect(literal(['Add', L(1, 2), 5, M23, L(10, 20)]).value).toBe(
      '[[17,18,19],[31,32,33]]'
    ));
  test('a matrix plus a tensor of rank 3', () =>
    expect(
      literal(['Add', L(L(1, 2), L(3, 4)), L(L(L(1), L(2)), L(L(3), L(4)))])
        .value
    ).toBe('[[[2],[4]],[[6],[8]]]'));
  test('the symbol route gives the same value', () =>
    expect(symbols(L(1, 2), M23)).toBe('[[2,3,4],[6,7,8]]'));
});

describe('CE-399: SHAPES THAT DO NOT NEST ARE AN ERROR', () => {
  test.each([
    [L(1, 2, 3), L(L(1, 2), L(3, 4))],
    [L(1, 2), L(1, 2, 3)],
    [L(L(1, 2), L(3, 4)), M23],
  ])('%j + %j', (a, b) => {
    const ce = new ComputeEngine();
    const value = ce.box(['Add', a, b] as any).evaluate();
    expect(value.operator).toBe('Error');
    expect(value.toString()).toMatch(/incompatible-dimensions/);
  });
});
