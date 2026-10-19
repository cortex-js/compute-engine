import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();

/** The LaTeX of a quantity, and the canonical MathJSON of its parse. */
function roundTrip(json: MathJsonExpression): [string, unknown] {
  const latex = ce.box(json).latex;
  return [latex, ce.parse(latex).json];
}

describe('A QUANTITY WHOSE MAGNITUDE IS NOT A NUMBER LITERAL', () => {
  // Juxtaposed with a unit, such a magnitude parses as a product
  // (`2\sqrt{2}\,\mathrm{m}` is `2·√2·m`), so it is written with the siunitx
  // command `\qty`, which parses back as the same quantity.
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
