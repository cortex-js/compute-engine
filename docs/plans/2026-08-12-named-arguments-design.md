# Named-argument calls — implementation design

Status: design, 2026-08-12. Implements `docs/TYPE_SYSTEM_ROADMAP.md`
Appendix C (rulings C1–C6, all ratified 2026-08-12; C5 = saturated calls
only; C3 approach = per-arm permutation, this doc is the design doc C3
called for). Reconnaissance facts cited by file:line were verified
2026-08-12 against the working tree.

Four conservative sub-rulings are ADOPTED here and flagged for
ratification in §9; none blocks implementation.

## 1. Surface grammar (C1)

Site: `Parser.parseCall` (`src/epsil/parser.ts:6088`) delegates to
`parseBracketedList('CLOSE_PAREN', ')', false, true)`. A new flag
`allowNamedArgs` is threaded through `parseBracketedList`, passed `true`
ONLY from `parseCall`. Index lists (`[...]`), set/dictionary braces, the
pragma argument clause (`parseArgumentClause`, its own loop), and
pattern-position calls (`parsePatternCall` — where `P(a: integer)`
already means a type guard) are untouched.

Production, checked BEFORE parsing each element (the
`parseProtocolMember` lookahead pattern, parser.ts:1958): current token
is SYMBOL or VERBATIM_SYMBOL, and `peek(1)` is an OPERATOR token whose
text is EXACTLY `:`. Then consume both and parse the value expression;
emit the carrier (§2). Otherwise fall through to the ordinary element
parse — `f(a := 1)` (an assignment operand) still parses as today
because its token is `:=`, not `:`.

**Lexer munch hazard — FIXED in review:** `:` is not an operator in
Epsil's table; the lexer's maximal munch glues it to adjacent operator
characters (`scanOperator`, lexer.ts:401), so `f(a:-1)` lexes `:-` as
one token. The named-argument lookahead therefore also fires on an
OPERATOR token that merely STARTS with `:` (excluding anything starting
with `:=`, so `f(a := 1)` and even munched `f(a:=-1)` keep their
assignment reading) and consumes the colon by splitting the token in
place (`consumeNamedArgumentColon`, mirroring the pre-existing
`consumeAlternativeSeparator` precedent for a munched `|`). `f(a:-1)`,
`f(a:-x)`, `f(a:!true)` parse; `f(a::b)` errors cleanly.

## 2. The carrier: `NamedArgument`

The parser emits `["NamedArgument", "'name'", value]` per named
argument (name as a MathJSON string). Model: `Spread` — a parse-level
carrier emitted only inside call argument lists — with one difference:
`Spread` survives to evaluation; `NamedArgument` is consumed at
canonicalization and never appears in a canonical expression.

`NamedArgument` gets an operator definition (library/core.ts, beside
`Spread`/`Sequence`) whose `canonical` handler fires ONLY when the
carrier was not consumed by a callee's normalization — which means no
resolvable declaration supplied names — and produces the
`argument-names-unavailable` error. That single handler covers: unknown
callee (the auto-declare branch, box.ts:1324), forward references,
wildcard-`function`-typed values, and a carrier constructed in a
non-call position via the box route.

Box-route parity holds by construction: `ce.box(['f',
['NamedArgument', "'rate'", 0.05]])` reaches the same normalization
seam as the parse route (§3).

## 3. Normalization seam and algorithm (C2 + C5)

Seam: TOP of `makeCanonicalFunction` (box.ts:1278). A cheap scan
detects any `NamedArgument` head among the raw operands; when none is
present, every path below is byte-identical to today (the zero-cost
guard). When present:

- The numeric fast path (box.ts:1285) and the `List`/`Dictionary` short
  paths (1293/1308) are SKIPPED — the call routes through definition
  lookup so names can be checked (`Add` has unnamed parameters, so a
  named `Add` call correctly errors `argument-name-unknown`).
- Normalization runs immediately after `lookupApplicable` (box.ts:1323)
  and BEFORE everything order-sensitive: `annotateCallbacksFromSignature`
  (positional, and its `resolveContextualArm` keys on `ops.length`),
  `semiCanonical`/`flatten`, the binder pre-phase (`canonicalizeBinder`
  selects binding sites by operand index from raw ops), the lazy split,
  and `validateArguments`. Placing the seam above all of these is what
  makes per-position `invokes`/`discharges` effects metadata and binder
  site selection correct without changes.

Algorithm, per target signature (a `FunctionSignature`; where the names
live: `NamedElement.name`, common/type/types.ts:100):

1. Split operands: a leading run of positional arguments, then named
   ones. A positional argument after any named argument →
   `argument-order-invalid`.
