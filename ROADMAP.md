# Compute Engine — Roadmap

**Last updated:** 2026-09-25.

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

**0.132.3 released 2026-09-20** (latest). The 0.111–0.132 line is described
release by release in `CHANGELOG.md`. The 0.97–0.110 line carried the
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

### Next items to pick up, ranked (2026-09-23)

The entries below are the ones judged worth starting next, most valuable first.
Each links to its own entry further down, which holds the detail. The ranking
weighs what a consumer sees (a wrong value first, then a slow one) against the
size of the work. The user-function cache item (decided "yes, after a soundness
check" on 2026-09-23) left the list: the check failed, and it needs a design
first (entry "Every call of a user function invalidates every generation-keyed
cache").

1. **The Tycho corpus document `s8ishknvhe`, what stays open** (the `Hsv` gate
   chain under complex mode) and the interval constant-list fan-out cap.
   Consumer-visible declines; medium size. Entries: "The Tycho corpus document
   `s8ishknvhe`: what stays open after the mixed-cell and pole round",
   "Coordinate projection through point arithmetic: what stays open".
2. **A new all-states Tycho baseline** on the next release, to measure the
   large-list and codegen work on real documents. Entry: "Code-generation census
   on CE 0.128.13: ranked candidates".

Not in this list: the design questions that need a ruling before any work (the
pre-canonicalization validation phase, the protocol conformers, the
`i`-in-subscript reading), and the entries marked deprioritized or demand-gated.

### Interval target: the census rows that remain are not implicit curves (triaged 2026-09-18; the user chose not to build the zip; the list-valued case arm landed the same day)

Point arithmetic (`_IA.bcastPoint`) and the point-coordinate accessor over a
list of points (`_IA.pointComponent`) took 30 interval-lane rows of the Tycho
census from a decline to a compile (documents `hpr2q4kles`, `mqm2eamst1`,
`lhjmsl5pbq`, `czpf52khpc`, `0vlrmhen37`), each value-checked against the
JavaScript lane. The remaining declines in the same 17 documents were traced to
their source rows, and the question asked of each was whether Tycho sends that
row to the interval lane at all. Tycho uses the interval lane for line plots
(break detection, with a JavaScript fallback) and for implicit curves (the CPU
quadtree); parametric curves, surfaces and 3-D members never use it, although
the census compiles every row on every target.

- **A `PointList` with list components (7 rows) — not built, by decision.** Five
  rows (`n7uhaaoq1q`) are `[PointList(…) for …]` comprehensions, 3-D parametric
  surfaces; one (`2ki2hjsouf`) is in a document the plan of 2026-09-15 already
  marks invalid; one (`mk7duulwxf`) is the restriction
  `1 > 0 {|2C·√min(…) − (0..C)| ≤ 1}`, which past the zip stops again at a
  relation over a `list<boolean>` (a list of verdicts is not a result of this
  target — see the entry below). The zip would give Tycho no implicit curve. If
  it is ever wanted: `_IA.bcastPoint` already consumes a list of points, so the
  missing piece is only the zip that builds one from the component lists
  (shortest length, a scalar component repeated), spelled in
  `compileIntervalCollectionValue` under the `PointList` head when a component
  is a list.
- **`List` in an operand position (11 rows).** Seven rows are `sgtdqnj2ox`,
  whose helper `H(x, y) := {B(x,y) > 0 : 0, h(⌊x⌋, ⌊y⌋)·2 − 1}` answers a scalar
  in one case arm and a LIST in the other; that now compiles (a `Which` at a
  consuming position is a selection among values, landed 2026-09-18), and the
  six interval-lane rows of the document agree with the JavaScript lane. Two
  rows (`rwhqbsp4wq`) are `P(0.1x, 6000·[0, 0.1, …, 1])`, an explicit list of
  ten line plots; the JavaScript lane compiles them, so the cost is break
  detection on those lines, not the plot. Two rows (`epq7yidtim`) are a 3-D
  `PointList` comprehension under a `distance` restriction — a surface.
- **A matrix operand of a kernel (2 rows, `jgcclk1njk`), `GeometricVector` (6),
  `At` over a tuple with a component that is not a number (3).** Not
  interval-lane members (vectors are drawing primitives; the matrix rows are
  parametric), listed so the next measurement starts from the same numbers.
- **An elementary function over a DECLARED point.** `Sin(P)` with
  `P: tuple<number, number>` declines ("the operand is a collection") while
  `Sin((a, b))` over a literal point of untyped symbols maps over the
  coordinates, as the interpreter does for both. The 2026-09-15 pin "a point is
  consumed whole, never mapped over" keeps the declared case declining; point
  arithmetic admits only `Add`, `Subtract`, `Negate`, `Multiply` and `Divide`.
  `Abs` and `Hypot` read a point whole (its norm) and must stay out of any
  widening. No census row stops here.

### Colour handling residue (audit of 2026-09-08; the five colour rulings — a tuple is 0–1 sRGB, `ColorFromColorspace` answers the route's canonical components, a well-formed spelling that packs to zero is transparent black, a list is not a colour, `ContrastingColor` answers the candidate — landed 2026-09-09)

- `doc/86-reference-colors.md` says `Color` returns a `Tuple`; it returns an
  `Oklch` head. Update the reference.
- `ContrastingColor((u, 1, 1), Rgb(1, 0, 0), Rgb(0, 0, 1))` declines on WGSL:
  `gpuCheckOperandShapes` refuses `select` over a `vec3` operand and a scalar
  one. GLSL compiles the same expression. A fail-closed decline in the shared
  shape gate, not a wrong value; pre-existing.
- A colour tuple that reaches a colour operator through a VARIABLE keeps the
  route's canonical reading (OKLCh on the compiled targets): its shape is
  unknowable at compile time. Documented in the handler comments and pinned; no
  better answer exists without a runtime tag on colour values.
- On `glsl`/`wgsl`, `Oklch(∞, 0.1, 30)` and `AsOklch` of it keep the raw
  channels `(Inf, 0.1, 30)`: the shader `Oklch`/`AsOklch` lowerings pass the
  channels through without the finiteness check the other routes apply, where an
  infinite L is an error (interpreter) or the NaN colour (javascript). Any later
  sRGB or OKLab conversion gives NaN, so no wrong colour is drawn, but the raw
  value is not the NaN colour (OPEN, route parity — found 2026-09-23). The fix
  is a check in those two lowerings; it changes many emitted-code pins.

### What the rulings of 2026-09-21 left open (OPEN — recorded 2026-09-22 when the six rulings landed)

The eight decisions of 2026-09-21 (the `Round` tie rule, the empty-list
broadcast, `Undefined` in a numeric slot, a stored value keeps its binding on
the compiled route, no by-name interception by a caller's binder,
whole-collection equality with an absent cell, no one-argument `Clamp`, the
shader statement order documented) are in `CHANGELOG.md`. Each left a residue
that no ruling covers yet.

- **Two absence parity residues.** `Xor` and `Equivalent` reject `Missing` by
  TYPE (`incompatible-type boolean/missing`) so `Undefined`, typed `unknown`,
  stays inert there; and a comparison on `Undefined` TYPES `boolean` while its
  value is `Missing` (the type handlers read a `missing`-typed operand, not the
  symbol).

### A function-typed factor is a product under juxtaposition and a type error under an explicit operator (OPEN, ruling — found 2026-09-22 while fixing the MathNet round-trip check)

In one engine, after `ce.parse('f(x)')` has declared `f` a function, `fy` parses
to the clean product `Multiply(f, y)`, while `f\times y`, `f\cdot y` and `f + y`
parse to an `incompatible-type` error (`number` expected, `function` found) on
the `f` operand. The juxtaposition reader documents a function-typed operand as
a product (`2f`, `f x`; `boxed-expression/ invisible-operator.ts` near the
`canonicalInvisibleOperator` comment) and builds the node with `ce._fn`, which
skips the signature; the explicit-operator route boxes canonically and meets
`Multiply`'s `(number*) -> number` signature. Two directions, both a typing
decision: widen `Multiply` and `Add` to accept a `function` operand (aligns with
the documented `2f` intent), or make juxtaposition strict (contradicts that
comment). No corpus row reaches it since the round-trip fix of 2026-09-22
(`f(yf(x))(x + y)` now parses as the application it is;
`test/compute-engine/juxtaposition-application.test.ts`).

### `Dot` of a tuple of points stays symbolic in the interpreter but compiles to a matrix product (OPEN — found 2026-09-22 while making `Dot` broadcast over a point list)

`Dot(((1, 2), (3, 4)), (5, 6))` stays symbolic in the interpreter, because a
tuple of tuples is read as ONE point with nested coordinates (`Norm` of it is
the flattened 4-vector, `PointX` of it is `(3, 4)`), while the compiled
JavaScript route lowers it to `_SYS.matmul([[1, 2], [3, 4]], [5, 6])` and
answers `[17, 39]`. Pre-existing; the fail-closed guard does not catch the
shape. Either the compiled route declines a tuple-of-tuples operand of `Dot`, or
the interpreter reads it as a point list; the point-list broadcast of 2026-09-22
excludes a tuple operand on all three routes and pins the exclusion
(`test/compute-engine/dot-point-list-broadcast.test.ts`).

### Interval target: a piecewise whose condition does not depend on the interval variable is hulled over both arms, even on a point interval (OPEN — Tycho ask, reported 2026-09-22 by the Tycho session `tycho-d6`)

Row 9 of the Desmos document `neyret/qm6cgwyusu`:
`0.5/√(log(1+N)) · Σ_{i=1}^{N} {cos(2πi/N · c_2(x, i) + φ(i)) if mod(log i / log 2, 1) = 0; 0 otherwise}`
with `N = 18`, `c_2(x, i) = x − T·√(9.91/i)·t`,
`φ(x) = 2π·mod(sin(10⁴x)·10⁴, 1) + c_1(x)`, `c_1(i) = v·i·t`, `v = 0.204`,
`T = 0`, `t = 989.415`. On `interval-js` (0.132.2) the kernel answers
`[−0.337, 0.840]` for `x ∈ [5, 5]` and for `x ∈ [5, 5.0000001]`, and
`[−2.21, 2.21]` for `x ∈ [0, 20]`; the scalar kernel answers one number at
`x = 5`, and the sibling row without the piecewise narrows to
`[−0.2194441520, −0.2194441519]` on `[5, 5]`. The condition
`mod(log i / log 2, 1) = 0` is over the bound sum index only, exact per term, so
the interval evaluation could decide it per `i` (or at least over a point
interval) instead of hulling `cos(…)` with `0` (`_IA.piecewise`, `interval/`).
Tycho's line sampler read every degenerate evaluation of the row as a
singularity (width > 0.5) and hatched the plot; Tycho is landing a sampler-side
demotion of such a leg to the scalar leg as a workaround
(`tests/node/plot/interval-leg-demotion.test.ts`). Repro on the Tycho side:
`npx tsx scripts/repros/2026-09-22-qm6-kernel-probe.mts neyret qm6cgwyusu`
(untracked instrument). The narrowing at the kernel is the fix at source.

### Findings of the Tycho code-generation audit of 2026-09-09 (OPEN — CE 0.127.0; report `~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/2026-09-09-report.md`, records in `ce-0.127.0.json` of that folder)

The report was reviewed on 2026-09-09 and each item was reproduced against HEAD
from source before it was listed here. The items are in the order of their
expected effect on the corpus.

- **A user function declared `-> unknown` types `broadcastable<number>` through
  every broadcastable head** (`\sin(u(t))` for `u: (unknown) -> unknown`). This
  is the cause of the audit's largest item (465 `_SYS.bcast` sites, 42
  `PointList` declines on GLSL): Tycho's importer declares each user function
  `(unknown, …) -> unknown` and refines the result only when its probe reads a
  type that `matches('number')` — `missing | number` (the default-less piecewise
  again) fails that test, so the result stays `unknown`. The typing is honest on
  CE's side; a default-less piecewise keeps its `missing | T` type by ruling
  (2026-09-09), so the remaining lever is the Tycho-side change to accept
  `missing | T` as scalar in that probe. The 2026-09-08 note "J3 is not
  reproducible at HEAD" was true only for the constructions tried; the
  `-> unknown` declaration with the body assigned in ANOTHER scope reproduces
  it.
- **Absence at the boxing seam, residue found while fixing the consumers
  (2026-09-09).** (1) A bare `missing` big-operator bound
  (`Sum(x, (x, Missing, 3))`) is still an `incompatible-type` error while a
  `NaN` bound stays symbolic; `checkBound` (`library/utils.ts`) now accepts
  `missing | numeric` only. Decide whether the early diagnostic or the §3
  normalization wins. (2) `g(3) + 0` evaluates to `Missing` while `g(3) + 1`
  evaluates to `NaN`, because the identity element is dropped at
  canonicalization and no numeric slot remains for the absence gate. Judged
  consistent with the ruling (`g(3) + 0` IS `g(3)`), recorded so the difference
  is a known one.
- **The piecewise decidedness guard is NOT redundant after the exact equality
  (checked 2026-09-09, closing a note that said the opposite):** a comparison
  operand behind the guard `(v === v) ? … : NaN` still needs it.
  `Which(Equal(NaN, 5), 1, True, 0)` evaluates to `Missing` in the interpreter,
  so the compiled piecewise must answer `NaN` when the compared value is `NaN`;
  without the guard `NaN === 5` is `false` and the else arm would answer
  instead. The exact test answers `false` on `NaN`, which is the right answer
  for the COMPARISON, not for the piecewise that contains it. Tycho's item 276
  asks for the guard to be dropped; it stays, and the test
  `compile-equality-exact.test.ts` pins the interpreter's `Missing`.
- **Not CE's:** the inline `At` lambda (Tycho's own override), the "Unknown
  operator" declines (importer binding), and the 2× re-compile of every declined
  row.

### Residue of the Tycho items 275–280 round (OPEN — found by the dual review of 2026-09-09, not fixed in the round)

- **A SCALAR compiled comparison answers a decided boolean where the interpreter
  is undecided.** `Equal(a, b)` with either operand absent from the object of
  variables compiles to `false` (and `NotEqual` to `true`), where the
  interpreter answers `Missing` for `Equal(Missing, 5)` and for
  `NotEqual(Missing, 5)` alike. The ELEMENT-WISE runtime was made three-valued
  (an absent cell is marked `NaN`, which the selection runtime and the
  element-wise connective guard both read); the scalar lowering deliberately was
  not, and the reasons were measured rather than assumed. Its answer is relied
  on to be a real boolean in four places: `BRANCH_RELATIONS` states so;
  `kleeneRelationLeaf` negates the compiled comparison with a bare `not`, which
  would turn a marker into a confident `true`; a value-position `And`/`Or` is a
  plain `&&`, which returns its first falsy operand and so cannot let a decided
  `false` absorb an undecided operand; and a chained comparison would need a
  three-valued fold that still stops at the first false pair, because the
  interpreter short-circuits a chain there (`evaluateChainOperands`). Two
  further consequences were measured: the marker arm would have to fire when
  EITHER operand may be absent (a literal on one side currently makes the pair
  decided, so `Equal(a, 3)` and `Equal(a, b)` would disagree), and the emitted
  arm splices both operands twice, which double-evaluates a pure but expensive
  operand that only impure operands are currently bound against. Closing this
  means doing all of that together, not changing the comparison alone.
