# Compile-Time Common-Subexpression Elimination (CSE)

**Status: DRAFT r4 — revised per three review passes, review converged**
**Date: 2026-07-28**
**Motivated by: Tycho item 108 (corpus survey, `docs/scratch/2026-07-28-cse-opportunities-for-ce.md` in the Tycho repo)**
**Revision history: r1–r3 reviewed (Claude + Codex, three passes) → the incorporated spec review; r4 addresses the pass-3 findings (callback invisibility, callback-API edge wiring, override provenance, verification budget).**

## 1. Motivation

Tycho surveyed both Desmos corpora (685 documents, 3131 compiled member
functions) through their real import pipeline: **28% of compiled member
functions and 42% of documents contain at least one repeated pure subtree
inside a single compiled expression**. Extremes: a 65,541-node implicit
function with a 507-node subtree repeated 128×; a 154-node piecewise repeated
64×. These expressions are compiled once but evaluated per-pixel/per-sample/
per-frame against a 60 fps budget, so eliminated nodes multiply by
thousands-to-millions of evaluations.

The compiler today shares nothing. Verified baseline (0.98.0):

```
expr:  sin(6u)^2 + sin(6u) / (sin(6u) + 2)
JS:    Math.pow(Math.sin(6 * _.u), 2) + Math.sin(6 * _.u) / (Math.sin(6 * _.u) + 2)
GLSL:  _gpu_powi(sin(6.0 * u), 2.0) + sin(6.0 * u) / (sin(6.0 * u) + 2.0)
```

`Math.sin(6 * _.u)` is computed three times per call. This *particular*
shape V8's optimizing tier can rescue (a known-pure builtin over a plain
load gets GVN'd — measured 1.0× in §8), but the general case cannot be:
`_SYS.*` helper calls (broadcast closures, `cabs`, interval arithmetic)
are opaque to the JIT — measured 1.8× when the repeat is `_SYS.gamma` or
a corpus-shaped piecewise (§8) — and unoptimized tiers rescue nothing.

Two distinct duplication sources need two distinct answers:

