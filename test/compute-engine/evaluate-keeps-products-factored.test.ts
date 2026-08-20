import { ComputeEngine } from '../../src/compute-engine';

/**
 * `evaluate()` leaves a product of sums FACTORED (user ruling, 2026-08-20).
 *
 * `evaluate()`'s contract is the most EXACT form, and a factored product is
 * exactly as exact as the polynomial it expands to while being smaller — often
 * dramatically so, since expanding multiplies the term count at every factor.
 * That is what made a `Product` of linear factors superlinear for a plotting
 * consumer, who can never bind the axis variable and so always paid the
 * free-symbol cost. Opening the product is `expand()`'s job.
 *
 * The cut is deliberately NARROW: only the `Multiply` evaluate handler declines
 * to distribute (it calls `mulFactored`). `mul()` itself, `simplify()` and
 * `.N()` still expand, because several normalization paths depend on that
 * expansion to reach a fixpoint — sum simplification, the cyclic
 * integration-by-parts family, series at infinity, and the 3×3 symbolic
 * determinant behind `CharacteristicPolynomial`. Removing the distribution
 * from `mul()` engine-wide left the rule engine NON-TERMINATING, so these pins
 * exist to stop the cut being widened by mistake as much as to stop it being
 * reverted.
 */

describe('a product of sums survives evaluate() factored', () => {
  test('two sums are not multiplied out', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Multiply', ['Add', 'a', 'b'], ['Add', 'c', 'd']])
        .evaluate()
        .toString()
    ).toEqual('(a + b) * (c + d)');
  });

  test('a scalar is not distributed over a sum', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Multiply', 2, ['Add', 'x', 1]])
        .evaluate()
        .toString()
    ).toEqual('2(x + 1)');
    expect(
      ce
        .box(['Multiply', 'a', ['Add', 'b', 'c']])
        .evaluate()
        .toString()
    ).toEqual('a * (b + c)');
  });

  test('`Expand` reproduces the previous output', () => {
    const ce = new ComputeEngine();
    const product = ce.box(['Multiply', ['Add', 'a', 'b'], ['Add', 'c', 'd']]);
    expect(ce.box(['Expand', product]).evaluate().toString()).toEqual(
      'a * c + b * c + a * d + b * d'
    );
    // The two forms are the same value, not merely the same shape.
    for (const v of [0.5, 2, -3.25]) {
      const at = (e: ReturnType<ComputeEngine['box']>) =>
        e
          .subs({
            a: ce.number(v),
            b: ce.number(1),
            c: ce.number(2),
            d: ce.number(v),
          })
          .N().re;
      expect(at(product.evaluate())).toBeCloseTo(
        at(ce.box(['Expand', product]).evaluate())!,
        10
      );
    }
  });

  test('a sum reachable through a Divide or Negate is not distributed', () => {
    // The distribution helper recurses through `Negate` and through a
    // `Divide`'s NUMERATOR before it finds a sum, so testing only the
    // top-level operand missed these: `((a+b)/c)·d` still came back
    // `(ad + bd)/c`. This is the rational-linear-factor shape a factored
    // product is most wanted for.
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Multiply', ['Divide', ['Add', 'a', 'b'], 'c'], 'd'])
        .evaluate()
        .toString()
    ).toEqual('(d * (a + b)) / c');
    expect(
      ce
        .box([
          'Multiply',
          ['Divide', ['Add', 'a', 'b'], 'c'],
          ['Divide', ['Add', 'd', 'e'], 'f'],
        ])
        .evaluate()
        .toString()
    ).toEqual('((a + b) * (d + e)) / (c * f)');
    expect(
      ce
        .box(['Multiply', ['Negate', ['Add', 'a', 'b']], 'd'])
        .evaluate()
        .toString()
    ).toEqual('-(d * (a + b))');
  });

  test('a Product of linear factors stays compact', () => {
    const ce = new ComputeEngine();
    const p = ce
      .box([
        'Product',
        ['Subtract', ['Multiply', 'k', 'n'], 1],
        ['Limits', 'k', 1, 8],
      ])
      .evaluate();
    // Eight factors, not a nine-term polynomial.
    expect(p.operator).toEqual('Multiply');
    expect(p.nops).toEqual(8);
    // Still the same value.
    expect(p.subs({ n: ce.number(2) }).evaluate().re).toEqual(2027025);
  });
});

describe('the narrow cut leaves the rest of the engine expanding', () => {
  test('`simplify()` still expands', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Multiply', 2, ['Add', 'x', 1]])
        .simplify()
        .toString()
    ).toEqual('2x + 2');
  });

  test('an ordinary numeric product folds exactly as before', () => {
    // `mulFactored` declines only the DISTRIBUTION. `expandProducts` also folds
    // the operands pairwise as a side effect of its walk, and skipping that for
    // a product with no sum in it reordered the fold: `-2 · 3.1 · -∞ · -∞ · x`
    // came back `+∞·x` at machine precision instead of `-∞·x`.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(
      ce
        .box(['Multiply', 'x', -2, 3.1, 'NegativeInfinity', 'NegativeInfinity'])
        .evaluate()
        .toString()
    ).toEqual('-oo * x');
  });

  test('like factors and zero still fold', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Multiply', 'a', 'a']).evaluate().toString()).toEqual('a^2');
    expect(ce.box(['Multiply', 0, 'a']).evaluate().toString()).toEqual('0');
    expect(ce.box(['Multiply', 2, 'a', 3]).evaluate().toString()).toEqual('6a');
  });

  test('a symbolic determinant still expands', () => {
    // `tensor-fields.ts` multiplies incrementally through `mul()` precisely
    // because the 3×3 determinant (and `CharacteristicPolynomial` through it)
    // needs that expansion.
    const ce = new ComputeEngine();
    const det = ce
      .box([
        'Determinant',
        [
          'List',
          ['List', 'a', 'b', 'c'],
          ['List', 'd', 'e', 'f'],
          ['List', 'g', 'h', 'j'],
        ],
      ])
      .evaluate();
    expect(det.operator).toEqual('Add');
    expect(det.nops).toEqual(6);
  });
});
