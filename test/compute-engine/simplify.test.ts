import {
  BoxedExpression,
  BoxedRule,
  BoxedRuleSet,
  ComputeEngine,
  Rule,
} from '../../src/compute-engine';
import { Fu } from '../../src/compute-engine/boxed-expression/trigonometry.ts';
import { Expression } from '../../src/math-json/types.ts';
import { simplify, exprToString } from '../utils';

export const ce = new ComputeEngine();

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

/**
 * A set of test cases for the simplification of expressions.
 *
 * If an entry is followed by a comment:
 * - if the comment starts with "🙁", it means the result of the simplification was not the expected result.
 * - if the comment starts with "👍", it means the result of the simplification was the expected result and the rule that applied is indicated.
 * - If there is no comment, the result was as expected, but only the built-in simplifications were applied.
 *
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
  ['3/4', '3/4', 'Rationals are not converted to float'],
  ['6/8', '3/4', 'Rationals are reduced'],
  ['3/4 + 2', '11/4', 'Rational are reduced, but preserved as exact values'],
  ['3/4 + 5/7', '41/28', 'Rational are reduced, but preserved as exact values'],
  ['\\sqrt3', '\\sqrt3', 'Square root of integers are not converted to float'],
  [
    '\\sqrt{3.1}',
    { num: '1.76068168616590091458' },
    'Square root of float are computed',
  ],
  ['x+0', 'x', 'Zero is removed from addition'],
  ['-1234 - 5678', -6912],
  ['1.234 + 5678', 5679.234],
  ['1.234 + 5.678', 6.912],
  ['1.234 + 5.678 + 1.0001', 7.9121],
  ['2 + 4', 6],
  ['1/2 + 0.5', 1, 'Floating point and exact are simplified'],
  ['\\sqrt3 + 3', '\\sqrt3 + 3', 'stay exact'],
  ['\\sqrt3 + 1/2', '\\sqrt3 + 1/2', 'stay exact'],
  ['\\sqrt3 + 0.3', { num: '2.0320508075688772' }],
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
              // Combine Like terms
              //
            `,
  ],
  ['x+2*x', '3*x'],
  ['2*\\pi * x^2-\\pi * x^2+2*\\pi', '\\pi * x^2+ 2\\pi'],

  [
    `
              //
              // Power of Fraction in Denominator
              //
            `,
  ],
  [
    `
              //
              // Others
              //
            `,
  ],
  ['2\\left(13.1+x\\right)-\\left(26.2+2x\\right)', 0],
  ['\\sqrt{3}(\\sqrt2x + x)', '(\\sqrt3+\\sqrt6)x'],
  [['Add', 1, 2, 1.0001], 4.0001],
  ['2a < 4b', 'a < 2b'],
  ['2\\pi < 4\\pi', '1 < 2'],
  ['(2\\pi + 2 \\pi e) < 4\\pi', '1 + e < 2'],
];

const RULE_TEST_CASES: TestCase[] = [
  ['x/(y/2)^3', '(8*x)/y^3'],
  ['x/(2/y)^3', '1/8*x*y^3'],

  [
    `
               //
               // Double Powers
               //
             `,
  ],
  ['(x^1)^3', 'x^3'],
  ['(x^2)^{-2}', 'x^{-4}'],
  ['(x^{-2})^2', 'x^{-4}'], // 🙁 x^(-2)^2
  ['(x^2)^3', 'x^6'],
  ['(x^{-2})^{-1}', 'x^2'],
  ['(\\pi^{3/2})^2', '\\pi^3'],
  ['(x^4)^{-2}', 'x^{-8}'],
  [
    '(x^{-2})^{-2}',
    'x^4',
    'Not defined at x=0, but we assume variables represent values in the general domain where the operation is valid ',
  ],
  ['(x^3)^{2/5}', 'x^{6/5}'],
  ['(x^{\\sqrt{2}})^3', 'x^{3\\sqrt{2}}'], // 🙁 x^(sqrt(2))^3
  [
    `
               //
               // Other simplifications
               //
             `,
  ],
  ['e e^x e^{-x}', 'e'], // 🙁 e * e^x * e^(-x)
  ['e^x e^{-x}', 1], // 👍 x^nx^m->x^{n+m}
  ['\\sqrt[4]{16b^{4}}', '2|b|'], // 🙁 root(4)(16b^4)

  [
    `
               //
               // Negative Signs and Powers and Roots
               //
             `,
  ],
  ['(-x)^3', '-(x^3)'], // 🙁 (-x)^3
  ['(-x)^{4/3}', 'x^{4/3}'], // 🙁 (-x)^(4/3)
  ['(-x)^4', 'x^4'],
  ['(-x)^{3/5}', '-(x^{3/5})'], // 🙁 (-x)^(3/5)
  ['(-x)^{3/4}', 'x^{3/4}'], // 🙁 (-x)^(3/4)
  ['\\sqrt[3]{-2}', '-\\sqrt[3]{2}'], // 🙁 root(3)(-2)
  [
    `
               //
               // Negative Exponents and Denominator
               //
             `,
  ],
  ['\\frac{2}{\\pi^{-2}}', '2\\pi^2'],
  ['\\frac{2}{x\\pi^{-2}}', '\\frac{2\\pi^2}{x}'],
  ['(3/\\pi)^{-1}', '\\pi/3'], // 🙁 (3 / pi)^(-1)
  ['(3/x)^{-1}', '(3/x)^{-1}'],
  ['(x/\\pi)^{-3}', '\\pi^3 / x^3'], // 🙁 (x / pi)^(-3)
  ['(\\pi/e)^{-1}', 'e/\\pi'], // 🙁 (pi / e)^(-1)
  ['(x^2/\\pi^3)^{-2}', '\\pi^6/x^4'], // 🙁 (x^2 / pi^3)^(-2)
  [
    `
               //
               // Powers: Multiplication
               //
             `,
  ],
  ['x*x', 'x^2'],
  ['x^2*x^{-3}', '1/x'],
  ['x^2*x^{-1}', 'x'],
  ['x^2*x^3', 'x^5'],
  ['x^{-2}*x^{-1}', '1/x^3'],
  ['x^{2/3}*x^2', 'x^{8/3}'],
  ['x^{5/2}*x^3', 'x^{11/2}'],
  ['\\pi^{-1}*\\pi^2', '\\pi'],
  ['\\sqrt{x}*\\sqrt{x}', 'x'],
  ['\\sqrt{x}*x^2', 'x^{5/2}'],
  ['x^3*x', 'x^4'],
  ['x^{-2}*x', '1/x'],
  ['x^{-1/3}*x', 'x^{2/3}'],
  ['\\pi^{-0.4}*\\pi^{0.2}', '\\pi^{-0.2}'], // 👍 x^nx^m->x^{n+m}
  ['\\pi^{-0.4}/\\pi^{0.2}', '\\pi^{-0.6}'], // 👍 x^n/x^m->x^{n-m}
  ['\\pi^{-0.2}*\\pi', '\\pi^{0.8}'], // 👍 x^nx->x^{n+1}
  ['\\pi^{-0.2}/\\pi', '\\pi^{-1.2}'], // 👍 x^n/x->x^{n-1}
  ['\\pi/\\pi^{-0.2}', '\\pi^{1.2}'], // 👍 x/x^n->x^{1-n}
  ['\\sqrt[3]{x}*x', 'x^{4/3}'],
  [
    `
               //
               // Powers and Denominators
               //
             `,
  ],
  ['x/(\\pi/2)^3', '(8x)/\\pi^3'],
  ['x/(\\pi/y)^3', 'x*y^3/\\pi^3'], // 🙁 x / (pi / y)^3
  [
    `
               //
               // Powers: Division
               //
               `,
  ],
  ['x^2/x^3', '1/x'],
  ['x^{-1}/x^3', '1/x^4'],
  ['x/x^{-1}', 'x^2'],
  ['\\pi / \\pi^{-1}', '\\pi^2'],
  ['\\pi^{0.2}/\\pi^{0.1}', '\\pi^{0.1}'], // 👍 x^n/x^m->x^{n-m}
  ['x^{\\sqrt{2}}/x^3', 'x^{\\sqrt{2}-3}'], // 👍 x^n/x^m->x^{n-m}
  ['x/x^3', '1/x^2'],
  ['(2*x)/x^5', '2/x^4'],
  ['x/x^3', '1/x^2'],
  ['x^5/x^7', '1/x^2'],
  ['x/x^{-2}', 'x^3'],
  ['x^2/x', 'x'],
  ['x^{0.3}/x', '1/x^{0.7}'], // 👍 x^n/x->x^{n-1}
  ['x^{-3/5}/x', '1/x^{8/5}'],
  ['\\pi^2/\\pi', '\\pi'],
  ['\\pi/\\pi^{-2}', '\\pi^3'],
  ['\\sqrt[3]{x}/x', '1/x^{2/3}'],
  [
    `
               //
               // Powers and Roots
               //
             `,
  ],
  ['\\sqrt{x^4}', 'x^2'], // 🙁 sqrt(x^4)
  ['\\sqrt[4]{x^6}', '\\sqrt[2]{x^3}'], // 🙁 root(4)(x^6)
  ['\\sqrt{x^6}', '|x|^3'], // 🙁 sqrt(x^6)
  ['\\sqrt[4]{x^4}', '|x|'], // 🙁 x
  [
    `  
    //Common Denominators
    `,
  ],
  ['1/x-1/(x+1)', '1 / (x^2 + x)'], // 👍 a/b+c/d -> (a*d+b*c)/(b*d); () => true
  [
    `
               //
               // Common Denominator
               //
             `,
  ],
  ['3/x-1/x', '2/x'],
  ['1/(x+1)-1/x', '-1 / (x^2 + x)'], // 👍 a/b+c/d -> (a*d+b*c)/(b*d); () => true

  [
    `
               //
               // Distribute
               //
             `,
  ],
  ['x*y+(x+1)*y', '2xy+y'],
  ['(x+1)^2-x^2', '2x+1'], // 🙁 -x^2 + (x + 1)^2
  ['2*(x+h)^2-2*x^2', '4xh+2h^2'], // 🙁 -2x^2 + 2(h + x)^2

  [
    `
               //
               // Division
               //
             `,
  ],
  ['(\\pi+1)/(\\pi+1)', '1'],
  ['x/x', 'x/x'],
  ['\\pi/\\pi', 1],
  ['(\\pi+1)/(\\pi+1)', 1],
  ['1/(1/0)', NaN],
  ['1/(1/\\pi)', '\\pi'],
  ['1/(1/x)', '1/(1/x)'],
  ['y/(1/2)', '2*y'],
  ['x/(1/(-\\pi))', '-\\pi * x'],
  ['x/(a/\\pi)', '(\\pi * x)/a'],
  ['x/(a/b)', '(b*x)/a'],
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
  ['2/0', NaN],
  ['0^\\pi', 0],
  ['0^{-2}', '\\tilde\\infty'],
  ['0^{-\\pi}', '\\tilde\\infty'],
  ['0^0', NaN],
  ['2^0', 1],
  ['\\pi^0', 1],
  ['0/2', 0],
  ['\\sqrt{0}', 0],
  ['\\sqrt[4]{0}', 0],
  ['\\sqrt[\\pi]{0}', 0], // 👍 \sqrt[n:>0]{0}->0
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
  ['\\frac{\\ln(9)}{\\ln(3)}', 2],
  ['\\ln(e^x/y)-x', '-\\ln(y)'],
  ['\\ln(y/e^x)', '\\ln(y)-x'],
  ['\\ln(0)', '-\\infty'],
  ['\\ln(1/x)', '-\\ln(x)'],
  ['\\ln(1)', 0],
  ['\\ln(e)', 1],
  ['\\ln(e^x)', 'x'],
  ['\\ln(3)+\\ln(\\frac{1}{3})', 0], // 👍 \ln(x) + \ln(y) -> \ln(xy)
  ['\\ln(xy)-\\ln(x)', '\\ln(y)'], // 👍 \ln(x) - \ln(y) -> \ln(x/y)
  ['\\ln(y/x)+\\ln(x)', '\\ln(y)'], // 👍 \ln(x) + \ln(y) -> \ln(xy)
  ['e^{\\ln(x)+x}', 'x*e^x'], // 👍 e^{\ln(x)+y} -> x*e^y
  ['e^{\\ln(x)-2x}', 'x*e^{-2x}'], // 👍 e^{\ln(x)+y} -> x*e^y
  ['\\ln(e^x/y)+\\ln(y)', 'x'],
  ['e^{\\ln(x)-y^2}', 'x/e^{y^2}'], // 👍 e^{\ln(x)-y} -> x/e^y
  ['e^{\\ln(x)-2*x}', 'x*e^{-2*x}'], // 👍 e^{\ln(x)+y} -> x*e^y
  ['e^\\ln(x)', 'x'], // 👍 e^\ln(x) -> x
  ['e^{3\\ln(x)}', 'x^3'], // 👍 e^{\ln(x)*y} -> x^y
  ['e^{\\ln(x)/3}', 'x^{1/3}'], // 👍 e^{\ln(x)*y} -> x^y
  ['\\ln(e^x*y)', 'x+\\ln(y)'], // 👍 \ln(e^x*y) -> x+\ln(y)
  ['\\ln(x^3)-3\\ln(x)', '0'], // 🙁 -3ln(x) + ln(x^3)
  ['\\ln(x^\\sqrt{2})', '\\sqrt{2} \\ln(x)'], // 🙁 ln(x^(sqrt(2)))
  ['\\ln(x^{2/3})-4/3\\ln(x)', '2/3 \\ln(x)'], // 🙁 -4 / (3ln(x)) + ln(x^(2/3))
  ['\\ln(\\pi^{2/3})-1/3\\ln(\\pi)', '1/3 \\ln(\\pi)'], // 🙁 -1 / (3ln(pi)) + ln(pi^(2/3))
  ['\\ln(\\sqrt{x})-\\ln(x)/2', '\\ln(x)/2'], // 🙁 -1/2 * ln(x) + ln(sqrt(x))
  ['\\ln((x+1)/e^{2x})', '\\ln(x+1)-2x'], // 👍 \ln(y/e^x) -> \ln(y)-x
  [
    `
               //
               // log
               //
             `,
  ],
  ['\\log_c(xy)-\\log_c(x)', '\\log_c(y)'], // 👍 \log_c(x) - \log_c(y) -> \log_c(x/y)
  ['\\log_c(y/x)+\\log_c(x)', '\\log(y, c)'], // 👍 \log_c(x) + \log_c(y) -> \log_c(xy)
  ['c^{\\log_c(x)+x}', 'x c^x'], // 👍 c^{\log_c(x)+y} -> x*c^y
  ['c^{\\log_c(x)-2*x}', 'x c^{-2*x}'], // 👍 c^{\log_c(x)+y} -> x*c^y
  ['c^\\log_c(x)', 'x'], // 👍 c^{\log_c(x)} -> x
  ['c^{3\\log_c(x)}', 'x^3'], // 👍 c^{\log_c(x)*y} -> x^y
  ['c^{\\log_c(x)/3}', 'x^{1/3}'], // 👍 c^{\log_c(x)*y} -> x^y
  ['\\log_c(c^x*y)', 'x+\\log_c(y)'], // 👍 \log_c(c^x*y) -> x+\log_c(y)
  ['\\log_c(c^x/y)', 'x-\\log_c(y)'], // 👍 \log_c(c^x/y) -> x-\log_c(y)
  ['\\log_c(y/c^x)', '\\log_c(y)-x'], // 👍 \log_c(y/c^x) -> \log_c(y)-x
  ['\\log_c(x^2)', '2\\log_c(x)'], // 🙁 log(x^2, c)
  ['\\log_c(c)', 1], // 👍 \log_c(c) -> 1
  ['\\log_c(c^x)', 'x'], // 👍 \log_c(c^x) -> x
  ['\\log_c(0)', NaN], // 👍 \log_c(0) -> \operatorname{NaN}
  ['\\log_c(1)', 0],
  ['\\log_2(1/x)', '-\\log_2(x)'],
  ['\\log_2(0)', '-\\infty'],
  ['\\log_1(3)', '\\operatorname{NaN}'], // 👍 \log_c(x) -> \operatorname{NaN}; ({ c }) => c.is(0) || c.is(1)
  ['\\log_{1/2}(0)', '\\infty'], // 🙁 -oo
  ['\\log_2(x)-\\log_2(xy)', '-\\log_2(y)'], // up to 👍\log_c(x) - \log_c(y) -> \log_c(x/y)
  ['3^{\\log_3(x)+2}', '9x'], // up to 👍c^{\log_c(x)+y} -> x*c^y
  ['\\log_{1/2}(x)', '-\\log_2(x)'], // 🙁 log(x, 1/2)
  ['\\log_4(x^3)', '3\\log_4(x)'], // 🙁 log(x^3, 4)
  ['\\log_3(x^\\sqrt{2})', '\\sqrt{2} \\log_3(x)'], // 🙁 log(x^(sqrt(2)), 3)
  ['\\log_4(x^2)', '2\\log_4(|x|)'], // 🙁 log(x^2, 4)
  ['\\log_4(x^{2/3})', '2/3 \\log_4(|x|)'], // 🙁 log(x^(2/3), 4)
  ['\\log_4(x^{7/4})', '7/4 \\log_4(x)'], // 🙁 log(x^(7/4), 4)
  [
    `
               //
               // Change of Base
               //
             `,
  ],
  ['\\log_c(a)*\\ln(a)', '\\ln(c)'], // 👍 \log_c(a)*\ln(a) -> \ln(c)
  ['\\log_c(a)/\\log_c(b)', '\\ln(a)/\\ln(b)'], // 👍 \log_c(a)/\log_c(b) -> \ln(a)/\ln(b)
  ['\\log_c(a)/\\ln(a)', '1/\\ln(c)'], // 👍 \log_c(a)/\ln(a) -> 1/\ln(c)
  ['\\ln(a)/\\log_c(a)', '\\ln(c)'], // 👍 \ln(a)/\log_c(a) -> \ln(c)
  [
    `
               //
               // Absolute Value
               //
             `,
  ],
  ['|\\pi|', '\\pi'],
  ['|-\\pi-1|', '\\pi+1'],
  ['|\\infty|', '\\infty'],
  ['|-\\infty|', '\\infty'],
  ['|-x|', '|x|'], // 👍 |-x| -> |x|
  ['|-\\pi|', '\\pi'],
  ['|\\pi * x|', '\\pi * |x|'], // 👍 |xy| -> x|y|; ({ x }) => x.isNonNegative === true
  ['|-\\pi * x|', '\\pi * |x|'], // up to 👍|xy| -> x|y|; ({ x }) => x.isNonNegative === true
  ['|\\frac{x}{\\pi}|', '\\frac{|x|}{\\pi}'], // 🙁 |x / pi|
  ['|\\frac{2}{x}|', '\\frac{2}{|x|}'], // 🙁 |2 / x|
  ['|x|^4', 'x^4'], // 👍 |x|^{n:even}->x^n
  ['|x^2|', 'x^2'], // 👍 |x^{n:even}|->x^n
  ['|x^3|', '|x|^3'], // 👍 |x^n|->|x|^n
  ['|x|^{4/3}', 'x^{4/3}'], // 🙁 |x|^(4/3)
  ['|x^{3/5}|', '|x|^{3/5}'], // 👍 |x^n|->|x|^n
  ['|xy|-|x|*|y|', '0'], // 🙁 -|x| * |y| + |x * y|
  ['|2|', '2'],
  ['||x|+1|', '|x|+1'], // 🙁 Error("unexpected-delimiter", "|")
  ['| |x| |', '|x|'], // 🙁 Error("unexpected-delimiter", "|")
  ['|-|-x||', '|x|'], // 👍 |-x| -> |x|
  ['|-1-\\pi|', '\\pi+1'],
  ['|2x|-2|x|', '0'],
  ['|2/x|-1/|x|', '1/|x|'], // 🙁 2 * |1 / x| - 1 / |x|
  ['|1/x|-1/|x|', '0'], // 🙁 -1 / |x| + |1 / x|
  ['|x||y|-|xy|', '0'], // 🙁 |x| * |y| - |x * y|
  ['|x|^{4/3}', 'x^{4/3}'], // 🙁 |x|^(4/3)
  ['|x^{3/5}|', '|x|^{3/5}'], // 👍 |x^n|->|x|^n

  [
    `
               //
               // Even Functions and Absolute Value
               //
             `,
  ],
  ['\\cos(|x+2|)', '\\cos(x+2)'], // 👍 \cos(|x|) -> \cos(x)
  ['\\sec(|x+2|)', '\\sec(x+2)'], // 👍 \sec(|x|) -> \sec(x)
  ['\\cosh(|x+2|)', '\\cosh(x+2)'], // 👍 \cosh(|x|) -> \cosh(x)
  ['\\sech(|x+2|)', '\\sech(x+2)'], // 👍 \sech(|x|) -> \sech(x)

  [
    `
               //
               // Odd Functions and Absolute Value
               //
             `,
  ],
  ['|\\sin(x)|', '\\sin(|x|)'], // 👍 |\sin(x)| -> \sin(|x|)
  ['|\\tan(x)|', '\\tan(|x|)'], // 👍 |\tan(x)| -> \tan(|x|)
  ['|\\cot(x)|', '\\cot(|x|)'], // 👍 |\cot(x)| -> \cot(|x|)
  ['|\\csc(x)|', '\\csc(|x|)'], // 👍 |\csc(x)| -> \csc(|x|)
  ['|\\arcsin(x)|', '\\arcsin(|x|)'], // 👍 |\arcsin(x)| -> \arcsin(|x|)
  ['|\\arctan(x)|', '\\arctan(|x|)'], // 👍 |\arctan(x)| -> \arctan(|x|)
  ['|\\arcctg(x)|', '\\arcctg(|x|)'], // 👍 |\arcctg(x)| -> \arcctg(|x|)
  ['|\\arccsc(x)|', '\\arccsc(|x|)'], // 👍 |\arccsc(x)| -> \arccsc(|x|)
  ['|\\sinh(x)|', '\\sinh(|x|)'], // 👍 |\sinh(x)| -> \sinh(|x|)
  ['|\\tanh(x)|', '\\tanh(|x|)'], // 👍 |\tanh(x)| -> \tanh(|x|)
  ['|\\coth(x)|', '\\coth(|x|)'], // 👍 |\coth(x)| -> \coth(|x|)
  ['|\\csch(x)|', '\\csch(|x|)'], // 👍 |\csch(x)| -> \csch(|x|)
  ['|\\arsinh(x)|', '\\arsinh(|x|)'], // 👍 |\arsinh(x)| -> \arsinh(|x|)
  ['|\\artanh(x)|', '\\artanh(|x|)'], // 👍 |\artanh(x)| -> \artanh(|x|)
  ['|\\operatorname{arccoth}(x)|', '\\operatorname{arccoth}(|x|)'], // 👍 |\operatorname{arccoth}(x)| -> \operatorname{arccoth}(|x|)
  ['|\\arcsch(x)|', '\\arcsch(|x|)'], // 👍 |\arcsch(x)| -> \arcsch(|x|)

  [
    `
               //
               // Powers and Infinity
               //
             `,
  ],
  ['(0.5)^{-\\infty}', '\\infty'],
  ['(1/2)^\\infty', '0'],
  ['\\infty^{-3}', '0'], // 👍 \infty^a -> 0; ({ a }) => a.isNegative === true
  ['(-\\infty)^{-5}', '0'], // 👍 (-\infty)^a -> 0; ({ a }) => a.isNegative === true
  ['2^{-\\infty}', '0'],
  ['2^\\infty', '\\infty'],
  ['0.5^\\infty', 0],
  ['\\pi^\\infty', '\\infty'], // 🙁 pi^(+oo)
  ['e^\\infty', '\\infty'], // 🙁 e^(+oo)
  ['\\pi^{-\\infty}', 0], // 🙁 pi^(-oo)
  ['e^{-\\infty}', 0], // 🙁 e^(-oo)
  ['(1/2)^{-\\infty}', '\\infty'],
  ['(-\\infty)^4', '\\infty'], // 🙁 (-oo)^4
  ['\\infty^4', '\\infty'], // 🙁 +oo^4
  ['(\\infty)^{1.4}', '\\infty'], // 👍 \infty^a -> \infty; ({ a }) => a.isPositive === true
  ['(-\\infty)^{1/3}', '-\\infty'], // 🙁 root(3)(-oo)
  ['\\infty^{1/3}', '\\infty'], // 🙁 root(3)(+oo)
  ['(-\\infty)^{-1}', 0],
  ['(\\infty)^{-2}', 0], // 👍 \infty^a -> 0; ({ a }) => a.isNegative === true
  ['1^{-\\infty}', NaN], // 🙁 1
  ['1^{\\infty}', NaN], // 🙁 1
  ['\\infty^0', NaN], // 🙁 1
  [
    `
               //
               // Logs and Infinity
             `,
  ],
  ['\\ln(\\infty)', '\\infty'],
  ['\\log_4(\\infty)', '\\infty'],
  ['\\log_{0.5}(\\infty)', '-\\infty'], // 👍 \log_c(\infty) -> -\infty; ({ c }) => c.isLess(1) === true && c.isPositive === true
  ['\\log_\\infty(2)', '0'],
  ['\\log_\\infty(\\infty)', 'NaN'], // 🙁 1
  ['\\ln(\\infty)', '\\infty'],
  ['\\log_2(\\infty)', '\\infty'],
  ['\\log_{1/5}(\\infty}', '-\\infty'], // 🙁 log(1/5) Error("unexpected-delimiter", "(")
  [
    `
    Roots and Infinity
    `,
  ],
  ['\\sqrt[3]{\\infty}', '\\infty'], // 🙁 root(3)(+oo)
  ['\\sqrt{\\infty}', '\\infty'],
  [
    `
               //
               // Multiplication and Infinity
               //
             `,
  ],
  ['0*\\infty', NaN], // 🙁 +oo
  ['0*(-\\infty)', NaN], // 🙁 +oo
  ['0.5*\\infty', '\\infty'],
  ['(-0.5)*(-\\infty)', '\\infty'],
  ['(-0.5)*\\infty', '-\\infty'], // 🙁 +oo
  ['\\pi * (-\\infty)', '-\\infty'],

  [
    `
               //
               // Division and Infinity
               //
             `,
  ],
  ['\\infty/2', '\\infty'], // 👍 \infty/x -> \infty; ({ x }) => x.isPositive === true && x.isFinite === true
  ['\\infty/(-2)', '-\\infty'], // 👍 \infty/x -> -\infty; ({ x }) => x.isNegative === true && x.isFinite === true
  ['(-\\infty)/2', '-\\infty'], // 👍 (-\infty)/x -> -\infty; ({ x }) => x.isPositive === true && x.isFinite === true
  ['(-\\infty)/(-2)', '\\infty'], // 👍 (-\infty)/x -> \infty; ({ x }) => x.isNegative === true && x.isFinite === true
  ['\\infty/\\infty', '\\operatorname{NaN}'], // 🙁 1
  ['(-\\infty)/\\infty', NaN],
  ['\\infty/0.5', '\\infty'], // 👍 \infty/x -> \infty; ({ x }) => x.isPositive === true && x.isFinite === true
  ['\\infty/(-2)', '-\\infty'], // 👍 \infty/x -> -\infty; ({ x }) => x.isNegative === true && x.isFinite === true
  ['\\infty/0', '\\tilde\\infty'],
  ['(-\\infty)/1.7', '-\\infty'], // 👍 (-\infty)/x -> -\infty; ({ x }) => x.isPositive === true && x.isFinite === true
  ['(-\\infty)/(1-3)', '\\infty'], // 🙁 1
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
  ['\\sin(\\infty)', NaN], // 👍 \sin(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\cos(\\infty)', NaN], // 👍 \cos(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\tan(\\infty)', NaN], // 👍 \tan(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\cot(\\infty)', NaN], // 👍 \cot(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\sec(\\infty)', NaN], // 👍 \sec(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\csc(\\infty)', NaN], // 👍 \csc(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\sin(-\\infty)', NaN], // 👍 \sin(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\cos(-\\infty)', NaN], // 👍 \cos(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\tan(-\\infty)', NaN], // 👍 \tan(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\cot(-\\infty)', NaN], // 👍 \cot(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\sec(-\\infty)', NaN], // 👍 \sec(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true
  ['\\csc(-\\infty)', NaN], // 👍 \csc(x) -> \operatorname{NaN}; ({ x }) => x.isInfinity === true

  [
    `
               //
               // Inverse Trig and Infinity
               //
             `,
  ],
  ['\\arcsin(\\infty)', NaN], // 👍 \arcsin(\infty) -> \operatorname{NaN}
  ['\\arccos(\\infty)', NaN], // 👍 \arccos(\infty) -> \operatorname{NaN}
  ['\\arcsin(-\\infty)', NaN], // 👍 \arcsin(-\infty) -> \operatorname{NaN}
  ['\\arccos(-\\infty)', NaN], // 👍 \arccos(-\infty) -> \operatorname{NaN}
  ['\\arctan(\\infty)', '\\frac{\\pi}{2}'], // 👍 \arctan(\infty) -> \frac{\pi}{2}
  ['\\arctan(-\\infty)', '-\\frac{\\pi}{2}'], // 👍 \arctan(-\infty) -> -\frac{\pi}{2}
  ['\\arcctg(\\infty)', 0], // 👍 \arcctg(\infty) -> 0
  ['\\arcctg(-\\infty)', '\\pi'], // 👍 \arcctg(-\infty) -> \pi
  ['\\arcsec(\\infty)', '\\frac{\\pi}{2}'], // 👍 \arcsec(\infty) -> \frac{\pi}{2}
  ['\\arcsec(-\\infty)', '\\frac{\\pi}{2}'], // 👍 \arcsec(-\infty) -> \frac{\pi}{2}
  ['\\arccsc(\\infty)', 0], // 👍 \arccsc(\infty) -> 0
  ['\\arccsc(-\\infty)', 0], // 👍 \arccsc(-\infty) -> 0

  [
    `
               //
               // Hyperbolic Trig and Infinity
               //
             `,
  ],
  ['\\sinh(\\infty)', '\\infty'], // 👍 \sinh(\infty) -> \infty
  ['\\sinh(-\\infty)', '-\\infty'], // 👍 \sinh(-\infty) -> -\infty
  ['\\cosh(\\infty)', '\\infty'], // 👍 \cosh(\infty) -> \infty
  ['\\cosh(-\\infty)', '\\infty'], // 👍 \cosh(-\infty) -> \infty
  ['\\tanh(\\infty)', 1], // 👍 \tanh(\infty) -> 1
  ['\\tanh(-\\infty)', -1], // 👍 \tanh(-\infty) -> -1
  ['\\coth(\\infty)', 1], // 👍 \coth(\infty) -> 1
  ['\\coth(-\\infty)', -1], // 👍 \coth(-\infty) -> -1
  ['\\sech(\\infty)', 0], // 👍 \sech(\infty) -> 0
  ['\\sech(-\\infty)', 0], // 👍 \sech(-\infty) -> 0
  ['\\csch(\\infty)', 0], // 👍 \csch(\infty) -> 0
  ['\\csch(-\\infty)', 0], // 👍 \csch(-\infty) -> 0

  [
    `
               //
               // Inverse Hyperbolic Trig and Infinity
               //
             `,
  ],
  ['\\arsinh(\\infty)', '\\infty'],
  ['\\arsinh(-\\infty)', '-\\infty'], // 👍 \arsinh(-\infty) -> -\infty
  ['\\arcosh(\\infty)', '\\infty'],
  ['\\arcosh(-\\infty)', NaN],
  ['\\artanh(\\infty)', NaN], // 👍 \artanh(x); ({ x }) => x.isInfinity === true
  ['\\artanh(-\\infty)', NaN], // 👍 \artanh(x); ({ x }) => x.isInfinity === true
  ['\\operatorname{arccoth}(\\infty)', 0], // 👍 \operatorname{arccoth}(x); ({ x }) => x.isInfinity === true
  ['\\operatorname{arccoth}(-\\infty)', 0], // 👍 \operatorname{arccoth}(x); ({ x }) => x.isInfinity === true
  ['\\arsech(\\infty)', NaN], // 👍 \arsech(x); ({ x }) => x.isInfinity === true
  ['\\arsech(-\\infty)', NaN], // 👍 \arsech(x); ({ x }) => x.isInfinity === true
  ['\\arcsch(\\infty)', NaN], // 👍 \arcsch(x); ({ x }) => x.isInfinity === true
  ['\\arcsch(-\\infty)', NaN], // 👍 \arcsch(x); ({ x }) => x.isInfinity === true
  ['\\operatorname{arccoth}(\\infty)', '0'], // 👍 \operatorname{arccoth}(x); ({ x }) => x.isInfinity === true
  ['\\operatorname{arccoth}(-\\infty)', '0'], // 👍 \operatorname{arccoth}(x); ({ x }) => x.isInfinity === true

  [
    `
               //
               // hyperbolic trig
               //
             `,
  ],
  ['|\\operatorname{arccoth}(x)|', '\\operatorname{arccoth}(|x|)'], // 👍 |\operatorname{arccoth}(x)| -> \operatorname{arccoth}(|x|)
  [
    `
               //
               // trig
               //
             `,
  ],
  ['\\sin(-x)', '-\\sin(x)'], // 👍 \sin(-x) -> -\sin(x)
  ['\\cos(-x)', '\\cos(x)'], // 👍 \cos(-x) -> \cos(x)
  ['\\tan(-x)', '-\\tan(x)'], // 👍 \tan(-x) -> -\tan(x)
  ['\\csc(-x)', '-\\csc(x)'], // 👍 \csc(-x) -> -\csc(x)
  ['\\sec(-x)', '\\sec(x)'], // 👍 \sec(-x) -> \sec(x)
  ['\\cot(-x)', '-\\cot(x)'], // 👍 \cot(-x) -> -\cot(x)
  ['\\sin(\\pi - x)', '\\sin(x)'], // 👍 \sin(\pi - x) -> \sin(x)
  ['\\cos(\\pi - x)', '-\\cos(x)'], // 👍 \cos(\pi - x) -> -\cos(x)
  ['\\tan(\\pi - x)', '-\\tan(x)'], // 👍 \tan(\pi - x) -> -\tan(x)
  ['\\cot(\\pi - x)', '-\\cot(x)'], // 👍 \cot(\pi - x) -> -\cot(x)
  ['\\sec(\\pi - x)', '-\\sec(x)'], // 👍 \sec(\pi - x) -> -\sec(x)
  ['\\csc(\\pi - x)', '\\csc(x)'], // 👍 \csc(\pi - x) -> \csc(x)
  ['\\sin(\\pi + x)', '-\\sin(x)'], // 👍 \sin(\pi + x) -> -\sin(x)
  ['\\cos(\\pi + x)', '-\\cos(x)'], // 👍 \cos(\pi + x) -> -\cos(x)
  ['\\tan(\\pi + x)', '\\tan(x)'], // 👍 \tan(\pi + x) -> \tan(x)
  ['\\cot(\\pi + x)', '-\\cot(x)'], // 👍 \cot(\pi + x) -> -\cot(x)
  ['\\sec(\\pi + x)', '-\\sec(x)'], // 👍 \sec(\pi + x) -> -\sec(x)
  ['\\csc(\\pi + x)', '\\csc(x)'], // 👍 \csc(\pi + x) -> \csc(x)
  ['\\sin(\\frac{\\pi}{2} - x)', '\\cos(x)'], // 👍 \sin(\frac{\pi}{2} - x) -> \cos(x)
  ['\\cos(\\frac{\\pi}{2} - x)', '\\sin(x)'], // 👍 \cos(\frac{\pi}{2} - x) -> \sin(x)
  ['\\tan(\\frac{\\pi}{2} - x)', '\\cot(x)'], // 👍 \tan(\frac{\pi}{2} - x) -> \cot(x)
  ['\\cot(\\frac{\\pi}{2} - x)', '\\tan(x)'], // 👍 \cot(\frac{\pi}{2} - x) -> \tan(x)
  ['\\sec(\\frac{\\pi}{2} - x)', '\\csc(x)'], // 👍 \sec(\frac{\pi}{2} - x) -> \csc(x)
  ['\\csc(\\frac{\\pi}{2} - x)', '\\sec(x)'], // 👍 \csc(\frac{\pi}{2} - x) -> \sec(x)

  [
    `
               //
               // inverse hyperbolic trig
               //
             `,
  ],
  ['\\ln(x+\\sqrt{x^2+1})', '\\arsinh(x)'], // 👍 \ln(x+\sqrt{x^2+1})->\arsinh(x)
  ['\\ln(x+\\sqrt{x^2-1})', '\\arcosh(x)'], // 👍 \ln(x+\sqrt{x^2-1})->\arcosh(x)
  ['\\frac{1}{2}\\ln(\\frac{1+x}{1-x})', '\\artanh(x)'], // 👍 \frac{1}{2}\ln(\frac{1+x}{1-x})->\artanh(x)
  ['\\frac{1}{2}\\ln(\\frac{x+1}{x-1})', '\\operatorname{arcoth}(x)'], // 🙁 "arccoth" * x
  ['\\ln(\\frac{1+\\sqrt{1-x^2}}{x})', '\\arsech(x)'], // 👍 \ln(\frac{1+\sqrt{1-x^2}}{x})->\arsech(x)
  ['\\ln(\\frac{1}{x} + \\sqrt{\\frac{1}{x^2}+1})', '\\arcsch(x)'], // 👍 \ln(\frac{1}{x} + \sqrt{\frac{1}{x^2}+1})->\arcsch(x)

  [
    `
               //
               // inverse trig
               //
             `,
  ],
  ['\\arctan(x/\\sqrt{1-x^2})', '\\arcsin(x)'], // 👍 \arctan(x/\sqrt{1-x^2})->\arcsin(x)
];

/*
 SUMMARY OF UNUSED RULES:
 
    🚫 = rule not used (no test case for this rule)
 🚫 |xy| -> -x|y|; ({ x }) => x.isNonPositive === true (hard to come with example)
 🚫 \sin(x) * \cos(x) -> \frac{1}{2} \sin(2x)
 🚫 \sin(x) * \sin(y) -> \frac{1}{2} (\cos(x-y) - \cos(x+y))
 🚫 \cos(x) * \cos(y) -> \frac{1}{2} (\cos(x-y) + \cos(x+y))
 🚫 \tan(x) * \cot(x) -> 1
 🚫 \sin(x)^2 -> \frac{1 - \cos(2x)}{2}
 🚫 \cos(x)^2 -> \frac{1 + \cos(2x)}{2}
 🚫 ["Divide",["Sin","__x"],["Cos","__x"]]
 🚫 ["Divide",["Cos","__x"],["Sin","__x"]]
 🚫 ["Divide",1,["Cos","__x"]]
 🚫 ["Divide",1,["Sin","__x"]]
 🚫 ["Ln",["Add","__x",["Sqrt",["Subtract",["Square","__x"],1]]]]; (sub, ce) => sub.__x.isGreater(ce.One) ?? false
 🚫 ["Multiply",2,["Arctan2","__x",["Add",1,["Sqrt",["Subtract",1,["Square","__x"]]]]]]
 🚫 ["Multiply",2,["Ln",["Add","__x",["Sqrt",["Add",["Square","__x"],1]]]]]
 🚫 ["Multiply","Half",["Ln",["Divide",["Add",1,"__x"],["Subtract",1,"__x"]]]]
 🚫 ["Divide",["Add",["Exp","__x"],["Exp",["Negate","__x"]]],2]
 🚫 ["Divide",["Subtract",["Exp","__x"],["Exp",["Negate","__x"]]],2]
 🚫 ["Ln",["Add","__x",["Sqrt",["Subtract",["Square","__x"],1]]]]; ({ __x }) => __x.isGreater(1) ?? false
 🚫 ["Multiply",2,["Arctan2","__x",["Add",1,["Sqrt",["Subtract",1,["Square","__x"]]]]]]
 🚫 ["Multiply",2,["Ln",["Add","__x",["Sqrt",["Add",["Square","__x"],1]]]]]
 🚫 ["Multiply","Half",["Ln",["Divide",["Add",1,"__x"],["Subtract",1,"__x"]]]]
 🚫 ["Divide",["Add",["Exp","__x"],["Exp",["Negate","__x"]]],2]
 🚫 ["Divide",["Subtract",["Exp","__x"],["Exp",["Negate","__x"]]],2]
 */

