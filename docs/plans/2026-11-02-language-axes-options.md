# The undecided axes: options for the user

**Status:** decided, 2026-11-02: every row of the decision table in §8 is
filled in. Written as options, 2026-11-02, for the decisions of step 2 of
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
produced only by a selection with no match, an accessor out of range, and
the written symbol, and its position-preserving value follows the domain:
`NaN` for a number, a point with `NaN` coordinates for a point (the rule of
survey §6.3 item 3, extended from selection cells to accessors), `Missing`
for anything else. (An input the host leaves out is not a producer: under
the host rule of CE-712.3 its result is unspecified.) The readers stay
(`IsMissing`, `Coalesce`, a branch). Any other operator over `Missing` gives
`Missing` in the interpreter, and a comparison gives `False` (page 3);
compiled code keeps option (a). `Undefined` is removed as a spelling;
`Missing` is the one symbol.

*Typing.* `Missing` keeps the type `missing`, a marker type below `unknown`
and `any` and disjoint from `value` and `expression`, as `error` and
`nothing` are. It is handled in signatures as `error` is: the declared
result type describes the successful values and the marker is implicit
(the error model's rule of 2026-09-01: `| nan` or `| missing` is in a
result type only where the author declares a partiality or the operands
prove it). So `At` is `(indexed_collection<T>, integer+) -> T`, `First` and
`Last` are `(indexed_collection<T>) -> T`, `If(c, e)` with no else is
`(boolean, T) -> T`, and their run-time value out of range or with no match
(`NaN`, a `NaN` point, `Missing`) sits outside the declared type, as `NaN`
sits outside `real` today. `IsMissing` is `(any) -> boolean` and reads all
three; `Coalesce` is `(any, T) -> T`. A constructed value can hold the
marker, `Map(i ↦ At(names, i), [1, 99])` is `["a", Missing]`, and inference
gives it the type `list<string | missing>`, which can be inferred but not
declared, like a type with an `error` arm. The rule is about signatures and
declarations, not about the type of a value: a value that holds the marker
does not match the declared type (`matches` stays strict, as it is for an
`Error` value); a site that must accept "a value of the type, or an absent
value" makes a marker-tolerant check of its own (decided with the 3.1
implementer, 2026-11-02; the `ce.assign` of an evaluated `Missing` into a
declared non-numeric type is the likely site, settled when it arises). The
difference from `error` is propagation only: `Missing` is a value that
readers test and accessors preserve by position, and any other operator
absorbs it, where an `Error` invalidates the tree above it.

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
remains the value of an empty block or a statement with no value, and it
loses its erasure policy: it is kept as an element wherever it appears,
with no splice at construction, no `Map` bypass, no `Filter` drop, no
aggregate skip, no covariance row skip and no view policy, and no static
error either (no rule is less code than a rule). The TYPE `nothing` is
untouched: a `To` action keeps it, and a tuple of `To` or a piecewise with
`To` arms stays as it is (Tycho's 4 Desmos rows typed `nothing` are such
action rows, run by Tycho's interpreter path). The parser outputs that
produce `Nothing` today, decided with Tycho on 2026-11-02: an empty slot
`(3,,4)` is a parse error; a trailing comma in a piecewise `\{c: v,\}`
parses as `If(c, v)`, as with no default; a big operator with no index
keeps its internal form. `Error` and `NaN` stay as they are.

| Input                              | Today                               | Option A                |
| ---------------------------------- | ----------------------------------- | ----------------------- |
| `0/0` on the exact route           | `Indeterminate`                     | `NaN`                   |
| `Mean([1, Indeterminate])`         | `Indeterminate`, exact              | `NaN`                   |
| `Map(x ↦ (x > 1 ? x : Nothing), [1, 2])` | `[2]` after construction       | `[Nothing, 2]`          |
| `Sum(view exposing [1, Nothing])`  | `1`                                 | `incompatible-type` error at the `Sum` |

The last two rows were corrected by item 3.4.3 of
`docs/plans/2026-11-02-compiler-contraction-plan.md`: the text of option A
(no static error) governs, and an operator that meets `Nothing` gives its
ordinary error.

Removes: the `Indeterminate` producers and `isIndeterminate`; the `Nothing`
omission checks in `Map`, `Filter`, the statistics and the raw views; in the
compiler the refusals "when source element types admit omission" and the
omission tests of callback results. Mostly an interpreter and documentation
removal; the compiler gain is the omission checks only.

*`Indeterminate`, the user's view of 2026-11-02 ("Option A could work").*
It came from GitHub issue #355 (enumeratio, 2026-09-28): a host that
cross-checks against a Wolfram kernel wanted an exact indeterminate form to
differ from a float failure, at low priority; the reporter closed by saying
they map both values to Wolfram's `Indeterminate` anyway. The design chose
a second marked `NaN` literal with `isExact` false and a float rule, threaded
through every exact producer by hand: 487 occurrences in 74 source files
(the arithmetic library, multiplication and division, power, the
statistics, the type guards, the boxed number, the Epsil parser), an
861-line design, a forwarding rule in the folds and a final map under
`.N()`. Under option A, `Indeterminate` stays an input spelling only: the
MathJSON symbol, `\operatorname{Indeterminate}` and the Epsil name parse to
`NaN`, so no document breaks, and the serializer writes `NaN`. Issue #355
gets a comment at the release that says the two values merged back and
why. An exactness bit on the one `NaN` was considered and is not taken: it
is what the design rejected, because an exact value keeps forms inert.

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
booleans. Measured live in Desmos by Tycho on 2026-11-02: `\{u<1:5,7\}` is
7 when `u` is undefined (`0/0` or `[1,2][5]`), `\{u<1:5\}` is undefined,
`\{L<2:5,7\}` with `L=[1,0/0,3]` is `[5,7,7]`, and `5\{u<1\}` is undefined:
the undecided comparison takes the else branch, as option A gives.

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

**Why reassignment is costly today: five assumptions.** Reassigning a
local is not what costs; the emitted `let x = v; if (c) x = w;` is what
every target does natively. The cost is in five assumptions of the current
model, each of which forces an analysis (read from `compile-locals.ts`,
`compile-blocks.ts`, `compiler-core.ts` and `compile-cse.ts` on
2026-11-02):

1. **A local can exist without a value.** `Declare(n, integer)` has no
   value, and a bare first `Assign` makes an implicit `Declare` at the top
   of the block (`withImplicitLocalDeclares`), also without a value. The
   interpreter answers a read of such a local with `read-before-declaration`
   in a function body and keeps it symbolic at top level; no target has that
   value (JavaScript reads `undefined`, Python the previous pass of a loop,
   WGSL the zero of a `var`). So the compiler proves, for every read, that
   the local is assigned on every path before it: `classifyLocalReads`
   walks `If`, `Which`, `And`, `Or`, loops with `Break` and `Continue`,
   function literals and operand order, with three classes of read; it was
   rebuilt three times (1efbbe884, 17ba3b407, 15fc32706) and has a Python
   `_ce_unset` marker beside it.
2. **A local's type and shape can change across assignments.** The sources
   of a local's complexness are "an explicit type, a `Declare` value, or the
   FIRST `Assign` right side; a local already known complex is never
   demoted", kept in `_localComplex` and `_localVector` frames that are
   pushed and popped around blocks, loop bodies and function literals, with
   owner and shadowing rules (`withLocalShapeFrame`). R1 to R6 add that a
   local assigned values of two shapes declines.
3. **An assignment can sit inside an expression.** `Assign(t, Assign(u, v))`
   is split (`splitChainedAssignments`), assignments nested in operands are
   collected (`nestedAssignmentsTo`), and the read analysis has a rule for
   "the operands of any other operator, whose order of evaluation is not
   known".
4. **A block can write a symbol outside the compiled expression.** `c := n +
   1` with `c` declared in the engine compiles to a write of the vars
   object or of a local copy of the input (`chainedAmbientWrite`,
   `inputWrites`, `inputLocals`), and a shader cannot write a uniform.
5. **A block and a loop have a value.** A `Block` in operand position is
   lowered to a value (a `return` of its last statement or the target's
   block hook), and a `Loop` whose value is used needs a result variable and
   a proof that the body runs at least once (`loopRunsOnce`).

Two more costs are decided elsewhere: caller code in `vars` as an effect
(`reachesCallerCode`, about 600 lines; the user agrees it goes) and
function-valued locals (`bindsLocalFunctions`,
`withDefineFunctionDeclares`, `refuseEffectContractViolations`; page 5
option B declines them).

**Option A′, recommended: reassignment stays, the five assumptions go.**
In a compiled block:

- a local is declared with a value: `Declare(x, type, v)`, or a first
  `Assign(x, v)` at the block's own level, which is its declaration; a
  `Declare` without a value, or a first assignment inside a branch or a loop
  body, is a static error ("declare `x` with a value before the branch");
  `Declare(x)` followed by `Assign(x, v)` is not accepted as a pair (decided
  with Tycho on 2026-11-02: the `where` clause and the `;` parse emit the
  three-operand `Declare(x, "unknown", v)`, the type slot holding the
  inference marker, since the second operand of `Declare` is a type;
  Tycho changes its two builders that emit the pair, and its
  `Block(Assign(a, 1), b)` stays valid as a first assignment);
- a local can be assigned again anywhere after that, in a branch, a loop
  body or a nested block, with a value whose static type is a subtype of
  the local's type (the declared type, or the static type of the first
  value); another type is a static error;
