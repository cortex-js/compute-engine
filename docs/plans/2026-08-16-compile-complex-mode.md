# Compile-time complex arithmetic as a MODE, not a per-node guess

Status: DESIGN, revision 6 (2026-08-16) — the implementation baseline. Rev 4
was read by the Tycho team (via CE-POC); rev 5 folded their requirements and
field data (marked **[field]**); rev 6 is the final dual-review pass (13
findings, `docs/scratch/2026-08-16-compile-complex-mode_SPEC_REVIEW.md`
round 3): post-rename drift removed, the accumulator boundary reconciled with
the shipped `combinerPlan`, and every default an implementer would otherwise
guess at stated. Two API shapes in this revision are the author's defaults,
not rulings, and can be vetoed before step 1 lands: `result.diagnostic`
(structured decline payload beside the unchanged `error: string`, §4) and
`result.promoted` (the promotion-without-escalation signal, §4).
Review history: `docs/scratch/2026-08-16-compile-complex-mode_SPEC_REVIEW.md`
(two dual-review rounds, 28 findings, all folded in). Field data from Tycho
against the released 0.113.0 (relayed by CE-POC 2026-08-16) is folded in
where marked **[field]**.

Rulings by Arno so far: single knob (no `realOnly`); D2 = fail closed only
when statically non-real, runtime rule otherwise; D3 = entry check; booleans
never coerced; **the non-promoting discipline is defined by consistency with the GLSL
target's existing model** ("GLSL compilation and JS real mode should be
consistent"); **the consumer's document switch is NOT the mode input**;
**that discipline is spelled `'strict'`** (ruled 2026-08-16 — `'real'` read
as "only real numbers, refuse otherwise", which is not what it does: static
types decide the shape, wide is real, nothing promotes, and a contradiction
refuses).

Retires the `complexPromotion` and `realOnly` options and closes the class
behind Tycho items 57, 58, 60, 65, 148, 190, the heterogeneous-`At` element
analysis, the complex-ARGUMENT lane specialization (`_fn_b$z1`), the
emitted-body frame leak, and these ROADMAP entries: "A combiner callback (`Reduce`/`Scan`)
whose ACCUMULATOR turns complex mid-fold compiles silently wrong" — FIXED
2026-08-16 ahead of this design by `combinerPlan` (one-step widening of the
accumulator lane, seed lift, typed eta for a bare combiner, complex-lane
builtin combiners), which is the §3 accumulator row implemented on the
current per-node compiler and carries over unchanged — "A MULTI-CLAUSE
function with a declared `complex` parameter compiles
silently wrong", "A protocol MEMBER whose parameter is declared `complex` is
handed the argument unwrapped", "Complex values in compiled scalar
comparisons (deferred 2026-07-22)". Every one is the same defect shape (§1).

## 1. Problem

JavaScript has no complex number. A compiled value is either a JS `number`
or a `{re, im}` object (`ComplexResult` in `compilation/types.ts`), and the
compiler decides which — STATICALLY, PER NODE — through
`BaseCompiler.isComplexValued`. Compiled correctness rests on one invariant:
the parent's verdict about a node and the child's actual emission must agree
on the value SHAPE, or a `{re, im}` is consumed as a number (`NaN`, or
`"[object Object]1"` under `+`) or a number is read as `{re, im}`
(`{re: undefined}`).

The analysis has one unsound default: **anything not provably complex is
treated as real.** Correct for a real-typed literal or symbol; wrong whenever
a complex-shaped value flows through a BINDING SITE whose declared type is
wide (`unknown`, `number`, `finite_number`): a user function's parameter, a
`Block` local, a callback's element parameter, a `Reduce` accumulator, a
recursive self-call, a multi-clause dispatcher's clause parameter, a protocol
member's parameter, an element of a heterogeneous list. At each such site the
static guess can disagree with the runtime value, and each fix so far has
added another mechanism to force agreement — `_localComplex` frames (item
58), `_binderShield` (item 65), the `Which` arm coercion (item 60),
`isComplexValuedUserCall` (item 190), `elementComplexness` for `At`, the
per-call-site lane specialization `_fn_b$z1` with `LOCAL_SCALAR` framing
(2026-08-15/16), the eta-expansion of bare callbacks. Every new binding form
is a new silent-wrong until someone finds it; four are open today. This is
one design property, not a series of bugs.

**[field] The consumer's view of the same problem is unpredictability, not
wrong numbers per se.** Tycho's corpus census, with `complexPromotion`
enabled, counts ordering-comparison declines — **14 on 0.111.0 (the pricing
run filed with us), 15 on the 0.112.0 re-run (14 `LessEqual` + 1 `Less`);
0.113.0 is unmeasured** — and reads them as "places where a user cannot tell
from reading their own formula whether it will compile — that's the disease,
not the price of the cure". The class is independently reproduced on a bare
engine (`2·w(t)`, `w(t)+1`, `w(t)/2` decline under promotion while the
indexed read compiles; the default path is verified correct at both domain
ends). The expressions themselves arrive with the corpus re-run (§10).

**Two kinds of decline, which the same census also shows [field].** The
0.112.0 re-run reports 28 losses: the 15 ordering comparisons, 4 list-valued
operands (a residue of 9 fixed in 0.112.0), and 9 NEW fail-closed declines —
`Floor` ×5, `Ceil` ×2, `Mod` ×1, `Max` ×1 — that WITHDRAW a compiled `NaN`.
Those nine are the good kind: a wrong value retracted, not a capability
lost. So a raw decline count is not a cost figure, and this design must keep
the two apart everywhere it reports one: a **capability decline** is a
compilable thing that stops compiling (the ordering comparisons — what D2
fixes); a **correctness decline** is a wrong value withdrawn (the `Floor`
nine today; every `LaneMismatch` in `strict` mode). `strict` mode produces
both kinds by design; `auto` turns the correctness ones into escalations and
D2 removes the capability ones. A reader who prices the second kind as
regression has priced the fix as a bug. A user-visible
contract that says WHEN a formula compiles and what shape it computes in is
the deliverable; the comparison story (D2) is therefore primary, not a side
condition.

**The shader targets do not have this class of bug**, and the reason is the
principle of §2. `gpu-target.ts` derives every value's shape from STATIC
analysis (`complex`-typed → `vec2`; a PROVABLY negative radicand → `vec2`
by `isNegative === true`; everything else → `float`), never promotes an
UNKNOWN-sign operand, and synthesizes a typed signature for every emitted
function against which each call's argument shapes are checked — so a
complex-shaped argument meeting a real-shaped parameter FAILS CLOSED (`b(w)`
with `w: complex` and `b(x) := 2x` declines on `glsl` today and computes
`NaN` behind `success: true` on `javascript`). GLSL cannot be silently wrong
here because the language is statically typed; JavaScript can, because
nothing checks the boundary. The JS problem is a MISSING CHECK, not a missing
analysis.

The two existing options do not address it, because neither is a mode:
`realOnly` is a result projection at the boundary; `complexPromotion` is a
per-HEAD lane flip for `Sqrt`/`Ln`/`Log` of an unknown-sign real operand.
Neither says anything about a wide-typed binding holding a complex value.
**[field]** And `types.ts`'s sentence "a plotting front-end with a
per-document complex mode switch maps that switch onto this option" is
withdrawn: 32 of Tycho's 687 corpus documents declare complex, while their
motivating witnesses (`|w(t)[1]/2 − 1|` with `w(t) := [√(t−1), …]`,
documents `skz0syspxp`, `lizeqlnn5e`) are FLAG-OFF documents whose radical
goes negative mid-chain and returns a real. The mode is a property of what
the expression COMPUTES, not of the document's setting.

## 2. Principle: two arithmetic disciplines, three settings, one contract across targets

There are TWO ways to compile arithmetic — the `strict` discipline and the
`complex` discipline — and the option has THREE settings, because the
default (`auto`) is a POLICY over the two. In one line each, where "don't
know" means a numeric binding whose static type is wide:

- **`strict`** — if you don't know, assume real; and if that assumption is
  CONTRADICTED by something you do know (a statically complex-shaped value
  reaching that binding), REFUSE rather than compute.
- **`complex`** — if you don't know, assume complex. Always sound, only
  slower.
- **`auto`** — assume real, and on the first contradiction start over
  assuming complex. It never guesses at a runtime value: the contradiction
  is the same static fact `strict` refuses on, and the one thing it cannot see
  — a runtime `{re, im}` handed in through `vars` for a symbol it assumed
  real — is what the D3 entry check throws on.

What a discipline fixes is what a WIDE-typed numeric binding is, and — the
same thing said from the other side — what happens when a complex-shaped
value reaches one:

