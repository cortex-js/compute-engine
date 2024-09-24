import { Expression } from '../../src/math-json/types.ts';
import { engine } from '../utils';

const ce = engine;

function check(s: string | Expression): string {
  if (typeof s === 'string') return ce.parse(s).toString();
  return ce.box(s).toString();
}

// Check serialization of ASCII math using toString()
describe('NUMBERS', () => {
  it('should serialize non-finite numbers', () => {
    expect(check('\\infty')).toMatch(`oo`);
    expect(check('-\\infty')).toMatch(`-oo`);
    expect(check('\\mathrm{NaN}')).toMatch(`NaN`);
  });

  it('should serialize integers', () => {
    expect(check('1')).toMatch(`1`);
    expect(check('0')).toMatch(`0`);
    expect(check('-1')).toMatch(`-1`);
    expect(check('2345')).toMatch(`2345`);
    expect(check('2345e99')).toMatchInlineSnapshot(`2345e+99`);
    expect(check('-2345e-99')).toMatchInlineSnapshot(`-2.345e-96`);

    expect(check('-123456789012345678901234567890')).toMatch(
      '-123456789012345678901234567890'
    );
  });

  it('should serialize floats', () => {
    expect(check('1.1')).toMatch(`1.1`);
    expect(check('-1.1')).toMatch(`-1.1`);
    expect(check('2345.5')).toMatch(`2345.5`);
    expect(check('2345.123e99')).toMatchInlineSnapshot(`2345123e+96`);
    expect(check('-2345.123e-99')).toMatchInlineSnapshot(`-2.345123e-96`);
  });

  it('should serialize complex numbers', () => {
    expect(check('i')).toMatch(`i`);
    expect(check('-i')).toMatch(`-i`);
    expect(check('2i')).toMatch(`2i`);
    expect(check('-2i')).toMatchInlineSnapshot(`-2i`);
    expect(check('2.123i')).toMatch(`2.123i`);
    expect(check('-2.123i')).toMatch(`-2.123i`);
    expect(check('1+i')).toMatchInlineSnapshot(`(1 + i)`);
    expect(check('1-i')).toMatchInlineSnapshot(`(1 - i)`);
    expect(check('-1-i')).toMatchInlineSnapshot(`(-1 - i)`);
    expect(check('1 + 2i')).toMatchInlineSnapshot(`(1 + 2i)`);
    expect(check('1 - 2i')).toMatchInlineSnapshot(`(1 - 2i)`);
    expect(check('1 + 2.5i')).toMatchInlineSnapshot(`(1 + 2.5i)`);
    expect(check('1 - 2.5i')).toMatchInlineSnapshot(`(1 - 2.5i)`);
    expect(check('1.5 + 2i')).toMatchInlineSnapshot(`(1.5 + 2i)`);
    expect(check('1.5 - 2i')).toMatchInlineSnapshot(`(1.5 - 2i)`);
    expect(check('1.5 + 2.5i')).toMatchInlineSnapshot(`(1.5 + 2.5i)`);
    expect(check('1.5 - 2.5i')).toMatchInlineSnapshot(`(1.5 - 2.5i)`);
    expect(check('-1.5 - 2.5i')).toMatchInlineSnapshot(`(-1.5 - 2.5i)`);
  });

  it('should serialize rational numbers', () => {
    expect(check(['Rational', 1, 2])).toMatchInlineSnapshot(`1/2`);
    expect(check(['Rational', -1, 2])).toMatchInlineSnapshot(`-1/2`);
    expect(
      check(['Rational', '-123456789123456789', '23456789234567892345'])
    ).toMatchInlineSnapshot(`-41152263041152263/7818929744855964115`);

    expect(check(['Rational', 1e221, 1e133])).toMatchInlineSnapshot(
      `19827670604028510480833599057223352477352135579004560396739851262728444777434136120546326212737060831232/1982767060402851`
    );

    // Large prime numbers greater than Number.MAX_SAFE_INTEGER
    expect(
      check([
        'Rational',
        { num: '9007199254740997' },
        { num: '9007199254741033' },
      ])
    ).toMatchInlineSnapshot(`9007199254740997/9007199254741033`);

    expect(check('2345/2')).toMatch(`2345/2`);
    expect(check('469/2.46e+100')).toMatchInlineSnapshot(`469/246e+98`);
    expect(check('-469/2.46e+100')).toMatchInlineSnapshot(`-469/246e+98`);

    expect(check('-1.123456789123456789')).toMatchInlineSnapshot(
      `-1.123456789123456789`
    );
    expect(
      check('-123456789012345678901234567890.123456789123456789')
    ).toMatchInlineSnapshot(
      `-1.23456789012345678901234567890123456789123456789e+29`
    );
  });

  it('should serialize numbers with exact radicals', () => {
    expect(check('\\sqrt{2}')).toMatchInlineSnapshot(`sqrt(2)`);
    expect(check('-\\sqrt{2}')).toMatchInlineSnapshot(`-sqrt(2)`);
    expect(check('2\\sqrt{2}')).toMatchInlineSnapshot(`2sqrt(2)`);
    expect(check('\\frac34 \\sqrt{3}')).toMatchInlineSnapshot(`3/4sqrt(3)`);
    expect(check('\\frac34 \\sqrt{3} + i')).toMatchInlineSnapshot(
      `3/4sqrt(3) + i`
    );
    // This should be an exact NumericValue
    expect(check('\\frac34 \\sqrt{3} - 2i')).toMatchInlineSnapshot(
      `3/4sqrt(3) - 2i`
    );
    // This is not an exact NumericValue (non-gaussian imaginary part)
    expect(check('\\frac34 \\sqrt{3} - 2.12i')).toMatchInlineSnapshot(
      `3/4sqrt(3) - 2.12i`
    );
  });
});

