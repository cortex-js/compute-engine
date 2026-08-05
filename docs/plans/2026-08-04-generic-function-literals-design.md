# Generic function literals + `function f<T>(…)` — the type-variables v2 milestone

Status: v2 RATIFIED 2026-08-04 — ready for implementation. Dual spec
review applied (14 findings, record in
`docs/scratch/2026-08-04-generic-function-literals-design_SPEC_REVIEW.md`);
all decisions G1–G11 ruled by the user 2026-08-04 (§4).
Implements §9.1 of
[`2026-08-01-type-variables-design.md`](./2026-08-01-type-variables-design.md)
(the ruled v2 milestone): **M1** lifts the D7 rejection so generic user
functions with inline bodies work end-to-end; **M2** adds the sugared
definition form `function f<T: number, U>(x: T, k: (T) any -> U) -> list<U> { … }`.

Rulings already made (2026-08-04, user):

- **G1 — M1 approach = erased-body canonicalization** (a fourth approach,
  discovered during reconnaissance; the spec's three candidates and why
  each loses are recorded in §2.1).
- **G2 — multi-clause × generics: reject with a dedicated diagnostic** in
  this milestone (single-clause generic functions only). This also closes a
  latent hole: the multi-clause route never had a D7 gate at all
  (`multi-clause.ts` `declaredSignatureOf` accepts a `typeParams`-carrying
  signature today with no check).
- **G3 — compile decline stays.** Cost assessed per the parent spec's "if
  cheap" condition: the lift requires threading per-call-site solved
  bindings into `base-compiler.ts`, where `userFunctionParamType`,
  the coercion/broadcast wraps, and CSE admission all key on *ground
  declared* parameter types — a generic function would need
  per-instantiation emission (monomorphization machinery), which is not
  cheap. Declined with reason; ROADMAP compile-coverage ledger line added
  (§2.7).

G4–G11 were recommended by the spec review round and **ratified by the
user 2026-08-04** (G10 = trusted ascription; G11 = reject; G4–G9 as
written). All decisions in this spec are ruled — do not re-litigate.

## 1. Scope and acceptance

From §9.1 of the parent spec, unchanged:

- The D7 diagnostic is **replaced by working declarations** on all three
  v1 routes — `ce.assign`, the `Assign` operator, Cortex annotated
  `const`/`let` — plus the new M2 statement form.
- `identity` / `swap` end-to-end; a **generic recursive** function via
  declare-then-assign (the mandatory recursion idiom).
- The §4.2 ground invariant holds at every application of a generic
  literal.
- M2: angle-bracket clause after the function name in the `function`
  statement; `specifierSignature()` gains the type-param list; serializing
  a generic definition into the sugared form becomes **lossless**
  (superseding D13's v1 never-decompose rule for the sugared form only —
  the `Declare` route keeps emitting the full-type-literal spelling).

Out of scope (unchanged from the parent spec §9.2): generic clauses in
multi-clause sets (G2), compilation (G3), type packs / lazy higher-order
seam / `Map`-class migration, dimension variables, F-bounded bounds,
rank-2 anything. Additionally proposed out of scope: literal bodies for
polymorphic overload **intersections** (G11, §2.4) and partial
application of generic literals (G5, §2.5) — both with dedicated
diagnostics, both liftable later.

## 1.5 Examples — what this milestone supports, and what it deliberately does not

### Supported patterns

```
// E3 — full-literal annotation (Cortex):
const f: forall T. (x: T) -> T = x |-> x
f(5)        // 5, result type from T = integer instantiation
f("a")      // "a", result type string — same engine, no cross-call pollution

// E3 — host route, declare-then-assign (the recursion idiom):
ce.declare('nest', 'forall T. (T, integer) -> T');
ce.assign('nest', ce.parse('(x, n) \mapsto \ldots nest(x, n-1) \ldots'));
// generic recursion works for the first time

// E4 — the M2 sugared statement, all head features:
function f<T>(x: T) -> T { x + x }
function g<T: number, U>(x: T, k: (T) any -> U) -> list<U> { … }
function tick<T>(x: T) random -> T { … }        // effects slot unchanged
function h<T: (real) -> real>(k: T, x: real) -> real { k(x) }  // signature bound

// E1 — box-route signature-string sugar:
["Function", body, "'forall T. (x: T) -> T'"]

// Mixed parameters — ground annotations coexist with quantified ones:
forall T. (x: T, n: integer) -> T      // n enforced at apply; x erased

// Ground annotation COVERING the bound (§2.4 rule 4):
// declared forall T: integer. (T) -> T, literal (x: real) |-> …   ✓ accepted

// Bounded broadcast — the signature side is bound-aware:
// f: forall T: number. (T) -> T;  f([1,2,3]) → broadcasts, types vector (no double-lift)

// Anonymous application — the polytype is enforced without a declaration:
(["Function", body, "'forall T: number. (x: T) -> T'"])(5)   // ✓
(…same…)("a")                                                 // rejected: bound

// Explicitly narrower effects than declared (G9 excludes the effects axis):
// declared forall T. (T) random -> T, literal marker says pure   ✓ accepted
```

### Rejected or deliberately-limited patterns (each pinned by a ruling)

