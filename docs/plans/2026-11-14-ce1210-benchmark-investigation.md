# CE-1210: the benchmark cases under binding units, investigation of 2026-11-14

Record of the measurement that `issues/CE-1210.md` summarizes. Run files are in `_TASKS/2026-11-14-ce1210/` (not in the repository).

## Measurement

Cases D01 D03 D05-D08 A01 CR2 CE1-CE3, one process for each case and bundle
(`scripts/repros/2026-11-14-ce1210-ab-cases.mjs`), under the box lock: main
at `df7aba80d` takes 1.36 times 0.186.0 (each case 1.21 to 1.62; rounds
1.353 to 1.377). Every case carries it; the jump is at 0.187.0. The three
commits of 2026-11-14 that touch boxing (`e5b9907a7`, `319f00e0f`,
`2e09c2d14`) cost nothing measurable (1.002 against `3ab43b3e2`).

The numbers of type computations and of cache hits are the same as on
0.186.0 (`ce._cacheStats`: D06 195/11 against 192/11, CE2 1,078/71 against
1,071/74): each type read costs more. A CPU profile of the unminified
bundles, 11 cases 1,500 times (`2026-11-14-ce1210-profile-diff.mjs`):
6,338 ms on 0.186.0, 8,407 ms on main. Type reads carry 58% of the
difference (1,273 to 2,468 ms). On main, inclusive: the type read of a
symbol (`_unitType()`) 577 ms (the entry lookup and its record 208, the
resolution in the static view 134, the meet with the entry 76); validating
a cached compound type (`objectDepsValid`, `mergeObjectDeps`) 317 ms;
recording the reads (`readUnitEntry`) 230 ms; activation tests 273 ms;
`unitEnvironmentOfOperands` at boxing 82 ms. The other 45% of the
difference has no function above about 60 ms. There is one recorded read
for each type read of a symbol: the three reads per free name of "Cause and
options" are gone, so the old option 2 no longer applies.

Four changes landed with this section (source +39 −34): `mergeObjectDeps`
uses the version that validation just proved; `readsActivationHalf()` no
longer tests `isFunctionLiteralParameter` twice; the function-literal
parameter mark and the activated-definition mark are fields of the
definition in place of a WeakMap and a WeakSet; in a type computation
`storedValue` and `declaredType` no longer walk the scope chain for an
activation's value that they then discard. Together: 0.952 of the time
(rounds 0.950 to 0.953), so 1.30 times 0.186.0. The full suite and
`CE_TYPE_PARANOID=1` over 834 files pass on them.

Left: about 1.30 times 0.186.0 on these cases, spread over the cost of each
type read under binding units. Options for the board:

1. The engine-wide counter (option 1 of "Cause and options"). It removes the
   validation and the recording of reads, an estimated 25 to 30% of what is
   left (from the profile). A missed invalidation site gives a stale type;
   `CE_TYPE_PARANOID=1` is the check.
2. A cheaper type read of a symbol (`_unitType()`). It needs a design. Its
   577 ms is the whole inclusive time of the read on main, not the added
   time and not what a design would remove: an upper bound of about a third
   of what is left. See "The two options compared" below.
3. Accept about 1.3 times on these cases and close this part.

Not built, about 1 to 3% each (estimates): activation values as a field of
the scope; no `narrow()` in `_typeOfDefinitionInUnit` when the declared type
is `unknown`; no third lookup in `unitEntryOf` when the unit is a parent of
the operation.

The `turing-patterns` run step (`floorMod`, `countLoopPass`) is not
explained by these findings: the changes are in type reads and value reads
of the interpreter, not in compiled helpers.

## Two reads removed (2026-11-13), as first recorded in the issue

A count of the type reads of one `legal(B, B[65])` call, by caller
(`~/dev/compute-engine-recovery/fc-typereads/report.md`): 1,799,470 reads
and 98,227 type computations, every one a cache miss (the type version
moves 13,306 times in the call: 7,412 value writes, 5,894 scope pops).
Three callers start about 92% of the reads: the check of the arguments of a
call (`makeLambda`, `function-utils.ts`), which derived the signature of
the literal and so typed its body twice per call; the purity test of
`BoxedFunction.evaluate` (`latentEffectsOf`, `effects-of.ts`); the
element-wise test of a connective (`isCollectionShaped` under
`evaluateConnective`).

Changed, with the invalidation as it was: the check of the arguments reads
`functionLiteralParameterSignature()` (the parameters only), and
`couldBeCallable()` answers `false` for a union none of whose arms can hold
a function. One call: 98,227 computations and a median of 1,160 ms before,
42,539 and 670 ms after (9 calls for each arm, arms alternated, load
average 18.9 falling to 10.7). No test pins the count: a small program
computes the same types on both paths.

Left: the purity test (about 84% of the remaining computations, mostly on
`Block`; the memo of `_effectsOf` misses at each evaluation, cause not
determined) and the element-wise test of a connective (about 15%; no form
that keeps every value was found). The invalidation is D16 and D17 of
`docs/plans/2026-11-11-bound-once-spec.md`.

## The two options compared

The two estimates of the options are not like for like. Added SELF time by
source file, 0.186.0 to main before the four fixes (+2,069 ms in all):
`binding-unit.ts` +439, `object-deps.ts` +215, `boxed-symbol.ts` +207,
`boxed-function.ts` +185, `ambient-chain.ts` +160, `function-literal.ts`
+113, `type-guards.ts` +74, the garbage collector and `(program)` +105.

