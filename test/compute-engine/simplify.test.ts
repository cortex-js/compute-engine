import { ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/types.ts';
import { simplify, exprToString } from '../utils';

export const ce = new ComputeEngine();

// \frac{\sin ^4\left(x\right)-\cos ^4\left(x\right)}{\sin ^2\left(x\right)-\cos ^2\left(x\right)}
// -> 1
// \frac{\sec \left(x\right)\sin ^2\left(x\right)}{1+\sec \left(x\right)}
// -> 1 - cos x
// \tan ^4\left(x\right)+2\tan ^2\left(x\right)+1
// -> \sec ^4\left(x\right)
// \tan ^2\left(x\right)\cos ^2\left(x\right)+\cot ^2\left(x\right)\sin ^2\left(x\right)
// -> 1

/**
 * Each test case is a tuple of two expressions:
 * - The first expression is the input expression to simplify.
 * - The second expression is the expected simplified expression.
 *
 * A third, optional element, is a comment to describe the test case.
 * If the comment starts with the keyword "skip", the test case will be skipped.
 * If the comment starts with the keyword "stop", the debugger will stop at this test case.
 */
export type TestCase =
  | [
      input: Expression | string,
      expected: Expression | string,
      comment?: string,
    ]
  | [heading: string];

/*
 * Some expressions get simplified during canonicalization.
 */
const CANONICALIZATION_TEST_CASES: TestCase[] = [
  [
    `
    // Arithmetic operations
    // - integers and float are simplified
    // - rational and square root of integers are preserved
    // (same behavior as Mathematica)
    //
  `,
  ],
  ['-23', -23, 'Integers should stay as is'],
  ['0.3', 0.3, 'Floating point should stay as is'],
  ['3/4', '3/4', 'Rational are reduced'],
  ['6/8', '3/4', 'Rational are reduced (during canonicalization)'],
  ['\\sqrt3', '\\sqrt3'],
  ['\\sqrt{3.1}', { num: '1.76068168616590091458' }],
  ['x+0', 'x', 'Zero is removed from addition'],
  ['-1234 - 5678', -6912],
  ['1.234 + 5678', 5679.234],
  ['1.234 + 5.678', 6.912],
  ['1.234 + 5.678 + 1.0001', 7.9121],
  ['2 + 4', 6],
  ['1/2 + 0.5', 1, 'Floating point and exact should get simplified'],
  ['\\sqrt3 + 3', '\\sqrt3 + 3', 'should stay exact'],
  ['\\sqrt3 + 1/2', '\\sqrt3 + 1/2', 'should stay exact'],
  ['\\sqrt3 + 0.3', { num: '2.0320508075688772' }],
  ['3/4 + 2', '11/4', 'Rational are reduced, but preserved as exact values'],
  ['3/4 + 5/7', '41/28', 'Rational are reduced, but preserved as exact values'],
  ['3.1/2.8', '1.10714285714285714286', 'Floating point division'],
  [
    ' 2x\\times x \\times 3 \\times x',
    '6x^3',
    'Product of x should be simplified',
  ],
  ['2(13.1+x)', '26.2+2x', 'Product of floating point should be simplified'],
  ['2(13.1+x) - 26.2 - 2x', 0],

  [
    `
    //
    // Numeric literals
    //
    `,
  ],
  ['\\sqrt3 - 2', '\\sqrt3 - 2', 'Should stay exact'],
  ['\\frac{\\sqrt5+1}{4}', '\\frac{\\sqrt5}{4}+\\frac14', 'Should stay exact'],
];

/**
 * A set of test cases for the simplification of expressions.
 */
const RULE_TEST_CASES: TestCase[] = [
  [
    `
    //
    // Other simplifications
    //
  `,
  ],
  ['\\ln(3)+\\ln(\\frac{1}{3})', 0],
  ['\\frac{\\ln(9)}{\\ln(3)}', 2],
  ['e e^x e^{-x}', 'e'], // 🙁 e * e^x * e^(-x)
  ['e^x e^{-x}', 1], // 🙁 e^x * e^(-x)
  [['Add', 1, 2, 1.0001], 4.0001],
  ['2\\left(13.1+x\\right)-\\left(26.2+2x\\right)', 0],
  ['\\sqrt{3}(\\sqrt2x + x)', '(\\sqrt3+\\sqrt6)x'], // 🙁 4.18154055035205529353 * x
  ['\\sqrt[4]{16b^{4}}', '2b'], // 🙁 root(16b^4)(4)

  [
    `
    //
    // Negative Signs and Powers
    //
  `,
  ],
  ['(-x)^3', '-x^3'], // 🙁 (-x)^3
  ['(-x)^{4/3}', 'x^{4/3}'], // 🙁 (-x)^(4/3)
  ['(-x)^4', 'x^4'], // 🙁 -x^4
  ['(-x)^{3/5}', '-x^{3/5}'], // 🙁 (-x)^(3/5)
  ['1/x-1/(x+1)', '1/(x(x+1))'], // 🙁 -1 / (x + 1) + 1 / x
  ['\\sqrt[3]{-2}', '-\\sqrt[3]{2}'], // 🙁 root(-2)(3)

  [
    `
    //
    // Addition and Subtraction
    //
  `,
  ],
  ['-2+x', 'x-2'],
  ['x-(-1)', 'x+1'],
  ['x+(-1)', 'x-1'],

  [
    `
    //
    // Combine Like terms
    //
  `,
  ],
  ['x+2*x', '3*x'],
  ['2*\\pi * x^2-\\pi * x^2+2*\\pi', '\\pi * x^2+ 2\\pi'],

  [
    `
    //
    // Common Denominator
    //
  `,
  ],
  ['3/x-1/x', '2/x'],
  ['1/(x+1)-1/x', '-1/(x(x+1))'], // 🙁 1 / (x + 1) - 1 / x

  [
    `
    //
    // Distribute
    //
  `,
  ],
  ['x*y+(x+1)*y', '2xy+y'],
  ['(x+1)^2-x^2', '2x+1'],
  ['2*(x+h)^2-2*x^2', '4xh+2h^2'], // 🙁 -2x^2 + 2(h + x)^2

  [
    `
    //
    // Multiplication
    //
  `,
  ],
  ['1*x', 'x'],
  ['-1*x', '-x'],
  ['(-2)*(-x)', '2*x'],
  ['2*(-x)', '-2*x'],

  [
    `
    //
    // Division
    //
  `,
  ],
  ['x/x', 'x/x'],
  ['\\pi/\\pi', 1], // 🙁 pi / pi
  ['(\\pi+1)/(\\pi+1)', 1], // 🙁 1 / (1 + pi) + pi / (1 + pi)
  ['1/(1/0)', NaN], // 🙁 0
  ['1/(1/\\pi)', '\\pi'],
  ['1/(1/x)', '1/(1/x)'],
  ['y/(1/2)', '2*y'],
  ['x/(1/(-\\pi))', '-\\pi * x'],
  ['x/(a/\\pi)', '\\pi * x/a'], // 🙁 (pi * x) / a
  ['x/(a/b)', 'x/(a/b)'],
  ['(x/y)/(\\pi/2)', '(2*x)/(\\pi * y)'],
  ['2/3*5/x', '10/(3*x)'],
  ['a/b*c/d', '(a*c)/(b*d)'],
  ['2/\\pi * \\pi', '2'],
  ['x/1', 'x'],
  ['(-1)/x', '-1/x'],
  ['(-2)/(-x)', '2/x'],
  ['2/(-x)', '-2/x'],

  [
    `
    //
    // Operations Involving 0
    //
  `,
  ],
  ['0*\\pi', 0],
  ['x-0', 'x'],
  ['\\sin(x)+0', '\\sin(x)'],
  ['0/0', NaN],
  ['2/0', NaN], // 🙁 1/0
  ['0^\\pi', 0], // 🙁 0^(pi)
  ['0^{-2}', NaN], // 🙁 oo
  ['0^{-\\pi}', NaN], // 🙁 0^(-pi)
  ['0^0', NaN], // 🙁 1
  ['2^0', 1],
  ['\\pi^0', 1],
  ['0/2', 0],
  ['\\sqrt{0}', 0],
  ['\\sqrt[n]{0}', 0], // 🙁 root(0)(n)
  ['e^0', 1],
  ['|0|', 0],
  ['-0', 0],

  [
    `
    //
    // Ln
    //
  `,
  ],
  ['\\ln(xy)-\\ln(x)', '\\ln(y)'], // 🙁 -ln(x) + ln(x * y)
  ['\\ln(y/x)+\\ln(x)', '\\ln(x*y/x)'], // 🙁 ln(x) + ln(y / x)
  ['e^{\\ln(x)+x}', 'x*e^x'], // 🙁 e^(x + ln(x))
  ['e^{\\ln(x)-2*x}', 'x*e^{-2*x}'], // 🙁 e^(-2x + ln(x))
  ['e^\\ln(x)', 'x'], // 🙁 e^(ln(x))
  ['e^{3\\ln(x)}', 'x^3'], // 🙁 e^(3ln(x))
  ['e^{\\ln(x)/3}', 'x^{1/3}'], // 🙁 e^(ln(x) / 3)
  ['\\ln(e^x*y)', 'x+\\ln(y)'], // 🙁 ln(y * e^x)
  ['\\ln(e^x/y)', 'x-\\ln(y)'],
  ['\\ln(y/e^x)', '\\ln(y)-x'],
  ['\\ln(0)', NaN],
  ['\\ln(1/x)', '-\\ln(x)'],
  ['\\ln(1)', 0],
  ['\\ln(e)', 1],
  ['\\ln(e^x)', 'x'],

  [
    `
    //
    // log
    //
  `,
  ],
  ['\\log_c(xy)-\\log_c(x)', '\\log_c(y)'], // 🙁 -log(x, c) + ln(x * y)
  ['\\log_c(y/x)+\\log_c(x)', '\\log_c(xy/x)'], // 🙁 log(x, c) + log(y / x, c)
  ['c^{\\log_c(x)+x}', 'x c^x'], // 🙁 c^(x + log(x, c))
  ['c^{\\log_c(x)-2*x}', 'x c^{-2*x}'], // 🙁 c^(-2x + log(x, c))
  ['c^\\log_c(x)', 'x'], // 🙁 c^(log(x, c))
  ['c^{3\\log_c(x)}', 'x^3'], // 🙁 c^(3log(x, c))
  ['c^{\\log_c(x)/3}', 'x^{1/3}'], // 🙁 c^(log(x, c) / 3)
  ['\\log_c(c^x*y)', 'x+\\log_c(y)'], // 🙁 ln(y * c^x)
  ['\\log_c(c^x/y)', 'x-\\log_c(y)'], // 🙁 log(c^x / y, c)
  ['\\log_c(y/c^x)', '\\log_c(y)-x'], // 🙁 log(y / c^x, c)
  ['\\log_c(0)', NaN],
  ['\\log_c(1)', 0],
  ['\\log_c(c)', 1], // 🙁 log(c, c)
  ['\\log_c(c^x)', 'x'], // 🙁 x * log(c, c)
  ['\\log_2(1/x)', '-\\log_2(x)'],

  [
    `
    //
    // Change of Base
    //
  `,
  ],
  ['\\log_c(a)*\\ln(a)', '\\ln(c)'], // 🙁 ln(a) * log(a, c)
  ['\\log_c(a)/\\log_c(b)', '\\ln(a)/\\ln(b)'], // 🙁 log(a, c) / log(b, c)
  ['\\log_c(a)/\\ln(a)', '1/\\ln(c)'], // 🙁 log(a, c) / ln(a)
  ['\\ln(a)/\\log_c(a)', '\\ln(c)'], // 🙁 ln(a) / log(a, c)

  [
    `
    //
    // Absolute Value
    //
  `,
  ],
  ['|\\pi|', '\\pi'],
  ['|-x|', '|x|'], // 🙁 |-x|
  ['|-\\pi|', '|\\pi|'], // 🙁 |-pi|
  ['|\\pi * x|', '\\pi * x'], // 🙁 |pi * x|
  ['|\\frac{x}{\\pi}|', '\\frac{|x|}{\\pi}'], // 🙁 |x / pi|
  ['|\\frac{2}{x}|', '\\frac{2}{|x|}'], // 🙁 |2 / x|
  ['|\\infty|', '\\infty'],
  ['|-\\infty|', '\\infty'],
  ['|x|^4', 'x^4'], // 🙁 |x|^4
  ['|x^3|', '|x|^3'], // 🙁 |x^3|
  ['|x|^{4/3}', 'x^{4/3}'], // 🙁 |x|^(4/3)
  ['|x^{3/5}|', '|x|^{3/5}'], // 🙁 |x^(3/5)|

  [
    `
    //
    // Even Functions and Absolute Value
    //
  `,
  ],
  ['\\cos(|x+2|)', '\\cos(x+2)'], // 🙁 cos(|x + 2|)
  ['\\sec(|x+2|)', '\\sec(x+2)'], // 🙁 sec(|x + 2|)
  ['\\cosh(|x+2|)', '\\cosh(x+2)'], // 🙁 cosh(|x + 2|)
  ['\\sech(|x+2|)', '\\sech(x+2)'], // 🙁 sech(|x + 2|)

  [
    `
    //
    // Odd Functions and Absolute Value
    //
  `,
  ],
  ['|\\sin(x)|', '\\sin(|x|)'], // 🙁 |sin(x)|
  ['|\\tan(x)|', '\\tan(|x|)'], // 🙁 |tan(x)|
  ['|\\cot(x)|', '\\cot(|x|)'], // 🙁 |Cot(x)|
  ['|\\csc(x)|', '\\csc(|x|)'], // 🙁 |csc(x)|
  ['|\\arcsin(x)|', '\\arcsin(|x|)'], // 🙁 |arcsin(x)|
  ['|\\arctan(x)|', '\\arctan(|x|)'], // 🙁 |arctan(x)|
  ['|\\arccot(x)|', '\\arccot(|x|)'], // 🙁 Error(ErrorCode(unexpected-token, |))
  ['|\\arccsc(x)|', '\\arccsc(|x|)'], // 🙁 |Arccsc(x)|
  ['|\\sinh(x)|', '\\sinh(|x|)'], // 🙁 |sinh(x)|
  ['|\\tanh(x)|', '\\tanh(|x|)'], // 🙁 |tanh(x)|
  ['|\\coth(x)|', '\\coth(|x|)'], // 🙁 |coth(x)|
  ['|\\csch(x)|', '\\csch(|x|)'], // 🙁 |csch(x)|
  ['|\\arcsinh(x)|', '\\arcsinh(|x|)'], // 🙁 Error(ErrorCode(unexpected-token, |))
  ['|\\arctanh(x)|', '\\arctanh(|x|)'], // 🙁 Error(ErrorCode(unexpected-token, |))
  ['|\\arccoth(x)|', '\\arccoth(|x|)'], // 🙁 Error(ErrorCode(unexpected-token, |))
  ['|\\arccsch(x)|', '\\arccsch(|x|)'], // 🙁 Error(ErrorCode(unexpected-token, |))

  [
    `
    //
    // Logs and Infinity
  `,
  ],
  ['\\ln(\\infty)', '\\infty'],
  ['\\log_4(\\infty)', '\\infty'],
  ['\\log_{0.5}(\\infty)', '-\\infty'],

  [
    `
    //
    // Powers and Infinity
    //
  `,
  ],
  ['2^\\infty', '\\infty'],
  ['0.5^\\infty', 0],
  ['\\pi^\\infty', '\\infty'], // 🙁 pi^(oo)
  ['e^\\infty', '\\infty'],
  ['\\pi^{-\\infty}', 0], // 🙁 pi^(-oo)
  ['e^{-\\infty}', 0],
  ['2^{-\\infty}', 0],
  ['(1/2)^{-\\infty}', '\\infty'],
  ['(-\\infty)^4', '\\infty'],
  ['(\\infty)^{1.4}', '\\infty'],
  ['(-\\infty)^{1/3}', '-\\infty'], // 🙁 oo
  ['(-\\infty)^{-1}', 0],
  ['(\\infty)^{-2}', 0],
  ['1^{-\\infty}', NaN],
  ['1^{\\infty}', NaN],
  ['\\infty^0', NaN], // 🙁 1
  ['\\sqrt[4]{\\infty}', '\\infty'], // 🙁 root(oo)(4)

  [
    `
    //
    // Multiplication and Infinity
    //
  `,
  ],
  ['0*\\infty', NaN], // 🙁 0
  ['0*(-\\infty)', NaN], // 🙁 0
  ['0.5*\\infty', '\\infty'],
  ['(-0.5)*(-\\infty)', '\\infty'],
  ['(-0.5)*\\infty', '-\\infty'],
  ['\\pi * (-\\infty)', '-\\infty'],

  [
    `
    //
    // Division and Infinity
    //
  `,
  ],
  ['(-\\infty)/\\infty', NaN],
  ['\\infty/0.5', '\\infty'],
  ['\\infty/(-2)', '-\\infty'],
  ['\\infty/0', NaN],
  ['(-\\infty)/1.7', '-\\infty'],
  ['(-\\infty)/(1-3)', '\\infty'],
  ['2/\\infty', 0],
  ['-100/(-\\infty)', 0],
  ['0/\\infty', 0],

  [
    `
    //
    // Addition and Subtraction and Infinity
    //
  `,
  ],
  ['\\infty-\\infty', NaN],
  ['-\\infty-\\infty', '-\\infty'],
  ['\\infty+\\infty', '\\infty'],
  ['\\infty+10', '\\infty'],
  ['\\infty-10', '\\infty'],
  ['-\\infty+10', '-\\infty'],
  ['-\\infty-10', '-\\infty'],
  ['-10-\\infty', '-\\infty'],

  [
    `
    //
    // Trig and Infinity
    //
  `,
  ],
  ['\\sin(\\infty)', NaN], // 🙁 sin(oo)
  ['\\cos(\\infty)', NaN], // 🙁 cos(oo)
  ['\\tan(\\infty)', NaN], // 🙁 tan(oo)
  ['\\cot(\\infty)', NaN], // 🙁 Cot(oo)
  ['\\sec(\\infty)', NaN], // 🙁 sec(oo)
  ['\\csc(\\infty)', NaN], // 🙁 csc(oo)
  ['\\sin(-\\infty)', NaN], // 🙁 sin(-oo)
  ['\\cos(-\\infty)', NaN], // 🙁 cos(-oo)
  ['\\tan(-\\infty)', NaN], // 🙁 tan(-oo)
  ['\\cot(-\\infty)', NaN], // 🙁 Cot(-oo)
  ['\\sec(-\\infty)', NaN], // 🙁 sec(-oo)
  ['\\csc(-\\infty)', NaN], // 🙁 csc(-oo)

  [
    `
    //
    // Inverse Trig and Infinity
    //
  `,
  ],
  ['\\arcsin(\\infty)', NaN], // 🙁 arcsin(oo)
  ['\\arccos(\\infty)', NaN], // 🙁 arccos(oo)
  ['\\arcsin(-\\infty)', NaN], // 🙁 arcsin(-oo)
  ['\\arccos(-\\infty)', NaN], // 🙁 arccos(-oo)
  ['\\arctan(\\infty)', '\\frac{\\pi}{2}'], // 🙁 arctan(oo)
  ['\\arctan(-\\infty)', '-\\frac{\\pi}{2}'], // 🙁 arctan(-oo)
  ['\\arccot(\\infty)', 0], // 🙁 Error(ErrorCode(unexpected-command, \arccot), LatexString(\arccot))
  ['\\arccot(-\\infty)', '\\pi'], // 🙁 Error(ErrorCode(unexpected-command, \arccot), LatexString(\arccot))
  ['\\arcsec(\\infty)', '\\frac{\\pi}{2}'], // 🙁 Error(ErrorCode(unexpected-command, \arcsec), LatexString(\arcsec))
  ['\\arcsec(-\\infty)', '\\frac{\\pi}{2}'], // 🙁 Error(ErrorCode(unexpected-command, \arcsec), LatexString(\arcsec))
  ['\\arccsc(\\infty)', 0], // 🙁 Arccsc(oo)
  ['\\arccsc(-\\infty)', 0], // 🙁 Arccsc(-oo)

  [
    `
    //
    // Hyperbolic Trig and Infinity
    //
  `,
  ],
  ['\\sinh(\\infty)', '\\infty'], // 🙁 sinh(oo)
  ['\\sinh(-\\infty)', '-\\infty'], // 🙁 sinh(-oo)
  ['\\cosh(\\infty)', '\\infty'], // 🙁 cosh(oo)
  ['\\cosh(-\\infty)', '\\infty'], // 🙁 cosh(-oo)
  ['\\tanh(\\infty)', 1], // 🙁 tanh(oo)
  ['\\tanh(-\\infty)', -1], // 🙁 tanh(-oo)
  ['\\coth(\\infty)', 1], // 🙁 coth(oo)
  ['\\coth(-\\infty)', -1], // 🙁 coth(-oo)
  ['\\sech(\\infty)', 0], // 🙁 sech(oo)
  ['\\sech(-\\infty)', 0], // 🙁 sech(-oo)
  ['\\csch(\\infty)', 0], // 🙁 csch(oo)
  ['\\csch(-\\infty)', 0], // 🙁 csch(-oo)

  [
    `
    //
    // Inverse Hyperbolic Trig and Infinity
    //
  `,
  ],
  ['\\arcsinh(\\infty)', '\\infty'], // 🙁 Error(ErrorCode(unexpected-command, \arcsinh), LatexString(\arcsinh))
  ['\\arcsinh(-\\infty)', '-\\infty'], // 🙁 Error(ErrorCode(unexpected-command, \arcsinh), LatexString(\arcsinh))
  ['\\arccosh(\\infty)', '\\infty'], // 🙁 Error(ErrorCode(unexpected-command, \arccosh), LatexString(\arccosh))
  ['\\arccosh(-\\infty)', NaN], // 🙁 Error(ErrorCode(unexpected-command, \arccosh), LatexString(\arccosh))
  ['\\arctanh(\\infty)', NaN], // 🙁 Error(ErrorCode(unexpected-command, \arctanh), LatexString(\arctanh))
  ['\\arctanh(-\\infty)', NaN], // 🙁 Error(ErrorCode(unexpected-command, \arctanh), LatexString(\arctanh))
  ['\\arccoth(\\infty)', NaN], // 🙁 Error(ErrorCode(unexpected-command, \arccoth), LatexString(\arccoth))
  ['\\arccoth(-\\infty)', NaN], // 🙁 Error(ErrorCode(unexpected-command, \arccoth), LatexString(\arccoth))
  ['\\arcsech(\\infty)', NaN], // 🙁 Error(ErrorCode(unexpected-command, \arcsech), LatexString(\arcsech))
  ['\\arcsech(-\\infty)', NaN], // 🙁 Error(ErrorCode(unexpected-command, \arcsech), LatexString(\arcsech))
  ['\\arccsch(\\infty)', NaN], // 🙁 Error(ErrorCode(unexpected-command, \arccsch), LatexString(\arccsch))
  ['\\arccsch(-\\infty)', NaN], // 🙁 Error(ErrorCode(unexpected-command, \arccsch), LatexString(\arccsch))

  [
    `
    //
    // Negative Exponents and Denominator
    //
  `,
  ],
  ['\\frac{2}{\\pi^{-2}}', '2\\pi^2'], // 🙁 2 / pi^(-2)
  ['\\frac{2}{x\\pi^{-2}}', '\\frac{2}{x} \\pi^2'], // 🙁 2 / (x * pi^(-2))
  ['(3/\\pi)^{-1}', '\\pi/3'],
  ['(3/x)^{-1}', '(3/x)^{-1}'], // 🙁 x / 3
  ['(x/\\pi)^{-3}', '\\pi^3 / x^3'], // 🙁 (x / pi)^(-3)
  ['(x/y)^{-3}', '(x/y)^{-3}'],
  ['(x^2/\\pi^3)^{-2}', '\\pi^6/x^4'],

  [
    `
    //
    // Power of Fraction in Denominator
    //
  `,
  ],
  ['x/(y/2)^3', '(8*x)/y^3'],
  ['x/(2/y)^3', 'x/(2/y)^3'],

  [
    `
    //
    // Powers: Division Involving x
    //
  `,
  ],
  ['x/x^3', '1/x^2'], // 🙁 x / x^3
  ['(2*x)/x^5', '2/x^4'],
  ['x/x^{-2}', 'x/x^{-2}'],
  ['x^2/x', 'x^2/x'], // 🙁 x
  ['x^{0.3}/x', '1/x^{0.7}'], // 🙁 x^(0.3) / x
  ['x^{-3/5}/x', '1/x^{8/5}'], // 🙁 1 / x^(8/5)
  ['\\pi^2/\\pi', '\\pi'],
  ['\\pi/\\pi^{-2}', '\\pi^3'], // 🙁 pi / pi^(-2)
  ['\\sqrt[3]{x}/x', '1/x^{2/3}'], // 🙁 1 / x^(2/3)

  [
    `
    //
    // Powers: Multiplication Involving x
    //
  `,
  ],
  ['x^3*x', 'x^4'],
  ['x^{-2}*x', '1/x'],
  ['x^{-1/3}*x', 'x^{-1/3}*x'], // 🙁 x^(2/3)
  ['\\pi^{-2}*\\pi', '1/\\pi'],
  ['\\pi^{-0.2}*\\pi', '\\pi^{0.8}'], // 🙁 pi * pi^(-0.2)
  ['\\sqrt[3]{x}*x', 'x^{4/3}'],

  [
    `
    //
    // Powers: Multiplication of Two Powers
    //
  `,
  ],
  ['x^2*x^{-3}', '1/x'],
  ['x^2*x^{-1}', 'x^2 x^{-1}'], // 🙁 x
  ['x^2*x^3', 'x^5'],
  ['x^{-2}*x^{-1}', '1/x^3'],
  ['x^{2/3}*x^2', 'x^{8/3}'],
  ['x^{5/2}*x^3', 'x^{11/2}'],
  ['\\pi^{-1}*\\pi^2', '\\pi'],
  ['\\sqrt{x}*\\sqrt{x}', '(\\sqrt{x})^2'], // 🙁 x
  ['\\sqrt{x}*x^2', 'x^{5/2}'],

  [
    `
    //
    // Powers: Division of Two Powers
    //
    `,
  ],
  ['x^2/x^3', '1/x'],
  ['x^{-1}/x^3', '1/x^4'], // 🙁 1 / x^4
  ['x/x^{-1}', 'x/x^{-1}'], // 🙁 x * x
  ['\\pi / \\pi^{-1}', '\\pi^2'], // 🙁 pi * pi
  ['\\pi^{0.2}/\\pi^{0.1}', '\\pi^{0.1}'], // 🙁 pi^(0.2) * pi^(-0.1)
  ['x^{\\sqrt{2}}/x^3', 'x^{\\sqrt{2}-3}'], // 🙁 x^(sqrt(2)) / x^3

  [
    `
    //
    // Powers and Denominators
    //
  `,
  ],
  ['x/(\\pi/2)^3', '8x/\\pi^3'], // 🙁 (8x) / pi^3
  ['x/(\\pi/y)^3', 'x/(\\pi/y)^3'],

  [
    `
    //
    // Double Powers
    //
  `,
  ],
  ['(x^1)^3', 'x^3'],
  ['(x^2)^{-2}', 'x^{-4}'],
  ['(x^{-2})^2', 'x^{-4}'],
  ['(x^{-2})^{-2}', '(x^{-2})^{-2}'], // 🙁 x^4
  ['(x^{1/3})^8', 'x^{8/3}'],
  ['(x^3)^{2/5}', 'x^{6/5}'],
  ['(x^{\\sqrt{2}})^3', 'x^{3\\sqrt{2}}'],

  [
    `
    //
    // Powers and Roots
    //
  `,
  ],
  ['\\sqrt{x^4}', 'x^2'], // 🙁 sqrt(x^4)
  ['\\sqrt{x^3}', 'x^{3/2}'], // 🙁 sqrt(x^3)
  ['\\sqrt[3]{x^2}', 'x^{2/3}'], // 🙁 root(x^2)(3)
  ['\\sqrt[4]{x^6}', 'x^{3/2}'], // 🙁 root(x^6)(4)
  ['\\sqrt{x^6}', '|x|^3'], // 🙁 sqrt(x^6)
  ['\\sqrt[4]{x^4}', '|x|'], // 🙁 root(x^4)(4)

  [
    `
    //
    // Ln and Powers
    //
  `,
  ],
  ['\\ln(x^3)', '3\\ln(x)'],
  ['\\ln(x^\\sqrt{2})', '\\sqrt{2} \\ln(x)'],
  ['\\ln(x^2)', '2 \\ln(|x|)'], // 🙁 2ln(x)
  ['\\ln(x^{2/3})', '2/3 \\ln(|x|)'], // 🙁 2/3 * ln(x)
  ['\\ln(\\pi^{2/3})', '2/3 \\ln(\\pi)'], // 🙁 2/3 * ln(pi)
  ['\\ln(x^{7/4})', '7/4 \\ln(x)'], // 🙁 7/4 * ln(x)
  ['\\ln(\\sqrt{x})', '\\ln(x)/2'],

  [
    `
    //
    // Log and Powers
    //
  `,
  ],
  ['\\log_4(x^3)', '3\\log_4(x)'],
  ['\\log_3(x^\\sqrt{2})', '\\sqrt{2} \\log_3(x)'],
  ['\\log_4(x^2)', '2\\log_4(|x|)'], // 🙁 2log(x, 4)
  ['\\log_4(x^{2/3})', '2/3 \\log_4(|x|)'], // 🙁 2/3 * log(x, 4)
  ['\\log_4(x^{7/4})', '7/4 \\log_4(x)'], // 🙁 7/4 * log(x, 4)
];

describe('SIMPLIFY', () => {
  console.info('Canonicalization test cases\n\n');
  for (const test of CANONICALIZATION_TEST_CASES) runTestCase(test);

  console.info('\n\nRule test cases\n\n');
  for (const test of RULE_TEST_CASES) runTestCase(test);
});

describe('SIMPLIFY', () => {
  test(`simplify(1 + 1e999) (expect precision loss)`, () =>
    expect(simplify('1 + 1e999')).toMatchInlineSnapshot(`
      {
        num: "1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
      }
    `));

  test(`\\frac34 + \\frac12`, () =>
    expect(simplify('\\frac34 + \\frac12')).toMatchInlineSnapshot(
      `["Rational", 5, 4]`
    ));

  test(`\\frac34 + 1e99`, () =>
    expect(simplify('\\frac34 + 1e99')).toMatchInlineSnapshot(`
      [
        "Rational",
        {
          num: "4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003"
        },
        4
      ]
    `));

  test(`1e149 + 1e150`, () =>
    expect(simplify('1e149 + 1e150')).toMatchInlineSnapshot(
      `{num: "11e+149"}`
    ));
});

describe('RELATIONAL OPERATORS', () => {
  // Simplify common coefficient
  test(`2a < 4b`, () =>
    expect(simplify('2a \\lt 4b')).toMatchInlineSnapshot(
      `["Less", "a", ["Multiply", 2, "b"]]`
    ));

  // Simplify coefficient with a common factor
  test(`2x^2 < 4x^3`, () =>
    expect(simplify('2x^2 \\lt 4x^3')).toMatchInlineSnapshot(
      `["Less", ["Add", ["Multiply", -2, ["Square", "x"]], "x"], 0]`
    ));

  test(`2a < 4ab`, () =>
    expect(simplify('2a < 4ab')).toMatchInlineSnapshot(
      `["Less", 1, ["Multiply", 2, "b"]]`
    ));
});

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\');
}

function runTestCase(test: TestCase): void {
  if (test.length === 1) {
    // It's a heading
    // It's a heading
    console.info(`\n[\`${test[0]}\`],`);
    return;
  }

  const [input, expected, comment] = test;

  const row = escape(
    `[${typeof input === 'string' ? '"' + input + '"' : exprToString(input)}, ${
      typeof expected === 'string'
        ? '"' + expected + '"'
        : exprToString(expected)
    }${comment ? ', "' + comment + '"' : ''}],`
  );

  if (comment?.startsWith('skip')) {
    console.info(row);
    return;
  }

  const a = typeof input === 'string' ? ce.parse(input) : ce.box(input);
  const b =
    typeof expected === 'string' ? ce.parse(expected) : ce.box(expected);

  let result: string;
  if (a.simplify().isSame(b)) result = '';
  else {
    if (comment?.startsWith('stop')) {
      const a1 = a.simplify();
      const b1 = b;
      const eq = a1.isSame(b1);
      debugger;
    }
    result = `🙁 ${a.simplify().toString()}`;
  }

  console.info(result ? `${row} // ${result}` : row);
  // test(row, () => expect(a.simplify().json).toEqual(b.json));
}