```
// G6 — a bare unknown type name is NEVER an implicit variable:
(x: T) |-> x                       // unknown-type error (no clause in scope)
["Typed", "x", "'T'"]              // same, box route

// G6/rank-1 — forall in a parameter annotation (rank-2 spelling):
["Function", body, ["Typed", "k", "'forall U. (U) -> U'"]]   // rejected

// G5 — no partial application of a generic literal:
g : forall T, U. (T, U) -> U;  g(1)     // generic-partial-application
                                        // (lift = partial instantiation, future)

// G2 — no generic multi-clause, in any direction, first clause included:
function f<T>(0) { 1 }                  // generic-clause-unsupported
function f<T>(x: T) -> T { x }  then  function f(x: string) -> string { x }
                                        // second clause: generic-clause-unsupported

// G11 — no literal body for a polymorphic overload intersection:
ce.declare('f', '(forall T. (T) -> T) & ((string) -> string)');
ce.assign('f', x |-> x)                 // rejected (evaluate-handler territory)

// G7 — clause names scope over the HEAD only:
function f<T>(x: T) -> T { let y: T = x; y }   // `let y: T` → unknown-type error

// G8/G1 — the body does NOT see T (erasure semantics):
function f<T: number>(x: T) -> T { … }  // inside the body, x types as an
                                        // ordinary inferred param, not `number`;
                                        // two params sharing T are not known equal-typed

// G10 — the variable-correlated return is a TRUSTED ascription:
ce.assign('f', x |-> 0)  onto  forall T. (T) -> T   // accepted;
// f("a") statically types string, evaluates 0 — disclosed, pinned, not checked

// M2 surface limits:
f<T>(x) = x            // NOT a definition — parses as the expression f < T > (x) = x
function f<>() { 1 }   // empty clause: dedicated diagnostic
function f<T: list<U>>(…)   // non-ground bound: rejected (parent spec, unchanged)
function f<T>() -> list<T> { … }  // result-only variable: unsolvable-type-variable

// G3 — compile() of a generic user function: interpreted fallback (decline)
```

## 2. M1 — erased-body canonicalization (G1, RULED)

### 2.1 The ruling and why

**A generic literal's body is canonicalized ONCE, exactly as if its
quantified parameters were unannotated.** The `forall` clause lives only
at the *signature* level, where every consumer already handles polytypes
(the v1 solver embedded in `validateArguments`, overload instantiation,
`instantiatedResultType`, `paramsAreScalar`'s bound reading). No type
variable ever becomes the type of a symbol, so the §4.2 ground invariant
and all its tripwires (`assertGroundType`, `BoxedType` closedness) stay
**absolute** — not relaxed, not scoped.

Semantics contract, stated plainly: **a generic literal behaves exactly
like today's untyped literal with the polytype as its call-site
contract.** `forall T. (x: T) -> T = x |-> x + x` evaluates precisely as
`x |-> x + x` does today; what the clause adds is argument checking,
instantiated result typing, bound enforcement, and honest `.type` on the
function value. (One honesty limit — the variable-correlated *return* —
is an open ruling, G10, §2.4.)

Why the spec's candidates lose (recorded so the trade isn't re-derived):