- an assignment is a statement of a block, never an operand; `a := b := v`
  is two statements;
- a block never writes a symbol it does not declare, except an enclosing
  compiled block's local; a write to an engine symbol declines;
- a `Block` with an assignment is a statement or the whole body of a
  function or of the compiled expression; a `Loop` or `While` is a
  statement with no value;
- a `vars` entry is a value read once at entry.

| Input                                                         | Today                  | Option A′                                  |
| ------------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| `Block(Declare(a, 1), Assign(b, a + 1), b)`                   | compiles               | compiles                                   |
| `Block(Assign(s, 0), Loop(Assign(s, s + f(i)), i ∈ 1..n), s)` | compiles with analysis | compiles, no analysis                      |
| `Block(Assign(a, 1), If(c, Assign(a, 2)), a)`                 | compiles with analysis | compiles, no analysis                      |
| `Block(Declare(a), If(c, Assign(a, 1)), a)`                   | run-time check         | static error: `a` has no value             |
| `Block(Assign(a, 1), Assign(a, "x"), a)`                      | declines (two shapes)  | static error: `"x"` is not a `real`        |
| `f(a := 2) + a`                                               | analysis of the order  | static error: an assignment is a statement |
| `c := n + 1` with `c` an engine symbol                        | writes the vars object | declines                                   |
| `y := Loop(…)`                                                | result variable, proof | static error: a loop has no value          |
| `vars: {W: 'nextValue()'}` read twice                         | the effect runs once   | declines                                   |

