import { ComputeEngine } from '../../src/compute-engine';
import type { ExpressionInput } from '../../src/compute-engine/global-types';
import { differentiate } from '../../src/compute-engine/symbolic/derivative';
import { integrateBoseMoment } from '../../src/compute-engine/symbolic/special-integrate';
import { integrateDiscrete } from '../../src/compute-engine/symbolic/discrete-integrate';
import { integratePiecewise } from '../../src/compute-engine/symbolic/piecewise-integrate';
import { CancellationError } from '../../src/common/interruptible';

const ce = new ComputeEngine();
function integral(
  f: ExpressionInput,
  a: ExpressionInput = 0,
  b: ExpressionInput = 1,
  engine = ce
) {
  return engine.box(['Integrate', f, ['Limits', 'x', a, b]]).evaluate();
}
function equal(
  f: ExpressionInput,
  a: ExpressionInput,
  b: ExpressionInput,
  expected: ExpressionInput
) {
  const result = integral(f, a, b);
  expect(result.has('Integrate')).toBe(false);
  expect(result.sub(ce.box(expected)).simplify().isSame(0)).toBe(true);
}

describe('nonlinear absolute values and signs', () => {
  test('affine kinks keep enclosing integration ranges', () => {
    expect(
      ce.parse('\\int_{-1}^{1}\\int_{-1}^{1}|x-y|\\,dx\\,dy').evaluate().json
    ).toEqual(['Rational', 8, 3]);
  });
  test('a non-special-angle remainder remains exact after many periods', () => {
    equal(
      ['Abs', ['Sin', 'x']],
      1,
      ['Add', ['Multiply', 1000000, 'Pi'], ['Rational', 3, 2]],
      ['Add', 2000000, ['Cos', 1], ['Negate', ['Cos', ['Rational', 3, 2]]]]
    );
  });
  test.each([
    [['Abs', ['Subtract', ['Square', 'x'], 1]], -2, 2, 4],
    [['Sign', ['Subtract', ['Square', 'x'], 1]], -2, 2, 0],
    [['Abs', ['Sin', 'x']], 0, ['Multiply', 2, 'Pi'], 4],
    [['Sign', ['Sin', 'x']], 0, ['Multiply', 2, 'Pi'], 0],
    [
      ['Abs', ['Subtract', ['Square', 'x'], 2]],
      0,
      2,
      [
        'Subtract',
        ['Divide', ['Multiply', 8, ['Sqrt', 2]], 3],
        ['Rational', 4, 3],
      ],
    ],
    [
      ['Abs', ['Sin', ['Multiply', -2, 'x']]],
      0,
      ['Multiply', 1000000, 'Pi'],
      2000000,
    ],
    [
      ['Sign', ['Cos', ['Add', 'x', ['Divide', 'Pi', 2]]]],
      0,
      ['Multiply', 1000000, 'Pi'],
      0,
    ],
    [
      ['Abs', ['Sin', 'x']],
      ['Divide', 'Pi', 2],
      ['Multiply', ['Rational', 9, 2], 'Pi'],
      8,
    ],
    [['Abs', ['Cos', 'x']], ['Divide', 'Pi', 2], ['Multiply', 5, 'Pi'], 9],
    [['Abs', ['Sin', 'x']], ['Multiply', 2, 'Pi'], 0, -4],
  ] as [ExpressionInput, ExpressionInput, ExpressionInput, ExpressionInput][])(
    '%j on [%j,%j]',
    equal
  );
  test('unsupported nonlinear families are not sampled as if all roots were known', () => {
    expect(
      integral(['Abs', ['Sin', ['Square', 'x']]], 0, 20).has('Integrate')
    ).toBe(true);
  });
  test('the period shortcut for |sin| follows the angular unit', () => {
    const engine = new ComputeEngine();
    engine.angularUnit = 'deg';
    const body = engine.box(['Abs', ['Sin', 'x']]);
    // The period is 360 and one period of |sin| integrates to 720/π
    const closed = integrateDiscrete(
      engine,
      body,
      'x',
      engine.Zero,
      engine.number(360)
    );
    expect(closed).toBeDefined();
    expect(closed!.N().re).toBeCloseTo(720 / Math.PI, 10);
    const result = engine
      .box(['Integrate', body, ['Limits', 'x', 0, 36000]])
      .evaluate();
    expect(result.has('Integrate')).toBe(false);
    expect(result.N().re).toBeCloseTo(72000 / Math.PI, 8);
  });
  test('a constant piecewise factor does not make an infinite-bound integral inert', () => {
    const constant = ce.box([
      'Multiply',
      ['Max', 'a', 'b'],
      ['Abs', ['Subtract', ['Square', 'x'], 1]],
    ]);
    expect(
      integratePiecewise(ce, constant, 'x', ce.Zero, ce.PositiveInfinity)
    ).toBeUndefined();
    // A switching head after a non-affine absolute value is still found.
    const switching = ce.box([
      'Multiply',
      ['Abs', ['Subtract', ['Square', 'x'], 1]],
      ['Floor', 'x'],
    ]);
    expect(
      integratePiecewise(ce, switching, 'x', ce.Zero, ce.PositiveInfinity)
    ).toBe('inert');
  });
  test('the affine infinite-bound path remains available', () => {
    expect(
      integral(['Abs', 'x'], 0, 'PositiveInfinity').isSame(ce.PositiveInfinity)
    ).toBe(true);
  });
  test('a singularity inside an absolute value is not concealed', () => {
    expect(
      integral(['Abs', ['Divide', 1, 'x']], -1, 1).isSame(ce.PositiveInfinity)
    ).toBe(true);
  });
});

