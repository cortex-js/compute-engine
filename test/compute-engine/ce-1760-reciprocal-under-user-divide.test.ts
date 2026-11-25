import { ComputeEngine, expand } from '../../src/compute-engine';

// CE-1760: in a scope where a user function named `Divide` shadows the
// library `Divide`, a quotient that the arithmetic code builds (the
// reciprocal `1/y` of `y^{-1}`, `y.inv()`, a division `1.div(y)`, the
// reciprocal root `1/∛y` of `y^{-1/3}`) is bound to the library `Divide`,
// not to the user function (`libraryFn()`, `library-shadowing.ts`).

function withUserDivide(fn: (ce: ComputeEngine) => void): void {
  const ce = new ComputeEngine();
  ce.pushScope();
  ce.declare('Divide', 'function');
  ce.assign('Divide', ce.expr(['Function', 1000, 'u', 'v']));
  try {
    fn(ce);
  } finally {
    ce.popScope();
  }
}

describe('CE-1760: a reciprocal built in a scope with a user Divide', () => {
  test('the power y^{-1} is the library reciprocal', () => {
    withUserDivide((ce) => {
      const e = ce.expr(['Power', 'y', -1]);
      expect(e.subs({ y: 4 }).evaluate().json).toEqual(['Rational', 1, 4]);
      const x = ce.expr(['Multiply', 'x', ['Power', 'y', -1]]);
      expect(x.subs({ x: 3, y: 4 }).evaluate().json).toEqual([
        'Rational',
        3,
        4,
      ]);
    });
  });

  test('inv(), div(), pow(-1) and root(-2) of a symbol', () => {
    withUserDivide((ce) => {
      const y = ce.symbol('y');
      const at4 = (e: ReturnType<typeof ce.symbol>) =>
        e.subs({ y: 4 }).evaluate().json;
      expect(at4(y.inv())).toEqual(['Rational', 1, 4]);
      expect(at4(y.pow(-1))).toEqual(['Rational', 1, 4]);
      expect(at4(ce.One.div(y))).toEqual(['Rational', 1, 4]);
      expect(at4(y.root(-2))).toEqual(['Rational', 1, 2]);
    });
  });

  test('a negative unit-fraction power y^{-1/3}', () => {
    withUserDivide((ce) => {
      const e = ce.expr(['Power', 'y', ['Rational', -1, 3]]);
      expect(e.subs({ y: 8 }).evaluate().json).toEqual(['Rational', 1, 2]);
    });
  });

  test('root(-n) of a function and of a number, a quotient, an expansion', () => {
    withUserDivide((ce) => {
      const r = ce.expr(['Root', 'y', 3]).root(-2);
      expect(r.subs({ y: 64 }).evaluate().json).toEqual(['Rational', 1, 2]);
      expect(ce.number(4).root(-2).evaluate().json).toEqual(['Rational', 1, 2]);
      const q = ce.symbol('x').div(ce.expr(['Multiply', 4, 'y']));
      expect(q.subs({ x: 3, y: 1 }).evaluate().json).toEqual([
        'Rational',
        3,
        4,
      ]);
      const ex = expand(
        ce.expr(['Multiply', ['Add', 'x', 1], ['Power', 'y', -1]])
      );
      expect(ex.subs({ x: 1, y: 4 }).evaluate().json).toEqual([
        'Rational',
        1,
        2,
      ]);
    });
  });

  test('the exponent 1/n of a root', () => {
    withUserDivide((ce) => {
      // A negative radicand with a non-integer degree is read as `Power`
      expect(ce.expr(['Root', -8, 0.5]).evaluate().re).toBe(64);
      // An infinite radicand is read as `Power` too
      expect(ce.expr(['Root', 'NegativeInfinity', 3]).evaluate().json).toEqual(
        'NegativeInfinity'
      );
      expect(ce.expr(['Root', 'PositiveInfinity', -2]).evaluate().json).toEqual(
        0
      );
      expect(
        ce.expr(['Root', 'y', 'n']).subs({ y: 8, n: 3 }).evaluate().json
      ).toEqual(2);
    });
  });

  test('a call of the user Divide stays a call of the user function', () => {
    withUserDivide((ce) => {
      const e = ce.expr(['Divide', 1, 'y']);
      expect(e.subs({ y: 4 }).evaluate().json).toEqual(1000);
    });
  });

  test('outside the scope, the reciprocal is a plain Divide', () => {
    const ce = new ComputeEngine();
    const e = ce.expr(['Power', 'y', -1]);
    expect(e.json).toEqual(['Divide', 1, 'y']);
    expect(e.subs({ y: 4 }).evaluate().json).toEqual(['Rational', 1, 4]);
  });
});
