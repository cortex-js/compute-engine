import { ComputeEngine } from '../../src/compute-engine';

// CE-1759: in a scope where a user function named `Power` shadows the
// library `Power`, a power that the arithmetic code builds (the square
// `y^2` of the product `y·y`, `y.pow(2)`, the radical `2^(2/3)` of a
// product) is bound to the library `Power`, not to the user function
// (`libraryFn()`, `library-shadowing.ts`). A call of the user function is a
// value: `pow()` does not read it as a power.

type Expr = ReturnType<ComputeEngine['symbol']>;

function withUserPower(fn: (ce: ComputeEngine) => void): ComputeEngine {
  const ce = new ComputeEngine();
  ce.pushScope();
  ce.declare('Power', 'function');
  ce.assign('Power', ce.expr(['Function', ['Add', 'a', 'b', 100], 'a', 'b']));
  try {
    fn(ce);
  } finally {
    ce.popScope();
  }
  return ce;
}

const valueAt = (e: Expr, at: Record<string, number>) => e.subs(at).N().re;

describe('CE-1759: a power built in a scope with a user Power', () => {
  test('the product y·y is the library square, in and after the scope', () => {
    let p: Expr | undefined;
    withUserPower((ce) => {
      const y = ce.symbol('y');
      p = y.mul(y);
      expect(valueAt(p, { y: 3 })).toBe(9);
    });
    expect(valueAt(p!, { y: 3 })).toBe(9);
  });

  test('pow() of a symbol and of a sum', () => {
    withUserPower((ce) => {
      const y = ce.symbol('y');
      expect(valueAt(y.pow(2), { y: 3 })).toBe(9);
      expect(valueAt(y.pow(-2), { y: 2 })).toBe(0.25);
      const s = ce.expr(['Add', 'x', 'y']);
      expect(valueAt(s.pow(2), { x: 1, y: 2 })).toBe(9);
    });
  });

  test('a product with a library power factor', () => {
    const ce = new ComputeEngine();
    const square = ce.expr(['Power', 'y', 2]);
    const radical = ce.expr(['Power', 2, ['Rational', 2, 3]]);
    ce.pushScope();
    ce.declare('Power', 'function');
    ce.assign('Power', ce.expr(['Function', ['Add', 'a', 'b', 100], 'a', 'b']));
    try {
      const y = ce.symbol('y');
      const x = ce.symbol('x');
      expect(valueAt(y.mul(square), { y: 3 })).toBe(27);
      expect(valueAt(y.mul(y).mul(x), { x: 2, y: 3 })).toBe(18);
      expect(valueAt(x.mul(radical), { x: 1 })).toBeCloseTo(2 ** (2 / 3), 12);
      expect(valueAt(y.div(y.mul(y)), { y: 4 })).toBe(0.25);
    } finally {
      ce.popScope();
    }
  });

  test('a call of the user Power is a value, not a power', () => {
    withUserPower((ce) => {
      // `Power(x, 3)` is the user function: `x + 3 + 100`.
      const u = ce.expr(['Power', 'x', 3]);
      expect(valueAt(u, { x: 1 })).toBe(104);
      expect(valueAt(u.pow(2), { x: 1 })).toBe(104 * 104);
      expect(valueAt(u.mul(u), { x: 1 })).toBe(104 * 104);
    });
  });

  test('without a user Power, y·y is Power(y, 2)', () => {
    const ce = new ComputeEngine();
    const y = ce.symbol('y');
    expect(y.mul(y).json).toEqual(['Power', 'y', 2]);
  });
});
