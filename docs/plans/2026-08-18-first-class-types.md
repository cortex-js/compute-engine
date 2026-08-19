# First-Class Types: type values and type algebra in Epsil

**Status:** Rulings R1–R8 DECIDED (2026-08-18); the pass-2 items (settling,
polytype relaxation, R5 mechanics amendment, R9) RATIFIED 2026-08-19.
**Phases 1 AND 2 are IMPLEMENTED** (2026-08-19). Phase 1: the R7 lookahead
spike PASSED — the name `type` stands — and the primitive, `TypeFrom` with
settling, `Subtype`, and the `==`/`isSame` tiers are in. Phase 2:
`MatchesType` (the R9 regime) and variadic `Conforms` are in; `is` and match
type patterns re-lower to the single IR; compound types and the protocol arm
work (`x is list<integer>`, `x is !error`, `x is Hashable & Comparable`);
`type-pattern-unsupported` retired; snapshot blast radius measured at ZERO
(13 AST pins across 4 suites updated to the new lowering — the ratified
change, surfaced not absorbed). Two phase-2 notes: (a) FUNCTION LITERALS are
excluded from R9's value forms in the conservative direction — an
unannotated literal's inference-widened signature would make a failed
`matches` a WRONG definitive False, so `fn is (integer) -> integer` stays
symbolic (pinned; revisit when literal signatures become
precise-by-construction); (b) an unevaluated test PRINTS as the explicit
`MatchesType(x, TypeFrom("T"))` call — it re-parses to the same node, and an
`is` print-sugar is bundled into R6's sugar revisit. Phase 3 remains. Review record (pass 2; pass 1 applied and superseded):
`docs/scratch/2026-08-18-first-class-types_SPEC_REVIEW.md`.
**Date:** 2026-08-18 (rulings), 2026-08-19 (phase 1)

## 1. Motivation

Epsil users want to ask type questions at runtime:

```epsil
x is integer                 // works today (simple names only)
x is list<integer>           // parses, then errors: type-pattern-unsupported
Subtype("integer", "number") // no way to spell this at all
let t = Type(x)              // no way to hold a type in a variable
```

The semantic core already exists (the subtype lattice, `BoxedType.matches()`,
the global type registry, the conformance registry). What is missing is a
**value-level representation of a type** — and that gap is the keystone: the
dynamic type test was deliberately restricted to simple named types because a
compound type such as `list<integer>` has no representation that the lowering
`["Element", x, <type>]` can carry (a symbol can name `integer`; nothing can
carry `list<integer>`).

## 2. Current state (verified 2026-08-18)

What exists:

- **`x is T`** for simple named types, including nominals. `3 is integer` →
  `True`; after `type point = tuple<x: integer, y: integer>`,
  `point(1,2) is point` → `True`. Parsed by `parseTypeTestTail`
  (`src/epsil/parser.ts`), lowered to `["Element", x, <name>]` — the same
  lowering `match` type patterns (`n: integer => …`) use, so the two surfaces
  agree by construction. Engine side: the type-name arm of `Element`
  (`src/compute-engine/library/sets.ts`, "Type-style membership") resolves the
  name with `ce.type(name)` and answers via `matches()` — note that arm is
  only DEFINITIVE-ON-FAILURE for numbers (`matches(...) ? true : undefined`);
  §5 replaces that asymmetry for the new operator.
- **`Type(x) -> string`** (`src/compute-engine/library/core.ts`): the STATIC
  observer — lazy, canonicalizes its operand but does not evaluate it.
  (Ruling R3 flips its RESULT to a type value; the observer semantics stay.)
- **Math-set membership**: `Element(3, Integers)` → `True`, value-based, on
  the number-set constants.
- **Types-as-strings convention**: `DeclareType`, conformance `where` clauses,
  and signatures all carry type expressions as strings, re-parsed by the
  engine. `DeclareType`'s type operand is an explicit `string|symbol` union
  parsed by its own `canonical` handler — there is no engine-wide
  "string accepted where a type is expected" mechanism (see §3.1).

What is broken or missing:

- **Compound types in `is` and in match patterns** parse and are then
  diagnosed `type-pattern-unsupported`; on the `is` route the diagnostic
  surfaces as an unrelated-looking
  `incompatible-type 'collection'` error value. Named as the prerequisite for
  `if let x: T = expr` in
  `docs/plans/2026-08-03-cortex-language-extensions-review.md`.
