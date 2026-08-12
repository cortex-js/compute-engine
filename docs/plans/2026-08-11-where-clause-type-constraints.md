# `where` clauses for type constraints — replacing `forall`

**Status**: proposed · **Date**: 2026-08-11 · **Supersedes**: the `forall`
prefix syntax introduced in `docs/plans/2026-08-01-type-variables-design.md`

## Decision

Replace the prefix `forall` quantifier with a **trailing `where` clause**. The
`forall` spelling is removed outright, not deprecated: the type-variable
feature is days old, the language is officially experimental, and pre-1.0 is
when this is cheap. Carrying both spellings costs more than migrating.

```
                        before                          after
identity        forall T. (T) -> T              (T) -> T where T
constrained     forall T: number. (T) -> T      (T) -> T where T: number
swap            forall T, U. (tuple<T,U>)       (tuple<T,U>) -> tuple<U,T>
                  -> tuple<U,T>                   where T, U
reverse         forall T: indexed_collection.   (T) -> T
                  (T) -> T                        where T: indexed_collection
map             forall T, U. (list<T>,          (list<T>, (T) any -> U)
                  (T) any -> U) -> list<U>        -> list<U> where T, U
```

### Rationale

The prefix form forces the reader past a clause of unbounded length before
reaching the signature — the cost scales with how constrained the type is,
which is backwards. Trailing `where` puts the signature first and matches
standard mathematical English (*"f(x) = ax + b where a, b ∈ ℝ"*).

**Only `where`, not both keywords.** The trailing position determines the
keyword. `forall` binds forward by construction — `T → T ∀T` is not how the
quantifier is written, and reading it after the body means holding an unbound
variable until the clause arrives, which is the exact parse difficulty being
eliminated. A trailing `forall` would be an exact synonym of trailing `where`:
same position, same grammar, same semantics, pure carrying cost.

**Implicit quantification is rejected.** `(T) -> T` meaning `where T` by
auto-quantifying free names was considered and dropped. Type-variable names and
declared nominal names are lexically indistinguishable — `ce.declareType('T',
'number')` is legal, making `(T) -> T` a valid *ground* signature today. Under
implicit quantification, meaning would depend on registry state at parse time,
and a typo (`(Poimt) -> Poimt`) would silently become the identity polytype —
the most permissive type available — instead of the hard `Unknown type` error
it is today. An explicit binding site stays.

## Grammar

The clause sits at the **top** of the type grammar, above the existing union
and intersection levels — it does not replace them:

```ebnf
<type>          ::= <constrained_type>
<constrained_type>
                ::= <union_type> [ <where_clause> ]
<union_type>    ::= <intersection_type> ( "|" <intersection_type> )*
<intersection_type>
                ::= <primary_type> ( "&" <primary_type> )*
<primary_type>  ::= … unchanged … | "(" <type> ")"

<where_clause>  ::= "where" <var_decl> ( "," <var_decl> )*
<var_decl>      ::= <name> [ ":" <bound> ] [ "is" <protocol> ( "&" <protocol> )* ]
```

Because `<constrained_type>` sits above `<union_type>`, a clause written after
an unparenthesized intersection attaches to the **whole** intersection, not to
its last arm — which is why per-arm quantification requires parentheses, and
why the unparenthesized form must be rejected (below).

- `where` is a **reserved word** in type strings, replacing `forall` in
  `RESERVED_TYPE_NAMES` (`instantiate.ts:74`).
- An omitted bound means `any`. `where T` is shorthand for `where T: any` —
  verified equivalent to today's unbounded `forall T.`:

  ```
  number <: any                                  true
  (string) -> string  matches  forall T.         true
  (string) -> string  matches  forall T: any.    true
  ```

  This makes the pure-quantifier case a degenerate instance of the bounded
  case rather than a separate production: one keyword, one rule, and `where T`
  reads as an elided bound rather than a special form.
