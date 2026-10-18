import { ComputeEngine } from '../../src/compute-engine';

// Quantity arithmetic follows the exactness contract: `evaluate()` keeps an
// exact magnitude (an integer, a rational, a radical, an exact constant such
// as `π`) exact, and `.N()` gives the float. A float operand makes the result
// a float, also when its value is an integer.

const ce = new ComputeEngine();

function evaluate(json: any): string {
  return ce.box(json).evaluate().toString();
}

function numeric(json: any): string {
  return ce.box(json).N().toString();
}

describe('QUANTITY ARITHMETIC KEEPS AN EXACT MAGNITUDE EXACT', () => {
  test('multiplication by an exact constant or radical', () => {
    expect(evaluate(['Multiply', ['Quantity', 3, 'm'], 'Pi'])).toBe('3pi m');
    expect(evaluate(['Multiply', ['Quantity', 3, 'm'], ['Sqrt', 2]])).toBe(
      '3sqrt(2) m'
    );
    expect(numeric(['Multiply', ['Quantity', 3, 'm'], 'Pi'])).toBe(
      '9.42477796076938 m'
    );
    expect(numeric(['Multiply', ['Quantity', 3, 'm'], ['Sqrt', 2]])).toBe(
      '4.242640687119286 m'
    );
  });

  test('multiplication of two quantities', () => {
    expect(
      evaluate(['Multiply', ['Quantity', 3, 'N'], ['Quantity', 'Pi', 'm']])
    ).toBe('3pi J');
    expect(
      numeric(['Multiply', ['Quantity', 3, 'N'], ['Quantity', 'Pi', 'm']])
    ).toBe('9.42477796076938 J');
  });

  test('an integer power gives an exact rational', () => {
    expect(evaluate(['Power', ['Quantity', 3, 'm'], -1])).toBe('1/3 m^-1');
    expect(evaluate(['Power', ['Quantity', 3, 'm'], -2])).toBe('1/9 m^-2');
    expect(evaluate(['Power', ['Quantity', ['Sqrt', 2], 'm'], 2])).toBe(
      '2 m^2'
    );
    expect(numeric(['Power', ['Quantity', 3, 'm'], -1])).toBe(
      '0.333333333333333333333 m^-1'
    );
  });

  test('division', () => {
    expect(evaluate(['Divide', ['Quantity', 1, 'm'], 3])).toBe('1/3 m');
    expect(evaluate(['Divide', 1, ['Quantity', 3, 's']])).toBe('1/3 s^-1');
    expect(
      evaluate(['Divide', ['Quantity', 1, 'm'], ['Quantity', 3, 's']])
    ).toBe('1/3 m/s');
    expect(
      evaluate(['Divide', ['Quantity', 1, 'm'], ['Quantity', 3, 'cm']])
    ).toBe('100/3');
    expect(numeric(['Divide', 1, ['Quantity', 3, 's']])).toBe(
      '0.333333333333333333333 s^-1'
    );
  });

  test('addition', () => {
    expect(
      evaluate(['Add', ['Quantity', 'Pi', 'm'], ['Quantity', 1, 'm']])
    ).toBe('(1 + pi) m');
    expect(
      evaluate([
        'Add',
        ['Quantity', ['Rational', 1, 3], 'm'],
        ['Quantity', 1, 'm'],
      ])
    ).toBe('4/3 m');
    expect(
      numeric(['Add', ['Quantity', 'Pi', 'm'], ['Quantity', 1, 'm']])
    ).toBe('4.141592653589793 m');
  });

  test('negation', () => {
    expect(evaluate(['Negate', ['Quantity', 'Pi', 'm']])).toBe('-pi m');
    expect(numeric(['Negate', ['Quantity', 'Pi', 'm']])).toBe(
      '-3.141592653589793 m'
    );
  });

  test('a complex factor keeps its imaginary part', () => {
    // The machine-number arithmetic read `.re` of `i`, which is 0.
    expect(evaluate(['Multiply', ['Quantity', 3, 'm'], 'ImaginaryUnit'])).toBe(
      '3i m'
    );
  });

  test('the parse route', () => {
    expect(ce.parse('3\\,\\mathrm{m}\\cdot\\pi').evaluate().toString()).toBe(
      '3pi m'
    );
    expect(ce.parse('(3\\,\\mathrm{m})^{-1}').evaluate().toString()).toBe(
      '1/3 m^-1'
    );
    expect(ce.parse('(3\\,\\mathrm{m})^{-1}').N().toString()).toBe(
      '0.333333333333333333333 m^-1'
    );
  });

  test('a free symbol stays symbolic', () => {
    expect(evaluate(['Multiply', ['Quantity', 3, 'm'], 'x'])).toBe('3x m');
  });
});

