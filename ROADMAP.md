# Compute Engine — Roadmap

**Last updated:** 2026-07-27.

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

**0.96.0 released 2026-07-26** (latest). It carried the **symbol-identity
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
- **`Quartiles` throws a `TypeError` on a symbolic operand**
  (pre-existing, found 2026-08-11 during the `canEnumerate` sweep):
  `Quartiles(z)` for a valueless `number`-typed `z` crashes in
  `bigMedian` (`numerics/statistics.ts:38`, via `bigQuartiles` ←
  `library/statistics.ts`) instead of staying inert;
  `InterquartileRange` shares `bigQuartiles`/`exactData` and is likely
  affected identically. Also blocks its `canEnumerate` adoption (no
  tier is honest while evaluation can throw). Fix = a ground-data
  guard at the `exactData` seam.
- **`ListFrom(xs)` over a VALUELESS collection-typed symbol wraps the
  symbol as a scalar** (pre-existing, surfaced 2026-08-11): the
  handler's `if (!xs.isCollection)` branch reads a valueless
  `list<integer>` symbol as a scalar and answers `["xs"]` — a
  one-element list containing the symbol — where every sibling
  operator stays inert. Same `isCollection`-as-enumerability
  misreading the facet round fixed elsewhere; needs its own ruling
  (inert, or keep the scalar reading?). `SetFrom`/`TupleFrom` share
  the branch.
- **An eager IMPURE collection source is evaluated several times**
  (pre-existing, measured 2026-08-09 during the above): counting
  handler invocations over a 5-element source,
  `Map(RandomShuffle(xs), f)` evaluates the shuffle **8** times,
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
  statically real, so `Map([3+4i], Abs)` (and `x ↦ Abs(x)` over the same
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
  it). Consequence: `Map(xs, D)` keeps the old runtime-throw behavior. A
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
  blocks eligibility — two identical `Map(xs, f)` with a pure user `f`
  merge; a drawing `f` stays un-merged (draw streams and call counts
  preserved). The measured pass that gated the root flip: admission is
  inert on user-fn-free trees; per-callee validation ≈ 0.02 ms, memoized
  per name per harvest; staleness is handled by per-level re-derivation
  against current bindings at harvest time (post-compile reassignment is
  the compile-wide artifact-snapshot policy). Callbacks naming BUILT-IN
  operators (`Map(xs, Sin)`, `CountIf(xs, IsPrime)`) landed the same day:
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
  nodes — interpreter parity, not a splice. An impure VECTOR-shaped chain
  endpoint alongside an impure middle now declines (was: compiled with the
  wrong draw order) — correct D6, tiny surface reduction. B1 short-circuit
  nuance RESOLVED by probe (2026-08-02): the interpreter EAGERLY draws even
  a short-circuited chain operand (`Less(5, 1, Random())` consumes a draw),
  so the unconditional hoist at index ≥ 2 is exact interpreter parity — no
  decline needed, do not re-litigate.
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

### Complex values in compiled scalar comparisons (deferred 2026-07-22)

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

**Do not re-attempt either lever without a new profile.** Both were re-measured
on 0.87.0 and neither pays. The section is kept — rather than deleted — because
the superseded 2026-06-16 write-up promised a **~5× ceiling** that does not
exist, and that number will otherwise invite this dead end to be re-walked.

**What the 2026-06-16 profile said, and what is actually true.** Re-measured on
the same 9 benchmark cases (`benchmarks/cases.json` D01–D09), same path
(`ce.box(['D', f, 'x']).evaluate()`, warm, 300 iters/case; baseline median
**0.162 ms**, consistent with the 0.17 ms the cross-library benchmark reports):

| cost center          | 2026-06-16 | measured 2026-07-19 |
| -------------------- | ---------- | ------------------- |
| final `f.evaluate()` | ~60%       | **~27%**            |
| `differentiate()`    | ~20%       | **~44%**            |
| box/bind/alloc       | ~20%       | ~29%                |

The evaluate share collapsed. The likely cause is the
**2026-07-19 evaluate-handler contract fix** (non-lazy handlers now trust
pre-evaluated operands instead of re-descending them — see the interpreter-perf
item above): it already harvested most of what "drop the redundant final
evaluate" was written to claim.

