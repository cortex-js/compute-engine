# Compute Engine — Roadmap

**Last updated:** 2026-09-04.

This document tracks **remaining** work; an item leaves this file once it lands.
Detail on completed work lives in git history, `CHANGELOG.md`, the linked source
files, and `docs/rubi/RUBI.md` / `docs/fungrim/`.

That rule had drifted, and was applied again on 2026-08-20 in two passes: 44
whole entries whose HEADING said FIXED, RESOLVED, REFUTED or DELETED, and then
22 individual bullets struck through as done inside entries that are otherwise
open. Everything removed is recoverable from git history, and each landed change
is described in `CHANGELOG.md`.

Two conventions follow from that, both worth keeping:

- An entry whose heading says it is done belongs in neither this file nor a
  follow-up entry. If part of it is still open, the open part gets its OWN entry
  stating what remains — the way the cross-term CSE note below does.
- Inside a still-open entry, strike through a bullet (`~~…~~`) when it lands,
  and delete it at the next pass. Keep a landed bullet only while a sibling OPEN
  bullet needs it to make sense; say so in the surviving bullet rather than
  relying on the reader to look upward, since the landed one will go.

## Current state

The 2026-06 release shipped:

- the Fungrim-derived identities library
  (`@cortex-js/compute-engine/identities`, 1,450 rules incl. 10 solve
  templates), the complex-domain assumptions extension, the operator-indexed
  rule dispatcher with purpose tags, `ce.solveRules`/`ce.harmonizationRules`,
  and exact `Zeta`;
- the Rubi rule driver as an opt-in entry point
  (`@cortex-js/compute-engine/integration-rules`, `loadIntegrationRules(ce)`),
  consulted by `Integrate` before the built-in antiderivative;
- a large symbolic-capability expansion — symbolic/improper integration,
  symbolic limits, expanded `Solve`, polynomial `Factor`/`GCD`/`Resultant`,
  multivariate GCD (Brown) — surfaced by the cross-library benchmark (items
  B1–B13);
- a substantial bignum/numeric performance pass (item 17): base-2 internal
  kernels, AGM `ln`, faster `sqrt`/`Gamma`, on-demand π and γ.

**MathNet parser hardening (2026-07-04):** all four tiers of the campaign
summarized in `docs/mathnet/README.md` landed and are test-locked
(`ContinuationPlaceholder` crash, ellipsis/trailing-punctuation recovery,
Unicode relation tokens, congruence/divisibility, geometry heads; corpus
clean-parse 3/345 → 278/345, throws 9 → 0). Fresh unseen-sample validation
measured 97.4% clean parse with 0 throws/0 hangs; the remaining MathNet work is
a small notation tail tracked below.

**0.110.0 released 2026-08-15** (latest). The 0.97–0.110 line carried the
Tycho-compatibility rounds through items 177–190 (the canonicalization-time
facet-probe storm and its document-context survivor, the `Add` collection-view
nesting fix, `broadcastable` divide admission, opt-in `complexPromotion`),
compile-time constant folding on a deterministic cost estimate, named-argument
calls, protocols with compiled dispatch, mutable objects phases 0–1, the
`unknown`-as-placeholder ruling, the default-`!scope` ceiling, and the Epsil
parameter-shadowing repair. **0.96.0** (2026-07-26) carried the
**symbol-identity repair** — a stored value's free symbols now denote the
binding they were canonicalized against, not whatever an inner scope calls that
name, with dereference (`evaluateInOwnBindings`), named-parameter rebind, and
the sanctioned **binder mechanism** (binding sites declared by a `scoped:`
selector; see `docs/SCOPING-MODEL.md`) — plus all-branch union assignability,
the peaked-quadrature and non-finite-integrand fixes, and deletion of the 0.95.0
random-family tombstones. The 0.91–0.95 line carried `FindFit`/`FindRoot` (Tycho
item 77), the `Nothing`-erasure/`Missing` marker work, overload sets, the
**Random family redesign** (`WithRandomSeed` frames, PCG3D, domain-only `Random`
— see `docs/RANDOMNESS-MODEL.md`), and Epsil spread/destructuring. The 0.87–0.90
line carried the Tycho items 56–76 rounds (complex-compile emission, the
timeout-span model replacing `ce.timeLimit`, compiled recursive lambdas,
`RandomList`, `Abs(point)` = norm), the tensor unification (BoxedTensor removed;
tensor values are canonical Lists with a lazy view), and honest shaped list
types. The 0.74–0.86 line carried the Tycho-compatibility rounds (through items
50–54: hybrid-lazy `PointList` transposes, the serialize→re-parse juxtaposition
fixes, machine-precision exact-sum crash, `ce.withTimeLimit`), the
collection-operator-gaps + laziness waves, the `broadcastable<T>` typing lift,
conditional values (`When`/`Which`), typed function literals, Mathematica-style
surface forms, `NDSolve` adaptive stepping + `NDSolveFunction`, the DSolve
frontier round (SymPy parity on the ODE audit), and the disposition of the
2026-07 correctness/symbolic/performance reviews — see `CHANGELOG.md`. Earlier
milestones: **0.73.0** (2026-07-09; solving parity 38/40 with SymPy/Mathematica,
Rubi R13–R16, `Interpret`, number theory) and the 0.7x `Measurement` MVP /
control-flow-scoping / Desmos-lists releases. Neyret-corpus parse coverage
92.9%; the remaining Desmos gaps are importer-side (tracked in tycho's
`COMPUTE_ENGINE.md`), not engine items.

**Epsil language shipped (2026-07-09):** the revived Epsil language (parser,
serializer, `executeEpsil` interpreter — phases 0–5 of the revival) is published
as an **experimental** entry point `@cortex-js/compute-engine/epsil`, joined to
the code-splitting ESM build so `executeEpsil(ce, …)` shares engine-class
identity with a host-created engine. Residual language, tooling, documentation,
and release-maintenance items are tracked in `docs/epsil/ROADMAP.md`, not here.

The June 2026 codebase review (REVIEW.md) is fully dispositioned. **Rubi
status:** R1–R30 + R8 landed — chapters 1/2/3/5/6/7, 4.1/4.3/4.5, §8.8
Polylogarithm, 6,574 rules bundled; see the **Coverage tracks → Rubi** section
below for current scores and next rungs (per-rung history in `docs/rubi/RUBI.md`
§5).

**Related documents:** `docs/fungrim/FUNGRIM.md` (feasibility + feature map),
`docs/fungrim/FUNGRIM-PLAN-1…5` (executed architecture plans), `data/fungrim/`
(translated corpus + manifest), `scripts/fungrim/` (translator tooling),
`docs/rubi/RUBI.md` (Rubi integration), `benchmarks/` (cross-library harness +
`REPORT.md`, `BIGNUM-COMPARISON.md`).

---

## Remaining work

- **Standing audit — value-scaled library loops guarded only by `checkDeadline`
  (OPEN; from the constant-fold determinism ruling of 2026-08-30).** Since the
  wall-clock backstop on the compile-time constant fold was removed (user-ruled
  2026-08-30), `foldCostEstimate` alone decides whether a fold runs, and a
  library loop whose bound derives from an operand VALUE, with only
  `checkDeadline` inside, is a compile-time stall the estimate cannot see on a
  no-deadline route. Four such loops in `library/number-theory.ts` got
  deterministic step backstops in that round (`NthPrime`/`NextPrime`,
  `LucasL`/`CatalanNumber`) and combinatorics was already digit-capped, but no
  one has swept EVERY file in `src/compute-engine/library/` for the pattern the
  `number-theory.ts` header documents. The audit is a grep-shaped pass; run it
  before trusting the fold path with untrusted input, and add either a step
  backstop or a fold-estimate arm for each hit.
- **Tycho item 236 residue — the two "what still declines" pins no longer
  decline (OPEN 2026-09-03).** The item-236 fix (2026-08-30) admitted
  complex-typed branches to the element-wise `Which` lowering and kept two
  declines: a complex-valued CONDITION (the complex numbers are unordered) and
  scalar arithmetic over a list-valued selection. Both pins in
  `test/compute-engine/compile-which-complex-selection.test.ts` no longer throw
  `Fail closed` — `compile(..., { fallback: false })` succeeds — on a clean
  checkout of 8f47a863 and of c2124c9d alike, so the change that admitted them
  is an earlier commit in the compile lane, not the type-handler retirement
  (measured by running the file on both checkouts). Either the admission is now
  intended and the pins must move, or the decline regressed; settle it in
  `base-compiler.ts`.
- **`interval-js` target: four heads confirmed with no lowering** (Tycho item
  237, filed 2026-08-30, the item-220 batch mold): `Choose`, `Apply` (the `f'`
  prime-derivative spelling lowers to `Apply(Function(…), x)`),
  `WithRandomSeed`, and index-less `Sum` over a collection body. A decline WITH
  a by-design ruling is an acceptable answer for heads outside the
  scalar-interval-domain contract. Repro: tycho
  `scripts/repros/2026-08-30-ce-interval-lowering-batch-probe.mts`.
- **Destructured Block locals stay `unknown`-typed on the compilation routes.**
  The Tycho item 235 fix (2026-08-30) gives a `Block`-hoisted local its
  statically-readable `Declare` type and joins `Assign` evidence into an
  inferred, valueless binding — but only for a plain symbol target. A name bound
  by a destructuring assignment (`(x, y) := v` — a `Tuple` first operand) is
  excluded by the same `sym()`-based guard in both the `canonicalBlock` hoist
  loop and the `Assign` canonical handler, so such a local still types `unknown`
  and a compile reading it fails closed, as it did before the fix. Not silently
  wrong — the interpreter fallback answers correctly — just uncompiled.
  Extending the fix wants `tuplePatternNames()` (already used for
  `Loop`/`Comprehension` index patterns) plus a per-leaf type derived from the
  corresponding position of the RHS tuple type.

### Open items from the finite-by-default flip (Phase 1, 2026-08-27)

Found during Phase 1 of the numeric-lattice flip
(`docs/plans/2026-08-27-lattice-flip-implementation.md`) and deliberately not
fixed in that change. One item remains.

- **`liftWideResult` wraps every `finite_number`-typed user-function call in
  `_SYS.cplx(...)` in complex compile mode.** `complex ⊑ finite_number` is a new
  edge from the flip, so `finite_number` now counts as WIDE. The wrap is
  idempotent and values are unchanged — pure code bloat. A redundancy skip
  ("operand already emitted in the complex lane") is a compiler design change
  awaiting a decision. Sites: `liftWideResult`/`wideNumericType` in
  `src/compute-engine/compilation/base-compiler.ts`. Deferred by ruling
  2026-08-31 (held out of the small-fix release batch: no wrong values, and the
  fix is a compiler design change, not a small fix).

### Open items from the small-fix release batch (2026-08-31)

- **No LaTeX parse route exists for annotated lambda parameters.**
  `ce.parse('(i: integer) \\mapsto 2i')` produces `Colon`/ `unexpected-operator`
  output instead of an annotated parameter — a parser-surface capability gap
  found 2026-08-31 while fixing the `i`-shield. The raw-MathJSON route and the
  signature-string sugar route both work.

### Open items from the Phase F batches 11, 12, 13 and 14 (2026-09-02)

- **The discrete pmf/CDF guards at a SYMBOLIC point use the tolerant relations,
  where the literal route is exact at the support boundary (OPEN, ruling — found
  2026-09-04 while guarding the symbolic forms).**
  `PDF(PoissonDistribution(2), x)` is `Which(⌊x⌋ = x ∧ x ≥ 0, closed, True, 0)`
  (`discreteSupportGuard`, `library/distributions.ts`), and its `Equal` and
  `GreaterEqual` compare within the engine tolerance once `x` holds a value, so
  `x := 5 - 10^-20` selects the integer arm and the `x ≥ 5` arm of a CDF guard,
  while the literal route `PDF(PoissonDistribution(2), 5 - 10^-20)` tests
  exactly and answers 0. Options: make the symbolic guard exact (a
  tolerance-free relation the guard can name), or accept the tolerant reading as
  the symbolic route's contract and pin the boundary.
- **`GammaRegularized(a, 0)` for a negative non-integer `a`** is a decided
  divergence (`sign(Γ(a))·∞`, verified) left symbolic for uniformity with the
  surrounding `a < 0` capability gap (the kernel computes `Q(a, z)` for
  `a > 0, z ≥ 0` only; `Q(-1/2, 2)` is a finite negative real the engine cannot
  produce). A downward recurrence from a positive `a` would close the gap.
- **Past the exact-expansion caps a few Γ-ratio points stay symbolic**:
  `Pochhammer(a, k)` with both `Γ(a)` and `Γ(a + k)` on a pole and `|k| > 20`
  (`SYMBOLIC_EXPANSION_CAP`), and `GammaRegularized(n, z)` for `z < 0` and
  `n > 20` (`MAX_GAMMA_Q_SERIES_ORDER`). Honest gaps, never `NaN`.

- **`Correlation` cannot declare `real<-1..1>` until the paired kernels stop
  cancelling.** A fuzz of 3000 random samples at machine precision measured
  `max |r| = 1.0000000000063`: the `Σxy − ΣxΣy/n` form of the covariance kernels
  loses digits on a two-point sample with ordinary magnitudes. `Correlation`
  declares `real | nan`, and the pin in `error-model-statistics.test.ts`
  re-derives the overshoot so it fails the day the kernel is accurate. A
  two-pass or Welford accumulation would fix it and would also settle whether
  those kernels should scale their sums (the paired-statistics typing item
  below).
- **`validateArguments` admits a collection with provably non-numeric cells for
  a threadable numeric parameter (OPEN — found 2026-09-04 by the boxing
  validation seam).** `Ln(["a", "b"])` and `Sqrt(["a", "b"])` are valid at
  boxing on the plain path; the handler-side numeric re-check used to mask this
  for the canonical-handler heads, and the seam's threadable admission now
  rejects such a collection for those heads only. The element-type read belongs
  in the threadable admission of `validate.ts`, its own measured change.
- **A matrix p-norm for `p ∉ {1, 2, ∞}` stays inert.** The order passes the
  declared precondition (it is a well-formed order at rank 1) and the operand is
  inside the carrier, but the general matrix p-norm has no closed form and would
  need a numeric kernel. (The Frobenius norm of a rank ≥ 3 tensor, which was
  inert for the same structural reason, is computed now.)
- **A compiled `Norm(v, 0)` answers `NaN` where the interpreter answers the
  precondition error.** An `Error` has no float representation, and `NaN` is the
  documented compiled spelling for "no value" (the compiled `If`/`Which`
  ruling), so the lane degrades the error to `NaN` rather than refusing to
  compile a whole program for one bad order. Recorded, not planned.

### Growing a list one element per loop turn costs seconds by a few hundred turns (OPEN, perf — found 2026-09-04 writing the Epsil style guide)

`let xs = []; for k in 1..n { xs = Join(xs, [k]) }` — the idiom the Epsil docs
recommended until 2026-09-04 — evaluates to a variadic `Join` with one `[k]`
operand per turn (`Join` canonicalization flattens the nesting), and each turn
re-canonicalizes the whole recipe. Measured on a loaded box (load average 30–80,
so the absolute numbers are inflated; the ratios are the finding): `Length(xs)`
after the loop took about 1.4 s at n = 250, 6 s at n = 500 and 30 s at n = 1000
— a factor of 4 to 5 per doubling, worse than quadratic. `Append(xs, k)` (a
variadic `Append`) and the spread literal `[...xs, k]` (which evaluates to the
same `Join`, not to a snapshot) scale the same way. Materializing each turn,
`xs = ListFrom(Join(xs, [k]))`, stores a flat list but still took 2 s at n = 250
and 6.7 s at n = 500 in the same run: re-boxing an n-element list costs tens of
microseconds PER ELEMENT, so the per-turn O(n) has a constant large enough to
make any element-per-turn growth unusable beyond a few hundred elements. By
comparison `ListFrom(Map(k => k, 1..n))` took 16 ms at n = 250 and 18 ms at n =
500 in the same run, and a plain scalar loop of 4000 turns 51 ms.

Two questions before any engine change, both from the Epsil roadmap's original
gating (lazy `Join` semantics, tuple atomicity, effects and size limits must be
preserved): whether `Join` over materialized operands should fold them into one
literal at canonicalization time (that alone does not remove the per-element
re-boxing cost the `ListFrom` variant shows), and where the per-element cost of
canonicalizing an n-element `List` comes from (the likelier lever). The docs now
steer to `Map`/`Fold` and keep growing loops short (`src/epsil/docs/style.md`,
"Building a list one element at a time"); the measurement should be repeated on
a quiet box before the lever is chosen.

### A compiled block lets a `let` redeclare a capture or a parameter that the interpreter refuses (OPEN, compile — found 2026-09-03 reviewing the `while let` compile work)

`match xs { [h, ...t] => do { let t = 7; Length([t]) } }` and
`((t) => do { let t = 7; t })(1)` both evaluate to the error
`The symbol "t" is already declared in this scope` in the interpreter: a block
directly under a binder may not redeclare the binder's name. The JavaScript
target compiles both — the block's `let t = 7` shadows the parameter or the
capture accessor — and answers `1` and `7`, so a program the interpreter rejects
runs compiled with a value. The compiled answer is the one most languages give,
so this is a ruling: either the interpreter admits the shadowing (a scope-rule
change) or the block compiler fails closed on a `Declare` whose name is in
`target.boundVars` (`compileBlock` and `compileLoopBody`,
`compilation/base-compiler.ts`). Not specific to `match`: every binder has it.

### A destructuring comprehension binder has no binding-site type (OPEN, typing — found 2026-09-03 while fixing Tycho item 245)

The binder-authority rule (ruled 2026-09-03: a binding-site type is
authoritative over the body's inference, and a use that contradicts it is a type
error, pinned in
`test/compute-engine/point-list-lift-and-binder-authority.test.ts`) is enforced
for a SYMBOL binder only. `[p + q for (p, q) in pairs]` declares its leaves `p`
and `q` as `unknown` and never narrows them from the source's element type — the
element-type write in `canonicalLoopLike` runs for a symbol binder only — so the
leaves are typed by use and the fresh-matrix repair can still retype them. The
rule has nothing to enforce there until the leaves take their component types
from the source's tuple element type; that is a typing improvement to make, with
the same fresh-set removal.

### Open items from the undecided-condition ruling (2026-09-02)

The ruling ("a compiled `If`/`Which` whose condition is not exactly `true` or
`false` at run time takes no branch") is implemented for the JavaScript-family
lowering of both the expression form and the statement form
(`BaseCompiler.conditionDecidability`), and the interpreter agrees since
2026-09-03. One deliberate non-alignment and one compile gap remain.

- **The GPU targets keep JavaScript-style selection.** Python IS aligned: its
  `If`/`Which` entries share the compiler's decidability analysis and answer
  `float('nan')` for an undecided condition (`compilePythonBranch`,
  `compilation/python-target.ts`). GLSL and WGSL are deliberately NOT aligned —
  the rule answers with NaN, and NaN propagation is not guaranteed on every
  driver (a shader compiler may assume operands are never NaN under fast-math,
  which is why the shader targets already omit the `isAbsent` capability), so a
  NaN-valued no-branch answer cannot be relied on there. Interval-JavaScript
  lowers `If` to its own `_IA.piecewise` helper and is unaffected. `When` keeps
  the truthiness test on every target: it is not a two-armed selection, so the
  ruling has no arm to withhold.
- **A compiled `Hypot` over a point whose component is a list does not
  compile.** `Hypot(([1,2], 3), 4)` is one hypotenuse per element —
  `[√26, √29]`, and the application declares `list<number>` — because the inner
  list distributes into two points. A single `Math.hypot` call cannot produce
  that, so the JavaScript target refuses the expression and the engine falls
  back to interpretation, which answers correctly; a fixed-arity point compiles
  normally, as one leg. Compiling the broadcasting form needs the nested
  emission that keeps a point atomic, which `Add` and `Multiply` already use for
  a point summed with a list of points (`atomicTuple` in
  `BaseCompiler.tryCompileBroadcast`). `Norm` refuses the same operand for the
  same reason.

### Doc-sweep triage (2026-08-29)

Found by checking published examples and reference prose against the engine,
closing out the doc sweeps of the numeric-lattice migration. Each item was
measured on the main tree at that date. The items the same round FIXED —
`Count`'s dishonest `integer` result, the `(number)` carriers on
`Totient`/`Divides`, and `Which`'s odd-arity operand count — are not listed
here.

- **Clause sets that dispatch on `infinity`, `nan` or `non_finite_number` do not
  compile (OPEN — the decline was ruled 2026-08-29, its re-admission REFUTED by
  measurement 2026-08-30).** Compiled float arithmetic does not preserve a pole:
  the interpreter's `~oo - ~oo` is `~oo`, compiled it is `Infinity - Infinity`,
  which is `NaN`, so a guard on a produced value asks a different question than
  the interpreter's — on `g(a: infinity) = 1; g(x: number) = 0`, compiled
  `g(1 / w - 1 / w)` at `w = 0` answers 0 where the interpreter answers 1.
  `jsClauseParamGuard` (`src/compute-engine/compilation/base-compiler.ts`)
  therefore declines the whole clause set for those tiers and for the non-finite
  VALUE types, and the set runs interpreted (pinned in
  `test/compute-engine/multi-clause-compile.test.ts`). Restoring compilability
  is not a guard problem: it needs either a float encoding in which a pole
  survives arithmetic as a pole, or a compiler that refuses to fold a pole into
  a plain JS number at all. The narrower open question: a `~oo` ARGUMENT now
  projects to `Infinity` at the compiled boundary (`isUnsignedPole`,
  `javascript-target.ts`, 2026-08-30), so compiled `Heaviside(x)` at `x = ~oo`
  answers `1` and compiled `x > 0` answers `true`, where the interpreter leaves
  both unevaluated — both previously threw; whether those two divergences are
  acceptable is undecided.
- **An Epsil effects violation is swallowed with zero diagnostics.** A function
  whose body writes to a binding of the ENCLOSING call needs the `scope` effect
  declared. When it is missing, the inner `DefineFunction` evaluates to
  `Error(ErrorCode("incompatible-type", "non-scope effects (writes outside a function requires a declared `scope` effect)", "scope effects"))`
  — raised at `src/compute-engine/boxed-expression/ effects-inference.ts:193` —
  but the program reports NO diagnostic and the enclosing function silently
  becomes uncallable. Chain: `evaluateStatements` short-circuits on the `Error`
  (`src/compute-engine/function-utils.ts:1805`), then `makeLambda`'s
  nullary-scoped-block arm ends `return result.isValid ? result : undefined`
  (`function-utils.ts:2583`), and an `Error` is not `isValid`, so `apply()`
  falls through to an inert `Apply` (`function-utils.ts:1749`). Engine-level
  repro:
  `Apply(Function(Block(Declare(n, {value: 0}), DefineFunction(h, Function(Block(Assign(n, Add(n, 1)), n))), 99)))`
  evaluates to itself. The swallow point is `function-utils.ts:2583`; the error
  should reach the user. (This is what broke the `counter()` closure example in
  `src/epsil/docs/evaluation.md`, now fixed there by declaring the effect.)
- **`if cond { }` with an EMPTY block yields an inert `Block`, not `Nothing`.**
  `if 1 < 2 { }` parses to `["If", ["Less", 1, 2], ["Block"]]` and evaluates to
  `["Block"]` — rendered `{}` — with type `unknown`, where
  `src/epsil/docs/control-flow.md:906` says an empty block's value is `Nothing`.
  It is NOT the empty-SET parse it looks like: `["Block"]` is a genuine empty
  block, and `{}` is only how an empty `Block` renders. Both correct
  implementations already exist and are unreachable: `canonicalBlock` returns
  `null` for zero operands
  (`src/compute-engine/library/control-structures.ts:1372`), and `null` means
  "cannot be put in canonical form"
  (`src/compute-engine/ types-definitions.ts:824`), so the node stays
  non-canonical and unbound and neither its `type` handler (`'nothing'` at zero
  args, `control-structures.ts:98`) nor its `evaluate` handler (`ce.Nothing` at
  zero args, `control-structures.ts:1309`) ever runs. Fix = stop declining in
  `canonicalBlock` for the zero-operand case.
- **`.value =` does not infer a symbol's type, while `ce.assign()` does.**
  `doc/04-guide-symbols.md:19-27` promises inference and uses `n.value = 5` as
  its live example. Measured: after `ce.expr('n')` then `n.value = 5`, the type
  is `unknown`; after `ce.assign('n', 5)` it is `integer` (and `assign` refines
  even when the definition already exists). The setter ends at
  `ce._setSymbolValue`
  (`src/compute-engine/boxed-expression/ boxed-symbol.ts:811`), and
  `setSymbolValue` writes only `def.value.value`, never `def.value.type`
  (`src/compute-engine/engine-declarations.ts:654`); `assignFn` instead either
  declares with inference (`engine-declarations.ts:2584`) or runs its explicit
  inferred-type update just below `assertAssignableValueDef`. Worse than a
  missing inference: the setter can leave the declared type INCONSISTENT with
  the held value — after `ce.assign('m', 1)` (type `integer`),
  `m.value = ce.string('hi')` leaves type `integer` holding `"hi"`.
- **`assume(t ∈ ExtendedRealNumbers)` answers `ok` but leaves `t: unknown`.**
  `RealNumbers` gives `real`, `Integers` gives `integer`, `ComplexNumbers` gives
  `complex`; `ExtendedRealNumbers` and `ExtendedComplexNumbers` give `unknown`,
  and `t.isReal`/`t.isNumber` stay `undefined` — though the structural fact IS
  recorded (`Element(t, ExtendedRealNumbers)` evaluates `True`). Cause:
  `domainToType` (`src/compute-engine/boxed-expression/ utils.ts:574-585`) is a
  hardcoded six-entry table with no extended-set entry, falling through to
  `return 'unknown'`; it is called from `assume.ts:1083` and `assume.ts:1126`.
  The right type is already available two ways — the set definition declares
  `set<real | non_finite_number>` and its `elttype()` returns
  `EXTENDED_REAL_TYPE` (`src/compute-engine/library/sets.ts:298-312`).
- **The `Sqrt` overload recipe cannot work for a literal argument.**
  `doc/06-guide-augmenting.md:1055` shows redeclaring `Sqrt` with a wrapping
  `evaluate` handler; measured, `Sqrt(-4)` still answers `2i` and the handler
  never runs. The override IS installed and IS reached for non-literal operands
  (`Sqrt(z)` with `z` complex, and `Sqrt(w)` with `w := -4`, both reach it). A
  LITERAL never survives to evaluation: `ce.box(['Sqrt', -4])` canonicalizes to
  `["Complex", 0, 2]` in the name-keyed numeric fast path
  (`src/compute-engine/boxed-expression/box.ts:2904-2905`,
  `if (name === 'Sqrt') return withSourceOffsets(canonicalRoot(ops[0], 2), metadata);`)
  — which the `Sqrt` definition's own commented-out `canonical` handler already
  flags
  (`// @fastpath: canonicalization is done in the function makeNumericFunction()`,
  `src/compute-engine/library/arithmetic.ts:3470`). So overriding `Sqrt`
  requires overriding canonicalization, which the documented recipe does not do;
  either the recipe or the fast path has to change. The example has a second
  defect: its guard `y?.isExtendedReal ? y : ce.NaN` is three-valued-unsafe — a
  symbolic result reports `undefined` there and collapses to `NaN` instead of
  staying symbolic.
- **Else-less `\keyword{if}` does not parse to `If`, and fails silently.**
  `doc/07-guide-latex-syntax.md:298-300` says the `else` branch is optional.
  Measured, `\keyword{if} x > 0 \keyword{then} x` parses to
  `["Less", ["Text", 0, "'then'", "x"], ["Text", "'if'", "x"]]` — the keywords
  degrade to ordinary text juxtaposed with the operands — and it reports
  `isValid: true`, so nothing signals the failure. Cause: `parseIfExpression`
  makes `else` MANDATORY
  (`src/compute-engine/latex-syntax/dictionary/definitions-core.ts:5220`,
  `if (!matchKeyword(parser, 'else')) return null;`); the `null` aborts the
  whole `if` build and the parser backtracks. The true-branch parse at `:5213`
  also terminates only on `else`, so recognizing an else-less `if` needs a
  second termination condition. Separately, the operand-order note at
  `doc/07-guide-latex-syntax.md:295` is wrong: it shows
  `["If", ["Greater", "x", 0], …]`, but the snippet reads `.json` off the
  CANONICAL parse, which measures `["If", ["Less", 0, "x"], …]` —
  canonicalization rewrites `Greater(x, 0)` to `Less(0, x)`. The `Greater`
  spelling appears only under `{canonical: false}`.
- **`Clamp` has no one-argument form, and its doc example is wrong twice.**
  `doc/80-reference-arithmetic.md:486-508` documents
  `<Signature name="Clamp">_value_</Signature>` with defaults −1 and +1.
  Measured, the signature is `(number, number, number) -> number` with all three
  required (`src/compute-engine/library/arithmetic.ts:4201`), so
  canonicalization pads the absent operands and `Clamp(0.42)` evaluates to
  `Error("missing")`; the two-argument form `Clamp(0.42, 0)` errors the same
  way. The doc's own example is also self-contradictory independently of this:
  it claims `["Clamp", 0.42] ➔ 1`, which violates the rule stated three lines
  above it ("Otherwise, evaluate to `value`") under BOTH candidate ranges — the
  answer is `0.42`. The adjacent `["Clamp", 4.2] ➔ 1` is correct for [−1, +1],
  and both three-argument examples check out. Decide whether to implement the
  documented defaults or drop the one-argument form from the doc.
- **A qualified protocol call on an UNDECLARED protocol name throws instead of
  erroring.** The reported symptom `Comparable.compare("a", "b")` → "expected 1,
  got 2" does NOT reproduce for the documented form: with the protocols declared
  as `src/epsil/docs/protocols.md:153-170` does, `Comparable.compare("a", "b")`
  answers `"<"` and `Comparator.compare("a", "b")` answers `-1`, exactly as
  documented. It reproduces only when `Comparable` is undeclared, and then the
  failure mode is bad. The parse is correct
  (`["Apply", ["Field", "Comparable", {"str": "compare"}], "a", "b"]`), but
  `Field`'s handlers key off the protocol registry (`protocolOfSymbol`,
  `src/compute-engine/library/collections.ts:6147` and `:6195`), an unregistered
  name falls through leaving a free undeclared symbol, and
  `canonicalFunctionLiteral` then LIFTS that symbol into an implicit parameter —
  making the callee the unary lambda
  `("Comparable") => Field("Comparable", "compare")`, which rejects two
  arguments. On the raw engine route it THROWS out of `invoke`
  (`src/compute-engine/function-utils.ts:2761`) rather than returning an error
  value. Wanted: an unknown protocol name should say so.

### Four Fungrim Dirichlet entries are not representable: a `Sum` index is always `integer`, and `Conjugate` refuses a function-typed symbol (OPEN, type-system — found 2026-08-29 by `validate.ts --check`)

**Context.** Since 2026-08-18 (commit 00405934) the engine reports
`expected-function` when a symbol declared with a non-function type is applied.
The Fungrim Stage-1 tool (`scripts/fungrim/load.ts`) declared every entry
variable `complex` by default, so `chi(m)` with a Dirichlet character `chi`
failed. Fixed 2026-08-29: a variable that appears in head position is declared
`function`. The committed report (`scripts/fungrim/validation-report.json`) was
regenerated; 32 of the 36 regressions closed. The four that remain
(`data/fungrim/corpus/dirichlet.json` ids `288207`, `3ab92d`, `4c3678`,
`f4de66`) are engine limits:

1. **`Sum`/`Product` pin their index to `integer` whatever the indexing set
   holds.** `Sum` and `Product` declare their bound variable with
   `scoped: indexingSetSites(1, 'integer')` (`library/arithmetic.ts`), and the
   numeric iteration in `reduceBigOp` relies on that declaration to `assign` the
   index. So `Sum(chi(n), Element(chi, DirichletGroup(q)))` — or any
   `Sum(f(x), Element(x, S))` with `S: set<function>` — declares `chi: integer`,
   and the body `chi(n)` is then an `expected-function` error. The index of an
   `Element` clause should take the element type of the set (`S: set<T>` → index
   `T`, falling back to `integer` only for range-shaped clauses
   `Limits`/`Tuple`/bare symbol). The assign in `reduceBigOp` is range-only, so
   the pin is only needed on those shapes.

2. **`Conjugate` accepts only numbers.** Entry `288207` writes
   `DirichletLambda(1 - s, Conjugate(chi))` — the conjugate character. With
   `chi: function` the argument check reports
   `incompatible-type number function`. Either `Conjugate` gains a function arm
   (pointwise conjugate, a function literal `x ↦ Conjugate(chi(x))`), or the
   corpus entry stays listed as a Stage-1 failure in the report.

Until both are decided the report lists these four as known Stage-1 failures,
and `--check` is green against that baseline.

**With the deadline restored Stage 2 finished in 47 s and reported 16 False
instances in 6 entries (July: 0 — the same shapes were then unevaluated).
Triage, all on 2026-08-29:**

- FIXED (engine): `Limit(Fibonacci(n+1)/Fibonacci(n), n→∞)` answered `1`
  (entries `2b6e60`, `d56025`, `fdfdcc`). `leadingOrder` in `symbolic/limit.ts`
  dropped a dominated additive term inside EVERY function argument, so
  `Fibonacci(n+1)` became `Fibonacci(n)`; the same rewrite gave
  `Γ(x+1)/(x·Γ(x))` → 0 and `f(n+1)/f(n)` → 1 for an unknown `f`. The rewrite
  now enters an argument only under a slowly varying head (products, quotients,
  `Ln`/`Log`, roots, x-free powers). The Fibonacci ratio now stays an inert
  `Limit` (no growth class for `Fibonacci`); resolving it to φ needs a growth
  level for exponential-class special functions — OPEN, low.
- FIXED (engine): `Integrate(…).N()` of a COMPLEX-valued integrand dropped the
  imaginary part (entry `f4e249`, `∫₀^π e^{e^{e^{ix}}} sin(nx) dx`):
  `library/calculus.ts` read `.re` of every sample. The integrand is now split
  into real and imaginary parts, both integrated, and returned as a complex
  `Measurement`; `Real`/`Imaginary`/`Abs`/`Conjugate` propagate through a
  Measurement (`measurementLipschitzUnary`). `BellNumber(n)` from that integral
  now evaluates to `n`'s Bell number to 15 digits.
- FIXED (upstream source, 2026-08-29): `419b45` stated `π = Σ n!/(2n+1)!!`; the
  sum is π/2 (checked independently in Python to 16 digits, and the engine
  agrees). The Fungrim source in the `arnog/fungrim` fork
  (`pygrim/formulas/pi.py`) now reads `π = 2·Σ …`; the corpus was regenerated
  and `data/fungrim/MANIFEST.json` carries the new content hash (the fork commit
  id in the manifest must be refreshed once that fork change is committed).
- FIXED (translator, 2026-08-29): `4099d2` used `Power(Range(1, N), n)` for
  Fungrim's CARTESIAN power (n-tuples), which the Compute Engine reads as an
  elementwise power. `grim2mathjson` now emits the shell `CartesianPower(S, n)`
  when the base of `Pow` is a set or domain constructor (`translate_pow` in
  `grim2mathjson/structural.py`); the entry is now `not-evaluable` (shell head)
  instead of False. `scripts/fungrim/load.ts` `setify` keeps the `collection`
  base parameter for that shell (a `Range` is an indexed collection, not a set).
  A Compute Engine `CartesianPower` operator would make the entry evaluable —
  OPEN, low.

### A re-declared operator carrying a caller `compile` handler switches off the compiler's call-sharing (OPEN, design — measured 2026-08-21 under Tycho item 217)

`R(i,x,y) = R(i-1,x,y) + 0.5·S(x,y,R(i-1,x,y))` compiles to a linear artifact on
a stock engine (the CSE harvest binds the repeated self-call: 0.03 ms/call at
depth 18), and stays linear when a `compile` handler is attached IN PLACE to the
stock `Which` definition, or when `Which` is re-declared from a copy of the
stock definition WITHOUT a handler. It goes exponential — ×4 per two levels, 39
ms/call at depth 18 on `main`, 50 ms on 0.117.0 — only when BOTH happen:
`engine.declare("Which", {...stock})` followed by `operator.compile = …` on the
new definition (Tycho's retired "OLD route"; their shipped install attaches in
place and is flat). The switch is `Harvester.hasCallerCompileHandler`
(`compilation/cse.ts`): a `compile` handler on a definition that is not the
system-scope one is a live-source splice the harvest cannot analyse, so every
node under that head is refused as a CSE candidate and every callee body
containing it fails `calleeBodyClean` — admitted for the NaN-skippability
question only, where the definition's declared `pure` is trusted (an explicit
`pure: true` on the re-declaration does NOT restore sharing, measured). The
built-in definition's own handler is exempt by object identity.

