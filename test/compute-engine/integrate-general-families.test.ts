import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';
import type { ExpressionInput } from '../../src/compute-engine/global-types';
import {
  exactExpression,
  exactBeta,
  integrateBySubstitution,
  generalizedBeta,
} from '../../src/compute-engine/symbolic/definite-transform';
import { betaLogMoment } from '../../src/compute-engine/symbolic/definite-parameter';
import { logarithmicParameter } from '../../src/compute-engine/symbolic/definite-parameter';
import {
  logarithmicSeriesMoment,
  integratedPowerSeries,
  telescopingProduct,
  infiniteTelescopingProduct,
} from '../../src/compute-engine/symbolic/definite-summation';
import { integrateRationalTrig } from '../../src/compute-engine/symbolic/definite-trig-transform';
import { integrateWeightedDiscrete } from '../../src/compute-engine/symbolic/definite-periodic';
import { integratePiecewise } from '../../src/compute-engine/symbolic/piecewise-integrate';

import { cases, polynomialCases } from './fixtures/integration-families';

const terminals = [
  generalizedBeta,
  betaLogMoment,
  logarithmicParameter,
  logarithmicSeriesMoment,
  integratedPowerSeries,
  telescopingProduct,
  infiniteTelescopingProduct,
];

describe('polynomials keep their existing primitive path', () => {
  test.each(polynomialCases)('%s', (_name, body, lo, hi, expected) => {
    const ce = new ComputeEngine();
    const f = ce.box(body);
    expect(
      integrateBySubstitution(f, 'x', ce.box(lo), ce.box(hi), terminals)
    ).toBeUndefined();
    const result = ce.box(['Integrate', f, ['Limits', 'x', lo, hi]]).evaluate();
    expect(result.isSame(ce.box(expected).evaluate())).toBe(true);
  });
});

test.each([
  [3, ['Rational', 1, 2], 2],
  [['Rational', 1, 2], ['Rational', 1, 2], 3],
  [2, -1, 2],
  [3, -1, 3],
] as [ExpressionInput, ExpressionInput, number][])(
  'positive power series supports shifted index and nonunit scale %j %j %s',
  (r, a, start) => {
    const ce = new ComputeEngine();
    const result = ce
      .box([
        'Integrate',
        [
          'Sum',
          [
            'Divide',
            ['Power', 'x', ['Subtract', ['Multiply', r, ['Add', 'n', a]], 1]],
            ['Power', ['Add', 'n', a], 2],
          ],
          ['Limits', 'n', start, 'PositiveInfinity'],
        ],
        ['Limits', 'x', 0, 1],
      ])
      .evaluate();
    const z = ce.box(['Add', start, a]).evaluate();
    const expected = ce
      .box(['Divide', z.isSame(1) ? ['Zeta', 3] : ['HurwitzZeta', 3, z], r])
      .evaluate();
    expect(result.has(['Integrate', 'Sum'])).toBe(false);
    expect(exactExpression(result)).toBe(true);
    expect(
      ce.function('Subtract', [result, expected]).simplify().isSame(0)
    ).toBe(true);
  }
);

describe.each([false, true])(
  'elementary zero-order moments Rubi=%s',
  (rubi) => {
    const ce = new ComputeEngine();
    if (rubi)
      loadIntegrationRules(ce, { timeLimitMs: 4000, stepBudget: 300000 });
    for (const r of [1, 2])
      for (const p of [0, 1, 2, 3, 4, 5])
        test(`x^${p}/(1+x^${r})`, () => {
          // Polynomial division supplies an independent elementary recurrence.
          const primitiveMoment = (n: number): ExpressionInput => {
            if (n === 0) return r === 1 ? ['Ln', 2] : ['Divide', 'Pi', 4];
            if (r === 2 && n === 1) return ['Divide', ['Ln', 2], 2];
            return [
              'Subtract',
              ['Rational', 1, n - r + 1],
              primitiveMoment(n - r),
            ];
          };
          const result = ce
            .box([
              'Integrate',
              ['Divide', ['Power', 'x', p], ['Add', 1, ['Power', 'x', r]]],
              ['Limits', 'x', 0, 1],
            ])
            .evaluate();
          expect(result.has(['PolyGamma', 'Integrate'])).toBe(false);
          expect(exactExpression(result)).toBe(true);
          expect(
            ce
              .function('Subtract', [result, ce.box(primitiveMoment(p))])
              .simplify()
              .isSame(0)
          ).toBe(true);
        });
  }
);

