import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';

describe('loadIntegrationRules (Rubi integration rule driver)', () => {
  test('loads the bundled Chapter-1 corpus', () => {
    const ce = new ComputeEngine();
    const report = loadIntegrationRules(ce);
    expect(report.ruleCount).toBeGreaterThan(2000);
    expect(report.skipped).toBe(0);
  });

  test('is idempotent per engine', () => {
    const ce = new ComputeEngine();
    const a = loadIntegrationRules(ce);
    const b = loadIntegrationRules(ce);
    expect(b.ruleCount).toBe(a.ruleCount);
  });

  describe('integrates algebraic integrands via Integrate.evaluate()', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const dF = ce.box(['D', F, 'x']).evaluate();
      for (const x of [0.31, 0.73, 1.42]) {
        const a = dF.subs({ x }).N().re;
        const b = integrand.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    test('∫(2+3x)² dx', () => verify('(2+3x)^2'));
    test('∫x(1+x)³ dx', () => verify('x(1+x)^3'));
    test('∫1/((1+x)(2+x)) dx', () => verify('\\frac{1}{(1+x)(2+x)}'));
    // Rubi closes this; the built-in integrator does not (see below).
    test('∫x/√(1+x) dx', () => verify('\\frac{x}{\\sqrt{1+x}}'));
  });

  describe('integrates the (a+b cos+c sin) trig family (Chapter-4 pilot)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const dF = ce.box(['D', F, 'x']).evaluate();
      for (const x of [0.31, 0.73, 1.42]) {
        const a = dF.subs({ x }).N().re;
        const b = integrand.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    // The three Wester CAS-review cases: a² − b² − c² < 0 (general
    // Weierstrass) for k=3,4 and the degenerate a² = b² + c² for k=5.
    test('∫1/(3cos x + 4sin x + 3) dx', () =>
      verify('\\frac{1}{3\\cos x + 4\\sin x + 3}'));
    test('∫1/(3cos x + 4sin x + 4) dx', () =>
      verify('\\frac{1}{3\\cos x + 4\\sin x + 4}'));
    test('∫1/(3cos x + 4sin x + 5) dx', () =>
      verify('\\frac{1}{3\\cos x + 4\\sin x + 5}'));
  });

  test('the built-in antiderivative still handles non-Rubi integrands', () => {
    // The provider returns null for a Gaussian (outside Chapter 1), so the
    // built-in antiderivative runs and produces Erf.
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const F = ce.parse('\\int e^{-x^2} \\, dx').evaluate();
    expect(F.has('Integrate')).toBe(false);
    expect(F.toString()).toContain('Erf');
  });

  test('default engine (no rules loaded) is unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int x \\, dx').evaluate().toString()).toContain('x');
    // x/√(1+x) is not handled by the built-in integrator alone
    expect(
      ce
        .parse('\\int \\frac{x}{\\sqrt{1+x}} \\, dx')
        .evaluate()
        .has('Integrate')
    ).toBe(true);
  });
});
