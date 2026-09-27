import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { BigDecimal } from '../../src/big-decimal';

// Whether a number is exact is decided by the ROUTE it arrives on, not by its
// value (user decision of 2026-09-27, ROADMAP "Residues of the exact-boxing
// rule", item 1).
//
// - A numeric LITERAL with a fraction part (`1.0`, `2.0`, `{num: "1.0"}`) is a
//   float, always. Before this decision `1.0`, `0.0`, `-1.0` and `1.00` were
//   the exact shared constants `One`, `Zero` and `NegativeOne`, while `2.0`
//   was a float, so `1.0x` lost its float coefficient and `\frac{1.0}{3}`
//   evaluated to the exact `1/3`.
// - On the API, `ce.number(bigDecimal)` is exact when the big decimal is
//   integer-valued, at any magnitude. Before, only a value of at most `10^6`
//   was exact.
// - A big decimal that a NUMERIC computation produces stays a float, even when
//   it is integer-valued.

const ce = new ComputeEngine();

// Every number literal in the expression, with a `~` after a float
function leaves(e: Expression): string {
  if (e.isNumberLiteral) return `${e.toString()}${e.isExact ? '' : '~'}`;
  if (e.ops) return `${e.operator}(${e.ops.map(leaves).join(', ')})`;
  return e.toString();
}

describe('THE LITERAL ROUTE', () => {
  test.each([
    ['1.0', 1],
    ['0.0', 0],
    ['-1.0', -1],
    ['1.00', 1],
    ['2.0', 2],
    ['1500.0', 1500],
  ])('%s is a float', (latex, value) => {
    const e = ce.parse(latex);
    expect(e.isNumberLiteral).toBe(true);
    expect(e.isExact).toBe(false);
    expect(e.re).toBe(value);
  });

  test('a float 1 is not the shared exact constant', () => {
    expect(ce.parse('1.0') === ce.One).toBe(false);
    expect(ce.parse('0.0') === ce.Zero).toBe(false);
    expect(ce.parse('-1.0') === ce.NegativeOne).toBe(false);
  });

  test('{num: "1.0"} is a float', () => {
    const e = ce.box({ num: '1.0' });
    expect(e.isExact).toBe(false);
    expect(e.re).toBe(1);
  });

  test('an integer literal is exact', () => {
    expect(ce.parse('1').isExact).toBe(true);
    expect(ce.parse('1') === ce.One).toBe(true);
    expect(ce.box({ num: '1' }).isExact).toBe(true);
  });

  test('1.0x keeps its float coefficient, as 2.0x does', () => {
    expect(leaves(ce.parse('1.0x'))).toBe('Multiply(1~, x)');
    expect(leaves(ce.parse('1.0x').evaluate())).toBe('Multiply(1~, x)');
    expect(leaves(ce.parse('2.0x').evaluate())).toBe('Multiply(2~, x)');
    expect(leaves(ce.parse('-1.0x').evaluate())).toBe('Multiply(-1~, x)');
  });

  test('\\frac{1.0}{3} is a float, as \\frac{2.0}{3} is', () => {
    const one = ce.parse('\\frac{1.0}{3}').evaluate();
    expect(one.isExact).toBe(false);
    expect(one.re).toBeCloseTo(1 / 3, 15);
    expect(ce.parse('\\frac{2.0}{3}').evaluate().isExact).toBe(false);
  });

  test('\\frac{x}{1.0} keeps its float divisor, as \\frac{x}{2.0} does', () => {
    expect(leaves(ce.parse('\\frac{x}{1.0}'))).toBe('Divide(x, 1~)');
    expect(leaves(ce.parse('\\frac{x}{1.0}').evaluate())).toBe(
      'Multiply(1~, x)'
    );
  });

  test('a product with a float 1 is a float', () => {
    const e = ce.parse('1.0 \\times 2').evaluate();
    expect(e.isExact).toBe(false);
    expect(e.re).toBe(2);
  });

  test('\\sqrt{1.0} is a float 1', () => {
    const e = ce.parse('\\sqrt{1.0}').evaluate();
    expect(e.isExact).toBe(false);
    expect(e.re).toBe(1);
  });

  test('\\sin(1.0) evaluates to a float, as \\sin(2.0) does', () => {
    const one = ce.parse('\\sin(1.0)').evaluate();
    expect(one.isNumberLiteral).toBe(true);
    expect(one.isExact).toBe(false);
    expect(one.re).toBeCloseTo(Math.sin(1), 15);
    const two = ce.parse('\\sin(2.0)').evaluate();
    expect(two.re).toBeCloseTo(Math.sin(2), 15);
    // The integer literal is exact, and the sine of it stays symbolic
    expect(ce.parse('\\sin(1)').evaluate().json).toEqual(['Sin', 1]);
  });
});

