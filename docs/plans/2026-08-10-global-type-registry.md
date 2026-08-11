# Global Type Registry — engine-level types, top-level-only `type` statements

**Status**: IMPLEMENTED 2026-08-11 (v2; full suite green, zero snapshot
churn). Rulings by user 2026-08-10: types (and the constructors they mint)
become **engine-global**; a block-local `type` statement is a **hard error**
(no hoisting); this is a **prerequisite for protocols**, which will also be
global.

Two refinements were forced by the Epsil **static pre-pass** (which
canonicalizes every top-level statement inside a pushed
`'epsil:static-check'` frame, for diagnostics only) and are now part of the
design — see §3.3a:

1. **The pre-pass frame is a top-level surrogate** for the `DeclareType`
   top-level check (recognized by frame name; the name is load-bearing on
   both sides).
2. **The pre-pass runs under a registry transaction**
   (`ce._typeRegistryRollbackPoint()`): a `DeclareType` registers at
   canonicalization time so later statements of the same program check
   against the new definition, and the rollback discards those registrations
   so real evaluation performs them in statement order on real state.
   Symmetrically, the D5 collision pre-check consults the **global** scope
   (where an engine-wide claim actually collides) while the mint targets the
   **current** frame (transient under the pre-pass, global at top level) —
   this keeps D5 atomic across the two passes AND preserves the
   statement-ordering contract (a `function` predating its `type` in an
   *earlier cell or statement* is still the D5 collision).

(Resolved in review: `ce.declareType()` under a pushed scope now mints the
constructor into the GLOBAL scope — the constructor's lifetime is the
type's, §3.2 — so the pop strands nothing. The pre-pass surrogate frame is
the one exception, and it is unforgeable: recognized by frame name AND the
engine's internal `_staticTypeCheckDepth` counter. When a mint produces no
constructor while an outer scope still holds a minted one — a pre-pass
replacement to a record body or generic alias — the inherited constructor
is masked with an inert shell so the pass sees the value namespace real
evaluation will. The pre-pass registry rollback bumps the invalidation
axes only when it actually restored something.)

Supersedes the block-lexical scoping of type declarations shipped (unreleased
in this form) by the `type` statement work
(`2026-08-01-nominal-types-design.md`) — specifically the per-scope
`scope.types` tables, the parser's per-block `knownTypeNames`
snapshot/restore, and the `type-shadow` warning.

## 1. Problem

Nominal identity is **textual** (`docs/plans/2026-08-01-nominal-types-design.md`,
ruled post-review), but type records are **per-scope**. These two facts do not
compose:

- A value tagged with a block-local nominal type re-binds to whatever the
  name means where the value is next canonicalized. Probed 2026-08-10:

  ```
  type A = string
  function mk() -> A { type A = integer
                       A(5) }
  const z: A = mk()   →   A(Error(incompatible-type "string" "finite_integer"))
  ```

  Sibling `do` blocks declaring different `A`s produce the same mis-binding.
  The `type-shadow` warning is a band-aid over exactly this.

- A value of a block-local type that escapes the block types as `unknown` —
  nothing outside can name its type.

- Scope-relative meaning is why every serialize-string→reparse seam is a
  hazard (the "resolver-blind site" bug class: ~24 library handlers fixed
  08-01, `_BoxedOperatorDefinition.update` forced to carry `Type` objects,
  `functionLiteralSignatureType` rebuilt, residuals still open in
  `desugarSignatureString` and the function-literal-annotation-in-same-block
  gap).

- Protocols (TYPE_SYSTEM_ROADMAP §4) need conformance to be a fact about a
  *type*, not about a position in a scope chain: a witness table keyed by type
  name is incoherent if the name's meaning is scope-relative, and dispatch
  through a conformance registered in a block would have the same
  lifetime ambiguity with higher stakes (it changes which code runs).

## 2. Ruling

1. **One type namespace per engine.** Type declarations — statement route and
   host `ce.declareType()` — target a single engine-level registry. A type
   name means the same thing everywhere in the engine, for the engine's
   lifetime.
2. **Duplicate name = error.** No shadowing. The only replacement flow is the
   existing statement-replace (`_declaredByStatement`, notebook re-run) and
   forward-reference fulfillment — both already in-place record updates.
3. **`type` statement is top-level only.** Inside a `do` block, function body,
   `if` branch, loop body, `match` arm: **hard error**, at parse time *and* at
   the engine (box/parse routes). No hoisting — hoisting reintroduces action
   at a distance.
4. **Type parameters are untouched.** `forall` clauses and generic
   declaration clauses never lived in the scope chain (they are fields on the
   signature / declaration record, bound by the type parser's own
   `_typeVarScopes` stack) and keep working identically.

## 3. Design

### 3.1 The registry

A single `Record<string, TypeReference>` (or `Map`) owned by the engine —
world state, alongside symbol assignment. The `TypeReference` record shape,
forward-reference promises, arity recording, in-place fulfillment and
statement-replace machinery all move **unchanged**; they were driven by
captures holding the record object and by re-run semantics, not by scoping.
They just have one home instead of a chain.

