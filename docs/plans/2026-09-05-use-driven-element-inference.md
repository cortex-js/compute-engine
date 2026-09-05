# Use-driven element inference for collections (Phase 3 of the inference roadmap)

**Status:** DRAFT 2026-09-05. The mechanism was measured on the tree of that
day. Implementation waits for a go/no-go decision and the rulings in §5.

This is the last open element phase of `docs/INFERENCE_ROADMAP.md`. The two
element phases before it shipped on 2026-08-18: a bare `list` declaration
refines its element slot from an assignment (Phase 1), and a collection-typed
parameter distributes its element type onto the symbols of a literal argument
(Phase 2). Both of those flow element types from a VALUE or a PARAMETER into a
symbol. This phase flows an element type from a USE of an element back onto
the collection the element was taken from.

## 1. The feature

When an element taken out of a collection is used in a typed position, the
collection learns its element type.

| Program (all symbols undeclared) | Today | Proposed |
|---|---|---|
| `xs[1] + 1` | `xs: dictionary<any> \| indexed_collection<any>` | `xs: dictionary<real> \| indexed_collection<real>` |
| `Sin(xs[1])` | same | same as above |
| `k(xs[1])` with `k: (integer) -> integer` | same | `xs: dictionary<integer> \| indexed_collection<integer>` |
| `First(ys) + 1` | `ys: indexed_collection<any>` | `ys: indexed_collection<real>` |
| `m[1][2] + 1` | `m: dictionary<any> \| indexed_collection<any>` | `m: dictionary<dictionary<real> \| indexed_collection<real>> \| indexed_collection<…same…>` |
| `(v) => v[1] + 1` | `(v: dictionary<any> \| indexed_collection<any>) -> broadcastable<number>` | `(v: dictionary<real> \| indexed_collection<real>) -> broadcastable<number>` |

The collection part of the type is already inferred today: the `At` canonical
handler validates its operands against a collection-typed signature, and that
validation writes `dictionary<any> | indexed_collection<any>` onto an
undeclared base symbol. Only the element slot stays `any`. This phase fills
that slot.

## 2. What was measured on 2026-09-05

These facts fix the design. Each one was checked with a probe against
`src/compute-engine`.

**How a requirement reaches the `At` node.** The `At` node itself types
`unknown`. When it is an operand of an arithmetic operator (`Add`, `Sin`, …),
the numeric-context inference in `boxed-expression/validate.ts`
(`checkNumericArgs` / `inferNumericArgs`) calls `_infer` on it with the scalar
type `real` (or `number` when a sibling operand could be complex). The
exclusion gate for that write, `excludedFromScalarInference`, does NOT
exclude the node: `typeCouldBeCollection('unknown')` is `false` and the node
is not a collection. When the node is an operand of a NON-threadable typed
parameter (`k(xs[1])` with `k: (integer) -> integer`, `And(xs[1], B)`), the
final inference pass of `validateArguments` calls `_infer` with the parameter
type. In both cases the call lands in `BoxedFunction._infer`, which returns
`false` at once for a library operator, because only a definition with an
INFERRED signature accepts a result-type write there. That method is the
landing point for this phase.

**The meet of the incumbent union with the new one is well-formed.**
`narrow(dictionary<any> | indexed_collection<any>, dictionary<real> |
indexed_collection<real>)` is `dictionary<real> | indexed_collection<real>`.
A second write with a different element type meets to the narrower one
(`indexed_collection<integer>` after `real` then `integer`) or to `never`
(`real` then `boolean`). The `never` case is never written: validation of the
second use fails before the write, because the `At` type handler already
reports the element as `real`.

**A DECLARED bare `list` does not take a use write.** `narrow(list<unknown>,
indexed_collection<real>)` is `never`, and `BoxedSymbol._infer` declines a
declared symbol anyway (the gate is `inferredType || type.isUnknown`). Phase 1
refines a declared placeholder through a different route, the skeleton kept
on the value definition (`_placeholderSkeleton`). A use-driven refinement of
a declared placeholder would need to go through that route. See ruling R3.

