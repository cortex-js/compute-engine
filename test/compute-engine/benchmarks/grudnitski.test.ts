import { Expression, ComputeEngine } from '../../../src/compute-engine';

// Pairs of expressions and equations from an equivalence benchmark. Each test
// name is the call of the original benchmark; `allowSimplify = True` maps to
// `isEquivalentSimplify()`, and a call with no flag maps to `isEquivalent()`.
//
// `isSame()` compares structure (`types-expression.ts`), so a pair whose two
// forms differ after canonicalization (or after `simplify()`) is not the same,
// even when the two have the same value. A test whose expectation the engine
// does not give is a `test.failing`, with a comment that gives the reason:
//
// - "Contract": the expectation differs from documented behavior that will
//   not change. The canonical form folds exact arithmetic on literals, does
//   not apply trigonometric or logarithmic identities, keeps the two sides of
//   an equation in the order given and does not scale them, makes `Sqrt(x)`
//   of `x^(1/2)` but not of `x^0.5`, and keeps every digit of a decimal.
//   `isEqual()` compares values.
// - "Not a normal form": `simplify()` gives two different forms for two
//   expressions with the same value. `simplify()` does not promise a normal
//   form, so this is a missing capability, not a defect.
//
// A `test.failing` that starts to pass makes Jest report a failure: then
// change it to `test`. The group "equivalence proved by isIdenticallyEqual()"
// at the end checks the same pairs with the method that decides equivalence.

export const ce = new ComputeEngine();

/**
 * `true` when `isIdenticallyEqual()` establishes that the two are equal for
 * every value of their free variables (by sampling, or by a symbolic proof).
 */
function isProvedEquivalent(a: string, b: string): boolean {
  return ce.parse(a).isIdenticallyEqual(ce.parse(b)) === true;
}

function isEquivalent(a: string | Expression, b: string): boolean {
  const lhs = typeof a === 'string' ? ce.parse(a) : a;
  return lhs.isSame(ce.parse(b));
}

function isEquivalentSimplify(a: string | Expression, b: string): boolean {
  const lhs = typeof a === 'string' ? ce.parse(a) : a;
  return lhs.simplify().isSame(ce.parse(b).simplify());
}

function isEqual(a: string, b: string): boolean {
  return ce.parse(a).isEqual(ce.parse(b));
}

describe(`numbers (integers, floats, operators +-*/,)`, () => {
  //     #numbers (integers, floats, operators +-*/,)
  test(`isEquivalent('2', '1+1')`, () =>
    expect(isEquivalent('1+1', '2')).toBeTruthy());
  test(`not isEquivalent('2', '1')`, () =>
    expect(isEquivalent('1', '2')).toBeFalsy());
  test(`isEquivalent('2.1', '0.21e+1')`, () =>
    expect(isEquivalent('2.1', '0.21e+1')).toBeTruthy());
  test(`isEquivalent('1/3', '2/6')`, () =>
    expect(isEquivalent('\\frac13', '\\frac26')).toBeTruthy());
  test(`not isEquivalent('1/3', '0.333')`, () =>
    expect(isEquivalent('\\frac13', '0.333')).toBeFalsy());
  test(`isEquivalent('2', '2.0')`, () =>
    expect(isEquivalent('2', '2.0')).toBeTruthy());
  test(`isEquivalent('Eq(x,2)', 'Eq(x,2.0)')`, () =>
    expect(isEquivalent('x = 2', 'x = 2.0')).toBeTruthy());
  test(`isEquivalent('Eq(x,2)', 'Eq(x,1+1)')`, () =>
    expect(isEquivalent('x = 2', 'x = 1 + 1')).toBeTruthy());
  // Contract: the sides of an equation are not scaled. `simplify()` makes
  // the two the same.
  test.failing(`isEquivalent('Eq(2*x+4,2)', 'Eq(x+2,1)')`, () =>
    expect(isEquivalent('2x+4 = 2', 'x + 2 = 1')).toBeTruthy());
});

