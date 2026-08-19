# Redefinition discipline — the batch boundary is the regime

**Date**: 2026-08-14 · **Revision 2** (dual spec review 2026-08-14 —
11 findings, all applied, including the resequencing of finding 5;
record:
the incorporated spec review) ·
**Status**: DESIGN, ready to implement (user-approved direction
2026-08-14) · **Companion to**:
`docs/plans/2026-08-14-object-representation-decision.md` (whose
type-pinning ruling defines the interactive half of object-type
redefinition) and `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B.

## The problem

Redefinition means two different things depending on where it happens.
In a notebook or REPL, re-running an edited `type` or `protocol`
statement is the normal working gesture, and the engine defines
replacement semantics for it (each construct its own — see the table
below). Inside ONE compilation unit — a single Epsil program — a second
declaration of the same name is almost never that gesture: the author
wrote both into one coherent program, and the second one is a bug the
engine currently swallows silently (probed 2026-08-14: `type Dup = …`
twice in one program runs with zero diagnostics, second wins).

## The ruling: no mode flag — the unit boundary selects the regime

An explicit "interactive vs compile" engine mode was considered and
rejected: something must set it, everything forks on it, and the engine
already runs its compile-like pass INSIDE interactive evaluation (the
static pre-pass canonicalizes a whole batch before any statement
evaluates), which a mode bit cannot classify coherently.

Instead, the regime selector the engine ALREADY has does the job: the
**unit** — one Epsil program. At runtime a unit is a batch
(`ce._epsilBatchId`; one `executeEpsil` call = one program); at check
time it is the program `staticDiagnostics` was handed (which runs with
NO batch — see "Mechanics"). This generalizes ruling P47
(`docs/plans/2026-08-12-protocols-design.md`), which established
exactly this split for protocol implementation blocks: a second block
for one (type, protocol) pair WITHIN a batch is
`protocol-implementation-duplicate`; the same statement in a LATER
batch replaces; the host API always throws.

- **Within one unit**: a second declaration of a name in the
  discipline's scope is a **diagnostic error** —
  `type-redefinition` / `protocol-redefinition`, the SAME code on both
  tiers (the P47 one-code pattern).
- **Across units**: redefinition keeps its per-construct replacement
  semantics (the notebook pattern) — for the statement-vs-statement
  case; mixed origins differ and are specified in the route/origin
  matrix below.
- **Nested runs are separate units, deliberately**: `executeEpsil`
  already mints a fresh batch id for a nested invocation and restores
  the enclosing one on exit (a host re-entering the interpreter). An
  inner run's declarations are therefore NOT checked against the outer
  unit's — they are a different program. This inherits P47's shipped
  posture and is a choice, not an oversight; pinned by a re-entrant
  test (inner declaration, outer continuation, restoration after an
  inner failure).
- **The host API is a ROUTE, not an ambient state**: `ce.declareType`
  / `ce.declareProtocol` keep today's behavior (throw on
  redeclaration) even when called re-entrantly from an operator's
  evaluate handler while a batch happens to be live. Stamping is
  performed by the Declare* STATEMENT handlers only — the check keys
  on the call route, never on whether `ce._epsilBatchId` happens to be
  set (the id is ambient engine state for the whole `executeEpsil`
  extent, so "batch id present" does not mean "statement route").

## Scope — which constructs are in the discipline

In, v1:

- **Nominal `type` declarations** (records, tuples, aliases, sums, and
  `object<…>` types when Appendix B Phase 1 lands). Types are
  engine-global (the global type registry), so a within-unit collision
  is always a real collision; and Epsil already rejects non-top-level
  `type` statements (`type-declaration-not-top-level`, probed
  2026-08-14), so the namespace within a unit is flat.
- **`protocol` declarations** — same reasoning; the registry is
  engine-global.

**Multi-name statements — the generated-name rule** (sum sugar): one
`type Result = ok(…) | err(…)` statement performs N+1 registry writes
(`declareSumType`: one `declareType` per variant plus the sum's own
name). Every write a single declaring statement performs carries the
SAME statement identity; the statement owns all its names. A collision
between two statements in one unit — including a PARTIAL collision, a
second sum reusing one variant name while renaming others — is
diagnosed ONCE, anchored on the second statement (the first statement's
range as the note), never once per colliding name. The sugar's internal
forward-reference promises are not declarations and never collide; a
REJECTED statement is atomic — none of its N+1 writes survive, exactly
as `declareSumType` is atomic today. Across units, a re-declared sum
replaces wholesale (all its names re-registered under the new
statement); a variant DROPPED by the re-declaration keeps its existing
across-unit behavior (it remains an ordinary nominal type — the shipped
`declareSumType` semantics), now pinned by a test.

Deliberately NOT in it:

- **`type X is P` — a bare conformance declaration — is not a type
  declaration.** It lowers to `DeclareConformance`, registers no type,
  and stays entirely outside this discipline: a re-declared bare edge
  is a deliberate no-op (Appendix A), and implementation-block
  duplicates remain governed solely by P47. Gate on the AST head
  (`DeclareType` / `DeclareProtocol`), never on the `type` keyword.
- **Assignments** (`x := 1` then `x := 2`): ordinary imperative code.
- **Clause additions** (`fib(0) = 0; fib(1) = 1; fib(n) = …`):
  accumulate semantics are idiomatic within one unit.
- **Lexical shadowing** (`let` in an inner scope): scoping, not
  redefinition.
- **`DeclareConformance` implementation blocks**: already governed by
  P47; this document generalizes it, not re-legislates it.

Recorded borderline, ~~deferred~~ **RULED 2026-08-14 (user) — IN the
discipline**: redefining the SAME clause (identical parameter list)
within one unit is now `function-redefinition`. The deferral's stated
basis was "no evidence either way"; the ruling settled it on the
notebook argument — cells are re-executed and edited in place, so a
duplicated parameter list is more often stale text than a deliberate
hot-fix, and the failure it caused was silent AND value-changing.

Only the REPLACE case is in. Clause ADDITION at a distinct parameter
list — the bullet above — is untouched, and across units a re-run clause
still replaces last-wins. What "same clause" means is not a new
judgement: it is `sameParameterDomain` (`multi-clause.ts`), the very
test dispatch uses to decide replace-vs-append, so what is refused is
exactly what would otherwise have been silently overwritten.

Implementation note — the identity test needed widening for this to
work. One statement is boxed more than once from the same source (the
static pre-pass canonicalizes it, then the evaluation loop canonicalizes
it again from the original MathJSON), and those boxings produce
DIFFERENT anchor objects. Comparing anchors by object identity alone
therefore reported a statement as a redefinition of itself, which showed
up as an across-program re-run silently failing to install. The stamp is
now matched on the source RANGE when both origins carry one, with object
identity as the fallback for hand-built MathJSON that has no offsets —
see `sameStatement` in `declaration-origin.ts`.

The clause ruling first shipped on the RUNTIME tier only. Its STATIC
tier followed on 2026-08-14, so `epsil check` reports a duplicated
clause before anything runs, like the other three constructs. It could
not reuse the declaration collector, because a clause is identified by
its parameter DOMAIN rather than by a name — one name legitimately
carries many clauses — and that domain is type-level, not syntactic:
renaming a parameter does not make a new clause, and an unannotated
parameter has no type in the source at all. The collector therefore
records the domain read off the CANONICALIZED literal
(`DefineFunction(name, Function(…))`, whose arrow is the clause
signature), one entry per clause, and reports a statement whose domain
coincides with an earlier entry's. `sameParameterDomain` and
`clauseSignatureOf` moved into `src/compute-engine/clause-identity.ts`,
an engine-free leaf, so the two tiers share one definition of clause
identity — the static checker may only import leaves at runtime, since
its engine is injected. Recording is gated on `canonInstallSkipped`,
the canonical route's own marker for a clause it refused to install:
that is the clause-side counterpart of the declaration tier's
`DECLARATION_BLOCKING_CODES` gate, read as a marker because
`DefineFunction`'s canonical handler swallows its failures (they are
minted on the evaluate route). Since a clause the discipline itself
refuses is also marked skipped, the gate applies to the RECORDING only,
never to the report.

## Mechanics — two tiers, two mechanisms

The tiers detect the same condition by DIFFERENT means, because the
static checker runs without any batch (verified 2026-08-14:
`checkSource` in `src/cli/check.ts` calls
`staticDiagnostics(engine, ast, source)` directly — no `executeEpsil`,
no `_epsilBatchId` — so a batch-stamp-keyed check could never fire on
the tier this document's headline diagnostic is promised for).

- **Static tier — a pass-local collector, no batch machinery.** The
  static pass walks the whole unit; it keeps its own map of
  in-scope names declared BY THIS UNIT (name → first declaring
  statement + range, all N+1 names of a multi-name statement entered
  under that one statement). A second in-scope declaration emits
  `type-redefinition` / `protocol-redefinition` (error severity) with
  the second statement as the primary range and the first as the note.
  This works identically under `epsil check`/`checkSource` and under
  the pre-pass `executeEpsil` runs — acceptance covers BOTH entry
  points.
- **Runtime tier — the batch stamp, P47 mechanics.** Type and protocol
  registry records gain an origin field
  `{ batch, statementId, firstRange }`:
  - `statementId` is a token anchored on the RAW declaring form,
    stable across the up-to-three registrations one statement performs
    per batch (static pre-pass canonicalization, eval-loop
    canonicalization, evaluation). Boxed-expression identity is NOT
    that token — the pre-pass and the evaluation loop box statements
    independently — so the anchor is, per construct, the raw operand
    the handlers already thread through: the type-body operand for
    `DeclareType`, the members dictionary for `DeclareProtocol`, and
    the whole raw operand array for `DeclareSumType` (the P47
    precedent anchors on `implOp` the same way; if any route fails to
    thread a raw operand, mint the token at parse time and carry it as
    an operand — decided at implementation, but the STABILITY
    requirement is normative).
  - A registration through the STATEMENT route whose name exists with
    the SAME batch and a DIFFERENT `statementId` errors with the same
    code as the static tier; same `statementId` re-registering is not
    a duplicate.
  - **Reject before mutate**: the collision check runs BEFORE any
    mutation of the existing record — `declareType`'s replacement
    path updates the captured record object IN PLACE, so a rejected
    duplicate must leave the first declaration's record, and
    everything that captured it, untouched (the P47 "checked before
    the block is validated" ordering, applied to definitions).
  - **Rollback schema**: the origin field joins BOTH registries'
    rollback snapshot/restore tuples (`_typeRegistryRollbackPoint`,
    `_protocolRegistryRollbackPoint`) — the pre-pass registers and
    rolls back, and a leaked stamp would make the evaluation loop's
    registration of the same statement look like a duplicate, while a
    dropped `firstRange` would break the two-range diagnostic.
  - Registrations from the box route and the host API are unstamped
    (see the matrix); the host API throws before stamps are ever
    consulted.

## Route/origin matrix

"Across units, replacement" holds for the statement-vs-statement case
only; mixed origins already differ today (`declaredByStatement` guards
in `engine-declarations.ts` / `engine-protocols.ts`) and this document
does not change them. The full matrix, each cell pinned:

| Existing ↓ / Incoming → | Epsil statement, same unit | Epsil statement, later unit | Box-route statement | Host API |
|---|---|---|---|---|
| Epsil statement | **ERROR** `type-redefinition`/`protocol-redefinition` (NEW — today silent-replace) | replaces (unchanged) | replaces (unchanged — box `Declare*` is a statement without a batch; no stamp, no same-unit check) | throws (unchanged) |
| Box-route statement | replaces (no stamp on the existing record → not a same-unit collision) | replaces (unchanged) | replaces (unchanged) | throws (unchanged) |
| Host declaration | **error** (unchanged — statement may not replace a host declaration; `declaredByStatement` guard) | error (unchanged) | error (unchanged) | throws (unchanged) |

The one NEW cell is the top-left; every other cell restates shipped
behavior and is pinned so this table cannot drift from the guards that
implement it.

## Amendments to the documents this narrows

This addendum is authoritative for the SAME-UNIT case; the following
records are amended by it (each gets a pointer to this document):

- `docs/plans/2026-08-10-global-type-registry.md`, ruling #2 /"§4
  stays silent": the statement-replace flow gains a same-batch
  precondition — replacement is the ACROSS-unit flow; the within-unit
  case now errors.
- `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A "Scope and lifecycle"
  (protocol replacement on re-execution): scoped to across-unit
  re-execution; the within-unit case errors.
