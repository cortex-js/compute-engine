# Forward-Reference Inference Re-Derivation — Design Plan

**Status: IMPLEMENTED 2026-08-07 (noting + re-derivation), cascade added
2026-08-08. Kept as the design record; the "Phase 0 findings" and "Known
limits" sections reflect what shipped.**

## Problem

Parameter collection-evidence flows only *backward* in definition order. When
a function body calls a callee that is already defined,
`narrowArgsFromInferredSignature` (`boxed-expression/box.ts`) writes the
callee's collection-only parameter types onto unknown-typed symbol arguments —
this is fix #2 of the 2026-08-07 evidence-loss round, and it is what lets a
body like `process(cs) = clean(cs) + 1` learn that `cs` is a collection *when
`clean` is defined first*.

Define the caller first and the channel is dead:

```
process(cs) = clean(cs) + 1        // clean not yet defined
clean(cs: list<number>) = …
process([1,2,3])                   // cs learned nothing → auto-broadcasts,
                                   // clean receives 1, then 2, then 3
```

At body-canonicalization time `clean` resolves to an inferred stub
(`(unknown) -> unknown`), the narrowing is a no-op, `process`'s `cs` stays
`unknown`, `paramsAreScalar` stays true, and the call broadcasts elementwise —
the same failure mode as the 08-07 bug cluster, surviving via definition
order. Top-down program style (helpers below callers) hits it systematically;
mutual recursion cannot be fixed by reordering at all. Recorded as the open
residual in the 08-07 round ("forward references still learn nothing").

Secondary benefit: closing parameter types earlier also closes compile
coverage gaps (open-typed operands are what push the JS target into
`_SYS.bcast` dispatch or fail-closed).

## The mechanism to extend (do not build a parallel one)

`boxed-expression/provisional-application.ts` already solves the *shape* of
this problem for juxtaposition readings (`g(t) := 2a(t)` before `a` is
defined):

- While a `Function` literal's body canonicalizes, provisional readings note
  their head symbol into a per-literal frame
  (`beginProvisionalCapture`/`noteProvisionalApplication`/
  `endProvisionalCapture`; frames flow up into enclosing literals).
- The literal remembers its RAW operands + noted names + defining scope
  (`setProvisionalLiteral`, populated in `function-utils.ts` ~line 577).
- Definitions built from the literal register as dependents of each name
  (`registerProvisionalDependents`); superseded definitions unregister.
- `updateDef` (`boxed-expression/utils.ts` ~1232) is the single choke point:
  when `name` gains an operator definition or a function-typed value
  definition, it fires `repairProvisionalDependents`, whose implementation
  (`function-utils.ts:639`) re-canonicalizes each dependent literal **from its
  raw operands in its original scope** and re-installs the result
  (`def.update({ evaluate: rebuilt })`). Failed rebuilds keep the old
  definition and re-register; `REPAIRING` guards re-entry.

Re-deriving from raw operands is exactly what the inference channel needs
too: a re-canonicalization re-runs `narrowArgsFromInferredSignature` with the
callee's now-real signature, the parameter bindings pick up the evidence, and
the re-installed definition re-derives `paramsAreScalar`/`broadcastable`
through the normal install path. The `setValue` route
(`engine-declarations.ts:485`) already participates for function-typed value
definitions.

## Phase 0 findings (probed 2026-08-07, tsx, both routes)

