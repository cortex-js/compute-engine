# Spec review — docs/plans/2026-08-22-type-handlers-on-types.md (fifth draft)

Dual review (Claude on Sonnet + Codex at high), 2026-08-22. Focus: ready to
implement? The fourth draft's 18 findings were addressed; this pass judged
the fifth draft on its own terms.

**18 findings — 1 critical, 12 high, 5 medium · 1 flagged by both reviewers · 0 open questions**

1. [CRITICAL] [Claude] [consistency] §5.4 `Pipe` row — **The stated derivation does not match the landed `pipeImplicitMap`** (`core.ts:452-471`) and would misclassify the headline example. The real rule: the stage is a unary `Function` literal, the topic is a non-string collection, and NOT (the raw stage's parameter carries an authored `Typed` annotation the topic itself already matches). There is no "parameter rejects the topic but accepts its element" test; an unannotated `x ↦ x²` has parameter type `unknown`, which accepts everything, so the spec's rule would say *no* implicit map. → Restate the row as the real procedure (arity via `f.nops === 2`; non-string; collection-shaped topic; whole-collection annotation escape), or flag a deliberate behavior change with its own test.

2. [HIGH] [Both] [completeness] §4.3 "17 object kinds" — **`intersection` is missing** (the overload-set representation, `validate.ts:1197`), `indexed_collection` is not named, and type-bearing fields are unhandled: `TypeReference.args` and `FunctionSignature.typeParams[].bound` can carry numeric value nodes through a "returned by identity" leaf. → Enumerate all 19 discriminants; `intersection` descends and re-reduces like `union`; state that `collection`/`indexed_collection` share a case; define `args`/`bound` handling; a compile-time exhaustiveness fixture.

3. [HIGH] [Codex] [consistency] §4.3 "a numeric `value` node → `finite_integer` / `finite_real`" — **`NaN`, `Infinity`, `-Infinity` are numeric value nodes** (`common/type/parser.ts`) and would widen to `finite_real`, unsound. → Four cases: finite integer → `finite_integer`; finite non-integer → `finite_real`; `±∞` → `non_finite_number`; `NaN` → `number`; direct and nested tests.

4. [HIGH] [Codex] [consistency] §4.3 "descended: `signature` … `negation`"; §5.5 "wider-or-equal" — **Widening is not monotone in contravariant positions**: `0` → `finite_integer` inside a signature *parameter* narrows the function type; inside `!0` it narrows the result. → A polarity-aware transform (covariant positions widen; contravariant/negated positions take the safe dual, or are left by identity with a stated reason); assert `isSubtype(old, transformed)` for every transformed result.

5. [HIGH] [Codex] [feasibility] §4.3 "old→new memo … back-edge points at the new node" + "a rebuilt `union` is re-reduced" — **Rebuilding a cycle conflicts with immutable published types and `reduceType` has no cycle guard** (a rebuilt union on a cycle re-enters itself). → Either a two-phase shell/finalize construction plus a cycle-aware `reduceType`, or prohibit rebuilding through cycles (recursive types are `reference` nodes — make that the stated boundary and drop the "before and after the back-edge" test).

6. [HIGH] [Claude] [consistency] §4.4 static admission "in this order", items 1 and 3 — **The concrete-value step pre-empts the collection-kind deferral it claims to keep unchanged**: `concreteValueOf` returns a value for an all-concrete `List`/`Tuple`, and `accepts`'s elementwise membership refutes cases `overlapsForDeferredValidation` admits. → Say whether item 1 is a global first pass (then it supersedes the deferral for concrete collections — a behavior change to pin) or the first clause of item 4 only.

7. [HIGH] [Claude] [consistency] §4.4 item 4 "value-component … `typesOverlap`" — **Redundant with, and different from, `admissionOf`**, which `checkType` already calls for value-component parameters and which falls back to `provablyDisjoint` (not `typesOverlap`) for a symbolic operand. → Keep value-component parameters on `admissionOf` unchanged and drop them from item 4, or state the replacement and the rows where the two predicates disagree.

8. [HIGH] [Codex] [completeness] §4.4 static admission — **The verdict is specified without the mechanics interleaved with it today** in `validate.ts`: inferred-symbol narrowing and the evidence guard, strip-before-validate, character substitution, placeholder-signature reconciliation, fresh-matrix repair, operator-symbol devolution, threadable positions. → Separate admission verdict from operand normalization/repair/post-admission inference; give the ordered pipeline; say which mechanics are retained; add successful-call pins, not only refusal pins.

9. [HIGH] [Claude] [feasibility] §4.4 runtime "arm selection: re-runs `resolveOverload` (the trial path)" — **The trial path is boxing-time inference-rollback machinery** (`validate.ts:1238-1274`: `_withBoxingPassWindow` + `_withRolledBackInference`), with one call site and a nesting assertion; neither legal nor cheap after `.evaluate()`, and its cost is not in the promised measurement. → A lightweight runtime selection over each arm's instantiated parameters using `accepts`/`MatchesType` directly — no rollback frame — with the cost included in the benchmark.

10. [HIGH] [Codex] [completeness] §4.4 "lazy operators are exempt … nine hand-written guards" — **The lazy surface is far larger than nine guards** (`ND`, `InterpolatingFunction`, … have typed parameters and produce no `incompatible-type` today). Exempting all lazy dispatch makes R1 unsound system-wide. → Inventory every lazy definition with a declared signature; classify each position as checked-by-handler (named site), intentionally held/inert, or needing `conformsAtRuntime`; a contract and route test per newly deferred static check.

11. [HIGH] [Codex] [edge-case] §4.4 runtime "verdict per operand" — **Arity, `Spread`, missing/excess arguments and the non-strict fast path that pads fixed-arity handlers are unspecified**; with the check unconditional under `strict: false`, these paths can crash or change error values. → Runtime arity normalization and error production before per-position conformance: overload arity gaps, required/optional/variadic, excess operands, zero arguments, post-`Spread` revalidation; strict on/off pins.

12. [HIGH] [Claude] [consistency] §4.4 "apply() unconditional"; O8 — **A semantic change to the documented `strict` contract** (`index.ts:1220-1229`: non-strict means "results may be incorrect … if the input is not valid"), framed as a cost knob. → State it as a behavior change (strict:false no longer escapes runtime argument checking, only static diagnostics) with a migration note, or gate the runtime check on `strict` too and state the accepted risk for non-strict engines under R1.

13. [HIGH] [Codex] [architecture-fit] §5.1 absent-fact rule "`collection: true` without a shape → arm 1 with open rank" — **Non-indexed collections (sets, dictionaries, records, generic `collection`) would enter the broadcast lift**, which today lifts only eligible indexed collections. → Participation from `indexed`, `finiteCollection`, declared threadable slots and the existing shape distinctions; explicit rules for sets, records, dictionaries, ranges, open-rank lists, `collection`/`indexed_collection` tops; no-lift tests for each.

14. [HIGH] [Codex] [consistency] §5.5 "(a) must be an empty diff" — **Impossible for the conversions the spec itself accepts** (literal reads other than `0`/`1`, compound sign, `.N()`): those differences appear on `describe(op)`, matrix (a). → Matrix (a) allows explicitly approved wider-or-equal rows for handlers whose conversion contract accepts loss; empty diff only where the contract says no change.

15. [MEDIUM] [Claude] [feasibility] §5.1 `structureOf()` for `Hold`/`ReleaseHold`/`Typed`/`Subscript` — **All four are `lazy: true` with no `canonical` handler** (CLAUDE.md: held operands arrive unbound on the box/parse routes). The spec does not say whether the descriptor reads the raw or the bound form; binding would reintroduce canonicalization. → State per handler; if binding is needed, account for it as §4.1 does for `Pipe` (drift count, registration) rather than "on demand, pure".

16. [MEDIUM] [Codex] [feasibility] §5.5 "the suite's own boxed expressions … collected by a reporter" — **Jest reporters see results, not live expressions, across six isolated workers.** → A concrete transport: instrument boxing to emit stable MathJSON + declaration metadata per worker, merge deterministically into a generated corpus, replay in the parity test; or online parity assertions at the call site under a flag.

17. [MEDIUM] [Codex] [ambiguity] §5.3 conversion table `isReal`/`isInteger`/`isRational` — the expression returns only `true | undefined` while the semantics column promises `false` on disjointness. → One shared helper: `true` proven subtype, `false` proven disjoint (`provablyDisjoint`), else `undefined`; pin each state.

18. [MEDIUM] [Codex] [testability] §5.5 guard snapshot — **`_writeVersion` advances are not directly observed** by the general guard (only by the §4.2 test), so a write path that forgot its state event would pass. → Count every `_writeVersion` increment in the guard, or snapshot reachable definitions' write versions; a negative test that a write-version-only mutation trips the guard.

## Suggested revisions

- **Theme A — the widener (§4.3):** 2, 3, 4, 5.
- **Theme B — static admission (§4.4):** 6, 7, 8, 12.
- **Theme C — the runtime mode (§4.4):** 9, 10, 11.
- **Theme D — the primitive (§5.1):** 13, 15, 17.
- **Theme E — measurement (§5.5):** 14, 16, 18.
- **Standalone (fix immediately — factual):** 1.