- P47's scope note: P47 governs implementation-block duplicates; this
  document extends the same batch-boundary regime to type and protocol
  DECLARATIONS, with its own codes.
- The Appendix A/B diagnostics tables gain `type-redefinition` /
  `protocol-redefinition`.

## Interactive redefinition semantics — the consolidated table

Across units (and nowhere else), statement redefinition means, per
construct — consolidating rulings that live in their own documents,
which stay normative for everything except the same-unit case amended
above:

| Construct | Across-unit redefinition means | Ruled where |
|---|---|---|
| `type X = …` (non-object) | Registry record replaced in place; subsequent reads resolve the new definition | global-type-registry design (2026-08-10), as amended above |
| `type X = object<…>` | New type generation: constructor thereafter builds new-layout objects; existing instances keep their PINNED type, layout, and conformances | object-representation decision note (2026-08-14, user-ruled) |
| Sum declaration | Replaces wholesale (all N+1 names under the new statement); dropped variants stay ordinary nominal types | sum-sugar semantics + the generated-name rule above |
| `protocol P { … }` | Protocol replaced; conformances re-validated against the new requirements; dispatchers re-synced | Appendix A "Scope and lifecycle", as amended above |
| Conformance impl block | Replaces the stored block (P47) | protocols design P47 |
| Function clause, same parameter list | ACROSS units: replaces that clause. WITHIN one unit: `function-redefinition` (user ruling 2026-08-14) | multi-clause semantics; "Scope" above |
| Function clause, new parameter list | Adds a clause | multi-clause semantics |
| Plain assignment | Rebinds | core semantics |