- **The string-equality trap**: today `Type(3)` is `"finite_integer"`, so the
  obvious user spelling `Type(x) == "integer"` is string equality, not a
  subtype test — it happens to hold for `let x = 3` (the symbol's inferred
  type prints `"integer"`) and fails for the literal `3`. There is no
  subtyping-aware comparison a user can reach.
- **No type-to-type predicates**: no subtype test, no expression-level
  conformance test (`is Comparable` exists only inside the `where`-clause
  grammar), no join/element-type extraction.

## 3. Design

### 3.1 Keystone: a `type` value kind that SETTLES to canonical text

`RegExp` (`src/compute-engine/library/regexp.ts`) is the starting template:
an opaque value minted from source text, validated at canonicalization when
the operand is literal, reported as a leaf primitive. This design departs
from the template in ONE deliberate way, explained under "Settling" — the
regexp plan (`docs/plans/2026-08-17-string-phase3-regular-expressions.md`)
compares values by RAW text (its decision D9), which lets a computed-operand
node stay inert forever; type values compare by CANONICAL text (R8), so the
value form must BE canonical, and an unsettled node is not yet a value.

- **New leaf primitive `type`** in the lattice
  (`src/common/type/primitive.ts`), sitting in `VALUE_TYPES` beside `regexp`
  and `color`: an opaque value, not a scalar, not a collection, no hidden
  element type. The name collides with the type-string grammar's
  forward-reference keyword (`<type_reference> ::= ("type")? <identifier> …`,
  `src/common/type/types.ts` grammar comment; `src/common/type/parser.ts`
  `_sawForwardRef`) — primitives are matched before references, so naively
  adding `'type'` to the primitive set breaks `parseType('type node')`
  (verified empirically 2026-08-18). **Ruling R7 (decided): keep the name and
  disambiguate by one-token lookahead**, contingent on the phase-1 spike
  (§4).
- **`TypeFrom(text: string) -> type`** (ruling R2, decided — the house
  `XFrom` conversion convention, alongside the existing `StringFrom`). The
  head is **public, callable Epsil syntax** — `TypeFrom("list<integer>")` is
  an ordinary function call, so `let t: type = TypeFrom("list<integer>")`
  works (the annotation is optional; inference types `t` from the value) —
  which is what makes evaluated type values serializable (§4 phase 1)
  without dedicated literal syntax (ruling R6).

**Settling `[RATIFIED 2026-08-19]`.** Constructing a type value SETTLES it: the text is parsed with
the forwarding-disabled resolver (below), REDUCED, and the node becomes
`TypeFrom("<reduced canonical text>")` — the stored operand IS the canonical
text, and the parsed `Type` object rides the node from birth. Two routes:

- A LITERAL operand settles at canonicalization — a typo or unknown name
  errors at the author's line, and the resulting node is inert (no further
  evaluation), exactly like `RegExp`.
- A COMPUTED operand makes the node an ordinary strict application;
  EVALUATION settles it (a parse failure is an error value at the call
  site). This is the departure from RegExp's "no evaluate handler": an
  unsettled computed node is a pending construction, not a value, so
  `TypeFrom` evaluates it into one.

What settling buys, and what it fixes:

- **Identity is immutable and cheap.** `isSame`/hash compare the STORED
  canonical text — plain string comparison, registry-independent, exactly
  as cheap as regexp's D9 — because canonicalization already happened at
  settling. A later type redefinition never rewrites the stored text, so
  two values that are `isSame` today are `isSame` forever: the set/
  dictionary-key stability R8 requires holds unconditionally, and the
  permanently-cached expression hash is safe.
- **Semantic operations are live.** `Subtype`, `MatchesType`, `Conforms`,
  and `==` use the parsed form, re-derived against the CURRENT registry
  when the redefinition version axis has bumped since the cached parse
  (`docs/plans/2026-08-10-global-type-registry.md` — the axis type
  redeclaration already bumps). The cache is pure memoization of the
  semantic parse; it never feeds back into the identity text.
- **Redefinition semantics are coherent and must be documented**: the
  stored text NAMES nominal types and reference-kept aliases, so semantic
  operations see their current meaning after a redeclaration; an eagerly
  EXPANDED construct (a generic alias application) was captured at
  settling, so the value keeps the expansion it computed — like any value
  computed from mutable state. Pin with tests: alias replacement,
  generic-alias use before/after redefinition, nominal redeclaration,
  forward-record fulfillment, and a value settled during the static
  pre-pass surviving rollback (rollback bumps the axes when it restored
  something, so the semantic cache re-derives; pre-pass values do not
  escape the surrogate frame).

