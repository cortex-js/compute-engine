# Lazy views: repeated reads, effects, and captured bindings

Date: 2026-10-20. Investigation for Q11 in the
[collection design note](2026-10-20-bare-tuple-record-any.md).

This records current behavior and a recommendation, not a new language
decision. No implementation was changed. The investigation used a detached
worktree at `928a5c29cfa1a2e647010ba345fc69190167a612`, separate from the
shared working changes.

## Findings

R can preserve cheap counts and direct indexing without requiring pure
callbacks or a new universal cache. The difficult migration is preserving
input bindings when removing implicit materialization. Repeat-read behavior
already depends on whether a view has an eligible, valid element cache.
Neither “all callbacks rerun” nor “each position runs once” describes it.

### Counts and direct indexing

An instrumented `Map` over `Range(1, 1000000)` returned `Nothing` from
every callback. Reading its raw count returned 1,000,000 with zero calls.
Reading position 900,000 returned `Nothing` with exactly one call. No
preceding elements needed evaluation.

That property is supported by `Map`'s direct access path; it is not a
promise that every view has constant-time indexing. For example, a filter
may have to evaluate predicates to locate its selected elements. R avoids
adding a further scan merely to remove `Nothing`.

### Effectful callbacks can rerun

The following Epsil callback mutates an enclosing counter:

```text
let n = 0
function t1() scope -> integer { n = n + 1
  1 }
let s = Map(x => x + t1(), [1, 2, 3])
```

Performing these operations in order gave:

| Operation | Result | Cumulative callback calls |
| --- | --- | --- |
| Bind `s` | A lazy view | 0 |
| `Length(s)` | 3 | 0 |
| `s[2]` | 3 | 1 |
| `s[2]` again | 3 | 2 |
| `Sum(s)` | 9 | 5 |
| `Sum(s)` again | 9 | 8 |

This agrees with `lazy-callback-count.test.ts`. That test also explains
that this particular callback fails the dependency eligibility check for
element caching. Its behavior must not be generalized to every impure
callback.

### A complete random walk can establish cached results

A host-side `Map(x => Random(), Range(1, 3))` used an injected entropy
provider returning `0.01`, `0.02`, and so on. The provider counted draws;
the probe did not rely on probabilistic inequality.

| Operation, in order | Result | Cumulative draws |
| --- | --- | --- |
| Read position 2 | 0.01 | 1 |
| Read position 2 again | 0.02 | 2 |
| Walk the complete view | [0.03, 0.04, 0.05] | 5 |
| Walk it again | [0.03, 0.04, 0.05] | 5 |
| Read position 2 | 0.04 | 5 |
| Assign an unrelated variable, then walk | [0.03, 0.04, 0.05] | 5 |
| Change precision, then walk | [0.06, 0.07, 0.08] | 8 |

