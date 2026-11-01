# Triage of the open items of the handoff files in `docs/scratch/`

Classified on 2026-11-01 from the text of each handoff file and the current
`ROADMAP.md` only. No probe, test or source file was read. The rules are the
header of `ROADMAP.md` and "Caveats of compiled code" in
`docs/COMPILATION-MODEL.md`. Items that a file states as committed, applied,
fixed or dropped by the user have no row. The items F38 to F60 of the
ready-defects file are in `part-fb.md` and have no row here.

File codes used in the tables (all in `docs/scratch/`):

| code | file |
| --- | --- |
| ce728 | `2026-11-01-ce728-followups-handoff.md` |
| ce662 | `2026-10-30-ce662-handoff.md` |
| psubs | `2026-10-30-parameter-substitution-followups-handoff.md` |
| ce701 | `2026-10-31-ce701-handoff.md` |
| ce715 | `2026-10-31-ce715-bigint-handoff.md` |
| i488 | `2026-10-31-issue488-followups-handoff.md` (defects 23 to 27 are described in the memory file `project_issue488_followups_1031.md`, which the handoff names) |
| mapaw | `2026-10-31-map-await-callback-handoff.md` |
| ready | `2026-10-31-ready-defects-handoff.md` |
| ce715-7c | `2026-11-01-ce715-followups-7c-handoff.md` |
| ce715-nt | `2026-11-01-ce715-next-tasks-followups-handoff.md` |
| ce725 | `2026-11-01-ce725-and-followups-handoff.md` |
| ce712-1 | `2026-10-31-ce712-1-handoff.md` |
| ce712-2 | `2026-10-31-ce712-2-handoff.md` (DOES NOT EXIST in the tree) |
| f684 | `2026-10-31-followups-of-ce684-688-followups-handoff.md` |
| ce679 | `2026-10-30-ce679-range-nan-handoff.md` |
| cache | `2026-10-30-cache-audit-handoff.md` |

## Part 1. Open items

