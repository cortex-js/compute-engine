# Protocols — Design and Implementation Plan

Status: **ratified 2026-08-12** (user ratified roadmap §7 item 6 in full).
Surface specification: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A (revised
2026-08-12 after dual review) — that appendix is the authoritative user-facing
grammar and semantics; this document is the implementation architecture, the
numbered ruling record, and the test plan. On any conflict, Appendix A wins
for surface behavior and this document wins for internals.

Prerequisites, all shipped: the `where` clause with the reserved `is` slot
(`docs/plans/2026-08-11-where-clause-type-constraints.md` — `TypeParameter.
protocols` parses/stores/round-trips, rejected in `validatePolytypeArm`);
the global type registry (`docs/plans/2026-08-10-global-type-registry.md`,
whose §5 pre-writes the alignment: "Protocols add a second kind of registry
entry, not a second scoping regime"); state-event invalidation
(`noteStateEvent` as sole axis writer).

Out of scope (deliberate): the `Iterable`/`Indexable` built-in protocols and
membership-granting conformance (roadmap §4 bridge — needs its own
requirement-table design doc, §7 item 6(h)); parameterized protocols;
protocol refinement (`protocol A is B`); compilation of dynamic dispatch
(fail-closed: the compiler declines, matching the sum-compilation posture).

## 1. Ruling record

Surface rulings P1–P8 restate roadmap §7.6 (ratified); P9+ are
implementation rulings made by this document.

- **P1 — Dispatch on the first `Self` argument.** Dynamic dispatch keys on
  (member name, runtime type of the first argument); most-specific
  registered conformance wins. Static checking binds `Self` to the first
  argument's *static* type; every other `Self`-typed parameter checks
  against that binding. No joining of `Self` across arguments.
- **P2 — Property assignment is rebinding sugar.** `p.name = v` ⇝
  `p = «set name»(p, v)`. The LHS root must be an assignable binding;
  non-variable roots (`xs[i].name = v`) emit
  `property-assignment-target-invalid` in v1.
- **P3 — Pending conformance is an end-of-batch warning, not an error.**
  `executeEpsil` scans the registry after the evaluation loop and emits a
  `protocol-implementation-pending` warning for each still-pending
  conformance — every batch, until fulfilled (per Appendix A). Dispatch
  through a pending conformance is a runtime error value.
- **P4 — Overlap predicate = inhabited meet.** Two conformance targets
  overlap iff their meet is non-empty. A new conformance overlapping an
  existing one for the same protocol without comparability (neither a
  subtype of the other) is `protocol-conformance-overlap`.
- **P5 — Statement re-run replaces; host API throws.** Re-executing a
  `protocol` declaration or implementation block via Epsil replaces
  (matching `type`'s `_declaredByStatement` convention); host
  `declareProtocol`/`declareProtocolImplementation` throw on
  re-declaration. Conformance edges are add-only (monotone); only their
  implementations replace.
- **P6 — D16 amendment for qualified property access.** `person.(P.name)`
  gets a new field-grammar production (parenthesized qualified field name).
  Phase 4.
- **P7 — Trust model deferred.** No registry freeze / host-authorization
  control in v1; documented guidance is one engine per trust domain.
  (Ratified as "open, not blocking".)
- **P8 — No dual-role names.** Protocol names are never types
  (`protocol-in-type-position`); `collection` stays a pure type. The §4
  bridge protocols are out of scope here (see header).

Implementation rulings:

- **P9 — Overlap is computed with `reduce.ts` meets, not `narrow()`.**
  `subtype.ts`'s `narrow2` short-circuits incomparable pairs to `never`
  without consulting `meetNumericRanges`, so it cannot decide
  `integer<1..10>` vs `integer<5..20>` (meet `integer<5..10>`, inhabited).
  Export a `typesOverlap(a, b): boolean` helper from
  `src/common/type/reduce.ts` built on `meet2`/`meetNumericRanges`/
  `meetUnion`, treating both bottom spellings (`'never'`, `'nothing'`) as
  empty. Verify empirically against the ranges case before wiring in.
- **P10 — Registry shape.** A single engine-global
  `ce._protocolRegistry: Record<string, ProtocolRecord>` beside
  `_typeRegistry` (index.ts:490), mirrored on `IComputeEngine`
  (types-engine.ts, beside `_typeRegistry` at :234):

  ```ts
  type ProtocolMember =
    | { kind: 'function'; signature: string }        // contains `Self`
    | { kind: 'readonly' | 'readwrite'; type: string };
  type ConformanceRecord = {
    target: Type;            // named ground type (or head pattern, phase 5)
    targetKey: string;       // canonical serialization, for dedup/replace
    where?: TypeParameter[]; // conditional conformance (phase 5)
    impl?: Record<string, BoxedExpression | JSImplementation>;
                             // member name -> function literal; property
                             // handlers under mangled keys __get__x/__set__x
    pending: boolean;
    declaredByStatement: boolean;
  };
  type ProtocolRecord = {
    name: string;
    members: Record<string, ProtocolMember>;
    conformances: ConformanceRecord[];
    declaredByStatement: boolean;
  };
  ```

  Records mutate in place (same reason as `TypeReference`: captured
  references). `ce._protocolRegistryRollbackPoint(): () => void` mirrors
  `_typeRegistryRollbackPoint` (per-record field snapshot, `changed` flag
  gating the axis bump) and is invoked in `staticDiagnostics()` alongside
  the type rollback (static-diagnostics.ts:100–136).
- **P11 — MathJSON forms.** Two new lazy operators in `library/core.ts`,
  registered from both `canonical` and `evaluate` handlers exactly like
  `DeclareType` (core.ts:2540–2585), with the same top-level +
  `'epsil:static-check'`-surrogate gate (core.ts:715–732 pattern; both the
  frame name AND `_staticTypeCheckDepth > 0`, name alone is forgeable):

  ```
  protocol Comparable { function compare(self: Self, other: Self) -> "<"|"="|">" }
    → ["DeclareProtocol", "Comparable",
        ["Dictionary", ["KeyValuePair", "compare",
          ["Pair", {str: "function"}, {str: "(self: Self, other: Self) -> \"<\"|\"=\"|\">\""}]]]]

  type string is Hashable & Comparable
    → ["DeclareConformance", {str: "string"}, ["List", "Hashable", "Comparable"]]

  type string is Comparable { function compare(...) {...} }
    → ["DeclareConformance", {str: "string"}, ["List", "Comparable"],
        ["Dictionary", ["KeyValuePair", "compare", <function literal>]]]
  ```

  The target rides as a *string* (type expression source), like
  `DeclareType`'s body. Member signatures ride as strings and are parsed
  by the type layer at execution (so `Self` handling is engine-side, not
  parser-side). Serializer entries in `serialize-epsil.ts` beside
  `DeclareType` (:715); round-trip pinned by tests.
- **P12 — `Self` is a substitution, not a type variable.** Protocol member
  signatures are stored verbatim with `Self`. At validation/dispatch time
  the engine substitutes the concrete target type textually before calling
  `parseType` (a `Self`-aware wrapper; `Self` never reaches the global
  type registry and cannot be declared — reserved in the host API like
  `where`/`forall`). No change to the type grammar.
- **P13 — Dispatcher definitions.** When a protocol declares function
  member `f`, the engine installs a global operator definition for `f`
  (flagged `_protocolDispatcher: true`) whose `evaluate` handler performs
  P1 dispatch — the same install pattern as multi-clause's
  `installClauseList` (multi-clause.ts:639), with selection against
  conformance targets via `isSubtype` (most-specific = minimal target
  under subtyping; ties are impossible by P4). Rules:
  - If the name already has a non-dispatcher user definition, do NOT
    install; qualified calls still work (user shadow, Appendix A pipeline
    step 1).
  - A later user definition of the same name replaces the dispatcher
    (statement-replace flows already permit this); the dispatcher is
    re-installed if the user definition is later removed only via protocol
    re-declaration (no active un-shadowing in v1).
  - When two protocols share a member name, ONE dispatcher handles both:
    it filters candidate (protocol, conformance) pairs by applicability of
    the first argument's runtime type; several applicable →
    `protocol-call-ambiguous` error value (per-call-site rule).
  - The dispatcher's `type:` handler computes the result type by binding
    `Self` = static type of ops[0] and checking remaining `Self`
    positions (`incompatible-type` on mismatch) — P1's static half.
- **P14 — Qualified calls via protocol symbols.** `DeclareProtocol`
  declares a value symbol named after the protocol whose type is a
  dictionary-like opaque value; `Field(Comparable, "compare")` (which
  already parses and evaluates through `library/collections.ts:4111`)
  returns a bound single-protocol dispatcher function value, so
  `Comparable.compare(x, y)` = `Apply(dispatcher, x, y)` works with zero
  parser changes. `Field` on a protocol symbol with an unknown member →
  `unknown-field` (existing path).
- **P15 — Parser surface.** In `src/epsil`:
  - `protocol` moves from `RESERVED_WORDS` (listed-but-unused,
    reserved-words.ts:128) to `ACTIVE_WORDS`; `parseStatement`'s switch
    (parser.ts:579–624) gains a `'protocol'` case → `parseProtocolStatement`
    (top-level only, same `blockDepth` gate and recovery as
    `parseTypeStatement`). `readonly`/`readwrite`/`get`/`set`/`Self` are
    contextual — NOT added to reserved words (they only have meaning
    inside protocol/implementation braces; `self` stays an ordinary
    identifier).
  - `isTypeStatement()` (parser.ts:1197) widens: after `type Name`
    (or `type Name<...>`), a same-line SYMBOL `is` also claims the
    statement (conformance form). The existing expression-position
    `is` type test (TYPE_TEST_PRECEDENCE, parser.ts:4309) is unaffected —
    statement position is disjoint.
  - The combined form `type Point = tuple<...> is Comparable` is parsed by
    `parseTypeStatement` noticing a trailing same-line `is` after the body
    (the type-body scan already stops correctly: `is` cannot begin a type
    token) and lowering to TWO statements: `DeclareType` then
    `DeclareConformance`.
  - New parse-time diagnostic codes (added in `diagnostics.ts` +
    `cli/format.ts` + tests, the three mandatory places):
    `protocol-declaration-not-top-level`, `protocol-member-keyword-missing`,
    `protocol-member-signature-expected`, `protocol-name-expected`.
    Engine-side codes (error values, not parse diagnostics):
    `protocol-target-unknown`, `protocol-conformance-target-invalid`,
    `protocol-conformance-overlap`, `protocol-implementation-split`,
    `protocol-implementation-missing`, `protocol-implementation-duplicate`,
    `protocol-member-unknown`, `protocol-signature-mismatch`,
    `protocol-property-readonly-set`, `protocol-constraint-unsatisfied`,
    `protocol-in-type-position`, `protocol-call-ambiguous`,
    `protocol-property-ambiguous`, `property-assignment-target-invalid`,
    `protocol-unknown` (P21), `protocol-scope-invalid` (nested
    DeclareProtocol/DeclareConformance reaching the engine — the box-route
    twin of the parser's `protocol-declaration-not-top-level`), and
    `invalid-protocol-declaration` (malformed-shape catch-all on the box
    route, the DeclareType `invalid-type-declaration` analog).
    (`protocol-implementation-pending` is a WARNING diagnostic emitted by
    `executeEpsil`, P3.)
- **P16 — Invalidation.** Fresh protocol declaration: `{kind: 'declare',
  callable: true, shadowsCallable: …}` via the dispatcher's own
  `ce.declare`. Protocol/implementation REPLACEMENT and conformance
  addition: `{kind: 'config'}` (all axes) — same class as type
  redefinition (engine-declarations.ts:1016–1033). Conformance addition
  must invalidate cached static dispatch decisions, hence `config`, not
  `declare`.
- **P17 — Signature matching is checked at implementation registration.**
  After substituting the target for `Self` (P12): implementation signature
  must be a subtype of the requirement (params contravariant, result
  covariant, effects equal-or-purer — the existing signature-subtype
  machinery in `subtype.ts` already implements function subtyping with
  effects). Arity must match exactly; no optional/variadic/generic protocol
  members in v1; one implementation per member.
- **P18 — Properties ride the `Field` operator.** The `type:` and
  `evaluate:` handlers of `Field` (collections.ts:4121/4148) gain a
  protocol-property branch: if `fieldBearingType` yields nothing, look up
  (base's type, field name) in the conformance registry — most-specific
  conformance, same P1 selection; found readonly/readwrite property →
  invoke `__get__<name>` implementation. Ambiguous across protocols →
  `protocol-property-ambiguous`. `Assign` canonical (core.ts:1857+,
  currently `checkType(ce, lhs, 'symbol')`) gains the P2 rewrite branch
  BEFORE the symbol check: `Assign(Field(sym, name), v)` where sym's type
  has a readwrite protocol property → `Assign(sym, «__set__name»(sym, v))`;
  `Field` root not a bare symbol → `property-assignment-target-invalid`.
- **P19 — `is`-slot activation (phase 4).** `validatePolytypeArm`
  (instantiate.ts:543–561) keeps rejecting `protocols` on declarations
  UNTIL phase 4, then: the declaration validator accepts the slot, and the
  satisfiability phase (after S1–S3 complete, beside the §5 bound check in
  `uppersOf`'s consumer) substitutes each solved binding and consults the
  conformance registry; failure → `protocol-constraint-unsatisfied` error
  value at the call site. The type layer must NOT import the engine:
  conformance lookup reaches the type layer the same way name resolution
  does — extend the `TypeResolver` seam (types.ts:630, one new optional
  method `conformances?(typeKey: string): string[]` implemented by
  `engine-type-resolver.ts`) so `common/type` stays engine-free.
- **P20 — `scanUnknownFunctions` must know dispatchers.** Since P13
  installs real operator definitions, `ce.operatorInfo(head)` finds them
  and the advisory pass (execute-epsil.ts:363–415) needs no change —
  pinned by a test (bare protocol call produces no `unknown-function`
  warning).

Phase-1 outcome rulings (2026-08-12, flagged by the implementer):

- **P21 — `protocol-unknown`** is the error code for a conformance naming an
  unknown *protocol* (Appendix A's table only had `protocol-target-unknown`
  for an unknown type). Engine-side error value.
- **P22 — First-parameter `Self` inference is a phase-2 item.** Appendix A
  allows `function compare(self, other: Self)`; the type grammar rejects
  mixed named/unnamed parameters, so phase 1 requires an explicit
  `self: Self` (`protocol-self-required` otherwise). Phase 2 implements the
  sugar by parser-side source rewrite (inject `: Self` on an unannotated
  first parameter of a protocol member), not by a type-grammar change.
- **P23 — Sum sugar and conformance do not combine** in one statement
  (`type node = a(x) | b(y) is P` — the sum-arm scanner reads to end of
  statement). Declare the sum, then conform, as two statements. Deliberate;
  revisit only on demand.

Phase-2 outcome rulings (2026-08-12):

- **P24 — Statement-route re-implementation replaces; only the host route
  emits `protocol-implementation-duplicate`.** The engine has no statement
  identity to distinguish a notebook re-run from a second block, and P5
  makes re-run-replace the convention. Appendix A's duplicate example is
  amended accordingly. Replacement validates FIRST — an invalid block
  leaves the previous valid implementation intact (atomicity).
- **P25 — The `set` handler's result type is unchecked** (Appendix A says
  "conventionally" the property type); the requirement rides as
  `(Self, T) -> any`. Tighten only on demand.
- **P26 — Replacing a protocol revalidates every stored implementation**
  (full P17 check, not just coverage); a no-longer-matching conformance
  reverts to `pending`. Required by "Scope and lifecycle" — phase-3
  dispatch must never read a stale implementation.
- **P27 — Host callback typing**: `ProtocolHostHandler =
  (...args: Expression[]) => unknown` (the `types*.ts` no-explicit-`any`
  gate forbids the roadmap's sketch spelling). Inline arrows contextually
  type fine. Host implementations are trusted (no signature check —
  coverage/unknown-member/readonly-setter only), like host-declared
  operator handlers. Host-created conformance edges carry
  `declaredByStatement: false`.
- **P28 — Unannotated implementation results/effects are trusted** (a
  literal with no return marker declares no result and no effects; both
  pass P17 unchecked). Consistent with the engine's trusted-ascription
  posture (generic-function-literals design: correlated returns are
  trusted). Inference from the body would require canonicalizing under a
  `Self`-mentioning signature — revisit only if it bites in practice.
- **P29 — Empty-collection overlap is accepted at conformance time and
  resolved at dispatch time.** `list<string>` and `list<integer>` may both
  conform (their only shared value is the empty collection); strict P4
  would reject them, which is unacceptably restrictive. Instead, phase-3
  dispatch MUST emit the `protocol-call-ambiguous` runtime error value
  when a runtime value (e.g. `[]`) matches several most-specific
  implementations tied under subtyping. This is a phase-3 acceptance
  criterion.
- **P22 addendum**: the `Self` sugar covers the first parameter only and
  NORMALIZES — the stored/serialized form is always explicit `self: Self`
  (re-parse is a fixed point). The `Self` substitution is implemented as
  an alias `TypeReference` named after the target, which makes `Self` and
  the target's own name synonyms in implementations and produces
  substituted spellings in diagnostics for free.

Phase-3 outcome rulings (2026-08-12):

- **P30 — A qualified call lowers to a new `ProtocolMember` operator.** P14
  said `Field(P, "m")` returns "a bound single-protocol dispatcher function
  value" without saying what that value IS. There is no JS-backed function
  VALUE in the engine — only named operator definitions and `Function`
  literals — so `Field` returns the literal
  `(self, other) |-> ProtocolMember("P", "m", self, other)`, and
  `ProtocolMember(protocol, member, args…)` (core.ts, beside
  `DeclareConformance`) runs the P1 selection restricted to that one
  protocol. Rejected alternatives: one hidden global operator per
  (protocol, member) pair (pollutes the global namespace and the
  spellcheck/`About` surfaces), and an inert marker expression (`apply()`
  refuses to beta-reduce a non-`Function` function-typed head, so
  `Apply(marker, …)` would stay symbolic). The lowering makes the qualified
  name a first-class value, so it can also be mapped/piped.
- **P31 — Dispatcher rollback is the frame pop, not an explicit restore.**
  `_protocolRegistryRollbackPoint` covers the REGISTRY only. The dispatcher
  installs are covered by the surrogate frame instead, exactly as a pre-pass
  MINTED CONSTRUCTOR is: `syncProtocolDispatchers` installs into
  `ce.context.lexicalScope` when the surrogate is active and into the global
  scope otherwise, and it consults only that one scope's own bindings — so a
  pre-pass install disappears with the frame, and a pre-pass protocol
  REPLACEMENT can neither refresh nor remove the dispatcher the real program
  installed. An explicit binding snapshot would be redundant with the pop.
  Pinned by two tests in `protocol-dispatch.test.ts`.
- **P32 — The dispatch admission test is `isSubtype(runtimeType, target)`,
  with a single "is the receiver settled?" gate in front of it.** The
  tri-state `admissionOf` was tried first and is WRONG here: it answers
  `undecidable` for `3.5` against `integer` (the synthesized type
  `finite_real` is not provably disjoint from `integer`) and for `["a"]`
  against `list<integer>` (the two share the empty collection, P29), which
  left both calls symbolic instead of selecting the `number` /
  `list<string>` implementation. The receiver of a dispatch has already been
  EVALUATED, so its synthesized type is its principal type and a failed
  subtype test is a genuine refutation. Only a top type (`unknown`, `any`,
  `value`, `expression`) leaves the call symbolic.
- **P33 — A user definition SHADOWS a dispatcher through one carve-out in
  `defineFunctionClause`.** A dispatcher is an operator definition with a
  native handler and no `_lambdaLiteral`, which the clause machinery reads as
  an "opaque function (native handler)" and REFUSES to redefine. It is
  treated exactly like a builtin (`existing = undefined` → full replace), so
  Appendix A's name-resolution step 1 holds for the statement route.
- **P34 — The dispatcher's stored parameter types are `any`; the checking is
  in its `canonical` handler.** `Self` has no static spelling, so the
  signature carries only ARITY and the requirement's EFFECTS (the union
  across protocols sharing the name). The `Self`-position check runs in
  `canonical` and reports through `checkType`, i.e. by wrapping the offending
  ARGUMENT in `incompatible-type` — which is what makes Appendix A's
  `compare("a", 3)` name argument 2. With several protocols on one name, only
  the positions every candidate spells `Self` are checked.

Phase-3 review-round rulings (2026-08-12):

- **P35 — Open-world carve-out for the static missing diagnostic.** A bare
  call to a member that NO candidate protocol has any conformance for stays
  quiet (undecidable — conformance is monotone and may arrive in a later
  batch); the static `protocol-implementation-missing` diagnostic fires
  only when at least one conformance exists and the settled receiver type
  matches none. Tension accepted: `describe(3)` against a string-only
  `Describable` fires even though a later cell could conform `integer` —
  the diagnostic is advisory-static, and the runtime path remains correct
  either way. Applicability is two-way subtyping
  (`isSubtype(r,t) || isSubtype(t,r)`), per Appendix A's wording.
- **P30 addendum** — `ProtocolMember` now HAS a canonical handler
  (qualified calls get exact-arity + `Self`-position checks restricted to
  the named protocol); the phase-3 deviation is closed. The qualified route
  does no applicability filtering — the author named the protocol.

Phase-4 outcome rulings (2026-08-12):

- **P36 — The conformance oracle is `TypeResolver.conformsTo?(type,
  protocol): boolean`**, not P19's sketched `conformances(typeKey)` list —
  inheritance is a subtype question a key-indexed list cannot answer.
  Threaded per-engine via `InferenceOptions.resolver` /
  `validateDeclaredType(t, resolver?)`, never a module global (registries
  are per-engine; pinned).
- **P37 — Parser-side resolver shims answer `conformsTo: () => true`.**
  `parseEpsil` has no engine registry, so `is` constraints are never
  refused at parse time; the check lives entirely at engine call sites.
  Declarations are open-world (an unseen protocol name never refuses a
  declaration); an unknown protocol AT A CALL SITE is
  `protocol-constraint-unsatisfied` (nothing conforms to a protocol that
  does not exist).
- **P38 — Property assignment defers when the receiver is untyped at
  canonicalization.** The static pre-pass canonicalizes whole batches
  before anything runs, so `p.name = v` routinely sees `p` untyped; a
  `'defer'` verdict keeps the Field LHS raw and re-resolves from `Assign`'s
  evaluate. Non-protocol Field assignment is byte-identical to before
  (pinned). The non-variable-root check uses a LAX applicability predicate
  (`couldBeProtocolProperty`) — the strict P32 gate would silently revert
  protocol cases to `incompatible-type`.
- **P39 — Qualified property access lowers to a `ProtocolProperty`
  operator** (`["ProtocolProperty", P, name, base]`; optional 4th operand =
  setter invocation, no surface spelling, serializer falls back to call
  form). The D16 grammar keeps `symbol-expected` as its bad-field-name
  diagnostic (the `field-name-expected` code named in older docs never
  existed). Qualified property ASSIGNMENT is v1-out
  (`property-assignment-target-invalid`).

Phase-4 review-round rulings (2026-08-12):

- **P40 — Bottom conforms vacuously.** `conformsTo('never', P)` is
  unconditionally true (consistent with subtype vacuity, deterministic).
  Without this, a Rule-U ground-arm solution (`opt<T>` at `missing` →
  `T = never`) had a registry-content-dependent verdict.
- **P25 amendment** — an ANNOTATED setter result must be
  subtype-compatible with the Self-substituted receiver type
  (`protocol-signature-mismatch` otherwise), and the evaluate path checks
  the returned value before rebinding. Unannotated results remain trusted
  (P28). The original "setter result unchecked" wording allowed a silent
  receiver rebind to an unrelated type.
- **P41 — Baked protocol names in property writes re-resolve on miss.**
  The 'rebind' sugar bakes the winning protocol at canonicalization; if at
  evaluate the baked protocol has no applicable edge for the current
  receiver, resolution re-runs across all protocols (mirroring the
  dynamic read path) before erroring.
- `protocol-in-type-position` is now implemented at the engine's
  unknown-type boundary (a name found in `_protocolRegistry` gets the
  constrained-variable guidance instead of a generic unknown-type error).
  It is raised by `ce._typeResolver.resolve()` as a `TypeVariableError`, so
  it covers every route that parses a type WITH the engine's resolver —
  `ce.type()`, `ce.declare()`, the box `Declare`/`Typed`/signature-marker
  routes. The Epsil PARSER is not one of them: it builds its own resolver
  from `typeNames` and reports the annotation as `type-annotation-error`/
  `Unknown type` before the engine ever sees it. Reaching that route needs a
  `protocolNames` seed on `parseEpsil`/`executeEpsil` — still open.
- Refuted (re-raise of ruled P28): "unannotated implementations bypass
  result/effect requirements" — trusted-ascription posture stands.

Phase-5 outcome rulings (2026-08-12):

- **P42 — The head and its clause are parsed as ONE synthetic signature.**
  `parseConditionalTarget` builds `(self: <head>) -> nothing where <clause>`
  and hands it to `parseType` with the engine's resolver. That is what makes
  the type grammar's declaration-time validation apply verbatim to a
  conformance: duplicate variables, non-ground bounds, a clause variable the
  head never mentions ("quantified but never used"), an unbound head variable
  (an unknown type name), and the `is` slot's oracle requirement all come back
  for free. `ConformanceRecord.where` did NOT already exist (P10 described it
  but types-engine.ts did not carry it); it was added in this phase.
- **P43 — Applicability = head match + per-argument clause check**, in
  `src/common/type/conditional-conformance.ts` (a type-layer module, since the
  engine's `conformsTo` oracle and `engine-protocols.ts` must answer
  identically and the type layer may not import the engine). `reduce.ts`'s
  `sameHeadArguments` was NOT reused: it treats differing `dimensions` as
  incomparable, and `["a","b"]` synthesizes `list<string^2>`, which `list<T>`
  must match. An UNDECIDED extracted argument (top or compound) is ADMITTED,
  mirroring `checkProtocolConstraints`.
  Every receiver-less comparison — the lattice-inheritance pass, the two-way
  static applicability — goes through the WIDEST instantiation (variables read
  as their bounds), because `isSubtype` must never be handed an open type
  (`assertGroundType`). At dispatch, a conditional candidate competes for
  specificity as its INSTANTIATED head.
- **P44 — One conformance per (head, protocol), keyed on the CONSTRUCTOR.**
  `headKeyOf` reduces a target to its constructor identity (`list<string>` and
  `list<T>` are both `list`), so a conditional edge excludes any other edge on
  the same head — in both orders — under `protocol-conformance-overlap`. The
  P4 meet rule is skipped for conditional edges (a head pattern is not a set of
  values the meet algebra can weigh). `targetKey` carries the clause
  (`list<T> where T is Comparable`), so re-running the identical statement is
  the ordinary no-op while a DIFFERENT clause on one head hits the head rule
  instead of silently replacing.
  The `conformsTo` oracle became RECURSIVE (`list<list<string>>` asks
  `list<string>` asks `string`); a per-resolver in-flight set keyed on
  (type, protocol) answers `false` on re-entry, which is what keeps a
  self-referential conformance over a recursive type (`type alias tree =
  list<tree>`) terminating.
- **P45 — An implementation block under a clause takes the ERASED lowering.**
  A member parameter whose annotation mentions a clause variable lowers to a
  bare symbol with the FULL signature (clause included) riding as the body's
  ascription — §3.1's rule for `function f(x: T) … where T`, and the only way
  the literal survives boxing (its `list<T>` annotation would otherwise name a
  variable no clause declares). Consequences: the clause is appended ONLY when
  some parameter is quantified (an unused clause would fail the grammar's own
  check), and `declaredImplementationSignature` now recovers an erased
  parameter's declared type from the marker signature — without that, P17 read
  it as `any` and accepted every annotation. Validation runs at the WIDEST
  instantiation, so it stays a ground signature comparison; `Self` is spelled
  as the head pattern in the diagnostics.
  Carried over from phase 4: `protocolNames` is now threaded
  `parseEpsil` → `Parser` → `executeEpsil`, giving the Epsil route the
  `protocol-in-type-position` diagnostic. Protocol names are a SEPARATE set,
  consulted only on the unknown-type path — they never become type names (P8).
- Observation, NOT a phase-5 regression: P1's static half binds `Self` to the
  receiver's principal type, dimensions included, so `compare(["b"], ["a","c"])`
  is `incompatible-type` (`list<string^1>` vs `list<string^2>`) — with an
  unconditional `type list<string> is Comparable` too. Lexicographic comparison
  of lists of DIFFERENT lengths therefore needs a widening of the `Self`
  binding (or a shape-erasing receiver type) that is out of this phase's scope.

Phase-5 review-round rulings (2026-08-12):

- **P46 — Dictionary key semantics keep precedence over protocol
  properties.** For a dictionary-typed receiver, `d.x` remains key access
  (long-standing data-access semantics; changing it risks silent behavior
  changes in existing programs). A protocol property on a dictionary
  conformance target is reachable via qualified access
  (`d.(P.x)`) only. Reviewer-proposed protocol-first precedence was
  rejected as a product call.
- Non-`Self` parameters and setter values are validated at every call
  site (static per-position join across applicable protocols; runtime
  against the selected requirement); conditional implementations validate
  covariant result positions with clause variables PRESERVED (widest
  instantiation is contravariant-only); `matchHead` honors named-tuple
  field names per the `couldMatch` rule; parser protocol-name seeding is
  success-only. Residual (deliberate over-rejection): a conditional
  implementation's covariant result must equal the requirement pattern up
  to the clause binding — `-> list<integer>` under `list<T> where T:
  number` is sound covariantly but rejected; admit narrower results only
  if demand appears.

## 2. Phasing

| Phase | Delivers | Gate |
|---|---|---|
| 1 | `protocol` statement, `_protocolRegistry` + rollback + surrogate integration, `type X is P` conformance (targets, P4 overlap, P3 pending, monotonicity, `&` split), `ce.declareProtocol`, IComputeEngine parity, diagnostics | typecheck + new suites + declare-type suites green |
| 2 | Implementation blocks (member validation, P17 matching, property get/set validation, P5 replace-vs-duplicate), `ce.declareProtocolImplementation` | + phase-1 suites stay green |
| 3 | P13 dispatchers (bare-name pipeline, dynamic dispatch, static Self checks), P14 qualified calls | + multi-clause suites green |
| 4 | P19 is-slot activation, P18 properties + P2 assignment sugar, P6 D16 amendment | + where-clause + generic-function-sugar suites (3 pinned rejection messages flip) |
| 5 | Conditional conformance (head pattern, `where` binding, one-per-(head,protocol), dispatch applicability) | full suite |

Each phase: implement → typecheck (`npm run typecheck` + native tsc on
src/) → madge (`npm run check:deps`) → targeted suites → stage → adversarial
review (review-staged) → fix → re-stage. No commits (user commits).

## 3. Test plan

New suites (analogs in parentheses):

- `test/epsil/protocols.test.ts` (template: `test/epsil/declare-type.test.ts`)
  — declaration forms, member keyword diagnostics, top-level-only pins,
  re-run replace, conformance forms incl. `&`, combined
  declare+conform statement, serialization round-trip.
- `test/compute-engine/protocols.test.ts` (template:
  `test/compute-engine/declare-type.test.ts`) — box-route `DeclareProtocol`/
  `DeclareConformance` (canonical AND evaluate routes — the lazy-operator
  route-parity trap), host API throw-vs-error-value channel split
  (template: `nominal-assign.test.ts` three-route table), surrogate-frame
  pin (`ce.pushScope(undefined, 'epsil:static-check')` forgery test),
  rollback of protocol registry in the static pre-pass, overlap matrix
  (comparable OK / incomparable-overlapping error / disjoint OK / bounded
  ranges `integer<1..10>` vs `integer<5..20>` error), pending lifecycle
  across two `executeEpsil` batches.
- `test/compute-engine/protocol-dispatch.test.ts` — P1 matrix
  (number/integer most-specific; compare("a", 3) static diagnostic;
  ambiguity across two protocols; user shadow; qualified call; runtime
  error value on no-implementation), state-event pins (conformance add →
  config mask; template: `state-events.test.ts`).
- Phase 4 flips three existing pins: `where-clause.test.ts:189/201`,
  `generic-function-sugar.test.ts:747/782`,
  `type-variables-epsil.test.ts:251` — from
  `protocol-conformance-unsupported` to working conformance checks. Do NOT
  update these before phase 4.
- Mirror updates: `reserved-words.test.ts` + `src/epsil/docs/literals.md`
  (`protocol` → active), `statements.test.ts` / `epsil-serialize.test.ts` /
  `round-trip.test.ts` / `formatter.test.ts` entries for the new statement
  forms, `state-events.test.ts` rows if any new event payload appears.

Regression watch: full `declare-type` suites (both routes), `sum-types` /
`sum-declaration-sugar` (parser statement dispatch shares code),
`multi-clause` (dispatcher install pattern), `where-clause`.

## 4. Traps carried forward (do not rediscover)

- Lazy operators with no canonical handler are inert on box/parse routes —
  both new operators need BOTH handlers (DeclareType is the template).
- The surrogate check needs frame name AND `_staticTypeCheckDepth`; name
  alone is host-forgeable (pinned pattern in declare-type tests :195).
- Registry records mutate in place; rollback snapshots FIELDS, and the
  thunk bumps axes only when it restored something.
- `knownTypeNames` only grows; protocol names need no parser seeding
  (protocol names are not types — P8 — so they must NOT be added to
  `typeNames`/`knownTypeNames`).
- Two meets, two bottoms (P9). `couldMatch` is NOT the overlap predicate.
- New def keys on operator definitions must be added to `OPERATOR_DEF_KEYS`
  or the whole definition is rejected (enumerability-facet finding).
- `BigDecimal.precision` is process-global; boolean use retypes symbols —
  test-file hygiene conventions apply.
