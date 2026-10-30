# Appendix to the evaluation-cache audit: the search results

This is the result of the search of section 2.1 of
`docs/plans/2026-10-30-evaluation-cache-architecture.md`: every cache found in
`src/compute-engine/` and `src/common/`, with what it stores and what makes
it out of date. The line numbers are at HEAD
`9b86a09321c2430f2bfd7ef185041d0502803561`; search for the symbol name at a
later HEAD. A search agent made the list, and each cache of an evaluated value
(section 2a) was read again by hand for the audit.

Classes:

- **Section 1**: the caches of the census (`docs/plans/2026-10-28-ce-601-cache-census.md`).
- **Section 2a**: caches whose value can depend on an evaluation. These must
  follow the host-code rule and the fail-closed rules.
- **Sections 2b, 2c, 2d**: caches of types, effects, kinds, numeric tables,
  rule indexes, generated code and structure. They run no evaluation, so the
  host-code rule does not apply to them. Their validity rule is the one in the
  last column.

## 1. The caches in the census

| Census entry | Exists | Location in the current tree |
|---|---|---|
| Memo of shared subexpressions | yes | `boxed-expression/shared-evaluation-memo.ts:174` `memos`; per-node mark `boxed-function.ts:1341` `_sharedEvaluationMark` |
| Application memo of function literals | yes | `function-utils.ts:7220` `validApplicationMemo`, stored in `ce._applicationMemo` (`index.ts:1436`, created at `function-utils.ts:7248`) |
| Lazy collection and inert value memo | yes | `boxed-function.ts:4435` and `:4942`. The value is stored in `_value` (`:1264`), with stamps `_lazyValueEpoch` (`:1352`), `_lazyValueFactsHidden` (`:1363`), `_lazyValueScope` (`:1374`) and `_lazyValuePending*` (`:1397-1400`) |
| Collection element memo | yes | `boxed-expression/collection-element-memo.ts:205` `elementMemoCaches` |
| Facet memo | yes | `boxed-function.ts:5349` `_memoizedFacet`, field `_facetMemo` `:1410` |
| `at()` materialize, `_eagerSource` | yes | `boxed-function.ts:5974` `_materializedAt`, `:1277` `_eagerSource` |
| `SLICE_BOUNDS_MEMO` | yes | `library/collections.ts:25507` |
| Stored value of a symbol | yes | `boxed-symbol.ts:2141` `_memoizedStoredValue`; storage `:209` `STORED_VALUE_MEMOS` |
| Sequence `memo`, `numericMemo`, `declined` | yes | `sequence.ts:73`, `:85`, `:94`; `memoStampIsValid` `:1200`; registry `:125` |
| `zeroMemo`, `partsMemo` | yes | `symbolic/contour.ts:257`, `:327` (entry counts `:336`) |
| `approximations` | yes | `boxed-expression/compare.ts:2694` |
| `probeCache` | yes | `symbolic/limit.ts:2114` |
| `mapCompileCaches` | yes | `library/map-auto-compile.ts:175` |
| `keptByEngine`, `hostKeptByEngine`, shared store | yes | `boxed-expression/eager-source-values.ts:267`, `:348`, `:125-129` (`collecting`, `shared`) |
| `_sgn`, `_type` | yes | `boxed-function.ts:1281`, `:1285` (fast-path stamps `_typeGeneration` `:1445`, `_typeEpoch` `:1449`) |
| `FACTOR_MEMO` | yes | `boxed-expression/factor.ts:1358` |
| `FOLDED_INTERVAL_CODE` | yes | `compilation/interval-javascript-target.ts:4604` |
| Constant from a function `value` | yes | `boxed-value-definition.ts:512`, `:689` (`dynamicValue`) |
| `_foldValueMemo` and siblings | yes | `compilation/base-compiler.ts:9118`, `9132`, `9140`, `9154`, `9160`, `9172`, `6585` `_constantPoleMemo`, `6593` `_knownExponentMemo`; reset at `:4504-4515` |
| `DECLINED_DERIVATIVES` | yes | `library/calculus.ts:4172` |
| Apply-site memo | yes | `boxed-expression/apply-site.ts:54` `MEMO` |
| `LITERAL_SET_INDEX` | yes | `library/collections.ts:23139` |
| Exact-proof memos | yes | `library/map-exact-proof.ts:960`, `:964` |
| `spineMemo` | yes | `library/map-lowering.ts:104` |
| Interval type caches | yes | `numerics/interval-arithmetic.ts:179`, `:180` |
| `foldRefinementStates`, `exactDivergenceChecks`, `guardedPrecision` | yes | `collections.ts:2530`, `calculus.ts:1376`, `library/exact-operands-under-n.ts:35` |
| Kernel pool | yes | `kernel-pool.ts:282` `kernelIds`, `:1097` `calibration` |