- **`strict` mode — the GLSL model, on every target.** Shape follows STATIC
  analysis: a `complex`/`imaginary`-typed value, a symbol whose assigned
  VALUE is complex (item 57 — static at compile time), a `Complex(…)`
  literal, `ImaginaryUnit`, and a radical/logarithm of a PROVABLY negative
  operand are complex-shaped; a wide-typed value is REAL. There is no
  promotion of an UNKNOWN-sign operand: `Sqrt`/`Ln`/`Log`/`Power` of a
  runtime-negative real yield `NaN`, as the real kernel does today, and the
  Tycho item-144 render-state pins on the shader targets bind unchanged.
  **At every binding boundary (§3), a complex-shaped value meeting a
  real-shaped binding FAILS CLOSED** — the check the shader targets already
  perform through their typed signatures, made explicit and applied
  identically on JavaScript, Python and interval-js, and reported as a
  `LaneMismatch` decline (§4) whose payload names the boundary. Sound because
  every runtime shape then equals its static shape: typed complex is `{re,
  im}` end to end (the Julia and Mandelbrot iterations of `fractals.test.ts`
  and the item 57–60 tests stay in this mode, on JS and on GLSL, unchanged),
  everything else is a number, and the one thing static analysis cannot see
  — a caller's `run(vars)` value — is checked at entry (D3).
  **"Real" does not mean "no complex arithmetic."** It means shapes come
  from static types: a `complex`-typed `z` is lowered through the complex
  kernels in strict mode, exactly as today and exactly as GLSL lowers it to
  `vec2` — see `√z` and `z² + z` in §2.1. The Julia/Mandelbrot iterations
  stay in strict mode because every complex value in them is complex BY TYPE
  OR LITERAL (a `Complex(0.35, 0.4)` seed, `x + i·y` with the literal `i`, an
  assigned complex `z_0`, a `(integer, complex) -> complex` declaration), so
  no wide binding is involved and nothing promotes. The same iteration
  written with a WIDE seed — `K(n, z) := …` with `z` unannotated, called as
  `K(10, x + i·y)` — is a lane mismatch and escalates under `auto` (§2.1,
  last row). (The setting was spelled `'real'` in earlier revisions; renamed
  `'strict'` because "real" read as "only real numbers, refuse otherwise".
  "Strict" is the discipline's actual contract: static types decide, wide
  is real, nothing promotes, and a contradiction is refused.)
- **`complex` mode — a wide-typed numeric value is COMPLEX, and unknown-sign
  radicals/logarithms promote.** Over-approximating complex is SOUND (a real
  value with `im: 0` is handled by the complex kernel); it is only slower.
  Nothing is lifted at a binding: a wide operand is lifted AT ITS USE by a
  numeric head, through the existing idempotent `_SYS.cplx` (a number becomes
  `{re, im: 0}`, an object passes through), so a wide binding holding a
  string, a boolean or a collection is untouched. Typed-real values keep the
  real kernel. The interpreter's promotions (`√(−1)`, `ln(−2)`, `(−8)^{1/3}`,
  `arcsin(2)`) fall out.
- **`auto` (the default) — strict mode WITH promotion, escalating to complex
  mode on a lane mismatch.** Compile in strict mode, except that the promotable
  heads (`Sqrt`/`Ln`/`Log` of an unknown-sign real, `Power` of an
  unknown-sign base with a non-integer exponent, and the inverse-trig /
  inverse-hyperbolic heads that already type complex for an argument of
  unknown magnitude) lower through the complex kernels — so their result is
  complex-SHAPED, statically, exactly like a typed-complex value, and flows
  through typed consumers correctly (`|√(t−1)|` is a real `Abs` of a complex
  operand: real number out). If — and only if — such a promoted or typed
  complex value reaches a WIDE binding (a `LaneMismatch` decline in real
  mode), the compilation is redone ONCE in complex mode. Nothing else
  escalates. Cost: today's `complexPromotion` economics — chains with no
  promotable head compile byte-identically to today's default; affected
  chains pay the complex kernel; only a document that mixes a complex-shaped
  value into a wide binding pays a second compile and complex-mode arithmetic
  throughout. **[field]** This is the mode Tycho's flag-off witnesses need,
  and their stated preference — "correct-and-slow, without hesitation" —
  comes with a requirement this design adopts (§4): the escalation must be
  OBSERVABLE, so a consumer can tell a user "this went the slow way, and
  here is why".

The mode is one bit per compilation, read once at the outermost compilation
and held for its whole duration (as `complexPromotion` already is), never
flipped by a nested target.

The sound half of `isComplexValued` — the TYPE/VALUE-based part: number
literals, `real`/`integer`-typed symbols, `real + real = real`,
`Abs`/`Re`/`Im`/`Arg` of anything, provable sign, the comparison and
predicate heads — is what strict mode IS, and survives in complex mode as an
OPTIMIZATION (a proof of realness can never be wrong, only absent). What is
removed is every mechanism whose job was to prove a wide value REAL in the
presence of a complex one: the guess, and the frames/lanes/look-throughs/
eta-expansions that patched it (§3 table).

**Known limits, stated once:** (i) `auto`'s promotion set is the list above;
a real-valued excursion through ℂ that arises some other way is not
promoted (none is known; report one and it joins the list). (i′) **A
constant-folded `ComplexInfinity` is a complex-shaped VALUE, on every
target and in every mode** — not a promotion, a typing fact: `1/0` folds to
`~oo`, which is `complex`-typed, so `x + 1/0` compiles to `{re: x + ∞, im:
∞}` on JavaScript and `vec2(x + _gpu_inf(), _gpu_inf())` on GLSL, exactly as
the interpreter evaluates it (`~oo`), while the unfoldable `x + 1/y` at `y =
0` stays on the real lane (`Infinity`). Same mathematics, two lanes,
decided by whether the denominator is a literal; pinned as intentional
(`compile-gpu-non-finite.test.ts`, "ComplexInfinity uses the complex
vec2(re, im) convention" — the type-agreement rule that a complex-typed
fold must emit `vec2` or be broadcast to `vec2(NaN, NaN)`), consistent
with the strict discipline (shape follows static type), and a lane source a
user can introduce without writing anything complex-looking. `auto` does
not change it. **Bounded [field]:** across the 687-document corpus a
NONZERO-numerator literal `/0` (→ `ComplexInfinity`, complex-shaped) occurs
in 2 rows of 1 document (`s8ishknvhe` rows 5–6, `\frac{1}{0}` as an
"undefined" sentinel in the otherwise-branch of a piecewise — which types
the whole piecewise complex; both rows decline for reasons the census will
settle), while `0/0` (→ `NaN`, stays REAL) occurs in 21 rows — a syntactic
floor, not a total (a denominator that FOLDS to zero is not counted). The
ergonomic point for the guide: `0/0` and `1/0` look interchangeable to an
author writing "undefined" and are not — one stays real, the other makes
the enclosing expression complex-shaped. (ii) The
compile-time `options.vars: Record<symbol, JSSource>` splice binds a symbol
to caller-supplied SOURCE TEXT that never passes through `run()`; it is not
type-checked and not entry-checked — an advanced escape hatch whose shape is
the caller's responsibility (documented; the caller declares the symbol's
type when it is complex). The soundness claim above excludes it explicitly.

### 2.1 Worked examples — what each setting emits (JavaScript target)

`a` is an unknown-typed free symbol (wide), `z` is declared `complex`,
`b(x) := 2x` is a user function with a wide parameter, `L: list<complex>`.
"today" is the current default; the real- and complex-lane code shown for the
new settings is the code the compiler emits TODAY for those lanes (the real
kernel, and the `complexPromotion` lowering respectively), so the examples
are grounded, not sketched. The `auto` column also shows `result.mode`.

