import { engine } from '../utils';
import {
  getUnitDimension,
  areCompatibleUnits,
  getUnitScale,
  getExpressionDimension,
  getExpressionScale,
  parseUnitDSL,
} from '../../src/compute-engine/library/unit-data';

describe('UNITS LIBRARY', () => {
  test('Quantity operator is defined in the engine', () => {
    const def = engine.lookupDefinition('Quantity');
    expect(def).toBeDefined();
  });

  test('QuantityMagnitude operator is defined in the engine', () => {
    const def = engine.lookupDefinition('QuantityMagnitude');
    expect(def).toBeDefined();
  });

  test('QuantityUnit operator is defined in the engine', () => {
    const def = engine.lookupDefinition('QuantityUnit');
    expect(def).toBeDefined();
  });

  test('Quantity expression is valid', () => {
    const expr = engine.box(['Quantity', 5, 'm']);
    expect(expr.isValid).toBe(true);
    expect(expr.operator).toBe('Quantity');
  });

  test('QuantityMagnitude expression is valid', () => {
    const expr = engine.box(['QuantityMagnitude', ['Quantity', 5, 'm']]);
    expect(expr.isValid).toBe(true);
  });

  test('QuantityUnit expression is valid', () => {
    const expr = engine.box(['QuantityUnit', ['Quantity', 5, 'm']]);
    expect(expr.isValid).toBe(true);
  });

  test('QuantityMagnitude evaluates to the numeric part', () => {
    const expr = engine.box([
      'QuantityMagnitude',
      ['Quantity', 5, 'm'],
    ]);
    const result = expr.evaluate();
    expect(result.re).toBe(5);
  });

  test('QuantityUnit evaluates to the unit part', () => {
    const expr = engine.box(['QuantityUnit', ['Quantity', 5, 'm']]);
    const result = expr.evaluate();
    expect(result.symbol).toBe('m');
  });
});

