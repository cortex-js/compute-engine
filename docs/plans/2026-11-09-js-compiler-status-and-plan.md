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
  and the guide to say "declare, or call `ce.infer()`".
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

The switch-off run at `4422cd7bf64eca17935bd7655e6a5f0a972a3199` failed only
on the timeout of CE-1197, which does not depend on the switch. The prelude
census was not run again: none of these changes is in the list of what blocks
the 15 prelude functions.

### The gap to retirement: every JavaScript compilation of the suite

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