**An INFERRED lambda signature is not enforced at application.** With
`h := (v) => v[1] + 1`, the calls `h([1, "x"])` and `h([[1, 2], [3, 4]])`
evaluate to `2` and `[2, 3]` today, and `h(5)` produces a run-time
`incompatible-type` error, not a canonicalization error. A sharper inferred
parameter type therefore cannot refuse a program the interpreter accepts
today. It changes what `typeof h` reports and what the compiler sees.

**Both compile targets already compile indexing over an untyped collection.**
`zs[1] + 1` compiles and runs on the JavaScript target and on the `interval-js`
target for `zs: list`, for an undeclared `zs` (the `<any>` union), for
`zs: list<real>`, and for `zs: indexed_collection<real> | dictionary<real>`.
The "compile fail-closed gate for numeric indexing" named as a payoff in the
roadmap no longer blocks these programs. One negative result: an element
type of `broadcastable<real>` makes the `interval-js` target DECLINE
(`Cannot compile an object-domain absent ('missing') position (type
'broadcastable<real> | missing')`). So writing `broadcastable<real>` as the
element type would regress a program that compiles today.

**The named payoffs, re-assessed.** The roadmap named three:

| Payoff named in the roadmap | Measured 2026-09-05 |
|---|---|
| Broadcast decisions read the lambda's parameter slots | Already correct: the `<any>` union excludes every scalar, so `paramsAreScalar` is already `false` and a list argument is applied whole, not broadcast. No gain. |
| The compile fail-closed gate for numeric indexing over an unassigned collection | Already compiles on both targets. No gain. |
| Tycho's classification: `couldBeType(x, "collection<number>")` on an unrefined `indexed_collection<any>` defeats their numeric-collection check | Use-driven evidence from arithmetic gives `real` as the element, which makes `couldBeType(…, "collection<number>")` TRUE and does not change their verdict; their point-list rungs need a TUPLE element type, which no arithmetic use produces. No gain from this phase. |

What remains as payoff: the static types the engine reports become precise.
`typeof xs` after `xs[1] + 1` says `indexed_collection<real>` instead of
`indexed_collection<any>`; a lambda's arrow documents what its body needs
from a collection parameter; the Epsil hover (VS Code) and the `epsil check`
report show the same. That is a real but modest gain.

## 3. The mechanism

One new optional handler on an operator definition, one new branch in
`BoxedFunction._infer`, and per-operator handlers on the participating
heads.

**The handler.** On `OperatorDefinition` (`types-definitions.ts`), beside
`elementCount`:

```ts
/**
 * Given a type REQUIREMENT on this application's result, the type each
 * operand must have for the result to satisfy it. Returns one entry per
 * operand, `undefined` where the operand learns nothing. Only value
 * requirements reach the handler (never `any`, `unknown`, `value`,
 * `nothing`, a function type, or a bare absence marker).
 */
inferOperandTypes?: (
  ops: ReadonlyArray<Expression>,
  requirement: Type
) => ReadonlyArray<Type | undefined> | undefined;
```

**The branch.** `BoxedFunction._infer(t, mode)` today: decline in a
resolve-only region; decline unless the definition has an inferred
signature. New, between those two steps: when `mode` is `'narrow'` (the
default; a requirement) and the definition has `inferOperandTypes`, compute
the requirement `r` from `t()` (strip the absence arms; decline when the
result is empty, or is `any`/`unknown`/`value`/`nothing`/a function type),
call the handler, and for each returned entry call `ops[i]._infer(() =>
type)`. Return `true` when any operand accepted its write. Everything the
symbol write needs — assumptions hidden, the rollback journal, the state
event, the no-op skip, the resolve-only decline — is already in
`BoxedSymbol._infer`; the branch only forwards. When `ops[i]` is itself an
application (`m[1][2]`), the forward reaches this same branch again, and the
nested case needs no extra code.

