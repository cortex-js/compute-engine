# First-boxing binding divergence (Tycho item 178(a)+(c))

**Status:** FIXED 2026-08-13 (attempt 3 below — detect-and-rebuild in
`EngineBoxingState`). Attempts 1 and 2 are kept as the record of what the fix
must NOT do; the acceptance criterion history is kept because it cost two
drafts to get right.

**Filed as:** Tycho items 178(a) (`Integrate` with symbolic limits) and 178(c)
(`PointList(∫…)`), in `docs/COMPUTE_ENGINE.md` of the Tycho repo. They are one
defect; the two filings are two surfaces of it.

**Repro:** `docs/scratch/ce-item178ac-boxing-determinism.mts` (four
`ComputeEngine`s, no corpus).

## The symptom

Boxing the same MathJSON twice, on the same engine, can produce two expressions
that are not `isSame`:

```js
const J = ['List',
  ['Integrate', ['Function', ['Block', ['n', 'x', 'y_r']], 'x'],
                ['Limits', 'x', -10, 10]],
  'y_r'];

ce.box(J).isSame(ce.box(J));   // false
```

It stabilizes immediately: `box2.isSame(box3)` is `true`. Only the FIRST boxing
of a given shape is the odd one out.

The MathJSON of all three is byte-identical, and the hashes are equal — it is
purely a binding-identity difference.

## What it requires

Measured, not assumed:

| shape | `box×2` `isSame` |
| --- | --- |
| symbol occurs inside a binder's scope **and** outside it | **false** |
| symbol occurs only inside the binder | true |
| no binder involved | true |
| symbol pre-declared with `ce.declare()` before boxing | true |

So the trigger is: **a not-yet-declared symbol occurring both inside a binder's
scope and outside it.**

## The mechanism

The first boxing auto-declares the symbol as a side effect — it is undeclared
before the call and declared after. The two occurrences do not agree during
that first call:

```
box1 (first ever):  inner def === outer def ?  false
box2:               inner def === outer def ?  true

box1.inner def === box2.inner def ?  false     <- the transient one
box1.outer def === box2.outer def ?  true      <- stable
```

During the first canonicalization the occurrence INSIDE the binder's scope
auto-declares into a scope local to that canonicalization, while the sibling
outside auto-declares into the enclosing scope. From the second boxing on the
name already exists in the enclosing scope, so the inner occurrence resolves to
it instead of creating a local — and the resulting tree differs from the first.

In other words the **auto-declare target depends on whether the name already
exists**, which makes the first canonicalization of a shape structurally
different from every later one.

This maps onto both filings: in (a) `x` is in the integrand and in the bounds
(`a` was the first boxing, `b` the parse); in (c) `y_r` is in the integrand and
a `List` sibling (`a` and `b` agreed, but `box(b.json)` was a third
construction).

## Why it matters beyond the four corpus rows

`CLAUDE.md` documents `.isSame()` as "an unconditional equivalence relation, so
it is safe as a dedup/matching key." That is not currently true: for a shape
carrying a not-yet-declared symbol in this configuration, the first-ever boxing
fails to match every later one. Any dedup, memo or match keyed on `isSame`
across a first registration pass can silently miss.

## Candidate fixes

Not yet chosen. Each needs the full suite plus a snapshot blast-radius count.

1. **Declare before binding occurrences.** Hoist auto-declaration of a free
   symbol to the enclosing scope BEFORE canonicalizing the subtree, so the
   inner and outer occurrences resolve to the same binding on the first pass.
   Most direct; the risk is that it changes which scope owns a name in shapes
   where a binder-local really is wanted, and closure capture relies on free
   variables auto-declaring in the innermost function scope
   (see `createSymbolExpression`, `engine-expression-entrypoints.ts`).
2. **Re-resolve after the pass.** Let the first pass proceed, then re-bind
   occurrences whose auto-declared local was superseded by an enclosing
   declaration. Contained, but adds a fix-up pass and a second source of truth.
3. **Make the target unconditional.** Choose the auto-declare scope from the
   expression's structure alone, never from whether the name happens to exist
   yet. Cleanest statement of the invariant — the auto-declare target must not
   depend on engine history — but likely the widest blast radius.

### Attempt 1 (2026-08-13): promote free body symbols outward — REJECTED

Implemented and measured, then reverted. Recording it so the next attempt does
not repeat it.

