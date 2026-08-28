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
is *about the program*, not about a mathematical value. Its consumer is a
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
`number`** — every numeric type below `number` excludes it (`complex`,
`real`, `rational`, `integer`, `non_finite_number` — which is `±oo`
exactly — and all the `finite_*` types). It shares that only-`number`
placement with `~oo` (`ComplexInfinity`), so `number − complex` contains
at least the two exceptional points `NaN` and `~oo`; the singleton types
of §5 give each a name. (The non-finite typing convention is in
`ARCHITECTURE.md`, "Non-finite typing convention for type handlers",
ruled 2026-08-21; `src/common/type/types.ts` documents the numeric
tower.) By the missing-value ruling of 2026-07-24 (next paragraph) `NaN`
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
  embedding editor mid-evaluation. *Proposed amendment:* keep the
  conversion (host resilience is right) but give it a distinct
  `internal-error` code carrying the stack, so an engine fault is never
  disguised as a user mistake.
- **A set of language-level contractual throws exists and is
  test-pinned**: the `Assign` redefinition discipline, function
  over-application ("Too many arguments"), the `If`-condition
  spell-check, a predicate returning a non-boolean (`Count`/`Filter`), a
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

## 3. Propagation — Settled, except the demanded-operands amendment (Proposed)

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
- **Lazy operators propagate only what they demand** — *Proposed
  amendment, 2026-08-25 review*. An error in an operand a lazy operator
  never demands does not bubble at evaluation:
  `If(True, 5, err).evaluate()` should be `5`. The boxed expression still
  carries the error for editor diagnostics — static analysis sees dead
  code; evaluation does not execute it. This matches the declared lazy
  semantics ("lazy in unselected arms", `docs/LANGUAGE-MODEL.md`). The
  dual obligation: a lazy handler that *does* demand an operand and gets
  an error must propagate it. Current behavior differs (§7).

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

Because errors absorb *before* ordinary handlers run, a **strict**
operator handler never receives an error operand and needs no error
tests; a **lazy** handler owns propagation for the operands it demands.
An operator that wants to *see* errors must be declared an observer. Any
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
`finite_rational<0..1>` for a proven-real argument, wide `number`
otherwise).

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
     discharge it and recover sharpness. `may-marker` also covers
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
Heaviside: (real) -> finite_rational<0..1>          // partiality: total
Sin:       (complex) -> finite_complex              // may-marker: sin(±oo) has no
                                                    //   limit; float overflow
Mod:       (real, real) -> real                     // definedWhen: b ≠ 0
```

with every `nanBehavior` above left to its derived default (`propagate`).

**The derived application type** follows from the three facts and stays
honest about what has and has not been proven:

```
S
  | marker(S)   while the partiality condition is not discharged
  | nan         while a propagating parameter might receive NaN