- **The `is` slot is reserved now, not deferred.** `docs/TYPE_SYSTEM_ROADMAP.md`
  Appendix A is already written in trailing-`where` form and already uses
  `where T: collection is Hashable` and `where T: collection, T is Hashable`.
  Shipping a grammar that cannot parse the sibling design's own examples would
  force a second syntax break. So `is` **parses and is stored on the AST node**,
  and is **semantically inert** until protocols land: any type carrying an `is`
  clause fails at declaration time with a dedicated
  `protocol-conformance-unsupported` diagnostic, never a generic parse error.
  This costs one optional production and one diagnostic today.
- Every existing restriction carries over unchanged: `where` may only
  constrain a **top-level signature** (or one arm of an overload set); a
  variable may not appear in an intersection (bound it instead); an
  unquantified variable is an error; a variable must occur in argument
  position.

### Comma binding

`where T, U: number` binds *T unbounded, U: number* — each `<var_decl>` carries
its own bound, as in Rust. Unambiguous but a visual trap; a lint suggesting
`where T: any, U: number` when a bare declaration precedes a bounded one is
worth considering (non-blocking).

### Precedence against `&` (overload sets)

This is the one place trailing is strictly worse than prefix. Today arms are
self-delimiting:

```
(forall T. (list<T>) -> T) & (forall T. (set<T>) -> boolean)
```

Trailing, `where` must bind **tighter than `&`**, and the parens become
load-bearing:

```
((list<T>) -> T where T) & ((set<T>) -> boolean where T)
```

Per the grammar above, `<constrained_type>` sits *above* `<union_type>`, so an
unparenthesized `A & B where T` attaches the clause to the whole intersection —
not, as a "nearest signature" reading would suggest, to `B`. That whole-
intersection type is not a valid polytype (a clause may only quantify a
signature), so it is rejected.

**Detection**: no special case is needed. After `parseUnionType()` returns, if
the next token is `where`, the clause is parsed and attached to the type just
built; `validateDeclaredType` then rejects it unless that type is a signature —
the same check that already rejects `forall T. number`. The diagnostic must
name the fix:

> `A clause can only quantify a function signature. To constrain one arm of an
> overload set, parenthesize it: ((list<T>) -> T where T) & …`

This reuses the existing non-signature rejection rather than adding a
positional check.

## Termination — no terminator set is needed

The initial assumption was that `{`, `=`, `;` must be added as terminators.
Investigation shows there is no terminator list to add to. `parseTypePrefix`
lexes in **tolerant mode** (`lexer.ts:64`): *"the first character that cannot
begin a type token marks the natural end of the type."* So `=`, `;`, `{`, `)`,
and `,` already terminate a type for free, and the `where` clause inherits
that. The comma-separated `<var_decl>` list self-terminates for the same
reason — an identifier not preceded by a comma cannot continue the list.

Two consequences:

- **`.` handling can be removed.** The lone-`.` forall terminator
  (`lexer.ts:366`) goes away; the `..` numeric-range lexing stays.
- **`where` is already reserved in Epsil.** `reserved-words.ts:167` lists
  `'where'` as *"Not in use"*, and Epsil has no `where` in its own grammar. No
  identifier breaks, no `HARD_RESERVED_WORDS` migration.

## Binding strategy — how a trailing clause is parsed

This is the load-bearing section. Moving the clause after the body changes
**when identifiers are classified**, and the spec must name the mechanism.

### The problem

Identifier classification happens at parse time against
`Parser._typeVarScopes` — *"An identifier found here parses as a type
VARIABLE, shadowing every other reading"* (`parser.ts:255`), checked first in
`parsePrimaryType`. `parseForallType` pushes that scope **before** parsing the
body, so a quantified name shadows a nominal of the same name.

A trailing clause inverts this: the body is read before the clause is known.
The behavior at stake is pinned by `test/epsil/type-variables-epsil.test.ts`
(D13: shadowing):

```
type point = tuple<number, number>
let f: forall point. (point) -> point   →  f(5) OK, finite_integer  (variable wins)
let g: (point) -> point                 →  g(5) incompatible-type   (nominal wins)
```

The test comment calls clause-stripping *"a CAPTURE, not just a loss"*. A naive
trailing-clause parse produces exactly that capture.

### The strategy: lexical pre-scan, then seed, then parse