1. **Inlining-driven duplication** (the dominant source per Tycho's report): a
   document defines `f(u,v)` and calls it repeatedly; Tycho's importer inlines
   the body at every call site because compiled artifacts must be
   self-contained. The engine *already* solves this on the JS and interval-js
   targets — `tryCompileUserFunction` (`base-compiler.ts`) emits a
   user-defined function literal ONCE as a named preamble function and calls
   it by name, artifact still self-contained. Tycho inlines anyway because
   the GPU targets have no `userFunctions` registry, and their pipeline is
   target-uniform. Closing that gap is **Phase 2**. Note the pre-inlined
   LaTeX Tycho hands us today contains no user-function applications — the
   duplicated bodies arrive as plain built-in-operator subtrees, squarely in
   Phase 1's eligible class.
2. **Organic duplication**: the user typed the same subexpression repeatedly
   (`π/60` ×27, `sin(360u)` in several factors). No definition exists to
   share; only CSE recovers it. This is **Phase 1**, the primary subject of
   this document.

**Phase 3** (interpreted-mode evaluation memo) is sketched in §10 and gets its
own design doc before any implementation.

## 2. Scope

### In scope (Phase 1)

- An intra-expression CSE pass hosted in `BaseCompiler`, active for the
  **JS-family targets: `javascript`, `python`, `interval-js`**.
- Purity-, capture-, and conditionality-sound by construction (§5).
- **Deterministic temp naming for ALL targets.** `BaseCompiler.tempVar()`
  is converted from `Math.random()` names to a counter on an always-present
  per-compilation **naming context** (§4.1) — distinct from, and broader
  than, the CSE session: it exists even with `cse: false` and on GPU targets
  (which call `tempVar()` for loop accumulators, `gpu-target.ts:1016`, and
  are otherwise out of CSE scope). Without this, any candidate-bearing
  expression that also exercises a `tempVar()` path (chained relations,
  complex power chains, `Match`) would emit nondeterministic source and
  §7.6 could not hold. This is a cross-cutting signature/plumbing change
  (~10 call sites across 4 files, including `gpu-target.ts` — §12), not a
  one-liner; its snapshot churn is measured together with CSE's (§8).
- A `bindExpr` implementation for interval-js (§6.2) — **net-new
  capability** for that target (today its chained relations sit in the
  "inline everything" bucket, an existing double-evaluation gap this
  incidentally fixes).

### Out of scope (deliberately)

- **GPU targets** (`glsl`, `wgsl`) for CSE itself: driver shader compilers
  already CSE pure expressions; the real GPU win is source size, addressed
  in Phase 2 (§9) via user-function emission first. The pass is architected
  so a GPU target can opt in later via `cseBind` (§6.2). (GPU targets DO
  get the deterministic naming context above.)
- **Cross-row sharing** (Tycho's secondary ask): a compile-environment
  design conversation, deferred with witnesses per standing practice.
- **Cross-statement binding** in `Block` statement lists and imperative
  `Loop` bodies: statement-list regions never bind (§5.1), so early-exit
  reachability and inter-statement mutation ordering never interact with
  CSE. **Each statement's own value expressions are bindable regions**
  (§5.1) — inertness applies to the statement *list*, not to leaves.
- **`Match`**: fully CSE-inert in Phase 1 (§5.1). Its guards/bodies are
  compiled from plan-constructed closure trees
  (`guardClosure.op1`/`bodyClosure.op1`, `base-compiler.ts:3053-3074`),
  not from the harvested operands, so the occurrence machinery cannot see
  them without a dedicated nested-harvest design; `Match` does not appear
  in the motivating corpus's operator histogram. v2 (§11).
- **Binder clause expressions** (indexing-set bounds/collections): inert
  regions in Phase 1 (§5.1). Their `clauseLocal` sequential visibility
  (`types-definitions.ts:1057` — later clause collections see earlier
  indices) makes binding placement clause-position-dependent; bounds are
  small in practice. v2 (§11).
- **User-defined function applications inside candidates**: ineligible in
  Phase 1 (§5.2 G1b). Purity inference for user definitions was documented
  **dependency-order-unsound** (`docs/EFFECTS-MODEL.md` §"Dependency-order
  inference is unsound": `f() := g()` defined before an effectful `g` stays
  marked pure), so `isPure` could not be trusted for them. This costs
  little: per §1, Tycho's duplication arrives pre-inlined as built-in
  operators. **Amended 2026-08-01 (shipped 0.100.0)**: the effects model's
  Stage 2 closed the soundness gap (unresolved heads infer `{any}`;
  `effectsOf` resolves through bindings), and NESTED definition-body
  harvests began admitting pure user-function applications behind a
  transitive callee-body validation — the `admitPureUserFunctions` opt-in,
  §5.2. **Amended 2026-08-03**: after a measured pass (admission is inert
  on user-fn-free trees; per-callee validation ≈ 0.02 ms, memoized per
  name per harvest), ROOT harvests admit them too, and a NAMED callback
  resolving to an admissible pure literal no longer blocks eligibility
  (§5.2). Built-in named callbacks (`Map(xs, Sin)`) are admitted too: the
  compiler eta-expands them at their REQUIRED arity into a shared emitted
  wrapper, so they carry the built-in exemption's trust argument (§5.2). A
  CALLER-OVERRIDDEN or `vars`-mapped operator name stays opaque, as does one
  with no expandable arity (`Random`, `Less`), which emission now refuses at
  compile time.
- **Cross-region and cross-term hoisting** (PRE, LICM, sharing across
  unrolled terms): v2 (§11).
- **Alpha-invariant merging**: `Sum(x², x)` and `Sum(y², y)` do not merge.
  `isSame` is binding-identity by name; the region rules make name-keyed
  matching capture-sound. Not worth the alpha-invariant hash migration for
  this corpus.

## 3. Design overview

CSE runs **at emission level**, not as a boxed-tree rewrite. No `Block` /
`Declare` nodes are constructed, no scopes are created, and the compiled
tree is the same object graph the existing pipeline produces:
`expr.unknowns`, `withReferences`, `symbolDeps`, and
`assertRealOnlyComponents` see the original tree; structural consumers that
read `.ops` directly (e.g. `extractLimits`) are unaffected because only
value-position compilation consults the CSE machinery.

Three cooperating pieces:

1. **A naming context and a CSE session** (§4): shared mutable state
   objects per root compilation, threaded by reference through the
   compiler's `{...target}` spread copies.
2. **A harvest pass** (§5): one DFS over the (angular-unit-rewritten) tree,
   computing static regions, occurrences (per *path*, not per node object —
   the tree may be a DAG), and candidates, with the soundness gates applied.
3. **Emission integration** (§6): during recursive compilation, region
   *instances* are pushed/popped at the same sites harvest derived its
   regions from (one shared inventory — §5.1), candidate occurrences
   resolve to temps via an explicit per-instance state machine, and each
   region instance's bindings are wrapped around its body via `cseBind`.

## 4. Contexts, entry points, and option plumbing

### 4.1 Two state objects

```ts
/** Always present, all targets, regardless of `cse`. */
type NamingContext = {
  counter: number;                  // _tvN and _cseN numbering
  usedNames: ReadonlySet<string>;   // collision inventory (§6.3)
};

/** Present only when CSE is enabled for this compilation. */
type CseSession = {
  regions: …;                       // static harvest output (§5)
  instanceStack: …;                 // emission-time region instances (§6.1)
};
```

Both are stored as single fields holding **shared object references**
(`target.naming`, `target.cse?`) — the `userFunctions`-registry pattern,
which survives the compiler's pervasive `{...target}` spread copies because
copies share the referenced object. State MUST NOT be plain scalar fields on
the target (spreads would fork them). `tempVar()` and the CSE temp allocator
both draw from `target.naming` — which requires threading the target into
`tempVar()`'s call sites (part of the §2 naming change).

The `usedNames` inventory is collected **unconditionally** (it serves
`_tvN` allocation even with `cse: false`): a dedicated O(n) symbol-name
sweep at each boundary (piggybacking the harvest DFS when CSE is enabled).
It also includes any `_cse`/`_tv`-prefixed tokens found in caller-supplied
source strings (`functions` strings, string `vars`, `preamble`), so temps
never capture names a splice introduces (§5.2 G1b, §6.3).

### 4.2 Compilation boundaries (exhaustive)

A fresh naming context (always) and CSE session (when enabled) are created
at every **root compilation boundary**:

| entry | mechanism |
| --- | --- |
| `JavaScriptTarget.compile()` (expression route and the `Function`-literal route in `compileToTarget`) | created in the per-call `createTarget()`; harvest on the post-`rewriteAngularUnit` tree |
| `PythonTarget` public entries — `compile`, `compileFunction`, `compileToSource`, `compileVectorized`, `compileLambda` (exhaustive list; entries that delegate to another boundary are noted in code) | same. `compileFunction`/`compileVectorized`/`compileLambda` take a trailing `{ cse?: boolean }` options argument (default enabled), threaded into their session setup. |
| `IntervalJavaScriptTarget.compile()` | same |
| Direct custom-target route (`compile-expression.ts`) | **`compile-expression.ts` stamps a fresh `target.naming` before calling `compileRoot`; `target.cse` is stamped `enabled: false` — direct custom targets get NO CSE in Phase 1.** A direct target is caller-supplied code end to end: `cseBind` attests binding *syntax*, not that the target's other emitters are pure or eager, and its resolver functions carry no override provenance for G1b to consult. A target-level emission-purity attestation that re-enables CSE here is v2 (§11). An **explicit** `cse: true` alongside `target` is rejected with an error (silently stamping it off would leave the caller believing CSE ran); omitting the option keeps the silent off. Stamping-per-call means a reused caller target never carries stale state; `compileRoot` additionally re-opens the naming boundary (counter reset + expression symbols merged) for callers invoking it directly, and then runs `beginCompilation`. (`compileRoot`'s `(expr, target, prec)` signature is unchanged — the options channel is the stamp.) |
| GPU targets (`glsl`/`wgsl` via `compileRoot`/`beginCompilation`, and `compileShaderBody`, which deliberately spans several root compiles to keep counters distinct) | naming context only — created/reset exactly where GPU random numbering resets today, preserving that mechanism's semantics |
| `buildInterpreterFallback` | nothing — no emission |
| User-function definition bodies (`ensureUserFunctionEmitted`) | nested harvest scope, same session and naming context (§5.4) |

The r1 assumption that everything flows through `compileRoot` was wrong —
registered targets call `BaseCompiler.compile` directly — hence this table.

### 4.3 Option surface

`CompileExpressionOptions` / `CompilationOptions` gain `cse?: boolean`
(default `true`), consumed where the session is created (table above). With
`cse: false`, output is **byte-identical to the deterministic-naming
baseline** — i.e. this change-set minus CSE. It is *not* byte-identical to
pre-change output: the `tempVar()` naming migration applies unconditionally
(a deliberate part of §2, with its snapshot churn measured in §8). A target
without `cseBind` behaves as `cse: false`; a direct custom target is always
`cse: false` in Phase 1 regardless of the option (§4.2).

## 5. Harvest

One DFS over the tree **by edges**: a node object reachable through two
parent positions is visited twice, producing two occurrences (paths, never
bare node objects — this is what makes DAG-shaped trees safe). During the
walk: sizes are computed bottom-up and memoized per node object; symbol
names accumulate into `usedNames`; subtrees are bucketed by the cached
structural `hash` and verified with `isSame` against the bucket
representative; each occurrence records its DFS enter/exit interval so
containment queries are O(1). Verification cost is expected
O(occurrences); hash collisions make it worse, and the size gate does not
bound that (it is a lower bound). A **deterministic per-bucket verification
budget** (`CSE_MAX_VERIFY_NODES_PER_BUCKET`, 10 000 compared nodes) caps
the worst case, and **charges only comparisons that FAIL** — distinct
structures sharing a hash, the adversarial-collision work the budget
exists to bound. A successful match is the duplication the pass exists to
find; its cost is proportional to the win and is never charged. (The
implementation initially charged successes too: a size-s candidate with k
occurrences charged (k−1)·s, silently disabling CSE near size×count ≈
10 000 — precisely the high-value corpus shapes. Measured before/after in
§8.) A bucket exhausting its budget is dropped whole, its occurrences emit
inline unchanged — a lost optimization, never a correctness change — and
the drop is deterministic for a given expression. Pinned by
synthetic-collision tests at both the harvest and public-compile level
(§8).

### 5.1 Regions — one inventory for harvest and emission

Regions form a tree over the expression. **Harvest and emission share one
declarative inventory** so the two passes cannot drift:

- A static table in `base-compiler.ts` — `LAZY_OPERANDS` — maps an operator
  (plus shape, e.g. "relational with > 2 operands") to the operand
  positions its emission evaluates conditionally. Harvest consults it
  during the DFS to open static regions.
- Emission sites for those constructs compile lazy operands through an
  edge-aware helper (`BaseCompiler.compileOp(parent, opIndex, target,
  prec)`) that pushes/pops the matching region instance; non-lazy positions
  need no edge and inherit the current instance from `instanceStack`. Only
  the bounded set of lazy/binder emission sites needs the interposition.
  **This requires a callback-API migration**, not just a new helper:
  several lazy emitters live behind `CompiledFunction` handlers and the
  `selection` hook, whose compile callback today takes only an
  `Expression` — no parent, no operand index (and recovering the index via
  `indexOf`/identity would reintroduce the DAG ambiguity this design
  eliminates). The callback signature gains an optional operand index —
  `compile(expr, opIndex?)` — bound to the parent by the dispatcher;
  handlers for lazy constructs pass the index for their lazy positions.
  Migrated callbacks (exhaustive): the JS `selection` lowering, and the
  interval-js and Python `If`/`Which`/`When` `functions` entries. Pinned by
  a DAG test reusing one node object in two differently-lazy operand
  positions of one construct.
- Drift between the table and an emitter's actual laziness is caught by the
  per-construct conditionality tests (§8): every entry in the table has a
  test pinning both the laziness and the region behavior. Adding a lazy
  construct to a target means adding a table entry + test — stated in
  `types.ts` next to `cseBind` as part of the emitter-author contract.

**Region-opening sites:**

**(a) Binder sites** — the body of every operator whose definition carries
a `scoped` binding-site selector (the sanctioned inventory,
`docs/SCOPING-MODEL.md`: `Sum`/`Product`,
`Integrate`, `D`, comprehensions, any future `scoped:` operator — derived
from the flag, never hand-listed). Also `Function`-literal bodies (covers
`Reduce`/`Accumulate` combiners, which are `Function` literals — there is
no separate "Fold" construct) and `Block`. **Binder clause expressions**
(bounds, indexing-set collections) open their own regions and are **inert**
in Phase 1 (§2): `clauseLocal` gives clauses sequential index visibility,
so a clause candidate's correct binding point depends on clause position —
deferred rather than approximated.

**(b) Lazy emission edges** (the `LAZY_OPERANDS` table):

- `Which`/`If`/`When` value arms and every condition after the first
  (ternary chains; `_SYS.select` passes thunks — lazy there too);
- `And`/`Or` operands after the first;
- each comparison after the first in a **chained relation** (`a < m < b`
  lowers to `(a<m) && (m<b)` with *no* `And` node in the boxed tree — this
  edge exists only at the emission layer, which is exactly why the
  inventory is emission-derived);
- `Coalesce` (and the absence-capability `coalesce` axis): operands after
  the first (compiled coalescing evaluates the default lazily; ratified
  missing-value semantics are left-to-right lazy);
- `Match`: opens regions and is **fully inert** in Phase 1 (§2).

**(c) Statement lists.** `Block` statement lists and imperative `Loop`
bodies open **inert** regions — no binding is placed at the statement-list
level, so `Return`/`Break`/`Continue` reachability and inter-statement
ordering are out of the picture. **But each statement's value expressions
are their own bindable child regions**: an `Assign` RHS, a `Declare`
initializer, a `Return` value, a statement-form `If` condition (its
branches are statement lists again), a bare expression statement.
`Assign(x, f(y) + f(y))` inside a loop therefore deduplicates `f(y)`
within the RHS. This matters doubly because a canonical `Function`-literal
body IS a scoped `Block` (the single-statement form is unwrapped at
compilation — `compileBlock`'s `args.length === 1 && locals.length === 0`
branch, `base-compiler.ts:1800` — and lands in the lambda-body region;
multi-statement bodies get per-statement regions). Region push/pop
for these sites lives in the statement emitters
(`compileBlock`, `compileLoopBody`, `compilePythonStatements`).

Everything that binds is an expression-position region: root, conditional
arms, guard tails, expression-shaped binder bodies (loop-form
`Sum`/`Product` bodies; Python's `sum(… for …)`), lambda bodies,
per-statement value expressions, and unrolled-term instances (§6.1).

### 5.2 Gates

Occurrences attribute to their **innermost enclosing region** (by DFS
interval). The candidate pipeline, in order:

1. **G1 — purity.** `expr.isPure` must be true. Excludes random draws
   structurally: two occurrences of one `RandomChoice(…)` subtree are
   *different draws* (counter-based streams) and must never merge.
2. **G1b — emission purity.** `isPure` describes the boxed operator, not
   the emitted code. **Provenance**: the resolver closures a target carries
   cannot distinguish built-in from caller-supplied entries, so the
   registered-target `compile()` entries record the override key sets —
   `Object.keys(options.functions)`, the `operators` lookup, string-valued
   `vars` keys — into the session at target-creation time (they are in
   scope exactly there); G1b consults those sets, never the closures.
   (Direct custom targets have no such provenance — which is one reason
   they get no CSE in Phase 1, §4.2.) Ineligible:
   - any subtree containing a node that resolves through a caller-supplied
     `functions` entry, `operators` entry, or *string* `vars` entry (live
     source splices; non-string `vars` are baked constants, safe);
   - any subtree containing a node whose operator DEFINITION carries a
     **caller-supplied** per-operator `compile` handler
     (`ce.declare(name, { compile })`). `compileExpr` consults it before
     every built-in mapping and splices whatever source it returns, while
     the definition defaults to `pure: true` — so this is the same channel
     as a `functions` entry, reached through the engine instead of the
     options bag. Like a caller-mapped operator, it also under-maps its
     whole subtree.

     **Built-in exemption (amended 2026-08-01).** A BUILT-IN definition's
     `compile` handler (`PointList`, `ListFrom`, `Tuple`, …) is *not*
     caught by this clause: neither the head nor anything beneath it is
     under-mapped, and the head is eligible. Rationale: the clause exists
     because `ce.declare(name, { compile })` is the same caller-supplied
     splice channel as a `functions` entry — the emitted code's purity is
     unknowable. A built-in definition's handler is engine-authored,
     deterministic, effect-free emission, exactly like the built-in TABLE
     mappings (`Sin`, `Add`), which were never under-mapped nor
     ineligible. Consistency: hoisting a pure subtree across a built-in
     table emission is already sanctioned, and a built-in definition
     handler is the same trust class — the split between "lowered by the
     table" and "lowered by a handler on the definition" is an internal
     implementation detail of the library, not a trust boundary. G1
     (`node.isPure`) independently excludes impure operators (`Random`,
     …), so the exemption rides on the same purity guarantee the table
     path always relied on. Consequence: collection-bearing built-ins
     such as `PointList` become CSE-bindable (§5.3 covers the shared-object
     aliasing this introduces).

     *Provenance mechanism*: the definition object carrying the handler
     must be **identity-equal** to the system-scope binding for that name —
     `engine.contextStack[0].lexicalScope.bindings.get(name)`, the same
     test `engine-declarations.ts` uses to recognize a built-in before
     shadowing it. Identity, never name: a user
     `ce.declare(name, { compile })` in any non-system scope is a
     different object and stays ineligible, and so does a user definition
     *shadowing* a built-in name (the scope lookup resolves to the user's
     def, which is not the system binding). Implemented in
     `Harvester.hasCallerCompileHandler` (`compilation/cse.ts`), memoized
     per operator name on the per-harvest `Harvester` instance — sound
     because engine scope state is constant for the duration of a harvest;
   - any occurrence **below** a caller-mapped operator (a harvest DFS flag:
     the custom emitter controls how often — or whether — everything
     beneath it evaluates, so those occurrences do not count toward any
     candidate);
   - any subtree containing a **user-defined function application** —
     UNLESS the harvest opts in via `admitPureUserFunctions`
     (**amended 2026-08-01, Tycho item 120; shipped 0.100.0**). Original
     rationale: purity inference for user definitions was
     dependency-order-unsound (`docs/EFFECTS-MODEL.md` §"Dependency-order
     inference is unsound"), so a stale `pure` marking could merge
     effectful calls. Effects Stage 2 closed that (unresolved heads infer
     `{any}`; `effectsOf` resolves callbacks through bindings). Admission
     is set by BOTH compiler harvest routes (**amended 2026-08-03** after
     the measured pass): the ROOT harvest (`openCseSession`) and the
     NESTED harvest over an emitted `_fn_*` definition body (§5.4), where
     a repeated self-call makes compiled recursion exponential; direct
     `harvestCse` callers default to off. An admitted application's
     resolved callee BODY
     is validated transitively (`Harvester.isAdmissibleUserFnCallee`): the
     same emission-purity gates as this list, plus a fresh per-level
     semantic-purity check — the application node's own `isPure` can be
     install-time stale one level removed. Recursion through definitions
     is handled at the NAME level (in-flight callee → neutral edge;
     verdicts leaning on a neutral edge stay provisional, uncached).
     Admitted applications are exempt from the G4 size/score heuristics —
     a call's runtime cost is unrelated to its syntactic size, and binding
     a twice-occurring call always halves the calls. The declare-then-
     assign route stores the lambda as a VALUE definition, so the
     admission check runs BEFORE the fixed-built-in gate below (those
     application nodes carry no operator definition);
   - any application whose operator position is not a fixed built-in
     (e.g. `Apply` with a symbolic head, a parameter used as a function) —
     the EFFECTS-MODEL higher-order optimism;
   - any subtree containing a **function-valued operand that is neither an
     inline `Function` literal nor a name resolving to an admissible pure
     user-function literal** — a parameter, an opaque function value, or a
     built-in operator name handed to a higher-order built-in
     (`Map(xs, Sin)`, `Sort` with a built-in key, …). The original blanket
     exclusion of every named callback existed because they were
     **invisible to purity inference**: `Map(xs, f)` could report pure
     while `f` draws or writes, and merging two such applications would
     change draw streams or callback invocation counts. **Amended
     2026-08-03**: where the harvest admits pure user functions, a
     bare-symbol callback resolving to a user-function literal is answered
     by the SAME transitive gate as a call site
     (`isAdmissibleUserFnCallee` — fresh per-level `body.isPure` plus the
     emission-purity scan, in `computeOpaqueCallableOperand`), and G1
     (`node.isPure`, which since effects Stage 2 resolves the callback
     through its current binding) still gates the whole application — so
     two identical `Map(xs, f)` with a validated pure `f` now merge, while
     a drawing `f` stays un-merged. Bare symbols are classified through
     this relaxed path BEFORE the function-type check, so it reaches
     typed callbacks of EAGER higher-order operators (`CountIf(xs, p)`)
     as well as held lazy operands. The rule remains derived from the
     operand, not from an operator list. An inline `Function` literal is
     fine — its body is ordinary harvestable structure that passes these
     gates recursively. **Built-in operator names admitted 2026-08-03.**
     A callback naming a built-in has no literal body to validate, but it
     no longer needs one: the compiler ETA-EXPANDS it into
     `(p₁ … pₙ) ↦ op(p₁ … pₙ)` and emits that wrapper as a shared local
     through the user-function machinery
     (`BaseCompiler.ensureBuiltinCallbackEmitted`) — before, the symbol
     fell through to the free-variable read `_.Sin` and the artifact threw
     `_f is not a function` at RUN time. What such a callback does is
     therefore exactly the built-in's own deterministic, effect-free
     emission: the built-in exemption's trust argument, extended. Admitted
     when ALL hold (`isPureBuiltinCallback`, `compilation/builtin-callback.ts`,
     the module emission shares — an operand that cannot eta-expand must
     never become CSE-eligible): the name is not shadowed; it is not an
     `isVarsKey` caller `vars` entry (the caller's external input WINS at
     emission, so the artifact does not call the built-in at all — the
     user-function relaxation above is gated on the same test); it is not an
     `isOverriddenOperator` caller splice (unknowable emitted purity — it
     stays opaque for MERGING even though emission does route through it);
     it resolves to the engine-authored SYSTEM-scope definition by object
     identity, and is not a `_customLibraryOperators` name (the same
     provenance test `hasCallerCompileHandler` applies, now shared); the
     definition is `pure` (so `Random` is refused); and it is expandable at
     its REQUIRED arity.

     **Required arity, not fixed arity (review round, 2026-08-03).** The
     wrapper is built over the operator's `n ≥ 1` REQUIRED parameters. An
     OPTIONAL tail does not disqualify: a callback site applies the operator
     with only its required arguments (the optionals default), so
     `(p) ↦ Ln(p)` is semantically exact and `Map(xs, Ln)` compiles. Only a
     VARIADIC tail (`Add`, `Less`) or a zero-required signature (`Random`,
     `Max`) has no single wrapper arity; those DECLINE, and emission then
     FAILS CLOSED (D6) at compile time rather than falling through to the
     free-variable read `_.Random` that throws at run time. Two carve-outs on
     the refusal: it applies only in value position (an application HEAD is
     untouched), and never to a bare single-uppercase-letter name (`D`, `N`),
     which the engine's own `devolveUnappliedOperator` fallback reads as a
     VARIABLE. A unary operator carrying a `target.operators` mapping
     (`Negate`) is expanded on that branch too, before its
     first-class-function refusal; its wrapper body lowers through the very
     mapping. Reduce/Scan COMBINER sites, which need a strictly binary
     operand, therefore check `BaseCompiler.isBinaryInfixValueOperator`
     explicitly instead of relying on that refusal.

     **Shadow guard (review round, 2026-08-03).** Name-based resolution
     (`lookupDefinition`/`_getSymbolValue`) sees the engine scope at
     harvest time, not the lexical scope of the tree being harvested — a
     `Function`-literal parameter named like an admissible global would be
     admitted against the GLOBAL's body while emission references the
     parameter (a runtime value that may be impure), changing call counts.
     Admission therefore fails closed on shadowed names: a prepass
     (`collectShadowedNames`) collects every binder-bound name in the
     harvested tree (`Function` params via `functionLiteralParamNames`,
     `scoped:` binder names via `binderSplit`), unioned with the caller's
     `CseHarvestOptions.shadowedNames` — the nested definition-body
     harvest threads the emitted definition's parameter names through it,
     since those params are not binder nodes inside the harvested body
     tree. `isAdmissibleUserFnCallee` and the callback relaxation both
     refuse any name in the set. The set is whole-tree, not
     scope-accurate — a name bound by any binder anywhere in the tree is
     refused everywhere in that harvest — which only ever declines a
     merge (same conservatism class as G3's any-assign-anywhere). Note:
     HEAD-position resolution of a shadowed name to the global is
     pre-existing engine-wide semantics (interpreter and compiler agree,
     with and without CSE) and is deliberately not addressed here; the
     guard just keeps CSE from binding through such names at all.
   Net: candidates are built-in-operator subtrees plus validated pure
   user-function applications; callable operands are inline literals or
   names resolving to validated pure user-function literals
   (2026-08-03; the 2026-08-01 item-120 round covered definition bodies).
3. **G2 — same-region rule.** ≥ 2 occurrences attributed to the **same
   region**; binds at that region's top; occurrences elsewhere emit inline
   (or join that region's own candidate). No binding crosses a region
   boundary. This makes name-keyed matching capture-sound and selection
   laziness free.
4. **G3 — mutation.** Drop a candidate if any of its free symbols is the
   target of `Assign`/`Declare` anywhere in the candidate's region subtree,
   **including all descendant regions**. Deliberately conservative
   (any-assign-anywhere); an ordering-aware relaxation is v2 (§11).
5. **Subsumption.** Drop candidate A when every occurrence of A sits inside
   an occurrence of candidate B with the same per-region count (O(1)
   interval containment). Different counts: keep both.
6. **Re-check region counts.** Drop candidates whose surviving per-region
   count fell below 2 (no single-use temps).
7. **G4 — benefit threshold.** Applies uniformly to every surviving
   candidate regardless of region kind. Only compound (operator-applied)
   subtrees are ever candidates — atoms (symbols, number/string literals)
   never are. `size ≥ CSE_MIN_SIZE` and
   `(regionCount − 1) × size ≥ CSE_MIN_SCORE`
   where **`regionCount` is the per-region count after steps 3–6, never the
   global bucket total**. Proposed `CSE_MIN_SIZE = 4`, `CSE_MIN_SCORE = 8`
   (admits the corpus's dominant size-4–7 patterns, skips `Negate(x)`
   trivia); named constants, tuned before landing (§8).

### 5.3 Non-scalar candidates and aliasing

Candidates are not restricted to scalar-valued expressions — the corpus's
highest-value repeats are `PointList`/`List`-shaped. Binding one makes every
occurrence reference **one shared runtime object**. This is an existing
sharing mode, not a new one (a `vars`-supplied collection referenced at two
sites is already one object today). The invariant it rests on — no
JS/interval helper mutates its input or relies on input identity — becomes
an explicit **landing gate**: audit `_SYS.*` and the interval runtime for
in-place mutation before enabling; a helper found mutating copies first
(a pre-existing hazard for `vars`-backed collections regardless of CSE).
Pinned by test (§8).

**Forward hazard — efficient functional update (noted 2026-08-09).** The
landing gate above is stated as an absolute ("no helper mutates its
input"), and that phrasing will not survive the efficient-functional-
update work sketched in `EFFECTS-MODEL.md` (the deferred-`mutable`
disposition, "Implementing the optimization"). That work compiles
`xs = Append(xs, v)` / `xs[i] = v` to an in-place update wherever the
old value is provably dead — i.e. **a helper that mutates its input, by
design** — and its highest-value targets are the same `PointList`/`List`
spines that are CSE's highest-value candidates. The two optimizations
are therefore in direct tension: CSE manufactures precisely the sharing
that destructive update must prove absent.

This is resolvable, and cheaply, provided it is *chosen* rather than
discovered later as a miscompile. Either:

1. the uniqueness analysis runs **after** CSE and treats every CSE temp
   as shared by construction (a bound temp has ≥ 2 occurrences by
   definition — that is the whole point of binding it), so a mutation
   candidate reached through a temp simply copies; or
2. CSE declines candidates that a later pass wants to mutate.

(1) is the better default: it needs no new information at harvest time
and keeps the two passes independent. Whichever is chosen, **§5.3's gate
must be reworded** from "no helper mutates its input" to "no helper
mutates its input except where uniqueness is proven, and CSE temps are
never unique" — and the §8 pin updated to match. Until that work starts,
the absolute form is correct and should stay as written.

### 5.4 Harvest boundary

Harvest covers the root expression tree (post `rewriteAngularUnit`).
Emission-time trees:

- **User-function definition bodies** (`ensureUserFunctionEmitted`): each
  body gets its own nested harvest scope in the same session (own regions
  and candidates; shared naming context so names never collide across the
  artifact). Duplication inside a called definition is recovered once, in
  the emitted named function. The nested harvest passes
  `admitPureUserFunctions: true` (item 120, §5.2), so repeated PURE
  user-function calls inside a body — notably a recursive body's repeated
  self-call — are also bound. Since 2026-08-03 the ROOT harvest passes the
  flag too (`openCseSession`), so repeated pure call sites bind at every
  level.
- **Unrolled `Sum`/`Product` terms**: region instances, §6.1.
- **`Match` plan closures** and other synthesized structure (destructuring
  desugar): not harvested; `Match` is inert (§2).

## 6. Emission

### 6.1 Region instances and the occurrence state machine

Static regions describe the tree; **instances** exist at emission time.
Entering a region site (via `compileOp` or a statement emitter, §5.1)
pushes `{ bindings: [], state: Map<candidate, 'defining' | 'bound'> }`;
leaving pops it and, if bindings survive, wraps the region's compiled body
with `cseBind`.

When compilation reaches a node that is an occurrence of a candidate **of
the current innermost static region** (harvest attribution decides — the
same shared node object under a different region isn't in that region's
candidate set, which resolves the DAG ambiguity):

- **no entry** → set `'defining'`, compile the RHS normally (`'defining'`
  suppresses *this candidate's own* hit so its RHS compiles through instead
  of self-referencing; nested candidates still resolve), then set
  `'bound'` and append `[name, rhsCode]` to the instance's binding list.
  Appending *after* RHS compilation means any temps the RHS referenced were
  appended first — **dependency order is automatic**.
- **`'defining'`** → compile through (inside this candidate's own RHS).
- **`'bound'`** → emit the temp name (an identifier — atomic at any
  precedence, so `prec` needs no handling).

**Why instances matter — the unroll case.** Unrolled `Sum`/`Product`
(`emitSumProduct`, ≤ 100 constant terms) compiles the **same body node
objects once per index value**, varying only the index `var` mapping — it
does *not* create fresh substituted copies. A bare node-keyed map would emit
iteration 1's temp for every later iteration: **silent wrong values**. Each
unrolled term opens a **fresh instance** of the body's static region, so
index-dependent candidates deduplicate *within* a term and recompute *per*
term. Cross-term sharing of index-free subtrees is v2 (§11).
Interpreter-parity regression test: `Sum(sin(i)·sin(i) + i, i, 1, 5)`.

The instance mechanism serves every re-entrant emission of shared
structure: bindings are per-instance, so one can never leak to a context
where it is not in scope.

### 6.2 The `cseBind` capability

```ts
/**
 * Bind a dependency-ordered list of temporaries around an expression-position
 * body: each temp evaluated exactly once, later RHSes and the body able to
 * reference earlier temps. Absent ⇒ CSE inactive for this target.
 * Emitter-author contract: a construct with conditionally-evaluated operand
 * positions needs a LAZY_OPERANDS entry + conditionality test (§5.1).
 */
cseBind?: (bindings: ReadonlyArray<[name: string, code: string]>, body: string)
  => string;
```

Deliberately not the existing `bindExpr`: its parallel-application shape
cannot express dependent temps.

- **javascript** — sequential-`const` IIFE (the complex-power-chain shape):
  `(() => { const _cse1 = …; const _cse2 = …(_cse1)…; return body; })()`.
  Flat; no nesting growth.
- **interval-js** — same IIFE; `{lo, hi}` values are `const`-bindable.
  Net-new capability (§2); the same change adds `bindExpr` so chained
  relations stop double-evaluating middle operands on this target.
- **python** — a **flat** sequential binding comprehension (not nested
  lambdas, whose depth would grow with candidate count and could break a
  previously-compilable expression, violating §7.5):
  `[body for _cse1 in [rhs1] for _cse2 in [rhs2]][0]`
  Later `for` clauses see earlier names; depth is constant; each RHS
  evaluates exactly once. Python CSE covers expression-position regions
  (including its `sum(… for …)` loop lowerings and per-statement value
  expressions inside `compilePythonStatements`-emitted bodies).
- **glsl / wgsl** — capability absent in Phase 1.

**Per-region binding cap.** `CSE_MAX_BINDINGS_PER_REGION` (proposed 32)
bounds emitted-code growth: beyond it, keep the highest-scoring candidates
(ties by first-occurrence order — deterministic), inline the rest. Pinned
by a stress test (§8).

### 6.3 Temp naming and determinism

CSE temps are `_cse1, _cse2, …`; `tempVar()` becomes `_tv1, _tv2, …` — both
from the naming context's counter (§4.1). **Neither prefix is "reserved" —
collisions are prevented, not assumed away**: MathJSON accepts
underscore-initial symbols, and lambda parameters, `Block` locals, and
`Match` captures emit as *bare* identifiers, so a user symbol literally
named `_cse1` (or `_tv1` — determinism makes that collision *reproducible*
where it used to be improbable) would otherwise self-capture. **Both**
allocators skip any name in `usedNames` — which is collected
unconditionally (§4.1), including with `cse: false`, and includes
`_cse`/`_tv` tokens appearing in caller-supplied source strings. Skipping
is deterministic for a given expression (§7.6). Collision tests cover
params, loop indices, Block locals, and Match captures named `_cseN` AND
`_tvN`, with CSE on and off.

## 7. What CSE must NOT change (invariants)

1. **Values, bit-for-bit** — same float operations, executed once instead
   of n times; no reassociation. Non-scalar values: identical contents;
   object identity per §5.3's audited aliasing contract.
2. **Draw streams.** Same draw sequence with CSE on or off (G1 + G1b's
   user-function exclusion — the sound gate, not optimistic inference).
   Pinned by test, including the EFFECTS-MODEL dependency-order
   counterexample (`f() := g()` with `g` later defined effectful: `f`
   applications are ineligible, so no merge).
3. **Selection laziness.** An unselected arm, a failed guard's body, a
   short-circuited `And`/`Or`/chained-relation tail, and a non-taken
   `Coalesce` default evaluate nothing, with CSE on or off (§5.1).
4. **Error behavior — precise statement.** No code that was previously
   exception-free begins throwing: bindings appear only in regions that
   were entered, containing only code the region already contained. Not
   preserved: when several **distinct** pure subtrees within one region can
   throw, hoisting reorders their evaluation relative to sibling code, so
   *which* exception surfaces first may change. (Guard patterns are safe by
   §5.1's lazy edges, including the no-`And`-node chained-relation case:
   in `x !== 0 && f(1/x) && f(1/x)` the `f(1/x)` occurrences sit in
   post-guard regions — pinned by test.)
5. **Compilation success envelope.** CSE never causes a compilation to fail
   that succeeded before (only emission changes; Python's flat binding form
   and the per-region cap keep source within parser limits) and never
   causes one to succeed that failed.
6. **Determinism.** Two `compile()` calls on one expression emit
   byte-identical source — for the whole artifact on every target,
   because the naming context covers all `tempVar()` call sites including
   GPU (§2, §4.2).

## 8. Testing and measurement

### Test matrix (new `test/compute-engine/compile-cse.test.ts`)

Assertion kinds: **value** (run the artifact against `evaluate()` — box and
parse routes), **shape** (emitted-source structure), **pyexec** (Python
only: `ast.parse`/`py_compile` validation of emitted source, and — when a
`python3` is available to the test environment, else skipped with reason —
subprocess execution with side-effect counters proving sequential temp
visibility and evaluate-once).

| category | javascript | interval-js | python |
| --- | --- | --- | --- |
| dedup (single occurrence of repeated code + value parity) | value+shape | value+shape | shape+pyexec |
| purity / draw-stream (`WithRandomSeed`, cse on/off/interpreter; EFFECTS-MODEL dependency-order counterexample) | value | — | — |
| emission purity (custom `functions`/`operators`/string-`vars` → no CSE through OR below the mapping; **named callbacks (2026-08-03): two identical `Map(xs, f)` with a PURE user `f` MERGE, a drawing `f` does NOT; a PURE BUILT-IN callback (`Map(xs, Sin)`, the optional-tail `Ln`, the operator-mapped `Negate`) MERGES via its eta-expanded wrapper, while a drawing (`Random`), variadic (`Less`), CALLER-OVERRIDDEN or `vars`-mapped one does NOT**; inline-literal callback eligible; splice containing `_cse1` doesn't collide) | value+shape | — | shape |
| capture (same-named subtree under different binders incl. `Integrate`, `D`; in/out of binder) | value+shape | shape | shape |
| conditionality (arm-only candidates not hoisted; Coalesce default; chained-relation tail; §7.4 guard probe at `x = 0`) — one test per `LAZY_OPERANDS` entry | value+shape | shape | shape |
| `Match` inert (JS: no `_cse` inside Match emission; interval-js/python: existing fail-closed contract asserted) | shape | shape | shape |
| statement regions (Assign-RHS dedup inside a Loop body; no cross-statement binding; candidate after conditional Return not hoisted; multi-statement lambda body) | value+shape | — | shape+pyexec |
| unroll parity (`Sum(sin(i)·sin(i)+i, i, 1, 5)`; loop-form variant; clause expressions inert) | value | value | shape |
| DAG sharing (one node object in two regions; twice within one) | value+shape | — | — |
| mutation (G3) | value | — | — |
| subsumption + post-filter (nested same-count → outer only; surviving < 2 → no temp) | shape | — | — |
| name collision (params/locals/captures named `_cse1` and `_tv1`, cse on AND off) | value+shape | — | shape |
| determinism (two compiles byte-identical: candidate-bearing + chained-relation expression; a GPU compile via `tempVar()` path) | shape | shape | shape (+GPU shape) |
| threshold + per-region cap (sub-threshold inline; > cap keeps top-scoring deterministically) | shape | — | shape+pyexec (stress: source stays parseable) |
| options (`cse: false` byte-identical to the deterministic-naming baseline; direct custom target never emits `_cse` even with `cseBind` present; reused caller-built direct target across two compiles; zero-candidate expression; Python no-options entries get default sessions) | shape | shape | shape |
| harvest budget (synthetic hash-collision bucket exhausts `CSE_MAX_VERIFY_NODES_PER_BUCKET` → dropped whole, output identical to `cse: false`, deterministic) | shape | — | — |
| DAG lazy edges (one node object in two differently-lazy operand positions of one construct — the `compileOp` index wiring) | value+shape | shape | shape |
| non-scalar aliasing (helper-mutation audit pin) | value | value | — |
| user-function body dedup (duplicated subtree inside a called `f(x) := …` definition; identical ROOT call sites bind once since 2026-08-03) | value+shape | shape | — |
| pure calls in definition bodies (item 120, `admitPureUserFunctions`: recursive self-call bound once INSIDE the conditional arm, depth-20 linear; drawing callee stays two calls; non-recursive coloneq body; callee body splicing a string-`vars` entry stays inert; stale installed signature — callee reassigned to draw — re-derived against current bindings) | value+shape | — | — |
| pure calls at the ROOT (2026-08-03: repeated pure call binds once via assign AND coloneq routes; repeated drawing call stays two calls; forward-reference pin unchanged) | value+shape | — | — |
| shadow guard (2026-08-03 review round: shadowed HEAD at root never binds — byte-equal to `cse: false`; shadowed OPERAND callback stays two traversals with call count preserved; nested-harvest param shadowing — `_fn_` body with a param named like an admissible global emits no `_cse`; unshadowed callback still merges) | value+shape | — | — |
| eager-operator typed named callback (2026-08-03: repeated `CountIf(xs, purePredicate)` binds once; drawing predicate stays unmerged; built-in predicate `CountIf(xs, Abs)` binds once; a user definition SHADOWING a built-in name routes through the user-function gate) | value+shape | — | — |

### Performance and complexity

- Harvest: one edge-DFS, memoized sizes, cached hashes, interval
  containment, name-keyed memos for the G1b definition lookups — expected
  linear in edges; adversarial hash collisions bounded by the
  failed-comparison budget (§5).
- **Measured (2026-07-29, `scratchpad/bench-cse.ts`), superseding the
  original "within 10%" acceptance bound.** Candidate-bearing trees are
  large compile-time WINS — the emitted source collapses: 524-node subtree
  ×128 in a 67k-node tree (Tycho's flagship shape) **−51%**; 1576-node
  ×128 in a 201k-node tree **−35%**; 56–173-node ×128 **−57%**;
  120-occurrence candidate **−27%**; the 18-node probe +2%. No-candidate
  controls pay the harvest DFS: **+17%** (mixed 961 nodes) to **+27%**
  (400 same-operator terms, 2 399 nodes) — absolute cost ~2 ms, one-time
  per compile, ~1 ms/1 000 nodes. The original ±10% bound was not
  reachable without harvest-allocation surgery disproportionate to a
  one-time cost; the revised acceptance is: **no-candidate compile
  overhead ≤ 30% and ≤ 5 ms at 2 500 nodes; candidate-bearing
  corpus-extreme shapes must not regress** (they win by ≥ 30%).
- Run-time: the original probe (`Math.sin` repeats) measures **1.0×** —
  V8's optimizing tier already GVNs a known-pure builtin over a plain
  load, so §1's headline example understates the JIT and the win there is
  compile-size only. The win appears exactly where §1's *general* claim
  says it should — opaque `_SYS.*` helpers: probe with `_SYS.gamma`
  **1.8×**, corpus-shaped piecewise **1.8×** (1e6 calls each).

### Landing gates

- §5.3 helper-mutation audit, test pinned.
- **Snapshot blast radius** measured and surfaced — both CSE churn and the
  unconditional `tempVar()` naming churn (which hits GPU/Match/chained
  snapshots even where CSE is off) — never absorbed silently, per policy.
- Corpus validation: Tycho re-runs their census driver; `savings` should
  collapse for js-target members; before/after frame-time profiles
  requested on their top-25 examples.

## 9. Phase 2 — GPU targets (§9.1 IMPLEMENTED 2026-07-29; §9.2 blocked on Tycho)

**§9.1 status: implemented.** The `userFunctions` registry gained a
per-target `lowering` hook (`define`/`call`/`value`/`noRecursion`,
`types.ts`); GPU targets install it in `createTargetFor` and deliver
definitions through `preambleFor` — the same channel as the `_gpu_*`
helpers — on the bare-expression and shader routes, prepended on the
`compileFunction` route, and explicitly opted out on `compileToSource`
(an expression string cannot carry a declaration). Callee-before-caller
ordering falls out of the registry's post-body-compile `defs.set`
insertion order — no prototypes needed. Ratified deviations from the
sketch below: **no `int`/`i32` synthesis** (`formatGPUNumber` always emits
a decimal point, so an int parameter would disagree with its own call
sites — the same rule Block locals follow); **array shapes beyond vec4
fail closed** (no `float[n]` parameter lowering in v1); call-site
argument-shape inference not attempted (the machinery does not offer call
shapes; first-call-site inference with the Block-local disagreement rule
is the follow-up if declared-signature friction shows in Tycho's corpus).
Tests: `test/compute-engine/compile-gpu-user-functions.test.ts`.

1. **User-function emission for GLSL/WGSL** — the higher-value piece:
   inlining-driven duplication dominates the corpus, and a definition
   emitted once as a real GLSL/WGSL function eliminates it at the source
   *and* shrinks shader source structurally. GLSL forbids recursion (fail
   closed with a diagnostic, unlike the JS stack-error contract);
   signatures need static types, synthesized with the `Block`-local
   shape/complexness inference; the `userFunctions` registry pattern
   carries over. Once this exists Tycho can stop pre-inlining **on all
   targets** (js/interval-js already possible today).
2. **Statement-context CSE for shader bodies** — requires GPU root emission
   to produce statements (today: an expression string Tycho splices), i.e.
   a shader-body contract conversation with Tycho. Honest framing: drivers
   already CSE, so this buys compile-time and source-size headroom, not
   per-frame arithmetic.

## 10. Phase 3 — interpreted-mode CSE (NOT PURSUED — the gate below was measured and failed, 2026-07-30)

**Ruling (2026-07-30): do not build this.** The last bullet of this section made
Phase 3 conditional on first bucketing *why* the interpreted residue fails to
compile — "if most are compile-target gaps, fixing those beats optimizing the
interpreter." Tycho ran that bucketing on the 0.99.0 full-corpus census
(`docs/scratch/2026-07-30-census-099-ce-audit.md` §4 in their repo) and the
condition fails decisively:

| the 230-member JS-compile-failure residue | members | states |
| --- | ---: | ---: |
| **theirs** — unexpanded user-function heads, unparsed LaTeX, document-defined function heads | **148** | **61** |
| compile-target gaps (ours) | 82 | 25 |

(Their first pass attributed the whole non-`Unknown operator` remainder to us —
202 / 69 — and they corrected it in review with a per-bucket provenance rule.
Use 82 / 25. Our own triage then found that figure to be an *upper* bound: its
catch-all sweeps deliberate refusals into our column. See `ROADMAP.md`
§ "Compile-target coverage" → Triage group C.)

**The correction strengthens the conclusion rather than weakening it.** On the
pre-correction reading the residue was mostly our target gaps; on the corrected
one it is *majority theirs* — parse and classifier failures that never reach a
CE target at all. Under neither reading is it work a memo would rescue, and the
corrected split makes the "fix the gaps instead" alternative look even better,
since the gaps are a smaller and more tractable set than we thought. The residue
also shrank 402 → 230 members across one release with no interpreter work. Our
share is tracked in [`ROADMAP.md`](../../ROADMAP.md) § "Compile-target
coverage".

**Reopening condition:** a profile showing interpreted-path *cost* (not
compile-failure population) dominating a real workload, on expressions that
genuinely cannot be compiled. Population alone does not reopen it.

The sketch is kept below because the hazards are worth not rediscovering.

Per-top-level-`evaluate()` memo: key = structural hash + `isSame` verify,
value = evaluated result, gated on `isPure`, size-thresholded. Hazards
recorded so they aren't rediscovered:

- `isPure` ≠ environment-independent: **Sum-index assigns are value
  writes** (the item-38 element-memo trap) — epoch invalidation hooked to
  symbol-value writes required.
- Exactness contract: `evaluate()` vs `.N()` differ; memo keyed per mode.
- Overhead is paid by every evaluation to benefit duplicated ones: validate
  against the box-microloop canary (~0.02 ms/iter); engine-flag gated
  initially.
- The served population is the interpreted residue (~400 corpus members
  failing JS compile). **Bucket why they fail first**; if most are
  compile-target gaps, fixing those beats optimizing the interpreter.
  (`ce.jit` already routes hot interpreted paths to the JS target, where
  Phase 1 applies.)

## 11. v2 candidate list (explicitly not in Phase 1)

- Cross-statement binding in `Block`/`Loop` statement lists, with regions
  split at abrupt-control-flow boundaries and an ordering-aware G3.
- `Match` CSE via nested harvest scopes over the plan's closure trees.
- Binder clause-sequence binding honoring `clauseLocal` visibility.
- Wire the REMAINING binder bodies through `compileOp`. Harvest opens a
  bindable body region for every `scoped:` binder, but emission pushes it
  for only three — `Sum`, `Product`, and the `Function` literal. Every
  other binder body (`Integrate`, the comprehensions, …) is emitted under
  a target whose `boundVars` the enclosing instance does not describe, so
  the blind-instance guard degrades it to the pre-CSE emission: sound, at
  the cost of a wasted harvest.
- ~~User-defined function applications as candidates, behind a sound
  transitive effect-row check (per `docs/EFFECTS-MODEL.md`).~~ **Landed:
  NESTED definition-body harvests 2026-08-01 (item 120, shipped 0.100.0);
  ROOT harvests 2026-08-03 after the measured pass** (admission is inert
  on user-fn-free trees, +0.9% ≈ noise at 3.6k edges; per-callee
  transitive validation ≈ 0.02 ms, memoized per name per harvest; the
  per-harvest memos are sound because a harvest is synchronous and engine
  state cannot change mid-harvest — there is no cross-compilation harvest
  cache. Staleness rule: admission never trusts a node-level purity
  marking across a definition boundary — each level re-derives against
  CURRENT bindings at harvest time; post-compile reassignment is the
  compile-wide snapshot policy, since emitted bodies are baked into the
  artifact regardless of merging). See §5.2.
- ~~Named/opaque callbacks to higher-order built-ins, behind sound
  callback effect projection.~~ **Landed for user-function literals
  2026-08-03** (§5.2: `computeOpaqueCallableOperand` resolves a
  bare-symbol callback through `isAdmissibleUserFnCallee`), and for
  BUILT-IN operator names the same day (§5.2: eta-expanded into a shared
  emitted wrapper at its REQUIRED arity, then admitted when pure,
  system-provenance and expandable; caller-overridden, `vars`-mapped and
  variadic/zero-required names stay opaque). Parameters and
  opaque function values stay excluded (nothing to validate).
- Per-mapping purity attestation for caller-supplied `functions`, and a
  target-level emission-purity attestation re-enabling CSE on direct
  custom targets (§4.2).
- GPU user functions: argument-shape inference for COMPOUND arguments
  (`h(v+w)` against a declared `vec2` parameter is currently rejected —
  shape classification answers only for bare symbols; needs
  expression-level shape synthesis with the Block-local disagreement
  rule).
- Cross-term sharing of index-free subtrees across unrolled terms.
- Loop-invariant hoisting; cross-arm binding at conditional entry (both
  need a throw-free argument or a guard for the not-taken case).
- GPU `cseBind` (§9.2), pending the shader-body contract.

## 12. Files touched (Phase 1)

- `src/compute-engine/compilation/base-compiler.ts` — naming context +
  session, harvest pass, `LAZY_OPERANDS` table, `compileOp` edge helper,
  region instances/state machine, `tempVar()` conversion (signature change
  threading the target), region push/pop in statement emitters
  (`compileBlock`, `compileLoopBody`) and lazy-construct emitters.
- `src/compute-engine/compilation/types.ts` — `cseBind` + emitter-author
  contract, `cse` option, context/session types.
- `src/compute-engine/compilation/javascript-target.ts` — `cseBind`,
  context/session creation, `tempVar` call-site updates.
- `src/compute-engine/compilation/interval-javascript-target.ts` —
  `cseBind` **and** net-new `bindExpr`, context/session creation.
- `src/compute-engine/compilation/python-target.ts` — comprehension-form
  `cseBind`, context/session creation on all five public entries, region
  push/pop in `compilePythonStatements`.
- `src/compute-engine/compilation/gpu-target.ts` — naming-context creation
  alongside the existing `beginCompilation` random-numbering reset;
  `tempVar` call-site update (`gpu-target.ts:1016`). **No CSE on GPU.**
- `src/compute-engine/compilation/compile-expression.ts` — option
  passthrough + direct-route state stamping (§4.2).
- `test/compute-engine/compile-cse.test.ts` — new (§8 matrix).
- `CHANGELOG.md` — feature entry (CSE + deterministic temp naming, noting
  the naming change affects all targets).

No boxed-expression, canonicalization, or library changes. No new module
dependencies (madge budget unaffected).
