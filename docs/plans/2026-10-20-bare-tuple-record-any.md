# Bare `tuple` and `record` accept any tuple and any record

Status: TABLED by the user on 2026-10-20 ("I'm going to give it some
thoughts"). Two measurement prototypes were run; nothing has landed. Item 1
(the tuple-argument binding) is a defect at HEAD and is fixed on its own.

## The problem

Since the user decision of 2026-08-17, a bare collection name means "values
only": `list` is `list<unknown>`, and an element that can be absent (`Missing`,
`Nothing`, `any`) is excluded. The bare names `tuple` and `record` got the same
reading. Measured at HEAD (1efbbe884):

| Type | `<: tuple` / `<: record` |
| --- | --- |
| `tuple<integer>`, `tuple<integer, integer, integer>`, `tuple<integer, string>`, `tuple<integer, unknown>` | yes: any length, any value slots |
| `tuple<integer, missing>`, `tuple<integer, any>`, `tuple<nothing>` | no |
| `record{a: integer}` | yes |
| `record{a: missing}` | no |

The other collections have a second spelling for the absence-admitting top,
`list<any>` and the like. `tuple` and `record` have none: `tuple<any>` is a
tuple with exactly one slot. So no type says "any tuple, absent slots
included", and an operator whose result is a tuple of unknown length with
slots that can be absent has no correct answer. Example:
`TupleFrom(L)` with `L: list<integer | missing> := [1, Missing, 3]` evaluates
to `(1, Missing, 3)`, of type `tuple<integer, missing, integer>`, but is typed
the bare `tuple`, which excludes that value.

The user decided on 2026-10-20 that `missing` stays opt-in everywhere else
(no type admits absence unless it says so). This proposal does not change
that: it only gives `tuple` and `record` the role that `list<any>` has for
lists, because the bare name is their only spelling.

## The proposal

- Bare `tuple` accepts every tuple, whatever its length and slot types,
  absent slots included. Bare `record` accepts every record, absent fields
  included.
- As a consequence, `tuple <: indexed_collection<any>` and
  `tuple <: collection<any>`, but NOT `tuple <: indexed_collection` (the bare,
  values-only name). `record <: dictionary<any>`, but NOT
  `record <: dictionary`. `record <: collection` stays true (a dictionary
  iterates as `tuple<string, V>` entries, which are values).
- A tuple or record whose slots are all values is still below the bare
  values-only names (`tuple<integer> <: indexed_collection`,
  `record{a: integer} <: dictionary`).

## Measurements (prototype in a separate worktree, `subtype.ts` only)

The prototype changes four things in `src/common/type/subtype.ts`:

1. A primitive closure for the subtype relation without the edges
   `indexed_collection ⊃ tuple`, `collection ⊃ tuple` and
   `dictionary ⊃ record` (`meetPrimitiveTypes` keeps the old closure: a tuple
   of values IS both a `tuple` and an `indexed_collection`).
2. The right-hand-side rules: bare `tuple` accepts `lhs.kind === 'tuple'`,
   bare `record` accepts `lhs.kind === 'record'`.
3. The left-hand-side rules: bare `tuple` reads as `indexed_collection<any>`,
   bare `record` as `dictionary<any>`.
4. `couldMatch`: bare `tuple` overlaps every tuple type and every
   `indexed_collection<E>` / `collection<E>` with `E` not `never`; bare
   `record` overlaps every record and every `dictionary<V>` with `V` not
   `never`. This is needed: without it the engine fails at start-up (the
   `Tuple` operator's `at` handler is refused by
   `couldReturnIndexedCollection`).

**Transitivity and coherence** over 47 types (bare and parameterized tuple,
record, list, indexed collection, collection, dictionary, their `<any>` and
`<unknown>` forms, absent slots, unions, `any`, `unknown`, `value`,
`nothing`, `missing`):

| Check | HEAD | Prototype |
| --- | --- | --- |
| Transitivity violations | 11 | 5 |
| `couldMatch` false although a common subtype exists | 27 | 15 |
| Disjoint pairs that share a subtype, `couldMatch` asymmetries | 0 | 0 |

