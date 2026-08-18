# First-Class Types: type values and type algebra in Epsil

**Status:** DRAFT for discussion — no implementation yet. Open rulings in §6.
**Date:** 2026-08-18

## 1. Motivation

Epsil users want to ask type questions at runtime:

```epsil
x is integer                 // works today (simple names only)
x is list<integer>           // parses, then errors: type-pattern-unsupported
subtype("integer", "number") // no way to spell this at all
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
  name with `ce.type(name)` and answers via `matches()`.
- **`Type(x) -> string`** (`src/compute-engine/library/core.ts`): the STATIC
  observer — lazy, canonicalizes its operand but does not evaluate it.
- **Math-set membership**: `Element(3, Integers)` → `True`, value-based, on
  the number-set constants.
- **Types-as-strings convention**: `DeclareType`, conformance `where` clauses,
  and signatures all carry type expressions as strings, re-parsed by the
  engine.

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
'regexp'`.

Proposed mirror:

- **New leaf primitive `type`** in the lattice
  (`src/common/type/primitive.ts`), sitting in `VALUE_TYPES` beside `regexp`
  and `color`: an opaque value, not a scalar, not a collection, no hidden
  element type. Follow the existing add-a-primitive checklist (the `regexp`
  addition, plan `docs/plans/2026-08-16-string-phase3-regexp.md`, walked the
  same sites).
- **`TypeLiteral(text: string) -> type`** (name open, ruling R2): the inert
  container. Canonicalization of a literal operand parses the text with
  `parseType` against the engine's type resolver and surfaces a parse or
  unknown-name error in place; the parsed `Type` object is cached on the
  boxed node. MathJSON round-trip is free (it is an ordinary expression);
  the Epsil serializer prints it in whatever surface form ruling R6 picks.
- **String coercion at `type`-typed signature positions**: any operator
  parameter declared `type` also accepts a `string`, coerced by parsing —
  the same convention `DeclareType` already applies to its type operand. So
  `"list<integer>"` works everywhere a type value is expected, and no new
  Epsil literal syntax is required on day one.

### 3.2 Re-lower the dynamic type test; lift the simple-name restriction

With a type value to carry the payload, the deferred "typed-pattern work"
unblocks:

- `x is list<integer>` lowers to the dynamic type test with a `TypeLiteral`
  operand; `x is integer` keeps lowering with the bare symbol (or moves to the
  literal form too — whichever the R1 operator decision makes cleaner). The
  parser's grammar guard already resolves the hard conflict: the lexer munches
  `&&`/`||` into single tokens, so a compound type after `is` is recognizable
  by a lone `|`, `&`, `<`, or `->`, and `x is integer && y is string` stays a
  conjunction of two tests. The compound path already parses today; it just
  has nowhere to go.
- `match` type patterns lift identically, through the same lowering — the
  agreement-by-construction property between `is` and patterns is preserved.
- The `type-pattern-unsupported` diagnostic retires (or narrows to whatever
  R4 leaves undecidable).

### 3.3 The algebra surface (small, on demand)

All of these are thin wrappers over machinery the engine already has:

- `TypeOf(x) -> type` — the STATIC type of `x` as a value (today's `Type`
  semantics, value-typed result). See ruling R3 for the `Type`/`TypeOf`
  naming and compatibility split.
- `Subtype(t, u) -> boolean` — `parseType` both (or take the cached parse),
  answer `matches()`. This is "is compatible with" — the same relation
  annotations and signatures use, including the 2026-08-17 bare-name ruling
  (bare `list` ≡ `list<unknown>`, values-only). Exposing it makes that
  ruling user-visible; `doc/08-guide-types.md` §"Which spelling, when" becomes
  user documentation for this operator too.
- A conformance test (`t is Comparable`, or `Conforms(t, p)`) — reads the
  conformance registry. Ruling R5.
- Later, on demand: `CommonType(t, u)` (join/widen), `ElementType(t)` — both
  computed internally already (`joinParamAt`, `collectionElementType`).

Non-goals for this round: a runtime type-construction algebra (building
unions/intersections by operating on type values with `|`/`&` at the
expression level — compose in the type grammar or in the string instead);
making protocols types; compilation support (compile targets treat `type`
values as opaque, like `regexp`, and reject operations on them).

## 4. Phases

1. **`type` primitive + `TypeLiteral` + string coercion.** Lattice, boxing,
   serialization (MathJSON + Epsil printing), guide updates. No behavior
   change to `is`. Deliverable: a type value round-trips, validates literals
   at canonicalization, `Subtype` works.