**What was tried.** A function body's `Block` scope cannot be marked
`noAutoDeclare` (that flag is read by the PARAMETER branches of
`createSymbolExpression` too, and promoting a parameter out of its own body is
exactly wrong). So the body was recognized from the shadowed-parameter stack —
each frame recording the lexical scope in force when the body's canonicalization
began — and a genuinely free symbol auto-declared into the scope enclosing the
OUTERMOST literal instead of into the body scope.

**It worked on the target invariant and preserved capture.** Seven
closure-capture probes
(`docs/scratch/2026-08-13-closure-capture-invariants.mts`) were recorded before
and after; the only line that moved was the defect —
`ce.box(J).isSame(ce.box(J))` false → true. Type behaviour was untouched
(witness and control both moved exactly as before), which is the measurement
that refuted the claim that the witness's type movement was this same leak.

**Why it is rejected: it violates a deliberately pinned contract.** Promoting a
free body symbol outward LEAKS the name into the enclosing scope. Five tests
fail on a quiet machine (zero snapshot churn), and the decisive one is explicit:

```js
const t = ce.box(['Function', [op, ['List', 1, 2], 'q'], 'xs']).type;
expect(t.toString()).toContain(') any ->');
// …and the READ itself declared nothing.
expect(ce.lookupDefinition('q')).toBeUndefined();
```

(`test/compute-engine/design-d-callback-contract.test.ts`, and the ASYNC LANE
suite's "the index does not leak into the global scope" guards the same
property.) Boxing a function body must not declare its free symbols anywhere the
caller can see. The other four failures — callable-transition invalidation, CSE
over a forward-referencing definition, callback-list purity — are the same leak
reaching effects and forward-reference machinery.

**What this rules out.** Any fix that resolves the asymmetry by moving the
DECLARATION outward. The asymmetry must instead be resolved in a direction that
leaves the body's free symbols exactly as invisible as they are today — which
means the sibling occurrence outside the binder is the side that has to change,
or the two have to be reconciled without either becoming globally visible.

**Method note:** `CLAUDE.md` says to grep for a pin locking the odd side BEFORE
writing a fix. That was not done here, and it is what the detour cost.

### Attempt 2 (2026-08-13): keep it body-local, ignore auto-declared outward
### candidates — ALSO REJECTED

Reading the pins first paid off twice, and then the attempt still failed.

**What the pins bought.** Paper reasoning said two independently-created
body-local definitions could not compare equal (`sameBinding` falls through to
`sameBindingDef` for a free symbol). **That was wrong, and measuring it is what
unlocked the attempt:** `box(F).isSame(box(F))` is TRUE for
`Function(Multiply(x, y_r), x)` even though the two body-local definitions are
different objects, and `y_r` stays invisible to `lookupDefinition`. So the
defect is a mismatch of KIND — one pass body-local, the other resolving outward
— not of identity.

**What was tried.** Inside a function body, ignore an outward candidate whose
binding is auto-declared (`inferredType === true`) and take the body-local route
instead; resolve outward only to a STATED binding (explicit `declare`/`assign`
or a library symbol, both `inferredType === false`).

**It fixed all four filed families, including the two attempt 1 could not
reach.** (a), (b), (c) and (d) of Tycho item 178 all passed — `isSame`, `hash`,
`.json` and `box(json)` agreeing — and the seven closure-capture probes were
unchanged, with only the defect line moving.

**Why it is rejected: `inferredType` is the wrong discriminator.** It does not
mean "auto-declared scratch binding"; it also marks a symbol that was
auto-declared and THEN ASSIGNED A VALUE — which is exactly the declare-then-
assign registration style the Tycho importer uses. 28 tests fail on a quiet
machine (still zero snapshot churn), and the diagnostic one names it:

```
● a lambda body with an unbound free symbol
  › sees a free symbol reachable only through an assigned value
```

The rest cluster where that severed capture reaches: CSE and compile regions,
recursive definitions, `Map` element memo, element-type inference for
parameters, and the item-127 dependency-precise invalidation suite.

**What this rules out.** Any discriminator based on how the outward binding was
CREATED. `inferredType` and the provenance `'auto-declared'` kind both persist
after the symbol acquires a value, so neither separates "scratch binding my own
sibling just made" from "document variable that happens to have been inferred".
The boxing epoch does not separate them either: the sibling's binding is created
in the SAME pass on the first boxing and in an EARLIER pass on every later one,
so an epoch test flips exactly the wrong way.

