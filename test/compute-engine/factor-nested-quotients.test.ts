import { ComputeEngine } from '../../src/compute-engine';
import {
  factor,
  factorComputationCount,
} from '../../src/compute-engine/boxed-expression/factor';

/**
 * `factor()` and `BoxedExpression.toNumericValue()` are mutually recursive:
 * the numeric-value of a sum factors it, and factoring a sum reads the
 * numeric-value of every term. Nothing shares structure between the nodes the
 * engine builds on the way, so before the memo of 2026-09-22 the same
 * sub-quotient was factored again at every place it occurred and the number
 * of factorizations grew exponentially with the nesting depth.
 *
 * These tests pin both halves of the fix: the results are unchanged, and the
 * amount of work is small. The work is counted, not timed — an assertion on
 * elapsed time measures the machine.
 */

describe('factor() on a nested quotient', () => {
  const ce = new ComputeEngine();

  // The factored form of each nested quotient. These are the answers
  // `factor()` gave before the memo was added, kept here so that a change to
  // them has to be deliberate.
  const CASES: [latex: string, factored: string][] = [
    ['\\frac{\\frac{a}{b}}{\\frac{c}{d}}', 'a * d * 1 / (b * c)'],
    ['\\frac{\\frac{1}{x+1}}{\\frac{1}{x-1}}', '1 / (x + 1) * (x - 1)'],
    ['\\frac{1}{\\frac{1}{x}+\\frac{1}{y}}', '1 / (1 / x + 1 / y)'],
    ['\\frac{x}{\\frac{x}{\\frac{x}{x+1}}}', 'x * 1 / (x + 1)'],
    [
      '\\frac{1}{1+\\frac{1}{1+\\frac{1}{1+x}}}',
      '1 / (1 / (1 / (x + 1) + 1) + 1)',
    ],
    [
      '\\frac{\\frac{1}{2\\sqrt{x}}}{2\\sqrt{x+\\sqrt{x}}}',
      '1/4 * 1 / sqrt(x) * 1 / sqrt(x + sqrt(x))',
    ],
    ['\\frac{2x+4}{2}', 'x + 2'],
    ['\\frac{1}{x}+\\frac{1}{x^2}', '1 / x + x^(-2)'],
  ];

  test.each(CASES)('factor(%s)', (latex, factored) => {
    expect(factor(ce.parse(latex)).toString()).toBe(factored);
  });

  it('keeps the value of the quotient it factors', () => {
    const values = { a: 3, b: 5, c: 7, d: 11, x: 1.7, y: 2.9 };
    for (const [latex] of CASES) {
      const expr = ce.parse(latex);
      const before = expr.subs(values).N().re;
      const after = factor(expr).subs(values).N().re;
      expect(after).toBeCloseTo(before, 12);
    }
  });
});

describe('the nested-radical derivative witness', () => {
  // f(x) = sqrt(x + sqrt(x + sqrt(x + sqrt(x + x)))): four levels of the
  // chain rule, each of which divides by a radical, so the derivative is a
  // quotient nested four deep.
  const F = '\\sqrt{x+\\sqrt{x+\\sqrt{x+\\sqrt{x+x}}}}';
  const f = (x: number): number =>
    Math.sqrt(x + Math.sqrt(x + Math.sqrt(x + Math.sqrt(x + x))));

  function derivative(order: number) {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse(`x \\mapsto ${F}`));
    return { ce, d: ce.box(['Derivative', 'f', order]).evaluate() };
  }

  it('the first derivative agrees with a finite difference', () => {
    const { ce, d } = derivative(1);
    for (const x0 of [0.7, 2.3]) {
      const h = 1e-4;
      const expected = (f(x0 + h) - f(x0 - h)) / (2 * h);
      expect(ce.box(['Apply', d, x0]).N().re).toBeCloseTo(expected, 6);
    }
  });

  it('the second derivative agrees with a finite difference', () => {
    const { ce, d } = derivative(2);
    for (const x0 of [0.7, 2.3]) {
      const h = 1e-4;
      const expected = (f(x0 + h) - 2 * f(x0) + f(x0 - h)) / (h * h);
      expect(ce.box(['Apply', d, x0]).N().re).toBeCloseTo(expected, 4);
    }
  });

  // The guard on the walk. Without the memo the first derivative factored
  // 376 expressions and the second 20,678 — the count grows with the number
  // of PATHS through the expression. With it, the count follows the number
  // of distinct sub-expressions: 14 and 51 when this was written. The bounds
  // are loose enough to absorb an unrelated change of the derivative's shape
  // and far below the numbers the exponential walk produced.
  it('factors a bounded number of expressions', () => {
    const first = factorComputationCount();
    derivative(1);
    const second = factorComputationCount();
    derivative(2);
    const third = factorComputationCount();

    expect(second - first).toBeLessThan(200);
    expect(third - second).toBeLessThan(500);
  });
});

