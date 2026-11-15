import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.expr>[0];

const derivativeAt = (head: string, n: number, x: Json) =>
  ce.expr(['Apply', ['Derivative', head, n], x]);

// mpmath 1.3.0: `diff(ellipk, 0, n)` and `diff(ellipe, 0, n)`
const K_AT_0 = [
  0.39269908169872415, 0.44178646691106467, 0.92038847273138474,
  2.8186896977398658,
];
const E_AT_0 = [-0.39269908169872415, -0.14726215563702156];

describe('DERIVATIVES OF THE COMPLETE ELLIPTIC INTEGRALS AT m = 0', () => {
  test('K⁽ⁿ⁾(0) is exact', () => {
    expect(derivativeAt('EllipticK', 1, 0).evaluate().json).toEqual([
      'Multiply',
      ['Rational', 1, 8],
      'Pi',
    ]);
    expect(derivativeAt('EllipticK', 2, 0).evaluate().json).toEqual([
      'Multiply',
      ['Rational', 9, 64],
      'Pi',
    ]);
    expect(derivativeAt('EllipticK', 3, 0).evaluate().json).toEqual([
      'Multiply',
      ['Rational', 75, 256],
      'Pi',
    ]);
  });

  test('E⁽ⁿ⁾(0) is exact', () => {
    expect(derivativeAt('EllipticE', 1, 0).evaluate().json).toEqual([
      'Multiply',
      ['Rational', -1, 8],
      'Pi',
    ]);
    expect(derivativeAt('EllipticE', 2, 0).evaluate().json).toEqual([
      'Multiply',
      ['Rational', -3, 64],
      'Pi',
    ]);
  });

  test.each(K_AT_0.map((v, i) => [i + 1, v]))(
    'K⁽%i⁾(0).N() is the mpmath value',
    (n, want) => {
      const got = derivativeAt('EllipticK', n, 0).N().re;
      expect(Math.abs(got - want)).toBeLessThan(1e-15 * Math.abs(want));
    }
  );

  test.each(E_AT_0.map((v, i) => [i + 1, v]))(
    'E⁽%i⁾(0).N() is the mpmath value',
    (n, want) => {
      const got = derivativeAt('EllipticE', n, 0).N().re;
      expect(Math.abs(got - want)).toBeLessThan(1e-15 * Math.abs(want));
    }
  );

  test('a high order is immediate and finite', () => {
    const t = Date.now();
    const r = derivativeAt('EllipticK', 12, 0).N();
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.isFinite).toBe(true);
    expect(r.re).toBeGreaterThan(0);
  });

  test('the value away from 0 is that of the closed form', () => {
    // The closed form (E − (1 − m)K)/(2m(1 − m)), DLMF 19.4.1
    for (const m of [0.3, -2, 0.9, 2]) {
      const closed = ce
        .expr(['D', ['EllipticK', 'x'], 'x'])
        .evaluate()
        .subs({ x: m })
        .N();
      const got = derivativeAt('EllipticK', 1, m).N();
      expect(Math.abs(got.re - closed.re)).toBeLessThan(1e-14);
      expect(Math.abs(got.im - closed.im)).toBeLessThan(1e-14);
    }
  });

  test('the compiled derivative agrees', () => {
    const r = compile(derivativeAt('EllipticK', 2, 'x') as never);
    const run = r.run as unknown as (v: { x: number }) => number;
    const want = derivativeAt('EllipticK', 2, 0.3).N().re;
    expect(Math.abs(run({ x: 0.3 }) - want)).toBeLessThan(1e-14);
  });
});

describe('SERIES OF THE COMPLETE ELLIPTIC INTEGRALS AT 0', () => {
  test('K', () => {
    expect(
      ce
        .expr(['Series', ['EllipticK', 'm'], 'm', 0, 3])
        .evaluate()
        .toString()
    ).toEqual(
      '1/2 * pi + 1/8 * pi * m + 9/128 * pi * m^2 + 25/512 * pi * m^3 + BigO(m^4)'
    );
  });

  test('E', () => {
    expect(
      ce
        .expr(['Series', ['EllipticE', 'm'], 'm', 0, 3])
        .evaluate()
        .toString()
    ).toEqual(
      '1/2 * pi - 1/8 * pi * m - 3/128 * pi * m^2 - 5/512 * pi * m^3 + BigO(m^4)'
    );
  });

  test('composed with an inner series', () => {
    expect(
      ce
        .expr(['Series', ['EllipticK', ['Multiply', 2, 'x']], 'x', 0, 2])
        .evaluate()
        .toString()
    ).toEqual('1/2 * pi + 1/4 * pi * x + 9/32 * pi * x^2 + BigO(x^3)');
  });
});
