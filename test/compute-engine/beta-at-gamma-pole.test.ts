import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { beta } from '../../src/compute-engine/numerics/special-functions';

//
// `Beta(a, b)` where Γ(a + b) is a pole and Γ(a), Γ(b) are not is 0; a
// positive integer against a negative integer with a + b <= 0 is the finite
// (a−1)!/(b(b+1)…(b+a−1)) on every route.
//
// Reference values: mpmath 1.3.0 (`mpmath.beta`).
//

const ce = new ComputeEngine();

function compiled(args: number[]): number {
  const fn = compile(ce.box(['Beta', 'x', 'y']));
  return fn.run!({ x: args[0], y: args[1] }) as number;
}

const R = (p: number, q: number) => ['Rational', p, q];

describe('BETA AT A GAMMA POLE OF THE SUM', () => {
  const floatPairs: [number, number][] = [
    [-2.5, 0.5],
    [0.5, -0.5],
    [1.5, -2.5],
    [-7.5, 4.5],
    [-0.25, -0.75],
  ];

  test.each(floatPairs)('float pair (%p, %p) is 0 on every route', (a, b) => {
    expect(ce.box(['Beta', a, b]).evaluate().re).toBe(0);
    expect(ce.box(['Beta', a, b]).N().re).toBe(0);
    expect(ce.box(['Beta', a, b], { canonical: false }).evaluate().re).toBe(0);
    expect(compiled([a, b])).toBe(0);
    expect(compiled([b, a])).toBe(0);
    expect(beta(a, b)).toBe(0);
  });

  test('exact rational pairs are 0 under evaluate() and N()', () => {
    for (const pair of [
      [R(-5, 2), R(1, 2)],
      [R(-1, 3), R(1, 3)],
      [R(-7, 3), R(1, 3)],
      [R(1, 2), R(-5, 2)],
    ]) {
      expect(ce.box(['Beta', ...pair]).evaluate().json).toBe(0);
    }
    // `.N()` decides on the operands as written, not as rounded.
    const hp = new ComputeEngine();
    hp.precision = 40;
    for (const pair of [
      [R(-5, 2), R(1, 2)],
      [R(1, 2), R(-5, 2)],
      [R(-7, 3), R(1, 3)],
      [R(-1, 3), R(1, 3)],
      [R(2, 7), R(-30, 7)],
    ]) {
      expect(ce.box(['Beta', ...pair]).N().re).toBe(0);
      expect(hp.box(['Beta', ...pair]).N().re).toBe(0);
    }
  });

  test('a rational pair with a positive sum is off the pole', () => {
    expect(ce.box(['Beta', R(1, 2), R(1, 2)]).evaluate().json).not.toBe(0);
    expect(ce.box(['Beta', R(-5, 2), R(3, 2)]).N().re).toBe(0); // sum -1
    expect(ce.box(['Beta', R(-3, 2), R(5, 2)]).N().re).not.toBe(0); // sum 1
  });

  test('at working precision 50', () => {
    const hp = new ComputeEngine();
    hp.precision = 50;
    expect(hp.box(['Beta', -2.5, 0.5]).N().re).toBe(0);
    expect(hp.box(['Beta', R(-5, 2), R(1, 2)]).N().re).toBe(0);
    // Off the pole: mpmath beta(-2.5, 0.75) = -0.4193490821574573
    expect(hp.box(['Beta', -2.5, 0.75]).N().re).toBeCloseTo(
      -0.4193490821574573,
      12
    );
  });

  test('a float pair whose double sum is not an integer is off the pole', () => {
    // mpmath on the doubles: beta(-2.3, 0.3) ≈ -1.4e-15, not 0.
    const v = beta(-2.3, 0.3);
    expect(v).not.toBe(0);
    expect(Math.abs(v)).toBeLessThan(1e-13);
    expect(beta(-2.5, 0.75)).toBeCloseTo(-0.4193490821574573, 12);
  });

  test('an integer operand is not claimed to be 0', () => {
    expect(ce.box(['Beta', -1, 2]).evaluate().isSame(ce.ComplexInfinity)).toBe(
      true
    );
    expect(ce.box(['Beta', -2, 2]).evaluate().json).toEqual(['Rational', 1, 2]);
  });
});

describe('BETA OF A POSITIVE INTEGER AND A NEGATIVE INTEGER, COMPILED', () => {
  // mpmath: beta(2, -3) = 1/6, beta(3, -3) = -1/3, beta(1, -4) = -1/4
  const rows: [number, number, number][] = [
    [2, -3, 1 / 6],
    [3, -3, -1 / 3],
    [1, -4, -1 / 4],
    [4, -7, 1 / 140],
  ];
  test.each(rows)('Beta(%p, %p)', (a, b, expected) => {
    expect(compiled([a, b])).toBeCloseTo(expected, 14);
    expect(compiled([b, a])).toBeCloseTo(expected, 14);
    expect(beta(a, b)).toBeCloseTo(expected, 14);
    expect(ce.box(['Beta', a, b]).N().re).toBeCloseTo(expected, 14);
  });

  test('a true pole stays a non-finite value', () => {
    // Beta(2, -1): a + b = 1, Γ(-1) is a pole with nothing to cancel it.
    expect(Number.isFinite(compiled([2, -1]))).toBe(false);
  });
});

describe('INCOMPLETE BETA PATHS DO NOT DIVIDE BY A ZERO BETA', () => {
  test('BetaRegularized and Beta(z, a, b) decline where B(a, b) = 0', () => {
    for (const head of ['BetaRegularized', 'Beta']) {
      for (const [a, b] of [
        [-2.5, 0.5],
        [0.5, -0.5],
      ]) {
        const x = ce.box([head, 0.3, a, b]);
        expect(x.evaluate().operator).toBe(head);
        expect(x.N().operator).toBe(head);
      }
    }
  });
});
