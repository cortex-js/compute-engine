# ROADMAP triage, 2026-11-01

Source: the six part files in this folder, classified from the frozen snapshot `ROADMAP-snapshot.md` by six read-only agents. Buckets: `fix` (do the work), `document` (one line in the known-limitations list of docs/COMPILATION-MODEL.md, entry deleted), `drop` (entry deleted), `keep` (a decision or design that the user owns; the reason says what the agent would do), `ask` (a `proposed` entry with a `corpus` witness: the brief had no bucket for it; the reason says what the agent would do), `unsure` (the agent could not tell).

## Counts

| bucket | rows |
| --- | ---: |
| fix | 64 |
| document | 4 |
| drop | 197 |
| keep | 36 |
| ask | 38 |
| unsure | 2 |
| total | 341 |

| witness | rows |
| --- | ---: |
| crafted | 93 |
| none | 83 |
| plausible | 83 |
| corpus | 82 |

## ask (38)

| part | CE | state | kind | witness | reason |
| --- | --- | --- | --- | --- | --- |
| B | CE-131 | proposed | design | corpus | [fix] Proposed with a Fungrim corpus count (87 entries); brief gives no bucket for a proposed capability with corpus; suggest keep for user. |
| B | CE-148 | proposed | capability | corpus | [fix] Proposed capability with issue #396; brief gives no bucket for proposed with corpus; suggest keep for user. |
| B | CE-153 | proposed | capability | corpus | [fix] Proposed capability with PR #410; brief gives no bucket for proposed with corpus; suggest keep for user. |
| B | CE-158 | proposed | capability | corpus |  [fix] Proposed capability with issue #352; brief gives no bucket for proposed with corpus; suggest keep for user. |
| B | CE-159 | proposed | capability | corpus |[drop] Proposed, low priority; Fungrim entry `4099d2`; unclear whether Fungrim counts as corpus; suggest drop. |
| B | CE-165 | proposed | capability | corpus | [drop] Proposed performance capability against the Fateman benchmark; brief gives no bucket for proposed with corpus. |
| B | CE-166 | proposed | capability | corpus | [drop] Proposed; DSolve audit benchmark shows 0 wrong; sub-items demand-paced; suggest drop. |
| B | CE-167 | proposed | capability | corpus | [drop] Proposed; Wester suite has one skip left; sub-items demand-paced or algorithmic projects; suggest drop. |
| B | CE-170 | proposed | capability | corpus | [fix] Proposed Rubi coverage work with benchmark scores, no wrong results; brief gives no bucket for proposed with corpus. |
| C | CE-186 | proposed | capability | corpus | [fix] Proposed capability with issue #405; brief has no bucket for proposed plus corpus; result is an honest `NaN` by user decision. |
| C | CE-188 | proposed | capability | corpus | [drop] Proposed capability naming issue #340; interpreter declines (stays unevaluated); recommend drop unless the issue asks for these points. |
| C | CE-189 | proposed | capability | corpus | [drop] Proposed capability naming issue #340; interpreter decline above order 400; recommend drop unless the issue asks for it. |
| C | CE-193 | proposed | capability | corpus | [drop] Proposed capability naming issue #353; interpreter declines; recommend drop unless the issue asks for these regions. |
| C | CE-207 | proposed | capability | corpus | [drop] Proposed capability naming issues #340 and #353; interpreter declines, never a wrong number; recommend drop unless the issues ask. |
| C | CE-297 | proposed | capability | corpus | [fix] Tycho request (repro file, Tycho reply) that "CE accepted"; the header makes a Tycho request `ready`, the label says `proposed`. |
| C | CE-302 | proposed | capability | corpus | [drop] Tycho field data, but user decision 2026-08-19 says do it only for a workload that is not self-inflicted; recommend drop. |
| C | CE-303 | proposed | capability | corpus | [drop] Proposed capability with the MathNet and MATH corpus sweep; brief has no bucket for proposed plus corpus. |
| C | CE-311 | proposed | task | corpus | [fix] User decision 2026-08-18 approves the work and the text says the stage can start; label `proposed` conflicts; recommend fix. |
| D1 | CE-693 | proposed | capability (declines) | [drop] corpus | Proposed (waits for a user request) but names GitHub #488; the brief has no bucket for proposed with a corpus witness. |
| D1 | CE-573 | proposed | capability | corpus | [drop] Proposed with Tycho row 463 and a user "not now" decision 2026-10-27; maybe drop (e) as tracked by the Tycho row. |
| D2 | CE-568 | proposed | performance | corpus | [fix] Proposed performance idea names Tycho `hyvhlz4chj` but no measured cost; no bucket fits a proposed non-defect with a corpus witness. |
| D2 | CE-253 | proposed | capability | corpus | [fix] Proposed optimization counts 24 corpus `Array.from` sites but no measured cost and no wrong value; no bucket fits. |
| E | CE-689 | proposed | performance | corpus | [fix] Proposed with corpus (GitHub #487, 3.5x boxing regression measured); I would choose keep. |
| E | CE-618 | proposed | performance | corpus | [drop] Proposed with corpus (Tycho row 476 program); I would choose drop: first cost fixed, (a) needs decision, rest needs the CE-535 design. |
| E | CE-624 | proposed | capability | corpus | [fix] Proposed with corpus (Tycho row 476 definitions; `NIntegrate` gives NaN with jit off); I would choose keep. |
| E | CE-536 | proposed | performance | corpus | [fix] Proposed with corpus (Tycho document `2ki2hjsouf`, benchmark reproduction, 1.6 s); I would choose keep. |
| E | CE-531 | proposed | performance | corpus | [fix] Proposed with corpus (chain of Tycho row 453); I would choose to merge into the CE-535/CE-321 design (same cause). |
| E | CE-313 | proposed | performance | corpus | [fix] Proposed with corpus (Tycho 29-piece path); text says "fix with that design" (CE-321); I would choose to merge into CE-321. [agree] |
| E | CE-324 | proposed | performance | corpus | [fix] Proposed with corpus (Epsil corpus report programs above 5 s); I would choose drop: text names CE-325 as the common cause. |
| E | CE-325 | proposed | performance | corpus | [fix] Proposed with corpus (Project Euler corpus programs, 20 s); I would choose keep. |
| E | CE-329 | proposed | performance | corpus | [fix] Proposed with corpus (issue #386); JavaScript part done, Python target copy remains; I would choose keep. |
| E | CE-334 | proposed | performance | corpus | [fix] Proposed with corpus (Tycho document `hyvhlz4chj`); I would choose drop: measured no gain on that workload; same cause as CE-321. |
| E | CE-335 | proposed | performance | corpus | [fix] Proposed with corpus (Rubi test problem 1.2.2.4 #214); I would choose drop; CE-335.3 is an audit of radical-to-float folding with no witness. |
| E | CE-337 | proposed | performance | corpus | [fix] Proposed with corpus (Tycho document `s8ishknvhe`); I would choose drop: text says Tycho's own lowering was the cause. |
| E | CE-349 | proposed | performance | corpus | [fix] Proposed with corpus (benchmark cases vs 0.73.0); I would choose drop: text says "measure before work", no current measurement. |
| E | CE-350 | proposed | performance | corpus | [fix] Proposed with corpus (mpmath benchmark); I would choose drop: low priority, "not a correctness or capability gap". |
| E | CE-351 | proposed | performance | corpus | [fix] Proposed with corpus (symbolic benchmark, plan doc); I would choose keep, after a new measurement (gap not measured after 0.124.3). |
| E | CE-442 | proposed | performance | corpus | [fix] Proposed with corpus (Tycho row 424, 0.5 s per evaluation); I would choose keep. |

## unsure (2)

| part | CE | state | kind | witness | reason |
| --- | --- | --- | --- | --- | --- |
| C | CE-306 | proposed | design | crafted | [fix] Status records user decision 2026-10-23 that gives the rule; if that counts as approval, `fix`; otherwise drop (crafted). |
| C | CE-310 | proposed | design | plausible | [fix] Status records user decision 2026-10-23 that gives the rule; if that counts as approval, `fix`; otherwise drop. |

## keep (36)

| part | CE | state | kind | witness | reason |
| --- | --- | --- | --- | --- | --- |
| A | CE-707 | decision needed | defect | corpus | GitHub #488; list value for scalar declared result. Recommend keep: corpus witness, interpreter type does not hold value. |
| A | CE-545 | decision needed | types | crafted | Needs an operand declared with the wide CE-502 form. Recommend drop: crafted typing question, row 468 part already decided. |
| A | CE-27 | design needed | design | plausible | `First(W)` with `W: list<any> := []` typed `unknown`, value `Missing`. Recommend keep: user decision 2026-10-20 made it a design item. |
| A | CE-51 | design needed | design | none | Protocol design (decision P8 of TYPE_SYSTEM_ROADMAP). Recommend keep: recorded design decision, no defect to drop. |
| A | CE-58 | decision needed | defect | plausible | Top-level Epsil `let f: () -> number = writer` installs a writer without `scope`. Recommend keep: effects contract question, plausible program. |
| A | CE-443 | design needed | types | crafted | Needs a pure literal nested 9 deep; answer `any` is the safe direction. Recommend drop. |
| A | CE-682 | decision needed | defect | crafted | `Linspace(0, +∞, 3)` reads disagree; an infinite endpoint is a value nobody writes. Recommend drop. |
| A | CE-71 | design needed | design | none | Record-field omission design (Q5, Q10 of a plan). Recommend keep: open design question, no defect to drop. |
| A | CE-74 | design needed | design | plausible | `Map(x ↦ If(x > 1, Nothing, x), [1, 2, 3])` typed without `nothing`; `Zip` loses elements. Recommend keep. |
| B | CE-752 | decision needed | defect | plausible | `Block(Declare(y,'real'), [y])` evaluated again gives `[5]`; interpreter wrong value, recommend keep. |
| B | CE-739 | design needed | design | crafted | Needs a list condition with an action branch (`If(M[1], p ≔ 5)`, `M: list<any>`); compiler already declines; recommend drop. |
| B | CE-709 | decision needed | wrong value | crafted | Witnesses are floats nobody writes (`x = 10.0000000000001`, `x² = -1e-20`); recommend drop after documenting option (b). |
| B | CE-657 | design needed | wrong value | crafted | Needs a host operator declared `pure: false` or one node reused across seeds; four designs failed; recommend drop. |
| B | CE-649 | design needed | defect | crafted | Hang needs an async host handler that evaluates its own containing node; recommend drop. |
| B | CE-610 | decision needed | defect | corpus | Tycho row 426 case 12; only a log line under jest, values right; recommend keep (option (a) is small). |
| B | CE-534 | design needed | defect | plausible | `replace({match: 'j', replace: 10}, {recursive: true})` rewrites a `Sum` index; recommend keep. |
| B | CE-91 | design needed | design | none | Design of value capture and view reads (plan Q11); no reproduction in the entry; recommend keep (probes exist in a plan). |
| B | CE-103 | decision needed | defect | crafted | Needs `Pi` declared locally plus a `.json` round trip inside that scope; recommend drop (option (c), document). |
| B | CE-107 | decision needed | defect | corpus | Tycho row 394; `isSame` false, values right; recommend keep until the user takes option (a). |
| B | CE-123 | design needed | design | none | Validation phase idea, "do it when a third instance appears"; recommend drop. |
| B | CE-127 | decision needed | defect | plausible | `A_{i+1}` keeps a non-canonical index; recommend keep (option (a) marker). |
| B | CE-613 | decision needed | defect | plausible | `lim e^{√x}/x^5` at ∞ gives 0, should be +∞; recommend keep (option (c)). |
| B | CE-143 | design needed | design | none | Soundness of the float margin for poles; no reproduction; recommend drop. |
| B | CE-168 | design needed | capability | none | Wester problems with no CE API; recommend drop (no consumer, several "not planned"). |
| C | CE-600 | design needed | defect | plausible | Two engines with different precisions in one host; recommend keep: an engine computes at another engine's precision. |
| C | CE-690 | design needed | defect | corpus | GitHub issue #494; recommend keep (CE-690.1 is decision needed, also keep). |
| C | CE-179 | design needed | wrong value | crafted | Arguments such as `(25! − 1)/48` chosen next to a jump of `Floor`; recommend drop. |
| C | CE-441 | design needed | defect | plausible | `((x,y)\mapsto xy)((3,4))` changes value through a LaTeX round trip; recommend keep. |
| C | CE-312 | decision needed | defect | plausible | Recommend keep for CE-312.1 and .2; CE-312.3 and .4 name a fix that needs no decision (fix). |
| D1 | CE-646 | design needed | enhancement | corpus | Names PR #500 and issue #499; recommend drop: current state is a sound decline and the lazy-view witness is crafted. |
| D2 | CE-592 | design needed | defect | plausible | `a := 5; h(t) := t + a` makes `compileFieldFunction` decline with a remedy (declare `a`); recommend drop: a decline is allowed. |
| D2 | CE-218 | design needed | capability | corpus | Lifts refusals of `Nothing`-capable sources (Tycho 332); recommend drop: the refusals are declines and `NaN` for `Nothing` is allowed. |
| D2 | CE-264 | design needed | capability | crafted | `g(1/w - 1/w)` with an `infinity` clause; the set declines today; recommend drop: a decline is allowed and the witness is crafted. |
| E | CE-638 | decision needed | defect | plausible | User owns the parse decision; `h(p, a) := p(a)` gives a silent product; I would choose keep. |
| E | CE-535 | design needed | performance | corpus | User owns the cache-key design; Tycho document-open benchmark; I would choose keep, as one design with CE-531, CE-321, CE-334. |
| E | CE-321 | design needed | performance | corpus | User owns the type-cache key design; Tycho reproduction script; "no document is blocked"; I would choose keep, merged with CE-535/CE-531/CE-334. |

## document (4)

| part | CE | state | kind | witness | reason |
| --- | --- | --- | --- | --- | --- |
| D1 | CE-756 | ready | wrong value | crafted | javascript; in a loop with outer `a = 100`, `function f() { a }; let (a, b) = (k, f())`; compiled `b = k`; interpreter `b = 100`. |
| D1 | CE-742 | ready | wrong value | crafted | javascript; `Map(t ↦ 7, LL)` with `LL: list<list<real> \ |
| D1 | CE-735 | ready | wrong value | crafted | [fix] javascript; `Loop(If(x > 1, Break(3), Break(3)))` with `x: real` at 2; compiled `undefined`; interpreter 3. |
| D2 | CE-287 | ready | defect | crafted | [drop] glsl on ANGLE over Metal (WebGL2, Apple GPU): `z + _gpu_inf()` (a constant infinity added to a value) gives 0; interpreter gives `Infinity`. |

## fix (64)

| part | CE | state | kind | witness | reason |
| --- | --- | --- | --- | --- | --- |
| A | CE-40 | ready | defect | plausible | CE-40.2: `(xs) ↦ (xs \ |
| A | CE-754 | ready | defect | plausible | Chained `At` types wrong: `At(L, 1, "a")` with `L: list<record{a: real}>` typed `error` though the read is valid. |
| A | CE-665 | ready | wrong value | plausible | Interpreter: `Power((1, 2), [3, 4, 5])` evaluates to `[1, 16]`, typed `vector<3>`; should be `incompatible-dimensions`. |
| A | CE-666 | ready | defect | plausible | Interpreter: `[If(0 < u, Nothing, (1, 1)), (2, 3)]` has `count` 2 but one element when the condition is true. |
| A | CE-70 | ready | defect | plausible | CE-70.2: Epsil `if !isMissing(v) { let g = () => f(v) … }` is still reported; plan decisions P1 to P5 exist. |
| A | CE-72 | ready | defect | plausible | `Scan` over a source declared `list<integer \ |
| A | CE-79 | ready | capability | corpus | Ready with user decision 2026-10-06; GitHub issue #416 (`Last(Range(1, 10^20))` stays unevaluated). |
| A | CE-81 | ready | defect | plausible | `let big = filter(1..oo, c => c > k)`, later `k = 10` changes `first(big)` from 4 to 11. |
| A | CE-82 | ready | defect | plausible | `Q := [(1, 2), (3, 4)]`, `x := 5`: `Q + x` typed a list of points, evaluates to a list of errors. |
| B | CE-692 | ready | design | plausible | Ready with user decisions dated 2026-10-30 and a plan; `Sum(j + k, …).subs({j: k})` gives 12. |
| B | CE-607 | ready | defect | plausible | `Expand((r(t) + 1)^2)` with `r` declared `random` makes three draws from one. |
| B | CE-608 | ready | defect | plausible | `Block(Assign(Tuple(a, b), Tuple(1, 2)), Add(a, b)).unknowns` is `['a', 'b']`, should be `[]`. |
| B | CE-537 | ready | defect | plausible | `Exists(y < x, x)` and `{x² |
| B | CE-539 | ready | defect | plausible | Compiling a user-function call to a shader changes the declared type of free `x`, `y` to `number` for the engine life. |
| B | CE-105 | ready | defect | plausible | Epsil `let v = Ln("a") + Ln(2)` underlines the whole call; error frames name wrong operands. |
| B | CE-111 | proposed | capability | corpus | CE-111.4 approved 2026-10-31 (async iterator, spec ready); CE-111.1, .5 are design (keep); rest proposed under issue #392. |
| B | CE-124 | ready | defect | corpus | Tycho ask 296 with a Tycho repro script; `Which` over `foo(L)` blows up to 52 MB. |
| B | CE-133 | ready | defect | corpus | Test-suite markers; CE-133.3 is the `grudnitski` equivalence benchmark (9 skipped groups); CE-133.1/.2 have no program (would be drop). |
| B | CE-135 | ready | defect | plausible | `Subscript(a, k)` inside a `Sum` over `k` fuses to `a_k` and loses the index binding. |
| B | CE-738 | ready | wrong value | plausible | `Integrate(Block(c ≔ 2; c·x), Limits(x, 0, 1)).evaluate()` gives 2, `.N()` gives 1. |
| B | CE-137 | ready | defect | corpus | Tycho row 412; `Solve(t^3 x = 1, t)` stays unevaluated (CE-137.1); CE-137.3 only skips an optimization (would be drop). |
| B | CE-141 | ready | defect | corpus | Integration-families benchmark audit lists 8 Rubi values `simplify()` cannot reduce; CE-141.3 is a question. |
| B | CE-142 | ready | defect | plausible | `\sum_{k=0}^\infty (-2)^k` simplifies to `~oo`; `simplify()` misses telescoping that `evaluate()` finds. |
| B | CE-151 | ready | defect | crafted | [drop] User decision 2026-10-17 approves the derivative proof; the witness (roots 1e-8 apart) is crafted and today's result is correct. |
| B | CE-173 | ready | defect | corpus | Issue #189 names the simplification case. |
| B | CE-175 | ready | defect | plausible | `Sum(j, Limits(i,5,5), Limits(j,i,10))` stays symbolic; a dependent bound is an ordinary double sum. |
| C | CE-599 | ready | defect | plausible | Interpreter gives `NaN` for a finite double integral of `1/r` around an interior point (about 1.9451). |
| C | CE-181 | ready | wrong value | plausible | Textbook integral `∫_2^∞ dx/(x ln^{1.1} x)` gives a wrong value (wide error) for `10.3733`; CE-181.4 is "not a defect", drop. |
| C | CE-182 | ready | wrong value | plausible | Textbook divergent `∫_2^∞ dx/(x ln x)` gives `4.0 ± 1.5` under `.N()`; `evaluate()` gives `+∞`. |
| C | CE-185 | ready | defect | plausible | CE-185.3: divergent `∫₀^½ dt/(t·ln t)` gives `-6.9 ± 1.6`; CE-185.1, .2, .6, .7 crafted and .9 no reproduction: drop. |
| C | CE-187 | ready | wrong value | plausible | `.N()` of a nested `∫∫ e^{-xy}/x^{0.99}` reports an error 1e5 times smaller than the true error. |
| C | CE-192 | ready | defect | plausible | `Hypergeometric2F1(-6.937, -4.123, 4.354, -0.662).N()` has `3.7e-11` relative error at machine precision. |
| C | CE-206 | ready | defect | plausible | Interpreter inaccuracies pinned in tests: bignum `Arccos` near 1 loses about 8 digits, `ζ(−0.5)` 4 ulp off. |
| C | CE-291 | ready | defect | plausible | `\int \frac{dx}{x}` with `diagnostics: true` reports an undeclared symbol `d`. |
| C | CE-293 | ready | defect | plausible | `Multiply(3, x, Power(y, -1))` round-trips through `\frac{3x}{y}` as `Divide(Multiply(3, x), y)`. |
| C | CE-296 | ready | defect | plausible | User decision 2026-10-01; `Integrate(x·y, Limits(x, 0, 2y), Limits(y, 0, 1))` gives `y²`, not `1/2`. |
| C | CE-305 | ready | defect | plausible | `@fixme` parser cases such as `\vec{AB}` and pre-subscripts `_p^qx`. |
| D1 | CE-755 | ready | wrong value | plausible | interval-js emits `if ('false')`; a sum loop with a Break condition gives `[0, 0]`, interpreter 15. |
| D1 | CE-751 | ready | wrong value | plausible | `Map(g, L)` with `L: list<number>` at `[1+i, 2]` gives `[null, null]`; user decision 2026-11-01 option (a). |
| D1 | CE-715 | ready | capability | corpus | Declines of the `bigint` mode, named for GitHub #503; check that #503 needs these shapes, else drop as declines. |
| D1 | CE-749 | ready | wrong value | plausible | Interpreter: `Map(t ↦ 2t, PM)` gives `Missing` where the named form gives `NaN`, against the 2026-09-22 rule. |
| D1 | CE-743 | ready | wrong value | plausible | Python `Block(q ≔ t ↦ 2t, q(p))` with `p = (3, 4)` gives `(3, 4, 3, 4)`; interpreter `(6, 8)`. |
| D1 | CE-741 | ready | wrong value | plausible | `g := x ↦ If(x > 0, Mod(x, 3), x)`, `g(Sqrt(y))` at y = 16 gives 4 in complex/auto mode; interpreter 1. |
| D1 | CE-722 | ready | documentation | crafted | Ready with user decision 2026-11-01 option (a); remaining work is one example in `docs/COMPILATION-MODEL.md`. |
| D1 | CE-712 | ready | design decided | corpus | User decision 2026-10-31 option (A); steps CE-712.3 to .5 remain; corpus audit counts cited. |
| D1 | CE-651 | ready | wrong value | plausible | interval-js loop with `If(i > x, Break)` at `x = 2` gives the point interval 6; interpreter 4. |
| D1 | CE-652 | ready | wrong value | plausible | `Sum(n, Limits(n, 1, n))` with an outer `n = 5` gives 1 on JavaScript; interpreter 15; GLSL/WGSL read the index too. |
| D2 | CE-216 | ready | defect | plausible | [fix] `p: list` (or `any`) holding `[[1,2],[3,-4]]`: compiled `p^2` is entry-wise, interpreter gives matrix power `[[7,-6],[-9,22]]`; wrong finite values (also .1, .2, .4). |
| D2 | CE-233 | proposed | capability | corpus | Epsil corpus report counts declines from missing integer and string lowerings (`IntegerDigits` 7, ...); a corpus decline. State is proposed. |
| D2 | CE-244 | ready | defect | corpus | 244.2: Tycho document `neyret/hpr2q4kles` declines where the interpreter gives 1.024; cause and fix are stated. |
| D2 | CE-249 | ready | defect | corpus | Tycho `s8ishknvhe`: `AsOklab(Hsv(57.29·PointX(A_rg(C)), 1, 0.5))` declines on javascript; 249.3 (no witness) is drop. |
| D2 | CE-269 | proposed | capability | corpus | Tycho census: four terrain triangle rows of `art/nxlddeh5zv` decline at the fold-size guard; a corpus decline. |
| D2 | CE-270 | proposed | capability | corpus | Census of 0.171.0 on the Tycho corpus lists declines per target (270.1 to 270.4); corpus declines. |
| D2 | CE-272 | ready | capability | corpus | 272.2: Tycho `5qn5kcrszu`, 6 javascript records decline (Tycho item 206); 272.1 (no witness) and 272.3 (zero demand) are drop. |
| D2 | CE-280 | proposed | capability | corpus | 280.1: GLSL `Integrate` declines on a corpus row (1 row in CE-270.3), direction decided 2026-10-17; other sub-items drop (no witness; 280.9 allowed). |
| E | CE-603 | ready | performance | corpus | Tycho ledger row 474 with instrument; Tycho request is ready by the header rule; user decision 2026-10-28 keeps it open. |
| E | CE-639 | ready | defect | plausible | One-line integrand `(g \coloneq t\mapsto t^2; g(x))` gives `incompatible-type` error instead of 1/3. |
| E | CE-640 | ready | defect (consistency) | plausible | Interpreter: `.N()` stays unevaluated where `evaluate()` reports `expected-function`; short program, no decision needed. |
| E | CE-625 | ready | defect (wrong values) | plausible | Interpreter wrong value: `Limit(x ↦ h(g, x), 2)` gives `["p", 2]`, should give 4; two-line definitions. |
| E | CE-532 | ready | design | corpus | Tycho row 453 request is ready by the header rule; status line records no dated user approval of the `ce.withValues` API. |
| E | CE-314 | ready | capability | corpus | Ready with user decision 2026-10-20 in status; Tycho row 441; only CE-314.1 (c) remains open. |
| E | CE-343 | ready | performance | corpus | Tycho ask 296, document `s8ishknvhe` measured; Tycho request is ready by the header rule. |
| E | CE-346 | ready | performance | corpus | Tycho item 177 with repro script; ready Tycho request. CE-346.1 is conditional on Tycho's compile-time requirements failing. |
| E | CE-540 | ready | defect | corpus | CI failures on `main` run of `a23be5735` and PR #482. |

## drop (197)

| part | CE | state | kind | witness | reason |
| --- | --- | --- | --- | --- | --- |
| A | CE-753 | ready | wrong value | crafted | Indexing a scalar argument; the only effect shown is compiled `NaN` where the interpreter gives an error, which the caveats allow. |
| A | CE-729 | proposed | capability | none | Proposed capability (defaults in overloaded signatures); no corpus witness. |
| A | CE-730 | proposed | capability | none | Proposed capability (library operator defaults); no corpus witness. |
| A | CE-731 | proposed | capability | none | Proposed capability; text says "not requested so far", #490 is covered by defaults. |
| A | CE-524 | proposed | wrong type | plausible | State is proposed and it names no corpus witness (calls with a set, a character, a list of strings). |
| A | CE-55 | proposed | capability | none | Proposed; text says do this only when a consumer declares lazy operators with arrow slots. |
| A | CE-56 | proposed | design | none | Proposed, low priority; no reproduction from a host. |
| A | CE-57 | proposed | capability | none | Proposed; "do not build before a consumer asks". |
| A | CE-61 | proposed | capability | none | Proposed; direction decided but no approval to start and no corpus witness. |
| A | CE-63 | proposed | capability | none | Proposed deferred items and known limits; "no action unless a user asks". |
| A | CE-64 | proposed | capability | none | Proposed; CE-64.3 lists Python declines only, which the caveats allow. |
| A | CE-66 | proposed | capability | none | Proposed capabilities of typed function literals; no corpus witness. |
| A | CE-67 | proposed | capability | none | Proposed signature-language capability; no corpus witness. |
| A | CE-492 | proposed | design | none | Proposed design change to the `Field` static check; no corpus witness. |
| A | CE-679 | ready | defect | crafted | [drop] Needs `n: number` holding `NaN`; compiled values where interpreter has none are allowed. Note: user-decided fix waits in a worktree. |
| A | CE-667 | ready | defect | crafted | Needs a list of `When` elements beside a point; result is error cells either way, only the refusal point differs. |
| A | CE-661 | fixed | capability | corpus | Text says fixed in `0c1adc21a`, delete at release (Tycho row 477). |
| A | CE-466 | proposed | task | crafted | Proposed precision task; text says the type is sound. |
| A | CE-384 | proposed | capability | crafted | Proposed; user decision 2026-10-23 says the reduction stays; witness needs a chosen union. |
| A | CE-77 | ready | defect | crafted | Needs the union `record{a: integer} \ |
| A | CE-80 | ready | defect | none | Only CE-80.3 remains: compiled array memory growth, a performance item without a measurement. |
| A | CE-83 | ready | defect | crafted | Needs a literal `Missing` inside `Join` under a lazy `Map`; result stays unevaluated instead of `Missing`. |
| A | CE-85 | ready | defect | crafted | Needs two undecided restriction conditions `[1,2]\{a>0\} + 2\{b>0\}`; values agree once both are decided. |
| A | CE-88 | ready | defect | none | No reproduction program: only "a symbolic-length Range before its bound resolves" is described. |
| A | CE-89 | proposed | performance | none | Proposed, low priority performance; no measurement. |
| A | CE-90 | proposed | capability | none | Proposed; text says add handlers "when there is demand". |
| B | CE-698 | proposed | capability | none | Proposed capability (more precise substitution); the sound decline is in place; no corpus witness. |
| B | CE-694 | ready | wrong value | crafted | Needs a `Sin` rebound in a nested scope, or `(25! − 1)/24!` under `.N()`; not probed; crafted interpreter defect. |
| B | CE-660 | proposed | design | crafted | Proposed, design on hold by user; witness needs a list input with no value; no corpus. |
| B | CE-621 | ready | defect | crafted | Needs a nested `evaluateAsync()` from a handler without a context stack; only extra host calls, no wrong result. |
| B | CE-609 | proposed | capability | plausible | Proposed known limit (`g(N)` keeps the operator); Tycho row 473 is only where it was found, not a witness. |
| B | CE-590 | proposed | defect | crafted | Proposed, user accepted the limit 2026-10-28; needs a scope pushed and popped across a checkpoint window. |
| B | CE-587 | known limit | defect | corpus | User decision 2026-10-28: no change; the entry records a decided limit, no work remains. |
| B | CE-92 | proposed | task | none | Proposed task with no witness. |
| B | CE-97 | ready | defect | crafted | Interpreter stays unevaluated only for `Determinant(Scan(m, Add))` or an empty `p`; crafted interpreter gap, compiled value not wrong. |
| B | CE-108 | ready | defect | crafted | Needs `ce.declare('e', 'error')`, a symbol declared of type `error`; crafted. |
| B | CE-109 | ready | defect | none | No reproduction: missing `ErrorTrace` frames described by handler names and line numbers only. |
| B | CE-112 | ready | wrong value | crafted | `WithRandomSeed(7, Repeat(Map(u ↦ Random(), …), 2)).isPure` only; crafted construct combination. |
| B | CE-113 | proposed | design | none | Proposed design, user decision "not now"; no corpus witness. |
| B | CE-117 | ready | defect | crafted | Needs overflowing complex cells or entries of 1.5e308; values nobody would write. |
| B | CE-118 | ready | wrong value | crafted | Needs a user function named like a library operator (`Add`, `Sinh`) shadowing it; crafted interpreter defect. |
| B | CE-126 | proposed | capability | none | Proposed capability (more effect handlers); "build it when a host asks". |
| B | CE-128 | proposed | capability | none | Proposed; entry says "no known user report". |
| B | CE-130 | proposed | design | none | Proposed design; behavior pinned by an `@fixme` test, no witness program. |
| B | CE-132 | ready | defect | none | Four bare item titles with no reproduction. |
| B | CE-134 | ready | defect | none | A `@todo` in `parse.ts`; no reproduction. |
| B | CE-507 | phases 1-3 done | capability | corpus | Phases done (#477 closed); open sub-items wait for a host (CE-507.12), are unreachable (.5) or user-deferred (.7). |
| B | CE-144 | proposed | capability | none | Proposed capability; no corpus witness. |
| B | CE-145 | proposed | question | plausible | Proposed question about a float `0` term; no corpus witness. |
| B | CE-146 | ready | defect | none | Values correct; large-result size issue without a concrete matrix or measurement. |
| B | CE-149 | proposed | capability | none | Proposed capability (more complete `Solve` answers); no corpus witness. |
| B | CE-404 | proposed | capability | none | Proposed capability; no corpus witness. |
| B | CE-160 | proposed | capability | none | Proposed; "only when a concrete workflow needs it". |
| B | CE-162 | proposed | capability | none | Proposed capability; no corpus witness. |
| B | CE-164 | proposed | capability | none | Proposed; entry says the Wester gaps are harness artifacts; sub-items have no witness. |
| B | CE-169 | proposed | capability | none | Proposed; CE correctly stays inert today; no corpus witness. |
| B | CE-171 | proposed | capability | none | Proposed capability; no corpus witness. |
| B | CE-172 | proposed | capability | none | Proposed; acceptance tests are `test.skip` in the repo, no corpus witness. |
| B | CE-174 | proposed | capability | none | Proposed; entry says "not planned". |
| C | CE-672 | ready | defect | crafted | `+∞·[∫x^x, 0]` is a value nobody writes; the difference is `NaN` against `Indeterminate`, `Measurement` against unevaluated. |
| C | CE-696 | ready | wrong value | crafted | A step of area `1e-12` at `1e-8` from 0, from a sweep of chosen features; interpreter, not a document case. |
| C | CE-697 | ready | wrong value | crafted | Sweep case: a bump of height `1e-8` at `1e-3` from a pole; other limits not measured. |
| C | CE-701 | ready | wrong value | crafted | A step of height `1e74` on `[0, 1e-80]` from a sweep; text also says the fix needs a user decision. |
| C | CE-702 | ready | wrong value | crafted | A step of area `1e-6` on `[0, 1e-80]` from a sweep; text says the fix needs a decision on cost. |
| C | CE-703 | proposed | accuracy | none | Proposed, no corpus witness; what tanh-sinh gives is not measured. |
| C | CE-561 | ready | defect | crafted | An interval one double wide, `[1, 1 + ε]`. |
| C | CE-559 | ready | defect | crafted | A logarithm with its singularity `10⁴` doubles outside the endpoint `e = 10⁵`. |
| C | CE-560 | ready | defect | crafted | Text says no engine route reaches it: every caller passes `singularEndpoints: true`. |
| C | CE-541 | ready | defect | none | No reproduction; CE-187 holds the reachable case of the same cause with a witness. |
| C | CE-180 | ready | wrong value | crafted | Operands such as `(−10³⁰+1)/10³⁰` and `1 + 10⁻³⁰ + 10⁻⁴⁰⁰i` chosen next to poles and branch points. |
| C | CE-183 | proposed | capability | crafted | Proposed, no corpus; `PolyLog` at orders above 170 and ` |
| C | CE-394 | proposed | defect | crafted | Proposed, no corpus; `∫ x^170 e^-x` at the double overflow edge gives an honest `NaN` (user deferred it 2026-10-23). |
| C | CE-190 | ready | defect | crafted | CE-190.1 is an audit with no reproduction; CE-190.3 (`exp(36)` in a lazy `Map`) is rare, exact flag only. |
| C | CE-191 | proposed | capability | none | Proposed, no corpus; never a wrong order, only a lost answer. |
| C | CE-194 | proposed | capability | plausible | Proposed, no corpus (plan D4 only); note `Sin(1+i).N()` at 50 digits has 16 correct digits. |
| C | CE-195 | proposed | capability | none | Proposed, no corpus; complex eigenvalues stay unevaluated. |
| C | CE-196 | ready | defect | none | No reproduction: "No test covers this case." |
| C | CE-197 | proposed | capability | none | Proposed, no corpus; results stay symbolic, never `NaN`. |
| C | CE-198 | proposed | capability | none | Proposed, no corpus; matrix p-norm stays inert. |
| C | CE-199 | proposed | capability | none | Proposed, no corpus; series stay symbolic, a safe result. |
| C | CE-200 | ready | defect | crafted | Exponent denominators above `3·10⁵`; CE-200.1 is a task; text says ask for a decision only if a consumer relies on it. |
| C | CE-201 | proposed | capability | none | Proposed, no corpus (design doc §10 only). |
| C | CE-202 | proposed | capability | none | Proposed, no corpus. |
| C | CE-203 | proposed | capability | none | Proposed, no corpus. |
| C | CE-204 | ready | defect | none | No reproduction: one sentence, no integrand named. |
| C | CE-205 | ready | defect | none | No reproduction; text says the list ended with "…" and the records are in Git history. |
| C | CE-208 | proposed | capability | crafted | Proposed, no corpus; sweep points with ` |
| C | CE-295 | ready | defect | crafted | Names such as `A_1_2` with `A` a declared matrix, or `x_1_upright`; text says the parser never produces these names. |
| C | CE-298 | ready | defect | none | No reproduction: the entry asks to check whether a shape moves. |
| C | CE-299 | ready | defect | crafted | Inputs such as `2^3[1,2]` and `4]1,2[`; text says each gives a visible error, not a wrong value. |
| C | CE-301 | ready | defect | crafted | About 1,870 nested parentheses; text says realistic input does not reach it. |
| C | CE-304 | proposed | capability | none | Proposed, no corpus. |
| D1 | CE-757 | ready | defect | crafted | Point absent at run time; Python raises `TypeError` where interpreter gives `NaN`: a throw is an allowed difference. |
| D1 | CE-758 | ready | defect | plausible | All sub-items .1 to .8 are declines (or interval-js `success: false`); no corpus witness. |
| D1 | CE-759 | ready | defect | plausible | Python declines a destructuring `let` of a tuple-valued call; a decline with no corpus witness. |
| D1 | CE-760 | ready | defect | crafted | Decline of an out-of-range literal row; the interpreter gives `Missing`. |
| D1 | CE-761 | ready | defect | plausible | A decline (function body ending in a loop, value discarded); no corpus witness. |
| D1 | CE-762 | ready | defect | plausible | GLSL/WGSL decline multi-axis `At`; a decline with no corpus witness. |
| D1 | CE-725 | ready | defect | plausible | `Sort` with callback, `Iterate`, `Pipe` decline on JavaScript; declines with no corpus witness. |
| D1 | CE-719 | ready | decline | plausible | Now a decline (Return in a Loop with code after it); the wrong value is gone. |
| D1 | CE-748 | ready | defect | crafted | Interpreter-only defect; witness is a constant function `g7` mapped over coordinates with three nested `At`s. |
| D1 | CE-747 | ready | capability | plausible | `Sum` over an indexing set declines on every target; a decline with no corpus witness. |
| D1 | CE-746 | ready | wrong value | plausible | interval-js gives `entire`, a sound enclosure; no wrong finite number, an allowed loss of precision. |
| D1 | CE-745 | ready | defect | plausible | Python declines nested `Max`/`Min`; the `np.max(R)` value was never compared, so no wrong value shown. |
| D1 | CE-744 | ready | capability | plausible | Missing callback and `Apply` lowerings: all declines, no corpus witness. |
| D1 | CE-740 | proposed | defect (decline) | crafted | Proposed, and a decline (handler-defined `Which`); no corpus witness. |
| D1 | CE-720 | ready | decline | plausible | Now a decline by user decision 2026-11-01; the remaining work only removes a decline. |
| D1 | CE-721 | ready | decline | crafted | Now a decline (assignment in Comprehension, Sum clause, Integrate); remaining work removes a decline. |
| D1 | CE-723 | ready | decline | crafted | Now a decline (function literal assigns the loop index); remaining work removes a decline. |
| D1 | CE-724 | proposed | decline | plausible | Proposed precise version of a decline; no corpus witness. |
| D1 | CE-733 | ready | defect | crafted | interval-js `Which` declines for an excluded branch; a decline. |
| D1 | CE-734 | ready | defect | crafted | Shader declines (excluded branch of another shape); the emitted value is correct. |
| D1 | CE-736 | ready | defect | crafted | Interpreter gives the symbol `w` (unevaluated); compiled `undefined`, or a value for an input outside its type: allowed. |
| D1 | CE-714 | ready | wrong value | crafted | Interpreter gives an `incompatible-type` error; any compiled value is an allowed difference. |
| D1 | CE-711 | ready | cleanup | none | Superseded 2026-10-31 by CE-712, which does this removal as its step 3. |
| D1 | CE-680 | ready | defect (decline) | plausible | Python declines `Sum(L)`; a decline with no corpus witness (recorded by user decision 2026-10-30). |
| D1 | CE-683 | ready | task | none | Superseded 2026-10-31 by CE-712 (steps 2, 3 and 5). |
| D1 | CE-664 | ready | defect (decline) | plausible | Python declines every user-function call; a decline. Linked to Tycho row 479 only through CE-658. |
| D1 | CE-681 | ready | wrong value | crafted | Interpreter gives `incompatible-type`; compiled 1.5 is an allowed difference (CE-712.4 makes it decline-only). |
| D1 | CE-673 | ready | wrong value | crafted | Interpreter gives `incompatible-type`; compiled `"abc"` is an allowed difference. |
| D1 | CE-674 | ready | wrong value | crafted | f32 overflow of `Smoothstep(-3e38, 3e38, y)` on GPU: the precision of the target, allowed. |
| D1 | CE-675 | ready | defect | none | Not reproduced; no witness. |
| D1 | CE-676 | ready | defect | crafted | Interpreter keeps `ReplaceAt` past the end unevaluated; compiled difference or throw is allowed. |
| D1 | CE-677 | ready | defect | crafted | A non-list value for a `vector<T>` input is outside its type; CE-712.3 removes this guard. |
| D1 | CE-662 | ready | defect | crafted | Interpreter gives `incompatible-type`; compiled 0.5 now allowed. Decision 2026-10-30 overtaken; CE-712.4 keeps only the decline. |
| D1 | CE-611 | proposed | performance | crafted | Proposed, no corpus witness. |
| D1 | CE-635 | ready | defect (performance) | crafted | Measured, but the program is a built graph of shared nodes; crafted interpreter defect not recorded by the user. |
| D1 | CE-630 | ready | defect | crafted | Interpreter reports `read-before-declaration`; compiled throw, or `NaN` in the related case, is allowed. |
| D1 | CE-658 | fixed, not released | defect (decline) | corpus | Fixed in `0c1adc21a`; the entry says delete at the release; Tycho row 479 tracks it. |
| D1 | CE-653 | ready | wrong value | crafted | Interpreter result is the form `Return(0)`, not a number; compiled 1 is an allowed difference. |
| D1 | CE-654 | ready | wrong value | crafted | `Power(Block(y ≔ 1; x), 0)`; JavaScript now throws and shaders refuse, both allowed. |
| D1 | CE-656 | ready | wrong value | crafted | The input `w` is left out; any compiled value is allowed. |
| D1 | CE-643 | ready | defect (speed) | crafted | Measured, but on 160 terms built from shared nodes; crafted, no corpus program. |
| D1 | CE-602 | ready | defect | crafted | Exponential re-box of an invalid literal over a shared graph; both forms end in an error; crafted. |
| D2 | CE-467 | proposed | capability | crafted | Proposed, no corpus; a decline for an input declared `integer \ |
| D2 | CE-209 | ready | defect | none | No reproduction; concerns compiled handling of `Nothing`, which the caveats allow to differ. |
| D2 | CE-212 | ready | defect | corpus | Tycho row 413, but the case is an unsupplied input `y` (input left out): an allowed difference. |
| D2 | CE-227 | ready | defect | crafted | `\sin(x+10^6+10^6i)` on shaders: f32 precision of the target, which the caveats allow. |
| D2 | CE-230 | ready | defect | none | Remaining items (an extra range copy, a wider index type) give no wrong value; speed only, no measurement. |
| D2 | CE-234 | proposed | task | none | Proposed measurement task; 234.1 overflow above 5.6e102 is a crafted magnitude. |
| D2 | CE-237 | proposed | capability | plausible | Proposed; Python declines a block-local function in a loop or after rebinding; declines are allowed, no corpus. |
| D2 | CE-240 | proposed | capability | corpus | Census rows are surfaces and 3-D rows Tycho never draws on interval-js; 240.1 rejected by user decision; 240.3 has no row. |
| D2 | CE-242 | ready | defect | crafted | Comparison with an operand absent from the inputs (input left out): an allowed difference. |
| D2 | CE-245 | ready | defect | crafted | The entry says these are refusals, not wrong values; witness needs a declared point union; no corpus. |
| D2 | CE-247 | proposed | design | plausible | Proposed design; symptoms are round-trip rounding (`0.20000000000000512`, `#ff7f00` vs `#ff8000`) and the hue of black, a different routine. |
| D2 | CE-248 | proposed | design | none | Proposed internal redesign; no reproduction of a wrong value. |
| D2 | CE-250 | proposed | design | none | Proposed; no reproduction, only a note on `widen()` margins. |
| D2 | CE-585 | ready | defect | crafted | Interpreter type depends on read order with an assumption and a recursive list function; no unsound type found; crafted. |
| D2 | CE-565 | proposed | performance | corpus | 565.7 done; 565.6 remaining work does not help Tycho row 470; 565.3 is Tycho side; 565.5 has no witness. |
| D2 | CE-255 | proposed | capability | none | Proposed shader-size idea; no measurement. |
| D2 | CE-259 | proposed | design | crafted | A list supplied for a scalar-typed input is outside its type: an allowed difference. |
| D2 | CE-263 | proposed | design | plausible | Compiled `NaN` where the interpreter gives an error: an allowed difference. |
| D2 | CE-265 | ready | design | corpus | Tycho item 217 is performance only, and Tycho's shipped install is not affected; option only "if a consumer needs"; no approval date. |
| D2 | CE-266 | proposed | design | none | Entry says "Nothing is known to be wrong"; wait for a second case. |
| D2 | CE-267 | proposed | capability | plausible | Proposed; both shapes fail closed and the interpreter answers; declines are allowed, no corpus row named. |
| D2 | CE-268 | proposed | capability | corpus | Corpus rows: interpreter also gives no value (errors); 268.2 value is right (speed only); 268.2 to 268.4 not reproduced. |
| D2 | CE-271 | proposed | capability | corpus | 271.1 gives sound `entire`; 271.2 `D` on interval-js is a design limit (CE-270) needing interval AD; 271.3 has no corpus row. |
| D2 | CE-273 | proposed | performance | crafted | Proposed; a depth-20 shared tower is crafted; no corpus measurement. |
| D2 | CE-275 | proposed | capability | none | Entry says "extensions, not defects": lazy-stream declines are allowed. |
| D2 | CE-276 | ready | defect | crafted | `run(violatingValue)` passes a value outside the declared type: an allowed difference. |
| D2 | CE-277 | proposed | design | none | Compiled ordering of an error operand gives `false` like `NaN`; error vs number difference is allowed. |
| D2 | CE-279 | proposed | capability | corpus | Counts are from 0.99.0 (CE-270 has current ones); sub-items have no witness or are allowed (279.7 outside type, 279.9 `NaN`). |
| D2 | CE-283 | proposed | capability | none | Proposed; GPU recursion stays fail-closed (a decline) until a consumer asks. |
| D2 | CE-284 | proposed | capability | none | Proposed; no witness. |
| D2 | CE-285 | ready | defect | none | Only 285.2 remains: a missing test pin, no defect or reproduction. |
| D2 | CE-286 | proposed | capability | corpus | Issue #340, but the remaining cases are GPU `NaN` (allowed) or f32 precision (286.7, 286.8). |
| D2 | CE-522 | proposed | known limit | none | One-ulp outward-rounding limit of transcendental interval kernels: precision of the target, already stated in the `Enclosure` docs. |
| D2 | CE-288 | proposed | capability | crafted | GPU Hurwitz zeta gives `NaN` next to a zero (allowed); 288.2 is f32 precision. |
| D2 | CE-289 | proposed | capability | none | Proposed; the compiler refuses (declines); no witness. |
| D2 | CE-290 | proposed | capability | none | Proposed; compiler refuses `Nothing`-capable `Tabulate`/`Scan` (declines); no witness. |
| E | CE-700 | proposed | correctness of a debugging aid | crafted | (a) proposed; only witness is a run with the debug flag `CE_TYPE_PARANOID=1`; no corpus. |
| E | CE-668 | proposed | performance | plausible | (a) proposed; `at()` loop on `Add(L, 1)` is plausible but not corpus; cause not found. |
| E | CE-612 | ready | defect (performance) | crafted | (d) only witness is a shared `e = q(e, e)` graph 40 levels deep, built for the case; no wrong value. |
| E | CE-627 | proposed | performance | plausible | (a) proposed; values are right; no corpus named. |
| E | CE-637 | proposed | capability | plausible | (a) proposed capability (`\oint` of a user-function call); no corpus. |
| E | CE-641 | ready | defect | crafted | (d) needs an integrand that both calls `g` and passes `g` as a callback, written before `g`; no corpus. |
| E | CE-642 | proposed | capability | plausible | (a) proposed capability (symbolic integral of a `Map` integrand); no corpus. |
| E | CE-430 | proposed | performance | none | (a) proposed; user decision 2026-10-25 defers it until a consumer reports a slow abort. |
| E | CE-317 | proposed | performance | none | (a) proposed; measured walk is 0.5 % of the run, so no cache was added. |
| E | CE-320 | proposed | performance | crafted | (a) proposed; `If(c, e, e)` chains are crafted; CE-320.2 is a safe decline with user decision 2026-10-24. |
| E | CE-457 | proposed | performance | plausible | (a) proposed; value is within machine precision; no corpus. |
| E | CE-330 | proposed | performance | crafted | (a) proposed, low priority; chain of `-> unknown` functions with two calls each is crafted. |
| E | CE-332 | proposed | performance | plausible | (a) proposed; fourth derivative declines at the size budget; no corpus. |
| E | CE-339 | proposed | performance | none | (a) proposed; Python hoisting in two shapes, no measurement. |
| E | CE-340 | proposed | performance | plausible | (a) proposed; text says work only "if interpreted loops of many thousands of turns become important". |
| E | CE-458 | proposed | performance, design | crafted | (a) proposed; `Sum` and `Product` over one shared subtree nested 10 deep is crafted. |
| E | CE-341 | proposed | performance | crafted | (a) proposed; shared `Max(e, e)` tower; text says no known consumer assigns such a literal. |
| E | CE-342 | proposed | performance | corpus | (b) remaining sub-items are declines and unroll ideas; corpus count 0 sites (CE-342.2); Tycho says the 2x does not matter. |
| E | CE-344 | proposed | performance | crafted | (a) proposed; synthetic working set only; text says no real workload reaches the limit. |
| E | CE-347 | proposed | performance | crafted | (a) proposed; `Map` nested 40 to 160 levels is crafted. |
| E | CE-348 | proposed | performance | none | (a) proposed; text says "no observed misbehavior", leave until one shows a problem. |
| E | CE-352 | proposed | performance | corpus | (e) text says the sampling change met the need of the Tycho witness; build the rest only when a workload needs it. |
| E | CE-353 | proposed | performance | none | (a) proposed; no measurement; earlier speed-ups gave no gain. |
| E | CE-474 | proposed | performance | plausible | (a) proposed; one `simplify()` call takes 6 s; no corpus. |
| E | CE-356 | ready | defect | none | Not reproduced; one flaky `null` in a loaded full-suite run; no reproduction. |
| E | CE-358 | proposed | task | none | (a) proposed task, waits for TypeScript 7.1; content belongs in BUILD.md if the note is to stay. |
| E | CE-359 | proposed | task | none | (a) proposed task; list of load-sensitive suites; content belongs in BUILD.md or box specifics if kept. |
