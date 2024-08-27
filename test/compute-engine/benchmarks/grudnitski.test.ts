import { BoxedExpression, ComputeEngine } from '../../../src/compute-engine';

export const ce = new ComputeEngine();

function isEquivalent(a: string | BoxedExpression, b: string): boolean {
  const lhs = typeof a === 'string' ? ce.parse(a) : a;
  return lhs.isSame(ce.parse(b));
}

function isEquivalentSimplify(a: string | BoxedExpression, b: string): boolean {
  const lhs = typeof a === 'string' ? ce.parse(a) : a;
  return lhs.simplify().isSame(ce.parse(b).simplify());
}

function isEqual(a: string, b: string): boolean {
  return ce.parse(a).isEqual(ce.parse(b));
}

describe.skip(`numbers (integers, floats, operators +-*/,)`, () => {
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
  test(`isEquivalent('Eq(2*x+4,2)', 'Eq(x+2,1)')`, () =>
    expect(isEquivalent('2x+4 = 2', 'x + 2 = 1')).toBeTruthy());
});

describe.skip(`arithmetic equalities`, () => {
  test(`isEquivalent('Eq(1,5-4+3-2-1)','Eq(1,1)', allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify('1 = 1', '1 = 5 - 4 + 3 - 2 - 1')
    ).toBeTruthy());

  test(`not isEquivalent('Eq(1,5-4+3-2-1)','Eq(1,1)', allowSimplify=False)`, () =>
    expect(isEquivalent('1 = 5 - 4 + 3 - 2 - 1', '1 = 1')).toBeFalsy());

  test(`isEquivalent('Eq(1,1)', 'Eq(1,5-4+3-2-1)', allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify('1 = 1', '1 = 5 - 4 + 3 - 2 - 1')
    ).toBeTruthy());

  test(`not isEquivalent('Eq(1,1)', 'Eq(1,5-4+3-2-1)', allowSimplify =False)`, () =>
    expect(isEquivalent('1 = 1', '1 = 5 - 4 + 3 - 2 - 1')).toBeFalsy());

  test(`not isEquivalent('Eq(1,5-4+3-2-1)','True')`, () =>
    expect(
      isEqual('1 = 5 - 4 + 3 - 2 - 1', '\\operatorname{True}')
    ).toBeFalsy());

  test(`not isEquivalent('True', 'Eq(1,5-4+3-2-1)')`, () =>
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

  test(`isEquivalent('Eq(2,1)','Eq(1,2)')`, () =>
    expect(isEquivalent('2 = 1', '1 = 2')).toBeTruthy());

  test(`isEquivalent('Eq(1+1,1)','Eq(1,2)')`, () =>
    expect(isEquivalent('1+1 = 1', '1 =  2')).toBeTruthy());

  test(`isEquivalent('Ne(2,1)','Ne(2,1)')`, () =>
    expect(isEquivalent('2 \\ne 1', '2 \\ne 1')).toBeTruthy());

  test(`isEquivalent('Ne(2,1)','Ne(1,2)')`, () =>
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

describe.skip(`reloaded division operator to float division`, () => {
  test(`isEquivalent('Eq(x,0.5)', 'Eq(x,1/2)')`, () =>
    expect(isEquivalent('x = 0.5', 'x = \\frac12')).toBeTruthy());

  test(`isEquivalent('Eq(x,0.5)', 'Eq(x,.5)')`, () =>
    expect(isEquivalent('x = 0.5', 'x = .5')).toBeTruthy());

  test(`isEquivalent('0.5', '.5')`, () =>
    expect(isEquivalent('0.5', '.5')).toBeTruthy());

  test(`isEquivalent('x**(1/2)','x**0.5')`, () =>
    expect(isEquivalent('x^{\\frac12}', 'x^{0.5}')).toBeTruthy());
});

describe.skip(`multiplication expansion`, () => {
  test(`isEquivalent('a*(a+b)', 'a**2+a*b', allowSimplify = True)`, () =>
    expect(isEquivalentSimplify('a(a+b)', 'a^2+ab')).toBeTruthy());

  test(`isEquivalent('a*(a+b)', 'a**2.0+a*b', allowSimplify = True)`, () =>
    expect(isEquivalentSimplify('a(a+b)', 'a^{2.0}+ab')).toBeTruthy());

  test(`not isEquivalent('a*(a+b)', 'a**2+a*b', allowSimplify = False)`, () =>
    expect(isEquivalent('a(a+b)', 'a^2+ab')).toBeFalsy());

  test(`isEquivalent('Eq(y,x**2-6*x+5)', 'Eq(y,(x-1)*(x-5))', allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify('y = x^2-6x+5', 'y = (x-1)(x-5)')
    ).toBeTruthy());

  test(`not isEquivalent('Eq(y,x**2-6*x+5)', 'Eq(y,(x-1)*(x-5))', allowSimplify = False)`, () =>
    expect(isEquivalent('y - x^2-6x+5', 'y = (x-1)(x-5)')).toBeFalsy());

  test(`isEquivalent('Eq(y,(x-1)*(x-5))', 'Eq(x**2-6*x+5,y)', allowSimplify = True)`, () =>
    expect(isEquivalentSimplify('(x-1)(x-5)', 'x^2+6x-5')).toBeTruthy());

  test(`not isEquivalent('Eq(y,(x-1)*(x-5))', 'Eq(x**2-6*x+5,y)', allowSimplify = False)`, () =>
    expect(isEquivalent('(x-1)(x-5)', 'x^2+6x-5')).toBeFalsy());

  test(`isEquivalent('Eq(a,2*b+1)','Eq(-2*b-1,-a)')`, () =>
    expect(isEquivalent('a = 2b + 1', '-2b-1 = -a')).toBeTruthy());

  test(`not isEquivalent('Eq(a,2*b+1)','Eq(-2*b-1,-a+1)')`, () =>
    expect(isEquivalent('a = 2b+1', '-2b -1 = -a + 1')).toBeFalsy());
});

describe.skip(`Trig functions and identities`, () => {
  test(`isEquivalent('cos(t)', 'sin(t+pi/2)')`, () =>
    expect(isEquivalent('\\cos(t)', '\\sin(t+\\frac\\pi2)')).toBeTruthy());

  test(`isEquivalent('cos(t+pi/2)', '-sin(t)')`, () =>
    expect(isEquivalent('\\cos(t+\\frac\\pi2)', '-\\sin(t)')).toBeTruthy());

  test(`isEquivalent('sin(2*x)','2*sin(x)*cos(x)',trigIdentities=True)`, () =>
    expect(isEquivalent('\\sin(2x)', '2\\sin(x)\\cos(x)')).toBeTruthy());

  test(`isEquivalent('cos(2*x)','1-2*sin(x)**2',trigIdentities=True)`, () =>
    expect(isEquivalent('\\cos(2x)', '1-2\\sin(x)^2')).toBeTruthy());

  test(`isEquivalent('cos(x/0.5)','1-2*sin(x)**2',trigIdentities=True)`, () =>
    expect(
      isEquivalent('\\cos(\\frac{x}{0.5})', '1-2\\sin(x)^2')
    ).toBeTruthy());

  test(`isEquivalent('sin(x)**2+cos(x)**2', '1')`, () =>
    expect(isEquivalent('sin(x)^2+cos(x)^2', '1')).toBeTruthy());
});

describe.skip(`Log functions and identities`, () => {
  test(`isEquivalent('exp(2*x)','(exp(x))**2')`, () =>
    expect(
      isEquivalent('\\exponentialE^{2x}', '(\\exponentialE^x)^2')
    ).toBeTruthy());

  test(`isEquivalent('exp(ln(x))','x')`, () =>
    expect(isEquivalent('\\exp(\\ln(x))', 'x')).toBeTruthy());

  test(`isEquivalent('log(x**2)','2*log(x)',logIdentities=True,forceAssumptions=True)`, () =>
    expect(isEquivalent('\\log(x^2)', '2\\log(x)')).toBeTruthy());
});

describe.skip(`Solve system of equations/inequalities`, () => {
  test(`not isEquivalent("Eq(28.80*y*3*h,86.4*y*h)", "Eq(y,9.6*h)")`, () =>
    expect(isEquivalent('28.80y3h = 86.4yh', 'y = 9.6h')).toBeFalsy());

  test(`not isEquivalent('Eq(y,3)','Eq(y,3*x-2)')`, () =>
    expect(isEquivalent('y = 3', 'y = 3x-2')).toBeFalsy());

  test(`not isEquivalent('(Eq(2*x+6*y,25.50))','Eq(y,-10.8*x**2+83.08*x-9.99)')`, () =>
    expect(
      isEquivalent('2x+6y = 25.5', 'y = -10.8x^2+83.08x-9.99')
    ).toBeFalsy());
});

describe.skip(`Rounding error`, () => {
  test(`isEquivalent('Eq(x,7)','Eq(3.45*x,24.15)')`, () =>
    expect(isEquivalent('x = 7', '3.45x = 24.15')).toBeTruthy());

  test(`not isEquivalent('Eq(x,7.1)','Eq(3.45*x,24.15)')`, () =>
    expect(isEquivalent('x = 7.1', '3.45x = 24.15')).toBeFalsy());
});

describe.skip(`Relational equivalence`, () => {
  test(`isEquivalent('Eq(x,1)', 'Eq(1,x)')`, () =>
    expect(isEquivalent('x =  1', '1 = x')).toBeTruthy());

  test(`isEquivalent('Gt(x,1)', 'Lt(1,x)')`, () =>
    expect(isEquivalent('x \\gt 1', '1 \\lt x')).toBeTruthy());

  test(`not isEquivalent('Gt(x,1)', 'Lt(x,1)')`, () =>
    expect(isEquivalent('x \\gt 1', 'x \\lt 1')).toBeFalsy());

  test(`isEquivalent('Ne(x,1)', 'Ne(1,x)')`, () =>
    expect(isEquivalent('x \\ne 1', '1 \\ne x')).toBeTruthy());

  test(`isEquivalent('Ge(x,1)', 'Le(1,x)')`, () =>
    expect(isEquivalent('x \\ge 1', '1 \\le x')).toBeTruthy());

  test(`not isEquivalent('Ge(x,1)', 'Le(x,1)')`, () =>
    expect(isEquivalent('x \\ge 1', 'x \\le 1')).toBeFalsy());

  test(`isEquivalent('Ge(x,6.99999999999999999)', 'Le(7.0,x)')`, () =>
    expect(
      isEquivalent('x \\ge 6.99999999999999999', '7.0 \\le x')
    ).toBeTruthy());

  test(`isEquivalent('Lt(225,x)', 'Gt(4*x,900)')`, () =>
    expect(isEquivalent('225 \\lt x', '4x \\gt 900')).toBeTruthy());

  test(`not isEquivalent('Lt(225.1,x)', 'Gt(4*x,900)')`, () =>
    expect(isEquivalent('225.1 \\lt x', '4x\\gt 900')).toBeFalsy());

  test(`not isEquivalent('Lt(x,225)', 'Gt(4*x,900)')`, () =>
    expect(isEquivalent('x \\lt 225', '4x \\gt 900')).toBeFalsy());
});

describe.skip(`adding second representation for exponentials`, () => {
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
  test(`isEquivalent('((((x*y))*12+((2*x+2*y))*z))*1.25', '2.5*(6*x*y+x*z+y*z)', allowSimplify = True)`, () =>
    expect(
      isEquivalentSimplify(
        '((((x*y))*12+((2*x+2*y))*z))*1.25',
        '2.5*(6*x*y+x*z+y*z)'
      )
    ).toBeTruthy());
  test(`isEquivalent('(Eq(f(5)*30+2.25,152.25))','Eq(f(5),5)')`, () =>
    expect(
      isEquivalent('f(5)\\times30 + 2.25 = 152.25', 'f(5) = 5')
    ).toBeTruthy());
  test(`isEquivalent('Eq(f(5)+1,5+1)','Eq(f(5),5)')`, () =>
    expect(isEquivalent('f(5) + 1 = 5 + 1', 'f(5) = 5')).toBeTruthy());

  test(`isEquivalent('Eq(f(5)*2,5*2)','Eq(f(5),5)')`, () =>
    expect(
      isEquivalent('f(5) \\times 2 = 5 \\times 2', 'f(5) = 5')
    ).toBeTruthy());

  test(`not isEquivalent('Eq(f(4),5)','Eq(f(5),5)')`, () =>
    expect(isEquivalent('f(4) = 5', 'f(5) = 5')).toBeFalsy());

  test(`not isEquivalent('Eq(f(5),4)','Eq(f(5),5)')`, () =>
    expect(isEquivalent('f(5) = 4', 'f(5) = 5')).toBeFalsy());

  test(`isEquivalent('(Eq(f((60))*x,60.25))','Eq(x*f((60))/60.25,1)')`, () =>
    expect(
      isEquivalent(
        'f((60)) \\times x = 60.25',
        'x \\times \\frac{f((60))}{60.26} = 1'
      )
    ).toBeTruthy());

  test(`not isEquivalent('Eq(5.5*p*2.0,sin((6)))', 'Eq(2.75**(1/14), (1+p/100))')`, () =>
    expect(
      isEquivalent(
        '5.5p \\times 2.0 = sin((6))',
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
    expect(isEquivalent(eq4, '\\fra{t-c}{m} = h')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq((t-m*h)/c,1)')`, () =>
    expect(isEquivalent(eq4, '\\frac{t-mh}{c} = 1')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq(c/(t-m*h),1)')`, () =>
    expect(isEquivalent(eq4, '\\frac{c}{t-mh} = 1')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq(1/h,m/(t-c))')`, () =>
    expect(isEquivalent(eq4, '\\frac{1}{h} =  \\frac{m}{t-v}')).toBeFalsy());
  test(`not isEquivalent('Eq(t+5*h+150*c,30*m)', 'Eq(1/m,h/(t-c))')`, () =>
    expect(isEquivalent(eq4, '\\frac{1}{m} = \\frac{h}{t-c}')).toBeFalsy());
  test(`not isEquivalent('Eq(2500,(1000)*((1+((((r/4))))**(((4*7))))))','Eq(2500,1000*(((1+(r/4))))**(((28))))')`, () =>
    expect(
      isEquivalent(
        '2500 = (1000)*((1+((((\\frac{r}{4}))))^{(((4*7))))))',
        '2500 = 1000 * (((1+(\\frac{r}{4}))))^{(((28)))}'
      )
    ).toBeFalsy());
  test(`isEquivalent('Eq(2500,1000*(1+r/4)**(4*7))','Eq(2500*2+1,1000*(1+r/4)**(4*7)*2+1)')`, () =>
    expect(
      isEquivalent(
        '2500 = 1000\\times(1+\\frac{r}{4}^{4\\times7}',
        '2500\\times2+1 = 1000\\times(1+\\frac{r}{4}^{(4\\times7)\\times2+1}'
      )
    ).toBeTruthy());
  test(`not isEquivalent('sin','(x-5*y*I)*(x+5*y*I)')`, () =>
    expect(isEquivalent('\\sin', 'x-5y\\times{\\imaginaryI}')).toBeFalsy());
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

  const eq6 = ce.parse('w+((w+1)) = (4.5+6 = 6)');
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

  const eq5 = ce.parse(
    'a = p \\times \\exponentialE^{kt} + t^{c+1} + \\exp(d) + exp(exp(f))'
  );

  test(`isEquivalent("Eq(a,p*(e)**(k*t)+t**(c+1)+exp(d)+exp(exp(f)))", "Eq(a,p*(e)**(k*t)+t**(c+1)+exp(d)+exp(exp(f)))")`, () =>
    expect(
      isEquivalent(
        eq5,
        'a = p \\times \\exponentialE^{kt} + t^{c+1} + \\exp(d) + exp(exp(f))'
      )
    ).toBeTruthy());

  test(`isEquivalent("Eq(a,p*(e)**(k*t)+t**(c+1)+exp(d)+exp(exp(f)))","Eq(a,p*((e))**(((k*t)))+t**((c)+1)+exp(d)+exp(exp(f)))")`, () =>
    expect(
      isEquivalent(
        eq5,
        'a = p \\times ((\\exponetialE))^{(((kt)))} + t^{((c)+1)} + \\exp(d) + \\exp(exp(f))'
      )
    ).toBeTruthy());

  test(`not isEquivalent("Eq(a,p*(e)**(k*t)+t**(c+1)+exp(d)+exp(exp(f)))","Eq(a,1+p*((e))**(((k*t)))+t**((c)+1)+exp(d)+exp(exp(f)))")`, () =>
    expect(
      isEquivalent(
        eq5,
        'q = 1+p \\times ((\\exponentialE))^{(((kt)))}+t^{((c)+1)+\\exp(d)+\\exp(\\exp(f))'
      )
    ).toBeFalsy());

  test(`isEquivalent("Eq(a,p*(e)**(k*t))", "Eq(a,p*(e)**(((k*t))))")`, () =>
    expect(
      isEquivalent(
        'a = p \\times \\exponentialE^{kt}',
        'a =  \\times \\exponentialE^{((kt))}'
      )
    ).toBeTruthy());
});
