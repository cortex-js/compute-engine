import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();

// Quantity arithmetic does not rename a unit. A product or a quotient of
// quantities keeps its units in the canonical unit form: the unit symbols
// with a positive exponent over the unit symbols with a negative exponent.
// Unit factors with the same dimension still cancel, with their conversion
// scale. Only `UnitSimplify` replaces a compound unit with a named derived
// unit (`V·A` → `W`).

function evalJson(expr: MathJsonExpression): MathJsonExpression {
  return ce.box(expr).evaluate().json;
}

function numericJson(expr: MathJsonExpression): MathJsonExpression {
  return ce.box(expr).N().json;
}

const VA: MathJsonExpression = [
  'Multiply',
  ['Quantity', 2, 'V'],
  ['Quantity', 3, 'A'],
];
const NM: MathJsonExpression = [
  'Multiply',
  ['Quantity', 2, 'N'],
  ['Quantity', 3, 'm'],
];
const KM_N: MathJsonExpression = [
  'Multiply',
  ['Quantity', 2, 'km'],
  ['Quantity', 3, 'N'],
];

describe('QUANTITY ARITHMETIC KEEPS THE COMPOUND UNIT', () => {
  test.each<[string, MathJsonExpression, MathJsonExpression]>([
    ['V·A', VA, ['Quantity', 6, ['Multiply', 'A', 'V']]],
    ['N·m', NM, ['Quantity', 6, ['Multiply', 'N', 'm']]],
    [
      '(m/s)·(m/s)',
      [
        'Multiply',
        ['Quantity', 2, ['Divide', 'm', 's']],
        ['Quantity', 3, ['Divide', 'm', 's']],
      ],
      ['Quantity', 6, ['Divide', ['Power', 'm', 2], ['Power', 's', 2]]],
    ],
    [
      'J/kg',
      ['Divide', ['Quantity', 6, 'J'], ['Quantity', 2, 'kg']],
      ['Quantity', 3, ['Divide', 'J', 'kg']],
    ],
    // The unit is not converted: the scale of `km` stays in the unit.
    ['km·N', KM_N, ['Quantity', 6, ['Multiply', 'N', 'km']]],
    [
      'kg·(m/s^2)',
      [
        'Multiply',
        ['Quantity', 2, 'kg'],
        ['Quantity', 3, ['Divide', 'm', ['Power', 's', 2]]],
      ],
      ['Quantity', 6, ['Divide', ['Multiply', 'kg', 'm'], ['Power', 's', 2]]],
    ],
  ])('%s', (_, input, expected) => {
    expect(evalJson(input)).toEqual(expected);
    expect(numericJson(input)).toEqual(expected);
  });

  test('an exact magnitude stays exact', () => {
    expect(
      evalJson(['Multiply', ['Quantity', 3, 'N'], ['Quantity', 'Pi', 'm']])
    ).toEqual(['Quantity', ['Multiply', 3, 'Pi'], ['Multiply', 'N', 'm']]);
  });

  test('a Measurement magnitude keeps its error and the compound unit', () => {
    expect(
      evalJson([
        'Multiply',
        ['Quantity', ['Measurement', 2, 0.1], 'N'],
        ['Quantity', 3, 'm'],
      ])
    ).toEqual(['Quantity', ['Measurement', 6, 0.3], ['Multiply', 'N', 'm']]);
    expect(
      evalJson([
        'Divide',
        ['Quantity', ['Measurement', 6, 0.1], 'J'],
        ['Quantity', 2, 'kg'],
      ])
    ).toEqual(['Quantity', ['Measurement', 3, 0.05], ['Divide', 'J', 'kg']]);
  });

  test('a physical constant times a quantity keeps the compound unit', () => {
    const e = ce
      .box(['Multiply', 'ElementaryCharge', ['Quantity', 1, 'V']])
      .evaluate();
    expect(e.operator).toBe('Quantity');
    expect(e.op1.re).toBe(1.602176634e-19);
    expect(e.op2.json).toEqual(['Multiply', 'C', 'V']);
  });

  test('parse route', () => {
    expect(
      ce.parse('2\\,\\mathrm{V}\\cdot 3\\,\\mathrm{A}').evaluate().json
    ).toEqual(['Quantity', 6, ['Multiply', 'A', 'V']]);
    expect(
      ce.parse('2\\,\\mathrm{m/s}\\cdot 3\\,\\mathrm{m/s}').evaluate().json
    ).toEqual([
      'Quantity',
      6,
      ['Divide', ['Power', 'm', 2], ['Power', 's', 2]],
    ]);
    expect(
      ce.parse('\\frac{6\\,\\mathrm{J}}{2\\,\\mathrm{kg}}').evaluate().json
    ).toEqual(['Quantity', 3, ['Divide', 'J', 'kg']]);
  });
});

