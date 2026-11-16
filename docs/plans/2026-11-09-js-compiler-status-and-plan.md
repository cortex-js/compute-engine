# JavaScript compiler migration: status and implementation plan

**As of 2026-11-09, committed CE `a81590bce`.** This is the consolidated
reading guide and recommended sequence for the work begun in the
[original migration proposal](2026-11-08-javascript-fragment-migration.md).
Historical reports retain their own baselines and validation records. This
summary does not turn experiments into production capabilities or create
ROADMAP entries.

**Decisions.** The bounded scalar-emitter design: approved 2026-11-09. The
revised steps 1 to 4 below, which replace the first version of those steps
after the review of 2026-11-09 (section "What the review of 2026-11-09
found"): approved 2026-11-09. This approval is also the decision that step 7
of the [compile-targets plan](2026-11-08-compile-targets-implementation-plan.md)
asks for, limited to a JavaScript pilot. Each later expansion and each change
of a default needs its own decision.

## Where we are

We have demonstrated that a scoped fragment annotation can drive selected parts
of the existing JavaScript compiler, including real/complex choices, local
bindings, resolved helper calls and captured values. We have also exercised the
composition through an actual numeric `Map` consumer, including invalidation
when a captured binding changes.

We have **not yet implemented the independent JS scalar emitter**, registered a
new public JS target, exposed profile options, or switched production consumers.
The existing internal fragment target still uses the traditional emitter and
runner. In particular, the subject of commit `e02dcb0b1` should not be read as
proof that the new emitter exists: that commit contains the approved design
and separate fragment/destructuring changes.

The annotation is also not yet an independent source of facts. For a scalar
root, the rule that decides between a real and a complex result calls
`BaseCompiler.isComplexValued()` (`numericRule` in
`javascript-fragment-target.ts`), which is the reader of the existing
compiler. The annotation is built on first entry inside `compileExpression()`
(`enterScalarFragment()` in `javascript-fragment-facts.ts`), after the
existing compiler has set the state that this reader needs. A test that
compares the fragment route with the existing compiler therefore compares
one answer with itself.

The next implementation task is to make the annotation independent of
emission (revised step 1). Then implement and measure the scalar
representation and emitter on a fixture taken from a real program.

## What the review of 2026-11-09 found

Three reviewers read the fragment target, the changed readers of the existing
emitter with their tests, and these plan documents. They ran about 160
combinations of program, mode, CSE and folding through the fragment target,
the ordinary JavaScript compiler and the interpreter.

- No value differs between the fragment target and the ordinary compiler. The
  ordinary `javascript` target takes its old code when no fragment is
  attached. Each changed reader throws when a fact is missing.
- The rule for a real or complex result depends on the existing reader, as
  the section above says. `glsl-fragment.ts` calls the same reader, so a
  producer that does not need it serves both targets.
- `isComplexValued()` is 105 lines of `compiler-core.ts` and its name occurs
  301 times in `compilation/*.ts`. No step before the replacement decision
  (step 9) can remove it: every operator of the ordinary target reads it.
  The pilot adds code and removes none.
- For literals, inputs, `Add`, `Negate` and `If`, the two emitters write
  almost the same JavaScript. A measure on that vocabulary cannot show a
  difference in execution time, and most of its compile time is the shared
  preparation.
- Constant folding, `jumpShiftRewrite`, `knownExponentPower`, the choice of
  an `If` branch at compile time, the binding of helper definitions and
  admission all run during emission. An annotation built before emission
  does not see their results.
- In the complex case, `Negate` and `Add` do not read the recorded conversion
  of an operand (`javascript-target.ts`, the `Negate` and `Add` handlers);
  `Sqrt` and `If` do. No admitted program has such a conversion today.
- `operandNumericRule` gives a complex result when an operand is complex.
  The [annotation contract](2026-11-09-shared-annotation-contract/annotation-contract.md),
  section 4, forbids that rule in general. It is correct for `Add` and
  `Negate` and for no other operator of step 5.
- A local declared `integer` accepts a real value, because the check compares
  the representation (`number`) and not the type. The ordinary compiler does
  the same. Example: `Block(Declare(n, 'integer', w), n)` with `w = 2.5`
  gives `2.5`; the interpreter gives an error.
- Tests: one of the seven fragment test files makes the existing readers
  throw, on a target made by hand. Four negative tests passed for a reason
  other than the one in their name, and six invariant errors had no test.
  The repair of these tests is a separate change of test files.

## Decisions to preserve

| Dimension | Agreed direction |
| --- | --- |
| Backend | JavaScript and GLSL remain separate targets with their own numerical and runtime policies. |
| Vocabulary | Two proposed profiles: numeric-kernel and program. Numeric does not mean scalar, pure, or expression-only. |
| Internal consumers | No third “internal” profile. Map, solvers and integration retain their own calling and correctness requirements. |
| Execution | Independent calls, worker portability, nonblocking execution and internal parallelism are distinct requirements. A preference may permit a sequential route; a requirement must be established or declined. |
| Representation | Ordered operations, explicit conversions, value identities and structured regions. CPS and a general CFG/SSA conversion are not prerequisites. |
| Migration | Keep traditional JavaScript available and default until measured parity for the intended use. No hidden legacy subtree fallback inside the new emitter. |
| Effects | Carry target-aware effect facts from preparation. Only proven-pure operations are candidates for CSE/reordering; non-pure and unknown operations preserve count, order and conditional execution. |

Profile and execution-option names are still design concepts, not implemented
public API. Profile admission must inspect resolved signatures, bindings,
reachable bodies and effects, not just operator names. Static shape rules and
compiled-code caveats remain those of [the compilation model](../COMPILATION-MODEL.md).

Purity does not imply worker portability, safe shared mutation, permission to
speculate a possibly throwing computation out of a branch, or permission to
reassociate floating-point arithmetic. Invocation-local mutation can be
compatible with independent calls; shared mutable state requires a separate
argument. These distinctions are central to both compiler work and Buddhabrot.

## Work completed and its evidence

### 1. Consumer and workload inventories

The [initial audit](2026-11-08-js-profile-audit/README.md) examined CE consumers,
Tycho compile gateways, existing corpus artifacts and a bounded structured-IR
experiment. It established why numeric kernels need collections, functions and
loops, and why consumer policy should remain separate from vocabulary.

The [resolved-profile study](2026-11-09-js-profile-experiments/profile-report.md)
followed reachable prelude functions and binding identities in selected Tycho
showcases. This is workload inventory, not a measured profile-admission rate.
Unresolved calls were retained as unresolved rather than treated as proof of
unsupported language semantics.

The [prelude refresh](2026-11-09-shared-annotation-contract/prelude-refresh.md)
added traffic, heat diffusion and Othello fixtures. They provide concrete tests
for simultaneous state updates, disjoint input/output arrays, transitive calls,
early exits and variable-length numeric lists. Their existing tests passing
is not evidence that the new compiler already supports them.

### 2. Annotation ownership and JS implementation slices

The [annotation contract](2026-11-09-shared-annotation-contract/annotation-contract.md)
separates a prepared artifact, lexical scope, binding identity and target policy.
Equal printed syntax is not interchangeable identity. Missing facts fail closed;
rewritten trees need valid facts for their new revision.

| Implemented slice | What it establishes | Boundary that remains |
| --- | --- | --- |
| [Scalar roots](2026-11-09-js-fragment-slice.md) | Add, Negate, Sqrt and If consume scoped real/complex facts, including lazy conversions. | Existing numeric policy and emitter remain. |
| [Bindings](2026-11-09-js-fragment-bindings.md) | Explicitly typed scalar function parameters and a same-representation local can use scoped facts. | Deliberately narrow function/local vocabulary. |
| [Named calls](2026-11-09-js-fragment-calls.md) | One resolved helper body and its argument/result facts compose through the existing registry. | Not arbitrary call graphs, indirect calls or recursion. |
| [Captures](2026-11-09-js-fragment-captures.md) | Captured numeric substitutions retain exact binding identity and compilation snapshot semantics. | No general capture/alias or worker-safety proof. |
| [Callback composition](2026-11-09-js-fragment-callback.md) | Calls, locals and captures compose through the real Map route, including reuse and dependency invalidation. | No production consumer switch or parallelism claim. |
| [Call facts](2026-11-09-js-fragment-call-facts.md) | Authorized scalar calls bypass specific redundant legacy argument classifiers; missing facts reject. | Upstream legacy analysis and generic emission still exist. |

The slice reports record focused differential tests, negative controls,
ordinary-target regressions, core checks and independent reviews at their
respective revisions. Some tests deliberately make legacy readers throw and
include an ordinary-target control that reaches those readers. This establishes
particular consumption boundaries, not independence from all legacy machinery.
Test counts overlap across slices and should not be added into a new total.
No new tests were run to produce this summary.

### 3. GLSL groundwork and the effect correction

The GLSL work established the typed preparation/admission path and removed
substantial legacy checking machinery. It still has target-specific emission
and some legacy shape readers. Its representation and policies should not be
copied wholesale into JS.

[CE-1176 caller-code binding](2026-11-09-ce1176-caller-code-binding.md) now binds
non-pure caller code once per reached occurrence, preserving operand order and
branch/iteration placement. CE-1188 identified the complementary problem: a
caller's trusted `pure: true` declaration must reach the shared analysis.
The approved JS pilot explicitly incorporates both lessons. Node identity
cannot merge repeated effectful occurrences, and pure arithmetic surrounding
an effectful producer cannot erase that producer's evaluation.

The [measurement gate](2026-11-09-js-emitter-measurement-gate.md), measured at
`68672e1b1`, reproduced the old counting baseline. GPU-family source fell by
5,726 counted lines; total compiler source grew by 2,501; `CompileTarget` went
from 94 to 92 members. Four statement-compilation entry points remain, with
some delegation between them. These are filename-based source counts, not
performance results or a count of duplicated algorithms.

### 4. Concurrency experiments

The [Node worker experiment](2026-11-09-js-profile-experiments/buddhabrot-workers.md)
ran the actual compiled Buddhabrot step with private histograms and deterministic
sample partitions, checking all histogram entries and the cursor against serial
execution and an independent reference. It showed useful parallel execution in
that pinned experiment; it did not use CE's production pool or change Tycho.

The later [browser experiment](2026-11-09-shared-annotation-contract/browser-report.md)
used current-at-the-time CE `createKernelPool()` and `runAsync()` in Chromium,
with a coordinator and nested workers. The adapted reduction agreed with serial
and independent reference results. It also exercised bounded lifecycle controls.
The adaptation explicitly marked parallel work and additive reductions, and
required an iteration-budget policy choice.

Neither experiment proves integration with Tycho's document manager, deadlines,
navigation or publication lifecycle. No browser speedup is claimed here, and
historical timing observations are not acceptance thresholds for current code.

## Recommended implementation sequence

Each step should be a separately reviewable change or small series. Preserve
the normal source validation and review process; run broad corpus or timing
work only when the step's claim needs it.

### Step 1 — Build the annotation before emission, without the existing reader

**Deliver:**

1. A list of the rewrites that JavaScript emission performs on the pilot
   vocabulary of step 2: constant folding (`tryConstantFold()`),
   `jumpShiftRewrite`, `knownExponentPower`, and the choice of an `If` branch
   when the condition is known at compile time. For each one, state the
   decision: it runs before the annotation, or the fragment route declines
   the program, or its product receives facts. The list is
   [what emission decides or rewrites](2026-11-09-js-pilot-emission-rewrites.md);
   its decisions are proposed and need the user's approval before the code
   of this step. It changes the vocabulary of step 2 in two places:
   `Greater` is removed, because the canonical form writes it as `Less`, and
   each operand of `And` and `Or` after the first is a region.
2. A rule in the typing pass that decides between a real and a complex
   result from the facts of the operands and a signature per operator. It
   does not call `isComplexValued()`. Each operator states its own rule: "a
   complex operand gives a complex result" holds for `Add`, `Negate` and
   `Multiply`, and is not a default for other operators.
3. The annotation, the binding of the root function
   (`bindScalarFragmentFunction()`) and the binding of helper definitions are
   done in `prepareCompilation()`, not on first entry in
   `compileExpression()`.
4. Two corrections in the fragment route: the complex cases of `Negate` and
   `Add` apply the recorded conversion of each operand, and a write to a
   local declared `integer` declines when the type of the value is not a
   subtype of `integer`.

**Pass when:**

- On the real `compile()` route of the fragment target, a test makes
  `isComplexValued()` throw from the start of preparation to the end of
  annotation, and the fixtures compile.
- A comparison over the fixtures and over the corpus expressions inside the
  vocabulary gives the new rule and `isComplexValued()` for each admitted
  node. Each difference is listed and is either a defect of one of the two or
  a decline.
- The annotation exists before the first call of `compileExpression()`.
- The ordinary `javascript` target gives the same code for the corpus.

This step is useful if the work stops after step 4: the GLSL fragment calls
the same reader.

**Result of step 1 (2026-11-09).** Done, with these differences from the
text above:

- `Sqrt` still calls `isComplexValued()`. Its rule runs inside
  `withOutermostCompilerState()` (`javascript-fragment-target.ts`), which
  sets the state that the outermost compilation sets and restores it. A
  program with a `Sqrt` is refused inside another compilation. The rule of
  `Sqrt` moves in step 5.
- The facts of the root function and of the helper definitions are computed
  in `prepareCompilation()`. `bindScalarFragmentFunction()` and
  `bindScalarFragmentDefinition()` stay at their call sites and give those
  facts to the inner target, because the inner targets are made after
  preparation by code of the ordinary route.
- A function node with a complex fact and no free symbol is refused, except
  `Sqrt` (`refuseClosedComplex()`). With constant folding on, the emitter
  writes the folded real literal for such a node while its fact says
  complex: `Add(x, If(p(True), 1, Sqrt(-2)))`, with `p` the identity on
  booleans, gave `NaN` at `x = 1` before this refusal.
- The comparison of the new rule with `isComplexValued()` covers 30 programs
  in 8 combinations of mode, folding and CSE (1,328 nodes). One difference:
  in `complex` mode, the existing reader calls a local declared `boolean`
  complex and the fact does not; both compilers give the right value. No
  corpus was compared: the repository has no tool that lists the scalar
  expressions of the Tycho corpus.
- The complex case of `Add` checks the recorded conversion of each operand
  against the fact of that operand, and still writes a real operand as a
  real part only.

### Step 2 — The representation and its verifier, for one real fixture

The pilot vocabulary is the one that this fixture needs. `heatwall` is copied
from the heat showcase of Tycho
(`~/dev/tycho/src/graph-paper/onboarding/showcase-heat.js`). `heatcell` is
written for the pilot from the body of the loop of `heatstep` in the same
file, with the sum of the four neighbours as an input `s`, so that no list is
needed:

```
function heatwall(c: integer, r: integer, obstacle: real) -> boolean {
  obstacle > 0.5 && c == 16 && (r < 13 || r > 18)
}
function heatcell(v: real, s: real, d: real,
                  c: integer, r: integer, obstacle: real) -> real {
  let a = min(0.25, max(0, d))
  if heatwall(c, r, obstacle) { v } else { v + a*(s - 4*v) }
}
```

**Deliver:** the effect facts, recorded with the representation facts
from the resolved definitions and the purity contract of the target; and
value IDs owned by the compilation, ordered regions, literals,
input reads, `Add`, `Negate`, `Multiply`, `Less`, `Equal`, `And`, `Or`,
`Min`, `Max`, the real-to-complex conversion, `If` with a yield per
region, one local with one assignment, and a call of one resolved helper.
Each value has a semantic type, a representation, an origin and an effect
fact. Each operand of `And` and `Or` after the first is a region that is
evaluated only when the earlier operands do not decide the result, as
JavaScript `&&` and `||` do. The complex fixture of the
[pilot design](2026-11-09-js-structured-scalar-emitter.md),
`If(C, x, z) + y`, stays. The verifier also accepts one operation kind that
exists only for tests: it has a declared effect and writes a trace. Without
it, no admitted operation is effectful and the effect rules have no test.

**Pass when:** the verifier rejects a value of another compilation, a use
outside the region of its definition, an invalid conversion, branch results
of different representations and a missing effect fact. Two occurrences of
the test operation stay distinct and in order, and an untaken branch leaves
no trace. No CSE, reordering, loop or collection in this step.

### Step 3 — Emit the representation

**Deliver:** a narrow internal body-emission interface inside JavaScript
compilation, and an emitter for the representation of step 2 behind it. The
interface reuses runtime assembly, input normalization, helper and preamble
collection, dependencies, stored-code metadata and the existing runner. It
is not a member of `CompileTarget`. It is written in this step and not in
step 1, because the new emitter is its first user and decides its form. The internal target class selects the emitter with a
constructor argument; there is no compile option and no registered target
name. Both emitters receive the same annotation object and have separate
emission state. CSE and constant folding are refused, not ignored. `Sqrt`
stays on the existing emitter.

**Pass when:**

- Values, shapes, laziness of branches and the place of each conversion
  agree with the interpreter, and with the existing emitter as a second
  check. The interpreter decides when the two differ.
- Emitted code, `run()`, metadata and reconstruction agree with the existing
  route.
- On the real `compile()` route, the existing readers (`isComplexValued()`,
  `staticTypeOf()`, `userFunctionParamLanes()`, the generic walk) throw
  during emission and the fixtures compile. A control shows that the
  ordinary target reaches each of them.
- A program outside the vocabulary declines. The counts of accepted
  programs, intended declines, unexpected declines and emitter failures are
  reported separately.

### Step 4 — Measure, then decide to expand or to stop

**Measure**, with the method of [benchmarks/README.md](../../benchmarks/README.md):

| Configuration | Purpose |
| --- | --- |
| Ordinary `javascript` target, default options | The cost that a host pays today |
| Ordinary `javascript` target, CSE and folding off | The same options as the pilot |
| Fragment target, existing emitter | The cost of the annotation alone |
| Fragment target, new emitter | The pilot |

Fixtures: `heatwall`, `heatcell`, the complex fixture, and the scalar
expressions of the corpus that are inside the vocabulary (state their
number; if fewer than 20, say that the corpus result is weak). Report
preparation, annotation, lowering, verification, emission and assembly
separately, cold and warm compilation, warm execution, emitted bytes, and
the variability of the harness. Also report two line counts by the rule of
the [measurement document](2026-11-09-js-emitter-measurement-gate.md): the
lowering, verifier and emitter of the pilot; and the handlers of the
existing emitter for the same operators.

**Decide:**

- A wrong value, a wrong shape or a hidden use of the existing emitter:
  correct it, or stop.
- A reproducible cost above 10% in total compilation or 5% in warm
  execution, against the ordinary target with the same options: revise the
  design before any expansion.
- A difference smaller than the variability of the harness: time is then not
  a reason for either choice. The two line counts decide: expansion is
  proposed to the user only if the pilot is smaller than the handlers it
  would replace, or if it removed a class of defect that has a `corpus` or
  `plausible` witness.
- Stop means: the structured emitter and its representation are deleted;
  the annotation and the rule of step 1 stay.

The user decides with this report. No work of step 5 starts before that
decision. The same report also asks again whether a structured
representation is built for GLSL and `interval-js`: that question was left
open until the result of this pilot
(`docs/plans/2026-11-08-compile-targets-implementation-plan.md`, step 7).

**Result of steps 2 to 4 (2026-11-09).** Steps 2 and 3 are in
`javascript-structured-ir.ts`, `javascript-structured-lower.ts` and
`javascript-structured-emit.ts`; `new ScalarFragmentJavaScriptTarget('structured')`
selects the new emitter. The measure is
[the pilot measure](2026-11-09-js-structured-pilot-measure.md). In short:

- No value differs between the four configurations on 8,809 inputs of 546
  corpus programs and the fixtures.
- Compilation with the new emitter takes 30% to 68% of the time of the
  ordinary target with the same options on the fixtures, and is not slower
  on the corpus.
- Execution time: no difference was resolved.
- The new emitter writes 2.5 to 6.7 times more code, because it binds each
  value to a `const` and writes `If`, `And` and `Or` as statements.
- The pilot is 1,539 counted lines. The handlers of the existing emitter for
  the same operators are at most 907 lines, and about 190 by estimate for
  the scalar cases alone.
- Applied to these numbers, the rules of step 4 say: no correctness stop, no
  cost above the budgets, and neither condition for a proposal to expand
  holds (the pilot is not smaller, and it removed no class of defect that
  has a `corpus` or `plausible` witness). The compile-time gain is a result
  that the rules did not foresee.

**Revision of the emitter (2026-11-10).** The user chose to revise and
measure again. The emitter now writes a pure value with one use at that use,
and `If`, `And` and `Or` as expressions when their regions are expressions.
The new route then writes about as much code as the ordinary target with
the same options (`heatwall` 56 bytes against 62; the 40-program corpus
sample 1,204 against 1,215; a complex sum stays 36% larger). Compilation is
unchanged: 32% to 69% of the time of the ordinary target with the same
options, 27% to 53% with its default options, and 68% on the corpus sample.
Execution: no difference was resolved, also on two fixtures where the CSE
and the folding of the ordinary target apply; the vocabulary has no costly
operation to repeat. The pilot is now 1,628 counted lines. The numbers are in
the section "The revised emitter (2026-11-10)" of the measure.

**Decision: expand, approved 2026-11-10.** Step 5 starts. The size condition
of step 4 did not hold; the user expands for the compile-time result and for
the objectives below.

### Objectives for the representation, approved 2026-11-10

The representation is to become general: used by more than one target, able
to carry what a proof about concurrent execution needs, and close enough to
SSA for optimizations. Three rules follow for every later step:

1. **No target in the core.** The values, regions, operations, effect facts
   and the verifier import nothing from a target and name no target
   representation. A target supplies its representations (`number` and
   `{re, im}` on JavaScript; `float`, `int`, `vec2` on GLSL) and the legal
   conversions between them as a policy that the verifier is given. The
   emitter and the lowering rules of an operator are per target.
2. **One definition per value.** A write to a local makes a new value. An
   `If` whose branches write a local yields the merged value as a result of
   the `If`; a loop carries a value from one iteration to the next as a
   parameter of its body region. No operation writes a named variable. This
   is the structured form of SSA: no control-flow graph and no phi placement.
3. **Effects name what they touch.** `pure`, `effectful` and `unknown` are
   enough to keep an order. A proof that two calls are independent, or that
   a kernel can run in a worker, needs more: which captured binding an
   operation reads or writes, and whether a called function is known. These
   facts are added with the first operation that needs them (captures in
   step 5, list writes in step 6), on the operation, not in a side table.

These rules do not start a conversion of the GLSL emitter or any
optimization pass. Each is a later step with its own measure.

### Step 5 — Recover the existing internal slice coverage

**Deliver, in two changes.** First: the core of the representation moves
out of the JavaScript files (objective 1), and local writes with branch
merges are added as single-definition values (objective 2). Second: `Sqrt`
with its domain and promotion rule decided from facts, helpers that call
helpers, and captured values with their binding recorded on the operation
that reads them (objective 3). Typed function entry and one resolved helper
are already done in steps 2 and 3. Reuse the prior slice fixtures so the
independent emitter reaches the behavior already demonstrated through legacy
emission. The step ends with the paired measure of step 4, with a fixture in
which a costly operation (`Sqrt`) is repeated, so that the cost of emitting
without CSE is measured.

**Pass when:** every migrated feature has differential coverage, binding and
invalidation controls, and no generic emission fallback. Use single-definition
versions for local writes and explicit branch results. Keep unresolved calls or
shape changes as declines. General recursion and indirect calls can wait.

**Result of step 5 (2026-11-10).** Both changes are done.

- The core is `structured-ir.ts` and `structured-verify.ts`. It imports no
  target; a target gives the verifier a policy
  (`javascript-structured-policy.ts`). A test verifies a program under a
  second policy with other representation names.
- A write to a local makes a new value, and an `If` statement yields one
  merged value per local that a later statement reads (`IRIf.results`).
- `Sqrt` is decided by `structuredSqrtRule()` and `signOf()` from the facts
  of the operand and the mode. Over 30 programs in both modes, no fact
  differs from `isComplexValued()`; two programs decline. The structured
  route no longer calls `isComplexValued()` before the result assembly.
- Several helpers, and a helper that calls a helper; recursion is refused.
- A captured numeric value is a `capture` operation that carries the
  identity of its binding and the snapshot. The program lists its captures.
  A read of a live binding and a write of a captured binding are described
  in the doc comment of the operation and are not implemented.
- The measure is the section "After step 5 (2026-11-10)" of
  [the pilot measure](2026-11-09-js-structured-pilot-measure.md): no value
  differs on 52 programs; compilation takes 35% to 70% of the time of the
  ordinary target with the same options; no execution difference is
  resolved, also on `sqrt-repeat`, where the new route computes the square
  root four times and the ordinary target once (about 8 ns per call for
  both; the measure does not show why). The pilot is 2,474 counted lines, of
  which 566 are the core; the handlers of the existing emitter for the same
  operators are at most 942.

Not done in step 5: the `bigint` mode, which the fragment target still
refuses.

### Step 6 — Build useful numeric-kernel coverage

**Deliver in bounded slices:** numeric tuples and lists, indexing and explicit
layout; comprehensions/reductions; structured loops and loop-carried values;
then required early exits and collection updates. Let resolved real workloads
choose the order, rather than implementing every operator in the abstract.

**Fixtures:** scalar heat helpers first, then heat/traffic state transitions;
Burning Ship/Julia-style iteration; Othello scalar scans before its whole action
pipeline; Buddhabrot kernel and histogram reduction as separate cases.

**Pass when:** static shape and absence contracts hold; old-state/new-state
semantics, aliases, evaluation order and loop limits are explicit; selected
product fixtures agree with independent oracles. Do not equate list shape with
fixed length or numeric vocabulary with purity. Each extension gets its own
admission boundary before another is added.

**Result of step 6 (2026-11-10).** The three changes of
[the design of step 6](2026-11-10-structured-ir-loops-and-lists.md) are
done.

- 6a (`111ef6da5`): a `loop` over an integer range, with each carried value
  a parameter of its body region and a result of the loop; a loop with an
  iteration budget records that it can abort; `LessEqual`, `Mod`, `Floor`,
  `Divide`, `Power` with the exponent 2, and integer `let` locals.
- 6b (`567f7d53f`): lists of numbers as inputs and parameters, read with
  `at` and `length`. `heatneighbor` compiles.
- 6c part 1 (`6f4d798e4`): lists that the program makes (`build` for a
  comprehension over a range, `replace-at`), as a local, a carried value, the
  value of an `If`, of a helper and of the program; the update in place is
  decided on the representation (`inPlaceUpdates()` in
  `structured-in-place.ts`). `heatstep` and `heatpaint` compile, with one
  array per call of `heatstep`.
- 6c part 2 (`4afbbd167`): `analyzeExecution()` in `structured-execution.ts`, internal,
  with no compile option: whether two calls can run at the same time,
  whether the code can be sent to a worker, and for each loop whether its
  iterations are a candidate to run in any order (a pure body whose only
  carried values are lists updated at the loop index and not read). A
  candidate says whether its initial list must be copied once, and carries
  the run-time check `bounds-at-least-one` when the analysis cannot prove
  that both bounds of the range are at least 1.

Declines, each with a test: `heatseed`, which needs `exp`; `Break`,
`Continue` and a `Return` in a branch; a loop or a comprehension over a list,
and a loop with a step; nested lists; an index of the type `real` for `At`
or `ReplaceAt`; a helper whose definition states an effect. CE-1191 (the
rounding of a product with a local that holds an exact fraction is 1 too
small) is open and has the same limit on both routes.

The measure is the section "After step 6 (2026-11-10)" of
[the pilot measure](2026-11-09-js-structured-pilot-measure.md), one run:

- No value differs on 57 programs (1,034 inputs).
- Compilation takes 38% to 55% of the time of the ordinary target with the
  same options on the step 6 fixtures, and 79% on the corpus sample.
- `heatstep` runs in 53% of that time over 100 steps, with one array per
  call on both routes; `heatpaint` costs 6% against the default options
  (2% against the same options), seen once and not yet resolved.
- 16 calls of `heatstep` on a 128 × 128 grid in 2 and 4 workers give the
  values of the calls in sequence.
- The route is 4,874 counted lines (1,469 of them core); the handlers of the
  existing emitter for the same operators are at most 1,616.

The analysis answers, for `heatneighbor`, `heatstep` and `heatpaint`: the
calls are independent and the code is worker portable; the loop of
`heatstep` is a candidate, with the carried list `L` updated at the index
`k`, an initial list that this call made (no copy needed), no run-time
condition (both bounds, 1 and `N^2` with the capture `N = 32`, are proved at
least 1) and no abort. The other two have no loop.

**Prelude census (2026-11-10).** Each function of the preludes of Tycho's
showcases `burning-ship`, `multibrot`, `buddhabrot`, `julia-set`,
`game-of-life`, `apollonian-gasket`, `traffic-jam`, `othello` and
`heat-spread` (`~/dev/tycho/src/graph-paper/onboarding/`, read 2026-11-10),
executed with `executeEpsil()` and compiled on the structured route with
`cse: false, constantFold: false`. Before: 9 of 35 functions compile. After
the scalar numeric functions (`Exp`, `Ln`, `Sin`, `Cos`, `Tanh`, `Abs`,
`Arctan2`, `Power` with the exponent 1.5 and a base proved non-negative;
rows in [the emission rewrites](2026-11-09-js-pilot-emission-rewrites.md)):
12 of 35. `heatseed`, `roadstep` and `tone` compile now; every other function
still needs something of groups (b), (c) or (e).

| Showcase | Function | Compiles before | First refusal before | Library heads missing |
| --- | --- | --- | --- | --- |
| burning-ship | `B` | no | `Break` in a branch of an `If` | `Break`, `Abs`, `Ln` |
| multibrot | `M` | no | `Break` in a branch of an `If` | `Break`, `Arctan2`, `Power(s, d/2)`, `Cos`, `Sin`, `Ln` |
| buddhabrot | `step` | no | a `Loop` over `ParallelDomain(Range(1, n))` | `ParallelLoop`, `Tuple`, `Break`, `Abs`, `AddTo` |
| buddhabrot | `tone` | no (yes after) | `Power` with the exponent 1.5 | `Power(max(0, v), 1.5)` |
| buddhabrot | `c` | no | a body with local statements (`Block`) | `Rgb`; `Power(…, 1.5)` through `tone` |
| julia-set | `J` | no | `Break` in a branch of an `If` | `Break`, `Abs`, `Ln`, `Power(…, 1.6)` |
| julia-set | `pick`, `seg` | yes | | |
| julia-set | `channel` | no | a helper body with local statements (`Block`) | |
| julia-set | `shade` | no | `Rgb` | `Rgb` |
| game-of-life | `life` | no | `RotateLeft` (a sum of rotated lists) | |
| apollonian-gasket | `csqrt`, `fourth`, `tangent`, `seen`, `admitted`, `fill` | no | parameters of tuple types | `Tuple` (3), `List` (2), `ListJoin` (2), `Count` (2), `Abs` (4, 2 of them through a helper) |
| apollonian-gasket | `generations` | no | a parameter of the type `list<tuple<…>>` | `List`, `ListJoin`, `Take`, `Drop` |
| traffic-jam | `roadseed`, `roadstart`, `roadtrail` | yes | | |
| traffic-jam | `roadstep` | no (yes after) | `Tanh` | `Tanh` |
| othello | `ray` | no | `Break` in a branch of an `If` | `Break` |
| othello | `flips` | no | `NotEqual` | `NotEqual`; `Break` through `ray` |
| othello | `legal`, `stones` | no | a `Comprehension` with a guard | `NotEqual`, `Break` through helpers (`legal`) |
| othello | `hasmove`, `choosecell`, `play` | no | a `let` where the route reads a value (head `Dictionary`) | `Break` through helpers; `NotEqual` (`play`) |
| othello | `score` | no | the call of `stones`, which is refused | |
| heat-spread | `heatwall`, `heatneighbor`, `heatstep`, `heatpaint` | yes | | |
| heat-spread | `heatseed` | no (yes after) | `Power` with the base `ExponentialE` (`exp`) | `Exp` |

The missing heads by group, with the number of functions that each blocks
(directly or through a helper that the function calls):

- (a) scalar numeric functions: `Abs` 7, `Ln` 3, `Power` with an exponent
  other than 2: 5 (the exponent 1.5 with a non-negative base 2, `Exp` 1,
  1.6 with a base of unknown sign 1, the variable exponent `d/2` 1),
  `Arctan2` 1, `Cos` 1, `Sin` 1, `Tanh` 1. Done in this change: all but
  `Power` with the exponent 1.6 or `d/2` (`J`, `M`; both also need
  `Break`).
- (b) control flow: `Break` 10, a `Comprehension` with a guard 3 (`legal`,
  `stones`, and `score` through `stones`), a parallel loop
  (`ParallelLoop`, a loop over `ParallelDomain`) 1.
- (c) data: parameters of tuple types 7 (`apollonian-gasket`), `Tuple` 4,
  `List` literal 3, `ListJoin` 3, `Count` 2, `Take` 1, `Drop` 1, an update
  of a list element (`AddTo`) 1, `RotateLeft` and the sum of lists 1.
- (d) random: none.
- (e) other: `NotEqual` 3, a `let` where the route reads a value 3, `Rgb` (a
  colour result) 2, a helper body with local statements 2.

### Step 7 — Specify profiles and migrate individual consumers

**Deliver:** exact public numeric-kernel semantics, diagnostics, execution
requirements and canCompile/compile consistency before exposing a profile or
alternative target. Retain the two-profile direction; defer program-profile
rollout until its semantics and coverage are ready.

Migrate consumers one at a time behind explicit selection: numeric Map,
appropriate integration/solver paths, then selected Tycho plotting cells.
Preserve exact-tier integer guarantees, integrand retry/purity policy, solver
proof requirements and dependency invalidation. Interval enclosures stay on
their own lowering. Never infer consumer eligibility solely from profile success.

**Pass when:** each consumer's real contract is validated, unexpected declines
and wrong values are separately reported, and rollback is simple. Broader
corpus coverage is useful here. Public docs and examples must track the API.

**Result of step 7, first part (2026-11-10).** The
[profile spec](2026-11-10-js-numeric-kernel-profile-spec.md) is implemented:
`compile()` and `canCompile()` take `profile: 'numeric-kernel'` for
`to: 'javascript'`; a program outside the profile declines with the code
`outside-profile`; the result reports `profile`, `pure` and `shippable`. The
option is experimental and documented in `CHANGELOG.md`,
`docs/COMPILATION-MODEL.md` and the compile guide. No consumer has moved:
`Map`, integration, the solvers and Tycho use the existing compiler. Of the
35 functions of Tycho's prelude showcases, 12 compile under the profile (the
census above lists what blocks the others: `Break` first, then tuples).

