# Measure for a further compiler pass: per-target lowering and emitted code

**Status:** measurement report, 2026-11-04 (file name dated 2026-11-05). No source file, test or
ROADMAP entry was changed. Head: `1872ac457` (the source of `src/compute-engine/compilation` is the
same as at `66c7363eb`, which includes CE-805; the earlier impact report measured `fdf351b51`, which
does not). Background: `docs/plans/2026-11-05-contraction-impact-report.md`,
`docs/plans/2026-11-01-compiler-simplification.md`,
`docs/plans/2026-11-02-compiler-contraction-plan.md`.

Every number comes from a tool result or a file named here. An estimate is marked as one. Work
files are in the session scratchpad
`/private/tmp/claude-501/-Users-arno-dev-compute-engine/3aa4285a-504f-4a96-9683-8f91fb34af9c/scratchpad/`
(called `$S` below); they are outside the repo.

## Findings

**Question 1: how much of the lowering is written once per target.** The operator tables of the four
target families hold 287 operators with at least one lowering. Under a strict test, almost none is
the same template on every target: 3 operators (class a: `Lb`, `Log2`, `Subtract`, 3 table lines per
target). 116 operators are class b (all targets that have the operator use a hand-written emitter
function, and the emitter bodies were not compared); 94 are class c (the kinds differ between
targets); 74 are lowered by one target family only. The lowering code in the tables is small
compared with the per-target files: the table entries hold 7,116 code lines (javascript 3,343,
python 1,297, interval-js 617, gpu 1,766 + 93 in the GLSL-only and WGSL-only overrides) and the
functions they delegate to hold at most 3,009 more (one level only), out of 45,001 code lines in the
four target families. The tables are about 22 % of the target code and about 11 % of the 89,725 code
lines of the compiler. An upper bound for "replaced by one shared lowering with per-target
emission" is the class b lines (4,761 entry lines + 2,058 delegate lines); I did not measure how
many of them are really shared, because the emitters were classified by kind, not by structure.
`CompileTarget` has 94 members, not 217: 37 are set by one target family only, 29 by two or three,
16 by all four, 12 by the shared compiler.

**Question 2: what the emitted code spends its size and time on.** On the corpus (Tycho
`a34405ae0`, 17,348 records, 13,707 keys), the emitted code of the 8,830 JavaScript records is
4.51 million characters, of which 54 % is preamble, but the preambles are copies: 2,023 records have
one, and only 1,075 are distinct (836,459 characters). The same holds for GLSL (817 k of 1.30 M
characters is preamble; 305 distinct preambles of 255 k characters). Repeated identical
sub-expressions that common-subexpression elimination (CSE) did not share total 214,246 characters in
JavaScript (4.7 %), 342,852 in interval-js (7.9 %) and about 35,053 in GLSL (2.7 %, an
approximation). The run time of the emitted JavaScript is small: median 74 ns per call for 30
random eligible records and 1,968 ns for the 30 with the largest code (control: an empty call costs
21.4 ns). The time of the slowest records goes to runtime helpers (`bcast`, `cospi`, `floorMod`,
`nd`) or to long straight-line sums that the document asks for. The NaN-safe GLSL helpers cost about
2.6 % on the one shader long enough to time.

## 1. How much of the lowering is written once per target

### 1.1 Commands and counting rules

Head worktree: `/tmp/wt-compute-engine-5c-head` (detached at `1872ac457`). Scripts:
`$S/q1/scripts/extract.cjs`, `members.cjs`, `build.cjs`, `members-md.cjs`, `lits.cjs`, `run-all.sh`
(they use `typescript`/`@babel/parser` from `node_modules`). Outputs: `$S/q1/table.tsv` (one row per
operator, a cell per target `kind:file:line:lines`), `compiletarget-members.tsv`, `class-lines.md`,
`class-c.txt`, `class-s.txt`, `absent-<target>.txt`.

Code lines: `grep -v -E '^\s*(//|/\*|\*|$)'` on the exact line range of the entry or function body.

Code lines per target family (same rule, whole files, head):

| Family | Files | Code lines |
|---|---|---:|
| javascript | `javascript-*.ts` | 16,465 |
| gpu (GLSL, WGSL) | `gpu-*.ts`, `glsl-target.ts`, `wgsl-*.ts` | 19,523 |
| python | `python-*.ts` | 4,680 |
| interval-js | `interval-*.ts` | 4,333 |
| all of `compilation` | `*.ts` | 89,725 |

