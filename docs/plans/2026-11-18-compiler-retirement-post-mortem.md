# Retiring the existing compilers, 2026-11-08 to 2026-11-18: post mortem

The workstream replaced the existing JavaScript, GLSL and interval compilers
with one compiler, the pipeline of `src/compute-engine/compilation/ir/`. The
deletion is commit `e16216680ad989db8c278027e4e9c18e86a9e86f` (0.194.0). The
running record of the work, with every measure and decision, is
`docs/plans/2026-11-09-js-compiler-status-and-plan.md`; the contract of
compiled code is `docs/plans/2026-11-12-js-route-course-correction.md`,
section 2.

## 1. The result

Measured against 0.186.0 on Tycho's corpus (9,974 JavaScript, 3,992 GLSL and
5,155 interval programs; method and raw data in the comparison of
2026-11-18, `CHANGELOG.md` "Performance"):

| Measure | 0.186.0 | 0.194.0 |
| --- | --- | --- |
| Lines of `compilation/` | 166,419 | 30,668 (`ir/` 12,994) |
| Lines of `src/**/*.ts` | 789,506 | 662,158 |
| Code the engine loads, minified | 5.9 MB | 4.9 MB |
| Run time per call, compiled JavaScript | 1 | 0.72 (median ratio) |
| Compile time, corpus total, JavaScript | 12.9 s | 6.9 s |
| Compile time, corpus total, GLSL | 3.2 s | 0.8 s |
| Programs that compile: JavaScript / GLSL / interval | 9,491 / 3,832 / 4,835 | 9,351 / 3,858 / 4,859 |
| Programs on which compilation throws | 484 | 0 |

Of the programs both versions compile, 51 give different values; none is a
confirmed wrong value of 0.194.0, and 3 are wrong values of 0.186.0.

What was given up, by decision of the user: the options `functions`,
`operators`, `imports`, `preamble`, `strictTypes`, `broadcast` and `target`;
custom targets; text-returning compile handlers; `parallel for` on the
worker pool (to return in a follow-up phase). What was lost without a
decision and is filed: `epsil --compile` of a program that defines a
function (CE-1443); 158 corpus programs that 0.186.0 compiled, mostly list
shapes the pipeline declines (a decline runs the interpreter).

## 2. How it went

1. **2026-11-08 to 11-09, the fragment route.** The first plan annotated
   fragments and drove parts of the existing JavaScript compiler from the
   annotation. The review of 2026-11-09 found that the annotation read the
   existing compiler's own state, so a test that compared the two compared
   one answer with itself, and that the pilot added code and removed none.
2. **2026-11-10 to 11-12, the structured route.** A new compiler (the
   `numeric-kernel` profile) built under the contract "give exactly the
   existing compiler's result, or decline". It reached 77.7% of the suite's
   JavaScript compilations, at 40,541 lines: twice the size of the code it
   was to replace (21,001 lines). It was correct and well tested.
3. **2026-11-12, the course correction.** The user withdrew the contract
   "equal the existing compiler" and replaced it with "the interpreter's
   value within the stated caveats; a decline is always acceptable", with
   no fidelity owed at poles, NaN, infinities, signed zeros or integers of
   2^53 or more. The structured route was frozen and the pipeline started
   from scratch under a line limit (12,000 lines, raised to 13,000 on
   2026-11-17): one operator table, one lowering walk that declines by
   default, an SSA representation, passes, one printer per target.
4. **2026-11-12 to 11-16, coverage batches.** Each batch was measured by the
   same three admission counts (engine compilations, every JavaScript
   compile of the suite, public `compile()` calls), a shadow run of the
   whole suite, the corpus replay and the line count. The interval mode was
   built in parallel by another session (`ce-interval`).
5. **2026-11-17, the consumer trial.** 0.193.0 was published and Tycho ran
   its corpus on it (trial t14): no value defect of the pipeline among 122
   differences, and two performance problems no test had shown (the GLSL
   `pow` helper, and the per-pass checks, which ran in production and
   dominated compile time). Both were fixed the same day.
6. **2026-11-17 to 11-18, the deletion,** in four stages: route every target
   to the pipeline (stage A: 8,303 failing tests), delete 111 modules and
   their tests (stage B: 6,472 failing tests), triage the rest by the user's
   rules with four parallel agents (stage C), remove the dead API and
   rewrite the documentation (stage D). The full suite passed before the
   commit (1,906 suites).

## 3. What worked

- **The contract changed before the second rewrite, not during it.** Under
  "equal the existing compiler" every exception of the existing compiler was
  a requirement, and the structured route grew to twice its size. Under
  "correct within the caveats, or decline" a missing case costs a decline,
  not a handler. Most of the size gain comes from this.
