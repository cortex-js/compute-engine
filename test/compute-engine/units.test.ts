import { engine } from '../utils';
import {
  getUnitDimension,
  areCompatibleUnits,
  getUnitScale,
  getExpressionDimension,
  getExpressionScale,
  parseUnitDSL,
  convertCompoundUnit,
  dimensionsEqual,
  isDimensionless,
} from '../../src/compute-engine/library/unit-data';
import { boxedToUnitExpression } from '../../src/compute-engine/library/units';

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

  test('Addition - compatible units, largest-scale-unit wins', () => {
    // m (scale=1) > cm (scale=0.01), so result is in meters
    const expr = engine
      .box(['Add', ['Quantity', 12, 'cm'], ['Quantity', 1, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(1.12);
    expect(expr.op2.symbol).toBe('m');
  });

  test('Addition - compatible units, reversed order same result', () => {
    // Regardless of operand order, largest-scale-unit (m) wins
    const expr = engine
      .box(['Add', ['Quantity', 1, 'm'], ['Quantity', 12, 'cm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(1.12);
    expect(expr.op2.symbol).toBe('m');
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
    const expr = engine.box(['IsCompatibleUnit', 'm', 'km']).evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('m and s are not compatible', () => {
    const expr = engine.box(['IsCompatibleUnit', 'm', 's']).evaluate();
    expect(expr.symbol).toBe('False');
  });
});

describe('UNIT DIMENSION', () => {
  test('Dimension of meter', () => {
    const expr = engine.box(['UnitDimension', 'm']).evaluate();
    expect(expr.operator).toBe('List');
  });
});

describe('ANGULAR UNITS', () => {
  test('Sin of Quantity in degrees', () => {
    const expr = engine
      .box(['Sin', ['Quantity', 90, 'deg']])
      .evaluate();
    expect(expr.re).toBe(1);
  });

  test('Sin of Quantity in radians', () => {
    const expr = engine
      .box(['Sin', ['Quantity', Math.PI / 2, 'rad']])
      .N();
    expect(expr.re).toBeCloseTo(1);
  });

  test('Convert degrees to radians', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 180, 'deg'], 'rad'])
      .evaluate();
    expect(expr.op1.re).toBeCloseTo(Math.PI);
  });

  test('Convert grad to deg', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 100, 'grad'], 'deg'])
      .evaluate();
    expect(expr.op1.re).toBeCloseTo(90);
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

describe('DSL PARENTHESES', () => {
  test('Parenthesized denominator: kg/(m*s^2)', () => {
    const result = parseUnitDSL('kg/(m*s^2)');
    expect(result).toEqual([
      'Divide',
      'kg',
      ['Multiply', 'm', ['Power', 's', 2]],
    ]);
  });

  test('Parenthesized numerator: (kg*m)/s^2', () => {
    const result = parseUnitDSL('(kg*m)/s^2');
    expect(result).toEqual([
      'Divide',
      ['Multiply', 'kg', 'm'],
      ['Power', 's', 2],
    ]);
  });

  test('Nested parens: (kg*m)/(s^2*A)', () => {
    const result = parseUnitDSL('(kg*m)/(s^2*A)');
    expect(result).toEqual([
      'Divide',
      ['Multiply', 'kg', 'm'],
      ['Multiply', ['Power', 's', 2], 'A'],
    ]);
  });

  test('Parenthesized Quantity DSL', () => {
    const expr = engine.box(['Quantity', 1, 'kg/(m*s^2)']);
    expect(expr.isValid).toBe(true);
    expect(expr.op2.operator).toBe('Divide');
  });
});

describe('TEMPERATURE CONVERSION', () => {
  test('degC to K', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 100, 'degC'], 'K'])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(373.15);
    expect(expr.op2.symbol).toBe('K');
  });

  test('degF to K', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 212, 'degF'], 'K'])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(373.15);
  });

  test('degC to degF', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 100, 'degC'], 'degF'])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(212);
  });

  test('degF to degC', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 32, 'degF'], 'degC'])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(0);
  });

  test('0 K to degC', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 0, 'K'], 'degC'])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(-273.15);
  });
});

describe('INCOMPATIBLE UNIT CONVERT', () => {
  test('Converting m to s returns error', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 5, 'm'], 's'])
      .evaluate();
    expect(expr.operator).toBe('Error');
  });

  test('Converting kg to A returns error', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 1, 'kg'], 'A'])
      .evaluate();
    expect(expr.operator).toBe('Error');
  });
});

