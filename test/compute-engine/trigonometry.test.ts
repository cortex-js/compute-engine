import { engine } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';

describe('TRIGONOMETRY constructible values', () => {
  for (const h of ['Sin', 'Cos', 'Tan', 'Csc', 'Sec', 'Cot']) {
    for (const [n, d] of [
      [0, 1],
      [1, 12],
      [1, 10],
      [1, 8],
      [1, 6],
      [1, 5],
      [1, 4],
      [1, 3],
      [3, 8],
      [2, 5],
      [5, 12],
      [1, 2],
    ]) {
      for (const p of [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]) {
        const theta = (Math.PI * n) / d + (Math.PI / 2) * p;
        let jsValue =
          h === 'Cos'
            ? Math.cos(theta)
            : h === 'Sin'
            ? Math.sin(theta)
            : h === 'Tan'
            ? Math.tan(theta)
            : h === 'Sec'
            ? 1 / Math.cos(theta)
            : h === 'Csc'
            ? 1 / Math.sin(theta)
            : h === 'Cot'
            ? 1 / Math.tan(theta)
            : NaN;

        // const arg = engine
        //   .expr([
        //     'Add',
        //     ['Multiply', p, 'Half', 'Pi'],
        //     ['Multiply', 'Pi', ['Rational', n, d]],
        //   ])
        //   .simplify();
        const arg = engine
          .expr([
            'Multiply',
            'Pi',
            ['Add', ['Rational', p, 2], ['Rational', n, d]],
          ])
          .simplify();

        // Use evaluate to get the exact value (using N() directly could bypass
        // the constructible value logic)
        const fExact = engine.expr([h, arg]).evaluate();

        // Reduce the exact value to a number
        const fNumeric = fExact.N();

        // The numeric and exact values should be the same

        test(`${h}(${arg.toString()}) exact = numeric`, () =>
          expect(fNumeric.isEqual(fExact)).toBeTruthy());

        if (
          fNumeric.symbol === 'ComplexInfinity' ||
          (typeof fNumeric.numericValue !== 'number' &&
            fNumeric.numericValue?.isComplexInfinity)
        ) {
          test(`${h}(${arg.toString()})`, () =>
            expect(Math.abs(jsValue) > 1e6).toBeTruthy());
        } else {
          let f = fNumeric.re ?? NaN;

          if (Math.abs(f) > 1000000) f = +Infinity;
          if (Math.abs(jsValue) > 1000000) jsValue = +Infinity;

          test(`${h}(${arg.toString()})`, () => {
            if (!Number.isFinite(Math.abs(f - jsValue))) {
              let expr = engine.expr([h, arg]);
              expr = expr.evaluate();
              const again = fExact.N();
              console.error('Invalid trig result', fNumeric.toString());
            }
            expect(Math.abs(f - jsValue)).toBeCloseTo(0, 10);
          });
        }
      }
    }
  }
});

describe('TRIGONOMETRY other values', () => {
  test(`arccos`, () =>
    expect(engine.parse('\\cos^{-1}(0.1)').N()).toMatchInlineSnapshot(
      `1.470628905633336822885798512187058123529908727457923369096448441117505529492241947660079548311554079`
    ));
});

describe('Arctan2 quadrant correction (REVIEW.md B1)', () => {
  // Before the fix, the exact (non-numericApproximation) evaluate path
  // returned Arctan(y/x) with no ±π quadrant correction, so evaluate()
  // disagreed with .N() for x < 0 — e.g. Arctan2(1, -1) evaluated to −π/4
  // instead of 3π/4.
  for (const [y, x] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [0, 0],
    [3, -4],
    [-3, -4],
  ] as [number, number][]) {
    test(`Arctan2(${y}, ${x}) matches Math.atan2`, () => {
      const evaluated = engine.expr(['Arctan2', y, x]).evaluate();
      expect(evaluated.N().re).toBeCloseTo(Math.atan2(y, x), 12);
    });
  }

  test('indeterminate-sign arguments stay unevaluated', () => {
    // Symbols of unknown sign cannot be assigned a quadrant.
    expect(engine.expr(['Arctan2', 'a', 'b']).evaluate().operator).toBe(
      'Arctan2'
    );
  });
});

