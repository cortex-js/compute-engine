import { ComputeEngine } from '../../src/compute-engine';

/**
 * A DEGENERATE big operator has structurally equal lower and upper bounds
 * (`Σ_{i=a}^{a}`): its domain is the single point `i = a`, so it has exactly
 * one term. Two reductions:
 *
 *  - EVALUATE: when the bound is symbolic the domain classifier reports
 *    `'symbolic'` and the operator used to stay inert. One point needs no
 *    enumeration, so `Σ_{i=x}^{x} i² = x²`.
 *  - CANONICALIZE: when the index does not occur in the body the indexing set
 *    carries no information at all, so `Σ_{i=d}^{d} f(x)` folds to `f(x)`
 *    (the Desmos "identity wrapper" spelling). Same generic-symbol fold family
 *    as `x/x → 1`.
 *
 * `±∞` and `NaN` bounds are NOT a point and keep their previous behavior.
 *
 * Both routes (parse and box) are covered: a lazy operator's held operands
 * reach the evaluate handler differently on each.
 */

describe('degenerate big operator: symbolic bounds, index USED', () => {
  test('Sum — parse route', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{i=x}^{x} i^2').evaluate().toString()).toBe('x^2');
  });

  test('Sum — box route', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Sum', ['Square', 'i'], ['Limits', 'i', 'x', 'x']]).evaluate()
        .toString()
    ).toBe('x^2');
  });

  test('Product — parse route', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\prod_{i=x}^{x} 2i').evaluate().toString()).toBe('2x');
  });

  test('Product — box route', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Product', ['Multiply', 2, 'i'], ['Limits', 'i', 'x', 'x']])
        .evaluate()
        .toString()
    ).toBe('2x');
  });

  test('the reduction is exact; .N() numericizes as usual', () => {
    const ce = new ComputeEngine();
    // A transcendental of an exact argument stays symbolic under both.
    expect(ce.parse('\\sum_{i=x}^{x}\\sqrt{i}').evaluate().toString()).toBe(
      'sqrt(x)'
    );
    expect(ce.parse('\\sum_{i=x}^{x}\\sqrt{i}').N().toString()).toBe('sqrt(x)');
    // An exact rational coefficient stays exact under `evaluate()`.
    expect(ce.parse('\\sum_{i=x}^{x}\\frac{i}{3}').evaluate().toString()).toBe(
      '1/3 * x'
    );
    expect(ce.parse('\\sum_{i=x}^{x}\\frac{i}{3}').N().re).toBeNaN();
  });

  test('a bound with a value is honored', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 3);
    expect(ce.parse('\\sum_{i=x}^{x} i^2').evaluate().re).toEqual(9);
  });

  test('evaluateAsync agrees with evaluate', async () => {
    const ce = new ComputeEngine();
    expect(
      (await ce.parse('\\sum_{i=x}^{x} i^2').evaluateAsync()).toString()
    ).toBe('x^2');
    expect(
      (await ce.parse('\\prod_{i=x}^{x} 2i').evaluateAsync()).toString()
    ).toBe('2x');
  });

  test('the index does not leak out of the operator scope', () => {
    const ce = new ComputeEngine();
    ce.parse('\\sum_{i=x}^{x} i^2').evaluate();
    expect(ce.box('i').evaluate().toString()).toBe('i');
  });

  test('GUARD: declines when substituting would capture', () => {
    const ce = new ComputeEngine();
    // The inner `Sum` rebinds `x`, the symbol the outer index would become.
    const expr = ce.box([
      'Sum',
      ['Sum', ['Multiply', 'i', 'x'], ['Limits', 'x', 1, 3]],
      ['Limits', 'i', 'x', 'x'],
    ]);
    expect(expr.evaluate().toString()).toBe(
      'sum_(i=x)^(x)(sum_(x=1)^(3)(i * x))'
    );
  });

  test('GUARD: a capture-unsafe decline does not fall through to a closed form', async () => {
    const ce = new ComputeEngine();
    // A telescoping body `g(i+1) − g(i)` whose `g` binds `x`, the symbol the
    // degenerate bound would substitute in. `symbolicSumClosedForm` performs
    // that same substitution with NO capture guard of its own, so declining
    // here must stop the fall-through, not merely skip one reduction.
    const sum = ce.box([
      'Sum',
      [
        'Subtract',
        ['Sum', ['Add', 'i', 1], ['Limits', 'x', 1, 3]],
        ['Sum', 'i', ['Limits', 'x', 1, 3]],
      ],
      ['Limits', 'i', 'x', 'x'],
    ]);
    const symbolicSum =
      'sum_(i=x)^(x)(-sum_(x=1)^(3)(i) + sum_(x=1)^(3)(i + 1))';
    expect(sum.evaluate().toString()).toBe(symbolicSum);
    expect((await sum.evaluateAsync()).toString()).toBe(symbolicSum);

    // Same shape against the telescoping PRODUCT closed form.
    const prod = ce.box([
      'Product',
      [
        'Divide',
        ['Sum', ['Add', 'i', 1], ['Limits', 'x', 1, 3]],
        ['Sum', 'i', ['Limits', 'x', 1, 3]],
      ],
      ['Limits', 'i', 'x', 'x'],
    ]);
    const symbolicProd =
      'prod_(i=x)^(x)(sum_(x=1)^(3)(i + 1) / sum_(x=1)^(3)(i))';
    expect(prod.evaluate().toString()).toBe(symbolicProd);
    expect((await prod.evaluateAsync()).toString()).toBe(symbolicProd);
  });
});

