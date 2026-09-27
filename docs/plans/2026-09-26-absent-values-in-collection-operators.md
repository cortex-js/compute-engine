# Absent values in collection operators: one model for `NaN`, `Missing` and `Undefined`

**Status:** Decided and implemented 2026-09-26. The user took the recommended
option of each decision in §6 (structural search; selection keeps only a
decided `True`; Kleene `Any`/`All`). The five rules are now recorded in
`docs/ERROR-MODEL.md` §3, "Absent values in collection operators", which is the
durable reference; this document keeps the precedent and the alternatives that
were not taken. The tests are `test/compute-engine/collections-absent.test.ts`.
Behavior in §3 and §4 was measured at commit `09293e23` with `npx tsx` probes
over boxed MathJSON, before the implementation.

## 1. The three markers and the two notions of "same"

The engine has three values that can stand where a datum should be. The model
below keeps them apart by one question: *is it a number?*

| Marker | What it means | How it compares | Where it appears |
| --- | --- | --- | --- |
| `NaN` | A number with no value (`0/0`, and an absent datum in a numeric slot) | IEEE 754: every comparison is `False`, `NaN = NaN` is `False` | Only in numeric domains |
| `Missing`, `Undefined` | An absent datum of any type | Kleene: a comparison with it is `Missing` (undecided) | Object domains: strings, points, lists, booleans |
| `Nothing` | Not a value: an erasure marker | Never compared; spliced out before an operator sees it | Argument lists and collection literals |

`Undefined` is read exactly as `Missing` by every handler that reads a value
(user rulings of 2026-09-21 and 2026-09-22). It stays a distinct symbol under
structural comparison.

Every language with an absent value keeps **two notions of "same"**, and the
engine already does too:

- **Structural identity** (`Same`, `isSame`): a marker is the same as itself.
  `Same(NaN, NaN)` and `Same(Missing, Missing)` are `True`;
  `Same(Missing, Undefined)` is `False`. Deduplication uses this notion
  (`Unique`, `Set`, `Tally`).
- **Value equality** (`Equal`, `=`): `NaN` equals nothing (IEEE), and
  `Missing`/`Undefined` compared with anything is `Missing` (Kleene).
  Comparison and search use this notion.

Precedent: Julia `isequal` vs `==` (with `NaN`, `missing`, `nothing` — the
closest match to this engine's three markers); JavaScript `SameValueZero` (used
by `Set`) vs `===` (used by `indexOf`); R `identical` vs `==`; SQL
`IS NOT DISTINCT FROM` vs `=`.

The cost of this model is already accepted in `ERROR-MODEL.md` §1: in a numeric
domain the engine cannot tell "no datum" from "no answer". `IsMissing(NaN)` is
`True`. There is no `IsNaN`; none is proposed.

## 2. Five rules

Each rule names the operators it governs, what it answers, and the precedent it
follows. "Absent cell" means an element that is `NaN`, `Missing` or `Undefined`.
"Absent collection" means the whole operand is `Missing` or `Undefined`.

### Rule A. Positional operators keep the cell in place

`Length`, `Count(xs)`, `Join`, `Append`, `Insert`, `Reverse`, `Take`, `Drop`,
`Zip`, `Sort`, `Unique`, `Tally`, `Map`, `At`, `First`, `Last`.

- An absent cell is a position like any other: `Length([1, Missing, 3])` is `3`,
  `Join([1, Missing], [3])` is `[1, Missing, 3]`, `Reverse([1, Missing])` is
  `[Missing, 1]`, `At([1, Missing, 3], 2)` is `Missing`.
- `Sort` puts absent cells last, in a stable order.
- `Unique`, `Set` and `Tally` deduplicate by structural identity, so one absent
  cell survives: `Unique([1, NaN, NaN, 1])` is `[1, NaN]`.
- `Map` applies the function to the cell, and the function answers by its own
  absence rule: `Map(x ↦ 2x, [1, Missing, 3])` is `[2, NaN, 6]`.
- Only an explicit removal shortens a collection: `Nothing` in a literal, or
  `Filter(xs, x ↦ Not(IsMissing(x)))`.

Precedent: every language. `length`/`len`/`Length` count the marker in R,
Julia, pandas, JavaScript, Mathematica; concatenation keeps it everywhere;
sort-last is pandas (`na_position='last'`), NumPy, Julia (`isless`), JavaScript
(`undefined` sorts last); one-marker dedup is Julia `unique`, R `unique`,
JavaScript `Set`, NumPy `unique`.

