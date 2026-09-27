/**
 * The `.N()` of an infinite sum or product is extrapolated from the partial
 * sums after 1, 2, 4, 8, … steps (`acceleratedInfiniteSum` and
 * `acceleratedInfiniteProduct` in `library/utils.ts`). Those samples all have
 * the same parity, so a series whose terms alternate without tending to 0
 * looked converged: `Σ_{k≥1} (−1)^k` gave −1, `Σ_{k≥0} (−1)^k` gave 1, and
 * `Π_{k≥1} 2^((−1)^k)` gave 0.5, although none of them has a limit. The
 * partial sums of the other parity must now agree, and such a series stays
 * unevaluated, as any series whose convergence is not established does.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const INF = { num: '+Infinity' };

describe('AN INFINITE SERIES WITH NO LIMIT STAYS UNEVALUATED UNDER N()', () => {
  test.each([
    ['(-1)^k from 1', ['Sum', ['Power', -1, 'k'], ['Limits', 'k', 1, INF]]],
    ['(-1)^k from 0', ['Sum', ['Power', -1, 'k'], ['Limits', 'k', 0, INF]]],
    [
      'cos(pi k)',
      ['Sum', ['Cos', ['Multiply', 'Pi', 'k']], ['Limits', 'k', 1, INF]],
    ],
    [
      '2^((-1)^k)',
      ['Product', ['Power', 2, ['Power', -1, 'k']], ['Limits', 'k', 1, INF]],
    ],
  ])('%s', (_, expr) => {
    const n = ce.box(expr as never).N();
    expect(n.operator).toBe((expr as string[])[0]);
  });
});

describe('A CONVERGENT INFINITE SERIES KEEPS ITS VALUE UNDER N()', () => {
  test.each([
    ['1/k^2', ['Divide', 1, ['Power', 'k', 2]], 'Sum', Math.PI ** 2 / 6],
    ['(-1)^k/k', ['Divide', ['Power', -1, 'k'], 'k'], 'Sum', -Math.log(2)],
    ['1/2^k', ['Power', 2, ['Negate', 'k']], 'Sum', 1],
    [
      '1 - 1/(4k^2)',
      ['Subtract', 1, ['Divide', 1, ['Multiply', 4, ['Power', 'k', 2]]]],
      'Product',
      2 / Math.PI,
    ],
  ])('%s', (_, body, head, expected) => {
    const n = ce.box([head, body, ['Limits', 'k', 1, INF]] as never).N();
    expect(n.re).toBeCloseTo(expected as number, 9);
  });
});
