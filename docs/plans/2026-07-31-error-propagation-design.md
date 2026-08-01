# Error, NaN, Nothing: propagation through application and `|>` (design)

**Status:** design 2026-07-31; **all four §8 rulings RATIFIED by the user
same day** — (1) rung-2 scope = application/`|>` only, operators stay
inert until rung 3; (2) `Nothing` = argument-list erasure, route parity;
(3) `IsError(expr)` holding its operand; (4) `cortex check` owns
canonicalization-time type errors as diagnostics. Rungs 1–2 + ruling 2 +
ruling 4 in implementation as of 2026-07-31. **Rung 3 landed the same
day** (operator-level bubbling + the `ErrorTrace` breadcrumb of §2a, the
collection carve-out of §6b, the `inspectsErrors` widening and the
`Assume` errors-as-values fix of §8a). One spec refinement fixed at
implementation kickoff: an
application operand whose evaluated value *embeds* an error (an invalid
frozen tree like `Error(…) + 1`, not just an `Error`-headed value)
bubbles its **first embedded error** — otherwise rung 2 would not cover
the motivating `("a"+1) |> f` case until rung 3. **Scope:** (1) what a strict operation does when an
operand is an `Error` value, (2) whether `|>` should short-circuit — and on
what, (3) the `Nothing`-in-argument-position asymmetry, (4) reconciliation
with `docs/EFFECTS-MODEL.md` (whose "Rejected: `error`/partiality" section
this design depends on and repairs). Prior art consulted: Hica pipes +
`?`/`and_then`, F#/Elixir/OCaml pipes, Rust `?`, Swift optional chaining,
IEEE-754 NaN semantics, Mathematica `$Failed`.

## 1. Current behavior (probe-verified 2026-07-31)

| Input | Result today |
|---|---|
| `("a"+1) \|> f \|> g` | Frozen inert tree `N(Apply(f, …Error…))`; `f`/`g` bodies never run (counter probe: 0 calls) |
| `f("a"+1)` | Frozen inert `f(…Error…)` — same as pipe (routes agree) |
| `match ("a"+1) { _ => "rescued" }` | **Inert `Match(…)`** — the `_` case never fires |
| `if err == 3 { … }` | Inert `If(…)` |
| `Type("a"+1)` | `"error"` — works (holds its operand) |
| `IsError(…)` | Does not exist (inert unknown call) |
| `NaN \|> f` | `f` runs, receives NaN (counter probe: 1 call); `NaN + 1` → NaN (IEEE) |
| `Nothing \|> (x \|-> x + 1)` | `1` — applied with the argument erased |
| `f(Nothing)`, same lambda | The lambda literal, **unapplied** — routes disagree |
| `xs[10]` | Silent `NaN` (not an `Error`) |

The taxonomy behind the design: the engine has four distinct states that
today share representations —

- **insufficient information** (symbolic residual): `Sin(x)` — may become
  evaluable later; inertness is a promise of potential progress;
- **definite failure**: `Error(…)` — will *never* become evaluable;
- **absence**: `Nothing` (erasure) / `Missing` (position-preserving);
- **numeric indeterminate**: `NaN` — a *member of the number domain* with
  IEEE-defined propagation.

The soundness smell is that definite failure is currently expressed by
borrowing the insufficient-information state: `f(err)` freezes like
`Sin(x)`, though nothing can ever unfreeze it. That conflation is what
makes errors unobservable — every inspection tool (`match`, `If`, `==`) is
strict, so the poison spreads faster than anything can look at it.

## 2. Design: error is an absorbing element under strict evaluation

**Core rule.** For any operator that evaluates an operand strictly (i.e.
the operand is not held/lazy for that position): if the operand's evaluated
value is an `Error`, the whole application evaluates to **that error
value** — not to a frozen tree. Algebraically `f(⊥) = ⊥`: error is the
absorbing element of strict evaluation. This is a *value* rule (strictness),
not control flow — no early return, no bypass channel, no new operator
semantics.

**What stays strict.** The function body still never sees the error — the
NaN treatment (flow in as a value) would be unsound for errors: an error
inhabits no domain, and a body computing `x == 5` → `False` on it would
take a wrong branch silently. Bubbling has the same "body never runs"
guarantee as today's freeze; only the *result* changes (the bare error
instead of the frozen application).