describe('the factor() memo', () => {
  it('does no work the second time the same expression is factored', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('2x+4');

    const before = factorComputationCount();
    factor(expr);
    const afterFirst = factorComputationCount();
    factor(expr);
    const afterSecond = factorComputationCount();

    expect(afterFirst - before).toBe(1);
    expect(afterSecond - afterFirst).toBe(0);
  });

  it('answers again when an assumption changes the result', () => {
    // sqrt(x)*sqrt(y) groups into sqrt(x*y) only once both factors are known
    // to be non-negative: the grouping is unsound for a negative base, since
    // the principal branches differ. Asserting the two facts must therefore
    // change the answer for an expression that was already factored.
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sqrt{x}\\sqrt{y}');
    expect(factor(expr).toString()).toBe('sqrt(x) * sqrt(y)');

    ce.assume(ce.parse('x \\geq 0'));
    ce.assume(ce.parse('y \\geq 0'));
    expect(factor(expr).toString()).toBe('sqrt(x * y)');
  });

  it('is not shared between engines', () => {
    const ce1 = new ComputeEngine();
    ce1.assume(ce1.parse('x \\geq 0'));
    ce1.assume(ce1.parse('y \\geq 0'));
    expect(factor(ce1.parse('\\sqrt{x}\\sqrt{y}')).toString()).toBe(
      'sqrt(x * y)'
    );

    // The same structure digests the same way in every engine, but the
    // assumptions that decide the answer belong to one of them.
    const ce2 = new ComputeEngine();
    expect(factor(ce2.parse('\\sqrt{x}\\sqrt{y}')).toString()).toBe(
      'sqrt(x) * sqrt(y)'
    );
  });

  it('tells apart two expressions that digest alike but are bound apart', () => {
    // A symbol serializes as its name, so a symbol digests the same whatever
    // it is bound to. Two occurrences of `x` that denote different bindings
    // therefore produce expressions with EQUAL digests, and the memo must not
    // serve one of them the other's answer.
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\geq 0'));
    ce.assume(ce.parse('y \\geq 0'));
    const outer = ce.parse('\\sqrt{x}\\sqrt{y}');

    // Both expressions are factored INSIDE the scope that shadows the two
    // names, so the two answers are computed under one and the same cache
    // generation: nothing but the binding tells them apart.
    ce.pushScope();
    ce.declare('x', 'number');
    ce.declare('y', 'number');
    const factoredOuter = factor(outer);
    const inner = ce.parse('\\sqrt{x}\\sqrt{y}');
    expect(inner.digest).toBe(outer.digest);
    expect(inner.isSame(outer)).toBe(false);

    // Not the outer expression's answer: `isSame` reads binding identity, so
    // a result built from the outer bindings is not the same expression as
    // one built from the inner ones.
    expect(factor(inner).isSame(factoredOuter)).toBe(false);
    ce.popScope();
  });
});
