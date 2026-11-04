# Impact of the compiler contraction of November 2026

**Status:** measurement report, 2026-11-04 (file name dated 2026-11-05). No source file, test or
ROADMAP entry was changed to make it. Effort measured: step 3 (the language release 0.178.0, items
3.1 to 3.4.6) and step 4 (rows 1 to 9) of
`docs/plans/2026-11-02-compiler-contraction-plan.md`, with the follow-up items CE-610 and CE-800 to
CE-805. Base commit: `9cca00073` (parent of item 3.1). Head: `fdf351b51`. The report centres on the
compiler (`src/compute-engine/compilation`); other modules appear only where the compiler change
explains them.

Every number comes from a tool result or a file that the report names. Where a number is an
estimate or an inference, the text says so. Counting rule for code lines: `.ts` files, lines that
are not blank and do not start (after leading white space) with `//`, `/*` or `*`; command:
`cat <files> | grep -v -E '^\s*(//|/\*|\*|$)' | wc -l`.

## Findings

1. **How much code went.** The compiler fell from 92,667 to 89,601 code lines (−3,066, −3.3 %).
   Almost all of it went in step 4. The language release (step 3) did not shrink the compiler: by
   the plan's own records the compiler was 92,667 at the base and 92,764 when step 4 started
   (+97). Step 4 removed 3,196 lines by the plan's count (92,764 → 89,568); its nine rows account
   for 2,997 of them, and the other commits of the same days account for the remaining 199 (the
   plan does not attribute them). Commits CE-800 to CE-804 then added 33 lines. The largest
   single removals are in `compile-locals.ts` (−465), `gpu-finite-proof.ts` (−414),
   `python-target.ts` (−374), `compile-absence.ts` (−310; 446 → 136) and `javascript-runtime.ts`
   (−142). `compile-admission.ts` grew by 121 lines. The number of tests did not fall: the full
   suite had 77,805 tests at item 3.4.4 and 77,814 at rows 3 and 4. Test files rose from 1,804 to
   1,837 (+35 added, 2 deleted). The growth of `src/compute-engine/library` (+2,134) is
   **not** mainly a move of compiler rules into the interpreter: two group-theory files from an
   unrelated feature (commit `7f36a72d2`) add 2,002 of those lines. The plan's records for the
   language-release items that touch `library` sum to about +39 lines (additions of +373, +171,
   +149 and +30 against removals of −345, −192, −101 and −46).

2. **What the corpus compiles now.**
   *(a) The release (Tycho's own audit, 0.176.0 against 0.178.0, Tycho `a34405ae0`).* Declines per
   target fell: javascript 68 → 47, glsl 48 → 44, interval-js 99 → 61; the number of documents with
   at least one decline fell from 63 to 53. 15 rows that declined now compile. The record count fell
   from 17,734 to 17,348; 280 of the 386 missing records are GLSL records of 16 complex-mode
   documents, and 80 are interval-js records. The records show 4 rows that compiled with 0.176.0
   and decline with 0.178.0 (3 because Tycho still asks for the removed mode `auto`, 1 because
   of the new unsettled-shape decline); the audit's own comparison report lists only one of them.
   The two runs also differ in Tycho's options, so the comparison mixes the engine change with a
   change in Tycho's mode argument.
   *(b) Step 4 (rows 1 to 9), measured here.* On the same Tycho freeze, between `1359a1279` and
   `fdf351b51`: 0 changed values among 77,267 compared, 0 new throws, 0 new declines, 0 declines
   gone (javascript 47, glsl 44, interval-js 61 in both). The emitted code changed in 286
   records: 263 GLSL records (56 documents; code + preamble grew by 53,797 characters, +4.3 %; 
   records with a NaN-safe helper went from 540 to 713) and 23 JavaScript records (6 documents; 
   −2,043 characters, −0.05 %). No interval-js record changed. The counts of `_SYS.` calls and of
   `Array.isArray` tests in the corpus code did not change in this pair of commits.

3. **Dropped and accepted forms.** Section 3 lists them by name: 61 rows of interpreter static
   errors and changed results, 60 rows of forms that compiled and now decline, 10 rows of forms that
   declined and now compile, the 21 known-limitation lines of `docs/COMPILATION-MODEL.md`, and 21 rows of
   removed options, modes and API. The corpus witnesses are few: for most forms the records say
   "0 in Tycho" or give no class.

4. **Quality and performance.** *Compile time:* the compile time of the closed folded-complex shared
   graph fell about 35 times at depth 10 (warm 176.3 ms → 5.0 ms; instance lookups 66,945 → 483)
   and about 5 times at depth 6 (13.5 → 2.7 ms). `folded-complex` fell by a quarter (0.88 → 0.65 ms).
   Twelve other cases are within the repeat-to-repeat variance (`identity` warm, −9 %, is at its edge). Two cases are slower than that variance:
   `slider` (+11 %, warm) and `radical-strict` (+12 %, warm); the first-call time of the latter
   fell 8 %. *Run time of the emitted JavaScript:* no change beyond the noise floor in the 7 cases
   of `codegen-samples.mjs` or the 2 boards of `numeric-selection.mjs`; the emitted code of those
   cases is identical in length (and, for the selection kernel, in text). *Shader targets:*
   see section 4(c). *Code quality:* of the six records printed in section 4(d), the JavaScript ones
   lost a three-way test wrapper or an `undefined`-test wrapper, and the GLSL ones gained a
   NaN-safe helper definition and its uses.

   *Shader draw time (4c):* Tycho declined to run its own measurement; I ran its shader bench
   after the user authorized it. On the two shaders that take long enough to time (`underwater-caustics`,
   5.9 and 9.6 ms per draw) the head is 2.2 % and 2.1 % slower than the base; five other shaders draw
   too fast for the bench to tell the builds apart. This is one shader in isolation, not a frame
   time. Row 9 adds helpers to 100 keys in 44 documents by its record (180 keys in 58 documents by my
   own count).

## 1. How much code went

Commands: `/tmp/wt-compute-engine-29-base` (detached worktree at `9cca00073`) and
`/tmp/wt-compute-engine-29-head` (at `fdf351b51`); per directory
`find <dir> -name '*.ts' -print0 | xargs -0 cat | /usr/bin/grep -v -E '^\s*(//|/\*|\*|$)' | wc -l`;
per file the same on each file; test files `find test -type f -name '*.test.ts'`. The numbers
agree exactly with the first count of 2026-11-04.

### 1.1 Code lines per module

| Module (under `src/`) | Base `9cca00073` | Head `fdf351b51` | Change |
|---|---:|---:|---:|
| `compute-engine/compilation` | 92,667 | 89,601 | −3,066 |
| `compute-engine/library` | 77,905 | 80,039 | +2,134 |
| `compute-engine/boxed-expression` | 83,574 | 83,959 | +385 |
| `epsil` | 17,665 | 17,473 | −192 |
| `common/type` | 14,680 | 14,634 | −46 |
| all of `src/` | 435,233 | 438,124 | +2,891 |
| `test/` (`.ts`) | 604,934 | 608,397 | +3,463 |

### 1.2 Largest files of the compiler

| File | Base | Head | Change |
|---|---:|---:|---:|
| `base-compiler.ts` | 2,062 | 1,957 | −105 |
| `javascript-target.ts` | 10,189 | 10,053 | −136 |
| `javascript-runtime.ts` | 4,894 | 4,752 | −142 |
| `python-target.ts` | 5,054 | 4,680 | −374 |
| `compile-admission.ts` | 1,461 | 1,582 | +121 |
| `compile-locals.ts` | 1,140 | 675 | −465 |
| `compile-callbacks.ts` | 2,147 | 2,102 | −45 |
| `compile-absence.ts` | 446 | 136 | −310 |
| `gpu-finite-proof.ts` | 1,213 | 799 | −414 |
| `gpu-shader-target.ts` | 1,813 | 1,695 | −118 |
| `gpu-functions.ts` | 3,091 | 3,038 | −53 |
| `compiler-core.ts` | 3,830 | 3,667 | −163 |
| `compile-user-functions.ts` | 1,764 | 1,714 | −50 |
| `auto-escalation.ts` | 22 | absent | −22 |
| `compile-function-values.ts` | absent | 110 | +110 |

Of the other `gpu-*.ts` files, `gpu-at.ts` fell by 11, `gpu-declared-types.ts` by 9 and
`gpu-written-size.ts` by 12; the rest (19 files, among them `gpu-preambles.ts` with 3,831 lines)
did not change. `compile-admission.ts` grew; the plan's step 4 record says its checks serve R1,
R3 and the effect declines, which stay, and the plan does not give the cause of the +121.

### 1.3 Tests

| Measure | Base | Head |
|---|---:|---:|
| Test files (`*.test.ts` under `test/`) | 1,804 | 1,837 |
| Full-suite tests, as the records print them | 77,805 (3.4.4) | 77,814 (rows 3 and 4) |

35 test files were added (10 are group theory; others cover the new rules, e.g.
`compile-block-locals-rules`, `function-values-rules`, `compile-mode-auto-removed`,
`two-valued-comparisons`, `missing-result-only`) and 2 were deleted
(`erasing-literal-numeric-request`, `lazy-view-outlived-symbol-default`). The first count of
2026-11-04 gave 1,600 → 1,632; it used a different file set that I could not identify. The tests
were not run again here; the suite totals come from the plan records.

### 1.4 Attribution per item and per row (from the plan records)

Compiler code lines before → after, as each record prints them. "Plan" gives the line of the plan.

| Item | Commit | Compilation | Library / other, as printed | Corpus result, as printed |
|---|---|---|---|---|
| 3.1 parser: restriction, `where` | `7c4869ad1` | 96,270 → 96,302 (see note 1) | LaTeX dictionary +182 | 0 values changed; 15 new declines |
| 3.2 `When` removed | `5a1ceb18a` | 92,700 → 92,482 | library −46; boxed +29 | 0 new declines; 0 values |
| 3.3 selection | `e8a75b9c4` | 92,482 → 92,398 | library +171; boxed +141 | 0 new declines; 1 key (8 `undefined` → `NaN` point) |
| 3.4.1 two-valued comparisons | `585acfab5` | 92,398 → 92,419 | library −192; boxed +32 | glsl 48 → 47; 5 keys changed |
| 3.4.2 `Missing` result only | `2341d6f31` | 92,419 → 92,785 | library +149; boxed +285; type −28 | javascript 66 → 44, interval-js 90 → 70; 131 values in 31 records |
| 3.4.3 error model | `aee059e66` | 92,790 (unchanged) | library −345; boxed −472; type −34 | 0 changes |
| 3.4.6 complex lane | `609d496ee` | 92,785 → 92,665 (before fixes), 92,748 after | not given | 12 values differ (within caveats) |
| CE-751.1 | `eeee8e574` | 92,763 → 92,820 | not given | 1 key (`NaN` → colours) |
| 3.4.4 block locals | `21fc9505b` | 92,820 → 92,971 | library +373; epsil −224 | 0 changes |
| 3.4.5 function values | `39ef2aec0` | 93,043 → 92,799 | library +30; boxed −125 | javascript 43 → 44, interval-js 74 → 75 |
| Row 1 selection | `ea4f58fa8` | 92,764 → 92,704 (−60) | library −101 | 0 changes |
| Row 2 absence | `477d875a0` | 92,704 → 91,406 (−1,298) | library 0 | 0 changes |
| Row 3 admission and shapes | `877a7aa9b` | 91,168 → 91,017 (−151) | not given | 0 changes |
| Row 4 block locals | `882252b22` | 91,017 → 90,277 (−740) | not given | 0 changes |
| Row 5 function values | `1e6b928fb` | 90,277 → 90,126 (−151) | boxed 0 | 0 changes |
| Row 6 complex lane | `95c01b63b` | 90,126 → 90,125 (−1) | not given | 0 changes |
| CE-751 (d) | `0c201d2e9` | none (documentation) | — | prototypes (a) and (b) rejected |
| Row 7 error model | `faef4d574` | 90,125 → 89,924 (−201) | not given | 0 changes |
| Row 8 | none | 0 (row empty by decision) | — | — |
| Row 9 GPU finite proofs (+ part 2) | `9043a313d` | 89,963 → 89,568 (−395) | `hasNothingArm()` added in `common/type` | 0 changes; 100 keys in 44 documents gain a helper |
| CE-610, CE-800 to CE-804 | five commits | not given in the plan | — | — |

Notes.
1. The record of item 3.1 gives 96,270 → 96,302 and the record of item 3.2 starts at 92,700. The
   plan does not explain the 3,602-line step between them. The plan's introduction says the
   compiler was 92,667 after steps 1 and 5, and my count at the base is 92,667. I therefore take
   92,667 as the base and read the 3.1 figure as measured with another rule.
2. The plan's sum for step 4: "92,764 on `1359a1279` and 89,568 at the end of row 9 (−3,196)";
   the rows remove 60, 1,298, 151, 740, 151, 1, 201, 0 and 395, "2,997 in all". The difference
   (199) is not attributed by the plan. Row 3's base (91,168) is 238 below row 2's end (91,406); the
   record points to commit `2e3ac5fd4` (promotion record and partial application, no count
   given).
3. Check: 92,667 + 97 (step 3, plan figures) − 3,196 + 33 (CE-610, CE-800 to CE-804, from the
   head count) = 89,601, which is the head count.
4. Rows 6 and 9 and row 1 did not run the full suite; row 7's record prints no total.

### 1.5 Why `library` grew

| Part of the +2,134 lines | Lines | Source |
|---|---:|---|
| `finite-group-theory.ts` (new) | +1,691 | commit `7f36a72d2`, "finite group maps, quotients, matrix and polycyclic foundations (#484)", a feature of another session |
| `pc-group-theory.ts` (new) | +311 | same commit |
| `group-theory.ts` | +80 | same area |
| `core.ts` | +283 | includes `statementAscriptionValue()` of item 3.4.4 (the plan does not split the +373 of that item) |
| `control-structures.ts` | +110 | item 3.2 (`whenCollectionHandlers()`) and item 3.3 |
| `logic.ts`, `statistics.ts`, `collections.ts`, `relational-operator.ts`, `calculus.ts`, others | −82, −71, −61, −41, −38, … | removals of items 3.4.1, 3.4.3, row 1 |

The language-release items did move interpreter rules into the library: static errors for block
locals (+373, item 3.4.4), selection rules (+171, item 3.3), the `Missing` rules (+149, item
3.4.2), the default rule (+30, item 3.4.5). They also removed library code (−345 in item 3.4.3, −192
in item 3.4.1, −101 in row 1, −46 in item 3.2). The sum of the records that print a library figure is
about +39 lines (my sum of the figures above; items 3.1, 3.4.6 and rows 3 to 9 print none). The
remaining +95 lines (+2,134 − 2,002 − 39, an estimate) come from commits that are not in the plan.
In `boxed-expression` (+385): `store-admission.ts` +61 and `transient-canonical.ts` +23 were
added; `nothing-erasure.ts` (−72) and `read-before-declaration.ts` (−45) were removed;
`broadcast-lift-type.ts` +173 and `conditional-value.ts` +149 grew (items 3.2 and 3.3 per the plan).

### 1.6 Public API members removed, and diagnostic codes

From the CHANGELOG sections 0.178.0 and `[Unreleased]` (the `[Unreleased]` "Behavior Changes"
subsection and the 0.178.0 "Resolved Issues" were not read for this count, so the count can be low).

| Where | Removed or renamed | Count |
|---|---|---:|
| 0.178.0 | `ce.Indeterminate`, `INDETERMINATE_VALUE`, `isIndeterminateValue`, `Expression.isIndeterminate`, compile-result fields `promoted` and `escalation`, compile mode `'auto'`, interval-library export `checkedCall` | 8 API members (+ `ArithmeticDefinition.isExact` deprecated) |
| 0.178.0 | MathJSON operator `When` (→ `If`, operands reversed); ten permutation-group operators renamed to `Group*` | 11 operators |
| `[Unreleased]` | exported `ConditionDialect`, `ConditionNode`, `CONDITION_DIALECT_JS` | 3 |
| `[Unreleased]` | `CompileTarget` members `absence.object.isNull`, `collectionEqualityOperand`, `inputWrites`, `inputLocals`, `reset`, `gpuParameterFacts` | 6 |
| `[Unreleased]` | `BaseCompiler` statics removed | 42 |
| `[Unreleased]` | `CompileTarget.reboundFunctions` retyped; `assertCollectionOmissionSupported` renamed; 5 statics with a changed signature | 7 |

Diagnostic codes (`compilation/diagnostics.ts`, same path at both commits; 275 → 344 lines): the
number of exported code constants went from 3 to 4. One was added, `POSSIBLE_NOTHING_CODE =
'possible-nothing'`. None was removed. Three decline builders were added (`possibleNothingDecline`,
`nothingOperandDecline`, `unsettledShapeDecline`; the last reuses the existing code
`unsettled-shape`). The `code: '...'` literals in the whole compilation folder are the same 10
distinct strings at both commits; `'unsupported-mode'` occurs 5 times instead of 3.

## 2. What the corpus compiles now

### 2.1 The release: Tycho's audit of 0.176.0 against 0.178.0 (Tycho `a34405ae0`)

Source: Tycho's audit folder of session tycho-f9 (files `cmp-rel.txt`, `rel-176.json`,
`rel-178.json`, `rel-176.log`, `rel-178.log`; read in place, nothing copied here but numbers). Scripts
that extract the numbers were small Node scripts written for this report and kept outside the repo.

**Which build ran.** `cmp-rel.txt` prints "CE 0.176.0" for both runs because the audit script reads the
version from `node_modules/@cortex-js/compute-engine/package.json` in its working directory
(`scripts/audit-ce-codegen.mts` lines 1407 to 1410), and that directory held 0.176.0 for both. The
second run was 0.178.0: its log ends with a redirect line to the `ce178` install and has 130 chunk
paths, all inside `ce178`; that bundle starts with `/** Compute Engine 0.178.0 */` and contains the
message "the mode 'auto' was removed" (0 occurrences in the 0.176.0 log, 7 in the 0.178.0 log). The
packages carry no git hash, so no CE commit is known for either run.

**The runs differ in Tycho's options.** Both files say Tycho `a34405ae0`, but at 0.176.0 487
JavaScript records have `options.mode = "auto"` and at 0.178.0 323 have `"complex"` (4 still ask
for `auto`). The comparison therefore mixes two changes: the engine and the mode that Tycho
passes.

| Target | Declines 0.176.0 (records / documents) | Declines 0.178.0 | Records 0.176.0 | Records 0.178.0 | Change |
|---|---|---|---:|---:|---:|
| javascript | 68 / 27 | 47 / 26 | 8,902 | 8,877 | −25 |
| glsl | 48 / 21 | 44 / 18 | 3,931 | 3,650 | −281 |
| interval-js | 99 / 33 | 61 / 21 | 4,901 | 4,821 | −80 |
| all | 215 / 63 documents | 152 / 53 documents | 17,734 | 17,348 | −386 |

**Where the 386 records went.** Matching by `input` or `row` text fails because the engine rewrites
those texts between versions; the per-(document, target) record delta sums exactly to −386.

