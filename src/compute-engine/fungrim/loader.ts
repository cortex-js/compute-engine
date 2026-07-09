// Runtime loader for the compiled Fungrim artifact
// (docs/fungrim/FUNGRIM-PLAN-5-LOADER.md §2.1, §2.2 runtime half, §2.8 — milestone M2;
// extended in Phase 3 to complex-domain guards: part-cmp/member guard kinds
// and the `complex` type guard, discharged through the Track-3 assumptions
// machinery).
//
// `loadIdentities(ce, options?)`:
//
//  1. declares the pruned shell heads referenced by the *selected* rules in
//     the engine's current scope (skips already-defined names — built-ins
//     are never widened),
//  2. boxes each rule's `match`/`replace` CANONICALLY in a child scope where
//     the wildcards are declared with their guard-implied types (the
//     artifact stores canonical-form MathJSON; raw boxing would leave
//     `['Rational',1,2]` as a structural function expression and lose the
//     literal matches, and bare-string sides would be parsed as LaTeX),
//  3. turns each guard spec into a tri-valued condition closure: every
//     predicate must return a definitive positive; `undefined` (unknown)
//     means the rule does not fire (fail-closed) and the `onGuardUndecided`
//     hook is invoked so the non-firing is observable,
//  4. registers the rules (with `id` and `purpose`) via
//     `ce.simplificationRules.push` — or `ce.solveRules.push` /
//     `ce.harmonizationRules.push` for `target: 'solve' | 'harmonization'`
//     rules when `options.solve === true`,
//  5. returns the §2.8 load report.
//
// PERFORMANCE (§2.4 fallback, M5): simplify-target rules whose canonical
// match head is a high-traffic arithmetic operator (Multiply, Add, Divide,
// Power, …) are registered as pre-screened FUNCTIONAL rules with an
// `operators` dispatch hint instead of plain pattern rules. Without this,
// every such rule is candidate-matched (including commutative permutation
// matching) against every arithmetic node of every simplified expression.
// The functional wrapper first runs a cheap, CONSERVATIVE pre-screen — the
// named operator heads and symbols that MUST appear in any expression the
// pattern can match (Factorial, Gamma, GCD, Pi, EulerGamma, …) are computed
// once at load time and checked against a memoized feature set of the
// candidate expression — and only attempts the real pattern match (and
// guard conditions) for survivors. Same rewrites, same ids in RuleSteps'
// `because`, same purpose/cost-gate semantics; see `wrapHotHeadRule`.
//
// Idempotent per engine: loaded rule ids are tracked in a WeakMap keyed by
// the engine, so overlapping selections never register a rule twice.
//
// IMPORTANT: this module imports engine TYPES only (the loader receives the
// engine as an argument and uses the public API surface). There must be no
// runtime import of `src/compute-engine/index.ts` from this directory.

import coreDataJson from './fungrim-core-data.json';

import type { IComputeEngine } from '../types-engine.js';
import type { Expression, ExpressionInput } from '../types-expression.js';
import type { BoxedSubstitution } from '../types-serialization.js';
import type { Rule, RuleStep } from '../types-evaluation.js';
import type { RulePurpose } from '../types-kernel-evaluation.js';

import type {
  CompiledFungrimRule,
  FungrimGuardUndecidedHandler,
  FungrimLoadOptions,
  FungrimLoadReport,
  FungrimMathJson,
  FungrimRuleData,
  GuardSpec,
} from './types.js';

/** The compiled artifact (the whole slice, bundled as JSON). */
export const FUNGRIM_CORE: FungrimRuleData =
  coreDataJson as unknown as FungrimRuleData;

// ---------------------------------------------------------------------------
// MathJSON tree utilities (mirrors scripts/fungrim/compile-rules.ts)
// ---------------------------------------------------------------------------

/** All wildcard symbols (`_…`) appearing in a MathJSON tree. */
function collectWildcards(
  x: FungrimMathJson,
  out = new Set<string>()
): Set<string> {
  if (typeof x === 'string' && x.startsWith('_')) out.add(x);
  else if (Array.isArray(x)) for (const y of x) collectWildcards(y, out);
  return out;
}

