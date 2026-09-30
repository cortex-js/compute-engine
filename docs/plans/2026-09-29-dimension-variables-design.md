# Dimension variables: a type variable in a collection's length slot

**Status: IMPLEMENTED 2026-09-29 (levels 1 and 2), pending review and
publication.** Scope agreed by the user on 2026-09-29; arithmetic on lengths
deferred. The user also asked (2026-09-29) that the representation admit
numbers, booleans and strings as value-level parameters later, which is why
the parameter kind is `'value'` rather than `'dimension'` (D10). Origin:
GitHub issue #364 (enumeratio). Tests:
`test/compute-engine/dimension-variables.test.ts`.

## 1. The problem

A collection type already carries its length, and a fixed length in a
signature is already enforced, but a signature cannot name a length and
relate it across positions. Measured on the tree at `0d863210`:

| Input | Today |
|---|---|
| `[1,2,3,4]` | typed `vector<integer^4>` |
| `[[1,2],[3,4]]` | typed `matrix<integer^(2x2)>` |
| `ce.declare('v', 'vector<3>')` | typed `vector<3>` |
| `G` declared `(x: list<integer^3>) -> integer`, `G([1,2,3])` | valid |
| `G([1,2])` | `incompatible-type`, expected `vector<integer^3>`, got `vector<integer^2>` |
| `G(w)` with `w: list<integer>` (no length in the type) | admitted; the check is deferred |
| `Range(1,5)` | typed `range`; no length in the type |
| `ce.box(3).type` | the value-literal type `3` |
| `foo` declared `(n: integer<3..3>, x: list<integer^3>) -> integer`, `foo(4, [1,2,3])` | `incompatible-type`, expected `integer<3..3>`, got `4` |
| `(x: list<integer^N>) -> integer where N` | parse failure |
| `(x: vector<T^N>) -> T where T, N` | parse failure |

So two channels exist in the type layer and both already reject a wrong
literal: the length of a list (`^3`) and the value of a number literal (`3`,
or the singleton range `integer<3..3>`). What is missing is a variable that
stands for a positive integer and is bound from either channel.