1. **A forward-referenced callee has NO definition at caller-canonicalization
   time** — not an inferred operator stub. The no-def branch of
   `makeCanonicalFunction` (`box.ts` ~804) auto-declares it
   `{ type: 'function', inferred: true }` — a function-typed VALUE definition
   — in the *current* lexical scope (the literal's body scope), which is
   invisible from the top level afterwards. The narrowing call sites in
   `applyOperatorDefinition` are therefore never reached for this case; the
   noting must happen in `makeCanonicalFunction` itself.
2. **Late binding of the call itself already works.** A pure-scalar forward
   reference (`p6(x) = twice(x)+1` before `twice(y) = 2y`) evaluates
   correctly: at evaluation, `lookupApplicable` defers past the inert
   auto-declared inner binding to the real outer definition. ONLY the
   parameter-narrowing evidence is lost — the fix scope is exactly as
   planned.
3. **The end-to-end failure shape**: caller-first `process(cs) = clean(cs)+1`
   then `clean(v: list<number>) = v[1]` gives `process([10,20,30])` →
   `[process(10), process(20), process(30)]` — the broadcast splits the list,
   each scalar hits the callee's declared-list type error, and errored
   elements surface as inert applications. After the fix it must be `11`.
   The callee-first control already answers `11`.
4. **Declare-only** (`ce.declare('clean', '(list<number>) -> number')`)
   installs a function-typed VALUE definition; `updateDef` fires the repair
   for those via `callableValue` — covered, pin with a test.

## Design: a second provenance channel into the same registry

### 1. Noting sites (revised per Phase 0)

**Primary — `makeCanonicalFunction` (`box.ts`), the no-def branch (~804) and
the value-def branch when `def.value.inferredType` holds a function type**:
the callee is undefined (or known only by a prior auto-declaration), so the
application is canonicalized blind. Note the callee name into the current
provisional frame. Gate:

- a provisional frame is open (inside a `Function` literal body — top-level
  expressions re-canonicalize naturally and need no repair);
- at least one argument is a narrowable symbol: `isSymbol(arg) &&
  arg.valueDefinition?.inferredType && arg.type.type === 'unknown'`.

**Secondary — `applyOperatorDefinition`, both
`narrowArgsFromInferredSignature` call sites (lazy ~1075, non-lazy ~1204)**:
the callee exists but its signature is a guess (`opDef.inferredSignature`),
so a later REdefinition may bring the collection evidence. Same two gates as
above. (This is the site the pre-Phase-0 draft assumed was primary.)

Noting is idempotent per frame (a `Set`), so a callee referenced twice in one
body — first through the no-def branch, then through its auto-declared
value-def — records once.

Export a distinctly-named helper (`noteProvisionalCall(name)`) from
`provisional-application.ts` that pushes into the **same** FRAMES as
`noteProvisionalApplication` — one registry, one repair path, two provenance
kinds distinguishable only by grep. Update the module header comment to state
both meanings of a noted name: "re-derive this literal when `name`'s
definition state changes (becomes callable, or its inferred signature is
superseded by a real one)".

Import-cycle check: `provisional-application.ts` imports only `global-types` —
safe for `box.ts`. Re-run madge regardless (`npm run check:deps`).

### 2. Trigger

No new trigger. `updateDef` already fires the repair whenever `name` gains an
operator definition or callable value — which covers Epsil `clean(…) = …`,
`ce.assign`, declare-then-assign, and `ce.declare('clean', '(list<number>) ->
number')` (declaration alone installs an operator definition; Phase 0
verifies this empirically on all routes).

### 3. Self-recursion identity filter

A recursive body notes its OWN name (the self-call sees the stub), so on
install the just-built definition would immediately re-derive itself — a
wasted full canonicalization for **every** recursive function, learning
nothing (self-call narrowing is circular by construction; direct body
evidence like `cs[i]`/`Length(cs)` is already captured in-flight).

Fix: thread the just-installed definition from `updateDef` into
`repairProvisionalDependents(ce, name, justInstalled?)`; the repair loop
skips it (identity compare) and **drops** it (no re-register — a later
redefinition registers fresh dependents anyway). The existing `REPAIRING`
guard stays as the re-entrancy backstop.

### 4. What comes free (verify, don't build)

- **Broadcastability refresh**: `installRebuiltLiteral` →
  `def.update({ evaluate: rebuilt })` rebuilds the same representation as a
  fresh assignment (CHANGELOG 0.10x "re-assigning a function literal no longer
  changes its representation"), so the derived `broadcastable` flag flips off
  when the re-derived body binds the parameter as a collection. Pin with a
  test; do not add a separate flag-refresh path.
- **Shared parameter bindings**: re-canonicalization goes through
  `canonicalFunctionLiteralArguments`, which adopts the cached bare-param
  binding (08-07 fix #1) — the narrowing writes land on the one binding the
  body references.
- **Mutual recursion**: A-then-B definition order → A notes B; installing B
  fires A's repair, at which point B's signature (inferred from B's own body,
  or declared) is real. B canonicalized against A's real definition already.
- **Error isolation, invalid-rebuild parity, orphan cleanup**: inherited from
  the existing repair loop verbatim.

### 5. Known limits (accepted, document in code comments)

- The registry is name-keyed per engine, not scope-keyed: a callee defined in
  an unrelated nested scope fires a repair whose re-canonicalization (in the
  literal's original scope) is a no-op rebuild. Same characteristic as the
  juxtaposition channel; harmless.
- **Chained forward refs DO cascade** (limit lifted 2026-08-08; it was real
  for one day). `installRebuiltLiteral` re-installs via
  `def.update({ evaluate })` / `def.value = …`, which mutates the definition
  in place and does not pass through `updateDef`, so nothing fired the repair
  for the rebuilt definition's OWN name and A→B→C defined in that order left A
  un-re-derived. `repairProvisionalDependents` now closes that loop itself: a
  successful rebuild is that definition's name gaining a better definition, so
  the repair fires again for it. **Collect-then-fire**, breadth-wise — the
  wave rebuilds every dependent of `name` first, then fires one cascaded
  repair per rebuilt definition (each passing itself as `justInstalled`). A
  diamond (A on B and C, both on D) therefore rebuilds A once, after both
  forwarders are current, and error isolation stays per level. Termination
  comes from `REPAIRING`, whose release moved from a per-definition `finally`
  to the end of the whole wave: a definition stays guarded through the cascade
  of its own repair, so a mutual A↔B reference is skipped on the way back.
  A definition skipped for that reason is RE-REGISTERED (it was already taken
  out of the registry, and the extended guard window means its own rebuild
  will not re-register it again), so a later definition still retries it.
- Evidence learned is still collection-ONLY (`isCollectionOnlyType` gate in
  the narrowing is untouched) — this plan moves *when* the existing narrowing
  runs, never *what* it writes. The vectorization default is not weakened.
- The two-pass Epsil hoisting alternative (declare all program function
  headers before canonicalizing bodies) is NOT built here: it fixes only the
  Epsil surface and duplicates what this engine-level repair gives every
  route. Revisit only if repair volume ever measures as a problem.

## Traps to honor (from the project record)

- `closure-capture-scoped-expressions`: any work in `function-utils.ts` must
  not touch `captureClosures`'s re-root+copy invariant. This plan only
  threads a parameter through `repairProvisionalDependents` — do not "clean
  up" neighboring scope code.
- Route parity (`lazy:true` lesson): test Epsil source, `ce.assign` + box
  route, and LaTeX route separately. In LaTeX, `clean(cs)` with undeclared
  `clean` parses as MULTIPLICATION — that shape belongs to the juxtaposition
  channel, and a test asserting inference-channel behavior on it would be
  testing the wrong mechanism.
- Bare vs annotated params take different binding-cache paths (two binding
  objects in the annotated case) — cover both.
- Zero-arg and param'd functions take different `makeLambda` paths — the
  caller in tests must have parameters (that's the point), but include a
  zero-arg *callee*.
- Probe hygiene: never name test functions `s`, `i`, `Pair` (builtin
  hijack); `Length` evidence needs the operand to be an inferred-unknown
  symbol.
- Do not gate broadcast on positive scalar evidence anywhere in this work.

## Test plan

New describe block in
`test/compute-engine/lambda-param-collection-inference.test.ts`
("callee defined after caller"):

1. Caller-first + callee with **declared** collection param → caller's param
   binds whole, call applies (not broadcasts); caller def's `broadcastable`
   is false after callee definition.
2. Caller-first + callee whose collection param is **inferred** from its own
   body (`clean(cs) = cs[1]`).
3. Declaration-only callee (`ce.declare('clean', '(list<number>) -> number')`)
   repairs the caller without a body ever being assigned.
4. Mutual recursion pair, both definition orders.
5. Self-recursive function: defined once, no observable double-work (pin
   behavior, not timing: definition still correct, registry empty after
   install).
6. Scalar callee defined later → caller keeps broadcasting (no false
   narrowing; the vectorization default survives).
7. Annotated-param caller and bare-param caller variants.
8. Route parity: same scenario via Epsil `executeEpsil` and via
   `ce.assign`/box route.
9. Juxtaposition + inference notes in ONE body (`g(t) = 2a(t) + clean(t)`…)
   — both repairs fire, neither clobbers the other.
10. Re-registration on failed rebuild still works (callee redefinition
    retries) — extend the existing juxtaposition pin if one exists.

Plus: full run of `lambda-param-collection-inference`, `broadcast-lift`,
`broadcastable-typing`, `block-scope-capture`, epsil suites;
`npm run typecheck` + whole-src native tsc; `npm run check:deps`.

## Phasing

- **Phase 0 — probes (tsx, no code):** for each route, what definition does a
  forward-referenced callee have at caller-canonicalization time
  (`inferredSignature`? operator vs value def?); confirm `updateDef` fires on
  Epsil function definition and on `ce.declare` with a function signature.
  Encode findings as the test fixtures.
- **Phase 1 — noting channel:** `noteProvisionalCall` export + the gated
  call in `applyOperatorDefinition` (both sites). Comment update in the
  module header.
- **Phase 2 — identity filter:** thread `justInstalled` from `updateDef`
  through `repairProvisionalDependents`.
- **Phase 3 — tests** per the plan above; fix what they find.
- **Phase 4 — verification sweep** (suites, typecheck, madge, snapshot blast
  radius = expected zero), CHANGELOG entry under Unreleased.

Estimated diff: ~30 lines of mechanism (box.ts + provisional-application.ts +
function-utils.ts + utils.ts threading) + tests. The bulk of the risk is in
Phase 0 assumptions, which is why it is probes-first.
