import { ComputeEngine } from '../../src/compute-engine';

/**
 * CE-80.2. Under `.N()`, the evaluation makes each operand numeric before a
 * statistic's handler runs, so `Range(-17, 0, 1/3)` arrived with the float
 * step `0.333…`. The closed forms of `library/range-closed-form.ts` read an
 * exact range only, so the handler walked the float elements and lost the
 * last digits: `Mean(Range(-17, 0, 1/3)).N()` was `-8.50000000000000060577`.
 * The handlers now read the closed form on the operand as written, as `Sum`
 * does (it holds its operand).
 */

const ce = new ComputeEngine();

const RANGE = ['Range', -17, 0, ['Rational', 1, 3]] as const;

describe('CE-80.2: statistics of an exact Range under .N()', () => {
  test.each([
    ['Sum', '-442'],
    ['Mean', '-8.5'],
    ['Median', '-8.5'],
    // 689/27 and 901/36, made numeric.
    ['Variance', '25.5185185185185185185'],
    ['PopulationVariance', '25.0277777777777777778'],
    // √2067/9 and √901/6, made numeric.
    ['StandardDeviation', '5.05158574296413566463'],
    ['PopulationStandardDeviation', '5.00277700660121146057'],
  ])('%s', (op, expected) => {
    const e = ce.box([op, RANGE]);
    expect(e.N().toString()).toBe(expected);
    // The same value as the numeric approximation of the exact result.
    expect(e.evaluate().N().toString()).toBe(expected);
  });

  test('a symbol that holds the Range', () => {
    ce.assign('r', ce.box(RANGE));
    expect(ce.box(['Mean', 'r']).N().toString()).toBe('-8.5');
    expect(ce.box(['Variance', 'r']).N().toString()).toBe(
      '25.5185185185185185185'
    );
  });

  test('the parse route', () => {
    expect(
      ce.parse('\\operatorname{mean}(\\operatorname{Range}(-17,0,1/3))').N()
        .toString()
    ).toBe('-8.5');
  });

  test('an effectful bound runs once', () => {
    // `next()` returns 4, 8, … on its successive calls. The written operand
    // is impure, so the handler reads the evaluated operand `Range(1, 4)`
    // and does not evaluate `next()` again.
    let calls = 0;
    ce.declare('next', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => {
        calls += 1;
        return ce.number(4 * calls);
      },
    });
    for (const [op, expected] of [
      ['Mean', '2.5'],
      ['Median', '2.5'],
      ['Variance', '1.66666666666666666667'],
      ['StandardDeviation', '1.29099444873580562839'],
    ] as const) {
      calls = 0;
      expect(ce.box([op, ['Range', 1, ['next']]]).N().toString()).toBe(
        expected
      );
      expect(calls).toBe(1);
    }
  });

  test('a Range with too few elements still takes the general route', () => {
    expect(
      ce.box(['StandardDeviation', ['Range', 1, 1]]).N().toString()
    ).toBe('NaN');
  });
});
