import { BoxedExpression } from '../../src/compute-engine/public';
import { engine } from '../utils';

function parse(expr: string): BoxedExpression {
  return engine.parse(expr)!;
}

describe('CALCULUS', () => {
  describe('D', () => {
    it('should compute the partial derivative of a polynomial', () => {
      const expr = parse('D(x^3 + 2x - 4, x)');
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`3x^2+2`);
    });

    it('should compute the partial derivative of a function with respect to a variable', () => {
      const expr = parse('D(x^2 + y^2, x)');
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`2x`);
    });

    it('should compute higher order partial derivatives', () => {
      const expr = parse('D(D(x^2 + y^2, x), x)');
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`2`);
    });

    it('should compute the partial derivative of a function with respect to a variable in a multivariable function with multiple variables', () => {
      const expr = parse('D(5x^3 + 7y^5 + 11z^{13}, x, x)');
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`30x`);
    });

    it('should compute the partial derivative of a function with respect to a variable in a multivariable function with multiple variables', () => {
      const expr = parse('D(x^2 + y^2 + z^2, x, y, z)');
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`0`);
    });

    it('should compute the partial derivative of a trigonometric function', () => {
      const expr = parse('D(\\sin(x), x)');
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`\\cos(x)`);
    });

    // \frac{2x+2}{x^2+2x}-\frac{\cos(\frac{1}{x})}{x^2}
    it('should compute a complex partial derivative', () => {
      const expr = parse('D(\\sin(\\frac{1}{x}) + \\ln(x^2+2x), x)');
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(
        `\\frac{2(x+1)}{2x+x^2}-\\frac{\\cos(\\frac{1}{x})}{x^2}`
      );
    });
  });

  describe('Derivative', () => {
    it('should compute the derivative of a function', () => {
      const expr = engine.box(['Derivative', 'Sin']);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`\\sin^{\\prime}`);
    });

    it('should compute higher order derivatives', () => {
      const expr = engine.box([
        'Derivative',
        ['Function', ['Square', 'x'], 'x'],
        2,
      ]);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(
        `x\\mapsto x^2^{\\doubleprime}`
      );
    });

    it('should compute the derivative of a function with respect to a specific variable', () => {
      const expr = engine.box([
        'Derivative',
        ['Function', ['Add', 'x', 'u'], 'x', 'y'],
        0,
        1,
      ]);

      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`(x, y)\\mapsto x+u^{(0)}`);
    });
  });

  describe('ND', () => {
    it('should compute the numerical approximation of the derivative of a polynomial', () => {
      const expr = parse('\\mathrm{ND}(x \\mapsto x^3 + 2x - 4, 2)');
      const result = expr.N();
      expect(result.json).toMatchInlineSnapshot(`13.999999999999991`);
    });

    it('should compute the numerical approximation of the derivative of an expression', () => {
      const expr = parse('\\mathrm{ND}(x \\mapsto \\cos x + 2x^3 - 4, 2)');
      const result = expr.N();
      expect(result.json).toMatchInlineSnapshot(`23.090702573188704`);
    });
  });

  describe('Numerical Integration', () => {
    test('Numeric integration', () => {
      // Stretching precision loss. Actual value: 0.210803
      expect(
        parse(
          `\\int_0^1 \\sech^2 (10(x − 0.2)) + \\sech^4 (100(x − 0.4)) + \\sech^6 (1000(x − 0.6)) dx`
        ).N()
      ).toMatchInlineSnapshot(`
        [
          "Sequence",
          [
            "Integrate",
            [
              "Power",
              [
                "Error",
                [
                  "ErrorCode",
                  "'incompatible-domain'",
                  "Numbers",
                  ["FunctionOf", "Numbers", "Numbers"]
                ],
                "Sech"
              ],
              2
            ],
            ["Triple", "Nothing", 0, 1]
          ],
          ["Error", ["ErrorCode", "'unexpected-token'", "'('"]]
        ]
      `);

      // Correct value: 0.6366197723675813430755350534900574481378385829618257949906693762
      const result = parse(`\\int_0^1 \\sin(\\pi x) dx`).N().value as number;
      expect(result > 0.6 && result < 0.7).toBe(true);

      // Correct value: 0.09865170447836520611965824976485985650416962079238449145 10919068308266804822906098396240645824
      expect(parse(`\\int_0^8 (e^x - \\floor(e^x)\\sin(x+e^x) dx`).N())
        .toMatchInlineSnapshot(`
        [
          "Sequence",
          ["Integrate", "Nothing", ["Triple", "Nothing", 0, 8]],
          ["Error", ["ErrorCode", "'unexpected-token'", "'('"]]
        ]
      `);
    });

    it('should compute the numerical approximation of a trig function', () => {
      const expr = parse('\\mathrm{NIntegrate}(x \\mapsto \\sin x, 0, 1)');
      const result = expr.value as number;

      expect(Math.round(result * 100)).toMatchInlineSnapshot(`46`);
    });
  });
});
