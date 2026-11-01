# Compiler commits since 2026-10-17, tagged

The appendix of `docs/plans/2026-11-01-compiler-simplification.md`. It lists the 201 commits that changed `src/compute-engine/compilation` from 2026-10-17 to `1a0d0d427`, in date order, in nine batches. Nine read-only agents wrote the batches from `git show` of each commit. Line and test counts are their estimates, not measurements. A commit with fixes of different kinds has one row per part.

Tags: `value` handles a wrong finite value or shape for a plain program (keep); `decline` adds a decline (keep); `other` is a feature, a performance change, a refactor or a move (keep); `candidate` handles only a case that the caveats of compiled code now allow.

## Moves

| hash | date | subject | tag |
|---|---|---|---|
| 97bb4cc71 | 2026-10-30 | Split gpu-target.ts into 19 topic modules | other (move) |
| 5404acb3f | 2026-10-30 | Split base-compiler.ts into 44 topic modules | other (move) |

Batch 1: 26 commits, 2026-10-17 to 2026-10-20. Commit messages are one-line summaries; tags come from the diffs of `src/compute-engine/compilation`.

| hash | date | subject | tag | what it handles | for candidates: HEAD location · removal leaves · src lines · tests · witness |
|---|---|---|---|---|---|
| b426d66ba | 10-17 | Linspace integer grid past 2^53 (JS) | value | integer grids sample `start + k*step` as the interpreter does | |
| 68aec0f22 | 10-17 | `pow3h`/`pow5h` helpers, CSE for powers, opaque `vars` sources | other | performance and CSE soundness for string `vars` | |
| 7d1fa629e | 10-17 | CSE harvests the value `If` that ends a block | other | sharing of a call between condition and branch | |
| d0f64aa92 | 10-18 | Closed exact jump nodes fold under `constantFold:false` | value | `Floor((25!-1)/24!)` gave 25 instead of 24 | |
| 2fd45d32e | 10-18 | Reduce large constant terms in trig arguments (shaders) | other | f32 accuracy of `sin(c + x)` | |
| 114db120a (part) | 10-18 | `jumpShiftRewrite` for rounding of `k + c` | value | `Floor(k + c)` with integer `k` and exact `c` gave a wrong integer | |
| 114db120a (part) | 10-18 | Linear-time CSE and fact walks on shared subtrees | other | exponential walk on DAGs | |
| b5fe0371e | 10-18 | GLSL/WGSL exact sine hash, float32 warnings | other | new target capability (`gpu-exact-trig.ts`), Tycho rows 382/384 | |
| 63bfbabb9 (part) | 10-18 | Tail-assignment block, Python identifiers, WGSL parameter write | decline | declines forms that emit invalid source or no value | |
| 63bfbabb9 (part) | 10-18 | Interval-js spelling of absent value (`INTERVAL_EMPTY`) | other | one spelling of "no value" for hosts; part of the documented interval result shape | |
| 63bfbabb9 (part) | 10-18 | Decline a user call whose argument count mismatches the literal | candidate | interpreter gives a partial application or `unexpected-argument` error; compiled gave `NaN` or ignored extras | `checkUserCallArity`, `compile-user-functions.ts:1227` · removal leaves `NaN` or an ignored extra argument (error case, allowed) · ~50 · `compile-user-call-arity.test.ts` (7 tests) · test-named only, crafted |
| 930b9cedc (part) | 10-18 | Chained assignment split, inner target declared, assignment value shapes | value | `t = u = s` wrote the caller's `vars`/an undeclared name; wrong value after the block | |
| 930b9cedc (part) | 10-18 | Python selection with statement arms; shader write to uniform | decline | invalid source or a body that ran to `None` | |
| 930b9cedc (part) | 10-18 | Decline a block that reads its local before any write | candidate | interpreter leaves `Block(x≔x+1; 2x)` symbolic (or `read-before-declaration` in a function body); compiled read `undefined`/0/uninitialized | `classifyLocalReads` + `localReadWithNoWrite`, `compile-locals.ts:894-1435` (see group "Read of a block local before its write") · removal leaves `NaN`, 0 or an uninitialized read (unevaluated/error case, allowed) · ~700 with the 1efbbe884 part · `function-body-local-assignment.test.ts` (115 tests, ~34 on reads), `ce-636-block-local-without-value.test.ts` (28), `block-locals-per-run.test.ts` · crafted |
| 930b9cedc (part) | 10-18 | Decline a block whose last statement is `Declare` with no value | candidate | block value is `Nothing`, the erasure marker | `compile-blocks.ts:256-275` · removal leaves a dropped statement or invalid `return let t` source on Python/shaders; JS gives `undefined` (allowed, `Nothing` case) · ~20 · inside `block-assign-run-time.test.ts` · crafted. Check that Python/shader removal gives code that parses before deleting |
| 930b9cedc (part) | 10-18 | Interval result shape (`kinded` result, `empty`), partial `Which`, fixed-width unroll of `Which`/`When` without default | other | documented interval `run` contract; unroll extension | |
| 110c3b060 | 10-18 | chore lint | other | formatting | |
| dd2813809 (part) | 10-18 | Half-turn lowering of `sin/cos/tan(πu)`, `sinh..coth(iπu)`, chained-assignment locals in loops, `Csch` | value | `csch(iπx)` at `x=1` gave a large finite value, interpreter gives the pole; `u` written to `vars` | |
| dd2813809 (part) | 10-18 | Absence value by cell type for unmatched `Which`/`When` cell (`selectAbsent`, `absenceKind`) | candidate | interpreter gives `Missing` for an unmatched position; JS spells it `undefined` for point/string cells, `NaN` for numbers | `absenceKind` `compile-absence.ts:1156`, `selectAbsent` in `javascript-runtime.ts`, `compile-conditionals.ts` · removal leaves `NaN` for every cell (Missing case, allowed) · ~80 · `compile-missing-point-list-cell.test.ts` (5) + some in `pointlist-compile-zip.test.ts` · crafted (no Tycho row named) |
| dd2813809 (part) | 10-18 | GPU `At` over a list of points (NaN-vector for absent point) | other | new shader capability (~270 lines in `gpu-target.ts`) | |
| 3bdee13b3 | 10-18 | Interval narrowing per arm in `Which` | other | tighter enclosures | |
| f395dd074 (part) | 10-18 | Input writes use a local copy of the vars object (JS, interval-js, Python) | other | `u ≔ u + 1` on an input must not change the caller's object; Python `UnboundLocalError`. Borderline: effect fidelity, not a value | |
| f395dd074 (part) | 10-18 | Exact π lowering for undeclared `x` | value | `e^{iπx}` exactness | |
| 0c398a278 (part) | 10-18 | Shader and Python local copies of written inputs (~470 lines) | other | same mechanism as f395dd074; shaders cannot write a uniform | |
| 0c398a278 (part) | 10-18 | Python NFKC identifier collisions (`fi` vs `ﬁ`) | value | two symbols became one Python variable | |
| 0c398a278 (part) | 10-18 | WGSL decline of a selection operand that assigns | decline | invalid `select(t = 2.0, …)` | |
| f43af0ee1 (part) | 10-18 | Parenthesize assignment operand; decline on Python/WGSL | value | `(t≔1)+2` assigned 3 | |
| f43af0ee1 (part) | 10-18 | Shader statement form of selection with assignments; Tabulate with dimension ≤ 0 not folded | other | WGSL `if` statement; the handler declines | |
| 6ed142f0a | 10-19 | `factorial2` of a negative even integer gives `Infinity` | other | 8 lines; pole spelling of `~oo` projection | |
| 232ab3776 | 10-19 | chore lint | other | formatting | |
| 5922e2129 | 10-19 | Interval narrowing accepts decimal bounds | other | more narrowing (`literalHasNoDoubleValue` exported) | |
| 7e1cfd1a9 | 10-19 | Tuple-or-absent counts as tuple shape (`isTupleOrTupleUnionShapedType`) | other | 2 changed lines in compilation (`compile-operators.ts:977`, `javascript-target.ts:2603`); touches the run-time `Array.isArray` admission that CE-712 steps 3 to 5 remove | |
| 75196dd8f (part) | 10-19 | Hoisted `Declare` without value removed; per-call function locals | value | `g(1)` resolved to `Unknown operator`; wrote outer variable | |
| 75196dd8f (part) | 10-19 | Refuse a function definition the interpreter refuses for its effects | candidate | interpreter returns an error (`scope` effect not declared); compiled `[g(1), t]` gave `[2, 2]` | `refuseEffectContractViolations` + `bindingStatesEffects`, `compile-locals.ts:246-410`, called at `compile-blocks.ts:234` · removal leaves compiled code that runs the definition (interpreter error case, allowed) · ~140 · `compiled-function-redefinition-effects.test.ts` (6), `effects-seam.test.ts`, `effects-contracts.test.ts` · test-named only, crafted |
| 75196dd8f (part) | 10-19 | Read-before-declaration decline in function bodies | candidate | same mechanism as 930b9cedc part | see group "Read of a block local before its write" |
| e8934c2c3 (part) | 10-19 | Effects of an earlier `Declare` applied to later definitions | candidate | interpreter refuses `function g(k){Random()}` under a `pure` declaration | same group as 75196dd8f effects refusal (`compile-locals.ts`) |
| e8934c2c3 (part) | 10-19 | `At` index entry NaN/infinite/absent gives NaN slot (JS runtime) | candidate | NaN/∞/`Missing` index entries name no position | `javascript-runtime.ts:6028-6034` · removal leaves whole-result `NaN` (input outside type / absent, allowed) · ~12 · `at-non-integer-index.test.ts`, `at-collection-index-compile.test.ts` (49 tests, few on this) · crafted |
| e8934c2c3 (part) | 10-19 | GLSL/WGSL `i·z` with complex `z`; real root of negative base for float exponent/degree | value | `i·tanh(z)` computed `i·Re(z)`; `x^(1/2.2)` at `x=-1` gave `NaN` | |
| e8934c2c3 (part) | 10-19 | Seeded `WithRandomSeed` draw computed once per artifact | other | performance (Tycho row 399) | |
| 85e4ca049 | 10-20 | `Zip` row of all-absent items is `Missing` (JS `undefined`, Python decline) | candidate | interpreter gives `Missing` for a row of absent cells | removed at HEAD (`Zip` in `javascript-target.ts:7091` and `python-target.ts:7504` has no `rowMayBeAbsent`) · removal leaves nothing to do · 0 · `collection-absent-followups.test.ts` · crafted |
| 1efbbe884 (part) | 10-20 | Checked reads of block locals (marker object, throws `read-before-declaration`) | candidate | interpreter gives an error for a read before the first assignment; compiled must not answer | `checkedLocalReads`, `checkedLocalRead`, `hideCheckedLocals`, `compile-locals.ts:1437-1530`, `compiler-core.ts:4585,4930,6594`; Python `_ce_unset` · removal leaves a read of an unset local: `NaN`/`undefined` (error case, allowed) · ~700 with classification (group below) · same tests as above · crafted |
| 1efbbe884 (part) | 10-20 | Run-time test of a declared parameter type at calls of block-local functions | candidate | interpreter gives `incompatible-type` for `g(1.5)` with `g:(integer)->integer`; compiled call gave a value. JS shim returns `NaN`; interval `_IA.checkedCall`; other targets refuse | `declaredParameterCheck`, `uncheckedParameterError`, `intervalParameterDomain`, `localParameterChecks`, `intervalCheckingCallee`, `localCheckingCallee`, `argumentProvesParameterType`, `compile-user-functions.ts:1828-2210`; `staticTypeIsEvidence` and `assignmentsProveType` no longer named at HEAD (renamed or folded; check before deleting) · removal leaves a value, or `NaN` (input outside its declared type, allowed). A literal `g(1.5)` has a static error and must keep its decline · ~380 · `test/epsil/compiled-declared-function-type.test.ts` (20), `compile-block-local-function.test.ts` · crafted |
| 1efbbe884 (part) | 10-20 | Locals assigned only in nested blocks declared at body level; hoisted `Declare` keeps its type | value | each call owns its local; writes and reads share one variable | |
| 45719a95e | 10-20 | Comment: infinite argument at a `real` parameter on float targets | other | comment only | |
| 508b22038 | 10-20 | Sum/Product with no bounds runs over 1..∞ | other | feature (`withDefaultBigOpBounds`) | |
| 623af5a3e | 10-20 | `powRealBranch` for float exponents on negative bases (interval-js) | value | enclosure excluded the interpreter's value | |

