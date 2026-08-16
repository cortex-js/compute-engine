/**
 * Compile-time common-subexpression elimination — **Stage H (harvest)**.
 *
 * This module is the *analysis* half of the CSE design
 * (`docs/plans/2026-07-28-compile-cse-design.md`, §5). It is deliberately
 * free of any emission concern: it imports nothing from `base-compiler.ts`
 * (the dependency direction is `base-compiler` → `cse`), constructs no boxed
 * nodes, and mutates nothing. Its output — a region tree plus, per region, the
 * candidates whose occurrences that region may bind — is consumed by the
 * emission stage (§6).
 *
 * The two passes share ONE declarative inventory of conditionally-evaluated
 * operand positions ({@link LAZY_OPERANDS} / {@link lazyOperandRegions}) so
 * that harvest's static regions and emission's region instances cannot drift
 * (§5.1).
 */

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
  BoxedOperatorDefinition,
} from '../global-types.js';

import {
  isFunction,
  isSymbol,
  isString,
} from '../boxed-expression/type-guards.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import {
  isPureBuiltinCallback,
  systemScopeBinding,
} from './builtin-callback.js';
import { symbolAtSite } from '../boxed-expression/binding-sites.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';

// ---------------------------------------------------------------------------
// Tunable constants (§5.2 G4, §5, §6.2). All named, all exported: the
// threshold tests pin them by reference, never by literal.
// ---------------------------------------------------------------------------

/** Minimum node count of a candidate subtree (§5.2 G4). Skips `Negate(x)`
 * trivia while admitting the corpus's dominant size-4–7 patterns. */
export const CSE_MIN_SIZE = 4;

/** Minimum benefit score, `(regionCount − 1) × size`, where `regionCount` is
 * the PER-REGION occurrence count surviving steps 3–6 of §5.2 — never the
 * global bucket total. */
export const CSE_MIN_SCORE = 8;

/** Upper bound on the number of temporaries bound at one region (§6.2).
 * Beyond it the highest-scoring candidates are kept (ties broken by first
 * occurrence, so the choice is deterministic) and the rest emit inline. */
export const CSE_MAX_BINDINGS_PER_REGION = 32;

/** Deterministic verification budget, in compared nodes, for ONE structural
 * hash bucket (§5). A bucket that exhausts it is dropped whole: its
 * occurrences emit inline unchanged — a lost optimization, never a
 * correctness change. */
export const CSE_MAX_VERIFY_NODES_PER_BUCKET = 10_000;

// ---------------------------------------------------------------------------
// The lazy-operand inventory (§5.1(b))
// ---------------------------------------------------------------------------

/**
 * One conditionally-evaluated operand position of a construct: the operand
 * index that opens a region, whether that region may bind, and why.
 */
export interface LazyOperandSite {
  /** Operand index (0-based) that opens a region. */
  readonly index: number;
  /** `true` when the region never binds a temporary (Phase 1 exclusions). */
  readonly inert: boolean;
  /** Short provenance note, for diagnostics and drift tests. */
  readonly reason: string;
}

/**
 * A `LAZY_OPERANDS` entry: the shape-dependent set of operand positions whose
 * *emission* is conditional.
 *
 * Emitter-author contract (§5.1, §6.2): a construct with
 * conditionally-evaluated operand positions needs an entry here plus a
 * conditionality test. A missing entry is a soundness bug (a temp would be
 * hoisted out of an unevaluated arm); a spurious entry only costs
 * optimization.
 */
export interface LazyOperandEntry {
  /** Human-readable statement of the laziness this entry records. */
  readonly note: string;
  /** Regions opened by these positions never bind (Phase 1). */
  readonly inert?: boolean;
  /** The conditionally-evaluated operand indices, given the operand count. */
  readonly operands: (nops: number) => number[];
}

const from = (first: number) => (nops: number) => {
  const r: number[] = [];
  for (let i = first; i < nops; i++) r.push(i);
  return r;
};

/**
 * The declarative inventory of conditionally-evaluated operand positions
 * (§5.1(b)). Consumed by harvest (this module, to open static regions) and —
 * at a later stage — by emission, to push the matching region instances.
 *
 * Chained relations are NOT in the table: `a < m < b` lowers to
 * `(a<m) && (m<b)` with no `And` node in the boxed tree, so the shape is
 * recognized by {@link lazyOperandRegions} instead (relational operator with
 * more than two operands).
 */
export const LAZY_OPERANDS: Readonly<Record<string, LazyOperandEntry>> = {
  // `Which(cond1, value1, cond2, value2, …)`: only the FIRST condition
  // (operand 0) is unconditionally evaluated. Every value arm and every later
  // condition sits behind a ternary test.
  Which: {
    note: 'value arms and conditions after the first',
    operands: from(1),
  },
  // `If(cond, then, else)` — one condition, both arms lazy.
  If: { note: 'both value arms', operands: from(1) },
  // `When(value, cond)` lowers to `(cond) ? (value) : NaN`: the VALUE is the
  // conditional position; the single condition is eager.
  When: { note: 'the value arm', operands: () => [0] },
  And: { note: 'operands after the first (short circuit)', operands: from(1) },
  Or: { note: 'operands after the first (short circuit)', operands: from(1) },
  // Compiled coalescing evaluates the defaults lazily, left to right.
  Coalesce: { note: 'operands after the first', operands: from(1) },
  // `Match` is fully CSE-inert in Phase 1 (§2): its guards and bodies are
  // compiled from plan-constructed closure trees, not from the harvested
  // operands, so the occurrence machinery cannot see them.
  Match: {
    note: 'every operand position; Match is fully inert in Phase 1',
    inert: true,
    operands: from(0),
  },
};

/**
 * The operand positions of `expr` that open a region because their emission is
 * conditional (§5.1(b)). Empty for anything that is not a function
 * application, or whose operator evaluates all operands eagerly.
 */
export function lazyOperandRegions(
  expr: Expression | undefined | null
): readonly LazyOperandSite[] {
  if (!isFunction(expr)) return NO_LAZY_SITES;

  const entry = Object.prototype.hasOwnProperty.call(
    LAZY_OPERANDS,
    expr.operator
  )
    ? LAZY_OPERANDS[expr.operator]
    : undefined;

  if (entry !== undefined) {
    const inert = entry.inert === true;
    return entry
      .operands(expr.nops)
      .filter((i) => i >= 0 && i < expr.nops)
      .map((index) => ({ index, inert, reason: entry.note }));
  }

  // Chained relation: `a < m < b` lowers to `(a<m) && (m<b)`. Operand 1 is
  // evaluated by the FIRST comparison, so only operands from index 2 on are
  // conditional. Conservative for the mixed-operator chains the parser
  // produces as a single relational node.
  if (isRelationalOperator(expr.operator) && expr.nops > 2) {
    return from(2)(expr.nops).map((index) => ({
      index,
      inert: false,
      reason: 'comparison after the first in a chained relation',
    }));
  }

  return NO_LAZY_SITES;
}

const NO_LAZY_SITES: readonly LazyOperandSite[] = [];

// ---------------------------------------------------------------------------
// Output data model (§4.1, §5, §6.1)
// ---------------------------------------------------------------------------

export type CseRegionKind =
  /** The whole compiled expression. */
  | 'root'
  /** The body of a `scoped:` binder (`Sum`, `Integrate`, `Comprehension`, …). */
  | 'binder-body'
  /** A binder's clause/bound-variable operand — inert in Phase 1 (§2). */
  | 'binder-clause'
  /** The body of a `Function` literal. */
  | 'lambda-body'
  /** A `Function` literal's parameter list — inert. */
  | 'lambda-params'
  /** A conditionally-evaluated operand (the {@link LAZY_OPERANDS} table). */
  | 'lazy-operand'
  /** A `Block` statement list or an imperative `Loop` body — inert (§5.1(c)). */
  | 'statement-list'
  /** One statement's value expression — bindable (§5.1(c)). */
  | 'statement-value'
  /** A `scoped: true` operator with no declared binding sites — inert. */
  | 'opaque-scope';

/** Where a region attaches to the expression tree. */
export interface CseRegionSite {
  /** The node whose operand opens the region. */
  readonly node: Expression;
  /**
   * The operand index that opens the region, or `-1` when the region belongs
   * to the node as a whole (a `Block` statement list, a bare expression
   * statement).
   */
  readonly opIndex: number;
}