| input            | today (default)                       | `mode: 'strict'`                                    | `mode: 'auto'` (default)                                                   | `mode: 'complex'`                                     | value at `a = −2` / `z = 1+2i`              |
| ---------------- | ------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| `2a + 1`         | `2 * _.a + 1`                         | same                                              | same — `mode: 'strict'`                                                       | `_SYS.cadd(_SYS.cmul(2, _SYS.cplx(_.a)), 1)` → boundary → `number` | `−3` in every setting                     |
| `√a`             | `Math.sqrt(_.a)`                      | same (`NaN` for negative `a`)                     | PROMOTED: `_SYS.csqrt({re: _.a, im: 0})` — `mode: 'strict'`, no escalation   | `_SYS.csqrt(_SYS.cplx(_.a))`                          | strict: `NaN`; auto/complex: `{re: 0, im: 1.414…}` |
| `\|√a\|`         | `Math.abs(Math.sqrt(_.a))`            | same (`NaN`)                                      | `_SYS.cabs(_SYS.csqrt({re: _.a, im: 0}))` — `mode: 'strict'`; result is a `number` (`Abs` is real-typed) | `_SYS.cabs(_SYS.csqrt(_SYS.cplx(_.a)))`  | strict: `NaN`; auto/complex: `1.414…` (a number) — Tycho's `\|w(t)[1]/2 − 1\|` witness is this row |
| `√(−2)`          | `({re: 0, im: 1.414…})`               | same — PROVABLY negative is complex-shaped statically, in every setting | same                                             | same                                                  | `{re: 0, im: 1.414…}`                       |
| `√z`             | `_SYS.csqrt(_.z)`                     | same — typed complex is complex in every setting  | same                                                                       | same                                                  | `{re: 1.27…, im: 0.78…}`                    |
| `z² + z`         | complex `_re/_im` split-scalar block  | same (this is the fractal iteration's shape)      | same — `mode: 'strict'`                                                       | same                                                  | `{re: −2, im: 6}`                           |
| `b(a)`           | `_fn_b(_.a)`, `_fn_b = (x) => 2 * x`  | same                                              | same — `mode: 'strict'`                                                       | `_fn_b(_.a)`, `_fn_b = (x) => cmul(2, cplx(x))`       | `−4` (complex mode: `number` at the boundary) |
| `b(√a)`          | `_fn_b(Math.sqrt(_.a))` (`NaN` for negative `a`) | same (`NaN`; no promotion, no mismatch)   | promoted `√a` meets wide `x` → `LaneMismatch` → ESCALATES — `mode: 'complex'`, `escalation.boundary = 'user-function parameter'` | `_fn_b(_SYS.csqrt(cplx(_.a)))`, complex-lane `_fn_b` | strict: `NaN`; auto/complex: `{re: 0, im: 2.828…}` |
| `b(z)`           | `_fn_b$z1(_.z)` (the 2026-08-15 lane specialization) | `LaneMismatch` DECLINE — "complex-shaped `z` bound to wide parameter `x` of `b`; declare `x` complex or compile with `mode: 'complex'`" (GLSL declines the same call today) | ESCALATES — `mode: 'complex'` | `_fn_b(_.z)`, complex-lane `_fn_b`          | strict: declined; auto/complex: `{re: 2, im: 4}` |
| `√a < 2`         | `Math.sqrt(_.a) < 2`                  | same (`false` for negative `a`: `NaN < 2`)        | promoted operand → D2 runtime rule: `(_t = csqrt(…), _t.im === 0 && _t.re < 2)` — `mode: 'strict'`; today's `complexPromotion` DECLINES this (Tycho's ordering-decline class) | same runtime rule                          | strict: `false`; auto/complex: `false` — and `true` at `a = 1` in all |
| `i < 2`          | declines                              | declines (statically non-real, D2)                | declines                                                                   | declines                                              | —                                           |
| `a < 3`          | `_.a < 3`                             | same                                              | same                                                                       | `_t = cplx(_.a); _t.im === 0 && _t.re < 3` (D2)       | `true`                                      |
| `Reduce(L, (p, x) ↦ p + 2x, 0)` | `2 + 6i` — `combinerPlan` (shipped 2026-08-16) widens the accumulator lane and lifts the seed | same — this boundary computes both lanes on the current compiler and never mismatches (§3) | same — `mode: 'strict'`, no escalation, `promoted: false` | same | `2 + 6i` in every setting for `L = [1+2i, i]` |
| `K(n, z) := if n ≤ 0 then z else K(n−1, z)² + c` typed `(integer, complex) -> complex`, `K(10, x + i·y)` | complex-lane `_fn_K` | same — every value typed complex, no wide binding, no promotion; `mode: 'strict'`; identical on GLSL (`vec2`) | same, `mode: 'strict'` | same | the fractal (unchanged, digit parity) |
| the same `K` with `z` UNANNOTATED, called `K(10, x + i·y)` | `_fn_K$z01` (yesterday's lane specialization) | `LaneMismatch` DECLINE — complex-shaped argument to wide `z` | ESCALATES — `mode: 'complex'` | complex-lane `_fn_K` | same fractal, via escalation |

Reading the table by column: **`strict`** never changes a value that is
computed today except to turn a silent `NaN`/garbage row into a loud
decline; **`auto`** turns those declines into escalations and additionally
promotes unknown-sign radicals — the only rows where it changes a value
today's default computes are the promotion rows (`√a`, `|√a|`, `√a < 2`),
where today's `NaN`/`false` becomes the interpreter's value; **`complex`**
computes everything in the complex discipline and hands back a `number`
whenever the imaginary part is exactly zero. Reading by row: a row whose
every operand is typed real or typed complex reads the same in all three
columns — the modes differ only where a WIDE value or an UNKNOWN-sign
radical is involved.

### 2.2 What a caller controls: declare the narrowest type you can

Every row of §2.1 that declines, escalates, or promotes does so because
some binding is WIDE. The single most effective thing a caller can do —
before choosing a mode — is to give every identifier the narrowest type it
knows:

- A symbol declared `real` (or `integer`, or `finite_real`) is never a wide
  binding: `√a` with `a: real` still promotes under `auto` (its sign is
  unknown), but `2a + 1`, `b(a)`, `a < 3` and every other use stay on the
  real kernel in EVERY setting, including `complex` mode.
- A symbol declared `complex` is complex-shaped in every setting: `b(z)`
  with `b(x: complex) := 2x` is not a lane mismatch — the parameter is typed
  — so it compiles in `strict` mode and never escalates. The same holds for
  a function's declared signature (`(integer, complex) -> complex`), a
  callback's annotated parameter, a typed accumulator seed, a
  `list<complex>` element type.
- Conversely, an untyped parameter (`b(x) := 2x`), an untyped lambda
  argument, a `Block` local first bound to a real value, an unannotated
  accumulator — each is a place where a complex-shaped value can arrive and
  the compiler cannot know it statically. Those are exactly the §3 rows.

**The lever has a floor, and it is not laziness [field] — scoped, on
Tycho's own investigation, to FUNCTION PARAMETERS.** Their seam declares
parameter shadows as `any` on purpose (`paramShadowType`): a shadow declared
`unknown` gets usage-narrowed by the engine (`b` reads `matrix` in
`(b−c)/distance(c,b)³`), whereas an `any` shadow stays `any` — the
free-symbol CONTRACT spelling, a classification-phase concern. Compilation is
separable from it: a type-only declaration made in a pushed scope (box and
compile inside, `popScope` in `finally`) provably does not leak back — they
measured it, and already do it in two places. So DOCUMENT VARIABLES —
sliders, point-controller components, solver pseudo-definitions, each a JS
number at run time and none `assign`ed on the engine — are narrowable to
`real`, which is exactly their runtime contract; what is NOT narrowable is a
lambda / user-function parameter (where `paramShadowType` genuinely binds)
and a list's element type (none exists at their plot-compile seam). A
type-only declaration leaves `.unknowns` and `freeSymbols` byte-identical
(only a value-binding declaration removes the name — the reason they had
left variables undeclared was a stale comment, refuted by measurement), so
the change is cheap to land and cheap to revert, and its payoff today is
exactly zero: undeclared, `any`, `unknown`, `real` and `number` all compile
identically now. The whole value is forward-looking against `auto`'s
wide-binding escalation, which is the honest way to frame the ask. A corpus
count of wide bindings must still separate "a declaration would have
narrowed this" (document variables — actionable) from "deliberately wide"
(parameters — a real cost of `auto` that the design accepts and §4's
observability explains); `strict`'s refusal and `auto`'s escalation on a
deliberately-wide binding are correct behavior, not misconfiguration.

**Two cautions for the guide's recommendation [field]:**
- **Narrowing does not monotonically reduce complex-shapedness.** `√a`
  types `finite_number` for `a` undeclared, `number`, `any` or `unknown`,
  and `finite_complex` for `a: real` — narrowing moved the REASON the value
  may be complex from "unknown operand" to "known-real operand of unknown
  sign", it did not remove it. That is exactly §2's rule (a radical of an
  unknown-sign real promotes under `auto`), but a reader of "declare the
  narrowest type you can" will expect narrowing to reduce promotion, and
  for the promotable heads it does not — it reduces MISMATCHES and lifts,
  never promotions. Say so plainly.
- **Never narrow a name that shadows an outer `assign` or a registered
  definition head.** Their measurement: declaring such a name returns
  `success: true` with the name in `freeSymbols` and `run()` yielding `NaN`
  — no error channel on either side. The narrowed set must exclude every
  assigned name and every definition head; the recommendation carries that
  exclusion.

