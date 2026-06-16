// Analytic-property metadata store
// (ROADMAP item 7; Fungrim Feature E, docs/fungrim/FUNGRIM.md §4.E).
//
// Per-operator analytic properties — poles, zeros, branch points/cuts,
// residues, holomorphic/meromorphic domains — translated from the Fungrim
// corpus and compiled to `function-properties-data.json` by
// `scripts/fungrim/compile-properties.ts`. The data ships in the core bundle.
//
//  - `ce.functionProperties(name)` exposes the records for an operator, with
//    convenience accessors that box the common set-valued properties lazily.
//  - `applyPoleOverride` lets the numeric evaluator return `ComplexInfinity`
//    when `f(z).N()` lands on a known pole and the kernel could not resolve a
//    value (NaN / still-symbolic) — see `BoxedFunction._computeValue`.
//
// IMPORTANT: this module imports engine TYPES only — it never runtime-imports
// the engine. Everything goes through the `IComputeEngine` argument's public
// API, so there is no dependency cycle with the boxed-expression layer.

import dataJson from './function-properties-data.json';

import type { IComputeEngine } from '../types-engine';
import type { Expression, ExpressionInput } from '../types-expression';

/** A single analytic-property record for an operator. The MathJSON fields are
 * raw (as translated from Fungrim); box them with `ce.expr` to query. */
export interface FunctionPropertyRecord {
  /** The Fungrim entry id (provenance). */
  readonly id: string;
  /** One of `Poles`, `Zeros`, `BranchPoints`, `BranchCuts`, `Residue`,
   * `EssentialSingularities`, `IsHolomorphic`, `IsMeromorphic`,
   * `AnalyticContinuation`, `Solutions`, `ComplexZeroMultiplicity`. */
  readonly property: string;
  /** The distinguished variable the property is stated in (e.g. `z`). */
  readonly var: string | null;
  /** Index of `var` among the operator's arguments, or null when there is no
   * single argument position (parametric / composite). */
  readonly argIndex: number | null;
  readonly expr: ExpressionInput | null;
  readonly domain: ExpressionInput | null;
  readonly point: ExpressionInput | null;
  readonly condition: ExpressionInput | null;
  readonly value: ExpressionInput | null;
  readonly assumptions: ExpressionInput | null;
}

/** Queryable analytic properties of an operator, returned by
 * `ce.functionProperties(name)`. The set-valued accessors return a boxed set
 * (e.g. `NonPositiveIntegers`) for the unconditional record of that kind, or
 * `undefined` when no such record exists. Parametric / conditional records
 * (e.g. residues that depend on parameters) are available via `entries`. */
export interface FunctionProperties {
  readonly operator: string;
  /** All analytic-property records for this operator. */
  readonly entries: readonly FunctionPropertyRecord[];
  readonly poles: Expression | undefined;
  readonly zeros: Expression | undefined;
  readonly branchPoints: Expression | undefined;
  readonly branchCuts: Expression | undefined;
  readonly essentialSingularities: Expression | undefined;
  /** The domain on which the function is holomorphic. */
  readonly holomorphicDomain: Expression | undefined;
  /** Whether the function is meromorphic, when the corpus records it. */
  readonly isMeromorphic: boolean | undefined;
}

interface PropertyArtifact {
  manifest: unknown;
  operators: Record<string, FunctionPropertyRecord[]>;
}

const DATA = dataJson as unknown as PropertyArtifact;

class FunctionPropertiesImpl implements FunctionProperties {
  private readonly _cache = new Map<string, Expression | undefined>();

  constructor(
    private readonly ce: IComputeEngine,
    readonly operator: string,
    readonly entries: readonly FunctionPropertyRecord[]
  ) {}

  // Box the given field of the unconditional record of `property` (prefer a
  // record with no assumptions/condition; fall back to the first one). Cached.
  private boxed(
    property: string,
    field: 'value' | 'domain'
  ): Expression | undefined {
    const key = `${property}:${field}`;
    const cached = this._cache.get(key);
    if (cached !== undefined || this._cache.has(key)) return cached;

    const rec =
      this.entries.find(
        (e) =>
          e.property === property &&
          e.assumptions == null &&
          e.condition == null
      ) ?? this.entries.find((e) => e.property === property);

    let result: Expression | undefined = undefined;
    const raw = rec?.[field];
    if (raw != null) {
      try {
        const b = this.ce.expr(raw);
        if (b.isValid) result = b;
      } catch {
        result = undefined;
      }
    }
    this._cache.set(key, result);
    return result;
  }

  get poles() {
    return this.boxed('Poles', 'value');
  }
  get zeros() {
    return this.boxed('Zeros', 'value');
  }
  get branchPoints() {
    return this.boxed('BranchPoints', 'value');
  }
  get branchCuts() {
    return this.boxed('BranchCuts', 'value');
  }
  get essentialSingularities() {
    return this.boxed('EssentialSingularities', 'value');
  }
  get holomorphicDomain() {
    return this.boxed('IsHolomorphic', 'domain');
  }

  get isMeromorphic(): boolean | undefined {
    // The corpus encodes meromorphy as an `IsMeromorphic` record asserting a
    // domain (value is null); its mere presence is the affirmative.
    return this.entries.some((e) => e.property === 'IsMeromorphic')
      ? true
      : undefined;
  }
}

// Per-engine cache of property views (boxing is engine-specific).
const STORE = new WeakMap<IComputeEngine, Map<string, FunctionProperties>>();

