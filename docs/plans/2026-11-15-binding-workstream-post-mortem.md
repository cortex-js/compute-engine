# The binding workstream, 2026-11-09 to 2026-11-15: post mortem

Status: DRAFT, written 2026-11-15 by session `ce-desk` at the user's
request. It holds the results of the two measurements of that day: option
(d), built and tested, and the split of the 0.187.0 flag by mechanism. The
agent of the flag split stopped at a usage limit after its timing runs and
before its report; its figures are read from its result files.

Where a figure comes from: a commit hash, a file in the repository, or a
report in `~/dev/compute-engine-recovery/` (outside the repository). "0.186.0"
is `c4856e003557e367d4a2272d37d1567e9dd7a9b3`, the last commit before binding
units. "The cases" are the benchmark cases D01 D03 D05 D06 D07 D08 A01 CR2
CE1 CE2 CE3 of `benchmarks/cases.json`; each call boxes its input and
evaluates it. A ratio is a time divided by the time of 0.186.0 in the same
run, unless it says otherwise.

## 1. What the objectives were

1. **Remove three kinds of defect that a host meets** (the model,
   `2026-11-09-binding-units-model.md`, section 1; Tycho's ranking): boxing
   writes the type of a free name and a later expression meets it; a reading
   depends on what was declared when the expression was boxed; a declared
   type is enforced at assignment with no message. The rule that answers
   them: the state of the engine holds explicit definitions only, and "parsing
   declares nothing".
2. **Less code in the engine and in Tycho, and simpler rules.** "It is not
   compatibility, and it is not the smallest change for Tycho" (user,
   2026-11-11, `2026-11-11-bound-once-spec.md`, section 1). The spec listed
   what Tycho would delete: about 3,900 lines with the macro kind, about
   3,500 (and 2,660 more) with the batch, about 850 with the compile options,
   about 250 with `ce.withValues()`.
3. **Types settled before a run, and machinery deleted**, each change
   reported by the lines it adds and removes under `src/` (the user's prompt
   for part 2, `docs/scratch/2026-11-14-binding-part2-handoff.md`).
4. **Speed.** The bound-once spec names the slowdown of slice 1 (CE-1210) as
   a cost that the rule removes. On 2026-11-15 the user stated the target:
   the speed of 0.186.0, and that the simplification was expected to improve
   performance.

## 2. What was accomplished

**The rules for a host are in place and Tycho runs on them.** Seven releases
in five days (0.187.0 on 2026-11-11 to 0.192.0 on 2026-11-15): boxing declares
nothing; an expression reads names from the scope it was boxed in; a popped
scope keeps its definitions; `ce.infer()`, `ce.temporaryName()`, the macro
kind and `ce.macroNames`; the compile options `inputs` and `symbolic`;
declared block locals; a type does not depend on a value (D16); a run keeps
cached types (D17). Tycho adopted each release and its gates passed on each.

**An interpreted call is faster than before the work.** Tycho's othello
call: 147 to 150 ms on the D17 build against 473 to 517 ms on 0.187.1 with
units off. Its codegen audit: 30 s against 41 s. The sum of 15 showcase
preludes is equal (2,395 to 2,410 ms against 2,309 ms). Source:
`issues/CE-1210.md`.

**Mechanisms were deleted in the engine**, among them the checkpoint API
(`22625acf6365e34a01ff3e4b58e393266f835311`, source −2,636), the resolution
from the current scope (`d2f392f08a39b831669fa22430ad853096f993ad`, −8,498),
the auto-declaration at boxing
(`18ecd3896c5482eaab649e6ff6ea6d2cff7dea9b`, −1,182), the inference rollback
frame (`e99922f1e38b63d5919cdb6c43832198336f79be`, +591 −843), the
forward-call references (`a552c29cd098597f027bc777ce6603b7677bd11d`, +273
−404) and the closure rebuild
(`a67cb8a26c292584cff376ce8785c3c10c9e2a82`,
`a9e831df1bfedc2b2a3155757c9e674735c4e3de`, +262 −763).