**`Break` (2026-11-10).** [Design and result](2026-11-10-structured-ir-break.md),
commit `7227993d3128f94b7b1709b53390db4a31d78608`: an `exit` operation of the
representation. 14 of 35 prelude functions compile (`B` and `ray` are new).
Of the 10 functions that `Break` blocked, the other 8 now stop at: `Power`
with an exponent other than 2 or 1.5 (`M`, `J`), a `let` with a type
(`hasmove`, `choosecell`), a parallel loop (`step`), all measured after the
change; and, by the first refusals of the census table, not measured again,
`NotEqual` (`flips`), a guarded comprehension (`legal`), a `let` in a value
position (`play`).

**Othello helpers (2026-11-10).** `NotEqual` and a `let` with a type
(`ad4310b67f25316cc68eafba9fe2a593a1e6b787`), then a helper whose body has
statements: one admission (`admitFunctionBody()`) for the root and for a
helper, each helper one function of the program, not inlined; the lowering
and the core analyses did not change. A call of a helper declared
`-> integer` counts as an integer (the engine types it `integer | list<any>`
when an argument is a list), and the integer-only locals are kept per
function body. `flips`, `hasmove`, `choosecell` and `channel` compile: 18 of
35 prelude functions. Measured first refusals of the others that were tried:
`play`, the condition `!available` is not typed `boolean`; `c` (buddhabrot),
a block with statements as the value of an `If`; `legal` and `stones`, a
comprehension with a guard; `score`, the call of `stones`.

**`Power` for `M` and `J` (2026-11-10).** Three operations, `pow`, `abs-pow`
and `signed-pow`, each for one branch of the existing `Power` handler; the
table of branches is in
[the emission rewrites](2026-11-09-js-pilot-emission-rewrites.md). `M` and
`J` compile in the `strict` mode: 20 of 35 prelude functions. The 15 others:
tuples and the program-like functions of `apollonian-gasket` (7), a guarded
comprehension (`legal`, `stones`, `score`), `play`, `c`, `shade` (`Rgb`),
`step` (a parallel loop), `life` (`RotateLeft`). The user chose on
2026-11-10 to move a consumer next and not to add tuples
([proposal](2026-11-10-js-profile-first-consumer.md)).

### Step 8 — Add optimizations only with measured justification

Once stable value/region/effect contracts exist, consider pure-operation CSE
and reordering, then target-appropriate rewrites. This can happen between later
coverage slices when measurements identify a worthwhile case; it is not a
prerequisite for step 7.

**Pass when:** pure/non-pure paired tests demonstrate legality, dependencies and
conditional execution are preserved, numerical-policy constraints are respected,
and a new revision invalidates stale analyses. A proven benefit must outweigh
extra handlers and compile cost. Share JS/GLSL machinery only after both have
an actual need; do not force interval enclosure into scalar rules.

### Step 9 — Broader programs and replacement decision

Expand toward Epsil notebook/prelude requirements: broader collections, strings,
dictionaries and the necessary function/control-flow forms. Define the program
profile precisely and keep unsupported forms explicit. Do not promise complete
JS parity simply because numeric kernels work.

Before switching a default, measure vocabulary coverage, values/shapes, emitted
metadata, execution behavior and costs against representative clients. Keep an
explicit fallback/rollback at the caller boundary during rollout. Delete legacy
handlers only after their remaining users and contracts have migrated. CPS or
a general CFG is reconsidered only for a concrete requirement that structured
regions cannot express cleanly.

## Tycho execution work can proceed separately

The new JS emitter is not a prerequisite for shipping a useful Buddhabrot pool
integration: existing CE execution APIs already supplied the research route.
This is a separate cross-repository implementation decision, not part of the
next compiler patch.

1. Refresh the experiments against current CE/Tycho and the actual prelude
   service, including the iteration-budget/deadline contract.
2. Specify input/capture ownership, deterministic sample ranges, private
   histograms and reduction. Publish the histogram and cursor atomically only
   for the current request generation.
3. Integrate scheduling through the real document/prelude lifecycle. Exercise
   supersession, deadlines, navigation/disposal, worker failure and replacement.
   Verify child-worker cleanup rather than merely recording termination requests.