## Measured baselines (2026-08-14)

- Same-unit duplicate `type` declaration today: silently accepted,
  second wins (probe).
- Body-local `type` statements: already rejected
  (`type-declaration-not-top-level`) — flat namespace confirmed.
- Corpus sweep (test/epsil, test/compute-engine, src/epsil/docs):
  every repeated same-name declaration found sits in a SEPARATE source
  string — zero within-unit duplicates, so the new error's expected
  blast radius is zero. Re-measured at implementation: the full suite
  runs with the diagnostic live; any hit is triaged.

## Acceptance criteria

- Within-unit second `type`/`protocol` declaration errors on BOTH
  tiers with code `type-redefinition` / `protocol-redefinition`: the
  static diagnostic (with both ranges) via `checkSource`/`epsil check`
  AND via the `executeEpsil` pre-pass; the runtime error value on the
  evaluation route.
- After a rejected duplicate, the FIRST declaration's record is
  unchanged and everything that captured it still resolves the
  original definition (reject-before-mutate).
- One statement's multiple registrations per batch never flag (the
  statement-identity immunity, pinned with a statement canonicalized
  twice and evaluated once).
- Stamp hygiene: check-then-execute of one program registers cleanly;
  checking the same program twice is identical both times; the
  pre-pass rollback restores prior origin fields (no stamp residue,
  no lost `firstRange`).