describe('integer crossing sums without enumeration', () => {
  test.each([
    [['Fract', 'x'], 0, ['Rational', 2000001, 2], ['Rational', 4000001, 8]],
    [['Floor', 'x'], 0, 1000000, 499999500000],
    [['Ceil', 'x'], 0, 1000000, 500000500000],
    [['Fract', 'x'], ['Rational', 2000001, 2], 0, ['Rational', -4000001, 8]],
    [
      ['Floor', ['Subtract', 1, ['Multiply', 2, 'x']]],
      0,
      1,
      ['Rational', -1, 2],
    ],
    [
      ['Multiply', 'x', ['Fract', 'x']],
      0,
      1000000,
      ['Rational', 750000250000, 3],
    ],
    [['Floor', ['Rational', 3, 2]], 0, 4, 4],
    [['Ceil', 2], 0, 4, 8],
    [
      ['Multiply', ['Add', ['Sqrt', 2], 'x'], ['Floor', ['Add', 1, 'x']]],
      0,
      1,
      ['Add', ['Sqrt', 2], ['Rational', 1, 2]],
    ],
    [['Fract', 'x'], 0, ['Sqrt', 2], ['Subtract', 2, ['Sqrt', 2]]],
  ] as [ExpressionInput, ExpressionInput, ExpressionInput, ExpressionInput][])(
    '%j on [%j,%j]',
    equal
  );
  // Independently enumerate small cells, including negative indices and slopes.
  test.each(['Floor', 'Ceil', 'Fract'])(
    '%s weighted moments agree with cell sums',
    (op) => {
      for (const k of [-3, -1, 1, 2])
        for (const m of [-2, 1]) {
          const a = -2.25,
            b = 3.5;
          const cuts = [a, b];
          for (let n = -20; n <= 20; n++) {
            const x = (n - m) / k;
            if (x > a && x < b) cuts.push(x);
          }
          cuts.sort((x, y) => x - y);
          let expected = 0;
          for (let i = 1; i < cuts.length; i++) {
            const l = cuts[i - 1],
              r = cuts[i];
            const n = Math.floor((k * (l + r)) / 2 + m);
            // Weight 2x+3; floor is constant on each open cell.
            if (op === 'Fract')
              expected +=
                (2 * k * (r ** 3 - l ** 3)) / 3 +
                ((2 * (m - n) + 3 * k) * (r * r - l * l)) / 2 +
                3 * (m - n) * (r - l);
            else
              expected +=
                (n + (op === 'Ceil' ? 1 : 0)) * (r * r - l * l + 3 * (r - l));
          }
          const result = integral(
            [
              'Multiply',
              ['Add', ['Multiply', 2, 'x'], 3],
              [op, ['Add', ['Multiply', k, 'x'], m]],
            ],
            a,
            b
          );
          expect(result.has('Integrate')).toBe(false);
          expect(result.N().re).toBeCloseTo(expected, 10);
        }
    }
  );
});

