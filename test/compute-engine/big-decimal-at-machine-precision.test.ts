import { ComputeEngine } from '../../src/compute-engine';

// A number made at a higher precision keeps its big decimal when the
// precision of the engine is lowered to machine precision. The kernels that
// round their result (`sqrt`, `ln`, `exp`, `inv`, `root`, `div`, `pow`,
// `abs`, and a product by an exact rational) then give a double, computed
// from all the digits of the operands: they gave 15 digits, two fewer than a
// double.

function engineWithValues(latex: string[]) {
  const ce = new ComputeEngine();
  ce.precision = 30;
  const values = latex.map((s) => ce.parse(s).N());
  ce.precision = 'machine';
  return { ce, values };
}

describe('A BIG DECIMAL AT MACHINE PRECISION', () => {
  test('has a square root with the digits of a double', () => {
    const { ce, values } = engineWithValues(['0.3']);
    const [a] = values;
    expect(ce.expr(['Sqrt', a]).evaluate().re).toBe(Math.sqrt(0.3));
    expect(ce.expr(['Sqrt', a]).evaluate().toString()).toBe(
      '0.5477225575051661'
    );
    expect(ce.expr(['Sqrt', a]).N().re).toBe(Math.sqrt(0.3));
  });

  test('gives the Frobenius norm of a matrix the value of the vector norm', () => {
    const { ce, values } = engineWithValues(['0.3', '0.7']);
    const [a, b] = values;
    const matrix = ce
      .expr(['Norm', ['List', ['List', a, 1], ['List', 2, b]]])
      .evaluate();
    const vector = ce.expr(['Norm', ['List', a, 1, 2, b]]).evaluate();
    expect(matrix.re).toBe(Math.sqrt(5.58));
    expect(matrix.re).toBe(vector.re);
  });

  test('has an exponential and a logarithm with the digits of a double', () => {
    const { ce, values } = engineWithValues(['0.3']);
    const [a] = values;
    expect(ce.expr(['Exp', a]).evaluate().re).toBe(Math.exp(0.3));
    // The correctly rounded `ln 0.3`: the double `0.3` is a little less
    // than 0.3, so `Math.log(0.3)` is one unit in the last place away.
    expect(ce.expr(['Ln', a]).evaluate().re).toBe(-1.203972804325936);
  });

  test('has a quotient with the digits of a double', () => {
    const { ce, values } = engineWithValues(['0.3', '0.7']);
    const [a, b] = values;
    // The double nearest to 3/7. The quotient of the doubles `0.3` and
    // `0.7` is the next double, `0.4285714285714286`.
    expect(ce.expr(['Divide', a, b]).evaluate().re).toBe(0.42857142857142855);
  });

  // A quotient by an exact integer is the product with an exact rational
  // (CE-1789).
  test('has a quotient by an exact integer with the digits of a double', () => {
    const { ce, values } = engineWithValues(['0.3', '0.3+0.2i']);
    const [a, z] = values;
    expect(ce.expr(['Divide', a, 7]).N().toString()).toBe(
      '0.04285714285714286'
    );
    expect(ce.expr(['Multiply', a, ['Rational', 3, 7]]).N().re).toBe(
      0.12857142857142856
    );
    const w = ce.expr(['Divide', z, 7]).N();
    expect(w.re).toBe(0.04285714285714286);
    expect(w.im).toBe(0.02857142857142857);
    expect(w.toString()).toBe(
      '(0.04285714285714286 + 0.02857142857142857i)'
    );
  });

  test('has an integer power from all the digits of the base', () => {
    const { ce, values } = engineWithValues(['0.3']);
    const [a] = values;
    // `0.3 ** 3` is `0.026999999999999996`: the double `0.3` is not 0.3.
    expect(ce.expr(['Power', a, 3]).evaluate().re).toBe(0.027);
  });

  test('has a complex square root and modulus with the digits of a double', () => {
    const { ce, values } = engineWithValues(['0.3+0.4i']);
    const [z] = values;
    const root = ce.expr(['Sqrt', z]).evaluate();
    expect(root.re).toBe(0.6324555320336759);
    expect(root.im).toBe(0.31622776601683794);
    expect(ce.expr(['Abs', z]).evaluate().re).toBe(0.5);
  });

  test('keeps a big decimal for a value that a double cannot hold', () => {
    const { ce, values } = engineWithValues(['10^{-800}', '10^{400}']);
    const [tiny, huge] = values;
    expect(ce.expr(['Sqrt', tiny]).evaluate().toString()).toBe('1e-400');
    expect(ce.expr(['Sqrt', huge]).evaluate().re).toBe(1e200);
  });

  test('has the logarithm of a value near 1 from all its digits', () => {
    // The double of the operand is 1, and its logarithm would be 0.
    const { ce, values } = engineWithValues(['1.000000000000000000001']);
    const [x] = values;
    expect(ce.expr(['Ln', x]).evaluate().re).toBe(1e-21);
  });

  // The two-argument kernels (`apply2()`): `Power` with a float exponent,
  // `Root`, `Arctan2`, `Log` with a base.
  test('has a power with a float exponent with the digits of a double', () => {
    const { ce, values } = engineWithValues(['0.3']);
    const [a] = values;
    expect(ce.expr(['Power', a, 0.5]).evaluate().toString()).toBe(
      '0.5477225575051661'
    );
    expect(ce.expr(['Power', 2, a]).evaluate().re).toBe(Math.pow(2, 0.3));
  });

  test('has a root with the digits of a double', () => {
    const { ce, values } = engineWithValues(['0.3']);
    const [a] = values;
    expect(ce.expr(['Root', a, 3]).evaluate().re).toBe(Math.cbrt(0.3));
    expect(ce.expr(['Root', a, 4]).evaluate().re).toBe(0.7400828044922853);
  });

  test('has an angle and a logarithm with a base with the digits of a double', () => {
    const { ce, values } = engineWithValues(['0.3']);
    const [a] = values;
    expect(ce.expr(['Arctan2', a, 1]).evaluate().re).toBe(Math.atan(0.3));
    // The correctly rounded `log₂ 0.3`: `Math.log2(0.3)` is one unit in the
    // last place away.
    expect(ce.expr(['Log', a, 2]).N().re).toBe(-1.736965594166206);
  });

  // The kernel of `Mod` is exact (`BigDecimal.add()` does not round to its
  // precision argument), so this test pins the machine-precision lane only.
  test('has a floored remainder with the digits of a double', () => {
    const { ce, values } = engineWithValues(['0.123456789012345678']);
    const [a] = values;
    expect(ce.expr(['Mod', a, 1]).evaluate().re).toBe(0.12345678901234568);
  });

  test('keeps a big decimal for a power that a double cannot hold', () => {
    const { ce, values } = engineWithValues(['10^{-800}']);
    const [tiny] = values;
    expect(ce.expr(['Power', tiny, 0.5]).evaluate().toString()).toBe(
      '1e-400'
    );
  });

  test('keeps the digits of a raised precision', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const a = ce.parse('0.3').N();
    expect(ce.expr(['Sqrt', a]).evaluate().toString()).toBe(
      '0.547722557505166113456969782801'
    );
  });
});

// An integer computed by a function (`4 + 5`) is an exact numeric value with
// a big decimal; the same integer written as a number is a plain number. At
// machine precision both select the double kernel (CE-1790).
describe('A small integer computed by a function at machine precision', () => {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const value = (expr: any) => ce.box(expr).evaluate().re;

  test('gives a power the value of a literal exponent', () => {
    expect(value(['Power', 1.1, ['Add', 4, 5]])).toBe(Math.pow(1.1, 9));
    expect(value(['Power', 1.1, ['Add', 4, 5]])).toBe(value(['Power', 1.1, 9]));
    // A power of a double that a double cannot hold is the value of
    // `Math.pow()`, with a computed exponent as with a literal one.
    expect(value(['Power', 0.1, ['Add', 200, 200]])).toBe(
      value(['Power', 0.1, 400])
    );
  });

  test('gives a remainder the value of a literal operand', () => {
    expect(value(['Remainder', ['Add', 2, 3], 0.7])).toBe(
      value(['Remainder', 5, 0.7])
    );
    expect(value(['Mod', ['Add', 3, 4], 0.3])).toBe(value(['Mod', 7, 0.3]));
  });
});