**Table entries (true counts).** Each target has an operator table (`['+', 11]`) and a function
table (string, arrow function or wrapper call). Count rule: every property of the object literal
assigned to each table constant, minus the `__proto__: null` property, plus top-level
`TABLE.Key = …` statements (`ApplyWhole`). A parse of the TypeScript, not a regular expression.

| Target | Operator table | Function table | Total | First count (regex, 2026-11-04) |
|---|---:|---:|---:|---:|
| javascript | 12 | 272 | 284 | 429 |
| python | 13 | 160 | 173 | 258 |
| interval-js | 14 (not read: `operators: () => undefined`) | 97 | 111 | 182 |
| gpu shared (GLSL and WGSL) | 14 | 141 | 155 | 153 |
| GLSL-only overrides | – | 6 | 6 | – |
| WGSL-only overrides | – | 7 | 7 | – |
| `gpu-shader-target.ts` | none | none | 0 | 34 |

The first count was too high: its regular expression also matched lines outside the tables
(28, 22 and 19 matches for javascript, python, interval-js with the regex `^  [A-Z]\w*: `, and the
rest is other lines), and `gpu-shader-target.ts` has no lowering table. The comment above the shared
GPU table says 128 entries; it holds 155 (including operators).

Entry kinds in the function tables: javascript 222 emitters, 38 helpers, 10 templates, 2 declined;
python 139 emitters, 20 templates, 1 declined; interval-js 43 emitters, 52 templates, 2 declined;
shared GPU 124 emitters, 13 templates, 4 declined.

Kind rules: `template` = a string, or an arrow function that only builds a string (an `_IA.x(…)`
call counts as template); `helper` = the whole emitted text is one call to `_SYS.`, `_gpu_` or
`_py…`; `emitter` = any arrow function with control flow, more than one statement, or a call to a
named function (a delegate); `declined` = the body is a single `throw`.

### 1.2 Classes of the 287 operators

Class (a) test: every present cell is a `template` and the skeletons (the emitted text with
placeholders; whitespace removed, `${compile(args[k])}` → `$k`, a mapped list → `$*`, `N.0` → `N`,
every callee token before `(` → `F`, redundant outer parentheses removed) are equal.

| Class | Operators | Meaning |
|---|---:|---|
| (a) same template | 3 | `Lb`, `Log2`, `Subtract` |
| (b) same kind, target-specific part | 116 | all present cells are emitters (the structure was not compared; 22 rows have delegate cells) |
| (c) different kinds | 94 | 93 `c-hard`, 1 `c-soft` (`Factorial2`) |
| (s) one target family only | 74 | javascript 65, python 2 (`Comprehension`, `Sequence`), gpu 7 (`Inversesqrt`, `Mix`, `Normalize`, `Radians`, `Reflect`, `Refract`, `Step`), interval-js 0 |

Class (b) by the largest emitter in the row: 14 rows ≤ 3 lines, 40 rows 4–10, 46 rows 11–40, 16
rows > 40 lines.

Code lines per class and target (entry lines; emitters on the arrow-function range):

| Class | javascript | python | interval-js | gpu shared | GLSL-only | WGSL-only |
|---|---:|---:|---:|---:|---:|---:|
| a | 3 | 3 | 1 | 3 | 0 | 0 |
| b | 2,100 | 911 | 499 | 1,230 | 7 | 7 |
| c | 650 | 378 | 117 | 527 | 32 | 45 |
| s | 590 | 5 | 0 | 6 | 1 | 1 |
| all | 3,343 | 1,297 | 617 | 1,766 | 40 | 53 |

Lines of the functions that an emitter only delegates to (one level; not in the table above): 2,058
for class b, 824 for class c, 127 for class s.