const RULES_USED: string[] = [];

const RULES: Rule[] = [
  /*@fixme
  //Negative signs
  '(-x)^{n:odd} -> -(x^n)',
  '(-x)^{n/m} -> x^{n/m}; n:even, m:odd',
  '(-x)^{n/m} -> -x^{n/m}; n:odd, m:odd',
  '(-x)^{n/m} -> -x^{n/m}; n:odd, m:even',
  '\\sqrt[n:odd]{-x}->-\\sqrt[n]{x}',


  //Logs
  '\\ln(a^b)->a\\ln(b)',
  '\\log_c(a^b)->a\\log_c(b)',
  '\\log_{1/c}(a) -> -\\log_c(a)',

  //Absolute Value
  '|x|^{\\frac{n:even}{m:odd}}->x^{n/m}',
  '|x^{\\frac{n:even}{m:odd}}|->x^{n/m}',
  '|xy| -> |x||y|',
  '|\\frac{x}{y}| -> \\frac{|x|}{|y|}',
  '|\\frac{x:>=0}{y}| -> \\frac{x}{|y|}',
  '|\\frac{x:<=0}{y}| -> -\\frac{x}{|y|}',
  '|\\frac{x}{y:>=0}| -> \\frac{|x|}{y}',
  '|\\frac{x}{y:<=0}| -> -\\frac{|x|}{y}',
  
  //Exponents
  a/(c/b)^n->a*(b/c)^n
  (a/b)^{-1}->b/a,
  (a/b)^{-n}->(b/a)^n,
  (x^n)^m->x^{nm},
  'x^0->1', //except 0^0 and infinite^0 (generates an infinite loop)
  
  //Not Being Run (gives infinity instead of NaN)
  {
    match: '0^x',
    replace: '\\operatorname{NaN}',
    condition: ({c}) => c.isNonPositive === true,
  },
  //Infinity
    {
    match: '0*x',
    replace: '\\operatorname{NaN}',
    condition: (_x) => _x._x.isInfinity === true,
  },

  { match: '0*x', replace: '0', condition: (_x) => _x._x.isFinite === true },
  { match: '1^x', replace: '1', condition: (_x) => _x._x.isFinite === true },

  {
    match: 'a^0',
    replace: '\\operatorname{NaN}',
    condition: ({a}) => a.isInfinity === true,
  },
  '\\sqrt[n:>0]{\\infty}->\\infty',
  x/y -> \operatorname{NaN}; ({ x, y }) => x.isInfinity === true && y.isInfinity === true
  {
    match: '\\infty * x',
    replace: '\\infty',
    condition: ({x}) => x.isPositive === true,
  },
  {
    match: 'x*(-\\infty)',
    replace: '-\\infty',
    condition: ({x}) => x.isPositive === true,
  },
  {
    match: '\\infty * x',
    replace: '-\\infty',
    condition: ({x}) => x.isNegative === true,
  },
  {
    match: 'x*(-\\infty)',
    replace: '\\infty',
    condition: ({x}) => x.isNegative === true,
  },

  \frac{1}{2}\ln(\frac{x+1}{x-1})->\operatorname{arccoth}(x)

  */
  '\\sqrt[n:>0]{0}->0',

  '\\ln(x) + \\ln(y) -> \\ln(xy)',
  '\\ln(x) - \\ln(y) -> \\ln(x/y)',
  'e^{\\ln(x)+y} -> x*e^y',
  'e^{\\ln(x)-y} -> x/e^y',
  'e^{\\ln(x)*y} -> x^y',
  'e^\\ln(x) -> x',
  '\\ln(e^x*y) -> x+\\ln(y)',
  '\\ln(y/e^x) -> \\ln(y)-x',

  //Log base c
  {
    match: '\\log_c(x)',
    replace: '\\operatorname{NaN}',
    condition: ({ c }) => c.is(0) || c.is(1),
  },
  '\\log_c(x) + \\log_c(y) -> \\log_c(xy)', //assumes negative arguments are allowed
  '\\log_c(x) - \\log_c(y) -> \\log_c(x/y)',
  '\\log_c(c^x) -> x',
  '\\log_c(c) -> 1',
  '\\log_c(0) -> \\operatorname{NaN}',
  'c^{\\log_c(x)} -> x',
  'c^{\\log_c(x)*y} -> x^y',
  '\\log_c(c^x*y) -> x+\\log_c(y)',
  '\\log_c(c^x/y) -> x-\\log_c(y)',
  '\\log_c(y/c^x) -> \\log_c(y)-x',
  'c^{\\log_c(x)+y} -> x*c^y',

  //Change of Base
  '\\log_c(a)*\\ln(a) -> \\ln(c)',
  '\\log_c(a)/\\log_c(b) -> \\ln(a)/\\ln(b)',
  '\\log_c(a)/\\ln(a) -> 1/\\ln(c)',
  '\\ln(a)/\\log_c(a) -> \\ln(c)',

  //Absolute Value
  '|-x| -> |x|',
  {
    match: '|xy|',
    replace: 'x|y|',
    condition: ({ x }) => x.isNonNegative === true,
  },
  {
    match: '|xy|',
    replace: '-x|y|',
    condition: ({ x }) => x.isNonPositive === true,
  },

  '|x|^{n:even}->x^n',
  '|x^{n:even}|->x^n',
  '|x^n|->|x|^n',
  //Even functions
  '\\cos(|x|) -> \\cos(x)',
  '\\sec(|x|) -> \\sec(x)',
  '\\cosh(|x|) -> \\cosh(x)',
  '\\sech(|x|) -> \\sech(x)',

  //Odd Trig Functions
  '|\\sin(x)| -> \\sin(|x|)',
  '|\\tan(x)| -> \\tan(|x|)',
  '|\\cot(x)| -> \\cot(|x|)',
  '|\\csc(x)| -> \\csc(|x|)',
  '|\\arcsin(x)| -> \\arcsin(|x|)',
  '|\\arctan(x)| -> \\arctan(|x|)',
  '|\\arcctg(x)| -> \\arcctg(|x|)',
  '|\\arccsc(x)| -> \\arccsc(|x|)',
  //Odd Hyperbolic Trig Functions
  '|\\sinh(x)| -> \\sinh(|x|)',
  '|\\tanh(x)| -> \\tanh(|x|)',
  '|\\coth(x)| -> \\coth(|x|)',
  '|\\csch(x)| -> \\csch(|x|)',
  '|\\arsinh(x)| -> \\arsinh(|x|)',
  '|\\artanh(x)| -> \\artanh(|x|)',
  '|\\operatorname{arccoth}(x)| -> \\operatorname{arccoth}(|x|)',
  '|\\arcsch(x)| -> \\arcsch(|x|)',

  //Infinity and Division
  {
    match: '\\infty/x',
    replace: '\\infty',
    condition: ({ x }) => x.isPositive === true && x.isFinite === true,
  },
  {
    match: '(-\\infty)/x',
    replace: '-\\infty',
    condition: ({ x }) => x.isPositive === true && x.isFinite === true,
  },
  {
    match: '\\infty/x',
    replace: '-\\infty',
    condition: ({ x }) => x.isNegative === true && x.isFinite === true,
  },
  {
    match: '(-\\infty)/x',
    replace: '\\infty',
    condition: ({ x }) => x.isNegative === true && x.isFinite === true,
  },
  //Infinity and Powers (doesn't work for a=\\pi)
  {
    match: '\\infty^a',
    replace: '0',
    condition: ({ a }) => a.isNegative === true,
  },
  {
    match: '\\infty^a',
    replace: '\\infty',
    condition: ({ a }) => a.isPositive === true,
  },
  {
    match: '(-\\infty)^a',
    replace: '0',
    condition: ({ a }) => a.isNegative === true,
  },
  //This one works for \\pi
  // {match:'\\infty^a',replace:'\\infty',condition:id=>id._a.isPositive===true},

  //@fixme
  {
    match: '\\log_c(\\infty)',
    replace: '-\\infty',
    condition: ({ c }) => c.isLess(1) === true && c.isPositive === true,
  },

  //Trig and Infinity
  {
    match: '\\sin(x)',
    replace: '\\operatorname{NaN}',
    condition: ({ x }) => x.isInfinity === true,
  },
  {
    match: '\\cos(x)',
    replace: '\\operatorname{NaN}',
    condition: ({ x }) => x.isInfinity === true,
  },
  {
    match: '\\tan(x)',
    replace: '\\operatorname{NaN}',
    condition: ({ x }) => x.isInfinity === true,
  },
  {
    match: '\\cot(x)',
    replace: '\\operatorname{NaN}',
    condition: ({ x }) => x.isInfinity === true,
  },
  {
    match: '\\sec(x)',
    replace: '\\operatorname{NaN}',
    condition: ({ x }) => x.isInfinity === true,
  },
  {
    match: '\\csc(x)',
    replace: '\\operatorname{NaN}',
    condition: ({ x }) => x.isInfinity === true,
  },

  //Inverse Trig and Infinity
  '\\arcsin(\\infty) -> \\operatorname{NaN}',
  '\\arccos(\\infty) -> \\operatorname{NaN}',
  '\\arcsin(-\\infty) -> \\operatorname{NaN}',
  '\\arccos(-\\infty) -> \\operatorname{NaN}',
  '\\arctan(\\infty) -> \\frac{\\pi}{2}',
  '\\arctan(-\\infty) -> -\\frac{\\pi}{2}',
  '\\arcctg(\\infty) -> 0',
  '\\arcctg(-\\infty) -> \\pi',
  '\\arcsec(\\infty) -> \\frac{\\pi}{2}',
  '\\arcsec(-\\infty) -> \\frac{\\pi}{2}',
  '\\arccsc(\\infty) -> 0',
  '\\arccsc(-\\infty) -> 0',

  //Hyperbolic Trig and Infinity
  '\\sinh(\\infty) -> \\infty',
  '\\sinh(-\\infty) -> -\\infty',
  '\\cosh(\\infty) -> \\infty',
  '\\cosh(-\\infty) -> \\infty',
  '\\tanh(\\infty) -> 1',
  '\\tanh(-\\infty) -> -1',
  '\\coth(\\infty) -> 1',
  '\\coth(-\\infty) -> -1',
  '\\sech(\\infty) -> 0',
  '\\sech(-\\infty) -> 0',
  '\\csch(\\infty) -> 0',
  '\\csch(-\\infty) -> 0',

  //Inverse Hyperbolic Trig and Infinity
  '\\arsinh(-\\infty) -> -\\infty',
  {
    match: '\\artanh(x)',
    replace: NaN,
    condition: ({ x }) => x.isInfinity === true,
  },
  {
    match: '\\operatorname{arccoth}(x)',
    replace: 0,
    condition: ({ x }) => x.isInfinity === true,
  },
  {
    match: '\\arsech(x)',
    replace: NaN,
    condition: ({ x }) => x.isInfinity === true,
  },
  {
    match: '\\arcsch(x)',
    replace: NaN,
    condition: ({ x }) => x.isInfinity === true,
  },

  //Inverse Hyperbolic Trig
  '\\arctan(x/\\sqrt{1-x^2})->\\arcsin(x)',
  '\\ln(x+\\sqrt{x^2+1})->\\arsinh(x)',
  '\\ln(x+\\sqrt{x^2-1})->\\arcosh(x)',
  '\\frac{1}{2}\\ln(\\frac{1+x}{1-x})->\\artanh(x)',
  '\\ln(\\frac{1+\\sqrt{1-x^2}}{x})->\\arsech(x)',
  '\\ln(\\frac{1}{x} + \\sqrt{\\frac{1}{x^2}+1})->\\arcsch(x)',

  //Common Denominator
  {
    match: 'a/b+c/d',
    replace: '(a*d+b*c)/(b*d)',
    condition: () => true, //doesn't work without this
  },

  //Multiplication
  'x^nx^m->x^{n+m}',
  'x^n/x^m->x^{n-m}',
  'x^nx->x^{n+1}',
  'x^n/x->x^{n-1}',
  'x/x^n->x^{1-n}',

  //----------- DOMAIN ISSUES -----------

  //Division

  // This rule is not needed because the canonical form of 0/a is 0
  // { match: '0/a', replace: '0', condition: ({ _a }) => !_a.is(0) },

  //Powers
  // This rule is not needed because the canonical form of x^0 is 1
  // {
  //   match: 'x^0',
  //   replace: '1',
  //   condition: ({c}) => !c.is(0) && ids._x.isFinite === true,
  // },

  // -------- TRIGONOMETRIC --------
  '\\sin(-x) -> -\\sin(x)',
  '\\cos(-x) -> \\cos(x)',
  '\\tan(-x) -> -\\tan(x)',
  '\\cot(-x) -> -\\cot(x)',
  '\\sec(-x) -> \\sec(x)',
  '\\csc(-x) -> -\\csc(x)',
  '\\sin(\\pi - x) -> \\sin(x)',
  '\\cos(\\pi - x) -> -\\cos(x)',
  '\\tan(\\pi - x) -> -\\tan(x)',
  '\\cot(\\pi - x) -> -\\cot(x)',
  '\\sec(\\pi - x) -> -\\sec(x)',
  '\\csc(\\pi - x) -> \\csc(x)',
  '\\sin(\\pi + x) -> -\\sin(x)',
  '\\cos(\\pi + x) -> -\\cos(x)',
  '\\tan(\\pi + x) -> \\tan(x)',
  '\\cot(\\pi + x) -> -\\cot(x)',
  '\\sec(\\pi + x) -> -\\sec(x)',
  '\\csc(\\pi + x) -> \\csc(x)',

  '\\sin(\\frac{\\pi}{2} - x) -> \\cos(x)',
  '\\cos(\\frac{\\pi}{2} - x) -> \\sin(x)',
  '\\tan(\\frac{\\pi}{2} - x) -> \\cot(x)',
  '\\cot(\\frac{\\pi}{2} - x) -> \\tan(x)',
  '\\sec(\\frac{\\pi}{2} - x) -> \\csc(x)',
  '\\csc(\\frac{\\pi}{2} - x) -> \\sec(x)',
  '\\sin(x) * \\cos(x) -> \\frac{1}{2} \\sin(2x)',
  '\\sin(x) * \\sin(y) -> \\frac{1}{2} (\\cos(x-y) - \\cos(x+y))',
  '\\cos(x) * \\cos(y) -> \\frac{1}{2} (\\cos(x-y) + \\cos(x+y))',
  '\\tan(x) * \\cot(x) -> 1',
  '\\sin(x)^2 + \\cos(x)^2 -> 1',
  '1-\\sin(x)^2->\\cos(x)^2',
  '\\sin(x)^2-1->-\\cos(x)^2',
  '1-\\cos(x)^2->\\sin(x)^2',
  '\\cos(x)^2-1->-\\sin(x)^2',
  '\\tan^2(x)+1->\\sec^2(x)',
  '\\cot^2(x)+1->\\csc^2(x)',
  '\\sec^2(x)-1->\\tan^2(x)',
  '\\csc^2(x)-1->\\cot^2(x)',
  '-\\sec^2(x)+1->-\\tan^2(x)',
  '-\\csc^2(x)+1->-\\cot^2(x)',
  'a\\sin(x)^2+a\\cos(x)^2->a',
  'a-a\\cos(x)^2->a\\sin(x)^2',
  'a-a\\sin(x)^2->a\\cos(x)^2',
  'a\\sec(x)^2-a->a\\tan(x)^2',
  'a+a\\tan(x)^2->a\\sec(x)^2',
  'a\\csc(x)^2-a->a\\cot(x)^2',
  'a+a\\cot(x)^2->a\\csc(x)^2',
  '\\sin(x)^2 -> \\frac{1 - \\cos(2x)}{2}',
  '\\cos(x)^2 -> \\frac{1 + \\cos(2x)}{2}',
  '\\tan(x)->\\sin(x)/\\cos(x)',
  '\\cot(x)->\\cos(x)/\\sin(x)',
  '\\sec(x)->1/\\cos(x)',
  '\\csc(x)->1/\\sin(x)',
];
//  [
//   // `Subtract`
//   ['$\\_ - \\_$', 0],
//   [['Subtract', '\\_x', 0], 'x'],
//   [['Subtract', 0, '\\_x'], '$-x$'],

