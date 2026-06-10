// Public types for the Fungrim Phase-1 identities loader
// (FUNGRIM-PLAN-5-LOADER.md §2.1, §2.2, §2.8 — milestone M2).
//
// These types describe the checked-in compiled artifact
// (`fungrim-core-data.json`, produced by `scripts/fungrim/compile-rules.ts`)
// and the runtime loader API (`loader.ts`).
//
// This module imports engine TYPES only — no runtime dependency on the
// engine. The public-facing aliases are the `Identities*` names; the
// internal names stay fungrim-prefixed.

import type { RulePurpose } from '../types-kernel-evaluation';
import type { BoxedSubstitution } from '../types-serialization';

/** Raw MathJSON — the artifact is plain JSON. */
export type FungrimMathJson = unknown;

/**
 * A declarative guard specification, compiled offline from a corpus entry's
 * assumptions (FUNGRIM-PLAN-5-LOADER.md §2.2). The runtime loader turns each
 * spec into a tri-valued condition closure; every predicate must return a
 * definitive positive for the rule to fire (fail-closed).
 */
export type GuardSpec =
  | { k: 'type'; wc: string; t: 'integer' | 'real' | 'rational' | 'complex' }
  | {
      k: 'cmp';
      wc: string;
      op: 'gt' | 'ge' | 'lt' | 'le';
      bound: FungrimMathJson;
    }
  /**
   * Phase 3: comparison over a part extractor of the substituted value —
   * `Greater(Re(z), 0)`, `Less(Abs(q), 1)`, `Element(Im(z), Interval(a,b))`.
   * Literal substitutions fold numerically; symbol substitutions consult the
   * Track-3 part-bound assumption facts.
   */
  | {
      k: 'part-cmp';
      wc: string;
      part: 're' | 'im' | 'abs' | 'arg';
      op: 'gt' | 'ge' | 'lt' | 'le';
      bound: FungrimMathJson;
    }
  /**
   * Phase 3: membership in an inert or compound set (`HH`, explicit
   * `Set(…)`, `Union(…)`). Fires only on a literal `True` from the Element
   * evaluation — for inert shells like `HH` (no `contains` handler) that is
   * the Track-3 stored-membership exact-match path
   * (`assume(Element(tau, HH))`); literals can never discharge those.
   */
  | { k: 'member'; wc: string; set: FungrimMathJson }
  | { k: 'ne'; lhs: FungrimMathJson; rhs: FungrimMathJson }
  | { k: 'eval'; pred: FungrimMathJson };

/** Corpus entry class of a compiled rule. */
export type FungrimRuleClass = 'specific-value' | 'identity';

/** Which engine rule store a compiled rule is routed to. */
export type FungrimRuleTarget = 'simplify' | 'solve' | 'harmonization';

/**
 * One compiled rule record from the artifact. `match`/`replace` are stored
 * in CANONICAL-form MathJSON: the loader must box them canonically (in a
 * scope where the wildcards carry their guard-implied types) before handing
 * them to the engine.
 */
export type CompiledFungrimRule = {
  /** `'fungrim:<entry-id>'` — surfaces in `simplify()` steps' `because`. */
  id: string;
  match: FungrimMathJson;
  replace: FungrimMathJson;
  guards: GuardSpec[];
  purpose: RulePurpose;
  target: FungrimRuleTarget;
  class: FungrimRuleClass;
  /** Heads referenced by the rule (for shell pruning and diagnostics). */
  heads: string[];
  /** Corpus topics (for load-time filtering). */
  topics: string[];
};

/** A pruned shell declaration: a head referenced by the compiled rules that
 *  is not a Compute Engine built-in. */
export type FungrimShellDeclaration = {
  signature: string;
  description?: string;
  arity?: number | number[];
};

/** Provenance and compile-time statistics baked into the artifact. */
export type FungrimManifest = {
  schemaVersion: number;
  generator: string;
  upstream: {
    name: string;
    snapshotSha256: string | null;
    translator: string | null;
  };
  slice: {
    classes: string[];
    guardLevels: string[];
    entries: number;
  };
  counts: {
    rules: number;
    byPurpose: Record<string, number>;
    byClass: Record<string, number>;
    byTarget: Record<string, number>;
  };
  /** Offline skip counts by reason (guard-uncompilable, compat-signature,
   *  wildcard-loss, no-fire, duplicate-undirected, lhs-not-value-form, …). */
  ledger: Record<string, number>;
};

/** The shape of the compiled artifact (`fungrim-core-data.json`). */
export type FungrimRuleData = {
  manifest: FungrimManifest;
  declarations: Record<string, FungrimShellDeclaration>;
  rules: CompiledFungrimRule[];
};

/**
 * Debug hook invoked when a rule's condition fails specifically because a
 * guard predicate returned `undefined` (unknown) — as opposed to a
 * definitive negative. Converts "the rule silently didn't fire" into an
 * actionable trace (FUNGRIM-PLAN-5-LOADER.md §2.8).
 */
export type FungrimGuardUndecidedHandler = (
  ruleId: string,
  wildcards: BoxedSubstitution
) => void;

/** Options for `loadIdentities()` (FUNGRIM-PLAN-5-LOADER.md §2.1). */
export type FungrimLoadOptions = {
  /** Only load rules tagged with at least one of these corpus topics. */
  topics?: ReadonlyArray<string>;
  /** Only load rules of these classes. */
  classes?: ReadonlyArray<FungrimRuleClass>;
  /** Only load rules with these purposes. */
  purposes?: ReadonlyArray<RulePurpose>;
  /** When `true`, rules targeting the solve/harmonization stores are routed
   *  to `ce.solveRules`/`ce.harmonizationRules`. **Default**: `false`
   *  (such rules are skipped with reason `'solve-disabled'`). */
  solve?: boolean;
  /** Debug hook for guard predicates that return `undefined`. */
  onGuardUndecided?: FungrimGuardUndecidedHandler;
  /** Alternate compiled artifact (testing, future per-family data modules).
   *  **Default**: the bundled `FUNGRIM_CORE` artifact. */
  data?: FungrimRuleData;
};

/** The report returned by `loadIdentities()` (FUNGRIM-PLAN-5-LOADER.md §2.8). */
export type FungrimLoadReport = {
  /** Number of rules registered by this call. */
  loaded: number;
  byTarget: Record<FungrimRuleTarget, number>;
  byPurpose: Record<RulePurpose, number>;
  /** Shell heads newly declared in the current scope by this call. */
  declared: string[];
  /** Runtime skips: selection filters, already-loaded ids, boxing failures
   *  in the user's environment. */
  skipped: { id: string; reason: string }[];
  /** Baked-in offline skip counts by reason, from the artifact manifest —
   *  what the *corpus* contains vs. what this artifact can do. */
  compileLedger: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Public-facing aliases (the loader is published as `loadIdentities` on the
// `@cortex-js/compute-engine/identities` subpath)
// ---------------------------------------------------------------------------

export type IdentitiesLoadOptions = FungrimLoadOptions;
export type IdentitiesLoadReport = FungrimLoadReport;
export type IdentitiesRuleData = FungrimRuleData;
export type IdentitiesGuardUndecidedHandler = FungrimGuardUndecidedHandler;