/**
 * A static region of the expression tree (§5.1). Regions form a tree;
 * candidates bind at a region's top, and no binding ever crosses a region
 * boundary — which is what makes name-keyed matching capture-sound and
 * selection laziness free.
 */
export interface CseRegion {
  /** Creation-ordered identity; stable for a given expression. */
  readonly id: number;
  readonly kind: CseRegionKind;
  /** `true` when this region never binds a temporary (Phase 1 exclusions). */
  readonly inert: boolean;
  readonly parent: CseRegion | undefined;
  readonly depth: number;
  readonly children: ReadonlyArray<CseRegion>;
  /** `undefined` for the root region. */
  readonly site: CseRegionSite | undefined;
  /** Names bound at this region's site (a binder's indices, a lambda's
   * parameters). Diagnostic — attribution itself is structural. */
  readonly boundNames: ReadonlyArray<string>;
  /**
   * Every symbol name that is the target of an `Assign`/`Declare` anywhere in
   * this region's subtree, **including all descendant regions** (§5.2 G3).
   */
  readonly assignedNames: ReadonlySet<string>;
  /** Surviving candidates that bind at this region, best score first. */
  readonly candidates: ReadonlyArray<CseCandidate>;
  /**
   * Emission lookup: is THIS node object an occurrence of a candidate of THIS
   * region? The same node object may appear in several regions' maps — that
   * is the point (§6.1): a shared node under a different region is not in
   * that region's candidate set, which resolves the DAG ambiguity.
   */
  readonly candidateByNode: ReadonlyMap<Expression, CseCandidate>;
}

/** One *edge-occurrence* of a subtree: a path, never a bare node object. */
export interface CseOccurrence {
  readonly node: Expression;
  /** The innermost enclosing region (§5.2). */
  readonly region: CseRegion;
  /** DFS enter/exit stamps — `a` is strictly inside `b` iff
   * `b.enter < a.enter && a.exit < b.exit` (O(1) containment). */
  readonly enter: number;
  readonly exit: number;
  /** Node count of the subtree. */
  readonly size: number;
}

/** A surviving common subexpression, bound at exactly one region. */
export interface CseCandidate {
  readonly id: number;
  /** The first-encountered node of the structural class. */
  readonly representative: Expression;
  /** Node count of the subtree. */
  readonly size: number;
  /** The region whose top binds this candidate. */
  readonly region: CseRegion;
  /** Occurrences attributed to `region`, in DFS order (≥ 2). */
  readonly occurrences: ReadonlyArray<CseOccurrence>;
  /** `(occurrences.length − 1) × size`. */
  readonly score: number;
  /** The distinct node objects those occurrences reach (a DAG collapses
   * several occurrences onto one object). */
  readonly nodes: ReadonlySet<Expression>;
}

/** Counters a caller (or a test) can assert on. Purely informational. */
export interface CseHarvestDiagnostics {
  /** Nodes visited, counting each edge separately. */
  readonly edges: number;
  /** Compound occurrences that passed G1 + G1b and the size prefilter. */
  readonly eligibleOccurrences: number;
  /** Structural hash buckets examined. */
  readonly buckets: number;
  /** Buckets dropped whole for exhausting the verification budget. */
  readonly exhaustedBuckets: number;
  /** Candidates dropped, by gate. */
  readonly droppedByMutation: number;
  readonly droppedBySubsumption: number;
  readonly droppedByThreshold: number;
  readonly droppedByRegionCap: number;
  /** Region-opening edges that collapsed onto an existing region because the
   * same node object opens the same edge twice within one region (a DAG). */
  readonly mergedRegionSites: number;
}

/** The result of {@link harvestCse}. */
export interface CseHarvest {
  readonly root: CseRegion;
  /** Every region, in creation order (`regions[0] === root`). */
  readonly regions: ReadonlyArray<CseRegion>;
  /** Every surviving candidate, across all regions, in region order. */
  readonly candidates: ReadonlyArray<CseCandidate>;
  /**
   * Every symbol name occurring anywhere in the tree — the collision
   * inventory the caller merges into its naming context (§4.1). Mutable by
   * design: the caller adds `_cse`/`_tv` tokens found in caller-supplied
   * source strings.
   */
  readonly usedNames: Set<string>;
  readonly diagnostics: CseHarvestDiagnostics;
}

/** Caller-supplied inputs to the emission-purity gate (§5.2 G1b). Provenance
 * is the caller's job: the registered-target `compile()` entries know the
 * override key sets, the resolver closures do not. */
export interface CseHarvestOptions {
  /** Does this operator name resolve through a caller-supplied `functions` or
   * `operators` entry? Such a mapping splices live source. */
  readonly isOverriddenOperator?: (name: string) => boolean;
  /** Is this symbol backed by a *string*-valued `vars` entry? (Non-string
   * `vars` are baked constants and are safe.) */
  readonly isStringVar?: (name: string) => boolean;
  /** Is this symbol a `vars` key AT ALL (of any value kind)? A `vars` entry
   * is the caller's external-input contract and WINS at emission over both
   * function-value routes (`isBoundOrMapped` in `BaseCompiler.compile`), so a
   * name that is a `vars` key is not the user function or built-in operator
   * it happens to be spelled like — the callback relaxations below must not
   * classify it on that premise. Broader than `isStringVar`: a non-string
   * `vars` entry is a safe baked constant for the SOURCE-splicing gate, but
   * it still overrides the name. */
  readonly isVarsKey?: (name: string) => boolean;

  /**
   * Admit PURE user-defined function applications as candidates (Tycho item
   * 120). Off by default for direct `harvestCse` callers, but set by BOTH
   * compiler harvest routes — the ROOT harvest (`openCseSession`) and the
   * NESTED harvest over an emitted `_fn_*` definition body, where a repeated
   * self-call (`R(i-1,x,y)` twice in one body) makes the compiled recursion
   * exponential. Purity is enforced by the record-time G1 gate
   * (`node.isPure`, the effects-model projection, which resolves through the
   * definition and its operands) plus a fresh per-level re-derivation over
   * the resolved callee body (`isAdmissibleUserFnCallee`), so an application
   * of a drawing/writing function stays inert. An admitted application is
   * also exempt from the size/score heuristics: a call's runtime cost is
   * unrelated to its syntactic size, and binding a twice-occurring call
   * always halves the calls (exponentially so under recursion).
   *
   * The flag additionally relaxes the opaque-callable-operand gate for a
   * bare-symbol callback that resolves to an ADMISSIBLE pure user-function
   * literal (`Map(f, xs)`), so such an application is no longer excluded on
   * account of its callback alone. Built-in operator names stay opaque.
   */
  readonly admitPureUserFunctions?: boolean;

  /**
   * Names that must NEVER be admitted as user-function callees nor relaxed as
   * named callbacks — the caller's enclosing binder/parameter names. A name
   * that is bound by an enclosing lambda resolves to that BINDING at run time,
   * while every lookup this module performs (`lookupDefinition`,
   * `_getSymbolValue`) is engine-GLOBAL, so a same-named global would be
   * validated in place of the actual callee. Fail closed instead.
   *
   * The harvester unions this set with the binder names it collects from the
   * harvested tree itself (a lambda whose parameter shadows a global is
   * visible there); the option covers the names bound OUTSIDE the tree — the
   * parameters of the definition whose body is being harvested (§5.4).
   */
  readonly shadowedNames?: ReadonlySet<string>;

  // Thresholds — defaulted from the exported constants; overridable so tests
  // and tuning runs need not restate the pipeline.
  readonly minSize?: number;
  readonly minScore?: number;
  readonly maxBindingsPerRegion?: number;
  readonly maxVerifyNodesPerBucket?: number;
}

// ---------------------------------------------------------------------------
// Emission-facing lookups (§6.1)
// ---------------------------------------------------------------------------

/**
 * The candidate, if any, that `node` is an occurrence of **within `region`**.
 * This is the exact question emission asks: it knows the current static region
 * and the node object it is about to compile.
 */
export function candidateAt(
  region: CseRegion | undefined,
  node: Expression
): CseCandidate | undefined {
  return region?.candidateByNode.get(node);
}

/**
 * The child region opened by `region`'s descendant edge `(node, opIndex)`, if
 * harvest opened one. Emission pushes a fresh *instance* of it when it
 * traverses that edge. Use `opIndex === -1` for a whole-node region (a `Block`
 * statement list, a bare expression statement).
 */