**Observers are non-strict, and explicitly so.** The escape hatches are
operators that hold the relevant operand — exactly the mechanism that
already makes `Type(err)` work:

- **`Match` decides on error subjects** (restores its pinned "always
  decides" totality — an error subject structurally fails literal/shape
  cases and falls to `_`, a binding, or a typed pattern). This is the
  rescue construct; no new control flow is needed.
- **`IsError(expr)`** — new predicate, holds its operand, returns
  True/False. (With Match + `Type` it is technically redundant; it exists
  for discoverability and guard ergonomics.)
- `Type`, `Hold`, serialization — unchanged, already non-strict.

**Provenance.** An `Error` node already carries the offending subexpression
as payload. Bubbling loses the *surrounding* frozen context; where that
matters (see the display trade-off, §6 rung 3), the payload can grow a
breadcrumb — out of scope for rungs 1–2.

## 2a. The breadcrumb: `ErrorTrace` (rung 3, landed 2026-07-31)

Bubbling loses the *surrounding* frozen context — the operator chain from the
failure site to the root, and the sibling values already computed (§6a). The
ratified middle ground is a **breadcrumb**: the bubbled `Error` carries the
chain of `(operator, operand index)` frames it passed through, so a host
(Tycho) can still say *where* the failure sits. v1 carries the chain only;
sibling values are deliberately not carried (the expensive half).

**Shape.**

```json
["Error", <code>, <where>?, ["ErrorTrace", ["ErrorFrame", "'Ln'", 1],
                                            ["ErrorFrame", "'Add'", 2]]]
```

- The trace is the **last** operand of `Error` and is identified by its
  `ErrorTrace` **head, never by position**. An error that never bubbled keeps
  its historical 1- or 2-operand shape byte for byte; a traced error whose
  `where` slot is empty is `["Error", code, ["ErrorTrace", …]]`, so any
  consumer that reads operand 2 as the context must skip an `ErrorTrace` there
  (`errorWhere()` does).
- Each frame is `["ErrorFrame", <operator name : string>, <operand index :
  1-based integer>]`.
- Frames read **innermost first** — from the failure site outwards — and
  accumulate across hops: the structural walk that finds the embedded error
  contributes the frames inside the operand, then the bubbling node appends
  itself. Rung-2 user-function bubbling pushes frames through the same path
  (`f("a" + 1)` → `ErrorTrace(ErrorFrame("Add", 1), ErrorFrame("f", 1))`).

**Why this shape.** Three constraints drove it: the breadcrumb had to be
expression structure (metadata is stripped by `box()`, so it would not survive
a round trip); the historical `Error` shapes had to stay byte-identical when
nothing bubbled; and `Error(c) => c` destructuring had to keep working. A
distinctly-headed trailing operand satisfies all three — an `ErrorTrace` node
cannot be confused with a code or a context, so every existing reader can skip
it positionally, and `match` strips it before handing the subject to the
pattern matcher (the breadcrumb is provenance, not payload).

**Display stays compact.** `toString()`/AsciiMath and the LaTeX serializer
render a traced error exactly as an untraced one — the breadcrumb is data, not
display noise. It is reachable from `.ops`/`.json`, or through the helpers in
`boxed-expression/error-value.ts`: `errorTrace()`, `errorFrames()` (decoded
`{operator, index}[]`), `errorWhere()` and `errorOpsWithoutTrace()`.

**How a host reads it.** From MathJSON: take the last operand of the `Error`
node, check its head is `ErrorTrace`, and read each `ErrorFrame`'s string +
integer. `src/cortex/execute-cortex.ts` does exactly that (it cannot import the
engine) and renders `in Ln argument 1, in Add argument 2` as `%1` of the
`runtime-error` diagnostic, alongside the existing statement-range anchoring —
that anchoring **is** the source-span half of breadcrumb v1. Engine trees carry
no spans, and none were invented.

## 3. The `|>` question: the pipe must remain application sugar

The tempting model — "`|>` short-circuits on NaN/Error/invalid, so
`NaN |> f |> g` returns NaN without invoking `f` or `g`" — was considered
and is **rejected in that form**, for one structural reason and one
marker-specific reason each.