describe('Beta integer recurrence preserves reduced rational answers', () => {
  for (const a of [1, 2, 3, 6])
    for (const b of [40, 2025, 10000])
      test(`Beta(${a},${b}) in both argument orders`, () => {
        const ce = new ComputeEngine();
        let denominator = 1n,
          numerator = 1n;
        for (let k = 0; k < a; k++) denominator *= BigInt(b + k);
        for (let k = 1; k < a; k++) numerator *= BigInt(k);
        const expected = ce.box([
          'Rational',
          numerator.toString(),
          denominator.toString(),
        ]);
        for (const [u, v] of [
          [a, b],
          [b, a],
        ]) {
          const result = exactBeta(ce.number(u), ce.number(v));
          expect(result.has(['Beta', 'Gamma', 'Factorial'])).toBe(false);
          expect(exactExpression(result)).toBe(true);
          expect(result.isSame(expected)).toBe(true);
        }
      });
});

test.each([false, true])(
  'large Beta polynomial retains its rational answer Rubi=%s',
  (rubi) => {
    const ce = new ComputeEngine();
    if (rubi)
      loadIntegrationRules(ce, { timeLimitMs: 4000, stepBudget: 300000 });
    const result = ce
      .box([
        'Integrate',
        ['Multiply', ['Power', 'x', 2], ['Power', ['Subtract', 1, 'x'], 2024]],
        ['Limits', 'x', 0, 1],
      ])
      .evaluate();
    expect(result.isSame(ce.box(['Rational', 1, 4158035775]))).toBe(true);
  }
);

test.each([
  [
    'negative logarithm branch',
    ['Divide', ['Ln', ['Subtract', 1, ['Multiply', 2, 'x']]], 'x'],
    0,
    1,
  ],
  [
    'geometric endpoint divergence',
    ['Sum', ['Power', 'x', 'n'], ['Limits', 'n', 0, 'PositiveInfinity']],
    0,
    1,
  ],
  ['parameter pole', ['Multiply', ['Power', 'x', -1], ['Ln', 'x']], 0, 1],
  [
    'noninteger logarithm power',
    ['Power', ['Ln', 'x'], ['Rational', 1, 2]],
    0,
    1,
  ],
  [
    'telescoping hidden zero',
    [
      'Product',
      ['Divide', ['Add', 'x', 'n', 1], ['Add', 'x', 'n']],
      ['Limits', 'n', 1, 3],
    ],
    -3,
    0,
  ],
  [
    'infinite product hidden zero',
    [
      'Product',
      [
        'Divide',
        ['Add', 1, ['Divide', 'x', ['Add', 'n', 1]]],
        ['Add', 1, ['Divide', 'x', 'n']],
      ],
      ['Limits', 'n', 1, 'PositiveInfinity'],
    ],
    -2,
    0,
  ],
] as [string, ExpressionInput, ExpressionInput, ExpressionInput][])(
  'does not certify %s',
  (_name, f, lo, hi) => {
    const ce = new ComputeEngine();
    expect(
      integrateBySubstitution(ce.box(f), 'x', ce.box(lo), ce.box(hi), terminals)
    ).toBeUndefined();
  }
);

test('rational trig rejects real poles, non-radians, and a shadowed generated Tan', () => {
  const ce = new ComputeEngine();
  expect(
    integrateRationalTrig(
      ce.box(['Divide', 1, ['Add', 1, ['Cos', 'x']]]),
      'x',
      ce.Zero,
      ce.Pi
    )
  ).toBeUndefined();
  const f = ce.box(['Divide', 1, ['Add', 3, ['Cos', 'x']]]);
  ce.angularUnit = 'deg';
  expect(integrateRationalTrig(f, 'x', ce.Zero, ce.Pi)).toBeUndefined();
  ce.angularUnit = 'rad';
  ce.declare('Tan', {
    signature: '(number) -> number',
    evaluate: () => ce.Zero,
  });
  expect(integrateRationalTrig(f, 'x', ce.Zero, ce.Pi)).toBeUndefined();
});

test('periodic moments scale to a billion cells without enumerating them', () => {
  const ce = new ComputeEngine(),
    n = ce.number(1000000000);
  const f = ce.box([
    'Multiply',
    ['Power', 'x', 2],
    ['Power', ['Fract', 'x'], 2],
  ]);
  const result = integrateWeightedDiscrete(f, 'x', ce.Zero, n);
  const expected = ce
    .box([
      'Add',
      ['Divide', ['Power', n, 3], 9],
      ['Divide', ['Power', n, 2], 12],
      ['Divide', n, 180],
    ])
    .evaluate();
  expect(result?.isSame(expected)).toBe(true);
});