- **`Re((x+ib)^2)` still builds one `{re, im}` object (noted by the complex-lane
  slice of 2026-09-09).** The statement lowering removed the closures; splitting
  a small-integer `Power` of a complex operand into its two real parts at the
  reader (`tryGetJSComplexParts`) would emit `x*x - b*b` with no object at all,
  at the cost of splicing each part twice (a cheapness gate is needed) and of
  inheriting the reader's `re = 0` convention for a non-finite imaginary factor.
  A new optimization, not a defect; the expression-position `code` keeps one
  enclosing function by contract either way.
- **Symbolic differentiation still grows super-exponentially with the order, in
  the expansion, not in `factor()`.** Witness `f(x) := √(x+√(x+√(x+√(x+x))))`.
  Step 1 of the 2026-09-22 ruling landed: `factor()` memoizes its answers per
  engine on the structural digest (`boxed-expression/factor.ts`; results
  byte-identical on a 379-line corpus), so the third derivative does 1,091
  factorizations instead of 1,166,395 and takes 5.4 s instead of 10.9 s; the
  second derivative built with `mulFactored` is now 2.1 times the `.mul()` build
  at order two (was 15 times), 468 ms against 220 ms. Step 2 was measured and
  NOT taken: the factored build is larger at order three (150,008 characters
  against 72,637) and takes 44 s, so the chain rule keeps `.mul()`. What remains
  is the growth itself: the profile names `expandProduct`/`expandProducts` (9 s
  of the 11.7 s third derivative) and `add`, because the chain rule distributes
  each level over the previous one. Levers not taken: build the derivative of a
  nested radical as a product of powers without opening it, or simplify per
  order before differentiating again; either changes the shape of `evaluate()`
  results and needs a snapshot-churn measurement.
- ** RULED 2026-09-22 (a): first fix `factor()` on nested quotients, then
  measure the snapshot blast radius of factored derivatives and decide on that
  number.`\sum_{i=0}^{3}\frac{(x-\epsilon)^i}{i!}F(\epsilon)[i+1]` with
  `F := [f, f', f'', f''']` does not parse as the application of a list
  element** — `F(\epsilon)` parses as a juxtaposition — so the corpus row of
  Tycho item 284 never reaches the compiler in the shape the record implies. The
  explicit four-term sum compiles in 65 ms and matches `.N()`; the record's
  exact spelling should be recovered and re-tested on the Tycho side.
- **`_gpu_powi` vector variants answer NaN for a zero component under a negative
  odd exponent** (`sign(x) · pow(0, n)` is `0 · ∞`), where the scalar helper
  answers `+∞`. Both sit in hardware-undefined territory (a pole); a
  per-component `select` would make the two agree. Reachable now that a negative
  run-time exponent over a `vecN` base routes to the helper.
- **The interval-js runner copies its answer on the way out.** The constant
  table now lives for the artifact's lifetime, so `freshIntervalValue` copies
  the top-level result (and, for a collection-valued root, every element) so a
  caller that writes into a returned enclosure cannot corrupt the table. One or
  two small allocations per call; for a collection-valued root the copy is
  linear in its length. The alternative is to document the returned enclosure as
  read-only and drop the copy. Today no in-repo consumer writes to a returned
  enclosure. The copy stays until ruled otherwise.

### JavaScript target: adding two point lists of different lengths throws a `TypeError` (OPEN — found 2026-09-23 while fixing Tycho item 307)

With `L_1 = [1, 2, 3]`, `L_2 = [4, 5]` and `A = [0.1, 0.2, 0.3]`,
`Min(PointX(Add(PointList(L_1, L_2), Multiply(1/20, PointList(Cos(A), Sin(A))))))`
compiles on `javascript`, but the compiled function throws
`TypeError: _SYS.bcast(...).map is not a function`. The first `PointList` has
two points and the second has three. The interpreter answers
`Error("incompatible-dimensions", "3 vs 2")` and `interval-js` answers the
absence marker. The probable cause: `_SYS.bcast` returns `NaN` on a length
mismatch, and the generated code then calls `.map` on it. The compiled code must
answer the same absence the interpreter's error projects to, not throw.

### JavaScript target: calls that now decline instead of compiling (OPEN, compile gap — found 2026-09-23)

With `k := i` and `p: (unknown) -> unknown`, `p(P) := P.x + k`: `p((x, 1)) + 1`,
`\sum_{k} (k + p((x, 1)))` and a `Block` local `k` beside `p((x, 1))` decline
with "Add: … list-valued operand", because the call keeps the
`broadcastable<number>` type of the generic body. Before 2026-09-23 they
compiled to a wrong value (string concatenation), so the decline is correct, but
the call could compile: the emitted definition is the point-specialized one,
whose result is a complex scalar. Also, `\sum_{k=1}^{3} p((x, \sqrt{x-5}))`
declines in `auto` mode (inlining refuses because the body's `k` would be
captured by the index); strict mode compiles it.

### Residues of the 2026-09-24 fix round (OPEN, small — found by the review of the fixes)

Found by the review of the fixes of 2026-09-24, not fixed in that round (the
bigint root extraction, the `e^{1 + 0.5iπ}` dust and the mutually recursive
diagnostic landed 2026-09-25): (1) `e^{0.25iπ}` is the exact `√2/2 + √2/2·i` in
degree mode and a float in radian and turn mode: `radiansToAngle` gives the big
decimal `45.000…`, which the degree-mode recognizer accepts as the special angle
45°, while a float is never special in radians. (2) The dust limit is capped at
`|x| ≥ 1`, so `sin(10^6π).N()` is `−3.8e-19` while `evaluate()` is `0`, and
`tan(10^6π + π/2).N()` is `2.6e18` while `evaluate()` is `~oo` (the cap exists
so that `sin(10^22)` is not chopped; the two routes disagree for multiples of π
above `10^2`). Note that since 2026-09-25 a LITERAL `10^6π` argument is reduced
exactly (`\sin(10^{6}\pi).N()` is `0`); the cap still applies to a float
argument near a multiple of π. (3) A float near a special angle gives the sine
of the DECIMAL literal on the scalar route (`Sin(3.141592653589793)` is
`2.38e-16`, 21 digits) and the sine of the DOUBLE inside a machine list
(`1.22e-16`, `Math.sin`), a factor of 2 at a zero crossing; both are exact
readings of their literal.

### Residues of the exact-boxing rule (OPEN, decisions — found 2026-09-24)

(1) Small integer-valued big decimals are still exact on two routes that predate
the rule: `ce.parse('1.0')` is the exact `One` (the shared `isOne`/ `isZero`
constants in `createNumberExpression`) while `ce.parse('2.0')` is a float, and
`ce.number(ce.bignum('1500'))` is exact (`canonicalNumber` turns a big decimal
at most `10^6` into an exact number) while `ce.parse('1500.0')` is a float.
Decide whether no big decimal is ever exact (then `Sqrt(4).N()` at bignum
precision becomes inexact; blast radius unmeasured) or accept the difference.
(2) A float past the safe integers becomes exact after a LaTeX round trip:
`ce.box(1e16)` serializes to `10\,000\,000\,000\,000\,000`, which parses back as
an exact integer; a fix needs a LaTeX mark for an inexact integer-valued number.
(3) The `SingularValues` double kernel returns `0` for a singular value below
about `ε·σ_max` even when the entries are within the double range:
`SingularValues([[1e20, 0.5], [0.5, 2.5]]).evaluate()` gives `[1e+20, 0]` (the
1×1/2×2 closed form under `.N()` on exact decimal entries is fixed; the general
kernel is not). Pre-existing, wrong value.

### Residues of the fixes for Tycho asks 306–315 (OPEN — found 2026-09-24)

Found while fixing 312 (not fixed, small; the `Multiply(Undefined, [1,2,3])`
type, the matrix `Norm` with an absent cell, and the matrix of restricted points
landed 2026-09-25): `Trace(Missing)` is still an `incompatible-type` error while
`Norm(Missing)` is `NaN` (both were set by precedent, not by a user decision);
and the scalar `Multiply(Missing, 1)` and `Add(Missing, 0)` fold to `Missing` at
canonicalization while `2·Missing` is `NaN`.

Not fixed, accepted rule: on `javascript`, a list held by a free point
coordinate becomes `NaN` (`_SYS.pointSlot`), so `[1,2]·PointList(t,t)` run with
`t = [1,2]` gives `[[NaN,NaN],[NaN,NaN]]` where the interpreter answers
`[(1,1),(4,4)]`. Refusing the compile whenever a coordinate type is `unknown`
would also refuse ordinary plot expressions. On `interval-js`,
`2·PointList(t,1)` with `t = [1,2]` gives the point `([2,4], 2)`; plot variables
on that target are numbers.

Found while fixing 313 (not fixed; each gives a visible error, not a wrong
value): `x4[1,2]` (the left side is already the product `x·4`), `2^3[1,2]` and
`\sin 4[1,2]` (read as an index, `At(…)`, then a type error), and `4[x=0]` (an
Iverson bracket, so no product reading). `4]1,2[` canonicalizes to
`Tuple(4, Interval(…))`, which is probably not what an author means.

### The `.add()` and `.mul()` methods keep an absent operand as a symbol (OPEN, small — found 2026-09-25)

`ce.box('Missing').add(ce.box(1))` gives `"Missing" + 1` and `.mul()` gives
`2·Missing` (for `Undefined` too), while the operators `Add(Missing, 1)` and
`Multiply(2, Missing)` evaluate to `NaN`. The methods are the internal
arithmetic route (`arithmetic-add.ts`, `arithmetic-mul-div.ts`); a caller that
folds an absent operand through them, rather than through the operator's
evaluate handler, keeps the symbol in its result. Make the methods read an
absent operand as `NaN`, as the tuple routes do since 2026-09-25.

### `Map` with a bare symbol callback copies the source element type (OPEN, decision — found 2026-09-25 while fixing Tycho item 325)

`Map(\sin, [-1, 2])` is typed `vector<integer^2>`, and `Map(W, G)` with
`W = x \mapsto \sin x` and `G = [-1, 0, 1]` is typed `vector<integer^3>`,
while the values are reals. A bare symbol as the callback is deliberately left
unresolved on the parse route, so its type reads `unknown`, and the `Map` type
handler then copies the source type, element type included. Typing the result
as the same kind and dimensions with `unknown` elements (`list<unknown^3>`)
was tried and reverted: it breaks four pins that expect the copied type
(`pipe-type-read-purity.test.ts`, the placeholder inside a nested `Map` stage;
`map-over-tuple-result.test.ts`, "a list source is unchanged"; two in
`compile-map-reduction-fusion.test.ts`, which then emitted `.map(` instead of
the fused form). The decision is which the pins should lock in: the copied
element type (wrong for a non-identity callback) or an `unknown` element type
(which loses the fusion). Test file for the values:
`tycho-325-integrate-list-limit-broadcast.test.ts`.

### A lazy comprehension is rejected at a `list<real>` parameter that the compiled route accepts (OPEN, decision — found 2026-09-25 while fixing Tycho item 323)

With `u` declared `(list<real>) -> unknown` and assigned an up-sampling
comprehension over `l`, and `s` declared the same way, `s(u(L))` with
`L: list<real>` evaluates to `Error(incompatible-type, "list<real>",
"indexed_collection<integer | nan>")`: `u(L)` is a lazy `Comprehension` whose
element type carries the `nan` arm of an element read `l[i]`, and the
`list<real>` parameter of `s` rejects it. The compiled JavaScript code for the
same expression returns values, so the two routes disagree. Option A keeps the
rejection (the `nan` arm is in the type, so it is correct) and the mismatch.
Option B accepts a comprehension at a `list<…>` parameter when its element type
without `nan` fits, which makes the interpreter agree with the compiled code and
weakens the `list<real>` contract. Until decided, Tycho's `(list<real>)`
declarations error in the interpreter and work compiled. Test file with the
compiled reference values: `tycho-323-call-site-specialization.test.ts`.

### A list-valued integrand is not distributed over the integral (OPEN, decision — found 2026-09-25 by the review of the Tycho item 325 fix)

`Integrate` with a list BOUND evaluates per element since 2026-09-25, on one
limit or several. A list-valued INTEGRAND does not: the LaTeX
`\int_0^1\int_0^{G} xy\,dx\,dy` with `G = [1,2,3]` parses to an outer
single-limit `Integrate` whose integrand is an inner `Integrate` with the list
bound, so the outer integral is typed `number` and stays unevaluated under both
`evaluate()` and `.N()`. The symbolic route shows the same gap from the other
side: `Integrate(xy, Limits(x, 0, [1,2]), Limits(y, 0, [1,2,3]))` evaluates
the `y` limit over its list and leaves `\int_0^{[1,2]} [x/2, 2x, 9x/2]\,dx`,
an outer integral over a list-valued integrand, while `.N()` refuses the
mismatched lengths and stays whole. The decision is whether a list-valued
integrand distributes (one integral per element, matching the bound rule) or
stays unevaluated with a documented message on both routes. Test file for the
bound rule: `tycho-325-integrate-list-limit-broadcast.test.ts`.

### An out-of-range component read answers `Missing` when the tuple holds an absent cell, `NaN` otherwise (OPEN, small — found 2026-09-25)

`Third((1, 2))` is `NaN` (typed `nan`: index 3 of a 2-tuple is out of range),
`Third((1, Undefined))` is `NaN`, but `Third((1, Missing))` is `Missing`: the
marker of an out-of-range read (`componentAt`, `library/collections.ts`) depends
on which symbol spells the absence of an UNRELATED cell. The static type
`missing | nan` admits both; the value should not depend on the spelling.
Related, unconfirmed: compiled `PointY([(1, Missing), (2, 3)])` gives `[NaN, 3]`
where the interpreter gives `[Missing, 3]`; `?? NaN` is the compiled spelling of
an absent number, so this is probably intended, but the 0.135.0 notes say an
absent point cell compiles to `undefined`; confirm which.

### `Sort` of a list with an absent cell stays unevaluated (OPEN, decision — found 2026-09-25)

`Sort([1, Missing])` and `Sort([1, Undefined])` stay as the unevaluated
`Sort(…)` (the two twins agree since the `Undefined` cell is typed `missing`,
2026-09-25). Where an absent cell goes in the order (first, last, or the list is
`NaN`-like and the sort declines with an error) is a decision; `Max`/`Min`/`Sum`
of the same list answer `NaN`. Related, recorded as a decision in
`absFunctionType` (`library/type-handlers.ts`): `Abs(x)` with `x: number` is
typed `real<0..> | signed_infinity` with no `nan` arm although `Abs(NaN)` is
`NaN`.

### A numeric result of a restricted list masks to `Missing` on the held route and to `NaN` on the fresh route (OPEN, needs a decision — found 2026-09-25)

`Length([1,2]\{0<t\})` evaluates, with `t` free, to `2\{0<t\}` (the operator
threads the restriction whole), and `Sum([1,2]\{0<t\})` to `3\{0<t\}`; once
`t = -1`, that held value masks to `Missing` (the `When` rule of 2026-09-09),
while the same expression evaluated fresh answers `NaN`, the marker of a number
(`Length(Missing)`, `Sum(Missing)`). The two rulings collide on every numeric
operator threaded over a scalar restriction (`2·x\{c\}` is `2x\{c\}`, `Missing`
when `c` fails; `2·Missing` is `NaN`), so the disagreement is scalar-wide, not
specific to lists. To decide: whether a restriction over a NUMBER should mask to
`NaN` (then `x\{c\}` alone answers `NaN`, which plot consumers already read from
compiled code) or the fresh route should answer `Missing` for a numeric operator
over an absent operand (which reverses the 2026-07-24 absence ruling,
`Sin(Missing)` is `NaN`).

