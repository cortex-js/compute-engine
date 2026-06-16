// Minimal Rubi `Int` driver (Phase R1, docs/rubi/RUBI.md §4B): a
// fixed-point rewriter over the compiled rule set, completely separate
// from CE's simplify() pipeline (Rubi rules recurse by construction —
// see the CLAUDE.md recursion constraints).
//
// Dispatch is priority-ordered (= Rubi's rule order). A small structural
// prelude handles the linearity scaffolding Rubi keeps in its
// miscellaneous chapters: constants, constant multiples, and term-wise
// sums. Recursion is bounded by depth and by the engine deadline; failed
// subproblems stay as inert `Integrate` expressions.

import type { IComputeEngine as ComputeEngine } from '../global-types';
import type { Expr as Expression } from './types';

import { matchAll } from './match';
import type { CompiledRule } from './compile';
import {
  build,
  evalCondition,
  findFailingConjunct,
  installCaches,
  polyCoeffsX,
  rationalFnQ,
  zeroQ,
  hasActiveTrig,
  deactivateTrig,
  unifyInertTrig,
  activateTrig,
  RuleFail,
  Ctx,
  Hooks,
} from './rubi-utils';
import { isNumber } from '../boxed-expression/type-guards';
import { toTimesPower, recanonicalize } from './normal-form';

const MAX_DEPTH = 40;

// RUBI_DEBUG_FLOAT: report the first rule whose result contains an inexact
// machine-float literal while its integrand was float-free (i.e. the rule
// that INTRODUCES the float, not one that propagates it).
const DEBUG_FLOAT = process.env.RUBI_DEBUG_FLOAT !== undefined;
// RUBI_DEBUG_FIRE=<id-substring>: print integrand/bindings/result of every
// firing of rules whose id contains the substring.
const DEBUG_FIRE = process.env.RUBI_DEBUG_FIRE;
// RUBI_NO_NATIVE_RATIONAL: disable the engine-native rational-function
// fallback (see int()) — for measuring the Rubi rules in isolation.
const NO_NATIVE_RATIONAL = process.env.RUBI_NO_NATIVE_RATIONAL !== undefined;
function hasInexactFloat(e: Expression): boolean {
  if (e.isNumberLiteral) return (e as any).isExact === false;
  return e.ops?.some(hasInexactFloat) ?? false;
}

function containsIntegrate(e: Expression): boolean {
  if (e.operator === 'Integrate') return true;
  return e.ops?.some(containsIntegrate) ?? false;
}

export type DriverStats = {
  calls: number;
  ruleFirings: Record<string, number>;
  preludeFirings: number;
  failures: number;
  /** match attempts that passed the matcher but failed later, with stage */
  trace: { id: string; stage: string; depth: number }[];
};

export class RubiDriver {
  private readonly memo = new Map<string, Expression | null>();
  private deadline = Infinity;
  // Re-entry guard for the native rational fallback: it integrates via
  // `ce.Integrate.evaluate()`, which (when the integration provider is the
  // loader's driver) calls back into this driver — without this flag a rational
  // the rules can't close would re-enter the fallback until the deadline.
  private inNativeFallback = false;
  // Set once per top-level int() call: true iff the integrand contains an
  // active trig head. When false, the trig bridge in intRec is never entered,
  // so trig-free (algebraic) integrands behave exactly as before — the
  // zero-regression gate. Sound because no algebraic rule emits trig, so a
  // trig-free integrand stays trig-free through the whole recursion.
  private trigActive = false;
  readonly stats: DriverStats = {
    calls: 0,
    ruleFirings: {},
    preludeFirings: 0,
    failures: 0,
    trace: [],
  };

  constructor(
    private readonly ce: ComputeEngine,
    private readonly rules: CompiledRule[],
    private readonly options: { timeLimitMs?: number; trace?: boolean } = {}
  ) {}

