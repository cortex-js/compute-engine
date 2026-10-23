import { ComputeEngine } from '../../src/compute-engine';

// Under `.N()`, an integral whose integrand has no value at any sample (a
// selection with no selected arm, `NaN`, arithmetic with `Missing`) is
// `NaN`, as `NIntegrate` and the compiled routes give (user decision
// 2026-10-23, Tycho row 411). Before the decision the `Integrate`
// expression was kept. An integrand that still holds a free symbol stays
// symbolic.

const ce = new ComputeEngine();

const integral = (body: unknown, ...limits: unknown[][]): unknown => [
  'Integrate',
  ['Function', body, ...limits.map((l) => l[0])],
  ...limits.map((l) => ['Limits', ...l]),
];

describe('Integrate(...).N() of an integrand with no value', () => {
  test.each([
    ['Which(t > 5, 1)', ['Which', ['Greater', 't', 5], 1]],
    ['If(t > 5, 1)', ['If', ['Greater', 't', 5], 1]],
    ['t·NaN', ['Multiply', 't', 'NaN']],
    ['t·Missing', ['Multiply', 't', 'Missing']],
  ])('∫₀¹ %s dt is NaN', (_label, body) => {
    expect(ce.box(integral(body, ['t', 0, 1]) as never).N().isNaN).toBe(true);
  });

  test('NIntegrate gives the same answer', () => {
    expect(
      ce
        .box([
          'NIntegrate',
          ['Function', ['Which', ['Greater', 't', 5], 1], 't'],
          0,
          1,
        ])
        .N().isNaN
    ).toBe(true);
  });

  test('the parse route', () => {
    const e = ce.parse(String.raw`\int_0^1 \left\{t > 5: 1\right\} \mathrm{d}t`);
    expect(e.N().isNaN).toBe(true);
  });

  test('a double integral', () => {
    const e = ce.box(
      integral(['Which', ['Greater', 't', 5], 1], ['t', 0, 1], ['s', 0, 1]) as never
    );
    expect(e.N().isNaN).toBe(true);
  });

  test('a free symbol keeps the integral symbolic', () => {
    for (const body of [
      ['Multiply', 't', 'D'],
      ['g', 't'],
    ]) {
      const e = ce.box(integral(body, ['t', 0, 1]) as never).N();
      expect(e.operator).toBe('Integrate');
    }
  });

  test('an integrand with a value on part of the range is unchanged', () => {
    // `Which(t > 1/2, 1)` has no value on [0, 1/2]: the quadrature meets NaN
    // samples and numbers, and the integral is NaN.
    const e = ce.box(
      integral(['Which', ['Greater', 't', ['Rational', 1, 2]], 1], ['t', 0, 1]) as never
    );
    expect(e.N().isNaN).toBe(true);
  });
});
