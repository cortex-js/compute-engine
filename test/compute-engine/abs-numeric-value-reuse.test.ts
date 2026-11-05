/**
 * A sum or a product reads the numeric coefficient of each term
 * (`toNumericValue()`). For `Abs(u)` with no coefficient to extract, the
 * rest is the node itself, not a new `Abs` node: a new node computes its
 * type again. The type of `Abs` of an operand that may be NaN is one frozen
 * union for each magnitude, so its facts are computed once.
 *
 * Both made the elements of an evaluated broadcast slow to read: each read
 * of `\sum_{n=0}^{3} 2^{-n} |\sin(2^n x + [0...999]/1000)|` built about 38
 * `Abs` nodes and 37 copies of the union for an element that holds 4 `Abs`.
 */
import { ComputeEngine } from '../../src/compute-engine';

describe('ABS NODE AND TYPE REUSE', () => {
  test('Abs with no coefficient gives itself as the rest', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Abs', ['Sin', 'x']]);
    const [coef, rest] = e.toNumericValue();
    expect(coef.isOne).toBe(true);
    expect(rest).toBe(e);
  });

  test('Abs with a coefficient still extracts it', () => {
    const ce = new ComputeEngine();
    const [coef, rest] = ce.box(['Abs', ['Multiply', -3, 'x']]).toNumericValue();
    expect(coef.toString()).toBe('3');
    expect(rest.json).toEqual(['Abs', 'x']);
  });

  test('Abs of an operand that may be NaN has one shared, frozen type', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real | signed_infinity | nan');
    ce.declare('b', 'real | signed_infinity | nan');
    const ta = ce.box(['Abs', 'a']).type;
    const tb = ce.box(['Abs', 'b']).type;
    expect(ta.toString()).toBe('nan | real<0..> | signed_infinity');
    expect(tb.type).toBe(ta.type);
    expect(Object.isFrozen(ta.type)).toBe(true);
  });

  test('the elements of the broadcast keep their values', () => {
    const ce = new ComputeEngine();
    const xs = [
      ...ce
        .parse(
          String.raw`\sum_{n=0}^{1}\frac{1}{2^n}\operatorname{abs}\left(\sin\left(2^nx+\frac{[0...2]}{2}\right)\right)`
        )
        .evaluate()
        .each(),
    ];
    expect(xs.map((x) => x.toString())).toEqual([
      '1/2 * |sin(2x)| + |sin(x)|',
      '1/2 * |sin(2x + 1/2)| + |sin(x + 1/2)|',
      '1/2 * |sin(2x + 1)| + |sin(x + 1)|',
    ]);
  });
});