- **Lever A — drop the final `f.evaluate()`** (`library/calculus.ts`, the
  `return f?.evaluate()` at the end of the `D` evaluate handler; the old "~213"
  line reference was stale): measures **1.36×** (0.162 → 0.119 ms), not the
  ~2–3.5× claimed. Still carries its documented 12-snapshot blast radius and the
  `ln(e)`-no-longer-folds regressions. **Not worth a semantic change to `D`.**
- **Lever B — defer per-node canonicalization** in `derivative.ts`: unchanged in
  principle (the helper tax is real — see below), but with `differentiate()` at
  44% of the call, its ceiling is ~1.3–1.5× for a rewrite of every rule path in
  a 980-line file. It also optimizes _around_ `.mul()` rather than fixing it,
  leaving every other `.mul()` caller slow.
- **Combined ceiling is ~2×, not ~5×.** The 2026-06-16 conclusion — that the
  residual is intrinsic to the boxed/bound representation and not closable by
  deferral — still holds and is now the whole story.

**The helper tax is real but is not a differentiation problem.** `derivative.ts`
builds every node through `.mul()/.add()/.div()/.pow()/.neg()`, and those
helpers are genuinely expensive (measured over 400 distinct operand pairs, so
not a memoization artifact):

| construction                        | `.mul()` | `ce.function('Multiply', …)` |
| ----------------------------------- | -------- | ---------------------------- |
| `sin(nx) · xⁿ` (byte-identical out) | 33.9 µs  | 2.8 µs                       |
| symbol · number                     | 14.8 µs  | 2.1 µs                       |
| `.div()`                            | 17.4 µs  | 5.3 µs                       |

Some of the gap is real capability (`mul()` distributes over sums — `2·(x+1)` →
`2x+2` where canonical `Multiply` gives `2(x+1)`), but for non-sum operands the
outputs are identical and the cost is not. **This is engine-wide, not specific
to `D`.**

**Corollaries measured 2026-07-26** (canonicalization-deferral audit): (1) For
n-ary assembly, use the n-ary `add(...xs)`/`mul(...xs)` helpers
(`arithmetic-add.ts`/`arithmetic-mul-div.ts`) — same semantics as chained
`.add()`/`.mul()` (like-term collection, distribution) in one pass. A
`reduce((a, b) => a.add(b))` accumulator pays the helper tax **quadratically**
(65× at 50 terms): the growing sum is re-canonicalized every step
(tensor-fields `addn` fixed this way; remaining small-N accumulator sites are
catalogued in the audit memory, the rubi ones deliberately left — their result
shapes depend on stepwise `mul()` distribution). (2) The lever that *did* pay,
orthogonal to the two measured-unprofitable deferral levers above: `subs()` and
`map()` now skip the rebuild entirely when no operand changed and the node is
already in the requested form (up to ~200× on substitutions that touch little
of the tree; ~1× when most nodes change, so no regression). Deferral of
per-part canonicalization during build-up remains a ~1.7× constant — parts are
consumed as-is by a canonical parent, never re-canonicalized — consistent with
the Lever B ceiling.

**Attempted and reverted (2026-07-19): `isTensorProductOperand` fast path.**
`sortProductOperands` (`order.ts`) maps that predicate — two `type.matches()`
walks per operand — over every product, to decide whether ≥2 operands are
tensors. A conservative scalar-primitive early-out measured **null** (mul 34.6
vs 33.9 µs; diff median within noise): the predicate runs only **4 times per
`mul()`**, ≈5% of its cost. Reverted — it is not worth a correctness-sensitive
early-out around the P0-26 non-commutativity guard for no gain. (Trap for anyone
who retries: the bottom type `never` **is** a subtype of `matrix`/`vector`, so it
must stay off any such allowlist; `nothing` is safe.)