//   // `Add`
//   [['Add', '_x', ['Negate', '_x']], 0],

//   // `Multiply`
//   ['$\\_ \\times \\_ $', '$\\_^2$'],

//   // `Divide`
//   [['Divide', '_x', 1], { sym: '_x' }],
//   [['Divide', '_x', '_x'], 1, { condition: (sub) => sub.x.isNotZero ?? false }],
//   [
//     ['Divide', '_x', 0],
//     { num: '+Infinity' },
//     { condition: (sub) => sub.x.isPositive ?? false },
//   ],
//   [
//     ['Divide', '_x', 0],
//     { num: '-Infinity' },
//     { condition: (sub) => sub.x.isNegative ?? false },
//   ],
//   [['Divide', 0, 0], NaN],

//   // `Power`
//   [['Power', '_x', 'Half'], '$\\sqrt{x}$'],
//   [
//     ['Power', '_x', 2],
//     ['Square', '_x'],
//   ],

//   // Complex
//   [
//     ['Divide', ['Complex', '_re', '_im'], '_x'],
//     ['Add', ['Divide', ['Complex', 0, '_im'], '_x'], ['Divide', '_re', '_x']],
//     {
//       condition: (sub: Substitution): boolean =>
//         (sub.re.isNotZero ?? false) &&
//         (sub.re.isInteger ?? false) &&
//         (sub.im.isInteger ?? false),
//     },
//   ],

