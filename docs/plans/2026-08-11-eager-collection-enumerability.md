# Eager collections: split the enumerability question from materialization

**Date:** 2026-08-11 · **Status:** DESIGN — ratified in discussion, not implemented
**Follow-up to:** the `isEnumerableCollection` facet (2026-08-10, see CHANGELOG
"telling an empty collection from one that cannot be walked" and the ROADMAP
entry it closed).

## Summary

An *eager* collection operator (`Characters`, `Divisors`, `Eigenvalues`, … —
73 of them, vs. 47 operators with `collection` handler blocks) produces its
collection only as the result of `evaluate()`. Today that single fact causes
two distinct defects, and both trace to the same architectural conflation:
**the question "can this produce elements?" and the act of producing them are
served by one mechanism — the expensive one.**

The design is two coupled changes, landed in this order:

1. **Delivery** — give `BoxedFunction.at()` the same materialize-on-demand
   fallback `each()` already has, so the indexed access route can serve
   elements of an eager source. Fixes wrong values on fully-ground input.
2. **Predicate** — let an eager operator expose its *decline test* (the guard
   already sitting at the top of its `evaluate` handler) as a cheap,
   side-effect-free enumerability answer, without becoming a collection.
   Fixes the wrapped-symbolic-source residue, and eventually retires the
   evaluate-and-discard fallback in `isEnumerableSource`.

This replaces the earlier framing ("give the 73 operators lazy collection
handlers"), which was both heavier than necessary and understated the bug: the
broken shape is not only valueless arguments — **ground arguments produce
wrong values today.**

## The two defects

### Defect A — wrong values on fully-ground input (indexed route)

Everything below has no free variables; the collection is entirely computable:

```
Filter(Take(Divisors(12), 3), _ > 1)   → []        should be [2, 3]
Any(Reverse(Divisors(12)), _ > 1)      → "False"   should be "True"
Filter(Rest(PrimeFactors(12)), _ > 1)  → []        should be [3]
Sum(Take(Divisors(12), 3))             → inert     should be 6
```

Yet `Take(Divisors(12), 3).evaluate()` is correctly `[1, 2, 3]` — only the
*walk* of the un-evaluated wrapper is empty, so the bug hides until something
iterates without evaluating first (`Filter`'s iterator, the quantifiers, the
enumerability probes).

Mechanism, measured 2026-08-11 (elements yielded by `each()`; leaf alone
always walks fine):

```
leaf                Take  Drop  Reverse  Rest  Slice  Rotate │ Dedup  Zip  Map  Filter
Divisors(12)           0     0        0     0      0       0 │     6    3    6       6
PrimeFactors(12)       0     0        0     0      0       0 │     2    2    2       2
IntegerDigits(123)     0     0        0     0      0       0 │     3    3    3       3
```

The split is exactly *which access route the wrapper uses to reach its
source*. The collection protocol has two:

- **Streaming** (`each()` / `iterator`): has an eager-source fallback —
  `boxed-function.ts` `each()`, "an *eager* collection operator only
  materializes a concrete collection when evaluated … Evaluate once and
  iterate the materialized result." `Map`, `Filter`, `Dedup`, `Zip`,
  `TakeWhile` stream, so they work.
- **Indexed** (`at()`): pure handler dispatch, **no fallback** —
  `boxed-function.ts` `at()` begins `if (!handler) return undefined;`.
  `Take`, `Drop`, `Reverse`, `Rest`, `Slice`, `RotateLeft` read their source
  via `src.at(i)` (e.g. `takeIterator`, collections.ts), get `undefined` at
  index 1, and terminate.

A second, familiar-shaped defect layers on top: `at()`'s `undefined` is
ambiguous by contract — it means both "index out of range" and "cannot
answer". `takeIterator` reads any `undefined` as end-of-collection, so the
missing fallback becomes a silently empty walk instead of an error. This is
the same three-valued collapse (`can't know` → definite answer) as the
2026-08-10 round, on the indexed route.

### Defect B — wrapped symbolic source reads as empty (the documented residue)

For a valueless `s` / symbolic `n`:

```
Filter(Take(Characters(s), 2), p)   → []       should stay inert
Any(Take(Divisors(n), 2), p)        → "False"  should stay inert
```

The eager leaf is the one shape `isEnumerableCollection` reports `undefined`
for (no handlers to ask; the declared type is `list<…>` whether or not the
argument is ground). A wrapper propagates the `undefined` up, and
`isEnumerableSource`'s fallback then asks the wrong question — `evaluate()`
returns the still-lazy wrapper, which `isCollection`-wise *is* a collection —
so the empty walk is read as empty. Probed 2026-08-10/11: **32 of the 73
operators reproduce** with a single symbolic argument (`AbsArg`,
`Characters`, `CoefficientList`, `ContinuedFraction`, `Divisors`,
`Eigenvalues`, `Eigenvectors`, `FactorInteger`, `Flatten`,
`GraphemeClusters`, `IntegerDigits`, `Kernel`, `Keys`, `ListFrom`,
`Ordering`, `PrimeFactors`, `PrimeImplicants`, `PrimeImplicates`,
`RandomShuffle`, `SingularValues`, `Solve`, `Sort`, `StringSplit`, `Tally`,
`Timing`, `TruthTable`, `UnicodeScalars`, `Unique`, `Utf16`, `Utf8`,
`Values`, `Vector`); the remaining 37 need multi-argument calls and were not
probeable generically — treat 32 as a floor. Only ~11 of the 73 are
string-related; this is not a strings problem.

Re-asking the facet on the *evaluated* form does not fix B: a lazy wrapper
over a REACHABLE eager leaf (`Filter(Characters("aab"), p)`) also evaluates
to a wrapper whose facet is `undefined`, so that spelling would declare
working expressions inert.

### The root conflation

Two questions, one mechanism:

1. **"Can this produce elements?"** — a predicate. Should be O(1),
   side-effect free, safe to ask speculatively from any facet.
2. **"Produce them."** — materialization. Legitimately costs an evaluation;
   that is what *eager* means.

`isEnumerableSource` answers (1) by performing (2) and discarding the result.
The impure case is the reductio: asking "can `RandomShuffle(xs)` be
enumerated?" **consumes a draw** — a question with side effects (this is one
contributor to the tracked draw-coherence defect).