2. Positional prefix fills declaration slots left to right (required →
   optional → variadic, the `paramAt` order). If any argument is named,
   the prefix must not extend into the variadic tail (C5: named calls
   supply no tail); a violation is `unexpected-argument` on the first
   tail-reaching positional.
3. Each named argument matches a declared parameter name across
   `args`/`optArgs`. Unknown name → `argument-name-unknown`, listing
   the declared names (did-you-mean via the existing suggestion
   helper). A name matching a slot already filled (positionally or by
   an earlier name) → `argument-name-duplicate`. Parameters WITHOUT
   declared names are positional-only (most of the library: only ~60 of
   530 library signatures carry any name) — they cannot be addressed by
   name, and their omission follows rule 4.
4. Saturation (C5): after filling, an unfilled REQUIRED slot →
   `ce.error('missing')` blamed on the call — a named call never
   reaches the currying site (`makeLambda`'s under-application branch,
   function-utils.ts:2112, is unreachable because the error is stamped
   at canonicalization; for inferred-signature callees, which skip
   `validateArguments`, normalization itself enforces this).
   An unfilled variadic with `variadicMin ≥ 1` → `missing` likewise.
5. **No optional holes (sub-ruling R1, §9):** a named optional may be
   supplied only if every optional declared BEFORE it is also supplied.
   `f(a, c: 3)` against `(a, b?, c?)` is rejected
   (`argument-optional-skipped` †, a new diagnostic) rather than
   normalized with a hole: the engine has no "absent argument"
   placeholder that survives canonicalization (`flatten` DROPS
   `Nothing`, so a hole would silently shift later arguments left —
   wrong values, the exact failure class this feature exists to
   prevent).
6. Emit the reordered positional operand array; canonicalization
   proceeds exactly as today.

Consumed-name bookkeeping uses the signature as ground truth; name
uniqueness within one signature is NOT currently enforced anywhere in
the type system, so normalization treats a duplicate declared name as
matching its FIRST slot (and a lint-level check on declarations is a
follow-up, not v1).

**Evaluation order (sub-ruling R2, §9):** operands of a canonical call
evaluate in operand-array order (boxed-function.ts:4556), which after
normalization is DECLARATION order, not written order. Adopted: that is
the semantics — a named call's arguments evaluate in declaration order.
Appendix C gains a sentence saying so when this lands. (Today only
Random-family and Assign effects could observe the difference; the
mutable-objects proposal is where it becomes prominent, and its B8
ruling already pins order at the canonical tree.)

## 4. Overloaded callees (C3): per-arm permutation

