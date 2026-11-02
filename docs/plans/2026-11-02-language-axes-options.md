# The undecided axes: options for the user

**Status:** options, 2026-11-02, for the decisions of step 2 of
`docs/plans/2026-11-02-compiler-contraction-plan.md`. One page per axis.
Each page states what the language does today, what Tycho uses (the census,
`docs/plans/2026-11-01-language-axes-survey/census.md`: counts are real
documents / Desmos states), the options with the recommended one first, one
example per option, the code each option removes, and what happens if
nothing is decided. The decision table is §8.

The interpreter stays the full language where a page says so: the
narrowing of a page may apply to compiled code only (a decline), to the
language itself (a static error or a changed value), or to both. Each option
says which.

## 1. `Missing`

**Today.** `Missing` is a symbol of type `missing`, the position-preserving
absent datum: the answer of a selection with no match, of an accessor out of
range in a non-numeric domain, and of an input the host leaves out. In a
numeric domain absence is `NaN`. `Undefined` is a second absent spelling.
`Missing` has Kleene three-valued comparison semantics in the interpreter
(`Missing > 0` is `Missing`), arithmetic absorbs it into `NaN`, and the
readers are `IsMissing`, `Coalesce` and `AssertPresent`. A host or a program
can declare `missing` in a type (`real | missing`, `list<expression |
missing>`), so an absent value can be an input and flow through every
operator. Compiled code, since 2026-11-01 option (a), gives an unspecified
value for any operator other than a discharge or an accessor over an absent
operand.

**Tycho.** `Missing`, `Undefined`, `IsMissing`, `Coalesce`, `AssertPresent`:
0 / 0. A symbol whose type contains `missing`: 2 / 6 (all inferred from a
nested selection). The producers Tycho meets are the selection with no
match (46 states with a list operand) and the out-of-range accessor.

**Option A, recommended: a result only, never a declared type.** `missing`
cannot be written in a declared type of an input, a parameter, a local or an
element; a declaration that names it is a static error. `Missing` is
produced only by a selection with no match, an accessor out of range and an
input left out, and its position-preserving value follows the domain: `NaN`
for a number, a point with `NaN` coordinates for a point (the rule of
survey §6.3 item 3, extended from selection cells to accessors), `Missing`
for anything else. The readers stay (`IsMissing`, `Coalesce`, a branch). Any
other operator over `Missing` gives `Missing` in the interpreter, and a
comparison gives `False` (page 3); compiled code keeps option (a). `Undefined`
is removed as a spelling; `Missing` is the one symbol.

| Input                                                  | Today                                | Option A                                   |
| ------------------------------------------------------ | ------------------------------------ | ------------------------------------------ |
| `w: real \| missing`, `If(IsMissing(w > 0), 1, 0)`     | declaration accepted; `1` when absent | the declaration is a static error         |
| `At([(1,2), (3,4)], 5)`                                | `Missing`                            | `(NaN, NaN)`                               |
| `At(["a", "b"], 5)`                                    | `Missing`                            | `Missing`, unchanged                       |
| `Coalesce(At(xs, 99), 0)` with `xs: list<real>`        | `0`                                  | `0`, unchanged                             |
| `Missing + 2` in the interpreter                       | `NaN`                                | `Missing`                                  |

Removes: the absence axis of a type and `absenceAxisForType`, the
`| missing` admission at inputs and parameters, the Kleene comparison code
(page 3), `Undefined`, and in the compiler the absence levels of broadcasts
and point arithmetic, the absent-input reads and the written-absence code of
the GPU and Python targets (`compile-absence.ts` 1,823 code lines, most of
it; `absent-tuple-read.ts`). The interpreter loses the ability to carry a
declared absent input through arithmetic.

**Option B: no `Missing` at all.** Every absent position is a domain value:
`NaN`, a `NaN` point, and for a string, a list or any other value an error
expression. `IsMissing` and `Coalesce` read `NaN` only. Removes everything in
A plus the `missing` type itself and the non-numeric absence paths. Costs: an
out-of-range access into a list of strings or lists is an error, not a
value, so a program that probes with `At` and `Coalesce` on such a list no
longer works; a selection over a list of strings with no match is an error.

**Option C: keep today's model.** Nothing removed on this axis.

**No decision:** C.

## 2. The error model

