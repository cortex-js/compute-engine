# Typed Function Literals — Design Note

**Date:** 2026-07-12
**Status:** IMPLEMENTED (Phases 1–4, 2026-07-12; uncommitted). Phase 5 (docs)
pending. Deviations from this note are recorded inline as *implementation
correction* / *guarded* notes and in §14.
**Owner:** Compute Engine
**End goal:** Cortex `f(x: integer) -> real = …` and `(x: integer) |-> …`
expressed natively in MathJSON, with param types enforced and return types
honored — retiring the `Declare(f, "(…) -> any", Function(…))` side-channel
introduced in 03e57cc3.

---

## 1. Problem

The `Function` operator — `["Function", body, ...params]` — accepts only bare
symbols as parameters (`(expression, symbol*) -> function`; a non-symbol param
becomes an `expected-a-symbol` error, `function-utils.ts:230`). Consequences:

- **Anonymous function literals cannot carry types at all.** There is no way
  to write "the function taking an integer to a real" as a value.
- **The literal's type is maximally weak.** The `type()` special case in
  `boxed-function.ts:1801` hardcodes `(unknown, …) -> bodyType`, and must
  apply a finite-numeric *widening hack* (finite body type → `number`)
  precisely because a param of unknown type may later receive `∞`.
- **Param bindings are untyped.** Canonicalization declares each param in the
  body scope as `{inferred: true, type: 'unknown'}` — with a literal `@todo`
  at `function-utils.ts:264` anticipating typed declarations. Body type
  inference therefore can't use annotations (`x + 1` stays `number` even when
  the author knows `x: integer`).
- **Named typed functions need a side channel.** The Cortex parser (03e57cc3)
  works around this by emitting
  `["Declare", "f", {str: "(integer) -> any"}, ["Function", …]]` so that the
  engine's `validateArguments` enforces param types at box time. This (a) only
  works for *named* functions, (b) drops the **return type** — a declared
  `(integer) -> integer` is rejected because the body's weakly-inferred return
  (`number`) fails the covariant check (the rejection is an uncaught throw at
  `boxed-value-definition.ts:150`) — and (c) makes the type live apart from
  the value, so the literal doesn't round-trip as a self-describing MathJSON
  value.

Meanwhile the type language already has the entire vocabulary needed:
`parseType('(x: integer, y: real) -> complex')` parses today into a named,
typed signature (`src/common/type/types.ts` grammar). Only the `Function`
*literal* can't carry it.

## 2. Non-goals (v1)

- LaTeX **parse** syntax for typed params (no idiomatic notation; MathJSON and
  Cortex are the authoring surfaces).
- Pattern-typed or destructuring parameters.
- Default parameter values. (The type grammar's optional `?` / variadic `+ *`
  markers give these a future home inside the same encoding; see §10.)
- A general gradual-typing pass over function bodies. Annotations improve
  *lazy* type queries; they do not trigger whole-body type checking.

## 3. Alternatives considered

### 3.1 New operator (`TypedFunction`) — rejected

Everything keys on `expr.operator === 'Function'`: `makeLambda` and its curry
path, closure capture, `Sum`/`Integrate` variable handling in `calculus.ts`,
collection operators, `compile()`, the LaTeX serializer, `resolveEscapingLambda`.
A parallel operator doubles every dispatch point and splits the published
MathJSON spec surface for no benefit.

### 3.2 Signature-string operand — rejected as primary form

`["Function", body, "'(x: integer) -> real'"]` is compact and reuses the full
type grammar, but demotes parameters to names-inside-a-string. Currying,
α-renaming, `subs`, and closure capture all manipulate params as expressions;
each would have to re-parse/re-print the type string, and a mixed form (some
params symbols, some named only in the string) creates two sources of truth.
May be revisited later purely as *sugar* canonicalizing into the structural
form below.

### 3.3 Reuse `Annotated` — rejected

`Annotated` (`core.ts:382`) is defined as strippable style/metadata: `Text`
unwraps it, evaluation passes through it, and consumers are entitled to drop
it. Type enforcement is not strippable metadata; overloading `Annotated` would
make "safe to ignore" ambiguous.

### 3.4 Extend `Function`'s parameter shape — **chosen**

