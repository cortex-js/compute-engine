import { ComputeEngine } from '../../src/compute-engine';

//
// Regression tests for the `String` and `Type` core operators (2026-07-10).
//
// - `String(…)` joined its operands' *serialized* forms, so a string
//   operand's quotes leaked into the result value: `String("x = ", 3)`
//   produced the content `"x = "3` instead of `x = 3`. This broke Cortex
//   string interpolation (`"\(x)"` lowers to `String`).
// - `Type` is lazy (it must not evaluate its operand), but a lazy operand is
//   not canonical and a non-canonical expression has no type — so `Type(y)`
//   reported "unknown" even for a symbol bound to an integer.
//

describe('String operator joins values, not serialized forms', () => {
  test('string ++ number', () => {
    const ce = new ComputeEngine();
    const s = ce.box(['String', { str: 'x = ' }, 3]).evaluate();
    expect(s.string).toBe('x = 3');
  });

  test('string ++ string', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['String', { str: 'a' }, { str: 'b' }]).evaluate().string
    ).toBe('ab');
  });

  test('empty String() is the empty string', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['String']).evaluate().string).toBe('');
  });

  test('non-string operands use their default serialization', () => {
    const ce = new ComputeEngine();
    const s = ce
      .box(['String', { str: 'value: ' }, ['Rational', 1, 2]])
      .evaluate();
    expect(s.string).toBe('value: 1/2');
  });

  test('symbol operands contribute their value', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 42);
    expect(
      ce.box(['String', { str: 'x is ' }, 'x']).evaluate().string
    ).toBe('x is 42');
  });
});

describe('Type operator reports the canonical type without evaluating', () => {
  test('symbol bound to an integer', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 2047);
    expect(ce.box(['Type', 'y']).evaluate().string).toBe('integer');
  });

  test('number literal', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Type', 2047]).evaluate().string).toBe('finite_integer');
  });

  test('string literal', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Type', { str: 'abc' }]).evaluate().string).toBe('string');
  });

  test('function expression with a free variable', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Type', ['Add', 1, 'x']]).evaluate().string).toBe('number');
  });
});