The 5 violations and 15 misses that remain also exist at HEAD. The violations
come from a record with an extra field of type `any`:
`record{a: integer, b: any} <: record{a: integer} <: dictionary`, but the
first is not `<: dictionary` (record-to-record allows extra fields,
record-to-dictionary checks every field). The prototype removes the 6
violations that went through bare `record` or `tuple | record`.

**Full suite** (under the box lock): 3 failing tests, 0 changed snapshots
(4,273). The same 3 files pass at HEAD.

1. `test/compute-engine/intersection-right-subtyping.test.ts:222-224` pins
   the old reading (`record <: dictionary<unknown>`,
   `tuple <: indexed_collection`, `tuple<integer, missing>` not `<: tuple`).
   Intended effect: the test is rewritten to the new reading.
2. `test/compute-engine/rebind.test.ts:156` asserts an exact error text: the
   expected type of `PointX(u: real)` prints `collection | tuple` where it
   printed `collection` (the union no longer shortens, because `tuple` is no
   longer below `collection`). The new text is more accurate; the test is
   updated.
3. **A real regression.** `test/compute-engine/map-over-tuple-result.test.ts:118`:
   `Map(x ↦ x + 10, t)` with `t: tuple` becomes an `incompatible-type` error
   (it was `list<number>`). The same happens for every operator whose
   parameter is `collection<T>` or `indexed_collection<T>` with an unbound
   `T`: measured for `Map`, `Filter`, `Any`, `Scan`, `Reduce`, `Fold`, and by
   the same rule `All`, `TakeWhile`, `DropWhile`, `FlatMap`, `IndexWhere`,
   `Find`, `CountIf`, `Position`, `Ordering`, `MaxBy`, `MinBy`, `ArgMax`,
   `ArgMin`, `Partition`, `GroupBy`, `RangeOf`, `ContainsSequence`.

The cause of 3 already exists at HEAD, for a tuple that names an absent
slot. Measured at HEAD:

| Argument | `Map(x ↦ x + 10, …)` |
| --- | --- |
| `t: tuple<integer, integer>` | `list<integer>` |
| `l: list<integer \| missing>` | `list<number>` |
| `t: tuple<integer, missing>` | `incompatible-type` error |

A list argument binds `T` to its element type (`integer | missing`), so the
absent element is admitted. A tuple argument does not bind `T` from its slots;
`T` is then read as its bound, which is `unknown` for an unbound variable
(2026-08-17), and `missing` is not `<: unknown`. The prototype only moves bare
`tuple` from the first row to the third.

## What the change needs, beyond `subtype.ts`

1. **Fix the tuple-argument binding first (it is a defect at HEAD).** When a
   tuple argument meets a parameter `collection<T>` / `indexed_collection<T>`,
   bind `T` to the widening of its slot types, as a list argument binds `T` to
   its element type. For a bare `tuple` (slots unknown) that is `any`. This
   fixes the HEAD row `tuple<integer, missing>` and removes regression 3.
   It must land with, or before, the subtype change.
2. **Result types that read a bare-`tuple` slot.** With absent slots possible,
   a read of a slot of a bare `tuple` can be `Missing`. Measured on the
   prototype: `First(t: tuple)` is typed `unknown`, `Tally(t: tuple)`
   `tuple<list<unknown>, list<integer>>`; both should admit absence (`any`).
   `collections.ts` (about line 4819) reads the coordinate of a bare `tuple`
   as `number`. These are typed through `withMarker()` and the point
   coordinate helpers; the `withMarker()` reading of `unknown`/`any` elements
   is already a design item in ROADMAP.md (user decision 2026-10-20), so this
   proposal only requires the bare-`tuple` cases to be correct.
3. **Library signatures.** Bare `tuple` appears in about 16 signature
   positions and bare `record` in about 7.
   - Parameters (`Distance`, `Sum`/`Product` limits, `NDSolve`,
     `PointX`/`PointY`/`PointZ`, `Fill`, `Reshape`, `Dot`, `Cross`, `Norm`,
     the colour operators): they now admit tuples with absent slots. Each
     handler must tolerate a `Missing` component; most already do through the
     missing-value machinery, and each needs a check.
   - Results (`ND`, `Integrate`, `Limits`, `Tuple`, `TupleFrom`, `Shape`,
     `Cross`, `Eigen`, `LUDecomposition`, `QRDecomposition`, `SVD`,
     `StringMatch`, `StringMatchAll`, `ColorToColorspace`): the promise gets
     weaker but becomes honest for `Tuple` (`(any*) -> tuple`) and
     `TupleFrom`. A result that never has an absent slot (`Shape`, the
     decompositions, `Cross`) should state its slot types where it can, so it
     keeps fitting values-only parameters downstream.