  /** Integrate `integrand` with respect to `variable`. Returns null when
   * no rule chain applies (caller decides on inert/fallback).
   * NOTE: the integrand must be canonical but NOT evaluated — evaluate()
   * expands products like (a+bx)(c+dx), destroying the structure the
   * rules match on. */
  int(integrand: Expression, variable: string): Expression | null {
    this.deadline = Date.now() + (this.options.timeLimitMs ?? 30_000);
    // fresh predicate caches per top-level call (zeroQ/simplify results
    // recur heavily across the rule scan)
    installCaches({ zeroQ: new Map(), simplify: new Map() });
    // Chapter-4 rules match against inert trig (`cos`/`sin`); detect active
    // trig once so intRec can deactivate the integrand (and its recursive
    // subproblems). Results are re-activated on the way out.
    this.trigActive = hasActiveTrig(integrand);
    const activate = (e: Expression | null): Expression | null =>
      e !== null && this.trigActive ? activateTrig(this.ce, e) : e;
    try {
      const result = this.intRec(integrand, variable, 0);
      if (result !== null) return activate(result);
      // No Rubi rule chain closed it. For a rational function of x, fall
      // back to the engine's native antiderivative: it does complete
      // partial-fraction integration (factor Q over ℚ, then linear and
      // irreducible-quadratic decomposition) that the ported Rubi rational
      // rules don't yet cover. Bounded by the same wall-clock budget. This
      // rules+native coexistence is exactly how `loadIntegrationRules` is
      // meant to ship.
      return this.nativeRationalFallback(integrand, variable);
    } catch (e) {
      // An engine deadline firing inside evaluate()/simplify(), or the
      // matcher's own deadline (see match.ts), surfaces as a
      // CancellationError — deadline exhaustion, not a crash: report "no
      // rule chain applied" like any other timeout.
      if (e instanceof Error && e.constructor.name === 'CancellationError')
        return null;
      throw e;
    }
  }

  /** Engine-native antiderivative fallback for a rational integrand the Rubi
   * rule set didn't close (see int()). Returns null when the integrand is
   * not a rational function of `variable`, the wall-clock budget is spent,
   * or the native integrator can't close it either (result still inert). */
  private nativeRationalFallback(
    integrand: Expression,
    variable: string
  ): Expression | null {
    if (NO_NATIVE_RATIONAL) return null;
    if (this.inNativeFallback) return null; // re-entry guard (see field)
    if (!rationalFnQ(integrand, variable)) return null;
    // Numeric-coefficient integrands only. Symbolic-parameter rationals
    // (e.g. 1/((a+b·x)(c+d·x)(e+f·x))) need symbolic polynomial factoring
    // the native integrator can't do — it can't close them, and its
    // factoring path doesn't poll the deadline, so it overruns the budget
    // badly (observed 80 s+). Restricting to free-of-parameters integrands
    // keeps the wins and bounds the cost.
    if (integrand.unknowns.some((u) => u !== variable)) return null;
    const ce = this.ce;
    const remainingMs = this.deadline - Date.now();
    if (remainingMs <= 0) return null;
    const x = ce.symbol(variable);
    const savedLimit = ce.timeLimit;
    // bound the native evaluation — N()/evaluate() self-arm a
    // CancellationError from ce.timeLimit. A native success on a rational
    // is sub-second; the long runs are failures (high-degree numeric
    // denominators it can't factor), so cap well under the driver budget
    // to avoid burning the full window on a dead end.
    ce.timeLimit = Math.max(1, Math.min(remainingMs, 5000));
    this.inNativeFallback = true;
    try {
      const F = ce.function('Integrate', [integrand, x]).evaluate();
      if (containsIntegrate(F)) return null;
      // An antiderivative of a nonzero rational function always contains
      // the variable; a constant result is a native miscomputation (e.g.
      // the repeated-irreducible-quadratic partial-fraction bug that
      // returns 0). Reject it rather than emit a wrong answer.
      if (!F.has(variable)) return null;
      return F;
    } catch (e) {
      if (e instanceof Error && e.constructor.name === 'CancellationError')
        return null;
      throw e;
    } finally {
      ce.timeLimit = savedLimit;
      this.inNativeFallback = false;
    }
  }

