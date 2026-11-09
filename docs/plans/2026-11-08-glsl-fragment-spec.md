# The GLSL fragment: a positive list of what the shader target compiles

**Status:** approved 2026-11-08, with the decisions of section 6. No code yet; step 2 of section 7 is next.

This changes the documented target boundaries of `docs/COMPILATION-MODEL.md`
("Target boundaries"). It also drops the WGSL target, which replaces the
"keep" of `docs/plans/2026-11-02-language-axes-options.md`: the GPU renders
pixels in f32 and never computes data, so a compute target has no job, and
the f32 repairs that GPU data would need (an exact `fract` of a large
product, CE-1158) are not wanted.

## 1. Problem

The `glsl` target accepts any MathJSON expression and declines, during
emission, what it cannot lower ("Fail closed" in the model document). The
corpus audit of 2026-11-08 shows more than fifty distinct decline messages.
Whether a plot row can go to the GPU is found out in Tycho by compiling it:
a row ships as `glsl-deferred`, `compileDeferredGlsl()` in
`src/plot/math-plot-element.ts` compiles it at the first render, on a decline
tries the textual expansion (`exprFallback`) and then resolves the row onto
its CPU legs for good (`declineDeferredToCpu()`), and `composeLiveProgram()`
in `src/plot/webgl/gpu-implicit.ts` returns null when the engine declines. A
compile that throws is retried on every render. The engine has no predicate
of its own. The shader statement machinery (loops with `Break`, blocks, local declarations,
the statement-order and hoisting rules, the random-draw reorder) serves a
handful of corpus records (section 4).

The GPU renders pixels, in f32, on every live frame. It does not compute data
that a document stores: that is the JavaScript route, in f64. The shader
target therefore needs a small, fixed language, stated as a positive list, and
a predicate that answers "in or out" without emitting code.

## 2. The fragment

An expression is in the fragment when every node of its typed tree is in one
of these lists. The check runs on the canonical, type-inferred tree.

