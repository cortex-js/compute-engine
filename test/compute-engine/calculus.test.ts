import type { BoxedExpression } from '../../src/compute-engine/types';
import { engine } from '../utils';

function parse(expr: string): BoxedExpression {
  return engine.parse(expr)!;
}

describe('CALCULUS', () => {
  describe('Numerical Integration', () => {
    test('Numeric integration', () => {
      // Stretching precision loss. Actual value: 0.210803
      expect(
        parse(
          `\\int_0^1 \\sech^2 (10(x − 0.2)) + \\sech^4 (100(x − 0.4)) + \\sech^6 (1000(x − 0.6)) dx`
        ).N().re
      ).toBeCloseTo(0.2, 1);

      // Correct value: 0.6366197723675813430755350534900574481378385829618257949906693762
      const result = parse(`\\int_0^1 \\sin(\\pi x) dx`).N().value as number;
      expect(result > 0.6 && result < 0.7).toBe(true);

      // Mathematica returns 2979.60, but with warnings about failure to converge.
      // expect(
      //   parse(`\\int_0^8 (e^x - \\mathrm{floor}(e^x)\\sin(x+e^x)) dx`).N().re! /
      //     10000
      // ).toBeCloseTo(0.3, 1);
    });

    it('should compute the numerical approximation of a trig function', () => {
      const expr = parse('\\mathrm{NIntegrate}(x \\mapsto \\sin x, 0, 1)');
      const result = expr.N().value as number;

      expect(Math.round(result * 100)).toMatchInlineSnapshot(`46`);
    });
  });
});
