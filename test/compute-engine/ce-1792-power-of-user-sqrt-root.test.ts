import { ComputeEngine } from '../../src/compute-engine';

// CE-1792: in a scope where a user function named `Sqrt` or `Root` shadows
// the library operator, a call of the user function is a value: `pow()` does
// not apply the rules `(√a)^b → a^(b/2)` and `(Root(a, n))^b → a^(b/n)` to it.

type Expr = ReturnType<ComputeEngine['symbol']>;

const valueAt = (e: Expr, at: Record<string, number>) => e.subs(at).N().re;

describe('CE-1792: a power of a call of a user Sqrt or Root', () => {
  test('a user Sqrt', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Sqrt', 'function');
      ce.assign('Sqrt', ce.expr(['Function', ['Add', 'a', 100], 'a']));
      // `Sqrt(x)` is the user function: `x + 100`.
      const s = ce.expr(['Sqrt', 'x']);
      expect(valueAt(s, { x: 1 })).toBe(101);
      expect(valueAt(s.pow(2), { x: 1 })).toBe(101 ** 2);
      expect(valueAt(s.pow(3), { x: 1 })).toBe(101 ** 3);
      expect(valueAt(s.pow(4), { x: 1 })).toBe(101 ** 4);
      expect(valueAt(s.mul(s), { x: 1 })).toBe(101 ** 2);
      const t = ce.expr(['Sqrt', 4]);
      expect(valueAt(t.pow(3), {})).toBe(104 ** 3);
    } finally {
      ce.popScope();
    }
  });

  test('a user Root', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('Root', 'function');
      ce.assign('Root', ce.expr(['Function', ['Add', 'a', 'b', 100], 'a', 'b']));
      // `Root(x, 3)` is the user function: `x + 3 + 100`.
      const r = ce.expr(['Root', 'x', 3]);
      expect(valueAt(r, { x: 1 })).toBe(104);
      expect(valueAt(r.pow(3), { x: 1 })).toBe(104 ** 3);
      expect(valueAt(r.mul(r).mul(r), { x: 1 })).toBe(104 ** 3);
    } finally {
      ce.popScope();
    }
  });

  test('without a user function, the library rules apply', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Sqrt', 'x']).pow(2).json).toEqual('x');
    expect(ce.expr(['Root', 'x', 3]).pow(3).json).toEqual('x');
  });
});
