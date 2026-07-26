# Overload resolution for intersection signatures

Status: **implemented 2026-07-25** (§5 partially — see §9)
Date: 2026-07-25
Related: `docs/plans/2026-07-25-random-signature-redesign.md`

Implementation: `src/compute-engine/boxed-expression/overload.ts`, wired into
`validate.ts` (validation + inference) and `boxed-function.ts` (result typing).
Tests: `test/compute-engine/overload-resolution.test.ts`.

## 1. Problem

The type grammar accepts an intersection of function signatures:

```
((number?) -> finite_real) &
((set<real>, number?) -> real) &
((collection, number?) -> any)
```

This is the standard encoding of an **overload set**: the value inhabits all
three types simultaneously, i.e. it is callable at each of them. (A union would
be wrong — it says the value is callable at *one* of the three but not which,
so a call site could only rely on the meet of the parameters and the join of
the results.)

The grammar accepts it, but nothing downstream implements it. Every consumer
tests `kind === 'signature'` and bails on anything else:

| Site | Current behavior on an intersection |
| --- | --- |
| `boxed-expression/validate.ts:577` | `return null` — **no** arity or argument-type checking |
| `common/type/utils.ts:22-38` (`functionSignature`/`functionResult`) | `undefined` |
| `boxed-expression/boxed-function.ts:2391,2677` | result type falls back to `unknown` |
| `boxed-expression/boxed-operator-definition.ts:109` (`signatureAllParamsNumeric`) | `false` |
| `boxed-expression/box.ts:626` | `false` |
| `compilation/base-compiler.ts:3349` | bails |
| `function-utils.ts:451` | `undefined` |

Observed with `ce.declare('Rnd', { signature: sig, evaluate: … })`:

```
Rnd()          => type: unknown | valid: true
Rnd(5, 2)      => type: unknown | valid: true
Rnd("x")       => type: unknown | valid: true      ← should be incompatible-type
Rnd(1, 2, 3)   => type: unknown | valid: true      ← should be unexpected-argument
```

No operator in the library currently declares an intersection signature, so
this is an unimplemented feature, not a regression.

## 2. Prerequisites (separate, already-scoped bug fixes)

Overload resolution cannot be built on the current type algebra. Two defects
must land first:

1. **Serializer precedence** (`common/type/serialize.ts`). `SIGNATURE_PRECEDENCE`
   was ranked tightest-binding, but in the grammar `->` binds *loosest* — a
   signature's result type is parsed with `parseUnionType()`, so it absorbs any
   following `&`/`|`. Signature arms therefore lost their parentheses and
   re-parsed into a structurally different type that serialized to the *same
   string*. Any serialize/reparse silently destroyed the overload set.

2. **`isSubtype` quantifier for an intersection LHS** (`common/type/subtype.ts`).
   The composite-rhs branch used `.every(…)` where the primitive-rhs branch
   correctly uses `.some(…)`. `A & B <: R` holds when *any* arm is a subtype, so
   an overload set was not a subtype of its own members — which also breaks
   `inferredSignature` reconciliation in
   `boxed-operator-definition.ts:297`.

## 3. Resolution rule: most-specific-wins

Given an intersection of signature arms and the concrete operands of an
application:

1. **Filter by arity.** Drop arms that cannot accept `ops.length` arguments
   (accounting for `optArgs`, `variadicArg`, `variadicMin`).
2. **Filter by operand type.** Drop arms where some operand fails the
   per-parameter admissibility check. Reuse the checks already in
   `validateArguments` (including the `broadcastable` lift, the
   strip-before-validate missing-value gate, and overlap-deferred validation for
   collection parameters) so an arm is admitted under exactly the same rules a
   standalone signature would be.
3. **Rank the survivors by specificity.** Arm `A` is more specific than arm `B`
   when, for every position `i`, `isSubtype(A.param[i], B.param[i])`, and not
   conversely. This is a partial order, computed with the existing `isSubtype`.
4. **Tie-break by declaration order.** For incomparable arms (neither more
   specific), the earlier-declared arm wins. Authors are therefore expected to
   order arms most-specific-first, and the ranking makes that ordering
   robust rather than load-bearing.