A non-symbol param is an error today, so extending the accepted shapes is
fully backward compatible: no currently-valid document changes meaning, and
zero snapshot churn is expected for existing expressions.

## 4. Proposed encoding

### 4.1 Authoring (input) form

```
["Function", body, param₁, …, paramₙ]

  param  := symbol                        // unchanged; param type stays inferred
          | ["Typed", symbol, type]       // annotated parameter

  body   := expression                    // unchanged; return type inferred
          | ["Typed", expression, type]   // return-type ascription

  type   := string literal (canonical)    // e.g. {"str": "integer"}
          | type-name symbol (accepted)   // e.g. "integer" — normalized to string
```

### 4.2 Canonical form — the ascription lives INSIDE the Block

**Review finding (blocker, both passes):** a `Typed` node in the body slot
breaks the pervasive "op0 is a scoped Block" invariant. `makeLambda` asserts
`body.isScoped` and throws otherwise (`function-utils.ts:585-589`), its
nullary path branches on `onlyBody.isScoped` (:549, :562), `captureClosures`
keys on `expr.op1.localScope` (:438-439) and would *silently skip closure
capture*, and ~8 further sites (calculus, the MathJSON Block-collapse
optimizer in `serialize.ts:293-336`, `EvaluateAt` serialization) read `op1`
as the Block.

Canonicalization therefore normalizes the authoring form by moving the
ascription inside the Block, wrapping the final statement:

```json
["Function",
  ["Block", ["Typed", ["Add", "x", "y"], "'real'"]],
  ["Typed", "x", "'integer'"],
  "y"]
```

- `ops[0]` remains a scoped `Block` everywhere: `makeLambda`, closure capture,
  the nullary path, and all `op1` readers are structurally unaffected.
- `evaluateStatements` evaluates the `Typed` statement transparently
  (ascription is a no-op at evaluation), so the value path is unchanged.
- A `Block`'s type is its last statement's type, so `body.type` surfaces the
  ascribed return without new plumbing.
- The ascription types the fall-through value; early `Return` branches are
  *declared*, not checked, by it (consistent with §6.3 — ascription, not
  check).
- If the authored body is already a multi-statement `Block`, the ascription
  wraps that Block's last statement.
- Cosmetic, accepted: a `Typed` final statement suppresses the MathJSON
  Block-collapse pretty-printing optimization (fails closed; round-trip is
  unaffected).

Other notes:

- **`Typed` is a new operator** (verified: no collisions in `src/`, `test/`,
  `doc/`). Precedent: Wolfram's `Typed[x, type]` in `FunctionCompile`.
- The type operand mirrors `Declare`'s op2 convention (`string | symbol`,
  kept **raw** during canonicalization so a type-name symbol such as `real`
  is not auto-declared as a variable). Canonical form normalizes to a string.
- Annotations are **kept in the canonical ops**. The literal must remain
  self-describing: MathJSON serialization round-trips the types, and any
  consumer reading `expr.ops` sees them.

## 5. `Typed` operator semantics

Registered in `core.ts` as a general **type ascription** operator, of which
`Function` is the first consumer:

```
Typed: {
  description: 'Ascribe a type to an expression.',
  lazy: true,                       // op2 must stay raw (type-name symbols)
  signature: '(any, string|symbol) -> unknown',
  type: ([x, t]) => parsedType(t) ?? x.type,
  canonical: normalize op2 to a string; canonicalize op1,
  evaluate: ([x], options) => x.evaluate(options)   // ascription is transparent
}
```

Decision: **ascription, not a check** (see §6.3 for why). `Typed(x, "'integer'")`
*asserts* the type for the type system; it does not verify `x`. A strict-mode
value check is a possible follow-on (§10).

Rules interaction (review nit): rule patterns are boxed in a clean scope
without operator definitions (see rules-pitfalls memory), so a `Typed` node in
a pattern gets no canonical normalization — its op2 stays whatever the author
wrote, and no auto-declaration runs (nothing runs). The `Typed` canonical
handler must be robust to both string and symbol op2 regardless of when it
finally executes.

