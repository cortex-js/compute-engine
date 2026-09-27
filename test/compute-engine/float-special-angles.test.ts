import { ComputeEngine } from '../../src/compute-engine';

//
// A float multiple of π that is a special angle is exact, in every angular
// unit (user decision, 2026-09-27). The float coefficient is read as the
// rational `p/q` when it is within one unit in its last place of `p/q`, with
// `q` a denominator of the special angles (1, 2, 3, 4, 5, 6, 8, 10, 12):
// `0.25·π` is `π/4`. Another float stays a float, and `.N()` gives a float.
//
// The exponent of `e` is in radians in every unit. The argument of `Sin`,
// `Cos` and `Tan` is in the engine's unit, so `\sin(0.25\pi)` is a special
// angle only in radians.
//

const UNITS = ['rad', 'deg', 'turn'] as const;

// [LaTeX, exact value, the angle in radians]
const EULER: [string, string, number][] = [
  ['e^{0.25i\\pi}', '(sqrt(2)/2 + sqrt(2)/2i)', 0.25 * Math.PI],
  ['e^{0.5i\\pi}', 'i', 0.5 * Math.PI],
  ['e^{1.0i\\pi}', '-1', Math.PI],
  ['e^{-0.75i\\pi}', '(-sqrt(2)/2 - sqrt(2)/2i)', -0.75 * Math.PI],
  ['e^{\\frac{1}{4}i\\pi}', '(sqrt(2)/2 + sqrt(2)/2i)', 0.25 * Math.PI],
];

describe('e^{iθ} with a float multiple of π', () => {
  for (const unit of UNITS) {
    describe(`in ${unit}`, () => {
      const ce = new ComputeEngine();
      ce.angularUnit = unit;
      for (const [latex, exact, theta] of EULER) {
        test(`${latex} is exact`, () => {
          const value = ce.parse(latex).evaluate();
          expect(value.toString()).toBe(exact);
          // The exact value agrees with the float computation
          const n = value.N();
          expect(n.re).toBeCloseTo(Math.cos(theta), 14);
          expect(n.im).toBeCloseTo(Math.sin(theta), 14);
          // `.N()` of the input is a float
          const direct = ce.parse(latex).N();
          expect(direct.re).toBeCloseTo(Math.cos(theta), 14);
          expect(direct.im).toBeCloseTo(Math.sin(theta), 14);
        });
      }

      test('3π/10 is a special angle', () => {
        const value = ce.parse('e^{0.3i\\pi}').evaluate();
        expect(value.toString()).toBe(
          'sqrt(2)/4 * sqrt(5 - sqrt(5)) + i * (1/4 + sqrt(5)/4)'
        );
        expect(value.N().re).toBeCloseTo(Math.cos(0.3 * Math.PI), 14);
        expect(value.N().im).toBeCloseTo(Math.sin(0.3 * Math.PI), 14);
      });

      test('a float that is not a special angle stays a float', () => {
        for (const c of [0.35, 0.123, 0.45]) {
          const value = ce.parse(`e^{${c}i\\pi}`).evaluate();
          expect(value.isExact).toBe(false);
          expect(value.re).toBeCloseTo(Math.cos(c * Math.PI), 14);
          expect(value.im).toBeCloseTo(Math.sin(c * Math.PI), 14);
        }
      });
    });
  }

  test('a machine coefficient within one unit in the last place', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    // The double `0.1 + 0.2` is `0.30000000000000004`, one unit in the last
    // place from the double nearest `0.3`
    const exp = ce
      .function('Exp', [
        ce.function('Multiply', [ce.number(ce.complex(0, 0.1 + 0.2)), ce.Pi]),
      ])
      .evaluate();
    expect(exp.toString()).toBe(
      'sqrt(2)/4 * sqrt(5 - sqrt(5)) + i * (1/4 + sqrt(5)/4)'
    );
    // Two units in the last place from `1/4` is not `1/4`
    const near = 0.25 + 2 * Number.EPSILON;
    const exp2 = ce
      .function('Exp', [
        ce.function('Multiply', [ce.number(ce.complex(0, near)), ce.Pi]),
      ])
      .evaluate();
    expect(exp2.isExact).toBe(false);
  });

  test('above machine precision, the unit in the last place is smaller', () => {
    // At 21 digits `0.30000000000000004` is 4·10⁻¹⁷ from `3/10`, more than
    // one unit in the last place
    const ce = new ComputeEngine();
    const exp = ce.parse('e^{0.30000000000000004i\\pi}').evaluate();
    expect(exp.isExact).toBe(false);
    expect(exp.re).toBeCloseTo(Math.cos(0.3 * Math.PI), 14);
  });
});