describe('POWERS/ROOTS', () => {
  it('should serialize square', () => {
    expect(check('x^2')).toMatchInlineSnapshot(`x^2`);
    expect(check('2^2')).toMatchInlineSnapshot(`2^2`);
    expect(check('(x+1)^2')).toMatchInlineSnapshot(`(x + 1)^2`);
    expect(check('(-1)^2')).toMatchInlineSnapshot(`(-1)^2`);
    expect(check('x+(-1)^2')).toMatchInlineSnapshot(`x + (-1)^2`);
  });
  it('should serialize other powers', () => {
    expect(check('x^{0}')).toMatchInlineSnapshot(`1`);
    expect(check('x^{1}')).toMatchInlineSnapshot(`x`);
    expect(check('x^{-1}')).toMatchInlineSnapshot(`x^(-1)`);
    expect(check('x^{1.1}')).toMatchInlineSnapshot(`x^(1.1)`);
    expect(check('x^{\\pi}')).toMatchInlineSnapshot(`x^(pi)`);
    expect(check('x^{a+1}')).toMatchInlineSnapshot(`x^(a + 1)`);
    expect(check('x^{a^b}')).toMatchInlineSnapshot(`x^(a^b)`);
    expect(check('x^{-2}')).toMatchInlineSnapshot(`x^(-2)`);
    expect(check('2^{1.1}')).toMatchInlineSnapshot(`2^(1.1)`);
    expect(check('(x+1)^{1.1}')).toMatchInlineSnapshot(`(x + 1)^(1.1)`);
    expect(check('(-1)^{1.1}')).toMatchInlineSnapshot(`(-1)^(1.1)`);
    expect(check('x+(-1)^{1.1}')).toMatchInlineSnapshot(`x + (-1)^(1.1)`);
  });

  it('should serialize roots', () => {
    expect(check('x^{\\frac12}')).toMatchInlineSnapshot(`sqrt(x)`);
    expect(check('2^{\\frac12}')).toMatchInlineSnapshot(`sqrt(2)`);
    expect(check('(x+1)^{\\frac12}')).toMatchInlineSnapshot(`sqrt(x + 1)`);
    expect(check('(-1)^{\\frac12}')).toMatchInlineSnapshot(`sqrt(-1)`);
    expect(check('x+(-1)^{\\frac12}')).toMatchInlineSnapshot(`x + sqrt(-1)`);

    expect(check('x^{\\frac34}')).toMatchInlineSnapshot(`x^(3/4)`);
    expect(check('2^{\\frac34}')).toMatchInlineSnapshot(`2^(3/4)`);
    expect(check('(x+1)^{\\frac34}')).toMatchInlineSnapshot(`(x + 1)^(3/4)`);
    expect(check('(-1)^{\\frac34}')).toMatchInlineSnapshot(`(-1)^(3/4)`);
    expect(check('x+(-1)^{\\frac34}')).toMatchInlineSnapshot(`x + (-1)^(3/4)`);

    expect(check('x^{\\frac32}')).toMatchInlineSnapshot(`x^(3/2)`);
    expect(check('2^{\\frac32}')).toMatchInlineSnapshot(`2^(3/2)`);
    expect(check('(x+1)^{\\frac32}')).toMatchInlineSnapshot(`(x + 1)^(3/2)`);
    expect(check('(-1)^{\\frac32}')).toMatchInlineSnapshot(`(-1)^(3/2)`);
    expect(check('x+(-1)^{\\frac32}')).toMatchInlineSnapshot(`x + (-1)^(3/2)`);

    expect(check('x^{\\frac17}')).toMatchInlineSnapshot(`root(7)(x)`);
    expect(check('2^{\\frac17}')).toMatchInlineSnapshot(`root(7)(2)`);
    expect(check('(x+1)^{\\frac17}')).toMatchInlineSnapshot(`root(7)(x + 1)`);
    expect(check('(-1)^{\\frac17}')).toMatchInlineSnapshot(`root(7)(-1)`);
    expect(check('x+(-1)^{\\frac17}')).toMatchInlineSnapshot(`x + root(7)(-1)`);
  });
});

