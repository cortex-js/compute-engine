import { ComputeEngine } from '../../src/compute-engine';

//
// Issue #449: `At(xs, i)` over a collection of INFINITE count whose `at`
// handler declines a position is not a provable miss, so the read stays
// unevaluated. `isProvablyOutOfRange` (`library/collections.ts`) took any
// count that was not `NaN` as a proof, and an infinite count passed, so the
// read was `NaN`. A position outside a FINITE count is still `NaN`
// (`docs/ERROR-MODEL.md` §5).
//

function engineWithSquares(): ComputeEngine {
  const ce = new ComputeEngine();
  // `Sq(1)` enumerates the squares; its `at` handler gives up past 1000.
  ce.declare('Sq', {
    signature: '(integer) -> list<integer>',
    collection: {
      iterator: () => {
        let i = 0;
        return { next: () => ({ value: ce.number(++i * i), done: false }) };
      },
      count: () => Infinity,
      at: (_e, i) =>
        typeof i !== 'number' || i < 1 || i > 1000
          ? undefined
          : ce.number(i * i),
    },
  });
  return ce;
}

describe('At over a collection of infinite count whose handler declines', () => {
  test('a position the handler answers', () => {
    const ce = engineWithSquares();
    expect(ce.box(['At', ['Sq', 1], 5]).evaluate().json).toBe(25);
  });

  test('a position the handler declines stays unevaluated', () => {
    const ce = engineWithSquares();
    const e = ce.box(['At', ['Sq', 1], 5000]).evaluate();
    expect(e.json).toEqual(['At', ['Sq', 1], 5000]);
    expect(e.isNaN).not.toBe(true);
  });

  test('a position counted from the end is NaN: an infinite collection has no last element', () => {
    const ce = engineWithSquares();
    expect(ce.box(['At', ['Sq', 1], -1]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Last', ['Sq', 1]]).evaluate().isNaN).toBe(true);
  });

  test('a Range with an infinite lower bound produces no elements: its first position is NaN', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['At', ['Range', 'NegativeInfinity', -1], 1]).evaluate().isNaN
    ).toBe(true);
  });

  test('the count is still infinite', () => {
    const ce = engineWithSquares();
    expect(ce.box(['Count', ['Sq', 1]]).evaluate().json).toBe(
      'PositiveInfinity'
    );
  });

  test('a position outside a finite count is still NaN', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['At', ['List', 1, 2], 99]).evaluate().isNaN).toBe(true);
  });

  test('a built-in infinite collection still answers its positions', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['At', ['Range', 1, 'PositiveInfinity'], 1e9]).evaluate().json
    ).toBe(1e9);
  });
});