  private intRec(
    integrand: Expression,
    variable: string,
    depth: number
  ): Expression | null {
    const ce = this.ce;
    this.stats.calls++;
    if (depth > MAX_DEPTH) return null;
    // the engine deadline is armed only inside evaluate(); the driver
    // keeps its own wall-clock budget per top-level int() call
    if (Date.now() > this.deadline || ce._timeRemaining <= 0) return null;

    // Chapter-4 rules match against inert trig; deactivate active heads
    // (Cos→cos) before normalizing. Reduction-rule RHSs re-introduce active
    // trig in their recursive Int subproblems, so this must run per-intRec,
    // not just at the top-level entry. Gated by trigActive so it is a strict
    // no-op for algebraic integrands.
    if (this.trigActive) integrand = deactivateTrig(ce, integrand);

    // Rubi rules match against the Times/Power normal form
    integrand = toTimesPower(ce, integrand);

    // After normalization (which folds `sin^0 → 1`, exposing a bare cosine),
    // apply Rubi's standalone-cosine cofunction shift (cos→sin[arg+π/2]) so a
    // bare ∫cos^n — for which Rubi has no Cosine-chapter rule — routes to the
    // sine rules. Re-normalize when it rewrites. (Order matters: running this
    // before the `sin^0→1` fold would see a spurious mixed `sin^0·cos^n` and
    // decline to convert.)
    if (this.trigActive) {
      const unified = unifyInertTrig(ce, integrand, variable);
      if (unified !== integrand) integrand = toTimesPower(ce, unified);
    }

    // Collect uncollected polynomial factors (Σ Coeff·x^k with x-free
    // coefficients). Rule RHSs emit these as huge distributed sums — CE's
    // canonical mul re-distributes (Σ)·x during RHS construction, undoing
    // ExpandToSum — and the structural matcher cannot bind (g_.+h_.*x_)
    // against them (neither could Mathematica's: Rubi relies on Simp's
    // coefficient collection, which safeSimplify's leaf cap skips).
    const collected = collectPolyFactors(ce, integrand, variable);
    if (collected !== null) integrand = toTimesPower(ce, collected);

    const key = variable + '§' + integrand.toString();
    if (this.memo.has(key)) return this.memo.get(key)!;
    this.memo.set(key, null); // cycle guard: a recursive identical subproblem fails

    let result = this.intUncached(integrand, variable, depth);
    // Recursive subproblems get the native rational fallback too (the
    // top-level call in int() only covers depth 0). The trig-substitution
    // rules (4.7.5 #15–#34) substitute a trig variable away and leave an
    // ALGEBRAIC sub-integral (e.g. ∫cos·g(sin) → ∫g(t) dt) that no Chapter-4
    // rule can close; this lets that sub-integral resolve. Bounded by the
    // driver deadline and the re-entry guard; can only turn null → solved.
    if (result === null && depth > 0)
      result = this.nativeRationalFallback(integrand, variable);
    this.memo.set(key, result);
    if (result === null) this.stats.failures++;
    return result;
  }

