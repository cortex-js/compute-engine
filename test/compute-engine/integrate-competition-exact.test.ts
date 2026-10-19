import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';
import type {
  Expression,
  ExpressionInput,
} from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { expandAll } from '../../src/compute-engine/boxed-expression/expand';
import { getPolynomialCoefficients } from '../../src/compute-engine/boxed-expression/polynomials';
import {
  integrateBetaMoment,
  integrateDefiniteElementary,
  integrateTrigPolynomial,
} from '../../src/compute-engine/symbolic/definite-integrate';
import { integrateDiscreteMoments } from '../../src/compute-engine/symbolic/definite-discrete';
import {
  integrateDefiniteSeries,
  integrateProductDerivative,
} from '../../src/compute-engine/symbolic/definite-series';
import { integrateBoseMoment } from '../../src/compute-engine/symbolic/special-integrate';

import {
  cases,
  halfPi,
  geometric,
  productDerivative,
} from './fixtures/competition-exact';

function exactLeaves(e: Expression): void {
  if (isNumber(e)) expect(e.isExact).toBe(true);
  if (isFunction(e)) e.ops.forEach(exactLeaves);
}

describe.each([false, true])(
  'EXACT COMPETITION REDUCTIONS (Rubi=%s)',
  (rubi) => {
    let ce: ComputeEngine;
    beforeAll(() => {
      ce = new ComputeEngine();
      if (rubi)
        loadIntegrationRules(ce, { timeLimitMs: 4000, stepBudget: 300000 });
    });
    test.each(cases)('%s', (name, body, a, b, expected) => {
      for (const reversed of [false, true]) {
        const value = ce
          .box([
            'Integrate',
            body,
            ['Limits', 'x', reversed ? b : a, reversed ? a : b],
          ])
          .evaluate();
        expect(value.has(['Integrate', 'Sum', 'Product'])).toBe(false);
        exactLeaves(value);
        const reference = ce
          .box(reversed ? ['Negate', expected] : expected)
          .evaluate();
        expect(
          ce.function('Subtract', [value, reference]).simplify().isSame(0)
        ).toBe(true);
      }
    });
  }
);

describe('DEFINITE REDUCTION CERTIFICATES', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });
  const reducers = {
    elementary: integrateDefiniteElementary,
    beta: integrateBetaMoment,
    trig: integrateTrigPolynomial,
    discrete: integrateDiscreteMoments,
    series: integrateDefiniteSeries,
    product: integrateProductDerivative,
    bose: integrateBoseMoment,
  };
  test.each([
    ['elementary', ['Divide', 1, 'x'], -1, 1],
    ['elementary', ['Divide', 'x', ['Subtract', ['Power', 'x', 2], 1]], -2, 2],
    [
      'elementary',
      [
        'Divide',
        ['Sqrt', 'x'],
        ['Add', ['Sqrt', 'x'], ['Sqrt', ['Subtract', 1, 'x']]],
      ],
      -1,
      2,
    ],
    ['beta', ['Power', 'x', -1], 0, 1],
    ['beta', ['Power', ['Subtract', 1, 'x'], ['Rational', -3, 2]], 0, 1],
    ['beta', ['Sqrt', ['Power', ['Subtract', 'x', 1], 2]], 0, 1],
    ['discrete', ['Power', ['Fract', ['Divide', 1, 'x']], 2], 0, 1],
    ['discrete', ['Ceil', ['Multiply', 2, ['Floor', 'x']]], 0, 20],
    ['series', geometric(0), 0, 1],
    ['series', geometric(0), -2, 0],
    [
      'series',
      ['Sum', ['Power', 'x', 'n'], ['Limits', 'n', -1, 'PositiveInfinity']],
      0,
      ['Rational', 1, 2],
    ],
    [
      'series',
      ['Sum', ['Power', 'x', 'x'], ['Limits', 'x', 0, 'PositiveInfinity']],
      0,
      ['Rational', 1, 2],
    ],
    ['product', productDerivative(5), -3, 1],
    [
      'bose',
      ['Divide', 1, ['Add', 1, ['Exp', ['Negate', 'x']]]],
      0,
      'PositiveInfinity',
    ],
  ] as [
    keyof typeof reducers,
    ExpressionInput,
    ExpressionInput,
    ExpressionInput,
  ][])('%s declines an unproved domain: %j', (kind, f, a, b) => {
    expect(
      reducers[kind](ce.box(f), 'x', ce.box(a), ce.box(b))
    ).toBeUndefined();
  });
  test('Bose n=0 retains divergence', () => {
    expect(
      integrateBoseMoment(
        ce.box(['Divide', 1, ['Subtract', ['Exp', 'x'], 1]]),
        'x',
        ce.Zero,
        ce.PositiveInfinity
      )?.isSame(ce.PositiveInfinity)
    ).toBe(true);
  });
  test('radian formulas decline degree mode', () => {
    ce.angularUnit = 'deg';
    expect(
      integrateTrigPolynomial(
        ce.box(['Power', ['Sin', 'x'], 2]),
        'x',
        ce.Zero,
        ce.Pi
      )
    ).toBeUndefined();
    expect(
      integrateDefiniteElementary(
        ce.box(cases[4][1]),
        'x',
        ce.Zero,
        ce.box(halfPi)
      )
    ).toBeUndefined();
  });
  test('user-defined trig functions are not replaced by library identities', () => {
    ce.declare('Sin', {
      signature: '(number) -> number',
      evaluate: ([t], { engine }) => t.add(engine.One),
    });
    expect(
      integrateTrigPolynomial(ce.box(['Sin', 'x']), 'x', ce.Zero, ce.Pi)
    ).toBeUndefined();
  });
  test('integration shields assigned variables and series indices', () => {
    ce.assign('x', 9);
    ce.assign('n', 7);
    const value = ce
      .box(['Integrate', geometric(2), ['Limits', 'x', 0, ['Rational', 1, 2]]])
      .evaluate();
    expect(value.has('Integrate')).toBe(false);
    expect(value.N().re).toBeCloseTo(Math.log(2) - 5 / 8, 14);
    expect(ce.box('x').evaluate().json).toBe(9);
    expect(ce.box('n').evaluate().json).toBe(7);
  });
  test('multinomial coefficients remain exact beyond the machine integer range', () => {
    const expanded = expandAll(ce.box(['Power', ['Add', 1, 'x'], 60]));
    expect(expanded).not.toBeNull();
    const coefficients = getPolynomialCoefficients(expanded!, 'x')!;
    expect(coefficients[30].isSame(ce.number(118264581564861424n))).toBe(true);
    exactLeaves(expanded!);
  });
  test('primitive endpoint arithmetic stays exact without the Beta shortcut', () => {
    loadIntegrationRules(ce, { timeLimitMs: 4000, stepBudget: 300000 });
    const primitive = ce._integrationProvider!(ce.box(cases[0][1]), 'x');
    expect(primitive).not.toBeNull();
    expect(primitive!.has('Integrate')).toBe(false);
    exactLeaves(primitive!);
    const value = ce
      .expr(['EvaluateAt', ['Function', primitive!, 'x'], 0, 1])
      .evaluate();
    expect(value.json).toEqual(['Rational', 1, 10100]);
  });
});