### Residues of the tuple-of-lists change (OPEN, small — 2026-09-25)

(1) The static type of arithmetic over a code-built tuple with a list coordinate
(`Add(Tuple(1,1), Tuple(A,B))`) is still `tuple<list<real>, list<real>>` though
it always evaluates to an error. Typing it `error` makes the canonicalization of
an enclosing arithmetic expression wrap the operand in
`Error(incompatible-type, "number", "error")`, so `(1−t)P − tP` with a data
tuple `P` gives a sum of errors after `.N()`; `checkNumericArgs` must first stop
wrapping error-typed operands. (2) Compiled `(A\{0<t\}, B) + (1, 1)` declines
("scalar arithmetic over a list-valued operand") where the interpreter answers;
a reachable decline. (3) `Length(Missing)` is
`Error(incompatible-type, collection, missing)` while its type says `integer`.
(4) For a parameter with no declared type, the compiled route does not handle a
restricted list of points (`untypedPointListElement` does not remove `missing`).
On the interpreter, an untyped `k := P ↦ 2P` applied to `[Missing, (3,4)]`
answers `[NaN, (6, 8)]` typed `list<number>` (found 2026-09-25): the absent cell
is not `Missing` and the type does not describe the value. (5) A point list at
an untyped parameter beside another collection argument still declines to
compile to JavaScript (the interpreter pairs the lists). (6) Block-local
functions and variadic parameters do not map over a list of points.

### Extended-real declarations lose precision through inference (OPEN, type precision — reported by Tycho 2026-09-24, measured on CE main)

A host now declares plot variables and list seams as
`real | signed_infinity | nan` instead of `number` (Tycho, 2026-09-24). Three
places widen that union back: (1) a function declared
`(real | signed_infinity | nan) -> unknown` whose body is closed on the extended
reals (`t + 1`, `t²`, `sin t`) refines its result to `number`, and `Sum(L)`,
`Max(L)` over `list<real | signed_infinity | nan>` type `number`; (2) arithmetic
widens `signed_infinity` to `infinity`, which admits the complex infinity:
`C + 1` over such a list typed `list<infinity | infinity | nan | real>` (the
duplicate `infinity`, a union built from the two signed infinities that
`stripNumericRanges` widened without removing duplicates, is fixed since
2026-09-25; the union prints `list<infinity | nan | real>`); (3) a literal list
with an infinite or NaN member types `vector<2>` (element type `number`):
`[1, ∞]` and `[1.5, NaN]` do not match `list<(real | signed_infinity | nan)^2>`,
although the join of the members' types is `real | signed_infinity` (the
ASSIGNMENT of `[1, ∞]` to a symbol declared with the union does succeed on main;
Tycho measured a failure on 0.133.0). Each is a lost precision, not a wrong
value; a host that reads the type of a result to choose a shader type or a lane
sees `number` where `real | signed_infinity | nan` is true. Probe: Tycho's
`scripts/repros/2026-09-24-declared-type-precision-probe.mts`.

### Ordering of constants with special functions: what stays open after the 2026-09-25 bounds (OPEN, low)

`approximate()` (`compare.ts`) propagates an error bound through `Gamma`, `Erf`,
`Erfc`, `Erfi`, `Zeta`, `Arcosh` and `Artanh` since 2026-09-25, and at machine
precision a fast path orders `f(literal)` from the machine values when the two
are farther apart than `10⁻⁶` relative. Not covered: the `Bessel` family (a
clean derivative bound exists only for an integer order, and the kernels'
accuracy is unmeasured), `LambertW`, the polygamma functions, and any tree whose
leaves are not literals on the machine fast path (`Max(1 + Γ(1/3), 3)` at
machine precision stays unevaluated; above machine precision the rigorous bound
decides it). The intervals for Γ, ζ, arcosh and artanh are computed with
doubles, so an argument within about `10⁻¹⁵` relative of a pole is refused at
every precision (`Γ(−3 + 10⁻³⁰)` against `0` stays undecided at 50 digits):
never a wrong order, a lost answer.

### JavaScript entry check: an O(n) walk per call per collection input (OPEN, decision — 2026-09-24, re-measured 2026-09-24)

The run-time entry check that makes a `{re, im}` entry under a real-lane
collection input throw walks every entry on every call. Re-measured with
alternated runs (median of 12): a 100×100 determinant 431 µs with the check, 435
µs without; a 10×10 determinant 0.71 / 0.65 µs; a 10,000-element `Dot` 9.3 / 6.6
µs; a 3-element `Dot` 0.04 / 0.03 µs. (An earlier reading of 6 → 21 µs for the
`Dot` was a warm-up artefact.) The cost is visible only on a long O(n) kernel,
about 3 µs per 10,000 entries. Options: (a) keep the walk (sound); (b) a
`WeakSet` of arrays already checked (misses a complex value a host writes into
an array it reuses); (c) the cache only for frozen arrays. Recommendation: (a).
`entryChecks: false` turns the check off.

### The imaginary part of an inexact number is a machine double (OPEN, scheduled — 2026-09-24)

`BigNumericValue.im` is a `number`, so `.N()` of a complex value has the working
precision (21 digits by default) on the real part and 16 digits on the imaginary
part: `.N()` of `√2 + √2 i` is
`1.414213562373095048801689 + 1.4142135623730951i`. A big-decimal imaginary part
is scheduled (user decision 2026-09-24), not done. Also,
`BigNumericValue.toString()` does not round the real part of a complex value to
the working precision (the real-only branch does), so that part prints 25
digits. Related: `numericCostFunction` (`cost-function.ts`) prices the imaginary
radical of a complex literal but not its real radical. Also found 2026-09-25:
`.N()` of `Multiply(Complex(√2/2, √2/2), e^2)` prints the real part with about
46 digits (`5.224851674121679747327997452771991010463873012`) and the imaginary
part at machine precision; the digits are correct, the precision mix is the same
defect on the `Multiply` route.

### `∜(−1)` stays a `Root` head while `√i`, its equal, is an exact Gaussian radical (OPEN, small — found 2026-09-25)

Since 2026-09-25 (user ruling) `√i` evaluates to `(√2/2)(1 + i)` and `√(−i)` to
`(√2/2)(1 − i)`, like every other exact Gaussian square root. `\sqrt[4]{-1}`,
the same value, goes through the `Root` route, which has no exact case for a
root of a negative number with an even index above 2, and stays `root(4)(-1)`
(its `.N()` is correct). Also consistent but limited: a Gaussian value raised to
a rational power other than `1/2` never reduces (`i^{3/2}`, `(3 + 4i)^{3/2}` =
`2 + 11i` stays symbolic); an exact `p/2` power of a Gaussian integer would be a
feature, not a defect.

### Complex eigenvalues, eigenvectors and decompositions of size 3 or more have no numeric route (OPEN, capability — found 2026-09-24 by the review of `168de97d`)

`Eigenvalues([[1, i, 0], [i, 2, 0], [0, 0, 3]])`, `Eigenvectors` of it,
`CholeskyDecomposition([[2, 1+i], [1-i, 3]])`, and `LUDecomposition`,
`QRDecomposition` and `SVD` of a complex matrix stay unevaluated under
`evaluate()` AND under `.N()` (before `168de97d` they answered wrong real
values). `SingularValues(...).N()` of a complex matrix of any size is computed
since 2026-09-24 (`singularValues(re, im)` in `numerics/linear-algebra.ts`, the
Jacobi run on the Hermitian embedding `[[P, −Q], [Q, P]]`). The same embedding
gives the eigenvalues of a HERMITIAN matrix (run Jacobi on the embedding itself,
take each eigenvalue once; an eigenvector `[x; y]` gives `x + iy`); a general
complex matrix needs a complex QR iteration.

### Compiled colour values: keep the colour space; non-rounding conversions in `@arnog/colors` (OPEN, design — found 2026-09-23 by the review of `168de97d`)

The compiled constructors store every colour in OKLCh (`_SYS.rgb(0.2, 0.5, 0.7)`
is `{space: 'oklch', …}`), so each `AsRgb`/`AsHsv` of a constructed sRGB colour
makes an OKLCh round trip (compiled `AsRgb(Rgb(0.2, 0.5, 0.7))` gives
`0.20000000000000512`), which the snapping tolerances in
`numerics/color-conversion.ts` then correct. Fix at the cause: the compiled
constructors keep their own space, as the interpreter keeps the `Rgb` head.
Also, `numerics/color-conversion.ts` copies conversions of `@arnog/colors`
because that package rounds to integers and does not clamp HSL
(`hslToRgb(30, 1, 2)` is `{r: 255, g: 510, b: 765}`); fix it there and delete
the copies. Two symptoms of the OKLCh storage, found 2026-09-24 by the review of
`168de97d`: a same-space conversion of an ACHROMATIC colour disagrees between
the interpreter and the `javascript` target (`AsHsv(Hsv(120, 1, 0))` is
`Hsv(120, 1, 0)` on the interpreter and `[0, 0, 0]` compiled, because OKLCh has
no hue at zero chroma; 112 of 200 random achromatic inputs differ), and the
interpreter's `AsHsv`/`AsHsl` snap a saturation below `1e-9` to 0 and a hue
within `1e-9` of 0 to 0 (`ACHROMATIC_TOLERANCE`, `HUE_TOLERANCE` in
`numerics/color-conversion.ts`) only to match the compiled round trip
(`AsHsv(Rgb(0.5, 0.5, 0.5000000001))` was exact, it is now `Hsv(0, 0, …)`). The
shader helpers (`gpu-target.ts`, `_gpu_srgb_to_oklab` and neighbours) are a
third copy of the conversion math with their own f32 coefficients and an
achromatic threshold of `1e-6`. A third symptom: compiled
`ColorToString(Rgb(1, 0.5, 0))` is `#ff7f00`, the interpreter's is `#ff8000`,
because the OKLCh round trip gives a green channel of `0.49999999999999795`,
which rounds down.

### The lane question of a user call emits code and can throw (OPEN, design — found 2026-09-24 by the review of the return-lane record)

A user-function call reads the lane its emitted definition recorded
(`userCallLane`, `recordUserFunctionLane` in `compilation/base-compiler.ts`). A
parent lowering asks for the lane of an operand before it compiles the operand,
so the question emits the definition on demand, which needs a global
`_callSiteTarget`, a per-call route memo, and pruning of definitions the
question emitted but nothing uses; `isComplexValued` can therefore write
definitions and throw user-facing diagnostics. Cleaner: in `compileExpr`, before
a lowering reads the lanes of its operands, emit the definitions of the
user-function calls among its direct operands with the current target and
frames; then `userCallLane` only reads the record, and the global, the route
memo, the ask-time pruning and the throws inside the predicate go away.

### A point argument with a complex-valued coordinate declines where the interpreter answers a real number (OPEN — found 2026-09-15 in the Tycho corpus document `neyret/hpr2q4kles`)

`P_0(M_0, D, d, e_0, a, T_0, r_0) = l(d_{iv}(r(M_0, -a) - C(D, d), A(e_0))) - (D + d) / 2`
with `A(e_0) = (1, \sqrt{1 - e_0^2})` and `l(V) = \sqrt{V.x^2 + V.y^2}`. Under
the default `auto` discipline the square root of `1 - e_0^2` (an unknown-sign
parameter expression) promotes to the complex kernel, so the inlined `d_{iv}`
hands `l` a point whose second coordinate is a `{re, im}` object. The emitted
`_fn_l` reads a point parameter's coordinates as plain numbers, so the call used
to answer `NaN` behind `success: true`; it now fails closed at that call
(`compile-point-complex-coordinate.test.ts`). The interpreter answers 1.024 for
the document's eccentricities (all below 1).

The correct lowering needs the inline substitution to read through the
return-type ascription an inlined helper leaves around its point
(`Typed(PointList(…), '…')`) AND the enclosing arithmetic's lane analysis to see
the inlined body instead of the call node — removing the wrapper alone was
measured to concatenate a string (`"-0.39[object Object]"`), because the
enclosing `Add` had analyzed the call as real. The lane analysis of a call whose
written-out point argument carries a complex coordinate is already answered from
the substituted body (`isComplexValuedUserCall`); extending that reading to the
ascription-wrapped case, and making the substitution accept it, is the remaining
work.

Measured again 2026-09-15 in a CE-only replica of the document (every helper
declared with the signature the Tycho manager derives, then assigned its lambda;
`x` and `y` declared `number`; the field macro `U` written out as `(x, y)`): the
row `P((x, y), 0.47, …) = 0` declines at this same `Add` under BOTH
point-parameter declarations — the three-arm union with the
`indexed_collection<number | tuple<…>>` arm and the two-arm
`tuple<…> | list<tuple<…>>`. Every helper compiles when its point argument is
written out at the call (`r((x, y), 1)`, `l(r((x, y), 1) - (x, y))`,
`d_iv(r((x, y), 1) - C(1, 2), A(0.5))`); only `P_0((x, y), …)` and
`P_1((x, y), …)` decline, inside their bodies. So the earlier statement to Tycho
that the two-arm parameter declaration makes these rows compile was a prediction
from the decline reason, not a measurement, and it was wrong: the parameter
union is not what blocks this document. The arithmetic type of a
point-or-point-list operand (`P / 2` typed a nested list of the union) was a
separate defect and is fixed (`point-union-arithmetic-type.test.ts`); the
replica still declines after that fix.

### A tuple-or-number-list union nests through the broadcast type wrapper (OPEN — found 2026-09-15)

A symbol declared `tuple<number, number> | list<number>` and left valueless
types `2V` as `list<list<number> | tuple<…>> | list<number> | tuple<…>`, a
nested union no value has: the broadcast type wrapper re-wraps the handler's
union answer around the operand's list arm. The same defect for a
POINT-or-point-list union (`tuple<…> | list<tuple<…>>`) is fixed
(`point-union-arithmetic-type.test.ts`), by returning the handler's answer when
every collection arm on both sides holds points. That scoping is deliberate: a
union with a list of numbers beside a tuple cannot be told apart, at the
wrapper, from a declared per-element result that merely mentions a number list
(`tuple<…> | list<number>` as the cell of a lifted operator), which must be
wrapped. Fixing this case needs the wrapper to know that the handler already
computed the lift (an explicit exemption label on `Divide`, which does not carry
`collection-result` today, or a per-handler signal). No document in the audited
corpus declares such a union.

### A product of two point-or-point-list operands claims a number (OPEN — found 2026-09-15)

With `P` and `Q` declared `tuple<number, number> | list<tuple<number, number>>`
and left valueless, `P \cdot Q` types `list<number> | number`, while the same
product of two plain `tuple<number, number>` symbols types `error` (a point has
no product with a point). The `Multiply` type handler's point branches skip the
case (two could-be-tuple operands and no separate scalar or collection factor),
so the scalar tiers below claim a number for a value the evaluator refuses. The
honest claim is the same `error` the tuple pair receives, or `never`. Low blast
radius: no document in the audited corpus multiplies two point-shaped operands.

### Coordinate projection through point arithmetic: what stays open (OPEN, compile performance — found 2026-09-19 while implementing item 1 of `docs/plans/2026-09-19-codegen-reassessment-ce1313.md`)

The pre-pass (`foldPointAccessor` in `compilation/fixed-width-unroll.ts`) now
rewrites `PointX(p + k·[points])` to `PointX(p) + k·[first coordinates]` when
the list of points is written out and has five or more elements. Two shapes are
left as they were.

