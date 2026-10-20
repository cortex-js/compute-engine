import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * `simplify()` and `evaluate()` of a sum or a product over a range with
 * infinitely many terms, written with no bounds (`\sum_k f`, which runs over
 * k = 1, 2, 3, …) or with the explicit bounds `k = 1..∞`. Both spellings
 * give the same result.
 *
 * The simplification rules are closed forms for a finite range `a..b`. With
 * `b = +∞` they put the infinite bound into the closed form, which is the
 * limit only when the arithmetic with ∞ can decide it. Before these tests:
 * `\sum_k 0` simplified to `Indeterminate` (∞·0), `\sum_k y` to `∞·y`
 * (wrong at y = 0), `\prod_k 1` to `Indeterminate`, `\prod_k y` to
 * `y^(+∞)`, `\sum_k (1 + xk)` to `+∞` (wrong for x < 0), `\sum_k kx` to
 * `∞·x`, and `\sum_k (1/\sqrt2)^k` to the float `2.414…`.
 */

const ce = new ComputeEngine();

function both(body: string, op = '\\sum'): [string, string] {
  return [`${op}_k ${body}`, `${op}_{k=1}^{\\infty} ${body}`];
}

describe('A sum of a constant over an infinite range', () => {
  test.each([
    ['0', '0', '0'],
    ['3', '+oo', '+oo'],
    ['(-3)', '-oo', '-oo'],
    ['\\pi', '+oo', '+oo'],
  ])('\\sum %s', (body, simplified, evaluated) => {
    for (const latex of both(body)) {
      const expr = ce.parse(latex);
      expect(expr.simplify().toString()).toBe(simplified);
      expect(expr.evaluate().toString()).toBe(evaluated);
    }
  });

  test('a body of unknown sign stays as it is', () => {
    // `Σ_{k≥1} y` is +∞ for y > 0, −∞ for y < 0 and 0 for y = 0.
    for (const latex of both('y')) {
      const expr = ce.parse(latex);
      expect(expr.simplify().json).toEqual(expr.json);
      expect(expr.evaluate().json).toEqual(expr.json);
    }
  });

  test('a body of known sign gives ±∞', () => {
    const engine = new ComputeEngine();
    engine.declare('p', 'real');
    engine.assume(engine.parse('p > 0'));
    expect(engine.parse('\\sum_k p').simplify().toString()).toBe('+oo');
  });
});

describe('A product of a constant over an infinite range', () => {
  test.each([
    // [body, value]: the limit of cⁿ.
    ['1', '1'],
    ['\\frac{1}{2}', '0'],
    ['(-\\frac{1}{2})', '0'],
    ['2', '+oo'],
  ])('\\prod %s', (body, value) => {
    for (const latex of both(body, '\\prod')) {
      const expr = ce.parse(latex);
      expect(expr.simplify().toString()).toBe(value);
      expect(expr.evaluate().toString()).toBe(value);
      expect(expr.N().toString()).toBe(value);
    }
  });

  test.each([['(-2)'], ['(-1)'], ['y']])(
    '\\prod %s has no known limit and stays as it is',
    (body) => {
      for (const latex of both(body, '\\prod')) {
        const expr = ce.parse(latex);
        expect(expr.simplify().json).toEqual(expr.json);
        expect(expr.evaluate().json).toEqual(expr.json);
      }
    }
  );
});

