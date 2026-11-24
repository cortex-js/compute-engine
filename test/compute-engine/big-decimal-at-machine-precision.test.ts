import { ComputeEngine } from '../../src/compute-engine';

// A number made at a higher precision keeps its big decimal when the
// precision of the engine is lowered to machine precision. The kernels that
// round their result (`sqrt`, `ln`, `exp`, `inv`, `root`, `div`, `pow`,
// `abs`) then give a double, computed from all the digits of the operands:
// they gave 15 digits, two fewer than a double.

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

  test('keeps the digits of a raised precision', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const a = ce.parse('0.3').N();
    expect(ce.expr(['Sqrt', a]).evaluate().toString()).toBe(
      '0.547722557505166113456969782801'
    );
  });
});