**1. The interval target writes a constant list of numbers out element by
element, with no upper width.** The element-wise rule of the pre-pass
(`distributeOverList`) has a lower width limit and no upper one, and the
interval target turns it on for constant lists
(`UnrollOptions.unrollConstantLists`). Measured on the unchanged tree:
`Sin(x + 4·[2,000 numbers])` compiles on `interval-js` to a 60,876-character
body, where the same arithmetic over a list of 2,000 POINTS compiles to a
307-character body that reads a table bound once per artifact
(`_IA.bcastPoint`). For that reason the new projection rule is withheld on that
target when any list of points in the arithmetic has a number literal at the
coordinate being read in every point (`isPointArithmeticOverWideList`); without
the exception the 7,225-point witness grew from a 413-character interval body to
a 202,510-character one.

An experiment gave the fan-out of a constant list an upper limit of 100 elements
(the value of `INTERVAL_UNROLL_LIMIT`). At 150 elements, the interval bodies of
`Sin(x + 4·L)`, `Max(x + 4·L)`, `Sum((M − x·L)²)`, a run-time index into
`x + 4·L`, and `x·L + M` went from 3,075–8,671 characters to 113–338, with
identical enclosures. One shape regressed: `Reduce((M − x·L)², Add)` declined,
because the `Reduce` lowering of that target only accepts the written-out list
the fan-out produces. The limit was not landed: it changes which interval rows
compile, and the plan asks for a new whole-corpus baseline before another broad
lowering change. To land it: give the interval `Reduce` lowering a run-time list
operand (or keep the fan-out under `Reduce`), apply the limit, and then remove
the constant-list exception from `isPointArithmeticOverWideList`.

**2. A list of points that is a symbol, not a written-out list.**
`PointX(4·P + 0.3·(t, t))` with `P` declared `list<tuple<number, number>>` still
builds every transformed point and maps over them twice (records 687 and 688 of
the targeted audit, `woeywky0kj` setup rows). The rewrite needs a fourth leaf in
`coordinateAndArity`: an operand whose TYPE is a list of points, to which the
accessor is re-applied (`4·PointX(P) + 0.3·t`). The open questions are the width
floor — the rule cannot see the width of `P`, and a narrow list is a native
vector on the shader targets — and a `P` whose type is the union of a point and
a list of points, where `PointX(P)` dispatches at run time.

### The Tycho corpus document `s8ishknvhe`: what stays open after the mixed-cell and pole round (OPEN — found 2026-09-19; item 3 of `docs/plans/2026-09-19-codegen-reassessment-ce1313.md`)

The round (in `CHANGELOG.md`) made a broadcast head read a list that mixes
complex and real cells, and made the compiled complex arithmetic of the
JavaScript target answer a pole as the interpreter does. The stereographic
projection of the document (audit record 146 of
`/private/tmp/ce-codegen-reassessment-0919/ce-0.131.3-targeted.json`) now
compiles when its point list `C_c` is declared
`list<tuple<number, number, number>>`. Three things stay open.

1. **With `C_c` undeclared, the body still declines.** Its type is then
   `broadcastable<tuple<broadcastable<number>, …>>`, a value that may be a
   scalar or a collection at run time, and the lane analysis of the broadcast
   closure refuses such an operand when it has complex evidence
   (`_operandElementLane` in `compilation/base-compiler.ts`, the
   `isBoundPossiblyCollectionTyped` case, pinned in
   `test/compute-engine/broadcastable-compile.test.ts`). The reason given there
   is that a scalar binding of a complex-typed parameter is refused at the entry
   of the compiled function, so compiling the array case would trade a decline
   for a run-time error. Whether Tycho declares `C_c` with the narrow type is a
   Tycho question; on the CE side the refusal could be revisited now that a
   mixed cell is read through `_SYS.cplx`.
2. **The second decline of the document is a chain of gates under
   `mode: 'complex'`, of which three are understood.** The row is the colour of
   the point cloud, `AsOklab(c_f)` with
   `c_f = Hsv((180/π)·PointX(A_rg(C_cf)), Min(1, 2 − 2·PointZ(C_cf)), Min(1, 2·PointZ(C_cf)))`
   and `A_rg(p) := (Arg(p.x + i·p.y), Arccos(2·p.z − 1))`. It compiles under
   `mode: 'strict'` and `'auto'` and declines under `'complex'`, the mode Tycho
   compiles it in. Repro without Tycho: assign `A_rg` as above, declare
   `C: list<tuple<number, number, number>>`, and compile
   `Hsv(57.29·PointX(A_rg(C)), 1, 0.5)` with `mode: 'complex'`. The gates, in
   the order the row meets them (measured 2026-09-20 on Tycho's route, each with
   a trial fix that let the row reach the next one):
   - **A coordinate read inherits the verdict of the whole point.** Under
     complex mode `Arccos` of a value of unknown range is complex-valued, so the
     pair `A_rg(p)` is, and `isComplexValued(PointX(A_rg(C)))` answers `true`
     although `PointX` reads `Arg(…)`, which is real. The hue then has complex
     evidence and a possibly-collection type, `operandElementLane` answers
     "undecided", and `Hsv` declines. Trial fix: an arm in
     `_isComplexValuedFunction` (`compilation/base-compiler.ts`) beside the one
     for `At`: a point accessor over ONE point whose coordinates can be seen (a
     `Tuple`, or a call of a user function whose body is a `Tuple` or a
     `PointList`) answers from that coordinate. Tycho's converted `A_rg` builds
     its point with `PointList`, whose operands are not provably numbers, so
     `collectionConstructorBody` must accept any `PointList` for this question.
   - **`PointList` refuses a component typed `list<number> | number`.**
     `compileJSPointList` (`compilation/javascript-target.ts`) has a run-time
     role test (`Array.isArray`) for a `broadcastable<number>` component, and
     throws "neither a scalar slot nor a list source" for the union that means
     the same thing — the type a coordinate read has when its point may be one
     point or a list of points. Trial fix: admit a union whose every member is a
     scalar number type or an indexed collection of scalar numbers, with no
     tuple member, to the same run-time test.
   - **An ordering over `|1/Conjugate(…)|` is refused as complex-valued.** Not
     traced: `Less` declines with "an ordering comparison over the
     complex-valued operand" for an `Abs`, which is real by definition. The
     stereographic projection of the same document has the same comparison and
     compiles, so the difference is in the operand's shape here (`C_cf` is the
     fully expanded `S(f(N(F(0))))`).
   - In the repro without Tycho, the first fix moves the decline to `Argument`
     ("a broadcastable head over a possibly list-valued operand"), which is the
     refusal described in item 1. None of the trial fixes was landed: no route
     yet compiles the row to a value that can be compared with the interpreter.
     A separate observation for Tycho, not a Compute Engine defect: `Min(1, L)`
     with a list `L` is a REDUCTION in Compute Engine (it answers one number, in
     the interpreter and compiled alike), so the saturation and the value of
     `c_f` are one number for the whole cloud. If Desmos evaluates `min(1, L)`
     element by element, the conversion of that row needs an element-wise form.
3. **The other targets were not examined at a pole.** The shader targets and the
   Python target have their own complex division and power. Python raises
   `ZeroDivisionError` for a complex division by zero; the shader result is
   whatever the hardware answers for `0.0 / 0.0`. The kernels of the JavaScript
   runtime were checked at an exact zero argument only, which is the one pole a
   floating-point argument reaches exactly.

### Every call of a user function invalidates every generation-keyed cache (OPEN, caching design — found 2026-09-22)

`invoke` → `declareParameterActivation` declares the function's parameters in a
new activation scope, and the `declare` state event advances the `any` cache
axis. So any value cached against `ce._cacheGeneration()` misses after any
user-function call in between. Example: `Apply(Derivative(f, 3), x).N()` at
several points computes and simplifies the derivative again at each point. A
declaration into an activation scope could be marked `scratch` (advances no
axis), but a value can outlive its activation, which is the soundness question
discussed in the `declare` case of `axisMaskOf`
(`engine-configuration-lifecycle.ts`). User decision (2026-09-23): yes, make
activation declarations `scratch` once the soundness check passes.

Soundness check (2026-09-23): it FAILS. With every activation declaration marked
`scratch`, three tests of `lambda-param-collection-inference.test.ts` overflow
the stack: `countdown(xs)` with the body
`if Length(xs) == 0 { 0 } else { 1 + countdown(Rest(xs)) }`, and the two
mutual-recursion tests. The body node `Length(xs) == 0` is shared by every call,
and its value cache is keyed on the generation; with no advance per call, the
second call reads the first call's answer (4), so the base case is never
reached. The type and sign of a body SYMBOL are safe (its definition is fixed
when it is boxed), but a cached answer of a compound body node can read the
call's values through `_contextValue()`. Other probes (sign-dependent bodies
with alternating signs, `Simplify`, `D`, `N`, `Integrate` in a body, a returned
closure) gave the same answers with and without the change, and the rest of the
suite passed. The gain is also smaller than expected:
`item-284-derivative-compile-cost.test.ts` took 20.6 s instead of 22.9 s (one
run each, under load). A sound version needs the caches of a body node to depend
on the call: for example a per-activation stamp in the key of the value and
facet caches of a node that reads a parameter, or an axis that only activation
declarations advance.

Measured 2026-09-24 at MACHINE precision (the precision of a Tycho plot
document; an upper bound, with the unsound `scratch` change applied in a
worktree, same answers except the known recursion case): removing every
activation advance saves nothing measurable on realistic interpreted workloads —
a `g`, `h`, `k` chain at 1,000 points 119 → 124 ms, a list broadcast 14 → 15 ms,
the noise functions of Tycho document `hyvhlz4chj` on a 20×20 grid (18,820
calls, 24,020 advances) 465 → 442 ms (5%) — because the recomputations the
advances cause are cheap. It saves 30% on a list recursion (77 → 52 ms) and
about 78% on `Apply(Derivative(f, 3), x).N()` at 100 points (255 → 56 ms), where
the closed form is re-differentiated and simplified at each point. Decision
taken on this measurement: no general per-call cache design now; instead (a) key
the derivative closed form on the definition of `f` rather than on the `any`
axis, and (b) reduce per-call costs. The machine precision profile of the Tycho
case (40×40 grid, top self time): development- only `console.assert` calls 8.0%,
`viewOfExpression` (from the broadcast check `skipBroadcastForVectorOps` in
`evaluate`) 7.4%, a V8 built-in 5.7%, garbage collection 5.1%, then `isSubtype`,
`lookup` and `declareParameterActivation` at 1–2% each; no big-decimal
arithmetic (an earlier profile at the default 21 digits showed it, because the
benchmark used a bare engine).

Done 2026-09-24: item (a), and the broadcast check of item (b). The finished
closed form of `Derivative(f, n)` (`symbolic/derivative.ts`) records the
definitions and `_writeVersion` of the symbols its simplification reads, and
stays valid across the per-call `any` advances while the semantic version, those
definitions and the assumptions-hidden bit are unchanged (100 points 326 → 77
ms, 1,000 points 1,936 → 158 ms). `skipBroadcastForVectorOps` returns before it
builds operand views when the operator declares no broadcast exemption (the
Tycho case 1,465 → 1,264 ms at 40×40). Still open: the cost of each parameter
declaration (`declareParameterActivation`), and the general per-call cache
design (not worth it, measured above).

### Rubi 1.2.2.4 #214 reaches the 30 s guard in the rule matcher (OPEN, performance — found 2026-09-24)

After the polynomial GCD fix, one problem of a 200-problem chapter-1 sample
(`--sample 200 --seed 14`) still reaches the 30 s wall-clock guard: 1.2.2.4
#214, unsolved after about 80,000 steps. Its profile has no time in the GCD: the
time is in the rule matcher (`match.ts`), garbage collection, and about 3.6 s of
`console.assert` calls in the `ExactNumericValue` constructor
(`exact-numeric-value.ts`) and near `get isCollection`. The production build
strips `console.*`, so that part is a cost of development and test runs only;
the matcher time is real. The other guard problems of chapters 2–7 were not
re-measured; measure them before shortening the guard. Also: the
`.sub()`/`.add()`/`.div()` methods fold exact radicals to floats (`√2 − 2` →
`-0.5857…`); `polynomialDivide` no longer uses them on coefficients, but
`makeMonic` (`.div()`), `resultantRec` and `polyDivide` in `rubi-utils.ts` were
not audited.

### Slow operations and slow tests found by a review of the slowest test files (OPEN, performance — found 2026-09-22)

The sample cache of complex integrands, the NaN stop in adaptive quadrature, the
derivative cache, the nested-quadrature test budget, the GLSL loop test, the
Rubi rule-pack loads in tests and the Monte Carlo cost of
`derived-substreams.test.ts` were fixed on 2026-09-22. What stays open:

- **Compiled complex arithmetic is about 10 times slower inside jest than under
  tsx.** One `_SYS.cpow(Math.E, {re: 0, im: x})` call takes about 1.5 µs in jest
  and 0.15 µs under tsx, probably because jest runs the code in a separate `vm`
  realm. `measurement.test.ts` makes 2 × 1e7 such calls and takes about 40 s.
- **The adaptive quadrature stops when all panels are NaN, there are at least
  16, and a bisection gave two NaN children** (`ALL_BAD_STOP_PANELS` and
  `mustStopAllBad` in `numerics/gauss-kronrod.ts`). Isolated removable
  singularities move to panel boundaries when their panel is bisected, so they
  still converge, also when there is one at the center of each of the 16
  starting panels. An integrand that is finite only on a region narrower than
  1/16 of the interval now answers NaN where the old loop could find a finite
  value. No test covers this case.

### Reductions over ten thousand elements: what is left outside the interpreter's arithmetic (OPEN, evaluation performance — measured 2026-09-20, revised 2026-09-21)

Found while looking at `Min(1, 2 − 2·PointZ(C))` over ten thousand points, the
colour row of the Tycho corpus document `s8ishknvhe`, which Tycho interprets
today (the row declines to compile, see the entry for that document). At machine
precision that expression is now 5 ms under `evaluate()` (it was 219 ms on
2026-09-20): written-out data evaluates to itself, the coordinates are read into
a list of unboxed doubles, the arithmetic runs on doubles, and `Min` scans them.
What is left:

- **At the default precision each element is computed with `BigDecimal`**, about
  12 µs per element (`add` → `nvSum` → `BigDecimal`). The derived `array` of a
  list of such floats is also slow to build (8–15 ms), because each float is a
  big-number value that is checked by boxing its machine value again
  (`machineNumberOf`).
- Smaller, measured and not built: on the JavaScript target `Min(1, L)` copies
  its operand (`[1, ...L]`) and `Min(L, M)` copies both (0.22 ms against 0.07 ms
  for `Min(L)` at ten thousand elements); a seeded `reduce` would not copy.

For Tycho, not a Compute Engine defect: its lowering of Desmos `min`/`max` with
two or more arguments to `ElementMin`/`ElementMax`
(`elementwise-extrema-lowering.ts`) did not reach that colour row: the engine
received the reducing `Min(1, …)`, so the saturation and the value of the colour
are one number for the whole cloud.

### Residue of the Tycho code-generation audit of 2026-09-08 (OPEN — the audit's C1, I2, J1/G1, G2–G9, J4–J9 items landed 2026-09-08)

The audit
(`~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/2026-09-08-report.md`, CE
0.126.2, 862 records over 71 documents) was worked in eight slices; what follows
is what the slices measured and did not change. Each line names the decision or
the work that remains.

- **Interval-js library residue after outward rounding (2026-09-08).**
  `integrate.ts` keeps its `widen()` margin for the partition widths, with a
  deliberate factor of three; the composed hyperbolic and reciprocal routines
  are built from unrounded kernels and take one step at their own export, except
  `remainder`, whose three-operation composition takes three.