- Bootstrap types (`limits`, `distribution`) seed the registry at
  construction, replacing their current system-scope residence.
- `Scope.types` (`types-kernel-evaluation.ts:310`) is **deleted** from the
  scope shape.

**The `TypeResolver` interface is the seam and does not change.** `names` /
`resolve` / `forward` keep their signatures; only the backing store changes
(registry lookup instead of scope-chain walk). Every consumer of
`ce._typeResolver` — `parseType`, `BoxedType._resolve()`, the Epsil
`typeNames` option, the ~24 structural library handlers — is unaffected.

### 3.2 Constructors

`declareType` keeps claiming both namespaces (nominal-types D5). The minted
constructor now goes into the engine's **global scope bindings** — since
declarations are top-level-only this is the status quo outcome, but stated as
a rule: the constructor's lifetime is the type's. The D5 collision pre-check
runs against the global scope. Value bindings otherwise stay fully lexical; a
local `let point = …` still shadows the constructor *as a value binding*,
which is ordinary and harmless (the type's identity is unaffected).

### 3.3 Enforcement (two layers)

**Parser** (`src/epsil/parser.ts`): a `type` statement claimed anywhere but
statement depth 0 emits a new **error** diagnostic
`type-declaration-not-top-level` (%0 = name). Recovery: the statement is
parsed and discarded; the name is **not** seeded into `knownTypeNames` (a
failed declaration declares nothing — downstream `Unknown type` errors are
accurate). Flows into `checkSource`, so the VSCode extension gets the
squiggle for free.

**Engine** (`DeclareType` handlers, `library/core.ts`): the canonical and
evaluate handlers error unless executing at the engine's top level, covering
the box route and non-Epsil MathJSON programs. Proposed mechanism: compare
`ce.context.lexicalScope` against the engine's root evaluation context
(implementation detail to verify — must hold under the executeEpsil
program-wrapper Block unwrap, where top-level statements run without a pushed
scope, and must fire inside `Block`/`Function` canonicalization, which do push
one). Error value: `invalid-type-declaration` with a
"type declarations must be at the top level" message.

Note the enforcement is *style/coherence*, not soundness: with a global
registry a nested `DeclareType` would still write global state — the hard
error exists to keep "a `do` block mutated the engine's type namespace" from
ever being a thing a reader has to consider.

### 3.3a The static pre-pass (as implemented)

The Epsil static pre-pass canonicalizes each top-level statement inside one
pushed frame (`'epsil:static-check'`, `src/epsil/static-diagnostics.ts`) to
keep binding side-effects out of the program scope. Three mechanisms make the
registry coexist with it:

- **Top-level surrogate**: `declareTypeStatement` treats that frame (by
  name) as top level — statements boxed directly in it are top-level by
  construction; a `Block` nested under it still pushes its own frame and
  errors.
- **Registry transaction**: `staticDiagnostics` captures
  `ce._typeRegistryRollbackPoint()` and restores after the pass — the
  type-namespace mirror of popping the frame. Canonical-time registration
  stays visible to the rest of the pre-pass (re-declared constructor
  arities, self-references), and a checked-but-never-run program does not
  mutate the engine's types. The snapshot is per-record FIELDS (records are
  replaced in place; captures hold the object), including
  `_declaredByStatement`, variance state and forward arities. The rollback
  bumps all three invalidation axes.
- **Split value-half scopes** in `declareType()`: the D5 collision pre-check
  consults the GLOBAL scope (`checkScope`); the mint targets the CURRENT
  frame (`scope`), like `ce.declare()`. Under the pre-pass the mint is
  transient with the frame while the check still sees real global bindings —
  D5 stays all-or-nothing across the canonical and evaluate passes.

### 3.4 Host API

`ce.declareType()` no longer reads the current scope at all — it writes the
registry. Calling it while a scope is pushed is **allowed** and
registry-targeted (recommended; the alternative, erroring, would break
internal bootstrap paths and buys nothing). Consequence to document:
`popScope` never removes a type. If a host needs to test-declare types, the
answer is a fresh engine, not a scope.

### 3.5 Deletions

| Site | Change |
| --- | --- |
| `engine-type-resolver.ts` scope walk, `ResolverScope`, `collectTypeNames`, `resolveTypeReference` | registry lookups |
| `Scope.types` field (`types-kernel-evaluation.ts:310`) | deleted |
| `parser.ts:580/639` per-block `knownTypeNames` snapshot/restore | deleted — the set only grows |
| `parser.ts:1178` `type-shadow` warning + `diagnostics.ts` code + `cli/format.ts` case | deleted — shadowing impossible |
| `engine-declarations.ts` `scope.types` sites (~13: 632–925, 1453, 1471) | registry |
| `multi-clause.ts:379` (`sameScopeType` ctor precedence) | registry — and "same-scope" becomes just "declared" |
| `library/core.ts:1548, 1742, 1762` (ctor-scope lookups) | registry |
| `type-constructors.ts` (comments + `scope` params) | registry |

