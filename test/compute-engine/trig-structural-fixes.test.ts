import { ComputeEngine } from '../../src/compute-engine';

//
// Fixes that follow the STRUCTURAL recognition of trigonometric special
// values: only an exact rational multiple of π (a half-turn) is a special
// angle, and a float argument is never special. Each value below was checked
// against mpmath at 40 digits.
//

describe('e^{iθ} for a float multiple of π', () => {
  // The exponent of `Power` arrives evaluated, and the evaluation of
  // `0.5·i·π` is the machine complex `1.5707963267948966i`, whose cosine is
  // `1.9e-17`. The imaginary factor is read from the raw exponent instead.
  for (const precision of [21, 15] as const) {
    test(`at precision ${precision}`, () => {
      const ce = new ComputeEngine();
      ce.precision = precision;
      const evaluate = (s: string) => ce.parse(s).evaluate().toString();
      expect(evaluate('e^{0.5i\\pi}')).toBe('i');
      expect(evaluate('e^{1.5i\\pi}')).toBe('-i');
      expect(evaluate('e^{-0.5i\\pi}')).toBe('-i');
      expect(evaluate('e^{2.5i\\pi}')).toBe('i');
      expect(evaluate('e^{i\\pi/2}')).toBe('i');
      expect(evaluate('e^{i\\pi}')).toBe('-1');
      const exp = ce
        .function('Exp', [
          ce.function('Multiply', [ce.number(ce.complex(0, 0.5)), ce.Pi]),
        ])
        .evaluate();
      expect(exp.toString()).toBe('i');

      // Not a multiple of a quarter-turn: a float, with no rounding dust
      // beyond the precision of the result.
      const eighth = ce.parse('e^{0.25i\\pi}').evaluate();
      expect(eighth.isExact).toBe(false);
      expect(Math.abs(eighth.re - Math.SQRT1_2)).toBeLessThan(1e-15);
      expect(Math.abs(eighth.im - Math.SQRT1_2)).toBeLessThan(1e-15);
    });
  }

  test('in another angular unit', () => {
    for (const unit of ['deg', 'grad', 'turn'] as const) {
      const ce = new ComputeEngine();
      ce.angularUnit = unit;
      const evaluate = (s: string) => ce.parse(s).evaluate().toString();
      expect([unit, evaluate('e^{0.5i\\pi}')]).toEqual([unit, 'i']);
      expect([unit, evaluate('e^{i\\pi/3}')]).toEqual([
        unit,
        '1/2 + sqrt(3)/2i',
      ]);
      // A float angle that is not a multiple of π: `cos 0.3 + i·sin 0.3`,
      // whatever the unit (the exponent is in radians). It was left as
      // `cos(0.0477…/π)` in turn mode.
      const v = ce.parse('e^{0.3i}').evaluate();
      expect([unit, v.re]).toEqual([unit, expect.closeTo(Math.cos(0.3), 15)]);
      expect([unit, v.im]).toEqual([unit, expect.closeTo(Math.sin(0.3), 15)]);
    }
  });
});

