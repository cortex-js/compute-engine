# Error, NaN, Nothing: propagation through application and `|>` (design)

**Status:** design 2026-07-31, from the Hica-review discussion of pipeline
failure semantics. **Scope:** (1) what a strict operation does when an
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
- **Rung 3 (gated design round):** operator-level bubbling
  (`err + 1` → err) and the display trade-off — a half-frozen formula
  shows *where* the error sits (valuable in Tycho formula cells); a
  bubbled error shows *what* failed. Needs a blast-radius measurement, a
  provenance-breadcrumb decision, and a Tycho consult. Not blocking
  rungs 1–2.
- **Follow-on (decide after rung 2):** revisit silent-NaN sites — e.g.
  out-of-range `xs[10]` → `Error` instead of silent NaN becomes defensible
  once errors are rescuable. Breaking change; own round.
- **`cortex check` static reclassification (§5):** independent of the
  rungs; can proceed anytime.

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

## 8. Open rulings

1. **Rung-2 scope pin:** bubbling at application/`|>` only — confirm
   operators stay freeze-to-inert until rung 3.
2. **`Nothing` erasure locus:** argument-list erasure with route parity
   (recommended §4), or Pipe-operand erasure (`Nothing |> f` → `f`)?
3. **`IsError` naming/shape:** `IsError(expr)` holding its operand;
   boolean result. Also expose as a type guard usable in match guards?
4. **Static reclassification (§5):** confirm `cortex check` should own
   canonicalization-time type errors as diagnostics.