describe('Sin, Cos and Tan of a float multiple of π in radians', () => {
  const ce = new ComputeEngine();
  const cases: [string, string, number][] = [
    ['\\sin(0.25\\pi)', 'sqrt(2)/2', Math.sin(0.25 * Math.PI)],
    ['\\cos(0.25\\pi)', 'sqrt(2)/2', Math.cos(0.25 * Math.PI)],
    ['\\tan(0.25\\pi)', '1', 1],
    ['\\sin(0.5\\pi)', '1', 1],
    ['\\cos(1.0\\pi)', '-1', -1],
    ['\\sin(-0.75\\pi)', '-sqrt(2)/2', Math.sin(-0.75 * Math.PI)],
    ['\\cos(0.125\\pi)', '1/2 * sqrt(2 + sqrt(2))', Math.cos(0.125 * Math.PI)],
    ['\\sin(0.3\\pi)', '1/4 + sqrt(5)/4', Math.sin(0.3 * Math.PI)],
  ];
  for (const [latex, exact, value] of cases) {
    test(`${latex} is exact`, () => {
      const result = ce.parse(latex).evaluate();
      expect(result.toString()).toBe(exact);
      expect(result.N().re).toBeCloseTo(value, 14);
      expect(ce.parse(latex).N().re).toBeCloseTo(value, 14);
      expect(ce.parse(latex).N().isNumberLiteral).toBe(true);
    });
  }

  test('a float that is not a special angle stays a float', () => {
    for (const [latex, value] of [
      ['\\sin(0.35\\pi)', Math.sin(0.35 * Math.PI)],
      ['\\cos(0.123\\pi)', Math.cos(0.123 * Math.PI)],
      ['\\tan(0.45\\pi)', Math.tan(0.45 * Math.PI)],
    ] as const) {
      const result = ce.parse(latex).evaluate();
      expect(result.isExact).toBe(false);
      expect(result.re).toBeCloseTo(value, 12);
    }
  });
});

describe('Sin and Cos of a float multiple of π in another unit', () => {
  // `0.25·π` degrees (or turns) is not a special angle
  for (const unit of ['deg', 'turn'] as const) {
    test(`in ${unit}`, () => {
      const ce = new ComputeEngine();
      ce.angularUnit = unit;
      const scale = unit === 'deg' ? Math.PI / 180 : 2 * Math.PI;
      const result = ce.parse('\\cos(0.25\\pi)').evaluate();
      expect(result.isExact).toBe(false);
      expect(result.re).toBeCloseTo(Math.cos(0.25 * Math.PI * scale), 14);
    });
  }
});

describe('e^{iθ} with a float multiple of π above 2^53', () => {
  // The number of half-turns has a numerator above 2^53. It is reduced
  // modulo a full turn as a bigint: converted to a double, it loses its
  // parity, and `e^{1152921504606846977.25·iπ}` was `1`. The value agrees
  // with `Cos` and `Sin` of the same angle.
  const ce = new ComputeEngine();
  ce.precision = 50;
  for (const [c, exact] of [
    ['1152921504606846977.25', '(-sqrt(2)/2 - sqrt(2)/2i)'],
    ['1152921504606846976.25', '(sqrt(2)/2 + sqrt(2)/2i)'],
    ['-1152921504606846977.75', '(sqrt(2)/2 + sqrt(2)/2i)'],
    ['9007199254740993.5', '-i'],
  ] as const) {
    test(`e^{${c}·πi}`, () => {
      const value = ce.parse(`e^{${c}\\pi i}`).evaluate();
      expect(value.toString()).toBe(exact);
      const cos = ce.parse(`\\cos(${c}\\pi)`).evaluate();
      const sin = ce.parse(`\\sin(${c}\\pi)`).evaluate();
      expect(value.N().re).toBeCloseTo(cos.N().re, 14);
      expect(value.N().im).toBeCloseTo(sin.N().re, 14);
    });
  }
});