describe('ARITHMETIC OPERATORS', () => {
  it('should serialize Add', () => {
    expect(check('1+2')).toMatchInlineSnapshot(`1 + 2`);
    expect(check('1-2')).toMatchInlineSnapshot(`-2 + 1`);
    expect(check('-1-2')).toMatchInlineSnapshot(`-2 - 1`);
    expect(check('-1-2-3')).toMatchInlineSnapshot(`-3 - 2 - 1`);
    expect(check('-1.23 - 2.3454 - 3.455')).toMatchInlineSnapshot(
      `-3.455 - 2.3454 - 1.23`
    );
    expect(check('-1.23e30 - 2.3454e32 - 3.455e35')).toMatchInlineSnapshot(
      `-3455e+32 - 23454e+28 - 123e+28`
    );
    expect(check('1 + (2+3i)')).toMatchInlineSnapshot(`1 + (2 + 3i)`);
    expect(check('1 + (-2-3i)')).toMatchInlineSnapshot(`1 + (-2 - 3i)`);
    expect(check('\\pi + (-2-3i)')).toMatchInlineSnapshot(`(-2 - 3i) + pi`);
    expect(check('x + (-2-3i)')).toMatchInlineSnapshot(`x + (-2 - 3i)`);
    expect(check('1+(-x)')).toMatchInlineSnapshot(`-x + 1`);
    expect(check('(-x)-1')).toMatchInlineSnapshot(`-x - 1`);
    expect(check('(-y)+(-x)-1')).toMatchInlineSnapshot(`-x - y - 1`);
  });

  it('should serialize Negate', () => {
    expect(check('(-x)')).toMatchInlineSnapshot(`-x`);
    expect(check('-(x+y)')).toMatchInlineSnapshot(`-x - y`);
    expect(check('-(2^3)')).toMatchInlineSnapshot(`-2^3`);
  });

  it('should serialize Multiply', () => {
    expect(check('2 \\times 3')).toMatchInlineSnapshot(`2 * 3`);
    expect(check('1 \\times 3')).toMatchInlineSnapshot(`3`);
    expect(check('-1 \\times 3')).toMatchInlineSnapshot(`-3`);
    expect(check('2 \\times 1')).toMatchInlineSnapshot(`2`);
    expect(check('2 \\times -1')).toMatchInlineSnapshot(`-2`);
    expect(check('2 \\times -3')).toMatchInlineSnapshot(`-2 * 3`);
    expect(check('-2 \\times -3')).toMatchInlineSnapshot(`2 * 3`);
    expect(check('-2 \\times -3 \\times -4')).toMatchInlineSnapshot(
      `-2 * 3 * 4`
    );
    expect(check('-x \\times -3 \\times -4 \\times -5')).toMatchInlineSnapshot(
      `3 * 4 * 5 * x`
    );
    expect(check('2 \\times 3 \\times -4 \\times 5')).toMatchInlineSnapshot(
      `-2 * 3 * 4 * 5`
    );
    expect(
      check('2.123 \\times 3.456 \\times -4.465 \\times 5.564')
    ).toMatchInlineSnapshot(`-2.123 * 3.456 * 4.465 * 5.564`);
    expect(
      check('2.123e32 \\times 3.456e33 \\times -4.465 \\times 5')
    ).toMatchInlineSnapshot(`-2123e+29 * 5 * 3456e+30 * 4.465`);

    expect(check('\\pi \\times 4')).toMatchInlineSnapshot(`4pi`);
    expect(check('4 \\times \\pi')).toMatchInlineSnapshot(`4pi`);
    expect(check('4 \\times \\pi \\times 3')).toMatchInlineSnapshot(
      `3 * 4 * pi`
    );

    expect(check('4 \\times (2+3i)')).toMatchInlineSnapshot(`4(2 + 3i)`);
    expect(check('(2+3i) \\times 4')).toMatchInlineSnapshot(`4(2 + 3i)`);
    expect(check('-4 \\times (-2-3i)')).toMatchInlineSnapshot(`-4(-2 - 3i)`);
    expect(check('(-2-3i) \\times -4')).toMatchInlineSnapshot(`4(2 + 3i)`);
    expect(check('\\pi \\times i')).toMatchInlineSnapshot(`i * pi`);
    expect(check('\\pi \\times -i')).toMatchInlineSnapshot(`-i * pi`);

    expect(check('x \\times y')).toMatchInlineSnapshot(`x * y`);
    expect(check('2 \\times y')).toMatchInlineSnapshot(`2y`);
    expect(check('-2 \\times -3')).toMatchInlineSnapshot(`2 * 3`);
    expect(check('-2 \\times x')).toMatchInlineSnapshot(`-2x`);
    expect(check('-2 \\times -x')).toMatchInlineSnapshot(`2x`);

    expect(check('-23456.262 \\times x')).toMatchInlineSnapshot(
      `-23456.262 * x`
    );

    expect(check('1 \\times x')).toMatchInlineSnapshot(`x`);

    expect(check('-1 \\times x')).toMatchInlineSnapshot(`-x`);

    expect(check('(2-3i) \\times x')).toMatchInlineSnapshot(`(2 - 3i) * x`);

    expect(check('(3/4) \\pi')).toMatchInlineSnapshot(`3/4 * pi`);

    expect(check('(3/4) x^2')).toMatchInlineSnapshot(`3/4 * x^2`);
    expect(check('(3/4) x^3')).toMatchInlineSnapshot(`3/4 * x^3`);
    expect(check('(3/4) \\cos(x)')).toMatchInlineSnapshot(`3/4 * cos(x)`);
  });
});