**Structural: never break `x |> f ≡ f(x)`.** The pipe is pinned as
application sugar (`Pipe evaluates via apply()`). If `|>` gains failure
semantics that plain application lacks, the two spellings of the same
program diverge, and refactoring between them silently changes meaning.
No mainstream pipe does this (F#, Elixir, OCaml, Hica are all plain
application; railway behavior always lives in a *distinct* construct —
Hica's `?`/`and_then`, Elixir's `with`). The right way to get pipeline
short-circuiting is therefore to change what **application** does with an
error operand (§2) — then `err |> f` → err *and* `f(err)` → err, and the
equivalence is preserved by construction. The user-visible effect on `|>`
chains is exactly Hica's early-exit, without the pipe ever becoming a
special operator.

**NaN must not short-circuit — anywhere.** Three independent arguments:

1. **The only functions it would skip are the ones that must run.** For
   arithmetic `f`, `f(NaN)` is already NaN by IEEE propagation — the
   short-circuit changes nothing. The *only* observable difference is for
   functions that inspect their argument: `IsNaN`, `Type`, `String`,
   `x |-> if IsNaN(x) { 0 } else { x }` (the gap-handling idiom every
   plotting/data pipeline needs). A NaN short-circuit makes precisely the
   rescue idiom impossible — `sample() |> rescue` would return NaN without
   consulting `rescue`. This recreates for NaN the unobservability bug
   this design exists to fix for errors.
2. **NaN is a number.** It inhabits the domain; a function on numbers is
   entitled to receive it. Skipping the call is a type-level lie.
3. **Not faithfully compilable.** A short-circuiting pipe needs a NaN
   check per stage in compiled code — per-stage branches on hot GPU paths,
   and NaN self-comparison checks are exactly what fast-math drivers break
   (cf. the macOS ANGLE fast-math incident). The interpreter/compiled seam
   would leak.

**"Invalid" rides with Error.** An expression with an embedded validation
`Error` is the error case above; no separate rule.

## 4. `Nothing`: one erasure ruling, and no optional chaining on `|>`

