import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// The interpreter fallback of the profile `ir` on JavaScript: when the
// value of a declined program is a function value, `run` gives a JavaScript
// function that applies it with the interpreter and converts its result as
// the run does (`interpreterRun()`, `callable`). Before the fix the value
// was `NaN`, where the existing compiler gave a callable.

const ce = new ComputeEngine();

/** The run of `expr` compiled with the profile `ir`, which declines it. */
function irRun(expr: ReturnType<ComputeEngine['expr']>) {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const result = compile(expr, { profile: 'ir' });
    expect(result.success).toBe(false);
    return result.run as unknown as (...args: unknown[]) => unknown;
  } finally {
    warn.mockRestore();
  }
}

describe('the fallback of the profile ir gives a function value as a callable', () => {
  test('a nested Function: run(4)(3) is 7', () => {
    const run = irRun(
      ce.expr(['Function', ['Function', ['Add', 'x', 'y'], 'x'], 'y'])
    );
    const inner = run(4) as (x: number) => number;
    expect(typeof inner).toBe('function');
    expect(inner(3)).toBe(7);
    expect((run(10) as (x: number) => number)(5)).toBe(15);
  });

  test('Derivative(Sin): f(0) is 1', () => {
    const run = irRun(ce.box(['Derivative', 'Sin']));
    const f = run({}) as (x: number) => number;
    expect(typeof f).toBe('function');
    expect(f(0)).toBeCloseTo(1);
    expect(f(Math.PI)).toBeCloseTo(-1);
  });

  test('a curried function of three arguments', () => {
    const run = irRun(
      ce.expr([
        'Function',
        ['Function', ['Function', ['Add', 'x', 'y', 'z'], 'z'], 'y'],
        'x',
      ])
    );
    const g = run(1) as (y: number) => (z: number) => number;
    expect(typeof g(2)).toBe('function');
    expect(g(2)(3)).toBe(6);
  });

  test('a function that gives a list', () => {
    const run = irRun(
      ce.expr([
        'Function',
        ['Function', ['List', 'x', ['Multiply', 2, 'x'], 'y'], 'x'],
        'y',
      ])
    );
    expect((run(5) as (x: number) => unknown)(3)).toEqual([3, 6, 5]);
  });

  test('a function that gives a complex number', () => {
    const run = irRun(
      ce.expr(['Function', ['Function', ['Sqrt', 'x'], 'x'], 'y'])
    );
    expect((run(1) as (x: number) => unknown)(-4)).toEqual({ re: 0, im: 2 });
  });
});
