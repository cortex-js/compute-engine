import { ComputeEngine } from '../../src/compute-engine';

// CE-1774: at machine precision, a fold of LCM went through doubles above
// 2^53, which have no unit digit, and gave a wrong finite number. The GCD and
// LCM of such a double are NaN (`realGcd`, `realLcm` in
// src/compute-engine/numerics/numeric.ts), and a fold that gives NaN is
// computed again exactly (`withExactFoldFallback`).

// lcm(1, ..., 100) = 69720375229712477164533808935312303556800
const LCM_1_TO_100 = 6.97203752297124771645e40;

function lcmFold(precision: number | 'machine', n: number) {
  const ce = new ComputeEngine();
  ce.precision = precision;
  return ce
    .box([
      'N',
      ['Reduce', ['Range', 1, n], ['Function', ['LCM', 'u', 'v'], 'u', 'v'], 1],
    ])
    .evaluate();
}

describe('CE-1774: an LCM fold at machine precision', () => {
  test.each([['machine' as const], [15]])(
    'the fold of LCM over 1..100 at precision %s is lcm(1, ..., 100)',
    (precision) => {
      const value = lcmFold(precision, 100).re;
      expect(Math.abs(value / LCM_1_TO_100 - 1)).toBeLessThan(1e-12);
      // The value that the Tycho notebook shows: ln(lcm(1, ..., 100)).
      expect(Math.log(value)).toBeCloseTo(94.04531123, 7);
    }
  );

  test('the fold to 60 at machine precision is lcm(1, ..., 60)', () => {
    const value = lcmFold('machine', 60).re;
    expect(Math.abs(value / 9.6907121647772317009128e24 - 1)).toBeLessThan(
      1e-12
    );
  });

  test('a fold that stays below 2^53 keeps its compiled value', () => {
    expect(lcmFold('machine', 40).re).toBe(5342931457063200);
  });
});

describe('CE-1774: the GCD and LCM of a float', () => {
  test('a float above 2^53 gives NaN', () => {
    // A JavaScript number above 2^53 is boxed as an inexact float.
    const ce = new ComputeEngine();
    expect(ce.box(['LCM', 2 ** 60, 3]).evaluate().isNaN).toBe(true);
    expect(ce.box(['GCD', 2 ** 60, 6]).evaluate().isNaN).toBe(true);
  });

  test('a float above 2^53 with a non-integer float keeps the float GCD', () => {
    // Every double above 2^53 is a multiple of 0.5, whatever digits it lost.
    const ce = new ComputeEngine();
    expect(ce.box(['GCD', 1e30, 0.5]).evaluate().re).toBe(0.5);
  });

  test('a float below 2^53 keeps its float value', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\gcd(4.0, 6)').evaluate().re).toBe(2);
    expect(ce.parse('\\operatorname{lcm}(4.0, 6)').evaluate().re).toBe(12);
  });

  test('an exact operand above 2^53 is computed exactly under N', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(
      ce.box(['N', ['GCD', ['Power', 2, 100], ['Power', 6, 50]]]).evaluate().re
    ).toBe(2 ** 50);
  });
});
