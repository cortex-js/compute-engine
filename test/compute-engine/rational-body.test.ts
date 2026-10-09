import { engine as ce } from '../utils';
import {
  hasIntegerRootFrom,
  rationalPartsAsWritten,
  reducedRationalBody,
  repeatedLinearFactor,
  sameRationalFunction,
} from '../../src/compute-engine/boxed-expression/rational-body';

describe('rationalPartsAsWritten', () => {
  test('keeps a common factor of numerator and denominator', () => {
    const [num, den] = rationalPartsAsWritten(
      ce.parse('\\frac{(k-5)(k^2-1)}{(k-5)k^2}')
    )!;
    expect(num.has('k')).toBe(true);
    // Each part still has the factor (k − 5): zero at k = 5.
    expect(num.subs({ k: 5 }).evaluate().json).toEqual(0);
    expect(den.subs({ k: 5 }).evaluate().json).toEqual(0);
  });

  test('reads a negative power as a denominator', () => {
    const [num, den] = rationalPartsAsWritten(ce.parse('1 - k^{-2}'))!;
    expect(num.subs({ k: 2 }).evaluate().json).toEqual(3);
    expect(den.subs({ k: 2 }).evaluate().json).toEqual(4);
  });

  test('declines a non-rational expression', () => {
    expect(rationalPartsAsWritten(ce.parse('\\sqrt{k}'))).toBeUndefined();
    expect(rationalPartsAsWritten(ce.parse('\\sin k'))).toBeUndefined();
  });
});

describe('hasIntegerRootFrom', () => {
  // Coefficients are listed from the constant term up.
  test('finds an integer root at or above the start', () => {
    // (k − 4)(k + 1) = k² − 3k − 4
    expect(hasIntegerRootFrom([-4, -3, 1], 1)).toBe(true);
    expect(hasIntegerRootFrom([-4, -3, 1], 5)).toBe(false);
    expect(hasIntegerRootFrom([-4, -3, 1], -Infinity)).toBe(true);
  });

  test('a polynomial with no integer root', () => {
    // 4k² − 1 has the roots ±1/2; k² + 1 has none.
    expect(hasIntegerRootFrom([-1, 0, 4], 1)).toBe(false);
    expect(hasIntegerRootFrom([1, 0, 1], -Infinity)).toBe(false);
  });

  test('a bound past 2^53 is declined', () => {
    expect(hasIntegerRootFrom([2 ** 53, 1], 2 ** 53 - 1)).toBeUndefined();
  });

  test('the zero polynomial and a constant', () => {
    expect(hasIntegerRootFrom([0], 1)).toBeUndefined();
    expect(hasIntegerRootFrom([3], 1)).toBe(false);
  });
});

describe('reducedRationalBody', () => {
  test('reduces k/k³ to k⁻²', () => {
    expect(
      reducedRationalBody(ce.parse('\\frac{k}{k^3}'), 'k', 1)!.json
    ).toEqual(['Power', 'k', -2]);
  });

  test('declines a 0/0 factor and a pole in the domain', () => {
    expect(
      reducedRationalBody(ce.parse('\\frac{(k-5)(k^2-1)}{(k-5)k^2}'), 'k', 2)
    ).toBeUndefined();
    expect(
      reducedRationalBody(ce.parse('\\frac{1}{(k-5)^2}'), 'k', 1)
    ).toBeUndefined();
    // The same hole below the domain is harmless.
    expect(
      reducedRationalBody(ce.parse('\\frac{(k-5)(k^2-1)}{(k-5)k^2}'), 'k', 6)
    ).toBeDefined();
  });

  test('declines a non-rational or impure body', () => {
    expect(
      reducedRationalBody(ce.parse('\\frac{\\sin k}{k}'), 'k', 1)
    ).toBeUndefined();
    expect(
      reducedRationalBody(
        ce.parse('\\frac{k+\\operatorname{Random}()}{k}'),
        'k',
        1
      )
    ).toBeUndefined();
  });
});

describe('sameRationalFunction', () => {
  test('polynomials that are zero at a sample index still compare', () => {
    expect(
      sameRationalFunction(
        ce.parse('k(k-2)(k-3)(k-7)'),
        ce.parse('k^4-12k^3+41k^2-42k'),
        'k'
      )
    ).toBe(true);
  });

  test('three spellings of the Wallis body', () => {
    const pattern = ce.parse('1 - \\frac{1}{(2k)^2}');
    for (const s of [
      '\\frac{4k^2-1}{4k^2}',
      '1 - \\frac{1}{4k^2}',
      '\\frac{(2k-1)(2k+1)}{4k^2}',
    ])
      expect(sameRationalFunction(ce.parse(s), pattern, 'k')).toBe(true);
    expect(
      sameRationalFunction(ce.parse('\\frac{4k^2+1}{4k^2}'), pattern, 'k')
    ).toBe(false);
  });
});

describe('repeatedLinearFactor', () => {
  test('4k² + 4k + 1 = 4(k + 1/2)²', () => {
    const f = repeatedLinearFactor(ce.parse('4k^2+4k+1'), 'k')!;
    expect(f.c.json).toEqual(4);
    expect(f.r).toBeCloseTo(-0.5, 12);
    expect(f.s).toBe(2);
  });

  test('(k − 2)³ expanded', () => {
    const f = repeatedLinearFactor(ce.parse('k^3-6k^2+12k-8'), 'k')!;
    expect(f.c.json).toEqual(1);
    expect(f.r).toBeCloseTo(2, 12);
    expect(f.s).toBe(3);
  });

  test('an approximate repeated factor is not one', () => {
    expect(
      repeatedLinearFactor(ce.parse('k^2+2k+1.0000000001'), 'k')
    ).toBeUndefined();
    expect(
      repeatedLinearFactor(
        ce.parse('k^2+2k+\\frac{10000000001}{10000000000}'),
        'k'
      )
    ).toBeUndefined();
  });

  test('two distinct roots are not a repeated factor', () => {
    expect(repeatedLinearFactor(ce.parse('k^2+k'), 'k')).toBeUndefined();
    expect(repeatedLinearFactor(ce.parse('k^2+1'), 'k')).toBeUndefined();
  });
});