Today's route asymmetry is literally two readings of "erasure":
`Nothing |> f` erases from the **Apply argument list** (→ `f()` → body
runs, argument gone → `1`), while `f(Nothing)` currently ends up returning
the lambda literal unapplied. **Ruling needed; recommendation:** erasure
applies at the *call argument list* uniformly — both routes become `f()`
and behave per the nullary-application contract. (What `f()` does for a
parametered lambda is the existing nullary contract's business, not this
design's.)

Swift-style optional chaining (`Nothing |> f` → Nothing, skipping `f`) is
**rejected for `|>`** on the same structural ground as NaN — and on the
model's own terms: `Nothing` is *erasure*, not failure; a skip-and-return
semantics would quietly turn it into a Maybe-None, colliding with the
ratified `Nothing`/`Missing` split. If optional-chaining ergonomics are
ever wanted, that is a distinct operator (`?>` or similar) over `Missing`,
designed on demand — not a meaning change to `|>`.

## 5. Reclassify static failures out of the runtime channel

`"a" + 1` is detectable at canonicalization — it is a *static* type error
that today masquerades as a runtime value. Hica's runtime `Result` story
stays clean because its type checker eats this class at compile time. Our
equivalent: **`cortex check` (and the check phase of run) reports
canonicalization-time type errors as diagnostics**, reserving the
error-value machinery for genuinely dynamic failures (`match-no-case`,
iteration limits, runtime domain violations, user-constructed errors).
This shrinks the population of runtime errors precisely to the ones worth
rescuing.

## 6. Staged plan

- **Rung 1 (small, unblocking):** `Match` decides on error subjects +
  `IsError`. No display change; restores a pinned invariant; unblocks the
  `if let` refutable-binding design (which lowers onto Match with
  `!error`-narrowed patterns — see §7). Includes tests pinning: error
  subject falls through literal cases to `_`; typed pattern `x: !error`
  binds non-errors only; guards may call `IsError`/`Type`.
- **Rung 2 (the ergonomic hot path):** bubbling at **function application
  and `|>`** (all three routes: `f(err)`, `Apply`, `Pipe`). Closest to
  Hica; operator-level behavior unchanged. Measure snapshot blast radius
  before landing (expected small: today's result is inert, so only
  already-failing expressions change shape).
- **Rung 3 (RULED 2026-07-31: bubbling WITH provenance breadcrumb):**
  operator-level bubbling (`err + 1` → err), with the `Error` value
  carrying a breadcrumb (the failure's context/path within the larger
  expression) so Tycho can still render *where* the failure sits — the
  user ruled for the middle ground over freeze-in-place. Riders folded
  into the round: derive the observer exemption from `lazy` for held
  positions (absorbs the `Simplify`/`Expand`/`Factor`/`Together`/`Hold`
  divergence residue) and the `Assume`-throws fix. Sequencing: blast-
  radius measurement first (prototype in an isolated worktree, full
  suite, categorized churn + before/after cell examples), then the
  breadcrumb shape design, then implementation.
  **LANDED 2026-07-31** — with two amendments the measurement forced: the
  `lazy`-derived observer exemption was DROPPED (§6a.1) in favor of
  per-operator `inspectsErrors` opt-ins (audit table in §8a), and a
  collection carve-out was added (§6a.2, implemented per §6b). The
  breadcrumb is §2a.
- **Follow-on (decide after rung 2):** revisit silent-NaN sites — e.g.
  out-of-range `xs[10]` → `Error` instead of silent NaN becomes defensible
  once errors are rescuable. Breaking change; own round.
- **`cortex check` static reclassification (§5):** independent of the
  rungs; can proceed anytime.

## 6a. Rung-3 blast-radius measurement (2026-07-31, prototype in-tree, reverted)

Naive prototype = final-arm bubbling + the `lazy`-derived observer gate.
Full suite: 42 failures / 10 suites — **33 tests (44 snapshot blocks) pure
shape change** (frozen `Operator(…Error…)` → bare error; top suites:
linear-algebra 11, collections 8, arithmetic 5), 3 boundary pins that
correctly flipped, and **5 genuine surprises that redirect the design**:

1. **The `lazy` rider is wrong for this engine.** `lazy` here means
   evaluation-order control, not "observer": `Add`, `Multiply`, `Equal`,
   `Greater`, `Less`, `List`, `Set`, `Sum`, `If`, `Integrate`, `Solve`,
   `D` are all lazy. The gate therefore (i) exempts exactly the operators
   rung 3 targets — `err + 1` stayed frozen while `err - 1` bubbled, an
   incoherent split — and (ii) converts "freeze" into "run a handler on
   raw uncanonicalized operands" (the documented lazy-held-operands trap,
   now on the error path): a `Not canonical` throw escaped to the host
   from `Integrate`, `If` threw `Condition must evaluate…` on the box
   route, `Sum` hit console.asserts. `inspectsErrors` is a deliberate
   per-operator opt-in precisely because its five members have handlers
   audited for invalid nodes. **Ruling: the lazy rider is DROPPED.**
   The `Simplify`/`Expand`/`Factor`/`Together`/`Hold` divergence closes
   instead by widening `inspectsErrors` to those operators after auditing
   each handler.
2. **Collections need their own non-bubbling rule.** The `errorValue()`
   carve-out governs descent into *arguments*; it says nothing about a
   collection-headed node bubbling its own operand's error. Today `List`
   survives only because it happens to be lazy; **`Tuple(1, err)`
   bubbled to the bare error**. Rule for implementation: a
   collection-headed node never bubbles its operands' errors — keyed on
   collection-ness, not laziness. (`Dictionary` has no operator def and
   is unreachable via this path — verify at implementation.)
3. **Bubbling alone (no lazy gate) is coherent**: `err + 1` → err,
   route parity holds (`Sin(err)` ≡ `err |> Sin`), no host-escaping
   throws, the calculus crash does not occur.
4. **`Assume`'s direct-route throw is orthogonal** — its held operand is
   raw and valid on the box route, so the invalid-gate is never
   consulted; the throw is inside its own handler. Separate fix.
5. **Contract-pin caveat:** three `string-and-type.test.ts` tests pin
   "a non-string operand leaves it unevaluated" as deliberate
   non-coercion. Bubbling preserves the non-coercion (nothing is
   coerced; the validation error propagates) but flips the *frozen*
   result shape — flagged for explicit sign-off rather than absorbed.

