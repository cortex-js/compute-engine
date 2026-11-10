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

### Step 5 — Recover the existing internal slice coverage

**Deliver, in order:** Sqrt and other justified scalar operations; typed function
entry/return; resolved named helpers; capture snapshots/dependencies; fixed-shape
local writes and branch merges. Reuse the prior slice fixtures so the independent
emitter reaches the behavior already demonstrated through legacy emission.

**Pass when:** every migrated feature has differential coverage, binding and
invalidation controls, and no generic emission fallback. Use single-definition
versions for local writes and explicit branch results. Keep unresolved calls or
shape changes as declines. General recursion and indirect calls can wait.

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

## Immediate next change

Implement **step 1 only**. Its first deliverable, the list of rewrites, is a
document and comes before its code. Steps 2 to 4 are then one experiment that
ends with a decision of the user. Where this document and the
[pilot design](2026-11-09-js-structured-scalar-emitter.md) differ on the
vocabulary, the baseline of the measure or the result of an inconclusive
measure, this document applies.

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
