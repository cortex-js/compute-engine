import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';
import type { ExpressionInput } from '../../src/compute-engine/global-types';
import { differentiate } from '../../src/compute-engine/symbolic/derivative';
import { exactExpression } from '../../src/compute-engine/symbolic/definite-transform';
import { integrateComposition } from '../../src/compute-engine/symbolic/integration-composition';
import { logarithmicParameterDifference } from '../../src/compute-engine/symbolic/integration-logarithmic';
import {
  integrateDiscreteAlgebra,
  integrateDiscreteReciprocal,
} from '../../src/compute-engine/symbolic/definite-discrete-algebra';
import { integratePolynomialSeries } from '../../src/compute-engine/symbolic/definite-series';
import { reduceIntegrationRational } from '../../src/compute-engine/symbolic/integration-rational';
import { continuousRange } from '../../src/compute-engine/symbolic/definite-integrate';
import { composedCases } from './fixtures/integration-composed';

test.each(composedCases)(
  'profiling regression: %s',
  (_name, f, lo, hi, expected) => definite(f, lo, hi, expected)
);

function definite(
  f: ExpressionInput,
  a: ExpressionInput,
  b: ExpressionInput,
  expected: ExpressionInput
) {
  const ce = new ComputeEngine();
  const value = ce.box(['Integrate', f, ['Limits', 'x', a, b]]).evaluate();
  expect(value.has(['Integrate', 'Limit', 'EvaluateAt'])).toBe(false);
  expect(exactExpression(value)).toBe(true);
  const residual = ce
    .function('Subtract', [value, ce.box(expected).evaluate()])
    .simplify();
  // Different exact log/atan forms need not canonicalize identically. This
  // numerical cross-check supplements, rather than replaces, exact-output checks.
  expect(residual.isSame(0) || Math.abs(residual.N().re) < 1e-12).toBe(true);
}

describe('compositional substitutions', () => {
  test('free symbolic coefficients retain the established solver route', () => {
    const ce = new ComputeEngine(),
      solve = jest.fn(() => ce.Zero);
    const f = ce.parse('(a+b\\tanh(x)^2)^3\\tanh(x)^4');
    expect(integrateComposition(f, 'x', solve)).toBeUndefined();
    expect(solve).not.toHaveBeenCalled();
  });
  test('failed callbacks restore the composition recursion guard', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Multiply',
      ['Power', 'x', 3],
      ['Exp', ['Power', 'x', 2]],
    ]);
    expect(() =>
      integrateComposition(
        f,
        'x',
        () => {
          throw new Error('caller stopped');
        },
        [ce.Zero, ce.One]
      )
    ).toThrow('caller stopped');
    const value = ce.box(['Integrate', f, ['Limits', 'x', 0, 1]]).evaluate();
    expect(value.isSame(ce.Half)).toBe(true);
  });
  test.each([2, 3, 4])('power/exponential composition degree %s', (r) => {
    definite(
      ['Multiply', ['Power', 'x', 2 * r - 1], ['Exp', ['Power', 'x', r]]],
      0,
      1,
      ['Rational', 1, r]
    );
    definite(
      [
        'Multiply',
        ['Power', 'x', 2 * r - 1],
        ['Exp', ['Negate', ['Power', 'x', r]]],
      ],
      0,
      'PositiveInfinity',
      ['Rational', 1, r]
    );
  });
  for (const c of [1, 2, 3])
    for (const k of [1, 2, -1])
      test(`affine exponential c=${c}, k=${k}`, () =>
        definite(
          [
            'Divide',
            1,
            ['Add', 1, ['Multiply', c, ['Exp', ['Multiply', k, 'x']]]],
          ],
          0,
          ['Divide', ['Ln', 2], k],
          ['Divide', ['Ln', ['Rational', 2 * (1 + c), 1 + 2 * c]], k]
        ));
  test('common-denominator rationalization of square and cube roots', () =>
    definite(
      ['Divide', ['Sqrt', 'x'], ['Subtract', ['Sqrt', 'x'], ['Root', 'x', 3]]],
      64,
      729,
      ['Add', ['Rational', 10747, 10], ['Multiply', 6, ['Ln', 2]]]
    ));
  test('fractional substitution needs a certified positive domain', () => {
    const ce = new ComputeEngine(),
      solve = jest.fn(() => ce.Zero);
    const f = ce.box([
      'Divide',
      ['Sqrt', 'x'],
      ['Subtract', ['Sqrt', 'x'], ['Root', 'x', 3]],
    ]);
    expect(integrateComposition(f, 'x', solve)).toBeUndefined();
    expect(solve).not.toHaveBeenCalled();
  });
  test('nested large powers are rejected before rational expansion', () => {
    const ce = new ComputeEngine();
    expect(
      reduceIntegrationRational(
        ce.box(['Divide', 1, ['Power', ['Add', 1, ['Power', 'x', 20]], 20]]),
        'x'
      )
    ).toBeUndefined();
  });
});