describe(`arithmetic equalities`, () => {
  test(`isEquivalent('Eq(1,5-4+3-2-1)','Eq(1,1)', allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify('1 = 1', '1 = 5 - 4 + 3 - 2 - 1')
    ).toBeTruthy());

  // Contract: the canonical form folds exact arithmetic on literals, so
  // `5-4+3-2-1` is `1` before any simplification.
  test.failing(`not isEquivalent('Eq(1,5-4+3-2-1)','Eq(1,1)', allowSimplify=False)`, () =>
    expect(isEquivalent('1 = 5 - 4 + 3 - 2 - 1', '1 = 1')).toBeFalsy());

  test(`isEquivalent('Eq(1,1)', 'Eq(1,5-4+3-2-1)', allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify('1 = 1', '1 = 5 - 4 + 3 - 2 - 1')
    ).toBeTruthy());

  // Contract: as above, the canonical form folds `5-4+3-2-1` to `1`.
  test.failing(`not isEquivalent('Eq(1,1)', 'Eq(1,5-4+3-2-1)', allowSimplify =False)`, () =>
    expect(isEquivalent('1 = 1', '1 = 5 - 4 + 3 - 2 - 1')).toBeFalsy());

  // Contract: `isEqual()` compares values, and the value of `1 = 1` is
  // `True`.
  test.failing(`not isEquivalent('Eq(1,5-4+3-2-1)','True')`, () =>
    expect(
      isEqual('1 = 5 - 4 + 3 - 2 - 1', '\\operatorname{True}')
    ).toBeFalsy());

  // Contract: as above, `isEqual()` compares values.
  test.failing(`not isEquivalent('True', 'Eq(1,5-4+3-2-1)')`, () =>
    expect(
      isEqual('\\operatorname{True}', '1 = 5 - 4 + 3 - 2 - 1')
    ).toBeFalsy());

  test(`isEquivalent('True', 'True')`, () =>
    expect(isEqual('True', 'True')).toBeTruthy());

  test(`isEquivalent('False', 'False')`, () =>
    expect(
      isEqual('\\operatorname{False}', '\\operatorname{False}')
    ).toBeTruthy());

  test(`not isEquivalent('True', 'False')`, () =>
    expect(
      isEqual('\\operatorname{True}', '\\operatorname{False}')
    ).toBeFalsy());

  test(`not isEquivalent('2','3')`, () =>
    expect(isEquivalent('2', '3')).toBeFalsy());

  test(`not isEquivalent('Eq(2,1)','Eq(3,2)')`, () =>
    expect(isEquivalent('2 = 1', '3 = 2')).toBeFalsy());

  test(`isEquivalent('Eq(2,1)','Eq(2,1)')`, () =>
    expect(isEquivalent('2 = 1', '2 = 1')).toBeTruthy());

  // Contract: the canonical form keeps the two sides of an equation in the
  // order given.
  test.failing(`isEquivalent('Eq(2,1)','Eq(1,2)')`, () =>
    expect(isEquivalent('2 = 1', '1 = 2')).toBeTruthy());

  // Contract: as above, the sides keep their order.
  test.failing(`isEquivalent('Eq(1+1,1)','Eq(1,2)')`, () =>
    expect(isEquivalent('1+1 = 1', '1 =  2')).toBeTruthy());

  test(`isEquivalent('Ne(2,1)','Ne(2,1)')`, () =>
    expect(isEquivalent('2 \\ne 1', '2 \\ne 1')).toBeTruthy());

  // Contract: the sides of `NotEqual` keep their order too.
  test.failing(`isEquivalent('Ne(2,1)','Ne(1,2)')`, () =>
    expect(isEquivalent('2 \\ne 1', '1 \\ne 2')).toBeTruthy());

  test(`isEquivalent('Le(1,2)','Le(1,2)')`, () =>
    expect(isEquivalent('1 \\le 2', '1  \\le 2')).toBeTruthy());

  test(`isEquivalent('Ge(2,1)','Le(1,2)')`, () =>
    expect(isEquivalent('2 \\ge 1', '1 \\le 2')).toBeTruthy());

  test(`isEquivalent('Ge(1+1,1)','Le(1,2)')`, () =>
    expect(isEquivalent('1 +  1 \\ge 1', '1 \\le 2')).toBeTruthy());

  test(`not isEquivalent('Ge(3,1)','Le(1,2)')`, () =>
    expect(isEquivalent('3 \\ge 1', '1 \\le 2')).toBeFalsy());

  test(`not isEquivalent('Ge(1+1+1,1)','Le(1,2)')`, () =>
    expect(isEquivalent('1 + 1 + 1 \\ge 1', '1 \\le 2')).toBeFalsy());

  test(`not isEquivalent('Le(1,2)','Lt(1,2)')`, () =>
    expect(isEquivalent('1 \\le 2', '1 \\lt 2')).toBeFalsy());

  test(`isEquivalent('Lt(1,2)','Lt(1,2)')`, () =>
    expect(isEquivalent('1 \\lt 2', '1 \\lt 2')).toBeTruthy());

  test(`isEquivalent('Gt(2,1)','Lt(1,2)')`, () =>
    expect(isEquivalent('2 \\gt 1', '1 \\lt 2')).toBeTruthy());

  test(`isEquivalent('Eq(9,63/7)','Eq(63/7,9)')`, () =>
    expect(
      isEquivalent('9 = \\frac{63}{7}', '\\frac{63}{7} = 9')
    ).toBeTruthy());
});

