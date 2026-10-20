import type { Expression } from '../../src/compute-engine';
import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { differentiate } from '../../src/compute-engine/symbolic/derivative';

// The derivative of a `Sum` or a `Product` stayed unevaluated: the
// differentiator had no rule for a big operator. Now a `Sum` whose indexing
// sets do not depend on the variable is differentiated term by term, and a
// `Product` with a small finite integer range is expanded into its factors
// first. Every expected value below was checked against a central difference
// of the original expression at several points.

const SUM_K_XK = [
  'Sum',
  ['Multiply', 'k', ['Power', 'x', 'k']],
  ['Limits', 'k', 1, 3],
];
const PRODUCT_X_PLUS_K = ['Product', ['Add', 'x', 'k'], ['Limits', 'k', 1, 2]];

function d(ce: ComputeEngine, json: unknown): string {
  return ce
    .box(json as any)
    .evaluate()
    .toString();
}

/** The value of `expr` at `x = x0`, as a machine number. */
function at(ce: ComputeEngine, expr: Expression, x0: number): number {
  return expr.subs({ x: ce.number(x0) }).N().re;
}

describe('the derivative of a Sum', () => {
  test('a finite sum: the box route', () => {
    const ce = new ComputeEngine();
    // Σ_{k=1}^{3} k·x^k = x + 2x² + 3x³
    expect(d(ce, ['D', SUM_K_XK, 'x'])).toBe('9x^2 + 4x + 1');
  });

  test('a finite sum: the parse route', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\frac{d}{dx}\\sum_{k=1}^{3} k x^k').evaluate().toString()
    ).toBe('9x^2 + 4x + 1');
  });

  test('a finite sum: the ce.function route', () => {
    const ce = new ComputeEngine();
    const sum = ce.function('Sum', [
      ce.box(['Multiply', 'k', ['Power', 'x', 'k']]),
      ce.box(['Limits', 'k', 1, 3]),
    ]);
    expect(
      ce
        .function('D', [sum, ce.symbol('x')])
        .evaluate()
        .toString()
    ).toBe('9x^2 + 4x + 1');
  });

  test('a second derivative', () => {
    const ce = new ComputeEngine();
    expect(d(ce, ['D', SUM_K_XK, 'x', 'x'])).toBe('18x + 4');
  });

  test('a sum of transcendental terms', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box([
        'D',
        ['Sum', ['Sin', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 3]],
        'x',
      ])
      .evaluate();
    expect(result.has('D')).toBe(false);
    // cos x + 2cos 2x + 3cos 3x
    for (const x0 of [-1.3, 0, 0.7, 2])
      expect(at(ce, result, x0)).toBeCloseTo(
        Math.cos(x0) + 2 * Math.cos(2 * x0) + 3 * Math.cos(3 * x0),
        10
      );
  });

  test('several indexing sets', () => {
    const ce = new ComputeEngine();
    // Σ_{j=1}^{2} Σ_{k=1}^{2} j·x^k = 3x + 3x²
    expect(
      d(ce, [
        'D',
        [
          'Sum',
          ['Multiply', 'j', ['Power', 'x', 'k']],
          ['Limits', 'k', 1, 2],
          ['Limits', 'j', 1, 2],
        ],
        'x',
      ])
    ).toBe('6x + 3');
  });

  test('an Element indexing set', () => {
    const ce = new ComputeEngine();
    expect(
      d(ce, [
        'D',
        [
          'Sum',
          ['Multiply', 'k', ['Power', 'x', 'k']],
          ['Element', 'k', ['List', 1, 2, 3]],
        ],
        'x',
      ])
    ).toBe('9x^2 + 4x + 1');
  });

  test('a symbolic upper bound: the derivative is a sum with the same bounds', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box(['D', ['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 0, 'n']], 'x'])
      .evaluate();
    expect(result.json).toEqual([
      'Sum',
      ['Multiply', 'k', ['Power', 'x', ['Add', 'k', -1]]],
      ['Limits', 'k', 0, 'n'],
    ]);
    // With n = 4: d/dx (1 + x + x² + x³ + x⁴) = 1 + 2x + 3x² + 4x³
    const n4 = result.subs({ n: 4 }).evaluate();
    expect(n4.toString()).toBe('4x^3 + 3x^2 + 2x + 1');
  });

  test('the index of the result is bound by the new sum', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box(['D', ['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 0, 'n']], 'x'])
      .evaluate();
    // `k` is not a free variable of the result: only `x` and `n` are.
    expect([...result.unknowns].sort()).toEqual(['n', 'x']);
  });

  test('the index is the variable: the derivative is 0', () => {
    const ce = new ComputeEngine();
    // Every `x` in the body is the index, so the sum is the constant 6.
    expect(d(ce, ['D', ['Sum', 'x', ['Limits', 'x', 1, 3]], 'x'])).toBe('0');
    expect(
      ce.parse('\\frac{d}{dx}\\sum_{x=1}^{3} x').evaluate().toString()
    ).toBe('0');
  });

  test('an inner sum whose index is the variable', () => {
    const ce = new ComputeEngine();
    expect(
      d(ce, [
        'D',
        [
          'Sum',
          ['Sum', ['Multiply', 'x', 'k'], ['Limits', 'x', 1, 2]],
          ['Limits', 'k', 1, 3],
        ],
        'x',
      ])
    ).toBe('0');
  });

  test('a body that does not depend on the variable', () => {
    const ce = new ComputeEngine();
    expect(
      d(ce, [
        'D',
        ['Sum', ['Multiply', 'y', ['Power', 'k', 2]], ['Limits', 'k', 1, 'n']],
        'x',
      ])
    ).toBe('0');
  });

  test('a bound that depends on the variable: the derivative stays unevaluated', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box(['D', ['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 1, 'x']], 'x'])
      .evaluate();
    expect(result.operator).toBe('D');
  });

  // A term or a bound can read the variable through a call: with
  // `g := a ↦ a·x`, `g(k)` depends on `x`, although the name `x` is not
  // written in the sum. The derivative of the call (`D(g(2), x)` is 2)
  // follows the call into the body of `g`, and the rule for a sum does the
  // same. (Tycho ledger row 405.)
  describe('a term or a bound that reads the variable through a call', () => {
    function engine(): ComputeEngine {
      const ce = new ComputeEngine();
      ce.declare('g', 'function');
      ce.assign('g', ce.box(['Function', ['Multiply', 'a', 'x'], 'a']));
      ce.declare('w', 'function');
      ce.assign('w', ce.box(['Function', ['g', ['Add', 'a', 1]], 'a']));
      ce.declare('h', 'function');
      ce.assign('h', ce.box(['Function', ['Multiply', 'a', 2], 'a']));
      ce.declare('N', 'function');
      ce.assign(
        'N',
        ce.box(['Function', ['Floor', ['Multiply', 'a', 'x']], 'a'])
      );
      return ce;
    }

    test('a term that calls a function whose body reads the variable', () => {
      // Σ_{k=1}^{5} k·x = 15x
      expect(
        d(engine(), ['D', ['Sum', ['g', 'k'], ['Limits', 'k', 1, 5]], 'x'])
      ).toBe('15');
    });

    test('a call inside the body of the called function', () => {
      // w(k) = g(k + 1) = (k + 1)·x, and Σ_{k=1}^{5} (k + 1) = 20
      expect(
        d(engine(), ['D', ['Sum', ['w', 'k'], ['Limits', 'k', 1, 5]], 'x'])
      ).toBe('20');
    });

    test('a function whose body does not read the variable: the derivative is 0', () => {
      expect(
        d(engine(), ['D', ['Sum', ['h', 'k'], ['Limits', 'k', 1, 5]], 'x'])
      ).toBe('0');
    });

    test('a function with no definition: the derivative is 0', () => {
      expect(
        d(engine(), ['D', ['Sum', ['f', 'k'], ['Limits', 'k', 1, 5]], 'x'])
      ).toBe('0');
    });

    test('a bound that calls a function whose body reads the variable: the derivative stays unevaluated', () => {
      const result = engine()
        .box([
          'D',
          [
            'Sum',
            ['Cos', ['Multiply', 'i', 'x']],
            ['Limits', 'i', 1, ['N', 1]],
          ],
          'x',
        ])
        .evaluate();
      expect(result.operator).toBe('D');
    });

    test('a function passed as an argument: its body is followed', () => {
      // G(g, k) = g(k) = k·x reads `x` only through the bare symbol `g`.
      // The engine does not differentiate a call of `G` today: it finds the
      // body of `G` by applying `G` to wildcards, and `_1(_2)` is not valid.
      // So the derivative stays unevaluated, but it is not the early 0.
      const ce = engine();
      ce.declare('G', 'function');
      ce.assign('G', ce.box(['Function', ['f', 'a'], 'f', 'a']));
      const result = ce
        .box(['D', ['Sum', ['G', 'g', 'k'], ['Limits', 'k', 1, 5]], 'x'])
        .evaluate();
      expect(result.operator).toBe('D');
    });

    test('a bound that passes a function as an argument', () => {
      const ce = engine();
      ce.declare('G', 'function');
      ce.assign('G', ce.box(['Function', ['f', 'a'], 'f', 'a']));
      // G(g, 3) = 3x: the bound depends on `x`
      const term = ['Multiply', 'k', 'x'];
      const result = ce
        .box(['D', ['Sum', term, ['Limits', 'k', 1, ['G', 'g', 3]]], 'x'])
        .evaluate();
      expect(result.operator).toBe('D');
      // G(h, 3) = 6 does not depend on `x`, but the body of `G` applied to
      // wildcards, `_1(_2)`, is not valid, so the body of `G` is not known
      // and the bound may depend on `x`: the derivative stays unevaluated.
      // A bound that calls `h` directly is known: h(3) = 6, and
      // Σ_{k=1}^{6} k = 21.
      expect(
        ce
          .box(['D', ['Sum', term, ['Limits', 'k', 1, ['G', 'h', 3]]], 'x'])
          .evaluate().operator
      ).toBe('D');
      expect(
        d(ce, ['D', ['Sum', term, ['Limits', 'k', 1, ['h', 3]]], 'x'])
      ).toBe('21');
    });

    test('a function whose body applied to wildcards is not valid may depend on the variable', () => {
      // With `G2 := (f, a) ↦ f(a)·x`, `G2(_1, _2)` is an `Error` that no
      // longer holds the `x`, so the body of `G2` is not known. The term
      // `G2(h, k)` = 2k·x depends on `x`: the derivative is not the early 0.
      const ce = engine();
      ce.declare('G2', 'function');
      ce.assign(
        'G2',
        ce.box(['Function', ['Multiply', ['f', 'a'], 'x'], 'f', 'a'])
      );
      expect(ce.box(['G2', 'h', 2]).evaluate().toString()).toBe('4x');
      const result = ce
        .box(['D', ['Sum', ['G2', 'h', 'k'], ['Limits', 'k', 1, 5]], 'x'])
        .evaluate();
      expect(result.toString()).not.toBe('0');
    });

    test('a bound that calls a function that is not pure: the derivative stays unevaluated', () => {
      // The body of `r` is not evaluated to test it, since that would draw a
      // random number. It may depend on `x`.
      const ce = engine();
      ce.declare('r', 'function');
      ce.assign('r', ce.box(['Function', ['RandomInteger', 1, 'a'], 'a']));
      const result = ce
        .box([
          'D',
          ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, ['r', 5]]],
          'x',
        ])
        .evaluate();
      expect(result.operator).toBe('D');
    });
  });

  test('a value assigned to the variable is not substituted', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    expect(d(ce, ['D', SUM_K_XK, 'x'])).toBe('9x^2 + 4x + 1');
  });

  test('a function defined by a sum', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := \\sum_{k=1}^{3} k x^k').evaluate();
    expect(ce.parse("f'(x)").evaluate().toString()).toBe('9x^2 + 4x + 1');
    // 1 + 4·2 + 9·4 = 45
    expect(ce.parse("f'(2)").evaluate().toString()).toBe('45');
  });

  test('an index named like a library constant stays the index', () => {
    const ce = new ComputeEngine();
    // `i` is also the imaginary unit. The new sum is built on the scope of
    // the original sum, so the `i` in its body is still the index.
    const result = ce
      .box(['D', ['Sum', ['Power', 'x', 'i'], ['Limits', 'i', 0, 'n']], 'x'])
      .evaluate();
    expect([...result.unknowns].sort()).toEqual(['n', 'x']);
    expect(result.subs({ n: 3 }).evaluate().toString()).toBe(
      '3x^2 + 2x + 1'
    );
  });

  test('the new sum is built on the scope of the original sum', () => {
    const ce = new ComputeEngine();
    const sum = ce.box([
      'Sum',
      ['Sum', ['Multiply', 'i', ['Power', 'x', 'j']], ['Limits', 'j', 1, 'm']],
      ['Limits', 'i', 0, 'n'],
    ]);
    const result = differentiate(sum, 'x');
    expect(isFunction(result, 'Sum')).toBe(true);
    if (!isFunction(result) || !isFunction(sum)) return;
    // The outer sum keeps its scope, and the scope of the inner sum is still
    // a child of it, so the inner body can reach the outer index `i`.
    expect(result.localScope).toBe(sum.localScope);
    expect(isFunction(result.op1, 'Sum')).toBe(true);
    expect(result.op1.localScope?.parent).toBe(result.localScope);
  });

  test('a sum with no bounds: the derivative is that of the sum over 1..+∞', () => {
    const ce = new ComputeEngine();
    // `\sum_k x^k` is `Sum(x^k, Limits(k, Nothing, Nothing))`, which runs
    // over k = 1, 2, 3, … (user decision 2026-10-20). Its derivative is the
    // derivative of `x/(1 − x)` for |x| < 1, which is `1/(1 − x)²`. It used
    // to be `1/x`, when the two `Nothing` bounds were read as one point.
    const result = ce.parse('\\frac{d}{dx}\\sum_k x^k').evaluate();
    const explicit = ce
      .parse('\\frac{d}{dx}\\sum_{k=1}^{\\infty} x^k')
      .evaluate();
    expect(result.json).toEqual(explicit.json);
    expect(result.subs({ x: 0.5 }).N().re).toBeCloseTo(4, 12);
  });

  test('explain: the steps inside the sum are shown', () => {
    const ce = new ComputeEngine();
    const explanation = ce
      .box([
        'D',
        [
          'Sum',
          ['Multiply', 'k', ['Power', 'x', 'k']],
          ['Limits', 'k', 1, 'n'],
        ],
        'x',
      ])
      .explain('D');
    expect(explanation.steps.map((s) => s.id)).toEqual([
      'derivative.term-by-term',
      'derivative.product-rule',
      'derivative.power-rule',
      'derivative.simplify',
    ]);
    expect(explanation.result.json).toEqual([
      'Sum',
      ['Multiply', ['Power', 'k', 2], ['Power', 'x', ['Add', 'k', -1]]],
      ['Limits', 'k', 1, 'n'],
    ]);
  });
});

