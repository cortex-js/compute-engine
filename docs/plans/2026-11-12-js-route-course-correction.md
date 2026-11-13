# The structured JavaScript route: a new contract and a plan to make it smaller

Status: DRAFT for the user's approval. No code has been changed for it.

## 1. Why

The structured route (the `numeric-kernel` profile) was built to replace the
existing JavaScript emitter with a simpler compiler that has fewer exceptions
and an intermediate representation on which every target can share
optimizations. Measured at `154153fe307c9084587b86fb0f9dc364c040cc8c`:

| Measure                                             | Value                     |
| --------------------------------------------------- | ------------------------- |
| Engine's own compilations admitted                  | 9,375 of 9,727 (96.4%)    |
| Every JavaScript compile of the suite, on the route | 27,198 of 35,026 (77.7%)  |
| Public `compile()` calls only                       | 17,831 of 25,511 (69.9%)  |
| Lines of the route (ten files)                      | 40,541                    |
| Lines of `javascript-target.ts` + `base-compiler.ts` | 21,001                   |

The route is correct and well tested, and it is about twice the size of what
it replaces. It was built under the contract "give exactly the existing
compiler's result, or decline", and that contract imports the existing
compiler's exceptions. The user withdrew that contract on 2026-11-12.

## 2. The contract

Compiled code gives a mathematically correct value: the interpreter's value
within the caveats of `docs/COMPILATION-MODEL.md`, "Caveats of compiled code".
The output of the existing compiler is not a reference. Where the existing
compiler has a rule or an exception, the route takes the simplest rule that is
correct. A decline is always acceptable.

Guaranteed:

1. **Value.** For ordinary arithmetic the result is within a relative
   difference of 1e-12 of the interpreter's machine-precision value. A numeric
   routine (integral, derivative, limit) is within its own stated tolerance.
   A difference in the last two digits from the existing compiler is expected.
   **Where a function is ill-conditioned the guarantee is on the argument,
   not on the result** (user decision, 2026-11-12): the default mode computes
   a function with the JavaScript `Math` function or the direct formula in
   doubles, and gives the function's value at an argument within a few units
   in the last place of the given one. Near a branch point, a pole or a
   cancellation the result can therefore differ from the interpreter's by
   more than 1e-12, or be `±Infinity` or `NaN` where the interpreter is
   finite (`Arsech(x)` at x = 1 - 1e-16; `Arctan(Ln(x))` at x = 0). The
   compiler carries no special formula to follow the interpreter there. On a
   branch cut the side follows the sign of the zero part, as IEEE 754
   functions do. The principle (user, 2026-11-12): a host that wants
   precision and accuracy uses the interpreter, one that wants speed uses
   the compiler, and one that needs a sound answer around a pole uses the
   `interval-js` target. GLSL already handles poles, `NaN` and infinities
   by its own rules. A "high-precision float" mode that calls the
   interpreter's machine kernels where they exist is possible later, and is
   not a priority until a use shows it is needed.
2. **Shape.** Shapes are settled at compile time (R1 to R6), with no run-time
   test of a type or a shape.
3. **Exact integers.** Sums, differences and products of integers below 2^53,
   `Floor`, `Mod`, comparisons and list indexes give the exact integer. The
   compiler does not reassociate or fuse an integer expression. **An integer
   value of 2^53 or more is a double in the default mode and its low digits
   are unspecified** (user decision, 2026-11-12): `Mod(Factorial(25), 7)` has
   no guaranteed value. The compiler makes no analysis of integer ranges. The
   remedy for the host is the `bigint` mode.
4. **Seeded draws.** A `WithRandomSeed` frame whose body has ONE draw site
   (one `Random()`, one list draw, one shuffle) gives the interpreter's value
   bit for bit: the draws of the site start at index 0 on entry of the frame,
   and the site is evaluated once per evaluation the interpreter makes. A
   frame with two or more draw sites, or whose count of sites is not proven
   to be one (a body that calls a function, for example), compiles with a
   WARNING in the result (user decision, 2026-11-12): the compiled value is
   deterministic, in the compiler's own documented order, and can differ from
   the interpreter's. The host decides whether to accept the code or to fall
   back to the interpreter. The compiler does not reproduce the interpreter's
   order of evaluation between operands. (Tycho's corrected requirement,
   2026-11-12: its importer gives each written draw its own frame; Tycho
   asked for a decline in the second case, and gets the same effect by
   treating the warning as a decline.)
