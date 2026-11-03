import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// ROADMAP CE-616: the scalar route of `Integrate` evaluates a `Sum`, a
// `Product` or a `D` held in the integrand before it integrates, as it does
// for an inner `Integrate`. Before, `∫_0^1 D(x^3, x) dx` and
// `∫_0^1 2·Σ_{k=1}^3 k·x dx` stayed unevaluated under `evaluate()`, where
// `N()` gave 1 and 6. The held operator keeps its binder: the variable of `D`
// is the integration variable, and the index of a `Sum` stays bound in it.

function check(e: Expression, exact: unknown, numeric: number): void {
  expect(e.evaluate().json).toEqual(exact);
  expect(e.N().re).toBeCloseTo(numeric, 10);
}

describe('CE-616: a definite integral evaluates a held Sum, Product or D', () => {
  test('a D in the integrand (MathJSON)', () => {
    const ce = new ComputeEngine();
    check(
      ce.box(['Integrate', ['D', ['Power', 'x', 3], 'x'], ['Limits', 'x', 0, 1]]),
      1,
      1
    );
  });

  test('a D in the integrand (LaTeX)', () => {
    const ce = new ComputeEngine();
    check(ce.parse('\\int_0^1 \\frac{d}{dx}x^3\\,dx'), 1, 1);
  });

  test('a D times a constant', () => {
    const ce = new ComputeEngine();
    check(
      ce.box([
        'Integrate',
        ['Multiply', 2, ['D', ['Power', 'x', 3], 'x']],
        ['Limits', 'x', 0, 1],
      ]),
      2,
      2
    );
  });

  test('a D with respect to a variable other than the integration variable', () => {
    const ce = new ComputeEngine();
    // D(y·z^2, y) is z^2, and ∫_0^1 z^2 dz is 1/3.
    expect(
      ce
        .box([
          'Integrate',
          ['D', ['Multiply', 'y', ['Power', 'z', 2]], 'y'],
          ['Limits', 'z', 0, 1],
        ])
        .evaluate().json
    ).toEqual(['Rational', 1, 3]);
  });

  test('an indefinite integral of a D', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Integrate', ['D', ['Power', 'x', 3], 'x'], 'x']).evaluate().json
    ).toEqual(['Power', 'x', 3]);
  });

  test('a Sum times a constant', () => {
    const ce = new ComputeEngine();
    check(
      ce.parse('\\int_0^1 2\\left(\\sum_{k=1}^3 kx\\right)dx'),
      6,
      6
    );
  });

  test('a Product in the integrand', () => {
    const ce = new ComputeEngine();
    // (1 + x)(2 + x) = x^2 + 3x + 2, and its integral over [0, 1] is 23/6.
    check(
      ce.parse('\\int_0^1 \\left(\\prod_{k=1}^2 (k+x)\\right)dx'),
      ['Rational', 23, 6],
      23 / 6
    );
  });

  test('the index of a Sum has the name of the integration variable', () => {
    const ce = new ComputeEngine();
    // The index `k` of the sum is bound by the sum: Σ_{k=1}^3 k^2 is 14, a
    // constant, and its integral over [0, 1] is 14.
    check(
      ce.box([
        'Integrate',
        ['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 3]],
        ['Limits', 'k', 0, 1],
      ]),
      14,
      14
    );
  });

  test('an assigned global with the name of the integration variable', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    check(
      ce.box(['Integrate', ['D', ['Power', 'x', 3], 'x'], ['Limits', 'x', 0, 1]]),
      1,
      1
    );
    check(
      ce.box([
        'Integrate',
        ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 3]],
        ['Limits', 'x', 0, 1],
      ]),
      3,
      3
    );
  });

  test('a Sum times a call of a user function', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.parse('f(t, a) \\coloneq t^2 + a').evaluate();
    // (6x)(x^2 + 1) = 6x^3 + 6x, and its integral over [0, 1] is 9/2.
    check(
      ce.parse('\\int_0^1 \\left(\\sum_{k=1}^3 kx\\right) f(x, 1)\\,dx'),
      ['Rational', 9, 2],
      4.5
    );
    ce.assign('E', ce.box(['List', 1, 2]));
    expect(
      ce
        .parse('\\int_0^1 \\left(\\sum_{k=1}^3 kx\\right) f(x, E)\\,dx')
        .evaluate().json
    ).toEqual(['List', ['Rational', 9, 2], ['Rational', 15, 2]]);
  });

  test('a Sum with a bound that reads the integration variable stays held', () => {
    const ce = new ComputeEngine();
    // The evaluation of the sum floors the bound `x`, so the integrand is a
    // step function: 0 on [0, 1), 1/2 on [1, 2), 2/3 on [2, 3), and the
    // integral is 7/6. The closed form `1 − 1/(x+1)` of the sum would give
    // 3 − ln 4 ≈ 1.614.
    const I = ce.box([
      'Integrate',
      [
        'Sum',
        ['Subtract', ['Divide', 1, 'k'], ['Divide', 1, ['Add', 'k', 1]]],
        ['Limits', 'k', 1, 'x'],
      ],
      ['Limits', 'x', 0, 3],
    ]);
    const value = I.evaluate();
    expect(value.operator).toBe('Integrate');
    expect(value.has('Ln')).toBe(false);
    expect(I.N().re).toBeCloseTo(7 / 6, 8);
  });

  test('a Sum with a bound whose value does not read the integration variable', () => {
    const ce = new ComputeEngine();
    // The bound D(x, x) is the constant 1, so the sum is k·x for k = 1, which
    // is x, and ∫_0^1 x dx is 1/2.
    const bounded = (bound: unknown) =>
      ce.box([
        'Integrate',
        ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, bound as any]],
        ['Limits', 'x', 0, 1],
      ]);
    check(bounded(['D', 'x', 'x']), ['Rational', 1, 2], 0.5);
    // A bound with `x` bound inside a nested sum: Σ_{x=1}^{2} 1 is 2, and
    // ∫_0^1 (x + 2x) dx is 3/2.
    check(
      bounded(['Sum', 1, ['Limits', 'x', 1, 2]]),
      ['Rational', 3, 2],
      1.5
    );
  });

  test('a Sum or a D in a Hold stays held', () => {
    const ce = new ComputeEngine();
    // x·Hold(Σ_{k=1}^3 k): the content of `Hold` is not evaluated.
    expect(
      ce
        .box([
          'Integrate',
          ['Multiply', 'x', ['Hold', ['Sum', 'k', ['Limits', 'k', 1, 3]]]],
          ['Limits', 'x', 0, 1],
        ])
        .evaluate().json
    ).toEqual([
      'Multiply',
      ['Rational', 1, 2],
      ['Hold', ['Sum', 'k', ['Limits', 'k', 1, 3]]],
    ]);
    const value = ce
      .box([
        'Integrate',
        ['Hold', ['D', ['Power', 'x', 3], 'x']],
        ['Limits', 'x', 0, 1],
      ])
      .evaluate();
    expect(value.operator).toBe('Integrate');
    expect(value.has('Hold')).toBe(true);
    expect(value.has('D')).toBe(true);
  });

  test('an infinite series is still integrated term by term', () => {
    const ce = new ComputeEngine();
    // Σ_{n=0}^∞ n·x^n evaluates to the conditional `If(|x| < 1,
    // x/(1 − x)^2)`, which is not used: the series rules integrate the held
    // sum, and ∫_0^{1/2} Σ n·x^n dx is 1 + ln(1/2).
    check(
      ce.box([
        'Integrate',
        [
          'Sum',
          ['Multiply', 'n', ['Power', 'x', 'n']],
          ['Limits', 'n', 0, 'PositiveInfinity'],
        ],
        ['Limits', 'x', 0, ['Rational', 1, 2]],
      ]),
      ['Add', 1, ['Ln', ['Rational', 1, 2]]],
      1 - Math.log(2)
    );
  });

  test('a Sum with no closed form stays held', () => {
    const ce = new ComputeEngine();
    // The upper bound `n` has no value, and the sum is kept: the integral
    // stays unevaluated.
    const value = ce
      .box([
        'Integrate',
        ['Sum', ['Multiply', 'k', 'y'], ['Limits', 'k', 1, 'n']],
        ['Limits', 'y', 0, 1],
      ])
      .evaluate();
    expect(value.operator).toBe('Integrate');
  });
});