**Class (c) operators.** All 94 are in `$S/q1/class-c.txt`. The patterns by kind per target: 33 rows
where interval-js is a template and every other target is an emitter (`Abs`, `Arccos`, `Exp`, `Ln`,
`Sec`, `Csc`, `Sin`, `Sqrt`, `Fract`, …); 9 rows where gpu is a template and the others are
emitters (`And`, `Equal`, `Less`, `Greater`, `GreaterEqual`, `Degrees`, …); 12 rows where
javascript has a `_SYS` helper, gpu an emitter and python and interval-js are absent or a template
(`Digamma`, `Beta`, `Binomial`, `Sinc`, `Heaviside`, `FresnelS`, …); 6 rows where python is a
template (`np.linalg`) and javascript an emitter (`Determinant`, `Inverse`, `MatrixMultiply`, …);
about 34 other mixes (`ElementMax`, `Clamp`, `Tuple`, `Arctan2`, `Erf`, …). Declined in at least one
target: `Match`, `RandomChoice`, `RandomSample`, `RandomShuffle`, `Function`.

A spot check of the table, to show how the strict rule acts: `Sin` is a 7-line emitter in
javascript (`javascript-target.ts:8633`), a 7-line emitter in python (`python-target.ts:5333`), a
12-line emitter for gpu (`gpu-functions.ts:2445`) and a one-line template in interval-js
(`interval-javascript-target.ts:3623`), so it is class c, although the mathematical function is the
same. `Floor` and `Max` are class b: each target delegates to its own function
(`pythonRoundToStep`, `intervalRoundToStep`, `compileExtremum`, `compilePythonExtremum`,
`compileIntervalExtremum`).

### 1.3 `CompileTarget` (`types.ts:549`, the interface runs to line 2330)

94 members (`$S/q1/compiletarget-members.tsv`: line, type, who sets it, read sites). The count 217
of the task text does not match the head; the contraction rows removed members, and 94 is the count
by this script (5 required, 89 optional). A target "sets" a member when the member appears in a
target literal with at least 6 members, in an object passed to `createTarget`, or in an assignment
`target.x = …`. GLSL and WGSL are one family (`GPUShaderTarget.createTarget`).

| Set by | Members |
|---|---:|
| the shared compiler (no target family) | 12 |
| exactly one family | 37 |
| two or three families | 29 |
| all four | 16 |

Members that exist only for one family:
- javascript (9): `character`, `complexLowering`, `assertBoolean`, `iterationBudget`, `quadrature`,
  `batchReads`, `rootExpression`, `symbolDeps`, `hostNames`;
- python (3): `chainOp`, `shareSymbolSquares`, `valueTailSelections`;
- interval-js (7): `inexactNumber`, `cseMinSize`, `cseMinScore`, `cseInlineConstant`,
  `unrollMinWidth`, `unrollConstantLists`, `compileCollectionValue`;
- glsl/wgsl (18): `loweredSymbolType`, `assignmentValue`, `cseMaterialize`, `cseCanMaterialize`,
  `checkOperandShapes`, `onReturn`, `recompileStatement`, `valueBlock`, `lazyOperand`,
  `checkDefinitionBody`, `storage`, `storageRead`, `hostInputVars`, `storageBufferBindings`,
  `storageBuffersRead`, `maxInlineElements`, `unrollComprehensions`, `beginCompilation`.

(9 + 3 + 7 + 18 = 37, counted again from `compiletarget-members.tsv`. The members set by two or
three families, 29 of them, are listed with their targets in `$S/q1/class-lines.md`, section 5.) Read sites are counted by the receiver text containing
`target` (case-insensitive); a read through another receiver name is missed.

What a shared lowering must express, from the members that class (a) and (b) lowerings read:
`operators` and `functions` (the two tables, read at 19 and 24 sites in the shared compiler); the
lane and shape information (`complexLowering`, `loweredSymbolType`, `checkOperandShapes`,
`lazyOperand`); the absence and error-model hooks (`assertBoolean`, `onReturn`); the CSE and
hoisting settings (`cse*`, `hoist`); the effect and statement hooks (`assignmentValue`,
`recompileStatement`, `valueBlock`). The full list of read sites per member is in the TSV. I did not
check which class (a) and (b) emitters read which member.

### 1.4 Declines because a target lacks a lowering

| Target | Operators absent there but present in another family | Explicit declined cells |
|---|---:|---:|
| javascript | 14 | 2 (`Iterate`, `RegExp`) |
| python | 126 | 1 (`Match`) |
| interval-js | 190 | 2 (`Match`, `RandomChoice`) |
| glsl | 130 | 4 (`RandomChoice`, `RandomSample`, `RandomShuffle`, `Function`) |
| wgsl | 130 | 4 (same) |

