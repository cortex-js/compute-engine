# Nominal types: `type` / `type alias`, and value constructors

Status: **v6 — ALL DECISIONS RULED; phases 0–2 IMPLEMENTED 2026-08-01
(unstaged; full suite green, zero snapshot churn). D9 amended
(injectivity `eq`), D6 moved to v2 (`.`/`Field` surface + lowering),
bootstrap minting unconditional — all ratified. Remaining: phase 3
(docs incl. `src/cortex/docs/`, CHANGELOG). §4.5 constructor functions
are v2 with the shape and D12 representation pinned.**
Date: 2026-08-01
Related: `docs/plans/2026-08-01-type-variables-design.md` (§9.2 scoped the
base `type` statement; its generic-alias slot and the `forall` machinery
compose with this design), `doc/08-guide-types.md` ("Defining New Types"),
the shipped-but-unreleased `DeclareType` operator and Cortex `type`
statement (2026-08-01, unstaged).

## 1. Problem

The type layer already distinguishes **nominal** types (the
`ce.declareType()` default: `point <: point` by name, structural matches
refused) from **structural aliases** (`{alias: true}`: any value matching
the definition is compatible). But nominal types are uninhabitable from a
program: a value's type is synthesized from its structure — `(1, 2)` is a
`tuple<finite_integer, finite_integer>` and nothing makes it a `point`. A
nominal type is currently a set with no members. Concretely:

- No program can construct a `point`, so the just-shipped Cortex `type`
  statement had to lower to the *structural alias* semantics to be usable
  at all — conflating "declare a new type" with "abbreviate a type".
- The assignment routes disagreed about nominal compatibility (the
  declare-with-value route rejected a structural value at a nominal
  declared type; both assign routes accepted it) — being fixed as a
  prerequisite of this design: **all routes reject**, which is exactly the
  "no implicit coercion" posture a constructor story requires.
- There is no surface distinction: users cannot say which of the two kinds
  they mean.

## 2. Proposal at a glance

Two statement forms, one operator, one new mechanism:

```
type point = tuple<x: number, y: number>   // NOMINAL: a new, distinct type
type alias pair = tuple<number, number>    // STRUCTURAL alias

let p = point(1, 2)        // constructor, minted by the nominal declaration
p.type                     // point
let a: pair = (1, 2)       // ok — structural
let q: point = (1, 2)      // ERROR: a tuple is not a point
match p { point(x, y) => x + y }           // pattern matching, for free
```

**D1 (RULED, author 2026-08-01): the bare form is nominal.** This makes
three surfaces agree with zero annotation: bare Cortex `type` ↔ bare
`["DeclareType", name, body]` ↔ bare `ce.declareType(name, body)` are all
nominal; the `alias` word ↔ the `alias -> True` attribute ↔
`{alias: true}` are all structural.

The nominal mechanism is the **tagged application**: a nominal
`DeclareType` additionally mints a value-level operator named after the
type. `point(1, 2)` canonicalizes to — and *stays* — `["point", 1, 2]`;
the value is its own tag. No ascription wrapper, no per-value metadata:

- `.type` is the operator's declared result type (`point`), so nominal-ness
  survives interning, canonicalization, storage in collections
  (`[p, q] : list<point>`), and every value-level flow.
- Serialization is free: `point(1, 2)` already round-trips in Cortex and
  MathJSON.
- Pattern matching is free: a `point(x, y)` case is an ordinary operator
  pattern.
- Nominal distinction is enforced by shape: `point(1, 2)` and
  `polar(1, 2)` are different expressions; same-definition types can never
  be confused. `point(1, 2) == (1, 2)` is `False`.

What this is **not**: no variance, no parameterized nominal types
(`type point<T>` stays parse-and-rejected — the generics spec keeps
nominal parameterization out of scope), no subtype relation between a
nominal type and its definition (opaque by default, D3). (An earlier
draft declined constructor compilation in v1; superseded by D11's
same-release erasure, which shipped — §4.6.)