describe('trig and hyperbolic coordinates', () => {
  test.each([4, 6, 10])(
    'keeps elementary tanh powers off speculative exponential expansion, degree=%s',
    (n) => {
      const ce = new ComputeEngine();
      const value = ce
        .box(['Integrate', ['Power', ['Tanh', 'x'], n], 'x'])
        .evaluate();
      expect(value.has('ExponentialE')).toBe(false);
      // The native route may decline; the provider handles the general powers.
      // Any native closed form must still differentiate to the original power.
      if (!value.has('Integrate')) {
        const derivative = differentiate(value, 'x')!;
        expect(derivative.subs({ x: 1 }).N().re).toBeCloseTo(
          Math.tanh(1) ** n,
          12
        );
      }
    }
  );
  test.each([
    ['Tanh', ['Ln', ['Cosh', 'x']]],
    ['Sech', ['Arctan', ['Sinh', 'x']]],
  ] as [string, ExpressionInput][])(
    'preserves elementary %s primitive',
    (head, expected) => {
      const ce = new ComputeEngine();
      const value = ce.box(['Integrate', [head, 'x'], 'x']).evaluate();
      expect(value.isSame(ce.box(expected))).toBe(true);
      expect(value.has('Abs')).toBe(false);
    }
  );
  test('an inexact provider endpoint cannot displace an exact native value', () => {
    const ce = new ComputeEngine();
    const provider = jest.fn(() =>
      ce.box(['Multiply', { num: '0.3333333333333' }, ['Power', 'x', 3]])
    );
    ce._integrationProvider = provider;
    const value = ce
      .box(['Integrate', ['Power', 'x', 2], ['Limits', 'x', 0, 1]])
      .evaluate();
    expect(provider).toHaveBeenCalled();
    expect(ce._integrationProvider).toBe(provider);
    expect(value.isSame(ce.box(['Rational', 1, 3]))).toBe(true);
  });
  test.each([1, 2, -1])(
    'Rubi preserves exact hyperbolic endpoints, slope=%s',
    (k) => {
      const ce = new ComputeEngine();
      loadIntegrationRules(ce, { timeLimitMs: 4000, stepBudget: 300000 });
      const value = ce
        .box([
          'Integrate',
          ['Divide', 1, ['Add', 2, ['Cosh', ['Multiply', k, 'x']]]],
          ['Limits', 'x', 0, ['Rational', 1, k]],
        ])
        .evaluate();
      expect(value.has('Integrate')).toBe(false);
      expect(exactExpression(value)).toBe(true);
      expect(value.N().re).toBeCloseTo(0.31571721667658155 / k, 12);
    }
  );
  for (const n of [0, 1, 2])
    for (const scale of [1, 2])
      test(`tangent monomial n=${n}, scale=${scale}`, () => {
        const phase: ExpressionInput = ['Multiply', scale, 'x'];
        const terms: ExpressionInput[] = [['Divide', ['Ln', 3], 2]];
        for (let k = 1; k <= n; k++)
          terms.push([
            'Rational',
            (n === 2 && k === 1 ? 2 : 1) * (3 ** k - 1),
            2 * k,
          ]);
        definite(
          ['Multiply', ['Csc', phase], ['Power', ['Sec', phase], 2 * n + 1]],
          ['Divide', 'Pi', 4 * scale],
          ['Divide', 'Pi', 3 * scale],
          ['Divide', ['Add', ...terms], scale]
        );
      });
  test('odd negative powers avoid the larger half-angle denominator', () =>
    definite(
      [
        'Divide',
        1,
        ['Multiply', ['Power', ['Sin', 'x'], 3], ['Power', ['Cos', 'x'], 5]],
      ],
      ['Divide', 'Pi', 4],
      ['Divide', 'Pi', 3],
      ['Add', ['Rational', 16, 3], ['Multiply', ['Rational', 3, 2], ['Ln', 3]]]
    ));
  test.each([1, -1])(
    'half-angle charts retain winding, orientation=%s',
    (sign) =>
      definite(
        ['Divide', 1, ['Add', 2, ['Sin', 'x']]],
        0,
        ['Multiply', sign * 2, 'Pi'],
        ['Divide', ['Multiply', sign * 2, 'Pi'], ['Sqrt', 3]]
      )
  );
  test.each([1, -1])(
    'a local chart primitive cannot erase a full period, orientation=%s',
    (sign) => {
      const ce = new ComputeEngine();
      const f = ce.box([
        'Multiply',
        ...['Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc'].map(
          (head): ExpressionInput => [head, 'x']
        ),
      ]);
      const value = ce
        .box(['Integrate', f, ['Limits', 'x', 0, ['Multiply', sign * 2, 'Pi']]])
        .evaluate();
      // Cancellation at removable holes needs its own domain certificate.
      // Until then, declining is safe; a zero obtained from atan(tan(x/2)) is not.
      expect(
        value.has('Integrate') ||
          value.isSame(ce.box(['Multiply', sign * 2, 'Pi']))
      ).toBe(true);
    }
  );
  test.each([1, 2, -1])('hyperbolic rationalization slope=%s', (k) => {
    const root: ExpressionInput = ['Sqrt', 3];
    const logRatio = (v: ExpressionInput): ExpressionInput => [
      'Ln',
      ['Divide', ['Subtract', ['Add', v, 2], root], ['Add', v, 2, root]],
    ];
    definite(
      ['Divide', 1, ['Add', 2, ['Cosh', ['Multiply', k, 'x']]]],
      0,
      ['Divide', 1, k],
      [
        'Divide',
        ['Subtract', logRatio('ExponentialE'), logRatio(1)],
        ['Multiply', k, root],
      ]
    );
  });
  test('range enclosure retains an interior cosine zero', () => {
    const ce = new ComputeEngine();
    expect(
      continuousRange(ce.box(['Sec', 'x']), 'x', ce.Zero, ce.Pi)
    ).toBeUndefined();
  });
});