Perf: not measurable (machine variance 123–288 s on identical code);
mechanistically unconcerning — the gate sits behind the cached
`isValid === false` test, so valid-tree evaluation is untouched.

**Breadcrumb design input** (what the bare error loses, per probes): the
operator chain from the error node to the root, and sibling values
already computed (`~oo + ln(err)` → the `~oo` vanishes; a list's valid
elements vanish). A breadcrumb of `(operator, operand-index)` frames
plus the top-level source span recovers the chain; carrying sibling
values is the expensive open half.

## 6b. Rung-3 implementation notes (landed 2026-07-31)

- **Bubbling is the final arm of `_invalidValue()`**
  (`boxed-expression/boxed-function.ts`, shared by the sync and async compute
  paths): `return this._firstOperandError() ?? this;`. The `?? this` matters —
  an invalid node whose error sits inside a COLLECTION operand yields no error
  to bubble and still freezes (`Length([1, err, 3])` is unchanged by rung 3).
  The `lazy`-derived observer gate measured in §6a was **not** implemented, per
  the ruling.
- **The collection carve-out is keyed on the DEFINITION**: a node whose
  operator definition carries a `collection` handler block returns `this`
  instead of bubbling (`isCollectionHead()` in
  `boxed-expression/error-value.ts`). Not `expr.isCollection`, which is
  hard-wired to `false` for an invalid expression — the only case that reaches
  here. Two structural containers have no such block and are named explicitly:
  `Dictionary` (no operator definition at all) and `KeyValuePair` (it
  canonicalizes to a `Tuple` when valid, so only its INVALID nodes survive —
  exactly the case the rule must cover). Consequence, deliberate: every
  collection-producing operator freezes, including `Take`/`Drop`/`Slice`/`Map`
  — which is why the `TAKE`/`DROP`/`SLICE` "invalid argument" tests in §6a's
  fallout list did NOT flip.
- **`Dictionary` resolved** (§6a.2's open question): a dictionary literal is a
  `BoxedDictionary`, not a `BoxedFunction`, so `_invalidValue()` never runs for
  it. Its VALUES are evaluated one by one, so an invalid value bubbles *within
  its cell* and the dictionary survives — the collection semantics, reached by
  a different road. Pinned.
- **`errorValue()`'s non-descent set is deliberately NOT the same predicate.**
  It governs descent into an *application's arguments* (rung 2, a landed
  contract: `f([1, err])` freezes); `isCollectionHead()` governs a node
  bubbling its *own* operands. Widening the former to match would silently
  change rung-2 behavior, so the two are separate and cross-documented.
- **Blast radius, measured**: 33 tests / 32 snapshot blocks across 9 suites,
  all category-(a) shape churn (frozen `Operator(…Error…)` → bare error, plus
  the new `ErrorTrace` operand in MathJSON snapshots). No behavior surprises,
  no host-escaping throws, no `@fixme` snapshot touched. The naive prototype's
  42 failures shrank because the collection rule reverted the `Take`/`Drop`/
  `Slice` flips and the dropped `lazy` gate removed the calculus/`Sum` crashes.

## 7. Reconciliation with `docs/EFFECTS-MODEL.md`

The "Rejected: `error`/partiality" section rests on three premises this
design interacts with:

1. *"CE has no bypass channel: an `Error` expression flows through the
   ordinary compositional value path."* — Today this is **aspirational**
   in strict positions: the error does not flow, it freezes the enclosing
   expression. Rung 2 makes the premise true: bubbling IS value-path flow
   (strictness `f(⊥) = ⊥`), not a bypass channel. No effect label is
   needed, exactly as that section argues.
2. *"Failure-handling ergonomics are narrowing operations… the planned
   refutable binding binds `x` at `typeOf(scrutinee) & !error`."* — That
   argument presupposes `Match` engages with error-carrying scrutinees.
   Rung 1 is therefore a **prerequisite of the effects model's own
   position**, not a revision of it.
3. *Corollary: `?` propagation declined (requires early return).* —
   Unchanged. Bubbling is not `?`: it is a local evaluation rule with no
   non-local control flow; expression-`Block` semantics are untouched.
   Deep-chain handling remains `match`'s job, now actually possible.

No effect labels, signatures, or discharge rules change. The
`WithRandomSeed` pending-draw walk is unaffected (bubbling only replaces
results that were already non-progressing inert trees).