**Values and types.** A real scalar (f32), an integer, a boolean, a complex
number as `vec2`, a point or vector of 2 to 4 real components, a color, a
constant list of at most 256 real scalars or points (the shader array limit),
a list input that the `storage` option of `compile()` names with the hint
`'sampler2D'` (`CompilationOptions.storage` in `compilation/types.ts`; read
through a `texelFetch` helper with a bound guard, with no limit on its
length; in Tycho these are the `byReference` names of a row, and the
`buddhabrot` showcase entry reads a 90,001-element list and `game-of-life` a
22,500-cell board this way), and, if decision 1 says so, a matrix of at
most 4 × 4 real entries. Every free symbol has one of these types, declared
or inferred in the engine (`compile()` has no option that gives a type;
`hideValues` is an option of Tycho's wrapper). A symbol typed `unknown`, `any`, `expression`,
`symbol`, `string`, `function` or a collection without a static count is
outside the fragment. A parameter of a user function with no declared type
is not a free symbol: it takes the type of its argument at the calls
(decision 11). A free list input of at most 256 elements without a
`storage` hint is a uniform array; a longer one is refused with a
diagnostic that gives its length, the limit and the `storage` option
(decision 12). The `vars` option, a rename map from the user's
symbols to shader identifiers (`{ x: "v_pos.x" }`), is spelling, not a
language form: the predicate accepts it and ignores it, except that it
refuses an entry that is code where the emitter would write that code twice
(`Cot(w)` with `{ w: "nextValue()" }`).

**Heads.**

- Arithmetic: `Add`, `Subtract`, `Multiply`, `Divide`, `Negate`, `Power`,
  `Root`, `Sqrt`, `Square`, `Abs`, `Sign`, `Floor`, `Ceil`, `Round`,
  `Truncate`, `Fract`, `Mod`, `Remainder`, `Hypot`, `Clamp`, `Mix`, `Step`,
  `Smoothstep`, `Max`, `Min`, `ElementMax`, `ElementMin`, `GCD`, `LCM`,
  `Factorial`, `Binomial`, `Choose`.
- Elementary and special functions already in the shared GPU table
  (`gpu-functions.ts`): the trigonometric, hyperbolic and inverse families,
  `Exp`, `Exp2`, `Ln`, `Log`, `Log2`, `Log10`, `Lb`, `Lg`, `Arctan2`, `Sinc`,
  `Erf`, `Erfc`, `ErfInv`, `Gamma`, `GammaLn`, `Digamma`, `Trigamma`,
  `PolyGamma`, `Beta`, `Zeta`, `HurwitzZeta`, `PolyLog`, `LerchPhi`,
  `BesselJ`, `FresnelC`, `FresnelS`, `Heaviside`, `Haversine`,
  `InverseHaversine`, `Degrees`, `Radians`, `Mandelbrot`, `Julia`.
- Complex: `Real`, `Imaginary`, `Argument`, `Conjugate`, and the elementary
  functions on a complex operand where the table has the complex helper.
- Points and vectors: `PointList` (the point constructor), `Tuple`, `PointX`,
  `PointY`, `PointZ`, `Dot`, `Cross`, `Norm`, `Normalize`, `Distance`,
  `Reflect`, `Refract`, `Length`, `First`, `Second`, `Third`, `Last`.
- Colors: `Rgb`, `Hsl`, `Hsv`, `Oklab`, `Oklch`, `Color`, `ColorMix`,
  `AsRgb`, `AsHsl`, `AsHsv`, `AsOklab`, `AsOklch`, `ColorToColorspace`,
  `ColorFromColorspace`, `GamutMap`, `ContrastingColor`, `ColorContrast`.
- Comparison and logic: `Less`, `LessEqual`, `Greater`, `GreaterEqual`,
  `Equal`, `NotEqual`, `And`, `Or`, `Not`, on real or boolean operands only.
- Selection as an expression: `If` with both branches, `Which`, where every
  branch has the same fragment type.
- Aggregates: `Sum` and `Product` over one or more integer index ranges whose
  bounds are integer-valued fragment expressions (a bound may depend on an
  input or on an outer index), with a body in the fragment. They lower to a
  counted loop with no `Break`. A run-time pass counter, shared by every
  aggregate of one evaluation (nested aggregates multiply), gives `NaN` over
  the cap; the cap is the `iterationBudget` option that the JavaScript target
  has, so a host sets one option for every target. A bound raised past the
  cap by a slider gives `NaN` pixels, not a recompile decline. The counter
  counts the passes that the emitted code runs, as the JavaScript target
  does: two equal aggregates that the common-subexpression pass writes once
  count once.
- Indexing: `At` with a constant index or an integer-valued fragment index on
  a base that is a constant list, a sampler-backed list input or a point;
  `Range` with integer-valued bounds, as the index set of a `Sum`, `Product`
  or `At` only.
- Calls of user functions whose parameters and result have fragment types and
  whose body is in the fragment, with no recursion, direct or mutual. Such a
  function is emitted once as a GLSL function. A parameter with no declared
  type takes the type of the argument at the first call; a later call with
  an argument of another type is refused, and the diagnostic names the
  parameter and the two types (decision 11).
- The body of a user function, and the row root (decision 13), may be
  a scalar block (decision 6): `let` and `const`
  declarations of scalar, point or complex locals, assignment to a local, a
  tuple assignment of locals, a counted `for` over an integer range with
  `break`, `if` statements, and a final expression. No list parameter, no
  list local or write, no nested function, no `Loop` without a range. GLSL
  has each of these natively. The pass counter of the aggregates counts
  these loops too. Two heads of Epsil's `parallel for` are part of this list
  (decision 7): `AddTo` on a scalar local (`s += e`),
  which is `s = s + e`, and a `ParallelLoop` over an integer range whose
  accumulators are scalar locals of the function, which compiles as the
  counted loop with its passes in order. The interpreter and the JavaScript
  target define a `parallel for` as the values of the passes in order, so one
  fragment that runs them in order gives the same value; without this entry,
  a function that gains the keyword for the CPU route would lose its GPU
  route. A `ParallelLoop` whose accumulator is not a scalar local, a list
  accumulator (`L[c] += e`,
  a list write) and a `ParallelComprehension` whose range is not constant
  are outside the fragment: the GPU does not run a `parallel for` in
  parallel, since an accumulation into an outer variable computes data, and
  the per-pixel evaluation of a row is already the GPU's parallel form.
  Two refinements come from the audit with preludes (section 4,
  decision 8): (1) the forms nest, so a branch
  of an `if` and the body of a loop are blocks of the same forms, with their
  own `const` locals (the colour formula of `buddhabrot` declares two locals
  inside a branch); (2) "no list parameter" has one exception: a parameter
  that every call binds to a storage-backed list input, read only with `At`.
  The function is then emitted once per bound list, with the list as a
  global sampler (`c(H, x, y, z)` of `buddhabrot` compiles to
  `_fn_c_bind0_H(x, y, z)` today). A list parameter bound to anything else,
  and any write to it, stay outside the fragment.
- Compile-time work whose result is in the fragment: constant folding, the
  closed-form derivative (`derivative-closed-form.ts`), common-subexpression
  elimination, and the unrolling of a comprehension or a `Map` over constant
  integer ranges or a constant list of at most 256 elements, whose body is in
  the fragment (`min([T(x, y, i, j) for j = 0..1, i = 0..1])` compiles to
  four calls today).

**Out.** `Loop`, `Block`, `Declare`, `Assign`, `Break` and `Continue`
outside the block forms above, `Match`,
`Map`, `Filter`, `Reduce` and every other callback form over a collection
without a static count, a comprehension whose range depends on an input,
function literals and function values, `Apply`, `Random` and the other random
draws, `WithRandomSeed`, `Integrate` and every numeric quadrature, every
symbolic head (`Simplify`, `Expand`, `Solve`, `D` at run time, `Hold`),
strings, dictionaries, records, collections without a static count, `Range`
as a value, recursion, and a free symbol outside the types above.

## 3. The predicate and the boundary

`canCompile(expr, options)`, on the engine and exported from the compile
entry, takes the same options object as `compile()` (`vars`, `storage`,
`functions`, `mode`, `iterationBudget`, `constantFold` and `cse` decide the
answer) and
answers `{ ok: true }` or `{ ok: false, diagnostic }` with one decline code,
`outside-fragment`, in the `CompileDiagnostic` form that `compile()` already
reports, naming the head that is outside or, for a free symbol without a
numeric type, the symbol (the one cause a host can repair by declaring the
type). It walks the typed tree once, emits nothing, never throws, and its
verdict depends only on the expression, the options and the declarations
that the expression reaches (the types of its free symbols, the definitions
of the functions it calls), so a host may cache it per function until one of
those declarations changes. `compile()` to `glsl` runs the same predicate first;
emission never declines a fragment expression, so a decline during emission
is a defect. The `float32-unsafe-argument` warning of a compile that
succeeds stays: Tycho keeps a curve row with a sine hash on the CPU because
of it.

**How to build it (decision 9).** The predicate is a
typing pass, not a yes-or-no walk: it annotates each node of the tree with
its fragment type (real, integer, boolean, complex, point of n components,
color, list, function), its representation on the target (a `float`, a
`vec3`, an array, a sampler) and the conversion of each operand, and keeps
the annotation beside the tree; the verdict is "every node has a type". The
GLSL emitter reads the annotation where it asks the same question today (the
shape frames of `gpu-shapes.ts`, the declared-type frame of
`gpu-declared-types.ts`) instead of deriving it again. The annotation can
take another fact later only when that fact has the same value at every read
of the node in its scope (the origin of a node, the names it reads and
writes). A fact about a value that the body assigns, and the count of the
evaluations of a node, do not fit it. The annotated tree is a typed front
end: a later intermediate representation, if one is built, takes it as its
input and adds values with an identity, conversions as operations, effects,
and rewrites that each make a new revision. It is not part of this change.
The design is `docs/plans/2026-11-08-glsl-fragment-annotation-design.md`.

Tycho calls the predicate at resolve time, on the by-reference form and then
on the textual expansion, and ships a row that is out on its CPU legs there
instead of at the first render. `gpuImplicitEligibility()` is unchanged: its
rules are about rendering (renderer present, linear axes, dashed stroke,
clip box, the float32 range probe, the alias-collision guard) and stay in
Tycho.

The `javascript` and `interval-js` targets are unchanged: they take the whole
language with their current declines.

## 4. Witness

The corpus audit of 2026-11-08 (`~/dev/tycho/_TASK/desmos/desmos-corpus/codegen-audit/ce-0.184.0-all.json`,
Tycho `9d75660ed`, CE 0.184.0; census script in the scratchpad of session
2fc832a1, `census/heads.mts`):

| Measure | Value |
| --- | --- |
| GLSL records | 3,657 in 283 documents |
| Declined today | 52 |
| Free-symbol bindings in compiled records | 7,718, every one with a numeric type; none `unknown` or `any` |
| Records whose emitted code has a `for` loop | 18 in 8 documents, every one a `Sum` or `Product` |
| Records whose emitted code has an `if` statement | 31 in 12 documents, every one a piecewise user function or a `Which` |
| Records with a head outside the fragment that compile today | none. The two `Map` records with a function literal (`neyret/ac6kkpwrep`, `neyret/lwuwgb9ic5`) decline today (an array operand of `Add`); the comprehension of `neyret/0vlrmhen37` has constant bounds and unrolls, so it is in; the two comprehensions of `neyret/ibmtbbjyzq` have a bound in `t` and decline today. No record of today's run uses a random draw (`WithRandomSeed` appeared in two documents of the September run only). |

Of the heads that occur in 10 or more documents, every one is in the
fragment. The 52 declines are a constant list above the array limit (7, one
document), recursive user functions (9, two documents), `At` on a base with no
static count (12), a point whose component is itself a vector (6),
`Comprehension` with a run-time bound (2), `Integrate` (1), and single cases.
Under the fragment every record that compiles today still compiles (one
record with `Transpose` excepted if decision 1 leaves matrices out), and the
52 declines become one decline code answered before emission.

What the whole-corpus audit of 14:55 did not cover (Tycho, 2026-11-08): the
`storage` option (no record of that run carries it; three records of the run
with preludes do, see below), the
`hideValues` and typed inputs that the implicit rows get at render time, and
the 71 records with a `vars` map, which the audit records but the census did
not inspect. Whether a plot row's by-reference compile ever carries a
prelude function with a `Block` body was first flagged as not verified, then
verified by Tycho the same day (probe on CE 0.184.0 with `executeEpsil` and a
compile to `glsl`): four showcase entries in
`src/graph-paper/onboarding/template-data.js` do. `burning-ship` draws the
heatmap `B(x, -y)`, where `B` is an Epsil prelude function with `let` locals,
a `for k in 1..128 { … if s > 65536 { break } … }` loop and an if/else value;
`multibrot` (`M(x, y, d)`) has the same shape; `julia-set` (`J(p, q, u, v)`)
has a 256-pass loop with `break` and colour functions with `const` locals and
nested if/else; `buddhabrot`'s colour formula `c(H, x, y, z)` has `const`
locals and an if/else value. Such a function compiles to a GLSL
`float _fn_f(…)` with a `for` loop today, so these heatmaps are on the GPU
through the statement machinery of section 5. The audit could not see them:
its harness ran no prelude. Decision 6 decides their route.

The audit with preludes (`ce-0.184.0.json` of 2026-11-08 15:57, Tycho
`a40372202`, the CORE corpus and the showcase entries: 209 GLSL records, 7
declined, all the 9,801-element list of one document). Its GLSL preambles
hold 78 distinct user functions in 21 documents. 21 of them declare locals,
6 have a counted `for` (3 with `break`: `burning-ship`, `multibrot`,
`julia-set`; 3 are a `Sum` inside a function), 7 have an `if` statement, none
has a `while`, a `continue`, an array local or an array parameter. Three
records carry `storage: { <name>: "sampler2D" }` (`buddhabrot` twice,
`game-of-life` once). Every one of these functions is inside the function
body list of section 2 with its two refinements. The emitter
also declares locals and nested blocks of its own for pure expressions (the
arguments of an inlined call, a shared subexpression): that is emission, not
a language form, and the fragment does not restrict it.

## 5. What the engine retires

With the fragment as the contract: the part of `gpu-statements.ts` (1,585
lines) that does not serve a scalar block inside a function body or at the
row root (decision 13) (the share
is not measured; step 3 measures it first), the
shader statement-order and hoisting rules and the random-draw reorder
(`gpu-draw-order.ts`, 729 lines), `Break` and `Continue` on shaders, the
dynamic and masked forms of GPU `At` (`gpu-at.ts`, 1,655 lines, in part),
the shader branches of the shared statement modules (`compile-blocks.ts` has
71 shader mentions, `compile-admission.ts` 37, `compile-statements.ts` 24),
and the per-head decline paths that the predicate makes unreachable. The
NaN-safe helpers, the finite proof over declared ranges and the exact sine
hash stay: they are rendering concerns with corpus witnesses. The WGSL target
goes (decision 10): `wgsl-*.ts` (3,325 lines), about 300 WGSL
branches in the shared GPU files, the `wgsl` entry of the target registry and
the `compileShader`/`compileKernel` routes that only it used, its tests (186
test files name it; most also test GLSL and keep their GLSL half) and its
pages in `docs/COMPILATION-MODEL.md` and in the cortexjs.io compile guide.
The `parallel for` plan (`docs/plans/2026-11-07-ce1093-parallel-for.md`)
loses its compute-shader backend; the construct stays, and its backend is a
new decision (section 6, note after decision 6).

## 6. Decisions (approved 2026-11-08)

Decisions 1 to 5 were taken as recommended.

1. Matrices: in or out. One corpus record (one document) uses `Transpose`
   and compiles today; no emitted GLSL in today's run contains `mat2` to
   `mat4`, and Tycho has no route that needs them. Out is the smaller
   contract and costs that one record its GPU route; in costs nothing now
   but keeps the matrix entries of the table under the contract.
   Recommended: out.
2. `Map` with a function literal over a collection without a static count:
   out (the two corpus documents that use it decline today, so nothing
   changes for them). A `Map` over a constant list unrolls, as a
   comprehension does. Recommended as written.
3. Random draws: out. No record of today's run uses one; two documents of the
   September run used `WithRandomSeed`. Tycho is asked whether those rows
   still reach GLSL (section 7, step 5).
4. The pass cap: the `iterationBudget` option, counted at run time over the
   whole evaluation (section 2, "Aggregates"). Recommended default: 10,000
   passes per evaluation, which covers every GLSL aggregate in today's corpus;
   two nested sums of 10,000 passes each would be 1e8 passes per fragment and
   a lost WebGL context under a per-aggregate cap.
5. The constant-list limit: keep 256 (the current shader array limit) or make
   it a target option. It does not apply to a sampler-backed list input. The
   7 declines it causes today are one document with a 9,801-element literal,
   which renders on the CPU.

6. **The body of a user function: expression only, or a scalar block.**
   Four showcase entries (section 4) call prelude functions whose bodies are
   blocks: escape-time fractals with scalar locals, a counted `for` with
   `break` and `if` statements. Under the fragment as written they decline
   and render on the CPU grid route. Tycho's estimate from the measured pass
   cost of generated code (about 4 ns per pass, Tycho
   `roadmap/BUDDHABROT_CODE_STUDY.md` § 5.4): 128 to 256 passes per pixel is
   0.25 to 0.5 s per full-canvas frame on one thread and 40 to 80 ms on the
   8-worker pool, against a per-frame draw on the GPU today.
   - (a) Admit a scalar block as the body of a user function, and only there,
     never at the row root: `let` and `const` declarations of scalar, point or
     complex locals, assignment to a local, a tuple assignment of locals, a
     counted `for` over an integer range with `break`, `if` statements, and a
     final expression. No list parameter, no list local or write, no nested
     function, no `Loop` without a range. GLSL has each of these natively, so
     the lowering is a spelling, and the escape-time fractal is the canonical
     GPU rendering workload. Cost: the function-body part of
     `gpu-statements.ts` stays; the row-root hoisting, the statement-order
     rule and the random-draw reorder still go. The pass counter of decision 4
     counts these loops too.
   - (b) Expression bodies only. The four entries move to the CPU route at the
     cost above, or get built-in heads (`Mandelbrot` and `Julia` exist in the
     GPU table today; `burning-ship` and `multibrot` do not). Each new fractal
     a user writes in Epsil stays off the GPU.
   **Decided: (a).** The admitted forms are in
   section 2, "The body of a user function". Decision 13 replaces "never at
   the row root": the row root takes the same forms.

7. Epsil's `parallel for` inside a function body: `AddTo` on a scalar local
   and an in-order `ParallelLoop` with scalar local accumulators are in
   (section 2).
8. The function-body forms nest, and a list parameter that every call binds
   to a storage-backed list input is admitted (section 2).
9. The predicate is built as a typing pass whose annotation is a typed front
   end, the input of a later intermediate representation (section 3).
10. The WGSL target is dropped (section 5). `parallel for` runs on the
    JavaScript worker pool: the construct's rules (independent passes, outer
    writes only through `+=` accumulators) are the proof that a range split
    is valid, the result is f64 and deterministic, and the measured gain on
    the Buddhabrot step at 500,000 samples is 75 to 107 ms down to 12 to
    16 ms with 8 workers (Tycho `roadmap/BUDDHABROT_CODE_STUDY.md` § 8.5).
    The design is `issues/CE-1163.md`, which waits for its own approval.