For an overload set (an intersection of signatures — `overloadArms`),
normalization cannot pick one order up front: shipped multi-clause
functions already produce arms with DIFFERENT names at the same
position (`fib`'s clauses type as `((z: 0) -> …) & ((o: 1) -> …) &
((n: integer) -> …)`, define-function.test.ts:44).

Design: `resolveOverload` (overload.ts:592) accepts the SPLIT call
(positional prefix + named list) when names are present. Per arm:

- Run the §3 algorithm against that arm alone. Failure (unknown name,
  order, duplicate, unsaturated) makes the arm INADMISSIBLE — the
  name-compatibility filter runs before type admission, mirroring how
  `arityAdmits` already pre-filters.
- Success yields the arm's positional operand array and its
  permutation; `ArmInstance` gains `permutation?: number[]` (source
  slot → declaration slot). `OverloadResolution` deliberately carries
  no per-arm state today, so this is new state, populated only for
  named calls.
- Admission (`operandAdmits`) and generic solving (`solveTypeArguments`
  — strictly positional: its `actuals` array and every index-keyed
  callback `skip`/`inferable`/`lifted` align to declaration positions)
  run on the arm's OWN permuted array. This is why the permutation must
  be applied before building `actuals`, not after.
- **Ranking generalizes from positions to source slots.**
  `argSpecificity`/`isMoreSpecific`/`outranks` today iterate `i <
  arity` comparing `paramAt(a, i)` vs `paramAt(b, i)` — implicitly
  assuming both arms consume the same source argument at `i`. With
  permutations, the comparison at source slot `j` is
  `paramAt(a, permA(j))` vs `paramAt(b, permB(j))`. For all-positional
  calls both permutations are the identity and the code path is
  unchanged.
- `joinParamAt` (the per-position join feeding contextual callback
  typing) turned out to need NO generalization: its only caller is
  `validateArguments`, which by normalize-after-win always sees a
  positional call in the winner's declaration order. `resolveOverload`'s
  docblock records that `viable` must not be fed to `joinParamAt` on
  the named path.
- Normalize-after-win: the emitted operand array is the WINNING arm's.
  CORRECTED during implementation — the original draft claimed this was
  automatically consistent because static and runtime selection share
  one decision procedure. That is FALSE: the seam emits a plain
  positional array, and every re-resolution below the seam runs without
  names. With arms like `(x: integer, y: string)` & `(y: number, x:
  string)`, the named winner's emitted order can satisfy the OTHER arm
  positionally; re-resolution picks it in declaration order, and the
  author's named values land in the wrong parameters. The
  implementation therefore re-resolves the emitted array
  (`orderSurvivesReordering`, named-arguments.ts) and REJECTS the call
  when the positional winner would read the operands in a different
  order than the named winner. The guard runs only in the
  disagreeing-permutation branch (zero cost elsewhere). Consequence:
  when arms' parameter types cross-match positionally, even a uniquely
  name-determined call declines (steering to a positional call) rather
  than risk mis-binding.
- **Disagreeing permutations without a unique winner (sub-ruling R3,
  §9):** if several arms survive AND their permutations of the provided
  names differ AND ranking does not produce a unique winner, the call
  is an ERROR (blamed with the standard no-unique-overload diagnosis,
  steering to a positional call) — never a silent
  first-in-declaration-order pick, because the pick would also pick an
  argument ORDER. When all surviving arms agree on the permutation
  (the overwhelmingly common case — same names, same positions),
  declaration-order selection stays exactly as today. As built, the
  error reuses `argument-names-unavailable` with a detail string
  ("these names do not determine which parameter each argument fills")
  rather than minting a sixth code; the `epsil doc` entry covers both
  uses.

## 5. Protocol dispatch (C6) — falls out

Dispatcher operator definitions read the receiver as `ops[0]`
(`receiverType`, engine-protocols.ts:1805, and friends). The §3 seam
runs before the dispatcher's `canonical` handler, and requirement
signatures carry their declared names (`compare(self, other: Self)`),
so after normalization `ops[0]` IS the argument bound to the declared
first parameter regardless of written position. Protocol members are
same-arity, no-optional, no-variadic in v1 — the simplest case of §3.
Pinned by a test with `self` written last.

Implementation notes: the dispatcher synthesized its signature
arity-only (`(any, any) -> unknown`), erasing requirement names — fixed
by carrying each position's requirement parameter name into the
synthesized args when every requirement shape agrees on it
(`sharedParameterName`, engine-protocols.ts); positions with
disagreeing names stay unnamed. The QUALIFIED spelling
`Protocol.member(self: x, …)` canonicalizes through `Apply` and
therefore declines under R4 (`argument-names-unavailable`) — pinned;
lifting it rides the same follow-up as inline-literal callees (§6).

## 6. Callees without a usable declaration

- **No definition / forward reference** (box.ts:1324 auto-declare
  branch): named arguments present → the carriers are left unconsumed
  and their own canonical handler produces
  `argument-names-unavailable` (§2). This matches the shipped static
  posture — calls ahead of a definition are not validated — and the
  spec's rule that an unresolved forward reference has no names to
  check.
- **Wildcard `function`-typed values**: same route, same error.
- **Inferred-signature callees — CORRECTED during implementation.** The
  draft claimed inferred signatures carry parameter names; they do NOT:
  the inference path (`effects-inference.ts` ~503) types a bare
  parameter as `{ type: 'unknown' }`, dropping its name. So an
  UNANNOTATED literal (`(a, b) |-> a + b`) is not addressable by name —
  a named call reports `argument-name-unknown` ("this function declares
  no parameter names"). Only annotated literals and explicit
  declarations are name-addressable in v1. The one-line fix (carry
  `p.name` through) would rewrite the printed signature of every
  unannotated literal in the codebase — broad snapshot churn, deferred
  to a measured, deliberate change (open item, §9).
- **Non-symbol callees via `Apply`** — `(g)(x: 1)`, an inline literal
  applied directly (sub-ruling R4, §9): v1 DECLINES with
  `argument-names-unavailable`, even though an inline literal's
  parameter names are syntactically visible. Supporting it means
  teaching `Apply`'s canonical handler (library/core.ts:1833) and the
  function-literal application path (function-utils.ts:2186/2316) the
  §3 algorithm — mechanical, but it multiplies the surface of v1 for a
  rare spelling. Recorded as the natural follow-up.

## 7. Diagnostics, serializer, static pass

- New codes (src/epsil/diagnostics.ts + engine error table):
  `argument-name-unknown` (with did-you-mean), `argument-order-invalid`,
  `argument-name-duplicate`, `argument-names-unavailable`,
  `argument-optional-skipped` (R1). All five join
  `CANONICALIZATION_ERROR_CODES` in src/epsil/static-diagnostics.ts —
  without that, `epsil check` and the VS Code extension silently drop
  them (the pass boxes each statement and harvests Error nodes, so one
  normalization site covers the static route automatically).
- Serializer: `NamedArgument` row in the Epsil `FUNCTIONS` table
  emitting `name: value` — needed only for non-canonical trees
  (diagnostic rendering); canonical trees never contain the carrier.
  C4's name re-derivation for canonical calls stays deferred; the site
  is `serializeGenericFunction` (serialize-epsil.ts:1424).
- **Error-location anchoring, accepted degradation (v1):**
  `locateError` (src/epsil/error-location.ts:95) maps a canonical
  operand index into the RAW AST by the same index; after reordering,
  canonical index ≠ written index, so an error inside a named
  argument's VALUE may underline the wrong argument. Accepted for v1
  with a documenting test; the fix (carriers recording their source
  index, `enclosingFrame` translating through the permutation) is a
  scoped follow-up.

## 8. Test plan

`test/epsil/named-arguments.test.ts` + a compute-engine suite for the
box route. Both routes throughout (parse and `ce.box` with explicit
carriers). Groups:

1. Basics: all-named, mixed positional+named, order-free equivalence
   (same canonical form), `f(a := 1)` unchanged, `f(a: -1)` works,
   `f(a:-1)` errors (munch pin).
2. C2/C5: positional-after-named, duplicate (both spellings), unknown
   name with did-you-mean, missing required (no curry — result is the
   error, and the positional call still curries), variadic-tail-empty,
   optional omission from the tail, `argument-optional-skipped` hole.
3. C3: the `fib` z/o/n arms called with each name; two same-arity arms
   with swapped names (R3 error when ranking ties, resolution when one
   outranks); an all-positional call through the same overload set
   byte-identical to pre-feature behavior (identity-permutation
   regression).
4. C6: protocol member called with `self` written last dispatches on
   the declared first parameter; qualified `Protocol.member` form too.
5. Unavailable: forward ref, `function`-typed value, `(literal)(x: 1)`
   (R4), box-route stray carrier in non-call position.
6. Static route: `epsil check` surfaces each new code
   (static-diagnostics fixture).
7. Library spot checks: a named call to a partially-named builtin
   (`Sort(xs, order: f)`; positional-only slots unaddressable by name).

Definition of done: suites above green; `npm run typecheck`; native tsc
sweep; `npx madge --circular` unchanged; full-suite snapshot blast
radius measured and reported (expected zero — no canonical-form change
for existing programs).

## 9. Sub-rulings adopted here, for ratification

- **R1 — no optional holes** (`argument-optional-skipped`): named
  arguments cannot skip an earlier unsupplied optional. Forced by
  `flatten` dropping `Nothing` — no placeholder survives — and holes
  silently shifting arguments is the failure class the feature exists
  to prevent. Lifting it later needs a real absent-argument marker.
- **R2 — declaration-order evaluation** for named calls (written order
  is surface only). Appendix C gains the sentence on landing.
- **R3 — ambiguous disagreeing permutations error** instead of
  declaration-order pick (a silent pick would choose an argument
  order, not just an implementation).
- **R4 — `Apply`/inline-literal callees decline in v1**
  (`argument-names-unavailable`); mechanical follow-up recorded in §6.
  Includes the qualified `Protocol.member(...)` spelling (§5).
- **Open residual — arm substitution after name filtering** (found in
  implementation): when the name filter leaves exactly one arm and that
  arm's TYPES then refuse the call, a different arm can still claim it
  positionally downstream — with `ov: ((a: number) -> number) & ((s:
  string) -> string)`, `ov(a: "q")` evaluates the STRING arm (exactly
  as if written `ov("q")`) instead of erroring. No argument changes
  position, so no wrong values — but the name was validated against an
  arm that did not execute. Closing it means re-resolving with boxed
  operands on every named overloaded call; left open for a ruling on
  whether that cost is warranted.
- **Open — unannotated literals are not name-addressable** (§6).
  MEASURED 2026-08-13: applying the one-line `effects-inference.ts` fix
  (carry `p.name` in the bare-parameter fallback) breaks 37 tests
  across 11 suites plus 1 snapshot — including semantic suites
  (`effects-contracts`, `application-validation-regressions`, the
  callback-contract and lambda-inference batteries), not just printed
  signature strings. So this is a follow-up round with its own
  verification, not a snapshot refresh; the measurement log names the
  suites.