```

narrowing to exactly `S` only when *both* are discharged: the partiality
is `total` (or its predicate is proven for these arguments) *and* every
propagating slot's argument type excludes `NaN`. This needs the `nan`
singleton of §5 to be expressible — `finite_rational<0..1> | nan` says
vastly more than a collapse to bare `number`. `realOnlyStepType` is a
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
`Floor`/`Ceil`/`Round`, comparisons, `Sign` while it declines off-real)
declare `(real)`, and operators with a genuine complex extension (`Sin`,
`Sqrt`, `Ln`, `Exp`, `Arcsin`, `Erf`) declare `(complex)`.

The carrier is not "the narrowest interesting input" — it can push the
other way. **Predicates declare wide**: a membership-style predicate
(`IsPrime`, `IsInteger`, …) is a claim "x ∈ S", and `False` is a
*success* value, not a failure — "3.5 is not prime" is a well-formed true
sentence, so `IsPrime` is genuinely total on its numeric carrier and
declares `(complex) -> boolean` with `nanBehavior: handle` (explicit),
answering `False` for a provably non-integer argument, `NaN` included.
`IsPrime(~oo)`, by contrast, is an `Error` (outside the `complex`
carrier), and the asymmetry with `IsPrime(NaN) → False` is deliberate:
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
| Declared | `(number) -> number` | `(real) -> finite_rational<0..1>` · partiality `total` · `nanBehavior` derived (`propagate`) |
| What a user/doc/hover learns | nothing beyond "numeric" | domain, exact success values, NaN policy, totality |
| `Heaviside("banana")` | `Error` at boxing | `Error` at boxing |
| `Heaviside(i)` | admitted; inert forever today | `Error` at boxing |
| `Heaviside(~oo)` | admitted; inert forever today | `Error` — at boxing with the §5 singleton, at evaluation without it |
| `Heaviside(NaN)` | admitted; inert today | `NaN` at evaluation |
| `Heaviside(±oo)` | `1` / `0` | `1` / `0` (in-domain: `real` includes `±oo`) |
| `Heaviside(x)`, `x` unproven | `.type` = `number` (type handler) | `.type` = `finite_rational<0..1> | nan`, derived |
| `Heaviside(x)`, `x` proven real | `.type` = `finite_rational<0..1>` (type handler) | `.type` = `finite_rational<0..1>` exactly (total + `real` excludes `NaN`), derived |
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
the numeric-tower comment's decomposition `complex = finite_complex +
non_finite_number` under-counts — mixed directed infinities like `∞ + i`
are `complex` but in neither named part.)

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
stay sharp (`finite_rational<0..1> | nan` instead of a collapse to
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
every numeric signature reject its own outputs (`Sin: complex ->
finite_complex` no longer accepts `Sin(0/0)` as input to a further
`Sin`), and would pull `error` — deliberately outside `unknown` — into
the value lattice. `~oo` is likewise *not* an error and not a `nan`: it
is a definite point with defined arithmetic (`1/~oo = 0`, `2·~oo = ~oo`),
unlike `NaN`, which absorbs.

Amendment proposed 2026-08-26 — the finite-by-default lattice flip
(`docs/TYPE_SYSTEM_ROADMAP.md` §8). Under that proposal the bare
numeric types `integer`/`rational`/`real`/`complex` become finite-only,
and a new `infinity` type (whose members include the singletons `+oo`,
`-oo`, `~oo`) joins the `nan` singleton so the top decomposes as
`number = complex ⊔ infinity ⊔ nan`; the `complex_infinity` singleton
proposed above is absorbed as the `~oo` member of `infinity`. That
changes this section's settled placement premise — the directed
infinities would no longer inhabit `real`/`complex`, and the 2026-08-21
pins on `matches('real')` for `±oo` would flip — so the flip and this
document's §4/§5 proposals must be ratified together (or the flip
declined); see the open question in §7.

## 6. Interpreter vs. compiled code — Settled: compilation is fail-closed

Compilation policy is owned by `docs/COMPILATION-MODEL.md`, which is
normative and already answers this model's question: **a target emits
code only when it can preserve the interpreter's value, effects,
evaluation count, and error contract — it never emits plausible but
different code.** This error model adds nothing to that rule; it only
maps its channels onto it:

- A compiled expression may *erase* a check when static evidence proves
  it unnecessary. Note the direction of proof: a `finite_*` argument type
  proves no `NaN` *enters* through that slot; only a discharged
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

Probed 2026-08-24/25 against `src/` (route: `ce.box(json)` then
`.evaluate()` / `.N()`). "exact, unreduced" means the application
evaluated to its own exact symbolic form and awaits numericization (§1) —
it is not rule-7 inertness.

| Input | Boxed | `evaluate()` | `.N()` | Verdict vs. §2 |
| --- | --- | --- | --- | --- |
| `Sin("banana")`, `Sin(True)` | `Sin(Error(incompatible-type))` | `Error` | `Error` | conforms (rule 1) |
| `"banana" + 1` | `Error(…) + 1` | `Error` | `Error` | conforms (rules 1, §3) |
| `Sum(["a", "b"])` | inert (element type indeterminate) | `Error(incompatible-type)` | `Error` | conforms (rules 2, 6) |
| `1/0`, `Factorial(-2)` | `~oo` | `~oo` | `~oo` | conforms (rule 3) |
| `Arcsin(2)` | exact, unreduced | exact, unreduced | complex value | conforms (rule 3) |
| `Ln(0)` | exact, unreduced | `-oo` | `-oo` | conforms (rule 3) |
| `Mod(1, 0)` | inert | `NaN` | `NaN` | conforms (rule 4) |
| `At([1,2], 99)` | inert | `NaN` | `NaN` | conforms (rule 5, numeric elements) |
| `First([])` | inert | `Missing` | `Missing` | conforms (rule 5) |
| `Sin(NaN)` | inert | inert | `NaN` | **gap** (below) |
| `Heaviside(NaN)` | inert | inert | inert | **gap** (below) |
| `IsPrime(3.5)`, `IsPrime(π)`, `IsPrime(i)`, `IsPrime(NaN)` | inert | inert | inert | **gap** (should be `False`, §4 predicates) |
| `If(True, 5, err)` | error preserved in place | `Error` | `Error` | **gap** under the demanded-operands amendment (should be `5`) |
| `Sum(x, (n, 5, 1))` | inert | `0` | `0` | conforms (rule 3, empty range) |

Conformance gaps (deficiencies under this model; listed for ratification
because current behavior might be a deliberate decline):

- **`Sin(NaN)` should evaluate to `NaN` under `evaluate()`.** `NaN` is a
  float, and by the exactness contract (§2) a numeric function of an
  inexact argument numericizes under `evaluate()`; per-slot `propagate`
  says the same. The aggregates already behave this way
  (`Max(1, NaN, 3) → NaN`).
- **`Heaviside(NaN)` is inert even under `.N()`** — same class, stricter
  symptom; under §1 this makes inertness a terminal answer to a decidable
  question.
- **`If(True, 5, err)` evaluates to the error today**; under the
  demanded-operands amendment (§3) it should evaluate to `5` while the
  boxed form keeps the diagnostic.
- **Native handler faults are converted to plain user-facing errors
  today** (`boxed-function.ts` crash-conversion); under the §1 amendment
  they should carry a distinct `internal-error` code with the stack.
- **`markerType()` answers `number` where the concept says `nan`**
  (`collections.ts`) — sharpens only after the §5 singleton lands.
- **CONFIRMED 2026-08-26: `compile(Heaviside)(NaN) → 1`** — a fail-closed
  violation (§6). Root cause: the JavaScript kernel
  `heaviside: (x) => (x < 0 ? 0 : x === 0 ? 0.5 : 1)`
  (`compilation/javascript-target.ts:6069`) falls through to `1` for `NaN`,
  while the interpreter stays inert. The interval-JS and GPU targets carry
  sibling lowerings, unprobed. Fix gated on the NaN-policy ruling; tracked
  in `ROADMAP.md`, pinned in `test/compute-engine/error-model.test.ts`.
- **A second compiled-lane divergence, found by the suite: `compile(1/x)`
  at `x = 0` answers IEEE `Infinity` where the interpreter answers `~oo`**
  — different mathematical points; feeds the "where does `~oo` belong"
  question below. Tracked in `ROADMAP.md`, pinned in the suite.
- **The table above conflates two boxing behaviors**: `1/0` folds to `~oo`
  AT BOXING, but `Factorial(-2)` boxes as an unevaluated application and
  reaches `~oo` only at `evaluate()`. Both conform to rule 3; the shared
  "Boxed: `~oo`" cell is wrong for `Factorial`.

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
- **How do callables carry their policies?** (Implementation design,
  §4.) Options: policies as effects/refinements in the function type;
  definition metadata attached to callable values; or only the
  conservative floor (an unknown or user-defined callable is
  `may-marker` with unknown NaN behavior). The floor is mandatory under
  any representation; the question is how much precision higher-order
  code — `Map`, callback validation, compilation — can recover.
- **Where does `~oo` belong?** Options: (a) inside `complex` — rejected
  above: it reverses the 2026-08-21 ruling and breaks `complex`'s
  structural promise (every complex value has real/imaginary parts; `~oo`
  has no direction); (b) bare `number` with gates recognizing the
  concrete value — the status quo, workable, imprecise; (c) the
  `complex_infinity` singleton of §5 — recommended: names the region
  without moving it; (d) the `~oo` singleton member of the `infinity`
  type, if the lattice flip (next item) is adopted — it subsumes (c).
  Deciding nothing keeps (b).
- **The finite-by-default lattice flip**
  (`docs/TYPE_SYSTEM_ROADMAP.md` §8, proposed 2026-08-26). Bare
  numeric types become finite-only; `±oo` move out of `real`/`complex`
  into a new `infinity` type that sits beside the `nan` singleton
  under `number`; the extended real line is spelled `real | infinity`;
  the `finite_*` twins and `non_finite_number` retire. It amends §5's
  settled placement (the singletons stay; the directed infinities
  move) and strengthens Contract B's carrier discipline (§4) by giving
  the precise carriers the short names. Ratify together with Contract
  B as one package or decline both parts of the coupling: adopting the
  flip while keeping Contract A would change what `oo.matches('real')`
  answers with no compensating signature story. Deciding nothing keeps
  today's tower.
- **Choose and document per-operator conventions where references
  diverge** — the authority is this engine's own documented definition,
  not external agreement. `IsPrime(-7)` is the type case: Mathematica's
  `PrimeQ` accepts negatives (primality up to units), SymPy's `isprime`
  does not (naturals > 1) — a definitional difference, not mathematical
  indeterminacy, so "references disagree → return the marker" is NOT the
  rule. CE picks one definition, writes it in the operator's definition
  with the precedent cited, and the conformance suite pins it. External
  practice is evidence for the choice, never the decider.
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
- **Container vs. cell validity (§3)** — should a collection whose cells
  include errors eventually be a *valid* container of partially-invalid
  cells, with a type that says so? Favored eventually by the 2026-08-25
  review; not current behavior; needs a design.
- **The executable conformance suite EXISTS** (built 2026-08-26):
  `test/compute-engine/error-model.test.ts`, 117 tests — every row of the
  table above across the three construction routes (`ce.box`, `ce.parse`,
  `ce.function` with pre-boxed arguments), the §3 propagation rules, the
  §5 `~oo` arithmetic, and six compiled-lane rows. Documented gaps are
  pinned as CURRENT behavior in a labeled block: changing them requires
  ratification, and the pin is what measures the change. One negative
  finding worth keeping: the three routes AGREED on every probe in the
  canonical kit — no route divergence exists there today.

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