**What was not accomplished:**

| Objective | Result | Source |
|---|---|---|
| Less code in the engine | The 15 files of the binding core: 52,963 lines at 0.186.0, 56,725 at 0.187.0, 53,335 at `7c74ab286db468549e092c1b0ac3f12cd2722508`. The 49 binding commits: source +17,506 −17,540. About zero net. | `wc -l` at each commit; `return-to-0186-costing-report.md` |
| Less code in Tycho | 1,728 lines are deletable on 0.192.0, of which 204 have no prerequisite; none is counted as deleted. 3,756 + 3,184 lines wait for the batch and 2,711 for stored bodies as units, neither of which is built. | `2026-11-15-tycho-deletion-inventory-ce-0.192.0.md` |
| Speed of 0.186.0 | The cases run at 1.245 (rounds 1.216 to 1.250). Release by release, as a ratio to 0.162.0: 0.186.0 1.13, 0.187.0 1.62, 0.188.0 1.68, 0.189.0 1.75, 0.190.0 1.78. | `issues/CE-1210.md` |
| Types settled before a run | In part. A type read still depends on entries that are written during a run: per evaluation of a case, 313 symbol type reads, 304 cached types validated again, 2.5 environment writes. | `retreat-costing-report.md`, section 1 |
| Simpler rules | 25 breaking changelog entries in seven releases; decisions D5 to D18 added to the bound-once spec after its first implementation; D15 withdrawn and replaced by D18. | `CHANGELOG.md`; the spec, section 11 |

## 3. The issues we ran into

**3.1 The design moved a cost onto every type read.** In 0.186.0 the type
that a use requires of a name was written on the name's definition, and a
cached type was valid while one engine-wide number did not move. With units
the requirement lives in an environment of the expression's unit. A type
read of a symbol finds its entry, meets it with the definition's type and
records the read; a hit of a cached type checks every recorded read again.
The split of the 0.187.0 flag by mechanism confirms where the cost is
(5 alternated rounds each; `ce1210/flag/time-ladder.txt`,
`time-oneach2.txt`):

| Configuration on 0.187.0 | Ratio |
|---|---|
| all groups on | 1.303 (rounds 1.283 to 1.328) |
| flag off | 1.013 |
| only the type read of a symbol through its entry on | 1.149 |
| only the write of a requirement to an environment on | 1.108 |
| only the free-name sites on | 1.075 |
| only the unit environment at boxing on | 1.036 |
| only one of the six other groups on (operation, trial, recorded reads, stamps, rebind, literal scope) | 0.995 to 1.015 |
| read, environment, free and write off, the six others on | 1.033 |

The cost is in how a name's requirement is read and written through an
environment. The six other mechanisms cost about 0.02 together. The step
that maps these groups onto main's code was not done.

**3.2 The cost falls mostly on names that needed no change.** Of 309 entry
reads per evaluation of a case, 52 are by a free name, the subject of
objective 1. About 147 are by a parameter of a function literal and about
110 by a binder variable or a block local (the split of these two is an
estimate). A definition that a boxing made was moved to the environments
with the free names (D18 item (d)), and it keeps reading them after its
construct is boxed.

Option (d) tested whether those definitions can simply leave the
environments (`ce1210/option-d-report.md`). They cannot, as built. A
binder variable gets its type from the uses that an evaluation makes of
it: the antiderivative code makes the integration variable again inside
the binder's scope, and `Abs(x)` or `Cos(x)` then writes `x: number` in the
environment of the operation. Without that write the variable stays
`unknown` and 12 tests of `Integrate` and `D` return unevaluated. The
parameters alone can leave (one pinned code string changes), and that
gains 0.010.