## 8a. Implementation notes (rungs 1–2, landed 2026-07-31)

Conventions fixed during implementation — binding on later rungs:

- **The inertness gate was `BoxedFunction._computeValue`'s
  `if (!this.isValid || …) return this;`** — `isValid` is false exactly
  when a tree embeds an `Error`. `Type(err)` worked only by accident of
  laziness (its held operand is never canonicalized on the box route).
  Replaced by `_invalidValue()`: bubble (application) / run the handler
  (observer) / freeze (everything else, unchanged).
- **Observers are a definition flag, `inspectsErrors`** (`Match`, `Type`,
  `IsError`, `Apply`, `Pipe`) — a derived gate, not a name list. The flag
  is needed even on lazy operators: via `Pipe`/`Apply` the operand arrives
  already canonical (and thus invalid), so laziness alone does not save
  the observer. Not emitted by the definition's `toJSON()`.
- **Bubbling keys on the CALLEE, not the route.** User functions (value
  defs / `_isLambda` operator defs, `Function` literals) bubble on every
  route; built-in operators are not applications, so `Sin(err)` AND
  `err |> Sin` both stay frozen (rung 3). Bubbling unconditionally in
  `apply()` would have made `err |> Sin` bubble while `Sin(err)` froze —
  breaking the §3 equivalence. Pinned in `error-propagation.test.ts`.
- **`(err) |> IsError` is `True`** — same-callee keying means the observer
  sees the error identically on both routes; the §3 law holds for
  observers too.