The engine's own grammar comment names this as a future item with the same
spelling and the same reason it is not trivial: dimensions are integers, not
types, so they need their own variable kind and solver
(`src/common/type/types.ts`, "Future considerations"). The feature also
serves the type-system north star, moving what type handlers compute into
declarations: `docs/TYPE_SYSTEM_ROADMAP.md` §9.2 item 3 ("dependent
element/shape types") lists shape algebra over literal dimensions as the
feature that retires the most handler code.

## 2. Scope

**In scope (level 1, signatures).**

- A `where` variable in a `^` slot: `list<T^N>`, `vector<T^N>`, `vector<N>`,
  `matrix<T^(MxN)>`, `matrix<MxN>`, `list<T^(MxNxP)>`.
- The same variable as a whole type at a parameter or result position, where
  it means "the integer whose value is that length": `(n: N, x: vector<T^N>)
  -> T where T, N` accepts `foo(3, [1,2,3])` and rejects `foo(4, [1,2,3])`;
  `(x: list<T^N>) -> N where T, N` types `Length([1,2,3])` as `3`.
- Substitution into a result: `(matrix<T^(MxN)>, matrix<T^(NxP)>) ->
  matrix<T^(MxP)> where T, M, N, P`.
- A ranged integer bound: `where N: integer<2..>`.

**In scope (level 2, nominal types).**

- A dimension parameter on a parameterized nominal type: `type
  permutation<N> = list<integer^N>`, with `permutation<3>` an applied
  reference and `(p: permutation<N>, q: permutation<N>) -> permutation<N>
  where N` a signature over it.

**Out of scope (a later design, not this one).**

- Arithmetic or relations between dimensions: `^(M+N)` for `Join`, `M*N` for
  `Flatten`, `where M < N`. This needs a term language inside types with a
  normal form and an equality decision. It overlaps roadmap §9.2 item 4
  (bound arithmetic over ranged types) and should be designed with it.
- A length read from a non-literal expression. `Length(v)` for `v:
  vector<3>` is typed `integer` today, so at `n: N` it binds nothing and is
  admitted. Once `Length` is declared `(list<T^N>) -> N`, that call binds by
  itself, with no change to this design.
- Runtime enforcement for an actual whose type has no length. `G(w)` above
  stays as it is: admitted at the call, checked wherever the ground `^3`
  check runs today.
- Rank polymorphism (a variable standing for a whole dimension list),
  tuple arity variables, and string lengths.

## 3. Grammar

```text
<dimensions> ::= "^" <dimension>
             | "^(" <dimension> ("x" <dimension>)* ")"
<dimension>  ::= <positive-integer_literal> | <identifier>
```

The leading-dimension forms `vector<N>` and `matrix<MxN>` accept an
identifier in the same way, mirroring today's `vector<3>` and `matrix<2x3>`.

- An identifier in a dimension slot must be declared by the enclosing `where`
  clause, or by the parameter list of the nominal type being declared. There
  are no named dimensions, so an undeclared identifier there is an error,
  `undeclared-dimension-variable`, not a type-name lookup.
- `list<N>` reads `N` as the ELEMENT type, exactly as today. A length in a
  `list` type is always written after `^`: `list<T^N>`. The leading-length
  spelling exists only for `vector` and `matrix`, whose default element type
  is `number`.

**Kind by position (D1).** A `where` variable that occurs in at least one
dimension slot anywhere in its signature is a dimension variable. Every other
occurrence of a dimension variable must be a whole type at a type position
(a parameter type, a result type, a tuple or record field, a collection
element type), where it denotes the singleton integer type of the solved
length. A dimension variable used as the element type AND as a length of the
same list (`list<N^N>`) is legal by this rule but pointless; it is not an
error. A variable that never occurs in a dimension slot is an ordinary type
variable, unchanged. Consequence to document: in `(n: N, x: list<T^N>)`, `N`
is a dimension variable; deleting the list parameter turns `N` into a type
variable and `n: N` into the identity-style generic it is today.

**Bounds and protocols.** A dimension variable's bound, when written, must be
a ground integer type: `integer` or a ranged `integer<a..b>`. Its default
bound is `integer<1..>`. Any other bound is `dimension-bound-not-integer`.
The `is` protocol slot on a dimension variable is an error,
`dimension-variable-protocol`.

**Result-only.** A dimension variable that occurs in no parameter position is
rejected as `unsolvable-type-variable`, the rule type variables already
follow (`validateDeclaredType`, `src/common/type/instantiate.ts`). `() ->
vector<3>` is fine; `() -> vector<N> where N` is not.

## 4. Representation (as built)

- `ListType.dimensions` stays `number[]`. A dimension variable is the `-1`
  wildcard on its axis plus a name in a parallel field,
  `dimensionVariables?: (string | undefined)[]`, aligned with `dimensions`.
  Reason: twenty files outside the type layer read lengths as numbers
  (compilers, collection handlers, tensor views), and for every one of them
  "length not known" is the correct reading of a variable; only the solver,
  substitution, serialization, reduction and validation read the names. The
  design first proposed one slot holding either a number or a variable node;
  that would have touched every reader for no gain in behavior.
- A value variable at a TYPE position is the existing variable node with a
  flag, `{ kind: 'variable', name, value: true }`, set by the type builder
  once the clause's kind is known (a length slot may come after the
  type-position use, so the finished body is marked in one pass). No change
  to `NumericType`.
- `TypeParameter` gains `kind?: 'value'`. The kind is decided by position
  when the type is built and stored on the clause entry, so the solver, the
  variance walker and the nominal-type machinery read it directly.
