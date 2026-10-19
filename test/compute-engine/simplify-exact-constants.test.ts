import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const simplify = (latex: string) => ce.parse(latex).simplify().toString();

describe('logarithms of positive rationals and surds', () => {
  test.each([
    // Coefficients on the logarithms: the sum is 0.
    ['-2\\ln(2)-2\\ln(3/2)+2\\ln(3)', '0'],
    ['\\frac32-2\\ln(3/2)+2\\ln(3)-\\ln(2)+\\ln(1/2)', '3/2'],
    // Fractional coefficients and a common base found by gcd (19684 = 4·4921).
    [
      '-\\frac29\\ln(2)-\\frac19\\ln(4921)+\\frac19\\ln(19684/19683)+\\ln(3)',
      '0',
    ],
    ['\\ln(2)+\\frac12\\ln(3)', '1/2 * ln(12)'],
    // A surd argument: ln(r√c) = ln(r) + (1/2)·ln(c).
    ['\\frac{16}{3}+3\\ln(\\sqrt3)-\\frac32\\ln(3)', '16/3'],
    [
      '-3\\ln(\\frac{\\sqrt2}{2})+3\\ln(\\frac{\\sqrt3}{2})-\\frac32\\ln(\\frac14)+\\frac32\\ln(\\frac12)',
      '3/2 * ln(3)',
    ],
  ])('%s', (input, expected) => expect(simplify(input)).toBe(expected));

  test('a logarithm of a symbol is not combined', () =>
    expect(simplify('\\ln(x)+\\ln(2)')).toBe('ln(x) + ln(2)'));
});

describe('quotients with a denominator in a quadratic field', () => {
  test.each([
    // A power of a + b√c in the denominator.
    ['\\frac{12-7\\sqrt3}{(3-2\\sqrt3)^2}', '-sqrt(3)/3'],
    ['\\frac{1}{(3-2\\sqrt3)^2}', '7/3 + 4/3sqrt(3)'],
    // A rational factor times a + b√c in the denominator.
    ['\\frac{12-7\\sqrt3}{21-12\\sqrt3}', '-sqrt(3)/3'],
    // Factors outside the field are kept: ∫₀^π dx/(2 + cos x) = π/√3.
    ['\\frac{-\\pi(12-7\\sqrt3)}{(3-2\\sqrt3)^2}', 'sqrt(3)/3 * pi'],
    ['\\frac{\\pi(24-17\\sqrt2)}{2(4-3\\sqrt2)^2}', '-sqrt(2)/4 * pi'],
    // Two different surds are not in one quadratic field: the conjugate
    // rule for a two-term denominator handles them.
    ['\\frac{\\sqrt3+\\sqrt2}{\\sqrt3-\\sqrt2}', '5 + 2sqrt(6)'],
  ])('%s', (input, expected) => expect(simplify(input)).toBe(expected));
});

describe('odd functions of a negative constant that is not one literal', () => {
  test.each([
    ['\\arctan(-3+2\\sqrt2)', '-arctan(3 - 2sqrt(2))'],
    ['\\arctan(-3+2\\sqrt2)+\\arctan(3-2\\sqrt2)', '0'],
    [
      '-\\frac{\\sqrt2}{2}\\arctan(\\frac{-1}{3+2\\sqrt2})',
      'sqrt(2)/2 * arctan(3 - 2sqrt(2))',
    ],
  ])('%s', (input, expected) => expect(simplify(input)).toBe(expected));
});

describe('limits of the two rules', () => {
  test('a large coefficient does not build a huge integer', () => {
    expect(simplify('10000000\\ln(2)+\\ln(3)')).toBe('10000000ln(2) + ln(3)');
    expect(simplify('100000000000000000000\\ln(2)+\\ln(3)')).toBe(
      '1e+20 * ln(2) + ln(3)'
    );
  });

  test('another logarithm in the sum is left to the general combination', () => {
    const engine = new ComputeEngine();
    engine.assume(engine.parse('x>0'));
    engine.assume(engine.parse('y>0'));
    expect(
      engine.parse('1000\\ln(2)+\\ln(3)+\\ln(x)+\\ln(y)').simplify().toString()
    ).toBe('ln(3x * y) + 1000ln(2)');
  });

  test('a float factor stays a float', () => {
    const value = ce
      .box([
        'Divide',
        ['Multiply', { num: '2.0' }, 'x'],
        ['Power', ['Add', 1, ['Sqrt', 2]], 2],
      ])
      .simplify();
    expect(value.toString()).toBe('2x * (3 - 2sqrt(2))');
    expect(
      value.ops!.some((f) => f.isNumberLiteral && f.isExact === false)
    ).toBe(true);
  });

  test('a high power of a + b√c is not expanded', () =>
    expect(simplify('\\frac{\\pi}{(1+\\sqrt2)^{10}}')).toBe(
      'pi / (1 + sqrt(2))^(10)'
    ));
});