describe('an inverse trigonometric function of a float in another unit', () => {
  // The kernel runs with guard digits and its value is converted to the
  // unit before it is rounded: in degrees `Arcsin(0.5)` is `30`, not
  // `30.000000000000004`, and the other values have 21 correct digits.
  const cases: [string, number, Record<'deg' | 'grad' | 'turn', string>][] = [
    [
      'Arcsin',
      0.5,
      {
        deg: '30',
        grad: '33.3333333333333333333',
        turn: '0.0833333333333333333333',
      },
    ],
    [
      'Arccos',
      0.5,
      {
        deg: '60',
        grad: '66.6666666666666666667',
        turn: '0.166666666666666666667',
      },
    ],
    [
      'Arctan',
      0.5,
      {
        deg: '26.5650511770779893516',
        grad: '29.5167235300866548351',
        turn: '0.0737918088252166370877',
      },
    ],
    [
      'Arcsin',
      0.7071067811865476,
      {
        deg: '45.0000000000000061257',
        grad: '50.0000000000000068063',
        turn: '0.125000000000000017016',
      },
    ],
    [
      'Arccos',
      0.7071067811865476,
      {
        deg: '44.9999999999999938743',
        grad: '49.9999999999999931937',
        turn: '0.124999999999999982984',
      },
    ],
    [
      'Arctan',
      0.7071067811865476,
      {
        deg: '35.2643896827546572031',
        grad: '39.1826552030607302256',
        turn: '0.097956638007651825564',
      },
    ],
    [
      'Arcsin',
      0.3,
      {
        deg: '17.4576031237220922902',
        grad: '19.3973368041356581003',
        turn: '0.0484933420103391452507',
      },
    ],
    [
      'Arccos',
      0.3,
      {
        deg: '72.5423968762779077098',
        grad: '80.6026631958643418997',
        turn: '0.201506657989660854749',
      },
    ],
    [
      'Arctan',
      0.3,
      {
        deg: '16.6992442339936218404',
        grad: '18.5547158155484687115',
        turn: '0.0463867895388711717788',
      },
    ],
  ];
  test.each(cases)('%s(%s)', (head, x, expected) => {
    for (const unit of ['deg', 'grad', 'turn'] as const) {
      const ce = new ComputeEngine();
      ce.angularUnit = unit;
      const value = ce.function(head, [ce.number(x)]);
      expect([unit, value.evaluate().toString()]).toEqual([
        unit,
        expected[unit],
      ]);
      expect([unit, value.N().toString()]).toEqual([unit, expected[unit]]);
    }
  });

  test('an exact argument keeps an exact angle', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    expect(ce.box(['Arctan', 1]).evaluate().toString()).toBe('45');
    expect(
      ce
        .box(['Arcsin', ['Rational', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('30');
  });
});

describe('a degree literal', () => {
  test('in radians and in degrees', () => {
    for (const unit of ['rad', 'deg'] as const) {
      const ce = new ComputeEngine();
      ce.angularUnit = unit;
      expect([
        unit,
        ce.parse('\\sin(30^\\circ)').evaluate().toString(),
      ]).toEqual([unit, '1/2']);
      expect([
        unit,
        ce.parse('\\cos(60^\\circ)').evaluate().toString(),
      ]).toEqual([unit, '1/2']);
    }
  });
});

describe('poles and dust at the working precision', () => {
  const ce = new ComputeEngine();

  test('a value that is large because the argument is small is kept', () => {
    // The pole at 0 is exact, and the rounding error of 10⁻²⁵ is 10⁻⁴⁶.
    // A float prints in full below 10^21, as a JavaScript number does.
    expect(ce.parse('\\cot(10^{-19})').N().toString()).toBe(
      '10000000000000000000'
    );
    expect(ce.parse('\\cot(10^{-25})').N().toString()).toBe('1e+25');
    expect(ce.parse('\\csc(10^{-25})').N().toString()).toBe('1e+25');
  });

  test('a pole within the rounding of the argument is ~oo', () => {
    expect(ce.parse('\\tan(\\frac{\\pi}{2})').N().toString()).toBe('~oo');
    expect(ce.parse('\\cot(\\pi)').N().toString()).toBe('~oo');
    expect(ce.parse('\\sec(\\frac{\\pi}{2})').N().toString()).toBe('~oo');
    // A pole reached through a float multiple of π, at 21 digits.
    expect(ce.parse('\\tan(0.5\\pi)').N().toString()).toBe('~oo');
  });

  test('a value that is small because the argument is small is kept', () => {
    expect(ce.parse('\\sin(10^{-25})').N().toString()).toBe('1e-25');
    expect(ce.parse('\\tan(10^{-25})').N().toString()).toBe('1e-25');
  });

  test('a zero crossing within the rounding of the argument is 0', () => {
    expect(ce.parse('\\sin(\\pi)').N().toString()).toBe('0');
    expect(ce.parse('\\cos(\\frac{\\pi}{2})').N().toString()).toBe('0');
    expect(ce.parse('\\cos(0.5\\pi)').evaluate().toString()).toBe('0');
  });

  test('a large exact argument is not chopped', () => {
    expect(ce.parse('\\sin(10^{22})').N().toString()).toBe(
      '-0.852200849767188801773'
    );
  });
});

describe('the sign of a trigonometric function of a float', () => {
  test('at the working precision', () => {
    const ce = new ComputeEngine();
    const sgn = (x: number | string, head = 'Sin') =>
      ce.function(head, [typeof x === 'number' ? ce.number(x) : ce.parse(x)])
        .sgn;
    expect(sgn(3.1415926536)).toBe('negative');
    expect(sgn(1e-10)).toBe('positive');
    expect(sgn(-1e-10)).toBe('negative');
    expect(sgn(1e-10, 'Tan')).toBe('positive');
    expect(sgn(3.1415926536, 'Cos')).toBe('negative');
    // `evaluate()` answers the same sign.
    expect(ce.box(['Sin', 3.1415926536]).evaluate().isNegative).toBe(true);
    expect(ce.box(['Sin', 1e-10]).evaluate().isPositive).toBe(true);
    // Within the rounding of the working precision of π: undecided.
    expect(sgn('3.14159265358979323846')).toBeUndefined();
  });

  test('at machine precision', () => {
    const ce = new ComputeEngine();
    ce.precision = 15;
    const sgn = (x: number) => ce.box(['Sin', x]).sgn;
    expect(sgn(3.1415926536)).toBe('negative');
    expect(sgn(1e-10)).toBe('positive');
    expect(sgn(Math.PI)).toBeUndefined();
  });

  test('in degrees', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    expect(ce.box(['Sin', 180.0000000001]).sgn).toBe('negative');
    expect(ce.box(['Cos', 89.99999]).sgn).toBe('positive');
  });
});
