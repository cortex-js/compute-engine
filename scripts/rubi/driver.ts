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

import type {
  ComputeEngine,
  Expression,
} from '../../src/compute-engine/global-types';

import { matchAll } from './match';
import type { CompiledRule } from './compile';
import {
  build,
  evalCondition,
  findFailingConjunct,
  installCaches,
  RuleFail,
  Ctx,
  Hooks,
} from './rubi-utils';
import { toTimesPower, recanonicalize } from './normal-form';

const MAX_DEPTH = 40;

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
    return this.intRec(integrand, variable, 0);
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

    // Rubi rules match against the Times/Power normal form
    integrand = toTimesPower(ce, integrand);

    const key = variable + '§' + integrand.toString();
    if (this.memo.has(key)) return this.memo.get(key)!;
    this.memo.set(key, null); // cycle guard: a recursive identical subproblem fails

    const result = this.intUncached(integrand, variable, depth);
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
    const inert = (e: Expression): Expression =>
      ce._fn('Integrate', [e, x]);

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
    for (const rule of this.rules) {
      if (Date.now() > this.deadline) return null;
      // dispatch pre-screen on the root operator
      if (rule.rootOp !== null && rule.rootOp !== integrand.operator)
        continue;
      // conditions participate in matching: enumerate alternative
      // assignments (factor-role swaps etc.) and try conditions per env
      const envs = matchAll(rule.pat, integrand, x);
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
          this.stats.ruleFirings[rule.id] =
            (this.stats.ruleFirings[rule.id] ?? 0) + 1;
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
  }
}