**The `At` handler.** For `At(xs, i)` with exactly one index whose type is
not a collection (a scalar index, not a gather or a mask): operand 0 learns
`dictionary<r> | indexed_collection<r>`. The two-arm shape matches what the
`At` validation already wrote, so the meet is exact. The index operand learns
nothing. Declined, so nothing is written: a gather or mask index (the result
is a list, not an element), a multi-index access `At(m, i, j)` (the chained
single-index form `m[i][j]` covers it through the recursion), and a base that
is a ring constant (`\mathbb{Z}[x]` is adjunction, not indexing).

**`First`, `Second`, `Third`, `Last`.** Operand 0 learns
`indexed_collection<r>`.

**`Take`, `Drop`, `Rest`, `Most`.** The result is a list, so a requirement on
it is a collection type. When `collectionElementType(r)` is a value type `e`,
operand 0 learns `indexed_collection<e>`; otherwise nothing. These four are
optional for a first delivery. They cost one shared helper and add pins.

**Not on the list.** `Map`'s callback parameter is already typed forward
from the source collection (`lambda-param-element-inference.test.ts`);
`Length`'s canonical handler writes collection evidence onto a bare symbol
only, and `Length(xs[1])` is out of scope for the same reason a nested
collection evidence write would be: it belongs to that handler, not to this
hook. A user function with an INFERRED signature keeps today's behavior in
`_infer` (result-type narrowing of its own signature).

**Confinement, inherited.** Speculative parsing (`ce.parse(…, {speculative:
true})`) wraps the parse in a rollback frame, and the symbol write journals
itself there; a pin in the new test file must show that a speculative parse
of `xs[1] + 1` leaves `xs` untouched. Resolve-only regions decline in
`BoxedFunction._infer` before the new branch. A symbol with assignment
evidence declines the write in `BoxedSymbol._infer` (the evidence guard from
the Phase 0 round): `xs = [1, "x"]; xs[1] + 1` never rewrites `xs`.

**Dispatch visibility, the standing risk.** Every inference write changes
what `matches()` answers at later canonicalizations. After `xs[1] + 1`, the
node `xs[1]` types `real | nan`-shaped (the `At` type handler reads the
refined element), so `xs[1]^2` dispatches as a scalar power, and `xs[1] * ys`
as a scalar product. That is the same dispatch a scalar symbol gets after
`x + 1`. A program that later assigns a matrix to `xs` re-infers on
assignment (assignment replaces); a lambda applied to a matrix keeps working
because the inferred signature is not enforced. The residual risk is a
compiled lambda: `(m) => m[1] + 1` compiled with `m: indexed_collection<real>`
and then run on a matrix emits scalar `+` over an array row. Today the same
lambda compiles with `m: indexed_collection<any>` and the same row, and the
compiled kernel handles neither: the compile-time element type only changes
the diagnostic, not the run-time outcome. A pin must witness this.

## 4. Tests

New file `test/compute-engine/use-driven-element-inference.test.ts`:

- the six programs of §1 on the box route, the parse route (`x_1 + 1`
  spells `At`), and the Epsil route (`let f = (v) => v[1] + 1`), reading
  `typeof` and the lambda arrow;
- a nested access and a chained one;
- the declined cases: gather index, mask index, multi-index, ring constant,
  an `any`-typed consumer (`Length(xs[1])` leaves `xs` unchanged);
- the evidence guard: an assigned heterogeneous list is not rewritten;
- the second-use conflict: `xs[1] + 1` then `And(xs[1], B)` is an
  `incompatible-type` error at canonicalization, with `xs` unchanged;
- speculative parse leaves no write;
- rollback: a write inside a failed canonicalization frame is undone
  (`inference-rollback.test.ts` has the pattern);
- the compiled-lambda witness of §3.

