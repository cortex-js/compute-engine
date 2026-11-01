import { ComputeEngine } from '../../src/compute-engine';
import { boundIsNotInteger } from '../../src/compute-engine/symbolic/simplify-sum';

// A closed form of a `Sum` or a `Product` substitutes its bounds for the
// index, and the enumeration of the same operator rounds a numeric bound
// down. A call of a host function whose result type is fixed by its
// signature (declared, or inferred from its body) and is not an integer type
// is not put into a closed form, also when its argument is an undeclared
// symbol: `g(n)` with `g(t) := 0.5 if t < 1` is 0.5 for a generic `n`, not an
// integer. Library operators (`\sqrt{n}`), and a host function whose result
// type is an integer type or the generic `number`, keep the convention for
// generic symbols.

describe('a bound that calls a host function with a real result', () => {
  const ce = new ComputeEngine();
  ce.parse('g(t) \\coloneq \\begin{cases} 0.5 & t < 1 \\end{cases}').evaluate();
  ce.parse(
    'w(t) \\coloneq \\begin{cases} 0.5 & t < 1 \\\\ 2.5 & \\text{otherwise} \\end{cases}'
  ).evaluate();
  ce.declare('r', '(number) -> real');

  test.each([
    // The enumeration over k = 0, 1, 2, 3.
    [`\\sum_{k=g(n)}^{3} k`, '6'],
    // The enumeration over k = 1..0: an empty range.
    [`\\sum_{k=1}^{g(n)} k`, '0'],
    [`\\prod_{k=1}^{g(n)} k`, '1'],
    [`\\sum_{k=w(n)}^{3} k`, '6'],
    [`\\sum_{k=1}^{w(n)} k`, '0'],
    [`\\prod_{k=1}^{w(n)} k`, '1'],
  ])('%s at n = 0 is %s in each order', (latex, expected) => {
    const e = ce.parse(latex);
    // Substitution, then evaluation.
    expect(e.subs({ n: 0 }).evaluate().toString()).toBe(expected);
    // evaluate(), then substitution.
    const viaEvaluate = e.evaluate().subs({ n: 0 }).evaluate();
    expect(viaEvaluate.toString()).toBe(expected);
    // simplify(), then substitution.
    const viaSimplify = e.simplify().subs({ n: 0 }).evaluate();
    expect(viaSimplify.toString()).toBe(expected);
  });

  test('a declared function with a real result keeps the operator', () => {
    expect(ce.parse(`\\sum_{k=1}^{r(n)} k`).simplify().operator).toBe('Sum');
    expect(ce.parse(`\\sum_{k=1}^{r(n)} k`).evaluate().operator).toBe('Sum');
    expect(ce.parse(`\\sum_{k=1}^{g(n)+1} k`).simplify().operator).toBe(
      'Sum'
    );
  });
});

describe('a bound that applies Floor to a host function call', () => {
  const ce = new ComputeEngine();
  ce.parse(
    'v(t) \\coloneq \\begin{cases} 3.5 & t < 1 \\\\ 5.5 & \\text{otherwise} \\end{cases}'
  ).evaluate();

  // `⌊v(n)⌋/2` is 3/2 at n = 0, so the enumeration runs over k = 1 only.
  // The triangular closed form at 3/2 is 15/8. An integer part of the bound
  // (`⌊v(n)⌋`) does not make the whole bound an integer.
  test.each([
    [`\\sum_{k=1}^{\\frac{\\lfloor v(n) \\rfloor}{2}} k`, '1'],
    [`\\sum_{k=1}^{\\lfloor v(n) \\rfloor} k`, '6'],
  ])('%s at n = 0 is %s in each order', (latex, expected) => {
    const e = ce.parse(latex);
    expect(e.subs({ n: 0 }).evaluate().toString()).toBe(expected);
    expect(e.evaluate().subs({ n: 0 }).evaluate().toString()).toBe(expected);
    expect(e.simplify().subs({ n: 0 }).evaluate().toString()).toBe(expected);
  });

  // Another check of the closed-form rules keeps these sums symbolic today,
  // so the rule for the bound is also tested on its own.
  test('the bound is proved not to be an integer', () => {
    const half = ce.box(['Divide', ['Floor', ['v', 'n']], 2]);
    expect(boundIsNotInteger(half)).toBe(true);
  });

  test('both stay symbolic', () => {
    for (const latex of [
      `\\sum_{k=1}^{\\frac{\\lfloor v(n) \\rfloor}{2}} k`,
      `\\sum_{k=1}^{\\lfloor v(n) \\rfloor} k`,
    ])
      expect(ce.parse(latex).simplify().operator).toBe('Sum');
  });
});

describe('a call keeps the binding it was boxed with', () => {
  test('after its scope is removed', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('r', '(real) -> real');
    const e = ce.parse(`\\sum_{k=1}^{r(n)} k`);
    ce.popScope();
    expect(e.simplify().operator).toBe('Sum');
  });

  test('under a shadowing declaration', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('r', '(real) -> real');
    const e = ce.parse(`\\sum_{k=1}^{r(n)} k`);
    ce.pushScope();
    // An operator definition of the same name, not a value definition.
    ce.declare('r', { signature: '(real) -> integer' });
    expect(e.simplify().operator).toBe('Sum');
    ce.popScope();
    ce.popScope();
  });
});

describe('a bound that keeps the closed form', () => {
  const ce = new ComputeEngine();
  ce.declare('f', '(number) -> integer');
  // The result type of `h` is `number`, a generic value: `h(n)` keeps the
  // closed form, as the same bound written inline (`2n`) does.
  ce.parse('h(t) \\coloneq 2t').evaluate();

  test.each([
    [`\\sum_{k=1}^{h(n)} k`, '1/2 * (h(n) + h(n)^2)'],
    [`\\sum_{k=1}^{2n} k`, '2n^2 + n'],
    [`\\sum_{k=1}^{f(n)} k`, '1/2 * (f(n) + f(n)^2)'],
    [`\\sum_{k=1}^{n} k`, '1/2 * (n^2 + n)'],
    [`\\sum_{k=1}^{\\sqrt{n}} k`, '1/2 * (n + sqrt(n))'],
  ])('%s', (latex, expected) => {
    expect(ce.parse(latex).simplify().toString()).toBe(expected);
  });
});
