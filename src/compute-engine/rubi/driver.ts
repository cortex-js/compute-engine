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
  getActiveCaches,
  polyCoeffsX,
  rationalFnQ,
  zeroQ,
  hasActiveTrig,
  deactivateTrig,
  unifyInertTrig,
  activateTrig,
  containsHyperbolic,
  expandHyperbolicToExp,
  foldLnExponentialE,
  functionOfExponentialSubstitution,
  sinhCoshArgsPolynomialQ,
  RuleFail,
  Ctx,
  Hooks,
} from './rubi-utils';
import { isNumber } from '../boxed-expression/type-guards';
import { simplifyTrig } from '../symbolic/simplify-trig';
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
// RUBI_NO_SKELETON: disable the second-level integrand-skeleton dispatch
// screen (the root-operator candidate buckets + `requiredHeads` feature
// filter), falling back to a linear scan of every rule with only the
// root-operator prescreen. The two paths MUST produce identical results
// (the screen only drops rules that provably cannot match); this switch
// exists to A/B that equivalence and to measure the screen's speedup.
const NO_SKELETON = process.env.RUBI_NO_SKELETON !== undefined;
function hasInexactFloat(e: Expression): boolean {
  if (e.isNumberLiteral) return (e as any).isExact === false;
  return e.ops?.some(hasInexactFloat) ?? false;
}

function containsIntegrate(e: Expression): boolean {
  if (e.operator === 'Integrate') return true;
  return e.ops?.some(containsIntegrate) ?? false;
}

/** All operator heads appearing in the (function nodes of the) expression
 * tree — the integrand's "skeleton" feature set. Backs the second-level
 * dispatch screen: a rule whose compiled `requiredHeads` are not all present
 * here provably cannot match, so it is skipped without pattern-matching (see
 * `compile.ts` `requiredHeads` for the soundness argument). Cheap: one walk
 * per top-level integrand shape, reused across the whole rule scan. */
function collectHeads(e: Expression, out: Set<string>): void {
  if (!e.ops) return;
  out.add(e.operator);
  for (const op of e.ops) collectHeads(op, out);
}

/** Bottom-up application of the engine's trig simplifier — folds the
 * `sin(θ+π/2) → cos(θ)` cofunction shifts the cosine→sine normalization
 * introduces (and other sound trig identities) so results read cleanly. */
