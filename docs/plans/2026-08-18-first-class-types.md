# First-Class Types: type values and type algebra in Epsil

**Status:** Rulings R1–R8 DECIDED (2026-08-18, inline review + discussion) —
ready for phase-1 planning. No implementation yet. Review record:
`docs/scratch/2026-08-18-first-class-types_SPEC_REVIEW.md`.
**Date:** 2026-08-18

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

### 3.1 Keystone: a `type` value kind, on the `RegExp` template

`RegExp` (`src/compute-engine/library/regexp.ts`) is the exact precedent for
an opaque value minted from source text: an inert container expression that
stores its pattern string as an operand, has **no evaluate handler** (the
expression IS the value), validates a **literal** operand at canonicalization
so a typo surfaces where it was written (a computed operand stays inert and is
validated by consumers), and reports a leaf primitive via `type: () =>
'regexp'`. Its design record is
`docs/plans/2026-08-17-string-phase3-regular-expressions.md`; decisions D9
(equality) and D10 (no implicit coercion) are engaged explicitly below rather
than inherited silently.

The mirror:

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
  `XFrom` conversion convention, alongside the existing `StringFrom`): the
  inert container. Canonicalization of a literal operand parses the text and
  surfaces a parse or unknown-name error in place; the parsed `Type` object
  is cached on the boxed node (lifetime rules below). The container head is
  **public, callable Epsil syntax** — `TypeFrom("list<integer>")` is an
  ordinary function call, so `let t: type = TypeFrom("list<integer>")` works
  (the annotation is optional; inference types `t` from the value) — which is
  what makes evaluated type values serializable (§4 phase 1) without
  dedicated literal syntax (ruling R6).

**Admissible type-value grammar (construction is side-effect-free).** The
resolver-aware type parser accepts the forward-reference spelling
`type Later` and registers a placeholder via `TypeResolver.forward()` —
a REGISTRY MUTATION. A `TypeFrom` value must never do that: it parses with
forwarding disabled, and a forward reference or an unbound type variable in
the text is a canonicalization error, not a placeholder. Polytypes
(`where`-quantified signatures) are **rejected as type values in this round**
— `Subtype` over quantified types engages `matches()`'s existential
machinery, which deserves its own design pass; the restriction is checked at
the same canonicalization step and lifting it is a named future extension,
not an oversight.

**Value semantics.**

- *Equality and hashing* (ruling R8, decided — the tier split): `isSame` and
  the hash compare the REDUCED CANONICAL TEXT of the parsed type (cheap,
  registry-independent, `isSame ⇒ hash` holds); `==` (the `Equal` tier) is
  MUTUAL SUBTYPING (`Subtype(t,u) && Subtype(u,t)`), which additionally
  equates the pairs reduction cannot see, such as an alias name and its
  body. `isSame ⇒ isEqual` holds (reduced-identical implies mutually
  subtype). `==` between a type value and a string is `False` — no text
  comparison, which would re-open the string-equality trap.
- *Registry lifetime*: a `TypeFrom` value is **live, with a version-gated
  cache** — the cached parse is keyed to the engine's redefinition version
  axis (the same axis type redeclaration already bumps, per
  `docs/plans/2026-08-10-global-type-registry.md`), and re-parses after a
  bump. This keeps it in agreement with `Element`'s existing arm (which
  re-resolves via `ce.type(name)` on every evaluation) and makes the static
  pre-pass's register-then-rollback transaction safe: rollback bumps the
  axes when it restored something, invalidating any cache built against the
  transient registration. Pin with tests: alias replacement, generic-alias
  use, nominal redeclaration, forward-record fulfillment, and a value built
  during the pre-pass surviving rollback.

**String acceptance — a per-operator convention, not engine-wide coercion.**
There is no generic coercion facility in the argument checker, and the regexp
plan's D10 explicitly rejected implicit string→regexp coercion because a
plain string at those positions has a competing meaning (a literal match
subject). At the NEW operators' type positions a string has **no** competing
meaning — `Subtype("integer", "number")` can only intend types — so the
ambiguity objection does not transfer. Still, the mechanism is deliberately
narrow: each new type-consuming operator (`MatchesType`, `Subtype`,
`Conforms`) declares its parameter `string|type` (an explicit union, exactly
the `DeclareType` pattern) and its `canonical` handler rewrites a LITERAL
string operand to `TypeFrom(...)` — validation at the author's line — while a
COMPUTED string is parsed at evaluation by the consumer. No signature-checker
hook, no rule that other operators inherit. Overload ranking is unaffected
because the union is spelled in the signature.

### 3.2 Re-lower the dynamic type test; lift the simple-name restriction

With a type value to carry the payload, the deferred "typed-pattern work"
unblocks:

- **One IR for every type test.** Both `x is integer` and
  `x is list<integer>` lower to `MatchesType(x, TypeFrom("<source>"))`
  (ruling R1, decided) — simple names do NOT keep the bare-symbol form,
  because a bare symbol satisfies neither the operator's `string|type`
  parameter nor any coercion this design defines. `match` type patterns
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
- **The test operator is an observer**: `lazy: true` + `inspectsErrors:
  true`, like `Match` and `IsError` — a strict operator never sees an
  `Error` subject (propagation bubbles it away first), which would make the
  promised `x is error` / `x is !error` unimplementable. The handler
  canonicalizes and evaluates the held subject exactly once, then tests.
- The parser's grammar guard already resolves the hard conflict: the lexer
  munches `&&`/`||` into single tokens, so a compound type after `is` is
  recognizable by a lone `|`, `&`, `<`, or `->`, and
  `x is integer && y is string` stays a conjunction of two tests. The
  compound path already parses today; it just has nowhere to go.
- The `type-pattern-unsupported` diagnostic retires.

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
  check (§7) must complete BEFORE this flip lands.
- **`Subtype(t, u) -> boolean`** — **true iff `t <: u`**, i.e. the FIRST
  operand is the (candidate) subtype: `Subtype("integer", "number")` →
  `True`, `Subtype("number", "integer")` → `False`. (Direction stated here
  because the codebase has prior confusion on exactly this — the `subsetOf`
  convention sweep.) Operands are `string|type` per §3.1. **This IS the
  type-comparison operator — no infix `<:` this round** (decided
  2026-08-18): the comparison story is complete without it (`is` for
  value-inhabitance, `Subtype` for ordering, `==` for equivalence per R8),
  an infix form needs a new compound lexer token, and R6's
  verbose-by-design stance applies. `t <: u` as pure sugar for
  `Subtype(t, u)` is a named candidate for R6's sugar revisit — zero design
  risk later, since the semantics is fixed here. The relation is
  "is compatible with" — the same one annotations and signatures use,
  including the 2026-08-17 bare-name ruling (bare `list` ≡ `list<unknown>`,
  values-only). Exposing it makes that ruling user-visible;
  `doc/08-guide-types.md` §"Which spelling, when" becomes user documentation
  for this operator too. Acceptance matrix in §5.
- **Conformance test — one operator, two subject kinds.**
  `Conforms(subject: any, protocol: string) -> boolean`: when the subject is
  a `type` value, it asks whether that TYPE conforms; any other subject is
  evaluated and its precise type is asked. **What keeps the branch
  unambiguous: the primitive `type` itself declares NO protocol conformances
  in this round** — so a type-value subject can only intend the type-level
  question. (Engine-internal `isSame`/hash covers set and dictionary
  membership for type values without protocol `Hashable`; if `type` ever
  gains conformances, this branch must be revisited.) The protocol operand
  rides as a string (matching `DeclareConformance`'s convention; protocol
  names are not types and have no other value representation). The operator
  delegates to `TypeResolver.conformsTo`, whose full semantics — inherited,
  conditional, and pending conformances — are the contract, not a naive
  registry lookup; §5 pins the edge cases. `x is Hashable` (ruling R5,
  decided) lowers to `Conforms(x, "Hashable")` — a THIRD lowering case for
  `is`, distinct from `MatchesType`, selected at parse time (see R5 for the
  disambiguation and the required parser exception).
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
infix `<:` (candidate sugar, above); making protocols types; conformances ON
the `type` primitive (above); polytype values (§3.1); EXECUTABLE compilation
of the new operators. **Compilation fail-closed behavior is IN scope**, per
phase: every compile target (`javascript`, `python`, `glsl`) must reject a
`TypeFrom`, `MatchesType`, `Subtype`, `Type`, or `Conforms` node — and a
`type`-typed value crossing the compile boundary — with a compile-time
unsupported-operation diagnostic, never silently-wrong code; each phase adds
per-target rejection tests, following the regexp plan's supported-vs-
fail-closed test pattern.

## 4. Phases

The phases are **dependent increments** — each builds on the previous. All
rulings are decided; the one remaining contingency is the R7 spike.

1. **`type` primitive + `TypeFrom` + string acceptance.**
   *First step — the R7 lookahead spike*: verify that `parsePrimitiveType`
   can decline bare `type` when the next token is an identifier, so
   `parseType('type')` yields the primitive while `parseType('type node',
   resolver)` keeps yielding a forward reference (plus the compound
   positions `list<type>` and `type | nothing`). If the lookahead cannot be
   made to work, R7 reopens on the rename option before anything else
   lands. Then: lattice, boxing, MathJSON serialization, Epsil printing —
   an evaluated type value serializes as the public constructor call
   (`TypeFrom("list<integer>")`), which reparses to an identical value;
   this IS the round-trip story, so it lands here, not later. `isSame`/
   hash on reduced canonical text and `==` as mutual subtyping (R8).
   Compile fail-closed tests for the container. Deliverable: a type value
   round-trips both formats, validates literals at canonicalization,
   construction is registry-side-effect-free, `Subtype` works.
