import { ComputeEngine } from '../../src/compute-engine';
import type { ExpressionInput } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();

const numeric = (json: ExpressionInput) => ce.expr(json).N();

const ABS_OVER_X: ExpressionInput = ['Divide', ['Abs', 'x'], 'x'];

describe('CE-1852 the numeric value of a Limit with no direction is two-sided', () => {
  test('one-sided limits that differ give NaN', () => {
    expect(numeric(['Limit', ABS_OVER_X, 0]).isNaN).toBe(true);
    expect(numeric(['Limit', ['Floor', 'x'], 2]).isNaN).toBe(true);
    expect(numeric(['Limit', ['Arctan', ['Divide', 1, 'x']], 0]).isNaN).toBe(
      true
    );
  });

  test('the form with a variable is two-sided too', () => {
    expect(numeric(['Limit', ABS_OVER_X, 'x', 0]).isNaN).toBe(true);
  });

  test('a direction selects one side', () => {
    expect(numeric(['Limit', ABS_OVER_X, 0, 1]).re).toBe(1);
    expect(numeric(['Limit', ABS_OVER_X, 0, -1]).re).toBe(-1);
  });

  test('one-sided limits that agree give their value', () => {
    // The symbolic limit gives no value for x·sin(1/x), so the value comes
    // from the samples on both sides.
    const f: ExpressionInput = ['Multiply', 'x', ['Sin', ['Divide', 1, 'x']]];
    expect(ce.expr(['Limit', f, 0]).evaluate().operator).toBe('Limit');
    expect(numeric(['Limit', f, 0]).re).toBeCloseTo(0, 6);
  });

  // The function has no real value on one side of the point, so that side
  // is not a side of the limit.
  test('a function with values on one side only has the limit from that side', () => {
    expect(numeric(['Limit', ['Multiply', 'x', ['Ln', 'x']], 0]).re).toBe(0);
    // √(sin x) is real below 3π and not above. It is real again at 3π + 2π,
    // which is not near the point.
    expect(
      numeric(['Limit', ['Sqrt', ['Sin', 'x']], ['Multiply', 3, 'Pi']]).re
    ).toBeCloseTo(0, 4);
  });

  // x^x has a real value at each negative integer, and at no other negative
  // number near it.
  test('isolated values on a side do not make it a side of the limit', () => {
    expect(numeric(['Limit', ['Power', 'x', 'x'], 0]).re).toBeCloseTo(1, 9);
  });

  // The samples just above 0 are ∞/∞. The limit is 1 from above and 0 from
  // below.
  test('a side whose samples overflow is still a side', () => {
    for (const k of [1, 1000]) {
      const e: ExpressionInput = ['Exp', ['Divide', k, 'x']];
      expect(numeric(['Limit', ['Divide', e, ['Add', 1, e]], 0]).isNaN).toBe(
        true
      );
    }
  });

  test('the two sides of a large limit agree within a relative tolerance', () => {
    const f: ExpressionInput = [
      'Add',
      1e7,
      ['Multiply', 'x', ['Sin', ['Divide', 1, 'x']]],
    ];
    expect(numeric(['Limit', f, 0]).re).toBeCloseTo(1e7, 1);
  });

  test('interpreted samples give the same sides as compiled samples', () => {
    const interpreted = new ComputeEngine();
    interpreted.jit = 'off';
    const n = (json: ExpressionInput) => interpreted.expr(json).N();
    expect(n(['Limit', ABS_OVER_X, 0]).isNaN).toBe(true);
    expect(n(['Limit', ['Multiply', 'x', ['Ln', 'x']], 0]).re).toBe(0);
    expect(n(['Limit', ['Power', 'x', 'x'], 0]).re).toBeCloseTo(1, 9);
  });

  test('a limit at infinity has one side', () => {
    expect(
      numeric(['Limit', ['Divide', ['Abs', 'x'], 'x'], 'NegativeInfinity']).re
    ).toBe(-1);
  });

  test('NLimit with no direction is the limit from above', () => {
    expect(numeric(['NLimit', ABS_OVER_X, 0]).re).toBe(1);
    expect(numeric(['NLimit', ABS_OVER_X, 0, 0]).isNaN).toBe(true);
  });
});