| Group (0.178.0 minus 0.176.0) | javascript | glsl | interval-js |
|---|---:|---:|---:|
| documents whose 0.178.0 JavaScript records are all `complex` | −1 | −279 | −27 |
| 6 documents whose `series` count changed (4 for interval-js) | −12 | 0 | −36 |
| other documents | −12 | −2 | −17 |
| total | −25 | −281 | −80 |

The hypothesis holds for GLSL: 280 of the 281 missing GLSL records belong to 16 documents (14 `art/`,
2 `neyret/`) that have no GLSL record at 0.178.0, and all their 0.178.0 JavaScript records are
`mode: "complex"`. It does not explain the whole loss: interval-js loses 80 records, 36 of them in 4
documents whose series count changed. The records do not say that those documents are drawn on the
CPU; that is an inference from "only JavaScript records, all `complex`" (the comment on `promoted`
in the post-adoption Tycho source says so, but that file is not the audited tree).

**Rows that declined and compile now (15):** 5 javascript, 1 glsl, 9 interval-js.

| Target | Rows | Old decline message | Documents |
|---|---:|---|---|
| javascript | 2 | scalar arithmetic over a list-valued operand | `art/2ki2hjsouf`, `art/epq7yidtim` |
| javascript | 2 | the input `x` has no type | `neyret/dmibg1uaof`, `neyret/mycv4fbo4z` |
| javascript | 1 | a call of `N`: argument type does not match the parameter | `art/s8ishknvhe` |
| glsl | 1 | `D` has no lowering for these operand types | `neyret/knix5adprn` |
| interval-js | 9 | `D` has no lowering for these operand types | 5 `neyret/` documents |

**Rows that compiled and decline now.** `cmp-rel.txt` prints one (`showcase/domain-coloring`,
`z^a`). The records show four:

| Document, row | Decline at 0.178.0 | Cause |
|---|---|---|
| `showcase/domain-coloring`, `z^a` | "the mode 'auto' was removed" | Tycho still asks for `auto` (by design, CHANGELOG T3.1) |
| `art/0ugzbaxw5r`, `A=x^2+y^2` | same | same |
| `art/6tibhcumew`, `c=hsv(xy,1,1)` | same | same |
| `neyret/zibjmkv9h9`, `PointList(F(⌊t⌋)[1], F(⌊t⌋)[2], …)` | "a `compile` handler wrote its code, but its type … admits values of different shapes" | rule R3 (unsettled shape) |

The adoption note says "no new decline in a document row"; the records do not agree. I did not find
why the audit's list omits three of them.

**Decline messages.** The drop in declines comes mainly from messages that no longer occur: JavaScript
"invalid expression … `incompatible-type` … dictionary | indexed_collection" (18 records) and
`Which` branch-shape messages (15 records), replaced by 13 records of the new "a `compile` handler
wrote its code" message; interval-js loses the same 18 records, 5 "Complex numbers" records and 9
"no lowering" records.

**The one value that changed.** The audit files hold the emitted code and no computed value, so
the value change is not in them. Tycho's adoption note names it: a polar domain `2π → 12π` in
document `13obrwvjag`, row 45, found when the references were regenerated. The cause it names is
Tycho's polar period check compiling with `mode: "auto"` in a complex-mode document, which 0.178.0
declines. This sentence repeats Tycho's note; it was not measured here.

### 2.2 Step 4: the value audit of rows 1 to 9