2. **Typed patterns.** Re-lower `is` and `match` type patterns onto the
   single IR (`MatchesType`); lift the simple-name restriction; add the
   protocol arm of `is` (R5); fix the misleading `incompatible-type
   'collection'` surfacing. **Measure and surface the snapshot blast radius
   before landing** — re-lowering a widely-used construct is exactly the
   canonicalization churn CLAUDE.md's snapshot policy gates. Deliverable:
   `x is list<integer>`, `x is number | string`, `x is !error`,
   `x is Hashable`, and the equivalent match patterns — the prerequisite
   for `if let` named in the 2026-08-03 review.
3. **Observers and the flip.** The `Type` flip to `-> type` plus the
   `StringFrom(type)` arm (R3) — **gated on the Tycho usage check (§7)** —
   and `DeclareType` accepting type values (§3.3).
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
- **Settled subjects are decided — both ways.** For an evaluated,
  value-bearing subject, the subject's precise type is EXACT, so
  `matches()` failure is a definitive `False` — the new operator must NOT
  inherit the `matches(...) ? true : undefined` asymmetry of the current
  `Element` arm (definitive-on-failure only for numbers). Truth-table
  fixtures: nonempty and empty lists (`[] is list<integer>` → `True`, via
  `list<nothing>` element covariance; `["a"] is list<integer>` → `False`),
  tuples, records, functions, unions on the right, absence-bearing
  collections, aliases, nominals.
- **Valueless symbols are three-way.** Declared type `<:` T → `True` even
  valueless; declared type provably DISJOINT from T → `False`; overlapping
  but undecided → the test stays symbolic. (This is a proposed pinned
  semantic, not an open ruling; it follows the engine convention for
  undecidable predicates. If contested it becomes its own ruling.)
- **Error subjects**: `err is error` → `True`, `err is !error` → `False`,
  and both agree across the direct, piped (`|> `), box, and match-pattern
  routes — the `lazy` + `inspectsErrors` observer contract of §3.2, pinned
  the way `IsError`'s route parity is.
- **Route parity generally**: the test operators hold operands — add
  box-route and parse-route probes, not only `ce.function(...)` probes (the
  `lazy`-operator trap recorded in `test/compute-engine/find-fit.test.ts`'s
  route-parity block).
- **Equality tiers (R8)**: `TypeFrom("integer|real").isSame(
  TypeFrom("real|integer"))` → `true` (reduced canonical text) with equal
  hashes; alias name vs its body — `isSame` `false`, `==` `True`; nominal
  vs its body — `isSame` `false`, `==` `False` (R4 opacity);
  `t == "integer"` → `False` for every type value `t`;
  `StringFrom(TypeFrom(s))` reparses to an `isSame`-identical value.
- **`Subtype` acceptance matrix**: direction (`Subtype("integer","number")`
  `True` / reverse `False` / equal types both ways), `any`/`unknown`
  asymmetry (`Subtype("any","unknown")` → `False` per the 2026-08-17
  ruling), `never`, bare collection names vs `<any>` tops, aliases,
  nominals, function-signature variance, malformed text → error value,
  unknown name → error value, computed-string operands, wrong-kind operands.
- **`Conforms` edge cases**: inherited conformance, conditional conformance
  (bound satisfied and not), pending/forward conformance, unknown protocol
  name, alias subjects, nominal subjects, `never`, symbolic subjects
  (stays symbolic), and the branch rule: a type-value subject asks about
  the HELD type (pin one fixture asking about a conforming held type).
- **Bare names in `is`**: `x is list` means the values-only bare-`list`
  reading (2026-08-17 ruling); a list holding absence markers answers
  `False`. Pin it so the ruling is user-visible on purpose.

## 6. Rulings (all DECIDED 2026-08-18)

Reasoning retained for the record; the decision is the bolded line.

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
out type-vs-string text comparison) — the flip is gated on the Tycho usage
check (§7) and lands in phase 3.

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
yes.** Mechanics: the `is` tail consults the registries BEFORE handing the
name to the type subparser — the type grammar currently diagnoses a
protocol name in type position, so this contextual slot needs a deliberate
exception — and a protocol name lowers to `Conforms(x, "<name>")` (§3.3),
never to `MatchesType`, whose `type`-typed parameter a protocol can never
satisfy.

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
trap).

## 7. Interactions to keep in view

- **Exposing `matches()` exposes the rulings encoded in it**: bare-name
  values-only semantics, `any`/`unknown` asymmetry (`any <: unknown` is
  FALSE), shape-vs-values tops. That is a feature — one relation everywhere —
  but the user docs for `Subtype`/`is` must present these, not bury them.
- **The static pre-pass** (`src/epsil/static-diagnostics.ts`) will see the
  new operators; `TypeFrom` validation at canonicalization means type
  typos in `is` expressions surface as static diagnostics for free. The
  pre-pass's registry rollback interacts with the version-gated cache
  (§3.1 "Registry lifetime") — the rollback's conditional version bump is
  what keeps a pre-pass-built value from carrying a transient registration.
- **Tycho**: the R3 flip is a REAL break for any consumer comparing
  `Type(...)` results to strings — audit Tycho's usage of `Type` and agree
  on a migration (mechanical: wrap in `StringFrom`) BEFORE phase 3 lands.