//   // `Abs`
//   [
//     ['Abs', '_x'],
//     { sym: '_x' },
//     {
//       condition: (sub: Substitution): boolean => sub.x.isNonNegative ?? false,
//     },
//   ],
//   [
//     ['Abs', '_x'],
//     ['Negate', '_x'],
//     {
//       condition: (sub: Substitution): boolean => sub.x.isNegative ?? false,
//     },
//   ],

//   //
//   // Boolean
//   //
//   [['Not', ['Not', '_x']], '_x'], // @todo Since Not is an involution, should not be needed
//   [['Not', 'True'], 'False'],
//   [['Not', 'False'], 'True'],
//   [['Not', 'OptArg'], 'OptArg'],

//   [['And'], 'True'],
//   [['And', '__x'], '__x'],
//   [['And', '__x', 'True'], '_x'],
//   [['And', '__', 'False'], 'False'],
//   [['And', '__', 'OptArg'], 'OptArg'],
//   [['And', '__x', ['Not', '__x']], 'False'],
//   [['And', ['Not', '__x'], '__x'], 'False'],

//   [['Or'], 'False'],
//   [['Or', '__x'], '__x'],
//   [['Or', '__', 'True'], 'True'],
//   [['Or', '__x', 'False'], '__x'],
//   [
//     ['Or', '__x', 'OptArg'],
//     ['Or', '__x'],
//   ],

