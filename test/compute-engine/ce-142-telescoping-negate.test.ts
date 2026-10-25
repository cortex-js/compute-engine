import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// CE-142.4: a telescoping body whose negative term has its sign in a
// coefficient (`−1/(k+x+1)`), not in a `Negate`, is summed in closed form.
describe('CE-142.4 telescoping sum without a Negate term', () => {
  test('infinite sum with a free variable', () => {
    const e = ce.parse(
      '\\sum_{k=1}^\\infty \\left(\\frac{1}{k+x} - \\frac{1}{k+x+1}\\right)'
    );
    expect(e.evaluate().toString()).toBe('1 / (x + 1)');
    expect(e.N().toString()).toBe('1 / (x + 1)');
  });

  test('finite sum with a symbolic bound', () => {
    const e = ce.parse(
      '\\sum_{k=1}^n \\left(\\frac{1}{k+x} - \\frac{1}{k+x+1}\\right)'
    );
    expect(e.evaluate().toString()).toBe('1 / (x + 1) - 1 / (n + x + 1)');
  });

  test('the closed form agrees with the partial sum', () => {
    const e = ce.parse(
      '\\sum_{k=1}^n \\left(\\frac{1}{k+x} - \\frac{1}{k+x+1}\\right)'
    );
    const closed = e.evaluate();
    for (const [n, x] of [
      [5, 0.5],
      [12, 2.25],
    ]) {
      let partial = 0;
      for (let k = 1; k <= n; k++) partial += 1 / (k + x) - 1 / (k + x + 1);
      expect(closed.subs({ n, x }).N().re).toBeCloseTo(partial, 12);
    }
  });

  // The term at the infinite bound folds to `∞/∞` (`Indeterminate`); its
  // limit is the ratio of the leading coefficients, 1, not `Indeterminate`.
  test('a term whose substitution at infinity is indeterminate', () => {
    const partial = (f: (k: number) => number) => {
      let s = 0;
      for (let k = 1; k <= 1e6; k++) s += f(k);
      return s;
    };
    const x = 0.7;
    const a = ce
      .parse(
        '\\sum_{k=1}^{\\infty} \\left(\\frac{k+x+1}{k+x+2} - \\frac{k+x}{k+x+1}\\right)'
      )
      .evaluate();
    expect(a.toString()).not.toMatch(/Indeterminate|NaN/);
    expect(a.subs({ x }).N().re).toBeCloseTo(1 / (x + 2), 12);
    expect(a.subs({ x }).N().re).toBeCloseTo(
      partial((k) => (k + x + 1) / (k + x + 2) - (k + x) / (k + x + 1)),
      5
    );

    // Σ (t(k+1) − t(k)) with t(k) = k/(k+x) is lim t − t(1) = x/(x+1).
    const b = ce
      .parse(
        '\\sum_{k=1}^{\\infty} \\left(\\frac{k+1}{k+x+1} - \\frac{k}{k+x}\\right)'
      )
      .evaluate();
    expect(b.toString()).not.toMatch(/Indeterminate|NaN/);
    expect(b.subs({ x }).N().re).toBeCloseTo(x / (x + 1), 12);
    expect(b.subs({ x }).N().re).toBeCloseTo(
      partial((k) => (k + 1) / (k + x + 1) - k / (k + x)),
      5
    );
  });

  test('a body with a Negate term still telescopes', () => {
    expect(
      ce.parse('\\sum_{k=2}^n (\\sin(k+1) - \\sin(k))').evaluate().toString()
    ).toBe('sin(n + 1) - sin(2)');
  });
});
