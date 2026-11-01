/**
 * Limits at `+∞` that need a base or an operand that is positive for every
 * large enough `x`.
 *
 * The rule `f^g → exp(g·ln f)` and the rule `ln u − ln v → ln(u/v)` are
 * true only when `f`, `u` and `v` are positive. These rules took one numeric
 * value at `x = 120` as the proof. `130 − x` is positive at 120 and negative
 * for `x > 130`, so `ln(x) − ln(130 − x)` was combined to `ln(x/(130 − x))`,
 * with the limit `ln(−1) = iπ`. The limit is `−iπ`: for `x > 130`,
 * `ln(130 − x) = ln(x − 130) + iπ`. `sin(x) + 0.9` is positive at 120 but
 * changes sign again and again, so `(sin(x) + 0.9)^{1/x}` has no limit (it is
 * 0 at each zero of the base), but the result was 1.
 *
 * The sign is now proved from the form of the operand only. Otherwise, the
 * limit stays unevaluated. A limit of the operand that is `+∞` or a positive
 * number is not a proof, because the limit computation can read a sign from
 * numeric probes: `x/(1/2 + sin(2πx))` is positive at each probe, but it
 * changes sign.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

function limitAtInfinity(body: unknown): string {
  return ce
    .box(['Limit', ['Function', body, 'x'], 'PositiveInfinity'] as any)
    .evaluate()
    .toString();
}

describe('limit at +∞ with an operand that changes sign after x = 120', () => {
  test('ln(x) − ln(130 − x) is not combined to ln(−1)', () => {
    expect(
      limitAtInfinity(['Subtract', ['Ln', 'x'], ['Ln', ['Subtract', 130, 'x']]])
    ).toBe('lim_(x -> +oo) {-ln(130 - x) + ln(x)}');
  });

  test('ln(x²) − ln(130x − x²) is not combined to ln(−1)', () => {
    expect(
      limitAtInfinity([
        'Subtract',
        ['Ln', ['Power', 'x', 2]],
        ['Ln', ['Subtract', ['Multiply', 130, 'x'], ['Power', 'x', 2]]],
      ])
    ).toBe('lim_(x -> +oo) {ln(x^2) - ln(-x^2 + 130x)}');
  });

  test('(sin(x) + 0.9)^{1/x} has no limit', () => {
    expect(
      limitAtInfinity([
        'Power',
        ['Add', ['Sin', 'x'], 0.9],
        ['Divide', 1, 'x'],
      ])
    ).toBe('lim_(x -> +oo) {(sin(x) + 0.9)^(1 / x)}');
  });
});

describe('limit at +∞ with an operand whose limit is read from probes', () => {
  // The limit of each operand below is `+∞` when it is computed, but its
  // sign is read from numeric probes, so it does not prove that the operand
  // is positive.
  const limitOfLatex = (latex: string): string =>
    ce.parse(`\\lim_{x\\to\\infty}${latex}`).evaluate().toString();

  test('(x/(1/2 + sin(2πx)))^{1/x} has no limit', () => {
    // The base changes sign at each period. The wrong value was 1.
    expect(limitOfLatex('(\\frac{x}{1/2+\\sin(2\\pi x)})^{1/x}')).toBe(
      'lim_(x -> +oo) {(x / (sin(2pi * x) + 1/2))^(1 / x)}'
    );
  });

  test('ln(x³/(√x + 1)) − ln(x³/(10⁵ − √x)) is not −∞', () => {
    // `10⁵ − √x` is negative for `x > 10¹⁰`, so the limit is `−iπ`.
    expect(
      limitOfLatex(
        '(\\ln(\\frac{x^3}{\\sqrt x+1})-\\ln(\\frac{x^3}{10^5-\\sqrt x}))'
      )
    ).toBe(
      'lim_(x -> +oo) {-ln(x^3 / (100000 - sqrt(x))) + ln(x^3 / (sqrt(x) + 1))}'
    );
  });

  test('(x³/(10⁵ − √x))^{1/ln x} is not +∞', () => {
    // The limit is `e^{2.5}`: for `x > 10¹⁰` the base is about `−x^{2.5}`,
    // so the power has the modulus `e^{2.5}` and the argument `π/ln x`,
    // which tends to 0.
    expect(limitOfLatex('(\\frac{x^3}{10^5-\\sqrt x})^{1/\\ln x}')).toBe(
      'lim_(x -> +oo) {(x^3 / (100000 - sqrt(x)))^(1 / ln(x))}'
    );
  });
});

describe('limit at +∞ with an operand that is proved positive', () => {
  test('the sign is proved from the form', () => {
    expect(
      limitAtInfinity(['Power', ['Add', 'x', 130], ['Divide', 1, 'x']])
    ).toBe('1');
    expect(
      limitAtInfinity([
        'Multiply',
        'x',
        ['Subtract', ['Ln', ['Add', 'x', 1]], ['Ln', 'x']],
      ])
    ).toBe('1');
    expect(
      limitAtInfinity([
        'Subtract',
        ['Sqrt', ['Add', ['Power', 'x', 2], 'x']],
        'x',
      ])
    ).toBe('1/2');
  });

  test('the sign of ln, exp, sin and cos is proved from the form', () => {
    expect(
      limitAtInfinity([
        'Power',
        ['Add', ['Exp', 'x'], 'x'],
        ['Divide', 1, 'x'],
      ])
    ).toBe('e');
    expect(
      limitAtInfinity([
        'Power',
        ['Add', 1, ['Sin', ['Divide', 1, 'x']]],
        'x',
      ])
    ).toBe('e');
    expect(limitAtInfinity(['Power', ['Ln', 'x'], ['Divide', 1, 'x']])).toBe(
      '1'
    );
    expect(
      limitAtInfinity([
        'Power',
        ['Cos', ['Divide', 1, 'x']],
        ['Power', 'x', 2],
      ])
    ).toBe('sqrt(1 / e)');
  });
});