Decisions 11 to 13, approved 2026-11-08, come from the comparison of
`canCompile()` with `compile()` over the expressions of the GLSL tests (step 3
of the implementation plan, phase B):

11. **A parameter with no declared type takes the type of its argument.**
    `f(x) := x^2` called as `f(t)` with `t: real` compiles with a `float`
    parameter; called as `f(z)` with `z: complex`, with a `vec2` parameter.
    The type comes from the argument at the first call of the function; a
    later call with an argument of another type (`f(t)` and `f(z)` in one
    expression) is refused, and the diagnostic names the parameter and the
    two types. Before this decision, the compiler read such a parameter as a
    `float` whatever the argument, which gives a wrong shape for a complex or
    point argument; the spec as first written refused it (44 test
    expressions). One emitted function per set of argument types is a later
    task, done only on request.
12. **A free list input longer than 256 elements without `storage` is
    refused, and the diagnostic names the fix.** `At(S, k)` with
    `S: list<real^1600>` gave `uniform float S[1600];` and reported success,
    but GLSL ES 3.00 guarantees 224 uniform vectors in a fragment shader, so
    such a shader can fail to link on a GPU. The diagnostic gives the length,
    the limit 256 and `storage: { S: 'sampler2D' }`. A list input of at most
    256 elements without `storage` stays a uniform array.