Three phases, reusing mechanisms that already exist and are proven.

**Phase 0 — locate the clause (lexical, resolves nothing).** Scan tokens from
the start for a **depth-0 `where`**, tracking `(`/`)`, `<`/`>`, `[`/`]`,
`{`/`}`. In prefix mode the scan stops at the first token that cannot continue
a type — the existing tolerant-lexer rule (`lexer.ts:64`) — so `= 5`, `{ … }`,
and `, x` bound the search. Epsil has no `where` of its own, so any depth-0
`where` in range is this clause. No names are resolved, so no side effects
fire.

**Phase 1 — read the clause.** Hand the clause text to the existing
`parseTypeParameterClause` (`parse.ts:200`), already *"the one clause reader
shared by every route that carries a clause as text"* — `DeclareType`,
`ce.declareType({typeParams})`, and `type alias Pair<T>`. It handles names,
duplicates, reserved names, bounds, and variance markers. Only the **names**
are needed for seeding.

**Phase 2 — parse the body, seeded.** Pass the names as `typeVars` to the
existing pre-seeding path: `parseTypePrefix(source, resolver, typeVars)` and
`new Parser(s, { typeVars })` already accept it, pushing the scope *"from the
first token, exactly as if an enclosing `forall` had quantified them"*
(`parser.ts:286`). Verified equivalent:

```
parseType('(point) -> point', undefined, [{name: 'point'}])
  → args: [{kind: 'variable', name: 'point'}], result: {kind: 'variable', name: 'point'}
```

The variable wins, matching D13. **Acceptance criterion: the D13 shadowing
tests pass unmodified except for the syntax rewrite.**

### Why not the alternatives

- **Retroactive reclassification** (build unresolved nodes, fix up after the
  clause) is *unsafe*: name resolution has **side effects** —
  `typeResolver.forward()` registration, gated by `_sawForwardRef`
  (`parser.ts:265`, `parse.ts:93`). A name resolved before the clause is known
  would already be registered as a forward reference before being reclassified
  as a variable. An ordering bug by construction.
- **Backtracking** (parse, detect `where`, re-parse) needs a new
  "tolerate unknown names" mode threaded through every unknown-name error path,
  and still double-parses. Phase 0 gets the same information from a scan that
  resolves nothing.

### Bound scoping must be unified (and this settles W2)

The two existing clause readers **disagree** on whether a clause's own names
are in scope while parsing bounds:

| Reader | Names in scope for bounds? |
|---|---|
| `parseForallType` (`parser.ts:614`) | **Yes** — `scope.add(name)` runs before that name's bound is parsed |
| `parseTypeParameterClause` (`parse.ts:200`) | **No** — *"Bounds are parsed as ordinary — GROUND — types with the clause's own names NOT in scope"* |

Since Phase 1 adopts `parseTypeParameterClause`, the `where` clause inherits
the ground-bound rule, and the divergence must be closed deliberately rather
than by accident.

> **Rule**: seed **all** names first, then parse **all** bounds. This makes the
> clause order-independent (a bound may reference a variable declared later —
> W2), and unifies both readers on one rule. Until §5 lands, a
> variable-referencing bound still fails `validateDeclaredType`; the change is
> that it fails *validation* with a clear message rather than *parsing* with an
> unknown-type error.

### The real hazard: `where` at return-type position

`parseHeldType` (`epsil/parser.ts:3020`) parses **only the return type** after
`->`, relying on `{` or `=` to stop it. Once `where` is a type keyword, this
call would swallow the clause:

```
function f(x: T) -> T where T: number { … }
                      ^^^^^^^^^^^^^^^ belongs to the whole signature,
                                      not to the return type `T`
```

The clause must attach to the assembled signature, so `parseTypePrefix` needs
an explicit **`allowWhere` flag**. Critically, `parseTypeBody` is **not** a
single call class: `src/epsil/parser.ts` also reaches annotation parsing from
parameter annotations, pattern annotations, type-declaration bodies, and
compound `is` checks. Every caller must be classified, not just the four direct
`parseTypePrefix` sites:

| Context | `allowWhere` | Why |
|---|---|---|
| Standalone annotation (`let f: <type> = …`) | **true** | the annotation *is* the whole type |
| Declaration level, after the return type | **true**, at the *declaration* parser | clause quantifies the assembled signature |
| Return type itself (`parseHeldType`, `:3020`) | **false** | clause belongs to the signature, not to `T` |
| **Comma-delimited annotation** (parameter / pattern, inside a list) | **false** | see below |
| Generic-clause bound (`<T: bound>`, `:2482`) | **false** | bounds are ground; a nested clause is already illegal |
| `is`-operator name check (`:3535`) | **false** | operand is a bare type name |

The comma-delimited row is the sharp one. In a parameter list,
`(T) -> T where T, x: number` would let the `,`-separated `<var_decl>` list
consume `x: number` — simultaneously a well-formed `<var_decl>` and a
well-formed next parameter. Comma does **not** terminate the type "for free"
here, and error recovery could silently erase the following parameter. Since a
nested annotation can never legally carry a clause (nested polytypes are
rejected), set `allowWhere: false` in every comma-delimited context so `where`
there is an immediate, well-located error.

**Action item**: audit and classify *every* annotation-parsing caller in
`src/epsil/parser.ts` before implementation. If the audit finds more classes
than the table above, thread a context mode (standalone / declaration-level /
nested / ground-bound) rather than a bare boolean.

### Interaction with the `<T>` binder

Two binder sites coexist, as in Rust — angle brackets on declarations, `where`
on anonymous types. They are alternatives, never combined:

```
function f<T: number>(x: T) -> T { … }         // angle binder
function f(x: T) -> T where T: number { … }    // where binder — equivalent
let f: (T) -> T where T: number = …            // no binder site — where required
```

`function f<T>(…)` and `function f(…) where T` are synonyms. Specifying **both**
a `<…>` clause and a `where` clause on the same declaration is an error (one
binding site per declaration) — so `function f<T>(x: T) -> T where T: number`
is rejected, not treated as a bounded `<T: number>`.

### Clause placement — the clause always goes last

Epsil has **two** definition routes, both of which take a return type through
`parseHeldType` and a signature through `definitionAscription`:

```
function f(x: integer) -> real { x + 0.5 }     // block form  (parser.ts:2329)
f(x: integer) -> real = x + 0.5                // math form   (parser.ts:2622)
```

`-> <type>` is optional in both, and an effect specifier may sit between the
parameter list and `->` (`f(x) random -> integer = …`). **Ruling**: the clause
is always **last** — after the effects slot, after the return type, and in
every form, including when the return annotation is absent:

```
function f(x: T) -> T where T { … }              // block, annotated
function f(x: T) where T { … }                   // block, return inferred
function tick(x: T) random -> T where T { … }    // block, with effects
f(x: T) -> T where T = x + x                     // math form
let f: (T) -> T where T: number = …              // anonymous type
```

One rule — *the clause terminates the signature* — across all five spellings.
It matches the anonymous-type case, where the clause has nowhere else to go;
it keeps the parser's job identical to Phase 0's scan-to-the-end; and it means
`specifierSignature`'s `prefix` becomes a suffix with no other structural
change.

## Migration

Type-syntax occurrences only. The `ForAll` logic operator and `\forall` LaTeX
are unaffected and must be excluded from any sweep — but **do not use
`grep -a "forall [A-Z]"`**: binders are not required to be uppercase, and
lowercase ones exist (`forall zz.`, `forall integer.` in
`test/compute-engine/type-variables.test.ts`; `forall point.` in
`test/epsil/type-variables-epsil.test.ts` — 9 real cases). Use a
casing-agnostic discriminator that excludes `\forall` and `ForAll`.