5. **No survivor** → error. The diagnostic must name all arms, not just the
   last one tried, so `Rnd("x")` reports the whole overload set rather than an
   arbitrary arm's `incompatible-type`.

Worked example for the signature in §1: `Rnd(Interval(0,1), 5)`. `Interval(0,1)`
types as `set<real>`, and `set<real> <: collection` is true, so arms 2 and 3
both survive steps 1-2. Step 3 ranks arm 2 above arm 3 (`set<real> <: collection`,
not conversely), so the result type is `real` rather than `any`. Arm 1 is
disjoint (`number` is not a `collection`) and drops at step 2.

## 4. Inference under ambiguity — RATIFIED 2026-07-25

`validateArguments` does not only check — it **infers**. With an overload set
there may be no single `param` to infer against: an unknown-typed operand keeps
several arms viable.

### 4.1 Three facts the rule has to respect

**Inference happens at two sites, which behave differently under overloads.**

- *In-loop narrowing* (`validate.ts:640`, `747`, `816`): `op.infer(param,
  'narrow')` fires **during** the parameter walk, for a symbol whose type was
  inferred (not declared) when `param <: op.type`. It mutates symbol
  definitions as a side effect of merely *trying* a parameter list.
- *Post-validation inference* (`validate.ts:874-893`): `finalOps[i].infer(param)`
  fires only once `isValid`, for each position not in `deferredIdx`. This is
  the one that turns an unknown-typed symbol into the parameter type.

**An unknown-typed operand never refutes an arm.** `validate.ts:621-626` (and
`726`, `798`) wave through `isUnknown`/`any` unconditionally. So ambiguity is
never "the unknown operand selected the wrong arm" — it is "the unknown operand
eliminated nothing," and every arm surviving on the *other* positions stays
viable.

**`deferredIdx` (`validate.ts:589-594`) is the existing admit-but-don't-infer
precedent**, with the principle already stated there: acceptance is an
unrefuted possibility, not a proof.

### 4.2 Precondition: resolution must be a pure pre-pass

This holds regardless of the inference rule. Implementing resolution as "run
each arm through `validateArguments`, take the first that succeeds" would let
the in-loop `infer(…, 'narrow')` at `:640` mutate symbol types on arms that are
subsequently **rejected**. Arm filtering must use only `matches`/`isSubtype`
and perform no writes; `validateArguments` then runs once, on the winner.

### 4.3 The rule: infer the JOIN of the surviving arms' parameters

At each position, infer `widen(…survivingArms.map(arm => arm.param[i]))`.

A call is well-typed iff the operand fits *some* surviving arm, so the set of
admissible values at a position is exactly the union of those arms' parameters
there. Constraining the symbol to that union is precisely the information the
call carries — no more, no less. Where the join comes out `unknown`, `infer` is
already a documented no-op (`boxed-symbol.ts:433`) and the position falls back
to `deferredIdx` behavior.

`widen` performs the useful absorptions rather than collapsing to `any`:

```
widen(set<real>, collection)          → collection
widen(number, set<real>, collection)  → collection | number | set<real>
narrow('unknown', collection)         → collection
```

Worked example, `Random(x, y)` with both operands unknown. Arity kills arm 1
(it accepts at most one argument); arms 2 and 3 survive. Position 0 joins
`set<real>` and `collection` to **`collection`**; position 1 is `number` in
both arms, so it joins to **`number`**. Both operands are inferred correctly
even though the arm choice is ambiguous.

`Random(x)` with unknown `x` keeps all three arms and yields
`collection | number | set<real>` — still useful, since it refutes a later
`x := "abc"`.

Note this subsumes the narrower "infer only where the arms agree at that
position" variant: when the arms agree, the join *is* the shared parameter.

### 4.4 Rejected: skip inference entirely when ambiguous

Sound and minimal — add the position to `deferredIdx` and move on — but it
silently under-infers. Rejected because §4.3 is equally sound, needs no new type
machinery, and degrades to exactly this behavior when the join is
uninformative. Recorded here because it was the original proposal, chosen on
the mistaken assumption that the join would collapse to `any`.

Also rejected: **deferring resolution to evaluate time** (most precise, but
`validateArguments` and the whole `isValid`/error-marker contract are
canonicalization-time — disproportionate), and **erroring when more than one arm
survives** (`f(x)` with a fresh `x` is the normal case in this engine).

