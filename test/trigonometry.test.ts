import { expression } from './utils';

describe('TRIGONOMETRIC FUNCTIONS', () => {
  test('Trig functions with implicit argument', () => {
    expect(expression('\\cos x + 1')).toMatchInlineSnapshot(
      `['Add', ['Cos', 'x'], 1]`
    );
    expect(expression('\\cos x - \\sin x')).toMatchInlineSnapshot(
      `['Add', ['Cos', 'x'], ['Multiply', -1, ['Sin', 'x']]]`
    );
    expect(expression('\\cos \\frac{x}{2}^2')).toMatchInlineSnapshot(
      `['Cos', ['Power', ['Multiply', ['Power', 2, -1], 'x'], 2]]`
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
