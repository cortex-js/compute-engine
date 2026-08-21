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
 * to distribute — on BOTH of its routes, `evaluate()` (`mulFactored`) and
 * `.N()` (`mulN`), since `.N()` is `evaluate()` with floats and the two must
 * agree on shape (`2(x+1).N()` once came back `2x + 2` while `evaluate()` kept
 * `2(x + 1)`). The rule reaches the handler's tuple and tensor arms too, so a
 * sum is not distributed into the components of `(1,2)·(x+1)` or `[1,2]·(x+1)`
 * either. `mul()` itself and `simplify()` still expand, because several
 * normalization paths depend on that expansion to reach a fixpoint — sum
 * simplification, the cyclic integration-by-parts family, series at infinity,
 * and the 3×3 symbolic determinant behind `CharacteristicPolynomial`. Removing
 * the distribution from `mul()` engine-wide left the rule engine
 * NON-TERMINATING, so these pins exist to stop the cut being widened by
 * mistake as much as to stop it being reverted.
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

describe('`.N()` keeps the same factored shape as `evaluate()`', () => {
  test('a scalar is not distributed over a sum', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Multiply', 2, ['Add', 'x', 1]]).N().toString()).toEqual(
      '2(x + 1)'
    );
    expect(
      ce
        .box(['Multiply', ['Add', 'a', 'b'], ['Add', 'c', 'd']])
        .N()
        .toString()
    ).toEqual('(a + b) * (c + d)');
    // The exact factor still floats; only the distribution is declined.
    expect(
      ce.box(['Multiply', ['Sqrt', 2], ['Add', 'x', 1]]).N().toString()
    ).toMatch(/^1\.41421356237309\d* \* \(x \+ 1\)$/);
  });

  test('a Divide factor keeps its quotient shape', () => {
    // With the distribution skipped, the plain numeric assembly rendered the
    // denominator as a `1/c` FACTOR: `d · 1/c · (a + b)`. The `.N()` route
    // now assembles the product as a rational expression, like `evaluate()`.
    const ce = new ComputeEngine();
    const product = ce.box([
      'Multiply',
      ['Divide', ['Add', 'a', 'b'], 'c'],
      'd',
    ]);
    expect(product.N().toString()).toEqual('(d * (a + b)) / c');
    expect(product.N().toString()).toEqual(product.evaluate().toString());
  });

  test('a closed-constant sum still folds to a float', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Multiply', 2.5, ['Add', ['Sqrt', 2], 1]])
        .N()
        .toString()
    ).toMatch(/^6\.0355339059327\d*$/);
  });

  test('tuple and list components follow the same rule on both routes', () => {
    const ce = new ComputeEngine();
    const tuple = ce.box(['Multiply', ['Tuple', 1, 2], ['Add', 'x', 1]]);
    expect(tuple.evaluate().toString()).toEqual('(x + 1, 2(x + 1))');
    expect(tuple.N().toString()).toEqual('(x + 1, 2(x + 1))');
    const list = ce.box(['Multiply', ['List', 1, 2], ['Add', 'x', 1]]);
    expect(list.evaluate().toString()).toEqual('[x + 1,2(x + 1)]');
    expect(list.N().toString()).toEqual('[x + 1,2(x + 1)]');
    const matrix = ce.box([
      'Multiply',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['Add', 'x', 1],
    ]);
    expect(matrix.evaluate().toString()).toEqual(
      '[[x + 1,2(x + 1)],[3(x + 1),4(x + 1)]]'
    );
    expect(matrix.N().toString()).toEqual(matrix.evaluate().toString());
  });
});

describe('declining the distribution does not change the value', () => {
  test('signed infinities keep their sign at machine precision', () => {
    // Canonicalization folds `(-∞)(-∞)` into `+∞, +∞`, so the accumulation
    // reaches a NEGATIVE infinite coefficient before the last infinity. The
    // machine `sgn()` used to answer `undefined` for any infinity, which the
    // `sgn() ?? 1` fallback read as positive: `-∞ · +∞` came back `+∞`. The
    // pairwise `expandProducts` fold masked this; once a sum is kept and that
    // fold is skipped, the sign flipped on both routes.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const withSum = ce.box([
      'Multiply',
      'x',
      -2,
      3.1,
      'NegativeInfinity',
      'NegativeInfinity',
      ['Add', 'y', 1],
    ]);
    expect(withSum.evaluate().toString()).toEqual('-oo * x * (y + 1)');
    expect(withSum.N().toString()).toEqual('-oo * x * (y + 1)');
  });

  test('a NaN operand absorbs a product whose sum stayed factored', () => {
    const ce = new ComputeEngine();
    ce.assign('q', ce.NaN);
    for (const ops of [
      [['Add', 'x', 1], 'q'],
      ['q', ['Add', 'x', 1]],
      [2, ['Add', 'x', 1], 'q', 'y'],
    ]) {
      const e = ce.box(['Multiply', ...ops]);
      expect(e.evaluate().isNaN).toBe(true);
      expect(e.N().isNaN).toBe(true);
    }
  });

  test('an inexact scalar still floats an exact-constant cell', () => {
    // The cell product on the exact route is finished with `.evaluate()`, so
    // the `Multiply` handler's closed-inexact-constant rule (`0.5 · π` is
    // `1.57…`) reaches list, matrix and tuple components alike, and both
    // routes agree.
    const ce = new ComputeEngine();
    const list = ce.box(['Multiply', 0.5, ['List', 'Pi', 1]]);
    expect(list.evaluate().toString()).toMatch(/^\[1\.5707963267948\d*,0\.5\]$/);
    expect(list.N().toString()).toMatch(/^\[1\.5707963267948\d*,0\.5\]$/);
    const matrix = ce.box([
      'Multiply',
      0.5,
      ['List', ['List', 'Pi'], ['List', 2]],
    ]);
    expect(matrix.evaluate().toString()).toMatch(
      /^\[\[1\.5707963267948\d*\],\[1\]\]$/
    );
    const tuple = ce.box(['Multiply', 0.5, ['Tuple', 'Pi', 1]]);
    expect(tuple.evaluate().toString()).toMatch(
      /^\(1\.5707963267948\d*, 0\.5\)$/
    );
    // An exact scalar keeps an exact cell exact.
    expect(
      ce.box(['Multiply', ['Sqrt', 2], ['List', 'Pi', 1]]).evaluate().toString()
    ).toEqual('[sqrt(2) * pi,sqrt(2)]');
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
