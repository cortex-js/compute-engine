import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();

/** The LaTeX of a quantity, and the canonical MathJSON of its parse. */
function roundTrip(json: MathJsonExpression): [string, unknown] {
  const latex = ce.box(json).latex;
  return [latex, ce.parse(latex).json];
}

describe('A QUANTITY WHOSE MAGNITUDE IS NOT A NUMBER LITERAL', () => {
  // Such a magnitude is written with the siunitx command `\qty`, which
  // parses back as the same quantity. Juxtaposed with a unit, a magnitude
  // with a variable parses as a product (`x\,\mathrm{m}` is `x·m`).
  test.each<[string, MathJsonExpression, string]>([
    [
      'a radical',
      ['Multiply', 2, ['Sqrt', 2]],
      '\\qty[parse-numbers=false]{2\\sqrt{2}}{m}',
    ],
    [
      'a rational',
      ['Rational', 1, 64],
      '\\qty[parse-numbers=false]{\\frac{1}{64}}{m}',
    ],
    ['pi', 'Pi', '\\qty[parse-numbers=false]{\\pi}{m}'],
    ['a symbol', 'x', '\\qty[parse-numbers=false]{x}{m}'],
    ['a negated symbol', ['Negate', 'x'], '\\qty[parse-numbers=false]{-x}{m}'],
    ['a sum', ['Add', 1, 'Pi'], '\\qty[parse-numbers=false]{1+\\pi}{m}'],
    [
      'a complex number',
      ['Complex', 1, 2],
      '\\qty[parse-numbers=false]{1+2\\imaginaryI}{m}',
    ],
    ['infinity', 'PositiveInfinity', '\\qty[parse-numbers=false]{\\infty}{m}'],
  ])('%s', (_, magnitude, latex) => {
    const q = ce.box(['Quantity', magnitude, 'm']);
    expect(q.latex).toBe(latex);
    expect(ce.parse(q.latex).isSame(q)).toBe(true);
  });

  test('a compound unit is written as in \\mathrm{...}', () => {
    expect(
      roundTrip(['Quantity', ['Sqrt', 2], ['Divide', 'm', ['Power', 's', 2]]])
    ).toEqual([
      '\\qty[parse-numbers=false]{\\sqrt{2}}{m/s^{2}}',
      ['Quantity', ['Sqrt', 2], ['Divide', 'm', ['Power', 's', 2]]],
    ]);
    expect(
      roundTrip(['Quantity', ['Rational', 1, 2], ['Multiply', 'kg', 'm']])
    ).toEqual([
      '\\qty[parse-numbers=false]{\\frac{1}{2}}{kg\\cdot m}',
      ['Quantity', ['Rational', 1, 2], ['Multiply', 'kg', 'm']],
    ]);
  });

  test('the unit day is written `day`', () => {
    expect(roundTrip(['Quantity', ['Sqrt', 2], 'd'])).toEqual([
      '\\qty[parse-numbers=false]{\\sqrt{2}}{day}',
      ['Quantity', ['Sqrt', 2], 'd'],
    ]);
  });

  test('a unit with no unit form keeps the function form', () => {
    expect(
      roundTrip(['Quantity', ['Sqrt', 2], ['Power', 'm', ['Add', 'n', 1]]])
    ).toEqual([
      '\\mathrm{Quantity}(\\sqrt{2}, m^{n+1})',
      ['Quantity', ['Sqrt', 2], ['Power', 'm', ['Add', 'n', 1]]],
    ]);
  });
});

describe('A QUANTITY WHOSE MAGNITUDE IS A NUMBER LITERAL', () => {
  test.each<[MathJsonExpression, string]>([
    [3, '3\\,\\mathrm{m}'],
    [3.5, '3.5\\,\\mathrm{m}'],
    [-3, '-3\\,\\mathrm{m}'],
    [-2.5, '-2.5\\,\\mathrm{m}'],
    [1.5e30, '1.5\\cdot10^{30}\\,\\mathrm{m}'],
  ])('%j', (magnitude, latex) => {
    const q = ce.box(['Quantity', magnitude, 'm']);
    expect(q.latex).toBe(latex);
    expect(ce.parse(q.latex).isSame(q)).toBe(true);
  });

  test('a negative number before a unit is the magnitude', () => {
    // The parser reads the minus sign as a prefix operator, `Negate(3)`.
    expect(ce.parse('-3\\,\\mathrm{m}').json).toEqual(['Quantity', -3, 'm']);
    expect(ce.parse('(-3)\\,\\mathrm{m}').json).toEqual(['Quantity', -3, 'm']);
    expect(ce.parse('x-3\\,\\mathrm{m}').json).toEqual([
      'Add',
      'x',
      ['Negate', ['Quantity', 3, 'm']],
    ]);
  });

  test('a measurement keeps the parenthesized form', () => {
    expect(roundTrip(['Quantity', ['Measurement', 5.1, 0.2], 'cm'])).toEqual([
      '\\left(5.10\\pm0.20\\right)\\,\\mathrm{cm}',
      ['Quantity', ['Measurement', 5.1, 0.2], 'cm'],
    ]);
  });
});

