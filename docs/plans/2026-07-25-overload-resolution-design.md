# Overload resolution for intersection signatures

Status: **draft / not implemented**
Date: 2026-07-25
Related: `docs/plans/2026-07-25-random-signature-redesign.md`

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

Roughly fifteen `functionResult` call sites (`library/collections.ts:1796`,
`1808`, `2186`, `2295`, `2626`, `4454`; `library/core.ts:484`, `702`, `738`,
`1259`; `library/calculus.ts:591`; `assume.ts:1036`;
`engine-declarations.ts:978`, `988`; `boxed-operator-definition.ts:420`) ask
"what does this function *argument* return" — e.g. `Map`'s mapper. No operands
are available, so no arm can be selected.

Fallback: `widen(…arms.map(result))`. For the §1 signature that comes out as
`any` — but only because the third arm's *result* is literally `any`, not
because `widen` is lossy (`widen('finite_real', 'real')` is `real`; see the
absorptions in §4.3). Sound but imprecise here; acceptable, since these sites
already fall back to `'unknown'`/`'any'` today.

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
