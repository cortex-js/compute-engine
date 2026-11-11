# Phase E triage: the full suite with `_bindingUnits = true`

Input: `flagon3.log` (default reporter, killed at 12 min): 757 failing tests in 251 files, plus three files that never finished. Worktree `/tmp/wt-ce-1d-flagon`, detached at c766fc4927a2d25d92bd657715178ff9f446df60.

## Where the counts come from

- **From the log.** The 757 tests and their files: `tri/fails.json` (parsed from `flagon3.log`).
- **From a run.** A rerun of the 251 failing files had both experiments on (`TRI_WT=1 TRI_TZ0=1`, see "The three hangs"). Log: `tri/runx.log`; 688 tests failed.
  - It fixed 70 of the 757 tests. A second run of those files with `TRI_WT=1` alone fixed 62 of the 70, so 62 are DEF-NESTED-WRITES and 8 are DEF-OPTOKEN.
  - It gave one new failure, a weak-reference size bound in ce-1102, which is not counted here.
  - The three hang files pass under both experiments: 25 + 58 + 7 tests (`tri/hangx-*.log`). These 90 tests are not in the 757.
- **From four triage subagents.** The other 532 tests were classified by four agents, one per chunk. Each agent read the test source and, for a sample, ran a fresh-engine probe with the flag on and off and with the toggles (`tri/out1..4.json`, with a `why` per test).
  - About a third of their assignments were made from the failure text and the test source, without a probe. The `why` field says "not probed" for these.
  - About 10 of the DEF-NESTED-WRITES tests and 8 of the DEF-OPTOKEN tests were assigned by agents, not by a run. Counts per class are therefore exact for "from a run" and best effort for the rest.
- Per-test data, with the class and the reason: `tri/final.json`. The builder is `tri/final.mjs`.

