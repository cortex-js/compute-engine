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