//   [
//     ['NotEqual', '__x'],
//     ['Not', ['Equal', '__x']],
//   ],
//   [
//     ['NotElement', '__x'],
//     ['Not', ['Element', '__x']],
//   ],
//   [
//     ['NotLess', '__x'],
//     ['Not', ['Less', '__x']],
//   ],
//   [
//     ['NotLessNotEqual', '__x'],
//     ['Not', ['LessEqual', '__x']],
//   ],
//   [
//     ['NotTildeFullEqual', '__x'],
//     ['Not', ['TildeFullEqual', '__x']],
//   ],
//   [
//     ['NotApprox', '__x'],
//     ['Not', ['Approx', '__x']],
//   ],
//   [
//     ['NotApproxEqual', '__x'],
//     ['Not', ['ApproxEqual', '__x']],
//   ],
//   [
//     ['NotGreater', '__x'],
//     ['Not', ['Greater', '__x']],
//   ],
//   [
//     ['NotApproxNotEqual', '__x'],
//     ['Not', ['GreaterEqual', '__x']],
//   ],
//   [
//     ['NotPrecedes', '__x'],
//     ['Not', ['Precedes', '__x']],
//   ],
//   [
//     ['NotSucceeds', '__x'],
//     ['Not', ['Succeeds', '__x']],
//   ],
//   [
//     ['NotSubset', '__x'],
//     ['Not', ['Subset', '__x']],
//   ],
//   [
//     ['NotSuperset', '__x'],
//     ['Not', ['Superset', '__x']],
//   ],
//   [
//     ['NotSubsetNotEqual', '__x'],
//     ['Not', ['SubsetEqual', '__x']],
//   ],
//   [
//     ['NotSupersetEqual', '__x'],
//     ['Not', ['SupersetEqual', '__x']],
//   ],