- Option 1 (the counter) removes the validation of a cached compound type
  (`object-deps.ts`, 317 ms inclusive, less what the first fix already took)
  and the recording part of a read (the token and `collect`, about 90 ms of
  the 230 ms of `readUnitEntry`; the lookup of the entry stays, a read needs
  it). All of that goes if the counter is right: the 25 to 30% of what is
  left is an estimate of removable time.
- Option 2 targets the read of a symbol: the lookup of its entry in the
  trial, operation and unit environments, the resolution in the static view
  and the meet (most of the added time of `binding-unit.ts`, `boxed-symbol.ts`
  and `ambient-chain.ts`, about 700 ms before the fixes, which also took part
  of it). That is the largest block of added time, larger than what option 1
  removes. How much of it a design can remove is not known: the read must
  still find the entry of the unit. The two options overlap on the recording
  of the read.

Neither brings the cases back to 0.186.0: about 45% of the added time has
no function above about 60 ms.

## Findings of 2026-11-15

Ratios are to 0.186.0 (`c4856e003557e367d4a2272d37d1567e9dd7a9b3`) on the
same cases. The reports of the agents are outside the repository, in
`~/dev/compute-engine-recovery/ce1210/` (`design-probe-report.md`,
`rest-report.md`, `ic-report.md`, `retreat-costing-report.md`).

**Landed.** `6d4667949bf4c3fc48b165b896d003d5e019cb31`: the type read of an
activation-held definition no longer resolves in the static view (source
+16 −84). `a56ceaa265cbd9e3aeb66af8ba46b5cc3742b192`: one hidden class for
a symbol, a call and a value definition; the key of the limit probe memo
(source +36 −12). Main after them: 1.245 (rounds 1.216 to 1.250).

**Ruled out by measurement.** Builds of 0.186.0 padded to main's object
size (1.005, 1.001) and code size (0.996); hidden classes after the commit
above; the inline-cache census; the tier profile (no shift between tiers;
the garbage collector 3.0% to 3.9% of the time).

**Unsafe ceilings on main** (switches that give wrong types, for
measurement only): no recorded reads and cached types trusted, −0.08 to
−0.12; the shortest symbol read, about 0; no unit environment at boxing,
small; all three, about 1.12. A cached type that is trusted on one
engine-wide number as the code stands is not sound: a validation of a
cached type fails 29,926 times in the test suite.

**Call counts do not explain the time.** V8 precise coverage
(`scripts/repros/2026-11-15-ce1210-call-counts.mjs`) counts 47,039 calls
per evaluation on 0.186.0 and 61,501 on main. A branch that removes the
extra calls (47,922 per evaluation; source +272 −136; full suite and the
stale-type check clean; not landed; patch
`~/dev/compute-engine-recovery/ce1210/calls-3ed1234c3-on-a56ceaa26.patch`)
takes 1.202 (rounds 1.177 to 1.211) against main's 1.245 in the same run,
with the same one-entry esbuild of each tree. The coverage does not count
builtins (`Map` and `WeakMap` operations, array operations, allocation).

**A memo of environment reads** (P2, an engine-wide epoch; about +80
lines; patch `probe-5df82d922-on-40ccf484f.patch`) was measured before the
call-removal branch and is not landed.

**Who reads an entry.** On the cases, of 309 entry reads per evaluation 52
are by a free name, about 147 by a parameter of a function literal and
about 110 by another definition that a boxing made (a binder variable or a
block local; the split of the last two is an estimate). A return to the
definition store of 0.186.0 for free names would therefore touch under 20%
of the reads.

**Options costed, not built** (`retreat-costing-report.md`; every figure
is an estimate):

| Option | Source lines | Reaches |
|---|---|---|
| (a) one counter that moves at every environment write; no recorded reads | about −300 | 1.13 to 1.15 |
| (b) each occurrence points at a shared cell of its unit | −150 to +50 | as (a) |
| (c) requirements on a definition again, hidden from the host | thousands moved | unknown |
| (d) a parameter, binder variable or block local reads its definition once its construct is boxed | −60 to −130 | 1.14 to 1.16; 1.12 to 1.14 with (a) |

(a) loses the memo of a derivative across operations and needs a new key
in about ten cache families. (d) reverses item (d) of D18
(`docs/plans/2026-11-11-bound-once-spec.md`): a host that builds an
expression from a piece of a function body gets the parameter's own type.
(c) brings back the dependence on the order of expressions and the host's
scratch scopes.

**The floor.** No option on the type-read path goes under about 1.12. On
0.187.0 the same build ran at 0.93 of 0.186.0 with the units flag off, so
the whole cost is behind the sites that the flag gated. A split of that
flag by mechanism on 0.187.0 was started on 2026-11-15 to find the group
that carries the part no repair has removed.

**Not evidence.** The row "0.188.1 units off 1.25, on 1.24" of the issue:
the flag does not exist in 0.188.1.

**Defect found.** CE-1342: a cached type that a recorded read does not
invalidate, and the case that `CE_TYPE_PARANOID` does not see.

## The `turing-patterns` prelude (moved from the issue, 2026-11-15)

CPU profiles of the `turing-patterns` prelude (tycho-desk, the same day):
the compiled body takes the same time on both releases (1,883 / 1,894 ms);
the difference is in run-time helpers (`floorMod` 239 / 396 ms,
`countLoopPass` 62 / 101, two minified functions). The source of `floorMod`
is the same at both tags. Cause not determined.