- Sum sugar: a partial within-unit collision diagnoses ONCE with the
  statement anchors; a rejected sum leaves none of its N+1 names
  registered; across-unit re-declaration replaces wholesale and a
  dropped variant keeps its shipped behavior.
- Every cell of the route/origin matrix pinned, including host-API
  calls made re-entrantly from an evaluate handler mid-batch (throw,
  unstamped, regardless of ambient `_epsilBatchId`).
- Nested `executeEpsil`: inner unit exempt from outer collisions;
  outer unit continues correctly after inner completion and after
  inner failure.
- `type X is P` bare conformance: never flagged by this discipline
  (pinned).
- Across-unit replacement unchanged for every row of the consolidated
  table (existing pins stay green; the object-type row lands with
  Appendix B Phase 1).
- Full-suite blast radius measured and reported before landing.

## Sequencing (revised by the review — house discovered-defects rule)

The core discipline for TYPES and PROTOCOLS lands **now**, as its own
work item ahead of Appendix B Phase 1: the silent within-unit duplicate
is a defect in shipped constructs, probed above, and object machinery
is not a dependency of fixing it. Only the object-type row of the
consolidated table — and its acceptance line — rides Phase 1 step 2,
which is when that row becomes live. (Original sequencing bundled the
whole discipline with Phase 1; the review correctly flagged the bundle
as an unjustified deferral.)