test.each([-2, -1, 2])(
  'affine trig phase preserves the Jacobian at slope %s',
  (slope) => {
    const ce = new ComputeEngine();
    const body = ce.box([
      'Divide',
      1,
      ['Add', 3, ['Cos', ['Add', ['Multiply', slope, 'x'], 'Pi']]],
    ]);
    const hi = ce.box(['Divide', 'Pi', slope]).evaluate();
    const result = integrateRationalTrig(body, 'x', ce.Zero, hi);
    const expected = ce
      .box(['Divide', 'Pi', ['Multiply', slope, ['Sqrt', 8]]])
      .evaluate();
    expect(result).toBeDefined();
    if (result)
      expect(
        ce.function('Subtract', [result.value, expected]).simplify().isSame(0)
      ).toBe(true);
  }
);

test('assigned integration and product indices remain shielded', () => {
  const ce = new ComputeEngine();
  ce.assign('x', 7);
  ce.assign('n', 20);
  const result = ce
    .box([
      'Integrate',
      [
        'Product',
        ['Divide', ['Add', 'x', 'n', 1], ['Add', 'x', 'n']],
        ['Limits', 'n', 1, 3],
      ],
      ['Limits', 'x', 0, 1],
    ])
    .evaluate();
  const expected = ce.box(['Add', 1, ['Multiply', 3, ['Ln', 2]]]).evaluate();
  expect(ce.function('Subtract', [result, expected]).simplify().isSame(0)).toBe(
    true
  );
  expect(ce.box('x').evaluate().isSame(7)).toBe(true);
  expect(ce.box('n').evaluate().isSame(20)).toBe(true);
});

describe('weighted moments agree with independent finite partitioning', () => {
  for (const kind of ['Floor', 'Ceil', 'Fract'])
    for (const slope of [-3, -1, 2])
      for (const power of [2, 3])
        test(`${kind}, slope=${slope}, power=${power}`, () => {
          const ce = new ComputeEngine();
          const f = ce.box([
            'Multiply',
            ['Add', 1, ['Power', 'x', 2]],
            [
              'Power',
              [kind, ['Add', ['Multiply', slope, 'x'], ['Rational', 1, 2]]],
              power,
            ],
          ]);
          const lo = ce.box(['Rational', -1, 2]),
            hi = ce.box(['Rational', 3, 2]);
          const moment = integrateWeightedDiscrete(f, 'x', lo, hi);
          const partition = integratePiecewise(ce, f, 'x', lo, hi);
          expect(moment).toBeDefined();
          expect(partition).toBeDefined();
          expect(partition).not.toBe('inert');
          if (moment && partition && partition !== 'inert')
            expect(
              ce.function('Subtract', [moment, partition]).simplify().isSame(0)
            ).toBe(true);
        });
});
describe.each([false, true])('GENERAL DEFINITE FAMILIES Rubi=%s', (rubi) => {
  const ce = new ComputeEngine();
  if (rubi) loadIntegrationRules(ce, { timeLimitMs: 4000, stepBudget: 300000 });
  test.each(cases)('%s', (_name, f, lo, hi, expected) => {
    for (const reverse of [false, true]) {
      const result = ce
        .box([
          'Integrate',
          f,
          ['Limits', 'x', reverse ? hi : lo, reverse ? lo : hi],
        ])
        .evaluate();
      expect(result.has(['Integrate', 'Sum', 'Product', 'Limit'])).toBe(false);
      expect(exactExpression(result)).toBe(true);
      const reference = ce
        .box(reverse ? ['Negate', expected] : expected)
        .evaluate();
      expect(
        ce.function('Subtract', [result, reference]).simplify().isSame(0)
      ).toBe(true);
    }
  });
});

test('substitution exposes justified intermediate steps', () => {
  const ce = new ComputeEngine();
  const f = ce.box([
    'Divide',
    ['Multiply', ['Ln', 'x'], ['Power', ['Subtract', 1, ['Ln', 'x']], 2]],
    'x',
  ]);
  const report = integrateBySubstitution(
    f,
    'x',
    ce.One,
    ce.symbol('ExponentialE'),
    [generalizedBeta, betaLogMoment]
  );
  expect(report?.steps.map((s) => s.method)).toEqual(
    expect.arrayContaining(['derivative-substitution', 'generalized-beta'])
  );
});

test.each([
  [['Divide', 1, 'x'], 0, 1],
  [['Divide', 1, ['Add', 1, 'x']], 0, 'PositiveInfinity'],
  [['Multiply', ['Power', 'x', -2], ['Ln', 'x']], 0, 1],
  [['Power', ['Subtract', 1, 'x'], -2], 0, 1],
] as [ExpressionInput, ExpressionInput, ExpressionInput][])(
  'declines a divergent family %j',
  (f, lo, hi) => {
    const ce = new ComputeEngine();
    expect(
      integrateBySubstitution(ce.box(f), 'x', ce.box(lo), ce.box(hi), [
        generalizedBeta,
        betaLogMoment,
      ])
    ).toBeUndefined();
  }
);