4. **Engine helpers.** `isTupleShapedType` / `isRecordShapedType` stay
   correct. About 15 sites compare a type to the name `'tuple'` or `'record'`
   directly (not through `isSubtype`), for example
   `derive-application-type.ts:143`, `broadcast-lift-type.ts:938`,
   `collections.ts:2675` and `:4819`; their behavior is unchanged, but each
   must be checked for the new meaning. The `ast-grep` rule
   `bare-collection-shape-gate` drops `tuple` and `record` from its pattern:
   after the change, `matches('tuple')` IS a shape test.
5. **Documentation.** `doc/08-guide-types.md`: the type tree (about lines
   95-110, `tuple` under `indexed_collection`, `record` under `dictionary`),
   the table rows at 204-205, line 1959 ("a record value is a dictionary
   value"), and the "What a Bare Type Means" section, which names only the
   five `<unknown>` synonyms. `CLAUDE.md` "Common API Traps" (the sentence on
   `isTupleShapedType`), and the comments in `collection-utils.ts` that state
   the values-only reading (about lines 2737, 2755, 2773, 2842, 2974).
6. **CHANGELOG.** A behavior change: a symbol or parameter declared bare
   `tuple` or `record` now accepts absent slots.

## Downstream effects measured on the prototype

- `TupleFrom(L)` with `L := [1, Missing, 3]`: the static type `tuple` now
  holds the value `(1, Missing, 3)` (false at HEAD).
- `Join` of two records with a `Missing` field: typed `record` before and
  after, and the value matches in both (the record literal is spelled
  `["Dictionary", ["Tuple", "'a'", 1], ["Tuple", "'b'", "Missing"]]`).

## Defects found that exist at HEAD (independent of this proposal)

- The tuple-argument binding of `T` (item 1 above).
- The 5 record transitivity violations through an extra field of type `any`.
- The 15 `couldMatch` misses on tuples with an `any` slot
  (`indexed_collection` vs `tuple<any>`).

## Alternative B: every bare collection name is its `<any>` top

The user asked (2026-10-20) whether reading EVERY bare collection name as its
absence-admitting top — `list` ≡ `list<any>`, `set` ≡ `set<any>`,
`dictionary` ≡ `dictionary<any>`, `collection` ≡ `collection<any>`,
`indexed_collection` ≡ `indexed_collection<any>`, and `tuple`/`record` as
above — with `X<unknown>` kept as an explicit values-only spelling, would be
more consistent. This is close to the reading before the 2026-08-17 decision
(bare forms admitted absence then), but on the repaired lattice
(`any <: unknown` is false today). A second prototype measured it in two
variants that differ only in how `X<any>` is stored: F reduces `X<any>` to
the bare name; N keeps `X<any>` as a composite and makes the two mutual
subtypes.

**Lattice** (79 types; the larger type set of this measurement):

| Check | HEAD | Alternative B |
| --- | --- | --- |
| Transitivity violations | 23 (8 through a bare name) | 15 (0 through a bare name) |
| `couldMatch` false although a common subtype exists | 68 (31 through a bare name) | 45 (8, all `list<list>` vs `matrix<integer>`) |
| Disjointness violations, `couldMatch` asymmetries | 0 | 0 |

So B removes every bare-name defect of the relation; the others move to the
explicit `<unknown>` spellings, where they also exist today.

**Full suite** (HEAD: these 43–50 suites all pass):

| | F | N |
| --- | --- | --- |
| Failing tests | 267 | 237 |
| Failing inline snapshots | 18 | 18 |
| (a) intended: a printed type changes from `X<any>` to `X`, tests that pin the lattice or the stored form, the element type of a bare name is `any` | 166 | 184 |
| (b) acceptable: the wording of an expected type in a diagnostic; some result types become wider | 53 | 51 |
| (c) real regressions | 48 | 2 |

The two regressions that remain in N are the Epsil corpus programs `horner`
and Euler 36. Their cause: `Reverse` (and `RotateLeft`/`RotateRight`) is
declared with the bound `T: list`, and an unbound type variable is filled in
as `unknown`, so `indexed_collection<unknown>` is now strictly below bare
`list`, the union of the overload parameters no longer reduces, and the
inference of a parameter used in `reverse(ds)` gives up. Removing them needs
a further decision: whether an unbound type variable for collection elements
is filled in as `any` (which would also remove most of the (b) diagnostic
wording changes). The F-only regressions come from code that matches the
composite `X<any>` form (`parameterIndexReadType`) and from the placeholder
rule (`isConstructorPlaceholderType`), which would treat an explicit
`list<any>` declaration as refinable; N keeps them, at the cost of
`x: list` being a refinable placeholder while `x: list<any>` is a fixed
contract although the two types are equal.

**What users would see** (measured, HEAD vs B):

- `x: list` assigned `[1, Missing]` is ACCEPTED in both. At HEAD the value
  type `list<integer | missing>` is not a subtype of the declared `list`,
  but the assignment check does not apply that subtype test (a HEAD
  inconsistency, recorded in ROADMAP.md); with B it is a subtype.
- `x + 1`, `At(x, 1)`, `Map(f, x)`, Epsil `let xs: list = [1, 2]; xs[1] + 1`
  and compiled `Sum(xs)` give the same results. No route warns about a
  possible absent element in either design, and compiled code adds no
  absence check.
- `list<unknown>` would print as written (today it prints as `list`), and a
  declaration `x: list<unknown>` becomes a fixed contract (today it is the
  same as bare `list`, a refinable placeholder).
- Printed types change wherever `X<any>` was printed: about 145–163 test
  expectations.

**What B needs beyond A:** changes in `primitive.ts`, `subtype.ts`,
`reduce.ts`, the type builder, the parser defaults, the serializer and the
element-type helpers (8 files in the prototype); the decision on unbound
type variables above; updating about 240 test expectations; rewriting the
types guide (`doc/08-guide-types.md` lines ~486-497, ~2241-2246, ~2305,
~2344-2417, including "Which spelling, when" and "Why absence is not part
of `unknown`"), CLAUDE.md "Common API Traps", `docs/ERROR-MODEL.md`
(~827-829, ~2184); the `ast-grep` rule `bare-collection-shape-gate` becomes
obsolete, and nothing would then flag a values-only test spelled with a bare
name. About 59 parameter positions (`collection<any>` and the like) become
equal to the bare name; about 68 operators with a bare result type would
claim that absent elements are possible.

## Comparison

| | A: `tuple`/`record` only | B: every bare collection name |
| --- | --- | --- |
| Consistency | bare `tuple`/`record` = any tuple/record; bare `list`, `set`, … stay values-only (they have the `<any>` spelling for the top) | one rule for every collection: the bare name is the top, `<unknown>` is values-only |
| Lattice (bare-name defects) | removes the bare `tuple`/`record` ones | removes all of them |
| Tests that change | 3 (one is a regression that item 1 removes) | 237–267, mostly printed types; 2 real regressions that need a further decision |
| Documentation | a few paragraphs | the "bare type" sections of the guide, CLAUDE.md, ERROR-MODEL.md |
| User-visible checking | `p: tuple` accepts absent slots | `x: list` etc. accept absent elements (already accepted at assignment today) |
| Fit with "`missing` stays opt-in" (2026-10-20) | yes, apart from the bare tuple/record top | weaker: writing a bare collection name opts in |

## Decision needed

- **A**: implement items 1-6 above in a worktree, item 1 first; measure the
  full suite again; dual review; land as one change.
- **B**: decide first how an unbound type variable for collection elements
  is filled in, then implement B (variant N) with the test updates and the
  documentation rewrite, as its own initiative.
- **Neither**: bare names stay values-only; `TupleFrom` over absent cells and
  record joins keep a type that excludes their value.

In every case, item 1 (the tuple-argument binding, in progress since
2026-10-20) and the HEAD defects above are fixed or recorded on their own.