describe(`reloaded division operator to float division`, () => {
  test(`isEquivalent('Eq(x,0.5)', 'Eq(x,1/2)')`, () =>
    expect(isEquivalent('x = 0.5', 'x = \\frac12')).toBeTruthy());

  test(`isEquivalent('Eq(x,0.5)', 'Eq(x,.5)')`, () =>
    expect(isEquivalent('x = 0.5', 'x = .5')).toBeTruthy());

  test(`isEquivalent('0.5', '.5')`, () =>
    expect(isEquivalent('0.5', '.5')).toBeTruthy());

  // Contract: the exact exponent `1/2` makes `Sqrt(x)`; the decimal `0.5`
  // stays a decimal exponent.
  test.failing(`isEquivalent('x**(1/2)','x**0.5')`, () =>
    expect(isEquivalent('x^{\\frac12}', 'x^{0.5}')).toBeTruthy());
});

describe(`multiplication expansion`, () => {
  // Not a normal form: `simplify()` keeps `a(a+b)` factored and
  // `a^2+ab` expanded.
  test.failing(`isEquivalent('a*(a+b)', 'a**2+a*b', allowSimplify = True)`, () =>
    expect(isEquivalentSimplify('a(a+b)', 'a^2+ab')).toBeTruthy());

  // Not a normal form: as above.
  test.failing(`isEquivalent('a*(a+b)', 'a**2.0+a*b', allowSimplify = True)`, () =>
    expect(isEquivalentSimplify('a(a+b)', 'a^{2.0}+ab')).toBeTruthy());

  test(`not isEquivalent('a*(a+b)', 'a**2+a*b', allowSimplify = False)`, () =>
    expect(isEquivalent('a(a+b)', 'a^2+ab')).toBeFalsy());

  test(`isEquivalent('Eq(y,x**2-6*x+5)', 'Eq(y,(x-1)*(x-5))', allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify('y = x^2-6x+5', 'y = (x-1)(x-5)')
    ).toBeTruthy());

  test(`not isEquivalent('Eq(y,x**2-6*x+5)', 'Eq(y,(x-1)*(x-5))', allowSimplify = False)`, () =>
    expect(isEquivalent('y = x^2-6x+5', 'y = (x-1)(x-5)')).toBeFalsy());

  // The two tests below compare the right sides of the two equations of the
  // test name.
  test(`isEquivalent('Eq(y,(x-1)*(x-5))', 'Eq(x**2-6*x+5,y)', allowSimplify = True)`, () =>
    expect(isEquivalentSimplify('(x-1)(x-5)', 'x^2-6x+5')).toBeTruthy());

  test(`not isEquivalent('Eq(y,(x-1)*(x-5))', 'Eq(x**2-6*x+5,y)', allowSimplify = False)`, () =>
    expect(isEquivalent('(x-1)(x-5)', 'x^2-6x+5')).toBeFalsy());

  // Contract: the canonical form does not negate or swap the sides of an
  // equation.
  test.failing(`isEquivalent('Eq(a,2*b+1)','Eq(-2*b-1,-a)')`, () =>
    expect(isEquivalent('a = 2b + 1', '-2b-1 = -a')).toBeTruthy());

  test(`not isEquivalent('Eq(a,2*b+1)','Eq(-2*b-1,-a+1)')`, () =>
    expect(isEquivalent('a = 2b+1', '-2b -1 = -a + 1')).toBeFalsy());
});

describe(`Trig functions and identities`, () => {
  // Contract: the canonical form does not apply trigonometric identities.
  // `simplify()` makes the two the same.
  test.failing(`isEquivalent('cos(t)', 'sin(t+pi/2)')`, () =>
    expect(isEquivalent('\\cos(t)', '\\sin(t+\\frac\\pi2)')).toBeTruthy());

  // Contract: as above; `simplify()` makes the two the same.
  test.failing(`isEquivalent('cos(t+pi/2)', '-sin(t)')`, () =>
    expect(isEquivalent('\\cos(t+\\frac\\pi2)', '-\\sin(t)')).toBeTruthy());

  // Contract: as above; `simplify()` makes the two the same.
  test.failing(`isEquivalent('sin(2*x)','2*sin(x)*cos(x)',trigIdentities=True)`, () =>
    expect(isEquivalent('\\sin(2x)', '2\\sin(x)\\cos(x)')).toBeTruthy());

  // Contract: as above. Not a normal form: `simplify()` keeps `cos(2x)` and
  // `1-2sin(x)^2` as they are.
  test.failing(`isEquivalent('cos(2*x)','1-2*sin(x)**2',trigIdentities=True)`, () =>
    expect(isEquivalent('\\cos(2x)', '1-2\\sin(x)^2')).toBeTruthy());

  // Contract and not a normal form, as above.
  test.failing(`isEquivalent('cos(x/0.5)','1-2*sin(x)**2',trigIdentities=True)`, () =>
    expect(
      isEquivalent('\\cos(\\frac{x}{0.5})', '1-2\\sin(x)^2')
    ).toBeTruthy());

  // Contract: as above; `simplify()` makes the sum `1`.
  test.failing(`isEquivalent('sin(x)**2+cos(x)**2', '1')`, () =>
    expect(isEquivalent('\\sin(x)^2+\\cos(x)^2', '1')).toBeTruthy());
});

describe(`Log functions and identities`, () => {
  test(`isEquivalent('exp(2*x)','(exp(x))**2')`, () =>
    expect(
      isEquivalent('\\exponentialE^{2x}', '(\\exponentialE^x)^2')
    ).toBeTruthy());

  // Contract: the canonical form does not apply logarithmic identities.
  // `simplify()` makes the two the same.
  test.failing(`isEquivalent('exp(ln(x))','x')`, () =>
    expect(isEquivalent('\\exp(\\ln(x))', 'x')).toBeTruthy());

  // Contract: as above. The two are equal only for `x > 0`, which the
  // original benchmark assumes (`forceAssumptions`); for a real `x`,
  // `simplify()` gives `2log(|x|)`.
  test.failing(`isEquivalent('log(x**2)','2*log(x)',logIdentities=True,forceAssumptions=True)`, () =>
    expect(isEquivalent('\\log(x^2)', '2\\log(x)')).toBeTruthy());
});

describe(`Solve system of equations/inequalities`, () => {
  test(`not isEquivalent("Eq(28.80*y*3*h,86.4*y*h)", "Eq(y,9.6*h)")`, () =>
    expect(isEquivalent('28.80y3h = 86.4yh', 'y = 9.6h')).toBeFalsy());

  test(`not isEquivalent('Eq(y,3)','Eq(y,3*x-2)')`, () =>
    expect(isEquivalent('y = 3', 'y = 3x-2')).toBeFalsy());

  test(`not isEquivalent('(Eq(2*x+6*y,25.50))','Eq(y,-10.8*x**2+83.08*x-9.99)')`, () =>
    expect(
      isEquivalent('2x+6y = 25.5', 'y = -10.8x^2+83.08x-9.99')
    ).toBeFalsy());
});

describe(`Rounding error`, () => {
  // Contract: the sides of an equation are not scaled, and `simplify()` does
  // not divide by a decimal factor either.
  test.failing(`isEquivalent('Eq(x,7)','Eq(3.45*x,24.15)')`, () =>
    expect(isEquivalent('x = 7', '3.45x = 24.15')).toBeTruthy());

  test(`not isEquivalent('Eq(x,7.1)','Eq(3.45*x,24.15)')`, () =>
    expect(isEquivalent('x = 7.1', '3.45x = 24.15')).toBeFalsy());
});

describe(`Relational equivalence`, () => {
  // Contract: the canonical form keeps the two sides of an equation in the
  // order given. (It does reverse `Greater` to `Less`, see the next test.)
  test.failing(`isEquivalent('Eq(x,1)', 'Eq(1,x)')`, () =>
    expect(isEquivalent('x =  1', '1 = x')).toBeTruthy());

  test(`isEquivalent('Gt(x,1)', 'Lt(1,x)')`, () =>
    expect(isEquivalent('x \\gt 1', '1 \\lt x')).toBeTruthy());

  test(`not isEquivalent('Gt(x,1)', 'Lt(x,1)')`, () =>
    expect(isEquivalent('x \\gt 1', 'x \\lt 1')).toBeFalsy());

  // Contract: the sides of `NotEqual` keep their order.
  test.failing(`isEquivalent('Ne(x,1)', 'Ne(1,x)')`, () =>
    expect(isEquivalent('x \\ne 1', '1 \\ne x')).toBeTruthy());

  test(`isEquivalent('Ge(x,1)', 'Le(1,x)')`, () =>
    expect(isEquivalent('x \\ge 1', '1 \\le x')).toBeTruthy());

  test(`not isEquivalent('Ge(x,1)', 'Le(x,1)')`, () =>
    expect(isEquivalent('x \\ge 1', 'x \\le 1')).toBeFalsy());

  // Contract: a decimal keeps all its digits, so `6.99999999999999999` is
  // not `7.0`.
  test.failing(`isEquivalent('Ge(x,6.99999999999999999)', 'Le(7.0,x)')`, () =>
    expect(
      isEquivalent('x \\ge 6.99999999999999999', '7.0 \\le x')
    ).toBeTruthy());

  // Contract: the sides of an inequality are not scaled. `simplify()` makes
  // the two the same.
  test.failing(`isEquivalent('Lt(225,x)', 'Gt(4*x,900)')`, () =>
    expect(isEquivalent('225 \\lt x', '4x \\gt 900')).toBeTruthy());

  test(`not isEquivalent('Lt(225.1,x)', 'Gt(4*x,900)')`, () =>
    expect(isEquivalent('225.1 \\lt x', '4x\\gt 900')).toBeFalsy());

  test(`not isEquivalent('Lt(x,225)', 'Gt(4*x,900)')`, () =>
    expect(isEquivalent('x \\lt 225', '4x \\gt 900')).toBeFalsy());
});

describe(`adding second representation for exponentials`, () => {
  test(`isEquivalent('Eq(y,(x)**(1/3))', 'Eq(y,(x)**(1/3))', allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify('y = x^\\frac13', 'y = x^\\frac13')
    ).toBeTruthy());

  const eq3 = 'y = \\sqrt[3]{x}';

  test(`isEquivalent('Eq(y,nthroot(x,3))', 'Eq(y,(x)**(1/3))',allowSimplify = True)`, () =>
    expect(isEquivalentSimplify(eq3, 'y = x^\\frac13')).toBeTruthy());
  test(`isEquivalent('Eq(y,nthroot(x,3))', 'Eq(y,nthroot(x,3))',allowSimplify = True)`, () =>
    expect(isEquivalentSimplify(eq3, eq3)).toBeTruthy());
  test(`isEquivalent('Eq(y,nthroot(x,3))', 'Eq(y,(x)**(1/3))',allowSimplify = True)`, () =>
    expect(isEquivalentSimplify(eq3, 'y = x^\\frac13')).toBeTruthy());
  test(`isEquivalent('Eq(y,nthroot(x,2))', 'Eq(y,sqrt(x))',allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify('y = \\sqrt[2]{x}', 'y = \\sqrt{x}')
    ).toBeTruthy());
  // Not a normal form: `simplify()` gives `15xy+2.5z(x+y)` for the first
  // and `15xy+2.5xz+2.5yz` for the second.
  test.failing(`isEquivalent('((((x*y))*12+((2*x+2*y))*z))*1.25', '2.5*(6*x*y+x*z+y*z)', allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify(
        '((((x*y))*12+((2*x+2*y))*z))*1.25',
        '2.5*(6*x*y+x*z+y*z)'
      )
    ).toBeTruthy());
  // Contract: the sides of an equation are not moved or scaled, and
  // `simplify()` does not subtract a term from both sides.
  test.failing(`isEquivalent('(Eq(f(5)*30+2.25,152.25))','Eq(f(5),5)')`, () =>
    expect(
      isEquivalent('f(5)\\times30 + 2.25 = 152.25', 'f(5) = 5')
    ).toBeTruthy());
  // Contract: as above.
  test.failing(`isEquivalent('Eq(f(5)+1,5+1)','Eq(f(5),5)')`, () =>
    expect(isEquivalent('f(5) + 1 = 5 + 1', 'f(5) = 5')).toBeTruthy());

  // Contract: the sides of an equation are not scaled. `simplify()` makes
  // the two the same.
  test.failing(`isEquivalent('Eq(f(5)*2,5*2)','Eq(f(5),5)')`, () =>
    expect(
      isEquivalent('f(5) \\times 2 = 5 \\times 2', 'f(5) = 5')
    ).toBeTruthy());

  test(`not isEquivalent('Eq(f(4),5)','Eq(f(5),5)')`, () =>
    expect(isEquivalent('f(4) = 5', 'f(5) = 5')).toBeFalsy());

  test(`not isEquivalent('Eq(f(5),4)','Eq(f(5),5)')`, () =>
    expect(isEquivalent('f(5) = 4', 'f(5) = 5')).toBeFalsy());

  // Contract: the sides of an equation are not scaled.
  test.failing(`isEquivalent('(Eq(f((60))*x,60.25))','Eq(x*f((60))/60.25,1)')`, () =>
    expect(
      isEquivalent(
        'f((60)) \\times x = 60.25',
        'x \\times \\frac{f((60))}{60.25} = 1'
      )
    ).toBeTruthy());

  test(`not isEquivalent('Eq(5.5*p*2.0,sin((6)))', 'Eq(2.75**(1/14), (1+p/100))')`, () =>
    expect(
      isEquivalent(
        '5.5p \\times 2.0 = \\sin((6))',
        '2.75^{\\frac{1}{14}} = (1 + \\frac{p}{100})'
      )
    ).toBeFalsy());

  const eq4 = ce.parse('t+5h+150c = 30m');

  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq(t,c+m*h)')`, () =>
    expect(isEquivalent(eq4, 't = c+m\\times h')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq(1,(c+m*h)/t)')`, () =>
    expect(isEquivalent(eq4, '1 = \\frac{c+m\\times h}{t}')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq(t/(c+m*h),1)')`, () =>
    expect(isEquivalent(eq4, '\\frac{t}{c+mh} = 1')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq((t-c)/(m*h),1)')`, () =>
    expect(isEquivalent(eq4, '\\frac{t-c}{mh} = 1')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq((t-c)/h,m)')`, () =>
    expect(isEquivalent(eq4, '\\frac{t-c}{h} = m')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq((t-c)/m,h)')`, () =>
    expect(isEquivalent(eq4, '\\frac{t-c}{m} = h')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq((t-m*h)/c,1)')`, () =>
    expect(isEquivalent(eq4, '\\frac{t-mh}{c} = 1')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq(c/(t-m*h),1)')`, () =>
    expect(isEquivalent(eq4, '\\frac{c}{t-mh} = 1')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq(1/h,m/(t-c))')`, () =>
    expect(isEquivalent(eq4, '\\frac{1}{h} =  \\frac{m}{t-c}')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq(1/m,h/(t-c))')`, () =>
    expect(isEquivalent(eq4, '\\frac{1}{m} = \\frac{h}{t-c}')).toBeFalsy());
  test(`not isEquivalent('Eq(2500,(1000)*((1+((((r/4))))**(((4*7))))))','Eq(2500,1000*(((1+(r/4))))**(((28))))')`, () =>
    expect(
      isEquivalent(
        '2500 = (1000)*((1+((((\\frac{r}{4}))))^{(((4*7))))))',
        '2500 = 1000 * (((1+(\\frac{r}{4}))))^{(((28)))}'
      )
    ).toBeFalsy());
  // Contract: the sides of an equation are not scaled or moved.
  test.failing(`isEquivalent('Eq(2500,1000*(1+r/4)**(4*7))','Eq(2500*2+1,1000*(1+r/4)**(4*7)*2+1)')`, () =>
    expect(
      isEquivalent(
        '2500 = 1000\\times(1+\\frac{r}{4})^{4\\times7}',
        '2500\\times2+1 = 1000\\times(1+\\frac{r}{4})^{4\\times7}\\times2+1'
      )
    ).toBeTruthy());
  test(`not isEquivalent('sin','(x-5*y*I)*(x+5*y*I)')`, () =>
    expect(
      isEquivalent('\\sin', '(x-5y\\imaginaryI)(x+5y\\imaginaryI)')
    ).toBeFalsy());
  test(`not isEquivalent('4*y*nthroot(y,((Abs(744487))))', '(3)*(y)*(0.65)')`, () =>
    expect(
      isEquivalent('4y\\sqrt[y]{((|744487|))}', '(3)\\times(y)\\times(0.65)')
    ).toBeFalsy());

  test(`not isEquivalent('(((251.05)))**(((5466532)))', '5')`, () =>
    expect(isEquivalent('(((251.05)))^{(((5466532)))}', '5')).toBeFalsy());

  test(`not isEquivalent("40*1.05*(0)**(((n-1)))","40*(1.05)**(n-1)")`, () =>
    expect(
      isEquivalent(
        '40\\times1.05\\times(0)^{(((n-1)))}',
        '40\\times(1.05)^{n-1}'
      )
    ).toBeFalsy());

  test(`not isEquivalent('Eq(g(5),-0.5*x+512)', 'Eq(g(x),-.5*x+512)')`, () =>
    expect(isEquivalent('g(5) = -0.5x+512', 'g(x) = -.5x+512')).toBeFalsy());

  const eq6 = ce.parse('w+((w+1)) = (4.5+6 = t)');
  test(`not isEquivalent("Eq(w+((w+1)),(Eq(4.5+6,t)))","Eq(t,4.5*w+6)")`, () =>
    expect(isEquivalent(eq6, 't = 4.5w+6')).toBeFalsy());
  test(`not isEquivalent('Eq(g(5),-0.5*x+512)', 'Eq(g(x),-.5*x+512)')`, () =>
    expect(isEquivalent('g(5) = -0.5x+512', 'g(x) = -.5x + 512')).toBeFalsy());
  test(` not isEquivalent("Eq(w+((w+1)),(Eq(4.5+6,t)))","Eq(t,4.5*w+6)")`, () =>
    expect(isEquivalent(eq6, 't = 4.5w + 6')).toBeFalsy());
  test(`isEquivalent("Eq(A,P*(e)**(((k*t))))", "Eq(A,P*(e)**(k*t))")`, () =>
    expect(
      isEquivalent(
        'A = P\\times (\\exponentialE)^{((kt))}',
        'A = P\\times (\\exponentialE)^{(kt)}'
      )
    ).toBeTruthy());

  // The original benchmark writes `exp(exp(f))`. Here the variable is `u`:
  // the first use of a symbol as a variable declares it as a number, and
  // after that `f(5)` in the tests above would be read as `5f`. This parse
  // runs when Jest collects the tests, before any test of this group.
  const eq5 = ce.parse(
    'a = p \\times \\exponentialE^{kt} + t^{c+1} + \\exp(d) + \\exp(\\exp(u))'
  );

  test(`isEquivalent("Eq(a,p*(e)**(k*t)+t**(c+1)+exp(d)+exp(exp(f)))", "Eq(a,p*(e)**(k*t)+t**(c+1)+exp(d)+exp(exp(f)))")`, () =>
    expect(
      isEquivalent(
        eq5,
        'a = p \\times \\exponentialE^{kt} + t^{c+1} + \\exp(d) + \\exp(\\exp(u))'
      )
    ).toBeTruthy());

  test(`isEquivalent("Eq(a,p*(e)**(k*t)+t**(c+1)+exp(d)+exp(exp(f)))","Eq(a,p*((e))**(((k*t)))+t**((c)+1)+exp(d)+exp(exp(f)))")`, () =>
    expect(
      isEquivalent(
        eq5,
        'a = p \\times ((\\exponentialE))^{(((kt)))} + t^{((c)+1)} + \\exp(d) + \\exp(\\exp(u))'
      )
    ).toBeTruthy());

  test(`not isEquivalent("Eq(a,p*(e)**(k*t)+t**(c+1)+exp(d)+exp(exp(f)))","Eq(a,1+p*((e))**(((k*t)))+t**((c)+1)+exp(d)+exp(exp(f)))")`, () =>
    expect(
      isEquivalent(
        eq5,
        'a = 1+p \\times ((\\exponentialE))^{(((kt)))}+t^{((c)+1)}+\\exp(d)+\\exp(\\exp(u))'
      )
    ).toBeFalsy());

  test(`isEquivalent("Eq(a,p*(e)**(k*t))", "Eq(a,p*(e)**(((k*t))))")`, () =>
    expect(
      isEquivalent(
        'a = p \\times \\exponentialE^{kt}',
        'a = p \\times \\exponentialE^{((kt))}'
      )
    ).toBeTruthy());
});

// The pairs above that the benchmark calls equivalent and that `isSame()`
// does not show, checked with `isIdenticallyEqual()`: two equations are
// equivalent when their sides, in either order, are identically equal, or
// when one is the other with both sides moved or scaled.
describe(`equivalence proved by isIdenticallyEqual()`, () => {
  test.each([
    ['2x+4 = 2', 'x + 2 = 1'],
    ['2 = 1', '1 = 2'],
    ['1+1 = 1', '1 = 2'],
    ['2 \\ne 1', '1 \\ne 2'],
    ['x^{\\frac12}', 'x^{0.5}'],
    ['a(a+b)', 'a^2+ab'],
    ['a(a+b)', 'a^{2.0}+ab'],
    ['y = (x-1)(x-5)', 'x^2-6x+5 = y'],
    ['a = 2b + 1', '-2b-1 = -a'],
    ['\\cos(t)', '\\sin(t+\\frac\\pi2)'],
    ['\\cos(t+\\frac\\pi2)', '-\\sin(t)'],
    ['\\sin(2x)', '2\\sin(x)\\cos(x)'],
    ['\\cos(2x)', '1-2\\sin(x)^2'],
    ['\\cos(\\frac{x}{0.5})', '1-2\\sin(x)^2'],
    ['\\sin(x)^2+\\cos(x)^2', '1'],
    ['\\exp(\\ln(x))', 'x'],
    ['x = 7', '3.45x = 24.15'],
    ['x =  1', '1 = x'],
    ['x \\ne 1', '1 \\ne x'],
    ['225 \\lt x', '4x \\gt 900'],
    ['((((x*y))*12+((2*x+2*y))*z))*1.25', '2.5*(6*x*y+x*z+y*z)'],
    [
      '2500 = 1000\\times(1+\\frac{r}{4})^{4\\times7}',
      '2500\\times2+1 = 1000\\times(1+\\frac{r}{4})^{4\\times7}\\times2+1',
    ],
  ])('%s and %s are equivalent', (a, b) =>
    expect(isProvedEquivalent(a, b)).toBe(true)
  );

  // `isIdenticallyEqual()` gives `undefined` for these equations, which
  // contain a call `f(5)` of a function with no definition.
  test.failing.each([
    ['f(5)\\times30 + 2.25 = 152.25', 'f(5) = 5'],
    ['f(5) + 1 = 5 + 1', 'f(5) = 5'],
    ['f(5) \\times 2 = 5 \\times 2', 'f(5) = 5'],
    ['f((60)) \\times x = 60.25', 'x \\times \\frac{f((60))}{60.25} = 1'],
  ])('%s and %s are equivalent', (a, b) =>
    expect(isProvedEquivalent(a, b)).toBe(true)
  );

  // Two pairs are not in this group. `\log(x^2)` and `2\log(x)` differ for a
  // negative `x`. `x \ge 6.99999999999999999` and `7.0 \le x` differ for an
  // `x` between the two bounds: sampling does not find such an `x`, so
  // `isIdenticallyEqual()` gives `true`, which is not a proof.

  test.each([
    ['x = 7.1', '3.45x = 24.15'],
    ['y = 3', 'y = 3x-2'],
    ['a = 2b+1', '-2b -1 = -a + 1'],
    ['x \\gt 1', 'x \\lt 1'],
    ['x \\ge 1', 'x \\le 1'],
    ['225.1 \\lt x', '4x\\gt 900'],
    ['x \\lt 225', '4x \\gt 900'],
    ['f(4) = 5', 'f(5) = 5'],
    ['t+5h+150c = 30m', 't = c+m\\times h'],
    ['(x-1)(x-5)', 'x^2+6x-5'],
  ])('%s and %s are not proved equivalent', (a, b) =>
    expect(isProvedEquivalent(a, b)).toBe(false)
  );
});