describe('PARSING OF HAND-WRITTEN SIUNITX QUANTITIES', () => {
  test.each<[string, unknown]>([
    ['\\qty{\\frac{1}{64}}{m}', ['Quantity', ['Rational', 1, 64], 'm']],
    [
      '\\qty[parse-numbers=false]{\\frac{1}{64}}{m}',
      ['Quantity', ['Rational', 1, 64], 'm'],
    ],
    ['\\qty{2\\sqrt{2}}{m}', ['Quantity', ['Multiply', 2, ['Sqrt', 2]], 'm']],
    ['\\SI[parse-numbers=false]{\\pi}{km}', ['Quantity', 'Pi', 'km']],
    ['\\qty [parse-numbers = false] {3}{m}', ['Quantity', 3, 'm']],
    // A `]` inside a braced option value does not end the options.
    ['\\qty[round-precision={2]}]{3}{m}', ['Quantity', 3, 'm']],
    ['\\unit[per-mode=symbol]{m/s}', ['Divide', 'm', 's']],
  ])('%s', (latex, json) => {
    expect(ce.parse(latex).json).toEqual(json);
  });

  test('a quantity with an exact magnitude evaluates exactly', () => {
    expect(
      ce.parse('\\qty{\\frac{1}{64}}{m} + \\qty{\\frac{1}{64}}{m}').evaluate()
        .json
    ).toEqual(['Quantity', ['Rational', 1, 32], 'm']);
  });
});

// A numeric constant expression (a constant such as `\pi`, a power of ten,
// a fraction, a radical, a product of these) juxtaposed with a unit is a
// quantity with that magnitude, as a number literal is. A magnitude with a
// variable is not: `x\,\mathrm{m}` stays a product.
describe('A NUMERIC CONSTANT JUXTAPOSED WITH A UNIT', () => {
  test.each<[string, MathJsonExpression]>([
    ['\\pi\\,\\mathrm{rad}', ['Quantity', 'Pi', 'rad']],
    ['\\pi\\mathrm{rad}', ['Quantity', 'Pi', 'rad']],
    ['-\\pi\\,\\mathrm{rad}', ['Quantity', ['Negate', 'Pi'], 'rad']],
    ['2\\pi\\,\\mathrm{rad}', ['Quantity', ['Multiply', 2, 'Pi'], 'rad']],
    [
      '\\frac{\\pi}{180}\\,\\mathrm{rad}',
      ['Quantity', ['Multiply', ['Rational', 1, 180], 'Pi'], 'rad'],
    ],
    [
      '\\frac{3\\pi}{2}\\,\\mathrm{rad/s}',
      [
        'Quantity',
        ['Multiply', ['Rational', 3, 2], 'Pi'],
        ['Divide', 'rad', 's'],
      ],
    ],
    [
      '(\\pi/2)\\,\\mathrm{rad}',
      ['Quantity', ['Multiply', ['Rational', 1, 2], 'Pi'], 'rad'],
    ],
    ['10^{-30}\\,\\mathrm{rad}', ['Quantity', ['Power', 10, -30], 'rad']],
    ['\\frac{1}{2}\\,\\mathrm{m}', ['Quantity', ['Rational', 1, 2], 'm']],
    ['\\sqrt{2}\\,\\mathrm{m}', ['Quantity', ['Sqrt', 2], 'm']],
    [
      '3\\pi^2\\,\\mathrm{m}',
      ['Quantity', ['Multiply', 3, ['Power', 'Pi', 2]], 'm'],
    ],
    ['\\mathrm{e}\\,\\mathrm{m}', ['Quantity', 'ExponentialE', 'm']],
  ])('%s', (latex, json) => {
    const q = ce.parse(latex);
    expect(q.json).toEqual(json);
    // The box route gives the same quantity
    expect(q.isSame(ce.box(json))).toBe(true);
    // The LaTeX of the quantity parses back as the same quantity
    expect(ce.parse(q.latex).isSame(q)).toBe(true);
  });

  test('a magnitude with a variable is a product', () => {
    expect(ce.parse('x\\,\\mathrm{m}').json).toEqual(['Multiply', 'm', 'x']);
    expect(ce.parse('2x\\,\\mathrm{m}').json).toEqual([
      'Multiply',
      2,
      'm',
      'x',
    ]);
    expect(ce.parse('\\frac{x}{2}\\,\\mathrm{m}').json).toEqual([
      'Multiply',
      ['Rational', 1, 2],
      'm',
      'x',
    ]);
  });

  test('an imaginary constant is a product', () => {
    expect(ce.parse('\\mathrm{i}\\,\\mathrm{m}').operator).toBe('Multiply');
  });

  test('a sum of two such quantities is one quantity', () => {
    const sum = ce
      .parse(
        '\\frac{\\pi}{180}\\cdot 1\\,\\mathrm{rad} + 10^{-30}\\,\\mathrm{rad}'
      )
      .evaluate();
    expect(sum.operator).toBe('Quantity');
    expect(sum.json).toEqual([
      'Quantity',
      [
        'Add',
        ['Rational', 1, { num: '1e+30' }],
        ['Multiply', ['Rational', 1, 180], 'Pi'],
      ],
      'rad',
    ]);
    // It is more than 1 deg, by 10⁻³⁰ rad
    expect(sum.isGreater(ce.parse('1\\,\\mathrm{deg}'))).toBe(true);
    expect(
      ce
        .parse(
          '\\pi\\,\\mathrm{rad} + 10^{-30}\\,\\mathrm{rad} > 180\\,\\mathrm{deg}'
        )
        .evaluate().symbol
    ).toBe('True');
  });
});
