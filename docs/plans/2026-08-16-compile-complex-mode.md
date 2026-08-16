# Compile-time complex arithmetic as a MODE, not a per-node guess

Status: DESIGN, revision 5 (2026-08-16). Not started. Rev 4 was read by
the Tycho team (via CE-POC); rev 5 folds their three requirements and one
design limit (marked **[field]**); §10 lists what is still asked of them.
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
promoted (none is known; report one and it joins the list). (ii) The
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
| `√a`             | `Math.sqrt(_.a)`                      | same (`NaN` for negative `a`)                     | PROMOTED: `_SYS.csqrt({re: _.a, im: 0})` — `mode: 'strict'`, no escalation   | `_SYS.csqrt(_SYS.cplx(_.a))`                          | real: `NaN`; auto/complex: `{re: 0, im: 1.414…}` |
| `\|√a\|`         | `Math.abs(Math.sqrt(_.a))`            | same (`NaN`)                                      | `_SYS.cabs(_SYS.csqrt({re: _.a, im: 0}))` — `mode: 'strict'`; result is a `number` (`Abs` is real-typed) | `_SYS.cabs(_SYS.csqrt(_SYS.cplx(_.a)))`  | real: `NaN`; auto/complex: `1.414…` (a number) — Tycho's `\|w(t)[1]/2 − 1\|` witness is this row |
| `√(−2)`          | `({re: 0, im: 1.414…})`               | same — PROVABLY negative is complex-shaped statically, in every setting | same                                             | same                                                  | `{re: 0, im: 1.414…}`                       |
| `√z`             | `_SYS.csqrt(_.z)`                     | same — typed complex is complex in every setting  | same                                                                       | same                                                  | `{re: 1.27…, im: 0.78…}`                    |
| `z² + z`         | complex `_re/_im` split-scalar block  | same (this is the fractal iteration's shape)      | same — `mode: 'strict'`                                                       | same                                                  | `{re: −2, im: 6}`                           |
| `b(a)`           | `_fn_b(_.a)`, `_fn_b = (x) => 2 * x`  | same                                              | same — `mode: 'strict'`                                                       | `_fn_b(_.a)`, `_fn_b = (x) => cmul(2, cplx(x))`       | `−4` (complex mode: `number` at the boundary) |
| `b(√a)`          | `_fn_b(Math.sqrt(_.a))` (`NaN` for negative `a`) | same (`NaN`; no promotion, no mismatch)   | promoted `√a` meets wide `x` → `LaneMismatch` → ESCALATES — `mode: 'complex'`, `escalation.boundary = 'user-function parameter'` | `_fn_b(_SYS.csqrt(cplx(_.a)))`, complex-lane `_fn_b` | real: `NaN`; auto/complex: `{re: 0, im: 2.828…}` |
| `b(z)`           | `_fn_b$z1(_.z)` (the 2026-08-15 lane specialization) | `LaneMismatch` DECLINE — "complex-shaped `z` bound to wide parameter `x` of `b`; declare `x` complex or compile with `mode: 'complex'`" (GLSL declines the same call today) | ESCALATES — `mode: 'complex'` | `_fn_b(_.z)`, complex-lane `_fn_b`          | real: declined; auto/complex: `{re: 2, im: 4}` |
| `√a < 2`         | `Math.sqrt(_.a) < 2`                  | same (`false` for negative `a`: `NaN < 2`)        | promoted operand → D2 runtime rule: `(_t = csqrt(…), _t.im === 0 && _t.re < 2)` — `mode: 'strict'`; today's `complexPromotion` DECLINES this (Tycho's ordering-decline class) | same runtime rule                          | real: `false`; auto/complex: `false` — and `true` at `a = 1` in all |
| `i < 2`          | declines                              | declines (statically non-real, D2)                | declines                                                                   | declines                                              | —                                           |
| `a < 3`          | `_.a < 3`                             | same                                              | same                                                                       | `_t = cplx(_.a); _t.im === 0 && _t.re < 3` (D2)       | `true`                                      |
| `Reduce(L, (p, x) ↦ p + 2x, 0)` | compiled `p + 2x` real-lane: `"[object Object]0"` (open defect) | seed `0` real, combiner RESULT complex-shaped → `LaneMismatch` DECLINE at the accumulator | ESCALATES — `mode: 'complex'` | accumulator complex; correct                | auto/complex: `2 + 6i` for `L = [1+2i, i]`  |
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
| `Reduce`/`Scan` accumulator                                     | IMPLEMENTED 2026-08-16 (`combinerPlan`): the accumulator lane is the seed's, widened once by the body's result; the combiner is compiled under that lane, and a real seed into a complex lane is lifted — so this row never mismatches: it is the one boundary that already computes both lanes correctly | a real seed to a complex accumulator lane lifts (`_SYS.cplx`) | as implemented |
| collection element (`List`/`Tuple` literal, `At`)               | element-by-element as today; an `At` whose element shapes DISAGREE declines as today (`assertNoAmbiguousComplexElementRead`) | a real element read as complex lifts | every wide element lifts at use               |
| `Which`/`If` arms                                               | today's arm coercion (item 60): a provably-real arm beside a complex one is lifted; unchanged | unchanged                             | unchanged                                     |
| result of the compiled unit                                     | typed/promoted complex → `{re, im}`; boolean → boolean; number → number | —                                                       | §5 convention                                 |