**Escaping types (gap found in phase 3, FIXED):** a type declared inside
a FUNCTION body used to error when it escaped as the function's inferred
result type (`Failed to parse type "(unknown) -> inner"`). Root cause:
the inferred signature was assembled as a STRING (`` `(${paramTypes}) ->
${bodyType}` ``) and re-parsed at the declaration site, where `inner` is
out of scope (`_BoxedOperatorDefinition.update`,
`boxed-expression/boxed-operator-definition.ts`). The signature is now
built as a `Type` **object**, with the body's `Type` carried through
directly instead of round-tripping through text — a `TypeReference`
carries its own `def`, so it stays usable wherever it escapes. No
widening and no rejection: `function f(a) { type inner = tuple<number,
number>; inner(a, a) }` applied to `2` yields `inner(2, 2)` of type
`inner`. The type NAME still does not leak (`ce.type('inner')` throws
outside the body); only the resolved reference travels with the value.
Scalar-result uses and block/loop bodies were already correct and remain
so. Pinned in `test/cortex/declare-type.test.ts`.

## 3. Surface syntax

### Grammar

```
<type_statement>  ::= "type" "alias"? <identifier> ("<" … ">")? "=" <type>
```

- `type` remains a **contextual keyword** (not reserved). The statement is
  claimed only in statement position by the shapes:
  - `type <name> =` / `type <name> <` — nominal (the `<…>` slot stays
    parse-and-rejected, `type-variables-unsupported`);
  - `type alias <name> =` / `type alias <name> <` — structural alias.
- `alias` is likewise **not reserved**. Disambiguation is pure lookahead
  (D8): `type alias point = …` is an alias statement because a name and
  `=`/`<` follow `alias`; `type alias = tuple<…>` (only `=` after `alias`)
  declares a *nominal type named `alias`* — legal, discouraged, pinned in
  a test so the lookahead cannot regress.
- Everything else about the shipped statement is unchanged: name must not
  be a reserved word; the body is parsed by the shared type DSL with the
  known-type-names resolver; the statement seeds its own name before the
  body parses (self-reference); malformed bodies are
  `type-annotation-error`.

### Lowering (MathJSON)

```
type point = tuple<x: number, y: number>
  → ["DeclareType", "point", "'tuple<x: number, y: number>'"]

type alias pair = tuple<number, number>
  → ["DeclareType", "pair", "'tuple<number, number>'",
       ["Dictionary", ["KeyValuePair", "alias", "True"]]]
```

The `DeclareType` operator itself is **unchanged** — nominal-by-default
was already its contract. Only the Cortex lowering flips: the shipped
(unreleased) parser lowers bare `type` to `alias -> True`; phase 0
re-points it (§7). The serializer mirrors: no-attributes →
`type name = body`; exactly-`alias -> True` → `type alias name = body`;
anything else keeps the generic `DeclareType(…)` call form.

### Version/skew posture

Nothing here has shipped in a release. Flipping the bare form's meaning is
therefore a pre-release correction, not a breaking change — which is
precisely why phase 0 must land before the next release cut (§7).

## 4. Semantics of the minted constructor

### 4.1 Minting

Registering a **nominal** type (either route: statement, operator, or
`ce.declareType` without `alias`) declares, in the same lexical scope, an
operator definition named after the type:

- **Signature** (D4): derived from the definition body.
  - `tuple` body → n-ary: `type point = tuple<x: number, y: number>` mints
    `point: (x: number, y: number) -> point` (named parameters from named
    fields; positional otherwise). Positional is *correct* for tuples:
    a tuple's field order is its semantics; the names are labels.
  - Any other body → unary: `type meters = number` mints
    `meters: (number) -> meters`; `type ids = list<integer>` mints
    `ids: (list<integer>) -> ids`. For `record` bodies the unary rule
    holds but needs its own sub-ruling — §4.1c, D4b.
- **Behavior**: `lazy: false`; operands canonicalize and are validated
  against the derived signature by the ordinary `validateArguments`
  machinery (wrong arity/types → the standard `incompatible-type` error
  value). `evaluate` returns the expression itself after evaluating its
  operands (an inert tagged value, like `KeyValuePair`). Pure — an empty
  effects slot; construction neither reads nor writes anything.
- **`.type`**: the definition's `type:` handler returns the nominal
  reference. This is the single source of nominal-ness.

### 4.1b Calling an alias — D10

The draft rule "the alias form mints nothing" leaves a trap (probed
2026-08-01): in

```
type alias pt = tuple<number, number>
const p = pt(1, 2)
```

`pt` in call position is just an unknown operator, so `pt(1, 2)` today
evaluates to the **inert symbolic application** `["pt", 1, 2]` — no error,
no warning (the did-you-mean scan only fires when a close known operator
exists), `p.type` is `unknown`, and the value even prints back as
`pt(1, 2)`. It *looks* like a working constructor call and is byte-identical
in shape to what a real nominal tagged value would be, while being
unchecked, untyped, and unrelated to the alias. The same silent shape
appears for a **nominal** type during the phase-0 window (declared, but the
constructor phase not yet landed).