describe('infinite reciprocal jump sets', () => {
  test('partial first cells and upper bounds beyond the reciprocal scale', () => {
    equal(['Fract', ['Divide', 1, 'x']], 0, 2, [
      'Add',
      1,
      ['Negate', 'EulerGamma'],
      ['Ln', 2],
    ]);
    equal(
      ['Fract', ['Divide', 1, 'x']],
      0,
      ['Rational', 2, 3],
      [
        'Add',
        ['Rational', 4, 3],
        ['Negate', 'EulerGamma'],
        ['Negate', ['Ln', ['Rational', 3, 2]]],
      ]
    );
  });
  test.each([
    [['Fract', ['Divide', 1, 'x']], 0, 1, ['Subtract', 1, 'EulerGamma']],
    [
      ['Fract', ['Divide', 2, 'x']],
      0,
      2,
      ['Multiply', 2, ['Subtract', 1, 'EulerGamma']],
    ],
    [
      ['Fract', ['Divide', 1, 'x']],
      0,
      ['Rational', 1, 2],
      ['Subtract', ['Subtract', ['Rational', 3, 2], 'EulerGamma'], ['Ln', 2]],
    ],
    [['Fract', ['Divide', 1, 'x']], 1, 0, ['Subtract', 'EulerGamma', 1]],
  ] as [ExpressionInput, ExpressionInput, ExpressionInput, ExpressionInput][])(
    '%j on [%j,%j]',
    equal
  );
  test.each(['Floor', 'Ceil'])('%s diverges with correct orientation', (op) => {
    expect(
      integral([op, ['Divide', 2, 'x']], 0, 3).isSame(ce.PositiveInfinity)
    ).toBe(true);
    expect(
      integral([op, ['Divide', 2, 'x']], 3, 0).isSame(ce.NegativeInfinity)
    ).toBe(true);
  });
  test('unproved sign and non-reciprocal families stay inert', () => {
    expect(integral(['Fract', ['Divide', 'a', 'x']]).has('Integrate')).toBe(
      true
    );
    expect(
      integral(['Fract', ['Divide', 1, ['Square', 'x']]]).has('Integrate')
    ).toBe(true);
  });
});

describe('special primitives and hidden substitutions', () => {
  test('a deeper exponential substitution stays closed', () => {
    equal(['Exp', ['Add', 'x', ['Exp', 'x'], ['Exp', ['Exp', 'x']]]], 0, 1, [
      'Subtract',
      ['Exp', ['Exp', ['Exp', 1]]],
      ['Exp', ['Exp', 1]],
    ]);
  });
  test.each(
    (
      [
        ['Erf', 'x'],
        ['Erfc', 'x'],
        ['BesselJ', 1, 'x'],
        ['BesselI', 1, 'x'],
        ['PolyGamma', 0, 'x'],
        ['PolyGamma', 1, 'x'],
        ['Digamma', 'x'],
        ['Trigamma', 'x'],
        ['Erf', ['Add', ['Multiply', 2, 'x'], 1]],
        ['BesselJ', 1, ['Subtract', 2, ['Multiply', 3, 'x']]],
        ['Exp', ['Add', 'x', ['Exp', 'x']]],
      ] as ExpressionInput[]
    ).map((body) => [body])
  )('differentiates back at positive regular points: %j', (body) => {
    const primitive = ce.box(['Integrate', body, 'x']).evaluate();
    expect(primitive.has('Integrate')).toBe(false);
    const derivative = differentiate(primitive, 'x');
    expect(derivative).toBeDefined();
    for (const x of [0.2, 0.7, 1.1]) {
      const residual = derivative!.sub(ce.box(body)).subs({ x }).N();
      expect(residual.re).toBeCloseTo(0, 9);
    }
  });
  test('analytic LogGamma has the digamma derivative', () => {
    expect(
      differentiate(ce.box(['LogGamma', 'x']), 'x')!.isSame(
        ce.box(['Digamma', 'x'])
      )
    ).toBe(true);
  });
  test('positive definite polygamma interval', () =>
    equal(['PolyGamma', 0, 'x'], 1, 3, ['Ln', 2]));
  test('polygamma pole families are not bypassed by FTC', () => {
    for (const bounds of [
      [-2, 1],
      [0, 1],
      [-2, -1],
    ])
      expect(
        integral(['PolyGamma', 0, 'x'], ...(bounds as [number, number])).has(
          'Integrate'
        )
      ).toBe(true);
  });
  test.each([
    [['Rational', -9, 10], ['Rational', -1, 10], 0.010888165336756],
    [['Rational', -19, 10], ['Rational', -3, 2], -0.8561722658431578],
  ] as [ExpressionInput, ExpressionInput, number][])(
    'polygamma interval inside one negative cell [%j, %j]',
    (a, b, value) => {
      const result = integral(['Digamma', 'x'], a, b);
      expect(result.has('Integrate')).toBe(false);
      expect(result.N().re).toBeCloseTo(value, 10);
    }
  );
  test('a polygamma interval that contains a pole stays inert', () => {
    expect(
      integral(['Digamma', 'x'], ['Rational', -3, 2], ['Rational', -1, 2]).has(
        'Integrate'
      )
    ).toBe(true);
  });
  test('nonlinear special-function arguments are not assumed affine', () => {
    expect(integral(['BesselJ', 1, ['Square', 'x']]).has('Integrate')).toBe(
      true
    );
  });
});

