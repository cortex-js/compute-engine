import { ComputeEngine } from '../../src/compute-engine';
import { loadIntegrationRules } from '../../src/integration-rules';
import { compileRuleDocs } from '../../src/compute-engine/rubi/compile';
import { RubiDriver } from '../../src/compute-engine/rubi/driver';
import { CancellationError } from '../../src/common/interruptible';

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

  // ── SYM P2-26 / P3-11: a re-entrant driver call (any `.evaluate()` seam —
  // the native-rational fallback, a With-binding, a `Subst` — re-enters
  // int() via ce.Integrate.evaluate()) must not clobber the outer call's
  // per-call state — deadline, trigActive — and the memo is bounded to a
  // single top-level call. Re-entrancy is detected by the in-flight
  // `activeCalls` counter, NOT the native-fallback flag: an unflagged
  // evaluate()-seam re-entry used to reset the deadline (granting a fresh
  // time budget) and wipe the outer call's in-flight memo cycle-guards. ──
  describe('re-entrant state isolation and memo bounding', () => {
    test('a native-fallback re-entrant int() call does not extend the deadline or leak trig/caches', () => {
      const ce = new ComputeEngine();
      const driver = new RubiDriver(ce, [], { timeLimitMs: 10_000 });
      const d = driver as any;
      // Simulate an in-flight OUTER call: fixed deadline, warm memo, trig on,
      // and mark that we are inside the native fallback re-entry.
      const OUTER_DEADLINE = Date.now() + 999_999;
      d.deadline = OUTER_DEADLINE;
      d.trigActive = true;
      d.memo.set('x§sentinel', ce.symbol('bar'));
      d.activeCalls = 1; // an outer int() is in flight
      d.inNativeFallback = true; // …inside its native fallback
      driver.int(ce.symbol('x'), 'x'); // trivial ∫x dx subproblem
      // deadline NOT reset/extended (interruptible-evaluation contract)
      expect(d.deadline).toBe(OUTER_DEADLINE);
      // trigActive restored to the outer value on the way out
      expect(d.trigActive).toBe(true);
      // memo NOT cleared on re-entry (outer cycle-guard entries survive)
      expect(d.memo.has('x§sentinel')).toBe(true);
      // the in-flight count is back to the outer call's
      expect(d.activeCalls).toBe(1);
    });

    test('an evaluate()-seam re-entry (no native-fallback flag) also inherits deadline and memo', () => {
      const ce = new ComputeEngine();
      const driver = new RubiDriver(ce, [], { timeLimitMs: 10_000 });
      const d = driver as any;
      const OUTER_DEADLINE = Date.now() + 999_999;
      d.deadline = OUTER_DEADLINE;
      d.trigActive = true;
      d.memo.set('x§sentinel', null); // an in-flight cycle guard
      d.activeCalls = 1; // an outer int() is in flight (e.g. a With-binding
      // `.evaluate()` on an inert Integrate re-entered the provider)
      driver.int(ce.symbol('x'), 'x');
      expect(d.deadline).toBe(OUTER_DEADLINE); // no fresh time budget
      expect(d.memo.has('x§sentinel')).toBe(true); // cycle guard survives
      expect(d.trigActive).toBe(true);
      expect(d.activeCalls).toBe(1);
    });

    test('a top-level int() call clears the memo (bounds unbounded growth)', () => {
      const ce = new ComputeEngine();
      const driver = new RubiDriver(ce, [], { timeLimitMs: 10_000 });
      const d = driver as any;
      d.memo.set('x§stale', ce.One); // residue from a prior top-level call
      expect(d.activeCalls).toBe(0); // genuine top-level entry
      driver.int(ce.symbol('x'), 'x');
      expect(d.memo.has('x§stale')).toBe(false);
      expect(d.activeCalls).toBe(0); // balanced on the way out
    });
  });

  // ── Finding 3: the native-rational fallback's catch must swallow ONLY a
  // cancellation that belongs to Rubi's own bounded work window (its own
  // `rubi:native-fallback` sub-budget, or an unattributed numeric deadline). A
  // CancellationError attributed to an ENCLOSING caller span (e.g. a user
  // `withTimeLimit({label:'caller'})`) must propagate — Rubi must not eat the
  // caller's deadline and continue past it. Simulated deterministically by
  // stubbing the fallback's `Integrate.evaluate()` seam to throw an error with a
  // chosen `attribution`, so no real timer race is needed. ──
  describe('native-fallback swallows only Rubi-owned cancellations (Finding 3)', () => {
    // Run the private native-rational fallback with the inner Integrate.evaluate()
    // stubbed to throw a CancellationError carrying `attribution`. Returns the
    // fallback's result on a swallow, or the propagated error on a rethrow.
    const runFallback = (
      attribution: string | undefined
    ): { result: unknown } | { thrown: unknown } => {
      const ce = new ComputeEngine();
      const driver = new RubiDriver(ce, [], { timeLimitMs: 10_000 });
      const d = driver as any;
      d.deadline = Date.now() + 10_000; // a live Rubi work window
      const integrand = ce.parse('\\frac{1}{1+x^2}').canonical; // numeric rational
      const err = new CancellationError({ cause: 'timeout', attribution });
      const original = ce.function.bind(ce);
      const spy = jest
        .spyOn(ce, 'function')
        .mockImplementation((op: any, ...rest: any[]) => {
          if (op === 'Integrate')
            return { evaluate: () => { throw err; } } as any;
          return original(op, ...rest);
        });
      try {
        return { result: d.nativeRationalFallback(integrand, 'x') };
      } catch (e) {
        return { thrown: e };
      } finally {
        spy.mockRestore();
      }
    };

    test('RETHROWS a caller-owned cancellation (does not eat the caller deadline)', () => {
      const outcome = runFallback('caller');
      expect('thrown' in outcome).toBe(true);
      const thrown = (outcome as { thrown: unknown }).thrown;
      expect(thrown).toBeInstanceOf(CancellationError);
      expect((thrown as CancellationError).attribution).toBe('caller');
    });

    test("swallows Rubi's own sub-budget → null degrade", () => {
      expect(runFallback('rubi:native-fallback')).toEqual({ result: null });
    });

    test('swallows an unattributed deadline → null', () => {
      expect(runFallback(undefined)).toEqual({ result: null });
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
    // The two-quartic product case runs 5–8.5 s idle — right against the 10 s
    // default driver budget under worker contention, so raise both budgets
    // (same convention as the other heavy describes).
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });
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
    // The poly³×trig-rational by-parts chains take 1–2.5 s each and are slow
    // under ts-jest — same convention as the other heavy describes in this
    // file. (Verified 2026-07-10: not a regression — A/B timing against the
    // recent engine commits is identical; the default deadline was simply
    // marginal for this family under load.) NOTE: the driver keeps its OWN
    // wall-clock budget (loader default 10 s), independent of ce.timeLimit;
    // exhausting it declines cleanly to an inert Integrate — no
    // CancellationError. Under full-suite worker contention the ~2 s chain
    // can stretch past 10 s, so the heavy describes raise BOTH budgets.
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });
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
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });
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
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });
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
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });
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

  // R27: poly × same-angle trig PRODUCT reduction (RUBI.md §5, Phase R27;
  // driver `polyTrigProductReduce` + rubi-utils `polyTrigProductPieces`). The
  // inverse-sine reciprocal family `∫xᵐ/(√(1−c²x²)·(a+b·arcsin(cx))²)` and its
  // `(1−c²x²)^p` variant reduce (5.1.2 #11 / 5.1.4 #45 Subst, after the
  // reciprocal by-parts) to the inner `∫xⁿ·sinᵐ[u]·cosᵏ[u]` — a product of trig
  // POWERS that R23's pure-power ExpandTrigReduce rule and R15's single-sin/cos
  // gate both decline, so the inner strands and the whole problem is left
  // unsolved. R27 reduces the same-angle trig product to a real multiple-angle
  // sum (circularTrigReduce), distributes the `xⁿ` coefficient, and routes each
  // `∫xⁿ·sin/cos(j·u)` piece through R15 (Si/Ci) / by-parts. These flipped
  // 5.1.4a #336/#408/#410 (and 5.2 arccos analogs) from unsolved → solved. The
  // antiderivative carries SinIntegral/CosIntegral of a·+b·arcsin; D-verified by
  // finite-differencing F.N(). Concrete integer params (a=2,b=3,c=1) avoid the
  // reserved `e`/`i`; the |x|<1 arcsin domain sets the sample points.
  describe('poly × same-angle trig-product reduction (Chapter-5, R27)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });
    const verify = (latex: string) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      let checked = 0;
      for (const x of [0.17, 0.31, 0.52, 0.73]) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(d).toBeCloseTo(f, 4);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };
    // 5.1.4a #410: ∫x³/(√(1−x²)·(a+b·arcsin)²) — reciprocal-square by-parts to
    // ∫x²/(a+b·arcsin), whose Subst inner is ∫x⁻¹·sin²·cos (R27 reduces the
    // sin²·cos product). The antiderivative carries Sin/CosIntegral.
    test('∫x³/(√(1−x²)·(2+3·arcsin x)²) dx (#410) → Sin/CosIntegral', () => {
      const F = ce
        .parse('\\int \\frac{x^3}{\\sqrt{1-x^2}(2+3\\arcsin(x))^2} \\, dx')
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).toMatch(/SinIntegral|CosIntegral/);
      verify('\\frac{x^3}{\\sqrt{1-x^2}(2+3\\arcsin(x))^2}');
    });
    // 5.1.4a #408: ∫x⁵/(√(1−x²)·(a+b·arcsin)²) — inner ∫x⁻¹·sin⁴·cos.
    test('∫x⁵/(√(1−x²)·(2+3·arcsin x)²) dx (#408)', () =>
      verify('\\frac{x^5}{\\sqrt{1-x^2}(2+3\\arcsin(x))^2}'));
    // 5.1.4a #336: the (1−c²x²)^p variant ∫x³·(1−x²)^{5/2}/(a+b·arcsin) — inner
    // ∫x⁻¹·sin³·cos⁶ (5.1.4 #45, cos power 2p+1=6), a degree-9 trig product.
    test('∫x³·(1−x²)^{5/2}/(2+3·arcsin x) dx (#336)', () =>
      verify('\\frac{x^3(1-x^2)^{5/2}}{2+3\\arcsin(x)}'));
    // Toggle meaningfulness: `NO_R27` is captured at module load, so this
    // branches on the env var present at process start — the default suite
    // proves the closure, a `RUBI_NO_R27=1` run proves it goes inert without
    // the rung (R23's pure-power rule cannot close the sin²·cos product).
    test('∫x³/(√(1−x²)·(2+3·arcsin x)²) is gated by RUBI_NO_R27', () => {
      const F = ce
        .parse('\\int \\frac{x^3}{\\sqrt{1-x^2}(2+3\\arcsin(x))^2} \\, dx')
        .evaluate();
      if (process.env.RUBI_NO_R27 === undefined)
        expect(F.has('Integrate')).toBe(false);
      else expect(F.has('Integrate')).toBe(true);
    });
  });

  // R28a: mixed-parity poly-numerator × binomial-radical linearity split
  // (RUBI.md §5, Phase R28a; driver `mixedParityRadicalSplit` + rubi-utils
  // `mixedParityRadicalPieces`). `∫P(x)·x^m·(a+b·xⁿ)^p` with p a non-integer
  // half-integer and a MIXED-PARITY numerator is Rubi rule 2424 (bundled
  // 1.1.3.7 #37 / 1.1.3.8 #17), whose residue-class regrouping RHS uses
  // non-functional Sum/Coeff/Expon operators and never fires in CE. Linearity
  // over the numerator's monomials — each `xʲ·(a+b·xⁿ)^p` closes via the bundled
  // binomial rules — supplies it. The antiderivatives carry ArcTanh / Elliptic
  // forms, so these are D-verified by central-differencing F.N() (with symbolic
  // parameters fixed to numeric values keeping the radicand positive).
  describe('mixed-parity poly-numerator × binomial-radical split (1.1.3, R28a)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });

    // Integrate `latex` over x and central-difference F.N() == integrand at
    // several sample points, substituting `params` (fixed so a+b·xⁿ > 0).
    const verify = (
      latex: string,
      params: Record<string, number> = {},
      samples: number[] = [0.23, 0.47, 0.68, 0.91]
    ) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) =>
        F.subs({ ...params, x: v }).N().re as number;
      let checked = 0;
      for (const x of samples) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ ...params, x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        // Relative tolerance (matches the driver's own D-verify bar): the steep
        // `/xᵏ` integrands reach ~1e4 at small x, where central-difference
        // truncation error swamps an absolute `toBeCloseTo` yet the relative
        // error stays ~1e-8.
        expect(Math.abs(d - f)).toBeLessThan(1e-4 * (1 + Math.abs(f)));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };

    // fully-numeric mixed-parity numerator (odd x¹ + even x⁰) over √(1+x⁴):
    // neither piece is grouped by residue mod n/2=2, so the combined integrand
    // fires no bundled rule; the split closes ∫1/√(1+x⁴)=EllipticF and
    // ∫x/√(1+x⁴)=½arcsinh(x²).
    test('∫(1+x)/√(1+x⁴) dx', () => verify('\\frac{1+x}{\\sqrt{1+x^4}}'));

    // #213-shape: (c+d·x)/√(−a−b·x⁴) — NEGATIVE radicand (a,b>0), so the answer
    // is complex; the central-difference check runs on Re. Fixed so −a−b·x⁴<0.
    test('∫(c+d·x)/√(−a−b·x⁴) dx (#213)', () =>
      verify('\\frac{c+d x}{\\sqrt{-a-b x^4}}', {
        a: 0.7,
        b: 1.3,
        c: 0.5,
        d: 0.9,
      }));

    // #544-shape: x²·(c+d·x+e·x²+f·x³)/(a+b·x⁴)^{3/2}, symbolic coefficients.
    test('∫x²·(c+d·x+e·x²+f·x³)/(a+b·x⁴)^{3/2} dx (#544)', () =>
      verify('\\frac{x^2(c+d x+e x^2+f x^3)}{(a+b x^4)^{3/2}}', {
        a: 0.7,
        b: 1.3,
        c: 0.5,
        d: 0.9,
        e: 1.1,
        f: 0.6,
      }));

    // #468-shape: ODD n=3 binomial radical with a /x⁷ Laurent numerator — the
    // bundled reduction lowers (a+b·x³)^{3/2} and strands a Laurent-numerator
    // subproblem the recursive split then closes (ArcTanh + Elliptic pieces).
    test('∫(c+…+g·x⁴)(a+b·x³)^{3/2}/x⁷ dx (#468)', () =>
      verify('\\frac{(c+d x+e x^2+f x^3+g x^4)(a+b x^3)^{3/2}}{x^7}', {
        a: 0.7,
        b: 1.3,
        c: 0.5,
        d: 0.9,
        e: 1.1,
        f: 0.6,
        g: 0.4,
      }));

    // Toggle meaningfulness: `NO_R28` is captured at module load, so this
    // branches on the env var present at process start — the default suite
    // proves the closure, a `RUBI_NO_R28=1` run proves it goes inert without
    // the rung.
    test('∫(1+x)/√(1+x⁴) is gated by RUBI_NO_R28', () => {
      const F = ce.parse('\\int \\frac{1+x}{\\sqrt{1+x^4}} \\, dx').evaluate();
      if (process.env.RUBI_NO_R28 === undefined)
        expect(F.has('Integrate')).toBe(false);
      else expect(F.has('Integrate')).toBe(true);
    });
  });

  // R29: algebraic-in-hyperbolic substitution plumbing (RUBI.md §5, Phase R29;
  // driver `algebraicHyperbolicSub` + rubi-utils `algebraicHyperbolicSubstitutions`).
  // An integrand algebraic (half-integer power) in one hyperbolic family with a
  // common linear argument v — `(a+b·Sinh²)^(p/2)`, `√(a+b·Tanh²)`, half-integer
  // hyperbolic powers — is not a rational function of e^v, so the exp-substitution
  // fallback strands it. Substituting u = Sinh/Cosh/Tanh[v] turns it into
  // `∫R(u,√(a+b·u²)) du`, closed by the bundled 1.1.2 quadratic-radical rules in
  // elementary artanh form. The antiderivatives carry ArcTanh of an argument > 1
  // (complex principal value — R28b), so they are D-verified on Re of a
  // central-differenced F.N() with symbolic parameters fixed positive.
  describe('algebraic-in-hyperbolic substitution (Chapter-6, R29)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });

    // Integrate `latex` over x and central-difference Re(F.N()) == integrand at
    // several sample points, substituting `params` (fixed so the radicands are
    // positive). Samples stay away from x = 0 (the hyperbolic argument's zero,
    // where the ArcTanh branch jumps).
    const verify = (
      latex: string,
      params: Record<string, number> = { a: 0.7, b: 1.3 },
      samples: number[] = [0.35, 0.62, 0.88, 1.15]
    ) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ ...params, x: v }).N().re as number;
      let checked = 0;
      for (const x of samples) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ ...params, x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(Math.abs(d - f)).toBeLessThan(1e-4 * (1 + Math.abs(f)));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };

    // #471-shape: Coth·(a+b·Sinh²)^{3/2} — u=Sinh gives ∫(a+b·u²)^{3/2}/u du.
    test('∫Coth(x)·(a+b·Sinh(x)²)^{3/2} dx (#471)', () =>
      verify('\\coth(x)(a+b\\sinh(x)^2)^{3/2}'));

    // #109-shape: Csch/(a+b·Sinh²)^{3/2} — net odd Sinh power, u=Cosh.
    test('∫Csch(x)/(a+b·Sinh(x)²)^{3/2} dx (#109)', () =>
      verify('\\frac{\\csch(x)}{(a+b\\sinh(x)^2)^{3/2}}'));

    // #35-shape: 1/(a·Sech²)^{1/2} — the Tanh-substitution path (Sech=√(1−u²)),
    // u=Tanh gives ∫a^{-1/2}(1−u²)^{-3/2} du → Tanh/√(a·Sech²).
    test('∫1/(a·Sech(x)²)^{1/2} dx (#35, Tanh path)', () =>
      verify('\\frac{1}{(a\\sech(x)^2)^{1/2}}', { a: 0.7 }));

    // #11-shape: √(a+b·Csch²) — a bare hyperbolic radical.
    test('∫√(a+b·Csch(x)²) dx (#11)', () =>
      verify('(a+b\\csch(x)^2)^{1/2}'));

    // Toggle meaningfulness: `NO_R29` is captured at module load, so this
    // branches on the env var present at process start — the default suite
    // proves the closure, a `RUBI_NO_R29=1` run proves it goes inert.
    test('∫Coth(x)·(a+b·Sinh(x)²)^{3/2} is gated by RUBI_NO_R29', () => {
      const F = ce.parse('\\int \\coth(x)(a+b\\sinh(x)^2)^{3/2} \\, dx').evaluate();
      if (process.env.RUBI_NO_R29 === undefined)
        expect(F.has('Integrate')).toBe(false);
      else expect(F.has('Integrate')).toBe(true);
    });
  });

  // R30: rational-in-hyperbolic cyclotomic-factored substitution (RUBI.md §5,
  // Phase R30; driver `hyperbolicRationalFactored` + rubi-utils
  // `hyperbolicRationalFactoredForm`). A RATIONAL (integer-power) hyperbolic of a
  // common linear argument v, with a hyperbolic power ≥ 2, substitutes (t = eᵛ)
  // to a rational function of t whose flattened denominator is a high-degree
  // polynomial the bundled 1.2.x rules cannot factor over the free parameters —
  // but which always factors as `x^m·(x²+1)^p·(x²−1)^q·S(x)`. Keeping the
  // cyclotomic factors factored lets the bundled partial-fraction rules close it.
  // The artanh/arctan antiderivatives carry the residual quadratic's √(β²−4αγ)
  // (complex principal value off one branch — R28b), so they are D-verified on
  // Re of a central-differenced F.N() with symbolic parameters fixed.
  describe('rational-in-hyperbolic cyclotomic-factored substitution (Chapter-6, R30)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });

    const verify = (
      latex: string,
      params: Record<string, number> = { a: 1.3, b: 0.7 },
      samples: number[] = [0.35, 0.62, 0.88, 1.15]
    ) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ ...params, x: v }).N().re as number;
      let checked = 0;
      for (const x of samples) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ ...params, x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(Math.abs(d - f)).toBeLessThan(1e-4 * (1 + Math.abs(f)));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };

    // #136-shape: tanh²/(a+b·tanh) — denominator x·(x²+1)²·((a+b)x²+(a−b)).
    test('∫Tanh(x)²/(a+b·Tanh(x)) dx (#136)', () =>
      verify('\\frac{\\tanh(x)^2}{a+b\\tanh(x)}'));

    // #231-shape: tanh/(a+b·sinh) — residual (x²+1)·(symbolic quadratic).
    test('∫Tanh(x)/(a+b·Sinh(x)) dx (#231)', () =>
      verify('\\frac{\\tanh(x)}{a+b\\sinh(x)}'));

    // #108-shape: tanh/(a+a·Sech) — residual carries (x+1)² and one parameter.
    test('∫Tanh(x)/(a+a·Sech(x)) dx (#108)', () =>
      verify('\\frac{\\tanh(x)}{a+a\\sech(x)}', { a: 1.1 }));

    // #156-shape: (a+b·Tanh²)³·Tanh⁴ — a polynomial in tanh; the substituted
    // denominator is PURE cyclotomic (x^m·(x²−1)^k, no parameter residual).
    test('∫(a+b·Tanh(x)²)³·Tanh(x)⁴ dx (#156)', () =>
      verify('(a+b\\tanh(x)^2)^3\\tanh(x)^4'));

    // Toggle meaningfulness: `NO_R30` is captured at module load, so this branches
    // on the env var present at process start — the default suite proves the
    // closure, a `RUBI_NO_R30=1` run proves it goes inert.
    test('∫Tanh(x)²/(a+b·Tanh(x)) is gated by RUBI_NO_R30', () => {
      const F = ce.parse('\\int \\frac{\\tanh(x)^2}{a+b\\tanh(x)} \\, dx').evaluate();
      if (process.env.RUBI_NO_R30 === undefined)
        expect(F.has('Integrate')).toBe(false);
      else expect(F.has('Integrate')).toBe(true);
    });
  });

  // R8: poly × single-angle-hyperbolic → single-exponential PolyLog fallback
  // (RUBI.md §5, Phase R8; driver `singleAngleHyperbolicExpFallback` + rubi-utils
  // `singleAngleHyperbolicExponentialPieces`). The real-exponential analog of R17:
  // `∫P(x)·R(hyp(w)) dx` with P a NONTRIVIAL polynomial in x, w = c+d·x linear, and
  // an additive `(a+b·hyp)`-type denominator is rewritten via y = E^{w} (no factor
  // of i) into a linear-factor partial fraction, each piece
  // `∫P(x)·E^{k·w}/(a+b·E^{w})^s` closing through the §2.2 → Chapter-3 → §8.8 PolyLog
  // telescope (Log + PolyLog[2]/PolyLog[3]). These are the 6.1.1 #230/#233 and the
  // 6.4.1 #47 (positive-power reciprocal `(a+b·Coth)ᵏ`) shapes. Placed LAST among
  // the hyperbolic fallbacks, so every case here goes INERT under `RUBI_NO_R8=1`
  // (exercises the R8 rung, not a bundled rule). D-verified by finite-differencing
  // F.N() (the antiderivative carries PolyLog/complex-Log terms whose symbolic
  // derivative does not numericize). NOTE: the sinh additive-denominator rows keep
  // their `√(a²+b²)` root cleanest with SYMBOLIC parameters, while the coth
  // reciprocal rows are fastest with concrete numeric coefficients — chosen per
  // case accordingly. Heavy PolyLog family: both budgets raised (see R30 above),
  // and each test carries an explicit generous jest timeout.
  describe('poly × single-angle-hyperbolic → single-exponential (Chapter-6, R8)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce, { timeLimitMs: 60_000 });

    // Integrate `latex` over x and central-difference F.N() == integrand at
    // several sample points, substituting `params` (fixed so the radicands are
    // positive and the additive denominator stays nonzero on the samples).
    const verify = (
      latex: string,
      params: Record<string, number> = {},
      samples: number[] = [0.35, 0.62, 0.88]
    ) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ ...params, x: v }).N().re as number;
      let checked = 0;
      for (const x of samples) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ ...params, x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(Math.abs(d - f)).toBeLessThan(1e-3 * (1 + Math.abs(f)));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };

    const P = { a: 1.3, b: 0.7, c: 0.2, d: 1.0, e: 0.5, f: 0.9 };

    // 6.1.1 #230: (e+f·x)·Sinh²/(a+b·Sinh) — additive denominator, linear poly.
    test('∫(e+f·x)·Sinh(c+d·x)²/(a+b·Sinh(c+d·x)) dx (#230)', () =>
      verify(
        '\\frac{(e+f x)\\sinh(c+d x)^2}{a+b\\sinh(c+d x)}',
        P
      ), 120_000);

    // 6.1.1 #233-shape: (e+f·x)³·Sinh³/(a+b·Sinh) — cubic poly → PolyLog[3]. The
    // heavy .N() is capped at two sample points.
    test('∫(e+f·x)³·Sinh(c+d·x)³/(a+b·Sinh(c+d·x)) dx (#233-shape)', () =>
      verify(
        '\\frac{(e+f x)^3\\sinh(c+d x)^3}{a+b\\sinh(c+d x)}',
        P,
        [0.35, 0.62]
      ), 120_000);

    // 6.4.1 #47-shape: (c+d·x)·(a+b·Coth)² — a POSITIVE-power reciprocal head,
    // whose intrinsic `y²−1` denominator (roots ±1) needs the PolyLog route even
    // without a syntactic `Add^{negative}`. Concrete numeric coefficients (the exact
    // #47 cube×cube closes+D-verifies too but is far too slow for CI).
    test('∫(3+2x)·(3+2·Coth(1+2x))² dx (#47-shape, positive-power reciprocal)', () =>
      verify(
        '(3+2 x)(3+2\\coth(1+2 x))^2',
        {},
        [0.4, 0.9, 1.3]
      ), 120_000);

    // Toggle meaningfulness: `NO_R8` is captured at module load, so this branches
    // on the env var present at process start — the default suite proves the
    // closure, a `RUBI_NO_R8=1` run proves it goes inert.
    test('∫(3+2x)·(3+2·Coth(1+2x))² is gated by RUBI_NO_R8', () => {
      const F = ce.parse('\\int (3+2 x)(3+2\\coth(1+2 x))^2 \\, dx').evaluate();
      if (process.env.RUBI_NO_R8 === undefined)
        expect(F.has('Integrate')).toBe(false);
      else expect(F.has('Integrate')).toBe(true);
    }, 120_000);
  });

  // R31: nested-radical substitution fallback (RUBI.md §5, Phase R31; driver
  // `nestedRadicalFallback` + rubi-utils `fractionalPowerOfLinearSubstitution` /
  // `conjugateRadicalRationalization` / `factoredRationalPresentation`). Lever A
  // iteratively substitutes `u = (a+b·x)^(1/k)` (or Laurent `(a+b/x)^(1/k)`) at
  // the innermost linear radical — the double-radical cases need two — keeping
  // the produced rational's denominator FACTORED; Lever B conjugate-rationalizes
  // the sum-of-two-radicals power. The Bondarenko nested-radical family (#2, #10,
  // #11, #12, #15, #17, #18). D-verified by finite-differencing F.N() (the
  // antiderivatives carry artanh/arctan of radicals that can exceed 1 → a complex
  // constant that a symbolic derivative would strand). Heavy: BOTH budgets raised
  // (engine `timeLimit` AND loader `timeLimitMs`); every case goes INERT under
  // `RUBI_NO_R31=1`.
  describe('nested-radical substitution fallback (Bondarenko, R31)', () => {
    const ce = new ComputeEngine();
    ce.timeLimit = 30_000;
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });

    // `NO_R31` is captured at module load. Under `RUBI_NO_R31=1` the rung is
    // disabled and none of these close, so skip the closure tests (the gate test
    // below proves each goes inert). In the DEFAULT config they run and must
    // close — keeping this describe A/B-clean in both configurations.
    const NO_R31 = process.env.RUBI_NO_R31 !== undefined;
    const closureTest = NO_R31 ? test.skip : test;

    // Integrate `latex` over x and central-difference F.N() == integrand at the
    // given sample points (chosen inside the family's real domain). Central
    // differences avoid needing a symbolic derivative and cancel the (possibly
    // complex) integration constant.
    const verify = (latex: string, samples: number[]) => {
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      let checked = 0;
      for (const x of samples) {
        const d = (fp(x + h) - fp(x - h)) / (2 * h);
        const f = integrand.subs({ x }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(Math.abs(d - f)).toBeLessThan(1e-4 * (1 + Math.abs(f)));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    };

    // #17: √(x+√(x+1))/x² — one Lever A substitution `u=√(x+1)` leaves a single
    // quadratic radical `2u·√(u²+u−1)/(u²−1)²` the bundled 1.1.2 rules close.
    closureTest('∫√(x+√(x+1))/x² dx (#17)', () =>
      verify('\\frac{\\sqrt{x+\\sqrt{x+1}}}{x^2}', [0.3, 0.5, 0.7]), 30_000);

    // #18: √(1/x+√(1/x+1)) — the Laurent substitution `u=√(1/x+1)`.
    closureTest('∫√(1/x+√(1/x+1)) dx (#18)', () =>
      verify('\\sqrt{\\frac{1}{x}+\\sqrt{\\frac{1}{x}+1}}', [0.3, 0.5, 0.7]), 30_000);

    // #2: (√(x+1)+√(1−x))⁻² — Lever B conjugate rationalization to
    // (1−√(1−x²))/(2x²). Domain |x|<1.
    closureTest('∫(√(x+1)+√(1−x))⁻² dx (#2, conjugate)', () =>
      verify('\\frac{1}{(\\sqrt{x+1}+\\sqrt{1-x})^2}', [0.3, 0.5, 0.7]), 30_000);

    // #10: √(x+1)/(x+√(√(x+1)+1)) — TWO successive Lever A substitutions, then
    // the produced rational closes via its FACTORED denominator.
    closureTest('∫√(x+1)/(x+√(√(x+1)+1)) dx (#10, double substitution)', () =>
      verify('\\frac{\\sqrt{x+1}}{x+\\sqrt{\\sqrt{x+1}+1}}', [0.3, 0.5, 0.7]), 30_000);

    // #11: 1/(x−√(√(x+1)+1)) — double Lever A substitution; the produced rational
    // closes via its FACTORED denominator. Verified at x≈4–6.
    closureTest('∫1/(x−√(√(x+1)+1)) dx (#11, double substitution)', () =>
      verify('\\frac{1}{x-\\sqrt{\\sqrt{x+1}+1}}', [4, 5, 6]), 30_000);

    // #12: x/(x+√(1−√(x+1))) — double Lever A substitution on the domain x<0
    // (needs 1−√(x+1) ≥ 0, i.e. x ≤ 0). Verified at x≈−0.9..−0.5.
    closureTest('∫x/(x+√(1−√(x+1))) dx (#12, double substitution)', () =>
      verify('\\frac{x}{x+\\sqrt{1-\\sqrt{x+1}}}', [-0.9, -0.7, -0.5]), 30_000);

    // #15: √(√x+√(2x+2√x+1)+1) — nested radical closed by iterated Lever A.
    // Verified at x≈0.5–2.
    closureTest('∫√(√x+√(2x+2√x+1)+1) dx (#15)', () =>
      verify('\\sqrt{\\sqrt{x}+\\sqrt{2x+2\\sqrt{x}+1}+1}', [0.5, 1, 2]), 30_000);

    // k=3 nested radical (cube-root outer): ∛(x+√(x+1)) — Lever A at the inner
    // `u=√(x+1)` (the driver normalizes the raw `Root` head via `toTimesPower`).
    // Exercises the odd-index (non-Laurent, k=3) branch end-to-end.
    closureTest('∫∛(x+√(x+1)) dx (k=3 nested radical)', () =>
      verify('\\sqrt[3]{x+\\sqrt{x+1}}', [0.5, 1, 2]), 30_000);

    // Out-of-scope decline: #14 (single quadratic radical over an irreducible
    // quartic) must stay cleanly inert (no wrong answer, no throw).
    test('∫√(x+√(x+1))/(x²+1) dx (#14) stays inert (out of scope)', () => {
      const F = ce
        .parse('\\int \\frac{\\sqrt{x+\\sqrt{x+1}}}{x^2+1} \\, dx')
        .evaluate();
      expect(F.has('Integrate')).toBe(true);
    }, 30_000);

    // Toggle meaningfulness: `NO_R31` is captured at module load, so this branches
    // on the env var present at process start — the default suite proves the
    // closure, a `RUBI_NO_R31=1` run proves each goes inert.
    test('∫√(x+√(x+1))/x² is gated by RUBI_NO_R31', () => {
      const F = ce.parse('\\int \\frac{\\sqrt{x+\\sqrt{x+1}}}{x^2} \\, dx').evaluate();
      if (process.env.RUBI_NO_R31 === undefined)
        expect(F.has('Integrate')).toBe(false);
      else expect(F.has('Integrate')).toBe(true);
    }, 30_000);
  });

  // ── R32 — Euler-substitution lever ("Lever C") for √(quadratic)-nested
  // radicals. R31's linear-radical machinery does not recognize a fractional
  // power whose inner radical is a √ of a genuine QUADRATIC (`√(x+√(x²+1))`,
  // Bondarenko #9). Lever C adds an Euler I substitution `t = √a·x + √Q`
  // (`Q = a·x²+b·x+c`, a>0) that rationalizes `√Q` and collapses the outer
  // radical to a √-of-linear the existing Lever A then removes. Gated by
  // `RUBI_NO_R32` for a clean A/B toggle.
  describe('Euler-substitution lever (Bondarenko #9, R32)', () => {
    const ce = new ComputeEngine();
    ce.timeLimit = 30_000;
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });

    const NO_R32 = process.env.RUBI_NO_R32 !== undefined;
    const closureTest = NO_R32 ? test.skip : test;

    // #9: 1/(√(x+√(x²+1))+1). The Euler I substitution `t=x+√(x²+1)` collapses
    // the outer radical to √t = √x (Lever A then substitutes s=√x), closing to
    // s+ln(s)+1/s−1/(2s²)−2ln(s+1), s=√(x+√(x²+1)). Valid for all real x
    // (x+√(x²+1)>0 always). Central-difference D-verify.
    closureTest('∫1/(√(x+√(x²+1))+1) dx (#9)', () => {
      const latex = '\\frac{1}{\\sqrt{x+\\sqrt{x^2+1}}+1}';
      const integrand = ce.parse(latex);
      const F = ce.parse(`\\int ${latex} \\, dx`).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      const h = 1e-5;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      let checked = 0;
      for (const x0 of [0.3, 2.5]) {
        const d = (fp(x0 + h) - fp(x0 - h)) / (2 * h);
        const f = integrand.subs({ x: x0 }).N().re as number;
        if (!Number.isFinite(d) || !Number.isFinite(f)) continue;
        expect(Math.abs(d - f)).toBeLessThan(1e-4 * (1 + Math.abs(f)));
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    }, 30_000);

    // Toggle meaningfulness: `NO_R32` is captured at module load. The default
    // suite proves the closure; a `RUBI_NO_R32=1` run proves #9 goes inert.
    test('∫1/(√(x+√(x²+1))+1) is gated by RUBI_NO_R32', () => {
      const F = ce
        .parse('\\int \\frac{1}{\\sqrt{x+\\sqrt{x^2+1}}+1} \\, dx')
        .evaluate();
      if (process.env.RUBI_NO_R32 === undefined)
        expect(F.has('Integrate')).toBe(false);
      else expect(F.has('Integrate')).toBe(true);
    }, 30_000);
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
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });

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
    loadIntegrationRules(ce, { timeLimitMs: 30_000 });

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

  // Improper (±∞ bound) integrals whose Rubi antiderivative carries a
  // `poly(y)·e^{−c·y}` term: naive endpoint substitution collapses the `∞·0`
  // to NaN. The definite-integral evaluator now re-resolves the ∞ endpoint as
  // lim_{y→∞} F(y) (exp decay beats polynomial growth; Erf(∞)=1), yielding an
  // exact closed form instead of NaN.
  describe('improper-integral endpoint at ∞ (poly × exp decay)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);

    test('∫ₓ^∞ y^(3/2) e^(−y/2) dy → exact closed form (χ²-tail k=5)', () => {
      const F = ce.parse('\\int_x^\\infty y^{3/2} e^{-y/2} dy').evaluate();
      expect(F.isNaN).not.toBe(true);
      expect(F.has('Integrate')).toBe(false);
      // Independent reference (fine composite Simpson on [2, 200]).
      expect(F.subs({ x: ce.number(2) }).N().re).toBeCloseTo(
        6.385472870122,
        6
      );
    });

    test('∫ₓ^∞ y² e^(−y) dy → e^(−x)(x²+2x+2)', () => {
      const F = ce.parse('\\int_x^\\infty y^2 e^{-y} dy').evaluate();
      expect(F.has('Integrate')).toBe(false);
      // e^(−1)(1+2+2) = 5/e at x = 1.
      expect(F.subs({ x: ce.number(1) }).N().re).toBeCloseTo(5 / Math.E, 9);
    });

    // Free-parameter χ² tail: the antiderivative is an incomplete-gamma form
    // whose ∞ endpoint leaves Γ(k/2, ∞); the Γ(s, +∞) = 0 reduction closes it
    // to a form free of the inert Γ(·, ∞) term (numerically exact).
    test('∫ₓ^∞ y^(k/2−1) e^(−y/2) dy closes via Γ(s, +∞) = 0', () => {
      const F = ce
        .parse('\\int_x^\\infty y^{\\frac{k}{2}-1} e^{-\\frac{y}{2}} dy')
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
      expect(F.toString()).not.toContain('+oo'); // no leftover Γ(·, ∞)
      // χ²(k=5) upper tail at x=2, reference 6.385472870122 (Simpson).
      expect(F.subs({ k: ce.number(5), x: ce.number(2) }).N().re).toBeCloseTo(
        6.385472870122,
        6
      );
    });
  });

  // Regression: a rational integrand with fully symbolic coefficients used to
  // hang (~109 s under a 3 s `timeLimit`) in the polynomial-GCD Euclidean loop.
  // It now closes to an ArcTanh/Ln form. The test completing at all proves the
  // hang is gone; the assertion pins the closure.
  describe('symbolic-coefficient rational integrand (was a hang)', () => {
    const ce = new ComputeEngine();
    loadIntegrationRules(ce);

    test('∫₀ˣ (u−a)/(b₂u²+b₁u+b₀) du closes', () => {
      const F = ce
        .parse('\\int_0^x \\frac{u-a}{b_2 u^2 + b_1 u + b_0}\\,du')
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
    });
  });
});