### Where that leaves it

Two attempts, from opposite directions, both measured and both rejected:

| attempt | direction | verdict |
| --- | --- | --- |
| 1 | promote the body's declaration outward | leaks the name to the caller — 5 pinned tests |
| 2 | keep it body-local, ignore auto-declared outward candidates | severs capture through assigned values — 28 tests |

The asymmetry is inherent to "on the first boxing nothing exists yet", and no
local rule at the auto-declare decision point separates the two cases, because
by the time the body asks, the sibling's binding is indistinguishable from a
genuine one.

That points at a PRE-PASS rather than a decision-point tweak: collect the
expression's free symbols and settle their bindings BEFORE canonicalizing any
part of it, so both boxings begin from identical state. That is an
architectural change to the boxing entry point, not a local fix, and it should
be designed deliberately — including what it means for `autoDeclare: false` and
the resolve-only depth, which exist precisely to suppress declarations during a
read.

**A mechanism for (3) is arriving from elsewhere.** Phase 1 of
`docs/plans/2026-08-13-inference-provenance-journal.md` adds an
`'auto-declared'` provenance kind, recorded at the auto-declare path in
`engine-expression-entrypoints.ts` with the boxed expression as its cause. That
makes "was this binding pre-existing, or created by the pass currently running?"
answerable from provenance alone — which is precisely the history-independence
predicate (3) turns on, and it does not depend on the transaction primitive
landing.

**The predicate is now O(1) — use `entry.epoch`, not a containment walk.**
Phase 1 landed a boxing epoch after this fix asked for one:
`TypeProvenanceEntry.epoch === ce._boxingEpoch` iff the entry was recorded by
the outermost pass running now (`_boxingEpoch` increments on the
`_inferenceTxDepth` 0→1 transition). `epoch === undefined` means the write
happened outside any boxing pass — a few `assume` routes — and only there does
the containment fallback apply.

Verified on this defect's own witness, epoch and containment agreeing:

```
_boxingEpoch after box1 / box2 : 26 / 27
all four occurrences' auto-declared entries : epoch 26   (created during pass 1)
as of pass 2: "created by THIS pass?"  epoch says false, containment says false
defect still reproduces: true            (instrumentation has not perturbed it)
```

Within one pass the epoch does not distinguish "created a moment ago" from
"created earlier in this same pass" — and it must not: same-pass is exactly the
case this fix wants to treat as shareable.

