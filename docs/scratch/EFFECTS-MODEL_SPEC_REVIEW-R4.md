# EFFECTS-MODEL.md — Spec review round 4 (2026-08-14)

Dual review (Claude Sonnet + Codex gpt-5.6, high reasoning) of the
2026-08-14 additions: the echo-marker disposition, the "Resource frames"
section, the user-declared-labels exploration, and Appendix A (the
`with` frame, three rulings). Older sections (Stages 0–3, implemented)
were consistency context only.

**12 findings — 7 high, 4 medium, 1 low · 1 flagged by both reviewers ·
0 open questions.**

All findings verified against the doc text before inclusion. One Codex
claim was corrected during merge (finding 11's premise about direct-call
projection); the finding survives with the corrected framing.

---

## Findings

1. **[HIGH] [Both] [consistency] "Resource frames" §, status header, vs
   Appendix A "The `effect` declaration" — frame-kind/mechanism
   contradiction left uncorrected.**
   "Resource frames" proposes lifetime as a **third `frameProtocol`
   kind** exposed through the snapshot-scoped `ce.effects` registry, and
   the status header still says "lifetime management as a future frame
   kind". Appendix A — which the header says unified this thread —
   instead builds lifecycle on the `effect`/`Resource`/`with` mechanism
   and fixes user-label axes to **"no frame kind, not handler-backed"**.
   Only the surface-syntax and settlement-vs-revocation halves of
   "Resource frames" received "(Since answered — Appendix A …)"
   annotations; the mechanism claim was never retracted. An implementer
   reading "Resource frames" would build on `ce.effects` mocking/denial
   semantics Appendix A's design does not provide — user resource types
   have **no handler namespace**, so there is currently no described way
   to mock or deny a `file` resource for sandboxing (unlike
   `network`/`fs_read`). Also unresolved either way: is there one
   parameterized `resource` frame kind, one kind per effect type, or a
   distinct lifecycle stack that is not a frame kind at all? That choice
   controls nested-frame behavior, revocation bookkeeping, and how the
   pending-frame infrastructure generalizes.
   *Suggested revision*: pick the mechanism (lean: a parameterized
   lifecycle/`resource` dimension that is NOT `frameProtocol` — see
   finding 3), annotate the `ce.effects`/frame-kind paragraph in
   "Resource frames" with a since-answered correction, fix the header
   phrase, and either add a mock/deny story for user resources or name
   its absence as a follow-up gap.

2. **[HIGH] [Codex] [feasibility] "Resource frames" — "expose it through
   the snapshot-scoped `ce.effects` registry" contradicts the
   immutable-snapshot contract.**
   "Host capabilities" specifies the registry as an immutable object
   captured **once at evaluation entry** and used throughout. A `with`
   body needs a newly acquired, nested, per-frame binding that
   disappears at frame exit — and multiple simultaneous frames must stay
   distinguishable. Installing handles in `ce.effects` would violate
   immutability-throughout; meanwhile Appendix A's examples pass `f`
   explicitly and define no registry lookup route, so the claimed free
   inheritance of snapshot isolation / `null`-denial / try-finally has
   no implementable mechanism.
   *Suggested revision*: specify a separate per-evaluation
   resource-frame stack/table (keyed by resource identity, captured
   across async continuations), or a precisely scoped immutable derived
   evaluation context per frame; state how post-exit uses are checked
   before any host handler is reached. (Clusters with finding 1.)

