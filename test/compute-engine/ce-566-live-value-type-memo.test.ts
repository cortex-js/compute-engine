import { ComputeEngine } from '../../src/compute-engine';

// The live type of the stored value of an inferred symbol is remembered
// against the bindings that value reads (`_liveValueType`,
// `boxed-value-definition.ts`), not against the engine-wide `any` axis, which
// every call of a function literal advances. These tests check that the
// remembered type follows a change of a binding that the value reads.

describe('live type of a stored value follows its dependencies', () => {
  test('a symbol typed from a value that reads a list is retyped when the list changes', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.expr(['List', 1, 2, 3]));
    ce.assign('C', ce.expr(['Map', ['Function', ['Add', 'k', 1], 'k'], 'L']));
    expect(ce.symbol('C').type.toString()).toBe('vector<integer^3>');
    // Calls of a function literal advance the `any` axis between the reads.
    ce.assign('F', ce.expr(['Function', ['Add', 'x', 1], 'x']));
    for (let i = 0; i < 3; i++) ce.expr(['F', i]).evaluate();
    expect(ce.symbol('C').type.toString()).toBe('vector<integer^3>');
    ce.assign('L', ce.expr(['List', 1, 2, 3, 4, 5]));
    expect(ce.symbol('C').type.toString()).toBe('vector<integer^5>');
  });

  test('the value read by a stored function follows a change of its dependency', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.expr(['List', 3, 1, 4, 1, 5]));
    ce.assign('C', ce.expr(['Map', ['Function', ['Add', 'k', 1], 'k'], 'L']));
    ce.assign('X', ce.expr(['Function', ['At', 'C', 'l'], 'l']));
    expect(ce.expr(['X', 2]).evaluate().json).toBe(2);
    ce.assign('L', ce.expr(['List', 10, 20, 30]));
    expect(ce.expr(['X', 2]).evaluate().json).toBe(21);
    expect(ce.expr(['X', 3]).evaluate().json).toBe(31);
  });
});