13. **The row root takes the block forms of a function body** (decision 6
    (a), section 2). `Block(Assign(s, x), s)` at the root compiles, as it does
    in the body of a user function: the emitter already writes the root as a
    function body (133 test expressions). Section 5 therefore keeps the part
    of the statement emission that a root block uses.
14. **A list parameter bound to a list input held as a uniform array is
    admitted**, as decision 8 admits one bound to a sampler-backed input.
    `g(H, x) := H[1] x` called as `g(L, x)`, with `L: list<real^5>` not named
    in `storage`, compiles to a variant of `g` that reads `L` by name
    (`float L[5]`), as the compiler did before the fragment. Decision 12
    keeps such an input as a uniform array, so its function variant is
    admitted too. A list parameter bound to anything else stays outside.
15. **A number added to a shader vector** (approved 2026-11-08). `Add` and
    `Subtract` take a number beside a name that `compileShader()` or
    `compileFunction()` declares with a GLSL vector type (`vec2`, `vec3`,
    `vec4`; a built-in variable such as `gl_FragCoord`), as GLSL does:
    `gl_FragCoord + 1` compiles to `gl_FragCoord + 1.0`. The same applies
    to an arithmetic expression of such names and numbers:
    `2 * gl_FragCoord + 1` compiles to `2.0 * gl_FragCoord + 1.0`. The name
    must be the declared input: a parameter or a local of the same name is
    not. A point of the user's expression beside a number stays refused,
    because the interpreter refuses `(1, 2) + 2`.

