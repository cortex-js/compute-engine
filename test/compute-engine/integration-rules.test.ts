import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';
import { compileRuleDocs } from '../../src/compute-engine/rubi/compile';
import { RubiDriver } from '../../src/compute-engine/rubi/driver';

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

  // ── SYM P2-28: the Rubi pack is reachable ONLY through the integration
  // provider; it must never leak into the simplify() rule set. ──
  describe('Rubi/simplify separation (structural, not just by convention)', () => {
    test('loading the pack does not change the simplify rule set', () => {
      const ce = new ComputeEngine();
      const before = ce.simplificationRules.length;
      const beforeIds = ce.simplificationRules.map((r) => r.id);
      loadIntegrationRules(ce);
      expect(ce.simplificationRules.length).toBe(before);
      // and the same rules, in the same order — no Rubi rule appended
      expect(ce.simplificationRules.map((r) => r.id)).toEqual(beforeIds);
    });

    test('the driver is reachable only via the integration provider', () => {
      const ce = new ComputeEngine();
      expect((ce as any)._integrationProvider).toBeUndefined();
      loadIntegrationRules(ce);
      expect(typeof (ce as any)._integrationProvider).toBe('function');
      // No compiled Rubi rule id (`<file>#<index>`) shows up as a simplify
      // rule — the two rule populations are disjoint.
      const rubiPack = compileRuleDocs(
        ce,
        // reuse the bundled corpus indirectly: any real rule id has this shape
        []
      );
      expect(rubiPack.rules).toEqual([]); // sanity: empty in => empty out
      const simplifyIds = new Set(
        ce.simplificationRules.map((r) => r.id).filter(Boolean)
      );
      // a Rubi id looks like "1.1.1.1#3"; none should be a simplify rule
      for (const id of simplifyIds)
        expect(/#\d+$/.test(String(id))).toBe(false);
    });
  });

  // ── SYM P3-9: the load report must carry skip reasons, and cached
  // (idempotent) re-loads must report honest numbers, not `skipped: 0`. ──
  describe('load report skip accounting', () => {
    test('compileRuleDocs surfaces the skip reason for each dropped rule', () => {
      const ce = new ComputeEngine();
      // Power(a_, 0) canonicalizes to 1, folding away slot `a` — an
      // uncompilable rule the compiler must record with a reason.
      const doc = {
        file: 'synthetic',
        rules: [
          {
            index: 1,
            variable: 'x',
            lhs: ['Power', ['Blank', 'a'], 0],
            bindings: [],
            condition: null,
            innerCondition: null,
            rhs: 0,
            source: '',
          },
        ],
      };
      const res = compileRuleDocs(ce, [doc as any]);
      expect(res.rules).toEqual([]);
      expect(res.skipped).toHaveLength(1);
      expect(res.skipped[0]).toMatchObject({
        id: 'synthetic#1',
        reason: expect.stringContaining('slots folded away'),
      });
    });

    test('report carries skippedRules and cached re-load stays honest', () => {
      const ce = new ComputeEngine();
      const first = loadIntegrationRules(ce);
      const cached = loadIntegrationRules(ce); // served from the WeakMap cache
      // The field exists and is internally consistent (pre-fix the report
      // had no skippedRules and the cached call hardcoded skipped: 0).
      expect(Array.isArray(first.skippedRules)).toBe(true);
      expect(first.skipped).toBe(first.skippedRules.length);
      // Cached call reports the SAME numbers, derived from the cached compile
      // result rather than a stale `skipped = 0`.
      expect(cached.skipped).toBe(first.skipped);
      expect(cached.skippedRules).toEqual(first.skippedRules);
      // NOTE: the shipped corpus currently skips 0 rules, so the honest
      // *non-zero* count is exercised by the compileRuleDocs test above; this
      // test locks the report shape and the cache-consistency contract.
    });
  });

  // ── SYM P2-26 / P3-11: a re-entrant driver call (the native-rational
  // fallback re-enters int() via ce.Integrate.evaluate()) must not clobber
  // the outer call's per-call state — deadline, trigActive — and the memo is
  // bounded to a single top-level call. ──
  describe('re-entrant state isolation and memo bounding', () => {
    test('a re-entrant int() call does not extend the deadline or leak trig/caches', () => {
      const ce = new ComputeEngine();
      const driver = new RubiDriver(ce, [], { timeLimitMs: 10_000 });
      const d = driver as any;
      // Simulate an in-flight OUTER call: fixed deadline, warm memo, trig on,
      // and mark that we are inside the native fallback re-entry.
      const OUTER_DEADLINE = Date.now() + 999_999;
      d.deadline = OUTER_DEADLINE;
      d.trigActive = true;
      d.memo.set('x§sentinel', ce.symbol('bar'));
      d.inNativeFallback = true; // ⇒ this int() call is re-entrant
      driver.int(ce.symbol('x'), 'x'); // trivial ∫x dx subproblem
      // deadline NOT reset/extended (interruptible-evaluation contract)
      expect(d.deadline).toBe(OUTER_DEADLINE);
      // trigActive restored to the outer value on the way out
      expect(d.trigActive).toBe(true);
      // memo NOT cleared on re-entry (outer cycle-guard entries survive)
      expect(d.memo.has('x§sentinel')).toBe(true);
    });

    test('a top-level int() call clears the memo (bounds unbounded growth)', () => {
      const ce = new ComputeEngine();
      const driver = new RubiDriver(ce, [], { timeLimitMs: 10_000 });
      const d = driver as any;
      d.memo.set('x§stale', ce.One); // residue from a prior top-level call
      expect(d.inNativeFallback).toBe(false); // genuine top-level entry
      driver.int(ce.symbol('x'), 'x');
      expect(d.memo.has('x§stale')).toBe(false);
    });
  });

  // ── SYM P2-27: rule-driven outputs are folded clean (no stray ln(e)) even
  // before a user simplify(). ──
  test('Chapter-2 exponential output has no stray ln(e)/·1 clutter', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const F = ce.parse('\\int \\frac{e^{2x}}{x^3} \\, dx').evaluate();
    const s = F.toString();
    expect(s).not.toContain('ln(e)');
    // the folded ln(e) previously left a non-canonical `2x * 1` in the
    // ExpIntegralEi argument — assert that artifact is gone too
    expect(s).not.toContain('* 1');
    expect(F.has('Integrate')).toBe(false);
  });

  describe('integrates algebraic integrands via Integrate.evaluate()', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const dF = ce.expr(['D', F, 'x']).evaluate();
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
      const dF = ce.expr(['D', F, 'x']).evaluate();
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

  describe('bare trig-power reduction (cosine has no Rubi chapter)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // closed form, not inert
      const dF = ce.expr(['D', F, 'x']).evaluate();
      for (const x of [0.31, 0.73, 1.42]) {
        const a = dF.subs({ x }).N().re;
        const b = integrand.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    test('∫cos²x dx', () => verify('\\cos^2 x'));
    test('∫cos⁴x dx (even)', () => verify('\\cos^4 x'));
    test('∫cos⁵x dx (odd)', () => verify('\\cos^5 x'));
    test('∫cos⁶x dx', () => verify('\\cos^6 x'));
  });

  describe('integrates exponential integrands (Chapter 2)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const dF = ce.expr(['D', F, 'x']).evaluate();
      for (const x of [0.31, 0.73, 1.42]) {
        const a = dF.subs({ x }).N().re;
        const b = integrand.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    // None of these are handled by the built-in antiderivative alone; they
    // close through the Chapter-2 (c+d x)^m·(a+b·Fⁿ)^p / miscellaneous
    // exponential rules.
    test('∫x²/E^(4x) dx (polynomial × exponential)', () =>
      verify('\\frac{x^2}{e^{4x}}'));
    test('∫e^(2x)(1+e^(2x))³ dx (binomial in eˣ)', () =>
      verify('e^{2x}(1+e^{2x})^3'));
    test('∫1/(1+eˣ) dx (rational in eˣ)', () =>
      verify('\\frac{1}{1+e^{x}}'));
  });

  describe('integrates hyperbolic integrands (Chapter 6)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const dF = ce.expr(['D', F, 'x']).evaluate();
      for (const x of [0.31, 0.73, 1.18]) {
        const a = dF.subs({ x }).N().re;
        const b = integrand.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    // Sinh/Cosh powers/products close via the hyperbolic→exponential expansion;
    // the reciprocals (Tanh/Csch/…) via the FunctionOfExponential substitution.
    test('∫cosh⁴x dx (power reduction)', () => verify('\\cosh^4 x'));
    test('∫sinh³x·cosh x dx (product)', () => verify('\\sinh^3 x \\cosh x'));
    test('∫tanh²x dx (reciprocal → eˣ substitution)', () =>
      verify('\\tanh^2 x'));
    test('∫csch⁴x dx (reciprocal)', () => verify('\\csch^4 x'));
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
