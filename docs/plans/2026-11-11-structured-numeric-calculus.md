# Structured route: integrals, derivatives and limits

**Status: design, not approved.** It extends the structured route of the
JavaScript target (`numeric-kernel`) toward the retirement of the existing
emitter ([plan](2026-11-09-js-compiler-status-and-plan.md)). Measured on the
main tree at `4c0828dff198102e1f8c737c346c63ce3959f325`; the probes and the
Jest setup file are scratch files, not in the repository.

The contract does not change: the value equals the interpreter's within the
caveats, and the doubles equal those of the existing compiler with `cse:
false, constantFold: false`; anything else declines. For a numeric routine:
the same runtime routine with the same arguments, called with a function
that gives the same doubles at every abscissa, hence the same number of
times in the same order.

## 1. The existing forms and the witnesses

**Heads.** `Integrate` (`compileIntegrate()`, `javascript-target.ts`),
`Limit` (its handler there), `D`, `Derivative`, `ND` (`compileDerivative()`,
`library/calculus.ts`) and `Apply(Derivative(f, n), x)` (the `Apply`
handler). `NIntegrate` and `NLimit` have no JavaScript lowering (declined
with `constantFold: false`; a constant `NIntegrate` is folded otherwise). No
head lowers to a root finder or an ODE step. The runtime routines that take
a function (`javascript-runtime.ts`): `_SYS.integrate`, `_SYS.integrateMC`,
`_SYS.limit`, `_SYS.nd`.

**`Integrate`**, in this order:

1. A closed form, `BaseCompiler.closedFormIntegral(args, target)`
   (`compile-integrals.ts`): a symbolic evaluation under a step budget, a
   step pool shared by the compilation, a 30 s guard and a record of earlier
   timeouts; not gated by `constantFold`. `∫₀ᵃ e^{-t²} dt` is
   `(0.5 * _SYS.erf(_.a) * Math.sqrt(Math.PI))`. A closed form that does not
   compile falls through to quadrature. An indefinite integral with no
   closed form declines.
2. Quadrature. The integrand is a body in the limit variables
   (`integrandLambda()`), each a real scalar (`withRealLoopIndices()`).
   Limits nest, the first outermost; a bound of limit d reads variables
   0..d−1. The starting panel count, `initialPanelsForDimensions(levels +
   depth of nested Integrate nodes)`, is measured at the outermost node,
   inherited by inner ones, and passed when it differs from the default:

   ```
   _SYS.integrate((t) => (Math.sin(_.k * _SYS.pow3(t))), 0, 1)
   _SYS.integrate((x) => (_SYS.integrate((y) => (Math.sin(x * _SYS.pow3(y))), 0, x, 4)), 0, 1, 4)
   ```

   The count comes from the tree before inner closed forms: `∫₀¹∫₀¹ sin(uv)`
   is `_SYS.integrate((u) => ((1 / u + -Math.cos(u) / u)), 0, 1, 4)`. A
   helper body measures its own tree (`const _fn_q = (y) => _SYS.integrate(…, 0, y);`).
3. A log-space alternative for a pure integrand that overflows against
   itself, nothing in it mapped by the host (`logSpaceProduct()`), built once
   per call of the innermost integral:
   `((_tv1) => _SYS.integrate((t) => (_SYS.finiteOr(Math.pow(t, 100) * Math.exp(-t), _tv1, t)), 0, Infinity))((t) => (Math.exp(-t + 100 * Math.log(Math.abs(t))) * …))`.
4. `quadrature: 'monte-carlo'`: `_SYS.integrateMC(f, a, b)`.
5. Only with `cse` on, invariants are computed on the first call
   (`firstCallBoundLambda()`). In the `complex` mode:
   `_SYS.cplx(_SYS.integrate((t) => (_SYS.cplx(_SYS.csin(_SYS.cpow(…)))), 0, 1))`.

The integrand is a closure over the inputs and enclosing values; a draw or a
host call in it runs at each sample
(`(t) => (Math.sin(_SYS.pow3(t)) + _SYS.drawNextRandomNumber())`, `(t) => (h(t))`).

