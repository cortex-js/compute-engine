// A sum or a product with a very large number of operands. The `Add` and
// `Multiply` evaluate handlers passed the operands to `add()` and
// `mulFactored()` as separate arguments (`add(...evaluated)`), and JavaScript
// throws `RangeError: Maximum call stack size exceeded` when a call has too
// many arguments (about 100 000 or more). They now pass one array
// (`addArray()`, `mulFactoredArray()`).
//
// The `.N()` route of a product folded its factors with a recursion that used
// one stack frame per factor (`expandProducts()`), and threw the same error at
// about 8 000 factors. It is now a loop.

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const N = 200_000;
// A product costs about 0.1 ms per factor under jest, so the product test uses
// the smallest size that is safely above the argument limit of a call
// (between 120 000 and 125 000 under Node).
const N_PRODUCT = 130_000;

// Each operand is a distinct node object.
const twoPlusPi = () => ce.function('Add', [ce.number(2), ce.symbol('Pi')]);
const twoPlusSqrt3 = () =>
  ce.function('Add', [ce.number(2), ce.function('Sqrt', [ce.number(3)])]);
const twoMinusSqrt3 = () =>
  ce.function('Subtract', [ce.number(2), ce.function('Sqrt', [ce.number(3)])]);

describe('ARITHMETIC WITH MANY OPERANDS', () => {
  test(`a sum of ${N} operands evaluates to its exact value`, () => {
    const sum = ce.function('Add', Array.from({ length: N }, twoPlusPi));
    // The canonical form keeps one `Pi` term for each operand.
    expect(sum.nops).toBeGreaterThan(N);
    const value = sum.evaluate();
    expect(value.isSame(ce.parse(`${2 * N} + ${N}\\pi`))).toBe(true);
    expect(sum.N().re).toBeCloseTo(N * (2 + Math.PI), 6);
  }, 60_000);

  test(`a product of ${N_PRODUCT} operands evaluates to its exact value`, () => {
    const product = ce.function(
      'Multiply',
      Array.from({ length: N_PRODUCT }, twoPlusSqrt3)
    );
    expect(product.nops).toBe(N_PRODUCT);
    const value = product.evaluate();
    expect(value.isSame(ce.parse(`(2+\\sqrt{3})^{${N_PRODUCT}}`))).toBe(true);
  }, 60_000);

  test('the numeric value of a product of 20 000 operands', () => {
    // (2 + √3)(2 − √3) = 1, so the product of the alternating factors is 1.
    const product = ce.function(
      'Multiply',
      Array.from({ length: 20_000 }, (_, i) =>
        i % 2 === 0 ? twoPlusSqrt3() : twoMinusSqrt3()
      )
    );
    expect(product.nops).toBe(20_000);
    expect(product.N().re).toBeCloseTo(1, 10);
  }, 60_000);
});