describe('COMPOUND UNIT QUERIES', () => {
  test('IsCompatibleUnit with compound units: m/s vs km/h', () => {
    const expr = engine.box([
      'IsCompatibleUnit',
      ['Divide', 'm', 's'],
      ['Divide', 'km', 'h'],
    ]).evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('IsCompatibleUnit compound vs simple: J vs kg*m^2/s^2', () => {
    const expr = engine.box([
      'IsCompatibleUnit',
      'J',
      ['Divide', ['Multiply', 'kg', ['Power', 'm', 2]], ['Power', 's', 2]],
    ]).evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('IsCompatibleUnit incompatible compounds: m/s vs kg*m', () => {
    const expr = engine.box([
      'IsCompatibleUnit',
      ['Divide', 'm', 's'],
      ['Multiply', 'kg', 'm'],
    ]).evaluate();
    expect(expr.symbol).toBe('False');
  });

  test('UnitDimension of compound unit m/s^2', () => {
    const expr = engine.box([
      'UnitDimension',
      ['Divide', 'm', ['Power', 's', 2]],
    ]).evaluate();
    expect(expr.operator).toBe('List');
    // [1, 0, -2, 0, 0, 0, 0] = acceleration
    expect(expr.op1.re).toBe(1);  // length
  });
});

describe('ADDITIONAL PHYSICS CONSTANTS', () => {
  test('Elementary charge', () => {
    const expr = engine.box('ElementaryCharge').evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(1.602176634e-19);
  });

  test('Boltzmann constant', () => {
    const expr = engine.box('BoltzmannConstant').evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(1.380649e-23);
  });

  test('Avogadro constant', () => {
    const expr = engine.box('AvogadroConstant').evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(6.02214076e23);
  });

  test('Vacuum permittivity', () => {
    const expr = engine.box('VacuumPermittivity').evaluate();
    expect(expr.operator).toBe('Quantity');
  });

  test('Gravitational constant', () => {
    const expr = engine.box('GravitationalConstant').evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(6.67430e-11);
  });

  test('Stefan-Boltzmann constant', () => {
    const expr = engine.box('StefanBoltzmannConstant').evaluate();
    expect(expr.operator).toBe('Quantity');
  });

  test('Gas constant', () => {
    const expr = engine.box('GasConstant').evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(8.314462618);
  });
});

describe('INTEGRATION', () => {
  test('Parse and evaluate: 12 cm + 1 m', () => {
    // Largest-scale-unit wins: m (scale=1) > cm (scale=0.01)
    const expr = engine.parse('12\\,\\mathrm{cm}+1\\,\\mathrm{m}').evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(1.12);
    expect(expr.op2.symbol).toBe('m');
  });

  test('Parse and evaluate: 5 km', () => {
    const expr = engine.parse('5\\,\\mathrm{km}').evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(5);
    expect(expr.op2.symbol).toBe('km');
  });

  test('LaTeX round-trip: simple quantity', () => {
    const latex = '5\\,\\mathrm{m}';
    const parsed = engine.parse(latex);
    expect(parsed.latex).toBe(latex);
  });

  test('Incompatible add remains unevaluated', () => {
    // Adding m + s cannot be combined; the engine returns an unevaluated Add
    const expr = engine
      .box(['Add', ['Quantity', 5, 'm'], ['Quantity', 3, 's']])
      .evaluate();
    expect(expr.operator).toBe('Add');
  });

  test('Logarithmic unit parse', () => {
    const expr = engine.box(['Quantity', 30, 'dB']);
    expect(expr.isValid).toBe(true);
  });
});

describe('NEGATE QUANTITIES', () => {
  test('Negate a simple quantity', () => {
    const expr = engine
      .box(['Negate', ['Quantity', 5, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(-5);
    expect(expr.op2.symbol).toBe('m');
  });

  test('Negate a quantity with compound unit', () => {
    const expr = engine
      .box(['Negate', ['Quantity', 10, ['Divide', 'm', 's']]])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(-10);
  });

  test('Negate via Subtract produces correct result', () => {
    // Subtract canonicalizes to Add + Negate, testing the indirect path
    const expr = engine
      .box(['Subtract', ['Quantity', 0, 'kg'], ['Quantity', 3, 'kg']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(-3);
    expect(expr.op2.symbol).toBe('kg');
  });
});

describe('SUBTRACT QUANTITIES', () => {
  test('Subtract same units', () => {
    const expr = engine
      .box(['Subtract', ['Quantity', 5, 'm'], ['Quantity', 2, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(3);
    expect(expr.op2.symbol).toBe('m');
  });

  test('Subtract compatible units (different scales)', () => {
    const expr = engine
      .box(['Subtract', ['Quantity', 1, 'm'], ['Quantity', 20, 'cm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBeCloseTo(0.8);
    expect(expr.op2.symbol).toBe('m');
  });

  test('Subtract to zero', () => {
    const expr = engine
      .box(['Subtract', ['Quantity', 5, 'kg'], ['Quantity', 5, 'kg']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(0);
  });
});

describe('FRACTIONAL POWERS ON QUANTITIES', () => {
  test('Sqrt of m^2 quantity', () => {
    const expr = engine
      .box(['Sqrt', ['Quantity', 9, ['Power', 'm', 2]]])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(3);
    expect(expr.op2.symbol).toBe('m');
  });

  test('Cube root of m^3 quantity', () => {
    const expr = engine
      .box(['Power', ['Quantity', 8, ['Power', 'm', 3]], ['Rational', 1, 3]])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(2);
    expect(expr.op2.symbol).toBe('m');
  });

  test('Sqrt of non-power unit gives fractional exponent', () => {
    const expr = engine
      .box(['Sqrt', ['Quantity', 4, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(2);
    // Unit should be Power(m, 0.5)
    expect(expr.op2.operator).toBe('Power');
  });

  test('Power(quantity, 2) squares the unit', () => {
    const expr = engine
      .box(['Power', ['Quantity', 3, 'm'], 2])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(9);
    expect(expr.op2.operator).toBe('Power');
  });
});

describe('MULTIPLY QUANTITY ORDERINGS', () => {
  test('scalar * quantity', () => {
    const expr = engine
      .box(['Multiply', 2, ['Quantity', 5, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(10);
    expect(expr.op2.symbol).toBe('m');
  });

  test('quantity * scalar', () => {
    const expr = engine
      .box(['Multiply', ['Quantity', 5, 'm'], 2])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(10);
    expect(expr.op2.symbol).toBe('m');
  });

  test('multiple scalars * quantity', () => {
    const expr = engine
      .box(['Multiply', 2, 3, ['Quantity', 5, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(30);
    expect(expr.op2.symbol).toBe('m');
  });

  test('quantity * quantity produces combined unit', () => {
    const expr = engine
      .box(['Multiply', ['Quantity', 2, 'm'], ['Quantity', 3, 's']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(6);
    expect(expr.op2.operator).toBe('Multiply');
  });
});

describe('N SYMBOL AS NEWTON', () => {
  test('Quantity(5, N) is valid', () => {
    const expr = engine.box(['Quantity', 5, 'N']);
    expect(expr.isValid).toBe(true);
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(5);
  });

  test('UnitDimension(N) returns force dimension', () => {
    const expr = engine.box(['UnitDimension', 'N']).evaluate();
    expect(expr.operator).toBe('List');
    // Force: [1, 1, -2, 0, 0, 0, 0]
    expect(expr.op1.re).toBe(1); // length
  });

  test('IsCompatibleUnit(N, N) is True', () => {
    const expr = engine.box(['IsCompatibleUnit', 'N', 'N']).evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('UnitConvert(1000 N, kN) works', () => {
    const expr = engine
      .box(['UnitConvert', ['Quantity', 1000, 'N'], 'kN'])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(1);
    expect(expr.op2.symbol).toBe('kN');
  });

  test('Parse 5 mathrm{N} as Newton', () => {
    const expr = engine.parse('5\\,\\mathrm{N}');
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(5);
    expect(expr.op2.symbol).toBe('N');
  });

  test('LaTeX round-trip for Newton', () => {
    const expr = engine.box(['Quantity', 5, 'N']);
    expect(expr.latex).toBe('5\\,\\mathrm{N}');
  });
});

describe('LATEX ROUND-TRIP COMPOUND UNITS', () => {
  test('m/s serializes correctly', () => {
    const expr = engine.box(['Quantity', 10, ['Divide', 'm', 's']]);
    expect(expr.latex).toBe('10\\,\\mathrm{m/s}');
  });

  test('m/s^2 serializes correctly', () => {
    const expr = engine.box([
      'Quantity', 9.8,
      ['Divide', 'm', ['Power', 's', 2]],
    ]);
    expect(expr.latex).toBe('9.8\\,\\mathrm{m/s^{2}}');
  });

  test('kg*m*s^-2 serializes with cdot', () => {
    const expr = engine.box([
      'Quantity', 100,
      ['Multiply', 'kg', 'm', ['Power', 's', -2]],
    ]);
    // Negative exponent in Multiply → converted to fraction form
    expect(expr.latex).toContain('\\mathrm{');
  });

  test('Parsed compound unit round-trips', () => {
    const original = '9.8\\,\\mathrm{m/s^{2}}';
    const parsed = engine.parse(original);
    expect(parsed.latex).toBe(original);
  });
});

describe('UNIT CANCELLATION', () => {
  test('Same unit division gives scalar', () => {
    const expr = engine
      .box(['Divide', ['Quantity', 10, 'm'], ['Quantity', 2, 'm']])
      .evaluate();
    expect(expr.re).toBe(5);
    expect(expr.operator).not.toBe('Quantity');
  });

  test('Compatible unit division gives scalar with scale', () => {
    const expr = engine
      .box(['Divide', ['Quantity', 1, 'km'], ['Quantity', 500, 'm']])
      .evaluate();
    expect(expr.re).toBe(2);
  });

  test('Different dimension division gives compound unit', () => {
    const expr = engine
      .box(['Divide', ['Quantity', 100, 'm'], ['Quantity', 10, 's']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(10);
  });
});

describe('AUTO-SIMPLIFY COMPOUND UNITS', () => {
  test('N * m simplifies to J', () => {
    const expr = engine
      .box(['Multiply', ['Quantity', 5, 'N'], ['Quantity', 2, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(10);
    expect(expr.op2.symbol).toBe('J');
  });

  test('J / m simplifies to N', () => {
    const expr = engine
      .box(['Divide', ['Quantity', 100, 'J'], ['Quantity', 10, 'm']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(10);
    expect(expr.op2.symbol).toBe('N');
  });

  test('J / s simplifies to W', () => {
    const expr = engine
      .box(['Divide', ['Quantity', 60, 'J'], ['Quantity', 2, 's']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(30);
    expect(expr.op2.symbol).toBe('W');
  });
});

describe('QUANTITY COMPARISON', () => {
  test('Less: 500m < 1km', () => {
    const expr = engine
      .box(['Less', ['Quantity', 500, 'm'], ['Quantity', 1, 'km']])
      .evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('Less: 1km < 500m is False', () => {
    const expr = engine
      .box(['Less', ['Quantity', 1, 'km'], ['Quantity', 500, 'm']])
      .evaluate();
    expect(expr.symbol).toBe('False');
  });

  test('Greater: 1km > 500m', () => {
    const expr = engine
      .box(['Greater', ['Quantity', 1, 'km'], ['Quantity', 500, 'm']])
      .evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('Equal: 100cm == 1m', () => {
    const expr = engine
      .box(['Equal', ['Quantity', 100, 'cm'], ['Quantity', 1, 'm']])
      .evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('Equal: 1km == 1000m', () => {
    const expr = engine
      .box(['Equal', ['Quantity', 1, 'km'], ['Quantity', 1000, 'm']])
      .evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('LessEqual: 1km <= 1000m', () => {
    const expr = engine
      .box(['LessEqual', ['Quantity', 1, 'km'], ['Quantity', 1000, 'm']])
      .evaluate();
    expect(expr.symbol).toBe('True');
  });

  test('Incompatible units stay unevaluated', () => {
    const expr = engine
      .box(['Less', ['Quantity', 5, 'm'], ['Quantity', 3, 's']])
      .evaluate();
    expect(expr.operator).toBe('Less');
  });
});

describe('DIMENSIONS EQUAL / IS DIMENSIONLESS', () => {
  test('Same dimension vectors are equal', () => {
    expect(dimensionsEqual([1, 0, -2, 0, 0, 0, 0], [1, 0, -2, 0, 0, 0, 0])).toBe(true);
  });

  test('Different dimension vectors are not equal', () => {
    expect(dimensionsEqual([1, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0])).toBe(false);
  });

  test('Zero vector is dimensionless', () => {
    expect(isDimensionless([0, 0, 0, 0, 0, 0, 0])).toBe(true);
  });

  test('Non-zero vector is not dimensionless', () => {
    expect(isDimensionless([1, 0, 0, 0, 0, 0, 0])).toBe(false);
  });
});

describe('BOXED TO UNIT EXPRESSION', () => {
  test('Simple symbol unit', () => {
    const expr = engine.box('m');
    expect(boxedToUnitExpression(expr)).toBe('m');
  });

  test('Divide expression', () => {
    const expr = engine.box(['Divide', 'm', 's']);
    const ue = boxedToUnitExpression(expr);
    expect(ue).toEqual(['Divide', 'm', 's']);
  });

  test('Multiply expression', () => {
    const expr = engine.box(['Multiply', 'kg', 'm']);
    const ue = boxedToUnitExpression(expr);
    expect(ue).toEqual(['Multiply', 'kg', 'm']);
  });

  test('Power expression', () => {
    const expr = engine.box(['Power', 's', 2]);
    const ue = boxedToUnitExpression(expr);
    expect(ue).toEqual(['Power', 's', 2]);
  });

  test('Nested compound expression', () => {
    const expr = engine.box(['Divide', ['Multiply', 'kg', 'm'], ['Power', 's', 2]]);
    const ue = boxedToUnitExpression(expr);
    expect(ue).toEqual(['Divide', ['Multiply', 'kg', 'm'], ['Power', 's', 2]]);
  });

  test('Non-unit expression returns null', () => {
    const expr = engine.box(['Add', 1, 2]);
    expect(boxedToUnitExpression(expr)).toBeNull();
  });

  test('Number expression returns null', () => {
    const expr = engine.box(42);
    expect(boxedToUnitExpression(expr)).toBeNull();
  });
});

describe('PARSE UNIT DSL EDGE CASES', () => {
  test('Empty string returns null', () => {
    expect(parseUnitDSL('')).toBeNull();
  });

  test('Whitespace-only returns null', () => {
    expect(parseUnitDSL('   ')).toBeNull();
  });

  test('Malformed exponent falls back to plain token', () => {
    // m/s^abc — parseInt('abc') is NaN, so parseUnitToken returns 's^abc' as-is
    const result = parseUnitDSL('m/s^abc');
    expect(result).toEqual(['Divide', 'm', 's^abc']);
  });

  test('Negative exponent', () => {
    const result = parseUnitDSL('s^-2');
    expect(result).toEqual(['Power', 's', -2]);
  });

  test('Deeply nested parens', () => {
    const result = parseUnitDSL('((m))');
    expect(result).toBe('m');
  });

  test('Unbalanced parens do not crash', () => {
    // Should not throw; may return unusual result
    expect(() => parseUnitDSL('(m/s')).not.toThrow();
    expect(() => parseUnitDSL('m/s)')).not.toThrow();
  });

  test('Multiple products with parens: (kg*m)/(s^2*A)', () => {
    const result = parseUnitDSL('(kg*m)/(s^2*A)');
    expect(result).toEqual([
      'Divide',
      ['Multiply', 'kg', 'm'],
      ['Multiply', ['Power', 's', 2], 'A'],
    ]);
  });
});

describe('CONVERT COMPOUND UNIT WITH SIMPLE STRINGS', () => {
  test('Simple string units delegate to convertUnit (linear)', () => {
    // km to m — linear conversion
    const result = convertCompoundUnit(1, 'km', 'm');
    expect(result).toBe(1000);
  });

  test('Simple string units handle affine offset (degC to K)', () => {
    const result = convertCompoundUnit(100, 'degC', 'K');
    expect(result).toBeCloseTo(373.15);
  });

  test('Simple string units handle affine offset (degC to degF)', () => {
    const result = convertCompoundUnit(0, 'degC', 'degF');
    expect(result).toBeCloseTo(32);
  });

  test('Incompatible simple strings return null', () => {
    expect(convertCompoundUnit(1, 'm', 's')).toBeNull();
  });
});

describe('TEMPERATURE ARITHMETIC EDGE CASES', () => {
  test('Adding degC quantities uses convertUnit (affine-aware)', () => {
    // Adding two degC values: the largest-scale-unit strategy picks degC
    // for both, so no conversion needed — just sums the magnitudes.
    // This is a "temperature difference" interpretation.
    const expr = engine
      .box(['Add', ['Quantity', 20, 'degC'], ['Quantity', 10, 'degC']])
      .evaluate();
    expect(expr.operator).toBe('Quantity');
    expect(expr.op1.re).toBe(30);
  });
});