describe('PRECEDENCE', () => {
  it('should correctly put parentheses where needed', () => {
    expect(check('1+2*3')).toMatchInlineSnapshot(`1 + 2 * 3`);
    expect(check('(1+2)*3')).toMatchInlineSnapshot(`3(1 + 2)`);
    expect(check('1*2+3')).toMatchInlineSnapshot(`2 + 3`);
    expect(check('1*(2+3)')).toMatchInlineSnapshot(`2 + 3`);
    expect(check('1+2^3')).toMatchInlineSnapshot(`1 + 2^3`);
    expect(check('(1+2)^3')).toMatchInlineSnapshot(`(1 + 2)^3`);
    expect(check('1^2+3')).toMatchInlineSnapshot(`3 + 1^2`);
    expect(check('1^{2+3}')).toMatchInlineSnapshot(`1^(2 + 3)`);
    expect(check('1+2/3')).toMatchInlineSnapshot(`1 + 2/3`);
    expect(check('(1+2)/3')).toMatchInlineSnapshot(`1/3 * (1 + 2)`);
    expect(check('1/2+3')).toMatchInlineSnapshot(`3 + 1/2`);
    expect(check('1/(2+3)')).toMatchInlineSnapshot(`1 / (2 + 3)`);
    expect(check('1+(2/3)+4')).toMatchInlineSnapshot(`1 + 4 + 2/3`);
    expect(check('1+2/(3+4)')).toMatchInlineSnapshot(`1 + 2 * 1 / (3 + 4)`);
    expect(check('(1+2)/3+4')).toMatchInlineSnapshot(`4 + 1/3 * (1 + 2)`);
    expect(check('1+(2/3)*4')).toMatchInlineSnapshot(`1 + 4 * 2/3`);
  });

  it('should correctly put parentheses with relational operators', () => {
    expect(check('(a < b) <= c')).toMatchInlineSnapshot(`(a < b) <= c`);
    expect(check('a < (b <= c)')).toMatchInlineSnapshot(`a < (b <= c)`);

    expect(check('(a < b) <= (c > d)')).toMatchInlineSnapshot(
      `(a < b) <= (d < c)`
    );
    expect(check('a < (b <= c) > d')).toMatchInlineSnapshot(`a < d < (b <= c)`);
  });
});