describe('explain: the derivative of an infinite sum through its closed form', () => {
  test('the rewrite to the closed form is a step', () => {
    const ce = new ComputeEngine();
    // `Σ_{k≥1} x^k/k!` is `e^x − 1`. The rewrite to it was not recorded, so
    // the explanation had no differentiation steps.
    const explanation = ce
      .box(['D', ce.parse('\\sum_k \\frac{x^k}{k!}').json, 'x'])
      .explain('D');
    expect(explanation.steps.map((s) => [s.id, s.value.toString()])).toEqual([
      ['derivative.rewrite', 'D(e^x - 1, x)'],
      ['derivative.sum-rule', 'D(e^x, x)'],
      ['derivative.exponential-rule', 'e^x'],
    ]);
    expect(explanation.result.toString()).toBe('e^x');
  });

  test('the condition of the closed form is kept in the steps', () => {
    const ce = new ComputeEngine();
    const explanation = ce
      .box(['D', ce.parse('\\sum_k x^k').json, 'x'])
      .explain('D');
    expect(explanation.steps[0].id).toBe('derivative.rewrite');
    expect(explanation.steps[0].value.toString()).toBe(
      'D(x / (1 - x), x) {|x| < 1}'
    );
    expect(explanation.result.toString()).toBe('(1 - x)^(-2) {|x| < 1}');
  });
});

