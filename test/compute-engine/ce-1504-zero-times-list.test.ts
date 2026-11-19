/**
 * CE-1504: a product of zero, another number and a list or a tuple is a list
 * or a tuple of zeros, as the product of zero and the list is. The fold of the
 * numeric factors kept the scalar `0` for a literal list.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const L = ['List', 2, 4, 8];

describe('CE-1504, zero times a number times a list', () => {
  test.each([
    ['0·L', [0, L], ['List', 0, 0, 0]],
    ['0·2·L', [0, 2, L], ['List', 0, 0, 0]],
    ['L·2·0', [L, 2, 0], ['List', 0, 0, 0]],
    ['0.0·2·L', [0.0, 2, L], ['List', 0, 0, 0]],
    [
      '0·2·a nested list',
      [0, 2, ['List', ['List', 1, 2], ['List', 3, 4]]],
      ['List', ['List', 0, 0], ['List', 0, 0]],
    ],
    ['0·2·a list with NaN', [0, 2, ['List', 1, 'NaN']], ['List', 0, 'NaN']],
    ['0·2·a tuple', [0, 2, ['Tuple', 1, 2]], ['Tuple', 0, 0]],
    ['0·2·NaN·L', [0, 2, 'NaN', ['List', 1, 2]], ['List', 'NaN', 'NaN']],
    ['0·2·∞·L', [0, 2, 'PositiveInfinity', ['List', 1, 2]], ['List', 'NaN', 'NaN']],
    ['0·2·a range', [0, 2, ['Range', 1, 3]], ['List', 0, 0, 0]],
  ])('%s', (_, ops, want) => {
    const e = ce.box(['Multiply', ...ops] as never);
    expect(e.evaluate().json).toEqual(want);
    expect(e.N().json).toEqual(want);
  });

  test('a scalar product with zero is still 0', () => {
    expect(ce.box(['Multiply', 0, 2, 'x'] as never).evaluate().json).toBe(0);
    expect(ce.box(['Multiply', 0, 2, 3] as never).json).toBe(0);
    // A set or an interval is not mapped over.
    expect(ce.box(['Multiply', 0, 2, ['Set', 1, 2]] as never).json).toBe(0);
  });

  test('the mul() method agrees', () => {
    const e = ce.box(0).mul(ce.box(2)).mul(ce.box(L as never));
    expect(e.evaluate().json).toEqual(['List', 0, 0, 0]);
  });
});