  private intUncached(
    integrand: Expression,
    variable: string,
    depth: number
  ): Expression | null {
    const ce = this.ce;
    const x = ce.symbol(variable);
    const recurse = (e: Expression): Expression | null =>
      this.intRec(e, variable, depth + 1);
    // inert unsolved subproblem — _fn to avoid the canonical Integrate
    // handler wrapping the integrand in a multi-variable Function literal
    const inert = (e: Expression): Expression => ce._fn('Integrate', [e, x]);

    // ---- structural prelude -------------------------------------------
    // The integrand here is in (synthetic) Times/Power normal form;
    // anything flowing into results must be re-canonicalized first.
    // ∫ c dx = c·x
    if (!integrand.has(variable)) {
      this.stats.preludeFirings++;
      return recanonicalize(ce, integrand).mul(x);
    }
    // ∫ x dx = x²/2
    if (integrand.isSame(x)) {
      this.stats.preludeFirings++;
      return x.pow(2).div(2);
    }
    // ∫ (u + v) dx term-wise; unsolved terms stay inert
    if (integrand.operator === 'Add' && integrand.ops) {
      this.stats.preludeFirings++;
      return ce.function(
        'Add',
        integrand.ops.map((t) => {
          const tc = recanonicalize(ce, t);
          return recurse(tc) ?? inert(tc);
        })
      );
    }
    // ∫ c·u dx = c·∫u dx
    if (integrand.operator === 'Multiply' && integrand.ops) {
      const free = integrand.ops.filter((o) => !o.has(variable));
      if (free.length > 0) {
        const rest = integrand.ops.filter((o) => o.has(variable));
        const c = recanonicalize(
          ce,
          free.length === 1 ? free[0] : ce._fn('Multiply', free)
        );
        const u = recanonicalize(
          ce,
          rest.length === 1 ? rest[0] : ce._fn('Multiply', rest)
        );
        this.stats.preludeFirings++;
        const F = this.intRec(u, variable, depth + 1);
        return F === null ? null : c.mul(F);
      }
    }

    // ---- rule dispatch (priority order) -------------------------------
    const hooks: Hooks = { int: recurse };
    const trace = (id: string, stage: string): void => {
      if (this.options.trace) this.stats.trace.push({ id, stage, depth });
    };
    const dispatch = (envCap: number): Expression | null => {
      for (const rule of this.rules) {
        if (Date.now() > this.deadline) return null;
        // dispatch pre-screen on the root operator
        if (rule.rootOp !== null && rule.rootOp !== integrand.operator)
          continue;
        // conditions participate in matching: enumerate alternative
        // assignments (factor-role swaps etc.) and try conditions per env.
        // Pass the driver deadline so a single rule's combinatorial match
        // (multi-factor products) can't overrun timeLimitMs — matchAll
        // throws CancellationError, which int() catches → bounded unsolved.
        const envs = matchAll(rule.pat, integrand, x, envCap, this.deadline);
        for (const env of envs) {
          // bindings may hold synthetic normal-form subtrees —
          // re-canonicalize before conditions and RHS construction
          for (const [k, v] of env) env.set(k, recanonicalize(ce, v));
          const ctx: Ctx = { ce, env, x: variable, hooks };
          try {
            if (rule.condition && !evalCondition(rule.condition, ctx)) {
              trace(
                rule.id,
                this.options.trace
                  ? `condition: ${findFailingConjunct(rule.condition, ctx)}`
                  : 'condition'
              );
              continue;
            }
            // With-bindings (evaluated after the outer condition, like Rubi)
            for (const b of rule.bindings) {
              if (b.value === null) throw new RuleFail('bare Module local');
              env.set(b.name, build(b.value, ctx).evaluate());
            }
            if (
              rule.innerCondition &&
              !evalCondition(rule.innerCondition, ctx)
            ) {
              trace(rule.id, 'inner-condition');
              continue;
            }
            const result = build(rule.rhs, ctx);
            // A result that is exactly an inert integral made no progress
            // (e.g. a normalization rule like Int[u^m] := Int[ExpandToSum…]
            // whose rewritten subproblem immediately failed): fail the rule
            // so lower-priority rules and the collected-coefficient
            // fallback below get their chance.
            if (result.operator === 'Integrate') {
              trace(rule.id, 'rule-fail: no progress (inert result)');
              continue;
            }
            this.stats.ruleFirings[rule.id] =
              (this.stats.ruleFirings[rule.id] ?? 0) + 1;
            if (DEBUG_FIRE && rule.id.includes(DEBUG_FIRE)) {
              console.error(
                `[fire] ${rule.id}\n  integrand: ${integrand}\n` +
                  [...env.entries()]
                    .map(([k, v]) => `  ${k} = ${v}`)
                    .join('\n') +
                  `\n  result: ${result}`
              );
            }
            if (
              DEBUG_FLOAT &&
              hasInexactFloat(result) &&
              !hasInexactFloat(integrand)
            ) {
              const fb = [...env.entries()].find(([, v]) => hasInexactFloat(v));
              console.error(
                `[float] rule ${rule.id}\n  integrand: ${integrand}\n` +
                  (fb ? `  binding ${fb[0]}: ${fb[1]}\n` : '') +
                  `  result: ${result}`
              );
            }
            return result;
          } catch (e) {
            if (e instanceof RuleFail) {
              trace(rule.id, `rule-fail: ${e.message}`);
              continue; // try next assignment / rule
            }
            throw e;
          }
        }
      }
      return null;
    };
    // First pass with the default assignment cap; if nothing fires at all,
    // retry with a wider cap — multi-factor integrands (e.g. P(x)·(a+bx)^m
    // ·(c+dx)^n with m in the coefficients) can need more than 8 candidate
    // assignments before conditions accept one. The widened pass runs only
    // on otherwise-unsolved problems, so solved paths are unaffected.
    {
      const result = dispatch(8) ?? dispatch(32);
      if (result !== null) return result;
    }

    // ---- collected-coefficient fallback -------------------------------
    // ∫ (α+βx)^n dx with literal rational n and a base that is linear in
    // x only after collecting coefficients (rule RHSs emit Divide-wrapped
    // linear forms, e.g. (b·d·a²·x + d·a³)/b − a·b·c·x − c·a², that the
    // structural matcher cannot see as a_+b_.x_). Same semantics as rules
    // 1.1.1.1 #14–#18; runs only when no structural rule matched.
    if (integrand.operator === 'Power' && integrand.ops) {
      const [base, expo] = integrand.ops;
      if (
        isNumber(expo) &&
        expo.isRational === true &&
        base.operator === 'Add'
      ) {
        const coeffs = polyCoeffsX(recanonicalize(ce, base), variable);
        if (coeffs !== null && coeffs.length === 2 && !zeroQ(coeffs[1])) {
          const [alpha, beta] = coeffs;
          const u = alpha.add(beta.mul(x));
          this.stats.preludeFirings++;
          if (expo.isSame(-1)) return u.ln().div(beta);
          const n1 = expo.add(1);
          return u.pow(n1).div(beta.mul(n1));
        }
      }
    }

    // ---- bare trig-power reduction (self-contained fallback) -----------
    // `unifyInertTrig` rewrites a standalone cosine to a sine cofunction so it
    // routes to the corpus sine rules (4.1.1.1) — the faithful Rubi mechanism.
    // But the SHIPPED bundle carries only Chapter 1 + 4.1.6, not the 4.1 sine
    // rules, so in that context the rewritten ∫sin[arg+π/2]^n has no rule to
    // close it. This last-resort reducer (the standard ∫t^n recurrence) keeps
    // bare ∫(g·sin|cos)^n integrable without those rules. In the full-corpus
    // benchmark the sine rules fire first, so this is reached only in the
    // reduced bundle; it never overrides a corpus rule.
    {
      const red = this.trigPowerReduction(integrand, variable, depth);
      if (red !== null) return red;
    }

    return null;
  }