describe('UNIT CONVERSION OF AN EXACT MAGNITUDE', () => {
  test('a conversion by an integer factor stays exact', () => {
    expect(evaluate(['UnitConvert', ['Quantity', 'Pi', 'm'], 'cm'])).toBe(
      '100pi cm'
    );
    expect(
      evaluate(['UnitConvert', ['Quantity', ['Rational', 1, 3], 'm'], 'cm'])
    ).toBe('100/3 cm');
    expect(
      evaluate(['UnitSimplify', ['Quantity', 'Pi', ['Multiply', 'kN', 'm']]])
    ).toBe('1000pi J');
  });

  test('a conversion by a float factor or with an offset gives a float', () => {
    expect(evaluate(['UnitConvert', ['Quantity', 'Pi', 'cm'], 'm'])).toBe(
      '0.031415926535897934 m'
    );
    expect(
      evaluate([
        'UnitConvert',
        ['Quantity', ['Rational', 1, 3], ['Divide', 'm', 's']],
        ['Divide', 'km', 'h'],
      ])
    ).toBe('1.2 km/h');
    expect(
      evaluate(['Add', ['Quantity', 20, 'degC'], ['Quantity', 1, 'K']])
    ).toBe('294.15 K');
  });
});

describe('AN INEXACT CONVERSION OF AN EXACT MAGNITUDE GIVES A FLOAT', () => {
  // The conversion factor `0.01` or the temperature offset is a float, so the
  // result is a float, also when its value is an integer (`100 · 0.01` is
  // `1` in machine numbers).
  test.each([
    [['UnitConvert', ['Quantity', 100, 'cm'], 'm'], 1],
    [['UnitConvert', ['Quantity', 150, 'cm'], 'm'], 1.5],
    [['UnitConvert', ['Quantity', 0, 'degC'], 'degF'], 32],
    [['UnitConvert', ['Quantity', 100, 'degC'], 'degF'], 212],
    [['Add', ['Quantity', 1, 'm'], ['Quantity', 100, 'cm']], 2],
    [['Add', ['Quantity', 100, 'cm'], ['Quantity', 0, 'm']], 1],
  ])('%j', (json, value) => {
    const r = ce.box(json).evaluate();
    expect(r.operator).toBe('Quantity');
    const mag = r.ops![0];
    expect(mag.isNumberLiteral).toBe(true);
    expect((mag as any).isExact).toBe(false);
    expect(mag.re).toBeCloseTo(value, 10);
  });
});

describe('AN INFINITE MAGNITUDE HAS NO ERROR TERM', () => {
  // The error terms of the Measurement arithmetic multiply the square of the
  // magnitude by the square of a zero error: for an infinite magnitude that
  // product is `Indeterminate`.
  test.each([
    [['Multiply', 2, ['Quantity', 'PositiveInfinity', 'm']], '+oo m'],
    [['Divide', ['Quantity', 'PositiveInfinity', 'm'], 2], '+oo m'],
    [['UnitConvert', ['Quantity', 'PositiveInfinity', 'm'], 'cm'], '+oo cm'],
    [
      [
        'UnitSimplify',
        ['Quantity', 'PositiveInfinity', ['Multiply', 'kN', 'm']],
      ],
      '+oo J',
    ],
  ])('%j', (json, expected) => {
    const r = ce.box(json).evaluate();
    expect(r.toString()).toBe(expected);
    expect(r.ops![0].operator).not.toBe('Measurement');
  });

  test('a Measurement operand still propagates its error', () => {
    expect(
      evaluate(['Multiply', 2, ['Quantity', ['Measurement', 2, 0.1], 'm']])
    ).toBe('(4.00 ± 0.20) m');
    expect(
      evaluate(['Multiply', ['Measurement', 2, 0.1], ['Quantity', 3, 'm']])
    ).toBe('(6.00 ± 0.30) m');
    expect(
      evaluate(['Divide', ['Quantity', ['Measurement', 4, 0.2], 'm'], 2])
    ).toBe('(2.00 ± 0.10) m');
    expect(
      evaluate([
        'UnitConvert',
        ['Quantity', ['Measurement', 2, 0.1], 'm'],
        'cm',
      ])
    ).toBe('(200 ± 10) cm');
  });
});

describe('A FLOAT OPERAND OF QUANTITY ARITHMETIC GIVES A FLOAT', () => {
  test.each([
    [['Multiply', ['Quantity', 1.5, 'm'], 2]],
    [['Add', ['Quantity', 1.5, 'm'], ['Quantity', 1.5, 'm']]],
    [['Divide', ['Quantity', { num: '6.0' }, 'm'], 2]],
    [['Power', ['Quantity', 2, 'm'], { num: '2.0' }]],
    [['Negate', ['Quantity', { num: '3.0' }, 'm']]],
  ])('%j', (json) => {
    const r = ce.box(json).evaluate();
    expect(r.operator).toBe('Quantity');
    const mag = r.ops![0];
    expect(mag.isNumberLiteral).toBe(true);
    expect((mag as any).isExact).toBe(false);
  });
});

describe('SERIALIZATION OF A SUM MAGNITUDE', () => {
  test('the sum is parenthesized, and the LaTeX round-trips', () => {
    const q = ce.box(['Quantity', ['Add', 1, 'Pi'], 'm']);
    expect(q.toString()).toBe('(1 + pi) m');
    expect(q.latex).toBe('\\left(1+\\pi\\right)\\,\\mathrm{m}');
    expect(ce.parse(q.latex).json).toEqual(['Quantity', ['Add', 1, 'Pi'], 'm']);
  });
});