The key observation: **(1) never inherently required materializing.** Every
eager evaluate handler already *begins* with its decline test, cleanly
separated from production:

```ts
// Divisors — number-theory.ts
const k = toBigint(n);
if (k === null) return undefined;   // ← the precondition: O(1), no factorization
if (m === 0n) return undefined;     //   (0 has infinitely many divisors)
return ce.function('List', divisorsAscending(m, …));   // ← the materialization

// Characters — core.ts
if (!isString(s)) return undefined; // ← the precondition
return engine.function('List', splitGraphemeClusters(…));
```

The knowledge exists in all 73 operators; it has no exposed slot. The only
slot today is a `collection` handler block, which is a far bigger commitment:
it flips `isCollection` to `true` for every instance (changing broadcast
gates, type handlers, materialization paths), and the definition validator
then requires real `count` + `iterator` (+ `at` for an indexed result type).
A 2026-08-11 prototype on `Characters` confirmed both halves: the validator
rejected a thin block, and a full block (~25 lines) fixed every probe — but
that is a per-operator semantic review × 73.

## Design

### Part 1 — delivery: the `at()` materialize fallback

In `BoxedFunction.at()`, mirror `each()`'s fallback: when there is no `at`
handler and the expression is not `_optedOutOfCollection`, evaluate and
delegate to the evaluated form's `at`.

Constraints that make this more than one line:

- **Once, not per index.** `each()` evaluates once per walk; `at()` is called
  once per index (`takeIterator` calls `at(1)`, `at(2)`, `at(3)`). The
  fallback must reuse one evaluated form across calls on the same instance —
  either by confirming the evaluate memo already absorbs repeated
  `evaluate()` of the same pure instance, or by caching the evaluated form on
  the instance keyed by the invalidation axes (reuse the element-memo
  epoch/scope pattern from `collection-element-memo.ts`; coordinate with the
  in-flight state-event invalidation work before adding any new cache).
- **Pure sources only (v1).** Re-evaluating an impure producer per index
  would serve elements from *different* draws — incoherent, strictly worse
  than declining. `each()`'s fallback already over-evaluates impure sources
  (tracked in ROADMAP as the draw-coherence defect); `at()` must not add a
  per-index variant of it. Gate the fallback on `isPure`; the impure case
  joins the existing ROADMAP item (whose fix — compute the evaluated form
  once and thread it through — then serves both routes).
- **Negative indices.** `at()` normalizes negatives via `count` before
  dispatch; the fallback must slot in after normalization fails for lack of
  handlers, i.e. the fallback path re-runs normalization against the
  evaluated form (which has real `count`).

This alone fixes Defect A for all pure eager leaves under all indexed
wrappers, at one seam, with no per-operator work.

### Part 2 — predicate: expose the decline test

Add an optional handler on the **operator definition itself** (not inside
`collection`), e.g.:

```ts
/** For an operator whose RESULT is a collection but which has no collection
 *  handlers (an eager producer): can `evaluate()` produce the elements in the
 *  current state? This is the operator's own decline test — the guard at the
 *  top of its `evaluate` handler — and MUST be O(1), evaluation-free and
 *  side-effect free (an impure producer answers from its source's facets,
 *  consuming no draws). Absent ⇒ the facet stays `undefined` (status quo). */
canEnumerate?: (expr: Expression) => boolean | undefined;
```

`BoxedFunction.isEnumerableCollection` consults it in the no-collection-block
branch, before the `typeCouldBeCollection` fallthrough. `BoxedSymbol` needs no
change (it relays its value's facet verbatim since the 2026-08-10 review
fix). Wrapper propagation (`enumerableFromSource` / `enumerableFromAllSources`)
needs no change — the leaf simply starts answering `true`/`false` instead of
`undefined`.