This is the existing [randomness policy](../RANDOMNESS-MODEL.md#one-instance-one-draw-set-element-memo),
not a proposed exception for R. It does not guarantee that an indexed read
before a complete walk agrees with a read afterward. Impure partial walks
do not establish reusable prefix caches; an eligible complete walk can.

Source inspection adds important limits: the element cache has a 100,000
element cap, dependency eligibility checks, and exclusions for elements
containing mutable objects. Relevant binding writes and global semantic
changes invalidate it. The size boundary was inspected, not separately
stress-tested in these probes. A complete traversal alone does not imply
that caching succeeds for every view.

### Assignment and nesting currently change evaluation timing

Changing the counter example to use a variable source:

```text
let xs = [1, 2, 3]
let s = Map(x => x + t1(), xs)
xs = [7, 8]
```

runs all three callbacks while assigning `s`. Its later length is 3 and
sum is 9, with no additional calls. In contrast, the literal-source example
above remains lazy. Nesting that literal-source view in a list also runs
all three callbacks: `[Map(x => x + t1(), [1, 2, 3])]`.

Language `Assign`/`Declare` use `assignedValue()` in
`src/compute-engine/library/core.ts`: an eligible finite lazy indexed or
set collection is materialized when `readsVariable()` detects a variable.
This is a syntactic detection rule, not a general purity analysis. List
and tuple literals also have their own materialization path in
`src/compute-engine/boxed-expression/listed-element.ts`.

There is a particularly relevant edge case:

```text
let s = Map(x => If(x > 1, Nothing, x), [1, 2, 3])
(Length(s), Length(ListFrom(s)))
```

Currently this returns `(1, 1)`, although the unassigned view has raw count
3. `Nothing`'s value definition is not marked constant, so the variable
detection rule also triggers here. A variable source gives the same
compacted result. Under selected R semantics, assignment must preserve
the raw count: the intended result becomes `(3, 1)`.

### Capture must survive removal of materialization

These current behaviors were confirmed:

- Language assignment captures the scalar input through materialization:
  `offset = 10; s = Map(x => x + offset, [1, 2]); offset = 20`
  leaves `s` with elements 11 and 12.
- Self-reassignment works: starting with `[1, 2, 3]`,
  `xs = Map(x => x + 1, xs)` gives endpoints 2 and 4.
- A view returned from `make(n) = do { let h = k => k + n;
  map(h, [1, 2]) }` retains the first call's input: `make(10)` still
  yields 11 and 12 after another call with 20.
- A host-created view over a live `offset` dependency changes from
  `[11, 12]` to `[21, 22]` after `ce.assign('offset', 20)`, even after
  its first complete walk. A `ListFrom(view)` obtained before the write
  keeps `[11, 12]`.

The existing assignment suite separately pins the distinction between
language assignment and host `ce.assign()`, including live source-variable
updates. Existing scope helpers bind escaping locals and lazy arguments;
removing eager conversion is not a substitute for preserving those rules.

## Recommendation in plain language

1. **A view keeps its positions, including `Nothing`.** Counting a raw
   one-result-per-input view does not run callbacks when its source count
   is already available. Reading a directly addressable position does not
   evaluate earlier positions merely to fill a cache or compact the view.
2. **A view can run a callback again.** Keep existing effectful callbacks
   legal. Preserve the existing conditional caches, including completed
   random-view caches, but do not promise exactly-once execution for all
   views. Cache raw results without dropping `Nothing`.
3. **Ask for a list when you need a materialized sequence snapshot.**
   `ListFrom(view)` consumes the view and omits `Nothing`; later reads of
   the resulting scalar data do not rerun the view. This is not a promise
   to deep-copy mutable objects stored as elements. Materialization still
   needs to finish; it is not available for an infinite sequence.
4. **Storing a view should keep its inputs without running every callback.**
   Preserve the intent of today's language assignment snapshots by retaining
   the relevant input bindings. Do not merely remove conversion and leave
   a self-assigned view referring back to its new binding.

Rules 1 and the explicit omission boundary follow the selected R model.
Rules 2 and 4 are recommendations for Q11, not newly accepted decisions.
They require documenting that effects may happen later than they do under
today's eager assignment and nesting paths.

The next decision is the scope of input capture. For a stored view using
`offset = 10`, then followed by `offset = 20`, recommend that its first
element remain 11; the live-binding alternative returns 21. Preserve the
existing live host API separately. Capturing these input bindings does not
mean freezing mutable objects or every variable accessed by an effectful
callback: decide those cases explicitly. In particular, a callback that
intentionally increments an enclosing counter must retain that effect.

A universal pure-view rule or mandatory demand cache would be a separate
language change. Neither is needed to implement raw positions. Likewise,
revisiting randomness coherence before a complete walk or beyond the cache
cap is a separate decision, not an incidental part of omission semantics.

## Validation and reproduction

Eleven focused probe cases passed, with exact assertions on callback/draw
counts and results. Only scalar results or already-consumed arrays were
formatted; printing a lazy view can itself consume it. Temporary artifacts:
`/tmp/ce-q11-probe-20261020/q11-probe.mjs` and `q11-results.json` in that
directory. Run the script from the worktree with
`node --import tsx q11-probe.mjs`.

Four existing suites passed: **120 tests, zero failures**:

```sh
node node_modules/jest/bin/jest.js --watchman=false \
  --config ./config/jest.config.cjs -w 4 --runTestsByPath \
  test/compute-engine/lazy-callback-count.test.ts \
  test/compute-engine/collection-element-memo.test.ts \
  test/compute-engine/assignment-stores-lazy-collection.test.ts \
  test/epsil/review-collection-capture.test.ts
```

These establish the baseline, not conformance to the proposed R migration.
The probes exercised the interpreter/host API; the assignment suite also
contains compiled JavaScript checks. This was not an exhaustive audit of
compiler targets, callback kinds, mutable state, or all collection operators.