5. **Agreement within a tolerance, not identical bits** (user decisions,
   2026-11-12: determinism is guaranteed for the interpreter with no
   concurrency, and not otherwise). Two executions of the same expression on
   the JavaScript target (recompiled or not, with workers or without, a sum
   combined in another association) agree within a relative difference of
   1e-12, as the compiled value agrees with the interpreter. On GLSL a
   driver may reorder operations and round differently: the result is
   correct within single-float precision. The compiler carries no machinery
   to fix an order of operations or to reproduce bits. No rewrite changes
   the operation of an integer computation (rule 3): a reordering of exact
   integer sums and products is harmless, `a/b` into `a·(1/b)` is not.
   **The emitted text is a function of the expression, the options and the
   definitions it reads**: no counter persists between compilations. This is
   required for GLSL (Tycho's GPU program cache is keyed on the shader
   source) and kept for JavaScript.
6. **Untaken branches.** A branch that is not taken is not evaluated when
   evaluating it could throw or fail to terminate.
7. **Inputs.** Input arrays are never mutated. The inputs object is read as a
   value that is fixed for the duration of a call.

Not specified:

- the order in which two pure operands are evaluated;
- how many times a pure sub-expression or a pure host function is evaluated;
- the order and the number of reads of the inputs object;
- the sample points and the number of samples of a numeric routine;
- which of two NaN-producing terms a sum reaches first, and the sign of a
  zero where the interpreter does not define it;
- the order in which a parallel or asynchronous reduction combines its
  parts (a `parallel for` on the worker pool, a shader): the result can
  differ in its last digits from the sequential one (user decision,
  2026-11-12);
- the text of the emitted code.

8. **Order of effects, in sequential compiled code** (user decision,
   2026-11-12). An operation that is not pure (a draw, a host function not
   declared pure, an assignment) is evaluated exactly once per evaluation
   that the program asks for, never shared, dropped or repeated, and in the
   order of the program: the operands of the canonical expression from left
   to right and before their operation, the statements of a block in order,
   an arm only when it is taken, a body once per index in increasing order,
   the arguments before a call. The order of evaluation of pure operations
   is not specified. This rule does not extend to parallel or asynchronous
   evaluation.

Guarantees 3 to 7 come from Tycho's answer of 2026-11-12 (session
`tycho-desk`, read from Tycho's source): Tycho passes one host function, which
is pure, has no getter on its inputs object, compares compiled and interpreted
values with a relative tolerance of 1e-12, and depends on evaluation order
only through seeded draws.

Open point for the user: Tycho suggests that the seeded sequence also stays
the same across versions of the engine, so that a stored document keeps its
picture. Recommended: yes.

## 3. What the audit found

A read-only audit classified every block of the four main files by the reason
it exists (`docs/plans/2026-11-12-js-route-audit/blocks.csv`; the second half
of `javascript-fragment-target.ts` was classified from block comments, so the
split is an estimate of about ±30% on mixed blocks).

| File                              | Needed | Mirrors the existing compiler | Guards a real difference | Admission repeats typing | Infrastructure | Total  |
| --------------------------------- | ------ | ----------------------------- | ------------------------ | ------------------------ | -------------- | ------ |
| `javascript-fragment-target.ts`   | 9,412  | 6,113                         | 648                      | 1,509                    | 873            | 18,555 |
| `javascript-structured-lower.ts`  | 5,631  | 2,262                         | 0                        | 0                        | 194            | 8,087  |
| `fragment.ts`                     | 3,523  | 0                             | 0                        | 0                        | 215            | 3,738  |
| `javascript-structured-emit.ts`   | 1,733  | 218                           | 0                        | 0                        | 235            | 2,186  |
| Sum                               | 20,299 | 8,593                         | 648                      | 1,509                    | 1,517          | 32,566 |

