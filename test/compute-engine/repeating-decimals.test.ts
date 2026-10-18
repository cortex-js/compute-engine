import { engine as ce } from '../utils';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

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

/**
 * A truncation marker (`\ldots`) after decimal digits reads as a repeating
 * decimal when the displayed digits end in an evident repetend — a trailing
 * block repeated at least 3 times for single digits, at least twice for
 * longer blocks. Otherwise the marker is display-only truncation and the
 * value is the displayed digits (the pre-existing behavior).
 */
describe('TRUNCATION MARKER with an evident repetend is a repeating decimal', () => {
  test('0.999\\ldots is exactly 1', () => {
    expect(ce.parse('0.999\\ldots').isSame(1)).toBe(true);
  });

  test('0.333\\ldots is exactly 1/3', () => {
    expect(ce.parse('0.333\\ldots').json).toEqual(['Rational', 1, 3]);
  });

  test('0.1666\\ldots is exactly 1/6 (prefix + repetend)', () => {
    expect(ce.parse('0.1666\\ldots').json).toEqual(['Rational', 1, 6]);
  });

  test('0.1212\\ldots detects the two-digit repetend (4/33)', () => {
    expect(ce.parse('0.1212\\ldots').json).toEqual(['Rational', 4, 33]);
  });

  test('1.999\\ldots is exactly 2 (nonzero whole part)', () => {
    expect(ce.parse('1.999\\ldots').isSame(2)).toBe(true);
  });

  test('3.1415\\ldots has no evident repetend and stays truncated', () => {
    expect(ce.parse('3.1415\\ldots').json).toEqual(3.1415);
  });

  test('0.99\\ldots is below the single-digit repetition threshold', () => {
    expect(ce.parse('0.99\\ldots').json).toEqual(0.99);
  });

  test('an explicit repetend takes precedence over the marker heuristic', () => {
    // `0.\overline{9}\ldots` — the vinculum wins; the marker is ignored.
    expect(ce.parse('0.\\overline{9}\\ldots').isSame(1)).toBe(true);
  });
});

/**
 * A repetend mark parses as an exact rational, so the LaTeX serializer does
 * not write one for a FLOAT by default (`repeatingDecimal: 'auto'`): a float
 * whose digits repeat is written with its digits, and a LaTeX round trip keeps
 * it a float. An exact repeating decimal (the MathJSON number string
 * `"0.(3)"`) keeps its overline, and an explicit notation still marks the
 * repeating digits of a float.
 */
describe('A FLOAT WITH REPEATING DIGITS stays a float after a LaTeX round trip', () => {
  test('\\frac{1.0}{3} is written with its digits, not 0.\\overline{3}', () => {
    const value = ce.parse('\\frac{1.0}{3}').evaluate();
    // The number of digits depends on the precision of the engine.
    expect(value.latex).toMatch(/^0\.333(\\,333)+(\\,3+)?$/);
    expect(value.toLatex()).toBe(value.latex);
    const again = ce.parse(value.latex);
    expect(isNumber(again) && again.isExact).toBe(false);
    expect(again.json).toEqual(value.json);
  });

  test('\\frac{2.0}{7} keeps its float on the round trip', () => {
    const value = ce.parse('\\frac{2.0}{7}').evaluate();
    expect(value.latex).not.toContain('\\overline');
    const again = ce.parse(value.latex);
    expect(isNumber(again) && again.isExact).toBe(false);
    expect(again.N().re).toBeCloseTo(2 / 7, 15);
  });

  test('.N() of an exact rational is a float on the round trip', () => {
    const value = ce.parse('\\frac{1}{7}').N();
    expect(value.latex).toMatch(/^0\.142\\,857\\,142\\,857(\\,[0-9]+)+$/);
    const again = ce.parse(value.latex);
    expect(isNumber(again) && again.isExact).toBe(false);
  });

  test('an exact rational still serializes as a fraction', () => {
    expect(ce.parse('\\frac{1}{3}').latex).toBe('\\frac{1}{3}');
    expect(ce.parse('0.\\overline{3}').latex).toBe('\\frac{1}{3}');
  });

  test('an exact repeating decimal in MathJSON keeps its overline', () => {
    const syntax = ce._requireLatexSyntax();
    expect(syntax.serialize({ num: '0.(3)' })).toBe('0.\\overline{3}');
    expect(syntax.serialize({ num: '0.12(34)' })).toBe('0.12\\overline{34}');
    expect(ce.parse(syntax.serialize({ num: '0.(3)' })).json).toEqual([
      'Rational',
      1,
      3,
    ]);
  });

  test('a float in MathJSON gets no overline', () => {
    const syntax = ce._requireLatexSyntax();
    expect(syntax.serialize({ num: '0.333333333333333333333333' })).toBe(
      '0.333\\,333\\,333\\,333\\,333\\,333\\,333\\,333'
    );
  });

  test('an explicit notation still marks the repeating digits of a float', () => {
    const value = ce.parse('\\frac{1}{7}').N();
    expect(value.toLatex({ repeatingDecimal: 'vinculum' })).toBe(
      '0.\\overline{142857}'
    );
    expect(value.toLatex({ repeatingDecimal: 'none' })).toBe(value.latex);
  });
});

/**
 * In MathJSON, a number string with a repetend (`"0.(3)"`) is an exact
 * rational. So `toMathJson()` does not mark the repeating digits of a FLOAT by
 * default: a float keeps its digits, and a MathJSON round trip keeps it a
 * float. The option `repeatingDecimal: true` still marks them.
 */
describe('A FLOAT WITH REPEATING DIGITS stays a float after a MathJSON round trip', () => {
  test('toMathJson() of 1.0/3 keeps the digits of the float', () => {
    const value = ce.parse('\\frac{1.0}{3}').evaluate();
    const json = value.toMathJson();
    expect(JSON.stringify(json)).toMatch(/^"0\.3333+"$/);
    const again = ce.box(json);
    expect(isNumber(again) && again.isExact).toBe(false);
    expect(again.isSame(value)).toBe(true);
  });

  test('.json of 1.0/3 boxes back as the same float', () => {
    const value = ce.parse('\\frac{1.0}{3}').evaluate();
    const again = ce.box(value.json);
    expect(isNumber(again) && again.isExact).toBe(false);
    expect(again.isSame(value)).toBe(true);
  });

  test('a float inside a function keeps its digits', () => {
    const json = ce.parse('x + \\frac{1.0}{3}').evaluate().toMathJson();
    expect(JSON.stringify(json)).not.toContain('(3)');
  });

  test('repeatingDecimal: true still marks the repeating digits of a float', () => {
    const value = ce.parse('\\frac{1.0}{3}').evaluate();
    expect(value.toMathJson({ repeatingDecimal: true })).toBe('0.(3)');
    expect(
      ce.parse('\\frac{1}{7}').N().toMathJson({ repeatingDecimal: true })
    ).toBe('0.(142857)');
  });

  test('the LaTeX of the MathJSON of a float has no overline', () => {
    const syntax = ce._requireLatexSyntax();
    const value = ce.parse('\\frac{1.0}{3}').evaluate();
    expect(syntax.serialize(value.json)).not.toContain('\\overline');
    expect(syntax.serialize(value.toMathJson())).not.toContain('\\overline');
  });

  test('an exact rational serializes as a Rational', () => {
    expect(ce.parse('\\frac{1}{3}').toMathJson()).toEqual(['Rational', 1, 3]);
    expect(ce.box({ num: '0.(3)' }).toMathJson()).toEqual(['Rational', 1, 3]);
  });
});