## 2a. New caches whose value can depend on an evaluation

| file:line, symbol | Stores | Key | Lifetime | Invalidated by | Can it evaluate? |
|---|---|---|---|---|---|
| `boxed-expression/boxed-dictionary.ts:738` `dictionaryEvaluationMemo` | The evaluated value of a pure dictionary node | Node, then options (by identity) and `_anyVersion` | One outermost dictionary evaluation (a module `let`) | `_anyVersion`; not stored when `_anyVersion` moved | **Yes.** It runs `v.evaluate()` on each value (`:633`) and does not read `uncachedHostCallCount()`. It is gated only on `this.isPure`. |
| `library/enclosure-arithmetic.ts:109` `SETTINGS_PAYLOADS` (via `settingsPayload` `:126`) | Endpoint class, outward doubles and enclosure range | Expression, then decode function | Per node, process-wide (weak) | Angular unit and precision only | **Yes.** It calls `.N()` (`:167`, `:335`). It is gated on `isExactConstantExpression` (pure, constant symbols), but nothing sees an operator redefinition. This is the same gap as `approximations`. |
| `boxed-function.ts:14308` `UNRESOLVED_CALL_RESULTS` | The rebuilt result of evaluating an unresolved call | Original call node, plus the identity of the evaluated operands | One top-level evaluation (`epoch`) | Top-level evaluation epoch | Yes: the operands were evaluated. It is an identity-reuse cache, not a skip of the evaluation. |
| `boxed-function.ts:14296` `EVALUATED_UNRESOLVED_CALLS` | Marks a result node as "sticky" | Result node | One top-level evaluation | Epoch | It is a flag on an evaluation result, not a value. |
| `boxed-function.ts:784` `errorEvaluatedFrom` | The operand node that produced an error value | Error expression | As long as the error object lives | `stamp` against `errorRecordCount` (`:790`) | It records evaluation provenance; no value is reused. |
| `rubi/driver.ts:341` `RubiDriver.memo` | An antiderivative, or `null` as a cycle guard | `variable + '§' + integrand.toString()` | One top-level integration call (cleared `:503`) | Cleared on each non-reentrant entry | **Yes**: rule application simplifies and evaluates. No host-count check. |
| `rubi/rubi-utils.ts:449` `activeCaches` (`zeroQ`, `simplify` maps) | Zero tests and simplify results | String | One top-level integration call (installed `driver.ts:508`) | Replaced per call | **Yes** (simplify, zero tests). No host-count check. |
| `symbolic/derivative.ts:794` `derivativeChains` | The n-th derivative chain of a function literal | Function literal | Per literal | `_semanticVersion` plus a deps snapshot (`restampDisposed`, around `:965`) | Possibly: differentiation simplifies and reads state (`activeStateReads` `:877`). |
| `symbolic/derivative.ts:979` `partialDerivativeChains` | Partial derivatives | Engine, then literal or definition | Per engine | Same as above | Same as above |
| `compilation/base-compiler.ts:6593` `_knownExponentMemo` | Evaluated exponent values | Node | One outermost compile | Reset at `:4511` | Yes. The census covers it only as one of the "siblings". |
| `boxed-expression/constraint-subject.ts:825` `factIndexCache` | Index of the assumption facts | Assumption store | Per store | `_anyVersion` (`:1393`) | No: it is built under `_withoutFacts` and holds only facts. |

## 2b. New caches that hold types, effects, kinds or proofs

None of these evaluates anything.