- About 10,100 lines (31%) exist only for the withdrawn contract. Removing
  them gives a route of about 30,000 lines (estimate, 27,000 to 33,000).
- **That is still about 1.4 times the existing emitter.** The contract change
  is necessary and not sufficient. The 20,300 lines classed as needed are
  themselves too many: operators are lowered by hand-written rules, one per
  operator and per lane, in an admission rule and again in a lowering rule.
- The two-phase structure is not required. GLSL uses one typing walk
  (`typeFragment()` and the walkers of `fragment.ts`) and emits from its
  annotation. JavaScript adds two admission walks and about a dozen refusal
  passes before lowering.
- Fields of the target-neutral core that exist only for the withdrawn
  contract: `atDefinition`, `IRFunction.inputs`, `checksCount`, `localValues`.

## 4. Plan

Each step ends with the suite measures of section 1 and the line count. A step
is accepted when the engine's own compilations stay at or above 96% on the
switch-on run with no test failure, and the line count falls.

**Step 0. The oracle.** The random tester and the structured tests compare
with the interpreter within the tolerance of rule 1, and check rules 3 to 7
directly (exact integers, seeded draws against the interpreter, two calls and
two compilations give the same bits, inputs unchanged). A difference from the
existing compiler is printed as information. Tests that pin emitted text are
reduced to the few that guard a rule.

**Step 1. Delete the mirror rules.** By family, largest first, each as one
change: lanes asked of the existing compiler (the lane comes from the static
type); the aggregate early exit, throw tables and count tests (one loop);
the `Power`/`Root` branches and folds; pre-emptive folds and decided
selections; operator grouping; stored values and the time of input reads;
the hoisting rules for draws (replaced by rule 4); range-specialized helper
copies; refusals of absent values; the refusals that reproduce CE-1196 and
CE-1224. Programs that declined only because the existing compiler differed
are admitted. Expected: about −8,600 lines.

**Step 2. One walk.** The admission walks (`checkNode`, `checkValueNode`,
the `refuse*` passes) are folded into the typing walk: a rule that has no
lowering declines by throwing from the place that would lower it. The
recorded forms that carry admission decisions to the lowering go. Expected:
about −2,000 lines, and the class of internal errors where admission and
lowering disagree disappears.

**Step 3. Operators as a table.** A scalar operator is one table row: its
type rule, its IR operation per lane, and its exactness class (rule 3). The
hand-written per-operator rules of admission and lowering are replaced by the
table and a small set of generic lowerings (unary, binary, variadic fold,
comparison chain, element-wise). This is the step that attacks the 20,300
"needed" lines; its saving is not measured yet. A design note with a
prototype on ten operators comes before the change.

**Step 4. Passes on the representation.** Sharing of pure sub-expressions and
constant folding become passes on the IR, bound by rules 3, 4 and 6. This
closes the question of the constant-folding baseline.

**Step 5. A second target.** `interval-js` lowers from the same
representation. Anything in the core that it cannot use is moved to the
JavaScript policy.

**Budget.** Coverage work (the `program` profile, union inputs, complex
lists) resumes when the JavaScript-only part of the route is smaller than
`javascript-target.ts` (19,031 lines), or when the user says so.

**Validation with Tycho.** After step 1 and after step 4, a scratch build
goes to `tycho-desk`, which offered to run its codegen audit over its 115
documents comparing values, and its seeded-random tests.

## 5. What happens to earlier work

- The tests of the route stay as the description of what is admitted; their
  comparison changes (step 0).
- The issue files for wrong values of the existing compiler stay open only
  for the targets and kernels that survive it; each gets a line saying which.
- The draft `program` profile spec and its decisions D1 to D5 wait for the
  budget.
- The census of the bare `unsupported binding` declines is finished as a
  census with better messages, and no new rule.

## 6. Decisions for the user

1. Approve the contract of section 2, including the 1e-12 bound.
2. Seeded sequences stable across versions (recommended: yes).
3. (Decided 2026-11-12: rule 8. Operations that are not pure keep the
   program's order; pure ones have no order.)
4. The order of the plan, in particular the table of step 3 before more
   coverage, and the budget.