describe('UNIT REGISTRY', () => {
  test('Base SI unit dimension - meter', () => {
    expect(getUnitDimension('m')).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });
  test('Base SI unit dimension - kilogram', () => {
    expect(getUnitDimension('kg')).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });
  test('Base SI unit dimension - second', () => {
    expect(getUnitDimension('s')).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });
  test('Named derived unit - newton', () => {
    expect(getUnitDimension('N')).toEqual([1, 1, -2, 0, 0, 0, 0]);
  });
  test('Named derived unit - joule', () => {
    expect(getUnitDimension('J')).toEqual([2, 1, -2, 0, 0, 0, 0]);
  });
  test('Named derived unit - hertz', () => {
    expect(getUnitDimension('Hz')).toEqual([0, 0, -1, 0, 0, 0, 0]);
  });
  test('Prefixed unit - kilometer', () => {
    expect(getUnitDimension('km')).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });
  test('Prefixed unit scale - kilometer', () => {
    expect(getUnitScale('km')).toBe(1000);
  });
  test('Prefixed unit scale - milligram', () => {
    expect(getUnitScale('mg')).toBe(1e-6);
  });
  test('Prefixed unit scale - centimeter', () => {
    expect(getUnitScale('cm')).toBe(0.01);
  });
  test('Prefixed unit - microsecond', () => {
    expect(getUnitDimension('µs')).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(getUnitScale('µs')).toBe(1e-6);
  });
  test('Compatible units - m and km', () => {
    expect(areCompatibleUnits('m', 'km')).toBe(true);
  });
  test('Incompatible units - m and s', () => {
    expect(areCompatibleUnits('m', 's')).toBe(false);
  });
  test('Compatible units - N and kg', () => {
    expect(areCompatibleUnits('N', 'kg')).toBe(false);
  });
  test('Non-SI unit - liter', () => {
    expect(getUnitDimension('L')).toEqual([3, 0, 0, 0, 0, 0, 0]);
    expect(getUnitScale('L')).toBe(0.001);
  });
  test('Non-SI unit - minute', () => {
    expect(getUnitDimension('min')).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(getUnitScale('min')).toBe(60);
  });
  test('Non-SI unit - electronvolt', () => {
    expect(getUnitDimension('eV')).toEqual([2, 1, -2, 0, 0, 0, 0]);
  });
  test('Unknown unit returns null', () => {
    expect(getUnitDimension('xyz')).toBeNull();
  });
  test('Logarithmic unit - dB', () => {
    expect(getUnitDimension('dB')).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
  test('Angle unit - degree', () => {
    expect(getUnitDimension('deg')).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('QUANTITY ARITHMETIC', () => {
  test('Scalar multiplication', () => {
    const expr = engine
      .box(['Multiply', 2, ['Quantity', 5, 'kg']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(10);
    expect(expr.op2.symbol).toBe('kg');
  });

  test('Addition - same unit', () => {
    const expr = engine
      .box(['Add', ['Quantity', 3, 'm'], ['Quantity', 7, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(10);
    expect(expr.op2.symbol).toBe('m');
  });

  test('Addition - compatible units, first operand wins', () => {
    const expr = engine
      .box(['Add', ['Quantity', 12, 'cm'], ['Quantity', 1, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(112);
    expect(expr.op2.symbol).toBe('cm');
  });

  test('Addition - compatible units, reversed', () => {
    // Note: canonical form reorders operands, so the first Quantity
    // in canonical order (cm < m lexically) determines the result unit.
    const expr = engine
      .box(['Add', ['Quantity', 1, 'm'], ['Quantity', 12, 'cm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(112);
    expect(expr.op2.symbol).toBe('cm');
  });

  test('Multiplication of quantities', () => {
    const expr = engine
      .box(['Multiply', ['Quantity', 5, 'm'], ['Quantity', 3, 's']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(15);
  });

  test('Division of quantities', () => {
    const expr = engine
      .box(['Divide', ['Quantity', 100, 'm'], ['Quantity', 10, 's']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(10);
  });

  test('Power of quantity', () => {
    const expr = engine
      .box(['Power', ['Quantity', 3, 'm'], 2])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(9);
  });
});

describe('UNIT CONVERT', () => {
  test('UnitConvert operator is defined', () => {
    const def = engine.lookupDefinition('UnitConvert');
    expect(def).toBeDefined();
  });

  test('Convert m to km', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 1500, 'm'], 'km'])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(1.5);
    expect(expr.op2.symbol).toBe('km');
  });

  test('Convert km to m', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 2.5, 'km'], 'm'])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(2500);
    expect(expr.op2.symbol).toBe('m');
  });

  test('Convert min to s', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 5, 'min'], 's'])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(300);
    expect(expr.op2.symbol).toBe('s');
  });
});

describe('COMPOUND UNITS', () => {
  test('Dimension of m/s', () => {
    expect(getExpressionDimension(['Divide', 'm', 's'])).toEqual([
      1, 0, -1, 0, 0, 0, 0,
    ]);
  });

  test('Dimension of m/s^2', () => {
    expect(
      getExpressionDimension(['Divide', 'm', ['Power', 's', 2]])
    ).toEqual([1, 0, -2, 0, 0, 0, 0]);
  });

  test('Dimension of kg*m*s^-2 (newton)', () => {
    expect(
      getExpressionDimension([
        'Multiply',
        'kg',
        'm',
        ['Power', 's', -2],
      ])
    ).toEqual([1, 1, -2, 0, 0, 0, 0]);
  });

  test('Scale of km/h', () => {
    const scale = getExpressionScale(['Divide', 'km', 'h']);
    expect(scale).toBeCloseTo(1000 / 3600);
  });

  test('Compound unit Quantity is valid', () => {
    const expr = engine.box(['Quantity', 10, ['Divide', 'm', 's']]);
    expect(expr.isValid).toBe(true);
  });

  test('Compound unit Quantity with Power', () => {
    const expr = engine.box([
      'Quantity',
      1,
      ['Multiply', 'kg', 'm', ['Power', 's', -2]],
    ]);
    expect(expr.isValid).toBe(true);
  });
});

describe('DSL STRING PARSING', () => {
  test('Simple unit stays as string', () => {
    expect(parseUnitDSL('m')).toBe('m');
  });

  test('Prefixed unit stays as string', () => {
    expect(parseUnitDSL('km')).toBe('km');
  });

  test('Division: m/s', () => {
    const result = parseUnitDSL('m/s');
    expect(result).toEqual(['Divide', 'm', 's']);
  });

  test('Division with power: m/s^2', () => {
    const result = parseUnitDSL('m/s^2');
    expect(result).toEqual(['Divide', 'm', ['Power', 's', 2]]);
  });

  test('Multiplication with division: kg*m/s^2', () => {
    const result = parseUnitDSL('kg*m/s^2');
    expect(result).toEqual([
      'Divide',
      ['Multiply', 'kg', 'm'],
      ['Power', 's', 2],
    ]);
  });

  test('DSL in Quantity canonical form', () => {
    const expr = engine.box(['Quantity', 9.8, 'm/s^2']);
    expect(expr.isValid).toBe(true);
    expect(expr.op2.operator).toBe('Divide');
  });

  test('DSL: kg*m/s^2', () => {
    const expr = engine.box(['Quantity', 1, 'kg*m/s^2']);
    expect(expr.isValid).toBe(true);
  });
});

describe('COMPOUND UNIT CONVERT', () => {
  test('Convert km/h to m/s', () => {
    const expr = engine
      .box([
        'UnitConvert',
        ['Quantity', 36, ['Divide', 'km', 'h']],
        ['Divide', 'm', 's'],
      ])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(10);
  });
});

describe('LATEX PARSING', () => {
  test('Number with \\mathrm unit', () => {
    const expr = engine.parse('12\\,\\mathrm{cm}');
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(12);
  });

  test('Number with \\text unit', () => {
    const expr = engine.parse('3\\,\\text{kg}');
    expect(expr.operator).toBe('Quantity');
  });

  test('Compound unit in \\mathrm', () => {
    const expr = engine.parse('9.8\\,\\mathrm{m/s^2}');
    expect(expr.operator).toBe('Quantity');
  });

  test('No space between number and unit', () => {
    const expr = engine.parse('12\\mathrm{cm}');
    expect(expr.operator).toBe('Quantity');
  });

  test('Thin space \\, between number and unit', () => {
    const expr = engine.parse('5\\,\\mathrm{m}');
    expect(expr.operator).toBe('Quantity');
  });

  test('Medium space \\; between number and unit', () => {
    const expr = engine.parse('5\\;\\mathrm{m/s}');
    expect(expr.operator).toBe('Quantity');
  });

  // Regression: \mathrm{e} → ExponentialE must NOT be broken by unit parsing.
  // The 4-token trigger `\mathrm{e}` (ExponentialE) takes priority over
  // the 1-token `\mathrm` expression entry (unit parser).
  test('\\mathrm{e} alone is ExponentialE', () => {
    const expr = engine.parse('\\mathrm{e}');
    expect(expr.symbol).toBe('ExponentialE');
  });

  test('Number followed by \\mathrm{e} is multiplication by ExponentialE', () => {
    const expr = engine.parse('2\\mathrm{e}');
    expect(expr.operator).toBe('Multiply');
    expect(expr.json).toEqual(['Multiply', 2, 'ExponentialE']);
  });

  test('\\mathrm{i} alone is ImaginaryUnit', () => {
    const expr = engine.parse('\\mathrm{i}');
    expect(expr.symbol).toBe('ImaginaryUnit');
  });

  test('Non-unit \\mathrm{xyz} falls through to symbol parsing', () => {
    const expr = engine.parse('\\mathrm{xyz}');
    // Should not be an error; falls through to normal parsing
    expect(expr.operator).not.toBe('Error');
  });
});

describe('LATEX SERIALIZATION', () => {
  test('Simple quantity', () => {
    const expr = engine.box(['Quantity', 5, 'm']);
    expect(expr.latex).toBe('5\\,\\mathrm{m}');
  });

  test('Prefixed unit', () => {
    const expr = engine.box(['Quantity', 12, 'cm']);
    expect(expr.latex).toBe('12\\,\\mathrm{cm}');
  });

  test('Compound unit', () => {
    const expr = engine.box([
      'Quantity', 9.8,
      ['Divide', 'm', ['Power', 's', 2]],
    ]);
    expect(expr.latex).toBe('9.8\\,\\mathrm{m/s^{2}}');
  });
});

describe('SIUNITX PARSING', () => {
  test('\\qty command', () => {
    const expr = engine.parse('\\qty{12}{cm}');
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(12);
  });

  test('\\SI command (legacy)', () => {
    const expr = engine.parse('\\SI{5}{kg}');
    expect(expr.operator).toBe('Quantity');
  });

  test('\\unit command (unit only)', () => {
    const expr = engine.parse('\\unit{m/s}');
    // Should produce a unit expression, not a Quantity
    expect(expr.operator).not.toBe('Quantity');
  });

  test('\\si command (legacy, unit only)', () => {
    const expr = engine.parse('\\si{MHz}');
    expect(expr.symbol).toBe('MHz');
  });

  test('\\qty with compound unit', () => {
    const expr = engine.parse('\\qty{9.8}{m/s^2}');
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(9.8);
  });

  test('\\SI with prefixed unit', () => {
    const expr = engine.parse('\\SI{1.5}{km}');
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(1.5);
    expect(expr.op2.symbol).toBe('km');
  });
});

describe('UNIT SIMPLIFY', () => {
  test('kg⋅m⋅s⁻² simplifies to N', () => {
    const expr = engine.box([
      'UnitSimplify',
      ['Quantity', 100, ['Multiply', 'kg', 'm', ['Power', 's', -2]]],
    ]).evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(100);
    expect(expr.op2.symbol).toBe('N');
  });

  test('No simpler form returns unchanged', () => {
    const expr = engine.box([
      'UnitSimplify',
      ['Quantity', 5, ['Divide', 'kg', 'L']],
    ]).evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(5);
    // kg/L has dimension [0, 1, 0, 0, 0, 0, 0] - [3, 0, 0, 0, 0, 0, 0] = [-3, 1, 0, 0, 0, 0, 0]
    // which has no named SI unit (it's density), so should remain unchanged
    expect(expr.op2.operator).toBe('Divide');
  });
});

describe('COMPATIBLE UNIT Q', () => {
  test('m and km are compatible', () => {
    const expr = engine.box(['CompatibleUnitQ', 'm', 'km']).evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('m and s are not compatible', () => {
    const expr = engine.box(['CompatibleUnitQ', 'm', 's']).evaluate();
    expect(expr.symbol).toBe('False');
  });
});

describe('UNIT DIMENSION', () => {
  test('Dimension of meter', () => {
    const expr = engine.box(['UnitDimension', 'm']).evaluate();
    expect(expr.operator).toBe('List');
  });
});

describe('PHYSICS CONSTANTS', () => {
  test('Speed of light is a Quantity', () => {
    const expr = engine.box('SpeedOfLight').evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(299792458);
  });

  test('Planck constant is a Quantity', () => {
    const expr = engine.box('PlanckConstant').evaluate();
    expect(expr.operator).toBe('Quantity');
  });

  test('Mu0 is a Quantity (updated)', () => {
    const expr = engine.box('Mu0').evaluate();
    expect(expr.operator).toBe('Quantity');
  });

  test('Standard gravity', () => {
    const expr = engine.box('StandardGravity').evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(9.80665);
  });
});