| file | item | kind | witness | bucket | reason |
| --- | --- | --- | --- | --- | --- |
| ce728 | 4b list: async `Max`/`Min`/`Sum` of a `FlatMap` with an async-only callback | wrong value (no value) | plausible | fix | `Max(FlatMap([1, 2], x ↦ [x, slowF(x)]))` under `evaluateAsync()` gives `Max(2, slowF(1), slowF(2))`, not 20. State: NOT STARTED. |
| ce728 | "Shared tuples whose sharing crosses levels" stay exponential | performance | crafted | drop | Chains `a2 := Tuple(a1, a0)` to depth 14 and more are built to reach it; "needs a user choice", but no decision is recorded. |
| ce662 | CE-662: compiled check of a value assigned to a typed block local | task | plausible | already-in-roadmap | CE-662 (rewritten 2026-11-01: remove the checks). The entry cites the folder `2026-10-30-ce662-first-version/`. |
| ce662 | CE-683 (a) and (b): host contract in the documents, removal of guards | task | none | drop | Today's ROADMAP triage dropped CE-683 as superseded by CE-712 steps 2, 3 and 5. |
| ce662 | Related CE-669, CE-673, CE-676, CE-677, CE-681 | defect | crafted | drop | Triage dropped CE-673, CE-676, CE-677, CE-681 (allowed differences, input outside its type); CE-669 is in neither ROADMAP nor triage. |
| ce662 | Draft Tycho replies for rows 470, 474, 477, 479 | task (reply) | corpus | drop | A reply, not a defect. Check the rows in Tycho's `COMPUTE_ENGINE.md` first; MEMORY live state still owes rows 477/479. |
| psubs | Items 2 and 9: two functions with the same `:=` local `g` read each other's binding | defect | plausible | fix | `k(1)(0)` with `h = n ↦ Block(g := (z ↦ 0), z ↦ g(z) + n)`, `k = n ↦ Block(g := h(n), z ↦ g(z) + n)` gives "Recursion limit exceeded", expected 2. |
| psubs | Item 3: `evaluateAsync()` of a loop that reassigns a closure gives `i + 100` | wrong value | crafted | drop | `Block(f := z ↦ z, Loop(f := z ↦ z + i + y, …), f(0))` under async only; construct built to reach it. Interpreter case. |
| psubs | Item 4: `collectionElementType()` throws on a dictionary type with a type-variable value | defect | crafted | drop | A dictionary type with an open type variable is a type value nobody writes; no user program shown. |
| psubs | Item 5: `Apply((x, y) ↦ x + y, 1)` typed `number`; `Map(List(1, 2, 3), Apply(f, 10))` is an error | wrong static type | plausible | fix | A partial application used as a `Map` callback gives `incompatible-type`; the interpreter should map it. |
| psubs | Item 6: Python `Apply((x, y) ↦ x + y, L, 3)` with a list `L` raises `TypeError` | defect (compiled throw) | plausible | fix | Interpreter maps over `L`; a throw where the interpreter gives a list is not an allowed difference. |
| psubs | Item 7: interval-js and Python decline calls of literals with no or rest parameters | decline | crafted | drop | A decline is always allowed. |
| psubs | Item 10: async closure in an `If`-branch block loses the block local | wrong value | crafted | drop | `Declare`, nested closure maker and `evaluateAsync()` chosen together; interpreter case built to reach it. |
| psubs | Item 11: closures returned by `Map` through a `DefineFunction` helper read `q` as free | wrong value | crafted | drop | `Map` + `Block` + `DefineFunction` returning a closure is built to reach it; `g := …` gives the right value. |
| psubs | Item 12: `(s ↦ Length(s))(t)`, `t: string`, compiled JavaScript throws `RangeError` | defect (compiled throw) | plausible | fix | Interpreter gives 3, `Length(t)` alone compiles; file says it is well-typed and stays a defect. |
| psubs | §4: capture-avoiding `subs()` | capability | none | already-in-roadmap | CE-692. |
| ce701 | CE-701 (and CE-702, CE-703): quadrature reads a deep step as a divergence | wrong value | crafted | drop | Today's triage dropped CE-701, CE-702 (steps of area `1e-6` at `1e-80`..`1e-300`) and CE-703 (proposed). |
| i488 | Defect 9 | unknown | none | drop | Listed as open, but described in neither the handoff nor its memory file. |
| i488 | Defect 14: interpreter fallback gives `null` for a list given to an undeclared free `x` | defect | crafted | drop | `x` is inferred `number`; a list from the host is outside its type (file: "check whether CE-683 makes it a contract violation"). |
| i488 | Defect 15: interval-js `2x`, `x: any`, gives `{kind: "empty"}` for a list | wrong shape | crafted | drop | Since CE-712.1 (`5b60e6081`) an input typed `any` is refused (rule R1), so the case declines. |
| i488 | Defect 18 (CE-681): top-level declared result not checked by compiled code | wrong value | crafted | drop | Compiled 1.5 where the interpreter gives `incompatible-type` is an allowed difference; triage dropped CE-681. |
| i488 | Defect 23: Epsil `let g: (unknown) -> unknown` maps `count` over `[[0,0],5]` | wrong value | crafted | drop | A signature with `unknown` and a mixed nested list are chosen together; without the `let` it gives 2. |
| i488 | Defect 24: `Count` at a parameter of an alias of `any` gives an error | defect | crafted | drop | `declareType('A', 'any', {alias: true})` as a parameter type is a value nobody writes. |
| i488 | Defect 25: `Block(Assign(f, t ↦ Count(t)), f([[0,0],5]))` value 2, typed a list | wrong static type | plausible | fix | Type computed before `f` is assigned; a type that does not hold the value can give a compiled wrong shape (as F56). |
| i488 | Defect 26: `\operatorname{g}(t\colon real) \coloneq t+1` parses the parameter as an error | defect (parse) | plausible | already-in-roadmap | CE-638, option (c) names typed parameters in a definition (same as ready F12). |
| i488 | Defect 27: `op()` with `op := (a: any) ↦ a` is `Error("missing")`, the literal call is partial | defect | crafted | drop | A zero-argument call of a one-parameter function; the CE-708 choice already makes a held partial application `Error("missing")`. |
| i488 | Item 28: JavaScript `Reduce(M, (a, t) ↦ a + t)` with no seed declines | decline | crafted | drop | A decline is always allowed. |
| i488 | Item 29: interval-js and GPU decline custom `Reduce`/`Scan` combiners | decline | crafted | drop | A decline is always allowed. |
| i488 | Item 30: interpreter leaves `Scan(M, (a, t) ↦ a + t, 0)` unevaluated | wrong value (no value) | plausible | fix | A running sum of matrix rows is a one-line program; file says "check intent" first. |
| i488 | Item 31: JavaScript `Product(L)`, `L: any` holding matrices, declines | decline | crafted | drop | A decline; an `any` input is now refused by R1. |
| i488 | Item 32: a rank-4 tensor `Product` is typed `unknown` | wrong static type | crafted | drop | File says the type is sound, not precise; no wrong value. |
| i488 | Item 33: entry range of a matrix product uses the scalar rule | wrong static type | none | drop | "Not measured"; no observed result. One probe with `matrix<integer<0..1>>` would settle it. |
| i488 | Item 34: boxing a `Power` DAG is exponential (`isFinite` not memoized) | performance | crafted | drop | Measured only on a shared DAG of depth 26, built to reach it. |
| i488 | Item 35: `box` of MathJSON that shares one array boxes each path again | performance | none | drop | No measurement. |
| i488 | Item 37: Python `Apply(p ↦ At(p, 1), [1, 2])` declines with a wrong message | decline | crafted | drop | A decline is always allowed; only the message is wrong. |
| i488 | Item 38: JavaScript `And` over a list input is not mapped | wrong shape | plausible | fix | `Not(And(b, u > 0))`, `b = true`, `u = [1, 2, 3]` gives `true`; interpreter `[False, False, False]`. |
| i488 | Item 39: interpreter leaves `1 + Return([2, 4, 6])` unevaluated | defect | crafted | drop | A `Return` outside a function body is built to reach it. |
| i488 | Defect 20 note: an operator over a call in `If`/`Which`/`Block` pays a `_SYS.bcast` closure | performance | none | drop | No measurement; CE-712.2 deleted `_SYS.bcastFn`. |
| mapaw | `Map` does not await its callback under `evaluateAsync()` | defect | plausible | already-in-roadmap | CE-111 (sub-item CE-111.4, spec approved 2026-10-31); the measured cases are in that entry. |
| ready | CE-58: `Declare` at the top level and in a pushed scope | defect | — | already-in-roadmap | CE-58 (decision needed). |
| ready | CE-103: JSON round trip of a rebound `Pi` | defect | — | already-in-roadmap | CE-103 (decision needed). |
| ready | CE-107 v2 (`isSame` of free-name placeholders); worktree `ce107` | defect | — | already-in-roadmap | CE-107 (decision needed); F48 and F49 are in `part-fb.md`. |
| ready | CE-127: subscript index that is an expression; worktree `ce127` | defect | — | already-in-roadmap | CE-127 (decision needed). |
| ready | CE-610: canonicalizing `Apply` of a recursive map | defect | — | already-in-roadmap | CE-610 (decision needed, recommend (a)). |
| ready | CE-613 with F3 and F4 (growth compared by samples); worktree `ce613` | wrong value | plausible | already-in-roadmap | CE-613 names both witnesses (`e^{ln x·ln(x+1)}/x^9`, two top-level exponentials). |
| ready | F23 and F31: `compareGrowth()` and `stableSignAtInf()` limits | wrong value | plausible | already-in-roadmap | CE-613 option (b) covers them; the entry does not name `Limit(Sin(x)/Cos(x), x, +∞)` = 0: add that witness. |
| ready | F12 and F13: typed parameter of a definition; outer declaration changes `\mapsto` reading | defect | plausible | already-in-roadmap | CE-638 (F13 merged into it; F12 is its option (c)). |
| ready | CE-752 | defect | — | already-in-roadmap | CE-752 (decision needed). |
| ready | F10: `Limit(Root(1/x, n), x, +∞)` with `n < 0` gives `ComplexInfinity` | wrong value | crafted | drop | State "applied, Codex round 3 running", no commit named (check `git log` of `limit.ts`); an assumed negative root index is built. |
| ready | F19: `Limit(Root(10^{-30} + 1/x, -2), x, +∞)` gives `+∞` (correct `10^{15}`) | wrong value | crafted | drop | The `10^{-30}` offset is chosen to defeat the tolerance test; interpreter case. |
| ready | F26: membership operators read two random draws as one value | defect | crafted | drop | `Element(r(t), List(r(t)))` with `r` declared random; `docs/ERROR-MODEL.md` rule C (2026-09-26) documents structural membership. |
| ready | F27: compiling `D(x, x) + 2`, `x: real`, fails "input `x` has no type" | decline | plausible | drop | A decline is always allowed; `D(x^2, x) + 2` compiles. |
| ready | F28: `0 · 0^m` evaluates to 0 for `m` of unknown sign | wrong value | crafted | drop | `0 · 0^m` is an expression nobody writes; interpreter case. |
| ready | F33: `T(L)`, `L: list<any>`, misses a tuple element; worktree `f33` | wrong static type | crafted | drop | `list<any>` holding a tuple is built to reach it; options were for the final report, no decision recorded. |
| ready | F35 idea: print `1.0x` in `toString()` | idea | none | drop | An idea; `Multiply(1.0, x)` is the documented inexact marker. |
| ready | F16: text for the guide page `80-reference-arithmetic.md` | documentation | none | fix | Owed by the AGENTS.md rule on public behavior; the text was in a lost scratch report. Check the cortexjs.io page. |
| ce715-7c, ce715-nt | Item 2: `list<number>` that holds complex values gives `[null, null]` | wrong value | plausible | already-in-roadmap | CE-751 (ready, user decision 2026-11-01 option (a)); the entry cites ce715-nt item 2. |
| ce715-7c, ce715-nt | Item 6: `Declare` signature of a block-local function does not set the lane in `strict` | decline | plausible | drop | `strict` declines and says so; `auto` gives the right value. A decline is allowed. |
| ce725 | Item 2: Python-execution tests broken by CE-712.1 | test failure | corpus | drop | The ready file records ci-nightly green at `bd9e1c934`, Python part included. |
| ce725 | Item 3: Python `Head(["Dictionary"])` compiles to an undefined name | defect | crafted | drop | Interpreter gives a symbol, not a number: a throw is allowed. |
| ce725 | Item 4: Python compiles a literal whose body reads an unbound symbol | defect | crafted | drop | `Optional`/`Typed` parameter with a `Dictionary` default is built; "check whether intended". |
| ce725 | Item 5: JavaScript `Sum` over a list declines | decline | plausible | drop | A decline is always allowed. |
| ce725 | Item 6: Python `Sort` with a callback and `Iterate` decline | decline | plausible | drop | A decline is always allowed. |
| ce725 | Item 7: `Apply((x: complex) ↦ Sqrt(x), -4)` declines with an unrelated reason | decline | plausible | drop | A decline; only the message is wrong. |
| ce725 | Item 8a: `Sort([])` stays unevaluated | wrong value (no value) | plausible | fix | Sorting an empty list is a one-line program; expected `[]`. |
| ce725 | Item 8b: `Iterate` has the bare type `list`, so `Take(Map(g, Iterate(f, y)), 3)` declines | decline | plausible | drop | A decline. (Item 8c, `ListFrom(FlatMap(…))`, is committed in `2bc8bf007`.) |
| ce725 | Item 9: function-valued `If` at the end of a `Block` declines on interval-js | decline | crafted | drop | Documented decline; precise version only on request. |
| ce725 | Item 10: complex-lane `Mod` gives `NaN` for a run-time real value | wrong value | plausible | already-in-roadmap | CE-741. |
| ce725 | Item 11: admission counts a real argument at a `complex` parameter as a conflict | decline | crafted | drop | A decline; mode `complex` gives 3. |
| ce725 | Item 14: dependent `Sum` clauses: inner-first declines; outer `k` gives 36 against 24 | decline / wrong value | crafted | document | `javascript`, `python`: with outer `k = 3`, `Sum(j + k, Limits(j, 1, k), Limits(k, 1, k))` gives 36; interpreter gives 24 (file calls 24 wrong). |
| ce725 | Item 15: GLSL/WGSL emit a JavaScript lambda for an operator symbol in value position | defect | crafted | drop | Interpreter gives a symbol, no number; any compiled result is allowed. |
| ce725 | Item 16: JavaScript returns a function where the interpreter returns a symbol | design | crafted | drop | Allowed difference (interpreter gives no number); no decision recorded. |
| ce725 | Item 17: JavaScript `Head(Negate(x))` emits a binary subtract | defect | crafted | drop | Interpreter gives the symbol `Negate`; allowed difference. |
| ce725 | Item 18: Python cannot use a built-in operator as a function value | decline | plausible | drop | A decline is always allowed. |
| ce725 | Item 19: Python `Map(Add, v)` raises `TypeError` | defect | crafted | drop | Interpreter leaves `Map(Add, [1, 2])` unevaluated; a throw is allowed. |
| ce725 | Item 20: Python `unsupported` lists `Composition` that compiled | diagnostics | crafted | drop | Correct code; only the diagnostic list is wrong. |
| ce725 | Item 23: `Map`/`Filter` stage over an `Iterate` declines on JavaScript | decline | plausible | drop | A decline is always allowed. |
| ce725 | Item 24: `Apply(t ↦ 2t, (y + i, 1))` declines in every mode | decline | crafted | drop | A decline is always allowed. |
| ce725 | Item 25: JavaScript and Python cannot call a parameter typed as a function | decline | plausible | drop | A decline is always allowed. |
| ce725 | Item 26: a body that writes 0.5 to the `Sum` index gives 1.5 compiled | wrong value | crafted | drop | Interpreter gives `Error(incompatible-type)`; an allowed difference (file: unspecified case). |
| ce712-1 | interval-js `Which(3 < 2, [1, 2], True, 0)` declines on a dropped branch | decline | crafted | drop | A decline is always allowed. |
| ce712-1 | GLSL/WGSL emit the dropped branches of a known condition | defect | none | drop | No wrong value shown. |
| ce712-1 | Chained comparison `y < 0 < q(u)` over `u: real \| list<real>` | wrong shape | crafted | document | `javascript` (target not stated), `u: real \| list<real>`: `y < 0 < q(u)` gives `[false, false, false]`; the interpreter gives `False`. |
| ce712-1 | A chained inner target read after a loop (`w`) | defect | none | drop | No program and no values given. |
| ce712-1 | Compiling `Block(If(x < 1, b ≔ 1, b ≔ 2); b)` creates a global `b` | defect (side effect) | plausible | fix | Compilation changes the engine's scope; a two-line program. |
| ce712-1 | `Function(1 + h(u), Typed(u, any))` declines | decline | crafted | drop | Rule R1 refuses an `any` input. |
| ce712-1 | JavaScript `Break` value lost (`Loop(If(x > 1, Break(3), Break(3)))` gives `undefined`) | wrong value | plausible | already-in-roadmap | CE-735. |
| ce712-1 | The type of a named call ignores an early `Return` of a tuple | wrong static type | crafted | drop | A body that returns a tuple in one branch and a number in the other is built; R3 declines it when compiled. |
| ce712-1 | `Return` at the root: compiled 12, interpreter `Return(12)` | defect | crafted | drop | Interpreter gives an unevaluated form; allowed difference. |
| ce712-1 | `Integrate` `evaluate()` against `.N()` with a local `Declare` | wrong value | plausible | already-in-roadmap | CE-738. |
| ce712-1 | CE-714 | wrong value | crafted | drop | Today's triage dropped CE-714 (interpreter gives `incompatible-type`). |
| ce712-1 | CE-722 | documentation | crafted | already-in-roadmap | CE-722. |
| ce712-1 | Nit: a name that contains a comma is split in `unsupported` | diagnostics | crafted | drop | Diagnostics only; a name with a comma is a value nobody writes. |
| f684 | Item 1: GPU negated chain loses its parentheses | wrong value | plausible | fix | `Not(Less(3, y, x))` emits `!(3.0 < y) && (y < x)`; at y = 4, x = 1 shader false, interpreter True. |
| f684 | Item 2: WGSL `Match` makes the draw of an unselected case | defect | crafted | drop | `WithRandomSeed` + `Match` + `Random` on WGSL chosen together; the selected value is the same. |
| f684 | Item 3: `At` of a literal list drops caller code | defect | crafted | drop | Caller code with a side effect (`nextValue()`) is chosen; the value of the expression is the same. |
| f684 | Item 4: GLSL compiles `U: list<real>` with `success: true` to a bare name | defect | plausible | fix | Shader code that no shader can declare, reported as a success; it must decline. |
| f684 | Item 5: GPU `Sum`/`Product` with several index clauses decline | decline | plausible | drop | A decline is always allowed. |
| f684 | Item 6: `Break`/`Continue` in a GPU loop body decline | decline | plausible | drop | A decline is always allowed. |
| f684 | Item 7: `NotEqual(1, W, 3)` calls caller code twice | defect | crafted | drop | Caller code with a side effect is chosen to reach it. |
| f684 | Item 8: `And`/`Or` run-time broadcast evaluates every operand | defect | none | drop | "Not reproduced yet". |
| f684 | Item 9: `Limit(Sin, 0)`: `.N()` NaN, compiled 0 | wrong value | crafted | drop | A bare function symbol in `Limit`; compiled 0 where the interpreter has no number is allowed. |
| f684 | Item 10: `Integrate(Random(), …)` gives three results | defect | crafted | drop | A random integrand is built to reach it. |
| f684 | Item 11: compiled `Integrate` with a `NaN` bound gives `Infinity` | defect | crafted | drop | Interpreter keeps it unevaluated; allowed difference. |
| f684 | Item 12: `Integrate(Sin, Limits(x, 0, 1))`: error, unevaluated, NaN | defect | crafted | drop | Interpreter gives an error or no value; compiled NaN is allowed. |
| f684 | Item 13: `\int_0^1 x` reports `unknowns` `['x']` | defect | plausible | fix | `\int_0^1 x\,dx` gives `[]`; an integral without `dx` is common input. |
| f684 | Item 14: `assume` keeps bindings after a rolled-back contradiction | defect | crafted | drop | An `Error` operand inside an assumed `Equal` chain is built to reach it. |
| f684 | Item 15: `D(Integrate(x·y, Limits(x, 0, 1)), y)` stays unevaluated | wrong value (no value) | plausible | fix | Expected 1/2; differentiation under a definite integral is a one-line program. |
| f684 | Item 16: `D(Sum(L), t)` with `L := [1, 2, 3]` stays unevaluated | wrong value (no value) | crafted | drop | A derivative of the sum of a constant list is built to reach it. |
| f684 | Item 17: `Block` integrand: `evaluate()` 2, `N()` 1 | wrong value | plausible | already-in-roadmap | CE-738. |
| f684 | Item 18: `∫_0^∞ c\,dt` with `c := 0` stays unevaluated | wrong value (no value) | crafted | drop | Only the value 0 of `c` reaches it; `N()` gives 0. |
| f684 | Item 19: `Series(x·y)` with `y := 5`: `evaluate()` `x·y`, `N()` `5x` | wrong value | plausible | drop | Implicit variable after an assignment: the CE-699 rule, committed `225f1f54c` (ready file). |
| f684 | Item 20: `Series(sin x).N()` gives NaN | wrong value | plausible | fix | Also `Series(exp x).N()`; a one-line program. |
| f684 | Item 21: `NIntegrate` has no JavaScript lowering | decline | plausible | drop | A decline is always allowed. |
| f684 | Item 22: compiled `D(x^3, x)` with `x := 4` gives 48 | defect | plausible | drop | Interpreter gives the symbolic `3x^2`; a number where the interpreter has an unevaluated form is allowed. |
| f684 | Item 23: an inner-scope `t` shadows the parameter of a `Solve` family | wrong value | crafted | drop | `pushScope()`, `declare('t')`, `assign` after a `Solve` are chosen together; interpreter case. |
| f684 | Item 24: compiled enumeration filter may drop a true solution | defect | none | drop | "Not reproduced: measure first". |
| f684 | Precise versions on demand (`Equal` chain domain, `Cot(W)`, `realOperandGuard`) | idea | none | drop | Ideas for more precise declines; none has a request. |
| ce679 | CE-679: `Range` with a `NaN` bound has no value; worktree `/tmp/wt-compute-engine-2c-ce679` | defect | crafted | keep | User decision 2026-10-30 (option (b)) is no longer in ROADMAP: triage dropped CE-679. Recommend drop and remove the worktree. |
| ce679 | §4: restore half of review finding 7 (marker record of a failed compilation) | defect | crafted | drop | Exists only in the worktree change; goes with the CE-679 decision. |
| ce679 | §5.1: an effect after a range in the result frame does not run | defect | crafted | drop | Only in the worktree change; `Join(Range(1, n), [Random()])` with `n = NaN`. |
| ce679 | §5.2: frame catch always emitted; a hoisted range could empty the frame | performance | none | drop | "Not seen"; cost only. |
| ce679 | §5.3: recursive definition reads `undefined` and can raise `TypeError` | defect | crafted | drop | Only in the worktree change; needs a `NaN` bound; a throw is allowed. |
| ce679 | §5.4: catch falls back to the result frame | defect | none | drop | "The value seen was still correct". |
| ce679 | §5.5: Python consumers of a `None` range raise `TypeError` | defect | crafted | drop | Interpreter gives NaN or `Missing`; a throw is allowed. |
| ce679 | §5.6: interval-js `Loop` gives `entire`; declines not compared with HEAD | decline | crafted | drop | Declines and a non-number are allowed. |
| ce679 | §5.7: a big-operator bound that is a symbol assigned `NaN` stays unevaluated | defect | crafted | drop | A symbol assigned `NaN` is a value nobody writes; interpreter case. |
| ce679 | §5.8a: `Block(q ≔ x ↦ Range(1, x); Length(q(n)))` declines on JavaScript | decline | plausible | drop | A decline is always allowed. |
| ce679 | §5.8b: `Apply(D(x ↦ sin(nx), x), 1)` throws "is not a function" on JavaScript | defect (compiled throw) | plausible | fix | Interpreter gives a value; "not compared with HEAD", and F41 (`c12544982`) changed this code: probe first. |
| cache | Acceptance of the evaluation-cache design document (revision 2) | design | none | drop | The record is `docs/plans/2026-10-30-evaluation-cache-architecture.md`; no user decision is recorded here. |

