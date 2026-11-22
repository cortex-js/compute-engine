/**
 * CE-1708: `isFinite` of a function expression is memoized, like `sgn`. A
 * chain `Sqrt(Add(x, Sqrt(Add(x, …))))` with `x` declared `real` was walked
 * to its end at each read, and the derivative of a function of 37 such
 * levels, with a parameter named `x`, took about 1.8 times as long as with
 * a parameter `p`.
 */
import { ComputeEngine } from '../../src/compute-engine';

function chain(name: string, depth: number): unknown {
  let body: unknown = ['Sqrt', name];
  for (let i = 1; i < depth; i++) body = ['Sqrt', ['Add', name, body]];
  return body;
}

describe('isFinite of a function expression', () => {
  test('a second read computes nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box(chain('x', 37) as never);
    const proto = Object.getPrototypeOf(expr);
    const spy = jest.spyOn(proto, '_isFiniteUncached');
    const first = expr.isFinite;
    const computed = spy.mock.calls.length;
    expect(computed).toBeGreaterThan(0);
    expect(expr.isFinite).toBe(first);
    expect(spy.mock.calls.length).toBe(computed);
    spy.mockRestore();
  });

  test('a first read at the root of a deep chain does not overflow', () => {
    // The operands are filled deepest first: a recursive first read
    // overflowed the stack at about 2,000 levels.
    const ce = new ComputeEngine();
    let expr = ce.box('x');
    for (let i = 0; i < 5000; i++) expr = ce.function('Sin', [expr]);
    expect(() => expr.isFinite).not.toThrow();
  });

  test('a new value of an operand is read again', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    const expr = ce.box(['Add', 'w', 1]);
    ce.assign('w', 2);
    expect(expr.isFinite).toBe(true);
    ce.assign('w', ce.PositiveInfinity);
    expect(expr.isFinite).not.toBe(true);
    ce.assign('w', 3);
    expect(expr.isFinite).toBe(true);
  });
});