The corpus declines at the head are in section 2.1 (javascript 47, interval-js 61, glsl 44 records).

## 2. What the emitted code of the corpus spends its size and time on

### 2.1 Audit run

No saved run existed for the head. The saved runs of the earlier session were at `fdf351b51` (before
CE-805) and dated 2026-11-03. I ran the audit again under the box lock, owner
`compute-engine-5c:audit` (the lock was acquired after a wait of about 190 s; load 3.9 on 18 cores):

```
export AUDIT_OUT=$S/q2/audit
export TYCHO_SNAP=/private/tmp/claude-501/-Users-arno-dev-compute-engine/5fb3bf86-4e6c-4ffc-b1d9-62a295bce360/scratchpad/tycho-a34405ae0
timeout -k 30 900 ~/.claude/tools/ce-census/value-audit.sh /tmp/wt-compute-engine-5c-head head
```

The log ends with `AUDIT_EXIT=0` and `[value-shim] 13707 keys, 17825 compiles, 8966 sampled`. CE
0.178.0, Tycho `a34405ae0`; 17,348 records: javascript 8,830 successful / 47 declined, interval-js
4,760 / 61, glsl 3,606 / 44 (no wgsl or python records in this audit). Files: `$S/q2/audit/head.json`,
`head-values.json`, `head-digest.json`, `head.log`.

### 2.2 Size (`$S/q2/size-census.mjs`, results in `$S/q2/size-census.md` and `records.tsv`)

Command: `node $S/q2/size-census.mjs $S/q2/audit/head.json <out dir>`. Successful records only;
"characters" = `code` + `preamble`. Parsing for repeat detection: `@babel/parser` (acorn is not
installed), each unit tried as `(src\n)`, then `(function(){\nsrc\n})`, then a script; 20,004 units,
0 parse failures.

| Target | Records | Total characters | Median | p90 | Max | Code | Preamble |
|---|---:|---:|---:|---:|---:|---:|---:|
| javascript | 8,830 | 4,514,171 | 121 | 792 | 189,647 | 2,069,330 | 2,444,841 |
| interval-js | 4,760 | 4,335,625 | 162 | 980 | 189,788 | 1,522,436 | 2,813,189 |
| glsl | 3,606 | 1,304,965 | 90 | 888 | 33,125 | 488,169 | 816,796 |

Preamble copies (`$S/q2/preamble-dup.mjs`): javascript 2,023 records have a preamble, 1,075 distinct,
836,459 characters if each were written once; interval-js 4,391 records, 3,399 distinct, 2,614,010;
glsl 1,625 records, 305 distinct, 255,263. One document (`1a9de333a1`) holds a 189,571-character
lookup table in the preamble of each of 7 JavaScript records and a 189,660-character constant array
in each of 7 interval-js records; each set is about 1.33 M characters (29 % of the javascript
total and 31 % of the interval-js total; my arithmetic from these sizes).

Token classes (regular expressions are in `size-census.md`, "Regular expressions"; counts are over
`code + "\n" + preamble`; "chars" of nested calls overlap with the outer call):

| Class | javascript | interval-js | glsl |
|---|---|---|---|
| `\b_SYS\.([A-Za-z_]\w*)\s*\(` calls (chars of the full call text) | 20,914 (1,782,246) in 3,752 records | 0 | 0 |
| `\b_IA\.([A-Za-z_]\w*)\s*\(` calls | – | 115,403 (30,309,034, nested counted at every level) | – |
| `\b_gpu_(\w+)\s*\(` calls / definitions in preambles | 0 | 0 | 8,767 calls in 1,556 records / 4,707 definitions in 1,557 records |
| `_cse<n>` occurrences | 25,555 | 21,977 | 9,944 |
| `_tv<n>` occurrences | 46,595 | 12,050 | 1,254 |
| `_k<n>` (hoisted constants) | 0 | 68,482 | 0 |
| IIFE (AST: an arrow function called at once), any parameters (chars) | 5,208 (1,781,239), in 2,768 records | 3,484 (1,359,078) | – |
| IIFE with exactly one parameter | 933 in 327 records | 472 in 251 records | – |
| numeric literals (chars) | 162,498 (1,693,502) | 101,840 (1,440,907) | 34,225 (163,599) |
| `Array.isArray(` | 81 | 12 | 0 |
| `Number.isNaN(` / `?? NaN` / `=== undefined` | 27 / 1,304 / 0 | 0 / 0 / 0 | 0 |

