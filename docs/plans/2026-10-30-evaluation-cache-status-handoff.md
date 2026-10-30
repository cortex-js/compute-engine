# Evaluation-cache plan: status, issues, and remaining work

Date: 2026-10-30. Written by session `compute-engine-3e` at the end of steps
0 and 1. The plan itself is
`docs/plans/2026-10-30-evaluation-cache-architecture.md` (the "plan" below);
its section 7 has the step table and its section 8 the user's decisions. This
document says where the work stands, what went wrong on the way, and what is
left. A reader needs only this file and the plan.

## 1. Status

### Done and committed

| Commit | What |
|---|---|
| `00869b80a` | CE-620: the element memo samples its whole starting state when `each()` returns, not at the first pull. |
| `d7c8fe8b9` | Plan decision 5: the type strings that hot run-time code passed to `matches()`, `isSubtype()`, `new BoxedType()` and `ce.type()` are now `Type` constants built once. On the Tycho `evaluate` benchmark the reads of the type parse cache dropped from 463,619 to 2,270. |
| `c814b92ae`, `fee72a864` | Plan revisions by session `compute-engine-aa`: step 3a counts, the timings for decision 1, the user's decisions. |
| `5029c5d77` | Steps 0 and 1 (1a to 1d) of the plan, details below. |

Steps 0 and 1 in `5029c5d77`:

- **Step 0.** `src/common/cache-switches.ts` turns each cache off with
  `CE_CACHE_OFF=<name>[,<name>…]` (or `all`), read once at module load. The
  workload driver `benchmarks/evaluation-caches.ts` runs 12 workloads,
  serializes every element of every result into a digest, fails a workload
  whose result is invalid or whose runs disagree, and exits 1 on a failure.
  `test/compute-engine/cache-switches.test.ts` checks that every switch name
  is read by a cache.
- **Step 1, the store guard.** `boxed-expression/store-guard.ts`:
  `beginStoreGuard()` samples the counts that tell a store to stop (host code
  that states no purity, a cut cycle, a stopped sequence read, a re-entrant
  signature read, an incomplete walk, an iteration limit, a provisional lazy
  value, a provisional cell), and `allowsStore()`, `moved(kind)` and
  `movedOnly(...kinds)` decide at the end. All 16 store sites of the plan's
  section 5.1 use it, and two more found by search (the declined-derivative
  record in `library/calculus.ts`, the Rubi memos). The counts moved into one
  object, `failClosedCounts`; the readers of each count keep their API.
- **Sites that keep their old rule.** The element memo, the eager source
  values, and the materialized `at()` cell accept exactly the counts they
  accepted before, because their store decision defines a result (one set of
  random draws per instance, host code run once). This was the user's
  condition for decision 6.
- **Defects fixed, each with a test:** CE-628 and CE-647 (the derivative
  chains kept a host value, and missed a retype), CE-648 (the Rubi memos kept
  a host value), the dictionary memo kept a host value, CE-621.1 (two
  concurrent `evaluateAsync()` calls shared one host walk), CE-621.3 and
  CE-621.4 (fixed by reading the code; no input was found that reaches them).
- **Beyond the plan:**
  - Concurrent `evaluateAsync()` calls of one node: a caller that joins a
    walk in progress uses the walk's value only when the walk passed its
    store guard and read no object field, and the caller's own generation,
    world version, lexical scope and hidden-assumptions state are the same;
    otherwise, and when the walk is rejected, it runs its own walk. A node
    that is not pure never joins.
  - The lazy-value memo gives its constant key (the one that no generation
    change expires) only when every operand is a call of a standard-library
    operator on constant values. Before, a user-function call (`f(1)` with
    `f(u) = u + x`), a dictionary holding one, or an operator that host code
    declared in the system scope kept an old value after `x := 5`. The check
    visits each distinct node once, so a shared dictionary tower stays linear.

Checks of `5029c5d77`: the full suite passed (72,878 tests) on `f169546e9`
with the patch; the paired benchmark (13 workloads: the 12 of the driver and
the Tycho `rebind` replay, 3 alternating rounds) gave median ratios from 0.93
to 1.06, under the 1.25 limit of decision 6; every digest was the same before
and after.

### Not done

| Step | State | Owner |
|---|---|---|
| 2 | Not started. The numeric context stamp (plan 6.3); also fixes CE-645. | Session `compute-engine-aa`, told on 2026-10-30 that it can start. |
| 3a | Done (counts in plan decision 3). | — |
| 3b | Not started. The dependency stamp per value cache, and decision 3 (c): a flag on the `type-write` event, explicit retypes and extensions move the world version. Requires steps 1b and 2. | Not assigned. |
| 4 | Not started. The dictionary memo: no accepted host count, the settings of the shared memo. Requires step 2. | Session `compute-engine-aa`. |
| 5 | Not started. Remove the contour memos (`symbolic/contour.ts`) and the enclosure endpoint cache (`library/enclosure-arithmetic.ts`, `SETTINGS_PAYLOADS`), one commit each; keep the factor memo (decision 1 (a)). | Session `compute-engine-aa`. |
| 6 | Not started. Decide per cache whether the semantic version is still needed next to the dependency snapshot. Requires 3b. | Not assigned. |
| 7 | Not done, by decision 2 (no per-call key for the type and sign caches). | — |

The plan's step 1c ("narrow each accept list, one site per commit, with a
test that counts host calls or draws") was merged into 1b by decision 6.

