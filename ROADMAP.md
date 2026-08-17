# Compute Engine — Roadmap

**Last updated:** 2026-08-15.

This document tracks **remaining** work; an item leaves this file once it lands.
Detail on completed work lives in git history, `CHANGELOG.md`, the linked source
files, and `docs/rubi/RUBI.md` / `docs/fungrim/`.

## Current state

The 2026-06 release shipped:

- the Fungrim-derived identities library
  (`@cortex-js/compute-engine/identities`, 1,450 rules incl. 10 solve
  templates), the
  complex-domain assumptions extension, the operator-indexed rule dispatcher
  with purpose tags, `ce.solveRules`/`ce.harmonizationRules`, and exact `Zeta`;
- the Rubi rule driver as an opt-in entry point
  (`@cortex-js/compute-engine/integration-rules`, `loadIntegrationRules(ce)`),
  consulted by `Integrate` before the built-in antiderivative;
- a large symbolic-capability expansion — symbolic/improper integration,
  symbolic limits, expanded `Solve`, polynomial `Factor`/`GCD`/`Resultant`,
  multivariate GCD (Brown) — surfaced by the cross-library benchmark (items
  B1–B13);
- a substantial bignum/numeric performance pass (item 17): base-2 internal
  kernels, AGM `ln`, faster `sqrt`/`Gamma`, on-demand π and γ.

**MathNet parser hardening (2026-07-04):** all four tiers of
`docs/mathnet/parser-hardening-plan.md` landed and are test-locked
(`ContinuationPlaceholder` crash, ellipsis/trailing-punctuation recovery,
Unicode relation tokens, congruence/divisibility, geometry heads; corpus
clean-parse 3/345 → 278/345, throws 9 → 0). Fresh unseen-sample validation
measured 97.4% clean parse with 0 throws/0 hangs; the remaining MathNet work
is a small notation tail tracked below.

**0.110.0 released 2026-08-15** (latest). The 0.97–0.110 line carried the
Tycho-compatibility rounds through items 177–190 (the canonicalization-time
facet-probe storm and its document-context survivor, the `Add` collection-view
nesting fix, `broadcastable` divide admission, opt-in `complexPromotion`),
compile-time constant folding on a deterministic cost estimate, named-argument
calls, protocols with compiled dispatch, mutable objects phases 0–1, the
`unknown`-as-placeholder ruling, the default-`!scope` ceiling, and the Epsil
parameter-shadowing repair. **0.96.0** (2026-07-26) carried the **symbol-identity
repair** — a stored value's free symbols now denote the binding they were
canonicalized against, not whatever an inner scope calls that name, with
dereference (`evaluateInOwnBindings`), named-parameter rebind, and the
sanctioned **binder mechanism** (binding sites declared by a `scoped:`
selector; see `docs/plans/2026-07-26-binder-mechanism-design.md`) — plus
all-branch union assignability, the peaked-quadrature and non-finite-integrand
fixes, and deletion of the 0.95.0 random-family tombstones. The 0.91–0.95 line
carried `FindFit`/`FindRoot` (Tycho item 77), the `Nothing`-erasure/`Missing`
marker work, overload sets, the **Random family redesign**
(`WithRandomSeed` frames, PCG3D, domain-only `Random` — see
`docs/RANDOMNESS-MODEL.md`), and Epsil spread/destructuring. The 0.87–0.90
line carried the
Tycho items 56–76 rounds (complex-compile emission, the timeout-span model
replacing `ce.timeLimit`, compiled recursive lambdas, `RandomList`,
`Abs(point)` = norm), the tensor unification (BoxedTensor removed; tensor
values are canonical Lists with a lazy view), and honest shaped list types.
The 0.74–0.86 line carried the
Tycho-compatibility rounds (through items 50–54: hybrid-lazy `PointList`
transposes, the serialize→re-parse juxtaposition fixes, machine-precision
exact-sum crash, `ce.withTimeLimit`), the collection-operator-gaps +
laziness waves, the `broadcastable<T>` typing lift, conditional values
(`When`/`Which`), typed function literals, Mathematica-style surface forms,
`NDSolve` adaptive stepping + `NDSolveFunction`, the DSolve frontier round
(SymPy parity on the ODE audit), and the disposition of the 2026-07
correctness/symbolic/performance reviews — see `CHANGELOG.md`. Earlier
milestones: **0.73.0** (2026-07-09; solving parity 38/40 with
SymPy/Mathematica, Rubi R13–R16, `Interpret`, number theory) and the 0.7x
`Measurement` MVP / control-flow-scoping / Desmos-lists releases.
Neyret-corpus parse coverage 92.9%; the remaining Desmos gaps are
importer-side (tracked in tycho's `COMPUTE_ENGINE.md`), not engine items.

**Epsil language shipped (2026-07-09):** the revived Epsil language
(parser, serializer, `executeEpsil` interpreter — phases 0–5 of the revival)
is published as an **experimental** entry point
`@cortex-js/compute-engine/epsil`, joined to the code-splitting ESM build so
`executeEpsil(ce, …)` shares engine-class identity with a host-created
engine. Residual ship items (docs sync to cortexjs.io, highlight-mode
validation) are release-protocol steps tracked in
`roadmap/epsil/STATUS_REPORT.md`, not here.

The June 2026 codebase review (REVIEW.md) is fully dispositioned. **Rubi
status:** R1–R30 + R8 landed — chapters 1/2/3/5/6/7, 4.1/4.3/4.5, §8.8 Polylogarithm,
6,574 rules bundled; see the **Coverage tracks → Rubi** section below for
current scores and next rungs (per-rung history in `docs/rubi/RUBI.md` §5).

**Related documents:** `docs/fungrim/FUNGRIM.md` (feasibility + feature map),
`docs/fungrim/FUNGRIM-PLAN-1…5` (executed architecture plans), `data/fungrim/`
(translated corpus + manifest), `scripts/fungrim/` (translator tooling),
`docs/rubi/RUBI.md` (Rubi integration), `benchmarks/` (cross-library harness +
`REPORT.md`, `BIGNUM-COMPARISON.md`).

---

## Remaining work

### `Extract` and `Exclude` are documented but do not exist (OPEN, product decision — found 2026-08-16 auditing `doc/`)

`doc/82-reference-collections.md` carries two full `<FunctionDefinition>`
sections (~L1432–1544), an entry in the operator index (~L320) and a
cross-reference from `Reverse` (~L1427) for `Extract(xs, …)` and
`Exclude(xs, …)`. Neither name exists anywhere in `src/compute-engine/`:
`ce.box(['Extract', ['List',5,2,10,18], 2])` evaluates to itself, and
`ce.box('Extract').type` is `unknown` (auto-declared by the lookup). Eleven
documented examples describe an API a caller cannot invoke.

Three ways out, and the choice is a product one: implement both (the
gather-by-indices half is already `At(xs, indices)`, so `Extract` may be a
synonym worth having, and `Exclude` is its complement); delete the sections;
or mark them "not yet implemented" in place. `Ordering`'s "use `Extract`"
pointer was already re-pointed at the working `At(xs, Ordering(xs))`.

### `Sequence` does not splice into `List`/`Set`/`Tuple` (OPEN, correctness — found 2026-08-16 auditing `doc/`)

`Sequence`'s own doc comment (`library/core.ts`, the `Sequence` definition)
says it "is automatically flattened and hoisted to the top level of the
argument list", and the associative heads do exactly that
(`Add(1, Sequence(2,3), 4)` is `10`). The collection constructors do not:

```
["List",  1, ["Sequence", 2, 3], 4]  ->  [1, 2 3, 4]     (3 elements; the
      middle one is a `tuple<finite_integer, finite_integer>`)
["Set",   1, ["Sequence", 2, 3], 4]  ->  Set(1, 2 3, 4)
["Tuple", 1, ["Sequence", 2, 3], 4]  ->  (1, 2 3, 4)
```

so the element type comes out `list<finite_integer | tuple<finite_integer,
finite_integer>>`. The empty `Sequence` (`Nothing`) IS erased from a `List`,
which is what makes the gap easy to miss. `test/compute-engine/missing-value.test.ts`
(~L84) looks like it pins the splice, but `['Sequence','Nothing',2]`
collapses to `2` through the arity-1 branch of `Sequence`'s canonical
handler, so no multi-element splice into `List` is actually exercised.
Decide whether the constructors should splice (and fix `List`/`Set`/`Tuple`
canonicalization) or whether the `Sequence` doc comment overpromises and
should be narrowed to the associative heads. `doc/82-reference-collections.md:378`
documents the splicing behavior and was deliberately left uncorrected
pending this ruling.

### `Join` of two sets can yield a set with a duplicate element (OPEN, correctness — found 2026-08-16 auditing `doc/`)

```
const j = ce.box(['Join', ['Set',5,2,10,18], ['Set',1,2,3]]).evaluate();
j.type    // set
j.count   // 7
[...j.each()]   // 5, 2, 10, 18, 1, 2, 3     <- `2` twice
```

`Join` concatenates its operands' elements and keeps the first operand's
kind, but a `set` result has to be deduplicated — `Set(…)` itself dedupes on
construction, so only the `Join` path produces this. The documented answer
(`doc/82-reference-collections.md:2742`, left uncorrected pending the fix) is
`["Set", 5, 2, 10, 18, 1, 3]`. Either dedupe in `Join` when the result kind
is `set`, or rebuild the result through the `Set` constructor.

### `Limit` at ∞ declines on a SUM whose addends it resolves individually, when one needs `Erf(∞)` and another needs the ∞·0 resolution (FIXED 2026-08-16 — a COMPILER shape bug, not a limit bug; found 2026-08-16)

Each addend's limit is computed correctly; their sum is not. Measured at
HEAD, `y → +∞`:

```
3√2·Erf(√2/2·√y)·√π              ->  3√2·√π      (Erf(∞) = 1)
−6·e^(−y/2)·√y                   ->  0           (∞·0: decay beats growth)
−2·e^(−y/2)·y^(3/2)              ->  0           (same)

−6·e^(−y/2)·√y  +  −2·e^(−y/2)·y^(3/2)      ->  0          both ∞·0: fine
3√2·Erf(…)·√π   +  −6·e^(−y/2)·√y           ->  DECLINES
3√2·Erf(…)·√π   +  −2·e^(−y/2)·y^(3/2)      ->  DECLINES
all three (the real antiderivative)          ->  DECLINES
```

**It is not a general failure to distribute over `Add`** — that works, including
with an `Erf` addend, so long as the other addend is not an ∞·0 form:

```
1/y + e^(−y)            -> 0     Erf(√y) + e^(−y)   -> 1
3 + 1/y                 -> 3     Erf(√y) + 3        -> 4
```

The decline is specific to **mixing an `Erf(∞)` special-value addend with an
addend requiring the ∞·0 (exponential-decay × polynomial-growth)
resolution.** Each mechanism works alone and on like-with-like sums; only the
mixture fails.

**Consequence:** it blocks the definite-integral evaluator's "re-resolve an ∞
endpoint as `lim F(y)`" step, so improper integrals whose Rubi antiderivative
carries both an `Erf` term and a `poly × exp` term stay unevaluated —
`∫ₓ^∞ y^(3/2)·e^(−y/2) dy` is left as an `Integrate` (test
`integration-rules.test.ts` › "improper-integral endpoint at ∞ (poly × exp
decay)"). Numerics are unaffected: `.N()` gives 6.3854728701 against a
reference 6.385472870122, so this is symbolic-only. The integer-power sibling
`∫ₓ^∞ y²·e^(−y) dy` closes, because its antiderivative has no `Erf` term.

**Reproduce with the Rubi rules LOADED** — `loadIntegrationRules(ce)` from
`src/integration-rules`. On a bare engine the integral fails to close for an
entirely different reason (no rules), and the integer-power controls still
pass, so a bare-engine probe looks identical to this bug while measuring
something else.

Found by the string-roadmap session's post-commit suite; mechanism narrowed
here. Not attributed to a commit: none of the three candidates in the window
touches the integration, limit or Rubi lane, so whether it is a committed or
working-tree regression is unestablished and needs a clean-tree run.

**RESOLUTION (2026-08-16).** The mechanism above was mis-narrowed: the
discriminator is not "Erf(∞) mixed with ∞·0" but **any coefficient other
than 1 on the `Erf` addend** — `2·Erf(√y) + 2/y` declined while
`Erf(√y) + y·e^{−y}` resolved. `Limit`'s growth oracles probe expressions
numerically THROUGH THE COMPILER (`numericAt` → `implicitCompile`), and
`k·Erf(√y)` compiled wrong: in the default `auto` mode the unknown-sign
radical `√y` promotes to the complex lane, `Erf` (a real-only STRING helper,
`_SYS.erf`) takes the D2/D6 runtime rule and emits a bare REAL number, but
`isComplexValued(Erf(√y))` still answered complex — `Erf` types wide
(`number`), so the analysis fell through to the operand recursion — and the
enclosing `Multiply` read `.re`/`.im` off that number:
`{re: 2 * _b.re, …}` → `{re: NaN, im: NaN}` at every probe. The cancellation
guard `hasCancellation` (`symbolic/limit.ts`) reads a non-finite term as an
overflow and bails, so the whole sum declined. Same defect for every
wide-typed real-only string helper: `Erfc`, `Gamma`, `Zeta`, `Digamma`,
`Factorial`, `LambertW`, `Arsinh`, `ErfInv` (`Sign`/`Log10`/`Sinc`/… type
`real` and were fine).

Fix in `compilation/base-compiler.ts` (committed in `be88b1f7`): `compile()`
latches the outermost target's helper table (`_realOnlyHelperLookup`, same
mechanism as the mode/promotion latches) and `_isComplexValuedFunction`
answers `false` for a head that table maps to a string — mirroring the exact
routing condition of `compileExpr`'s string branch, so analysis and emission
agree on the value shape. Nothing in `limit.ts` changed. All three ROADMAP
sums now resolve to `3√2·√π`, and `∫ₓ^∞ y^{3/2}e^{−y/2}dy` closes to the
exact `−3√2·√π·Erf(√2/2·√x) + 2e^{−x/2}x^{3/2} + 6e^{−x/2}√x + 3√2·√π`
(6.3854728701 at x = 2 against the 6.385472870122 reference). Pins:
`compile-mode-complex.test.ts` › "a real-only string helper is REAL-shaped to
its parent" (the compiler shape, `auto` and `complex` modes) and
`limit-special-functions.test.ts` › "a sum mixing a scaled Erf(∞) addend with
a decaying addend resolves". Full suite after the fix: 551 suites / 29 383
tests / 4 312 snapshots, zero snapshot changes.

### An `unknown`-typed symbol compared to a SCALAR types the relation scalar, so adding evidence about the OTHER operand makes the answer worse (RULED 2026-08-16 — option 3: the scalar presumption stands and the INFERRED type is REVISED from its value; FIXED same day. Found 2026-08-16 running down Tycho item 198)

`Equal` answers `broadcastable<boolean>` when neither operand's
collection-ness is known, which is the honest "cannot tell" the 192/193/194
round introduced. But once the OTHER operand pins down to a scalar, the
`unknown` operand is treated as a scalar too, and the relation commits to
`boolean`. Measured at HEAD, one fresh engine per row:

```
U := [10,20,30]                      // U is a known list

C undeclared          C = U[1]  ->  boolean                 // WRONG: C may be a list
C declared `unknown`  C = U[1]  ->  boolean                 // WRONG, same
C assigned [10,30]    C = U[1]  ->  list<boolean^2>         // right
nothing declared      C = U[1]  ->  broadcastable<boolean>  // right — the honest answer
```

**Adding information made the type wrong.** With no evidence at all the
engine says `broadcastable<boolean>`; supplying a value for `U` — evidence
about the operand that was never in doubt — collapses the answer to
`boolean`. `unknown` is a placeholder that refines per use, not a proof of
scalar-ness, so it must not satisfy the scalar arm of the broadcast decision.
The comparison should stay `broadcastable<boolean>` while EITHER side could
still turn out to be a collection.

It propagates through the shape the consumer actually writes — `Which` over
the relation, then `Sum` over that:

```
Sum(Which(C = U[i], i, 0), i, 1, Length(U))
  U list + C unknown  ->  type `number`,  evaluates to a LIST
  U list + C a list   ->  type `vector<integer^2>`, evaluates `[1,3]`   // agree
```

so the mistyped case is a type/value disagreement of exactly the kind item
193 records.

**The mistyping is NOT new — it is identical on 0.112.0** (verified by the
consumer on a scratch 0.112 overlay of the same probe file: the relation
types scalar `boolean` and the `Sum` types `number` on both versions). What
0.113.0's assign inference changed is only whether the wrong type is
COMMITTED to the symbol:

```
0.112   C_0.type = dictionary | indexed_collection   (stays OPEN)
0.113   C_0.type = number                            (COMMITTED)
```

**This commitment is UNSOUND — the symbol's recorded type does not contain
its own value**, and that is the sharpest statement of the bug because it
reproduces in one engine with no document and no version comparison:

```
U := [10,20,30];  declare C_0 unknown;  C_0 := Sum(Which(C = U[i], i, 0), …)
then refine C := [10,30]
  C_0.type            -> number                      (still)
  C_0.evaluate().type -> vector<finite_integer^2>
  actual.matches(declared) -> FALSE                  // UNSOUND
  C_0[2]              -> 3                           // the READ works anyway
```

A type is a promise about the value; here the promise is false and persisted.

**The unsoundness is a CONSEQUENCE of the relation defect, not a separate
bug — fix the relation and it cannot arise.** At assign time the committed
type is *true* (`declared=number`, `actual=finite_integer`, matches); it goes
false only once `C` refines and the value becomes a vector. That looks like
staleness and invites an expensive fix (a refresh path that recomputes a
symbol's type when a dependency refines). It is not: the type went stale only
because it was NARROWER than the evidence justified. Had the relation
answered `broadcastable<boolean>` — which it already does when neither side
is known — the `Sum` would type `broadcastable<integer>`, and that promise
survives the refinement:

```
vector<finite_integer^2> <: number                          false   ← today
vector<finite_integer^2> <: broadcastable<integer>          TRUE    ← honest type
vector<finite_integer^2> <: dictionary | indexed_collection TRUE    ← 0.112's open type
```

The third row is why 0.112 was sound without any refresh mechanism: its open
type still contains the later vector. **So do NOT build a type-invalidation
path for this** — the honest type is the fix, not a refresh mechanism.

**⚠ But the fix is NOT localized, and the narrow behaviour is DELIBERATE.**
The gate is `isPossiblyCollectionTyped` (`collection-utils.ts:917`):

```ts
if (t === 'unknown' || t === 'any' || t === 'value') return isFunction(expr);
```

A top-typed operand counts as possibly-collection **only when it is a
function application**; a bare SYMBOL typed `unknown` returns `false`, which
is exactly why `C = U[1]` types scalar. That narrowness is documented and
justified in the same file (see the `isValuelessCollectionTyped` comment):
widening it "would also catch a top-typed (`unknown`/`any`) operand …
reclassifies every undeclared symbol and is a different, much larger change".
The helper has **11 call sites** across `arithmetic.ts`, `arithmetic-add.ts`,
`collections.ts`, `relational-operator.ts` and `boxed-function.ts`, plus its
own compiled twin in `base-compiler.ts`, and it is part of the public surface
(`src/api.md`). (An earlier revision of this entry said "44 references" — that
counted imports and prose as well as calls.) So this needs a RULING on how far
to widen, not a one-line edit — see the disposition note at the end.

**The sites do NOT behave uniformly, because some operators narrow their
operand on the way past and others do not:**

```
x + 1  (x declared unknown)  -> expr number         x ends up number    NARROWED by the use
2x     (x declared unknown)  -> expr finite_number  x stays  unknown    not narrowed
x = 1  (x declared unknown)  -> expr boolean        x stays  unknown    not narrowed
```

So `Add` rarely sees a bare `unknown` at all (widening there buys little),
`Multiply` does (widening there would retype every scalar multiplication by an
undeclared symbol — engine-wide, needs its own measured radius), and the
comparisons are where the defect actually lives. The `Add`/`Multiply`
asymmetry above is itself unexplained and may be a second latent
inconsistency.

**The over-narrow commit also blocks USAGE-NARROWING, which is the second and
more damaging half.** A declared *concrete* type is deliberately not moved by
a use (that is the documented rule); `unknown` is a placeholder and moves.
Committing a concrete `number` therefore converts a movable placeholder into
an immovable wrong answer. Measured at HEAD, both arms in one script with the
parse-order confound controlled — the no-use rows prove the movement is
caused by the use and not by parse order:

```
COMMITTED `number` + use C_0[2]   number  -> number                          read: Error(incompatible-type)
OPEN `unknown`     + use C_0[2]   unknown -> dictionary | indexed_collection read: At("C_0", 2)   resolves
COMMITTED, no use                 number  -> number    (control, no movement)
OPEN, no use                      unknown -> unknown   (control, no movement)
```

Note both arms are reachable at HEAD, so **no 0.112 install is needed to
study this**: the OPEN arm *is* the pre-commit state.

**The proposed fix was tested against both failure modes and survives** —
this is the experiment that would have refuted it:

```
declared `number`                  C_0[2] -> Error(incompatible-type)   ← today
declared `broadcastable<integer>`  C_0[2] -> At("C_0", 2)               ← the fix: resolves
declared `dictionary | indexed_collection`  C_0[2] -> At("C_0", 2)
declared `unknown`                 C_0[2] -> At("C_0", 2)
```

So an honest `broadcastable<integer>` is both SOUND against the refined value
and INDEXABLE by a later reader. Full chain: relation types `unknown` as
scalar → over-narrow commit → (a) unsound once the value refines and (b)
immovable by use, so readers fail closed. Cutting it at the relation cuts
both.

**The witness is the bare-engine repro above — deliberately NOT a consumer
document.** Every table in this entry runs in one fresh engine, at HEAD, with
no version comparison and no importer; that is the whole evidence base and it
is sufficient. Reproduce with:

```
U := [10,20,30];  declare C_0 unknown;  C_0 := Sum(Which(C = U[i], i, 0), i, 1, Length(U))
```

This entry was FOUND while running down a consumer filing (their item 198,
`frqpa78i6s`). **That filing was subsequently WITHDRAWN — the clean arm
(`HEAD@0.112` vs `HEAD@0.113`, consumer code constant, engine the only
variable) measured 7 members on BOTH, i.e. zero CE delta; the apparent
26 → 1 came from a confounded tree and a consumer-side regression.** Three
intermediate causal stories were refuted along the way. **None of that
touches this entry**, which is why it is written the way it is: every table
above runs in one fresh engine at HEAD, so the defect never depended on the
filing that led to it. Do not treat 198's withdrawal as evidence against this
— the relation defect, the unsound commitment, and the immovable-by-use
behaviour are independently measured and stand on their own. Equally, do not
resurrect the 26 → 1 figure from any stale reference; it does not describe a
CE change.

**Disposition — NOT FIXED, awaiting a ruling. Option 1 was IMPLEMENTED,
MEASURED on the full suite, and REVERTED (2026-08-16); the numbers are
below.** The fix belongs at the relation, not at `Sum`/`Which`: the
`Equal`/`NotEqual` (and ordering) result type must treat an `unknown`-typed
operand as "collection-ness not yet known" rather than as scalar. Three
candidate scopes, cheapest first:

1. **Comparison operators only** — `comparisonResultType` (and a new
   `orderingResultType` for `Less`/`LessEqual`, which share the gap: `C <
   U[1]` types `boolean` too) admits a bare top-typed symbol as
   possibly-a-collection. **The "inconsistent with `Add`/`Multiply`"
   objection is REFUTED**: `isPossiblyCollectionTyped` excludes bare symbols
   because arithmetic REFINES them on use (`Add(D, 5)` makes `D` `number`,
   so the answer would be order-dependent), and a comparison refines nothing
   — `Equal(C, 5)` leaves `C` `unknown` (measured) — so for comparisons a
   top-typed symbol is exactly as unresolved as a top-typed application.
   Principled, and it does close the four-row table (`C = U[1]` types
   `broadcastable<boolean>` in both `unknown` rows; `C_0` then types
   `broadcastable<integer>`, which its later `[1, 3]` satisfies, and `C_0[2]`
   reads `3`). **But the blast radius is NOT small, and it is not the 44
   `isPossiblyCollectionTyped` sites — it is every downstream
   `type.matches('boolean')` gate**, because EVERY relation over an
   undeclared symbol (`x < 3`, `y = x²` — the commonest expression shape in
   the product) would type `broadcastable<boolean>`, a union that is a
   subtype of neither `boolean` nor `indexed_collection<boolean>`. Census in
   `src/`: ~25 such gates (`When` mask cells, `isBooleanishCondition`,
   `Set`/`Element` conditions, `solve-domain`, rule wildcards, the
   compiler's `isComplexValued` boolean short-circuit, GPU `bool` typing, …),
   plus whatever the consumer gates on. **Full suite with option 1 applied:
   6 suites / 8 tests / 1 snapshot fail** (baseline without it: 551 suites /
   29 383 tests / 4 312 snapshots, all green), and every failure is a real
   semantic break, not a stale pin: a predicate lambda `(a, b) ↦ b < a` types
   `(unknown, unknown) -> broadcastable<boolean>` and no longer satisfies a
   declared `(integer) -> boolean` callback contract
   (`design-d-callback-contract.test.ts`, `lambda-param-element-inference.test.ts`
   — the stamp declines with `incompatible-type`); `Element(d, D, d ≠ V)`
   conditions become `Error`s (`latex-syntax/arithmetic.test.ts` snapshot);
   `Set.contains` over a comprehension degrades to `undefined`
   (`set-comprehension.test.ts`); `list-filtering.test.ts` › "symbolic
   comparisons stay symbolic" pins `0 < x` as `boolean`; and one
   `compile-mode-complex.test.ts` selection case throws. Choosing this option
   therefore means ALSO widening every boolean-contract gate to admit
   `broadcastable<boolean>` (a "boolean-ish predicate" convention), and
   accepting that a predicate lambda over undeclared parameters is no longer
   a `-> boolean` function to the type checker. The patch is small
   (`isTopTypedSymbol` in `collection-utils.ts` + the two handlers in
   `library/relational-operator.ts`, ~90 lines) and re-derivable from this
   entry.
2. **Widen `isPossiblyCollectionTyped`** to admit bare top-typed symbols —
   everything in (1) PLUS every element-wise arithmetic operator; strictly
   larger, and now known to be measurably breaking. Not measured separately.
   **Also refuted for any future re-attempt of (1)/(2)** (CE-POC's independent
   trial, same evening): gating the widening on "some OTHER operand is a
   DEFINITE collection" does not rescue it — in `C = U[1]` there is no
   collection operand at all (`U[1]` is a scalar ELEMENT), so the defect case
   and the `d != V`-between-two-undeclared-symbols regression case (which
   broke `Sum`'s `Element` constraint slot in that trial) are
   indistinguishable at the type level. Any retry of (1)/(2) re-buys the
   full blast radius; there is no cheaper conditional variant.
3. **Neither — declare the relation's scalar `boolean` the CONVENTION** (an
   undeclared symbol is presumed scalar until evidence says otherwise, which
   is already what arithmetic inference does) and instead stop the assign
   inference from COMMITTING a concrete type derived through a top-typed
   free symbol of the RHS, leaving such symbols open as 0.112 did. Closes the
   two measured HARMS (the unsound committed `number` on `C_0`, and the
   `C_0[2]` read failing closed) without touching the relation's type; the
   relation stays "wrong" only in the sense that `x = 5` types `boolean` for
   an `x` that could later be assigned a list — the same presumption the
   engine makes everywhere else. Blast radius unmeasured; expected to be
   confined to assign-inference over RHSs mentioning an unrefined symbol.

**RULED 2026-08-16 (user): option (3), with the principle stated as
"inference doesn't have to be broadest, it has to be more likely, and is
subject to revision."** (Numbering note: the ruling was given against the
session's three-option summary, where this alternative — keep the scalar
presumption, make the inferred type revisable — was listed as "(2)"; it is
this entry's option 3. Same alternative, different list.) So: the relation over an undeclared symbol keeps the
scalar `boolean` (the same presumption arithmetic inference already makes —
the four-row table's `boolean` rows are the CONVENTION, not a defect, and
the "less-informed is more honest" framing is withdrawn: the
`broadcastable<boolean>` of the nothing-declared row comes from the
top-typed APPLICATION `U[1]`, not from `C`); the assignment commits the
LIKELY type; and that inferred type is REVISED when its own value refutes
it. Implemented as `_reviseInferredType` in
`boxed-expression/boxed-value-definition.ts`: the value-definition `type`
getter re-checks an INFERRED type whose value is a function-shaped
expression at most once per semantic generation (`ce._semanticVersion`)
against the value's live type, and when the recorded guess no longer admits
it, adopts the value's type — the D11 "the guess was wrong: adopt the
value's own type" rule the assign path already applies. A DECLARED type is a
contract and never moves; a literal value's type cannot move and is not
checked; a guess the live value still fits (`y := x + 1`, then `x := 2`)
keeps the likely `number`; self-referential bindings are skipped. Measured:
`C_0` types `number` while `C` is unknown and `vector<integer^2>` once `C :=
[10, 30]`, the value `[1, 3]` satisfies it, and `C_0[2]` reads `3`. (Re-
measured on the way: harm (b) — the `C_0[2]` read failing closed — did NOT
reproduce at HEAD; the read only fails while `C` is unresolved, when the
value genuinely is not indexable, and a *declared* `number` fails at box
time, which is the contract working. Harm (a), the stale recorded type, was
real and is what the revision closes.) Pinned in
`test/compute-engine/inferred-type-revision.test.ts` (the ruled `boolean`,
the revision, the declared-type contract, the kept guess). Blast radius on the full suite: 552 suites / 29 390 tests /
4 312 snapshots pass, zero snapshot changes. `Function`-literal values are
excluded from the revision: a lambda's type is its signature, and the protocol
conformance re-activation (`engine-protocols.ts`) re-settles it on alias
re-declaration; a read-time retype pre-empted that (two joint-cause refusals in
`protocol-type-redefinition.test.ts` turned into acceptances) — data values only.

**Three defects found and FIXED while measuring this (2026-08-16), all
independent of the ruling:**

- **`Which`/`If` THREW on an undecided `broadcastable<boolean>` condition.**
  Since the 193 round, `Which(h(x) = 10, 1, True, 0)` (condition typed
  `broadcastable<boolean>`) raised the "Condition must evaluate to True or
  False" spell-check error out of `evaluate()`, where before the round it was
  held: `isBooleanishCondition` (`library/control-structures.ts`) tested
  `matches('boolean')` and `matches(indexed_collection<boolean | missing>)`,
  and the union is a subtype of neither. Same gate class in `When`'s
  mask-cell test, which left `x{h(x) ≤ [1,2,3]}` un-broadcast. Both now admit
  the type through `possiblyElementwiseCondition`, the predicate the
  `If`/`Which` TYPE handlers already used. Under option (1) this throw would
  have hit every `Which(x = 5, …)`. Pinned in
  `test/compute-engine/undecided-condition-broadcastable.test.ts`.
- **A big operator's term that kept the loop index leaked it and summed
  wrong.** `Σ_{k=1}^{3} Which(x < k, k, True, 0)` evaluated to
  `Which(x < k, 9, True, 0)` and `Σ If(x < k, k, 0)` to `3·If(x < k, k, 0)`:
  the loop binds the index by ASSIGNMENT, an undecided `If`/`Which` returned
  `undefined`, the framework kept the ORIGINAL node with `k` unresolved, and
  three identical terms were accumulated (then `3k` re-evaluated at the last
  index value). The per-term step (`evaluateBigOpTerm`, `library/utils.ts`,
  used by `Sum`/`Product` over `Limits` and `Element`) now substitutes the
  current index values into a term that still mentions an index — the repair
  `comprehensionStream` already applied to comprehension elements — with a
  BINDER-AWARE substitution (`substituteFreeNames`: a nested `Σ_k` in a held
  arm keeps its own `k`; a `t ↦ t + k` gets the value in its free position).
  Result: `If(x < 1, 1, 0) + If(x < 2, 2, 0) + If(x < 3, 3, 0)`. Pinned in
  `test/compute-engine/big-op-leaked-index.test.ts`.
- **`If`/`Which` discarded the evaluated condition** (the lazy-operator
  pitfall — `return undefined` hands back the original node): `Which(C =
  U[1], …)` kept `U[1]` where its condition had read `10`. Both now rebuild
  around the EVALUATED condition, arms untouched, `isSame`-fixpoint-guarded.
  Same test file. Full suite with these three fixes and NOT option (1):
  551 suites / 29 383 tests / 4 312 snapshots, zero snapshot changes.

### Tycho items 192/193/194 — residue after the 2026-08-15 fixes (OPEN)

The three items were fixed the same day (`PointList` takes the elementwise
derivative branch and `F'_{0}(t)` parses like `F_{0}'(t)`, item 192;
`Equal`/`NotEqual`, `Which`/`If` and `Sum`/`Product` type handlers now answer
`broadcastable<…>` for a comparison whose collection-ness is statically
undecidable, item 193; arithmetic broadcast over a `Range`/list combines the
scalar's numeric tier into the element type and comprehension/loop binders are
declared with `inferred: true`, item 194 — pins in
`test/compute-engine/tycho-item-19{2,3,4}-*.test.ts`). Three questions were
surfaced and deliberately NOT decided in that round; the third has since been
fixed:

- **`Unique(indexed_collection)` types bare `collection`** (drops the
  `indexed_` qualifier), and **`At(U, i)` on a bare `indexed_collection`
  types `unknown`.** These are why the item-193 witness (`frqpa78i6s`) reaches
  `C = U[i]` with no element type at all; a concrete element type through
  `Unique`/`At` would let the comparison type as a definite `list<boolean>`
  instead of `broadcastable<boolean>`, which Tycho's `matches('collection')`
  gate declines. Tycho is filing these separately; the CE-side fix is in the
  `Unique` and `At` type handlers (`library/collections.ts`).
- **`Add` and `Multiply` widen collection cells by different evidence.**
  `addType` (`boxed-expression/arithmetic-add.ts`) widens the cells by ANY
  numeric co-operand, including a merely inferred scalar; the `Multiply`
  collection arm (`library/arithmetic.ts`) requires `isDeclaredScalarNumber`
  because widening on an inferred type made `t ↦ 2a(t)` under
  `(list<real>) -> list<real>` type `list<number>` and broke the
  forward-reference repair pin in `list-parameter-indexing.test.ts`. With
  `L: list<integer>` and `j` auto-inferred `number`, `j·L` reports
  `list<integer>` while `j+L` reports `list<number>`. Both are sound.
  RULED 2026-08-15 (user, at review): keep the asymmetry as shipped —
  `Multiply` widens only on DECLARED scalar evidence, `Add` keeps its
  pre-existing looser rule; revisit only if a failing input for `Add`'s rule
  turns up. Likewise ruled the same day: the `f'_n` spelling parses as
  `(f_n)'` (the item-192(b) convention), the two flipped inline snapshots in
  `test/compute-engine/latex-syntax/supsub.test.ts` are the record.
- **`BoxedSymbol.infer()` did not mark its own writes inferred** — FIXED
  2026-08-15 at the source (`boxed-expression/boxed-symbol.ts`). The
  `def.value.type.isUnknown` arm of its guard wrote a concrete type onto the
  value definition while leaving `inferredType` false, so a binding created
  as `ce.declare(x, 'unknown')` and then narrowed by a use — a loop or
  comprehension index narrowed to the iterated collection's CLAIMED element
  type — became an enforceable declaration, and the next assignment of a
  wider value (`1/2` into an index guessed `integer`) was rejected by
  `assertAssignableValueDef` (`engine-declarations.ts`) with
  `incompatible-type` instead of widening the type. `infer()` now sets
  `def.value.inferredType = true` alongside the type write, which is what the
  provenance model asks for (inferred means revisable, declared means
  enforceable — `docs/EFFECTS-MODEL.md`, "Annotation provenance"); a DECLARED
  concrete type is untouched, since the guard only lets a write through when
  the type is already inferred or still `unknown`. The fix covers the sites
  the earlier workaround did not: the destructuring leaves in
  `library/control-structures.ts` and the auto-declare shadow in
  `validate.ts`. The two binder-declaration sites in
  `boxed-expression/box.ts` keep their `inferred: site.type === undefined`
  spelling — redundant for the assignment path now, kept because it states
  the binding's provenance before any inference runs, for the readers of
  `inferredType` that ask whether a type was declared. Blast radius measured
  on the full suite: 526 suites / 28037 tests / 4306 snapshots pass, zero
  snapshot changes. Pins: the "inference marks its own writes inferred"
  block in `test/compute-engine/tycho-item-194-range-broadcast-type.test.ts`
  (widening on the inferred track, and the declared-type contract still
  throwing).
- Also open from item 192(b): a compound (`Subscript`) prime base with no
  application yields `Derivative(Subscript(alpha,1))` while a fused name
  yields `Prime(F_0)` — pre-existing, whether `Prime` or `Derivative` is the
  canonical no-argument head is a convention question.

### `And`/`Or` (`&&`/`||`) did not short-circuit and reordered their operands (FIXED 2026-08-15)

Reported by the user against Epsil and confirmed at the engine level:
`And(False, F())` still evaluated `F()`, and because `And`/`Or` were declared
`commutative`, canonicalization SORTED the operands — `Or(F(), G())` boxed as
`Or(G(), F())` and ran `G` first — so a guard such as `k <= n && xs[k] > 0`
read `xs[k]` out of range and `false && (1 + "a" == 2)` still reported the
dead operand's error. `docs/RANDOMNESS-MODEL.md` (draw order) and ruling B8 in
`docs/TYPE_SYSTEM_ROADMAP.md` already promised short-circuit, left-to-right
forms, and the JavaScript compilation target already emitted `&&`/`||`, so
compiled and interpreted code disagreed on side effects and errors.

Fix (`src/compute-engine/library/logic.ts`, `canonicalShortCircuit` /
`evaluateShortCircuit`): `And`/`Or` are `lazy` with a `canonical` handler that
canonicalizes and flattens the operands IN WRITTEN ORDER and runs
`validateArguments` itself (a lazy operator's canonical handler bypasses the
framework validation, and a lazy operator without one receives unbound
operands), and an `evaluate` handler that evaluates operands left to right and
stops at the first `False`/`True`; a collection-valued operand falls back to
the element-wise broadcast. The `associative`/`commutative`/`idempotent` flags
are dropped (they sort, and are incompatible with a `canonical` handler); the
symbolic reducers `evaluateAnd`/`evaluateOr` (`symbolic/logic-utils.ts`) now
flatten nested same-operator operands themselves, and `simplify` keeps
recursing into `And`/`Or` operands although they are lazy (the lazy branch of
`simplifyFunctionOperands` is an Add/Multiply special case). Pins:
`test/compute-engine/evaluation-order.test.ts` (order witnesses, `&&`/`||`
section), `logic.test.ts` (CNF/DNF unchanged), `relational-operators.test.ts`
and `latex-syntax/logic.test.ts` (chains now serialize in written order —
`5 < b ≤ 7` → `And(5 < b, b ≤ 7)`).

Review round (same day) added the async twin (`evaluateAsync`), full option
threading, an error-valued operand as a decider, `invokes: false`, and made
the element-wise case coherent: whether an application is element-wise is
decided by the operand TYPES before evaluation (`isElementwiseOperand`), so
`And(False, L())` with `L : () -> list<boolean>` returns a list as its type
says, whichever way the collection is spelled. **Ruled 2026-08-15: an
element-wise `And`/`Or` evaluates every operand once — no per-cell
short-circuit** (option (a); the alternative, per-cell laziness, would need
`And`/`Or` excluded from the driver's generic broadcast and its zip /
length-mismatch / lazy-`Map` handling re-implemented in the handler, for a
benefit visible only with side-effecting operands inside a vectorized
conjunction). Do not re-litigate.

Extended the same day, for consistency (user-ruled): `Nand`, `Nor` and
`Implies` are short-circuit forms too (same handlers, parametrized by a
`Decider`; `Nand`/`Nor` are NOT flattened — they are not associative), and
the relational CHAINS `Less`/`LessEqual`/`Equal`/`NotEqual` stop at the first
adjacent pair that is `False` (`evaluateChainOperands` in
`library/relational-operator.ts`, which re-dispatches the operator's own binary
evaluation on the two values and never evaluates an operand twice). This
also supersedes the "interpreter EAGERLY draws even a short-circuited chain
operand" probe recorded under the compile-CSE round below: `Less(5, 1,
Random())` no longer draws, and the compiled chain lowering
(`compilation/base-compiler.ts`) now binds an index-≥2 operand behind the
preceding pairs so compiled and interpreted draw counts agree (a shader
target declines that shape, D6). The `simplify` recursion exception is
derived from the signature (`holdsOnlyBooleanOperands`: every parameter
`boolean`), not from a name list. `Xor`/`Equivalent` are unchanged (every
operand affects the result). Pins: `logic.test.ts` (Nand/Nor/Implies),
`relational-operators.test.ts` § "Chains SHORT-CIRCUIT".

### An `int`-declared shader parameter used in float ARITHMETIC emitted an ill-typed shader behind `success: true` (FIXED 2026-08-15, user-ruled — found while fixing Tycho item 191)

`compileFunction(expr, 'f', 'float', [['K', 'int']])` emitted
`float f(int K) { return K + 1.0; }` for `K + 1` (WGSL: `fn f(K: i32) -> f32
{ return K + 1.0; }`) — neither language promotes int to float, so the
driver rejected the program: the same silent-failure class as Tycho item 191,
in the arithmetic rather than the loop header. Ruling (2026-08-15): cast at
the reference site. `gpuDeclaredBodyTarget` (`gpu-target.ts`) now binds an
integer-declared scalar (`int`/`i32`/`uint`/`u32`) to `float(K)` / `f32(K)`,
so every reference is a float; `gpuTypeOfValue` reports it as a float (a
call boundary that used to fail closed on an `int` argument into a float
slot now converts — `compile-gpu-user-functions.test.ts` flipped), the `At`
index path no longer double-casts, and the `Sum`/`Product` loop header reads
the raw slot (`GPUDeclaredType.ref`) so an int bound stays `j <= K` while a
bound EXPRESSION reads `int(floor(float(K) + -1.0))`. Known limit, documented
at `gpuDeclaredIsIntegerScalar`: the conversion loses precision above 2^24.
Pins: `test/compute-engine/tycho-item-191-gpu-loop-bound-typing.test.ts`.

### `defineFunctionClause` may write through to a builtin instead of shadowing it (REFUTED 2026-08-16 — probed, does not reproduce)

Flagged during the nested-`DefineFunction` block-local fix (2026-08-15):
in `src/compute-engine/multi-clause.ts`, when the existing binding is a
system-scope builtin the clause path clears `existing` so the builtin is
shadowed — but the single-clause branch then delegates to
`ce.assign(id, literal)`, which resolves the name up the whole scope
chain and could mutate the builtin's binding rather than create a
current-scope shadow (contrast the protocol-dispatcher path, which
routes to `declareShadowingFunction`). No test exercises the
builtin-name single-clause case; needs a probe (define one clause named
after a builtin, check the system scope's binding is untouched) and, if
it reproduces, the same shadowing-declare treatment the dispatcher path
uses.

**REFUTED 2026-08-16.** The probe was written and it does not reproduce.
Defining a one-clause function named after a builtin — at top level and
block-locally, over operator-bound builtins (`Sin`, `Abs`, `Length`) and
value-bound ones (`Pi`, `ExponentialE`) — leaves the system scope's definition
record the very same object, and the builtin still answers correctly outside
the block while the clause answers inside it.

**Why, measured rather than reasoned:** by the time `defineFunctionClause`
runs, the current scope ALREADY holds its own binding for the name, and
`existing` is never the system-scope definition. So `ce.assign` never has the
builtin in reach, and the `isBuiltin` branch that clears `existing` is not the
operative protection on this route at all — the concern assumed a resolution
order that does not occur.

The protection is LAYERED, which is the part worth recording: the
unconditional `DefineFunction` hoist (`control-structures.ts`), the
recursion-knot pre-shadow shell (`core.ts`), and `assign`'s own
`shadowBuiltin` test (`engine-declarations.ts`) each independently put a
current-scope binding in the way. Disabling any ONE of the three leaves the
builtin intact, verified by disabling each in turn.

The contrast with the protocol dispatcher — which genuinely did need
`declareShadowingFunction` — also resolves: a dispatcher lives in the GLOBAL
scope, so none of the builtin-specific layers apply to it.

Pinned in `test/compute-engine/block-scope-shadowing.test.ts`. That test is an
END-TO-END behavior pin, NOT a guard pin: because the layers are redundant it
does not fail when a single one is removed, and it should not be read as
evidence that any particular layer is load-bearing.

### Quadrature-dependent compile tests can be silently vacated by a smarter fold

The wall-clock-assertion sweep (2026-08-14) found that the antiderivative-first
fold had turned both cost-guard integrands in `compile-integrate.test.ts` into
closed forms, so `r.run()` performed no numeric integration at all and the tests
pinned a path the runner never took. Those two now assert that `r.code` contains
`_SYS.integrate(`, so a future smarter fold cannot silently re-vacate them. The
same emitted-code guard has NOT been applied to the other quadrature-dependent
tests in that file, and any of their repros could be intercepted by the same
fold as it improves.

### The declare-WITH-value route bypasses the default-`!scope` ceiling

`ce.declare('f', { type: '(...) -> ...', value: writerLiteral })` — the third
`assertDeclaredEffects` caller — installs a proven escaping writer without the
scope ceiling that the two declare-then-assign reconciliation routes got on
2026-08-15. It stays ungated because the same code path serves block-local
`let` bindings whose writer closures (a closure mutating its enclosing
literal's local) must remain installable, and no global-vs-local discriminator
is available at that seam: the Epsil static pass also evaluates top-level
declares under pushed scopes, so context depth does not separate the two. The
arrow it installs still carries the inferred `scope` label honestly, so the
effect stays visible; what is missing is the refusal.

### A compiled user function declared `-> complex` returns a corrupt value (FIXED 2026-08-16)

A user function whose signature declares a `complex` result compiles to a
call whose emitted body does SCALAR arithmetic on the complex `{re, im}`
object, so the result's `re` field is a string concatenation. Reproduction
(no constant folding involved — it reproduces with a run-time argument and
`constantFold: false`):

```js
ce.declare('Q', { signature: '(complex) -> complex' });
ce.assign('Q', ce.box(['Function', ['Block', ['Add', 'z', ['Complex', 0, 1]]], 'z']));
compile(ce.box(['Q', 'w'])).run({ w: { re: 1, im: -1 } });
// ➔ { re: '[object Object]0', im: 1 }      the interpreter answers 1
```

The `'[object Object]0'` is the tell: the emitted definition adds the
complex literal's real part to the whole parameter OBJECT (`z + 0`) instead
of routing the addition through the target's complex helper, so the
user-function body lowering is not applying the complex arithmetic path
that ordinary `Add` over complex operands uses. The value is silently
wrong rather than failing closed, which makes it the worst shape of
compile defect.

Found 2026-08-14 while extending constant folding to collections; it is
independent of that work (folding a constant call actually produces the
CORRECT value, which is how the divergence surfaced). Fix in the
JavaScript target's user-function emission: the body must compile under
the same complex-operand dispatch a top-level expression gets, or the
declaration must fail closed. Check the other targets for the same hole
while there.

**FIXED 2026-08-16.** The title understates it: the corruption is in the
declared `complex` PARAMETER, not the result, and it hit three of the four
argument shapes — the entry's own repro is only one of them.

    argument to `Q(z) = z + i`, declared `(complex) -> complex`
                                  BEFORE                      AFTER
    static complex (1-i)          {re:'[object Object]0',…}   {re:1, im:0}
    static real (u: real, u=2)    {re:'[object Object]0',…}   {re:2, im:1}
    untyped symbol, given 2       {re:2, im:1}  (accident)    {re:2, im:1}
    untyped symbol, given {re,im} {re:'[object Object]0',…}   {re:1, im:0}

**Mechanism**, measured by instrumenting the definition emission rather than
inferred: the emitted body was `const _fn_Q = (z) => ({ re: z + 0, im: 1 })`
— it correctly BUILDS a complex result but reads `z` in the REAL lane, and
`userCallComplexLanes` reported `lanes: [false]` with an empty complex frame.
The lane is chosen from the ARGUMENT, and a declared-complex parameter is
explicitly given lane `false` on the assumption that the base emission already
handles it. It does not. The static-real row is the clearest tell: the call
site DID wrap the argument to `{re:2, im:0}`, and the real-lane body then
added the object.

**Fix, in three parts.** (1) A parameter the signature declares complex is
entered into the body's complex frame for every call site
(`addDeclaredComplexParams`) — a property of the FUNCTION, so no `$z`
specialization. (2) The call-site coercion is gated on the PARAMETER's
declared type instead of the argument's realness, so every call delivers an
object. (3) The wrap has three forms, because no single one is correct: a
complex number LITERAL is passed through (this compiler already emits it as an
object), a provably real argument is wrapped statically at zero runtime cost,
and everything else goes through the new idempotent `_SYS.cplx` helper.

**Why the third part is not optional:** an untyped free symbol supplied at
`run()` time may be a plain number OR a complex object, and a real IS a
complex, so neither is a contract violation and no static choice serves both.
Two tighter tests were tried and both silently dropped the wrap from exactly
that case — `isComplexValued` answers "could be complex" and is TRUE for an
untyped symbol, and the argument's TYPE is no better, because `Q(w)` INFERS
`w: complex` from the declared parameter.

**Not radical promotion, so no tension with the Tycho-190 rule** ("the lane
comes from the operand, never the node type"): nothing is inferred complex
from an operand's sign here, and `complexPromotion` is not consulted. The
author WROTE `(complex) -> complex`; the lane is that declaration read back,
and the call site is made to honour it.

**Other targets: nothing to do.** The `{re, im}` convention is
JavaScript-only — both call-site computations are already gated on
`target.language === 'javascript'`, and the GPU/lowering path returns from
`emitFunctionLiteralDefinition` before the frame block, so the seeding cannot
reach it.

**A second half, found by review and NOT by the tests above:** putting the body
in the complex lane broke the VALUE position. The argument coercion lives in
`emitUserFunctionCall`, which only the CALL route reaches, so a function
referenced by name — `Map`'s callback, `CountIf`, `Find`, `_SYS.bcastFn` — was
handed raw elements by its consumer and read `.re`/`.im` off a plain number:
`Map(Q, [1,2,3])` answered `[{re: null, im: null}, …]` behind `success: true`
where the previous real-lane emission was correct. The first fix had traded one
silent-wrong class for another, one position over.

Fixed with a coercing shim under its own name
(`ensureUserFunctionValueRef` → `const _fn_Q$v = (x) => _fn_Q(_SYS.cplx(x));`),
so the two routes do not share a cache entry. It uses the RUNTIME helper
because an element's realness belongs to the SOURCE, not to the reference, and
the reference is compiled without one. A function with no declared-complex
parameter gets no shim, so its emitted code is byte-identical.

The lane assignment is also language-gated now, matching both call-site
coercions: `{re, im}` is a JavaScript convention, and `interval-javascript`
reaches the same arrow emission without ever wrapping its arguments.

Pinned in `test/compute-engine/compile-complex.test.ts` ("a declared `complex`
PARAMETER"): the three wrap forms, the value position over a real source and
over a complex one, and the no-shim case. Verified non-vacuous — each fails
with the corresponding half reverted.

### A MULTI-CLAUSE function with a declared `complex` parameter compiles silently wrong (FIXED 2026-08-16 — the dispatcher lifts per clause)

Fixed as part of step 2 of `docs/plans/2026-08-16-compile-complex-mode.md`:
the emitted dispatcher now hands each clause helper its arguments in the shape
that clause's body was compiled for — `_SYS.cplx(_$a[k])` for a parameter
declared a non-real number type, the normalized value otherwise — AFTER
dispatch has been decided on the normalized arguments (`_SYS.creal`: an
exactly-real `{re, im: 0}` dispatches as the real number it is, so a value
clause `S(0)` and a `real`-typed clause select as the interpreter selects).
`S(w)` at `w = 2` now answers `3`. Under `mode: 'strict'` a complex-shaped
argument to a WIDE clause parameter is a `LaneMismatch` decline. Test:
`test/compute-engine/compile-mode-strict.test.ts`. Original report follows.


Surfaced while reviewing the declared-complex-parameter fix above, and
explicitly measured NOT to be caused by it: identical before and after, with
the same emitted code both ways.

    function S(0) -> complex { 0 }
    function S(z: complex) -> complex { z + 1 }

    compile(S(w)).run({ w: 2 })   ->  {"re": null}     success: true
    interpreter                   ->  3

The emitted call is a bare `_fn_S(_.w)` with no wrap. A multi-clause function
has no single literal, so `userFunctionLiteral` returns `undefined` and the
arrow emission — where a declared-complex parameter is put in the complex lane
— is never reached; it compiles whole, as a guard chain, in the real lane.
`coerceToComplex` also returns false, because `userFunctionParamType` declines
on an intersection signature and the `multiClauseParamIsComplex` fallback does
not fire for this shape. So neither half of the single-clause treatment
applies, and the body reads `.re` off whatever arrives.

Fix direction: give multi-clause bodies the same complex lane, or fail closed
on a clause set whose parameter is declared complex until they have it. Note
the review's stated mechanism for this entry ("the call site NOW wraps every
argument where before the gate limited the damage") does NOT hold — the call
site wraps on neither side; the defect is independent of the argument gate.

### A protocol MEMBER whose parameter is declared `complex` is handed the argument unwrapped (FIXED 2026-08-16 — same wrap forms as the single-literal call)

Fixed as part of step 2 of `docs/plans/2026-08-16-compile-complex-mode.md`:
the `isProvablyRealValued(a)` precondition is gone; the coercion is gated on
the PARAMETER's declared type alone (unanimous across candidates) and the wrap
form is the shared `complexWrapCode` (literal complex passes through, provably
real wraps statically, anything else takes the idempotent `_SYS.cplx`). The
dynamic dispatcher tests its receiver guards on the normalized receiver
(`_SYS.creal`). `scale(2, w)` at `w = 3` now answers `4`. Under `mode:
'strict'` a complex-shaped argument to a WIDE candidate parameter is a
`LaneMismatch` decline. Test: `test/compute-engine/compile-mode-strict.test.ts`.
Original report follows.


The third `coerceToComplex` computation — the multi-candidate member dispatch
in `userFunctionsPreamble` (`base-compiler.ts`, ~11203) — still opens with
`if (!BaseCompiler.isProvablyRealValued(a)) return false;`, the precondition
the two call-site computations dropped when the declared-complex-parameter
entry above was fixed. The candidate helper bodies carry `Typed` parameters, so
they lower in the complex lane, and an argument that is neither a complex
literal nor provably real reaches them unwrapped.

Measured identical before and after that fix, so it is pre-existing:

    protocol Scaler { function scale(self: Self, k: complex) -> complex }
    type real is Scaler { function scale(self: Self, k: complex) -> complex { k + 1 } }
    ce.declare('w', 'complex')

    emitted                 _fn_scale$Scaler$e0$cx(2, _.w)     <- no wrap
    run({ w: 3 })           {"re": null}                       success: true
    run({ w: {re:0,im:1} }) {"re": 1, "im": 1}                  correct

**The witness matters here.** The obvious shape — an UNTYPED symbol — cannot
reach this code: the protocol route validates first and fails closed with
`incompatible-type: complex vs unknown`. What reaches it is a symbol DECLARED
complex that receives a plain number at run time, which passes validation
because a real IS a complex. A reproduction attempt using an untyped symbol
will wrongly conclude the defect is not there.

Fix direction: the same treatment the other two sites got — drop the
precondition and route unanimous-complex positions through `complexWrap` /
`_SYS.cplx` — or state in the comment why these helper bodies are provably
real-lane.

### `.N()` declines convergent series whose tail is not an integer power of 1/N

The Richardson/Neville acceleration behind infinite-series `.N()`
(`acceleratedInfiniteSum`, `library/utils.ts`) extrapolates the partial
sums with `power: 1` — an asymptotic expansion in **integer** powers of
`1/N`. A convergent series whose tail does not have that shape never
certifies, and since the 2026-08-14 divergence ruling — an infinite-domain
big op under `.N()` whose convergence the acceleration cannot establish now
stays unevaluated rather than returning a truncated partial sum — removed the
truncation fallback, it now evaluates to itself instead of to a number.

Measured 2026-08-14 — the gap is narrow and specific:

| Series | `.N()` | True value |
| :--- | :--- | :--- |
| `Σ 1/n^1.5` | symbolic | 2.6123753487 |
| `Σ 1/n^2.5` | symbolic | 1.3414872573 |
| `Σ ln(n)/n²` | symbolic | 0.9375482543 |
| `Σ 1/n^2`, `1/n^3`, `1/n^4` | ✓ computes | — |
| `Σ 1/2^n`, `Σ 1/n!`, `Σ e^-n` | ✓ computes | — |
| `Σ 1/(n(n+1))`, `Σ 1/(n²+1)` | ✓ computes | — |

So: integer-power p-series, geometric, factorial and rational tails all
work; a **non-integer** power (`n^-1.5`) or a logarithmic factor does
not. For `Σ 1/n^p` the tail is `≈ N^(1-p)/(p-1)`, so the expansion runs
in powers of `N^(1-p)` — the `power: 1` Neville tableau is fitting the
wrong sequence.

Two candidate fixes, both standard: extrapolate with a **fitted** power
(estimate the tail exponent from successive partial-sum differences and
pass it as `extrapolate`'s `power`), or apply an **Euler–Maclaurin** tail
correction, which handles the logarithmic factors too. Whichever is
chosen must keep the divergence guarantee: acceptance stays gated on a
certified error estimate, so a divergent series still declines rather
than acquiring a plausible-looking value. Regression-test against the
table above, and add `Σ 1/n^1.5 = ζ(1.5)` as the headline case.

### `Divide` over a bare dimensioned list types one tier wider than the tuple and lift paths

Deliberately untouched when `quotientComponentType` (`arithmetic.ts`) landed on
2026-08-15: `vector<finite_integer^2> / <integer-valued call>` routes through
the boxed-function broadcast arm and types `vector<finite_number^2>`, where the
tuple and `broadcastable<...>` paths derive `finite_rational` for the same
arithmetic. The wider claim is SOUND, just imprecise. Tightening it means
changing the shared broadcast-arm element computation, a different blast radius
from the per-component derivation that fixed the tuple and lift branches —
measure the snapshot count before starting.

### `TYPE_CACHE` evicts by clearing the whole map — a real cliff, dormant today

`TYPE_CACHE` (`common/type/parse.ts`) is capped at 2048 entries and evicts by
CLEARING THE ENTIRE MAP, on the stated assumption that the working set of
distinct type strings is small. That assumption fails for types carrying
LENGTHS: every distinct vector size is its own type string
(`vector<finite_integer^303>`, `^304`, ...). Measured by re-parsing a working
set of W distinct length-typed strings in a loop: W <= 2048 costs
0.02-0.11 us/parse, W = 2100 costs ~3-4 us/parse — a ~150x cliff — and stays
flat above it, because clearing drops 100% of entries per overflow so the hit
rate collapses rather than degrading.

Eviction POLICY is not the fix, measured: FIFO eviction of the oldest entry was
slightly worse (5.8 vs 4.3 us/parse over-cap), since a working set larger than
the cache, re-parsed in a repeating order, is the worst case for any policy.
The levers are reducing the number of distinct type strings (cache a
length-parameterized type by structure, with the length as a parameter) or
sizing the cache to the working set.

**Dormant, with a re-open trigger.** No real workload engages it: the largest
consumer document measured mints 329 distinct type strings — ONE of them
length-carrying — with zero overflow clears and a 97.1% hit rate over 11,245
reads, and the hundreds-of-distinct-sizes pressure existed only in a synthetic
probe. So the structural levers stay unbuilt and observability landed instead:
`TYPE_CACHE` reports under `CE_CACHE_STATS` as the `typeParse` class (hits,
cold stores, and `evictClear` — the count of whole-cache overflow drops).
**`evictClear > 0` on a real workload re-opens this item.**

### Deadline granularity in the canonicalization walk (FIXED 2026-08-15; second observation of Tycho item 182)

The canonicalization walk honored a span deadline only BETWEEN stretches,
so a single long stretch could overrun a `withTimeLimit` budget — a ~2×
overrun was measured while the stretches were inflated by the item-182
probe storm. The storm fix shrank the stretches that made the overrun
visible; it did NOT change the granularity. A deadline is a correctness
boundary, and any future long-stretch workload (a huge literal, a
pathological rule set) reproduces it.

This was load-bearing for a consumer: Tycho's span-budget math
assumes a long canonicalization stretch can overrun its deadline by ~2×,
and stayed conservative until this closed (confirmed by them 2026-08-14).

**The filed ~2× UNDERSTATED it by orders of magnitude.** Re-measured
2026-08-15 before the fix: the walk honored the deadline not at all, and the
overrun scaled with the INPUT rather than being bounded by the limit. A sum of
`n` distinct non-trivial terms, parsed inside `ce.withTimeLimit({ ms })`, ran
to completion every time:

| n | 1 ms budget | 5 ms budget | 50 ms budget |
|---|---|---|---|
| 200 | 54 ms (54×) | 45 ms (9×) | 35 ms (0.7×) |
| 1 000 | 134 ms (134×) | 127 ms (25×) | 118 ms (2.4×) |
| 4 000 | 577 ms (577×) | 579 ms (116×) | 588 ms (12×) |
| 12 000 | 2 799 ms (**2 799×**) | 2 782 ms (556×) | 2 778 ms (56×) |

The ~2× in the original filing is what that curve happens to look like when
the budget is close to the whole cost of the walk; it is not a bound.

**FIXED** by the prescribed shape: a strided `checkDeadline` (stride 1024, the
idiom `common/interruptible.ts` documents) in `boxFunctionInternal`
(`boxed-expression/box.ts`), the per-node chokepoint of the canonicalization
walk. After it, the overrun is bounded by ONE stride and no longer grows with
the input: at n = 12 000 the same three budgets give 12 ms, 13 ms and 50 ms
(1.0× at the 50 ms budget). Cost on the un-armed path is one `undefined`
comparison — a 9-run A/B on a 2 000-term parse gives a 246–248 ms median with
the check enabled and disabled, i.e. inside the noise — because a deadline
frame is armed only by an enclosing `withTimeLimit` span.

Two corrections came out of the dual review of this change, both applied:

- **The stride counter lives on the FRAME, not in a module-level variable.**
  A shared counter is consumed by every engine in the process, and a canonical
  handler runs arbitrary caller code, so a nested canonicalization on a
  DIFFERENT engine can eat stride boundaries at moments when the engine being
  checked has no frame armed. The check is then a no-op and the engine that
  DOES have a budget waits up to another full stride — so the one-stride bound
  would not have held. A frame is created per span, so ticking it makes the
  bound exact (`DeadlineFrame.tick`, `common/interruptible.ts`).
- **A `canonical` handler must not swallow the cancellation.** Both
  `try`/`catch` blocks around `opDef.canonical(...)` in
  `applyOperatorDefinition` logged the error and fell back to a NON-canonical
  `BoxedFunction`. That is right for a handler that failed on its operands and
  wrong for a cancellation, and the strided check made it far more reachable —
  it now fires from inside any node a handler CONSTRUCTS. Measured before the
  fix with a node-building handler: `ce.withTimeLimit({ ms: 1 })` returned
  NORMALLY holding an `isCanonical === false` expression, with the breach
  visible only as a console line. That is worse than the overrun this entry
  fixes, because it looks like success. Both catches now re-throw a
  cancellation, matching every other catch site in the engine
  (`abstract-boxed-expression.ts`, `rules.ts`, `stochastic-equal.ts`,
  `boxed-function.ts`), identified by NAME rather than `instanceof` for the
  cross-bundle reason `canonicalErrorDetail` already documents.

  The wide-sum fixture could not have caught this: its operands are
  canonicalized BEFORE the handler runs, so its trip point is the
  operand-boxing loop, which sits outside the `try`. The regression uses a
  handler that builds nodes.

Pinned by `test/compute-engine/canonicalization-deadline-granularity.test.ts`.
Its assertions are on OUTCOMES (an unbounded walk COMPLETES, a bounded one
CANCELS, and the error carries the owning span's label), never on elapsed
milliseconds — the wall-clock test doctrine. Verified non-vacuous: disabling
the check fails exactly the two cancellation cases and leaves the two
control cases passing.

### The LaTeX parser was quadratic in the length of a flat operator chain (FIXED 2026-08-15)

Found while profiling the raw-parse half of the entry below. A flat chain
`a+b+c+…` is parsed iteratively — the `+` infix parser is invoked once per
operator, each time receiving the whole accumulated `Add` as its left operand
— and two things it did at every invocation were proportional to the chain
length so far, so the parse of an N-term sum was O(N²):

1. `expandContinuationAdd` (`latex-syntax/dictionary/definitions-arithmetic.ts`)
   re-walked EVERY accumulated operand looking for an ellipsis
   (`ContinuationPlaceholder`) so it could rewrite `Subtract` groupings — a
   `symbol()` call per operand per operator, ~N²/2 in total (501 500 calls at
   N=1 000, 2 003 000 at N=2 000). This was ~80% of the time at N=12 000.
2. `foldAssociativeOperator` (`math-json/utils.ts`) built a fresh
   `[op, ...operands(lhs), rhs]` at every operator: an O(k) copy AND O(k)
   allocation per operator, so a 12 000-term chain churned ~72 M array slots
   through the GC. This was most of the remainder — and it applied to every
   `"any"`/`"both"`-associative infix operator (`\cdot`, `\times`, …), not
   just `+`.

Neither is a per-token cost, which is why the growth curve LOOKED like a
linear parser with a quadratic term that only dominates past a few thousand
terms (0.9× per doubling to 3 000, 1.8× by 12 000), and why source LENGTH did
not predict time (a 28 900-char comma list parsed 4.6× faster than a
28 900-char `1+2+3+…`).

Fix: `parser.appendAssociativeOperand` (`parse.ts`) extends a chain array in
place when it is the parser's *owned chain* — the one array its previous
append at this `parseExpression` level returned, and which only the infix
loop's left operand references — so the copy happens once per chain; an array
from a dictionary constant, a custom `parse` handler or an earlier parse is
never the owned chain and is still copied. The state is a single slot per
parser (`_ownedChain`, saved/restored across nested `parseExpression` calls),
not a global registry. The ellipsis walk needs no memo: an owned `Add` chain
carries no continuation by construction (a chain that has one is replaced by
the expanded copy, which is not owned), so `rawHasContinuation` answers O(1)
for it and only `rhs` is walked. The three fold sites (`Add`,
`foldMultiplyChain`, the generic associative infix in `definitions.ts`) all
go through it. Parse output is byte-identical (56 parser suites unchanged).

Raw parse (`form: 'raw'`), medians of 3, fresh engine per run, quiet machine:

    shape (6 000 → 12 000 terms)   BEFORE            AFTER
    flat sum 1x+2x+…               472 → 1 745 ms     50 →  87 ms
    numbers 1+2+3+…                177 ms (6 000)     25 →  42 ms
    \cdot chain                    101 ms (6 000)     26 →  46 ms
    subscripted symbols x_1+x_2+…  511 ms (6 000)     47 →  88 ms
    parenthesized (1)+(2)+…        235 ms (6 000)     35 →  67 ms
    comma list [1,2,3,…]  CONTROL   38 ms (6 000)     36 ms (6 000)

Every shape now scales ~1.7–1.9× per doubling. The comma list is the
control: it never builds an accumulated infix chain, so the mechanism
predicts it should not move — and it did not (1.0×), while the shapes with
both costs improved most (subscripted symbols 11×), the `\cdot` chain with
only the copy cost least (2.2×). Independently re-measured by the session
that filed the original numbers, same harness, after the fix. Pinned by
`test/compute-engine/parse-flat-chain-linear.test.ts`, which asserts the
`symbol()` and `foldAssociativeOperator` call counts (deterministic, per the
wall-clock doctrine) — the counter assertions fail on the pre-fix parser.

**Consequence for the deadline entry below:** the numbers in it predate this
fix. The raw parse of a 12 000-term sum is now ~90 ms rather than ~700–1 700
ms, so the size of the exposure at document scale is an order of magnitude
smaller — but the parser still cannot be cancelled, and the argument that
tightening a budget buys nothing still holds unchanged.

### Boxing a long `1-2-3-…` chain overflows the stack (OPEN, correctness — DEFERRED BY RULING 2026-08-15, found in the flat-chain round above)

The LaTeX parser handles a subtraction chain iteratively and returns a
left-nested `Subtract(Subtract(Subtract(1, 2), 3), …)` (`latexSyntax.parse()`
succeeds at 1 500 terms), but BOXING that result — raw or canonical —
recurses once per nesting level and throws `RangeError: Maximum call stack
size exceeded` from `boxFunctionInternal` (`boxed-expression/box.ts`). So
`ce.parse('1-2-3-…-400')` throws while `ce.parse('1+2+3+…+12000')` succeeds.

Thresholds measured by bisection AFTER the same round's frame-headroom work
in `box.ts` (the `RAW_OPERAND` shortcut, which skips five frames per operand
on the recursive boxing path): **385 terms canonical, 749 terms raw**. The
raw path is where the headroom landed — it was about 600 before — while the
canonical path is essentially unmoved, so the shape a consumer actually hits
(`ce.parse` defaults to canonical) is no better than it was. The headroom
work reduced frames per level; it did not change the fact that boxing
recurses once per nesting level, so this stays a threshold, not a fix.

Pre-existing: reproduced on the pre-fix parser, and not addressed by the flat
chain fix above, which changed the `Add` and multiplicative folds only.

RULING 2026-08-15 (Arno): stays on the roadmap, not fixed in this round.
The two candidates below are both larger than the round that found it — one
changes `form: 'raw'` output and its pinned serialization, the other is a
general boxing change — and neither belongs in a pass cutting a release. The
threshold is unchanged from what shipped before, so this defers a
long-standing limit rather than accepting a new one.

Two candidate fixes, needing a ruling because the first changes raw parse
output: (a) have the `-` infix parser fold a subtraction run into one flat
`Add(a, Negate(b), Negate(c), …)` — the canonical form is that already, but
`form: 'raw'` output and its serialization would change (`Subtract` groupings
are pinned by `continuation-placeholder.test.ts` and the ellipsis machinery
above depends on seeing them); or (b) make deep-tree boxing tolerate the
depth (an explicit work stack, or a depth-triggered devolve), which is the
general fix — the same limit hits any ~400-deep tree, e.g. the parser's own
`(((…)))` overflow at ~2 000 levels noted 2026-08-15. Nothing decided on
these two; what HAS landed is headroom:

**Frame trimming (DONE 2026-08-15, same day):** the stack per nesting level
was 20 frames on the canonical path, of which 11 were plumbing that does no
work once a root repair is active — `withDevolveRepair → withRootRepair →
closure` entered twice per level (in `box()` and again in `boxFunction()`),
and each operand boxed through the PUBLIC `ce.expr()` (`expr → inHarvestScope
→ _inScope → inScope → closure`, re-installing the scope that is already
current). `box()`/`boxFunction()` now call through directly when the root is
active, and the operand-boxing sites in `box.ts` call the internal `box()`.
Canonical boxing: 20 → 9 frames per level; canonicalizing a raw-boxed tree:
26 → 15. Ceilings on the default Node stack (binary search, bare process):

    shape                              BEFORE            AFTER
    Sin(Sin(…(x))) canonical / raw     223 / 399         385 / 676 levels
    ce.parse('1-2-…-N') canonical/raw  358 / 1 131       621 / 2 524 terms

Behaviour unchanged (full suite, 4 306 snapshots). Pinned by
`test/compute-engine/boxing-depth-headroom.test.ts`, which measures frames per
level with a probe operator (deterministic; independent of stack size and of
the runner's own frames). This moves the cliff, it does not remove it —
`1-2-…-700` still throws.

**Second trim (DONE 2026-08-15, later the same day):** of the 9 remaining
frames per canonical level, four only dispatched: `Array.prototype.map` and
its callback, `box()` (whose two brackets — the inference transaction and the
root repair — are no-ops once a root pass is open) and `boxFunction()`.
Operands are now boxed by a `for` loop calling `boxInternal()` directly
(`boxOperands()` in `box.ts`, inlined at the two hottest sites),
`boxInternal()` calls `boxFunctionInternal()` directly when the root is
active, and `canonicalForm()` with no scope goes straight to the `.canonical`
getter instead of through `_inScope → inScope → callback`. Canonical boxing:
9 → 5 frames per level (`boxInternal → boxFunctionInternal →
makeCanonicalFunction → makeCanonicalFunctionCore → applyOperatorDefinition`);
canonicalizing a raw-boxed tree: 15 → 8. The remaining `makeCanonicalFunction`
frame is real work (it brackets `_inferenceCause`) and stays.

Bytes of stack per level, measured as Δ`--stack-size` / Δceiling in a fresh
process (the ceilings themselves are JIT-state dependent — Ignition and
TurboFan frames differ in size, so a warm process can sit 30% either side of
a cold one; frames and bytes per level are the numbers to compare):

    path                          BEFORE (9 fr)   AFTER (5 fr)   trivial fn
    canonical boxing              2 080 B/level   1 570 B/level   89 B/frame
    raw boxing                    1 220 B/level     630 B/level

So the four removed frames were the small ones (~125 B each); the five that
remain average ~315 B. An Ignition frame is the function's whole register
file — every local and temporary in the function, whichever path runs — and
`makeCanonicalFunctionCore` (468 lines, 32 locals), `applyOperatorDefinition`
(292, 14) and `boxFunctionInternal` (227, 18) stay live across the recursion.
The next step down is therefore structural, not dispatch: split those three
so the recursive call is reached through small dispatchers and the
non-recursing arms (`List`/`Dictionary` fast paths, spread handling, error
construction, the number/symbol/string arms of `boxInternal`) live in helpers
that are called and returned from before the recursion. Expected gain another
~1.5–2×; still a cliff. Removing the cliff needs the (a)/(b) ruling above.

### The LaTeX parser cannot honor a deadline at all (OPEN, correctness — found while fixing the canonicalization deadline-granularity entry)

The canonicalization fix above bounds the SMALLER and better-behaved half of
`ce.parse(…)`. The RAW PARSE is the expensive half, it grows superlinearly,
and it is the unbounded one — so the share of `ce.parse()` that ignores a
deadline gets worse as inputs grow. Medians of 3, fresh engine per run,
`form: 'raw'` isolating the parser from canonicalization:

    N        raw parse   canonicalization   raw : canon
    3 000     71 ms          45 ms            1.6 : 1
    6 000    209 ms          49 ms            4.3 : 1
    12 000   719 ms         111 ms            6.5 : 1

Canonicalization is close to linear; the parser is not (roughly 3x per
doubling). An earlier note on this entry recorded the two halves as "about the
same" from a single 6 000-term measurement of 608 ms and 657 ms — that pairing
does not reproduce, and taking one size as the ratio hid the fact that the
ratio itself moves.

`form: 'raw'` does NOT avoid the problem, which is worth stating because it is
the obvious workaround: skipping canonicalization skips the half that is
already bounded and keeps the half that is not. A raw parse under a 1 ms
budget and under a 50 ms budget both ran ~560 ms.

**The consumer-facing danger is not the size of the overrun, it is that
TIGHTENING THE BUDGET BUYS NOTHING.** Elapsed time is essentially independent
of the budget, because the parse runs to completion and only then notices it
was cancelled. Measured 2026-08-15 on a 12 000-term sum, against the now-fixed
canonicalization half for contrast:

    CANONICALIZE   budget  1 ms → elapsed  17 ms   (17x)
    CANONICALIZE   budget 50 ms → elapsed  51 ms   (1.02x)
    PARSE          budget  1 ms → elapsed 832 ms   (832x)
    PARSE          budget 50 ms → elapsed 795 ms   (16x)

So an operator tuning a span DOWNWARD to bound a risk does nothing at all
while believing the risk is bounded — no error, a plausible configuration, and
no effect. That is worse than a large constant overrun, which at least
responds to the knob. A consumer whose spans wrap parse AND canonicalization
has, after the fix above, bounded the half that was already the more
responsive one.

**FIELD EVIDENCE (consumer audit, 2026-08-15): on the paths where this
matters most, the canonicalization fix buys nothing at all — not half.** The
consumer already passes `form: 'raw'` at its three hottest parse sites: the
Desmos import session (their largest workload, with no deadline armed at any
level), the action-firing path (a 50 ms budget, one parse per step), and
formula classification (a 5 000 ms budget). Because `form: 'raw'` skips
canonicalization entirely, 100% of the cost at those sites is in the unbounded
parser. Their audit had recorded the exposure as "half fixed, half remaining",
which was wrong in the reassuring direction for exactly the sites that matter.

**FIELD MEASUREMENT ON REAL CONTENT (Tycho, on imported Desmos formula
slots, 2026-08-15) — quote this WITH its shape caveat or not at all.** 6 679
slots across 585 states: **0.232 ms/slot raw, 0.380 ms/slot canonical, worst
single slot 71 ms** (a 69 KB list literal), and the **worst slot under a 50 ms
span elapsed 53.9 ms — 1.08x**, against the ~110 ms the synthetic curve above
projects.

The caveat is not decoration: **their slots are wide flat LIST LITERALS, not
deep operator chains**, which is exactly why they land an order of magnitude
under the projection. Quoted bare, these numbers support "the unbounded parse
is not a problem in practice", which is FALSE for content that is deep chains
rather than wide literals. The field number is evidence for that shape; the
synthetic curve remains the right guide for the other. Recorded at the
consumer's own insistence, and against their interest — it lowers the urgency
of work they had asked us to prioritise.

Priority argument for whoever picks this up: the action-firing span is an
INTERACTIVE path — a user waiting on a direct interaction, with the budget
chosen to protect responsiveness — while every other exposed span they have is
background or batch, where an overrun costs throughput rather than perceived
latency. That is the case where fixing this changes user-visible behaviour
rather than tightening a bound.

This is NOT the same fix. The parser has **no engine handle at all**: nothing
under `latex-syntax/` references `ComputeEngine`, `_deadlineFrame` or
`_timeRemaining`, which is deliberate — `LatexSyntax` is an injected,
structurally-typed dependency (`ILatexSyntax`), and that decoupling is the
architecture described in `CLAUDE.md` and
`docs/architecture/CURRENT-ARCHITECTURE.md`. So there is no deadline for a
strided check to read, and adding one means threading a deadline (or an
abstract "should I stop" callback) across the `ILatexSyntax` boundary.

Fix shape when picked up: give the parser an optional cancellation callback
supplied at construction or per-parse, checked strided in `parseExpression`
(`latex-syntax/parse.ts`), the recursive chokepoint of the parse walk — and
keep it engine-agnostic so the boundary stays structural. Deferred from the
2026-08-15 round deliberately: it is an interface change to a decoupled
subsystem, not the localized addition the canonicalization half was, and it
should not land in the same pass as a release.

### `executeEpsil` ran on past an expired time budget, and the Epsil parser was quadratic (FIXED 2026-08-15)

Two defects on the Epsil side of the same "budget is decorative" family as the
two LaTeX-parser entries above — but a SEPARATE mechanism (Epsil has its own
`lexer.ts`/`parser.ts`/`execute-epsil.ts`; nothing in the LaTeX-parser fix
touches it, and a consumer note that recorded the two as "riding the same
fix" was wrong).

**Budget.** `executeEpsil` caught every `CancellationError` per statement,
converted it to an error value (`evaluation-canceled` diagnostic when
non-final) and CONTINUED with the next statement. The engine only checks the
deadline inside long-running work (every 256 evaluations, inside collection
walks), so a program of many cheap statements finished however far past its
deadline it was. Measured on 5 000 `xN = N + 1` statements, cold engine:

    budget    BEFORE                             AFTER
    none      840 ms  completed                  219 ms  completed
    1 ms      621 ms  completed, 20 timeout      29 ms  value = Error(timeout),
                       diagnostics (1 in ~250            stopped at statement 1,
                       statements)                       1 diagnostic
    50 ms     506 ms  completed, 20 diagnostics   51 ms  stopped
    200 ms    458 ms  completed, 20 diagnostics  146 ms  completed (fits)

Severity — CORRECTNESS, not latency (the consumer's framing, which is sharper
than the original filing and is the reason the fix matters): the two failure
modes have the identical observable (flat elapsed, "completed"), but "overran
its budget" and "ran a program with 20 statements missing from the middle,
then kept executing against the resulting state" have very different blast
radii. Imperative-with-errors-as-values is exactly the semantics where a
skipped assignment is least detectable — nothing throws; later statements read
a stale or absent binding and produce a plausible value. Consumer field
evidence on the diagnostics point: their notebook evaluator
(`ce-notebook-evaluator.ts:1227`) routes a cancellation to a first-class
`timeout` outcome before the ok path and surfaces every diagnostic on the ok
path — so at least one host does read the surface, which matters if the
count-based-cancellation ruling below is ever argued on "nobody reads
diagnostics".

The static pass had the same swallow site — `catch { continue }` around
`ce.box(statement)` — so a timeout raised while boxing was eaten as "a
statement the engine cannot box". Fix: `checkDeadline(ce._deadlineFrame)`
before every statement in both loops; the static pass rethrows a timeout
(`isTimeoutCancellation`, by name for cross-bundle safety) and writes its
findings into the caller's array as it goes (a `static-type-error` established
before the breach is kept — dual review, Codex finding); `executeEpsil`
catches the throw, skips the advisory pre-evaluation scans, and lets the
evaluation loop's own first check record the cancellation; the evaluation
loop `break`s after a `timeout` cancellation. Count-based caps are per-construct configuration
(`docs/TIMEOUT-MODEL.md` §9) and deliberately still continue.

Not changed, but now documented (`src/epsil/docs/evaluation.md`
Interruptibility): a `for`/`while` cut short by `iterationLimit` leaves its
partial assignments in place, so `total = 0; for i in 1..5000 { total =
total + i*2 }; total` yields 1 051 650 (24× under the true 25 005 000) with
an `error`-severity `evaluation-canceled` diagnostic on the loop and NO error
on `value`. This is the errors-are-values contract applied to an imperative
statement, not a truncation the interpreter hides — but a host that renders
`value` without `diagnostics` shows a wrong number. Whether a count-based
cancellation should ALSO end the program (making both kinds fatal) is a
product ruling; the current split follows the timeout model's budget-vs-config
distinction.

**Parser.** `startsWithSymbolToken` (the positional-`=` check: does the
left-hand side START with a symbol token, so `+x = 5` compares while `x = 5`
assigns) scanned `this.tokens` from index 0 for every bare-`=` statement —
O(N²) over the program; 69% of a 16 000-statement parse. Now a binary search
(`firstTokenAtOrAfter`, tokens are in source order). Second-order: the lexer's
character predicates (`isBreak` etc.) did `Array.prototype.includes` on
`PATTERN_SYNTAX`, an expanded array of thousands of code points, per source
character — now `Set` views. Parse of `xN = N + 1` programs:

    N        BEFORE                AFTER
    500       9 ms  (18 µs/stmt)    5 ms  (9 µs/stmt)
    2 000    77 ms  (39 µs/stmt)    7 ms  (4 µs/stmt)
    8 000   521 ms  (65 µs/stmt)   29 ms  (4 µs/stmt)
    16 000 1765 ms (110 µs/stmt)   61 ms  (4 µs/stmt)

The static pass and the evaluation loop are both linear (measured 2 000 →
8 000 statements). The Epsil parser itself has no engine handle
(`parseEpsil(source)`), so the raw parse — now ~4 µs/statement — is the one
phase still outside the deadline; `executeEpsil` checks it immediately after.

Pinned by `test/epsil/execute.test.ts` ("an expired time budget ends the
program": an already-expired span runs no statement; a host function that
expires the deadline mid-program stops the following statement while the
preceding one keeps its effect; a count-based cap does NOT stop the program;
`staticDiagnostics` under an expired span throws and leaves the engine clean —
outcome assertions, no elapsed-time assertions). The positional-`=` behavior
the token lookup serves is pinned by `test/epsil/lints.test.ts` (`+x = 5`,
`(x) = 5`).

### `evaluate()` eagerly expands symbolic `Product`s, then distributes — superlinear blowup on the plotting shape (OPEN, perf/design)

Measured 2026-08-14, bare, machine precision, free symbols, on Tycho's
`ioclpgtwi1` row
`1 - Map(Z ↦ Σ_{i=1..Z} (1/i!)((1-x)/n)^i ∏_{k=1..i-1}(kn-1), 1..N)`:

| N | median | | binding | median |
|---|---|---|---|---|
| 2 | 26 ms | | free `x`,`n` | 2062 ms |
| 4 | 145 ms | | bound (`n=5`, `x=0.5`) | 39 ms |
| 6 | 409 ms |
| 8 | 1085 ms |
| 10 | 3629 ms |
| 12 | 4923 ms |

~140× for a 5× increase in N (roughly cubic-to-quartic), and ~53×
free-vs-bound on the identical row.

**Mechanism, confirmed by ablation and by direct probe.** Two behaviors
compose. (1) A symbolic `Product` EXPANDS to a polynomial under
`evaluate()`: `∏_{k=1..8}(kn-1)` returns the 9-term
`40320n^8 - 109584n^7 + …`, not the compact product. (2) Multiplying an
expanded polynomial by anything then DISTRIBUTES — `(n-1)(1-x)^2`
evaluates to `n(1-x)^2 - (1-x)^2` — which is the documented `mul()`
behavior (see `mul-distributes-over-sums`), harmless in isolation and
quadratic here. Together: the product contributes ~i terms, distribution
multiplies them across the `(1-x)^i` factor, the Σ sums that over
i=1..Z, and the `Map` repeats it for Z=1..N.

Ablation at N=8 (median of 3, full row = 1311 ms) shows the cost is
SUPERADDITIVE, so no single sub-term owns it: removing the product →
158 ms, removing the factorial → 423 ms, removing the symbolic power →
1081 ms; but each sub-term ALONE is cheap (product only 184 ms, power
only 109 ms, factorial only 16 ms — 309 ms summed against 1311 ms
combined).

**Why this is worth changing rather than accepting.** `evaluate()`'s
contract is the most EXACT form, not the most expanded one — an
unexpanded `∏(kn-1)` is equally exact and dramatically smaller, and
expansion is `expand()`'s job. The cost also lands precisely on the
structural plotting case: a plot axis variable CANNOT be bound, so a
consumer plotting this function always pays the free-symbol path. Tycho
hit it as a 4–9 s evaluation behind a 500 ms probe budget.

Fix shape when picked up: stop expanding a symbolic `Product` whose
bound is symbolic during `evaluate()` (leave it as a `Product` and let
`expand()` open it), and/or avoid `mul()`'s distribution when either
operand is a many-term sum. Note the second lever alone is not enough —
the ablation shows the terms interact, so measure both. Any change here
needs the snapshot blast radius measured first; product expansion is
long-standing behavior with wide pin coverage.

### `process.env`-gated diagnostics are stripped from the published bundle

Measured against `dist/esm-min/compute-engine.js` (2026-08-14): `process.env`
occurs 0 times, and so do `CE_CACHE_STATS` and `mapAutoCompileStats`. Every
`process.env`-gated diagnostic in this repo — `CE_CACHE_STATS`,
`CE_DEBUG_DEPS`, `CE_MEMO_PARANOID` — is therefore ELIMINATED from the
published artifact, not merely defaulted off in it. They serve CE's own
Node-side debugging and CI, and are unreachable for EVERY consumer of the
package, browser or Node alike; adding another one reproduces the same dead
end a consumer already hit asking whether a `Map` drain compiled.

The established shape for a consumer-reachable diagnostic is an `_`-prefixed
ENGINE MEMBER (`_deadline`, `_random()`, `_compile()`, and now
`_mapAutoCompileStats`): it survives bundling, needs no subpath export, and
works in a browser, which is where the consumer asking the question runs. One
surface was converted that way on 2026-08-14; whether the remaining env flags
should follow is UNDECIDED as policy. Note for whoever picks it up: a new
engine member must also be declared on `IComputeEngine` (`types-engine.ts`) —
that applies to `_`-prefixed members too, 60 of which are already declared
there — so each conversion is an implementation + interface change, not a
one-file edit.

### A collection-TYPED but valueless operand was mishandled by seven operator families (FIXED 2026-08-15 — all seven closed)

Audited 2026-08-15 across all 95 `.isCollection` predicate sites in
`src/compute-engine` (71 are genuine capability checks and are correct as
they stand). `.isCollection` asks "can I enumerate this NOW", and is false for
a symbol declared `list<number>`/`vector<2>` with no value yet, or an
application whose head returns one. Sites that use it to ask the different
question "is this operand collection-SHAPED" therefore take a scalar path for
an operand that is not a scalar. Every line below was reproduced on a bare
engine; each pairs the wrong answer with the answer the same expression gives
once the symbol is assigned, which is what makes them wrong rather than merely
undecided.

    Sum(L), Product(L)   L: list<number>   → L        (→ 6 once L := [1,2,3])
    Element(1, SetMinus(Set(1,2), L))      → True     (→ False once L := [1])
    Union(L, Set(1))                       → Set(L,1) (→ Set(5,1) once L := [5])
    Add(Missing, L)                        → NaN      (→ [NaN,NaN] once assigned)
    Mean(L), Median(L)                     → NaN      (→ 2 once L := [1,2,3])
    Which(B,1,True,2)  B: list<boolean>    → THROWS out of evaluate()

DISCHARGED 2026-08-15 by the `subsetOf` convention sweep (the entry below):
the `Subset(EmptySet, S)` row is fixed. `subset()` no longer gates on
`.isCollection` alone — an operand that is not a collection NOW is a decided
`False` only when its TYPE rules a collection out
(`typesOverlap(op.type.type, 'collection')`), and everything else is
undecided, with `subset()` and the two `subsetOf` method implementations
(`boxed-function.ts`, `boxed-symbol.ts`) widened to `boolean | undefined` so
the operators stay symbolic. Verified here: with `S` declared `set<number>`
and unassigned, `SubsetEqual(EmptySet, S)` and `SubsetEqual(Set(1), S)` both
stay unevaluated, while `Subset(3, Set(1))` is still a decided `False`. Do
NOT re-fix this row; the six others below are untouched.

Ranked by severity: `Sum`/`Product` and the statistics helpers commit a
plausible-looking value that a later assignment contradicts, and `SetMinus`
INVERTS a membership answer (`True` before assignment, `False` after) in a
subsystem where a wrong `True` feeds assumption discharge. `Which`/`If`
hard-throw where they should stay symbolic — and the compiled path already
gets this right (`interval-javascript-target.ts` tests
`c.isCollection || c.type.matches('collection')`), so interpreter and compiler
disagreed about what a collection-typed condition is.

Two of these are guard FAMILIES where a partial fix reopens the hole on
another route: `Sum`/`Product` is four guards (`library/arithmetic.ts` at the
canonical and evaluate sites, `library/utils.ts` in `canonicalBigop` and
`bigopGenerator`), and `SetMinus` is three copies of one rule
(`library/sets.ts`, the eager, Kleene and query-decomposition forms).

For `Sum`/`Product` the fix is NOT to widen the capability tests: that would
send a valueless body into the reducer, which walks zero elements and answers
`Sum(L) → 0` — a worse wrong answer than `L`. The fall-through in
`bigopGenerator` DECLINES instead, which is what the 2026-08-11 ruling
already made `ListFrom`/`SetFrom`/`TupleFrom` do for the same operand class.

**RESOLUTION (2026-08-15).** All six remaining families fixed; every row above
now stays symbolic on the valueless operand and is unchanged once the symbol
is assigned. One shared predicate, `isValuelessCollectionTyped()`
(`collection-utils.ts`), states the operand class in one place, using the
`!isCollection && type.matches('collection')` spelling the comparison
operators (`undecidedCollectionComparison`) and the emitters already used —
NOT `typesOverlap(…, 'collection')`, which would also reclassify every
top-typed symbol and is a much larger change. The six sites:

- `Sum`/`Product` — the `indexes.length === 0` fall-through in `reduceBigOp`
  (`library/utils.ts`) returns `NON_ENUMERABLE_DOMAIN`. All four
  `reduceBigOp` call sites in `library/arithmetic.ts` (sync and async, both
  operators) already map that to a decline, so one edit closes the family.
- `SetMinus` — all three copies: the eager fold declines when any exclusion
  operand is of this class, and `isExcludedByKleene` and the
  `membershipKleene` query decomposition answer `undefined` instead of
  falling to their scalar disequality arm.
- `Union` — the singleton promotion now tests `type.matches('collection')`
  rather than `'set'`, so a valueless `list` operand is no longer collapsed
  into one element.
- The missing-value behavior gate (`boxed-function.ts` steps 4a and 3a) —
  "no collection operand" reads as collection-SHAPED. Both gates gained the
  disjunct together; they decide the same question on two routes.
- The statistics aggregates — `Quartiles`/`InterquartileRange` had applied a
  symbolic-datum guard since they were written and were already correct; the
  other nine reached the numeric kernels, which read a valueless symbol as
  `NaN` via `.re`. The rule is now shared (`hasSymbolicDatum`) and applied to
  all eleven, so they cannot drift apart again. This also fixes the same
  defect for a valueless SCALAR symbol (`Mean(y)` committed `NaN`).
- `Which`/`If` — `isBooleanishCondition` holds a condition whose type is
  already a boolean collection but which carries no value, ending the
  interpreter/compiler disagreement. The throw is still reserved for a
  condition that can never be boolean, where the spell-check hint is the
  useful outcome.

Pinned by `test/compute-engine/valueless-collection-typed-operand.test.ts`
(38 cases), which writes every row as a PAIR — symbolic while valueless, the
real answer once assigned — so a fix that made an operator inert forever
would fail. Blast radius measured: the full suite is green with **zero**
snapshot changes (4 306 snapshots).

Fixed in this pass, recorded here because they came from the same audit: the
`Equal`/`NotEqual` broadcast crash (see the CHANGELOG entry) and its latent
twin `undecidedCollectionComparison`, which was the un-widened half of the
same guard pair and was resting on `eq()` happening to decline.

Also fixed since (2026-08-15, with the `subsetOf` operand-convention sweep —
see the CHANGELOG): `Subset(EmptySet, S)` with `S` a declared, unassigned
`set<number>` answered `False` and flipped to `True` on assignment. The
`Subset` family now leaves the relation unevaluated when an operand's type
still permits a collection, and answers `False` only when the type rules one
out.

### `_mapAutoCompileStats` is a process-global singleton with three undocumented gates (DOCUMENTED 2026-08-15 — not a defect)

The accessor shipped in 0.110.0 so a consuming process could see whether a
lazy `Map` drain compiled. It works. But it has six ways of handing a careful
person numbers that look right and are not, none of which throws or warns —
so the resolution below should lead with a WORKED WRONG MEASUREMENT, not a
list of rules. Every one of these was found by a competent person doing
something reasonable.

Start with the one that fires on the most reflexive debugging action there
is, printing the value:

    const stats0 = { ...ce._mapAutoCompileStats };
    const r = ce.parse(MAP).N();
    console.log(r.evaluate().toString());          // ← "just looking at it"
    const d = delta(stats0, ce._mapAutoCompileStats);   // attempts 1, hits 10

That reads as "`evaluate()` compiles 10 elements". It does not: `evaluate()`
compiles NOTHING, and `toString()` is the consumer. Serializing a lazy result
materializes a fixed 10-element preview regardless of n, so stringifying
inside a measured region both does work and RELOCATES the attribution onto
whatever call preceded it. The reader ends up with a coherent, wrong causal
picture in which nothing looks off. This is how the row was first
mis-measured here, across five construction paths and the published bundle,
all agreeing — because they were one measurement repeated. **Read the
counters BEFORE stringifying anything.**

Two structural properties make it easy to conclude the accessor is broken,
and the first consumer to try it did:

- The counters are a MODULE-LEVEL object shared by every engine in the
  process. `new ComputeEngine()` does not reset them, so absolute reads are
  meaningless and a multi-engine process aggregates. There is no reset on the
  public surface.
- They move only when THREE independent gates are met, none of them mentioned
  where the accessor is documented, and each failing the same silent way —
  zeros that read as an absence of activity rather than an inert instrument:
  1. `ce.precision = 'machine'`. At the default bignum-preferred precision the
     float tier never attempts (at bignum the interpreter produces digits
     float64 cannot match, so the gate itself is correct).
  2. A numeric route — `.N()`, or `.evaluate()` on an `N(…)`-marked body. A
     bare `.evaluate()` reports zero at any drain size.
  3. The lazy result must actually be CONSUMED. `.N()` on a `Map` returns a
     lazy collection; if nothing iterates it, nothing compiles and every
     counter stays 0 with the first two gates satisfied. Measured: n=200
     consumed gives `attempts` 1 / `compiledHits` 200, unconsumed gives 0/0.

  "Consumed" is narrower than "touched", which is worth stating explicitly:
  measured by stepping one expression and reading the counters between each
  call (n=2000, machine precision, `Range`-sourced):

      .N()          0 / 0      builds the lazy collection, compiles nothing
      .evaluate()   0 / 0      compiles NOTHING
      .toString()   1 / 10     serializing materializes a 10-element preview
      [...each()]   1 / 2000   the whole drain
      .at(1500)     1 / 1      exactly one element
      .count        0 / 0      answers structurally
      .json         0 / 0      answers structurally

  The `toString()` row is the one warned about at the top of this entry. The
  other rows matter mostly to probe authors; that one fires on ordinary use.

Measured 2026-08-15: at machine precision on the `.N()` route a 20-element
drain gives `attempts` 1 / `compiledHits` 20, while the same expression at
default precision, or drained through a bare `.evaluate()`, gives zeros at
2 000 elements. Drain size and body shape do not gate it at all — n=20 counts
exactly like n=2000, and `sin(x)`, `x^2+1` and `sin(x)+x^2` behave alike.

`iterationLimit` never gates the COUNTERS, but it does bound the DRAIN for a
comprehension-sourced collection, and only for that. Holding the boxing, the
assigned symbol and the `Map` constant and varying only the source:

    Map over Range (parsed or boxed)        drained 2000, clean
    Map over an assigned COMPREHENSION      drained 1024, then cancelled
    Map over an assigned Range (control)    drained 2000, clean
    same three with the limit raised        all drain 2000, clean

The limit is spent materializing `[i for i = 1..2000]` before the `Map` ever
drains, hence the stop at exactly the 1024 default; `Range` is lazy and costs
no iterations. So an instrument sourced from a comprehension must raise
`iterationLimit` above the element count, while a `Range`-sourced one need
not. This is a source-shape property, not a defect. It stayed hidden through
several rounds on two independent harnesses because both only ever tested
`Range`-sourced collections — n=5000 and limit=50 runs were rigorous on the
axis that was not the gate.

The compile CACHE and the COUNTERS have DIFFERENT SCOPES, which is worth
stating side by side because the natural assumption is that they match: the
cache keys on the SHAPE (re-parsing does not defeat it) and is PER-ENGINE,
while the counters are MODULE-WIDE. So a second measurement of the same `Map`
shape in the same engine reads 0/0. Anyone comparing routes by running them
in sequence — the natural way to build the table above — gets a real number
for the first route and zeros for the rest, which reads as "only `each()`
compiles". Measure each route in a FRESH engine, and still take deltas,
because the singleton is orthogonal to the caching.

THE SIX SILENT-ZERO PATHS, for the note to cover. None throws, none warns,
and each returns numbers a careful person would believe:

1. `toString()` consuming and relocating the attribution (above) — the only
   one that fires on ordinary use rather than on a probe design.
2. Carried-over totals read as absolutes, because the counters are a
   module-level singleton with no reset.
3. An unconsumed lazy result: gates 1 and 2 met, nothing iterates, all zeros.
4. A structural `count`/`json` read — the confirmation step a careful person
   reaches for BECAUSE they are being careful — compiling nothing.
5. A cached second measurement of the same shape in one engine.
6. An unverified correction from a trusted source. Recorded because it
   happened twice in this investigation, in both directions: a first-party
   measured claim was retracted on a peer's report without re-measuring, and
   separately five agreeing measurements were treated as five confirmations
   when they were one measurement repeated. Consistency across an axis that
   is not varied reads exactly like corroboration.

**RESOLVED 2026-08-15 as the documented note**, not the per-engine snapshot.
The accessor works; every wrong number above came from a probe reading the
instrument off-route, so the gap was documentation, not behavior — and a
per-engine snapshot would have been a real behavior change (the counters
instrument a module-level compile cache shared by every engine, so per-engine
counters would describe something the cache does not do).

The note lives on the accessor's own declaration, `_mapAutoCompileStats` in
`types-engine.ts` — the surface a consumer actually reads before using it,
rather than a separate document they would have to know to look for. It leads
with the WORKED WRONG MEASUREMENT (the `toString()` relocation, which fires on
ordinary use rather than on a probe design), then names the three gates, the
route table showing that "consumed" is narrower than "touched", and the
counter-vs-cache scope split that makes a second measurement of the same shape
in the same engine read 0/0. The `iterationLimit`/comprehension interaction is
recorded there too, as the source-shape property it is.

Not carried into the note, because they are about how to run an investigation
rather than how to use the accessor: silent-zero path 6 (an unverified
correction from a trusted source, which happened twice here in both
directions) and the general lesson that consistency across an axis you never
varied reads exactly like corroboration. Those belong to method, and are
recorded in this entry above.

### An indexed read out of a collection with complex elements was classified from the WHOLE collection (FIXED 2026-08-15; this also closed the `complexPromotion` collection-body item)

The filed item was "`complexPromotion` does not look through a
COLLECTION-valued user function". Investigating it found a larger defect
underneath, on the DEFAULT compile path with no option set, and fixing that one
closed the filed item as a side effect.

**RETRACTED 2026-08-15 — the witness attribution, not the defect.** The item
was filed with the argument that the collection-valued boundary was "exactly
the shape of the witness the item was filed for", the consumer's chain running
through a `PointList`. That argument was withdrawn by the consumer: the probe
behind it called a method that does not exist on their tagged-union
`ParametricFunction`, so every sample threw into a bare `catch` and was counted
as non-finite. **It reported 0/201 unconditionally — every route, every flag
state, every engine version, and so could not have returned anything else.**
Re-measured correctly, their witness samples 186/201 finite with the flag ON
and 0/201 with it OFF, and — the decisive control — **186/201 on 0.110.0 too,
before this fix**. So the delta is the FLAG, not the release, and the
collection boundary never blocked that witness: the complex value arises in a
scalar body the look-through already reached.

What survives unchanged: the boundary was a REAL defect and this fix is real.
`w(t) := [√(t−1), √(t−2)]` with `|w(t)[1]/2 − 1|` genuinely flips `NaN` →
1.08397416943394 across the version bump, verified here and on their bundle.
The fix stands on that, not on the witness. Recorded because scoping or
sequencing arguments that cite "this is the shape the consumer actually hits"
must not survive the evidence they rested on.

A list is emitted ELEMENT BY ELEMENT and each element picks its own
real-vs-complex lowering, so the run-time array is heterogeneous: `[i·t, 1]`
lowers to `[{re, im}, 1]`. An indexed read was nonetheless classified from the
whole collection — `ops.some(isComplexValued)` for a literal list, and a flat
decline for a call to a user function with a collection body — and that verdict
describes no individual element. It was wrong in both directions, and both ran
to a silently wrong value behind `success: true`. Measured 2026-08-15 at
`t = 0.3`, no compile option set:

    [i·t, 1][2] + 1                      → {re: NaN}            (interpreter 2)
    h(t) := [i·t, 1] ;  h(t)[1] + 1      → the STRING "…1"      (interpreter 1 + 0.3i)
    2·h(t)                               → [NaN, 2]             (interpreter [0.6i, 2])

The first OVER-claims (the list holds a complex element, so the plain `1` pulled
out of it is read as `{re, im}` and `.re` is `undefined`); the second
UNDER-claims (the call is classified real, so the `{re, im}` pulled out of it is
added to a number and JavaScript concatenates the object); the third is the same
under-claim reaching the broadcast closure, whose complex-element test was
TYPE-based and answered `false` because a mixed list unifies to a wide element
type (`vector<finite_number^2>`, neither complex nor real).

Fixed by reading the element the emitter will actually produce
(`isComplexValuedElementAt`, `uniformElementComplexness`,
`hasAnyComplexElement` in `compilation/base-compiler.ts`): a literal index names
one element, and a run-time index is answered when every element agrees. A
run-time index into a collection whose elements DISAGREE has no static answer
and fails closed (D6, user-ruled 2026-08-15) rather than emitting a coin flip.
Pinned in `test/compute-engine/compile-complex-element-access.test.ts`.

**Why this closed the `complexPromotion` item.** The opt-in always promoted
INSIDE a collection-valued body — `_fn_w` returned `[{re, im}, {re, im}]` — and
what was missing was the call site reading those elements as complex. Both the
`List` and `PointList` body shapes now match the interpreter:

    z(t) := √(t−1)           ;  |z(t)/2 − 1|      OFF NaN  ON 1.08397416943394
    w(t) := [√(t−1), √(t−2)] ;  |w(t)[1]/2 − 1|   OFF NaN  ON 1.08397416943394
    p(t) := PointList(√(t−1), √(t−2)) ; |p(t)[1]/2 − 1|    OFF NaN  ON 1.08397416943394

The promotion rule itself is unchanged, and the default path is unchanged except
for the wrong values above. The two discriminators recorded with the original
item both still promote (a nested scalar call — nesting in the BODY — and a
two-argument call with a radical inside divided by another call), so all four
shapes promote together.

The ordering-comparison consequence recorded with the original item does reach
indexed reads now: with promotion ON, `Less(w(t)[1], 2)` fails closed. What it
replaces is not a working comparison — measured before the fix, that expression
compiled to a CONSTANT `false` (`{re, im} < 2` is never true), wrong at `t = 2`
where the interpreter answers `True`. Ruled 2026-08-15: land it.

### Four collection operators have no lowercase `\operatorname{}` LaTeX entry, so they parse as undeclared functions (FIXED 2026-08-15)

`\operatorname{unique}(C)`, `\operatorname{sort}(C)`, `\operatorname{total}(C)`
and `\operatorname{reverse}(C)` do NOT resolve to `Unique`/`Sort`/`Total`/
`Reverse`. They parse as an `InvisibleOperator` application of an undeclared
head, which then AUTO-DECLARES — so there is no error, and the result carries a
plausible-looking type (`list<unknown>`), which is exactly the shape that
survives review.

The gap is an inconsistency rather than a policy, which is what makes it a
defect: eight sibling names in the same family DO resolve from their lowercase
spelling. Measured with `form: 'raw'` on a bare engine:

    RESOLVES     length, count, min, max, mean, median, join, shuffle
    DOES NOT     unique, sort, total, reverse

All four missing ones have CE operators; only the LaTeX dictionary entry is
absent. `\operatorname{Unique}(C)` (capitalised) resolves correctly, so it is
the lowercase spelling specifically.

Why it matters beyond spelling: a consumer importing content that uses the
lowercase forms gets a silently undeclared function rather than the operator,
with no diagnostic at any point. It surfaced here as a red herring during Tycho
item 193 — a type read off `\operatorname{unique}(C)` was reported as
`collection`, which looked like a `Unique` type-handler widening bug and was in
fact the type of an unresolved application. It cost a round trip to attribute.

Fix: add the four lowercase entries alongside their siblings, and consider a
test that asserts every collection operator with a lowercase sibling entry has
one, so the set cannot drift again.

**FIXED 2026-08-15.** The four entries are in `definitions-other.ts`, in the
same lowercase-alias block as their eight siblings, and all twelve now resolve.

One claim above was WRONG and is corrected here: *"All four missing ones have
CE operators"* holds for `unique`/`sort`/`reverse` but NOT for `total` —
there is no `Total` operator anywhere in the engine, and asking for one
(`Signature(Total)`) answers `Nothing`. `total(C)` is the SUM of a collection,
so its entry lowers to `Sum`, which already folds a collection operand. That
is also the lowering the consumer's importer performs when it rewrites `total`
to `\sum`, so the two paths agree rather than diverging.

The drift guard the entry asked for is a `test.each` table in
`test/compute-engine/function-style-operators.test.ts` naming each lowercase
spelling and the operator head it must resolve to, read with `form: 'raw'`.
It covers the previously-working eight as well as the four added, because
either half can drift; a deleted dictionary entry now fails a test instead of
silently returning to an auto-declared head. A blanket "every collection
operator must have a lowercase alias" assertion was deliberately NOT written:
not every operator should have one, so the table is the record of which set is
intended.

**FIELD EVIDENCE (consumer, measured on the EMITTED document rather than read
from importer source): fix `reverse` FIRST, despite it having zero usage.**
Corpus incidence across 687 states is `total` 8 states / 127 occurrences,
`sort` 3 / 6, `unique` 2 / 3, `reverse` 0 / 0 — but their importer already
rewrites three of the four before CE ever sees them (`total` → `\sum`,
`unique`/`sort` → `Unique`/`Sort`, all verified by zero survivals into the
emitted document). **`reverse` is the one they do NOT rewrite and nothing in
their import path handles**, so it is the only one of the four where neither
side has a net: a future document using it gets a silently auto-declared head
with a plausible `list<unknown>` type and no diagnostic anywhere. Usage counts
therefore invert the priority here — the three with real incidence are already
covered downstream, and the one with none is the live hazard.

### The element type of a bare `collection`/`indexed_collection` is `any` in one place and `unknown` in another (FIXED 2026-08-16)

`collectionElementType()` (`src/common/type/utils.ts`) answers **`any`** for the
bare `collection` and `indexed_collection` types, while the operators that
actually extract an element answer **`unknown`**:

    collectionElementType(indexed_collection) = "any"      At(C, 1).type   = unknown
    collectionElementType(collection)         = "any"      First(D).type   = unknown

Those are not synonyms here. Under the ruling recorded for placeholder types
(2026-08-15), **`any` is a CONTRACT** — the author has said "anything may go
here" — while **`unknown` is a PLACEHOLDER** that refines per position as
evidence arrives. So the two spellings disagree about whether an element of a
bare collection is a settled `any` or an open `unknown`, and a caller's
behaviour can turn on which it consulted.

Which one is correct is the open question, and it should be decided rather
than papered over: `any` matches the declared-element reading (a bare
`indexed_collection` promises nothing about its members), while `unknown`
matches what a reader of `At(C, 1)` can actually conclude. Fix by making the
extraction operators and the helper agree, in whichever direction the ruling
goes, and pin both spellings in the same test so they cannot drift again.

Found while chasing Tycho item 193, but NOT its cause — 193 is understood
(see the `Which`/`Sum` typing under bare operands) and this is upstream
housekeeping rather than a contributor to it.

**RULED AND FIXED 2026-08-16: `unknown` wins; the extraction operators were
right and the helper now agrees with them.** The placeholder ruling of
2026-08-15 settles it rather than leaving a coin-flip: `any` is something the
author SAID — "anything may go here", the promise `(any) -> any` makes —
while `unknown` is the ABSENCE of a statement. Writing `collection` is not
writing `collection<any>`, so the honest element type is the placeholder.

Scope was wider than the entry's title: `list`, `set`, `tuple`, `dictionary`
and `record` answered `any` for their bare forms too, and all of them moved.
Fixing only the two named types would have left the helper internally
inconsistent — `unknown` for some bare collections and `any` for others, with
no principle separating them. `range` is the one deliberate exception and is
unchanged: its members really are known to be finite positive integers, which
is a fact rather than an absent statement.

Measured behavioral delta across 56 call sites, by A/B-ing the helper: FOUR
result types change, all in the same direction (a false contract becomes an
open placeholder).

    Join(C, C)      list<any>  ->  list<unknown>
    Filter(C, p)    list<any>  ->  list<unknown>
    Add(C, 1)       list<any>  ->  list<unknown>
    Multiply(C, 2)  list<any>  ->  list<unknown>

Everything else was already normalizing to `unknown` downstream, which is why
the full suite passed with ZERO snapshot churn (4312 snapshots) — nothing had
pinned the old `list<any>` shape.

Both spellings are pinned together in `test/common/types.test.ts`
("the element type of an UNPARAMETERIZED collection type"), so a future fix to
one side that forgets the other fails a test.

### Enabling `complexPromotion` makes scalar arithmetic over a collection-valued call STOP COMPILING (FIXED 2026-08-15 — reported by a consumer's pricing pass)

Turning the opt-in on causes `Multiply`/`Add`/`Divide` to decline with
"cannot compile scalar arithmetic over a list-valued operand" for expressions
that compiled — CORRECTLY — with it off. Found by the consumer pricing
enablement across their corpus: 25 compiled-band losses over 18 of 687 states,
of which **9 are this class and only 14 are the documented ordering-comparison
declines**. Reproduced here on a bare engine:

    w(t) := [√(t−1), √(t−2)]

    2·w(t)      OFF compiles     ON declines   <-- regression
    w(t) + 1    OFF compiles     ON declines   <-- regression
    w(t) / 2    OFF compiles     ON declines   <-- regression
    2·w(t)[1]   OFF compiles     ON compiles   (indexed, so scalar)

Two controls isolate the trigger to a CONJUNCTION: a collection-valued body
with **no radical** (`p(t) := [2t, t+1]`) compiles under both flag states, and
a **scalar** radical body (`z(t) := √(t−1)`) compiles under both. It is
specifically a collection-valued body containing a radical, consumed as a
WHOLE operand by scalar arithmetic.

**This is a real loss, not a wrong answer being withdrawn — which is what
separates it from the ordering-comparison declines.** Those replaced a
constant `false` that was wrong at t = 2. Here the OFF path is correct at both
ends of the domain:

    t = 3.0   interpreter [2.8284271247461902, 2]   compiled OFF [2.8284271247461903, 2]
    t = 0.3   interpreter [1.673…i, 2.607…i]        compiled OFF [null, null]

Right in the real domain, and correctly projected out by `realOnly` outside it
(the `null`s above are `JSON.stringify` rendering the projected NaNs).
Enabling promotion replaced a correct compilation with a decline and an
interpreter fallback.

One clause of the original filing was itself wrong and the fix disproves it:
"an expression whose promotion is not even needed — whole-collection scalar
arithmetic never reads an element as complex." It does read every element, one
per broadcast position, and under the opt-in each one genuinely is complex.
That is why the fix carries the promotion through rather than suppressing it,
and why `2·w(0.3)` now answers `[1.673…i, 2.607…i]` — the interpreter's value —
where the OFF path answers NaN.

**The filed hypothesis was REFUTED.** It read: promotion widens the operand's
type and a broadcast-eligibility test keyed on that type answers differently.
Measured on the operand `w(t)`, the two flag states are:

| probe                  | promotion OFF             | promotion ON              |
| ---------------------- | ------------------------- | ------------------------- |
| type                   | `vector<finite_number^2>` | `vector<finite_number^2>` |
| `isComplexValued`      | `false`                   | `false`                   |
| `hasAnyComplexElement` | `false`                   | `true`                    |

Nothing about the TYPE changes, and the whole-operand complex verdict does not
change either. What flips is the ELEMENT-level one, and it flips for the
correct reason: promotion applies to each `√(t−k)` inside the body, so
`_fn_w` really does return `[{re, im}, {re, im}]` under the opt-in.

The decline came from `tryCompileBroadcast` (`compilation/base-compiler.ts`),
which built its `_SYS.bcast` scalar closure by re-invoking the head's own
codegen on bare element PARAMETERS. A bare symbol carries no complex-ness, so
the codegen would have emitted `_tv1 * _tv2` over a pair of `{re, im}`
objects — and rather than emit that, the method declined outright on any
complex operand, falling through to the D6 scalar-arithmetic guard whose
diagnostic the consumer saw. The guard itself was never the problem.

**Fixed** by declaring each element parameter's complex-ness in a
`_localComplex` frame — the same mechanism a `Block` local uses — so the
head's scalar codegen picks the complex lowering and the closure agrees with
the array it is mapped over. Two supporting pieces were needed:

- Only a collection whose elements UNIFORMLY agree may broadcast. One closure
  is emitted for every position, so a mixed list (`[√(t−1), 1]` under the
  opt-in, `[1+i, 2]` on the default path) still fails closed. Reaching this
  conclusion took a measured wrong answer: an intermediate version asked
  `isComplexValued` first, which reports for the whole collection — `[1+i, 2]`
  types `vector<finite_complex^2>` and reads complex — and compiled
  `2·[1+i, 2]` to `[{re: 2, im: 2}, {re: NaN, im: NaN}]` against the
  interpreter's `[2+2i, 4]`. For an array operand only the element analysis
  may answer.
- The element analysis now looks THROUGH element-wise arithmetic
  (`elementComplexness`): element k of `Multiply(2, w(t))` is complex exactly
  when element k of `w(t)` is, because the `_SYS.bcast` closure applies the
  head per position. Without it, an enclosing `(2·w(t))[1] + 1` would classify
  the whole `Multiply` from `isComplexValued` — a scalar verdict describing no
  element — and concatenate `1` onto an object. Only the heads that propagate
  complex-ness from their operands qualify.
- An element that is ITSELF a collection is judged at its LEAVES, not as a
  sublist (`broadcastLeafComplexness`). `_SYS.bcast` descends through every
  array it is handed and applies the closure at the leaves, so a nested
  element's convention is the one all its leaves share. Caught by the dual
  review after the first version answered a sublist with the whole-collection
  verdict — the same category error one level down. Measured then:
  `2·[[1+i, 2], [3+i, 4]]` called both sublists complex and ran to
  `[[{re: 2, im: 2}, {re: NaN, im: NaN}], [{re: 6, im: 2}, {re: NaN, im: NaN}]]`
  where the interpreter answers `[[2+2i, 4], [6+2i, 8]]`. Leaves that agree
  still broadcast at depth; leaves that disagree decline.

Verified against the interpreter at both ends of the domain (`t = 3` inside,
`t = 0.3` outside): all three shapes now match to the last double digit, and
under `realOnly` the out-of-domain value projects to NaN element-wise, exactly
as with the opt-in off. Both controls still hold, and the indexed case still
compiles. Pinned in `test/compute-engine/compile-complex-element-access.test.ts`.

**One default-path shape changed, deliberately.** An all-complex LITERAL
collection under scalar arithmetic (`2·[1+i, 3+i]`) declined before and now
broadcasts, matching the interpreter — the old decline was collateral from the
same "bare parameters cannot carry complex codegen" limitation, not a
soundness rule. Everything else is byte-identical (2523 compile tests and 4306
snapshots unchanged). A `list<complex>`-typed SYMBOL still declines: its
elements are not visible, so no per-element verdict exists, and the compiled
artifact cannot constrain what the caller binds.

### A real-only lowering spelled as FUNCTION codegen took a complex operand and ran to NaN (FIXED 2026-08-15 — found while fixing the item above)

`compileExpr` has a real-only gate: a head the target maps to a plain HELPER
NAME (`Erf` → `_SYS.erf`) fails closed (D6) on a complex-valued operand,
because handing a `{re, im}` object to a real helper returns garbage rather
than an error. The gate sits on the string-mapped branch only. A head lowered
by FUNCTION codegen bypassed it — even where that codegen is just as
real-only, which it is whenever the reason for the function form is an
operand shortcut or an arithmetic reconstruction rather than complex support.

Measured on the DEFAULT path, no compile option set, with `x` bound to `0` so
that `x + (1+i)` is complex but not a foldable literal. Every one of these
reported `success: true` over source that ran to NaN:

    Floor(x + (1+i))       compiled NaN    interpreter 1 + i   (inert)
    Round / Truncate       compiled NaN    interpreter 1 + i   (inert)
    Fract(x + (1+i))       compiled NaN    interpreter 0
    Max / Min(x + (1+i))   compiled NaN    interpreter max(1 + i)  (inert)
    Clamp(x + (1+i), 0, 2) compiled NaN    interpreter inert
    Mod(x + (1+i), 2)      compiled NaN    interpreter 1
    Remainder(…, 2)        compiled NaN    interpreter −1
    GCD / LCM(…, 2)        compiled NaN    interpreter inert

Three families, none with a complex extension to reach for: rounding (no
rounding of a complex number exists), order selection (the complex numbers
carry no total order — the same reason `Less`/`Greater` already fail closed on
a complex operand), and integer division. That `Ceiling`, `Sign`, `Erf`,
`Gamma` and `Zeta` were already failing closed through the string gate is what
identifies this as an omission rather than a policy.

Fixed by applying the same rule on the function-codegen branch, through
`REAL_ONLY_CODEGEN_HEADS` in `compilation/base-compiler.ts`. Real operands are
untouched (`Floor(x)` is still `Math.floor(_.x)`); the interval targets are
exempt, as they already are for the string gate. Pinned in
`test/compute-engine/compile.test.ts` under the CO-P1-3 describe.

The first version of that gate covered only HALF the shapes, and a dual review
caught both halves it missed — both re-measured before fixing:

- **The head set named the wrong spellings.** `Ceil` and `Ceiling` are distinct
  heads; `Ceil` is the one the library canonicalizes to and the JavaScript
  target lowers with function codegen, so gating `Ceiling` (which already
  declined through the string gate) left `Ceil(x + (1+i))` emitting
  `Math.ceil({re, im})`. `ElementMax`/`ElementMin` are likewise separate heads
  from `Max`/`Min` and lower straight to `Math.max`/`Math.min`. All are now in
  the set.
- **The broadcast path returns before the gate.** `tryCompileBroadcast` runs
  ahead of the scalar branch that carries the gate, and it builds its closure
  from the head's own scalar codegen — so once the same round widened it to
  carry complex elements, `Floor([1+i, 2+i])` emitted
  `_SYS.bcast((_tv1) => Math.floor(_tv1), …)` and ran to `[NaN, NaN]`. The rule
  is now applied inside `tryCompileBroadcast` too, returning `null` so the form
  lands on the same D6 guard the scalar shape does. `GCD`/`LCM`/`Max`/`Min` were
  never exposed this way — they are `broadcastable: false` and only ever reach
  the scalar branch.

Found by a sweep over every numeric head with a complex operand, run to check
that the collection fix above had not introduced a lane disagreement. It had
not; this was pre-existing on the scalar path and reached collections only
because element-wise lowering mirrors the scalar one.

### A statistics head over a SINGLE DATUM threw at run time behind `success: true` (FIXED 2026-08-15 — user-ruled)

`Mean(x)` is a legal expression whatever `x` is, and the interpreter answers it
by treating one datum exactly as a one-element list. The compiled path did not:
`_SYS.mean` & co. iterate their argument, so `Mean(x)` emitted `_SYS.mean(4)`
and raised "values is not iterable" at RUN TIME, after reporting
`success: true`. Measured at `x = 4`, on the DEFAULT path with no compile option
set:

    Mean(x)        compiled: runtime throw    interpreter: 4
    Mean([1,2,3])  compiled: 2                interpreter: 2

Not a complex-lane defect — it hit plain REAL operands, which is the likelier
shape in a plotted expression. It surfaced during the complex-lane round only
because a reviewer probed the statistics heads with a complex argument and read
the resulting throw as a missing real-only gate. Adding those heads to the
real-only set (which was done, and is right for
`Mean([i, 2i])` → the interpreter's complex mean) fixes only the complex half
and leaves the real-scalar crash untouched; the two are separate defects
sharing one symptom.

The interpreter's single-datum semantics were measured head by head at `x = 4`
before anything was written, and the scalar and one-element-list columns agree
in every row:

| head                             | scalar | `[4]` |
| -------------------------------- | ------ | ----- |
| `Mean` / `Median` / `Mode`        | 4      | 4     |
| `Variance` / `StandardDeviation` | NaN    | NaN   |
| `Kurtosis` / `Skewness` / `InterquartileRange` | NaN | NaN |
| `PopulationVariance` / `PopulationStandardDeviation` | 0 | 0 |
| `Quartiles`                      | (NaN, 4, NaN) | (NaN, 4, NaN) |

The NaNs are not breakage: the sample forms divide by `n − 1`, which is zero for
one datum.

**Ruled 2026-08-15 (user, option (a) of two):** make the compiled path handle a
scalar operand rather than fail closed on it — the semantics are not ambiguous,
the interpreter already defines them. Fixed by wrapping a runtime scalar at the
`_SYS` binding site in `compilation/javascript-target.ts` (`oneDatumOk`), so the
existing reducers reproduce every row above with no per-head special case and no
second definition of the semantics to keep in sync. The wrap is deliberately
NOT in `numerics/statistics.ts`: those reducers are shared with the interpreter,
which reaches them through its own collection-shaped path and keeps the stricter
contract. It is also deliberately a RUNTIME test rather than a static one — a
bare symbol can be bound to a number or to an array at call time, so the
emission site cannot decide. Pinned in `test/compute-engine/compile.test.ts`.

### A complex value passed as an ARGUMENT to a scalar-bodied user function was lost (FIXED 2026-08-15 — per-lane emission of user functions; NOT promotion-only)

**Resolution first; the history below is kept for its witnesses.** The
defect was filed against the `complexPromotion` opt-in and re-investigated
as promotion-only. The fix session refuted that premise as well: on the
DEFAULT path, with `w` declared `complex` and `b(x) := 2x`, `compile(b(w))`
emitted `_fn_b(_.w)` over `const _fn_b = (x) => 2 * x` — `NaN` behind
`success: true` — and so did `b(t + w)`, `h(w, 2)`, `h(2, w)`. The opt-in
merely made the witness reachable from a promoted radical.

The fix (`compilation/base-compiler.ts`): a user function is now emitted
once PER LANE PATTERN. `userCallComplexLanes` computes, per call site,
which parameters receive a complex SCALAR while not being declared complex;
`userFunctionName(id, lanes)` names that specialization `_fn_b$z1` (the
`$` convention the multi-clause helpers already use, so it cannot collide
with a user id, and `$z` keeps it apart from `$c<n>`); the body compiles
under a `_localComplex` frame binding those parameters complex — and under
a `_localVector` `LOCAL_SCALAR` entry, so a nested call passing the
parameter on (`c(x) := b(x) + 1`, or the recursive `K(n-1, z)`) grants the
same lane; and the analysis (`isComplexValuedUserCall`,
`withCollectionElements`) binds the very same lanes, so parent and emitted
body agree on the value shape. Both halves landed together, as the note at
the end of this entry demanded. Deliberately unchanged: the real lane (bare
`_fn_b`, byte-identical body), a parameter DECLARED complex (the existing
`coerceToComplex` call-site coercion, disjoint by construction), arguments
not provably scalar (still the runtime `_SYS.bcastFn` broadcast — a mixed
list would otherwise hand a real element to a complex body), multi-clause
functions (run-time guard dispatch, real lane), and the shader targets
(their static signatures fail closed on such a call; verified `b(w)` on
`glsl` declines). Every witness below now matches the interpreter:
`|b(a(t))/2 − 1|` at `t = 0.3` → `1.3038404810405297`; `b(a(t))` →
`1.6733…i`; `id(a(t))` still passes through; `m(t)` (body nesting) still
`1 + 0.8366…i`. The Julia-map test's pin moved from `_fn_K(` to
`_fn_K$z01(` — its `z` slot is wide-typed and receives `x + iy`, so it IS
the complex lane, and the self-call resolves to the same specialization.
Two more shapes of the same defect, found on the "anything else?" pass and
fixed the same way: a collection of complex scalars BROADCAST into scalar
parameters (`b(L)`, `L: list<complex>` → `[NaN, NaN]`) now takes the
elements' lane (`hasUniformComplexScalarElements`, granted only when the
call broadcasts per element and every element is a complex scalar — a mixed
list still has no lane), and a bare user-function symbol used as an ELEMENT
callback (`Map(b, L)` → `[NaN, NaN]`, while `Map(x ↦ 2x, L)` was right) is
compiled through its eta-expansion `(_x: complex) ↦ b(_x)`
(`complexElementCallbackEta`, wired in the JS target's `fnArg`; unary
callbacks only — a combiner-shaped `Reduce`/`Scan` callback keeps its
previous emission, and a bare callback over a REAL source still emits the
bare `_fn_b` reference).
Regression suite: `test/compute-engine/compile-complex.test.ts`, "complex
ARGUMENT to a wide-typed user-function parameter".

Found and fixed alongside: an emitted user-function body on the JavaScript
route compiled under the CALLER's `Block` local-shape frames (the GPU
definition lowering already isolated its own). `u(x) := x + k` reading a
global `k`, called from a block that declared its own complex local `k`,
lowered the plain global as `{re, im}` — `{re: null}` where the interpreter
answers `7`. The body now compiles under an isolated frame; same test file.

**Read the re-investigation at the end of this entry before acting on the
original text.** It reproduces the defect, corrects two statements of the
mechanism, refutes the interim fix that had been left on the table, and sizes
the real one. The original text is kept because its witnesses and its priority
caveat are still valid.

Found while fixing the entry above, and distinct from it: the user-call
look-through analyzes a body with the function's PARAMETERS shielded, i.e.
treated as real, so a complex value arriving through an argument is not seen.
The emitted `_fn_b` is also emitted once, in the real lane, and cannot serve a
complex call site. Measured 2026-08-15 at `t = 0.3`, `realOnly: true`,
`complexPromotion: true`:

    a(t) := √(t−1) ;  b(x) := 2x ;  |b(a(t))/2 − 1|   ON NaN  (interpreter 1.3038404810405297)

Nesting in the BODY is unaffected and promotes correctly (`m(t) := n(t) + 1`
with `n(t) := √(t−1)`); it is specifically ARGUMENT position that is lost.

Fix shape when picked up: the call site's complexness has to consider the
ARGUMENTS as well as the body, and the emitted user function then needs a
complex-lane specialization for the call sites that pass one — a per-call-site
monomorphization the emitter does not do today.

RE-VERIFIED 2026-08-15, still live and unchanged by the collection-element
fix above. With `a(t) := √(t−1)`, `b(x) := 2x`, at `t = 0.3`, on the
`compile()` route:

    |b(a(t))/2 − 1|   complexPromotion ON   → NaN
                      complexPromotion OFF  → NaN   (identical: the option
                                                     buys nothing here)
                      interpreter           → 1.3038404810405297
    m(t) := n(t) + 1  (BODY nesting, control) ON → {re: 1, im: 0.8366600265}

Both compiled results report `success: true`, so the wrong value is silent.
The control confirms the defect is specific to ARGUMENT position, exactly as
filed — body nesting promotes correctly.

DEFERRED from the 2026-08-15 round, deliberately and with the priority caveat
below understood: the fix is a per-call-site monomorphization of the emitted
user function, which is a new capability in the emitter rather than a guard
correction, and it is not a change to make in the pass that cuts a release.
It is the largest of the four items reviewed in that round and the only one
left open on purpose.

PRIORITY CAVEAT, and the reason not to inherit "nothing is waiting on this":
the deferral above was written when the flag's one prospective consumer had
declined to enable it. That decision was REOPENED the same day, once the
collection-body item closed. Two of its three stated grounds no longer hold —
"zero measured benefit" ends when the fix above ships, since both witnesses
including the `PointList` form then promote; and the regression risk was
partly a misreading, because the ordering comparisons that decline under
promotion were previously compiling to a CONSTANT `false` (wrong at t = 2
against the interpreter), so a withdrawn wrong answer had been priced as a
lost capability. Only the measured ~1.6× cost on affected chains survives
unchanged. So re-check whether the flag is actually being enabled before
treating this as unwatched; a "declined, settled" line is exactly what a later
session inherits without re-deriving.

#### RE-INVESTIGATION 2026-08-15 (after 0.112.0) — two corrections, one refutation, and the fix sized

**Correction 1: the argument's complexness is NOT unseen. It is DISCARDED.**
The text above says a complex value arriving through an argument "is not
seen". Measured on a bare engine with `a(t) := √(t−1)`, `b(x) := 2x`, under the
opt-in:

    isComplexValued(a(t))      true      <- the ARGUMENT is known complex
    isComplexValued(b(a(t)))   false     <- the CALL is classified real

The verdict exists at the call site and is thrown away crossing the user-call
boundary: `isComplexValuedUserCall` analyzes the body with the parameters
masked REAL, so `2x` reports real and the call inherits that. This matters for
the fix, because it means no new analysis is needed — only that an existing
verdict stop being discarded.

**Correction 2: the trigger is not ARGUMENT POSITION, it is REAL-LANE
ARITHMETIC on a parameter holding a complex value.** An identity body works
today; an arithmetic body does not:

    id(x) := x  ;  id(a(t))    ->  {re: 0, im: 0.8366600265340756}   MATCHES interpreter
    b(x)  := 2x ;  b(a(t))     ->  NaN                               interpreter 1.6733…i

Pass-through survives because nothing consumes the object as a number; `2 * {re,
im}` is NaN. Any fix keyed on "argument position" would therefore withdraw the
`id` shape, which is correct today.

**Refutation: the interim fail-closed guard is UNSAFE, not merely deferred.**
The obvious guard — decline when a complex argument is bound to a parameter
that is not complex-TYPED — was implemented and measured before being
discarded. It breaks three currently-passing tests in
`test/compute-engine/compile-complex.test.ts`:

  - "a recursive complex lambda (iterated Julia map, typed return) compiles
    with digit parity"
  - "box-then-assign recursive lambda compiles regardless of function name"
  - "a wide-typed pass-through arm is NOT wrapped (carries the object bare)"

The third is a deliberately pinned convention (the Tycho item-60 class), and it
is the same shape as `id` above. **Parameter TYPE is the wrong discriminator: a
wide-typed parameter legitimately carries a complex object.** Do not re-propose
this guard; it prices a working capability as a defect, which is the same
mistake the ordering-comparison analysis made earlier in this entry's history.

**The real fix, sized.** The text above calls it "a per-call-site
monomorphization the emitter does not do today", which is accurate but leaves
the work unscoped. The mechanism already exists — it is the `_localComplex`
frame that `tryCompileBroadcast` uses to declare its `_SYS.bcast` element
parameters complex. Concretely:

  - `userFunctionName(id)` (`compilation/base-compiler.ts`) gains a LANE
    suffix, so `_fn_b` and its complex specialization are distinct names.
  - Thread the lane through `ensureUserFunctionEmitted` (two call sites — the
    call route in `tryCompileUserFunction`, and the bare function-VALUE
    reference, which has no arguments and so takes the real lane) into
    `emitFunctionLiteralDefinition` and `prepareUserFunctionBody`.
  - Compile the body under a `_localComplex` frame binding each parameter to
    its argument's verdict, so analysis and emission agree on value shape.

Three hazards, identified but NOT solved, each of which can produce a silently
wrong lane if missed:

  1. `registry.compiling`/`registry.defs` are keyed by the emitted name, so
     lane-keying the name is what makes a RECURSIVE self-call resolve to its
     own lane. The iterated Julia map is the test that exercises this.
  2. The shader targets take `registry.lowering.define` and never reach the JS
     arrow form, so they need their own decision rather than inheriting this
     one.
  3. `coerceToComplex` in `tryCompileUserFunction` already wraps a REAL
     argument bound to a complex-typed parameter. Any lane decision has to
     compose with it rather than duplicate it.

**Attempted and reverted in the same session:** the analysis half alone (binding
parameter complex-ness to the argument's verdict) was implemented and verified
to work — `b(a(t))` classifies complex, `b(3)` stays real — then REVERTED,
because on its own it makes the defect worse rather than better: the analysis
then reports complex while the emitted `_fn_b` is still real-lane, and parent
and child disagreeing on value SHAPE is the invariant compiled correctness
rests on. This half is a short redo; it must land together with the emission
half, never before it.

### A combiner callback (`Reduce`/`Scan`) whose ACCUMULATOR turns complex mid-fold compiled silently wrong (FIXED 2026-08-16 — accumulator lane by one-step widening; the interim fail-closed gate is retired)

Found while closing the "complex ARGUMENT to a user function" entry above.
Two independent lanes flow through a combiner: the ELEMENT lane (the same
one `Map(b, L)` now handles) and the ACCUMULATOR lane, and the second is not
reasoned about at all — not for a bare user-function symbol and not for an
inline lambda. Measured with `L: list<complex>` = `[1+2i, i]`:

    Reduce(L, h, 0)   h(a,x) := a + 2x   bare    -> NaN                       interp 2+6i
    Reduce(L, (a,x) ↦ a + 2x, 0)         INLINE  -> {re: "[object Object]0"}   interp 2+6i

**INTERIM SHIPPED 2026-08-16 (user-ruled): the INLINE-lambda shape now FAILS
CLOSED rather than miscompiling.** `Reduce` and `Scan` decline when the seed is
provably real and the combiner's body yields complex — the accumulator would
have to widen part-way through, which this lowering does not model. The caller
falls back to the interpreter and gets the right answer. The predicate is
`BaseCompiler.reduceAccumulatorWidens`.

The gate keys on the BODY's complexness under the fold's own lanes (element
bound complex, accumulator left real), never on the element type alone — which
is what keeps `Reduce(L, (a,x) ↦ a + |x|, 0)` over the same complex `L`
compiling, since `|x|` is real and nothing widens. A complex SEED also keeps
compiling (the accumulator starts complex, so nothing widens), as do builtin
combiners and every real source.

`Scan` was measured to have the same defect and is gated identically; it
corrupts from the SECOND element on — `[{re:2,im:4}, {re:"[object Object]0",
im:2}]` where the interpreter gives `[2+4i, 2+6i]` — the first element being
right only because the seed has not yet met a complex value.

**The bare-symbol row is covered by the resolution above** (it was measured
at HEAD as `NaN` behind `success: true`, contrary to the premise the interim
ruling was given, and the eta-expansion is what closes it).

(The "real fix" this paragraph used to defer — accumulator-lane widening,
seed coercion, callback lane binding — is the resolution above; nothing of
this entry remains open.)
    Reduce(L, n, 0)   n(a,x) := a + |x|  bare    -> NaN                       interp 1+√5
    Reduce(L, (a,x) ↦ a + |x|, 0)        inline  -> 3.236…  CORRECT (real accumulator)
    Scan(L, h, 0)                        bare    -> [NaN, NaN]                interp [2+4i, 2+6i]

All behind `success: true`. The bare `n` row is the element lane only (the
inline form is right); every other row is the accumulator: the seed `0` is
real, the combiner's RESULT is complex, so from the second step the
accumulator holds `{re, im}` while the body was compiled with `a` real —
`a + {re,im}` concatenates in JavaScript, which is the string in row 2.

**RESOLUTION 2026-08-16 (ruled by Arno, "real fix now" over widening the
interim gate).** `BaseCompiler.combinerPlan` (`compilation/base-compiler.ts`)
computes both lanes of a custom combiner: the ELEMENT lane from the source
(`hasUniformComplexScalarElements`), the ACCUMULATOR lane by ONE-STEP WIDENING
— complex when the accumulator parameter is declared complex, the seed is
complex-shaped, the fold is seedless over complex elements, or the body's
result is complex when analyzed with the element in its lane and the
accumulator real. An inline lambda is compiled under a local shape frame
binding its two parameters to those lanes (`compileCombinerLiteral`); a bare
user-function symbol is compiled through its typed eta-expansion
`(_a: complex?, _x: complex?) ↦ h(_a, _x)` so its call site takes the
function's complex-lane emission (`_fn_h$z11`); a real seed into a complex
accumulator lane is lifted with `_SYS.cplx`; `isComplexValued` answers the
fold's accumulator lane so a parent agrees; the builtin `Add`/`Multiply`
combiners use the complex kernels over a complex lane and `Min`/`Max` fail
closed there; and the `Reduce`/`Scan` `type:` handlers resolve a bare
combiner symbol through its definition (`callbackOperandType`,
`library/collections.ts`) — a bare-symbol fold typed `unknown`, which the
JS scalar-arithmetic guard treated as "possibly a collection" and declined.
Every row of the table below now matches the interpreter on both binding
routes (LaTeX `:=` operator definition and `ce.assign` value definition):
`Reduce(L, h, 0)` → `2+6i`, `Scan(L, h, 0)` → `[2+4i, 2+6i]`,
`Reduce(L, h, 1+i)` → `3+7i`, seedless `Scan(L, h)` → `[1+2i, 1+4i]`,
`Reduce(L, n, 0)` → `1+√5`, a wide seed `t` → `2.5+6i` at `t = 0.5`,
`Reduce(L, h, 0) + 1` → `3+6i`, `Scan(L, Add, 0)` → `[1+2i, 1+3i]`. Pinned
in `test/compute-engine/compile-complex.test.ts` ("Reduce/Scan ACCUMULATOR
lane (combinerPlan)"), which also pins the shapes that must NOT be lifted
(a real accumulator over a complex source keeps the real kernel; a real
source and builtin folds over real data are byte-identical).

(The dual review of this fix closed its one residue too: a BUILTIN fold
over a complex source typed `unknown`, so `Reduce(L, Add, 0) + 1` still
declined as "possibly a collection"; `foldResultType` now types a builtin
fold from the source's element type widened by the seed — `finite_complex`
over a `list<complex>`, `finite_integer` for `Reduce([1,2], Add, 0)` — and
the parent compiles. It also added the operand LIFT in the emitted wrapper,
which the first cut lacked: a `list<complex>` lowers its elements verbatim
and may hold a real entry, and a seedless `Scan` over a REAL source whose
body widens starts from the raw first element — `Scan([1,2], (a,x) ↦ a +
i·x)` answered `[1, {re: null}]` before the lift.)

**Interpreter surface of the same defect, FIXED 2026-08-16:** `Reduce`'s
compiled fast path under `.N()` (`library/collections.ts`) fed the compiled
reducer's `{re, im}` result back into its JS-number accumulator, so
`Reduce([1,2,3], (z,k) ↦ z² + c, 0)` with a complex `c` returned
`Error("unexpected-mathjson", "{\"re\":null,\"im\":0.5}")` from `.N()` while
`.evaluate()` was correct (Tycho, against 0.112.0/0.113.0; the `re: null` is
the same value the compiled real-lane `z·z`-on-an-object produces). The fast
path now switches to the interpreted reducer at the first non-number result;
pinned in `test/compute-engine/reduce-complex-accumulator.test.ts`. The
COMPILED `Reduce` (`compile()` of the whole expression) is still the open
defect above.

**Intended resolution (2026-08-16): not another lane.** This is the sixth
instance of the same design property — the per-node analysis guesses REAL
for a wide-typed binding site — and the fix under consideration is a
compile MODE that flips the default direction (`complex` mode: anything not
provably real is complex; `real` mode: complex evidence fails closed;
`auto` default). See `docs/plans/2026-08-16-compile-complex-mode.md`, which
lists this item among the ones it retires and the decisions it needs (one
knob or two, comparison semantics, cost). The per-item fix below is what to
do if that design is declined.

Fix shape (recommended, "one-step widening"): the accumulator's lane is
complex when the seed is complex, or when the body's result is complex
under (accumulator real, element at its lane) — monotone, so one
re-analysis with the accumulator complex settles it. Then coerce the SEED
to `{re, im}` when the lane is complex (the same call-boundary coercion the
`M(10, 0)` seed case in `tryCompileUserFunction` already applies), compile
the callback with the accumulator bound complex (inline: a `_localComplex`
frame on the lambda's parameters; bare symbol: the eta-expansion
`(a: complex, x: complex) ↦ h(a, x)`, extending `complexElementCallbackEta`
which today declines combiner shapes), and make `isComplexValued` answer
the accumulator lane for `Reduce`/`Scan` so the parent agrees on the value
shape. Alternatives considered: element lane only (cheap, but brings the
bare form to parity with an inline form that is itself wrong), or fail
closed when the seed is real and the body result complex-valued (safe,
does not break the working real-accumulator row, but withdraws compile from
exactly the fractal-style iterations that want it — an interim at best).

### The constant fold's own 2000 ms stall guard can still swap a folded value for a lowered one (OPEN, correctness — narrow residual; the AMBIENT-deadline path is already correct)

`foldCostEstimate` made the fold ELIGIBILITY decision a property of the
expression alone, so the same input always makes the same fold/decline
choice. The fold BODY is still wrapped in a stall guard —
`engine.withTimeLimit({ ms: CONSTANT_FOLD_BUDGET_MS })` in
`compilation/base-compiler.ts` (`CONSTANT_FOLD_BUDGET_MS = 2000`) — and
crossing THAT budget is a quiet decline: the catch sets
`value = undefined` and compilation continues down the structural
lowering with no diagnostic.

Why a quiet decline is a correctness matter and not a lost optimization:
the comment on `CONSTANT_FOLD_MAX_COST` records that the folded value
comes from `.N()` in bignum while the structural lowering computes in
doubles, so the two branches differ in the last digits. A budget crossing
therefore changes the compiled VALUE, and because 2000 ms of wall clock
is machine-load dependent, two runs on the same input can disagree —
exactly the property the cost gate was introduced to remove.

**The ambient-deadline path is NOT part of this defect, and a fix must
not disturb it.** `withTimeLimit` nests as `min()`, so a caller's tighter
deadline does reach the fold — but an expiry attributable to the AMBIENT
deadline is rethrown (`if (!engine._shouldContinueExecution()) throw e`)
and cancels the whole compilation rather than being swallowed as a fold
miss. Measured 2026-08-15 on a 7-term `Sum` of user-function calls: an
ambient span of 1 ms and 5 ms threw `Timeout exceeded`, while 50 ms and
500 ms returned code byte-identical to the unbudgeted compile. There is
no silent branch swap via a consumer's span budget; a consumer that
budgets its compiles gets a loud failure or the same answer.

So the exposure is only the fold's own 2000 ms ceiling, which no caller
can tighten — hard to reach, but reachable on a slow machine under load
for an expression the cost estimator admits. Fix shape when picked up:
make the fold's own decline deterministic or observable rather than a
silent branch change; keep the ambient rethrow exactly as it is. A
regression should compile one folding expression under a tight and a
loose ambient deadline and assert the emitted code is identical whenever
neither run throws.

### Degree-mode folding flips `angularUnit` per fold attempt, purging caches (OPEN, perf — small)

Measured before `foldCostEstimate` replaced the wall-clock budget. That
change narrows the exposure but does not remove it: the cost gate returns
BEFORE the setter is touched, so a subtree the estimator declines now
costs nothing here, while every subtree that actually folds still pays
the two purges below. The numbers therefore still hold for the folding
case, which is the common one.

The 0.108.0 degree-mode fold fix neutralizes `engine.angularUnit` around
each constant-fold evaluation (necessary — see the CHANGELOG entry). The
setter is not a cheap flag: `set angularUnit` calls `_reset()`, which
runs `purgeValues()` on the cache store. So a degree-mode compile pays
two cache purges per fold ATTEMPT.

Measured (60 constant subtrees, median of 5, javascript target):
angular constants 4.2 ms in radian mode vs 9.4 ms in degree (2.2×);
NON-angular constants 0.3 ms in both. So the cost is not the flag itself
— it tracks how warm the purged caches are, and only an angular-heavy
degree-mode compile is warm enough to notice.

Note what that rules out: narrowing the gate to "subtree contains an
angular operator" would save nothing, because the penalty falls exactly
on the subtrees that genuinely need the neutralization. The fix that
would work is hoisting the neutralization to the compilation boundary so
it happens once — but that is not free either, because
`compileDerivative` (`library/calculus.ts`) calls `rewriteAngularUnit`
DURING compilation and that function reads `ce.angularUnit` from the
engine. Hoisting therefore has to make the derivative lowering's unit
explicit rather than ambient, or degree-mode derivatives silently stop
being rewritten. Raised by the compilation session, who own the folder.

### Eleven test files leak `BigDecimal.precision`

`BigDecimal.precision` is process-global, and eleven files under
`test/compute-engine/` set it with no `afterAll`/`afterEach` restore:
`bug-fixes`, `comparisons`, `deadline-regressions`, `lazy-collection-regimes`,
`numbers`, `performance`, `pointlist-lazy-broadcast`, `random-compile`,
`serialization`, `timeout`, `statistics`. It was probed and REFUTED as the
cause of the 2026-08-14 `definition-order.test.ts` last-digit drift (that was
the wall-clock constant-fold budget, since replaced by the deterministic
`foldCostEstimate`), so this is hygiene rather than a known-live defect — but a
leaked global precision is exactly the kind of state that makes a parallel
run's failures unattributable.

### `BoxedDictionary` construction throws raw JS errors

`boxed-dictionary.ts` `_initFromExpression` still has raw construction-time
`throw new Error` calls (non-string key, `Nothing` key, wrong pair arity),
where the sibling `DictionaryFrom`/`RecordFrom` evaluate handlers were
converted to return boxed `incompatible-type` errors on 2026-08-14. These are
constructor invariants sitting behind canonical-handler validation — a
different reachability class from the evaluate-handler throws — so converting
them needs its own analysis of which callers rely on fail-fast construction.

### Ground-type invariant leak in `parameterized-nominal-constructor.test.ts` (dev-assert noise)

Every full-suite run emits one `console.assert` failure: `probe() received
an open type variable \`T\` — the ground-type invariant (§4.2) leaked`
(`assertGroundType`, `common/type/subtype.ts`), fired from
`test/compute-engine/parameterized-nominal-constructor.test.ts:243`. The
test itself passes — the assert is dev-only — but the §4.2 invariant says
an open type variable must never reach the subtype/membership predicates,
so either the parameterized-nominal constructor path is leaking an
uninstantiated `T` into `probe()` (a real gap in the D6 bound-reading) or
the probe call in the test bypasses the instantiation step the engine
routes take. Pre-existing (observed in every full run since at least the
2026-08-13 rollback-frames round; noticed and filed 2026-08-13 during the
effects-axis-provenance round).


### Lazy infinite-collection compilation — v1 limits (JS target)

`Take`/`TakeWhile`-bounded infinite pipelines compile to lazy `_SYS`
iterator streams as of 2026-08-13 (`emitLazyStream`,
`javascript-target.ts`; tests in `compile-lazy-collections.test.ts`).
The v1 lazy algebra is deliberately small — sources: `Range` with a
literal `±∞` stop; transformers: `Map`/`Filter`/`Drop`/`Rest`;
bounders: `Take`/`TakeWhile`. Everything else fails closed at compile
time with an error naming the bounding fix. Not defects — each is a
clean compile-time decline today — but natural extensions:

- **More lazy sources**: 1-argument `Repeat(v)` (its handler still
  fails closed with the pre-existing "no compiled representation"
  message, now only true outside a bounding consumer) and `Cycle`
  (which has no compile handler at all).
- **More bounding consumers**: `First`/`At(k)`/`Find`/`IndexWhere`
  over an infinite stream all have finite answers a lazy scan could
  produce; today they fail closed.
- **A symbolic step with an infinite stop** (`Range(1, ∞, s)`) is not
  lazily compilable: a runtime-negative step means an EMPTY range, and
  a stream cannot decide that lazily (see `infiniteRangeStep`).
- **Python target**: no lazy lowering — a non-finite `Range` bound
  fails closed at compile time even under `Take` (a documented
  divergence from the JS target).
- `DropWhile` over an infinite source is INERT in the interpreter, so
  it deliberately does not compile — parity, not a gap.

### `Error` match normalization is root-only (limitation)

An `Error` subject is normalized for pattern matching at the ROOT of the
match only: its `ErrorTrace` breadcrumb is stripped, and its where/site
operand is stripped when the pattern's arity doesn't ask for it
(`normalizeErrorSubject`, `match-dispatch.ts`). A sited or bubbled error
NESTED as another error's cause is not normalized, so an `Error(Error(c))`
pattern does not see through the inner error's where or trace. This
predates the 2026-08-13 site operand — trace-stripping was always
root-only — and extending it needs the generic recursive matcher to
normalize `Error`/`Error` subject–pattern pairs as it descends. Surfaced
by the dual review of the site-operand change; no known user report.

### Named-argument calls — v1 residuals

Named-argument calls shipped 2026-08-12 (design record:
`docs/plans/2026-08-12-named-arguments-design.md`, §9 has the full
statements). One deliberate v1 limit remains open. (Three other
candidates are resolved: a declared-only overload set
declining a named call whose name-eliminated arm is more specific was
RULED correct behavior on 2026-08-13 — when names and positional
ranking disagree and there is no implementation to pin the call to, the
engine asks the author to be explicit rather than guessing (design doc
§4). And the two `Apply`-routed callee shapes whose names ARE knowable
were both fixed on 2026-08-13: the qualified protocol spelling
`Protocol.member(self: x, …)` permutes against the named protocol's
requirement signature, and an inline function-literal callee
`((x: number) => x + 1)(x: 5)` permutes against its own syntactic
parameter list — including UNANNOTATED inline literals, whose names
are read from the expression, not the inferred type. What still
declines through `Apply` is a callee whose names are genuinely not
knowable there: a symbol callee (`Apply(f, x: 1)` — write `f(x: 1)`),
and a literal with a parameter that is not a bare symbol or `Typed`
annotation. And the false STATIC diagnostics a named call to a
`:=`-assigned callee used to draw were FIXED on 2026-08-13: the static
pre-pass now registers the signature a `f := ⟨annotated literal⟩` or
`let/const f : ⟨arrow type⟩` statement pins, for the later statements
of the same program, under the pass's inference rollback frame —
`registerPinnedSignature` in `src/epsil/static-diagnostics.ts`,
regression tests in `test/epsil/execute.test.ts` "named calls to
`:=`-assigned callees". The decline still fires where it is truthful:
calls ahead of the assignment, and unannotated literals.)
- **Unannotated function literals are not addressable by name through
  a BINDING** — type inference drops parameter names
  (`effects-inference.ts` types a bare parameter as
  `{ type: 'unknown' }`), so `f := (a, b) => …; f(a: 1, b: 2)`
  declines even though the same literal applied inline now works.
  MEASURED 2026-08-13: the one-line fix breaks 37 tests across 11
  suites + 1 snapshot, including semantic suites (`effects-contracts`,
  `application-validation-regressions`, callback-contract and
  lambda-inference batteries) — a dedicated follow-up round, not a
  snapshot refresh.

### `Derivative` compile time vs body nesting depth (perf ask)

**RESOLVED 2026-08-14 (capability half)** — the shared-budget numeric
fallback (user-ruled): past the differentiation growth budget, the
javascript compile emits an 8th-order centered-difference stencil
(`_SYS.nd`) and interpreted `N()` computes the SAME shared function
(`centeredDiffHigherOrder`, numerics/numeric.ts), bit-identical across
routes; within budget the exact closed form is unchanged, and plain
`evaluate()` stays symbolic. `ND` at a runtime point now compiles.
Pinned in `test/compute-engine/compile-derivative-numeric-fallback.test.ts`.

**Open residual (perf):** the failed symbolic attempt still runs to the
growth budget before the fallback engages — once per derivative node per
compile (~1–2 s per node on the deep shapes; Tycho's Taylor witness pays
it three times, once per order, because each order's `derivative()` call
re-runs the shared first differentiation). If Tycho's compile-band gates
trip on this, the fix is an over-budget memo keyed on the resolved
function LITERAL (shared across the sibling `Derivative(f, k)` nodes) +
the semantic version — not a lower budget, which would change which
expressions get exact derivatives.

Historical numbers (pre-fallback): order-1 compile 6/21/77/429 ms at
depth 1/4/8/16, THROWS at depth 37, undifferentiated body single-digit
ms at every depth. (Reported by the Tycho project as its item 177,
`docs/COMPUTE_ENGINE.md` in `dev/tycho`; bare-engine repro
`docs/scratch/d209-ce-asks-repro.mts` there.)

Its sibling report, Tycho item 176 (a lambda `i ↦ Σ_{n=1..i} …`
compiling to all zeros with `success: true`), was root-caused and FIXED
the same day it was filed (2026-08-12, staged): a big-operator bound
whose name collides with a library constant (`i`, the imaginary unit;
`e`) was read through the shadowed engine symbol — `.re` of the
imaginary unit is `0`, so the range `1..0` folded empty — both when the
name was really a compile-bound parameter (fixed via
`BaseCompiler.bigOpBoundConstant()` refusing the constant fold for
compile-bound names, applied in the javascript/gpu/interval targets)
and at top level, where `bigopBoundValue` (`library/utils.ts`) dropped
a nonzero imaginary part instead of staying symbolic. Pinned in
`test/compute-engine/compile-sum-product.test.ts`, parameterized over
`i`/`e`/`k`/`n`/`x`. An earlier revision of this entry misattributed
the cause to enumerability of `Range` with undeclared bounds — the
enumerability tier was never implicated (an undeclared non-constant
bound always stayed symbolic; declaring `i: number` shadowed the
constant, which is what made declaredness look like the trigger).

### Static argument-checking of user-defined callees — residue

Tier 1 landed 2026-08-12; what remains is generic functions (below) and
`let`/`const` bindings. The history is kept because it explains the shape of
both.

`function foo(x: string, n: integer) { x }` followed by `foo("hello")` used to
pass `epsil check` clean; only the run phase reported the missing argument.
Builtins (`Ln()`, `Sqrt(1, 2, 3)`) were checked, since the library already
holds their signatures.

The cause was narrower than "the pass does not model prior declarations".
`staticDiagnostics()` boxes every statement in ONE pushed scope in source
order, and `DefineFunction`'s **canonical** handler already declares the name
there — so `foo` does exist when `foo("hello")` canonicalizes. What is missing
was its SIGNATURE: the handler deliberately loosens the target to the top type
`function` so that a recursive self-call inside the body does not validate
against a signature that does not exist yet (`library/core.ts`, "Tie the
recursion knot"), and nothing tightened it afterwards. The top `function` type
promises no arity, so every call type-checked vacuously.

Measured 2026-08-12: declaring the annotated signature by hand before boxing
the call makes the engine report `incompatible-type`, `missing` and
`unexpected-argument` for it immediately — the validator needed no new code,
only the signature.

**Tier 1 — `function` definitions — LANDED 2026-08-12.** `DefineFunction`'s
canonical handler now installs the clause once the body has canonicalized and
the recursion-knot loosening has been restored, so later statements validate
against the real signature. Multi-clause sets accumulate clause by clause; a
definition inside a block stays scoped to that block, so it cannot make an
outer call a false positive. GENERIC definitions are excluded and remain
unchecked until they evaluate — rule G2 refuses any clause onto a generic
target, which makes the install non-repeatable, and the evaluate route would
then reject its own re-installation.

**Tier 1 residue — generic functions.** Closing that exclusion means deciding
which route OWNS the clause install, so the second one can recognise its own
work rather than re-running it. Worth doing together with anything else that
wants canonicalization and evaluation to share an installation step.

**Tier 2 — `let`/`const` bindings.** `let g = (a: integer) => a` declares
NOTHING at canonicalization, so this tier is a genuine gap rather than a
loosened signature. It needs a decision on how much of an initializer the pass
may believe: an explicit annotation is safe, an inferred type less so, and a
binding that is reassigned or conditionally bound less so again.

Why it mattered beyond the CLI: the VS Code extension's diagnostics come only
from `checkSource()`, which is static-only by hard rule (it must never
evaluate the user's buffer). Before tier 1 the signature notes explained calls
to *builtins* only, and the "`foo` is defined here" related-information
pointer had nothing that could trigger it; both now work for the file's own
functions.

### `RecordFrom` was broken and redundant — DELETED (found 2026-08-14, user-ruled and removed 2026-08-15)

**Resolution: deleted.** `DictionaryFrom` is the conversion, for records as
much as for dictionaries, since record-ness is derived from the value. The
operator definition is gone from `library/collections.ts`, its reference
entry from `doc/82-reference-collections.md`, and
`test/compute-engine/collections.test.ts` now pins that the head is inert
while `DictionaryFrom` on the same input types `record{…}`. Appendix B
Phase 3's object-serialization arm therefore belongs on `DictionaryFrom`;
the appendix still says `RecordFrom` and must be amended before Phase 3 is
implemented. The diagnosis that led to the ruling is kept below.

`RecordFrom` declared `(collection) -> record` but returned an inert,
untyped application:

```
RecordFrom([("a", 1), ("b", 2)])  →  Record(("a", 1), ("b", 2))   type: unknown
DictionaryFrom(  same input    )  →  {"dict":{"a":1,"b":2}}       type: record{a: finite_integer, b: finite_integer}
```

The cause: **`Record` has no operator definition anywhere in the
engine** — `ce.box(['Record', …]).operatorDefinition` is `undefined`.
`RecordFrom` is the only member of the `…From` family whose result is
not a value of the type its signature promises, so its declared result
type lies.

The deeper point (user observation, 2026-08-14): a record and a
dictionary differ only in the TYPE world. In MathJSON there is no
distinction, and the engine already implements exactly that model —
`BoxedDictionary` synthesizes a `record{…}` type when every key is a
bare identifier and a `dictionary<…>` type otherwise, so record-ness is
DERIVED from the value rather than carried by a separate
representation. That makes `RecordFrom` redundant with
`DictionaryFrom`, not merely buggy: the latter already returns exactly
what the former promises.

Three ways out were considered, and the user ruled on 2026-08-15 for the
first: **delete** `RecordFrom`; alias it to `DictionaryFrom` (rejected — two
names for one operation forever, and the declared result type still
over-promises when a key is not an identifier); or give `Record` a real
operator definition (rejected — it contradicts the derived-record-ness model
and adds a second value representation to maintain). A `Typed(Dictionary(…),
"record{…}")` spelling was also considered and is NOT needed — the
derivation already happens, and ascription would only be meaningful for
ordinary widening (`record{a: number}` over a literal `1`), which is
plain `Typed` usage rather than a record mechanism.

Phase 1's serialization walk had already been switched to emit the
`Dictionary` operator form for this reason.

### Appendix B's mutability gate (B1) — SHIPPED 2026-08-16, sugar retired the same day

**Status.** The gate itself landed (work package 2C commit 1):
`mutabilityGate()` (the memoized predicate) / `mutabilityGateProblem()`
(the message) in
`src/compute-engine/engine-protocols.ts`, checked on all three registration
routes — `declareConformance()` (statement and box),
`declareProtocolImplementationImpl()` (host), and `settleFieldBacking()`
(protocol replacement, which leaves a now-inadmissible edge PENDING rather
than removing it, since conformance is monotone). Pinned by
`test/compute-engine/protocol-mutability-gate.test.ts` (50 tests: the
gate matrix across statement/box/host, conditional conformance on object and
non-object heads, the Appendix B `Badge` message verbatim, and the
replacement/inheritance consequences). 45 tests across 7 files were migrated
to object targets; the migration recipe is one line — declare the type as
`object{…}`.

**The rebinding sugar retired the same day** (work package 2C commit 2).
`p.name = v` no longer lowers to `p = «set name»(p, v)`: it is a STORE on
every route, it evaluates to the value assigned rather than to whatever the
`set` handler returns, and a non-object receiver is
`immutable-value-assignment` at whichever of the two timings settles the
target's type. Deleted with it: `protocolPropertyAssignment()` and its
`'rebind'` verdict, `property-assignment-target-invalid` (all emission
sites), and the registration check that forced an annotated `set` result to
fit the receiver — a result nothing consumes cannot be constrained.
`protocolPropertyStore()` in `src/compute-engine/engine-protocols.ts` is the
replacement, reached from the third rung of `Assign`'s evaluate ladder.
`xs[1].name = v` now stores into the element, as Appendix B says it should.
The qualified spelling `p.(Named.name) = v` became the same store restricted
to the named protocol (a fourth operand on `ProtocolProperty`). The compiled
property-SET lowering, which had no reachable receiver anyway — objects have
no compiled representation until Phase 4 — now fails closed (D6) with a
message that no longer talks about rebinding.

**Ruling: B1 stands as written.** A writable property is meaningful only on a
mutable object, so a protocol with a `readwrite` property (or a member
declaring `state`) admits object conformers only.

The rationale, which the rule alone does not convey, is now recorded at the
gate's spec section (`docs/TYPE_SYSTEM_ROADMAP.md`, "Which types can conform"):
Appendix A designed protocol properties before the language had any mutable
value, so `p.name = v` on a value type was given the only meaning then
available — rebuild and rebind. That rebinding sugar was a workaround for a
missing feature, and recognizing it as one is what motivated mutable objects
and the `object` type. With objects in the language it is superfluous.

**What the ruling accepts.** These three stop working, and that is the intent
rather than collateral damage (all verified working on 0.111.0 before the
ruling):

- `type Person = tuple<…> is Nameable` with `get`/`set` accessors — the Epsil
  rebinding sugar.
- `ce.declareProtocolImplementation(target, protocol, { setters: … })` on a
  host-declared value type. This is not an independent capability: it is the
  same rebinding sugar reached from the host API, so it retires with it.
- `type string is Tagged` with a `readwrite tag` — a builtin can never be an
  object type, so settable properties on builtins go away permanently. The
  P17 setter-validation surface (contravariant second parameter, `set`
  without `get`, `set` on a `readonly` property) must be re-pointed at object
  targets, since it is reachable only through targets the gate forbids.

The decisive argument was route ambiguity, not tidiness: one syntax with two
meanings selected by the receiver's type is what produced the Phase 1D
aliasing defect, where a store into an object was lowered to a rebinding and
every other reference to that object kept the old contents.

**Scheduling (historical): Phase 2, with its companions.** The implementation
plan scheduled B1 twice — Phase 1 step 5 named `protocol-requires-object` as
part of 1D's sugar retirement, and Phase 2 lists the mutability gate as its own
bullet. Phase 2 won: field-backed satisfaction (a stored field satisfies a
`readwrite` requirement with no accessor written) and `object-property-conflict`
are what a migrated conformance is re-pointed AT, and without them "what does
an explicit `set` accessor on an object mean" has no implemented answer.

Those two companions SHIPPED on 2026-08-15 (work package 2A:
`fieldBackedProperties` / `settleFieldBacking` in
`src/compute-engine/engine-protocols.ts`, pinned by
`test/compute-engine/protocol-field-backed.test.ts`), so the prerequisite is
discharged and B1 itself is what remains of this entry.

**FIXED 2026-08-16 (work package 2D): redefining an object TYPE now re-settles
its conformance edges.** `settleFieldBacking()` reads the target's stored-field
layout from the type registry as it stands when it runs, and a protocol
replacement re-settles every edge — so a changed REQUIREMENT was always picked
up. A cross-batch redefinition of the object type itself (`type P = object{…}`
run again with different fields, which the notebook pattern allows) used to
re-register nothing: no edge was re-settled, so an accessor synthesized for a
field the new layout no longer declared kept answering, a field the new layout
ADDED got none, and a RETYPED field left a value of the new type behind a
requirement statically typed as the old one. `declareType` now calls
`resettleTypeConformances()` (`src/compute-engine/engine-protocols.ts`) on
every replacement, which re-runs `implementationProblem`, `settleFieldBacking`
and `refreshInheritedPending` exactly as the protocol-replacement loop does, and
emits its `config` event and conformance-version bump only when a verdict
actually moved. Because objects keep their own pinned layout (Appendix B,
"layouts never migrate"), the field-backed READ and WRITE paths additionally
re-check the RECEIVER's pinned layout, so an instance built before a
redefinition is refused with `protocol-implementation-missing` for a property
its own layout cannot satisfy instead of answering symbolically or, worse,
answering with a value of the wrong type. A re-settled edge records WHY it went
pending (`ConformanceRecord._pendingReason`), which the end-of-batch
`protocol-implementation-pending` warning now carries. Pinned by
`test/compute-engine/protocol-type-redefinition.test.ts`, with the protocol
half's replacement quartet added to
`test/compute-engine/protocol-field-backed.test.ts`.

**RULED 2026-08-16 — a re-settlement that would falsify a declared effect
contract refuses the EDGE, not the `type` statement.** Re-settling can move a
conformance edge from pending back to satisfied, and that can widen a
dispatcher's derived effect union (the union skips pending edges) after a
function was already accepted as `pure` for calling through it. The three
conformance-REGISTRATION routes reject the offending statement outright.
`declareType` deliberately does not, for two reasons: by the time
`resettleTypeConformances()` runs the type declaration is complete, and
unwinding it would have to reach back through the constructor
`mintTypeConstructor` bound, whose restore is local to its own failure path;
and a type declaration should not fail because of somebody else's `pure`
annotation somewhere across the program. So the type stands, the offending
edge is put back to the settlement it had before the sweep, and it records the
`conformance-widens-declared-contract` message as its `_pendingReason` — which
is where the author is told.

The refusal is per EDGE and re-checked after each one, so an unrelated
conformance the same re-declaration satisfies is untouched, and a violation
that was already there before the sweep costs no re-activation anything. When
the walk finds anything at all, the re-activations are ALL undone, the
surviving violations are recorded as the baseline, and the edges are then
handed back one at a time — each kept if it introduces nothing against that
baseline, each put back if it does. There is no second pass and no joint
verdict: a contract breaks when the union over the non-pending conformers
escapes a FIXED declared ceiling, and a union cannot escape a ceiling both of
its parts respect, so an edge that introduces nothing alone cannot introduce
anything on top of the edges already kept. Several edges may be refused by one
declaration; each is told what IT exceeded.

NOTHING IS REMEMBERED between sweeps: every sweep re-derives the whole
question. An edge therefore stays refused exactly as long as an offending
contract exists, and un-refusing it needs no bookkeeping — the author widens or
removes that annotation, installs a block that does not widen, or replaces the
protocol, then re-runs the type declaration. The price is one widening walk per
sweep that re-activates something, which is zero for the overwhelming majority
of sweeps. Version-bump economy comes from comparing the FINAL state to the
one the sweep started from: a sweep whose re-activations were all refused lands
where it began and emits no `config` event. (A sticky stamp was tried and removed: it was
stolen by sibling edges and needed clearing rules at four registration sites,
neither of which the re-derivation has. The inheritance interaction is NOT free
either way — reverting a refused source strands the block-less edges that were
granted its implementation earlier in the same sweep — and the sweep answers it
by ORDER rather than by repair: inheritance is computed once, after every
authored verdict and every refusal is final, so no inheritor is ever granted
from a source that is later put back.)

All three routes work: REMOVING the annotation
(`function caller(t) pure -> integer` redefined bare) retracts the contract, a
non-widening block fulfils the edge, and replacing the protocol retires the
requirement set. The retraction needed two fixes, both landed:
`BoxedOperatorDefinition.update()` replaces the annotation provenance instead of
merging it, and the Epsil lone-clause REDEFINITION path
(`defineFunctionClause`, `multi-clause.ts`) rebuilds the provenance from the
incoming statement — `ce.assign` installs a body, not a signature, so the
previous annotation would otherwise have survived a redefinition that dropped
it.

**OPEN, adjacent: a redefinition cannot WIDEN an effect annotation.**
`function h(x: integer) -> integer { x }` redefined as
`function h(x: integer) random -> integer { x }` is refused
`incompatible-type: pure effects / random effects`, and so is any
pure→random rewrite. The cause is not the provenance (that is fixed) but
`ce.assign`'s type check, which validates the incoming literal against the
binding's EXISTING signature instead of replacing it — a redefinition should
replace, per "Across units" in
`docs/plans/2026-08-14-redefinition-discipline.md`. Not fixed here: `ce.assign`
is shared by every `f := …`, declare-then-define, multi-clause accumulation,
generics and overloads, and the change could not be verified against those
suites within this round. It does not block the ruling — removing the
annotation is a working retraction route — but it makes "widen it" unreachable,
so the docs promise removal, not widening.

**KNOWN, not scheduled: pinned layouts are SHALLOW.** `detachDefinitionBody`
(`boxed-expression/boxed-object.ts`) copies an object body one level deep and
shares the field TYPES, so a field typed through a transparent alias — or
through another nominal object type — still holds the reference the registry
holds, and re-declaring that alias moves the pinned layout with it. Deep-
resolving aliases at pin time was considered and not done: it needs a new
identity-preserving type walker, it changes the printed type of every such
field (`p.a` would read `string` where the author wrote `A`), it defeats the
identity fast path in `pinnedLayoutRefusal` for every alias-typed field, and
it still would not cover the nominal case. Instead the read path validates the
STORED VALUE against the requirement, which closes the whole class: whatever
route the layouts drifted by, a read may not deliver a value the property's
declared type does not admit. Pinned by the alias case in
`test/compute-engine/protocol-type-redefinition.test.ts`.

**RULED 2026-08-16: a re-declared alias RETYPES values already stored through
it, and the plain field read follows the alias.** With `type alias A = string`,
an object `p` of `type T = object{a: A}` holding `"s"`, and then `type alias A =
integer`, `p.a` is declared `integer` and answers `"s"`. The same question
exists without objects at all — `let x: A = "s"` followed by `type alias A =
integer` — and the ruling is one answer for both: an alias is a spelling, not a
box, so re-declaring it re-spells every annotation written through it and does
not revisit the values those annotations described. The PROTOCOL route is the
exception rather than the rule: a conformance promises what a read delivers, so
`p.(P.a)` refuses rather than hand back a value the property's declared type no
longer admits. Pinned in `protocol-type-redefinition.test.ts`.

**Migration cost, MEASURED on landing (2026-08-16): 45 tests** across
`protocol-properties.test.ts` (23), `protocols.test.ts` (9),
`protocol-dispatch-compile.test.ts` (5), `effects-state-label.test.ts` (3),
`object-store.test.ts` (2), `protocol-field-backed.test.ts` (1),
`test/epsil/protocols.test.ts` (1), plus one executable `epsil-live` block in
`src/epsil/docs/protocols.md`. (A pre-ruling dry run on 2026-08-15 measured 32,
over three files; the shortfall was the effects and object-store suites, which
gained fixtures in between.) Every one conformed a `readwrite` — or
declared-`state` — protocol to a non-object type.

Appendix B item 5 calls the migration "mechanical". For a fixture whose point
is the CONFORMANCE it is: declare the type as `object{…}`, and its constructor
becomes named-argument. Two classes needed real rewriting, and both are worth
knowing before the sugar retires:

- **A setter must decide what it now means.** Rebuilding
  (`Person(n: v, age: self.age)`) preserves a rebinding test; storing
  (`self.n = v` then `self`) is the behaviour the gate exists to enable, and
  makes the write visible through every alias. Fixtures were migrated to
  whichever the test was actually about.
- **The P17 setter-validation surface needs an object with NO field of the
  property's name.** A stored field of the same name satisfies the requirement
  by itself (Appendix B's field backing) and removes the hand-written accessors
  under test. The fixtures use `object{v: string}` against properties
  `hash`/`name`.

One consequence has NO migration: the compiled property-SET lowering in
`base-compiler.ts` is currently unreachable, because every legal receiver is
now an object and objects have no compiled representation until Phase 4. Those
tests were re-pointed to pin the fail-closed verdict instead
(`protocol-dispatch-compile.test.ts`), and the loop-body declared-type-merge
claim they also carried was preserved by re-expressing it over a function
member.

With the sugar gone there is one mechanism for the syntax, and Phase 1D of
`docs/plans/2026-08-13-mutable-objects-implementation-plan.md` is formally
closed.

### A store through an UNANNOTATED parameter was not labelled at all (found and FIXED 2026-08-16)

`function k(x) pure { x.id = "Z" }` was ACCEPTED, and calling it mutated the
caller's object behind the `pure` contract:

```epsil
type M = object{id: string}
function k(x) pure { x.id = "Z" }   // was accepted; now refused
let m = M(id: "a")
k(m)
m.id                                 // was "Z" — mutated behind a `pure` contract
```

Both effect channels resolve the receiver from DECLARED types — inside an
unentered `Function` literal there is no frame binding the parameters, so
canonicalizing `x` reports `unknown` and decides nothing. With no evidence the
assignment fell to the `scope` path, where `assignTargets()`
(`boxed-expression/effects-inference.ts`) attributed it to the base symbol `x`
— a parameter, hence confined — and the literal inferred no effect at all.

**Fixed: an UNDECIDED receiver is treated as a store.** After the rebinding
sugar retired, assignment through a `Field` target is a store and never a
binding write, so a receiver nothing is known about is either a heap store or a
runtime error — `state` is the sound over-approximation of both, and it is what
refuses the `pure`. Applied on both channels, which must not disagree about the
same assignment: `Walker.isFieldStore` (`effects-inference.ts`) and
`isObjectFieldStore` (`effects-of.ts`). A receiver whose type IS decided and is
not an object stays unlabelled — `p.name = v` on a record is
`immutable-value-assignment`, which changes nothing.

The alternative — refusing the confinement exemption, so the write reports
`scope` — was rejected: `scope` claims a BINDING was written, which a store
never does, and it trips the default-`!scope` ceiling, so the ordinary
`function rename(x) { x.id = "X" }` would have been refused outright and forced
to carry a label that misdescribes it. `state` does not trip that ceiling, so
the bare definition installs and works; it is pinned along with the refusal in
`test/compute-engine/protocol-property-effects.test.ts`.

### `readonly` in a protocol does not stop a holder of the OBJECT from writing the field (found 2026-08-16, OPEN — needs a product ruling)

Declaring a property `readonly` in a protocol constrains the PROTOCOL view of
it, not the object. With

```
protocol Named { readonly name: string }
type P = object{name: string} is Named
let p = P(name: "Ada")
```

the PROTOCOL view of the write is refused — `["ProtocolProperty", "Named",
"name", p, "Grace"]` answers `protocol-property-readonly-set` and `p.name` still
reads `"Ada"`. But `p.name = "Grace"` stores straight through the object's
layout and succeeds: it never consults `Named` at all.

Measured while pinning this, and part of the same surface problem: the Epsil
spelling `p.(Named.name) = "Grace"` DOES now reach that readonly refusal — with
the sugar retired it lowers to `ProtocolProperty("Named", "name", p, "Grace")`,
the protocol view, and answers `protocol-property-readonly-set`. So the two
spellings of one write disagree: the qualified one is refused, the unqualified
`p.name = "Grace"` stores straight through the layout and succeeds. That is the
surprise stated sharply rather than a second defect, and it is what the
alternatives below have to resolve.

Kept for now, and the reasons are real. Two protocols may legitimately see one
field with different mutability — a type can conform to a `readonly Named` and
a `readwrite Renameable` over the same `name` field — so `readonly` cannot mean
"this field is immutable" without breaking that. And refusing the direct write
would mean that ADDING a read-only conformance to an existing type silently
breaks every existing writer of that field, which is a bad property for a
declaration that is supposed to be additive.

Arno finds it surprising and misleading nonetheless, and wants the alternatives
thought through before Phase 2 closes:

- a LAYOUT-level field modifier, so immutability is stated where the field is
  (`object{ const id: string }`), leaving `readonly` to mean only what the
  protocol view promises; or
- requiring a non-writable field to satisfy a `readonly` requirement, so
  field-backed satisfaction of a `readonly` property implies the field itself
  cannot be written.

Current behaviour is pinned (both halves) by
`test/compute-engine/protocol-field-backed.test.ts`, so whichever way this is
ruled the change is visible.

### A field store's EXPRESSION-level effect is still `scope`, not `state` (found 2026-08-15 in review; the inference half FIXED same day, the expression half FIXED 2026-08-16 — CLOSED)

Appendix B rules that changing a field carries the `state` effect. That held on
the inference channel and not on the expression channel; both now hold.

**Fixed (2026-08-15).** A function whose body stores into a field infers
`state`: `function rename(x: M) { x.id = "XXXX" }` reports `["state"]` where it
previously inferred nothing at all. The walker already received declared
parameter types from `functionLiteralParameters` and discarded them; it now
keeps them, so a `Field` target whose receiver is a parameter of an object type
declaring that field is recognised as a HEAP STORE and contributes `state` with
no confinement exemption. A `Field` target that is anything else — most
importantly the property rebinding sugar on a value type — still takes
`scopeWrite` unchanged, which is why this landed with zero churn to the six
`protocol-dispatch-compile` tests that the earlier blunt attempt broke.

**Fixed (2026-08-16).** At the EXPRESSION level a store now reports `state`.
`Assign` spells two different operations — a binding write and a heap store —
and one declared arrow (`(symbol | expression, any) scope -> any`) cannot say
both, so the label is decided per call site: `mutationEffects()` in
`effects-of.ts` replaces `scope` with `state` when the `Assign` target is a
`Field` whose root is a bare symbol whose DEFINITION's type resolves to an
`object{…}` layout declaring that field — the same evidence
`Walker.isFieldStore` uses on the inference channel; a bare-symbol receiver is
read off its definition (because `Assign` keeps its left operand raw), a nested
or indexed one from its canonical type. Assignment to a plain symbol and to a
record field keeps `scope` untouched.

The same hook labels a four-operand `ProtocolProperty` — the setter invocation
of a `readwrite` protocol property — `state`, since a writable property is
meaningful only on a mutable object (Appendix B, "Which types can conform").
That verdict is taken from the SHAPE of the call, without asking which
conformer's setter was selected, which is deliberately generous in one
direction: the Appendix A rebinding sugar (`d.name = v` on a tuple, which
rebinds `d` and mutates nothing) lowers to the same four-operand form and would
be labelled `state` too, so such a statement reports `["scope", "state"]` rather
than `["scope"]`. Asking the registry instead would answer "pure" for a genuine
object whose conformance had not registered yet — an inference walk runs before,
and independently of, conformance registration — and a body annotated `pure`
could then mutate its caller's object. The over-label is now unreachable in any
case: the B1 mutability gate refuses a value type conforming to a settable
property, so no value type has a setter to assign through.

On top of the fixed contribution, both halves union in what the AUTHORED
accessor bodies do, read off the stored literal's stamped arrow
(`protocolAccessorEffects` in `effects-of.ts`): a computed getter whose body
draws makes the qualified read `random`, and a setter that writes an outer
binding makes the set `scope` as well as `state`.

Effect CONTRACTS are enforced on both halves: annotating a
storing function `pure` is refused with
`incompatible-type: expected \`pure effects\`, got \`state effects\``, the same
shape a `scope` write or a `Random()` draw already produced.

### A protocol accessor's body cannot see its own receiver (found 2026-08-16, FIXED 2026-08-16)

An authored `get`/`set` block is stored as a function literal whose receiver is
declared `Self`, and the `Self` substitution used to happen per dispatch rather
than on the stored literal. The effect walk therefore saw that parameter typed
`unknown`, and a store the accessor performed on it was invisible:

```
type Q = object{n: integer} is Aged {
  set age(self: Self, v: integer) -> Self { self.n = v
    self }
}
```

The setter's arrow reported no effects, where the identical body written as
`function f(x: Q) { x.n = v }` reports `state`. What was lost is the accessor's
own contract: annotating that setter `pure` would not have been refused by the
body evidence.

FIXED: `declareConformance` now applies the `Self` substitution to the stored
implementation block ONCE, at registration, before the block is either
validated or stored (`groundedImplementationBlock` /
`groundedImplementationLiteral` in `engine-protocols.ts`). Every consumer — the
P17 check, the effect walk, dispatch's `apply()`, and the literal's own `.type`
arrow, which `protocolAccessorEffects()` in `effects-of.ts` reads — therefore
sees a ground receiver type. The setter above now infers `state` and its stored
arrow carries it.

The rewrite is RECURSIVE over the whole literal, so it reaches every position
that carries a type-expression source text, not just the receiver: the
parameter slots, BOTH marker shapes (`["Function", ["Typed", body, sig], …]`
and the canonical form where the marker sits inside the Block wrapping its last
statement — the second used to throw `Function body must be a scoped Block
expression` out of `.evaluate()` on the raw-MathJSON route), a `let`'s
annotation inside the body (`let s: Self = self`, which rides as
`["Declare", name, T, …]` and used to fail with `Failed to parse type "Self"`
and no diagnostic), and the annotations of any nested literal. Grouping is
preserved when a text is re-serialized (`isGroupedTypeText`): a fully
parenthesized annotation means "this value IS a function", and `typeToString`
emits the ungrouped spelling, which `bodySlotSignature` would re-read as the
literal's own contract. `implementationLiteralAt` (the compile path) was
dropping grouping the same way and now preserves it too.

Covered by `test/compute-engine/protocol-property-effects.test.ts` ("an accessor
body's own effects ARE propagated") and
`test/compute-engine/protocol-annotated-members.test.ts`.

CONDITIONAL conformances now FAIL CLOSED at the declaration (ruled 2026-08-16).
A conditional conformance (`type list<T> is P where T: number { … }`) is left
unsubstituted: its `Self` is a head PATTERN, whose only ground stand-in is the
widest instantiation (`list<number>`), and P17 checks the implementation's
COVARIANT positions against the pattern instead — so a stored literal ground to
the widest instantiation fails that check (a member declaring `-> Self` would
read as `-> list<number>` and be rejected against `-> list<T>`; verified by
running `test/compute-engine/protocol-conditional.test.ts` against that
variant). `implementationLiteralAt` declines a conditional edge for the same
reason.

So rather than accept such a block and die at the call with
`Function body must be a scoped Block expression`, an effect specifier on a
member of a conditional conformance is REFUSED when the conformance is
declared, with `protocol-conditional-member-effects` — a message that names the
specifier and the member and says the effects are inferred instead. Nothing is
registered. A conformance to a ground type is unaffected. Pinned on both routes
by `test/compute-engine/protocol-annotated-members.test.ts` and documented in
`src/epsil/docs/protocols.md` ("No effect specifiers on a conditional member").

**OPEN, adjacent: lifting the conditional restriction.** The fail-closed
refusal above is the ruling and is not itself a defect; what stays open is
allowing an effect specifier on a conditional member at all. It needs the
author's RAW block kept apart from a GROUNDED
dispatch view: P17 must keep reading the author's text (so the covariant check
still runs against the head pattern), while dispatch, the effect walk and the
literal's `.type` arrow read a receiver ground at the widest instantiation. The
obstacle is bookkeeping, not semantics — `_authored` would hold the raw block
and `impl` the grounded one, but `settleFieldBacking` rebuilds `impl` from
`_authored` and `mergedMapMatches` compares the two by REFERENCE, so the
grounded view has to be identity-stable or every registration rebuilds the
merged map and emits spurious `config` state events.

### An effect annotation on a protocol implementation member makes it uncallable (found 2026-08-16, FIXED 2026-08-16)

Any effect marker on any member of an `is P { … }` implementation block — a
function member, a `get`, or a `set` — registered without complaint and then
failed at every dispatch with `Error("Function body must be a scoped Block
expression")`. Removing the marker made the same program work:

```
type T = object{n: integer} is S {
  function f(self: Self) pure -> integer { self.n }   // f(t) → Error(…)
  function f(self: Self) -> integer { self.n }        // f(t) → 5
}
```

Two consequences. The member was unusable, and — because the annotation never
reached a contract check — an implementation block's declared effects were never
checked against what its body does: `function f(self: Self) pure -> number {
Random() }` registered happily, where the same annotation on a top-level
`function h() pure -> number { Random() }` is correctly refused with
`incompatible-type: expected pure effects, got random effects`.

FIXED, in two halves:

- CALLABILITY. An effect specifier lowers to a full marker signature in the
  literal's body slot (`["Typed", body, "'(self: Self) pure -> integer'"]`).
  That text mentions `Self`; `canonicalFunctionLiteral` parses a body-slot
  marker and, when it does not parse, replaces the body with an error
  expression — leaving the literal with no Block for a body. The `Self`
  substitution on the stored literal (see the entry above) makes the marker
  parse, so an annotated member is callable on the statement route and the box
  route alike. A member annotated with the target's own name (`self: Box`)
  always worked, which is why the bug looked property-specific.
- CONTRACT. `implementationProblem` now checks a member's OWN declared effects
  against the effects inferred from its body — the same `declared ⊇ inferred`
  rule a top-level definition is held to, reported through the same
  `incompatible-type` error value with the same two arguments (expected effects,
  inferred effects). It applies to `get`/`set` accessors as well as function
  members, so a `pure` setter that stores into its receiver is refused. Like
  every other per-member problem, the first one refuses the conformance as a
  whole: nothing is registered. A host (JavaScript) implementation is unaffected
  — it carries no signature and stays trusted (design P10).

Covered by `test/compute-engine/protocol-annotated-members.test.ts`. The
conditional-conformance residue is described in the entry above.

### A field store's no-op guard almost never fires (found 2026-08-15, OPEN — needs a product ruling)

`BoxedObject._store` suppresses a store whose new value is the **identical
node** as the current one (no version bump, no state event). Appendix B
licenses that elision by observing that "the evaluated result can be an
interned node (equal small-integer literals share one boxed value
engine-wide)".

Measured: that holds for host-built literals (`ce.number(1) ===
ce.number(1)` is `true`) but NOT for a literal that came through the parser,
which carries its own source offsets and is a distinct instance. So over a
stored `1`:

```
p.n = p.n     suppressed  (the very same node)
p.n = 1       BUMPS       (a fresh parsed literal)
p.n = 1 + 0   BUMPS
p.n = 4 + 1   BUMPS       (over a stored 5 computed as 2 + 3)
```

Consequence: a loop that writes back an unchanged value invalidates every
cache entry that read the field, once per iteration, although no reader can
observe a difference. Correctness is unaffected — the guard is an
optimization, never a semantic requirement.

The fix would be to widen the guard from `===` to `.isSame()`, which is
sound (`isSame` is an unconditional equivalence relation and is reference
identity for objects, so a suppressed store is still observably nothing).
It is NOT applied unilaterally because it contradicts a standing ruling —
the decision note specifies "object identity only, mirroring
`boxed-value-definition.ts`'s value setter" — and costs a structural walk on
every store, which is a real per-store price in exactly the store-heavy
loops objects exist for. Pinned as-is by
`test/compute-engine/object-store.test.ts` ("an EQUAL-but-not-identical
store still bumps") so the gap stays visible.

### A literal argument to an `inout`-parameterized constructor over-narrows (found 2026-08-14)

`let c: Cell<integer> = Cell(value: 1)` is rejected with "expected
`Cell<integer>`, got `Cell<finite_integer>`": the integer literal `1`
infers `finite_integer`, the type parameter is declared `inout` (hence
invariant), and invariance refuses the narrower instantiation. Verified
PRE-EXISTING and not specific to object types — a shipped tuple body
behaves identically (`type Box<inout T> = tuple<value: T>` with
`Box(1)`), so this is the standing interaction between literal type
inference and `inout` invariance, surfaced by Appendix B's generic
object types (B13 makes every stored field invariant, so object
declarations meet it routinely). The fix direction is to let a literal
argument widen to the parameter's declared instantiation when one is
given by the annotation, rather than solving the parameter from the
literal's narrowest type; it needs its own ruling because the same
rule governs every `inout` nominal.

### Protocols residue (protocols + compiled dispatch landed 2026-08-12)

- **A provisional rebuild of a VALUE-bound literal never re-verifies its
  declared effects contract** (found 2026-08-14, dual review of the
  effects-provenance + Phase-0a staged set). `installRebuiltLiteral`
  (`function-utils.ts`) swaps a value definition's stored literal via the
  bare `value` setter, which touches neither `type` nor `effectsDeclared`
  — so a binding declared `(…) pure -> …` whose body froze a provisional
  application can have that body rebuilt into an EFFECTFUL one with no
  contract check on this route (the operator branch re-validates inside
  `update()`). Reachable only through the provisional-dependents cascade
  on declare-then-assign value bindings; the fix is an
  `assertDeclaredEffects`-style check in the value branch, re-deriving
  the rebuilt literal's effects against the declared arrow.

- **Box-route conformance implementations are not callable** (found
  2026-08-14 during the Phase-0a derived-dispatcher-effects round;
  user-ratified 2026-08-14 as a follow-up — the box route stays
  registration-only until the `Self`-aware canonicalization below lands).
  `ce.box(["DeclareConformance", …]).evaluate()` stores the implementation
  function literal held and UNBOUND (its annotations mention `Self`, which
  ordinary canonicalization cannot resolve, so the block is deliberately
  kept raw), and dispatching through such an implementation later throws
  `Function body must be a scoped Block expression`
  (`function-utils.ts` `invokeImplementation` → `apply`). The Epsil
  statement route canonicalizes and works; the CE-route protocol tests
  never *call* an implementation, so the throw is unpinned. Same family as
  the "impl literals applied raw per call" follow-up flagged when
  protocols landed: the fix needs a `Self`-aware canonicalization of the
  stored block (at registration, with the conformance target bound), not a
  blanket `op.canonical`.

- **A value-bound function literal's arrow is baked into callers' effect
  stamps** (recorded 2026-08-14, Phase-0a residual). The derived-effects
  re-derivation (`consultsRegistry`, `effects-inference.ts`) keeps a
  definition fresh when its body reaches a protocol dispatcher directly or
  through OPERATOR-definition callees, but a body that reaches one only
  through a VALUE-bound literal (`g := (x) => speak(x)` stored as a value
  binding, then `f` calling `g`) freezes `g`'s arrow as read at `f`'s
  install: the walk cannot see that the value's own arrow is
  registry-dependent. Consistent with the shipped construction-time
  snapshot semantics, but it narrows the widening guard's transitive reach
  on that path. Lifting it needs a registry-dependence bit on the
  LITERAL's arrow (or type), not just on operator definitions.

- **`InverseFunction(f)` / `Derivative(f, n)` as a lazy operator's
  callback are rejected** (found 2026-08-13; same family as the
  qualified-protocol-member callback fix that landed that day).
  `Map(InverseFunction(Sin), [1, 0])` reports
  `incompatible-type function/unknown`: the held callback arrives RAW,
  where its type reads `unknown`, so the function-value gate
  (`denotesFunction`, function-utils.ts) cannot answer and the
  constant-nullary reject fires. A loud error, not silent wrong values
  — and the explicit-lambda spelling
  (`Map((x) => InverseFunction(Sin)(x), xs)`) works. The protocol-member
  case was fixable with a registry-keyed syntactic recognizer
  (`isQualifiedProtocolMember`); these shapes need per-operator
  knowledge ("which operator applications denote function values when
  raw?") — a small denotes-function operator table, or canonicalizing
  the callback operand before the gate, would lift them.

- **Sum-name conformance** — `type shape is Area`, where `shape` is a sum
  type, is rejected with `protocol-conformance-target-invalid`: the sum
  sugar registers the sum name as an alias, and an alias cannot conform.
  Per-variant conformance blocks are the working pattern (and what compiled
  dispatch keys on), but the whole-sum spelling is the natural thing to
  write. Product question to rule on: should it desugar to one conformance
  edge per variant (with `Self` = the variant), or stay an explicit error
  pointing at the per-variant form? If desugared, decide whether a later
  variant added to the sum re-runs the conformance (batch re-run semantics,
  P47) and how a per-variant duplicate is reported.

### Contextual callback typing residue (Design D landed 2026-08-09)

The `callback<S>` conversion of the 15 collection operators
(`docs/plans/2026-08-09-design-d-generic-callback-signatures.md`) closed
with these items open. Items marked RULED-DEFERRED have a maintainer
decision on record; the rest are recorded here so they are not
rediscovered from the outside.

**Deferred by ruling (each names what unblocks it):**

- **`Map`'s honest signature spelling** — the declared
  `(collection<T>, mapping: callback<(T) -> U>, collection*)` misorders
  the zip form's callback-last convention; the type system cannot spell
  required-after-variadic. RULED-DEFERRED 2026-08-09 (spec §9 item 5b,
  with the two candidate fixes: suffix-parameter support, or flipping
  `Map` to callback-first). Unblocked by: choosing one.
- **Standalone-lambda runtime check emission** — `literal.compile()`
  then `run(violatingValue)` silently computes where the interpreter
  errors; every in-engine route is enforced. RULED-DEFERRED 2026-08-09
  with the direction fixed (per-primitive check-emission table +
  "unenforceable → decline"); see the "Known limit" section of
  `docs/plans/2026-08-08-lambda-param-element-inference.md`.
- **`FlatMap`'s `evaluate` materializes on the SOURCE's finiteness
  alone** — it retains the optimistic assumption its `isFinite` facet
  dropped (2026-08-09); re-gating on `expr.isFiniteCollection` would
  make every unprovable-callback `FlatMap` stay symbolic. Needs a
  ruling before changing.
- **Phase 4: comparator slots** (`Sort`, `ChunkBy`, …) — whether they
  convert to `callback<(T, T) -> …>` at all (spec §9 item 6).
- **Seeded-fold accumulator stamping** — deliberately never stamped
  (spec §12.1: stamping it breaks type-changing accumulators, probed);
  re-opening needs a bound (`forall T, U: value.`) and a re-ruling.

**Known limits, recorded in spec §9b, no action unless demanded:**
binder-route (`rawOps`) applications skip the contextual stamp
(unreachable today — tripwire comment at the gate); `callback<S>`'s
parameter-position-only intent is unenforced (other positions behave as
`function`); a union of two DIFFERENT `callback<S>` members resolves
first-seen; undeclared source symbols infer `collection<unknown>` (the
standing polytype behavior).

**Cleanups (opened here 2026-08-09; the first five CLOSED 2026-08-09):**

- ~~Cross-operator asymmetries on degenerate inputs~~ — CLOSED. Ruled
  and applied family-wide: a source with no value leaves every operator
  INERT (matching `Length`/`Total`/`Sort`, which always did), and a
  PARAMETERLESS operand at a callback slot reports the declared slot's
  `incompatible-type` everywhere instead of thunk-lifting on the lazy
  half. Predicate errors now name their own operator. See
  `isEnumerableSource` (collection-utils.ts) and
  `canonicalCallbackOperand`/`predicateResultError` (collections.ts).
- ~~Kleene-logic helper triplication~~ — CLOSED: one shared home,
  `src/common/kleene.ts`.
- ~~The `Signature` operator is inert on the box/parse routes~~ —
  CLOSED: the name is resolved by lookup (read-only — canonicalizing
  the held operand would DECLARE an unknown name).
- ~~The signature-driven trigger's positional pairing has no arity
  guard~~ — CLOSED: it declines the whole stamp, as the
  contextual-solve route does.
- ~~`src/math-json/OPERATORS.json` is stale for `Map`~~ — CLOSED:
  regenerated (it was stale for 41 more operators, and missing three);
  two generator arity defects fixed with it.
- ~~A WRAPPER over a valueless source still answers as if empty~~ —
  CLOSED 2026-08-10 by the enumerability facet this item asked for.
  `isEnumerableCollection` (expression) / `isEnumerable` (collection
  handler) answers "will `each()` produce the elements?" structurally,
  so an empty walk is attributable: `true` means EMPTY, `false` means
  unwalkable (symbolic-bound `Range`/`Linspace`/`Repeat`/`Tabulate`, a
  valueless symbol), `undefined` only for an eager operator that has no
  collection handlers until evaluated. A wrapper propagates from its
  source ALONE (`enumerableFromSource` / `enumerableFromAllSources`)
  and never reads its own emptiness, which is what keeps it cheap —
  the depth-d `Filter` chain went from 2^(d+1) − 2 predicate calls to
  d(d+1)/2 (3/10/21/36 at depths 2/4/6/8), pinned in
  `collection-callback-signatures.test.ts`. The dual review of
  2026-08-10 found the same misreading of `isFiniteCollection` as
  enumerability on eight more guards (`CountIf`, `Position`,
  `Ordering`, the 2-arg `Count`, and the walking `count` handlers of
  `Filter`/`TakeWhile`/`DropWhile`/`Dedup`/`ChunkBy` — all finite
  because `Take(xs, 2)` caps at 2, all walkable only if `xs` is); they
  are fixed and pinned too.
- ~~Eager collection leaves under wrappers: wrong values on GROUND
  input, empty-reads on symbolic input~~ — **mechanisms SHIPPED
  2026-08-11; adoption is incremental and OPEN** (design + rulings:
  `docs/plans/2026-08-11-eager-collection-enumerability.md`; tests:
  `eager-collection-enumerability.test.ts`). Defect A (wrong values on
  ground input — `Filter(Take(Divisors(12), 3), _ > 1)` → `[]`) is
  CLOSED for all pure eager producers: `at()` now has the
  materialize fallback `each()` always had (`_materializedAt`,
  `boxed-function.ts` — pure sources only, evaluated once per
  instance/generation via the `cachedValue` idiom). Defect B (wrapped
  symbolic source read as empty) is closed PER ADOPTED OPERATOR via
  the `canEnumerate` definition handler; adopted so far: `Characters`,
  `GraphemeClusters`, `UnicodeScalars`, `Utf8`, `Utf16`,
  `StringSplit`, `Divisors`, `PrimeFactors`, `FactorInteger`,
  `IntegerDigits`, and (decline-only) `Sort`/`Ordering`/`Unique`/
  `Tally`. **Adoption round 2 (2026-08-11, three parallel passes)
  CLOSED the sweep: 45 of the 73 producers now declare
  `canEnumerate`**, the other 28 are deliberate, categorized skips —
  the sweep itself is DONE, not paused. Round-2 additions: `true`-capable
  `Shape` (no decline path), `Keys`/`Values` (dictionary test),
  `AbsArg`, `ComplexRoots`, `ExtendedGCD`, `PlusMinus`; decline-only
  `Eigenvalues`/`Eigenvectors`/`Eigen`/`SingularValues`/`SVD`/
  `LUDecomposition`/`QRDecomposition`, `Cross`/`MatrixMultiply`/
  `HadamardProduct` (both operands), `Flatten` (scalar carve-out:
  `Flatten(5)` succeeds, so a number operand is `undefined` not
  `false`), `Chunk`, `GroupBy`, `ListFrom`/`SetFrom`/`TupleFrom`
  (collection-typed operands only — a scalar operand is legitimate),
  `DictionaryFrom`/`RecordFrom`, `BinCounts`/`Histogram`,
  `ContinuedFraction`, and the IMPURE trio
  `RandomShuffle`/`RandomChoice`/`RandomSample` (domain-facet only,
  zero draws, never `true`). The 28 skips, by category, all pinned or
  reasoned: **permanent `undefined` tier** (success not cheaply
  decidable, by ruling): `Solve`, `FindRoot`, `FindFit`, `NDSolve`,
  `PolynomialRoots`, `Kernel`, `CoefficientList`, `QuotientRing`,
  `LinearRegression`, `PolynomialFit`, `TruthTable`,
  `PrimeImplicants`/`PrimeImplicates`, `Table`, `Timing` (operand
  purity is the operand's), `Position` (already guarded by
  `isEnumerableSource`), `Dictionary`, `Limits`,
  `ColorFrom`/`ToColorspace`, `Quartiles` (see the crash item below);
  **structurally ineligible**: `Pair`/`Triple`/`Single`/
  `KeyValuePair`/`Vector` (canonicalize away — no canonical leaf ever
  exists), `Tail` (evaluates to `Nothing` for every surviving form),
  `Adjoin` (inert by design, no evaluate handler). Candidate noticed
  for a later look: `Dot` (linear-algebra.ts) has decline paths and no
  handler. An IMPURE producer under an indexed wrapper
  (`Take(RandomShuffle(xs), 2)`) still walks empty — the fallback is
  pure-only by ruling (per-generation re-draws would mix draw-sets);
  that case belongs to the draw-coherence item below.
- ~~`Quartiles` throws a `TypeError` on a symbolic operand~~ — CLOSED
  2026-08-11. The crash was `bigMedian` of an EMPTY half
  (`sorted[-1].add`), reachable from a fully-ground single inexact
  datum too (`Quartiles(2.5)` threw). Two fixes: `bigMedian([])` now
  returns NaN (matching `median([])`'s arithmetic), and both
  `Quartiles` and `InterquartileRange` stay INERT on symbolic data
  (a NaN LITERAL still takes the §3.C absence path). With inertness
  in place `Quartiles` also gained its decline-only `canEnumerate`.
  Pinned in `eager-collection-enumerability.test.ts`.
- ~~`ListFrom(xs)` over a VALUELESS collection-typed symbol wraps the
  symbol as a scalar~~ — CLOSED 2026-08-11, USER-RULED: inert. The
  `*From` scalar branch now treats a collection-TYPED operand that is
  not a collection right now (valueless symbol, unevaluated eager
  producer — `ListFrom(Divisors(n))` was also scalar-wrapped) as
  UNRESOLVED and stays inert; genuine scalars still contribute
  themselves (`ListFrom(5)` → `[5]`).
  `canEnumerateCollectionOperands` mirrors the guard, so the facet
  answers `false` without evaluating. `Dot` also adopted
  `canEnumerate` in this pass, fixing a latent wrong-`false` facet on
  matrix·matrix (result typed `value`, misread by the type
  fallthrough; unreachable through wrappers, which reject `value`
  operands, but wrong at the API surface).
- **An eager IMPURE collection source is evaluated several times**
  (pre-existing, measured 2026-08-09 during the above): counting
  handler invocations over a 5-element source,
  `Map(f, RandomShuffle(xs))` evaluates the shuffle **8** times,
  `Filter(RandomShuffle(xs), p)` 5, `Any(…)` 2 — the
  materialize-then-iterate path in `each()` re-evaluates a source that
  has no collection handlers, once per facet query. Results stay
  correct; the number of DRAWS consumed does not, so a seeded program
  is not reproducible across these shapes. Needs the evaluated form to
  be computed once and threaded through the facets.
- **`FlatMap` has no `count` facet**, so `Length(FlatMap(…))` is inert
  even when the result is provably finite (a count requires applying
  the callback per element — needs a design, not a one-liner).
- **Nested `Map`/`Filter` canonicalization is superlinear in depth**
  (measured 2026-08-09: 10→20 levels ≈ 2.65× on both the current and
  the pre-conversion path — pre-existing, cause unidentified).
- **Bounded numeric element types** (`integer<1..10>`) and value-literal
  types still decline the stamp admission gate (`admissibleElementType`)
  — a one-line widening if ever wanted.

### Broadcast semantics residue (element-wise lowering landed 2026-07-26)

The element-wise compiled lowering shipped, and with it the two interpreter
rulings it depended on (record in `CHANGELOG.md`). The ordering relations and
the logical connectives now broadcast on the JavaScript target through
`_SYS.bcast`; broadcast operands are evaluated ONCE; and a length mismatch is
`incompatible-dimensions` across the eager zip, the arithmetic broadcast and
the lazy form, instead of a silent zip-to-shortest. (`PointList` opts out by
design — it zips components rather than broadcasting an operator, and its
shortest-zip is a consumer contract.) The full policy — strict for LIFTED
operators, shortest for explicit PAIRING constructors (`Zip`, variadic `Map`,
`PointList`) — is recorded in `docs/BROADCAST-MODEL.md`. Genuinely remaining:

- **An operand whose length is not yet KNOWN is not compared.** The check reads
  `count`, so a participant reporting `undefined` (a symbolic-length `Range`
  before its bound resolves, an operand held raw by a lazy operator) is skipped
  and the broadcast proceeds. It is the lazy `Map` that then zips those, and
  the variadic `Map` uses shortest-input semantics — so a mismatch that only
  becomes visible after the length resolves can still truncate silently.
  Diagnosing it means a strict lazy zipper that reports
  `incompatible-dimensions` when one participant ends before another, which is
  a change to `Map` iteration, not to this check. (An *infinite* operand is
  already caught: `count` is `Infinity`, which mismatches any finite length.)
- **A compiled ordering cannot tell an ERROR operand from a numeric NaN.** Both
  are NaN at the ABI, and `NaN < 3` is `false` — which is right for a numeric
  NaN (IEEE) but wrong for an error, where the interpreter stays an error. The
  connectives are guarded (`guardConnectiveAbsence`), because there JS coercion
  produced a plainly wrong truth value (`!NaN` → `true`); the orderings would
  need a distinct absence sentinel carried through nested broadcasts to do
  better.

- **Python still fails closed** for comparisons/connectives over a
  possibly-collection operand — it has no generic scalar-closure broadcaster.
  Tracked under *Broadcast typing residue* below; `_ce_bcast` now matches the
  mismatch ruling for the heads it does cover (`ElementMax`/`ElementMin`/
  `Clamp`).

### Compile-target coverage (ledger opened 2026-07-30)

Until now, "which heads have no lowering on which target" was tracked _nowhere
in this repo_ — it lived only in the consumer's census markdown, which meant
every gap was rediscovered from the outside. This is the ledger. It is **sized
by an external corpus** (Tycho's 684-document Desmos corpus, 3 096 compiled fn
members, CE 0.99.0) because that is the only population data we have; the counts
are `members / states` of that corpus and are a proxy for importance, not a
target.

A compile decline is not a slow path — the consumer's JS wrapper installs a
`() => NaN` stub, so a declining row **draws nothing**. Treat these as
correctness gaps with a performance-shaped symptom.

- **Callback parameter complexness is not analyzed (pre-existing, surfaced
  by the 2026-08-03 built-in-callback review).** A callback body — inline
  literal or emitted wrapper alike — compiles its parameter as
  statically real, so `Map(Abs, [3+4i])` (and `x ↦ Abs(x)` over the same
  list) emits `Math.abs`, receives the `{re, im}` object at runtime, and
  silently returns `NaN` instead of 5 or failing closed. Verified
  identical for inline literals and named/eta-expanded callbacks, so no
  regression — but it is a silent-wrong-value class, unlike the ledger's
  declining rows. The fix is a complexness projection from the
  collection's element type into the callback's parameter (or a
  fail-closed gate when the element type is provably complex); it belongs
  with the complexness-analysis machinery (items 147/148), not with CSE.

- **Single-uppercase-letter operator names (`D`, `N`) in callback position
  emit `_.D` (broken artifact) — deliberate carve-out, 2026-08-03.** The
  fail-closed refusal for un-expandable built-in names exempts
  `/^[A-Z]$/` because `devolveUnappliedOperator` reads an un-applied
  single-uppercase-letter symbol as a caller variable by convention
  (`∫ D x² dx` parses `D` as a variable; 9 integrate/derivative tests pin
  it). Consequence: `Map(D, xs)` keeps the old runtime-throw behavior. A
  position-aware refusal (callback operand positions only) would close it
  but the JS target has ~9 separate callback splice sites and no
  chokepoint — revisit only with a witness.

**JavaScript band** (230 members / 81 states fail). Per the consumer's
per-bucket provenance rules, **82 members / 25 states are our target gaps**; the
other 148/61 are their own unexpanded user-function heads, unparsed LaTeX, and
document-defined function heads. (Their first pass called the whole remainder
ours — 202/69 — and they corrected it in review. Use 82/25.)

- **`D` / `Derivative` (18 states / 50 members) — the largest single bucket, and
  we are closing it even though they attribute it to themselves.** They classify
  it as their `lowerDerivatives` pre-pass not firing, which is fair, but the
  engine-side gap is the root cause: a derivative declines on every target
  though `.evaluate()` yields a compilable closed form (`D(x^2,x).evaluate()` →
  `2x`). Lowering it here retires the pre-pass for _every_ consumer instead of
  each writing its own. _In progress 2026-07-30._
- **Multi-clause user functions** (feature-parity note, 2026-08-02, no corpus
  sizing yet): the §8 guard chain compiles on the **JavaScript target only**.
  The interval, GLSL/WGSL and Python targets decline the whole function (fail
  closed, interpreted fallback). Interval needs interval-aware guards; the
  shader targets need a monomorphized (per-call-site arity) lowering since
  they have no variadic dispatch.

- **Generic user functions decline compilation whole-fn** (feature-parity
  note, 2026-08-04 — the generic-function-literals milestone made them
  reachable; no corpus sizing yet). A generic body
  (`function f<T>(x: T) -> T { … }`, or a literal assigned to a `forall`
  declaration) takes the standard decline in `ensureUserFunctionEmitted`
  (G3, `docs/plans/2026-08-04-generic-function-literals-design.md` §2.7):
  a polytype has no ground parameter type to read (`userFunctionParamType`
  returns `undefined`, `userFunctionParamsAreScalar` answers `false`), so
  an emitted call boundary would lose both its coercion wrap and its
  broadcast wrap — measured pre-guard, `gd([1,2,3])` under
  `forall T: number. (T) -> T` compiled to `_fn_gd([1, 2, 3])` and ran to
  `null` where the interpreter broadcasts `[2,4,6]`: the silent-wrong-value
  class, hence the whole-fn decline (interpreted fallback is sound and
  pinned). The principled lift is per-call-site **monomorphization**
  (instantiate the clause, emit one specialization per ground argument
  shape); a cheaper interim — sound for scalar-only use — would be to emit
  with the quantified parameter read **at its bound** and a broadcast wrap
  derived the way `paramsAreScalar` reads bounds at evaluation.

**GLSL/WGSL band** (204 members / 90 states compile on JS but not GPU — the
GPU→CPU demotion class). Buckets triaged below.

#### Triage (2026-07-30, one probe per bucket against a bare engine)

Every bucket the consumer attributes to us, classified. This is the pass that
must precede any implementation session — it moved four buckets out of "work"
entirely (8 members / 5 states of the JS band, plus a GPU bucket) and split the
rest by what they actually need.

**A. Design question first — a missing _convention_, not missing code.** These
are the ones worth a session, and each wants a design pass before an implementer
touches it.

| bucket                                                                      | target   |                         pop | the question                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | -------- | --------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Integrate`                                                                 | glsl     |                       22 st | Quadrature inside a shader — which rule, what iteration budget, what happens on non-convergence. Large; do not start without deciding the budget question. **The remaining design-first entry** (former ranks 1 — `PointList`/`PointZ` and `At` — landed 2026-07-31/08-01, residuals below).                                             |

**A-2 residual — `At` on GPU (landed 2026-08-01; design + rulings in
`docs/plans/2026-08-01-at-gpu-compile-design.md`).** Scalar-index and
literal-gather tiers over statically-sized numeric bases shipped (any
N ≥ 2 via per-N `_gpu_atN` helpers; the `p_0[i]` census witness shape).
Remaining, per the D4 disposition table — do not re-derive:

- **Point-list bases: blocked on §3.F** (the node types `missing | tuple`
  and the object-domain-absence gate intercepts before any GPU table
  entry). Unblocking needs its own ruling: a per-operator absence
  projection (Missing point → NaN-component vector), or in-range type
  narrowing. Filed with the consumer item.
- Demand-gated: static-count dynamic gather (near-zero cost to flip —
  the same helpers in a constructor; witness count requested from the
  consumer), gather K > 4 (width ceiling), gather K 0/1 (the pinned
  1-element-list contract has no shader shape), dictionary/string-key/
  multi-index forms.
- Permanent (not TODOs): runtime-valued boolean masks (result length is
  not static — no shader value shape), unknown-length bases/index lists.
- Latent observation from the round (own look, out of scope):
  `BaseCompiler.isComplexValued` answers `true` for a literal `List`
  containing one complex element, skewing `aggregateComponentCount` for
  other callers.
- No retirement of the 26-state count without the consumer re-measure.

**A-1 residual — `PointList`/`PointZ` (main design pass landed 2026-07-31;
rulings + design in `docs/plans/2026-07-31-pointlist-compile-design.md`).**
JS construction (shortest-zip lowering, `iterationBudget` truncation cap),
JS/GPU coordinate projection, and the `?? NaN` missing-coordinate fix all
landed; GPU *construction* stays fail-closed **by ruling** (no runtime-length
GPU expression values — the point-list dimension is the consumer's instancing
axis). Remaining, all demand-gated:

- Non-`isListType` components (tuple/set/union-with-collection) still decline
  on JS — lowering is deliberately narrower than typing (no per-point
  representation for such a slot).
- The **type handler's** `isListType` (`collections.ts`) classifies a bare
  `tuple`-typed or all-collection-union component as a list — so
  `PointList(k, P)` with `P: tuple` *types* `list<tuple>` while `evaluate`
  (value-level `isTuple`) answers a single point. The compile predicates were
  hardened against this (staged review 2026-07-31); aligning the type handler
  is interpreter-visible and wants its own pass. Same-family holes, same
  pass: `hasPointElementType` (`collections.ts` ~684) accepts only
  `{kind:'tuple'}` nodes, not the bare `'tuple'` string; and projecting an
  **empty** point list diverges (compiled `[]`, interpreter absence — the
  evaluated empty transpose types `list<never>`, so the point-ness is
  unrecoverable; pinned as a known parity edge in
  `pointlist-compile-zip.test.ts`).
- A GPU projection **composed under arithmetic** (`PointX(…) * 2`) still
  declines: the projection's type (`list<number>`, no static dimension) fails
  the operand-shape gates even though the emission is a legal `vecN`. Fix =
  a dimensioned projection type — an interpreter-visible type-handler change,
  wants its own measured pass.
- ~~CSE gate G1b still excludes PointList subtrees~~ — **LANDED 2026-08-01**:
  built-in `compile` handlers are exempt (system-scope binding identity;
  design amended in `2026-07-28-compile-cse-design.md` §5.2). Remaining CSE
  residue for binder bodies (`Integrate` integrands) is the §11 emission
  wiring, no longer the gate.
- ~~CSE for user-function applications and named callbacks~~ — **LANDED in
  full 2026-08-03 (unreleased; definition bodies landed 2026-08-01 as item
  120, shipped 0.100.0).** Both compiler harvest routes now admit pure
  user-function applications behind the transitive callee-body validation
  (`admitPureUserFunctions`, design doc §5.2): a repeated pure call at the
  ROOT of a compiled expression binds once, and a recursive body's repeated
  self-call compiles to linear instead of exponential calls. A NAMED
  callback resolving to a validated pure user-function literal no longer
  blocks eligibility — two identical `Map(f, xs)` with a pure user `f`
  merge; a drawing `f` stays un-merged (draw streams and call counts
  preserved). The measured pass that gated the root flip: admission is
  inert on user-fn-free trees; per-callee validation ≈ 0.02 ms, memoized
  per name per harvest; staleness is handled by per-level re-derivation
  against current bindings at harvest time (post-compile reassignment is
  the compile-wide artifact-snapshot policy). Callbacks naming BUILT-IN
  operators (`Map(Sin, xs)`, `CountIf(xs, IsPrime)`) landed the same day:
  such a name is eta-expanded into a shared emitted wrapper — which also
  fixed an emission bug where it fell through to a free-variable read and
  the artifact threw `_f is not a function` at run time — and is then
  admitted when the operator is pure, is the engine's own definition by
  system-scope identity, and has a fixed arity. Drawing (`Random`),
  variadic/optional-tail (`Add`, `Ln`), shadowed and caller-overridden
  names stay opaque. See `2026-07-28-compile-cse-design.md` §5.2/§11.
- No corpus re-measure yet: how much of the 11 st / 36 mem + 2 st actually
  closed is the consumer's count to re-run — do not mark this bucket resolved
  on our numbers.

**A′. RULED 2026-07-30 — retire the refusal, fold to `NaN`. DONE (JS target).**
The `realOnly` constant-fold refusal was applied at exactly two sites
(`Sqrt(-N)` 2/2, `Tuple` w/ a complex component 1/1). It was a **deliberate**
policy, pinned by `compile-complex.test.ts` § _"fails closed on Sqrt of a
negative real constant"_, whose comment reads: _"a real target refuses to fold
it to a literal `NaN`"_. But it is enforced only in `javascript-target.ts` (the
`Power`/`Root` constant paths, ~1675/1757, and the `Tuple` component check
~4263). Probed — every sibling case in the same mathematical situation compiles
and yields `NaN` at run time:

| expression                  | realOnly       | result                                                              |
| --------------------------- | -------------- | ------------------------------------------------------------------- |
| `Sqrt(-2)` literal          | ✗ **declines** | —                                                                   |
| `Ln(-2)` literal            | ✓ compiles     | `Math.log(-2)` → `NaN`                                              |
| `Arcsin(2)` literal         | ✓ compiles     | `Math.asin(2)` → `NaN`                                              |
| `Sqrt(a)`, `a := -2`        | ✓ compiles     | `Math.sqrt((-2))` → `NaN`                                           |
| `Sqrt(x)`, `run({x:-2})`    | ✓ compiles     | `NaN`                                                               |
| `Tuple(1, i)` literal       | ✗ **declines** | —                                                                   |
| `Tuple(1, Sqrt(x))`, `x=-4` | ✓ compiles     | `[1, NaN]`                                                          |
| bare `i`, `1 + i`           | ✓ compiles     | `{re,im}` — complex literal is fine _unless_ it is inside a `Tuple` |

The policy was unreachable as a guarantee: the variable case cannot be caught,
so refusing only the provable-constant case bought no safety and cost
consistency. D6 fail-closed exists to prevent _silently wrong output_ (the GLSL
`.map` defect — garbage wearing `success: true`); `NaN` is not garbage, it is
the correct, self-describing answer, and it is already what every sibling head
returns. **Ruling: `realOnly` → `NaN`; without `realOnly` → the complex value**
(`Sqrt(-2)` declined even in complex mode, which was plainly wrong given `1 + i`
compiles). Three pinned tests rewritten, none deleted. Four decline sites, not
three — `Sqrt` (~1913) is the one `Sqrt(-2)` and `Power(-2, 1/2)` actually
reach, since both canonicalize to `Sqrt`.

**The refinement, and why it is not a half-measure:** only `Sqrt` folds to a
complex literal; `Power`/`Root` that stay non-real fold to `NaN`.
`isComplexValued` is a **type** query and it decides whether the _enclosing_
expression emits real or complex arithmetic. `Sqrt(-5).type` is `complex`, so a
parent routes through `_SYS.cadd`/`cmul` and `1 + √-5` gives
`{re: 1, im: 2.236}`. But `Power(-2, 0.3).type` and `Root(-4, 4).type` are
`finite_number` — the type handlers do not track a negative base under a
fractional exponent — so folding those to `({re, im})` made `1 + (-2)^{0.3}`
compile to `1 + ({re…})` and **run to the string `"1[object Object]"`**. That is
silently-wrong output, which is what D6 is actually for. `NaN` there matches
what the same expression already yields once the base is a variable. If we want
those complex too, the fix belongs in the `Power`/`Root` **type handlers**, not
the emitter — an interpreter-visible change, not attempted.

**Two follow-ups this created:**

- **JS and GPU now diverge** — `gpu-target.ts` (~1576, ~1638) still declines the
  analogous cases. Consistency across targets is exactly the kind of pushback
  that stays valid, so this should land with the GPU non-finite work below.
- **A pre-existing bug is slightly widened**: a complex literal under a
  _non-canonical_ parent already miscompiled on main
  (`ce.box(['Add', 1, ['Root', -4, 2]], {canonical: false})` →
  `"1[object Object]"`), because D12-A folds while the unbound parent's
  `isComplexValued` is `false`. Canonical and structural routes are correct. Not
  caused here and not fixed here; recorded so it is not rediscovered as new.

**A″. Standing sweep — audit the other compile-time refusals for the same
inconsistency.** The `realOnly` finding (A′) was not a one-off, it was an
instance of a class: _a deliberate refusal enforced at some sites but not at the
sibling sites_. A rationale comment and a passing test establish **intent**;
neither establishes **consistency**. The check is cheap — for each refusal,
probe the same mathematical situation reached a different way (via a variable,
an assigned symbol, a different head in the same family, a different target) and
see whether it is refused there too.

Known candidates, all currently defended as "documented and deliberate":

- **Python's arithmetic-infix D6 guard** (`base-compiler.ts` ~869) still fails
  `Negate([1,2,3])` closed, even though the comprehension fan-out added in the
  same round makes `[-_tv1 for _tv1 in L]` expressible. The guard may simply
  have outlived its reason.
- **`Sin(Tuple(1,2))` broadcasts when compiled but stays inert in the
  interpreter** (`isBroadcastParticipant` excludes tuples). This one is a
  _consistency_ defect — compiled and interpreted disagree — so it needs
  resolving in one direction, not defending.
- **`Sin(L)` for an unknown-length `list<number>` on GPU emits `sin(L)`**, valid
  only if the caller happens to bind `L` to a `vecN` uniform. We assert a shape
  we cannot see.
- **An all-scalar `PointList(u, v)` with an `unknown`-typed component bound to
  a list at run time compiles as a plain point** and produces a malformed
  value (filed 2026-07-31 from the PointList design pass). The zip lowering
  guards its opaque slots at run time (`Array.isArray → NaN`); the all-scalar
  path has no such guard because `unknown`-as-scalar is load-bearing for free
  plot variables — same static-type-assertion class as `Sin(L)` above.
- The `Multiply` ≥2-arrayish carve-out and the complex-element deferral —
  preserved verbatim through the broadcast rework, never re-examined.
- ~~**`Sqrt(a)` with `a := -2` folds to a real `NaN`, not the complex value**~~
  — **RESOLVED 2026-07-31** by the Sqrt/Ln/Log dispatch rework: a PROVABLY
  negative operand (literal or assigned) now routes through the complex
  helper on both JS (`_SYS.csqrt` → `{re: 0, im: 1.414…}`) and GPU
  (`_gpu_csqrt`), matching the interpreter; a free real symbol of unknown
  sign keeps the real kernel (pinned in `compile-complex-result.test.ts`).
  The dispatch predicate lives in the `isComplexValued` Sqrt/Ln/Log
  carve-out (`base-compiler.ts`) and is mirrored by the three head emitters
  in each target, so parent and child always agree on the value shape.

**A‴. GPU invalid-source escapes — mostly closed 2026-07-30, three left.** The
broadcast rework (item 112) plus a follow-up round closed the unary fan-out and
the generic function-codegen/string-helper paths, deriving the decision from
emitted source, the languages' own builtin tables, and the existing shape
helpers — `gpuIsComponentwise` / `gpuOperandShape` / `gpuCheckOperandShapes`,
with per-language `GLSL_SHAPE_RULES` / `WGSL_SHAPE_RULES` defaulting to their
**intersection** so a new subclass fails closed. Two subtleties worth keeping:
`_gpu_*` helpers are **not** all scalar-only (`_gpu_color_mix(vec3,vec3,float)`,
`_gpu_apca`, `_gpu_cdiv`), so the gate reads the declaration the target itself
emits rather than assuming; and a lowering may legitimately **destructure** a
collection into scalars (`Median([1,5,3,2,4])` → `_gpu_median_5(…)`),
distinguished by argument count vs operand count.

A separate wrong-value defect in the same file was fixed alongside:
**`Max`/`Min` over a single collection returned the operand verbatim** —
`Max([1,2,3])` → `vec3(1.0, 2.0, 3.0)` where the interpreter and JS both reduce
to `3`. It now folds pairwise to a scalar (`(max(max(1.0, 2.0), 3.0))`),
destructuring an aggregate constructor or swizzling a static `vecN`, and failing
closed on a matrix or runtime-length array. `ElementMax`/`ElementMin` are
genuinely componentwise and correctly untouched. Note for maintainers: **the
reduced emission is parenthesized on purpose** — that is what makes
`gpuTopLevelCall` return `undefined` so the shape gate steps aside for a head
that consumes a collection deliberately. Dropping the parens fails _closed_, not
open.

Reduction-family heads that still decline on GPU while JS and the interpreter
compute a value — each needs its own lowering, all fail closed: `Sum([1,2,3])`,
`Product([1,2,3])`, `LCM`, `GCD`, `Length`. ~~Also `Max([])`/`Min([])` decline
in the empty-constructor guard where JS gives `NaN`~~ — already answered:
they emit the target NaN (`(_gpu_nan())` / WGSL bitcast) on both GPU
languages, pinned in `compile-gpu-extremum.test.ts` § "GPU Max/Min over an
EMPTY collection" (verified 2026-08-02; this row was stale).

Still open, in rough priority:

- **The infix `target.operators` path is unhooked** — the hottest shared path,
  deliberately not gated. `Matrix` and list-_typed symbols_ report
  `isCollection === false` and so route through it:
  `Add(P: vector<real^3>, Q: vector<real^2>)` still emits `P + Q`, and WGSL
  `Add(Matrix, 2)` emits `2.0 + mat2x2f(…)` (invalid WGSL, valid GLSL). Gating
  it is a perf-sensitive change and wants its own scoped pass.
- **Complex-element collections** — `gpuOperandShape` reads a list of complex
  elements as `scalar` (via `isComplexValued`'s operand fallback), so the
  generic gate is inert for them. The fan-out path declines them explicitly; the
  generic path needs a separate complex-element rule.
- **Argument POSITION within a builtin signature is not modelled** — GLSL
  `step(float, genType)` takes its scalar first, `mod(genType, float)` last, so
  a wrong-position scalar (`mod(float, vec3)`) is admitted. Deliberate
  conservatism; tightening needs per-builtin arity/position tables.

**`.N()` loses the odd-denominator real-root convention on large-term rational
exponents** (found 2026-07-30 by a 649-pair sweep). For a negative base and an
exact rational exponent `p/q` in lowest terms with **odd** `q`, the real
principal root exists — CE applies this correctly at `(-8)^(2/3) → 4` and
`Root(-8, 3) → -2`. But `.N()` numericizes the exponent to a double *before*
applying the convention and recovers `p/q` from that double, so an exponent
whose reconstruction has an even denominator silently takes the complex branch:

```
(-2)^(100/3)   exact:  q = 3 is odd, p = 100 is even  ⇒  +2^(100/3) ≈ 1.0823e10  (REAL)
               .N():   -5411319704.84 - 9372680664.78i          (same magnitude, rotated 240°)
```

**The type handler is on the correct side here** — it reads the exact rational
and types the node real. It is `.N()` that is wrong, and the disagreement is a
floating-point artifact, not two defensible conventions. The compile path
sidesteps it by declining whenever the exact and float readings disagree, so
nothing emits a wrong value.

**FIXED 2026-08-03 (machine lane).** By fix time the bignum lane was already
correct (an earlier 4-ulp reconstruction round); the MACHINE lane was still
wrong in three directions — sign flips (`(-2)^(100/3)` → `-1.08e10`, p even),
real→complex (`(-2)^(7/3)`), and even-q wrongly REAL (`(-2)^(7/6)`). Root
cause deeper than this entry's account: `realPowerBranchTerms`
(`arithmetic-power.ts:80`) already implements exact-first, but the evaluate
handler receives operands ALREADY numericized (exact rational gone on both
lanes), and a machine engine numericizes `100/3` at the ambient 15-digit
`BigDecimal.precision` — ~1.5e5 ulp from the nearest double, far outside the
4-ulp reconstruction tolerance. Fix: the reconstruction tolerance now scales
to one unit in the last kept decimal digit (`precision` param, ≥17 clamps to
the old 4-ulp — bignum lane bit-identical), threaded through the type
handler (`negativeBaseIsComplexBranch`) and the compile fold
(`negativeBaseRealPow`) so all three stay aligned. 288-cell sweep vs an
independent reference: 53 mismatches → 0; compile emissions across 972
probes byte-identical; zero snapshot churn. Tests in
`power-negative-base-branch.test.ts` (unit reconstruction + lane parity).

**Review round on the fix (2026-08-03) — the reconstruction fallback itself
was unsound for IRRATIONAL exponents, and always had been.** Every
irrational's CF convergents eventually fall within any fixed tolerance
(error ~1/q² beats 4 ulp once q ≳ 3e7), so `(-2)^{√2}` and `(-2)^{1/π}`
were wrong-REAL on BOTH lanes, `(-2)^e` on bignum, `(-2)^π` on machine —
and the precision-scaled tolerance had made the lanes DISAGREE (different
convergent per lane). Fixed with a coincidence-budget criterion (density
of reduced rationals with denominator ≤ q is (6/π²)q² per unit length;
require expected count in the admission window ≤ 1e-4 — measured ~7
decades of separation between true rationals, worst 2.2e-11, and
irrational convergents, best 1.1e-1). All lanes now agree on every probe;
zero snapshot churn; `tol` digits floored at 15 (the `{precision: 3}`
constructor bypasses setPrecision's MACHINE_PRECISION floor — pre-existing
asymmetry, decision made immune rather than constructor changed). A
`terms === undefined` result now PROVES the complex branch in
`negativeBaseIsComplexBranch` once the exponent has a finite value
(without this, `(-2)^{0.3333333333}` re-typed `finite_number` and the
compiled≡`.N()` sweep broke).

**Adversarial round on the criterion (2026-08-03, second pass)** — an
Opus refuter + Codex, both with live repros. Closed the same day:
(a) the tolerance read `ce.precision`, but the rounding is governed by the
PROCESS-GLOBAL `BigDecimal.precision` — a default engine created before a
machine engine numericized at the global 15 while its tolerance assumed
17+, resurrecting the original `(-2)^(100/3)`-complex bug by
engine-creation order; `realPowerBranchTerms` now reads the global (the
`precision` parameter is REMOVED — keeping it was the footgun), which also
restores same-moment lane agreement by construction. (b) the faithfulness
gate never actually bounded `rationalize`'s output by the tolerance it
charged the budget at (the `max(1e-12, tol)` floor dominated for
|value| < 100; one accepted reconstruction sat 21× outside its own tol
with a true expected-coincidence count of 1.2); the gate now measures at
the same width the budget is charged for — a strictly monotone tightening
(0 newly admitted, 104 near-cap coincidences dropped at 17 digits,
measured residual snap rate ~5e-5 on 2e6 random doubles). Docstring and
test prose rewritten to state the RATE guarantee honestly (q cap
≈ 3e5·|v|^{-1/2}; ≤ ~1e-4 of arbitrary doubles can still snap by design).

~~Residual the adversarial round PROVED unfixable at this layer~~ —
**RESOLVED by the exact-provenance design, USER-APPROVED and LANDED
2026-08-03.** Evaluate handlers now receive `expression` in their options
(the canonical node; `EvaluateHandlerOptions` in `types-definitions.ts`,
threaded at both driver call sites in `boxed-function.ts`); `Power`
forwards `expression.op2` as `rawExponent` into `pow()`, which prefers the
exact rational — resolved through a symbol's binding when op2 is a symbol
with a bound number literal — over the float reconstruction. All three
legs now agree for exact rationals of ANY term size
(`(-2)^{1000003/1000001}` real everywhere). A second adversarial round on
the implementation then caught and fixed: parity decided on the narrowed
`Number()` terms corrupted denominators > 2^53 (odd rounded to even —
parity is now decided on the BIGINTS); the integer-ness test read the
rounded double (`6000001/2000000` at precision 3 numericizes to exactly 3)
instead of the raw reduced denominator (fixed; note the two paths coincide
NUMERICALLY there — `cos(nπ) = (−1)^n` reproduces the integer power — so
the observable is the TYPE, pinned); the `expression.ops` JSDoc overclaimed
positional correspondence (holdMap flattens associative operators, unwraps
`ReleaseHold`, drops operands — caveats now documented, plus the `lazy`
exception) and the parallel handler-option type shapes in
`types-expression.ts`/`boxed-operator-definition.ts` were unified onto the
alias. Provenance residuals, PINNED as known-residual in
`power-negative-base-branch.test.ts` (not silent): a lambda parameter,
`Sum` body, `When`, or structural `Rational` exponent has no folded-literal
provenance and keeps the reconstruction (complex past the cap) — extending
those routes means exact-evaluating arbitrary op2 inside the hottest
operator, deliberately not done.

Residuals, recorded not fixed: (a) `_bignumComponent`'s `radical === 1` fast
path (`exact-numeric-value.ts:284`) still numericizes an exact rational at
ambient precision instead of nearest-double — the sibling radical branch
documents and floors exactly this defect; a candidate floor fix was BUILT,
MEASURED (28 snapshot failures across 5 suites — machine `.N()` display
widths change), and REVERTED as broad churn needing its own gated pass.
(b) The branch is still decided by float reconstruction at `.N()` time — an
exponent with terms too large to recover from a 15-digit double
(denominator ≳ 3·10⁵ under the coincidence bound) takes the complex
branch; curing that means letting the exact exponent survive
numericization (evaluate-handler signature change, own design). Worth a
ruling only if a consumer relies on very-large-denominator float
exponents. (c) `Pi.isInteger` is `undefined` (not `false`), so `(-2)^π`
still types `finite_number` and compiles to a real `Math.pow` (→ `null`)
while `.N()` is complex — a hedged compiled/interpreted disagreement in
the constant's type handler, orthogonal to the branch fix.

**A negative VARIABLE base has no sign-corrected `Power` lowering.** With
`a := -2`, `a^(2/3)` interprets to `1.5874` but compiles to `NaN`
(`Math.pow(-2, 0.666…)`). The odd-denominator correction exists only in the
constant-fold path and in `Root` (which is why `\sqrt[3]{a}` works). Closing it
means emitting `sign(x)^p · |x|^(p/q)` for every `Power(realvar, p/q)` — a
broader emission change with real snapshot risk.

**Follow-ups from the 2026-07-30 review round** (each found while fixing
something else; none is a regression):

- ~~**A type/value disagreement at the source:** `Arcosh(a)` with `a := -2`
  typed `finite_real` while `.N()` is complex.~~ — **RESOLVED as of
  2026-07-31**: probes now give `finite_complex` (the assumptions/value
  predicates reach the `boundedInverseTrigType` complex arm), consistent with
  `.N()`.
- **`Power`/`Root` still yield `NaN` where the interpreter returns a complex
  value.** This is the ratified `finite_number` policy, not a defect, but it is
  the same user-visible surprise the `realOnly` retirement removed for `Sqrt`.
  Resolvable only by making those type handlers track the negative-base /
  fractional-exponent case — which would then let the emitter fold them complex.
- **`resultIsComplexValued` is duplicated** in `javascript-target.ts` and
  `gpu-target.ts` (~12 identical lines) because neither fixer could touch
  `base-compiler.ts`. `python-target.ts` very likely has the same `Sqrt`/`Ln`/
  `Log` split. Consolidate into `BaseCompiler` when fixing Python.
- ~~**Evaluating a derivative can shadow the `D` operator for the engine's
  lifetime**~~ — **STALE, probed 2026-08-03: no longer reproduces.** Four
  routes probed clean on 0.100.2 (box-route `D(D·x², x).evaluate()`,
  parse-route `\frac{d}{dx}(D x^2)`, numeric-use inference `D + 1`, and an
  explicit `assign('D', 5)`): `D(x², x)` still evaluates to `2x` and
  compiles afterward in every case. Closed by the 2026-07-27
  bare-assign-over-a-builtin scope-identity fix and/or the binder rounds;
  struck without a code change.
- **GPU: a builtin whose scalar slot is MANDATORY is unchecked when no scalar is
  present.** `Refract(V3, W3, X3)` emits `refract(vec3, vec3, vec3)`, which no
  driver accepts — the positional gate only runs when a scalar IS present.
  Closing it means the slot sets become obligations, not just permissions.
- **GPU: residual fail-open in the variadic fold path** — `ElementMax(2, v, w)`
  over declared `vector<3>` symbols folds to `max(max(2.0, v), w)`, where no
  argument is recognizable as a vector from source, so the tree walk steps
  aside. Needs the emitter to hand the gate a fold-aware position mapping.
- **Python's `Add`/`Multiply`/`Divide` lowerings are precedence-blind**
  (`args.map(compile).join(' + ')`), so any path that declines the infix route —
  chiefly complex operands — can emit `z + 1 * 2` for `Multiply(Add(z,1), 2)`.

**Closed in the 2026-07-31 round** (the priority list from the 2026-07-30
handoff, all verified by probe + full suite, zero snapshot churn):

- **The interpreter fallback returned `NaN` for any expression whose
  `evaluate()` stays symbolic** (the exactness contract: `Σ 2^{-i}` declines,
  falls back, and `run({})` gave `NaN` while `.N()` gives `1`).
  `buildInterpreterFallback` (`base-compiler.ts`) now numericizes at the
  leaves (`e.N().re`) in both the expression and lambda branches — this is
  what makes every compile decline actually pay off. Regression tests in
  `compile-fallback.test.ts`.
- **An interval-js decline produced no `run` at all**: the target's primary
  failure class returns `success: false` WITHOUT throwing, so the free
  `compile()`'s catch-based fallback never saw it. `compile-expression.ts`
  now passes `fallback` through to the registered target, which normalizes
  both failure shapes (`buildIntervalFallback` → degenerate `{lo, hi}`
  interval run). With `fallback: false` the raw no-`run` decline shape still
  surfaces (pinned).
- **Sqrt/Ln/Log type claims** (the P2 ruling): an unknown-sign real operand
  now types `finite_complex` (Sqrt) / `complex` (Ln, Log with a valid base);
  a provably-positive operand keeps `finite_real`; a `number`-typed operand
  (NaN-capable) keeps `number`. Compile emission is UNCHANGED for a free
  real symbol on every target (real kernels, pinned) via the
  `isComplexValued` Sqrt/Ln/Log carve-out + operand-negativity dispatch in
  the JS and GPU emitters; a provably negative operand (literal or assigned)
  routes complex on both. `Log(2, -2)` still `number`/`NaN` everywhere — the
  interpreter gap stands, recorded below.
- **`Add`/`Multiply`/`Divide` over a type-only-provable non-finite operand**:
  `1 + Ln(0)` typed `integer` (lattice-sound but missing the provable
  `non_finite_number`), `2·Ln(0)` typed `finite_integer` (unsound). The three
  handlers now treat `type ⊆ non_finite_number` as provably non-finite. Root
  cause NOT fixed (recorded below): `BoxedFunction.isFinite` never consults
  the static type.
- **`Arcsec`/`Arccsc` aligned with the other six bounded heads**: pole value
  `~oo` is a member of `complex` (D10), so `poleType: 'complex'` and the
  unknown-magnitude join is `complex` (was `number`); the compiled complex
  dispatch now treats all eight heads uniformly.
- **GPU colour constructors decline a 4th (alpha) operand** on GLSL and WGSL
  (`assertNoGPUAlpha`, `gpu-target.ts`) instead of silently dropping it; the
  vec3 colour chain is unchanged for 3-operand forms (byte-identical).
- **GPU `Sum`/`Product` decline a non-finite bound** (`assertFiniteGPUBound`)
  instead of emitting `for (int i = 1; i <= _gpu_inf(); i++)`; mirrors the
  JS/interval-js guard and message.
- **Python `Norm(matrix, 2)` lowers to `np.linalg.norm(m, 'fro')`** (CE's
  Frobenius semantics; numpy's ord-2 is spectral — a silent wrong value:
  13.8806 vs 13.9284 on `[[3,4],[5,12]]`). Static rank 1 keeps ord 2;
  unknown rank fails closed (`pyStaticRank`, `python-target.ts`).

New residues recorded by that round:

- ~~**`BoxedFunction.isFinite` is type-blind**~~ — **FIXED 2026-08-02, measured.**
  The getter now consults the static type ONLY on the fallthrough path that
  returned `undefined` (`this.type` is already generation-cached and forced
  by the `isNumber` check at the getter's entry, so the consult is one
  `isSubtype` call, not a new type computation). `Ln(0).isFinite` is `false`.
  Measured: box-microloop canary 0.0196 → 0.0202 ms/iter (within noise),
  full suite +0.9% wall, ZERO snapshot churn. Two deliberate non-changes:
  (a) ~~the three Add/Multiply/Divide site patches are KEPT~~ — **RETIRED
  2026-08-03**: `BoxedSymbol` now decides both predicates from its declared
  type (`isInfinity` type fallback mirroring `BoxedFunction`; `isFinite`
  gains the symmetric `non_finite_number → false` arm beside its existing
  `finite_number → true` one), so `x.isFinite === false` subsumes the
  `type.matches('non_finite_number')` disjuncts at all three sites (Add's
  lives in `arithmetic-add.ts` `addType`, not `library/arithmetic.ts`).
  Retirement was evidence-based, not by inspection: all four disjunct
  evaluations were instrumented to log any operand where the type half
  fired without the getter half, and a full-suite run produced ZERO
  divergences (instrument proven live by reverting the getter). Class
  sweep: BoxedNumber/BoxedSymbol/BoxedFunction all decide; no other class
  can carry the type. Measured: zero churn, canary 4–8% FASTER (three
  fewer `type.matches()` calls per operand). Residual flagged: `isNaN`
  stays `undefined` for type-only non-finite expressions on both classes
  though `non_finite_number` provably excludes NaN — symmetric,
  pre-existing, possible follow-up. (b) ~~an `isInfinity` companion trialled and DROPPED~~ —
  **RULED 2026-08-03 and LANDED**: "a provably non-finite REAL factor is
  implicitly nonzero — proven signs are required only of the finite
  factors." The Multiply tight branch exempts provably non-finite factors
  from the sgn obligation (±∞ ≠ 0 is a theorem; `isReal === true` stays
  required of EVERY factor — structural `isFinite === false` does not imply
  real, viz. ComplexInfinity, so ∞·i keeps the widen); Divide gets the
  mirrored branch (non-finite real numerator over a provably FINITE
  (`isFinite === true`), real, proven-nonzero-sign denominator →
  `non_finite_number`; ∞/∞, ∞/i, x/∞, unknown-finiteness denominators keep
  `number`). The `isInfinity` companion landed with it (type consult on the
  undefined path; the 2026-08-02 `isFinite` fallthrough consult became dead
  and was removed — `isInfinity` is now the type-consult site). Pin
  rewritten deliberately (`non-finite-typing.test.ts` § "implicitly
  nonzero", + negative controls). Measured: zero snapshot churn, canary
  within noise, compiled emissions for `k·Ln(0)` byte-identical on JS/GLSL.
  Ripple (correct, pinned): the companion arms two pre-existing
  canonicalization folds for type-provable infinities — `Ln(0)/π`
  canonicalizes to `Ln(0)` and `2/Ln(0)` to `0` — so the Divide tight
  branch is reachable mainly on the structural route (canonical shapes fold
  first). A review flagged those folds' guards (`x/∞ → 0` with
  unknown-finiteness `x`; `∞/a` accepting `isFinite === undefined`
  denominators) as unsound — REFUTED: that is the documented generic-point
  convention (same family as `x/x → 1`; the `∞/√π` FresnelC comment on the
  fold records the guard choice deliberately), and `x/PositiveInfinity → 0`
  already behaved this way for literal infinities; a `finite/±∞ → finite` type claim remains a possible future
  tightening (noted in the handler). Residue: assumption-derived signs
  (`assume(q > 0)`) leave `isFinite === undefined`, so such denominators
  reach the tight branch only via the fold — existing sign-vs-finiteness
  asymmetry, untouched. Mirror-image residue (deliberately untouched, much wider
  blast radius): `BoxedFunction` has no `finite_number → true` fallback, so
  `Sin(x)` types `finite_number` yet reports `isFinite === undefined`, while
  `BoxedSymbol` DOES have that fallback — the two classes are asymmetric.
- **`Norm(scalar, 2)` on Python now declines** (was a runtime
  `ValueError`) — intentional side effect, flagged.
- **Multi-splice templates × impure operands — 7 sites fixed 2026-07-31,
  audit open.** Any lowering that splices a compiled operand more than once
  (or calls `compile()` twice on the same operand) re-evaluates an impure
  (Random-family) operand at run time. Fixed: JS `Mod`/`Remainder` (IIFE
  temp binding), GPU `Remainder`/`Cot` (both branches — the complex branch's
  early return had bypassed the guard)/`Coth`/`Beta` (hoisted temp via the
  shared `gpuOperandOnce` helper, decline when `!canHoist`), and the
  standalone `WGSLTarget` `Mod` (`wgsl-target.ts`, spliced its divisor 3×) —
  probed REACHABLE via a framed draw (`WithRandomSeed(7, Mod(10, Random()))`
  compiled with three `_gpu_rnd_draw` calls) and fixed the same way in the
  same round. JS `Cot`/`Coth` were already safe via `inlineExpression`
  (which binds compound operands); GPU `Square` is safe (its double-splice
  is gated to symbols/literals, which are pure).

  **Audit COMPLETED 2026-08-02** — all five target files plus the shared
  `base-compiler.ts` templates swept (three independent read passes, every
  candidate classified, every UNSAFE claim confirmed by a draw-count probe
  before fixing). **12 further sites fixed**, every fix purity-gated so pure
  emissions stay byte-identical (pinned; regression tests in
  `random-compile.test.ts` § "multi-splice × impure operand — the 2026-08-02
  audit round"):

  - JS `Equal`/`NotEqual` complex operand (`.re`/`.im` double splice) and
    n-ary chain middle operands (double `compile()`); JS `Range` 3-operand
    form (start/step re-spliced INSIDE the `Array.from` callback — was one
    draw per element at run time).
  - GPU `Round` (both forms), `Root` (odd degree), `Variance` (worst case:
    `Variance(Random(), Random())` emitted 12 draws for the interpreter's
    2), `Argument`/`Conjugate` complex branches (vec2 temps),
    `gpuSelectionMask` chained-relation middles, `ContrastingColor` 3-arg
    (vec3-shaped — impure operands now DECLINE, D6). GPU `Add` complex
    fallback compiled every operand twice, orphaning hoisted statements (an
    orphaned `_tvN = _gpu_rnd_draw(…)` consumed a draw feeding nothing) —
    now pre-tests `isOpaqueComplexOperand` (`constant-folding.ts`) before
    decomposing; `Multiply`/`Subtract` fallbacks probed clean.
  - Shared `base-compiler.ts`: the relational-chain lowering inlined middle
    operands twice on targets WITHOUT `bindExpr` (GPU) — the old comment's
    rationale ("safe… deterministic seed") was stale, `_gpu_rnd_draw`
    advances a runtime counter; and `compileMatchTernary` spliced the Match
    subject once per comparison (twice per range pattern). Both now hoist an
    impure operand via `canHoist`/`hoistStatement` (language-aware decl) or
    decline; stale comments rewritten.
  - Latent-only, no code change: the interval target has NO impure lowering
    at all (no Random entry, closed head table) — its multi-splices are
    unreachable, like Python's. Python `Norm` order splice got the same
    guard comment as the Equal/NotEqual chains (comment-only, per the chain
    precedent).

  The dual-reviewer round on this diff caught and fixed two follow-on
  defects in the fixes themselves: (a) **draw ORDER** — binding only the
  impure middle made its draw execute before an inline impure endpoint
  (`Less(Random(), Random(), 0.9)` computed the wrong boolean); both the
  `bindExpr` and hoist branches of the chain lowering, and
  `gpuSelectionMask`, now bind EVERY impure operand in argument order when
  any needs binding (this also fixed the same order swap in the PRE-EXISTING
  JS `bindExpr` branch). (b) `ContrastingColor`'s bare `?:` (both the 3-arg
  and 1-arg forms) was invalid WGSL source — WGSL now emits `select(…)`
  (operands are pure by the new gate, so eager `select` is sound); GLSL text
  byte-identical.

  Known residuals, recorded not fixed: n-ary `NotEqual(a, R, b)` draws twice
  because canonicalization expands to `And` with two DISTINCT `Random()`
  nodes — interpreter parity, not a splice. (Since 2026-08-15 `And` is a
  short-circuit form — see `library/logic.ts`, `canonicalShortCircuit` — so
  the second node is drawn only when the first pair is not already `False`;
  the JavaScript target's `&&` behaves the same way, so parity holds.) An impure VECTOR-shaped chain
  endpoint alongside an impure middle now declines (was: compiled with the
  wrong draw order) — correct D6, tiny surface reduction. B1 short-circuit
  nuance: RESOLVED by probe (2026-08-02) as "the interpreter EAGERLY draws
  even a short-circuited chain operand (`Less(5, 1, Random())` consumes a
  draw), so the unconditional hoist at index ≥ 2 is exact interpreter
  parity" — SUPERSEDED 2026-08-15: relational chains now short-circuit at the
  first `False` pair (see the `And`/`Or` entry under "Remaining work"), so
  `Less(5, 1, Random())` no longer draws in the interpreter. The chain
  lowering was updated the same day: a bound operand at index ≥ 2 is now
  bound BEHIND the pairs that precede it (JS `(5 < 1) && ((_tv1) => (1 <
  _tv1) && (_tv1 < c))(draw())`, Python likewise), and a shader target — whose
  only binding form is an unconditional hoisted statement — DECLINES an
  impure operand at index ≥ 2 that must be bound (D6). Pinned in
  `random-compile.test.ts` ("short-circuits past a bound draw", "index ≥ 2 …
  DECLINES").
- **`Norm(matrix, "Infinity")` / `Norm(matrix, 1)` on Python: PROBED, faithful**
  (2026-07-31). The interpreter's rank-2 branch computes max row sum / max
  column sum — exactly numpy's matrix `ord=inf` / `ord=1`. The probe also
  showed any OTHER literal matrix order (`3`, `-1`, …) stays symbolic in the
  interpreter while numpy raises or diverges — those now fail closed (D6),
  pinned in `compile-python.test.ts` § "Norm order guards".

**`Equal`/`NotEqual` over collections on Python — RULED and SHIPPED
2026-07-31.** User ruling: scalar, matching the interpreter. Probing showed
the interpreter's actual gate is `ops.filter(isCollection).length < 2`:
**≥2 collection operands → a scalar pairwise-adjacent chain** (now compiled
via the `_ce_eqcoll` helper — shape-guarded `np.all`, length mismatch is
`False`, string elements fall back to `==`, tolerance baked); **≤1
collection operand → element-wise broadcast to a `list<boolean>`**
(`Equal([1,2], 5)` → `["False","False"]`), which **stays fail-closed by a
second ruling (2026-07-31)** — the interpreter fallback returns the correct
list, and a compiled lowering (ndarray-valued boolean expression + parity
harness support for list results) waits for a consumer witness.

_Unverified, recorded so it is not lost:_ a decline thrown mid-compile may not
unwind `BaseCompiler._localVector` / `_localComplex` if those pushes are not
`finally`-protected, which would let one fail-closed throw leave stale frames
for later compilations in the same process. **Probed and could NOT reproduce**
(three declines between two identical compiles gave byte-identical output), and
every existing GPU decline throws the same way, so it is pre-existing if real.
Worth a `finally` audit rather than a bug hunt.

**B. Plain missing codegen — no design needed, small.** Good first-session
material if someone wants a quick win.

- ~~**`Repeat` on javascript** (1/1)~~ — **DONE 2026-08-02.** IIFE-parameter
  lowering next to `Fill`/`Tabulate`; the value is bound ONCE (an impure
  value draws once and repeats — interpreter parity, including the
  non-obvious edge that the interpreter consumes the draw even at count ≤ 0,
  pinned). Runtime count is rounded, non-finite count → `[]` (the
  `Chunk`-style finite guard, chosen over `Tabulate`'s unguarded shape so
  `Repeat(x, ∞)` cannot attempt an unbounded allocation). 1-arg infinite
  form keeps declining (D6), and a STATICALLY non-finite count declines too
  (review round: the interpreter stays inert on `Repeat(7, ∞)`, so the
  runtime guard's `[]` would be a valid-looking value with wrong semantics;
  the runtime-valued non-finite case keeps the `[]` projection, documented).
  Tests in `compile.test.ts` + `random-compile.test.ts`.
- ~~**`Choose` (`nCr`) on glsl** (4 st)~~ — **DONE 2026-08-02** on GLSL AND
  WGSL: literal k ∈ 0..8 unrolls the falling-factorial form
  (`Binomial(x+1, 2)` → `(((x + 1.0) * ((x + 1.0) - 1.0)) / 2.0)`), which
  matches the interpreter's GENERALIZED semantics (0 mismatches vs `.N()`
  over k 1..8 × 15 sample n incl. 5.5, −1, −1.5); `Choose` aliases to the
  same handler like the JS target. Operand bound via `gpuOperandOnce` when
  spliced ≥ 2× (impure draws once); `Binomial(Random(), 0)` DECLINES —
  probed: the interpreter consumes a draw there, and folding to `1.0` would
  skip it and shift later draws. Non-literal/negative/non-integer k, k > 8,
  complex operand: D6. A statically non-finite first operand also declines
  (review round: interpreter gives NaN for `Binomial(∞, k)` — even k = 0 —
  and stays inert on NaN input, so the `1.0` fold / unrolled `∞` were wrong;
  a RUNTIME-∞ binding still takes the arithmetic form, the documented
  static-assert divergence class). Report-only finding: the JS target's `_SYS.binomial`
  (Pascal table, `expand.ts:36`) THROWS a raw TypeError for the
  non-integer/negative n the interpreter handles (`Binomial(5.5, 2)` interp
  12.375, compiled JS throws) — the GPU falling-factorial form would fix it
  for literal k; not done, separate item.
- ~~**Non-finite literals on GPU** (5 st)~~ — **DONE 2026-07-30.** One spelling
  now serves both a literal and a masked `When`/`Which` branch
  (`gpuNonFiniteLiteral` in `constant-folding.ts`; `gpuNaN` delegates to it), so
  they cannot drift apart. GLSL gets `_gpu_inf()` alongside `_gpu_nan()` —
  `intBitsToFloat(0x7F800000)` behind an overridable preamble helper, emitted
  only when referenced; WGSL inlines the bitcast. **No `1.0 / 0.0` anywhere**,
  pinned by a test, because that is the form fast-math folds. Original note kept
  for the reasoning: **the mechanism already existed.** `gpuNaN()`
  (`gpu-target.ts` ~356) emits `_gpu_nan()` on GLSL (an overridable preamble
  helper) and `bitcast<f32>(0x7fc00000u)` on WGSL, and is already used for
  masked `When`/`Which` branches. The literal path cannot reach it only because
  `formatGPUNumber(n: number)` takes no target and so cannot know the language —
  it throws instead (two sites: `gpu-target.ts` ~4715 and `constant-folding.ts`
  ~29). Make the formatter target-aware and add the infinity counterpart
  (`uintBitsToFloat(0x7F800000u)` / WGSL bitcast; there is no `gpuInf` today).
  _Blocked on the in-flight GPU work; then in progress._ Note when doing it: the
  fast-math caveat is real — ANGLE→Metal fast-math already destroys compensated
  arithmetic in our high-precision work — so route through the overridable
  helper rather than inlining `1.0/0.0`, which a driver is licensed to fold.

**C. Correct fail-closed — NOT work.** The consumer's provenance rule is "first
match wins, everything else is CE", so its catch-all sweeps deliberate refusals
into our column. Verified by probe:

- Collection-valued branch condition (2/5) — the ruled fail-closed of the
  item-105/111 family. _(Re-triage note: a list-valued `Which` condition now
  compiles on JS via elementwise selection, so their bucket must be a shape
  outside that gate. Get the witness before treating this as settled.)_ **So 82
  members / 25 states is an upper bound on our gaps — but a much weaker upper
  bound than this triage first claimed.** Of the four buckets initially filed
  here as "not work", three turned out to be work (see A′ and B); only the
  branch-condition one survives, and it carries a caveat. Treat "correct
  fail-closed" as a claim requiring a probe, not a default.

**D. Needs a witness — cannot classify without seeing their shape.** Ask before
building; the compiled _meaning_ is genuinely unclear.

- `Set` (3/4), `Polygon` (3/16), `Sphere` (1/1), `GeometricVector` (1/3) —
  geometry/collection heads. What is `compile(Polygon(…))` supposed to _return_
  at run time? If the real need is membership (`x ∈ S`) rather than the
  aggregate as a value, that is a different and much smaller fix.
- `Subscript` (1/1) — **probe COMPILES**: `['Subscript','a','k']` canonicalizes
  to the fused symbol `a_k` → `_.a_k`. Their bucket is either stale or a shape
  where the fusion does not happen (cf. the G5 note in _Review residue_, where a
  binder-bound index severs the binding). Get the witness before assuming a gap.
- `Loop: Element index must be a symbol` (1/1) — reproduced only by handing
  `Loop` a malformed index (a literal where a symbol belongs), i.e. CE correctly
  rejecting bad input. Likely their expansion emitting a malformed `Loop`.
- **`Comprehension` on glsl** (2 st) — the existing `TODO(E3-GLSL)`: needs loop
  unrolling or fixed-size arrays. Real, documented, and blocked on the same
  width ceiling as everything else on this target.
- **Width ceiling, accepted by both sides**: an expression-level shader value
  _is_ a vec2–4, so arbitrary-width rows (a 10-curve family, a 900-element
  board) have no `vecN` to live in. Un-fanning those is a consumer-side
  mechanism (instanced draw), not a CE change. If profiles ever justify
  one-shader-body arbitrary-width rows, the ask is _array-uniform loop codegen_,
  and it requires witnesses first.

**Interval-js band** (526 members / 152 states): the domain is deliberately
scalar — one interval per quantity — so a collection-valued condition or operand
declines by design. See _interval-array support_ below.

**How to work this ledger.** It is a ledger, not a work item — do not open a
session against the section as a whole. The triage (step 1) is **done**, below.
Scope a session to **one group-A entry**, and give it a design pass first:
`PointList`/`PointZ` is rank 1 (36+ members _and_ it gates the biggest measured
CSE win), `At` on GLSL is rank 2 (largest GPU gap). Group B is quick-win
material. Group C is not work. Group D needs a question asked, not code.

**Caveat on the numbers throughout this section.** They come from a single
consumer's Desmos-derived corpus. That is the only population data we have, and
it is genuinely informative, but it is one workload: a head that is rare there
may be common elsewhere, and prioritizing strictly by these counts over-fits CE
to one consumer. Treat them as evidence of _demand_, not as a ranking of
_importance_.

**Ruled, not gaps:**

- **Interval-array support — DECLINED 2026-07-30, condition re-armed.** The
  reopening condition (a list-valued piecewise inside a single implicit body
  falling to sampling) was met by exactly **one document / 2 members**, and the
  consumer's own read is that the row should have been fanned into scalar
  members on their side. Supporting it means an interval-_vector_ value type
  through the whole IA target, not a lowering tweak. Re-arm: ≥5 documents, or a
  witness that survives the consumer's fan-out fix.
- **Loop-form `Sum`/`Product` inside a conditionally-evaluated arm** stays
  fail-closed (7 members / 1 state). The carve-out is a correctness boundary,
  not conservatism: GLSL's `?:` short-circuits, so hoisting a loop out of an arm
  it never feeds would shift every later `Random()` draw in the shader. The
  escalation route (an `if`/`else`-with-temporary lowering) needs a second
  witness; the count starts at one.
- **Interpreted-mode evaluation memo (CSE Phase 3) — NOT PURSUED.** Its gate was
  "bucket the interpreted residue first"; the bucketing says the residue is
  target gaps, not memoizable work. See
  [`docs/plans/2026-07-28-compile-cse-design.md`](./docs/plans/2026-07-28-compile-cse-design.md)
  §10.

### Complex values in compiled scalar comparisons (RESOLVED 2026-08-16 — the D2 runtime rule under `auto`/`complex`)

Resolved by step 4 of `docs/plans/2026-08-16-compile-complex-mode.md`: under
the default `auto` mode and under `complex`, an ordering comparison (and the
integer-only heads) over an operand that MAY be complex — a `complex`-typed
symbol, a promoted radical, a wide binding in complex mode — binds the operand
once and answers `false` (`NaN` for a numeric head) when its imaginary part is
not exactly zero, the real comparison otherwise (`BaseCompiler.
realOperandGuard`/`realOperandChain`, `_SYS.cisreal`/`_SYS.creal`). The
"cheaper discrimination" this entry wanted is exactly that: only operands the
analysis calls maybe-complex pay the guard; an `unknown`-typed plot variable
under strict shapes is real and keeps the raw `<`. A statically non-real
operand (`i < 2`) is a compile-time `non-real-operand` decline; `mode:
'strict'` keeps the previous fail-closed behavior. Original entry follows.


A compiled scalar comparison whose operand is merely `number`- or
`unknown`-typed lowers to a raw JS `<`. If that operand holds a complex
`{re, im}` at run time, JS coercion returns a silent `false`, where the
interpreter leaves the ordering unevaluated (→ NaN on a real target).
Indexing and `RandomList` seeding already project the real part at run time;
comparisons do not.

Deferred because the fix touches the hottest compiled path: every scalar
comparison — including compiled plot bodies, where `x < 3` with `x` typed
`unknown` is the norm — would need a runtime object-check, with a real
performance cost. A compile-time refusal is *not* an option: it would stop
ordinary `unknown`-typed plot variables from compiling at all. Wanted: a
cheaper discrimination (e.g. only guarding operands that can actually receive
a complex binding), measured against the plot benchmark.

### Kleene-absence residue (missing-value typing landed 2026-07-24)

The `Missing`/`missing` feature shipped (record in `CHANGELOG.md` and
`docs/plans/2026-07-22-missing-value-typing-design.md`).

**Ruling (2026-07-24):** comparisons are **IEEE over `NaN`** (`NaN == NaN` is
`False`, orderings with `NaN` are `False`) and **Kleene over the `Missing`
symbol** only, across the full relational family (`Equal`/`NotEqual`/`Less`/
`LessEqual`/`Greater`/`GreaterEqual`). Absence for discharge (`IsMissing`/
`Coalesce`) and aggregates (`Max`/`Mean`/…) is unchanged — `NaN` stays absent
there. Because `NaN` follows IEEE, compiled and interpreted numeric comparisons
now agree by construction (plain `==`, no guard); empty `Max`/`Min` compile to
`NaN` matching the interpreter.

**Ruling (2026-07-24, later):** a scalar `If`/`Which` condition evaluating to
`Missing` yields a catchable **error expression** ("The condition is
absent…"), the R `if (NA)` stance — absence is a runtime data state, not a
program defect. The typo path (a condition that is not boolean at all,
`If(3, …)`) deliberately keeps its spell-check **throw**: changing it was
ruled out of this feature's blast radius. No residue remains from the
missing-value feature.

### Broadcast typing residue (`broadcastable<T>` lift landed 2026-07-17)

The lift itself shipped (record in `CHANGELOG.md` and
`docs/plans/2026-07-11-broadcast-typing-lift-design.md`). Genuinely
remaining, as separate demand-gated items:

- **Phase-2 declared-type reconciliation** for symbolic-length ranges (see
  the design doc). Two broadcast-lift Phase-2 test pins currently assert the
  declared type + Map form pending this item.
- **Param-type-driven lambda-body typing:** lambda BODIES over untyped
  params still type scalar — only applications are lifted; revisit only
  with a param-type-driven design.
- **Python broadcast compilation:** the Python target lowers arithmetic to
  infix and has no generic `_ce_bcastf` helper, so possibly-collection
  operands fail closed (interpreter fallback is sound). Build the helper
  only if a compiled-NumPy binding path is ever needed.
- **Matrix rank preservation in `broadcastResultType`:** matrix
  intermediates flatten to `list<number>` (rank lost) — pre-existing
  convention, someday-fix.

Interactions to respect: non-finite typing convention, `infer(unknown)`
destructiveness, scalar-requiring contexts (exponents, comparisons, plot
coordinates).

### Symbol-identity residue (initiative complete, shipped 0.96.0)

The name-vs-binder repair is done — phases 1–3 including the sanctioned binder
mechanism. Records: `docs/plans/2026-07-24-defining-scope-dereference-design.md`
(dereference) and `docs/plans/2026-07-26-binder-mechanism-design.md` (binder
mechanism, 16 stages). What is genuinely left:

- **Raw-name-fallback provenance** — the one open thread, deferred to a future
  phase. A pre-boxed operand can be applied twice through a raw name rather
  than a binding, which binding identity cannot distinguish; the behavior is
  characterization-pinned (`@fixme`) rather than fixed.
- **Found-not-fixed, all pre-existing and pathological:** `Limit(1/(x-a), …)`
  capture in `library/calculus.ts`; a global `_1` that *holds a value* stalls a
  pipe `Map`; flat-vs-nested `Multiply` breaks `isSame` (`\frac{ax^2}{2}` vs the
  antiderivative's flat form) — possibly a canonicalization gap, unowned.

### Random-redesign residue (shipped 0.95.0/0.96.0)

The redesign shipped and the one-release tombstones are deleted. Model
reference: `docs/RANDOMNESS-MODEL.md`; spec:
`docs/plans/2026-07-25-random-signature-redesign.md`. Remaining:

- **`compileShader` does not apply `rewriteAngularUnit`.** Both GLSL and WGSL
  `compileShader` route through `compileShaderBody`, never `compileOrThrow`
  (`gpu-target.ts` ~:4249), so a degree-mode engine emits radian trig on that
  route only. Pre-existing and unrelated to randomness.
- **`Map` element-type derivation** still widens independently of the
  domain narrowing the random family uses (`RandomChoice` itself was aligned
  with `Random` on 2026-07-27 via the shared `randomElementType`).

Settled, not work: the GLSL sibling-draw order is an accepted documented caveat
(operand evaluation order is unspecified in GLSL; WGSL pins L→R), and the
"host uniform" seed-ABI deferral is user-ratified.

**Open consult with the Tycho team** (do not land unilaterally): whether the
*released* seeded `Random()`/`Shuffle` forms should move from bake to stream,
matching the two-primitive model. Awaiting their acknowledgement.

### Product feature track (agreed 2026-07-04)

CE is the foundation for Tycho / Graph Paper: an app helping scientists,
students and educators collaborate and communicate about scientific topics.
The 2026-07-04 capability survey against that goal found the engine strong on
plotting/compile targets, units & quantities, logic/sets, linear algebra,
equation systems, and number formatting — and thin in the areas below. The
agreed items (`Series`, trig rewrites, statistics Phases 1–2, the explain
API, significant-figures display, the `Measurement` MVP) have all landed —
the record lives in `CHANGELOG.md` and the design docs under `docs/plans/`.
What remains (effort S/M/L):

**Statistics residue (demand-gated Phase 3, design doc §10):** inverse
regularized incomplete gamma/beta kernels and the distributions that need
them (Student-t, χ², F, Geometric…), `RandomVariate` sampling (reuse the
`Sample` RNG/seed policy), and fit diagnostics (R²). Also: the Python
execution-parity suite for the new scipy mappings is guarded/skipped until
scipy is installed in `./venv`.

**Series residue:** bare `O(…)` parsing remains deferred (design doc §8 Q3);
revisit for lenient mode once the parser work settles. From the Puiseux/log
round (landed 2026-07-12), deliberate defers that could be revisited on
demand: log-carrying expansions at ±∞ (`1/ln x`, `ln(ln x)`, `sin(ln x)`,
`e^{1/x}` defer — correct-over-wrong), exact terminating expansions still
emit a conservative `BigO` (`assembleLaurent` has no exactness notion),
combined distinct radicals grow `lcm(d)` uncapped inside add/mul (bounded by
the deadline → clean defer), and `diffLaurent` asserts `d === 1` (polygamma
ladder only).

**Typed function literals residue (demand-gated, design doc
`docs/plans/2026-07-12-typed-function-literals-design.md` §10):** the typed
`Function`/`Typed` core landed 2026-07-12 (652a20fc); the signature-string
sugar (`["Function", body, "'(x: integer) -> real'"]` canonicalizing into
the structural form) landed 2026-07-19. Deferred until a
consumer asks: **(S/M)** optional/variadic parameter annotations
(`["Typed", "xs", "'number+'"]` — the encoding already admits it; needs
`makeLambda` arity handling — the sugar rejects these markers until then),
**(S)** a strict-mode runtime check of the
result against the declared return type (returns are pure ascriptions today),
and **(S)** LaTeX typed-parameter notation behind a serialization style flag
(annotations currently drop in LaTeX).

**Compiled recursive lambdas** shipped 2026-07-19 as lenient true recursion
(as-built record:
[`docs/plans/2026-07-19-compiled-recursive-lambdas-design.md`](./docs/plans/2026-07-19-compiled-recursive-lambdas-design.md)).
Standing contracts: termination is the caller's — runaway recursion throws a
catchable `RangeError`; complex-valued recursion needs a `Typed` `complex`
return ascription (untyped applications type `broadcastable<number>` and hit
the complex-bcast deferral).
Remaining follow-ups, both demand-gated:

- **(M) GPU literal-depth unrolling** (WGSL/GLSL cannot recurse; GPU stays
  fail-closed): the v1 memoized literal-argument specialization design
  (preserved in the design doc's git history) is the route — gate on a GPU
  consumer.
- **(M) Interpreter perf** (triaged + fixes landed 2026-07-19: the D2
  numericize tail now gates on lexical `isConstant`, and the full-library
  sweep made non-lazy handlers trust pre-evaluated operands — symbolic
  recursive unwinding is linear, not exponential). What this leaves behind
  is the governing **evaluate-handler contract** (the one to enforce in
  review): a `lazy: true` operator receives RAW operands and its handler
  owns their (single) evaluation — `Add`/`Multiply`/`Sum`/`Product`/
  `Measurement`/`NumeratorDenominator` re-evaluate legitimately; a
  non-lazy operator receives EVALUATED operands and must not re-evaluate
  them (each call re-descends the unmemoized subtree; under nesting that
  compounds exponentially). Do not delete the lazy `Add`/`Multiply` maps —
  the experiment was run and froze recursive unrolling at one level per
  pass, which is what confirmed the lazy/non-lazy split is the real
  contract. Remaining, all demand-gated:
  - two sites carry the same dynamic-scope `unknowns.length === 0` predicate
    as a *latent* instance of the trap, with no demonstrated observable
    misbehavior — leave them until one surfaces: the equation-equivalence
    `eq` in `relational-operator.ts` is reachable only via a direct
    `.isEqual()` on two equation objects (normal `Equal(eq1, eq2)`
    canonicalizes to a chain and never compares them as equations), and that
    path runs at top level where `unknowns` is correct; `isPolynomialExpression`
    in `linear-algebra.ts` ×3 sits behind callers that pre-evaluate operands.
    A naive `isConstant` swap at either would change classification of
    assigned symbols in unevaluated input, so it is not a free rename.
  - **Separately** (pre-existing, unrelated to the D2 predicate): a binary
    `Equal(w, 1)` with a bound-but-symbolic parameter evaluates to `False`
    inside a function application rather than staying inert (`w === 1`) as it
    does at top level — the low-level `eq(lhs, arg)` in `Equal.evaluate`
    (`relational-operator.ts`) decides the bound param `w` unequal to `1`
    instead of undecidable. Own triage; not touched by the D2 fix.

**MathNet parser tail (S/M; corpus at 371/428 CI-gated after the
2026-07-09 rounds):**

*Next up (agreed 2026-07-09):*

- **MATH genre-gap tail (S/M):** the Hendrycks MATH genre sweep (report:
  `docs/mathnet/math-genre-sweep.md`, tagged failures:
  `math-genre-failures.json`) stands at **97.66%** clean (371 of 735
  failures fixed) after the 2026-07-09 rounds. Remaining ranked tail:
  (1) styling remnants (11, mostly array-env/prose — low value);
  (2) units residue: `yd`/`qt`/`pt` and currency (`USD`, `cents`, `euro`)
  have no `unit-data.ts` symbols (adding them is a units-subsystem call,
  not parser work); spaced `\text{miles per hour}` (interior spaces are
  stripped before resolution); Quantity arithmetic does not cancel
  compound units (`18 in / (12 in/ft)` → `1.5 in/in/ft`, not `1.5 ft` —
  a Quantity-simplification item);
  (3) small leftovers: `\cancel` inside `array`-env `@{}`/`\cline`
  layouts, set-congruence `\{0,1\}+\{1,4\}\equiv…` (set arithmetic, out
  of scope), and possible future upgrades to `IndexedSequence`
  (lazy-collection semantics, the parenthesized `(a_n)_{n\in\mathbb{N}}`
  form).
  Ascii-pipe divisibility evidence doubled (36 more hits, tracked below).
  Skip: `array`-env long-division layouts, `\nabla` puzzle ops, repeating
  decimals `0.abab\overline{ab}`.
*Rest of the tail:*

- **Polynomial-ring notation (M):** parse blackboard-bold rings followed by a
  bracketed variable list, e.g. `\mathbb{Z}[x]`, `\mathbb{R}[X,Y]`, as an
  inert/structural algebraic object instead of treating `[...]` as indexing.
- **Set-image bracket notation audit (S/M):** `f[S]` is parser-clean today as
  `At(f, S)`; decide whether set contexts need a distinct structural
  function-image head for expressions such as
  `f[\operatorname{divs}(m)] = \operatorname{divs}(n)`.
**`Interpret` — generalization ladder (design:
`docs/plans/2026-07-09-ellipsis-interpretation-design.md`):** v1 landed
2026-07-09 — the explicit `Interpret(expr)` head turns continuation-bearing
sums/products into formal `Sum`/`Product` under a strict arithmetic-
progression gate (`1+2+\dots+n` → `Sum(k,(k,1,n))`; parity mismatches and
anything unproven stay inert); v2–v4 (polynomial/geometric recognition,
Berlekamp–Massey → `RSolve`, async OEIS-backed `ce.interpret`) followed.
Remaining, demand-paced:

- **Known edge:** `simplify()` on `-(2·4·\dots·2n)` distributes the outer
  sign into the product and folds (pre-existing).
- **Promotion decision** (after product usage): whether bare
  `evaluate()`/`simplify()` should invoke the recognizer by default.

Still deferred: ASCII-pipe divisibility (`p|a+1`) because it conflicts with
absolute-value syntax (though the parenthesized form `(a+f(b)) | (a^2+bf(a))`
is unambiguous and could be revisited); set arithmetic such as
`2\mathbb{Z}+1`; richer `array`/`cases` environment variants; prose-heavy or
fragment-boundary inputs that need surrounding natural-language context.

**Uncertainty/Measurement residue** (MVP landed 2026-07-07; design + phased
record:
[`docs/plans/2026-07-07-uncertainty-design.md`](./docs/plans/2026-07-07-uncertainty-design.md)).
Deferred:

- **Dual-number correlation tracking** (correct-by-default) — the documented
  upgrade past independent propagation, which over/under-estimates when one
  measured variable is reused across operands (`x·x`, `x/(x+1)`). A
  `BoxedMeasurement` carrier with per-source identity; the hard part is
  source-id stability across re-boxing (design doc "Non-goals").
- **Relative-error notation** (`±5%`) and **distribution/`RandomVariate`
  links** (reuse the statistics RNG/seed policy).

**`FindFit`/`FindRoot` residue (landed 2026-07-21, Tycho item 77; ratified
design: `docs/plans/2026-07-21-findfit-design.md` § 8–9):** demand-gated v2
items — per-point **weights** (resolved future shape: a trailing optional
`weights` argument, NOT tuple-shape deduction), parameter
uncertainty/covariance output (`JᵀJ⁻¹` is a byproduct), general
`FindMinimum`, and multi-start/global search (revisit only on corpus
evidence of basin sensitivity). Known naming quirk to document for
consumers: a parameter named `e` canonicalizes to `ExponentialE` and cannot
be fit.

**Mathematica surface forms — deferred tail (need user steer before
attempting; landed record in the 2026-07-14 commits):** Tier 3 heads
(`NSolve` — cheap as Solve+N — and `Reduce`; `FindRoot` landed 2026-07-21
via the item-77 nonlinear least-squares core, with `(x, x0)` start tuples
and box constraints); the
`{i, n}` 2-element iterator shorthand and bare-count `Table(expr, n)`
(rejected as malformed for cross-operator consistency — adopt everywhere at
once if ever); symbolic directional limits (`lim_{x→a⁺}` at a symbolic
point stays inert — representation correct, evaluation gap). Related open
parse question (not filed): number-juxtaposed bracket lists (`2[1,2,3]`)
don't parse; `2\cdot[1,2,3]` does.

**Not yet agreed (proposed 2026-07-04, awaiting a call):**

6. **MathML output + speakable text (M).** Communication and accessibility:
   MathML serialization for export/interchange (web, Word, EPUB) and a
   speakable-text serializer for screen readers. AsciiMath output already
   exists; MathML and speech are absent. Accessibility matters for the
   education audience.
8. **Chemistry notation — mhchem `\ce{}` (M).** Chemical formulas, isotopes,
   reaction arrows. Only if chemistry is in scope for Graph Paper — decide
   before investing; `mol` exists solely as a unit dimension today.

### Review findings (2026-07-04) — residue

The 2026-07-04 review's P0/P1 fixes all landed (DSolve repeated-root and
Error-node bugs, the ODE P1 tail incl. the parsed-LaTeX path, the
loose-parsing cluster with the `strict` escape hatch, and the top P2/P3
items: Beta poles, `x·∞`, inverse-hyperbolic poles, the rules.ts edge bugs).
Full record: [`docs/reviews/2026-07-04-review.md`](./docs/reviews/2026-07-04-review.md).
Still open from its ranked list:

- **defint error bar 1.6× optimistic on endpoint-singular integrands** —
  large (tanh-sinh quadrature).
- **Perf tail.** The 2026-07-01 performance review (P0–P3,
  `PERFORMANCE_FINDINGS.md`) fully closed 2026-07-18 — its status table
  records what shipped and, importantly, what was **measured unprofitable
  and must not be re-attempted without a new profile** (P2-2 `isSubtype`
  memo, P2-4 simplify-history scan, the `bignumRe` memo, P3-1 `.json`
  cache). Still open, measurement-gated: cold-start bundle size, and the
  post-drift-fix residual tail — 6 benchmark cases still < 0.95× vs 0.73.0,
  worst CE4 erf-integral 0.62× (case-specific integrate/simplify machinery
  growth, not box tax) — a candidate future perf item. **Also
  measured-unprofitable: both P1 differentiation levers and the `.mul()`
  fast-path pivot** (2026-07-19) — see "Symbolic-evaluation performance → P1"
  below before touching `derivative.ts` or `sortProductOperands` for speed.
- **Loose-parsing low items:** infix calculator notation `5 nPr 2` is
  unsupported (a new-notation design item, not a map gap); explicit `_a`
  wildcards in arrow-string rules are a silent no-op (redundant there —
  auto-wildcarding covers it). `sqrt2x` → `√(2x)` is a deliberate policy
  (consistent with the bare-function convention `cos 2x` → `Cos(2x)`), not
  a bug.
- **Doc/cosmetic tail:** locale separators.
- ODE P2s — folded into the DSolve/NDSolve track below (**B12**).

### Symbolic capability gaps

#### B9. `Solve` — beyond the Wester ceiling

The Wester `Solve` score is saturated at our principled ceiling (14/21; the
last two gaps — `xˣ = x`, `sin x = tan x` — are harness artifacts: the
harness grades SymPy's arbitrary finite root-slices, not a CE capability
gap). The section is kept for that harness-artifact explanation, which the
Fungrim track cross-references. Genuinely open Solve items:

- **Diophantine deferrals** (Phase 3 shipped linear n-variable + Pell +
  Pythagorean triples; design record in
  `docs/plans/2026-07-04-solve-domain-design.md` Phase 3): sum-of-squares
  tier (fits a representation function better than Solve), general binary
  quadratics via `transformation_to_DN`, half-bounded-Range instantiation
  (currently inert by design), `factor_list`-style auto-factoring. Ternary
  quadratics deliberately skipped (low value); weighted-coefficient /
  ≥4-square parametrizations deliberately refused (textbook families are
  provably incomplete — the contract emits only complete families).
- **Inequality and system solving via `Solve`** remain partial (see
  `test/compute-engine/solve.test.ts` commented `@todo` cases); linear
  inequality systems are handled, general ones are not.
- The solve rule set is acknowledged incomplete (`solve.ts` "MOAR RULES",
  plus two deferred side-condition checks noted in-file).

#### B11. Multivariate polynomial GCD — Stage C (Fateman-scale)

The variadic `GCD` handles textbook multivariate cases (Brown's dense modular
GCD in `multivariate-gcd.ts` — the baseline Zippel extends), but the 7-variable
**Fateman GCD benchmark** (Symbolica 4 s / Mathematica 89 s / SymPy 61 min)
exceeds the dense algorithm's complexity cap and defers. To reach Fateman scale:
**Zippel** sparse interpolation (dense interpolation is the bottleneck at 7
variables), **multi-prime CRT + rational reconstruction** (a single large prime
caps coefficient size), and faster `MPoly` arithmetic (the `Map`-keyed
leading-term scan is O(terms) per call). The kernel
(`boxed-expression/multivariate-poly.ts` + `multivariate-gcd.ts`) is shared
infrastructure — multivariate factorization, `Cancel`/`Together`, partial
fractions, and `Resultant` all want the same representation. Tracked against the
`benchmarks/audit/` Fateman footnote.

#### B6. Audit-harness expansion

The CE-vs-SymPy audit (`benchmarks/audit/`) already grades the
`Solve`/`Resultant`/`GCD` heads (and, since 2026-07-10, `DSolve` — see B12)
through the real opt-in loaders. **Done (2026-07-21):** the Bondarenko
integration set (35 hard nested-radical / log / transcendental integrals, MIT)
is wired in — `benchmarks/audit/bondarenko.ts` → `REPORT-bondarenko.md`, graded
by the invariant `d/dx(F) ≈ f` across base CE / CE+R/F / SymPy / Mathematica
(with a finite-difference fallback where the symbolic derivative doesn't
numericize — PolyLog, elliptic kernels):
CE 0/35 · CE+R/F 21/35 · SymPy 7/35 · Mathematica 32/35 (CE+R/F **12 → 20**
after the R31 nested-radical substitution fallback — closing

#2/#10/#11/#12/#15/#16/#17/#18 — then **20 → 21** after the R32
Euler-substitution lever ("Lever C") closing the √(quadratic)-nested **#9**; see
**Coverage tracks → Rubi**). (Rubi chapter translation — the
lever for the indefinite-∫ gap, with Rubi now recovering 6 of the 8 hard Wester
integrals — is its own track: see **Coverage tracks → Rubi**.)

#### B12. ODE solving — `DSolve`/`NDSolve` beyond the first slice

`DSolve` now covers first-order linear (integrating factor),
constant-coefficient homogeneous up to order _n_ (numeric characteristic roots
with clustering), nonhomogeneous constant-coefficient with polynomial, sine,
and exponential forcing via undetermined coefficients — including resonance
(forcing `sin(ωx)` when `±iω` is a characteristic root) and orders ≥ 3 —
second-order Cauchy–Euler (homogeneous and, since 2026-07-18, nonhomogeneous
via an x-power indicial ansatz with a variation-of-parameters fallback), the
Airy family `y″ = (px+q)y` (`AiryAi`/`AiryBi`, with new `AiryAiPrime`/
`AiryBiPrime` operators and full derivative closure), the first-order
nonlinear classes (separable with _implicit_ `F(y) = G(x) + C` solutions,
Bernoulli `v = y^{1−n}`, first-order homogeneous `y′ = F(y/x)`, exact
`M dx + N dy = 0`, and Riccati — constant-particular, plus the
`y = −u′/(q₂u)` Airy linearization for `y′ = q₀(x) + q₂y²` with linear `q₀`),
first-order linear systems (distinct eigenvalues, diagonal with repeats, and
defective 2×2 via a generalized eigenvector, gated on an exact `(A−λI)² = 0`
check so near-repeated numeric eigenvalues stay inert), and initial/boundary
conditions (solving the linear system for the integration constants).
`NDSolve` integrates adaptively (Dormand–Prince 5(4) with dense output;
scalar, higher-order reduction, and first-order-system forms). Unsupported
forms stay **inert rather than wrong** — preserve that contract as coverage
grows. (The constant-coefficient Abel rung — dead code shadowed by the
separable rung — was removed 2026-07-18.)

The CE-vs-SymPy audit harness (`benchmarks/audit/dsolve.ts` +
`gen_dsolve.py`, substitute-back residual oracle, 51-case corpus seeded from
SymPy's `test_ode.py`; landed 2026-07-10) grades **CE 50/51 correct, 0
wrong — at parity with SymPy (50/51)** after the 2026-07-18 frontier round
(BY1 Riccati→Airy — which SymPy errors on —, BY3 nonhomogeneous
Cauchy–Euler, BY4 Airy, BY5 repeated-eigenvalue system). The one remaining
`unsupported` row is **variable-coefficient second order**
(`sin(x)y″ + y′ = cos x`), where SymPy's "solution" is nested unevaluated
integrals — a `p = y′` reduction-of-order rung would need to emit
inert-integral-carrying results to match, a contract question before it is a
coding task. Ranked next steps (good contributor territory):

- **`NDSolveFunction` system form:** `NDSolve` is adaptive (Dormand–Prince
  5(4) with dense output, landed 2026-07-18) and `NDSolveFunction` returns a
  callable `Function(InterpolatingFunction(data, x), x)` — but **scalar
  forms only**; the multi-dependent system form stays inert. A
  vector-valued interpolating result needs a shape decision — demand-paced.
  Known engine-level quirk (pre-existing, pinned in tests): applying a
  MathJSON-**re-boxed** literal resolves the interpolation one `evaluate()`
  late (`N()` is immediate).
- **Tolerance hardening** in the numeric characteristic-root clustering, so
  near-degenerate roots are grouped reliably as coverage of higher-order
  nonhomogeneous problems grows.
- **Adjacent, reusing the same kernel:** a
  `LaplaceTransform`/`InverseLaplaceTransform` pair (currently inert) — a
  capability on its own and a second, independent route to constant-coefficient
  IVPs that cross-checks the initial-conditions work. (`RSolve` already reuses
  the characteristic-polynomial / root-multiplicity machinery for linear
  constant-coefficient recurrences, with an `rⁿ·n^k` basis instead of
  `e^{rx}·x^k`.)
- A proper `DiracDelta` (for derivatives of step functions, currently 0
  a.e.) remains a possible future refinement.

#### B13. Wester capability gaps — the skip ledger in `wester.test.ts`

`test/compute-engine/wester.test.ts` is the CI correctness suite transcribed
from Wester's CAS review (the categories the `benchmarks/audit/wester.ts`
harness cannot ingest). The convention: a gap exists there as a `test.skip`
asserting the **correct** answer — unskipping is the acceptance test. The
2026-07 campaign worked the ledger from 18 skips down to **one**:

- **Wester 9 — recursive denesting** (the Putnam radical
  `√(14+3√(3+2√(5−12√(3−2√2)))) → 3+√2`): only single-level
  `√(a+b√c)` denesting is implemented; the multi-level/recursive case is a
  deliberate algorithmic project (Landau/Blömer-style).
- **Linear algebra residue** (not skip-representable, tracked here):
  matrix square root beyond exact 2×2 (n×n wants eigendecomposition or
  Denman–Beavers); exact singular values beyond a 2×2 Gram matrix. Two
  wester tests are active-but-weakened rather than skipped (stale "skipped"
  comments in-file): fused-form `row-vector · (a·M1 + M2)` asserts the
  current `MatrixMultiply` type rejection, and the symbolic Vandermonde
  determinant is spot-checked numerically because `Factor`/`simplify`
  leave it unfactored (a `/(−w+x)` division artifact).
- Missing heads noted in comments: `MatrixExp` (`Exp` of a matrix
  broadcasts elementwise — it is *not* the matrix exponential), matrix
  functions generally (sine of a matrix), Jordan / Smith normal forms
  (→ B14).
- Closed-form table growth for infinite sums/products (beyond the
  `namedSeriesClosedForm` table landed 2026-07-18 — e.g. `β(4)`,
  Hurwitz-shifted bases `(k+m)^{−s}`, higher moments `Σk²rᵏ`) remains
  demand-paced.

Untranscribed corpus categories (future tranches): systems of equations /
congruence solving, special functions, transforms, ODEs/PDEs (→ B12),
vector/tensor analysis, numerical analysis.

#### B14. Wester representation gaps — problems the suite cannot state

Distinct from B13: these Wester problems have **no CE API to express them**,
so they cannot exist as `test.skip`s — each needs a naming/design decision
first, then its acceptance test goes into `wester.test.ts`. Mathematica
spellings are deliberately NOT aliased (decision 2026-07-05); the
Mathematica→CE correspondence table lives in
[`docs/MATHEMATICA-NAMES.md`](./docs/MATHEMATICA-NAMES.md) — **probe CE's
own names before adding an entry here** (many presumed-missing heads exist
under CE names: `NthPrime`, `NPartition`, `PowerMod`, `ModularInverse`,
`StirlingS1`, `Rationalize`, `PrimitiveRoot`, `ContinuedFraction`,
matrix ∞-`Norm`, `BaseForm`, finite-domain `ForAll`/`Exists`).

- **Repeating-decimal representation — producer direction:** an equivalent
  of `ToPeriodicForm`, rendering an exact rational as its periodic-decimal
  object (the LaTeX serializer's `repeatingDecimal` option covers only
  float display; the consumer direction — repeating-decimal literals boxing
  as exact rationals — is done).
- **Quantifier elimination over ℝ:** `ForAll`/`Exists` evaluate only over
  finite domains; the Wester/Liska–Steinberg stability problems need QE over
  real closed fields (CAD or virtual substitution) — a major subsystem,
  catalogued here for completeness, not planned.
- **Matrix decompositions & functions:** `MatrixExp` / general matrix
  functions (`Exp` of a matrix **broadcasts elementwise** — the footgun is
  documented, but an actual matrix exponential remains future work);
  symbolic singular values (`SVD` is float-only); Jordan / Smith normal
  forms; symbolic Frobenius norm (`Norm(M, 'Frobenius')` for symbolic
  entries).
- **Hypothesis testing:** `MeanTest` etc. — undeclared; only worth pursuing
  if the statistics track (GP items) calls for it.

#### B15. Parameter-conditional results — the last `Which` producer

The conditional-values design
([`docs/plans/2026-07-12-conditional-values-design.md`](./docs/plans/2026-07-12-conditional-values-design.md))
is ratified and its Phases 1–3b landed: `When` threading algebra, the Solve
adopter (trig/hyperbolic validity + radical extraneous-root guards), and the
convergence-conditions adopter (improper-integral endpoint guards, geometric
series `1/(1−x) {|x|<1}`). Remaining:

- **Definite-integration region splitting (`Which`) — the only open
  producer.** Motivating case:
  `∫_{−π}^{π} (1 − x·cos t)/(x² − 2x·cos t + 1) dt` = `2π` for `|x| < 1`,
  `0` for `|x| > 1` — CE correctly stays inert today; locating where poles
  cross the contour is the hardest part and stays with this adopter.
- **Cosmetic residual:** an unsatisfiable conjoined guard (`∫₀^∞xᵖdx`)
  displays rather than collapsing — needs contradiction detection in
  assumptions; not worth it standalone.
- **Known Phase-1 limitation** (accepted, revisit on evidence): a
  conditional nested under a lazy operand (`5 − When(x,c)`) lifts fully
  only on a second `evaluate()`; the guard is never dropped.

### Collections — laziness & fusion backlog

The 2026-07 laziness audits (rounds 1–2 + review rounds, landed by
2026-07-17) and the T1/T2 follow-up round (landed 2026-07-19: finiteness
guards on `CountIf`/`Position`/`Ordering`/`DictionaryFrom`/`RecordFrom`;
threshold-hybrid lazy views for `Insert`/`DeleteAt`/`ReplaceAt`,
`Partition` chunk/window forms, `SlidingWindow`, `ChunkBy` via the shared
`windowedCollectionOps` helper) leave this backlog:

- **T3 (deferred, low value):** `Keys`/`Values` (dicts are small), `Chunk`
  (needs count only).
- **Map auto-compile v1 gaps (shipped 2026-07-19; revisit on a profile):**
  the explicit-materialization route stays interpreted (ratified non-goal —
  do not reorder `_computeValue` steps 3/3b), and non-`Map` lazy collections
  (`Filter`, `Comprehension` bodies) and bignum drains are not attempted.
  See [`docs/plans/2026-07-19-map-auto-compile-design.md`](./docs/plans/2026-07-19-map-auto-compile-design.md).
- **Structural rewrite layer — open design decision (user has not ruled).**
  The stacked-lazy-`Map` drain cost that motivated fusion is addressed:
  drain-time lowering (`map-lowering.ts`, shipped in this cycle's release)
  applies broadcast-shaped lambda levels directly at iteration, ~3×
  (`evaluate()`) / ~4× (`.N()`, machine path) on the Tycho item-103 witness;
  structural canonical-level fusion (`Map(Map(s,f),g)` → `Map(s, g∘f)`) was
  considered and REJECTED (canonical forms are user-visible; reactivity).
  What remains open is the broader question: `Count(f(x))`-through-eager-op
  cheapness needs canonical-level rewrites, a churn-heavy direction to
  decide deliberately. (Related closed rulings, recorded in
  `docs/plans/2026-07-19-map-auto-compile-design.md` and the 0.95–0.98
  CHANGELOG entries: Map auto-compile stays machine-precision-only — no
  bignum-safe compile tier.)
- **Latent issues: none remaining.** The 2026-07-19 latent sweep
  dispositioned the whole former list (fixes, could-not-reproduce
  verifications, and an `At` `@todo` audit — record in that day's commits
  and `CHANGELOG.md`); the one lasting convention: `Slice` finiteness is
  honest — negative end over an infinite source is an infinite tail,
  negative start over one is inert, unknown-length sources report
  finiteness unknown.

### Strings — operators left for a later phase (opened 2026-08-16)

Phase 1 of the strings work made `string` an indexed collection of
`character` (`docs/STRING_ROADMAP.md`, "Decision: strings become indexed
collections of characters"; implementation plan
`docs/plans/2026-08-16-string-phase1-character-type.md`). The library audit
done for that phase (Appendix A of the plan) classified every signature that
admits `collection<T>` / `indexed_collection<T>`. Phase 1 shipped the
string-preserving arm for the operators the preservation rule makes
mandatory; the entries below are the ones deliberately left out, each with
the reason it is a judgement call rather than a forced consequence.

- ~~**String arms for `RandomShuffle`, `RandomSample` and `DeleteAt`**~~ —
  CLOSED 2026-08-16 (Phase 2). All three produce a permutation or a subset of
  the source's own elements, so by the preservation rule ("subset or
  reordering of the input's own characters ⇒ string in, string out") they
  belong with `Reverse` and `Take`. Each now carries a
  `(T) -> T where T: string` arm ahead of its generic one:
  `Type(RandomShuffle("abc"))` is `"string"` and `DeleteAt("abcdef", 2)` is
  `"acdef"`. The static-result-type break has its own CHANGELOG note.

- ~~**Inner strings for the chunking family**~~ — CLOSED 2026-08-16, ruled
  **(b)**: over a string source `Chunk`, `Partition`, `ChunkBy`,
  `SlidingWindow`, `Permutations` and `Combinations` return `list<string>`,
  each inner element being a contiguous run (or a reordering, or a subset) of
  the source's own characters — exactly the condition under which every other
  operator preserves the string kind. `Chunk("abcdef", 2)` is now
  `["abc","def"]` rather than `[["a","b","c"],["d","e","f"]]`, and
  `Permutations("ab")` is `["ab","ba"]`. Five of the six carry a leading
  `((S, …) -> list<string> where S: string)` overload arm; `Partition` uses a
  `type` handler instead, because a second arm would make its contextual
  `callback<S>` slot ambiguous and silently disable the Design D stamp that
  annotates an inline predicate's parameter. `Tally` was ruled the other way
  in the same decision and keeps `character` values (below). The
  static-result-type break has its own CHANGELOG note.

- ~~**`Tally`'s values half**~~ — CLOSED 2026-08-16 as part of the same
  ruling: `Tally(s)` keeps `tuple<list<character>, list<integer>>`. The
  distinct values it returns are the collection's *elements*, each paired with
  a count, not runs of them, so the string-preservation rule does not apply
  and the element type is the honest answer. `Tally("banana")` is
  `(["b","a","n"], [1,3,2])`.

- **`RandomChoice`.** It draws *with* replacement, so its result is a
  multiset over the source's own elements — arguably element-preserving,
  arguably list-out. Needs a ruling before it can be classified.

- ~~`Reshape` on a string / `Differences("abc")`~~ — CLOSED 2026-08-16:
  `Reshape`'s `type` handler now reports the declared `value` (not
  `nothing`) when it declines, and `Differences` refuses a source whose
  element type is provably non-numeric with one `incompatible-type` error
  at the operand instead of building error elements.

The Phase 2 work items themselves — the `Join`/`StringJoin` role split, the
generic contiguous-subsequence family (`ContainsSequence`, `RangeOf`,
`StartsWith`, `EndsWith`), `StringReplace`, trim/pad/repeat, the case
operations, `StringCompare` and `NumberFrom` — are specified in
`docs/STRING_ROADMAP.md` and are tracked there, not duplicated here.

### `DigitsFrom` ignores an integer `base` argument (found 2026-08-16)

`DigitsFrom(s, base)` is declared `(string, (string|integer)?) -> integer`,
but its handler resolves the base with
`(isString(op2) ? op2.string : undefined) ?? sym(op2) ?? 10`
(`src/compute-engine/library/core.ts`, in the `DigitsFrom` evaluate handler).
For an integer base neither branch matches — `isString` is false and a number
has no symbol name — so the fallback `10` is always used:

- `DigitsFrom("101", 2)` is `101`, not `5`.
- `DigitsFrom("2a", 16)` is an `unexpected-digit` error on `a`, not `42`.
- A *string* base (`DigitsFrom("101", "2")`) reaches the range check first
  and reports `unexpected-base NaN`, so that spelling is broken too.

Only the base-less form and the `0x`/`0b` prefixes work. This is independent
of the strings work — it predates it — but it was found while documenting the
conversion pair `IntegerString`/`DigitsFrom`, and it makes the pair
non-round-tripping for any base other than 10. `IntegerString(n, base)` is
correct, so only the parsing direction needs fixing.

### `StringFrom` with no `format` does not use `unicode-scalars` (found 2026-08-16)

`doc/97-reference-strings.md` documented the default format as
`unicode-scalars`, with the examples `StringFrom(128287)` → `"🔟"` and
`StringFrom([127467, 127479])` → `"🇫🇷"`. The handler instead treats a missing
format as `'default'` and returns `value.toString()`, so those two calls
produce the strings `"128287"` and `"[127467,127479]"`. The explicit
`unicode-scalars` format does produce the documented results.

The documentation has been corrected to describe the actual behavior (a
missing format means "the argument's default string representation"), so
nothing is misleading today. What is open is which of the two the operator
*should* do: "convert anything to its printable form" and "decode a
collection of code points" are different jobs, and `String(x)` already covers
the first.

### Coverage tracks

Two opt-in libraries extend coverage **without touching the core engine**:
**Rubi** (integration rules, `loadIntegrationRules(ce)`) and **Fungrim**
(identities, `loadIdentities(ce, { solve: true })`). The remaining Wester gap to
SymPy is concentrated and maps cleanly onto these, so each is a self-contained
track measured by **its own suite** — the 48-case Wester harness is a
spot-check, not the scoreboard. The two tracks are independent and should not
gate each other.

#### R. Rubi — integration coverage by chapter

**State (2026-07-12, R1–R30 + R8 landed):** the shipped bundle
(`src/compute-engine/rubi/rubi-rules-data.json`, via
`@cortex-js/compute-engine/integration-rules`) contains **Chapters 1
(Algebraic), 2 (Exponentials), 3 (Logarithms), 5 (Inverse trig), 6 (Hyperbolics),
7 (Inverse hyperbolic), 4.1 Sine, 4.3 Tangent, 4.5 Secant, and §8.8 Polylogarithm**
— 6,574 rules, 6.98 MB (CI has a bundle-freshness gate). Scores (seed 5): **4.1
Sine 107/120 and 331/400 (4.1.11 file 93/113, post-R18)**, **4.3 Tangent 72/120**,
**4.5 Secant 69/120**, **ch3 Logarithms 70/120 (post-R25 re-baseline)**,
**Chapter 5 Inverse trig: 5.1 sine 65/120, 5.2 cosine 76–78 (verify-deadline
flutter band), 5.3 tangent 64 (post-R28), 5.4 cotangent 62, 5.5 secant 56,
5.6 cosecant 52 (≥375/720 ≈ 52%; R27 +19 on 5.1/5.2 via the
poly×trig-product reduction closing the reciprocal-arcsin/arccos family;
earlier: R24 +15 via the complex-argument Erf/Erfi kernel, R23 +5 via the
InvTrig^n multiple-angle → CosIntegral reduction; 5.5/5.6 scores predate
R25–R28 re-runs)**, **Chapter 7
Inverse hyperbolic (R22): 7.1 sine 79/120, 7.2 cosine 51,
7.3 tangent 85, 7.4 cotangent 95, 7.5 secant 44, 7.6 cosecant 54 (408/720 =
56.7%, R22 +2 — ch7's hyperbolic sub-integrals were already covered by the
ungated `containsHyperbolic` fallback)**, **ch1 1.1 Binomial products 112/120
(post-R28)**, **1.1.3 General 185/200 s200 (post-R28: unsolved 6 → 1; the
survivor #259 is an integer-power rational)**, ch1 exhaustive ≈90–91%,
ch2 ≈72% effective (seed 42), **ch6 Hyperbolics 73/120 (s120 seed 5,
post-R30-reorder 2026-07-11; 0 wrongs)**,
Wester indefinite-∫ 6/8. Per-rung history (R1–R30, each rung's mechanism,
score deltas and dead ends) lives in `docs/rubi/RUBI.md` §5 and git history
— it is deliberately not repeated here.
**Genuine wrongs are 0 across all suites** — every flagged "wrong" is a documented
**verification false-wrong** (numeric ₂F₁/AppellF1
mis-grading at non-integer symbolic-exponent substitution; `√(sin²)=|sin|`;
cube-root/fractional-power branch at negative x): before believing a wrong
flag, differentiate the
antiderivative back and compare at integer substitutions. The trig routing
lives in the runtime layer (`rubi-utils.ts`/`driver.ts`): argument-aware
`deactivateTrig` (only x-free/linear/bare-monomial args inert — composite
quadratic/√-inner args stay ACTIVE for the substitution rules),
`cofunctionShift` (`sec → csc[θ+π/2]` and, since R12, `cot → −tan[θ+π/2]`,
both default-ON; the mixed-cross-pair decline gate keeps `(g·cot)^p(a+b·sin)^m`
on `unifyInertTrig`'s matched-±π/2 clauses),
`unifyInertTrig` + its cofunction product clauses, `standaloneCosineShift`,
`reciprocalToPower` (frozen under fractional powers — branch safety; since
R13 it also keeps REFLECTION-produced `csc[·+π/2]` heads raw — the +π/2
shift signature — so pure-sec binomials `(a+b·sec)^n` reach the 4.5.1
csc-binomial rules, with a `(a+b·sec²)^p`-Power exception routing 4.5.7 to
the sin/cos rules), and
five driver fallbacks (trig→exp with a numeric-evaluability self-check;
R15's rational×sin/cos(linear) → Si/Ci partial-fraction split with a
central-difference D-self-check (R18 extends it to irreducible-quadratic
denominators via `expandRationalOverComplexLinears`, splitting over
complex-conjugate linear roots → complex Si/Ci that recombine real, behind
`RUBI_NO_SICI_COMPLEX`); R16's poly×csc²/sec²(linear) by-parts;
R17's `singleAngleTrigExpFallback` — `∫P(x)·R(trig(w))` with `w` linear and an
additive `(a+b·trig)` denominator, rewritten via `y=E^{iw}` +
partial-fractions and routed through the §2.2→Ch3→§8.8 PolyLog telescope,
fail-closed D-check; native-rational). A/B env switches:
`RUBI_NO_FOUNDATION`, `RUBI_NO_RECIP`, `RUBI_NO_COFN`, `RUBI_NO_COFN_COT`,
`RUBI_NO_SKELETON`, `RUBI_NO_SICI`, `RUBI_NO_SICI_COMPLEX`, `RUBI_NO_SECBIN`,
`RUBI_NO_TRIGSQ`, `RUBI_NO_TRIGEXP`, `RUBI_NO_TRIGSUB` (R22 subproblem
trig-bridge), `RUBI_NO_R25` (R25 quartic-denominator ExpandIntegrand guard),
`RUBI_NO_R26` (R26B rational-normal-form retry in the exp-substitution
fallback), `RUBI_NO_R27` (poly×trig-product reduction fallback),
`RUBI_NO_R28` (R28a mixed-parity Laurent-numerator × binomial-radical
linearity split), `RUBI_NO_R29` (R29 algebraic-in-hyperbolic
`u = Sinh/Cosh/Tanh[v]` substitution fallback), `RUBI_NO_R30` (R30
rational-in-hyperbolic cyclotomic-factored `t = e^v` substitution fallback),
`RUBI_NO_R8` (R8 poly×single-angle-hyperbolic → single-exponential `y = e^w`
PolyLog fallback), `RUBI_NO_R31` (R31 nested-radical substitution fallback —
Lever A iterated `u = (a+b·x)^(1/k)` fractional-power-of-linear substitution
with factored-denominator presentation, Lever B `(√L₁+√L₂)^(−n)` conjugate
rationalization; closes the Bondarenko nested-radical family, CE+R/F 12 → 20/35;
structurally inert off-family via a tight `hasNestedRadicalCandidate` pre-filter,
fail-closed on a domain-aware D-check), `RUBI_NO_R32` (R32 Euler-substitution
lever "Lever C" — an Euler I substitution `t = √a·x + √Q` at a √(quadratic)-
nested radical that rationalizes `√Q` and collapses the outer radical to a
√-of-linear the existing Lever A removes; closes Bondarenko **#9**, CE+R/F
20 → 21/35; two-pass so R31 stays byte-identical, inert off-family via the
Euler branch of `hasNestedRadicalCandidate`).

**Driver-determinism residual (2026-07-18):** route selection still has
wall-clock-sensitive seams (budget-relative simplify slices
`min(remaining, 5000)`, `ce._timeRemaining` guards) — under extreme
synthetic load heavy families can still flake between solved and inert. The
principled follow-up is O(nodes) pre-filters / absolute caps on speculative
sub-routes, replacing budget-relative slicing. (Two independent budgets
trap: `loadIntegrationRules(ce, { timeLimitMs })` (default 10 s) is
independent of `ce.timeLimit` — heavy tests must raise both.)

**Benchmark protocol.** `npx tsx scripts/rubi/benchmark.ts --rubi
"data/rubi/corpus/4 Trig functions" --chapter "4 Trig functions/4.1 Sine"
--sample 120 --seed 5 --report /tmp/x.json`. Always pass `--report` (the
default path clobbers the committed baseline); `--rubi` mode preloads the
ch1/2/3/**4.1/4.3/4.5**/5/6/7/§8.8 foundation (matching the shipped bundle so it
measures the integrator as it ships — `RUBI_NO_FOUNDATION` to disable;
**pre-2026-07-04 4.1 baselines are not comparable**); run suites
**sequentially** — concurrent benchmark runs contaminate each other's
driver/verifier timing. NB: a `--rubi` target that is a Chapter-4 SUBSECTION
(e.g. `.../4 Trig functions/4.1 Sine`) resolves `corpusRoot` to the ch4 dir,
so no foundation loads and the driver-only score (58) understates the shipped
§4.1 Sine (107, `loadIntegrationRules`) — measure ch4 sections via the shipped
bundle, not `--rubi` on the subsection.

**Kernel status.** The complex-argument `ExpIntegralEi`/`SinIntegral`/
`CosIntegral`, negative-order incomplete Γ, and hyperbolic `Shi`/`Chi`
kernels are all in (mpmath-validated; see `docs/rubi/RUBI.md` §5 R18/R21 for
the branch subtleties). Remaining: hard cubic-and-higher x-denominator
Si/Ci shapes still decline cleanly (unsolved, not wrong).

**Method note (hard-won).** The "unimplemented-predicate" trace census is
*misleading* for picking levers: the late catch-all rules
(`FunctionOfTrigOfLinearQ`, `TrigSimplifyQ`) are checked on nearly every unsolved
problem and dominate the tally without being the blocker. Diagnose instead by
tallying the *actual* rule-fail/inner-condition reasons and tracing the residual
integrand; and use **`wolframscript`** to see Rubi's real chain (load Rubi, then
trace recursive `Int` calls, or probe `DeactivateTrig` directly):

```mathematica
Get["~/dev/rubi/Rubi-4.17.3.0/Rubi/Rubi.m"];
Trace[Rubi`Int[Cos[x]^4, x], HoldPattern[Rubi`Int[_, _]]]
Rubi`Private`DeactivateTrig[Cos[x]^4, x]   (* -> sin[Pi/2 + x]^4 *)
```

**Next rungs (priority order).** Each is a self-contained work item: do the
change, then verify with the benchmark command above (watch `solved-correct`
climb while genuine `wrong`/`not-evaluable` stay 0 — but see the R2 note on
hypergeometric verification false-wrongs). Diagnose any stall per the Method
note — trace the residual integrand, don't trust the predicate census.

- **Ch3 unsolved tail** (43/120 at s120 seed5, post-R20; was 45 post-R19).
  **R19 censused all 46** and found one bounded fix: `FunctionOfLog` (→ #261).
  The residual splits into **15 expected-`Unintegrable`** (Rubi itself returns
  unevaluated — CE's inert `Integrate` is the correct match, not a defect) and
  **~30 genuinely deep**. Next-rung shopping list from the census (see
  `docs/rubi/RUBI.md` §5 R19/R20 for the full family table):
  - **Biggest family: poly×log by-parts residuals** bottoming in
    `∫artanh(√)/x`, symbolic-order-`k` `PolyLog` recurrences, or
    `ArcSinh·Log` (3.1.4/3.1.5) — shapes the bundled ch5/ch7 base cases
    don't reach. A symbolic-order `PolyLog` recurrence remains the lever.
  - **6: `∫Log[Sin/Tan/Csc²]`** (3.5) — a two-part gap: an inert-trig `D`
    reduction (CE's `D` knows `Tan`, not the inert `tan` head the driver
    carries) PLUS a Chapter-4 trig-integration foundation for the by-parts
    sub-integral (only 4.1/4.3/4.5 bundled).
  - **4 (D): `∫Log[·]/rational`→`PolyLog[2]`**; **3 (E): `(a+b·Log[c(d+ex)ⁿ])^p
    × rational` half-integer residuals**; **4 (F): fractional/negative power in
    the log arg → `Gamma`/`Ei`/`LogIntegral`** with `x^(2/3)`/`e/√x`
    substitution. All need new production/kernels, not bundling.
- **R3′ — residual half-integer/elliptic chains.** #604/#609/#1395 were closed
  by R9's cosine shift, #294 by R17's exp-route telescope; what remains is the
  genuinely deep tail: #53 (23-step half-integer Fresnel chain), #248 (48
  steps), plus the composite `cot^m/(a+b·sin)^n` / `(a+b·sin²)^(p/2)`
  tan/cot-power recursions (4.1.1.3 / 4.1.7), which may fold into R5.
- **R5 — `TrigSimplify`/`TrigSimplifyQ`** (Pythagorean reductions). _Low value /
  optional:_ the predicate census over-weights it (it's a late catch-all, not a
  blocker). Only pursue if R14/R3′ leave a concrete residual class that needs
  it — one confirmed member so far: #93 (`csc^(−1/2)·sin` cancellation). A
  related deferred item from R9: a proper circular `TrigReduce`
  (multiple-angle elementary form) for `sin^n` products — the exp-form
  reduction works but verifies past the harness budget and preempts trig-form
  rules chapter-wide, so it was deliberately gated off.
- **Ch5 residual — ₚFq only.** The rung ladder closed the chapter's
  structural gaps in sequence: R22's bridge (`RUBI_NO_TRIGSUB`) closed the
  `∫f(x)·Cot[x]`-bottoming family (294 → 331), R23's `circularTrigReduce`
  closed the `∫x^m·ArcSin^n/√(1−c²x²)` (n<0) family (331 → 336), and
  **R27's `polyTrigProductReduce` closed the mixed `∫θⁿ·Sinᵐ·Cosᵏ` inner
  integrals of the reciprocal-arcsin/arccos class** (5.1 57→65, 5.2 67→78 —
  the former residual (a)). What remains: only the ₃F₂/`HypergeometricPFQ`
  terminal forms, which need a generalized ₚFq head CE lacks (out of scope).
  _(The formerly-listed "complex-Erfi evaluator" residual is stale —
  verified 2026-07-10 post-R27: the fractional-`n` family's complex-`Erfi`
  results numericize via the R24 kernel, and the sole remaining
  `not-evaluable` row in each of 5.1/5.2 (s120 seed5) is a ₚFq terminal.)_
  Ch7's analog is smaller and already covered (arsinh → hyperbolic
  fallback).

**Exponential** (Ch 2, 125 rules) and **hyperbolic** (Ch 6, 390 rules) are
bundled; the former R6/R7/R8 items all landed as rungs R25/R26/R29/R30 (see
`docs/rubi/RUBI.md` §5). The remaining Chapter-6 residual is mostly shared
capability rather than Ch6-specific:

- **R6′ tail:** the residual-degree-≥4 function-of-exp rows
  (`Sinh⁶/(a+b·Cosh²)`, `Csch⁴/(I+Sinh)²`, `Sinh⁴/(a+b·Sech²)²`,
  `Coth⁵/(a+b·Coth)`) whose symbolic quartic-or-higher residual needs a
  genuine root-finder — out of a contained rung's reach — plus 7
  expected-`Unintegrable` (Rubi itself returns unevaluated there; CE's
  inert `Integrate` is the correct match).
- **R8 follow-ups:** (1) extend the shared linear-factor partial fraction
  (`expandRationalOverLinears`) to REPEATED (`Csch²`/`Coth²` →
  `(y−1)²(y+1)²`) and COMPLEX (`Tanh` → `y²+1`) denominator roots —
  #243/#408/#455 decline structurally today, and the extension also reaches
  the analogous R17 trig rows; (2) the by-parts-only tail (rows whose
  numerator hyperbolic is itself a POWER in the additive denominator, e.g.
  `a+b·Sinh⁴`) still wants genuine by-parts machinery.
- **R29 residual:** the bare `(a+b·Sinh²)^(3/2)` even-parity shape
  (genuinely EllipticE/F), the ₚFq row #518, and the
  `√(Sinh·Tanh)`/`√(Cosh·Coth)` quarter-power oddballs (6.7.1 #560/#563).

#### F. Fungrim — solving coverage

**Decoupled from Wester.** The two remaining Wester `Solve` gaps are harness
artifacts (B9), so additional Fungrim solve rules will **not** move that number
— the Wester `Solve` rows are saturated at our principled ceiling (14/21). On
the track's own benchmark (`benchmarks/audit/solve.ts` / `REPORT-solve.md`,
40 SymPy-derived univariate cases) **CE+Fungrim is at parity — 38/40 = SymPy
= Mathematica (base CE 33) — and this track is done as a coverage effort.**
Residual, none benchmark-reachable:

- **FR1/FR3** (Dottie-style transcendental fixed points): unsolved by SymPy
  and Mathematica too — outside the closed-form ceiling, not a gap to chase.

(Fungrim's _simplify_-side work is separate again — see Strategic item 7,
Fungrim Phase 4.)

### Bignum / numeric track

The item-17 / B-series performance pass is largely complete (`ln`, `exp`, `kˣ`,
`sqrt`, `Γ` at 1000 digits now beat or match mpmath). Two deferred items remain:

- **17.12 — r-step / rectangular splitting in `fpexp`.** A real but small kernel
  win (~3×); the kernel is <10% of `exp(.N())` time, so the user-facing impact
  is low. Lowest priority.
- **17.15 — base-2 special-function kernels (`gammaln` et al.).** The deeper
  half of the `Γ`-vs-mpmath gap (still ~5–7× at 200 digits after 17.14). The
  _elementary_ kernels run on a base-2 fixed-point grid where "round to p bits"
  is a free bit-shift; the _special_ functions (`gammalnCore` + Bernoulli
  Stirling machinery, `digamma`/`trigamma`/`polygamma`, `zeta`, `beta`) still
  run at the base-10 `BigDecimal` level and pay the rounding tax. Porting is a
  substantial undertaking (argument-shift product, Bernoulli-rational series,
  reflection formula, `exp`/`ln` glue all move onto `bits`-scaled `bigint`s).
  Expected to close most of the gap; the residual ~2× is V8 `BigInt` vs GMP, not
  closable without a different bigint backend (e.g. WASM GMP). Lower priority:
  the special functions are already 130–170× faster than 0.59.0 and competitive
  for typical use — a "catch mpmath" item, not a correctness/capability gap.

### Symbolic-evaluation performance

#### P-BOX-2. Structural cost of generic boxing (noted 2026-08-10)

Not a regression — an observation left by the (closed) P-BOX
investigation, recorded in case a "make boxing 2× faster" initiative is
ever wanted: in high-resolution profiles of the box microloop, `isSubtype`
accounts for ~12 % of box time and GC for ~8 %, and both shares are
unchanged since at least 0.100.1. Type-check call volume and allocation
pressure are the structural levers; everything else in the profile is a
diffuse 1–2 % tail. (The P-BOX regression itself — R-D5 display-cache
interaction and uncached resolver-aware `parseType` — was fixed 2026-08-10;
see the CHANGELOG.)


#### P0. `.N()` over nested user-function applications is exponential (filed 2026-07-26)

**Open, unfixed, and the largest known evaluation cliff.** `.N()` on a chain of
nested user-function applications costs ~2× per nesting level, while
`evaluate()` on the same expression is flat:

```
f := x ↦ mod(5x + c, 16)        // c, s FREE
chain(d) = f(f(…f(s)…))         // d applications
```

| depth | `chain.evaluate()` | `chain.N()` |
| ----- | ------------------ | ----------- |
| 12    | 7 ms               | 1 757 ms    |
| 14    | 8 ms               | 6 390 ms    |
| 16    | 8 ms               | ~25 000 ms  |

This is **not** the discarded-`.N()` class fixed on 2026-07-25/26 (see
`constructibleValues`, `eq`, `compare`, `approxEq`, `Rationalize`,
`applyAngle` — all now gate on `.unknowns`). Nothing is numericized and thrown
away here: with every one of those gates in place, `sin(chain).N()` costs the
same as `chain.N()` alone (1 628 vs 1 757 ms at depth 12), so the whole
residual is the bare `.N()`.

**Suspected cause, not yet confirmed:** the unconditional re-box on the
symbolic-fallback path of `BoxedFunction.N()`
(`boxed-function.ts`, `this.engine.function(this._operator, tail)`), which
re-canonicalizes the subtree at every level. A related shape — exact
`sin^d(x).evaluate()`, ~1.4×/level, hangs past d ≈ 50 — may share it.

**Why it is worth fixing rather than documenting.** A consumer whose
architecture deliberately keeps document variables out of the engine scope
(Tycho) has every element symbolic by construction, so this is their default
path, not an edge case. Interim guidance given to them: prefer `evaluate()` on
deeply nested symbolic expressions and reach for `.N()` only once the free
symbols are bound.

**Do not "fix" this by gating `.N()` on `.unknowns`.** Ruled out with evidence:
partial numericization (`sin(2)+x` → `x + 0.909…`, `Sqrt(4y)` → `2sqrt(y)`,
`cos(kπ)` → `cos(3.14159…·k)`) is load-bearing and pinned by ~12 test
locations, and `addN`/`mulN`/lazy-`Map` re-dispatch on the *shape* of the
`.N()` result rather than on it being a literal. Memoization is not an
alternative either: `_value`/`_valueN` (`boxed-function.ts`) are dead fields —
the memo was removed in `0e8c11b9` to fix repeat evaluation of impure
operators — and a generation-keyed memo would be self-defeating, since
evaluating a user-lambda application bumps `_generation` twice per level.

#### P1. Differentiation performance — CLOSED, measured-unprofitable (2026-07-19)

**Do not re-attempt either lever without a new profile.** Kept rather than
deleted because a superseded 2026-06-16 write-up promised a **~5x ceiling**
that does not exist, and that number will otherwise invite this dead end to be
re-walked. Re-measured on 0.87.0 over `benchmarks/cases.json` D01-D09 (warm,
300 iters/case, baseline median 0.162 ms): dropping the final `f.evaluate()` in
`D`'s evaluate handler (`library/calculus.ts`) buys **1.36x**, not the claimed
2-3.5x, and still carries its 12-snapshot blast radius plus the
`ln(e)`-no-longer-folds regressions; deferring per-node canonicalization in
`derivative.ts` tops out at ~1.3-1.5x for a rewrite of every rule path in a
980-line file. Combined ceiling ~2x.

**The helper tax is real but is not a differentiation problem.** `.mul()` costs
33.9 us where `ce.function('Multiply', ...)` costs 2.8 us for byte-identical
output (part of the gap is genuine capability — `mul()` distributes over sums).
A clean CPU profile of `.mul()` alone puts the largest single self-time frame
at `isSubtype`, 6.7%; the cost is diffuse across the type system (~18%),
definition lookup (~6%) and numeric conversion (~6%), so closing the
34 us -> 2.8 us gap needs ~92% removed and no incremental patch reaches that.
Reducing `.mul()` cost is a **representation-level** project, not a perf item.

Traps for anyone who retries. An `isTensorProductOperand` fast path in
`sortProductOperands` (`order.ts`) measured NULL — the predicate runs 4 times
per `mul()`, ~5% of its cost — and was reverted; note the bottom type `never`
IS a subtype of `matrix`/`vector`, so it must stay off any such allowlist
(`nothing` is safe). For n-ary assembly use the n-ary `add(...xs)`/`mul(...xs)`
helpers (`arithmetic-add.ts`/`arithmetic-mul-div.ts`): a
`reduce((a, b) => a.add(b))` accumulator re-canonicalizes the growing sum every
step and pays the helper tax **quadratically** (65x at 50 terms).

#### P2. The `.unknowns` numeric gate is not universally sound (funnel LANDED 2026-07-26, scope cut in half)

`boxed-expression/numerics.ts` exports one gate in three shapes —
`numberLiteralOf()` (the literal), `numericValueOf()` (a finite real machine
`number`), and `complexValueOf()` (the `[re, im]` pair, finiteness deliberately
NOT filtered) — all of which check `.unknowns` before `.N()`. Kept here for the
rule the round discovered, which governs every future call site.

Partial numericization floats the exponents, so `.N()` resolves symbolic
identities that carry free variables and that `simplify()` cannot see:
`(4-root b / 4-root a)^2 - sqrt(b)/sqrt(a)` numericizes to `0` with `a`, `b`
unknown. Gating Rubi's `PossibleZeroQ` (`zeroQ`) on `.unknowns` therefore made
it answer "not zero" for a true zero and LOST a closed form outright
(integration-rules #544).

So the rule is: **ask which branch `undefined` lands the caller in.** The
funnel is for sites where "no numeric value" is the give-up branch. It must NOT
be applied where the site exists to probe a symbolic expression numerically —
`zeroQ` and the `PosAux` sign heuristic (`rubi/rubi-utils.ts`),
`numericMagnitude` (`symbolic/solver-utils.ts`, hence `symbolic/recurrences.ts`
which consumes it), and the rationalize-denominator gate
(`symbolic/simplify-power.ts`) each keep a bare `.N()` and say so in a comment.
At two of those the gate is not even conservative — they accept on a
non-value — so declining would have made them more permissive, not less.

**Do not cache `unknowns` for this**: the gate is 2-50x cheaper than the `.N()`
it replaces, so a `cachedValue`-keyed `_unknowns` would add invalidation
surface for no measurable win.

#### Free-variable `eq()` follow-ups (reordered to sampling-first 2026-08-03; both levers unbuilt, tracked so they aren't re-derived)

The `eq()` free-variable branch now samples before the expand+simplify proof
(commit `aa48b48e`; a Tycho witness dropped 14.6 s → 6.2 s). Two further levers
were designed and deliberately NOT built, because the reorder alone met the
need:

- **Expand+simplify memo** — for a workload where repeated comparisons
  *agree* under sampling (so the symbolic proof still runs each time), memoize
  `_expand(x).simplify()` per engine: structural-hash key, `isSame` guard,
  invalidated on `_mutationGeneration` **plus** per-free-symbol
  `_writeVersion` dependencies (the item-126/127 element-memo discipline —
  plain `_generation` churns on ephemeral loop-index writes and would never
  hit inside a drain). A bundle-patch prototype measured 14.6 s → 6.6 s on the
  same witness before the reorder superseded it.
- **Loop-invariant broadcast operand hoisting** — each broadcast element
  evaluation re-resolves invariant scalar operands to *fresh* nodes (verified:
  a WeakMap keyed on node identity got zero hits within a drain), so
  `stochasticEqual` recompiles the same tree per element. Hoisting invariant
  operands once per drain would restore node identity and enable a per-node
  compiled-evaluator cache. Only worth it if a witness shows sampling-compile
  as the hot path; per-comparison cost is currently a compile + ~50 point
  evaluations.

### Strategic

#### 7. Fungrim Phase 4 — branch-cut-safe simplify & exact pole asymptotics

The analytic-property store (`ce.functionProperties`, pole-aware `N()`), the
`Residue` operator, and the `onBranchCut` guard are in place. Two consumers of
the store are only partially built:

- **(a) Branch-cut-safe simplification — largely complete.** The logarithm
  family is guarded: `ln(a) + ln(b) → ln(ab)` (`simplify-log.ts`) and the
  `.ln()` expansions `ln(bⁿ) → n·ln(b)` / `ln(a/b)` / `ln(root)`
  (`boxed-function.ts`) consult `onBranchCut` and stay symbolic when an operand
  is provably on the negative-real cut. Power/root _products_ (`√a·√b → √(ab)`,
  `(ab)^p`) were already safe — gated on `isNonNegative` in
  `arithmetic-mul-div.ts` (see also the `foldIsSound` `(base^r)^e → base^(r·e)`
  gate). What's left is **not** store- driven: a guarded `arctan(x) + arctan(y)`
  addition would be a _new capability_ (CE doesn't combine inverse-trig today),
  and its validity region (`xy < 1`) is an arithmetic condition, not an
  `onBranchCut` cut-membership test — so the store doesn't serve it.
  Complex-domain Fungrim rules already carry their own loader guards. (The
  generic-real simplification policy for even/odd/irrational exponents is
  settled and documented in
  [`docs/SIMPLIFY.md`](./docs/SIMPLIFY.md#generic-real-simplification-policy).)

- **(c) Exact asymptotics at special-function poles — one rung remains**
  (the kernel, residue-at-∞, signed pole limits, and `Beta` pole data all
  landed; design + record in
  [`docs/plans/2026-07-10-pole-asymptotics-design.md`](./docs/plans/2026-07-10-pole-asymptotics-design.md);
  `GammaLn` is a genuine non-goal — logarithmic branch point, not
  meromorphic). Demand-paced:
  - **Sum-of-residues-in-a-region helper** — needs a pole-enumeration API
    over the analytic-property store.

**Effort:** (a) residual and the (c) rung are each small-to-medium,
self-contained items.

#### 8. Disjunctive guards (`Or`) in the assumptions system

**What:** 87 complex-domain corpus entries remain undischargeable because their
guards are `Or`-rooted (the assumptions design deliberately scoped disjunction
out — `docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md` §7 non-goals). The remaining
~43 failures are symbolic bounds (`|z| < φ−1`), which the assume-side
decomposition deliberately drops.

**Why "strategic":** disjunctive facts are a real design extension (case
splitting or watched-disjunct propagation), not an incremental patch. The guard
census (`scripts/fungrim/guard-census.json`, currently 89.6% complex-domain
dischargeable) quantifies exactly what it would buy. Let demand justify it.

#### 10. TypeScript 7 — retire the TS 6 compat alias

The TS 7 side-by-side install landed 2026-07-08 (`@typescript/native` drives
the build/typecheck; the module name `typescript` is aliased to the TS 6 API
because TS 7.0 ships no programmatic API and ts-jest/typedoc/
typescript-eslint/madge all require one; bare `npx tsc` is ambiguous — use
the explicit native-binary path). The nodenext `.js`-specifier codemod landed
the same day; **new-file convention: relative imports in `src/` use `.js`
specifiers.**

**Remaining:** drop the TS 6 compat alias once TS 7.1 ships its (new,
different) programmatic API **and** ts-jest/typedoc/typescript-eslint/madge
support it. Until then the side-by-side install is the intended end state,
not a hack. **Effort:** small once the ecosystem is ready.

### Correctness & symbolic findings (2026-07) — residue

The July 2026 correctness and symbolic reviews are fully dispositioned: every
verified P0 and P1 landed across the Wave 1–4 commits, and the **P2/P3 sweep
itself completed in the tail-phase rounds 8–10** (`72f3a353`, `f5e0e339`,
`a2b78928`, plus the P2-1 dispatch index `8667a0aa` and the benchmark
capstone `c20a4b2e`) and the follow-on round (`e65eee11` complex-type
inference, `99fa7276` D12-A exact Gaussians + parser perf, `c4def410`
non-finite typing convention). The findings docs are kept for the record —
[`CORRECTNESS_FINDINGS.md`](./CORRECTNESS_FINDINGS.md),
[`SYMBOLIC_FINDINGS.md`](./SYMBOLIC_FINDINGS.md), with the full
implementation log, the closed-as-measured-no-wins list (do not re-attempt
without new evidence), and the residual inventory in
[`docs/reviews/2026-07-findings-tracker.md`](./docs/reviews/2026-07-findings-tracker.md)
(see its "RESUME HERE" section). What remains from the reviews is that
residual tail: the item-4 filed residuals (Artanh/Arcoth-class literal
poles, `∞+i` numeric-value finiteness, the `~oo` lattice question, the
`Multiply(x, +∞)` fold positivity review), the non-blocking tracked
residuals (fu `sin⁴−cos⁴`, defint error-bar/tanh-sinh, machine `gamma()`
mid-range digits, …), and the item-5 perf levers — of which only bundle
cold-start survives: the cache-shaped levers were closed measured-unprofitable
by the 2026-07-18 P2/P3 tail (see `PERFORMANCE_FINDINGS.md`; do not
re-attempt without a new profile).

The Stage-2 corpus audit (2026-07-10, all 57 topics) surfaced three
engine/tooling items — all fixed; the full-corpus run grades **0 False**
(True 1589, seed 42). Record in the findings tracker.

Two design-level residues are deliberately carried forward:

- **D10 — `real ⊄ complex` in the type lattice.** `real` admits ±∞, so it is not
  a subtype of `complex`; the Fungrim loader carries a real-symbol guard shim and
  `box.ts` carries a `signatureHasComplexParam` skip to work around it. A lattice
  decision that made the finite reals a subtype of `complex` would retire both
  shims, but it interacts with the covering-union identities — a type-system
  design choice, not a bug fix. Left for demand to justify.
- **P1-19c — `Derivative(Sin).evaluate()` result typing.** The result type of an
  evaluated derivative of a known function is not yet tightened (documented in
  `library/calculus.ts`); it is blocked on evaluate-recursion and
  underscore-lambda LaTeX serialization, so it waits on those.

### Test-suite ledger — skips and `@fixme` markers (sweep 2026-07-18)

Deferred capability recorded directly in the test suite (beyond the Wester
ledger, B13). Each entry's acceptance test already exists:

- **Simplification gaps** — 13 `test.skip` in `simplify.test.ts`, with
  rationale mirrored as `test.todo` in `simplify-noskip.test.ts`: common
  denominator for rational expressions (`1/(x+1) − 1/x → −1/(x²+x)`);
  ln→inverse-hyperbolic recognition (six identities, e.g.
  `ln(x+√(x²+1)) → arsinh x`); inverse-trig conversion
  (`arctan(x/√(1−x²)) → arcsin x`); `factor()` extracting common factors
  from `Add` (`2π+2πe < 4π → 1+e < 2`); `(−x)^{3/4}`;
  `ln((x+1)/e^{2x})` (canonicalization expands before log rules fire); the
  Fu-paper Phase-14 multi-step trig identity.
- **Parser `@fixme` clusters** (latex-syntax tests): pre-sub/superscripts
  (`_p^qx`, `\vec{AB}` over multi-letter args — `supsub.test.ts`); chained
  `\over` mis-association (`errors.test.ts`); postfix `\degree` precedence
  (`trigonometry.test.ts`); range endpoints leaking outside `Range`
  (`n+1..n+10` — `collections.test.ts`); partial-derivative fraction forms
  `\frac{\partial^2}{\partial_{x,y}} f(x,y)` (2 skips,
  `operators.test.ts`); Set round-trip failure (serializer emits
  `\lbrace`, parser expects `\{` — `arithmetic.test.ts`); malformed
  integrand `\int\frac{3x}{5dx}` not rejected (`calculus.test.ts`);
  lowercase-arrow `Implies`/`Equivalent` expectations outdated by the
  issue-#156 `\rightarrow`→`To` change (`logic.test.ts`).
- **Numeric known-wrongs** (nightly + unit markers): bignum `Arccos` near 1
  loses ~8 digits (endpoint cancellation; per-case skip in
  `mpmath-kernels.test.ts`); `ζ(−0.5)` ~4 ulp (tolerance-relaxed); bignum
  `Complex` components truncated at canonicalization regardless of
  precision (`canonical-form.test.ts` `@fixme`); one `Multiply` inexact
  case where the big-precision path is worse than machine evaluate
  (`arithmetic.test.ts` `@fixme`).
- **Misc:** dictionary error validation (invalid/empty/extra tuple keys
  don't throw — 3 `@fixme` skips in `dictionary.test.ts`); SymPy-interop
  literal parses `0`/`0e0` (`test/math-json/sympy.test.ts`, see the interop
  stubs below); range/interval membership assumptions not wired
  (`assumptions.test.ts` `@fixme` setup lines); malformed
  positional-parameter name `_1_0` in a `Function` snapshot
  (`functions.test.ts`); the `grudnitski.test.ts` equivalence benchmark
  keeps 9 `describe.skip` groups (equation-scaling / identity-based
  `isEquivalent` capabilities).

`test/playground.ts` remains the tracker for its own residue (notation
decisions, Iverson/Boole and inequality→`Range` wishlist, matcher
internals).

### Source-marker backlog (`src/` sweep 2026-07-18)

Significant in-code `@todo`/`@fixme` not already covered by a section above:

- **SymPy interop is stubbed:** `math-json/serialize-sympy.ts` (special
  values/heads, lambdas, strings unhandled) and `math-json/parse-sympy.ts`
  (atom/attributeref/subscription/slicing/call grammar not covered). Decide
  whether this surface is worth finishing or should be retired.
- **Operator-signature type arguments:** the result-type/`at`-handler
  consistency warning in `boxed-operator-definition.ts` is disabled — needs
  generic type arguments in signatures (`Map`/`Filter` return an indexed
  collection iff the input is indexed).
- **Declared-symbol validation** deferred at `latex-syntax/parse.ts` ~2459
  (declared symbols not checked against existing symbol/function/inferred
  uses; likely belongs in canonicalization).
- **Issue #189** simplification case referenced in `simplify-rules.ts`.
- **Compile targets:** GLSL `TODO(E3-GLSL)` (needs loop unrolling or
  fixed-size arrays, `base-compiler.ts`); the public per-operator `compile`
  handler has no preamble/helper-injection hook, so GLSL/WGSL custom loops
  aren't ergonomic — extend `OperatorCompileContext` if a real need
  appears.
- **Risch algorithm** noted as the principled endpoint for
  `symbolic/antiderivative.ts` (the Rubi track is the practical lever; kept
  as a marker, not planned).
- **Fractional calculus** (`library/calculus.ts` `@todo`: Liouville–Riemann
  derivative) — unplanned, catalogued.

### Review residue (open low-priority items)

The June 2026 codebase review (REVIEW.md) is fully dispositioned; its full text
is in git history. The only items deliberately left open:

- **A14 (LOW)** — `boxed-expression/order.ts` tie-breaks: operator and string
  branches sort descending while the symbol branch and doc comment say
  ascending. Deferred because forcing ascending changes established canonical
  orderings in a debatably _worse_ direction (e.g. `-(sech x · tanh x)` instead
  of the textbook `-(tanh x · sech x)`) and churns calculus snapshots. Resolving
  it is a canonical-form design choice, not a bug fix.
- **G5 (LOW)** — `["Subscript", "a", "k"]` canonicalizes to the fused symbol
  `a_k`, severing the binding when `k` is a binder-bound index. A correct fix
  needs binder-aware canonicalization (the canonicalizer has no enclosing-binder
  scope at fusion time) — too broad for a LOW finding. Workaround: the call form
  `["a_", "k"]` (which the Fungrim corpus uses).
- **validate.ts round (2026-07-18), flagged not fixed:** the
  optional/variadic parameter loops lack the devolve fallback and
  `inferredSignature` acceptance the required-param loop has (probably
  intentional; no observed hits); `arithmetic-power.ts` ~:345 carries an
  order-dependent `matches('complex')` with its own `fix?` comment
  (narrowing to literals).
- **Transformer protected-set family (LOW) — 2026-07-23 simplify/together
  review:** nested-transformer reduction (`resolveBoundSymbols`) resolves a
  bound variable that carries a global value because the protected-name set does
  not reach the transformer handler. Three sibling manifestations, all on
  doubly-contradictory input (a solve/differentiation/integration variable that
  also has a concrete value), all silent wrong/inert answers, documented with
  repros in `docs/plans/2026-07-23-simplify-together-scoping.md` §B/C/D:
  `Solve(Simplify(s)=2, w)` with `w` value-bound and appearing in `s` → `[]`
  (§B); `∫ Simplify(x²) dx` with `x:=5` → `25x` (§C); Solve shielding computed
  before bundled `Element` specs are lifted (§D, Codex-flagged, not yet
  reproduced). The proper fix is the shared rework — thread a protected-unknown
  set through transformer-operand resolution (the `EvaluateOptions` plumbing the
  session deliberately avoided), or mirror `JacobianMatrix`'s fresh-symbol
  rename in the `Integrate`/`Limit`/`Solve` reduction paths. Deferred as
  vanishingly rare; do it if the transformer-resolution architecture is reworked.
- **`simplify()` structural-head denylist (LOW) — 2026-07-23 review:**
  `evaluateStructuralHead` (`boxed-expression/simplify.ts`) evaluates a
  whitelisted structural head (`Determinant`/`Trace`/`Transpose`/`Length`) over
  its whole operand tree, gated by a `HEAVY_COMPUTE_HEADS` **denylist** to keep
  heavy pure descendants (`D`, `Integrate`, `Sum`, …) symbolic. A denylist
  inherently leaks: benign-but-documented heads still fold during simplify —
  `simplify(Transpose([[Max(3,5)]]))` → `[[5]]` though `docs/SIMPLIFY.md` says
  `Max`/`Min` stay evaluation-only, and `Inverse` (real matrix compute) folds
  too. Low harm (over-evaluation is the pre-fix behavior, value-preserving). The
  complete fix is head-specific structural reduction over held operands (no
  operand `.evaluate()`); the cheap mitigation is adding `Max`/`Min`/`Inverse`
  to the denylist to honor the documented contract.

- **List-valued big-op bodies on non-JS targets (2026-08-12, Tycho item 171
  residue), FIXED 2026-08-12 (same day):** measured first — GLSL/WGSL emitted
  shader source that does not even compile (a `vec2` sum returned from a
  `float` function) behind `success: true`; Python and interval-js declined,
  but for incidental unrelated reasons. Fixed with a third clause in
  `assertScalarBigOpBody` (`base-compiler.ts`), not a per-target arm: it
  fires only when (1) the body's type is one an item-121 exemption is
  admitting (`broadcastable<T>` or a top type) AND (2) the body look-through
  gives POSITIVE evidence — the operator names a user function whose
  `Function`-literal body's type matches `collection`. The ruled exemptions
  are untouched (positive collection evidence was never exempted), and JS is
  byte-identical because its `isElementwiseBigOpBody` gate is strictly wider
  and diverts these bodies before the assert. Pins in
  `list-valued-summand-compile.test.ts` (per-target declines with the
  actionable D6 message, exemption survival on all five targets). Residues,
  deliberately untouched: a LYING declaration (`-> number` head over a
  `List`-constructing body) keeps its current path on every target,
  including the broken GPU emission — declining it would change JS, a
  different defect; and the JS comparison-gate side effect (`a(h(i)) < y`)
  still has no dedicated pin.

- **`_broadcastCount` leaked onto non-broadcast operators (2026-08-12, found
  at the item-169 broadcast-enumerability ruling), FIXED 2026-08-12:** the
  item-167 broadcast `count` (participants' agreed length) had no
  `operatorDefinition.broadcastable` gate, so any bound, handler-less,
  collection-typed operator with collection operands answered its OPERAND's
  length — `Chunk([1,2,3], 2).count` was 3 (true count: 2); `GroupBy`/
  `BinCounts`/`Histogram` are the same reshaping class. The leak was
  accidentally CORRECT for length-preserving ops (`Sort`, `RandomShuffle`
  both answered 3 through it), so a blanket gate alone would have regressed
  those. Fixed in two parts: `_broadcastCount` is now gated on
  `broadcastable === true` (agreement is the length rule for a LIFTING
  operator only), and a new optional operator-definition handler
  `elementCount` — the `count` twin of `canEnumerate`, same dispatch level,
  consulted by `count` after a declared `collection.count` — lets an operator
  that knows its own length say so without evaluating. Adopted:
  `Sort`/`Ordering`/`RandomShuffle` (`elementCountOfFiniteSource`,
  length-preserving over a definitively finite `op1`, zero draws) and `Chunk`
  (exactly `k` groups for a literal positive `k` — NOT `ceil(count/k)`;
  `Chunk([1,2,3], 5)` yields 5 groups, two empty). Pinned by
  `test/compute-engine/tycho-item-167-broadcast-count.test.ts`. The
  `isEnumerableCollection` broadcast tier was already gated on
  `broadcastable === true` and never inherited the leak.
  - Residue: every other reshaping/eager operator now reports an honest
    `undefined` instead of a wrong number (`GroupBy`, `BinCounts`,
    `Histogram`, `Tally`, `Unique`, `Flatten`, `Shape`, `Quartiles`,
    `RandomChoice`, `RandomSample`, `LinearRegression`, `PolynomialFit`, …),
    as do the count-preserving pass-throughs that were right by accident
    (`N`, `Evaluate`, `Identity`, `Typed`, `Matrix`, `Transpose`, …). Each is
    an `elementCount` handler away from answering again; adopt on demand,
    never as a name list in engine code.
  - Residue: whether `Prime` (and other type-handler-lifting operators)
    should carry the `broadcastable` definition flag is undecided. Today is
    consistent (`Prime([1,2,3]).count` and its `evaluate().count` are both
    `undefined`), so nothing is wrong — but the flag would give such
    operators the broadcast count AND the `isEnumerableCollection` broadcast
    tier. Deciding needs a sweep of every flag consumer (canonicalization,
    compile gates, the facet), for the whole class at once, not per operator.

- **Statement-list operands are not round-trip-safe in the DEFAULT function
  serializer (2026-08-12, found at the item-172 Loop fix), FIXED 2026-08-12
  (same day):** the item-172 mechanism (a `Block` operand serializes as a
  bare `;`-list that binds looser than the surrounding syntax) —
  `["Repeat", ["Block", …], 3]` reparsed with the block swallowing the `3`,
  a VALUE-CHANGING round trip. Fixed in `Serializer.wrapArguments()`
  (serializer.ts), the single join point behind both the generic
  `\mathrm{Op}(…)` fallback and the ~30 dedicated `\operatorname` entries
  that reuse it: a `Block` operand is fenced `\left(…\right)`, same
  mechanism as the item-172 comprehension/Loop fixes. Blast radius
  measured: ZERO snapshot churn across 59 serialization-heavy suites
  (1,813 snapshots). `Block` is the only dictionary serializer emitting a
  bare `;`-list; other loose shapes (`Delimiter(Sequence)`, `If`, `Assign`,
  `Comprehension`) were probed and already round-trip. Pins in
  `serialize-for.test.ts` (witness + first/middle/last operand positions +
  unfenced control). Three adjacent gaps, all RULED 2026-08-12:
  - Typed `Declare` (annotation dropped on reparse:
    `["Declare","s","'number'"]` comes back untyped) and the vanishing
    leading `Declare` in an outer `Block` — RULED DEMAND-GATED ("wait for
    a real need"): LaTeX has no spelling for a type annotation, no
    consumer round-trips typed declarations through LaTeX today (Tycho
    emits untyped ones), and the first real consumer's usage should pick
    the notation. Re-open when one appears; until then the drop is silent
    — the accepted cost of not guessing a notation.
  - A SINGLE-statement `Block` losing its scope wrapper on reparse —
    RULED AND FIXED 2026-08-12: spelled with a trailing semicolon,
    `(s\coloneq2;)` (braces are unavailable — `\left\lbrace…\right\rbrace`
    is `Set(…)`, measured). Serializer emits the trailing `;` when exactly
    one statement is EMITTED (`Declare`s emit nothing, so
    `Block(Declare s, Assign s 2)` counts as one and round-trips exactly);
    the `;` parser drops the vestigial trailing `Nothing` (value was
    `Nothing` instead of 2) and promotes a one-element trailing-marker
    sequence to `Block` (without that, `Block(s+1)` would have regressed
    to a 1-tuple). Multi-statement blocks byte-identical; one deliberate
    inline-snapshot edit (`sequences.test.ts`, `;;a;` loses its trailing
    `Nothing`); scope-leak pin in `serialize-for.test.ts`.

- **Two more value-changing LaTeX round trips, found 2026-08-12 at the
  single-statement-Block fix — both RULED same day, fixes in flight:**
  - A multi-statement `Block` with NO `Assign` reparsing as a `Tuple` —
    RULED AND FIXED 2026-08-12: spelled as a ONE-COLUMN `cases`
    environment (user's design) — `\begin{cases}s+1\\s+2\end{cases}` —
    core amsmath, renders everywhere, cleanly separable from piecewise:
    `Which` always serializes TWO columns (otherwise = `& \top`), mixed
    rows (any `&`) stay `Which` (the bare-otherwise-row idiom included),
    the system-of-equations branch keeps precedence, and the only
    repurposed reading is the ≥2-row all-single-column class, which
    previously parsed as a DEAD-BRANCH `Which` (rows 2+ unreachable).
    Single-row cases, trailing-`;`, and with-`Assign` `;`-list spellings
    byte-identical; nested cases (a `Which` inside a `Block`) round-trip;
    the `\left(…\right)` operand fences are cosmetically redundant around
    an environment but harmless (measured). The trailing-`;` promotion
    alternative was REJECTED: it would flip `(1;2;)` from `Tuple(1,2)` to
    a block. Pins in `block-cases-roundtrip.test.ts`.
  - All-equation Block — RULED AND FIXED 2026-08-12: a `Block` whose
    emitted statements are ≥2, contain no `Assign`, and are ALL
    equations/inequalities serializes as explicit
    `\operatorname{Block}(x=1, y=2)` (parses via the default function
    parser; round-trips at every position). The diversion predicate is
    the exact dual of the cases parser's system-of-equations test (same
    `isEquationOperator`/`isInequalityOperator` helpers), so the two
    cannot drift; the Solve convention is byte-identical. The
    self-delimiting fence test gained a paren-depth match for the call
    spelling AND an environment-depth walk for the cases spelling (a
    `;`-list starting and ending with environments fooled the old
    prefix/suffix test — reproduced, fixed, pinned).
  - `Element(i, List(1,2))` reparsing as `Element(i, Interval(1,2))` —
    RULED AND FIXED 2026-08-12: the membership serializers (the
    `Element`/`NotElement` family in `definitions-sets.ts` AND the big-op
    subscript emitter `serializeIndexingSet` in
    `definitions-arithmetic.ts` — a second, independent `\in` emitter)
    spell exactly the 2-element-list domain as `\operatorname{List}(1,2)`.
    A parse-side companion was REQUIRED: `parsedIntervalOperand()`
    converted ANY top-level 2-element List to an Interval, including one
    parsed from an explicitly named `\operatorname{List}` head — the
    interval re-reading is now gated on the operand actually opening with
    a bracket token. Authored bracket spellings keep their interval
    reading. Pins in `tycho-items-93-94.test.ts`.
  - RESIDUE of the same collision — FIXED 2026-08-12 (same day): all
    seven interval-converting set operators (`Union`, `Intersection`,
    `SetMinus`, the `Subset`/`Superset` families, plus the hand-written
    `\ni` and `\not\subseteq` parselets) now round-trip a 2-element list
    on both sides and nested. The lhs gate uses a NEW parser hook,
    `Parser.operandStartIndex`, published from the infix loop beside the
    existing `operandDiagnosticCheckpoint` (the `\mapsto` precedent for
    "an infix parselet needs facts about an already-parsed operand");
    the bracket-token probe (`atAmbiguousOpenDelimiter`) now serves both
    sides, and the `sides:'both'` unconditional-conversion short-circuit
    is gone. Serializer: `\operatorname{List}(…)` for 2-element lists in
    ALL set-operator positions. ALSO REPAIRED, same change: the
    membership fix earlier today had silently flipped
    `\mathopen\lbrack a,b\mathclose\rbrack` from Interval to List on the
    `\in` rhs (`\mathopen` was missing from `DELIMITER_SIZE_PREFIXES`) —
    caught by A/B measurement, fixed, pinned. Authored bracket spellings
    keep the interval reading everywhere. Pins in
    `tycho-items-93-94.test.ts`; the deliberate current-state pin ("a
    union of two-element lists") was flipped as designed.
  - Adjacent: `SymmetricDifference` (`\triangle`) — FIXED 2026-08-12 at
    the review round: it now has explicit parse/serialize handlers
    matching its siblings (bracket-gated interval reading both sides,
    `\operatorname{List}` spelling for 2-element lists). Note the earlier
    "round-trips for NO shape" characterization was measured FALSE (the
    default infix paths were mutually consistent); the real defect was
    operand-reading asymmetry with the other set operators.

- **Compiled assignment to an OUTER binding — RESOLVED 2026-08-12 by the
  `assignLValue` fix above; the standing product question is now
  narrower.** The witness (`w` declared outside;
  `Block(Assign(w, 2t), Add(w, 1))`, `run({t:4, w:0})`) now answers 9,
  matching the interpreter: compiled writes go through the vars object
  (`_.w = …`) exactly where reads already resolve there — the vars object
  IS the compiled analogue of the interpreter's outer scope, and the
  interpreter demonstrably writes that binding. Where no coherent write
  target exists (reads bake a folded assigned value or a constant), the
  compile DECLINES. SETTLED UNDER STANDING DOCTRINE (2026-08-12):
  compiled and interpreted behavior must agree — the same principle that
  ruled the multi-clause dispatch divergence. The interpreter writes the
  outer binding, so compiled code writing the vars object is the agreeing
  behavior; declining would have created a NEW divergence. Escape hatch
  documented: if mutating caller-supplied vars objects ever proves
  unacceptable in the field, narrowing to decline-all-outer-writes is a
  three-line change to `assignLValue`. RESIDUE, same mechanism, fix
  queued: the protocol property rebind (base-compiler.ts ~1985) still
  emits the bare-identifier write for a non-hoisted outer receiver —
  route it through `assignLValue`; deferred one session only because the
  protocol subsystem carries active concurrent WIP today.

- **Multi-clause dispatch divergence on a non-integer argument — RULED
  AND FIXED 2026-08-12 (audit-first, per user ruling):** with clauses
  `t: integer` / `t: real`, interpreted `a(0.3)` stayed INERT while the
  compiled dispatcher selected the `real` clause. The design-record audit
  (function-polymorphism design §4.4/§4.1/§8, the WRITE-FREE ruling's
  actual scope, and the NaN carve-out precedent whose test comment states
  "a fully-known value never keeps dispatch inert") found no letter-level
  ruling but every weight pointing one way: fully-known arguments must be
  DECIDED, and §8 makes compiled/interpreted agreement an obligation.
  Fixed in `admissionOf` (value-membership.ts): a concrete value now
  consults the membership oracle (`accepts`) for admission AND refutation
  regardless of `hasValueComponent` — the old fast-bail was sound for
  admission only. The NaN carve-out is subsumed (no longer a named case).
  Symbolic operands stay undecidable/inert (the design's protected case,
  pinned); selection stays write-free; compiled dispatch untouched.
  Residue worth watching, no witness yet: concrete non-numeric values
  (a `Tuple` against a nominal-reference clause) now refute where they
  previously blocked — oracle-consistent by construction, untested in
  the wild.
  - Follow-up 2026-08-12 (review round 2): a cycle guard was added to
    `accepts`'s structural-alias unfolding (a non-progressing alias cycle
    — `type a = a | 0` — overflowed the stack from dispatch; the
    value-component-carrying shape already overflowed pre-change via
    `typeAcceptsValue`). Guard keys on the alias+value-identity PAIR
    (`beginUnfoldAgainst` discipline) so progressing recursive values
    still admit; the cut answers `refute`, exact under the
    least-fixed-point reading. Two residues flagged with mechanism, no
    witness constructed: `accepts` (like `valueComponent`) reads `t.def`
    directly instead of `aliasDefinitionAt(t)`, so a PARAMETERIZED
    structural alias unfolds without substituting its type arguments — a
    pre-existing divergence from `subtype.ts`, wrong-verdict-capable if a
    parameterized alias with a value component reaches dispatch; and a
    self-negating alias (`type n = !n`) has no fixed point, so the
    guard's cut there is arbitrary-but-terminating (parser may not even
    accept the shape).

- **`compileToSource()` and `compileShader()` splice statement blocks into
  expression positions — RESOLVED FAIL-CLOSED under standing doctrine,
  GPU routes FIXED 2026-08-12:** both GPU routes now throw (their
  measured error convention) on any body that lowers to a statement
  sequence or bare `return`, with a message pointing statement bodies at
  `compile()`; expression bodies byte-identical; the shader `stmts`
  hoisting path (loop-form `Sum`/`Product` in shader bodies) preserved.
  Note `compileToSource` also now declines loop-form `Sum`/`Product`
  (previously returned a multi-line block from an expression-contract
  route — same class, was never pinned). Residues in flight same day:
  the identical hole in `PythonTarget.compileToSource` (incl. the same
  `return return` doubling; blast-radius measurement against its positive
  pins first), and the WGSL-only single-line case (`Assign` is a
  statement in WGSL, an expression in GLSL — needs a structural check,
  not a token scan).

- **A raw-MathJSON `Loop` inside a compiled function body ran to
  `undefined` behind `success: true` — FIXED 2026-08-12 (same day), and
  the `Loop` was a RED HERRING:** the real defect was an `Assign`-emission
  asymmetry — writes hard-coded the bare identifier while reads resolve
  through `target.var()` (`_.name` on JS) — triggered by any bare-assigned
  name the enclosing scope already binds. The witness's `s` is
  library-predeclared (`e`/`i`/`m`/`s` exist on a fresh engine), so it was
  never hoisted as a block-local; the write created a stray global and
  every read saw `_.s === undefined`. Minimal reproducer, no loop:
  `Block(Assign(s,0), Add(s,1))` → NaN vs interpreter 1. Fixed by routing
  the `Assign` LHS through a shared `assignLValue` helper: bare write for
  true locals (unchanged); `_.name` write when reads resolve there; a
  documented DECLINE when reads bake a folded value or a constant (no
  coherent write target). GLSL/WGSL/Python byte-identical. This also
  RESOLVED the separately-filed "compiled assignment to an outer binding is
  write-lost" defect by mechanism, not by fiat: the shared helper is what
  gives an outer-binding write a coherent target, so both symptoms had one
  cause.

- **Degenerate big-op round (2026-08-03), flagged not fixed:**
  - `sameSyntactic` (`boxed-expression/compare.ts`) is mis-named: despite its
    "compares symbols by NAME, ignoring bindings" doc, the symbol-vs-non-symbol
    branch of `same()` dereferences `sym.value` unconditionally — the
    `syntactic` flag is threaded through but never consulted there. Latent
    surprise for rule-matching callers (this is why the degenerate-bounds fold
    needed its own `sameBoundStructure()`). Fix = honor the flag in that
    branch, or rename and document; audit callers either way.
  - Dependent multi-index big-op bounds don't evaluate:
    `Sum(j, Limits(i,5,5), Limits(j,i,10))` canonicalizes intact (the vacuity
    fix keeps `i`'s set) but stays symbolic — `classifyBigopDomain` reads the
    symbolic lower bound `i` as non-enumerable. Enumerating would need
    per-iteration re-resolution of dependent bounds in the multi-set walk.
  - Collection-valued body of a degenerate big-op is a semantic fork:
    `Σ_{i=a}^{a} L` (L a collection, index unused) routes through the
    pre-existing arity-1 rewrite `Reduce(L, 'Add', 0)` — it sums L's
    elements — where the one-point fold would yield `L` itself (one term, that
    term being the list). Decide which reading is intended before touching it;
    the current behavior predates the fold and is deliberately preserved.

**Lessons worth keeping in mind** (the durable ones are in CLAUDE.md): the
`undefined → false` collapse in three-valued predicates was the single most
recurring bug class (A3, G3, the sets/Union/Range contains family, NaN
comparisons); validation-by-corpus (the Fungrim harness) found 15 engine bugs
that targeted review missed — keep running it.