Single chokepoint (review positive): both entry paths converge — `ce.box(…)`
routes through the `Function` canonical handler (`core.ts:1037-1038` →
`canonicalFunctionLiteralArguments`) and `makeLambda`/`applicable` route
through `canonicalFunctionLiteral` (:173-174) into the same function. Phase-1
param handling in that one place covers both.

## 6. Semantics

### 6.1 Canonicalization (`canonicalFunctionLiteralArguments`)

For each annotated param, declare its binding in the body's Block scope with
the declared type and `inferred: false` — resolving the `@todo` at
`function-utils.ts:264`. The body ascription is normalized per §4.2.

**Ordering constraint (load-bearing, sharpened by review):** the annotated
binding must be visible *before* body canonicalization, not just before the
first external type query. `BoxedFunction` caches `_type`
(`boxed-function.ts:156`) keyed on an engine generation counter that
`ce.declare` does **not** bump; and canonical handlers of body operators query
their *operand* types (e.g. `Add`/`Multiply` canonicalization reads
`(x*2).type`), so a nested sub-expression can cache a type computed with
`x: unknown` that a later binding upgrade cannot invalidate. Two mechanisms
were considered:

1. **Pre-declare (chosen):** make the annotated types available to the body's
   canonicalization pass — extend the existing shadowed-parameter mechanism
   (`_pushShadowedParameters`, which already threads param names through body
   canonicalization) to carry the declared types, so the auto-declaration of
   a param during Block canonicalization creates the binding with the
   declared type directly. *Implementation addition:* the auto-declared
   binding is **cached on the shadowed-parameter stack frame** so every
   reference in the body — including references inside nested `Block` scopes
   (`if` branches) — reuses the same binding. Without this, each nested Block
   got a stray valueless copy that apply-time parameter hiding never removes,
   breaking recursion through Block-wrapped branches (stack overflow on
   `f(n: integer) = if n≤1 {1} else {n·f(n−1)}`). Known residual: if a
   param's *first* reference is inside a nested Block, its single binding
   lands in that nested scope rather than the body's top scope; not exercised
   by any current pattern (conditions are canonicalized before branches) and
   strictly narrower than the pre-fix behavior.
2. Upgrade-after-canonicalization: only safe if done as an **in-place
   mutation** of the existing `def.value.type` (embedded param symbols hold a
   reference to the def object; replacing the def leaves them stale), *and*
   only if no nested expression cached a type during canonicalization — which
   does happen. Rejected as the primary mechanism; acceptable as a fallback
   only with the in-place constraint and a regression test.

Acceptance test that locks the requirement:
`ce.box(["Function", ["Add","x",1], ["Typed","x","'integer'"]]).type` must be
a signature whose param is named and typed (`x: integer`) and whose result is
`integer`-valued — i.e. the annotation reached body inference, not just the
signature printout. (Exact printed string to be pinned at implementation
time: `type()` must newly emit param *names*, and the inferred result may
print as `integer` or a subtype.)

`_pushShadowedParameters` and the `expected-a-symbol` validation both unwrap
`Typed` to reach the param name.

### 6.2 Typing (`type()` special case, `boxed-function.ts:1797`)

Build the signature from the ops:

- Param slot: annotated → its declared type, **named** (`x: integer` — the
  named-arg type grammar exists; emitting names from `type()` is new);
  bare → `unknown` as today.
- Result: body ascribed (§4.2 marker) → the declared return type, **verbatim**,
  bypassing the widening rule entirely.
- Result, no ascription: inferred body type with the widening rule kept
  *as-is*: widen a finite-numeric body type to `number` when any param could
  receive a non-finite argument. Review calibration: this is **not** "any
  annotation disables widening." In this type system `integer`, `rational`,
  `real` all admit non-finite values (`'integer'.matches('finite_number') ===
  false`); only `finite_*` types are finite. So `(x: integer) ↦ x/2` has body
  type `finite_real` and still soundly widens to `number` (`x=∞ → ∞`), while
  `(x: integer) ↦ x+1` has body type `integer` (not finite-numeric) and never
  trips the hack. Widening is suppressed only when *every* param type matches
  `finite_number`. Declared-return ascription is the reliable way to a tight
  result type; improved inference is a bonus, not the contract.

### 6.3 Return type: ascription, not covariant check

