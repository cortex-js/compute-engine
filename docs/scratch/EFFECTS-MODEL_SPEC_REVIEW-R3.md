# EFFECTS-MODEL.md — Spec Review Round 3 (v4 draft, 2026-07-31)

Dual review: Codex (gpt-5.6, high reasoning) + Claude (Sonnet, direct
document review). 16 findings — **4 critical, 7 high, 4 medium, 1 low** ·
3 flagged by both reviewers · 1 open question embedded (#10).
Top factual claims (#1, #2, #12) were verified against the sources by the
orchestrator before inclusion.

---

1. **[CRITICAL] [Both] [completeness] "Runtime counterpart" / "One source of
   truth" / "What does not change" — `readsRandomFrame` (the third flag) is
   missing from the redesign, silently undoing the 2026-07-29 fix.**
   The flag-migration truth table covers only `pure`/`drawsRandom`, but the
   code has a third flag, `readsRandomFrame` (`types-definitions.ts:1270`),
   consulted by the pending-draw walk with equal weight
   (`library/core.ts:172`) and set by `Integrate`/`NIntegrate`
   (`calculus.ts:1216, 1566`) — exactly the "Derived sub-stream" shape the
   spec says gets *no label at all*. An incomplete estimator
   (`NIntegrate(f, 0, n)` with `n` unbound) must keep the seed frame alive
   even though it draws no indices (derived-substreams.md §6 — a bug fixed
   two days before this draft). `inferLambdaFlags` already infers and
   returns `readsRandomFrame` alongside the other two flags
   (`boxed-operator-definition.ts:622–645`). As literally specified — walk
   keyed on `random ∈ effectsOf` ∨ `frameProtocol` — the frame-pending
   status of incomplete estimators is lost, contradicting the spec's own
   claim that the walk's exception structure "stands untouched."
   *Suggestion:* add `readsRandomFrame` to the truth table and derived
   getters (either a second runtime field or by widening `frameProtocol`'s
   kind vocabulary to cover frame-observing, non-discharging operators);
   update Stage 1's operator list and the pending-draw formula in both
   sections; add an incomplete-estimator worked example/test.

2. **[CRITICAL] [Codex] [architecture-fit] "Host capabilities" — the
   replaceable `random` kernel conflicts with RANDOMNESS-MODEL's ratified
   stream contract.** RANDOMNESS-MODEL §4 normatively defines the *n*-th
   framed draw as the stateless, index-addressed `hash(seed, n)` (PCG3D,
   shared verbatim with GPU targets and reset-on-entry compiled code). The
   spec instead exposes a sequential `createStream(seed) → { next() }`
   kernel and doesn't say how draw indices, compiled/GPU inlining of PCG3D,
   the normative test vectors, or derived-substream hashing interact with a
   swapped kernel — so a custom kernel cannot currently satisfy the
   companion model, and the archive-pinning use case fails across targets.
   *Suggestion:* make the kernel interface index-addressed
   (`draw(seed, n)`), amend RANDOMNESS-MODEL in lockstep, and rule the
   compile story: either compiled targets fail closed when a non-default
   kernel is active, or custom kernels are interpreted-only.

3. **[CRITICAL] [Codex] [consistency] "Scope writes" vs Stage 1 —
   unconditional `{scope}` on `Assign`/`Declare`/`Assume` signatures
   contradicts confinement inference.** The projection formula
   unconditionally unions `ownEffects(op)`, and Stage 1 stamps `{scope}`
   on the three writers. Those constant signatures cannot know whether a
   given write targets a binding declared inside the enclosing literal —
   so the runtime `effectsOf` walk reports `{scope}` for the spec's own
   "confined counter" example even though inference calls it pure. The two
   channels disagree on the flagship example.
   *Suggestion:* specify the context-sensitive scope-write analysis shared
   by both channels (the walk must resolve an `Assign`'s target against
   the declaration environment, overriding the operator's own effects), or
   scope the confinement claim to inference only and say the runtime
   channel stays conservative.

4. **[CRITICAL] [Codex] [consistency] "Labels and lattice" (`any`) +
   "What does not change" — unknown operators can't preserve both current
   behaviors.** Today an unknown operator is impure for `isPure`
   (`?? false`) but does NOT count as drawing in the pending-frame walk
   (`core.ts:172` requires an explicit flag). Under one `effectsOf`
   channel: returning `any` preserves impurity but — since `any` behaves
   as participating in every frame kind — would pin `WithRandomSeed`
   frames forever on any unknown operator; returning ∅ preserves the walk
   but breaks impurity. The spec requires both old behaviors unchanged
   without a representable answer.
   *Suggestion:* let the walk key on the frame axis *excluding* `any`
   (unknown ≠ frame-participating — matching today's explicit-flag
   semantics), and state that asymmetry normatively.

5. **[HIGH] [Both] [security-privacy] "Host capabilities" —
   `ce.withEffects` is undefined under concurrent async evaluation, and
   the stakes are now host I/O.** The scoped override is structurally a
   push/restore of per-engine state — the same pattern RANDOMNESS-MODEL §2
   explicitly flags as inheriting the deliberately-unfixed
   concurrent-async constraint. Here the leaked state is network/
   filesystem authority, not a PRNG seed: an override installed for one
   in-flight evaluation can be observed by another, and restoration after
   throws/rejections is unspecified.
   *Suggestion:* define an immutable per-evaluation capability snapshot
   (captured at evaluation start, like the kernel-at-stream-creation
   rule), or explicitly inherit the RANDOMNESS-MODEL §2 caveat with a
   statement of why it's acceptable for capabilities; specify
   `withEffects` nesting/restoration for sync and Promise-returning
   callbacks.

6. **[HIGH] [Both] [edge-case] "Scope writes" — the confinement rule is
   underspecified for non-straight-line control flow and closures.**
   "The declaration itself is inside the literal" is an existence check;
   the worked examples are straight-line Blocks. Unhandled: a `Declare`
   inside a conditional branch with the `Assign` outside it; assignment
   before declaration; destructuring that declares only some targets; a
   nested closure that mutates a captured binding after its declaring
   literal returns (an escape the containment check calls confined);
   `Assume` and compound/subscript targets.
   *Suggestion:* state the rule as a dominance condition ("every static
   path from the literal's entry to the `Assign` passes through a
   `Declare` of that symbol within the literal"), define closure-capture
   as escaping, and make the conservative fallback explicit: not provably
   confined ⇒ `scope`. Add a conditional-declare counterexample to the
   worked examples.

7. **[HIGH] [Codex] [completeness] "Projection and discharge" — every
   function-valued operand is treated as invoked.** The eager-operand
   formula always adds `latent − discharge`, even for operators that only
   store, return, compare, or collect the function (`List(randomF)` would
   report `{random}` with no invocation anywhere). The prose says latent
   effects "fire if the operator invokes it," but no per-position
   invocation declaration exists.
   *Suggestion:* add per-position metadata for whether a function operand
   is (possibly) invoked, with conservative defaults (known
   non-invoking positions contribute production effects only; opaque
   operators keep the current conservative union); test store/return/
   invoke with the same callback.

8. **[HIGH] [Codex] [consistency] "Projection and discharge" (held
   positions) — `Hold` content is counted though inert.** The held-operand
   rule contributes `effectsOf(aᵢ) − discharge` on the premise that the
   held evaluation happens under the operator, but `Hold` never evaluates
   its content (RANDOMNESS-MODEL §2 requires it stay inert). So
   `effectsOf(Hold(Random()))` contains `random` and `isPure` flips,
   even though no draw can occur. Preserving the pending-walk's Hold
   exception doesn't fix the other consumers of `effectsOf`.
   *Suggestion:* distinguish evaluate-under-operator held positions from
   delay/store positions (Hold-like), and specify how delayed effects
   resurface on forcing (`Release`/evaluation of the held value).

9. **[HIGH] [Codex] [feasibility] "Projection and discharge" +
   "Complement form" — discharging a label from `any` has no representable
   result.** `WithRandomSeed`'s held body is bounded `{any}` and
   discharges `random`, but `any − {random}` is co-finite, and the
   admitted representation has only finite sets and `any` (complements are
   reserved, and only as bounds). Keeping `any` fails to record the
   discharge — the body still appears frame-relevant.
   *Suggestion:* normatively define subtraction from `any`: either admit
   internal co-finite result sets (not surface syntax), or rule that the
   result stays `any` and document the precision loss plus its consumer
   impact (a `WithRandomSeed` around an opaque body never computes ∅).

10. **[HIGH] [Codex] [scope / question] "Definition-annotation check" vs
    hole 3 — forward references invalidate the claimed contract; the
    dependency-order ruling can't stay open past Stage 2.** A
    pure-annotated `f() := g()` is accepted while `g` is undefined
    (unresolved head infers pure), and remains installed as pure after `g`
    is later defined `{random}` — the "checked contract" is false exactly
    where contracts matter (serialized boundaries). This is the standing
    open ruling, but Stage 2 ships the checks that depend on it.
    *Question for the author:* rule it before Stage 2 — infer `any` for
    unresolved named heads, or track/revalidate dependencies on
    definition, or weaken the contract claim and reject pure annotations
    whose inference saw an unresolved head.

11. **[HIGH] [Codex] [ambiguity] "Grammar and AST" (absent = pure) vs
    "Definition-annotation check" — an explicit pure annotation is
    indistinguishable from omitted.** The AST collapses "no effect set"
    and "empty set" into one state, but the definition check applies to an
    "explicit effect annotation" — with no provenance bit there is no way
    to tell an inferred bare arrow from a user-declared pure contract.
    Also unresolved: does an existing return-only `Typed(body, T)` become
    a pure contract that rejects an effectful body?
    *Suggestion:* record annotation provenance outside the effect-set
    value (parser/lowering flag); state that a bare slot in an explicit
    full-signature ascription IS a pure contract while inferred
    signatures are not; give migration examples for all four authoring
    forms.

12. **[HIGH] [Codex] [architecture-fit] "Host capabilities"
    (`environment`) — the cited pragma surface is parse-time; the label
    can't attach to anything.** `#env()`/`#navigator()` are parse-time
    pragmas (`cortex/parser.ts`, `allowHostPragmas` default false) that
    lower to values before any application exists — by evaluation time
    there is no arrow to carry `environment`, so `effectsOf`, handler
    injection, and evaluation-time policy cannot observe the access.
    "Generalized from parse-time to evaluation-time policy" is asserted,
    not specified.
    *Suggestion:* decide whether the pragmas remain parse-time (then
    `environment` gates only future evaluation-time surfaces, and say so)
    or lower to persistent environment-read expressions (then specify
    serialization, evaluation timing, and compatibility).

13. **[MEDIUM] [Codex] [scope] "Sequencing" — capability labels admitted
    at Stage 1, but their admission-test consumer (registry, fail-closed
    gate) ships at Stage 4.** In the interval the coupling rule is
    unenforceable (`ce.effects` doesn't exist) and a host-declared
    implementation can reach network/filesystem globals without the
    promised gate. (Downgraded from Codex's `high`: labels are still
    useful as declarative contracts in the interval, and no builtin
    carrier exists — but the spec should say the annotations are
    descriptive-not-enforced until Stage 4.)
    *Suggestion:* one sentence in Sequencing stating the interval
    semantics; or move label admission to Stage 4 alongside the registry.

14. **[MEDIUM] [Claude] [consistency] "Requiring absence" form 2 —
    "deterministic; scope mutation tolerated" contradicts `scope`'s
    "Safe to re-run? no".** The spec's own confinement example
    (`g() := Block(Assign(counter, counter+1), counter)`) returns a
    different value each call — not deterministic in the sense a
    cache-sensitive reader would take away.
    *Suggestion:* reword to "no probabilistic nondeterminism (`random`/
    `entropy` excluded); scope mutation tolerated — this does NOT make
    the callback safe to re-run or cache (see the observation/action
    axis)."

15. **[MEDIUM] [Claude] [security-privacy] "Host capabilities" — no
    deny/narrow primitive for untrusted sub-evaluations.** The registry is
    called the trust gate, but `withEffects` is described only as
    override/grant. A host that grants `network` engine-wide has no
    documented way to deny it while evaluating an embedded untrusted
    expression on the same engine.
    *Suggestion:* state that `withEffects` accepts explicit
    denying/throwing handlers as the sandboxing primitive, or open a
    question on per-call capability scoping before Stage 4.

16. **[LOW] [Claude] [other] "Current state" + "Runtime counterpart" —
    `isImpureHead` is cited as `library/map-lowering.ts`; it lives in
    `library/map-broadcast-shape.ts` (:59).** Cited twice; the same wrong
    path exists in a source comment (`boxed-operator-definition.ts:616`),
    which the spec likely inherited.
    *Suggestion:* fix both citations; note the source comment for the
    Stage 1 implementer to fix in passing.

---

## Suggested revisions (themes)

- **Theme A — the frame/randomness runtime channel is missing a third
  mechanism** (the biggest cluster; all touch `effectsOf` and the
  pending-draw walk): findings **1, 4, 8, 9**.
- **Theme B — the `random` kernel ruling vs RANDOMNESS-MODEL:** finding
  **2** (amend both docs together).
- **Theme C — scope confinement needs a real static analysis, shared by
  both channels:** findings **3, 6**.
- **Theme D — projection needs per-position invocation semantics:**
  findings **7, 8** (8 bridges A and D).
- **Theme E — `ce.effects` trust/concurrency semantics:** findings
  **5, 13, 15**.
- **Theme F — annotation provenance and contracts:** findings **10, 11**.
- **Open questions for the author:** finding **10** (dependency-order —
  the standing open ruling, now with a Stage 2 deadline argument).
- **Standalone:** **12, 14, 16**.
