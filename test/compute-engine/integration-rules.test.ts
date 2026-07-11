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

  // Symbolic-coefficient quartic-denominator rationals (RUBI.md §5 Phase R25).
  // ∫(d+e·x²)/(a+b·x⁴) and relatives close to ArcTan/Log for SYMBOLIC a,b:
  // the `(d+e·x^(n/2))/(a+b·x^n)` numerator no longer ping-pongs between
  // ExpandIntegrand and the 1.1.3.2 split (see rubi-utils ExpandIntegrand
  // guard). D-verify by differentiating and sampling at fixed parameter values.
  describe('symbolic quartic-denominator rationals (R25)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string, params: Record<string, number>) => {
      const integrand = ce.parse(latex);
      let F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // closed form, not inert
      let g = integrand;
      for (const [k, v] of Object.entries(params)) {
        F = F.subs({ [k]: v });
        g = g.subs({ [k]: v });
      }
      const dF = ce.expr(['D', F, 'x']).evaluate();
      let sampled = 0;
      for (const x of [0.31, 0.73, 1.27, -0.41, -1.31]) {
        const a = dF.subs({ x }).N().re;
        const b = g.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
        sampled++;
      }
      expect(sampled).toBeGreaterThan(0);
    };
    test('∫1/(a+b·x⁴) dx', () =>
      verify('\\frac{1}{a+b x^4}', { a: 2, b: 3 }));
    test('∫x²/(a+b·x⁴) dx', () =>
      verify('\\frac{x^2}{a+b x^4}', { a: 2, b: 3 }));
    test('∫(c+d·x²)/(a+b·x⁴) dx', () =>
      verify('\\frac{c+d x^2}{a+b x^4}', { a: 2, b: 3, c: 1.7, d: 0.9 }));
    test('∫(a+b·x+d·x³)/(2+3·x⁴) dx', () =>
      verify('\\frac{a+b x+d x^3}{2+3x^4}', { a: 1.3, b: 0.7, d: 2.1 }));
    test('∫x⁶/(a+c·x⁴)³ dx', () =>
      verify('\\frac{x^6}{(a+c x^4)^3}', { a: 2, c: 3 }));
    test('∫1/((a+b·x⁴)(c+d·x⁴)) dx', () =>
      verify('\\frac{1}{(a+b x^4)(c+d x^4)}', { a: 2, b: 3, c: 5, d: 0.7 }));
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

  // Chapter-4 §4.3 Tangent (RUBI.md §5, Phase R12). The tan-authored reduction
  // rules are bundled, and the runtime `cot → −tan[θ+π/2]` cofunction shift
  // (default-on since R12) routes pure-cot integrands onto them — the tan/cot
  // mirror of the 4.5 sec→csc routing. All D-verified against the integrand.
  describe('integrates the tangent family (Chapter-4 §4.3)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const dF = ce.expr(['D', F, 'x']).evaluate();
      // stay clear of the tan/cot poles at 0 and π/2
      for (const x of [0.31, 0.73, 1.18]) {
        const a = dF.subs({ x }).N().re;
        const b = integrand.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    test('∫tan²x dx', () => verify('\\tan^2 x'));
    test('∫tan⁴x dx (power reduction)', () => verify('\\tan^4 x'));
    test('∫(1+tan x)² dx (binomial)', () => verify('(1+\\tan x)^2'));
    test('∫tan²x·sec²x dx (product)', () => verify('\\tan^2 x \\sec^2 x'));
    test('∫cot²x dx (cot power reduction)', () => verify('\\cot^2 x'));
    // this pure-cot binomial is INERT without the shift; it closes only by
    // reflecting cot→tan onto the bundled 4.3 (a+b·tan)^n rules (R12 default-on)
    test('∫(2+3cot x)² dx (cot→tan shift → 4.3 binomial rule)', () =>
      verify('(2+3\\cot x)^2'));
  });

  // §4.5 Secant — integer-power SYMBOLIC binomials of sec. These are INERT
  // without the R13 carve-out: the R11 sec→csc[·+π/2] reflection makes them a
  // csc binomial, but `reciprocalToPower` then rewrites the reflected csc to
  // `1/sin` before a csc-binomial rule can match. R13 keeps the reflected csc
  // raw so the 4.5.1 csc-binomial rule family closes them. D-verified.
  describe('integrates the secant binomial family (Chapter-4 §4.5, R13)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string, subs: Record<string, number> = {}) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const dF = ce.expr(['D', F, 'x']).evaluate();
      for (const x of [0.31, 0.73, 1.18]) {
        const a = dF.subs({ ...subs, x }).N().re;
        const b = integrand.subs({ ...subs, x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    test('∫1/(2+3sec x) dx (binomial denominator)', () =>
      verify('\\frac{1}{2+3\\sec x}'));
    test('∫(2+3sec x)² dx (binomial power)', () =>
      verify('(2+3\\sec x)^2'));
    test('∫1/(a+b·sec x) dx (symbolic params)', () =>
      verify('\\frac{1}{a+b\\sec x}', { a: 1.7, b: 0.6 }));
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

  // Chapter-3 Logarithms (RUBI.md §5, Phase R17). The log families are bundled
  // (bundle-corpus.ts ch3Dir): by-parts log rules (∫(a+bx)^m·Log[u], 3.5 #34)
  // and the PolyLog telescope (∫(f+gx)^m·Log[1+e·F^{gx}] → PolyLog[2,…], 3.5
  // #14). All D-verified against the integrand. These all go inert without the
  // Chapter-3 bundle walk (verified by reverting ch3Dir), so they exercise it.
  describe('integrates the logarithm family (Chapter-3)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    // Verify by finite-differencing F.N() (not symbolic D[F]): the PolyLog
    // cases have an inert symbolic derivative (Derivative[PolyLog,…] does not
    // numericize) but F.N() itself is numerically evaluable, so the numeric
    // derivative of F is the robust check. `\ln(x)` is always parenthesized:
    // `\ln x` before `dx` would absorb the differential `d` (parser quirk).
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      for (const x of [0.31, 0.73, 1.42]) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (typeof d !== 'number' || typeof f !== 'number') continue;
        expect(d).toBeCloseTo(f, 6);
      }
    };
    // Plain logarithm base cases (by-parts, 3.5 #31/#34, 3.1.2 #4).
    test('∫log(x) dx', () => verify('\\ln(x)'));
    test('∫x·log(x)² dx', () => verify('x\\ln(x)^2'));
    test('∫log(2+3x) dx', () => verify('\\ln(2+3x)'));
    test('∫x²·log(x) dx', () => verify('x^2\\ln(x)'));
    // PolyLog telescope on a logarithm of an exponential (3.5 #14): the
    // ∫Log[1+e·F^{gx}] base case closes to PolyLog[2, −e·F^{gx}]. This is the
    // Chapter-3 PolyLog producer that Chapter-2 §2.2 reduces into.
    test('∫log(1+eˣ) dx → PolyLog(2, −eˣ)', () => {
      const F = ce.parse('\\int \\ln(1+e^x) \\, dx').evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('PolyLog');
      verify('\\ln(1+e^x)');
    });
    test('∫log(2+eˣ) dx (PolyLog)', () => verify('\\ln(2+e^x)'));

    // FunctionOfLog (RUBI.md §5, R19): the 3.5 catch-all
    // ∫F(Log[a·xⁿ])/x → 1/n·Subst[∫F dx, x, Log[a·xⁿ]]. Detecting u=F(Log[3x])
    // requires the FunctionOfLog recognizer (was a fail-closed stub), whose
    // input Cancel[x·u] also needs a common-x-monomial cancel CE lacks.
    // ∫(Log[3x]²−1)/(x·(1+Log[3x]+Log[3x]²)) → arctan/log of Log[3x].
    test('∫(log(3x)²−1)/(x(1+log(3x)+log(3x)²)) dx (FunctionOfLog)', () => {
      const latex = '\\frac{\\ln(3x)^2-1}{x(1+\\ln(3x)+\\ln(3x)^2)}';
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('arctan');
      verify(latex);
    });

    // Regression (RUBI.md §5, R17): the "power-in-log" back-substitution rule
    // 3.3 #60 rewrites Log[c·(d·(e+f·x)^m)^n] via Rubi's general
    // Subst[u, expr, repl] := u /. expr -> repl — a subexpression replacement,
    // NOT a substitution of the integration variable. The build() Subst
    // handler used to ignore its middle argument and substitute `x`, which
    // corrupted the antiderivative (the log argument gained spurious powers,
    // e.g. ∫Log[c·(b·x^n)^p]²/x⁴ → a form with Log[c·b^p·(c·(b·x^n)^p)^(n·p)]).
    // Symbolic b,c,n,p are required so the nested-power log stays opaque
    // (concrete positive numerics collapse (b·x^n)^p and bypass rule 3.3 #60).
    test('∫Log[c·(b·xⁿ)ᵖ]²/x⁴ dx (power-in-log, rule 3.3 #60 back-subst)', () => {
      const latex = '\\frac{\\ln(c(b x^n)^p)^2}{x^4}';
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      // The log argument must survive intact — no spurious powers.
      expect(F.toString()).toContain('ln(c * (b * x^n)^p)');
      // D-verify with substituted params + finite-difference in x.
      const params = { b: 1.7, c: 2.3, n: 1.4, p: 0.6 };
      const Fp = F.subs(params);
      const fp = integrand.subs(params);
      const h = 1e-5;
      const fval = (v: number) => Fp.subs({ x: v }).N().re as number;
      for (const x of [0.31, 0.73, 1.42]) {
        const d = (fval(x + h) - fval(x - h)) / (2 * h);
        const f = fp.subs({ x }).N().re as number;
        if (typeof d !== 'number' || typeof f !== 'number') continue;
        expect(d).toBeCloseTo(f, 5);
      }
    });
  });

  // R16/R17 Chapter-2 §2.2 → Chapter-3 → Chapter-8 chain (RUBI.md §5, Phase
  // R17 part b). ∫x^m·F^{gx}/(a+b·F^{gx}) reduces (2.2 #1) to
  // ∫x^{m-1}·Log[1+e·F^{gx}], which the Chapter-3 rule 3.5 #14 telescopes to
  // ∫x^{m-1}·PolyLog[2, −e·F^{gx}]. That LAST sub-integral now closes via the
  // PolyLog-of-exponential rules ∫x^m·PolyLog[n, d·F^{gx}] (Rubi Chapter 8
  // §8.8 #185/#191, bundle-corpus.ts ch8PolyLogFile), so the full
  // antiderivative closes end to end, carrying Log and PolyLog[2..4] terms.
  // D-verified by finite-differencing F.N() (not symbolic D[F]): the PolyLog
  // terms have an inert symbolic derivative but F.N() is numerically
  // evaluable, so the numeric derivative of F is the robust check.
  describe('closes the Chapter-2 → Chapter-3 → Chapter-8 PolyLog chain', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      for (const x of [0.31, 0.73, 1.42]) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (typeof d !== 'number' || typeof f !== 'number') continue;
        expect(d).toBeCloseTo(f, 6);
      }
    };
    test('∫x³·eˣ/(2+eˣ) dx (Log + PolyLog[2..4])', () => {
      const F = ce.parse('\\int \\frac{x^3 e^x}{2+e^x} \\, dx').evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('PolyLog');
      verify('\\frac{x^3 e^x}{2+e^x}');
    });
    test('∫x·log(1+eˣ) dx (PolyLog[2,3])', () => {
      const F = ce.parse('\\int x\\ln(1+e^x) \\, dx').evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('PolyLog');
      verify('x\\ln(1+e^x)');
    });
  });

  // R17 part (b): single-angle trig-rational → single-exponential normalization
  // fallback (driver `singleAngleTrigExpFallback`). `∫P(x)·R(trig(w))` with an
  // additive `(a+b·trig)`-type denominator is rewritten via y = E^{i·w} into a
  // linear-factor partial fraction, each piece `∫P(x)·E^{k·i·w}/(a+b·E^{i·w})^s`
  // closing through the §2.2 → Chapter-3 → §8.8 PolyLog telescope. These are the
  // 4.1.10 #197 (csc/(a+a·sin)) and #294 (cos/(a+b·sin)) shapes. Rubi reaches
  // them via ExpandIntegrand's E^{ix} expansion of ACTIVE linear-arg Sin, which
  // CE deliberately inerts — hence the driver fallback. Every one of these goes
  // INERT under `RUBI_NO_TRIGEXP=1` (verified manually), so they exercise the
  // R17 rung, not a bundled rule. D-verified by finite-differencing F.N() (the
  // antiderivative carries PolyLog/complex-Log terms whose symbolic derivative
  // does not numericize). Concrete integer params avoid the reserved `e`/`i`.
  describe('closes the single-angle trig-rational family (Chapter-4, R17)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      let ok = 0;
      for (const x of [0.4, 0.9, 1.3, 1.7, 2.1]) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (typeof d !== 'number' || typeof f !== 'number') continue;
        expect(d).toBeCloseTo(f, 4);
        ok++;
      }
      expect(ok).toBeGreaterThanOrEqual(3);
    };
    // #197-shape: csc(w)/(a+a·sin(w)) — the antiderivative carries ArcTanh, Log,
    // and PolyLog[2..4] of ±E^{i·w} / i·E^{i·w}.
    test('∫(3+2x)³·csc(1+2x)/(1+sin(1+2x)) dx (#197-shape)', () =>
      verify('(3+2 x)^3 \\csc(1+2 x) / (1 + \\sin(1+2 x))'));
    // #294-shape: cos(w)/(a+b·sin(w)), general a,b — Log[1 − i·b·E^{i·w}/(a±√(a²−b²))]
    // + PolyLog[2..4]. The denominator roots carry a real surd √(a²−b²).
    test('∫(3+2x)³·cos(1+2x)/(3+2sin(1+2x)) dx (#294-shape, real surd)', () =>
      verify('(3+2 x)^3 \\cos(1+2 x) / (3 + 2\\sin(1+2 x))'));
    test('∫(3+2x)³·cos(1+2x)/(2+sin(1+2x)) dx (#294-shape, √3 surd)', () =>
      verify('(3+2 x)^3 \\cos(1+2 x) / (2 + \\sin(1+2 x))'));
  });

  // R18 (RUBI.md §5): two complex-special-function families the earlier rungs
  // declined once the 2026-07-09 complex kernels landed (commit 2980a5a8):
  //  (a) irreducible-quadratic denominators `∫R(x)·sin(c+d·x)/(a+b·x²)` — the
  //      Si/Ci fallback splits the quadratic over its complex-conjugate linear
  //      roots (driver `rationalTrigSiCiFallback` +
  //      `expandRationalOverComplexLinears`) and closes each piece to a COMPLEX
  //      SinIntegral/CosIntegral; the conjugate pair recombines to a real
  //      antiderivative (4.1.11 #61/#71/#72). Gated by RUBI_NO_SICI_COMPLEX.
  //  (b) reciprocal-argument `∫xᵐ·sin(a+b/x)` — the R9 exp route rewrites the
  //      now-admitted negative-exponent monomial argument to a complex
  //      ExpIntegralEi (4.1.12 #103–#110).
  // D-verified by finite-differencing F.N() over the real axis (the complex-Ei
  // / complex-Si terms numericize but do not admit a symbolic derivative).
  // Concrete integer params avoid the reserved `e`/`i`.
  describe('closes complex-Si / reciprocal-arg families (Chapter-4, R18)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    ce.timeLimit = 30_000; // complex Si/Ci/Ei kernels are slow under ts-jest
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      let ok = 0;
      for (const x of [0.6, 1.1, 1.7, 2.3, 2.9]) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (typeof d !== 'number' || typeof f !== 'number') continue;
        expect(d).toBeCloseTo(f, 3);
        ok++;
      }
      expect(ok).toBeGreaterThanOrEqual(3);
    };
    // (a) irreducible-quadratic denominator — complex-conjugate Si/Ci.
    test('∫sin(1+2x)/(2+3x²) dx (#61-shape, complex-Si)', () =>
      verify('\\frac{\\sin(1+2 x)}{2+3 x^2}'));
    test('∫x³·sin(1+2x)/(2+3x²)³ dx (#72-shape, quadratic cube)', () =>
      verify('\\frac{x^3 \\sin(1+2 x)}{(2+3 x^2)^3}'));
    // (b) reciprocal argument — complex ExpIntegralEi via the R9 exp route.
    test('∫x·sin(1+2/x) dx (#104-shape, reciprocal argument)', () =>
      verify('x \\sin(1+2/x)'));
    test('∫sin(1+2/x)/x dx (#106-shape, reciprocal Si/Ci)', () =>
      verify('\\frac{\\sin(1+2/x)}{x}'));
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

  // Chapter-5 inverse-trig family (RUBI.md §5, Phase R20). The arcsin/arctan/
  // arcsec families (5.1/5.3/5.5), including the (a+b·arcsin)^n by-parts /
  // IntHide chain and the arctan/x → PolyLog telescope. Verified by
  // finite-differencing F.N() (not symbolic D[F]): the arctan/x result carries
  // PolyLog[2,±i·x] whose symbolic derivative is inert but whose F.N() is
  // numerically evaluable.
  describe('integrates the inverse-trig family (Chapter-5, R20)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      let checked = 0;
      // sample both the |x|<1 (arcsin/√(1−x²)) and |x|>1 (arcsec) real
      // domains; skip points where either side goes complex/non-finite
      for (const x of [0.31, 0.52, 0.73, 1.42, 2.3]) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(d).toBeCloseTo(f, 5);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };
    // Base cases: ∫arcsin(x) = x·arcsin(x)+√(1−x²); ∫arctan(x) = x·arctan(x)
    // − ½·log(1+x²) (5.1.1 / 5.3.1).
    test('∫arcsin(x) dx', () => verify('\\arcsin(x)'));
    test('∫arctan(x) dx', () => verify('\\arctan(x)'));
    test('∫arcsec(x) dx', () => verify('\\operatorname{arcsec}(x)'));
    // xᵐ·arctan by-parts (5.3.2 #1).
    test('∫x·arctan(x) dx', () => verify('x\\arctan(x)'));
    // (a+b·arcsin)ⁿ via IntHide-driven by-parts (5.1.1 #2 / 5.1.5).
    test('∫arcsin(2x)² dx', () => verify('\\arcsin(2x)^2'));
    // ch3 family-C connection: ∫arctan(x)/x closes to the inverse-tangent
    // integral Ti₂(x) in PolyLog form (½i·(PolyLog[2,−ix] − PolyLog[2,ix])).
    test('∫arctan(x)/x dx → PolyLog(2, ±i·x)', () => {
      const F = ce.parse('\\int \\frac{\\arctan(x)}{x} \\, dx').evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('PolyLog');
      verify('\\frac{\\arctan(x)}{x}');
    });
  });

  // Chapter-7 inverse-hyperbolic family (RUBI.md §5, Phase R21). The
  // arsinh/arcosh/artanh/arsech families (7.1/7.2/7.3/7.5), including the
  // (a+b·arsinh)ⁿ by-parts / IntHide chain and the 7.2.6 arccosh reciprocal
  // that closes to the hyperbolic cosine/sine integral Chi/Shi (exercising the
  // new Shi/Chi kernels end-to-end). Verified by finite-differencing F.N().
  describe('integrates the inverse-hyperbolic family (Chapter-7, R21)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    ce.timeLimit = 30_000; // Chi/Shi results carry slow complex kernels
    const verify = (latex: string, xs = [0.31, 0.52, 0.73, 1.42, 2.3]) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      let checked = 0;
      for (const x of xs) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(d).toBeCloseTo(f, 4);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };
    // Base cases: ∫arsinh(x) = x·arsinh(x)−√(1+x²); ∫artanh(x) =
    // x·artanh(x)+½·ln(1−x²) (7.1.1 / 7.3.1). arsinh domain is all reals;
    // artanh needs |x|<1, so sample the unit interval there.
    test('∫arcsinh(x) dx', () => verify('\\operatorname{arcsinh}(x)'));
    test('∫arctanh(x) dx', () =>
      verify('\\operatorname{arctanh}(x)', [0.11, 0.33, 0.55, 0.72, 0.88]));
    test('∫arccosh(x) dx', () =>
      verify('\\operatorname{arccosh}(x)', [1.2, 1.6, 2.1, 2.7, 3.3]));
    // xᵐ·artanh by-parts (7.3.2 #1).
    test('∫x·arctanh(x) dx', () =>
      verify('x\\operatorname{arctanh}(x)', [0.11, 0.33, 0.55, 0.72, 0.88]));
    // (a+b·arsinh)ⁿ via IntHide-driven by-parts (7.1.1 #2 / 7.1.5).
    test('∫arcsinh(2x)² dx', () => verify('\\operatorname{arcsinh}(2x)^2'));
    // 7.2.6 reciprocal-arccosh closes to the hyperbolic cosine/sine integral
    // Chi/Shi — exercises the new Shi/Chi numeric kernels end-to-end.
    test('∫1/arccosh(1+2x²) dx → CoshIntegral/SinhIntegral', () => {
      const F = ce
        .parse('\\int \\frac{1}{\\operatorname{arccosh}(1+2x^2)} \\, dx')
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toMatch(/CoshIntegral|SinhIntegral/);
      verify('\\frac{1}{\\operatorname{arccosh}(1+2x^2)}', [
        0.4, 0.7, 1.1, 1.6, 2.2,
      ]);
    });
  });

  // R22: the (f·x)^m·(d+e·x²)^p·(a+b·arcsin(c·x))^n trig-subproblem bridge
  // (RUBI.md §5, Phase R22). The 5.1.2/5.1.3/5.1.4 arcsin reductions substitute
  //   Subst[∫(a+b·x)^n·Cot[x] dx, x, ArcSin[c·x]]  (and (d+e·x²)^p analogs),
  // handing a poly/rational·Cot[x] sub-integral to the Chapter-4 §4.3 Tangent
  // rules that close it to Log/PolyLog. Because the top-level arcsin integrand
  // carries no ACTIVE trig, the driver's inert-trig bridge was gated off for the
  // whole call, so the Cot sub-integral stranded as an inert Integrate. The fix
  // (driver.ts intRec) engages the bridge for any subproblem that introduces
  // active trig into a non-trig context. Verified by finite-differencing F.N()
  // (the PolyLog[2, ±E^(2i·arcsin)] results have inert symbolic D but evaluable
  // F.N()); sampled inside |x|<1 (arcsin/√(1−x²) real domain).
  describe('the arcsin (d+e·x²)^p trig-subproblem bridge (Chapter-5, R22)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string, xs = [0.17, 0.31, 0.52, 0.73]) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      let checked = 0;
      for (const x of xs) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(d).toBeCloseTo(f, 5);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };
    // integer p = −1 (5.1.4a #31): closes to Log/PolyLog[2, −E^(2i·arcsin)].
    test('∫x·arcsin(x)/(1−x²) dx → PolyLog', () => {
      const F = ce
        .parse('\\int \\frac{x\\arcsin(x)}{1-x^2} \\, dx')
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('PolyLog');
      verify('\\frac{x\\arcsin(x)}{1-x^2}');
    });
    // half-integer p = 1/2, n = 2 (5.1.4a #215).
    test('∫arcsin(x)²·√(1−x²)/x² dx', () =>
      verify('\\frac{\\arcsin(x)^2\\sqrt{1-x^2}}{x^2}'));
    // half-integer p = −5/2, n = 2 (5.1.4a #257).
    test('∫x²·arcsin(x)²/(1−x²)^(5/2) dx', () =>
      verify('\\frac{x^2\\arcsin(x)^2}{(1-x^2)^{5/2}}'));
    // arccos co-variant (5.2, authored inline in the 5.1 files).
    test('∫x·arccos(x)/(1−x²) dx → PolyLog', () => {
      const F = ce
        .parse('\\int \\frac{x\\arccos(x)}{1-x^2} \\, dx')
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('PolyLog');
      verify('\\frac{x\\arccos(x)}{1-x^2}');
    });
    // The arsinh analog already routed via the ungated hyperbolic fallback, but
    // confirm the reciprocal ∫arcsinh(x)/x closes to PolyLog too (7.1.2).
    test('∫arcsinh(x)/x dx → PolyLog', () => {
      const F = ce
        .parse('\\int \\frac{\\operatorname{arcsinh}(x)}{x} \\, dx')
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('PolyLog');
    });
  });

  // R23: the InvTrig^n multiple-angle reduction (RUBI.md §5, Phase R23). The
  // arcsin substitution rules (5.1.4#45, 5.1.2#7/#8, and the 4.1.10#17/#18
  // sine rules they reach) hand ∫θⁿ·Sin[u]^m·Cos[u]^k to ExpandTrigReduce.
  // Extending ExpandTrigReduce's CIRCULAR branch to a REAL product-to-sum
  // (Sin²→½−½Cos[2u], …) lets each ∫Cos[k·u]/θ close to CosIntegral (and
  // Sin→SinIntegral) via the R15 Si/Ci fallback. Verified by finite-
  // differencing F.N() (sampled inside |x|<1, the arcsin real domain).
  describe('the InvTrig^n multiple-angle → CosIntegral reduction (Chapter-5, R23)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);
    const verify = (latex: string, xs = [0.17, 0.31, 0.52, 0.73]) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false);
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      let checked = 0;
      for (const x of xs) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(d).toBeCloseTo(f, 5);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };
    // 5.1.4a #348: ∫x²/(√(1−x²)·arcsin(x)) → −½Ci(2·arcsin) + ½Log(arcsin).
    // The inner ∫Sin²/θ needs the circular product-to-sum to reach CosIntegral.
    test('∫x²/(√(1−x²)·arcsin(x)) dx → CosIntegral', () => {
      const F = ce
        .parse('\\int \\frac{x^2}{\\sqrt{1-x^2}\\arcsin(x)} \\, dx')
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('CosIntegral');
      verify('\\frac{x^2}{\\sqrt{1-x^2}\\arcsin(x)}');
    });
    // arccos co-variant (5.2 analog, Cos-power reduction).
    test('∫x²/(√(1−x²)·arccos(x)) dx → CosIntegral', () => {
      const F = ce
        .parse('\\int \\frac{x^2}{\\sqrt{1-x^2}\\arccos(x)} \\, dx')
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toContain('CosIntegral');
      verify('\\frac{x^2}{\\sqrt{1-x^2}\\arccos(x)}');
    });
  });

  // ── Integration variable other than `x` (R26A). ──
  // The bundled rules all carry `variable: "x"`; every RHS references the
  // integration variable as the string token `"x"`. The match env does not
  // bind the variable pattern (it is matched positionally), so `build()` used
  // to resolve that `"x"` to the LITERAL symbol `x` instead of the actual
  // integration variable — corrupting (or garbling) every integral taken with
  // respect to any variable not literally named `x`. The driver now binds
  // `env['x']` to the real integration variable before RHS construction.
  describe('integration variable other than x (R26A)', () => {
    const ce = new ComputeEngine();
    ce.timeLimit = 30_000; // Subst / exp-substitution classes are slow under ts-jest
    loadIntegrationRules(ce);

    // Integrate `latex` (parsed over variable `v`) and numerically D-verify
    // F'(v) == integrand at several sample points, substituting any extra
    // symbolic parameters from `params`.
    const dVerify = (
      latex: string,
      v: string,
      params: Record<string, number> = {},
      samples: number[] = [0.31, 0.73, 1.27]
    ) => {
      const integrand = ce.parse(latex);
      const F = ce.function('Integrate', [integrand, ce.symbol(v)]).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      // Regression guard: no result taken w.r.t. a non-`x` variable may leak
      // the literal symbol `x` (unless `x` is an explicit free parameter).
      if (v !== 'x' && !('x' in params)) expect(F.has('x')).toBe(false);
      let g = integrand;
      let Fp = F;
      for (const [k, val] of Object.entries(params)) {
        Fp = Fp.subs({ [k]: val });
        g = g.subs({ [k]: val });
      }
      const dF = ce.expr(['D', Fp, v]).evaluate();
      let sampled = 0;
      for (const s of samples) {
        const a = dF.subs({ [v]: s }).N().re;
        const b = g.subs({ [v]: s }).N().re;
        if (a === undefined || b === undefined) continue;
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        expect(a).toBeCloseTo(b, 6);
        sampled++;
      }
      expect(sampled).toBeGreaterThan(0);
    };

    // 1. power rule → t³/3
    test('∫t² dt = t³/3', () => {
      const F = ce
        .function('Integrate', [ce.parse('t^2'), ce.symbol('t')])
        .evaluate();
      expect(F.isSame(ce.parse('\\frac{t^3}{3}'))).toBe(true);
      dVerify('t^2', 't');
    });

    // 2. elementary trig → −cos(t)
    test('∫sin(t) dt = −cos(t)', () => {
      const F = ce
        .function('Integrate', [ce.parse('\\sin t'), ce.symbol('t')])
        .evaluate();
      expect(F.isSame(ce.parse('-\\cos t'))).toBe(true);
      dVerify('\\sin t', 't');
    });

    // 3. linear-binomial rule → (2t+3)⁶/12
    test('∫(3+2t)⁵ dt = (2t+3)⁶/12', () => dVerify('(3+2t)^5', 't'));

    // 4. by-parts (the mixed-corruption case) → t·sin(t)+cos(t)
    test('∫t·cos(t) dt = t·sin(t)+cos(t)', () => dVerify('t\\cos t', 't'));

    // 5. symbolic coefficients → ln(a+bt)/b
    test('∫1/(a+b·t) dt = ln(a+bt)/b', () =>
      dVerify('\\frac{1}{a+b t}', 't', { a: 2, b: 3 }));

    // 6. the Subst-rule path 1.2.1.1 (garbage pre-fix) → artanh form
    test('∫1/(a+b·t+c·t²) dt (Subst path)', () =>
      dVerify('\\frac{1}{a+b t+c t^2}', 't', { a: 2, b: 3, c: 5 }));

    // 7. literal `x` as a FREE PARAMETER while integrating w.r.t. `t`
    //    (impossible to get right pre-fix; guards against a rename-based fix).
    test('∫1/(x+t) dt = ln(x+t)', () => {
      const F = ce
        .function('Integrate', [ce.parse('\\frac{1}{x+t}'), ce.symbol('t')])
        .evaluate();
      expect(F.isSame(ce.parse('\\ln(x+t)'))).toBe(true);
      dVerify('\\frac{1}{x+t}', 't', { x: 1.5 });
    });

    // 8. trig deactivation bridge in a non-x variable
    test('∫cos⁴(y) dy', () => dVerify('\\cos^4 y', 'y'));

    // 9. exp-substitution fallback + native-rational rescue end-to-end
    test('∫1/(3+5·sinh(u)) du', () =>
      dVerify('\\frac{1}{3+5\\sinh u}', 'u'));
  });

  // ── R26B: symbolic-coefficient reciprocal-hyperbolic closure. ──
  // `∫1/(a+b·sinh x)` (and cosh/tanh/…) with SYMBOLIC a,b. The `t=eˣ`
  // substitution lands the integrand at a NESTED rational shape
  // (`1/(x·(a+b/2·(x−1/x)))`) that no bundled rule matches, so these stayed
  // inert while the NUMERIC-coefficient forms closed (rescued by the
  // numeric-only native fallback). The R26B rational-normal-form step flattens
  // `g/x` into a single `N/D` of expanded x-polynomials (denominator's residual
  // `x^m` monomial kept factored) so the 1.2.1.1 rational rules close it. All
  // D-verified at concrete (a,b) — the corpus grader mis-scores some
  // symbolic-parameter antiderivatives, so we differentiate F back here.
  describe('symbolic-coefficient reciprocal-hyperbolic closure (Chapter-6, R26B)', () => {
    const ce = new ComputeEngine();
    ce.timeLimit = 30_000; // the exp-substitution rational chain is slow under ts-jest
    loadIntegrationRules(ce);

    // Close ∫1/(a+b·F(v)) symbolically, then D-verify F'(v) == integrand at
    // concrete (a,b) over several sample points.
    const dVerifyHyp = (
      latex: string,
      v: string = 'x',
      params: [number, number][] = [
        [3, 5],
        [2, 7],
      ],
      samples: number[] = [0.4, 0.9, 1.3, 1.7]
    ) => {
      const integrand = ce.parse(latex);
      const F = ce.function('Integrate', [integrand, ce.symbol(v)]).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      if (v !== 'x') expect(F.has('x')).toBe(false); // no leaked literal `x`
      const dF = ce.function('D', [F, ce.symbol(v)]).evaluate();
      let sampled = 0;
      for (const [a, b] of params)
        for (const s of samples) {
          const sub = { a, b, [v]: s };
          const g = integrand.subs(sub).N().re;
          const d = dF.subs(sub).N().re;
          if (typeof g !== 'number' || typeof d !== 'number') continue;
          if (!Number.isFinite(g) || !Number.isFinite(d)) continue;
          expect(d).toBeCloseTo(g, 6);
          sampled++;
        }
      expect(sampled).toBeGreaterThan(2);
    };

    test('∫1/(a+b·sinh x) dx', () => dVerifyHyp('\\frac{1}{a+b\\sinh x}'));
    test('∫1/(a+b·cosh x) dx', () => dVerifyHyp('\\frac{1}{a+b\\cosh x}'));
    test('∫1/(a+b·tanh x) dx', () => dVerifyHyp('\\frac{1}{a+b\\tanh x}'));

    // Exercises R26A (non-`x` variable binding) + R26B (normal form) together.
    test('∫1/(a+b·sinh u) du', () => dVerifyHyp('\\frac{1}{a+b\\sinh u}', 'u'));

    // Numeric regression: the native-fallback path still closes.
    test('∫1/(3+5·sinh x) dx still closes', () => {
      const F = ce
        .function('Integrate', [
          ce.parse('\\frac{1}{3+5\\sinh x}'),
          ce.symbol('x'),
        ])
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
    });

    // Toggle meaningfulness: the symbolic sinh closure is R26B's. `NO_R26` is
    // captured at module load, so this branches on the env var present at
    // process start — the default suite proves the closure, a `RUBI_NO_R26=1`
    // run proves it goes inert without the rung.
    test('∫1/(a+b·sinh x) is gated by RUBI_NO_R26', () => {
      const F = ce
        .function('Integrate', [
          ce.parse('\\frac{1}{a+b\\sinh x}'),
          ce.symbol('x'),
        ])
        .evaluate();
      if (process.env.RUBI_NO_R26 === undefined)
        expect(F.has('Integrate')).toBe(false);
      else expect(F.has('Integrate')).toBe(true);
    });
  });
});