describe('the derivative of a Product', () => {
  test('a finite product: the box route', () => {
    const ce = new ComputeEngine();
    // (x + 1)(x + 2): the derivative is (x + 1) + (x + 2)
    expect(d(ce, ['D', PRODUCT_X_PLUS_K, 'x'])).toBe('2x + 3');
  });

  test('a finite product: the parse route', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\frac{d}{dx}\\prod_{k=1}^{2} (x+k)').evaluate().toString()
    ).toBe('2x + 3');
  });

  test('a finite product: the ce.function route', () => {
    const ce = new ComputeEngine();
    const product = ce.function('Product', [
      ce.box(['Add', 'x', 'k']),
      ce.box(['Limits', 'k', 1, 2]),
    ]);
    expect(
      ce
        .function('D', [product, ce.symbol('x')])
        .evaluate()
        .toString()
    ).toBe('2x + 3');
  });

  test('a factor that is 0 at the point', () => {
    const ce = new ComputeEngine();
    // x(x − 1)(x − 2)(x − 3) = x⁴ − 6x³ + 11x² − 6x
    const result = ce
      .box([
        'D',
        ['Product', ['Subtract', 'x', 'k'], ['Limits', 'k', 0, 3]],
        'x',
      ])
      .evaluate();
    expect(result.toString()).toBe('4x^3 - 18x^2 + 22x - 6');
    // At x = 0 a factor is 0: the derivative is (−1)(−2)(−3) = −6. A
    // logarithmic derivative would divide by that factor.
    expect(result.subs({ x: 0 }).evaluate().toString()).toBe('-6');
  });

  test('powers of the variable', () => {
    const ce = new ComputeEngine();
    // x·x²·x³ = x⁶
    expect(
      d(ce, ['D', ['Product', ['Power', 'x', 'k'], ['Limits', 'k', 1, 3]], 'x'])
    ).toBe('6x^5');
  });

  test('several indexing sets', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box([
        'D',
        [
          'Product',
          ['Add', 'x', 'k', 'j'],
          ['Limits', 'k', 1, 2],
          ['Limits', 'j', 1, 2],
        ],
        'x',
      ])
      .evaluate();
    // (x + 2)(x + 3)²(x + 4)
    const f = (x: number) => (x + 2) * (x + 3) ** 2 * (x + 4);
    const h = 1e-5;
    for (const x0 of [-1.3, 0, 0.7, 2])
      expect(at(ce, result, x0)).toBeCloseTo(
        (f(x0 + h) - f(x0 - h)) / (2 * h),
        4
      );
  });

  test('a symbol named `constructor` in the body is not replaced', () => {
    const ce = new ComputeEngine();
    // (x + c + 1)(x + c + 2) with c = `constructor`: the derivative is
    // 2x + 2c + 3.
    const result = ce
      .box([
        'D',
        ['Product', ['Add', 'x', 'constructor', 'k'], ['Limits', 'k', 1, 2]],
        'x',
      ])
      .evaluate();
    expect(result.has('D')).toBe(false);
    for (const [x0, c0] of [
      [-1.3, 0.4],
      [0, 2],
      [0.7, -3],
      [2, 1.5],
    ])
      expect(
        result
          .subs({ x: ce.number(x0), constructor: ce.number(c0) })
          .N().re
      ).toBeCloseTo(2 * x0 + 2 * c0 + 3, 10);
  });

  test('a bound larger than 2^53: the derivative stays unevaluated', () => {
    const ce = new ComputeEngine();
    // One factor, but a machine number cannot count past 10^20 one by one.
    const big = { num: '100000000000000000000' };
    const result = ce
      .box(['D', ['Product', ['Add', 'x', 'k'], ['Limits', 'k', big, big]], 'x'])
      .evaluate();
    expect(result.operator).toBe('D');
  });

  test('an empty range: the product is 1 and the derivative is 0', () => {
    const ce = new ComputeEngine();
    expect(
      d(ce, ['D', ['Product', ['Add', 'x', 'k'], ['Limits', 'k', 3, 1]], 'x'])
    ).toBe('0');
  });

  test('the index is the variable: the derivative is 0', () => {
    const ce = new ComputeEngine();
    expect(d(ce, ['D', ['Product', 'x', ['Limits', 'x', 1, 3]], 'x'])).toBe(
      '0'
    );
  });

  test('a function defined by a product', () => {
    const ce = new ComputeEngine();
    ce.parse('g(x) := \\prod_{k=1}^{3} (x - k)').evaluate();
    // g'(1) = (1 − 2)(1 − 3) = 2
    expect(ce.parse("g'(1)").evaluate().toString()).toBe('2');
  });

  test.each([
    ['a symbolic upper bound', ['Limits', 'k', 1, 'n']],
    ['a bound that depends on the variable', ['Limits', 'k', 1, 'x']],
    ['a range too large to expand', ['Limits', 'k', 1, 100]],
  ])('%s: the derivative stays unevaluated', (_, limits) => {
    const ce = new ComputeEngine();
    const result = ce
      .box(['D', ['Product', ['Add', 'x', 'k'], limits], 'x'])
      .evaluate();
    expect(result.operator).toBe('D');
  });
});
