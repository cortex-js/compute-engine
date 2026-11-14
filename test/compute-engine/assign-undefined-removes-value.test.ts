import { ComputeEngine } from '../../src/compute-engine';

//
// `ce.assign(name, undefined)` removes the value of a variable, and keeps its
// declaration and its type, as the documentation of `assign()` says (CE-1272).
//

describe('ce.assign(name, undefined) removes the value', () => {
  test('a declared name with no value keeps its declaration', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'real');
    expect(() => ce.assign('v', undefined)).not.toThrow();
    expect(ce.parse('v+1').evaluate().json).toEqual(['Add', 'v', 1]);
    expect(ce.box('v').type.toString()).toBe('real');
  });

  test('a declared name with a value loses the value and keeps the type', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'real');
    ce.assign('v', 1);
    expect(ce.parse('v+1').evaluate().json).toBe(2);
    ce.assign('v', undefined);
    expect(ce.parse('v+1').evaluate().json).toEqual(['Add', 'v', 1]);
    expect(ce.box('v').type.toString()).toBe('real');
  });

  test('a name made by an assignment loses its value', () => {
    const ce = new ComputeEngine();
    ce.assign('v', 1);
    ce.assign('v', undefined);
    expect(ce.parse('v+1').evaluate().json).toEqual(['Add', 'v', 1]);
    // The name can take a value again.
    ce.assign('v', 5);
    expect(ce.parse('v+1').evaluate().json).toBe(6);
  });

  test('an expression boxed before the call reads the change', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'real');
    ce.assign('v', 3);
    const expr = ce.parse('v+1');
    ce.parse('f(x) := x + v').evaluate();
    expect(expr.evaluate().json).toBe(4);
    expect(ce.parse('f(2)').evaluate().json).toBe(5);
    ce.assign('v', undefined);
    expect(expr.evaluate().json).toEqual(['Add', 'v', 1]);
    expect(ce.parse('f(2)').evaluate().json).toEqual(['Add', 'v', 2]);
  });

  test('the object form removes the value', () => {
    const ce = new ComputeEngine();
    ce.assign({ a: 1, b: 2 });
    ce.assign({ a: undefined });
    expect(ce.parse('a+b').evaluate().json).toEqual(['Add', 'a', 2]);
  });

  test('a name with no definition stays undeclared', () => {
    const ce = new ComputeEngine();
    expect(() => ce.assign('w', undefined)).not.toThrow();
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });

  test('a constant keeps its value', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { type: 'integer', value: 3, isConstant: true });
    expect(() => ce.assign('k', undefined)).toThrow(
      expect.objectContaining({ code: 'constant-assignment' })
    );
    expect(ce.parse('k+1').evaluate().json).toBe(4);
  });

  test('a macro refuses with the macro write error', () => {
    const ce = new ComputeEngine();
    ce.declare('A', { macro: ['Power', 'x', 2] });
    expect(() => ce.assign('A', undefined)).toThrow(/is a macro/);
  });

  test('a name defined as a function refuses with a message', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto x+1'));
    expect(() => ce.assign('g', undefined)).toThrow(/defined as a function/);
    expect(ce.parse('g(2)').evaluate().json).toBe(3);
  });
});