// The numeric route of `Integrate` (`N()`) stayed symbolic for an integrand
// with a free symbol, also when the symbol is the variable of a held `D` whose
// value does not read it: `∫_0^1 D(y·z^2, y) dz` gave no value under `N()`,
// where `evaluate()` gave 1/3. The held operator is now evaluated first on
// this route too.
describe('N() of an integral with a held D whose variable is free', () => {
  const dz = (integrand: unknown, ...limits: unknown[]) =>
    new ComputeEngine().box([
      'Integrate',
      integrand as any,
      ...((limits.length > 0 ? limits : [['Limits', 'z', 0, 1]]) as any[]),
    ]);

  test('a D with respect to a variable other than the integration variable', () => {
    // D(y·z^2, y) is z^2, and ∫_0^1 z^2 dz is 1/3.
    const I = dz(['D', ['Multiply', 'y', ['Power', 'z', 2]], 'y']);
    expect(I.N().re).toBeCloseTo(1 / 3, 10);
    expect(I.evaluate().json).toEqual(['Rational', 1, 3]);
  });

  test('a D times a constant', () => {
    const I = dz([
      'Multiply',
      2,
      ['D', ['Multiply', 'y', ['Power', 'z', 2]], 'y'],
    ]);
    expect(I.N().re).toBeCloseTo(2 / 3, 10);
  });

  test('a double integral', () => {
    // D(y·z^2·w, y) is z^2·w, and ∫_0^2 ∫_0^1 z^2·w dz dw is 2/3.
    const I = dz(
      ['D', ['Multiply', 'y', ['Power', 'z', 2], 'w'], 'y'],
      ['Limits', 'z', 0, 1],
      ['Limits', 'w', 0, 2]
    );
    expect(I.N().re).toBeCloseTo(2 / 3, 10);
  });

  test('an assigned global with the name of the variable of D or of the integral', () => {
    for (const name of ['y', 'z']) {
      const ce = new ComputeEngine();
      ce.assign(name, 5);
      const I = ce.box([
        'Integrate',
        ['D', ['Multiply', 'y', ['Power', 'z', 2]], 'y'],
        ['Limits', 'z', 0, 1],
      ]);
      expect(I.N().re).toBeCloseTo(1 / 3, 10);
    }
  });

  test('a free symbol left in the value of the D stays symbolic', () => {
    // D(a·y·z^2, y) is a·z^2, and `a` has no value.
    const I = dz(['D', ['Multiply', 'a', 'y', ['Power', 'z', 2]], 'y']);
    expect(I.N().operator).toBe('Integrate');
  });

  test('a D in a Hold stays held', () => {
    const value = dz([
      'Hold',
      ['D', ['Multiply', 'y', ['Power', 'z', 2]], 'y'],
    ]).N();
    expect(value.operator).toBe('Integrate');
    expect(value.has('Hold')).toBe(true);
  });

  test('a Sum with a bound that reads the integration variable stays held', () => {
    // D(y·z^2, y) is z^2, whose integral on [0, 3] is 9. The sum
    // Σ_{k=1}^{z} k is kept: its value is a step function of z (0, 1, 3 on
    // [0, 1), [1, 2), [2, 3)), whose integral is 4. Its closed form
    // z(z + 1)/2 would give 27/4.
    const I = dz(
      [
        'Add',
        ['D', ['Multiply', 'y', ['Power', 'z', 2]], 'y'],
        ['Sum', 'k', ['Limits', 'k', 1, 'z']],
      ],
      ['Limits', 'z', 0, 3]
    );
    expect(I.N().re).toBeCloseTo(13, 6);
  });

  test('a free symbol outside the held operators: the Sum is not evaluated', () => {
    // `a` is outside the Sum, so no evaluation of the Sum can remove it. The
    // integral stays symbolic, with the Sum as it was written.
    const value = dz([
      'Multiply',
      'a',
      ['Sum', ['Multiply', 'k', 'z'], ['Limits', 'k', 1, 3]],
    ]).N();
    expect(value.operator).toBe('Integrate');
    expect(value.has('Sum')).toBe(true);
  });

  test('an integrand with an effect is not evaluated before the quadrature', () => {
    // `a` is free and the Sum calls `Random()`: the integral stays symbolic,
    // and the Sum keeps its `Random()`.
    const value = dz([
      'Add',
      'a',
      ['Sum', ['Random'], ['Limits', 'k', 1, 2]],
    ]).N();
    expect(value.operator).toBe('Integrate');
    expect(value.has('Random')).toBe(true);
  });

  test('an effect in the value of a symbol is not run before the quadrature', () => {
    // `r` holds `Random()`: the Sum is impure through `r`, though `isPure`
    // of the integrand is true. `a` is free and inside the Sum, so only an
    // evaluation of the Sum could show whether it stays: the Sum is not
    // evaluated, and no number is drawn.
    const ce = new ComputeEngine();
    ce.declare('r', { value: ce.box(['Random'], { form: 'raw' }) });
    let draws = 0;
    const random = Math.random;
    Math.random = () => {
      draws += 1;
      return random();
    };
    try {
      const value = ce
        .box([
          'Integrate',
          ['Sum', ['Add', 'a', ['Multiply', 'k', 'r']], ['Limits', 'k', 1, 2]],
          ['Limits', 'z', 0, 1],
        ])
        .N();
      expect(value.operator).toBe('Integrate');
    } finally {
      Math.random = random;
    }
    expect(draws).toBe(0);
  });

  test('a Sum and a D in one integrand', () => {
    // Σ_{k=1}^{3} k·z is 6z and D(y·z, y) is z: ∫_0^1 7z dz is 7/2.
    const I = dz([
      'Add',
      ['Sum', ['Multiply', 'k', 'z'], ['Limits', 'k', 1, 3]],
      ['D', ['Multiply', 'y', 'z'], 'y'],
    ]);
    expect(I.N().re).toBeCloseTo(3.5, 10);
  });
});