- The type argument of a nominal type at a dimension parameter is the
  existing value-literal type: `permutation<3>` is a reference whose argument
  list holds `{ kind: 'value', value: 3 }`. This type already parses in an
  argument position (`parseType('tuple<3, integer>')` succeeds today), so the
  type-argument list needs no new node kind; it needs a kind check (§7).

## 5. Solving

Dimension variables are solved in the same call-site walk as type variables
(`walkPattern`, `src/common/type/instantiate.ts`) but by EQUALITY, not by
join. Type variables join their lower bounds because a value of a narrower
type is acceptable where a wider one is expected; a length has no such
order. Two positions that bind the same dimension variable to different
numbers are a conflict, never a wider length.

**At a list pattern with dimensions.** Pair the pattern's dimensions with the
actual's leading dimensions.

- A number in the pattern must equal the actual's dimension at that axis;
  this is the ground rule, unchanged.
- A variable binds to the actual's dimension when that dimension is a known
  positive integer. A later binding of the same variable to a different
  number rejects that operand with `incompatible-type`, whose expected type
  is the pattern with the earlier binding substituted: `dot([1,2,3],
  [1,2,3,4])` reports expected `vector<real^3>`, got `vector<real^4>` on the
  second operand. Blame falls on the later position, which is the existing
  rule for bound failures.
- An actual with no dimensions, or `-1` at that axis, binds nothing and
  raises no conflict. This keeps today's admission of `G(w)`.
- The element position of a dimensioned pattern is what remains after
  peeling as many axes as the pattern states: `matrix<T^(MxN)>` binds `T` to
  the scalar element of a rank-2 actual. A pattern of rank 1 (`list<T^N>`,
  which is `vector<T^N>`) is a rank-1 constraint exactly as the ground
  `vector<T>` is: a matrix at it behaves as a matrix does at `vector<T>`
  today, and the test pins that parity rather than a verdict. (The draft's
  claim that a matrix at `list<T^N>` binds the row was wrong.)

**At a type position `N`.** The actual's type binds `N` when it is a
value-literal type or a singleton integer range whose value is a positive
integer within the bound; both spellings exist today (`ce.box(3).type` is
`3`; a declared `integer<3..3>` symbol keeps that range). Any other actual
binds nothing but must still be a subtype of the bound (`integer<1..>` by
default): `foo(k, …)` with `k: integer` is admitted, `foo(-1, …)` and
`foo(2.5, …)` are rejected. Whether a float-spelled literal counts is
answered by the lattice, not by this design: `ce.parse('3.0').type` is the
value type `3` and it is a subtype of `integer` today, so it binds `N = 3`.
An assigned symbol (`m := 3`) is typed `integer`, not `3`, so it binds
nothing (the storage-widening rule of `docs/TYPE-SYSTEM.md`, "Number literal
types"); the post-solve check then reads its held value, as the ground route
does for `(n: integer<3..3>)`, so `foo(m, [1,2])` is rejected and `foo(m,
[1,2,3])` admitted. The value is read from the operand's PUBLIC type, not
from the tier-projected actual the type variables see (the `rawType` hook of
the solver options), so an application typed `3` (`Length([1,2,3])`, once
`Length` is declared that way) pins as a literal does.

**Bound check.** After the walk, each solved dimension is checked against
its bound; a violation is reported as the existing `'bound'` failure kind.

**Order.** Equality is symmetric, so the solved value does not depend on the
walk order; only the blamed operand does.

## 6. Substitution

- In a dimension slot, the variable is replaced by its number; an unsolved
  variable becomes `-1`.
- At a type position, the variable is replaced by the value-literal type of
  its number (`3`), the same claim `ce.box(3).type` makes; an unsolved
  variable becomes its bound (`integer<1..>` by default).
- This respects the storage-widening rule of `docs/TYPE-SYSTEM.md`: a solved
  TYPE variable widens a literal to its tier because the binding is stored,
  while a dimension binding is a number and the substituted result is an
  expression-position claim on the application. A declared `(x: vector<3>)
  -> 3` already types its application as `3` today, so `(list<T^N>) -> N`
  typing `Length([1,2,3])` as `3` introduces nothing new. A function
  literal's derived signature keeps widening its result to the tier, as it
  does now.

## 7. Nominal types with a dimension parameter (level 2)

- `type permutation<N> = list<integer^N>` declares a nominal type whose one
  parameter is a value variable, classified by position from the body as in
  §3. Its variance is analyzed like a type parameter's (a length slot is a
  covariant position, `out`). Two solved applications relate only when
  equal, because a solved length is a singleton type: `permutation<3>` and
  `permutation<4>` are unrelated in both directions.
