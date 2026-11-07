import { ComputeEngine } from '../../src/compute-engine';

// `simplify()` of a `Sum` or a `Product` gives the closed form that the
// exact `evaluate()` gives, when no simplification rule of the operator
// applies: the telescoping sums, the geometric and named series in a free
// variable, the infinite sums with no free variable, the closed forms of a
// product over a symbolic range, and the known infinite products with their
// limits 0 and ±∞.

describe('simplify() gives the closed form that evaluate() gives', () => {
  const ce = new ComputeEngine();

  test.each([
    [
      '\\sum_{k=1}^n (\\frac1{k+x}-\\frac1{k+x+1})',
      '\\frac{1}{x+1}-\\frac{1}{n+x+1}',
    ],
    ['\\sum_{k=2}^n (\\sin(k+1)-\\sin k)', '\\sin(n+1)-\\sin(2)'],
    ['\\sum_{k=1}^{\\infty} (\\frac1{k+x}-\\frac1{k+x+1})', '\\frac{1}{x+1}'],
    ['\\sum_{k=1}^{\\infty} ((x+k+1)^2-(x+k)^2)', '\\infty'],
    ['\\prod_{k=1}^\\infty \\frac{k}{k+1}', '0'],
    ['\\prod_{k=1}^\\infty \\frac{k+1}{k}', '\\infty'],
    ['\\prod_{k=1}^\\infty (1+1/k^2)', '\\frac{\\sinh(\\pi)}{\\pi}'],
    // The geometric and named series in a free variable, and the infinite
    // sums with no free variable (CE-1061).
    ['\\sum_{k=1}^\\infty \\frac{1}{k^2}', '\\frac{\\pi^2}{6}'],
    ['\\sum_{k=2}^\\infty \\frac{1}{k^2}', '\\frac{\\pi^2}{6}-1'],
    ['\\sum_{k=1}^\\infty \\frac{1}{(2k-1)^2}', '\\frac{\\pi^2}{8}'],
    ['\\sum_{k=1}^\\infty \\frac{(-1)^k}{k}', '-\\ln 2'],
    ['\\sum_{k=1}^\\infty \\frac{1}{k(k+1)}', '1'],
    ['\\sum_{k=1}^\\infty k (\\frac12)^k', '2'],
    ['\\sum_{k=0}^\\infty x^k', '\\operatorname{If}(|x|<1, \\frac{1}{1-x})'],
    // The closed form `(x·x⁻¹)/(1 − x)` is evaluated: `simplify()` does not
    // reduce the value inside the `If`.
    [
      '\\sum_{k=1}^\\infty x^{k-1}',
      '\\operatorname{If}(|x|<1, \\frac{1}{1-x})',
    ],
    [
      '\\sum_{k=1}^\\infty \\frac{x^k}{k}',
      '\\operatorname{If}(|x|<1, -\\ln(1-x))',
    ],
    [
      '\\sum_{k=0}^\\infty k x^k',
      '\\operatorname{If}(|x|<1, \\frac{x}{(1-x)^2})',
    ],
    ['\\sum_{k=0}^\\infty \\frac{x^k}{k!}', 'e^x'],
  ])('%s', (input, expected) => {
    const expr = ce.parse(input);
    const simplified = expr.simplify();
    expect(simplified.isSame(ce.parse(expected))).toBe(true);
    // `evaluate()` keeps a telescoping difference as a structural
    // `Subtract`, and `simplify()` gives its canonical form.
    expect(simplified.isSame(ce.box(expr.evaluate().json))).toBe(true);
  });

  test.each([
    ['\\sum_{k=0}^\\infty (\\frac{1}{\\sqrt2})^k', '2+\\sqrt2'],
    ['\\sum_{k=0}^\\infty k (\\frac{1}{\\sqrt2})^k', '4+3\\sqrt2'],
  ])('a radical ratio gives its simplest form: %s', (input, expected) => {
    // Under `evaluate()`, the closed form of a geometric series is
    // simplified (`1/(1 − √2/2)` is `2 + √2`). Under `simplify()`, the
    // outer simplification reduces it.
    const expr = ce.parse(input);
    expect(expr.evaluate().isSame(ce.parse(expected))).toBe(true);
    expect(expr.simplify().isSame(ce.parse(expected))).toBe(true);
  });

  test('the closed form of a telescoping sum has the value of the sum', () => {
    const expr = ce.parse('\\sum_{k=2}^n (\\sin(k+1)-\\sin k)');
    const simplified = expr.simplify();
    expect(simplified.operator).not.toBe('Sum');
    for (const n of [2, 3, 7]) {
      const direct = expr.subs({ n }).N().re;
      const closed = simplified.subs({ n }).N().re;
      expect(closed).toBeCloseTo(direct, 12);
    }
  });
});