Top `_SYS` helpers (count; call-text characters): `pow2` 5,603 (189,498); `pow` 1,974 (56,182);
`floorMod` 1,384 (109,934); `pow3` 1,358; `atNoWrap` 1,344 (69,069); `fract` 1,311 (64,376);
`bcast` 1,060 (236,603); `cprodok` 1,058; `cospi` 833. By characters: `jsqrt` 324,120 and `jadd`
316,944 (592 and 576 calls, all in 3 records), `bcast` 236,603, `pow2` 189,498. The full top-30 lists
by count and by characters are in `size-census.md`.

Top GLSL helpers by calls: `_gpu_pow2` 1,872, `isnonfinite` 985, `fmod` 724, `sin` 619, `cos` 605,
`nan` 464, `isnan` 432, `cospi` 328. `_gpu_sin`, `cos`, `max`, `min` are the NaN-safe helpers of
step 4, row 9: 619 + 605 + 195 + 183 = 1,602 calls and 507 + 514 + 151 + 85 = 1,257 definitions.
Top `_IA` by call-text characters: `add` 21,705,426 (24,747 calls in 3,743 records), `mul` 1,680,639,
`points` 1,341,630, `scale` 1,031,701. The `add` figure counts nested calls at every level; a sum
of n terms is written as a chain of binary `_IA.add` calls (read from the printed records, not
verified in the lowering source).

Repeated identical sub-expressions that CSE did not share (maximal repeats only; threshold 12
characters of whitespace-free text; kinds: call, binary, logical, member, conditional, arrow
function; within one unit, so code and preamble are never compared; the "savable" figure is gross
and does not subtract the cost of a temporary):

| Target | Method | Records with a repeat | Groups | Extra occurrences | Savable characters |
|---|---|---:|---:|---:|---:|
| javascript | AST | 2,164 | 5,198 | 8,489 | 214,246 |
| interval-js | AST | 1,113 | 3,331 | 8,151 | 342,852 |
| glsl | balanced call/paren groups (approximation) | 317 | 833 | 937 | 35,053 |

Examples (javascript): record 6350 repeats the 76-character memo guard
`_fn_J$memo_s && typeof _fn_J$memo_r !== 'object' && typeof _fn_J$memo_r !== 'function'` 41 times
(3,040 characters); record 7493 repeats `6.283185307179586 * _.x` 100 times (2,079); record 10509
repeats `Math.min(_cse3, _cse6, …)` 21 times (2,920); record 691 repeats `_SYS.floorMod` 99 times.
The top 20 per target are in `size-census.md`.

The ten largest records per target (id, characters) and five typical records with their breakdowns
are in `size-census.md`, section (iv). JavaScript: 2120, 2123, 2126, 2129, 2132, 2135, 2138 (each
189,647), 10396 (74,360), 15421 (29,830), 8068 (24,445). Interval-js: 2121, 2124, 2127, 2130, 2133,
2136, 2139 (each 189,788), 15422 (88,154), 2878 (28,567), 2898 (28,162). GLSL: 16699 (33,125), 187
(10,244), 9113 (7,676), 182 (7,044), 9117 (6,897), 16693 (6,715), 16677, 16681, 16685, 16689 (about
6,710 each).

### 2.3 Run time of the emitted JavaScript (`$S/q2b/time.mjs`, results in `timing.md`, `timing.tsv`, `slowest.md`, `prof.txt`)

Method: each record is compiled again with the head build (`/tmp/wt-compute-engine-5c-head`, fresh
`ComputeEngine`, `precision = 'machine'`, declared free-symbol types, `parse(input)`,
`compile(options)`); a record is eligible only if the new `code` and `preamble` equal the recorded
ones. Inputs: the 8 recorded samples of `head-values.json`, used in rotation. 100 warm-up calls, then
1,000 timed calls as one loop between two `performance.now()` readings; three repeats; the table
gives the median of the three and the minimum and maximum. Command:
`timeout -k 30 600 node --expose-gc time.mjs` under box-lock owner `compute-engine-5c:timing`. Load
average 4.28 / 4.51 / 4.21 at the start and 4.30 / 4.50 / 4.21 at the end. Timing loop:

```js
function loop(res, inputs, count) {
  let acc = 0, thrown = 0;
  const m = inputs.length;
  for (let i = 0; i < count; i++) {
    try { const v = res.run(...inputs[i % m]); acc += typeof v === 'number' ? v : 1; }
    catch { thrown++; }
  }
  globalThis.__sink += acc + thrown;
  return thrown;
}
function measure(res, inputs) {
  loop(res, inputs, WARM);              // WARM = 100
  const t0 = performance.now();
  loop(res, inputs, ITER);              // ITER = 1000
  const t1 = performance.now();
  return ((t1 - t0) * 1e6) / ITER;      // ns per call
}
```

Control (an empty function in the same loop): median 21.4 ns (20.3–35.1).

Eligibility: 8,830 JavaScript records; 5,922 eligible; 2,904 skipped because the recompiled code
differs from the recorded code (most of them depend on document definitions that I could not
recreate outside Tycho's document manager); 4 skipped for lack of inputs. The largest-code group is
therefore drawn from records that do not depend on document setup. Random group: seed 20261104
(mulberry32), 30 records, excluding the 30 largest; duplicates by code hash and two records of one
document and row were excluded.

| Group | Records | Median ns/call | Range over records |
|---|---:|---:|---|
| largest code | 30 | 1,968 | 47 – 7,393 |
| random | 30 | 74 | 35 – 636 |

The 10 slowest (the table of all 60 is in `timing.md`):

| Rank | Record (document) | ns/call | What the time goes to |
|---|---|---:|---|
| 1 | 10509 (`lwuwgb9ic5`) | 7,393 | helper `_SYS.nd` (numerical derivative): its closure and sample-size code re-evaluate 123 `_SYS.pow2` terms |
| 2 | 1443 (`s8ishknvhe`) | 4,667 | helper `bcast` and its kernels (about 30 % of the samples), 20 IIFEs and `{re, im}` object literals per call |
| 3 | 7493 (`drlgfryk8s`) | 4,536 | helper `_SYS.cospi`, 100 calls in a straight-line sum (`quarterTurns` 38 %) |
| 4 | 1768 (`wccrhnzn2q`) | 3,818 | helper `bcast` (about 39 %), `pointdot` 10 %, array allocation by 4 IIFEs and a `.map` |
| 5 | 1773 (`wccrhnzn2q`) | 3,303 | same shape as 1768, plus 5 explicit `for` loops that build point arrays and 8 IIFEs |
| 6 | 4493 (`51a4237846`) | 2,779 | **throw path**: 7 of 8 sample inputs throw "Invalid array length" |
| 7 | 4492 (`51a4237846`) | 2,741 | **throw path**: 5 of 8 inputs throw |
| 8 | 2070 (`0jqrzf0b8u`) | 2,449 | a straight-line body of 100 `Math.sin` calls; 67 % in the run function, no helper |
| 9 | 691 (`4vyn5yplp9`) | 2,256 | helper `_SYS.floorMod`, 99 calls (`floorModDouble` 42 %) |
| 10 | 2066 (`0jqrzf0b8u`) | 2,232 | same as 2070 |

Records 4491 and 4494 throw on all 8 inputs, and 4487–4490, 4492 and 4493 on 5 to 7 of 8, all in
document `51a4237846`. I did not trace why; the sample inputs may not have the shapes the host
passes. Their times measure the throw path and are not evidence about a successful call. No record
returned `NaN` or `undefined` on every call.

### 2.4 Draw time of GLSL shaders (`$S/q2c/`)

`tycho-desk` declined the frame-time measurement (reply of 2026-11-04: its user decided that
Compute Engine runs such measurements itself). It also corrected section 4(c) of the impact report:
Tycho has two probes that measure application frame time,
`scripts/repros/2026-09-29-showcase-fps-probe.mjs <showcase id>` (one showcase entry in the running
dev server, headless Chromium with GPU) and `scripts/repros/2026-10-26-d364-slider-drag-frames.mjs`
(headed Chromium, fixed expressions). Neither takes an arbitrary corpus document, and both use the
CE of Tycho's own `node_modules`; using the head would need a separate Tycho worktree with the head
installed. The statement in the impact report that Tycho can measure only the draw time of one
shader is therefore wrong. I did not change that report.

I ran a shader draw measurement as the user authorized on 2026-11-04 (read-only; box-lock owner
`compute-engine-5c:shaderbench`; load 3.3 / 6.4 / 7.1 at acquire, 3.9 / 6.1 / 6.9 at release). **It
times one shader in isolation (2048×2048 RGBA32F, headless Chromium, ANGLE/Metal). It is not a frame
time.** I did not use Tycho's bench itself: it takes only its own case-file format, so it could not
take hand-edited sources. `$S/q2c/bench.mjs` copies its GLSL path: a fresh browser per measurement,
20 draws, best of 5 runs divided by 20, 7 rounds, each round: as-is, helpers replaced, as-is again
(control). In the "replaced" copy every `_gpu_sin(`, `_gpu_cos(`, `_gpu_max(`, `_gpu_min(` and
`_gpu_clamp(` call is textually replaced by the builtin; the helper definitions stay. Commands are in
`$S/q2c/shader.md`.

| Record | Document | Helper calls (total / own code) | As-is ms (min–max) | Replaced ms | Replaced / as-is | Control |
|---|---|---|---:|---:|---:|---:|
| 254 | showcase/underwater-caustics | 4 / 0 | 6.050 (6.010–6.060) | 5.895 | **0.974** | 1.002 |
| 4823 | neyret/62urmx2dcm | 25 / 16 | 0.300 | 0.250 | 0.833 | 1.083 |
| 4738 | neyret/62urmx2dcm | 9 / 0 | 0.180 | 0.170 | 0.944 | 1.222 |
| 8940 | neyret/h2sajw9hdv | 6 / 3 | 0.080 | 0.125 | 1.563 | 2.250 |
| 1070 | art/lol0kdvght | 9 / 9 | 0.120 | 0.180 | 1.500 | 1.042 |
| 144 | showcase/cie-chromaticity | 17 / 0 | 0.155 | 0.105 | 0.677 | 0.677 |
| 9021 | neyret/hpr2q4kles (0 helpers) | 0 / 0 | 0.105 | 0.115 | 1.095 | 1.333 |

Only record 254 draws long enough to measure; the helpers cost about 2.6 % there, the same size as
the +2.1 % to +2.2 % of the impact report on two other shaders of the same document. The other six
draw in 0.08 to 0.30 ms, at the timer resolution; their ratios (0.68 to 1.56, the 0-helper control
1.10 and 1.33) are noise. The second `underwater-caustics` case of the impact report is not a GLSL
record in this audit; `showcase/exoplanet-transit` (82 helper calls) returns a vector and does not
run in the scalar harness. Record 144 used the value 0 for all symbols (no recorded sample).

### 2.5 The three largest sources of size and of time

"Inherent" = the document computes that much; "rule" = a cost of a rule of the compilation model
(a NaN-safe helper, broadcasting, a decline fallback); "waste" = a repeated sub-expression, a
wrapper around a bound value, a helper call where an inline operator would do. The classes overlap
(an IIFE can contain a `_SYS` call), so the character counts do not add up.

Size:

1. **Numeric literals and tables**: 1,693,502 characters in 162,498 literals (javascript, 37 % of its
   characters), 1,440,907 in interval-js, 163,599 in GLSL. Example: the 189 k-character table of
   record 2120. Inherent (the document holds the data). The interval-js hoisting `_k<n>` (68,482
   uses) moves constants into the preamble and is a cost of the interval model, not measured as waste.
2. **Runtime helper calls and the wrapper that carries them**: 20,914 `_SYS` calls with 1,782,246
   characters, and 5,208 IIFEs with 1,781,239 characters (the two overlap) in javascript;
   `_IA` calls (115,403) in interval-js, where one sum of n terms is a chain of binary `_IA.add`;
   8,767 `_gpu_` calls and 4,707 helper definitions in GLSL. Mostly a cost of rules (`pow2`, `bcast`,
   `floorMod`, `fract`, the NaN-safe `_gpu_*` helpers). Examples: `pow2` (5,603
   calls in 1,249 records); `jsqrt`/`jadd` 324 k and 317 k characters in 3 records. Whether a
   `_SYS.pow2(x)` would be an inline `x * x` where the operand is a plain number was not checked.
3. **Preamble copies**: 54 % of the javascript characters, 65 % of interval-js and 63 % of GLSL are
   preamble, but only 836 k, 2,614 k and 255 k characters are distinct. A rule/structure cost of the
   record unit (each compile carries its own copy), not code that runs twice. The next candidate in
   the measure is the repeated sub-expression: 214,246 characters in javascript (record 6350: the
   memo guard 41 times; record 7493: `6.283185307179586 * _.x` 100 times), 342,852 in interval-js.
   That is waste by the definition above, 4.7 % and 7.9 % of the characters.

Time (JavaScript, the 10 slowest of 60 timed records; 2 of the 10 are throw paths and are left out):

1. **Runtime helpers**: `bcast` (records 1443, 1768, 1773: about 30 to 39 % of samples), `cospi`
   (7493), `floorMod` (691), `nd` (10509). 6 of the 8 slowest records without a throw path. A rule
   (broadcast to a list) or inherent (a derivative stencil).
2. **Long straight-line bodies**: 100 `Math.sin` calls in records 2070 and 2066 (no helper, 67 % in
   the run function). Inherent (the document sums 100 terms).
3. **Per-call allocation by IIFEs and object/array literals**: 20 IIFEs and `{re, im}` literals in
   1443, 4 to 8 IIFEs with array building in 1768 and 1773. A rule (complex and point shapes are
   built per call); whether it is waste was not separated from the helper time.

For GLSL, the only measured time source is the NaN-safe helpers: about 2.6 % on one shader (a cost of
a rule, row 9 of the contraction plan).

## 3. What the numbers do not show

- **Class b is by kind, not by structure.** All 116 rows are "every present cell is an emitter".
  Two emitters of 30 lines each may share nothing. The share of the 4,761 + 2,058 lines that one
  lowering could replace is not measured; only the upper bound is.
- **The `_IA.` rule.** Counting `_IA.x(…)` as a template puts 33 operators (interval-js a template,
  the others emitters) in class c. Counting it as a helper would change the classes; I did not run
  that variant. The class (a) count of 3 depends on the strict equality test.
- **Delegation is followed one level.** Emitters that call a function that calls another are
  counted at the first function only. Special cases of an operator in shared `compile-*.ts` files
  are counted per operator and file in `table.tsv` (`sharedCode_specialCases`), not in the line
  counts.
- **Declines are narrow.** Only a body that is a single `throw` is a decline cell; many emitters
  throw on some inputs.
- **Lowering that is not in a table.** Code in `compile-loops.ts`, `compile-integrals.ts`,
  `compile-linear-algebra.ts` and other shared files lowers some operators (including the
  JavaScript target's `javascript-statements.ts` and the 3,800-line `gpu-preambles.ts`); those lines
  are not in the 7,116.
- **The records are the Tycho corpus**: 757 documents, Desmos-heavy. Other host programs may differ.
  A record is one distinct compile, so a widely used document counts once in the sizes, not by how
  often it runs (`occurrences` weights are in `size-census.md`, one column).
- **Run time covers 5,922 of 8,830 JavaScript records**, those whose recompile reproduces the audit
  code. 2,904 depend on document definitions and were not timed; the sample is biased toward
  self-contained expressions. Eight of the 60 timed records belong to one document and throw on most
  inputs. The spread inside a record is large for the fast ones (JIT warm-up in the first repeat).
  The machine was not idle (load about 4 on 18 cores).
- **No interval-js, GLSL-on-hardware, WGSL or Python run time was measured.** The shader result is
  one measurable shader out of seven (others at timer resolution), not a frame time. The
  "replaced" shaders differ from the as-is ones for non-finite inputs.
- **The repeat figures are gross** (no cost of a temporary). The GLSL figure is an approximation by
  balanced parentheses, not a syntax tree.
- **Overlap**: the `_SYS` and IIFE character counts include nested calls and overlap.
- **The audit's code hash and the earlier run**: this run is at `1872ac457`; the impact report's
  tables are at `fdf351b51`. I did not compare the two runs record by record.
- **A defect noticed**: the comment above the shared GPU function table says 128 entries and the
  table holds 141 functions (155 with operators). A stale comment only; not recorded as an entry.