**Ordering agreed 2026-08-13 with the inference-provenance owner, and recorded
on both sides** (their copy is in that plan's phase-1 data-model section):

- **They go first.** The `'auto-declared'` provenance write is ADDITIVE — it
  records a kind at an existing decision point. This fix CHANGES what that
  decision point does, so rebasing the scope-target change onto the provenance
  write is cheaper than making them resolve a conflict against a moved target.
- **Mutual ping before either side opens `createSymbolExpression`.** Both
  changes land in the same function, within roughly the same lines.
- As of 2026-08-13 their phase 1 has NOT started and is gated on their user's
  go-ahead; this fix is gated on the inference question in the section below.
  Neither side is blocked on the other — the ordering only settles who edits
  that function first if both become actionable.

Whichever is chosen, the invariant to pin is: **`ce.box(J).isSame(ce.box(J))`
for every J, on a fresh engine, independent of call order.** That is a property
worth testing directly rather than through any one witness.

### Attempt 3 (2026-08-13): detect the conflict, rebuild the construction —
### SHIPPED

The pre-pass idea above assumed the free symbols had to be settled BEFORE
canonicalization, which requires recognizing binder positions in raw MathJSON
(Function bodies, `scoped` operators' binding sites, parse sugar, held
operands) — a walker whose conservative gaps would each leave a shape
divergent. The shipped fix inverts it: let the first pass run, DETECT that it
diverged from what every later pass would do, and run the construction again.
The second pass starts from exactly the state every later boxing starts from,
so its output is the stable one by construction — no resolution rule changes,
nothing new is declared, and no discriminator inspects how a binding was
created (the trap both prior attempts died on).

The vehicle already existed: `EngineBoxingState`
(`engine-boxing-state.ts`) rebuilds a root boxing construction when the
un-applied-operator repair invents a binding partway through — the same
symptom family ("occurrences boxed before the binding existed keep a
different binding; byte-identical MathJSON compares `isSame` false"), and its
contract already requires builds to be side-effect-free-except-boxing,
i.e. redo-safe. The fix adds a second trigger to that machinery:

- **Classifier.** `withDevolveRepair` (`box.ts`) captures, at root
  construction entry, which scopes PRE-EXIST the construction: anything on
  the engine's current lexical chain or on the caller-supplied `scope`
  option's chain. Scopes created during the construction (a binder body's
  scope, recreated fresh by every boxing of the same input) are never
  members of those chains. `parent` links are immutable, so the chains can
  be walked lazily at query time.
- **Record.** The free-symbol auto-declare branch of
  `createSymbolExpression` (`engine-expression-entrypoints.ts`), when its
  target scope is construction-created, records the name
  (`noteTransientAutoDeclare`). The PARAMETER branches do not record:
  parameters shadow unconditionally on every pass, so they never diverge.
- **Trigger.** `declareSymbolValue` / `declareSymbolOperator`
  (`engine-declarations.ts`) report every declaration to
  `noteDeclarationIn(scope, name)`: if the running construction had
  transiently auto-declared the same name and the target scope outlives the
  construction, the root frame's rebuild is requested. The rebuild converges
  in one pass — the persistent binding now exists before any occurrence is
  processed, so the transient auto-declare cannot recur (same argument as
  the sibling-first operand order being clean).

Measured on the shipped change:

- The witness flips false → true; sibling-first, no-binder, inside-only and
  pre-declared controls all stay true; the Block-statement cousin
  (`List(Block(m+1), m)` — same divergence via a Block scope instead of a
  function body) is fixed by the same mechanism with no binder-kind
  enumeration; box-vs-parse of the 178(a) integral agrees.
- All seven closure-capture invariant probes
  (`docs/scratch/2026-08-13-closure-capture-invariants.mts`) unchanged; only
  the defect line moved. The attempt-1 leak pins and the attempt-2
  assigned-value-capture cluster pass.
- Type movement (the withdrawn criterion below) is untouched, as required.

Pinned in `test/compute-engine/first-boxing-determinism.test.ts`: the
witness, both operand orders, the Block cousin, box-vs-parse parity, the
no-leak contract from attempt 1, the assigned-value capture contract from
attempt 2, and the two-bodies-no-sibling shape (stable AND undeclared).

## The type criterion, corrected

An earlier draft of this note added a second criterion: that the inferred type
be pinned at the PRECISE value (`finite_integer`) rather than the degraded
`number` a later boxing produces. **That criterion was wrong, and pinning it
would have contradicted the engine's own inference model.**

Inference is order-sensitive, but NOT because it is one-shot. An earlier draft
of this section said "first evidence wins and is never refined"; that is wrong.
`docs/TYPE_SYSTEM_ROADMAP.md` §1 states the model: inference of unannotated
symbols is "evidence-based and *revisable* (narrow from argument use, widen from
value assignment, non-monotone override per D11, forward-ref re-derivation)
rather than a once-and-final principal type". The order-sensitivity falls out of
those DIRECTION rules, not from an absence of revision.

Measured on a fresh engine with `x` pre-declared `number`, so only the order
varies:

```
usage then assignment :  number     (x·v boxed first, then v := 5)
assignment then usage :  integer    (v := 5 first, then x·v boxed)
value in both cases   :  5
```

So `number` is not a degraded answer; it is what the model returns once a
numeric-context use has been seen first. The item-178 type observation is the
same first-boxing state leak wearing a different hat: on the first boxing the
outer occurrence's binding sees only the assignment, while on later boxings the
shared binding already carries the body's usage evidence.