**The routine** (`SYS_HELPERS.integrate`) projects samples to reals
(`realFn()`), handles reversed and infinite bounds, oscillatory tails and
divergence, gives `NaN` for no value, and throws only a deadline timeout
(`adaptiveQuadrature()`). Its state: the count of active integrals and the
nested evaluation budget (`NESTED_QUADRATURE_BUDGET`). An outermost integral
that does not converge samples 10⁷ points from the live entropy source
(`makeSysHelpers()`), also in a `WithRandomSeed` frame by ruling
(`docs/RANDOMNESS-MODEL.md`); `integrateMC` always does; `isShippableCode()`
(`kernel-pool.ts`) refuses both.

**Derivatives.** `compileDerivative()` evaluates the node in an isolation
scope, declines an impure one, and compiles the closed form after
`rewriteAngularUnit()`; with none, or one that does not compile, it writes
the stencil `_SYS.nd` (`centeredDiffHigherOrder()`, the interpreter's) for
`D` of one symbol, `Derivative(f, n)` and `ND(f, x)`:

```
D(sin x³, x)          3 * Math.cos(_SYS.pow3(_.x)) * (_.x * _.x)
Derivative(f, 2)(x)   (((x) => -9 * Math.sin(_SYS.pow3(x)) * _SYS.pow4(x) + 6 * x * Math.cos(_SYS.pow3(x)) + 2))(_.x)
ND(t ↦ sin t³, x)     _SYS.nd(((t) => Math.sin(_SYS.pow3(t))), 1, 'scalar')(_.x)
```

`Apply(Derivative(f, n), x)` first tries Taylor jets (`jetDerivativeTarget()`:
a pure univariate literal, `strict`, a body over 10 nodes for order ≥ 2 or 40
for order 1), then `derivativeClosedForm()`. `D(h(x), x)` of a host function
and an impure body decline. `_SYS.nd` has no state and does not throw.

**`Limit`.** With `constantFold: false`, no symbolic attempt
(`symbolicLimitAttemptAllowed()`): `_SYS.limit(((t) => Math.sin(_.k * t) / t), _.a)`,
the direction as a third operand. By default a constant limit is folded
(`(1)`). `_SYS.limit` has no state; it throws only a deadline timeout.

**Witnesses.** A Jest setup file wrapped `compile()` (`jest.mock`): each
JavaScript compilation of the existing compiler with one of these heads was
compiled again with the profile, and the decline logged with options, types
and existing code. The 146 test files that name `compile` and such a head,
two runs of 73 (`-w 4`, all passed): 431 compilations, **255 distinct
declined programs** (239 `public`, 16 implicit; 252 `strict`, 3 `complex`).

| Head | Existing form | Count |
| --- | --- | --- |
| `Integrate` | closed / `integrate` / with `finiteOr` / `integrateMC` | 62 / 55 / 31 / 4 |
| `Derivative` applied | closed (8 by jets, 13 of several variables) / `nd` | 44 / 1 |
| `D` | closed / `nd` | 23 / 5 |
| `ND` | `nd` / a number | 8 / 3 |
| `Limit` | `limit` / a number (default options) | 8 / 8 |
| `NIntegrate` | a number (default options) | 3 |

Integrate nodes: 145 of one limit, 7 of two, 13 with an integral inside.
Bounds of 172 clauses: two numbers 91, a number and a name 34, a name and
`±∞` 20, a number and `±∞` 14, two names 9, other 4. Integrands: arithmetic,
`Sin`, `Sqrt`, `Gamma` (20), `Abs`, `Ln`, `Which`, helpers; none draws.

**What would compile next.** In the 196 programs that could be rebuilt in a
new engine, each calculus node was replaced by a proxy (its closed form when
the existing code has one; else the integrand with each variable a new
`real` input, plus the bounds; `Limit(f, a)`, `ND(f, a)` as `Apply(f, a)`).
The profile admits 156; 19 proxies fail on the existing compiler too
(rebuild artifacts). Next refusals: a point-valued `ND`/`Derivative` (8), a
multi-index `Derivative` (4), `EvaluateAt` (3), `Cos(6πt)` (2), `LambertW`,
`ErfInv`, a `list<number>` input, a list parameter (1 each). 59 read a user
function or an object option (28: `Derivative` of a user function, closed).

The shadow measure of the full suite at this commit: 228 "unsupported head
Integrate", 45 `Apply` of `Derivative`, 42 `D`; in the engine's integrands 20
"unsupported helper body Integrate" and 22 "unsupported head Integrate".

## 2. The representation

**One kind, `routine`** (choice 1), as `collection` serves list functions:
a numeric routine named by `fn`, applied to a body region with one bound
parameter.

| `fn` | Operands | Attributes | Result |
| --- | --- | --- | --- |
| `integrate` | lower, upper | `initialPanels?`; `alternative?` region | real |
| `integrate-sampled` | lower, upper | | real |
| `limit` | point, direction? | | real |
| `derivative` | point | `order` (integer ≥ 1) | real |

Semantics, target-neutral: the result approximates the integral of the body
over the interval (reversed negates, infinite bounds allowed), its limit or
its `order`-th derivative at the point; `NaN` when the routine finds no
value. The body runs zero or more times, each with the parameter bound to an
abscissa the routine chooses. With `alternative`, a sample whose value is
`NaN` or infinite takes the alternative's value when that is finite, or when
the first is `NaN` and it is not.

**Facts** come from the policy, as `RepresentationPolicy.aborts` does, joined
with those of the regions. JavaScript: `integrate` and `integrate-sampled`
are `effectful` and touch `entropy` (the live source of the sampling
fallback; `seeded` does not discharge it, as ruled for compiled integrals)
and `quadrature` (the nesting count and budget) (choice 2); `limit` and
`derivative` are `pure`. All but `derivative` abort with `error` (a deadline
timeout). None aborts with `no-value`: no value is the value `NaN`.

**The verifier checks** the name in `policy.routines`; real operands (an
integer fits); the body and `alternative`: one parameter `real` in the number
representation, open, yielding one real; `initialPanels` only on
`integrate`, `order` only on `derivative`; a `real` result; effect, states
and abort kinds not fewer than the policy's for the name joined with the
regions'; no `exit` leaving the regions (as for `seeded`).

**The JavaScript policy** names `_SYS.integrate`, `_SYS.integrateMC`,
`_SYS.limit`, `_SYS.nd`; a GLSL policy has none, so the verifier refuses the
operation there.

**Objectives.** (1) Helper names, panel default and facts are in the
policy. (2) The variable is a region parameter, as a `build` index. (3) The
states are on the operation and in each region's summary.

## 3. The body

The emitter writes the body as a function passed to the routine, the first
closure of the route with a parameter (`seeded` writes `() => { …; return v; }`):

```
const r = _SYS.integrate((t) => { …; return v; }, lo, hi[, panels]);
const alt = (t) => { …; return w; };   const r = _SYS.integrate((t) => _SYS.finiteOr(v, alt, t), lo, hi);
const d = _SYS.nd((t) => { …; return v; }, n, 'scalar')(x);
```

Operands run before the closure (bounds, then samples), as in the existing
code. Nested limits are nested operations: inner bounds are operations of
the outer body. `initialPanels` follows the existing rule: set on the
outermost `Integrate` of a body (root, helper, local function) from the tree
before inner closed forms, and on each level and inner node of that tree;
`alternative` on the innermost level only.

- **Reads**: the parameter and enclosing values (inputs, captures, locals);
  nothing writes them during the call, so they are constants for it.
- **No hoisting** (choice 6): the body is lowered in the scope of its
  variable, as a loop body ([shared subexpressions](2026-11-11-structured-shared-subexpressions.md)),
  so no body node finds an enclosing value and every operation runs at each
  sample, as with `cse: false`. A `routine` is never shared by the memo
  (not pure or can abort): each occurrence is a call, as in the existing code.
- **In place**: `inPlaceUpdates()` treats the body as a loop body.
- **Effects in the body** decline: a draw (the interpreter samples other
  points), an abort (a budgeted `Loop`: a throw where the interpreter has a
  value), host calls until slice 5 (then equal count and order on both).

## 4. Purity and execution

`analyzeExecution()` needs no new rule: `integrate` blocks independent calls
("can sample the live entropy source"; "reads the nested evaluation budget")
and worker portability, as `isShippableCode()` does, and a loop that
integrates is no parallel candidate. `limit` and `derivative` of pure bodies
stay pure and portable. No iteration budget: the routines' own limits are
the same on both compilers.

## 5. Symbolic steps

The route makes each replacement where and in the order the existing
compiler does, with the same function and the same `CompileTarget` (from
`prepareCompilation()`):

- **`Integrate`**: `closedFormIntegral(args, target)` at each occurrence,
  the outer node before its body (choice 3), so the step pool is spent in
  the existing order. A closed form is lowered on the route; if the route
  cannot lower it, the program declines (choice 4). The pool is reset by
  `resetSharedCompilationBudgets()` in `compiler-core.ts` at depth 0; I
  found no call of it or of `BaseCompiler.compile` in
  `javascript-fragment-target.ts` or `javascript-structured-lower.ts`, so the
  route's entry must reset it.
- **`D`, `ND`, `Derivative`**: `derivativeClosedForm()` (the steps of
  `compileDerivative()`; slice 1 makes both call one function). `Apply` of a
  closed literal lowers as `Apply` of a literal (collections, slice 3). A
  claim of `jetDerivativeTarget()` declines (choice 9). With no closed form,
  the `derivative` routine by the rule of `compileNumericDerivativeFallback()`.
- **`Limit`**: no symbolic attempt (choice 10).

Only the 30 s guard of `closedFormIntegral()` is not deterministic: an
attempt cut on one compilation only gives a closed form on one side and a
quadrature on the other. The timeout record makes the later compilation skip
the search, so the shadow measure and the switch see one form.

## 6. What stays declined

| Form | Reason |
| --- | --- |
| `NIntegrate`, `NLimit` | no lowering in the existing compiler |
| an integrand that draws or has a budgeted loop | section 3; no witness |
| the `complex` mode (3) | the body is on the complex lane; slice 5 if measured |
| a jet derivative (8); a multi-index one with no closed form | jets are a lowering of their own; no routine of several variables |
| a point-valued `ND` or `Derivative` (8) | a vector stencil, list results of a function |
| an indefinite integral with no closed form | no value |
| a closed form the route cannot lower | the existing compiler may lower it |

## 7. Slices

Each: route tests, core suite, type check, the shadow measure on the files
of section 1, the full suite with the switch off and on, the random tester,
a Claude and a Codex review. Tests compare with the existing compiler
(`Object.is`), the interpreter (caveats) and the count of integrand
evaluations (a spy on `adaptiveQuadrature` as in `compile-integrate.test.ts`;
from slice 5 a counting `functions` entry). `js-profile-fuzz.ts` gains
`Integrate` of a `genReal()` body in `t` (bounds from `genBound()`, inputs,
`±∞`, reversed), dependent and nested limits, `D`, `Derivative(f, n)` of a
helper, `ND` and `Limit` of a literal, with few closed-form candidates (each
costs a symbolic search). Estimates: shadow messages, scaled by the sample.

1. **Closed forms, no new operation**: `D`, `ND`, `Derivative`, `Integrate`
   replaced by closed forms; no closed form still declines. About 90
   Integrate and 60 derivative messages (sample: 56 + 20 of 196, and most of
   the 28 user-function `Derivative`s).
2. **`routine` with `integrate`**: kind, verifier, policy, emitter, in-place
   rule, section 4; several limits, nesting, panels, helper bodies. About 70,
   and most of the engine's 42 (sample: 34).
3. **Log-space `alternative` and `integrate-sampled`**: about 50 (sample: 26
   and 4).
4. **`derivative` and `limit`**: about 25 (sample: 15 and 4).
5. **Host calls in the body, the `complex` mode**: if the measure shows them.

## 8. Open choices

Recommended first; the alternative after the semicolon.

1. One kind `routine`; a kind per routine (more reader cases, no better check).
2. `integrate` `effectful`; `pure` with a caveat (the memo could share it).
3. Closed forms per occurrence; per node object (a dry pool spent otherwise).
4. An unlowerable closed form declines; quadrature where the existing would.
5. Log-space as a second region; a function value (the route has none).
6. No hoisting in the body; hoist pure invariants (step 8).
7. Decline draws in the body; admit them, drawn per sample.
8. Host calls in the body in slice 5; never.
9. Decline jets; a jet lowering on the route.
10. No symbolic `Limit`; the default fold (the open folding decision).

## 9. Result of slice 1

Implemented on `114403d0b44156730f1f943b12362d0c74f90fc8` (first written on
`d89290f1b`). No new operation of the representation: the admission
replaces each calculus node by an expression, and the annotation and the
lowering read that expression in the place of the node.

**Where.** `closedFormReplacement()` (`javascript-fragment-target.ts`) is
called by the checker of the root expression and by the checker of a
function body (`admitFunctionBody()`, so the body of a root `Function`, of
a helper and of a local function), at the node, before its operands. The
replacement is kept in `StructuredRegistry.closedForms`; the rule of
`Integrate`, `D`, `ND`, `Derivative` and `Apply` types it in the place of the
node (`closedFormRule()`, the GLSL fragment's `walkDerivative()` does the
same), and `Lowering.lower()` lowers it (`StructuredPreparation.closedForms`).
The parent sees the node itself, with its type `number`, as the parent
handler of the existing compiler does: a substitution in the tree changed
the code (`x · ∫₀¹ t² dt` is `_.x * (0.3333333333333333)` on the existing
compiler, `_.x / 3` for the substituted `x · 1/3`).

**What is admitted** (strict mode): `Integrate` with a closed form of
`closedFormIntegral()` (constant, input and expression bounds, integrands
that read inputs, a constant with a value or a user function, nested
integrals, an integral in a `Sum`, an `If`, a list, a helper body, an
indefinite integral); `D` of one or several variables, `ND` at a number,
with the closed form of `derivativeClosedForm()`; `Apply(Derivative(f,
n…), x…)` of a library function, a user function or a literal, as `Apply`
of the literal of `derivativeClosedForm('Derivative', …)` (lowered inline,
the same operations as the existing call of the literal). The tests
(`compile-javascript-structured-calculus.test.ts`) compare the doubles
with the existing compiler at three points per program, the interpreter
(`evaluate().N()`), the text of two programs modulo parentheses, and a
degree angular unit.

**What stays declined, and why**: no closed form (quadrature, the stencil:
slices 2 and 4); an integrand that is not pure (the existing compiler
evaluates it at compile time with its draw); a derivative that is a
function; a jet derivative (choice 9); a variable that can hold a list (the
existing check of `compileExprCustomHandler()`, applied in the same way); a
variable of `D` that holds a value (the existing compiler with
`constantFold: false` reads it as an input: `3 * (_.x * _.x)` for `D(x³,
x)` with `x := 4`, where the interpreter gives 48); a complex number in
the node or in its closed form (the existing compiler can read the node on
the complex lane around a real closed form: `(∫ᵢ⁰ t dt)²` gives `{re: NaN,
im: NaN}` there, the interpreter 0.25; found by the random tester); a
closed form `0` as an operand (the existing compiler writes the term `(0)`,
which a complex sum keeps, and the route drops a literal `0`: `-0` against
`0`; found by the random tester); the `complex` mode;
`Limit`, `NIntegrate`. The `bigint` mode: the lane analysis declines a
calculus node on both compilers.

The closed form of `D` or `ND` as an operand was declined at first: the
existing compiler wrote it without parentheses, a wrong value
(`1 / D(x³ + x, x)` was `1 / 3 * (_.x * _.x) + 1`). The fix of that
defect (CE-1216, `compileDerivative()` writes the closed form in
parentheses, as `compileIntegrate()` does) removed the refusal: the tests
compare the quotient, the negation, the product, the difference and the
power of `D(x³ + x, x)` with both compilers and the interpreter. The
review of the slice added: the dependencies are the names whose stored
definitions the closed form can hold (a value, a user function, at any
depth), not every name of the node; a local function whose body holds an
integral captures no variable of the integral (the capture walk and the
name walks of the lowering read the replacement); a name that the node
binds is not read for a complex type (`∫ₐᵇ |s| ds`, the derivative of
`r(t) := |t|`, whose engine types are not real, are admitted with the
doubles of the existing compiler); `First([])` declines (the existing
emitter reads `undefined`, the route read `NaN`).

**Where the implementation differs from the note.**

- Closed forms are found once per node object (choice 3 recommended once
  per occurrence). The admission visits a node once; per occurrence only
  changes how much of the shared step pool is spent. In its place, a
  program whose searches spend more than 10,000 steps declines
  (`CLOSED_FORM_SEARCH_STEPS`): the existing compiler searches again at
  each occurrence and at each term of an unrolled `Sum`, and the pool of
  600,000 steps then holds 30 such repetitions. A search of an elementary
  integral spends 1 to 50 steps (measured on ten integrands).
- `compileDerivative()` was not changed to call `derivativeClosedForm()`:
  it is outside the files of the slice. The two differ only in the scope of
  the angular-unit rewrite of the result; the tests in degrees give the
  same doubles.
- The names of the node and of the user functions that it calls are added
  to `symbolDeps`; the existing compiler adds none (CE-1218).

**The two points the note could not determine.**

1. The pool: the structured route does not reach `compileCseRoot()` (the
   body emitter replaces it), so nothing reset the pool. `prepareFragment()`
   now calls `BaseCompiler.resetSharedCompilationBudgets()` at depth 0,
   after the preparation and before the admission, as
   `resetOutermostCompilation()` does on the existing route. Tested: with
   the pool drained before the call, the profile still finds the closed
   form; with the per-attempt budget shortened to 5 steps
   (`setAntiderivativeAttemptBudgetForTesting()`), `∫₀ᵃ t eᵗ cos t dt` (9
   steps) gets quadrature on the existing compiler and declines on the
   profile, and with the full budget both write the closed form with the
   same doubles. `canCompile()` runs a whole compilation, so it runs the
   search; one compilation runs it once per node. The memos of the
   compilation (`resetCompilationMemos()`, among them
   `_angularDefinitionMemo`, which the search reads keyed by a name, and
   `_variantResultTypeMemo`) are emptied at the same place and again when
   the compilation ends, also after a decline, as the existing compiler does
   at depth 0; a compilation of the route inside another compilation of
   either route empties none (`withStructuredCompilation()`). Without that,
   `∫₀ˣ k dt` in degrees with `k := 3` left the answer "`k` has no angular
   definition" for a later engine with `k := Sin(30)`, whose closed form
   then read `sin 30` in radians (-1.976 at x = 2, for 1).
2. The wall-clock guard of 30 s: nothing done; a known-limitations line in
   `docs/COMPILATION-MODEL.md` (and one for the pool repetition).

**Measures** (on `114403d0b`, the 118 test files that name `compile` and a
calculus head, `-w 4`):

- Witness replay (a Jest setup that compiles each JavaScript compilation
  with a calculus head again with the profile, and compares the values of
  the admitted ones with the existing compiler at four points): of 219
  distinct programs, 1 admitted before, 85 after; 0 value differences for
  inputs of their declared types (one program, `D(g², g)` with `g:
  list<real>`, differs for a number passed to the list input, outside its
  type). The 134 that stay declined: no closed form of an integral 70, `Limit`
  15, no closed form of a derivative 12, jets 8, more than 10,000 search
  steps 5, a complex `Apply` 4, `NIntegrate` 3, `EvaluateAt` 3, other
  forms 14.
- Shadow measure: the profile admits 6,044 of 7,381 compilations (5,901
  before); public compilations 893 of 2,105 (756 before), engine
  integrands 468 of 543 (462). Two tests fail with the measure on, both
  because the measure compiles twice: the one that asserts the default
  route never calls the profile, and `compile-integrate-timeout-record`,
  which counts one search per compilation.
- Consumers with the switch: 1,897 tests pass with and without it, before
  and after; the engine's compilations admitted: 5,327 of 5,432 before and
  after (the consumers compile integrands, not `Integrate` nodes).
- The random tester gains `--calculus` (`genCalculus()`: `Integrate` of an
  elementary integrand with literal or leaf bounds, `D` of an elementary
  function of a name, `Apply` of the derivative of a literal; without the
  option the programs of a seed are those of before). Seeds 161 and 162,
  10,000 programs each, with and without the option: no profile failure, no
  difference of value or shape from the existing compiler in the calculus
  runs; the run of seed 162 without the option shows one difference,
  `First([])` (`NaN` against `undefined`), which `114403d0b` has already.
  The first run of seed 161 with the option found the two refusals of the
  complex number and of the closed form `0` above; the witness replay and
  the shadow measure ran before these two refusals were added, which only
  decline more.