### Rule B. Aggregates propagate

`Sum`, `Product`, `Mean`, `Median`, `Max`, `Min`, `Variance` family,
`Quantile`, `Reduce`.

- One absent cell makes the aggregate the marker of its codomain:
  `Sum([1, Missing, 3])`, `Max([1, NaN, 3])`, `Mean([1, Undefined, 3])` are all
  `NaN`.
- An empty collection answers the identity, not a marker: `Sum([])` is `0`,
  `Product([])` is `1`. `Max([])` and `Min([])` have no identity and are `NaN`.
- Skipping is opt-in by removing the cells first (Rule A's last bullet).

Precedent: R without `na.rm`, Julia (`skipmissing` is the opt-in), Excel `#N/A`,
NumPy `sum` (`nansum` is the opt-in), Mathematica `Total` over `Missing[]`.
SQL and pandas skip by default; the engine does not, because a silently skipped
cell changes a mean without a trace, and `Nothing` already exists for the
"skip" intent.

### Rule C. Search is structural: a marker is found where the same marker sits

`Contains`, `IndexOf`, `Element`, `Count(xs, value)`.

Search asks "is this expression in the container?", not "is this number equal
to that number?". It therefore compares by structural identity (`Same`), the
notion `Unique`, `Set` and `Tally` already use, and never by value equality.

- A marker needle is found where the same marker sits:
  `IndexOf([1, NaN], NaN)` is `2`, `Contains([1, Missing], Missing)` is `True`,
  `Count([1, NaN, NaN], NaN)` is `2`.
- A marker cell matches only the same marker, so the other cells decide every
  other answer: `Contains([Missing, 5], 5)` is `True`,
  `Contains([1, Missing], 5)` is `False`, `IndexOf([1, Missing], 5)` is `0`.
- A search never answers a marker, with one exception: an absent collection
  answers the codomain marker (Rule E). `Contains(Missing, 3)` is `Missing`,
  `IndexOf(Missing, 3)` is `NaN`.
- `Missing` and `Undefined` are structurally different symbols, so
  `Contains([Missing], Undefined)` is `False`, as `Unique([Missing, Undefined])`
  keeps both. A search for "any absent cell" is a predicate:
  `Position(xs, IsMissing)`, `Count(xs, IsMissing)`.
- The needle is evaluated first, so a needle that evaluates to a marker is
  found where that marker sits: with `c` false, `First([5, 6]{c})` is `NaN`, and
  `Contains([1, NaN], First([5, 6]{c}))` is `True`. This is the numeric-domain
  conflation of §1 and nothing new.

Precedent, the majority for container membership: JavaScript `includes` and
`Set` (`SameValueZero`; `includes` was added because `indexOf(NaN)` answering
`-1` was a well-known trap), R `match` and `%in%` (`match(NA, c(1, NA))` is
`2`), Julia `unique`/`Dict`/`findfirst(isequal(x))`, Python `x in xs`
(identity first, then equality), Mathematica `MemberQ` and `Position`
(`Position[{1, Indeterminate}, Indeterminate]` is `{{2}}`), Swift
`contains(nil)`, pandas `isin` (finds `NaN`), Polars (`NaN` joins with `NaN`).

Alternatives not taken:

- **Value equality, a marker matches nothing** (JavaScript `indexOf`, NumPy
  `isin`, Julia `findfirst(==(x))`). This is the unpublished ruling of
  2026-09-26 (commit `eedab2e0`, after the 0.136.2 release): `IndexOf([1, NaN],
  NaN)` is `0` and `Contains([1, Missing], Missing)` is `False`. It is
  internally consistent but is the reading people are surprised by, and it
  makes search disagree with `Unique`, which keeps one `NaN` because it does
  find it. Before that commit the engine answered `2`; this rule restores that
  answer and reverses the commit's changelog entry before it is published.
- **Kleene search** (SQL `5 IN (1, NULL)` is `UNKNOWN`, Julia `5 in
  [1, missing]` is `missing`). `Contains([1, Missing], 5)` would be `Missing`, a
  `Which` on it would take no branch, and `IndexOf` would answer `NaN` for a
  list that merely has a hole. Rejected: a search is a lookup, not a
  comparison. Whole-collection `Equal` (ruling of 2026-09-21) is a comparison
  and stays Kleene: `Equal([1, Missing], [1, 5])` is `Missing` while
  `Contains([1, Missing], 5)` is `False`.

Compiled lanes: JavaScript `includes` already has these semantics for `NaN`
and for the object null that a written `Missing` lowers to. Python `in` finds
`math.nan` only by object identity, so the Python lowering needs a membership
helper that reads `nan` as matching `nan`.

### Rule D. Predicate operators: selection drops the undecided, quantifiers are Kleene

`Filter`, `Count(xs, predicate)`, `Position`; `Any`, `All`.

The predicate is applied to each cell. For an absent cell a comparison such as
`x > 0` answers `Missing` (Kleene) when the cell is `Missing`/`Undefined`, and
`False` (IEEE) when the cell is `NaN`. The operator then reads the predicate's
answer:

- **Selection keeps only a decided `True`.** A `Missing` answer is "not
  selected": `Filter([1, Missing, 3], x ↦ x > 0)` is `[1, 3]`,
  `Count([1, Missing, 3], x ↦ x > 0)` is `2`, `Position` lists only decided
  positions. A predicate that answers `IsMissing(x)` is `True` on the cell and
  selects it, so `Filter(xs, IsMissing)` is `[Missing]`.
- **Quantifiers combine by Kleene logic**, as `And` and `Or` already do:
  `Any` is `True` if any answer is `True`, else `Missing` if any answer is
  `Missing`, else `False`. `All` is `False` if any answer is `False`, else
  `Missing` if any is `Missing`, else `True`. So
  `Any([1, Missing], x ↦ x > 2)` is `Missing`, `Any([1, Missing, 3], x ↦ x > 2)`
  is `True`, `All([1, Missing, 3], x ↦ x > 0)` is `Missing`,
  `All([1, Missing, -1], x ↦ x > 0)` is `False`. Empty: `Any([])` is `False`,
  `All([])` is `True`.
- A `NaN` cell under a numeric comparison is `False`, so it is never selected
  and never makes a quantifier undecided: `Any([1, NaN], x ↦ x > 2)` is `False`.
  This is the accepted `NaN`/`Missing` asymmetry of §1, the same one Julia has.
- An absent collection answers the codomain marker: `Filter(Missing, p)` is
  `Missing`, `Count(Missing, p)` is `NaN`, `Any(Missing, p)` is `Missing`.

Precedent: SQL exactly — `WHERE` drops rows whose predicate is `UNKNOWN`,
`COUNT` counts the selected rows, and `= ANY` / `= ALL` are three-valued.
Mathematica `Select` keeps only `True`. Polars `filter` drops nulls. R `any`/`all`
and Julia `any`/`all` are Kleene.

Alternatives not taken: Julia throws on `filter` over `missing` (throws are
reserved for API misuse, `ERROR-MODEL.md` §1); R's `x[x > 0]` keeps the cell as
`NA` (positional preservation belongs to Rule A, not to selection, and R users
treat this as a trap); Mathematica `AllTrue` reads "not `True`" as `False`
(contradicts the Kleene connectives already ruled).

### Rule E. An absent collection makes the whole result absent

Every operator above, when the collection operand itself is `Missing` or
`Undefined` (user ruling 2026-09-26): the result is the marker of the operator's
codomain. `Length(Missing)` and `Sum(Missing)` are `NaN`; `Reverse(Missing)`,
`Join(Missing, [1])`, `First(Missing)` are `Missing`.

`NaN` in a collection slot is not an absent collection. `NaN` is a number, and
a number is not a collection, so `Length(NaN)` is the same `incompatible-type`
error as `Length(5)`. One visible consequence: `Join` lifts a scalar operand,
so `Join([1], NaN)` is `[1, NaN]` while `Join([1], Missing)` is `Missing`.

Precedent: SQL `cardinality(NULL)` is `NULL`; Postgres `array_position(NULL, x)`
is `NULL`.

## 3. The operators the user named, under the model

| Expression | Today (`09293e23`) | Under the model | Rule |
| --- | --- | --- | --- |
| `Length([1, Missing, 3])` | `3` | `3` | A |
| `Length(Missing)` | `NaN` | `NaN` | E |
| `Length(NaN)` | `incompatible-type` | `incompatible-type` | E |
| `Count([1, Missing, 3])` | `3` | `3` | A |
| `Count([1, Missing, 3], x ↦ x > 0)` | **throws** | `2` | D |
| `Count([1, NaN, 3], x ↦ x > 0)` | `2` | `2` | D |
| `Count([1, Missing, NaN], IsMissing)` | `2` | `2` | D |
| `Sum([1, Missing, 3])` | `NaN` | `NaN` | B |
| `Sum([])` | `0` | `0` | B |
| `Join([1, Missing], [3])` | `[1, Missing, 3]` | same | A |
| `Join([1], Missing)` | `Missing` | `Missing` | E |
| `Join([1], NaN)` | `[1, NaN]` | `[1, NaN]` | E |
| `Append([1], Missing)` | **`incompatible-type value/missing`** | `[1, Missing]` | A |
| `Append([1], Undefined)` | `[1, Undefined]` | same | A |
| `IndexOf([1, Missing, 3], Missing)` | `0` | **`2`** | C |
| `IndexOf([1, Missing, 3], 3)` | `3` | `3` | C |
| `IndexOf([Missing, 5], 5)` | `2` | `2` | C |
| `IndexOf(Missing, 3)` | `NaN` | `NaN` | E |
| `Contains([1, Missing], 5)` | `False` | `False` | C |
| `Contains([1, NaN, 3], NaN)` | `False` | **`True`** | C |
| `IndexOf([1, NaN], NaN)` | `0` (was `2` before `eedab2e0`) | **`2`** | C |
| `Contains(Missing, 3)` | `Missing` | `Missing` | E |
| `Filter([1, Missing, 3], x ↦ x > 0)` | **the error message, as a value** | `[1, 3]` | D |
| `Any([1, Missing], x ↦ x > 2)` | **inert** | `Missing` | D |
| `All([1, Missing, 3], x ↦ x > 0)` | **inert** | `Missing` | D |
| `Sort([3, Missing, 1])` | `[1, 3, Missing]` | same | A |
| `Unique([1, Missing, Missing, 1])` | `[1, Missing]` | same | A |
| `Equal([1, Missing], [1, Missing])` | `Missing` | `Missing` | (2026-09-21 ruling) |
| `Equal([1, NaN], [1, NaN])` | `False` | `False` | §1 |

Bold entries are the places where today's behavior contradicts the model.

## 4. Defects the probe found (fix once §6 is decided)

1. `Append([1], Missing)` is an `incompatible-type value/missing` error, while
   `Append([1], Undefined)` and `Append([1], NaN)` keep the cell. Rule A: the
   parameter type must admit `missing`. (`library/collections.ts`, `Append`.)
2. `Filter` over a cell whose predicate answers `Missing` returns the text
   "Filter predicate must return True or False" as its value; `Count` with the
   same predicate throws. Rule D. This is ROADMAP item "A predicate that meets
   an absent element" (decision 1 in §6).
3. `Any` and `All` stay inert when the answer is undecided. Rule D makes them
   answer `Missing`. Inert is "not yet", never the terminal answer to a
   decidable question (`ERROR-MODEL.md` §1).
4. `Map(x ↦ 2x, [1, Missing, 3])` gives `[2, NaN, 6]` but is typed
   `list<integer<2..6>>`, with no `nan` arm. The same over `[1, Undefined, 3]`
   is typed `list<number>`. Type only; the value is right.
5. `IndexOf([1, NaN], NaN)` is `0`, `Contains([1, Missing], Missing)` is
   `False`, `Element(NaN, [1, NaN])` is `False`. Rule C: a marker is found where
   the same marker sits. This reverses the "Searching for an absent value finds
   nothing" entry of the Unreleased changelog (commit `eedab2e0`), which no
   release has shipped; the entry is removed, not marked.
6. ROADMAP item 4 of the 2026-09-26 review (`Map(f, Join(Missing, [3]))` stays
   inert) is Rule E not reaching a lazy operator's operand. Unchanged here.

Not defects, recorded so nobody re-derives them:

- `Unique([Missing, Undefined])` keeps both. Deduplication is structural, and
  the two symbols are structurally different, even though every value-reading
  handler reads them alike.
- `Sort([NaN, Missing, 1, Undefined])` is `[1, NaN, Missing, Undefined]`. The
  order among markers is arbitrary but stable.
- `Which(Contains([1, Missing], 5), a, True, b)` is `b`: a search is decided
  (Rule C), so the else branch is taken. `Contains([1, NaN], NaN)` is `True`
  while `NaN = NaN` is `False`: one is membership, the other is arithmetic
  comparison, and every language above keeps the two apart the same way. `Which(Missing > 0, a, True, b)` is the
  "condition is absent" error, because a comparison is Kleene.

## 5. What the compiled lanes do

Nothing new. `NaN` is already the marker on every float-only target, and a
written `Missing` lowers to the target's object null (`ERROR-MODEL.md` §3). Under
Rule D, an `Any`/`All` that answers `Missing` in the interpreter answers `NaN`
in compiled code, as whole-collection `Equal` already does.

## 6. Decisions for the user

Decided 2026-09-26: Option 1 of each decision below. Rule C reversed an
unpublished ruling and Rule D was not ruled; before the decision,
`IndexOf([1, NaN], NaN)` was `0`, `Count` threw, `Filter` returned its error
message as a value, and `Any`/`All` stayed inert.

**Decision 0 — search compares structurally (Rule C).**
Input: `IndexOf([1, NaN], NaN)`, `Contains([1, Missing], Missing)`.
Today: `0` and `False` (commit `eedab2e0`, unpublished). Before that commit:
`2` and `Missing`.

- Option 1 (recommended): structural, `2` and `True`. JavaScript `includes`,
  R `match`, Julia `isequal`, Mathematica `Position`, Python `in`. Agrees with
  `Unique`/`Set`/`Tally`. One sentence covers every collection operator:
  containers hold expressions, and membership is structural.
- Option 2: keep the 2026-09-26 reading, `0` and `False`. JavaScript
  `indexOf`, NumPy `isin`. Search then disagrees with `Unique` about whether a
  `NaN` cell is "there".
- Option 3: Kleene, `NaN` and `Missing`. SQL `IN`. A hole anywhere in the list
  makes a not-found search undecided.

Saying no to Option 1 keeps Option 2, since it is what the tree holds now.

**Decision 1 — selection over an absent cell (Rule D, first bullet).**
Input: `Filter([1, Missing, 3], x ↦ x > 0)` and `Count([1, Missing, 3], x ↦ x > 0)`.
Today: `Filter` returns an error message as its value, `Count` throws.

- Option 1 (recommended): keep only decided `True` — `[1, 3]` and `2`. SQL
  `WHERE`, Mathematica `Select`, Polars `filter`. Matches what the `NaN` cell
  already does today.
- Option 2: the whole result is absent when any cell is undecided — `Missing`
  and `NaN`. Consistent with Rule B, but a single hole would then hide every
  other cell from a filter, which no precedent does.
- Option 3: keep the cell in place as `Missing` — `[1, Missing, 3]` and `2`.
  R's `x[x > 0]`. Rejected above.

Saying no to Option 1 with no replacement leaves the throw.

**Decision 2 — quantifiers over an absent cell (Rule D, second bullet).**
Input: `Any([1, Missing], x ↦ x > 2)` and `All([1, Missing, 3], x ↦ x > 0)`.
Today: both stay inert.

- Option 1 (recommended): Kleene — both answer `Missing`. SQL, R, Julia. Same
  table as `And`/`Or`, which `All`/`Any` fold.
- Option 2: boolean — `False` and `False` ("not `True` is `False`"). Mathematica
  `AnyTrue`/`AllTrue`. Simpler for `Which`, but `All(xs, p)` would then disagree
  with `And` over the same answers.

Rules A, B and E are already ruled (2026-07-24, 2026-09-21, 2026-09-26) and
this document only names them together; nothing in them changes.

## 7. Where this landed

- `docs/ERROR-MODEL.md` §3 has the five rules as the subsection "Absent values
  in collection operators".
- The ROADMAP item "A predicate that meets an absent element" left the file.
- The Unreleased changelog entry "Searching for an absent value finds nothing"
  was replaced by "A search is structural", with the predicate rule, the
  `Append` fix and the ranged-type fix as their own entries.
- Defects 1 to 5 of §4 are fixed, with box-route and parse-route probes for
  each rule in `test/compute-engine/collections-absent.test.ts`. Defect 6
  (a lazy `Map` over an absent `Join`) stays in the ROADMAP.
- Two compiled-route refusals were added to keep the targets faithful, and
  are described at the end of the error-model subsection: a search whose
  needle may be a computed absence, and `Any`/`All` over a collection whose
  element type has a `missing` arm.
- One more defect surfaced while implementing, and is fixed: the `Element`
  type handler claimed `false` for `Element(NaN, [1, NaN])` because it read
  `NaN` as different from `NaN`, and the compiler emitted that claim as a
  literal `false`.
