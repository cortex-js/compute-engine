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

const POINT_OR_POINTS = 'tuple<real, real> | list<tuple<real, real>>';

function declines(
  ce: ComputeEngine,
  json: unknown,
  functions?: Record<string, unknown>
): void {
  const r = compile(ce.box(json as any), {
    to: 'javascript',
    ...(functions ? { functions } : {}),
  } as any) as any;
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('unsettled-shape');
}

describe('A sum of a list of points and a value that may be a point or a list of points', () => {
  const ce = new ComputeEngine();
  ce.declare('W', `(real) -> ${POINT_OR_POINTS}`);
  ce.declare('L', 'list<tuple<real, real>>');
  ce.declare('t', 'real');
  ce.declare('P', POINT_OR_POINTS);

  test('the result of a host function declines', () => {
    declines(ce, ['Add', ['W', 't'], 'L'], { W: (t: number) => [t, t] });
  });

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
      const r = compile(ce2.box(['Abs', ['H', 't']]), {
        to,
        functions: { H: (t: number) => [3 * t, -4 * t] },
      } as any) as any;
      expect(r.success).toBe(false);
      if (to === 'javascript')
        expect(r.diagnostic?.code).toBe('unsettled-shape');
    }
  );

  // An input declared with the union is tested where it is bound, and
  // each body adds one shape.
  test.each([
    [[1, 2], [[2, 3], [3, 4]]],
    [[[1, 2], [3, 4]], [[2, 3], [5, 6]]],
  ])('an input declared with the union compiles: P = %j', (P, expected) => {
    const r = compile(ce.box(['Add', 'P', 'L']), {
      to: 'javascript',
    }) as any;
    expect(r.success).toBe(true);
    expect(r.run({ P, L: [[1, 1], [2, 2]] })).toEqual(expected);
  });
});
