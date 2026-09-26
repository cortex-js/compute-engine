import { ComputeEngine } from '../../../src/compute-engine';

/**
 * `wrapShort` decided whether to parenthesize a `Power` base from a fixed
 * list of heads, so a base outside that list (`Complex`, `Rational`,
 * `Divide`, `Factorial`, a nested `Power`) serialized unwrapped even where
 * that changes the math: `1+\imaginaryI^2` reads as `1 + i²`, not `(1+i)²`.
 *
 * `wrapPowerBase` (used only for a `Power`/`Square`/`Root` base, not for a
 * fraction's numerator or denominator, where these shapes are unambiguous)
 * covers this by precedence and kind instead: a `Complex` sum or scaled
 * unit, a `Rational`/`Divide` (looser than `^`), a `Factorial` (postfix,
 * so unambiguous to parse but not to read), and a nested `Power` all get a
 * fence.
 */

const ce = new ComputeEngine();

describe('345 a Power base is bracketed by precedence, not a fixed head list', () => {
  test('a non-canonical Complex sum is parenthesized', () => {
    expect(
      ce.box(['Power', ['Complex', 1, 1], 2], { canonical: false }).latex
    ).toBe('(1+\\imaginaryI)^2');
  });

  test('a non-canonical Complex scaled imaginary unit is parenthesized', () => {
    expect(
      ce.box(['Power', ['Complex', 0, 2], 2], { canonical: false }).latex
    ).toBe('(2\\imaginaryI)^2');
  });

  test('the bare imaginary unit is not parenthesized', () => {
    expect(
      ce.box(['Power', ['Complex', 0, 1], 2], { canonical: false }).latex
    ).toBe('\\imaginaryI^2');
  });

  test('a Rational base is parenthesized', () => {
    expect(
      ce.box(['Power', ['Rational', 2, 3], 2], { canonical: false }).latex
    ).toBe('(\\frac{2}{3})^2');
  });

  test('a Divide base is parenthesized', () => {
    expect(
      ce.box(['Power', ['Divide', 2, 3], 2], { canonical: false }).latex
    ).toBe('(\\frac{2}{3})^2');
  });

  test('a Factorial base is parenthesized', () => {
    expect(
      ce.box(['Power', ['Factorial', 'n'], 2], { canonical: false }).latex
    ).toBe('(n!)^2');
  });

  test('a nested Power base is parenthesized, not merely braced', () => {
    expect(
      ce.box(['Power', ['Power', 'x', 2], 3], { canonical: false }).latex
    ).toBe('(x^2)^3');
  });

  test('Square of a Complex sum is parenthesized the same way', () => {
    expect(
      ce.box(['Square', ['Complex', 1, 1]], { canonical: false }).latex
    ).toBe('(1+\\imaginaryI)^2');
  });

  test('each new spelling round-trips to the same value', () => {
    const cases: [any, any][] = [
      [
        ['Power', ['Complex', 1, 1], 2],
        ['Complex', 0, 2],
      ],
      [['Power', ['Complex', 0, 2], 2], -4],
      [
        ['Power', ['Rational', 2, 3], 2],
        ['Rational', 4, 9],
      ],
      [['Power', ['Factorial', 4], 2], 576],
      [['Power', ['Power', 3, 2], 3], 729],
    ];
    for (const [json, expected] of cases) {
      const latex = ce.box(json, { canonical: false }).latex;
      expect(ce.parse(latex).evaluate().json).toEqual(
        ce.box(expected).evaluate().json
      );
    }
  });

  // Bases that already read correctly must not gain brackets: a fraction's
  // numerator/denominator has its own unambiguous delimiters, so a Power or
  // a Factorial there stays bare (`wrapPowerBase` is not used for either).
  test('a fraction numerator or denominator is unaffected', () => {
    expect(ce.parse('\\frac{x^{23}}{y}').latex).toBe('\\frac{x^{23}}{y}');
    expect(ce.parse('\\frac{x^2}{y}').latex).toBe('\\frac{x^2}{y}');
  });

  // Bases that already read correctly must not gain brackets either.
  test('unrelated bases are unaffected', () => {
    expect(ce.parse('x^2').latex).toBe('x^2');
    expect(ce.parse('5^2').latex).toBe('25');
    expect(ce.parse('\\sin(x)^2').latex).toBe('\\sin(x)^2');
    expect(ce.parse('\\Gamma(x)^2').latex).toBe('\\Gamma(x)^2');
    expect(ce.parse('\\binom{n}{k}^2').latex).toBe('\\binom{n}{k}^2');
    expect(ce.parse('\\vert x\\vert^2').latex).toBe('\\vert x\\vert^2');
    expect(ce.parse('x_1^2').latex).toBe('x_1^2');
    expect(ce.parse('e^x').latex).toBe('\\exponentialE^{x}');
    expect(ce.parse('(x+1)^2').latex).toBe('(x+1)^2');
  });
});