//   // DeMorgan's Laws
//   [
//     ['Not', ['And', ['Not', '_a'], ['Not', '_b']]],
//     ['Or', '_a', '_b'],
//   ],
//   [
//     ['And', ['Not', '_a'], ['Not', '_b']],
//     ['Not', ['Or', '_a', '_b']],
//   ],
//   [
//     ['Not', ['Or', ['Not', '_a'], ['Not', '_b']]],
//     ['And', '_a', '_b'],
//   ],
//   [
//     ['Or', ['Not', '_a'], ['Not', '_b']],
//     ['Not', ['And', '_a', '_b']],
//   ],

//   // Implies

//   [['Implies', 'True', 'False'], 'False'],
//   [['Implies', '_', 'OptArg'], 'True'],
//   [['Implies', '_', 'True'], 'True'],
//   [['Implies', 'False', '_'], 'True'],
//   [
//     ['Or', ['Not', '_p'], '_q'],
//     ['Implies', '_p', '_q'],
//   ], // p => q := (not p) or q
//   // if           Q=F & P= T      F
//   // otherwise                    T

//   //  Equivalent

//   [
//     ['Or', ['And', '_p', '_q'], ['And', ['Not', '_p'], ['Not', '_q']]],
//     ['Equivalent', '_p', '_q'],
//   ], // p <=> q := (p and q) or (not p and not q), aka `iff`
//   //   if (q = p), T. Otherwise, F
//   [['Equivalent', 'True', 'True'], 'True'],
//   [['Equivalent', 'False', 'False'], 'True'],
//   [['Equivalent', 'OptArg', 'OptArg'], 'True'],
//   [['Equivalent', 'True', 'False'], 'False'],
//   [['Equivalent', 'False', 'True'], 'False'],
//   [['Equivalent', 'True', 'OptArg'], 'False'],
//   [['Equivalent', 'False', 'OptArg'], 'False'],
//   [['Equivalent', 'OptArg', 'True'], 'False'],
//   [['Equivalent', 'OptArg', 'False'], 'False'],

