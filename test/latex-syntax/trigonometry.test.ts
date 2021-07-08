import { expression } from '../utils';

describe('TRIGONOMETRIC FUNCTIONS', () => {
  test('Trig functions with implicit argument', () => {
    expect(expression('\\cos x + 1')).toMatchInlineSnapshot(
      `['Add', ['Cos', 'x'], 1]`
    );
    expect(expression('\\cos x - \\sin x')).toMatchInlineSnapshot(
      `['Add', ['Negate', ['Sin', 'x']], ['Cos', 'x']]`
    );
    expect(expression('\\cos \\frac{x}{2}^2')).toMatchInlineSnapshot(
      `['Cos', ['Square', ['Divide', 'x', 2]]]`
    );
  });
  test('Trig functions with superscript', () => {
    expect(expression("\\sin^{-1}'(x)")).toMatchInlineSnapshot(
      `[['Derivative', 1, ['InverseFunction', 'Sin']], 'x']`
    );
    expect(expression("\\sin^{-1}''(x)")).toMatchInlineSnapshot(
      `[['Derivative', 2, ['InverseFunction', 'Sin']], 'x']`
    );
    expect(expression('\\cos^{-1\\doubleprime}(x)')).toMatchInlineSnapshot(
      `[['Derivative', 2, ['InverseFunction', 'Cos']], 'x']`
    );
    expect(expression('\\cos^{-1}\\doubleprime(x)')).toMatchInlineSnapshot(
      `[['Derivative', 2, ['InverseFunction', 'Cos']], 'x']`
    );
  });
});