Examples of the handler bodies (each is the first line of the existing
evaluate handler):

- `Characters` / `GraphemeClusters` / `StringSplit` / `Utf8` / `Utf16` /
  `UnicodeScalars`: `isString(op1)`.
- `Divisors`: `toBigint(op1) !== null && op1 is non-zero` (0 declines —
  infinitely many divisors).
- `IntegerDigits`, `FactorInteger`, `PrimeFactors`, `ContinuedFraction`:
  integer-literal tests on their operands.
- `RandomShuffle` / `RandomChoice` / `RandomSample`: source facets only
  (`op1.isEnumerableCollection` / finiteness) — **zero draws**.
- `Eigenvalues` / `SingularValues` / …: the operand is a ground numeric
  matrix.

Naming note: deliberately NOT `isEnumerable` — that name is the collection
handler with different dispatch semantics (declared-handler-owns-all-three-
states). `canEnumerate` marks it as the eager-operator precondition.

### The coupling invariant (why the order matters)

**A cheap `true` is a promise the access routes must honor.** If
`Characters("aab")` answers "enumerable" while `at()` still lacks the
fallback, then `Take(Characters("aab"), 2)` walks empty *after* the engine
vouched for it — `Filter` trusts the `true` and returns `[]`, which is
strictly worse than today's `undefined`. Therefore:

1. Land Part 1 (delivery). Generic; fixes Defect A; no predicate yet.
2. Land Part 2's mechanism plus per-operator adoption, starting with the 32
   confirmed reproducers. Each adoption fixes Defect B for that operator.
3. When adoption covers the eager producers, `isEnumerableSource`'s
   evaluate-and-discard fallback is dead code — remove it (and simplify
   `enumerationDeclined`). Until then it stays, so unadopted operators keep
   status-quo behavior. Adoption is incremental and per-operator safe.

### Explicitly out of scope

- The impure draw-coherence defect (ROADMAP): Part 1 avoids worsening it
  (pure-only gate) and Part 2 removes one contributor (predicate consumes no
  draws), but the once-per-materialization threading fix remains its own
  item.
- Fixing `at()`'s `undefined` out-of-range/cannot-answer ambiguity globally.
  With delivery in place, materialized sources leave out-of-range as the only
  live meaning on this path; a contract change is a separate discussion.
- Full lazy `collection` blocks on eager operators. Still legitimate
  per-operator (as `Range`/`Linspace` show), and superior when a closed-form
  `count`/`at` exists (`Divisors` does not need to materialize to answer
  `at(1) = 1`… actually it does — divisor order requires factorization; a
  counter-example: `Repeat`). But it flips `isCollection` and is a semantic
  review per operator; this design makes it unnecessary for correctness.

## Tests to pin

- Defect A regressions (pure ground leaves): `Filter(Take(Divisors(12), 3),
  _ > 1) = [2,3]`; `Any(Reverse(Divisors(12)), _ > 1) = True`;
  `Sum(Take(Divisors(12), 3)) = 6`; `Filter(Rest(PrimeFactors(12)), _ > 1) =
  [3]`; same shapes over `Characters("aab")`.
- Part 2 per adopted operator: symbolic argument → facet `false`, wrapped
  forms stay inert; ground argument → facet `true`, wrapped forms produce
  values; the alias case (`ys := Divisors(12)` behaves like the spelled-out
  form — relies on the symbol relaying its value's facet).
- Impure: `RandomShuffle`'s `canEnumerate` consumes no draws (count handler
  invocations); `at()`-fallback does not fire for impure sources (pin the
  current declining behavior with a comment pointing at the draw-coherence
  item).
- The `isEnumerableSource` fallback-removal step: the existing
  eager-operator route-parity tests in
  `collection-callback-signatures.test.ts` must pass unchanged without the
  evaluate fallback.

## Files

- `src/compute-engine/boxed-expression/boxed-function.ts` — `at()` fallback;
  `isEnumerableCollection` consults `canEnumerate`.
- `src/compute-engine/types-definitions.ts` — `canEnumerate` on the operator
  definition; JSDoc contract (O(1), no evaluation, no side effects).
- `src/compute-engine/boxed-expression/boxed-operator-definition.ts` — carry
  the new handler (check for a whitelist copy: `defaultCollectionHandlers`
  silently drops unknown keys; verify the operator-definition path does not
  have the same trap).
- `src/compute-engine/collection-utils.ts` — eventual removal of the
  `isEnumerableSource` evaluate fallback (step 3 only).
- Per-operator: `library/core.ts` (strings), `library/number-theory.ts`,
  `library/linear-algebra.ts`, `library/collections.ts` (`Sort`, `Ordering`,
  `Unique`, `Tally`, `Flatten`, `ListFrom`, …), `library/logic.ts`
  (`TruthTable`, `PrimeImplicants`), `library/statistics.ts`.