export function childRegionAt(
  region: CseRegion | undefined,
  node: Expression,
  opIndex: number
): CseRegion | undefined {
  if (region === undefined) return undefined;
  return (region as MutableRegion)._childByKey.get(regionKey(node, opIndex));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type MutableRegion = {
  -readonly [K in keyof CseRegion]: CseRegion[K];
} & {
  children: CseRegion[];
  assignedNames: Set<string>;
  candidates: CseCandidate[];
  candidateByNode: Map<Expression, CseCandidate>;
  /** `${nodeId}:${opIndex}` → child region. */
  _childByKey: Map<string, CseRegion>;
};

type MutableOccurrence = {
  -readonly [K in keyof CseOccurrence]: CseOccurrence[K];
};

/** A structural equivalence class within one hash bucket. */
type StructuralClass = {
  readonly representative: Expression;
  readonly size: number;
  readonly occurrences: MutableOccurrence[];
};

type HashBucket = {
  classes: StructuralClass[];
  /** Compared nodes charged so far. */
  spent: number;
  exhausted: boolean;
};

/**
 * Harvest the CSE regions, occurrences and candidates of `root` (§5).
 *
 * One edge-DFS: a node object reached through two parent positions is visited
 * twice and yields two occurrences, which is what makes DAG-shaped trees safe.
 * Sizes and eligibility are memoized per node object; occurrences carry DFS
 * enter/exit stamps so containment is O(1); every symbol name lands in
 * {@link CseHarvest.usedNames}.
 *
 * Pure analysis: nothing in `root` is mutated and no expression is evaluated.
 */
export function harvestCse(
  root: Expression,
  options: CseHarvestOptions = {}
): CseHarvest {
  return new Harvester(root, options).run();
}

class Harvester {
  private readonly engine: ComputeEngine;
  private readonly isOverriddenOperator: (name: string) => boolean;
  private readonly isStringVar: (name: string) => boolean;
  private readonly isVarsKey: (name: string) => boolean;
  private readonly admitPureUserFunctions: boolean;
  /** Names no admission decision may resolve globally — see
   * `CseHarvestOptions.shadowedNames`. Filled once, in a prepass, BEFORE any
   * eligibility check runs: the admission memos are name-keyed, so the set
   * must be fixed for the whole harvest. */
  private readonly shadowedNames: Set<string>;
  private readonly minSize: number;
  private readonly minScore: number;
  private readonly maxBindingsPerRegion: number;
  private readonly maxVerifyNodesPerBucket: number;

  private readonly usedNames = new Set<string>();
  private readonly regions: MutableRegion[] = [];
  private readonly occurrences: MutableOccurrence[] = [];
  private readonly regionStack: MutableRegion[] = [];

  private readonly sizeMemo = new Map<Expression, number>();
  private readonly eligibleMemo = new Map<Expression, boolean>();
  private readonly userFnMemo = new Map<string, boolean>();
  private readonly calleeVerdictMemo = new Map<string, boolean>();
  private readonly calleeBodyCleanMemo = new Map<Expression, boolean>();
  private readonly calleeInProgress = new Set<string>();
  /** Count of neutral (re-entrant) callee edges taken — monotonic, compared
   * before/after a computation to decide whether its result may memoize. */
  private calleeNeutralEdges = 0;
  private readonly compileHandlerMemo = new Map<string, boolean>();
  private readonly opaqueOperandMemo = new Map<Expression, boolean>();
  private readonly opaqueSymbolMemo = new Map<string, boolean>();
  private readonly builtinCallbackMemo = new Map<string, boolean>();
  private readonly symbolsMemo = new Map<Expression, Set<string>>();

  private clock = 0;
  private edges = 0;
  private mergedRegionSites = 0;
  private droppedByMutation = 0;
  private droppedBySubsumption = 0;
  private droppedByThreshold = 0;
  private droppedByRegionCap = 0;
  private exhaustedBuckets = 0;
  private buckets = 0;
  private nextCandidateId = 0;

  constructor(
    private readonly root: Expression,
    options: CseHarvestOptions
  ) {
    this.engine = root.engine as ComputeEngine;
    this.isOverriddenOperator = options.isOverriddenOperator ?? (() => false);
    this.isStringVar = options.isStringVar ?? (() => false);
    this.isVarsKey = options.isVarsKey ?? (() => false);
    this.admitPureUserFunctions = options.admitPureUserFunctions === true;
    this.shadowedNames = new Set(options.shadowedNames ?? []);
    this.minSize = options.minSize ?? CSE_MIN_SIZE;
    this.minScore = options.minScore ?? CSE_MIN_SCORE;
    this.maxBindingsPerRegion =
      options.maxBindingsPerRegion ?? CSE_MAX_BINDINGS_PER_REGION;
    this.maxVerifyNodesPerBucket =
      options.maxVerifyNodesPerBucket ?? CSE_MAX_VERIFY_NODES_PER_BUCKET;
  }

  run(): CseHarvest {
    this.collectShadowedNames(this.root, new Set<Expression>());

    const rootRegion = this.createRegion(undefined, 'root', false, undefined, [
      // no bound names at the root
    ]);
    this.regionStack.push(rootRegion);
    this.walk(this.root, rootRegion, false, false);
    this.regionStack.pop();

    const candidates = this.selectCandidates();

    return {
      root: rootRegion,
      regions: this.regions,
      candidates,
      usedNames: this.usedNames,
      diagnostics: {
        edges: this.edges,
        eligibleOccurrences: this.occurrences.length,
        buckets: this.buckets,
        exhaustedBuckets: this.exhaustedBuckets,
        droppedByMutation: this.droppedByMutation,
        droppedBySubsumption: this.droppedBySubsumption,
        droppedByThreshold: this.droppedByThreshold,
        droppedByRegionCap: this.droppedByRegionCap,
        mergedRegionSites: this.mergedRegionSites,
      },
    };
  }

  /**
   * Collect every binder-bound name occurring ANYWHERE in the tree into
   * {@link shadowedNames} — the same two sources the walk uses to compute a
   * region's `boundNames` (a `Function` literal's parameters, a `scoped:`
   * definition's binding sites; see `walkOperands`/`operandPlans`).
   *
   * Deliberately a prepass rather than an incremental collection during the
   * main walk: eligibility (and with it `isAdmissibleUserFnCallee`, whose
   * verdicts are memoized per NAME) runs at node exit, so a name bound in a
   * region visited later must already be known when the first verdict for it
   * is cached. Whole-tree, not scope-accurate: over-approximating the shadow
   * set only ever refuses a merge.
   */
  private collectShadowedNames(node: Expression, seen: Set<Expression>): void {
    if (!isFunction(node) || seen.has(node)) return;
    seen.add(node);
    if (node.operator === 'Function') {
      for (const name of functionLiteralParamNames(node))
        this.shadowedNames.add(name);
    } else {
      const def = node.operatorDefinition;
      if (def?.scoped === true)
        for (const name of binderSplit(def, node).boundNames)
          this.shadowedNames.add(name);
    }
    for (const op of node.ops) this.collectShadowedNames(op, seen);
  }

  // -------------------------------------------------------------------------
  // Region construction
  // -------------------------------------------------------------------------

  private createRegion(
    parent: MutableRegion | undefined,
    kind: CseRegionKind,
    inert: boolean,
    site: CseRegionSite | undefined,
    boundNames: string[]
  ): MutableRegion {
    const region: MutableRegion = {
      id: this.regions.length,
      kind,
      // An inert parent cannot host a bindable child by accident: inertness of
      // a STATEMENT LIST does not propagate (§5.1(c) — inertness applies to
      // the list, not to its leaves), so it is set per site, not inherited.
      inert,
      parent,
      depth: parent === undefined ? 0 : parent.depth + 1,
      children: [],
      site,
      boundNames,
      assignedNames: new Set<string>(),
      candidates: [],
      candidateByNode: new Map<Expression, CseCandidate>(),
      _childByKey: new Map<string, CseRegion>(),
    };
    this.regions.push(region);
    parent?.children.push(region);
    return region;
  }

  /**
   * The region opened by edge `(node, opIndex)` of `parent`, creating it on
   * first use.
   *
   * A node object reached twice within ONE region opens the same edge twice;
   * the two static regions would be structurally identical, so they are
   * merged. Emission pushes a fresh instance per traversal either way, so a
   * merged region can at worst bind a temp that one instance uses only once —
   * a benefit loss, never a correctness change.
   */
  private openRegion(
    parent: MutableRegion,
    node: Expression,
    opIndex: number,
    kind: CseRegionKind,
    inert: boolean,
    boundNames: string[] = []
  ): MutableRegion {
    const key = regionKey(node, opIndex);
    const existing = parent._childByKey.get(key);
    if (existing !== undefined) {
      this.mergedRegionSites += 1;
      return existing as MutableRegion;
    }
    const region = this.createRegion(parent, kind, inert, { node, opIndex }, [
      ...boundNames,
    ]);
    parent._childByKey.set(key, region);
    return region;
  }

  // -------------------------------------------------------------------------
  // The edge-DFS
  // -------------------------------------------------------------------------

  /**
   * @param asStatement the node sits in a statement position of a `Block` or
   * imperative `Loop` body: its VALUE expressions become bindable child
   * regions, but the statement list itself never binds (§5.1(c)).
   */
  private walk(
    node: Expression,
    region: MutableRegion,
    underMapped: boolean,
    asStatement: boolean
  ): void {
    this.edges += 1;
    const enter = this.clock++;

    if (isSymbol(node)) this.usedNames.add(node.symbol);

    if (isFunction(node)) {
      this.recordAssignment(node);

      const nextUnderMapped =
        underMapped ||
        this.isOverriddenOperator(node.operator) ||
        this.hasCallerCompileHandler(node);

      if (asStatement && this.walkStatement(node, region, nextUnderMapped)) {
        // handled as a statement
      } else {
        this.walkOperands(node, region, nextUnderMapped);
      }
    }

    const exit = this.clock++;

    // G1 (purity) and G1b (emission purity) are applied at record time:
    // an occurrence that fails them never enters the bucket machinery, and an
    // occurrence BELOW a caller-mapped operator never counts at all.
    //
    // The `size` prefilter is G4's first clause hoisted forward. Doing it here
    // is outcome-equivalent (size is fixed per node and no later gate can
    // resurrect a too-small candidate, nor can a dropped candidate change
    // another's fate — subsumption only ever drops the SUBSUMED one) and it
    // keeps the verification buckets from filling with trivia.
    if (
      isFunction(node) &&
      !underMapped &&
      node.isPure &&
      (this.sizeOf(node) >= this.minSize || this.isAdmittedUserFnApp(node)) &&
      this.isEligible(node)
    ) {
      this.occurrences.push({
        node,
        region,
        enter,
        exit,
        size: this.sizeOf(node),
      });
    }
  }

  /**
   * An admitted pure user-function application (see
   * `CseHarvestOptions.admitPureUserFunctions`). Exempt from the size/score
   * heuristics: a call's runtime cost is unrelated to its syntactic size —
   * `F(n)` is 2 nodes, and under recursion a repeated call is an exponential
   * blowup (item 120) — so a twice-occurring pure call is always worth
   * binding. Purity itself is the caller's `node.isPure` check (G1).
   */
  private isAdmittedUserFnApp(node: Expression): boolean {
    return (
      this.admitPureUserFunctions &&
      isFunction(node) &&
      this.isUserFunctionApplication(node)
    );
  }

  /** Record `Assign`/`Declare` targets into every region on the stack: a
   * candidate of region R is dropped when the name is assigned anywhere in
   * R's subtree, descendant regions included (§5.2 G3).
   *
   * A DESTRUCTURING target (`Declare(Tuple(a, b), …)`) writes every leaf
   * symbol of the pattern, so the pattern is walked rather than tested for
   * symbol-hood. */
  private recordAssignment(node: Expression & FunctionInterface): void {
    if (node.operator !== 'Assign' && node.operator !== 'Declare') return;
    this.recordAssignedTarget(node.ops[0]);
  }

  private recordAssignedTarget(target: Expression | undefined): void {
    if (target === undefined) return;
    if (isSymbol(target)) {
      for (const r of this.regionStack) r.assignedNames.add(target.symbol);
      return;
    }
    if (isFunction(target, 'Tuple'))
      for (const leaf of target.ops) this.recordAssignedTarget(leaf);
  }

  private pushRegion(region: MutableRegion): void {
    this.regionStack.push(region);
  }

  private popRegion(): void {
    this.regionStack.pop();
  }

  private descend(
    node: Expression,
    region: MutableRegion,
    underMapped: boolean,
    asStatement = false
  ): void {
    this.pushRegion(region);
    this.walk(node, region, underMapped, asStatement);
    this.popRegion();
  }

  /**
   * Statement-position decomposition (§5.1(c)). Returns `true` when the node
   * was consumed here.
   *
   * `region` is the enclosing (inert) statement-list region; each of the
   * statement's own value expressions becomes a bindable child region, so
   * `Assign(x, f(y) + f(y))` inside a loop deduplicates `f(y)` within its RHS
   * while nothing ever binds across statements.
   */
  private walkStatement(
    node: Expression & FunctionInterface,
    region: MutableRegion,
    underMapped: boolean
  ): boolean {
    const op = node.operator;

    if (op === 'Assign') {
      // Operand 0 is the assignment TARGET, not a value.
      if (node.ops[0] !== undefined)
        this.walk(node.ops[0], region, underMapped, false);
      for (let i = 1; i < node.nops; i++)
        this.descend(
          node.ops[i],
          this.openRegion(region, node, i, 'statement-value', false),
          underMapped
        );
      return true;
    }

    if (op === 'Declare') {
      if (node.ops[0] !== undefined)
        this.walk(node.ops[0], region, underMapped, false);
      for (let i = 1; i < node.nops; i++) {
        const operand = node.ops[i];
        // The type ascription is a string literal, not a value expression.
        if (isString(operand)) {
          this.walk(operand, region, underMapped, false);
          continue;
        }
        this.descend(
          operand,
          this.openRegion(region, node, i, 'statement-value', false),
          underMapped
        );
      }
      return true;
    }

    if (op === 'Return') {
      for (let i = 0; i < node.nops; i++)
        this.descend(
          node.ops[i],
          this.openRegion(region, node, i, 'statement-value', false),
          underMapped
        );
      return true;
    }

    if (op === 'If') {
      // Statement-form `If`: the condition is a value expression; the branches
      // are statement lists again.
      if (node.ops[0] !== undefined)
        this.descend(
          node.ops[0],
          this.openRegion(region, node, 0, 'statement-value', false),
          underMapped
        );
      for (let i = 1; i < node.nops; i++)
        this.descend(
          node.ops[i],
          this.openRegion(region, node, i, 'statement-list', true),
          underMapped,
          true
        );
      return true;
    }

    // A nested block or loop is its own statement list; the abrupt-control
    // heads carry no bindable value of their own beyond their operand, which
    // the generic walk reaches inside the (inert) list region.
    if (op === 'Block' || op === 'Loop' || op === 'Break' || op === 'Continue')
      return false;

    // A bare expression statement is its own bindable region.
    this.descend(
      node,
      this.openRegion(region, node, -1, 'statement-value', false),
      underMapped
    );
    return true;
  }

  private walkOperands(
    node: Expression & FunctionInterface,
    region: MutableRegion,
    underMapped: boolean
  ): void {
    const op = node.operator;

    // (c) `Block`: the statement LIST is one inert region; each statement's
    // value expressions are bindable child regions.
    if (op === 'Block') {
      const list = this.openRegion(region, node, -1, 'statement-list', true);
      for (let i = 0; i < node.nops; i++)
        this.descend(node.ops[i], list, underMapped, true);
      return;
    }

    // (a) `Function` literal: the body is a bindable region; the parameter
    // list is inert (it is binding structure, not value code).
    if (op === 'Function') {
      const params = functionLiteralParamNames(node);
      if (node.ops[0] !== undefined)
        this.descend(
          node.ops[0],
          this.openRegion(region, node, 0, 'lambda-body', false, params),
          underMapped
        );
      if (node.nops > 1) {
        const paramRegion = this.openRegion(
          region,
          node,
          1,
          'lambda-params',
          true,
          params
        );
        for (let i = 1; i < node.nops; i++)
          this.descend(node.ops[i], paramRegion, underMapped);
      }
      return;
    }

    // (c) imperative `Loop`: the body is a statement list (inert); the
    // iterator clauses are inert binder clauses.
    if (op === 'Loop') {
      if (node.ops[0] !== undefined)
        this.descend(
          node.ops[0],
          this.openRegion(region, node, 0, 'statement-list', true),
          underMapped,
          true
        );
      for (let i = 1; i < node.nops; i++)
        this.descend(
          node.ops[i],
          this.openRegion(region, node, i, 'binder-clause', true),
          underMapped
        );
      return;
    }

    const plans = this.operandPlans(node);
    for (let i = 0; i < node.nops; i++) {
      const plan = plans[i];
      if (plan === undefined) {
        this.walk(node.ops[i], region, underMapped, false);
        continue;
      }
      this.descend(
        node.ops[i],
        this.openRegion(
          region,
          node,
          i,
          plan.kind,
          plan.inert,
          plan.boundNames
        ),
        underMapped
      );
    }
  }

  /**
   * Per-operand region plan for a generic node: binder sites first (§5.1(a)),
   * then the lazy-operand inventory (§5.1(b)), which may add a region to an
   * operand a binder rule already claimed.
   *
   * The binder body/clause split is derived from the definition's `scoped`
   * binding-site SELECTOR, never from an operator-name list: the operand
   * indices the selector points at (and everything after the first of them)
   * are clause/bound operands — `Sum`/`Product`/comprehensions put the body at
   * operand 0 with `Limits`/clauses after — and are inert in Phase 1 (§2).
   * A `scoped: true` operator with no selector declares a scope whose bound
   * variables are unknown here, so all of its operands are inert.
   */
  private operandPlans(
    node: Expression & FunctionInterface
  ): (OperandPlan | undefined)[] {
    const plans: (OperandPlan | undefined)[] = new Array(node.nops).fill(
      undefined
    );

    const def: BoxedOperatorDefinition | undefined = node.operatorDefinition;
    if (def?.scoped === true) {
      // Harvest opens a bindable body region for EVERY scoped binder, but
      // emission only wires three of them through `compileOp`: `Sum`,
      // `Product` and the `Function` literal. Every other binder body
      // (`Integrate`, the comprehensions, …) is emitted under a target whose
      // `boundVars` the enclosing instance does not describe, so the
      // blind-instance guard in `compileWithCse` degrades it to the pre-CSE
      // emission — sound, at the cost of a wasted harvest. Wiring the rest is
      // v2 (design §11).
      const { firstClause, boundNames } = binderSplit(def, node);
      for (let i = 0; i < node.nops; i++)
        plans[i] =
          i < firstClause
            ? { kind: 'binder-body', inert: false, boundNames }
            : {
                kind: firstClause === 0 ? 'opaque-scope' : 'binder-clause',
                inert: true,
                boundNames,
              };
    }

    for (const site of lazyOperandRegions(node)) {
      const current = plans[site.index];
      plans[site.index] = {
        kind: current?.inert ? current.kind : 'lazy-operand',
        // An operand that is inert for EITHER reason stays inert.
        inert: site.inert || (current?.inert ?? false),
        boundNames: current?.boundNames ?? [],
      };
    }

    return plans;
  }

  // -------------------------------------------------------------------------
  // Memoized per-node facts
  // -------------------------------------------------------------------------

  private sizeOf(node: Expression): number {
    const cached = this.sizeMemo.get(node);
    if (cached !== undefined) return cached;
    let size = 1;
    if (isFunction(node)) for (const op of node.ops) size += this.sizeOf(op);
    this.sizeMemo.set(node, size);
    return size;
  }

  /** Every symbol name occurring in the subtree. A conservative superset of
   * the free variables (bound indices are included), which only ever makes
   * G3 stricter. */
  private symbolsOf(node: Expression): Set<string> {
    const cached = this.symbolsMemo.get(node);
    if (cached !== undefined) return cached;
    const names = new Set<string>();
    if (isSymbol(node)) names.add(node.symbol);
    else if (isFunction(node))
      for (const op of node.ops)
        for (const n of this.symbolsOf(op)) names.add(n);
    this.symbolsMemo.set(node, names);
    return names;
  }

  /**
   * G1b — emission purity (§5.2). `isPure` describes the boxed operator, not
   * the emitted code. A subtree is eligible when NOTHING in it is:
   *
   * - a node resolving through a caller-supplied `functions`/`operators`
   *   entry, a caller-supplied per-operator `compile` handler on its
   *   definition, or a *string*-valued `vars` symbol (all three splice live
   *   source); a BUILT-IN definition's `compile` handler is exempt — it is
   *   engine-authored emission, the same trust class as the built-in table
   *   mappings;
   * - a user-defined function application — unless the harvest opts in via
   *   `admitPureUserFunctions` (both compiler harvest routes, item 120),
   *   in which case the resolved callee's BODY is validated transitively
   *   (`isAdmissibleUserFnCallee`): the same emission-purity gates plus a
   *   fresh per-level semantic-purity check, because the application node's
   *   own `isPure` can be install-time stale one level removed
   *   (`docs/EFFECTS-MODEL.md`);
   * - an application whose operator position is not a fixed built-in;
   * - an application with a function-valued operand that is not an inline
   *   `Function` literal (a named callback is invisible to purity inference,
   *   so `Map(f, xs)` can report pure while `f` draws).
   *
   * Bottom-up and memoized per node object.
   */
  private isEligible(node: Expression): boolean {
    const cached = this.eligibleMemo.get(node);
    if (cached !== undefined) return cached;

    // Provisional `false` guards against a self-referential tree: the boxed
    // graph is acyclic, so this only ever fires on pathological input, and it
    // must fail CLOSED — a cycle means "not eligible", never "eligible".
    this.eligibleMemo.set(node, false);
    const result = this.computeEligible(node);
    this.eligibleMemo.set(node, result);
    return result;
  }

  private computeEligible(node: Expression): boolean {
    if (isSymbol(node)) return !this.isStringVar(node.symbol);
    if (!isFunction(node)) return true;

    // An `Error` node is a diagnostic, not a computation: it never emits, so
    // hoisting a subtree that contains one would mint a candidate whose body
    // the emission gate is bound to refuse. Refusing it here keeps a harvest
    // over an invalid tree (a statically rejected callback, say) empty rather
    // than a set of unemittable candidates.
    if (node.operator === 'Error') return false;

    if (this.isOverriddenOperator(node.operator)) return false;
    // A CALLER-supplied per-operator `compile` handler is the definition-level
    // twin of a `functions` entry: `BaseCompiler.compileExpr` consults it
    // before any built-in mapping and splices whatever source it returns, while
    // the definition itself defaults to `pure: true`. A built-in definition's
    // handler is exempt (see `hasCallerCompileHandler`).
    if (this.hasCallerCompileHandler(node)) return false;
    // A user-defined function application is admissible only where the
    // harvest opts in (`admitPureUserFunctions` — both compiler harvest
    // routes, Tycho item 120) AND its resolved callee's body validates
    // transitively (`isAdmissibleUserFnCallee` — the call site alone proves
    // nothing about what the emitted body splices or draws). Checked BEFORE
    // the fixed-built-in gate below: the declare-then-assign route stores the
    // lambda as a VALUE definition, so its application nodes carry no
    // *operator* definition — the gate below would reject them before this
    // clause ever admitted one.
    if (this.isUserFunctionApplication(node)) {
      if (!this.admitPureUserFunctions) return false;
      if (!this.isAdmissibleUserFnCallee(node.operator)) return false;
    }
    // Not a fixed built-in: `Apply` with a symbolic head, a parameter used as
    // a function, an unbound application.
    else if (node.operatorDefinition === undefined) return false;

    for (const operand of node.ops)
      if (this.isOpaqueCallableOperand(operand)) return false;

    for (const operand of node.ops) if (!this.isEligible(operand)) return false;

    return true;
  }

  /**
   * Does this head carry a **caller-supplied** per-operator `compile` handler
   * (§5.2 G1b)?
   *
   * `BaseCompiler.compileExpr` consults `def.operator.compile` BEFORE any
   * built-in mapping and emits whatever source it returns, so the handler is a
   * caller-controlled splice exactly like a `functions` entry — and an operator
   * definition defaults to `pure: true`, so G1 does not catch it. Both channels
   * are checked: the node's own definition, and (for a head whose node did not
   * bind) the engine lookup the compiler itself performs.
   *
   * **Built-in exemption (2026-08-01).** The clause exists because
   * `ce.declare(name, { compile })` is the same caller-supplied splice channel
   * as a `functions` entry: the emitted code's purity is unknowable. A
   * BUILT-IN definition's handler is engine-authored, deterministic,
   * effect-free emission — exactly like the built-in TABLE mappings (`Sin`,
   * `Add`), which were never under-mapped nor ineligible. Hoisting a pure
   * subtree across a built-in table emission is already sanctioned; a built-in
   * definition handler is the same trust class. G1 (`node.isPure`)
   * independently excludes impure operators, so the exemption rides on the
   * same purity guarantee the table path always relied on. Provenance test:
   * the definition carrying the handler IS the system-scope binding for that
   * name (object identity — the sanctioned test, mirroring
   * `engine-declarations.ts`). A user `ce.declare(name, { compile })` in any
   * non-system scope, and a user definition SHADOWING a built-in name (not
   * identity-equal to the system binding), both stay ineligible. So is a
   * definition installed by a CALLER-supplied library (constructor `libraries`
   * option): those land in the system scope as well, and are told apart by the
   * provenance recorded at bootstrap (`engine._customLibraryOperators`).
   *
   * Memoized per operator NAME, like `isUserFunctionApplication`: the memo
   * lives on the `Harvester` instance (one per harvest) and engine scope state
   * is constant for the duration of one harvest, so name-keying is sound even
   * though the classification now consults the scope chain.
   */
  private hasCallerCompileHandler(
    node: Expression & FunctionInterface
  ): boolean {
    const id = node.operator;
    const cached = this.compileHandlerMemo.get(id);
    if (cached !== undefined) return cached;

    // A CALLER-supplied library passed to the constructor's `libraries` option
    // is installed in the SYSTEM scope too (bootstrap runs between
    // `pushScope('system')` and `pushScope('global')`), so scope identity alone
    // would misclassify a caller-authored handler as engine-authored. The
    // provenance recorded at bootstrap overrides the scope test: no system
    // binding is offered for such a name, so both channels below classify it as
    // a caller handler. The set is fixed once the engine is constructed, so the
    // memo stays valid. (Shared with the built-in-callback predicates, which
    // apply the same provenance test — `builtin-callback.ts`.)
    const systemDef = systemScopeBinding(this.engine, id);

    let result = false;
    const ownDef = node.operatorDefinition;
    if (typeof ownDef?.compile === 'function') {
      // Exempt only when the definition the handler sits on IS the built-in.
      result = !(isOperatorDef(systemDef) && systemDef.operator === ownDef);
    }
    if (!result) {
      const def = this.engine.lookupDefinition(id);
      result =
        def !== undefined &&
        isOperatorDef(def) &&
        typeof def.operator.compile === 'function' &&
        def !== systemDef;
    }
    this.compileHandlerMemo.set(id, result);
    return result;
  }

  /**
   * Is `id` safe to ADMIT as a merged call target? The call site alone
   * proves nothing about what the emitted `_fn_id` BODY does, so the
   * resolved literal body is validated transitively (review findings on
   * item 120, both confirmed by reproduction):
   *
   * - **Emission purity**: the body is walked through the same
   *   `isEligible` gates as the harvested tree — a string-`vars` symbol,
   *   an overridden operator, or a caller compile handler INSIDE the body
   *   splices live source into `_fn_id`, and merging two calls would merge
   *   two live evaluations (`f(t) := u+t` with `vars: {u: 'next()'}`).
   * - **Fresh semantic purity**: `body.isPure` is re-derived per level —
   *   the application node's own `isPure` consults the caller's INSTALLED
   *   signature, which goes stale one level removed (`h` calling a `k`
   *   later reassigned to draw: the `k`-application is impure, but `h`'s
   *   installed signature still says pure). Nested user-fn applications in
   *   the body recurse back through this gate, so each level's body is
   *   checked against CURRENT bindings.
   *
   * Recursion: a re-entrant edge to a name already being validated is
   * NEUTRAL (report admissible and let the enclosing walk finish — the
   * plain self-recursive case, item 120's flagship). A verdict that leaned
   * on a neutral edge to a partner still in flight (mutual recursion) is
   * PROVISIONAL and not memoized, so a later standalone query recomputes it
   * against the partner's final verdict; the outermost verdict of a cycle
   * is final and memoizes.
   */
  private isAdmissibleUserFnCallee(id: string): boolean {
    // A name bound by an enclosing binder/parameter resolves to that binding
    // at run time, but every lookup below is engine-GLOBAL: validating the
    // same-named global would answer a question about the wrong callee. Fail
    // closed (§5.2). The set is fixed for the whole harvest, so the verdict is
    // still name-memoizable.
    if (this.shadowedNames.has(id)) return false;
    const cached = this.calleeVerdictMemo.get(id);
    if (cached !== undefined) return cached;
    if (this.calleeInProgress.has(id)) {
      this.calleeNeutralEdges += 1;
      return true;
    }
    const body = this.userFnLiteralBody(id);
    if (body === undefined) {
      // No resolvable literal — fail closed.
      this.calleeVerdictMemo.set(id, false);
      return false;
    }
    this.calleeInProgress.add(id);
    const before = this.calleeNeutralEdges;
    let result: boolean;
    try {
      // `calleeBodyClean`, not `isEligible`: the candidate application node
      // may itself SIT in the body being validated (a self-call candidate in
      // a nested definition-body harvest), and `isEligible`'s node-level
      // provisional-`false` cycle guard would read that in-flight marker and
      // reject the whole body. The dedicated walker applies the same gates
      // with name-level cycle handling instead.
      result = body.isPure && this.calleeBodyClean(body);
    } finally {
      this.calleeInProgress.delete(id);
    }
    if (this.calleeNeutralEdges === before || this.calleeInProgress.size === 0)
      this.calleeVerdictMemo.set(id, result);
    return result;
  }

  /**
   * The emission-purity scan over a callee's BODY — the same gates as
   * `computeEligible` (string-`vars` symbols, overridden operators, caller
   * compile handlers, unbound applications, opaque callable operands, and
   * recursive validation of nested user-function callees), but WITHOUT
   * `isEligible`'s node-level provisional-`false` cycle guard: the body of a
   * self-recursive callee contains the very application node whose
   * eligibility triggered this scan, and reading its in-flight marker would
   * fail-close every recursive callee. The boxed tree is acyclic, so plain
   * structural recursion terminates; recursion through DEFINITIONS is
   * handled at the name level by `isAdmissibleUserFnCallee`.
   */
  private calleeBodyClean(node: Expression): boolean {
    const cached = this.calleeBodyCleanMemo.get(node);
    if (cached !== undefined) return cached;
    const before = this.calleeNeutralEdges;
    let result: boolean;
    if (isSymbol(node)) result = !this.isStringVar(node.symbol);
    else if (!isFunction(node)) result = true;
    else if (this.isOverriddenOperator(node.operator)) result = false;
    else if (this.hasCallerCompileHandler(node)) result = false;
    else if (
      this.isUserFunctionApplication(node)
        ? !this.isAdmissibleUserFnCallee(node.operator)
        : node.operatorDefinition === undefined
    )
      result = false;
    else
      result =
        !node.ops.some((op) => this.isOpaqueCallableOperand(op)) &&
        node.ops.every((op) => this.calleeBodyClean(op));
    // A verdict that leaned on a neutral (re-entrant) callee edge is
    // provisional — same discipline as `calleeVerdictMemo`.
    if (this.calleeNeutralEdges === before)
      this.calleeBodyCleanMemo.set(node, result);
    return result;
  }

  /**
   * The body of the `Function` literal `id` resolves to, or `undefined`.
   * Same resolution as `isUserFunctionApplication` below.
   */
  private userFnLiteralBody(id: string): Expression | undefined {
    const def = this.engine.lookupDefinition(id);
    if (def !== undefined && isOperatorDef(def)) {
      const literal = (def.operator as { _lambdaLiteral?: Expression })
        ._lambdaLiteral;
      if (literal !== undefined && isFunction(literal, 'Function'))
        return literal.ops[0];
    }
    const value = this.engine._getSymbolValue(id);
    if (value !== undefined && isFunction(value, 'Function'))
      return value.ops[0];
    return undefined;
  }

  /**
   * Does `name` resolve to a user-defined function literal? Mirrors
   * `BaseCompiler.userFunctionLiteral` (an operator definition minted from a
   * lambda, or a symbol whose value is a `Function` literal) WITHOUT importing
   * the compiler — the dependency direction is base-compiler → cse.
   */
  private isUserFunctionApplication(
    node: Expression & FunctionInterface
  ): boolean {
    // Depends only on the operator NAME and engine state, both constant for
    // the duration of one harvest — memoized per name (the definition
    // lookups dominated harvest overhead on candidate-free trees).
    const id = node.operator;
    const cached = this.userFnMemo.get(id);
    if (cached !== undefined) return cached;

    let result = false;
    const def = this.engine.lookupDefinition(id);
    if (def !== undefined && isOperatorDef(def)) {
      const literal = (def.operator as { _lambdaLiteral?: Expression })
        ._lambdaLiteral;
      if (literal !== undefined && isFunction(literal, 'Function'))
        result = true;
    }
    if (!result) {
      const value = this.engine._getSymbolValue(id);
      result = value !== undefined && isFunction(value, 'Function');
    }
    this.userFnMemo.set(id, result);
    return result;
  }

  /**
   * A function-valued operand that is NOT an inline `Function` literal — a
   * named callback, a parameter, an opaque function value. Derived from the
   * operand, never from an operator list.
   *
   * The type is authoritative when it is known; a HELD operand of a lazy
   * operator may arrive with a `unknown` type (`Map(f, xs)` holds `f`
   * unbound), so a bare symbol also consults the engine definition.
   */
  private isOpaqueCallableOperand(operand: Expression): boolean {
    // Memoized per node object: a shared operand is re-checked once per
    // parent, and the `type.matches` + definition lookups are measurable on
    // large candidate-free trees. Engine state is constant during a harvest.
    const cached = this.opaqueOperandMemo.get(operand);
    if (cached !== undefined) return cached;
    const before = this.calleeNeutralEdges;
    const result = this.computeOpaqueCallableOperand(operand);
    // A verdict that leaned on a neutral (re-entrant) callee edge — reachable
    // through the named-callback relaxation below — is provisional, same
    // discipline as `calleeVerdictMemo`.
    if (this.calleeNeutralEdges === before)
      this.opaqueOperandMemo.set(operand, result);
    return result;
  }

  private computeOpaqueCallableOperand(operand: Expression): boolean {
    if (isFunction(operand, 'Function')) return false;
    if (!isSymbol(operand)) return operand.type.matches('function');

    const name = operand.symbol;
    // A NAMED callback that resolves to a user-function LITERAL is no longer
    // invisible where the harvest admits pure user functions: the same
    // transitive gate applied to a call site (`isAdmissibleUserFnCallee` —
    // fresh per-level `body.isPure` plus the emission-purity scan) answers
    // "what does `f` do?" for `Map(f, xs)` too, and G1 (`node.isPure`) still
    // gates the whole application. Tested BEFORE the type gate below: a
    // DECLARED callback (`CountIf(xs, p)` with `p: (number) -> boolean`)
    // carries a function-matching type on the operand node itself, which
    // would otherwise reject it before its literal was ever consulted. A
    // SHADOWED name resolves to an enclosing binding, not to the global this
    // would validate, so it is refused; likewise a `vars` KEY, which wins at
    // emission over both function-value routes, so the literal this would
    // validate is not what the artifact calls. A symbol resolving to a
    // BUILT-IN operator definition has no literal and is handled by the
    // clause below.
    if (
      this.admitPureUserFunctions &&
      !this.shadowedNames.has(name) &&
      !this.isVarsKey(name) &&
      this.userFnLiteralBody(name) !== undefined &&
      this.isAdmissibleUserFnCallee(name)
    )
      return false;

    // A callback naming a PURE BUILT-IN operator (`Map(Sin, xs)`,
    // `CountIf(xs, IsPrime)`) is likewise no longer invisible: the compiler
    // eta-expands it into `(p) ↦ Sin(p)` and emits it as a shared local
    // (`BaseCompiler.ensureBuiltinCallbackEmitted`), so what it does is
    // exactly the built-in's own deterministic, effect-free emission — the
    // same trust class as the table mapping an inline `x ↦ Sin(x)` callback
    // would have gone through. Admitted only when ALL hold, mirroring
    // emission so an operand that cannot emit never becomes CSE-eligible:
    // the name is not shadowed, it is not a `vars` key (the caller's external
    // input wins at emission, so the artifact does not call the built-in at
    // all), it is not a caller `functions`/`operators` override (unknowable
    // emitted purity — must stay opaque for MERGING even though emission does
    // route through it), it resolves to the engine-authored system-scope
    // definition, it is `pure`, and it is eta-expandable at its required
    // arity (`Random` and the variadic operators decline). Same
    // tested-before-the-type-gate reason as above. Name-keyed memo: every
    // input is constant for one harvest.
    if (
      this.admitPureUserFunctions &&
      !this.shadowedNames.has(name) &&
      !this.isVarsKey(name) &&
      !this.isOverriddenOperator(name) &&
      this.isPureBuiltinCallbackName(name)
    )
      return false;

    if (operand.type.matches('function')) return true;
    return this.opaqueSymbolDefinition(name);
  }

  /**
   * Memoized {@link isPureBuiltinCallback} — the provenance + purity + fixed
   * arity gate a bare built-in operator name must clear to be admitted as a
   * mergeable callback. Depends only on the name and engine state, both
   * constant for the duration of one harvest; it consults no callee edge, so
   * no neutral-edge guard is needed on the write.
   */
  private isPureBuiltinCallbackName(name: string): boolean {
    const cached = this.builtinCallbackMemo.get(name);
    if (cached !== undefined) return cached;
    const result = isPureBuiltinCallback(this.engine, name);
    this.builtinCallbackMemo.set(name, result);
    return result;
  }

  /**
   * The DEFINITION-based half of the opaque-operand test for a bare symbol —
   * it depends on nothing but the name and engine state, both constant during
   * a harvest. Unlike the whole classification (which also consults the
   * OPERAND NODE's type, and the shadow set) it is therefore safely memoizable
   * per name; and it never consults `isAdmissibleUserFnCallee`, so no
   * neutral-edge guard is needed on the write.
   */
  private opaqueSymbolDefinition(name: string): boolean {
    const cached = this.opaqueSymbolMemo.get(name);
    if (cached !== undefined) return cached;
    const def = this.engine.lookupDefinition(name);
    let result: boolean;
    if (def === undefined) result = false;
    else if (isOperatorDef(def)) result = true;
    else result = def.value?.type?.matches('function') === true;
    this.opaqueSymbolMemo.set(name, result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Candidate selection (§5.2 steps 3–7, §6.2 cap)
  // -------------------------------------------------------------------------

  private selectCandidates(): CseCandidate[] {
    // Bucket by structural hash, verify with `isSame` against each class
    // representative, under a deterministic per-bucket budget.
    const buckets = new Map<number, HashBucket>();
    for (const occ of this.occurrences) {
      const hash = occ.node.hash;
      let bucket = buckets.get(hash);
      if (bucket === undefined) {
        bucket = { classes: [], spent: 0, exhausted: false };
        buckets.set(hash, bucket);
      }
      if (bucket.exhausted) continue;

      let found: StructuralClass | undefined;
      for (const cls of bucket.classes) {
        if (cls.representative === occ.node) {
          found = cls;
          break;
        }
        if (cls.representative.isSame(occ.node)) {
          found = cls;
          break;
        }
        // Charge the budget only for comparisons that FAIL — distinct
        // structures sharing a hash, the adversarial-collision work the
        // budget exists to bound. A successful match is the duplication the
        // pass exists to find: its cost is proportional to the win, and
        // charging it disabled CSE on exactly the high-value corpus shapes
        // (a size-s candidate with k occurrences charged (k−1)·s, crossing
        // the budget near size×count ≈ 10 000 — Tycho's 507-node ×128
        // flagship yielded zero candidates).
        bucket.spent += Math.min(cls.size, occ.size);
        if (bucket.spent > this.maxVerifyNodesPerBucket) {
          bucket.exhausted = true;
          break;
        }
      }
      if (bucket.exhausted) {
        // Dropped WHOLE: its occurrences emit inline, deterministically.
        bucket.classes = [];
        continue;
      }
      if (found === undefined) {
        found = {
          representative: occ.node,
          size: occ.size,
          occurrences: [],
        };
        bucket.classes.push(found);
      }
      found.occurrences.push(occ);
    }

    this.buckets = buckets.size;
    for (const b of buckets.values()) if (b.exhausted) this.exhaustedBuckets++;

    // G2 — same-region rule. Attribution already happened during the DFS;
    // group each structural class by region and keep the bindable regions with
    // at least two occurrences.
    type Provisional = {
      representative: Expression;
      size: number;
      region: MutableRegion;
      occurrences: MutableOccurrence[];
    };
    const provisional: Provisional[] = [];
    for (const bucket of buckets.values()) {
      for (const cls of bucket.classes) {
        const byRegion = new Map<MutableRegion, MutableOccurrence[]>();
        for (const occ of cls.occurrences) {
          const region = occ.region as MutableRegion;
          if (region.inert) continue;
          const list = byRegion.get(region);
          if (list === undefined) byRegion.set(region, [occ]);
          else list.push(occ);
        }
        for (const [region, occurrences] of byRegion) {
          if (occurrences.length < 2) continue;
          provisional.push({
            representative: cls.representative,
            size: cls.size,
            region,
            occurrences,
          });
        }
      }
    }

    // Deterministic order: by region id, then by first occurrence.
    provisional.sort(
      (a, b) =>
        a.region.id - b.region.id ||
        a.occurrences[0].enter - b.occurrences[0].enter
    );

    // G3 — mutation. Conservative: any `Assign`/`Declare` of any symbol the
    // candidate mentions, anywhere in the region's subtree.
    const afterMutation = provisional.filter((c) => {
      const assigned = c.region.assignedNames;
      if (assigned.size === 0) return true;
      for (const name of this.symbolsOf(c.representative))
        if (assigned.has(name)) {
          this.droppedByMutation += 1;
          return false;
        }
      return true;
    });

    // Subsumption — drop A when every occurrence of A sits strictly inside an
    // occurrence of B with the same per-region count. Different counts: keep
    // both. The scan only ever pairs candidates of the SAME region, so group
    // first: the cost is then quadratic per region rather than in the global
    // candidate count.
    const byRegionForSubsumption = new Map<MutableRegion, Provisional[]>();
    for (const c of afterMutation) {
      const list = byRegionForSubsumption.get(c.region);
      if (list === undefined) byRegionForSubsumption.set(c.region, [c]);
      else list.push(c);
    }
    const subsumed = new Set<Provisional>();
    for (const group of byRegionForSubsumption.values()) {
      for (const a of group) {
        for (const b of group) {
          if (a === b || subsumed.has(b)) continue;
          if (b.occurrences.length !== a.occurrences.length) continue;
          if (b.size <= a.size) continue;
          const allInside = a.occurrences.every((oa) =>
            b.occurrences.some((ob) => ob.enter < oa.enter && oa.exit < ob.exit)
          );
          if (allInside) {
            subsumed.add(a);
            this.droppedBySubsumption += 1;
            break;
          }
        }
      }
    }
    const afterSubsumption = afterMutation.filter((c) => !subsumed.has(c));

    // Re-check per-region counts (no single-use temps), then G4. An admitted
    // user-function application is exempt from the size/score heuristics
    // (see `isAdmittedUserFnApp`).
    const surviving = afterSubsumption.filter((c) => {
      if (c.occurrences.length < 2) return false;
      if (this.isAdmittedUserFnApp(c.representative)) return true;
      const count = c.occurrences.length;
      if (c.size < this.minSize || (count - 1) * c.size < this.minScore) {
        this.droppedByThreshold += 1;
        return false;
      }
      return true;
    });

    // Materialize, then apply the per-region binding cap.
    const byRegion = new Map<MutableRegion, CseCandidate[]>();
    for (const c of surviving) {
      const candidate: CseCandidate = {
        id: this.nextCandidateId++,
        representative: c.representative,
        size: c.size,
        region: c.region,
        occurrences: c.occurrences,
        score: (c.occurrences.length - 1) * c.size,
        nodes: new Set(c.occurrences.map((o) => o.node)),
      };
      const list = byRegion.get(c.region);
      if (list === undefined) byRegion.set(c.region, [candidate]);
      else list.push(candidate);
    }

    const all: CseCandidate[] = [];
    for (const [region, list] of byRegion) {
      // Admitted user-function calls first (their runtime benefit is
      // unrelated to the syntactic `score` — an unbound recursive self-call
      // is an exponential blowup, so the binding cap must never starve one);
      // then highest score; ties by first occurrence — deterministic.
      list.sort(
        (a, b) =>
          Number(this.isAdmittedUserFnApp(b.representative)) -
            Number(this.isAdmittedUserFnApp(a.representative)) ||
          b.score - a.score ||
          a.occurrences[0].enter - b.occurrences[0].enter
      );
      const kept = list.slice(0, this.maxBindingsPerRegion);
      this.droppedByRegionCap += list.length - kept.length;
      region.candidates = kept;
      for (const candidate of kept)
        for (const node of candidate.nodes)
          region.candidateByNode.set(node, candidate);
      all.push(...kept);
    }

    all.sort((a, b) => a.region.id - b.region.id || a.id - b.id);
    return all;
  }
}

type OperandPlan = {
  kind: CseRegionKind;
  inert: boolean;
  boundNames: string[];
};

/**
 * Where a binder's clause/bound operands start, and the names it binds.
 *
 * The selector reports each bound variable as an operand PATH; the smallest
 * `path[0]` is the first clause operand. Everything before it is body
 * (`Sum(body, Limits(i, …))`, `D(f, x, y)`, `NDSolveFunction(…, Limits(…))`),
 * everything from it on is clause structure — inert in Phase 1. No selector,
 * or a selector that resolves no site, means the bound variables are unknown
 * here: treat the whole node conservatively (`firstClause === 0`).
 */
function binderSplit(
  def: BoxedOperatorDefinition,
  node: Expression & FunctionInterface
): { firstClause: number; boundNames: string[] } {
  const selector = def.bindingSites;
  if (selector === undefined) return { firstClause: 0, boundNames: [] };

  let sites: readonly { path: readonly number[] }[];
  try {
    sites = selector(node.ops, 'post');
  } catch {
    return { firstClause: 0, boundNames: [] };
  }
  if (sites.length === 0) return { firstClause: 0, boundNames: [] };

  let firstClause = Number.POSITIVE_INFINITY;
  const boundNames: string[] = [];
  for (const site of sites) {
    if (site.path.length === 0) continue;
    firstClause = Math.min(firstClause, site.path[0]);
    const symbol = symbolAtSite(node.ops, site.path);
    if (symbol !== undefined) boundNames.push(symbol.symbol);
  }
  if (!Number.isFinite(firstClause)) return { firstClause: 0, boundNames };
  return { firstClause, boundNames };
}

/** The parameter names of a `Function` literal (`['Function', body, …params]`),
 * unwrapping a `Typed` ascription. Load-bearing for admission: the shadow-name
 * prepass (`collectShadowedNames`) refuses these names as user-function
 * callees and named callbacks, and region `boundNames` keep candidate matching
 * capture-sound. */
function functionLiteralParamNames(
  node: Expression & FunctionInterface
): string[] {
  const names: string[] = [];
  for (let i = 1; i < node.nops; i++) {
    const param = node.ops[i];
    if (isSymbol(param)) names.push(param.symbol);
    else if (isFunction(param, 'Typed') && isSymbol(param.ops[0]))
      names.push((param.ops[0] as Expression & { symbol: string }).symbol);
  }
  return names;
}

// Region keys need a stable identity per node OBJECT (the tree may be a DAG,
// and two structurally equal nodes are different sites).
const NODE_IDS = new WeakMap<object, number>();
let nextNodeId = 0;

function nodeId(node: Expression): number {
  const existing = NODE_IDS.get(node as unknown as object);
  if (existing !== undefined) return existing;
  const id = nextNodeId++;
  NODE_IDS.set(node as unknown as object, id);
  return id;
}

function regionKey(node: Expression, opIndex: number): string {
  return `${nodeId(node)}:${opIndex}`;
}