**Construction is side-effect-free — on every route.** The resolver-aware
type parser accepts the forward-reference spelling `type Later` and
registers a placeholder via `TypeResolver.forward()` — a REGISTRY MUTATION.
Settling therefore parses with forwarding DISABLED, and a forward reference
or an unbound type variable in the text is an error, not a placeholder. The
SAME forwarding-disabled parse is used everywhere type text is consumed at
runtime: literal settling, computed settling, and the consumer-side parse of
a computed string handed directly to `Subtype`/`MatchesType`/`Conforms` —
no route may mutate the registry as a side effect of asking a question.

**Polytypes `[RATIFIED 2026-08-19]`.** Polytypes
(`where`-quantified signatures) ARE admissible as type values: `Type` on a
generic function must observe its static type honestly (R3), and the
canonical text — `where` clause included — parses, prints, and round-trips
like any other. What stays out this round are the COMPARISON operators:
`Subtype` and `MatchesType` reject a polytype operand with a named error
(`polytype-comparison-unsupported`) — comparing quantified types engages
`matches()`'s existential machinery, which deserves its own design pass.
(This replaces the earlier blanket rejection of polytype VALUES, which
conflicted with R3: `Type(genericFunction)` must return something.)

**String acceptance — `MatchesType` and `Subtype` only.** There is no
generic coercion facility in the argument checker, and the regexp plan's
D10 explicitly rejected implicit string→regexp coercion because a plain
string at those positions has a competing meaning (a literal match
subject). At `MatchesType`/`Subtype` type positions a string has **no**
competing meaning — `Subtype("integer", "number")` can only intend types —
so the ambiguity objection does not transfer. The mechanism is deliberately
narrow: these two operators declare the parameter `string|type` (an
explicit union, exactly the `DeclareType` pattern) and their `canonical`
handlers rewrite a LITERAL string operand to `TypeFrom(...)` — validation
at the author's line — while a COMPUTED string is parsed at evaluation
(forwarding disabled, above). No signature-checker hook, no rule other
operators inherit; overload ranking is unaffected because the union is
spelled in the signature. **`Conforms` is the deliberate exception**: its
subject is `any` (the type-value case is a runtime branch, not a signature
union) and its protocol operands are plain `string` — protocols are not
types, so there is nothing to rewrite to `TypeFrom` (§3.3).

### 3.2 Re-lower the dynamic type test; lift the simple-name restriction

With a type value to carry the payload, the deferred "typed-pattern work"
unblocks:

- **One IR for every type test.** Both `x is integer` and
  `x is list<integer>` lower to `MatchesType(x, TypeFrom("<source>"))`
  (ruling R1, decided) — simple names do NOT keep the bare-symbol form,
  because a bare symbol satisfies neither the operator's `string|type`
  parameter nor any coercion this design defines. `match` TYPE patterns
  lower identically, preserving the agreement-by-construction property
  between the two surfaces. `Element`'s existing type-name arm remains for
  direct MathJSON authors and the math sets; this plan neither extends nor
  removes it.
- **`is` is instance-of, never unwrapping, never `<:`.** `x is T` means:
  evaluate `x` once, then test the VALUE's precise type against `T` —
  formally `Subtype(P, T)` where `P` is the precise type of the settled
  subject. A type-value subject is a value like any other:
  `TypeFrom("integer") is number` → `False` (a type value is not a number;
  its type is the primitive `type`), and `TypeFrom("integer") is type` →
  `True` — which is precisely what makes "did I get a type value?" askable.
  Auto-unwrapping the subject would destroy that test. Type-to-type
  questions are `Subtype`'s job (§3.3).
- **The RHS of `is` is static; computed types use the operator forms.** The
  right side of `is` is parsed in TYPE grammar, so a type value held in a
  variable can never appear there (`x is t` would read `t` as an unknown
  type name and diagnose at parse time). The dynamic route is the operator
  spelling: `MatchesType(x, t)` and `Subtype(t, u)` accept computed
  `string|type` operands. The sugar is for statically written types; the
  operators are the general form.
- **Every `is` lowering is an observer**: `lazy: true` + `inspectsErrors:
  true`, like `Match` and `IsError` — a strict operator never sees an
  `Error` subject (propagation bubbles it away first), which would make the
  promised `x is error` / `x is !error` unimplementable. This contract
  covers `MatchesType` AND `Conforms` (§3.3) identically, so
  `err is Hashable` and `err is error` route the same way. The handler
  canonicalizes and evaluates the held subject exactly once, then tests.