// \frac{\sin ^4\left(x\right)-\cos ^4\left(x\right)}{\sin ^2\left(x\right)-\cos ^2\left(x\right)}
// -> 1
// \frac{\sec \left(x\right)\sin ^2\left(x\right)}{1+\sec \left(x\right)}
// -> 1 - cos x
// \tan ^4\left(x\right)+2\tan ^2\left(x\right)+1
// -> \sec ^4\left(x\right)
// \tan ^2\left(x\right)\cos ^2\left(x\right)+\cot ^2\left(x\right)\sin ^2\left(x\right)
// -> 1

describe('SIMPLIFY', () => {
  console.info('\n\nconst CANONICALIZATION_TEST_CASES: TestCase[] = [\n');

  for (const test of CANONICALIZATION_TEST_CASES) runTestCase(test);

  console.info('\n];\n\n');

  console.info('const RULE_TEST_CASES: TestCase[] = [\n\n');

  const rules = ce.rules([
    ...ce.getRuleSet('standard-simplification')!.rules,
    ...RULES,
  ]);
  for (const test of RULE_TEST_CASES) {
    try {
      runTestCase(test, rules);
    } catch (e) {
      console.error(`${test}\n${e.message}\n`);
    }
  }
  console.info('\n];\n\n');

  // Display status of rules...
  console.info(
    '\n\n\n/*\nSUMMARY OF UNUSED RULES:\n\n   🚫 = rule not used (no test case for this rule)\n\n\n'
  );
  // console.info(
  //   '\n\n\n/*\nSUMMARY OF RULE USAGE:\n\n   ✅ = used (a test case used this rule), 🚫 = not used (no test case for this rule)\n\n\n'
  // );
  for (const rule of ce.rules(RULES).rules) {
    if (!RULES_USED.includes(ruleName(rule) ?? 'no rule'))
      console.info('🚫 ' + ruleName(rule));
    // else console.info('✅ ' + ruleName(rule));
  }
  console.info('*/\n\n\n');
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
      `["Less", ["Square", "x"], ["Multiply", 2, ["Power", "x", 3]]]`
    ));

  test(`2a < 4ab`, () =>
    expect(simplify('2a < 4ab')).toMatchInlineSnapshot(
      `["Less", "a", ["Multiply", 2, "a", "b"]]`
    ));
});