**3.3 The slowdown was measured on the first day and set aside.** CE-1210
was opened on 2026-11-11 with a parse-and-simplify loop at 1.3 times and
the rule loading at 1.7 times. The decision that day was that Tycho declares
its names and comes back if the cost remains. The flag that turned units off
was removed the same day (`830047dc6ce4962f59bb7780998c443ad04f28c8`), so no
later build could be compared with its own off path. The speed measurement
of the bound-once prototype (M3) was "not conclusive" on a loaded machine
and the quiet-machine measure "still owed" was not made. On 2026-11-12 the
remaining gap was recorded as not blocking step 1.

**3.4 The gate measured what improved and not what regressed.** Every
landing was gated on the test suite and on Tycho's instruments (the othello
call, the audit, the preludes). Those improved. The symbolic cases were not
a gate, and their ratio rose at each release without a decision being
taken on it. No change was gated on its line count.

**3.5 Each leak of the model was closed with a mechanism.** Recorded reads
and read tokens, the environment of an operation, the environment of a
trial, the parameter record of a literal (D18), the restore point of the
Epsil static check, activation records. Each was correct for its case and
passed review; the sum is `binding-unit.ts` (1,170 lines),
`object-deps.ts` (462, from 316), `engine-infer.ts` (270),
`ambient-chain.ts` (273) and the read path of `boxed-symbol.ts`.

**3.6 The deletions that were to pay for the mechanism came last.** Tycho's
large deletions depend on the batch (slice 3) and on stored function bodies
as units (slice 2). The work spent its five days on slice 1, on bound once
and on their repairs. The probe of slice 2 (2026-11-15,
`~/dev/compute-engine-recovery/stored-bodies/probe-report.md`) nets about
−515 engine lines and adds events at a read; it was stopped.

**3.7 The check for stale types has a blind spot.** `CE_TYPE_PARANOID`
skips a type served at the type version it was computed at, and a write in
a unit environment moves no version. CE-1342 is a stale cached type that it
does not report and that 0.186.0 does not have. The clean runs of that
check behind each landing do not cover this class.

**3.8 The analysis of the slowdown went wrong several times.** Three
investigations concluded that the same code ran slower for the same call
counts and looked for causes in V8 (object size, code size, hidden classes,
inline caches: each ruled out by measurement). A count of every call then
found 14,000 extra calls per evaluation, and `ce-desk` told the user that
the time follows the calls. A branch that removes them (47,922 calls per
evaluation against 47,039 on 0.186.0) runs at 1.202 against 1.245: the
claim was wrong. `ce-desk` also relayed two estimates of option ceilings as
findings, and endorsed a line count (+7,461) as growth of the binding work
when most of it is library and symbolic work.

## 4. What we should have done differently