Experiments left in the worktree, all gated by environment variables or inert:
- `engine-boxing-state.ts`: `TRI_WT` (a nested operation writes in the enclosing operation's environment) and `TRI_TZ0` (operation token always 0).
- `compile-admission.ts`: `TRI_DBG` tracing.
- `implicit-compile.ts` and `nonlinear-fit.ts`: logging behind `globalThis.__fitLog`.
- `object-deps.ts`: counters behind `globalThis.__depStats`.

## The three hangs

1. **`find-fit-global-grid` and `find-fit-pool`: DEF-NESTED-WRITES. The time limit is not the cause.**
   - `prepareUnitSteps()` (`nonlinear-fit.ts:747-750`) makes the fresh names with `ce.symbol()` inside the FindFit operation, then calls `modelExpr.canonical.subs(rename).canonical`.
   - `subs()` is a nested operation. The requirements written while it rebuilds `Multiply`/`Cos`/`Add` over the fresh names go into the nested environment, which `writableOperation()` (`engine-boxing-state.ts:150-157`) creates lazily and drops at exit (`_push`, :195). No symbol of the result points to that environment.
   - The fresh names are therefore `unknown` when `ce._compile` reads them (`untypedInputsOf()`, `compile-admission.ts:178`). The compile declines with untyped-input, and the fit runs every step through `subs()` + `N()`.
   - Measured on 20 points: 38 ms with the flag off, 3,502 ms with it on, 63 ms with `TRI_WT=1`. The tests use 200 to 1,000 points.
   - Rule 8 does cover the compilation, which is why the step-1 diagnosis was right as far as it went. Rule 8 does not keep the requirements of a nested operation that wrote about symbols the nested operation did not make.
   - Fix I would make: a nested operation writes in the environment of the operation it is nested in. The experiment does this with a write-through to the nearest operation that has an environment; it is equivalent to merging at exit.
   - Verified: with `TRI_WT=1` alone, `find-fit-global-grid` passes 58/58 in 6.7 s. With both toggles, `find-fit-pool` passes 25/25.
   - Size S. It also fixes 62 other tests, mostly compiled integrals and GPU calls.
   - Repro: `ce._withOperation(m, () => ce._compile(m.canonical.subs({a: ce.symbol('q0'), x: ce.symbol('w0')}).canonical, {fallback:false}))` declines with "the inputs ... have no type" (`tri/sub.ts`).
2. **`tycho-item-182-facet-probe-storm`: DEF-OPTOKEN, a cache that never hits.**
   - `operationToken` (`engine-boxing-state.ts:18-31`) gives each operation whose environment `hasWrites()` its own id. `hasWrites()` is true through the parents (`binding-unit.ts:127-132`), and the input's unit environments almost always hold writes.
   - Every type or facet memo that reads a free name records the token (`boxed-symbol.ts:990`, `boxed-function.ts:1932`). A memo computed in one `evaluate()` is therefore invalid in the next one.
   - Canonicalizing the head runs many top-level evaluations, so the collection-facet memo that item 182 relies on never hits. This is the storm the test guards against.
   - Measured on the head parse:

     | Setting | Time | Facet computes |
     |---|---|---|
     | flag off | 15 ms | 6 |
     | flag on, 3-element list | over 20 s | 3,236 |
     | flag on, token pinned to 0 | 32 ms | 11 |

     With the flag on, 3,236 facet computes is the count at the 20 s cutoff, and the count does not depend on the list size.
   - With `TRI_TZ0=1` alone the file passes 7/7. `TRI_WT=1` alone does not fix it.
   - Fix I would make: the token must name what a read through the operation can find, not the operation.
     - A nested operation with no write of its own reads what its enclosing operation reads.
     - A top-level operation with no own write reads the meet of its parents, so its token is the identity of its parent set (an interned key of the parents' ids), not a fresh id.
     - Simpler alternative: record the token only when the entry read through the operation differs from `this._env?.lookup()` in `_unitEntry()` (`boxed-symbol.ts:985-996`).
   - My first attempt (nested operations delegate to the enclosing one) was not enough. A second attempt (an interned parent set) made it worse (280k computes), and I did not find why within the time I had. The token = 0 experiment is not sound in general (rule 8 needs a type cached outside an operation to be computed again in it).
   - Size M.
   - Repro: `tri/t182b.ts on 3`, which is the test's `documentState()` with a 3-element `L`, then the head parse.
3. The other unfinished files are the ones that the suite always skips.

## Answer for the "Could not compile: the input has no type" group

121 of the 757 tests carry this message or its GLSL/WGSL form "which has no type in the GLSL fragment".
- **89 are BC1.** A shared engine (`../utils` `engine`, or a module-level engine) where an earlier test typed the input by using it.
  - The probes showed that the same expression, alone in a fresh engine, declines with the flag OFF too. Examples: `GCD(x, 6)`, `Which(t <= 1, (1, 2))` on GLSL, `PointZ(v)`.
  - Remedy: declare the inputs in the file header (most files already declare `x, y, m, n` and miss `t`, `k`, `a`, ...).
- **32 are defects, where the compilation should read the types of its input's occurrences (rule 8) and does not.**
  - **DEF-NESTED-WRITES (10):** the requirement is written in a nested operation inside `compile()`, for example a bound of an Integrate. Repro: `compile(ce.parse('\\int_0^x \\sqrt{1+\\cos(t)^2}dt'))` declines; with `TRI_WT=1` it compiles.
  - **DEF-ADMIT-OCC (15):** the admission takes one occurrence per name (`freeSymbolOccurrence`, `compile-references.ts:1319`) and falls back to `ce.symbol(name)`, which is a new unit (`compile-admission.ts:180-182`). An input that occurs only in an assigned value or a callee body therefore reads `unknown`.
  - **DEF-TARGET-NO-OP (7):** the direct target API (`new GLSLTarget().compile()`) opens no operation, so the nested write of the inlined body is lost even with `TRI_WT`.

## Class table

The counts are over the 757 failing tests of the log. "Files" is the number of distinct test files.

| Class | Tests | Files | Cause | Remedy (phase E) | Size |
|---|---|---|---|---|---|
| BC1 | 359 | 119 | Approved change 1/2. The test reads a name's type through a new unit (`ce.box('x').type`, `ce.symbol('x').type`, a helper that boxes the name), or relies on a shared engine where an earlier expression typed the name. Includes the 89 untyped-input compiles above. | Read the occurrence (`e.op1.type`, or `r.freeSymbolTypes`). Declare the inputs in the header of shared-engine files. Call `ce.infer([...])` where the test is about inference from a use. Per-file remedies: section "BC1 remedies". | L (count), each edit S |
| DEF-NESTED-WRITES | 72 | 24 | A nested operation's requirements are dropped at exit (`engine-boxing-state.ts:150-157, 195`); see hang 1. 62 tests confirmed by a run with `TRI_WT=1`; 10 assigned by agents. | Write through to the enclosing operation. | S |
| OLD-MECH | 43 | 16 | The test checks auto-declaration, narrowing writes, provenance/history of inference on definitions, rollback frames (`inference-rollback`, `static-check-rollback`), or flag-off defaults (`binding-units-core`/`-commit` "without the flag"). | Delete, or rewrite against `ce.infer()` and the environments. | M |
| BC-LOOKUP | 32 | 15 | Approved (decision 6): `lookupDefinition`, `valueDefinition`, `declarations()` and harvest do not see a name that was only boxed. | Assert `undefined`, or declare first. | S |
| DEF-ADMIT-OCC | 19 | 9 | Compile admission takes one occurrence per name and falls back to a new unit `ce.symbol(name)` (`compile-admission.ts:180-185`; `compile-references.ts:1319`). An input that occurs only in a folded value or a body reads `unknown`. | Collect every occurrence, including in stored values and bodies, and meet their types (rule 8). | M |
| DEF-EPSIL-PIN | 19 | 2 | The Epsil static pass relies on `ce.box(name)` declaring a name before it pins a callee (`epsil/static-diagnostics.ts:2425-2450, 2284-2304`). | Declare the name (inferred) in the program scope before the pin, or key the pin on (home scope, name) as rule 10 says. | M |
| DEF-MATRIX-REPAIR | 17 | 4 | The fresh-matrix repair (`validate.ts:6033-6100, 6184`) needs an auto-declared inferred definition to retype. Free names have none, so `Determinant(A+B)`, `Histogram(P_0+0.5, …)` and `LinearSolve(M, A+B)` are invalid. | Redo the repair over the unit's requirements. | M |
| DEF-OPTOKEN | 16 | 10 | Operation token invalidates every memo across operations; see hang 2. 8 tests confirmed by run; 8 assigned by agents from the message. | Token names the content read, not the operation. | M |
| DEF-FREE-CALL-TYPE | 16 | 5 | A call with a free head types `unknown`. Before, it had `(any) -> unknown` with the list lift (`boxed-function.ts` ~7416, `lambdaBroadcastType` ~15925, `isVacuousLiftOperand` ~14690). `Which(L<2, foo(L), True, 0)` puts a list in one cell (a wrong shape). | Give a free call head the rule-2 "function" reading with the lift. | M |
| DEF-LIMIT-FREE-PARAM | 12 | 3 | In a Limit, a free parameter has no number type, so `a - a` does not fold. Direct substitution in `symbolic/limit.ts` (`limitAtFinite`, `isDefiniteValue`) accepts `1/(a-a)` as a definite value, which is a wrong value. | Find where the operation loses the requirement. Separately, `isDefiniteValue` should refuse a `0` denominator that did not fold. | M |
| DEF-STACK | 8 | 7 | Each nested `evaluate()` adds about 5 frames (`boxed-function.ts:5066-5067` -> `index.ts:1739` -> `engine-boxing-state.ts:182, 193`). A deep tree overflows (Horner of degree 155, 340 nested sines), and a recursion of depth 100 hits the guard. Only some of these were checked for depth. | Open the operation without re-entering the public method: an internal evaluate, and push/pop inline. Same site as DEF-OPREENTRY. | S |
| BC-LIBVAR | 8 | 3 | Approved: `N` in `N + 1` has no type until declared. | Update the expectations, or `ce.infer`. | S |
| DEF-TARGET-NO-OP | 7 | 1 | The direct target `compile()` (GLSL) opens no operation (`compile-expression.ts:137` is the only entry that does). | Open an operation at depth 0 of `BaseCompiler.compile`; needs DEF-NESTED-WRITES too. | S |
| DEF-BINDER-SUBST-FREE | 7 | 1 | The known phase-B item (spec section 10): binder and literal-call substitution replace free names (`library/utils.ts`). | The phase-B fix. | M |
| DEF-CAPTURE-FREE | 7 | 1 | `function-literal.ts:1082-1088` skips a captured symbol with no binding. A later string `y` therefore passes the CE-473 check, which is a wrong value (no `incompatible-type`). | Record a free capture by name and resolve it at the check. | M |
| DEF-WITHVALUES | 7 | 2 | `withValuesFn` (`engine-declarations.ts:4286-4292`) calls `ce.symbol(name)` to declare a missing name and then throws "bound to a function definition". `ce.withValues({zz: 7}, …)` throws for every undeclared name. This blocks the checkpoint replacement of rule 13. | Declare the missing name explicitly (`ce.declare(name, {inferred})`). | S |
| DEF-ENVDEPS | 7 | 1 | `UnitEnvironment.lookup()`/`_lookupNearest()` record the environment's counter (`binding-unit.ts:169, 200`). The counter moves later in the same operation, so the memo is stale at birth: the derivative memo recomputes on every `evaluate()`. `TRI_TZ0` does not fix it. | Do not record a read of the environment of the operation in progress, or stamp at exit. | S-M |
| DEF-FREE-HEAD-D | 7 | 1 | `D` of a call with a free head does not read a later data declaration of the head (a rule-7 site). | Test `isFreeName()` and resolve in context. | S |
| DEF-FREE-HOME-SCOPE | 8 | 4 | A free name made inside a scope pushed by an operation (solve's `_x` scope, a host `pushScope`) gets another home scope. `sameBinding()` (`compare.ts:121-127`) then says "not the same": an extra explain step, `x + 100x`, extra roots. | Home scope = nearest ancestor with no binding of the name, or compare resolved home scopes. | M |
| DEF-FREE-NAME-CAPTURE | 6 | 3 | A free name in a stored value (`a := x + 1`) resolves from the current context, so `Block(Declare(x, real, 7), a + 5)` gives 13, not 106. Rule 3 as written allows this. | Needs a decision: does rule 3 skip Block locals the way it skips binder variables? | S once decided |
| DEF-DYNAMIC-RESOLUTION | 4 | 4 | The per-member scope of a union-shape compile (`compiler-core.ts:640-647`) is visible to the body of a stored function, which reads the current context and not its lexical scope. | Resolve body names in the body's scope. | M |
| BC-HELD | 4 | 3 | Approved (decision 6): a held expression reads a later declaration, or is not narrowed by an operation on it. | Update the expectations. | S |
| DEF-FREE-BOUND-SAME | 4 | 2 | A function body's `a` has a definition while the argument `a` is free, so `isSame` is false: `Apply(Function(a*x, x), a)` gives `a*a`, not `a^2`. | Rule-7 `sameBinding`: a free name and a resolved occurrence of the same name and home scope. | M |
| DEF-BLOCK-LOCAL-CALL | 4 | 1 | The interpreter gives `incompatible-type` for `Block(Declare(k, integer, 2), p((x, 1)) + k)` with a global `k := i`. Probably the same root as DEF-FREE-NAME-CAPTURE. | Not located. | M (estimate) |
| DEF-LISTREC-SELFREF | 4 | 1 | The self-call `F` in a body boxed before the assign is a free name, so the list-recursion recognizer does not see `F`. | Not located; likely a rule-7 site in the recognizer. | M (estimate) |
| DEF-MEMO-STORED | 3 | 1 | The memo of a symbol holding a stored chain never hits (292 evaluations, fewer than 56 expected); neither toggle fixes it. | Not located; possibly DEF-ENVDEPS. | M (estimate) |
| DEF-OPREENTRY | 3 | 1 | `_withOperation(this, () => this.evaluate(options))` calls the public method a second time, and the spy counts 2. | Same fix as DEF-STACK. | S |
| DEF-DECLUNKNOWN-TYPE | 2 | 2 | A name declared `unknown` reads its unit's requirement (rule 4), and the result type gets worse: `P[i]` is `any`, not `unknown`; `Add(Tuple(1, 2), q)` is `error`. An undeclared name gives `unknown` / `number \| tuple`. | Make the declared-unknown read match the free-name read. | S-M |
| DEF-DESTRUCTURE-LET | 2 | 2 | Epsil `let (a, b) = …` declares nothing, so a later `a = …` in a loop is `first-assignment-in-branch`. | Declare the destructured names. | S-M |
| DEF-RECURSION | 2 | 2 | Unbounded recursion, not depth: a 4x stack still overflows (`ce-604`, `recursive-lazy-callback`). | Not located. | M (estimate) |
| DEF-INTEGRATE-POLE | 2 | 1 | `\int_0^1 1/(t+a^2+1) dt` stays unevaluated, also with `a` declared. | Not located. | ? |
| DEF-ENUM-FREENAME | 2 | 1 | `isEnumerableCollection` reads the definition, not the occurrence. | Read the occurrence. | S |
| BC-NARROWINGS | 2 | 1 | Approved change 5: `narrowings()` reports nothing. | Update the expectations. | S |
| DEF-LIB-AUTODECL | 1 | 1 | GroupBy detects a mistyped key with `lookupDefinition(...).inferredType` (`collections.ts:26533`). | Also treat "no definition" as unknown. | S |
| DEF-TELESCOPE | 1 | 1 | `Sum(g(k+1) - g(k))` with a free `g` does not telescope. | Not located (a rule-7 site). | S-M |
| DEF-SYMBOL-LITERAL-INPUT | 1 | 1 | The default symbol `Auto` of an optional typed parameter is a free name, and compile takes it as an input. | Do not count a symbol literal in a `symbol<…>` slot as an input. | S |
| DEF-FIRST-ASSIGN-FREE | 1 | 1 | `Assign(x, 1)` in a branch is `first-assignment-in-branch` because a free `x` is not declared. | Needs a decision: does a free name count as declared for this check? | S |
| DEF-RSOLVE-NOTCANON | 1 | 1 | `RSolve(a(n+n+1) = a(n), a, n)` throws `Not canonical` (`boxed-function.ts:4321`). | Not located. | S-M |
| DEF-EPSIL-PARAM-NAMES | 1 | 1 | A named call to `f := (a, ...rest) => …` reports "no declaration with parameter names". Same family as DEF-EPSIL-PIN. | With DEF-EPSIL-PIN. | S |
| BC-RULE4 | 1 | 1 | Approved rule 4: a name declared `unknown` reads its requirement (`Remainder(remU, 3)` is `integer`). | Update the expectation. | S |
| BC-RULE7 | 1 | 1 | Approved rule 7: two free names with the same (home, name) are the same binding (`ce-107`). | Update the expectation. | S |
| UNCLASSIFIED | 34 | 27 | Listed below. | | |
| **Total** | **757** | | | | |

Also: 90 tests in the three hang files (not in the 757): DEF-NESTED-WRITES (fit, 83) and DEF-OPTOKEN (item 182, 7).

## BC1 remedies, by kind

- **Read the occurrence instead of a new boxing.** The occurrence has the expected type with the flag on; the agents checked this for `use-driven-element-inference`.
  - Files: `ce-39-literal-cell-types`, `use-driven-element-inference`, `parameter-index-read-inference`, `resolve-symbol-facts`, `juxtaposition-narrows-type`, `boxing-deep-trees`, `tycho-item-258`, `type-variables`, `error-model*`, `character-string-operators`, `fractals`, `generic-signature-inference`, `inference-type-refresh`, and most one-test files whose `src` is `ce.box('name').type`.
- **Declare the inputs in the header of a shared-engine file.** The same expression declines with the flag off in a fresh engine.
  - Files: `compile-absent-point-spelling`, `compile-fallback-absent-spelling`, `compile-restricted-point` (`t`), `compile-cse`, `match-compile`, `compile-complex` (`x`, `t`), `compile-integer-range-guard` (`x`, `m`), `compile-interval-js` (`x`, `y`, `n` on three engines), `compile-glsl*`, `ce-580`, `ce-519`, `tycho-item-224` (`t`/`x`), `compile-references` (`c`, `k`), `random-compile` (`a`, `c`), `degrees-angular-unit`, `compile-preamble-hoist`, `ce-583` (`x`, `k`), `compile-provable-kind`, `compile-broadcast`, `collections` (`x`), `simplify` (`x`), `compile.test`, `compile-derivative`, `compile-plugin`, `compile-gpu-emission-fixes`, `compile-interval-integrate`, `rule-purpose`.
- **Call `ce.infer([...])` over the earlier expressions, where the test is about inference from a use.**
  - Files: `matrix-operator-typing` (the "earlier expression" tests), `matrix-unknown-factor-order`, `factor`, `latex-syntax/lenient-ambiguity-c`, `ce-597` (`N(2.3)`), `undefined-numeric-slot`, `redeclare-arithmetic-copy`, `compile-shared-binder-body`, `callback-last-function-body`, `latex-syntax/parsing`.
- **Use a fresh engine per test, or declare.**
  - Files: `differential-equations` (NDSolve), `latex-syntax/operators`, `apply-held-callee` (`f`, `g` as functions), `latex-syntax/matchfix` (Norm).

## UNCLASSIFIED (34)

These were seen but not resolved in bounded time. The text after each name is the agent's note.
- `test/compute-engine/solve-domain.test.ts` › SOLVE OVER A DOMAIN — a root list is given only when it is complete › a factor with no closed-form r: extra roots 0,0 for a factor with no closed-form root; maybe DEF-FREE-HOME-SCOPE (not probed)
- `test/compute-engine/functions.test.ts` › N() through user-defined function application › the numeric request reaches a one-statement body › a: numeric request reaches a self-recursive statement body ([true] instead of [false]); not probed
- `test/compute-engine/compile-glsl-fragment.test.ts` › review fixes › a parameter named `discard` › an argument that is caller code is out: a call whose argument is caller code (vars v:"myFn(1.0)") is inlined (parameter name discard replaced by v) where it should stay; not probed
- `test/compute-engine/compile-glsl-fragment.test.ts` › review fixes › a parameter named `discard` › an argument that is caller code in an `If` body is out: a call whose argument is caller code (vars v:"myFn(1.0)") is inlined (parameter name discard replaced by v) where it should stay; not probed
- `test/compute-engine/compile-glsl-fragment.test.ts` › review fixes › a parameter named `discard` › an argument that is caller code in an `And` body is out: a call whose argument is caller code (vars v:"myFn(1.0)") is inlined (parameter name discard replaced by v) where it should stay; not probed
- `test/compute-engine/map-fusion.test.ts` › Map fusion: an annotated spine is REVALIDATED, not re-derived › a NESTED declined annotation re-asks: after assign ws, the nested Map spine does not extend to 2 levels (cache or type read of ws); not probed
- `test/compute-engine/compile-integrate.test.ts` › COMPILE Integrate — adaptive Gauss–Kronrod › antiderivative-first (symbolic resolution before quadra: flag on: compile succeeds and no CancellationError; with TRI_WT=1 the attempt overflows the JS stack (DEF-STACK-like); flag off throws recursion-depth-exceeded; the antiderivative attempt apparently n
- `test/compute-engine/latex-syntax/logic.test.ts` › Logic › should parse Not: \operatorname{not} p parses to Multiply(Error ...) instead of the snapshot form; not probed
- `test/compute-engine/tycho-row-426-apply-lambda-type.test.ts` › row 426 review: names and scopes › the index of a Sum does not type a parameter of the same name: Sum index `k` / parameter `k` confused in the inferred type (list<any> / number for the index); possibly the same root as DEF-DYNAMIC-RESOLUTION; not probed
- `test/compute-engine/tycho-row-426-apply-lambda-type.test.ts` › row 426 review: names and scopes › a mapped literal types the index of a Sum as the index: Sum index `k` / parameter `k` confused in the inferred type (list<any> / number for the index); possibly the same root as DEF-DYNAMIC-RESOLUTION; not probed
- `test/compute-engine/compile-references.test.ts` › the reference analysis probes a caller compile handler without compiling its operands › a shared-nod: `x` (read only through the assigned value H built with ce.function) is now in `unsupported`; not probed: BC1 vs DEF-NESTED-WRITES
- `test/compute-engine/compile-references.test.ts` › the reference analysis probes a caller compile handler without compiling its operands › inside an ov: `x` (read only through the assigned value H built with ce.function) is now in `unsupported`; not probed: BC1 vs DEF-NESTED-WRITES
- `test/epsil/generic-function-sugar.test.ts` › M2 SUGARED GENERICS — G2 multi-clause rejection (§2.6) › a non-final rejection surfaces as a runtime: Epsil: an extra static-type-error diagnostic for a multi-clause generic; not probed
- `test/epsil/function-declaration-hoisting.test.ts` › STATEMENTS THAT ARE NOT HOISTED › a function statement for a name that an earlier assignment writes: Epsil static check reports static-type-error expected string got 2 for a function statement after an assignment; same family as call-follows-function-reassignment; not probed
- `test/compute-engine/integration-rules.test.ts` › loadIntegrationRules (Rubi integration rule driver) › a recursion-depth limit inside a Rubi rewrite : recursion-depth limit in a Rubi rewrite no longer reaches the caller as CancellationError; maybe DEF-STACK, depth not verified
- `test/compute-engine/juxtaposition-application.test.ts` › JUXTAPOSITION WITH A FUNCTION-TYPED OPERAND › parse route: the juxtaposition gives the error of the : juxtaposed form isValid true where the explicit operator is invalid; not probed
- `test/compute-engine/append-variadic.test.ts` › Append: a source whose type does not fix its kind › the flattened form agrees with the nested form (: type of Append over an unknown-kind source u is collection<integer>, expected collection<any>; u is read through a new boxing or its requirement differs; not probed
- `test/compute-engine/append-variadic.test.ts` › Append: a source whose type does not fix its kind › the structural form of the nested expression ove: type of Append over an unknown-kind source u is collection<integer>, expected collection<any>; u is read through a new boxing or its requirement differs; not probed
- `test/compute-engine/latex-syntax/script-order.test.ts` › a spelled-out name after an argument of one letter › x^foo(t) is not split: x^foo(t) parse result differs from the expected Error(incompatible-type) form; parse depends on how f/foo is typed; not probed
- `test/compute-engine/call-follows-function-reassignment.test.ts` › A NAMED CALL THROUGH AN UNTYPED VARIABLE MATCHES THE NAMES AT EVALUATION › a variable assigned a lit: Epsil static check reports a static-type-error for a named call through a reassigned variable; not probed
- `test/compute-engine/call-follows-function-reassignment.test.ts` › A NAMED CALL OF A USER FUNCTION MATCHES THE NAMES AT EVALUATION › Epsil: the parameters of the new l: Epsil static check reports a static-type-error for a named call through a reassigned variable; not probed
- `test/compute-engine/undeclare.test.ts` › undeclare: each kind of binding › a function defined by two clauses: undeclare of a two-clause function returns false; not probed
- `test/compute-engine/fact-store-phase2.test.ts` › a fact refuses a value its type contribution lets past › a value refuted through another symbol cont: assume(x>y && y=5 && x=1) gives ok, not contradiction; not probed
- `test/compute-engine/derivative-closed-form-cache.test.ts` › the closed form of Derivative(f, n) across evaluation points › a recursive function that applies the: wrong value: recursive h applying a derivative, relative error 0.20; not probed
- `test/compute-engine/call-identity-is-same-and-match.test.ts` › isSame compares the definition of a call › a call of a copy of the library definition that keeps the: isSame of a call of a copied library definition is false; not probed
- `test/compute-engine/compile-block-locals-rules.test.ts` › THE TWO SPELLINGS OF A DECLARATION COMPILE THE SAME › Declare with the type unknown: Declare(q, unknown, angle(P)) declines with the assigned-name message; not probed
- `test/compute-engine/simplify-tycho-audit.test.ts` › A lazy operator over an operand that evaluates to itself › simplify() reports no overflow and leaves: simplify() result holds an Error under the flag; not probed
- `test/compute-engine/ce-139-derivative-enclosing-binding.test.ts` › CE-139: D and Integrate over a variable with a list binding › control: a parameter of a real type ke: function type now (a: real) -> real<0..> instead of (a: real) -> number (sharper result); not probed
- `test/compute-engine/ce-139-derivative-enclosing-binding.test.ts` › CE-139: compiled D and Integrate over a variable with a list binding › an operator with the name of : compile message now mentions "may hold a collection" for an operator named like the variable; not probed
- `test/compute-engine/compile-integrate-starting-panels.test.ts` › COMPILE Integrate — starting panels sized by tree-visible depth › a single integral keeps the full s: compile of a single integral fails (success false); not probed, probably an untyped input
- `test/compute-engine/evaluate-at-compile-derivative.test.ts` › THE COMPILED FORM OF AN EVALUATEAT › an indefinite integral at a symbol: compile of EvaluateAt of an indefinite integral at a symbol fails; not probed
- `test/compute-engine/ellipsis-product-coefficient.test.ts` › A product with an ellipsis in a sum › x(2 · 4 · … · 2n) + (2 · 4 · … · 2n): evaluate of x(2*4*...*2n)+(2*4*...*2n) gives another form; not probed
- `test/compute-engine/compile-interval-sub.test.ts` › INTERVAL JS - SUBTRACTION EMITS _IA.sub › an impure first operand keeps the original order: interval-js emitted code differs (_IA.sub order with impure operand); not probed
- `test/compute-engine/ce-623-compiled-integral-keeps-parameter-e.test.ts` › CE-623: a compiled closed-form integral keeps a parameter named like a constant › a parameter named : compiled closed-form integral with parameter i returns a non-number; not probed

## Test files per class (failing-test counts from the log)

### BC1 (359 tests, 119 files)

- `test/compute-engine/ce-39-literal-cell-types.test.ts`: 20
- `test/compute-engine/compile-fallback-absent-spelling.test.ts`: 20
- `test/compute-engine/compile-absent-point-spelling.test.ts`: 19
- `test/compute-engine/use-driven-element-inference.test.ts`: 18
- `test/compute-engine/compile-restricted-point.test.ts`: 14
- `test/compute-engine/compile-cse.test.ts`: 13
- `test/compute-engine/match-compile.test.ts`: 13
- `test/compute-engine/parameter-index-read-inference.test.ts`: 12
- `test/compute-engine/matrix-operator-typing.test.ts`: 9
- `test/compute-engine/compile-interval-js.test.ts`: 8
- `test/compute-engine/compile-integer-range-guard.test.ts`: 8
- `test/compute-engine/resolve-symbol-facts.test.ts`: 7
- `test/compute-engine/spread-literal-result-kind.test.ts`: 6
- `test/compute-engine/juxtaposition-narrows-type.test.ts`: 6
- `test/compute-engine/collections.test.ts`: 5
- `test/compute-engine/latex-syntax/matchfix.test.ts`: 5
- `test/compute-engine/tycho-321-add-unknown-collection.test.ts`: 5
- `test/compute-engine/compile.test.ts`: 4
- `test/compute-engine/differential-equations.test.ts`: 4
- `test/compute-engine/compile-gpu-complex-signatures.test.ts`: 4
- `test/compute-engine/overload-resolution.test.ts`: 4
- `test/compute-engine/inference-provenance.test.ts`: 4
- `test/compute-engine/overload-trials.test.ts`: 4
- `test/compute-engine/error-model.test.ts`: 3
- `test/compute-engine/compile-complex.test.ts`: 3
- `test/compute-engine/compile-glsl-structures.test.ts`: 3
- `test/compute-engine/compile-glsl.test.ts`: 3
- `test/compute-engine/compile-references.test.ts`: 3
- `test/compute-engine/ce-580-compile-shader-assignment-targets.test.ts`: 3
- `test/compute-engine/compile-derivative.test.ts`: 3
- `test/compute-engine/internals/assume-extended.test.ts`: 3
- `test/compute-engine/error-model-linear-algebra.test.ts`: 3
- `test/compute-engine/use-narrowing-evidence-guard.test.ts`: 3
- `test/compute-engine/character-string-operators.test.ts`: 3
- `test/compute-engine/compile-broadcast.test.ts`: 3
- `test/compute-engine/fractals.test.ts`: 3
- `test/compute-engine/generic-signature-inference.test.ts`: 3
- `test/compute-engine/tycho-item-258-gather-element-refinement.test.ts`: 3
- `test/compute-engine/inference-type-refresh.test.ts`: 3
- `test/compute-engine/simplify.test.ts`: 2
- `test/compute-engine/compile-string-operations.test.ts`: 2
- `test/compute-engine/compile-integrate.test.ts`: 2
- `test/compute-engine/missing-value.test.ts`: 2
- `test/compute-engine/accessor-proven-length-type.test.ts`: 2
- `test/compute-engine/matrix-unknown-factor-order.test.ts`: 2
- `test/compute-engine/ce-473-captured-free-symbol.test.ts`: 2
- `test/compute-engine/compile-provable-kind.test.ts`: 2
- `test/compute-engine/internals/query-hooks.test.ts`: 2
- `test/compute-engine/undefined-numeric-slot.test.ts`: 2
- `test/compute-engine/matrix-negative-power.test.ts`: 2
- `test/compute-engine/effects-call-boundary.test.ts`: 2
- `test/compute-engine/type-variables-core.test.ts`: 2
- `test/compute-engine/first-boxing-determinism.test.ts`: 2
- `test/compute-engine/compile-preamble-hoist.test.ts`: 2
- `test/compute-engine/compile-shared-binder-body.test.ts`: 2
- `test/compute-engine/boxing-seam-canonical-heads.test.ts`: 2
- `test/compute-engine/declared-type-unknown-value.test.ts`: 2
- `test/compute-engine/placeholder-element-refinement.test.ts`: 2
- `test/compute-engine/type-variables.test.ts`: 1
- `test/compute-engine/random-compile.test.ts`: 1
- `test/compute-engine/derivatives.test.ts`: 1
- `test/compute-engine/inverse-trig-large-arguments.test.ts`: 1
- `test/compute-engine/valueless-collection-typed-operand.test.ts`: 1
- `test/compute-engine/latex-syntax/parsing.test.ts`: 1
- `test/compute-engine/error-model-combinatorics.test.ts`: 1
- `test/compute-engine/compile-gpu-extremum.test.ts`: 1
- `test/compute-engine/ce-583-block-local-list-no-copy.test.ts`: 1
- `test/compute-engine/serialization.test.ts`: 1
- `test/compute-engine/lattice-phase0.test.ts`: 1
- `test/compute-engine/factor.test.ts`: 1
- `test/compute-engine/error-model-distributions.test.ts`: 1
- `test/compute-engine/whole-collection-parameter.test.ts`: 1
- `test/compute-engine/latex-syntax/operators.test.ts`: 1
- `test/compute-engine/juxtaposition-application.test.ts`: 1
- `test/compute-engine/design-e-compatibility.test.ts`: 1
- `test/compute-engine/threads-conditionals.test.ts`: 1
- `test/compute-engine/compile-interval-integrate.test.ts`: 1
- `test/compute-engine/compile-list-element-unknown-arith.test.ts`: 1
- `test/compute-engine/quantity-kind.test.ts`: 1
- `test/compute-engine/ce-597-unknowns-library-letter-operand.test.ts`: 1
- `test/compute-engine/compile-plugin.test.ts`: 1
- `test/compute-engine/compile-three-valued-connectives.test.ts`: 1
- `test/compute-engine/fact-store-phase2.test.ts`: 1
- `test/compute-engine/item-395-composition.test.ts`: 1
- `test/compute-engine/bug-fixes.test.ts`: 1
- `test/compute-engine/compile-mode-plumbing.test.ts`: 1
- `test/compute-engine/unknown-inference-marker.test.ts`: 1
- `test/compute-engine/latex-syntax/lenient-ambiguity-c.test.ts`: 1
- `test/compute-engine/type-variables-linalg.test.ts`: 1
- `test/compute-engine/boxing-deep-trees.test.ts`: 1
- `test/compute-engine/degrees-angular-unit.test.ts`: 1
- `test/compute-engine/redeclare-arithmetic-copy.test.ts`: 1
- `test/compute-engine/compile-gpu-emission-fixes.test.ts`: 1
- `test/compute-engine/compile-interval-constant-list.test.ts`: 1
- `test/compute-engine/point-accessor-empty-list.test.ts`: 1
- `test/compute-engine/collection-operator-parameter-inference.test.ts`: 1
- `test/compute-engine/type-variables-arithmetic.test.ts`: 1
- `test/compute-engine/compile-python-absent-input.test.ts`: 1
- `test/compute-engine/partly-annotated-function-validation.test.ts`: 1
- `test/compute-engine/declared-result-memo.test.ts`: 1
- `test/compute-engine/tycho-item-238-compiled-pointx-over-undecided-operand.test.ts`: 1
- `test/compute-engine/ce-502-unknown-operand-broadcast-type.test.ts`: 1
- `test/compute-engine/rule-purpose.test.ts`: 1
- `test/compute-engine/apply-held-callee.test.ts`: 1
- `test/compute-engine/ce-519-shader-nan-extremum.test.ts`: 1
- `test/compute-engine/declared-parameter-undecided.test.ts`: 1
- `test/compute-engine/tycho-item-224-gpu-vector-factor-precedence.test.ts`: 1
- `test/compute-engine/speculative-parse.test.ts`: 1
- `test/compute-engine/scalar-factor-and-captured-symbol-type.test.ts`: 1
- `test/compute-engine/callback-last-function-body.test.ts`: 1
- `test/compute-engine/conjugate-function.test.ts`: 1
- `test/compute-engine/join-scalar-operand.test.ts`: 1
- `test/compute-engine/inert-pointlist-projection.test.ts`: 1
- `test/compute-engine/compile-pole-boundary.test.ts`: 1
- `test/compute-engine/nested-broadcast-symbol-type.test.ts`: 1
- `test/compute-engine/single-uppercase-declared-type.test.ts`: 1
- `test/compute-engine/arithmetic-unknown-cell-tier.test.ts`: 1
- `test/compute-engine/unknown-operand-cells.test.ts`: 1
- `test/compute-engine/bigop-symbol-body-infers-collection.test.ts`: 1

### DEF-NESTED-WRITES (72 tests, 24 files)

- `test/compute-engine/compile-integrate.test.ts`: 15
- `test/compute-engine/compile-integrate-timeout-record.test.ts`: 13
- `test/compute-engine/tycho-row-422-nan-integrand-integral.test.ts`: 7
- `test/compute-engine/ce-424-425-findfit-async.test.ts`: 7
- `test/compute-engine/compile-gpu-shared-calls.test.ts`: 4
- `test/compute-engine/compile-gpu-complex-signatures.test.ts`: 3
- `test/epsil/cli-workers.test.ts`: 3
- `test/compute-engine/compile-sum-product.test.ts`: 2
- `test/compute-engine/ce-377-call-over-free-input.test.ts`: 2
- `test/compute-engine/compile-callback-invariants.test.ts`: 2
- `test/compute-engine/compile-cse.test.ts`: 1
- `test/compute-engine/compile-interval-collections.test.ts`: 1
- `test/compute-engine/compile-interval-integrate.test.ts`: 1
- `test/compute-engine/ce-565-shader-finite-proof.test.ts`: 1
- `test/compute-engine/ce-565-4-gpu-parameter-finite.test.ts`: 1
- `test/compute-engine/compile-gpu-emission-fixes.test.ts`: 1
- `test/compute-engine/tycho-row-428-gaussian-symbolic-coefficient.test.ts`: 1
- `test/compute-engine/antiderivative-angular-unit.test.ts`: 1
- `test/compute-engine/ce-516-lazy-chain-index-reads.test.ts`: 1
- `test/epsil/documentation.test.ts`: 1
- `test/compute-engine/ce-1115-named-point-derivative.test.ts`: 1
- `test/compute-engine/ce-509-513-shader-fixes.test.ts`: 1
- `test/compute-engine/ce-430-findfit-async-data.test.ts`: 1
- `test/compute-engine/ce-314-3-nested-pool.test.ts`: 1

### OLD-MECH (43 tests, 16 files)

- `test/compute-engine/inference-rollback.test.ts`: 11
- `test/compute-engine/inference-provenance.test.ts`: 7
- `test/compute-engine/fact-store-phase3-regression.test.ts`: 6
- `test/compute-engine/parse-scope-control.test.ts`: 3
- `test/compute-engine/speculative-parse.test.ts`: 3
- `test/compute-engine/effects-provenance.test.ts`: 2
- `test/epsil/static-check-rollback.test.ts`: 2
- `test/compute-engine/scope.test.ts`: 1
- `test/compute-engine/parse-diagnostics.test.ts`: 1
- `test/compute-engine/binding-units-core.test.ts`: 1
- `test/compute-engine/binding-units-commit.test.ts`: 1
- `test/compute-engine/use-driven-element-inference.test.ts`: 1
- `test/compute-engine/any-typed-symbol-arithmetic-typing.test.ts`: 1
- `test/compute-engine/ce-36-scratch-widening-in-computation.test.ts`: 1
- `test/compute-engine/library-bootstrap-no-leaked-symbols.test.ts`: 1
- `test/epsil/provenance-note.test.ts`: 1

### UNCLASSIFIED (34 tests, 27 files)

- `test/compute-engine/compile-glsl-fragment.test.ts`: 3
- `test/compute-engine/tycho-row-426-apply-lambda-type.test.ts`: 2
- `test/compute-engine/compile-references.test.ts`: 2
- `test/compute-engine/append-variadic.test.ts`: 2
- `test/compute-engine/call-follows-function-reassignment.test.ts`: 2
- `test/compute-engine/ce-139-derivative-enclosing-binding.test.ts`: 2
- `test/compute-engine/solve-domain.test.ts`: 1
- `test/compute-engine/functions.test.ts`: 1
- `test/compute-engine/map-fusion.test.ts`: 1
- `test/compute-engine/compile-integrate.test.ts`: 1
- `test/compute-engine/latex-syntax/logic.test.ts`: 1
- `test/epsil/generic-function-sugar.test.ts`: 1
- `test/epsil/function-declaration-hoisting.test.ts`: 1
- `test/compute-engine/integration-rules.test.ts`: 1
- `test/compute-engine/juxtaposition-application.test.ts`: 1
- `test/compute-engine/latex-syntax/script-order.test.ts`: 1
- `test/compute-engine/undeclare.test.ts`: 1
- `test/compute-engine/fact-store-phase2.test.ts`: 1
- `test/compute-engine/derivative-closed-form-cache.test.ts`: 1
- `test/compute-engine/call-identity-is-same-and-match.test.ts`: 1
- `test/compute-engine/compile-block-locals-rules.test.ts`: 1
- `test/compute-engine/simplify-tycho-audit.test.ts`: 1
- `test/compute-engine/compile-integrate-starting-panels.test.ts`: 1
- `test/compute-engine/evaluate-at-compile-derivative.test.ts`: 1
- `test/compute-engine/ellipsis-product-coefficient.test.ts`: 1
- `test/compute-engine/compile-interval-sub.test.ts`: 1
- `test/compute-engine/ce-623-compiled-integral-keeps-parameter-e.test.ts`: 1

### BC-LOOKUP (32 tests, 15 files)

- `test/compute-engine/parse-scope-control.test.ts`: 10
- `test/compute-engine/ce-473-captured-free-symbol.test.ts`: 5
- `test/compute-engine/assumptions.test.ts`: 3
- `test/compute-engine/compile-entry-string-refusal.test.ts`: 2
- `test/compute-engine/resolve-symbol-facts.test.ts`: 2
- `test/compute-engine/effects-contracts.test.ts`: 1
- `test/compute-engine/canonical-form.test.ts`: 1
- `test/compute-engine/juxtaposition-application.test.ts`: 1
- `test/compute-engine/solve-periodic-families.test.ts`: 1
- `test/compute-engine/tycho-item-336-nested-signature-derivation.test.ts`: 1
- `test/compute-engine/ce-597-unknowns-library-letter-operand.test.ts`: 1
- `test/compute-engine/fact-store-phase3-writes.test.ts`: 1
- `test/compute-engine/ce-622-subs-keeps-call-binding.test.ts`: 1
- `test/compute-engine/builtin-name-value-binding.test.ts`: 1
- `test/compute-engine/unknowns-scoped-library-letter.test.ts`: 1

### DEF-ADMIT-OCC (19 tests, 9 files)

- `test/compute-engine/compile-fold-shared-values.test.ts`: 6
- `test/compute-engine/compile-assigned-symbol.test.ts`: 4
- `test/compute-engine/ce-575-compile-shader-stage-struct-and-free-symbols.test.ts`: 2
- `test/compute-engine/scoping-rulings-0921.test.ts`: 2
- `test/compute-engine/compile-cse.test.ts`: 1
- `test/compute-engine/compile.test.ts`: 1
- `test/compute-engine/calculus.test.ts`: 1
- `test/compute-engine/compile-gpu-user-functions.test.ts`: 1
- `test/compute-engine/compile-fold-size-guard.test.ts`: 1

### DEF-EPSIL-PIN (19 tests, 2 files)

- `test/epsil/static-lambda-callee-arguments.test.ts`: 15
- `test/epsil/execute.test.ts`: 4

### DEF-MATRIX-REPAIR (17 tests, 4 files)

- `test/compute-engine/matrix-operator-typing.test.ts`: 8
- `test/compute-engine/tycho-321-add-unknown-collection.test.ts`: 7
- `test/compute-engine/tycho-item-336-nested-signature-derivation.test.ts`: 1
- `test/compute-engine/type-soundness-regressions.test.ts`: 1

### DEF-OPTOKEN (16 tests, 10 files)

- `test/compute-engine/tycho-row-424-derivative-no-closed-form-cache.test.ts`: 5
- `test/compute-engine/call-identity-is-same-and-match.test.ts`: 2
- `test/compute-engine/resolve-only-scratch-inference.test.ts`: 2
- `test/compute-engine/user-function-purity.test.ts`: 1
- `test/compute-engine/effects-of.test.ts`: 1
- `test/compute-engine/lazy-collection-regimes.test.ts`: 1
- `test/compute-engine/integrate-limit-user-function-capture.test.ts`: 1
- `test/compute-engine/eager-collection-enumerability.test.ts`: 1
- `test/compute-engine/ce-661-point-family-count-at.test.ts`: 1
- `test/compute-engine/closure-capture-noop.test.ts`: 1

### DEF-FREE-CALL-TYPE (16 tests, 5 files)

- `test/compute-engine/elementwise-which.test.ts`: 11
- `test/compute-engine/ce-1150-static-shape.test.ts`: 2
- `test/compute-engine/type-relation-gaps.test.ts`: 1
- `test/compute-engine/tycho-item-167-broadcast-count.test.ts`: 1
- `test/compute-engine/ce-772-block-local-function-call-type.test.ts`: 1

### DEF-LIMIT-FREE-PARAM (12 tests, 3 files)

- `test/compute-engine/mathematica-heads-nsolve-table-limit.test.ts`: 10
- `test/compute-engine/integrate-symbolic-pole.test.ts`: 1
- `test/compute-engine/divide-by-zero-symbolic-numerator.test.ts`: 1

### DEF-STACK (8 tests, 7 files)

- `test/compute-engine/compile-deep-nesting.test.ts`: 2
- `test/compute-engine/solve.test.ts`: 1
- `test/compute-engine/patterns.test.ts`: 1
- `test/compute-engine/lazy-collection-regimes.test.ts`: 1
- `test/compute-engine/census-head-new-declines.test.ts`: 1
- `test/compute-engine/ce-582-recursive-type-facts-hidden.test.ts`: 1
- `test/compute-engine/recursion-limit-stack-overflow.test.ts`: 1

### BC-LIBVAR (8 tests, 3 files)

- `test/compute-engine/compile-integrate.test.ts`: 6
- `test/compute-engine/builtin-name-value-binding.test.ts`: 1
- `test/compute-engine/unapplied-operator-fallback.test.ts`: 1

### DEF-FREE-HOME-SCOPE (8 tests, 4 files)

- `test/compute-engine/explain.test.ts`: 3
- `test/compute-engine/ce-614-integral-keeps-call-binding.test.ts`: 2
- `test/compute-engine/debug-bindings-scope-copies.test.ts`: 2
- `test/compute-engine/solve-root-checks.test.ts`: 1

### DEF-TARGET-NO-OP (7 tests, 1 files)

- `test/compute-engine/compile-gpu-user-functions.test.ts`: 7

### DEF-BINDER-SUBST-FREE (7 tests, 1 files)

- `test/compute-engine/apply-binder-variable-argument.test.ts`: 7

### DEF-CAPTURE-FREE (7 tests, 1 files)

- `test/compute-engine/ce-473-captured-free-symbol.test.ts`: 7

### DEF-WITHVALUES (7 tests, 2 files)

- `test/compute-engine/with-values.test.ts`: 6
- `test/compute-engine/ce-1102-provisional-registry-weak-references.test.ts`: 1

### DEF-ENVDEPS (7 tests, 1 files)

- `test/compute-engine/d-node-derivative-memo.test.ts`: 7

### DEF-FREE-HEAD-D (7 tests, 1 files)

- `test/compute-engine/ce-824-call-head-data-symbol.test.ts`: 7

### DEF-FREE-NAME-CAPTURE (6 tests, 3 files)

- `test/compute-engine/symbol-value-scoping.test.ts`: 2
- `test/compute-engine/comprehension-memo.test.ts`: 2
- `test/compute-engine/user-function-last-statement-numeric-request.test.ts`: 2

### DEF-DYNAMIC-RESOLUTION (4 tests, 4 files)

- `test/compute-engine/lazy-view-scope.test.ts`: 1
- `test/compute-engine/tycho-row-426-apply-lambda-type.test.ts`: 1
- `test/compute-engine/ce-712-2-variant-result-type.test.ts`: 1
- `test/compute-engine/callable-evaluation-binding.test.ts`: 1

### BC-HELD (4 tests, 3 files)

- `test/compute-engine/fact-store-phase2.test.ts`: 2
- `test/compute-engine/protocol-property-effects.test.ts`: 1
- `test/compute-engine/ce-586-disposed-definition-inert.test.ts`: 1

### DEF-FREE-BOUND-SAME (4 tests, 2 files)

- `test/compute-engine/issue-489-curried-function-capture.test.ts`: 3
- `test/compute-engine/latex-syntax/matchfix.test.ts`: 1

### DEF-BLOCK-LOCAL-CALL (4 tests, 1 files)

- `test/compute-engine/gpu-point-complex-component.test.ts`: 4

### DEF-LISTREC-SELFREF (4 tests, 1 files)

- `test/compute-engine/ce-579-list-recursion-loop.test.ts`: 4

### DEF-MEMO-STORED (3 tests, 1 files)

- `test/compute-engine/comprehension-memo.test.ts`: 3

### DEF-OPREENTRY (3 tests, 1 files)

- `test/compute-engine/dictionary-shared-value-evaluation.test.ts`: 3

### DEF-DESTRUCTURE-LET (2 tests, 2 files)

- `test/epsil/programs.test.ts`: 1
- `test/compute-engine/use-narrowing-evidence-guard.test.ts`: 1

### DEF-DECLUNKNOWN-TYPE (2 tests, 2 files)

- `test/compute-engine/accessor-proven-length-type.test.ts`: 1
- `test/compute-engine/broadcast-call-typing-soundness.test.ts`: 1

### BC-NARROWINGS (2 tests, 1 files)

- `test/compute-engine/parse-scope-control.test.ts`: 2

### DEF-RECURSION (2 tests, 2 files)

- `test/compute-engine/ce-604-list-route-keeps-call.test.ts`: 1
- `test/compute-engine/recursive-lazy-callback.test.ts`: 1

### DEF-INTEGRATE-POLE (2 tests, 1 files)

- `test/compute-engine/integrate-pole-proofs.test.ts`: 2

### DEF-ENUM-FREENAME (2 tests, 1 files)

- `test/compute-engine/broadcast-enumerability.test.ts`: 2

### DEF-LIB-AUTODECL (1 tests, 1 files)

- `test/compute-engine/collections.test.ts`: 1

### DEF-TELESCOPE (1 tests, 1 files)

- `test/compute-engine/wester.test.ts`: 1

### DEF-SYMBOL-LITERAL-INPUT (1 tests, 1 files)

- `test/compute-engine/function-values-rules.test.ts`: 1

### BC-RULE4 (1 tests, 1 files)

- `test/compute-engine/type-variables-arithmetic.test.ts`: 1

### DEF-FIRST-ASSIGN-FREE (1 tests, 1 files)

- `test/compute-engine/block-scope-shadowing.test.ts`: 1

### DEF-RSOLVE-NOTCANON (1 tests, 1 files)

- `test/compute-engine/recurrences.test.ts`: 1

### DEF-EPSIL-PARAM-NAMES (1 tests, 1 files)

- `test/compute-engine/ce-60-inferred-parameter-names.test.ts`: 1

### BC-RULE7 (1 tests, 1 files)

- `test/compute-engine/ce-107-function-literal-free-name-is-same.test.ts`: 1