describe('logarithmic recurrences and parameter differences', () => {
  for (const p of [-1, 0, 1, 2])
    for (const m of [1, 2, 3])
      test(`x^${p} log(x)^${m}`, () => {
        const a = p + 1;
        let expected: ExpressionInput = ['Rational', 1, m + 1];
        if (a !== 0) {
          expected = ['Divide', ['Subtract', ['Exp', a], 1], a];
          for (let j = 1; j <= m; j++)
            expected = [
              'Divide',
              ['Subtract', ['Exp', a], ['Multiply', j, expected]],
              a,
            ];
        }
        definite(
          ['Multiply', ['Power', 'x', p], ['Power', ['Ln', 'x'], m]],
          1,
          'ExponentialE',
          expected
        );
      });
  for (const p of [1, 2, 7])
    for (const q of [0, 3])
      test(`parameter powers ${p},${q}`, () =>
        definite(
          [
            'Divide',
            ['Subtract', ['Power', 'x', p], q === 0 ? 1 : ['Power', 'x', q]],
            ['Ln', 'x'],
          ],
          0,
          1,
          ['Ln', ['Rational', p + 1, q + 1]]
        ));
  test('linear combination and reversed bounds', () =>
    definite(
      [
        'Divide',
        ['Add', ['Power', 'x', 3], ['Multiply', 2, 'x'], -3],
        ['Ln', 'x'],
      ],
      1,
      0,
      ['Multiply', -4, ['Ln', 2]]
    ));
  test('does not split a noncancelling numerator at log(1)=0', () => {
    const ce = new ComputeEngine();
    expect(
      logarithmicParameterDifference(
        ce.box(['Divide', ['Add', 'x', 1], ['Ln', 'x']]),
        'x',
        ce.Zero,
        ce.One
      )
    ).toBeUndefined();
    expect(
      logarithmicParameterDifference(
        ce.box(['Divide', ['Subtract', ['Power', 'x', -1], 1], ['Ln', 'x']]),
        'x',
        ce.Zero,
        ce.One
      )
    ).toBeUndefined();
  });
});