Option, if a consumer needs the re-declaration shape: the lazy-operand region
table (`LAZY_OPERANDS`) is keyed by operator NAME, so a re-declared `Which`
still opens the right regions at harvest; a caller handler that DECLINES at
emission (returns `undefined`, Tycho's case) then emits through the built-in
lowering, which pushes those regions. The refusal could be narrowed to "a caller
handler that EMITS" — unknowable at harvest time, so it would have to be a
declaration on the handler (or a `pure` + "lazy operands as the built-in"
contract). Demand-gated: the only known consumer route is flat.

### Assigning a function literal whose body shares operands is exponential in the sharing depth (OPEN, evaluation — found 2026-08-22 with the shared-operand walk fix)

`ce.assign('f', Function(Hold(e), t))` with `e` a depth-_n_ shared tower
(`Max(e, e)` nested, 31 distinct nodes at depth 30) doubles per level: 1.7 s at
depth 16, 3.1 s at 18, 10.6 s at 19, and the process runs out of memory at 30 —
while BOXING the same literal takes 1 ms and APPLYING it to an argument takes 9
ms at depth 30 (both pinned in `dag-shared-walks.test.ts`). Two walks on the
assign path descend each operand independently:

- `Walker.visit` in `boxed-expression/effects-inference.ts` — the latent-
  effects inference of the literal's body (`inferFunctionLiteralEffects`), also
  reached when a lazy collection reads its callback's effects:
  `Map(k ↦ e + k, Range(1, 3)).count` does not return at depth 30 either,
  whereas the same `Map` with the tower in its SOURCE answers in 3 ms. The visit
  carries order-sensitive state (the confinement frontier of declared names per
  sequence, the registry-consulted bits, the saturation early return), so a
  per-node memo needs the same analysis the binder rewrite's got — the answer
  must depend only on (node, frontier) for the memo to be sound.
- `jsonWithSourceOffsets` in `engine-declarations.ts` — the literal is re-boxed
  from its MathJSON (with `sourceOffsets`) to stamp parameter types, and
  `BoxedFunction.structural` rebuilds each path of a shared operand as a fresh
  tree on the way; MathJSON cannot express sharing, so the serialization itself
  is exponential in size. The re-box would have to work from boxed operands
  (`ce.function('Function', [body, …params])`) instead.

Not fixed with the evaluation-path walks because no consumer shape assigns a
literal whose body is an evaluated value: parsed bodies are trees, and the
shared-operand values arise as RESULTS (a document function applied to its own
previous result), which Tycho's document pass never re-assigns as a function
body. Probe: the `assign` line above at depths 16/18/19.

### Type-object walks unfold a shared nested tuple type (OPEN, low — found 2026-08-22 with the shared-operand walk fix)

A `Tuple(e, e)` tower of depth _n_ — each level a tuple of two references to the
level below, 31 distinct nodes at depth 30 — has a TYPE that nests once per
level, `tuple<tuple<…>, tuple<…>>`, and the walks over type objects descend each
element independently: `hasFreeVariables` (`common/type/instantiate.ts`),
`hasOptionalWithVariadic` (`common/type/primitive.ts`), `couldBeNumericElement`
(`collection-utils.ts`) and `typeToString`. Reading such a node's type,
canonicalizing an `Add` over it, or boxing a `Sum` over it therefore doubles per
level (depth 14 / 16 / 18: `Add` 14 / 18 / 76 ms, `type` 5 / 14 / 55 ms, `Sum`
boxing 3 / 7 / 27 ms; the serialized type at depth 12 is 61 431 characters). The
EXPRESSION-level walks over such a value were fixed on 2026-08-22
(`dag-shared-walks.test.ts`, whose fixture is a `Max` tower for exactly this
reason — its type stays `number`); the type-level walks were left alone because
no consumer shape nests tuple TYPES that deep (Tycho's heightmap chain has
number elements). If one appears, the remedy is the same per-node memo — a
visited set keyed on the type object, threaded through the walk — and the
serialized type needs a cap the way the ordering key got one. Probe:
`let e = ce.box(['Add', 'x', 'y']); for (let i = 0; i < 18; i++) e = ce.function('Tuple', [e, e]);`
then time `e.type` and `ce.function('Add', [e, ce.symbol('z')])` against
depth 16.

### A recursive function with a function-typed parameter is rebuilt at every application — exponential time, and a type that overflows the stack (OPEN, evaluation — found 2026-08-22)

`tw(n, v, f) := If(n ≤ 0, v, tw(n-1, f(v), f) + tw(n-1, f(v), f))` applied to
NUMBER arguments and a closed callback, `tw(10, 1, z ↦ z+1)`, takes 49 s on
0.118.0 (`tw(8)` 4 s; `tw(14)` throws
`RangeError: Maximum call stack size exceeded` from `hasFreeVariables`,
`common/type/instantiate.ts`), where the same shape without the callback
parameter is memoized and instant (Tycho item 217). The stored literal is
stable, but the literal the application runs is a DIFFERENT object at every
level — its inferred type changes with the function-typed parameter — so the
pure-application memo, keyed on the literal's identity, misses every time, and
the type grows with the depth until instantiation overflows. The
symbolic-recursion guard (`SymbolicRecursion`, `function-utils.ts`) keys on the
literal's structural hash for this reason. Probe: the `tw` definition above,
`ce.box(['tw', 10, 1, ['Function', ['Add', 'z', 1], 'z']]).evaluate()`; compare
with `it2(n, v) := If(n ≤ 0, v, 0 + it2(n-1, v+1))`, whose literal is the same
object at every level.

### The recursion limit can lose to the JS stack when each level nests deeply (OPEN, evaluation — found 2026-08-22)

`ce.recursionLimit` (default 256, `engine-runtime-state.ts`) counts
user-function applications, and a runaway numeric recursion normally ends in a
clean `CancellationError: Recursion limit exceeded` — `f(n) := n f(n-1)` applied
to `f(2)` does. But when each level pushes many JS frames before the next
application, the JS stack runs out first and the caller gets a bare
`RangeError: Maximum call stack size exceeded` instead:
`h(n) := \text{T}(n \le 1, 1, n h(n-1))` (a body whose `\text{…}` made a
`Text(…, Tuple(…))` node — the author meant `If`) throws the `RangeError` on
`h(2)`. Options: lower the default limit, or make the guard stack-aware (catch
the `RangeError` at the outermost application and rethrow it as the
cancellation). Repro: the two parses above, then `ce.box(['h', 2]).evaluate()`.

### Built-in collections as `Iterable`/`Indexable` protocol conformers — audit and sizing (OPEN, design — audited 2026-08-21; ruling P8 / §7 item 6(h) of `docs/TYPE_SYSTEM_ROADMAP.md`)

A read-only audit sized the migration of the collection capability from the type
lattice onto the protocol system. Findings, so the next round does not re-derive
them:

- **The engine already has three overlapping answers to "is this a
  collection".** (1) The lattice: `collection<T>`, `indexed_collection<T>`,
  `list<T>`, … (~139 predicate sites + 76 operator-signature bounds). (2) The
  runtime handler layer: `CollectionHandlers` on a definition
  (`types-definitions.ts`, 14 members, `iterator` + `count` required,
  `defaultCollectionHandlers` in `collection-utils.ts` derives the rest) with
  the `isCollection`/`isIndexedCollection`/`isFiniteCollection` accessors — a
  structural protocol in everything but name, reachable from JS only. (3) The
  nominal protocol registry (`engine-protocols.ts`), which has no collection
  protocol at all. The documented CAPABILITY-vs-SHAPE split
  (`types-expression.ts`, the `isCollection` doc) is why ~24 sites double-gate
  (`op.isCollection || op.type.matches('collection<any>')`); the sharpest seam
  is `BoxedFunction.isIndexedCollection`, a capability accessor whose final
  answer is `this.type.matches('indexed_collection<any>')`.
- **Site classification** (`src/`, excluding the lattice implementation in
  `common/type/`): 69 predicate sites are pure capability gates ("can I
  iterate/index/count this"; 40 of them in `compilation/`), 70 are
  shape/element/inference/representation reads (28 in `library/collections.ts`)
  and must stay on the lattice, 10 are mixed (capability gates with tuple/string
  atomicity carve-outs). Of the 76 signature bounds, ~57 are capability bounds
  (`Count`, `IsEmpty`, `Contains`, `Join`, the statistics folds). Migrating the
  capability sites alone touches 19 files (24 with the signature bounds).
- **What the protocol system can already do**: built-in lattice types are legal
  conformance targets (`conformanceTargetProblem` admits `string`,
  `list<integer>`, a conditional head `list<T>`); a JS host handler satisfies a
  member with no Epsil source (`ProtocolHostHandler`); dispatch keys on the
  receiver's TYPE, so an untagged `["List", 1, 2]` dispatches; and
  `where T is Iterable` is a working constraint slot today. What it cannot do,
  by effort: protocol refinement (`Indexable` requires `Iterable`) — no
  `requires` field; parameterized protocols (`Iterable<T>` —
  `assertV1MemberShape` bans generic members; conditional conformance gets
  element MATCHING but not element OUTPUT in a member's result type); a
  dynamic-tier compiled guard that can see element types (the `array` bucket is
  rejected); and the membership-granting bridge (conformance ⇒ inhabits
  `collection`), which needs `isSubtype` to consult the conformance oracle and
  inverts the `common/type` ⊥ engine layering that the P36 oracle seam exists to
  preserve. Compiled dispatch is JavaScript-only.
- **Handler members that are not protocol-shaped**: `elementMemo` is a boolean
  attribute, not a member; `isCollection` is a PER-INSTANCE conformance veto
  (`When`), which nominal conformance cannot express;
  `isLazy`/`isFinite`/`isEmpty`/`isEnumerable` are derived facets, not
  conformance; the `string` arm of `at`'s index is dead (no library `at` handler
  accepts a string — keyed access lives on `BoxedDictionary`); and
  `canEnumerate`/`elementCount` on eager producers form a second, mutually
  exclusive partial conformance that a unification must place.

Recommendation from the audit: do not replace the lattice; make
`CollectionHandlers` the implementation of two engine-declared protocols
(`Iterable` over the `collection` tier, `Indexable` over the
`indexed_collection` tier, as §4 already rules), and retarget the 69 capability
gates at conformance so the double-gating disappears. First deliverable is the
requirement-table design doc item 6(h) asks for; the member table above is its
input.

Defects found by the audit (all verified; small, recorded here so they are fixed
with the unification or sooner):

- **The public `.d.ts` mirror of `CollectionHandlers` has drifted.**
  `types-expression.ts` re-declares the interface structurally for the published
  types and omits `isEnumerable` and `isCollection`, both present on the
  canonical `BaseCollectionHandlers` in `types-definitions.ts`. Either derive
  one from the other or add the two members.
- **`isLazy` documents the wrong default.** The handler's doc comment in
  `types-definitions.ts` says "Default: `true`";
  `BoxedFunction.isLazyCollection` answers `?? false`. The code is right (an
  eager `List` is not lazy); fix the comment.
- **`Tuple` carries a phantom `keys` handler.** `library/collections.ts`
  declares `keys` inside `Tuple`'s `collection:` block; `keys` is not a member
  of `CollectionHandlers` and nothing reads it — it survives only because the
  definition is cast `as OperatorDefinition`. Remove it, or promote keyed access
  to a real member (`get`/`has`/`keys`, matching `DictionaryInterface`) if a
  `Keyed` protocol is wanted.
- **No test exercises a user-supplied `collection:` handler block**; the only
  one (`type-constructors.test.ts`) passes `collection: {}` to make construction
  throw. The JS extension route is public surface
  (`OperatorDefinition.collection`, `ValueDefinition.collection`) and is
  unpinned.

### Type handlers as functions of TYPES, not expressions — measured 2026-08-22 (OPEN, design input)

The `type` handler of an operator definition takes `ops: Expression[]`, a
signature that predates the type system. A survey of the 146 handlers in
`library/*.ts` (regex over what each reads from its operands; counts
approximate) found 116 read nothing but `ops[i].type`, and the other ~30 read a
handful of VALUE facts: `isFinite`/`isNaN`/`isReal` (~45 reads), sign and
integrality (~15), `.ops`/`.op1`/`.operator` (structure, ~5), and literal
content (`.string`, `isSame`, `isLess`, ~5).

Measured in a worktree by proxying the operands at the ONE call site
(`BoxedFunction` type derivation, `def.type(expr.ops, …)`) and running the full
suite; `--ci`, no snapshots written. Each row's model is stated because the
first two were wrong in instructive ways.

| model                                                       | failures | what it showed                                                                                                           |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| every `isX` getter and value read blinded                   | 345      | over-blinded: `isReal`/`isInteger`/`isFinite` on a SYMBOL answer from its declared type, so the type channel was cut too |
| type-backed predicates pass through; literal types on input | 244      | literal types LEAK: handler results carrying `tuple<1,2>`, `((z: 0) -> 0)`, `() -> 1` get STORED as contracts            |
| + widen every `{kind:'value'}` in a handler result          | 423      | the naive walker rebuilt nominal/reference nodes (identity lost) and recursed a recursive record type                    |
| + widen through STRUCTURAL nodes only, cycle-guarded        | **75**   | the residue, 23 suites, 0 crashes, 0 snapshot diffs                                                                      |

Of the 75: 51 assert a type STRING and received one equally sound or MORE
refined (`broadcastable<finite_number>` for `broadcastable<number>`); 9 are
boolean predicates; 15 are behavior. Decomposed by cause, the residue is mostly
limits of the experiment's spelling, not of the design:

- **Assumptions** (~10, `inverse-trig-domain-type`, `solve-domain`): sign facts
  from `ce.assume(x > 0)` reach handlers through the same getters. A third
  channel, neither value nor declared type. Would need assumptions to refine the
  TYPE, or a types-only handler to lose them.
- **Rational literals** (~8, `(1,2)/3`, `(-2)^(p/q)` provenance): `1/3` is not a
  parseable literal type (lexer rejects `/`), so the experiment spelled it as a
  float and lost exactness. Rational literal types are a prerequisite.
- **Closed complex constants** (5 Fungrim rules + 1): `i` is a constant WITH a
  value, not a literal; `isImaginary`/`isComplex` were not derived from its type
  in the shim. A shim gap — and the refusal is the STRICT canonicalization gate
  (`validate.ts:464`, `!op.type.matches(param)`), not the handler.
- **Symbol with an assigned function value** (2, `derivatives`): `f'(0.25)`'s
  type reads `f`'s VALUE. The only genuinely dynamic dependence found.
- Shim artifacts (union member duplicated by widening two literals to one
  primitive, no `reduceType` after widen).

Three facts the experiment established that any design should start from:

1. Numeric literal types already exist (`ce.type('2')` → `2`,
   `<: finite_integer`), but a boxed literal does not carry one —
   `ce.box(2).type` is `finite_integer`. Giving literals their literal type on
   handler INPUT recovers every literal-derived fact (`n²` integer, `x/2` real,
   `10²¹` integer, `At` with a literal index) without a value channel; helpers
   such as `toInteger()` then read the value from the type.
2. Literal types must be WIDENED at storage boundaries (tuple element types,
   inferred signature results, collection joins) or they become over-specific
   contracts. The widening must stop at `reference`/`object`/ `record` nodes,
   which carry identity and may be recursive.
3. Most of what the value-dependent 20% "earns" is passage through the strict
   signature gate at canonicalization, not correctness of results —
   `FactorInteger(3+10²¹)`, `Mod(2^(3^20), 100)` and 25 simplify rules were
   REFUSED, not miscomputed, when `10²¹` typed `finite_number`. Arithmetic
   already admits by `couldMatch` and rejects at evaluation (`validate.ts:459`);
   the declared-signature path refuses by strict `matches` five lines later
   (`validate.ts:464`). One rule for both is a product decision (an error moves
   from box time to evaluate time).

Worktree with the shim: the experiment is reproducible from this entry; the
proxy gates on `CE_TYPE_VALUE_BLIND` / `CE_TYPE_LITERAL` and is not for landing.

Step 2 of the design's migration plan (§5.3) LANDED 2026-08-23: the dual handler
shape. An operator definition may declare `typeHandlerKind: 'types'` and receive
operand DESCRIPTORS (`OperandDescriptor` — handler-visible type, three-valued
facts, on-demand structure; built by `describe()` / `describeType()` in
`boxed-expression/operand-descriptor.ts`) instead of operand expressions; the
single call site in `boxed-function.ts` dispatches on the flag, and a runtime
purity guard (on under test) throws if a `'types'` handler moves any
invalidation axis. First migrated handlers: `Coalesce`, `Hold`, `ReleaseHold` —
byte-identical types, pinned in `type-handler-parity.test.ts` /
`type-handler-descriptors.test.ts`.

Two follow-ups landed 2026-08-23, before the mass conversion bakes the contract
in: (1) `OperandFacts` was REDUCED (user-directed) to the facts the type cannot
carry — `valid` deleted (an error operand's type IS `'error'`, and the error
type propagates, so validity is a type read); `application` deleted as a fact
(its consumers — `isPossiblyCollectionTyped` in
`Add`/`Multiply`/`Equal`/`PointX` — are answered by
`structureOf().kind === 'application'`, §5.6's own conclusion); `inferred` moved
to where §5.6 said it fits, an attribute of the `structureOf()` symbol node (its
consumers, `Multiply`'s `isDeclaredScalarNumber` and the `List` fold, read a
symbol-node flag); `finite` kept for the NaN-literal soundness bit, `sgn` kept
for the held-value and declined-range-assumption residues — the full per-field
rationale is the 2026-08-23 amendment in the plan doc's §5.1. (2) The §5.5
parity harness shipped as a DIFFERENTIAL shadow: a converted operator's legacy
handler moves verbatim to `test/compute-engine/type-handler-shadow-legacy.ts`,
and while installed both shapes run on every derivation and any divergence
throws (`checkShadowTypeParity`), so the executing tests are the corpus —
`type-handler-shadow-parity.test.ts` for the dedicated mix, and
`CE_TYPE_PARITY_SHADOW=1` installs the fixture into EVERY suite's module
registry (via `test/jest-config.ts`) so a full-suite run is the full corpus. The
shadow already earned its keep: its dual review caught the call site
pre-stripping a `handle` operator's LAST operand type, which made
`Coalesce(1, m)` with `m: integer | missing` falsely promise presence — the
strip fold is now gated to `propagate` operators and the contract is pinned.

**RETIRED 2026-09-03: every step of §5.3 is done and the expressions shape is
gone.** By ruling, the N+1 warning release was skipped and the 129 handlers
still on the old shape were converted in one round (five file groups, each with
a verbatim legacy fixture and a parity suite, then a full-suite run with every
fixture installed); the same delivery deletes `typeHandlerKind`,
`OperatorTypeHandlerOnExpressions`, the `operandTypes` handler option,
`library/type-handlers.ts`, the shadow registry and every fixture. Residues
accepted in the round, all in the widening or "descriptor proves more"
direction: radical literals decline in `Element`; NaN and `~oo` behind a wide
declaration are indistinguishable to a descriptor (handlers decline instead of
claiming); a symbol's held tuple behind a scalar declaration is invisible to
`Abs`; the ring-constant arms of `Subscript`/`At` match by name and set shape
rather than binding identity; a point accessor over a symbol whose declared
element type is wider than its held content answers `unknown`. Two rows were put
to a ruling the same day. (1) `Pipe`'s static type was tighter than the
evaluated lazy `Map` node's type (`list<boolean^3>` against
`list<broadcastable<boolean>^3>`): RULED (b), one source of truth — the pipe now
builds its implicit `Map` from the RAW stage and canonicalizes it as a whole, so
the `Map` stamps the parameter with the element type and both types agree
(`pipeImplicitMap`, `library/core.ts`; pinned in `functions.test.ts`). Still
OPEN on the parse route: a LaTeX shorthand stage (`[1,2,3] |> \_^2`) reaches the
handler as a bare application mentioning `_`, not as a function literal, so the
static type is `unknown` while evaluation maps to `vector<integer^3>`; the
static handler could read such a stage as the shorthand literal the evaluate
route treats it as. (2) A `Map` whose element type cannot be derived echoes a
non-collection source unwrapped: RULED keep (a). The only program that reaches
it is a `Map` over a scalar, which evaluation refuses, and the pipe's and the
explicit `Map`'s evaluated nodes already disagree on its type, so no derivation
has a target to match. History of the migration follows.

Step 3 (mass conversion) was IN PROGRESS — batch 1 landed 2026-08-24: 39
handlers across `number-theory` (whole file), `distributions`, the nullary
`combinatorics` handlers, and `DigitCount`/`Block`/`When`. Nullary constant
handlers are RETIRED outright (user-suggested): the constant result moves into
the declared signature (`(integer) -> finite_integer`) and the handler is
deleted — ledgered with the declared results in `RETIRED_CONSTANT_TYPE_HANDLERS`
and pinned. Operand-reading handlers convert with verbatim legacy copies in the
shadow fixture and per-operator corpus coverage. ⚠️ The retirement class has a
hard boundary: a constant handler answering bare `number` or `finite_number`
must NOT be retired into the signature — those two result spellings are exactly
what activates the no-handler fallback narrowing at the type-derivation call
site, so deleting such a handler CHANGES derived types. A retiree whose constant
claim is itself UNSOUND off the operator's domain gets a domain-gated `'types'`
handler instead, never a promoted signature
(`GammaRegularized`/`BetaRegularized` were caught claiming `finite_real` while
`GammaRegularized(-1, 2)` is NaN — they now gate on proven positivity/range, and
an unproven fact claims `number`).

The RETIREMENT SWEEP of the nullary handlers outside batch 1's files followed on
2026-08-24 and is DONE: nineteen candidates in `arithmetic`, `collections`,
`core`, `linear-algebra`, `regexp`, `special-functions`, `statistics` and
`trigonometry`, of which ten retired and nine were corrected instead. (The
bare-`number` statistics handlers — `Mean`/`Median`/`Variance`/… — were never
candidates: their result spelling is the fallback trigger above, and their
absence-absorbs-to-NaN behavior depends on it.) The nine pure deletes, whose
declared signature already claimed exactly what the handler returned, were
`Length`, `Keys`, `Any`, `All`, `Position`, `ArgMax`, `ArgMin`, `TypeFrom` and
`RegExp`; `Rank` was promoted from a bare `number` result to
`(value) -> finite_integer`, which is what its handler had been supplying. That
leaves 44 entries in the retirement ledger (`RETIRED_CONSTANT_TYPE_HANDLERS`,
`test/compute-engine/type-handler-shadow-legacy.ts`): 34 from batch 1 plus
these 10. The other nine candidates were caught by the soundness gate — each
claimed a type that its own values contradict at NaN, at infinity, or off the
real line — and now carry domain-gated `'types'` handlers, pinned in
`type-handler-parity.test.ts` with no shadow entry (the change from the old
claim IS the point): `Sinc`/`FresnelS`/`FresnelC` (all three numericize to NaN
at NaN and are complex-valued off the real line),
`Covariance`/`PopulationCovariance`/`Correlation` (one NaN or ±∞ data value
makes the whole statistic NaN), `Heaviside`/`Sign` (defined on the reals only —
no value at NaN, at `~oo`, or off the real line) and `LogIntegral`, which was
first taken as a pure delete and pulled back out of the ledger when review
showed its declared `real` result unsound: `LogIntegral(NaN).N()` is NaN, which
`real` does not admit, and li(x) = Ei(ln x) is complex for a negative argument.
Six of the nine are declared broadcastable — `Sinc`, `FresnelS`, `FresnelC`,
`Heaviside`, `Sign` and `LogIntegral` — and for those the result-typing code
re-adds the operand's lifted shape around the scalar type the handler returns,
so each gate reads a collection operand through its fully unwrapped element type
(`broadcastOperandType`, `library/type-handlers-types.ts`), which is what keeps
`Sinc([1, 2])` at `vector<finite_real^2>`. The three paired statistics are the
opposite case: `Covariance`, `PopulationCovariance` and `Correlation` are
declared `broadcastable: false` because the dataset IS the operand, so their
gate reads the collection type whole. The defects the sweep's probes surfaced
are recorded as open items below, under "Left open by the type-handler
retirement sweep". `Binomial`/`Choose`/`Pochhammer` were converted and REVERTED
by the batch's dual review: their pole-widening sign gates can be proven by
operator `sgn` handlers on compound operands — a channel descriptors did not
then carry — so converting narrowed the claim, which the parity rules forbid.
The O7 sign-channel audit has since executed (2026-08-24, record at the plan
doc's O7 open item): the `sgn` handler family is certified pure (the two
evaluating handlers, `Random` and `Count`, were rewritten against literal-only
readers), `describe()` now consults the handlers for applications, and every
recorded sign-channel divergence in `type-handler-twins.test.ts` closed. The
once-held heads have since converted (2026-08-25, sixteen operators: the trio,
the Γ family, `PolyGamma`, `Factorial`/`Factorial2`, `Ln`/`Log` and
`Cot`/`Csc`/`Coth`/`Csch`), with their legacy handlers frozen in the shadow
fixture and sign-channel witnesses in the parity corpus; the plan doc's §5.3
status has the batch record. The nine bounded inverse trig heads followed
(2026-08-25, by ruling): their conversion ADOPTS the descriptor shape's stronger
ranged-type channel — a declared range or a ranged result type now proves domain
membership (`Arcosh(BIG)` with `BIG: real<2..>` types `finite_real`), while
exact literals with no machine value widen per the accepted rational-literal
residue — so they run no shadow parity, and the changed rows are recorded in the
twins divergence tables and pinned in `type-handler-parity.test.ts`. The
`typeFact` helper (three-valued `isInteger`/`isReal` replacement) shipped with
the batch, and `describe()`'s `finite` fact now reads a held number value, so a
wide-typed symbol holding `±∞`/`NaN` answers `finite: false`.

The descriptor twins of the shared helpers in `library/type-handlers.ts` landed
next, in `library/type-handlers-types.ts`, with a direct A/B suite
(`test/compute-engine/type-handler-twins.test.ts`) that runs both shapes over a
44-row operand battery and asserts the mismatch set against an explicit
divergence table — a new divergence and a vanished one both fail. That unblocks
the numeric families. Two twins stay blocked on the same sign-channel gap as
`Binomial`/`Choose`/`Pochhammer` (`gammaPoleType` and the log heads), and the
audit surfaced one unsound expressions-shape arm, fixed in the same round:
`Sinh`/`Cosh`/`Tanh`/ `Sech` took their real-infinity branch on
`isReal === true`, which a NaN literal answers `true`, so they claimed a finite
or non-finite type for a value that is NaN.

What remains here: the rest of the ~210 pure handlers (§5.3 step 3 — next up:
the numeric families now that the twins exist, then the structure-bound
control-structure / core handlers and the collection files), the seven
impure-handler rewrites (§5.4), `context.derive` for the handlers that type an
application they do not hold, and the old shape's deprecation (release N+1) and
removal (N+2) — the removal includes deleting the `@fixme`-tagged shadow-parity
apparatus wholesale (the registry's doc comment, `_legacyTypeHandlerShadow` in
`boxed-expression/operand-descriptor.ts`, lists every piece).

Left open by the type-handler retirement sweep and the helper-twins audit that
followed it (2026-08-24), all found by probing operators at NaN, ±∞, complex,
and out-of-machine-range arguments:

1. Several signatures still declare `-> real` for functions whose value is NaN
   at a NaN argument, and `real` does not admit NaN. `LogIntegral` was the
   instance the sweep caught, and it is fixed: it now carries a domain-gated
   `'types'` handler and a `-> number` declared result. The hole is a property
   of the SIGNATURE, though, and other `-> real` heads share it. Auditing that
   family — deciding per operator between a domain-gated handler and a widened
   declared result — is its own pass.
2. `Divide` of two bignum operands returns NaN when both machine projections
   underflow to `-0`. With `ce.precision = 500`, dividing two bignum values
   around `-3.18…e-401` — each carrying its full decimal expansion, but with
   `.re === -0` — evaluates to NaN: the division takes the machine fast path off
   the `.re` projection instead of the bignum channel the operands actually
   hold. This makes relative-error computations on sub-`1e-324` bignums
   unusable. The fix belongs in the division fast-path gate (the
   `arithmetic-mul-div` machine-path selection): a machine projection that has
   underflowed must not be allowed to stand in for a bignum operand. Found while
   writing the high-precision Fresnel regression tests, which work around it by
   comparing decimal expansions instead of dividing.

3. Define ONE semantics for operator signatures and invalid arguments, and apply
   it across the library (user-directed 2026-08-24, accepting the current state
   as interim). Today the library is deliberately permissive but inconsistent
   off an operator's mathematical domain, in three ways. (a) NaN handling:
   `Sin(NaN).N()` and `Sinc(NaN).N()` propagate to NaN, while `Heaviside(NaN)`
   and `Sign(NaN)` stay inert symbolic forms — an artifact of predicate-based
   evaluate handlers with no numeric kernel, not a ruling. (b) The meaning of a
   declared result: it is sometimes read as an unconditional promise over
   everything the parameter type admits (the reading that forced the corrected
   operators onto wide `-> number` declarations with proof-gated `'types'`
   handlers) and sometimes as a happy-path claim. (c) Parameter types
   deliberately admit values the operator has no value for (`Heaviside(1+2i)`
   boxes and stays symbolic rather than erroring), so the mathematical domain is
   not expressed in the signature at all. (d) A declared result can be plainly
   contradicted by an overload the signature does not distinguish:
   `LinearRegression` declares `-> tuple<number, number>` and `PolynomialFit`
   declares `-> list<number>`, but both accept an optional trailing variable
   symbol and then return the FITTED EXPRESSION —
   `LinearRegression([1, 2, 3], [2, 4, 6], x)` is `2x`, typed
   `tuple<number, number>` before evaluation and `finite_number` after. The
   declaration describes only the no-variable overload. The pass should choose:
   what a signature's result means (codomain sort vs value promise), what its
   parameters mean (admission filter vs mathematical domain), and one per-class
   convention for off-domain arguments (propagate NaN, stay inert, or error) —
   then sweep the library to it. Item 1 (the `-> real` family's NaN holes) is a
   special case that folds into this pass.

4. `Covariance`, `PopulationCovariance` and `Correlation` declare a
   `finite_real` result whenever the operand types prove every data value is a
   finite real (`pairedStatisticType`, `library/statistics.ts`), but data large
   enough to overflow the machine sums of squares makes all three answer a
   non-finite value, which `finite_real` does not admit: at machine precision
   `Covariance([1.5e200, 2.5e200, 3.5e200], [1.5e200, 2.5e200, 3.5e200])` is
   typed `finite_real` and evaluates to `+oo`. This is NOT a soundness hole in
   the declaration: the engine-wide convention is that a declared type describes
   the MATHEMATICAL value, and an artifact of the machine-precision
   approximation does not falsify it. `Exp(1000)` settles the convention — it is
   typed `finite_real<0..> & !0` while its `.N()` at `ce.precision = 'machine'`
   is `+oo`, and nobody proposes widening `Exp`'s declared result to `number`
   because of it. What is left here is therefore a question about the numeric
   path, not the type: whether the bivariate statistics should compute their
   sums of squares in a way that survives machine-range data (scaling the data,
   or routing through the bignum lane the way the default precision already
   does), so that finite data gets a finite answer at machine precision too.
5. Assumption bounds are recorded with direction-blind machine rounding.
   `boundsFromNormalizedInequality` (`constraint-subject.ts`) accumulates an
   inequality's constant terms in a JavaScript number, so an exact bound the
   machine cannot represent is rounded to nearest in EITHER direction before it
   is stored — and every consumer (the `cmp` comparison predicates,
   `signFromBounds`, the descriptor `bounds` fact) then treats the stored value
   as exact. A lower bound rounded UP over-proves: canonicalization already
   folds `assume(v > 1 − 10⁻³⁰)` to a stored strict bound of exactly 1, from
   which every channel "proves" `v > 1` — refuted by `v = 1 − 10⁻³¹`. Sound
   recording rounds a lower bound DOWN and an upper bound UP (weakening only),
   or stores the exact bound expression and lets each consumer project it with
   its own direction awareness. The descriptor fact already refuses a STORED
   bound whose machine projection is inexact (`describe()`'s `machine` gate),
   but it cannot see rounding that happened before storage. Both handler shapes
   read the same store, so this predates the descriptor channel and is not a
   conversion regression. (A further item — `BoxedNumber.isOdd` reading the
   parity of a bigint's ROUNDED double past 2⁵³ — was fixed in the same round:
   parity now comes from the exact integer channel, and the regression battery
   lives in `test/compute-engine/numbers.test.ts` under "PARITY OF INTEGERS
   BEYOND THE SAFE RANGE". A `FresnelS`/`FresnelC` stack overflow at huge
   arguments — `bigFresnel` escalating `BigDecimal.precision` to `Infinity` —
   was fixed then too, pinned in `test/compute-engine/fresnel.test.ts`. Two more
   were fixed on 2026-08-24 after the user ruled on them: the bivariate
   statistics used to project complex data onto its real part and answer as if
   the imaginary parts had never been given — `Covariance([1, 1+2i], [2, 3])`
   returned `0`, the covariance of `[1, 1]` — and now return an
   `incompatible-type` error naming the real constraint and the offending datum,
   in both accepted input forms and in the `LinearRegression`/`PolynomialFit`
   siblings that share the same extraction path; and `Correlation` now
   propagates NaN for any data it has no real value for — NaN, ±∞ and `~oo` —
   the way `Covariance` always did, instead of reporting a variance of zero that
   the data does not have. Its "zero variance" error is now raised only when a
   column is genuinely constant, which also removes it from finite data whose
   sums of squares overflow. Both are pinned in
   `test/compute-engine/statistics.test.ts` under "Bivariate statistics reject
   non-real data". The one-sample statistics had the same real-part projection
   and were resolved the same day, by a ruling that splits them rather than
   rejecting uniformly: `Mean` now returns the COMPLEX mean (`Mean([1, 1+2i])`
   is `1 + i`, exactly, because the mean is linear and needs no convention);
   `Variance`, `PopulationVariance`, `StandardDeviation` and
   `PopulationStandardDeviation` compute `E[|X − μ|²]`, a real non-negative
   answer, with the divisors they already used; and every order-based or
   higher-moment head — `Median`, `Mode`, `Quartiles`, `InterquartileRange`,
   `Skewness`, `Kurtosis`, `Histogram` and `BinCounts` — raises the same
   `incompatible-type` error, because there is no canonical order on the complex
   plane and no convention-free complex extension of the standardized moments.
   Pinned in the same file under "One-sample statistics on complex data".)

(The two questions this list opened as item 0 were ruled on 2026-08-24 and are
implemented, so the item is gone. (a) `Histogram` and `BinCounts` now ERROR on a
datum or an explicit bin edge with no finite real reading — `NaN`, a real `±∞`,
or `~oo` under either spelling — with the same `incompatible-type` shape the
complex rejection uses, naming the `finite_real` constraint
(`dataConstraintError`, `library/statistics-data.ts`). They cannot absorb such a
value the way `Mean` does, because their result is a vector of COUNTS with no
reading for "unreadable", and the drop they used to perform answered a different
question than the one asked. A third refusal came with it: a value that IS a
finite real but exceeds the double range the binning computes in (`10^400`) gets
an `out-of-range` error naming that range, because the limit belongs to the
kernel and not to the value — calling such a datum "not a finite real" would
contradict its own `finite_integer` type. Pinned in
`test/compute-engine/statistics.test.ts` under "Histogram/BinCounts reject
values they cannot bin". (b) `Re` and `Im` are now defined, as canonical-rewrite
aliases of `Real` and `Imaginary` (`library/complex.ts`), matching the `Arg` →
`Argument` alias beside them; the `\Re` and `\Im` LaTeX commands already parsed
to `Real`/`Imaginary` and are what the serializer emits, so the dictionary
needed no change. Each alias validates its argument list and derives its type
through its target, so the two spellings of one function cannot disagree —
before this, `Arg(1, 2)` silently dropped the second operand and `Re(NaN)`
claimed the type `real` on the structural route. Pinned in
`test/compute-engine/complex-argument.test.ts`, beside the `Arg` alias tests.

Ruled the same day and implemented with them: `LinearRegression` and
`PolynomialFit` PROPAGATE NaN for data with no finite real reading, instead of
letting the Gaussian elimination decide. A non-finite value in the X column made
the pivot search find no non-zero pivot and reported
`unexpected-argument: "degenerate data"` — a claim about the geometry of the
sample the data does not support — while
`LinearRegression([[+oo, 2], [2, 4], [3, 6]])` pivoted successfully on a later
row and returned the half-`NaN` tuple `(NaN, 0)`, whose `0` slope is not a fit
of anything. Every coefficient is now `NaN`, in the shape each head declares:
`(NaN, NaN)` for `LinearRegression`, a `degree + 1` list of `NaN` for
`PolynomialFit`, and the fitted expression with `NaN` coefficients when a
trailing variable is given. That is what both heads already answered when the
non-finite value sat in the Y column, so the two columns now agree, and it
matches the covariance family. The `degenerate data` error survives for
rank-deficient FINITE real data, such as
`LinearRegression([2, 2, 2], [1, 2, 3])`. Two neighbouring misdiagnoses went
with it, both of which used to reach that same rank guard: two data collections
of different lengths now report `incompatible-dimensions 2 vs 3`, the error
`Covariance` and the other pairwise heads already use for a length disagreement,
and a sample of fewer than two points now reports `not enough data points` — one
point determines no line whatever its value is, so that fact is reported ahead
of both the NaN propagation and the rank guard, matching what `PolynomialFit`
already said.)

Two exactness holes from the same sweep were fixed on 2026-08-24 as well. `Sqrt`
of an exact radicand too large for the `radical` field used to be computed by
converting the radicand to the engine's numeric format first, so at
`ce.precision = 'machine'` `Sqrt(10^402)` was `Sqrt(+oo) = +oo` instead of
`10^201` — which made `Correlation` of exact, perfectly correlated data around
`1e200` answer `0`, since its exact path divides the covariance by
`Sqrt(vx · vy)`. A perfect square is now detected with bigint arithmetic before
any narrowing, so the reduction no longer depends on the precision setting, and
the same detection reaches exact rationals past the `10^6` radical cliff
(`Sqrt(10^12/9)` is `10^6/3`, not the unevaluated `Sqrt` it used to be) and
their negatives (`Sqrt(-10^12/9) = (10^6/3)i`). When no exact root exists the
float lane still takes it, but from the bignum value whenever the narrowed one
has overflowed to `±oo` or underflowed to zero, so `Sqrt(1/10^402)` is
`1/10^201` at machine precision rather than `0`. The fix is in
`ExactNumericValue.sqrt` (`numeric-value/exact-numeric-value.ts`) and the
regressions are in `test/compute-engine/exactness-regressions.test.ts` under "a
large exact radicand reduces exactly, at any precision", run at both precisions.
One snapshot moved with it and has NOT been updated: `SQRT √(1000000/49)` in
`test/compute-engine/__snapshots__/arithmetic.test.ts.snap` records the old
symbolic `sqrt(1000000/49)`, where the fix now gives the exact `1000/7`.

`Conjugate`, `Real` and `Imaginary` (`library/complex.ts`) lost exactness on an
exact complex operand: `Conjugate(1/3 + 2/5i)` returned the machine float
`0.3333… − 0.4i`, so `z · Conjugate(z)` — the natural spelling of `|z|²` —
answered `0.2711…` where the exact `61/225` was available, and
`Real`/`Imaginary` returned the numeric projection of the component
(`ce.number(op.bignumRe ?? op.re)`, a bignum, and `ce.number(op.im)`, a machine
float) rather than the component itself. An `ExactNumericValue` carries each
part as a rational multiple of a square root, and the three handlers now read
and reassemble those parts — negating the imaginary one for the conjugate — so
`Real(1/3 + 2/5i)` is `1/3`, `Imaginary(√2·i)` is `√2`, and `Conjugate(3 + 4i)`
is an exact Gaussian integer. Inexact and symbolic operands are untouched.
Pinned in `test/compute-engine/exactness-regressions.test.ts` under "the parts
of an EXACT complex operand stay exact".

Design and implementation draft:
`docs/plans/2026-08-22-type-handlers-on-types.md` (third draft, 2026-08-22). The
draft reframes this entry: the GOAL is type derivation that does not modify
engine state (the item-219 pattern); the value-read survey above measured
precision, not side effects. Step 0 (type assertions say which drift they guard
— `expectTypeBetween` in `test/utils.ts`, rule in
`docs/COMMENTING-GUIDELINES.md`) is executed (d3faf62d); residue baseline 57.
Rulings 2026-08-22 (doc §6): declared signatures admit by OVERLAP and check at
evaluation (the arithmetic model; `couldMatch` is comparability, not overlap —
build on D6.2 `overlapsForDeferredValidation`); precision loss accepted; literal
types for `0`/`1` only; a pure facts channel (sign, closedness) beside the
types; `_reviseInferredType` moves to a write site; `Pipe`/`Dot` fixed now. The
"closed complex constants" group above was mis-filed: the lost facts are the
SIGN of `π`/`e` and the CLOSEDNESS `poleReciprocalType` reads via `isConstant`.

### Ranged types — remaining design tasks (OPEN; the interval arithmetic and open-bound halves shipped 2026-08-27 and 2026-08-28)

Each of these is a separate design task left over from the ranged-types line
("Ranged types should carry sign", raised 2026-08-22).

- **Interval arithmetic for `Add`/`Multiply`/`Power` results.** Today the
  join-based result computations deliberately STRIP range decorations from their
  inputs (`stripNumericRanges`, applied in `addType`'s widen tail, the
  `Add`/`Multiply` cell absorption and the broadcastable element join): a join
  is a set union, and a sum does not lie in the union of its terms' ranges —
  `assume(x > −1); assume(y > −1)` typed `x + y` as `real<-1..>` until
  2026-08-23 (`Negate` now REFLECTS a range instead of echoing it,
  `negateNumericType`). Carrying bounds soundly means real interval arithmetic
  on the result side. Until then `|x| + |y|` types bare `real` (pinned as the
  scope boundary in `ranged-result-types.test.ts`), and the widen over TUPLE
  component types in `addType`'s numeric-tuple arm still joins raw component
  ranges (sound for the non-negative components literals produce; an
  assume-ranged negative bound inside a tuple sum is the same defect class, now
  stripped there too).
- **Literal types for STRING and BOOLEAN literals.** The public `.type` of a
  number literal is its value (`ce.box(21).type` is `21`, shipped 2026-08-23);
  `ce.string('a').type` is still `string`. Neither measured nor ruled, and the
  impact on Tycho is unknown until measured from Tycho's side.
- **A value-bounded type variable rejects its own literal.** A declared
  `(x: T) -> T where T: 5` applied to the literal `5` errors with
  `incompatible-type` — the solver binds tiers, never value types, so `T` binds
  `finite_integer`, which fails the declared bound `5`. Pre-existing (verified
  at commit 5720d468, before the public-type flip); found by the O9 dual review,
  2026-08-23. Only the Epsil lexer test exercises the spelling
  (`type-variables-epsil.test.ts`, a token-boundary pin), so nothing observable
  depends on it today. A fix would keep the unwidened actual for a variable
  whose declared bound has a value component.

Historical note from the user: the lattice once had `positive_integer` and
similar named types, simplified away; ranges are the replacement they should
have been connected to.

### Nightly type-soundness grid: 6 binary arithmetic suites fail on a range-granularity artifact — OPEN 2026-08-31 (pre-existing; found while running the grid for the Sign Phase F flip)

`CE_NIGHTLY=1` on `test/compute-engine/nightly/type-soundness-grid.test.ts`
fails the `Add`/`Subtract`/`Multiply`/`Divide`/`Power`/`Root` suites (18–21
cells each; unary suites all pass). Reproduced identically at HEAD `ec3c8456`
with and without the Sign-flip changes, so the class is not new. The shape, from
a sample cell: `Add(2/3, 0.5)` gets the static claim `real<1.16..1.171>`
(interval propagation), evaluates to the big-decimal `1.1666…67`, and that
VALUE's own literal type is spelled with coarser bounds — `real<1.1..1.2>` —
which is a WIDER interval, so `isSubtype(evalType, staticT)` fails even though
the value lies inside the static range. The value is right and the static claim
is right; the disagreement is between two range-spelling granularities (the
evaluated literal's range keeps fewer digits than the interval propagation). To
close: either the evaluated big-decimal literal's range spelling keeps enough
digits to stay inside propagated claims, or the grid's oracle should compare the
VALUE against the static range instead of comparing the two range spellings.
Nightly-only, so no default-suite impact.

### Type derivation reaches state mutation at 7 handlers, 2 `elttype` handlers and 1 getter — AUDITED 2026-08-22 (OPEN, defects; the GETTER half is FIXED 2026-08-22 — `_reviseInferredType` no longer writes on read (R4, plan §4.2); the 7 handlers and 2 `elttype` handlers remain scheduled by the type-handler design)

A transitive call-graph audit (depth ≤ 8) of every `type:` handler in
`library/*.ts` — 220 arrow-form handlers plus ~65 string/named entries — for the
side-effect pattern behind item 219 ("Reading a nested lazy view's type was
exponential in depth": a type derivation that writes engine state invalidates
the caches it is filling). 213 handlers reach only pure leaves. The exceptions,
each a live or latent instance of the 219 pattern:

- `Pipe` (`library/core.ts`, `pipeImplicitMapType`): canonicalizes both held
  operands to decide implicit mapping, and `canonicalWithFreshPlaceholders`
  (`src/compute-engine/function-utils.ts:1546`) declares the placeholder into a
  scope that is NOT registered in `_scratchDeclarationScopes` — so every type
  read of a `Pipe` stage advances `_anyVersion` and retires every `_type`/`_sgn`
  memo mid-derivation. Memoized on `_anyVersion`, which the read itself moves.
  FIXED 2026-08-22 for the placeholder declarations (`scratchDeclarations`
  option, pinned in `pipe-type-read-purity.test.ts`): drift per re-derivation 2
  → 1. The residual advance is the literal's own parameter declared into a
  `block.localScope` the canonical literal keeps — not exemptable under the
  scope-targeting rule (doc §4.1, open item O5).
- `Dot` (`linear-algebra.ts`, `innerProductType`): builds and canonicalizes n+1
  `Multiply`/`Add` applications per type read, no memo. The audit's "`_infer`
  reachable" claim did NOT reproduce (measured: drift 0 on 20 shapes); the cost
  is ≈44 µs of allocation per re-derivation, and a canonicalization-free rewrite
  NARROWS two declared-symbol rows (doc §4.1, open item O6). Today's table is
  pinned in `dot-type-read-purity.test.ts`.
- `Set` (`collections.ts`, `parseSetComprehension`, reached from the `type:`
  handler and from `Set.elttype`): canonicalizes the domain/condition
  sub-expressions (auto-declare, `_infer` writes reachable), no memo; and
  `Set.elttype` EVALUATES each domain element (`enumerateSetComprehension`).
- `Interval.elttype`: `.N()` on both endpoints (`numerics/interval.ts`).
- `JacobianMatrix` (`calculus.ts`): canonicalizes its operand and beta-reduces
  via `resolveToList`, no memo.
- `Sqrt` (`arithmetic.ts`, `closedRealSign` in `library/type-handlers.ts`):
  `x.N()` during a type query — guarded (`isPure`, no unknowns), recorded for
  completeness.
- The getter: `op.type` on a symbol whose recorded type is INFERRED and
  refutable runs `_reviseInferredType`
  (`boxed-expression/boxed-value-definition.ts`), which journals a `type-write`
  and advances `_anyVersion` — a read that moves the cache axis, reachable from
  any of the 213 pure handlers. The code calls it a deliberate bounded
  exception; by the 219 standard it is the pattern.

Not traced: dynamic `def.type`/`elttype` dispatch edges beyond the two `elttype`
handlers above, and call depth > 8. Full table (file:line for every claim) in
the audit recorded by `docs/plans/2026-08-22-type-handlers-on-types.md` §2.5;
the design's success criterion — item-219 drift 0 with the `scratch` exemption
made a no-op — is what closes each row.

### Epsil pre-pass misses argument errors at a LAMBDA callee (OPEN, lint — found 2026-08-23 implementing evidence path 2)

`let k = (n: integer) => n + 1` followed by `k(1.5)` produces NO
`static-type-error` from the pre-pass, while both named-head spellings —
`let k: (integer) -> integer` and `k(n: integer) = n + 1` — flag the same call.
The cause is not the pre-pass's error extraction: for a callee that is a VALUE
definition holding a function literal, argument refusal is DELIBERATELY deferred
to evaluation by the R1 runtime-conformance design (the
`filter-predicate-errors` pins require a lambda applied to a wrong concrete
value to produce its `incompatible-type` error VALUE at run time), so the
valueless pre-pass boxes the call clean and has nothing to mint. The engine
behavior is by design; only the LINT wants more — the same "linter stricter than
the engine" principle as the evidence path-2 ruling (2026-08-23). Fix shape: a
pre-pass-side check that walks each statement's canonical form for applications
whose callee resolves to a signature-typed value definition and tests the
CONCRETE literal arguments against the parameters by reusing the §4.4
runtime-conformance helper (`runtimeConformanceError`) statically — never
re-implementing the verdict — minting the same diagnostic the named routes get.
Care: per-arm overload verdicts, no double-flag when the named route already
errors, symbolic arguments stay silent (that is evidence path 2's job).

### `Complex` drops its `number` contract on the literal route (OPEN, low — found 2026-08-23 by the canonical-rewrite inventory)

`Complex` (`(number, number)`, no canonical handler) canonicalizes to
`Add(re, ImaginaryUnit·im)`. The dropped `number` contract is re-caught by the
arithmetic evaluate guard on the symbol route, but the literal route builds a
machine complex directly, so `Complex("str", 2)` yields `NaN` where the symbol
route errors. Adjacent to, but not part of, the canonical-rewrite contract class
closed 2026-08-24 (a canonical rewrite to another head now re-validates against
the original head's stricter parameter contract).

### A pre-canonicalization validation phase (OPEN, design — raised by the user 2026-08-21 at the item-219 ruling)

Item 219 is the second time a computation has needed to VALIDATE an expression —
decide what it is or what it would produce — without perturbing the environment,
and has had to buy that with a scratch scope plus an exemption from cache
invalidation. The `Pipe` implicit-map type handler (`PIPE_IMPLICIT_MAP_TYPE`,
`library/core.ts`) is the first: it canonicalizes held operands to decide
whether a stage implicitly maps, and pays for it with a memo recording the
generation observed AFTER the derivation.

The idea, as raised: give the engine a pre-canonicalization phase whose job is
validation, which regular canonicalization would call, and which internal
constructions could SKIP in favour of a cheaper validation-less
canonicalization. A probe that needs only "what type would this application
have" would then run the cheap path and never declare at all, which removes the
need for a scratch-scope exemption rather than making it safe.

Not scoped or scheduled. Recorded because the two existing workarounds are
individually sound but structurally identical, and a third instance is the point
at which the general mechanism is worth more than another local exemption.

### Cross-term CSE could partition a region by index-dependence (OPEN, design note — deferred from the `Sum` unroll round, 2026-08-19)

A `Sum`/`Product` with compile-time-constant bounds and at most 100 terms
unrolls into a flat operator chain (`UNROLL_LIMIT`,
`compilation/javascript-target.ts`). The unroll arm opens a FRESH CSE region per
term by design: the same body nodes are compiled once per index value, so a
node-keyed reuse across terms would emit term 1's temporary for every later term
— silent wrong values. Hoisting an index-independent subexpression out of the
terms is therefore a separate, deliberately narrow mechanism, and today it
covers COLLECTION-valued subexpressions only (`hoistLoopInvariants`, gated by
the CSE admissibility predicate; pinned by
`test/compute-engine/compile-sum-unroll-guards.test.ts`).

Nothing is known to be wrong with that. This entry records the shape of the
principled fix should more hoist sites of this kind appear: partition a region's
candidate set by index-dependence inside `compilation/cse.ts`, rather than
adding further local hoists next to the collection one. Doing that speculatively
is not worth it — the narrow mechanism already covers the reported case, so this
waits for a second witness.

### A product of two points could name its alternatives (OPEN, diagnostics — consumer feedback 2026-08-19)

`Multiply` of two tuples is correctly rejected (`tuple · tuple` has no implicit
product — the `Dot` definition in `library/linear-algebra.ts` records the
ruling), but the report is a bare `incompatible-type "number" "tuple"` that
surfaces wherever the product was consumed, far from the source spelling.
Because `\times`, `\cdot` and juxtaposition all parse to the same `Multiply`, a
user who WROTE a cross product between two points gets no pointer toward what
they meant. The consumer that reported this traced a five-mechanism blank-render
hunt to exactly this shape (their importer preserved the `Multiply`; the error
surfaced rows away) and noted a single message would have collapsed the hunt.
The improvement: when both rejected operands of a `Multiply` are tuple-shaped,
say so — "no product is defined between points; `Dot(a, b)` is the inner
product, `Cross(a, b)` the cross product" — instead of the generic type report.
The rejection site is `checkNumericArgs` (`boxed-expression/validate.ts`); the
message likely wants an `ERROR_EXPLANATIONS` entry so the CLI/editor surfaces
carry it too.

### A symbol value that mentions a function parameter's name is folded INLINE by the compiler but resolved to the GLOBAL by the interpreter (OPEN, ruling — found 2026-08-29 while pinning the folded-value binder rule)

Inside an emitted user-function body the compiler folds a symbol's value INLINE,
so a value that mentions the function's parameter name reads the parameter: with
`a := 3t + 1` and `g(t) := t + a`, compiled `g(2)` is 9. The interpreter
resolves the value's `t` to the GLOBAL `t` — symbol-value resolution skips a
foreign call-frame activation — and answers `2 + (3t + 1)` with the outer `t`.
The two disagree whenever a value mentions a parameter name of a function that
reads it. Whichever side is right is a ruling on the activation-skip rule (the
2026-08-21 symbol-resolution round in `docs/plans`); the compiler side was left
as it was. Pre-existing, not introduced by the folded-value preamble.

### Compiling a DAG-shared symbol value on the inline targets still refuses above the fold-size guard (OPEN, no urgency — the JavaScript-family targets were resolved 2026-08-29)

On the `javascript` and `interval-js` targets a symbol's compound pure value is
emitted once as a preamble local (`ensureFoldedValueEmitted`,
`base-compiler.ts`), which closed the exponential emission of Tycho item 225.
The inline targets (Python) still fold a value into the emission per reference,
so `MAX_FOLD_EXPANDED_NODES = 20 000` (`expandedFoldSize` /
`assertFoldableSize`, `base-compiler.ts`; ruled fail-closed 2026-08-23) refuses
the pathological DAG-shared tower there: the public `fallback: true` route
degrades to interpreted evaluation, the direct registered-target route throws
(pinned in `compile-fold-size-guard.test.ts`). The remaining levers are the same
preamble binding on those targets, or a runtime-binding channel (a `_SYS`
engine-value lookup) so a compiled member survives instead of falling back —
Tycho's ledger prefers the latter. The consumer states NO URGENCY: their macro
pipeline now binds document functions as by-reference lambdas, and the item-225
witness (`art/nxlddeh5zv`) no longer OOMs, though its interpreted member sweep
still exceeds 300 s on the fallback.

### Static broadcast unroll for the compile route — elementwise `Which` over statically-sized collections at `glsl`/`interval-js` (OPEN, demand-gated — opened 2026-08-19 from Tycho item 206)

The evaluator broadcasts `Which` elementwise over collection-valued operands
(shipped for Tycho item 193 in 0.112.0), and the `javascript` compile target
lowers the same shape (`compileJSSelection`, `javascript-target.ts`). The `glsl`
and `interval-js` targets fail closed instead — correctly, given their value
models: the interval target holds one interval per quantity (no collection
values, by design), and the GPU elementwise selection (`compileGPUSelection`,
`gpu-target.ts`) only lowers static `vec2`–`vec4` shapes. Tycho's Voronoi
second-minimum idiom (`Min(Which(d == m, 10^9, True, d))` with `d` a broadcast
expression over a 20-point `PointList` literal) therefore declines at both
targets even though every collection operand has a compile-time-known length.

The clean design is NOT per-target: a target-independent static broadcast unroll
before target lowering. When every collection leaf in the `Which` clauses is
statically enumerable (materialized `List`/`PointList`/`Range` literals) with
one common length N, project the broadcast expression per element and rewrite to
N scalar selections — the compile-route twin of the evaluator half. The
consumers already exist: `compileGPUExtremum` folds compile-time component lists
of any length, and the interval `Min`/`Max` handlers fold n scalar arguments.
The projection transform must be conservative — fail closed whenever a
collection subterm is not statically enumerable, lengths disagree, or an
index-sensitive operator (`Sort`, `Unique`, …) sits between the leaf and the
selection, since those are not positionwise maps.

Two cautions recorded while scoping (2026-08-19 probes against source at
0.115.0):

- On `glsl` the unroll alone is NOT sufficient for the witness: `Power`/
  `Square` of a vec operand with a scalar exponent independently fails closed
  (`_gpu_powi` is declared scalar-only, and the `pow` builtin requires matching
  genTypes) — a known hole pinned in
  `test/compute-engine/compile-gpu-shape-gate-holes.test.ts`. Unrolling to
  SCALAR selections sidesteps it for the idiom (each projected element is
  scalar), but any design that instead lifts the vec-width cap runs straight
  into it.
- The `javascript` target already compiles the exact witness shape and returns
  the correct second minimum (verified by hand against the 20 distances), so the
  consumer-facing urgency is low: Tycho was told (item 206 answer, 2026-08-19)
  to retry `to: 'javascript'` before dropping to the interpreter-backed
  fallback, and to unroll on their side if they need GPU-shaded rendering before
  this lands.

Demand-gated: pick this up if Tycho (or another consumer) reports that the
compiled-JS sampling path is not enough — e.g. an implicit-curve row that needs
interval arithmetic for robustness, or a shaded-region row that needs the shader
target.

**Demand measured at zero (2026-08-20).** Tycho retracted the escalation after
measuring against 0.116.1: the blocker was on their side, one layer upstream of
the compile route — a collection-carrier predicate that consulted their own
definition table, returned early on a miss, and never reached its type arm, so a
carrier owned by their computed-collection registry answered "not a collection"
while their type predicate said it was. With that fixed, the witness expressions
take the elementwise zip lowering and never construct a collection-valued
`Which` at all; both remaining witnesses render. The two other expressions
originally named were retired as never having been witnesses (neither reads the
collection-valued definition; it appears only as its own definition head).
Caveat recorded by the reporter: their oracle fix was still uncommitted in a
working tree when measured, so this is "stop scoping", not "cause proven
landed". The two cautions above about the `glsl` `Power`-of-vec hole and the
vec-width cap remain accurate and remain unmotivated by any consumer.

### LSP navigation: two tracked gaps in the occurrence resolver (OPEN, vscode-epsil — opened 2026-08-19)

The extension's navigation/rename features (go-to-definition, references,
highlights, outline, rename — served by `src/epsil/occurrences.ts` over the raw
AST's `sourceOffsets`) ship with two deliberate, refusal-guarded gaps:

1. **Type names are not navigable from their USES.** A use of a declared type
   lives inside a type-annotation STRING (`let p: Point` parses `Point` as
   `{"str": "Point"}`), which the resolver does not enter, so go-to-definition
   on the annotation returns nothing and references from a `type` declaration
   list only the declaration. Rename of a type/protocol name is REFUSED for the
   same reason (pinned by `vscode-epsil/test/lsp.test.mjs`, "rename refusals"),
   so nothing corrupts — but read-only navigation would need a type-string
   sub-lexer that maps identifier spans inside the annotation back to document
   offsets (the annotation node's `sourceOffsets` give the string's own span to
   anchor from).
2. **Named-argument labels are not tracked as parameter occurrences.** A call
   `f(x: 3)` binds by the parameter's NAME
   (`["NamedArgument", {"str": "x"}, …]`, label a string with a real span), so
   renaming the parameter must rewrite the label too. Until labels are resolved
   to their callee's parameter group (needs call-to-function resolution plus a
   function-group → parameter-groups map in the resolver), renaming a parameter
   whose name appears as ANY label in the document is REFUSED (`renameRefusal`
   in `vscode-epsil/src/server.ts`, pinned by the "rename capture by the library
   and by labels" scenario). Lifting the refusal means recording label spans as
   occurrences of the resolved parameter and keeping the refusal only for
   unresolvable callees.

### Compatibility gate for USER-DECLARED lazy operators (OPEN, demand-gated — opened 2026-08-19)

Design E's compatibility admission covers every eager slot and the library's
lazy collection operators (through their canonical-handler funnel,
`canonicalCallbackOperand`), but a user-declared `lazy: true` operator with an
arrow-typed callback slot still admits every callback until application —
`validateArguments`' lazy branches return each operand before the gate runs.
Closing it takes a read-only planning pass at the lazy branches whose payoff is
narrow by construction: the lazy solve contributes no bindings, so only GROUND
arrow slots could ever be judged, and an unbound operand's type reads `unknown`
(admits everything), so only NAMED callbacks read through a side-effect-free
`lookupDefinition` would be judged at all. Do this when a consumer actually
declares lazy operators with arrow slots, not before. (Recorded with reasoning
in `docs/TYPE-SYSTEM.md`.)

### Element-typed comparator arms need multi-variable union arms (OPEN, type-system — opened 2026-08-19)

The ruled `Sort`/`Ordering` slot spelling was
`((T) any -> unknown) | ((T, T) any -> number)` (Design E §9 item 6), but the
type language enforces "at most one arm of a union may reference a type
variable" — a solver-simplicity constraint predating Design E — so the
comparator arm shipped grounded as `(any, any) any -> number`: arity duality and
honest documentation kept, comparator-side disjointness rejection given up (a
`(string, string) -> number` comparator over an integer list is admitted and
fails per element). Restoring the ruled spelling means lifting the
one-variable-arm constraint in `parseType`/the solve, with its own blast radius
across union solving. Low urgency: the key arm keeps `T`, and no shipped
signature needs the second variable-bearing arm. (Deviation recorded in
`docs/TYPE-SYSTEM.md`.)

### Parameter-side callback inference (OPTION, demand-gated — opened 2026-08-19)

Ruled deferred (Design E R-E3): a callback operand's parameter types never bind
a data-anchored domain variable, so `apply2(IsPrime, x)` leaves `x` `unknown`
where it once inferred `number`, and `CountIf(zs, IsPrime)` leaves
`zs: collection<unknown>` (the ruling's anchor pin — binding it would
manufacture a contract the slot deliberately does not carry, breaking a later
`zs := [1, "a", 2]`). The seam is open in `solveArm`
(`generic-instantiation.ts`): R-E3′ already lets a callback bind variables with
NO data anchor (the ratified `comp`/`both` behavior), so the remaining question
is only the data-anchored case. If a consumer asks for apply-style inference,
the recommended shape is SOFT, PER-CALL, WRITE-FREE bounds: the callback's
parameter types may sharpen the call's instantiation (stamping and result
precision) but are droppable on conflict with any data bound (the union-source
flagship must never conflict) and never reach an `_infer` write (no symbol
narrowing, so the anchor pin holds). Full contribution with inference writes
would need the `zs` KEEP pin re-ruled. Do not build ahead of demand.

### `Print`/`Input` should route through the Stage 4 capability registry (OPEN, effects — opened 2026-08-18)

The console operators (`Print`, `Input`, Epsil `print`/`input`) declare the
`console` effect label but reach the host directly — `console.log` via
`globalThis`, stdin via `process.getBuiltinModule('node:fs')`, the browser
`prompt()` dialog. `docs/EFFECTS-MODEL.md` (Stage 4, unbuilt) specifies the
`ce.effects` handler registry as the seam these operators should consume —
per-engine, mockable, deniable (`null` = capability denial, the sandboxing
primitive). Until it exists, a host can redirect or deny console I/O only by
patching globals; the Epsil MCP server does exactly that (`withHostIOCaptured`
in `src/cli/mcp.ts` — its stdio transport carries JSON-RPC, so program output
must not reach the real stdout, and interactive input must not consume protocol
bytes). When Stage 4 lands: route both operators through `ce.effects.console`,
replace the MCP global-patching with a registry override, and add
denied/overridden-capability coverage.

### A free `i` in a subscript index is the imaginary unit on one canonicalization path and a symbol on the other (OPEN, low priority — consumers have a complete workaround; engine fix explored and reverted 2026-08-21)

Measured on a fresh engine: `A_{i,j}` canonicalizes to
`Subscript(A, Sequence(ImaginaryUnit, j))` — the index `i` becomes the imaginary
unit, and the matrix form `M_{i,j}` to `At(M, ImaginaryUnit, j)`, both
evaluating to `NaN` — while `A_{i+1}` canonicalizes to `Subscript(A, Add(i, 1))`
with `i` a plain `unknown`-typed symbol, and `\sum_{i=1}^{3} A_{i,j}` keeps `i`
as the bound index. The two free-`i` answers come from two code paths in the
`Subscript` canonical handler (`library/core.ts`): a parenthesized or comma
subscript arrives as a `Delimiter` and is canonicalized
(`sub = op2.op1.canonical`), so the engine-wide "unbound `i` is the imaginary
unit" convention applies; any other subscript expression is passed through
UNCANONICALIZED (`sub = op2`), which is what keeps `i` symbolic there — by
accident, and it leaves a non-canonical operand inside a canonical expression.
(A dead arm the handler also carried — a `Sequence` subscript rebuilt as a
`List` with the result discarded, no `return` — was removed 2026-08-21 and is
not part of what follows; it changed nothing.)

**What is actually wrong is the INCONSISTENCY**, not the default. The
engine-wide reading of an unbound `i` as the imaginary unit is right for a
general mathematical user, and changing it would be wrong for anyone doing
complex analysis. What no reading justifies is `A_{i+1}` and `A_{i,j}`
disagreeing, or a canonical expression carrying a non-canonical operand.

**A consumer whose domain has no complex arithmetic should declare the name, and
that is the recommended answer — it is strictly better than the engine change
explored here.** `ce.declare('i', 'integer')`, before anything is parsed, makes
`A_{i,j}`, `A_{i+1}`, `L_i`, `L[i]` and `M_{i,j}` all index by the symbol. It
reaches the bracket and `subscriptEvaluate` paths that an engine-side subscript
fix structurally cannot (below), `integer` rejects a fractional index at the
assignment boundary where `unknown` would pass one through, and round-trips stay
safe because the serializer emits `\imaginaryI`, never a bare `i`. The trade is
that bare-`i` complex literals in that scope become products (`2i` → `2·i`);
`\imaginaryI` remains available for documents that need both. `e` is the
opposite trade — declaring it breaks `e^x` — so it wants per-document scoping
plus `\exp(x)`, which canonicalizes to `Power(ExponentialE, x)` and is
unaffected by the declared variable.

A first engine-side implementation (a `canonicalSubscriptIndex` helper shielding
via `pushScope`/`declare`/`popScope`, plus removing the parser's `At` minting)
was reverted the same day after dual review. Its four constraints stand as the
bar for any future attempt:

- **A temporary shielding scope is not viable.** Canonicalizing the index under
  a pushed scope that declares the constant-named letters as plain symbols, then
  popping it, returns operands bound to a DISPOSED scope. Measured: two parses
  of `A_{i,j}` then answer `isSame === false` (the control `A_{p,q}` answers
  `true`), which breaks the unconditional equivalence relation `.isSame()` is
  documented to be and is relied on as a dedup/matching key. Any undeclared
  sibling name in the same index (`n` in `A_{i+n}`) is also auto-declared into
  the throwaway scope and is then disconnected from a later top-level
  declaration of `n`.
- **The parser's `At` lowering must stay.** Routing collection-base subscripts
  through the `Subscript` canonical handler (so the handler can see the index
  before canonicalization) removes the parse-time `At`, and the RAW form is a
  contract with a consumer: `ce.parse('a_{1}', { form: 'raw' })` must be
  `At(a, 1)`, pinned in `raw-subscript-fold-parity.test.ts` and
  `subscript-declared-name-precedence.test.ts` (10 tests fail otherwise).
- **`At` cannot shield in its own canonical handler.** `At` is not lazy, so its
  operands arrive already canonical — the index has become the constant before
  the handler runs. Shielding there needs `At` to hold its index position, which
  is a wider change than this item.
- **Three paths need the rule, not one.** Besides the two `Subscript` paths, the
  `subscriptEvaluate` branch (a base that owns its subscripts, the
  `declareSequence` shape) returns `Subscript(base, op2.canonical)` and folds a
  free `i` the same way; bracket indexing (`L[i]`) is minted straight to `At` by
  the parser and folds it too. A fix that covers only the `Subscript` arms
  leaves the same index meaning different things by notation.

Taken together these point away from a per-call-site shield and toward a
canonicalization-level mechanism — a way to canonicalize a subtree with
`holdUntil: 'never'` constant substitution suppressed for named symbols, which
every one of the four paths could then ask for. Since the declaration workaround
already covers the consumer case completely, the cheap half of this item is the
one worth doing on its own: make the two `Subscript` paths agree and stop
returning a non-canonical operand, without changing what a free `i` MEANS.

### Symbolic-side commutativity for `And`/`Or` — step 3 (OPEN, demand-gated)

Steps 1–2 (the `eq` handler comparing modulo permutation and nesting, and the
`commutativeMatch` definition flag driving the matcher's permutation branch)
shipped 2026-08-18 — see `CHANGELOG.md` and `logic-ac-equivalence.test.ts`. Step
3 of the agreed design ("Option B", 2026-08-16) — a gated canonical sort inside
`simplify()` so simplification can normalize operand order without touching the
written form or short-circuit evaluation — remains unbuilt by design: skip
unless a concrete workflow needs it.

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
2026-08-15. It stays ungated because the same code path serves block-local `let`
bindings whose writer closures (a closure mutating its enclosing literal's
local) must remain installable, and no global-vs-local discriminator is
available at that seam: the Epsil static pass also evaluates top-level declares
under pushed scopes, so context depth does not separate the two. The arrow it
installs still carries the inferred `scope` label honestly, so the effect stays
visible; what is missing is the refusal.

### `.N()` declines convergent series whose tail is not an integer power of 1/N

The Richardson/Neville acceleration behind infinite-series `.N()`
(`acceleratedInfiniteSum`, `library/utils.ts`) extrapolates the partial sums
with `power: 1` — an asymptotic expansion in **integer** powers of `1/N`. A
convergent series whose tail does not have that shape never certifies, and since
the 2026-08-14 divergence ruling — an infinite-domain big op under `.N()` whose
convergence the acceleration cannot establish now stays unevaluated rather than
returning a truncated partial sum — removed the truncation fallback, it now
evaluates to itself instead of to a number.

Measured 2026-08-14 — the gap is narrow and specific:

| Series                        | `.N()`     | True value   |
| :---------------------------- | :--------- | :----------- |
| `Σ 1/n^1.5`                   | symbolic   | 2.6123753487 |
| `Σ 1/n^2.5`                   | symbolic   | 1.3414872573 |
| `Σ ln(n)/n²`                  | symbolic   | 0.9375482543 |
| `Σ 1/n^2`, `1/n^3`, `1/n^4`   | ✓ computes | —            |
| `Σ 1/2^n`, `Σ 1/n!`, `Σ e^-n` | ✓ computes | —            |
| `Σ 1/(n(n+1))`, `Σ 1/(n²+1)`  | ✓ computes | —            |

So: integer-power p-series, geometric, factorial and rational tails all work; a
**non-integer** power (`n^-1.5`) or a logarithmic factor does not. For `Σ 1/n^p`
the tail is `≈ N^(1-p)/(p-1)`, so the expansion runs in powers of `N^(1-p)` —
the `power: 1` Neville tableau is fitting the wrong sequence.

Two candidate fixes, both standard: extrapolate with a **fitted** power
(estimate the tail exponent from successive partial-sum differences and pass it
as `extrapolate`'s `power`), or apply an **Euler–Maclaurin** tail correction,
which handles the logarithmic factors too. Whichever is chosen must keep the
divergence guarantee: acceptance stays gated on a certified error estimate, so a
divergent series still declines rather than acquiring a plausible-looking value.
Regression-test against the table above, and add `Σ 1/n^1.5 = ζ(1.5)` as the
headline case.

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
set of W distinct length-typed strings in a loop: W <= 2048 costs 0.02-0.11
us/parse, W = 2100 costs ~3-4 us/parse — a ~150x cliff — and stays flat above
it, because clearing drops 100% of entries per overflow so the hit rate
collapses rather than degrading.

Eviction POLICY is not the fix, measured: FIFO eviction of the oldest entry was
slightly worse (5.8 vs 4.3 us/parse over-cap), since a working set larger than
the cache, re-parsed in a repeating order, is the worst case for any policy. The
levers are reducing the number of distinct type strings (cache a
length-parameterized type by structure, with the length as a parameter) or
sizing the cache to the working set.

**Dormant, with a re-open trigger.** No real workload engages it: the largest
consumer document measured mints 329 distinct type strings — ONE of them
length-carrying — with zero overflow clears and a 97.1% hit rate over 11,245
reads, and the hundreds-of-distinct-sizes pressure existed only in a synthetic
probe. So the structural levers stay unbuilt and observability landed instead:
`TYPE_CACHE` reports under `CE_CACHE_STATS` as the `typeParse` class (hits, cold
stores, and `evictClear` — the count of whole-cache overflow drops).
**`evictClear > 0` on a real workload re-opens this item.**

### Boxing a long `1-2-3-…` chain overflows the stack (OPEN, correctness — DEFERRED BY RULING 2026-08-15, found in the 2026-08-15 flat-chain parser round)

The LaTeX parser handles a subtraction chain iteratively and returns a
left-nested `Subtract(Subtract(Subtract(1, 2), 3), …)` (`latexSyntax.parse()`
succeeds at 1 500 terms), but BOXING that result — raw or canonical — recurses
once per nesting level and throws `RangeError: Maximum call stack size exceeded`
from `boxFunctionInternal` (`boxed-expression/box.ts`). So
`ce.parse('1-2-3-…-400')` throws while `ce.parse('1+2+3+…+12000')` succeeds.

Thresholds measured by bisection AFTER the same round's frame-headroom work in
`box.ts` (the `RAW_OPERAND` shortcut, which skips five frames per operand on the
recursive boxing path): 385 terms canonical, 749 terms raw. **Re-bisected
2026-08-19: 507 canonical, 1874 raw** — both improved without anyone targeting
this entry (the raw path by ~2.5x), so intervening frame-budget work moved them.
The defect itself is unchanged: the chain still overflows, just later.
Re-measure before quoting a threshold; these numbers drift with unrelated
stack-depth changes. The raw path is where the headroom landed — it was about
600 before — while the canonical path is essentially unmoved, so the shape a
consumer actually hits (`ce.parse` defaults to canonical) is no better than it
was. The headroom work reduced frames per level; it did not change the fact that
boxing recurses once per nesting level, so this stays a threshold, not a fix.

Pre-existing: reproduced on the pre-fix parser, and not addressed by the flat
chain parser fix of 2026-08-15, which changed the `Add` and multiplicative folds
only.

RULING 2026-08-15 (Arno): stays on the roadmap, not fixed in this round. The two
candidates below are both larger than the round that found it — one changes
`form: 'raw'` output and its pinned serialization, the other is a general boxing
change — and neither belongs in a pass cutting a release. The threshold is
unchanged from what shipped before, so this defers a long-standing limit rather
than accepting a new one.

Two candidate fixes, needing a ruling because the first changes raw parse
output: (a) have the `-` infix parser fold a subtraction run into one flat
`Add(a, Negate(b), Negate(c), …)` — the canonical form is that already, but
`form: 'raw'` output and its serialization would change (`Subtract` groupings
are pinned by `continuation-placeholder.test.ts` and the ellipsis machinery
above depends on seeing them); or (b) make deep-tree boxing tolerate the depth
(an explicit work stack, or a depth-triggered devolve), which is the general fix
— the same limit hits any ~400-deep tree, e.g. the parser's own `(((…)))`
overflow at ~2 000 levels noted 2026-08-15. Nothing decided on these two; what
HAS landed is headroom:

**Frame trimming (DONE 2026-08-15, same day):** the stack per nesting level was
20 frames on the canonical path, of which 11 were plumbing that does no work
once a root repair is active — `withDevolveRepair → withRootRepair → closure`
entered twice per level (in `box()` and again in `boxFunction()`), and each
operand boxed through the PUBLIC `ce.expr()`
(`expr → inHarvestScope → _inScope → inScope → closure`, re-installing the scope
that is already current). `box()`/`boxFunction()` now call through directly when
the root is active, and the operand-boxing sites in `box.ts` call the internal
`box()`. Canonical boxing: 20 → 9 frames per level; canonicalizing a raw-boxed
tree: 26 → 15. Ceilings on the default Node stack (binary search, bare process):

    shape                              BEFORE            AFTER
    Sin(Sin(…(x))) canonical / raw     223 / 399         385 / 676 levels
    ce.parse('1-2-…-N') canonical/raw  358 / 1 131       621 / 2 524 terms

Behaviour unchanged (full suite, 4 306 snapshots). Pinned by
`test/compute-engine/boxing-depth-headroom.test.ts`, which measures frames per
level with a probe operator (deterministic; independent of stack size and of the
runner's own frames). This moves the cliff, it does not remove it — `1-2-…-700`
still throws.

**Second trim (DONE 2026-08-15, later the same day):** of the 9 remaining frames
per canonical level, four only dispatched: `Array.prototype.map` and its
callback, `box()` (whose two brackets — the inference transaction and the root
repair — are no-ops once a root pass is open) and `boxFunction()`. Operands are
now boxed by a `for` loop calling `boxInternal()` directly (`boxOperands()` in
`box.ts`, inlined at the two hottest sites), `boxInternal()` calls
`boxFunctionInternal()` directly when the root is active, and `canonicalForm()`
with no scope goes straight to the `.canonical` getter instead of through
`_inScope → inScope → callback`. Canonical boxing: 9 → 5 frames per level
(`boxInternal → boxFunctionInternal → makeCanonicalFunction → makeCanonicalFunctionCore → applyOperatorDefinition`);
canonicalizing a raw-boxed tree: 15 → 8. The remaining `makeCanonicalFunction`
frame is real work (it brackets `_inferenceCause`) and stays.

Bytes of stack per level, measured as Δ`--stack-size` / Δceiling in a fresh
process (the ceilings themselves are JIT-state dependent — Ignition and TurboFan
frames differ in size, so a warm process can sit 30% either side of a cold one;
frames and bytes per level are the numbers to compare):

    path                          BEFORE (9 fr)   AFTER (5 fr)   trivial fn
    canonical boxing              2 080 B/level   1 570 B/level   89 B/frame
    raw boxing                    1 220 B/level     630 B/level

So the four removed frames were the small ones (~125 B each); the five that
remain average ~315 B. An Ignition frame is the function's whole register file —
every local and temporary in the function, whichever path runs — and
`makeCanonicalFunctionCore` (468 lines, 32 locals), `applyOperatorDefinition`
(292, 14) and `boxFunctionInternal` (227, 18) stay live across the recursion.
The next step down is therefore structural, not dispatch: split those three so
the recursive call is reached through small dispatchers and the non-recursing
arms (`List`/`Dictionary` fast paths, spread handling, error construction, the
number/symbol/string arms of `boxInternal`) live in helpers that are called and
returned from before the recursion. Expected gain another ~1.5–2×; still a
cliff. Removing the cliff needs the (a)/(b) ruling above.

### The LaTeX parser cannot honor a deadline at all (OPEN but DEPRIORITIZED — ruled 2026-08-19 unlikely to ever be scheduled; found while fixing canonicalization deadline granularity, shipped 2026-08-15)

**Ruling (user, 2026-08-19): this is unlikely to be prioritized, because the
inputs that make it matter are self-inflicted.** The megabyte-scale parses
observed in the field come from the consumer fanning out and RE-TEXTUALIZING
expressions to LaTeX, then re-parsing the result — LaTeX used as an internal
interchange format, which it is not. The supported answer is to stop
round-tripping through LaTeX text: keep expressions boxed and hand the engine
structure directly (raw MathJSON via `ce.box`, or Epsil source — both routes are
deadline-aware since 0.111.0/0.116.0), so parse cost stays proportional to what
the user actually typed. The analysis below is kept because it is correct and
hard-won (the budget is decorative on this path — tightening it buys nothing),
and because the fix shape at the end is the right one if a non-self-inflicted
workload ever surfaces. Consumers were told to plan around this entry, not for
it (CE-0.116.0 pre-release brief, 2026-08-19).

The canonicalization deadline-granularity fix of 2026-08-15 bounds the SMALLER
and better-behaved half of `ce.parse(…)`. The RAW PARSE is the expensive half,
it grows superlinearly, and it is the unbounded one — so the share of
`ce.parse()` that ignores a deadline gets worse as inputs grow. Medians of 3,
fresh engine per run, `form: 'raw'` isolating the parser from canonicalization:

    N        raw parse   canonicalization   raw : canon
    3 000     71 ms          45 ms            1.6 : 1
    6 000    209 ms          49 ms            4.3 : 1
    12 000   719 ms         111 ms            6.5 : 1

Canonicalization is close to linear; the parser is not (roughly 3x per
doubling). An earlier note on this entry recorded the two halves as "about the
same" from a single 6 000-term measurement of 608 ms and 657 ms — that pairing
does not reproduce, and taking one size as the ratio hid the fact that the ratio
itself moves.

`form: 'raw'` does NOT avoid the problem, which is worth stating because it is
the obvious workaround: skipping canonicalization skips the half that is already
bounded and keeps the half that is not. A raw parse under a 1 ms budget and
under a 50 ms budget both ran ~560 ms.

**The consumer-facing danger is not the size of the overrun, it is that
TIGHTENING THE BUDGET BUYS NOTHING.** Elapsed time is essentially independent of
the budget, because the parse runs to completion and only then notices it was
cancelled. Measured 2026-08-15 on a 12 000-term sum, against the now-fixed
canonicalization half for contrast:

    CANONICALIZE   budget  1 ms → elapsed  17 ms   (17x)
    CANONICALIZE   budget 50 ms → elapsed  51 ms   (1.02x)
    PARSE          budget  1 ms → elapsed 832 ms   (832x)
    PARSE          budget 50 ms → elapsed 795 ms   (16x)

So an operator tuning a span DOWNWARD to bound a risk does nothing at all while
believing the risk is bounded — no error, a plausible configuration, and no
effect. That is worse than a large constant overrun, which at least responds to
the knob. A consumer whose spans wrap parse AND canonicalization has, after the
canonicalization fix, bounded the half that was already the more responsive one.

**FIELD EVIDENCE (consumer audit, 2026-08-15): on the paths where this matters
most, the canonicalization fix buys nothing at all — not half.** The consumer
already passes `form: 'raw'` at its three hottest parse sites: the Desmos import
session (their largest workload, with no deadline armed at any level), the
action-firing path (a 50 ms budget, one parse per step), and formula
classification (a 5 000 ms budget). Because `form: 'raw'` skips canonicalization
entirely, 100% of the cost at those sites is in the unbounded parser. Their
audit had recorded the exposure as "half fixed, half remaining", which was wrong
in the reassuring direction for exactly the sites that matter.

**FIELD MEASUREMENT ON REAL CONTENT (Tycho, on imported Desmos formula slots,
2026-08-15) — quote this WITH its shape caveat or not at all.** 6 679 slots
across 585 states: **0.232 ms/slot raw, 0.380 ms/slot canonical, worst single
slot 71 ms** (a 69 KB list literal), and the **worst slot under a 50 ms span
elapsed 53.9 ms — 1.08x**, against the ~110 ms the synthetic curve above
projects.

The caveat is not decoration: **their slots are wide flat LIST LITERALS, not
deep operator chains**, which is exactly why they land an order of magnitude
under the projection. Quoted bare, these numbers support "the unbounded parse is
not a problem in practice", which is FALSE for content that is deep chains
rather than wide literals. The field number is evidence for that shape; the
synthetic curve remains the right guide for the other. Recorded at the
consumer's own insistence, and against their interest — it lowers the urgency of
work they had asked us to prioritise.

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
architecture described in `CLAUDE.md` and `ARCHITECTURE.md`. So there is no
deadline for a strided check to read, and adding one means threading a deadline
(or an abstract "should I stop" callback) across the `ILatexSyntax` boundary.

Fix shape when picked up: give the parser an optional cancellation callback
supplied at construction or per-parse, checked strided in `parseExpression`
(`latex-syntax/parse.ts`), the recursive chokepoint of the parse walk — and keep
it engine-agnostic so the boundary stays structural. Deferred from the
2026-08-15 round deliberately: it is an interface change to a decoupled
subsystem, not the localized addition the canonicalization half was, and it
should not land in the same pass as a release.

### `evaluate()` eagerly expands symbolic `Product`s, then distributes — superlinear blowup on the plotting shape (OPEN, perf/design)

Measured 2026-08-14, bare, machine precision, free symbols, on Tycho's
`ioclpgtwi1` row
`1 - Map(Z ↦ Σ_{i=1..Z} (1/i!)((1-x)/n)^i ∏_{k=1..i-1}(kn-1), 1..N)`:

| N   | median  |     | binding                | median  |
| --- | ------- | --- | ---------------------- | ------- |
| 2   | 26 ms   |     | free `x`,`n`           | 2062 ms |
| 4   | 145 ms  |     | bound (`n=5`, `x=0.5`) | 39 ms   |
| 6   | 409 ms  |
| 8   | 1085 ms |
| 10  | 3629 ms |
| 12  | 4923 ms |

~140× for a 5× increase in N (roughly cubic-to-quartic), and ~53× free-vs-bound
on the identical row.

**Mechanism, confirmed by ablation and by direct probe.** Two behaviors compose.
(1) A symbolic `Product` EXPANDS to a polynomial under `evaluate()`:
`∏_{k=1..8}(kn-1)` returns the 9-term `40320n^8 - 109584n^7 + …`, not the
compact product. (2) Multiplying an expanded polynomial by anything then
DISTRIBUTES — `(n-1)(1-x)^2` evaluates to `n(1-x)^2 - (1-x)^2` — which is the
documented `mul()` behavior (see `mul-distributes-over-sums`), harmless in
isolation and quadratic here. Together: the product contributes ~i terms,
distribution multiplies them across the `(1-x)^i` factor, the Σ sums that over
i=1..Z, and the `Map` repeats it for Z=1..N.

Ablation at N=8 (median of 3, full row = 1311 ms) shows the cost is
SUPERADDITIVE, so no single sub-term owns it: removing the product → 158 ms,
removing the factorial → 423 ms, removing the symbolic power → 1081 ms; but each
sub-term ALONE is cheap (product only 184 ms, power only 109 ms, factorial only
16 ms — 309 ms summed against 1311 ms combined).

**Why this is worth changing rather than accepting.** `evaluate()`'s contract is
the most EXACT form, not the most expanded one — an unexpanded `∏(kn-1)` is
equally exact and dramatically smaller, and expansion is `expand()`'s job. The
cost also lands precisely on the structural plotting case: a plot axis variable
CANNOT be bound, so a consumer plotting this function always pays the
free-symbol path. Tycho hit it as a 4–9 s evaluation behind a 500 ms probe
budget.

Fix shape when picked up: stop expanding a symbolic `Product` whose bound is
symbolic during `evaluate()` (leave it as a `Product` and let `expand()` open
it), and/or avoid `mul()`'s distribution when either operand is a many-term sum.
Note the second lever alone is not enough — the ablation shows the terms
interact, so measure both. Any change here needs the snapshot blast radius
measured first; product expansion is long-standing behavior with wide pin
coverage.

### `process.env`-gated diagnostics are stripped from the published bundle

Measured against `dist/esm-min/compute-engine.js` (2026-08-14): `process.env`
occurs 0 times, and so do `CE_CACHE_STATS` and `mapAutoCompileStats`. Every
`process.env`-gated diagnostic in this repo — `CE_CACHE_STATS`, `CE_DEBUG_DEPS`,
`CE_MEMO_PARANOID` — is therefore ELIMINATED from the published artifact, not
merely defaulted off in it. They serve CE's own Node-side debugging and CI, and
are unreachable for EVERY consumer of the package, browser or Node alike; adding
another one reproduces the same dead end a consumer already hit asking whether a
`Map` drain compiled.

The established shape for a consumer-reachable diagnostic is an `_`-prefixed
ENGINE MEMBER (`_deadline`, `_random()`, `_compile()`, and now
`_mapAutoCompileStats`): it survives bundling, needs no subpath export, and
works in a browser, which is where the consumer asking the question runs. One
surface was converted that way on 2026-08-14; whether the remaining env flags
should follow is UNDECIDED as policy. Note for whoever picks it up: a new engine
member must also be declared on `IComputeEngine` (`types-engine.ts`) — that
applies to `_`-prefixed members too, 60 of which are already declared there — so
each conversion is an implementation + interface change, not a one-file edit.

### Degree-mode folding flips `angularUnit` per fold attempt, purging caches (OPEN, perf — small)

Measured before `foldCostEstimate` replaced the wall-clock budget. That change
narrows the exposure but does not remove it: the cost gate returns BEFORE the
setter is touched, so a subtree the estimator declines now costs nothing here,
while every subtree that actually folds still pays the two purges below. The
numbers therefore still hold for the folding case, which is the common one.

The 0.108.0 degree-mode fold fix neutralizes `engine.angularUnit` around each
constant-fold evaluation (necessary — see the CHANGELOG entry). The setter is
not a cheap flag: `set angularUnit` calls `_reset()`, which runs `purgeValues()`
on the cache store. So a degree-mode compile pays two cache purges per fold
ATTEMPT.

Measured (60 constant subtrees, median of 5, javascript target): angular
constants 4.2 ms in radian mode vs 9.4 ms in degree (2.2×); NON-angular
constants 0.3 ms in both. So the cost is not the flag itself — it tracks how
warm the purged caches are, and only an angular-heavy degree-mode compile is
warm enough to notice.

Note what that rules out: narrowing the gate to "subtree contains an angular
operator" would save nothing, because the penalty falls exactly on the subtrees
that genuinely need the neutralization. The fix that would work is hoisting the
neutralization to the compilation boundary so it happens once — but that is not
free either, because `compileDerivative` (`library/calculus.ts`) calls
`rewriteAngularUnit` DURING compilation and that function reads `ce.angularUnit`
from the engine. Hoisting therefore has to make the derivative lowering's unit
explicit rather than ambient, or degree-mode derivatives silently stop being
rewritten. Raised by the compilation session, who own the folder.

### Lazy infinite-collection compilation — v1 limits (JS target)

`Take`/`TakeWhile`-bounded infinite pipelines compile to lazy `_SYS` iterator
streams as of 2026-08-13 (`emitLazyStream`, `javascript-target.ts`; tests in
`compile-lazy-collections.test.ts`). The v1 lazy algebra is deliberately small —
sources: `Range` with a literal `±∞` stop; transformers:
`Map`/`Filter`/`Drop`/`Rest`; bounders: `Take`/`TakeWhile`. Everything else
fails closed at compile time with an error naming the bounding fix. Not defects
— each is a clean compile-time decline today — but natural extensions:

- **More lazy sources**: 1-argument `Repeat(v)` (its handler still fails closed
  with the pre-existing "no compiled representation" message, now only true
  outside a bounding consumer) and `Cycle` (which has no compile handler at
  all).
- **More bounding consumers**: `First`/`At(k)`/`Find`/`IndexWhere` over an
  infinite stream all have finite answers a lazy scan could produce; today they
  fail closed.
- **A symbolic step with an infinite stop** (`Range(1, ∞, s)`) is not lazily
  compilable: a runtime-negative step means an EMPTY range, and a stream cannot
  decide that lazily (see `infiniteRangeStep`).
- **Python target**: no lazy lowering — a non-finite `Range` bound fails closed
  at compile time even under `Take` (a documented divergence from the JS
  target).
- `DropWhile` over an infinite source is INERT in the interpreter, so it
  deliberately does not compile — parity, not a gap.

### `Error` match normalization is root-only (limitation)

An `Error` subject is normalized for pattern matching at the ROOT of the match
only: its `ErrorTrace` breadcrumb is stripped, and its where/site operand is
stripped when the pattern's arity doesn't ask for it (`normalizeErrorSubject`,
`match-dispatch.ts`). A sited or bubbled error NESTED as another error's cause
is not normalized, so an `Error(Error(c))` pattern does not see through the
inner error's where or trace. This predates the 2026-08-13 site operand —
trace-stripping was always root-only — and extending it needs the generic
recursive matcher to normalize `Error`/`Error` subject–pattern pairs as it
descends. Surfaced by the dual review of the site-operand change; no known user
report.

### Named-argument calls — v1 residuals

Named-argument calls shipped 2026-08-12; the durable lowering contract is in
`docs/LANGUAGE-MODEL.md` and the full surface specification is in
`docs/TYPE_SYSTEM_ROADMAP.md` Appendix C. One deliberate v1 limit remains open.
(Three other candidates are resolved: a declared-only overload set declining a
named call whose name-eliminated arm is more specific was RULED correct behavior
on 2026-08-13 — when names and positional ranking disagree and there is no
implementation to pin the call to, the engine asks the author to be explicit
rather than guessing (design doc §4). And the two `Apply`-routed callee shapes
whose names ARE knowable were both fixed on 2026-08-13: the qualified protocol
spelling `Protocol.member(self: x, …)` permutes against the named protocol's
requirement signature, and an inline function-literal callee
`((x: number) => x + 1)(x: 5)` permutes against its own syntactic parameter list
— including UNANNOTATED inline literals, whose names are read from the
expression, not the inferred type. What still declines through `Apply` is a
callee whose names are genuinely not knowable there: a symbol callee
(`Apply(f, x: 1)` — write `f(x: 1)`), and a literal with a parameter that is not
a bare symbol or `Typed` annotation. And the false STATIC diagnostics a named
call to a `:=`-assigned callee used to draw were FIXED on 2026-08-13: the static
pre-pass now registers the signature a `f := ⟨annotated literal⟩` or
`let/const f : ⟨arrow type⟩` statement pins, for the later statements of the
same program, under the pass's inference rollback frame —
`registerPinnedSignature` in `src/epsil/static-diagnostics.ts`, regression tests
in `test/epsil/execute.test.ts` "named calls to `:=`-assigned callees". The
decline still fires where it is truthful: calls ahead of the assignment, and
unannotated literals.)

- **Unannotated function literals are not addressable by name through a
  BINDING** — type inference drops parameter names (`effects-inference.ts` types
  a bare parameter as `{ type: 'unknown' }`), so
  `f := (a, b) => …; f(a: 1, b: 2)` declines even though the same literal
  applied inline now works. MEASURED 2026-08-13: the one-line fix breaks 37
  tests across 11 suites + 1 snapshot, including semantic suites
  (`effects-contracts`, `application-validation-regressions`, callback-contract
  and lambda-inference batteries) — a dedicated follow-up round, not a snapshot
  refresh.

### `Derivative` compile time vs body nesting depth (perf ask)

**RESOLVED 2026-08-14 (capability half)** — the shared-budget numeric fallback
(user-ruled): past the differentiation growth budget, the javascript compile
emits an 8th-order centered-difference stencil (`_SYS.nd`) and interpreted `N()`
computes the SAME shared function (`centeredDiffHigherOrder`,
numerics/numeric.ts), bit-identical across routes; within budget the exact
closed form is unchanged, and plain `evaluate()` stays symbolic. `ND` at a
runtime point now compiles. Pinned in
`test/compute-engine/compile-derivative-numeric-fallback.test.ts`.

**Open residual (perf):** the failed symbolic attempt still runs to the growth
budget before the fallback engages — once per derivative node per compile (~1–2
s per node on the deep shapes; Tycho's Taylor witness pays it three times, once
per order, because each order's `derivative()` call re-runs the shared first
differentiation). If Tycho's compile-band gates trip on this, the fix is an
over-budget memo keyed on the resolved function LITERAL (shared across the
sibling `Derivative(f, k)` nodes) + the semantic version — not a lower budget,
which would change which expressions get exact derivatives.

Historical numbers (pre-fallback): order-1 compile 6/21/77/429 ms at depth
1/4/8/16, THROWS at depth 37, undifferentiated body single-digit ms at every
depth. (Reported by the Tycho project as its item 177, `docs/COMPUTE_ENGINE.md`
in `dev/tycho`; bare-engine repro `docs/scratch/d209-ce-asks-repro.mts` there.)

Its sibling report, Tycho item 176 (a lambda `i ↦ Σ_{n=1..i} …` compiling to all
zeros with `success: true`), was root-caused and FIXED the same day it was filed
(2026-08-12, staged): a big-operator bound whose name collides with a library
constant (`i`, the imaginary unit; `e`) was read through the shadowed engine
symbol — `.re` of the imaginary unit is `0`, so the range `1..0` folded empty —
both when the name was really a compile-bound parameter (fixed via
`BaseCompiler.bigOpBoundConstant()` refusing the constant fold for compile-bound
names, applied in the javascript/gpu/interval targets) and at top level, where
`bigopBoundValue` (`library/utils.ts`) dropped a nonzero imaginary part instead
of staying symbolic. Pinned in
`test/compute-engine/compile-sum-product.test.ts`, parameterized over
`i`/`e`/`k`/`n`/`x`. An earlier revision of this entry misattributed the cause
to enumerability of `Range` with undeclared bounds — the enumerability tier was
never implicated (an undeclared non-constant bound always stayed symbolic;
declaring `i: number` shadowed the constant, which is what made declaredness
look like the trigger).

### Static argument-checking of user-defined callees — residue

Tier 1 landed 2026-08-12; what remains is generic functions (below) and
`let`/`const` bindings. The history is kept because it explains the shape of
both.

`function foo(x: string, n: integer) { x }` followed by `foo("hello")` used to
pass `epsil check` clean; only the run phase reported the missing argument.
Builtins (`Ln()`, `Sqrt(1, 2, 3)`) were checked, since the library already holds
their signatures.

The cause was narrower than "the pass does not model prior declarations".
`staticDiagnostics()` boxes every statement in ONE pushed scope in source order,
and `DefineFunction`'s **canonical** handler already declares the name there —
so `foo` does exist when `foo("hello")` canonicalizes. What is missing was its
SIGNATURE: the handler deliberately loosens the target to the top type
`function` so that a recursive self-call inside the body does not validate
against a signature that does not exist yet (`library/core.ts`, "Tie the
recursion knot"), and nothing tightened it afterwards. The top `function` type
promises no arity, so every call type-checked vacuously.

Measured 2026-08-12: declaring the annotated signature by hand before boxing the
call makes the engine report `incompatible-type`, `missing` and
`unexpected-argument` for it immediately — the validator needed no new code,
only the signature.

**Tier 1 — `function` definitions — LANDED 2026-08-12.** `DefineFunction`'s
canonical handler now installs the clause once the body has canonicalized and
the recursion-knot loosening has been restored, so later statements validate
against the real signature. Multi-clause sets accumulate clause by clause; a
definition inside a block stays scoped to that block, so it cannot make an outer
call a false positive. GENERIC definitions are excluded and remain unchecked
until they evaluate — rule G2 refuses any clause onto a generic target, which
makes the install non-repeatable, and the evaluate route would then reject its
own re-installation.

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
from `checkSource()`, which is static-only by hard rule (it must never evaluate
the user's buffer). Before tier 1 the signature notes explained calls to
_builtins_ only, and the "`foo` is defined here" related-information pointer had
nothing that could trigger it; both now work for the file's own functions.

### Dead post-install `effectsDeclared` write in `defineFunctionClause`

Found 2026-08-19 while journaling the checkpoint hooks (dual review of stage
C1). In `multi-clause.ts`'s `defineFunctionClause`, `retarget` is the operator
half in force before the clause is installed, and after a SUCCESSFUL install the
code writes `retarget.effectsDeclared = incomingExplicit !== undefined`. By then
`retarget` is an orphan: `ce.assign` routes to `updateDef`, which constructs a
fresh `_BoxedOperatorDefinition` for a plain-object definition and swaps the
record's pointer to it, so the write lands on an object the binding no longer
holds. Verified by probe: after `w(x: integer) = x + 1` then
`w(x: string) = "s"`, the captured pre-assign half is not the installed one.

Not an observable defect today — the installed half derives the same
`effectsDeclared` from the incoming literal, so the live definition ends up with
the value this write intends — and the same statement's REFUSAL path (the
`catch`) does need the write, because there the old half is still installed. So
the write is dead on one path and load-bearing on the other, and its comment
describes only the second. Left as-is rather than "fixed" because re-deriving
the target after the install would change which definition the
effects-annotation contract is recorded on, and `contractViolation` reads that
flag; that is a decision about the effects-provenance contract, not a mechanical
repair. What to do when someone picks it up: either drop the success-path write
and say in the comment that the install derives the flag, or re-fetch the live
half and write it there — and pin whichever with a test that distinguishes the
two.

### The strict linear posture initiative — the remaining Epsil-route flip (RATIFIED 2026-08-18; stages R1/C1/C2/C3/v2 shipped 2026-08-18/19)

Arno ratified (2026-08-18, with Tycho's code-verified concurrence):
cross-program redefinition of types/protocols/conformances/same-signature
clauses becomes an ERROR on the Epsil (`executeEpsil`) route only — the box
route and host API keep today's replace/throw semantics permanently (Tycho's
recompute passes re-assert declarations via the box route every 300 ms and
depend on idempotency) — and the notebook edit gesture moves to the engine
`checkpoint()`/`restore()` API, which is shipped (contract in
`docs/CHECKPOINT-MODEL.md`; stages R1, C1–C3 and checkpoint v2 all landed
2026-08-18/19 and are pinned, incl. `checkpoint-in-scope.test.ts` and the
differential harness).

What remains is the last stage: **the Epsil-route strictness flip and the
deletion of the superseded machinery** (~1,384 source lines, ~1,891 test lines,
≈92 test flips — audit §5 of
`docs/plans/2026-08-18-checkpoint-restore-design.md`), gated on Tycho shipping
restore-before-Run client-side. Until then both mechanisms coexist.

### A literal argument to an `inout`-parameterized constructor over-narrows (found 2026-08-14)

`let c: Cell<integer> = Cell(value: 1)` is rejected with "expected
`Cell<integer>`, got `Cell<finite_integer>`": the integer literal `1` infers
`finite_integer`, the type parameter is declared `inout` (hence invariant), and
invariance refuses the narrower instantiation. Verified PRE-EXISTING and not
specific to object types — a shipped tuple body behaves identically
(`type Box<inout T> = tuple<value: T>` with `Box(1)`), so this is the standing
interaction between literal type inference and `inout` invariance, surfaced by
Appendix B's generic object types (B13 makes every stored field invariant, so
object declarations meet it routinely). The fix direction is to let a literal
argument widen to the parameter's declared instantiation when one is given by
the annotation, rather than solving the parameter from the literal's narrowest
type; it needs its own ruling because the same rule governs every `inout`
nominal.

### Protocols residue (protocols + compiled dispatch landed 2026-08-12)

- **A provisional rebuild of a VALUE-bound literal never re-verifies its
  declared effects contract** (found 2026-08-14, dual review of the
  effects-provenance + Phase-0a staged set). `installRebuiltLiteral`
  (`function-utils.ts`) swaps a value definition's stored literal via the bare
  `value` setter, which touches neither `type` nor `effectsDeclared` — so a
  binding declared `(…) pure -> …` whose body froze a provisional application
  can have that body rebuilt into an EFFECTFUL one with no contract check on
  this route (the operator branch re-validates inside `update()`). Reachable
  only through the provisional-dependents cascade on declare-then-assign value
  bindings; the fix is an `assertDeclaredEffects`-style check in the value
  branch, re-deriving the rebuilt literal's effects against the declared arrow.

- **Box-route conformance implementations are not callable** (found 2026-08-14
  during the Phase-0a derived-dispatcher-effects round; user-ratified 2026-08-14
  as a follow-up — the box route stays registration-only until the `Self`-aware
  canonicalization below lands). `ce.box(["DeclareConformance", …]).evaluate()`
  stores the implementation function literal held and UNBOUND (its annotations
  mention `Self`, which ordinary canonicalization cannot resolve, so the block
  is deliberately kept raw), and dispatching through such an implementation
  later throws `Function body must be a scoped Block expression`
  (`function-utils.ts` `invokeImplementation` → `apply`). The Epsil statement
  route canonicalizes and works; the CE-route protocol tests never _call_ an
  implementation, so the throw is unpinned. Same family as the "impl literals
  applied raw per call" follow-up flagged when protocols landed: the fix needs a
  `Self`-aware canonicalization of the stored block (at registration, with the
  conformance target bound), not a blanket `op.canonical`.

- **A value-bound function literal's arrow is baked into callers' effect
  stamps** (recorded 2026-08-14, Phase-0a residual). The derived-effects
  re-derivation (`consultsRegistry`, `effects-inference.ts`) keeps a definition
  fresh when its body reaches a protocol dispatcher directly or through
  OPERATOR-definition callees, but a body that reaches one only through a
  VALUE-bound literal (`g := (x) => speak(x)` stored as a value binding, then
  `f` calling `g`) freezes `g`'s arrow as read at `f`'s install: the walk cannot
  see that the value's own arrow is registry-dependent. Consistent with the
  shipped construction-time snapshot semantics, but it narrows the widening
  guard's transitive reach on that path. Lifting it needs a registry-dependence
  bit on the LITERAL's arrow (or type), not just on operator definitions.

- **`InverseFunction(f)` / `Derivative(f, n)` as a lazy operator's callback are
  rejected** (found 2026-08-13; same family as the qualified-protocol-member
  callback fix that landed that day). `Map(InverseFunction(Sin), [1, 0])`
  reports `incompatible-type function/unknown`: the held callback arrives RAW,
  where its type reads `unknown`, so the function-value gate (`denotesFunction`,
  function-utils.ts) cannot answer and the constant-nullary reject fires. A loud
  error, not silent wrong values — and the explicit-lambda spelling
  (`Map((x) => InverseFunction(Sin)(x), xs)`) works. The protocol-member case
  was fixable with a registry-keyed syntactic recognizer
  (`isQualifiedProtocolMember`); these shapes need per-operator knowledge
  ("which operator applications denote function values when raw?") — a small
  denotes-function operator table, or canonicalizing the callback operand before
  the gate, would lift them.

- **Sum-name conformance** — `type shape is Area`, where `shape` is a sum type,
  is rejected with `protocol-conformance-target-invalid`: the sum sugar
  registers the sum name as an alias, and an alias cannot conform. Per-variant
  conformance blocks are the working pattern (and what compiled dispatch keys
  on), but the whole-sum spelling is the natural thing to write. Product
  question to rule on: should it desugar to one conformance edge per variant
  (with `Self` = the variant), or stay an explicit error pointing at the
  per-variant form? If desugared, decide whether a later variant added to the
  sum re-runs the conformance (batch re-run semantics, P47) and how a
  per-variant duplicate is reported.

### Contextual callback typing residue (Design D landed 2026-08-09)

The `callback<S>` conversion of the 15 collection operators closed with these
items open. Items marked RULED-DEFERRED have a maintainer decision on record;
the rest are recorded here so they are not rediscovered from the outside.

**Deferred by ruling (each names what unblocks it):**

- **`Map`'s honest signature spelling** — the declared
  `(collection<T>, mapping: callback<(T) -> U>, collection*)` misorders the zip
  form's callback-last convention; the type system cannot spell
  required-after-variadic. RULED-DEFERRED 2026-08-09 (spec §9 item 5b, with the
  two candidate fixes: suffix-parameter support, or flipping `Map` to
  callback-first). Unblocked by: choosing one.
- **Standalone-lambda runtime check emission** — `literal.compile()` then
  `run(violatingValue)` silently computes where the interpreter errors; every
  in-engine route is enforced. RULED-DEFERRED 2026-08-09 with the direction
  fixed (per-primitive check-emission table + "unenforceable → decline"); see
  the "Known limit" section of `docs/TYPE-SYSTEM.md`.
- **`FlatMap`'s `evaluate` materializes on the SOURCE's finiteness alone** — it
  retains the optimistic assumption its `isFinite` facet dropped (2026-08-09);
  re-gating on `expr.isFiniteCollection` would make every unprovable-callback
  `FlatMap` stay symbolic. Needs a ruling before changing.
- **Phase 4: comparator slots** (`Sort`, `ChunkBy`, …) — whether they convert to
  `callback<(T, T) -> …>` at all (spec §9 item 6).
- **Seeded-fold accumulator stamping** — deliberately never stamped (spec §12.1:
  stamping it breaks type-changing accumulators, probed); re-opening needs a
  bound (`forall T, U: value.`) and a re-ruling.

**Known limits, recorded in spec §9b, no action unless demanded:** binder-route
(`rawOps`) applications skip the contextual stamp (unreachable today — tripwire
comment at the gate); `callback<S>`'s parameter-position-only intent is
unenforced (other positions behave as `function`); a union of two DIFFERENT
`callback<S>` members resolves first-seen; undeclared source symbols infer
`collection<unknown>` (the standing polytype behavior).

**Cleanups (opened here 2026-08-09; the first five CLOSED 2026-08-09):**

- **An eager IMPURE collection source is evaluated several times**
  (pre-existing, measured 2026-08-09 during the above): counting handler
  invocations over a 5-element source, `Map(f, RandomShuffle(xs))` evaluates the
  shuffle **8** times, `Filter(RandomShuffle(xs), p)` 5, `Any(…)` 2 — the
  materialize-then-iterate path in `each()` re-evaluates a source that has no
  collection handlers, once per facet query. Results stay correct; the number of
  DRAWS consumed does not, so a seeded program is not reproducible across these
  shapes. Needs the evaluated form to be computed once and threaded through the
  facets.
- **`FlatMap` has no `count` facet**, so `Length(FlatMap(…))` is inert even when
  the result is provably finite (a count requires applying the callback per
  element — needs a design, not a one-liner).
- **Nested `Map`/`Filter` canonicalization is superlinear in depth** (measured
  2026-08-09: 10→20 levels ≈ 2.65× on both the current and the pre-conversion
  path — pre-existing, cause unidentified).
- **Bounded numeric element types** (`integer<1..10>`) and value-literal types
  still decline the stamp admission gate (`admissibleElementType`) — a one-line
  widening if ever wanted.

### Broadcast semantics residue (element-wise lowering landed 2026-07-26)

The element-wise compiled lowering shipped, and with it the two interpreter
rulings it depended on (record in `CHANGELOG.md`). The ordering relations and
the logical connectives now broadcast on the JavaScript target through
`_SYS.bcast`; broadcast operands are evaluated ONCE; and a length mismatch is
`incompatible-dimensions` across the eager zip, the arithmetic broadcast and the
lazy form, instead of a silent zip-to-shortest. (`PointList` opts out by design
— it zips components rather than broadcasting an operator, and its shortest-zip
is a consumer contract.) The full policy — strict for LIFTED operators, shortest
for explicit PAIRING constructors (`Zip`, variadic `Map`, `PointList`) — is
recorded in `docs/BROADCAST-MODEL.md`. Genuinely remaining:

- **An operand whose length is not yet KNOWN is not compared.** The check reads
  `count`, so a participant reporting `undefined` (a symbolic-length `Range`
  before its bound resolves, an operand held raw by a lazy operator) is skipped
  and the broadcast proceeds. It is the lazy `Map` that then zips those, and the
  variadic `Map` uses shortest-input semantics — so a mismatch that only becomes
  visible after the length resolves can still truncate silently. Diagnosing it
  means a strict lazy zipper that reports `incompatible-dimensions` when one
  participant ends before another, which is a change to `Map` iteration, not to
  this check. (An _infinite_ operand is already caught: `count` is `Infinity`,
  which mismatches any finite length.)
- **A compiled ordering cannot tell an ERROR operand from a numeric NaN.** Both
  are NaN at the ABI, and `NaN < 3` is `false` — which is right for a numeric
  NaN (IEEE) but wrong for an error, where the interpreter stays an error. The
  connectives are guarded (`guardConnectiveAbsence`), because there JS coercion
  produced a plainly wrong truth value (`!NaN` → `true`); the orderings would
  need a distinct absence sentinel carried through nested broadcasts to do
  better.

- **Python still fails closed** for comparisons/connectives over a
  possibly-collection operand — it has no generic scalar-closure broadcaster.
  Tracked under _Broadcast typing residue_ below; `_ce_bcast` now matches the
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

- **A callback over a `number`-typed source keeps the real lane and answers
  `NaN` for a complex element supplied at run time (OPEN).** A provably complex
  source is handled: `Map(Abs, zs)` over `zs: list<complex>` compiles through
  the annotated eta-expansion `(x: complex) ↦ Abs(x)`
  (`BaseCompiler.complexElementCallbackEta`, pinned in
  `test/compute-engine/compile-callback-complexness.test.ts`). `number` is a
  supertype of both the real and the complex numbers, so no static
  classification is possible there; annotating the parameter `complex` would
  change the RESULT shape of the ordinary real case, and declining would send
  every `number`-typed source to the interpreter. Closing it needs a runtime
  lane guard on the callback parameter, alongside the complexness-analysis
  machinery (items 147/148). **JavaScript band** (230 members / 81 states fail).
  Per the consumer's per-bucket provenance rules, **82 members / 25 states are
  our target gaps**; the other 148/61 are their own unexpanded user-function
  heads, unparsed LaTeX, and document-defined function heads. (Their first pass
  called the whole remainder ours — 202/69 — and they corrected it in review.
  Use 82/25.)

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
  shader targets need a monomorphized (per-call-site arity) lowering since they
  have no variadic dispatch.

- **Generic user functions: BOUNDED ones now compile whole-fn on JavaScript;
  unbounded ones still decline** (feature-parity note, 2026-08-04; the lift
  landed 2026-08-30 — no corpus sizing yet). A generic body
  (`function f<T>(x: T) -> T { … }`, or a literal assigned to a `forall`
  declaration) used to take the standard decline in `ensureUserFunctionEmitted`
  (G3, `docs/TYPE-SYSTEM.md`), because a polytype has no ground parameter type
  to read: an emitted call boundary would have lost both its coercion wrap and
  its broadcast wrap, and `gd([1,2,3])` under `forall T: number. (T) -> T`
  compiled to `_fn_gd([1, 2, 3])` and ran to a wrong value where the interpreter
  broadcasts `[2,4,6]`.

  **What shipped: the bound reading, not per-call-site monomorphization.** A
  quantified parameter is read at its DECLARED BOUND, which is the reading the
  interpreter's own broadcast gate already performs (`paramsAreScalar` calls
  `substituteDeclaredBounds` before asking whether a parameter is scalar). So
  `gd: (x: T) -> T where T: number` is emitted ONCE, as the ground
  `(x: number) -> number` it is bounded by, and its call sites get the coercion
  and broadcast wraps that ground signature earns: `gd(5)` compiles to
  `_fn_gd(5)` and runs to `10`; `gd([1,2,3])` compiles to
  `_SYS.bcastFn((_tv1) => _fn_gd(_tv1), [1, 2, 3])` and runs to `[2,4,6]`, the
  interpreter's answer. A bound of `complex` puts the body in the complex lane
  and the call site lifts a real argument into `{ re, im }`, exactly as a ground
  `(complex) -> complex` declaration does. The reading is sound because every
  argument an instantiation admits is a subtype of the bound, so no call site
  can reach a shape the one emission was not compiled for. Per-call-site
  monomorphization was rejected rather than deferred for lack of time: it would
  reintroduce the `$`-suffixed per-call-site function specializations that were
  retired 2026-08-16 in favour of one emission per function shaped by the
  declaration and the compile mode (see the comment on `userFunctionName`,
  `compilation/base-compiler.ts`), it has no call site to instantiate from on
  the VALUE-position route (`Map(gd, xs)`), and it needs an extra termination
  rule for a recursive generic — while buying nothing the bound reading does not
  already give for a bounded variable.

  A generic call site never takes the provably-scalar fast path: at a generic
  parameter the argument's static type is INFERRED from the bound rather than
  declared by the caller, so `gd(y)` types the free `y` as `number` and yet
  `run({ y: [1,2,3] })` still hands the call an array. The runtime dispatch is
  emitted for every non-literal argument, and applies the closure directly when
  nothing is an array.

  **No call site takes a static fast path any more (ruled and landed
  2026-08-30).** The same reasoning applies to a CONCRETE declaration, and the
  fast path there was answering a wrong value behind `success: true`. With
  `f(x: number) = 2x + 1`, the free `y` in `f(y)` types `number` — inferred from
  `f`'s own declared parameter, which says nothing about what the caller
  supplies. The call emitted a bare `_fn_f(_.y)`, so `run({ y: [1,2,3] })`
  computed `2 * [1,2,3] + 1`, which is the string-coerced `NaN`; the interpreter
  broadcasts the same call to `[3,5,7]` (auto-broadcast is documented, pinned
  design — `doc/08-guide-types.md` §Broadcasting). It now emits a runtime guard
  instead:
  `((_tv1) => Array.isArray(_tv1) ? _SYS.bcastFn((_tv2) => _fn_f(_tv2), _tv1) : _fn_f(_tv1))(_.y)`.
  `run({ y: 21 })` still answers `43` through the direct branch and
  `run({ y: [1,2,3] })` answers `[3,5,7]`. The cost of the guard was measured at
  about 3 ns per call in the scalar case and ruled acceptable (Arno, 2026-08-30)
  against silently wrong arithmetic.

  The argument is bound to a temporary, so its expression is evaluated exactly
  once whichever branch is taken, and each argument of a multi-argument call is
  tested independently: `g(u, v)` broadcasts when either is an array and reuses
  the scalar for every element, matching `_SYS.bcastFn`. A LITERAL argument (a
  number, string, character or boolean literal) cannot be an array at run time,
  so it is neither tested nor bound and `f(3)` still emits the bare `_fn_f(3)`.
  The static shape class therefore now chooses only WHERE the test happens,
  never whether there is one. Three call shapes still emit the bare direct call,
  because a broadcast would be WRONG there rather than merely unnecessary: a
  tuple argument, a nominal-typed argument (both atomic — the interpreter binds
  them whole), and a callee with a collection-typed parameter, which binds its
  argument whole. So does every target other than JavaScript.

  A POINT is the case that makes those exemptions matter at run time rather than
  only statically. A point is tuple-typed and lowers to a plain JS array, so
  `Array.isArray` is true for the value a point-taking function EXPECTS, and
  broadcasting there would call the body once per coordinate and answer a list
  where the interpreter answers one number. The guard cannot reach such a value,
  on either side of the boundary: a tuple-, point- or collection-typed PARAMETER
  makes the callee non-scalar and no broadcast form is emitted at all, and the
  guard is in any case emitted only where every ARGUMENT's static type is
  `number`, `boolean` or `string`, which a point-typed argument is not. `mid(p)`
  under `(v: tuple<number, number>) -> number` therefore still emits the bare
  `_fn_mid(_.p)` and `run({ p: [3, 5] })` answers `4`, the interpreter's value.

  **The BODY reads the bound too (landed 2026-08-30).** The first round lifted
  the CALL boundary only; the body was still compiled against an erased
  parameter, so `(xs: T) -> number where T: list<number>` with a `Length(xs)`
  body declined with
  `Length: cannot compile — operand is not an indexed collection`. The parameter
  analyzed as `collection` — what usage inference reads out of `Length(xs)` —
  and a bare `collection` is not array-shaped, so every collection gate in the
  body refused it while the bound one hop away proved a list. It now compiles:
  `g([4,5,4])` emits `const _fn_g = (xs) => (xs).length;` and runs to `3`, the
  interpreter's answer, and `At`, `Reduce` and `Filter` bodies compile the same
  way.

  The bound reaches the body through the channel a CONCRETE declaration already
  uses. `ascribeDeclaredParameterTypes` (`engine-declarations.ts`) stamps a
  declared parameter type onto a bare parameter as a `Typed` annotation and
  re-boxes the literal, so the body is canonicalized with its parameter
  references bound at that type; the emission hands that function the GROUND
  signature instead of the polytype (`literalAtGroundSignature`,
  `compilation/base-compiler.ts`). One extra step is needed first: a generic
  literal carries its declared polytype as a full-signature marker on the body,
  and a ground parameter annotation added beside a `where T` marker does not
  survive canonicalization — the two would contradict each other, so the
  annotation is erased. The marker is therefore restated at the ground signature
  in the same rebuild (`markerAtGroundSignature`). The stamped literal is used
  for the EMISSION only and is never stored back, so the engine's own value
  keeps its polytype and the interpreter still instantiates per call. Because
  both halves come from the ground signature, the emitted definition is the one
  the equivalent ground declaration emits, byte for byte — pinned by a
  concrete/generic comparison in
  `test/compute-engine/compile-generic-monomorphization.test.ts`.

  Two properties fall out of reusing that function rather than teaching each
  operand gate about genericity. A SCALAR bound stamps nothing (only a parameter
  that binds a collection whole can be handed a value a scalar-compiled body
  cannot read), so `where T: number` and `where T: complex` emit
  byte-identically to before. And a bound that does not prove what the body
  needs is not repaired by the stamp: under `where T: collection<number>`, an
  `At(xs, 1)` body now fails closed — it used to emit `_SYS.at(xs, 1)` off the
  erased parameter — because `collection<number>` proves a collection but not
  indexed access, which is exactly how the ground
  `(collection<number>) -> number` declaration behaves.

  **What still declines** (whole-fn, with the sound interpreted fallback): a
  variable with NO ground bound — `(x: T) -> T where T` names no type to compile
  against, so `gd(y)` there emits no `_fn_gd` and the fallback runner answers
  `42` for `y = 21` and `[2,4,6]` for `y = [1,2,3]`; every target other than
  JavaScript, since the coercion and the `_SYS.bcastFn` broadcast are JavaScript
  conventions and the shader targets synthesize a static signature this reading
  was never validated against; a declared `broadcastable<T>` parameter over a
  possibly-collection argument, which fails closed as before; and a body whose
  bound does not prove the capability it needs, such as an indexed read under a
  `collection<number>` bound.

  **A generic BLOCK-LOCAL function reads the same bounds (resolved).** A
  function declared inside a `Block` (`const g = (x: T) => …`) is called through
  `tryCompileLocalFunctionCall`, which reads the callee's signature from the
  declared literal rather than from an engine definition. That route threw on
  any polymorphic signature, so one function compiled or declined depending only
  on where it was written: for the doubling literal bounded by
  `where T: number`, the engine-level spelling compiled `gd(5)` to `_fn_gd(5)`
  and `gd([1,2,3])` to the `_SYS.bcastFn` broadcast, while the block-local
  spelling of the same function failed closed on both and fell back to the
  interpreter. The block-local route now reads each quantified parameter at its
  declared bound, exactly as the engine route does: the call site earns the same
  coercion and broadcast wraps, so `gd(5)` runs to `10` and `gd([1,2,3])` to
  `[2,4,6]` on either spelling. It declines on the same two conditions — an
  unbounded variable and every target other than JavaScript — and the
  `broadcastable<T>` gate is unchanged.

  **A complex-declared function LITERAL in value position (resolved
  2026-08-30).** `Map((x: complex) -> complex ↦ 2x, [1,2,3])` compiled the arrow
  in the complex lane — the body reads `.re`/`.im` — while `_SYS.map` handed it
  the plain numbers `1`, `2`, `3`, so `2 * x.re` read `undefined` and the run
  answered `[{re: null, im: null}, …]` behind `success: true` where the
  interpreter answers `[2,4,6]`. A declared-complex ENGINE function passed the
  same way was already correct, because `ensureUserFunctionValueRef` binds a
  `_fn_h$v` coercing shim for it; a literal has no name to hang a shim on. It
  now takes the same wrapper inline at the value splice, built by the shared
  `complexCoercingWrapper`, so the two routes coerce at the same positions and
  in the same way, and the literal case runs to `[2,4,6]`. A literal with no
  complex-declared parameter emits the bare arrow, byte for byte as before.

  **A NON-REAL NUMBER bound on a block local (resolved 2026-08-30).** This was
  the last bound the block-local route declined where the engine route compiled:
  `const gd = (x: T) -> T where T: complex => 2x` applied to `3` failed closed
  and fell back to the interpreter, which answers `6`. A quantified parameter is
  erased before the literal's body canonicalizes (rule G1), and a block local's
  body is emitted by the ordinary function-literal lowering, which reads the
  parameter's own type — so the arrow computed in the real lane while the call
  site coerced its argument to `{ re, im }`, an object that body would have
  multiplied as a number. An engine definition has a second emission path that
  overrides the body's lane from the declared signature
  (`addDeclaredComplexParams`); a local has none.

  An earlier attempt at the lift was reverted because putting the literal's body
  in the complex lane broke the value-position case above: with the wrapper in
  place, that regression is gone, and the two halves of the boundary can be
  moved together. The function-literal lowering now reads the parameter types of
  the literal's own declared signature at their bounds — the same ground reading
  the call boundary performs — enters a bound-only complex parameter in a shape
  frame so the body compiles in the complex lane, and wraps the arrow in the
  `_SYS.cplx` coercion at those positions. `gd(3)` runs to `6`, `gd(3 + 4i)` to
  `6 + 8i`, and `gd(y)` with `run({ y: [1,2,3] })` to `[2,4,6]`, all agreeing
  with the interpreter and with the engine-level spelling of the same function.
  The regression gate — `Map((x: T) -> T where T: complex ↦ 2x, [1,2,3])`, the
  exact expression that reverted the first attempt — is pinned in
  `test/compute-engine/compile-generic-monomorphization.test.ts`. The
  block-local route now declines on exactly the engine route's conditions: an
  unbounded variable, and every target other than JavaScript.

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

| bucket      | target |   pop | the question                                                                                                                                                                                                                                                                                 |
| ----------- | ------ | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Integrate` | glsl   | 22 st | Quadrature inside a shader — which rule, what iteration budget, what happens on non-convergence. Large; do not start without deciding the budget question. **The remaining design-first entry** (former ranks 1 — `PointList`/`PointZ` and `At` — landed 2026-07-31/08-01, residuals below). |

**A-2 residual — `At` on GPU (landed 2026-08-01; design + rulings in
`docs/COMPILATION-MODEL.md`).** Scalar-index and literal-gather tiers over
statically-sized numeric bases shipped (any N ≥ 2 via per-N `_gpu_atN` helpers;
the `p_0[i]` census witness shape). Remaining, per the D4 disposition table — do
not re-derive:

- **Point-list bases: blocked on §3.F** (the node types `missing | tuple` and
  the object-domain-absence gate intercepts before any GPU table entry).
  Unblocking needs its own ruling: a per-operator absence projection (Missing
  point → NaN-component vector), or in-range type narrowing. Filed with the
  consumer item.
- Demand-gated: static-count dynamic gather (near-zero cost to flip — the same
  helpers in a constructor; witness count requested from the consumer), gather
  K > 4 (width ceiling), gather K 0/1 (the pinned 1-element-list contract has no
  shader shape), dictionary/string-key/ multi-index forms.
- Permanent (not TODOs): runtime-valued boolean masks (result length is not
  static — no shader value shape), unknown-length bases/index lists.
- Latent observation from the round (own look, out of scope):
  `BaseCompiler.isComplexValued` answers `true` for a literal `List` containing
  one complex element, skewing `aggregateComponentCount` for other callers.
- No retirement of the 26-state count without the consumer re-measure.

**A-1 residual — `PointList`/`PointZ` (main design pass landed 2026-07-31;
rulings + design in `docs/COLLECTIONS-MODEL.md`).** JS construction
(shortest-zip lowering, `iterationBudget` truncation cap), JS/GPU coordinate
projection, and the `?? NaN` missing-coordinate fix all landed; GPU
_construction_ stays fail-closed **by ruling** (no runtime-length GPU expression
values — the point-list dimension is the consumer's instancing axis). Remaining,
all demand-gated:

- Non-`isListType` components (tuple/set/union-with-collection) still decline on
  JS — lowering is deliberately narrower than typing (no per-point
  representation for such a slot).
- The **type handler's** `isListType` (`collections.ts`) classifies a bare
  `tuple`-typed or all-collection-union component as a list — so
  `PointList(k, P)` with `P: tuple` _types_ `list<tuple>` while `evaluate`
  (value-level `isTuple`) answers a single point. The compile predicates were
  hardened against this (staged review 2026-07-31); aligning the type handler is
  interpreter-visible and wants its own pass. Same-family holes, same pass:
  `hasPointElementType` (`collections.ts` ~684) accepts only `{kind:'tuple'}`
  nodes, not the bare `'tuple'` string; and projecting an **empty** point list
  diverges (compiled `[]`, interpreter absence — the evaluated empty transpose
  types `list<never>`, so the point-ness is unrecoverable; pinned as a known
  parity edge in `pointlist-compile-zip.test.ts`).
- A GPU projection **composed under arithmetic** (`PointX(…) * 2`) still
  declines: the projection's type (`list<number>`, no static dimension) fails
  the operand-shape gates even though the emission is a legal `vecN`. Fix = a
  dimensioned projection type — an interpreter-visible type-handler change,
  wants its own measured pass.
- No corpus re-measure yet: how much of the 11 st / 36 mem + 2 st actually
  closed is the consumer's count to re-run — do not mark this bucket resolved on
  our numbers.

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

- **Python arithmetic over a collection — what still fails closed after the
  2026-08-30 fan-out (recorded).** An arithmetic head with exactly ONE
  collection operand — an ordered list of numbers, every other operand provably
  a number — compiles as a list comprehension (`tryCompilePythonElementwise`,
  `base-compiler.ts`; parity pinned in
  `test/compute-engine/compile-python-parity.test.ts`). Three shapes keep
  failing closed, each for a reason no Python emission removes: two or more
  collection operands (NumPy silently recycles a length-1 axis and a `zip`
  comprehension truncates, where the interpreter answers
  `incompatible-dimensions`); a collection whose elements are not scalars (a
  matrix or a point list, where one level of fan-out hands a row or a point to a
  scalar operator); and an operand that is only possibly a collection
  (`broadcastable<T>`, a top-typed call), which may still bind to a list at run
  time. One recorded divergence: the interpreter answers `Nothing` for
  `Negate([])` but the empty list for `Add([], 1)`, while the compiled
  comprehension answers the empty list for both — the asymmetry is the
  interpreter's and predates the fan-out.
- **A bare-function, assign-inferred point function compiled with a LIST
  argument reads it as ONE point** (witness from the Tycho D-15 session,
  2026-08-30; filed here, compile lane). With `f(v) = PointList(…)` declared as
  a bare `function` and its signature inferred at assign time,
  `compile(f(P), {to: 'javascript'})` SUCCEEDS and the emitted `_fn_f(v)` reads
  its argument as a single point (`v[0]`/`v[1]`); a LIST-of-points argument then
  throws `RangeError: PointList: source component 1 is not an array` at run
  time. Loud, not silent — but it diverges from the interpreter, and it is a
  sibling of the D-232 lambda auto-broadcast residual. It also pins a design
  constraint for the ruled runtime broadcast-dispatch guard: `Array.isArray`
  cannot distinguish a list-to-broadcast-over from a point that IS the argument,
  so the guard must key on the parameter's DECLARED scalar type, never on the
  runtime shape alone. Repro: tycho `scripts/repros/d15-eval-cost-probe.mts`
  (lands with the D-15 diff).
- **A `set`-typed operand escaped BOTH scalar-infix arithmetic guards**
  (surfaced 2026-08-30 by the guard-narrowing round; RESOLVED same day). With
  `T: set<number>`, the interpreter answers
  `Error(incompatible-type, number, set<number>)` for `Add(T, 1)`, but the
  Python target emitted `T + 1` and the JavaScript target `_.T + 1`, both behind
  `success: true` — the guards' operand predicate asked `list<any>` /
  `indexed_collection<any>`, and a set matches neither. The same shape-predicate
  class as the closed GPU `gpuIsCollectionShaped` item above, and the two guards
  are a PAIR, so both gained the fix together: the predicate now tests the
  collection shape top (`collection<any>`), and a set-typed operand declines on
  both targets (the Python fan-out keeps its own narrower participation test, so
  a set never fans out — it is unordered, so a comprehension has no defined
  order). Pinned in `test/compute-engine/compile-broadcast-unary.test.ts`.
- **Unary broadcast over an empty collection disagrees between the lanes, and
  the interpreter is internally asymmetric** (surfaced 2026-08-30; predates the
  Python guard change). `Negate([])` evaluates to `Nothing` while `Add([], 1)`
  evaluates to `[]`; the compiled comprehension answers `[]` for both, on the
  Python and JavaScript targets alike. The `Nothing` looks like the quirk — a
  broadcast over zero elements has a natural empty-list answer — but making the
  interpreter consistent needs its own decision, since the `Nothing` spelling
  may be load-bearing for erasure somewhere.
- **`Equal`/`NotEqual` with exactly one collection operand declines on the
  Python target but is now expressible** by the same comprehension machinery the
  arithmetic guard uses (`[_tv1 == 5 for _tv1 in L]` with the target's existing
  tolerance test is the interpreter's list of booleans). Left declined because
  the relational family is deliberately excluded from the arithmetic guard; it
  is the same lift one operator family over, when someone wants it.
- **The arithmetic OPERAND boundary has the same statically-scalar-but-
  actually-array hole the call boundary just had** (surfaced 2026-08-30 while
  implementing the runtime broadcast-dispatch guard). The guard fixes the CALL
  boundary: `f(y)` with `run({y: [1,2,3]})` now broadcasts. But an arithmetic
  node between the input and the call does not: `f(y + z)` with
  `run({y: [1,2,3], z: 0})` emits `(_.y + _.z)`, JavaScript string- concatenates
  the array to `"1,2,30"`, `Array.isArray` on the RESULT is false, and the
  guarded call's direct branch answers `NaN`. Fixing it means the same
  declared-scalar-type-keyed treatment at scalar-infix operand boundaries (or a
  broadcast-aware `+` lowering), which is the same perf-sensitive shape as the
  ungated infix `target.operators` path entry above — the two should be designed
  together.
- **Arity-mismatched user-function calls diverge between the lanes, and the
  interpreter's too-many-arguments path THROWS a raw JS error out of
  `.evaluate()`** (surfaced 2026-08-30 by the Spread round; reproduces on a
  direct call with no `Spread` involved). Too few arguments: the interpreter
  answers a partial application (`a(3, 4)` for a 3-parameter function returns
  `(_) => _ + 7`), while compiled code calls with `undefined` holes and runs to
  `null`/`NaN`. Too many: compiled code silently drops the extras and computes,
  while the interpreter throws an UNCAUGHT
  `Error: Too many arguments for function ...` from
  `src/compute-engine/function-utils.ts` (~line 2761) instead of returning an
  error expression — an `.evaluate()` that throws a raw JS error is a defect
  independent of the lane divergence. Two fixes needed: the interpreter's
  too-many path must produce an error EXPRESSION, and the compiled call emission
  must mirror whichever arity semantics are affirmed (partial application is
  likely too rich to compile — a decline is acceptable there).
- **`Hypot((1, 2), 2)` disagrees between the lanes** (surfaced 2026-08-30 by the
  tuple-broadcast round; pre-existing). The interpreter reads the tuple as a
  point and answers `3` through the point norm (`pointNormType` and the
  `Square(Norm(v))` construction in Hypot's evaluate handler); the compiled
  JavaScript lane broadcasts and answers the pair `[2.236…, 2.828…]`. Same
  consistency class as the resolved `Sin(Tuple(...))` item: it needs one ruled
  direction, not a defense of either behavior.
- The `Multiply` ≥2-arrayish carve-out and the complex-element deferral —
  preserved verbatim through the broadcast rework, never re-examined.

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
`Product([1,2,3])`, `LCM`, `GCD`, `Length`.

Still open, in rough priority:

- **The infix `target.operators` path is unhooked** — the hottest shared path,
  deliberately not gated. `Matrix` and list-_typed symbols_ report
  `isCollection === false` and so route through it:
  `Add(P: vector<real^3>, Q: vector<real^2>)` still emits `P + Q`, and WGSL
  `Add(Matrix, 2)` emits `2.0 + mat2x2f(…)` (invalid WGSL, valid GLSL). Gating
  it is a perf-sensitive change and wants its own scoped pass. New JavaScript
  witness (found 2026-08-30 by the tuple-broadcast round): `Add(Sin((1, 2)), 1)`
  compiles to a runtime STRING — the `+` operator concatenates the array-valued
  left operand — where the interpreter answers
  `Error(incompatible-type, tuple, number)`. The tuple broadcast made this shape
  easy to reach, so the JS lane of this gate has a live silent-wrong-value
  repro, not only the GPU shape mismatches.
- **Complex-element collections** — `gpuOperandShape` reads a list of complex
  elements as `scalar` (via `isComplexValued`'s operand fallback), so the
  generic gate is inert for them. The fan-out path declines them explicitly; the
  generic path needs a separate complex-element rule.
- **Argument POSITION within a builtin signature is not modelled** — GLSL
  `step(float, genType)` takes its scalar first, `mod(genType, float)` last, so
  a wrong-position scalar (`mod(float, vec3)`) is admitted. Deliberate
  conservatism; tightening needs per-builtin arity/position tables.

**Residuals of the odd-denominator real-root fix for `.N()` on a negative base
(fixed 2026-08-03 on both lanes; recorded, not fixed).** The branch of
`(-2)^(p/q)` is decided by recovering `p/q` from the numericized exponent under
a coincidence-budget criterion (`realPowerBranchTerms`, `arithmetic-power.ts`;
pins in `power-negative-base-branch.test.ts`). (a) `_bignumComponent`'s
`radical === 1` fast path (`exact-numeric-value.ts`) still numericizes an exact
rational at the ambient precision before the handler sees it; keeping the exact
exponent was MEASURED (28 snapshot failures across 5 suites — machine `.N()`
display widths change) and REVERTED as broad churn needing its own gated pass.
(b) The branch is still decided by float reconstruction at `.N()` time — an
exponent with terms too large to recover from a 15-digit double (denominator ≳
3·10⁵ under the coincidence bound) takes the complex branch; curing that means
letting the exact exponent survive numericization (evaluate-handler signature
change, own design). Worth a ruling only if a consumer relies on
very-large-denominator float exponents. (c) `Pi.isInteger` is `undefined` (not
`false`), so `(-2)^π` still types `finite_number` and compiles to a real
`Math.pow` (→ `null`) while `.N()` is complex — a hedged compiled/interpreted
disagreement in the constant's type handler, orthogonal to the branch fix.

**A negative VARIABLE base has no sign-corrected `Power` lowering.** With
`a := -2`, `a^(2/3)` interprets to `1.5874` but compiles to `NaN`
(`Math.pow(-2, 0.666…)`). The odd-denominator correction exists only in the
constant-fold path and in `Root` (which is why `\sqrt[3]{a}` works). Closing it
means emitting `sign(x)^p · |x|^(p/q)` for every `Power(realvar, p/q)` — a
broader emission change with real snapshot risk.

**Follow-ups from the 2026-07-30 review round** (each found while fixing
something else; none is a regression):

- **`Power`/`Root` still yield `NaN` where the interpreter returns a complex
  value.** This is the ratified `finite_number` policy, not a defect, but it is
  the same user-visible surprise the `realOnly` retirement removed for `Sqrt`.
  Resolvable only by making those type handlers track the negative-base /
  fractional-exponent case — which would then let the emitter fold them complex.
- **`resultIsComplexValued` is duplicated** in `javascript-target.ts` and
  `gpu-target.ts` (~12 identical lines) because neither fixer could touch
  `base-compiler.ts`. `python-target.ts` very likely has the same `Sqrt`/`Ln`/
  `Log` split. Consolidate into `BaseCompiler` when fixing Python.
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
  `buildInterpreterFallback` (`base-compiler.ts`) now numericizes at the leaves
  (`e.N().re`) in both the expression and lambda branches — this is what makes
  every compile decline actually pay off. Regression tests in
  `compile-fallback.test.ts`.
- **An interval-js decline produced no `run` at all**: the target's primary
  failure class returns `success: false` WITHOUT throwing, so the free
  `compile()`'s catch-based fallback never saw it. `compile-expression.ts` now
  passes `fallback` through to the registered target, which normalizes both
  failure shapes (`buildIntervalFallback` → degenerate `{lo, hi}` interval run).
  With `fallback: false` the raw no-`run` decline shape still surfaces (pinned).
- **Sqrt/Ln/Log type claims** (the P2 ruling): an unknown-sign real operand now
  types `finite_complex` (Sqrt) / `complex` (Ln, Log with a valid base); a
  provably-positive operand keeps `finite_real`; a `number`-typed operand
  (NaN-capable) keeps `number`. Compile emission is UNCHANGED for a free real
  symbol on every target (real kernels, pinned) via the `isComplexValued`
  Sqrt/Ln/Log carve-out + operand-negativity dispatch in the JS and GPU
  emitters; a provably negative operand (literal or assigned) routes complex on
  both. `Log(2, -2)` still `number`/`NaN` everywhere — the interpreter gap
  stands, recorded below.
- **`Add`/`Multiply`/`Divide` over a type-only-provable non-finite operand**:
  `1 + Ln(0)` typed `integer` (lattice-sound but missing the provable
  `non_finite_number`), `2·Ln(0)` typed `finite_integer` (unsound). The three
  handlers now treat `type ⊆ non_finite_number` as provably non-finite. Root
  cause NOT fixed (recorded below): `BoxedFunction.isFinite` never consults the
  static type.
- **`Arcsec`/`Arccsc` aligned with the other six bounded heads**: pole value
  `~oo` is a member of `complex` (D10), so `poleType: 'complex'` and the
  unknown-magnitude join is `complex` (was `number`); the compiled complex
  dispatch now treats all eight heads uniformly. **Since REVERSED** — the two
  heads type `number` again over an unknown magnitude, because their pole at 0
  numericizes to NaN (`arcsec(0).N()` is NaN) and NaN is a member only of
  `number`, so a `complex` claim would exclude a value the operator actually
  produces. Widening it again requires changing `Arcsec`/`Arccsc` evaluation to
  produce `~oo` at the pole first; the rationale lives on `ARCSEC_DOMAIN` in
  `src/compute-engine/library/type-handlers.ts`, and the consequence for
  compiled code (the real lowering `Math.acos(1 / u)`, so an out-of-domain
  argument is a real NaN where the interpreter answers a complex value) is
  pinned in `test/compute-engine/compile-complex-result.test.ts`.
- **GPU colour constructors decline a 4th (alpha) operand** on GLSL and WGSL
  (`assertNoGPUAlpha`, `gpu-target.ts`) instead of silently dropping it; the
  vec3 colour chain is unchanged for 3-operand forms (byte-identical).
- **GPU `Sum`/`Product` decline a non-finite bound** (`assertFiniteGPUBound`)
  instead of emitting `for (int i = 1; i <= _gpu_inf(); i++)`; mirrors the
  JS/interval-js guard and message.
- **Python `Norm(matrix, 2)` lowers to `np.linalg.norm(m, 'fro')`** (CE's
  Frobenius semantics; numpy's ord-2 is spectral — a silent wrong value: 13.8806
  vs 13.9284 on `[[3,4],[5,12]]`). Static rank 1 keeps ord 2; unknown rank fails
  closed (`pyStaticRank`, `python-target.ts`).

New residues recorded by that round:

- **`Norm(scalar, 2)` on Python now declines** (was a runtime `ValueError`) —
  intentional side effect, flagged.
- **Multi-splice templates × impure operands — 7 sites fixed 2026-07-31, audit
  open.** Any lowering that splices a compiled operand more than once (or calls
  `compile()` twice on the same operand) re-evaluates an impure (Random-family)
  operand at run time. Fixed: JS `Mod`/`Remainder` (IIFE temp binding), GPU
  `Remainder`/`Cot` (both branches — the complex branch's early return had
  bypassed the guard)/`Coth`/`Beta` (hoisted temp via the shared
  `gpuOperandOnce` helper, decline when `!canHoist`), and the standalone
  `WGSLTarget` `Mod` (`wgsl-target.ts`, spliced its divisor 3×) — probed
  REACHABLE via a framed draw (`WithRandomSeed(7, Mod(10, Random()))` compiled
  with three `_gpu_rnd_draw` calls) and fixed the same way in the same round. JS
  `Cot`/`Coth` were already safe via `inlineExpression` (which binds compound
  operands); GPU `Square` is safe (its double-splice is gated to
  symbols/literals, which are pure).

  **Audit COMPLETED 2026-08-02** — all five target files plus the shared
  `base-compiler.ts` templates swept (three independent read passes, every
  candidate classified, every UNSAFE claim confirmed by a draw-count probe
  before fixing). **12 further sites fixed**, every fix purity-gated so pure
  emissions stay byte-identical (pinned; regression tests in
  `random-compile.test.ts` § "multi-splice × impure operand — the 2026-08-02
  audit round"):

  - JS `Equal`/`NotEqual` complex operand (`.re`/`.im` double splice) and n-ary
    chain middle operands (double `compile()`); JS `Range` 3-operand form
    (start/step re-spliced INSIDE the `Array.from` callback — was one draw per
    element at run time).
  - GPU `Round` (both forms), `Root` (odd degree), `Variance` (worst case:
    `Variance(Random(), Random())` emitted 12 draws for the interpreter's 2),
    `Argument`/`Conjugate` complex branches (vec2 temps), `gpuSelectionMask`
    chained-relation middles, `ContrastingColor` 3-arg (vec3-shaped — impure
    operands now DECLINE, D6). GPU `Add` complex fallback compiled every operand
    twice, orphaning hoisted statements (an orphaned `_tvN = _gpu_rnd_draw(…)`
    consumed a draw feeding nothing) — now pre-tests `isOpaqueComplexOperand`
    (`constant-folding.ts`) before decomposing; `Multiply`/`Subtract` fallbacks
    probed clean.
  - Shared `base-compiler.ts`: the relational-chain lowering inlined middle
    operands twice on targets WITHOUT `bindExpr` (GPU) — the old comment's
    rationale ("safe… deterministic seed") was stale, `_gpu_rnd_draw` advances a
    runtime counter; and `compileMatchTernary` spliced the Match subject once
    per comparison (twice per range pattern). Both now hoist an impure operand
    via `canHoist`/`hoistStatement` (language-aware decl) or decline; stale
    comments rewritten.
  - Latent-only, no code change: the interval target has NO impure lowering at
    all (no Random entry, closed head table) — its multi-splices are
    unreachable, like Python's. Python `Norm` order splice got the same guard
    comment as the Equal/NotEqual chains (comment-only, per the chain
    precedent).

  The dual-reviewer round on this diff caught and fixed two follow-on defects in
  the fixes themselves: (a) **draw ORDER** — binding only the impure middle made
  its draw execute before an inline impure endpoint
  (`Less(Random(), Random(), 0.9)` computed the wrong boolean); both the
  `bindExpr` and hoist branches of the chain lowering, and `gpuSelectionMask`,
  now bind EVERY impure operand in argument order when any needs binding (this
  also fixed the same order swap in the PRE-EXISTING JS `bindExpr` branch). (b)
  `ContrastingColor`'s bare `?:` (both the 3-arg and 1-arg forms) was invalid
  WGSL source — WGSL now emits `select(…)` (operands are pure by the new gate,
  so eager `select` is sound); GLSL text byte-identical.

  Known residuals, recorded not fixed: n-ary `NotEqual(a, R, b)` draws twice
  because canonicalization expands to `And` with two DISTINCT `Random()` nodes —
  interpreter parity, not a splice. (Since 2026-08-15 `And` is a short-circuit
  form — see `library/logic.ts`, `canonicalShortCircuit` — so the second node is
  drawn only when the first pair is not already `False`; the JavaScript target's
  `&&` behaves the same way, so parity holds.) An impure VECTOR-shaped chain
  endpoint alongside an impure middle now declines (was: compiled with the wrong
  draw order) — correct D6, tiny surface reduction. B1 short-circuit nuance:
  RESOLVED by probe (2026-08-02) as "the interpreter EAGERLY draws even a
  short-circuited chain operand (`Less(5, 1, Random())` consumes a draw), so the
  unconditional hoist at index ≥ 2 is exact interpreter parity" — SUPERSEDED
  2026-08-15: relational chains now short-circuit at the first `False` pair (see
  the `And`/`Or` entry under "Remaining work"), so `Less(5, 1, Random())` no
  longer draws in the interpreter. The chain lowering was updated the same day:
  a bound operand at index ≥ 2 is now bound BEHIND the pairs that precede it (JS
  `(5 < 1) && ((_tv1) => (1 < _tv1) && (_tv1 < c))(draw())`, Python likewise),
  and a shader target — whose only binding form is an unconditional hoisted
  statement — DECLINES an impure operand at index ≥ 2 that must be bound (D6).
  Pinned in `random-compile.test.ts` ("short-circuits past a bound draw", "index
  ≥ 2 … DECLINES").

- **`Norm(matrix, "Infinity")` / `Norm(matrix, 1)` on Python: PROBED, faithful**
  (2026-07-31). The interpreter's rank-2 branch computes max row sum / max
  column sum — exactly numpy's matrix `ord=inf` / `ord=1`. The probe also showed
  any OTHER literal matrix order (`3`, `-1`, …) stays symbolic in the
  interpreter while numpy raises or diverges — those now fail closed (D6),
  pinned in `compile-python.test.ts` § "Norm order guards".

**`Equal`/`NotEqual` over collections on Python — RULED and SHIPPED
2026-07-31.** User ruling: scalar, matching the interpreter. Probing showed the
interpreter's actual gate is `ops.filter(isCollection).length < 2`: **≥2
collection operands → a scalar pairwise-adjacent chain** (now compiled via the
`_ce_eqcoll` helper — shape-guarded `np.all`, length mismatch is `False`, string
elements fall back to `==`, tolerance baked); **≤1 collection operand →
element-wise broadcast to a `list<boolean>`** (`Equal([1,2], 5)` →
`["False","False"]`), which **stays fail-closed by a second ruling
(2026-07-31)** — the interpreter fallback returns the correct list, and a
compiled lowering (ndarray-valued boolean expression + parity harness support
for list results) waits for a consumer witness.

_Unverified, recorded so it is not lost:_ a decline thrown mid-compile may not
unwind `BaseCompiler._localVector` / `_localComplex` if those pushes are not
`finally`-protected, which would let one fail-closed throw leave stale frames
for later compilations in the same process. **Probed and could NOT reproduce**
(three declines between two identical compiles gave byte-identical output), and
every existing GPU decline throws the same way, so it is pre-existing if real.
Worth a `finally` audit rather than a bug hunt.

**B. Plain missing codegen — no design needed, small.** Good first-session
material if someone wants a quick win.

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

### Kleene-absence residue (missing-value typing landed 2026-07-24)

The `Missing`/`missing` feature shipped (record in `CHANGELOG.md` and
`docs/TYPE-SYSTEM.md`).

**Ruling (2026-07-24):** comparisons are **IEEE over `NaN`** (`NaN == NaN` is
`False`, orderings with `NaN` are `False`) and **Kleene over the `Missing`
symbol** only, across the full relational family (`Equal`/`NotEqual`/`Less`/
`LessEqual`/`Greater`/`GreaterEqual`). Absence for discharge (`IsMissing`/
`Coalesce`) and aggregates (`Max`/`Mean`/…) is unchanged — `NaN` stays absent
there. Because `NaN` follows IEEE, compiled and interpreted numeric comparisons
now agree by construction (plain `==`, no guard); empty `Max`/`Min` compile to
`NaN` matching the interpreter.

**Ruling (2026-07-24, later):** a scalar `If`/`Which` condition evaluating to
`Missing` yields a catchable **error expression** ("The condition is absent…"),
the R `if (NA)` stance — absence is a runtime data state, not a program defect.
The typo path (a condition that is not boolean at all, `If(3, …)`) deliberately
keeps its spell-check **throw**: changing it was ruled out of this feature's
blast radius. No residue remains from the missing-value feature.

### Broadcast typing residue (`broadcastable<T>` lift landed 2026-07-17)

The lift itself shipped (record in `CHANGELOG.md` and
`docs/plans/2026-07-11-broadcast-typing-lift-design.md`). Genuinely remaining,
as separate demand-gated items:

- **Phase-2 declared-type reconciliation** for symbolic-length ranges (see the
  design doc). Two broadcast-lift Phase-2 test pins currently assert the
  declared type + Map form pending this item.
- **Param-type-driven lambda-body typing:** lambda BODIES over untyped params
  still type scalar — only applications are lifted; revisit only with a
  param-type-driven design.
- **Python broadcast compilation:** the Python target lowers arithmetic to infix
  and has no generic `_ce_bcastf` helper, so possibly-collection operands fail
  closed (interpreter fallback is sound). Build the helper only if a
  compiled-NumPy binding path is ever needed.
- **Matrix rank preservation in `broadcastResultType`:** matrix intermediates
  flatten to `list<number>` (rank lost) — pre-existing convention, someday-fix.

Interactions to respect: non-finite typing convention, `infer(unknown)`
destructiveness, scalar-requiring contexts (exponents, comparisons, plot
coordinates).

### Symbol-identity residue (initiative complete, shipped 0.96.0)

The name-vs-binder repair is done — phases 1–3 including the sanctioned binder
mechanism. The current contract is `docs/SCOPING-MODEL.md`; the detailed
implementation stages remain in Git history. What is genuinely left:

- **Raw-name-fallback provenance** — the one open thread, deferred to a future
  phase. A pre-boxed operand can be applied twice through a raw name rather than
  a binding, which binding identity cannot distinguish; the behavior is
  characterization-pinned (`@fixme`) rather than fixed.
- **Found-not-fixed, all pre-existing and pathological:** `Limit(1/(x-a), …)`
  capture in `library/calculus.ts`; a global `_1` that _holds a value_ stalls a
  pipe `Map`; flat-vs-nested `Multiply` breaks `isSame` (`\frac{ax^2}{2}` vs the
  antiderivative's flat form) — possibly a canonicalization gap, unowned.

### Random-redesign residue (shipped 0.95.0/0.96.0)

The redesign shipped and the one-release tombstones are deleted. The current
model is `docs/RANDOMNESS-MODEL.md`. Remaining:

- **`compileShader` does not apply `rewriteAngularUnit`.** Both GLSL and WGSL
  `compileShader` route through `compileShaderBody`, never `compileOrThrow`
  (`gpu-target.ts` ~:4249), so a degree-mode engine emits radian trig on that
  route only. Pre-existing and unrelated to randomness.
- **`Map` element-type derivation** still widens independently of the domain
  narrowing the random family uses (`RandomChoice` itself was aligned with
  `Random` on 2026-07-27 via the shared `randomElementType`).

Settled, not work: the GLSL sibling-draw order is an accepted documented caveat
(operand evaluation order is unspecified in GLSL; WGSL pins L→R), and the "host
uniform" seed-ABI deferral is user-ratified.

**Open consult with the Tycho team** (do not land unilaterally): whether the
_released_ seeded `Random()`/`Shuffle` forms should move from bake to stream,
matching the two-primitive model. Awaiting their acknowledgement.

### Product feature track (agreed 2026-07-04)

CE is the foundation for Tycho / Graph Paper: an app helping scientists,
students and educators collaborate and communicate about scientific topics. The
2026-07-04 capability survey against that goal found the engine strong on
plotting/compile targets, units & quantities, logic/sets, linear algebra,
equation systems, and number formatting — and thin in the areas below. The
agreed items (`Series`, trig rewrites, statistics Phases 1–2, the explain API,
significant-figures display, the `Measurement` MVP) have all landed. Their
user-facing record lives in `CHANGELOG.md`; internal chronology lives in
`docs/STATUS_REPORT.md` and Git history. What remains (effort S/M/L):

**Statistics residue (demand-gated Phase 3, design doc §10):** inverse
regularized incomplete gamma/beta kernels and the distributions that need them
(Student-t, χ², F, Geometric…), `RandomVariate` sampling (reuse the `Sample`
RNG/seed policy), and fit diagnostics (R²). Also: the Python execution-parity
suite for the new scipy mappings is guarded/skipped until scipy is installed in
`./venv`.

**Series residue:** bare `O(…)` parsing remains deferred (design doc §8 Q3);
revisit for lenient mode once the parser work settles. From the Puiseux/log
round (landed 2026-07-12), deliberate defers that could be revisited on demand:
log-carrying expansions at ±∞ (`1/ln x`, `ln(ln x)`, `sin(ln x)`, `e^{1/x}`
defer — correct-over-wrong), exact terminating expansions still emit a
conservative `BigO` (`assembleLaurent` has no exactness notion), combined
distinct radicals grow `lcm(d)` uncapped inside add/mul (bounded by the deadline
→ clean defer), and `diffLaurent` asserts `d === 1` (polygamma ladder only).

**Typed function literals residue (demand-gated; current contract in
`docs/LANGUAGE-MODEL.md`):** the typed `Function`/`Typed` core landed 2026-07-12
(652a20fc); the signature-string sugar
(`["Function", body, "'(x: integer) -> real'"]` canonicalizing into the
structural form) landed 2026-07-19. Deferred until a consumer asks: **(S/M)**
optional/variadic parameter annotations (`["Typed", "xs", "'number+'"]` — the
encoding already admits it; needs `makeLambda` arity handling — the sugar
rejects these markers until then), **(S)** a strict-mode runtime check of the
result against the declared return type (returns are pure ascriptions today),
and **(S)** LaTeX typed-parameter notation behind a serialization style flag
(annotations currently drop in LaTeX).

**Compiled recursive lambdas** shipped 2026-07-19 as lenient true recursion.
Standing contracts: termination is the caller's — runaway recursion throws a
catchable `RangeError`; complex-valued recursion needs a `Typed` `complex`
return ascription (untyped applications type `broadcastable<number>` and hit the
complex-bcast deferral). Remaining follow-ups, both demand-gated:

- **(M) GPU literal-depth unrolling** (WGSL/GLSL cannot recurse; GPU stays
  fail-closed): the v1 memoized literal-argument specialization design
  (preserved in the design doc's git history) is the route — gate on a GPU
  consumer.
- **(M) Interpreter perf** (triaged + fixes landed 2026-07-19: the D2 numericize
  tail now gates on lexical `isConstant`, and the full-library sweep made
  non-lazy handlers trust pre-evaluated operands — symbolic recursive unwinding
  is linear, not exponential). What this leaves behind is the governing
  **evaluate-handler contract** (the one to enforce in review): a `lazy: true`
  operator receives RAW operands and its handler owns their (single) evaluation
  — `Add`/`Multiply`/`Sum`/`Product`/ `Measurement`/`NumeratorDenominator`
  re-evaluate legitimately; a non-lazy operator receives EVALUATED operands and
  must not re-evaluate them (each call re-descends the unmemoized subtree; under
  nesting that compounds exponentially). Do not delete the lazy `Add`/`Multiply`
  maps — the experiment was run and froze recursive unrolling at one level per
  pass, which is what confirmed the lazy/non-lazy split is the real contract.
  Remaining, all demand-gated:
  - two sites carry the same dynamic-scope `unknowns.length === 0` predicate as
    a _latent_ instance of the trap, with no demonstrated observable misbehavior
    — leave them until one surfaces: the equation-equivalence `eq` in
    `relational-operator.ts` is reachable only via a direct `.isEqual()` on two
    equation objects (normal `Equal(eq1, eq2)` canonicalizes to a chain and
    never compares them as equations), and that path runs at top level where
    `unknowns` is correct; `isPolynomialExpression` in `linear-algebra.ts` ×3
    sits behind callers that pre-evaluate operands. A naive `isConstant` swap at
    either would change classification of assigned symbols in unevaluated input,
    so it is not a free rename.
  - **Separately** (pre-existing, unrelated to the D2 predicate): a binary
    `Equal(w, 1)` with a bound-but-symbolic parameter evaluates to `False`
    inside a function application rather than staying inert (`w === 1`) as it
    does at top level — the low-level `eq(lhs, arg)` in `Equal.evaluate`
    (`relational-operator.ts`) decides the bound param `w` unequal to `1`
    instead of undecidable. Own triage; not touched by the D2 fix.

**MathNet parser tail (S/M; corpus at 371/428 CI-gated after the 2026-07-09
rounds):**

_Next up (agreed 2026-07-09):_

- **MATH genre-gap tail (S/M):** the Hendrycks MATH genre sweep (report:
  `docs/mathnet/math-genre-sweep.md`, tagged failures:
  `math-genre-failures.json`) stands at **97.66%** clean (371 of 735 failures
  fixed) after the 2026-07-09 rounds. Remaining ranked tail: (1) styling
  remnants (11, mostly array-env/prose — low value); (2) units residue:
  `yd`/`qt`/`pt` and currency (`USD`, `cents`, `euro`) have no `unit-data.ts`
  symbols (adding them is a units-subsystem call, not parser work); spaced
  `\text{miles per hour}` (interior spaces are stripped before resolution);
  Quantity arithmetic does not cancel compound units (`18 in / (12 in/ft)` →
  `1.5 in/in/ft`, not `1.5 ft` — a Quantity-simplification item); (3) small
  leftovers: `\cancel` inside `array`-env `@{}`/`\cline` layouts, set-congruence
  `\{0,1\}+\{1,4\}\equiv…` (set arithmetic, out of scope), and possible future
  upgrades to `IndexedSequence` (lazy-collection semantics, the parenthesized
  `(a_n)_{n\in\mathbb{N}}` form). Ascii-pipe divisibility evidence doubled (36
  more hits, tracked below). Skip: `array`-env long-division layouts, `\nabla`
  puzzle ops, repeating decimals `0.abab\overline{ab}`. _Rest of the tail:_

- **Polynomial-ring notation (M):** parse blackboard-bold rings followed by a
  bracketed variable list, e.g. `\mathbb{Z}[x]`, `\mathbb{R}[X,Y]`, as an
  inert/structural algebraic object instead of treating `[...]` as indexing.
- **Set-image bracket notation audit (S/M):** `f[S]` is parser-clean today as
  `At(f, S)`; decide whether set contexts need a distinct structural
  function-image head for expressions such as
  `f[\operatorname{divs}(m)] = \operatorname{divs}(n)`. **`Interpret` —
  generalization ladder (design: `docs/LANGUAGE-MODEL.md`):** v1 landed
  2026-07-09 — the explicit `Interpret(expr)` head turns continuation-bearing
  sums/products into formal `Sum`/`Product` under a strict arithmetic-
  progression gate (`1+2+\dots+n` → `Sum(k,(k,1,n))`; parity mismatches and
  anything unproven stay inert); v2–v4 (polynomial/geometric recognition,
  Berlekamp–Massey → `RSolve`, async OEIS-backed `ce.interpret`) followed.
  Remaining, demand-paced:

- **Known edge:** `simplify()` on `-(2·4·\dots·2n)` distributes the outer sign
  into the product and folds (pre-existing).
- **Promotion decision** (after product usage): whether bare
  `evaluate()`/`simplify()` should invoke the recognizer by default.

Still deferred: ASCII-pipe divisibility (`p|a+1`) because it conflicts with
absolute-value syntax (though the parenthesized form `(a+f(b)) | (a^2+bf(a))` is
unambiguous and could be revisited); set arithmetic such as `2\mathbb{Z}+1`;
richer `array`/`cases` environment variants; prose-heavy or fragment-boundary
inputs that need surrounding natural-language context.

**Uncertainty/Measurement residue** (MVP landed 2026-07-07). Deferred:

- **Dual-number correlation tracking** (correct-by-default) — the documented
  upgrade past independent propagation, which over/under-estimates when one
  measured variable is reused across operands (`x·x`, `x/(x+1)`). A
  `BoxedMeasurement` carrier with per-source identity; the hard part is
  source-id stability across re-boxing (design doc "Non-goals").
- **Relative-error notation** (`±5%`) and **distribution/`RandomVariate` links**
  (reuse the statistics RNG/seed policy).

**`FindFit`/`FindRoot` residue (landed 2026-07-21, Tycho item 77):**
demand-gated v2 items — per-point **weights** (resolved future shape: a trailing
optional `weights` argument, NOT tuple-shape deduction), parameter
uncertainty/covariance output (`JᵀJ⁻¹` is a byproduct), general `FindMinimum`,
and multi-start/global search (revisit only on corpus evidence of basin
sensitivity). Known naming quirk to document for consumers: a parameter named
`e` canonicalizes to `ExponentialE` and cannot be fit.

**Mathematica surface forms — deferred tail (need user steer before attempting;
landed record in the 2026-07-14 commits):** Tier 3 heads (`NSolve` — cheap as
Solve+N — and `Reduce`; `FindRoot` landed 2026-07-21 via the item-77 nonlinear
least-squares core, with `(x, x0)` start tuples and box constraints); the
`{i, n}` 2-element iterator shorthand and bare-count `Table(expr, n)` (rejected
as malformed for cross-operator consistency — adopt everywhere at once if ever);
symbolic directional limits (`lim_{x→a⁺}` at a symbolic point stays inert —
representation correct, evaluation gap). Related open parse question (not
filed): number-juxtaposed bracket lists (`2[1,2,3]`) don't parse;
`2\cdot[1,2,3]` does.

**Not yet agreed (proposed 2026-07-04, awaiting a call):**

6. **MathML output + speakable text (M).** Communication and accessibility:
   MathML serialization for export/interchange (web, Word, EPUB) and a
   speakable-text serializer for screen readers. AsciiMath output already
   exists; MathML and speech are absent. Accessibility matters for the education
   audience.
7. **Chemistry notation — mhchem `\ce{}` (M).** Chemical formulas, isotopes,
   reaction arrows. Only if chemistry is in scope for Graph Paper — decide
   before investing; `mol` exists solely as a unit dimension today.

### Review findings (2026-07-04) — residue

The 2026-07-04 review's P0/P1 fixes all landed (DSolve repeated-root and
Error-node bugs, the ODE P1 tail incl. the parsed-LaTeX path, the loose-parsing
cluster with the `strict` escape hatch, and the top P2/P3 items: Beta poles,
`x·∞`, inverse-hyperbolic poles, the rules.ts edge bugs). The completed review
campaign is summarized in [`docs/STATUS_REPORT.md`](./docs/STATUS_REPORT.md).
Still open from its ranked list:

- **defint error bar 1.6× optimistic on endpoint-singular integrands** — large
  (tanh-sinh quadrature).
- **Perf tail.** The 2026-07-01 performance review (P0–P3,
  `PERFORMANCE_FINDINGS.md`) fully closed 2026-07-18 — its status table records
  what shipped and, importantly, what was **measured unprofitable and must not
  be re-attempted without a new profile** (P2-2 `isSubtype` memo, P2-4
  simplify-history scan, the `bignumRe` memo, P3-1 `.json` cache). Still open,
  measurement-gated: cold-start bundle size, and the post-drift-fix residual
  tail — 6 benchmark cases still < 0.95× vs 0.73.0, worst CE4 erf-integral 0.62×
  (case-specific integrate/simplify machinery growth, not box tax) — a candidate
  future perf item. **Also measured-unprofitable: both P1 differentiation levers
  and the `.mul()` fast-path pivot** (2026-07-19) — see "Symbolic-evaluation
  performance → P1" below before touching `derivative.ts` or
  `sortProductOperands` for speed.
- **Loose-parsing low items:** infix calculator notation `5 nPr 2` is
  unsupported (a new-notation design item, not a map gap); explicit `_a`
  wildcards in arrow-string rules are a silent no-op (redundant there —
  auto-wildcarding covers it). `sqrt2x` → `√(2x)` is a deliberate policy
  (consistent with the bare-function convention `cos 2x` → `Cos(2x)`), not a
  bug.
- **Doc/cosmetic tail:** locale separators.
- ODE P2s — folded into the DSolve/NDSolve track below (**B12**).

### Symbolic capability gaps

#### B9. `Solve` — beyond the Wester ceiling

The Wester `Solve` score is saturated at our principled ceiling (14/21; the last
two gaps — `xˣ = x`, `sin x = tan x` — are harness artifacts: the harness grades
SymPy's arbitrary finite root-slices, not a CE capability gap). The section is
kept for that harness-artifact explanation, which the Fungrim track
cross-references. Genuinely open Solve items:

- **Diophantine deferrals** (Phase 3 shipped linear n-variable + Pell +
  Pythagorean triples; remaining porting assessment in
  `docs/plans/2026-07-04-diophantine-assessment.md`): sum-of-squares tier (fits
  a representation function better than Solve), general binary quadratics via
  `transformation_to_DN`, half-bounded-Range instantiation (currently inert by
  design), `factor_list`-style auto-factoring. Ternary quadratics deliberately
  skipped (low value); weighted-coefficient / ≥4-square parametrizations
  deliberately refused (textbook families are provably incomplete — the contract
  emits only complete families).
- **Inequality and system solving via `Solve`** remain partial (see
  `test/compute-engine/solve.test.ts` commented `@todo` cases); linear
  inequality systems are handled, general ones are not.
- The solve rule set is acknowledged incomplete (`solve.ts` "MOAR RULES", plus
  two deferred side-condition checks noted in-file).

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
numericize — PolyLog, elliptic kernels): CE 0/35 · CE+R/F 21/35 · SymPy 7/35 ·
Mathematica 32/35 (CE+R/F **12 → 20** after the R31 nested-radical substitution
fallback — closing

#2/#10/#11/#12/#15/#16/#17/#18 — then **20 → 21** after the R32
Euler-substitution lever ("Lever C") closing the √(quadratic)-nested **#9**; see
**Coverage tracks → Rubi**). (Rubi chapter translation — the lever for the
indefinite-∫ gap, with Rubi now recovering 6 of the 8 hard Wester integrals — is
its own track: see **Coverage tracks → Rubi**.)

#### B12. ODE solving — `DSolve`/`NDSolve` beyond the first slice

`DSolve` now covers first-order linear (integrating factor),
constant-coefficient homogeneous up to order _n_ (numeric characteristic roots
with clustering), nonhomogeneous constant-coefficient with polynomial, sine, and
exponential forcing via undetermined coefficients — including resonance (forcing
`sin(ωx)` when `±iω` is a characteristic root) and orders ≥ 3 — second-order
Cauchy–Euler (homogeneous and, since 2026-07-18, nonhomogeneous via an x-power
indicial ansatz with a variation-of-parameters fallback), the Airy family
`y″ = (px+q)y` (`AiryAi`/`AiryBi`, with new `AiryAiPrime`/ `AiryBiPrime`
operators and full derivative closure), the first-order nonlinear classes
(separable with _implicit_ `F(y) = G(x) + C` solutions, Bernoulli `v = y^{1−n}`,
first-order homogeneous `y′ = F(y/x)`, exact `M dx + N dy = 0`, and Riccati —
constant-particular, plus the `y = −u′/(q₂u)` Airy linearization for
`y′ = q₀(x) + q₂y²` with linear `q₀`), first-order linear systems (distinct
eigenvalues, diagonal with repeats, and defective 2×2 via a generalized
eigenvector, gated on an exact `(A−λI)² = 0` check so near-repeated numeric
eigenvalues stay inert), and initial/boundary conditions (solving the linear
system for the integration constants). `NDSolve` integrates adaptively
(Dormand–Prince 5(4) with dense output; scalar, higher-order reduction, and
first-order-system forms). Unsupported forms stay **inert rather than wrong** —
preserve that contract as coverage grows. (The constant-coefficient Abel rung —
dead code shadowed by the separable rung — was removed 2026-07-18.)

The CE-vs-SymPy audit harness (`benchmarks/audit/dsolve.ts` + `gen_dsolve.py`,
substitute-back residual oracle, 51-case corpus seeded from SymPy's
`test_ode.py`; landed 2026-07-10) grades **CE 50/51 correct, 0 wrong — at parity
with SymPy (50/51)** after the 2026-07-18 frontier round (BY1 Riccati→Airy —
which SymPy errors on —, BY3 nonhomogeneous Cauchy–Euler, BY4 Airy, BY5
repeated-eigenvalue system). The one remaining `unsupported` row is
**variable-coefficient second order** (`sin(x)y″ + y′ = cos x`), where SymPy's
"solution" is nested unevaluated integrals — a `p = y′` reduction-of-order rung
would need to emit inert-integral-carrying results to match, a contract question
before it is a coding task. Ranked next steps (good contributor territory):

- **`NDSolveFunction` system form:** `NDSolve` is adaptive (Dormand–Prince 5(4)
  with dense output, landed 2026-07-18) and `NDSolveFunction` returns a callable
  `Function(InterpolatingFunction(data, x), x)` — but **scalar forms only**; the
  multi-dependent system form stays inert. A vector-valued interpolating result
  needs a shape decision — demand-paced. Known engine-level quirk (pre-existing,
  pinned in tests): applying a MathJSON-**re-boxed** literal resolves the
  interpolation one `evaluate()` late (`N()` is immediate).
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
- A proper `DiracDelta` (for derivatives of step functions, currently 0 a.e.)
  remains a possible future refinement.

#### B13. Wester capability gaps — the skip ledger in `wester.test.ts`

`test/compute-engine/wester.test.ts` is the CI correctness suite transcribed
from Wester's CAS review (the categories the `benchmarks/audit/wester.ts`
harness cannot ingest). The convention: a gap exists there as a `test.skip`
asserting the **correct** answer — unskipping is the acceptance test. The
2026-07 campaign worked the ledger from 18 skips down to **one**:

- **Wester 9 — recursive denesting** (the Putnam radical
  `√(14+3√(3+2√(5−12√(3−2√2)))) → 3+√2`): only single-level `√(a+b√c)` denesting
  is implemented; the multi-level/recursive case is a deliberate algorithmic
  project (Landau/Blömer-style).
- **Linear algebra residue** (not skip-representable, tracked here): matrix
  square root beyond exact 2×2 (n×n wants eigendecomposition or Denman–Beavers);
  exact singular values beyond a 2×2 Gram matrix. Two wester tests are
  active-but-weakened rather than skipped (stale "skipped" comments in-file):
  fused-form `row-vector · (a·M1 + M2)` asserts the current `MatrixMultiply`
  type rejection, and the symbolic Vandermonde determinant is spot-checked
  numerically because `Factor`/`simplify` leave it unfactored (a `/(−w+x)`
  division artifact).
- Missing heads noted in comments: `MatrixExp` (`Exp` of a matrix broadcasts
  elementwise — it is _not_ the matrix exponential), matrix functions generally
  (sine of a matrix), Jordan / Smith normal forms (→ B14).
- Closed-form table growth for infinite sums/products (beyond the
  `namedSeriesClosedForm` table landed 2026-07-18 — e.g. `β(4)`, Hurwitz-shifted
  bases `(k+m)^{−s}`, higher moments `Σk²rᵏ`) remains demand-paced.

Untranscribed corpus categories (future tranches): systems of equations /
congruence solving, special functions, transforms, ODEs/PDEs (→ B12),
vector/tensor analysis, numerical analysis.

#### B14. Wester representation gaps — problems the suite cannot state

Distinct from B13: these Wester problems have **no CE API to express them**, so
they cannot exist as `test.skip`s — each needs a naming/design decision first,
then its acceptance test goes into `wester.test.ts`. Mathematica spellings are
deliberately NOT aliased (decision 2026-07-05); the Mathematica→CE
correspondence table lives in
[`docs/MATHEMATICA-NAMES.md`](./docs/MATHEMATICA-NAMES.md) — **probe CE's own
names before adding an entry here** (many presumed-missing heads exist under CE
names: `NthPrime`, `NPartition`, `PowerMod`, `ModularInverse`, `StirlingS1`,
`Rationalize`, `PrimitiveRoot`, `ContinuedFraction`, matrix ∞-`Norm`,
`BaseForm`, finite-domain `ForAll`/`Exists`).

- **Repeating-decimal representation — producer direction:** an equivalent of
  `ToPeriodicForm`, rendering an exact rational as its periodic-decimal object
  (the LaTeX serializer's `repeatingDecimal` option covers only float display;
  the consumer direction — repeating-decimal literals boxing as exact rationals
  — is done).
- **Quantifier elimination over ℝ:** `ForAll`/`Exists` evaluate only over finite
  domains; the Wester/Liska–Steinberg stability problems need QE over real
  closed fields (CAD or virtual substitution) — a major subsystem, catalogued
  here for completeness, not planned.
- **Matrix decompositions & functions:** `MatrixExp` / general matrix functions
  (`Exp` of a matrix **broadcasts elementwise** — the footgun is documented, but
  an actual matrix exponential remains future work); symbolic singular values
  (`SVD` is float-only); Jordan / Smith normal forms; symbolic Frobenius norm
  (`Norm(M, 'Frobenius')` for symbolic entries).
- **Hypothesis testing:** `MeanTest` etc. — undeclared; only worth pursuing if
  the statistics track (GP items) calls for it.

#### B15. Parameter-conditional results — the last `Which` producer

The conditional-values design
([`docs/plans/2026-07-12-conditional-values-design.md`](./docs/plans/2026-07-12-conditional-values-design.md))
is ratified and its Phases 1–3b landed: `When` threading algebra, the Solve
adopter (trig/hyperbolic validity + radical extraneous-root guards), and the
convergence-conditions adopter (improper-integral endpoint guards, geometric
series `1/(1−x) {|x|<1}`). Remaining:

- **Definite-integration region splitting (`Which`) — the only open producer.**
  Motivating case: `∫_{−π}^{π} (1 − x·cos t)/(x² − 2x·cos t + 1) dt` = `2π` for
  `|x| < 1`, `0` for `|x| > 1` — CE correctly stays inert today; locating where
  poles cross the contour is the hardest part and stays with this adopter.
- **Cosmetic residual:** an unsatisfiable conjoined guard (`∫₀^∞xᵖdx`) displays
  rather than collapsing — needs contradiction detection in assumptions; not
  worth it standalone.
- **Known Phase-1 limitation** (accepted, revisit on evidence): a conditional
  nested under a lazy operand (`5 − When(x,c)`) lifts fully only on a second
  `evaluate()`; the guard is never dropped.

### Collections — laziness & fusion backlog

The 2026-07 laziness audits (rounds 1–2 + review rounds, landed by 2026-07-17)
and the T1/T2 follow-up round (landed 2026-07-19: finiteness guards on
`CountIf`/`Position`/`Ordering`/`DictionaryFrom`/`RecordFrom`; threshold-hybrid
lazy views for `Insert`/`DeleteAt`/`ReplaceAt`, `Partition` chunk/window forms,
`SlidingWindow`, `ChunkBy` via the shared `windowedCollectionOps` helper) leave
this backlog:

- **T3 (deferred, low value):** `Keys`/`Values` (dicts are small), `Chunk`
  (needs count only).
- **Map auto-compile v1 gaps (shipped 2026-07-19; revisit on a profile):** the
  explicit-materialization route stays interpreted (ratified non-goal — do not
  reorder `_computeValue` steps 3/3b), and non-`Map` lazy collections (`Filter`,
  `Comprehension` bodies) and bignum drains are not attempted. See
  [`docs/COMPILATION-MODEL.md`](./docs/COMPILATION-MODEL.md).
- **Structural rewrite layer — open design decision (user has not ruled).** The
  stacked-lazy-`Map` drain cost that motivated fusion is addressed: drain-time
  lowering (`map-lowering.ts`, shipped in this cycle's release) applies
  broadcast-shaped lambda levels directly at iteration, ~3× (`evaluate()`) / ~4×
  (`.N()`, machine path) on the Tycho item-103 witness; structural
  canonical-level fusion (`Map(Map(s,f),g)` → `Map(s, g∘f)`) was considered and
  REJECTED (canonical forms are user-visible; reactivity). What remains open is
  the broader question: `Count(f(x))`-through-eager-op cheapness needs
  canonical-level rewrites, a churn-heavy direction to decide deliberately.
  (Related closed rulings, recorded in `docs/COMPILATION-MODEL.md` and the
  0.95–0.98 CHANGELOG entries: Map auto-compile stays machine-precision-only —
  no bignum-safe compile tier.)
- **Latent issues: none remaining.** The 2026-07-19 latent sweep dispositioned
  the whole former list (fixes, could-not-reproduce verifications, and an `At`
  `@todo` audit — record in that day's commits and `CHANGELOG.md`); the one
  lasting convention: `Slice` finiteness is honest — negative end over an
  infinite source is an infinite tail, negative start over one is inert,
  unknown-length sources report finiteness unknown.

### Strings — operators left for a later phase (opened 2026-08-16)

Phase 1 of the strings work made `string` an indexed collection of `character`
(`docs/STRING_ROADMAP.md`, "Decision: strings become indexed collections of
characters"). The library audit from that phase, retained in the model,
classified every signature that admits `collection<T>` /
`indexed_collection<T>`. Phase 1 shipped the string-preserving arm for the
operators the preservation rule makes mandatory; the entries below are the ones
deliberately left out, each with the reason it is a judgement call rather than a
forced consequence.

- **`RandomChoice`.** It draws _with_ replacement, so its result is a multiset
  over the source's own elements — arguably element-preserving, arguably
  list-out. Needs a ruling before it can be classified.

The Phase 2 work items themselves — the `Join`/`StringJoin` role split, the
generic contiguous-subsequence family (`ContainsSequence`, `RangeOf`,
`StartsWith`, `EndsWith`), `StringReplace`, trim/pad/repeat, the case
operations, `StringCompare` and `NumberFrom` — are specified in
`docs/STRING_ROADMAP.md` and are tracked there, not duplicated here.

### `StringFrom` with no `format` does not use `unicode-scalars` (found 2026-08-16)

`doc/97-reference-strings.md` documented the default format as
`unicode-scalars`, with the examples `StringFrom(128287)` → `"🔟"` and
`StringFrom([127467, 127479])` → `"🇫🇷"`. The handler instead treats a missing
format as `'default'` and returns `value.toString()`, so those two calls produce
the strings `"128287"` and `"[127467,127479]"`. The explicit `unicode-scalars`
format does produce the documented results.

The documentation has been corrected to describe the actual behavior (a missing
format means "the argument's default string representation"), so nothing is
misleading today. What is open is which of the two the operator _should_ do:
"convert anything to its printable form" and "decode a collection of code
points" are different jobs, and `String(x)` already covers the first.

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
(Algebraic), 2 (Exponentials), 3 (Logarithms), 5 (Inverse trig), 6
(Hyperbolics), 7 (Inverse hyperbolic), 4.1 Sine, 4.3 Tangent, 4.5 Secant, and
§8.8 Polylogarithm** — 6,574 rules, 6.98 MB (CI has a bundle-freshness gate).
Scores (seed 5): **4.1 Sine 107/120 and 331/400 (4.1.11 file 93/113,
post-R18)**, **4.3 Tangent 72/120**, **4.5 Secant 69/120**, **ch3 Logarithms
70/120 (post-R25 re-baseline)**, **Chapter 5 Inverse trig: 5.1 sine 65/120, 5.2
cosine 76–78 (verify-deadline flutter band), 5.3 tangent 64 (post-R28), 5.4
cotangent 62, 5.5 secant 56, 5.6 cosecant 52 (≥375/720 ≈ 52%; R27 +19 on 5.1/5.2
via the poly×trig-product reduction closing the reciprocal-arcsin/arccos family;
earlier: R24 +15 via the complex-argument Erf/Erfi kernel, R23 +5 via the
InvTrig^n multiple-angle → CosIntegral reduction; 5.5/5.6 scores predate R25–R28
re-runs)**, **Chapter 7 Inverse hyperbolic (R22): 7.1 sine 79/120, 7.2 cosine
51, 7.3 tangent 85, 7.4 cotangent 95, 7.5 secant 44, 7.6 cosecant 54 (408/720 =
56.7%, R22 +2 — ch7's hyperbolic sub-integrals were already covered by the
ungated `containsHyperbolic` fallback)**, **ch1 1.1 Binomial products 112/120
(post-R28)**, **1.1.3 General 185/200 s200 (post-R28: unsolved 6 → 1; the
survivor #259 is an integer-power rational)**, ch1 exhaustive ≈90–91%, ch2 ≈72%
effective (seed 42), **ch6 Hyperbolics 73/120 (s120 seed 5, post-R30-reorder
2026-07-11; 0 wrongs)**, Wester indefinite-∫ 6/8. Per-rung history (R1–R30, each
rung's mechanism, score deltas and dead ends) lives in `docs/rubi/RUBI.md` §5
and git history — it is deliberately not repeated here. **Genuine wrongs are 0
across all suites** — every flagged "wrong" is a documented **verification
false-wrong** (numeric ₂F₁/AppellF1 mis-grading at non-integer symbolic-exponent
substitution; `√(sin²)=|sin|`; cube-root/fractional-power branch at negative x):
before believing a wrong flag, differentiate the antiderivative back and compare
at integer substitutions. The trig routing lives in the runtime layer
(`rubi-utils.ts`/`driver.ts`): argument-aware `deactivateTrig` (only
x-free/linear/bare-monomial args inert — composite quadratic/√-inner args stay
ACTIVE for the substitution rules), `cofunctionShift` (`sec → csc[θ+π/2]` and,
since R12, `cot → −tan[θ+π/2]`, both default-ON; the mixed-cross-pair decline
gate keeps `(g·cot)^p(a+b·sin)^m` on `unifyInertTrig`'s matched-±π/2 clauses),
`unifyInertTrig` + its cofunction product clauses, `standaloneCosineShift`,
`reciprocalToPower` (frozen under fractional powers — branch safety; since R13
it also keeps REFLECTION-produced `csc[·+π/2]` heads raw — the +π/2 shift
signature — so pure-sec binomials `(a+b·sec)^n` reach the 4.5.1 csc-binomial
rules, with a `(a+b·sec²)^p`-Power exception routing 4.5.7 to the sin/cos
rules), and five driver fallbacks (trig→exp with a numeric-evaluability
self-check; R15's rational×sin/cos(linear) → Si/Ci partial-fraction split with a
central-difference D-self-check (R18 extends it to irreducible-quadratic
denominators via `expandRationalOverComplexLinears`, splitting over
complex-conjugate linear roots → complex Si/Ci that recombine real, behind
`RUBI_NO_SICI_COMPLEX`); R16's poly×csc²/sec²(linear) by-parts; R17's
`singleAngleTrigExpFallback` — `∫P(x)·R(trig(w))` with `w` linear and an
additive `(a+b·trig)` denominator, rewritten via `y=E^{iw}` + partial-fractions
and routed through the §2.2→Ch3→§8.8 PolyLog telescope, fail-closed D-check;
native-rational). A/B env switches: `RUBI_NO_FOUNDATION`, `RUBI_NO_RECIP`,
`RUBI_NO_COFN`, `RUBI_NO_COFN_COT`, `RUBI_NO_SKELETON`, `RUBI_NO_SICI`,
`RUBI_NO_SICI_COMPLEX`, `RUBI_NO_SECBIN`, `RUBI_NO_TRIGSQ`, `RUBI_NO_TRIGEXP`,
`RUBI_NO_TRIGSUB` (R22 subproblem trig-bridge), `RUBI_NO_R25` (R25
quartic-denominator ExpandIntegrand guard), `RUBI_NO_R26` (R26B
rational-normal-form retry in the exp-substitution fallback), `RUBI_NO_R27`
(poly×trig-product reduction fallback), `RUBI_NO_R28` (R28a mixed-parity
Laurent-numerator × binomial-radical linearity split), `RUBI_NO_R29` (R29
algebraic-in-hyperbolic `u = Sinh/Cosh/Tanh[v]` substitution fallback),
`RUBI_NO_R30` (R30 rational-in-hyperbolic cyclotomic-factored `t = e^v`
substitution fallback), `RUBI_NO_R8` (R8 poly×single-angle-hyperbolic →
single-exponential `y = e^w` PolyLog fallback), `RUBI_NO_R31` (R31
nested-radical substitution fallback — Lever A iterated `u = (a+b·x)^(1/k)`
fractional-power-of-linear substitution with factored-denominator presentation,
Lever B `(√L₁+√L₂)^(−n)` conjugate rationalization; closes the Bondarenko
nested-radical family, CE+R/F 12 → 20/35; structurally inert off-family via a
tight `hasNestedRadicalCandidate` pre-filter, fail-closed on a domain-aware
D-check), `RUBI_NO_R32` (R32 Euler-substitution lever "Lever C" — an Euler I
substitution `t = √a·x + √Q` at a √(quadratic)- nested radical that rationalizes
`√Q` and collapses the outer radical to a √-of-linear the existing Lever A
removes; closes Bondarenko **#9**, CE+R/F 20 → 21/35; two-pass so R31 stays
byte-identical, inert off-family via the Euler branch of
`hasNestedRadicalCandidate`).

**Driver-determinism residual (2026-07-18):** route selection still has
wall-clock-sensitive seams (budget-relative simplify slices
`min(remaining, 5000)`, `ce._timeRemaining` guards) — under extreme synthetic
load heavy families can still flake between solved and inert. The principled
follow-up is O(nodes) pre-filters / absolute caps on speculative sub-routes,
replacing budget-relative slicing. (Two independent budgets trap:
`loadIntegrationRules(ce, { timeLimitMs })` (default 10 s) is independent of any
`withTimeLimit` span — a heavy test must raise the loader budget and arm a long
enough span.)

**Benchmark protocol.**
`npx tsx scripts/rubi/benchmark.ts --rubi "data/rubi/corpus/4 Trig functions" --chapter "4 Trig functions/4.1 Sine" --sample 120 --seed 5 --report /tmp/x.json`.
Always pass `--report` (the default path clobbers the committed baseline);
`--rubi` mode preloads the ch1/2/3/**4.1/4.3/4.5**/5/6/7/§8.8 foundation
(matching the shipped bundle so it measures the integrator as it ships —
`RUBI_NO_FOUNDATION` to disable; **pre-2026-07-04 4.1 baselines are not
comparable**); run suites **sequentially** — concurrent benchmark runs
contaminate each other's driver/verifier timing. NB: a `--rubi` target that is a
Chapter-4 SUBSECTION (e.g. `.../4 Trig functions/4.1 Sine`) resolves
`corpusRoot` to the ch4 dir, so no foundation loads and the driver-only score
(58) understates the shipped §4.1 Sine (107, `loadIntegrationRules`) — measure
ch4 sections via the shipped bundle, not `--rubi` on the subsection.

**Kernel status.** The complex-argument `ExpIntegralEi`/`SinIntegral`/
`CosIntegral`, negative-order incomplete Γ, and hyperbolic `Shi`/`Chi` kernels
are all in (mpmath-validated; see `docs/rubi/RUBI.md` §5 R18/R21 for the branch
subtleties). Remaining: hard cubic-and-higher x-denominator Si/Ci shapes still
decline cleanly (unsolved, not wrong).

**Method note (hard-won).** The "unimplemented-predicate" trace census is
_misleading_ for picking levers: the late catch-all rules
(`FunctionOfTrigOfLinearQ`, `TrigSimplifyQ`) are checked on nearly every
unsolved problem and dominate the tally without being the blocker. Diagnose
instead by tallying the _actual_ rule-fail/inner-condition reasons and tracing
the residual integrand; and use **`wolframscript`** to see Rubi's real chain
(load Rubi, then trace recursive `Int` calls, or probe `DeactivateTrig`
directly):

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

- **Ch3 unsolved tail** (43/120 at s120 seed5, post-R20; was 45 post-R19). **R19
  censused all 46** and found one bounded fix: `FunctionOfLog` (→ #261). The
  residual splits into **15 expected-`Unintegrable`** (Rubi itself returns
  unevaluated — CE's inert `Integrate` is the correct match, not a defect) and
  **~30 genuinely deep**. Next-rung shopping list from the census (see
  `docs/rubi/RUBI.md` §5 R19/R20 for the full family table):
  - **Biggest family: poly×log by-parts residuals** bottoming in `∫artanh(√)/x`,
    symbolic-order-`k` `PolyLog` recurrences, or `ArcSinh·Log` (3.1.4/3.1.5) —
    shapes the bundled ch5/ch7 base cases don't reach. A symbolic-order
    `PolyLog` recurrence remains the lever.
  - **6: `∫Log[Sin/Tan/Csc²]`** (3.5) — a two-part gap: an inert-trig `D`
    reduction (CE's `D` knows `Tan`, not the inert `tan` head the driver
    carries) PLUS a Chapter-4 trig-integration foundation for the by-parts
    sub-integral (only 4.1/4.3/4.5 bundled).
  - **4 (D): `∫Log[·]/rational`→`PolyLog[2]`**; **3 (E):
    `(a+b·Log[c(d+ex)ⁿ])^p × rational` half-integer residuals**; **4 (F):
    fractional/negative power in the log arg → `Gamma`/`Ei`/`LogIntegral`** with
    `x^(2/3)`/`e/√x` substitution. All need new production/kernels, not
    bundling.
- **R3′ — residual half-integer/elliptic chains.** #604/#609/#1395 were closed
  by R9's cosine shift, #294 by R17's exp-route telescope; what remains is the
  genuinely deep tail: #53 (23-step half-integer Fresnel chain), #248 (48
  steps), plus the composite `cot^m/(a+b·sin)^n` / `(a+b·sin²)^(p/2)`
  tan/cot-power recursions (4.1.1.3 / 4.1.7), which may fold into R5.
- **R5 — `TrigSimplify`/`TrigSimplifyQ`** (Pythagorean reductions). _Low value /
  optional:_ the predicate census over-weights it (it's a late catch-all, not a
  blocker). Only pursue if R14/R3′ leave a concrete residual class that needs it
  — one confirmed member so far: #93 (`csc^(−1/2)·sin` cancellation). A related
  deferred item from R9: a proper circular `TrigReduce` (multiple-angle
  elementary form) for `sin^n` products — the exp-form reduction works but
  verifies past the harness budget and preempts trig-form rules chapter-wide, so
  it was deliberately gated off.
- **Ch5 residual — ₚFq only.** The rung ladder closed the chapter's structural
  gaps in sequence: R22's bridge (`RUBI_NO_TRIGSUB`) closed the
  `∫f(x)·Cot[x]`-bottoming family (294 → 331), R23's `circularTrigReduce` closed
  the `∫x^m·ArcSin^n/√(1−c²x²)` (n<0) family (331 → 336), and **R27's
  `polyTrigProductReduce` closed the mixed `∫θⁿ·Sinᵐ·Cosᵏ` inner integrals of
  the reciprocal-arcsin/arccos class** (5.1 57→65, 5.2 67→78 — the former
  residual (a)). What remains: only the ₃F₂/`HypergeometricPFQ` terminal forms,
  which need a generalized ₚFq head CE lacks (out of scope). _(The
  formerly-listed "complex-Erfi evaluator" residual is stale — verified
  2026-07-10 post-R27: the fractional-`n` family's complex-`Erfi` results
  numericize via the R24 kernel, and the sole remaining `not-evaluable` row in
  each of 5.1/5.2 (s120 seed5) is a ₚFq terminal.)_ Ch7's analog is smaller and
  already covered (arsinh → hyperbolic fallback).

**Exponential** (Ch 2, 125 rules) and **hyperbolic** (Ch 6, 390 rules) are
bundled; the former R6/R7/R8 items all landed as rungs R25/R26/R29/R30 (see
`docs/rubi/RUBI.md` §5). The remaining Chapter-6 residual is mostly shared
capability rather than Ch6-specific:

- **R6′ tail:** the residual-degree-≥4 function-of-exp rows
  (`Sinh⁶/(a+b·Cosh²)`, `Csch⁴/(I+Sinh)²`, `Sinh⁴/(a+b·Sech²)²`,
  `Coth⁵/(a+b·Coth)`) whose symbolic quartic-or-higher residual needs a genuine
  root-finder — out of a contained rung's reach — plus 7 expected-`Unintegrable`
  (Rubi itself returns unevaluated there; CE's inert `Integrate` is the correct
  match).
- **R8 follow-ups:** (1) extend the shared linear-factor partial fraction
  (`expandRationalOverLinears`) to REPEATED (`Csch²`/`Coth²` → `(y−1)²(y+1)²`)
  and COMPLEX (`Tanh` → `y²+1`) denominator roots — #243/#408/#455 decline
  structurally today, and the extension also reaches the analogous R17 trig
  rows; (2) the by-parts-only tail (rows whose numerator hyperbolic is itself a
  POWER in the additive denominator, e.g. `a+b·Sinh⁴`) still wants genuine
  by-parts machinery.
- **R29 residual:** the bare `(a+b·Sinh²)^(3/2)` even-parity shape (genuinely
  EllipticE/F), the ₚFq row #518, and the `√(Sinh·Tanh)`/`√(Cosh·Coth)`
  quarter-power oddballs (6.7.1 #560/#563).

#### F. Fungrim — solving coverage

**Decoupled from Wester.** The two remaining Wester `Solve` gaps are harness
artifacts (B9), so additional Fungrim solve rules will **not** move that number
— the Wester `Solve` rows are saturated at our principled ceiling (14/21). On
the track's own benchmark (`benchmarks/audit/solve.ts` / `REPORT-solve.md`, 40
SymPy-derived univariate cases) **CE+Fungrim is at parity — 38/40 = SymPy =
Mathematica (base CE 33) — and this track is done as a coverage effort.**
Residual, none benchmark-reachable:

- **FR1/FR3** (Dottie-style transcendental fixed points): unsolved by SymPy and
  Mathematica too — outside the closed-form ceiling, not a gap to chase.

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

Not a regression — an observation left by the (closed) P-BOX investigation,
recorded in case a "make boxing 2× faster" initiative is ever wanted: in
high-resolution profiles of the box microloop, `isSubtype` accounts for ~12 % of
box time and GC for ~8 %, and both shares are unchanged since at least 0.100.1.
Type-check call volume and allocation pressure are the structural levers;
everything else in the profile is a diffuse 1–2 % tail. (The P-BOX regression
itself — R-D5 display-cache interaction and uncached resolver-aware `parseType`
— was fixed 2026-08-10; see the CHANGELOG.)

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
`constructibleValues`, `eq`, `compare`, `approxEq`, `Rationalize`, `applyAngle`
— all now gate on `.unknowns`). Nothing is numericized and thrown away here:
with every one of those gates in place, `sin(chain).N()` costs the same as
`chain.N()` alone (1 628 vs 1 757 ms at depth 12), so the whole residual is the
bare `.N()`.

**Suspected cause, not yet confirmed:** the unconditional re-box on the
symbolic-fallback path of `BoxedFunction.N()` (`boxed-function.ts`,
`this.engine.function(this._operator, tail)`), which re-canonicalizes the
subtree at every level. A related shape — exact `sin^d(x).evaluate()`,
~1.4×/level, hangs past d ≈ 50 — may share it.

**Why it is worth fixing rather than documenting.** A consumer whose
architecture deliberately keeps document variables out of the engine scope
(Tycho) has every element symbolic by construction, so this is their default
path, not an edge case. Interim guidance given to them: prefer `evaluate()` on
deeply nested symbolic expressions and reach for `.N()` only once the free
symbols are bound.

**Do not "fix" this by gating `.N()` on `.unknowns`.** Ruled out with evidence:
partial numericization (`sin(2)+x` → `x + 0.909…`, `Sqrt(4y)` → `2sqrt(y)`,
`cos(kπ)` → `cos(3.14159…·k)`) is load-bearing and pinned by ~12 test locations,
and `addN`/`mulN`/lazy-`Map` re-dispatch on the _shape_ of the `.N()` result
rather than on it being a literal. Memoization is not an alternative either:
`_value`/`_valueN` (`boxed-function.ts`) are dead fields — the memo was removed
in `0e8c11b9` to fix repeat evaluation of impure operators — and a
generation-keyed memo would be self-defeating, since evaluating a user-lambda
application bumps `_generation` twice per level.

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

So the rule is: **ask which branch `undefined` lands the caller in.** The funnel
is for sites where "no numeric value" is the give-up branch. It must NOT be
applied where the site exists to probe a symbolic expression numerically —
`zeroQ` and the `PosAux` sign heuristic (`rubi/rubi-utils.ts`),
`numericMagnitude` (`symbolic/solver-utils.ts`, hence `symbolic/recurrences.ts`
which consumes it), and the rationalize-denominator gate
(`symbolic/simplify-power.ts`) each keep a bare `.N()` and say so in a comment.
At two of those the gate is not even conservative — they accept on a non-value —
so declining would have made them more permissive, not less.

**Do not cache `unknowns` for this**: the gate is 2-50x cheaper than the `.N()`
it replaces, so a `cachedValue`-keyed `_unknowns` would add invalidation surface
for no measurable win.

#### Free-variable `eq()` follow-ups (reordered to sampling-first 2026-08-03; both levers unbuilt, tracked so they aren't re-derived)

The `eq()` free-variable branch now samples before the expand+simplify proof
(commit `aa48b48e`; a Tycho witness dropped 14.6 s → 6.2 s). Two further levers
were designed and deliberately NOT built, because the reorder alone met the
need:

- **Expand+simplify memo** — for a workload where repeated comparisons _agree_
  under sampling (so the symbolic proof still runs each time), memoize
  `_expand(x).simplify()` per engine: structural-hash key, `isSame` guard,
  invalidated on `_mutationGeneration` **plus** per-free-symbol `_writeVersion`
  dependencies (the item-126/127 element-memo discipline — plain `_generation`
  churns on ephemeral loop-index writes and would never hit inside a drain). A
  bundle-patch prototype measured 14.6 s → 6.6 s on the same witness before the
  reorder superseded it.
- **Loop-invariant broadcast operand hoisting** — each broadcast element
  evaluation re-resolves invariant scalar operands to _fresh_ nodes (verified: a
  WeakMap keyed on node identity got zero hits within a drain), so
  `stochasticEqual` recompiles the same tree per element. Hoisting invariant
  operands once per drain would restore node identity and enable a per-node
  compiled-evaluator cache. Only worth it if a witness shows sampling-compile as
  the hot path; per-comparison cost is currently a compile + ~50 point
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

- **(c) Exact asymptotics at special-function poles — one rung remains** (the
  kernel, residue-at-∞, signed pole limits, and `Beta` pole data all landed;
  `GammaLn` is a genuine non-goal — logarithmic branch point, not meromorphic).
  Demand-paced:
  - **Sum-of-residues-in-a-region helper** — needs a pole-enumeration API over
    the analytic-property store.

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

The TS 7 side-by-side install landed 2026-07-08 (`@typescript/native` drives the
build/typecheck; the module name `typescript` is aliased to the TS 6 API because
TS 7.0 ships no programmatic API and ts-jest/typedoc/ typescript-eslint/madge
all require one; bare `npx tsc` is ambiguous — use the explicit native-binary
path). The nodenext `.js`-specifier codemod landed the same day; **new-file
convention: relative imports in `src/` use `.js` specifiers.**

**Remaining:** drop the TS 6 compat alias once TS 7.1 ships its (new, different)
programmatic API **and** ts-jest/typedoc/typescript-eslint/madge support it.
Until then the side-by-side install is the intended end state, not a hack.
**Effort:** small once the ecosystem is ready.

### Correctness & symbolic findings (2026-07) — residue

The July 2026 correctness and symbolic reviews are fully dispositioned: every
verified P0 and P1 landed across the Wave 1–4 commits, and the **P2/P3 sweep
itself completed in the tail-phase rounds 8–10** (`72f3a353`, `f5e0e339`,
`a2b78928`, plus the P2-1 dispatch index `8667a0aa` and the benchmark capstone
`c20a4b2e`) and the follow-on round (`e65eee11` complex-type inference,
`99fa7276` D12-A exact Gaussians + parser perf, `c4def410` non-finite typing
convention). The campaign is summarized in
[`docs/STATUS_REPORT.md`](./docs/STATUS_REPORT.md); detailed execution records
remain in Git history. What remains from the reviews is the residual tail: the
item-4 filed residuals (Artanh/Arcoth-class literal poles, `∞+i` numeric-value
finiteness, the `~oo` lattice question, the `Multiply(x, +∞)` fold positivity
review), the non-blocking tracked residuals (fu `sin⁴−cos⁴`, defint
error-bar/tanh-sinh, machine `gamma()` mid-range digits, …), and the item-5 perf
levers — of which only bundle cold-start survives: the cache-shaped levers were
closed measured-unprofitable by the 2026-07-18 P2/P3 tail; do not re-attempt
them without a new profile.

The Stage-2 corpus audit (2026-07-10, all 57 topics) surfaced three
engine/tooling items — all fixed; the full-corpus run grades **0 False** (True
1589, seed 42).

Two design-level residues are deliberately carried forward:

- **D10 — `real ⊄ complex` in the type lattice.** `real` admits ±∞, so it is not
  a subtype of `complex`; the Fungrim loader carries a real-symbol guard shim
  and `box.ts` carries a `signatureHasComplexParam` skip to work around it. A
  lattice decision that made the finite reals a subtype of `complex` would
  retire both shims, but it interacts with the covering-union identities — a
  type-system design choice, not a bug fix. Left for demand to justify.
- **P1-19c — `Derivative(Sin).evaluate()` result typing.** The result type of an
  evaluated derivative of a known function is not yet tightened (documented in
  `library/calculus.ts`); it is blocked on evaluate-recursion and
  underscore-lambda LaTeX serialization, so it waits on those.

### Test-suite ledger — skips and `@fixme` markers (sweep 2026-07-18)

Deferred capability recorded directly in the test suite (beyond the Wester
ledger, B13). Each entry's acceptance test already exists:

- **Simplification gaps** — 13 `test.skip` in `simplify.test.ts`, with rationale
  mirrored as `test.todo` in `simplify-noskip.test.ts`: common denominator for
  rational expressions (`1/(x+1) − 1/x → −1/(x²+x)`); ln→inverse-hyperbolic
  recognition (six identities, e.g. `ln(x+√(x²+1)) → arsinh x`); inverse-trig
  conversion (`arctan(x/√(1−x²)) → arcsin x`); `factor()` extracting common
  factors from `Add` (`2π+2πe < 4π → 1+e < 2`); `(−x)^{3/4}`; `ln((x+1)/e^{2x})`
  (canonicalization expands before log rules fire); the Fu-paper Phase-14
  multi-step trig identity.
- **Parser `@fixme` clusters** (latex-syntax tests): pre-sub/superscripts
  (`_p^qx`, `\vec{AB}` over multi-letter args — `supsub.test.ts`); chained
  `\over` mis-association (`errors.test.ts`); postfix `\degree` precedence
  (`trigonometry.test.ts`); range endpoints leaking outside `Range` (`n+1..n+10`
  — `collections.test.ts`); partial-derivative fraction forms
  `\frac{\partial^2}{\partial_{x,y}} f(x,y)` (2 skips, `operators.test.ts`); Set
  round-trip failure (serializer emits `\lbrace`, parser expects `\{` —
  `arithmetic.test.ts`); malformed integrand `\int\frac{3x}{5dx}` not rejected
  (`calculus.test.ts`); lowercase-arrow `Implies`/`Equivalent` expectations
  outdated by the issue-#156 `\rightarrow`→`To` change (`logic.test.ts`).
- **Numeric known-wrongs** (nightly + unit markers): bignum `Arccos` near 1
  loses ~8 digits (endpoint cancellation; per-case skip in
  `mpmath-kernels.test.ts`); `ζ(−0.5)` ~4 ulp (tolerance-relaxed); bignum
  `Complex` components truncated at canonicalization regardless of precision
  (`canonical-form.test.ts` `@fixme`); one `Multiply` inexact case where the
  big-precision path is worse than machine evaluate (`arithmetic.test.ts`
  `@fixme`).
- **Misc:** SymPy-interop literal parses `0`/`0e0`
  (`test/math-json/sympy.test.ts`, see the interop stubs below); range/interval
  membership assumptions not wired (`assumptions.test.ts` `@fixme` setup lines);
  malformed positional-parameter name `_1_0` in a `Function` snapshot
  (`functions.test.ts`); the `grudnitski.test.ts` equivalence benchmark keeps 9
  `describe.skip` groups (equation-scaling / identity-based `isEquivalent`
  capabilities).

`test/playground.ts` remains the tracker for its own residue (notation
decisions, Iverson/Boole and inequality→`Range` wishlist, matcher internals).

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
  (declared symbols not checked against existing symbol/function/inferred uses;
  likely belongs in canonicalization).
- **Issue #189** simplification case referenced in `simplify-rules.ts`.
- **Compile targets:** GLSL `TODO(E3-GLSL)` (needs loop unrolling or fixed-size
  arrays, `base-compiler.ts`); the public per-operator `compile` handler has no
  preamble/helper-injection hook, so GLSL/WGSL custom loops aren't ergonomic —
  extend `OperatorCompileContext` if a real need appears.
- **Risch algorithm** noted as the principled endpoint for
  `symbolic/antiderivative.ts` (the Rubi track is the practical lever; kept as a
  marker, not planned).
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
- **validate.ts round (2026-07-18), flagged not fixed:** the optional/variadic
  parameter loops lack the devolve fallback and `inferredSignature` acceptance
  the required-param loop has (probably intentional; no observed hits);
  `arithmetic-power.ts` ~:345 carries an order-dependent `matches('complex')`
  with its own `fix?` comment (narrowing to literals).
- **Transformer protected-set family (LOW) — 2026-07-23 simplify/together
  review:** nested-transformer reduction (`resolveBoundSymbols`) resolves a
  bound variable that carries a global value because the protected-name set does
  not reach the transformer handler. Three sibling manifestations, all on
  doubly-contradictory input (a solve/differentiation/integration variable that
  also has a concrete value), all silent wrong/inert answers, documented with
  repros summarized by `docs/SCOPING-MODEL.md`: `Solve(Simplify(s)=2, w)` with
  `w` value-bound and appearing in `s` → `[]` (§B); `∫ Simplify(x²) dx` with
  `x:=5` → `25x` (§C); Solve shielding computed before bundled `Element` specs
  are lifted (§D, Codex-flagged, not yet reproduced). The proper fix is the
  shared rework — thread a protected-unknown set through transformer-operand
  resolution (the `EvaluateOptions` plumbing the session deliberately avoided),
  or mirror `JacobianMatrix`'s fresh-symbol rename in the
  `Integrate`/`Limit`/`Solve` reduction paths. Deferred as vanishingly rare; do
  it if the transformer-resolution architecture is reworked.
- **List-valued big-op bodies on non-JS targets — residues of the 2026-08-12 fix
  (Tycho item 171).** A body with POSITIVE collection evidence (a user function
  whose `Function`-literal body types `collection`) under an item-121 exemption
  now declines on every non-JS target with an actionable D6 message
  (`assertScalarBigOpBody`, `base-compiler.ts`; pins in
  `list-valued-summand-compile.test.ts`). Deliberately untouched: a LYING
  declaration (`-> number` head over a `List`-constructing body) keeps its
  current path on every target, including the broken GPU emission (shader source
  that does not compile, behind `success: true`) — declining it would change JS,
  a different defect; and the JS comparison-gate side effect (`a(h(i)) < y`)
  still has no dedicated pin.
- **`elementCount` adoption — residues of the `_broadcastCount` fix
  (2026-08-12).** `_broadcastCount` is gated on `broadcastable === true`, and
  the optional `elementCount` operator-definition handler (the `count` twin of
  `canEnumerate`) lets an operator that knows its own length say so without
  evaluating; `Sort`/`Ordering`/`RandomShuffle` and `Chunk` adopted it (pinned
  in `test/compute-engine/tycho-item-167-broadcast-count.test.ts`).
  - Every other reshaping/eager operator now reports an honest `undefined`
    instead of a wrong number (`GroupBy`, `BinCounts`, `Histogram`, `Tally`,
    `Unique`, `Flatten`, `Shape`, `Quartiles`, `RandomChoice`, `RandomSample`,
    `LinearRegression`, `PolynomialFit`, …), as do the count-preserving
    pass-throughs that were right by accident (`N`, `Evaluate`, `Identity`,
    `Typed`, `Matrix`, `Transpose`, …). Each is an `elementCount` handler away
    from answering again; adopt on demand, never as a name list in engine code.
  - Whether `Prime` (and other type-handler-lifting operators) should carry the
    `broadcastable` definition flag is undecided. Today is consistent
    (`Prime([1,2,3]).count` and its `evaluate().count` are both `undefined`), so
    nothing is wrong — but the flag would give such operators the broadcast
    count AND the `isEnumerableCollection` broadcast tier. Deciding needs a
    sweep of every flag consumer (canonicalization, compile gates, the facet),
    for the whole class at once, not per operator.
- **Typed `Declare` does not survive a LaTeX round trip (RULED DEMAND-GATED
  2026-08-12).** `["Declare","s","'number'"]` comes back untyped, and a leading
  `Declare` in an outer `Block` vanishes: LaTeX has no spelling for a type
  annotation, no consumer round-trips typed declarations through LaTeX today
  (Tycho emits untyped ones), and the first real consumer's usage should pick
  the notation. Re-open when one appears; until then the drop is silent — the
  accepted cost of not guessing a notation.
- **Dispatch admission residues, no witness (recorded 2026-08-12 with the
  multi-clause dispatch fix).** `accepts` (`value-membership.ts`), like
  `valueComponent`, reads `t.def` directly instead of `aliasDefinitionAt(t)`, so
  a PARAMETERIZED structural alias unfolds without substituting its type
  arguments — a divergence from `subtype.ts`, wrong-verdict-capable if a
  parameterized alias with a value component reaches dispatch. A self-negating
  alias (`type n = !n`) has no fixed point, so the alias-unfolding cycle guard's
  cut there is arbitrary-but-terminating (the parser may not even accept the
  shape). And a concrete non-numeric value (a `Tuple` against a
  nominal-reference clause) now refutes where it previously blocked —
  oracle-consistent by construction, untested in the wild.
- **Degenerate big-op round (2026-08-03), flagged not fixed:**
  - `sameSyntactic` (`boxed-expression/compare.ts`) is mis-named: despite its
    "compares symbols by NAME, ignoring bindings" doc, the symbol-vs-non-symbol
    branch of `same()` dereferences `sym.value` unconditionally — the
    `syntactic` flag is threaded through but never consulted there. Latent
    surprise for rule-matching callers (this is why the degenerate-bounds fold
    needed its own `sameBoundStructure()`). Fix = honor the flag in that branch,
    or rename and document; audit callers either way.
  - Dependent multi-index big-op bounds don't evaluate:
    `Sum(j, Limits(i,5,5), Limits(j,i,10))` canonicalizes intact (the vacuity
    fix keeps `i`'s set) but stays symbolic — `classifyBigopDomain` reads the
    symbolic lower bound `i` as non-enumerable. Enumerating would need
    per-iteration re-resolution of dependent bounds in the multi-set walk.
  - Collection-valued body of a degenerate big-op is a semantic fork:
    `Σ_{i=a}^{a} L` (L a collection, index unused) routes through the
    pre-existing arity-1 rewrite `Reduce(L, 'Add', 0)` — it sums L's elements —
    where the one-point fold would yield `L` itself (one term, that term being
    the list). Decide which reading is intended before touching it; the current
    behavior predates the fold and is deliberately preserved.

**Lessons worth keeping in mind** (the durable ones are in CLAUDE.md): the
`undefined → false` collapse in three-valued predicates was the single most
recurring bug class (A3, G3, the sets/Union/Range contains family, NaN
comparisons); validation-by-corpus (the Fungrim harness) found 15 engine bugs
that targeted review missed — keep running it.

### Load-sensitive test flakes under a full-suite run (observed 2026-08-31)

Three suites failed under a 6-worker full-suite run and pass cleanly — at bare
HEAD `3e8bd6ed` and with the error-model diff alike — when run alone on an idle
box, so the failures are contention artifacts, not code defects:
`functions.test.ts` ("ASYNC LANE KEEPS A SCOPED HANDLER'S LOCAL SCOPE ALIVE", 6
tests — concurrency-timing sensitive), `fungrim-loader.test.ts` ("loads in a
reasonable time" — a wall-clock budget pin), and `rubi-utils.test.ts` (one R18
closure). If these recur in quiet-box full runs, they stop being flakes and
deserve a real investigation; until then a full-suite report should attribute
them before blaming the change under test.
