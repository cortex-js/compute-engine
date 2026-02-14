import { engine } from '../utils';
import {
  getUnitDimension,
  areCompatibleUnits,
  getUnitScale,
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