- **Decline by default, with the interpreter behind it.** Every unsupported
  construct fell back to a correct value, so coverage could grow batch by
  batch and the switch to one compiler did not need parity first.
- **A hard line limit.** The limit forced each addition to be weighed
  against the code it added. The pipeline ended at 12,994 of 13,000 lines.
  The user refused to move files out of `ir/` to meet it, which kept the
  number honest.
- **The same measures every batch.** The three admission counts, the shadow
  run and the corpus replay (13,966 programs, with a hash of each emitted
  code) made each batch comparable to the last and showed every program a
  change touched.
- **A real consumer on a published build.** Tycho's trial found the two
  performance problems that the suite could not see, before the deletion
  removed the comparison point.
- **Decisions recorded where the work is.** The user's decisions went into
  the status document as they were made (no fallback phase, the dropped
  options, tests whose programs decline are deleted rather than turned into
  decline tests). Stage C used them directly as triage rules.
- **Ownership by session.** The interval target was deleted and re-built by
  `ce-interval` while this session did JavaScript and GLSL; the two met only
  through main.

## 4. The challenges

- **Two routes before the one that shipped.** The fragment route and the
  structured route took four days; the structured route alone was 40,541
  lines, frozen and then deleted. The cause in both was the reference: each
  measured itself against the existing compiler, so each inherited its
  structure or its exceptions.
- **Tests that pinned the old compiler's text.** Most of the 8,303 failures
  of stage A were tests that compared emitted code, decline messages or
  option behaviour of the existing compilers, not values. Their triage was
  the largest single task of the deletion. The automatic classification of
  failures was wrong for several hundred tests (216 in one group alone:
  decline tests whose message had changed, filed as "expects a compile"),
  and one agent's first bulk deletion had to be undone by a three-way merge.
- **The line budget at the end.** The last fixes (CE-1191, CE-1309, the GLSL
  `Mod` correction) each had to fit in a few lines. The user lifted the
  limit on 2026-11-18, once the pipeline had replaced the existing
  compilers.
- **Performance found late.** The GLSL `pow` helper and the per-pass checks
  were found by the consumer trial, not by a benchmark of the workstream.
  The exact integer `pow` cost 1.54 times on GPU and was traded for the
  built-in `pow` on a non-negative base.
- **The shared machine.** One commit (`d80ad8777`) took another session's
  uncommitted deletions of two issue files with it; patches conflicted with
  peers' commits on landing; full-suite runs waited on the box lock; agents
  broke a git rule twice (`git apply -R`, `git add -N`) without harm.
- **Review capacity.** Codex was at its usage limit for the last two days,
  so every commit of the deletion had one reviewer; the second review is
  owed.

## 5. What to learn

1. **Fix the reference before building a replacement.** State what the new
   code must give (here: the interpreter's value within the caveats) and
   never the old implementation's output. A rewrite measured against the
   thing it replaces inherits it.
2. **Make a decline cheap and correct.** A fallback to a slow, correct path
   lets a replacement ship before parity and keeps every gap visible as a
   count, not a bug.
3. **Set a size budget at the start, and do not game it.** The limit shaped
   the design more than any review.
4. **Test values against the interpreter, not emitted text.** A test of
   emitted code fails on every rewrite and checks nothing a value test does
   not. New compiler tests should compare with the interpreter.
5. **Run a real consumer on a published build before deleting the old
   code.** It found what the suite did not.
6. **Check an automatic classification on a sample before acting on it in
   bulk.**
7. **On a shared tree, commit an explicit file list** and compare it with
   `git status` of the files before the commit.

## 6. Open after the workstream

- Concurrency: `parallel for` on the worker pool, the follow-up phase the
  user decided; `runAsync()` gives `run()`'s value until then.
- Issues CE-1432, CE-1323, CE-1443, CE-1444, CE-1440: reviewed by the board
  and in progress.
- Codex reviews owed for the commits of 2026-11-17 and 2026-11-18.
- Sections of `docs/COMPILATION-MODEL.md` that still describe mechanisms of
  the deleted compilers ("Compile modes", "User functions and dispatch",
  "Collections", "Color values"); the batch-body runtime
  (`StoredBatchBody`, `loadBatchBody`), now dead; ROADMAP entries CE-1110,
  CE-1149 and CE-280.10, which are about deleted files.
- Tycho's adoption of 0.194.0: its 2,873 corpus programs that pass the
  removed `broadcast` option must drop it.