describe('FUNCTIONS', () => {
  it('should correctly serialize lists', () => {
    expect(check(['List'])).toMatchInlineSnapshot(`[]`);
    expect(check(['List', 1])).toMatchInlineSnapshot(`[1]`);
    expect(check(['List', 1, 2, 3])).toMatchInlineSnapshot(`[1,2,3]`);

    expect(
      check(['List', ['List', 1, 2], ['List', 3, 4]])
    ).toMatchInlineSnapshot(`[[1,2],[3,4]]`);
  });

  it('should correctly serialize tuples', () => {
    expect(check(['Tuple'])).toMatchInlineSnapshot(`()`);
    expect(check(['Tuple', 1])).toMatchInlineSnapshot(`(1)`);
    expect(check(['Tuple', 1, 2, 3])).toMatchInlineSnapshot(`(1, 2, 3)`);

    expect(
      check(['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]])
    ).toMatchInlineSnapshot(`((1, 2), (3, 4))`);
  });

  it('should correctly serialize function expressions', () => {
    expect(check(['Function'])).toMatchInlineSnapshot(`"Nothing"`);
    expect(check(['Function', 1])).toMatchInlineSnapshot(`1`);
    expect(check(['Function', '_'])).toMatchInlineSnapshot(`("_1") |-> {"_1"}`);

    expect(check(['Function', 'x', 'x'])).toMatchInlineSnapshot(`(x) |-> {x}`);

    expect(check(['Function', ['Add', 'x', 1], 'x'])).toMatchInlineSnapshot(
      `(x) |-> {x + 1}`
    );

    expect(
      check(['Function', ['Add', 'x', 'y'], 'x', 'y'])
    ).toMatchInlineSnapshot(`(x, y) |-> {x + y}`);
  });
});
