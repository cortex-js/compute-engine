import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

// The interpreter accepts a collection as the value of a symbol declared
// `expression`, and maps an element-wise operator over it. Compiled
// JavaScript reads such a symbol as a scalar, with no run-time test of its
// value, so a read of it as an input is declined and the interpreter
// computes the value. Arithmetic over a symbol declared `any` or `value`
// declines too, for the same reason.

const js = (ce: ComputeEngine, json: unknown, options: object = {}) =>
  compile(ce.box(json as never), { to: 'javascript', ...options } as never)!;

describe('COMPILED CODE AND AN INPUT DECLARED `expression`', () => {
  test('the interpreter maps `2x` over a list value of `x`', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'expression');
    const e = ce.box(['Multiply', 2, 'x'] as never);
    ce.assign('x', ce.box(['List', 1, 2] as never));
    expect(e.evaluate().json).toEqual(['List', 2, 4]);
  });

  test('`2x` declines, and the run gives the value of the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'expression');
    const result = js(ce, ['Multiply', 2, 'x']);
    expect(result.success).toBe(false);
    expect(result.run!({ x: [1, 2] })).toEqual([2, 4]);
    expect(result.run!({ x: 3 })).toBe(6);
  });

  test('a symbol declared with an alias of `expression` declines', () => {
    const ce = new ComputeEngine();
    ce.declareType('A', 'expression', { alias: true });
    ce.declare('x', 'A');
    const result = js(ce, ['Multiply', 2, 'x']);
    expect(result.success).toBe(false);
    expect(result.run!({ x: [1, 2] })).toEqual([2, 4]);
  });

  test('a read in the body of a user function declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'expression');
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', ['Add', 't', 'x'], 't'] as never));
    expect(js(ce, ['f', 2]).success).toBe(false);
  });

  test('a `vars` entry with source code declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'expression');
    const result = js(ce, ['Multiply', 2, 'x'], { vars: { x: '_.x' } });
    expect(result.success).toBe(false);
  });

  // A `vars` entry that is not a string declines too: `JSON.stringify`
  // inlines `Infinity` and `NaN` as `null`, and an array value would be
  // read as a scalar. The public `compile` refuses such an entry (`vars`
  // maps a symbol to source code), so the target is called directly.
  test('a `vars` entry that is a number declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'expression');
    expect(() =>
      new JavaScriptTarget().compile(
        ce.box(['Multiply', 2, 'x'] as never),
        { vars: { x: 3 } } as never
      )
    ).toThrow(/declared `expression`/);
  });

  // A symbol with an assigned value is folded: it is not an input.
  test('a symbol with an assigned value compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'expression');
    ce.assign('x', 3);
    const result = js(ce, ['Multiply', 2, 'x']);
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(6);
  });

  test('a symbol declared value declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'value');
    expect(() => js(ce, ['Multiply', 2, 'x'], { fallback: false })).toThrow(
      /"x": it is declared `any` or `value`/
    );
    const result = js(ce, ['Multiply', 2, 'x']);
    expect(result.success).toBe(false);
    expect(result.unsupported).toContain('x');
    expect(result.run!({ x: [1, 2] })).toEqual([2, 4]);
    expect(result.run!({ x: 3 })).toBe(6);
  });

  // An INPUT declared `any` is refused at compile time (ROADMAP CE-712.1).
  // Arithmetic over a parameter of the root function declared `any`
  // declines.
  test('an input declared any is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'any');
    const result = js(ce, ['Multiply', 2, 'x']);
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe('untyped-input');
    expect(result.unsupported).toContain('x');
  });

  test('a parameter declared any declines', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.box([
        'Function',
        ['Multiply', 2, 'x'],
        ['Typed', 'x', "'any'"],
      ] as never),
      { to: 'javascript' } as never
    )!;
    expect(result.success).toBe(false);
    expect(result.unsupported).toContain('x');
    const run = result.run as unknown as (x: unknown) => unknown;
    expect(run([1, 2])).toEqual([2, 4]);
    expect(run(3)).toBe(6);
  });
});
