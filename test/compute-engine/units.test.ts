import { engine } from '../utils';

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
