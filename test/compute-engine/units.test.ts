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
