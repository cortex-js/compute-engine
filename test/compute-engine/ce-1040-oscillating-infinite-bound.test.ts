import { ComputeEngine } from '../../src/compute-engine';

// CE-1040: at an infinite bound, the definite integral substitutes the bound
// into the antiderivative. The value of `sin(xy)/y` at `x = +∞` is
// `sin((+∞)·y)/y`, but `sin(xy)` oscillates and has no limit there, so
// `∫₀^∞ cos(xy) dx` diverges. Before, `evaluate()` returned that formula with
// an infinity inside the `sin`. Now the integral stays unevaluated, as it
// does for a number frequency (`∫₀^∞ cos(2x) dx`). An infinity that only
// arithmetic holds keeps its value (`∫₀^∞ y dx` is `(+∞)·y`), and so does an
// infinity inside a function with a limit at `±∞` (`∫₀^∞ sin(ax)/x dx` is
// `SinIntegral((+∞)·a)`).

const ce = new ComputeEngine();

describe('CE-1040: an oscillating integrand over an infinite range', () => {
  test.each([
    '\\int_0^\\infty \\cos(xy)\\,dx',
    '\\int_0^\\infty \\sin(xy)\\,dx',
    '\\int_{-\\infty}^0 \\cos(xy)\\,dx',
    '\\int_0^\\infty \\cos(2x)\\,dx',
  ])('%s stays unevaluated', (latex) => {
    expect(ce.parse(latex).evaluate().operator).toBe('Integrate');
  });

  test('an infinity held by arithmetic is kept', () => {
    expect(ce.parse('\\int_0^\\infty y\\,dx').evaluate().json).toEqual([
      'Multiply',
      'PositiveInfinity',
      'y',
    ]);
    expect(ce.parse('\\int_1^\\infty \\frac{a}{x}\\,dx').evaluate().json).toEqual(
      ['Multiply', 'PositiveInfinity', 'a']
    );
  });

  test('an infinity inside a function with a limit at infinity is kept', () => {
    expect(
      ce.parse('\\int_0^\\infty \\frac{\\sin(ax)}{x}\\,dx').evaluate().json
    ).toEqual(['SinIntegral', ['Multiply', 'PositiveInfinity', 'a']]);
    expect(
      ce.parse('\\int_0^\\infty \\mathrm{sech}(ax)\\,dx').evaluate().json
    ).toEqual([
      'Divide',
      ['Arctan', ['Sinh', ['Multiply', 'PositiveInfinity', 'a']]],
      'a',
    ]);
    expect(ce.parse('\\int_0^\\infty \\tanh(ax)\\,dx').evaluate().json).toEqual(
      ['Divide', ['Ln', ['Cosh', ['Multiply', 'PositiveInfinity', 'a']]], 'a']
    );
  });

  test('a leak with a known limit is still resolved', () => {
    expect(ce.parse('\\int_0^\\infty e^{-ax}\\,dx').evaluate().json).toEqual([
      'If',
      ['Less', 0, 'a'],
      ['Divide', 1, 'a'],
    ]);
  });
});