describe('Arctan2 three-valued sign discipline (P0-9 / SYMBOLIC P0-6)', () => {
  // The evaluate handler (library/trigonometry.ts) and the simplify rule
  // (symbolic/simplify-rules.ts) both had fail-open sign guards: a NaN operand
  // slipped through the `isFinite === false` checks into a definite ±π/2/π
  // branch, and the simplify rule fired the `Arctan(y/x)` fallback (only valid
  // for x > 0) unconditionally. Both faces must now agree with Math.atan2.

  // Full quadrant table: evaluate(), simplify().N(), and N() must all agree.
  for (const [y, x] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [0, 0],
  ] as [number, number][]) {
    const truth = Math.atan2(y, x);
    test(`Arctan2(${y}, ${x}): evaluate / simplify().N() / N() agree with Math.atan2`, () => {
      expect(engine.expr(['Arctan2', y, x]).evaluate().N().re).toBeCloseTo(
        truth,
        12
      );
      expect(engine.expr(['Arctan2', y, x]).simplify().N().re).toBeCloseTo(
        truth,
        12
      );
      expect(engine.expr(['Arctan2', y, x]).N().re).toBeCloseTo(truth, 12);
    });
  }

  test('headline repro: Arctan2(1, -1).simplify() = 3π/4 (was −π/4)', () => {
    // Fail-open fallback previously returned arctan(-1) = −π/4; the correct
    // quadrant-II angle is 3π/4.
    expect(engine.expr(['Arctan2', 1, -1]).simplify().N().re).toBeCloseTo(
      (3 * Math.PI) / 4,
      12
    );
  });

  test('unknown-sign second argument stays symbolic under simplify', () => {
    // Arctan2(0, x) with x of unknown sign must NOT collapse to π.
    expect(engine.expr(['Arctan2', 0, 'x']).simplify().operator).toBe(
      'Arctan2'
    );
    // Fully symbolic operands stay symbolic too.
    expect(engine.expr(['Arctan2', 'x', 'y']).simplify().operator).toBe(
      'Arctan2'
    );
  });

  test('Arctan2(0, x) simplifies under a positive assumption', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Greater', 'x', 0]));
    expect(ce.box(['Arctan2', 0, 'x']).simplify().N().re).toBeCloseTo(0, 12);
  });

  test('Arctan2(0, x) simplifies under a negative assumption', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Less', 'x', 0]));
    expect(ce.box(['Arctan2', 0, 'x']).simplify().N().re).toBeCloseTo(
      Math.PI,
      12
    );
  });

  // NaN in → NaN out, in evaluate, simplify, AND N (they previously disagreed:
  // evaluate → −π/2 / π, N → symbolic).
  for (const [y, x] of [
    [NaN, 2],
    [2, NaN],
    [NaN, NaN],
  ] as [number, number][]) {
    test(`Arctan2(${y}, ${x}) → NaN in evaluate, simplify and N`, () => {
      expect(engine.expr(['Arctan2', y, x]).evaluate().isNaN).toBe(true);
      expect(engine.expr(['Arctan2', y, x]).simplify().isNaN).toBe(true);
      expect(engine.expr(['Arctan2', y, x]).N().isNaN).toBe(true);
    });
  }

  test('complex operand: evaluate and N behave identically (stay symbolic)', () => {
    // atan2 is a real-plane function; a non-real operand has no well-defined
    // quadrant. evaluate() previously continued analytically (0.549i) while
    // N() silently dropped the imaginary part (0). Both must now stay symbolic.
    const ev = engine.expr(['Arctan2', 'i', 2]).evaluate();
    const n = engine.expr(['Arctan2', 'i', 2]).N();
    expect(ev.operator).toBe('Arctan2');
    expect(n.operator).toBe('Arctan2');
    expect(engine.expr(['Arctan2', 'i', 2]).simplify().operator).toBe(
      'Arctan2'
    );
  });
});

// ROADMAP B3: arctan's horizontal asymptotes, needed so improper integrals
// of the 1/(a²+x²) family evaluate (∫₀^∞ 1/(1+x²) = arctan(∞) = π/2).
describe('Arctan at ±∞', () => {
  test('arctan(+∞) = π/2 (exact under evaluate)', () =>
    expect(engine.expr(['Arctan', engine.PositiveInfinity]).evaluate().json).toEqual([
      'Multiply',
      ['Rational', 1, 2],
      'Pi',
    ]));
  test('arctan(−∞) = −π/2', () =>
    expect(
      engine.expr(['Arctan', engine.NegativeInfinity]).evaluate().json
    ).toEqual(['Multiply', ['Rational', -1, 2], 'Pi']));
  test('arctan(+∞).N() = 1.5707…', () =>
    expect(engine.expr(['Arctan', engine.PositiveInfinity]).N().re).toBeCloseTo(
      Math.PI / 2,
      10
    ));
});

// REVIEW.md B20: the Degrees canonical handler reduced literals mod 360 while
// the evaluate handler did not, so the same operator denoted different values.
// Degrees is now a faithful linear conversion (no reduction) in both paths;
// range normalization is a serialization concern (`angleNormalization`).
describe('Degrees is a faithful conversion (REVIEW.md B20)', () => {
  it('literal and symbolic args agree (no mod-360 reduction)', () => {
    const ce = new ComputeEngine();
    ce.assign('b20', 390);
    const symbolic = ce.expr(['Degrees', 'b20']).evaluate().N().re;
    const literal = ce.expr(['Degrees', 390]).N().re;
    const faithful = (390 * Math.PI) / 180; // 13π/6 ≈ 6.807, NOT π/6
    expect(literal).toBeCloseTo(faithful, 10);
    expect(symbolic).toBeCloseTo(literal, 10);
  });
});
