# Element-type inference for callback lambda parameters

**Status: DESIGN — awaiting maintainer go-ahead. Nothing implemented.**

2026-08-08. Follow-on to the 2026-08-07/08 compile-soundness rounds and the
forward-ref re-derivation
(`docs/plans/2026-08-07-forward-ref-inference-rederivation.md`).

## Problem

An unannotated lambda parameter learns nothing from the collection its
callback is applied to:

```
points : list<tuple<number, number>>
Filter(points, pt |-> pt == (0, 0))
```

`pt` types `unknown`, so inside the body `pt == (0, 0)` is a
tuple-vs-not-provably-tuple comparison — precisely the shape the aggregate
gate must decline (admitting it is unsound: compiled JS cannot distinguish a
tuple array from a list array at run time, and `Apply(f, 1)` interprets to
`False` where `_SYS.eq(1, [0,0])` answers element-wise). The annotated
spelling compiles today with full run parity:

```
Filter(points, (pt: tuple<number, number>) |-> pt == (0, 0))
// → (pt) => _SYS.eq((pt), ([0, 0]), 1e-10)
```

So the *only* missing piece is getting the element type of `points` onto
`pt`. The interpreter does not need this (it binds actual values); the value
is (a) the compiled fast path for point predicates over point lists, and
(b) better static types for anything else that reads the literal's
signature.

## Non-goals

- **The vectorization default is untouched.** Unannotated scalar-bodied
  lambdas keep broadcasting; this design only *adds* type information at
  specific application sites, it never turns evidence off. (Ruled and
  re-confirmed 2026-08-08 — see `project-broadcast-length-policy`,
  ELIGIBILITY.)
- **No interpreter behavior change** in the recommended design (B).
- Tier-2 string / tier-3 dictionary compile support: unrelated.

## Rejected: (A) sticky inference onto the literal's parameter binding

Writing the element type onto the lambda's parameter binding (the way
`cs[j]` writes collection evidence during body canonicalization) is wrong
here, for a reason the broadcastable-lift round already documented: the
literal can be SHARED —

```
let f = pt |-> pt == (0, 0)
Filter(points, f)     // would stick pt: tuple<number, number>
Filter(codes, f)      // codes: list<integer> — now mistyped or erroring
```

One application site must not mutate the literal for every other site.
(Same class as the order-dependence trap that killed bare-symbol
`broadcastable` triggering in the lift prototype.) The forward-ref
provisional-repair cascade is also not the vehicle: it re-derives on
*definition* events, keyed by callee name; there is no definition event
here, and its repairs are global rebuilds — the same sharing hazard.

## Recommended: (B) per-application re-derivation of INLINE callback
literals, at compile time

Compile-only, zero engine-semantics change. When a compile handler for a
higher-order collection operator compiles its callback operand:

1. The operand is an inline `Function` literal (not a symbol naming one —
   a named function may be shared; it keeps today's behavior).
2. Its relevant parameter is UNANNOTATED.
3. The sibling collection operand's element type is provable
   (`collectionElementType` of the static type; `unknown`/`any` disqualify —
   the same only-positive-evidence convention as every other gate).

Then compile an ANNOTATED REBUILD of the literal instead: re-derive the
literal from its structure with the parameter wrapped in
`Typed(param, <element type>)`, exactly the rebuild-from-structure that
`canonicalFunctionLiteralArguments` performs for any literal (and that the
provisional-repair machinery already exercises). The rebuild is local to
the one compilation — the original literal, its bindings, and every other
use are untouched. Annotation is the already-plumbed channel: the body
scope declares the param with the declared type, the tuple-equality
carve-out and every type-reading gate see it, and `withEnforcedParams`
picks it up (a destructuring assign onto the now-typed param declines —
correct, it matches the hand-annotated behavior).

**Where the element-of link lives.** The pairing "operand 1 is applied to
elements of operand 0" must not be a hardcoded name list (established
preference). Add a small declaration to the operator's compile-side
metadata — e.g. `callbackElementOf: { 1: 0 }` on the definitions of `Map`,
`Filter`, `CountIf`, `Find`, `IndexWhere`, `FlatMap`, `Reduce` (position 1,
first callback arg; `Reduce`'s accumulator param stays untyped in v1), so
the generic machinery derives everything else. The JS handlers all funnel
the callback through `compile(args[1])`, so the rebuild wraps that one call
site in the shared helper.

**Interaction notes.**
- The rebuilt literal is what the direct-lambda branch compiles — the
  `withEnforcedParams` wrap (landed 2026-08-08) applies to it naturally.
- `_SYS.bcastFn` runtime-dispatch shapes are unaffected: this only fires
  when the element type is statically provable.
- Python target can adopt the identical helper; GPU stays as-is (its
  callback story is separate).

**Risks.** Low. The rebuild cost is per-compilation and small (one literal).
The main correctness obligation: the rebuild must go through the full
canonicalization path (fresh body canonicalization from structure), never a
scope-graft of the already-bound body — the closure-capture rounds
established that half-rebuilt scopes are the bug factory. Acceptance tests
must include a body that captures an outer variable, to pin that the
rebuild preserves capture.

## Alternative: (C) the same re-derivation at canonicalization of the CALL

Same trigger, but performed once in the canonical form of
`Filter(points, literal)`, engine-wide. Strictly more value (interpreter
sees the types too; call-time enforcement) but strictly more blast radius:
it changes canonical forms (snapshot churn), interacts with inference
retraction (a *declared* collection type is stable; an *inferred* one can
retract, leaving a stale annotation), and turns some today-working dynamic
programs into type errors. Not recommended for v1; B's helper is reusable
if C is ever wanted.

## Long-term: (D) genericized library signatures

The principled home is `Filter: (collection<T>, (T) -> boolean) -> …` with
the existing type-variable machinery (v1 shipped 2026-08-04) instantiating
`T` per call. That subsumes B — but it re-types a large slice of the
library and its inference/validation behavior wholesale. Recorded as the
direction; not this change.

## Open questions (need rulings)

1. **Scope of operators in v1** — the seven listed above, or start with
   `Map`/`Filter` only?
2. **`Reduce`'s accumulator** — leave untyped in v1 (recommended; its type
   is the init operand's, a second channel), or thread both?
3. **Named single-use literals** — a `let f = pt |-> …` used exactly once:
   v1 treats any symbol-valued callback as shared (no rebuild). Acceptable?

## Acceptance

- `Filter(points, pt |-> pt == (0, 0))` with `points: list<tuple<number,
  number>>` compiles on JS; `run()` parity with the interpreter on hit and
  miss elements.
- A capturing body (`pt |-> pt == (0, k)` with outer `k`) compiles and
  captures correctly.
- A SHARED named lambda used over two different-element collections keeps
  today's behavior on both (no cross-contamination) — the sharing pin.
- `Filter(xs, f)` where `xs`'s element type is unknown: byte-identical
  codegen to today.
- Full suite, zero snapshot churn (B touches no canonical forms).