### Candidates

Commit counts (each commit once; a commit with a candidate part counts as candidate): candidate 7 (63bfbabb9, 930b9cedc, dd2813809, 75196dd8f, e8934c2c3, 85e4ca049, 1efbbe884); value 7 (b426d66ba, d0f64aa92, 114db120a, f395dd074, 0c398a278, f43af0ee1, 623af5a3e; the last-but-one three also hold decline/other parts); other 12 (68aec0f22, 7d1fa629e, 2fd45d32e, b5fe0371e, 110c3b060, 3bdee13b3, 6ed142f0a, 232ab3776, 5922e2129, 7e1cfd1a9, 45719a95e, 508b22038); decline 0 pure.

- **Read of a block local before its write (error or unevaluated in the interpreter).** 930b9cedc (decline at compile time), 75196dd8f (function bodies), 1efbbe884 (run-time marker check that throws). HEAD: `classifyLocalReads`, `localReadWithNoWrite`, `checkedLocalReads`, `checkedLocalRead`, `hideCheckedLocals` in `compile-locals.ts:894-1530`, hooks in `compiler-core.ts`, Python `_ce_unset`. Removal leaves `NaN`/`undefined`/uninitialized read, or a decline kept for GLSL/WGSL. About 700 lines. Tests: `test/epsil/function-body-local-assignment.test.ts`, `ce-636-block-local-without-value.test.ts`, `block-locals-per-run.test.ts`, `block-later-declarations.test.ts`. Witness: crafted (tests only). Caution: the classification may also serve the per-call local declaration (value); separate the two before deleting.
- **Declared parameter type tests at calls of block-local functions (input outside its declared type).** 1efbbe884. HEAD: `compile-user-functions.ts:1828-2210`, hooks in `compile-callbacks.ts`, `compile-locals.ts`. Removal leaves a value or `NaN`; a literal argument outside the type still declines through the static error. About 380 lines. Tests: `test/epsil/compiled-declared-function-type.test.ts` (20 tests), part of `compile-block-local-function.test.ts`. Witness: crafted.
- **Effects-contract refusal of redefinitions (interpreter returns an error).** 75196dd8f, e8934c2c3. HEAD: `refuseEffectContractViolations`, `bindingStatesEffects`, `compile-locals.ts:246-410`; `compile-blocks.ts:234`. Removal leaves compiled code that runs a definition the interpreter refuses. About 140 lines. Tests: `compiled-function-redefinition-effects.test.ts` (6), `effects-seam.test.ts`, `effects-contracts.test.ts`. Witness: crafted (named in tests only).
- **Absence value by cell type and unmatched-position `Missing`.** dd2813809 (and the written-`Missing` spelling in 63bfbabb9 / 930b9cedc for interval-js, tagged `other` because the interval `empty` result is a documented contract). HEAD: `absenceKind` `compile-absence.ts:1156`, `selectAbsent` in `javascript-runtime.ts`, `compile-conditionals.ts`. Removal leaves `NaN` for every cell. About 80 lines. Tests: `compile-missing-point-list-cell.test.ts` (5). Witness: crafted.
- **Arity mismatch decline.** 63bfbabb9. HEAD: `checkUserCallArity` `compile-user-functions.ts:1227`. Removal leaves `NaN` or an ignored extra argument. About 50 lines. Tests: `compile-user-call-arity.test.ts` (7). Witness: crafted. Low confidence: a decline is cheap, and later partial-application support (`compile-partial-application.test.ts`) may use the same check.
- **Block whose value is `Nothing`.** 930b9cedc. HEAD: `compile-blocks.ts:256-275`. About 20 lines. Removal may produce unparseable Python/shader source (`return let t`); verify before deleting. Witness: crafted.
- **`At` with NaN/infinite/absent index entries.** e8934c2c3. HEAD: `javascript-runtime.ts:6028-6034`, about 12 lines. Witness: crafted.
- **`Zip` all-absent row.** 85e4ca049. Already removed at HEAD.

Borderline, tagged `other`: input writes through a local copy (f395dd074, 0c398a278; about 700 lines over JS, Python and shaders). The compiled value is the interpreter's; the difference is that the caller's `vars` object is not changed, a Python throw, and invalid shader source. Not an absent or out-of-type case, so it is not a candidate by the brief.

## Part 2: 38 commits, 2026-10-20 to 2026-10-23

