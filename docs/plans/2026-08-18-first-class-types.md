# First-Class Types: type values and type algebra in Epsil

**Status:** DRAFT for discussion — no implementation yet. Open rulings in §6.
**Date:** 2026-08-18 (revised same day after dual spec review; review record:
`docs/scratch/2026-08-18-first-class-types_SPEC_REVIEW.md`)

## 1. Motivation

Epsil users want to ask type questions at runtime:

```epsil
x is integer                 // works today (simple names only)
x is list<integer>           // parses, then errors: type-pattern-unsupported
Subtype("integer", "number") // no way to spell this at all
let t = TypeOf(x)            // no way to hold a type in a variable
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
- **The string-equality trap**: `Type(3)` is `"finite_integer"`, so the
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

Proposed mirror:

- **New leaf primitive for type values** in the lattice
  (`src/common/type/primitive.ts`), sitting in `VALUE_TYPES` beside `regexp`
  and `color`: an opaque value, not a scalar, not a collection, no hidden
  element type. **The obvious name `type` collides with the type-string
  grammar** — bare `type` is the forward-reference keyword
  (`<type_reference> ::= ("type")? <identifier> …`,
  `src/common/type/types.ts` grammar comment; implemented in
  `src/common/type/parser.ts` via `_sawForwardRef`), and primitives are
  matched before references, so adding `'type'` to the primitive set breaks
  `parseType('type node')` (verified empirically 2026-08-18). Ruling R7
  decides the resolution; this document writes `type` for the primitive
  throughout, subject to R7.
- **`TypeLiteral(text: string) -> type`** (name open, ruling R2): the inert
  container. Canonicalization of a literal operand parses the text and
  surfaces a parse or unknown-name error in place; the parsed `Type` object
  is cached on the boxed node (lifetime rules below). The container head is
  **public, callable Epsil syntax** — `TypeLiteral("list<integer>")` is an
  ordinary function call — which is what makes evaluated type values
  serializable (§4 phase 1) without dedicated literal syntax (ruling R6).

**Admissible type-value grammar (construction is side-effect-free).** The
resolver-aware type parser accepts the forward-reference spelling
`type Later` and registers a placeholder via `TypeResolver.forward()` —
a REGISTRY MUTATION. A `TypeLiteral` must never do that: it parses with
forwarding disabled, and a forward reference or an unbound type variable in
the text is a canonicalization error, not a placeholder. Polytypes
(`where`-quantified signatures) are **rejected as type values in this round**
— `Subtype` over quantified types engages `matches()`'s existential
machinery, which deserves its own design pass; the restriction is checked at
the same canonicalization step and lifting it is a named future extension,
not an oversight.

**Value semantics.**

- *Equality and hashing*: ruling R8. Whatever R8 picks, the `isSame ⇒ hash`
  invariant holds, mirroring the regexp decision (D9 in the plan cited
  above).
- *Registry lifetime*: a `TypeLiteral` is **live, with a version-gated
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
narrow: each new type-consuming operator (`MatchesType`, `Subtype`, the
conformance test) declares its parameter `string|type` (an explicit union,
exactly the `DeclareType` pattern) and its `canonical` handler rewrites a
LITERAL string operand to `TypeLiteral(...)` — validation at the author's
line — while a COMPUTED string is parsed at evaluation by the consumer. No
signature-checker hook, no rule that other operators inherit. Overload
ranking is unaffected because the union is spelled in the signature.

### 3.2 Re-lower the dynamic type test; lift the simple-name restriction

With a type value to carry the payload, the deferred "typed-pattern work"
unblocks:

- **One IR for every type test.** Both `x is integer` and
  `x is list<integer>` lower to
  `MatchesType(x, TypeLiteral("<source>"))` (operator name per R1) — simple
  names do NOT keep the bare-symbol form, because a bare symbol satisfies
  neither the new operator's `string|type` parameter nor any coercion this
  design defines. `match` type patterns lower identically, preserving the
  agreement-by-construction property between the two surfaces. `Element`'s
  existing type-name arm remains for direct MathJSON authors and the math
  sets; this plan neither extends nor removes it.
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

- `TypeOf(x) -> type` — the STATIC type of `x` as a value (today's `Type`
  semantics, value-typed result). See ruling R3 for the `Type`/`TypeOf`
  naming and compatibility split.
- `Subtype(t, u) -> boolean` — **true iff `t <: u`**, i.e. the FIRST operand
  is the (candidate) subtype: `Subtype("integer", "number")` → `True`,
  `Subtype("number", "integer")` → `False`. (Direction stated here because
  the codebase has prior confusion on exactly this — the `subsetOf`
  convention sweep.) Operands are `string|type` per §3.1. This is
  "is compatible with" — the same relation annotations and signatures use,
  including the 2026-08-17 bare-name ruling (bare `list` ≡ `list<unknown>`,
  values-only). Exposing it makes that ruling user-visible;
  `doc/08-guide-types.md` §"Which spelling, when" becomes user documentation
  for this operator too. Acceptance matrix in §5.
- **Conformance test — one operator, two subject kinds.**
  `Conforms(subject: any, protocol: string) -> boolean`: when the subject is
  a `type` value, it asks whether that type conforms; any other subject is
  evaluated and its precise type is asked. The protocol operand rides as a
  string (matching `DeclareConformance`'s convention; protocol names are not
  types and have no other value representation). The operator delegates to
  `TypeResolver.conformsTo`, whose full semantics — inherited, conditional,
  and pending conformances — are the contract, not a naive registry lookup;
  §5 pins the edge cases. `x is Hashable` (ruling R5) lowers to
  `Conforms(x, "Hashable")` — a THIRD lowering case for `is`, distinct from
  `MatchesType`, selected at parse time (see R5 for the disambiguation and
  the required parser exception).
- **Type values at existing type-STRING positions (the reverse direction).**
  A user holding `let t = TypeOf(x)` will immediately try
  `DeclareType("alias2", t)`. In scope for phase 3: `DeclareType`'s type
  operand widens to `string|symbol|type`. Conformance `where` clauses stay
  text-only — they are verbatim re-parsed source by design (the P11
  pattern), and a value there has no source location to re-parse.
- Later, on demand: `CommonType(t, u)` (join/widen), `ElementType(t)` — both
  computed internally already (`joinParamAt`, `collectionElementType`).

Non-goals for this round: a runtime type-construction algebra (building
unions/intersections by operating on type values with `|`/`&` at the
expression level — compose in the type grammar or in the string instead);
making protocols types; polytype values (§3.1); EXECUTABLE compilation of
the new operators. **Compilation fail-closed behavior is IN scope**, per
phase: every compile target (`javascript`, `python`, `glsl`) must reject a
`TypeLiteral`, `MatchesType`, `Subtype`, `TypeOf`, or `Conforms` node — and
a `type`-typed value crossing the compile boundary — with a compile-time
unsupported-operation diagnostic, never silently-wrong code; each phase adds
per-target rejection tests, following the regexp plan's supported-vs-
fail-closed test pattern.

## 4. Phases

The phases are **dependent increments, gated on rulings** — each builds on
the previous, and none starts before its gate is decided:

1. **`type` primitive + `TypeLiteral` + string acceptance.**
   *Gates: R2 (container name), R6 (surface), R7 (primitive name), R8
   (equality).* Lattice, boxing, MathJSON serialization, Epsil printing —
   an evaluated type value serializes as the public constructor call
   (`TypeLiteral("list<integer>")`), which reparses to an identical value;
   this IS the round-trip story, so it lands here, not later. Compile
   fail-closed tests for the container. Deliverable: a type value
   round-trips both formats, validates literals at canonicalization,
   construction is registry-side-effect-free, `Subtype` works.
2. **Typed patterns.** *Gate: R1 (and R5 for the protocol arm of `is`).*
   Re-lower `is` and `match` type patterns onto the single IR; lift the
   simple-name restriction; fix the misleading `incompatible-type
   'collection'` surfacing. **Measure and surface the snapshot blast radius
   before landing** — re-lowering a widely-used construct is exactly the
   canonicalization churn CLAUDE.md's snapshot policy gates. Deliverable:
   `x is list<integer>`, `x is number | string`, `x is !error`, and the
   equivalent match patterns — the prerequisite for `if let` named in the
   2026-08-03 review.
3. **Observers and algebra.** *Gates: R3, R5.* `TypeOf`, `Conforms`,
   `Type` disposition per R3, `DeclareType` accepting type values (§3.3).
   `CommonType`/`ElementType` only if a consumer asks.

## 5. Semantics to pin in tests

- **Static vs dynamic split**: `Type`/`TypeOf` observe without evaluating
  (`TypeOf(x)` for `x: real` valueless is `real`); `is` evaluates its subject
  and tests the value's precise type. Pin both on the same fixture.
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
- **`Subtype` acceptance matrix**: direction (`Subtype("integer","number")`
  `True` / reverse `False` / equal types both ways), `any`/`unknown`
  asymmetry (`Subtype("any","unknown")` → `False` per the 2026-08-17
  ruling), `never`, bare collection names vs `<any>` tops, aliases,
  nominals, function-signature variance, malformed text → error value,
  unknown name → error value, computed-string operands, wrong-kind operands.
- **`Conforms` edge cases**: inherited conformance, conditional conformance
  (bound satisfied and not), pending/forward conformance, unknown protocol
  name, alias subjects, nominal subjects, `never`, symbolic subjects
  (stays symbolic).
- **Bare names in `is`**: `x is list` means the values-only bare-`list`
  reading (2026-08-17 ruling); a list holding absence markers answers
  `False`. Pin it so the ruling is user-visible on purpose.

## 6. Open rulings

Each phrased standalone; "undecided" keeps today's behavior. Interactions
between rulings are cross-referenced where they exist (R1↔R5).

**R1 — Which operator carries the dynamic type test: `Element`, or a new
`MatchesType`?** Today `x is integer` lowers to `Element(x, integer)`, and
`Element` also serves math-set membership (`3 ∈ ℤ`). Keeping one operator
means one lowering for both mental models but muddies `Element`'s signature
(its collection-typed second operand is where today's misleading
`incompatible-type 'collection'` error comes from) and forces set semantics
and type semantics to share one head forever. A dedicated
`MatchesType(any, string|type) -> boolean` gets an honest signature and clean
errors, at the cost of re-lowering both surfaces (`is` and match patterns
must move TOGETHER to preserve their agreement — and under this option
simple names move to the `TypeLiteral` form too; there is no bare-symbol
variant, per §3.2). **Recommendation: new operator, both surfaces
re-lowered; `Element` keeps the math sets.** Undecided = compound types stay
unsupported, since extending `Element`'s signature is itself a ruling. Note
R5 adds a third `is` lowering (protocol names → `Conforms`) that exists
under either choice here.

**R2 — Name of the container node.** `TypeLiteral` (proposed) or
`TypeValue`; reusing `Type` as a 1-ary constructor is impossible (`Type` is
the observer). The head is public Epsil call syntax and the serialization of
every evaluated type value (§4 phase 1), so it lands in MathJSON and in
printed Epsil forever — pick once.

**R3 — What happens to `Type(x) -> string`?** Options: (a) keep `Type` as-is
and add `TypeOf(x) -> type` — no breakage, two similarly-named operators
forever; (b) flip `Type` to return a `type` value that prints as the type
text — one operator, but every existing `Type(x) == "some string"` comparison
breaks unless `==` between `type` and `string` compares the text, which
re-opens the string-equality trap this design exists to close. **Recommendation:
(a), and document `TypeOf` + `Subtype` as the supported idiom; consider
deprecating `Type` later.** Undecided = (a) minus the deprecation note.

**R4 — Is `p is tuple` → `False` intended?** After `type point = tuple<x:
integer, y: integer>`, a `point` value does not test as a `tuple` today.
Defensible as nominal opacity (a Swift struct is not a tuple), but it may be
an artifact of the bare-`tuple` gate from the bare-types ruling rather than a
decision. Options: (a) nominal types are opaque to structural tests — pin it;
(b) a nominal type tests as its body — `p is tuple` → `True`. Implications:
(a) makes `is` usable for nominal discrimination in `match`; (b) makes
generic structural code (anything that walks "any tuple") see through
nominals, which conformance was designed to handle instead. **Recommendation:
(a), pinned with a test and documented.** Undecided = today's (a) behavior,
unpinned. This ruling decides ONLY nominal opacity; valueless-symbol and
undecidability semantics are §5's, not R4's.

**R5 — Does `is` accept protocol names?** `x is Hashable` reads naturally,
the `where` grammar already spells conformance with `is`
(`where T is Comparable`), and dispatch by registry lookup is unambiguous:
a name can never be both a type and a protocol — declaring either over the
other errors with "protocols and types share no names" (verified 2026-08-18,
both directions). But protocols are deliberately NOT types; admitting them
into `is` blurs that line in user-facing docs. **Mechanics under (a)**: the
`is` tail consults the registries BEFORE handing the name to the type
subparser — the type grammar currently diagnoses a protocol name in type
position, so this contextual slot needs a deliberate exception — and a
protocol name lowers to `Conforms(x, "<name>")` (§3.3), never to the R1
operator, whose `type`-typed parameter a protocol can never satisfy.
Options: (a) yes, with the above; (b) no, conformance is spelled
`Conforms(x, "P")` only. **Recommendation: (a), because the `where` grammar
already committed `is` to the conformance reading.** Undecided = (b) by
default, since nothing accepts protocol names today.

**R6 — Epsil surface for a standalone type value.** Bare `integer` in
expression position is a plain symbol (`let integer = 5` is legal), so a
standalone spelling needs a marker. Options: (a) the public constructor call
plus string acceptance — `TypeLiteral("list<integer>")` anywhere, plain
strings at `string|type` positions (`Subtype("list<integer>",
"collection")`); the constructor call is also the SERIALIZATION of every
evaluated type value, so it exists under every option; (b) additionally, a
`type(...)` prefix form (contextual keyword; must disambiguate from a call
to a variable named `type`); (c) additionally, a sigil. **Recommendation:
(a) for this round — verbose by design; revisit sugar if type values become
common currency.** Undecided = (a).

**R7 — The primitive's name collides with the `type X` forward-reference
spelling.** The type-string grammar reserves bare `type` before an
identifier as a forward-reference marker, and the parser tries primitives
before references, so naming the primitive `type` breaks the documented
`type X` production (verified; §3.1). Options: (a) keep the name `type` and
disambiguate in the parser by one-token lookahead — `type` followed by an
identifier parses as a forward reference, bare `type` otherwise as the
primitive; (b) rename the primitive (no natural candidate; `typevalue` and
similar read poorly everywhere users see them); (c) retire the `type X`
forward-reference spelling (a breaking change to a documented grammar
production whose real-world usage is unmeasured). **Recommendation: (a) —
the token sequence disambiguates cleanly, and both meanings keep their
natural spelling.** Pin with tests: `parseType('type')` → the primitive,
`parseType('type node', resolver)` → forward reference, and
`list<type>` / `type | nothing` compound positions. Undecided = phase 1
cannot start (the primitive cannot be added without breaking the
production).

**R8 — Equality and hashing of type values.** What does
`t1.isSame(t2)` (and `==`) mean? Options: (a) raw source text —
`TypeLiteral("integer|real")` ≠ `TypeLiteral("real|integer")`, maximally
syntactic, mirrors regexp D9 most literally; (b) **canonical text of the
parsed type** — normalize at canonicalization (union order, bare-name
expansion) and compare that, so trivially-identical spellings are equal
while aliases remain distinct from their bodies and nominals distinct from
their structure (`isSame` stays a cheap, unconditional equivalence
relation, and `isSame ⇒ hash` holds on the canonical text); (c) semantic
equivalence (mutual subtyping) — an equivalence relation, but no longer
cheap or syntactic, and it would make `isSame` consult the registry.
**Recommendation: (b); mutual subtyping stays spellable as
`Subtype(t,u) && Subtype(u,t)`.** `==` on two type values follows
`isSame`; `==` between a type value and a string is `False` (no text
comparison — that would re-open the R3(b) trap). Undecided = phase 1
cannot ship `isSame`-bearing containers without an accidental de-facto
choice, so this gates phase 1.

## 7. Interactions to keep in view

- **Exposing `matches()` exposes the rulings encoded in it**: bare-name
  values-only semantics, `any`/`unknown` asymmetry (`any <: unknown` is
  FALSE), shape-vs-values tops. That is a feature — one relation everywhere —
  but the user docs for `Subtype`/`is` must present these, not bury them.
- **The static pre-pass** (`src/epsil/static-diagnostics.ts`) will see the
  new operators; `TypeLiteral` validation at canonicalization means type
  typos in `is` expressions surface as static diagnostics for free. The
  pre-pass's registry rollback interacts with the version-gated cache
  (§3.1 "Registry lifetime") — the rollback's conditional version bump is
  what keeps a pre-pass-built value from carrying a transient registration.
- **Tycho**: `Type`'s string result may be consumed downstream; R3's
  disposition should be checked against Tycho usage before phase 3.