- The constructor solves the parameter by the §5 walk:
  `permutation([2,1,3])` is `permutation<3>`; `permutation(xs)` with `xs:
  list<integer>` is `permutation<integer<1..>>`, the family of every length,
  which re-parses (a type argument within the bound is admitted at a value
  parameter) and is a supertype of every solved length.
- An applied reference substitutes its arguments into the body through the
  same substitution as §6 (`applyTypeReference` / `withTypeArguments`,
  `src/common/type/reference.ts`), so membership and field access see
  `list<integer^3>`.
- A type argument of the wrong kind at a value parameter is an error,
  `type-argument-kind`: `permutation<integer>` (not within `integer<1..>`),
  `permutation<string>`. A value at a TYPE parameter (`tree<3>`) is a legal
  singleton type today and is admitted by the ordinary bound check.
- Generic transparent aliases get the same parameter kind for free
  (`type alias vec<N> = vector<real^N>` expands by substitution).

## 8. What this does not change

- Ground signatures with literal lengths behave exactly as today; a
  dimension variable is a strict generalization of the `-1` wildcard: `-1`
  means "any length", `N` means "any length, the same wherever `N` appears".
- Heads with a canonical handler bypass declared-signature validation at the
  boxing seam, so converting a built-in such as `Dot` to a dimension-variable
  signature does not by itself reject mismatched lengths; that conversion is a
  separate step (§9, phase 3) and must route through the seam check. User
  declarations through `ce.declare` and Epsil function heads get the check as
  soon as level 1 lands.
- Compiled targets read ground types only; an instantiated signature reaches
  them with numbers or `-1`, as today.

## 9. Implementation plan

**Phase 0, syntax and representation.** Lexer/parser (`parseDimensions`,
`parseCaretDimensions`, the leading-dimension forms of `vector`/`matrix`),
AST `DimensionNode`, `Dimension`/`DimensionVariable` in `types.ts`,
serializer (`serialize.ts`, prints the name in the slot), the dedup key and
interning (`intern.ts`), `validateDeclaredType` (kind classification, the
§3 diagnostics), `TypeParameter.kind`. Definition of done: the four
signatures of issue #364 declare; each new diagnostic has a test; a
signature round-trips through `typeToString` and `parseType`.

**Phase 1, solver and substitution.** `walkPattern` list case (pairwise
dimension walk, equality bindings, conflict report), the type-position case
for a dimension variable, `collectFreeVariables`, the substitution walk,
`groundSkeleton` (a dimension variable maps to `-1`), `hasFreeVariables`,
the `'bound'` check, the `couldMatch` path. Definition of done: the
acceptance matrix in §11 passes on the `ce.function`, `ce.box` and
`ce.parse` routes and through an Epsil function head.

**Phase 2, nominal types.** Parameter kind on a declaration record,
`variance.ts` (dimension positions contribute no variance and reject
markers), `reference.ts` argument kind check, `resolveTypeForCompilation`
substitution. Definition of done: `permutation<N>` end to end, including
constructor solving, applied-reference membership and the wrong-kind
diagnostic.