| hash | date | subject | tag | what it handles | candidates: HEAD location · removal leaves · src lines · tests · witness |
|---|---|---|---|---|---|
| 9a3677801 | 10-20 | Compiled GammaRegularized at non-positive order (JS, Python) | value | Wrong finite values of Q(s,z) for s <= 0 | |
| 92f424f3e | 10-20 | Coalesce/IsMissing: whole-value absence, decline on possible Nothing | decline | Declines when an operand may be `Nothing`; per-operand absence axis | |
| 315e6fc41 | 10-20 | broadcast()/broadcastAsync(), worker kernel pool, interval runtime | other | New batch-evaluation feature | |
| a608320ca | 10-20 | Lint fixes in four files | other | Lint | |
| eb7a56f25 | 10-20 | Decline Map/Covariance/Correlation over possible Nothing elements | decline | Omission-sensitive collections decline | |
| 8cd835712 | 10-20 | Filter/Count with predicate: decline on possible Nothing | decline | Extends the omission decline to selectors | |
| 2f76a67a0 | 10-20 | Numeric aggregates decline on possible Nothing data | decline | Sum, Mean, Min and others decline | |
| 2081e5469 | 10-20 | Tuples keep Nothing coordinates; Tuple/Zip declines | decline | Declines Tuple with Nothing; deletes `_SYS.tupleOrAbsent` and the Python all-absent refusal (this removal already took out absent-handling code) | |
| 69b8d4cc0 | 10-20 | Python bound scope; callbackExcludesNothing proof | decline | Narrows the omission decline for provably safe callbacks; `reboundFunctions.literals` | |
| 6d77ae830 | 10-20 | Call-head inference; captured-callable binding check | decline | Declines when a captured callable differs from the ambient function (would give a wrong value) | |
| c240193f0 | 10-21 | Tycho 407/411/413: FindFit grid; NaN in branch relations; absent-operand tests | other + candidate + decline | (a) FindFit is not compilation: other. (b) NaN operand of a branch relation decides false (user decision): other. (c) `isElementReadWithoutNothing`: narrows a decline. (d) `operandInputNodes` and absent-variable tests: candidate. (e) `INTERVAL_MISSING` flag: candidate | candidates (d), (e): see Candidates, groups A and B |
| b76ca1055 | 10-21 | broadcastable<T> means T or list<T>; color-space type test | other | Type-system change; color broadcast gate uses `isSubtypeOfBroadcastOrIndexed` | |
| 30aecfc0a | 10-21 | Tabulate/Scan: decline on possible omitted positions | decline | Extends the omission decline | |
| 780a7d39f | 10-21 | Type handling; narrower `isElementReadWithoutNothing`; Sum/Product Element clause | decline | Fewer reads are proven Nothing-free | |
| 8fd9f7394 | 10-21 | Value with no order decides false; pole comparisons fold | value | `0 < 1/0` and `1/0 = 1/0` compile to the interpreter's `False`; complex-operand decline message | |
| b9016e19b | 10-21 | broadcast: shared inputs and several outputs per cell | other | Feature | |
| dc5a242ec | 10-21 | Sticky unresolved calls; function declaration hoisting | other | Evaluator and Epsil change; one compile line uses `isFunctionDeclarationStatement` | |
| 97ef4064d | 10-21 | Hoisting epochs, Solve renames, kernel-pool cancel; clause scoping in compiler | other + candidate + decline | Mostly non-compilation. Compiler part: scoping of Limits/Element clause in `assertCapturedCallableBindings` (decline) and in `operandInputNodes` (candidate, same mechanism as group A) | group A, about 30 lines of the diff |
| 7cbbd3a50 | 10-21 | isSubtype to provablyAdmits for nothing/missing checks | decline | Same omission declines, with the "unknown" marker rule | |
| a32d9c0b2 | 10-21 | Complex GammaLn principal log; compiled GammaLn of negative real | value | Wrong finite compiled value for negative reals on JS, GLSL, WGSL (#463) | |
| 0c82b225c | 10-21 | Merge of a32d9c0b2 (same compile diff) | value | Same as a32d9c0b2 | |
| 41240b5e9 | 10-21 | AssertPresent operator and presence contracts | other | New operator `x?!` with a `raise` capability per target | |
| 4e66aed34 | 10-22 | list<T> read by elements, tensor<U> by cells | value | Point and tensor shape dispatch for declared `broadcastable` types; declines on non-numeric point coordinates. Overlaps CE-712 steps 3 to 5 (`_SYS.absShape`, `pointComponent` run-time shape tests) | |
| ece7ba4ba | 10-22 | Tycho 419-421: `_SYS.bound` for Sum/Product bounds typed with a number arm | value | `Math.floor("3")` read a string bound as 3; Tycho row 421 (corpus) | |
| cc468eb4f | 10-22 | Tycho 422-424: user functions that shadow library operators; NaN-region exit | value | `shadowing-calls.ts` renames the call so the library lowering is not used (Tycho row 423, corpus); integral early exit is performance | |
| 636a62e17 | 10-22 | Element-wise If/Which over masks of any rank | value | Compiled JS gives the interpreter's nested-mask values; Python and interval decline on a condition that may be a list. Overlaps CE-712 (`selectNested`, run-time array tests) | |
| 556ca8d7e | 10-22 | Tycho 425: index into broadcastable<T> call | value | Wrong shape or value for `g(x)[1]` with `x: any` (corpus); Repeat throws on non-integer count. Overlaps CE-712 (`atWithValueMarker`, `requireSameShape`) | |
| 903e2af7c | 10-22 | One cell rule for vector, matrix, tensor | other | Type-system change; two small compile lines | |
| 36c24fa23 | 10-22 | Index into tuple or string held in broadcastable<T> | decline | JS and Python decline an element read of an operand that may be a string | |
| 4916e3f7f | 10-22 | Complex Mean/Variance in compiled reducers | value | Complex data in statistics; `complexLowering` | |
| 940fc95d4 | 10-23 | CE-360/361/363/364: Sum over possible lists, list elements of unknown type | value | Compiled list arithmetic read as scalar code gave wrong results | |
| 8843c9522 | 10-23 | Multiply of two matrices is the matrix product (CE-98) | value | Compiled matrix product for matrix-typed operands (user decision 2026-10-22) | |
| 046402a55 | 10-23 | Ragged list or rank-3 tensor in compiled product (CE-98.1, 98.2) | value | Compiled product follows `mulCollectionsWith`; mismatched dimensions give one NaN | |
| 557743738 | 10-23 | Function-literal signature; folds over unknown-typed elements | value | `Reduce`/`Max` over `list<unknown>` rows gave `null` or `NaN`; some folds decline. Overlaps CE-712 (guarded run-time fold for `unknown` elements) | |
| 7008b8bd6 | 10-23 | Multiply fold over elements of several shapes (CE-98.3) | value | Removes declines; the run-time product handles shapes. Overlaps CE-712 (`requireSameShape`) | |
| 8dfe4b888 | 10-23 | Lint | other | Lint | |
| 93d3c376d | 10-23 | An absent element of unknown type stays absent in compiled JS (CE-368) | candidate | `g(x)[5] + 1` with `x: any`: interpreter gives `Missing`, compiled gave `NaN`/`false` | group C: see below |
| 8c76cb6b8 | 10-23 | Folds over unknown-type elements, absent elements, booleans (CE-380/381/382) | value + candidate + decline | CE-380 complex lane for folds: value. CE-381 `null` read as NaN in folds (`elementsMayBeAbsent`, `absentAsNaN`): candidate. CE-382 string/boolean cells decline: decline | group C, CE-381 part |

### Candidates

- **Group A: "unsupplied variable leaves a branch undecided" (commits c240193f0 part, 97ef4064d part, 41240b5e9 touches the same function).**
  - Code added: `BaseCompiler.operandInputNodes()` and its callers: for a comparison in an `If`/`Which`/`When` condition, every vars-object variable the operand reads is tested for `undefined`, so the branch takes no arm instead of the else arm (ruled 2026-09-02, "an unsupplied variable leaves the branch undecided").
  - HEAD: `src/compute-engine/compilation/compile-absence.ts`, `operandInputNodes` lines 807 to 931 (about 125 lines), callers at lines 263, 271, 348, 1195, 2263, 2336. Also `compiler-core.ts`, `compiler-state.ts`.
  - Removal leaves: `undefined > 0` is `false`, so the else arm runs, or NaN. This is the allowed "input left out" case. No wrong finite value for supplied inputs.
  - Source lines: about 125 for the function; callers and the tests of absent variables add more (not counted here; the later absence code in `compile-absence.ts` uses it for blocks too, lines 215 to 348).
  - Tests: `condition-nan-undecided.test.ts` (about 41 tests, many on NaN and not only on absence), `compile-comparison-absent-operand.test.ts` (10), `compile-three-valued-connectives.test.ts`, `absence-discharge.test.ts`.
  - Witness: Tycho rows 411 and 413 (corpus) for the NaN rule; the "unsupplied variable" part was ruled on 2026-09-02, and the commit names no program. Keep the NaN-operand rule (that is a value rule); only the `undefined` tests are candidate. A `real | missing` input that is declared absent is a separate case that the caveats also allow to give 0 or NaN.
- **Group B: interval target `missing` flag (c240193f0 part).**
  - Code added: `INTERVAL_MISSING = "{ kind: 'empty', missing: true }"` so a comparison with a written `Missing` gives `'maybe'`; `Which` with no default arm and else-less `If` emit it.
  - HEAD: `src/compute-engine/compilation/interval-javascript-target.ts` lines 1082, 1254, 2491, 3819, 6541; also the runtime support in `src/compute-engine/interval/comparison.ts` (`hasEmptyOperand`).
  - Removal leaves: the plain `empty` result; a comparison with it gives `'false'` instead of `'maybe'`. The interpreter gives `Missing` there, so this is the allowed "value where the interpreter gives Missing" case.
  - Source lines: about 30 in the target, plus about 80 in `interval/comparison.ts` and `interval/types.ts` (not isolated).
  - Tests: `interval-kernels-ce522.test.ts` (flag checks), `interval-277-278-constant-table-sign-conditional.test.ts`.
  - Witness: Tycho row 413 (corpus), but the program that needs the `missing` flag is an interval comparison with a written `Missing`, which looks crafted. Flag: the corpus row is about the NaN rule, not about this flag.
- **Group C: absent list element read as `undefined` / `null` (93d3c376d, 8c76cb6b8 CE-381 part).**
  - Code added: `absentBesideScalars()` and the `undefined` rule in `bcast` and `smul`; `bcastPlain`; the `topTypeBesideAbsence` level-0 rule and `hasMissingArm`; the ordering guard `x === undefined ? undefined : ...`; `absentAsNaN()` for matrix products; `elementsMayBeAbsent()` and the `NaN` reading of `null` in the `Reduce`/`Scan` builtin combiner.
  - HEAD: `javascript-runtime.ts` lines 1899, 1909, 3071 to 3088, 3736, 3748 (`bcast`, `bcastPlain`, `absentBesideScalars`, `absentAsNaN`); `javascript-target.ts` lines 5708, 7319, 15500 to 15585 (`elementsMayBeAbsent`, about 86 lines with the combiner parameter); `compiler-type-facts.ts` (`hasMissingArm`).
  - Removal leaves: `NaN`, `false`, `null` (read as 0 in arithmetic) or `undefined` where the interpreter gives `Missing`. All allowed. `null` read as 0 by `*` is a finite number, but the input is a `Missing` element, not a value of the declared type.
  - Source lines: about 150 (runtime about 60, target about 90).
  - Tests: `compile-list-element-unknown-arith.test.ts` (14), `compile-fold-lanes-absent-non-numeric.test.ts` (9), some tests in `tycho-row-425-index-of-broadcastable-call.test.ts`.
  - Witness: CE-368 and CE-381 (ROADMAP ids; the entries are no longer in `ROADMAP.md`). The program is `g := t ↦ [t, 2t]`, `x: any`, `g(x)[5] + 1`: an index past the end of a 2-element list. This looks crafted. The commits do not state a strength. Overlaps CE-712 (`x: any` is refused as an input there).
- **Group D (already removed): `_SYS.tupleOrAbsent` and the Python all-absent Tuple/Zip refusal.** Added before this range, deleted by 2081e5469; not a candidate for removal now.

Not candidates, checked: `92f424f3e` Coalesce handling of `T | missing` (absent is inside the declared type); `41240b5e9` AssertPresent (a language operator); the declines for possible `Nothing` (decline, keep).

## Part 3 (26 commits, 2026-10-23 to 2026-10-25)

Source line counts are approximate and measured at HEAD. Files were split from `base-compiler.ts` on 2026-10-30.

| hash | date | subject | tag | what it handles | candidates: HEAD location · removal leaves · src lines · tests · witness |
|---|---|---|---|---|---|
| f5b7e8f8e | 10-23 | A call of a user function over an untyped free input compiles (CE-377) | other | Types a free input as number so the guard stops declining; fewer declines. | |
| 84b20932f | 10-23 | Compiled fold times matrix is the matrix product (CE-388) | value | `Sum(L)·M` gave a wrong shape; adds `cmulChecked`. | |
| d4dc5a26f | 10-23 | Indefinite integrals skip residue; divergent integral is ±∞ (CE-385, CE-391) | other | Compiled `Integrate` gives the interpreter's ±Infinity for a one-signed divergent tail (was NaN). | |
| 5f605ec53 | 10-23 | NaN operand of compiled Equal compares as number; element read guarded (CE-386) | candidate | Part A: `Equal`/`NotEqual` guard answers undefined for an absent element of a bare list (`g(x)[1] = 1`). Part B (value, keep): operands bound once so an impure operand is not evaluated twice. | See "Kleene absent comparison". Part A only. |
| 27e093bcf | 10-23 | A comparison with an absent number is absent, compiled JS/Python (CE-93) | candidate | Comparison of `number \| missing` operand returns the absent object instead of `false`/raise. | See "Kleene absent comparison". |
| 799cc9d3a | 10-23 | NotEqual with a NaN operand is True in a branch condition (CE-125) | other | Removes the NaN test for `NotEqual` in branch conditions; IEEE result. Net deletion. | |
| 05c2ea270 | 10-23 | .N() of divergent integral with sign change takes exact route's ±∞ (CE-391) | other | Integrate numeric result for divergent integrals. | |
| cc72330ea | 10-23 | NaN pair makes chained comparison False; branch over chain by link (CE-94) | candidate | Chain `a<b<c` split into an `And` of links so a decided-false link wins over an absent operand; removes `nanUndecided`. | See "Kleene absent comparison". The `nanUndecided` removal is simplification (other). |
| ca4114a49 | 10-23 | A product that overflows is computed in log space in integrals (CE-394) | value | `x^100*e^-x` gave NaN where the value is finite; adds `_SYS.finiteOr`. | |
| 9d2e794e0 | 10-23 | Residue classes have a type of their own (CE-136) | decline | Compile of a `residue`-typed expression throws (declines). | |
| d638b0dcb | 10-23 | chore lint | other | Formatting. | |
| d04090ec1 | 10-23 | CE-397 couldMatch, CE-398 element-wise types, CE-399 vector plus matrix | value | `requireSameShape` accepts nesting shapes (vector + matrix by rows), refuses non-nesting. | |
| bbfafc6aa | 10-24 | Interval-js handling for boolean expressions and wider inputs (CE-210) | value | Interval fallback gave `empty` for a value sampled at the midpoint of a wide input; now `entire`/`maybe`. | |
| 2c4ad70ac (compile part) | 10-24 | Resolve about 80 ROADMAP entries, compile fixes | value | GPU/Python wrong values: CE-246 WGSL Mod underflow, CE-243 vector powers at zero, CE-262 arg at signed zero, CE-230 dead complex arm lane, CE-224, CE-251 grouping, CE-282 angular unit. | |
| 2c4ad70ac (decline part) | 10-24 | same | decline | CE-393 decline `Max`/`Min`/ordering over `color`/`regexp`/`object`; CE-226.1 decline of assignment to a loop index. | |
| 497e46c21 | 10-24 | A declared `broadcastable<T>` parameter maps to the cells (CE-405) | value | A call through a `broadcastable<T>` parameter with a scalar `T` maps cells as the interpreter does. | |
| a3fcd993d | 10-24 | Absent operands with unknown types keep their absence in arithmetic (CE-229) | candidate | `s*PointX(p)` with `p` absent gives `undefined` (interpreter `Missing`) instead of `NaN`. | See "Unknown-typed absent operand". |
| 42b97e637 | 10-24 | chore lint | other | Formatting. | |
| 7cc75ad90 | 10-24 | A call over one point or a list of points (CE-407, CE-409) | value | Union `tuple \| list<tuple>` argument: run-time dispatch (`Array.isArray` on first element) plus a decline when ambiguous. Tycho row 435 (corpus). Overlaps CE-712 steps 3 to 5 (run-time shape test; a declared union of shapes). | |
| f13b6f46f (main) | 10-24 | Chained mixed relational operators; batch body; point functions over lists (CE-410 to CE-416) | other | CE-410 fast batch body for `broadcast()`, CE-412/414 point functions over lists, CE-411 chains. Mostly features and performance. | |
| f13b6f46f (absent part) | 10-24 | same | candidate | CE-414.2/CE-415/CE-420 absent point argument: `absentArgumentChecks`/`presentCheckedCode` give `undefined` for an absent point, plus a decline for `P \| missing` arguments. | See "Absent argument checks". Part only; the exact size is not measured (the commit is 1717 lines, mostly CE-410 and CE-412). |
| c3778c25a | 10-24 | Time limit and event-loop turns on async routes (CE-424 to CE-428) | other | Async API and options in `types.ts`. | |
| ca73f9207 | 10-24 | Cooperative yielding in linear scan solve and setup | other | Async responsiveness, kernel-pool grid axes. | |
| ff1daaabf | 10-24 | A worker pool for a kernel loaded with the runtime entry (CE-436) | other | `createKernelPool`, `loadBroadcastAsync`. No compilation source diff. | |
| 0c3e359f1 | 10-24 | Constant-fold checks visit a shared node once (CE-319.1) | other | Performance. | |
| e181a868a | 10-24 | The compiler uses less stack per level of nested expression (CE-320.2) | other | Refactor for stack depth (3110 lines moved in `base-compiler.ts`). | |
| fe4424bda | 10-25 | Open items of the ROADMAP Performance section | other | Compiler and codegen speed-ups, exact compiled Map, in-place update. No absent or Missing test found in the added lines. | |
| fd47fdca4 (value) | 10-25 | Open items of the ROADMAP Compilation section | value | Wrong values: CE-217, CE-213, CE-211 (`x < 1/0`), CE-223, CE-370, CE-221, CE-215.1, Root, CE-278, CE-262, CE-231, CE-251, polygamma, Clamp, Python builtin hiding. | |
| fd47fdca4 (other) | 10-25 | same | other | New lowerings: GPU Digamma/Trigamma/PolyGamma, Zeta, vector Mod, GCD/LCM, Match, Python Equal and block-local functions, CE-215.2, CE-225, CE-260, CE-238, CE-236, CE-372. | |
| fd47fdca4 (candidate) | 10-25 | same | candidate | CE-226.2/226.3/CE-228: run-time shape test of a call argument against a parameter annotation (`jsCollectionShapeGuard`, `localParameterChecks`, `Apply` of an annotated literal answers `NaN`), and decline when a body assigns a value of another type to a typed parameter. | See "Parameter annotation checks". |

### Candidates

- **Kleene absent comparison** (5f605ec53 part A, 27e093bcf, cc72330ea). A comparison (`< <= > >= = !=`, chains) with an operand of type `number | missing` returns the target's absent object (`undefined`/`None`) when the operand is absent; the interpreter gives `Missing`. Chains are split into an `And` of links so a false link wins.
  - HEAD: `compile-absence.ts` (`absentComparisonGuard` at about line 2392 to 2513, `absentOnlyThroughNumericSlots` about 30 lines, `compileAbsentRelation` at line 545), `compile-conditionals.ts` (`guardConnectiveAbsence`), `compile-broadcast.ts` (broadcast form); also `numericMissingSlot` in `src/common/type/utils.ts`.
  - Removal leaves: `false` (JS, IEEE) or a Python exception/`NaN` where the interpreter gives `Missing`. All allowed (`Missing` becomes `NaN`/`false`/throw). The part that binds operands once (impure operand evaluated twice) is a `value` fix and must stay, or the whole guard falls back to a decline for impure operands.
  - Lines: about 250 to 350 (the three functions plus connective guards and the call sites in `compile-broadcast.ts` and `compile-conditionals.ts`).
  - Tests: `comparison-absent-numeric-slot.test.ts` (12), `compile-comparison-absent-operand.test.ts` (22), `compile-three-valued-connectives.test.ts`, `condition-nan-undecided.test.ts`, `missing-value.test.ts`, `compile-list-element-unknown-arith.test.ts` (19), `compile-python.test.ts` (parts); about 60 to 80 tests in total, with some pinning interpreter behavior that stays.
  - Witness: user decision 2026-10-23 and ROADMAP CE-93, CE-94, CE-386. Test programs are `w > 0` with `w: number | missing`, and `g(x)[5] = 1` with `g := t ↦ [t, 2t]` and `x: any`. Strength: `plausible` for the first, `crafted` for the second.
- **Unknown-typed absent operand** (a3fcd993d). Operands typed `any`/`unknown` keep `undefined` through broadcast arithmetic (`_SYS.bcastScalarAbsent`, `keepsAbsence` in the point accessor helper).
  - HEAD: `compile-broadcast.ts` (`unknownAbsent`, `scalarAbsent`), `javascript-runtime.ts` (`bcastScalarAbsent` at about line 1940, 12 lines).
  - Removal leaves: `NaN` where the interpreter gives `Missing` (allowed).
  - Lines: about 50.
  - Tests: `compile-absent-unknown-operand.test.ts` (6).
  - Witness: ROADMAP CE-229 and user decision 2026-10-23. `s*PointX(p)` with `p` absent. Strength: `crafted`.
- **Absent argument checks** (f13b6f46f part, CE-414.2/415/420). Calls of point functions: an absent point argument gives `undefined`, and a `P | missing` argument to a `broadcastable` parameter declines.
  - HEAD: `compile-user-calls.ts` `absentArgumentChecks` (line 194), used in `compile-point-calls.ts`, `compile-user-functions.ts`, `compile-user-specialization.ts`, `compile-function-literals.ts`. `absentArgumentChecks` itself predates the commit (introduced by `6fa03133f` or `70bed4e6b`), so only the point-call uses were added here.
  - Removal leaves: `NaN`/`undefined`/throw on an absent point (allowed). The decline for `P | missing` can stay.
  - Lines: about 40 to 80 (estimate, not measured).
  - Tests: `ce-412-414-point-function-list-arguments.test.ts` (about 1150 lines, 64 lines mention Missing/undefined; the absent-case count is not measured).
  - Witness: user decisions 2026-10-24 (CE-414.2, CE-420) and Tycho rows 434, 435 for the parent feature. Strength for the absent case: `crafted`.
- **Parameter annotation checks** (fd47fdca4 part, CE-226/228). The compiled call tests an argument against a parameter annotation at run time: `jsCollectionShapeGuard` (a number at a `list<number>` parameter, a 3-tuple at a `tuple<number, number>` parameter), `localParameterChecks`/`Apply` of an annotated literal answering `NaN` for `v = 1.5` at `(k: integer)`, and `assertParameterWritesMatchTypes` (declines when the body assigns a wider type to a typed parameter).
  - HEAD: `compile-callbacks.ts` (`jsParameterGuard` used at line 265; `jsCollectionShapeGuard`, `localCheckingCallee`), `compile-locals.ts` (`localParameterChecks`), `compile-user-functions.ts` (around line 1396 `appliedArgumentTypeMismatch`, line 1995 CE-226.3); `assertParameterWritesMatchTypes` is re-exported at `base-compiler.ts:1913`.
  - Removal leaves: the interpreter's `incompatible-type` error becomes a computed value (`2.5`, a string). That is "an error the static type does not show" or "an input outside its declared type" (allowed). The write-check is a decline and should stay.
  - Lines: about 150 to 250 for the run-time guards (estimate, not measured).
  - Tests: `compile-collection-parameter-check.test.ts` (11) and cases in `compile-block-local-function.test.ts`.
  - Witness: measured by the commit author on 2026-10-24; no Tycho row named. Strength: `crafted`.

## Batch 4: compiler commits 2026-10-25 to 2026-10-27 (36 commits)

Paths in the last column are at HEAD (files split on 2026-10-30). Source lines are approximate.

| hash | date | subject | tag | what it handles | for candidates: HEAD location · removal leaves · src lines · tests · witness |
|---|---|---|---|---|---|
| cd704b6b8 | 10-25 | Python absent inputs give NaN; run-time check for `any` operands | candidate (two parts) | (a) Python `readInput` turns a `None` input into NaN at numeric positions; (b) `declaredTopGuard` emits `Array.isArray` scalar/list dispatch for symbols declared `any`/`value`. Other parts of the commit are outside compilation. | See group A and group B |
| 0903f3107 | 10-25 | fix: open ROADMAP defects (compile: CE-142.5, CE-230.6, CE-227.1) | value (+decline, other) | One-bound `Sum`/`Product` declines (CE-142.5); Python `np.emath.power` for a promoted float exponent (CE-230.6); shader period reduction folds pure constants (CE-227.1). | |
| 7b6b73f5a | 10-25 | absent tuple base marker gives NaN (JS, Python) | candidate (+value) | `absentBaseReadIsNumeric` makes `_SYS.atWithValueMarker(..., true)` answer NaN for an absent tuple base; `tupleSlotReadType` types a slot read by its own slot (value part). | Group A |
| 888f5f777 | 10-25 | `broadcast` option builds the batch body on request | other | Option to skip the second compilation for `broadcast()`. | |
| 0baeb44b6 | 10-25 | Python: declared numeric inputs read as-is, inferred ones checked for None | candidate | Narrows the Python `None` to NaN read to inferred numeric types; adds `PYTHON_NUMBER_LITERAL` exemption. | Group A |
| 472df47ee | 10-25 | CE-333 point projection over typed lists; wide constant lists on interval | other | Performance fold; `isLibraryOperator` stops a folded `Max`/`Add` when a user definition shadows the name (value, small). | |
| 825303791 | 10-25 | types: CE-448 tensor of points argument | decline (+value) | Declines a tensor of points of rank 2 or more beside an untyped list; maps recursively at every depth. | |
| 9fb196715 | 10-25 | juxtaposed product typing (CE-32); unroll budget (CE-458) | other (+value, decline) | Unroll size limit (compile time of nested `Sum`); GPU loop bound must fit `int`; inferred point parameter accepts a list. | |
| d963d1b4f | 10-25 | CE-473 captured free symbols | candidate | Declines a compile when a symbol the body reads holds a value of another type, or changed type since the function was stored. | Group C |
| e1f342625 | 10-25 | chore lint | other | Formatting. | |
| 9dcc2cf0b | 10-25 | arch: cleanup deprecated symbols | other | Removes deprecated compile options and `deprecation-warnings.ts`. | |
| ef654075b | 10-25 | structural form keeps a constant name; refusal names the captured symbol | other | Better message for the CE-473 decline (group C). | |
| 65b557902 | 10-25 | types: CE-3.5, CE-4, ... CE-488 | candidate (+value) | `assertNoProvedAbsentObjectOperand` declines `At(M, 7) + 1`; `inCompiledScope` canonicalizes `Match` case bodies in the block scope (value). | Group D |
| d96a6ac11 | 10-26 | fix: CE-462 ... CE-501 | value | `Range(0)` on JS gives the descending list `[1, 0]` as the interpreter does. | |
| b6531824f | 10-26 | types: CE-502, CE-503, ... | value | `Rank`/shape checks read the declared type with the `tuple` arm kept. | |
| 1531783ca | 10-26 | register custom compilation targets | other | New API. | |
| b33c90a1c | 10-26 | CE-504 a point beside an operand that may be a list | value | List of points times/divided by an array: wrong flat pairing; now a run-time plan or a decline. | |
| 7972b850c | 10-26 | CE-505, CE-506 point parameters with mixed lists; empty lists | candidate (+other) | Run-time `uniform` test: a list that mixes points and lists gives NaN (interpreter: `incompatible-type` error). The empty-list admission is `other`. | Group E |
| 0be912cef | 10-26 | value kinds, phase 1 (CE-507) | other | New feature: kind types, registry, `kind-lowering.ts`. | |
| 140ad66f5 | 10-26 | GLSL/WGSL: `_gpu_fmod` helper, f32 literal range | value | `Mod` result outside the divisor range in f32; literals above f32 max rejected by WGSL. Witness Tycho row 455 (corpus). | |
| 21d9d30a4 | 10-26 | CE-518 caller compile handler not shippable; `compileHelpers` | other | Feature / safety flag for `broadcastAsync`. | |
| 0a2357234 | 10-26 | CE-514 PointList coordinate of a possible list of points | value | JS `Array.isArray` dispatch in `PointList` for an inferred union parameter; was `[NaN, NaN]`. Witness Tycho row 447 (corpus). Overlaps CE-712 step (run-time shape test at `javascript-target.ts:3892`). | |
| 61cb3c14b | 10-26 | CE-519 NaN-safe Max, Min, Clamp on glsl and wgsl | value | `max(0, sqrt(1 - x^2))` at x = 2 gave 0, interpreter NaN, on Apple GPUs (Tycho row 465, corpus). | |
| 32b663a55 | 10-26 | shader `_gpu_sin/_gpu_cos/_gpu_sign/_gpu_smoothstep` NaN-safe | value | Same mechanism for `Sin`, `Cos`, `Sign`, `Smoothstep` of a computed NaN or infinity (CE-520, Tycho `voronoi-diagram`). | |
| 30d37c4e3 | 10-26 | GPU random draws outside nodes | decline | Declines a selection whose arm draws a random value (Tycho row 466). | |
| a23be5735 | 10-26 | chore lint | other | Removes unused code. | |
| f5d991902 | 10-27 | GPU: keep order of random draws in statements | decline | Fails closed when hoisting would reorder `Random()` draws. | |
| 22d77a2ea | 10-27 | value kinds, phase 3: Enclosure kind | other | New feature on interval-js. | |
| eb20e4063 | 10-27 | CE-528 interval-js runner throws ReferenceError | other | Error handling of the runner. | |
| 47c949ce5 | 10-27 | interval functions: run-time degree for `nthRoot` | value | Interval `nthRoot` with a run-time degree; hyperbolic partial results. | |
| d8f99b572 | 10-27 | `recompileStatement`; draw order in WGSL and GLSL | decline | Retries a statement with bound draws, else declines. | |
| 4815ac793 | 10-27 | `subs()` keeps bound variables; big-operator bounds above 2^53 | value (+decline, other) | Capture-avoiding substitution when inlining calls (value); `Sum`/`Product` bounds outside safe integers decline; `gpu-shared-calls.ts` is new (perf). | |
| 9bf78427f | 10-27 | Smoothstep on Python; NaN-safe shaders; `gpuProvablyFinite` | value | Smoothstep for `e0 >= e1`; skips the NaN guard for provably finite arguments (perf). | |
| bdbc0a015 | 10-27 | GPU finite check allows self-mapped uniforms | other | Perf: guard skipped for a uniform of declared type. | |
| 7905a1b1e | 10-27 | CE-252 interval-js invariant prefix | other | Codegen perf and check of the emitted body. | |
| 9f6a0491a | 10-27 | CE-562..565 codegen batch | value (+decline) | Condition order in `When`; a list bound whole to an open parameter is inlined or declines; a list at a contract point parameter declines. | |

### Candidates

- **Group A: absent input read as NaN (`None`/`undefined`/absent tuple base).** Commits cd704b6b8 (a), 7b6b73f5a, 0baeb44b6.
  - HEAD: `readAbsentInput` in `compile-inner.ts:542-581` (about 40 lines); Python `readInput` hook in `python-target.ts:8386` (about 12 lines, with `PYTHON_NUMBER_LITERAL`); `absentBaseReadIsNumeric` in `absent-tuple-read.ts:134` (the file has 193 lines; `tupleSlotReadType`, line 47, is a value fix and stays) with the third `numeric` argument of `atWithValueMarker` in `javascript-runtime.ts:1451` and its calls in `javascript-target.ts` (about 25 lines); point coordinate `keepsAbsence` in `javascript-runtime.ts`. About 110 lines in total.
  - Removal leaves: Python raises `TypeError` for `None + 1` and `np.sin(None)` (throw); `undefined` or `Missing`-like markers instead of NaN for an absent tuple base. Both are allowed ("input left out", "value where interpreter gives Missing").
  - Tests: `test/compute-engine/compile-python-absent-input.test.ts` (16 tests), `ce-214-4-absent-tuple-base-marker.test.ts` (10 tests), plus about 20 one-line edits in `compile-python*.test.ts`, `compile-cse.test.ts` and others made by 0baeb44b6.
  - Witness: decision 2026-10-25 (CE-214.4, CE-229); the inputs are an input left out (`None`) and `missing | tuple`; strength `crafted` (no Tycho row named).
- **Group B: run-time list/scalar check for symbols declared `any`/`value` (`declaredTopGuard`).** Commit cd704b6b8 (b).
  - HEAD: `declaredTopGuard` in `compile-expr-handlers.ts:188-312` (125 lines); `collectDeclaredTopSymbols`, `isDeclaredTopOperand` in `compiler-type-facts.ts:1264-1290`; `DECLARED_TOP_GUARD_HEADS`; `declaredTopMode` state in `compiler-state.ts`; `plainList` in `javascript-runtime.ts`; JS `isDeclaredTopOperand` hooks. About 220 lines.
  - Removal leaves: a decline for an input typed `any`, which CE-712 steps 3 to 5 already require (`AGENTS.md`: an input typed `unknown` or `any` is refused). Overlaps `docs/plans/2026-10-31-static-shape-compilation.md` §6.
  - Tests: `compile-declared-any-arithmetic.test.ts` (17 tests), parts of `any-typed-symbol-arithmetic-typing.test.ts`, `compile-js-interpreter-parity-batch.test.ts`.
  - Witness: CE-366 and CE-395 (a host that declares every parameter `any`); strength `plausible`. Flag: the input holds a value of its declared type (a list for `any`), so the replacement is a decline, not a changed value.
- **Group C: captured symbol changed type or holds a value of another type (CE-473).** Commits d963d1b4f, with the message change in ef654075b.
  - HEAD: `assertCapturedTypesCurrent` in `compile-assignment-checks.ts:456-483`, called at lines 420 and 426 (about 55 lines); held-value check in `compile-inner.ts:490-505` (about 16 lines). The shared helpers `capturedTypesWidened` and `capturedValueMismatchNow` in `function-utils.ts` also serve the interpreter and stay.
  - Removal leaves: wrong code for an error the static type does not show (`x + y` compiles to string concatenation after `y` changed from number to string): unspecified behavior, no decline.
  - Tests: `ce-473-captured-free-symbol.test.ts` (31 tests, only some about compile), `broadcast-call-typing-soundness.test.ts` (1 test).
  - Witness: CE-473, user decision 2026-10-25 option (c); strength `crafted`.
- **Group D: read proved to find no row (`At(M, 7) + 1`) declines.** Commit 65b557902.
  - HEAD: `assertNoProvedAbsentObjectOperand` in `compile-inner.ts:870-886` (about 17 lines) and its call; `provedAbsentDomainOf` stays (interpreter uses it).
  - Removal leaves: `NaN` where the interpreter gives `Missing` (allowed).
  - Tests: about 3 compile tests in `error-model.test.ts` / `compile.test.ts` (not counted exactly).
  - Witness: `docs/ERROR-MODEL.md` §6 example; strength `crafted`.
- **Group E: mixed points-and-lists depth check at a point parameter.** Commit 7972b850c.
  - HEAD: `compile-point-calls.ts:696-715` (the `uniform` test, about 18 lines); `pointArgumentMayMixDepths` is also used by the interpreter (`boxed-function.ts`, `validate.ts`) and stays.
  - Removal leaves: the walk runs on a mixed value and gives some value or throws, where the interpreter gives an `incompatible-type` error (allowed).
  - Tests: `ce-489-recursive-alias-point-argument.test.ts` (34 tests; about 6 pin the NaN case).
  - Witness: CE-505, a recursive alias `type B = list<B> | P`; strength `crafted`.

## Notes on `value` rows that look like candidates (kept)

- 61cb3c14b, 32b663a55, 9bf78427f (GPU NaN-safe helpers): the NaN comes from computed values (`sqrt(1 - x^2)` at x = 2) with inputs of their declared type, and the GPU gives 0 where the interpreter gives NaN. Corpus witness Tycho row 465. Tagged `value`.
- 0a2357234 (CE-514): corpus witness Tycho row 447, but its `Array.isArray` dispatch is the kind of run-time shape test that CE-712 steps 3 to 5 remove. Removal must keep `(v ↦ PointList(PointY(v), PointX(v)))` applied to a list of points.

## Batch 5 (17 commits, 2026-10-27 to 2026-10-30)

| hash | date | subject | tag | what it handles | for candidates: HEAD location · removal leaves · src lines · tests · witness |
|---|---|---|---|---|---|
| ce55cd2f3 | 10-27 | CE-570 shader root inlining, voronoi row; shared node counted once | other | Shader function chains no longer double in size per level (also adds an unrelated group-theory entry). | |
| 5eca8afa7 | 10-27 | CE-564/578 interval-js per-call copies, GPU element-wise wrapper | other | New compile support (user function with list argument on interval-js/GPU); declines become compiles. | |
| df6edc26b | 10-27 | CE-577 Factor/Together/Cancel; CE-565.4/.1 shader finite-parameter built-ins | other | Shader function bodies use built-in sin/cos/min/max when every call passes finite values (performance). Factor part is outside compilation. | |
| 4d235c8a2 | 10-28 | CE-571 compileFieldFunction, 572 storage buffer, 574, 575, 581 | other | New WGSL field-function and storage-buffer targets; compileShader checks (some declines). | |
| aae30478d | 10-28 | CE-586 symbol bound to rewound definition is inert | value | A symbol bound to a rewound (disposed) definition was folded with a later definition's value. | |
| 5eca150d7 | 10-28 | CE-565.2 Clamp/ElementMax/ElementMin built-ins when finite | other | GPU performance: built-in min/max instead of NaN-safe helper when operands are provably finite. | |
| 75d84fbfd (part A) | 10-28 | CE-569 compiled When gives no value unless condition True | candidate | `When` selects the value only when the condition is decided true: unsupplied input (`When(5, x≠0)` with `run({})` gave 5), non-boolean condition (`c = 1`), undeclared/unknown-type condition. | `isFalsyWhenUndecided`, `compileExactCondition` use in When: HEAD `compilation/compile-conditionals.ts` (lines ~430-560, 638+); python `conditionReadsAValue` HEAD `python-target.ts:5248` · removal leaves `undefined`/truthy value for absent input, a value for a non-boolean condition (allowed: absent input, out-of-type value, error not shown by type) · about 150 (When branch ~40, list cells ~25, `isFalsyWhenUndecided` ~45, python ~50; the exact-condition machinery is shared with `If` and stays) · `ce-569-when-defects.test.ts` (21 tests), edits in ce-562-cse-condition-arm, compile-equality-exact, compile-notequal-nan, compile-python, compile-three-valued-connectives, compile-when · ROADMAP CE-569, `crafted`/`plausible` (one-line programs with `run({})`) |
| 75d84fbfd (part B) | 10-28 | CE-569 boolean equality on javascript | value | `If(c = True, 5, -1)` with supplied `c = true` gave -1 (`typeof === 'number'` test); now `!== undefined`. | |
| f87ea242d (part A) | 10-28 | CE-580 compileShader checks; CE-584 50,000-node limit | decline | Shader targets refuse oversized code and wrongly typed body assignments; `vars` field-of-local refused. | |
| f87ea242d (part B) | 10-28 | CE-591 point parameters; shared-node walks | other | WGSL field function: point parameters as vec fields; linear walks of shared graphs; parameters with values. | |
| f87ea242d (part C) | 10-28 | vector expression of a declared vector typed as vector | value | `Sin(2*uv)` with `vec2 uv` passed a vec2 to a float helper; a Block local was declared `float`. | |
| a48dd298f | 10-28 | chore lint | other | Formatting. | |
| 21d3daf55 | 10-28 | CE-605 GLSL/WGSL compile Map inside Map lambda | other | New capability by unrolling (declines remain for unsafe cases). | |
| a48bf6b49 | 10-30 | CE-565.6 small power of bounded value proven finite | other | GPU performance (built-in `pow` when finite proven). | |
| 28f74e381 | 10-30 | CE-601 evaluate shared subexpression once | other | Evaluator cache; compilation part is 15 lines in `cse.ts`. | |
| ec330b8cc | 10-30 | CE-614/623 integrals keep call's function; compiled integrals keep params e/i/pi | value + decline | Compiled integral used the wrong function or constant for a name (wrong finite value); refuses two different functions of one name. | |
| d7e8b101d | 10-30 | CE-565.6 scaled bounded power proven finite | other | GPU performance, extension of the previous commit. | |
| f2c053f1e | 10-30 | Compile Contains/Unique/Element over lists of lists (#499) | other | New JavaScript capability with declines for tuple/lazy cases; `_v` capture fix (value). | |
| 783683901 | 10-30 | Fix review findings for f2c053f1e | other | Review fixes of the same scan: dictionary values, recursive alias, memo. | |
| 3431204f2 (part A) | 10-30 | CE-583/593/595 CSE linear, WGSL in-place list reads, point-or-list unions | other | Performance (linear CSE, interval-js code size), in-place reads, GPU point-or-list-of-points union support. | |
| 3431204f2 (part B) | 10-30 | Block scoping on JavaScript/Python/GLSL/WGSL; angular-unit folds; Argument(NaN) | value | Nested block returns/locals, Python loop index overwrite, assigned value in degree mode, constant fold of stored trig value. | |
| 3431204f2 (part C) | 10-30 | AbsArg in non-radian unit; block use-before-Declare; P union | decline | New declines. | |
| 3431204f2 (part D) | 10-30 | Python `Declare` with no value gives `_ce_unset` start value | candidate | A local declared with no value and read before assignment raises (`UnboundLocalError`); before, a loop-body local kept the value of the previous pass. | `_ce_unset`, `PYTHON_UNSET_HELPER`: HEAD `python-target.ts:3339-3420, 3975, 8916`, `compile-blocks.ts:813`, `compile-locals.ts:1428,1836` · removal leaves a stale value or `None`/error for a read of an unassigned local (allowed: the interpreter gives `Missing`/read error) · about 120 · `ce-636-block-local-without-value.test.ts` (8 mentions), `ce-583-block-local-list-no-copy.test.ts` (19 mentions) · crafted (programs in the commit's CHANGELOG, no Tycho row) |

### Candidates

- **Strict `When` condition (absent input and non-boolean condition)**: 75d84fbfd part A. Code is in `compile-conditionals.ts` and `python-target.ts` at HEAD; about 150 source lines; about 21 + 8 edited tests; CE-569, `crafted`/`plausible` witness. Removal leaves `When` taking its value branch for an unsupplied input or a condition that is not a boolean, which the caveats allow (absent input, out-of-type value). Does not overlap CE-712 run-time shape tests. No `corpus` witness found. The `isFalsyWhenUndecided` helper is also used by the list-of-conditions path; confirm no other caller before removal.
- **Python unset-local start value (`_ce_unset`)**: 3431204f2 part D. About 120 lines at HEAD in `python-target.ts`, `compile-blocks.ts`, `compile-locals.ts`; tests `ce-636-block-local-without-value.test.ts` and part of `ce-583-block-local-list-no-copy.test.ts`; `crafted` witness. Weaker case: the same commit's Python fresh-name work (part B) is a value fix and must stay; only the unset marker and its helper would go. Removal leaves a stale local from the previous loop pass (an unspecified read of an unassigned local).

Not candidates, checked: the CHANGELOG line "a value of the wrong type for a `string` variable throws" appears in the f2c053f1e diff, but I found no source change for it in that commit.

## Batch 6 classification

Line counts at HEAD are approximate. `compile-absence.ts` (3314 lines) is the HEAD home of the absence machinery; it was split from `base-compiler.ts` on 2026-10-30, and not every line of it comes from these commits.

| hash | date | subject | tag | what it handles | candidates: HEAD location · removal leaves · src lines · tests · witness |
|---|---|---|---|---|---|
| f80301037 | 2026-10-30 | Move durable rules from agent memory into repo docs; source comments | other | Docs and comments (4 lines in javascript-runtime.ts). | |
| f169546e9 (a) | 2026-10-30 | CE-579 list-recursion loop | value | A list-building recursion compiles to the `_SYS.listRecursion` loop again (stack overflow at D=10000 was a regression). | |
| f169546e9 (b) | 2026-10-30 | Comparison/Not/And/Or of unsupplied variable gives `undefined` | candidate | `x > 0` with `x` not supplied gave `false`; now `undefined`. Also guards for `Equal`, `NotEqual`, chains, bare boolean connectives. | `compile-absence.ts` (`unsuppliedComparisonGuard` ~l.1421, `unsuppliedReads`, `mayBeUndecided`, `conditionDecidability`, `noBranchValue`) · `false`/wrong branch (JS `false` or an arm taken; both allowed as "input left out") · ~1500-2500 (estimate; most of compile-absence.ts) · ce-588-if-missing-branch (22), ce-631-633 (86), compile-three-valued-connectives (61), compile-notequal-nan (19), compile-equality-exact (22) · Tycho-style rows CE-588/589/631-634; crafted/plausible (message says "user decision 2026-10-30"). Note: in a program with all inputs supplied, an `If` branch must stay correct. |
| f169546e9 (c) | 2026-10-30 | Take/Drop with NaN count gives no value; NaN at one-clause numeric param | candidate | `Take(xs, NaN)` gave `[]`; one-clause user function accepts `NaN` and gives `7`. | `countMayBeNaN` in `compiler-type-facts.ts`, `compile-user-functions.ts`, `python-target.ts`; `jsClauseParamGuard` in `compile-definitions.ts` · `[]`/whole list/`ValueError` (a NaN count is outside `integer`; an interpreter-unevaluated form is allowed) · ~60-100 · take-drop-negative-count (35, shared with 33651c6b1) · crafted (NaN count). The `jsClauseParamGuard` NaN rule is a documented ERROR-MODEL decision; flag. |
| f169546e9 (d) | 2026-10-30 | Boolean inputs on broadcast routes; repeated Random() argument evaluated per position | other | `broadcast()` refuses a `boolean` variable (declared type, plain program); `interval-js` reads JS boolean as "maybe"; per-position evaluation of a random argument. | |
| f169546e9 (e) | 2026-10-30 | Unsupplied boolean / absent-operand work in GPU and Python | candidate | `gpuIsWrittenAbsence`, `gpuAbsentArm`, `pythonIsWrittenAbsence`, `pythonSelectionArm`: arms for a written absence (`Missing` literal) in a branch. | `gpu-statements.ts`, `gpu-functions.ts`, `python-target.ts` · wrong arm / `NaN` for a literal Missing · ~150-300 (estimate) · ce-588-if-missing-branch (22) · crafted (CE-588 `If` with a literal Missing branch). |
| 17ba3b407 | 2026-10-30 | Python: classify Block-local reads, enforce assignment | decline + candidate | (1) A read with no assignment on any path fails to compile (decline). (2) Reads assigned on some paths only get a run-time check: `read-before-declaration` throw on JS and interval-js, `_ce_unset(name)` on Python. | (2): `compile-locals.ts` (read classification ~l.841-1500 and `PYTHON_UNSET_HELPER`), `compile-blocks.ts`, `isUnsetLocalRead` in `compile-absence.ts` · removal leaves `undefined`/0/earlier value on JS; example gave `s = 6` where interpreter gives 0, so borderline with `value`: the program has a declared-type input but a valueless local (an error the interpreter reports) · ~400-700 (estimate) · ce-636-block-local-without-value (28), function-body-local-assignment, ce-583 · CE-636, crafted. |
| 32096f0bd | 2026-10-30 | GLSL/WGSL: inline call returning coordinate of point-or-list symbol | other | Replaces a decline by inlining the body of `f(t) := At(P, 1)`. Tycho row 479 (corpus). | |
| 33651c6b1 (a) | 2026-10-30 | Block-local comparisons use the simple sound rule; `If` takes no branch when undecided | candidate | A comparison of a `Block` local tests every input the block reads; an undecided `If` condition gives no value for the whole run. | `compile-absence.ts` (`localDependsOnInputs`, `findDependentLocals`, `blockInputs`, `mayReturnFunction`, `hasEffectNode`, `poisonSlot`) · `NaN`/`undefined` (input left out) · ~600-900 (estimate) · ce-631-633 (86), compile-subtree-folding · "user decision 2026-10-30"; crafted/plausible. Same mechanism as the unsupplied comparison group. |
| 33651c6b1 (b) | 2026-10-30 | A function assigned again inside a Block is called with its new value | value | `gg := t -> t+1` then `Block(gg := t -> t+10, gg(1))` gave 2, must give 11. | |
| 33651c6b1 (c) | 2026-10-30 | A list with no value no longer makes compiled code throw (Take/Drop/First/Max/...) | candidate | Absent list operand guards: `Take(L, k)` with `k` unsupplied; `First`, `Max`, `Length` of an absent list. | guards in `compile-absence.ts`/collection lowering (`isOmittableRead`, `absenceKind`); `compile-absent-collection-operand` tests · `TypeError` throw or `[]` (input left out) · ~200-400 (estimate) · compile-absent-collection-operand (24), take-drop-negative-count (35) · crafted. |
| 33651c6b1 (d) | 2026-10-30 | Chain in `If` condition evaluated pair by pair (interpreter) | other | Interpreter change in `control-structures.ts`/`relational-operator.ts`; compiled code agrees. | |
| 797aa8b3f | 2026-10-30 | Unsupplied collection input gives no value at entry | candidate | `Sum(L)`, `Length(L)`, loops over `L` threw `TypeError` at `run({})`; now returns `NaN`/`undefined` before any code runs (`checkEntry`, `entryNoValue`, `requiredInputAbsent`; Python `pythonNoValueGuard`, `pythonAbsentInputTest`). | `javascript-runtime.ts` (`entryNoValue` ~l.8060, `checkEntry` ~l.7570-8100), `javascript-target.ts`, `broadcast.ts` (`requiredInputAbsent` l.175), `python-target.ts` (~l.8162) · a `TypeError` throw (input left out; allowed) · ~800-1100 (estimate) · compile-absent-collection-input (24), compile-static-width-components, pointlist-compile-zip · crafted (`run({})`); doc `docs/plans/2026-10-30-loop-domain-no-value.md`. |
| 46a00171a (a) | 2026-10-30 | interval-js: loop over list input | value | Loop wrapped each element as an interval again, giving a string `"5[object Object]..."` and `empty` per element for supplied `L`. | |
| 46a00171a (b) | 2026-10-30 | interval-js: absent collection input gives `empty` | candidate | Entry test that returns `empty` when the caller leaves out a collection input. | `interval-javascript-target.ts` entry test, `base-compiler.ts` · `entire`/`undefined` (input left out) · ~40 · compile-interval-loop-list-input (14, shared), compile-interval-collections · crafted. Same group as 797aa8b3f. |
| 524bfb81c | 2026-10-30 | interval-js: loop over Range with input bound (CE-655) | value | Range length computed by plain arithmetic on interval bounds; gave point `0` for `Range(1, n)` at n=3. | |
| d4e28ec11 | 2026-10-30 | JS: `vars` entry `_.name` gets entry checks of an unmapped input | candidate | The entry checks (absent input) also apply to a `vars` entry spelled like the default. | `javascript-target.ts` (16 lines) · `TypeError` throw (input left out) · ~16 · compile-absent-collection-input (+33 lines) · crafted. Same group as 797aa8b3f. |
| 66b32751f | 2026-10-30 | interval-js: Range with computed bound has a value when length is known | other | Replaces `entire` (sound enclosure) by narrower enclosures. | |
| 70f7d9554 | 2026-10-30 | interval-js: loop over literal List, Tuple or Map compiles | other | New capability; removes a decline. | |
| 5bece6167 | 2026-10-30 | interval-js: Linspace compiles | other | New lowering; removes a decline. | |
| aac429bdd | 2026-10-30 | interval-js: shared list inputs for `broadcast()` | other | New capability (broadcast accepts a list input). Tied to CE-678. | |
| 0c1adc21a (a) | 2026-10-30 | CE-658/CE-661 point coordinates; `point-value-inlining.ts` | other | New file; inlines a point value, family count; engine evaluation changes in `boxed-function.ts`, `collections.ts`. | |
| 0c1adc21a (b) | 2026-10-30 | CE-619: GLSL/WGSL keep NaN guard for operands that can overflow f32 | value | `sin(Hx)` with `H: real<0..1e30>` called the built-in with `+inf`; Apple GPUs give 0, helper gives NaN. Plausible witness with declared-type inputs. | |
| 0c1adc21a (c) | 2026-10-30 | CE-618 cell product operands evaluated once | value | Evaluation count of operands. | |

Tag counts by commit (a commit with several parts is counted once, under the parts' union): other 9 (f80301037, 32096f0bd, 66b32751f, 70f7d9554, 5bece6167, aac429bdd, 0c1adc21a, plus parts of f169546e9/33651c6b1), value 4 pure (524bfb81c; parts elsewhere), mixed 5 (f169546e9, 17ba3b407, 33651c6b1, 797aa8b3f, 46a00171a), candidate-only 1 (d4e28ec11).

### Candidates

- **Unsupplied input gives no value (comparison, connective, `If`, chain)**: f169546e9 (b), f169546e9 (e), 33651c6b1 (a). HEAD: `compile-absence.ts` (`unsuppliedComparisonGuard`, `mayBeUndecided`, `conditionDecidability`, `noBranchValue`, `localDependsOnInputs`, `findDependentLocals`), `gpu-statements.ts` (`gpuIsWrittenAbsence`), `python-target.ts` (`pythonIsWrittenAbsence`). Removal leaves a `false`, a wrong branch arm, or `NaN`/`undefined` for an input left out. About 1500-2500 src lines (estimate). Tests: ce-588 (22), ce-631-633 (86), compile-three-valued-connectives (61), compile-notequal-nan (19), compile-equality-exact (22). Witness: "user decision 2026-10-30", crafted/plausible. Caution: a `corpus`-relevant case needs the branch to stay correct for supplied inputs and `NaN` operands (`Less(NaN, x)` is `false`). Overlaps ERROR-MODEL.md "An unsupplied variable".
- **Absent list/collection operand and entry checks**: 33651c6b1 (c), 797aa8b3f, 46a00171a (b), d4e28ec11. HEAD: `javascript-runtime.ts` (`entryNoValue`, `checkEntry`), `javascript-target.ts`, `broadcast.ts` (`requiredInputAbsent`), `python-target.ts` (`pythonNoValueGuard`, `pythonAbsentInputTest`), `interval-javascript-target.ts`. Removal leaves a `TypeError` throw or `undefined`/`NaN`/`entire`. About 1000-1500 src lines (estimate). Tests: compile-absent-collection-input (24), compile-absent-collection-operand (24), compile-interval-loop-list-input (14), take-drop-negative-count (35). Witness: crafted (`run({})`). The decline when a collection has no static shape stays. Overlaps CE-712 steps 3 to 5 for the shape tests.
- **NaN count / NaN at numeric parameter**: f169546e9 (c). HEAD: `countMayBeNaN` (`compiler-type-facts.ts`, `compile-user-functions.ts`, `python-target.ts`), `jsClauseParamGuard`. Removal leaves `[]` or a Python `ValueError` for `Take(xs, NaN)`. About 60-100 lines. Tests: take-drop-negative-count (35). Witness: crafted. Flag: the `NaN`-at-parameter rule rests on an ERROR-MODEL decision (2026-09-30).
- **Block local read with no value**: 17ba3b407 (part 2). HEAD: `compile-locals.ts` (`read-before-declaration`, `_ce_unset`, `PYTHON_UNSET_HELPER`), `isUnsetLocalRead` in `compile-absence.ts`. Removal leaves `undefined`/0/earlier value for a read of a valueless local. About 400-700 lines (estimate). Tests: ce-636-block-local-without-value (28). Witness: CE-636, crafted. Borderline: the example gives 6 where the interpreter gives 0, so the orchestrator may tag it `value`. The compile-time decline (a read before any assignment) stays.

## Batch 7 classification

Counts are estimates from `git show --stat` and diff reading; I ran no tests. HEAD = 1a0d0d427.

| hash | date | subject | tag | what it handles | for candidates: HEAD location · removal leaves · src lines · tests · witness |
|---|---|---|---|---|---|
| 9a96a4028 | 2026-10-30 | CE-684..688: GPU splat reductions, point-list types, draw order, Break check | value; decline; other | CE-684 splat reduction gave `y` for `3y`; CE-686/687 real-guard skipped a `Random()` draw; CE-688 Break after Continue gave 3 for 1 (declines now); CE-685 `freeSymbolTypes` for point lists; `shared-impure-operand` decline. Its `callerCode` test in `realOperandGuard` belongs to candidate group A. | |
| b7c343f07 | 2026-10-30 | Fix #497: CSE and hoist admit Function literal with typed parameter | other | CSE eligibility walk skips the parameter operands of a `Function` literal (a missed optimization, GitHub #497). | |
| 00e6b2c56 | 2026-10-30 | Caller code counts as an effect (real-operand guard, GPU splat repeat) | candidate | Treats `vars` source and `functions`/`operators` code as an effect so the guard and the splat repeat evaluate it once, in order. | Group A · see Candidates |
| c95da4d96 | 2026-10-30 | Add Composition(f, g, h) (#495, PR #496) | other | New operator `Composition` with compile support on every target. | |
| de18aed06 | 2026-10-30 | Fix #488: parameter declared any/expression/value receives a collection whole | value; decline | `f([[0,0],5])` gave `[[0,0],0]`; a function with such a parameter now treats the collection whole, or declines on the callback path. Overlaps CE-712 (run-time tests on `any` parameters). | |
| afbcdfc3e | 2026-10-31 | CE-684..688 follow-ups: GPU positional reads, chains, caller code, real-only kernels, statistics, solvers | value; decline; other; candidate (parts) | Value fixes: negated chain parentheses, multi-clause GPU `Loop`, tuple free symbols, point-list locals, real-only `_SYS` kernels at a complex count, chain edge order. Non-compiler parts: statistics, `assume`, solvers, `Limit`/`Integrate` variable. Candidate parts: caller-code handling (compile-absence, compile-operators, compile-folding, gpu-draw-order, gpu-statements) and the `Missing` path of GPU positional reads. | Group A and Group B · see Candidates |
| 16b688765 | 2026-10-31 | A partial application of a function literal compiles where it equals the interpreter | other; decline | New `partial-application.ts` compiles curried calls with literal arguments; Python declines a call that raised `TypeError`. | |
| 545deb5e0 | 2026-10-31 | GLSL/WGSL: prove loop indexes, user calls, cos divisors finite | other | A finite-value proof removes guards and keeps the shader smaller (Tycho row 480). A performance change. | |
| 1a95a7f6d | 2026-10-31 | Fix #488 follow-ups: list join, Product of reassigned variable, linear CSE walks | value; other | Types a block local's list rank, keeps `Product(x)` for a changing `x`, and memoizes CSE walks (performance). | |
| ba174fb6c | 2026-10-31 | Fix #488 follow-ups: compiled values for collections at open-typed inputs | value; decline; candidate (part) | Fold with a list accumulator, Python declines, JS declines input `expression`, `Sum`/`Product` over `any`. Candidate part: `callResultGuard`, a run-time `Array.isArray` test on an untyped input. | Group C · see Candidates |
| a13a1e08d | 2026-10-31 | CE-708: a curried function is the deferred call of the original | other; value | Redefines currying in `function-utils.ts` and effects inference; the compile side shrinks. | |
| 6195cec92 | 2026-10-31 | Compiled code: expression with sub-expression of static type error declines | decline | Adds `compile-static-type-error.ts`. | |
| 5f44931f4 | 2026-10-31 | Compile: applied literal's bare parameter takes its collection argument's type (#498) | value | A bare parameter of an applied function literal gets the element type of a collection argument (GitHub #498). | |
| 8c94c065f | 2026-10-31 | CE-715 step 1: bigint compile mode accepted on JavaScript target | other | New `mode: 'bigint'`; every compilation declines with `bigint-lane` until step 2. | |
| df8ea31ad | 2026-10-31 | CE-715 step 2: the bigint lane analysis | other | New `compile-bigint-lane.ts` (about 2125 lines); declines when the lane rule fails. | |

### Candidates

Counts of commits per tag, by the main tag: value 4 (de18aed06, 1a95a7f6d, 5f44931f4, 9a96a4028), decline 1 (6195cec92), other 7 (b7c343f07, c95da4d96, 16b688765, 545deb5e0, a13a1e08d, 8c94c065f, df8ea31ad), candidate 3 (00e6b2c56, afbcdfc3e in part, ba174fb6c in part).

- **Group A: caller-supplied code treated as an effect** (00e6b2c56, parts of afbcdfc3e and 9a96a4028). Code: `reachesCallerCode`/`reachesCallerCodeOn` and `isShaderVariableRead` (`compile-folding.ts`, 579 and 679); callers in `compile-absence.ts` (`operandHasEffect`, `absenceCallerCode`, `isTestedInputRead`), `compile-operators.ts` (chain `callerCode`/`capture`), `compiler-core.ts` (`realOperandGuard`, `hiddenEffect`), `gpu-extrema.ts` (`gpuRepeatableSource`), `gpu-draw-order.ts` (about 350 lines added by afbcdfc3e, part of it for random draws, which is not a candidate), `gpu-statements.ts`, `gpu-random.ts`, `python-target.ts`, `interval-javascript-target.ts`. All still at HEAD. Removal leaves: caller code run twice, skipped or reordered, which gives a wrong value only when the caller's `vars` entry has a side effect (`nextValue()`, `_.draw()`); the shader targets could decline instead. Not an allowed difference in the caveats, so a decision is needed: either a known-limitations line or a decline. Src lines: about 600 (rough estimate, not counted). Tests: `random-compile.test.ts` (about 33 caller-code tests), `compile-gpu-extremum.test.ts` (about 20 of 52 mentions), `compile-cse.test.ts`, `cse-harvest.test.ts`. Witness: `vars: { W: 'nextValue()' }` and `'_.draw()'`; strength crafted.
- **Group B: `Missing`/`Undefined` operand on GPU positional reads** (afbcdfc3e). Code: the `Missing` branch and the `missing`-arm union branch of `compileGPUPositional` (`gpu-functions.ts:409`), at HEAD. Removal leaves: a decline from `At` (the absent base). About 40 lines. Tests: `compile-gpu-at-point-list.test.ts` (21 tests, only a few touch the absent case). Witness: `Third` of a list of 2 points, `At(P, k)` with `P` a list of points that can be absent; crafted. Small and borderline: the past-the-end case with a declared `list<real^2>` input is a plain program, so keep that part.
- **Group C: run-time shape test on a call result** (ba174fb6c). Code: `callResultGuard` and `mayHoldCallBroadcastResult` (`Array.isArray(_tv) || _tv === undefined`, `compile-expr-handlers.ts`). Already removed at HEAD by CE-712.2 (450e1ad49). Same commit, still at HEAD and overlapping CE-712 steps 3 to 5: `declaredTopGuard` (`compile-expr-handlers.ts:188`, a run-time test for an input declared `any` or `value`) and the `Sum`/`Product` guarded fold over `any`. Their witness is GitHub #488 follow-ups, found in review with an untyped or `any` input; plausible at most. Tests: `compile-call-broadcast-result-operand.test.ts` (12), `compile-expression-declared-input.test.ts` (10). A decline stays for `any`, per AGENTS.md ("an input typed `unknown` or `any` is refused").

Note for the orchestrator: the large `compile-absence.ts` mechanism (3314 lines at HEAD, unsupplied-input comparison guards) was created before this batch; afbcdfc3e only extends it for caller code (about 164 lines added). I did not size the base mechanism.

## Batch 8

| hash | date | subject | tag | what it handles | candidates: HEAD location · removal leaves · src lines · tests · witness |
|---|---|---|---|---|---|
| 4d6479dee | 2026-10-31 | CE-717.6/.7: compiled code fills parameter default values (#490) | other (+ candidate part) | Default parameter values on all targets | Part: byCount fill, see group B |
| e6bff856b | 2026-10-31 | CE-715 step 3: bigint emission | other | New bigint compile mode emitter | |
| 39e19ff3b | 2026-10-31 | exact size estimates for integer powers and binomials | other | Interpreter size-limit estimates, shared with bigint helpers | |
| 26c2714e2 | 2026-10-31 | CE-715 step 4: boundary of the bigint compile mode | other | Input lift, single catch, opt-in entry checks for bigint mode | |
| 5b60e6081 | 2026-10-31 | CE-712.1: R1 untyped-input and R3 settled-shape admission | decline | Declines untyped inputs and unsettled shapes (compile-admission.ts) | |
| fed5b1762 | 2026-10-31 | CE-727: dictionary hook of CompileTarget | other | Type member | |
| 9dcd0a9aa | 2026-10-31 | CE-727: dictionaries compile on JS and Python | other | Dictionary values (declines on GPU/interval) | |
| 8ce5abc8b | 2026-10-31 | CE-715 step 5: constant folding in bigint mode | other | Exact constant folding, pole throw for non-finite constants | |
| 4d746e6b7 | 2026-10-31 | CE-726: function-valued root for interval-js can be called | other | `calling: 'lambda'` for interval-js | |
| 75116a0d8 | 2026-10-31 | user name equal to reserved emitted name is renamed | value | `(n,_upper)=>Sum(k*_upper..)` gave 18 for 60 | |
| eccfec7a8 | 2026-10-31 | CE-712.1 review fixes: dictionary values, Which, Python loops | decline | Admission walks dictionary values; Which keeps operands; Python Return in Loop | |
| caa2192c3 | 2026-10-31 | CE-732: JS-reserved binding names renamed | value | `arguments`, `Math` etc. as binding names gave syntax error or wrong result | |
| 783efd4f4 | 2026-10-31 | CE-715 step 6: docs and spec tests of bigint mode | other | Docs, MCP option, tests | |
| d62a7698f | 2026-11-01 | fixed emitted names _f,_v,_c,_pt,result,_r are reserved | value | User binding hid emitted helper name (wrong/thrown) | |
| e3cea713d | 2026-11-01 | compiled Sum/Product whose body writes its index | candidate | Body writing the loop index: separate counter on 5 targets | Group A |
| c67baf167 | 2026-11-01 | destructuring Declare repeating a name binds the last position | candidate | `Declare(Tuple(a,a),...)` emitted `let a; let a` | Group C |
| 450e1ad49 | 2026-11-01 | CE-712.2: call selects variant from static argument type | other (+ candidate part) | Removes run-time bcastFn/callResultGuard; static variant choice; unsettled-shape decline | Part: absent-argument routing, see group D |

### Candidates

- **Group A: Sum/Product body that writes its own index** (e3cea713d). Code: `writesSymbol` plus counter/`declareIndex` logic. At HEAD: `compile-loops.ts` (`writesSymbol` line 578, use at 1760), `javascript-target.ts` (17744, 17901), `interval-javascript-target.ts` (4755), `python-target.ts` (1674), `gpu-functions.ts` (1189). Removal leaves: a decline (the state before the commit; a wrong finite value or endless loop if the check is dropped, so replace by a decline, do not delete). Src lines: about 150 of the commit's 300 (5 targets); net saving after a decline check, roughly 120. Tests: `test/compute-engine/compile-sum-product.test.ts` (+329 lines, about 15 tests, estimate), part of `ce-732-reserved-binding-names.test.ts` (50 lines changed). Witness: `Σ_{j=1}^{n} (j ≔ j + 1; j)` at n=4 is 14; crafted (no Tycho row or issue named).
- **Group B: default parameter filled by argument count to keep a supplied `Missing`** (part of 4d6479dee). Code: `parameterCanBeMissing`, `DefaultFill.byCount`, `defaultFillingWrapper` rest-argument branch (`compile-parameter-defaults.ts`), the byCount branch in `javascript-target.ts` (about 12353-12420) and uses in `compile-function-literals.ts` (660-762) and `compile-callbacks.ts` (1526-1584). All exist at HEAD. Removal leaves: a native JavaScript default parameter, so an explicit `undefined` (interpreter `Missing`) gives the default instead of `Missing` (allowed: value where the interpreter has `Missing`). Src lines: about 80 (estimate). Tests: `compile-parameter-defaults.test.ts` (613 lines; about 3 tests mention `Missing`: lines 94, 113 and neighbours). Witness: spec for #490 / CE-717.6; crafted (type `number | missing` or an untyped parameter with an explicit `Missing` argument). Note: an untyped parameter has type `unknown`, which holds `missing`, so most default parameters without annotation take this path today.
- **Group C: destructuring Declare with a repeated name** (c67baf167). Code: `keepLastOccurrence` in `desugarPatternDeclare`, `compile-declarations.ts` lines about 1137-1158 at HEAD. Removal leaves: `let a = 1; let a = 2` (SyntaxError at load) where the interpreter gives a value, so replace by a decline of a repeated name (about 10 lines) rather than delete. Src lines: about 38, net about 28. Tests: `compile-declare-pattern-repeated-name.test.ts` (162 lines, about 8 tests, estimate). Witness: crafted; the commit says only MathJSON input can have it, the Epsil parser rejects such a pattern.
- **Group D: absent (`Missing`) argument routing for point/list callbacks** (part of 450e1ad49; same mechanism as earlier absent-value commits in other batches). Code: `absentGuardedValueRef`, `absentArgumentFork`, `admitsAbsentAtMappedLevel`, `absentPointType` (about 40 added lines mention them in the commit). At HEAD: `compile-callbacks.ts`, `compile-function-literals.ts`, `compile-point-calls.ts`, `compile-user-calls.ts`, `compile-user-functions.ts`, `compiler-core.ts`. Removal leaves: a decline for a value that may be absent at an untyped parameter, or a throw (`Length(undefined)`) or `NaN` (allowed). Src lines: about 250 at HEAD (rough estimate; not measured). Tests: `ce-712-2-review-round2.test.ts`, `absent-argument-annotated-parameter.test.ts`, `absent-point-arithmetic.test.ts`, `tuple-argument-binding.test.ts` (counts not measured). Witness: `Map(fl, [(1, 2), Missing])` is `[2, NaN]`; crafted. Overlaps CE-712.2/712.3 (static-shape plan). The commit message says "the routes where that is not proved sound decline", so a decline already exists as the fallback.

Notes: the reserved-name commits (75116a0d8, caa2192c3, d62a7698f) fix wrong finite values or thrown/syntax errors for plain programs with declared inputs, so they are `value`. Their witnesses are partly crafted (`_upper`, `_SYS` as user names); `arguments`, `class`, `let`, `Math` are more plausible names. Under the "crafted witness resolves with a decline" rule a decline for reserved names would be a possible simplification, but I tagged them `value` as the brief requires.

| hash | date | subject | tag | what it handles | candidate details |
|---|---|---|---|---|---|
| 5d517c4af | 2026-11-01 | Python declines an operator name used as a value | decline | Python target emitted a bare name (NameError) or a JS lambda for `Head(List(1))`-style operator symbols; now declines | - |
| c4e0a3bdb | 2026-11-01 | Complex value at a real-compiled parameter restarts in complex mode | value | Block-local/engine function with declared complex point args gave "[object Object]" strings; auto restarts in complex, strict declines | - |
| a200686b7 | 2026-11-01 | Generic Sum/Product loop of a custom target compiles symbolic bound | value (+decline) | Symbolic bound gave 50015001 instead of 10; now compiled as expression; declines impure/infinite/non-integer bounds | - |
| de3e6a689 | 2026-11-01 | Sum/Product reads a bound naming its index; declines bound with effect | value (+decline) | `Sum(j, Limits(j, j, 5))` threw ReferenceError / read wrong counter; separate counter; effectful bound declines | - |
| 1dc24d9de | 2026-11-01 | Multi-index At as nested reads; destructuring let in loop body | other (+decline) | New compile of `At(R,1,2)`, destructuring let on Python/GLSL/WGSL; declines a pattern reading its own names (JS gave 6 for 300) | - |
| 532df8add | 2026-11-01 | Lane check of user-function call runs after the inline step | other | Refinement of c4e0a3bdb: inlined calls compile again in strict mode; run-time-dependent mismatch left unchecked | - |
| d1f28962f | 2026-11-01 | A Loop whose value is used declines on every target (CE-750) | decline | Loop value (Nothing/Break value) had no form; gave undefined/None; now declines `loop-value` | - |
| 03210915e | 2026-11-01 | CE-139 D/Integrate over list binding; CE-670 failed list cell | decline (+other) | Compiled JS declines D/Integrate over a list binding (gave NaN); CE-670 is non-compiler evaluation change | - |
| 4d4ae1926 | 2026-11-01 | Point at open inferred-type parameter uses one-point function | value (+decline) | `gm=(p)->Max(p)+1`, `gm(P[1])` gave NaN instead of 3; non-JS targets and possibly-absent callback point decline | - |
| aaccfcf04 | 2026-11-01 | CE-725: Sort callback, Iterate, Pipe compile on JS; literal complex lane mismatch | other (+value) | New JS lowerings; applied literal with complex arg (`Apply(x->2x, sqrt(y))`, y<0) gave NaN, now lane mismatch | - |

### Candidates

None. I found no code added only for a case the caveats now allow. The nearest cases:
- 532df8add leaves "a mismatch that depends on the value at run time" unchecked. It removes a check and adds none, so it is not a candidate.
- 4d4ae1926 and c4e0a3bdb handle declared-type inputs: points with open inferred types, and declared complex coordinates. Both give wrong finite values or wrong shapes without the fix, so they stay `value`.
- None of the ten commits adds an absent-input test, a `Missing`/`Nothing` match, or a run-time shape test. The diffs of c4e0a3bdb and aaccfcf04 contain `!== undefined` tests, but these are on compile-time `Type` values, not on run-time input values.
- Overlap with CE-712 steps 3 to 5: I saw none in these ten commits.