| file:line, symbol | Stores, key | Lifetime | Invalidated by |
|---|---|---|---|
| `boxed-function.ts:1317` `_effects` | Effect set of the node | Per node | `_callableVersion` plus `_effectsScope` (`:1331`) |
| `boxed-dictionary.ts:104` `_type` | Type of the record | Per node | `cachedValue` generation |
| `boxed-number.ts:305` `_literalTypeMemo`, `:311` `_publicTypeMemo` | Literal type, boxed type | Per node | Nothing |
| `boxed-expression/call-result-type.ts:56` `cache` | Result type of a literal call, by literal and argument types | Per engine | `_cacheGeneration()` (`:1403`) |
| `boxed-expression/declared-parameter-result.ts:1072` `fixpointMemo` | Recursion fixpoint type | Per literal | Key of the engine state (`:786`); not stored during a pass or a rollback frame |
| `boxed-expression/residue-class.ts:437` `KIND_CALL_FACTS`, `:732` `CALLEE_FACTS`, `:736` `CALLEE_FACTS_CERTAIN` | Has a kind call / kind callee | Per node | `kindGeneration` |
| `residue-class.ts:475` `CLASS_SYMBOLS`; `:614`, `:615` `SIGNATURE_RETURNS_KIND*` | Symbols; verdicts per signature | Per node / per signature | Nothing |
| `boxed-expression/nothing-erasure.ts:152` `erasureMemo` | May erase an element | Per node | `_semanticVersion` |
| `engine-declarations.ts:345` `operatorPoolCache` | Operator names in scope | Per engine | `_anyVersion` |
| `engine-protocols.ts:612` `MUTABILITY_GATE_MEMO`, `:2859` `groundedLiteralMemo`, `:3856` `REQUIREMENT_CACHE`, `:5548` `requirementTypeMemo` | Protocol verdicts and parses | Members object / per instance | Members identity; `_anyVersion` plus members; conformance and callable versions |
| `boxed-expression/effects-of.ts:164` `dictionaryEffectsMemo`, `:808` `accessorEffectsMemo` | Effects | Per dictionary / per engine | Callable version plus scope; conformance and callable versions |
| `boxed-expression/effects-inference.ts:1418` `NAMED_LITERAL_SIGNATURES`, `:2245` `LITERAL_WRITES` | Inferred signature; written names | Per literal | Recorded evidence / nothing |
| `boxed-expression/function-literal.ts:64` `RESOLVED_TYPE_OPERANDS`, `:731` `CAPTURED_SYMBOLS`, `:813` `DEFINITION_CAPTURED_TYPES` | Types; captured symbols | Per node / per definition | Checkpoint journal; nothing |
| `library/core.ts:2683` `ASCRIBED_TYPES` | Parsed type operand | Per node | Nothing |
| `boxed-expression/boxed-symbol.ts:237` `SCALAR_USES_MAP` | Inference flag | Per value | Nothing |
| `boxed-function.ts:15615` `BROADCAST_SLOT_PLANS`, `:15692` `POINT_SLOT_PLANS`, `:15780` `DECLARED_POINT_SLOT_PLANS`, `:19168` `INTEGER_PARAMETER_POSITIONS`, `:10896` `CALLBACK_SLOTS`, `:14024` `declaredConformanceSignatures`; `call-result-type.ts:466` `HAS_POINT_PARAMETER` | Plans and positions per signature | Per signature or definition | Nothing; `CALLBACK_SLOTS` uses `_writeVersion` |
| `boxed-expression/validate.ts:2378` `runtimeConformancePlans` | Conformance plan | Per signature | Nothing |
| `boxed-expression/value-kinds.ts:537` `KIND_TYPE_NAMES`, `:564` `HEAD_NAME_INDEX`, `:684` `KIND_FLAGS`; `boxed-expression/kind-admission.ts:177` `HOOK_VIEWS`, `:210` `CARRIER_VIEWS` | Kind registry indexes | Per registry or engine | Registry generation |
| `boxed-expression/signature-result-type.ts:30` `HAS_PARAMETER_CELL` | Structural verdict | Per body | Nothing |
| `function-utils.ts:3855` `MAY_READ_CALLER_BINDINGS`, `:3892` `DECLARED_LOCAL_NAMES`, `:3968` `LITERAL_SHAPES`, `:4812` `NESTED_BODY_SCOPES` | Structural analyses of literals | Per node | Nothing |
| `collection-utils.ts:5037` `TYPE_SATURATED_SETS` | Set descriptors | Process | Nothing |