describe('degenerate big operator: index UNUSED folds at canonicalization', () => {
  test('Sum, symbolic bound — parse route', () => {
    const ce = new ComputeEngine();
    // The Desmos "identity wrapper" golf spelling.
    const expr = ce.parse('\\sum_{i=d}^{d} f(x)');
    expect(expr.toString()).toBe('f * x');
    expect(expr.evaluate().toString()).toBe('f * x');
  });

  test('Sum, symbolic bound — box route', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Sum', ['Multiply', 'a', 'y'], ['Limits', 'i', 'd', 'd']]);
    expect(expr.toString()).toBe('a * y');
  });

  test('Sum, literal bound', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{i=5}^{5} y').toString()).toBe('y');
    expect(
      ce.box(['Sum', 'y', ['Limits', 'i', 5, 5]]).toString()
    ).toBe('y');
  });

  test('Product, symbolic and literal bounds', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\prod_{i=d}^{d} 2y').toString()).toBe('2y');
    expect(
      ce.box(['Product', ['Multiply', 2, 'y'], ['Limits', 'i', 5, 5]]).toString()
    ).toBe('2y');
  });

  test('the folded body evaluates to the mathematically expected value', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 7);
    // Σ_{i=d}^{d} y² has exactly one term, y² = 49.
    expect(ce.parse('\\sum_{i=d}^{d} y^2').evaluate().re).toEqual(49);
    // Π_{i=5}^{5} 2y has exactly one factor, 2y = 14.
    expect(ce.parse('\\prod_{i=5}^{5} 2y').evaluate().re).toEqual(14);
  });

  test('a degenerate set is dropped, the other indexing sets survive', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Sum', 'j', ['Limits', 'i', 'd', 'd'], ['Limits', 'j', 1, 3]]);
    expect(expr.toString()).toBe('sum_(j=1)^(3)(j)');
    expect(expr.evaluate().re).toEqual(6);
  });

  test('an index that IS used keeps its indexing set', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{i=x}^{x} i^2').toString()).toBe(
      'sum_(i=x)^(x)(i^2)'
    );
  });

  test('the fold is SYNTACTIC: it does not follow a symbol value', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 5);
    const expr = ce.parse('\\sum_{i=a}^{5} y');
    // `a` holds 5, so the sum does have one term — but that is an
    // evaluate-time fact, not a canonical-form one. Folding it at
    // canonicalization would bake the value in PERMANENTLY.
    expect(expr.toString()).toBe('sum_(i=a)^(5)(y)');
    expect(expr.evaluate().toString()).toBe('y');
    // Rebinding `a` changes the answer, as it must.
    ce.assign('a', 3);
    expect(expr.evaluate().toString()).toBe('3y');
  });

  test("a dropped set's index must not be referenced by a sibling set", () => {
    const ce = new ComputeEngine();
    // `i` does not occur in the body, but the second set's lower bound reads
    // it: dropping `Limits(i, 5, 5)` would strand that `i` free.
    const expr = ce.box([
      'Sum',
      'j',
      ['Limits', 'i', 5, 5],
      ['Limits', 'j', 'i', 10],
    ]);
    expect(expr.toString()).toBe('sum_(i=5)^(5)_(j=i)^(10)(j)');
  });

  test('impure bounds are not a point (canonicalization)', () => {
    const ce = new ComputeEngine();
    // Two independent draws, not one endpoint repeated.
    expect(
      ce
        .box([
          'Sum',
          'y',
          ['Limits', 'i', ['RandomInteger', 1, 6], ['RandomInteger', 1, 6]],
        ])
        .toString()
    ).toBe('sum_(i=RandomInteger(1, 6))^(RandomInteger(1, 6))(y)');
  });
});