**D10 — alias types mint a checked identity constructor** (recommend
**adopt**): `type alias pt = …` mints `pt` with the same derived signature
as the nominal form (D4), but its result is the **plain structural value**,
not a tagged one — `pt(1, 2)` validates `(1, 2)` against the definition and
returns it, with type `tuple<number, number>`. Consequences:

- One uniform story: *every* declared type name is callable; the alias/
  nominal difference is exactly the tag on the result, not callability.
- `pt(1, 2)` becomes a **checked cast** spelling (`(1, 2)` annotated-by-
  construction), and arity/type errors surface through the standard
  `incompatible-type` path instead of silence.
- Migrating a type between `alias` and bare `type` keeps constructor call
  sites working (annotation sites tighten, unavoidably).
- The D5 namespace rules extend to aliases (an alias also claims the value
  name, atomically).

Alternatives: (a) status quo — the silent inert application above;
(c) no constructor, but a parse-time Cortex lint ("`pt` is a type alias,
not a constructor — write `const p: pt = (1, 2)`") on calls to known type
names. Independent of the D10 outcome, **phase 0 ships the (c) lint**: the
parser already tracks `knownTypeNames`, and the lint is the only guard for
the phase-0 nominal window (type declared, constructor not yet minted) and
for raw-MathJSON consumers it costs nothing.

### 4.1c Record bodies — D4b

`type pt = record<x: number, y: number>` (note: `record<…>` is the
named-field shape; `dictionary<V>` is homogeneous and takes no field
names — `dictionary<x: number, y: number>` is a syntax error). Three
candidate constructor shapes, probed 2026-08-01:

- **Positional — `pt(1, 2)` — rejected.** Unlike a tuple, a record's
  field *order* is documentation, not semantics: reordering the fields of
  a `record` definition must be a no-op, but it would silently renumber
  every positional constructor call. This is exactly the silent-breakage
  class the rest of the design avoids.
- **Named arguments — `pt(x = 1, y = 2)` — deferred, not rejected.** The
  surface is already claimed: `=` inside call arguments parses as
  assignment and is linted `assign-in-argument` ("`==` was probably
  meant"). Claiming it for keyword arguments is a *language-wide*
  decision (every function, not constructors specially) and should arrive
  as that general feature; when it does, record constructors get it for
  free if the minted signature uses named parameters. Recorded as the
  ergonomic end state.
- **Unary — `pt({x -> 1, y -> 2})` — considered, superseded.** Would
  need a value-shape-aware check (a dictionary literal's synthesized type
  is `dictionary<finite_integer>` — key names are not in the type — so
  type-level subtyping against the record body can never pass).

**D4b RULED (author, 2026-08-01): record bodies auto-mint NO
constructor.** Their inhabitation story is **user-defined constructor
functions** (§4.5, v2). In v1 a record-bodied nominal type is
declarable but uninhabited, and the phase-0 call-position lint covers
`pt(…)` with a diagnostic. The D10 alias identity-mint is likewise
scoped to tuple/scalar/list bodies — record aliases wait for §4.5 too.

**Record-inhabitation finding (recorded):** record types are currently
uninhabitable from Cortex — `const p: pt = {x -> 1, y -> 2}` fails even
for an *alias* `pt`, because the literal's synthesized type
(`dictionary<finite_integer>`) does not carry key names and is not a
subtype of the record. Consequences: (a) the **nominal** record
constructor fully solves this (the tagged value's type is `pt` by
construction); (b) the **alias** record constructor (D10) validates the
shape but returns the plain dictionary, whose synthesized type still
reads `dictionary<finite_integer>` — so a subsequent
`const p: pt = pt({x -> 1, y -> 2})` annotation *still* fails. The
honest fix for the alias half is record-aware type synthesis for
dictionary literals (or a record-vs-dictionary subtype rule keyed on
value shape) — an orthogonal type-layer improvement, out of scope here,
recorded so the limitation is deliberate rather than discovered.

### 4.2 Opacity (D3)

Nominal values are **opaque by default**:

- `point ≮ tuple<x: number, y: number>` — a `point` is *not* usable where
  its definition's structure is expected. `First(p)`, `Sort([p])`-style
  collection access, arithmetic on `meters` — all reject exactly as they
  would for any non-collection/non-number operand.
- Values come out via:
  - **pattern matching** — `point(x, y) => …` cases (free, §2; note:
    Cortex `match` cases have no `case` keyword);
  - **field access** (`p.x`) — moved to v2 with a `Field` operator
    (D6 as amended; no `.` surface exists in Cortex yet);
  - re-reading operands positionally in MathJSON (`["point", 1, 2]` is
    ordinary MathJSON; hosts can destructure it).
- Tuple **destructuring does not pierce** (`let (x, y) = p` is a runtime
  shape error): destructuring is a tuple contract, and `point` is not a
  tuple. Rationale: piercing is one-way door — adding it later is
  additive, removing it is breaking; and Haskell's `newtype` posture
  ("unwrap explicitly") is the entire point of a nominal type.
- Transparent-to-definition subtyping (`point <: tuple<…>` one-way) is
  recorded as rejected-for-v1, admissible later without breakage.

### 4.3 Equality and identity

`point(1, 2) == point(1, 2)` — `True` (structural equality over the
tagged application, as for any operator). `point(1, 2) == (1, 2)` —
`False` (different shapes; this is nominal distinction doing its job).
`polar(1, 2) == point(1, 2)` — `False`. No new equality machinery.

### 4.4 Effects and purity

The constructor is pure; `DeclareType` keeps its `scope` effect.

### 4.5 User-defined constructor functions (v2 — shape pinned now)

(Author direction 2026-08-01: deferred to v2, but the target shape is
settled here so v1 reserves the right surface.)

A function definition **sharing a declared type's name, in the same
scope, after the type declaration**, is that type's constructor:

```
type circle = record<x: number, y: number, r: number>
function circle(x, y, r) { {x -> x, y -> y, r -> r} }

const c = circle(1, 2, 3)     // c.type == circle
```

(The body works verbatim today as a plain function — probed: dictionary
keys stay literal, values bind the parameters.)

- **The body computes the *payload*** — a value that must satisfy the
  type's definition body. For record bodies the check is
  **value-shape-aware** (exact key set, per-field value types against the
  definition — the synthesized-type route can never pass, §4.1c), run at
  construction time. The engine then **tags** the checked payload; the
  application's result type is the nominal reference.
- **General, not record-specific**: a constructor function may be written
  for any body kind, *overriding* the auto-minted constructor — this is
  the smart-constructor idiom: validation (`r >= 0`), normalization
  (`fraction(2, 4)` → the `1/2` payload), alternate parameterizations
  (`function circle(d) { {x -> 0, y -> 0, r -> d/2} }` — arity need not
  match the fields). For record bodies it is the *only* constructor.
- **Alias types**: a same-name function after a `type alias` is simply an
  ordinary function (no tagging; the D10 identity-mint is overridden).
  Permitted, no special machinery.
- **Effects flow honestly**: the minted application's effects are the
  body's (inferred or declared per the effects model). An effectful
  constructor forfeits caching/CSE exactly like any effectful function;
  pure is recommended, not enforced.
- **Ordering (amends D5)**: same-scope `function` with the type's name
  *after* the type declaration = constructor declaration. *Before* it (or
  with no such type in scope) the existing rules apply unchanged — for a
  nominal type declared later, the D5 same-scope collision error.
  Self-reference inside the body (a recursive/normalizing constructor)
  follows the ordinary declare-then-assign recursion idiom.

**D12 — what value does construction produce? (RULED (a), author
2026-08-01)**

- **(a) Payload-tagged, with an auto raw-injection arm — recommended.**
  `circle(1, 2, 3)` evaluates the body, checks the payload, and yields
  `["circle", ⟨payload⟩]` (a tuple payload spreads inline, matching the
  ruled auto-mint shape `["point", 1, 2]`; scalar/record/list payloads
  are a single operand). The minted operator is an **overload set**: the
  user's arm(s) plus an automatic **raw-injection arm** — one argument
  that already satisfies the definition body is checked and tagged
  directly, body skipped. Serialization always emits the raw-injection
  spelling (`circle({x -> 1, y -> 2, r -> 3})`), which is what makes the
  round-trip close: reparsing hits the raw arm, not the user body.
  Normalizing constructors therefore produce **equal values** from equal
  inputs (`fraction(2, 4)` and `fraction(1, 2)` construct the same
  payload, and D9's structural-over-the-tag equality answers `True`) —
  the semantics a math engine wants.
- **(b) Call-form-inert.** `circle(1, 2, 3)` stays `["circle", 1, 2, 3]`
  verbatim (the D2 value-is-its-own-tag reading taken literally; the
  body is only a representation map consulted by accessors/compile).
  Maximal round-trip simplicity, but normalization is impossible and two
  equal-by-construction values (`fraction(2, 4)` vs `fraction(1, 2)`)
  compare **unequal** — a false negative baked into equality. Recorded,
  not recommended.

Compilation composes with D11 either way: the body compiles as an
ordinary user function, the tag erases, boundary re-tagging comes from
the static signature.

### 4.6 Compilation is type erasure

Nominal vs structural is **irrelevant to the compiled representation**:
the tag is static information, fully enforced by the checker before
compilation, so both kinds erase to the *definition's* structural
representation (the Haskell-`newtype` guarantee — zero runtime cost).
`meters(x)` compiles to exactly `x`; `point(x, y)` compiles to whatever
`(x, y)` compiles to on that target (JS pair, GLSL `vec2`). Erasing the
tag is sound precisely *because* of D3: opacity is a static discipline,
already discharged by the time code is emitted.

So the v1 decline is **sequencing, not principle**. What is actually
missing, in dependency order (probed 2026-08-01):

1. **Reference unfolding in the type-driven machinery.** Every site that
   pattern-matches on a `Type`'s kind — the subtype lhs rules, the compile
   type gates, width/broadcast derivation — must learn to unfold a
   reference to its definition when a *representation* question is being
   asked. This is not hypothetical: today an alias-typed operand fails at
   **canonicalization**, before any compiler runs (`m + 1` with
   `m: meters`, alias of `number`, errors `incompatible-type` — the
   subtype relation unfolds alias references only on the rhs; §6). For
   aliases the unfold is also the *admissibility* answer; for nominal
   types admissibility stays opaque (D3) while representation unfolds.
2. **A target representation for the definition's shape.** Scalar bodies
   need nothing. Tuple bodies ride the target's existing tuple support:
   the GPU targets have fixed-width numeric vectors (`vec2`–`vec4`, the
   PointList machinery); the JS target compiles tuple-*consuming*
   expressions but a bare tuple value is not itself first-class today
   (probed: `compile(Tuple(1,2))` declines). Whatever a `tuple` body can
   do on a target, the nominal type over it can do — no more, no less.
3. **A compile rule for the minted constructor** — flag-driven off the
   definition (a `nominalConstructor`-style marker; never a name table):
   emit the payload. Unary → the operand itself; tuple → the target's
   tuple/vector construction. Trivial once (2) exists.
4. **Boundary marshalling.** Compiled JS traffics in raw representations.
   Inputs: a tagged value passed into a compiled function unwraps to its
   payload (statically known from the parameter's declared type). Results:
   a compiled function whose declared result type is nominal **re-tags**
   on re-entry into the engine — cheap and static, from the signature.
   Skipping re-tagging would silently launder a `point` into a tuple
   across a compile boundary, breaking round-trip identity.
5. **Accessors** — moved to v2 wholesale with D6 as amended (no `.`
   surface exists; the `Field` operator and its index/swizzle lowering
   ride the v2 milestone together). **`match`** compilation does not
   exist for anything today; stays out regardless.

**Staging (D11, RULED with amendment):** the constructor lands with a
clean decline first (return `undefined`, never throw), and the compile
phase follows **immediately, in the same release** (author direction
2026-08-01 — the release that ships `type`/`type alias` also ships
compile erasure; the decline is an intra-development state, never a
released one). Two steps, in order: (A) **scalar newtypes** — pure
erasure, no representation questions, unlocks the units-ish `meters`
class end to end; then (B) **fixed-width numeric tuple bodies** on the
targets that already have vectors (GPU) and pairs (JS), riding step (1)'s
unfolding. Shapes beyond those (wide tuples, non-numeric fields, nested
collections) keep the decline — the same boundary tuple bodies have
today.

## 5. Namespace bridging (D5)

Types live in `scope.types`; values/operators live in scope bindings. A
nominal declaration now claims **both** names. Rules:

- **Same-scope conflict = error.** If the current scope already has an
  explicit binding (value or operator) named `point`, the nominal
  `DeclareType` fails with an error value naming the conflict (the type is
  not registered either — registration is atomic across both namespaces).
  Symmetrically, a later `Declare`/`Assign` of a symbol named `point` in
  the *same scope* hits the existing "already declared" behavior against
  the minted operator.
- **Outer names are shadowed, not conflicted.** A nominal `type Sin = …`
  in an inner scope shadows the outer `Sin` operator within that scope —
  consistent with the bare-assign-over-builtin convention (shadow in the
  current scope by scope identity; the builtin is untouched outside).
  Legal, lintable later.
- **Statement re-run** replaces both halves: the `_declaredByStatement`
  replace semantics extend to the minted operator (delete and re-mint
  together with the type record).
- An **inferred** (auto-declared, valueless) binding of the same name
  upgrades, mirroring `Declare`'s upgrade rule — with one deliberate
  tightening over `declareFn`'s shared rule: only a HANDLER-LESS shell
  upgrades. A Cortex `function pf(x) { … }` has an inferred signature but
  a real body; the loose rule would let a later `type pf = …` silently
  clobber it.
- **Bootstrap minting (ratified 2026-08-01): unconditional.** The
  engine's own `declareType` calls mint like any other (`limits(…)`,
  `distribution(…)` are callable); the implemented `{ mint: false }`
  opt-out stays available but uncalled.
- **Same-name identity (ruled 2026-08-01, post-review): textual, with a
  shadow warning.** Nominal identity is the type NAME — two same-name
  declarations in nested scopes share one identity (values
  cross-assignable, equal-comparing). Ruled option: keep name identity
  as the semantics and make the accident loud — a `type` statement
  inside a BLOCK whose name is already known emits the `type-shadow`
  warning (top-level redeclaration stays silent: that is the
  statement-replace flow). Preferred long-term by the author over the
  recorded alternatives: definition-object identity (compare resolved
  `TypeReference`/def identity — would need three sub-rulings:
  serialization-as-scope-boundary, re-run identity reuse, cross-bundle
  identity) and unique internal tags (breaks MathJSON portability).
  Note the ceiling either way: the tag in a SERIALIZED value is just the
  name, so no scheme distinguishes serialized values.

## 6. The alias half, and adjacent defects

`type alias` is exactly the shipped structural-alias path
(`alias -> True`); no new semantics. One **must-fix** and one documented
edge, both reachable through either syntax:

- **MUST-FIX (phase 0): the subtype relation does not unfold an alias
  reference on the LHS.** `subtype.ts` unwraps `rhs.alias` only, so an
  alias-typed *operand* fails at canonicalization anywhere structure is
  required: `m + 1` with `m: meters` (alias of `number`) errors
  `incompatible-type("number", "meters")`; `First(p)` with `p: pt` (alias
  of a tuple) errors `incompatible-type("indexed_collection", "pt")`
  (probed 2026-08-01). Declaring and assigning alias-typed symbols works
  (rhs unfold); *using* them mostly does not — which makes the shipped
  alias feature unusable beyond pass-through, and blocks compilation
  (§4.6 step 1). The rule is small and one-directional: an alias
  reference on the lhs unfolds to its definition (`lhs.alias === true &&
  lhs.def` → `isSubtype(lhs.def, rhs)`); a **nominal** lhs stays opaque
  (D3). This subsumes the previously-noted primitive-body asymmetry
  (`type alias id = integer` matching in neither direction — same missing
  rule).
- **Named-field tuple aliases reject unnamed tuple values** —
  `tuple<x: integer, y: integer>` does not admit `(1, 2)` (whose type is
  unnamed). Intentional subtype semantics; the guide's examples must use
  unnamed bodies for aliases, while the nominal constructor renders the
  question moot (`point(1, 2)` carries the names via the signature).

## 7. Implementation plan

**Phase 0 — re-point the surface (pre-release; small).**
- Cortex parser: add the `type alias` form; lower bare `type` to the
  attribute-less (nominal) `DeclareType`. Serializer flips to match
  (§3). Update the shipped tests' expectations.
- Consequence, deliberately accepted (D7): until phase 1, a bare `type`
  declares an honest nominal type that no value inhabits —
  `let p: point = (1, 2)` errors `incompatible-type`, which is *correct*
  and identical to the post-phase-1 behavior; the constructor arrives
  purely additively. No temporary diagnostic, no semantic flip later.
  The guide steers to `type alias` for the useful-today case.
- Ride-along: the alias LHS-unfold subtype fix (§6 must-fix — without it,
  alias-typed operands reject at every structure-requiring site) and the
  D10 call-position lint (§4.1b).

**Phase 1 — the constructors.**
- Minting in the nominal registration path (both halves atomic, §5);
  signature derivation (D4); the `type:` handler; opacity (nothing to do —
  opacity is the *absence* of delegation, plus tests pinning it); named
  field accessors (D6); the alias checked-identity constructor (D10);
  `match` pins; statement-replace covering the minted operator;
  compile-decline pins (an intra-development state — see phase 2).

**Phase 2 — compile erasure (D11; same release as phases 0–1).**
- Step (A): scalar-newtype erasure (constructor compiles to its operand;
  boundary unwrap/re-tag from the static signature). Step (B): fixed-width
  numeric tuple bodies on the targets with existing vector/pair support;
  accessor lowering (`p.x` → index/swizzle). Driven by a definition flag
  on the minted constructor, never a name table. Shapes beyond A/B keep
  the decline.
- **Release gate:** the release that ships the `type`/`type alias`
  statement forms includes this phase — phases 0–2 are one release train.

**Phase 3 — docs and release notes.**
- `doc/08-guide-types.md` (rewrite "Defining New Types" around the two
  forms), `doc/85-reference-core.md` (`DeclareType` entry gains the
  minting behavior), CHANGELOG (amend the unreleased entry in place — the
  statement has not shipped in a release, so it is one feature, not a
  feature plus a breaking change).

Sequencing with the generics project: unchanged — this project stays ahead
of the `forall` phases; the reserved `<…>` slot later serves *alias*
generics (`type alias pair<T> = tuple<T, T>`, transparent, riding generics
phase 1) while **nominal** parameterized types remain out of scope
(variance), as the generics spec already records.

## 8. Decisions

1. **D1 — bare `type` is nominal: RULED** (author, 2026-08-01, this
   thread; supersedes the 08-01 implementation's alias lowering, which
   predates the ruling and is unreleased). `type alias` is the structural
   form.
2. **D2 — nominal mechanism = tagged application (minted constructor):
   RULED** (author, 2026-08-01). Alternatives recorded:
   annotation-as-ascription (cheap but leaky — the value stays a tuple and
   nominal-ness evaporates on any value flow; also contradicts the
   all-routes-reject posture); per-value type stamps (fragile under
   interning/canonicalization — shared structures cannot carry per-use
   tags).
3. **D3 — opaque by default; no destructure-pierce; `point ≮ def`:
   RULED** (author, 2026-08-01; one-way door — piercing/transparency
   admissible later, removable never).
4. **D4 — constructor arity: tuple body → n-ary (named params from named
   fields); any other body → unary: RULED** (author, 2026-08-01), with
   the record-body shape split out as **D4b**.
   **D4b — record bodies auto-mint NO constructor: RULED** (author,
   2026-08-01) — user-defined constructor functions (§4.5, v2) are the
   record inhabitation story; v1 record-bodied nominal types are
   declarable-but-uninhabited with the phase-0 lint covering call sites.
   Recorded alternatives: positional `pt(1, 2)` (rejected — record field
   order is documentation, and reordering would silently renumber call
   sites); auto-minted unary `pt({x -> 1, y -> 2})` (superseded by the
   constructor-function ruling); named arguments `pt(x = 1, y = 2)`
   (deferred to a general keyword-arguments feature — the `=`-in-call
   surface is currently claimed by assignment + the `assign-in-argument`
   lint; when it lands, constructor functions inherit it for free).
5. **D5 — namespace rules: same-scope explicit binding = atomic error;
   outer = shadow; statement re-run replaces both; inferred upgrades:
   RULED** (author, 2026-08-01), with the §4.5 ordering amendment (a
   same-name `function` *after* the type declaration is a constructor,
   not a collision — v2).
6. **D6 — field accessors (`p.x`): MOVED TO v2** (ratified 2026-08-01
   after implementation findings): Cortex has NO `.` field-access
   surface at all (`d.x` is a parse error even on dictionaries; the
   field surface is `d["x"]` → `At`, which gates on the operand's
   STATIC type, so a nominal operand rejects before any handler runs —
   answering it would mean claiming a collection kind, which D3
   forbids). v1 extracts fields via `match`. The v2 shape: a `.`
   accessor surface + a dedicated `Field` operator dispatching off the
   minted definition's field map — bundled with the §4.5 constructor
   functions milestone.
7. **D7 — phase-0 interim: bare `type` is honest-nominal immediately
   (uninhabited until phase 1): RULED** (author, 2026-08-01) over a
   temporary "not yet supported" diagnostic: the semantics never change
   afterward, so nothing released ever flips meaning.
8. **D8 — `type alias = …` declares a nominal type named `alias`
   (lookahead disambiguation, discouraged, pinned)** — recommend
   **adopt**; reserving `alias` as a type name buys nothing and would be
   the only reserved word in the type-statement grammar.
9. **D9 — equality: RULED, then AMENDED at implementation (ratified
   2026-08-01)**: structural over the tag, delivered via a minted `eq`
   handler encoding **constructor injectivity** — the general machinery
   correctly leaves `foo(1,2) == bar(1,2)` symbolic for arbitrary
   operators, so without the handler `polar(1,2) == point(1,2)` could
   not answer `False`. The handler fires only when BOTH sides are
   minted nominal applications (different tag → `false`; same tag →
   operand-wise equality, undecided operands defer) and defers
   otherwise; user operators are untouched.
10. **D10 — aliases mint a checked identity constructor (§4.1b): RULED**
    (author, 2026-08-01) — uniform callability; kills the silent
    inert-application trap; `pt(1, 2)` = checked cast. Phase 0 ships the
    call-position lint regardless, covering the nominal
    constructor-not-yet-landed window.
11. **D11 — compilation is erasure: RULED, with a same-release amendment**
    (author, 2026-08-01): (A) scalar-newtype erasure and (B) fixed-width
    numeric tuple bodies are an **immediate follow-up shipped in the same
    release** as the statement forms — the compile decline is never a
    released state for those shapes. Prerequisite for both: reference
    unfolding at representation-question sites (§4.6 step 1), whose alias
    half is the §6 phase-0 must-fix.
12. **D12 — constructed-value representation under constructor functions
    (§4.5): RULED (a)** (author, 2026-08-01) — **payload-tagged with an
    auto raw-injection arm** — the body's checked payload is what the tag
    wraps (tuple payloads spread inline, matching the D2 auto-mint
    shape); serialization emits the raw-injection spelling so round-trips
    close; normalizing constructors produce equal values (D9 equality
    over payloads). Alternative (b) call-form-inert (value stays
    `["circle", 1, 2, 3]` verbatim) recorded and not recommended:
    normalization impossible, equal-by-construction values compare
    unequal.

## 9. Test plan

- **Parser/serializer**: both forms → exact MathJSON; `type alias` with
  the `<…>` slot → `type-variables-unsupported`; `type alias = t` → the
  D8 pin; round-trips both forms; bare-`type` lowering carries NO
  attributes.
- **Registration**: nominal statement → `ce.type('point')` resolves,
  structural `matches` refused both directions; alias statement unchanged
  from today's pins; statement re-run replaces type AND constructor;
  same-scope collision → error value, *nothing* registered (probe both
  namespaces); outer-shadow case.
- **Constructor**: `point(1, 2)` → inert tagged value, `.type` `point`;
  arity/type errors via the standard path (`point(1)` / `point("a", 2)`);
  route parity `ce.function` / `ce.box` / Cortex parse (standing pin);
  purity (`isPure`, effects empty); host `ce.declareType` (no statement)
  also mints.
- **Opacity**: `let q: point = (1, 2)` rejects on all THREE routes
  (declare-with-value, `Assign` op, `ce.assign` — extends the
  nominal-assign suite); `First(p)` / destructuring reject;
  `p.x`/`p.y` accessors; `match p { point(x, y) => … }`;
  `point(1,2) == (1,2)` is False, `== point(1,2)` True.
- **End-to-end Cortex**: declare + construct + match + field access in one
  program; alias and nominal side by side (`pair` accepts `(1,2)`, `point`
  requires the constructor); notebook re-run.
- **D10**: `pt(1, 2)` on an alias returns the plain structural value with
  the structural type (and validates: `pt(1)` / `pt("a", 2)` error); the
  phase-0 call-position lint fires for a declared-but-constructorless type
  name and never for ordinary unknown functions.
- **Compile**: constructor application declines cleanly (v1); alias
  LHS-unfold regression — `m + 1` with `m: meters` and `First(p)` with
  `p: pt` evaluate AND compile after the §6 fix, while the nominal
  equivalents still reject at the same sites (opacity, D3).
- **Blast radius**: full-suite snapshot count on phase 0 (the lowering
  flip) — expected zero outside the feature's own tests; surface for
  review regardless (standing policy).