- **Identity lowerings that return their operand's code, other targets.** The
  JavaScript handlers were fixed this round (`identityPassthrough`,
  `javascript-target.ts`). The same pattern — `return compile(op)` spliced bare
  into an infix parent — is likely in `python-target.ts` and `gpu-target.ts` and
  was not checked; the arithmetic passthroughs of the JavaScript target
  (`Add`/`Multiply` with one operand left after filtering identities,
  `Power(x, 1)`, `Divide(x, 1)`) are reachable only from non-canonical input,
  and non-canonical `Multiply(3, Multiply(Add(x, 1)))` emits `3 * * _.x + 1`, a
  syntax error. One sweep across the three targets, or threading the caller's
  precedence into `OperandCompiler` (it compiles at precedence 0 today), closes
  the family.
- **`_SYS.cabs` squares before the square root**, so `|3e-200 + 4e-200 i|`
  answers 0 where `Math.hypot` answers `5e-200`. The split real-part lowering
  added this round uses `Math.hypot`; the object form still goes through `cabs`.
  Consider `Math.hypot(z.re, z.im)` in the helper.
- **Audit item J3 is not reproducible at HEAD.** The 496 `_SYS.bcast` sites over
  user-function results needed the call to type top; every construction tried
  (assign, declared `-> unknown`, `Block`, `If`, `Which`, piecewise) types
  `number` at HEAD — the Block analysis moved to value-before-type on
  2026-09-08, after the 0.126.2 run. The constructed-scalar arm added this round
  is a guard for weaker inference. Re-run the audit against HEAD before spending
  more here.
- **`Sum(At(P, Range(a, b)))` materializes the range.** The 24 `Array.from`
  range sites in the corpus are all places where the range is needed as a list
  (7 gather indices, 15 spread elements, 2 broadcast operands); a counting loop
  has no site. The 7 gather sites would take a gather/reduce fusion in
  `emitCollectionReduce` (`javascript-target.ts`) — a new lowering.
- **GLSL `fract` and `exp2` apply to scalar operands only.** The peepholes
  consume an operand, so the emitted call has fewer arguments than the head has
  operands and `gpuCheckOperandShapes` declines a vector (`Mod(v, 1)` stays
  `mod(v, 1.0)`). Teaching the gate about operand-consuming lowerings
  (`markAggregateConsuming` exists) lifts the restriction.
- **GPU literal spelling.** Folded GPU literals are spelled with the full double
  `toString` through `formatFloat` (`0.00015625001105945557`); the shortest
  float32 round-trip spelling would be about 9 digits and shrink shaders
  further. `formatFloat` is shared by every GPU emission.
- **Audit item J6a (the 200-character index lambda, 211 sites) is Tycho's.** The
  lambda is emitted by Tycho's own `At` override
  (`~/dev/tycho/src/graph-paper/graph/at-index-semantics.ts`, `atDef.compile`),
  not by the engine. Its semantics differ from `_SYS.at` (no
  negative-from-the-end indexing; a per-position absence marker for a list
  index). The engine now ships `_SYS.atNoWrap(base, index)` with exactly the
  lambda's semantics; the 42 KB is recovered when Tycho's override calls it.
  Hand off to Tycho.
- **Audit item I4 (interval piecewise arms as per-call closures; the `Sum` bound
  read through an inline shape probe) was not worked** this round.
- **A record reaching an `unknown`-typed parameter through a callback value is
  broadcast over its fields.** The broadcast-aware wrapper a function value
  receives decides with `Array.isArray`, and a record, tuple or nominal value
  lowers to a bare JavaScript array. A parameter TYPED as one of those keeps the
  bare reference (`signatureParamsLowerToScalars`, `base-compiler.ts`); a
  parameter left `unknown` is admitted, as the interpreter's own broadcast gate
  admits it, so `Map(f, persons)` with an unannotated `f(p)` would map over each
  person's fields. Objects have no compiled representation yet, so no corpus
  reaches this; recorded so the gate is tightened when they do.
- **The broadcast wrapper around an inline function literal is wider than
  callback position.** The `Function`-literal lowering cannot see its parent, so
  the wrapper also lands on a block-local definition (`let g = (k) ↦ …`, whose
  call sites are already broadcast-aware), on an `Apply` head (`\sin'(x)`) and
  on a whole-artifact function result. Redundant, not wrong: one extra call
  frame and one `Array.isArray` per call. Narrowing it means moving the wrap
  into the callback funnel of `javascript-target.ts` (`hoistedCallbackLambda` /
  `fnArg`), which was carrying a peer's in-flight work when this landed
  (2026-09-08). Also: `Map(Length, xs)` does not compile on the JavaScript
  target — the synthesized parameter is typed `unknown`, so `Length` declines (a
  fallback, not a wrong value).
- **A partly nested source diverges between the routes.** With
  `k(L: list) := Map(f, L)` and `f: (number) -> number`, the interpreter types
  the whole source `[[1, 2], 3]` as a union a scalar satisfies and broadcasts
  each row (`[[2, 4], 6]`), while the compiled reference tests one element at a
  time and answers `[NaN, 6]` — the ruling of 2026-09-08 (a declared-scalar
  callback refuses a collection element) spelled per element. A per-element test
  cannot reconstruct the source's type; documented in
  `docs/COMPILATION-MODEL.md` § Collections.
- ** RULED 2026-09-22 (a): `Map` broadcasts per row like a direct call,
  `[[2, 4], [6, 8]]` on both routes.An accepted hoist binding can be left unread
  on GLSL.** For `\sum_{i=1}^{200}(i x + \min([1,2,3]))` the list literal is
  hoisted as its own class (`vec3 _tv2 = vec3(1.0, 2.0, 3.0);`) and the `Min`
  class then folds to `1.0` without reading the override, so the declaration has
  no reader. Valid shader source (dead code the driver drops), not a miscompile.
  The fix is in the hoist contract or in `gpu-target.ts` (the caller writes the
  declarations into the returned string), found by the review of this round.
- **Plain arithmetic over a captured symbol whose scalar type was inferred does
  not broadcast at run time.** `compile(2y)` emits `2 * _.y` and
  `run({ y: [1, 2, 3] })` answers NaN where the interpreter answers `[2, 4, 6]`.
  This is the compile target's standing contract for a free symbol (a number
  unless typed as a collection), not a regression of this round; the
  user-function call guard covers only call sites. Recorded so the contract is
  decided knowingly if a consumer asks.
- **Not this round, noted by the slices:** `vars: { g: '…' }` does not override
  a user-function head — the call still emits `_fn_g` from the engine definition
  (head resolution); `ColorMix((1,0,0), (0,0,1), 0.5)` compiles the tuples as
  OKLCh components, which may not be the intended reading of a bare tuple
  (colour lowering owner); compiled `\arg(x - iy)` at `x = -3, y = 0` is
  `atan2(-0, -3) = -π` where the interpreter answers `+π` (pre-existing
  signed-zero seam); JavaScript unrolled sums below four terms have no statement
  form and do not hoist; the Python target does not hoist at all.

### Open items from the small-fix release batch (2026-08-31)

- **Past the exact-expansion caps a few Γ-ratio points stay symbolic**:
  `Pochhammer(a, k)` with both `Γ(a)` and `Γ(a + k)` on a pole and `|k| > 20`
  (`SYMBOLIC_EXPANSION_CAP`), and `GammaRegularized(n, z)` for `z < 0` and
  `n > 20` (`MAX_GAMMA_Q_SERIES_ORDER`). Honest gaps, never `NaN`.

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

### The interpreted growing-list loop stays quadratic (OPEN, no urgency — recorded 2026-09-04)

`let xs = []; for k in 1..n { xs = Join(xs, [k]) }` costs about 0.5 µs per
element per turn on the interpreter since the literal-list fold of 2026-09-04
(857 ms at 1000 turns; the compiled route was already a native array copy per
turn): an immutable append copies the list. Levers not taken, for a later round
if interpreted loops of many thousands of turns matter: a growable backing
buffer with prefix views (amortized O(1) append, safe without ownership analysis
because every holder of an older value keeps its own prefix) paired with an
incremental type for the new node, and a per-node descriptor cache on the type
cache's invalidation axis.

### Open items from the undecided-condition ruling (2026-09-02)