Unchanged and explicitly out of scope: `TYPE_CACHE` and the two-step
resolver-less parse (the cache is process-global across *engines*; names are
still per-engine, so the resolver-independence gate and the load-bearing
`sawForwardRef` check stay exactly as they are — see P-BOX); the type
parser's `typeVars` seeding and its uncacheability rule; `typeParams` on
signatures and declaration records.

### 3.6 Invalidation hook

Type declaration/replacement becomes a semantic world-state change with one
choke point. Bump the semantic axis there (coordinate with the state-event
invalidation track, `2026-08-09-state-event-invalidation-axes.md` rev 5 —
its 2b choke-point step). This closes the known "`ce._generation` not bumped
on type redeclaration" latent hazard.

## 4. Behavior changes & test blast radius

Tests that flip from feature-pins to error-pins
(`test/epsil/declare-type.test.ts`, 130 tests total; `test/compute-engine/declare-type.test.ts`, 35):

- The block-visibility group (~7 tests: "visible inside the block", "not
  visible after", function body, `if` branch, nested snapshots, top-level
  survives a block) → all become `type-declaration-not-top-level` pins.
- The `type-shadow` group (~5 tests) → deleted/replaced: block-local shadow
  is now the top-level error; top-level re-declaration stays silent
  (statement replace, unchanged).
- The parseBlock snapshot/restore review-finding pin → deleted with the
  mechanism.
- Malformed-declaration recovery inside a `do` block (parser.ts recovery
  tests at declare-type.test.ts:496–511) → same recovery, plus the new error.

Bugs that close **by fiat**:

- The open spec-§2 gap (nominal-types plan): a type declared in a function
  body escaping as the inferred result type
  ("Failed to parse type '(unknown) -> inner'") — the declaration itself is
  now an error.
- The open "function-literal annotation referencing a same-block type is
  dropped at canonicalization" gap — no same-block types.
- The `A(Error(...))` re-binding class demonstrated above.
- Escaping values typing as `unknown`.

Improvements downstream (not gated on this plan, but enabled):

- Any string↔`Type` round trip anywhere in the engine is sound by
  construction; the resolver-blind-site audit category closes (residuals in
  `desugarSignatureString` et al. become benign rather than latent).
- Subtype verdicts stop being position-dependent — precondition for any
  future name-keyed solver caching.
- Constructor results are typeable everywhere (`mk()` above types as `A`).

## 5. Protocols alignment (why this is the prerequisite)

The protocols track (TYPE_SYSTEM_ROADMAP §4) needs, at minimum: conformance
declarations (`type point` conforms to `hashable`), a witness/handler table
consulted at dispatch, and protocol names usable as bounds. All three are
name-keyed facts about types. Under the global registry:

- A conformance is an edge between two registry entries — declared anywhere,
  true everywhere, exactly like the type itself. Protocol declarations reuse
  the same top-level-only rule and the same replace/forward-ref machinery.
- Dispatch tables can key on the type name with no scope qualifier and no
  lifetime question (the Swift precedent: conformances are global facts;
  retroactive, but never scoped).
- `collection`-as-protocol (the roadmap's prototype) keeps its lattice
  meaning; user conformance slots in as registry-level data.

Design principle to carry forward: **the registry is the engine's type-level
world state; scopes hold only value bindings and type *variables* bound by
syntax.** Protocols add a second kind of registry entry, not a second scoping
regime.

## 6. Open decisions

1. **(D1)** Parser recovery for a misplaced-but-well-formed `type` statement:
   proposed — do not seed the name (declares nothing). Alternative: seed to
   suppress cascading `Unknown type` noise in the rest of the block.
   Recommendation: don't seed; the cascade is accurate and the fixit is
   "move the declaration up".
2. **(D2)** `ce.declareType()` under a pushed scope: proposed — allowed,
   registry-targeted, documented (§3.4). Alternative: throw.
3. **(D3)** Exact top-level detection mechanism in the `DeclareType` handlers
   (§3.3) — root-context identity vs. an explicit statement-position marker;
   verify against the executeEpsil Block-unwrap trap before choosing.
4. **(D4)** Type *removal* (a notebook "forget this type") — deliberately out
   of scope; the statement-replace flow covers re-definition, and removal
   interacts with captured references. Revisit only with a concrete ask.

## 7. Phasing

Single release train (the block-lexical behavior is unreleased; no migration
story needed):

1. **Registry + resolver**: move storage, reroute the §3.5 table, delete
   `Scope.types`. Suite must be green minus the flipping pins.
2. **Enforcement**: parser diagnostic + engine-side check + flipped tests.
3. **Deletions**: shadow warning, snapshot/restore, dead diagnostic codes.
4. **Invalidation hook** (§3.6), coordinated with the state-event track.
5. **Docs**: `doc/08-guide-types.md`, `doc/85-reference-core.md` (`DeclareType`
   description currently says "current scope"), `src/epsil/docs/types.md` /
   `declarations.md`, CHANGELOG. Every Epsil example re-executed before
   pasting (documentation.test.ts contract).

Definition of done: full suite green; `npm run check:deps` clean (the
registry must not create an engine↔type-module cycle — keep the resolver
interface as the boundary, registry lives engine-side); no `scope.types`
reference outside git history.
