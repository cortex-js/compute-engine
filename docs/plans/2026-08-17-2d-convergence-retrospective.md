# Invariants by construction — why work package 2D took seven review passes

**Date**: 2026-08-17 · **Status**: RETROSPECTIVE (2D shipped in 0.115.0) ·
**Subject**: `resettleTypeConformances` and the widening-refusal machinery in
`src/compute-engine/engine-protocols.ts` · **Companion to**:
`docs/plans/2026-08-13-mutable-objects-implementation-plan.md` (the plan 2D
closes) and `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B (the spec).

This is a process retrospective, not a design document. It exists because the
review loop this project runs on — an implementer plus two independent
reviewers, merged and applied, repeated — did not converge on 2D, and the way
out generalizes to any work package with several interacting sub-mechanisms.

## What 2D was fixing

Re-declaring an object type in a later batch (`type P = object{…}`) never
re-ran the conformances attached to it. Four defects, all probed on a live
engine before any code was written:

1. Drop a required field: the conformance still claimed to be satisfied, and a
   newly built instance answered the protocol property with silence rather than
   an error.
2. Retype a field from `string` to `integer`: a read declared `integer`
   returned `"s"` — a type-soundness hole.
3. Add the field a conformance was waiting for: it stayed pending forever, and
   every batch re-warned about a requirement that was now met.
4. Redefine `object{…}` as `record{…}`: the B1 mutability gate was never
   re-applied.

The fix is a sweep — re-settle every edge that depends on the redefined type,
plus a pinned-layout check on field-backed reads so an old instance cannot
answer for a shape it no longer has.

## The loop that would not close

| Pass | Findings | High | Where the high landed |
| ---: | ---: | ---: | --- |
| 1 | 12 | 1 | Re-settle skips the effect-widening guard the three registration routes run |
| 2 | 10 | 1 | A widening violation rolls back the whole sweep, undoing unrelated de-activations |
| 3 | 11 | 1 | Pinned layouts are shallow: an alias redefinition leaks an old slot under a new type |
| 4 | 12 | 2 | Two edges jointly breaking one contract are both let through; undecided value types wrongly refused |
| 5 | 11 | 2 | The sticky-refusal stamp is stolen from a sibling edge every sweep; the joint fallback refuses innocents |
| 6 | 13 | 1 | A refused re-activation leaves its inheritors falsely satisfied |
| — | — | — | *mechanism restructured around its invariants* |
| 7 | 8 | 2 | Soundness holds only by accident; the invariant test guarding it cannot fail |

Seventy-seven findings, all applied. The total drifted sideways and the
high-severity count never reached zero — but the diagnostic signal was not the
count. It was the location: every high landed in the same few hundred lines,
namely the widening refusal, the inheritance pass beside it, and the
bookkeeping that records why an edge is pending.

**Track where findings land, not only how many there are.** A flat count with a
non-zero serious tail concentrated in one region is a design-coherence problem
wearing the costume of a fixing problem.

## Why an incremental loop cannot close that

Each round fixed the finding in front of it, correctly, and against the
neighbouring code *as it stood that round*. Nobody re-checked the whole, so
interaction bugs were produced at roughly the rate they were removed:

- A sticky stamp, added in one round so a refusal would not be recomputed every
  sweep, became the stamp-stolen-from-a-sibling-edge bug two rounds later.
- An inheritance repair, bolted on after the refusal, became the
  stranded-inheritor bug the round after that.

The original design pass had also gone stale: it predated the widening guard,
the pending reasons and the inheritance re-runs entirely, so it described a
smaller machine than the one that existed by round four. There was no document
and no agent holding the mechanism whole.

## The intervention

A fork carrying the full session context — every finding and every fix already
in its history — was asked for four things, in order, and deliberately was
**not** handed the findings list:

1. State the invariants the mechanism guarantees at exit.
2. Trace the code against each and mark it *holds*, *holds only by accident*,
   or *violated*.
3. Simplify wherever the structure fights an invariant, rather than patching
   around it.
4. Write tests that fail when an invariant breaks.

The brief also carried an explicit fallback — if precise attribution could not
be made coherent, shrink the design (refuse the whole re-activated set with one
joint reason: simpler, sound, less precise) and bring that back as a ruling.
It was not needed, but stating it is what stops a fork from patching to
preserve a design nobody has ruled on.

## What came out

The sweep became five ordered steps, and the order *is* the design: authored
verdicts, then the widening refusal, then inheritance computed **once** over
final verdicts, then reasons **last** over the final state, then announce only
if something moved. The invariant block now at the top of
`resettleTypeConformances` states it as: *each invariant is established by
construction rather than repaired afterwards.*

| | Before | After |
| --- | --- | --- |
| Ordering | Inheritance granted before refusals, then repaired | Inheritance computed once, after refusals are final |
| Refusal | Per-edge trial, a joint fallback, a minimality pass, compared by violation *count* | One procedure: undo all, measure a baseline, hand edges back one at a time, keep each that introduces nothing |
| Memory | A stamp remembered refusals between sweeps, with clearing rules | None — every sweep re-derives |
| Reasons | Stamped at five call sites | One final pass over the final state |

The refusal procedure is a greedy hitting set, and it ships with an argument
rather than a suite's worth of confidence: dispatcher effect sets are unions
over **all** non-pending edges, so fulfilling an edge can only add to them.
Monotonicity gives soundness and minimality directly — and it also proves that
a "joint cause" cannot exist, since if neither edge exceeds a fixed ceiling
alone the pair cannot either. Two earlier rounds had built code, tests and
documentation for that unreachable state.

Four recurring bug classes closed at once: count-versus-set attribution, the
joint-cause fallback, the stamp, and the inheritance repair. The first
simplification round was a net deletion.

## What the review found afterwards, and why it is the success signal

The final pass still found two highs, so the honest headline is not that the
restructure ended the findings. It changed their *kind*:

- **The soundness invariant held by accident.** Step one mutated edges without
  bumping the version the effect memos are keyed on, so the first widening
  query could be served a stale answer and skip the refusal entirely. It worked
  only because the caller happened to churn a different counter first. The fix
  is one line plus a sentence in the invariant comment recording that I3
  depends on it.
- **The test guarding that invariant could not fail.** It read back the
  *declared* annotation — which is the annotation, whether or not the contract
  is currently falsified — instead of comparing the declaration against the
  derived effects.

Both are the signature of a mechanism that has become legible: you can ask
whether an invariant holds and get a specific answer about where and why. A
zero-finding pass is not the bar; a change in the kind of finding is.

## Lessons

- **Three consecutive highs in one region is the trigger.** Stop dispatching
  fixes at that point, not later.
- **Fork rather than start fresh.** A fork inherits every finding and every
  fix; a fresh agent needs a briefing, and the briefing is the artifact that
  keeps going stale.
- **Brief the holistic pass with invariants, not findings.** Handing over the
  findings list reproduces the loop being escaped.
- **One correctness argument beats a stack of patches.** Monotonicity closed
  four bug classes and deleted a special case two rounds had spent findings on.
- **Put the reasoning in the source.** The fork hit a model usage limit and
  died before writing its report. Nothing was lost, because the brief had told
  it to write the invariants into the code as a comment block; its conclusions
  were recovered by reading the tree, not the transcript.
- **The review loop still earned its keep.** It found two genuine soundness
  holes shipped confidently by an implementer, and it caught the un-failable
  test in the restructured version. It simply could not converge on its own —
  converging was a different job.

## Where 2D landed

45 behaviour tests (`test/compute-engine/protocol-type-redefinition.test.ts`)
and 12 invariant tests
(`test/compute-engine/protocol-resettle-invariants.test.ts`, one of which runs
a fixed script of protocol, type and alias redefinitions in varying orders and
asserts four invariants after every statement). 933 targeted tests green on the
final round; typecheck and circular-dependency checks clean; zero snapshot
churn. Shipped in 0.115.0.

Three items stay open by decision, each recorded in `ROADMAP.md` with its
cause: widening an effect annotation by redefinition, the semantics of
`readonly` when the holder of an object writes the field directly, and lifting
the conditional-conformance restriction via a raw-versus-grounded split.
