# JS profiles and fragment migration: second experiments

Review evidence, November 9, 2026. No production compiler or Tycho changes are
proposed by this bundle. The source experiment is retained as a patch against
CE `43679ce5df346479eb94b25a5882f798eafd5c74`; Tycho experiments use
`8777c57e37e0e7962b7cdca8093f986c7e5cec6c` and its installed CE 0.184.0.

## What these experiments support

Keep the two proposed profiles: numeric and general program. Internal use is a
consumer contract, rather than a third vocabulary. A numeric consumer may need
loops, local mutation, indexed arrays and resolved user functions: Buddhabrot
makes that concrete. Scalar result shape, purity, captured state and worker
portability are separate constraints. A solver and a histogram job can share a
numeric vocabulary while requiring very different calling conventions.

Keep compilation admission separate from execution planning. An intended worker
execution should request explicit capabilities (portable captures, permitted
effects and result representation). It should not turn an otherwise compilable
program into an implicitly parallel algorithm. Partitioning, reduction,
publication and cancellation remain explicit host responsibilities.

Do not require CPS or SSA before the JS migration. The real fragment pass can
already supply selected emission facts. First settle annotation ownership and
invalidation at the prepared-expression boundary, then migrate complete groups
of decisions. Revisit SSA when an identified optimization needs dataflow across
mutable locals; revisit CPS if resumable execution becomes a concrete compiler
requirement. Worker termination alone does not require CPS.

## Actual workers: useful speedup, bounded environment

The real Epsil Buddhabrot step ran through stored code and the public JS runtime
loader in Node workers. At 1.2 million samples, median caller execution was
251.70 ms; four workers with 100,000-sample chunks took 70.55 ms (about 3.6×).
One worker took 264.82 ms. Small workloads and oversized chunks show why a
universal parallel threshold would be premature. Three repetitions per route
are exploratory evidence, not a browser tuning prescription.

All histogram entries and the cursor matched both serial compiled execution and
an independent reference. The harness exercises duplicate suppression, stale
results and atomic publication. It also checks termination and worker cleanup;
receipt of a start message is not proof that generated code has begun running.
Pool startup, worker phase totals, transfer round trips and merge costs are
recorded separately. Overlapping worker totals must not be subtracted from wall
time to invent a transport measurement.

See [worker experiment](buddhabrot-workers.md),
[raw results](evidence/buddhabrot-workers.json), and the retained worker scripts
under `instruments/`. This is a custom Node scheduler over the installed runtime,
not adoption of current CE concurrency APIs or Tycho's browser worker hierarchy.

## Resolved bodies materially change the inventory

The selected 15 showcases produced 154 gateway calls: 116 JavaScript,
20 interval-JS and 18 GLSL. All compiled under the existing targets. Following
bound definition identities exposed 43 distinct body hashes in 40 calls;
22 calls include Loop. Buddhabrot's named step is now visible.

146 calls fit the study's broad candidate syntax and eight remain unresolved.
These numbers do **not** establish profile admission: the instrument does not
prove all transitive types, settled shapes, local-only mutation or portable
captures. In particular, metadata strings must not be counted as runtime string
operations, and lexical captures must follow definition identity rather than
whatever an ambient name resolves to later.

Life's real action changed a materialized 22,500-cell state binding and its
contents. Explicit reader snapshots demonstrate that lifecycle transition;
they are not proof of the renderer's post-action sampler route. Load-phase
formula state and post-materialization state need separate fixtures.

See [resolved-body report](profile-report.md),
[scope and limitations](profile-scope.md) and
[coverage results](evidence/coverage-summary.json). Selected coverage represents
21 of the previous 22 workload candidates; it excludes the Desmos shape-negative
candidate and is not a fresh full CORE census.

## Real fragment integration: feasibility, not performance

The isolated target uses the existing preparation, real `typeFragment()`, JS
emitter and runtime assembly. Ten selected query sites consume annotation facts;
exact prepared-node identity is enforced. Admission fixes every complex-lane
answer to false, so this proves plumbing and identity, not a varying annotation
changing an emission decision. No duplicate reader implementation has
yet been deleted. The narrow scalar slice declines unsupported cases and leaves
the public target unchanged.

264 targeted tests, source typechecking and changed-source lint passed. A paired
probe checked 48 values across eight fixture/options rows. Compilation timings
were sub-millisecond and mixed (experimental/legacy ratios 0.67–1.27), providing
no reliable speed claim. No snapshot changes were required.

See [integration experiment](annotation-experiment.md) and
[isolated patch](instruments/annotation-experiment.patch). This validates neither
general programs nor mutable locals, complex arithmetic or concurrent execution.

## Recommended next step

Specify one shared prepared-expression/annotation contract before implementing a
public alternative target: who owns nodes, when rewrites invalidate facts, how
binding identities and target-specific numeric lanes are represented, and which
facts admission and emission may consume. Use the existing scalar experiment as
the acceptance fixture, then migrate one complete family of queries and measure
which duplicate readers can actually be removed.

In parallel, use Buddhabrot as a browser execution-contract experiment: repeat
stored-runtime loading and private-buffer reduction in Tycho's real worker
hierarchy, with supersession, teardown and transfer measurements. Keep this
separate from profile design and do not infer defaults from the Node timings.

For profiles, turn a small selection of resolved callbacks, captured sliders,
loop bodies and Life lifecycle phases into positive and negative admission
fixtures. Record declines with reasons; distinguish unresolved provenance from
an unsupported vocabulary. Defer another broad corpus run until an actual
admission implementation exists to measure.

These are recommendations for review, not new ROADMAP entries or authorization
to adopt the experiment. The broad suite/build and production documentation were
left out because the delivered changes are research artifacts, with no public
behavior change; targeted evidence and independent reviews cover the scripts.

## Replaying the evidence

Create private worktrees at the revisions above using each repository's worktree
procedure and install/link its matching dependencies. Apply
`instruments/annotation-experiment.patch` with `git apply --check` followed by
`git apply` only in the CE experiment worktree. Run the probe using `CE_ROOT`
and `OUTPUT_DIR` as shown in the integration report. The patch is evidence to
review, not a change intended for the shared source checkout.

Copy the three `profile-workers*` current scripts into Tycho's `scripts/repros/`,
and all `profile-coverage*` scripts into Tycho's `scripts/`. Reports give exact
commands and environment variables. The coverage comparison script expects
`initial-coverage-full.json` and `coverage-full.json` in `/tmp/js-profile-next`;
uncompress the archived `.gz` files there to replay the retained comparison.
The original timing harness versions are archived under `evidence/`; current
worker scripts contain the reviewed lifecycle correction. Do not replace the
original timing JSON with the controls-only output. Timing and corpus replays
require the shared-machine lock.

The corrected coverage observer and initial observer produced identical 144
deduplicated records excluding timing and IDs. This is an observer-to-observer
control, not an uninstrumented equivalence proof. The prior full CORE instrument
has a separately documented unmodified control and different scope.

Independent Codex and Claude reviews are complete; evidence defects were fixed
and focused checks rerun. See [review status](evidence/review-status.json) for
scopes and [run status](evidence/run-status.md) for validation.