/** All symbol-position strings appearing in a MathJSON tree. */
function collectSymbols(
  x: FungrimMathJson,
  out = new Set<string>()
): Set<string> {
  if (typeof x === 'string') out.add(x);
  else if (Array.isArray(x)) for (const y of x) collectSymbols(y, out);
  return out;
}

/** The MathJSON payload(s) of a guard (for symbol/wildcard collection). */
function guardJson(g: GuardSpec): FungrimMathJson {
  if (g.k === 'type') return g.wc;
  if (g.k === 'cmp' || g.k === 'part-cmp') return [g.wc, g.bound];
  if (g.k === 'member') return [g.wc, g.set];
  if (g.k === 'ne') return [g.lhs, g.rhs];
  return g.pred;
}

/** GuardSpec part tags → CE operator heads. */
const PART_TO_OPERATOR: Record<'re' | 'im' | 'abs' | 'arg', string> = {
  re: 'Real',
  im: 'Imaginary',
  abs: 'Abs',
  arg: 'Argument',
};

const CMP_TO_OPERATOR: Record<'gt' | 'ge' | 'lt' | 'le', string> = {
  gt: 'Greater',
  ge: 'GreaterEqual',
  lt: 'Less',
  le: 'LessEqual',
};

// ---------------------------------------------------------------------------
// Guard-spec → tri-valued condition closures (§2.2 runtime half)
// ---------------------------------------------------------------------------

/** `true`: definitively satisfied. `false`: definitively violated.
 *  `undefined`: undecidable on this substitution (still blocks firing). */
type GuardResult = boolean | undefined;
type GuardClosure = (sub: BoxedSubstitution) => GuardResult;

/**
 * Box guard sub-expressions once per rule at load time (wildcards as typed
 * symbols, declared by the caller's scope); `.subs()`-instantiated per match.
 */