- **Embedded-error extraction** reuses the `.errors` walk (the
  `runtime-error` diagnostic's machinery) via a new leaf module
  `boxed-expression/error-value.ts` (placed to avoid closing the
  documented `utils → boxed-operator-definition → function-utils` cycle).
- **Nothing parity resolved toward the spec, changing the pipe route:**
  the pre-existing divergence was callee-spelling, not route
  (`f(Nothing)` on a named `f` was already `f()` everywhere). Under §4
  all five routes now erase, so `Nothing |> (x |-> x+1)` returns the
  curried literal (the nullary-application result), where it previously
  bound the argument and returned `1`.
- **Known gap (pinned as a test):** typed patterns cannot express
  `x: !error` — the annotation parses but `Element` resolves only simple
  named types, so the case falls through for every subject. Blocks the §7
  refutable-binding lowering until compound/negation types resolve in
  typed patterns. Simple named types (`v: number`) correctly exclude
  error subjects.
- **Blast radius:** 2 inline snapshots (`Pipe(5, 3)`, `Pipe(5, "abc")` —
  the frozen `Pipe(…Error…)` became the bare error, since the callee
  itself is the error); zero doc-output churn.
- **Rung-3 `inspectsErrors` widening — the per-operator audit.** Each
  candidate was probed on BOTH routes (`Op(bad)` via `ce.box`, and
  `Pipe(bad, Op)`/`Apply(Op, bad)`) against an operand embedding a validation
  error, before the flag was set:

  | Operator | Flag | Audit finding |
  |---|---|---|
  | `Simplify` | **on** | Handler evaluates its operand, so it bubbles on its own terms: both routes give the bare error. Flag pins the parity (without it the pipe route bubbles from the gate, the direct route from inside the handler — same value, different reason). No throw, no assert. |
  | `Expand` | **on** | Rewrites in place and returns the still-invalid expression (`Error(…) + 1`) on both routes. Safe. |
  | `ExpandAll` | **on** | Same handler family as `Expand`; same result. (Not in the ruled five — folded in for consistency.) |
  | `Factor` | **on** | Same; `factorPolynomial` leaves an invalid target alone. |
  | `Together` | **on, after a handler fix** | MISBEHAVED: `togetherReduced` read the embedded `Error` node as a missing operand and returned `1 / Error("missing")` — dropping the real error and inventing a new one. Fixed minimally (return the target untouched when it is invalid), then flagged. |
  | `Distribute` | **on** | Same family as `Expand`. (Not in the ruled five — folded in.) |
  | `Hold` | **on** | Handler is `engine.hold(x)`, total on any operand. Without the flag `("a"+1) \|> Hold` bubbled while `Hold("a"+1)` held. The residual difference between routes (the piped operand arrives canonical) is the ordinary `Pipe` canonicalization, not error-specific. |

  Every one of these operators is a **transformer or a holder**: it reports on
  the expression it is given rather than consuming its value, which is the
  principle behind the flag. Operators that genuinely consume a value
  (`Assume`, `Evaluate`, `N`, arithmetic, …) stay off it and bubble.
- **`Assume`'s throw is now a value** (§6a.4). `assumeDispatch`'s final
  `throw new Error('Unsupported assumption…')` became
  `return 'not-a-predicate'`, matching every sub-dispatcher above it
  (`!isFunction(proposition)`, `!fact.isValid` already report malformed input
  that way). It escaped to the host on the `ce.box` route while Cortex turned
  it into a value — the two routes disagreed on whether an unassumable
  proposition is catastrophic. Known wart, PRE-EXISTING and untouched:
  `Assume` returns `ce.symbol(result)`, and `not-a-predicate` is not a valid
  symbol name, so the outcome renders as
  `Error(ErrorCode("invalid-symbol", "invalid-char"), "not-a-predicate")` —
  exactly what `Assume(Or(…))` has always produced. Worth a follow-up (report
  the outcome as a string), out of scope here.
- **Known residue (recorded at review): the §3 equivalence is restored
  only for the five `inspectsErrors` operators.** *(Closed for the transformer
  family by the rung-3 widening above; `Assume`'s own route difference remains,
  and is now benign — both routes return a value.)* Some other *lazy*
  built-ins still route-diverge on error operands — measured:
  `Simplify`, `Expand`, `Factor`, `Together`, `Hold`, `Assume` diverge
  (`Simplify("a"+1)` on the raw box route runs while
  `("a"+1) |> Simplify` freezes; `Assume` even THROWS on the direct
  route — ticket-worthy on its own), while `Evaluate`/`N`/`Which`/
  `Block`/`String` and most others agree on both routes. Built-in
  operators are rung 3 either way; the principled rung-3 companion fix
  is to derive the observer exemption from `lazy` for held positions,
  rather than growing the per-operator flag list. Pinned by a
  `Simplify` divergence test in `error-propagation.test.ts`.
- **Review-round refinements (2026-07-31):** error subjects match only
  irrefutable patterns (`_`, bindings, typed patterns) and **explicit
  `Error(...)` patterns** — deliberate error destructuring
  (`Error(c) => c` binds the payload); shape/literal/pin/range cases
  reject, identically on the laddered and reference paths. Bubbling
  does not fire for errors embedded inside COLLECTION values
  (`f([1, err])` freezes — a collection containing an error is a
  well-formed collection, not a failed value; consequence:
  `IsError([1, err])` is `False`). A non-function value-def callee
  reports the callee type error rather than swallowing the argument's
  error. The `ce.strict` invalid-argument guard in `makeLambda` remains
  LIVE (the collection carve-out reaches it), so the earlier note that
  it became dead code is retracted; in non-strict mode, non-collection
  invalid arguments now bubble where they previously flowed into the
  body.
- **§4 Nothing ruling, refined at review:** erasure is a property of the
  LITERAL `Nothing` symbol at canonicalization, on every route
  (`f(Nothing)`, `Apply`, `|>`, literal callees). A value that merely
  *evaluates* to `Nothing` (`f(g())` with `g() → Nothing`) BINDS, on
  every route. Both directions are route-uniform — the previously
  prescribed "evaluated-Nothing erases in Pipe" fix was rejected at
  implementation because it re-broke §3 on the named-callee route.
  Static erasure also shifts later `Apply` arguments left
  (`Apply(f, Nothing, 5)` ≡ `Apply(f, 5)`), pinned.

## 8. Open rulings

1. **Rung-2 scope pin:** bubbling at application/`|>` only — confirm
   operators stay freeze-to-inert until rung 3.
2. **`Nothing` erasure locus:** argument-list erasure with route parity
   (recommended §4), or Pipe-operand erasure (`Nothing |> f` → `f`)?
3. **`IsError` naming/shape:** `IsError(expr)` holding its operand;
   boolean result. Also expose as a type guard usable in match guards?
4. **Static reclassification (§5):** confirm `cortex check` should own
   canonicalization-time type errors as diagnostics.