## 2. Issues encountered

### 2.1 Thirteen review rounds for steps 0 and 1

The store guard and its conversions were stable after the third round of the
dual review (Codex and a Claude reviewer). Rounds 4 to 12 found defects that
HEAD also had, in two areas, and each fix gave the reviewers new code to
review:

- **Concurrent `evaluateAsync()` calls of one node** (rounds 3 to 8). The
  joined walk read the memo outside the caller's context (a regression of
  round 2, fixed in round 3), a rejected walk failed every caller that
  joined it, a declared-impure operator's value was shared, and a host
  handler that re-evaluates its own node waits on itself. Three fixes of the
  last one each gave a new defect (unbounded recursion; a deadlock through
  two nested walks; a wrong value from a fallback that does not run
  async-only operators), so it was filed as CE-649.
- **Impure values read through a symbol** (rounds 8 to 12). `isPure` of a
  node does not follow the value of a symbol it reads, so `Reverse(List(5,
  r))` with `r := Random()` is stored. Four designs of an `impure` count were
  tried; each was too broad (it stopped the sequence memo from defining one
  draw per term, and slowed a sequence workload from 45 ms to 963 ms), or
  missed cases (a raw value, `ReleaseHold`, a lambda applied by `Map`), or
  wrong (a seeded draw served under another seed), or not reviewed to the
  end (a take-back of seeded draws, which makes a count go down). By user
  decision (option (b)), the work was removed and filed as CE-657.

The user then asked to step back. The lesson, kept in the session memory:
when review rounds keep finding defects that HEAD also has, stop after about
three rounds and offer to split the work out, instead of sending another fix
batch. A change to the `AGENTS.md` rule "fix the defects found during the
task in the same change" (an older defect found by a review is filed, unless
the change made it worse) was proposed to the user and is not decided.

### 2.2 The benchmark driver of the audit measured errors

The audit's probe driver built `Map(collection, function)`, which the
engine rejects (the signature is `Map(function, collection)`); the
`map-compile` workload ran at 21-digit precision, where `Map` is not
compiled; and the digest used `toString()`, which prints only the first and
last five elements of a lazy collection. So the audit's "no measured
benefit" of these caches was not a valid measurement. Step 0 fixed the
driver, and session `compute-engine-aa` measured decision 1 again on the case
each cache was added for (plan section 3.5).

### 2.3 Smaller points for the next steps

- The derivative cache must read its versions AFTER `derivative()`
  normalizes its input: the first evaluation of `f(_)` moves the definition
  version, and an entry stamped before it never matches
  (`item-284-derivative-compile-cost.test.ts` failed that way).
- With `CE_CACHE_OFF=type`, a non-trivial recursive function type is
  computed again at each level and can take minutes; the driver skips three
  workloads with that switch.
- The `at()` cell must not be cleared for a provisional answer:
  `cachedValue()` keeps the previous value of the cell on purpose, because
  it ends a recursive read of the same cell.
- The facet memo and the sequence term memo now refuse more counts than
  before step 1 (fewer stores; no result change was found). CE-657 lists
  them among the caches that define a result; its design must decide their
  rules.
- A patch made in a worktree on an old base can conflict with new commits:
  `git apply -3` in a fresh worktree at HEAD merged it each time; the only
  conflicts were import lines.

## 3. Remaining work, in order

1. **Step 2** (session `compute-engine-aa`). Then **steps 4 and 5**, which
   can go in either order after step 2 (step 5 needs only step 0).
2. **Step 3b**, after step 2. Assign it first. It implements decision 3 (c);
   the derivative cache's CE-647 fix (it reads `_definitionVersion`) can then
   read the world version instead. Each cache gets a retype test and an
   extension test (plan section 7, step 3b).
3. **Step 6**, after 3b.
4. For every step: the full suite under the box lock (the changes are under
   `boxed-expression/`), the paired benchmark against a baseline of HEAD
   with the driver added (no workload's median ratio above 1.25), and the
   dual review. The element memo and the eager source values keep their
   accept lists unless a step says otherwise, with a test that counts the
   draws and the host calls.

## 4. Open decisions for the user

| Item | Question | If nothing is decided |
|---|---|---|
| CE-649 | An async host handler that evaluates the node containing it waits forever. (a) carry the evaluation context across `await` (`AsyncLocalStorage`, Node.js only), or (b) never join a walk for a caller that host code started (two concurrent evaluations then run the node's host code twice). | The hang stays, as before. |
| CE-657 | A cache keeps a random draw or an impure operator's value when the node does not look impure. Needs a design: which caches define a result, and how a seeded frame is identified so that its draws are cached only with it. | Wrong values stay, as before. |
| `AGENTS.md` rule | File an older defect that a review finds, instead of fixing it in the same change, unless the change made it worse? | The current rule stays. |

## 5. Other open items

- **CE-621.2** (`ROADMAP.md`): a nested asynchronous evaluation releases its
  parent's host-derived source values. Needs one count of the evaluations in
  progress for each evaluation number, shared by the sync and async routes.
- **CE-645**: the element memo can store elements computed inside a
  temporary precision window; step 2 fixes it.
- **CE-615**, decided (b): `{ extend: true }` applies only to expressions
  boxed after the extension. The user documentation of this, and a new
  "Caching" section on `pure: true`, are in
  `~/dev/cortexjs.io/docs/compute-engine/06-guide-augmenting.md`, not yet
  committed in that repo.
