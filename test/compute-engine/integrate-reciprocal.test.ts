import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';
import { integrateReciprocalRational } from '../../src/compute-engine/symbolic/definite-reciprocal';
import {
  exactExpression,
  integrateBySubstitution,
} from '../../src/compute-engine/symbolic/definite-transform';
import { reciprocalCases } from './fixtures/integration-families';

test.each([65, 128, 2022, 8192])(
  'high-degree rational substitution search declines before expansion %s',
  (n) => {
    const ce = new ComputeEngine();
    const body = ce.box([
      'Divide',
      ['Add', 1, ['Power', 'x', 2]],
      ['Add', ['Power', 'x', 2], ['Power', 'x', n]],
    ]);
    expect(
      integrateBySubstitution(body, 'x', ce.One, ce.number(3))
    ).toBeUndefined();
  }
);

describe.each([false, true])(
  'reciprocal rational integration Rubi=%s',
  (rubi) => {
    const ce = new ComputeEngine();
    if (rubi)
      loadIntegrationRules(ce, { timeLimitMs: 4000, stepBudget: 300000 });
    test.each(reciprocalCases)('%s', (_name, body, lo, hi, expected) => {
      for (const reverse of [false, true]) {
        const result = ce
          .box([
            'Integrate',
            body,
            ['Limits', 'x', reverse ? hi : lo, reverse ? lo : hi],
          ])
          .evaluate();
        const reference = ce
          .box(reverse ? ['Negate', expected] : expected)
          .evaluate();
        expect(result.has('Integrate')).toBe(false);
        expect(exactExpression(result)).toBe(true);
        expect(
          ce.function('Subtract', [result, reference]).simplify().isSame(0)
        ).toBe(true);
      }
    });
  }
);

test.each([
  ['Divide', 1, ['Subtract', 'x', 1]],
  ['Divide', 1, ['Power', ['Subtract', 'x', 1], 2]],
  ['Divide', ['Divide', 1, ['Subtract', 'x', 1]], ['Add', 1, 'x']],
  ['Divide', 1, ['Add', 2, ['Power', 'x', 3]]],
  ['Divide', ['Sin', 'x'], ['Add', 1, ['Power', 'x', 2]]],
  ['Divide', 1, ['Add', 1, ['Power', 'x', ['Rational', 1, 2]]]],
  ['Divide', 1, ['Add', 1, ['Power', 'x', 1000000]]],
] as const)(
  'declines poles, non-Laurent pairs and unsupported inputs %j',
  (...body) => {
    const ce = new ComputeEngine();
    expect(
      integrateReciprocalRational(
        ce.box(body),
        'x',
        ce.box(['Rational', 1, 2]),
        ce.number(2)
      )
    ).toBeUndefined();
  }
);

test.each([
  [0, 2],
  [-2, ['Rational', -1, 2]],
  [1, 3],
  [1, 'PositiveInfinity'],
] as const)('declines nonpositive or nonreciprocal bounds %j %j', (lo, hi) => {
  const ce = new ComputeEngine();
  expect(
    integrateReciprocalRational(
      ce.box(['Divide', 1, ['Add', 'x', ['Power', 'x', 2]]]),
      'x',
      ce.box(lo),
      ce.box(hi)
    )
  ).toBeUndefined();
});

test('negative denominator coefficients and zero reciprocal sum', () => {
  const ce = new ComputeEngine();
  for (const body of [
    ['Divide', ['Subtract', 1, ['Power', 'x', 2]], ['Power', 'x', 2]],
    [
      'Divide',
      ['Subtract', ['Power', 'x', 2], 1],
      ['Negate', ['Power', 'x', 2]],
    ],
  ] as const) {
    expect(
      integrateReciprocalRational(
        ce.box(body),
        'x',
        ce.box(['Rational', 1, 2]),
        ce.number(2)
      )?.isSame(0)
    ).toBe(true);
  }
});

test('three-term reciprocal denominator with an antisymmetric summand', () => {
  const ce = new ComputeEngine();
  // The nonconstant remainder changes sign under x -> 1/x with its Jacobian.
  const body = ce.box([
    'Divide',
    ['Add', ['Power', 'x', 4], ['Multiply', 4, ['Power', 'x', 2]]],
    ['Add', 1, ['Multiply', 3, ['Power', 'x', 2]], ['Power', 'x', 4]],
  ]);
  expect(
    integrateReciprocalRational(
      body,
      'x',
      ce.box(['Rational', 1, 2]),
      ce.number(2)
    )?.isSame(ce.box(['Rational', 3, 2]))
  ).toBe(true);
});

test('rejects endpoint poles rather than assigning a paired principal value', () => {
  const ce = new ComputeEngine();
  const body = ce.box(['Divide', 1, ['Subtract', 'x', 2]]);
  expect(
    integrateReciprocalRational(
      body,
      'x',
      ce.box(['Rational', 1, 2]),
      ce.number(2)
    )
  ).toBeUndefined();
});