**Phase 3, library adoption (optional, its own review).** Candidates whose
handlers would shrink: `Dot`, `Cross` (`^3`), `Transpose` (`matrix<T^(MxN)>
-> matrix<T^(NxM)>`), `Determinant`/`Inverse` (`matrix<T^(NxN)>`), `Zip`,
`Length -> N`. Each conversion must be checked against the boxing-seam rule
of §8 and its snapshot blast radius measured before landing.

## 10. Decisions

| # | Question | Recommendation | Status |
|---|---|---|---|
| D1 | How is a dimension variable told from a type variable? | By position: any occurrence in a `^` slot. No new keyword, no `where N: integer` convention, because a ground `integer` bound already means a type variable. | recommended |
| D2 | Solve by join or by equality? | Equality; a mismatch rejects the later operand. | recommended |
| D3 | How is `n: N` represented? | The existing `TypeVariable` node with a `value: true` flag; `NumericType` untouched. | built |
| D4 | An actual with no known length at `^N`? | Admit, bind nothing, substitute `-1`; parity with today's `G(w)`. | recommended |
| D5 | Is `n: N` in scope? | Yes; both channels exist and meet in the type layer. Asked by the user 2026-09-29. | recommended |
| D6 | Which literals bind at `n: N`? | A value-literal type or singleton integer range whose value is a subtype of the bound; the lattice decides `3.0`. | recommended |
| D7 | Result type when `N` is solved? | The value-literal type `3`, matching `ce.box(3).type` and today's `(vector<3>) -> 3`. | recommended |
| D8 | Variance of a value parameter on a nominal type? | Analyzed like a type parameter (a length slot is covariant). Solved lengths are singletons, so `permutation<3>` and `permutation<4>` are unrelated; an unsolved length prints as the family `permutation<integer<1..>>`. Supersedes the draft's "always invariant, markers rejected". | built |
| D9 | Arithmetic on lengths? | Out of scope; one design with roadmap §9.2 item 4. | agreed 2026-09-29 |
| D10 | Is the kind specific to lengths? | No. The kind is `'value'`: a variable bound from a literal's type, with its bound saying which values it admits. A length is a value variable with bound `integer<1..>` (the default when it occurs in a length slot). Booleans and strings need only literal types and a declaration spelling. Asked by the user 2026-09-29. | built |
| D11 | How is a dimension variable stored in a list type? | As the `-1` wildcard plus a name in a parallel `dimensionVariables` field (§4), not a new node in `dimensions`. | built |
| D12 | A pin outside the declared bound? | It pins nothing (so it never blames the operand that was right) and is recorded as a bound failure of its own position (so a lone `big([1])` at `where N: integer<2..>` is rejected, not admitted at the open pattern). A value that is not a positive integer pins nothing and is left to the post-solve gate. From the review of 2026-09-29. | built |
| D13 | A variable name that contains `x`? | In a length slot a fused token whose split leaves an empty segment (`idx`, `Max`) is one name; two names must be separated with spaces in a group (`M x idx`), which the serializer emits for such names. Needed because the Epsil parser reads an annotation before its clause is in scope. From the review of 2026-09-29. | built |
| D14 | Who decides a clause entry's kind? | The route that owns the entry, from the finished body (`valueVariableNamesOf`): the where-clause builder for its own fresh entries, `declareType` for a declaration's parameters. The type builder never writes a pre-seeded entry. A sum type settles the kinds of its shared clause from every variant's body before declaring any variant, so `type shape<N> = circ(N) \| poly(list<real^N>)` makes `N` a length in both variants whatever their order. From the review of 2026-09-29. | built |

## 11. Acceptance matrix (tests)

New file `test/compute-engine/dimension-variables.test.ts`. Every row runs
on the `ce.function`, `ce.box` and `ce.parse` routes.