**Why `.mul()` has no cheap fix: the cost is diffuse.** A clean long-run CPU
profile of `.mul()` alone (tsx startup amortized out) puts the largest single
self-time frame at `isSubtype`, **6.7%**. Clusters: type system
(`isSubtype`/`matches`/`get type`/`isPrimitiveSubtype`) ≈ 18%, definition lookup
(`lookup`/`lookupApplicable`) ≈ 6%, numeric conversion
(`ExactNumericValue`/`toNumericValue`) ≈ 6%, `mul` itself 5.2%, `Product` 1.7%,
`sortProductOperands` 1.4%. Closing the 34 µs → 2.8 µs gap needs ~92% removed;
no incremental patch reaches that. Reducing `.mul()` cost is a
**representation-level** project (the same per-node type-query/binding tax the
2026-07-21 tensor unification addressed for collection values), not a perf
item. Recorded here so it is not mistaken for a contained optimization.

#### P2. Funnel the open-coded "numeric value or nothing" idiom — LANDED 2026-07-26, with the scope cut in half

`boxed-expression/numerics.ts` now exports one gate in three shapes:
`numberLiteralOf()` (the literal, for callers that need the exact
representation), `numericValueOf()` (a finite real machine `number`), and
`complexValueOf()` (the `[re, im]` pair, finiteness deliberately **not**
filtered — `numericMagnitude` needs `∞` to stay `∞`, since callers spell the
reject as `magnitude > tolerance`, which `NaN` silently passes). All three check
`.unknowns` before `.N()`. Converted: `library/utils.ts` (both accelerated
infinite series), `symbolic/interpret.ts`, `symbolic/simplify-power.ts`
(`denestSqrt3` only), `boxed-expression/utils.ts` (`getPiTerm`, gate spelled out
— `numerics` imports `utils`, so the edge cannot be reversed),
`library/statistics.ts`, `nonlinear-fit.ts`. Full suite green, **0 of 4179
snapshots changed**. Tests: `test/compute-engine/numeric-value-of.test.ts`.

**The finding that halved the scope: the `.unknowns` gate is not universally
sound, and "constant-factor waste" was the wrong diagnosis for `rubi/` and
`solver-utils`.** Partial numericization floats the exponents, so `.N()`
resolves symbolic identities that carry free variables and that `simplify()`
cannot see:

```
(⁴√b / ⁴√a)² − √b / √a     →  .N()  →  0        (unknowns: a, b)
```

Gating Rubi's `PossibleZeroQ` (`zeroQ`) on `.unknowns` therefore made it answer
"not zero" for a true zero and **lost a closed form outright** —
integration-rules #544, the R28a mixed-parity poly-numerator × binomial-radical
split. Bisected to that single predicate; the rest of the rubi conversion was
inert.

So the rule for any future call site is: **ask which branch `undefined` lands
the caller in.** The funnel is for sites where "no numeric value" is the
give-up branch. It must not be applied where the site exists to *probe a
symbolic expression numerically* — those keep a bare `.N()` and now say so in a
comment: `zeroQ` and the `PosAux` sign heuristic (`rubi/rubi-utils.ts`),
`numericMagnitude` (`symbolic/solver-utils.ts`, hence `symbolic/recurrences.ts`
which consumes it), and the rationalize-denominator safety gate
(`symbolic/simplify-power.ts`). Note that at two of those the gate is not even
conservative — `numericMagnitude(diff) > 1e-9` and the rationalize gate both
*accept* on a non-value, so declining would have made them more permissive, not
less.

**Do not cache `unknowns` for this** (the 2026-07-26 measurement retires that
sub-item). The gate is 2–50× cheaper than the `.N()` it replaces — 0.042 µs on
a literal, 0.28 µs on a small exact sum, 1.2 µs on `sin(2)+cos(3)√5−7/11+e²`,
against 0.12 / 12.7 / 63.0 µs for the corresponding `.N().re`. Worst case (a
bare literal, where the gate never fires) is ~35% of a very cheap call; on
anything symbolic it is noise. A `cachedValue`-keyed `_unknowns` would add
invalidation surface for no measurable win.

One deliberate semantic tightening rode along, in
`bodyReproducesSamples` (`symbolic/interpret.ts`): the open-coded form compared
`NaN > tol`, which is `false`, so a sample that did not numericize counted as
*reproduced* — it could vouch for a closed form it never checked. It now
returns `false`. Unreachable in practice (`Interpret`'s samples are numeric
data), and the suite is green either way.

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
