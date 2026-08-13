# First-boxing binding divergence (Tycho item 178(a)+(c))

**Status:** root-caused, NOT fixed. Design note only — the fix touches binder
scope construction and should be made deliberately.

**Filed as:** Tycho items 178(a) (`Integrate` with symbolic limits) and 178(c)
(`PointList(∫…)`), in `docs/COMPUTE_ENGINE.md` of the Tycho repo. They are one
defect; the two filings are two surfaces of it.

**Repro:** `docs/scratch/ce-item178ac-boxing-determinism.mts` (four
`ComputeEngine`s, no corpus).

## The symptom

Boxing the same MathJSON twice, on the same engine, can produce two expressions
that are not `isSame`:

```js
const J = ['List',
  ['Integrate', ['Function', ['Block', ['n', 'x', 'y_r']], 'x'],
                ['Limits', 'x', -10, 10]],
  'y_r'];

ce.box(J).isSame(ce.box(J));   // false
```

It stabilizes immediately: `box2.isSame(box3)` is `true`. Only the FIRST boxing
of a given shape is the odd one out.

The MathJSON of all three is byte-identical, and the hashes are equal — it is
purely a binding-identity difference.

## What it requires

Measured, not assumed:

| shape | `box×2` `isSame` |
| --- | --- |
| symbol occurs inside a binder's scope **and** outside it | **false** |
| symbol occurs only inside the binder | true |
| no binder involved | true |
| symbol pre-declared with `ce.declare()` before boxing | true |

So the trigger is: **a not-yet-declared symbol occurring both inside a binder's
scope and outside it.**

## The mechanism

The first boxing auto-declares the symbol as a side effect — it is undeclared
before the call and declared after. The two occurrences do not agree during
that first call:

```
box1 (first ever):  inner def === outer def ?  false
box2:               inner def === outer def ?  true

box1.inner def === box2.inner def ?  false     <- the transient one
box1.outer def === box2.outer def ?  true      <- stable
```

During the first canonicalization the occurrence INSIDE the binder's scope
auto-declares into a scope local to that canonicalization, while the sibling
outside auto-declares into the enclosing scope. From the second boxing on the
name already exists in the enclosing scope, so the inner occurrence resolves to
it instead of creating a local — and the resulting tree differs from the first.

In other words the **auto-declare target depends on whether the name already
exists**, which makes the first canonicalization of a shape structurally
different from every later one.

This maps onto both filings: in (a) `x` is in the integrand and in the bounds
(`a` was the first boxing, `b` the parse); in (c) `y_r` is in the integrand and
a `List` sibling (`a` and `b` agreed, but `box(b.json)` was a third
construction).

## Why it matters beyond the four corpus rows

`CLAUDE.md` documents `.isSame()` as "an unconditional equivalence relation, so
it is safe as a dedup/matching key." That is not currently true: for a shape
carrying a not-yet-declared symbol in this configuration, the first-ever boxing
fails to match every later one. Any dedup, memo or match keyed on `isSame`
across a first registration pass can silently miss.

## Candidate fixes

Not yet chosen. Each needs the full suite plus a snapshot blast-radius count.

1. **Declare before binding occurrences.** Hoist auto-declaration of a free
   symbol to the enclosing scope BEFORE canonicalizing the subtree, so the
   inner and outer occurrences resolve to the same binding on the first pass.
   Most direct; the risk is that it changes which scope owns a name in shapes
   where a binder-local really is wanted, and closure capture relies on free
   variables auto-declaring in the innermost function scope
   (see `createSymbolExpression`, `engine-expression-entrypoints.ts`).
2. **Re-resolve after the pass.** Let the first pass proceed, then re-bind
   occurrences whose auto-declared local was superseded by an enclosing
   declaration. Contained, but adds a fix-up pass and a second source of truth.
3. **Make the target unconditional.** Choose the auto-declare scope from the
   expression's structure alone, never from whether the name happens to exist
   yet. Cleanest statement of the invariant — the auto-declare target must not
   depend on engine history — but likely the widest blast radius.

Whichever is chosen, the invariant to pin is: **`ce.box(J).isSame(ce.box(J))`
for every J, on a fresh engine, independent of call order.** That is a property
worth testing directly rather than through any one witness.

## The type criterion, corrected

An earlier draft of this note added a second criterion: that the inferred type
be pinned at the PRECISE value (`finite_integer`) rather than the degraded
`number` a later boxing produces. **That criterion was wrong, and pinning it
would have contradicted the engine's own inference model.**

Inference is order-sensitive, but NOT because it is one-shot. An earlier draft
of this section said "first evidence wins and is never refined"; that is wrong.
`docs/TYPE_SYSTEM_ROADMAP.md` §1 states the model: inference of unannotated
symbols is "evidence-based and *revisable* (narrow from argument use, widen from
value assignment, non-monotone override per D11, forward-ref re-derivation)
rather than a once-and-final principal type". The order-sensitivity falls out of
those DIRECTION rules, not from an absence of revision.

Measured on a fresh engine with `x` pre-declared `number`, so only the order
varies:

```
usage then assignment :  number     (x·v boxed first, then v := 5)
assignment then usage :  integer    (v := 5 first, then x·v boxed)
value in both cases   :  5
```

So `number` is not a degraded answer; it is what the model returns once a
numeric-context use has been seen first. The item-178 type observation is the
same first-boxing state leak wearing a different hat: on the first boxing the
outer occurrence's binding sees only the assignment, while on later boxings the
shared binding already carries the body's usage evidence.

The corrected second criterion is therefore about CONSISTENCY, not a particular
value: **the inferred type must be identical across boxings of the same
expression**, whatever value the model settles on. A fix that makes the type
consistent has done its job; choosing which of `integer`/`number` is *right* is
a question about the inference model, not about binder scope.

**Adjacent finding, and it is behaving as §1 describes — not a defect.** The
direction rules were probed individually
(`docs/scratch/2026-08-13-inference-direction-rules.mts`):

| probe | result |
| --- | --- |
| widen from value assignment (`v := 5` then `v := 2.5`) | `integer` → `real` ✓ |
| narrow from argument use, starting at `unknown` | `unknown` → `number` ✓ |
| narrow further from a later, narrower use (`v!` after `x·v`) | `number` → `number` — no further narrowing |
| narrow from a value assignment (`v := 5` after `x·v`) | `number` → `number` — excluded, as §1 implies |

So a use narrows an unannotated symbol out of `unknown`, an assignment widens,
and neither narrows an already-narrowed type. Order-sensitivity is the fixpoint
of those rules rather than a missing revision step, and `number` after a
numeric use is the model's answer, not a degradation.

The one question the table leaves open is whether an assignment SHOULD be
allowed to narrow — §1 excludes it, and it is not obvious that is deliberate
rather than inherited. That is a type-system question, not a binder-scope one,
and the inference-provenance work
(`docs/plans/2026-08-13-inference-provenance-journal.md`) is where it becomes
answerable, since provenance is what would let a write know whether the
incumbent type came from a use or from a value.

## Related

- The closure-capture machinery this must not disturb:
  `createSymbolExpression` in `engine-expression-entrypoints.ts`, and the
  shadowed-parameter stack it consults.
- Sibling defects fixed in the same round, both already landed: item 178(b)
  (one exact integer had two storage forms — `exact-numeric-value.ts`) and
  178(d) (`.structural` re-sorted a canonical expression's operands —
  `boxed-function.ts`).