## 4. `LaneMismatch`: the decline, its payload, and the retry site

- A named `Error` subclass, `LaneMismatchError`, with a stable `code:
  'lane-mismatch'` and a structured payload: the boundary kind (a §3 row),
  the binding (function and parameter name, local, accumulator, …), the
  complex-shaped VALUE's expression, and the mode that would have compiled
  it (`'complex'`). Its message is human-readable and names the fix
  ("declare `x` complex, or compile with `mode: 'complex'`").
- **One catch-and-retry site:** `compile()` in `compile-expression.ts`, the
  public entry, around the target compile — for the registered-target route
  AND the direct-target route (which today bypasses `languageTarget.compile`
  and reaches `BaseCompiler.compileRoot` with no catch of its own; it is
  routed through the same wrapper). Targets never retry themselves.
- **Observability [field requirement]:** `CompilationResult` gains
  `mode: 'strict' | 'complex'` (the mode actually used) and, when `auto`
  escalated, `escalation: { boundary, binding, value }` — the payload above.
  **`binding` is USER-LEGIBLE by contract [field]:** it names an AUTHORED
  identifier (the parameter `x` of `b`, the local `k`, the symbol `w`), or,
  where the binding has no authored name, an honest description of an
  unnamed one ("an unnamed parameter of `b`", "the accumulator of the
  `Reduce`", "element 2 of the list") — never a compiler-internal spelling
  (`_t3`, `_tv1`, `_fn_b`). The consumer's seam calls `compile` per row, so
  it already knows WHICH row; what it cannot reconstruct is a name a user
  recognizes, and "your document moved to the CPU because of `_t3`" is
  worse than saying nothing. Row identity is therefore NOT part of the
  payload. Every decline this design emits — `LaneMismatch`, the D2
  compile-time decline for a statically non-real operand, and the existing
  fail-closed declines it keeps — also carries `kind: 'capability' |
  'correctness'` (§1's distinction), so a consumer's census can count the
  two apart without re-cutting a taxonomy after the fact.
  A decline that is NOT escalated (strict mode forced; a target that offers no
  complex mode) surfaces the same payload in `result.error`. A consumer can
  say "this went the slow way, and here is why", and — for a consumer whose
  seam chooses targets per row — WHICH row and why (§7).
- `interval-js` declines by returning `success: false` without throwing
  (documented in `compile-expression.ts`); it is excluded from escalation by
  construction and reports the payload in `error`.

## 5. The option surface: ONE knob (ruled)

- `mode?: 'strict' | 'complex' | 'auto'` (default `'auto'`) — the ONLY option,
  on `CompileExpressionOptions` and on `CompileTarget` (the target field
  replaces `complexPromotion`). Precedence: an explicit options-level `mode`
  wins over a target-level one; a target-level `mode` is the default for
  compilations through that target.
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
| `javascript`           | §2/§3, `ComplexResult` at the boundary                                 | §2/§3, `_SYS.cplx` at use, §5 result convention                        | real + promotion, escalate on `LaneMismatch`        |
| `python`               | same rules; complex values are native Python `complex` in the emitted source (source-only: no runner, no `{re, im}`, no D3 entry check — the caller's Python runtime does what it does) | wide operands lifted with `complex(x)` at use; native results | as JS; escalation is a second source emission |
| `interval-js`          | real only (intervals are real); a complex-shaped value anywhere DECLINES with the §4 payload | not offered: `mode: 'complex'` DECLINES with a message | real, no promotion; a `LaneMismatch` DECLINES (no escalation target) |
| `glsl` / `wgsl`        | this IS the model: `vec2` for typed/provably-negative complex, `float` for wide, typed signatures check every call (`gpu-target.ts` unchanged in substance) | not offered in this design: DECLINES with a message (a `vec2`-everywhere shader mode is a possible follow-up, not promised) | real, no promotion (item-144 pins bind); a `LaneMismatch` DECLINES with the §4 payload |
| direct / custom target | inherits the base compiler's rules; declares `supportedModes` (default `['strict']`) | offered only if the target ALSO provides the two hooks below; validated at declaration | as declared |

A custom target that declares `'complex'` or `'auto'` must provide
`complexLift(code)` (the idempotent number → complex lift, `_SYS.cplx`'s
role) and `complexIsReal(code)` (the runtime realness test D2/D7 use); a
declaration without them is rejected at option validation. A minimal
custom-target conformance fixture pins the contract. Multi-clause and
protocol dispatch do not exist on the shader targets at all today (they
already fail as unsupported before any shape check); §3's rows for them are
JS/interval-only.

## 7. **[field]** One document, two lanes — the consumer-side consequence

Tycho's seam selects a compile target PER ROW, so a single document can span
the JS and GLSL lanes. Under this design strict mode is IDENTICAL across
lanes (that is what §2 defines it to be), but `auto`'s promotion and
escalation exist only on JS/Python — so a promoted document would compute
one row in complex arithmetic and another on the GLSL real kernel: exactly
the unpredictability the mode exists to remove. Neither "strict mode
everywhere" (their witness stays black) nor "promotion on the JS lane only"
(per-row semantics) is acceptable to them.

Their proposal, which this design supports and which is **Arno's ruling to
make, not theirs or ours** (a Tycho architecture change with a performance
consequence): **make lane selection DOCUMENT-scoped once promotion is
active** — if any row of a document escalates (or is promoted), the whole
document runs on the JS lane; a per-row semantic inconsistency becomes one
per-document decision, explainable to a user in a sentence. What this design
owes them for that to work is exactly §4: the decline/escalation payload
carries WHICH row (expression) escalated and WHY, so the seam can act
document-wide and explain an unrequested GPU→CPU fallback. Its cost — a
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
  chains keep their short-circuit order.
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
closed on a complex operand): in strict mode unchanged; in complex/auto mode
a wide or promoted operand takes the D2 runtime rule — bind once, run the
real helper when the imaginary part is zero, `NaN` otherwise — so `Erf(x)`
in a complex-mode document still compiles.

**D8 — effects.** The compiler is already effect-aware, and the mode
design changes none of it: `tryConstantFold` refuses an impure subtree
(`Random(…)` keeps drawing at run time); the relational-chain lowering
binds impure operands once, in argument order, so a shader draws once and
in the right order (`bindExpr`); and an expression whose effect set
includes `random` fails closed when a non-default kernel is installed
(`docs/EFFECTS-MODEL.md`). Two consequences to state, both already implied
above: (i) `auto`'s second compile is side-effect-free — compilation
evaluates nothing impure (the fold gate sees to it), so escalating costs
compile time only, never a repeated draw or a repeated write; (ii) D2's and
D6's runtime realness tests, and complex mode's lift-at-use, are emitted
over the ONE bound temporary of an operand, never over a re-evaluation of
it — an impure operand under `√(Random()) < 2` draws exactly once, in
every setting (a §9 witness). A body with effects (`Assign` to a captured
symbol, an `object-store` write) is unaffected by the mode: shape is about
values, and the effect discipline is orthogonal.

**D7 — fallback (JavaScript runner only).** A strict-mode decline with
`fallback: true` goes to the interpreter fallback as today, with two fixes:
(input) `buildInterpreterFallback` declares each var from the RUNTIME SHAPE
of the value it is handed (`complex` for a `{re, im}`, `number` for a
number) instead of the hardcoded `'number'`; (output) the scalar result is
normalized by the §5 convention instead of the unconditional `.N().re`.
Under `auto` a `LaneMismatch` escalates BEFORE any fallback is consulted.
Source-only targets (`python`, the shaders) have no runner: `fallback` is
irrelevant to them and the decline is reported; `interval-js` keeps its
non-throwing decline. Every §9 witness states its `fallback` setting.

## 9. Migration and regression suite

Migration order:
1. `mode` end to end (options → target → `BaseCompiler` static, read once);
   the deprecated mappings and warnings of §5; `LaneMismatchError` and the
   single retry site (§4); result `mode`/`escalation` fields; D7 input and
   output fixes; kernel-owned dust chop and exact boundary test (§5);
   internal `realOnly` callers migrated. Emitted code unchanged.
2. Strict mode: the §3 DECLINES where JS lacks them (parameter, value
   position, multi-clause, protocol, block re-binding, callback element,
   accumulator), the D3 entry check both directions. Behavior change: shapes
   that were silently `NaN` now decline loudly — each becomes an `auto`
   escalation in step 4.
3. Complex mode: `isComplexValued` answers `true` for a wide numeric value;
   `_SYS.cplx` at every wide numeric use; single-lane user-function emission
   with the boundary lift; D2/D6 runtime rules. Remove, in this order, each
   mechanism §1 lists as patching the guess, running the complex test files
   after each removal (`compile-complex.test.ts`,
   `compile-complex-element-access.test.ts`, `compile-complex-result.test.ts`,
   `fractals.test.ts`, the item 57–65/190 blocks, `list-parameter-indexing.test.ts`,
   `multi-clause-compile.test.ts`, `protocol-dispatch-compile.test.ts`). A
   test that pinned an emitted NAME (`_fn_K$z01`, `_fn_b$z1`) is rewritten to
   pin the VALUE.
4. `auto` = real + promotion, escalate on `LaneMismatch`.
5. GPU route: the accumulator decline row (the only §3 row it lacks — see
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
  `K2`; `id(x) := x` over a complex argument in complex mode.
- **Strict mode declines, loudly, with the §4 payload naming the boundary:**
  `b(w)`, `b(t + w)`, `h(w, 2)`, `h(2, w)`, `b(L)` and `Map(b, L)` for `L:
  list<complex>`, `Reduce(L, h, 0)` and `Reduce(L, (a, x) ↦ a + 2x, 0)`,
  `Scan(L, h, 0)`, the multi-clause and protocol-member cases, the block
  re-binding case — on `javascript` AND `glsl` (same payload class).
- **`auto` — three outcomes, each observable on `result.mode` /
  `result.escalation`:** (i) ESCALATES exactly the decline witnesses above
  (`result.mode === 'complex'`, `escalation.boundary` set) and matches the
  interpreter — `b(w)` → `2 + 4i`, `Reduce(L, h, 0)` → `2 + 6i`, `Scan` →
  `[2+4i, 2+6i]`, the block-shadow case → `7`, and `|b(a(t))/2 − 1|` at
  `t = 0.3` → `1.3038404810405297` (a PROMOTED value reaching `b`'s wide
  parameter is a lane mismatch); (ii) PROMOTES without escalating
  (`result.mode === 'strict'`, no `escalation`): `|√(t−1)|` → the number
  `0.83666…`, `Re(√(t−1))` → `0`, `(√(t−1))²` → `−0.7`, `m(t) := n(t) + 1`
  with `n(t) := √(t−1)` → `1 + 0.8366…i` (typed flow through a function
  RESULT is not a wide binding), and Tycho's `|w(t)[1]/2 − 1|` with `w(t) :=
  [√(t−1), …]` → a real number; (iii) neither, for a document with no
  promotable head and no complex value: byte-identical code to today's
  default. Note for the guide: `auto` differs from today's DEFAULT exactly
  on unknown-sign radicals — `Sqrt(x)` at `x = −1` is `NaN` under `mode:
  'strict'` and `{re: 0, im: 1}` under `auto`.
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
  draws once each (counter witness); `Mod(z, 3)` → `NaN` at `z = i`.
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
  'strict', complexPromotion: true}` → real + warning; `{realOnly: true,
  mode: 'complex'}` → old projection + warning; a custom target declaring
  `'complex'` without the two hooks is rejected.

## 10. What is asked of the Tycho team (via CE-POC)

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