This is the load-bearing semantic decision, and it is what unblocks Cortex
residual (a) of 03e57cc3. The engine's declared-vs-inferred covariant check
rejects `(integer) -> integer` when weak inference says the body returns
`number` — reproduced: `Declare(f, "(integer) -> integer", Function(Add(x,1),
x))` **throws uncaught** at `boxed-value-definition.ts:150`. Inference will
stay incomplete forever, so TypeScript-style **the annotation is
authoritative**:

- The literal's type uses the declared return verbatim (§6.2).
- No canonicalization-time rejection when inference is merely *wider* than
  the declaration.
- If inference and declaration are provably **disjoint** (e.g. declared
  `string`, body provably `integer`), canonicalization MAY surface an error;
  v1 keeps this to a `console.assert`-level diagnostic to avoid false
  positives from weak inference.
- **Declared-signature reconciliation (added by review):** when a literal is
  assigned to a symbol that carries an explicit declared signature (e.g.
  `Declare(f, "(integer) -> integer")` then `Assign(f, ‹literal›)`), and the
  literal lacks a return ascription, the declared return is **ascribed onto
  the literal** rather than covariantly checked against weak inference.
  Param annotations alone must not be required to satisfy a return-typed
  declaration; without this rule the assignment still throws at
  `boxed-value-definition.ts:150` even after this design lands.
- Optional strict-mode *runtime* result check at apply time (§10 follow-on).

### 6.4 Application (`makeLambda`, `function-utils.ts:513`)

After step 4 (arguments evaluated in the calling scope), and only in strict
mode (`ce.strict`, mirroring named-operator behavior):

- Validate the evaluated arguments against the literal's signature by
  reusing **`validateArguments`** (`validate.ts:438`). *Implementation
  correction:* a static import from `function-utils.ts` DOES create a cycle
  (`validate.ts → utils.ts → boxed-operator-definition.ts →
  function-utils.ts`); the implementation uses the established lazy-setter
  injection pattern (`_setValidateArguments`, registered in
  `boxed-expression/init-lazy-refs.ts`, inline function type to avoid a
  type-only cycle). Diagnostics are identical to the named-operator path
  (`incompatible-type` error markers per argument, via `ce.typeError`).