/** Return the analytic properties of `name`, or undefined if none are known.
 * Backs `ce.functionProperties(name)`. */
export function getFunctionProperties(
  ce: IComputeEngine,
  name: string
): FunctionProperties | undefined {
  const records = DATA.operators[name];
  if (!records || records.length === 0) return undefined;

  let cache = STORE.get(ce);
  if (!cache) {
    cache = new Map();
    STORE.set(ce, cache);
  }
  let props = cache.get(name);
  if (!props) {
    props = new FunctionPropertiesImpl(ce, name, records);
    cache.set(name, props);
  }
  return props;
}

// Operators that carry at least one BranchCuts record — a cheap gate so
// `onBranchCut` only does membership work for functions that have branch cuts.
const BRANCH_CUT_OPERATORS: ReadonlySet<string> = new Set(
  Object.keys(DATA.operators).filter((op) =>
    DATA.operators[op].some((r) => r.property === 'BranchCuts')
  )
);

/**
 * True when `arg` provably lies on a branch cut of `operator`, per the store's
 * `BranchCuts` record (ROADMAP item 7a). Used to block simplification rewrites
 * that would cross a branch cut — e.g. `ln(a) + ln(b) → ln(ab)` is unsound when
 * an operand is on the negative real axis (`ln(-2) + ln(-3) ≠ ln(6)`, they
 * differ by `2πi`).
 *
 * A `BranchCuts` value is a `Set` of cut regions (e.g. `Ln` ⇒
 * `Set(Interval(Open(-oo), 0))`); `arg` is on a cut when it is a member of any
 * region. Fail-closed: an undecidable / symbolic membership returns `false`
 * (treated as "not provably on the cut"), so the guard never blocks a rewrite
 * it cannot justify — it only ever stops a provably-unsound one.
 */
export function onBranchCut(
  ce: IComputeEngine,
  operator: string,
  arg: Expression
): boolean {
  if (!BRANCH_CUT_OPERATORS.has(operator)) return false;
  const cuts = getFunctionProperties(ce, operator)?.branchCuts;
  if (cuts === undefined) return false;

  // The value is a Set of cut regions; test membership in each region. (A bare
  // region — not wrapped in a Set — is treated as a single region.)
  const setOps = (cuts as { ops?: ReadonlyArray<Expression> }).ops;
  const regions =
    cuts.operator === 'Set' && setOps !== undefined ? setOps : [cuts];
  for (const region of regions) {
    try {
      if (ce.function('Element', [arg, region]).evaluate().valueOf() === true)
        return true;
    } catch {
      /* undecidable region: fall through (fail-closed) */
    }
  }
  return false;
}

// Operators that carry at least one Poles record — a cheap gate so the numeric
// evaluator only does membership work for functions that can have poles.
const POLE_OPERATORS: ReadonlySet<string> = new Set(
  Object.keys(DATA.operators).filter((op) =>
    DATA.operators[op].some((r) => r.property === 'Poles')
  )
);

function isOnPoleSet(
  ce: IComputeEngine,
  arg: Expression,
  value: ExpressionInput
): boolean {
  // Explicit finite pole set `["Set", e1, e2, ...]` (empty set `["Set"]` ⇒
  // no poles): membership by structural equality.
  if (Array.isArray(value) && value[0] === 'Set') {
    for (let i = 1; i < value.length; i++)
      if (arg.isSame(ce.expr(value[i] as ExpressionInput))) return true;
    return false;
  }
  // Named set / domain (e.g. `NonPositiveIntegers`): require a definitive
  // positive membership (fail-closed on unknown / symbolic args — an
  // unresolved `Element(...)` has a string `valueOf`, never `true`).
  try {
    return (
      ce
        .function('Element', [arg, ce.expr(value)])
        .evaluate()
        .valueOf() === true
    );
  } catch {
    return false;
  }
}

// True when an operand of `operator(ops...)` lands on a known pole. Only the
// unconditional, single-argument, membership-style Poles records are consulted
// (parametric ones — Weierstrass lattices, Dirichlet-L `Which`, ... — are left
// to `entries`).
function argOnPole(
  ce: IComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>
): boolean {
  const records = DATA.operators[operator];
  if (!records) return false;
  for (const r of records) {
    if (r.property !== 'Poles') continue;
    if (r.assumptions != null || r.condition != null) continue;
    if (r.value == null || r.argIndex == null) continue;
    const arg = ops[r.argIndex];
    if (arg !== undefined && isOnPoleSet(ce, arg, r.value)) return true;
  }
  return false;
}

/**
 * Pole-aware numeric evaluation. When `operator(ops...)` is evaluated
 * numerically and an operand lands on a known pole, the value is
 * `ComplexInfinity`. Only a result the kernel could not resolve (NaN or
 * still-symbolic) is overridden — a kernel that already returns a finite value
 * or a directed/complex infinity is kept untouched (so e.g. `Gamma`'s `~oo`
 * and `Zeta(1)`'s `+oo` are preserved, while `Digamma(-2).N()`'s NaN becomes
 * `~oo`). Called by `BoxedFunction._computeValue` under `numericApproximation`.
 */
export function applyPoleOverride(
  ce: IComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>,
  result: Expression
): Expression {
  if (!POLE_OPERATORS.has(operator)) return result;
  const needsOverride =
    result.isNaN === true ||
    (result.isFinite !== true && result.isInfinity !== true);
  if (!needsOverride) return result;
  return argOnPole(ce, operator, ops) ? ce.ComplexInfinity : result;
}