So the practical guidance for the guide (`doc/13-guide-compile.md`) is:
under `strict`, narrow types turn refusals into compiles; under `auto`,
narrow types turn escalations (a whole-compilation switch to the complex
discipline, ~2.3× on affected chains) into no-ops and keep more of the
document on the real kernel; under `complex`, they let the compiler keep
typed-real subexpressions on the real kernel (§2's optimization) instead of
lifting everything. A consumer whose authoring surface knows a slider is
real, or a seed is complex, should say so at declaration — it is cheaper
than any mode and it is the only lever that improves all three settings at
once. `LaneMismatch`'s message names the binding to narrow, for the same
reason.

## 3. Binding boundaries — where strict mode checks and complex mode lifts

The single table both modes are implemented from. "Complex-shaped" means
`isComplexValued(value)` under the sound analysis of §2 (in `auto`, that
includes promoted heads); "wide" means a numeric binding not typed complex;
"lift" is the idempotent `_SYS.cplx` (or the target's equivalent, §6).

| Boundary                                                        | `strict`/`auto`: complex-shaped value → wide binding                     | any mode: NUMBER → complex-shaped binding                | `complex` mode: wide binding used numerically |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| root `run(vars)` free symbol                                    | entry check (D3): a `{re, im}` for a symbol analyzed real THROWS       | lift at entry for a `complex`-typed symbol given a number | lift at use                                   |
| top-level lambda argument (`t ↦ …`, `calling: 'lambda'`)        | entry check (D3)                                                      | lift at entry for a `complex`-typed parameter            | lift at use                                   |
| user-function parameter (call route)                            | `LaneMismatch` DECLINE                                                | today's `coerceToComplex` (real value → complex-typed parameter) | one emission per function; lift at use  |
| user-function VALUE position (`Map(b, xs)`)                     | DECLINE when the source's element type is complex and the parameter wide | as above                                              | the one emission handles both                 |
| multi-clause dispatcher clause parameters (JS/interval only)    | DECLINE (closes the open ROADMAP entry)                               | typed `complex` clause parameters coerce as the single-literal route | as above                          |
| protocol member parameters (JS only)                            | DECLINE (closes the open ROADMAP entry)                               | typed `complex` coerces                                  | as above                                      |
| recursive self-call                                             | falls out of the parameter rule                                       | falls out                                                | falls out                                     |
| `Block` local (`Declare`/`Assign`, later mutation)              | a local's shape is its FIRST binding's shape (`noteLocalComplex`); a later complex-shaped assignment to a real-shaped local DECLINES | `Declare(z, complex, 2)` and a later real assignment to a complex local lift | lift at use |
| callback element parameter (`Map`/`Filter`/…)                   | element type complex → parameter complex (today's element inference); a wide parameter over a complex-typed source DECLINES | a real element of a typed-complex collection lifts at the read | lift at use |
| `Reduce`/`Scan` accumulator                                     | IMPLEMENTED 2026-08-16 on the JavaScript and Python targets (`combinerPlan`): the accumulator lane is the seed's, widened once by the body's result; the combiner is compiled under that lane, and a real seed into a complex lane is lifted — so on those targets this row never mismatches. The GPU targets have no `combinerPlan` and DECLINE the shape (§9 step 5) | a real seed to a complex accumulator lane lifts (`_SYS.cplx`) | as implemented |
| collection element (`List`/`Tuple` literal, `At`)               | element-by-element as today; an `At` whose element shapes DISAGREE declines as today (`assertNoAmbiguousComplexElementRead`) | a real element read as complex lifts | every wide element lifts at use               |
| `Which`/`If` arms                                               | today's arm coercion (item 60): a provably-real arm beside a complex one is lifted; unchanged | unchanged                             | unchanged                                     |
| result of the compiled unit                                     | typed/promoted complex → `{re, im}`; boolean → boolean; number → number | —                                                       | §5 convention                                 |

## 4. `LaneMismatch`: the decline, its payload, and the retry site

- **`LaneMismatchError`** — a named `Error` subclass with `code:
  'lane-mismatch'` and a structured payload `{ boundary, binding, value,
  kind: 'correctness', message }`: `boundary` is a §3 row name; `binding` is
  USER-LEGIBLE by contract [field] — an authored identifier (the parameter
  `x` of `b`, the local `k`, the symbol `w`), or, where the binding has no
  authored name, an honest description ("an unnamed parameter of `b`",
  "the accumulator of the `Reduce`", "element 2 of the list") — never a
  compiler-internal spelling (`_t3`, `_tv1`, `_fn_b`); `value` is the
  complex-shaped expression's LaTeX; `message` names the fix ("declare `x`
  complex, or compile with `mode: 'complex'`"). Row identity is NOT in the
  payload: the consumer's seam calls `compile` per row and already knows
  which row; what it cannot reconstruct is a name a user recognizes, and
  "your document moved to the CPU because of `_t3`" is worse than saying
  nothing.
- **Result fields (JavaScript, Python, interval-js — every target that
  returns a `CompilationResult`).** `CompilationResult` gains:
  - `mode: 'strict' | 'complex'` — the discipline the returned code was
    compiled under;
  - `promoted: boolean` — whether any promotable head was lowered through a
    complex kernel (the §2 promotion set); the signal a consumer needs to
    tell "this row would have been real on the shader lane" WITHOUT an
    escalation (`|√a|` under `auto`: `mode: 'strict'`, `promoted: true`, no
    `escalation`) — required by §7's document-scoped lane selection [field];
  - `escalation?: CompileDiagnostic` — present when `auto` escalated: the
    diagnostic of the FAILED strict attempt (so `binding` and `boundary`
    say why);
  - `diagnostic?: CompileDiagnostic` — present on any decline (`success:
    false`), structured beside the unchanged human-readable `error: string`
    (which stays a string: three targets string-interpolate it into their
    fallback warnings today, and widening it would print `[object Object]`
    — the very shape bug this design removes).
  `CompileDiagnostic = { code: string; kind: 'capability' | 'correctness';
  message: string; boundary?: string; binding?: string; value?: string }`.
  Every decline carries `kind` per the table below, so a consumer's census
  never re-cuts a taxonomy after the fact.
- **`kind` table (exhaustive):** `LaneMismatch` → `correctness` (a value
  the previous release computed wrongly is withdrawn); the D2 COMPILE-TIME
  decline for a statically non-real operand (`Less(i, 2)`) → `capability`
  (nothing wrong was ever computed; the expression has no compiled value);
  "mode not offered on this target" (`complex` on `glsl`) → `capability`;
  every retained pre-existing fail-closed decline → `capability`. The D2
  RUNTIME rule is not a decline (it compiles). Consequently §1's sentence
  reads precisely: `auto` escalates the `LaneMismatch` correctness declines
  and D2's runtime rule removes the capability declines that were ordering
  comparisons over a maybe-complex operand; the static-non-real D2 declines
  and the target-capability declines remain, loudly, in every mode.
- **One catch-and-retry site:** `compile()` in `compile-expression.ts`, the
  public entry, around the target compile — for the registered-target route
  AND the direct-target route (which today bypasses `languageTarget.compile`
  and reaches `BaseCompiler.compileRoot` with no catch of its own; it is
  routed through the same wrapper). Targets never retry themselves. **The
  retry runs on FRESH compilation state:** a `LaneMismatch` can be thrown
  after the failed attempt has populated mutable target state (helper
  preamble, user-function definitions, temp-name counter, CSE session,
  bound-variable frames). For a registered target the wrapper constructs a
  new per-compilation target as it does today; for a DIRECT target (a
  caller-owned `CompileTarget`) escalation requires the target to declare
  `'auto'` in `supportedModes` AND provide `reset()` (drop everything the
  failed attempt wrote) — without it `auto` on that target resolves to
  `strict` (§6) and a `LaneMismatch` is reported, not retried.
- `interval-js` declines by returning `success: false` without throwing
  (documented in `compile-expression.ts`); it is excluded from escalation by
  construction and reports the payload in `diagnostic`.

## 5. The option surface: ONE knob (ruled)

- `mode?: 'strict' | 'complex' | 'auto'` — the ONLY option, on
  `CompileExpressionOptions` and on `CompileTarget` (the target field
  replaces `complexPromotion`). **Effective mode** = `options.mode` ??
  `target.mode` ?? (`'auto'` if the target's `supportedModes` includes it,
  else `'strict'`); the registered `javascript`/`python` targets support all
  three, so their default is `auto`; `interval-js`, `glsl`, `wgsl` support
  `['strict']`, so their default is `strict`; a direct/custom target
  declares its own (default `['strict']`). A requested mode the target does
  not support is a `capability` DECLINE at option validation — never a
  silent coercion.
- **Result convention (JavaScript runner): a value whose imaginary part is
  EXACTLY zero comes back as a plain `number`; otherwise as `{re, im}`
  (`ComplexResult`) — and, as a GUARANTEE in both directions [field]: a
  returned `ComplexResult` always has `im !== 0`, and a real value is never
  returned as `{re, im: 0}`, so a consumer's per-sample test is the single
  `typeof v === 'number'` and never a two-shape check.** (Accepted by Tycho
  as the replacement for `realOnly: true`, and preferred: today `realOnly`
  returns `NaN` for an out-of-domain sample; the object with a non-zero
  imaginary part lets a sampler tell "outside the real domain" from
  "genuinely `NaN`", which it cannot today.) No chop at the boundary — ARCHITECTURE.md's rule
  ("never chop in ring arithmetic or constructors": `1 + 1e-12i` is
  legitimate) — so the roundoff dust of the transcendental kernels is
  removed WHERE IT IS CREATED: the `_SYS` complex kernels (`casin`, `cacos`,
  `clog`, …) chop their own dust at the roundoff scale, exactly as
  `apply.ts` does for the interpreter, and `wrapRealOnly`'s boundary chop
  goes away with `realOnly`. `.N()` parity: `√4` is `2`; `arcsin(0.5)` is
  the number `0.5235…`; `1 + 1e-12i` is `{re: 1, im: 1e-12}`. Consumers
  already receive `number | ComplexResult` from today's default path; the
  "real plot in a complex document" case is `typeof v === 'number' ? v :
  NaN` on the consumer's side. Applies in every mode (in strict mode a typed
  complex result with `im === 0` is likewise a number).
- **Booleans are never coerced** (ruled): a predicate-valued expression
  returns `true`/`false` in every mode. `run`'s return type is unchanged by
  `mode`: `number | boolean | ComplexResult | …` as the runner types declare
  today. (The `number` narrowing `realOnly: true` provided is given up with
  the single knob.)
- `complexPromotion` — deprecated. Consulted only when `mode` is absent:
  `true` → `mode: 'complex'` with a console warning; `false` → ignored. With
  an explicit `mode`, ignored with a warning (no conflict error).
- `realOnly` — deprecated. For one release, `realOnly: true` composes with
  any mode as the OLD projection on the result (`{re, im}` → `NaN` unless
  `im` is at roundoff scale, boolean → `NaN`), with a warning; then removed.
  **Internal callers are migrated first** (`nonlinear-fit.ts:258`,
  `differential-equation-utils.ts:323/373/402`): each gets an internal
  numeric projection (`number` passes; anything else → `NaN`, no chop) at
  its call site with an expression-type precondition, since `mode: 'strict'`
  alone can return a boolean or a typed-complex object.

Why not a third mode value (`'complex-real'`) for the projected case: it
re-introduces the two-axis explanation under one name, and the projection's
content is a one-line consumer test once the kernels own their dust.

## 6. Targets

| Target                 | `strict`                                                               | `complex`                                                              | `auto`                                              |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `javascript`           | §2/§3, `ComplexResult` at the boundary                                 | §2/§3, `_SYS.cplx` at use, §5 result convention                        | strict + promotion, escalate on `LaneMismatch`      |
| `python`               | same rules; complex values are native Python `complex` in the emitted source (source-only on success: no runner, no `{re, im}`, no D3 entry check — the caller's Python runtime does what it does; a `fallback: true` DECLINE still gets the shared interpreter-backed `run`, D7) | wide operands lifted with `complex(x)` at use; native results | as JS; escalation is a second source emission |
| `interval-js`          | real only (intervals are real); a complex-shaped value anywhere DECLINES with the §4 payload | not offered: `mode: 'complex'` DECLINES with a message | strict, no promotion; a `LaneMismatch` DECLINES (no escalation target) |
| `glsl` / `wgsl`        | this IS the model: `vec2` for typed/provably-negative complex, `float` for wide, typed signatures check every call (`gpu-target.ts` unchanged in substance) | not offered in this design: DECLINES with a message (a `vec2`-everywhere shader mode is a possible follow-up, not promised) | strict, no promotion (item-144 pins bind); a `LaneMismatch` DECLINES with the §4 payload |
| direct / custom target | inherits the base compiler's rules; declares `supportedModes` (default `['strict']`, which is then its effective default mode) | offered only if the target ALSO provides the two hooks below; validated at declaration | offered only with `'auto'` declared AND a `reset()` hook (§4 fresh-state retry); otherwise resolves to `strict` |

A custom target that declares `'complex'` or `'auto'` must provide
`complexLift(code)` (the idempotent number → complex lift, `_SYS.cplx`'s
role) and `complexIsReal(code)` (the runtime realness test D2/D7 use); a
declaration without them is rejected at option validation. A minimal
custom-target conformance fixture pins the contract. Multi-clause and
protocol dispatch do not exist on the shader targets at all today (they
already fail as unsupported before any shape check); §3's rows for them are
JS/interval-only.

## 7. **[field]** One document, two lanes — the consumer-side consequence

**Reframed 2026-08-16 (Tycho's read of the payload + Arno's direction, via
CE-POC; the cost question stays open for Arno and Tycho):** the
inconsistency this section was written against is NOT per-row lane
selection as such — it is per-row selection driven by ADJACENCY, when the
rows that must agree are the ones that DEPEND on each other (Arno: "only
dependent rows have to agree: if a row defines `f` and `f` promotes, the
rows that USE `f` follow it; an adjacent row that does not use `f` can stay
on its lane"). And dependent rows all SELF-REPORT: `result.promoted` is set
by the compilation that LOWERED a promotable head through a complex kernel,
and a document definition is compiled INTO each consuming row's compilation
(its body is emitted into that row's preamble), so `|f(x)|`, `Re(f(x))` and
every other consumer of a promoting `f` reports `promoted: true` itself —
the flag is the dependency closure, arrived at row by row, with no closure
walk, no definition identity and no `promotedIn` field (held, at Tycho's
request). Per-row selection driven by the FLAG is therefore coherent:
"any row reporting `promoted: true` → JS lane" is implementable at the seam
today (Tycho, CODE-READ: their scalar channel is `Record<string, number>` by
construction, their collection carriers stay symbols read from the engine
binding; one `carrierOnlyNames` map is the residual to probe after the
sweep). **Stability, by construction:** `promoted` is a COMPILE-TIME fact
decided from the SOURCE — `promotesRadicalToComplex` asks whether the
operand is PROVABLY non-negative, never what value it holds at run time (the
D2 runtime rule governs how a comparison over the promoted value behaves,
not whether the head was lowered through `csqrt`) — so the same source
compiles to the same lowering and the same flag on every recompile; a flag
can only change when the source (or a definition it consumes) changes,
which is exactly when the row recompiles. What remains open is COST, not
implementability: the per-document rows-promoted / rows-total distribution
(corpus ceiling: `promotes-no-escalation` 573 of 6617 rows, 8.7%,
concentrated in the 26/32 cross-lane documents), which Tycho is producing
from the existing dump. The paragraphs below are the original framing, kept
for the record.

Tycho's seam selects a compile target PER ROW, so a single document can span
the JS and GLSL lanes. Under this design strict mode is IDENTICAL across
lanes (that is what §2 defines it to be), but `auto`'s promotion and
escalation exist only on JS/Python — so a promoted document would compute
one row in complex arithmetic and another on the GLSL real kernel: exactly
the unpredictability the mode exists to remove. Neither "strict mode
everywhere" (their witness stays black) nor "promotion on the JS lane only"
(per-row semantics) is acceptable to them.

**Measured 2026-08-16 (§10 M3):** the shared-lane constraint binds in 26
(strict) / 32 (loose) of 687 documents — under 5% — so document-scoped lane
selection costs GPU acceleration on very few documents. Their proposal, which this design supports and which is **Arno's ruling to
make, not theirs or ours** (a Tycho architecture change with a performance
consequence): **make lane selection DOCUMENT-scoped once promotion is
active** — if any row of a document escalates (or is promoted), the whole
document runs on the JS lane; a per-row semantic inconsistency becomes one
per-document decision, explainable to a user in a sentence. What this design
owes them for that to work is exactly §4: `result.promoted` and
`result.escalation` tell the seam, PER ROW IT COMPILED, that the row would
not be real on the shader lane and why (a user-legible `binding`), so it can
act document-wide and explain an unrequested GPU→CPU fallback; the seam
supplies row identity itself. Its cost — a
document with one promoted row loses GPU acceleration for all rows — is
unmeasured; they will measure it on the corpus together with the
provable-real fraction (§10) before committing.

## 8. Decisions

**D1 — cost.** [field] A caveat on Tycho's complex-usage figures when they
arrive: in `skz0syspxp`, `S_n(x, n_0) = ∏_{i=1}^{n_0}(…) + (1 − i/n_0) + …`
has trailing `i` terms that Desmos scopes to the product and CE does not,
so they box as the imaginary unit — a big-operator scoping divergence in
their seam, not a user writing complex arithmetic. Such sightings must be
subtracted before a raw complex-sighting count is read as demand for the
mode. The 4.7% "documents declaring complex" figure is
withdrawn: the mode is not keyed on the switch, so the cost potentially
applies to every document; what bounds it is the fraction of chains `auto`
can keep in strict mode (no promotable head, no mismatch). Recorded numbers:
~2.3× on affected chains (9 ms → 21 ms, 200k-point sweep of `|√(u+1)/2 −
1|`); chains with no unknown-sign radical cost nothing today and still cost
nothing under `auto`; a fractal iteration is typed and stays in strict mode.
Free mitigations: the type/value realness proofs, the split-scalar
(`_re`/`_im` locals) emission the complex lowerings already use, and lifting
at USE (`_SYS.cplx` per wide occurrence — CSE hoists repeats). Measure the
promoted-chain benchmark and the fractal corpus BEFORE and AFTER, and record
both in the CHANGELOG; Tycho measures the provable-real fraction on the 687-
document corpus (§10). There is no compile-time pre-pass; the only new
compile-time cost is the second compile on escalation.

**D2 — RULED (b), two predicates. Primary deliverable [field].** Ordering
(`Less` & co.), the integer-only heads (`Floor`, `Ceil`, `Round`, `Mod`,
`GCD`, `Factorial`) and the scalar condition of `If`/`Which`/`And`/`Or`/`Not`:
- fail closed at compile time only when an operand is STATICALLY NON-REAL:
  `ImaginaryUnit`, `Complex(a, b)` with `b` a non-zero literal, an
  `imaginary`-typed symbol, a symbol whose assigned value has a non-zero
  imaginary part. A `complex`-TYPED symbol is NOT statically non-real (a
  real IS a complex; `z: complex` may hold `2`) — it takes the runtime rule.
  A PROMOTED head (`√x` in `auto`/complex mode) takes the runtime rule.
- otherwise, when any operand may be complex, a runtime rule: EVERY operand
  (edges included — today's relational-chain lowering binds only the middle
  ones, `isMiddle` in the `bindExpr` use around `base-compiler.ts:3477`)
  is bound to a temporary ONCE, in interpreter order; a comparison yields
  `false` and an integer head yields `NaN` when any operand's imaginary part
  is non-zero (exact test — the kernels own their dust, §5); relational
  chains keep their short-circuit order. **Lazily-evaluated positions keep
  their laziness:** for `If`/`Which`/`And`/`Or`/`Not`, the guard is emitted
  WHERE the native lowering evaluates that operand (inside the branch or the
  short-circuit arm), never hoisted ahead of it — `And(False, Random() <
  z)` draws nothing, exactly as today; and a statically non-real operand in
  an UNREACHED position (`Or(True, i < 2)`) is still the compile-time
  decline (static analysis does not reason about reachability; the
  interpreter's symbolic result has no compiled analog).
- in strict mode nothing changes.
Expected effect [field]: Tycho's ordering-comparison declines under
promotion (`{y > \sqrt{x}}`-shaped restrictions; 15 measured on 0.112.0,
0.113.0 unmeasured) → 0, to be verified on the extracted set — the verification is "the runtime
rule covers every one of them", which does not depend on knowing the count
in advance.
Rationale, corrected: the loud compile-time failure is kept where the
expression is CERTAINLY meaningless. The interpreter does not throw on `i <
2` — it returns the comparison unevaluated; compiled code has no symbolic
result, and a compile-time decline is the honest analog of "no value". The
runtime `false`/`NaN` is "NaN where a real result is meaningless", the same
contract strict mode applies to `√(−1)`.

**D3 — RULED: entry check** (JavaScript runner). `run(vars)` and a lambda's
arguments check each value bound to a symbol the compilation analyzed as
REAL: a `{re, im}` object throws `TypeError` naming the symbol and `mode:
'complex'`; a number passes; anything else is left to today's behavior. And
the reverse (round-2 finding 3): a plain number bound to a `complex`-typed
symbol or parameter is lifted at entry. One `typeof` per free symbol per
call.

**D4 — resolved by construction:** `auto` needs no static evidence walk.

**D5 — RULED single knob** (§5).

**D6 — heads with real-only lowerings** (`Erf`, `Gamma`, `Zeta`, the
Bessel/Airy family — the list `compile-expression.ts` documents as failing
closed on a complex operand): in strict mode unchanged (a typed-complex or
provably-non-real operand fails closed as today); in complex/auto mode EVERY
operand that may be complex in that mode — wide, promoted, or
`complex`-TYPED — takes the D2 runtime rule (bind once, run the real helper
when the imaginary part is zero, `NaN` otherwise), so `Erf(x)` compiles in a
complex-mode document and answers `erf(0.5)` for a `complex`-typed `x`
holding `0.5` and `NaN` at `x = i`; a STATICALLY non-real operand
(`Erf(2i)`) is the compile-time D2 decline in every mode.

**D7 — fallback.** `BaseCompiler.buildInterpreterFallback` is ONE shared
function, reached by `javascript-target.ts`, `python-target.ts`,
`gpu-target.ts`, `interval-javascript-target.ts` and the direct route in
`compile-expression.ts`: every target's `fallback: true` decline gets a
JS-interpreter-backed `run` from it, source-only targets included. Its two
fixes therefore land once and apply everywhere: (input) each var is declared
from the RUNTIME SHAPE of the value it is handed (`complex` for a `{re,
im}`, `number` for a number) instead of the hardcoded `'number'`; (output)
the scalar result is normalized by the §5 convention (`number` when the
imaginary part is exactly zero, `ComplexResult` otherwise, boolean stays)
instead of the unconditional `.N().re`. Per target: `javascript` and the
direct route return that runner as-is; `interval-js` keeps wrapping it in
its own interval-shaped runner (as it does today); `python`, `glsl` and
`wgsl` return it as-is too — a `fallback: true` decline on a source-only
target has always returned a JS runner, and it now returns a correct value
(possibly a `ComplexResult`) where it returned a projected number; the
successful-compile contract of those targets (no runner, native complex in
the source) is untouched. Under `auto` a `LaneMismatch` escalates BEFORE any
fallback is consulted. Every §9 witness states its `fallback` setting.

## 9. Migration and regression suite

Migration order — four separately stageable units, each with its own gate
and a stated observable change; nothing in an earlier step depends on a
later one being present:

1. **Plumbing, no behavior change.** — **IMPLEMENTED 2026-08-16** (unstaged
   at the time of writing; test file
   `test/compute-engine/compile-mode-plumbing.test.ts`; error classes in
   `compilation/diagnostics.ts`; the mode latch is `BaseCompiler.mode`,
   resolved by `BaseCompiler.resolveCompileMode` at depth 0 and, for a
   direct target, pre-resolved by `resolveDirectTargetMode` in
   `compile-expression.ts`). Two defaults taken as stated: `result.diagnostic`
   and `result.promoted` exist; on a decline `mode`/`promoted` are stamped
   too (`'strict'`/`false`). One reading resolved: a direct target that
   DECLARES `'auto'` without `reset()` resolves a requested `'auto'` to
   `'strict'` (§4/§6 table) rather than being rejected (the §9 phrasing) —
   declaring `'complex'`/`'auto'` without `complexLift`/`complexIsReal` IS
   rejected. Snapshot/pin blast radius measured: 10 test pins moved from
   `{re: x, im: 0}` to `x` (the §5 convention), no snapshot files changed.
   `mode` accepted end to end (options →
   target → `BaseCompiler` static, read once) with the effective-mode
   resolution of §5; `LaneMismatchError` and `CompileDiagnostic` types;
   `mode`/`promoted`/`escalation`/`diagnostic` result fields (`mode` reports
   `'strict'`, `promoted: false`, until later steps); the D7 input/output
   fixes in `buildInterpreterFallback`; the transcendental `_SYS` kernels
   chop their own dust and the boundary tests `im !== 0` exactly (§5);
   internal `realOnly` callers migrated to a local numeric projection. In
   this step `mode: 'complex'` and `mode: 'auto'` are ACCEPTED but behave as
   `strict` (no promotion, no retry), and `complexPromotion`/`realOnly` are
   still honored exactly as today (their deprecation mapping arrives in step
   4). Emitted arithmetic is unchanged; the runtime helper preamble and the
   runner's result normalization ARE changed (kernel chop, D7), which is the
   step's whole observable surface. Gate: the "Options" witnesses that apply
   to step 1 (accepted values, effective-mode resolution, unsupported-mode
   decline), the D7 witnesses, the "Result convention" witnesses
   (`arcsin(0.5)` a number; `1 + 1e-12i` an object), plus the full
   `compile-complex*.test.ts` and `fractals.test.ts` files unchanged.
2. **Strict discipline.** — **IMPLEMENTED 2026-08-16** (test file
   `test/compute-engine/compile-mode-strict.test.ts`; gate
   `BaseCompiler.strictLanes`, helper `laneMismatch`; boundaries in
   `tryCompileUserFunction` (single-literal + multi-clause via
   `multiClauseLaneMismatchAt`), `complexElementCallbackEta` (value position),
   the protocol member dispatch in `userFunctionsPreamble`,
   `noteLocalComplex` + `checkNestedComplexRebinding` (block local); D3 in
   `javascript-target.ts` `checkEntry`/`EntryPlan`, both routes, both
   directions; the multi-clause/protocol ROADMAP entries closed by per-clause
   `_SYS.cplx` and dispatch on `_SYS.creal`-normalized values). **One
   deliberate deviation from the text below:** the declines are in force
   for `mode: 'strict'` ONLY in this step, not "under every mode" — under
   `auto` (the default) and `complex`, which still emit today's code, the
   per-call-site lane specialization and the block-local promotion stay in
   place, so no default-mode program changes between this step and step 4
   (where `auto` = strict attempt + escalation and the gate widens). D3 is in
   force in every mode. D3 consequence to know: an UNANNOTATED lambda
   parameter handed a `{re, im}` at `run()` now throws even when the body
   only forwards it into a `complex`-declared parameter (two
   `multi-clause-compile.test.ts` pins were changed to annotate the
   parameter `complex`); the shape-agnostic FORM-3 `_SYS.cplx` coercion is
   unchanged and still serves a symbol INFERRED complex. Implicit
   (engine-initiated) compilations pass `entryChecks: false` because their
   NaN/ABI self-healing fallback would otherwise become an evaluation error.
   The §3 DECLINES where JS/Python lack them
   (user-function parameter, value position, multi-clause, protocol, block
   re-binding, callback element) with `LaneMismatchError` payloads, and the
   D3 entry checks both directions. Observable change: shapes that were
   silently `NaN` now decline loudly under every mode (nothing escalates
   yet). Gate: the "Strict mode declines" witnesses, D3, and the
   "Strict mode keeps today's typed-complex programs" witnesses.
3. **Complex discipline.** — **IMPLEMENTED 2026-08-16** (test file
   `test/compute-engine/compile-mode-complex.test.ts`; gate
   `BaseCompiler.complexDiscipline` = `mode === 'complex'`; the wide rule is
   `wideIsComplex`/`wideNumericType` in the symbol arm, the function-arm
   fallback and the block-local frame default (`localComplexDefault`; a
   `Declare` of a real-only type keeps the real kernel); the lift at use is
   `liftWideReference` at symbol emission (a symbol complex by TYPE is not
   lifted — coerced at entry/call); one emission per user function
   (`userCallComplexLanesOf` returns no lanes, the eta is skipped);
   promotion of the `PROMOTABLE_RADICAL_HEADS` in complex mode
   (`promotesRadicalToComplex`); the D2/D6 runtime rule is
   `realOperandGuard` — bind once via `target.bindExpr`, guard
   `complexIsReal`, real projection through the new third hook
   `complexReal` (`_SYS.creal` / `complex(x).real`), overrides keyed by node
   in `_codeOverrides` and read at the top of `compile()` — applied at the
   ordering gate, the `REAL_ONLY_CODEGEN_HEADS` gate and the string-mapped
   helper gate, with the compile-time `non-real-operand` capability decline
   for `isProvablyNonReal` operands; the D3 entry plans apply the wide rule
   for complex mode). **Deviations/readings:** the runtime rule is in force
   for `mode: 'complex'` ONLY in this step (D2 "in strict mode nothing
   changes"; `auto` gets it in step 4), so the CO-P1-3 / ordering fail-closed
   pins under the default mode are unchanged; the mechanisms §1 lists as
   patching the guess are BYPASSED in complex mode, not yet removed — they
   still serve `auto` until step 4, which is where their removal belongs;
   `result.promoted` is still the constant `false` (step 4 computes it). A
   `{re, im}` handed to a wide binding is accepted in complex mode (D3
   lifts a number, passes an object).
   `isComplexValued` answers `true` for a wide
   numeric value under `mode: 'complex'`; `_SYS.cplx` at every wide numeric
   use; single-lane user-function emission with the boundary lift; D2/D6
   runtime rules. Remove, in this order, each mechanism §1 lists as
   patching the guess, running the complex test files after each removal
   (`compile-complex.test.ts`, `compile-complex-element-access.test.ts`,
   `compile-complex-result.test.ts`, `fractals.test.ts`, the item 57–65/190
   blocks, `list-parameter-indexing.test.ts`, `multi-clause-compile.test.ts`,
   `protocol-dispatch-compile.test.ts`). A test that pinned an emitted NAME
   (`_fn_K$z01`, `_fn_b$z1`) is rewritten to pin the VALUE. Observable
   change: `mode: 'complex'` now computes. Gate: the "Complex mode result
   convention", D2, D6, D8 and "Non-numeric wide bindings" witnesses.
4. **`auto` and the option surface.** — **IMPLEMENTED 2026-08-16; blast
   radius MEASURED and the `auto` default APPROVED by Arno (staged on his
   "stage" after the count):** full suite 29,345 tests, 4,312 snapshots
   passing with ZERO snapshot changes; ~52 test pins moved in 15 files, all
   in the predicted radical-related classes (default real-kernel/NaN pins →
   promoted kernel + interpreter value with a `mode: 'strict'` pin kept
   beside each; `complexPromotion: true` → complex-mode emission; CO-P1-3 /
   ordering fail-closed pins under the default → the D2/D6 runtime rule,
   statically-non-real declines kept; `$z` lane-name pins → escalation
   fields + value; `Erf(z)`-as-decline fixtures → `mode: 'strict'`;
   map-auto-compile counters); the only other failure was the pre-existing
   `Limit`-at-∞ `Erf(∞)` defect (ROADMAP), outside this diff. Arno's stated
   basis: `strict` costs nothing in performance and costs a decline class;
   `auto` costs ~2.3× only where a radical's sign cannot be proven, which is
   the case the workstream exists to fix. What landed:
   `strictLanes` = strict OR auto (auto's first attempt raises the
   `LaneMismatch`); `promotionActive` = auto | complex | `complexPromotion`;
   `runtimeRealGuards` = auto | complex; the single retry site in
   `compile()` — registered route: the first attempt runs with `fallback:
   false` so the mismatch reaches the site as a THROW (no spurious
   "Compilation fallback" warning), retried once with `mode: 'complex'` on
   a fresh per-compilation target, `result.escalation` = the strict
   attempt's diagnostic; direct route: `reset()` + `mode: 'complex'` +
   fresh naming; `result.promoted` computed from the SOURCE (`notePromoted`
   in `promotesRadicalToComplex`, only for a real-shaped operand of unknown
   sign — a provably negative or complex-typed operand is not a lane
   difference — and from the wide-lifted complex branch of Sqrt/Ln/Log/Power
   under complex mode); `result.mode` = the latched discipline
   (`_lastReport`); `Power` of an unknown-sign base with a NON-INTEGER NUMBER
   literal exponent joins the promotable set (a variable exponent keeps the
   real kernel — promoting `x^y` would move every such power off it);
   `assumedRealNonNegative` — the sign proof under the compiler's own "wide
   is real" premise (sums of squares, `Abs`, `Exp`, even powers), so
   `√(x²+y²)` and `√((x−a)²+(y−b)²)` — the distance/norm shape, the commonest
   radical in a plot — keep the real kernel and do NOT report `promoted`
   (the engine's `isNonNegative` answers `undefined` for `x²` because a
   complex `x` squares negative; that is not the compiled premise);
   `complexPromotion: true` → `mode: 'complex'` (one warning per process;
   ignored with a warning beside an explicit `mode`; not passed to the
   target); `realOnly: true` → the old projection kept for one release with
   a warning. Two consumers of compiled sub-lambdas hardened for promotion:
   the numeric kernels `_SYS.integrate`/`integrateMC`/`nd`/`limit` project
   their callback's value to real (`realFn`: an exactly-real `{re, im}` is
   its real part, a complex value NaN) — `∫ y^{3/2} e^{−y/2}` returned NaN
   without it; and a collection `Sum`/`Product` folds with the raw operator
   only when its elements are real by construction (`collectionFoldsReal`,
   shared by the analysis and the JS emitter — `Map(Ln, xs)` types
   `list<real>` while its eta-expanded callback promotes), else with the
   shape-agnostic `_SYS.sadd`/`smul` wrapped in the complex lift. NOT yet
   done in this step: the REMOVAL of the lane specialization
   (`userCallComplexLanes`, `$z` names, `laneFrames`) and the eta — they are
   now unreachable under every mode (strict/auto raise the mismatch,
   complex has no lanes) and come out in a follow-up pass once the pins are
   settled; `result.escalation` is not set when the retry itself declines.
   Also decide here (user-ruled
   2026-08-16 to wait for this step, from the step-1 review): whether the
   DEFAULT `R` of `CompiledRunner`/`CompilationResult` — today `number |
   ComplexResult` — is widened to what runners actually return (`boolean`,
   nested arrays), as one deliberate public-type change alongside removing
   the `realOnly: true → number` overload; or left as-is. `auto` = strict + promotion (the §2
   promotable set lowered through the complex kernels, `promoted: true`),
   escalating on `LaneMismatch` through the single retry site on fresh
   state (§4); `complexPromotion` → `mode: 'complex'` alias with warning;
   `realOnly` → transitional projection with warning; `auto` becomes the
   effective default on targets that support it. Observable change: the
   default now promotes unknown-sign radicals and escalates the step-2
   declines. Gate: the "`auto` — three outcomes" witnesses, the D2 corpus
   block, and the remaining "Options" witnesses.
5. GPU route: an accumulator-lane decline (`combinerPlan` has no GPU
   equivalent; the multi-clause and protocol rows do not exist there — see
   §6); `mode: 'complex'` declines with a message; `interval-js` likewise.
6. D1 measurement BEFORE/AFTER; split-scalar emission audit.
7. Docs (`doc/13-guide-compile.md`: "Real-Only Mode" → result convention; a
   "Modes" section replacing the `complexPromotion` text and stating the
   GLSL parallel and the per-row/per-document note of §7), option
   docstrings, CHANGELOG (Breaking: strict-mode declines where `NaN` was
   returned, the result convention; Deprecated: `complexPromotion`,
   `realOnly`), ROADMAP entries named at the top marked resolved.

Snapshot blast radius: expected confined to expressions that today mix a
complex-shaped value into a wide binding; measure with the full suite after
step 3 and count before landing.

Regression suite (each witness states its mode; `fallback: false` unless
noted):
- **Strict mode keeps today's typed-complex programs, on JS and GLSL:**
  `fractals.test.ts` with digit parity and unchanged code (assert on emitted
  code, not timing); the item 57–60 tests; the wide-typed pass-through arm
  `K2`; `id(x) := x` over a complex argument in complex mode; and the
  `Reduce`/`Scan` accumulator shapes (`Reduce(L, h, 0)` → `2 + 6i`,
  `Reduce(L, (a, x) ↦ a + 2x, 0)`, `Reduce(L, h, 1+i)` → `3 + 7i`,
  seedless `Scan(L, h)` → `[1+2i, 1+4i]`, `Scan(L, Add, 0)`) — correct in
  EVERY mode with `mode: 'strict'`, no `escalation`, `promoted: false`
  (`combinerPlan`, already shipped).
- **Strict mode declines, loudly, with the §4 payload naming the boundary
  — target-specific:** on `javascript` and `python`: `b(w)`, `b(t + w)`,
  `h(w, 2)`, `h(2, w)`, `b(L)` and `Map(b, L)` for `L: list<complex>`, the
  multi-clause and protocol-member complex-parameter cases, the block
  re-binding case; on `glsl`: `b(w)`, `h(w, 2)`, `b(L)` (the boundaries the
  GPU route reaches — same payload class), while a multi-clause or protocol
  call on `glsl` keeps its existing "unsupported" diagnostic (`kind:
  'capability'`), and the accumulator shape declines there per step 5.
- **`auto` — three outcomes, each observable on `result.mode` /
  `result.promoted` / `result.escalation`:** (i) ESCALATES exactly the
  strict-decline witnesses above (`mode: 'complex'`, `escalation.boundary`
  and a user-legible `escalation.binding` set, `escalation.kind ===
  'correctness'`) and matches the interpreter — `b(w)` → `2 + 4i`, the
  block-shadow case → `7`, and `|b(a(t))/2 − 1|` at `t = 0.3` →
  `1.3038404810405297` (a PROMOTED value reaching `b`'s wide parameter is a
  lane mismatch); (ii) PROMOTES without escalating (`mode: 'strict'`,
  `promoted: true`, no `escalation`): `|√(t−1)|` → the number `0.83666…`,
  `Re(√(t−1))` → `0`, `(√(t−1))²` → `−0.7`, `m(t) := n(t) + 1` with `n(t)
  := √(t−1)` → `1 + 0.8366…i` (typed flow through a function RESULT is not
  a wide binding), and Tycho's `|w(t)[1]/2 − 1|` with `w(t) := [√(t−1),
  …]` → a real number; (iii) neither (`mode: 'strict'`, `promoted: false`)
  for a document with no promotable head and no complex value:
  byte-identical code to today's default. Note for the guide: `auto`
  differs from today's DEFAULT exactly on unknown-sign radicals — `Sqrt(x)`
  at `x = −1` is `NaN` under `mode: 'strict'` and `{re: 0, im: 1}` under
  `auto`.
- **Result convention:** `arcsin(0.5)` → the number `0.5235…`; `1 + 1e-12i`
  → `{re: 1, im: 1e-12}`; `x < 3` → `true` in every mode.
- **D2 corpus block [field]** — Tycho's band census on 0.113.0
  (`docs/scratch/2026-08-16-band-census-0113.json` in the Tycho repo, 8,282
  slots / 687 states, per-slot LaTeX + reason + state ID; the 15/9/4 split
  reproduces 0.112.0 exactly): 15 capability declines collapsing to ~9
  DISTINCT forms (`r ≥ √(1+9cos²1.1θ)` and `r ≤ 1/√(1−|cosθ|sinθ)` recur
  across three states) — the regression block is built on the distinct
  forms with the state IDs as provenance, from the file's exact strings.
  Two forms are the ones that test D2's generality and are stated here as
  explicit requirements: (i) `y·ln(y) − y ≥ −x²` (`gujemeosra`) — a `Ln`
  promotion, not a radical: the runtime rule keys on the operand's
  complex-shapedness through `isComplexValued`, which is head-general, and
  the D2 witness list must include a `Ln` form; (ii) `mod((√(x²+y²) −
  √(9.81k)·t)·k, 2π) ≤ 1` (`dzrqmexxik`) — the promoted value is NESTED
  below the comparison, under `Mod`: D2 is satisfied because `Mod`'s own
  D2 rule makes its result real-or-`NaN`, so the comparison's operand is
  real; the requirement is that the rule apply to every head on the path,
  never only to the comparison's immediate operand ("the operand may be
  complex" and "the operand may CONTAIN a promoted value" are different
  predicates, and the second is the one that holds).
- **D2:** `Less(i, 2)`, `Floor(2i)` decline at compile time in every mode;
  `Less(z, 2)` for `z: complex` compiles and yields `true` at `z = 1`,
  `false` at `z = i`; `y > √x` compiles under `auto` and yields `false`
  where `x < 0`; a chain with `Random` at the FIRST and at the LAST position
  draws once each (counter witness); `Mod(z, 3)` → `NaN` at `z = i`;
  `And(False, Random() < z)` draws nothing (counter witness) and `Or(True,
  i < 2)` still declines at compile time; every compile-time D2 decline
  carries `diagnostic.kind === 'capability'`.
- **D3:** strict mode `run({x: {re: 1, im: 1}})` for an unknown-typed `x`
  throws naming `x`; `run({z: 2})` for `z: complex` lifts and computes.
- **D8:** `√(Random()) < 2` under `auto` and `complex` draws once per
  call (counter witness), and `2·√(Random())` in complex mode lifts the
  one bound draw, not two.
- **D6:** `Erf(x)` in complex mode → `erf(0.5)` at `x = 0.5`, `NaN` at
  `x = i` (via a `complex`-typed `x`).
- **D7:** a strict-mode decline with `fallback: true` and a `{re, im}` `vars`
  value returns the interpreter's value as `ComplexResult`.
- **Non-numeric wide bindings in complex mode:** `id("abc")`, a callback over
  a `list<string>`, a boolean pass-through — unchanged.
- **Options:** `{complexPromotion: true}` → complex + warning; `{mode:
  'strict', complexPromotion: true}` → strict + warning; `{realOnly: true,
  mode: 'complex'}` → old projection + warning; effective-mode resolution:
  no option and no target mode on `javascript` → `auto`, on `glsl` →
  `strict`; `{mode: 'auto'}` on `glsl` → `capability` decline at option
  validation; a custom target declaring `'complex'` without the two hooks,
  or `'auto'` without `reset()`, is rejected; a direct reusable custom
  target that escalates after emitting a helper produces no duplicate or
  stale output on the retry.

## 10. What is asked of the Tycho team (via CE-POC)

**Measurements 2–4 RECEIVED 2026-08-16** (artifact
`/Users/arno/dev/tycho/docs/scratch/2026-08-16-compile-mode-audit.json`,
per-document JSONL beside it; CE 0.113.0; 687/687 documents, 0 failures,
6617 rows; figures verified against the artifact by CE-POC and re-read from
it here). **Label that travels with the numbers:** `provably-real`,
`promotes-no-escalation` and `actionableWideBindings` are MEASURED;
`escalates` is **MODELLED from §3 — CE had not implemented escalation when
the instrument ran** (the artifact carries this in its `labels` block).

- **M2 — provable-real fraction** (compiling denominator 5489 = 6617 − 1104
  did-not-compile − 24 budget-exceeded): provably-real 4896 = 74.0% of all
  rows, **89.2% of compiling rows**; promotes-without-escalation 573 = 8.7% /
  **10.4%**; escalates (MODELLED) 20 = 0.3% / 0.36% (15 via a promoted value,
  5 via a typed complex value only; the per-model-row tally E1 29 + E3 1 = 30
  disagrees with the class count — Tycho is chasing the instrument's
  definition; even at 30 it is 0.55% of compiling rows, and nothing below
  rests on it). Also `complexTypedNoPromotion` 47, `extendedPromotableOnly`
  229; GLSL lane rows 847, of which **386 classified-but-declined**.
- **M3 — cross-lane definition consumption (§7's number):** strict 26,
  loose 32 of 687 documents → **3.8% / 4.7%** (26 "shares promoting
  definition X with row(s) …" + 6 "closure includes … (loose only)"). The
  shared-lane constraint binds in under 5% of documents: document-scoped
  lane selection is a small cost, per-row selection viable.
- **M4 — narrowing lever split:** 13345 wide bindings — actionable **1382
  (10.4%)**, deliberate 11938 (89.5%), unknown-element 25. Every actionable
  site is one rule (a slider / free document variable declarable `real`);
  by boundary: user-function-parameter 9424, lambda-parameter 2457 (both
  deliberate — typed at registration, §2.2's floor), document-variable
  1382, block-local 57, list-element 25; by width: any/unknown 4200,
  number-typed 9145. So the ONLY narrowable seam is document variables →
  `real`, worth 1382 sites; the 11881 parameter bindings are contract, not
  slack.
- **Two more counters:** `entryCheckSites: 0` across the corpus — the D3
  entry check (step 2) has NO measured field exposure; before more is spent
  on it, ask Tycho what construct the instrument looks for (a `{re, im}`
  handed through `vars`/lambda args to a real-analyzed binding is what D3
  guards; if the seam never does that, D3 is a safety net with a zero
  corpus hit-rate — kept, since its per-call cost is one `typeof`, but not
  a lever). `shadowedImaginaryUnit: 25` — 25 sites bind `i` themselves;
  under any complex-by-default reading, whether `i` is the imaginary unit
  or the user's variable is load-bearing → **the spec states it**: the
  compiler follows the ENGINE's binding of `i` — a binder-bound `i` (a `Sum`
  index, a lambda parameter) and a DECLARED document variable `i` are that
  binding, never the constant, exactly as the interpreter reads them; a
  declaration ALONE suffices (`declare('i', 'real')` with no value flips
  `2i` from `Complex(0, 2)` to the real product `2·i` — the state a slider
  sits in before it is set, so it is the case to know). Verified 2026-08-16
  on both routes (binder: `Sum(i·t, i=1..3)` → `1t + 2t + 3t`, `(i) ↦ 2i` →
  `2 * i`; document variable: CE-POC probe A/B/C). Operational note for the
  seam, not a CE change: a bare `assign('i', 5)` WITHOUT a prior declare
  throws (`i` is a library constant; bare assignment to a constant is
  refused by design), while `assign('j', 5)` succeeds — a seam that
  bare-assigns document variables throws on exactly those 25 sites; declare-
  then-assign shadows correctly. CE-POC has asked Tycho which spelling their
  seam uses. `ambiguousElementReads: 75`
  (the `At`-over-disagreeing-elements decline class) — sized, unchanged.

**Sizing conclusion (data-supported): `auto`, and not narrowly.** 89% of
compiling rows are provably real and need no promotion; 10% promote without
escalating; `complex` mode would move the whole corpus off the real lane to
serve that 10% and would cost the GPU lane hardest (847 GLSL rows, 386
already declining). Cross-lane sharing under 5% keeps §7's document-scoped
fallback cheap. **What this spec does NOT solve, stated once:**
the REFUSAL SET IS NOT YET MEASURABLE — every figure the instrument has
produced for it (1104 rows, then ~575, then ~541) was superseded within the
hour by another flaw in the same denominator: 279 definition rows that are
not render targets, ~250 no-series-type rows whose direction ("CE declined"
vs "the seam never asked") is undecidable from the dump, and 34 polygon
rows of a series type that never compiles BY DESIGN (`PolygonListSeries`,
Tycho's `src/plot/types.ts`: "vertices are pre-materialized by the build
path, so the renderer neither samples nor compiles" — the seam never
submits them to CE, and there was never a Tycho request behind `Polygon`;
Arno's ruling: no CE lowering, no point-in-polygon predicate). Tycho is
rebuilding the exclusion into the instrument rather than subtracting after
the fact, so NO cardinality is stated here (a number that moved three times
does not get a fourth). What HAS survived every re-cut is the SHAPE: the
refusals that are real cluster into a small number of operator families —
`primitives3d` (triangle / PointList 3D primitives) and `line` — and the
386 classified-but-declined GLSL rows are 68% two types (parametric 139,
implicit 123); so the follow-on work is enumerable, not a long tail. (Method
note, CE-POC's: a census that asks a capability question of everything —
including things nobody asks that capability of — measures its own scope,
not the capability.) (One witness to keep: polygon decline `0rpoke7ti2` carries
`\frac{0}{0}`, a deliberate Desmos idiom for "skip this vertex". NOT a
known CE gap: on the JS lane interpreter and compiler agree, scalar and in a
collection — `PointList(0/0, 0)` runs to `[NaN, 0]`, a genuine `NaN` that
stays distinguishable; on the GLSL lane `PointList(0/0, 0)` compiles to
`vec2(_gpu_nan(), 0.0)`, so the NaN survives there too. Its decline reason
is pending the reason-capture census; the semantic ("skip this vertex") is
the seam's to honor.) The reason-capture census runs
lock-gated after Tycho's sweep. If any of Tycho's GLSL declines are a lane expecting `float` and receiving
`vec2`, one mechanism that produces exactly that is a folded literal
`ComplexInfinity` (§2 known limit (i′): `x + 1/0` → `vec2`) — `auto` would
not change it. `Polygon`: RULED 2026-08-16 (Arno, after Tycho) — not CE's, and per the
paragraph above never a refusal at all.
This spec answers the LANE question; the
refusal census is the next workstream's input.

Two measurements on the real 687-document corpus, which they have offered
to run once this draft is stable — this is that draft. **The corpus window
is the critical path** if this workstream lands in the held release: it
gates the D2 corpus block (5), the provable-real fraction (1) and §7's cost
(2), all three.
1. **The fraction of chains `auto` keeps in strict mode** (no promotable head,
   no lane mismatch), and separately the fraction that PROMOTES without
   escalating and the fraction that ESCALATES. This bounds D1 and decides
   whether `auto` earns its complexity over "always `complex`".
2. **The cost of document-scoped lane selection (§7):** how often a document
   mixes a promoted/escalated row with GLSL-heavy rows.

And three questions:
3. ANSWERED (rev 4 read): the payload is sufficient to ACT provided
   `binding` is user-legible (now a §4 contract); row identity is not
   needed.
4. ANSWERED: the result convention is accepted, with the two-direction
   guarantee now stated in §5.
5. IN PROGRESS: the ordering-comparison decline expressions arrive as a
   block once the census is re-run with its new per-slot `--out` dump (full
   LaTeX and reason per loss/gain/move, state IDs attached) in the corpus
   window;
   they become the regression suite's D2 corpus block, sized by what
   arrives, and the verification "the runtime rule covers every one" is
   done on our side. No cardinality is claimed until then.
6. PARTLY ANSWERED: sliders and free variables are real, the complex-mode
   seed is complex, list-valued definitions have an element type — real
   wins; parameter shadows are DELIBERATELY `any` (§2.2's floor). The
   corpus pass will count actionable wide bindings separately from
   deliberate ones; only the first number is a lever.