### 4.5 TRAP: never infer the meet, or the most-specific candidate

Because resolution is most-specific-wins, it is tempting to narrow the operand
to the most specific surviving parameter — `set<real>` in the `Random(x)` case.
That is **unsound**: it assumes arm 2 was selected, and if `x` later proves to
be a list, arm 3 accepts it while the symbol has already been over-constrained.
Inference constraints must be *weaker or equal* to the truth, which is exactly
why the join is safe and the meet is not.

### 4.6 Known approximation

The join is computed per position, independently, so it is a coordinate-wise
relaxation: it can admit operand *combinations* that no single arm accepts.
With arms `(number, string) -> a` and `(string, number) -> b`, both positions
join to `number | string`, permitting `x: number, y: number`. This is
imprecision, not unsoundness — the constraint is weaker than the truth, which
is the safe direction — and it is the same class of approximation already
documented in `overlapsForDeferredValidation` (`common/type/utils.ts:480-486`).

## 5. Consumers without operands

`functionResult` has two kinds of caller. *Application* sites ask "what does
THIS CALL return" and have operands in hand — `boxed-function.ts:2391` and
`:2677`, handled by §6. The remaining ~15 ask "what does this function-typed
VALUE return when applied" (`Map`'s mapper, `Reduce`'s reducer, `Apply`,
`EvaluateAt`, …). There is no call to resolve, so no arm can be selected and
`functionResult` returns `undefined`.

**Measured 2026-07-25 — most of these sites are unaffected.** The function
operand reaches those handlers typed `unknown` anyway (held/lazy operands), so
`functionResult` already returns `undefined` for a PLAIN signature too:

```
Reduce([1,2,3], f)    single sig → unknown    overload → unknown
Map([1,2,3], f)       single sig → vector<…>  overload → vector<…>
EvaluateAt(f, 1, 2)   single sig → number     overload → number
```

`Apply` needs nothing either: its `canonical` handler rewrites `Apply(f, 3)`
into a direct application, which goes through the §6 path and resolves
correctly (`→ string` for an `((integer) -> integer) & ((string) -> string)`
`f`).

Two sites DO differ, and are the real content of this section:

1. **`assume.ts:1036` threw.** It read
   `isSubtype(type, functionResult(def.operator.signature.type)!)` — the `!`
   was a lie, and for an overload set `isSubtype` dereferenced `undefined`:

   ```
   ce.declare('Rnd', {signature: '((integer) -> integer) & ((string) -> string)', …});
   ce.assume(['Element', 'Rnd', 'Integers']);
   → TypeError: Cannot read properties of undefined (reading 'kind')
   ```

   Unreachable before this feature (an overload signature was inert), reachable
   after. **Fixed 2026-07-25**: undeterminable is not a proven contradiction,
   so the operator-def branch returns `'ok'` when the result type is unknown.

