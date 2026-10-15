import { ComputeEngine, compile } from '../../src/compute-engine';
import { differentiate } from '../../src/compute-engine/symbolic/derivative';
import { withRadianConvention } from '../../src/compute-engine/symbolic/angular-unit';
import { loadIntegrationRules } from '../../src/integration-rules';

/**
 * The symbolic integrator holds the RADIAN antiderivatives. In another
 * angular unit, `Sin(x)` denotes `sin(k·x)` with `k` the chain factor to
 * radians (`π/180` in degree mode), so `∫ sin x dx` is `−cos(x)/k`. Before
 * this was fixed, the antiderivative was the radian `−cos x` in every unit,
 * while the derivative already carried the factor: `∫₀^{180} sin x dx` was
 * `2` in degree mode, where it is `360/π`, and `∫ sin x cos x dx` was a
 * series of powers of `π` because a unit-aware derivative was combined with
 * unit-blind rules inside the substitution route.
 */

type AngularUnit = 'rad' | 'deg' | 'grad' | 'turn';

/** The chain factor `k` to radians, as a number. */
const CHAIN: Record<AngularUnit, number> = {
  rad: 1,
  deg: Math.PI / 180,
  grad: Math.PI / 200,
  turn: 2 * Math.PI,
};

function engine(unit: AngularUnit): ComputeEngine {
  const ce = new ComputeEngine();
  ce.angularUnit = unit;
  return ce;
}

const UNITS: AngularUnit[] = ['deg', 'grad', 'turn'];