Blast radius, measured 2026-09-05 by grep: three existing test files print
today's `<any>` union and will change wording
(`list-parameter-indexing.test.ts` ×3,
`unknown-param-call-site-refinement.test.ts` ×1,
`placeholder-signature-refinement.test.ts` ×1). The snapshot count is not
known until a full-suite run; it must be measured and reported, not
absorbed.

## 5. Rulings needed before implementation

**R1 — What does an arithmetic use of an element prove about the element?**
`xs[1] + 1` is legal when `xs[1]` is a number and also when it is a nested
numeric collection (the sum broadcasts). Options:

- **A (recommended): write the scalar reading, `real`.** This is what the
  engine already does for a bare symbol: `x + 1` infers `x: real`, not
  `broadcastable<real>`. The interpreter does not enforce inferred lambda
  signatures, so a matrix-row program keeps working (§2). The element type
  compiles on both targets.
- **B: write `broadcastable<real>`.** Exactly what the consumer proves, but
  it makes the `interval-js` target decline a program that compiles today
  (§2), and the `<broadcastable<…>>` spelling would show up in every
  `typeof` and hover. Not recommended.
- **C: write nothing for threadable consumers; only a non-threadable typed
  parameter (`k(xs[1])`) writes.** Sound and narrow, but it leaves the most
  common program (`xs[1] + 1`) exactly where it is today, so most of the
  remaining payoff is lost.

If nothing is decided, nothing is built and rows 2 and 3 of the roadmap's gap
matrix stay open.

**R2 — Does a boolean (or other non-numeric) use commit the element type the
same way?** `And(xs[1], B)` would write `indexed_collection<boolean>`, and a
later `xs[1] + 1` becomes an `incompatible-type` error at canonicalization.
That is what happens to a scalar today: `And(x, B)` then `x + 1` errors,
and test files use uppercase symbols in boolean contexts for that reason.
Options:

- **Same as the scalar rule (recommended):** every value requirement writes.
  One rule, already documented for scalars.
- **Numeric and string requirements only:** boolean uses write nothing.
  Avoids the retype for elements while keeping it for scalars, which is an
  asymmetry to teach.

**R3 — Does a use refine a DECLARED bare placeholder (`let a: list`)?** After
`let a: list` and `a[1] + 1`, should `typeof a` report `list<real>`? The
roadmap's stated intent for `a: list` is "definitely a list, elements to be
determined", which argues yes. The write cannot go through `_infer` (§2); it
would use the Phase 1 skeleton route, and an assignment afterwards replaces
it (Phase 1 recomputes the refinement from each assignment). Recommendation:
defer to a second delivery, once the inferred-symbol route is in and the
snapshot blast radius is known; the declared-placeholder case adds a second
write path to review.

## 6. Go/no-go

The cost is one session: the handler contract, the `_infer` branch, five
per-operator handlers (or two, without the `Take` family), the test file,
five re-worded pins, the snapshot measurement, and the documentation
updates in §7. The gain is precise static types for collections whose
elements are used but never assigned (§2, last paragraph); the three payoffs
the roadmap named in August have since been realized by other means or do
not apply. The recommendation is to proceed with option A and the
`At`/`First`/`Second`/`Third`/`Last` set only, because it completes the
symmetry the roadmap set out (`unknown` refines from evidence at every
granularity) at a bounded cost; the alternative is to close Phase 3 as "not
pursued, payoff realized elsewhere" and record that in the roadmap.

## 7. Documentation to update with the implementation

- `doc/08-guide-types.md`, "When Inference Triggers", item 3: the sentence
  "indexing (`v[1]`) narrows it to `dictionary<any> | indexed_collection<any>`"
  becomes "… and a use of the element then refines the element slot".
- `docs/INFERENCE_ROADMAP.md`: rows 2 and 3 of the gap matrix, and the Phase 3
  status line.
- `CHANGELOG.md`: one entry under the unreleased version.
- This plan is deleted when the work lands (`docs/plans/README.md`).
