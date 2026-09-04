# Error Model

**Status:** part normative reference, part proposal — revision 3,
incorporating two rounds of external review (2026-08-25). Each section is
marked:

- **Settled** — describes behavior that is shipped and ruled; the section is
  documentation, not a request.
- **Proposed** — a rule recommended for adoption. Not yet ruled; deviations
  from it are listed in §7, not silently absorbed.
- **Open** — a question that needs a ruling before it can be settled either
  way.

The Compute Engine serves two audiences with different needs. As the
infrastructure for Epsil, precise early diagnostics with source provenance
are valuable. As an interactive symbolic/numeric system, leeway and low
ceremony are valuable: guide the user when they did something they surely
did not mean, but do not reject input that could still become meaningful.
This document says how those two needs are reconciled: which failure channel
answers which kind of wrongness, when each fires (boxing time vs. evaluation
time), how each propagates, and what function signatures do and do not
promise.

## 1. The response channels — Settled taxonomy; the host-throw amendment is Proposed

When an operator receives an argument that is wrong in some way, the engine
answers through one of four channels. Which channel is not a per-operator
style choice; it is determined by *what kind* of wrongness it is.

**`Error` — the out-of-band diagnostic channel.** An `Error` expression
(type `error`) means *a language or operation contract was violated*: a
type mismatch (`Sin("banana")`), a parse fragment (`1+`), an arity
violation, a runtime conformance failure (a deferred type check that
settles against the slot), a failed dispatch (a non-function callee), a
violated precondition (an invalid option value, a dimension mismatch), or
an explicitly constructed `Error(…)`. It is the channel for wrongness that
is *about the program*, not about a mathematical value. A WRITTEN
`Error(…)` is therefore a static diagnostic node — it invalidates every
tree above it — and a program that wants to *produce* an error value at
run time calls `RuntimeError(code)` (ruled 2026-09-03), a valid application
typed `never` whose evaluation yields the `Error(code)` value. Its consumer is a
human or an IDE, so it carries provenance: an error code, the offending
sub-expression, and (as it propagates) a breadcrumb of the operators it
passed through. In the type lattice `error` is deliberately out-of-band as
well: it is a subtype of `any` but *not* of `unknown`, so no ordinary
value type ever admits it.

**`NaN` — the in-band numeric indeterminacy value.** `NaN` means *the
mathematics was performed and has no answer in the numeric codomain*:
`Mod(1, 0)`, `0 * oo`. It carries no provenance and follows IEEE 754
semantics: quiet, absorbing through numeric operations, `NaN == NaN` is
`False`. Its lattice position: `NaN` is admitted **only by the top type
`number` and by its own type `nan`** — every other numeric type excludes
it (`complex`, `real`, `rational`, `integer`, all of which are
finite-only; `infinity`; and the signed-pair spelling `+oo | -oo`, which
is `±oo` exactly). `~oo` (`ComplexInfinity`) is likewise outside `complex`, but
it now has a home of its own: it is a member of `infinity`. The top
therefore decomposes with nothing left over —
`number = complex ⊔ infinity ⊔ nan` — and the exceptional points that
§5 set out to name are named. (The non-finite typing convention is in
`ARCHITECTURE.md`, "Non-finite typing convention for type handlers";
`src/common/type/types.ts` documents the numeric tower.) By the missing-value ruling of 2026-07-24 (next paragraph) `NaN`
also serves as the *absence* marker inside numeric domains.

**`Missing` — the position-preserving absent datum.** For non-numeric
domains, "there is no element there" is answered by the `Missing` symbol
(type `missing`), with Kleene three-valued comparison semantics. In
numeric domains absence is absorbed into `NaN` instead — deliberately,
because compile targets are float-only and `NaN` propagates there for
free, whereas a symbolic marker cannot compile. This is an accepted,
deliberate **information loss** and should be understood as such:
`IsMissing(NaN) → True` means the engine cannot distinguish "a numeric
datum was absent" from "a numeric computation produced `NaN`". (The
propagation behavior is analogous to Julia's `missing`; note that Julia
itself keeps `missing` as a distinct singleton type separate from `NaN` —
the conflation is this engine's trade, made for the compile-target
reason above.) Out-of-band collection access is type-directed: numeric
element type → `NaN`, otherwise → `Missing`. When the element type is
indeterminate (`unknown`/`any`), the marker falls back to runtime
evidence: a bounded prefix of a small, finite collection is probed,
yielding `NaN` only when the probe saw numbers and nothing else, `Missing`
otherwise (including for anything lazy, oversized, or empty). Dictionary
and record access uses the *value* type, not the key/value iteration pair.
All of this is implemented in `absenceMarker()` in
`src/compute-engine/library/collections.ts`, whose doc comments are the
reference for the fine print. This model is settled; do not re-litigate
`At([1,2], 99)` returning `NaN`. (The original design plan,
"missing-value typing" revision 6, landed 2026-07-24 and was retired from
`docs/plans/` in the 2026-08-19 doc cleanup; this section and the
behavioral rules in §3 are now the durable record.)

**Inert — "not yet", never "no".** An application that stays unevaluated is
a claim that evidence might still arrive: a symbol may get a value, a type
may be narrowed. Inertness is not a failure channel, and it must never be
the terminal answer to a question the engine could decide from what it
already has. Distinguish this from an application that *has* evaluated to
its own exact symbolic form (`Arcsin(2)`, `Ln(2)`): that is a decided exact
value awaiting numericization under the exactness contract (§2), not a
pending question.

Distinct from all four: **`Nothing` is an erasure marker, not a failure
channel.** It is spliced out of argument lists and collections. Using it for
a failed computation or an out-of-band access would silently shorten a
result and misalign positional data — that is exactly what the `Missing`
ruling fixed.

**Host exceptions.** The settled core: throws are reserved for API misuse
by the embedding program, cancellation, and compiled-code boundaries per
`docs/COMPILATION-MODEL.md`. Beyond that core, current behavior is more
throw-friendly than this model proposes, in two distinct ways:

- **Native faults from built-in strict handlers are converted, not
  loud.** A `TypeError`/`RangeError`/`ReferenceError` escaping a
  built-in, non-lazy `evaluate` handler is deliberately converted to a
  boxed error value (`boxed-function.ts`, the crash-conversion wrapper) —
  a shipped fix for real host crashes: an engine bug must not kill the
  embedding editor mid-evaluation. Amended and shipped 2026-09-02 (ruled
  the same day): the conversion is kept (host resilience is right), and
  the boxed error carries the distinct `internal-error` code with the
  message and the first frames of the stack as the parts of its
  `ErrorCode`, so an engine fault is never disguised as a user mistake and
  a bug report can be traced without re-running the crash
  (`handlerThrowToErrorValue`, `boxed-function.ts`; pinned in
  `test/compute-engine/runtime-conformance.test.ts`).
- **A set of language-level contractual throws exists and is
  test-pinned**: the `Assign` redefinition discipline, function
  over-application ("Too many arguments"), a predicate returning a
  non-boolean (`Count`/`Filter`), a
  mistyped key function (`GroupBy`), element-wise failures enriched with
  broadcast context. *Proposed amendment (2026-08-25 review, pending
  ratification):* convert these to `Error` values; the inventory above is
  the migration list, and each is pinned by a test that will need an
  inline update.

## 2. Which channel, when — Proposed (codifies current behavior, with the deviations listed in §7)

One definition the rules below lean on — *the exactness contract*:
`evaluate()` returns the most exact form — a function of an exact argument
stays exact or symbolic (`Ln(2)` stays `Ln(2)`) — while `.N()`
(equivalently `evaluate({numericApproximation: true})`) produces a float;
an inexact (float) argument numericizes under plain `evaluate()` too
(`Sin(5.1) → -0.925…`). (Previously written down only in the untracked
`CLAUDE.md`; this sentence is its durable statement.)

Given an operator receiving a wrong or dubious argument, apply the first
rule that matches. The gate throughout is **evidence-based**: reject when
disjointness is *provable*, admit when types overlap or are unknown, and
re-check whenever new evidence settles.

1. **Provable contract violation, at the earliest layer that can prove
   it** — the operand's type is provably disjoint from the parameter type
   (the check argument validation performs in
   `src/compute-engine/boxed-expression/validate.ts`), or the defect is
   structural: a parse fragment, a missing or excess argument, an unknown
   named argument. Produce an `Error` at that layer — the parser for
   syntax, canonicalization for types and arity — wrapping the offending
   operand in place and preserving the surrounding structure
   (`Sin("banana")` boxes as `Sin(Error(…))`, not as a bare error), so
   diagnostics keep their position. Wrapping in place rather than
   collapsing is what keeps the expression a *document*: an expression can
   carry several independent error nodes and report them all at once, it
   still serializes back to the user's original formula with each offender
   annotated in place, and a structural repair (replace the one bad
   operand) has something to grab. The collapse still happens — at
   evaluation (§3), and in the type channel, where any invalid tree
   reports type `error` without being evaluated. This is the same division
   compiler frontends use: parse errors become error *nodes* in a full
   tree, never a bare error *value*, so downstream tooling keeps working
   on broken input.

