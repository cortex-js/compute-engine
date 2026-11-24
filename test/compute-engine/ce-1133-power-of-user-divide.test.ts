import { ComputeEngine } from '../../src/compute-engine';

// CE-1133: a negative power of a call bound to a user function named
// `Divide` is a power of a value, not a power of a quotient. The
// distribution `(a/b)^{-n} = b^n/a^n` of `canonicalPower()` and the
// reciprocal `inv()` apply only to a call of the library `Divide`
// (`isLibraryOperator()`), and the reciprocal of a call of the user
// function is bound to the library `Divide`.

describe('CE-1133: a negative power of a call of a user Divide', () => {
  test('the power is a power of the value of the call', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('Divide', 'function');
    ce.assign('Divide', ce.expr(['Function', 1000, 'u', 'v']));
    const e2 = ce.expr(['Power', ['Divide', 'x', 2], -2]);
    const e1 = ce.expr(['Power', ['Divide', 'x', 2], -1]);
    const en = ce.expr(['Power', ['Divide', 'x', 2], ['Negate', 'n']]);
    expect(e2.json).toEqual(['Power', ['Divide', 'x', 2], -2]);
    expect(e2.subs({ x: 4 }).evaluate().json).toEqual(['Rational', 1, 1000000]);
    expect(e1.subs({ x: 4 }).evaluate().json).toEqual(['Rational', 1, 1000]);
    expect(en.subs({ x: 4, n: 2 }).evaluate().json).toEqual([
      'Rational',
      1,
      1000000,
    ]);
    // `Expression.pow()` reads the call as a value too
    const d = ce.expr(['Divide', 'x', 2]);
    expect(d.pow(-2).subs({ x: 4 }).evaluate().json).toEqual([
      'Rational',
      1,
      1000000,
    ]);
    // The reciprocal of another expression is a library quotient
    expect(
      ce
        .expr(['Power', ['Sin', 'x'], -1])
        .subs({ x: 1 })
        .N().re
    ).toBeCloseTo(1 / Math.sin(1), 12);
    ce.popScope();
  });

  test('a negative power of a library quotient keeps its value', () => {
    const ce = new ComputeEngine();
    const e2 = ce.expr(['Power', ['Divide', 'x', 2], -2]);
    const e1 = ce.expr(['Power', ['Divide', 'x', 2], -1]);
    expect(e2.subs({ x: 4 }).evaluate().json).toEqual(['Rational', 1, 4]);
    expect(e1.subs({ x: 4 }).evaluate().json).toEqual(['Rational', 1, 2]);
  });
});
