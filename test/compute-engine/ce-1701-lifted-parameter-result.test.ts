/**
 * CE-1701: a function that passes its parameter whole to another function
 * (the slot takes that function's collection arm, CE-1696) and also uses
 * it as a number reports a result that holds the value of a list argument.
 * Its body was typed with the parameter as a number only, and with
 * `S(x) := Mean(x)`, `T(x) := S(x) + x` reported `number` while
 * `T([1, 2, 6])` is the list `[4, 5, 9]`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const L = ['List', 1, 2, 6];

describe('the result of a function with a lifted parameter', () => {
  test.each([
    ['assigned', false],
    ['declared function, then assigned', true],
  ])('%s', (_label, declared) => {
    const ce = new ComputeEngine();
    if (declared) ce.declare('S', 'function');
    ce.assign('S', ['Function', ['Mean', 'x'], 'x'] as never);
    ce.assign('T', ['Function', ['Add', ['S', 'x'], 'x'], 'x'] as never);
    const call = ce.box(['T', L] as never);
    const value = call.evaluate();
    expect(JSON.stringify(value.json)).toBe('["List",4,5,9]');
    expect(value.type.matches(call.type)).toBe(true);
    expect(value.type.matches(ce.box('T').type.type.result)).toBe(true);
  });

  test.each([
    ['a default value', ['Optional', 'x', 0]],
    ['a rest parameter after it', 'x', ['Spread', 'rest']],
  ])('a parameter with %s is typed any', (_label, ...params) => {
    // The literal is not typed again with the slot stamped on such a
    // parameter, so its result is `any`.
    const ce = new ComputeEngine();
    ce.assign('S', ['Function', ['Mean', 'x'], 'x'] as never);
    ce.assign('T', ['Function', ['Add', ['S', 'x'], 'x'], ...params] as never);
    const call = ce.box(['T', L] as never);
    const value = call.evaluate();
    expect(JSON.stringify(value.json)).toBe('["List",4,5,9]');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('a scalar argument keeps a number value in the result', () => {
    const ce = new ComputeEngine();
    ce.assign('S', ['Function', ['Mean', 'x'], 'x'] as never);
    ce.assign('T', ['Function', ['Add', ['S', 'x'], 'x'], 'x'] as never);
    const value = ce.box(['T', 3] as never).evaluate();
    expect(value.json).toBe(6);
  });

  test('a body that reads the parameter as a collection is unchanged', () => {
    const ce = new ComputeEngine();
    ce.assign('Fl', ['Function', ['Flatten', 'xs'], 'xs'] as never);
    expect(ce.box('Fl').type.toString()).toBe(
      '(xs: collection<any> | value) -> list'
    );
  });
});