describe('THE API ROUTE', () => {
  test('ce.number() of a JavaScript integer is exact and shared', () => {
    expect(ce.number(1).isExact).toBe(true);
    expect(ce.number(1) === ce.One).toBe(true);
  });

  test('ce.number() of a JavaScript number with a fraction part is a float', () => {
    expect(ce.number(1.5).isExact).toBe(false);
  });

  test.each(['1500', '10000000', '9007199254740993'])(
    'ce.number(bignum %s) is exact',
    (digits) => {
      const e = ce.number(ce.bignum(digits));
      expect(e.isExact).toBe(true);
      expect(e.isSame(ce.number(BigInt(digits)))).toBe(true);
    }
  );

  test('ce.number(bignum 1e30) is exact and equal to the bigint', () => {
    const e = ce.number(ce.bignum('1e30'));
    expect(e.isExact).toBe(true);
    expect(e.isSame(ce.number(10n ** 30n))).toBe(true);
    expect(e.isInteger).toBe(true);
  });

  test('ce.number(bignum 1500.5) is a float', () => {
    const e = ce.number(ce.bignum('1500.5'));
    expect(e.isExact).toBe(false);
    expect(e.re).toBe(1500.5);
  });

  test('ce.box() of an integer-valued big decimal is exact', () => {
    expect(ce.box(new BigDecimal('10000000')).isExact).toBe(true);
  });
});

describe('AN EXACT INTEGER COMPUTATION WITH BIG DECIMALS', () => {
  // At a precision above machine precision (the default is 21 digits), these
  // kernels compute with big decimals. Their result is an exact integer at
  // any magnitude. Before, a result above 10^6 was a float.
  test('GCD and LCM of large integers are exact', () => {
    const gcd = ce.box(['GCD', 20000000, 30000000]).evaluate();
    expect(gcd.isExact).toBe(true);
    expect(gcd.re).toBe(10000000);
    const lcm = ce.box(['LCM', 4000000, 6000000]).evaluate();
    expect(lcm.isExact).toBe(true);
    expect(lcm.re).toBe(12000000);
  });

  test('a large double factorial is exact', () => {
    const e = ce.box(['Factorial2', 41]).evaluate();
    expect(e.isExact).toBe(true);
    expect(e.isSame(ce.number(13113070457687988603440625n))).toBe(true);
  });
});

describe('THE RESULT OF A NUMERIC COMPUTATION', () => {
  test('an integer-valued big decimal result stays a float', () => {
    const hp = new ComputeEngine();
    hp.precision = 30;
    // The square root of the float `1.0e20` is computed with big decimals,
    // and its value is the integer `10^10`: it must not become exact.
    const e = hp.parse('\\sqrt{1.0e20}').N();
    expect(e.isNumberLiteral).toBe(true);
    expect(e.isExact).toBe(false);
    expect(e.re).toBe(1e10);
  });

  test('the Pi constant at a high precision is a float', () => {
    const hp = new ComputeEngine();
    hp.precision = 30;
    const e = hp.parse('\\pi').N();
    expect(e.isExact).toBe(false);
  });
});