describe('A constant body near ±1, impure, or over an empty range', () => {
  const INF = ['Limits', 'k', 1, 'PositiveInfinity'];

  test('a float within the tolerance of 1 is not read as 1', () => {
    // `1.000000000001ⁿ` grows to +∞ and `0.999999999999ⁿ` goes to 0. The
    // tolerance compare read both as 1, so the product was 1. The float does
    // not tell on which side of 1 the value is, so the product stays.
    for (const c of [1.000000000001, 0.999999999999]) {
      const expr = ce.box(['Product', c, INF]);
      expect(expr.simplify().json).toEqual(expr.json);
      expect(expr.evaluate().json).toEqual(expr.json);
    }
    // Away from 1 a float is decided.
    expect(ce.box(['Product', 1.5, INF]).simplify().toString()).toBe('+oo');
    expect(ce.box(['Product', 0.5, INF]).evaluate().toString()).toBe('0');
  });

  test('an exact number near 1 is compared exactly', () => {
    const expr = ce.box([
      'Product',
      ['Rational', 1000000000001, 1000000000000],
      INF,
    ]);
    expect(expr.simplify().toString()).toBe('+oo');
    expect(expr.evaluate().toString()).toBe('+oo');
  });

  test('an impure body is not compared', () => {
    // `Random()` is a new draw in each factor: the factors are not one
    // constant, and comparing the body would evaluate it.
    for (const op of ['Sum', 'Product']) {
      const expr = ce.box([op, ['Random'], INF]);
      expect(expr.simplify().json).toEqual(expr.json);
      expect(expr.evaluate().json).toEqual(expr.json);
    }
  });

  test('an empty range is not read as an infinite one', () => {
    // `Limits(k, +∞, 5)` has no terms: the empty product is 1 and the empty
    // sum is 0. `evaluate()` read it as infinitely many factors (0 gave 0
    // and 2 gave +∞). `evaluate()` now keeps such a range unevaluated, as
    // it already did for a body that depends on the index; `simplify()`
    // gives the identity.
    for (const c of [0, 2]) {
      const product = ce.box([
        'Product',
        c,
        ['Limits', 'k', 'PositiveInfinity', 5],
      ]);
      expect(product.evaluate().json).toEqual(product.json);
      expect(product.simplify().toString()).toBe('1');
    }
    const sum = ce.box(['Sum', 3, ['Limits', 'k', 'PositiveInfinity', 5]]);
    expect(sum.evaluate().json).toEqual(sum.json);
    expect(sum.simplify().toString()).toBe('0');
  });
});

describe('A closed form with a free coefficient over an infinite range', () => {
  test.each([['(1 + xk)'], ['kx'], ['xk^2'], ['\\frac{x}{k^2}']])(
    '\\sum %s stays as it is',
    (body) => {
      // `Σ_{k≥1} (1 + x·k)` is +∞ for x > 0 and −∞ for x < 0; `Σ_{k≥1} k·x`
      // is 0 for x = 0.
      for (const latex of both(body)) {
        const expr = ce.parse(latex);
        expect(expr.simplify().json).toEqual(expr.json);
      }
    }
  );

  test('with no free symbol the closed form still applies', () => {
    for (const body of ['k', '(1 + 2k)', 'k^2', '2k'])
      for (const latex of both(body))
        expect(ce.parse(latex).simplify().toString()).toBe('+oo');
  });

  test('a finite range still gives the closed form', () => {
    expect(ce.parse('\\sum_{k=1}^{n} kx').simplify().toString()).not.toMatch(
      /sum/
    );
  });
});

describe('A geometric series with an exact ratio', () => {
  test('the closed form stays exact', () => {
    for (const latex of both('(\\frac{1}{\\sqrt{2}})^k')) {
      const expr = ce.parse(latex);
      expect(expr.simplify().toString()).toBe('1 + sqrt(2)');
      expect(expr.evaluate().toString()).toBe('1 + sqrt(2)');
    }
    const from0 = ce.parse('\\sum_{k=0}^{\\infty} (\\frac{1}{\\sqrt{2}})^k');
    expect(from0.simplify().toString()).toBe('2 + sqrt(2)');
    expect(from0.simplify().N().re).toBeCloseTo(1 / (1 - Math.SQRT1_2), 12);
  });

  test('a finite symbolic range keeps the exact ratio', () => {
    const value = ce
      .parse('\\sum_{k=0}^{n} (\\frac{1}{\\sqrt{2}})^k')
      .simplify();
    expect(value.toString()).toBe(
      '(1 - (sqrt(2)/2)^(n + 1)) / (1 - sqrt(2)/2)'
    );
    // n = 3: 1 + r + r² + r³ with r = 1/√2.
    const r = Math.SQRT1_2;
    expect(value.subs({ n: 3 }).N().re).toBeCloseTo(1 + r + r * r + r ** 3, 12);
  });

  test('an oscillating ratio has no value and stays as it is', () => {
    const expr = ce.parse('\\sum_{k=0}^{\\infty} (-1)^k');
    expect(expr.simplify().json).toEqual(expr.json);
  });
});

describe('Compiling a sum with no bounds', () => {
  test('the error names the infinite upper bound', () => {
    // Both spellings fall back to the interpreter, with the same reason.
    for (const latex of both('\\frac{1}{k^2}')) {
      expect(() =>
        compile(ce.parse(latex), { fallback: false } as any)
      ).toThrow(/the upper bound `\+oo` is not a finite number/);
      const result = compile(ce.parse(latex));
      expect(result.success).toBe(false);
      expect(result.run!()).toBeCloseTo(Math.PI ** 2 / 6, 10);
    }
  });
});