- The parser's grammar guard already resolves the hard conflict: the lexer
  munches `&&`/`||` into single tokens, so a compound type after `is` is
  recognizable by a lone `|`, `&`, `<`, or `->`, and
  `x is integer && y is string` stays a conjunction of two tests. The
  compound path already parses today; it just has nowhere to go.
- The `type-pattern-unsupported` diagnostic retires for TYPE patterns.
  **Protocol names in match patterns stay OUT this round `[RATIFIED
  2026-08-19]`**: a match arm's `n: Hashable => …` annotation
  rides `finishBindingPattern` → `parseTypeAnnotation` — machinery SHARED
  with ordinary parameter and variable annotations, where a protocol name
  must NOT become silently legal — so admitting protocols there is a
  separate parser design, not a rider on this plan. The test is spelled
  with `is` instead (in the case body, or a guard if `match` has them).
  Phase 2's deliverable is scoped accordingly.

### 3.3 The algebra surface (small, on demand)

All of these are thin wrappers over machinery the engine already has:

- **`Type(x) -> type`** (ruling R3, decided): `Type` FLIPS to return a type
  value while keeping its static-observer semantics (lazy, canonicalizes but
  does not evaluate). The canonical text is recovered with a new
  **`StringFrom(t: type) -> string`** arm on the existing `StringFrom`
  conversion operator. This is a BREAKING change: existing
  `Type(x) == "some string"` comparisons now answer `False` (R8 — no
  type-vs-string text comparison); the supported idiom is `x is T` /
  `Subtype(Type(x), u)` / `StringFrom(Type(x)) == "..."`. The Tycho usage
  check (§7) must complete BEFORE this flip lands. `Type` on a generic
  function returns a polytype value (§3.1 "Polytypes") — pin a
  generic-function fixture in phase 3, round-trip included.
- **`Subtype(t, u) -> boolean`** — **true iff `t <: u`**, i.e. the FIRST
  operand is the (candidate) subtype: `Subtype("integer", "number")` →
  `True`, `Subtype("number", "integer")` → `False`. (Direction stated here
  because the codebase has prior confusion on exactly this — the `subsetOf`
  convention sweep.) Operands are `string|type` per §3.1; a polytype
  operand is a named error (§3.1). **This IS the type-comparison operator —
  no infix `<:` this round** (decided 2026-08-18): the comparison story is
  complete without it (`is` for value-inhabitance, `Subtype` for ordering,
  `==` for equivalence per R8), an infix form needs a new compound lexer
  token, and R6's verbose-by-design stance applies. `t <: u` as pure sugar
  for `Subtype(t, u)` is a named candidate for R6's sugar revisit — zero
  design risk later, since the semantics is fixed here. The relation is
  "is compatible with" — the same one annotations and signatures use,
  including the 2026-08-17 bare-name ruling (bare `list` ≡ `list<unknown>`,
  values-only). Exposing it makes that ruling user-visible;
  `doc/08-guide-types.md` §"Which spelling, when" becomes user documentation
  for this operator too. Acceptance matrix in §5.
- **`Conforms(subject: any, protocols: string+) -> boolean`** `[signature
  amended pass-2, RATIFIED 2026-08-19]`: variadic over one or more protocol names,
  answering the CONJUNCTION, with the subject evaluated exactly once — this
  is what `x is Hashable & Comparable` lowers to
  (`Conforms(x, "Hashable", "Comparable")`), so the conjunction spelling the
  `where` grammar already allows works on the `is` surface too; a `&` tail
  MIXING protocol and type names is a parse diagnostic this round. The
  operator is an observer (`lazy` + `inspectsErrors`, §3.2). Subject kinds:
  a `type` value asks whether that TYPE conforms; any other subject is
  evaluated and its precise type is asked. **What keeps the branch
  unambiguous: the primitive `type` itself declares NO protocol conformances
  in this round** — so a type-value subject can only intend the type-level
  question. (Engine-internal `isSame`/hash covers set and dictionary
  membership for type values without protocol `Hashable`; if `type` ever
  gains conformances, this branch must be revisited.) ENFORCEMENT GAP,
  surfaced by the phase-2 review (2026-08-19): nothing REJECTS a
  `DeclareConformance` targeting the primitive `type`, so a user can create
  the ambiguous state today. The guard belongs in the conformance
  declaration path (`src/compute-engine/engine-protocols.ts`) — deferred
  only because that file holds another session's staged work at the time of
  writing; it is phase-3 work, landed with the `Type` flip at the latest.
  The operator delegates
  to `TypeResolver.conformsTo`, whose full semantics — inherited,
  conditional, and pending conformances — are the contract, not a naive
  registry lookup. **Outcome matrix `[RATIFIED 2026-08-19]`**: a SETTLED subject (§5)
  is definitive both ways against the current registry (conformance is
  monotone, and the answer is correct at the moment asked — the version
  axis invalidates caches when declarations arrive later); an UNSETTLED
  subject stays symbolic this round — answering `True` from a declared
  type's conformance requires the downward-inheritance property of
  `conformsTo` (does a subtype inherit its supertype's conformance
  unconditionally?) to be verified first, a named follow-up; an UNKNOWN
  protocol name is an error value (mirroring `TypeFrom`'s unknown type
  name — `conformsTo` answering `false` internally is not license to
  report a clean `False` for a name that does not exist); a computed
  protocol string resolves at evaluation with the same error; an ERROR
  subject answers `False` for every protocol (the value's precise type is
  `error`, which declares no conformances) — pinned beside `err is error`.
  `x is Hashable` (ruling R5, decided) lowers here — a THIRD lowering case
  for `is`, distinct from `MatchesType`, selected at parse time (see R5).