describe('degenerate big operator: unchanged behaviors', () => {
  test('literal equal bounds with the index used still enumerate', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{i=5}^{5} i^2').evaluate().re).toEqual(25);
    expect(ce.box(['Sum', ['Square', 'i'], ['Limits', 'i', 5, 5]]).evaluate().re)
      .toEqual(25);
    expect(ce.parse('\\prod_{i=5}^{5} 2i').evaluate().re).toEqual(10);
  });

  test('PIN: Σ_{i=∞}^{∞} is an infinite-domain question, not a one-term one', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{i=\\infty}^{\\infty} i^2').evaluate().toString()).toBe(
      'sum_(i=+oo)^(+oo)(i^2)'
    );
    expect(
      ce.parse('\\prod_{i=\\infty}^{\\infty} i^2').evaluate().toString()
    ).toBe('prod_(i=+oo)^(+oo)(i^2)');
    // ...and it does not fold at canonicalization either, index used or not.
    expect(ce.parse('\\sum_{i=\\infty}^{\\infty} y').toString()).toBe(
      'sum_(i=+oo)^(+oo)(y)'
    );
  });

  test('PIN: NaN bounds stay symbolic', () => {
    const ce = new ComputeEngine();
    const sum = ce.box(['Sum', ['Square', 'i'], ['Limits', 'i', 'NaN', 'NaN']]);
    expect(sum.evaluate().toString()).toBe('sum_(i=NaN)^(NaN)(i^2)');
    expect(sum.N().toString()).toBe('sum_(i=NaN)^(NaN)(i^2)');
    // Index unused: still no canonicalization fold.
    expect(
      ce.box(['Sum', 'y', ['Limits', 'i', 'NaN', 'NaN']]).toString()
    ).toBe('sum_(i=NaN)^(NaN)(y)');
  });

  test('non-degenerate sums are unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{i=1}^{3} i').evaluate().re).toEqual(6);
    expect(ce.parse('\\sum_{k=1}^{4}\\frac{1}{k}').evaluate().toString()).toBe(
      '25/12'
    );
    // A free bound still keeps the operator symbolic.
    expect(ce.parse('\\sum_{k=1}^{n}k').evaluate().toString()).toBe(
      'sum_(k=1)^(n)(k)'
    );
  });

  test('PIN: impure bounds stay symbolic under evaluate', () => {
    const ce = new ComputeEngine();
    const sum = ce.parse(
      '\\sum_{i=\\operatorname{RandomInteger}(1,6)}^{\\operatorname{RandomInteger}(1,6)} i^2'
    );
    expect(sum.evaluate().toString()).toBe(
      'sum_(i=RandomInteger(1, 6))^(RandomInteger(1, 6))(i^2)'
    );
  });

  test('an index-less `Limits(Nothing, a, a)` reduces to its body', () => {
    const ce = new ComputeEngine();
    // The structural route bypasses `canonicalBigop`, so the index-less set
    // survives to the evaluate handler — this is what reaches the `Nothing`
    // branch of `degenerateBigOpTerm`.
    const expr = ce.function(
      'Sum',
      [
        ce.box('y'),
        ce.function('Limits', [
          ce.symbol('Nothing'),
          ce.symbol('d'),
          ce.symbol('d'),
        ]),
      ],
      { structural: true }
    );
    expect(expr.toString()).toBe('sum_(d)^(d)(y)');
    expect(expr.evaluate().toString()).toBe('y');
  });

  test('a degenerate sum nested in a larger expression evaluates correctly', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('3 + \\sum_{i=x}^{x} i^2').evaluate().toString()
    ).toBe('x^2 + 3');
    expect(
      ce.parse('\\left(\\sum_{i=x}^{x} i^2\\right)^2 + 1').evaluate().toString()
    ).toBe('x^4 + 1');
    // A degenerate sum as the body of an outer, non-degenerate sum.
    expect(
      ce.parse('\\sum_{k=1}^{3}\\sum_{i=k}^{k} i^2').evaluate().re
    ).toEqual(14);
  });
});