1. *Rigid-variable canonicalization* (the spec's pre-recon favorite):
   there is no rigid kind today, and during body canonicalization a rigid
   `T` reaches every `.type` consumer — canonical `Add`/`Multiply`
   ordering, sign/parity queries, assumptions, `BoxedType`'s closedness
   throw (`boxed-type.ts:96`), the `assertGroundInputs` tripwires
   (`subtype.ts:1764`) — not just the algebra helpers. The entire v1
   safety story ("solver variables never escape") would need engine-wide
   relaxation for a body-precision gain the engine's own conventions
   don't promise (see 3).
2. *Per-call re-canonicalization*: sound, but adds a raw-body literal
   state, a per-instantiation memo, closure-capture interplay (capture
   walks canonical bodies), first-call latency — and per-instantiation
   fold *divergence*: the same body canonicalizing differently at
   `T = integer` vs `T = matrix` is its own surprise class.
3. *Canonicalize at the bound*: rejected in the parent spec (§9.1),
   ruling stands. Note the erased approach is **not** this: erasure makes
   *no* type assumption beyond what the untyped-lambda pipeline already
   assumes by convention (generic-symbol folds). Bounds do **not** inform
   body canonicalization (G8, recommended — §4).

The decisive observation: on the Cortex `const f: forall T. (x: T) -> T =
x |-> x + x` route, the lambda's body **already** canonicalizes erased —
untyped params, auto-declared unknown/inferred. D7 was only ever a gate at
the compatibility seams. M1-erased is the natural completion: relax the
seams, leave the body pipeline untouched.

What erasure gives up (disclosed, not hidden): inside the body, `x: T`
carries no type information — `x` is an ordinary inferred-`unknown`
parameter; a bound `T: number` does not make the body see `number`
(G8). Two parameters sharing `T` are not known same-typed inside the
body. Both match the behavior every untyped lambda has today.

### 2.2 Which spellings introduce type variables (G6, recommended)

**A type variable enters a function literal only through a
whole-signature `forall` clause.** With any-identifier variables (no
`[A-Z]` convention), an isolated `'T'` annotation must never silently
become a variable — it would capture against a nominal type of the same
name. The complete list of variable-introducing spellings:

| # | Spelling | Route |
| --- | --- | --- |
| E1 | signature-string sugar: `["Function", body, "'forall T. (x: T) -> T'"]` | box/parse |
| E2 | full-signature `Typed` marker: `["Function", ["Typed", block, "'forall T. (x: T) pure -> T'"], "x"]` (marker inside the Block after canonicalization, per the Phase-1 normalization) | box, and what E1/M2 lower to |
| E3 | declaration boundary: declared polytype + plain (untyped or ground-typed) literal — `ce.declare('f', 'forall T. (T) -> T'); ce.assign('f', …)`; Cortex `const f: forall T. (x: T) -> T = x \|-> …` | all three v1 routes |
| E4 | M2 statement: `function f<T>(x: T) -> T { … }` — lowers to E2 via `specifierSignature()` | Cortex |

Everything else stays rejected, with the *existing* error shapes:

- A per-parameter annotation naming an undeclared type
  (`["Typed", "x", "'T'"]` with no clause on the literal) remains an
  unknown-type error — never an implicit variable.
- A `forall` string in a per-parameter annotation (rank-2 spelling)
  remains rejected (`function-utils.ts:375`).
- The return-slot gate (`function-utils.ts:404`) must now discriminate:
  a polytype in the return slot is **always a full signature**
  (`kind: 'signature'` — a polytype cannot be anything else), so it takes
  the E2 accept path when well-formed (§2.3); a malformed one (E2
  well-formedness below) gets the updated rejection message.
- Nested literals cannot reference an enclosing literal's variables
  (rank-1; falls out of G6/G7 — there is no scope through which `T`
  could reach them).

### 2.3 Canonicalization changes (`function-utils.ts`, `function-literal.ts`)

**The E2 pre-pass (new, and ordered FIRST).** Review finding: parameter
operands are normalized *before* the body slot is inspected today, so a
hand-authored E2 (or the M2 lowering) carrying `["Typed", x, "'T'"]`
params would hit type resolution with an unknown `T`. Fix: at the top of
`canonicalFunctionLiteralArguments`, before parameter normalization,
recognize a full-signature **polytype** marker in the body slot
(`["Typed", body, sig]` where `sig` parses to a `typeParams`-carrying
signature). If present:

1. **E2 well-formedness** (review finding — the marker stops being a
   cosmetic mirror and becomes the contract of record, so its shape is
   now checked): the marker signature must be a plain signature — no
   `optArgs`, no `variadicArg` in v1 — with **arity equal** to the
   literal's parameter count. Violation → the §3.4 invalid-marker
   diagnostic. **Positional mapping is authoritative**; marker argument
   *names* are cosmetic, the literal's operand names remain the names of
   record (the EFFECTS-MODEL mirror rule, unchanged).
2. **Erasure**: for each parameter position whose marker-signature
   argument type **mentions a quantified variable**, drop the literal
   operand's own `Typed` annotation (bare symbol). A *ground*-annotated
   operand at a ground marker position keeps its annotation; a ground
   annotation at a *quantified* position is checked by the boundary rule
   (§2.4 rule 4) — at canonicalization it is simply dropped in favor of
   the marker (single source of truth).

**E1 desugar** (`desugarSignatureString`, `:750`): when the parsed
signature `isPolymorphicType`, produce **bare** param symbols for every
argument whose declared type mentions a quantified variable, keep
`Typed` markers for ground-typed args, and wrap the body in the
full-signature `Typed` ascription — the existing effects-branch pattern
(`:783-790`), now taken whenever the signature is polymorphic *or*
effect-bearing. Named args remain required on this route (the existing
`args.some((a) => !a.name)` decline is unchanged). The result is a
well-formed E2, which then takes the pre-pass above on re-entry.

The three D7 canonicalization gates (`:349` sugar, `:375` param, `:404`
return) are replaced per §2.2. `isPolytypeString` survives as the
recognizer. The **shadow window is unchanged**: by the time it opens,
quantified params are bare symbols, so `_pushShadowedParameters` and the
body canonicalization run exactly as for an untyped literal; the
post-hoc declaration step (`:478`) declares them
`{ inferred: true, type: 'unknown' }` — the untyped-param rule.

**The read side** (`function-literal.ts`):

- `functionLiteralDeclaredSignature` (`:196`): the decomposition
  predicate widens from "carries an effect set" to "carries an effect
  set **or** a non-empty `typeParams`".
- `functionLiteralReturnType` (`:234`): when the declared signature's
  result **mentions a quantified variable**, return `undefined` — the
  return stays inferred, joining the wide-result (`unknown`/`any`)
  convention. An open type must never come out of this accessor.
- **The literal's `.type`** becomes the polytype, assembled as: the
  marker's `typeParams`, argument types, and result **verbatim**; the
  arrow's **effects = declared ∪ inferred**, exactly as
  `functionLiteralSignatureType` computes today (review finding: the
  EFFECTS-MODEL invariant — the literal's own arrow stays a sound
  over-approximation even when the declared contract is violated —
  must survive the marker becoming authoritative for the *type* axes).
  A closed polytype is a legal `isPolymorphic` `BoxedType`.

### 2.4 The declaration boundary (replacing D7)

The six D7 sites and their new behavior:

| Site | New behavior |
| --- | --- |
| `engine-declarations.ts:682` (declare-with-value) | install path (rules below) |
| `engine-declarations.ts:886` (assignFn value slot) | install path; the `isSymbol(orig)` discrimination STAYS (a function-typed *symbol* still gets the honest `Ground <: Poly` `declaredTypeError`) |
| `engine-declarations.ts:1008` (assignFn operator slot) | install path — as implemented, this branch keeps its existing ground representation (the reconciled literal stored as a value def under the declared type via `updateDef`), so string-form and object-form declarations stay observably identical. The polytype **operator-def** lambda arises on the *bare-assign* route (no prior declaration): `functionLiteralHasAnnotation` treats a polytype marker as an annotation, so the literal's own polytype becomes the operator signature — which is what makes `f(5)` instantiate, and the only route that reaches the §2.5 twin arm |
| `effects-inference.ts:237` (`matchesDeclaredTypeAxes`) | acceptance rule below; the D3/D12 `isSubtype` rule for **non-literal** values is unchanged |
| `function-utils.ts:349/:375/:404` | per §2.2/§2.3 |

**Single-arm restriction (G11, recommended).** A function literal may
implement a polymorphic declared type only when that type is a
**single-arm** signature. An intersection (overload set) containing any
polytype arm, declared as the type of a symbol assigned a literal body,
keeps a D7-style rejection with a dedicated message — generic overload
arms remain evaluate-handler territory in this milestone. (Review
finding: the parent spec makes such intersections declarable; without
this rule an implementer must guess how one erased body satisfies
per-arm clauses, bounds, and results.)

**Acceptance rule at the boundary** (both routes, identical): a function
literal satisfies a (single-arm) polymorphic declared type iff

1. **arity** is compatible (`assertFunctionLiteralArity` against the
   polytype's arm — `signatureArms` reads `args` regardless of
   `typeParams`; verify with a probe);
2. **effects**: inferred ⊆ declared (`assertDeclaredEffects`, unchanged —
   `signatureEffects` reads polytype arrows fine, pinned in the parent
   spec §4.1);
3. **own-contract agreement (G9, recommended)**: if the literal carries
   its own full-signature polytype marker (E1/E2/E4), it must be
   **α-equivalent** to the declared polytype on the *type axes* —
   `typeParams` (names modulo renaming, bounds structurally), argument
   types, result — using the existing α-equivalence relation
   (`alphaEquivalentSignatures`, i.e. the polytype↔polytype `isSubtype`
   of §5 rule 3; review finding: raw `typeToDedupKey` comparison is
   alpha-blind and would reject `forall U. (U) -> U` against
   `forall T. (T) -> T`). The **effects axis is excluded** from this
   comparison — strip both arrows' effects first — and so are
   **argument names** (implementation finding: the dedup key spells out
   `(x: T)`, and marker names are cosmetic per §2.3, so the comparison
   anonymizes `args`/`optArgs`/`variadicArg` too) — and is governed
   solely by rule 2's subset (review finding: whole-signature α-equality
   would reject a literal honestly stating a *narrower* effect set,
   `pure` marker under `random` declaration, while silence passed —
   penalizing explicitness). Mismatch → `declaredTypeError`. A plain
   literal (E3) always passes this clause.