describe('convergence-checked Bose moments', () => {
  test('constant multiples and negation preserve the value', () => {
    equal(
      ['Multiply', -3, ['Divide', 'x', ['Subtract', ['Exp', 'x'], 1]]],
      0,
      'PositiveInfinity',
      ['Negate', ['Divide', ['Square', 'Pi'], 2]]
    );
  });
  test.each([
    [1, 1, ['Divide', ['Square', 'Pi'], 6]],
    [2, 1, ['Multiply', 2, ['Zeta', 3]]],
    [3, 1, ['Divide', ['Power', 'Pi', 4], 15]],
    [1, 2, ['Divide', ['Square', 'Pi'], 24]],
  ] as [number, number, ExpressionInput][])(
    'moment %s with scale %s',
    (n, a, expected) => {
      const f: ExpressionInput = [
        'Divide',
        ['Power', 'x', n],
        ['Subtract', ['Exp', ['Multiply', a, 'x']], 1],
      ];
      equal(f, 0, 'PositiveInfinity', expected);
      equal(f, 'PositiveInfinity', 0, ['Negate', expected]);
    }
  );
  test('zeroth moment diverges', () => {
    expect(
      integral(
        ['Divide', 1, ['Subtract', ['Exp', 'x'], 1]],
        0,
        'PositiveInfinity'
      ).isSame(ce.PositiveInfinity)
    ).toBe(true);
  });
  test.each([-1, 'a', 'ImaginaryUnit'])(
    'unproved decay (%s) is rejected by the reduction',
    (a) => {
      const f = ce.box([
        'Divide',
        'x',
        ['Subtract', ['Exp', ['Multiply', a, 'x']], 1],
      ]);
      expect(
        integrateBoseMoment(f, 'x', ce.Zero, ce.PositiveInfinity)
      ).toBeUndefined();
    }
  );
});

describe('provider endpoint fallback', () => {
  test('an inert provider answer is not recursively evaluated during endpoint probing', () => {
    const engine = new ComputeEngine();
    const provider = jest.fn((body, variable) =>
      engine.function('Integrate', [body, engine.symbol(variable)])
    );
    engine._integrationProvider = provider;
    expect(integral('x', 0, 1, engine).json).toEqual(['Rational', 1, 2]);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  test('unusable primitive falls back without unregistering the provider', () => {
    const engine = new ComputeEngine();
    const provider = jest.fn(() => engine.NaN);
    engine._integrationProvider = provider;
    expect(integral('x', 0, 1, engine).json).toEqual(['Rational', 1, 2]);
    expect(engine._integrationProvider).toBe(provider);
    expect(provider).toHaveBeenCalled();
  });
  test('fallback still checks interior poles', () => {
    const engine = new ComputeEngine();
    engine._integrationProvider = () => engine.NaN;
    expect(
      integral(['Power', 'x', -2], -1, 1, engine).isSame(
        engine.PositiveInfinity
      )
    ).toBe(true);
  });
  test('provider cancellation propagates', () => {
    const engine = new ComputeEngine();
    engine._integrationProvider = () => {
      throw new CancellationError();
    };
    expect(() => integral('x', 0, 1, engine)).toThrow(CancellationError);
  });
});

describe('new integration reductions respect bindings and budgets', () => {
  test('an assigned integration variable remains bound', () => {
    const engine = new ComputeEngine();
    engine.assign('x', 8);
    expect(integral(['Fract', 'x'], 0, 1000000, engine).isSame(500000)).toBe(
      true
    );
    expect(engine.box('x').evaluate().isSame(8)).toBe(true);
  });
  test('a shadowed output constant cannot enter a closed formula', () => {
    const engine = new ComputeEngine();
    engine.declare('EulerGamma', { value: 100 });
    expect(
      integral(['Fract', ['Divide', 1, 'x']], 0, 1, engine).has('Integrate')
    ).toBe(true);
  });
  test('the deterministic evaluation budget still applies', () => {
    const engine = new ComputeEngine();
    expect(() =>
      engine.withStepBudget({ steps: 0 }, () =>
        integral(['Fract', 'x'], 0, 1000000, engine)
      )
    ).toThrow(CancellationError);
  });
});
