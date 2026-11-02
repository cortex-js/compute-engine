/**
 * A `Sum` or a `Product` whose body is a vector of a known length, over a
 * range that is empty at run time, compared with `evaluate()`.
 *
 * The value of an empty range is the identity in every component
 * (`[0, 0, 0]`, `[1, 1, 1]`), the identity of the static type
 * `vector<real^3>`, both in compiled code and in the interpreter. A consumer
 * that reads the shape (`Norm`) gives the same value in both.
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
  '\\Vert\\prod_{i=1}^{n}[x, y, z]\\times i\\Vert',
  '\\Vert\\sum_{i=1}^{n}[x, y, z]\\times i\\Vert',
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

describe('EMPTY SUM AND PRODUCT OF A VECTOR BODY, INTERPRETER', () => {
  const sum = ce.box([
    'Sum',
    ['Multiply', 'i', ['List', 'x', 'y', 'z']],
    ['Limits', 'i', 1, 0],
  ]);
  const product = ce.box([
    'Product',
    ['Multiply', 'i', ['List', 'x', 'y', 'z']],
    ['Limits', 'i', 1, 0],
  ]);
  test('evaluate()', () => {
    expect(sum.evaluate().json).toEqual(['List', 0, 0, 0]);
    expect(product.evaluate().json).toEqual(['List', 1, 1, 1]);
  });
  test('N()', () => {
    expect(sum.N().json).toEqual(['List', 0, 0, 0]);
    expect(product.N().json).toEqual(['List', 1, 1, 1]);
  });
  test('evaluateAsync()', async () => {
    expect((await sum.evaluateAsync()).json).toEqual(['List', 0, 0, 0]);
    expect((await product.evaluateAsync()).json).toEqual(['List', 1, 1, 1]);
  });
  test('simplify()', () => {
    expect(sum.simplify().json).toEqual(['List', 0, 0, 0]);
    expect(product.simplify().json).toEqual(['List', 1, 1, 1]);
  });
  test('a range with terms keeps its value', async () => {
    const two = ce.box([
      'Sum',
      ['Multiply', 'i', ['List', 1, 2, 3]],
      ['Limits', 'i', 1, 2],
    ]);
    expect(two.evaluate().json).toEqual(['List', 3, 6, 9]);
    expect((await two.evaluateAsync()).json).toEqual(['List', 3, 6, 9]);
  });
  test('a list folded as a whole keeps its value', async () => {
    // `PointX(pointsCE786)` is not a collection before it is evaluated, so
    // `Sum` folds its value as a whole list, without a term per element.
    ce.assign(
      'pointsCE786',
      ce.box(['List', ['Tuple', 1.5, 2], ['Tuple', 3, 4]])
    );
    const total = ce.box(['Sum', ['PointX', 'pointsCE786']]);
    expect(total.evaluate().re).toBe(4.5);
    expect(total.N().re).toBe(4.5);
    expect((await total.evaluateAsync()).re).toBe(4.5);
  });
  test('a scalar body keeps the scalar identity', () => {
    const scalar = ce.box([
      'Sum',
      ['Multiply', 'i', 'x'],
      ['Limits', 'i', 1, 0],
    ]);
    expect(scalar.evaluate().json).toEqual(0);
  });
});