Counts below are **line counts** (`grep -c`); occurrence counts run ~2 % higher.
They are indicative — **re-run immediately before the sweep**, since the tree
is under concurrent edit (`docs/TYPE_SYSTEM_ROADMAP.md` changed during this
document's own review).

| Surface | Lines | Notes |
|---|---|---|
| `src/**/*.ts` | ~230 | **41** library signatures across `arithmetic` (3), `complex` (1), `core` (31), `collections` (5), `linear-algebra` (1). `logic.ts`'s single hit is a `\forall` LaTeX comment — **no change needed there** |
| `test/**` | ~797 across 30 files | concentrated: `type-variables` (240), `generic-function-literals` (140), `design-d-callback-contract` (60) |
| **snapshots** | **0** | no `-u` churn — the serialization risk flagged earlier does not materialize |
| `doc/08-guide-types.md` | ~63 | the main guide section |
| `doc/87-reference-functions.md` | 4 | |
| `src/epsil/docs/types.md` | 4 | user-facing |
| `src/epsil/docs/declarations.md` | 1 | user-facing |
| `src/api.md` | — | autogenerated; regenerate with `npm run doc` after the source JSDoc is updated |

Also to update:

- **`specifierSignature()` (`src/epsil/parser.ts:2775`)** — the **only** place
  a `forall` string is emitted. Assembles
  `` `forall ${typeParams…}. (${args})${effects} -> ${ret}` `` (the `prefix`
  local) and hands it to the type parser. A **live code path, not a comment**:
  leaving it unchanged breaks every `function f<T>(…)` declaration — the
  already-shipped M2 milestone — at parse time. The `prefix` becomes a
  **suffix**, per the clause-goes-last ruling.
- **`definitionAscription()` (`src/epsil/parser.ts:2722`)** — the shared caller,
  reached from *both* definition routes (block form `:2353`, math form
  `:2624`). It emits no `forall` itself, but carries clause-aware behavior that
  must survive: it short-circuits to a plain return-type ascription when there
  is neither a clause nor an effect specifier; on a **rejected clause** it falls
  back to *no* ascription (*"the plain return type would name a variable that is
  no longer in scope"*); and it spans the diagnostic over the clause when there
  is no specifier. Its doc comments describe the clause as a prefix and need
  rewording.

### The assembled-signature route stays sound

Both definition routes reach the type parser through a **synthesized** string,
not a source slice. Today `specifierSignature`'s doc justifies this as: *"The
result is SELF-CONTAINED — `forall` introduces its own names — so the
validation below needs no seeding."*

That property is **preserved** under a trailing clause: the assembled string
becomes `(args)${effects} -> ${ret} where T: bound`, which is equally
self-contained, and the Phase 0 pre-scan operates on any string regardless of
provenance. So the no-seeding justification still holds and the declaration-time
checks (unused variable, result-only variable, non-ground bound, duplicate)
keep coming back as parse-time diagnostics for free.

Two details to carry over:

- `retText` defaults to `'unknown'` when no `->` was given (the wide-result
  convention). Under the clause-goes-last ruling that assembles as
  `(T) -> unknown where T` — valid, since `T` still occurs in argument
  position. This is the form `function f(x: T) where T { … }` produces.
- The effects slot sits before `->`, so the clause lands after both:
  `(T) random -> T where T`.
- `RESERVED_TYPE_NAMES` (`instantiate.ts:74`) — `forall` → `where`
- The parser diagnostic that advises *"declare a bound on it instead: `forall
  T: number.`"* (`instantiate.ts:565`) and the sibling messages at `:511`,
  `:595`, `:603`
- `boxed-type.ts` doc comments (`:37`, `:111`, `:148`, `:289`)
- `serialize.ts` — the `forall` emission template
- Canonical `.toString()` output — see the serialization ruling below

### Host-API compatibility break

Epsil pre-reserves `where` (`reserved-words.ts:167`, *"Not in use"*) and has no
`where` in its own grammar, so **no Epsil identifier breaks**. The **host type
API is a different surface, and it does break**: `RESERVED_TYPE_NAMES` today
contains only `forall`, and

```
ce.declareType('where', 'number')    // SUCCEEDS today
ce.declareType('forall', 'number')   // errors: reserved-type-name
```

After the swap those invert. Any consumer with a nominal type named `where`
breaks, and `forall` becomes newly declarable. This is a real, if unlikely,
break and must be listed in the CHANGELOG rather than denied.

*Tests to add*: declaring and referencing `where` (now rejected) and `forall`
(now permitted).

### Legacy-syntax diagnostic

Once `forall` is unreserved, a leftover `forall T. …` — missed by the sweep, or
in a user's saved script — would fail with a generic unknown-type or cascading
parse error. Since this is a deliberate breaking change, add a targeted
diagnostic: if a type string begins with the identifier `forall` followed by an
identifier and one of `:` `,` `.`, fail with

> The `forall T. …` prefix syntax was replaced by a trailing `where` clause:
> `(T) -> T where T: number`

### Serialization ruling

`.toString()` emits the **shorthand** for an unbounded variable — `where T`,
not `where T: any` — and an author-written explicit `: any` is **normalized
away**. Rationale: `any` is the identity bound, so preserving both spellings
would give one type two canonical strings and split dedup/serialization keys in
`serialize.ts`. Variable *names* continue to round-trip as the author wrote
them, as today. This closes the open question rather than leaving it to
implementation.

Zero snapshots means the churn is confined to explicit string assertions in
tests, which are mechanical.

## Acceptance criteria

Rewriting existing `forall` assertions does not exercise what is new about
postfix parsing. Require a route-parity table across `ce.type()`,
`ce.declare()`, standalone annotations, anonymous generic literals, named Epsil
definitions, overload arms, and serialize→parse — with both positive and
diagnostic cases for:

| Boundary | Must verify |
|---|---|
| Delayed shadowing | the D13 tests (`type-variables-epsil.test.ts`) pass with only the syntax rewritten |
| Nominal vs. variable | `(point) -> point` alone is the nominal; `… where point` is the variable |
| Prefix-mode extent | exact consumed offset; the token following the clause survives (`= 5`, `{`, `,`) |
| Comma contexts | `where` inside a parameter annotation errors at the `where`, and does not eat the next parameter |
| Clause shapes | empty clause, trailing comma, duplicate name, reserved name, malformed bound |
| Non-signature target | `number where T` and unparenthesized `A & B where T` both rejected with the parenthesize-the-arm message |
| Nested clause | unparenthesized nested `where` rejected (W1) |
| Overload arms | `((list<T>) -> T where T) & ((set<T>) -> boolean where T)` parses per-arm |
| Declaration forms | with/without return annotation, with effects, `<T>`-vs-`where`, and both-binders rejected |
| Legacy input | `forall T. (T) -> T` produces the migration diagnostic, not a generic error |
| Round trip | serialize→parse→serialize is stable; explicit `: any` normalizes to shorthand |
| `is` slot | `where T: collection is Hashable` parses and fails with `protocol-conformance-unsupported` |

## Documentation plan

| File | Change |
|---|---|
| `doc/08-guide-types.md` | Rewrite the polymorphism section (~line 885 onward): all examples, the round-trip example, the reserved-word note, the intersection-rejection guidance |
| `doc/87-reference-functions.md` | 4 signature examples |
| `docs/TYPE_SYSTEM_ROADMAP.md` | **Re-audit against the current file first** — this document is under concurrent edit (§2 was renumbered and content moved *during* this spec's review), so line numbers here are unreliable. Appendix A ("Protocol Constraints", "Conditional Conformance") is *already* written in trailing-`where` form, including `where T: collection is Hashable` and `where T: collection, T is Hashable` — that is the surface the reserved `is` slot must match, and it is larger than W1–W3 alone. Then apply W1 (§6.2 rank-2), W2 (§5 bounds), W3 (prenex wording), and translate the remaining `forall` examples |
| `docs/plans/2026-08-01-type-variables-design.md` | Header note pointing here as superseding the surface syntax (semantics unchanged) |
| `docs/plans/2026-08-04-generic-function-literals-design.md` | The `<T>` binder is unchanged; add the `where` equivalence and the one-binding-site rule |
| `CHANGELOG.md` | Breaking change under the existing `## [Unreleased]` heading |

## Roadmap compatibility (`docs/TYPE_SYSTEM_ROADMAP.md`)

Audited every `forall` example in the roadmap. Most translate mechanically —
§1 D2 (`forall T. (T, T) -> T`), §6.1 constrained-HKT
(`Map: forall T: collection, B. …`), and the §5 examples all become trailing
clauses with no change in meaning. Three items need attention.

### W1 — Rank-2 nesting is ambiguous under a trailing clause (blocking for §6.2)

§6.2 sketches a rank-2 witness as `record<map: forall A, B. …>` and defines
*"Rank = where `forall` nests left of arrows"*. A nested quantifier is exactly
where trailing `where` breaks down: its `,` separator collides with the record
field separator.

```
record<map: (A) -> B where A, B, other: number>
                            ^^^^^^^^^^^^^^^^^ where-list continuation,
                                              or a new record field?
```

`other: number` is a well-formed `<var_decl>` *and* a well-formed record field.
Prefix `forall A, B.` self-delimited via the `.`; trailing `where` does not.
Nested quantification is rejected today, so this is not a v1 blocker — but the
resolution must be reserved now:

> **Rule**: a `where` clause in any nested position must be parenthesized —
> `record<map: ((A) -> B where A, B), other: number>`. Unparenthesized nested
> `where` is a syntax error, never a silent reinterpretation.

This is the same failure mode as the `&` precedence rule above, and takes the
same resolution: mandatory parens, loud failure.

### W2 — Variable-referencing bounds and declaration order (§5)

§5 plans to lift the gate rejecting `forall T: comparable<T>` and
`forall T: list<U>`. Verified both are rejected today, so ordering is
currently unobservable. When §5 lands, the clause must be specified
**order-independent** — a bound may reference a variable declared later in the
same clause:

```
(T) -> U where T: list<U>, U        // `U` used in T's bound, declared after
```

Not introduced by this change (prefix `forall` has the identical question),
but the clause is being redesigned, so state it rather than inherit it
unstated. Trailing position is mildly *better* here: the reader has already
seen `U` used in the signature before meeting it in a bound.

**Settled** by the seed-all-names-then-parse-all-bounds rule in "Bound scoping
must be unified" above, which also closes the existing divergence between the
two clause readers. No further decision is needed for §5 beyond lifting the
`validateDeclaredType` gate.

### W3 — "Prenex" terminology (§1, "Where the type system is today")

Line 59 describes v1 as *"prenex (`forall T. …` / `function f<T>(…)`)"*.
*Prenex* means quantifiers-in-front, so the label reads as a syntax claim that
trailing `where` falsifies. The system stays prenex in the sense that matters
(quantifiers only at top level, never nested left of an arrow — the §6.2 rank
sense). Reword to *"rank-1 (quantifiers top-level only)"* to decouple the
property from the syntax.

Editorial: §6.2's prose *"Rank = where `forall` nests"* now collides with the
keyword; reword to *"Rank = how deeply a quantifier nests"*.

## Rulings (previously open)

1. **`is` conformance slot** — **reserved now.** `<var_decl>` parses
   `["is" <protocol> ("&" <protocol>)*]`, stores it, and rejects it at
   declaration time with `protocol-conformance-unsupported`. Forced by the
   roadmap's Appendix A already using the construct; deferring would mean a
   second syntax break.
2. **Serialization** — **shorthand**, and explicit `: any` normalizes away.
   See the serialization ruling under Migration.

3. **Clause placement** — **always last**, after the effects slot and the
   return type, in all five declaration forms. See "Clause placement" above.

## Open questions

1. **Bare-`where` lint.** Warn on `where T, U: number`, where a bare
   declaration precedes a bounded one and the comma binding may misread? Low
   stakes; non-blocking.

## Review status

Reviewed 2026-08-11 by Claude + Codex (13 findings —
`docs/scratch/2026-08-11-where-clause-type-constraints_SPEC_REVIEW.md`). All 13
are resolved in this revision. The one remaining open question (the bare-`where`
lint) is cosmetic and does not block implementation.

**Implementation order**: Phase 0–2 binding strategy first (it is the only part
that is not mechanical), verified against the D13 shadowing tests; then
`specifierSignature`/`definitionAscription`; then the sweep.