  /** ∫(g·sin|cos[e+f·x])^n dx by the power-reduction recurrence (cofunction of
   * sine rule 4.1.1.1#3); null when the integrand is not a bare integer power
   * of an inert sin/cos of a linear argument. See the call site. */
  private trigPowerReduction(
    integrand: Expression,
    variable: string,
    depth: number
  ): Expression | null {
    const ce = this.ce;
    let base = integrand; // integrand is (base)^n, or a bare trig (n = 1)
    let n = 1;
    if (integrand.operator === 'Power' && integrand.ops) {
      base = integrand.ops[0];
      const e = integrand.ops[1].re;
      if (typeof e !== 'number' || !Number.isInteger(e) || e < 1) return null;
      n = e;
    }
    let g: Expression = ce.One; // base = (x-free g)·(inert sin|cos of linear arg)
    let trig = base;
    if (base.operator === 'Multiply' && base.ops) {
      const free = base.ops.filter((o) => !o.has(variable));
      const nonfree = base.ops.filter((o) => o.has(variable));
      if (nonfree.length !== 1) return null;
      trig = nonfree[0];
      g = free.length === 0 ? ce.One : ce._fn('Multiply', free);
    }
    if ((trig.operator !== 'sin' && trig.operator !== 'cos') || !trig.ops)
      return null;
    const arg = trig.ops[0];
    const ac = polyCoeffsX(recanonicalize(ce, arg), variable);
    if (ac === null || ac.length !== 2 || zeroQ(ac[1])) return null; // linear
    const f = ac[1];
    const isCos = trig.operator === 'cos';
    const co = ce._fn(isCos ? 'sin' : 'cos', [arg]); // cofunction
    const gco = recanonicalize(ce, g.mul(co));
    const gt = recanonicalize(ce, base);
    this.stats.preludeFirings++;
    if (n === 1) {
      const t = gco.div(f); // ∫(g·cos)=g·sin/f ; ∫(g·sin)=−g·cos/f
      return isCos ? t : t.neg();
    }
    const lead = gt.pow(n - 1).mul(gco).div(f.mul(n));
    const boundary = isCos ? lead : lead.neg();
    const rec = this.intRec(recanonicalize(ce, gt.pow(n - 2)), variable, depth + 1);
    if (rec === null) return null;
    const coef = g.pow(2).mul(ce.number(n - 1)).div(n); // g² from factoring g^n
    return boundary.add(rec.mul(coef));
  }
}