4. **ground annotations cover the domain** (variance corrected per
   review): a *ground* implementation annotation at a **quantified**
   parameter position must accept every admitted instantiation —
   `declaredBound <: annotation` (unbounded ⇒ bound `any`, so only a
   wide `unknown`/`any` annotation passes — in practice, don't annotate
   a quantified position). `(x: real)` against `forall T: integer.
   (T) -> T` is accepted; `(x: integer)` against `forall T: number.
   (T) -> T` is a `declaredTypeError`. Ground annotations at *ground*
   positions reconcile as today.

**Return reconciliation** (`reconcileFunctionLiteralReturn`): when the
declared result mentions a variable, there is nothing ground to ascribe —
**skip the ascription**; the body's return stays inferred and call-site
result types come from the *instantiated* signature, not the literal's
arrow. When the declared result is ground even under `forall`
(`forall T. (T) -> boolean`), reconcile exactly as today (G4,
recommended). Guard order: decide *before* calling `functionResult`,
which returns the honest-but-wrong-for-this-purpose `unknown` on
polytype arms.

**The variable-correlated return is otherwise unchecked — G10 (RULED:
trusted ascription).** Under erasure nothing verifies that the body
actually returns its argument's type: `x |-> 0` assigned to
`forall T. (T) -> T` gives `f("a")` static type `string` and value `0`.
Ruled: follow the typed-function-literals precedent (return ascriptions
are TypeScript-style *trusted* ascriptions, explicitly not covariant
runtime checks — ruled 2026-07-12), disclose the limit here and in the
user docs, pin the behavior in a test, and record a strict-mode per-call
instantiated-result check as future work (same future-work slot as the
07-12 design's §10).

**Value-definition storage:** the value def's declared type remains the
polytype; the literal is stored as the value. `BoxedValueDefinition`
construction reaches `matchesDeclaredTypeAxes` with the rule above.

**Residuals round (2026-08-04, post-commit):**
- **Self-describing values**: the boundary ascribes the declared
  polytype onto a plain literal (`ascribeDeclaredPolytype`, all three
  routes) so the stored value's own type is the polytype — but ONLY
  when every clause argument mentions a quantified variable (a ground
  argument like `n: number` would become a per-element `apply()`
  constraint inside a broadcast, where `n` legitimately receives a
  whole row — pinned limitation; such literals still self-describe as
  their inferred arrow).
- **Untyped re-assign full-replaces a DERIVED signature** (user-ruled,
  the polymorphism D6 precedent): a new `_derivedSignature` provenance
  flag distinguishes assign-derived signatures (replaceable) from
  author declarations (sticky, all `ce.declare` forms).
- **Anonymous application result typing**: `Apply`'s own `type:`
  handler instantiates polytype heads (`instantiatedResultType`);
  `['Apply', lit, args]` and `[lit, args]` are the same node after
  canonicalization. A bound-violating anonymous call types the solved
  instantiation (the solver is write-free and does not enforce bounds;
  validation cannot run on `Apply`'s expression-typed operands) —
  pinned. `Pipe` stays idle (lazy).

### 2.5 The application path

- **`makeLambda`** (`function-utils.ts:1332`): erased quantified params
  have no `Typed` markers, so `typedBinding`/`declareParameterActivation`
  bind them as plain params — zero change there. **The strict-mode
  apply-time validation gate must widen** (review finding: it is
  currently `hasAnnotatedParam`, which is `false` for a pure-erasure
  literal, so an *anonymous* application — `Apply(Function(…), …)`,
  never passing a symbol's boxed-definition seam — would skip bound
  enforcement entirely): gate on `hasAnnotatedParam || literal carries a
  full-signature polytype marker`, and pass `fnExpr.type.type` (now the
  polytype) to `_validateArguments`, which is already polytype-aware.
  Probe, don't assume, the `lazy`/`inferable` option derivation at this
  seam (the `solveArm` context flags are computed from the def at the
  boxed-function seam, not here).
- **Partial application (G5, recommended — reject).** Currying a generic
  literal is rejected with a dedicated diagnostic (the multi-clause D8
  reject-over-surprise precedent). Insertion point pinned per review: a
  guard at the **top of the arity-shortfall (currying) branch**
  (`function-utils.ts:~1471`), firing on the polytype marker regardless
  of `hasAnnotatedParam` — the previously cited `prefixSig` rebuild
  (`:1521`) sits behind the annotation gate and may never fire for a
  pure-erasure literal; **Phase-1 probe confirms what today's failure
  mode actually is** before the guard lands. Rationale for rejecting:
  a variable consumed by the supplied prefix fails result-reachability
  when the residual arrow is boxed (`forall T, U. (T, U) -> U` curried
  at one argument → residual clause with unused `T` →
  `unsolvable-type-variable` thrown from `BoxedType` construction).
  Partial *instantiation* (solve the supplied prefix, substitute, prune
  the clause) is the principled lift; recorded as future work, not v1.
- **Result typing — the twin arm.** The value-definition arm of
  `computeFunctionResultType` already instantiates
  (`instantiatedResultType`, `boxed-function.ts:3209`) and carried a D10
  `liftedEchoPositions` guard (`:3244`). The **operator-def lambda arm**
  (`:3160`) had neither — harmless while an operator-def lambda could
  only carry an inferred ground signature, but the moment the operator
  slot installs generic literals (this milestone), that arm
  **double-lifts**: `f([1,2,3])` under `forall T. (T) -> T` would type
  `list<vector>` instead of `vector`. Mirror `instantiatedResultType`
  onto the twin. This was pre-flagged in the v1 implementation notes
  ("mirror at the lambda twin when v2 generic literals land").
  **Amended 2026-08-04 (D10 re-ruling):** the echo guard is RETIRED on
  all three arms (both lambda arms and the builtin one). A lift-admitted
  operand now binds its ELEMENT type, so `instantiatedResultType` returns
  the PER-ELEMENT result and the ordinary broadcast wrap is the whole
  answer — `vector` for the bare echo as before, and correctly ranked for
  a result that merely MENTIONS the variable. Only `instantiatedResultType`
  has to be mirrored onto the twin; there is no second piece.
- **Broadcast gating**: `applyFunctionLiteral`'s gate reads the declared
  signature and `paramsAreScalar` already reads quantified params at
  their bound (`substituteDeclaredBounds`, `boxed-function.ts:3459`) —
  no change on the VALUE route, pinned by test (bounded
  `forall T: number. (T) -> T` literal broadcasts over a list; unbounded
  does not double-lift). **Follow-up (user-ruled 2026-08-04, post-review
  finding 7):** the bare-assign OPERATOR route never reached that gate —
  its lambda operator def defaulted `broadcastable: false`, so validation
  rejected `f([1,2,3])` while the compiled path already broadcast
  (parity bug). Fixed by deriving `broadcastable: paramsAreScalar(sig)`
  in `assignValueAsOperatorDef`, with an `isLambdaDef` guard keeping
  lambda evaluation on its dedicated broadcast arm (empty source answers
  `[]`, matching the value route, not the builtin `Nothing` convention).
  Unbounded identities still echo the whole operand (D10 unaffected).
- **Marker decomposition — the GROUND case (user-ruled 2026-08-04).**
  The decomposition predicate
  (`functionLiteralDeclaredSignature`) required an effect set OR a
  `forall` clause, so an UNGROUPED ground arrow in the return slot read
  as a return TYPE: `["Function", ["Typed", body, "(x: number) ->
  number"], "x"]` typed `(unknown) -> (x: number) -> number`, and a
  broadcast call typed `list<(x: number) -> number^3>` while evaluating
  `[2,4,6]`. The predicate is now **any ungrouped signature marker** —
  the grouped spelling (ruled 2026-08-01) is the author's explicit
  opt-out for the returns-a-function reading, so a ground arrow needs no
  second discriminator. Consequences: the E2 well-formedness pre-pass
  (arity, no optional/variadic) covers ground markers too — erasure
  still applies only to quantified positions; a plain arrow states NO
  effects (`signatureEffects` is `undefined`, never a stated-pure
  contract); the serializer's twin predicates
  (`fnLiteralParts`, the standalone `Typed` handler) mirror it, and the
  anonymous-literal route falls back to the lossless generic
  `Function(Typed(body, "‹sig›"), …)` spelling whenever the marker
  DECOMPOSED — dropping it as an ascription silently widened a result
  narrower than the body's inferred type; and every
  site that SYNTHESIZES a return-type marker from a `Type`
  (`desugarSignatureString`, `reconcileFunctionLiteralReturn`,
  `fnLiteralParts`' `retType`) goes through `returnTypeText`, which keeps
  a signature RESULT grouped so it cannot re-read as a contract.
- **Re-assign keeps the OPERATOR definition (user-ruled 2026-08-04).**
  `ce.assign('f', ⟨annotated literal⟩)` twice migrated the binding to a
  VALUE definition on the second call (the declared-signature
  reconciliation branch in `assignFn`), dropping the operator half — and
  with it the derived `broadcastable` flag and the
  `_isLambda`/`_lambdaLiteral` consumers. A def that already carries a
  user lambda now keeps its operator representation, rebuilt under the
  same declared signature (which re-derives `effectsDeclared`). Notebook
  re-run semantics: assign twice ≡ assign once. The
  `evaluate === undefined` half of that branch — a declared-but-
  unimplemented signature — still installs a VALUE, which is what makes
  the object-form `ce.declare(f, { signature })` spelling observably
  identical to the string form. The declared-type compatibility check is
  NOT relaxed: a differently-shaped annotated literal still throws.
- **Recursion**: declare `f : forall T. (T) -> T`, assign a literal whose
  body calls `f`. During body canonicalization the self-call validates
  against the polytype with an inferable-`unknown` actual → the solver's
  inferable branch contributes no bound → S3 → no narrowing write (the
  instantiated param is `unknown`, and `instantiatedParam` returns
  `undefined` on open residue → the write is skipped). No new machinery;
  pinned by a generic recursive test (e.g. generic `length` via `Rest`).

### 2.6 Multi-clause interaction (G2, RULED — reject)

Precedence pinned (review finding: v1 text was self-contradictory):
**the G2 gate runs before signature-assembly diagnostics**, at both
layers (parser and engine — route parity):

1. **Clause slot + literal parameter(s)** (`function f<T>(0) { … }`):
   rejected at the **first** definition — value-clause machinery is
   multi-clause territory. Parser-side diagnostic (both facts are local
   to the head) AND the engine-side gate below (box route).
2. **`DefineFunction` onto a symbol with existing clauses**, where the
   incoming clause is generic → `generic-clause-unsupported`.
3. **Any later clause onto a symbol whose definition is generic** →
   `generic-clause-unsupported` (both directions closed).
4. **Plain single-clause generic** (`function f<T>(x: T) -> T { … }`,
   no literal params, no existing clauses): the §4.2 single-clause rule
   delegates to `ce.assign` → the E2/E3 install path (§2.4). No
   rejection.

Engine-side, the gate lives in `DefineFunction` canonical/evaluate
(`core.ts:1325`) and `defineFunctionClause` (`multi-clause.ts`); error
value on the operator route, throw on the host route (the
Assign/Declare conversion pattern). This closes the latent hole:
`declaredSignatureOf` (`multi-clause.ts:201`) currently accepts
`typeParams`-carrying signatures unchecked.

### 2.7 Compile (G3, RULED — decline stays)

`base-compiler.ts` already declines polytypes (`:4719`, `:4755`,
`:4783`). New: `tryEmitMultiClauseFunction` cannot meet a generic clause
(G2), and `ensureUserFunctionEmitted` on a generic `_lambdaLiteral` must
take the existing whole-fn decline (return `undefined`, never throw).
Cost assessment recorded in the preamble (monomorphization machinery —
not the parent spec's "cheap" case). Add the ROADMAP compile-coverage
ledger line.

## 3. M2 — the sugared definition form

Grammar (ruled, parent spec §9.1):

```
"function" <name> ("<" <var_decl> ("," <var_decl>)* ">")? "(" <params> ")" <effects>? ("->" <type>)? <body>
```

with `<var_decl> ::= <identifier> (":" <ground-type>)?` — §3 of the
parent spec. An **empty clause `<>` is rejected** with a dedicated
diagnostic (review finding; don't rely on fallout).

### 3.1 Parsing (`cortex/parser.ts`)

- **Slot**: in `parseFunctionDefinition` (`:1758`), between the name and
  the required `(` — currently a hard `opening-bracket-expected` error,
  so the slot is free and unambiguous (statement position only; `<`
  never enters the expression grammar from here).
- **Clause parsing is raw-source, not token-level.** `<`/`>` are
  maximal-munched operator chars (`function f<T: list<integer>>(…)`
  lexes the closing `>>` as ONE token, and a signature bound
  `forall T: (real) -> real` puts a `>` inside `->`). Parse the clause
  the way annotations already work: read the identifier token, and on
  `:` delegate the bound to `parseTypePrefix` on the raw source with
  `advanceToOffset` re-sync (the `parseTypeBody` pattern, `:2336`);
  then expect `,` or `>` — splitting a munched `>>`/`>(`-adjacent
  operator token by offset as needed. Duplicate names in one clause:
  parse-time error (mirror `parseForallType`'s check).
- **Erased lowering at the parser** (review finding — primary
  mechanism): a parameter whose annotation names a clause variable
  lowers to a **bare** symbol (the full-signature ascription carries
  its type); ground annotations keep their `Typed` markers. The engine's
  E2 pre-pass (§2.3) remains the invariant for hand-authored box-route
  input — both mechanisms exist, route-parity-tested.
- **Name scope (G7, recommended — head only).** Seed the type resolver's
  `knownTypeNames` with the clause's names for the **head span only**
  (parameter list, effects slot, return type), snapshot/restore around
  it (the `parseBlock` pattern, `:448`). The body parses unseeded: a
  body-local `let y: T` is an ordinary unknown-type parse error in v1
  (documented), and nested literals cannot capture `T` — rank-1 by
  construction. A quantified name shadows a same-named nominal/alias for
  the head span (the type-grammar's own scoping rule applies to the
  assembled string anyway).
- **`function` keyword form only.** The math-def form `f<T>(x) = x` is
  NOT claimed (`isMathFunctionDef` requires the paren abutting the name;
  `f<T>(x)` is genuinely ambiguous with `a<b>(c)` relational/invisible-
  multiply). Pin a test that it still parses as an expression statement.
  The `function`-keyword math-body form, if `parseFunctionDefinition`
  supports one, carries the clause; otherwise nothing to do.
- **Reserved-word hygiene**: clause names are type-grammar names, not
  Cortex bindings — `LITERAL_WORDS`/`RESERVED_WORDS` don't apply; but
  `forall` remains reserved in type strings (`RESERVED_TYPE_NAMES`) so a
  clause name `forall` fails naturally when the assembled signature
  parses.

### 3.2 Lowering (`specifierSignature` / `definitionAscription`)

- `specifierSignature()` (`:2037`): `build()` gains the clause prefix —
  `` `forall ${decls}. (${args}) ${effects} -> ${ret}` `` with `decls`
  rendering `name` or `name: bound` (bound text preserved verbatim from
  the source slice). The assembled string is self-contained — `forall`
  introduces its own names — so the existing `parseType(candidate,
  this.typeResolver)` validation needs no seeding, and the type
  grammar's own declaration-time validation gives **parse-time**
  diagnostics for unused variables (`function f<T>(x: integer) ->
  integer`), result-only variables, non-ground bounds, and duplicates —
  for free. (G2 rule 1 — clause + literal params — is checked **before**
  assembly, §2.6.)
- `definitionAscription()` (`:2006`): assemble the full signature not
  only when an effect specifier exists but **whenever the clause is
  non-empty** (an effects-less polytype needs a spelling; the type
  grammar allows an omitted effects run). The ascription becomes the E2
  full-signature `Typed` marker; lowering to `DefineFunction` is
  unchanged.
- The unnamed fallback (`build(false)`) is fine for polytypes — the
  clause does not require named args (E2's positional-mapping rule,
  §2.3, is name-independent).

### 3.3 Serialization (`serialize-cortex.ts`)

- `fnLiteralParts` (`:881`): decompose when the re-parsed marker carries
  effects **or** `typeParams` (mirror the `function-literal.ts`
  predicate — the two halves must stay in sync, the 93+94 rule). Recover
  the clause for the slot; the wide-result rule (`:906`) still applies.
- `serializeNamedDef` (`:987`): emit `<T, U: bound>` between the name and
  the param list (`:999`), bounds via `typeToString`. Parameter names
  come from the **literal operands** (names of record); parameter types
  from the **positionally aligned marker arguments** (§2.3 rule — marker
  names are cosmetic and may disagree; never serialize a marker name as
  a parameter name).
- Round-trip target (pinned): `function f<T: number>(x: T) -> T { … }` →
  MathJSON → identical Cortex text. The `Declare` route still emits the
  full-literal `forall` spelling (never-decompose stays there).
- Known pre-existing gap, out of scope: a `Function` literal in a
  `Declare` value bag serializes as `Function(x, x)` not `x |-> x`
  (pinned at `type-variables-cortex.test.ts:317-337`) — E3 round-trips
  remain imperfect for that reason alone; not made worse here.

### 3.4 Diagnostics

- Retire `GENERIC_FUNCTION_LITERAL_MESSAGE` (it promises this feature).
  Sites that keep rejecting (rank-2 param annotation, malformed E2
  marker) get messages stating the rule ("type variables are introduced
  by a whole-signature `forall` clause or `function f<T>(…)`"), no
  longer "v1"-phrased.
- New codes: `generic-clause-unsupported` (G2),
  `generic-partial-application` (G5), the E2 invalid-marker diagnostic
  (§2.3), the empty-clause diagnostic (§3), the G11 intersection
  rejection (§2.4). Every new Cortex `DiagnosticCode` gets a CLI
  `format.ts` case (the Phase-2 checklist rule).
- The D7 test block (`type-variables.test.ts:1317-1417`) and the Cortex
  D7 pins (`type-variables-cortex.test.ts:99-107`, the serializer
  vacuous-rule pins `:250-338`) are rewritten to pin the new behavior.

## 4. Decisions

### Ruled (2026-08-04, user — do not re-litigate)

- **G1** M1 = erased-body canonicalization (§2.1).
- **G2** multi-clause × generic = reject, dedicated diagnostic; the G2
  gate precedes signature-assembly diagnostics; clause + literal params
  rejects at the first definition (§2.6).
- **G3** compile decline stays, with the cost assessment recorded
  (preamble, §2.7).

### Ruled (2026-08-04, user, post-review — do not re-litigate)

- **G4** Definition-time return covariance: check only when the declared
  result is ground; skip when it mentions a variable (§2.4).
- **G5** Partial application of generic literals: reject with diagnostic
  at the currying branch, annotation-independent (§2.5). Lift = partial
  instantiation, future work.
- **G6** Variables enter only via whole-signature `forall` clauses; bare
  unknown-name annotations never become variables (§2.2).
- **G7** M2 clause names scope over the definition head only; body-local
  type references to `T` are v1 errors (§3.1).
- **G8** Bounds do not inform body canonicalization (pure erasure);
  revisiting this means re-opening the approach-3 ruling with a
  soundness argument, not a patch (§2.1).
- **G9** When both a literal marker and a declared polytype are present:
  α-equivalence on the type axes via the existing
  `alphaEquivalentSignatures` relation, effects axis excluded (governed
  by the subset rule), else `declaredTypeError` (§2.4).
- **G10** The variable-correlated return under erasure = trusted
  ascription (disclosed, pinned, strict-mode runtime check recorded as
  future work) (§2.4).
- **G11** Literal bodies only for **single-arm** polytypes; polymorphic
  overload intersections + literal body keep a dedicated D7-style
  rejection (§2.4).

## 5. Test plan

Route parity is the organizing principle (the lazy-operator lesson: a
suite that exercises one construction route misses whole failure
classes). For each: `ce.assign` host route, `Assign` operator route,
box route (E1 and E2 spellings), Cortex `const` (E3), M2 statement (E4).

1. **identity/swap end-to-end** — `forall T. (x: T) -> T` and
   `forall T, U. (x: T, y: U) -> tuple<U, T>`: correct values, correct
   *instantiated* result types (`f(5)` : integer-family, `f("a")` :
   string), `f.type` polymorphic, `f(5)` then `f("a")` on one engine (no
   cross-call pollution).
2. **Anonymous application** (review finding) — `(E1 literal)(args)`
   without any symbol: accepted call, and a bound-violating call
   rejected (`forall T: number. (T) -> T` applied to a string).
3. **Bounds** — `forall T: number. (T) -> T`: string argument rejected
   with the §8 bound-naming line; broadcast over `[1,2,3]` does not
   double-lift (both the value-def arm and the **operator-def twin arm**,
   §2.5 — the pre-flagged regression).
4. **Generic recursion** — declare-then-assign, self-call in body; value
   and type at two instantiations.
5. **Mixed params** — `forall T. (x: T, n: integer) -> T`: ground
   annotation enforced at apply, erased param not.
6. **Boundary rules** — G9 α-agreement: match under renaming
   (`forall U. (U) -> U` literal vs `forall T. (T) -> T` declared —
   accepted), genuine mismatch rejected, **narrower explicit effects
   accepted** (`pure` marker under `random` declaration — the review's
   explicitness-penalty case); ground-annotation coverage (§2.4 rule 4:
   `(x: real)` under `forall T: integer` accepted, `(x: integer)` under
   `forall T: number` rejected); effects axis (random body under pure
   declaration rejected); arity mismatch; **E2 well-formedness** (marker
   arity ≠ literal arity, variadic marker — both rejected); **G11**
   intersection + literal body rejected.
7. **G10** — `x |-> 0` at `forall T. (T) -> T`: pin whichever behavior
   is ruled (trusted ascription: `f("a")` types `string`, evaluates `0`,
   documented; or strict-mode check: diagnostic).
8. **G2** — clause + literal param first definition
   (`function f<T>(0) { … }`), generic clause 2 onto ground set, ground
   clause 2 onto generic def — each `generic-clause-unsupported`, parser
   and box routes.
9. **G5** — under-arity call on a 2-ary generic → the dedicated
   diagnostic, not an `unsolvable-type-variable` throw; Phase-1 probe
   result recorded in the test comment.
10. **M2 grammar** — bounds incl. `<T: list<integer>>` (munched `>>`) and
    `<T: (real) -> real>` (arrow in bound); effects slot
    (`function f<T>(x: T) random -> T`); parse-time diagnostics: unused
    variable, result-only variable, duplicate names, F-bounded bound,
    **empty clause `<>`**; `f<T>(x) = x` NOT claimed as a definition;
    body-local `let y: T` errors (G7).
11. **Serialization** — M2 lossless round-trip; marker-name/operand-name
    disagreement serializes operand names; `Declare` route still
    full-literal; the vacuous-rule pins superseded deliberately.
12. **Ground invariant** — no `expr.type` anywhere in the above contains
    a free variable (sweep assertion helper from the v1 suite).
13. **Compile** — `compile()` on a generic user fn → interpreted
    fallback, correct values (G3).
14. **No-regression** — full suite; snapshot blast radius measured and
    reported (expected: zero, as in v1).

## 6. Implementation phases

Each phase lands full-suite-green with zero unexplained snapshot churn.

1. **M1 core** — `function-utils.ts` (E2 pre-pass + well-formedness, E1
   desugar branch, three gates), `function-literal.ts` (predicate,
   return-type accessor, literal `.type` with the effects union), the
   `makeLambda` validation-gate widening, G5 currying guard (+ the
   failure-mode probe). The literal works standalone (anonymous
   application, test 2).
2. **M1 boundary** — the six-site table (§2.4), G11 single-arm
   restriction, operator-slot install, recursion, G2 rejections, the
   twin result-typing arm (§2.5). Rewrites the D7 test block.
3. **M2** — Cortex clause parse (+ empty-clause diagnostic) + head-only
   seeding + erased lowering, `specifierSignature`/`definitionAscription`,
   serializer, diagnostics + CLI cases.
4. **Docs & ledger** — `doc/08-guide-types.md` (Generic Signatures
   section gains the literal + sugared forms), `doc/87-reference-
   functions.md` (Function entry), Cortex `docs/types.md`/`syntax.md`
   EBNF, CHANGELOG, ROADMAP compile-coverage line, parent spec §9.1
   marked implemented with a pointer here. (`doc/` is gitignored —
   deliverable nonetheless.)