1. **Gate every change on time and on lines.** One fixed set of cases
   (these eleven and Tycho's three instruments), measured against a fixed
   baseline build under the box lock, and `git diff --shortstat -- src`,
   both in the landing report. A change that is slower or larger lands only
   with a decision that names what pays for it and when.
2. **Keep the off switch until the on path is at parity.** The flag was the
   only like-for-like instrument, and it showed the cost exactly (off 1.007,
   on 1.304 on 0.187.0, measured again on 2026-11-15).
3. **Measure the prototype's speed before approving the rule.** M3 was owed
   and the rule was approved without it.
4. **Change the store only for the names that have the defect.** The
   defects of objective 1 are about free names of a host. Parameters, binder
   variables and block locals have a definition that a boxing made and no
   host can meet; they could have stayed on the definition store.
5. **Deliver a deletion with each slice.** A slice is done when the code it
   makes unnecessary is deleted, in the engine and in Tycho. Slice 1 would
   then have been judged on 204 deletable Tycho lines before slice 2 was
   planned.
6. **Stop at the first added mechanism and look at the rule.** The model
   document itself records two earlier attempts that "each cost more than
   planned, for the same reason"; the same pattern then repeated inside the
   new model without that test being applied.
7. **Fewer, larger releases for a breaking model change.** Seven releases
   with 25 breaking entries made Tycho adopt release after release and made a return
   more costly each day.
8. **Report an estimate as an estimate, and time a change before
   explaining it.** A like-for-like timing of the call-removal branch would
   have taken less time than the explanation that preceded it.

## 5. Potential paths forward

Measured or costed on 2026-11-15. Reports:
`~/dev/compute-engine-recovery/ce1210/retreat-costing-report.md`,
`return-to-0186-costing-report.md`, and (when written) `option-d-report.md`
and `flag-split-report.md`.

| Path | Cases | Tycho's interpreted call | Engine lines | Work and risk |
|---|---|---|---|---|
| A. Option (d): a parameter, binder variable or block local reads its definition once its construct is boxed | Measured, two runs: 1.110 and 1.115 against main's 1.177 and 1.189. Parameters only: 1.179 against 1.189 | Not measured | +30 −56; parameters only +17 −26 | NOT LANDABLE as built: 12 wrong values (`Integrate` and `D` unevaluated). The sound half gains 0.010 |
| A2. One counter that moves at every environment write, no recorded reads (with or without the call-removal branch, 1.202 measured, +136 lines) | Estimate: 1.13 to 1.17 | No change expected | Estimate: about −300 | Medium. Loses the memo of a derivative across operations; about ten cache families get a new key; removes CE-1342's case |
| B. Redesign on main: a definition that a boxing makes is typed at its construct and never through an environment; lexical binding and the host rules stay | Unknown. Option (d) shows 0.07 is there for binder variables and block locals | Kept | Unknown | A design task with one known obstacle: a binder variable needs a type before its body is used (a declared type per binder, or a rule that the binder states) |
| C. Return to 0.186.0, with a short list carried forward | About 1.00 (estimate) | Back to about 473 to 517 ms: D17 does not stand without the lexical binding and the activations | About the same as main; brings back about 1,821 lines of deleted files | Large, not mechanical: binding commits changed 164 source files and 452 test files; 25 breaking entries reversed in a new version; `ce.infer`, `inputs`, `symbolic`, the macro kind vanish unless ported |
| D. Accept the present state | 1.245 | Kept | No change | None; objective 4 is given up |

What a return would and would not carry (the study's reading of the diffs,
not tested): portable are
`dff0cf7bc5b8d6a89a6039415d4da2246ac2fa88` (a call no longer types the
literal's body), D16, the checkpoint deletion, `ce.temporaryName`, CE-1280,
CE-1303, CE-1272. Not separable from the lexical binding are D17, the
closure deletions and the macro kind as built.

**Assessment of `ce-desk`.** No path measured or costed on 2026-11-15
meets the three objectives together.

- No repair on main reaches the speed of 0.186.0. The only repair left
  that is costed and sound is A2, estimated at 1.13 to 1.17.
- Path C reaches the speed on the symbolic cases, makes Tycho's
  interpreted call about three times slower, and does not make the code
  smaller.
- Path B is the only one that could meet all three, and it is unproven:
  the flag split says the cost is the read and the write of a requirement
  through an environment, and option (d) says that removing them for
  binder variables needs a typing rule that does not exist yet.

The choice is therefore between accepting about 1.15 after A2 (path D with
a smaller gap), paying for a return, and funding a design for B with a
measured prototype before any landing.

**For any path:**

- The gate of section 4, item 1, before the next change in this area.
- CE-1342 and a stale-type check that sees environment writes.
- Slices 2 and 3 stay stopped until the engine is at the speed and size
  that the user accepts. The 204 Tycho lines with no prerequisite can be
  deleted now.

**Not done on 2026-11-15:** Tycho's gates on any of these builds; the
mapping of the flag groups onto main's code; a dry run of path C (apply the
133 non-binding code commits onto 0.186.0 and count the conflicts). Seen in
the option (d) probe and not filed, because main does not reach it: `Add`
of an operand of type `unknown` and an integer is typed `integer`.
