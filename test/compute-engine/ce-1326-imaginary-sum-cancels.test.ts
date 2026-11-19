import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// A SUM OF INEXACT IMAGINARY NUMBERS THAT CANCEL (CE-1326)
//
// The canonical form of a sum combines the inexact pure-imaginary literals
// into one literal (`canonicalAdd()`, `boxed-expression/arithmetic-add.ts`),
// and imaginary parts that cancel leave no term (`x + 2.5i - 2.5i` is `x`).
// When no other term was left, the sum was an `Add` with no operand, and
// evaluating it threw a `TypeError`. The sum is the empty sum, `0`.
//

const ce = new ComputeEngine();

describe('CE-1326: INEXACT IMAGINARY NUMBERS THAT CANCEL', () => {
  test('the parsed sum is 0', () => {
    const expr = ce.parse('2.5i-2.5i');
    expect(expr.json).toEqual(0);
    expect(expr.evaluate().json).toEqual(0);
    expect(expr.N().json).toEqual(0);
  });

  test('the MathJSON sum is 0', () => {
    const expr = ce.box(['Add', ['Complex', 0, 2.5], ['Complex', 0, -2.5]]);
    expect(expr.json).toEqual(0);
    expect(expr.evaluate().json).toEqual(0);
    expect(expr.N().json).toEqual(0);
  });

  test('a sum of machine complex numbers that cancel is 0', () => {
    const expr = ce.function('Add', [
      ce.number(ce.complex(0, 2)),
      ce.number(ce.complex(0, -2)),
    ]);
    expect(expr.evaluate().json).toEqual(0);
    expect(expr.N().json).toEqual(0);
  });

  test('the same value as the sum with another term, less that term', () => {
    expect(ce.parse('x+2.5i-2.5i').json).toEqual('x');
    expect(
      ce.box(['Add', 'x', ['Complex', 0, 2.5], ['Complex', 0, -2.5]]).json
    ).toEqual('x');
  });

  test('the same value as exact imaginary numbers that cancel', () => {
    expect(ce.parse('2i-2i').N().json).toEqual(0);
  });

  test('the compiled value is 0', () => {
    const result = compile(ce.parse('2.5i-2.5i'), { fallback: false });
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(0);
  });
});