describe('A FLOAT ±1 OR 0 IS NOT AN IDENTITY', () => {
  // A float operand makes the result a float. A float `±1` or `0` is not
  // removed as an identity of `Power`, `Divide` or `Add`, as in Mathematica
  // (`x^1.` stays `x^1.`, `x + 0.` stays `0. + x`). A float `0` still
  // absorbs a product, and gives a float `0`.
  test.each([
    ['1.0^{1/3}', '1~'],
    ['1.0^2', '1~'],
    ['1.0^{-1}', '1~'],
    ['(-1.0)^{-1}', '-1~'],
    ['(-1.0)^3', '-1~'],
    ['2.0^2', '4~'],
    ['2^{1.0}', '2~'],
    ['2^{0.0}', '1~'],
    ['0.0^2', '0~'],
    ['\\frac{2}{1.0}', '2~'],
    ['\\frac{2}{2.0}', '1~'],
    ['\\frac{2.0}{2}', '1~'],
    ['\\frac{2.0}{2.0}', '1~'],
    ['\\frac{6}{2.0}', '3~'],
    ['\\frac{0.0}{x}', '0~'],
    ['0.0x', '0~'],
    ['x\\cdot 0.0', '0~'],
    ['0.5x-0.5x', '0~'],
  ])('%s evaluates to a float', (latex, expected) => {
    expect(leaves(ce.parse(latex).evaluate())).toBe(expected);
  });

  test.each([
    ['x^{1.0}', 'Power(x, 1~)'],
    ['x^{-1.0}', 'Power(x, -1~)'],
    ['1.0^x', 'Power(1~, x)'],
    ['0.0+x', 'Add(x, 0~)'],
    ['x+0.0', 'Add(x, 0~)'],
    ['x+2.0-2', 'Add(x, 0~)'],
    ['2.0x+x', 'Multiply(3~, x)'],
    ['0.5x+0.5x', 'Multiply(1~, x)'],
  ])('%s keeps its float', (latex, expected) => {
    expect(leaves(ce.parse(latex).evaluate())).toBe(expected);
  });

  test('the MathJSON route', () => {
    const one = { num: '1.0' };
    expect(leaves(ce.box(['Divide', 2, one]).evaluate())).toBe('2~');
    expect(leaves(ce.box(['Divide', 2, { num: '2.0' }]).evaluate())).toBe('1~');
    expect(leaves(ce.box(['Power', { num: '2.0' }, 2]).evaluate())).toBe('4~');
    expect(leaves(ce.box(['Power', 'x', one]))).toBe('Power(x, 1~)');
    expect(leaves(ce.box(['Power', one, 'x']))).toBe('Power(1~, x)');
    expect(leaves(ce.box(['Add', { num: '0.0' }, 'x']))).toBe('Add(x, 0~)');
    expect(leaves(ce.box(['Multiply', { num: '0.0' }, 'x']).evaluate())).toBe(
      '0~'
    );
  });

  test('an exact ±1 or 0 is still an identity', () => {
    expect(leaves(ce.parse('x^1'))).toBe('x');
    expect(leaves(ce.parse('1^x'))).toBe('1');
    expect(leaves(ce.parse('\\frac{2}{2}'))).toBe('1');
    expect(leaves(ce.parse('0+x'))).toBe('x');
    expect(leaves(ce.parse('x+2-2').evaluate())).toBe('x');
    expect(leaves(ce.parse('0x').evaluate())).toBe('0');
    expect(leaves(ce.parse('0\\cdot 2.0').evaluate())).toBe('0');
  });
});

describe('ce.box() OF A NUMERIC VALUE', () => {
  test.each([1, 0, -1, 2])(
    'a float %d stays a float, as with ce.number()',
    (v) => {
      const nv = ce._numericValue(new BigDecimal(v));
      expect(nv.isExact).toBe(false);
      expect(ce.number(nv).isExact).toBe(false);
      expect(ce.box(nv).isExact).toBe(false);
      expect(ce.box(nv).re).toBe(v);
    }
  );

  test('an exact value is the shared constant', () => {
    expect(ce.box(ce._numericValue(1)) === ce.One).toBe(true);
    expect(ce.box(ce._numericValue(0)) === ce.Zero).toBe(true);
    expect(ce.box(ce._numericValue(-1)) === ce.NegativeOne).toBe(true);
  });
});
