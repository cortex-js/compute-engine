import { ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/types.ts';
import { simplify } from '../utils';

export const ce = new ComputeEngine();

/**
 * Helper: parse input, simplify, check semantic equality with expected.
 * On failure, reports LaTeX for readability.
 */
function checkSimplify(
  input: string | Expression,
  expected: string | number | Expression
) {
  const a = typeof input === 'string' ? ce.parse(input) : ce.box(input);
  const b =
    typeof expected === 'number'
      ? ce.box(expected)
      : typeof expected === 'string'
        ? ce.parse(expected)
        : ce.box(expected);

  const result = a.simplify();
  if (!result.isSame(b)) {
    // Provide readable failure message
    expect(`${result.latex}`).toBe(`${b.latex}`);
  }
}

// ============================================================
// CANONICALIZATION TEST CASES
// Converted from dormant CANONICALIZATION_TEST_CASES array
// ============================================================

describe('Canonicalization: Arithmetic operations', () => {
  test('-23 stays as integer', () => checkSimplify('-23', -23));
  test('0.3 stays as float', () => checkSimplify('0.3', 0.3));
  test('3/4 stays as rational', () => checkSimplify('3/4', '3/4'));
  test('6/8 reduces to 3/4', () => checkSimplify('6/8', '3/4'));
  test('3/4 + 2 = 11/4', () => checkSimplify('3/4 + 2', '11/4'));
  test('3/4 + 5/7 = 41/28', () => checkSimplify('3/4 + 5/7', '41/28'));
  test('sqrt(3) stays exact', () => checkSimplify('\\sqrt3', '\\sqrt3'));
  test('sqrt(3.1) is computed', () =>
    checkSimplify('\\sqrt{3.1}', { num: '1.76068168616590091458' }));
  test('x+0 = x', () => checkSimplify('x+0', 'x'));
  test('-1234 - 5678 = -6912', () => checkSimplify('-1234 - 5678', -6912));
  test('1.234 + 5678 = 5679.234', () =>
    checkSimplify('1.234 + 5678', 5679.234));
  test('1.234 + 5.678 = 6.912', () => checkSimplify('1.234 + 5.678', 6.912));
  test('1.234 + 5.678 + 1.0001 = 7.9121', () =>
    checkSimplify('1.234 + 5.678 + 1.0001', 7.9121));
  test('2 + 4 = 6', () => checkSimplify('2 + 4', 6));
  test('1/2 + 0.5 = 1', () => checkSimplify('1/2 + 0.5', 1));
  test('sqrt(3) + 3 stays exact', () =>
    checkSimplify('\\sqrt3 + 3', '\\sqrt3 + 3'));
  test('sqrt(3) + 1/2 stays exact', () =>
    checkSimplify('\\sqrt3 + 1/2', '\\sqrt3 + 1/2'));
  test('sqrt(3) + 0.3 is computed', () =>
    checkSimplify('\\sqrt3 + 0.3', { num: '2.03205080756887729353' }));
  test('3.1/2.8 = float', () =>
    checkSimplify('3.1/2.8', '1.10714285714285714286'));
  test('2x * x * 3 * x = 6x^3', () =>
    checkSimplify(' 2x\\times x \\times 3 \\times x', '6x^3'));
  test('2(13.1+x) = 26.2+2x', () =>
    checkSimplify('2(13.1+x)', '26.2+2x'));
  test('2(13.1+x) - 26.2 - 2x = 0', () =>
    checkSimplify('2(13.1+x) - 26.2 - 2x', 0));
});

describe('Canonicalization: Numeric literals', () => {
  test('sqrt(3) - 2 stays exact', () =>
    checkSimplify('\\sqrt3 - 2', '\\sqrt3 - 2'));
  test('(sqrt(5)+1)/4 stays exact', () =>
    checkSimplify(
      '\\frac{\\sqrt5+1}{4}',
      '\\frac{\\sqrt5}{4}+\\frac14'
    ));
});

describe('Canonicalization: Addition and Subtraction', () => {
  test('-2+x = x-2', () => checkSimplify('-2+x', 'x-2'));
  test('x-(-1) = x+1', () => checkSimplify('x-(-1)', 'x+1'));
  test('x+(-1) = x-1', () => checkSimplify('x+(-1)', 'x-1'));
});

describe('Canonicalization: Multiplication', () => {
  test('1*x = x', () => checkSimplify('1*x', 'x'));
  test('-1*x = -x', () => checkSimplify('-1*x', '-x'));
  test('(-2)*(-x) = 2x', () => checkSimplify('(-2)*(-x)', '2*x'));
  test('2*(-x) = -2x', () => checkSimplify('2*(-x)', '-2*x'));
});

describe('Canonicalization: Combine Like Terms', () => {
  test('x+2x = 3x', () => checkSimplify('x+2*x', '3*x'));
  test('2pi*x^2 - pi*x^2 + 2pi', () =>
    checkSimplify(
      '2*\\pi * x^2-\\pi * x^2+2*\\pi',
      '\\pi * x^2+ 2\\pi'
    ));
});

describe('Canonicalization: Power of Fraction in Denominator', () => {
  test('x/(y/2)^3 = 8x/y^3', () =>
    checkSimplify('x/(y/2)^3', '(8*x)/y^3'));
  test('x/(2/y)^3 = x*y^3/8', () =>
    checkSimplify('x/(2/y)^3', '1/8*x*y^3'));
  test('x/(pi/2)^3 = 8x/pi^3', () =>
    checkSimplify('x/(\\pi/2)^3', '(8x)/\\pi^3'));
});

describe('Canonicalization: Others', () => {
  test('2(13.1+x)-(26.2+2x) = 0', () =>
    checkSimplify(
      '2\\left(13.1+x\\right)-\\left(26.2+2x\\right)',
      0
    ));
  test('sqrt(3)(sqrt(2)x+x)', () =>
    checkSimplify('\\sqrt{3}(\\sqrt2x + x)', '(\\sqrt3+\\sqrt6)x'));
  test('Add(1,2,1.0001) = 4.0001', () =>
    checkSimplify(['Add', 1, 2, 1.0001], 4.0001));
  test('2a < 4b simplifies to a < 2b', () =>
    checkSimplify('2a < 4b', 'a < 2b'));
  test('2pi < 4pi simplifies to 1 < 2', () =>
    checkSimplify('2\\pi < 4\\pi', '1 < 2'));
  test.todo('(2pi+2pi*e) < 4pi simplifies — needs factor() to extract common factors from Add');
});

describe('Canonicalization: Double Powers', () => {
  test('(x^1)^3 = x^3', () => checkSimplify('(x^1)^3', 'x^3'));
  test('(x^2)^{-2} = x^{-4}', () =>
    checkSimplify('(x^2)^{-2}', 'x^{-4}'));
  test('(x^2)^3 = x^6', () => checkSimplify('(x^2)^3', 'x^6'));
  test('(x^{-2})^{-1} = x^2', () =>
    checkSimplify('(x^{-2})^{-1}', 'x^2'));
  test('(pi^{3/2})^2 = pi^3', () =>
    checkSimplify('(\\pi^{3/2})^2', '\\pi^3'));
  test('(x^4)^{-2} = x^{-8}', () =>
    checkSimplify('(x^4)^{-2}', 'x^{-8}'));
  test('(x^{-2})^{-2} = x^4', () =>
    checkSimplify('(x^{-2})^{-2}', 'x^4'));
  test('(x^3)^{2/5} = x^{6/5}', () =>
    checkSimplify('(x^3)^{2/5}', 'x^{6/5}'));
  test('(x^2)^{1/2} = |x|', () =>
    checkSimplify('(x^2)^{1/2}', '|x|'));
  test('(x^3)^{1/3} = x', () => checkSimplify('(x^3)^{1/3}', 'x'));
});

describe('Canonicalization: Negative Signs and Multiplication and Division', () => {
  test('-(-x) = x', () => checkSimplify('-(-x)', 'x'));
  test('x(-2) = -2x', () => checkSimplify('x(-2)', '-2x'));
  test('(-x)(2) = -2x', () => checkSimplify('(-x)(2)', '-2x'));
  test('(-x)(-2) = 2x', () => checkSimplify('(-x)(-2)', '2x'));
  test('(-x)/(-2) = x/2', () => checkSimplify('(-x)/(-2)', 'x/2'));
  test('(-1)/x = -1/x', () => checkSimplify('(-1)/x', '-1/x'));
  test('2/(-x) = -2/x', () => checkSimplify('2/(-x)', '-2/x'));
  test('(-x)/2 = -x/2', () => checkSimplify('(-x)/2', '-1/2*x'));
});

describe('Canonicalization: Negative Powers in Denominator', () => {
  test('2/pi^{-2} = 2pi^2', () =>
    checkSimplify('\\frac{2}{\\pi^{-2}}', '2\\pi^2'));
  test('2/(x*pi^{-2}) = 2pi^2/x', () =>
    checkSimplify('\\frac{2}{x\\pi^{-2}}', '\\frac{2\\pi^2}{x}'));
});

describe('Canonicalization: Powers: Multiplication', () => {
  test('x*x = x^2', () => checkSimplify('x*x', 'x^2'));
  test('x^2*x^{-3} = 1/x', () => checkSimplify('x^2*x^{-3}', '1/x'));
  test('x^2*x^{-1} = x', () => checkSimplify('x^2*x^{-1}', 'x'));
  test('x^2*x^3 = x^5', () => checkSimplify('x^2*x^3', 'x^5'));
  test('x^{-2}*x^{-1} = 1/x^3', () =>
    checkSimplify('x^{-2}*x^{-1}', '1/x^3'));
  test('x^{2/3}*x^2 = x^{8/3}', () =>
    checkSimplify('x^{2/3}*x^2', 'x^{8/3}'));
  test('x^{5/2}*x^3 = x^{11/2}', () =>
    checkSimplify('x^{5/2}*x^3', 'x^{11/2}'));
  test('pi^{-1}*pi^2 = pi', () =>
    checkSimplify('\\pi^{-1}*\\pi^2', '\\pi'));
  test('sqrt(x)*sqrt(x) = x', () =>
    checkSimplify('\\sqrt{x}*\\sqrt{x}', 'x'));
  test('sqrt(x)*x^2 = x^{5/2}', () =>
    checkSimplify('\\sqrt{x}*x^2', 'x^{5/2}'));
  test('x^3*x = x^4', () => checkSimplify('x^3*x', 'x^4'));
  test('x^{-2}*x = 1/x', () => checkSimplify('x^{-2}*x', '1/x'));
  test('x^{-1/3}*x = x^{2/3}', () =>
    checkSimplify('x^{-1/3}*x', 'x^{2/3}'));
  test('cbrt(x)*x = x^{4/3}', () =>
    checkSimplify('\\sqrt[3]{x}*x', 'x^{4/3}'));
  test('x*x^2*x^{-2} = x', () => checkSimplify('x*x^2*x^{-2}', 'x'));
});

describe('Canonicalization: Powers: Division', () => {
  test('x^2/x^3 = 1/x', () => checkSimplify('x^2/x^3', '1/x'));
  test('x^{-1}/x^3 = 1/x^4', () =>
    checkSimplify('x^{-1}/x^3', '1/x^4'));
  test('x/x^{-1} = x^2', () => checkSimplify('x/x^{-1}', 'x^2'));
  test('pi/pi^{-1} = pi^2', () =>
    checkSimplify('\\pi / \\pi^{-1}', '\\pi^2'));
  test('x/x^3 = 1/x^2', () => checkSimplify('x/x^3', '1/x^2'));
  test('(2x)/x^5 = 2/x^4', () => checkSimplify('(2*x)/x^5', '2/x^4'));
  test('x^5/x^7 = 1/x^2', () => checkSimplify('x^5/x^7', '1/x^2'));
  test('x/x^{-2} = x^3', () => checkSimplify('x/x^{-2}', 'x^3'));
  test('x^2/x = x', () => checkSimplify('x^2/x', 'x'));
  test('x^{-3/5}/x = 1/x^{8/5}', () =>
    checkSimplify('x^{-3/5}/x', '1/x^{8/5}'));
  test('pi^2/pi = pi', () => checkSimplify('\\pi^2/\\pi', '\\pi'));
  test('pi/pi^{-2} = pi^3', () =>
    checkSimplify('\\pi/\\pi^{-2}', '\\pi^3'));
  test('cbrt(x)/x = 1/x^{2/3}', () =>
    checkSimplify('\\sqrt[3]{x}/x', '1/x^{2/3}'));
});

describe('Canonicalization: Distribute', () => {
  test('xy+(x+1)y = 2xy+y', () =>
    checkSimplify('x*y+(x+1)*y', '2xy+y'));
});

describe('Canonicalization: Division by 0', () => {
  test('1/(1/0) = 0', () => checkSimplify('1/(1/0)', 0));
});

describe('Canonicalization: Division a/a', () => {
  test('pi/pi = 1', () => checkSimplify('\\pi/\\pi', 1));
  test('(pi+1)/(pi+1) = 1', () =>
    checkSimplify('(\\pi+1)/(\\pi+1)', 1));
  test('x/x = 1', () => checkSimplify('x/x', 1));
});

describe('Canonicalization: Dividing by Fraction', () => {
  test('1/(1/pi) = pi', () => checkSimplify('1/(1/\\pi)', '\\pi'));
  test('1/(1/x) = x', () => checkSimplify('1/(1/x)', 'x'));
  test('y/(1/2) = 2y', () => checkSimplify('y/(1/2)', '2*y'));
  test('x/(1/(-pi)) = -pi*x', () =>
    checkSimplify('x/(1/(-\\pi))', '-\\pi * x'));
  test('x/(a/pi) = pi*x/a', () =>
    checkSimplify('x/(a/\\pi)', '(\\pi * x)/a'));
  test('x/(a/b) = bx/a', () => checkSimplify('x/(a/b)', '(b*x)/a'));
  test('(x/y)/(pi/2) = 2x/(pi*y)', () =>
    checkSimplify('(x/y)/(\\pi/2)', '(2*x)/(\\pi * y)'));
});

describe('Canonicalization: Multiplying by Fraction', () => {
  test('2/pi * pi = 2', () => checkSimplify('2/\\pi * \\pi', '2'));
  test('2/3*5/x = 10/(3x)', () => checkSimplify('2/3*5/x', '10/(3*x)'));
  test('a/b*c/d = ac/(bd)', () => checkSimplify('a/b*c/d', '(a*c)/(b*d)'));
});

describe('Canonicalization: Operations Involving 0', () => {
  test('0*pi = 0', () => checkSimplify('0*\\pi', 0));
  test('x-0 = x', () => checkSimplify('x-0', 'x'));
  test('sin(x)+0 = sin(x)', () =>
    checkSimplify('\\sin(x)+0', '\\sin(x)'));
  test('0/0 = NaN', () => checkSimplify('0/0', NaN));
  test('2/0 = ComplexInfinity', () =>
    checkSimplify('2/0', '\\tilde\\infty'));
  test('0^pi = 0', () => checkSimplify('0^\\pi', 0));
  test('0^{-2} = complex infinity', () =>
    checkSimplify('0^{-2}', '\\tilde\\infty'));
  test('0^{-pi} = complex infinity', () =>
    checkSimplify('0^{-\\pi}', '\\tilde\\infty'));
  test('0^0 = NaN', () => checkSimplify('0^0', NaN));
  test('2^0 = 1', () => checkSimplify('2^0', 1));
  test('pi^0 = 1', () => checkSimplify('\\pi^0', 1));
  test('0/2 = 0', () => checkSimplify('0/2', 0));
  test('sqrt(0) = 0', () => checkSimplify('\\sqrt{0}', 0));
  test('root4(0) = 0', () => checkSimplify('\\sqrt[4]{0}', 0));
  test('e^0 = 1', () => checkSimplify('e^0', 1));
  test('|0| = 0', () => checkSimplify('|0|', 0));
  test('-0 = 0', () => checkSimplify('-0', 0));
  test('0-x = -x', () => checkSimplify('0-x', '-x'));
  test('0x = 0', () => checkSimplify('0x', '0'));
});

describe('Canonicalization: Operations Involving 1', () => {
  test('1x = x', () => checkSimplify('1x', 'x'));
  test('-1x = -x', () => checkSimplify('-1x', '-x'));
  test('x^1 = x', () => checkSimplify('x^1', 'x'));
  test('x/1 = x', () => checkSimplify('x/1', 'x'));
  test('x/(-1) = -x', () => checkSimplify('x/(-1)', '-x'));
});

describe('Canonicalization: Ln', () => {
  test('ln(9)/ln(3) = 2', () =>
    checkSimplify('\\frac{\\ln(9)}{\\ln(3)}', 2));
  test('ln(e^x/y)-x = -ln(y)', () =>
    checkSimplify('\\ln(e^x/y)-x', '-\\ln(y)'));
  test('ln(y/e^x) = ln(y)-x', () =>
    checkSimplify('\\ln(y/e^x)', '\\ln(y)-x'));
  test('ln(0) = -infinity', () => checkSimplify('\\ln(0)', '-\\infty'));
  test('ln(1/x) = -ln(x)', () =>
    checkSimplify('\\ln(1/x)', '-\\ln(x)'));
  test('ln(1) = 0', () => checkSimplify('\\ln(1)', 0));
  test('ln(e) = 1', () => checkSimplify('\\ln(e)', 1));
  test('ln(e^x) = x', () => checkSimplify('\\ln(e^x)', 'x'));
  test('ln(e^x/y)+ln(y) = x', () =>
    checkSimplify('\\ln(e^x/y)+\\ln(y)', 'x'));
});

describe('Canonicalization: Log', () => {
  test('log_c(1) = 0', () => checkSimplify('\\log_c(1)', 0));
  test('log_2(1/x) = -log_2(x)', () =>
    checkSimplify('\\log_2(1/x)', '-\\log_2(x)'));
  test('log_2(0) = -infinity', () =>
    checkSimplify('\\log_2(0)', '-\\infty'));
});

describe('Canonicalization: Absolute Value', () => {
  test('|pi| = pi', () => checkSimplify('|\\pi|', '\\pi'));
  test('|-pi-1| = pi+1', () => checkSimplify('|-\\pi-1|', '\\pi+1'));
  test('|infinity| = infinity', () =>
    checkSimplify('|\\infty|', '\\infty'));
  test('|-infinity| = infinity', () =>
    checkSimplify('|-\\infty|', '\\infty'));
  test('|-pi| = pi', () => checkSimplify('|-\\pi|', '\\pi'));
  test('|2| = 2', () => checkSimplify('|2|', '2'));
  test('|-1-pi| = pi+1', () => checkSimplify('|-1-\\pi|', '\\pi+1'));
  test('|2x|-2|x| = 0', () => checkSimplify('|2x|-2|x|', '0'));
});

describe('Canonicalization: Powers and Infinity', () => {
  test('(0.5)^{-infinity} = infinity', () =>
    checkSimplify('(0.5)^{-\\infty}', '\\infty'));
  test('(1/2)^infinity = 0', () =>
    checkSimplify('(1/2)^\\infty', '0'));
  test('2^{-infinity} = 0', () => checkSimplify('2^{-\\infty}', '0'));
  test('2^infinity = infinity', () =>
    checkSimplify('2^\\infty', '\\infty'));
  test('2.2^infinity = infinity', () =>
    checkSimplify('2.2^\\infty', '\\infty'));
  test('0.5^infinity = 0', () => checkSimplify('0.5^\\infty', 0));
  test('(-infinity)^{-1} = 0', () =>
    checkSimplify('(-\\infty)^{-1}', 0));
});

describe('Canonicalization: Logs and Infinity', () => {
  test('ln(infinity) = infinity', () =>
    checkSimplify('\\ln(\\infty)', '\\infty'));
  test('log_4(infinity) = infinity', () =>
    checkSimplify('\\log_4(\\infty)', '\\infty'));
  test('log_infinity(2) = 0', () =>
    checkSimplify('\\log_\\infty(2)', '0'));
  test('log_2(infinity) = infinity', () =>
    checkSimplify('\\log_2(\\infty)', '\\infty'));
});

describe('Canonicalization: Roots and Infinity', () => {
  test('sqrt(infinity) = infinity', () =>
    checkSimplify('\\sqrt{\\infty}', '\\infty'));
});

describe('Canonicalization: Multiplication and Infinity', () => {
  test('0.5*infinity = infinity', () =>
    checkSimplify('0.5*\\infty', '\\infty'));
  test('(-0.5)*(-infinity) = infinity', () =>
    checkSimplify('(-0.5)*(-\\infty)', '\\infty'));
  test('pi*(-infinity) = -infinity', () =>
    checkSimplify('\\pi * (-\\infty)', '-\\infty'));
});

describe('Canonicalization: Division and Infinity', () => {
  test('2/infinity = 0', () => checkSimplify('2/\\infty', 0));
  test('-100/(-infinity) = 0', () =>
    checkSimplify('-100/(-\\infty)', 0));
  test('0/infinity = 0', () => checkSimplify('0/\\infty', 0));
});

describe('Canonicalization: Addition/Subtraction and Infinity', () => {
  test('infinity - infinity = NaN', () =>
    checkSimplify('\\infty-\\infty', NaN));
  test('-infinity - infinity = -infinity', () =>
    checkSimplify('-\\infty-\\infty', '-\\infty'));
  test('infinity + infinity = infinity', () =>
    checkSimplify('\\infty+\\infty', '\\infty'));
  test('infinity + 10 = infinity', () =>
    checkSimplify('\\infty+10', '\\infty'));
  test('infinity - 10 = infinity', () =>
    checkSimplify('\\infty-10', '\\infty'));
  test('-infinity + 10 = -infinity', () =>
    checkSimplify('-\\infty+10', '-\\infty'));
  test('-infinity - 10 = -infinity', () =>
    checkSimplify('-\\infty-10', '-\\infty'));
  test('-10 - infinity = -infinity', () =>
    checkSimplify('-10-\\infty', '-\\infty'));
});

describe('Canonicalization: Inverse Hyperbolic Trig and Infinity', () => {
  test('arsinh(infinity) = infinity', () =>
    checkSimplify('\\arsinh(\\infty)', '\\infty'));
  test('arcosh(infinity) = infinity', () =>
    checkSimplify('\\arcosh(\\infty)', '\\infty'));
  test('arcosh(-infinity) = NaN', () =>
    checkSimplify('\\arcosh(-\\infty)', NaN));
});

// ============================================================
// RULE TEST CASES
// Converted from dormant RULE_TEST_CASES array.
// These originally required custom rules. Tested here with
// standard simplification only.
// ============================================================

describe('Rules: Roots', () => {
  test('root(0)(2) = NaN', () => checkSimplify('\\sqrt[0]{2}', NaN));
  test('root(pi)(0) = 0', () => checkSimplify('\\sqrt[\\pi]{0}', 0));
  test('root(-pi)(0) = NaN', () =>
    checkSimplify('\\sqrt[-\\pi]{0}', NaN));
  test('root(pi)(1) = 1', () => checkSimplify('\\sqrt[\\pi]{1}', 1));
  test('root(-pi)(1) = 1', () => checkSimplify('\\sqrt[-\\pi]{1}', 1));
});

describe('Rules: Nested Roots', () => {
  test('sqrt(sqrt(x)) = x^{1/4}', () =>
    checkSimplify('\\sqrt{\\sqrt{x}}', '\\sqrt[4]{x}'));
  test('cbrt(sqrt(x)) = x^{1/6}', () =>
    checkSimplify('\\sqrt[3]{\\sqrt{x}}', '\\sqrt[6]{x}'));
  test('sqrt(cbrt(x)) = x^{1/6}', () =>
    checkSimplify('\\sqrt{\\sqrt[3]{x}}', '\\sqrt[6]{x}'));
  test('root3(root4(x)) = x^{1/12}', () =>
    checkSimplify('\\sqrt[3]{\\sqrt[4]{x}}', '\\sqrt[12]{x}'));
  test('root4(root4(x)) = x^{1/16}', () =>
    checkSimplify('\\sqrt[4]{\\sqrt[4]{x}}', '\\sqrt[16]{x}'));
});

describe('Rules: Double Powers', () => {
  test('(x^{-2})^2 = x^{-4}', () =>
    checkSimplify('(x^{-2})^2', 'x^{-4}'));
  test('(x^{sqrt(2)})^3 = x^{3sqrt(2)}', () =>
    checkSimplify('(x^{\\sqrt{2}})^3', 'x^{3\\sqrt{2}}'));
});

describe('Rules: Multiplying Powers With the Same Base', () => {
  test('e*e^x*e^{-x} = e', () =>
    checkSimplify('e*e^x*e^{-x}', 'e'));
  test('e*(e^x*e^{-x}) = e', () =>
    checkSimplify('e*(e^x*e^{-x})', 'e'));
  test('e^x*e^{-x} = 1', () => checkSimplify('e^x e^{-x}', 1));
  test('e*e^x = e^{x+1}', () =>
    checkSimplify('e*e^x', 'e^{x+1}'));
});

describe('Rules: Negative Signs and Multiplication and Division', () => {
  test('x/(-2) = -x/2', () => checkSimplify('x/(-2)', '-1/2*x'));
});

describe('Rules: Negative Signs and Powers and Roots', () => {
  test('(-x)^3 = -(x^3)', () => checkSimplify('(-x)^3', '-(x^3)'));
  test('(-x)^{4/3} = x^{4/3}', () =>
    checkSimplify('(-x)^{4/3}', 'x^{4/3}'));
  test('(-x)^4 = x^4', () => checkSimplify('(-x)^4', 'x^4'));
  test('(-x)^{3/5} = -(x^{3/5})', () =>
    checkSimplify('(-x)^{3/5}', '-(x^{3/5})'));
  test('(-x)^{3/4} = x^{3/4}', () =>
    checkSimplify('(-x)^{3/4}', 'x^{3/4}'));
  test('cbrt(-2) = -cbrt(2)', () =>
    checkSimplify('\\sqrt[3]{-2}', '-\\sqrt[3]{2}'));
});

describe('Rules: Negative Exponents and Denominator', () => {
  test('(3/x)^{-1} = x/3', () =>
    checkSimplify('(3/x)^{-1}', 'x/3'));
  test('(3/pi)^{-1} = pi/3', () =>
    checkSimplify('(3/\\pi)^{-1}', '\\pi/3'));
  test('(x/pi)^{-3} = pi^3/x^3', () =>
    checkSimplify('(x/\\pi)^{-3}', '\\pi^3 / x^3'));
  test('(pi/e)^{-1} = e/pi', () =>
    checkSimplify('(\\pi/e)^{-1}', 'e/\\pi'));
  test('(x^2/pi^3)^{-2} = pi^6/x^4', () =>
    checkSimplify('(x^2/\\pi^3)^{-2}', '\\pi^6/x^4'));
});

describe('Rules: Powers: Multiplication (float exponents)', () => {
  test('pi^{-0.4}*pi^{0.2} = pi^{-0.2}', () =>
    checkSimplify('\\pi^{-0.4}*\\pi^{0.2}', '\\pi^{-0.2}'));
  test('pi^{-0.4}/pi^{0.2} = pi^{-0.6}', () =>
    checkSimplify('\\pi^{-0.4}/\\pi^{0.2}', '\\pi^{-0.6}'));
  test('pi^{-0.2}*pi = pi^{0.8}', () =>
    checkSimplify('\\pi^{-0.2}*\\pi', '\\pi^{0.8}'));
  test('pi^{-0.2}/pi = pi^{-1.2}', () =>
    checkSimplify('\\pi^{-0.2}/\\pi', '\\pi^{-1.2}'));
  test('pi/pi^{-0.2} = pi^{1.2}', () =>
    checkSimplify('\\pi/\\pi^{-0.2}', '\\pi^{1.2}'));
});

describe('Rules: Powers and Denominators', () => {
  test('x/(pi/y)^3 = x*y^3/pi^3', () =>
    checkSimplify('x/(\\pi/y)^3', 'x*y^3/\\pi^3'));
});

describe('Rules: Powers: Division (misc)', () => {
  test('pi^{0.2}/pi^{0.1} = pi^{0.1}', () =>
    checkSimplify('\\pi^{0.2}/\\pi^{0.1}', '\\pi^{0.1}'));
  test('x^{sqrt(2)}/x^3 = x^{sqrt(2)-3}', () =>
    checkSimplify('x^{\\sqrt{2}}/x^3', 'x^{\\sqrt{2}-3}'));
  test('x^{0.3}/x = 1/x^{0.7}', () =>
    checkSimplify('x^{0.3}/x', '1/x^{0.7}'));
});

describe('Rules: Powers and Roots', () => {
  test('root4(16b^4) = 2|b|', () =>
    checkSimplify('\\sqrt[4]{16b^{4}}', '2|b|'));
  test('sqrt(x^4) = x^2', () =>
    checkSimplify('\\sqrt{x^4}', 'x^2'));
  test('root4(x^6) = |x|^{3/2}', () =>
    checkSimplify('\\sqrt[4]{x^6}', ['Power', ['Abs', 'x'], ['Rational', 3, 2]]));
  test('sqrt(x^6) = |x|^3', () =>
    checkSimplify('\\sqrt{x^6}', '|x|^3'));
  test('root4(x^4) = |x|', () =>
    checkSimplify('\\sqrt[4]{x^4}', '|x|'));
});

describe('Rules: Common Denominator', () => {
  test('3/x-1/x = 2/x', () => checkSimplify('3/x-1/x', '2/x'));
  test.todo('1/(x+1)-1/x = -1/(x^2+x) -- common denominator for rational expressions not yet implemented');
  test.todo('1/x-1/(x+1) = 1/(x^2+x) -- common denominator for rational expressions not yet implemented');
});

describe('Rules: Distribute', () => {
  test('(x+1)^2-x^2 = 2x+1', () =>
    checkSimplify('(x+1)^2-x^2', '2x+1'));
  test('2*(x+h)^2-2*x^2 = 4xh+2h^2', () =>
    checkSimplify('2*(x+h)^2-2*x^2', '4xh+2h^2'));
});

describe('Rules: Ln', () => {
  test('ln(x^3)-3ln(x) = 0', () =>
    checkSimplify('\\ln(x^3)-3\\ln(x)', '0'));
  test('ln(x^sqrt(2)) = sqrt(2)*ln(x)', () =>
    checkSimplify('\\ln(x^\\sqrt{2})', '\\sqrt{2} \\ln(x)'));
  test('ln(x^{2/3})-4/3*ln(x) = -2/3*ln(x)', () =>
    checkSimplify(
      '\\ln(x^{2/3})-\\frac{4}{3}\\ln(x)',
      '\\frac{-2}{3}\\ln(x)'
    ));
  test('ln(pi^{2/3})-1/3*ln(pi) = 1/3*ln(pi)', () =>
    checkSimplify(
      '\\ln(\\pi^{2/3})-\\frac{1}{3}\\ln(\\pi)',
      '\\frac{1}{3}\\ln(\\pi)'
    ));
  test('ln(sqrt(x))-ln(x)/2 = 0', () =>
    checkSimplify('\\ln(\\sqrt{x})-\\ln(x)/2', '0'));
  test('ln(3)+ln(1/3) = 0', () =>
    checkSimplify('\\ln(3)+\\ln(\\frac{1}{3})', 0));
  test('ln(xy)-ln(x) = ln(y)', () =>
    checkSimplify('\\ln(xy)-\\ln(x)', '\\ln(y)'));
  test('ln(y/x)+ln(x) = ln(y)', () =>
    checkSimplify('\\ln(y/x)+\\ln(x)', '\\ln(y)'));
  test('e^{ln(x)+x} = x*e^x', () =>
    checkSimplify('e^{\\ln(x)+x}', 'x*e^x'));
  test('e^{ln(x)-2x} = x*e^{-2x}', () =>
    checkSimplify('e^{\\ln(x)-2x}', 'x*e^{-2x}'));
  test('e^{ln(x)-y^2} = x*exp(-y^2)', () =>
    checkSimplify('e^{\\ln(x)-y^2}', 'x\\exp(-y^2)'));
  test('e^{ln(x)-2*x} = x*e^{-2*x}', () =>
    checkSimplify('e^{\\ln(x)-2*x}', 'x*e^{-2*x}'));
  test('e^ln(x) = x', () => checkSimplify('e^\\ln(x)', 'x'));
  test('e^{3ln(x)} = x^3', () =>
    checkSimplify('e^{3\\ln(x)}', 'x^3'));
  test('e^{ln(x)/3} = x^{1/3}', () =>
    checkSimplify('e^{\\ln(x)/3}', 'x^{1/3}'));
  test('ln(e^x*y) = x+ln(y)', () =>
    checkSimplify('\\ln(e^x*y)', 'x+\\ln(y)'));
  test.todo('ln((x+1)/e^{2x}) = ln(x+1)-2x -- canonicalization expands (x+1)/e^{2x} before log rules can fire');
});

describe('Rules: Log', () => {
  test('log_c(x^2) = 2*log_c(|x|)', () =>
    checkSimplify('\\log_c(x^2)', '2\\log_c(|x|)'));
  test('log_{1/2}(x) = -log_2(x)', () =>
    checkSimplify('\\log_{1/2}(x)', '-\\log_2(x)'));
  test('log_4(x^3) = 3*log_4(x)', () =>
    checkSimplify('\\log_4(x^3)', '3\\log_4(x)'));
  test('log_3(x^sqrt(2)) = sqrt(2)*log_3(x)', () =>
    checkSimplify(
      '\\log_3(x^\\sqrt{2})',
      '\\sqrt{2} \\log_3(x)'
    ));
  test('log_4(x^2) = 2*log_4(|x|)', () =>
    checkSimplify('\\log_4(x^2)', '2\\log_4(|x|)'));
  test('log_4(x^{2/3}) = 2/3*log_4(|x|)', () =>
    checkSimplify('\\log_4(x^{2/3})', '\\frac{2}{3}\\log_4(|x|)'));
  test('log_4(x^{7/4}) = 7/4*log_4(x)', () =>
    checkSimplify('\\log_4(x^{7/4})', '\\frac{7}{4}\\log_4(x)'));
  test('log_{1/2}(0) = infinity', () =>
    checkSimplify('\\log_{1/2}(0)', '\\infty'));
  test('log_c(xy)-log_c(x) = log_c(y)', () =>
    checkSimplify('\\log_c(xy)-\\log_c(x)', '\\log_c(y)'));
  test('log_c(y/x)+log_c(x) = log(y,c)', () =>
    checkSimplify(
      '\\log_c(y/x)+\\log_c(x)',
      '\\log(y, c)'
    ));
  test('c^{log_c(x)+x} = x*c^x', () =>
    checkSimplify('c^{\\log_c(x)+x}', 'x c^x'));
  test('c^{log_c(x)-2*x} = x*c^{-2x}', () =>
    checkSimplify(
      'c^{\\log_c(x)-2*x}',
      'x c^{-2*x}'
    ));
  test('c^log_c(x) = x', () =>
    checkSimplify('c^\\log_c(x)', 'x'));
  test('c^{3*log_c(x)} = x^3', () =>
    checkSimplify('c^{3\\log_c(x)}', 'x^3'));
  test('c^{log_c(x)/3} = x^{1/3}', () =>
    checkSimplify('c^{\\log_c(x)/3}', 'x^{1/3}'));
  test('log_c(c^x*y) = x+log_c(y)', () =>
    checkSimplify('\\log_c(c^x*y)', 'x+\\log_c(y)'));
  test('log_c(c^x/y) = x-log_c(y)', () =>
    checkSimplify('\\log_c(c^x/y)', 'x-\\log_c(y)'));
  test('log_c(y/c^x) = log_c(y)-x', () =>
    checkSimplify('\\log_c(y/c^x)', '\\log_c(y)-x'));
  test('log_c(c) = 1', () => checkSimplify('\\log_c(c)', 1));
  test('log_c(c^x) = x', () => checkSimplify('\\log_c(c^x)', 'x'));
  test('log_c(0) = NaN', () => checkSimplify('\\log_c(0)', NaN));
  test('log_1(3) = NaN', () =>
    checkSimplify('\\log_1(3)', '\\operatorname{NaN}'));
  test('log_2(x)-log_2(xy) = -log_2(y)', () =>
    checkSimplify('\\log_2(x)-\\log_2(xy)', '-\\log_2(y)'));
  test('3^{log_3(x)+2} = 9x', () =>
    checkSimplify('3^{\\log_3(x)+2}', '9x'));
});

describe('Rules: Change of Base', () => {
  test('log_c(a)/log_c(b) = ln(a)/ln(b)', () =>
    checkSimplify(
      '\\log_c(a)/\\log_c(b)',
      '\\ln(a)/\\ln(b)'
    ));
  test('log_c(a)/ln(a) = 1/ln(c)', () =>
    checkSimplify('\\log_c(a)/\\ln(a)', '1/\\ln(c)'));
  test('ln(a)/log_c(a) = ln(c)', () =>
    checkSimplify('\\ln(a)/\\log_c(a)', '\\ln(c)'));
});

describe('Rules: Absolute Value', () => {
  test('|x/pi| = |x|/pi', () =>
    checkSimplify('|\\frac{x}{\\pi}|', '\\frac{|x|}{\\pi}'));
  test('|2/x| = 2/|x|', () =>
    checkSimplify('|\\frac{2}{x}|', '\\frac{2}{|x|}'));
  test('|x|^{4/3} = x^{4/3}', () =>
    checkSimplify('|x|^{4/3}', 'x^{4/3}'));
  test('|xy|-|x|*|y| = 0', () =>
    checkSimplify('|xy|-|x|*|y|', '0'));
  test('||x|+1| = |x|+1', () =>
    checkSimplify('||x|+1|', '|x|+1'));
  test('| |x| | = |x|', () => checkSimplify('| |x| |', '|x|'));
  test('|2/x|-1/|x| = 1/|x|', () =>
    checkSimplify('|2/x|-1/|x|', '1/|x|'));
  test('|1/x|-1/|x| = 0', () =>
    checkSimplify('|1/x|-1/|x|', '0'));
  test('|x||y|-|xy| = 0', () =>
    checkSimplify('|x||y|-|xy|', '0'));
  test('|-x| = |x|', () => checkSimplify('|-x|', '|x|'));
  test('|pi*x| = pi*|x|', () =>
    checkSimplify('|\\pi * x|', '\\pi * |x|'));
  test('|-pi*x| = pi*|x|', () =>
    checkSimplify('|-\\pi * x|', '\\pi * |x|'));
  test('|x|^4 = x^4', () => checkSimplify('|x|^4', 'x^4'));
  test('|x^2| = x^2', () => checkSimplify('|x^2|', 'x^2'));
  test('|x^3| = |x|^3', () => checkSimplify('|x^3|', '|x|^3'));
  test('|x^{3/5}| = |x|^{3/5}', () =>
    checkSimplify('|x^{3/5}|', '|x|^{3/5}'));
  test('|x^{2/3}| = x^{2/3}', () =>
    checkSimplify('|x^{2/3}|', 'x^{2/3}'));
  test('|x^{4/5}| = x^{4/5}', () =>
    checkSimplify('|x^{4/5}|', 'x^{4/5}'));
  test('|-|-x|| = |x|', () => checkSimplify('|-|-x||', '|x|'));
});

describe('Rules: Even Functions and Absolute Value', () => {
  test('cos(|x+2|) = cos(x+2)', () =>
    checkSimplify('\\cos(|x+2|)', '\\cos(x+2)'));
  test('sec(|x+2|) = sec(x+2)', () =>
    checkSimplify('\\sec(|x+2|)', '\\sec(x+2)'));
  test('cosh(|x+2|) = cosh(x+2)', () =>
    checkSimplify('\\cosh(|x+2|)', '\\cosh(x+2)'));
  test('sech(|x+2|) = sech(x+2)', () =>
    checkSimplify('\\sech(|x+2|)', '\\sech(x+2)'));
});

describe('Rules: Odd Functions and Absolute Value', () => {
  test('|sin(x)| = sin(|x|)', () =>
    checkSimplify('|\\sin(x)|', '\\sin(|x|)'));
  test('|tan(x)| = tan(|x|)', () =>
    checkSimplify('|\\tan(x)|', '\\tan(|x|)'));
  test('|cot(x)| = cot(|x|)', () =>
    checkSimplify('|\\cot(x)|', '\\cot(|x|)'));
  test('|csc(x)| = csc(|x|)', () =>
    checkSimplify('|\\csc(x)|', '\\csc(|x|)'));
  test('|arcsin(x)| = arcsin(|x|)', () =>
    checkSimplify('|\\arcsin(x)|', '\\arcsin(|x|)'));
  test('|arctan(x)| = arctan(|x|)', () =>
    checkSimplify('|\\arctan(x)|', '\\arctan(|x|)'));
  test('|arcctg(x)| = arcctg(|x|)', () =>
    checkSimplify('|\\arcctg(x)|', '\\arcctg(|x|)'));
  test('|arccsc(x)| = arccsc(|x|)', () =>
    checkSimplify('|\\arccsc(x)|', '\\arccsc(|x|)'));
  test('|sinh(x)| = sinh(|x|)', () =>
    checkSimplify('|\\sinh(x)|', '\\sinh(|x|)'));
  test('|tanh(x)| = tanh(|x|)', () =>
    checkSimplify('|\\tanh(x)|', '\\tanh(|x|)'));
  test('|coth(x)| = coth(|x|)', () =>
    checkSimplify('|\\coth(x)|', '\\coth(|x|)'));
  test('|csch(x)| = csch(|x|)', () =>
    checkSimplify('|\\csch(x)|', '\\csch(|x|)'));
  test('|arsinh(x)| = arsinh(|x|)', () =>
    checkSimplify('|\\arsinh(x)|', '\\arsinh(|x|)'));
  test('|artanh(x)| = artanh(|x|)', () =>
    checkSimplify('|\\artanh(x)|', '\\artanh(|x|)'));
  test('|arccoth(x)| = arccoth(|x|)', () =>
    checkSimplify(
      '|\\operatorname{arccoth}(x)|',
      '\\operatorname{arccoth}(|x|)'
    ));
  test('|arcsch(x)| = arcsch(|x|)', () =>
    checkSimplify('|\\arcsch(x)|', '\\arcsch(|x|)'));
});

describe('Rules: Powers and Infinity', () => {
  test('pi^infinity = infinity', () =>
    checkSimplify('\\pi^\\infty', '\\infty'));
  test('e^infinity = infinity', () =>
    checkSimplify('e^\\infty', '\\infty'));
  test('pi^{-infinity} = 0', () =>
    checkSimplify('\\pi^{-\\infty}', 0));
  test('e^{-infinity} = 0', () => checkSimplify('e^{-\\infty}', 0));
  test('(1/2)^{-infinity} = infinity', () =>
    checkSimplify('(1/2)^{-\\infty}', '\\infty'));
  test('(-infinity)^4 = infinity', () =>
    checkSimplify('(-\\infty)^4', '\\infty'));
  test('infinity^4 = infinity', () =>
    checkSimplify('\\infty^4', '\\infty'));
  test('(-infinity)^{1/3} = -infinity', () =>
    checkSimplify('(-\\infty)^{1/3}', '-\\infty'));
  test('infinity^{1/3} = infinity', () =>
    checkSimplify('\\infty^{1/3}', '\\infty'));
  test('1^{-infinity} = NaN', () =>
    checkSimplify('1^{-\\infty}', NaN));
  test('1^{infinity} = NaN', () =>
    checkSimplify('1^{\\infty}', NaN));
  test('infinity^0 = NaN', () =>
    checkSimplify('\\infty^0', NaN));
  test('infinity^{-3} = 0', () =>
    checkSimplify('\\infty^{-3}', '0'));
  test('(-infinity)^{-5} = 0', () =>
    checkSimplify('(-\\infty)^{-5}', '0'));
  test('infinity^{1.4} = infinity', () =>
    checkSimplify('(\\infty)^{1.4}', '\\infty'));
  test('infinity^{-2} = 0', () =>
    checkSimplify('(\\infty)^{-2}', 0));
});

describe('Rules: Logs and Infinity', () => {
  test('log_infinity(infinity) = NaN', () =>
    checkSimplify('\\log_\\infty(\\infty)', NaN));
  // Note: this test case has a parse error in original (mismatched braces)
  // '\\log_{1/5}(\\infty}' — skipping
  test('log_{0.5}(infinity) = -infinity', () =>
    checkSimplify('\\log_{0.5}(\\infty)', '-\\infty'));
});

describe('Rules: Roots and Infinity', () => {
  test('cbrt(infinity) = infinity', () =>
    checkSimplify('\\sqrt[3]{\\infty}', '\\infty'));
});

describe('Rules: Multiplication and Infinity', () => {
  test('0*infinity = NaN', () =>
    checkSimplify('0*\\infty', NaN));
  test('0*(-infinity) = NaN', () =>
    checkSimplify('0*(-\\infty)', NaN));
  test('(-0.5)*infinity = -infinity', () =>
    checkSimplify('(-0.5)*\\infty', '-\\infty'));
});

describe('Rules: Division and Infinity', () => {
  test('infinity/infinity = NaN', () =>
    checkSimplify('\\infty/\\infty', '\\operatorname{NaN}'));
  test('(-infinity)/(1-3) = infinity', () =>
    checkSimplify('(-\\infty)/(1-3)', '\\infty'));
  test('infinity/2 = infinity', () =>
    checkSimplify('\\infty/2', '\\infty'));
  test('infinity/(-2) = -infinity', () =>
    checkSimplify('\\infty/(-2)', '-\\infty'));
  test('(-infinity)/2 = -infinity', () =>
    checkSimplify('(-\\infty)/2', '-\\infty'));
  test('(-infinity)/(-2) = infinity', () =>
    checkSimplify('(-\\infty)/(-2)', '\\infty'));
  test('(-infinity)/infinity = NaN', () =>
    checkSimplify('(-\\infty)/\\infty', NaN));
  test('infinity/0.5 = infinity', () =>
    checkSimplify('\\infty/0.5', '\\infty'));
  test('infinity/0 = complex infinity', () =>
    checkSimplify('\\infty/0', '\\tilde\\infty'));
  test('(-infinity)/1.7 = -infinity', () =>
    checkSimplify('(-\\infty)/1.7', '-\\infty'));
});

describe('Rules: Trig and Infinity', () => {
  test('sin(infinity) = NaN', () =>
    checkSimplify('\\sin(\\infty)', NaN));
  test('cos(infinity) = NaN', () =>
    checkSimplify('\\cos(\\infty)', NaN));
  test('tan(infinity) = NaN', () =>
    checkSimplify('\\tan(\\infty)', NaN));
  test('cot(infinity) = NaN', () =>
    checkSimplify('\\cot(\\infty)', NaN));
  test('sec(infinity) = NaN', () =>
    checkSimplify('\\sec(\\infty)', NaN));
  test('csc(infinity) = NaN', () =>
    checkSimplify('\\csc(\\infty)', NaN));
  test('sin(-infinity) = NaN', () =>
    checkSimplify('\\sin(-\\infty)', NaN));
  test('cos(-infinity) = NaN', () =>
    checkSimplify('\\cos(-\\infty)', NaN));
  test('tan(-infinity) = NaN', () =>
    checkSimplify('\\tan(-\\infty)', NaN));
  test('cot(-infinity) = NaN', () =>
    checkSimplify('\\cot(-\\infty)', NaN));
  test('sec(-infinity) = NaN', () =>
    checkSimplify('\\sec(-\\infty)', NaN));
  test('csc(-infinity) = NaN', () =>
    checkSimplify('\\csc(-\\infty)', NaN));
});

describe('Rules: Inverse Trig and Infinity', () => {
  test('arcsin(infinity) = NaN', () =>
    checkSimplify('\\arcsin(\\infty)', NaN));
  test('arccos(infinity) = NaN', () =>
    checkSimplify('\\arccos(\\infty)', NaN));
  test('arcsin(-infinity) = NaN', () =>
    checkSimplify('\\arcsin(-\\infty)', NaN));
  test('arccos(-infinity) = NaN', () =>
    checkSimplify('\\arccos(-\\infty)', NaN));
  test('arctan(infinity) = pi/2', () =>
    checkSimplify('\\arctan(\\infty)', '\\frac{\\pi}{2}'));
  test('arctan(-infinity) = -pi/2', () =>
    checkSimplify('\\arctan(-\\infty)', '\\frac{-\\pi}{2}'));
  test('arcctg(infinity) = 0', () =>
    checkSimplify('\\arcctg(\\infty)', 0));
  test('arcctg(-infinity) = pi', () =>
    checkSimplify('\\arcctg(-\\infty)', '\\pi'));
  test('arcsec(infinity) = pi/2', () =>
    checkSimplify('\\arcsec(\\infty)', '\\frac{\\pi}{2}'));
  test('arcsec(-infinity) = pi/2', () =>
    checkSimplify('\\arcsec(-\\infty)', '\\frac{\\pi}{2}'));
  test('arccsc(infinity) = 0', () =>
    checkSimplify('\\arccsc(\\infty)', 0));
  test('arccsc(-infinity) = 0', () =>
    checkSimplify('\\arccsc(-\\infty)', 0));
});

describe('Rules: Hyperbolic Trig and Infinity', () => {
  test('sinh(infinity) = infinity', () =>
    checkSimplify('\\sinh(\\infty)', '\\infty'));
  test('sinh(-infinity) = -infinity', () =>
    checkSimplify('\\sinh(-\\infty)', '-\\infty'));
  test('cosh(infinity) = infinity', () =>
    checkSimplify('\\cosh(\\infty)', '\\infty'));
  test('cosh(-infinity) = infinity', () =>
    checkSimplify('\\cosh(-\\infty)', '\\infty'));
  test('tanh(infinity) = 1', () =>
    checkSimplify('\\tanh(\\infty)', 1));
  test('tanh(-infinity) = -1', () =>
    checkSimplify('\\tanh(-\\infty)', -1));
  test('coth(infinity) = 1', () =>
    checkSimplify('\\coth(\\infty)', 1));
  test('coth(-infinity) = -1', () =>
    checkSimplify('\\coth(-\\infty)', -1));
  test('sech(infinity) = 0', () =>
    checkSimplify('\\sech(\\infty)', 0));
  test('sech(-infinity) = 0', () =>
    checkSimplify('\\sech(-\\infty)', 0));
  test('csch(infinity) = 0', () =>
    checkSimplify('\\csch(\\infty)', 0));
  test('csch(-infinity) = 0', () =>
    checkSimplify('\\csch(-\\infty)', 0));
});

describe('Rules: Inverse Hyperbolic Trig and Infinity', () => {
  test('arsinh(-infinity) = -infinity', () =>
    checkSimplify('\\arsinh(-\\infty)', '-\\infty'));
  test('artanh(infinity) = NaN', () =>
    checkSimplify('\\artanh(\\infty)', NaN));
  test('artanh(-infinity) = NaN', () =>
    checkSimplify('\\artanh(-\\infty)', NaN));
  test('arccoth(infinity) = 0', () =>
    checkSimplify('\\operatorname{arccoth}(\\infty)', 0));
  test('arccoth(-infinity) = 0', () =>
    checkSimplify('\\operatorname{arccoth}(-\\infty)', 0));
  test('arsech(infinity) = NaN', () =>
    checkSimplify('\\arsech(\\infty)', NaN));
  test('arsech(-infinity) = NaN', () =>
    checkSimplify('\\arsech(-\\infty)', NaN));
  test('arcsch(infinity) = 0', () =>
    checkSimplify('\\arcsch(\\infty)', 0));
  test('arcsch(-infinity) = 0', () =>
    checkSimplify('\\arcsch(-\\infty)', 0));
});

describe('Rules: Hyperbolic Trig (arccoth repeat)', () => {
  test('|arccoth(x)| = arccoth(|x|)', () =>
    checkSimplify(
      '|\\operatorname{arccoth}(x)|',
      '\\operatorname{arccoth}(|x|)'
    ));
});

describe('Rules: Trig identities', () => {
  test('sin(-x) = -sin(x)', () =>
    checkSimplify('\\sin(-x)', '-\\sin(x)'));
  test('cos(-x) = cos(x)', () =>
    checkSimplify('\\cos(-x)', '\\cos(x)'));
  test('tan(-x) = -tan(x)', () =>
    checkSimplify('\\tan(-x)', '-\\tan(x)'));
  test('csc(-x) = -csc(x)', () =>
    checkSimplify('\\csc(-x)', '-\\csc(x)'));
  test('sec(-x) = sec(x)', () =>
    checkSimplify('\\sec(-x)', '\\sec(x)'));
  test('cot(-x) = -cot(x)', () =>
    checkSimplify('\\cot(-x)', '-\\cot(x)'));
  test('sin(pi-x) = sin(x)', () =>
    checkSimplify('\\sin(\\pi - x)', '\\sin(x)'));
  test('cos(pi-x) = -cos(x)', () =>
    checkSimplify('\\cos(\\pi - x)', '-\\cos(x)'));
  test('tan(pi-x) = -tan(x)', () =>
    checkSimplify('\\tan(\\pi - x)', '-\\tan(x)'));
  test('cot(pi-x) = -cot(x)', () =>
    checkSimplify('\\cot(\\pi - x)', '-\\cot(x)'));
  test('sec(pi-x) = -sec(x)', () =>
    checkSimplify('\\sec(\\pi - x)', '-\\sec(x)'));
  test('csc(pi-x) = csc(x)', () =>
    checkSimplify('\\csc(\\pi - x)', '\\csc(x)'));
  test('sin(pi+x) = -sin(x)', () =>
    checkSimplify('\\sin(\\pi + x)', '-\\sin(x)'));
  test('cos(pi+x) = -cos(x)', () =>
    checkSimplify('\\cos(\\pi + x)', '-\\cos(x)'));
  test('tan(pi+x) = tan(x)', () =>
    checkSimplify('\\tan(\\pi + x)', '\\tan(x)'));
  test('cot(pi+x) = cot(x)', () =>
    checkSimplify('\\cot(\\pi + x)', '\\cot(x)'));
  test('sec(pi+x) = -sec(x)', () =>
    checkSimplify('\\sec(\\pi + x)', '-\\sec(x)'));
  test('csc(pi+x) = -csc(x)', () =>
    checkSimplify('\\csc(\\pi + x)', '-\\csc(x)'));
  test('sin(pi/2-x) = cos(x)', () =>
    checkSimplify('\\sin(\\frac{\\pi}{2} - x)', '\\cos(x)'));
  test('cos(pi/2-x) = sin(x)', () =>
    checkSimplify('\\cos(\\frac{\\pi}{2} - x)', '\\sin(x)'));
  test('tan(pi/2-x) = cot(x)', () =>
    checkSimplify('\\tan(\\frac{\\pi}{2} - x)', '\\cot(x)'));
  test('cot(pi/2-x) = tan(x)', () =>
    checkSimplify('\\cot(\\frac{\\pi}{2} - x)', '\\tan(x)'));
  test('sec(pi/2-x) = csc(x)', () =>
    checkSimplify('\\sec(\\frac{\\pi}{2} - x)', '\\csc(x)'));
  test('csc(pi/2-x) = sec(x)', () =>
    checkSimplify('\\csc(\\frac{\\pi}{2} - x)', '\\sec(x)'));
});

describe('Rules: Inverse Hyperbolic Trig identities', () => {
  test.todo('1/2*ln((x+1)/(x-1)) = arccoth(x) -- ln-to-inverse-hyperbolic rules not yet implemented');
  test.todo('ln(x+sqrt(x^2+1)) = arsinh(x) -- ln-to-inverse-hyperbolic rules not yet implemented');
  test.todo('ln(x+sqrt(x^2-1)) = arcosh(x) -- ln-to-inverse-hyperbolic rules not yet implemented');
  test.todo('1/2*ln((1+x)/(1-x)) = artanh(x) -- ln-to-inverse-hyperbolic rules not yet implemented');
  test.todo('ln((1+sqrt(1-x^2))/x) = arsech(x) -- ln-to-inverse-hyperbolic rules not yet implemented');
  test.todo('ln(1/x+sqrt(1/x^2+1)) = arcsch(x) -- ln-to-inverse-hyperbolic rules not yet implemented');
});

describe('Rules: Inverse Trig identities', () => {
  test.todo('arctan(x/sqrt(1-x^2)) = arcsin(x) -- inverse trig conversion rules not yet implemented');
});

// ============================================================
// EXISTING ACTIVE TESTS (preserved from original file)
// ============================================================

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

describe('POLYNOMIAL DIVISION REGRESSION', () => {
  test('Division with single variable should not stack overflow', () =>
    expect(simplify('\\frac{n}{\\pi}')).toMatchInlineSnapshot(
      `["Divide", "n", "Pi"]`
    ));

  test('Division with variable and constant denominator', () =>
    expect(simplify('\\frac{x}{5}')).toMatchInlineSnapshot(
      `["Multiply", ["Rational", 1, 5], "x"]`
    ));

  test('Cancel common polynomial factors (x-1)', () =>
    expect(simplify('\\frac{(x-1)(x+2)}{(x-1)(x+3)}')).toMatchInlineSnapshot(`
      [
        "Add",
        ["Divide", "x", ["Add", "x", 3]],
        ["Divide", 2, ["Add", "x", 3]]
      ]
    `));
});

describe('RELATIONAL OPERATORS', () => {
  test(`2a < 4b`, () =>
    expect(simplify('2a \\lt 4b')).toMatchInlineSnapshot(
      `["Less", "a", ["Multiply", 2, "b"]]`
    ));

  test(`2x^2 < 4x^3`, () =>
    expect(simplify('2x^2 \\lt 4x^3')).toMatchInlineSnapshot(
      `["Less", ["Square", "x"], ["Multiply", 2, ["Power", "x", 3]]]`
    ));

  test(`2a < 4ab`, () =>
    expect(simplify('2a < 4ab')).toMatchInlineSnapshot(
      `["Less", "a", ["Multiply", 2, "a", "b"]]`
    ));
});

describe('TRIGONOMETRIC PERIODICITY REDUCTION', () => {
  test('sin(5pi + k) = -sin(k)', () =>
    expect(simplify('\\sin(5\\pi + k)')).toMatchInlineSnapshot(
      `["Negate", ["Sin", "k"]]`
    ));

  test('sin(4pi + k) = sin(k)', () =>
    expect(simplify('\\sin(4\\pi + k)')).toMatchInlineSnapshot(`["Sin", "k"]`));

  test('sin(3pi + k) = -sin(k)', () =>
    expect(simplify('\\sin(3\\pi + k)')).toMatchInlineSnapshot(
      `["Negate", ["Sin", "k"]]`
    ));

  test('cos(5pi + k) = -cos(k)', () =>
    expect(simplify('\\cos(5\\pi + k)')).toMatchInlineSnapshot(
      `["Negate", ["Cos", "k"]]`
    ));

  test('cos(4pi + k) = cos(k)', () =>
    expect(simplify('\\cos(4\\pi + k)')).toMatchInlineSnapshot(`["Cos", "k"]`));

  test('cos(2pi + k) = cos(k)', () =>
    expect(simplify('\\cos(2\\pi + k)')).toMatchInlineSnapshot(`["Cos", "k"]`));

  test('tan(3pi + k) = tan(k)', () =>
    expect(simplify('\\tan(3\\pi + k)')).toMatchInlineSnapshot(`["Tan", "k"]`));

  test('tan(2pi + k) = tan(k)', () =>
    expect(simplify('\\tan(2\\pi + k)')).toMatchInlineSnapshot(`["Tan", "k"]`));

  test('tan(pi + k) = tan(k)', () =>
    expect(simplify('\\tan(\\pi + k)')).toMatchInlineSnapshot(`["Tan", "k"]`));

  test('cot(3pi + k) = cot(k)', () =>
    expect(simplify('\\cot(3\\pi + k)')).toMatchInlineSnapshot(`["Cot", "k"]`));

  test('sin(-3pi + k) = -sin(k)', () =>
    expect(simplify('\\sin(-3\\pi + k)')).toMatchInlineSnapshot(
      `["Negate", ["Sin", "k"]]`
    ));

  test('cos(-4pi + k) = cos(k)', () =>
    expect(simplify('\\cos(-4\\pi + k)')).toMatchInlineSnapshot(
      `["Cos", "k"]`
    ));
});

describe('PYTHAGOREAN IDENTITIES', () => {
  test('sin^2(x) + cos^2(x) = 1', () =>
    expect(simplify('\\sin(x)^2 + \\cos(x)^2')).toMatchInlineSnapshot(`1`));

  test('cos^2(x) + sin^2(x) = 1 (reversed order)', () =>
    expect(simplify('\\cos(x)^2 + \\sin(x)^2')).toMatchInlineSnapshot(`1`));

  test('sin^2(2x) + cos^2(2x) = 1 (complex argument)', () =>
    expect(simplify('\\sin(2x)^2 + \\cos(2x)^2')).toMatchInlineSnapshot(`1`));

  test('1 - sin^2(x) = cos^2(x)', () =>
    expect(simplify('1 - \\sin(x)^2')).toMatchInlineSnapshot(
      `["Square", ["Cos", "x"]]`
    ));

  test('1 - cos^2(x) = sin^2(x)', () =>
    expect(simplify('1 - \\cos(x)^2')).toMatchInlineSnapshot(
      `["Square", ["Sin", "x"]]`
    ));

  test('sin^2(x) - 1 = -cos^2(x)', () =>
    expect(simplify('\\sin(x)^2 - 1')).toMatchInlineSnapshot(
      `["Negate", ["Square", ["Cos", "x"]]]`
    ));

  test('cos^2(x) - 1 = -sin^2(x)', () =>
    expect(simplify('\\cos(x)^2 - 1')).toMatchInlineSnapshot(
      `["Negate", ["Square", ["Sin", "x"]]]`
    ));

  test('-sin^2(x) - cos^2(x) = -1', () =>
    expect(simplify('-\\sin(x)^2 - \\cos(x)^2')).toMatchInlineSnapshot(`-1`));

  test('tan^2(x) + 1 = sec^2(x)', () =>
    expect(simplify('\\tan(x)^2 + 1')).toMatchInlineSnapshot(
      `["Square", ["Sec", "x"]]`
    ));

  test('sec^2(x) - 1 = tan^2(x)', () =>
    expect(simplify('\\sec(x)^2 - 1')).toMatchInlineSnapshot(
      `["Square", ["Tan", "x"]]`
    ));

  test('1 + cot^2(x) = csc^2(x)', () =>
    expect(simplify('1 + \\cot(x)^2')).toMatchInlineSnapshot(
      `["Square", ["Csc", "x"]]`
    ));

  test('csc^2(x) - 1 = cot^2(x)', () =>
    expect(simplify('\\csc(x)^2 - 1')).toMatchInlineSnapshot(
      `["Square", ["Cot", "x"]]`
    ));

  test('a*sin^2(x) + a*cos^2(x) = a', () =>
    expect(simplify('a * \\sin(x)^2 + a * \\cos(x)^2')).toMatchInlineSnapshot(
      `a`
    ));
});

describe('NEGATIVE BASE POWER RULES', () => {
  test('(-x)^2 = x^2', () =>
    expect(simplify('(-x)^2')).toMatchInlineSnapshot(`["Square", "x"]`));

  test('(-x)^4 = x^4', () =>
    expect(simplify('(-x)^4')).toMatchInlineSnapshot(`["Power", "x", 4]`));

  test('(-x)^3 = -x^3', () =>
    expect(simplify('(-x)^3')).toMatchInlineSnapshot(
      `["Negate", ["Power", "x", 3]]`
    ));

  test('(-x)^5 = -x^5', () =>
    expect(simplify('(-x)^5')).toMatchInlineSnapshot(
      `["Negate", ["Power", "x", 5]]`
    ));

  test('(-x)^{4/3} = x^{4/3}', () =>
    expect(simplify('(-x)^{4/3}')).toMatchInlineSnapshot(
      `["Power", "x", ["Rational", 4, 3]]`
    ));

  test('(-x)^{3/5} = -x^{3/5}', () =>
    expect(simplify('(-x)^{3/5}')).toMatchInlineSnapshot(
      `["Negate", ["Power", "x", ["Rational", 3, 5]]]`
    ));
});

describe('POWER DISTRIBUTION GUARDS', () => {
  test('(x^{-2})^2 = x^{-4}', () =>
    expect(simplify('(x^{-2})^2')).toMatchInlineSnapshot(
      `["Divide", 1, ["Power", "x", 4]]`
    ));

  test('(x^{sqrt(2)})^3 = x^{3sqrt(2)}', () =>
    expect(simplify('(x^{\\sqrt{2}})^3')).toMatchInlineSnapshot(
      `["Power", "x", ["Multiply", 3, ["Sqrt", 2]]]`
    ));

  test('(3/x)^{-1} = x/3', () =>
    expect(simplify('(3/x)^{-1}')).toMatchInlineSnapshot(
      `["Multiply", ["Rational", 1, 3], "x"]`
    ));

  test('(3/pi)^{-1} = pi/3', () =>
    expect(simplify('(3/\\pi)^{-1}')).toMatchInlineSnapshot(
      `["Multiply", ["Rational", 1, 3], "Pi"]`
    ));

  test('(x/pi)^{-3} = pi^3/x^3', () =>
    expect(simplify('(x/\\pi)^{-3}')).toMatchInlineSnapshot(
      `["Divide", ["Power", "Pi", 3], ["Power", "x", 3]]`
    ));

  test('(-x)^{0.5} stays as Sqrt(-x)', () =>
    expect(simplify('(-x)^{0.5}')).toMatchInlineSnapshot(
      `["Sqrt", ["Negate", "x"]]`
    ));

  test('(2*3)^{1/2} stays as Sqrt(6)', () =>
    expect(simplify('(2 \\cdot 3)^{1/2}')).toMatchInlineSnapshot(
      `["Sqrt", 6]`
    ));

  test('(a*b)^2 = a^2 * b^2', () =>
    expect(simplify('(a \\cdot b)^2')).toMatchInlineSnapshot(
      `["Multiply", ["Square", "a"], ["Square", "b"]]`
    ));

  test('(pi/e)^{-1} = e/pi', () =>
    expect(simplify('(\\pi/e)^{-1}')).toMatchInlineSnapshot(
      `["Divide", "ExponentialE", "Pi"]`
    ));

  test('(x^2/pi^3)^{-2} = pi^6/x^4', () =>
    expect(simplify('(x^2/\\pi^3)^{-2}')).toMatchInlineSnapshot(
      `["Divide", ["Power", "Pi", 6], ["Power", "x", 4]]`
    ));

  test('x/(pi/y)^3 distributes', () =>
    expect(simplify('x/(\\pi/y)^3')).toMatchInlineSnapshot(
      `["Divide", ["Multiply", "x", ["Power", "y", 3]], ["Power", "Pi", 3]]`
    ));
});

describe('SQRT AND ROOT POWER SIMPLIFICATION', () => {
  test('sqrt(x^4) = x^2', () =>
    expect(simplify('\\sqrt{x^4}')).toMatchInlineSnapshot(
      `["Square", "x"]`
    ));

  test('sqrt(x^6) = |x|^3', () =>
    expect(simplify('\\sqrt{x^6}')).toMatchInlineSnapshot(
      `["Power", ["Abs", "x"], 3]`
    ));

  test('root4(x^4) = |x|', () =>
    expect(simplify('\\sqrt[4]{x^4}')).toMatchInlineSnapshot(
      `["Abs", "x"]`
    ));

  test('(sqrt(x))^3 with unknown sign stays as-is', () =>
    expect(simplify('(\\sqrt{x})^3')).toMatchInlineSnapshot(
      `["Power", ["Sqrt", "x"], 3]`
    ));

  test('(sqrt(x))^4 = x^2', () =>
    expect(simplify('(\\sqrt{x})^4')).toMatchInlineSnapshot(
      `["Square", "x"]`
    ));
});

describe('LOGARITHM COMBINATION RULES', () => {
  test('ln(x) + ln(y) = ln(xy)', () =>
    expect(simplify('\\ln(x) + \\ln(y)')).toMatchInlineSnapshot(
      `["Ln", ["Multiply", "x", "y"]]`
    ));

  test('ln(a) + ln(b) + ln(c) = ln(abc)', () =>
    expect(simplify('\\ln(a) + \\ln(b) + \\ln(c)')).toMatchInlineSnapshot(
      `["Ln", ["Multiply", "a", "b", "c"]]`
    ));

  test('ln(x) - ln(y) = ln(x/y)', () =>
    expect(simplify('\\ln(x) - \\ln(y)')).toMatchInlineSnapshot(
      `["Ln", ["Divide", "x", "y"]]`
    ));

  test('ln(xy) - ln(x) = ln(y)', () =>
    expect(simplify('\\ln(xy) - \\ln(x)')).toMatchInlineSnapshot(
      `["Ln", "y"]`
    ));

  test('ln(y/x) + ln(x) = ln(y)', () =>
    expect(simplify('\\ln(y/x) + \\ln(x)')).toMatchInlineSnapshot(
      `["Ln", "y"]`
    ));

  test('ln(a) + ln(b) - ln(c) = ln(ab/c)', () =>
    expect(simplify('\\ln(a) + \\ln(b) - \\ln(c)')).toMatchInlineSnapshot(
      `["Ln", ["Divide", ["Multiply", "a", "b"], "c"]]`
    ));

  test('log_2(x) + log_2(y) = log_2(xy)', () =>
    expect(simplify('\\log_2(x) + \\log_2(y)')).toMatchInlineSnapshot(
      `["Log", ["Multiply", "x", "y"], 2]`
    ));

  test('log_2(x) - log_2(y) = log_2(x/y)', () =>
    expect(simplify('\\log_2(x) - \\log_2(y)')).toMatchInlineSnapshot(
      `["Log", ["Divide", "x", "y"], 2]`
    ));

  test('log_c(xy) - log_c(x) = log_c(y)', () =>
    expect(simplify('\\log_c(xy) - \\log_c(x)')).toMatchInlineSnapshot(
      `["Log", "y", "c"]`
    ));

  test('ln(x) + ln(y) + z = z + ln(xy)', () =>
    expect(simplify('\\ln(x) + \\ln(y) + z')).toMatchInlineSnapshot(
      `["Add", "z", ["Ln", ["Multiply", "x", "y"]]]`
    ));
});

describe('INDETERMINATE FORMS', () => {
  test('0 * infinity = NaN', () =>
    expect(simplify('0 \\times \\infty')).toMatchInlineSnapshot(`NaN`));

  test('0 * (-infinity) = NaN', () =>
    expect(simplify('0 \\times (-\\infty)')).toMatchInlineSnapshot(`NaN`));

  test('infinity * 0 = NaN', () =>
    expect(simplify('\\infty \\times 0')).toMatchInlineSnapshot(`NaN`));

  test('(-infinity) * 0 = NaN', () =>
    expect(simplify('(-\\infty) \\times 0')).toMatchInlineSnapshot(`NaN`));

  test('infinity / infinity = NaN', () =>
    expect(simplify('\\frac{\\infty}{\\infty}')).toMatchInlineSnapshot(`NaN`));

  test('(-infinity) / infinity = NaN', () =>
    expect(simplify('\\frac{-\\infty}{\\infty}')).toMatchInlineSnapshot(`NaN`));

  test('infinity / (-infinity) = NaN', () =>
    expect(simplify('\\frac{\\infty}{-\\infty}')).toMatchInlineSnapshot(`NaN`));

  test('(-infinity) / (-infinity) = NaN', () =>
    expect(simplify('\\frac{-\\infty}{-\\infty}')).toMatchInlineSnapshot(
      `NaN`
    ));

  test('infinity^0 = NaN', () =>
    expect(simplify('\\infty^0')).toMatchInlineSnapshot(`NaN`));
});

//
// Fu Algorithm Advanced Tests
//
const fuTestHelper = (a: string, b: string) => {
  const simplified = ce.parse(a).simplify({ strategy: 'fu' });
  expect(simplified.isSame(ce.parse(b))).toBe(true);
};

describe('Fu Advanced Tests', () => {
  test('2sin(x)cos(x)-sin(2x) [Phase 12: post-Fu arithmetic]', () => {
    fuTestHelper('2\\sin(x)\\cos(x)-\\sin(2x)', '0');
  });

  test('sin^2(x)+cos^2(x)+2x [Phase 11: Pythagorean in compounds]', () => {
    fuTestHelper('\\sin^2(x)+\\cos^2(x)+2x', '1+2x');
  });

  test('sec^2(x)-1 [Phase 10: TR22i inverse Pythagorean]', () => {
    fuTestHelper('\\sec^2(x)-1', '\\tan^2(x)');
  });

  test('cot^2(x)-csc^2(x) [Phase 10: TR22i inverse Pythagorean]', () => {
    fuTestHelper('\\cot^2(x)-\\csc^2(x)', '-1');
  });

  test('2-2sin^2(x) [Phase 11: Pythagorean with coefficients]', () => {
    fuTestHelper('2-2\\sin^2(x)', '2\\cos^2(x)');
  });

  test('cos(-x)+cos(x) [Phase 6: TR3 angle canonicalization]', () => {
    fuTestHelper('\\cos(-x)+\\cos(x)', '2\\cos(x)');
  });

  test('sec(-x)cos(x) [Phase 6: TR3 angle canonicalization]', () => {
    fuTestHelper('\\sec(-x)\\cos(x)', '1');
  });

  test('tan(x)tan(-x) [Phase 6: TR3 angle canonicalization]', () => {
    fuTestHelper('\\tan(x)\\tan(-x)', '-\\tan^2(x)');
  });

  test('sin(x)cos(h+2pi)+sin(-h+pi)cos(-x) [Phase 6+8: TR3+period]', () => {
    fuTestHelper(
      '\\sin(x)\\cos(h+2\\pi)+\\sin(-h+\\pi)\\cos(-x)',
      '\\sin(x+h)'
    );
  });

  test('(1-cos(2x))/2 [Phase 9: TR7i inverse power reduction]', () => {
    fuTestHelper('(1-\\cos(2x))/2', '\\sin^2(x)');
  });

  test('(1+cos(2x))/2 [Phase 9: TR7i inverse power reduction]', () => {
    fuTestHelper('(1+\\cos(2x))/2', '\\cos^2(x)');
  });

  test('sin(x+pi)+2sin(x) [Phase 8: period reduction]', () => {
    fuTestHelper('\\sin(x+\\pi)+2\\sin(x)', '\\sin(x)');
  });

  test('sin(x+h)+sin(x-h) [Phase 13: TR9 sum-to-product]', () => {
    fuTestHelper('\\sin(x+h)+\\sin(x-h)', '2\\sin(x)\\cos(h)');
  });

  test.todo('Fu paper: 1-(1/4)sin^2(2x)-sin^2(y)-cos^4(x) [Phase 14] -- multi-step trig identity not yet implemented');

  test('Fu paper: cos(pi/9)cos(2pi/9)cos(3pi/9)cos(4pi/9) [Phase 7+TRmorrie]', () => {
    fuTestHelper(
      '\\cos(\\pi/9)*\\cos(2\\pi/9)*\\cos(3\\pi/9)*\\cos(4\\pi/9)',
      '1/16'
    );
  });

  test('Fu paper: tan sum with special angles [Phase 7+TR12i]', () => {
    fuTestHelper(
      '\\tan(7\\pi/18)+\\tan(5\\pi/18)-\\sqrt{3}\\tan(5\\pi/18)\\tan(7\\pi/18)',
      '-\\sqrt{3}'
    );
  });
});