4. Validate every bin and cursor against serial/reference results; measure
   first-use latency, dispatch/transfer/merge, responsiveness and memory as well
   as warm kernel execution. Do not promise speedup below a measured threshold.
5. Roll out to the selected showcase before generalizing to other workloads.
   Heat/traffic disjoint-output work and Buddhabrot scatter/reduction need
   different ownership arguments.

## State and path forward (2026-11-10, end of the session that did steps 1 to 7)

A session that continues this work starts here. The older sections above
are the record of how each step was decided and measured.

### What exists

- **The structured route** of the JavaScript compiler: admission and typing
  (`javascript-fragment-target.ts`, `fragment.ts`), a representation with no
  target in it (`structured-ir.ts`, `structured-verify.ts`,
  `structured-in-place.ts`, `structured-execution.ts`), the JavaScript
  policy, lowering and emitter (`javascript-structured-*.ts`). It has
  scalars, conditionals, helpers with statement bodies, captures, loops
  over an integer range with `Break`, lists of numbers, and the `Power`
  forms of [the emission rewrites](2026-11-09-js-pilot-emission-rewrites.md).
- **The public option** `profile: 'numeric-kernel'`
  ([spec](2026-11-10-js-numeric-kernel-profile-spec.md)), experimental. A
  name with no declared type is a real number (`strict`) or a complex number
  (`complex`); the result reports `profile`, `pure`, `shippable`,
  `defaultedSymbols`.
- **The internal switch** `ce._jsProfile` / `CE_JS_PROFILE=numeric-kernel`
  ([proposal and results](2026-11-10-js-profile-first-consumer.md)):
  `implicitCompile()` tries the profile first and uses the existing compiler
  on a decline. Off by default. With it on, the full suite gives the same
  results, and the profile admits 4,627 of 6,211 of the engine's own
  compilations.
- **Coverage on Tycho's prelude showcases**: 20 of 35 functions.

### Decisions of the user that stand