Tool: `~/.claude/tools/ce-census/value-audit.sh`, `compare.mjs`, `compare-values.mjs`. Both runs are
new (no saved earlier run could be tied to a commit). Base `1359a1279` (row 1's base), head
`fdf351b51`, both CE 0.178.0 in the record header. Tycho: a frozen copy of `a34405ae0` reused from
another session after a check against a fresh `git archive` (differences: only the files the tool
header requires). Both logs end with `AUDIT_EXIT=0`; each run compiled 17,825 expressions (13,707
keys, 77,267 values) and holds 17,348 records over 757 documents. Box lock held; load 3.5 / 3.9 /
3.7 at acquire. Commands:

```
export AUDIT_OUT=<an output folder>
export TYCHO_SNAP=<frozen copy of Tycho a34405ae0>
timeout -k 30 900 ~/.claude/tools/ce-census/value-audit.sh /tmp/wt-compute-engine-29-r1base r1base
timeout -k 30 900 ~/.claude/tools/ce-census/value-audit.sh /tmp/wt-compute-engine-29-head head
node ~/.claude/tools/ce-census/compare.mjs r1base.json head.json
node ~/.claude/tools/ce-census/compare-values.mjs r1base-values.json head-values.json
```

| Measure | Result |
|---|---|
| Declines (javascript / glsl / interval-js) | 47 / 44 / 61 in both runs |
| Row status transitions that changed | 0 |
| New declines / declines gone | 0 / 0 |
| Values compared | 77,267 (13,707 keys) |
| Changed values / new throws / throws removed | 0 / 0 / 0 |

Expected and confirmed: 0 changed values, 0 new declines, the same decline counts.

Emitted code (successful records; "characters" = `code` + `preamble`; counts are substring counts in
`code + "\n" + preamble`; a Node script written for this report and kept outside the repo):

| Measure | JavaScript base | JavaScript head | GLSL base | GLSL head | interval-js base | interval-js head |
|---|---:|---:|---:|---:|---:|---:|
| Records | 8,830 | 8,830 | 3,606 | 3,606 | 4,760 | 4,760 |
| Characters | 4,516,214 | 4,514,171 (−2,043) | 1,251,168 | 1,304,965 (+53,797) | 4,335,625 | 4,335,625 |
| Records with changed code | | 23 (6 documents) | | 263 (56 documents) | | 0 |
| `_SYS.` occurrences | 21,118 | 21,118 | 0 | 0 | 0 | 0 |
| `Array.isArray` occurrences | 83 | 83 | 0 | 0 | 12 | 12 |
| Records with `_gpu_sin(` | | | 334 | 488 | | |
| Records with `_gpu_cos(` | | | 345 | 497 | | |
| Records with `_gpu_max(` | | | 121 | 140 | | |
| Records with `_gpu_min(` | | | 69 | 76 | | |
| Records with `_gpu_clamp(` | | | 0 | 0 | | |
| Records with at least one of the five | 0 | 0 | 540 | 713 (+173) | 0 | 0 |

Row 9's report (540 → 713 records) is reproduced exactly. All 263 changed GLSL records grew. The 23
changed JavaScript records fall in three classes (the class is read from the code text of each
record; attribution to a row is an inference from the code shape):

| Class | Records | Effect |
|---|---:|---|
| `(_CND) => _CND === true ? a : _CND === false ? b : NaN` wrapper removed (selection lowering, row 1) | 5 | direct ternary |
| `(_tv) => _tv === undefined ? NaN : _tv[k] ?? NaN` wrapper removed (absence, row 2) | 14 | `_cse[k] ?? NaN` |
| `=== undefined` test replaced by `Number.isNaN(_tv ?? NaN)` | 4 | same shape; 2 records grow |

Row 9's record says 100 keys in 44 documents gain a helper. Here 263 records in 56 documents
changed. The units differ (keys against records) and I did not reconcile the 12 extra documents;
the difference may come from the other commits between `1359a1279` and `fdf351b51`. This run
compares only two commits and does not isolate the rows.

The six printed records are in section 4(d).

## 3. Dropped and accepted forms, by name

Sources: CHANGELOG sections 0.178.0 and `[Unreleased]`, the plan records, `docs/COMPILATION-MODEL.md`
(caveats, known limitations, R1 to R6; read to line 404), section 8 of
`docs/plans/2026-11-02-language-axes-options.md`. A form that only the unread parts name
(`COMPILATION-MODEL.md` from line 405, `ERROR-MODEL.md`, options sections 1 to 7, the tests) can be
missing. The corpus counts are quoted as the records give them; "class not stated" means the record
gives none. Tycho's corpus is 757 documents, 688 Desmos states, 8,231 rows; the step 4 measures ran
on Tycho `a34405ae0`, not on `f51646a04`.

Abbreviations in the source columns: C = `CHANGELOG.md` (lines of the `[Unreleased]` section
1–324 and of 0.178.0, 325–1053, as of head); P = `docs/plans/2026-11-02-compiler-contraction-plan.md`;
M = `docs/COMPILATION-MODEL.md`; O = `docs/plans/2026-11-02-language-axes-options.md`; A =
`AGENTS.md`. Version tags: 0.178.0 = the language release (step 3); U = `[Unreleased]` (step 4 rows
and CE-800 to CE-805); S4-r1 to S4-r9 = step 4 row 1 to row 9. "TYCHO" means Tycho's corpus.

Rules: R1 every input has a type; R2 the static type of an argument selects the code; R3 a value
with no settled shape declines; R4 a declared union at an input compiles with one dispatch; R5
the compiler assumes every value holds its static type; R6 the runner converts and checks few
values.

### T1. The interpreter: a program that was valid is now a static error (or its evaluation result changed)

"before → after" uses: valid → static error / result A → result B / throw → accepted.

| # | form (short example) | before → after | rule | witness class and corpus count (as recorded) | replacement (CHANGELOG) | source |
|---|---|---|---|---|---|---|
| T1.1 | `Declare(x, "integer")` then `Assign(x, 5)`; Epsil `let x: integer` | valid → static error `declaration-without-value`; compilation declines | block-local rule 1 | Tycho builds this in 4 builders (march kernel, `surface-argument-staging.ts`, Desmos `with` parse, colour-definition builder); 288 compiled expressions in 32 documents (march kernel); Tycho changes the builders at adoption; class label not stated. Tycho `a34405ae0` and later builds three-operand `Declare` | `Declare(x, "integer", 5)`; `let x: integer = 0` | C:361-372; P:1168-1176, 1225-1235, 2938-2948 |
| T1.2 | `let f: (integer) -> integer; function f(x) { x + 1 }` (valueless function-type declaration beside a function statement of the same name) | stays valid (exception to T1.1); without the function statement in the same block it is `declaration-without-value` | block-local rule 1, refinement (user decision 2026-11-03) | plausible: `compiled-declared-function-type.test.ts`, `multi-clause.test.ts`, `block-declared-signature-clause.test.ts` | the function statement gives the signature | C:368-371; P:1183-1195 |
| T1.3 | LaTeX `\operatorname{let} k \coloneq v` | `Declare(k)` + `Assign` pair → `Declare(k, "unknown", v)` (parse change) | block-local rule | class not stated | — | C:371-372 |
| T1.4 | `f(a := 2)` | valid → static error `assignment-in-operand` | block-local rule 2 (an assignment is a statement) | Tycho: no Tycho-built block nests an assignment in an operand (P:1236-1239); class not stated | `a := 2; f(a)` | C:373; P:1202-1205, 1236-1239 |
| T1.5 | `Block(p := 0, Integrate(Block(p := 7, t), Limits(t, 0, 1)), p)` | → `assignment-in-operand` (the integration puts the `Assign` in a product) | block-local rule | crafted | not stated | P:1262-1264 |
| T1.6 | `a := b := v` (Epsil and LaTeX) | valid → parse error `chained-assignment` | block-local rule | not stated; no Tycho block (P:1236-1239) | `b := v; a := b` | C:374-375; P:1243-1244 |
| T1.7 | first assignment of a name inside a branch of `if`/`If`/`Which`, a `match` case, or a loop body: `if c { a = 1 }; a` | valid (gave the symbol `a`) → static error `first-assignment-in-branch`; also at top level and for `If`/`Which`/`Loop`/`Match` boxed outside a block. A write to a name the session already declares stays a write | block-local rule 1 | Tycho: none (P:1236-1239; P:2938-2942: "no first assignment sits in a branch, a loop body or an operand") ; class not stated | `t = 0; if c { t = 1 }` | C:376-382; P:1173-1178 |
| T1.8 | a read of a local before the statement that declares it | run-time `read-before-declaration` error value, or a symbolic unset read → static error `read-before-declaration` | block-local rule | not stated | declare first | C:361-364, 383-384; P:1178-1182 |
| T1.9 | `Block(Assign(a, 1), Assign(a, "x"), a)` | valid → static error `assignment-type-mismatch`. The type of a local = its declared type or the type of its first value widened to `number`/`string`/`boolean`; `let s: real = 0; s = s + sqrt(x)` stays valid | block-local rule | not stated | keep the type | C:385-388; P:1196-1201 |
| T1.10 | block whose last statement is an assignment or declaration: `Block(Assign(b, 2))` | value `2` → value `Nothing` | block-local rule | not stated | end the block with the name | C:389-391; P:1206-1210 |
| T1.11 | `function f() -> integer { x = 2 }` (declared result type without `nothing`, body ends in an assignment) | gave `Nothing` → `incompatible-type` error when called | block-local rule | not stated | — | C:392-396; P:1208-1210 |
| T1.12 | `ce.assign("P", ce.parse("(-\\sqrt{1-a^2}, a)"))`, `P: tuple<E,E>`, `E = real \| signed_infinity \| nan`, `a: real` | throw "not compatible with the type" → accepted; `P` evaluates, and is an `incompatible-type` error at `a = 5`. Still refused: a value with no value in common with the declared type (`ce.declare("t","gf8"); ce.assign("t", 2)`), and a value of only literals/constants not of the declared type | assignment overlap (U, Tycho row 483, CE-800/801) | Tycho row 483 (the witness named); class label not stated | — (loosening) | C:97-115; P:(no section; named in head record) |
| T1.13 | default naming a variable: `(k = n) ↦ k` with `n` not `isConstant`, or assigned; `ce.declare()` with such a signature | in 0.176.0 / 0.177.0 the symbol was read at the call site → static error `expected-a-literal-default` in a literal; `ce.declare()` throws for a signature | function-value rule (rule 4: a default is a constant) | corpus: GitHub issue #490 (enumeratio asked for `over: Integers` and `Auto`); Tycho census: 0 defaults in its source and documents (P:1463-1467) | declare the symbol constant, write the value, or pass the argument | C:448-463; P:1411-1455, 1463-1467 |
| T1.14 | default of `Nothing` or `Missing`; a tuple (`Optional(p, (0, 0))`) or computed expression (`2π`) as a default | refused (as on the base for the tuple and expression) → `expected-a-literal-default` / throw | function-value rule | not stated | write a constant and name it | P:1423-1430, 751-752 |
| T1.15 | function literal with a rest parameter and a default | valid → static error | function-value rule | not stated | pass the argument | C:464-465; P:1426-1427 |
| T1.16 | `function f(k = W) {…}; const W = 5` (const written after the function) | → `expected-a-literal-default` (function hoisted before the `const`) | function-value rule, choice 2 | not stated | — | P:1489-1492 |
| T1.17 | `g = (k: real = 2) ↦ k + 1`; `g(Missing)`, `g(First([]))` | 0.177.0: a default filled a supplied absent value (`g(Missing)` = 3) → `Missing` is passed to the body, result `Missing`; `g(0/0)` is `NaN`; `g()` still 3 | function-value rule (reverses the "or absent" half of R6 of 2026-11-02, and the 0.177.0 change) | not stated | `g(Coalesce(At(L, 100), 2))` | C:436-447; P:1396-1410 |
| T1.18 | `ce.Indeterminate`, `INDETERMINATE_VALUE`, `isIndeterminateValue`, `Expression.isIndeterminate` | API exists → removed | error model | not stated; Tycho: no reader or builder produces or tests it; two name sets list it and "become dead" (P:710-717) | `ce.NaN`; `isNaN` | C:542-544; P:710-717 |
| T1.19 | `0/0`, `∞ − ∞`, `0^0`, `Mod(5, 0)`, `Variance([3])`, `Mean([1, 0/0])`, `Max(1, 0/0)` | exact `Indeterminate` → `NaN`; `Indeterminate` is an input spelling of `NaN` (MathJSON, `\operatorname{Indeterminate}`, Epsil, `NumberFrom`, type string); serializer writes `NaN`; `String(0/0)` is `"NaN"` | error model | corpus measure: 9 records changed key only (compiled expression held `Indeterminate`), 36 values equal (P:790-794) | `ce.NaN` | C:547-557; P:696-701, 789-794 |
| T1.20 | `ArithmeticDefinition.isExact` hook | read → deprecated, no longer read | error model | not stated | — | C:545-546; P:761-763 |
| T1.21 | `[1, Nothing]`, `f(1, Nothing)`, `{a: Nothing}` | `Nothing` removed from lists, argument lists, dictionaries → kept (length 2; two arguments; key `a` kept) | error model | Tycho: no site depends on the splice (P:718-724); class not stated | write the list without the element, or `Filter` with an explicit predicate | C:558-564; P:702-704 |
| T1.22 | `Add(1, Nothing)` | `1` → `incompatible-type` error | error model | as above | — | C:561-562 |
| T1.23 | `Map(x ↦ If(x > 1, x, Nothing), [1, 2])` | `[2]` → `[Nothing, 2]`; `Map` calls its callback on a `Nothing` element, keeps a `Nothing` result | error model | as above | `Filter` after `Map` | C:565-569; P:705-709 |
| T1.24 | `Filter` over `Nothing` elements | dropped without calling the predicate → predicate is called | error model | as above | a predicate that tests it: `Filter(d, y ↦ y ≠ Nothing)` | C:570-571 |
| T1.25 | `Sum([1, Nothing])`, `Mean([1, Nothing, 3])`, `Max([NaN, Nothing])`, Min, Product, statistics, covariance family | `1`, `2` (skipped) → `incompatible-type` error (the error outranks `NaN`) | error model | corpus measure: no `Nothing` element reached a compiled record (P:794-795) | filter the data first | C:572-576; P:702-709, 745-750 |
| T1.26 | empty LaTeX slot `(3,,4)`, `[3,,4]`, `f(3,,4)`; empty row / trailing comma in `cases`; `\partial f` | slot was `Nothing` → `["Error", "'missing'"]` (parse error); trailing comma `[1, 2,]` still dropped; `cases` empty row → `Which(c, v)`; `\partial f` is `["PartialDerivative", "f"]` | error model | corpus: 103 + 585 + 8,387 strings: no empty slot, no trailing comma in a piecewise (control 1,068 piecewise, 5,915 parenthesized strings); Tycho reader `classification-entry-fold.ts` 500-531 reads (3, 4) from `(3,,4)`, pinned by two Tycho tests, removed at adoption | write every slot | C:577-583; P:725-731, 756-760 |
| T1.27 | empty `Sequence()`, rest capture `t` of `[h, ...t]` over one element | printed/became `Nothing` → stays `Sequence()`; a list or argument list splices it | error model | plausible (Epsil idiom `[h, ...t]`, `test/epsil/while-let.test.ts`) | — | C:584-588; P:739-744 |
| T1.28 | `ce.declare("w", "real \| missing")`, `ce.declare("f", "(real \| missing) -> real")`, operator definition with a `missing` parameter, `["Typed", "x", "'real \| missing'"]`, signature string, `Declare` statement, Epsil `let x: real \| missing = 1` | valid declaration → throw / `invalid-type-annotation` / `invalid-type-declaration` / Epsil `type-annotation-error`. Result type of a signature may still name `missing` | `Missing` is a result only | census: a `missing` input type: 2 documents / 6 Desmos states (P:78); Tycho copies an INFERRED type into a declaration at 3 sites (`document-ce-manager.ts` ~13866, `style-expressions.ts` ~841, GLSL colour helper ~858-871) and strips `missing` at adoption (P:521-531); 146 test files named such a type (P:494-497) | declare the type of the present value; read with `IsMissing` or `Coalesce` (`??`) | C:594-605; P:78, 494-497, 521-531, 602-604 |
| T1.29 | symbol `"Undefined"` | an absent value → ordinary symbol with no value (`IsMissing(Undefined)` False, `Undefined + 1` stays) | `Missing` result only | Tycho: no reader or builder uses it; two name sets list it (P:533-535) | `"Missing"` | C:606-610; P:533-535 |
| T1.30 | `Missing + 2`, `Sin(Missing)`, `1 / Missing`, `Max(1, Missing)`, `Sum([1, Missing])`, `Mean([1, Missing])`, `Norm((1, Missing))`, `[1, Missing] + 1` | `NaN` in numeric domains → `Missing` (`[2, Missing]`); `Missing + 2` typed `missing`; aggregate over `NaN` or no data still `NaN` | `Missing` result only | not stated | `IsMissing` or `Coalesce` before computing | C:611-617; P:516-520, 581-589 |
| T1.31 | `At`, `First`, `Last` over a list of points, out of range; `At([(1, 2), (3, 4)], 5)` | `Missing` → `(NaN, NaN)` (interpreter and compiled JS and Python); over numbers `NaN`; other values `Missing` | `Missing` result only | corpus: Tycho's own `At` handler read `undefined`; 175 values in 23 records threw until Tycho patched it (P:612-621); Tycho's point readers accept a `NaN` point (P:535-543) | — | C:618-622; P:535-543, 612-637 |
| T1.32 | false restriction of a point: `If(c, (1, 2))` with `c` false; `Sin(If(c, (0, 1)))`, `Norm(If(c, (3, 4)))`, `First` of a false restricted list of points | `Missing` (`undefined` in compiled JS) → `(NaN, NaN)` / `NaN`; the restricted list itself stays `Missing` | `Missing` result only, user decision 2026-11-03 | corpus: 29 records changed `undefined` → NaN point (P:628-636); Tycho: a 2-D polygon with a restricted vertex now splits at the vertex (P:544-551) | — | C:623-630; P:553-560 |
| T1.33 | type of an accessor: `At(ss, i)` with `ss: list<string>`; `At(ys, i)` with `ys: list<real>` | typed `string \| missing`, `real \| nan` → `string`, `real` (value out of range is still the marker; `At([1, 2], 5)` stays typed `nan`); `Append` signature `(collection<any>, any+)` | `Missing` result only | not stated | — | C:637-646 |
| T1.34 | symbol whose value holds `Missing` read under its declared type: `cd: list<color>` at `[Missing, Rgb(0,1,0)]`, `AsOklab(cd)`; `((x) ↦ At(ss, 2))(1)` with `ss: list<string>` at `[Missing, "b"]` | compile failure / `incompatible-type` error → compiles; the first cell is the `NaN` colour; `At(ss, 2)` = `"b"`. `[5, Missing]` for `ss` still refused | `Missing` result only, CE-791 | corpus: neyret/po7rdhtoth `asOklab(c_d)` (P:626-627) | — | C:647-661 |
| T1.35 | comparisons with an absent operand: `Missing > 0`, `Not(Missing > 0)`, `Not(Missing)`, `And(Missing, True)`, `If(Missing, 1, 2)`, `If(Missing, 1)`, `0 < Missing < 1`, `Equal([1, Missing], [1, Missing])`, `Equal([1, Missing], 1)`, `Any([1, Missing], x ↦ x > 2)` | `Missing` (and an absent-condition error) → `False`, `True`, `False`, `2`, `NaN`, `False`, `False`, `[True, False]`, `False`. `NotEqual`: `True` | two-valued comparisons (user decision 2026-11-02) | census: 1 document, 5 Desmos states with a comparison over a `missing` operand, not in Tycho's documents (P:406-408); Desmos measured by Tycho 2026-11-02 | read the absence with `IsMissing`/`Coalesce` first | C:663-696; P:382-393, 394-408 |
| T1.36 | boolean predicates over an absent collection or element: `Any(Missing, p)`, `All`, `Element(2, Missing)`, `Contains`, `IsEmpty`, `StartsWith`, `EndsWith`, `ContainsSequence`, `Subset` and relatives; negated forms `NotElement`, `NotSubset`, `NotSuperset`, `NotSupersetEqual` | `Missing` → `False` (negated: `True`). `IsPrime(Missing)` still `Missing`; `Element(Missing, [1, Missing])` stays `True` (2026-09-26 rule) | two-valued comparisons, choice (2) | not stated | — | C:679-687; P:423-436, 587 |
| T1.37 | type of a comparison, connective or such a predicate | `list<boolean> \| missing` → `boolean \| list<boolean>` (no `missing` arm); `Which(q < 0.1, 2, True, 1) < 2` with `q: list<real^4>` typed `list<boolean^4>` | two-valued comparisons | corpus row art/njncrg9fkv declined on JS and now gives four points (CE-792) | — | C:688-697 |
| T1.38 | element-wise selection with a relation or colour arm under a list of conditions | relation cell `Missing` → `False`; colour cell → `Rgb(NaN, NaN, NaN)` (Tycho item 189); a relation restricted by a scalar condition → `False` where false | two-valued comparisons / selection | corpus: Tycho item 189 (30×30 grid colour list), neyret/xhlkk7k9aq, 3qkygakl9m, akconkhexx (P:293-315, 409-418, 449-463) | — | C:697-706; P:409-436 |
| T1.39 | restriction `e\{c\}` and its group: `y=0\{x\le0\}`, `x^2+y^2<9\{c\}`, `H(x)=3x^2-2x^3\{c\}`, `-a\{c\}`, `(1,2)\{c\}`, `x^{3.1\{c\}}`, `(a\{c\}, b)`, `\sum_{n=1}^{N} a_n\{c\}` | applied to the factor before it (`Equal(y, When(0, x≤0))`) → covers its whole group: `If(x≤0, Equal(y, 0))` etc. | restriction rule (3.1) | corpus (8,231 rows, 761 hold a restriction): 133, 111, 34, 25, 79 rows for the first five; 3, 15, 6 rows for the in-group forms; `a\{\}` still a parse error | — | C:707-736; P:107-139 |
| T1.40 | stacked restrictions `a\{c_1\}\{c_2\}`, `a\{c_1\}+b\{c_2\}`, `\{c_1: a\}\{c_2\}`, `\{c_1: a, b\}\{c_2\}`, `\{x>0\{y<1\}: a, b\}`, `...\{x>0\{x<1\}, x>2\{x<3\}\}` | separate restrictions / `Set` / `Tuple` → merge `If(And(c_1, c_2), a)` up to 4 deep; `If(c_2, Which(c_1, a, True, b))`; condition with own restriction; comma group still `Or` | restriction rule | corpus: 76 rows (stacked), 14 rows (`{c1: a, b}{c2}`), 7 rows (comma group); neyret/xhlkk7k9aq #1752170633, neyret/akconkhexx #721856020 | — | C:737-750 |
| T1.41 | `\{c\}` alone | set `Set(x>1)` → `If(c, 1)` | restriction rule | not stated | — | C:751-752 |
| T1.42 | `e \text{ where } item, …`: bindings `a \coloneq v`, `a = v`, `\text{let}`; conditions | `a \text{ where } b = 2` was `Block(Equal(b, 2), a)` and bound nothing → `Block(Declare(a, "unknown", 1), …, If(c, e))`; conditions only → `If(c, e)`; a comma followed by non-item text, and a `let` with no value, are parse errors | `where` rule (3.1) | corpus: Graph Paper's documents and help pages; 58 Tycho Desmos rows with `\operatorname{with}` (P:140-148) | — | C:753-770; P:140-150 |
| T1.43 | `i \operatorname{where} n \coloneq 3 \operatorname{for} i = \operatorname{Range}(n)` | `Block` outside the comprehension → `for` applies to the whole clause: `n` of `Range(n)` is free | `where` rule | corpus: Tycho's 24 comprehension rows whose binding reads the index | — | C:771-777 |
| T1.44 | `a \coloneq 2; a+1` | `Block(Declare(a), Assign(a, 2), a+1)` → `Block(Declare(a, "unknown", 2), a+1)`; a later `\coloneq` of the same name is still `Assign` | block-local rule | not stated | — | C:778-781 |
| T1.45 | serialization of a binding `Block` and of a single-branch `If` | `a\coloneq v; e`, `\mathrm{If}(c, e)` → `e \text{ where } a \coloneq v`, `e \text{ where } c`; the serializer never writes `\{c\}` | restriction/where rules | not stated | — | C:783-795 |
| T1.46 | `["When", e, c]`, `\mathrm{When}(e, c)` | operator existed → unknown operator: no type, does not evaluate, does not compile. `x^…` held restriction prints `If(0 < t, 3)` (was `3 {0 < t}`) | restriction rule (3.2) | Tycho builds `When` at 6+ files, ~30 readers, 19 test files hold MathJSON `"When"`; no stored document or corpus state holds `When` (P:187-207); Tycho builds only `If` from its next release (C:806-807) | `["If", c, e]` (operand order reversed) | C:797-807; P:152-207 |
| T1.47 | held restriction over a list: `If(0<t, [1, 2, 3])`, `\sin([1,2,3]\{0<t\})` with `t` free | not an indexed collection → indexed collection (`isCollection`, `count`, `each()` agree with the type); `t = -1` gives `Missing`, as before | selection rule / 3.2 | corpus: Tycho item 66 | — | C:808-814; P:172-186, 230-238, 252-286 |
| T1.48 | type of a restriction: `If(c, e)`, `If(c, 1)`, `At(If(0<t, (1, 2)), 1)`, `Insert`, `ReplaceAt`, `Append`, `Distance`, `Norm`, `Midpoint` of a restricted value | `integer \| missing`, `integer \| nan` → type of `e`, no `missing`/`nan` arm; a symbol declared `number` accepts `If(0 < t, 3)` | restriction rule | not stated | — | C:729-734, 815-821 |
| T1.49 | element-wise selection errors from the types: condition that is a list of lists (`If([[True],[False, True]], 7, 0)`, `If(M < 3, M, 0)` with `M` a matrix), a condition with a `Missing` element, a condition typed `collection<boolean>`, `set<boolean>`, bare `list`, `list<any>`, `matrix<boolean>`, an arm whose elements are lists, a string or set under a list of conditions, a number arm beside a point arm | gave values (`[[7],[0,7]]`) → `incompatible-type` (compiled: decline). Two types giving different lengths: `incompatible-dimensions` (`If([True, False], [1, 2, 3], 0)`; the single-branch form was truncated to the shorter length). A length known only from the value is still truncated | selection rule | corpus: 757 documents of Tycho: no nested condition, no uneven condition, no string arm under a list of conditions; no document gains a decline (C:853-857) | — | C:833-843; P:240-251, 252-315 |
| T1.50 | unmatched position under a list condition: `If([True, False], (1, 2))`, `If(v>0, (1,2))` with `v = [-1, 2, 3]`; number cell | `Missing` (JS `undefined`) → `NaN` / `NaN` point (`[(NaN,NaN),(1,2),(1,2)]`, type `list<tuple<number, number>>`); `IsMissing`/`Coalesce` no longer read such a cell as absent | selection rule | corpus: art/njncrg9fkv unmatched cells of a 3-D point list `undefined` → `[NaN, NaN, NaN]` (8 values); art/s8ishknvhe setup row (same change); Tycho readers skip a `NaN` point (P:316-329) | — | C:824-832; P:252-286, 330-342 |
| T1.51 | scalar `Which` with no match; scalar `If(c, e)` false | `Missing` stays for `Which`; single-branch `If` false: `NaN` for a number, `Missing` otherwise (0.177.0: `Missing` for every one). `If(c, r)` over a relation → `False` | selection rule / two-valued | Tycho reads the scalar no-match `Missing` as a `NaN` slot | — | C:728-731, 850-851; P:403-405, 419-423 |
| T1.52 | a condition whose type does not settle the rank (`tensor<boolean>`, `boolean \| list<boolean>`) | accepted, checked on its value: a nested list is an `incompatible-type` error (interpreter), `NaN` (compiled) | selection rule, choice 3 | corpus rows neyret/o0iqr4bhzk, art/lkto8x8wr5, art/njncrg9fkv (would have been lost by refusing) | — | C:846-849; P:296-302 |
| T1.53 | declared scalar result type binds the body: `h: (number) -> number`, `h := t ↦ [t, t]`, `h(3)`; `(t ↦ Typed([t, t], number))(5)` | `[3, 3]` typed `number` → `incompatible-type` error. A function mapped over a list argument still returns the list (`d([(1,2),(4,6)])`) | R5 | corpus: GitHub issue #488 | — | C:956-965; M:~(R5) |
| T1.54 | `Sum`/`Product` over an empty range of a vector body: `Sum(i·[x, y, z], i, 1, n)` at `n = 0`, `Norm(Product(...))` | scalar `0` / `1` → `[0, 0, 0]` / `[1, 1, 1]` (type `vector<real^3>`); a matrix body keeps the scalar identity; `simplify()` follows | CE-786 | not stated | — | C:1027-1035, 897-903 |
| T1.55 | `Find([1, 2, 3], x ↦ x > 5)` with no match | `Nothing` → `NaN` typed `integer \| nan`; over points the `NaN` point; over other elements `Missing` (`Find(["a"], x ↦ x = "b")`); `Find(xs, p) + 1` was an `incompatible-type` error → `NaN` | CE-804 / error model | not stated (CE-804 in the recent commits) | `Coalesce(Find(xs, p), 0)` | C:116-125 |
| T1.56 | `RangeOf([1, 2, 3], [9])`, `Slice(xs, RangeOf(xs, needle))`, `Slice(Missing, 2, 3)`, `Slice([1, 2, 3], Nothing)` | `Nothing`; `incompatible-type` error; `Nothing` → `Missing` (typed `range \| missing`); `Slice(Missing,2,3)` is `Missing`; `Slice([1,2,3], Nothing)` is an `incompatible-type` error | CE-802 (user decision 2026-11-04) | previous decision 2026-08-16 (`sequence-search.test.ts`) reversed; class not stated | `IsMissing` or `Coalesce` (`??`) | C:126-135; P:764-768 |
| T1.57 | a `Sum`, `Product`, `Reduce`, `Scan` etc. — interpreter semantic of `Nothing`/`Map` in the interpreter only: see T1.21-T1.25 | — | — | — | — | — |
| T1.58 | `Map((x: integer) ↦ x > 0, [1, Missing])`; a call with `Missing` at a declared/annotated numeric or point parameter | (3.4.2 decision 5) bind `Missing` and run → `Missing` without running the body, unless the parameter has a default (filled in 0.178.0 plan text; later reversed by T1.17) or the call is a partial application: `[True, Missing]` | `Missing` result only | not stated | — | P:578-584 |
| T1.59 | `PointX/Y/Z` of an absent point, `Length` of an absent collection, `IsPrime(Missing)`, an error datum vs `Missing` in statistics | coordinate of absent point `NaN` on every route; `Length` of an absent collection `Missing`; `IsPrime(Missing)` `Missing`; an error outranks `Missing` | `Missing` result only | corpus: lizeqlnn5e (`Length` of an out-of-range point read is now 2) | — | P:585-589, 630-634 |
| T1.60 | group-theory names `PermutationGroupOrder`, `PermutationGroupContains`, `PermutationIsSubgroup`, `PermutationIsNormal`, `PermutationGroupIsAbelian`, `PermutationGroupElements`, `PermutationGroupGenerators`, `PermutationGroupEqual`, `PermutationGroupIdentity`, `PermutationSubgroupIndex` | exist → removed | #484 (not a contraction axis; in the same release) | not stated | `GroupOrder`, `GroupContains`, `GroupIsSubgroup`, `GroupIsNormal`, `GroupIsAbelian`, `GroupElements`, `GroupGenerators`, `GroupEqual`, `GroupIdentity`, `GroupIndex` | C:966-978 |
| T1.61 | evaluation order-of-results bugfixes listed as Resolved Issues that change a result: `2^{\ln(-3)}.sgn`, `(\|\pi\|)^{\ln(-3)}.sgn`; local of `Declare(k, "unknown", v)` type after a run (CE-796); product with quotient factor serialization (CE-787); closure local function (CE-794) | positive / non-negative → `undefined`; etc. | not contraction axes | not stated | — | C:983-1025 |

Row T1.57 is a pointer row (no new form). Row T1.61 is listed because the source puts it in the same release; the sources do not tie it to the contraction.

---

### T2. Compiler declines and accepts (the interpreter still evaluates)

Column "before → after" uses: compiled → declines; declines → compiles; compiled value A → compiled value B; compiled → unspecified (the caveats allow any value; a throw; a decline). "any" target = javascript, python, glsl, wgsl, interval-js unless the row says otherwise.

#### T2-A. Compiled before, declines now

| # | form (short example) | before → after | target | rule | witness class / corpus count | replacement (CHANGELOG) | source |
|---|---|---|---|---|---|---|---|
| T2.1 | write to a symbol the compiled code does not declare (engine symbol, input, `vars` name): `Block(Assign(x, x + 1), x)` with `x: real`; `Block(Assign(c, n + 1), …)`; `Block(c ≔ [1, 2], c)` with `c: real` | wrote the `vars` object or a local copy of the input (and a second compilation) → declines "`x` is not a local of the compiled expression" (`assignLValue()`) | every target | block-local rule | Tycho: no `Assign` writes a symbol its block does not declare (all 757 documents + showcase; CE 0.176.0 and `aee059e66`); class not stated | return the value and let the host assign it; declare a local with a value and read the local | C:399-402, 25-35; P:1211-1213, 2126-2135, 2932-2942 |
| T2.2 | block with a statement other than a declaration with a value, used as an operand: `1 + Block(Assign(b, x), 2b)` | compiled (value of an assignment) → declines `'block-value'` as an operand; compiles as a statement, body of a function, of the compiled expression, or of a binder such as `Sum` | every target | block-local rule | corpus: art/wccrhnzn2q (6 javascript records) found a wrong decline of a `where` block, fixed before the final measure (binding blocks compile) | assign to a local declared before the block, and read the local | C:403-411; P:1211-1223 |
| T2.3 | block that ends in an assignment or declaration, value used: `[1, Block(b := 2)]` | JS gave `[1, 2]` → declines `'nothing-value'` | every target | block-local rule | Tycho 0 (P:1236-1239) | end the block with the name | C:412-414; P:1214-1217, 2192-2217 |
| T2.4 | loop whose value is used: `y := Loop(…)` | declined as before (unchanged) | every target | block-local rule | — | assign the result to a local declared before the loop | C:415-417 |
| T2.5 | local whose first value has type `unknown` and later is given a list, point, matrix or string | compiled (right value through a run-time shape test) → declines `unsettled-shape` | every target | R3 / block-local rule, choice 10 | plausible | not stated | P:1265-1268, 2186-2191 |
| T2.6 | `Block(a := 1, If(c > 0, a := Sqrt(-x)), a)` and the literal `2 + 3i` | (rule 7 measured) in `strict` javascript and glsl decline (`unsettled-shape` / `lane-mismatch`); in `complex` javascript gives the interpreter's values; Python declines both | strict | complex lane + block-local rule | not in the corpus | not stated | P:1269-1274 |
| T2.7 | curried call or partial application: `Apply(Apply(f, 1), u)`, `Apply(f, 1)` | compiled → declines (interpreter keeps them) | every target (JS, Python, interval-js, GPU) | function-value rule | Tycho census 0 (P:1463-1467); census at plan time: currying and partial application 0 (P:82); the bigint user (enumeratio, #503) is assumed not to use it (user decision 2026-11-03, P:2944-2956) | `f(1, u)`; call the function directly; one function per case | C:428-435; P:1385-1395, 1456-1462 |
| T2.8 | a function passed as an argument or through a parameter of function type: `h = (g: function) ↦ g(1)`, `h(x ↦ x + u)`; macro `v` passed bare (`_fn_r_s(_.x, _fn_v)`) | compiled → declines ("the argument `v` is a function, and compiled code does not pass a function value through a parameter") | javascript, interval-js (and others) | function-value rule | corpus: 1 document, neyret/oazduhqqid, row `\frac{r_s+r_p}{2}\{x<0\}`: 2 records (javascript, interval-js) newly decline; the compiled value was `NaN` (a Tycho defect, Tycho ROADMAP IX); Tycho accepts. Corpus declines javascript 43 → 44, interval-js 74 → 75 | not stated | C:432-435; P:1475-1484, 1519-1525 |
| T2.9 | a function returned from a call: `Apply(mk(1), u)` | compiled → declines | every target | function-value rule | Tycho census 0 | `f(1, u)` | C:432-433; P:1389-1393, 1463-1470 |
| T2.10 | a call of a block-local function whose value can change while its block runs (assigned more than once, inside a nested statement, from a call result): `Block(Declare(k, function, x ↦ x + 1), Assign(k, (x, y) ↦ x + y), k(u))` | declined (with specific reasons) → declines with one reason; also when the values have different signatures or one is not a function literal. `CompileTarget.reboundFunctions` becomes a `ReadonlySet<string>` | javascript, interval-js, python (glsl, wgsl decline earlier on the function literal) | function-value rule (S4-r5) | no corpus record; corpus 47 / 44 / 61 declines unchanged | not stated | C:36-45; P:2295-2321 |
| T2.11 | a function stored in a local assigned more than once | compiled → declines | every target | function-value rule | not stated | define one function per case | C:432-435; P:1389-1393 |
| T2.12 | local function declared as `Block(Declare(mk, "function", (a, k = 2) ↦ (x ↦ x + a + k)), mk(1))` | known limitation, not a decline: compiles and `run()` returns a JS function (the call of a block-local function has static type `unknown`) | javascript | function-value rule gap | known-limitations line; values agree with the interpreter | — | M:known-limitations (`javascript`: `Block(Declare(mk, …`) |
| T2.13 | default fills only a left-out argument: `g = (k: real = 2) ↦ k + 1`, `g(At(L, 100))` with `L: list<real>` | compiled gave the default (0.177.0) → compiled passes `NaN` (outside `real`: unspecified result); interpreter passes `Missing`. `g()` stays 3 on every target (GLSL, WGSL, `interval-js` included) | every target | function-value rule (reverses R6 "or absent") | not stated | `g(Coalesce(At(L, 100), 2))` | C:436-447; P:1396-1410 |
| T2.14 | `interval-js` call that supplies a number at a defaulted parameter | declined (`declineIntervalAbsentDefault`) → compiles | interval-js | function-value rule | not stated | — | C:446-447; P:1405-1407 |
| T2.15 | default that names a library constant or a `symbol<…>` symbol (`over: set = Integers`, `k: real = Pi`, `mode: symbol<Auto> \| symbol<Manual> = Auto`) | → filled by name in compiled code (a `vars` entry or local of the same name can hide it: known limitation) | every target | function-value rule | corpus: GitHub issue #490 | — | C:448-463; P:1411-1443; M:known-limitations (`vars: { Pi: '_.Pi' }`) |
| T2.16 | default that names a constant declared by the host (`ce.declare('W0', { isConstant: true, value: 5 })`, `f := (k = W0) ↦ k + 1`, `f()`) | 0.178.0: declines (every fill site); U (CE-803): compiles to `f(5)` = 6, the value of the constant read where the function is declared; value must be a number, string, boolean, list or tuple of such values, or `{}`; other values decline | every target | function-value rule | corpus: issue #490 | write the value or pass the argument (for the remaining decline) | C:136-147, 459-463; P:1431-1443 |
| T2.17 | default that names an Epsil `const` while the program is compiled before it runs | declines (the constant has no value at compile time) | every target | function-value rule | class not stated | write the value as the default, or pass the argument | C:143-147; P:1438-1443 |
| T2.18 | the compiled callback of a function with a defaulted parameter, `Fold((acc, x = 100) ↦ If(IsMissing(x), acc, acc + x), 0, [1, 2, Missing])` | gives 103 (default fills a supplied `undefined`); interpreter gives 3 | javascript, python | function-value rule choice (3) | crafted (known-limitations line) | — | M:known-limitations (`Fold((acc, x = 100)…`); P:1493-1498 |
| T2.19 | bigint mode: supplied `NaN` or `null` at a parameter with a default | took the default → throws the entry `TypeError` (only `undefined` takes the default) | javascript `mode: 'bigint'` | function-value rule | the bigint user (#503) | — | C:466-469; P:1456-1462 |
| T2.20 | `Apply((f) => f(1), (x) => x + 1)` | folded to 2 at compile time (other targets) → declines | interval-js | function-value rule choice (4) | crafted | — | P:1498-1500 |
| T2.21 | `(h: function) ↦ Map(h, [1, 2])`, `(h: (real) -> unknown) ↦ …`, untyped `h` (a root literal whose parameter has a function type) | declined (the callback-result test was the only decline) → compiles; calls the host's function | javascript (and targets that set `assertBoolean` do not matter here) | function-value rule exception ("the root is the exception to the decline of a function-typed parameter"); error model (S4-r7) | not stated; a root literal with `h: (real) -> real` already compiled | — | P:2598-2605 |
| T2.22 | `compile(expr, { mode: 'auto' })` | compiled (default of `javascript` and `python`) → declines `diagnostic.code === 'unsupported-mode'` | every target | complex lane | Tycho: 9 documents with `promoted: true` (12 records, all javascript, requested `auto`, result `complex`): showcase/cie-chromaticity, art/dlxysxelnj, art/guvicl57aa, art/lrhjtkkyls, art/s8ishknvhe (2 records), art/sqpmxjhvts (2, broadcast), art/tpalesypcc, neyret/hbvzf9yk1r (broadcast), neyret/wsne0l2tcv; 485 Tycho `auto` records (467 strict, 12 complex, 6 declined) | `mode: 'complex'` | C:471-483; P:846-868 |
| T2.23 | the default mode of the `javascript` and `python` targets | `'auto'` → `'strict'` (every target) | javascript, python | complex lane | as above | — | C:484-485 |
| T2.24 | real-lane operation whose exact value is complex: `compile(Sqrt(x))` at `x = -4`, `x: real` ; `\sqrt{x}^2` at `x = -4`; `\ln(x)` at `-2` | `{re: 0, im: 2}` (JS default) → `NaN` (on every target, as on the shader targets); `mode: 'complex'` gives `{re: 0, im: 2}`; interpreter gives `2i` / `-4` | every target | complex lane (allowed difference in M:48-55) | corpus: Tycho option A cost: 32 of 688 Desmos states in complex mode; 24 rows of 17 documents lose a GLSL leg and 18 an interval leg (P:949-952); interval-js declines 70 → 74 before Tycho's adoption, rows neyret/hbvzf9yk1r `\sin(\Re(Z))=0` and `\sin(\Im(Z))=0` | `mode: 'complex'` or declare the input `complex` | C:486-488; P:913-952; M:48-55 |
| T2.25 | complex value that reaches a binding compiled real; complex literal; `h(P[1])` with `P: list<tuple<complex, real>>` | compilation redone in complex mode → declines `'lane-mismatch'`; no redo | strict | complex lane | corpus: art/ur34gk3p8x `asOklab(c_2)` ("a point with a complex-valued coordinate") one new decline (3.4.6 measure, then not repeated) | `mode: 'complex'` or an annotated parameter | C:489-491; P:889-891, 1031-1035 |
| T2.26 | in `strict`: a value of type `number` (input, parameter, `number` element, `number` tuple component) | complex value there: unspecified (string `"[object Object]2"` for `hr(L[1])` with `L: list<tuple<number, real>>` at `[(1 + i, 2)]`); no decline, no test | strict (every target) | complex lane; caveat of M:61-80; CE-751 decision (d), user 2026-11-04 | corpus (prototype measures, not shipped): option (a) complex lane for `number`: javascript 47 → 117, glsl 44 → 82, interval-js 61 → 78, 15 keys (103 values) change, 715 CE tests fail in 89 files; option (b) decline on every target: javascript 47 → 109, glsl 44 → 86, interval-js 61 → 78 in 17 documents, 101 of 112 messages name `tuple<number, number>` or `tuple<number, number, number>`, no value changes (not chosen). M:61-80 gives "adds 62 JavaScript declines" for (b) and "adds 70 and changes 103 values" for (a) | `mode: 'complex'` or declare the binding `complex` | C:182-191; P:2477-2513; M:61-80 |
| T2.27 | engine's own compilations (the `Map` drain, `Reduce`, stochastic equality probes, numeric integration and series kernels) | compiled (auto) → compile in `strict`; `Map` drain and `Reduce` compute a `NaN` element with the interpreter; integrand computed in `complex` at a `NaN` sample; stochastic equality uses the compiled kernel only for an allowlist of heads (arithmetic, powers, roots, logarithms, trig and hyperbolic functions, rounding, `Max`, `Min`; without `Arcsec`, `Arccsc`, `Hypot`), else the interpreter samples | engine internals | complex lane | values do not change; a `solve` test broke when every internal compile was `complex` (`tan(arctan(a))` at `a = 10^5` off by 0.008); `∫₀^∞ x^{100} e^{-x}dx` regression fixed (P:997-1008, 1018-1023) | — | C:501-510; P:1018-1023 |
| T2.28 | five `mode: 'complex'` cases (value was `NaN` or a string): power of a call whose value is complex (`f(x)^2`, `f: (real) -> unknown`); element-wise `r·10^i` with `i: list<integer>`, `Sqrt(L^2)` with `L: list<real>`; `Sqrt`, `Ln`, `Log` of a value of wide type (`\sqrt{x^2+y^2}`, `x, y: real \| signed_infinity`); `Product` over a shared `Map` (`Sum(Map(f, P)) + Product(Map(f, P))`); fold over empty or one-element list (`Product(Map(Sqrt, P)) + 1` with `P = []` is `2`); negation of a real keeps `+0` imaginary (`Ln(-x)` at `x = 2` is `ln 2 + iπ`, was `ln 2 − iπ`) | wrong value → interpreter's value | complex | complex lane | corpus: neyret/crmswfhqrd `g(x)=\frac{a}{100}(f(x))^2` (8 values), neyret/l49l5stdag (36 values), neyret/4d9knkydej (7 values); cause E `plausible` | — | C:511-523; P:955-975, 1031-1035 |
| T2.29 | `mode: 'complex'`, call of a user function with a complex argument at a parameter the definition reads as real (`g(u)` at `u = 0.25`, `g(w)`, `w: complex`) | string `"[object Object]NaN1"` → `1.25`; for an argument with an imaginary part `NaN` (interpreter: `incompatible-type`) | complex | complex lane, cause D (CE-751.1) | corpus: art/hyvhlz4chj (8 values) and neyret/4d9knkydej `asOklab(g)` (7-8 values) | — | C:524-531; P:1036-1058 |
| T2.30 | `mode: 'complex'`, block local with a real value (`Block(Declare(k, "unknown", Floor(x)), Cos(k)) + Floor(x)`) | string `"[object Object]1"` → `1.5403` | complex | complex lane (CE-793, CE-796) | corpus: art/hyvhlz4chj second mismatch (`asOklab(c_{lavinga})`) | — | C:1000-1018; P:1054-1070 |
| T2.31 | known limitation: `Gamma(s, z)` with `z: real` at `s = 1`, `z = -1` in the default mode | `NaN` (interpreter: `e`); `mode: 'complex'` gives the value | javascript strict | complex lane | `plausible?` known-limitations line (dated 2026-11-03) | — | M:known-limitations; P:1066-1070 |
| T2.32 | known limitation: `mode: 'complex'`, `L = List(f(x)^2, 1)` local of `f: (real) -> unknown`, `L[1] + 1` | string `"[object Object]1"` (interpreter `1.2657`) | javascript complex | complex lane | `plausible?` | — | M:known-limitations |
| T2.33 | a complex-lane value assigned to a symbol declared real: `r: real` assigned `z: complex`; the stored value can be complex | compiled → compilation that reads such a symbol declines when the stored value can be complex; valid input `z = 2 + 0i` gives the interpreter's value | every target | assignment overlap (CE-800/801) | Tycho row 483 | — | C:112-115 |
| T2.34 | condition that can be a value other than a boolean: `If(c, 1, 2)`, `Which`, `Boole(c)` with `c: boolean \| integer`; untyped parameter `c` in `(c ↦ If(c, 1, 2))(b)`; condition typed `unknown` | compiled JS: threw at run time for such a value → declines `unsettled-shape`. An absent condition still reads as `false`. Python and shader targets do not set `assertBoolean`: no decline (Python gives `1` at `c = 1`, a known limitation) | javascript | R5 (condition) / error model (S4-r7) | crafted (`c: boolean \| integer`); `plausible?` (untyped parameter `c ↦ Block(t ≔ 0; If(c, t ≔ 1, t ≔ 2); t)`). Kept: the predicate throw of `predicateResult` stays because of Tycho row 339 (gasket program, `recursive-list-builder-compile.test.ts`, corpus witness) | give the condition a boolean type | C:171-180; P:2541-2553, 2586-2597; M:R5, known-limitations (`python`, `c: boolean \| integer`) |
| T2.35 | element of a collection operation (`Map`, `Filter`, `Sum`, …), `Tuple` coordinate, callback result of `Map`/`Tabulate`/`Scan`, operand of `IsMissing`/`Coalesce`/`AssertPresent`, dictionary value, the symbol `Nothing` as operand — whose static type has an explicit `nothing` arm (`nothing`, `real \| nothing`, `list<real \| nothing>`) | declined with `compile-error` (generic) before; callbacks were analysed → declines with the one code `possible-nothing` read from static types; `any` and `unknown` have no `nothing` arm and compile (`Map(h, 1..3)` with `h := k ↦ k + 1` gives `[2, 3, 4]`; `(u ↦ 7)(P)`, `Apply(u ↦ Norm(u), P)`, `Map((t: any) ↦ 2t, [1, 2])`, `k(PointList(x, y))` with `k: (unknown) -> number`) | every target | error model | the first version of row 7 (any admits `nothing`) was REPLACED by the explicit-arm rule the same day (P:2656-2679); `crafted` / `plausible` / `plausible?` per case for the version that was replaced (P:2586-2597) | — | C:148-170; P:2520-2535, 2586-2597, 2656-2679, 2749-2778 |
| T2.36 | `Sum` or `Product` of a collection, or `Reduce` / `Scan` by `Add` or `Multiply`, whose element type is `any`: `Sum(w)` with `w: collection<any>` | compiled to a per-element `Array.isArray` test → declines `unsettled-shape` (`assertSettledFoldElements()`), every target. Python `Reduce`/`Scan` by `Add` over `list<any>` declines as it did before | every target | R3 | review finding of Codex; same fold over `unknown` elements, a number-or-collection union, or a source typed `any` still compiles with a run-time test (CE-805, `decision needed`, Tycho row 425, plausible) | declare `w: collection<real>` | C:164-170; P:2767-2778, 2855-2856, 2887-2890; M:R3 |
| T2.37 | element-wise `If`/`Which` with a branch that can be a point or a list of points: `If(F, W(t), (0, 0))` with `W: (real) -> tuple<real, real> \| list<tuple<real, real>>`, `F: list<boolean>` | JS tested the value at run time (`_SYS.pointOrPoints`) → declines `unsettled-shape`. An INPUT declared with the union (`P: tuple<real, real> \| list<tuple<real, real>>`) still compiles as a branch (tested once at the binding) | javascript | R3 / R4 (S4-r3) | no corpus witness: Tycho 0 occurrences of `_SYS.pointOrPoints` in the corpus (`a34405ae0`); tests `tycho-item-249`, `-253`, `ce-514` came from Tycho items: `plausible` | declare the result of `W` with one shape, or one function per shape | C:192-201; P:1970-2014 |
| T2.38 | `W(t) + L` with `W` as above, `L: list<tuple<real, real>>` | JS tested at run time → declines `unsettled-shape`; `P + L` with the union input compiles | javascript | R3 / R4 | as T2.37 | declare one shape | C:203-208; P:1991-2014 |
| T2.39 | declared union input with a body that declines for one member: `U: real \| list<real>`, `Sum(U)`, `Product(U)`, `If(x > 0, U, x)`; on interval-js `U + w`, `U < 3` | one body for all shapes with run-time tests (28 compiled results in the tests) → declines with the reason of that body | every target (interval-js adds `U + w`, `U < 3`) | R4 | as T2.37 | declare the one shape you pass, or compile one function per shape | C:210-218; P:1976-1980, 1995-1997, 2065-2068 |
| T2.40 | `Sum(P) + (1, 1)` with `P` a list of points (`Sum(P)` typed `integer \| tuple<real, real>`); a function whose parameter is `list<tuple<number, number>> \| tuple<number, number>` compiled as one body (`\|P − (4, 0) − (1, 2)\|`, `g(Q)`); `\|H(t)\|` for `H: (real) -> list<number> \| tuple<number, number>` | JS tested at run time; the `Abs` of `list<number> \| tuple<number, number>` gave a WRONG value `[3, 4]` for `(3, -4)` where the interpreter gives `5` → declines on every target. Still compile: `g((x, y))`, `g(Q)` with `g(P) = \|P − (4, 0)\|`, input union as `If` branch, `P + L` for union input, `(v ↦ PointList(v.y, v.x))(P)`, `k((x, y))` | every target for `Abs`; javascript for the rest | R3 / R4 | as T2.37; the `Abs` wrong value found by review round 1 | declare one shape, or compile one function per shape | C:220-233; P:1982-2014 |
| T2.41 | `PointList(p.y, p.x)` with `p` undeclared (inferred `collection<any> \| tuple`) | JS tested at run time → declines `unsettled-shape`; `ce.declare("p", "tuple<real, real> \| list<tuple<real, real>>")` compiles one body per shape | javascript | R3 / R1 | as T2.37 | declare `p` | C:235-243; P:1997-1999 |
| T2.42 | R3 selection errors: condition list-of-lists, `Missing` element, `collection<boolean>`, `set<boolean>`, `list`, `list<any>`, arm of lists, string/set arm under a list of conditions, number arm beside a point arm | compiled → decline (the same errors found from types) | every target | selection rule | corpus: 757 documents, none holds one (C:853-857) | — | C:833-843, 853-857 |
| T2.43 | selection with a condition whose type is a list on GLSL, WGSL, interval-js, Python | (S4-r1) no per-target copy existed: `assertScalarCondition()` refused it on every target except JavaScript; only the JS lowering of element-wise selection exists | non-JS targets | selection rule (S4-r1) | measured: no new decline | — | P:1697-1704 |
| T2.44 | `PointList` source typed as a list, point input shape, run-time `Array.isArray` tests (`P + (1, 2)` with `P: list<tuple<real, real>>`, `\sum(V)` with `V: list<real^3>`, `Dot` of two points of stated width, `Sum(At(L, 2..5))`, `Repeat` count, `Slice` span) | compiled with a run-time test (`_tv3.map` guarded by `Array.isArray`, `_SYS.matmul` fallback, `RangeError` for `PointList`) → compiled with no test (term-by-term fold, `_tv3.map(…)`); a wrong input shape is unspecified | javascript | R5 (no test of a value against its static type) | not stated; "Some of these programs declined before and now compile" | host supplies every input with a value of its declared type | C:937-955; P:1937-1957 |
| T2.45 | call of a user function, block-local function, annotated function literal with a declared parameter type: `f: (real) -> number`, `f(y)` | `_fn_f$t(_.y)` (shim giving `NaN` or `undefined`; `_IA.checkedCall` clipped an interval) → `_fn_f(_.y)`; no test; `checkedCall` no longer exported from the interval library. `g: (integer) -> integer`, `y: real`, `g(y)` declined on Python and GLSL → compiles on every target (assumed to hold the type); recursive `f(n - 1)` at an `integer` parameter compiles. Only an argument with no value of the parameter type declines. A function value given to a consumer with complex-lane elements declines: `h: (real) -> real`, `Map(h, [√y, 1])` compiled → declines | javascript, interval-js (shim), python and GLSL (g(y)); consumer decline every target | R5 | not stated | — | C:904-925; M:R5 |
| T2.46 | declared scalar result type: every call of such a function (`h: (number) -> number`, `h := t ↦ [t, t]`), a bare call `h(u)`, a function value `Map(h, xs)` | compiled and returned the list → declines | javascript, interval-js, python | R5 (issue #488) | corpus: GitHub issue #488 | — | C:956-965; M:R5 |
| T2.47 | compiled input left out: `run()` / `broadcast()` / `interval-js` runner with a collection input `L: list<real>` left out; `x > 0`, `If(x > 0, 1, -1)`, `Equal(a, b)`, `And(p, q)` with `p: boolean` | refused or gave `NaN` / the empty interval / `undefined` → throws `TypeError` (JS) / gives `undefined` (interval-js) / plain `0 < _.x` (false) / plain `===` / truthiness `_.p && _.q`; a symbol declared `boolean \| missing` keeps the three-valued test; Python `compileFunction()` / `compileLambda()` no longer start with a test of the input; entry plan loses `required`; `interval-js` `listInputs` = inputs declared with a collection type that has no `missing` arm | javascript, python, interval-js | R5 / R6 (host supplies every input) | not stated | supply every input | C:859-880; M:R5 |
| T2.48 | compiled absent argument of a function; absent point in a list of points given to a function (`f := t ↦ 2t`, `L = [(1, 2), Missing]`, `Map(f, L)`) | gave the interpreter's value `[(2, 4), Missing]` → throws a `TypeError` (JS); `_SYS.present` removed; "Some of these programs declined before and now compile"; point input arithmetic `P + (1, 2)` written component by component | javascript | R5 / R6 | not stated | — | C:881-896 |
| T2.49 | the runner refusals: array, boolean or string for a binding declared with a number type; any value but a string for a binding declared `string` | refused by `run()` / `load()` / `broadcast()` → not refused; the stored entry plan has no `scalars` and `texts` fields (stored plans with them still load). Still refused: `{re, im}` other than `~oo` for a binding read as real; string or typed array for a binding read as a list | javascript | R6 | not stated | — | C:927-936 |
| T2.50 | compiled `Sum` / `Product` over an empty range of a body of known vector width: `Sum(i * [x, y, z], i, 1, n)` at `n = 0` | scalar `0` / `1` → `[0, 0, 0]` / `[1, 1, 1]` (inside a broadcast both agree); interpreter also changed (T1.54) | javascript | R3 / static type | not stated | — | C:897-903 |
| T2.51 | `If`/`Which` with an absent condition; `Equal` over collections; `Any`/`All` over elements that may be absent; `IndexOf`, `Contains`, `Element` with a searched value that may be absent; a chained `Equal` with an absent operand before an impure one (`Equal(x, Which(t > 0, 1), Random())`); on Python `Dot` and `Cross` with an operand that may be absent | `If(At(B, 9), 1, 2)` gave `NaN`; `Equal([1, Missing], 1)` was `[true, NaN]` → next branch (`2`); `[true, false]`; (the others used the interpreter) → now compile (unspecified by the caveats) | javascript, python | error model / two-valued comparisons (S4-r2) | corpus: 0 changed values, none reach a corpus record (P:1851-1853) | — | C:245-257; P:1849-1853, 1875-1881 |
| T2.52 | `CompileTarget.absence.object.isNull`, `collectionEqualityOperand`, ~25 `BaseCompiler` statics of the condition analysis (list at C:12-24), exports `ConditionDialect`, `ConditionNode`, `CONDITION_DIALECT_JS` | public API → removed | custom targets | error model (S4-r2) | not stated | `BaseCompiler.compile`, `BaseCompiler.guardCondition`; `absence.object.isAbsent` | C:5-24; P:1792-1802 |
| T2.53 | comprehension guard whose static type is not the scalar `boolean` (integer guard, element-wise `Equal`) | `if (x)` truthiness → `=== true` (JS) or `pythonGuardTest()` (Python): a list-valued relational guard keeps nothing | javascript, python | error model (S4-r2) | one test added (`comprehension-guard`) | — | P:1817-1823, 1843-1844 |
| T2.54 | JS element-wise lists `If(c, L)` (3.2) | scalar condition false: the compiled restricted list gives one scalar `NaN` for the whole list where the interpreter gives `Missing` (allowed by the caveats); Tycho compiles the restricted list once instead of each of 10 cells (one document, Planck curves over `(0..0.1..1)`, 40 records fewer) | javascript | selection rule | corpus: one document; every cell within relative 5.7e-13 | — | P:218-228 |
| T2.55 | `B: broadcastable<number>`, `P: tuple<real, real>`, `If(B < 0, P)` at `B = 1` | `undefined` for the whole value (interpreter `(NaN, NaN)`) | javascript | selection rule | `plausible?` (known-limitations) | — | M:known-limitations (last line) |
| T2.56 | GLSL / WGSL guarded calls `sin`, `cos`, `sign`, `min`, `max`, `clamp` | built-in → NaN-safe helper (`_gpu_sin`, …): parameter of a user function (`F(a, b) := sin(a) + cos(b) + min(a, b)`, gives `_gpu_sin(a) + _gpu_cos(b) + _gpu_min(a, b)` in `_fn_F`); the index of a `Sum`, `Product` or a loop the shader does not unroll; a call of a user function whose result type has no declared range (`sin(f(x))`, `f(u) := cos(u)/2` gives `_gpu_sin(_fn_f(x))`); a quotient by `cos(u)` with `u` in a bounded interval. Restored by a declared range (`t: real<-5.5..5.5>`; `f: (real) -> real<-1..1>` gives `sin(_fn_f(x))`; `sin(1000·f(x))` gives `sin(1000.0 * _fn_f(x))`; `(real) -> real` keeps the helper). No decline, no value change | glsl, wgsl | "host provides the finite proof" (S4-r9, user decision 2026-11-04) | corpus: 540 → 713 successful GLSL records calling a guarded helper (102 → 136 documents; `sin` 334 → 488, `cos` 345 → 497, `max` 121 → 140, `min` 69 → 76, `clamp` 0 → 0; `compare.mjs` own count sin or cos 416 in 66 → 586 in 104); by key 100 keys gain a helper, none loses one, in 44 documents (neyret/g91gh9zpcr 11, gwqx9ckx7h 11, bpnkluuy7y 7, …); Tycho's audit of 0.176.0 had 124 shader records in 12 documents with helpers (counts are for Tycho `a34405ae0`; later Tycho commits `2930172d1`, `f199c5a67` change the declarations) | declare the range of an input or a ranged result type | C:71-96; P:1650-1666, 2703-2748, 2823-2845 |
| T2.57 | `CompileTarget.gpuParameterFacts` | field existed → removed | custom shader targets | row 9 | — | — | C:65-67 |
| T2.58 | loop whose `Break(v)` value is compared (admission check) | check declined a discarded loop value on a shader target → check removed; a loop whose value is used and that has a `Break` declines as `loop-value` | shader target | block-local rule (S4-r3) | crafted | — | P:1960-1969 |
| T2.59 | Python `[1, Block(Assign(b, 2))]` | generic decline "a multi-statement construct … cannot be used as a sub-expression" → `nothing-value` message | python | block-local rule (S4-r4) | no test asserts it | — | P:2213-2217 |
| T2.60 | unsettled shape through `If(0 < x, Block(Assign(y, 1), Assign(y, y + 1)), Assign(y, 3))` | (documented as still compiling, reaching the IIFE / hoist code) | javascript, interval-js, glsl | block-local rule | — | — | P:2206-2212 |

#### T2-B. Declined before, compiles now

| # | form | before → after | target | rule | witness / count | source |
|---|---|---|---|---|---|---|
| T2.61 | `Any` and `All` over elements that may be absent; `IndexOf`, `Contains`, `Element` with a searched value that may be absent; chained `Equal` with an absent operand before an impure one; Python `Dot` and `Cross` with an operand that may be absent | declined → compiles | javascript, python | error model (S4-r2) | none reach a corpus record | C:253-257 |
| T2.62 | local function with a body of `any` type: `Map(h, 1..3)` with `h := k ↦ k + 1`; Epsil `let h = (k) => k + 1; map(h, 1..3)`; `Map(g, P)` with `g := p ↦ Norm(p)` | declined (`compile-error`) → compiles (explicit-`nothing`-arm rule) | every target | error model (S4-r7 part 2, via S4-r9) | `plausible` (Epsil local function), `plausible?` (`Map(g, P)`) | C:161-163; P:2749-2778 |
| T2.63 | root function literal with `h: function`, `(real) -> unknown`, or untyped | declined → compiles | javascript | function-value rule exception | not stated | P:2598-2605 |
| T2.64 | a call that supplies a number at a defaulted parameter on `interval-js` | declined → compiles | interval-js | function-value rule | not stated | C:446-447 |
| T2.65 | `g(y)` with `g: (integer) -> integer`, `y: real`; recursive `f(n - 1)` at an `integer` parameter | declined (Python, GLSL) → compiles | python, glsl (all targets after) | R5 | not stated | C:917-921 |
| T2.66 | host constant default `f := (k = W0) ↦ k + 1` | declined (0.178.0) → compiles (CE-803) | every target | function-value rule | corpus: #490 | C:136-147 |
| T2.67 | `AsOklab(cd)` with `cd: list<color>` at `[Missing, Rgb(0, 1, 0)]`, and `ss: list<string>` at `[Missing, "b"]` (`At(ss, 2)` is `"b"`, `At(ss, 1)` is `undefined`) | failed to compile ("its value has the type 'list<color \| missing>' …") → compiles | javascript | `Missing` result only (CE-791) | corpus: neyret/po7rdhtoth `asOklab(c_d)` (a Tycho decline on the 3.4.2 run, Tycho declares `list<color \| missing>`) | C:647-661; P:622-627 |
| T2.68 | `ce.box("Indeterminate")` / a non-canonical box | compiled via symbol-table entries → `NaN` before compilation; a non-canonical box still compiles to `NaN` on the four targets | javascript, python, interval-js | error model (S4-r7) | not stated | P:2536-2540 |
| T2.69 | corpus rows that declined and now compile | 2ki2hjsouf `0.7C[C_{i}]+A_{xisPos}`, epq7yidtim `0.4(N_n(u))[A_n+1]+…` (3.4.2); neyret/xhlkk7k9aq on GLSL (3.4.1, two-valued comparisons); art/njncrg9fkv on JavaScript (CE-792); 15 rows compile that declined before (tycho-f9 audit of 0.178.0 vs 0.176.0: javascript 68 → 47, glsl 48 → 44, interval-js 99 → 61) | — | — | corpus | P:622-626, 449-463; MEMORY note (not a source of this table); C:694-696 |
| T2.70 | S4-r1..r9 corpus result | 0 changed values, 0 new throws, 0 new declines in every row; declines javascript 47, glsl 44, interval-js 61 | — | — | 17,825 compiles, 13,707 keys, 77,267 values (rows 1-9); row 9 only: 100 keys gain a helper | P:1718-1724, 1845-1853, 2036-2043, 2232-2241, 2374-2380, 2456-2460, 2621-2627, 2816-2823 |

#### T2-C. Known limitations in M (21 lines; one per line; listed because the task names the list). "Tie" = the source ties the line to the contraction effort.

| # | line (target, program, compiled vs interpreter) | tie to the effort stated in the source | witness class |
|---|---|---|---|
| K1 | javascript, `x: real \| nan`: `Arcsec(x)`, `Arccsc(x)` at `x = 0.5`, `InverseHaversine(x)` at `x = 4` give `NaN`; interpreter a complex value | no | not stated |
| K2 | `plausible?` javascript strict: `Gamma(s, z)` at `s = 1`, `z = -1` gives `NaN`, interpreter `e` | yes (default since removal of `auto`, 2026-11-03) | plausible? |
| K3 | `plausible?` javascript `mode: 'complex'`: `Block(Declare(L, "unknown", List(f(x)^2, 1)), L[1] + 1)` gives `"[object Object]1"`, interpreter `1.2657` | yes (complex lane, CE-793) | plausible? |
| K4 | javascript: loop with outer `a = 100`, `function f() { a }`, `let (a, b) = (k, f())`: compiled `b` is `k` (was CE-756) | no | not stated |
| K5 | python: `At(L, 1.5)` gives `10`, interpreter `NaN` | no | not stated |
| K6 | javascript, python: dependent `Sum` clauses give 36 vs 24 | no | not stated |
| K7 | javascript: `Take(Range(1, ∞), w/y)` with `w = y = 0` gives `[]`; interpreter unevaluated | no | not stated |
| K8 | javascript: `Unique(If(c, Take(xs, w/y), xs))` gives `[]` | no | not stated |
| K9 | python: `c: boolean \| integer`, `If(c, 1, 2)` at `c = 1` gives `1`, interpreter unevaluated; the JavaScript target declines it | yes (S4-r7, R5 condition) | crafted |
| K10 | javascript: interpreter fallback of a decline with `p: any` assigned `2L` | no | not stated |
| K11 | javascript: `z: complex`, `v: list<real>`, `Map((p) ↦ Real(p), When(z, v > 0))` — names the `When` operator, which 0.178.0 removed (line is not updated in the source) | no (stale) | not stated |
| K12 | javascript: a `vars` entry whose caller code names `_c` | no | not stated |
| K13 | javascript: `h: (broadcastable<integer>) -> broadcastable<integer>`, `h(S)` with `S: list<string>` gives `["a1", "b1"]` | no | not stated |
| K14 | javascript: `vars: { p: '2+3' }`, `2p` gives 7 | no | not stated |
| K15 | javascript: `Fold((acc, x = 100) ↦ …, 0, [1, 2, Missing])` gives 103, interpreter 3 | yes (function-value rule choice 3) | crafted |
| K16 | javascript `constantFold: false`, `vars: { Pi: '_.Pi' }`: `f := (x, k = Pi) ↦ x + k`, `f(1)` at `Pi = 3` gives 4 | yes (library-constant defaults) | not stated |
| K17 | javascript: `Block(Declare(mk, "function", (a, k = 2) ↦ (x ↦ x + a + k)), mk(1))` compiles; `run()` returns a JS function | yes (function-value rule gap) | values agree |
| K18 | interval-js `constantFold: false`: `PointX([Missing, []])` gives one `empty` result | no | not stated |
| K19 | interval-js: `Coalesce(1/(y - 3), 2)` at `y = 3` gives `[2, 2]`, interpreter `~∞` | no | not stated |
| K20 | javascript: `vector` declared `(real) -> list<real^2>` with body `t ↦ W`: `Sum(vector(x))` gives 3, interpreter 6 | no | crafted |
| K21 | javascript: `B: broadcastable<number>`, `P: tuple<real, real>`: `If(B < 0, P)` at `B = 1` gives `undefined`, interpreter `(NaN, NaN)` | yes (selection / `NaN` point, 2026-11-03) | plausible? |

---

### T3. Removed compile options, modes, result fields, hooks and API

| # | item | before → after | replacement (CHANGELOG) | witness / count | source |
|---|---|---|---|---|---|
| T3.1 | compile mode `'auto'` | accepted (default of `javascript` and `python`) → `compile(expr, { mode: 'auto' })` declines `diagnostic.code === 'unsupported-mode'` on every target; the option check still accepts the string `'auto'` only to give that decline (message names `'complex'`); `CompileMode` is `'strict' \| 'complex' \| 'bigint'` | `mode: 'complex'` | 9 documents, 12 records with `promoted: true`; 485 Tycho `auto` records | C:471-483; P:1009-1013 |
| T3.2 | default mode | `'auto'` → `'strict'` for every target | — | — | C:484-485 |
| T3.3 | result fields `promoted` and `escalation`; `result.mode` | removed; `result.mode` is the requested mode, `'strict'` when none is requested | `result.mode === 'complex'`, or compile `'strict'` for the shader | Tycho's 14 readers of `promoted` (`src/plot/ce-compile.ts` ~11 sites, `src/plot/resolve-fn.ts` 523, 1118, 2258) change at adoption; user chose option A (every row of a complex-mode document compiles `complex`, CPU only) | C:492-495; P:913-952, 1109-1112 |
| T3.4 | `supportedModes` | no longer accepts `'auto'` | — | — | C:496-497 |
| T3.5 | `reset()` hook of a custom compile target (`CompileTarget.reset`) | no longer called (0.178.0) → field removed (U); an object that still has the field is accepted, the field is not read or checked, TypeScript reports it in an object literal typed `CompileTarget` | — | — | C:496-497, 46-51 |
| T3.6 | bigint escalation (a compilation to `mode: 'bigint'` when a run-time value passes `2^53`) | would have been added → "will not be added"; `'bigint'` only when requested | request `mode: 'bigint'` | the third-party bigint user (enumeratio, #503, ROADMAP CE-715); reply to #503 deferred | C:498-500; P:2951-2956 |
| T3.7 | promotion record: `BaseCompiler` statics `_promoted`, `notePromoted`, `recordPromotion`, `recordFoldedPromotions`, `hasPromotedDefinition` | removed (U); no CHANGELOG entry at the time of commit `2e3ac5fd4` | — | — | C:52-57; P:2429-2433 |
| T3.8 | `CompileTarget.absence.object.isNull`, `collectionEqualityOperand` | removed | `absence.object.isAbsent`; none (compiled `Equal`/`NotEqual` over collections always give a boolean) | — | C:5-11 |
| T3.9 | `BaseCompiler` statics of the condition analysis (`isAbsenceSymbol`, `operandMayBeAbsent`, `ATOMIC_FRAGMENT`, `mayBeUndecided`, `compileGuardTest`, `conditionDecidability`, `conditionNode`, `connectiveNode`, `isDecidedByConstruction`, `operandPresenceConjuncts`, `isNanLiteral`, `absentOnlyThroughNumericSlots`, `peelNegations`, `kleene*` (6), `isDecidedBooleanValue`, `withConditionOperands`, `exactSelect`, `compileExactCondition`, `conditionDialects`, `conditionDialectOf`) and exports `ConditionDialect`, `ConditionNode`, `CONDITION_DIALECT_JS` | removed | `BaseCompiler.compile`, `BaseCompiler.guardCondition` | — | C:12-24 |
| T3.10 | `CompileTarget.inputWrites`, `CompileTarget.inputLocals`; `BaseCompiler` statics `classifyLocalReads`, `loopRunsOnce`, `localReadWithNoWrite`, `nestedOnlyLocals`, `chainedLocalDeclares`, `chainedAmbientWrite`, `scopeChainBinds`, `splitChainedAssignments`, `localVarsObjectStatement` | removed; a target no longer makes a local copy of an input or compiles the expression a second time | — (the forms they handled are static errors since 0.178.0) | — | C:25-35 |
| T3.11 | `CompileTarget.reboundFunctions` | `Map`-like record with a function literal or a decline reason per name → `ReadonlySet<string>`; `reboundLocalNames` returns the set; `reboundFunctionScope`, `noteLocalFunction` take it | — | — | C:36-45 |
| T3.12 | `BaseCompiler` statics `callbackExcludesNothing`, `isElementReadWithoutNothing`, `isCompiledIndex`; `assertCollectionOmissionSupported` renamed `assertNoNothingElement` (no `target` argument); `withScalarFedLiteral` takes no kind argument; `scalarFedLiterals` is a `Set` | removed / renamed | — | — | C:58-64 |
| T3.13 | `CompileTarget.gpuParameterFacts` | removed | — | — | C:65-67 |
| T3.14 | `_SYS.present` helper, the `_fn_f$t` shim, `_IA.checkedCall` (no longer exported from the interval library), `_SYS.pointOrPoints`, `_SYS.wholeAt`, `_SYS.pointDepthUnknown`, `_SYS.absentByDepth`, the `'absent'` selector of `selectWith` | removed | — | — | C:881-896, 904-925; P:1671-1696, 1970-1981 |
| T3.15 | `entryChecks` option and stored entry plan fields | `compile(expr, { entryChecks: false })` stays (turns the entry steps off); stored plan fields `required`, `scalars`, `texts` removed (a stored plan with them still loads, fields ignored) | — | — | C:879-880, 935-936; M:R6 |
| T3.16 | `When` operator | library operator → removed (see T1.46) | `["If", c, e]` | Tycho builds `["When", body, condition]` in `plot/ce-compile.ts`, `plot/webgl/gpu-implicit.ts`, `plot-core/normalize-restrictions.ts`, `plot-core/classification-restricted-definition.ts`, `plot-core/classification-floor-plane.ts`, `graph-paper/desmos-import/normalize/basic.ts`; ~30 readers; 19 test files hold `"When"` | C:797-807; P:187-207 |
| T3.17 | `ce.Indeterminate`, `INDETERMINATE_VALUE`, `isIndeterminateValue`, `Expression.isIndeterminate` | removed (see T1.18) | `ce.NaN`, `isNaN` | — | C:542-544 |
| T3.18 | `ArithmeticDefinition.isExact` | deprecated, no longer read | — | — | C:545-546 |
| T3.19 | Permutation-only group queries | removed (see T1.60) | `GroupOrder` etc. | — | C:966-978 |
| T3.20 | features the plan considered dropping by name: WGSL target, Python target, value kinds, separate packages | decision 2026-11-02: kept (step 4 row 8 is EMPTY); `broadcast()` batch API and the kernel pool kept with a `corpus` witness (2,870 expressions of 314 documents with `broadcast: true`) | — | — | O:604-617 (decision table); P:76-96, 1647-1648 |
| T3.21 | complex mode names no longer reachable | `'auto'` entry of `COMPILE_MODES` kept (decline message); lane records per definition (`recordUserFunctionLane`, `_userFunctionLanes`, `recordUserFunctionParamLanes`), recursive-call retry (`emitWithRecursiveLaneRetry`), promotion suppression of `compiler-mode.ts` kept (reached) | — | — | P:2436-2451 |

---


### Notes and conflicts between the sources

1. Row 7 of step 4 (P:2656-2679): the first decision ("`any` includes `nothing`", commit `faef4d574`) was REPLACED the same day by the explicit-arm rule (folded into row 9 part 2, commit `9043a313d`). The CHANGELOG `[Unreleased]` (C:148-170) states only the final rule. T2.35 follows the final rule; the `plausible` / `crafted` classes quoted at P:2586-2597 belong to the replaced version.
2. The plan's table at 3.4.5 (P:1411-1443) says a host constant default declines; CE-803 (P:1438-1443, C:136-147) reverses that for a literal-valued host constant. An Epsil `const` compiled before the program runs still declines.
3. M:61-80 (known-limitations/caveat text) gives the CE-751 prototype counts as "a decline of every `number` binding adds 62 JavaScript declines, and the complex lane for every `number` adds 70 and changes 103 values". P:2484-2492 gives javascript 47 → 109 (decline, +62) and 47 → 117 (+70) for the same options; consistent.
4. P:1031-1035 corrects the options-page-6 table: `h(P[1])` with `P: list<tuple<complex, real>>` declines with `lane-mismatch` in `strict` (T2.25).
5. P:223-228 (3.2 record) and P:252-286 (3.3 record): whole-list `Missing` for a false scalar condition over a list in the interpreter, one scalar `NaN` in compiled code. The 0.178.0 CHANGELOG (C:850-851) keeps `Missing` for scalar `Which` with no match; the 3.3 whole-list rule is in C:808-814 only as "with `t = -1` it is `Missing`, as before".
6. Stale line in M known limitations: K11 names `When`, which 0.178.0 removed (not changed, listed only).
7. Witness classes: the plan's step-4 records use `corpus` / `plausible` / `crafted` explicitly only in rows 3, 4 (block-local choices in 3.4.4), 7, 9; for 3.4.x CHANGELOG entries the class is mostly "not stated" and I gave the counted corpus evidence where the record has it.
8. Counts of Tycho corpus differ by record and date: 757 documents (CHANGELOG 853, 3.4.x), 688 Desmos states (P:949-952), 8,231 rows (C:717), 17,825 compiles / 13,707 keys / 77,267 values (rows 1-9 measures), 17,690 / 17,655 (3.3 and 3.4.2 measures, Tycho `44a25d4e3`), Tycho `a34405ae0` for rows 1-9. The corpus measures of step 4 were all run on `a34405ae0`, not on Tycho `f51646a04` (the 0.178.0 adoption; P:2240-2241).
9. Open items the sources name that change a form's status later: CE-805 (the run-time fold test over `unknown` elements, `decision needed`, Tycho row 425), CE-798 (a selection over lists of different lengths errors at boxing since 0.178.0; Tycho alignment; deferred; named in the MEMORY note, not in the sources of this task), CE-799 (Tycho row 486), the pending reply to #503 and #490.



## 4. Quality and performance of the generated code, and of the compiler

Machine: Apple M5 Max, 18 cores, Node v26.13.0, sources loaded through `tsx` (not production
bundles). All timing runs held the box lock; the load average (1 minute) is recorded with each
series.

### 4(a) Compile time

Harness: `benchmarks/compilation-cost.mjs` (current working-tree copy, run with the root set to
each worktree: `/tmp/wt-compute-engine-29-base` and `/tmp/wt-compute-engine-29-head`). `--check`
passed on both (17 of 17 cases supported); the emitted-source digest and code length are identical
for all 17 cases at the base and at the head. Settings: `RUNS=7 ITERATIONS=20`, 3 processes per
revision in the order base, head, head, base, base, head (balanced, not strictly alternating).
A table cell is the median over the 3 processes of each process's median over 7 trials, in ms.
Spread = (max − min) of the 3 process medians divided by their median. Ratio = head / base.
Load average after each run: 3.8, 3.8, 3.8, 5.4, 4.6, 4.7 (during the base2 run another activity may
have been present; its warm times do not differ from base1's).

```
node --import tsx benchmarks/compilation-cost.mjs <worktree> --check
MODE=counts timeout -k 30 600 node --import tsx benchmarks/compilation-cost.mjs <worktree>
RUNS=7 ITERATIONS=20 timeout -k 30 600 node --expose-gc --import tsx benchmarks/compilation-cost.mjs <worktree>
```

| Case | Warm base | Warm head | Warm ratio | First base | First head | First ratio | Spread base / head (warm) |
|---|---:|---:|---:|---:|---:|---:|---|
| identity | 0.072 | 0.066 | 0.91 | 0.322 | 0.289 | 0.90 | 11 % / 1 % |
| plot | 0.355 | 0.349 | 0.98 | 0.867 | 0.806 | 0.93 | 5 % / 1 % |
| slider | 0.244 | 0.270 | **1.11** | 0.609 | 0.653 | 1.07 | 1 % / 1 % |
| radical-strict | 0.204 | 0.228 | **1.12** | 0.667 | 0.611 | **0.92** | 2 % / 1 % |
| folded-complex | 0.883 | 0.651 | **0.74** | 1.63 | 1.30 | 0.79 | 6 % / 1 % |
| radical-complex | 0.095 | 0.096 | 1.00 | 0.459 | 0.451 | 0.98 | 1 % / 4 % |
| list-map | 0.347 | 0.343 | 0.99 | 0.986 | 0.929 | 0.94 | 2 % / 3 % |
| point | 0.257 | 0.261 | 1.02 | 0.732 | 0.699 | 0.95 | 4 % / 3 % |
| shared-complex-fold-6 | 13.52 | 2.65 | **0.20** | 14.99 | 3.84 | **0.26** | 0 % / 2 % |
| shared-complex-fold-10 | 176.31 | 5.04 | **0.03** | 181.54 | 7.79 | **0.04** | 2 % / 2 % |
| shared-node-6 | 0.506 | 0.501 | 0.99 | 1.25 | 1.22 | 0.98 | 4 % / 4 % |
| shared-node-10 | 0.737 | 0.748 | 1.02 | 1.59 | 1.59 | 1.00 | 8 % / 4 % |
| shared-node-wgsl-6 | 0.808 | 0.803 | 0.99 | 1.77 | 1.74 | 0.99 | 4 % / 3 % |
| shared-node-wgsl-10 | 1.33 | 1.30 | 0.98 | 2.62 | 2.53 | 0.97 | 3 % / 6 % |
| shared-functions-4 | 2.88 | 2.97 | 1.03 | 4.38 | 4.34 | 0.99 | 2 % / 1 % |
| shared-functions-7 | 4.81 | 4.94 | 1.03 | 6.84 | 6.74 | 0.99 | 2 % / 1 % |
| plot-wgsl | 0.360 | 0.369 | 1.02 | 0.899 | 0.912 | 1.01 | 1 % / 2 % |

Instance-lookup counts (`MODE=counts`, first call), base → head: `shared-complex-fold-10` 66,988 → 526;
`shared-complex-fold-6` 2,908 → 346; `folded-complex` 189 → 164; other cases rose by 2 % to 10 %
(`plot` 211 → 221, `shared-functions-7` 4,174 → 4,259).

What exceeds the run-to-run variance: the three fold cases (faster); `slider` and `radical-strict`
warm (slower by 11 % and 12 %; the process ranges do not overlap: 0.243–0.245 against 0.269–0.273
and 0.202–0.205 against 0.228–0.230); `radical-strict` first call (faster by 8 %). The warm times of
`shared-functions-4` and `-7` are 3 % slower with non-overlapping ranges; at 3 % I count them as
small, not as noise. First-call spreads are 1 % to 45 % (one outlier process in `plot`).

The large fold gain is in the lookup count, not in the generated code (the digests are identical).
The log has a commit "Reduce repeated definition lookups in closed constant-fold estimates"
(`27beaccca`) in the range; I did not bisect, so I cannot say how much of the gain belongs to it
and how much to the contraction rows. The slower `slider` and `radical-strict` cases come with
more instance lookups (+4.6 % and +5.1 %); I did not trace the cause.

**The saved run of 2026-11-03 is not comparable.** `benchmarks/compilation-cost-2026-11-03.json`
compares `ca6304756` (the 0.178.0 source) against the same source plus a cleanup patch, with 3
processes × `RUNS=5` × `ITERATIONS=5` and one case per process; its harness hash differs from the
current file. Its absolute times are 15 % to 30 % higher than the times here for the non-fold cases
(same CPU and Node); the cause was not isolated. Its fold case (warm 172.3 → 8.5 ms; lookups 66,947 →
12,668) and the base lookup counts here (66,945) agree to 2 lookups, so the shape agrees: the closed
folded-complex graph is the only case with a large change.

### 4(b) Run time of the emitted JavaScript

Harnesses: `benchmarks/codegen-samples.mjs` (7 cases) and `benchmarks/numeric-selection.mjs` (2 boards
of a selection kernel; the one harness that exercises the row 1 selection lowering). Each takes two
checkouts. Method: 5 separate invocations of base-against-head and 5 of base-against-base (the
control, for the noise floor), interleaved; per invocation 3 warm-up rounds and 9 alternating
rounds, median ns per call. Ratio = base / head, so a value above 1 means the head is faster; the
table gives the median of the per-invocation ratios and, in brackets, their range. Load average
3.2 at acquire and 3.1 at release (`codegen-samples`), 4.1 and 3.5 (`numeric-selection`).

```
node --import tsx /tmp/wt-compute-engine-29-base/benchmarks/codegen-samples.mjs <baseline> <candidate>
node --import tsx /tmp/wt-compute-engine-29-base/benchmarks/numeric-selection.mjs <baseline> <candidate>
```

| Case | Base ns | Head ns | Ratio base / head (range) | Control base / base (range) | Emitted length base / head |
|---|---:|---:|---|---|---|
| compound square | 28.84 | 28.79 | 1.000 (0.992–1.006) | 1.002 (0.990–1.006) | 18 / 18 |
| compound cube | 31.99 | 31.84 | 1.004 (0.996–1.011) | 0.996 (0.994–1.011) | 18 / 18 |
| compound fifth | 31.93 | 31.84 | 1.003 (0.997–1.021) | 1.002 (0.999–1.009) | 18 / 18 |
| exponential | 35.35 | 35.36 | 1.018 (0.964–1.044) | 0.999 (0.948–1.012) | 13 / 13 |
| repeated trig | 35.40 | 35.41 | 0.994 (0.987–1.006) | 1.003 (0.992–1.010) | 73 / 73 |
| range comprehension | 2,276.6 | 2,285.6 | 0.996 (0.984–1.002) | 1.004 (1.000–1.007) | 336 / 336 |
| counter function call | 52.47 | 52.92 | 1.003 (0.968–1.016) | 0.991 (0.924–1.053) | 149 / 149 |
| selection board, binary (ms) | 0.168 | 0.166 | 1.005 (0.982–1.041) | 0.992 (0.984–1.023) | kernel 2,088 / 2,088 |
| selection board, real-valued (ms) | 0.127 | 0.127 | 1.006 (0.991–1.014) | 0.999 (0.997–1.018) | kernel 2,088 / 2,088 |

No case moved beyond the noise floor (the control ratios span about 0.92 to 1.05 in the worst
cases). The compiled selection kernel is byte for byte the same at both commits (`diff` of the two
dumps reports no difference). For the seven `codegen-samples` cases only the character length is
equal; I did not read their emitted text, so identical text is inferred. The 7 + 2 cases cover
powers, `exp`, trig, a range comprehension, a function call over a counter and a rank-1 selection
kernel. They do not cover absence handling, point or list shapes, or the GPU helpers.

`compile-performance.test.ts` was not run: it compares a compiled runner with the interpreter
inside one process and cannot compare two checkouts.

The identical code of these cases is consistent with section 2.2: in the whole corpus
only 23 JavaScript records changed, and the changes are removed wrappers (a three-way condition
test, an `undefined` test), each a test on a value the compiler now settles. The run-time cost of
a removed wrapper was not measured.

### 4(c) The shader targets

Tycho's answer (session `tycho-desk`, 2026-11-04): Tycho can measure the draw time of one shader,
not the frame time of the application, and its user first asked me to run the measurement
because Tycho will not. The user of this session then authorized performance measurements, so I
ran Tycho's shader bench (`scripts/repros/2026-10-26-webgl-webgpu-shader-bench.mts` from
Tycho `a34405ae0`, read and run only; nothing was written in the Tycho tree). **This measures single
shaders in isolation on this machine's GPU (headless Chromium, ANGLE/Metal). It is not the frame
time of an application.** The Tycho row 480 reference measure (showcase kelvin-wake, one kept
`_gpu_cos`: 2.305 against 2.25 ms, +2.4 %) used the same bench.

Method: a production build of each worktree; one `--shadow-wgsl --all` audit per build through
`scripts/repros/ce-alt-hook.mjs` (both logs hold the `[ce-alt-hook] rerouting` line); the bench on the
chosen keys, a 2048×2048 RGBA32F target, 20 draws per run, best of 5 runs divided by 20, one
full-screen triangle; 7 rounds, each round: base, head, base again (the control). Load average
3.5 / 3.9 / 3.8 at acquire and 3.3 / 3.5 / 3.7 at release (18 cores). The head build was reused
from the value audit of 2.2.

| Case (document, input start) | Base ms per draw (median; min–max) | Head ms per draw | Head / base | Control base2 / base |
|---|---|---|---:|---:|
| trivial shader `x` (fixed cost) | 0.100 (0.055–0.180) | 0.175 (0.055–0.180) | not measurable | 0.85 |
| `showcase/underwater-caustics`, `\begin{cases}L(x, y)&y\lt\eta(…` | 5.910 (5.890–5.945) | 6.040 (6.015–6.060) | **1.022** | 1.001 |
| `showcase/underwater-caustics`, second `L(x, y)` expression | 9.565 (9.555–9.570) | 9.770 (9.760–9.785) | **1.021** | 0.999 |
| `showcase/cie-chromaticity`, `\begin{cases}S(x, y)&0\le S(x,…` | 0.045 (0.045–0.050) | 0.090 (0.090–0.095) | not measurable | 1.000 |
| `neyret/h2sajw9hdv`, `2o(\theta)` | 0.045 | 0.045 | not measurable | 1.000 |
| `showcase/gyroid`, `G(x, y, z)-c` | 0.050 | 0.055 | not measurable | 1.000 |
| `showcase/underwater-caustics`, `\eta(x)-y` | 0.065 | 0.100 | not measurable | 0.923 |

Reading: only the two large `underwater-caustics` shaders take enough time to measure (5.9 ms and
9.6 ms per draw). The head is 2.2 % and 2.1 % slower on them. The control differs by 0.1 %, and
every head round lies above every base round, so the difference is larger than the noise of the
machine, and small. The other five shaders draw in 0.045 to 0.18 ms, at the quantization level of the
timer and below the fixed cost of one draw; their ratios carry no information. I did not find why
they cost so little. In the five cases the helpers appear only in the preamble (0 uses in the
key's own code, 3 to 18 occurrences in code + preamble), so the extra cost comes from functions
defined in the preamble. The cold compile of each shader (first source the driver cache had not
seen) took 38 to 43 ms on both builds; later rounds hit the driver's disk cache and say nothing
about cold compile. The WGSL numbers in the raw reports were not analysed. The chosen cases are not
the ones with the most added helpers; they are keys that the bench accepts (present in both audit
files with a scalar result). **The one
comparable number from Tycho's row 480 (+2.4 % on a shader with one kept helper) is of the same
size as the +2.1 % to +2.2 % measured here on two keys of one document; no shader in this set shows a
larger effect, and 5 of 7 cannot be measured.** That is two shaders of 58 documents, not a frame
time, and no evidence about the other documents.

The documents that gained helpers. My own count from the two audit files is 180 GLSL keys in 58
documents (a key that compiled in both runs, with none of the five helpers in base code +
preamble and at least one in head). Row 9's record says 100 keys in 44 documents; I did not find
the difference. All 58 documents, by helper occurrences added (code + preamble); "call uses" counts
uses in the key's own code:

| Document | Keys gained | Helper occurrences added (code+preamble) | Call uses added (code only) | First key (row) |
|---|---|---|---|---|
| neyret/ybnaggvqb6 | 40 | 160 | 80 | `\operatorname{PointList}(X+0.1\cos(t)+A\cos(\phi(X)), 0.1\sin(t)+A\sin` |
| neyret/erwlgvbuno | 4 | 12 | 2 | `f_1(x)+0.5` |
| neyret/u5unitwu2f | 1 | 6 | 2 | `\operatorname{PointList}(X(t)+r(t)\cos(a(t)), Y(t)+r(t)\sin(a(t)))` |
| neyret/srpgd2cnth | 1 | 4 | 2 | `\operatorname{PointList}(-4+f(15(t\bmod1))\cos(A(t)), f(15(t\bmod1))\s` |
| neyret/nj4soxd8kx | 1 | 4 | 1 | `0\le y\le r(\lfloor100x\rfloor)` |
| neyret/lb6bi7fio3 | 12 | 48 | 0 | `\operatorname{PointList}(M(X(I), X(I+1), t), M(Y(I), Y(I+1), t))` |
| neyret/bcqhlp7xha | 20 | 40 | 0 | `\operatorname{PointList}((1-t)X(L)+tX(L_1), (1-t)Y(L)+tY(L_1))` |
| neyret/rccfsvo93r | 6 | 36 | 0 | `\operatorname{PointList}(X(t, T+V), Y(t, T+V))` |
| neyret/a1uny6zrtf | 7 | 28 | 0 | `f(x-d)` |
| showcase/cie-chromaticity | 1 | 18 | 0 | `\{S(x, y) \ge 0 : S(x, y)\}` |
| neyret/pqflulcixs | 3 | 18 | 0 | `\sum R(\frac{v-(-p_0)}{\bigl\lbrack2, 1\bigr\rbrack}, \phi)^2=1` |
| neyret/t3sr6vkzjh | 3 | 18 | 0 | `\operatorname{PointList}(i(t)+\frac{f(2\pi t,\theta_{v})}{2}\cos(2\pi ` |
| neyret/mh3zmxzi85 | 3 | 17 | 0 | `\operatorname{PointList}(-3+\operatorname{r_{\square}}(t)\cos(t), \ope` |
| neyret/bpnkluuy7y | 7 | 14 | 0 | `r=\cos(\theta)f(0.01,\theta)` |
| neyret/drvgednvrn | 3 | 12 | 0 | `r=A(\theta, 0)` |
| neyret/jsdx9qnaed | 3 | 12 | 0 | `A(t)+r\times(A(5t)+\frac{1}{2}A(9t)+\frac{1}{4}A(17t))+\operatorname{P` |
| neyret/ouizn62uo8 | 2 | 12 | 0 | `r=m_{cs}(\theta)T^2+(1-m_{cs}(\theta))T` |
| neyret/zjhaoqoufo | 3 | 12 | 0 | `r=A(\theta, 0)` |
| neyret/g91gh9zpcr | 3 | 11 | 0 | `\operatorname{PointList}(t, i(t,0))` |
| neyret/ouiqgatshs | 3 | 11 | 0 | `r=A_{geom}(\theta)` |
| neyret/vkitxetwiy | 1 | 11 | 0 | `\operatorname{PointList}(X(u, v), Y(u, v)-2, Z(u, v))` |
| showcase/underwater-caustics | 2 | 9 | 0 | `\left\{y < \eta(x): L(x, y), 0\right\}` |
| neyret/bi0xqfjz6i | 3 | 9 | 0 | `\operatorname{PointList}(R(t, 0), R(t, 1))` |
| neyret/gwqx9ckx7h | 3 | 9 | 0 | `\operatorname{PointList}(t, i(t,0))` |
| showcase/gyroid | 1 | 8 | 0 | `G(x, y, z) = c` |
| art/2ki2hjsouf | 1 | 8 | 0 | `R_3(f_{ixS}\operatorname{PointList}(u, v, -0.02),\mathrm{PointX}(f_{ix` |
| neyret/d2tqgiqgzv | 2 | 8 | 0 | `\operatorname{PointList}(t+D_{x}(t,0.1), \sin(t)+D_{y}(t,0.1)-2)` |
| neyret/7fz4ugr5wz | 3 | 7 | 0 | `\operatorname{PointList}(t, r_2(t,\frac{1}{2},r_{v}))` |
| neyret/gzka4avuuq | 1 | 6 | 0 | `\operatorname{PointList}(X(t, T_0), Y(t, T_0))` |
| neyret/h2sajw9hdv | 1 | 6 | 0 | `r\le2o(\theta)` |
| neyret/s4h8jurofe | 1 | 6 | 0 | `\operatorname{PointList}(-3+r_{cross2}(t)\cos(t), -3+r_{cross2}(t)\sin` |
| neyret/wib5jiiddl | 3 | 6 | 0 | `(f(x)-0.5)^2=0` |
| showcase/metaballs | 1 | 5 | 0 | `\sum_{k=1}^{10} \frac{2}{5((x - a(k))^2 + (y - b(k))^2 + (z - c(k))^2)` |
| neyret/4cgqofti5k | 2 | 4 | 0 | `p(x,0)` |
| neyret/heaouszmll | 2 | 4 | 0 | `(p(x)\bmod1-0.5)^2+y^2\le0.01` |
| neyret/navigpkypz | 2 | 4 | 0 | `r=f(\theta)` |
| neyret/poticded7e | 1 | 4 | 0 | `\operatorname{PointList}(X(t), \operatorname{D}(t))` |
| neyret/qfwyx4gkuz | 1 | 4 | 0 | `P(t)` |
| neyret/r0uowdkejy | 1 | 4 | 0 | `\operatorname{PointList}(t+C(t), S(t))` |
| neyret/rw6bgiznly | 2 | 4 | 0 | `\operatorname{PointList}(R(t, 0), R(t, 1))` |
| neyret/uh2uhoheqd | 2 | 4 | 0 | `\operatorname{PointList}((a\times(1+\sin(u))+R(u)\cos(v))\cos(u), (b+R` |
| neyret/uvdibm39mm | 1 | 4 | 0 | `\operatorname{PointList}(X(t)+d_{x}(X(t),Y(t),0), Y(t)+d_{y}(X(t),Y(t)` |
| neyret/yuog2hc9tu | 1 | 4 | 0 | `r=R(\theta)` |
| neyret/z73dvvxubz | 2 | 4 | 0 | `(f(x))^{30}` |
| neyret/ncdtxobf0s | 1 | 3 | 0 | `\frac{1}{100}(\sum_{n=1}^{100}f(n)\cos(2\pi(nx-\phi(n))))` |
| neyret/2h1kktkwpj | 1 | 2 | 0 | `1g_{e}(x)=g_{e}(y)` |
| neyret/2lzec8zwrz | 1 | 2 | 0 | `b(x,y)\ge1` |
| neyret/3mssd5t0lj | 1 | 2 | 0 | `\cos(2\pi f(x)x)` |
| neyret/annobkrivb | 1 | 2 | 0 | `f(x)=f_1(x)` |
| neyret/eufhj7vcya | 1 | 2 | 0 | `\frac{1}{\sum_{n=1}^{100}\frac{1}{n^{a_0}}}(\sum_{n=1}^{100}\frac{1}{n` |
| neyret/ibbzqpicd7 | 1 | 2 | 0 | `f_1(x,A)` |
| neyret/ipwqctmqzm | 1 | 2 | 0 | `\operatorname{PointList}(\lfloor t\rfloor+\frac{1}{20}\cos((t\bmod1)\t` |
| neyret/lfvstlsdsp | 1 | 2 | 0 | `-\log(\vert e_{rr}\vert)` |
| neyret/mpibaw7iet | 1 | 2 | 0 | `f(x)+8` |
| neyret/porsn1vgyz | 1 | 2 | 0 | `c_{i}=\vert\cos(a)\vert` |
| neyret/tnw0aj22fj | 1 | 2 | 0 | `\operatorname{PointList}(\cos(mt), \sin(mt))a` |
| neyret/ubicgbho6r | 1 | 2 | 0 | `\frac{1}{100}(\sum_{n=1}^{100}f(n)\cos(2\pi(nx-\phi(n))))` |
| neyret/xhlkk7k9aq | 1 | 2 | 0 | `1=c_1` |


### 4(d) Code quality as a reader sees it: six records

Record ids are the ids in the head audit file. In every case the base and head ids are the same
number. Code is cut at 25 lines and at 400 characters per line where marked.

#### Record 8330: neyret/g2vyb7i2oi, target javascript, mode strict

Row: `\frac{1}{4}f^{\prime}(x)`
Helper/wrapper count change (after minus before, over code + preamble): {}; length 509 -> 463

What changed: Selection lowering (row 1): the `(_CND) => _CND === true ? a : _CND === false ? b : NaN` wrapper that tested the condition for three values is gone; the condition is inlined as a two-way ternary. Three conditional arms of `_CND` per record removed.

Before (first 25 lines of code + "[preamble]" + preamble; lines cut at 400 chars):

```
0.25 * ((_CND) => _CND === true ? (0) : _CND === false ? ((1 <= _fn_f_0(_.x)) ? (0) : ((() => { const _cse1 = _fn_f_0(_.x); const _cse2 = ((_.x <= 0) ? (0) : ((1 <= _.x) ? (0) : (-6 * (_.x * _.x) + 6 * _.x))); return 6 * _cse1 * _cse2 + -6 * _cse2 * _SYS.pow2(_cse1); })())) : NaN)(((_.x <= 0) ? (true) : ((1 <= _.x) ? (false) : (-2 * _SYS.pow3(_.x) + 3 * (_.x * _.x) <= 0))))
[preamble]
const _fn_f_0 = (ceArg_0) => ((ceArg_0 <= 0) ? (0) : ((1 <= ceArg_0) ? (1) : (-2 * _SYS.pow3(ceArg_0) + 3 * (ceArg_0 * ceArg_0))));

```

After (same trimming):

```
0.25 * ((((_.x <= 0) ? (true) : ((1 <= _.x) ? (false) : (-2 * _SYS.pow3(_.x) + 3 * (_.x * _.x) <= 0)))) ? (0) : ((1 <= _fn_f_0(_.x)) ? (0) : ((() => { const _cse1 = _fn_f_0(_.x); const _cse2 = ((_.x <= 0) ? (0) : ((1 <= _.x) ? (0) : (-6 * (_.x * _.x) + 6 * _.x))); return 6 * _cse1 * _cse2 + -6 * _cse2 * _SYS.pow2(_cse1); })())))
[preamble]
const _fn_f_0 = (ceArg_0) => ((ceArg_0 <= 0) ? (0) : ((1 <= ceArg_0) ? (1) : (-2 * _SYS.pow3(ceArg_0) + 3 * (ceArg_0 * ceArg_0))));

```

#### Record 574: art/2ki2hjsouf, target javascript, mode strict

Row: `\left[(W_3(C[C_{i}][x],1,2,0.5)+y\operatorname{PointList}(0, 1, 0.5)+\operatorname{PointList}(-1, -1, -1)) \operatorname{for} y = 0..9, x = 0..19\right]+S_{tairPos}`
Helper/wrapper count change (after minus before, over code + preamble): {}; length 1757 -> 1580

What changed: Accessor absence (row 2): the `(_tv) => _tv === undefined ? NaN : _tv[0] ?? NaN` wrapper around each point component read is gone; the read is `(_cse[0] ?? NaN)`. Body 177 chars shorter. (Temporary names `_tv24` -> `_tv21` are renumbered only because wrappers were removed.)

Before (first 25 lines of code + "[preamble]" + preamble; lines cut at 400 chars):

```
((_tv24, _tv25) => _tv25.map((_tv26) => _SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _tv24, _tv26)))([_.d209pt3, _.d209pt4, _.d209pt5], (() => { const result = []; let _tv12 = false; let _tv3, _tv10, _tv11; for (let _tv23 = 0; _tv23 < 10; _tv23++) { const y = 0 + (1) * _tv23; for (let _tv22 = 0; _tv22 < 20; _tv22++) { const x = 0 + (1) * _tv22; if (!_tv12) { _tv12 = true; _tv3 = [0, 1, 0.5]; _tv10 =  [... line cut at 400 chars]
[preamble]
const tychoFloorIndexNumber = (function desmosIndexFloor(v){return Math.floor(v+2*Number.EPSILON*Math.max(1,Math.abs(v)))});
const tychoFloorIndex = (function floorIndex2(v){if(typeof v==="number")return Math.floor(v+2*Number.EPSILON*Math.max(1,Math.abs(v)));if(v!==null&&typeof v==="object"){if(typeof v.length==="number")return Array.prototype.map.call(v,w=>floorIndex2(w));const re=v.re;if(typeof re==="number")return Math.floor(re+2*Number.EPSILON*Math.max(1,Math.abs(re)))}return v});

```

After (same trimming):

```
((_tv21, _tv22) => _tv22.map((_tv23) => _SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _tv21, _tv23)))([_.d209pt3, _.d209pt4, _.d209pt5], (() => { const result = []; let _tv12 = false; let _tv3, _tv10, _tv11; for (let _tv20 = 0; _tv20 < 10; _tv20++) { const y = 0 + (1) * _tv20; for (let _tv19 = 0; _tv19 < 20; _tv19++) { const x = 0 + (1) * _tv19; if (!_tv12) { _tv12 = true; _tv3 = [0, 1, 0.5]; _tv10 =  [... line cut at 400 chars]
[preamble]
const tychoFloorIndexNumber = (function desmosIndexFloor(v){return Math.floor(v+2*Number.EPSILON*Math.max(1,Math.abs(v)))});
const tychoFloorIndex = (function floorIndex2(v){if(typeof v==="number")return Math.floor(v+2*Number.EPSILON*Math.max(1,Math.abs(v)));if(v!==null&&typeof v==="object"){if(typeof v.length==="number")return Array.prototype.map.call(v,w=>floorIndex2(w));const re=v.re;if(typeof re==="number")return Math.floor(re+2*Number.EPSILON*Math.max(1,Math.abs(re)))}return v});

```

#### Record 11386: neyret/ni3ih739at, target javascript, mode strict

Row: `V=M`
Helper/wrapper count change (after minus before, over code + preamble): {}; length 1247 -> 1289

What changed: Accessor absence (row 2), longer variant: `_tv === undefined ? NaN : ...` became `Number.isNaN(_tv ?? NaN) ? NaN : ...` for `_SYS.atNoWrap` reads; same shape, one more call, 42 chars longer.

Before (first 25 lines of code + "[preamble]" + preamble; lines cut at 400 chars):

```
_fn_M(_.x)
[preamble]
const tychoFloorIndexNumber = (function desmosIndexFloor(v){return Math.floor(v+2*Number.EPSILON*Math.max(1,Math.abs(v)))});
const tychoFloorIndex = (function floorIndex2(v){if(typeof v==="number")return Math.floor(v+2*Number.EPSILON*Math.max(1,Math.abs(v)));if(v!==null&&typeof v==="object"){if(typeof v.length==="number")return Array.prototype.map.call(v,w=>floorIndex2(w));const re=v.re;if(typeof re==="number")return Math.floor(re+2*Number.EPSILON*Math.max(1,Math.abs(re)))}return v});
const _fn_s = (ceArg_0) => (((0 <= ceArg_0) && (ceArg_0 <= 1)) ? (-2 * _SYS.pow3(ceArg_0) + 3 * (ceArg_0 * ceArg_0)) : NaN);
const _fn_M = (x) => { { const _cse15 = (((0 <= x) && (x <= 6)) ? (_SYS.mapFn(_fn_s, [1], [Math.min(1, Math.max(0, (_SYS.absAny((_SYS.floorMod((x + 0), 6) + -3)) + -1))), Math.min(1, Math.max(0, (_SYS.absAny((_SYS.floorMod((x + 4), 6) + -3)) + -1))), Math.min(1, Math.max(0, (_SYS.absAny((_SYS.floorMod((x + 2), 6) + -3)) + -1)))])) : undefined); return Math.max(((_tv1) => ((_tv1 === undefined) ? Nu [... line cut at 400 chars]

```

After (same trimming):

```
_fn_M(_.x)
[preamble]
const tychoFloorIndexNumber = (function desmosIndexFloor(v){return Math.floor(v+2*Number.EPSILON*Math.max(1,Math.abs(v)))});
const tychoFloorIndex = (function floorIndex2(v){if(typeof v==="number")return Math.floor(v+2*Number.EPSILON*Math.max(1,Math.abs(v)));if(v!==null&&typeof v==="object"){if(typeof v.length==="number")return Array.prototype.map.call(v,w=>floorIndex2(w));const re=v.re;if(typeof re==="number")return Math.floor(re+2*Number.EPSILON*Math.max(1,Math.abs(re)))}return v});
const _fn_s = (ceArg_0) => (((0 <= ceArg_0) && (ceArg_0 <= 1)) ? (-2 * _SYS.pow3(ceArg_0) + 3 * (ceArg_0 * ceArg_0)) : NaN);
const _fn_M = (x) => { { const _cse15 = (((0 <= x) && (x <= 6)) ? (_SYS.mapFn(_fn_s, [1], [Math.min(1, Math.max(0, (_SYS.absAny((_SYS.floorMod((x + 0), 6) + -3)) + -1))), Math.min(1, Math.max(0, (_SYS.absAny((_SYS.floorMod((x + 4), 6) + -3)) + -1))), Math.min(1, Math.max(0, (_SYS.absAny((_SYS.floorMod((x + 2), 6) + -3)) + -1)))])) : undefined); return Math.max(((_tv1) => (Number.isNaN((_tv1) ?? Nu [... line cut at 400 chars]

```

#### Record 136: showcase/plasma-effect, target glsl, mode strict

Row: `0.5 + 0.5 \cos(s(x, y) + 0.5)`
Helper/wrapper count change (after minus before, over code + preamble): {"_gpu_sin(":3,"_gpu_cos(":1}; length 814 -> 927

What changed: GLSL (row 9): the body is unchanged; inside the helper functions `_fn_s`, `_fn_k`, `_fn_d` the plain `sin(...)`/`cos(...)` calls became `_gpu_sin(...)`/`_gpu_cos(...)` (3 sin, 1 cos more), and the preamble gained the helper `_gpu_sin` (which calls `_gpu_isnonfinite`). Gained: a NaN-safe wrapper and one helper definition (+113 chars); the added lines are past line 25, so they are listed under the after block.

Before (first 25 lines of code + "[preamble]" + preamble; lines cut at 400 chars):

```
0.5 * _gpu_cos(_fn_s(x, y) + 0.5) + 0.5
[preamble]

float _gpu_pow2(float x) { return x * x; }

bool _gpu_isnonfinite(float x) {
  return (floatBitsToUint(x) & 0x7FFFFFFFu) >= 0x7F800000u;
}
float _gpu_cos(float x) {
  return (_gpu_isnonfinite(x) ? intBitsToFloat(0x7FC00000) : cos(x));
}

float _fn_w(float ceArg_0, float ceArg_1) {
  return -0.7 * T + sin(0.3 * T + ceArg_0 + cos(T + 0.628)) + 0.9;
}

float _fn_d(float ceArg_0, float ceArg_1) {
  return sqrt(_gpu_pow2(0.3 * T + ceArg_0) + _gpu_pow2(0.3 * T + ceArg_1));
}

float _fn_k(float ceArg_0, float ceArg_1) {
  return 2.4 * T + cos(0.3 * T + ceArg_1 + sin(-T + 0.148)) + 0.1;
}

float _fn_s(float ceArg_0, float ceArg_1) {
[... trimmed: 4 more lines]
```

After (same trimming):

```
0.5 * _gpu_cos(_fn_s(x, y) + 0.5) + 0.5
[preamble]

float _gpu_pow2(float x) { return x * x; }

bool _gpu_isnonfinite(float x) {
  return (floatBitsToUint(x) & 0x7FFFFFFFu) >= 0x7F800000u;
}
float _gpu_sin(float x) {
  return (_gpu_isnonfinite(x) ? intBitsToFloat(0x7FC00000) : sin(x));
}
float _gpu_cos(float x) {
  return (_gpu_isnonfinite(x) ? intBitsToFloat(0x7FC00000) : cos(x));
}

float _fn_w(float ceArg_0, float ceArg_1) {
  return -0.7 * T + _gpu_sin(0.3 * T + ceArg_0 + cos(T + 0.628)) + 0.9;
}

float _fn_d(float ceArg_0, float ceArg_1) {
  return sqrt(_gpu_pow2(0.3 * T + ceArg_0) + _gpu_pow2(0.3 * T + ceArg_1));
}

float _fn_k(float ceArg_0, float ceArg_1) {
  return 2.4 * T + _gpu_cos(0.3 * T + ceArg_1 + sin(-T + 0.148)) + 0.1;
[... trimmed: 7 more lines]
```

Preamble/function lines present after but not before:

```
float _gpu_sin(float x) {
  return (_gpu_isnonfinite(x) ? intBitsToFloat(0x7FC00000) : sin(x));
  return -0.7 * T + _gpu_sin(0.3 * T + ceArg_0 + cos(T + 0.628)) + 0.9;
  return 2.4 * T + _gpu_cos(0.3 * T + ceArg_1 + sin(-T + 0.148)) + 0.1;
  return 7.0 * _gpu_sin(_cse1 + _fn_k(ceArg_0, ceArg_1)) * _gpu_cos(_cse1 + _fn_d(ceArg_0, ceArg_1));
```

#### Record 14850: neyret/uclat3oshf, target glsl, mode strict

Row: `S_3(x,y)\ge\max(S_1(x,y), S_2(x,y))\keyword{where}S_3(x,y)\gt Z`
Helper/wrapper count change (after minus before, over code + preamble): {"_gpu_max(":1}; length 727 -> 732

What changed: GLSL (row 9): `max(abs(...), abs(...))` in `_fn_S_3` became `_gpu_max(...)`: the NaN-safe helper (`_gpu_isnan` plus `_gpu_max`, already in the preamble for the body) now also wraps a call whose finiteness the compiler no longer proves.

Before (first 25 lines of code + "[preamble]" + preamble; lines cut at 400 chars):

```
-_fn_S_3(x, y) + _gpu_max(_fn_S_1(x, y), _fn_S_2(x, y))
[preamble]

float _gpu_pow2(float x) { return x * x; }

bool _gpu_isnan(float x) {
  return (floatBitsToUint(x) & 0x7FFFFFFFu) > 0x7F800000u;
}
float _gpu_max(float a, float b) {
  return (_gpu_isnan(a) ? a : (_gpu_isnan(b) ? b : max(a, b)));
}

float _fn_S_3(float ceArg_0, float ceArg_1) {
  return ((max(abs(ceArg_0 + -0.5), abs(0.5 * ceArg_1)) < 0.8) ? (-4.0 * ceArg_1 + -1.0) : ((Z)));
}

float _fn_S_1(float ceArg_0, float ceArg_1) {
  return (((ceArg_0 * ceArg_0) + (ceArg_1 * ceArg_1) < 1.0) ? (ceArg_0 + ceArg_1) : ((Z)));
}

float _fn_S_2(float ceArg_0, float ceArg_1) {
  return ((_gpu_pow2(ceArg_0 + -1.0) + (ceArg_1 * ceArg_1) < 1.0) ? (ceArg_0 + -ceArg_1) : ((Z)));
}

```

After (same trimming):

```
-_fn_S_3(x, y) + _gpu_max(_fn_S_1(x, y), _fn_S_2(x, y))
[preamble]

float _gpu_pow2(float x) { return x * x; }

bool _gpu_isnan(float x) {
  return (floatBitsToUint(x) & 0x7FFFFFFFu) > 0x7F800000u;
}
float _gpu_max(float a, float b) {
  return (_gpu_isnan(a) ? a : (_gpu_isnan(b) ? b : max(a, b)));
}

float _fn_S_3(float ceArg_0, float ceArg_1) {
  return ((_gpu_max(abs(ceArg_0 + -0.5), abs(0.5 * ceArg_1)) < 0.8) ? (-4.0 * ceArg_1 + -1.0) : ((Z)));
}

float _fn_S_1(float ceArg_0, float ceArg_1) {
  return (((ceArg_0 * ceArg_0) + (ceArg_1 * ceArg_1) < 1.0) ? (ceArg_0 + ceArg_1) : ((Z)));
}

float _fn_S_2(float ceArg_0, float ceArg_1) {
  return ((_gpu_pow2(ceArg_0 + -1.0) + (ceArg_1 * ceArg_1) < 1.0) ? (ceArg_0 + -ceArg_1) : ((Z)));
}

```

#### Record 144: showcase/cie-chromaticity, target glsl, mode strict

Row: `\{S(x, y) \ge 0 : S(x, y)\}`
Helper/wrapper count change (after minus before, over code + preamble): {"_gpu_min(":18}; length 1123 -> 1398

What changed: GLSL (row 9): a chain of 17 `min(...)` calls in `_fn_S` became `_gpu_min(...)`, and the preamble gained `_gpu_isnan` and `_gpu_min` (one helper definition, 18 uses). Largest growth in the sample: +275 chars.

Before (first 25 lines of code + "[preamble]" + preamble; lines cut at 400 chars):

```
float _cse1 = _fn_S(x, y);
return ((0.0 <= _cse1) ? (_cse1) : (_gpu_nan()));
[preamble]

float _gpu_nan() {
  return intBitsToFloat(0x7FC00000);
}

float _fn_S(float ceArg_0, float ceArg_1) {
  return min(min(min(min(min(min(min(min(min(min(min(min(min(min(min(min(min(-0.7053 * ceArg_0 + -0.7089 * ceArg_1 + 0.7063, -0.6858 * ceArg_0 + -0.7278 * ceArg_1 + 0.7094), -0.618 * ceArg_0 + -0.7862 * ceArg_1 + 0.7337), -0.5362 * ceArg_0 + -0.8441 * ceArg_1 + 0.7632), -0.4483 * ceArg_0 + -0.8939 * ceArg_1 + 0.7897), -0.1872 * ceArg_0 + -0.9823 * ceArg_1 + 0.833), 0.5236 * ceArg_0 + -0.852 * ceAr [... line cut at 400 chars]
}

```

After (same trimming):

```
float _cse1 = _fn_S(x, y);
return ((0.0 <= _cse1) ? (_cse1) : (_gpu_nan()));
[preamble]

float _gpu_nan() {
  return intBitsToFloat(0x7FC00000);
}

bool _gpu_isnan(float x) {
  return (floatBitsToUint(x) & 0x7FFFFFFFu) > 0x7F800000u;
}
float _gpu_min(float a, float b) {
  return (_gpu_isnan(a) ? a : (_gpu_isnan(b) ? b : min(a, b)));
}

float _fn_S(float ceArg_0, float ceArg_1) {
  return _gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(_gpu_min(-0.7053 * ceArg_0 + -0.7089 * ceArg_1 + 0.7063, -0.6858 * ceArg_0 + -0.7278 * ceArg_1 + 0.7094), -0.618 * ceArg_0 + -0.7862 * ceArg_1 + 0.7337), -0.5362 * ceArg_0 + -0.8441 * ceArg_1 + 0.7632), -0.4483 * ceArg_0 + -0.8939 * ceArg_1 + 0.78 [... line cut at 400 chars]
}

```

#### Ten more changed records (id, document, one-line summary; ids are ids in the head audit file; 286 records changed in all)

- 566, art/2ki2hjsouf, javascript: two `=== undefined` accessor wrappers become `Number.isNaN(_tv ?? NaN)`; +28 chars.
- 580, art/2ki2hjsouf, javascript: three `_tv === undefined ? NaN : _tv[k] ?? NaN` wrappers become `_cse[k] ?? NaN`; -177 chars.
- 1197, art/mavxszbvzk, javascript (setup row, 12 records 1197-1208): `((_tv) => _tv === undefined ? NaN : _tv[1] ?? NaN)(atPoint(...))` becomes `(atPoint(...)[1] ?? NaN)`; -117 chars each.
- 8332, neyret/g2vyb7i2oi, javascript: `_CND` three-way wrapper of the second derivative removed; -46 chars.
- 10397, neyret/lizeqlnn5e, javascript: four of six `=== undefined` wrappers read `_cse[k] ?? NaN` directly, two `.length` reads use `Number.isNaN`; -209 chars.
- 11388, neyret/ni3ih739at, javascript: six `=== undefined` tests become `Number.isNaN(_tv ?? NaN)` tests; +84 chars.
- 15663, neyret/xhlkk7k9aq, javascript: `_CND` wrapper removed from a `\begin{cases}` product; -46 chars.
- 242, showcase/kelvin-wake, glsl: `_gpu_sin` x2, `_gpu_cos` x3, `_gpu_min` x2 added; +501 chars (preamble helpers).
- 254, showcase/underwater-caustics, glsl: `_gpu_sin` x3, `_gpu_cos` x3 added; +312 chars.
- 287, showcase/spirograph, glsl: `(a(t), b(t))`, one `_gpu_sin` and one `_gpu_cos` added; +10 chars (smallest growth).
- Also: 2479 (neyret/2h1kktkwpj, `_gpu_sin` x2, +199), 2568 (neyret/2lzec8zwrz, `_gpu_max` x2, +196), 5350 (neyret/7fz4ugr5wz, `_gpu_max` x3, +200), 5958 (neyret/a9ugxra4mi, `_gpu_sin` x2 `_gpu_cos` x2, +20).

One sentence per record, on what the emitted code lost or gained:

- **JavaScript 8330** (`neyret/g2vyb7i2oi`): lost the three-way `_CND` wrapper and its `NaN` arm;
  the condition is a plain ternary, 46 characters shorter.
- **JavaScript 574** (`art/2ki2hjsouf`): lost the `_tv === undefined` accessor wrapper around each
  point component read; the read is `(_cse[0] ?? NaN)`, 177 characters shorter (the other change is
  renumbered temporary names).
- **JavaScript 11386** (`neyret/ni3ih739at`): gained 42 characters; an `=== undefined` test became
  `Number.isNaN(_tv ?? NaN)` with the same shape, so it lost no run-time test.
- **GLSL 136** (`showcase/plasma-effect`): gained a NaN-safe `_gpu_sin` helper definition (113
  characters) and four uses of `_gpu_sin` and `_gpu_cos` in helper functions.
- **GLSL 14850** (`neyret/uclat3oshf`): gained one use of `_gpu_max` for a `max(abs, abs)` call;
  the helper was already in the preamble.
- **GLSL 144** (`showcase/cie-chromaticity`): gained a `_gpu_min` helper and 17 uses of it in a
  chain of `min` calls over constant-coefficient half-planes, 275 characters longer (the largest
  growth among the six).

No `_SYS.` call or `Array.isArray` test was removed in any record of this pair of commits, so no
record of that kind can be printed; the records above are the changes that exist.

## 5. What the numbers do not show

- **The base of step 3.** The value audits compare `1359a1279` (after step 3) with `fdf351b51`. They
  show the effect of rows 1 to 9 and CE-800 to CE-804 only. The effect of step 3 on the corpus comes
  from Tycho's audit (2.1), which mixes the engine with a change in Tycho's options, and from the
  plan's per-item records (1.4). No value audit of `9cca00073` against `1359a1279` was run here.
- **Per-row effect.** The audit of 2.2 does not separate rows 2 to 9. The attribution of the 23 changed
  JavaScript records to rows 1 and 2 is read from the code shape.
- **Run time of the corpus code.** Only 9 compiled cases were timed (section 4(b)). Whether a removed
  wrapper or an added NaN-safe helper changes the run time of a corpus expression was not measured
  except as section 4(c) reports.
- **Compile time of corpus expressions.** The compile-time harness uses 17 synthetic cases. The time
  to compile Tycho's 17,825 expressions was not measured. The audit records hold `durationMs`; I did
  not compare them (the two runs differ in load).
- **Which commit caused the fold speed-up** (section 4(a)) and the 11 % to 12 % warm slowdown of
  `slider` and `radical-strict`: not bisected.
- **Counts that depend on the counting rule.** The plan's compiler counts for item 3.1 (96,270) do
  not agree with the base count here (92,667); the 3,602-line step between items 3.1 and 3.2 and
  199 of the 3,196 lines of step 4 are not attributed by the plan. The 1,600 → 1,632 test-file count
  of 2026-11-04 differs from my 1,804 → 1,837 by about 200 files; the cause is a different file
  set.
- **API removals.** The count in 1.6 did not read the `[Unreleased]` "Behavior Changes" subsection or
  the 0.178.0 "Resolved Issues"; it can be low.
- **The forms table** (section 3) lacks forms that only unread parts of the documents name.
- **Test results.** No test suite was run for this report. The suite totals are the plan records'.
- **The CE commit of the audited builds in 2.1.** The packages carry no git hash.
- **The one changed value in 2.1** is quoted from Tycho's adoption note, not measured.
- **Frame time of an application.** Not measured (section 4(c) gives the scope of the shader
  measurement).

## 6. What a later contraction could still take

Copied from the closing record of step 4 (plan lines 2892–2911), then extended by what the emitted
code shows. Nothing below is a recommendation to change code.

**From the step 4 record** ("What a later contraction could take, not done here"):

- the run-time fold test of CE-805 (if the user takes option (a));
- `predicateResult`'s non-boolean throw and the condition-cell throw of `_SYS.select` (kept by row 7);
- the exports of `compile-absence.ts` and `absent-tuple-read.ts` (each has a reader, row 7);
- the facade of `base-compiler.ts` (step 4 of `docs/plans/2026-10-30-split-base-compiler.md`);
- the lazy-view records of `lazy-view-context.ts` (473 lines; an interpreter change that row 5
  proposed; about 290 interleaved lines in `function-utils.ts` and `boxed-function.ts`).

**Kept by the records of the rows, with the reason they give** (plan lines in brackets): the
guarded fold of `Max`/`Min`/`Sum`/`Product` (a static lowering for six callers is new code; 2065–2080);
the fallback of `emitDeclaredUnionParameterDispatch()` (2065–2080); local shape frames
(`withLocalShapeFrame`, `_pushLocalComplex`: "a redesign, not a removal"; 2149–2191); the
JavaScript IIFE code of a last `Declare` and the shader `valueBlock` hoist (2207–2217);
`partial-application.ts` (109 code lines on that base; 2323–2364); the recursive-call retry
`emitWithRecursiveLaneRetry`, promotion suppression in `compiler-mode.ts`, lane records per
definition and the `'auto'` entry of `COMPILE_MODES` (2437–2451); the `javascript-value-facts.ts`
recorders (2559–2568); the written-names walk `gpuRecordWrittenNames` and `isAmplifiedTrig`
(2727–2732); the Python `Reduce`/`Scan` decline over `list<any>` (2875–2890); `compile-match.ts`
(`Match`; 1705).

**Seen in the emitted code (corpus, head `fdf351b51`):**

- The JavaScript corpus code still holds 21,118 `_SYS.` calls and 83 `Array.isArray` tests, and
  interval-js holds 12 `Array.isArray` tests; GLSL holds none. These did not change in step 4 rows
  1 to 9 (2.2). CE-805 and CE-806 (four other run-time `Array.isArray` tests in 16 corpus documents,
  decision needed, from the MEMORY note and not from a file I read) concern part of them.
- Record 11386 (printed in 4(d)) still has a run-time wrapper around each read of a possibly
  absent value: after the change it is `Number.isNaN((_tv1) ?? NaN)` where it was `_tv1 ===
  undefined`. The 4 records of that class show that this kind of wrapper is replaced in some
  places and removed in others (class table in 2.2).
- Record 144 has 17 `_gpu_min` uses in one function body (plain `min` before row 9). The helper
  count of 713 records (2.2) is the result of the row 9 decision that the host provides the finite
  proof; section 4(c) reports one measured case of its cost.
- 152 declines remain in the corpus (javascript 47, glsl 44, interval-js 61 records, in 53
  documents, from 2.1 and 2.2). Their messages are listed in 2.1; I did not classify each as
  `corpus`, `plausible` or `crafted`.
