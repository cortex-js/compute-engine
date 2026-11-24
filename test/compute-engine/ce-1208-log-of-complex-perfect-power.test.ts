import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * CE-1208: `BoxedNumber.ln()` rewrites the logarithm of a positive integer
 * that holds a square or a cube (`ln 9 = 2 ln 3`). It read only the real part
 * of its argument, so `Ln(Complex(9, 9))` evaluated to `2 ln 3` and
 * `Log(Complex(4, 1))` to `2 log(2, 10)`: the imaginary part was lost. The
 * rewrite now applies only to a real argument.
 */

const ce = new ComputeEngine();

function close(a: { re: number; im: number }, b: { re: number; im: number }) {
  expect(a.re).toBeCloseTo(b.re, 12);
  expect(a.im).toBeCloseTo(b.im, 12);
}

describe('CE-1208: the logarithm of a complex number with a perfect-power real part', () => {
  test.each<[MathJsonExpression]>([
    [['Ln', ['Complex', 9, 9]]],
    [['Ln', ['Complex', 4, 4]]],
    [['Ln', ['Complex', 9, 3]]],
    [['Ln', ['Complex', 8, 1]]],
    [['Log', ['Complex', 4, 1]]],
    [['Log', ['Complex', 9, 2]]],
    [['Log', ['Complex', 8, 1], 2]],
  ])('evaluate() of %j keeps the imaginary part', (json) => {
    const expr = ce.expr(json);
    const viaEvaluate = expr.evaluate().N();
    const direct = expr.N();
    expect(direct.im).not.toBe(0);
    close(viaEvaluate, direct);
  });

  test('the product of the fuzzer witness keeps the imaginary part', () => {
    const expr = ce.expr(['Ln', ['Multiply', ['Complex', 1, 1], 3, 3]]);
    close(expr.evaluate().N(), {
      re: Math.log(Math.hypot(9, 9)),
      im: Math.PI / 4,
    });
  });

  test.each<[MathJsonExpression, MathJsonExpression]>([
    [
      ['Ln', 9],
      ['Multiply', 2, ['Ln', 3]],
    ],
    [
      ['Ln', 8],
      ['Multiply', 3, ['Ln', 2]],
    ],
    [
      ['Log', 4],
      ['Multiply', 2, ['Log', 2, 10]],
    ],
  ])('a real argument %j still reduces', (json, expected) => {
    expect(ce.expr(json).evaluate().json).toEqual(expected);
  });
});