function buildGuardClosures(
  ce: IComputeEngine,
  guards: ReadonlyArray<GuardSpec>
): GuardClosure[] {
  const boxGuardExpr = (x: FungrimMathJson): Expression => {
    try {
      const b = ce.expr(x as ExpressionInput);
      if (b.isValid) return b;
    } catch {
      /* fall through to raw boxing */
    }
    return ce.expr(x as ExpressionInput, { form: 'raw' });
  };

  return guards.map((g): GuardClosure => {
    switch (g.k) {
      case 'type': {
        if (g.t === 'complex') {
          // Fungrim CC = FINITE complex numbers. Literal fast path via the
          // type lattice; symbols go through the boxed Element evaluation,
          // which mirrors `ComplexNumbers.contains` and consults the Track-3
          // type refinements made by `assume(Element(z, ComplexNumbers))`.
          const pred = boxGuardExpr(['Element', g.wc, 'ComplexNumbers']);
          return (sub) => {
            const v = sub[g.wc];
            if (v === undefined) return false;
            // Fungrim CC = FINITE complex numbers. Under D10 (2026-07-02)
            // `real ⊂ complex`, so a symbol declared complex — or
            // real/rational/integer (or a finite_ variant, all subtypes of
            // `real ⊂ complex`) — satisfies a complex guard through the normal
            // subtype path (`type.matches('complex')`). Fungrim's CC is finite,
            // so exclude a PROVABLY-infinite value (a ±∞ literal has
            // isFinite === false; a plain real/complex symbol's is undefined
            // and is accepted). This replaces the pre-D10 shim that had to
            // special-case `type.matches('real')` because `real ⊄ complex`.
            if (v.isFinite !== false && v.type.matches('complex')) return true;
            try {
              const r = pred.subs(sub).evaluate().json;
              if (r === 'True') return true;
              if (r === 'False') return false;
              return undefined; // symbolic residue: undecided
            } catch {
              return undefined;
            }
          };
        }
        return (sub) => {
          const v = sub[g.wc];
          if (v === undefined) return false;
          // Fungrim's declared domains (ZZ/QQ/RR) are FINITE, matching the
          // 'complex' guard's finiteness gate above (SYM P3-7). A value
          // PROVABLY non-finite (a ±∞ or ~∞ literal has `isFinite === false`;
          // note `(+∞).isReal === true`, so without this gate a real guard
          // would fail-open at infinity) is blocked. Unknown finiteness
          // (`isFinite === undefined`, e.g. a plain declared-real symbol)
          // still passes — `!== false` — so ordinary symbols discharge as
          // before; only a known-infinite instance is rejected.
          if (v.isFinite === false) return false;
          if (g.t === 'integer') return v.isInteger;
          if (g.t === 'real') return v.isReal;
          return v.isRational;
        };
      }
      case 'part-cmp': {
        // Compare a part extractor of the substituted value: a LITERAL
        // substitution folds numerically (Re(1+2i) → 1 > 0); a SYMBOL
        // substitution consults the Track-3 part-bound facts
        // (assume(Re(s) > 1) ⇒ Greater(Re(s), 0) evaluates to True).
        const pred = boxGuardExpr([
          CMP_TO_OPERATOR[g.op],
          [PART_TO_OPERATOR[g.part], g.wc],
          g.bound,
        ]);
        return (sub) => {
          const v = sub[g.wc];
          if (v === undefined) return false;
          try {
            const inst = pred.subs(sub);
            const r = inst.evaluate().json;
            if (r === 'True') return true;
            if (r === 'False') return false;
            // Composite constant bounds (2π, 1/e, …) do not fold exactly;
            // retry numerically. An unknown stays `undefined` ⇒ the rule
            // does not fire (fail-closed).
            const rN = inst.N().json;
            if (rN === 'True') return true;
            if (rN === 'False') return false;
            return undefined;
          } catch {
            return undefined;
          }
        };
      }
      case 'member': {
        // Membership via the boxed Element evaluation: literals through the
        // set's `contains` handler; symbols through the Track-3
        // stored-membership exact-match path. Inert shells (HH) have no
        // `contains`, so literal substitutions stay undecided there —
        // observable through the onGuardUndecided hook.
        const pred = boxGuardExpr(['Element', g.wc, g.set]);
        return (sub) => {
          const v = sub[g.wc];
          if (v === undefined) return false;
          try {
            const r = pred.subs(sub).evaluate().json;
            if (r === 'True') return true;
            if (r === 'False') return false;
            return undefined; // symbolic residue: undecided
          } catch {
            return undefined;
          }
        };
      }
      case 'cmp': {
        const bound = boxGuardExpr(g.bound);
        const compare = (v: Expression, b: Expression): boolean | undefined =>
          g.op === 'gt'
            ? v.isGreater(b)
            : g.op === 'ge'
              ? v.isGreaterEqual(b)
              : g.op === 'lt'
                ? v.isLess(b)
                : v.isLessEqual(b);
        return (sub) => {
          const v = sub[g.wc];
          if (v === undefined) return false;
          try {
            let b = bound.subs(sub);
            if (!b.isCanonical) b = b.canonical;
            let r = compare(v, b);
            // Composite constant bounds (-π, π/2, 1/e, …) are not directly
            // comparable; retry on the numeric evaluations. An unknown stays
            // `undefined` ⇒ the rule does not fire (fail-closed).
            if (r === undefined) r = compare(v.N(), b.N());
            return r;
          } catch {
            return undefined;
          }
        };
      }
      case 'ne': {
        const lhs = boxGuardExpr(g.lhs);
        const rhs = boxGuardExpr(g.rhs);
        return (sub) => {
          try {
            // Provable inequality only: `isEqual` may be `undefined` for
            // symbolic arguments (even under assumptions) — that is the
            // undecided case the onGuardUndecided hook makes observable.
            const eq = lhs.subs(sub).isEqual(rhs.subs(sub));
            if (eq === undefined) return undefined;
            return eq === false;
          } catch {
            return undefined;
          }
        };
      }
      case 'eval': {
        const pred = boxGuardExpr(g.pred);
        return (sub) => {
          try {
            const r = pred.subs(sub).evaluate().json;
            if (r === 'True') return true;
            if (r === 'False') return false;
            return undefined; // symbolic residue: undecided
          } catch {
            return undefined;
          }
        };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Per-rule boxing (canonical, in a wildcard-typed child scope)
// ---------------------------------------------------------------------------

/** Wildcard types implied by the compiled guards (default `'complex'`). */
function wildcardTypes(rule: CompiledFungrimRule): Record<string, string> {
  const types: Record<string, string> = {};
  for (const g of rule.guards)
    if (g.k === 'type' && types[g.wc] === undefined) types[g.wc] = g.t;
  return types;
}

/** The load-time-boxed parts of a compiled rule. Structurally a valid
 *  object `Rule`, but with the boxed types visible (needed by
 *  `wrapHotHeadRule`). */
type BoxedRuleParts = {
  match: Expression;
  replace: Expression;
  condition?: (sub: BoxedSubstitution) => boolean;
  useVariations?: boolean;
  id: string;
  purpose: RulePurpose;
};

/** Root-template filter (mirrors `solve.ts`'s `filter`): no wildcard other
 *  than the unknown `_x` may capture `_x`, so `__b` is a genuine constant
 *  offset free of the unknown. Required on every `target: 'solve'` rule —
 *  the derived templates carry no domain guards (the upstream identity's
 *  domain guards are intentionally dropped; `validateRoots` checks every
 *  candidate against the original equation, so an over-broad template
 *  degrades to a no-op rather than a wrong answer). */
function solveNoCaptureFilter(sub: BoxedSubstitution): boolean {
  for (const [k, v] of Object.entries(sub))
    if (k !== '_x' && k !== 'x' && v.has('_x')) return false;
  return true;
}

function boxCompiledRule(
  ce: IComputeEngine,
  rule: CompiledFungrimRule,
  onGuardUndecided: FungrimGuardUndecidedHandler | undefined
): { rule: BoxedRuleParts } | { error: string } {
  // Box in a child scope where the wildcards carry their guard-implied
  // types: strict validation of typed slots (Fibonacci(_n), Totient(_n), …)
  // passes, and inferred wildcard types never leak into the user's scope.
  const wildcards = collectWildcards(rule.match);
  collectWildcards(rule.replace, wildcards);
  for (const g of rule.guards) collectWildcards(guardJson(g), wildcards);
  const types = wildcardTypes(rule);

  ce.pushScope();
  try {
    for (const wc of wildcards) {
      try {
        ce.declare(wc, types[wc] ?? 'complex');
      } catch {
        /* tolerate */
      }
    }

    // The artifact stores match/replace in canonical-form MathJSON; box
    // CANONICALLY (raw boxing leaves ['Rational',1,2] as a structural
    // function expression and loses literal matches; a bare-string side
    // ('_x') passed unboxed to ce.rules would be parsed as LaTeX).
    const match = ce.expr(rule.match as ExpressionInput);
    if (!match.isValid)
      return { error: `invalid match: ${match.toString()}`.slice(0, 160) };
    const replace = ce.expr(rule.replace as ExpressionInput);
    if (!replace.isValid)
      return { error: `invalid replace: ${replace.toString()}`.slice(0, 160) };

    const closures = buildGuardClosures(ce, rule.guards);

    let condition: ((sub: BoxedSubstitution) => boolean) | undefined;
    if (closures.length > 0) {
      const id = rule.id;
      condition = (sub: BoxedSubstitution): boolean => {
        for (const f of closures) {
          const r = f(sub);
          if (r === true) continue;
          // Fail-closed: an undecided predicate blocks firing, but is
          // surfaced through the debug hook (§2.8).
          if (r === undefined) onGuardUndecided?.(id, sub);
          return false;
        }
        return true;
      };
    }

    // Solve-root templates (`target: 'solve'`) always carry the no-capture
    // filter (AND-combined with any guard closures) and run with variations
    // so the `__b` offset can be empty (`g(x) = 0`). The guard closures are
    // typically empty for these (domain guards dropped; see
    // `solveNoCaptureFilter`).
    if (rule.target === 'solve') {
      const guardCondition = condition;
      condition =
        guardCondition === undefined
          ? solveNoCaptureFilter
          : (sub: BoxedSubstitution): boolean =>
              solveNoCaptureFilter(sub) && guardCondition(sub);
    }

    return {
      rule: {
        match,
        replace,
        ...(condition !== undefined ? { condition } : {}),
        ...(rule.target === 'solve' ? { useVariations: true } : {}),
        id: rule.id,
        purpose: rule.purpose,
      },
    };
  } catch (err) {
    return {
      error: String((err as Error)?.message ?? err)
        .replace(/\s+/g, ' ')
        .slice(0, 160),
    };
  } finally {
    ce.popScope();
  }
}

// ---------------------------------------------------------------------------
// Hot-head pre-screened dispatch (§2.4 fallback; M5 benchmark fix)
// ---------------------------------------------------------------------------
//
// `simplify()` calls `replace()` on every function node of the traversed
// expression; the M2 rule index buckets pattern rules by their match head,
// so the ~90 identity-recognition rules whose canonical match heads are core
// arithmetic operators are candidate-matched against EVERY arithmetic node.
// A same-head match attempt is expensive (commutative permutation matching),
// and on a generic arithmetic corpus essentially all attempts fail.
//
// For rules in these hot head buckets the loader registers a functional rule
// (`{ replace: fn, operators: [head], id, purpose }`) that:
//
//   1. pre-screens the candidate expression against the rule's REQUIRED
//      FEATURES — named operator heads and named symbols that must appear
//      somewhere in any expression the pattern can match — using a memoized
//      per-expression feature set (one tree walk per distinct subtree),
//   2. only then runs the exact same `expr.match()` + condition + `subs()`
//      sequence `applyRule()` would have run for the pattern rule.
//
// SOUNDNESS of the pre-screen (the conservative invariant — never skip a
// rule that could match): with `useVariations: false` (the only mode the
// engine uses for the simplification store — `simplify()` hardcodes it and
// `replace()` defaults to it), `matchOnce()` requires a literal pattern
// symbol to match an identical expression symbol, and a literal pattern
// operator to match the same expression operator, EXCEPT for the always-on
// cross-head special cases in match.ts: a `Divide` pattern can match a
// `Multiply` expression or a rational literal, and a `Power` pattern can
// match a `Divide` or `Root` expression (via synthetic nodes rebuilt from
// the expression's own operands plus the literals 1/-1). `Divide` and
// `Power` are therefore never required; every other named head and every
// named symbol of the pattern must literally occur in a matching expression.
// Number/string literals are never required (rational decomposition can
// split them). Wildcards (`_…`) impose no requirement.
//
// Observable behavior is identical to the pattern-rule registration: same
// rule count in `ce.simplificationRules`, same per-rule `id`s (surfacing in
// RuleSteps' `because`), same `purpose` tags (so 'expand' rules stay out of
// `simplify()` and the 'transform' cost-gate exemption is preserved), same
// guard-condition closures (incl. the `onGuardUndecided` hook payload), and
// the same canonical replacement values.
//
// FURTHER FOLD (ROADMAP item 5): each functional rule registered here is still
// a SEPARATE entry in `ce.simplificationRules`, so on a hot node the M2 index
// yields all ~60 of a head's wrappers individually. The engine's cached
// simplification set collapses each head's wrappers into one per-head
// dispatcher (`aggregateHotHeadDispatch`, boxed-expression/rule-index.ts),
// paying the per-rule `applyRule`/candidate scaffolding once per head per node.
// That fold lives in the engine cache, NOT here — the public array keeps every
// per-rule entry, so the count + per-rule-id contracts above still hold.

/** Heads whose buckets are consulted on high-traffic nodes (tuned by
 *  measurement over the M5 benchmark corpus). `Multiply`, `Add`, `Divide`,
 *  `Power` are hit by every arithmetic node (plus the cross-head
 *  consultations Multiply→Divide, Divide/Root→Power); `Negate`, `Sqrt`,
 *  `Abs`, `Sin`, `Ln`, `Arctan` carry measurable corpus traffic;
 *  `Subtract`/`Which` are cheap to include. Low-traffic buckets (Gamma,
 *  JacobiTheta, CarlsonR*, …) stay as plain pattern rules — the M2 index
 *  already dispatches them efficiently. */
const HOT_DISPATCH_HEADS: ReadonlySet<string> = new Set([
  'Multiply',
  'Add',
  'Subtract',
  'Negate',
  'Divide',
  'Power',
  'Sqrt',
  'Abs',
  'Sin',
  'Ln',
  'Arctan',
  'Which',
]);

/** Pattern heads that can match expressions with a DIFFERENT operator even
 *  with `useVariations: false` (cross-head special cases in match.ts):
 *  never part of a rule's required features. */
const CROSS_HEAD_PATTERN_OPS: ReadonlySet<string> = new Set([
  'Divide',
  'Power',
]);

const FEATURE_OP_PREFIX = 'f:';
const FEATURE_SYM_PREFIX = 's:';

/** Memoized per-expression feature sets (named operator heads + named
 *  symbols occurring in the expression). Boxed expressions are immutable,
 *  so the cache is global (WeakMap-keyed on the expression identity). */
const featureCache = new WeakMap<Expression, ReadonlySet<string>>();
const NO_FEATURES: ReadonlySet<string> = new Set();

function featuresOf(expr: Expression): ReadonlySet<string> {
  const cached = featureCache.get(expr);
  if (cached !== undefined) return cached;

  let result: ReadonlySet<string>;
  const sym = (expr as { symbol?: string }).symbol;
  if (sym !== undefined) {
    result = new Set([FEATURE_SYM_PREFIX + sym]);
  } else {
    const ops = (expr as { ops?: ReadonlyArray<Expression> }).ops;
    if (ops === undefined) {
      result = NO_FEATURES; // number or string literal
    } else {
      const out = new Set<string>([FEATURE_OP_PREFIX + expr.operator]);
      for (const op of ops) for (const f of featuresOf(op)) out.add(f);
      result = out;
    }
  }
  featureCache.set(expr, result);
  return result;
}

/** The features (named heads/symbols) that must appear somewhere in any
 *  expression the pattern can match with `useVariations: false`. */
function requiredFeatures(pattern: Expression): ReadonlyArray<string> {
  const out = new Set<string>();
  const walk = (p: Expression): void => {
    const sym = (p as { symbol?: string }).symbol;
    if (sym !== undefined) {
      if (!sym.startsWith('_')) out.add(FEATURE_SYM_PREFIX + sym);
      return;
    }
    const ops = (p as { ops?: ReadonlyArray<Expression> }).ops;
    if (ops === undefined) return; // number/string literal: not required
    const op = p.operator;
    if (!op.startsWith('_') && !CROSS_HEAD_PATTERN_OPS.has(op))
      out.add(FEATURE_OP_PREFIX + op);
    for (const x of ops) walk(x);
  };
  walk(pattern);
  return [...out];
}

/**
 * Order the required features so the MOST DISCRIMINATING one is checked
 * first, and drop the dispatch-bucket head itself (the rule is only
 * consulted for nodes that already carry that operator, so it conveys zero
 * information). Rarity heuristic over generic corpora, rarest first:
 * special-function operator heads < named symbols < core arithmetic heads.
 * With ~470 complex-domain rules in the Multiply/Add/Divide buckets, the
 * first-feature check decides almost every pre-screen (437 of the 474 new
 * hot-bucket rules carry a rare feature), keeping the per-rule cost at one
 * or two set lookups per candidate node (Phase-3 M5).
 */
function rankRequiredFeatures(
  features: ReadonlyArray<string>,
  bucketHead: string
): ReadonlyArray<string> {
  const rank = (f: string): number => {
    if (f.startsWith(FEATURE_SYM_PREFIX)) return 1;
    // operator feature
    return HOT_DISPATCH_HEADS.has(f.slice(FEATURE_OP_PREFIX.length)) ? 2 : 0;
  };
  return features
    .filter((f) => f !== FEATURE_OP_PREFIX + bucketHead)
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * For a simplify-target rule whose canonical match head is in a hot bucket,
 * return a pre-screened functional rule with an `operators` dispatch hint;
 * for all other rules return the plain pattern rule unchanged.
 *
 * The functional body reproduces `applyRule()`'s pattern-rule sequence for
 * the engine's simplification channels (`{}` incoming substitution,
 * `useVariations: false`, `matchPermutations: true`, canonical replacement):
 * match → condition (with the same de-wildcarded substitution applyRule
 * builds, so the `onGuardUndecided` hook payload is unchanged) → `subs()`.
 * Returning a `RuleStep` keeps the rule's own `id` in `because` and its
 * `purpose` on the step.
 */
function wrapHotHeadRule(parts: BoxedRuleParts): Rule {
  const { match, replace, condition, id, purpose } = parts;

  const head = (match as { ops?: ReadonlyArray<Expression> }).ops
    ? match.operator
    : undefined;
  if (
    head === undefined ||
    head.startsWith('_') ||
    !HOT_DISPATCH_HEADS.has(head)
  )
    return parts as Rule;

  const required = rankRequiredFeatures(requiredFeatures(match), head);

  const replaceFn = (expr: Expression): RuleStep | undefined => {
    // 1. Cheap conservative pre-screen
    const features = featuresOf(expr);
    for (let i = 0; i < required.length; i++)
      if (!features.has(required[i])) return undefined;

    // 2. Full pattern match (same options applyRule uses on this channel)
    const sub = expr.match(match, {
      useVariations: false,
      recursive: false,
      matchPermutations: true,
    });
    if (sub === null) return undefined;

    // 3. Guard conditions (same substitution shape applyRule builds:
    //    wildcard keys plus their de-prefixed aliases)
    if (condition !== undefined) {
      const conditionSub = {
        ...Object.fromEntries(
          Object.entries(sub).map(([k, v]) => [k.slice(1), v])
        ),
        ...sub,
      };
      try {
        if (!condition(conditionSub)) return undefined;
      } catch {
        return undefined;
      }
    }

    // 4. Replacement (canonical, as on the engine's simplification channels)
    return {
      value: replace.subs(sub, { canonical: true }),
      because: id,
      purpose,
    };
  };

  return { replace: replaceFn, operators: [head], id, purpose };
}

// ---------------------------------------------------------------------------
// loadIdentities
// ---------------------------------------------------------------------------

/** Rule ids already registered, per engine (idempotence, §2.1). */
const loadedIdsByEngine = new WeakMap<IComputeEngine, Set<string>>();

/**
 * Load the compiled Fungrim identities into a Compute Engine instance.
 *
 * Synchronous and idempotent per engine: a second call with an overlapping
 * selection skips the already-loaded rule ids. Shell declarations go into
 * the **current** scope — call `loadIdentities` before declaring user
 * symbols that could shadow shell heads.
 */
export function loadIdentities(
  ce: IComputeEngine,
  options: FungrimLoadOptions = {}
): FungrimLoadReport {
  const data = options.data ?? FUNGRIM_CORE;
  const topics = options.topics !== undefined ? new Set(options.topics) : null;
  const classes =
    options.classes !== undefined ? new Set<string>(options.classes) : null;
  const purposes =
    options.purposes !== undefined ? new Set<string>(options.purposes) : null;
  const solve = options.solve === true;

  let alreadyLoaded = loadedIdsByEngine.get(ce);
  if (alreadyLoaded === undefined) {
    alreadyLoaded = new Set();
    loadedIdsByEngine.set(ce, alreadyLoaded);
  }

  const report: FungrimLoadReport = {
    loaded: 0,
    byTarget: { simplify: 0, solve: 0, harmonization: 0 },
    byPurpose: { simplify: 0, transform: 0, expand: 0 },
    declared: [],
    skipped: [],
    compileLedger: { ...data.manifest.ledger },
  };

  // -- 1. Selection (each rule gets exactly one disposition)
  //
  //    `referenced` accumulates the shell heads of EVERY rule that passes the
  //    class/topic/purpose/solve filters — including rules already loaded on
  //    this engine. Shell declarations are scope-local (`ce.declare`), so a
  //    rule loaded inside a since-popped scope leaves its rule object alive in
  //    the engine-global rule store while its shell heads have gone out of
  //    scope. Re-running the shell pass over the already-loaded rules too
  //    (idempotent: `declare` skips names still defined) makes those heads
  //    usable again on reload after a `popScope` (SYM P3-8).
  const selected: CompiledFungrimRule[] = [];
  const referenced = new Set<string>();
  const collectReferenced = (r: CompiledFungrimRule): void => {
    collectSymbols(r.match, referenced);
    collectSymbols(r.replace, referenced);
    for (const g of r.guards) collectSymbols(guardJson(g), referenced);
  };
  for (const r of data.rules) {
    if (classes !== null && !classes.has(r.class)) {
      report.skipped.push({ id: r.id, reason: 'filtered-class' });
      continue;
    }
    if (topics !== null && !r.topics.some((t) => topics.has(t))) {
      report.skipped.push({ id: r.id, reason: 'filtered-topic' });
      continue;
    }
    if (purposes !== null && !purposes.has(r.purpose)) {
      report.skipped.push({ id: r.id, reason: 'filtered-purpose' });
      continue;
    }
    if (r.target !== 'simplify' && !solve) {
      report.skipped.push({ id: r.id, reason: 'solve-disabled' });
      continue;
    }
    // Reference-collect before the already-loaded gate so shell heads are
    // re-declared on reload even when the rule itself is skipped.
    collectReferenced(r);
    if (alreadyLoaded.has(r.id)) {
      report.skipped.push({ id: r.id, reason: 'already-loaded' });
      continue;
    }
    selected.push(r);
  }

  // -- 2. Shell declarations: heads referenced by the selection (see above),
  //       in the current scope, skipping already-defined names (built-ins
  //       are never widened). Re-run unconditionally — idempotent-safe.
  for (const name of Object.keys(data.declarations).sort()) {
    if (!referenced.has(name)) continue;
    if (ce.lookupDefinition(name) !== undefined) continue; // never widen
    try {
      ce.declare(name, data.declarations[name].signature);
      report.declared.push(name);
    } catch {
      /* unable to declare (e.g. reserved name) — rules referencing it will
         be reported as box-error below */
    }
  }

  // -- 3. Box each rule and route it to its target store.
  //       Specific-value rules are registered AHEAD of identity rules:
  //       rule application is registration-ordered within a dispatch
  //       bucket, and a curated literal value (ChebyshevT(n, 1) → 1) must
  //       win over a generic identity rewrite of the same head (e.g. the
  //       exponential closed form ChebyshevT(n, x) → ((x+√(x²−1))ⁿ+…)/2,
  //       which the cost model otherwise lets fire on degenerate literal
  //       instantiations). Stable within each class (artifact order).
  const ordered = [
    ...selected.filter((r) => r.class === 'specific-value'),
    ...selected.filter((r) => r.class !== 'specific-value'),
  ];
  const buckets: Record<CompiledFungrimRule['target'], Rule[]> = {
    simplify: [],
    solve: [],
    harmonization: [],
  };
  for (const r of ordered) {
    const boxed = boxCompiledRule(ce, r, options.onGuardUndecided);
    if ('error' in boxed) {
      report.skipped.push({ id: r.id, reason: `box-error: ${boxed.error}` });
      continue;
    }
    // Hot-head simplify rules get the pre-screened functional form (§2.4
    // fallback). Solve/harmonization rules are excluded: their channels pass
    // an incoming substitution and `useVariations`, which only pattern rules
    // honor.
    buckets[r.target].push(
      r.target === 'simplify'
        ? wrapHotHeadRule(boxed.rule)
        : (boxed.rule as Rule)
    );
    alreadyLoaded.add(r.id);
    report.loaded += 1;
    report.byTarget[r.target] += 1;
    report.byPurpose[r.purpose] += 1;
  }

  // Registering via push() lets the engine's length-based mutation detection
  // invalidate the cached boxed rule sets.
  if (buckets.simplify.length > 0)
    ce.simplificationRules.push(...buckets.simplify);
  if (buckets.solve.length > 0) ce.solveRules.push(...buckets.solve);
  if (buckets.harmonization.length > 0)
    ce.harmonizationRules.push(...buckets.harmonization);

  return report;
}
