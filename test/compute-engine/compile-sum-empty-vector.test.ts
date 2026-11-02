/**
 * A `Sum` or a `Product` whose body is a vector of a known length, over a
 * range that is empty at run time, compared with `evaluate()`.
 *
 * The interpreter answers the scalar identity for an empty range and adds
 * it to the terms around it by broadcast. The compiled code around such a
 * body reads the result by component, so the compiled empty value is the
 * identity in every component (`[0, 0, 0]`, `[1, 1, 1]`).
 *
 * The first case has the shape of a Tycho corpus expression (neyret,
 * ldadtpxkd5): the norm of `0.5·Σ_{i=1}^{n} sin(2π·H(i) + [x, y, z]·2^i)/2^i
 * + [x, y, z]`, minus 1, with `H` a function that returns a 3-vector.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

const ce = new ComputeEngine();
ce.declare('n', 'integer<0..10>');
for (const v of ['x', 'y', 'z']) ce.declare(v, 'real');
ce.parse('H(t) := [t, t^2, 1]').evaluate();

const CASES = [
  '\\Vert 0.5\\left(\\sum_{i=1}^{n}\\frac{\\sin(2\\pi H(i)+[x, y, z]\\times2^{i})}{2^{i}}\\right)+[x, y, z]\\Vert-1',
  '0.5\\left(\\sum_{i=1}^{n}[x, y, z]\\times i\\right)+[x, y, z]',
  '0.5\\left(\\prod_{i=1}^{n}[x, y, z]\\times i\\right)+[x, y, z]',
];

function numbers(v: unknown): number[] {
  return (Array.isArray(v) ? v : [v]).map(Number);
}

describe('EMPTY SUM AND PRODUCT OF A VECTOR BODY', () => {
  for (const latex of CASES) {
    for (const n of [0, 2]) {
      test(`${latex} at n = ${n}`, () => {
        const expr = ce.parse(latex);
        const result = compile(expr, { fallback: false });
        expect(result.success).toBe(true);
        const args = { n, x: -3.648, y: 3.851, z: -3.638 };
        const compiled = numbers(result.run!(args));
        const value = expr.subs(args).evaluate().N();
        const expected = isFunction(value)
          ? value.ops.map((op) => op.re)
          : [value.re];
        expect(compiled.length).toBe(expected.length);
        compiled.forEach((c, i) => expect(c).toBeCloseTo(expected[i], 10));
      });
    }
  }
});