//
// Fu Test
//

const testHelper = (a: string, b: string) => {
  test(a, () => expect(Fu(ce.parse(a))).toBe(ce.parse(b)));
};

describe.skip('Fu Test', () => {
  let tests = [
    ['2\\sin(x)\\cos(x)-\\sin(2x)', '0'],
    ['\\sin^2(x)+\\cos^2(x)+2x', '1+2x'],
    ['\\sec^2(x)-1', '\\tan^2(x)'],
    ['\\cot^2(x)-\\csc^2(x)', '-1'],
    ['2-2\\sin^2(x)', '2\\cos^2(x)'],
    ['\\cos(-x)+\\cos(x)', '2\\cos(x)'],
    ['\\sec(-x)\\cos(x)', '1'],
    ['\\sin(x)\\cos(h+2\\pi)+\\sin(-h+\\pi)\\cos(-x)', '\\sin(x+h)'],
    ['(1-\\cos(2x))/2', '\\sin^2(x)'],
    ['(1+\\cos(2x))/2', '\\cos^2(x)'],
    ['\\sin(x+\\pi)+2\\sin(x)', '\\sin(x)'],
    ['\\tan(x)\\tan(-x)', '-\\tan^2(x)'],
    ['\\sin(x+h)+\\sin(x-h)', '2\\cos(x)\\sin(h)'],
    //From Fu's Paper
    ['1-(1/4)*\\sin^2(2x)-\\sin^2(y)-\\cos^4(x)', '\\sin(x+y)\\sin(x-y)'],
    ['\\cos(\\pi/9)*\\cos(2\\pi/9)*\\cos(3\\pi/9)*\\cos(4\\pi/9)', '1/16'],
    [
      '\\tan(7\\pi/18)+\\tan(5\\pi/18)-\\sqrt{3}\\tan(5\\pi/18)\\tan(7\\pi/18)',
      '-\\sqrt{3}',
    ],
  ];
  tests.forEach(([a, b]) => testHelper(a, b));
});

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\');
}

function runTestCase(test: TestCase, rules?: BoxedRuleSet): void {
  // Is it a heading?
  if (test.length === 1) {
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

  if (comment?.startsWith('stop')) {
    let a1 = a.simplify({ rules });
    const eq = a1.isSame(b);
    debugger;
    a1 = a.simplify({ rules });
  }
  let result = tryRules(a, b, rules);

  console.info(result ? `${row} // ${result}` : row);
  // test(row, () => expect(a.simplify().json).toEqual(b.json));
}

function tryRules(
  a: BoxedExpression,
  b: BoxedExpression,
  allRules?: BoxedRuleSet
): string {
  // Just using the default rules...
  if (a.simplify().isSame(b)) return '';

  if (!allRules) return '';

  // Try with no rules
  const sa = a.simplify({ rules: [] });
  if (sa.isSame(b)) {
    // If we succeeded with no rules, we might be testing a negative case...
    // i.e. x/x doesn't get simplified when it shouldn't.

    // Try will *all* rules...
    if (a.simplify({ rules: allRules }).isSame(b)) return '👍 all rules';
    return `🙁 with all rules: ${a.simplify({ rules: allRules })}`;
  }

  // One rule at a time
  let i = 0;
  const ruleCount = allRules.rules.length - 1;
  while (i <= ruleCount) {
    const rule = allRules.rules[i];
    const sa = a.simplify({ rules: rule });
    if (sa.isSame(b)) {
      const id = ruleName(rule) ?? 'no rule';
      if (id.startsWith('\\varphi')) debugger;
      if (!RULES_USED.includes(id)) RULES_USED.push(id);

      return '👍 ' + id;
    }
    i += 1;
  }

  // Many rules at a time
  i = 0;
  let rules: BoxedRule[] = [];
  while (i <= ruleCount) {
    const sa = a.simplify({ rules });
    if (sa.isSame(b)) {
      const id = ruleName(rules.at(-1)) ?? 'no rules';
      if (!RULES_USED.includes(id)) RULES_USED.push(id);
      if (id.startsWith('\\varphi')) debugger;
      return 'up to 👍' + id;
    }
    rules.push(allRules.rules[i]);
    i += 1;
  }

  return `🙁 ${a.simplify({ rules: allRules }).toString()}`;
}

function ruleName(rule: BoxedRule | undefined): string | undefined {
  if (!rule) return undefined;
  if (rule.id) return rule.id;
  if (typeof rule.replace === 'function')
    return `function ${rule.replace.toString().replace('\n', '   ')}`;
  return 'unknown rule';
}