2. **`engine-declarations.ts:978` silently drops the declaration.** The
   `declaredResult === undefined` early return skips the function-literal
   return-type ascription:

   ```
   declare f : (integer) -> integer                    ; f := (x) -> x+1  ⟹  (integer) -> integer
   declare f : ((integer) -> integer) & ((string) -> string) ; f := (x) -> x+1  ⟹  (unknown) -> number
   ```

   Still open. Fixing it needs a decision about what ascribing against a
   multi-arm declaration even means (which arm's result?), which is the same
   selected-vs-join tension as §4.3 but with no operands to resolve it.

### 5.1 Resolution — the type helpers now handle algebraic types

Rather than special-case the two sites, the three `common/type/utils.ts`
helpers were made algebraic-type-aware (2026-07-25). A shared
`signatureArms(t)` returns `[t]` for a plain signature and every member of a
union or intersection whose members are ALL signatures (`undefined` for a mixed
type such as `((number) -> real) & list<boolean>`, which is not reliably
callable).

**`functionResult`** is the **join** (`widen`) of the arms' results — never the
meet. For `((integer) -> integer) & ((string) -> string)`, `f(3)` is an
`integer` and `f("a")` is a `string`, so an application whose argument is
unknown yields `integer | string`; the meet would be the empty
`integer & string`. Narrowing is sound only when every arm shares a domain — a
special case not worth encoding, and the join stays sound there, merely less
precise. **When the arguments ARE known, do not use this**: resolve the
overload and read the selected arm's result (§6).

A union of signatures joins for a different reason: the value is one of those
functions without saying which, so a call returns something in the union of
their results. (A union is nonetheless NOT an overload set — `overloadArms`
still accepts only intersections, because a call site can rely on no single arm
of a union.)

**`functionResult('function')` is now `unknown`, not `any`.** The bare
`function` type carries no information about its result. `unknown` is this
system's "not known" signal — `infer()` treats inferring `unknown` as a no-op
(`boxed-symbol.ts`), whereas `any` is written into a definition as a positive
claim. It was also self-contradictory: `functionSignature('function')`
synthesized `(any*) -> unknown`, whose result is `unknown`, while
`functionResult('function')` answered `any`. One test pinned the old
rendering — `[h(x)]` for undeclared `h` now types `list<unknown>` rather than
`list<any>`; every subtyping answer is identical (neither is a subtype of
`list<number>` or `vector<1>`, both are subtypes of `collection`) and §D3 of
the tensor design treats `unknown`/`any` as interchangeable for the fold and
the shape claim.

**`functionSignature` → `hasFunctionSignature`.** Every caller only asked
`!== undefined`; returning a value forced it to synthesize `(any*) -> unknown`
for the bare `function` type, which `assertFunctionLiteralArity` then had to
special-case back out. It is now a predicate, true for `function`, a signature,
or a union/intersection of signatures.

**`functionArity` moved to `common/type/utils.ts`** (it was private in
`library/collections.ts`, the one caller that wanted `functionSignature`'s
value) and takes a `Type` rather than an `Expression`. For a union or
intersection every arm must be fixed-arity AND agree — a caller keying behavior
off the arity (`Sort`'s unary-key vs. binary-comparator dispatch) must not
guess which arm applies.

Consequence for §5 item 2: the overload declaration now DOES constrain a
function-literal assignment. `declare f : ((integer) -> integer) & ((string) ->
string)` followed by `f := (x) -> x+1` is rejected —
`(unknown) -> integer | string` is not a subtype of the intersection — instead
of silently storing `(unknown) -> number`. Rejection is correct: one lambda
cannot implement both arms.

`signatureAllParamsNumeric` (`box.ts:626`, `boxed-operator-definition.ts:109`)
and the compiler (`base-compiler.ts:3349`) still bail on an intersection, but
by accident of the `kind !== 'signature'` guard rather than by decision. Making
that explicit remains open.

`signatureAllParamsNumeric` (`box.ts:626`, `boxed-operator-definition.ts:109`)
and the compiler (`base-compiler.ts:3349`) should keep bailing on an
intersection, but **explicitly** — today they return `false` by accident of the
`kind !== 'signature'` guard rather than by decision.

## 6. Shape of the change

New file, `common/type/overload.ts` (or alongside `utils.ts`). Per §4.2 the
resolver must be **write-free**, and it must return the *whole* surviving set,
not just the winner — §4.3 needs the survivors to compute the per-position
join:

```ts
resolveOverload(sig: Type, ops: ReadonlyArray<Expression>): {
  /** Most-specific survivor; `undefined` when no arm fits. */
  selected: FunctionSignature | undefined;
  /** Every arm that survived arity + type filtering, in declaration order. */
  viable: ReadonlyArray<FunctionSignature>;
}
```

Insertion points:

- `validate.ts:577` — resolve, then run the existing validation body against
  `selected`; emit the multi-arm error when nothing fits. The post-validation
  inference loop (`:874-893`) takes its per-position type from
  `widen(…viable.map(a => a.param[i]))` rather than from `selected` — with a
  single viable arm that is definitionally the same value, so the
  single-signature path is unchanged.
- `boxed-function.ts:2391` and `:2677` — both already have `expr.ops` in scope,
  so `functionResult(resolveOverload(sig, ops).selected ?? sig)`. Note the
  result type comes from `selected` (most-specific-wins), **not** from a join
  over `viable` — §4.3's join governs *inference into operands*, which must be
  weakened, whereas a result type is read out of the chosen arm.

Estimated ~150 lines for the resolver plus the insertion points; the bulk of
the work is §5 and tests.

## 7. Test coverage

There is currently **no** test coverage for intersection signatures anywhere in
`test/`. A new suite is needed:

- type-level: serializer round-trip for signatures nested in unions,
  intersections and negations; `isSubtype` of an overload set against each arm.
- resolution: arity filtering, overlapping arms (the `set<real>` / `collection`
  case), disjoint arms, no-arm-fits diagnostics, declaration-order tie-break.
- inference (§4.3): `Random(x, y)` with both unknown infers `x: collection`
  (join of `set<real>` and `collection`) and `y: number` (both arms agree);
  `Random(x)` infers `collection | number | set<real>`. A single viable arm
  must infer exactly the arm's parameter, i.e. be byte-identical to today's
  single-signature behavior.
- inference TRAPS: assert `x` is **not** narrowed to `set<real>` in the
  `Random(x)` case (§4.5 — the meet is unsound), and cover the §4.6
  coordinate-wise relaxation with the `(number, string)` / `(string, number)`
  pair so the known imprecision is pinned rather than discovered later.
- write-freedom (§4.2): a call whose resolution rejects an arm that *would*
  have narrowed a symbol must leave that symbol's type untouched — the
  regression test for trial-validation side effects.
- route parity: `ce.function(…)`, `ce.box(…)` and `ce.parse(…)` all reach the
  resolver (per the lazy-operator route-parity convention).

## 8. Relationship to `Random`

**This feature is a declared dependency of a ratified spec, not an optional
enhancement.** `docs/plans/2026-07-25-random-signature-redesign.md` is marked
"design ratified 2026-07-25; revised after dual spec review", and its §9 item 2
names overload-set signature support as the top-of-file dependency, assumed
throughout.

That spec also already evaluated — and deliberately down-ranked — the
union-parameter fallback (`'((number | collection | set<real>)?, number?) ->
any'` plus an explicit `canonical` check rejecting two bare numbers). It
records the fallback as "strictly worse and should not be adopted silently".

So the ordering is: build this, then land `Random` on the three-arm signature
as its spec assumes. The fallback is for the case where this workstream slips,
and adopting it is a decision to be taken explicitly, not a default.

Note the arm-1 correction from §3: every arm in the original draft had a
**required** first parameter, so `Random()` matched none. Arm 1 must be
`(number?) -> finite_real`.

## 9. What landed, and what deliberately did not

Landed 2026-07-25:

- `boxed-expression/overload.ts` — `overloadArms`, `paramAt`,
  `resolveOverload`, `joinParamAt`, `diagnoseNoMatch`. Write-free throughout
  (§4.2).
- `validate.ts` — resolves an intersection signature to its most-specific arm
  and validates against it; the non-strict fastpath pads to the SMALLEST
  required count across arms (padding to the largest would manufacture
  `Error("missing")` operands for a well-formed call to a shorter arm); the
  post-validation inference loops take their type from `joinParamAt` (§4.3).
- `boxed-function.ts` — both result-type sites read off the selected arm.
- `broadcastableBaseMatches` moved from `validate.ts` to `common/type/utils.ts`
  so the resolver can share the exact admission rule without importing
  `validate.ts` — which would close a cycle, since `validate.ts` imports the
  resolver. Zero cycles confirmed by madge.

Verified behavior (three-arm `Random` signature):

| Call | Result | Note |
| --- | --- | --- |
| `Rnd()` | `finite_real` | arity selects arm 1 |
| `Rnd(5)` | `finite_real` | `number` disjoint from the other arms |
| `Rnd(Interval(0,1))` | `real` | arms 2 **and** 3 fit; most-specific wins |
| `Rnd([1,2,3])` | `any` | only arm 3 fits |
| `Rnd("x")` | error, expected `collection \| number \| set<real>` | |
| `Rnd([1,2,3], "x")` | error on operand **1 only** | operand 0 left untouched |
| `Rnd(1,2,3)` | `unexpected-argument` on operand 2 | not a type error |

Also landed: the **`assume.ts:1036` crash fix** (§5 item 1) — a reachable
TypeError that this feature exposed, since an overload signature was inert
before it.

Then §5.1: the `common/type/utils.ts` helpers were made algebraic-type-aware
rather than patching the two affected sites — `signatureArms` (new, shared),
`functionResult` (joins the arms; `function` → `unknown` not `any`),
`hasFunctionSignature` (replaces `functionSignature`), and `functionArity`
(moved from `library/collections.ts`, now `Type`-taking and arm-aware). That
also resolved §5 item 2: an overload declaration now constrains a
function-literal assignment instead of silently dropping the declared
signature. One test rendering changed (`list<any>` → `list<unknown>`); the full
suite is otherwise byte-identical to baseline.

Still open: `signatureAllParamsNumeric` (`box.ts:626`,
`boxed-operator-definition.ts:109`) and `base-compiler.ts:3349` bail on an
intersection by accident of a `kind !== 'signature'` guard rather than by
decision.

## 10. Review round (2026-07-25)

A dual review (Claude + Codex) of the staged change found 9 issues; all were
fixed. Four shared one root cause worth recording, because it is the standing
hazard for anyone extending this code:

> The overload path was built as a **parallel route beside the single-signature
> one**, and matched to it by hand. Every place the original route enforces
> something, the new route had to re-derive it — and four of them didn't.

The four:

1. **Blame was computed per COLUMN, not per ARM.** "Blame position `i` when no
   arm admits it" is not the negation of "one arm admits every position". Arms
   that cross-satisfy a call (`((boolean, integer) -> …) & ((integer, boolean)
   -> …)` called with `(true, true)`) left `refuted` empty, so a call no arm
   accepts came back with every operand intact — and `isValid` is purely
   structural, so it was reported **valid**. `diagnoseNoMatch` now scores each
   arm by how many positions it refutes, keeps the nearest misses, and blames
   the union of their refuted positions; that set is never empty, since no arm
   fit. A backstop assertion in `validate.ts` states the invariant directly.
2. **The arity branch bracketed by global min/max**, so a GAP in the accepted
   set slipped through: arms of arity 1 and 3 called with 2 arguments sat
   inside `[min, max]` and got no marker. It now targets the *nearest* accepted
   count.
3. **`box.ts` gated the value-definition application path on `kind ===
   'signature'`**, so an overload-typed *value* definition skipped validation
   entirely — `h(true)` and `h(1,2,3)` were both valid.
4. **`assertFunctionLiteralArity` early-returned for anything but one plain
   signature**, so §5.1's `hasFunctionSignature` change opened the gate without
   the check behind it running: a 2-parameter literal was accepted against
   two 1-argument arms, and every declared call would have partial-applied.

Three more concerned **filter fidelity**. `operandAdmits` had been written as a
deliberate over-approximation on the reasoning that "permissive is safe". That
reasoning is wrong, and the corrected rule is now stated in the code: admitting
too little drops an arm full validation would accept, but admitting too much
keeps a bad arm in the running for **selection**, and a wrongly selected arm is
then rejected by full validation even though another arm would have validated.
So the filter now mirrors `validateArguments` exactly in both directions — the
caller's `stripMissing` policy and the `inferredSignature` gate's
`matches(param)` conjunct are threaded through rather than approximated.

That also **retired the "known frontier" deferral this document previously
carried** about `repairFreshMatrixInference`. The review challenged it as the
author excusing in-scope work, correctly: the repair's entry gates are pure, so
they factored cleanly into a write-free `couldRepairFreshMatrixInference`
precondition that the filter consults. An arm kept on a repair that then fails
is handed to full validation, which produces the error — exactly as for a plain
signature.

Finally, `couldBeCollectionOperand` moved from `validate.ts` to
`collection-utils.ts`, beside the sibling COULD-semantics predicates, so
validation, resolution and result typing share ONE definition — and
`resolvedArm` now resolves with the same `lazy`/`threadable` policies
validation uses, so the result type cannot come from a different arm than the
one the call was validated against.

Still open, unchanged: `signatureAllParamsNumeric` (`box.ts`,
`boxed-operator-definition.ts`) and `base-compiler.ts` bail on an intersection
by accident of a `kind !== 'signature'` guard rather than by decision.