- The representation is general: no target in the core, one definition per
  value, effects that name what they touch; it must be able to serve other
  targets, concurrency and optimizations ("Objectives for the
  representation", above).
- For each admitted program, the value equals the interpreter's within the
  caveats and the doubles equal those of the existing compiler with
  `cse: false, constantFold: false`; a form that cannot meet this declines.
- The profile ignores `cse` and `constantFold` while it is experimental.
- The switch stays **off by default** (2026-11-10). No consumer has the
  profile by default.
- The order of work: more coverage of the numeric kernel first, then the
  more general `program` profile (step 9).
- The guidance for a host of `compile()` will be: give type information, or
  call `ce.infer()` before `compile()` (stated by the user 2026-11-10; the
  binding-units work of `docs/plans/2026-11-09-binding-units-model.md` makes
  boxing stop writing inferred types).

### Next work, in order

1. **Operators that the engine's own compilations need**, from the counters
   of the switch (the most frequent declines of limit probes: `Erf` 142, a
   `Power` form outside the profile 124, `Gamma` 33, `Root` 24; of the
   periodic-roots scan: `Tan`, `Haversine`, `Cot`; of stochastic equality:
   `Arcsin`, `Arccos`; `Sinh`, `Conjugate`, `LogGamma`). Each operator gets
   its row in the emission rewrites: the branches of the existing handler,
   and which the route admits. `Arcsin`, `Arccos`, `Arcosh`, `Artanh` and
   `Arcsec` need care: the existing compiler writes a real function for an
   untyped operand and a complex helper for a `real` one.
2. **Complex arithmetic** (a division with a complex operand, `Sin` and
   `Cos` of a complex value, mixed products): the complex retry of an
   integrand is admitted 10 times in 135.
3. **The prelude functions that still decline** (15): a comprehension with a
   guard (`legal`, `stones`, `score`), `play`, `c`, `shade` (`Rgb`), `step`
   (a parallel loop), `life` (`RotateLeft`), and the seven functions of
   `apollonian-gasket`, which belong to the `program` profile (recursion,
   lambdas, lists of tuples that grow).
4. **The `program` profile** (step 9): write its spec first, as for the
   numeric kernel.

After each change of coverage, run the measure below and record the two
numbers (engine compilations admitted, prelude functions that compile).

### How to measure

Run on 2026-11-10 in a clean worktree, under the box lock, each once with
and once without the two variables:

```
CE_JS_PROFILE=numeric-kernel CE_JS_PROFILE_STATS=<a new directory> npm test
node scripts/js-profile-stats.mjs <that directory>
```

The first must give the tallies of `npm test` alone; the second prints the
table of attempts, admitted and declined per consumer with the most
frequent messages. The prelude census has no script in the repository: the
table "Prelude census" above was made by compiling each function of the
nine preludes under the profile; `compile-javascript-profile.test.ts`
(`PRELUDES`) holds the heat, traffic, Othello and fractal preludes.

### Open points

- **`ce.infer()` and the profile.** The profile does not read an inferred
  type, and `ce.infer()` writes its types marked as inferred, so today a
  call of `ce.infer()` changes nothing for the profile: a name that is a
  list still needs `ce.declare()`. Once boxing writes no inferred type
  (binding units, flag `_bindingUnits`), a definition marked inferred exists
  only because the host called `ce.infer()`, `ce.assume()` or `ce.assign()`,
  and the profile can then read it without depending on the order of
  boxing. **Decided by the user 2026-11-10:** the profile ignores inferred
  types now, and reads a type written by `ce.infer()` once the binding work
  has landed (boxing writes no inferred type by default). Do not make the
  change before that: until then the profile cannot tell such a type from
  one that boxing wrote. The predicate is one function,
  `hasNoDeclaredType()`; the change also needs the spec, the model document
  and the guide to say "declare, or call `ce.infer()`". **Done (this
  change):** with `_bindingUnits` on, a type of a definition of the host's
  scopes is read as declared (`ce.infer()`, `ce.assume()`, `ce.assign()`);
  a parameter or a local keeps the default kind; with the flag off nothing
  changes. The result is in the spec, "Result of the later change".
- **Constant folding.** The profile folds no constant; against the default
  options of the existing compiler a result can differ in the last place.
  No test of the suite changed with the switch on. Decide before a consumer
  gets the profile by default.
- **The cost of the switch** (a second admission for each declined program)
  is not measured.
- **`mode: 'bigint'`** is refused by the profile.
- **Reviews.** Each change from `Break` on had a Claude and a Codex review.
  The loop header revision (`aa1cc105e`) and the last fix round of the
  execution analysis were checked by reading and tests only.
- **Issues found on the way**: `issues/CE-1191.md`, `CE-1193.md`,
  `CE-1194.md`.
- **Ideas, not recorded elsewhere**: remove the per-call arrow function of
  the existing emitter (about 30% of the time of `heatstep`); add the
  switch-on run to the nightly pipeline.

### How the work was done

One change per subagent in a linked worktree; a design note before a change
that adds an operation to the representation; a Claude review that runs
probe programs against the existing compiler, and a Codex review; the route
tests, the core suite and the type check before each commit; the full suite
with the switch off and on for a change that the consumers reach.

## Progress after the state above (2026-11-10 and 2026-11-11, second session)

The user's instruction for this session (2026-11-11): work without
check-ins toward the point where the existing JavaScript compiler can be
retired and replaced by the structured one. Each design choice below took
the recommended option and can be reversed. No default changed: the switch
and the shadow measure are off, and no consumer has the profile by default.

### What was added

| Commit | Change |
| --- | --- |
| `c7adda0252d93f959847dcc1b52b19833b6a2ca7` | `Power` with the integer exponents 3 to 5 and −2, `Math.pow` for another constant exponent (`real-pow`), `Root` with the degree 3 or a degree that is not a literal |
| `5f5acea425bb8347bf401aa476b7fc23c0a94991` | `Tan`, `Cot`, `Sec`, `Csc`, `Sinh`, `Cosh`, `Arctan`, `Arsinh`, `Arcsin`, `Arccos`, `Arcosh`, `Artanh`, `Gamma`, `Erf`, `Erfc`, `Digamma`, `Sign`, `Ceil`, `Round`, `Conjugate`, `Haversine`, `Log`; `Sin`, `Cos`, `Tan` of `π·u` |
| `4422cd7bf64eca17935bd7655e6a5f0a972a3199` | A call of a user function with no declared signature, by the rule of the root; the body of a helper is rewritten for `ce.angularUnit` (it was compiled in radians) |
| `07a20e284a8282d60f158840c7cb69f3262d571f` | The shadow measure (`CE_JS_PROFILE_SHADOW=1`, [description](2026-11-10-js-profile-first-consumer.md)) |
| `29ee7c0f7aa216b3c5bf05b125393ef6b4a5828c` | Complex arithmetic ([design and result](2026-11-10-structured-complex-arithmetic.md)) |
| `6ac31a524af52fecc8744852886ebaba2fac18c8` | `Which`, `If(c, v)` as a value, `Sum` and `Product` over `Limits` clauses |
| `6ebc2b1574cd75487533e999288fe7339ea71228` | `Power` and `Root` of two number literals; a `Block` at the root; a real product with a quotient factor evaluated as the existing code does (the doubles differed in the last place before); refusals for nodes that the existing compiler puts on the complex lane |
| `a50de59f9910c56ab46f95d85f71d1c5edc60ddb` | The random differential tester `scripts/js-profile-fuzz.ts` ([description](2026-11-10-js-profile-first-consumer.md)) |
| `1c448807b4e9fc40fbb33c2b72babd151cb505a7` | A subexpression reached several times is lowered once ([design and result](2026-11-11-structured-shared-subexpressions.md)); CE-1198 fixed |
| `eac9ab939ef63e0914ba506454feb3d821c293ed` | Names declared `number` ([options and bindings](2026-11-11-structured-options-and-bindings.md), slice 1) |
| `1652626570dcdbb481e5ec15f5ccd890ce1b4113` | Effectful operations: `Random` and `WithRandomSeed` ([design and result](2026-11-11-structured-random-and-effects.md)) |
| `50e3e41a43ba6c1febb9b5f291a78d2e6bc28feb` | Fixes of the classes that the random tester found (a local has its declared type; nested quotients; refusals) |
| `775bc003b8ae9fcb40a0766fd62e2b5b40163759` | The options `vars`, `functions`, `operators`, `imports`, `preamble` (options and bindings, slices 3 to 5) |
| `595af0206767dcc4b416d5b24ec1a49ed7eab54c` | Nested blocks, blocks as operands, implicit locals, local functions, helpers declared `function` (options and bindings, slices 2 and 6) |
| `d221dfaf6e34746686e2a82d32b1d055991ca73d` | A type written by `ce.infer()`, `ce.assume()` or `ce.assign()` is read as declared; a value assigned after boxing is read |
| `950f70f962bbf39e14786091dca564835e5a4dc1` | List and tuple values ([collections](2026-11-11-structured-collections-and-lambdas.md), slice 1) |
| `5906581bb5a63ffcf49a8266fce9c0e173f7d3ae` | Chained comparisons, helper parameter types from a signature, `Factorial` and other scalar heads, complex `Power` with a non-literal exponent |
| `3177128edc798982b7a349dbeade87a27c20d1d9` | Functions of lists; `Map`, `Filter`, `Count`, `Reduce`, `Scan`, `Apply` with a function literal or a library operator (collections, slices 2 and 3) |
| `4c0828dff198102e1f8c737c346c63ce3959f325` | The compile mode `mode: 'bigint'` in the profile ([bigint mode](2026-11-11-structured-bigint-mode.md), slices 1 and 2) |
| `d89290f1b82fafad8e16cdc8db807176a3d5cdfe` | The bigint mode: sums and products, user functions, lists of integers, a root function literal (slices 3 to 5) |
| `114403d0b44156730f1f943b12362d0c74f90fc8` | User functions as function operands, `Range` with a step, lists of tuples, rotations (collections, slices 4 and 5 in part) |
| `52164aa7fdbfe853d332b34c0aabadde54424c01` | CE-1216, a fix of the existing compiler: the closed form of a derivative is written in parentheses |
| `f56cd5f2908d403d9990aeb1171eee2a726b37b5` | Integrals and derivatives with a closed form ([numeric calculus](2026-11-11-structured-numeric-calculus.md), slice 1) |
| `5d5060724e7de7caaca5192bb56fa7ed5c89143d` | Names and list elements typed `number` read as reals in the default mode; helper parameter types from the signature |
| `5fc85eda6867e8e607b4262ca22afb52619747d0` | Captured lists as program constants, folds of nodes that read no input, `Mod(x, 1)`, unread parameters |
| `4e960b7d6303570be4889d82e7ecd32b7e051529` | Lists of lists ([nested lists and matrices](2026-11-11-structured-nested-lists-and-matrices.md), slice 1) |
| `9c71e6bcb799b61e4be32ce9c2de28eb4d3277e5` | Integrals with no closed form: the `routine` operation (numeric calculus, slice 2); the rule for a `Sum` whose term can throw |
| `4790e085732832cd9e528cc11f759b8f9e8db89d` | One copy before a loop, then updates in place; rows updated in place when a list owns its rows |
| `0eb9d4778988822bcb042e08dc984d460923e8c5` | 43 scalar library heads; `If`/`Which` with a constant condition; one bound-name mechanism |
| `edf0c42631a479230ffbb04bcd33d745725ceeed` | Matrix functions, element-wise arithmetic and folds of lists of lists, products by type (nested lists and matrices, slices 2 to 4) |
| `a17a2632cc7df307eebd7c5fcba5e747940506b8` | Library functions of flat lists: orderings, searches, statistics, gathers, real indexes and counts |
| `99cee49c8926048d73e590a0274567b9290e8bcc` | Numeric derivatives, limits, the log-space form and sampled integrals (numeric calculus, slices 3 and 4) |
| `984f3e66014c1b44c03948ff097781550c6562fd` | Stored values that are expressions, captured lists of lists, captured complex numbers |
| `edca7ea41c820407343c8b1ee1fc41263bb35f8c` | Scalar heads applied to each element of a list, lists of booleans, `If`/`Which` with a list condition ([broadcast](2026-11-12-structured-broadcast-over-lists.md), slices 1 and 2) |
| `eca1a53ca353095480b9270c3039666fdd3102fc` | The admission is linear in the distinct nodes of a shared tree |
| `60e81ebee8e44d5770cac2f91b98fbbcc0a6e49b` | Loops over several index sets, comprehensions with several generators, tuple writes, `Return`, `Continue`, default parameters |
| `d45c14e4649588aeffcd0dd0ce56cf6643fd24a3` | A user function applied to each element of a list, sums of lists, `Max`/`Min`/`Equal` with lists (broadcast, slices 3 to 5) |

Each source change had a Claude review with probe programs and a Codex
review, except the shadow measure (Codex, and a reading of its hook).
`LogGamma` stays declined: the existing compiler has no JavaScript code for
it either.

### The two numbers

Engine compilations admitted (`CE_JS_PROFILE=numeric-kernel`, full suite in a
clean worktree):

| Commit | Admitted | Tests |
| --- | --- | --- |
| `04c9bd783279d05a2d60eb13a1f281a06731ebf8` (start) | 4,621 of 6,203 (74%) | 82,947 passed, 1 timeout (CE-1197) |
| `5f5acea425bb8347bf401aa476b7fc23c0a94991` | 5,335 of 6,199 (86%) | 83,326 passed, 1 timeout (CE-1197) |
| `4422cd7bf64eca17935bd7655e6a5f0a972a3199` | 5,375 of 6,192 (87%) | 83,353 passed, 0 failed |
| `6ac31a524af52fecc8744852886ebaba2fac18c8` | 5,614 of 6,204 (90%) | 83,671 passed, 1 failed (CE-1186, a known flaky test) |
| `eac9ab939ef63e0914ba506454feb3d821c293ed` | 8,711 of 9,234 (94%) | 85,729 passed, 0 failed |
| `775bc003b8ae9fcb40a0766fd62e2b5b40163759` | 8,907 of 9,427 (94.5%) | 85,906 passed, 0 failed |
| `595af0206767dcc4b416d5b24ec1a49ed7eab54c` | 8,923 of 9,428 (94.6%) | 86,022 passed, 1 failed (CE-1197, the timeout under load) |
| `950f70f962bbf39e14786091dca564835e5a4dc1` | 8,973 of 9,446 (95.0%) | 86,191 passed, 1 failed (CE-1197) |
| `5906581bb5a63ffcf49a8266fce9c0e173f7d3ae` | 8,961 of 9,433 (95.0%) | 86,639 passed, 0 failed |
| `4c0828dff198102e1f8c737c346c63ce3959f325` | 8,955 of 9,426 (95.0%) | 86,995 passed, 2 failed (CE-1197; CE-1186, the formatter's stack overflow, which passed in the shadow run on the same content) |
| `114403d0b44156730f1f943b12362d0c74f90fc8` | 8,958 of 9,430 (95.0%) | 87,201 passed, 1 failed (CE-1197) |
| `5d5060724e7de7caaca5192bb56fa7ed5c89143d` | 8,964 of 9,424 (95.1%) | 87,356 passed, 1 failed (a 2 s time limit of `dag-shared-walks.test.ts`, at 2.4 s on a loaded machine) |
| `4790e085732832cd9e528cc11f759b8f9e8db89d` | 9,188 of 9,545 (96.3%) | 87,731 passed, 0 failed |
| `edf0c42631a479230ffbb04bcd33d745725ceeed` | 9,202 of 9,552 (96.3%) | 89,402 passed, 0 failed |
| `99cee49c8926048d73e590a0274567b9290e8bcc` | 9,366 of 9,719 (96.4%) | 89,648 passed, 0 failed |
| `2053dc1a4c89badaff53fda9ba1a56c22a529222` | 9,368 of 9,720 (96.4%) | 90,651 passed, 0 failed |

The switch-off run at `4422cd7bf64eca17935bd7655e6a5f0a972a3199` failed only
on the timeout of CE-1197, which does not depend on the switch. The prelude
census was not run again: none of these changes is in the list of what blocks
the 15 prelude functions.

### The gap to retirement: every JavaScript compilation of the suite

The shadow measure over the full suite, at three commits (compilations that
the existing compiler compiles, and those of them that the profile admits):

| Commit | All | Public `compile()` calls |
| --- | --- | --- |
| `07a20e284a8282d60f158840c7cb69f3262d571f` | 8,465 of 22,739 (37%) | 3,070 of 16,539 (19%) |
| `6ebc2b1574cd75487533e999288fe7339ea71228` | 15,704 of 27,945 (56%) | 7,009 of 18,724 (37%) |
| `eac9ab939ef63e0914ba506454feb3d821c293ed` | 17,057 of 29,322 (58%) | 8,338 of 20,094 (41%) |
| `775bc003b8ae9fcb40a0766fd62e2b5b40163759` | 17,384 of 29,256 (59%) | 8,475 of 20,035 (42%) |
| `595af0206767dcc4b416d5b24ec1a49ed7eab54c` | 17,758 of 29,450 (60%) | 8,828 of 20,225 (44%) |
| `950f70f962bbf39e14786091dca564835e5a4dc1` | 18,130 of 29,684 (61%) | 9,171 of 20,462 (45%) |
| `5906581bb5a63ffcf49a8266fce9c0e173f7d3ae` | 19,696 of 30,429 (65%) | 10,733 of 21,204 (51%) |
| `4c0828dff198102e1f8c737c346c63ce3959f325` | 20,959 of 31,049 (67.5%) | 11,989 of 21,817 (55%) |
| `114403d0b44156730f1f943b12362d0c74f90fc8` | 21,438 of 31,283 (68.5%) | 12,464 of 22,046 (56.5%) |
| `5d5060724e7de7caaca5192bb56fa7ed5c89143d` | 22,035 of 31,522 (69.9%) | 13,059 of 22,291 (58.6%) |
| `4790e085732832cd9e528cc11f759b8f9e8db89d` | 23,293 of 32,323 (72.1%) | 14,097 of 22,974 (61.4%) |
| `edf0c42631a479230ffbb04bcd33d745725ceeed` | 24,717 of 33,396 (74.0%) | 15,519 of 24,053 (64.5%) |
| `99cee49c8926048d73e590a0274567b9290e8bcc` | 25,568 of 33,800 (75.6%) | 16,198 of 24,280 (66.7%) |
| `2053dc1a4c89badaff53fda9ba1a56c22a529222` | 26,767 of 34,782 (77.0%), a lower bound: the run did not finish in 50 minutes | 17,395 of 25,262 (68.9%), same run |

The number of compilations grows because each change adds tests. The table
of causes below is the first measure; the design notes of 2026-11-11
(collections and lambdas, the `bigint` mode, options and bindings, `Random`
and effects) hold the witnesses of each cause.

The shadow measure at `07a20e284a8282d60f158840c7cb69f3262d571f` (before the
complex arithmetic), full suite: of 22,739 JavaScript compilations that the
existing compiler compiles, the profile admits 8,465 (37%); of the 16,539
that are not the engine's own (`public`), 3,070 (19%). One test fails with
the measure on, as expected: it asserts that the default route never calls
the profile. The declines by cause, most frequent first:

| Count | Cause | State |
| --- | --- | --- |
| 1,429 | `Power` or `Root` with a negative number literal base | in progress |
| 837 | a `Block` at the root | in progress |
| 729 + 123 | `Sum`, `Product` | in progress |
| 572 + 64 | `Random`, `WithRandomSeed` | needs effect facts on the operation (objective 3) |
| 560 | a free name with no numeric type | |
| 469 | `mode: 'bigint'` | needs a design |
| 394 + 101 | parameters with no declared type or of another kind | in progress |
| 326 + 202 | a helper whose declared result is not a number or a list of numbers; a helper declared `function` | |
| 323 + 160 | a list literal; a tuple | `program` profile |
| 313 + 118 | the options `vars`, `functions` | |
| 272 + 264 + 207 | `Map`, `Reduce`, `Apply` | lambdas: `program` profile |
| 235 | `Which` | in progress |
| 208 | `Integrate` | the existing compiler calls the interpreter's quadrature |
| about 500 | list inputs of another type (`list<number>`, tensor, matrix, nested) | |
| about 450 | linear algebra and colours (`Norm`, `Dot`, `Determinant`, `ColorToString`, `GamutMap`, `AsRgb`) | |

In 17 compilations the profile admits a program that the existing compiler
declines; they are not yet examined.

### The nightly run (2026-11-11)

Two failures of the nightly full run, both closed: `nightly/js-parity-fuzz.test.ts`
failed since `627ed80e1` (binding units on by default: the existing compiler
declines the untyped inputs of the test) and was fixed by the binding-units
session in `f4fe063f7`; `js-profile-fuzz.test.ts` exceeded its 60 s setup
limit in a full run on a loaded machine at `950f70f96` and has 300 s limits
since `e4f3d8895fbdd4bdcde633b21ad9fc4d50c905ae`. Release 0.187.0
(`292613616086f88e799dfd2ccfecd69cb408f887`) holds the work up to
`950f70f962bbf39e14786091dca564835e5a4dc1`.

### The random differential tester

`scripts/js-profile-fuzz.ts` (options `--random`, `--host`, `--deg`)
compares the profile with the existing compiler and the interpreter on
random programs. On each commit from `50e3e41a43ba6c1febb9b5f291a78d2e6bc28feb`
on, runs of 20,000 to 50,000 programs report no internal failure and no
difference of value, shape, draws or host calls from the existing compiler,
except the existing compiler's defect CE-1203 and one documented crafted
shape difference (`docs/COMPILATION-MODEL.md`, the limits of names with no
declared type). Every change of coverage ends with such a run.

### What blocks retirement beyond coverage

- **Shared subexpressions (CE-1198).** The route walks an expression as a
  tree: a subexpression that is shared at each of 40 levels does not finish.
  The existing compiler binds it once (CSE). The route needs a lowering that
  gives one value to a pure node reached twice in the same region.
- **Options the profile ignores or refuses**: `cse`, `constantFold`
  (results can differ in the last place from the default options of the
  existing compiler), `mode: 'bigint'`, `vars`, `functions`, `operators`,
  `imports`, `preamble`, `broadcast`.
- **The other targets** (`interval-js`, GLSL, WGSL, Python) use the existing
  compiler's shared code; retiring the JavaScript emitter does not remove
  that code.

## Where each remaining item of the original proposal is done

The [original proposal](2026-11-08-javascript-fragment-migration.md) asks for
these items. None is part of steps 1 to 4, except where the table says so.

| Item of the proposal | Step |
| --- | --- |
| Separate counts of accepted programs, declines, emitter failures and interpreter fallbacks | 3 and 4, then each later step |
| Source size of the new code | 4 |
| `bigint` mode with its non-finite result | 5; the fragment target refuses the mode until then |
| One transformation applied on both JavaScript and GLSL, and measured | 8 |
| Matrix of profile, feature, mode and API | 7, before any consumer moves |
| A registered `javascript-fragment` target name (decision 1 of the proposal) and the audit of the code that compares target names | 7; no name is registered before |
| `canCompile()` gives the answer of `compile()` | 7 |
| Profile and requirements in the cache key and in the result | 7 |
| Batch, worker-pool and asynchronous routes | 7, per consumer |
| Allocations and bundle size | 7, per consumer |

## Course correction and the IR pipeline (2026-11-12)

The user withdrew the contract "equal the existing compiler" on 2026-11-12.
The structured route (`numeric-kernel`, 40,541 lines) is frozen: no new
admission rule. Its last measures, at
`154153fe307c9084587b86fb0f9dc364c040cc8c`: engine compilations 96.4%, every
JavaScript compile 77.7%, public compiles 69.9%. The contract that replaces
it and the audit are in `docs/plans/2026-11-12-js-route-course-correction.md`
(section 2 holds the user's decisions).

The replacement is the pipeline of `src/compute-engine/compilation/ir/`
(its `README.md` describes it): one operator table, one lowering walk that
declines by default, an SSA representation, passes, and one statement
printer with a syntax table per target (JavaScript and GLSL).

| Commit | Content |
| --- | --- |
| `8913dae82c0098918132a6a16789945f8fc4269a` | the pipeline, not wired (3,959 lines) |
| `7f6b2eeb6bb3a625c4eca09405b4741bdf63df1d` | `profile: 'ir'` in `compile()` through `ir/adapter.ts`; 4,403 lines |

Measures at `7f6b2eeb6bb3a625c4eca09405b4741bdf63df1d` (`CE_JS_PROFILE=ir`
and `CE_JS_PROFILE_SHADOW=ir`; the censuses are printed by
`scripts/js-profile-stats.mjs`):

| Measure | Admitted |
| --- | --- |
| Engine compilations | 8,086 of 9,729 (83.1%) |
| Every JavaScript compile | 12,107 of 38,225 (31.7%) |
| Public `compile()` calls | 4,021 of 28,496 (14.1%) |

No test fails in the shadow run and there is no internal error. With the
profile switched on, 20 tests of the worker-pool route fail (`find-fit-pool`,
`ce-424-425-findfit-async`, `ce-314-3-nested-pool`, `epsil/cli-workers`):
the values are equal, and the code of the profile cannot be sent to a worker
yet.

Largest causes of a decline in the shadow run: `mode: 'complex'` 6,378; a
declaration with no type or no value 1,094; `mode: 'bigint'` 1,027; a list
parameter of run-time length 910; a symbol with a value 568; `Root` 407;
`Erf` 368; `vars` 343; `Integrate` 333; a complex literal 326.

Next work: coverage in the order of that list, each step with the three
measures and the line count of the directory.

First coverage batch (28 real-function rows, more `Declare` forms, list
parameters of run-time length for a root function literal; an integer `Mod`
beyond the safe range throws). Measured in the worktree on the same patch;
4,579 lines:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 8,652 of 9,669 (89.5%) |
| Every JavaScript compile | 14,302 of 38,225 (37.4%) |
| Public `compile()` calls | 5,604 of 28,496 (19.7%) |

After it, `mode: 'complex'` stays the largest cause of a decline (6,378),
then a symbol with a value (650).

Second batch (a complex lane with `mode: 'complex'`, complex literals and
inputs; a name that holds a number or a list of numbers is lowered as its
value), on top of bound-once step 1
(`d2f392f08a39b831669fa22430ad853096f993ad`). The contract was loosened by
the user during this batch: no fidelity to the interpreter at ill-conditioned
points or for integers of 2^53 or more (rules 1 and 3 of the course
correction). Measured in the worktree; 4,900 lines:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 8,997 of 9,681 (92.9%) |
| Every JavaScript compile | 20,776 of 38,230 (54.3%) |
| Public `compile()` calls | 11,736 of 28,496 (41.2%) |

Largest causes after it: `mode: 'bigint'` 1,029; a list where a scalar is
required 471; `vars` 342; `Integrate` 336; a symbol with a value that is
not a number or a list of numbers 287; `Loop` 282. Missing structurally: the
code of the profile cannot be stored or sent to a worker (20 worker-pool
tests fail with the switch on).

Third batch (the marking of integers of 2^53 or more deleted; `Loop` over a
list or a range; `iterationBudget` by the public rule; the `vars` option;
`Integrate` of one variable through the engine's quadrature routine). First
measures on the code that holds bound-once step 1; 5,083 lines:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 9,216 of 9,680 (95.2%) |
| Every JavaScript compile | 21,596 of 38,219 (56.5%) |
| Public `compile()` calls | 12,338 of 28,489 (43.3%) |

Largest causes after it: `mode: 'bigint'` 1,029; a list where a scalar is
required 479 (six different constructs, the largest a list used as a
condition); a symbol with a value that is not a number or a list of numbers
301; `Comprehension` 263; input type `any` 247; `Apply` 234; `Map` of a
function that is not a one-parameter literal 234; `Tuple` 233; `Reduce`
forms 213; the `functions` option 212.

Fourth batch, 2026-11-14 (code that can be stored and sent to a worker,
option A of `docs/plans/2026-11-12-ir-profile-shippable-code.md`). The
printer spells the runtime as `_SYS`; the result has `preambleOnce`,
`callCode`, `runtimeVersion`, `entryPlan`, `reconstructionDigits` and
`shippable`; the function tables of the pipeline moved to
`javascript-runtime.ts` under the one member `_SYS.ir` (most of their names
exist in `SYS_HELPERS` with another meaning), with a `tick()` member; the
local `run()` applies the `checkEntry()` and `normalizeRunResult()` of
`load()`, so a complex result with imaginary part 0 is the number in both
modes, at the root and in list cells. With the switch on, the 20 worker-pool
tests pass. One test fails with the switch on: the nested integral of
`compile-javascript-structured-calculus2.test.ts`, where the profile gives
0.0804194546574510 and the existing compiler and the frozen route give `NaN`
(CE-1267). No test fails in the shadow run and there is no internal error.
Measured in the worktree at `e51916c167ce04902a5775ec46df5887cfedf208` plus
the patch; 4,942 lines in `ir/`, and about 165 lines of the tables are now
in `javascript-runtime.ts`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,384 of 10,850 (95.7%) |
| Every JavaScript compile | 22,634 of 38,918 (58.2%) |
| Public `compile()` calls | 12,239 of 28,057 (43.6%) |

The batch adds no coverage: the counts differ from the third batch because
the suite changed. Largest causes of a decline: `mode: 'bigint'` 1,029; input
type `any` 233; the `functions` option 212; an input of type `tensor` 144, of
type `matrix` 121; a symbol with a value that is not a number or a list of
numbers 98.

Fifth batch, 2026-11-14 (`mode: 'bigint'`). Every integer is a JavaScript
`bigint`, printed by a second syntax (`JS_BIGINT`) over the existing `_SYS`
helpers of the mode; no new lane in the representation. Counters, lengths and
indexes are `bigint` too, converted with `Number()` where JavaScript reads a
number (the representation does not tell a counter from an integer value). A
real or complex value declines, also a quotient under a rounding function, a
comparison with a rational constant, `vars`, and a `Sum` or `Product` with
`iterationBudget`. A closed node is folded with `evaluate()` to the exact
integer. The mode runs with the passes `fold` and `hoist` off: its helpers
throw at a pole, and `hoist` evaluated a guarded operation before its guard
(review finding). A pole gives a `number` through one catch of
`_SYS.NonFiniteValue` around the entry. A decline keeps the code
`'outside-profile'`; the existing mode uses `'bigint-lane'`. Measured in the
worktree (main at `878d07625287235658c859a8f8ade102c9ed8043` plus batch 4 and
the patch); 5,119 lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,394 of 10,860 (95.7%) |
| Every JavaScript compile | 23,146 of 38,919 (59.5%) |
| Public `compile()` calls | 12,751 of 28,057 (45.4%) |

No test fails in the shadow run; with the switch on, the one test of CE-1267
fails as before. Largest causes of a decline: input type `any` 233; the
`functions` option 212; an input of type `tensor` 144, of type `matrix` 121; a
symbol with a value that is not a number or a list of numbers 98; a rational
literal in the bigint mode 94.

Tycho's first answer (session `tycho-desk`, 2026-11-14, on a build of
`0101917df900b4e44a3600d5070f96f94186b3e7`): its compile seam passes
`iterationBudget`, `inputs`, `symbolic`, sometimes `vars` and `storage`, all
mapped. Its four hot JavaScript plot paths pass `broadcast: true` and call
`result.broadcast()` or `result.broadcastAsync()`; its Prelude calls
`result.runAsync()` for `parallel for`. The profile declines `broadcast: true`
and has neither method: this is the next batch. The profile is not wired for
GLSL in `compile()`.

Tycho's first audit (session `tycho-desk`, 2026-11-14; build of
`0101917df900b4e44a3600d5070f96f94186b3e7`, Tycho `1fdc91e95` with a scratch
patch that tries `profile: 'ir', fallback: false` first at its one JavaScript
compile seam and compares every call of an admitted `run` with the existing
compiler's, 1e-12 relative). CORE codegen audit (24 Desmos states and the
showcase entries): 997 JavaScript compilations, 130 admitted (13%), 867
declined, no `compile-error`, 106 calls compared, no difference. The 16
seeded-random test files and `seeded-random-list-fan`: 696 of 696 pass, 640
compilations of which 22 admitted, 4,113 calls compared, no difference, no
`seeded-draw-order` warning. The audit took 33.5 s without the profile and
33.3 s with it (box lock held, load 2.6 to 2.9). Causes of a decline in the
audit:

| Declines | Cause | Witness |
| --- | --- | --- |
| 177 | `Tuple` | `Tuple(Cos(t), Sin(t))` |
| 171 | the option `broadcast` | `At(H, Floor(x) + N·Floor(y) + 1)` with `broadcast: true` |
| 100 | a function that reads an input (a capture) | `TychoCertificate55()` reads `n`, with `symbolic: [..., 'n']` |
| 86 | `PointList` | `PointList(xs(t), ys(t))` |
| 70 | an input of type `list<nan \| real \| signed_infinity>` | `Cos(2·Pi·At(S, J)/L)` |
| 68 | `Comprehension` | a list of `Tuple`s over `k` |
| 54 | `AsOklab` | `AsOklab(Which(…, Oklch(…), …))` |
| 53 | `Declare` with `constant` | `Block(Declare(L, {value: 240, constant: True}), Tuple(L))`, every Prelude statement |
| 40 | a list parameter of a user function | `legal(B, At(B, 65))` |
| 20 | an input of type `nan \| real \| signed_infinity` | `sigma·(At(S, 2) − At(S, 1))` |
| 16 | `Degrees` | `Sin(Degrees(h_0))` |
| 12 | others | `Polygon`, `Segment`, `Cot` of a complex, `ListJoin`, `GCD`, a `vars` name in a function, a `list<tuple>` input |

In the seeded tests the largest causes are list inputs (196), `Comprehension`
(175) and `broadcast` (95). `runAsync` is reached by the Prelude statement of
buddhabrot, `Block(Declare(H_1, {value: step(H_0, 1200000), constant: True}),
Tuple(H_1))` with `symbolic: ['H_0']`, whose `parallel for` is in the body of
`step`; it declines at the `Declare` today.

Sixth batch, 2026-11-14 (the batch and asynchronous members). An expression
result of the profile has `broadcast()`, `broadcastAsync()`, `willUsePool()`,
`runAsync()` and `willParallelize()`, built by the generic functions that the
existing target calls, over the profile's raw per-cell call and its entry
plan; `broadcast: true` is admitted and builds no batch body; there is no
asynchronous copy of a program, so `runAsync()` resolves to `run()`. A `vars`
text of the form `_.name` keeps the code shippable. In the shared batch code
(`broadcast.ts`) a timeout or a spent step budget inside a cell now stops the
batch, for both compilers: the loops of profile code check the deadline, and
a timeout was written as a NaN cell (review finding). `broadcastStrideOfType`
moved to `compiler-type-facts.ts`.

Seventh batch, 2026-11-14 (four causes of Tycho's list). An input whose type
is a union of real types, `nan` and infinity types (`nan | real |
signed_infinity`), scalar or the element of a list, is on the real lane. A
`Declare` with `constant` is admitted and an `Assign` to a constant local
declines. An input of the compilation that the body of a called function
reads is passed to the function as an extra parameter at each call,
transitively; its type is the one the scope of the compilation gives the
name, an occurrence of another type declines, and a recursive function that
reads an input declines (review findings). `Degrees` (radians only) and `Cot`
(real and complex) are rows. Measured on batches 6 and 7 together, in a
worktree at `06801243de79925cd9b0804d45404aa26fea2a8a` plus the two patches;
5,362 lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,394 of 10,855 (95.8%) |
| Every JavaScript compile | 23,352 of 38,934 (60.0%) |
| Public `compile()` calls | 12,949 of 28,069 (46.1%) |

No test fails in the shadow run; with the switch on, the one test of CE-1267
fails as before.

Tycho's second run (2026-11-14, on a build of these two batches): CORE audit
428 of 997 JavaScript compilations admitted (43%), no `compile-error`, 2,996
calls compared with no difference; the seeded-random tests 694 of 696 (the
two failures are budget tests whose loop result is not read, which the
profile removes), 200,287 calls compared with no difference; all 314 files
of its plot tests with the profile first: 1,354 of 1,943 compilations
admitted. A 400 × 400 batch: a shared-list read 1.11 and 1.33 ms on the
profile against 1.60 ms on the existing compiler, arithmetic 2.08 against
2.11 ms (load 2.0). Largest causes of a decline in the audit: `Tuple` 213,
`Comprehension` 88, `PointList` 86, `AsOklab` 54, a list parameter or list
result of a function 49, an element-wise sum of lists of different run-time
lengths 15, a `vars` name in a function 18, `ElementMax` 8, `Break` 5. Its
findings, taken into a batch of fixes: an internal error of the verifier
(`Min(Map(k ↦ Sum(k, k = 1..3), [10, 20]))` with `iterationBudget`); a wrong
value for Tycho, whose in-place `compile` handler on the definitions of `At`
and `Which` (the Desmos index floor) the profile did not call, so a head
whose definition has a `compile` handler or `compileHelpers` must decline;
`Sqrt(-x² - 1)` in the strict mode was NaN where the interpreter gives `i`.

Eighth batch, 2026-11-14 (`Tuple`, `PointList`, `Comprehension`, list
parameters). A tuple is the fixed-length list of its elements in the
representation; the lowering records which values are tuples, and
`TUPLE_RULES` names the operators that read a tuple with the interpreter's
value (any other reader declines). `PointList` is the tuple of scalar
components or a build of tuples over list components. A `Comprehension` of
one `Element` clause over a list or a `Range`, with an optional condition,
is a build, or a filter then a build; one with an effect declines (the
interpreter's is lazy). A list parameter of a user function compiles, a
run-time length being a hidden parameter before the list; a list result of a
user function declines. A sub-expression of the static type `error`
declines (review finding).

Ninth batch, 2026-11-14 (the findings of Tycho's second run). The `fold` and
`strength` passes replace a value only by one of the same lane (the internal
error). A head whose definition has `compileHelpers`, or a `compile` handler
that is not the standard library's own function for that name, declines
(`hasOwnLowering()`), also a `Range` read as a list source. In the strict
mode `Sqrt`, `Ln`, `Log`, and `Root` and `Power` where the real function is
NaN, of an operand the engine proves negative take the complex signature. A
`vars` name whose text reads the inputs object and that a function body
reads is passed as a parameter. Measured on batches 8 and 9 together, in a
worktree at `06801243de79925cd9b0804d45404aa26fea2a8a` plus batches 6 to 9;
5,678 lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,441 of 10,858 (96.2%) |
| Every JavaScript compile | 23,627 of 38,928 (60.7%) |
| Public `compile()` calls | 13,187 of 28,069 (47.0%) |

No test fails in the shadow run; with the switch on, the one test of CE-1267
fails as before. Largest causes of a decline in the suite: input type `any`
233; the `functions` option 212; an input of type `tensor` 144, of type
`matrix` 121; a symbol with a value that is not a number or a list of
numbers 102; a rational literal in the bigint mode 94; a complex infinity
87; an input of type `list<list<real>>` 128.

Tycho's third run (2026-11-14, build of
`3927b6c89ac284a5088a752718937455ac3c8a23`, Tycho `0ffbde4e2` with its scratch
patch; load 13 to 32 on 18 cores): no internal error. CORE audit 465 of 997
JavaScript compilations admitted (47%), 2,971 calls compared with no
difference. Seeded-random tests 694 of 696 (the two budget tests), 208 of 638
compilations admitted, 200,324 calls with no difference. Plot tests (314
files): 1,523 of 1,992 compilations admitted; 2,127,339 `run` calls and 2,519
`broadcast` calls compared, 12 differences in 7 expressions, each one where
the existing compiler is wrong (`Sqrt(s)` at -4 in the complex mode, `z² + a`
with a complex input, an `Abs` that it drops from a declared range) or a
pole. The index-floor test passes again. No admitted result reaches a field
the profile lacks. Causes of a decline in the audit:

| Declines | Cause |
| --- | --- |
| 179 | `Which` (101) and `At` (78): Tycho's in-place `compile` handler; 96 of them in 23 native documents, 83 in 6 Desmos imports (Tycho installs the handler on every engine) |
| 92 | a user function that returns a list (`legal` of othello) |
| 94 | `Sin` (59) and `Cos` (35) with the angular unit in degrees (one Desmos document, `art/n7uhaaoq1q`) |
| 54 | `AsOklab` |
| 18 | an input of type `list<tuple<integer, real, real, integer>^n>` |
| 15 | an element-wise sum of lists of two run-time lengths |
| 14, 14, 10, 5, 5, 5 | `Comprehension`, `ElementMax`, `If`, `Break`, a tuple in a local, a `Range` of reals |

Without the handler on `At` and `Which` the audit would admit about 644 of
997 (65%).

Render audit of the same run (Tycho's CORE corpus, 24 states, the page run
without and with the profile on one Tycho build whose engine bundle is the
build's): no document renders differently. 21 states rendered and 3 did not
paint on both arms (the software-WebGL 3-D states); series count, chromatic
and dark fractions are equal on all 24; one non-background fraction moves by
0.02% of the pixels, within the noise of that state. The page tally shows
the profile active (for example 69 of 114 JavaScript compilations admitted
on `neyret/oeupgr064p`). Batch control, 160,000 cells: 2.19 and 2.20 ms on
the profile against 2.23 ms on the existing compiler (load 24 to 26). A next
render run costs Tycho about 14 minutes of running.

Tenth batch, 2026-11-14 (causes of Tycho's third run). A union of one type
with `nan` or `missing` members is that type for an input, a parameter and a
result of a user function (`missing | rational` is a real: 42 of the 92
"function" declines; a `Missing` of the interpreter is NaN compiled). A local
declared with a list or tuple value and never assigned is bound to the value.
A `Tuple` at the root whose elements differ in shape or have a run-time
length is the entry's several results, returned as an array (the form of
every Prelude statement). A user function may return a list of rank 1: a call
has two outs, the length and the list, and the printer reads the length of
the returned array; a tuple result and a recursive call of such a function
decline. The trigonometric rows under an angular unit other than radians
multiply their operands, or the result of an inverse function, by the
constant of the unit, on both lanes and on GLSL. Measured in a worktree at
`3927b6c89ac284a5088a752718937455ac3c8a23` plus the patch; 5,841 lines in
`ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,463 of 10,849 (96.4%) |
| Every JavaScript compile | 23,795 of 38,946 (61.1%) |
| Public `compile()` calls | 13,305 of 28,069 (47.4%) |

No test fails in the shadow run; with the switch on, the one test of CE-1267
fails as before. Left from Tycho's list: `AsOklab` (54), a `list<tuple>`
input (18), an element-wise sum of lists of two run-time lengths (15),
`ElementMax` and `ElementMin` of scalars (14), an `If` with a tuple arm and
no else (10), `Break` (5), a `Range` of reals (5).

Eleventh batch, 2026-11-14 (small causes of Tycho's third run). Rows
`ElementMax` and `ElementMin`, which thread over lists. An `If` with no else
arm whose arm is a tuple of numbers gives the tuple of NaN when the condition
is false, as the interpreter does. The upper bound of a `Range` may be a
real (`Range(1, 3.5)` is `[1, 2, 3]`). An element-wise operation on lists of
rank 1 of two run-time lengths compiles, the result having the length of the
first list: the interpreter gives an error that the static type does not show
when the lengths differ, so the compiled value is unspecified then. A length
that is a value is not compared with a stated length (a known limitation,
crafted: `Range(1, 2) + [1, 2, 3]`); the version that declined such programs
needed a prediction of the `fold` pass and a weaker verifier, and was not
kept. Measured in a worktree at `3ab43b3e2c3b8c075a0865f364a155dbefa2a66c`
plus the patch; 5,868 lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,485 of 10,860 (96.5%) |
| Every JavaScript compile | 23,899 of 38,930 (61.4%) |
| Public `compile()` calls | 13,414 of 28,069 (47.8%) |

No test fails in the shadow run; with the switch on, the one test of CE-1267
fails as before.

Colours (`AsOklab`, `Oklch`, `Rgb`; 54 declines of Tycho's audit), sized and
not built: an opaque lane as the complex one (the runtime's colour object on
JavaScript), about ten rows calling the existing `_SYS` helpers, an estimated
40 to 60 lines, declined on GLSL at first. Tycho's witness selects with
`Which`, which declines in a Tycho engine until its handler is gone, and its
colour expressions also pass one pure host function through the `functions`
option; both come first.

Tycho's requests for library operators after the decision below (CE-1320 a
masked read, CE-1321 a comparison of two lists by position, CE-1322 a `Which`
with the Desmos list broadcast) are closed with no operator: a `Map` or a
`Filter` over `Range(1, Min of the lengths)` gives the Desmos tables on the
interpreter and on both JavaScript compilers, Tycho's instrument passes with
those forms, and no row of its corpus (779 documents) has a mask that is a
list variable or a branch whose length only a value gives. Tycho rewrites
every Desmos row before it is evaluated or compiled, and removes its
`evaluate` and `compile` handlers of `At` and `Which` together: 207 index
sites need the floor rewrite, 659 have an integer index.

GLSL: the plan (2026-11-14, from a read of the existing GLSL target, of
`print-glsl.ts` and of Tycho's shader code; sizes are estimates). The engine
has no `wgsl` target. A GLSL result has no `run`: `code` is an expression, or
statements that end in `return`, in which an input is its bare name;
`preamble` holds the helpers and user functions; `freeSymbolTypes[name]
.lowered` is the uniform type (`float`, `vec2`, `float[5]`, …). The host
wraps `code` in its own function and declares the uniforms. Tycho compiles to
GLSL at 8 sites, reads `code`, `preamble`, `freeSymbols`,
`freeSymbolTypes[n].lowered`, `warnings` and `float32Bounds`, passes
`inputs`, `symbolic`, `vars`, `storage: {S: 'sampler2D'}` and, for the
colormap, `functions`, and renames helpers by the prefixes `_gpu_` and `_fn_`
to join two compilations in one shader. The printer of the pipeline already
gives the body, the functions and the helpers separately. Batches, in order:

| Batch | Adds | Estimate in `ir/` |
| --- | --- | --- |
| G1 | `profile: 'ir'` for `to: 'glsl'`: an adapter that gives the result contract for a scalar real expression of scalar inputs and declines the rest; bare input names; helpers and functions under the `_gpu_` and `_fn_` prefixes; a shadow measure of the GLSL `compile()` calls | 110 to 140 |
| G2 | a list of 2 to 4 reals is a `vecN`, as a result and as an input | 30 to 50 |
| G3 | `At` on a uniform array; the cap on loop passes | 30 to 50 |
| G4 | the profile tried first for GLSL in a Tycho build: its codegen and render audits on the GLSL seam | 0 |
| G5 | `storage` (a list read from a sampler) | 60 to 100 |
| G6 | colours, and the colormap function if `functions` returns | 80 to 160 |
| G7 | the complex lane as `vec2` | 150 to 250 |
| G8 | the default | 0 |

Not carried over from the existing GLSL target: the NaN-safe helpers and
the finite proof (1,796 lines), the exact sine hash with `float32Bounds`,
the fragment pre-check (2,066 lines), the hoisting of temporaries, the
copies of a user function per argument type, `callerLocals`, the shader and
function assemblers. Choices taken for G1 (reversible): an input is its bare
name (hosts declare and `#define` it); the direct `GLSLTarget` API and the
fallback of a decline stay on the existing GLSL target.

Batch G1, 2026-11-14. `compile(expr, { to: 'glsl', profile: 'ir' })` goes
through `ir/adapter-glsl.ts` (151 lines): the result contract of the existing
target for a scalar expression of scalar inputs, with bare input names, the
helpers under `_gpu_ir_` and the user functions under `_fn_ir_` (the existing
target has a `_gpu_round` of its own), `freeSymbolTypes` from the existing
target's own function; a list or tuple, a root function literal, `vars`,
`storage`, `functions` and a `Loop` with a budget decline. The WebGL value
tests ran: 18 programs assembled as a host does agree with the interpreter,
and a reviewer compiled 69 more in both host forms. The reserved-word table
of GLSL was completed (53 words), so the existing target also refuses an
input named `active`. The shadow measure counts the GLSL `compile()` calls
of the suite under `glsl:public`, and counts a compile with `inputs` once.

The first shadow run with GLSL exhausted the memory on one test file
(`ce-584-shared-subexpression-size.test.ts`): a shared node read in both
arms of an `If` is lowered once per arm, so a chain of such conditionals
doubles at each level, on both targets (4.2 MB of text and 18 s at depth 14).
The lowering now declines above 50,000 lowered nodes; the worst program
under the limit takes about 2.6 s. Sharing the node before the `If` would
remove the growth and make a lazy arm eager; it was not taken.

Measured in a worktree at `ca402e5d915757bf347de1438dff6bf6728b142a` plus the
patch; 6,066 lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,479 of 10,854 (96.5%) |
| Every JavaScript compile | 23,900 of 38,929 (61.4%) |
| Public JavaScript `compile()` calls | 13,408 of 28,061 (47.8%) |
| GLSL `compile()` calls | 600 of 2,321 (25.9%); 569 of the 1,530 that the existing target compiles (37.2%) |

No test fails in the shadow run; with the switch on, the one test of CE-1267.
Largest causes of a GLSL decline: the complex lane 167; a list or tuple
result 96; the option `vars` 48; another option 29.

Batch G2, 2026-11-14. On GLSL a tuple or list of 2 to 4 numbers is a
`vecN` (`bvecN` for booleans), as a result and as an input, with the
`lowered` type of the existing target; another stated length is a `float[n]`
result. A `tuple<…>` input of scalars is the list of its elements on both
targets (an array on JavaScript). The `vars` option on GLSL: the host's text
replaces the name at each read, restricted to names with member or
constant-index accesses, each name checked against the reserved words. A
user function that takes or returns a point, and a list input of another
length, decline. 260 value shaders compiled in WebGL2 by a reviewer with no
wrong value. Measured in a worktree at
`63d959a6e159fcf0790ba66824114ed5987fc3fb` plus the patch; 6,139 lines in
`ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,475 of 10,848 (96.6%) |
| Every JavaScript compile | 23,917 of 38,923 (61.4%) |
| Public JavaScript `compile()` calls | 13,431 of 28,061 (47.9%) |
| GLSL `compile()` calls | 764 of 2,340 (32.6%); 719 of the 1,546 that the existing target compiles (46.5%) |

No test fails in the shadow run; with the switch on, the one test of CE-1267.
Largest causes of a GLSL decline: the complex lane 169; the option
`functions` 21 and other options 29.

Batch G3, 2026-11-14. A list input of any stated length is a uniform array
on GLSL, and `At` with a run-time index is one inline conditional that reads
the clamped element in range and is NaN outside (a constant index out of
range made a shader that no compiler accepts: review finding). The cap on
loop passes: the adapter passes `iterationBudget ?? 10000`; a `Sum` or
`Product` of a run-time count is NaN over it; a bound of the passes of the
whole program (`loopPasses()`: every loop, a run-time count as the budget,
multiplied down the nesting and through calls) must be within the budget, or
the program declines (two nested sums of 10,000 passes ran 10^8 passes per
fragment: review finding). The warning `float32-unsafe-argument` follows the
rule of the existing target, which was measured: it fires for an operand of
`Mod` or `Fract` in which a constant of magnitude 1000 or more multiplies a
trigonometric call, not for a large trigonometric argument; the profile has
no exact form, so it also warns where the existing target computes the sine
hash exactly, and Tycho's curve lane then takes the CPU. `isAmplifiedTrig()`
of `gpu-exact-trig.ts` is imported and has to move into `ir/` before that
file is deleted. A parameter of a user function may be a tuple of numbers,
on both targets; a tuple result of a user function declines.

Two defects of the printer and the walks, found by the reviews and by the
shadow run: the warning walk visited a shared node once per path; a value
whose text nests more than 64 inlined values is now given a name (a `Max` of
1,000 operands overflowed the stack on both targets), and a stack overflow
anywhere in the pipeline is a decline, not an internal error. Measured in a
worktree at `c2937c6dfd41ea74817aa2efd5f0cd115ec35df7` plus the patch; 6,252
lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,475 of 10,848 (96.6%) |
| Every JavaScript compile | 23,928 of 38,923 (61.5%) |
| Public JavaScript `compile()` calls | 13,442 of 28,061 (47.9%) |
| GLSL `compile()` calls | 776 of 2,356 (32.9%); 727 of the 1,562 that the existing target compiles (46.5%) |

No test fails in the shadow run and no internal error is counted; with the
switch on, the one test of CE-1267. The largest cause of a GLSL decline is
the complex lane (169).

Batch G5, 2026-11-14. The `storage` option on GLSL: a list input stored in
a `sampler2D` is marked after the passes (`holdStorage()`), also the
parameters of the functions it is passed to, and each read is a fetch by one
helper, `_gpu_ir_texel`, with the addressing of the existing target (a
single-channel float texture, row-major, any width); it admits `At`,
`Length`, a reduction and an element-wise operation, and declines the list
as a value. A user function may return a tuple or a list of a stated length,
on both targets; a declared element lane other than the body's declines.
`callerLocals` is admitted with no effect. A user function may read a point
input, and on JavaScript a list input of a stated length; on GLSL a list of
more than 4 elements read in a function declines (it would be copied at each
call). An element-wise operation over more than 64 elements declines on GLSL
(the scalarized text had no bound), and `inlinedValues()` of the printer is
linear (it was quadratic: 3.9 s for 2,000 elements, now 0.46 s; the emitted
text is the same). Measured in a worktree at
`613d42af80582b5dff622714410fff969cccb6f2` plus the patch; 6,423 lines in
`ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,484 of 10,859 (96.5%) |
| Every JavaScript compile | 23,946 of 38,928 (61.5%) |
| Public JavaScript `compile()` calls | 13,455 of 28,061 (48.0%) |
| GLSL `compile()` calls | 810 of 2,371 (34.2%); 757 of the 1,574 that the existing target compiles (48.1%) |

No test fails in the shadow run and no internal error is counted; with the
switch on, the one test of CE-1267.

Batch G6, 2026-11-14 (the causes of Tycho's G4 run). GLSL spellings for
`Arctan2`, `Arcsin`, `Arccos`, `Arcosh`, `Artanh`, `Ln`, `Log`, `Hypot`,
`Root`, an integer `Factorial` and an integer `GCD`; new rows on both
targets: `Sec`, `Csc`, `Sinh`, `Cosh`, `Tanh`, `Sech`, `Csch`. The rule of
the GLSL spellings as it is: the inverse trigonometric and hyperbolic
functions and the logarithms write NaN outside their domain and `tanh` is
clamped; `sqrt`, a division and `mod` are the bare GLSL operations, whose
result outside the domain is the driver's (no NaN-safe helper is carried
over, and Tycho's render audit showed no picture change). `Log(x, 2)` and
`Log(x, 10)` use `log2` and `log10` (the quotient `Ln(x)/Ln(b)` was off by
one under `Floor` at exact powers: review finding); another base is the
quotient. A name that holds a number, a list of numbers or a tuple of
numbers and is read in the body of a called function is the literal of its
value when the occurrence resolves to the definition that the scope of the
compilation gives the name, which `compile()` ensures; a name whose value is
an expression of other names still declines. `PointX`, `PointY`, `PointZ`
are element reads of a tuple. The float32 warning does not fire for a `Mod`
or `Fract` that is closed when the fold is on. The fold of the lowering no
longer calls `N()` on a literal list or tuple (the shadow run failed a test
of CE-1065, which requires that a compilation evaluates no element of a
literal value). Measured in a worktree at
`34160118aa8987af0030624165bcb67053a15113` plus the patch; 6,581 lines in
`ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,509 of 10,854 (96.8%) |
| Every JavaScript compile | 24,439 of 38,924 (62.8%) |
| Public JavaScript `compile()` calls | 13,920 of 28,061 (49.6%) |
| GLSL `compile()` calls | 870 of 2,371 (36.7%); 808 of the 1,574 that the existing target compiles (51.3%) |

No test fails in the shadow run and no internal error is counted; with the
switch on, the one test of CE-1267. The largest cause of a GLSL decline in
the suite is the complex lane (187), then the option `functions` (21).

Batch G7, 2026-11-14 (colours). One lane, `color`: on JavaScript the object
of the existing compiler (`{space, c0, c1, c2, alpha}`, made by the existing
`_SYS` members), on GLSL an OKLCh `vec3`, so no space is tracked. Rows `Rgb`,
`Hsl`, `Hsv`, `Oklab`, `Oklch` and the five `As*` conversions on JavaScript;
`Rgb`, `Oklab`, `Oklch`, `AsOklch` on GLSL, and `AsOklab`/`AsRgb` only when
the result position of the expression is that application (Tycho's form).
Declined: an alpha, a colour input, a list of colours, the other colour
operators, a conversion that is not the result on GLSL. On JavaScript the
objects equal the existing compiler's exactly; the GLSL helpers match the
standard formulas. Also in the batch: on GLSL an `At` with a constant index
that is 0, not an integer or beyond the stated length of its list declines
(Tycho's retry of a row is keyed on that refusal); the lookup of a row by
operation and the effect of a region are memoized and the printer's
indentation is capped at 16 levels (a `Which` of 1,000 clauses took 14 to 28 s
and 6 MB of text, now about 170 ms and 280 KB); the float32 warning walk is
memoized per node (a shared graph took 1.7 s on GLSL, now 4 ms). Filed:
CE-1325 (the depth at which a deep expression declines depends on the host's
stack). Measured in a worktree at
`511a446b8c4dc43b50c9fac75c6735861b6be580` plus the patch; 6,811 lines in
`ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,503 of 10,845 (96.8%) |
| Every JavaScript compile | 24,641 of 38,944 (63.3%) |
| Public JavaScript `compile()` calls | 14,127 of 28,086 (50.3%) |
| GLSL `compile()` calls | 905 of 2,390 (37.9%); 843 of the 1,593 that the existing target compiles (52.9%) |

No test fails in the shadow run and no internal error is counted; with the
switch on, the one test of CE-1267. The full suite takes 164 s with the
shadow switch.

Tycho's run of the build of `86ed657fc3530f444fada0cce0e888ef339cf9b0` (G7;
session `tycho-desk`, 2026-11-15), the profile on both seams: every count
equals the run before. No internal error, every admitted shader valid in
WebGL 2 (3,895 of 3,895), 43,761 JavaScript runs with no difference, the
same 8 float32 warnings. The test that hung runs to its end (the decline of
a constant index out of range). The colour batch admits no new row of the
corpus, because each colour row declines on another cause first:

- A name whose value is a colour, read by a style (`AsOklab(C_olor)` where
  a row defines `C_olor = rgb(…)`): JavaScript 44 in CORE and 259 over every
  state, GLSL 10 and 48. The largest group; the remedy is to bake a colour
  value as a literal colour, as a number is baked.
- Tycho's `Which` handler (until Tycho's rewrite): JavaScript 149 in CORE,
  GLSL 63.
- A user function that returns a colour (`AsOklab(c(H_1, x, y, z))`):
  JavaScript 10 in CORE and 20 over every state, GLSL 5 and 12.

No render audit was run: the page admits the same rows.

What a colour name holds at the compile site (a probe of `tycho-desk` over
every Desmos state and the showcase, 283 JavaScript reads): the Desmos
importer writes `Hsv`, with the hue in degrees. `Hsv` of three numbers, 132
reads in 10 documents; `Hsv` or `Oklab` of expressions that read the axes or
other names, 56 reads, which Tycho's macros expand before the compilation;
a value that is a list of colours, about 90 reads, which stays declined; a
helper function that returns a colour, 3. On GLSL: 46 reads of `Hsv` of
expressions and none of `Hsv` of numbers. The functions that return a colour
are `c` of the showcase `buddhabrot` (`(H: list<integer>, x: real, y: real,
z: real) -> color`, an `If` of two `Block`s that end in `Rgb(…)`) and `shade`
of `julia-set`. Batch G9 follows from this: a name that holds a colour
constructor of three numbers is that literal, `Hsv` on GLSL, and a user
function that returns a colour.

Batches G8 and G9, 2026-11-15, made side by side and landed together.

G8, the complex lane on GLSL: a complex value is a `vec2` (re, im), as an
input, a result, a local, a constant, and a parameter or a result of a user
function. Inline: add, subtract, negate, `Real`, `Imaginary`, `Conjugate`,
`Abs`, equality. One helper each, written when used: multiply, divide,
power, `Exp`, `Ln`, `Sqrt`, `Sin`, `Cos`, `Tan`, `Sinh`, `Cosh`, `Tanh`, and
the argument. `Sum`, `Product`, `If` and `Which` of complex values and
`mode: 'complex'` came with no code. Declined: the inverse functions,
`Root`, `Log`, the reciprocal functions, a list or a tuple of complex
numbers (the profile field `scalarLanes`). The GLSL printer writes a float
with the fewest digits that read back as the same float32 (a table of 1,024
numbers averages 11.65 characters per element; it was about 18), except the
largest float, which ANGLE reads as infinity in its short form.

G9, colours that Tycho's corpus reads: a name whose value is a colour
constructor of three real numbers is that constructor of literals, on both
targets, under the rule of a number; `Hsv` and `Hsl` on GLSL; a user function
may return a colour (a colour parameter declines). Tycho's `shade` compiles
on both targets and its `c` on JavaScript; on GLSL `c` declines, because its
list parameter has no stated length (the next batch).

What the reviews found, fixed: `atan(y, x)` with a part computed as `-0` is
wrong on the axes on both renderers (the software renderer and an Apple GPU
through ANGLE Metal), so `Power(Negate(z), 17)` at `z = 3` had the wrong
sign: the argument is one helper that compares the parts with 0 first, and
`Argument(0)` is 0. The short literal of the largest float read as infinity.
A stale paragraph of `docs/COMPILATION-MODEL.md`, the space of a JavaScript
colour not pinned by the new tests, no test point for the clamps of the HSV
helpers, a constructor test in `captured()` that did not read the operand
lanes, a decline cause that named the wrong list. The Claude reviewer of G8
ran about 6,300 shaders in the software renderer and 8,600 on the GPU;
Codex found nothing in G9 and the largest float in G8.

Choices taken (reversible): the comparison with 0 before `atan` is a guard
against a renderer defect at ordinary real operands, not fidelity at a
signed zero; a real times a complex goes through the multiply helper (a pass
rule that printed `x * z` was removed: no measured need); the integer
exponents 1 to 16 of a complex power are a product at run time, as for the
real `pow` (`z^2 + c` at `z = 0`); complex `Sqrt` of exactly 0 is NaN on
GLSL (a branch point); `Hsl` on GLSL came with `Hsv`. Added by the session
after the reviews, checked on both renderers and not reviewed: `Arsinh` on
GLSL is `sign(x)·asinh(|x|)` (the builtin gave NaN at -5000 on the GPU and
-88 in the software renderer). Known limitations recorded: a `Which` of 126
clauses or more and an array parameter of 90,001 elements give a shader that
WebGL refuses (both crafted); a negative base with a fractional exponent in
the complex mode; complex `Tan` and `Tanh` overflow from about 44; the real
`Arctan2` with a computed `-0`. Filed: CE-1326 (`2.5i - 2.5i` throws a
`TypeError` in the interpreter).

Measured in the main tree at `86ed657fc3530f444fada0cce0e888ef339cf9b0` plus
the two patches; 6,987 lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,505 of 10,850 (96.8%) |
| Every JavaScript compile | 24,645 of 38,948 (63.3%) |
| Public JavaScript `compile()` calls | 14,127 of 28,086 (50.3%) |
| GLSL `compile()` calls | 1,080 of 2,392 (45.2%); 1,013 of the 1,595 that the existing target compiles (63.5%) |

No test fails in the shadow run and no internal error is counted; with the
switch on, the one test of CE-1267. The largest GLSL declines left in the
suite: the option `functions` 21, `Root` of a complex 21, `Break` 20.

Tycho's run of the build of `c8b8ff6033810afb30c299c66e81534eaf79e720` (G8
and G9; session `tycho-desk`, 2026-11-15), the profile on both seams:

- JavaScript: CORE 679 of 989 admitted (638 before); every Desmos state
  9,655 of 11,617 (83%; 9,521 before). 43,761 runs with no difference.
- GLSL: CORE 157 of 267 (152 before); every Desmos state 3,904 of 4,376
  (3,895 before). Every admitted shader valid in WebGL 2. The same 8 float32
  warnings. No internal error on either seam.
- Colours: 134 admitted JavaScript compilations with a colour operator, run
  by the profile and by the existing compiler at 3 points each (402 runs),
  the space and the three channels equal within 1e-9.
- Render audit of CORE: 21 states rendered on both arms, no difference of
  outcome, series or pixels, no shader compile failure. No new GLSL row
  reaches the CORE pages: their colour rows hold a value that reads other
  names. The audit has no domain-colouring row, so it says nothing about the
  complex lane in a picture; a picture check of the showcase entries
  `domain-coloring` and `kepler-orbit` is asked for on the next build.
- Colour declines left: a name whose colour value reads other names or is a
  list of colours (JavaScript about 125, GLSL 41), until Tycho's macros.
- `c` of buddhabrot at Tycho's GLSL site: the input is declared
  `list<(real | signed_infinity | nan)^90001>` in `storage`, and `c` declares
  `H: list<integer>`. With batch G10 the call compiles for an input declared
  `list<integer^90001>`, and declines for the list of reals: a declaration
  for Tycho, which declares `vector<integer^90001>` on JavaScript. Tycho
  agreed: at the switch it declares `list<integer^N>` on the sampler site
  when the engine's type of the name is a list of integers and the name
  cannot change its element type without a recompile.
- Two more of Tycho's GLSL tests fail, on a captured complex name that is
  not in `freeSymbolTypes` (it is in `symbolDeps`): Tycho's work at the
  switch.

Batch G10, 2026-11-15 (a list parameter of no stated length on GLSL; the
witness is `c` of Tycho's showcase `buddhabrot`). On a target without
run-time lengths, a list parameter of a user function whose declared type
states no length takes the stated length of its argument at the function's
first call: the arguments of that call are lowered before the function. A
later call with a list of another length declines, and the cause names the
function and the parameter; there is one function per binding, never a copy
per length. JavaScript is unchanged (one function with a hidden length; the
emitted code of 76 programs is byte-identical). The lowering now reads one
property of the target, `runtimeLengths`. Both reviews found the same
defect, fixed: a first call nested in an argument of itself
(`g(H, g(H, g(H, x)))`) defined the function again, which gave a shader that
WebGL refuses, and an internal error with three lengths. The Claude reviewer
ran 213 shaders over 91 cases with no value difference, and found the GLSL
text of the 32 programs that the base compiles unchanged. Measured in the
main tree at `c8b8ff6033810afb30c299c66e81534eaf79e720` plus the patch;
7,030 lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,514 of 10,859 (96.8%) |
| Every JavaScript compile | 24,640 of 38,943 (63.3%) |
| Public JavaScript `compile()` calls | 14,127 of 28,086 (50.3%) |
| GLSL `compile()` calls | 1,085 of 2,392 (45.4%); 1,018 of the 1,595 that the existing target compiles (63.8%) |

No test fails in the shadow run and no internal error is counted; with the
switch on, the one test of CE-1267.

Tycho's run of the build of `52a408a81e65f6a358b71219721642211e73514b` (G13
and G14; session `tycho-desk`, 2026-11-15):

- JavaScript over every Desmos state: 9,870 of 11,617 admitted (9,824
  before); GLSL 3,927 of 4,376 (unchanged). No internal error; 43,829
  JavaScript runs and 402 colour runs with no difference; every admitted
  shader valid in WebGL 2.
- The integer sampler: its self-test passes on `Floor(x/49)` (caught on the
  build before); over 852 corpus calls with `Floor`, `Ceil`, `Round` or
  `Mod` and 649,857 integer runs, no row differs.
- 127 admitted shaders change text, all by the helper `_gpu_ir_quot`. The
  render audit of CORE shows no picture change; the showcase entries that
  hold the helper are not in that audit. Picture check of six of them in a
  page (WebGL on the machine's GPU, each entry twice per arm): `julia-set`,
  `butterfly-curve`, `kernel-functions` and `black-hole` are identical with
  the profile on; `pendulum-wave` differs by 4 pixels on curve edges, only
  with both seams on; `rainbow-sky` differs by 42 single pixels on the edges
  of its arcs, from the GLSL seam: the existing GLSL target declines its 8
  arc rows, so they are drawn on the CPU without the profile and by the GPU
  with it. No shader failed to compile.
- The causes of a list-of-tuples input are gone (63 calls); some of those
  calls decline one step later (a list times a point, a list local of
  tuples).
- What the switch still loses, without the handlers and the colour values
  that read other names: JavaScript 291 calls (337 before), of which the
  existing compiler compiles 272; GLSL 46, of which 33. The largest
  JavaScript causes: a `Comprehension` of several clauses 29, `RandomChoice`
  29, `ListJoin` 25, a name whose value is not a number about 30, a list
  times a point and sums of them about 28, a function 14, `RandomShuffle`
  13, `Zip` 10, a list or tuple argument of `Apply` 17.

Review with the user, 2026-11-15, at
`52a408a81e65f6a358b71219721642211e73514b`, and the decisions taken.

What was measured. `compilation/` is 207,973 lines in 152 files. The
pipeline is 7,482 lines (and 14,815 lines of tests). The old compilers by
file are 81,625 lines in 39 files: `javascript-target.ts` 19,043; the two
earlier replacement attempts 36,999 (`javascript-fragment-target.ts` and
the structured route); the GLSL target 25,583. A shared layer of 102,913
lines in 96 files (`compiler-core.ts`, the `compile-*.ts` files, CSE,
folding) stays as long as a target is built on it: by the import graph,
deleting the old files orphans 656 more lines, because the Python target
(8,212 lines) and the interval target (7,741) use that layer. Timing of
twelve programs, old against new, at a load of about 15: scalar kernels run
1.3 to 1.9 times faster on the profile and compile faster; a `Sum` from 1 to
n runs 2.8 times slower (the deadline check is a call on every pass); a list
of 1,000 elements 8 to 45 times slower (a list is built with
`Array.from({length}, fn)`: 30.8 µs per 1,000 elements against 0.68 µs for a
preallocated array and a loop). Both are spellings of the JavaScript
printer, to fix before the default.

User decisions of 2026-11-15:

- The work continues; the old compilers are not kept.
- The two abandoned attempts (the `numeric-kernel` profile, the structured
  route, `javascript-fragment-target.ts`) are removed now, with their tests:
  a breaking change of an experimental option.
- The Python target is dropped now, code and tests ("Approved: drop Python
  target, code and tests"); it may come back later as a printer on the
  pipeline. There are no known users.
- Interval arithmetic becomes a mode of the pipeline's JavaScript target,
  as `bigint` is, in a session of its own; the brief is
  `docs/scratch/2026-11-15-ir-interval-mode-handoff.md`.

With JavaScript, GLSL, interval and Python off the shared layer, that layer
can be deleted too.

Four more user decisions of 2026-11-15 ("1: (a), 2: (a), 3: (a) 4: (a)"):

- Colormap: Tycho rewrites `colormap(h, v)` in MathJSON before it compiles
  (literal tables, a clamped index, a linear interpolation, `Oklab(…)`); the
  option `functions` does not come back.
- In the `strict` mode a function of real operands is computed on the reals
  and gives NaN outside its domain, also where the static type of the node
  is complex: `Arcsin(u)` with `u: real` at `u = 2` is NaN (the interpreter
  and the existing compiler give `1.5708 − 1.3170i`). A host that wants the
  complex value asks for `mode: 'complex'`. This is D5 of the census: its 36
  tests change at the default.
- The comparison of the parts with 0 before `atan` on the complex lane of
  GLSL stays: it is not the signed-zero case of the edge-point rule, since
  ordinary real operands gave a wrong finite value.
- An integral that the quadrature cannot settle keeps the estimate of the
  Monte-Carlo fallback, as the interpreter and the existing compiler give
  it (it changes a little at each run), and is NaN only when the integrand
  has given a value that is not finite.

The two removals, 2026-11-15, landed together on
`926016f4ce9fcd4dc07e74541046e7d46a461020` (which holds the first batch of
the interval mode, by session `ce-interval`).

- The `numeric-kernel` profile and the structured route:
  `javascript-fragment-target.ts`, `javascript-fragment-facts.ts`, the
  `javascript-structured-*.ts` and `structured-*.ts` files, 58 test files,
  two fuzz scripts and the pilot benchmark. `profile` accepts `'ir'` only.
  Removed with it, since only that route used them: hooks inside the kept
  JavaScript compiler (the calls into the facts module, `bodyEmitter()`),
  nine members of `FragmentDefinition`, the result fields `pure` and
  `defaultedSymbols`. Review (Codex: nothing; Claude: 7,735 programs and
  131,479 compilations for JavaScript, GLSL, interval and the profile,
  identical on the base and the patched tree; two test cases that pinned
  the existing compiler alone were moved to kept files). Closed: CE-1242.
- The Python target: `python-target.ts` (8,212 lines), about 1,300 lines of
  Python branches in the shared layer, 11 test files and the Python rows of
  190 others, the guide page, the view of the VS Code extension, the CI
  workflow that only ran the Python tests. Review (Codex: nothing; Claude:
  18,180 compilations of a 1,010-program corpus and 104,722 compilations of
  452 kept test files identical for JavaScript, GLSL and interval; a host
  target whose `language` is `'python'` loses the behaviours keyed on that
  name; three tests that had lost coverage of kept code were restored on
  GLSL or interval). One emitted-text change on JavaScript: a `_` position
  of a loop pattern takes no temporary.
- Size: 386 files, 127,393 lines deleted, 1,149 added. `compilation/` is
  161,288 lines (207,973 before, and that count now includes the interval
  adapter and printer).
- Checks on the merged tree at `7c74ab286db468549e092c1b0ac3f12cd2722508`:
  the full suite with `CE_JS_PROFILE=ir` and with `CE_JS_PROFILE_SHADOW=ir`,
  both green (2,037 suites, 84,614 tests; the one failure of CE-1267 was in
  a deleted file of the structured route). After the reconciliation with
  the interval batch (two files): type check, `check:deps`, lint,
  `check:docs`, and 38 test files (2,214 tests) of the profile, the interval
  mode, the switches and the target registration.
- Measures after the removals (the denominators changed: the tests of the
  removed route compiled about 10,000 programs): engine compilations 10,453
  of 10,767 admitted (97.1%); every JavaScript compile 17,369 of 28,594
  (60.7%); public JavaScript 6,904 of 17,815 (38.8%); GLSL 1,157 of 2,395
  (48.3%; 1,078 of the 1,596 that the existing target compiles, 67.5%).

An undeclared input (2026-11-15). The pipeline read a scalar input typed
`unknown` or `any` as a real, a difference from the existing compilers that
its README called deliberate; `AGENTS.md` says such an input is refused, and
115 tests of the census expect the refusal. `tycho-desk` measured what Tycho
relies on (codegen audit on 0.192.0): it declares every input (CORE has no
record with an untyped free name; over every state 7 of 9,031 JavaScript
records, none of which the existing compiler compiles), and one of its
checks reads the refusal (`untyped-input` and its `value`, the names) to
find a body that reads a name outside its inputs. So the pipeline follows
the rule: batch G16 refuses an untyped input with the existing diagnostic,
in every mode and on both targets. A parameter of a user function with no
declared type is not an input and keeps its rule.

Batches G15 and G16, 2026-11-15, landed together on
`bbc28d9ca` (which holds three batches of the interval mode).

G15, the JavaScript printer. A build is a preallocated array filled by a
loop (it was `Array.from({length}, fn)`: 30.8 µs per 1,000 elements against
0.68 µs); an element-wise operation that is pure, used once and of the shape
of its element-wise user is printed inside that user's loop (`2L + 1` is one
loop). An index loop counts its passes (`n = Math.floor(hi - lo) + 1`, the
index is `lo + i`), so it ends for any bounds: with `v++` a loop from 2^53
never returned, which hung
`test/compute-engine/compile-big-op-unsafe-bounds.test.ts` under the public
switch. A constant bound beyond 2^53 − 1 declines. The deadline: passes run
in blocks of at most 1,024 with no call inside a block, and after each block
`_SYS.tick(passes)` adds them to a count kept on the deadline frame, modulo
1,024; `tick()` with no argument is one pass, so code stored before the
batch behaves as before. Three review rounds (Codex and Claude): a counter
in the compiled code, reset at each entry, let repeated short calls and a
re-entrant call never reach the deadline (`withTimeLimit` around a batch of
2e5 cells ran to the end), and cost 2 times on nested loops; a test of the
index with a call inside the loop made a list reduction in a loop 5 times
slower; an unbounded count stopped advancing at 2^53. The block form
answers all three. Values: 84,269 runs with no bit of difference against
the base; the count of passes exact in 215 cases. Not changed: a bound
declared `integer` that holds a non-integer at run time can run one pass
more (a value outside its type). Per call, old compiler / profile before /
profile now: `2L + 1` over 1,000 elements 6.1 µs / 41 µs / 0.85 µs;
`Sum(Sin(L)·x)` over 1,000 6.0 / 47 / 5.6 µs; `Sum(k·x, k = 1..200)` 155 /
240 / 126 ns; `Filter(L > 5)` over 1,000 1.2 / 1.9 / 1.2 µs. Noted for a
later batch, with no code yet: on a closed nest (`Sum(Max(Max(L), k))`) the
existing compiler is 30 times faster than the profile (work that does not
depend on the loop index is not moved out of the loop); `Square(z)` of a
complex is a general power (28 ns against 3 ns for a product).

G16, an input with no type is refused. Two sets for the whole lowering,
the entry and every function body: the names read as inputs, and those with
a type at some occurrence; the difference is refused at the end of a
lowering that completed, with the diagnostic of the existing compiler
(`untyped-input`, `value` = the names), on the three targets and in every
mode; a decline of the lowering is reported as itself; a `vars` name follows
the rule; the statistics class the refusal as a decline. Reviews, two
rounds: a first form that added and removed names from one set compiled an
untyped `vars` name as a scalar, refused an input typed in another body,
and masked other declines; then a `vars` name typed `any` read in a called
body. AFTER both reviews passed, the suite measure found a wrong admission:
`any` was read as `unknown` for a parameter of a root function literal too,
so `Function(Add(p, q), p: any, q: any)` compiled and gave `"1,23"` for a
list (223 programs of the suite that the existing compiler declines and
the profile admitted). Fixed: only a free input is read so. The measure
that found it is now part of every landing: the programs that the existing
compiler declines and the profile admits, compared message by message with
the run before; no class may grow without a reason.

Measured in a worktree at `bbc28d9ca` plus the two patches; 8,699 lines in
`ir/`, the interval mode included:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,451 of 10,777 (97.0%) |
| Every JavaScript compile | 17,303 of 28,606 (60.5%) |
| Public JavaScript `compile()` calls | 6,851 of 17,830 (38.4%) |
| GLSL `compile()` calls | 1,139 of 2,400 (47.5%); 1,076 of the 1,596 that the existing target compiles (67.4%) |

Both runs green (2,044 suites, 84,972 tests). Programs that the existing
compiler declines and the profile admits: JavaScript 76 (121 before), GLSL 63
(79 before); no class grows.

Builds for Tycho (user, 2026-11-15): few. No build follows this landing;
the next one is shared with session `ce-interval`, on a commit that holds
several batches of both, with one request for one audit over the three
seams.

Batches G17 and G18, 2026-11-15, landed together on
`817f3a87ce4cb10aac942ca465604d1d9d6bf0ad` (which holds the interval mode's
batches 4 to 6).

G17, list operators of Tycho's decline groups, JavaScript. `ListJoin` is one
build over the sum of the lengths (the element at `k` is read from the first
list whose end is after `k`). `Zip` is the value of `PointList`; a list with
an effect declines. A `Comprehension` of several clauses is one build over
the product of the lengths (index of clause `j`: `Floor(k / s_j) mod n_j`);
a clause list that reads an earlier index, a clause with a condition, and an
effect in a clause list or in the body decline. `Choose` is the row of
`Binomial`, integer operands, `_SYS.binomial` on JavaScript.
`RandomChoice(Interval(0, 1), n)` is a region row `choice`
(`_SYS.randomChoice`) and `RandomShuffle` an effectful row (`_SYS.shuffle`):
the interpreter's sequences under `WithRandomSeed`; the length of a list made
in a seeded frame is a yield of the frame. An `If` with a boolean arm and no
else arm gives `False` (also on GLSL). The witness "a list of points times a
list of numbers" already compiled since G14 (Tycho's decline record predates
it). Dual review: both reviewers found that the builder did not count the
region `choice` as an effect (one `RandomChoice` node read twice drew once,
and the effect checks of `Zip`, comprehensions and integrals missed it) and
that a later clause list with an effect was read once where the interpreter
reads it once per element of the earlier clauses; fixed, with `ListJoin()` of
no operand (an internal error) and the test of the unit interval (`isSame`).

G18, issue CE-1344 (`Apply` of a function literal over a scalar or a flat
list, for Tycho's macro adoption). Three causes on the profile: (1) `Min(v)`
and `Max(v)` of one real or integer scalar declined; they are `v`. (2)
`Apply` of a literal of one parameter over one flat list of reals or integers,
when `literalParamsMap()` holds (the interpreter's own test in
`applyLiteralMaps()`), is the build of `Map` (`lists.over()`), on JavaScript
and in the interval mode; the argument is lowered once. A nested list, a
tuple, a list of points or booleans, several parameters and a typed parameter
decline. (3) GLSL had no build: a `Map` (and a one-clause `Comprehension`)
over a source of a constant length of 1 to 64 lowers its body once per
element into a list (`vecN` or `float[n]`); at most 4,096 such elements per
program; `Filter`, `Range` and run-time lengths decline. Values checked in
WebGL 2. Dual review: Codex nothing; Claude found the argument lowered twice
(a write or a draw in it ran twice): fixed. Tycho's instrument calls the
default route: it is READY only with `profile: 'ir'`. Filed: CE-1345 and
CE-1348 (the engine's construction of a shared graph of function literals,
and `analyzeReferences()` on GLSL, double per level).

Measured in a worktree at `817f3a87c` plus the two patches; 9,424 lines in
`ir/`, the interval mode included:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 12,219 of 12,568 (97.2%) |
| Every JavaScript compile | 19,122 of 30,401 (62.9%) |
| Public JavaScript `compile()` calls | 6,898 of 17,830 (38.7%); 6,820 of the 15,029 that the existing compiler compiles (45.4%) |
| GLSL `compile()` calls | 1,161 of 2,400 (48.4%); 1,094 of the 1,596 that the existing target compiles (68.5%) |
| `interval-js` `compile()` calls | 1,470 of 2,663 (55.2%); 1,429 of the 2,131 that the existing target compiles (67.1%) |

Both runs green (2,047 suites, 85,296 tests). Programs that the existing
compiler declines and the profile admits: JavaScript 78 (76 before: the
two-clause comprehension of `clause-scope-free-variables.test.ts`, compiled
twice, with the interpreter's values), GLSL 67 (63: the four nested `Map`s of
`ce-605-gpu-nested-map.test.ts`, checked in WebGL 2 against the
interpreter), `interval-js` 41 (27: thirteen programs of the containment
tests added with these batches, and one of the interval mode's batch 6).

Census run 2 of the default (`CE_JS_PROFILE_PUBLIC=ir npm test`, at
`77a218dc4`; record `_TASKS/2026-11-15-default-census/run2/`): the suite
ends in 185 s with no hang; 1,676 tests fail (2,475 in run 1): 1,080 pin a
text, 141 a result field; the 54 of the class "profile wrong" that still
fail are the constants beyond 2^53 of group D2 (26), `Arcsin(2)` in strict
(24, user decision) and the overflowing integrand (4, user decision). New
contract items for the default: a run-time bound or step that is not finite
throws a `RangeError` (existing: NaN or an empty list); `PointZ` of a list of
2-D points is a list of NaN (existing: one NaN); a zip wider than the
iteration budget is not capped.

Build for Tycho (user, 2026-11-15): the joint audit runs on `3592da6cb`;
CE-1344 goes to the session that adopts the macros as a local tarball,
made without npm: in a worktree at the commit, the version set to
`0.193.0-tycho.<short sha>`, `npm run clean && npm run build`, then
`npm pack --ignore-scripts` (8 s; the release hooks of a plain `npm pack`
check the npm login and run the full suite again).

The local replay of Tycho's corpus, 2026-11-15. Tycho's joint audit on
`3592da6cb` was stopped by the user: the interval mode had no loop-invariant
motion, and one showcase document took 1,843 s. `tycho-desk` made a dump
instead, with the existing compiler only:
`~/dev/compute-engine-recovery/interval-dump/t12-javascript-glsl-document-definitions.json`
(755 documents, 13,966 distinct programs: 9,974 JavaScript and 3,992 GLSL,
each with its options, the declared types of its free names and the
definitions of its document). The replay runs on any tree of the engine and
asks Tycho for nothing: `_TASKS/2026-11-14-ir-batches/replay-t12.mts`
(admission with the cause, values at six sample points on JavaScript, time
per `run()` call; `CE_ROOT=<tree>`), `replay-summary.mjs`,
`replay-compare.mjs <base> <new>` (program by program), `replay-slow.mjs`,
`replay-one.mts` (one program: both codes, both values, the interpreter's),
`replay-glsl-validity.mts` (WebGL 2 with the engine's driver). Records in
`_TASKS/2026-11-14-ir-batches/replay-t12/`. On main
`641dbcc11aad526d1569b61fe46189031852acae`:

| Measure | JavaScript | GLSL |
| --- | --- | --- |
| Programs | 9,974 | 3,992 |
| The existing compiler compiles | 9,474 | 3,837 |
| The profile admits | 9,020; 9,018 of the existing's (95.2%) | 3,721; 3,704 of the existing's (96.5%) |
| Internal errors | 0 | 0 |

- Largest causes of a decline among those the existing compiler compiles,
  JavaScript: a symbol whose colour value is not `Hsv` of three reals 100; a
  list where a scalar is required 52; a symbol with a value that is not a
  number or a list 38; an index that can be out of range (a list of booleans,
  of complex numbers, of lists) 37; a list or tuple argument of `Apply` 29;
  `Repeat` 23. GLSL: the colour symbol 40; loops that can run more passes
  than the `iterationBudget` 36; a symbol with a value 20; a `vars` entry 12.
- Values on JavaScript: 8,823 of 8,859 compared programs the same. Five
  finite differences, none a defect of the profile: in `neyret/ofbyu53cz8`
  #9 and #10, `neyret/wsne0l2tcv` #2 and `neyret/fqiid6jhrd` #0 the profile
  gives the interpreter's value and the existing compiler does not; in
  `neyret/lfvstlsdsp` #8 two ulps are amplified by a cancellation. The rest:
  21 lists of two lengths in the sample or `Arccos` outside its domain
  (decided), 7 throws on a `Range` whose bound is NaN (the existing compiler
  gives an empty list), 3 at non-finite values.
- Shader validity: 3,697 of the 3,721 admitted GLSL programs compile and
  link in WebGL 2 (24 use a host's `vars` names and are not wrapped).
- Time per call on JavaScript, 8,826 programs: median profile/existing 0.68;
  4,177 programs more than 1.5 times faster; 299 above 1.5, 28 above 10.
  The classes of the 299: 233 a list or point result copied with
  `structuredClone` (batch G19); 8 a constant list literal rebuilt at each
  call (G19); 14 nested loops (`showcase/voronoi-diagram` 65 times: no
  loop-invariant motion, a pass of session `ce-interval`;
  `neyret/51a4237846` up to 1,356 times and 5.8 s to compile: 3,125 copies
  of one sub-tree each lowered, a structural memo of `ce-interval`); 8
  integrals (the existing compiler compiles the closed form:
  `neyret/7mo1pzvuqb` #1 2.4 ms against 0.09 µs; batch G20, not started);
  the rest sample artefacts and small ratios under a microsecond.

Batch G19, 2026-11-15: results with no copy, constant lists computed once.
The contract of `run()` on JavaScript (`docs/COMPILATION-MODEL.md`, user
decision of 2026-10-13) is "results read-only": a result comes back as the
code built it, with no copy, and can be a value kept for every later call.
The pipeline copied a list result that could hold an input, since its first
commit and with no contract asking for it. The first form of the batch made
the copy cheaper (by level, with `slice()`); both reviewers then found that a
constant list of complex numbers computed once shared its cells with a
result, and the contract was read again. Final form: the copy is deleted
(`mayAliasInput()`, the `alias` members of the operator rows and region rows,
the copy flags of `ret`/`retTuple`: 17 lines fewer in `ir/` than before the
batch), and `onceLists()` in `ir/print-js.ts` binds once, in the preamble,
every list of constants of 16 constants or more (below 16 the literal at each
call is as fast: measured). Compiled code never writes to an input or to
such a list (tests). The interval mode keeps the copy of its own adapter.
Alternative, not taken: the cheap copy (61 lines more, complex lists not
computed once, `List(A, B, C, A)` still 2.5 times the existing compiler).
On the six witness documents no program is above 1.5 times the existing
compiler (`neyret/1a9de333a1` median 150 to 0.68; `List(A, B, C, D)` 13.9 to
0.87). Tests: `ir-js-results.test.ts`; six tests that pinned the copy now pin
the contract (`ir-slice-js`, `ir-tuples`, `ir-slice-random`).
Dual review: Codex and Claude on the first form (the shared complex cells),
Codex on the final form (nothing); no second Claude round, the final form
being a deletion whose in-place writes the first round had probed. Measured
in a worktree at `b3fc5a4a2ca93bec286fe0f52f2903b936eea896` (which holds the
loop-invariant pass, the structural memo and the interval kernel choices of
`ce-interval`) plus the patch: both suite runs green (2,049 suites, 85,446
tests); engine compilations 12,229 of 12,576 admitted (97.2%); public
JavaScript 6,844 of the 15,054 that the existing compiler compiles (45.5%);
GLSL 1,094 of 1,596 (68.5%); `interval-js` 1,467 of 2,169 (67.6%); programs
that the existing compiler declines and the profile admits unchanged (78,
67, 41), no message moves. Shader validity of the corpus on that tree: 3,697
of 3,697 wrapped programs compile in WebGL 2. `ir/` is 9,735 lines (the
pass and the memo added about 240).

Split of the remaining causes with `ce-interval` (its design note, section
18): the loop-invariant pass, the structural memo, a value common to the
arms of an `if`, the unroll of a `Sum` of constant bounds (JavaScript only if
the replay gains) are its batches, reviewed here with a replay each; mine:
G21, inlining at the lowering a small non-recursive function called inside a
loop (what is left of voronoi, 6 times, after the pass), and G20, the closed
form of an integral on JavaScript.

Found after the review, to settle before the default:

- A hang, with the switch `CE_JS_PROFILE_PUBLIC=ir`:
  `test/compute-engine/compile-big-op-unsafe-bounds.test.ts` never ends. A
  loop of the JavaScript printer advances its index with `v++`, which does
  not change a number at 2^53, so `Sum(Sin(x + k), k = 2^53..2^53 + 2)`
  spins; G12 exposed it by admitting bounds that are not safe integers.
  Batch G15 makes a loop count its passes, declines a constant bound beyond
  the safe integers, and fixes the two speed causes above. Every batch brief
  now also requires a test with a loop bound at 2^53.
- A contract item (`ce-interval`, from a Codex review): with
  `vars: { c: '_.c' }` and `varsObjectRefs`, the existing JavaScript target
  records `['c', 'x']` for `c + x + 1` and the profile records `['x']`: a
  mapped name is not an entry input of the profile. The option's
  documentation says "every free symbol it emitted as a vars-object lookup".

Tycho's run of the build of `d4e8d87819f53fa014559a0891d8b96c27b109ec` (G10;
session `tycho-desk`, 2026-11-15):

- The complex lane in a picture (a page on the machine's GPU, four loads per
  entry, 960,000 pixels each): the showcase entry `domain-coloring`, whose
  one function shader comes from the profile, and `kepler-orbit` (one of four
  shaders from the profile; one `Which` declines on Tycho's handler): no
  pixel differs between the build with the profile on both seams and the
  same build without it, and no shader fails to compile. Neither picture
  reaches the complex `Sqrt` of 0, the overflow of `Tan` and `Tanh`, or a
  negative base with a fractional exponent.
- `c` of buddhabrot with the list declared `list<integer^90001>`: not yet
  testable in a page, since both rows decline on Tycho's `At` handler first.
- Every count equals the run before, on both seams; no value difference, no
  internal error, every admitted shader valid.
- GLSL declines left over every state: Tycho's handlers 342 (`Which` 267,
  `At` 75); a colour value that reads other names 48; `Block` 26 (one
  document: a user function that returns the list
  `Mod(Floor(n / 2^Range(0, 10)), 2)`, which the existing GLSL target declines
  too); `Add` 8 (a tree with `Error` nodes); `Function` 7 (a function that
  returns a point of unknown element type); a bound that is not an integer
  5; the pass bound 4; a name with a value that is not a number 5; `PointX`
  4; `Break` 3; `Polygon`, `Mandelbrot`, `Segment`, `Tuple`, a real
  `Factorial` 2 each; ten causes with 1 each.
- What the switch loses (a second run of `tycho-desk` on the same build,
  which records per call the cause and whether the existing compiler
  compiles the same call), without Tycho's handlers and the colour values
  that read other names. GLSL: 82 calls decline, and the existing target
  compiles 65 of them. JavaScript: 546 calls decline, and the existing
  compiler compiles 524. The record of every cause with its message, options
  and one program is `_TASKS/2026-11-14-ir-batches/tycho-t9-declines.json`.
  The JavaScript causes by size: a bound of a `Sum` or `Product` that is not
  an integer 77; an input that is a list of tuples 62; `Apply` of a function
  literal 48; arithmetic on points (`Add` or `Abs` of a tuple, `Distance`, a
  function that returns a point, `PointList` of lists) about 120;
  `RandomChoice` and `RandomShuffle` 42; a `Comprehension` of several
  clauses 29; `ListJoin` 25 and `Zip` 10; a name whose value is not a number
  about 33; a function with a parameter that is a list of tuples 16; a
  `Range` of reals 14; a write to a list local 7; `Choose` 7; `Break` 5.
  On GLSL: a function that returns a list made by a `Range` 25; a tree with
  `Error` nodes 7; a function that returns a point 7; the pass bound 4.
  Batches G11 (points) and G12 (bounds, `Apply`) take the largest groups.

Batches G11 and G12, 2026-11-15, made side by side and landed together.

G11, arithmetic on points. What the interpreter gives was measured first:
`P + Q`, `-P`, `2P`, `P/2` are component by component; `P + 2`, `P·Q`, `P/Q`
are errors; `Abs` of a point is its Euclidean norm, of a list the list of
absolute values; `Distance` is the norm of the difference. Admitted on both
targets: `Abs` of a point (a rule `norm` of the tuple table, built from
existing rows), `Distance`, a user function with no stated result that
returns a point, and a parameter with no declared type that is a point: it
takes the shape of the lowered argument of the function's first call, by
the mechanism of G10, one function per binding, and a later call with
another shape declines. On JavaScript, lists of points: a point plus a list
of points, `Abs`, `PointX` and `Distance` over a list of points,
`PointList(L1, L2)` of lists (as long as the shorter). A name that holds
`PointList` of numbers is that point. The fold pass memoizes an element read
of an operation on lists per region: it ran once per path of a shared graph
(out of memory at 20 levels on JavaScript). Reviews, three rounds: no wrong
value and no invalid shader in about 2,000 shader runs and 9,000 random
programs; the first form of the parameter rule read the static type of the
argument, so whether a program compiled depended on which call came first
(48 of 5,000 random pairs), fixed by reading the lowered argument; an
internal error on an empty tuple; inferred types `broadcastable` and unions
taken as "no stated type". The last delta was read by the session.

G12, bounds and `Apply`. A bound of a `Sum` or `Product` of a real type is
floored, the rule of the interpreter's `normalizeIndexingSet()`, on both
targets. `Range` takes real operands on JavaScript (the elements
`lo + k·step`). `Apply` of a function literal to scalar arguments is the
body with the parameters bound, each argument evaluated once, in order.
Reviews: `Apply` bound a list argument whole where the interpreter maps the
function over it (now any list or tuple argument declines); a constant
infinite bound compiled to code that throws, where the base declined and
the interpreter has the value of the series (a constant bound or `Range`
operand that is not finite declines). Not covered: the four GLSL calls over
the pass bound are a nested loop whose inner count reads the outer index.
Known limitation recorded: a bound that doubles compute just under an
integer. Filed: CE-1327 (`ce.withValues()` and a sum index of the same name
in a mapped function), CE-1328 (a `Range` step with `Random()` draws at
boxing).

Measured in the main tree at `d4e8d87819f53fa014559a0891d8b96c27b109ec` plus
the two patches; 7,254 lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,539 of 10,859 (97.1%) |
| Every JavaScript compile | 25,006 of 38,952 (64.2%) |
| Public JavaScript `compile()` calls | 14,459 of 28,086 (51.5%) |
| GLSL `compile()` calls | 1,156 of 2,392 (48.3%); 1,077 of the 1,595 that the existing target compiles (67.5%) |

No test fails in the shadow run and no internal error is counted; with the
switch on, the one test of CE-1267.

The census of the default (2026-11-15, an agent at
`d4e8d87819f53fa014559a0891d8b96c27b109ec`; records in
`_TASKS/2026-11-15-default-census/`). A test-only switch,
`CE_JS_PROFILE_PUBLIC=ir` (88 lines, not committed), makes every public
`compile()` for JavaScript or GLSL that names no profile try the profile
first and fall back to the existing target. With it 2,475 of the suite's
tests fail, in 287 files; no hang and no internal error. By class: pinned
text of the existing compiler 1,121; a field of the result or an expected
decline 254; a value that differs within the caveats 860 (780 of them the
bit-for-bit differential tests of the structured route); the profile right
and the existing compiler wrong 53; other 84; and 103 where the profile is
wrong, in six groups:

- D1, 13 tests: a product or a power of matrices is computed element by
  element.
- D2, 46 tests: a jump (`Floor`, `Ceil`, `Round`, `Mod`, a comparison) of
  an operand that is exact in the interpreter and not in doubles:
  `Floor(x/49)` at `x = 49` gives 0, because the code is
  `Math.floor(0.0204…·x)`; `Floor(29k/50)` at `k = 100` gives 57.
- D3, 4 tests: `∫₀^∞ x^100·e^−x dx` gives a wrong finite number that
  changes between runs.
- D4, 2 tests: `At(Map(f, Range(1, ∞)), 3)` throws at run time (G12 now
  declines a `Range` with an infinite operand).
- D5, 36 tests: `Arcsin(u)` with `u: real` at `u = 2` is NaN where the
  interpreter and the existing compiler give a complex number. A question
  for the user: the rule of the README is NaN in the `strict` mode.
- D6, 2 tests: an assignment in a bound of a `Sum` takes effect (crafted).

The next batch fixes D1, D2, D3 and D6, and lands the switch.

Tycho's run of the build of `bc382309d8b9f6052bf6e12757ec18637a917020` (G11
and G12; session `tycho-desk`, 2026-11-15):

- JavaScript over every Desmos state: 9,824 of 11,617 admitted (9,655
  before); GLSL 3,927 of 4,376 (3,904 before). No internal error, every
  admitted shader valid, 43,803 JavaScript runs and 402 colour runs with no
  difference, a render audit of CORE with no change.
- An integer sampler of `tycho-desk` for the defect D2 (each JavaScript row
  with `Floor`, `Ceil`, `Round`, `Mod`, `Remainder` or `Fract`, each real
  input in turn from 1 to 200): it catches `Floor(x/49)` at 49 on this
  build, and over 932 rows and 663,078 runs no row of the corpus differs:
  the corpus has no such quotient at these inputs.
- What the switch still loses, without Tycho's handlers and the colour
  values that read other names (records in
  `_TASKS/2026-11-14-ir-batches/tycho-t10-declines.json`). JavaScript: 337
  calls decline (546 before), and the existing compiler compiles 318 of
  them. GLSL: 46 (82 before), of which the existing target compiles 33. The
  JavaScript causes by size: an input that is a list of tuples 62 and a
  function that returns one 20; `RandomChoice` 29 and `RandomShuffle` 13; a
  `Comprehension` of several clauses 29; `ListJoin` 25 and `Zip` 10; a name
  whose value is not a number about 36; a list or tuple argument of `Apply`
  24; a write to a list local 7; `Choose` 7; `If` with arms of two types 6;
  `Break` 5; a scalar times a point 5; `Apply` of a derivative 5. GLSL: a
  function 10, the pass bound 6, a name with a value that is not a number 5,
  `Break` 3. Batch G14 takes the lists of tuples as inputs.

Batches G13 and G14, 2026-11-15, made side by side, merged by hand (one
hunk of `apply()` in `lower.ts`) and landed together after the release
0.192.0.

G13, the wrong values of the census. D1: a `Multiply` with an operand of
rank 2 or more and another list, and a `Power` of such a base, decline (the
interpreter gives the matrix product or power); a list of points is not a
matrix. D2: a product with a rational factor `p/q` whose `q` is not a power
of two is `(p · factors) / q`, in one place (`product()` in `lower.ts`), also
when a name holds the rational: `Floor(x/49)` is `Math.floor(_.x / 49)`. On
GLSL the division is the helper `_gpu_ir_quot`, which gives the exact
quotient when it is an integer or a half, for a dividend below 2^23: a
reviewer measured that a plain division by a literal is wrong on the
machine's GPU at the same samples as in the software renderer (322 of
23,439; both multiply by the float of the reciprocal). D3: the wrong number
that changed at each run was the Monte-Carlo fallback of the quadrature
(10^7 live draws); the profile's integral (`_SYS.irIntegrate`) keeps that
fallback and gives NaN when it starts to sample an integrand that has given
a value that is not finite, so `∫₀^∞ x^100·e^−x dx` is NaN at every run and
`∫₀^1000 Mod(t, 1) dt` keeps its estimate. D6: a `Sum` or `Product` whose
`Limits` assigns a name outside it declines. D4 was fixed by G12. The switch
`CE_JS_PROFILE_PUBLIC=ir` of the census is landed (test-only). Reviews
(Codex: the exactness test of the GLSL helper rounds from 2^23; a 32-bit
power-of-two test. Claude: 2,297,022 JavaScript values with no mismatch in
the forms of one product; a point times `p/q` on GLSL; a rational held by a
name; a rational times a list twice as slow, half recovered; the first form
of D3 gave NaN to integrals that only fail to converge), fixed. Known
limitation recorded: `Floor` of a sum of two or three quotients that is an
integer only in exact arithmetic. With the switch on, the census tests of D1,
D4 and D6 pass; 39 of the 46 of D2 still fail, on the crafted constants of
those tests ((25! − 1)/24!, a constant near 1/3) and on pinned text; the 4
of D3 expect 100! from a log-space form that is not carried over.

G14, a list of points as an input (JavaScript). An input of type
`list<tuple<…>>` of real or integer numbers is the list of points of G11
(rank 2 with the tuple mark on the inner axis); a union of tuples of one
length is a tuple of reals where the members differ. Also a product or a
quotient of a list of points by a list of numbers of its length, a parameter
that is or takes a list of points, a declared result that is one. The entry
check does not read the rows (the rule of `checkEntry()`: its cost does not
grow with a list). Still declined: Tycho's `generations` (20 calls), which
appends to a list local in a loop: a list local of a changing length is a
new mechanism. Reviews (Codex: nothing. Claude: no wrong value in about
2,000 programs, the corpus records compile with their own MathJSON; an
internal error for a scalar argument after a list of points; an order
dependence on JavaScript from a missing guard of G11; `broadcast()` with
`entryChecks: false` refused every shared list input, an older defect),
fixed. Filed: CE-1329 (the difference of two arrays of rank 3 is not
computed), CE-1331 (a sum nested three levels over a list of points gives
`incompatible-type` in the interpreter).

Measured in the main tree at `e5c3026fe9c49951993a8984d3a37c1a02ddc680`
(0.192.0) plus the two patches; 7,482 lines in `ir/`:

| Measure | Admitted |
| --- | --- |
| Engine compilations | 10,839 of 11,157 (97.1%) |
| Every JavaScript compile | 25,332 of 39,252 (64.5%) |
| Public JavaScript `compile()` calls | 14,485 of 28,086 (51.6%) |
| GLSL `compile()` calls | 1,156 of 2,392 (48.3%); 1,077 of the 1,595 that the existing target compiles (67.5%) |

No test fails in the shadow run and no internal error is counted; with the
switch on, the one test of CE-1267.

Tycho's run of the build of `511a446b8c4dc43b50c9fac75c6735861b6be580` (G5
and G6; session `tycho-desk`, 2026-11-14), the profile on both seams:

- GLSL: CORE 152 of 267 compilations admitted (114 on the build before);
  every Desmos state 3,895 of 4,376 (89%; 3,466 before). No internal error.
  Every admitted result compiles in WebGL 2 (152 of 152, 3,895 of 3,895),
  the sampler inputs declared as Tycho declares them.
- JavaScript: CORE 638 of 989 admitted; every Desmos state 9,521 of 11,617
  (82%). 43,761 runs compared with the existing compiler with no difference,
  the rows that read a baked document value in a function body included.
- The float32 warning: 8 calls warn on the profile only, the exact-hash rows;
  the 41 warnings on constant operands are gone.
- The profile's sampler read does not run in a Tycho page yet: every `At`
  declines there while Tycho's handler is installed.
- Declines left on GLSL over every state: Tycho's handlers; colours;
  `Block` 30 (two documents); `Add` 8; `Function` 7; a bound that is not an
  integer 5; the pass bound 4; `PointX` 4; `Tuple` 2; a real `Factorial` 2.
- One Tycho test hangs after an unexpected success: `x·At(S, 3)` with `S` a
  sampler list of 2 elements compiled on the profile (a guarded read that is
  always NaN) where the existing target declines, and Tycho's retry of a row
  when its list grows is keyed on that decline. Decision: on GLSL a constant
  index outside the stated length of a list input declines, as the existing
  target does.
- Render audit of that build (CORE, WebGL on, the profile on both seams
  against the same build without it): no picture change. 21 states rendered
  and the same 3 did not paint on both arms, no shader compile failure in
  the page, 109 GLSL compilations admitted in the page; the one state that
  differs is the animated one, within its own variation. So the document
  values baked in function bodies show no wrong picture.
- Tycho reads `freeSymbolTypes[name]` of a captured name in two tests; a
  baked name is not an input of the profile's code and is reported through
  `symbolDeps`: Tycho's work at the switch.

Batch G4, 2026-11-14: Tycho's run with the profile on both seams (session
`tycho-desk`; build of `613d42af80582b5dff622714410fff969cccb6f2`).

- JavaScript seam, CORE audit: 628 of 997 compilations admitted (63%), no
  internal error, 2,988 runs compared with no difference. Seeded tests 694 of
  696 (the two budget tests, changed on Tycho's main since).
- GLSL seam, CORE audit: 114 of 275 compilations admitted, no internal
  error. All 114 admitted results compile in WebGL 2 as Tycho assembles a
  shader (preamble, then `T userFn(float x, float y)`, the other inputs as
  uniforms of their `lowered` type); the existing target's 114 texts are the
  control. Over every Desmos state: 3,466 of 4,384 GLSL compilations
  admitted, and 3,466 of 3,466 shaders valid.
- Render audit, CORE, WebGL on, the profile on both seams against the same
  build without it: 21 states rendered and the same 3 did not paint on both
  arms, no shader compile failure in the page, the same number of distinct
  shaders per state; 9 states draw at least one shader made from a profile
  result. One state (`neyret/oeupgr064p`, animated) differs by 2% of the
  pixels, within its own run-to-run variation measured on four renders. So
  no picture changes without the NaN-safe helpers and the finite proof: no
  helper is added.
- The float32 warning, every Desmos state: the profile warns on 129 calls,
  the existing target on 80; 49 warn on the profile only, in 7 documents. 41
  of them have a CONSTANT operand (`Mod(10000·Sin(100000), 1)`, a fixed
  pseudo-random number per curve), which the fold computes in doubles: the
  warning must not fire for a closed operand when the fold is on. 8 calls in
  5 documents are the exact sine hash of the existing target
  (`float32Bounds`): those rows lose their GPU lane.
- Tycho tests that pin the existing target's text (function names
  `_fn_<name>`, its branch-helper names, the text of a masked row, a sampler
  expression, an elided `Abs`): about 20, Tycho's work at the switch. Tycho
  renames helpers by prefix only, so the profile's names need no stable
  scheme beyond the same text for the same input.
- Largest causes of a GLSL decline over every Desmos state: Tycho's `Which`
  handler 259 and `At` handler 69; `Arctan2` 245; `AsOklab` 63; `Log` 42;
  `Factorial` 32; `Arcsin` 29; `PointX` 23 and `PointY` 17; a symbol with a
  value that is not a number 24; `Root` 18; `Block` 12 (a function that
  returns a list, admitted since G5). In the CORE audit also: a function
  that reads a document value that is not in `symbolic` (27 on GLSL, 7 on
  JavaScript: a valued name read in a function body declines, where the
  entry bakes the value).
- A condition of Tycho's switch (user, 2026-11-14): its ROADMAP row MG passes
  `callerLocals` on GLSL; the profile admits the option with no effect since
  G5, because every input a called function reads is passed as a parameter.

User decisions of 2026-11-14 on GLSL:

- **The existing GLSL target is to be deleted too** (about 25,500 lines of
  `gpu-*` and `glsl-*` files), with `javascript-target.ts` and the structured
  route: the definition of done covers both targets. Until then a GLSL
  decline falls back to it. The direct public API of the target
  (`GLSLTarget`, `compileFunction`, `compileShader`; 187 uses in the tests,
  none in Tycho) is removed with it: the user approved the removal of the
  public GLSL APIs (2026-11-14). `compile(expr, { to: 'glsl' })` stays. The
  removal is a breaking change, listed as such in the changelog of the
  release that makes it.
- **NaN through `min`, `max` and `sin` on GLSL**: no helper is carried over.
  Tycho's render audit on the GLSL lane decides: if a picture changes, the
  narrowest helper that restores it is added.
- **The warning of a float32-unsafe argument stays** (Tycho reads it to send
  a curve to its CPU lane), without the exact sine hash machinery behind it;
  what the warning costs to produce is to be measured.

User decisions of 2026-11-14:

- **How a host changes the lowering of an operator.** No hook in the new
  compiler. A host rewrites the MathJSON tree before it compiles (Tycho: the
  Desmos index rule becomes `At(L, Max(Floor(i + …), 0))` at compile time),
  and where today's operators cannot say a rule, the engine gets a library
  operator with that meaning (Tycho: a masked read that keeps the positions
  where the condition is defined and true, and a comparison of two lists by
  position up to the shorter one). The interpreter, JavaScript and GLSL then
  read one tree. A definition with a host `compile` handler or
  `compileHelpers` keeps declining on the profile until the host removes it.
- **The other extension mechanisms** (`OperatorDefinition.compile` and
  `compileHelpers`, the `compile()` options `functions`, `operators`,
  `imports`, `preamble`): the new compiler starts without them. What breaks
  is looked at then, and a mechanism comes back only if it is needed.
  What Tycho uses of them (read by `tycho-desk` at Tycho `d064b9f4d`): the
  in-place `compile` handler and `compileHelpers` on `At` and `Which`, and
  nothing else on a definition; the option `functions` in two places, both
  for the colormap of a colour expression (`style-expressions.ts`): one pure
  host function given as source text, `{ source: "((h, v) =>
  globalThis.__tychoColormap(h, v))", pure: true }` for JavaScript and a GLSL
  function text for GLSL. It passes no `operators`, `imports` or `preamble`.
  So the first thing that breaks is the colormap of a colour expression.
  Decided by the user on 2026-11-15, as this session and `tycho-desk`
  recommended: the option `functions` does not come back, and Tycho
  rewrites `colormap(h, v)` in MathJSON before it compiles. The palette
  handle `h` is always a literal at compile time, so the rewrite is three
  literal lists, a clamped index, a linear interpolation between two `At`
  reads, and `Oklab(…)` or `Rgb(…)`. No row of Tycho's corpus calls
  `colormap` (`tycho-desk`). Measured at
  `86ed657fc3530f444fada0cce0e888ef339cf9b0` with the profile: on GLSL each
  list is one local `float[n]` read with a computed index (text 17,079
  characters for three lists of 256 numbers, 63,796 for three of 1,024); both
  shaders compile and link in WebGL 2, and 24 values each agree with the
  JavaScript value within 2.5e-7 relative. Tycho refuses a GLSL result of
  more than 65,536 characters, so three lists of 1,024 leave no room; the
  printer writes a float as the 17-digit decimal of its float32 value, and
  the shortest form (9 digits at most) would cut such a list by about 40%.
  Tycho asked for that change (it uses a list of 1,024 when the 256-entry
  table of a stop list is not accurate enough): it goes in the next GLSL
  batch.
- **A loop whose result is not read is removed** and counts no pass of
  `iterationBudget`. Tycho changed the two tests that used such a loop
  (Tycho `d064b9f4d`).
- **The contract** (`docs/plans/2026-11-12-js-route-course-correction.md`,
  section 2) is approved, with rule 8 as written and seeded sequences stable
  across versions of the engine.
- **A timeout inside a cell of a batch stops the batch** (the change of the
  sixth batch to `broadcast.ts`, for both compilers): confirmed.

Order of the coverage from this list: (6) `broadcast: true` and the batch and
asynchronous members of the result; (7) the extended-real input types,
`Declare` with `constant`, a function that reads an input of the compilation
(passed as an extra parameter), `Degrees`; (8) `Tuple`, `PointList`,
`Comprehension`, list parameters of functions; then a second build for Tycho
after (6) and (7). `AsOklab` waits for a look at what a color value is.

Definition of done (user, 2026-11-12): the profile is the default for
JavaScript and GLSL with a decline falling back to the interpreter; Tycho's
corpus is the yardstick (its codegen audit over its documents and its seeded
tests pass on the profile), in preference to the synthetic suite measures;
the engine's consumers run on it with the suite green, worker pool included;
`javascript-target.ts` and the structured route are deleted; the pipeline
stays under 10,000 lines.

Other user decisions of 2026-11-12, after batch 3:

- The run-time `RangeError` of `Mod` beyond the safe integer range is
  removed ("a slippery slope"; done 2026-11-14): no guard at all for integers
  of 2^53 or more. `Mod` is a pure row.
- The shape of a complex result: whatever is simplest. A result is reduced
  to a number only where that is trivial; no machinery for it.