Counts: fix 17, document 2, drop 91, already-in-roadmap 19, keep 1 (130 rows).

## Part 2. Files

| file | work committed? | what the file still holds | delete? |
| --- | --- | --- | --- |
| ce728 | Committed: `2bc8bf007`, `4e334312a`, `a9ff6a17c`, `03fdf6b5f`, `ecb2adb20`, `3fa8a16ad`, `8f7b412df`. Two sets only "STAGED": d4 set at `d78161db6` (debug-sum, fm-async, filter-assert), loop-tuples second set at `de3e6a689`. | 2 open items (rows above); CE-763 already filed. | yes, after `git log` shows the two staged sets as committed. |
| ce662 | `0c1adc21a` (CE-658, CE-661, CE-618, CE-619). CE-662 and CE-683 not done. | CE-662/683 notes; Tycho reply drafts for rows 470, 474, 477, 479. | yes, after the Tycho replies are confirmed posted. Keep the folder `2026-10-30-ce662-first-version/`: ROADMAP CE-662 cites it. |
| psubs | `ef790b069`, `8449b8b4a`, `16b688765`, `6ba8f7aef`, `99c7f8293`, `a13a1e08d`, `6195cec92`. | Items 2-7, 9-12 and CE-692 (rows above). | yes, after one check: the top says changes A to E are committed, but the table says change B in the main tree was the round-1 version, review round 2 owed, CHANGELOG text of B to correct. Confirm in git that the worktree fixes of B landed. |
| ce701 | No code change; CE-695 fix `ddf9650f0`. | CE-701 instruments and plan. | yes (with `2026-10-30-ce691-quadrature/ce701-trace*`), since triage dropped CE-701 to CE-703. |
| ce715 | `8c94c065f`, `df8ea31ad`, `e6bff856b`, `26c2714e2`, `8ce5abc8b`, `783efd4f4`, `5f695f7a8`, `39e19ff3b`, `75116a0d8`, `c5931b092`. Its four next tasks are committed (ce715-nt). | Nothing open. The #503 reply (deferred by the user) is tracked in MEMORY. | yes. |
| i488 | `80a1c36c2`, `52607695f`, `1a95a7f6d`, `ba174fb6c`. | Items 9, 14, 15, 18, 23-39 (rows above). | yes. The folder `2026-10-31-issue488-followups/` holds CE-707 patches; ROADMAP CE-707 does not cite it. |
| mapaw | No hash given (eager operators fixed, CHANGELOG entry named). | Only the pointer to CE-111.4. | yes: CE-111.4 holds the measured cases. |
| ready | Many: `9a7ef0a3f`, `b386f54e4`, `b28d3060b`, `d8434f6d8`, `20e7ec8cb`, `8bd1739a0`, `d597ba836`, `e7f44db97`, `52dc75583`, `7e4c03f65`, `c397fe871`, `2359f8587`, `225f1f54c`, `eed639000`, `ff4b402c6`, `d78161db6`, `a482c7253`, `f3832914e`, `237d1ce7c`, `03210915e`, `d3d7ea7a7`, `404ddcba3`, `bd9e1c934`, `c12544982`, `9f62944bc`, `a4abc3c5e`. | Decision entries already in ROADMAP; F10, F16, F19, F26-F28, F33, F35 (rows); F38-F60 in `part-fb.md`. | yes, after the user decides on the worktrees `ce107`, `ce127`, `ce613`, `f33` (kept for decisions) and F10's commit is confirmed. |
| ce715-7c | `4d4ae1926`, `1dc24d9de`, `d1f28962f` (and `450e1ad49`). | Item 2 (CE-751), item 6. | yes. |
| ce715-nt | `3b93336a0`, `439256ffd`, `d62a7698f`, `c67baf167`, `c4e0a3bdb`, `532df8add`. | Items 1-7 (all done or mapped by ce715-7c). | NO: ROADMAP CE-751 cites "item 2" of this file. Copy its example into CE-751 first. |
| ce725 | `5ec918748`, `fed5b1762`, `9dcd0a9aa`, `4d746e6b7`, `ab60fb299`, `caa2192c3`, `e3cea713d`, `5d517c4af`, `a200686b7`, `de3e6a689`, `35650d9d2`, `aaccfcf04`. | Items 2-11, 14-20, 23-26 (rows above). | yes. Remove the worktrees `/tmp/wt-compute-engine-e4-full` and `/tmp/wt-compute-engine-e4-ce728`. |
| ce712-1 | Text says "Applied and staged" (session 3b); ce725 names `5b60e6081` as the CE-712.1 commit. | Older defects listed as "not filed yet" (rows above). | NO: ROADMAP CE-712 cites section "Applied and staged" of this file. Copy what CE-712 needs into the entry first. |
| ce712-2 | — | The file does not exist in `docs/scratch/`. MEMORY live state still names it ("older defects found in CE-712.2 reviews, last NEXT TASKS paragraph"). | Not classified: those items have no row. Find the file (another worktree or commit) or remove the MEMORY pointer. |
| f684 | No commit hash; the work it follows waited to stage (entry `compute-engine-79`). | Items 1-24 and the on-demand ideas (rows above). | yes. |
| ce679 | Nothing committed; work in `/tmp/wt-compute-engine-2c-ce679` and `2026-10-30-ce679-worktree.patch`. | The CE-679 change (user decision 2026-10-30) and its §5 list. | NO: the `keep` row. The user decides whether to drop the worktree and the patch (triage dropped CE-679). |
| cache | No source change; ROADMAP CE-628 edit. | Design acceptance; worktrees `/tmp/wt-compute-engine-aa-cache`, `/tmp/wt-compute-engine-aa-cache2`. CE-647 and CE-648 are not in ROADMAP or the triage. | yes; remove both worktrees. |