describe('ANTIDERIVATIVES IN A NON-RADIAN ANGULAR UNIT', () => {
  test.each(UNITS)('%s: the antiderivative of sin x carries 1/k', (unit) => {
    const ce = engine(unit);
    const F = ce.box(['Integrate', ['Sin', 'x'], 'x']).evaluate();
    expect(F.has('Integrate')).toBe(false);
    // F = −cos(x)/k: at x = 0 the value is −1/k
    expect(F.subs({ x: 0 }).N().re).toBeCloseTo(-1 / CHAIN[unit], 10);
    expect(ce.angularUnit).toBe(unit);
  });

  // The derivative of the antiderivative is the integrand, at sample points
  // and in the engine's unit: this checks both directions of the convention.
  const INTEGRANDS: [string, any][] = [
    ['sin x', ['Sin', 'x']],
    ['cos x', ['Cos', 'x']],
    ['sin x cos x', ['Multiply', ['Sin', 'x'], ['Cos', 'x']]],
    ['x sin x', ['Multiply', 'x', ['Sin', 'x']]],
    ['sin^2 x', ['Power', ['Sin', 'x'], 2]],
    ['sin(2x + 30)', ['Sin', ['Add', ['Multiply', 2, 'x'], 30]]],
    ['tan x', ['Tan', 'x']],
    ['e^x sin x', ['Multiply', ['Exp', 'x'], ['Sin', 'x']]],
    ['1/(1 + x^2)', ['Divide', 1, ['Add', 1, ['Square', 'x']]]],
    ['arctan x', ['Arctan', 'x']],
    ['sin(2) x', ['Multiply', ['Sin', 2], 'x']],
  ];
  for (const unit of UNITS)
    test.each(INTEGRANDS)(
      `${unit}: d/dx ∫ %s dx is the integrand`,
      (_label, body) => {
        const ce = engine(unit);
        const F = ce.box(['Integrate', body, 'x']).evaluate();
        expect(F.has('Integrate')).toBe(false);
        const dF = differentiate(F, 'x');
        expect(dF).toBeDefined();
        for (const x of [0.3, 1.7, 2.9]) {
          const residual = dF!.sub(ce.box(body)).subs({ x }).N();
          expect(residual.re).toBeCloseTo(0, 9);
        }
        expect(ce.angularUnit).toBe(unit);
      }
    );

  test('deg: a definite integral over a half turn', () => {
    const ce = engine('deg');
    const r = ce
      .box(['Integrate', ['Sin', 'x'], ['Limits', 'x', 0, 180]])
      .evaluate();
    expect(r.isEqual(ce.box(['Divide', 360, 'Pi']))).toBe(true);
    expect(r.N().re).toBeCloseTo(360 / Math.PI, 10);
  });

  test('grad and turn: a definite integral over a half turn', () => {
    expect(
      engine('grad')
        .box(['Integrate', ['Sin', 'x'], ['Limits', 'x', 0, 200]])
        .evaluate()
        .N().re
    ).toBeCloseTo(400 / Math.PI, 10);
    expect(
      engine('turn')
        .box([
          'Integrate',
          ['Sin', 'x'],
          ['Limits', 'x', 0, ['Rational', 1, 2]],
        ])
        .evaluate()
        .N().re
    ).toBeCloseTo(1 / Math.PI, 10);
  });

  test('deg: an inverse trigonometric result carries k', () => {
    const ce = engine('deg');
    // ∫₀¹ dx/(1 + x²) = (π/180)·arctan(1) = (π/180)·45 = π/4
    const r = ce
      .box([
        'Integrate',
        ['Divide', 1, ['Add', 1, ['Square', 'x']]],
        ['Limits', 'x', 0, 1],
      ])
      .evaluate();
    expect(r.isEqual(ce.box(['Divide', 'Pi', 4]))).toBe(true);
  });

  test('deg: the absolute sine over many periods', () => {
    const ce = engine('deg');
    const r = ce
      .box(['Integrate', ['Abs', ['Sin', 'x']], ['Limits', 'x', 0, 360]])
      .evaluate();
    expect(r.has('Integrate')).toBe(false);
    expect(r.N().re).toBeCloseTo(720 / Math.PI, 10);
  });

  test('deg: a degree literal in the integrand and at a bound', () => {
    const ce = engine('deg');
    // ∫₀^{90°} sin(x + 90°) dx = ∫₀^{90°} cos x dx = (180/π)
    const r = ce
      .box([
        'Integrate',
        ['Sin', ['Add', 'x', ['Degrees', 90]]],
        ['Limits', 'x', 0, ['Degrees', 90]],
      ])
      .evaluate();
    expect(r.has('Integrate')).toBe(false);
    expect(r.N().re).toBeCloseTo(180 / Math.PI, 10);
  });

  test('deg: a trigonometric constant keeps its value in the unit', () => {
    const ce = engine('deg');
    // sin(2) is sin(2°) in degree mode, on both sides
    const F = ce
      .box(['Integrate', ['Multiply', ['Sin', 2], 'x'], 'x'])
      .evaluate();
    expect(F.subs({ x: 2 }).N().re).toBeCloseTo(2 * Math.sin(Math.PI / 90), 12);
  });

  test('deg: the unit is restored when the integration throws', () => {
    const ce = engine('deg');
    let seen: string | undefined;
    expect(() =>
      withRadianConvention(ce.box(['Sin', 'x']), 'x', () => {
        seen = ce.angularUnit;
        throw new Error('interrupted');
      })
    ).toThrow('interrupted');
    expect(seen).toBe('rad');
    expect(ce.angularUnit).toBe('deg');
  });

  test('deg: a user function applied in the integrand is inlined before the rewrite', () => {
    const ce = engine('deg');
    ce.assign('g', ['Function', ['Sin', 't'], 't']);
    const F = ce.box(['Integrate', ['g', 'x'], 'x']).evaluate();
    expect(F.has('Integrate')).toBe(false);
    expect(F.subs({ x: 180 }).N().re - F.subs({ x: 0 }).N().re).toBeCloseTo(
      360 / Math.PI,
      9
    );
  });

  test('deg: a symbol whose value is a trigonometric constant keeps its degree value', () => {
    const ce = engine('deg');
    ce.assign('c', ['Sin', 30]);
    const F = ce.box(['Integrate', ['Multiply', 'c', 'x'], 'x']).evaluate();
    // c = sin(30°) = 1/2, so F = x²/4
    expect(F.subs({ x: 2 }).N().re).toBeCloseTo(1, 12);
    expect(ce.box('c').N().re).toBeCloseTo(0.5, 12);
  });

  test('deg: an angle written as DMS in the integrand', () => {
    const ce = engine('deg');
    const r = ce
      .box([
        'Integrate',
        ['Sin', ['Add', 'x', ['DMS', 90, 0]]],
        ['Limits', 'x', 0, 90],
      ])
      .evaluate();
    expect(r.has('Integrate')).toBe(false);
    expect(r.N().re).toBeCloseTo(180 / Math.PI, 10);
  });

  test('deg: the compiled closed form agrees with the interpreter', () => {
    const ce = engine('deg');
    const one = ce.box(['Integrate', ['Sin', 't'], ['Limits', 't', 0, 'x']]);
    const r1 = compile(one, { to: 'javascript' } as any) as any;
    expect(r1.success).toBe(true);
    expect(r1.run({ x: 180 })).toBeCloseTo(360 / Math.PI, 9);
    const two = ce.box([
      'Integrate',
      ['Multiply', 't', ['Sin', 't']],
      ['Limits', 't', 0, 'x'],
    ]);
    const r2 = compile(two, { to: 'javascript' } as any) as any;
    expect(r2.success).toBe(true);
    expect(r2.run({ x: 90 })).toBeCloseTo(two.subs({ x: 90 }).N().re, 6);
  });

  test('deg: the Rubi integration rules follow the unit too', () => {
    const ce = engine('deg');
    loadIntegrationRules(ce);
    const r = ce
      .box(['Integrate', ['Sin', 'x'], ['Limits', 'x', 0, 180]])
      .evaluate();
    expect(r.isEqual(ce.box(['Divide', 360, 'Pi']))).toBe(true);
    const F = ce
      .box(['Integrate', ['Multiply', 'x', ['Sin', 'x']], 'x'])
      .evaluate();
    expect(F.has('Integrate')).toBe(false);
    const dF = differentiate(F, 'x')!;
    for (const x of [0.3, 1.7])
      expect(
        dF
          .sub(ce.box(['Multiply', 'x', ['Sin', 'x']]))
          .subs({ x })
          .N().re
      ).toBeCloseTo(0, 9);
  }, 60000);

  test('rad: unchanged', () => {
    const ce = engine('rad');
    expect(
      ce
        .box(['Integrate', ['Sin', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('-cos(x)');
    expect(
      ce
        .box(['Integrate', ['Sin', 'x'], ['Limits', 'x', 0, 'Pi']])
        .evaluate()
        .toString()
    ).toBe('2');
  });
});