describe('simplify() keeps the operator when a closed form needs more than evaluate() reads', () => {
  test('a symbol with an assigned value is not read', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    const expr = ce.parse(
      '\\sum_{k=1}^{\\infty} (\\frac1{k+x}-\\frac1{k+x+1})'
    );
    // `evaluate()` reads `x = 2` and gives 1/3. `simplify()` does not read
    // values, and the closed form would read them, so the sum stays.
    expect(expr.simplify().operator).toBe('Sum');
  });

  test('a closed form whose value depends on an assigned value is not used', () => {
    const ce = new ComputeEngine();
    ce.assign('x', ce.parse('\\frac12'));
    // The sum is −x for |x| < 1 and +∞ for x > 1: a closed form made with
    // the value 1/2 would be wrong after `x` is assigned 2.
    const expr = ce.parse('\\sum_{k=1}^{\\infty} (x^{k+1}-x^k)');
    expect(expr.simplify().operator).toBe('Sum');
  });

  test('a geometric series in an assigned symbol keeps the sum', () => {
    const ce = new ComputeEngine();
    ce.assign('x', ce.parse('\\frac12'));
    // `evaluate()` reads `x = 1/2` and gives 2. The closed form for a free
    // `x` would not be wrong, but `simplify()` does not read values.
    const expr = ce.parse('\\sum_{k=0}^{\\infty} x^k');
    expect(expr.simplify().operator).toBe('Sum');
  });

  test('a divergent sum keeps its form', () => {
    const ce = new ComputeEngine();
    // `evaluate()` gives +∞; its proof of divergence computes a symbolic
    // limit, which calls `simplify()`, so the rule does not use it.
    const expr = ce.parse('\\sum_{k=1}^{\\infty} \\frac1k');
    expect(expr.simplify().operator).toBe('Sum');
  });

  test.each([
    '\\sum_{k=0}^{\\infty} x^k \\sum_{j=1}^{\\infty} \\frac1j',
    '\\sum_{k=0}^{\\infty} (\\frac12)^k \\sum_{j=1}^{\\infty} \\frac1j',
    '\\sum_{k=0}^{\\infty} x^k \\int_0^1 e^{-t^2} dt',
  ])('a sum whose body holds a scoped operator keeps its form: %s', (input) => {
    const ce = new ComputeEngine();
    // The closed form would evaluate the factor that does not depend on the
    // index, and compute the inner sum or integral, which `evaluate()` of
    // the outer sum keeps.
    expect(ce.parse(input).simplify().operator).toBe('Sum');
  });

  test('a telescoping sum whose body holds an integral gets its closed form', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\sum_{k=1}^{n} (\\int_0^{k+1} e^{-t^2} dt - \\int_0^{k} e^{-t^2} dt)'
    );
    const simplified = expr.simplify();
    expect(simplified.operator).not.toBe('Sum');
    expect(simplified.isSame(ce.box(expr.evaluate().json))).toBe(true);
  });

  test('a function body that reads an assigned value keeps the sum', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('\\frac12'));
    ce.parse('f(t) \\coloneq a^t').evaluate();
    // `f(k + x + 1) − f(k + x)` telescopes, and its term at the infinite
    // bound is 0 only for |a| < 1: the closed form would read `a`.
    const expr = ce.parse('\\sum_{k=1}^{\\infty} (f(k+x+1)-f(k+x))');
    expect(expr.simplify().operator).toBe('Sum');
  });

  test('a value of the index name outside the sum is not read', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 5);
    const simplified = ce
      .parse('\\sum_{k=2}^n (\\sin(k+1)-\\sin k)')
      .simplify();
    expect(simplified.isSame(ce.parse('\\sin(n+1)-\\sin(2)'))).toBe(true);
  });

  test('a random bound is not put into the closed form', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Sum',
      ['Subtract', ['Sin', ['Add', 'k', 1]], ['Sin', 'k']],
      ['Limits', 'k', 1, ['Random', ['Range', 1, 6]]],
    ]);
    expect(expr.simplify().operator).toBe('Sum');
  });

  test('a function of unknown purity keeps the sum', () => {
    const ce = new ComputeEngine();
    // The terms of `f` may not be the same at each call, so they may not
    // cancel. `evaluate()` gives `f(b+1) − f(a)`.
    const expr = ce.parse('\\sum_{k=a}^{b} (f(k+1)-f(k))');
    expect(expr.simplify().operator).toBe('Sum');
  });
});