3. **[HIGH] [Claude] [architecture-fit] "Label kinds — the metadata
   axes" — the four-axes completeness claim is now stale.**
   The doc asserts four independent axes (impurity,
   observation/action, frame kind, handler-backed) exhaustively describe
   what a consumer may key on, and that completeness is load-bearing.
   Appendix A gives a label genuine acquire/release/revocation behavior
   that is none of the four — a fifth, unmodeled lifecycle dimension
   ("conforms to `Resource`, needs a delimiting frame with release
   semantics"). "Resource frames" itself concedes the model "tracks use
   … never retention", i.e. the axes were never meant to cover lifetime,
   but "Label kinds" is never revised to say so.
   *Suggested revision*: either add a lifecycle axis to the "Label
   kinds" table, or add an explicit note that retention/lifecycle is a
   deliberately separate, unaxised dimension layered on top
   (cross-referencing the use-vs-retention framing). (Clusters with
   finding 1.)

4. **[HIGH] [Codex] [consistency] Appendix A "Label emission is
   signature-derivable" — the "iff an operand's type is (or contains)
   the effect type" rule bypasses `invokes` and the latent/production
   split.**
   As literally stated, `List(read)` with `read : (file) -> string`
   carries `file` — the operand's *type* contains `file` — even though
   `List` is `invokes: false` and must not expose a callback's latent
   effects. "Contains" is undefined across function parameter/result
   positions, unions, collections, and aliases, so a callback that
   merely *accepts* a file would taint a pure store or selector. This
   defeats the per-position `invokes` and held-position semantics the
   doc specifies carefully.
   *Suggested revision*: define resource-label derivation as an
   intrinsic effect **of a callable that consumes a resource value**
   (i.e. it lands in that callable's own/latent set), then let ordinary
   projection — `invokes`, held positions, discharge — decide when it
   propagates to an application. Never derive an application effect from
   syntactic containment in an operand type.

5. **[HIGH] [Codex] [completeness] Appendix A — the effects of `finish`
   itself are absent from `with`'s effect computation.**
   `finish` runs unconditionally and in the example calls `fs_close`, a
   host-capability use that may also mutate handle state; a future
   connection close may suspend (`async`). The stated rule only
   *subtracts* the delimited label from the body and discharges nothing
   else — it never says the `with` expression **unions the finalizer's
   effects (undischargeed, exactly once)**. As written, a `with` can be
   typed pure while performing finalizer I/O, violating the
   one-source-of-truth and handler-coupling rules.
   *Suggested revision*: add `with` to the projection model explicitly:
   effects(initializers) ∪ (effects(body) − {label}) ∪
   effects(finish), with the finalizer term never discharged; require a
   statically known effect contract for `finish`.

6. **[HIGH] [Claude] [edge-case] Appendix A "The escape story" — escape
   via the block's own value is not covered, because whether `with`
   produces a value is unstated.**
   The two static-diagnostic cases are outer-scope write and closure
   capture. Neither covers `with f = file(…) { f }` or a trailing
   expression structurally containing `f` — at least as detectable as
   closure capture, yet it falls silently through to the revocation
   backstop. The root ambiguity is that the appendix never says whether
   `with` is a value-producing expression (Epsil's general
   expression-`Block` model suggests yes) or a statement.
   *Suggested revision*: state which it is. If value-producing, add a
   third static case ("the block's result names or structurally contains
   a frame binding"); if statement-only, say so — that closes the gap by
   construction.

7. **[HIGH] [Claude] [architecture-fit] Appendix A — `effect file :
   integer` is value-backed, which makes revocation unsound as
   specified.**
   Ruling (c)'s revocation needs the handle to have stable identity that
   can be marked dead independent of copies — exactly what
   `TYPE_SYSTEM_ROADMAP.md` Appendix B's `object<…>` types provide
   (reference identity + per-object version counters), and Appendix A's
   own Sequencing note leans on ("a handle is naturally a mutable
   object"). But the example declares `file` over `integer` with a plain
   constructor function — nothing establishes object backing. If `file`
   is a value type, a copy of a dead handle shares no state with the
   revoked original. This gap is not in the "To pin before
   implementation" list.
   *Suggested revision*: state that an `effect X : T` declaration is
   always object-backed (equivalent to `type X = object<value: T>` plus
   the two extra registrations), or specify the conditions under which
   revocation stays sound for value-typed `T`; add to the pin list.

8. **[MEDIUM] [Codex] [architecture-fit] "Exploration: user-declared
   effect labels" / Appendix A — "mechanically it is nearly free"
   overstates; the implemented representation is closed at every level.**
   `EffectLabel` is a closed TypeScript union and `EFFECT_LABELS` a
   fixed array (`src/common/type/types.ts`, `src/common/type/effects.ts`);
   `parseEffectSpecifiers` rejects anything else. Beyond the
   registration step the exploration already names, an implementer must
   also define: declaration hoisting/order (Epsil parses a batch before
   evaluating declarations — when does `effect file` make a later `file`
   specifier valid?), parser-registry updates and cache invalidation,
   the runtime representation of engine-local labels in `EffectSet`
   values, and cross-engine serialization (what does a signature
   containing `file` mean to an engine without the declaration —
   required import bundle, or hard error?).
   *Suggested revision*: soften "nearly free" to "cheap in the lattice,
   with a real representation/registration design", and enumerate these
   four items as the registration step's contents.

9. **[MEDIUM] [Claude] [completeness] Appendix A registration point 2 —
   "resolves the namespacing question" resolves only the easy half.**
   The exploration's stated risk was collision with a **future** builtin
   admission; rejecting names in the roster **at declaration time**
   cannot prevent a later minor-version admission from claiming a name a
   user already declared (builtin admission is elsewhere treated as a
   normal minor-version event).
   *Suggested revision*: either accept future-collision as a residual
   risk with a stated policy (builtin wins; user declaration errors on
   that engine version), or require the reserved prefix/sigil originally
   floated, which makes "never collide" actually hold across versions.

10. **[MEDIUM] [Claude] [ambiguity] Appendix A "Ambient form" /
    "Discharge falls out uniformly" — the "not a special case" claim is
    asserted, not demonstrated.**
    `random` is a builtin: handler-backed, frame-kind-bearing, never
    passing through an `effect` declaration (no nominal type, no
    `Resource` conformance, no `finish`). The rule by which a builtin
    frame-kind label is a valid head of the ambient `with` grammar —
    built for `effect`-declared resource types — is never stated.
    *Suggested revision*: state the unifying rule, e.g. "every label
    with a non-null frame kind carries an implicit ambient `with` form,
    recognized independently of the `effect`/`Resource` declaration path
    used for resource types".

11. **[MEDIUM] [Codex, premise corrected in merge] [ambiguity] "If the
    boundary is crossed: the echo marker" — the projection rule is
    underspecified for the cases that matter.**
    Codex's premise that direct applications gain nothing is wrong for
    the pole case the subsection targets (a bodiless head declared
    `any` poisons the application; declared pure it *bounds* the
    callback — the marker does add precision there). But the surviving
    ambiguities are real: the text does not say which term the marker
    replaces (own effects vs operand contribution), how it composes with
    `invokes`, held positions, and discharge, how a marked signature
    propagates when the HOF is itself stored/passed/wrapped, or how a
    marked protocol requirement is checked "per-dispatch" when the
    callback does not exist at conformance-registration time. Treating
    the marker as `any` for subset ordering also means a marked
    signature is rejected by any finite bound — worth stating as the
    accepted consequence.
    *Suggested revision*: since this is a disposition, the minimum fix
    is a sentence scoping it ("semantics to be specified via worked
    nested-HOF and dispatch examples if activated"); if more is wanted
    now, specify that the marker replaces the head's own-effects term
    only, with everything downstream governed by ordinary projection.

12. **[LOW] [Codex] [scope] Appendix A "To pin before implementation" —
    the exit-path pins are load-bearing for ruling (c), not polish.**
    The pin list already names abnormal exits and erroring `finish`; the
    finding adds one concrete consequence worth recording with the pin:
    without an ordering/continuation rule, an erroring finalizer could
    leave later aliases usable or suppress a later required cleanup. A
    single exit state machine (when the handle is marked revoked
    relative to `finish`; continuation after failure; error
    aggregation) should be the pin's stated deliverable.

---

## Suggested revisions (themes)

- **Theme A — which mechanism actually carries the frame (the big
  one):** findings 1, 2, 3. Resolve together: decide frame-kind vs
  lifecycle-dimension vs registry, then sync "Resource frames", "Label
  kinds", the status header, and Appendix A's axes sentence in one pass.
- **Theme B — Appendix A `with` semantics gaps:** findings 5, 6, 7, 12
  (finalizer effects in projection; expression-vs-statement + third
  static escape case; object backing for revocation; exit state
  machine). All four belong in — or already touch — the "To pin before
  implementation" list.
- **Theme C — label emission rule:** finding 4 (standalone; the one
  outright spec bug — replace the "type contains" rule with
  intrinsic-effect-on-the-consumer + ordinary projection).
- **Theme D — user-label registration realism:** findings 8, 9.
- **Theme E — echo marker scoping:** finding 11 (standalone).
