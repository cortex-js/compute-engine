# Element-type inference for callback lambda parameters

**Status: RATIFIED 2026-08-08 — Option C chosen (per-application
re-derivation at canonicalization of the call), generalized with a
signature-driven trigger. See "Rulings" below. Implementation started
2026-08-08.**

2026-08-08. Follow-on to the 2026-08-07/08 compile-soundness rounds and the
forward-ref re-derivation
(`docs/plans/2026-08-07-forward-ref-inference-rederivation.md`).

## Rulings (maintainer, 2026-08-08)

The motivating goal shifted the choice from (B) to (C): the value sought is
interpreter-visible inference — and specifically what the mechanism offers
**user-defined functions**, not just the standard operators. Three rulings:

1. **Trigger = signature-driven core + builtin metadata.** The core
   mechanism triggers on ANY callee — user-defined included — whose
   signature declares a concrete function-typed parameter (an arrow type
   with concrete parameter types): an inline `Function` literal at that
   position is rebuilt with its parameter annotated. The
   `callbackElementOf` metadata exists only for builtins, whose callback
   slots deliberately stay primitive `function` (generics-v1 pinned
   ruling, `collection-callback-signatures.test.ts`); for those, the
   element-of link supplies the type the signature cannot. When (D) lands,
   the solver's `T` instantiation becomes a third trigger into the same
   rebuild helper. (Review round: the trigger covers required, OPTIONAL,
   and VARIADIC parameter positions — resolved per operand index with
   `paramAt`'s consumption order — and a POLYMORPHIC callee signature
   (non-empty `typeParams`) is skipped entirely: stamping an open type
   variable is unsound, and generic instantiation is (D)'s job.)
2. **Strictness = annotation-as-contract.** The rebuilt literal behaves
   exactly like the hand-annotated spelling, loud errors included: a
   heterogeneous list that today runs dynamically errors at the mismatching
   element, and a retracted inferred collection type surfaces as a mismatch
   error rather than silently widening. This settles the retraction
   question, and (D) inherits the same semantics.
3. **Builtin scope v1 = `Map` + `Filter` only.** Prove the mechanism and
   measure the snapshot blast radius on the two highest-traffic operators;
   extending the metadata is mechanical afterwards.

4. **Builtin trigger fires on COMPOSITE element types only** (ruled
   2026-08-08 after the first implementation round surfaced the fallout).
   The `callbackElementOf` trigger annotates only when the provable element
   type is a structured/composite type — a tuple or a collection kind —
   never a scalar primitive and never a union. Rationale, from the
   measured full-suite run: (a) an annotated parameter falls out of the
   Map fusion / exact-compile fast paths (`map-broadcast-shape.ts` gates
   on bare symbols), so scalar-element annotation turned the most common
   `Map` spelling into a perf regression (13 test failures); (b) a UNION
   element type poisons the whole application with a static type error at
   canonicalization — not the intended "error at the mismatching element"
   — breaking the published Epsil "errors are values" examples. The
   motivating point-predicate case (`list<tuple<number, number>>`) is
   fully served. Follow-up track (complementary, in order): teach the
   fusion/exact-compile gate to accept an annotated parameter that matches
   the element type, THEN widen the trigger to scalar element types.
   Union admission stays out until per-element error semantics exist for
   this route. The signature-driven trigger is NOT narrowed — a
   user-declared arrow param is an explicit contract, whatever its types.

   *Union exclusion RULED PERMANENT (2026-08-10, on the design
   exploration's evidence).* The ruled per-element union semantics —
   "each element evaluates under its arm; a mismatch errors at that
   element only" — is what the UNANNOTATED path already computes:
   interpretation is value-directed, so the arm an element satisfies is
   its value, and evaluation under it is ordinary evaluation (the
   flagship `[4, 2i, NaN, 9]` output requires the string element to
   evaluate DYNAMICALLY — no static arm machinery can produce that NaN).
   A union stamped from the source's own element type is vacuously
   unviolatable on every reachable path, so admission buys only a
   displayed signature, at the price of either the published
   errors-are-values output (strict stamping), a second annotation kind
   that breaks hand-annotation equivalence and serialization round-trip
   (loose stamping), or per-arm canonicalization the flagship example
   itself refutes. Demand is negative: the only union-element callback in
   the corpus exists BECAUSE unions decline, and hand-written union
   annotations are served by the signature-driven trigger. If demand ever
   materializes, the only viable shape is a distinct MEMBERSHIP-ONLY
   annotation: body scope stays inferred-`unknown`, enforcement solely at
   the per-application validation (`function-utils.ts` step 4b),
   invisible to `assertCallbackAnnotations`, erased on `toMathJson()` —
   plus four sub-rulings (annotation kind; serialization erasure; compile
   invisibility; hand-written unions keep strict semantics). Key
   mechanism fact for future readers: the broadcastable-param route
   avoids body poison via `Apply(callee, _1)` INDIRECTION — the callee's
   body is opaque to the synthetic wrapper — while this trigger stamps
   the user's own body, which is exactly why unions poison here.

   *Follow-up (1) DONE 2026-08-09*: `lowerLevel`
   (`map-broadcast-shape.ts`) accepts a `Typed` parameter when the level
   source's element type is a provable SUBTYPE of the annotation, then
   treats it as bare downstream — enforcement is provably a no-op, so the
   fused per-element bypass is unobservable. Narrowing/unprovable
   annotations decline as before (the loud error survives). The fusion and
   exact-proof memos re-ask the admission when it was type-sensitive
   (without this, a retracting inferred source type kept a stale fused
   spine — a silent enforcement bypass, found and pinned). The feared
   plain-`%` Mod emission branch is NOT reachable via annotations
   (`isNonNegative` has no type-level source; pinned by probe tests in
   both map suites).

   *Follow-up (2) DONE 2026-08-09*: the builtin trigger's admission gate
   (`admissibleElementType`, née `isCompositeElementType`, box.ts) now also
   admits scalar primitive element types. Still excluded: unions (one
   annotation cannot express per-element errors — the "errors are values"
   breakage), `unknown`/`any` (no positive evidence), and `never` (an
   empty collection's element type — stamping it would make `Filter([],…)`
   a canonicalization-time type error). Bounded numeric type nodes
   (`integer<1..10>`) and value-literal types still decline — widening is
   a one-line switch addition if wanted. Blast radius, measured: one
   inline snapshot in `collections.test.ts`, strictly more precise.

   *Adversarial review round (2026-08-09), post-widening.* Four
   independent attack agents; five confirmed findings, all fixed:
   nominal-type erasure in the fusion admission proof (subtype check now
   runs on unresolved types); Error-element laundering to NaN through
   fused levels (fused runner now bubbles Error elements, matching the
   unfused invoke path); the primitive admission was too wide — now a
   concrete whitelist (`NUMERIC_TYPES` + `boolean` + `string`; abstract
   supertypes `scalar`/`value`/`expression`/`symbol`/`missing` decline);
   `at()`-route re-ask storms (admission revalidates against the recorded
   source element type instead of re-deriving per access); Filter and its
   predicate siblings surface an Error-valued predicate result per
   element instead of a spell-check message. One exposure RATIFIED as-is
   by the maintainer (2026-08-09): a RETAINED lazy expression keeps its
   inferred parameter annotation, so re-evaluating it after the source
   retracts to a wider element type errors per-element — identical to
   hand-annotation; fresh canonicalizations re-infer. The same ruling
   covers string-element collections with numeric bodies poisoning at
   canonicalization instead of staying symbolic.

   *Follow-ups (4) and (5) DONE 2026-08-09*: the metadata shape was
   generalized and the coverage extended past `Map`/`Filter`.

   **Shape.** `callbackElementOf` maps a CALLBACK operand to the sources of
   its PARAMETERS (`CallbackElementLinks` / `CallbackElementSources`,
   `types-definitions.ts`). A key is the callback's 0-based operand index, or
   `'last'` — the callback-last spelling of a variadic operator. A value is
   one of: a bare NUMBER (shorthand: a single-parameter callback fed by that
   operand), an ARRAY of one operand index — or `null`, "no source, stays
   bare" — per parameter in order, or `'preceding'` (parameter *k* ← operand
   *k*, over every operand before the callback). Each parameter is an
   INDEPENDENT contract: a callback can come out partly stamped, and every v1
   guard (inline literal only, no overwrite of an author's annotation, symbol
   callbacks untouched, `admissibleElementType`) applies unchanged per
   parameter.

   **Coverage.** `Map` `{ last: 'preceding' }` — this is what unblocks the
   multi-collection `Map(xs, ys, f)` form, whose v1 exclusion below is now
   superseded; `Filter`, `CountIf`, `Find`, `IndexWhere`, `Position`, `Any`,
   `All`, `FlatMap` `{ 1: 0 }`; `Scan` `{ 1: [null, 0] }` (the reducer's
   accumulator has no source). `Fold`, `TakeWhile`, `DropWhile` and
   `Partition` have the same shapes and are the obvious next increment; they
   were left out of this round's authorized scope.

   The rewrite now also runs on the STRICT canonicalization path, not only
   the lazy one: `CountIf`/`Find`/`IndexWhere`/`Position` are not `lazy`, so
   their operands canonicalize before the handler runs and the literal's raw
   structure — which the rebuild needs — would already be gone.

   **`Reduce` withheld, needs a ruling.** It has `Scan`'s reducer shape, but
   a SEEDLESS `Reduce` folds from the `Nothing` sentinel
   (`initial ??= ce.Nothing`), and apply-time validation (`makeLambda` §6.4)
   is gated on the literal carrying at least ONE annotation and then checks
   EVERY parameter — so the bare accumulator, declared `unknown`, rejects
   `nothing` (`nothing` is deliberately not a subtype of `unknown`). Stamping
   the element parameter therefore turns `Reduce(xs, (acc, n) |-> acc + n)`
   into an `incompatible-type` error (measured: it breaks the published Epsil
   program in `test/epsil/programs.test.ts`). Pre-existing — the
   hand-annotated spelling errors identically today. Two candidate fixes, both
   needing a ruling: make a BARE parameter unconstrained in that validation
   (validate against `any`, not `unknown`), or have the seedless interpreted
   fold seed with the FIRST element, as the compiled fast path and `Scan`
   already do.

   Blast radius, measured on the full suite: ZERO snapshot churn (4241
   snapshots, none changed) — stamping only adds `Typed` wrappers the
   serializers drop. The compile gate (`assertCallbackAnnotations`) needed no
   change: every newly stamped shape is provably satisfied by its source's
   element type, so it compiles unchanged on both `javascript` and `python`,
   and a narrowing/unprovable annotation still declines. The multi-collection
   `Map` has no compiled lowering on either target and none was added.

5. **The `Reduce` blocker: BOTH fixes** (ruled 2026-08-09, implemented the
   same day). The withheld `Reduce` coverage rested on two independent
   defects; the ruling was to fix both, and only then stamp.

   **Fix 1 — a BARE parameter imposes no constraint** (`makeLambda`,
   `function-utils.ts` §6.4). Apply-time validation is gated on the literal
   carrying at least ONE annotation and then validates EVERY parameter
   against the literal's signature. A bare parameter's slot there is only
   whatever inference left behind (`unknown` by default) — not a contract its
   author wrote — and `nothing` is deliberately not a subtype of `unknown`,
   so a legitimate value was rejected. For VALIDATION ONLY, a bare
   parameter's argument slot is now widened to `any`; annotated parameters
   keep their exact enforcement and the literal's reported type is unchanged.
   Applied at both validation sites (the step-3 curried PREFIX check and the
   step-4b full check); no other route validates a literal's own parameter
   types.

   *Exception, load-bearing*: the relaxation is skipped whenever the literal
   carries a WHOLE-SIGNATURE marker (§2.5). Erasure leaves a GENERIC literal
   with no annotated parameter operand at all, so every position would look
   bare and the polytype's check would silently vanish. Pinned
   (`forall T: number. (x: T, n: integer) -> T` still rejects `nothing` and a
   string).

   **Fix 2 — a seedless `Reduce` seeds with the FIRST element** and folds
   from the second, the convention `Scan` and `Reduce`'s own compiled fast
   path already implement. It used to fold from a `Nothing` SENTINEL
   (`initial ??= ce.Nothing`), which only looked right for a reducer that
   splices the marker away. Measured semantics delta on `[1, 2, 3]`:
   `Subtract` −6 → **−4** (= `Last(Scan(…))`), `Divide` over `[8, 2, 2]`
   1/32 → **2**, `Power` over `[2, 3, 2]` `Nothing^12` → **64**; `Add` is
   unchanged (6), which is why the sentinel survived this long. Empty +
   seedless keeps answering `Nothing`; a single element is its own result.

   A second, latent defect fell out: the compiled fast path was UNREACHABLE
   without an initial value — its gate tested `initial.type.matches('real')`
   on the `nothing` sentinel — even though its body was written for
   first-element seeding (`hasInitial ? initial.re : NaN`). The gate now
   skips the initial-type test when there is no initial value, so seedless
   `N(Reduce(…))` takes the compiled path like the seeded form; the empty
   case returns `Nothing` there too. Interpreted-vs-compiled parity is pinned
   on all of empty / single / non-associative
   (`collections.test.ts`, `describe('Reduce, seedless')`).

   **Coverage.** With both fixes in, `Reduce` declares
   `{ 1: [null, 0] }` (`Scan`'s shape). Extended in the same round, each
   verified against its own operand order and laziness: `Fold`
   `{ 0: [null, 2] }` — callback FIRST, collection LAST, and the rewrite runs
   before `Fold`'s canonical handler rebuilds the call as a `Reduce`, so the
   stamp survives; `TakeWhile` and `DropWhile` `{ 1: 0 }` (both lazy);
   `Partition` `{ 1: 0 }` — NOT lazy, so it uses the strict-path hook, and
   its SIZE arm is untouched because an integer operand is not an inline
   `Function` literal. This supersedes the "Reduce's accumulator is out of
   v1 (with `Reduce` itself)" default recorded below; the ACCUMULATOR itself
   stays bare, as on `Scan`.

   **Hardening pin (union round).** A HAND-annotated union callback
   (`(x: finite_integer | string) |-> …`) over a source whose element type
   provably satisfies it is ADMITTED by the compile gate
   (`assertCallbackAnnotations`, `isSubtype(union, union)`) — hand-written
   unions were never the excluded case; auto-STAMPING them is. Measured
   outcome: the admission passes and the BODY declines (a `string` arm
   reaches a numeric lowering), so `compile()` reports `success: false` on
   both targets and the interpreter evaluates. Fail-closed, no silent wrong
   values; pinned in `compile-predicate-errors.test.ts` with the note that a
   body that ever DOES compile under a union annotation must instead assert
   `run()` parity.

   Blast radius, measured on the full suite: ZERO snapshot churn.

Defaults carried from the open questions (not separately ruled):
`Reduce`'s accumulator is out of v1 (with `Reduce` itself); any
symbol-valued callback is treated as shared — no rebuild, no exceptions
for single-use `let f = …`. The (B)-specific acceptance line "zero
snapshot churn" is replaced by the standing policy: measure the blast
radius on the full suite and surface it for review before landing.

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

## v1 scope exclusions (recorded at planning, 2026-08-08)

All conservative; each is a mechanical extension later if wanted:

- **Pre-canonicalized literal operands** (`ce.function('Filter', [xs,
  canonicalLiteral])`) are not rebuilt — raw structure does not survive
  canonicalization, and re-deriving a bound body in the call-site scope is
  the closure-capture bug factory. The Epsil / `ce.box` / `ce.parse`
  routes are the ratified surface.
- **Multi-collection `Map(xs, ys, f)`** (callback last) — `{1: 0}` cannot
  express it; the discriminator declines operand 1 (a collection) and the
  form keeps today's behavior. *(Superseded by follow-up (5), 2026-08-09:
  `Map` declares `{ last: 'preceding' }` and each parameter is stamped from
  its own source.)*
- **Expected param types containing `broadcastable<T>`** are skipped: the
  2026-08-08 broadcastable-param ruling makes that a callee-side
  application contract; stamping it onto a literal would give it an
  elementwise contract its author never wrote.
- **Overload-set callees** are skipped (resolution happens after the hook
  site and the annotation itself would feed resolution — circular).
- **Shorthand callbacks** (`_ > 5`, non-`Function`-headed operands) lift
  after the hook and are not rebuilt.

## Known limit: the standalone-lambda compile route (ruled 2026-08-10)

Compiling an annotated function literal STANDALONE (`literal.compile()`,
no call site) emits a bare JS/Python function with no runtime type check,
so `run()` with a violating argument silently computes where the
interpreter's `Apply` errors. Every in-engine route is enforced (call
sites prove-or-decline via `assertCallbackAnnotations`; Map/Filter drains
and the exact tier enforce or fail closed) — this route requires feeding
violating values from the host side. Maintainer ruling: DEFERRED, with
the direction fixed as check-emission — a per-primitive runtime-check
table emitted as a prologue in the compiled function, with an explicit
"unenforceable at runtime → decline to compile" rule (e.g. nominal types,
`integer` vs `finite_integer` distinctions beyond machine
representation). Declining all annotated standalone lambdas was rejected:
with auto-stamping, that would disable standalone compilation for
essentially every lambda over a typed collection (quadrature,
`implicitCompile`, Epsil-compiled definitions).

## Acceptance

- `Filter(points, pt |-> pt == (0, 0))` with `points: list<tuple<number,
  number>>` compiles on JS; `run()` parity with the interpreter on hit and
  miss elements.
- A capturing body (`pt |-> pt == (0, k)` with outer `k`) compiles and
  captures correctly.
- A SHARED named lambda used over two different-element collections keeps
  today's behavior on both (no cross-contamination) — the sharing pin.
- A user-defined callee with a declared arrow param (`function apply2(f:
  (number) -> number, x) { f(x) }`) annotates an inline literal argument —
  Epsil and `ce.assign`/`ce.box` routes.
- `Filter(xs, f)` where `xs`'s element type is unknown: byte-identical
  canonical form and codegen to today.
- The vectorization default holds: an evidence-free scalar lambda still
  broadcasts.
- Full suite: snapshot blast radius measured and surfaced for review
  (supersedes B's "zero snapshot churn" line).
