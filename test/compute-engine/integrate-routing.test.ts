import { ComputeEngine } from '../../src/compute-engine';
import type { ExpressionInput } from '../../src/compute-engine/global-types';
import * as composition from '../../src/compute-engine/symbolic/integration-composition';
import { integrateRationalTrig } from '../../src/compute-engine/symbolic/definite-trig-transform';
import { structuralQuotient } from '../../src/compute-engine/symbolic/definite-transform';
import {
  polynomialExponentialTrig,
  logarithmicSubstitution,
} from '../../src/compute-engine/rubi/substitution-integrals';
import { differentiate } from '../../src/compute-engine/symbolic/derivative';

test.each([
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  'Sinh',
  'Cosh',
  'Tanh',
  'Coth',
  'Sech',
  'Csch',
])('elementary %s stays out of speculative coordinates', (head) => {
  const ce = new ComputeEngine();
  const f = ce.box([head, ['Add', 1, ['Multiply', 2, 'x']]]);
  const solve = jest.fn(() => ce.Zero);
  for (const body of [f, ce.function('Divide', [ce.One, f]), f.pow(2)]) {
    expect(composition.integrateComposition(body, 'x', solve)).toBeUndefined();
    expect(
      integrateRationalTrig(body, 'x', ce.One, ce.number(2))
    ).toBeUndefined();
  }
  expect(solve).not.toHaveBeenCalled();
});

test.each(
  (
    [
      ['Coth', 'x'],
      ['Tan', 'x'],
      ['Multiply', 'x', ['Ln', 'x']],
    ] as ExpressionInput[]
  ).map((f) => ({ f }))
)('established primitive does not enter composition: $f', ({ f }) => {
  const ce = new ComputeEngine();
  const search = jest.spyOn(composition, 'integrateComposition');
  try {
    const value = ce.box(['Integrate', f, ['Limits', 'x', 1, 2]]).evaluate();
    expect(value.has('Integrate')).toBe(false);
    expect(search).not.toHaveBeenCalled();
  } finally {
    search.mockRestore();
  }
});

test.each([1, 2, 3])(
  'exponential substitution cannot cross a pole, slope %s',
  (k) => {
    const ce = new ComputeEngine();
    for (const c of [0, 1]) {
      const f: ExpressionInput = [
        'Divide',
        ['Exp', 'x'],
        ['Subtract', ['Exp', ['Multiply', k, 'x']], ['Exp', k * c]],
      ];
      for (const [a, b] of [
        [c - 1, c + 1],
        [c + 1, c - 1],
      ]) {
        const value = ce
          .box(['Integrate', f, ['Limits', 'x', a, b]])
          .evaluate();
        expect(value.toString()).toBe('Indeterminate');
      }
    }
  }
);

test('structural cancellation preserves compound fractional bases', () => {
  const ce = new ComputeEngine();
  const root = ce.box(['Sqrt', ['Add', 1, 'x']]);
  const value = structuralQuotient(root, ce.box(['Multiply', 2, 'x']));
  expect(value.has('Sqrt')).toBe(true);
  const cubeRoot = ce.box(['Root', ['Add', 1, 'x'], 3]);
  expect(structuralQuotient(cubeRoot, ce.One).isSame(cubeRoot)).toBe(true);
  const q = structuralQuotient(
    ce.box(['Multiply', ['Power', 'x', 3], ['Exp', ['Power', 'x', 2]]]),
    ce.box(['Multiply', 2, 'x'])
  );
  expect(
    q.isSame(
      ce.box([
        'Multiply',
        ['Rational', 1, 2],
        ['Power', 'x', 2],
        ['Exp', ['Power', 'x', 2]],
      ])
    )
  ).toBe(true);
});