## 2c. New caches of numeric or library data

These are process-wide or per engine and hold no engine state.

| file:line, symbol | Stores, key | Invalidated by |
|---|---|---|
| `numerics/special-functions.ts:1598` `bernoulliCache` | Bernoulli rationals, per engine | Rebuilt when too short |
| `special-functions.ts:102` `zetaMinusOneTable`; `:2992-2998` `hurwitzEmCoeffCache` and its digits/factorial; `:4439` `ZETA_BORWEIN_CACHE` | Constant tables | Digits count (Hurwitz); nothing otherwise |
| `numeric-value/roundoff.ts:19` `noiseRatio` | 1e(2−p) | `BigDecimal.precision` |
| `numeric-value/big-numeric-value.ts:47` `DISPLAY_DIGITS` | Display digits per value | Nothing |
| `polynomial/boxed-number-field.ts:92` `certifiedFields` | Proven-irreducible fields, by polynomial text | Bounded; oldest entry removed |
| `numerics/dirichlet-character.ts:75` `componentCache`, `numerics/ball.ts:213` `units`, `numerics/stieltjes.ts:173` `DD_COEFFICIENTS` | Math tables | Nothing |
| `index.ts:511` `_cacheStore` (`engine-cache.ts`): `standard-simplification-rules` `index.ts:4772`, `univariate-roots-rules` `:4797`, `harmonization-rules` `:4810`, trig tables `boxed-expression/trigonometry.ts:1651`, `:1879` | Rule sets and constant tables, by name, per engine | `purgeCaches` on a configuration change (`index.ts:1796`) and `invalidate` |
| `engine-simplification-rules.ts:18` `_cachedLength` | Detects a changed rule list | Length only (same-length edits are missed, which the file documents) |
| `function-properties/index.ts:36` `_cache`, `:105` `STORE` | Boxed property records | Nothing (static data) |
| `rubi/loader.ts:66` `compiledCache`, `rubi/driver.ts:403` `candidateCache` | Compiled Rubi rules | Nothing |
| `library/regexp.ts:51` `HOST_PATTERN_CACHE` | `RegExp` by pattern text | Nothing |
| `boxed-expression/simplify.ts:397` `patternRulesCache`, `boxed-expression/rule-index.ts:110` `indexCache`, `boxed-expression/match-dispatch.ts:212` `planCache`, `boxed-expression/rules.ts:662` `RULE_SYNTAXES`, `:1035`, `:1068`; `boxed-expression/solve.ts:1098` `SOLVE_RULE_PARTS`, `:1155` `WITHOUT_TEMPLATES` | Rule indexes and match plans | Rule-array identity (`indexCache` also checks `count`) |
| `compilation/javascript-runtime.ts:2172` `BCAST_KERNELS`, `compilation/broadcast.ts:635` `cellLoops`, `interval-javascript-target.ts:1565` `GUARDED_INTERVAL_FUNCTIONS`, `compilation/gpu-target.ts:18783` `GPU_LIBRARY_DEFINITIONS` | Generated kernels and wrappers | Nothing (code text or shape key) |
| `library/utils.ts:3040` `cachedJ`/`cachedSum` (also `:3225`) | Partial sums | One call (closure) |

## 2d. Structural caches

These are per node and never invalidated unless a stamp is named.

- **BoxedFunction:**
  - `_hash` `:882`, `_digest` `:883`, `_isStructural` `:880`, `_isValid` `:1261`.
  - `_derivedArray*` `:839-850`, `_literalData` `:855`, `_refusedCallInOperands` `:1178`, `_literalListTree` `:1452`.
  - `_structural` `:2267`, stamped with a generation.
  - `_resolvedOverload` `:898` and `_refusedOps` `:909`: set at construction, deliberately with no generation.
  - Transient maps for one top-level read: `_transientStructural` `:634` and `_transientCanonical` `:657`.
  - **`_valueN` `:1268` is declared and never read or written: a dead field.**