Removes: `classifyLocalReads`, `assertLocalsAssignedBeforeRead`,
`localReadWithNoWrite`, `localReadOnSomePaths`, `loopRunsOnce`, the Python
`_ce_unset` marker (assumption 1); the `_localComplex` and `_localVector`
frames and `withLocalShapeFrame`, replaced by the static type of the symbol
(assumption 2; the complex half also follows from page 6);
`splitChainedAssignments`, `nestedAssignmentsTo` and the operand-order rule
(assumption 3); `chainedAmbientWrite`, `inputWrites`, `inputLocals` and the
vars-object write (assumption 4); the loop-value lowering and the
block-as-value lowering outside a body (assumption 5); `reachesCallerCode`
and the effects contract; the function-local code (page 5). Keeps:
`withImplicitLocalDeclares` in a reduced form (the first assignment is the
declaration), `assertNoUseBeforeDeclare`, the reserved-name spelling
(`spellReservedLocals`, cheap and needed), `compileBlock` and the statement
dispatchers. The interpreter keeps every form; the rules above apply to
compiled code only, except where the user also adopts them for the
language (below).

**For the language too, decided by the user on 2026-11-02.** Assumptions 1
and 3 are also what give the interpreter its `read-before-declaration`
channel and its symbolic unset read. Epsil adopts the two rules: a
declaration has a value (`let x: integer` with no value is a static error;
a first assignment at the block's own level is the declaration), and an
assignment is a statement of a block, never an operand (`a := b := v` is two
statements; `f(a := 2)` is a static error). The interpreter loses the
`read-before-declaration` channel and the symbolic unset read, and the
interpreter and compiled code agree by construction. The Epsil documents
(`src/epsil/docs/`, which the site copies) and `docs/ERROR-MODEL.md` change
with the implementation; the parser rejects the two forms at parse time.

To check in the census: an `Assign` whose target is not declared in its
block (assumption 4, Tycho's 44 documents with `Assign`), since the
census did not count it.

**Option A: straight-line locals only.** No reassignment at all; a block
compiles when every local is assigned exactly once, at the block's own
level, before any read. Removes the same code as A′ and nothing more; it
only declines more programs (every accumulator, counter and swap).

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

**This page narrows compiled code, with one change to the interpreter.**
The interpreter keeps first-class functions: lambdas, closures, currying,
partial application, function values. The one interpreter change is in the
defaults, below: a default fills an argument the call leaves out, at
canonicalization, and no longer an argument whose value is absent at
evaluation.

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

**Option B, decided by the user on 2026-11-02: A, but keep parameter
defaults**, because Epsil programs use them (and GitHub issue #490 asked for
them in compiled code: a `corpus` witness).

**How the defaults are implemented today, and what simplifies them.** Two
mechanisms exist, both in `compile-parameter-defaults.ts` (337 lines) and
their callers:

1. **Static completion** (`completedLiteralArguments`, commit 4d6479dee,
   2026-10-31): a call that leaves arguments out is completed at compile
   time with the default operands, and compiled as a full call. It is one
   function, it has no run-time cost, and every target uses it, the shaders
   and interval-js included.
2. **The run-time absent fill** (R6, commit f9c63f9c1, 2026-11-01, +925
   −355 lines, four review rounds): each argument at a defaulted position is
   wrapped in the target's `Coalesce` test, so that an argument that is
   absent when the call runs (`f(At(L, 100))`) takes the default. The wrap
   happens at function entry, in the callback wrappers of `Map` and the
   like (`defaultFillingWrapper`), in function literals, and per cell of a
   broadcast call; interval-js declines a supplied number at a defaulted
   position; a default that is a symbol is read at the call site
   (`callSiteDefault`).

The simplification is to keep mechanism 1 and remove mechanism 2: a default
fills an argument that the call leaves out, and nothing else. An absent
value supplied at a defaulted position is passed through as the value. This
reverses the "or absent" half of R6, a user decision of 2026-11-01; the user
confirmed the reversal on 2026-11-02, for the interpreter as well as for
compiled code: the interpreter fills a default at canonicalization, for an
argument the call leaves out, and no longer at evaluation for an argument
whose value is absent (`f(At(L, 100))` passes the absent value to `f`). The
documents that state R6 (`docs/COMPILATION-MODEL.md`, `docs/ERROR-MODEL.md`,
`src/epsil/docs/types.md`, the simplification plan's §5) change with the
implementation. Under page 1 option A the case that R6
answered disappears: `Map((k: real | missing = 2) => Coalesce(k, 0), L)`
with `L` holding `Missing` cannot be declared, and a `NaN` at a `real`
parameter is a value outside its type, so its result is unspecified. With
the static completion alone, no target restriction is needed: the shaders
and interval-js already complete a call at compile time, so reducing the
support to JavaScript and Python buys nothing. Two constraints make it
smaller still: a default is a constant (a number, a boolean, a string, or
an expression with no free symbol), so no `callSiteDefault` scoping rule; a
literal with a rest parameter has no defaults.

| Input                                                     | Today (R6)                             | Simplified                              |
| --------------------------------------------------------- | -------------------------------------- | --------------------------------------- |
| `g = (k: real = 2) ↦ k + 1`, `g()`                        | `3`, completed at compile time         | `3`, unchanged                          |
| `g(At(L, 100))` with `L: list<real>`                      | `3` (the `NaN` takes the default)      | `NaN + 1`, unspecified (outside `real`) |
| `g(x)` with `x: real` supplied as `NaN` by the host       | `3`                                    | unspecified                             |
| `Map((k = 2) ↦ k * 2, [1, 2])`                            | `[2, 4]` through a filling wrapper     | `[2, 4]`, the literal takes one argument |
| `(k = n) ↦ k` with `n` a symbol                           | `n` read at the call site              | declines (the default is not constant)  |
| a defaulted call on GLSL or interval-js                   | completed; interval declines a `NaN`   | completed, no decline                   |

Removes: `absentFilledArguments`, `literalDefaultFills`,
`defaultFillingWrapper`, `targetCoalesce`, `jsIsAbsent`,
`mayBeAbsentAtRunTime`, `argumentMayBeAbsent`,
`declineIntervalAbsentDefault`, `callSiteDefault`, the callback wrappers of
`compile-callbacks.ts` that fill, the per-cell fill of broadcast calls, and
the interpreter's fill at evaluation (the fill at canonicalization stays).
Keeps: `literalHasParameterDefaults`, `completedLiteralArguments`,
`literalAcceptsArgumentCount`, `literalTakesArgumentCount`.

**Option C: keep today's support.** Not taken.

## 6. The complex lane

**Today.** Four compile modes (`src/compute-engine/compilation/types.ts`):
`strict` (every lane follows the static types; a complex literal or a
declared complex input is complex, everything else real, and `Sqrt(x)` with
`x: real` gives `NaN` at `x = -4`), `complex` (every wide numeric value is
lifted to complex, unknown-sign radicals promote), `auto` (the default of
the JavaScript and Python targets: `strict` plus the promotion of
unknown-sign radicals, and on a `LaneMismatch` the compilation is redone
once in `complex` mode; with `x: real`, `Sqrt(x)` compiles in complex mode
with `promoted: true` and returns the complex object `{re: 0, im: 2}` at
`x = -4`), and `bigint` (JavaScript only, opt-in, no promotion and no
escalation). A complex value that reaches a parameter compiled as real is
recorded per definition (`5e29489a6`, +3,132 lines) and the compilation
restarts in complex mode (`c4e0a3bdb`); a complex statistics lane exists
for the aggregates. Measured on the current source, 2026-11-02.

**Tycho.** A node typed `complex`: 88 / 87 documents; a document in complex
mode: 32 / 32; a complex argument to a document function: 4 / 10; a compile
result in `mode: complex` or `promoted`: 9 documents; `escalation`: 0.

**Option A, decided by the user on 2026-11-02, in its strict form: the
lane follows the static types, and the host opts in to complex.** `strict`
becomes the only discipline and the default of every target; `auto` is
removed. The lane of a value is complex when its static type is complex (a
declared complex input or parameter, a complex literal, an operation whose
result type is complex), and real otherwise; the host asks for the
`complex` mode when it wants unknown-sign radicals and logarithms promoted.
No promotion, no `LaneMismatch` redo, no recording per definition, no
restart. A complex value that reaches a real input or parameter is a value
outside its declared type, so its result is unspecified (the host rule, R1
to R6). A new caveat of compiled code records that in the real lane an
operation whose exact value is complex gives the target's `NaN` (`Sqrt(x)`
with `x: real` at `x = -4`), which is the shader model applied to every
target.

| Input                                                            | Today (`auto`)                     | Decided                                    |
| ---------------------------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `Sqrt(x)`, `x: real`, at `x = -4`                                | promoted; `{re: 0, im: 2}`         | `NaN`; `{re: 0, im: 2}` with `mode: 'complex'` |
| `x + 2i`, `x: real`                                              | complex, static                    | complex, static, unchanged                 |
| `h = (p) ↦ p[1] + 1`, `P: list<tuple<complex, real>>`, `h(P[1])` | lane recorded, restart             | `p` is inferred from `P`: complex, compiles |
| `f = (x) ↦ x^2` compiled real, called with `2i` by the host      | restart in complex mode            | outside the type, unspecified              |
| `compile(e, {mode: 'complex'})`                                  | complex                            | complex, unchanged                         |
| `compile(e, {mode: 'auto'})`                                     | `strict` plus promotion and redo   | `unsupported-mode` decline                 |

Removes: the `auto` mode, the promotion of unknown-sign radicals, the
`LaneMismatch` redo (`compileWithAutoEscalation`), the `promoted` and
`escalation` fields of the result, the lane recording per definition and
the restart (`compile-complexness.ts` 635, `compile-lanes.ts` in part,
`compiler-mode.ts` in part, the restart in the JavaScript and Python
targets).

*Tycho's review, 2026-11-02.* Tycho passes `mode: 'auto'` explicitly in two
routes: every compile of a complex-mode document (`samplingModeOptions`,
chosen 2026-10-08 for "complex intermediates allowed, a real final value
returned": `\sqrt{x}^2` at `x = -4` samples as `-4`), and the colour lane of
every document (a domain colouring passes a complex value through a
document function). Its 9 `promoted` documents are those complex-mode
documents; real-mode documents already use `'strict'`. Its per-sample check
is `typeof v === "number"`. Measured on the current source the same day:
under `mode: 'complex'` a kernel whose value is real returns a JavaScript
`number`, and a complex object only when the imaginary part is nonzero
(`Sqrt(x)^2` at `-4` is the number `-4`; `Arg(x + iy)` and `Abs(x + iy)` are
numbers; `Sqrt(x)` at `-4` is `{re: 0, im: 2}`). So both routes move from
`'auto'` to `'complex'` with no change to Tycho's consumers and today's
values; under `'strict'` they would get `NaN` where an intermediate is
complex. The release note names `'auto'` as removed and `'complex'` as its
replacement. Nothing is left to confirm on this page.

**The same rule for `bigint`** (user, 2026-11-02): the bigint lane is used
only when the host asks for `mode: 'bigint'`, which is already the case; no
detection of a value past `2^53` and no escalation, ever. ROADMAP CE-715.6
(escalation to `bigint` on a run-time value) is dropped.

**Option B: keep the restart and `auto`.** Not taken.

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

**Decided by the user on 2026-11-02: WGSL, Python and value kinds are
kept.** Every feature of this table stays. **Replaced for WGSL on
2026-11-08: the WGSL target is dropped**, with the reason and the removal
list in `docs/plans/2026-11-08-glsl-fragment-spec.md` (status line and
section 5). Python and the value kinds stay as decided here.

**Separate packages for the targets: not now.** The user asked whether the
targets other than JavaScript (GLSL, WGSL, Python, interval-js) and value
kinds should become separate packages in a sister project, loaded on
demand. The facts, measured on 2026-11-02:

- The on-demand split exists today at the entry-point level.
  `src/compute-engine/engine-compilation-targets.ts` builds only
  `javascript` and `interval-js` into the engine; the `./core` entry carries
  neither the GPU targets nor Python (316 KB and 93 KB minified on 0.169.2),
  the full entry registers them with `addDefaultCompilationTarget()`, and a
  host of `./core` registers a target itself. So a consumer already pays
  only for the targets it loads.
- `javascript` is needed by the engine itself (the `Map` auto-compile, the
  quadrature, derivative and limit kernels, `NDSolve`, the fit, the kernel
  pool) and cannot leave. `interval-js` is asked for by the solver's domain
  enumeration (`intervalFunction` in `solve-domain.ts`); the call has a
  `null` fallback, so the solver runs without it, with less exclusion.
- The targets are not behind a stable interface. The Python and GPU targets
  import 46 distinct compiler-internal modules (`compiler-core.ts`, the
  `compile-*.ts` helpers, `core` hooks). A separate package would make that
  surface a public API that must stay stable across releases, and it is the
  surface that changed in 340 commits since September. Code lines on
  2026-11-01: `gpu-*` 18,430, `python-target.ts` 5,054, `interval-*` 4,336,
  `wgsl-*` 1,549, `glsl-*` 203, `javascript-*` 16,680, the shared compiler
  core about 49,000.

So a package boundary drawn now would freeze the wrong interface, and the
contraction of step 4 changes it in every step. The order is: contract
first; then, if the GPU family is still large, make it a workspace package
in this repository (one release train, one version, one test run with
lanes, and a package boundary that forbids the target from importing
compiler internals), not a sister repository with its own releases. The
benefits a split would give now, a smaller core test suite and a release of
the core that a target cannot break, are had more cheaply by test lanes
and by the entry-point separation that exists.

## 8. The decision table

| Page | Axis                | Options            | Recommended | Your decision |
| ---- | ------------------- | ------------------ | ----------- | ------------- |
| 1    | `Missing`           | A, B, C            | A           | A (2026-11-02): a result only, never a declared type; typed as a marker like `error`, implicit in signatures; `Undefined` removed |
| 2    | Error model         | A, B, C            | A           | A (2026-11-02): `Indeterminate` folded into `NaN` with its spellings kept as input; `Nothing` only as the value of an empty block; issue #355 gets a comment at the release |
| 3    | Comparisons         | A, B               | A           | A (2026-11-02): two-valued everywhere; an undecided operand gives `False` |
| 4    | Block locals        | A′, A, B           | A′          | A′ with the two language rules (2026-11-02): a declaration has a value, an assignment is a statement, in Epsil and in compiled code; reassignment stays |
| 5    | Function values     | A, B, C            | A           | B (2026-11-02), with the defaults simplified: static completion of a left-out argument only, constant defaults, in the interpreter and in compiled code; the "or absent" half of R6 is reversed |
| 6    | Complex lane        | A, B               | A           | A, strict form: `strict` is the only discipline, `auto` removed, complex by static type or `mode: 'complex'`; bigint stays opt-in with no escalation (2026-11-02) |
| 7    | WGSL target         | keep, drop         | drop        | keep (2026-11-02) |
| 7    | Python target       | keep, drop         | keep        | keep (2026-11-02) |
| 7    | Value kinds         | keep, drop         | drop        | keep (2026-11-02); separate packages for the targets: not before the contraction, then a workspace package in this repository if the GPU family is still large |

The decided options go into step 3 of the contraction plan (the language
release) and step 4 (the compiler contraction), and each becomes a page of
the model documents it changes.