test('finite exponential-trig recurrence accepts symbolic polynomial coefficients', () => {
  const ce = new ComputeEngine();
  const f = ce.box([
    'Multiply',
    ['Add', 'a', ['Multiply', 'b', 'x']],
    ['Exp', ['Multiply', 2, 'x']],
    ['Sin', ['Multiply', 3, 'x']],
  ]);
  const primitive = polynomialExponentialTrig(f, 'x');
  expect(primitive).not.toBeNull();
  const derivative = differentiate(primitive!, 'x')!;
  for (const x of [0.2, 0.8]) {
    const values = { a: 3, b: -2, x };
    expect(derivative.subs(values).N().re).toBeCloseTo(
      f.subs(values).N().re,
      10
    );
  }
  expect(
    logarithmicSubstitution(
      ce.box(['Multiply', 'a', ['Cos', ['Ln', 'x']]]),
      'x'
    )
  ).toBeNull();
});

test('a provider primitive that gives a non-real value for a real integrand is refused', () => {
  // The primitive that Rubi returns for √x/(√(2012−x)+√x). Its ln(x − 1006)
  // and artanh terms are singular at x = 1006, inside [1, 2011], so the
  // difference of its endpoint values is 1005 − 1580.2i. The integral of a
  // real integrand over a real interval is real: the value must be refused,
  // and the built-in reflection reduction then gives 1005.
  const ce = new ComputeEngine();
  const integrand = ce.box([
    'Divide',
    ['Sqrt', 'x'],
    ['Add', ['Sqrt', ['Subtract', 2012, 'x']], ['Sqrt', 'x']],
  ]);
  const primitive = ce.box([
    'Add',
    ['Divide', 'x', 2],
    ['Multiply', 503, ['Ln', ['Subtract', 'x', 1006]]],
    [
      'Negate',
      [
        'Divide',
        ['Multiply', ['Sqrt', 'x'], ['Sqrt', ['Subtract', 2012, 'x']]],
        2,
      ],
    ],
    [
      'Multiply',
      503,
      [
        'Artanh',
        [
          'Divide',
          ['Multiply', ['Sqrt', 'x'], ['Sqrt', ['Subtract', 2012, 'x']]],
          1006,
        ],
      ],
    ],
  ]);
  // The provider receives the integrand bound in the scope of the integral,
  // where `x` is another symbol than the `x` of `integrand`: compare the
  // MathJSON, not the boxed expressions.
  const key = JSON.stringify(integrand.json);
  ce._integrationProvider = (f) =>
    JSON.stringify(f.json) === key ? primitive : null;
  const value = ce
    .box(['Integrate', integrand, ['Limits', 'x', 1, 2011]])
    .evaluate();
  expect(value.N().im).toBe(0);
  expect(value.isSame(1005)).toBe(true);
});

test('a correct complex value is kept when the integrand is not proven real', () => {
  // √x is complex on [−1, 0) and real at sample points such as 0, 1 and 2, so
  // a sampling of the integrand cannot prove that it is real on [−1, 3]. The
  // value 2√3 + (2/3)i is correct and must not be refused.
  const ce = new ComputeEngine();
  const value = ce
    .box(['Integrate', ['Sqrt', 'x'], ['Limits', 'x', -1, 3]])
    .evaluate();
  expect(value.has('Integrate')).toBe(false);
  expect(value.N().re).toBeCloseTo(2 * Math.sqrt(3), 12);
  expect(value.N().im).toBeCloseTo(2 / 3, 12);
});

test('a provider value with terms that are not real gives way to the built-in primitive', () => {
  // Rubi's primitive of 1/(x² − 1) is −artanh(x). On [2, ∞) its value at the
  // bounds is iπ/2 + artanh(2): real, but written with terms that are not
  // real. The built-in primitive gives the same value as ln(3)/2.
  const ce = new ComputeEngine();
  const integrand = ce.box(['Divide', 1, ['Subtract', ['Power', 'x', 2], 1]]);
  const key = JSON.stringify(integrand.json);
  ce._integrationProvider = (f) =>
    JSON.stringify(f.json) === key ? ce.box(['Negate', ['Artanh', 'x']]) : null;
  const value = ce
    .box(['Integrate', integrand, ['Limits', 'x', 2, 'PositiveInfinity']])
    .evaluate();
  expect(value.toString()).toBe('1/2 * ln(3)');
});