A bound or an index whose type is real (`Limits(k, 1, n)` with `n: real`)
stays admitted, and the emitted code truncates it with `int()`. This gives
the interpreter's value only when the bound holds an integer. Step 3 of the
implementation plan counts the corpus records with such a bound and records
the difference as an issue with that count; the rule is decided then.

## 7. Steps

1. Approval of this page; the decisions of section 6 recorded here.
2. `canCompile()` and the `outside-fragment` diagnostic; `compile()` to
   `glsl` calls it first. Acceptance: the corpus audit shows the same 3,605
   compiled records (minus the `Transpose` record if decision 1 is "out")
   and no new decline inside the fragment; Tycho adds a `canCompile()` call
   before each GLSL compile in `scripts/audit-ce-codegen.mts` and records a
   disagreement between the predicate and the compile as a record field;
   Tycho's GPU test lane (`tests/` under `src/plot/webgl`) and a browser pass
   of the showcase GPU entries run too, because the audit does not exercise
   the render-time input types, and exercises the `storage` option in three
   showcase records only.
3. Removal of the shader statement machinery (section 5), one module per
   change, each checked by the corpus audit and the GLSL test lane.
4. The model document: "Target boundaries" gains the fragment, and the shader
   statement sections ("Statement order on the shader targets", "`Break` and
   `Continue` on the shader targets") are removed.
5. Tycho: `compileDeferredGlsl()` and `composeLiveProgram()` call the
   predicate at resolve time; the sidebar badge shows the diagnostic of a
   row with no compiled band (`stampCompileBand()` in `src/plot/resolve-fn.ts`);
   its row is in `~/dev/tycho/docs/COMPUTE_ENGINE.md`. Consulted with session
   tycho-9d on 2026-11-08; no objection to the fragment.
