import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// A symbol name is arbitrary user text. `subs()` must read only the own
// properties of the substitution object: a symbol named like a property of
// `Object.prototype` is not in `{ x: 1 }`.
describe('SUBS WITH A SYMBOL NAMED LIKE AN OBJECT PROPERTY', () => {
  test('constructor and toString are not replaced', () => {
    const expr = ce.box(['Add', 'x', 'constructor', 'toString']);
    const result = expr.subs({ x: 1 });
    expect(result.has('constructor')).toBe(true);
    expect(result.has('toString')).toBe(true);
    expect(result.has('x')).toBe(false);
    expect(result.has('Undefined')).toBe(false);
  });

  test('a symbol named constructor can still be replaced explicitly', () => {
    const expr = ce.box(['Add', 'x', 'constructor']);
    expect(expr.subs({ constructor: 2, x: 1 }).evaluate().re).toBe(3);
  });
});