- **Type values at existing type-STRING positions (the reverse direction).**
  A user holding `let t = Type(x)` will immediately try
  `DeclareType("alias2", t)`. In scope for phase 3: `DeclareType`'s type
  operand widens to `string|symbol|type`. Conformance `where` clauses stay
  text-only — they are verbatim re-parsed source by design (the P11
  pattern), and a value there has no source location to re-parse.
- Later, on demand: `CommonType(t, u)` (join/widen), `ElementType(t)` — both
  computed internally already (`joinParamAt`, `collectionElementType`).

Non-goals for this round: a runtime type-construction algebra (building
unions/intersections by operating on type values with `|`/`&` at the
expression level — compose in the type grammar or in the string instead);
infix `<:` (candidate sugar, above); protocol names in match patterns
(§3.2); making protocols types; conformances ON the `type` primitive
(above); polytype COMPARISON (§3.1 — polytype values themselves are in);
EXECUTABLE compilation of the new operators. **Compilation fail-closed
behavior is IN scope**, per phase: every built-in compile target — all FIVE:
`javascript`, `glsl`, `wgsl`, `python`, `interval-js`
(`src/compute-engine/engine-compilation-targets.ts`) — must reject a
`TypeFrom`, `MatchesType`, `Subtype`, `Type`, or `Conforms` node, and a
`type`-typed value crossing the compile boundary, with a compile-time
unsupported-operation diagnostic, never silently-wrong code. The rejection
belongs in the SHARED compile machinery (the base compiler's type gate),
not per-target, so custom registered targets fail closed too; each phase
adds per-target rejection tests for the operators that phase introduces
(§4), following the regexp plan's supported-vs-fail-closed test pattern.
Facts established while implementing phase 1 (2026-08-19): the shared gate
is IMPLEMENTED in `BaseCompiler.compile` — two narrow checks, (1) a node
whose result type is EXACTLY the `type` primitive (exact equality, never
`matches('type')`: declared types are routinely wider than runtime values,
so a wide-typed operand must not trip a static gate), and (2) a
`Subtype`/`MatchesType`/`Conforms` head whose operands are not all ground
type values or literal text. CONSTANT FOLDING is an allowed outcome and the
gate deliberately exempts ground calls — `Subtype("integer","number")`
folds through the interpreter to its correct boolean, which is right code,
not wrong code. All five targets fail closed through this one gate; note
the FAILURE SHAPE differs by documented contract — `javascript`/`glsl`/
`wgsl`/`python` throw from `compile()`, while `interval-js` converts the
throw into its `success: false` result shape with the same diagnostic in
`.error` (its `.code` is empty in that shape; a consumer reading `.code`
without checking `.success` misreads failure as an empty program — that is
the caller's contract to honor, not a target defect).

## 4. Phases

The phases are **dependent increments** — each builds on the previous. All
rulings and pass-2 amendments are ratified; the R7 spike passed (2026-08-19),
so no contingency remains open.

1. **`type` primitive + `TypeFrom` + string acceptance.**
   *First step — the R7 lookahead spike*: verify that `parsePrimitiveType`
   can decline bare `type` when the next token is an identifier, so
   `parseType('type')` yields the primitive while `parseType('type node',
   resolver)` keeps yielding a forward reference (plus the compound
   positions `list<type>` and `type | nothing`). If the lookahead cannot be
   made to work, R7 reopens on the rename option before anything else
   lands. Then: lattice, boxing, the SETTLING construction (§3.1), MathJSON
   serialization, Epsil printing — an evaluated type value serializes as
   the public constructor call over its canonical text, which reparses to
   an `isSame`-identical value; this IS the round-trip story, so it lands
   here, not later. `isSame`/hash on the stored canonical text; `==` as
   mutual subtyping (R8). **Fail-closed tests for `TypeFrom` AND `Subtype`
   across all five targets**, via the shared boundary check (§3.3).
   Deliverable: a type value round-trips both formats, settles (or errors)
   at construction on both the literal and computed routes, construction is
   registry-side-effect-free, `Subtype` works.
2. **Typed patterns.** Re-lower `is` and `match` TYPE patterns onto the
   single IR (`MatchesType`); lift the simple-name restriction; add the
   protocol arm of `is` (R5, single names and `&`-conjunctions — match
   patterns excluded, §3.2); fix the misleading `incompatible-type
   'collection'` surfacing. **Fail-closed tests for `MatchesType` and
   `Conforms`.** **Measure and surface the snapshot blast radius before
   landing** — re-lowering a widely-used construct is exactly the
   canonicalization churn CLAUDE.md's snapshot policy gates. Deliverable:
   `x is list<integer>`, `x is number | string`, `x is !error`,
   `x is Hashable`, `x is Hashable & Comparable`, and the equivalent match
   TYPE patterns (protocol patterns excluded) — the prerequisite for
   `if let` named in the 2026-08-03 review.
3. **Observers and the flip.** The `Type` flip to `-> type` plus the
   `StringFrom(type)` arm (R3) — **gated on the Tycho criterion (§7)** —
   `DeclareType` accepting type values (§3.3), the generic-function
   (polytype) fixture, and **fail-closed tests for `Type`**.
   `CommonType`/`ElementType` only if a consumer asks.

## 5. Semantics to pin in tests

- **Static vs dynamic split**: `Type` observes without evaluating
  (`Type(x)` for `x: real` valueless is the type value for `real`); `is`
  evaluates its subject and tests the value's precise type. Pin both on the
  same fixture.
- **`is` never unwraps**: `TypeFrom("integer") is number` → `False`,
  `TypeFrom("integer") is type` → `True`,
  `Subtype(TypeFrom("integer"), "number")` → `True` — all three on one
  fixture, so the value/type level split is pinned as a trio.
- **The decision regime is by NODE FORM (R9).** After the
  single evaluation, a **value form** — a node whose precise type derives
  from its own structure: number/string/character/boolean literals,
  collection values, function literals, nominal constructor values, error
  values, type values — is decided BOTH ways: `matches()` → `True`,
  otherwise a definitive `False` (the precise type of a value form is
  exact, so the new operator must NOT inherit the
  `matches(...) ? true : undefined` asymmetry of the current `Element`
  arm). Every **other** form — a valueless symbol, an unresolved
  application whose type is declared or inferred (`Ln(2)`, `f(2)`), a lazy
  collection — is three-way on its STATIC type: static `<:` T → `True`;
  static provably DISJOINT from T → `False`; otherwise the test stays
  symbolic. Fixtures: `[] is list<integer>` → `True` (value form;
  `list<nothing>` element covariance); `["a"] is list<integer>` → `False`
  (value form, definitive); `Ln(2) is integer` → symbolic (unresolved
  application typed `finite_real`, which overlaps `integer` — the type
  route cannot prove irrationality); `f(2)` typed `real` vs `integer` →
  symbolic; `f(2)` typed `string` vs `integer` → `False` (disjoint);
  a valueless `x: integer` vs `integer` → `True`; a function value; a lazy
  collection; tuples, records, unions on the right, absence-bearing
  collections, aliases, nominals.
- **Error subjects**: `err is error` → `True`, `err is !error` → `False`,
  `err is Hashable` → `False` (the `Conforms` matrix, §3.3), and all agree
  across the direct, piped (`|> `), box, and match-pattern routes — the
  `lazy` + `inspectsErrors` observer contract shared by ALL `is` lowerings
  (§3.2), pinned the way `IsError`'s route parity is.
- **Route parity generally**: the test operators hold operands — add
  box-route and parse-route probes, not only `ce.function(...)` probes (the
  `lazy`-operator trap recorded in `test/compute-engine/find-fit.test.ts`'s
  route-parity block).
- **Equality tiers (R8) and settling**:
  `TypeFrom("integer|real").isSame(TypeFrom("real|integer"))` → `true` —
  both settle to the same canonical text — with equal hashes; a COMPUTED
  construction (`let s = "integer"; TypeFrom(s)`) settles at evaluation to
  a value `isSame`-identical to `TypeFrom("integer")`; identity survives a
  type redefinition (settle, redeclare, `isSame` unchanged) while
  `Subtype`/`==` answer from the CURRENT registry; alias name vs its body —
  `isSame` `false`, `==` `True`; nominal vs its body — `isSame` `false`,
  `==` `False` (R4 opacity); `t == "integer"` → `False` for every type
  value `t`; `StringFrom(TypeFrom(s))` reparses to an `isSame`-identical
  value; malformed or unknown-name text errors on BOTH routes (literal: at
  canonicalization; computed: at evaluation); a reassigned string variable
  does not retroactively change an already-settled value.
- **`Subtype` acceptance matrix**: direction (`Subtype("integer","number")`
  `True` / reverse `False` / equal types both ways), `any`/`unknown`
  asymmetry (`Subtype("any","unknown")` → `False` per the 2026-08-17
  ruling), `never`, bare collection names vs `<any>` tops, aliases,
  nominals, function-signature variance, polytype operand → named error,
  malformed text → error value, unknown name → error value,
  computed-string operands, wrong-kind operands.
- **`Conforms` matrix (§3.3)**: settled conforming/nonconforming subjects
  (definitive both ways), inherited conformance, conditional conformance
  (bound satisfied and not), pending/forward conformance, unknown protocol
  name → error value, computed protocol strings, wrong-kind protocol
  operands, valueless symbols → symbolic (this round), type-value subjects
  ask about the HELD type (pin one fixture with a conforming held type),
  variadic conjunction (all conform / one missing), error subjects →
  `False`.
- **Bare names in `is`**: `x is list` means the values-only bare-`list`
  reading (2026-08-17 ruling); a list holding absence markers answers
  `False`. Pin it so the ruling is user-visible on purpose.

## 6. Rulings

R1–R8 DECIDED 2026-08-18; R9 (and the pass-2 amendments) RATIFIED
2026-08-19. Reasoning retained for the record; the decision is the bolded
line.

**R1 — Which operator carries the dynamic type test?** Keeping `Element`
would mean one lowering for both mental models (`3 ∈ ℤ` and type tests) but
muddies its collection-typed signature — the source of today's misleading
error — and forces set and type semantics to share one head forever.
**DECIDED: a new `MatchesType(any, string|type) -> boolean`; both surfaces
(`is` and match patterns) re-lower together; simple names use the `TypeFrom`
form too; `Element` keeps the math sets.** Note R5 adds a third `is`
lowering (protocol names → `Conforms`).

**R2 — Name of the container node.** It is public Epsil call syntax and the
serialization of every evaluated type value, so it lands in MathJSON and
printed Epsil forever. **DECIDED: `TypeFrom`** — the house `XFrom`
conversion convention (`StringFrom` is the sibling).

**R3 — What happens to `Type(x) -> string`?** Keeping it and adding a
separate value-returning observer avoids breakage but leaves two
similarly-named operators forever. **DECIDED: flip `Type` to return a
`type` value (static-observer semantics unchanged); add a
`StringFrom(type) -> string` arm for the text.** Breaking change accepted:
`Type(x) == "..."` comparisons stop working (they answer `False`; R8 rules
out type-vs-string text comparison) — the flip is gated on the Tycho
criterion (§7) and lands in phase 3. `Type` on a generic function returns a
polytype value (§3.1).

**R4 — Is `p is tuple` → `False` intended?** Nominal opacity (a Swift
struct is not a tuple) vs seeing through to the body; opacity is what makes
`is` usable for nominal discrimination in `match`, and structural
see-through is what conformance was designed to handle instead.
**DECIDED: (a) — nominal types are opaque to structural tests; pin with a
test and document.**

**R5 — Does `is` accept protocol names?** The `where` grammar already
spells conformance with `is` (`where T is Comparable`), and dispatch by
registry lookup is unambiguous: a name can never be both a type and a
protocol — declaring either over the other errors with "protocols and types
share no names" (verified 2026-08-18, both directions). **DECIDED: (a) —
yes.** Mechanics `[amended pass-2, RATIFIED 2026-08-19]`: the `is` tail consults the
registries BEFORE handing the name to the type subparser — the type grammar
currently diagnoses a protocol name in type position, so this contextual
slot needs a deliberate exception — and a protocol name (or a
`&`-conjunction of protocol names) lowers to the variadic
`Conforms(x, "P", …)` (§3.3), never to `MatchesType`, whose `type`-typed
parameter a protocol can never satisfy. A `&` tail mixing protocol and type
names is a parse diagnostic this round. Protocol names in MATCH patterns
are excluded this round (§3.2 — shared annotation machinery).

**R6 — Epsil surface for a standalone type value.** Bare `integer` in
expression position is a plain symbol (`let integer = 5` is legal), so a
standalone spelling needs a marker. **DECIDED: (a) for now — the public
constructor call plus string acceptance**: `TypeFrom("list<integer>")`
anywhere (e.g. `let t: type = TypeFrom("list<integer>")`, annotation
optional), plain strings at `string|type` positions. The constructor call
is also the SERIALIZATION of every evaluated type value, so it exists under
every option. Verbose by design; the sugar revisit (if type values become
common currency) covers both a dedicated literal form and infix `<:` for
`Subtype` (§3.3).

**R7 — The primitive's name collides with the `type X` forward-reference
spelling.** The type-string grammar reserves bare `type` before an
identifier as a forward-reference marker, and the parser tries primitives
before references, so naming the primitive `type` naively breaks the
documented `type X` production (verified; §3.1). **DECIDED: keep the name
`type` and disambiguate by one-token lookahead — `type` followed by an
identifier parses as a forward reference, bare `type` otherwise as the
primitive — CONTINGENT on the phase-1 spike (§4); if the lookahead cannot
work, this ruling reopens on the rename option.** Pin with tests:
`parseType('type')` → the primitive, `parseType('type node', resolver)` →
forward reference, and `list<type>` / `type | nothing` compound positions.

**R8 — Equality and hashing of type values.** Raw-source-text equality is
maximally syntactic but leaves `integer|real` ≠ `real|integer`; full
semantic equivalence (mutual subtyping) is the meaning users want but is
registry-dependent, and `isSame` is the engine's cheap, unconditional
dedup/hash key — a registry mutation must never retroactively change
whether two values in a `Set` are "the same". **DECIDED: split across the
engine's existing tiers — `isSame`/hash compare the REDUCED CANONICAL TEXT
of the parsed type; `==` (the `Equal` tier) is MUTUAL SUBTYPING,
`Subtype(t,u) && Subtype(u,t)`.** `isSame ⇒ hash` and `isSame ⇒ isEqual`
both hold; alias-vs-body lands on the `==` side; `==` between a type value
and a string is `False` (no text comparison — that would re-open the R3
trap). *Lifecycle note (pass-2)*: the settling design (§3.1) is what makes
this implementable — the canonical text is computed ONCE at construction
and stored as the operand, so `isSame`/hash are plain text comparisons and
identity is immune to later registry changes; the mutual-subtyping `==`
side stays live.

**R9 `[RATIFIED 2026-08-19]` — The dynamic test's decision regime.**
`MatchesType` decides by NODE FORM after the single evaluation: value forms
(precise-by-construction) are definitive both ways; all other forms
(typed-by-declaration-or-inference) are three-way on the static type —
subtype → `True`, provably disjoint → `False`, otherwise symbolic (§5).
This subsumes the earlier valueless-symbol bullet and gives "settled" an
implementable criterion. Saying no reverts to an unspecified boundary,
which blocks phase 2.

## 7. Interactions to keep in view

- **Exposing `matches()` exposes the rulings encoded in it**: bare-name
  values-only semantics, `any`/`unknown` asymmetry (`any <: unknown` is
  FALSE), shape-vs-values tops. That is a feature — one relation everywhere —
  but the user docs for `Subtype`/`is` must present these, not bury them.
- **The static pre-pass** (`src/epsil/static-diagnostics.ts`) will see the
  new operators; `TypeFrom` settling at canonicalization means type typos
  in `is` expressions surface as static diagnostics for free. The
  pre-pass's registry rollback interacts with the semantic-parse cache
  (§3.1 "Settling") — the rollback's conditional version bump is what
  keeps a pre-pass-settled value from carrying a transient semantic parse.
- **Tycho — the phase-3 gate, with a checkable criterion**: the R3 flip is
  a REAL break for any consumer comparing `Type(...)` results to strings.
  Phase 3 starts when EITHER a Tycho-side change wrapping every
  string-comparison use of `Type(...)` in `StringFrom` has landed in the
  Tycho repo, OR a search of the Tycho checkout (both repos live on this
  machine) confirms zero such call sites — recorded in the phase-3 work
  log either way. "Audit later" is not a gate; this is.
