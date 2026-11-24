/**
 * CE-1329: the sum and the difference of two tensors of rank 3 or more are
 * computed cell by cell, as the sum of two vectors or two matrices is. The
 * kernel `addTensors` built only ranks 1 and 2, and left a sum of higher rank
 * unevaluated: `T - T` stayed `["Add", T, -T]`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const L = (...xs: unknown[]) => ['List', ...xs];
const T = L(L(L(1, 2), L(3, 4)), L(L(5, 6), L(7, 8)));

function value(expr: unknown): string {
  const ce = new ComputeEngine();
  return ce.expr(expr as any).evaluate().toString();
}

describe('CE-1329: THE SUM OF TENSORS OF RANK 3', () => {
  test('the difference of a declared tensor with itself is zero', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'tensor<real^(2x2x2)>');
    const t = ce.expr(T as any);
    expect(
      ce.withValues({ T: t }, () =>
        ce.expr(['Subtract', 'T', 'T']).evaluate().toString()
      )
    ).toBe('[[[0,0],[0,0]],[[0,0],[0,0]]]');
  });

  test('the difference of two literals', () =>
    expect(
      value(['Subtract', T, L(L(L(1, 1), L(1, 1)), L(L(1, 1), L(1, 1)))])
    ).toBe('[[[0,1],[2,3]],[[4,5],[6,7]]]'));

  test('the sum of two literals and a scalar', () =>
    expect(value(['Add', T, T, 1])).toBe(
      '[[[3,5],[7,9]],[[11,13],[15,17]]]'
    ));

  test('an exact cell stays exact and a float cell stays a float', () => {
    const ce = new ComputeEngine();
    const U = L(L(L(1.5, 0), L(0, 0)), L(L(0, 0), L(0, ['Sqrt', 2])));
    const sum = ce.expr(['Add', T, U] as any);
    expect(sum.evaluate().toString()).toBe(
      '[[[2.5,2],[3,4]],[[5,6],[7,8 + sqrt(2)]]]'
    );
    expect(sum.N().toString()).toBe(
      '[[[2.5,2],[3,4]],[[5,6],[7,9.4142135623730950488]]]'
    );
  });

  test('a tensor of rank 4', () =>
    expect(value(['Add', L(L(L(L(1, 2)))), L(L(L(L(10, 20))))])).toBe(
      '[[[[11,22]]]]'
    ));

  test('shapes that differ are an error', () =>
    expect(
      value(['Add', T, L(L(L(1, 2, 3), L(3, 4, 5)), L(L(5, 6, 7), L(7, 8, 9)))])
    ).toBe('Error("incompatible-dimensions", "2x2x2 vs 2x2x3")'));
});
