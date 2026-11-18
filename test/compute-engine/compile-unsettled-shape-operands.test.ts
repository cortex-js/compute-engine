import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Compiled code tests the shape of a value at run time only where an input
 * declared with a union of shapes is bound (rules R2 and R4 of "Shapes are
 * settled at compile time", `docs/COMPILATION-MODEL.md`). An operand of
 * another kind whose static type admits several shapes declines with the
 * code `'unsettled-shape'` (rule R3), where the code once tested its value
 * inside the body. The interpreter gives the value.
 */

describe('An operand that may be a point or a list', () => {
  // The absolute value of a point is its norm, and of a list of numbers the
  // list of the absolute values: only the value of `H(t)` tells which. The
  // compiled JavaScript gave `[3, 4]` for the point `(3, -4)`, where the
  // interpreter gives `5`.
  test.each(['javascript', 'glsl', 'interval-js'])(
    'the absolute value of a point or a list of numbers declines on %s',
    (to) => {
      const ce2 = new ComputeEngine();
      ce2.declare('H', '(real) -> list<number> | tuple<number, number>');
      ce2.declare('t', 'real');
      const r = compile(ce2.box(['Abs', ['H', 't']]), { to } as any) as any;
      expect(r.success).toBe(false);
      if (to === 'javascript')
        expect(r.diagnostic?.code).toBe('outside-profile');
    }
  );
});