describe('interacting discrete selectors', () => {
  test.each([2, 17, 2022])('floor-ceiling product over %s cells', (n) =>
    definite(
      [
        'Subtract',
        ['Power', 'x', 2],
        ['Multiply', ['Floor', 'x'], ['Ceil', 'x']],
      ],
      0,
      n,
      ['Rational', n, 3]
    )
  );
  for (const k of [1, 2, -2])
    test(`affine fractional cell product k=${k}`, () => {
      const phase: ExpressionInput = ['Multiply', k, 'x'];
      // Integral floor(u)*fract(u) over [0,N] is N(N-1)/4.
      definite(
        ['Multiply', ['Floor', phase], ['Fract', phase]],
        0,
        ['Rational', 5, k],
        ['Rational', 5, k]
      );
    });
  for (const kind of ['Floor', 'Ceil', 'Fract'])
    for (const n of [2, 7])
      test(`${kind}(x)/x to ${n}`, () => {
        const base: ExpressionInput = [
          'Subtract',
          ['Multiply', n, ['Ln', n]],
          ['Ln', ['Factorial', n]],
        ];
        const expected: ExpressionInput =
          kind === 'Floor'
            ? base
            : kind === 'Ceil'
              ? ['Add', base, ['Ln', n]]
              : ['Subtract', n - 1, base];
        definite(['Divide', [kind, 'x'], 'x'], 1, n, expected);
      });
  test('partial cells and reversed orientation', () =>
    definite(
      ['Divide', ['Fract', 'x'], 'x'],
      ['Rational', 5, 2],
      ['Rational', 3, 2],
      [
        'Add',
        -1,
        ['Multiply', 2, ['Ln', ['Rational', 5, 2]]],
        ['Negate', ['Ln', 3]],
      ]
    ));
  test('selector denominators and nonpositive reciprocal phases decline', () => {
    const ce = new ComputeEngine();
    expect(
      integrateDiscreteAlgebra(
        ce.box(['Divide', 1, ['Multiply', ['Floor', 'x'], ['Ceil', 'x']]]),
        'x',
        ce.Zero,
        ce.One
      )
    ).toBeUndefined();
    expect(
      integrateDiscreteReciprocal(
        ce.box(['Divide', ['Floor', 'x'], 'x']),
        'x',
        ce.NegativeOne,
        ce.One
      )
    ).toBeUndefined();
  });
});

describe('generating functions and shifted products', () => {
  test('general polynomial coefficient, not only monomial weights', () =>
    definite(
      [
        'Sum',
        ['Multiply', ['Add', ['Multiply', 2, 'n'], 1], ['Power', 'x', 'n']],
        ['Limits', 'n', 0, 'PositiveInfinity'],
      ],
      0,
      ['Rational', 1, 2],
      ['Subtract', 2, ['Ln', 2]]
    ));
  test.each([3, 4])('larger product shift %s', (m) =>
    definite(
      [
        'Product',
        ['Divide', ['Add', 'x', 'n', m], ['Add', 'x', 'n']],
        ['Limits', 'n', 1, 2],
      ],
      0,
      1,
      [
        'Add',
        1,
        ['Multiply', m * (m + 1), ['Ln', 2]],
        ['Multiply', -m * (m - 1), ['Ln', ['Rational', 3, 2]]],
      ]
    )
  );
  test.each([0, 1, 2])('weighted geometric series start=%s', (start) => {
    let expected: ExpressionInput = ['Add', 1, ['Ln', ['Rational', 1, 2]]];
    if (start === 2) expected = ['Subtract', expected, ['Rational', 1, 8]];
    definite(
      [
        'Sum',
        ['Multiply', 'n', ['Power', 'x', 'n']],
        ['Limits', 'n', start, 'PositiveInfinity'],
      ],
      0,
      ['Rational', 1, 2],
      expected
    );
  });
  test('quadratic weight', () =>
    definite(
      [
        'Sum',
        ['Multiply', ['Power', 'n', 2], ['Power', 'x', 'n']],
        ['Limits', 'n', 0, 'PositiveInfinity'],
      ],
      0,
      ['Rational', 1, 2],
      ['Ln', 2]
    ));
  test.each([2, 3, 5])('two-step telescoping product upper index=%s', (n) => {
    // (x+n+1)(x+n+2)/((x+1)(x+2)) = 1+n(n+1)/(x+1)-n(n-1)/(x+2).
    definite(
      [
        'Product',
        ['Divide', ['Add', 'x', 'n', 2], ['Add', 'x', 'n']],
        ['Limits', 'n', 1, n],
      ],
      0,
      1,
      [
        'Add',
        1,
        ['Multiply', n * (n + 1), ['Ln', 2]],
        ['Multiply', -n * (n - 1), ['Ln', ['Rational', 3, 2]]],
      ]
    );
  });
  test('uniform convergence must be proved, not sampled', () => {
    const ce = new ComputeEngine(),
      f = ce.box([
        'Sum',
        ['Multiply', 'n', ['Power', 'x', 'n']],
        ['Limits', 'n', 0, 'PositiveInfinity'],
      ]);
    expect(integratePolynomialSeries(f, 'x', ce.Zero, ce.One)).toBeUndefined();
  });
});
