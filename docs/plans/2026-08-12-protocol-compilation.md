# Compiling protocol dispatch to JavaScript

Status: **implemented 2026-08-12**. This closes the deliberate out-of-scope
item of `docs/plans/2026-08-12-protocols-design.md` ("compilation of dynamic
dispatch — fail-closed"). The governing surface ruling predates this document:
`docs/TYPE_SYSTEM_ROADMAP.md` Appendix A, "Static resolution and compiled
code" — a statically resolved protocol call compiles to a direct call; a call
that stays dynamic needs the receiver's runtime tag reified in compiled code;
where the receiver is an erased nominal and the target cannot be proven, the
compiler declines (D6). This document records the implementation architecture,
the decision procedures, and the deliberate divergences.

Rulings made for this feature (user, 2026-08-12): scope is function dispatch
(bare and qualified) **plus property GET and SET**; a compiled dynamic
dispatch that no arm covers **throws**
`Error("protocol-implementation-missing: <member>")` — the multi-clause
`no-matching-clause` convention — where the interpreter yields the error
VALUE.

## Architecture

Three layers, mirroring sum compilation:

1. **`engine-protocols.ts` — read-only planning exports.**
   `protocolDispatchCandidates` (the non-pending, impl-carrying edges for an
   impl key), `staticProtocolResolution` (wraps the same `bestCandidates`
   selection the interpreter's `dispatchMember` runs — the two cannot drift),
   `requirementArityOf`, and `implementationLiteralAt` (the stored raw
   literal rebuilt with GROUND annotations — every `Self`-bearing type text
   re-parsed under `selfSubstitutingResolver` at `Self = edge.target` and
   re-serialized).

2. **`compilation/protocol-dispatch.ts` — the pure planner.**
   `planProtocolDispatch(ce, {implKey, argc, receiverType?, protocol?})`
   returns a `DispatchPlan` (`static` | `dynamic`, ordered candidates with
   guard descriptors and substituted literals) or `undefined` (decline). No
   emission, no imports from base-compiler (zero-cycle budget).

3. **`base-compiler.ts` — recognition and emission.**
   `protocolCallParts` recognizes the four head shapes; the tier sits in the
   `!fn` branch of `compileExpr` (before `tryCompileUserFunction`), plus a
   pre-`target.functions` intercept for `Apply(Field(P, "m"), …)` — the
   canonical shape of a source-level qualified call (`ProtocolMember` nodes
   only appear via the `Field` evaluate wrapper) — and a protocol-property
   branch in the `Assign` lowering for the SET rebinding sugar. Helpers are
   emitted once into `target.userFunctions.defs` (the multi-clause plumbing:
   `prepareUserFunctionBody`, `withEnforcedParams`, nested CSE harvest,
   recursion via `registry.compiling`, `branchComplexCoercion` across arms,
   `symbolDeps` capture). JS target only; Python/GPU/interval keep the D6
   throw, and `analyzeReferences` probes the planner so `unsupported` stays
   accurate per target.

## Tier A — static resolution (direct call)

At receiver static type `t` (decided): `bestCandidates` must produce exactly
ONE winner `e*` (unconditional, Epsil-literal impl, requirement arity =
call-site argc; `t ≤ T*` holds by admission). Then for every other
non-pending, impl-carrying edge `e'`: skip if `typesOverlap(widest(e'), t)`
is false (admits no runtime `r ≤ t`); skip if `T*` is a STRICT subtype of
`e'.target` (wherever both are admitted, specificity eliminates `e'`);
otherwise — including any overlapping conditional or host edge — the proof
fails. On success the call site is `_fn_<implKey>$<Protocol>$e<i>(args…)`,
no guards.

Every non-`unique` static verdict falls through to tier B rather than
declining: `none` because the static type may be a supertype of every
admitted target (the central sum case — the receiver types as the sum alias
`shape` while conformances sit on its variants; the interpreter keeps such
calls alive through `edgeCouldApply` and dispatches on the evaluated value's
principal type), and `ambiguous` because tier B's pairwise rule independently
declines every ambiguity-capable candidate set.

## Tier B — reified dynamic dispatch (guard chain)

Candidates must all be unconditional Epsil literals with requirement arity =
argc. Per candidate, a receiver guard:

- machine types → `jsClauseParamGuard` (faithful `typeof` /
  `Number.isInteger` / `{re, im}` tests); a `list<…>`/`tuple<…>` target has
  NO faithful test (`Array.isArray` cannot see element types) and declines;
- tagged sum variant → `x?._tag === "v"` (optional chaining load-bearing);
- erased sum variant → `sumBucketTest` (+ a `length` check for a tuple
  payload);
- anything else (opaque non-sum nominal, records, …) → decline.

Pairwise rule (no receiver may reach a different arm than the interpreter's
selection): **equivalent** targets decline (the interpreter's runtime answer
is `protocol-call-ambiguous`); **comparable** targets linearize
most-specific-first (the multi-clause insertion sort; registration order
breaks ties) but ONLY when both guards are faithful machine-type tests — a
bucket/tag guard over-admits its whole representation class, so placing it
above a wider arm would swallow values the interpreter routes there;
**incomparable** targets must be provably runtime-disjoint (different guard
classes AND `!typesOverlap` — same bucket with different engine types is NOT
disjoint, the erased-alias hazard; `list<integer>` vs `list<string>` overlap
at the inhabited `list<never>`, P29). The dispatcher helper is emitted once
per (implKey, protocol restriction): a fixed-arity guard chain ending in the
ruled `throw`.

## Implementation literals

`implementationLiteralAt` substitutes `Self := edge.target` in the stored raw
literal's annotations. Soundness note: the interpreter runs impls effectively
UNANNOTATED (`apply` on the raw literal — `Self` annotations fail every parse
in `canonicalFunctionLiteral`) after `dispatchMember` pre-checks arguments at
`Self = runtime`; the edge's target is a supertype of every runtime receiver
the edge admits, so target-substituted annotations admit everything the
interpreter admits. The compiler canonicalizes the rebuilt literal, requires
validity, and routes it through the shared definition-emission machinery
under `_fn_<implKey>$<Protocol>$e<edgeIndex>` (`$` cannot appear in a
MathJSON symbol — no collision with user functions).

## Properties

- Qualified GET/SET (`ProtocolProperty(P, name, base[, value])`) and bare GET
  (`Field(base, name)` after the ordinary field routes declined) go through
  the same tiers with the mangled `__get__`/`__set__` keys. Bare `Field` is
  **static-tier only**: an undecided receiver may be an ordinary
  record/dictionary at runtime, whose keys beat protocol properties (P46) —
  a guard chain cannot arbitrate that.
- SET rides the `Assign` lowering: `p.name = v` may reach the compiler still
  spelled `Assign(Field(p, "name"), v)` (the engine defers the P2 rebind
  decision to evaluation, and `Assign` keeps its LHS raw — the root symbol
  types `unknown`). The `Assign` branch recognizes the shape, reads the
  receiver's declared type from the enclosing definition's parameter
  annotations or the block's typed locals (`CompileTarget.declaredVarTypes`,
  installed by `prepareUserFunctionBody` and merged by `compileBlock`, an
  untyped local removing the entry it shadows), compiles the setter, and
  emits the rebinding `p = _fn___set__name$…(p, v)`. SET is **static-tier
  only**, like bare-`Field` GET: an undecided receiver may be an ordinary
  record/dictionary at runtime, whose keys beat protocol properties (P46) —
  a guard chain over the conformance targets would throw on such a value
  where the interpreter performs the ordinary field update. When the
  property IS protocol-declared but the setter cannot be compiled
  (undecided receiver, readonly, ambiguous, non-variable root, …) the
  branch THROWS — before this tier the generic lowering emitted the silent
  no-op `_ = v`.
- Compile-time re-resolution from the static type stands in for the P41
  runtime re-resolution, and the P25 result-subtype-of-receiver runtime
  check is trusted statically (snapshot posture, below).

## Deliberate divergences from the interpreter (recorded)

1. **Miss/ambiguity convention**: compiled fall-through throws; the
   interpreter yields `protocol-implementation-missing` /
   `protocol-call-ambiguous` error VALUES. Ambiguity-capable candidate sets
   decline at compile time, so only the missing case survives to runtime.
2. **No non-receiver argument guards**: the interpreter's
   `argumentTypeError` re-checks arguments at `Self = runtime` and yields
   `incompatible-type` error values; the compiled body trusts the static
   check that ran at canonicalization (the P28 trusted-ascription posture —
   the same trust every compiled user-function call extends).
3. **Machine-value trust model**: tier-B guards are over the JS value model.
   An erased nominal flowing through an `unknown`-typed seam can alias a
   primitive guard — the same exposure compiled `match` constructor patterns
   and multi-clause guard chains already have. The pairwise rule declines
   the REGISTERED collisions; the residual is unregistered aliasing.
4. **Snapshot posture**: a compiled artifact bakes the candidate set it saw.
   Registry changes are `config` state events (all axes), which invalidates
   the engine's caches — a compiled function the host holds is the host's to
   recompile, exactly as with sum representation policy and multi-clause
   chains (`symbolDeps` records the member for the auto-compile
   revalidation paths).

## v1 declines (fail closed, D6)

Host `{host}` implementations among candidates; conditional (`where`)
conformances among candidates (or overlapping a static winner); pending-only
conformance sets; zero candidates; unguardable targets in tier B (parametric
collections, opaque non-sum nominals); ambiguity-capable pairs; requirement
arity ≠ call-site arity (or optional/variadic requirements); non-JS targets;
bare-`Field` property GET that cannot statically resolve; property SET whose
root is not a variable; `Apply(Field(P, "m"), …)` where the tier declines
(whole-unit decline — no fall-through to the generic `Apply` lowering, which
would die inside the protocol-naming `Field` operand).

## Residuals / follow-ups

- ~~Typed block locals ARE covered (`compileBlock` merges them into
  `declaredVarTypes`, block-scoped), but a typed local declared inside a
  LOOP BODY rides `compileLoopBody` — a separate statement path — and a SET
  on it fails closed.~~ CLOSED 2026-08-12: the merge was extracted to
  `statementListDeclaredVarTypes` and applied on the loop-body path
  (`loopBodyTempTarget`) and in `analyzeReferences`'s `Block` walk (which
  previously mislabeled a compilable block-local SET as `unsupported`).
  Fixing it surfaced an INTERPRETER defect on the same shape: the deferred
  `Assign(Field(…))` route checked the property value's fit on the RAW RHS,
  whose static type is often wider than the declared property type
  (`10 * i` in a loop body types `finite_number` against `integer`), and
  the refusal error was discarded in statement position — a silent no-op
  write, diverging from the compiled tier, which performed it. The deferred
  route now evaluates the RHS first (the `ProtocolProperty` operator is not
  lazy, so this is the same single evaluation every other route does) and
  checks the CONCRETE value. A follow-up round (same day) closed the
  swallow itself engine-wide: an `Error`-valued statement now
  short-circuits `evaluateStatements` like `Return` (the error is the
  block's value) and stops `runLoop` — extending to function bodies, blocks
  and loops the posture `executeEpsil` already took for top-level
  statements (`runtime-error` diagnostics). An application whose body
  faults keeps the standing decline convention (`result.isValid ? result :
  undefined`): the call stays inert rather than answering a value computed
  past the fault.
- The per-plan result convention (`branchComplexCoercion` across the arms)
  is part of the helper cache key (`$cx` suffix): the same edge emitted by a
  coercion-free plan and reused by a mixed real/complex chain gets two
  helper variants rather than one wrong convention.
- Complex-conventioned protocol parameters follow the multi-clause unanimity
  rule for call-site coercion; a mixed real/complex candidate set stays
  uncoerced at that position.
- ~~The pre-existing generic `Assign` lowering still emits `_ = v` for
  non-protocol non-symbol LHS shapes (e.g. record field assignment) — out of
  scope here, flagged.~~ CLOSED 2026-08-12: the generic lowering now THROWS
  on any non-symbol LHS (fail closed, D6). The reachable shape was the
  `Subscript` sequence definition (`L_0 := 5` inside a compiled body
  compiled to `_ = 5` under `success: true` — a sloppy-mode global write); a
  non-protocol `Field` LHS never reaches it (the `Assign` canonical/evaluate
  routes reject it with `incompatible-type` first).
- `Typed` was added to `STRUCTURAL_HEADS` (reference analysis only): it has
  a bespoke, always-lowerable branch in `compileExpr`, and canonical
  function bodies carry their return marker as a `Typed` node — without
  this, every annotated body was mislabeled unsupported.

## Test coverage

`test/compute-engine/protocol-dispatch-compile.test.ts` (tier matrix, route
parity incl. `Apply(Field…)`, properties GET/SET/readonly, sum×protocol
tagged dispatch, decline pins, Python fail-closed);
`test/compute-engine/protocol-dispatch.test.ts` "compilation" block re-pinned
(the bare fail-closed pin flipped to the compiled behavior; the
zero-conformance qualified pin deliberately re-asserted).