2. **Typed patterns.** Re-lower `is` and `match` type patterns; lift the
   simple-name restriction; fix the misleading `incompatible-type
   'collection'` surfacing. Deliverable: `x is list<integer>`,
   `x is number | string`, `x is !error`, and the equivalent match patterns —
   the prerequisite for `if let` named in the 2026-08-03 review.
3. **Observers and algebra.** `TypeOf`, conformance test, `Type`
   disposition per R3. `CommonType`/`ElementType` only if a consumer asks.

Each phase lands independently; phase 1 has no user-visible Epsil surface
change beyond the new operators being callable.

## 5. Semantics to pin in tests

- **Static vs dynamic split**: `Type`/`TypeOf` observe without evaluating
  (`TypeOf(x)` for `x: real` valueless is `real`); `is` evaluates its subject
  and tests the value's precise type. Pin both on the same fixture.
- **`is` on a valueless symbol** stays symbolic when the static type cannot
  decide (declared `x: real`, asked `x is integer`), and answers when it can
  (declared `x: integer` → `True` even valueless). Matches engine convention
  for undecidable predicates. (Ruling R4 if this is contested.)
- **Route parity**: the test operators are observers over held/lazy operands
  in some positions — add box-route and parse-route probes, not only
  `ce.function(...)` probes (the `lazy`-operator trap recorded in
  `test/compute-engine/find-fit.test.ts`'s route-parity block).
- **Bare names in `is`**: `x is list` means the values-only bare-`list`
  reading (2026-08-17 ruling); a list holding absence markers answers
  `False`. Pin it so the ruling is user-visible on purpose.

## 6. Open rulings

Each phrased standalone; "undecided" keeps today's behavior.

**R1 — Which operator carries the dynamic type test: `Element`, or a new
`MatchesType`?** Today `x is integer` lowers to `Element(x, integer)`, and
`Element` also serves math-set membership (`3 ∈ ℤ`). Keeping one operator
means one lowering for both mental models but muddies `Element`'s signature
(its collection-typed second operand is where today's misleading
`incompatible-type 'collection'` error comes from) and forces set semantics
and type semantics to share one head forever. A dedicated `MatchesType(any,
type) -> boolean` gets an honest signature and clean errors, at the cost of
re-lowering both surfaces (`is` and match patterns must move TOGETHER to
preserve their agreement). **Recommendation: new operator, both surfaces
re-lowered; `Element` keeps the math sets.** Undecided = compound types stay
unsupported, since extending `Element`'s signature is itself a ruling.

**R2 — Name of the container node.** `TypeLiteral` (proposed), `TypeValue`,
or reusing `Type` as a 1-ary constructor is impossible (`Type` is the
observer). Pure naming; pick once, it lands in MathJSON serializations
forever.

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
unpinned.

**R5 — Does `is` accept protocol names?** `x is Hashable` reads naturally,
the `where` grammar already spells conformance with `is`
(`where T is Comparable`), and dispatch by registry lookup is unambiguous:
a name can never be both a type and a protocol — declaring either over the
other errors with "protocols and types share no names" (verified 2026-08-18,
both directions). But protocols are deliberately
NOT types; admitting them into `is` blurs that line in user-facing docs.
Options: (a) yes, `is` dispatches by registry lookup — one keyword, two
relations; (b) no, conformance gets its own spelling (`Conforms(x, P)` only).
**Recommendation: (a), because the `where` grammar already committed `is` to
the conformance reading.** Undecided = (b) by default, since nothing accepts
protocol names today.

**R6 — Epsil literal syntax for a standalone type value.** Bare `integer` in
expression position is a plain symbol (`let integer = 5` is legal), so a
standalone literal needs a marker. Options: (a) none — strings +
signature-position coercion only (`Subtype("list<integer>", "collection")`);
(b) a `type(...)` prefix form (contextual keyword; must disambiguate from a
call to a variable named `type`); (c) a sigil. **Recommendation: (a) for this
round; revisit if type values become common currency.** Undecided = (a).

## 7. Interactions to keep in view

- **Exposing `matches()` exposes the rulings encoded in it**: bare-name
  values-only semantics, `any`/`unknown` asymmetry (`any <: unknown` is
  FALSE), shape-vs-values tops. That is a feature — one relation everywhere —
  but the user docs for `Subtype`/`is` must present these, not bury them.
- **The static pre-pass** (`src/epsil/static-diagnostics.ts`) will see the
  new operators; `TypeLiteral` validation at canonicalization means type
  typos in `is` expressions surface as static diagnostics for free.
- **Tycho**: `Type`'s string result may be consumed downstream; R3's
  disposition should be checked against Tycho usage before phase 3.