**Today.** Four channels and two markers: an `Error` expression (a violated
contract, static, invalidates the tree above it), `NaN` (the numeric
no-value, IEEE), `Indeterminate` (the exact route's `NaN` for `0/0`, `∞−∞`,
`0^0`, `Mod(x, 0)`, a one-datum variance, with `isIndeterminate` and exact
propagation: `Mean([1, Indeterminate])` stays exact), `Missing` (page 1),
`Nothing` (an erasure marker with its own boundary policy: spliced out of
arguments and constructed collections, retained in raw views, bypassed by
`Map`, dropped by `Filter`, skipped by sums, means and the statistics), and
an inert unevaluated form. `docs/ERROR-MODEL.md` is 2,943 lines, of which
the `Nothing` boundary policy and the `Indeterminate` producers are the
largest parts still marked proposed or agreed-direction.

**Tycho.** `Nothing`, `Indeterminate`: 0 / 0. A node typed `nothing` that is
not a block statement: 0 / 4. `NaN` written: 39 / 4.

**Option A, recommended: one static error, one dynamic non-value per
domain, `Nothing` only as the value of an empty block.** `Indeterminate` is
removed: the exact route answers `NaN` for a form with no value, as `.N()`
and every compiled target already do; exact propagation of the marker
(`Mean([1, Indeterminate])`) is lost, and `Max(1, 0/0)` is `NaN`. `Nothing`
remains the value of an empty block or a statement with no value, and
nothing else: it is never a collection element, a callback result or a
coordinate, so the boundary policy (views, `Map` bypass, `Filter` drop, the
aggregates' skip, the covariance row skip) is removed, and a callback that
returns `Nothing` is a static error. `Error` and `NaN` stay as they are.

| Input                              | Today                               | Option A                |
| ---------------------------------- | ----------------------------------- | ----------------------- |
| `0/0` on the exact route           | `Indeterminate`                     | `NaN`                   |
| `Mean([1, Indeterminate])`         | `Indeterminate`, exact              | `NaN`                   |
| `Map(x ↦ (x > 1 ? x : Nothing), [1, 2])` | `[2]` after construction       | static error            |
| `Sum(view exposing [1, Nothing])`  | `1`                                 | static error at the callback |

Removes: the `Indeterminate` producers and `isIndeterminate`; the `Nothing`
omission checks in `Map`, `Filter`, the statistics and the raw views; in the
compiler the refusals "when source element types admit omission" and the
omission tests of callback results. Mostly an interpreter and documentation
removal; the compiler gain is the omission checks only.

**Option B: keep `Indeterminate`, narrow `Nothing` as in A.** Keeps the
exact-route distinction for a consumer that needs it (none known).

**Option C: keep today's model.**

**No decision:** C.

## 3. Comparisons

**Today.** A comparison with a `NaN` or `Indeterminate` operand is `False`,
in a branch too (decision of 2026-10-20, Tycho rows 411 and 413). A
comparison with a `Missing` operand is `Missing` (Kleene), and a connective
over it is three-valued. A value with no order (2026-10-21 extension) decides
`False`. Compiled code under option (a) gives an unspecified value for a
comparison over an absent operand. A chain `a < b < c` is a conjunction.

**Tycho.** A comparison with a `missing` operand: 1 / 5 (nested
selections). A comparison with a list operand: 14 / 61 (element-wise, kept
by survey §6.3).

**Option A, recommended: two-valued everywhere.** A comparison is `True` or
`False`; any undecided operand (`NaN`, `Missing`, a pole, a value with no
order) gives `False`, in the interpreter and in every compiled target. A
connective over booleans is two-valued. `Not(x < 1)` with `x` absent is
`True`, as IEEE and Desmos give. The element-wise form is a list of
booleans.

| Input                          | Today                | Option A |
| ------------------------------ | -------------------- | -------- |
| `Missing > 0`                  | `Missing`            | `False`  |
| `Not(Missing > 0)`             | `Missing`            | `True`   |
| `Or(Missing > 0, True)`        | `True`               | `True`   |
| `NaN > 0`, `0/0 = 0`           | `False`              | `False`  |

Removes: the Kleene leaves and the decidability analysis
(`kleeneValueLeaf`, `kleeneRelationLeaf`, `mayBeUndecided`,
`conditionDecidability`, `compileExactCondition` and their callers in
`compile-absence.ts`), the interval `missing` flag, the three-valued
connectives in the interpreter's logic library.

**Option B: two-valued in compiled code, Kleene in the interpreter.** This
is today's state under option (a); it removes the compiler code of A but
keeps the interpreter's three-valued logic and the documented difference.

**No decision:** B.

## 4. Block locals, loops and effects

**Today.** The interpreter is the Epsil language: `Declare`, `Assign` and
reassignment anywhere, assignment inside a branch, a read of a local that
has no value yet, `Loop` and `While` whose last value is used, a `Block`
whose value is its last statement, caller-supplied code in `vars`
(`{W: 'nextValue()'}`) treated as an effect that runs once in order. The
compiler follows all of it where it can: a definite-assignment analysis on
every target (rebuilt three times), the effects contract, the loop-value
lowering, and declines for the rest.

**Tycho.** `Block`: 96 / 63; `Declare` and `Assign`: 44 / 12, all in
straight-line order; assignment in a branch, read before assignment, any
loop, a loop whose value is used, code in `vars`: 0 / 0.

**This page narrows compiled code only.** The interpreter keeps Epsil as it
is: loops, reassignment and effects are the language. The question is which
programs compile.

**Option A, recommended: compiled code accepts straight-line locals.** A
block compiles when every local is declared with its value, or assigned
exactly once, at the block's own level, before any read, and never inside a
branch or a loop body; `Sum`, `Product`, `Map` and `Fold` bodies compile
when they are pure; a `Loop` or `While` compiles only as a statement whose
value is not used; a `vars` entry is a value read once at entry, never code
with an effect; a function reassigned in a block declines. Everything else
declines.

| Input                                                       | Today               | Option A |
| ----------------------------------------------------------- | ------------------- | -------- |
| `Block(Declare(a, 1), Assign(b, a + 1), b)`                 | compiles            | compiles |
| `Block(Declare(a), If(c, Assign(a, 1)), a)`                 | run-time check      | declines |
| `Sum(Block(Assign(j, j + 1), j), Limits(j, 1, n))`          | declines            | declines |
| `vars: {W: 'nextValue()'}` read twice in the body            | the effect runs once | declines |

Removes: the definite-assignment analysis and the read-before-assignment
check (`compile-locals.ts` 1,238, most of it), the effects contract and
`reachesCallerCode` (about 600 lines), the loop-value lowering of
`compile-loops.ts`, the Python `_ce_unset` machinery.

**Option B: keep today's analysis.** Nothing removed; the three rebuilds
stay.

**No decision:** B.

## 5. Function values

**Today.** The interpreter has first-class functions: lambdas, closures,
currying, partial application, parameter defaults (R6, 2026-11-01), function
values in variables and as results. The compiler follows: callbacks in
`Map`, `Filter`, `Sort`, `Iterate`, `Pipe`; currying in one step with literal
arguments; partial application where it equals the interpreter; defaults
filled with the target's `Coalesce` test at entry, in a static map and per
broadcast cell (+925 −355 lines, four review rounds); function-typed
variables with a value reference.

**Tycho.** `Map`/`Filter` callbacks: 15 / 19 (a literal lambda or a named
function); `Sort` with a callback, `Iterate`, `Pipe`, `Fold`: 0 / 0;
currying, partial application, defaults, a function returned: 0 / 0; a
function passed as an argument to a document function: 1 / 3.

**This page narrows compiled code only.** The interpreter keeps first-class
functions.

**Option A, recommended: compiled code calls what it can see.** A call
compiles when the callee is a defined function, a declared function with a
value, or a literal lambda at the call site; the callbacks of `Map`,
`Filter`, `Sort`, `Fold` and `Reduce` compile when they are such a callee. A
function value stored in a local or passed through a parameter, a curried
or partial application, a function returned from a function, and a
parameter with a default decline. A declared parameter type that is a
function type declines at the binding.

| Input                                                      | Today                      | Option A |
| ---------------------------------------------------------- | -------------------------- | -------- |
| `Map(x ↦ x^2, L)`                                          | compiles                   | compiles |
| `Map(f, L)` with `f` defined in the scope                  | compiles                   | compiles |
| `Apply(Apply(f, 1), u)`                                    | compiles for one step      | declines |
| `g = (k: real = 2) ↦ k + 1`, `g()`                         | compiles with the fill     | declines |
| `h = (f: function) ↦ f(1)`, `h(x ↦ x)`                     | compiles with a value ref  | declines |

Removes: `compile-callbacks.ts` 2,316 (most), the default fill of
`compile-user-functions.ts`, the currying and partial-application lowering
(`a13a1e08d`, `16b688765`), the function-value references of
`compile-user-calls.ts` and `compile-function-literals.ts`. The third-party
user of the bigint mode is not known to use any of these; confirm before
step 4.

**Option B: A, but keep parameter defaults.** Keeps the R6 fill (about 570
lines net) for Epsil programs that compile with defaults.

**Option C: keep today's support.**

**No decision:** C.

## 6. The complex lane

**Today.** A function's real-or-complex lane is inferred from the types of
its inputs and literals. A complex value that reaches a parameter compiled
as real is recorded per definition (`5e29489a6`, +3,132 lines) and the
compilation restarts in complex mode (`c4e0a3bdb`); a complex statistics
lane exists for the aggregates.

**Tycho.** A node typed `complex`: 88 / 87 documents; a document in complex
mode: 32 / 32; a complex argument to a document function: 4 / 10; a compile
result in `mode: complex` or `promoted`: 9 documents; `escalation`: 0.

**Option A, recommended: the lane is decided once from the declared
types.** The lane of a compiled function is `complex` when a declared input,
a declared parameter or a literal is complex, or when the host compiles in
complex mode; otherwise it is real. A complex value that reaches a real
input or parameter is a value outside its declared type, so its result is
unspecified (the host rule, R1 to R6). No recording, no restart. A document
in complex mode declares its inputs complex, or compiles in complex mode.

| Input                                                           | Today                        | Option A                                   |
| --------------------------------------------------------------- | ---------------------------- | ------------------------------------------ |
| `h = (p) ↦ p[1] + 1`, `P: list<tuple<complex, real>>`, `h(P[1])` | lane recorded, restart       | `p` is inferred from `P`: complex, compiles |
| `f = (x) ↦ x^2` compiled real, called with `2i` by the host      | restart in complex mode      | outside the type, unspecified              |
| `compile(e, {mode: 'complex'})`                                  | complex                      | complex, unchanged                         |

Removes: the lane recording per definition and the restart (`compile-complexness.ts`
635, `compile-lanes.ts` in part, the restart in the JavaScript and Python
targets). To confirm with Tycho: a document in complex mode compiles in
complex mode or declares its inputs complex, so that no value crosses a real
lane at run time.

**Option B: keep the restart.**

**No decision:** B.

## 7. Features kept or dropped by name

No census can decide these; the npm users are not measured.

| Feature                         | Compiler code lines                                   | Known use                                    | Recommendation                                                                 |
| ------------------------------- | ----------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| Bigint compile mode             | about 4,100 (`compile-bigint-*.ts`)                   | a third-party request                        | Keep                                                                           |
| WGSL target                     | `gpu-shader-target.ts` 1,813, `wgsl-field-function.ts` 978, WGSL branches of the GPU modules | Tycho: 0; no other known user | Drop unless a product plan names it for this quarter; GLSL stays             |
| Python target                   | `python-target.ts` 5,092                              | Tycho: 0; a documented public target         | Keep: one file, low coupling, plausible npm use; narrow it with the axes above |
| Numeric kernels on GPU (PolyLog, Zeta, LerchPhi) | part of `gpu-functions.ts` 3,091 and `gpu-complex-functions.ts` 586 | Tycho: not measured by operator on GPU | Keep; they are library functions, not language cases                  |
| Value kinds (Enclosure, residue) | about 1,100                                          | phase 1 of CE-507; later phases not scheduled | Drop if the later phases are not wanted this quarter; otherwise keep          |
| `broadcast()` API, kernel pool  | about 1,900                                           | Tycho, throughout                            | Keep (decided)                                                                 |

## 8. The decision table

| Page | Axis                | Options            | Recommended | Your decision |
| ---- | ------------------- | ------------------ | ----------- | ------------- |
| 1    | `Missing`           | A, B, C            | A           |               |
| 2    | Error model         | A, B, C            | A           |               |
| 3    | Comparisons         | A, B               | A           |               |
| 4    | Block locals        | A, B               | A           |               |
| 5    | Function values     | A, B, C            | A           |               |
| 6    | Complex lane        | A, B               | A           |               |
| 7    | WGSL target         | keep, drop         | drop        |               |
| 7    | Python target       | keep, drop         | keep        |               |
| 7    | Value kinds         | keep, drop         | drop        |               |

The decided options go into step 3 of the contraction plan (the language
release) and step 4 (the compiler contraction), and each becomes a page of
the model documents it changes.