**SECOND CORRECTION, 2026-08-13 — the type criterion is WITHDRAWN entirely, and
the acceptance criterion for this fix is (1) alone.** A draft of this section
replaced the value-pinning criterion with a consistency one ("identical across
boxings"). The Tycho team's type-stability audit refuted that too, and their
order matrix reproduces here verbatim on the published 0.105.0
(`docs/scratch/ce-item178-type-stability-order-matrix.mts` in their repo):

| ordering | witness (binder) | control (NO binder) |
| --- | --- | --- |
| assign-first, boxings 0/1/2 | `integer` at every count — stable | `integer` at every count — stable |
| box-first, boxings 0/1/2 | `integer` → `finite_integer` — MOVES | `integer` → `number` — **MOVES** |
| no declaration event at all | stable at every count | stable at every count |

Two things follow, and both cut against what this note previously said:

- **Pure boxing count moves nothing.** The movement needs a DECLARATION EVENT
  landing after a boxing. "Identical across boxings" therefore passes
  *vacuously* on 0.105.0 — it would have been a criterion no fix could fail.
- **It is not binder-specific.** The no-binder control moves too. So this fix
  CANNOT deliver type stability, and pinning it here would pin something the
  change has no power over.

**My earlier "control" was inadequate, and the reason is worth keeping.** It was
`List(z_q, z_q)` — two bare symbols with no numeric USE, so there was no
evidence to narrow from and nothing could have moved. "Stable" was uninformative
for the same reason the `v!` probe was: a control has to be capable of showing
the effect. Tycho's control (`List(Add(n, y_r), y_r)`) supplies the use and does
move. This is the no-move-control trap in its second costume, caught by them
one exchange after I handed it to them.

What the binder actually contributes is DECOUPLING, not movement: with a binder
the sibling's type stops tracking the body's evidence. That decoupling is what
makes their one live classification gate reachable (their D-235), which is why
the audit was worth running even though it cost me a criterion.

**Criterion (1) survives and is binder-specific**, control-verified on the
published bundle: `box(J).isSame(box(J))` is `false` for the binder witness and
`true` for both the no-binder control and my old one. That is the defect this
fix owns, and the only thing it should be judged on.

The residual type movement is explained by the documented direction rules and
is NOT a defect: box-first lets a numeric use narrow the symbol to `number`
first, after which an assignment cannot narrow it back to `integer`;
assign-first fixes `integer` first, and a use does not widen. See
[[reference_inference_direction_rules]] — same fixpoint, reached from a
different starting order.

**Adjacent finding, and it is behaving as §1 describes — not a defect.** The
direction rules were probed individually
(`docs/scratch/2026-08-13-inference-direction-rules.mts`):

| probe | control on a fresh symbol | result |
| --- | --- | --- |
| widen from value assignment (`v := 5` then `v := 2.5`) | — | `integer` → `real` ✓ |
| narrow from argument use, starting at `unknown` | — | `unknown` → `number` ✓ |
| narrow further via a declared signature (`g(v)` after `x·v`, `g: (integer) -> integer`) | `g(v)` alone pins `integer` | `number` → `integer` — DOES narrow |
| narrow further via an operator context (`Fibonacci(v)` after `x·v`) | `Fibonacci(w)` alone pins `integer` | `number` → `integer` — DOES narrow |
| narrow further via `v!` after `x·v` | `w!` alone pins `number` — **vacuous** | no move, but the probe could not have shown one |
| narrow from a value assignment (`v := 5` after `x·v`) | — | `number` → `number` — excluded, as §1 implies |

So a use narrows an unannotated symbol, **including narrowing one that is
already narrowed**, through both the declared-signature and operator-context
routes; an assignment widens and never narrows. Order-sensitivity is the
fixpoint of those rules rather than a missing revision step, and `number` after
a numeric use is the model's answer, not a degradation.

**An earlier revision of this table claimed a later use never narrows further.
That was wrong, and the reason it was wrong is worth keeping:** the `v!` probe
that "showed" it is VACUOUS — `Factorial` contributes `number`, not `integer`,
so a fresh-symbol control also pins `number` and "no move" was the expected
outcome either way. Refuted by the named-arguments session with the declared-
signature probe; the operator-context row above is the follow-up that closes the
route-split question they left open (there is no split — `Fibonacci` is a
non-vacuous operator context and it narrows too).

**General trap this cost us:** a "no move" probe proves nothing unless a
fresh-symbol control shows the probe WOULD have moved the type from `unknown`.
Always run the control.

The one question the table leaves open is whether an assignment SHOULD be
allowed to narrow — §1 excludes it, and it is not obvious that is deliberate
rather than inherited. That is a type-system question, not a binder-scope one,
and the inference-provenance work
(`docs/plans/2026-08-13-inference-provenance-journal.md`) is where it becomes
answerable, since provenance is what would let a write know whether the
incumbent type came from a use or from a value.

## Related

- The closure-capture machinery this must not disturb:
  `createSymbolExpression` in `engine-expression-entrypoints.ts`, and the
  shadowed-parameter stack it consults.
- Sibling defects fixed in the same round, both already landed: item 178(b)
  (one exact integer had two storage forms — `exact-numeric-value.ts`) and
  178(d) (`.structural` re-sorted a canonical expression's operands —
  `boxed-function.ts`).