/** Rewrite uncollected polynomial Add factors of a (normal-form) integrand
 * as Σ Coeff·x^k with x-free coefficients; null when nothing changes. */
function collectPolyFactors(
  ce: ComputeEngine,
  integrand: Expression,
  variable: string
): Expression | null {
  const X = ce.symbol(variable);
  const collect = (u: Expression): Expression | null => {
    if (u.operator !== 'Add' || !u.ops || u.ops.length < 2) return null;
    const coeffs = polyCoeffsX(recanonicalize(ce, u), variable);
    if (coeffs === null) return null;
    const terms: Expression[] = [];
    coeffs.forEach((c, k) => {
      if (c.isSame(0)) return;
      terms.push(
        k === 0
          ? c
          : ce._fn('Multiply', [
              c,
              k === 1 ? X : ce._fn('Power', [X, ce.number(k)]),
            ])
      );
    });
    if (terms.length === 0) return ce.Zero;
    const out = terms.length === 1 ? terms[0] : ce._fn('Add', terms);
    // adopt only when structurally different (loop safety; the memo in
    // intRec is the backstop)
    return out.toString() === u.toString() ? null : out;
  };

  const factors =
    integrand.operator === 'Multiply' && integrand.ops
      ? [...integrand.ops]
      : [integrand];
  let changed = false;
  const out = factors.map((f) => {
    const direct = collect(f);
    if (direct !== null) {
      changed = true;
      return direct;
    }
    if (f.operator === 'Power' && f.ops) {
      const base = collect(f.ops[0]);
      if (base !== null) {
        changed = true;
        return ce._fn('Power', [base, f.ops[1]]);
      }
    }
    return f;
  });
  if (!changed) return null;
  return out.length === 1 ? out[0] : ce._fn('Multiply', out);
}