function cleanTrig(ce: ComputeEngine, e: Expression): Expression {
  if (!e.ops || e.ops.length === 0) return e;
  const newOps = e.ops.map((o) => cleanTrig(ce, o));
  const node = newOps.every((o, i) => o === e.ops![i])
    ? e
    : ce.function(e.operator, newOps);
  const step = simplifyTrig(node as any);
  return (step?.value as Expression) ?? node;
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
    private readonly options: {
      timeLimitMs?: number;
      trace?: boolean;
      /** @internal Force the legacy full-scan dispatch (root-operator
       * prescreen only), bypassing the skeleton screen. Overrides the
       * `RUBI_NO_SKELETON` env default. For the A/B equivalence harness. */
      noSkeleton?: boolean;
    } = {}
  ) {}

  // Per-root-operator candidate lists: the rules whose root-operator prescreen
  // admits an integrand with that operator (rootOp === op, plus the wildcard
  // rootOp === null rules that can match any root). Built lazily and cached —
  // the operator alphabet is tiny (Multiply/Power/a few heads), so this is
  // effectively "once per bundle". Each list is a stable subsequence of the
  // ordered `this.rules`, preserving the original priority order exactly.
  private readonly candidateCache = new Map<string, CompiledRule[]>();
  private candidatesFor(operator: string): CompiledRule[] {
    let list = this.candidateCache.get(operator);
    if (list === undefined) {
      list = this.rules.filter(
        (r) => r.rootOp === null || r.rootOp === operator
      );
      this.candidateCache.set(operator, list);
    }
    return list;
  }

  /** Integrate `integrand` with respect to `variable`. Returns null when
   * no rule chain applies (caller decides on inert/fallback).
   * NOTE: the integrand must be canonical but NOT evaluated — evaluate()
   * expands products like (a+bx)(c+dx), destroying the structure the
   * rules match on. */
  int(integrand: Expression, variable: string): Expression | null {
    // The native-rational fallback re-enters this method via
    // `ce.Integrate.evaluate()` (see nativeRationalFallback). A re-entrant
    // call must NOT clobber the outer call's per-call state: resetting the
    // deadline would grant the outer integration a fresh time budget
    // (violating the interruptible-evaluation contract), and resetting
    // `trigActive` (and the caches) would leak the subproblem's state back
    // into the outer recursion — a trig integrand whose subproblem hits the
    // fallback could otherwise emit inert lowercase trig heads. So: a
    // re-entrant call inherits the outer deadline and memo, and its clobber
    // of `trigActive`/caches is snapshotted and restored on the way out.
    const reentrant = this.inNativeFallback;
    const savedTrig = this.trigActive;
    const savedCaches = getActiveCaches();
    if (!reentrant) {
      this.deadline = Date.now() + (this.options.timeLimitMs ?? 30_000);
      // Bound the memo to a single top-level call: it is a per-call cache +
      // cycle guard, not a cross-call one (rules don't consult assumptions
      // today, but if they did, a stale pre-assumption result could be
      // served verbatim). Clearing here caps its growth and sidesteps that
      // staleness. Not cleared on re-entry — that would wipe the outer
      // call's in-flight cycle-guard entries.
      this.memo.clear();
    }
    // fresh predicate caches per call (zeroQ/simplify results recur heavily
    // across the rule scan); the outer call's caches are restored below when
    // this is a re-entrant call.
    installCaches({ zeroQ: new Map(), simplify: new Map() });
    // Chapter-4 rules match against inert trig (`cos`/`sin`); detect active
    // trig once so intRec can deactivate the integrand (and its recursive
    // subproblems). Results are re-activated on the way out.
    this.trigActive = hasActiveTrig(integrand);
    // Re-activate inert heads on the way out, then normalize the trig form:
    // the cosine→sine cofunction shift (unifyInertTrig) leaves `sin(θ+π/2)`
    // etc. in the result; `simplifyTrig` folds those back to `cos(θ)` so the
    // answer reads cleanly (Rubi relies on Mathematica's auto-simplification
    // for the same step). Sound identities only — never changes the value.
    const activate = (e: Expression | null): Expression | null =>
      e !== null && this.trigActive
        ? cleanTrig(this.ce, activateTrig(this.ce, e))
        : e;
    try {
      const result = this.intRec(integrand, variable, 0);
      // Fold the stray `ln(e)` (= `Log[ExponentialE]`, from Chapter-2 rules
      // that emit `Log[F]` with base F = e) and any `e^(0·…)` the rule RHSs
      // leave, so rule-driven results read cleanly even before a user
      // simplify(). foldLnExponentialE rebuilds each node with ce.function,
      // which also drops the non-canonical `·1` a folded `ln(e)` leaves
      // behind. Value-preserving, structural, cheap.
      if (result !== null)
        return foldLnExponentialE(this.ce, activate(result)!);
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
    } finally {
      // Restore the outer call's state clobbered by this re-entry (see the
      // header comment); a genuine top-level call leaves its state in place.
      if (reentrant) {
        this.trigActive = savedTrig;
        installCaches(savedCaches);
      }
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
    // Second-level dispatch screen: the candidate list for this integrand's
    // root operator (root-operator prescreen, cached once per operator over
    // the bundle) narrowed by the integrand-skeleton feature set. Both
    // filters are NECESSARY conditions on a match (see compile.ts
    // `requiredHeads`), so no rule that could fire is dropped; rule order
    // within the candidate list is the original priority order (stable
    // filtering — the buckets are built by a single ordered pass).
    const integrandHeads = new Set<string>();
    collectHeads(integrand, integrandHeads);
    const noSkeleton = this.options.noSkeleton ?? NO_SKELETON;
    const candidates = noSkeleton
      ? this.rules
      : this.candidatesFor(integrand.operator);
    const dispatch = (envCap: number): Expression | null => {
      for (const rule of candidates) {
        if (Date.now() > this.deadline) return null;
        if (noSkeleton) {
          // legacy path: root-operator prescreen only (A/B baseline)
          if (rule.rootOp !== null && rule.rootOp !== integrand.operator)
            continue;
        } else {
          // integrand-skeleton screen: skip when a head the pattern provably
          // requires is absent from the integrand (conservative — fail-open
          // on inclusion). The candidate bucket already enforced the
          // root-operator match.
          const req = rule.requiredHeads;
          let skip = false;
          for (let i = 0; i < req.length; i++)
            if (!integrandHeads.has(req[i])) {
              skip = true;
              break;
            }
          if (skip) continue;
        }
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

    // ---- hyperbolic → exponential fallback (self-contained) ------------
    // Chapter 6's bare `(a+b·Sinh[linear])^n` / `(c+d·x)^m·Sinh^n` reductions
    // are not standalone corpus rules (Rubi reduces them through shared
    // machinery; only the nonlinear-argument families call ExpandTrigReduce
    // directly). When no rule closes a hyperbolic integrand, rewrite it to
    // exponential form and re-integrate: every term is then `poly·E^(k·arg)`,
    // which the bundled Chapter-2 rules (incl. the incomplete-Γ / Erf kernels)
    // close. Reached only after all rules + the other fallbacks decline; the
    // expanded form has no hyperbolic heads, so it cannot re-enter here.
    if (
      containsHyperbolic(integrand) &&
      sinhCoshArgsPolynomialQ(integrand, variable)
    ) {
      const expanded = expandHyperbolicToExp(ce, integrand);
      if (!containsHyperbolic(expanded)) {
        const F = this.intRec(
          recanonicalize(ce, expanded),
          variable,
          depth + 1
        );
        if (F !== null && !F.has('Integrate'))
          return this.cleanExpansionResult(F);
      }
    }

    // ---- function-of-a-single-exponential fallback --------------------
    // A pure hyperbolic of a LINEAR argument is a rational function of
    // e^(linear) — including the reciprocals Tanh/Coth/Sech/Csch that the
    // expansion fallback above deliberately leaves alone. This mirrors Rubi's
    // master substitution rule 2.3#97 WITHOUT its explicit-exponential gate
    // (FunctionOfExponentialQ requires an exponential to literally occur; the
    // bare-hyperbolic reductions Rubi applies instead are not standalone corpus
    // rules): substitute t = F^v, integrate the resulting rational function of t
    // (the bundled rational rules / native fallback close it fast), then undo
    // the substitution. Reached only after all rules + the expansion fallback.
    if (containsHyperbolic(integrand)) {
      const F = this.functionOfExponentialFallback(integrand, variable, depth);
      if (F !== null) return F;
    }

    return null;
  }

  /** ∫u dx where u is purely a function of a single exponential F^v (v linear in
   * x) — Rubi rule 2.3#97's substitution, applied (ungated by `$exponFlag$`) as
   * a Chapter-6 fallback for pure hyperbolics. Returns null when u is not such a
   * function, the substituted rational integral does not close, or any step
   * throws (a complex-coefficient rational sub-integrand can crash the native
   * integrator — better to leave the problem unsolved than to error). */
  private functionOfExponentialFallback(
    integrand: Expression,
    variable: string,
    depth: number
  ): Expression | null {
    const ce = this.ce;
    const x = ce.symbol(variable);
    try {
      const sub = functionOfExponentialSubstitution(integrand, variable);
      if (sub === null) return null; // not purely a function of one exponential
      const { v, g } = sub;
      const dv = ce.function('D', [v, x]).evaluate();
      // v = F^(linear) ⇒ v′ = (const)·v, so v/v′ is x-free; bail otherwise.
      const ratio = v.div(dv);
      if (dv.isSame(0) || ratio.has(variable)) return null;
      const inner = this.intRec(
        recanonicalize(ce, g.div(x)),
        variable,
        depth + 1
      );
      if (inner === null || inner.has('Integrate')) return null;
      // ∫u dx = (v / v′) · (∫ g/x dx)[x → v]
      return this.cleanExpansionResult(
        ratio.mul(inner.subs({ [variable]: v }))
      );
    } catch {
      return null;
    }
  }

  /** Clean the exponential-fallback antiderivative: collect like terms via a
   * bounded simplify (the raw expansion repeats `c·x` once per exponential
   * term, which otherwise bloats high-degree results past the verifier's leaf
   * cap), then fold the stray `ln(e)` the Chapter-2 rules leave. The value is
   * unchanged; this only tidies and shrinks the form. Order matters: simplify
   * FIRST (it collapses the huge expansion to a handful of terms in ~ms),
   * THEN fold `ln(e)` on the now-small result — the fold rebuilds (and so
   * re-canonicalizes, dropping the `·1`) cheaply once the form is small.
   * Bounded by a slice of the driver budget so a pathological simplify can't
   * overrun. */
  private cleanExpansionResult(F: Expression): Expression {
    const ce = this.ce;
    const remainingMs = this.deadline - Date.now();
    let simplified = F;
    if (remainingMs > 0) {
      const savedLimit = ce.timeLimit;
      ce.timeLimit = Math.max(1, Math.min(remainingMs, 5000));
      try {
        simplified = F.simplify();
      } catch (e) {
        if (!(e instanceof Error && e.constructor.name === 'CancellationError'))
          throw e;
        // deadline hit — keep the unsimplified form
      } finally {
        ce.timeLimit = savedLimit;
      }
    }
    return foldLnExponentialE(ce, simplified);
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
