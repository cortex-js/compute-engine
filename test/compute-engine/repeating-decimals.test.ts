import { engine as ce } from '../utils';

/**
 * A repeating decimal denotes an exact rational. Per the exactness contract,
 * `0.\overline{3}` must box as the exact rational `1/3`, not a truncated
 * decimal float. See boxed-number.ts `repeatingDecimalToRational`.
 */
describe('REPEATING DECIMALS box as exact rationals', () => {
  test('0.\\overline{3} is exactly 1/3', () => {
    const expr = ce.parse('0.\\overline{3}');
    expect(expr.json).toEqual(['Rational', 1, 3]);
    expect(expr.isSame(ce.parse('\\frac{1}{3}'))).toBe(true);
  });

  test('0.\\overline{3} times 3 evaluates to exactly 1', () => {
    const result = ce.parse('0.\\overline{3} \\cdot 3').evaluate();
    expect(result.isSame(1)).toBe(true);
  });

  test('0.1\\overline{6} is exactly 1/6', () => {
    const expr = ce.parse('0.1\\overline{6}');
    expect(expr.json).toEqual(['Rational', 1, 6]);
    expect(expr.isSame(ce.parse('\\frac{1}{6}'))).toBe(true);
  });

  test('0.\\overline{142857} is exactly 1/7', () => {
    const expr = ce.parse('0.\\overline{142857}');
    expect(expr.json).toEqual(['Rational', 1, 7]);
    expect(expr.isSame(ce.parse('\\frac{1}{7}'))).toBe(true);
  });

  test('12.3\\overline{45} is exactly 679/55', () => {
    const expr = ce.parse('12.3\\overline{45}');
    expect(expr.json).toEqual(['Rational', 679, 55]);
  });

  test('0.\\overline{9} is exactly 1', () => {
    const expr = ce.parse('0.\\overline{9}');
    expect(expr.isSame(1)).toBe(true);
  });

  test('MathJSON num-string path boxes exactly', () => {
    const expr = ce.box({ num: '0.(3)' });
    expect(expr.json).toEqual(['Rational', 1, 3]);
    expect(expr.isSame(ce.parse('\\frac{1}{3}'))).toBe(true);
  });

  test('exponent trail (e±n) scales the exact rational', () => {
    // The LaTeX parser does not emit an exponent trail on a repeating decimal;
    // exercise the num-string path directly.
    expect(ce.box({ num: '0.(3)e2' }).json).toEqual(['Rational', 100, 3]);
    expect(ce.box({ num: '0.(3)e-1' }).json).toEqual(['Rational', 1, 30]);
  });

  test('degenerate (0) repetend behaves like a plain terminating decimal', () => {
    expect(ce.box({ num: '0.5(0)' }).isSame(ce.box({ num: '0.5' }))).toBe(true);
  });

  test('REGRESSION: a plain terminating decimal stays a float', () => {
    const expr = ce.parse('0.333');
    expect(expr.json).toEqual(0.333);
    expect(expr.isSame(ce.parse('\\frac{1}{3}'))).toBe(false);
  });
});