- On mismatch, `invoke` **returns the inert application directly** —
  `ce._fn('Apply', [fn, ...errorMarkedArgs])` — as a truthy Expression that
  `apply()` passes through. (Review correction: the previous "return
  `undefined` and upgrade the fallback" phrasing doesn't work — the
  `undefined` channel can't carry the error-marked args, `function-utils.ts:
  301-303`.) So `Apply((x: integer) ↦ x+1, 2.5)` surfaces
  `["Apply", fn, ["Error", ["ErrorCode", "'incompatible-type'", …], …]]`,
  matching what `f(2.5)` produces via the named-`Declare` path. Broadcast
  consumers (`Map` etc., which route through `apply`) then yield lists whose
  mismatched elements carry the same diagnostic instead of silently inert
  nodes.
- Arguments of `unknown`/`any` type pass (not provably wrong) — same rule as
  `validateArguments`.
- The fresh-scope binding for each annotated param is declared with the
  **declared type** (plus the value), not `inferred: true` — *guarded*: only
  when the value's type provably matches the declaration. An `unknown`/`any`/
  symbolic value passes validation as "not provably wrong", but binding it
  under a narrower fixed type trips the value-definition covariant check
  (throws at `boxed-value-definition.ts:150`), so such values keep the
  historical inferred binding and beta-reduce symbolically as before.

Non-strict mode: no per-argument checking (fast path), same as operators.

### 6.5 Currying (partial application, `function-utils.ts:617`)

Review sharpened this from "automatic" to three explicit obligations:

1. **Substitution keys on the inner symbol**: fresh-name seeding (:621),
   substitution keys (:635), and applied-arg binding (:648) all extract param
   names via `isSymbol(p) ? p.symbol : ''` today — a `Typed` param yields `''`
   and the machinery silently misbehaves. All go through the §7 accessor.
2. **Unapplied params re-wrap**: the `extras` (fresh bare symbols, :623-629)
   inherit the original params' `Typed` wrappers with the fresh names.
3. **Return ascription re-attaches**: `newBody` is the *evaluated* body (the
   `Typed` marker is consumed by evaluation), so the rebuild
   (:680) must re-ascribe the original return type onto the curried literal —
   partial application does not change the result type.

Applied args are validated (§6.4) before substitution.

### 6.6 Closure capture, escaping lambdas, shorthand literals

- `captureClosures` builds `innerParamNames` via `isSymbol` (:448-453) —
  **must migrate** to the §7 accessor, else typed params yield an empty name
  set and the param-binding copy into the closure scope is silently dropped.
  (Review correction of the earlier "no change" claim.)
- The `Typed`-inside-Block placement (§4.2) keeps `expr.op1.localScope`
  working, so the *structural* part of capture is unchanged.
- The invoke-path name extractions (`function-utils.ts:602, :665-667,
  :702-710`) migrate likewise; at :704 a `''` name silently skips binding the
  argument value — the worst failure mode of a missed site.
- Shorthand literals (`["Add", "_", 1]`) never carry annotations; the
  shorthand path is untouched.
- `hideBodyScopeParams` hides params **by name** (the name-set check precedes
  the inferred-only check, :375-379), so annotated (`inferred: false`) params
  are still hidden at call time. Verified by review.

## 7. Shared accessor: `functionLiteralParameters`

One helper centralizes the param shape so no call site pattern-matches
`Typed` by hand:

```ts
functionLiteralParameters(expr): { name: string; type: Type | undefined }[]
functionLiteralReturnType(expr): Type | undefined   // reads the §4.2 marker
functionLiteralBody(expr): Expression               // Block, marker included
```

**Placement (layering verified by review):** a new leaf module
`boxed-expression/function-literal.ts` importing only `type-guards` and
`common/type`. `boxed-function.ts` already imports from `function-utils.ts`
(:90) and `function-utils.ts` already imports boxed-expression leaf modules —
the sandwich is legal under the ESLint directory-layer rules and cycle-free;
re-run `npx madge --circular --extensions ts src/compute-engine` after wiring.

Call sites to migrate (corrected and extended by review):

| Site | Today | Failure if missed |
|---|---|---|
| `function-utils.ts` invoke/curry name extraction (:602, :621, :635, :648, :665-667, :702-710) | `isSymbol(p) ? p.symbol : ''` | arg value never bound to param |
| `function-utils.ts` `captureClosures` (:448-453) | same | closure param copy dropped |
| `canonicalFunctionLiteralArguments` (:227-231, :245-247) | `isSymbol` check / error | annotated params rejected |
| `boxed-function.ts` `type()` (:1801-1816) | `ops.slice(1)`, all `unknown` | annotations invisible to typing |
| `calculus.ts` multi-index `D` rebuild (**:400-406** — earlier :240/:446 refs were wrong) | `sym(p)` per param | derivative silently degrades to symbolic |
| `symbolic/derivative.ts:265-268` (`differentiateFunction`) | `sym(fn.ops[1]) ?? '_'` | differentiates w.r.t. wrong variable |
| compile: `base-compiler.ts:369, :1440` | `isSymbol(x) ? x.symbol : '_'` | typed params collide to `'_'` |
| compile: `javascript-target.ts:2313` | `.filter(isSymbol)` | typed params dropped, wrong lambdaVar |
| LaTeX serializer `\mapsto` + `EvaluateAt` (`definitions-core.ts:1331`) | positional reads | `Typed` serialized verbatim (ugly, not wrong) |
| `ascii-math.ts:569-589`, MathJSON Block-collapse (`serialize.ts:293-336`) | `isSymbol` guards | fail closed (cosmetic only) |

The fail-closed serialization sites may be handled in v1 by unwrapping in the
accessor-based rewrite or accepted as cosmetic; the rest are correctness
obligations.

## 8. Serialization

- **MathJSON:** round-trips by construction (annotations are ops). The
  Block-collapse optimizer skips a `Typed`-final-statement Block (cosmetic).
- **LaTeX:** `\mapsto` serialization **drops annotations** in v1 (unwrap
  `Typed` on params and the body marker). No parse syntax added. Follow-on
  option: `(x: \mathrm{integer}) \mapsto …` behind a style flag.
- **Cortex:** faithful round-trip is a goal — see §9.
- `expr.toString()` (ASCII-math): drop annotations, same rule as LaTeX.

## 9. Cortex integration (end goal)

1. **Parser** (`src/cortex/parser.ts`):
   - `parseParameterList` emits `["Typed", sym, {str: type}]` for annotated
     params instead of returning a separate `types` array; `buildSignature`
     and the `Declare`-with-signature emission (03e57cc3) are **removed** —
     both def forms go back to plain `["Assign", "f", ["Function", …]]` with
     typed params inline.
   - The **return type** (`-> Type`), currently parsed-and-dropped
     (parser.ts:744), wraps the body: `["Typed", body, {str: type}]`
     (authoring form; the engine normalizes per §4.2).
   - **Mapsto typed params are real grammar work (review blocker):**
     `(x: integer) |-> …` does not parse today — the mapsto LHS goes through
     the general `parseParenthesized`/`parseBracketedList` path
     (parser.ts:1709-1731) where `:` has no infix parselet, so parsing dies
     with `closing-bracket-expected` before `mapstoParams` (:1370) is
     reached. Plan: extend the parenthesized-list element parser to accept an
     optional `: Type` suffix after a bare symbol (reusing
     `parseTypeAnnotation`), marking the group as annotation-carrying; if
     such a group is *not* followed by `|->`, report the existing diagnostic.
     M-sized, shipped in Phase 4 as its own sub-item (it is the
     anonymous-literal payoff), with permission to split into a follow-up if
     it drags.
2. **Engine prerequisite — signature derivation** (Phase 3): this is an
   explicit behavioral change to `assignValueAsOperatorDef`
   (`engine-declarations.ts:633-639`), which today *deliberately* sets no
   signature (keeping `inferredSignature = true`, which return-type-narrows
   in e.g. `Add` operands and bypasses parts of `validateArguments`,
   `validate.ts:524`). New rule: **only when the literal carries
   annotations**, derive and set the explicit signature from the literal's
   type (§6.2), flipping `inferredSignature = false` for that operator —
   calls to `f` then validate exactly as the `Declare` workaround did,
   including the return type. Untyped literals keep today's inferred-
   signature behavior bit-for-bit. The §6.3 declared-signature
   reconciliation rule also lands here (assigning a param-only-annotated
   literal to a return-typed declaration must not throw).
3. **Serializer** (`serializeCortex`): emit `f(x: integer) -> real = …` /
   `(x: integer) |-> …` from the annotated literal — closing residual (b) of
   03e57cc3 (syntactic round-trip).
4. **Roadmap:** update `roadmap/cortex/README.md` — the "Enforce typed
   function params" entry graduates from the v1-via-`Declare` note to the
   native design; residuals (a) and (b) both close.

Compatibility: the `Declare(f, "(…) -> any", Function(…))` form remains valid
MathJSON (nothing removes it); Cortex simply stops emitting it.

## 10. Future room (explicitly out of scope for v1)

- **Optional/variadic params:** `["Typed", "xs", "'number+'"]` has an obvious
  meaning; requires arity-handling changes in `makeLambda`; deferred.
- **Strict-mode runtime return check:** after apply, if the result's type is
  provably disjoint from the declared return, produce `incompatible-type`.
- **Signature-string sugar** (§3.2) canonicalizing into the structural form.
- **General `Typed` checking** outside Function (canonical-time subtype
  verification with error values).
- **Compile targets:** declared param types can inform representation choices
  (e.g. GLSL int vs float); available via the shared accessor.

## 11. Compatibility & blast radius

- Non-symbol params are errors today → no valid existing document changes
  meaning. Existing untyped literals type exactly as before (including the
  widening hack), so **zero snapshot churn expected** from the encoding.
- Registering `Typed` adds one library symbol — tests enumerating library
  symbols may churn trivially.
- Phase 3 changes `assignValueAsOperatorDef` only for annotated literals;
  untyped `Assign(f, literal)` behavior is pinned by tests.
- Measure the full-suite snapshot delta before landing (per snapshot policy);
  anything beyond the above is a red flag.
- MathJSON spec (`doc/50-math-json.md`, `doc/85-reference-core.md` Function
  entry, `doc/08-guide-types.md`): additive documentation update.

## 12. Implementation plan

| Phase | Scope | Definition of done |
|---|---|---|
| 1 | `Typed` operator; canonicalization accepts annotated params + body ascription (normalized per §4.2, pre-declare mechanism §6.1); `type()` emits named typed signatures; shared accessor + full §7 call-site migration | §6.1 acceptance test; MathJSON round-trip; derivative/compile sites take typed lambdas correctly; typecheck; madge clean; zero unrelated snapshot churn |
| 2 | Apply-time enforcement in `makeLambda` (strict mode) incl. the three curry obligations (§6.5) | `Apply` of mistyped arg surfaces `incompatible-type` like the `Declare` path; `Map` over a typed lambda error-marks mismatched elements; currying preserves param + return annotations; existing function tests green |
| 3 | Signature derivation in `assignValueAsOperatorDef` for annotated literals + §6.3 declared-signature reconciliation | `Assign(f, typed literal)` validates calls incl. return type; `Declare(f, "(integer)->integer")` + param-annotated literal no longer throws; untyped-literal inference behavior unchanged |
| 4 | Cortex: parser (defs + mapsto grammar) + serializer retarget; roadmap update | Typed defs enforce; return type honored; `(x: integer) \|-> …` parses; syntactic round-trip; `Declare` workaround removed |
| 5 | Docs (`doc/` pages) | Function reference + types guide updated |

Each phase lands with targeted tests
(`test/compute-engine/function-literals*`, `test/cortex/*`), `npm run
typecheck`, and the madge cycle check when imports change.

## 13. Decisions resolved during review

1. **Operator name:** `Typed` (Wolfram precedent; verified collision-free).
2. **Ascription placement:** inside the canonical Block, wrapping the last
   statement (§4.2). The body slot stays a scoped Block; the
   `["Typed", body, T]` authoring form is normalized at canonicalization.
3. **§6.1 mechanism:** pre-declare via a typed extension of the
   shadowed-parameter stack; upgrade-after only as a guarded fallback
   (in-place `def.value.type` mutation, never re-declare).
4. **Disjoint return declaration:** assert-level diagnostic only in v1.
5. **Mapsto typed params:** ship in Phase 4 as explicit grammar work
   (M-sized), splittable if it drags.
6. **Mismatch surfacing:** `invoke` returns the error-marked inert `Apply`
   directly (truthy), not via the `undefined` fallback channel.

## 14. Implementation record (2026-07-12)

All four phases landed the same day, each verified by the full suite (281
suites / 16400+ tests, 4100 snapshots, **zero churn** every phase):

- **Phase 1:** `Typed` operator; annotated-param + return-ascription
  canonicalization (§4.2 normalization); named typed signatures from
  `type()`; `boxed-expression/function-literal.ts` accessor; full §7
  call-site migration; `Typed` LaTeX serializer entry (drops annotations).
- **Phase 2:** strict-mode apply-time validation in `makeLambda` (both
  paths), lazy-injected `validateArguments` (see §6.4 correction), guarded
  typed fresh-scope bindings, all three §6.5 curry obligations.
- **Phase 3:** signature derivation in `assignValueAsOperatorDef` for
  annotated literals (flips `inferredSignature` only for them); §6.3
  reconciliation at both the `assign` and `declare`/`Declare` seams. Note:
  assigning a function literal to a symbol with an explicit declared
  signature now stores a *value def* under the declared signature (matching
  the `Declare` path) instead of converting to an inferred operator def, and
  a genuinely conflicting assign now throws (was: silently dropped type).
- **Phase 4:** Cortex parser emits native annotated literals (both def forms
  + math-style return type + mapsto typed params via `parseBracketedList`
  `allowTypedParams`); `serializeCortex` reconstructs typed syntax
  (round-trip closed); `Declare`-workaround emission removed; roadmap entry
  updated; shadowed-parameter binding cache (§6.1 addition) fixed recursion
  through Block-wrapped branches.

Tests: `test/compute-engine/typed-function-literals.test.ts` (44) +
`test/cortex/` additions (14). Phase 5 (doc/ pages: `85-reference-core.md`
Function entry + `Typed`, `08-guide-types.md`, `50-math-json.md`) remains.