- **BoxedSymbol:** `_hash` and `_digest` `:300-301` (`??=` at `:352` and `:359`), `_canonicalOfStructural` `:326`.
- **BoxedNumber:** `_hash` and `_digest` `:284-285` (`:361`, `:373`).
- **BoxedString:** `_utf8Buffer`, `_unicodeScalarValues`, `_graphemes` (`:27-38`).
- **BoxedDictionary:** `_digest` and `_isValid` `:94-95`.
- **Definitions:**
  - `boxed-operator-definition.ts`: `_effects` `:423` (kept in step with the signature), `_signatureSkeleton` `:853`, `_validationSignature` `:677`, `_recursionResult` `:884`.
  - `boxed-value-definition.ts`: `_type` `:229` (inferred from the value at `:529`), `_placeholderSkeleton` `:257`, `_signatureSkeleton` `:271`, `_recursionResult` `:338`.
- **Engine:** `__typeResolver` `index.ts:1068` (`??=` `:1075`), `_commonSymbols` `:564`, `_commonNumbers` `:585`, `_latexSyntax` `:3988`.
- **Module maps:**
  - `collection-utils.ts:4269` `lazyMapNRewraps`, `:4278` `ELEMENTS_BY_HASH`.
  - `machine-broadcast.ts:705`, `order.ts:788` `LEAF_COUNT`, `polynomial-degree.ts:148`, `:202`.
  - `symbolic/derivative.ts:111` `nodeCountCache`, `object-walk.ts:113`, `binding-sites.ts:576`, `binders.ts:1084`, `fungrim/loader.ts:609`.
  - `boxed-expression/utils.ts:250` `VOLATILE_DIGEST`, `decoded-payload.ts:27` `PAYLOADS`.
  - `compilation/unroll-budget.ts:65`, `javascript-target.ts:16119`, `interval-javascript-target.ts:4251`, `compilation/cse.ts:2965` `NODE_IDS`.
  - For one canonical call: `invisible-operator.ts:100` `canonicalCache` and `:101` `readingCache`.
- **LaTeX:**
  - `abstract-boxed-expression.ts:184` `latexStrings`: the serialization cache. Stamped with the `any` version, scope, syntax instance, dictionary and options. It skips expressions that contain objects.
  - `latex-syntax/tokenizer.ts:95` `STICKY_REGEX_CACHE`.
  - `latex-syntax/latex-syntax.ts:253` `_indexed`, `:421` `_defaultSyntax`.
  - `latex-syntax/serializer.ts:729`, `:741`; `parse-symbol.ts:13`; `dictionary/definitions.ts:403`; `lenient-ambiguity.ts:61`; `latex-syntax/utils.ts:56`.
  - Per parser: `parse.ts:1014` `_lookAheadCache`, `:1374` `_tokenDepths`, `:2185` `_closeBraceOf`.
  - `definitions-core.ts:1294`, `:1312`, `:6816`.
- **Types (`common/type/`):**
  - `parse.ts:38` `TYPE_CACHE` (bounded to 2048), `:72` `RESOLVED_TYPE_CACHE` (checks the resolved names' dependencies), `:78` `RESOLVED_NAMES`.
  - `intern.ts:40-43`, `facts.ts:305-307`, `immutable.ts:8`, `:38`.
  - `subtype.ts:320` `MEET_CACHE`, `:4950` `PRIMITIVE_SUPERTYPE_CACHE`, `:475`; for one question: `:390`, `:528`, `:849`, `:1510`.
  - `reduce.ts:399` `meetMemo`, `:519`, `:1611` `overlapMemo` (one question), `:820`.
  - `boxed-type.ts:31` `unscopedBoxes`, `:38` `scopedBoxes`, `:73`; `utils.ts:971`.

The search left out maps that hold live state rather than a derived value: scope and frame bookkeeping, in-flight and re-entrancy sets, registries, counters, and checkpoint marks. Examples are `scope-chaining.ts:41`, `function-utils.ts:2946-5416`, `control-structures.ts:3619-4884`, `evaluation-epoch.ts`, `provisional-application.ts`, `forward-call-reference.ts`, the `compare.ts` WeakSets, and the compiler naming and fact maps.