2. **Admission for the uncertain** — an operand whose type merely
   *overlaps* the parameter type, or is unknown, is admitted at boxing.
   The interactive user gets leeway; evidence may arrive later. The check
   re-runs when it does: if evaluation settles the type against the slot,
   the same `incompatible-type` `Error` is produced then, at runtime
   (`Sum(["a", "b"])` boxes inertly because the list's element type was
   indeterminate, and evaluates to `Error(incompatible-type)` when the
   accumulator meets a string). This is the permissive-boxing posture the
   arithmetic operators already use: box permissively, guard in the
   evaluate handler.

3. **Value outside the naive domain, but mathematics has a standard
   extension** — return the extension, in no failure channel at all:
   `1/0 → ~oo` (projective infinity), `Ln(0) → -oo`, `Arcsin(2)` stays
   exact and numericizes into the complex plane, `Factorial(-2) → ~oo`
   (pole of Gamma). The empty-range conventions belong here too
   (`Sum` over an empty index range is `0`).

4. **A well-typed mathematical operation with no result in its codomain —
   return the codomain's absence marker at evaluation.** This rule is for
   *domain* failures of otherwise well-formed mathematical questions
   (`Mod(1, 0)` — a false `definedWhen` condition, in §4's terms), not
   for violated preconditions — an invalid option value, a dimension
   mismatch, an ill-formed index kind are contract violations (`requires`
   conditions, §4) and belong to rules 1/6. The marker is a function of the
   declared result type: `NaN` when the result type is numeric
   (`Mod(1, 0) → NaN`), `Missing` when it is a settled non-numeric type
   (carried through comparisons by Kleene semantics, discharged by
   `IsMissing`/`Coalesce`), the union of the two when it is
   indeterminate. This is conceptually the same `marker(T)` rule the
   collections layer implements (`markerType()`/`withMarker()`,
   `src/compute-engine/library/collections.ts`), though the current
   helper is coarser than the concept — it answers `number` where the
   sharp answer would be `nan` (§5). There is one primitive quiet datum —
   `Missing` — and `NaN` is `Missing` absorbed into a numeric domain (the
   2026-07-24 absence ruling: `Sin(Missing) → NaN`); the quiet channel
   always speaks the codomain's own vocabulary. Quiet, no provenance. In
   one sentence against rule 1: an `Error` answers an ill-formed
   question; `marker(S)` answers a well-formed question that has no
   answer.

5. **Absent element or out-of-band access** — the operation is
   *well-formed* but there is nothing at the place it points to: an index
   out of range, a key not present, an empty collection's first element.
   This is the access instance of rule 4: the marker is computed from the
   element type of the access — `NaN` for numeric elements, `Missing`
   otherwise. Never `Nothing`, never an `Error`.

6. **Runtime contract violations** — return an `Error` from evaluation.
   The line against rules 4/5: the marker applies when the operation is
   well-formed and simply has no answer or finds nothing there; an
   `Error` applies when the operation *itself* violates its contract (a
   failed `requires` condition, in §4's terms) and that only became
   provable at runtime. The known producers: the
   deferred check of rule 2 settling against the slot; an ill-formed
   operation on strings, collections, or structures (wrong index kind,
   invalid option, dimension mismatch); a non-function callee applied to
   arguments (`a := 5; a(x)`); a handler failure surfaced as an
   evaluation error rather than a host throw.

7. **Cannot decide** — the operand is symbolic, the type is indeterminate,
   the value is not yet known: stay inert. By the definition in §1, an
   operator may stay inert only while a later re-evaluation could still
   change the answer.

## 3. Propagation — Settled, demanded operands included (implemented 2026-08-28)

**`Error` is the absorbing element of strict evaluation — over demanded
operands.** Evaluating an expression that demands an error-carrying
operand yields the first embedded error, with the traversed frames pushed
onto its breadcrumb: `err + 1 → err`, `Sin(err) → err`, and a
user-function application `f(err) → err`. The sanctioned exceptions (the
first three in `_invalidValue()`,
`src/compute-engine/boxed-expression/boxed-function.ts`):

- **Observers** — operators flagged `inspectsErrors` run their handler on
  error operands instead of bubbling: `IsError(err) → True`, `Type(err)`
  reports `error`, and `Match` can dispatch on an error subject. Surface
  `match` is the sanctioned recovery boundary in Epsil.
- **Collections freeze the failed cell.** A collection-headed node (`List`,
  `Tuple`, `Set`, `Take`, …) never bubbles its operands' errors: an error
  in an element is a failure of that *cell*, not of the container, so
  `[1, err, 3]` stays a length-3 iterable list with the error in place.
  The exception is keyed on collection-ness (the definition has a
  `collection` handler block), not on laziness. To be precise about
  status: the frozen container is *preserved and iterable*, but its tree
  is still **invalid** — `isValid` is `false` for any tree containing an
  `Error` node, container or not (`error-value.ts`). Giving containers a
  validity notion distinct from their cells (a valid list with invalid
  cells, reflected in its type) is a possible future type-system
  refinement, not current behavior. Absorption looks at operands, not
  arbitrarily deep through collection values: `Sin([err])` stays an inert
  application of `Sin` to a list, while `Sin(err)` bubbles.
- **A non-function callee reports its own problem first** (`a := 5;
  a(err)` reports that `a` is not callable rather than bubbling the
  argument's error).
- **A selecting operator propagates only what it demands** — ratified
  2026-08-27 with Contract B, implemented 2026-08-28. An error in an
  operand such an operator never demands does not bubble at evaluation:
  `If(True, 5, err).evaluate()` is `5`, and so are `And(False, err)` →
  `False` and `Coalesce(5, err)` → `5`. The boxed expression still carries
  the error for editor diagnostics — static analysis sees dead code;
  evaluation does not execute it. This matches the declared lazy semantics
  ("lazy in unselected arms", `docs/LANGUAGE-MODEL.md`). The dual
  obligation holds: a handler that *does* demand an operand and gets an
  error propagates it (`If(False, 5, err)`, `If(err, 5, 7)`). The
  implementation DEFERS absorption past the handler rather than skipping
  it, which is what discharges the dual obligation automatically — an
  error the handler demanded is embedded in its result and bubbles from
  there. The scope is the `selectsOperands` definition flag, NOT laziness:
  most lazy operators demand every operand, and several answer something
  else entirely when a demanded operand is unusable, so they keep
  absorbing before the handler runs (§7, the 2026-08-28 entry).

  **The rule holds under composition.** It is a property of the
  expression, not of the root: `1 + If(True, 5, err)` is `6`,
  `Not(And(False, err))` is `True`, and `[If(True, 5, err)]` is `[5]`,
  each the same answer the selecting subexpression gives on its own. An
  enclosing operator therefore treats a selecting subtree as opaque when
  it looks for errors to absorb, and evaluates it like any other operand;
  what that evaluation *returns* is what bubbles. The dual obligation
  still holds one level up — `Sin(If(False, 5, err))` is the error,
  because the selection demanded the failing arm and the error is then
  the operand's value. A selection that is not decided yet
  (`If(x == 4, 5, err)` with a free `x`, `Coalesce(x, err)`) stays inert
  with its diagnostic in place: it has neither demanded nor rejected the
  failing arm.

**Why collapse at evaluation rather than stay inert.** Expressions are
immutable, so evaluating does not destroy the in-place, multi-error
document form — the caller still holds the boxed expression; `evaluate()`
*selects* a result, it does not overwrite the original. Given that, an
inert result would add almost nothing for diagnostics (the boxed form
already serves them, and an invalid tree already reports type `error`
unevaluated) while costing the value-consuming side: every host consumer
would have to search a tree for the failure certificate instead of being
handed one, breadcrumbs (the evaluation path — an exception's stack
trace) would not exist, and — decisively — invalid trees flowing inert
through evaluation would be pattern-matchable by every rule and handler,
so a rewrite like `x·0 → 0` could silently launder a malformed input into
a clean-looking value unless every rule carried its own validity guard.
Absorption makes "garbage never becomes a plausible value" a locally
checkable invariant enforced at one choke point. The dividing principle
for the exceptions above: **absorb where a value was demanded of the
error; freeze or skip where the error is merely stored or never
demanded** — `Sin(err)` demanded a value, `[1, err, 3]` stores one,
`If(True, 5, err)` never asks.

**`NaN` propagates by IEEE**: absorbing through numeric operations,
`Equal(NaN, NaN) → False`, orderings involving `NaN` are `False`.
Aggregates propagate it (`Max(1, NaN, 3) → NaN`) and absence-discharge
operators treat it as absent (`IsMissing(NaN) → True`) — with the
information loss stated in §1.

**`Missing` propagates by Kleene** in comparisons (`Less(Missing, 1) →
Missing`) and is never erased. In a *numeric* slot, `Missing` is
normalized to `NaN` at the boundary (numeric domains absorb absence, per
§1), so numeric operators never need a `missing` arm; a `| missing` arm
survives only on data/object-domain results. The per-operator policy — an
operator can reject, propagate, handle, or pass through an absent operand
— is the `missingBehavior` mechanism in
`src/compute-engine/types-definitions.ts`; elementwise and broadcast
interactions follow `docs/COLLECTIONS-MODEL.md` and
`docs/BROADCAST-MODEL.md`. **`Nothing` splices** (statistics skip it;
`Missing`/`NaN` propagate).

Because errors absorb *before* ordinary handlers run, an ordinary
operator handler never receives an error operand and needs no error
tests — laziness does not change that, since a lazy handler that demands
every operand is served by the same pre-absorption. A **selecting**
handler (`selectsOperands`) is the exception: it runs on the invalid tree
and owns propagation for the operands it demands. An operator that wants
to *see* errors must be declared an observer. Any
future recovery operator (an `IfError(expr, fallback)` in the style of
Mathematica's `Check`) would be built on the same `inspectsErrors` flag
plus a hold on its first operand; the mechanism already exists.

## 4. What a signature promises — RATIFIED 2026-08-27: Contract B adopted

(Contract B below was adopted 2026-08-27 as part of the numeric-lattice
ratification package — decision record:
`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`, ruling R-A.
Contract A remains documented as the status quo being migrated away from.
The per-operator signature style — precision versus readability, leniency,
boxing-time versus evaluation-time surfacing — is governed by
`docs/SIGNATURE-GUIDELINES.md`.)

The shared core, in either contract:

> **The declared result type of a signature constrains *successful* values.
> It does not assert that the function is defined for every argument
> admitted by the parameter types.**

This is the optimistic (partial-function) reading, and it is what every
practical language does: a Java `int f(int)` may still throw; Haskell's
`head :: [a] -> a` is partial on `[]`. Two consequences hold under both
contracts below:

- **`error` is an implicit evaluation *effect* of every application, not
  a member of any declared type.** Since *every* application can produce
  an error, annotating the possibility carries no information — the same
  argument by which unchecked exceptions displaced checked ones.
- **Input positions need no `| error` either**: §3's absorption guarantees
  a non-observer strict handler never receives an error operand.

The open question is what the declared types *describe*. A signature is
asked to do three jobs at once — **admission** (what input is a type
error), **domain description** (where the successes live), and
**documentation** (what a user, a doc page, or an Epsil hover learns) —
and the two contracts split those jobs differently. Take `Heaviside` as
the running example: its truth is "defined exactly on the real line
(`H(±oo)` included), where it takes exactly the values 0, ½, 1".

### Contract A — admission signatures (the status quo)

The parameter type is the admission contract and must stay wide enough for
anything the operator should quietly tolerate: `NaN` types as bare
`number`, so a numeric parameter narrower than `number` turns a quiet
runtime `NaN` into a boxing-time `incompatible-type` `Error` under the
current checker (verified 2026-08-24: with `f` declared
`(real) -> number`, `f(NaN)` boxes as `f(Error(incompatible-type))`). The
declared result type must likewise stay wide enough to admit failure
values. So `Heaviside` declares `(number) -> number`, and the sharp truth
lives only in the per-operator type handler (`realOnlyStepType` answers
`rational<0..1>` for a proven-real argument, wide `number` otherwise).

The cost, and it is real: **the public signature is nearly
information-free.** The most valuable facts about the operator — its
domain, its exact success values — are invisible in the API surface, the
generated documentation, and any tool that reads signatures; they exist
only as an implementation detail of the typing layer.

### Contract B — domain signatures — Ratified 2026-08-27 (as amended by both review rounds)

A definition declares **three separable facts**, of which only the first
is mandatory:

1. **The carrier signature** `(D₁, D₂, …) -> S`: each parameter's
   mathematical domain type, and the exact success type. Prefer the
   *precise* carriers — `real`, `complex`, `integer` — over bare
   `number`: since `NaN` (and `~oo`) inhabit only `number`, writing bare
   `number` as a parameter type smuggles the exceptional points into the
   domain and blurs the policies below. Bare `number` in a signature
   should be read as a smell.
2. **A per-parameter NaN policy** `nanBehavior: propagate | handle |
   reject`, symmetric with the existing `missingBehavior`. `propagate` —
   a `NaN` in this slot makes the application evaluate to `NaN`.
   `handle` — the handler sees the `NaN` and answers in its own codomain
   (membership predicates: `IsPrime(NaN) → False`). `reject` — `NaN` in
   this slot is a contract violation → `Error` (an index, a digit count,
   a dimension). The default is derived per parameter by a *mechanical*
   test — the conformance sweep depends on it being computable from the
   declaration alone: `propagate` when the slot's carrier is a subtype
   of `complex` that is **not** a subtype of `integer`, *and* the result
   type is numeric; `reject` otherwise. So `At(xs, NaN)` and
   `N(expr, NaN)` (integer slots) reject with no annotation, and `Sin`
   and `Heaviside` propagate with no annotation. The test is a default,
   not an inference of role — an integer slot can be a mathematical
   operand rather than an administrative index (`GCD`), and such an
   operator overrides explicitly. `handle` is always an explicit opt-in
   — a boolean codomain never implies the handler understands `NaN`.
   `propagate` is only *legal* on declarations whose result type is
   numeric: a quiet failure must speak the codomain's vocabulary
   (rule 4), so a non-numeric-result operator handles or rejects.
3. **A partiality declaration.** Being inside the carrier types does
   **not** prove success — `Mod(1, 0)` has both arguments proven finite
   integers and still has no answer; `0 · oo` makes `NaN` from
   `NaN`-free inputs. Two *distinct* kinds of condition attach to a
   declaration, because they feed different channels — the distinction
   is central to the taxonomy:
   - **`definedWhen(args)`** — the *mathematical* domain condition;
     false → the rule-4 marker (`Mod`: `definedWhen: b ≠ 0`).
     `partiality: total` is the claim that no such condition exists
     (`Heaviside` on `real`); `may-marker` concedes a domain failure is
     possible without naming the condition. **Omitted partiality means
     `may-marker`** — the sound default; inferring `total` would
     recreate the `Mod(1, 0)` unsoundness. Authors opt into `total`, or
     supply the predicate so the gate — or a static analysis — can
     discharge it and recover sharpness.

     **RULED 2026-09-01: the omitted default is a RUNTIME contract only
     — it does not add `| nan` or `| missing` to the result type.**
     With no `partiality` declared, the
     value of an application may still be the codomain marker at
     runtime (rule 4 of §2, the `definedWhen` gate, and NaN propagation
     all keep their obligations), but the derived application type
     stays the sharp `S`: `Length(xs)` types `integer`, not
     `integer | nan`. The reason is the same one this section gives
     for `error`: an inferred, universal possibility carries no
     information when annotated — `Length` never yields the marker and
     `Sin` can, and a default cannot tell them apart — so spelling it
     on every handler-less head would only destroy sharpness (measured
     2026-09-01: binding `S | marker(S)` engine-wide broke 412 tests
     across 86 suites, turning `vector<integer^3>` into
     `list<integer | nan^3>`). For a numeric codomain this also matches
     the IEEE expectation that any numeric value may be `NaN` and that
     `NaN` propagates. A type therefore describes the *successes*; the
     result type says `| nan` (or `| missing`) exactly when an author
     DECLARES the partiality
     (`partiality: 'may-marker'`, or a `definedWhen` predicate that the
     arguments do not discharge) or the operands PROVE it (a provably
     `NaN` argument in a propagating slot). `total` stays meaningful as
     the stronger, auditable claim that even the runtime cannot produce
     the marker. The same holds on the INPUT side, for the same reason
     `| error` is never spelled there: an operand may arrive as a marker
     (`Length(First(t))` receives `Missing` when `t` is empty) without
     the parameter type saying so, and the per-parameter
     `missingBehavior` / `nanBehavior` policies govern what happens —
     a `propagate` slot absorbs it to the result marker, `reject`
     errors, `handle` lets the handler answer.

     `may-marker` also covers
     *numeric-route* failures, not only mathematical ones: an exact
     value whose float image is not representable produces the marker
     too (`Sin(10000i)` is mathematically finite, but `.N()` overflows
     to `NaN` — verified 2026-08-25), so `total` asserts
     representability on the numeric route as well as mathematical
     definedness.
   - **`requires(args)`** — a *contract* precondition; false → `Error`
     (`MatrixMultiply`: `requires: columns(a) = rows(b)`; an option
     value in range; a well-formed index kind). This is the declared
     form of §2 rule 6.

   Both attach **per overload**, not to the operator as a whole.
   Mathematical domains can be *relational*, so the framework
   centralizes the mechanics but the operator supplies the condition:
   as a declared predicate, or as a check inside the handler routed to
   the matching channel.

The three worked declarations:

```
Heaviside: (real) -> rational<0..1>          // partiality: total
Sin:       (complex) -> complex              // may-marker: sin(±oo) has no
                                             //   limit; float overflow
Mod:       (real, real) -> real              // definedWhen: b ≠ 0
```

with every `nanBehavior` above left to its derived default (`propagate`).

**The derived application type** follows from the three facts and stays
honest about what has and has not been proven:

```
S
  | marker(S)   while a DECLARED partiality condition is not discharged
  | nan         while a propagating parameter might receive NaN
```

narrowing to exactly `S` when *both* are discharged: the declared
partiality (`may-marker`, or a `definedWhen` predicate) is absent,
`total`, or proven for these arguments, *and* every propagating slot's
argument type excludes `NaN`. (Per the 2026-09-01 ruling above, only a
DECLARED partiality puts `marker(S)` into the type; an omitted one does
not.) This needs the `nan`
singleton of §5 to be expressible — `rational<0..1> | nan` says vastly
more than a collapse to bare `number`. `realOnlyStepType` is a
hand-written special case of this derivation; under B it and its class
become the framework default read off the declaration.

**The derived behavior table.** For each argument of a declared
`(D) -> S`, the first matching row wins — and the `NaN` row runs
**before** domain membership, so the policy applies whether or not the
carrier happens to contain `NaN`:

| The argument… | Behavior | Phase |
| --- | --- | --- |
| is `NaN` | per that slot's `nanBehavior`: propagate → `NaN` · handle → handler answers · reject → `Error` | evaluate |
| provably inside `D` | handler runs; success in `S`, or the rule-4 marker where the partiality condition fails | evaluate |
| provably disjoint from `D` | `Error(incompatible-type)` | the moment disjointness is provable |
| overlaps `D`, not settled | admitted; inert until evidence arrives, then a row above | boxing admits; evaluate re-tests |

Signed infinities need no row of their own — they are ordinary values of
`real`/`complex` and land in the membership rows. `~oo` lands in the
membership rows too once it has a nameable type (§5): outside every
carrier below `number`, hence provably disjoint from a `(real)` or
`(complex)` parameter — `Heaviside(~oo)` → `Error` at boxing. Until that
singleton exists, `~oo` types bare `number`, which *overlaps* `real`, so
the gate must recognize the concrete value to reject it early — one of
the two reasons §5 proposes the singletons now.

**NaN composition.** The precise ordering, so multi-argument cases have
exactly one answer:

1. At boxing, the NaN policy is tested *before* ordinary type
   disjointness: a proven `NaN` in a `reject` slot becomes an `Error`
   immediately; a proven `NaN` in a `propagate` or `handle` slot is
   admitted even though `nan` lies outside the carrier.
2. At evaluation, every demanded strict operand is still evaluated —
   quiet propagation never skips a sibling operand's effects and never
   changes evaluation counts.
3. Across operands, the stronger channel wins: an embedded `Error` or a
   `reject`-slot `NaN` → `Error`; else any `propagate`-slot `NaN` →
   `NaN`; else `handle` slots and ordinary evaluation proceed.

So a function receiving `NaN` in both a rejecting and a propagating slot
produces the `Error`, and a propagating `NaN` alongside an effectful
strict sibling still runs the sibling.

Today's box-error / evaluate-error / inert variability stops being three
policies an author chooses among: it is one policy indexed by *when the
argument's evidence settles* (a literal settles at boxing; a collection
element may settle at evaluation; an unbound symbol never does). Because
success is claimed only where the partiality declaration says so,
inertness means exactly "no value yet" — never "a value the handler
declined". The user-facing summary needs no per-operator knowledge:
wrong kind of thing → immediate error; `NaN` in → `NaN` out unless the
signature says otherwise; a well-formed question with no answer → the
codomain's marker; unknown → waits. The residual judgment — carriers,
policy overrides, partiality — is the operator's mathematical definition
itself, irreducible but made once, in one declaration, guided by the
criteria below. And the table is executable: a conformance sweep can
derive each operator's expected behavior from its declaration, probe it
with the canonical kit (a string, `NaN`, `~oo`, `i`, a non-integer, an
unknown symbol), and turn library-wide drift into a test failure instead
of an anecdote.

**Choosing carriers.** For the real-vs-complex choice on numeric
operators the criterion is crisp: *does the definition depend on the
order of the real line?* Order is exactly what the complex numbers lack,
so order-dependent operators (`Heaviside`, `Max`/`Min`,
`Floor`/`Ceil`/`Round`, comparisons) declare `(real)`, and operators with a
genuine complex extension (`Sin`, `Sqrt`, `Ln`, `Exp`, `Arcsin`, `Erf`, and
`Sign`, whose complex extension is `z/|z|`) declare `(complex)`.

The carrier is not "the narrowest interesting input" — it can push the
other way. **Predicates declare wide**: a membership-style predicate
(`IsPrime`, `IsInteger`, …) is a claim "x ∈ S", and `False` is a
*success* value, not a failure — "3.5 is not prime" is a well-formed true
sentence, so `IsPrime` is genuinely total on its numeric carrier and
declares `(number) -> boolean` with `nanBehavior: handle` (explicit),
answering `False` for a provably non-integer argument, `NaN` included.
The one part of `number` it does not accept — the infinities — is
enforced by the HANDLER, not written into the signature: a declared
parameter type is also what an undeclared argument symbol is inferred
from, so the narrower spelling declared the caller's own `n` as
`complex | nan`. Put in the signature what a caller should be held to;
put in the handler what only the implementation knows.
`IsPrime(~oo)`, by contrast, is an `Error` (outside the carrier), and the
asymmetry with `IsPrime(NaN) → False` is deliberate:
`NaN` is the one value governed by a *policy* channel — IEEE gives it
dataflow semantics of its own — while `~oo` is an ordinary, if
exceptional, value governed by carrier types like any other. A pure
membership reading could defensibly answer `False` instead; the
carrier-discipline reading is chosen for predictability, and the
convention is stated here so the boundary is deliberate, not accidental.
It
does not widen to `any`: for a string the question is type confusion, not
membership, and the boxing Error is the wanted diagnostic (Mathematica's
fully-total `PrimeQ["banana"] → False` is the cautionary tale — typos
flow through as `False` forever). The general criterion: when the
codomain contains a truthful off-domain answer, the carrier widens to
everywhere that answer is truthful; when it does not (`Heaviside(i)` has
no value under any convention), the carrier stays the success region.

**One implementation, not one per operator.** The table, the marker rule,
and the derived typing belong in the generic dispatch path, not in
operator definitions. The evaluation pipeline already has three generic
stages no operator implements for itself — error absorption
(`_invalidValue()`), signature validation, and hold processing — and B
adds the remaining ones in the same style: the evidence-based admission
test in the validation layer, and a pre-handler gate applying the table.
What the framework *cannot* do is prove relational mathematical domains;
those enter as declared predicates or in-handler checks (fact 3 above),
and the handler otherwise contains only mathematics. The sanctioned
opt-outs remain the existing flags (observers, collection heads, lazy
operands). The known migration hazard: operators with canonical handlers
currently bypass declared-signature validation entirely, so the generic
gate must claim that class too — otherwise they remain exactly the drift
population this section exists to eliminate.

**Policies are part of a callable's contract.** `nanBehavior` and
partiality shape both runtime semantics and the derived application
type, so higher-order call sites need them: `Map(f, xs)` and a function
value stored in a symbol must let the engine derive whether applying `f`
can produce `nan` or a marker. The representation is an open
implementation design (§7): carry the policies as effects/refinements in
the function type; attach definition metadata to callable values; or —
the conservative floor that must hold regardless of representation —
treat an unknown or user-defined callable as `may-marker` with unknown
NaN behavior. This touches function subtyping, callback validation, and
compilation.

Why B is feasible now rather than aspirational: the operand-descriptor
layer has already stopped trusting declared result types as unconditional
truths about applications — application finiteness is read from the
expression's own evidence as a backstop, a posture adopted after
measurement showed contract-only reasoning wrong. That is exactly the
consumer discipline B requires. The remaining migration cost is every
reader of a *declared* type that treats it as an unconditional claim
(type-keyed guards, compile lowerings reading declared ranges): each must
either condition on the derived application type or on proven domain
membership. Signature flips can then land operator-by-operator.

Precedents for B's shape: refinement-type systems (Liquid Haskell, F*)
declare exactly such domain/success types with side conditions discharged
separately — `partiality: predicate(args)` is a refinement condition by
another name; Lean makes partial reals total with a junk value
(`Real.sqrt (-1) = 0`) — the marker is that junk value, IEEE's own; and
IEEE itself is the precedent for per-slot `NaN` propagation combined with
documented domains.

### The worked example under each contract

| | Contract A (status quo) | Contract B (as amended) |
| --- | --- | --- |
| Declared | `(number) -> number` | `(real) -> rational<0..1>` · partiality `total` · `nanBehavior` derived (`propagate`) |
| What a user/doc/hover learns | nothing beyond "numeric" | domain, exact success values, NaN policy, totality |
| `Heaviside("banana")` | `Error` at boxing | `Error` at boxing |
| `Heaviside(i)` | admitted; inert forever today | `Error` at boxing |
| `Heaviside(~oo)` | admitted; inert forever today | `Error` — at boxing with the §5 singleton, at evaluation without it |
| `Heaviside(NaN)` | admitted; inert today | `NaN` at evaluation |
| `Heaviside(±oo)` | `1` / `0` | `Error` at boxing — `real` is finite-only, so `±oo` is out of the declared domain; `(real \| +oo \| -oo) -> …` is the spelling that keeps admitting it |
| `Heaviside(x)`, `x` unproven | `.type` = `number` (type handler) | `.type` = `rational<0..1> \| nan`, derived |
| `Heaviside(x)`, `x` proven real | `.type` = `rational<0..1>` (type handler) | `.type` = `rational<0..1>` exactly (total + `real` excludes `NaN`), derived |
| Where the sharp claim lives | bespoke type handler | the declaration itself |

## 5. The exceptional numeric points and the lattice — RATIFIED 2026-08-27 (singletons adopted; placement superseded by the lattice flip)

(The singleton refinements below were adopted 2026-08-27 — ruling R-B of
`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md` — together
with the finite-by-default lattice flip, which supersedes this section's
placement premise as the amendment paragraph at the end of the section
describes: the `~oo` singleton is spelled `~oo` and is a member of the new
`infinity` type.)

Settled placement (ruled 2026-08-21, pinned in
`test/compute-engine/non-finite-typing.test.ts`): `NaN` **and** `~oo`
are admitted only by the top type `number`. Every carrier below `number`
excludes both. `~oo` is *undirected* — a value counts as `~oo` exactly
when its imaginary part is infinite; a directed infinite value (`∞ + i`,
`±oo`) is a different thing and lives inside `complex`/`real`. Do not
"fix" `~oo` back into `complex`: that state existed, produced three
sign-consistency bugs, and was deliberately removed. (Note in passing:
the pre-flip numeric-tower comment decomposed `complex` into its finite
twin plus the signed pair `non_finite_number`, which under-counted —
mixed directed infinities like `∞ + i` were `complex` but in neither
named part. The flip closes that hole: such values are members of
`infinity`, which is defined by infinite magnitude.)

Proposed — **introduce two singleton refinements now** (upgraded from
"demand-driven" by the 2026-08-25 reviews):

- `nan <: number`, disjoint from `complex` and everything below it,
  disjoint from `error`;
- `complex_infinity <: number`, likewise disjoint from `complex` and
  from `nan` (its value population is exactly the engine's
  `isComplexInfinity` test).

These are *new names for existing regions*, not moves: `~oo` and `NaN`
keep matching `number` and keep not matching `complex`, so the 2026-08-21
ruling and its pins stand. What the names buy: Contract B's derived types
stay sharp (`rational<0..1> | nan` instead of a collapse to
`number`); and provable-disjoint early rejection works by ordinary
subtype tests (`Heaviside(~oo)` → `Error` at boxing) instead of
concrete-value recognition wired into the gate. With both singletons the
top decomposes exactly: `number = complex ⊔ nan ⊔ complex_infinity`.
Migration caution, learned the hard way: retyping the `~oo` and `NaN`
*literals* changes what type-keyed guards see (a previous retyping of
`~oo` silently disabled an `Add` guard), so the flip needs the same
guard-sweep discipline the literal-types rollout used.

Rejected: making `nan` a subtype of `error`. The two channels answer
different questions (§1): `0/0` is a perfectly well-formed question whose
answer is indeterminate, not a violated contract. Merging them would make
every numeric signature reject its own outputs (`Sin: (complex) ->
complex` would no longer accept `Sin(0/0)` as input to a further
`Sin`), and would pull `error` — deliberately outside `unknown` — into
the value lattice. `~oo` is likewise *not* an error and not a `nan`: it
is a definite point with defined arithmetic (`1/~oo = 0`, `2·~oo = ~oo`),
unlike `NaN`, which absorbs.

Amendment — the finite-by-default lattice flip
(`docs/TYPE_SYSTEM_ROADMAP.md` §8), ratified 2026-08-27 and shipped.
The bare numeric types `integer`/`rational`/`real`/`complex` are
finite-only, and an `infinity` type (whose members include the
singletons `+oo`, `-oo`, `~oo`) joins the `nan` singleton, so the top
decomposes as `number = complex ⊔ infinity ⊔ nan`; the
`complex_infinity` singleton proposed above is absorbed as the `~oo`
member of `infinity`. This replaces the settled placement premise
above: the directed infinities no longer inhabit `real`/`complex`, and
the pins on `matches('real')` for `±oo` flipped with it.

## 6. Interpreter vs. compiled code — Settled: compilation is fail-closed

Compilation policy is owned by `docs/COMPILATION-MODEL.md`, which is
normative and already answers this model's question: **a target emits
code only when it can preserve the interpreter's value, effects,
evaluation count, and error contract — it never emits plausible but
different code.** This error model adds nothing to that rule; it only
maps its channels onto it:

- A compiled expression may *erase* a check when static evidence proves
  it unnecessary. Note the direction of proof: any parameter type below
  `number` that excludes `nan` — which is now every bare numeric carrier
  — proves no `NaN` *enters* through that slot; only a discharged
  partiality condition (§4) proves the operation cannot *produce* a
  marker — `Mod(1, 0)` makes `NaN` from `NaN`-free inputs. Proof, not
  hope, and the two proofs are different.
- Where the outcome cannot be proven away and the target can represent
  it, the compiler *guards* — the `NaN` channel is usually free here,
  since IEEE propagation is native to every float target; preserving
  per-slot `propagate` costs nothing.
- Where the target cannot represent an outcome (a boxed `Error` on a
  numeric-only GLSL/WGSL/interval lane, a `Missing` on a float lane), the
  compiler *declines* with a structured diagnostic — interpreted fallback
  when enabled, a visible decline otherwise. It does not quietly
  reinterpret an `Error` as a throw, a `NaN`, or a plausible ordinary
  value.
- Any native-semantics escape hatch must be an **explicitly named unsafe
  mode**, chosen by the caller — never a silent default.

An earlier revision of this document proposed that compiled code "sheds
the Error channel" and leaves residual failures to target semantics; that
contradicted the fail-closed contract and is withdrawn. Consequence worth
acting on: any compiled behavior that disagrees with the interpreter on
these channels is a bug against `COMPILATION-MODEL.md`, not a documented
divergence — the review reported `compile(Heaviside)(NaN) → 1` (not yet
reproduced here); if confirmed, that is exactly the "plausible but
different" class the rule prohibits, and the compiled-lane conformance
probes belong in the §7 sweep.

## 7. Conformance snapshot and open questions

First probed 2026-08-24/25 against `src/` and re-probed 2026-08-28/29
after the conformance round (route: `ce.box(json)` then `.evaluate()` /
`.N()`; every row is also executed on all three construction routes by
the suite named at the end of this section). "exact, unreduced" means the
application evaluated to its own exact symbolic form and awaits
numericization (§1) — it is not rule-7 inertness.

| Input | Boxed | `evaluate()` | `.N()` | Verdict vs. §2 |
| --- | --- | --- | --- | --- |
| `Sin("banana")`, `Sin(True)` | `Sin(Error(incompatible-type))` | `Error` | `Error` | conforms (rule 1) |
| `"banana" + 1` | `Error(…) + 1` | `Error` | `Error` | conforms (rules 1, §3) |
| `Sum(["a", "b"])` | inert (element type indeterminate) | `Error(incompatible-type)` | `Error` | conforms (rules 2, 6) |
| `1/0` | `~oo` | `~oo` | `~oo` | conforms (rule 3) |
| `Factorial(-2)` | inert | `~oo` | `~oo` | conforms (rule 3) |
| `Arcsin(2)` | exact, unreduced | exact, unreduced | complex value | conforms (rule 3) |
| `Ln(0)` | exact, unreduced | `-oo` | `-oo` | conforms (rule 3) |
| `Mod(1, 0)` | inert | `NaN` | `NaN` | conforms (rule 4) |
| `At([1,2], 99)` | inert | `NaN` | `NaN` | conforms (rule 5, numeric elements) |
| `First([])` | inert | `Missing` | `Missing` | conforms (rule 5) |
| `Sin(NaN)` | inert | `NaN` | `NaN` | conforms (§4 propagate) |
| `Heaviside(NaN)` | inert | `NaN` | `NaN` | conforms (§4 propagate) |
| `IsPrime(3.5)`, `IsPrime(π)`, `IsPrime(i)`, `IsPrime(NaN)` | inert | `False` | `False` | conforms (§4 predicates) |
| `IsPrime(-7)` | inert | `False` | `False` | conforms (convention ruled 2026-08-29) |
| `IsPrime(~oo)`, `IsPrime(±oo)` | valid | `Error(incompatible-type)` | `Error` | conforms (outside the carrier, ruling L9) |
| `If(True, 5, err)` | error preserved in place | `5` | `5` | conforms (demanded operands, §3) |
| `1 + If(True, 5, err)`, `[If(True, 5, err)]` | error preserved in place | `6`, `[5]` | same | conforms (demanded operands under composition, §3) |
| `Factorial(NaN)`, `Root(NaN, 3)`, `GCD(NaN, 2)` | inert | `NaN` | `NaN` | conforms (§4 propagate) |
| `Sum(x, (n, 5, 1))` | inert | `0` | `0` | conforms (rule 3, empty range) |

Conformance record. Each entry was a gap — a place where the engine did
not do what this model asks — until the ruling named in it settled the
answer and the fix landed. An entry with no FIXED date is still open.

- **FIXED 2026-08-28: `Sin(NaN)` evaluates to `NaN`.** `NaN` is a float,
  and by the exactness contract (§2) a numeric function of an inexact
  argument numericizes under plain `evaluate()`; the per-slot `propagate`
  policy says the same, and the aggregates already behaved this way
  (`Max(1, NaN, 3) → NaN`). The cause was a single shared exactness test:
  `BoxedNumber.isExact` admitted every non-finite raw number as exact, so
  a `NaN` operand looked like an exact value with something to preserve —
  while the same value stored as a `MachineNumericValue` or a
  `BigNumericValue` already reported `false`, so one mathematical value
  answered two ways depending on how it happened to be stored. Excluding
  `NaN` there conformed the whole numeric family at once (`Sin`, `Cos`,
  `Tan`, `Exp`, `Ln`, `Sqrt`, `Arctan`, `Sinh`, `Abs`, `Gamma`, `Floor`,
  `Round`, `Erf`, …), not `Sin` alone. The signed infinities are untouched
  and stay exact.
- **FIXED 2026-08-28: `Heaviside(NaN)` answers `NaN` under `evaluate()`
  and `.N()`.** Same propagate class as `Sin(NaN)`, but its handler is a
  sign dispatch, not a numeric kernel: all three of its sign tests are
  `false` for `NaN`, so the shared exactness fix does not reach it and it
  carries its own `NaN` arm. `Sign` had the identical handler shape and
  was fixed with it. This also closes the route divergence the compiled
  lane opened: `compile(Heaviside)(NaN)` had been conformed to `NaN`
  first, leaving the interpreter inert.
- **FIXED 2026-08-28: the `IsPrime` family answers `False` for a decidable
  non-member.** A membership predicate's `False` is a success value, so
  `IsPrime(3.5)`, `IsPrime(π)`, `IsPrime(i)` and `IsPrime(NaN)` are all
  `False` (`docs/SIGNATURE-GUIDELINES.md` §3.3). The predicate answers
  `False` whenever the argument is provably not an integer — from its
  value, or, for a constant with no literal integrality answer (`π`, `e`,
  `φ`), from its type not overlapping `integer`; an argument that could
  still be an integer stays inert. `IsPrime(~oo)` (and the signed pair) is
  the wanted `incompatible-type` Error under ruling L9, minted by the
  HANDLER: the declared carrier stays the wide `(number)`, because a
  declared parameter type is also what an undeclared argument symbol is
  inferred from, and the narrower `complex | nan` spelling declared the
  caller's own `n` as `complex | nan`. `NaN` needs no arm of its own —
  it rides in on `number` and the handler answers `False`, which is what
  Contract B will name `nanBehavior: 'handle'`. A negative integer
  answers `False` too, under
  the convention ruled 2026-08-29 (below). `IsComposite` gained a real
  definition in the same change: it used to canonicalize to
  `Not(IsPrime(n))`, which called `0` and `1` composite and would have
  called `3.5` and `NaN` composite once `IsPrime` started deciding them.
- **FIXED 2026-08-28: `If(True, 5, err)` evaluates to `5`.** The
  demanded-operands rule (§3) now has an implementation: absorption is
  DEFERRED past the handler for an operator that chooses among its
  operands, instead of happening before it. Deferring rather than skipping
  is what keeps the dual obligation — an operand the handler does demand
  comes back as the error, so the error is embedded in the handler's
  result and bubbles from there (`If(False, 5, err)`, `If(err, 5, 7)`,
  `And(True, err)`). The scope is a new definition flag,
  `selectsOperands`, set on `If`, `Which`, `And`, `Or`, `Implies`, `Nand`,
  `Nor` and `Coalesce`; keying it on `lazy` instead was measured and is
  wrong, because most lazy operators demand every operand and several
  answer something else entirely when a demanded operand is unusable
  (`Numerator(err)` answered `Nothing`, `D(err, x)` threw out of the
  handler). `If` and `Which` gained an explicit propagation of their
  condition's error, which is the obligation the flag imposes.
- **FIXED 2026-08-29: the demanded-operands rule holds under
  composition.** `If(True, 5, err)` answered `5` on its own but made
  every expression it was nested in fail — `1 + If(True, 5, err)`,
  `Not(And(False, err))`, `Block(If(True, 5, err))` were all the error,
  and `[If(True, 5, err)]` froze the unevaluated `If` into the list.
  The cause was that an enclosing node's absorption walked the whole
  operand tree, straight through the selecting head. The error walks now
  treat a selecting subtree as opaque at any depth, and a node whose
  errors all sit behind one EVALUATES instead of freezing; what the
  subtree returns is what bubbles. A selection that is undecided
  (`If(x == 4, 5, err)` with a free `x`) stays inert with its diagnostic
  in place. The absorption a selecting operator owes is now attached to
  its RESULT rather than to its operands, which also restored the
  breadcrumb frame those operators had been dropping: `If(err, 1, 2)`
  records `{If, 1}` the way `Sin(err)` records `{Sin, 1}`.
- **FIXED 2026-08-29: the multi-argument numeric heads propagate `NaN`.**
  `Root(NaN, 3)`, `Mod(NaN, 2)`, `Binomial(NaN, 2)` and `Power(2, NaN)`
  stayed inert even under `.N()`. Their kernels are reached through
  `apply2`, whose real branch skipped a NaN operand outright and left the
  application with no result — reading a propagated NaN as the kernels'
  "outside my implemented domain" signal, which it is not. `apply2` now
  answers `NaN` for a NaN argument, as `applyN` already did, and `apply`
  carries the same guard. `Factorial`, `Factorial2`, `GCD` and `LCM`
  compute without those dispatchers, so each gained its own arm. The
  INFINITE arguments of the factorial family remain inert (`ROADMAP.md`,
  the 2026-08-29 conformance round).
- **FIXED 2026-08-28: `markerType()` answers `nan`.** The §5 singleton is
  live, so the type-level absence marker of a numeric slot names exactly
  `NaN` instead of the whole `number` tier, and `withMarker(T)` is a
  genuinely additive `T | nan` — the `NaN ∈ number` absorption reasoning
  was repealed by the lattice flip. The stored types of the
  out-of-band-capable accessors sharpened accordingly:
  `At([1,2,3], 99)`, `First([1,2,3])` and `Last([1,2,3])` type
  `integer | nan` where they typed a bare `number`. The arms are joined
  with `reduceType`, not `widen`: widening climbs the numeric ladder and
  would answer `number` for `integer ⊔ nan`, losing the element tier
  again. Values did not move — an out-of-band numeric access is still
  `NaN`, and `Missing` is still the non-numeric marker.
- **RULED and IMPLEMENTED 2026-09-03: `RuntimeError(code)` constructs an
  error value at run time.** A written `Error(…)` stays what §1 says it is —
  a static diagnostic node that invalidates its tree, so a function whose
  body spells `Error("neg")` never gets a function type and its declaration
  is inert (the trap Epsil's `if let` docs first hit). The ruling adds the
  runtime counterpart instead of exempting held bodies from the validity
  rule: `RuntimeError("neg")` is a valid application, typed `never` because
  a signature describes the successes (§4) and it has none, whose evaluation
  produces `Error("neg")`. So `(x) => If(x > 0, x, RuntimeError("neg"))`
  types `(unknown) -> number`, is declarable, and answers `Error("neg")`
  for a non-positive argument. Only the code is taken — the `where` operand
  of `Error` names the offending sub-expression of a static diagnostic,
  which a runtime failure does not have (user ruling). The `javascript`
  target has no lowering and fails closed, naming the operator. Pinned by
  `test/compute-engine/runtime-error.test.ts` and
  `test/epsil/runtime-error.test.ts`.
- **FIXED 2026-09-03: a user function answers with the error value its
  body evaluates to.** Application of a function literal (`makeLambda`,
  `src/compute-engine/function-utils.ts`) DECLINED when the body's result
  was invalid — a gate from 2024 that predates this model — so the call
  stayed inert: `len := x ↦ Length(x); len(5)` answered `len(5)` where
  `Length(5)` is the `incompatible-type` error, an Epsil
  `function head(xs: list) { match xs { [h, ...] => h } }` applied to `[]`
  answered `head([])` instead of the `match-no-case` error, and no Epsil
  function could ever return an error value. §3's rule — "Error values
  propagate through ordinary function application", as
  `docs/LANGUAGE-MODEL.md` states it — now holds for user functions: an `Error` result — or one embedding an error reachable without
  crossing a selecting operator or a collection literal — is the
  application's value; a frozen container or an undecided selection is
  returned as it is, with its diagnostic in place (`bodyResultValue`).
  Pinned by `test/compute-engine/user-function-error-result.test.ts`. Still
  OPEN, and a ruling: a WRITTEN `Error(…)` in a function body makes the
  literal itself invalid (type `error`), so the declaration never takes
  effect — see `ROADMAP.md`, "a written `Error(…)` literal in a function
  body".
- **FIXED 2026-09-02 (ruled the same day): native handler faults carry
  the `internal-error` code with the stack.** A `TypeError`, `RangeError`
  or `ReferenceError` thrown inside a built-in, non-lazy handler used to
  be converted to `Error(evaluation-error, message)` — the same code a
  legitimate domain failure reports, so an engine bug was
  indistinguishable from bad input and the stack was lost. It now converts
  to `Error(ErrorCode("internal-error", message, stack))` with the first
  frames of the stack; the conversion itself (no host exception) is
  unchanged (`handlerThrowToErrorValue`, `boxed-function.ts`).
- **FIXED 2026-08-28: `compile(Heaviside)(NaN)` answers `NaN`** under
  ratified Contract B's derived `propagate` default (it answered `1` — a
  fail-closed violation, confirmed 2026-08-26: both comparisons in the
  kernel are false for NaN, so the final arm caught it). All three
  lowerings were swept: the JavaScript kernel gained a leading
  `Number.isNaN` arm; the interval kernel propagates a NaN interval
  (it answered `singular at 0`); the GPU preambles propagate through an
  arithmetic carrier (`0.5 + 0.0 * x` on the fall-through arm — `isnan`
  is unreliable under fast-math, so shader NaN answers stay best-effort
  by design). Conformed pin in `test/compute-engine/error-model.test.ts`.
- **RULED 2026-08-28 (pole encoding): a float-only compile target answers
  the IEEE `Infinity` where the interpreter answers `~oo`** — the float
  projection keeps the magnitude and drops the direction `~oo` never had,
  and it is what the bare division instruction already answers at a
  runtime pole. The constant fold, the embedded `~oo` literal, the
  `Factorial` negative-integer pole and the GPU `Gamma` pole guard were
  aligned (they answered `NaN`, so the same pole spelled differently by
  fold and by runtime). `NaN` stays reserved for the indeterminate
  (`0/0`, `0·∞`) and for `propagate`. Documented as the float-target
  carve-out in `docs/COMPILATION-MODEL.md`; conformed pins in the suite.
- **RULED 2026-08-30 (pole-encoding extension, shipped): the projection
  also applies at the argument boundary** — a `~oo` value passed into
  compiled code becomes `+Infinity` at entry instead of throwing (a
  genuine complex value still rejects on a real lane). The second half
  of the proposal — re-admitting `infinity`/`nan` parameter clause
  guards under the now-faithful encoding — was REFUTED by measurement:
  float arithmetic degrades one non-finite class into another before a
  guard runs (compiled `1/w - 1/w` at `w = 0` is `NaN`; the
  interpreter's operand stays `~oo`), so every non-finite primitive
  clause type AND every non-finite value-literal clause still declines
  the whole function. Two accepted divergences, recorded in
  `ROADMAP.md`: compiled `Heaviside(~oo)` → `1` and compiled
  `~oo > 0` → `true`, both symbolic in the interpreter. Details in
  `docs/COMPILATION-MODEL.md`.

Open questions (each phrased so it can be answered without this
document's history):

- **RULED 2026-08-27: Contract B as amended (§4) is ratified** — the
  headline ruling, adopted as ruling R-A of the numeric-lattice
  ratification package
  (`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`). The
  adopted package: carrier signatures with precise domains and success
  types; `error` as implicit effect; the `nan` and `complex_infinity`
  singletons (§5); per-parameter `nanBehavior` with derived defaults and
  the composition rule; the `definedWhen`/`requires` split with
  `may-marker` as the omitted default; evidence-based admission;
  demanded-operands error propagation (§3); fail-closed compilation
  (§6). Implementation has not started; the callable-metadata
  representation (next item) remains an open implementation design item,
  and the ROADMAP defects gated on the NaN policy (compiled
  `Heaviside(NaN)`, the compiled-lane pole encodings) are now unblocked.
- **RULED 2026-09-02: callables carry NO policy metadata — the
  conservative floor is the representation.** A user function (a lambda,
  a declared-then-assigned function, a multi-clause definition) is
  `may-marker` with unknown NaN behavior at every consumer, and the
  precision a caller wants comes only from a DECLARED signature with
  precise carriers (`(real) -> real`), which the derivation already reads.
  Weighed and not taken: inferring `nanBehavior`/`partiality` from a
  literal's body (a new inference pass with its own soundness questions —
  a body that branches on `IsNaN(x)` must infer `handle`), and policies
  as effects in the function type (`(real) -> real ! nan-propagate`; the
  type grammar, parser, printer and subtyping would all grow). Measured
  before ruling: at the VALUE level a user function already behaves like
  a library one (`g := x ↦ √x`; `g(NaN)` is NaN; `Map(g, [1, NaN])` is
  `[1, NaN]`), and only the sharper static claim (`nan` instead of
  `number`) is lost, which no higher-order consumer needs today. Revisit
  only when one does.
- **RULED 2026-09-01: the omitted `may-marker` default is a runtime
  contract only — it does not add `| nan` or `| missing` to the result
  type** (§4, with the derived-type block amended).
  Weighed after re-measuring the doc-faithful alternative once Phase F
  was complete: binding `S | marker(S)` for every head with no declared
  partiality failed 412 tests across 86 suites (and 7 snapshots) —
  `integer → integer | nan`, `string → missing | string`, shape claims
  such as `vector<integer^3>` collapsing to `list<integer | nan^3>` —
  and the alternative of declaring `partiality: 'total'` on every total
  builtin was judged a library-wide migration for no sharpness gain
  over silence. Adopted: a type describes the successes; the marker
  arm appears only from a declared partiality or from proven NaN
  evidence; `total` remains the stronger auditable claim; on the input
  side the marker is governed by `missingBehavior`/`nanBehavior`, never
  spelled in the parameter type. Recorded expectation: this may surface
  as a user surprise ("`Length` said `integer` and returned `Missing`")
  — for `NaN` it is the IEEE expectation, for `Missing` it is the same
  bargain as `error`; revisit if feedback shows otherwise.
- **RULED 2026-08-27: `~oo` is a singleton member of the `infinity`
  type.** The options weighed were: (a) inside `complex` — rejected: it
  breaks `complex`'s structural promise (every complex value has
  real/imaginary parts; `~oo` has no direction); (b) bare `number` with
  gates recognizing the concrete value — the former status quo,
  workable, imprecise; (c) a `complex_infinity` singleton that names the
  region without moving it; (d) the `~oo` member of `infinity`, which
  the lattice flip made available and which subsumes (c). (d) was
  adopted with the flip.
- **RULED 2026-08-27, shipped 2026-08-28: the finite-by-default lattice
  flip** (`docs/TYPE_SYSTEM_ROADMAP.md` §8). Bare numeric types are
  finite-only; `±oo` moved out of `real`/`complex` into the `infinity`
  type, which sits beside the `nan` singleton under `number`; the
  extended real line is spelled `real | +oo | -oo` (the
  `EXTENDED_REAL_TYPE` constant — `real | infinity` would also admit the
  unsigned `~oo`). The five `finite_*`
  twins have retired: `finite_integer`, `finite_rational`,
  `finite_real`, `finite_complex` and `finite_number` remain
  parse-accepted deprecated aliases for one release cycle — normalizing
  to `integer`, `rational`, `real`, `complex` and `complex`
  respectively — and are never emitted. `non_finite_number` initially
  survived the flip, repositioned below `infinity` — and then RETIRED on
  2026-08-31 (the name was misleading: `~oo` and `∞ + i` are non-finite
  numbers, yet neither was a member). The signed pair is spelled
  `+oo | -oo`; the old name is a one-cycle parse alias for that union,
  never emitted. The flip amends §5's
  placement (the singletons stay; the directed infinities moved) and
  strengthens Contract B's carrier discipline (§4) by giving the
  precise carriers the short names.
- **RULED 2026-08-29: `IsPrime(-7)` is `False` — a prime is a positive
  integer greater than 1.** This is the general rule about per-operator
  conventions, settled on its type case. Where references diverge, the
  authority is this engine's own documented definition, not external
  agreement: Mathematica's `PrimeQ` accepts the negatives of primes
  (primality up to units), SymPy's `isprime` does not (naturals above 1).
  That is a definitional difference, not a mathematical indeterminacy, so
  "references disagree → return the marker" is NOT the rule — CE picks one
  definition, writes it in the operator's definition with the precedent
  cited, and the conformance suite pins it. External practice is evidence
  for the choice, never the decider. SymPy's convention was adopted: it
  keeps the uniform set-membership reading the predicate gives every other
  decidable non-member (`3.5`, `π`, `i`, `NaN` are all `False`), so no
  argument in the carrier is answered by inertness except one that could
  genuinely still be prime. `IsComposite` inherits it through its
  positivity test, so no negative integer is composite either. Recorded in
  `isPrime` (`src/compute-engine/boxed-expression/predicates.ts`) and
  pinned on all three routes in the conformance suite.
- **RULED 2026-08-27: a selection with no selected branch answers
  `Missing`** — unconditionally, not the type-directed marker of the
  arms. `Which()` (and `Which` where every guard is `False` or
  `Undefined`) and the else-less `If(False, x)` now both answer
  `Missing`, the position-preserving absent datum; both operators' scalar
  result types carry a `missing` arm exactly when no default clause
  exists. Before the ruling the two control operators disagreed (measured
  2026-08-26): `Which` answered `Undefined` — a fifth "no answer" citizen
  invented locally before the absence ruling — and `If` answered
  `Nothing`, the positional erasure marker §1 forbids as a
  failed-selection answer. Unchanged, deliberately: the masking
  `Undefined` of the `When` restriction operator (plot consumers skip
  masked points), decision 9's fall-through for an `Undefined` guard, and
  the element-wise no-match cell (`NaN` for numeric cells — `Missing`
  absorbed into a numeric domain, per the absence ruling). Pinned in the
  conformance suite (`test/compute-engine/error-model.test.ts`).
- **Container vs. cell validity (§3) — DEFERRED by ruling 2026-09-02.**
  Should a collection whose cells include errors eventually be a *valid*
  container of partially-invalid cells, with a type that says so
  (`list<number | error>`; `Length` answers the length, `Sum` demands
  every cell and answers the error, a plot draws the good cells)? Today
  one error cell makes the whole tree invalid: `[1, Sin("a"), 3]` has
  `isValid === false` and type `error`, and `Length` of it stays inert,
  while a NaN or `~oo` cell is an ordinary value (`[1, 1/0, 3]` is the
  valid `[1, ~oo, 3]`). Favored eventually by the 2026-08-25 review; it is
  a design touching the type lattice (an `error` cell type) and every
  collection consumer's per-cell demand, and no consumer has asked for it,
  so it stays open with no change scheduled.
- **FIXED 2026-09-02 (ruled the same day): `Length` and `Count` refuse a
  decided non-collection.** `Length(5)` and `Length(Missing)` — what
  `Length(First([]))` receives for an empty list — stayed inert on a
  decided question, which §1 forbids, while `Count(5)` already answered an
  `incompatible-type` Error and `Count(First([]))` answered that Error
  nested inside an unevaluated `Count`. Both now answer the bare Error, with
  one identical diagnostic: a number has no length, so asking for one is a
  defect in the program, not a partial function. The declared carrier of
  `Length` stays `(any)` (the IsPrime precedent: a declared parameter type
  is also what an undeclared argument symbol is inferred from); the
  evaluate handler mints the error for a value that refutes the collection
  contract (`nonCollectionSizeOperandError`, `collections.ts`). Strings
  keep their length; an undeclared or valueless collection-typed symbol
  stays inert; an operand that is already an error is not re-diagnosed.
  The ruling had named a third head, `Dimensions`; there is no such
  operator (the measured inertness was that of any undeclared head), and
  `Shape(5) = ()` keeps its documented APL semantics — a scalar has the
  empty shape — which is a design, not a defect.
- **FIXED 2026-09-02 (ruled the same day): an infinite leg dominates a NaN
  leg in every Euclidean norm, and `~oo` counts as infinite.**
  `Norm((+oo, NaN))` and `Abs` of that point answered NaN while
  `Hypot(+oo, NaN)` answered `+oo` under the IEEE rule ruled 2026-08-31;
  `Hypot(~oo, 3)` was an `incompatible-type` Error while `Norm((~oo, 3))`
  was `+oo`. One rule now: an infinite leg — signed or `~oo`, whose
  modulus is `+oo` by definition — makes the norm `+oo`; otherwise a NaN
  leg makes it NaN. `Hypot`'s carrier admits `~oo`. `Distance` follows
  the same rule by a follow-up ruling the same day: `Distance(p, q)` is
  `Norm(p − q)`, so `Distance((+oo, 0), (0, 0))` is `+oo` and
  `Distance((NaN, 0), (0, 0))` is NaN, in band, where a `!isFinite` guard
  used to answer an out-of-band `Error("expected-value")`.
- **FIXED 2026-09-02 (ruled the same day): a compiled `If`/`Which` takes
  no branch on an undecided condition.** The compiled JavaScript picked a
  branch by JavaScript truthiness — `If(x > 0, 1, -1)` at `x = NaN`
  returned `-1`, an unset boolean parameter returned the else arm — while
  the interpreter holds such an application inert. A compiled condition
  that is not exactly `true`/`false` now yields `NaN`, the numeric
  codomain marker, which is what the compiled element-wise `Which` already
  answers for a no-match cell. Weighed and not taken: throwing (a NaN
  sample in a drawing loop would abort the plot) and documenting the
  truthiness (a silently selected branch). An unsupplied variable reads
  as `undefined` whatever its declared type, so every numeric condition
  operand is guarded, `real`-typed ones included. Two follow-up rulings
  the same day: a STATEMENT-form `If` in a loop or block body executes no
  branch on an undecided condition and the body continues (the
  interpreter's inertness; "throw" and "keep truthiness" were weighed and
  not taken); and the `And`/`Or`/`Not` connectives, which short-circuited
  by JavaScript logic when every reached operand was undecided, now get a
  three-valued (Kleene) lowering — FIXED 2026-09-02, the same day: the
  condition compiles to a short-circuiting three-valued value (a
  decided-false guard never evaluates what follows it; an undecided one
  still does) and is selected through the value-shaped test, on the
  JavaScript and Python targets; `If(x > 0 ∧ y > 0, 1, -1)` at `x = 1,
  y = NaN` is `NaN`, at `x = -1, y = NaN` it is `-1`. A third follow-up
  ruling the same day settles the other compile targets:
  the Python target, which has a real NaN, takes the same operand guard;
  the GPU targets (GLSL/WGSL) keep JavaScript-style selection for now,
  because NaN propagation is not guaranteed on every driver, and stay on
  the ROADMAP item that records that reason. CORRECTION (measured
  2026-09-02): "the interpreter holds such an application inert" is true
  of an UNKNOWN operand (a free symbol), where the interpreter is Kleene;
  for a NaN VALUE the interpreter's ordered comparison answers `False`
  (IEEE) and `If(NaN > 0, 1, -1)` evaluates to `-1`, so the two lanes
  disagreed at a literal NaN. RULED 2026-09-03 (Arno): the INTERPRETER
  changes — a NaN operand of a branch condition is undecided, so the
  `If`/`Which` selects no arm (the comparison itself keeps its IEEE
  `False` everywhere else); the compiled lane's answer stands. Three
  companion rulings the same day: the three-valued lowering extends to
  IMPURE conditions (every leaf bound once — the triple-evaluation reason
  for the exemption no longer holds under the lazy shape); a repeated
  vars-object member read inside a guard stays free (a getter with
  effects is outside the compiled contract); a desugared `while` exit
  test keeps the no-arm rule (an undecided loop condition runs to the
  iteration cap).
- **FIXED 2026-09-02 (ruled the same day): a provably non-boolean
  condition is refused at boxing.** The 2026-08-31 inertness ruling
  removed the host throw that carried the only diagnostic for
  `Which(10, …)`. A condition whose static type is disjoint from `boolean`
  — a number, a string, a symbol declared with such a type — now becomes
  an `incompatible-type` error OPERAND at boxing, as a wrong-typed argument
  to `Sin` does, and the evaluate handlers propagate it as the demanded
  condition's error. A symbol of unknown type (a misspelled `Tru` is a
  free variable), a relation with free variables, a `missing`-admitting
  type, and a collection whose cells could be condition values (a list of
  booleans selects element-wise; a bare or `unknown`-element collection
  may) stay inert. A collection that can never select — a tuple, which
  binds whole; a set, a dictionary or a record; a string; an indexed
  collection with provably non-boolean cells such as `list<number>` or
  `range` — is refused like a scalar; an empty collection (`list<never>`)
  is not, since it has no cell to contradict and broadcasts to an empty
  result (`conditionOperand`, `control-structures.ts`; pinned in
  `test/compute-engine/condition-diagnostic.test.ts`). The check exposed
  one parser defect, fixed with it: a `\begin{cases}` row with a trailing
  `&` and an empty condition cell parsed to a `Nothing` condition — a dead
  row — and now parses to the `True` default clause.
- **The executable conformance suite EXISTS** (built 2026-08-26;
  146 tests as of 2026-08-29): `test/compute-engine/error-model.test.ts`
  — every row of the table above across the three construction routes
  (`ce.box`, `ce.parse`, `ce.function` with pre-boxed arguments), the §3
  propagation rules, the §5 `~oo` arithmetic, and the compiled-lane rows.
  The block that pinned the documented gaps as CURRENT behavior is gone:
  the rulings settled every gap it held, so those rows are ordinary
  conformance pins now, grouped under the rule that decides each. A new
  gap goes back into a labeled block naming the eventual behavior, and the
  pin is what measures the change. One negative finding worth keeping: the
  three routes AGREED on every probe in the canonical kit — no route
  divergence exists there today.

## Related documents

- `docs/COMPILATION-MODEL.md` — the normative fail-closed compilation
  contract this model defers to in §6.
- `docs/LANGUAGE-MODEL.md` — normative one-paragraph statements this model
  expands: error propagation, recovery boundaries, host-throw policy,
  lazy semantics.
- `docs/COLLECTIONS-MODEL.md` and `docs/BROADCAST-MODEL.md` — elementwise
  and broadcast behavior of the absence markers.
- `ARCHITECTURE.md` — the non-finite typing convention (ruled
  2026-08-21) that places `NaN` and `~oo` under `number` only.
- `src/common/type/types.ts` — the numeric tower.
- `src/compute-engine/boxed-expression/boxed-function.ts`
  (`_invalidValue()`, the handler crash-conversion wrapper) and
  `src/compute-engine/boxed-expression/error-value.ts` — the
  error-absorption implementation, its exceptions, and the validity walk.
- `src/compute-engine/library/collections.ts` (`absenceMarker()`,
  `markerType()`, `withMarker()`) — the type-directed absence marker,
  including the bounded runtime probe.
- `test/compute-engine/non-finite-typing.test.ts` — the pins for the
  `NaN`/`~oo` placement.