describe('UNITS WITH THE SAME DIMENSION STILL CANCEL', () => {
  test.each<[string, MathJsonExpression, number]>([
    [
      'in·m^-1',
      ['Multiply', ['Quantity', 2, 'in'], ['Quantity', 3, ['Power', 'm', -1]]],
      0.1524,
    ],
    ['km/m', ['Divide', ['Quantity', 2, 'km'], ['Quantity', 4, 'm']], 500],
    ['kHz·ms', ['Multiply', ['Quantity', 2, 'kHz'], ['Quantity', 3, 'ms']], 6],
    ['V·A/W', ['Divide', VA, ['Quantity', 2, 'W']], 3],
  ])('%s', (_, input, expected) => {
    const e = ce.box(input).evaluate();
    expect(e.operator).not.toBe('Quantity');
    expect(e.re).toBeCloseTo(expected, 12);
  });

  test('J/K·K cancels to J', () => {
    const e = ce
      .box(['Multiply', 'BoltzmannConstant', ['Quantity', 300, 'K']])
      .evaluate();
    expect(e.operator).toBe('Quantity');
    expect(e.op1.re).toBeCloseTo(4.141947e-21, 30);
    expect(e.op2.json).toBe('J');
  });
});

describe('UnitSimplify NAMES A DERIVED UNIT', () => {
  test.each<[string, MathJsonExpression, MathJsonExpression]>([
    ['V·A', VA, ['Quantity', 6, 'W']],
    ['N·m', NM, ['Quantity', 6, 'J']],
    ['km·N', KM_N, ['Quantity', 6000, 'J']],
    [
      '(m/s)·(m/s)',
      [
        'Multiply',
        ['Quantity', 2, ['Divide', 'm', 's']],
        ['Quantity', 3, ['Divide', 'm', 's']],
      ],
      ['Quantity', 6, 'Gy'],
    ],
    [
      'Measurement N·m',
      [
        'Multiply',
        ['Quantity', ['Measurement', 2, 0.1], 'N'],
        ['Quantity', 3, 'm'],
      ],
      ['Quantity', ['Measurement', 6, 0.3], 'J'],
    ],
  ])('%s', (_, input, expected) => {
    expect(evalJson(['UnitSimplify', input])).toEqual(expected);
  });

  test('UnitConvert of a compound unit', () => {
    expect(evalJson(['UnitConvert', VA, 'W'])).toEqual(['Quantity', 6, 'W']);
    expect(evalJson(['UnitConvert', VA, 'kW'])).toEqual([
      'Quantity',
      0.006,
      'kW',
    ]);
  });
});

describe('A COMPOUND UNIT COMPARES WITH THE NAMED UNIT', () => {
  test.each<[string, MathJsonExpression, string]>([
    ['V·A = W', ['Equal', VA, ['Quantity', 6, 'W']], 'True'],
    ['V·A = 7 W', ['Equal', VA, ['Quantity', 7, 'W']], 'False'],
    ['V·A < 7 W', ['Less', VA, ['Quantity', 7, 'W']], 'True'],
    ['V·A > 7 W', ['Greater', VA, ['Quantity', 7, 'W']], 'False'],
    ['km·N = 6000 J', ['Equal', KM_N, ['Quantity', 6000, 'J']], 'True'],
  ])('%s', (_, input, expected) => {
    expect(evalJson(input)).toBe(expected);
  });

  test('a sum takes the unit of its first quantity', () => {
    expect(evalJson(['Add', VA, ['Quantity', 1, 'W']])).toEqual([
      'Quantity',
      7,
      ['Multiply', 'A', 'V'],
    ]);
  });
});

describe('LATEX ROUND TRIP OF A COMPOUND UNIT', () => {
  test.each<[string, MathJsonExpression]>([
    ['V·A', VA],
    ['km·N', KM_N],
    [
      '(m/s)·(m/s)',
      [
        'Multiply',
        ['Quantity', 2, ['Divide', 'm', 's']],
        ['Quantity', 3, ['Divide', 'm', 's']],
      ],
    ],
    ['J/kg', ['Divide', ['Quantity', 6, 'J'], ['Quantity', 2, 'kg']]],
    ['exact', ['Multiply', ['Quantity', 3, 'N'], ['Quantity', 'Pi', 'km']]],
    [
      'Measurement',
      [
        'Multiply',
        ['Quantity', ['Measurement', 2, 0.1], 'kg'],
        [
          'Quantity',
          ['Measurement', 3, 0.2],
          ['Divide', 'm', ['Power', 's', 2]],
        ],
      ],
    ],
  ])('%s', (_, input) => {
    const value = ce.box(input).evaluate();
    expect(ce.parse(value.latex).isSame(value)).toBe(true);
  });
});