| Declaration | Call | Expected |
|---|---|---|
| `dot: (a: vector<real^N>, b: vector<real^N>) -> real where N` | `dot([1,2,3],[4,5,6])` | valid, `real` |
| same | `dot([1,2,3],[4,5])` | `incompatible-type` on operand 2, expected `vector<real^3>` |
| same | `dot(v, [1,2,3])`, `v: vector<3>` | valid |
| same | `dot(w, [1,2,3])`, `w: list<real>` | valid (deferred) |
| `first: (x: list<T^N>) -> T where T, N` | `first([[1,2],[3,4]])` | same verdict and type as the ground `(x: vector<unknown>) -> unknown` (rank parity) |
| `mm: (matrix<T^(MxN)>, matrix<T^(NxP)>) -> matrix<T^(MxP)> where T, M, N, P` | 2x3 by 3x4 | `matrix<integer^(2x4)>` |
| same | 2x3 by 2x4 | `incompatible-type` on operand 2 |
| `foo: (n: N, x: vector<T^N>) -> T where T, N` | `foo(3, [1,2,3])` | valid |
| same | `foo(4, [1,2,3])` | `incompatible-type` on operand 2 |
| same | `foo(3.0, [1,2,3])` | valid (value type `3`) |
| same | `foo(k, [1,2,3])`, `k: integer` | valid |
| same | `foo(-1, [1,2,3])`, `foo(2.5, [1,2,3])` | `incompatible-type` on operand 1 (bound) |
| `len: (x: list<T^N>) -> N where T, N` | `len([1,2,3])` | type `3` |
| same | `len(w)`, `w: list<real>` | type `integer<1..>` |
| `big: (x: vector<number^N>) -> N where N: integer<2..>` | `big([1])`, `big([1,2])` | bound failure; valid, typed `2` |
| same, assigned `m := 3` | `foo(m, [1,2,3])`, `foo(m, [1,2])` | valid; rejected on `m` (checked against the held value, as the ground route does) |
| `type permutation<N> = list<integer^N>` | `permutation([2,1,3])` | `permutation<3>` |
| `(p: permutation<N>, q: permutation<N>) -> permutation<N> where N` | 3 and 4 | `incompatible-type` on operand 2 |
| declaration diagnostics | `() -> vector<number^N> where N`, `where N: string`, `where N is Hashable`, `list<integer^K>` with `K` undeclared, `permutation<integer>`, `N & integer` | one diagnostic each |
| Epsil | `function dot(a: vector<real^N>, b: vector<real^N>) -> real where N { … }` | same acceptance as the host route |

## 11a. Review outcomes (2026-09-29)

Two Claude legs (Sonnet and Opus; Codex was over its quota) reviewed the
implementation. Applied: D12 to D14 above; bound-against-bound for a clause
variable given to a nominal value parameter (`(n: N) -> big<N> where N` is
rejected when `big<N: integer<2..>>`); the value-variable checks on a nominal
type's own parameters (`typeParams: ['N: string']` is rejected at
declaration); the solver derives the value set from occurrences too, so a
structural `Type` body with `dimensionVariables` solves as a string does; the
ground `matrix<T>` pattern binds its scalar element (see the CHANGELOG
entry); the widened application keeps its declaration back-pointer. Refuted:
a variable used at both a type and a length position is a value variable by
D1, not a silent error; the solver has no speculative arms from which a pin
could leak. Recorded in ROADMAP.md rather than fixed: a zero-length axis is
dropped by `reduceListType` (`list<integer^(2x0)>` reads `vector<integer^2>`,
a pre-existing reading that needs a decision), and a nested spelling
(`list<vector<integer^3>^2>`) is not a subtype of the flat shape, so it pins
no length at a `matrix<T^(MxN)>` parameter.

## 12. Documentation to update when it lands

`docs/TYPE-SYSTEM.md` ("Polymorphism": one paragraph on the second variable
kind), `src/epsil/docs/types.md`, `doc/08-guide-types.md` (Generic
Signatures; the directory is gitignored), the grammar comment in
`src/common/type/types.ts` (move "dimension variables" out of "Future
considerations"), `CHANGELOG.md`. Then this note leaves `docs/plans/`, per
that directory's README.