The ruling ("a compiled `If`/`Which` whose condition is not exactly `true` or
`false` at run time takes no branch") is implemented for the JavaScript-family
lowering of both the expression form and the statement form
(`BaseCompiler.conditionDecidability`), and the interpreter agrees since
2026-09-03. One deliberate non-alignment remains.

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

### Fungrim Stage-2 residues: `Fibonacci` growth class, the corpus manifest fork id, `CartesianPower` (OPEN, low — Stage-2 triage of 2026-08-29)

**Left from the Stage-2 triage of 2026-08-29.** (With the deadline restored,
Stage 2 finished in 47 s and reported 16 False instances in 6 entries. The
defects it found are fixed: the `leadingOrder` rewrite in `symbolic/limit.ts`
that turned `Fibonacci(n+1)/Fibonacci(n)` into `1`, `Integrate(…).N()` dropping
the imaginary part of a complex integrand, the upstream statement of
`π = Σ n!/(2n+1)!!` in entry `419b45` — the sum is π/2 — and the translator's
elementwise reading of Fungrim's Cartesian power in entry `4099d2`.)

- `Limit(Fibonacci(n+1)/Fibonacci(n), n→∞)` stays an inert `Limit` (no growth
  class for `Fibonacci`); resolving it to φ needs a growth level for
  exponential-class special functions — OPEN, low.
- `data/fungrim/MANIFEST.json` carries the regenerated corpus hash for the
  `419b45` correction; the fork commit id in the manifest must be refreshed once
  the `arnog/fungrim` fork change (`pygrim/formulas/pi.py`) is committed.
- A Compute Engine `CartesianPower` operator would make entry `4099d2`
  evaluable: `grim2mathjson` emits the shell `CartesianPower(S, n)` for a
  set-based `Pow`, so the entry is `not-evaluable` instead of False — OPEN, low.

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

### Type derivation reaches state mutation at 7 handlers, 2 `elttype` handlers and 1 getter — AUDITED 2026-08-22 (OPEN, defects — the getter half is done: `_reviseInferredType` no longer writes on read; the 7 handlers and 2 `elttype` handlers remain)

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

### No lowering compiles a stored symbol value where a binder rebinds one of its names (OPEN, found 2026-09-21 while carrying out the two scoping decisions of that date)

A stored symbol value keeps the binding it was written against, and the
JavaScript and `interval-js` targets honour that by emitting the value as a
preamble local outside every emitted function (`bindsFoldedValue`,
`base-compiler.ts`). Two shapes have no such place to put it, and both now fail
closed (D6) naming the symbol and the shadowing name, so the public route
answers through the interpreter. What is open is the lost capability, not a
wrong answer.

- A compiled top-level lambda holds its preamble INSIDE the lambda body
  (`userFunctions.valueRoot`), because a compiled lambda takes only its declared
  parameters: a free symbol has no supply channel there. So
  `compile((n) ↦ Σ_{n=1}^{3} a)` with `a := n + 1` declines, where the
  interpreter answers `3n + 3`. Compiling it needs a lowering that puts the
  preamble at the ROOT and gives the lambda a channel for the value's free
  names.
- The shader targets (`glsl`, `wgsl`) declare statically typed functions and
  have no place for an untyped value binding, so they fold inline:
  `compile(g(2), { to: 'glsl' })` with `a := 3t + 1` and `g := t ↦ t + a`
  declines, where it used to emit
  `_fn_g(float t) { return (3.0 * t + 1.0) + t; }` and read the parameter.
  Compiling it needs the value as a uniform, or the emitted parameter
  alpha-renamed. A shader `Sum` whose body folds a value naming the index
  declines for the same reason.

Both shapes are pinned in `compile-fold-shared-values.test.ts`. A document that
relied on the capture — a Desmos-style kernel where `d_00 := p(x, y) · S` is
read inside `c_2(x, y)` — now declines on the shader targets instead of
computing what the interpreter never computed.

### JavaScript list-arithmetic declines, triaged (2026-09-14, the point-list-arithmetic candidate)

A fresh CORE-corpus audit at HEAD found 52 `javascript` records that fail closed
with "cannot compile scalar arithmetic over a list-valued operand" (and one
`Abs` variant). They are not one gap. Each bin below carries its witness; the
record counts are from the 2026-09-14 run.

Not defects (the interpreter itself does not produce a value):

- **Invalid input.** `2ki2hjsouf` (10 records) boxes with an
  `Error(incompatible-type)` node inside it, and `ifnnzttcqg` (1) likewise;
  `6kalzeiedk` (1) references an undefined operator `B`. The compiler correctly
  refuses an expression the interpreter also rejects.
- **A point summed with a scalar.** `urbddymicb` (8) is
  `(x − C_x)² + (y − C_y)² + (−R_2, −o_ut)` — a scalar plus a point. The
  interpreter answers `Error(incompatible-type, "tuple", "number")` at that sum
  (measured 2026-09-14), so failing closed matches interpretation.

Open, each with a witness:

- **A point summed with a symbol declared as a point-OR-point-list union
  (`indexed_collection<number | tuple<…>> | list<tuple<…>> | tuple<…>`) fails
  closed, and that is a RULING for Tycho, not a compiler change.** The
  declaration admits a flat array of numbers, which at run time has the same
  shape as a point, so the sum with a point list cannot be decided by the
  value's shape (`runtimePointShapeIsUnambiguous`). Concrete input:
  `W(…) + PointList(…)` where Tycho declares `W`'s result with that union
  (`0d6251b03c`, `n7uhaaoq1q`, `pwceub9smn`, and the earlier `njncrg9fkv`).
  Options: (a) Tycho narrows the declaration to `list<tuple<…>> | tuple<…>`,
  which the shape test decides at run time and the sum then compiles; (b) the
  compiler adds a scalar-shape dispatch arm that answers `NaN` where the
  interpreter errors, which loses the interpreter's per-element error. If
  nothing is decided, these ~5 records keep failing closed. Recommend (a): it
  makes the sum compile without changing any answer.
- **`Power` over an operand that is a point, a list, or a list of points is
  element-wise identically** — `(3,4)² = (9,16)`, `[3,4]² = [9,16]`, a list of
  points → `[(9,16),(25,36)]` (measured 2026-09-14) — so the point-vs-list
  ambiguity that blocks `Add` does not change `Power`'s answer. A union-typed
  SYMBOL operand already compiles for `Power` (probed 2026-09-14), so the corpus
  rows decline in a call structure not yet reproduced: `hpr2q4kles` (9 records,
  `P(U(x, y), …)`), `hbvzf9yk1r` (1), and the `Power` records of `jgcclk1njk`. A
  follow-up must reproduce one of those rows and locate the decline before
  broadening the `Power` broadcast admission.
- **A point whose own coordinate is a list.** `u1bpof8xfg`'s Multiply now
  compiles, but the enclosing `Add` still fails closed: the point
  `(−cos t, sin t · sgn R)` has a list second coordinate (`sgn R` over a list).
  This is the open point-with-a-list-coordinate shape (ruled A,
  `COMPILATION-MODEL.md`), not the list-symbol case.

The "color family" (`s8ishknvhe`, `woeywky0kj`, `iqnkdz3ptt`; `wgxnrn87sx` was
resolved 2026-09-14) is NOT a distinct color-broadcast gap (reproduced
2026-09-14). The color-broadcast path already handles a head over a list of
colors: `AsOklab` over a `list<color>` compiles to `_SYS.bcastColor`. These
records trace to point-list arithmetic surfacing in color-heavy documents:

- `s8ishknvhe`: still declines (re-confirmed by Tycho 2026-09-18 on `C_cf`:
  `Abs: cannot compile a broadcastable head over a possibly list-valued operand`).
  Its operand `C_c` carries a `number | tuple` ELEMENT arm
  (`indexed_collection<number | tuple<…>> | …`), an imprecise parameter-union
  artifact (Tycho D-229) that could be a point spelled flat OR a list of points.
  The accessor leaves that as `collection<number>` — it is genuinely ambiguous,
  so failing closed is sound. The fix is at the type source: narrowing the arm
  away (Tycho's return-type narrowing, or wherever `C_c`'s type is set), after
  which the accessor distributes and it compiles.
- `iqnkdz3ptt` (2 records): the failing row is a point plus a number list
  (`(⌊…⌋, …) + [0, 1]`), which the interpreter answers as an `incompatible-type`
  error per element (measured 2026-09-14) — so the decline matches
  interpretation and is not a defect.
- `woeywky0kj`: builds an RGB triple in a `list<color>` context; the exact
  failing operand was not pinned (the isolated row compiles), and needs a clean
  audit run to capture.

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

The preamble binding is per SYMBOL, so it does not reach sharing INSIDE one
symbol's value. Tycho now publishes that document's height map with the helper
bodies substituted (measured 2026-09-16 on Tycho `03ebe4fc8`): the value of
`h_eightMap` is one expression of 236,663 distinct nodes in which each level's
argument is shared by the dozen reads of the level above, 25 billion nodes as
text, and `b_ase` holds no value at all. On the JavaScript target the four
terrain triangle rows therefore decline at the guard (census 2026-09-16; they
compiled on Tycho `5ce55d2bd`, where the sliders were untyped and the value
open). Evaluating the closed value first would not help either: at size 64 the
literal is 8,192 points, above the guard on its own. The lever is the one the
consumer prefers, a runtime-binding channel for a symbol value, or a per-node
binding of each sub-expression that has several parents. The reference analysis
that a declined result carries walks such a value once per node and no longer
runs a caller's `compile` handler inside it (`CHANGELOG.md`).

### Fixed-width collection chains: residue after the 2026-09-08 and 2026-09-09 rounds (OPEN, compile performance — consult with Tycho, Desmos state 62urmx2dcm)

The rounds of 2026-09-08 and 2026-09-09 (fixed-width unroll pass, callback
hoist, call-site inlining of point arguments, the last-call memo on pure scalar
definitions; all in `CHANGELOG.md`) took the by-reference Voronoi row from 58 µs
to about 2.7 µs a sample. What remains:

- **Cross-definition CSE: the shared block inside two definitions.** The
  2026-09-09 last-call memo (`memoizeSharedDefinitions`, `javascript-target.ts`)
  removed one of the three evaluations of the nine-point block per sample: the
  row's second call of `m(x, y)` is now answered from the record of the call
  inside `m2` (by-reference row 3.4 → 2.7 µs per sample; the inlined row is 1.2
  µs on the same machine at the same time). The remaining 2× is the block
  itself, computed once inside `m2` (its own inlined `d(x, y)`) and once inside
  `m`. Sharing it means emitting the block once as a helper over `(x, y)` that
  returns the nine distances, memoized the same way, and reading from it in both
  bodies. Scoped 2026-09-09 and NOT built, because it needs two new concepts: a
  CSE harvest whose region spans several emitted definitions (`cse.ts` regions
  are per root today, and a candidate found in two bodies must be materialized
  as a call that passes the bodies' parameters, not as a `const` at a region
  entry), and an alignment of parameter names across the bodies (`m(x, y)` and
  `m2(x, y)` share names by luck of authorship; `m(u, v)` would not match
  without alpha-renaming the harvest). The memo of an ARRAY result — which the
  helper would return — is a third question the current memo deliberately
  declines (an array compares by identity and may be mutated by its consumer).
  Inlining small scalar callees at call sites was measured and rejected earlier:
  a size bound on the AUTHORED body does not bound the EMITTED code (`m` is 4
  nodes authored, 2 456 characters emitted), and making the inliner the primary
  route retargets 374 `_fn_*` call shapes across 35 test files. Tycho was asked
  to re-measure on 0.127.0 before this is reconsidered. Corpus count
  (tycho-perf, 2026-09-09, 71 documents): a collection-valued helper reached
  from two or more definitions occurs in 2 of 30 core documents, and only ONE
  plotted row anywhere — this Voronoi diamond — reaches such a helper through
  two callers. An array-result memo would fire on that one row; it is not a
  general mechanism on this corpus.
- **A fixed width known only from a TYPE** (`P: list<tuple<number, number>^9>`
  as a symbol, `At(P, i)` reads) is not unrolled; the pass needs a literal
  `List`. Unrolling from the type would rewrite `Map(f, P)` to
  `[f(At(P, 1)), …, f(At(P, 9))]`, which then needs an `At` lowering over a
  declared list on the shader targets. Corpus count (tycho-perf, 2026-09-09): 0
  sites on every target — Tycho expands value macros before compiling, so a wide
  list reaches the engine as a literal `List`. The only witness is the
  by-reference Voronoi row, which the audit harness cannot see: its by-reference
  records fail at binding on Tycho's side (`Unknown operator d`). Not built.
- **A point bound to an untyped parameter that cannot be inlined fails closed.**
  The call-site substitution declines for an impure point argument, a recursive
  or multi-clause callee, and a body that is invalid over a point (`P·P`,
  `2P + 1`); the compile then reports the reason and the `fallback: true` route
  answers through the interpreter. A parameter the body never mentions keeps the
  by-reference call, whatever its argument is. A per-shape specialization of the
  emitted definition would compile those cases too; not built, no consumer has
  asked.
- **`Map(h, list)` with a bare head is unrolled only for a user function with
  ONE plain parameter.** A variadic `h` would be sound for a bare head (the
  rewrite writes `h(e)` either way) but is declined with the lambda case for
  now; a library operator head (`Map(Sin, list)`) is not unrolled either. Both
  are missed optimizations, not defects.
- **Consumer-side fact for Tycho:** on `glsl`/`interval-js` the by-reference
  route needs the plot variables DECLARED (or supplied through `vars`): an
  `unknown`-typed argument could hold a collection the by-reference call would
  broadcast, so `provablyScalarArg` refuses to inline over it. This is a
  soundness guard, not a defect.

### Code-generation census on CE 0.128.13: ranked candidates (OPEN — measured 2026-09-16, data and table in `docs/plans/2026-09-15-interval-js-collection-lowerings-handoff.md` §9)

Declines per target on the all-states Tycho corpus (684 documents): javascript
112 in 38 documents, glsl 148 in 55, interval-js 188 in 66 (down from 233 on
0.128.12). The first two candidates of that census landed (the lazy-list
re-evaluation on 2026-09-16, the interval absence class and the coordinate
accessor over a point list on 2026-09-18; both in `CHANGELOG.md`). What is left,
in order of value: (1) JavaScript scalar arithmetic over a list-valued operand,
33 rows (the triaged list-arithmetic entry); (2) GLSL `At` over a run-time
indexed collection, 32 rows, and GLSL `Integrate`, 15 rows; (3) the remaining
interval `List` rows, triaged in the entry "Interval target: the census rows
that remain are not implicit curves". `D`, `PointList` and the complex rows on
the interval target are design boundaries, not candidates. The next measurement
is a new all-states baseline on the current release (item 4 of the ranked list
at the top of this section).

### Collection values on the interval target: what stays open after the 2026-09-15 round (OPEN — the round itself is in `CHANGELOG.md`, design record in `docs/plans/2026-09-15-interval-js-collection-lowerings-handoff.md`)

The interval target now maps scalar kernels over provable lists of numbers,
carries arrays across user-function boundaries, builds a range at run time and
reduces over it. Three things were left out of that round on purpose:

- **A reduction over a bound that is not constant over the cell answers
  `entire`.** The indexed `Sum`/`Product` loop (a bound whose endpoints floor to
  different integers) and the run-time range (`_IA.range`, a bound that is not a
  point interval) both give up instead of enclosing. The sound refinement is the
  hull over the integer bound pairs: for `Σ_{k=a}^{b} f(k)` with `a ∈ A`,
  `b ∈ B`, the union of the sums over every `(⌊a'⌋, ⌊b'⌋)` pair, computed from
  prefix sums under a pair budget. A plotter's cells refine until the bound is
  constant, so the cost of `entire` is plotting time, not soundness; do the
  refinement when a corpus document shows the cost.
- **`D` (a derivative) on the interval target has no lowering beyond the closed
  form.** `d/dx L(x)` compiles when the derivative of the body has a closed form
  (the shared `compileDerivative`), which is what the census's witnesses lacked
  (16 declines, 8 documents: a body with a sum over a symbolic bound, an
  integral, a piecewise). The JavaScript target's numeric fallback is a
  finite-difference stencil, which is not an enclosure of the derivative over a
  cell and must not be ported. The sound route is forward-mode automatic
  differentiation in interval arithmetic — a jet lane over the interval kernels,
  the interval counterpart of `jet-derivative.ts`. Design work; demand-gated.
- **A relation over a provable list (`L < 1`) keeps the scalar-operand gate.**
  Its element-wise value is a list of tri-state verdicts, which the result
  contract (`IntervalValue`) does not admit. Tycho compiles the UNMASKED body of
  an implicit member, never the relation, so no corpus row needs it.

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

**What the pre-pass covers since 2026-09-12** (`fixed-width-unroll.ts`; the full
corpus run refuted the "demand at zero" paragraph that follows — `ccoc40kfhj`,
24 `interval-js` records, writes every colour channel as a `Which` broadcast
over a three-element list read back at one index). A literal index is pushed
through a `Which`/`If` whose first condition is a list — a later scalar
condition and a scalar or point arm repeat at every position, as the interpreter
lifts them — and on through the ordering relations, `Equal`/`NotEqual` against a
scalar, `Mod`, the other element-wise heads and a literal `Range`, down to the
literal list, so the row is one scalar selection on every target; and a
`Which`/`If` whose first condition is a WIDE list built from non-constant lists
(five or more elements, at most 64) is written out as the list of its
per-position selections.
`test/compute-engine/compile-elementwise-selection-unroll.test.ts` pins the
rows, the walk's refusals and the shader compiles. What is NOT covered, with the
reason:

- a selection with no default clause and a point arm (a position no clause
  selects is `NaN` element-wise but `Missing` for a scalar selection);
- a `Which` in statement form inside a lambda the pass does not enter
  (`5qn5kcrszu`, 6 `javascript` records);
- the Voronoi witness above, whose condition is built from a list of POINTS
  (`|P − (x, y)|` over a `PointList` literal) — the width walk reads lists of
  scalars only;
- `When` over a list condition, whose interpreter semantics for a point value
  are undecided (no ruling entry records the question yet).

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

### A `Which` over a list condition: the time limit is exceeded by half at 10 000 elements, and a repeated sub-expression is evaluated once per reference (OPEN — Tycho ask 296, cause found 2026-09-18)

Tycho ask 296 reports that `evaluate()` of a piecewise whose condition is a list
returns a symbolic `Which` of 52 MB at 500 elements, and that at 10 000 elements
the process exhausts its heap before `ce.withTimeLimit(5000, …)` throws. The ask
said the engine has no elementwise selection. That was not the cause: the
evaluator does select elementwise over a list condition
(`Which([1,5,2] < 3, 10, True, 20)` evaluates to `[10, 20, 10]`, and the same
holds when the list is the value of a symbol, when the arms are lists, and when
the arms are point lists).

The cause was the function `conj` in the witness (`s8ishknvhe`, Desmos's complex
conjugate). `conj` had no parse entry, so the boxed body held `conj(L)`, an
unknown function applied to the complete list. An unknown function does not
broadcast, so each element of the condition list held a copy of `conj(L)`, no
element could be decided, and the `Which` stayed symbolic: N copies of an
N-element list for each reference to `conj`. `\operatorname{conj}` now parses as
`Conjugate` (`definitions-complex.ts`), and the body Tycho sends evaluates to a
`List`. Instrument on the Tycho side:
`scripts/repros/2026-09-15-list-conditioned-piecewise-probe.mts` in `dev/tycho`.

Two defects remain. Neither depends on `conj`: any unknown function over the
list inside the condition gives the same symbolic `Which` (measured with `foo`
in place of `conj`).

1. **On the undecidable body the time limit is exceeded by half at 10 000
   elements.** Tycho's probe on the published 0.130.0, 2026-09-18, with
   `ce.withTimeLimit(5000, …)`: 1 000 elements → returns a symbolic `Which`
   after 4.4 s, heap 108 MB (the value shares its sub-expressions in memory, but
   its MathJSON is 208 MB); 2 000 → throws at 5.0 s, heap 227 MB; 10 000 →
   throws only at 7.4 s, heap 351 MB. Some step of the broadcast runs for more
   than 2 s without a deadline check. The heap exhaustion that ask 296 reports
   (926 MB at 1 000 elements, 3.3 GB at 2 000, out of memory at 10 000) was
   measured on 0.128.11 and no longer reproduces: memory stays under 400 MB.
   Tycho re-measured the ask at 500 elements only, so its row still carries the
   0.128.11 readings.
2. **The selection over a decidable list condition costs about 2 ms per element
   for this body** (measured from source with `tsx`, which adds loader overhead:
   500 points → 0.9–1.2 s, 2 000 points → 4.2 s; at 10 000 points the 5 s limit
   refuses the evaluation). Two causes, measured 2026-09-18:
   - The body holds the same inner `Which` six times (Tycho expands the document
     functions `S`, `f` and `N` in place), and `evaluate()` computes each
     reference separately: one inner `Which` costs 130–190 ms at 500 points.
     With the inner `Which` evaluated once and bound to a symbol, the same
     result takes 0.2–0.3 s in place of 0.9–1.2 s. Tycho addressed this on its
     side (2026-09-18, `shared-subexpressions.ts` in `dev/tycho`): each repeated
     function node that reads a collection is evaluated once and bound in the
     resolver's child scope — 10 000 points 11.0 s → 1.8 s on a quiet box, the
     production resolver answering in 2.6 s. Two facts from that work matter
     here. (1) Calling `S`, `f`, `N` by reference in place of expanding them is
     NOT value-safe: a named function with an untyped parameter is mapped
     element-wise over a list argument (the declared `broadcastable<T>` contract
     of item 157), so a function that reads its list as a whole
     (`g(L) = L - mean(L)`) answers `[0, 0, 0, 0]` by reference and
     `[-1.5, -0.5, 0.5, 1.5]` expanded; `Apply` of the same lambda, or a
     `list<number>`-typed parameter, gives the whole-list value. The expansion
     is what gives a whole-list function its value, so Tycho keeps it. (2) A
     symbol ASSIGNED an unevaluated expression is re-evaluated on every read
     (measured 2026-09-18: three reads of `W + 1` with
     `W := Abs(PointX(L)) + Abs(PointY(L))` over 2 000 points, 430 ms; the same
     with the evaluated value assigned, 67 ms). That is the definition semantics
     of an assigned expression, not a defect; a caller that wants a value must
     assign the evaluated value. Sharing the value of structurally identical
     sub-expressions during one `evaluate()` (`expr.digest` as the key) remains
     the engine-side option that would help every caller.
   - Each element of each broadcast operator is computed by boxing a new
     canonical function (`mapAtCell` and the drain iterator in
     `library/collections.ts`, through `computeBroadcastCell`): operator lookup,
     type handler, operand descriptor, allocation. Measured: 30–40 µs per
     element for `Abs(PointX(L))`, 60–80 µs for `PointX(L) + PointY(L)`, 140–190
     µs for `Conjugate(PointZ(L) / (PointX(L) + i PointY(L)))`. The comment on
     `evaluateElementwiseSelection` (`library/control-structures.ts`) quotes
     about 8 µs per element per condition for the lazy broadcast `Map`; that
     figure must be measured again on a built bundle.

The compiled route does not take this body: Tycho's `javascript` compile of
`C_cf` declines at `Abs` ("cannot compile a broadcastable head over a possibly
list-valued operand", `base-compiler.ts`), because `C_c` carries a
`number | tuple` element arm in its declared type. That decline is the
`s8ishknvhe` bullet of "JavaScript list-arithmetic declines, triaged"; after the
`conj` release the interpreted route serves `C_cf`.

### An element-wise ordering relation compares a NaN operand where the scalar branch treats it as undecided (OPEN — found 2026-09-12 by the Codex review of the selection index push-through)

A scalar branch whose relation has a NaN operand is UNDECIDED: the interpreter
answers `Which(NaN < 2, 1, True, 0)` with `Missing`, and the JavaScript target
guards the operand (`_.b === _.b && _.b !== undefined`) and answers `NaN`. The
element-wise form of the same selection decides the position instead:
`Which([1, NaN, 3] < 2, 1, True, 0)` is `[1, 0, 0]` in the interpreter (the cell
`NaN < 2` evaluates to `False`) and in the compiled run-time selection (the
fused loop reads `NaN < 2` as `false` and takes the default). The element-wise
EQUALITY already marks such a cell absent (the compiled-equality absent marker
landed 2026-09-10), so `select` consumes the position and answers `NaN` there;
the ordering relations (`Less`, `LessEqual`, `Greater`, `GreaterEqual`) do not
mark it, in the interpreter's element-wise relation handler or in the JavaScript
emitter. The pre-pass index push-through of 2026-09-12 (`fixed-width-unroll.ts`,
`indexedOperands`) rewrites `Which([a, b, c] < 2, 1, True, 0)[2]` to the scalar
`Which(b < 2, 1, True, 0)`, so a NaN `b` now answers the undecided value (`NaN`,
`Missing`) where the element-wise form answered `0`. The rewrite is kept: the
scalar answer is the ratified undecided-condition contract, and the fix belongs
in the element-wise ordering relations — mark a cell whose operand is NaN
absent, as the equality does — after which the two forms agree and the pre-pass
note on `indexedOperands` can go.

### A shared subexpression inside a shader lazy operand with no statement position expands once per occurrence (OPEN — found 2026-09-13, narrowed 2026-09-13)

A boxed expression is a DAG: `Max(e, e)` holds `e` once. The GLSL and WGSL
targets bind such a shared node to a temporary through the common-subexpression
pass wherever a statement position exists. A conditional whose arm repeats a
subexpression now takes the statement form (`gpuArmSharesWork` selects it,
`compileGPUStatementSelection` emits it), whose captured branch is a statement
position where the shared node is declared once. What remains is a shared
subexpression in a lazy operand that has NO reachable statement position: the
right side of an `&&`/`||`, and a conditional nested where hoisting is refused —
inside another arm, or an expression-only position. There the pass binds nothing
and the operand's text unfolds the sharing. Both shader languages lack a scoped
let-expression, so closing this needs a restructure that lifts such an operand
to a statement, or the acceptance that a deeply shared lazy operand stays
inline. (A separate, pre-existing cost: the common-subexpression pass itself
runs super-linearly on a very deeply shared DAG — a depth-20 shared tower takes
tens of seconds to compile even with no conditional, its emission linear. That
is in the harvest, not the conditional lowering.)

### `Match` with a case body that needs statements still declines on the shader targets (OPEN — found 2026-09-13 by the review of the statement-form conditional)

`If`, `When` and `Which` on the GLSL and WGSL targets take a statement form when
an arm needs statements (a loop-form `Sum`/`Product`, a `Block`, a `Loop`):
`compileGPUStatementSelection` in
`src/compute-engine/compilation/gpu-target.ts`. `Match` lowers through the
shared `compileMatchTernary`, whose case bodies are compiled by
`compileGPUConditionalArm` alone, so a `Match` whose case body holds a loop-form
`Sum` declines as every conditional arm did before the statement form existed.
The fix is to give `compileMatchTernary` the same statement form: the case tests
become the conditions and the case bodies the arms, under the same gate (no
effect in a case, no write outside the cases at the statement position). No
document of the code-generation audit has the shape; the entry records the
reachable decline.

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

### The capability registry has handlers for `console` and `entropy` only (OPEN, effects, on demand — opened 2026-09-18)

`ce.effects` (the host capability registry, Stage 4 of `docs/EFFECTS-MODEL.md`)
holds two handlers: `console` (`Print`/`Input`) and `entropy`
(`RandomExpression`, and every random operator evaluated outside a
`WithRandomSeed` frame — the stated exception to the coupling rule, ruled
2026-09-18). The specification names four more: `network`, `filesystem`, `time`,
`environment`, and the `random` draw kernel. They were left out deliberately —
no library operator would read them, so a host could install an override and
nothing would change — and each is to be added with the first operator that uses
it.

- **`random`.** The seeded draw kernel `draw(seed, n)`, captured at frame entry,
  with compile declining for an expression that carries `random` while a
  non-default kernel is installed. Unframed draws are `entropy` now, so the
  kernel is only about replacing PCG3D under a frame.
- **`time`, `network`, `filesystem`, `environment`** have no operator yet. The
  first `network` operator (`Fetch`) is also the first operator that returns a
  promise, and it starts the admission of the `async` label.
- **Compiled code** draws through `_SYS.drawNextRandomNumber()` → `ce._random()`
  and, for the Monte-Carlo integrals, through the engine-bound
  `ce._liveRandom()`, so a mocked `entropy` handler applies to it, but a DENIED
  handler makes a compiled function THROW `CapabilityDeniedError` at run time
  (compiled code has no error-value channel, `docs/ERROR-MODEL.md` §6). A
  compile-time decline for a `random`-bearing expression under a denied
  `entropy` handler would fail closed instead; not built until a host asks.

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

### Deeply nested parentheses: the parser recurses, and the foreign-object walk is quadratic on a deep raw tree (OPEN, pre-existing — found 2026-09-22 and 2026-09-25)

A chain of `Delimiter` wrappers boxes to its operand at any depth since
2026-09-25 (`canonicalDelimiter`, `library/core.ts`, removes consecutive
parenthesis wrappers iteratively; `boxing-deep-trees.test.ts`), and the walk
that looks for objects owned by another engine (`containsForeignEngineObject`,
`boxed-expression/type-guards.ts`) uses an explicit stack. Three things stay:

- The LaTeX parser's own recursive descent
  (`parseEnclosure → parsePrimary → parseExpression`) throws at about 1,870
  nesting levels. Unreachable from realistic input; a parser change.
- Once any object exists in the session, boxing a raw deep tree runs the
  foreign-object walk at every level, and its memo lasts for one adoption only,
  so the cost is quadratic in the depth (measured 2026-09-25: a raw `Sin` nest
  of 2,000 levels 1.4 s, 5,000 levels 4.4 s, 10,000 levels 17 s; before the fix
  the walk overflowed the stack instead). A per-engine cache of nodes already
  found clean would make it linear; a design change.
- `.toString()` and `.evaluate()` on a NON-canonical `Delimiter` chain 5,000 or
  more levels deep still overflow (the canonical route no longer produces such a
  chain; a raw-boxed chain that is serialized before canonicalization reaches
  it).

Also found 2026-09-25, a decision: a `Delimiter` whose delimiter is not a
parenthesis (`'[]'`) is canonical while its operand is the RAW operand, not the
canonical body the handler computed
(`ce.box(['Delimiter', ['Add', 1, 2, 'x'], "'[]'"]).op1.isCanonical` is
`false`). The handler's comment says delimiters are left uninterpreted so other
operators can read them, so this may be intended; if not, changing it touches
snapshots.

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
(A declared-only overload set declining a named call whose name-eliminated arm
is more specific is RULED correct behavior, 2026-08-13: the engine asks the
author to be explicit rather than guessing, design doc §4. What still declines
through `Apply` is a callee whose names are genuinely not knowable there: a
symbol callee (`Apply(f, x: 1)` — write `f(x: 1)`), and a literal with a
parameter that is not a bare symbol or `Typed` annotation.)

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

The capability half is closed (2026-08-14, user-ruled): past the differentiation
growth budget the javascript compile emits an 8th-order centered-difference
stencil (`_SYS.nd`) and interpreted `N()` computes the same shared function,
bit-identical across routes (`compile-derivative-numeric-fallback.test.ts`).

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

### Static argument-checking of user-defined callees — residue

Static checking of calls to `function` definitions landed 2026-08-12
(`DefineFunction`'s canonical handler installs the clause once the body has
canonicalized, so later statements of the same program validate against the real
signature; `CHANGELOG.md`). Two cases stay unchecked until they evaluate:

- **Generic definitions.** Rule G2 refuses any clause onto a generic target,
  which makes the install non-repeatable, and the evaluate route would then
  reject its own re-installation. Closing that exclusion means deciding which
  route OWNS the clause install, so the second one can recognise its own work
  rather than re-running it. Worth doing together with anything else that wants
  canonicalization and evaluation to share an installation step.
- **An ALIAS of a binding that holds a function literal**
  (`let k = (n: integer) => n + 1`, `let g = k`, then `g(1.5)`), because the
  pass pins a signature only from a function LITERAL (`registerPinnedSignature`,
  `src/epsil/static-diagnostics.ts`) and an alias's static type is an upper
  bound, not the signature the binding will hold.

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

### Contextual callback typing residue (Design D landed 2026-08-09)

The `callback<S>` conversion of the 15 collection operators closed with these
items open. Items marked RULED-DEFERRED have a maintainer decision on record;
the rest are recorded here so they are not rediscovered from the outside.

**Deferred by ruling (each names what unblocks it):** RULED 2026-09-22 (a):
desugar to one conformance edge per variant with `Self` the variant; a variant
added later re-runs the conformance; a per-variant duplicate is an error.

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

**Cleanups (opened 2026-08-09):**

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

Until 2026-07-30, "which heads have no lowering on which target" was tracked
nowhere in this repo — it lived only in the consumer's census markdown, so every
gap was rediscovered from the outside. This is the ledger. It was sized by an
external corpus (Tycho's 684-document Desmos corpus at CE 0.99.0; the entry
"Code-generation census on CE 0.128.13" above carries the current counts), so
the `members / states` counts are a proxy for demand from one workload, not a
ranking of importance. A compile decline is not a slow path — the consumer's JS
wrapper installs a `() => NaN` stub, so a declining row **draws nothing**. Treat
these as correctness gaps with a performance-shaped symptom. It is a ledger, not
a work item: scope a session to one entry, and give a design-first entry (the
`Integrate` row) a design pass before an implementer touches it. The landed
rounds of 2026-07-30 to 2026-08-30 that this ledger used to narrate are in
`CHANGELOG.md` and git history.

**JavaScript band.**

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

- **Multi-clause user functions** (feature-parity note, 2026-08-02, no corpus
  sizing yet): the §8 guard chain compiles on the **JavaScript target only**.
  The interval, GLSL/WGSL and Python targets decline the whole function (fail
  closed, interpreted fallback). Interval needs interval-aware guards; the
  shader targets need a monomorphized (per-call-site arity) lowering since they
  have no variadic dispatch.

- **Generic user functions: what still declines.** The bound reading landed
  2026-08-30 (a quantified parameter is read at its DECLARED BOUND, at the call
  boundary and in the body, on the engine and block-local routes alike;
  `test/compute-engine/compile-generic-monomorphization.test.ts`). Per-call-site
  monomorphization was rejected, not deferred: it would reintroduce the
  `$`-suffixed specializations retired 2026-08-16 and has no call site on the
  value-position route.

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

**GLSL/WGSL band** (the GPU→CPU demotion class).

- **`Integrate` on glsl — design question first.** Quadrature inside a shader:
  which rule, what iteration budget, what happens on non-convergence. Large; do
  not start without deciding the budget question. The one design-first entry
  left from the 2026-07-30 triage (22 states in the 0.99.0 census).
- **`At` on GPU — residue after the 2026-08-01 landing** (scalar-index and
  literal-gather tiers over statically-sized numeric bases shipped; design and
  rulings in `docs/COMPILATION-MODEL.md`, whose D4 disposition table is not to
  be re-derived):
  - **Point-list bases: blocked on §3.F** (the node types `missing | tuple` and
    the object-domain-absence gate intercepts before any GPU table entry).
    Unblocking needs its own ruling: a per-operator absence projection (Missing
    point → NaN-component vector), or in-range type narrowing. Filed with the
    consumer item.
  - Demand-gated: static-count dynamic gather (near-zero cost to flip — the same
    helpers in a constructor; witness count requested from the consumer), gather
    K > 4 (width ceiling), gather K 0/1 (the pinned 1-element-list contract has
    no shader shape), dictionary/string-key/ multi-index forms.
  - Permanent (not TODOs): runtime-valued boolean masks (result length is not
    static — no shader value shape), unknown-length bases/index lists.
  - Latent observation from the round (own look, out of scope):
    `BaseCompiler.isComplexValued` answers `true` for a literal `List`
    containing one complex element, skewing `aggregateComponentCount` for other
    callers.
  - No retirement of the 26-state count without the consumer re-measure.

- **`PointList`/`PointZ` — residue after the 2026-07-31 landing** (rulings in
  `docs/COLLECTIONS-MODEL.md`; GPU _construction_ stays fail-closed **by
  ruling** — no runtime-length GPU expression values). Remaining, all
  demand-gated:
  - Non-`isListType` components (tuple/set/union-with-collection) still decline
    on JS — lowering is deliberately narrower than typing (no per-point
    representation for such a slot).
  - The **type handler's** `isListType` (`collections.ts`) classifies a bare
    `tuple`-typed or all-collection-union component as a list — so
    `PointList(k, P)` with `P: tuple` _types_ `list<tuple>` while `evaluate`
    (value-level `isTuple`) answers a single point. The compile predicates were
    hardened against this (staged review 2026-07-31); aligning the type handler
    is interpreter-visible and wants its own pass. Same-family holes, same pass:
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
    closed is the consumer's count to re-run — do not mark this bucket resolved
    on our numbers.

- **A complex literal under a NON-CANONICAL parent miscompiles**
  (`ce.box(['Add', 1, ['Root', -4, 2]], {canonical: false})` runs to the string
  `"1[object Object]"`), because the constant fold produces a complex literal
  while the unbound parent's `isComplexValued` is `false`. Canonical and
  structural routes are correct. Recorded 2026-07-30 so it is not rediscovered
  as new.
- **Still open from the GPU invalid-source sweep** (the unary fan-out and the
  generic function-codegen paths were closed 2026-07-30 with
  `gpuIsComponentwise` / `gpuOperandShape` / `gpuCheckOperandShapes`, whose
  per-language shape tables default to their intersection so a new subclass
  fails closed):
  - **The infix `target.operators` path is unhooked** — the hottest shared path,
    deliberately not gated. `Matrix` and list-_typed symbols_ report
    `isCollection === false` and so route through it:
    `Add(P: vector<real^3>, Q: vector<real^2>)` still emits `P + Q`, and WGSL
    `Add(Matrix, 2)` emits `2.0 + mat2x2f(…)` (invalid WGSL, valid GLSL). Gating
    it is a perf-sensitive change and wants its own scoped pass. The JavaScript
    witness `Add(Sin((1, 2)), 1)` (a runtime STRING from the `+` operator over
    an array-valued operand, found 2026-08-30) no longer reaches the compiler:
    canonicalization folds it to `Error(incompatible-type, tuple, number)` and
    the compile falls back (re-measured 2026-09-08). The gap remains for typed
    SYMBOLS, which canonicalization cannot fold.
  - **Complex-element collections** — `gpuOperandShape` reads a list of complex
    elements as `scalar` (via `isComplexValued`'s operand fallback), so the
    generic gate is inert for them. The fan-out path declines them explicitly;
    the generic path needs a separate complex-element rule.
  - **Argument POSITION within a builtin signature is not modelled** — GLSL
    `step(float, genType)` takes its scalar first, `mod(genType, float)` last,
    so a wrong-position scalar (`mod(float, vec3)`) is admitted. Deliberate
    conservatism; tightening needs per-builtin arity/position tables.

  - `Product`, `LCM` and `GCD` over a run-time vector still need their own
    lowering (not re-measured since 2026-07-30); `Sum` over a static vector
    compiles and `Length` declines by design (measured 2026-09-21).

**Standing sweep — audit the other compile-time refusals for the same
inconsistency.** The `realOnly` constant-fold refusal (retired 2026-07-30:
`Sqrt(-N)` folds to the complex value, or to `NaN` under `realOnly`, on every
target) was not a one-off, it was an instance of a class: _a deliberate refusal
enforced at some sites but not at the sibling sites_. A rationale comment and a
passing test establish **intent**; neither establishes **consistency**. The
check is cheap — for each refusal, probe the same mathematical situation reached
a different way (via a variable, an assigned symbol, a different head in the
same family, a different target) and see whether it is refused there too.

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

- The `Multiply` ≥2-arrayish carve-out and the complex-element deferral —
  preserved verbatim through the broadcast rework, never re-examined.

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

**Follow-ups from the 2026-07-30 review round** (each found while fixing
something else; none is a regression):

- **`Power`/`Root` still yield `NaN` where the interpreter returns a complex
  value.** This is the ratified `finite_number` policy, not a defect, but it is
  the same user-visible surprise the `realOnly` retirement removed for `Sqrt`.
  Resolvable only by making those type handlers track the negative-base /
  fractional-exponent case — which would then let the emitter fold them complex.

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

_Unverified, recorded so it is not lost:_ a decline thrown mid-compile may not
unwind `BaseCompiler._localVector` / `_localComplex` if those pushes are not
`finally`-protected, which would let one fail-closed throw leave stale frames
for later compilations in the same process. **Probed and could NOT reproduce**
(three declines between two identical compiles gave byte-identical output), and
every existing GPU decline throws the same way, so it is pre-existing if real.
Worth a `finally` audit rather than a bug hunt.

**Needs a witness — cannot classify without seeing the consumer's shape.** Ask
before building; the compiled _meaning_ is genuinely unclear.

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

**Interval-js band:** the domain is deliberately scalar — one interval per
quantity — so a collection-valued condition or operand declines by design beyond
the provable-list lowerings of 2026-09-15 (entry "Collection values on the
interval target").

**Caveat on the numbers throughout this section.** They come from a single
consumer's Desmos-derived corpus. That is the only population data we have, and
it is genuinely informative, but it is one workload: a head that is rare there
may be common elsewhere, and prioritizing strictly by these counts over-fits CE
to one consumer. Treat them as evidence of _demand_, not as a ranking of
_importance_.

**Ruled, not gaps:**

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

**Driver determinism (2026-09-23):** the driver gives up after a step budget
(300,000 steps per integral, `RUBI_STEP_BUDGET`), not after a time, and its two
sub-searches (the native rational fallback, the clean-up simplify) have step
budgets of their own. On seeded samples of chapters 1 to 7 the outcomes of all
1,400 problems were the same as under the former time budgets, and the step
counts were the same from run to run under different loads. What still depends
on the clock is listed in the entry "Big-decimal coefficients grow to thousands
of digits in the polynomial GCD of a Rubi simplification". (Two independent
budgets trap: `loadIntegrationRules(ce, { stepBudget, timeLimitMs })` is
independent of any `withTimeLimit` span — a heavy test must raise the loader
budget and arm a long enough span.)

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

#### P1. Symbolic evaluation still 1.2–1.5× slower than 0.118.2 after the 2026-09-05 fix (OPEN, perf — residual)

Found while regenerating the CHANGELOG benchmark tables for 0.124.0: against the
same Mathematica baseline, the symbolic ratios of the current build were about
half of those published with 0.116.0, while the 200-digit numeric rows were
unchanged. Timing each published bundle and the current build in ONE warm
process (`benchmarks/runners/run_ce_rubi.mjs` with `CE_PUBLISHED_BUNDLE` pointed
at each release; the bundles for 0.116.0 through 0.123.2 are provisioned under
`benchmarks/.competitors/`) showed the slowdown accumulated in steps at 0.119.0,
0.120.0, 0.121.0 and 0.122.0 — 1.7–2.8× in total on simplification, integration,
definite integrals and solving.

**Fixed (2026-09-05, shipped in 0.124.1; the CHANGELOG entry describes it):**
three causes, found with CPU profiles of unminified bundles of the release tags
diffed function by function. (1) `BoxedNumber._computeLiteralType` read
`bignumRe` — a working-precision square root for a radical — on every fresh
exact literal, twice (exactness test, enclosure); the exactness test no longer
reads it and `literalEnclosureType` works from the double `re`. (2) The directed
decimal rounding of every derived range bound (`finalizeInterval`) and of the
enclosure ran through `BigDecimal`; `roundSignificantToward`
(`numerics/interval-arithmetic.ts`) does it in double arithmetic, bit-identical
to the decimal route (pinned by
`test/compute-engine/round-significant-toward.test.ts`). (3) `factsFromType`
computed the collection facts (two `provablyDisjoint` proofs) whenever a handler
asked only for finiteness, and the `typeFact(…) === true` probes across the
library paid a `provablyDisjoint` on their `false` arm for an answer they never
read; the facts are per-fact now and the probes are `isSubtype` tests. Plus
cheap first checks in `provablyNaNOperand`, `isExtendedRealOperand`,
`isTensorOperand`, `isNumericTuple` and `isTuple`.

**What remains** (µs per call, one warm process per build, interleaved runs,
median of 50; box load 1.5–2.5):

| Case                 | 0.118.2 | 0.124.0 | fixed | fixed ÷ 0.118.2 |
| -------------------- | ------: | ------: | ----: | --------------: |
| box `√6x + √2x`      |      60 |     147 |    79 |            1.32 |
| simplify `√6x + √2x` |     716 |    1526 |   957 |            1.34 |
| simplify `√(3+2√2)`  |     194 |     360 |   225 |            1.16 |
| solve `x⁴+x²−1=0`    |    4940 |    8540 |  5950 |            1.20 |
| `∫1/(x³+1)dx`        |    2380 |    4740 |  3120 |            1.31 |
| `∫₁² 1/x dx`         |     163 |     301 |   242 |            1.48 |

The residual is diffuse — no single function above 3 % of a call. Per-function
self-time diffs of the fixed build against 0.118.2 (simplify case, µs per call)
name: garbage collection +18, `isSubtype` +15, the memoized type derivation of
function nodes (`type`/`compute`/`cachedValue`) +12, `structureOfExpression` +8,
`addTypeOnTypes` with `foldIntervalsOfTypes` / `finalizeInterval` +8,
`get finite` +5, `sortProductOperands` +4, `isSame` +3. Two structural sources
behind those numbers: the type derivations that the `Add`/`Multiply`
canonicalization forced on every intermediate product and sum through `isTuple`
/ `isNumericTuple` (a quarter of a simplify call), and the allocation per
derivation (a descriptor and its facts object per operand, a structure view per
`structureOf()` call, an interval per fold, a fresh literal type per fresh
literal).

**Forced derivations removed (2026-09-06, shipped in 0.124.2; the CHANGELOG
entry describes it).** `isTuple` / `isNumericTuple` now answer from the operands
for an arithmetic application (`SCALAR_LIFT_HEADS` in `collection-utils.ts`:
tuple-shaped only when an operand is), the evaluate-time NaN gate no longer asks
an application (`isNaN === true` is never its answer), the runtime conformance
check declines a symbolic operand before reading its type, and
`nonNumericOperandError` skips literals and `number`-typed operands. With
`isSubtype` fast paths and four smaller cuts: 5–12 % less time per call on
simplify, solve and the indefinite integral; boxing and `∫₁² 1/x` unchanged.
Measured with the lock held at box load 3–5, five interleaved rounds, medians
(µs per call):

| Case                 | 0.118.2 | 0.124.1 |  now | now ÷ 0.118.2 |
| -------------------- | ------: | ------: | ---: | ------------: |
| box `√6x + √2x`      |      41 |      45 |   44 |          1.07 |
| simplify `√6x + √2x` |     234 |     292 |  279 |          1.19 |
| simplify `√(3+2√2)`  |      85 |      95 |   87 |          1.02 |
| solve `x⁴+x²−1=0`    |    2475 |    3165 | 2859 |          1.16 |
| `∫1/(x³+1)dx`        |    1985 |    2661 | 2393 |          1.21 |
| `∫₁² 1/x dx`         |     173 |     221 |  220 |          1.27 |

**What remains** is the cost of a derivation itself and its allocation. A fresh
`Add(x, y)` / `Power(x, 2)` / `Multiply(√6, x)` node types in 2.3 / 2.8 / 3.3 µs
against 1.2 / 1.1 / 2.5 µs on 0.118.2 (micro-benchmark on `ce._fn` nodes, 20 000
each), and no single line of the derivation carries it: the handler call
(Add/Multiply/Power handlers with their interval folds) is ~0.4 µs, the
function's own body ~0.5 µs (closures, descriptor array, the missing-absorption
and broadcast scans over the operands), then `skipBroadcastForVectorOps`,
`provablyNaNOperand`, `isExtendedRealOperand`, `broadcastsOverTuples` at 0.1–0.2
µs each. The solve case's per-function self-time deltas against 0.118.2 (µs per
call) are led by garbage collection +160, then `roundSignificantToward` +70 (now
cut for integer bounds), `get re` in `getImaginaryFactor` +45,
`makeNumericFunction` +38, `replace` +32, `provablyNaNOperand` +31,
`structureOfExpression` +28, `factor` +27, `canonicalPower` +26, the derivation
body +26, `broadcastsOverTuples` +25 (now a set lookup), `isPrimitiveSubtype`
+24, `makeNumericValue` +22, `addTypeOnTypes` +22, `_BoxedExpression` +22 (more
nodes built), `finiteFromType` +21. The definite integral's gap is in boxing,
not evaluation: `makeCanonicalFunctionCore` 110 vs 81 µs,
`applyOperatorDefinition` 63 vs 48, with `hasSignatureArm`, `reduceUnionType`
(under `widen`), `recordTypeProvenance` and `_withoutFacts` new since 0.118.2 at
1–3 µs each. The next round is designed in
`docs/plans/2026-09-06-type-facts-per-type.md`: an instrumented count shows that
the volume is not the derivations (146 per solve call) but the questions asked
of types afterwards (4 389 subtype queries over 1 121 distinct pairs, 1 818 type
reads), so the facts a type has are to be computed once per type value and read
by every predicate. Levers after that: a per-value literal-type cache (the same
rational or radical value boxes to the same type object), a descriptor pool, and
a memo of `broadcastsOverTuples` / `broadcastableParamSlots` per definition.

**Literal types are not the lever (measured 2026-09-06, box load 2.7, three
interleaved rounds, medians).** Four retreats from the literal-tier types were
timed against the shipped 0.124.1 build on the same six probes, and the fourteen
type-related test suites were run under each to count the proofs lost: replacing
the enclosure of a non-machine-exact literal (`real<2.4..2.5>` for `√6`) by the
open sign range `real<0<..>` changes NO timing (79 / 953 / 6210 µs on box /
simplify / solve, identical) and fails 15 pins; typing such a literal by its
bare tier fails 16 pins for 5–10 %; keeping value types for integers only fails
27 pins for the same 5–10 %; and dropping literal types altogether fails 81 pins
for 10–18 %, at most a third of the remaining gap to 0.118.2. The capability
lost is concrete: `arcsin(1/3)` and `artanh(1/3)` type `complex` instead of
`real` without the enclosure, `arcsin(0.5)` needs the value type of a
non-integer, and `1/(x + 1/3)` with `x: real<0..1>` loses its bounds. Decision:
keep the literal-tier types as they are; the residual lies in the derivation of
function nodes, above.

**Shared type facts and boxed handler results implemented (2026-09-06, shipped
in 0.124.3).** `OperatorTypeHandlerOnTypes` now returns `BoxedType | undefined`.
Immutable types share lazy proofs, intervals, normalized boxes, and equal
numeric value/range identities. Mutable types and aliases keep live reads;
literal precision and derived bounds are preserved. Two warm, interleaved
comparisons against 0.124.2 reduce time by 14–16% on `√6x + √2x` simplification,
7% on solving `x⁴+x²−1=0`, 9% on `∫1/(x³+1)dx`, and 25% on `∫₁² 1/x dx`. Boxing
improves 5–8%, nested-root simplification 3–4%, and the ranged-product type
control 44–46%. Subtype queries fall 871 → 26 / 4 243 → 333 / 4 491 → 392 on
simplify / solve / integrate, while descriptor counts are unchanged. The
measured setup and raw results are in
[`docs/plans/2026-09-06-type-facts-per-type.md`](docs/plans/2026-09-06-type-facts-per-type.md#measured-outcome).
P1 stays open: the next experiment is a scalar arithmetic dispatch path; the
historical gap to 0.118.2 has not been remeasured in this round.

Reproduce a measurement with
`CE_PUBLISHED_BUNDLE=<bundle to compare> node benchmarks/runners/run_ce_rubi.mjs`:
it times the published bundle and the current build
(`dist/esm-min/compute-engine.js`, so build first) on the whole case set in one
warm process — one shared engine per build, a warm-up pass, then the median of
up to 50 timed calls per case — and prints one JSON line per (engine, case);
compare the `ce-pub` and `ce-current` lines of a case. Take the box lock: the
numbers are meaningless under load.

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

- **Simplification gaps** — 12 `test.skip` in `simplify.test.ts`, with rationale
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
  (`canonical-form.test.ts` `@fixme`), and for the same reason every complex
  result of `N()` has machine precision whatever `ce.precision` is: at the
  default 21 digits `N(√2)` is `1.4142135623730950488` but `N(√−2)` is
  `1.4142135623730951i`, and `N(ln(−2))` has 16 digits in each part (the
  imaginary part of a numeric value is a JavaScript number, and complex
  arithmetic runs on doubles; found 2026-09-23, not documented in the
  numerical-evaluation guide); one `Multiply` inexact case where the
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
them before blaming the change under test. Added 2026-09-22:
`elementwise-which.test.ts` "perf smoke › the 3-clause × 900-element witness
evaluates promptly" — a canary-normalized timing assertion (limit 5000 canary
units) read 6251 in a six-worker full run on a box at load 4 and passed alone
(70 of 70), while the same tree's other timing pins held.
