# Prototype of binding units: report

Result of section 7 of `docs/plans/2026-11-09-binding-units-model.md`.
Session `compute-engine-1c`, 2026-11-09. Base commit
`f9c7069b073dae28f7d77ce26ef699eca09ae34b`.

- Worktree: `/tmp/wt-compute-engine-1c` (left in place, detached, nothing
  committed; two new files are marked with `git add -N` so that the diff
  holds them).
- Patch: `prototype.patch.txt` in this folder (956 lines). Not to apply to
  the main tree.
- Nothing is staged and no file of the main tree changed except this report
  and the patch.

## 1. What was built

One outermost boxing is a unit. `EngineBoxingState.withRootRepair()` owns one
environment for each build pass (`UnitEnvironment`, new file
`src/compute-engine/binding-unit.ts`). Each `BoxedSymbol` keeps a reference
to the environment of the boxing that made it (`_env`). A symbol made outside
a boxing has none, and gets an environment of its own at the first inference
written on it.

A free name is a value definition that the boxing of a free symbol made in a
scope that existed before the boxing (`createSymbolExpression()`, and the
outer binding that `_inferOnOuterBinding()` declares), and that has since
received no value and no declared type. The environment is keyed on that
definition.

- Write: `BoxedSymbol._inferWithoutFacts()` writes the requirement in the
  environment of the occurrence, with the same narrowing as today
  (`narrowInferredType()`, the record of scalar uses that map).
- Read: `BoxedSymbol.type` answers from the environment, then merges the
  facts of the context (`BoxedValueDefinition._typeFrom()`).
- `CE_BINDING_UNITS=1` makes the environment the answer and stops the write
  on the definition. Without it the write of today is made and is the answer
  (compare mode).
- `CE_BU_COUNT=1` counts, at each read of the type of a free name, whether
  the two answers differ, by read site (file and function) and by cause.
  With the switch on, the answer of today is no longer on the definition; a
  table used only by the counts replays the narrowings, and it is approximate
  because the readings then differ.

Not built: the reading of an ambiguous form in the environment, the stamps,
`ce.infer()`, stored bodies, the batch.

`git diff HEAD --stat` of the worktree:

```
 src/compute-engine/binding-unit.ts                 | 165 +++++++++++
 .../boxed-expression/boxed-symbol.ts               | 172 ++++++++++-
 .../boxed-expression/boxed-value-definition.ts     |  54 +++-
 src/compute-engine/engine-boxing-state.ts          |  19 ++
 .../engine-expression-entrypoints.ts               |   2 +-
 src/compute-engine/types-definitions.ts            |   7 +
 src/compute-engine/types-expression.ts             |   6 +
 .../inference-order-independence.test.ts           | 327 +++++++++++++++++++++
 test/jest-config.ts                                |  23 ++
 9 files changed, 761 insertions(+), 14 deletions(-)
```

## 2. Read sites

Sites that had to change, all with a symbol at hand:

| File | Site |
|---|---|
| `boxed-expression/boxed-symbol.ts` | the getter `type`; the value-definition branch of `_inferWithoutFacts()`; the declaration at the end of `_inferOnOuterBinding()`; the constructor |
| `boxed-expression/boxed-value-definition.ts` | the getter `type` (split, so that the merge of the facts takes the recorded type as an argument); its memo is keyed on the definition and is not used for a free name |
| `engine-boxing-state.ts` | `withRootRepair()` |
| `engine-expression-entrypoints.ts` | the auto-declaration in `createSymbolExpression()` |

Every other read through a symbol goes through the getter, so no caller of
`expr.type` changed.

Sites that read the type of a free name on the value definition, with no
symbol at hand: 64 distinct functions in the full suite (compare mode).
With the switch on they read `unknown`. The largest, by reads whose answer
would differ:

| Reads | Site |
|---|---|
| 183,164 | `boxed-expression/effects-of.ts` `valueBindingEffects` |
| 84,999 | `index.ts` `_scopeResolution` |
| 22,542 | `boxed-expression/utils.ts` `defIsCallableShaped` |
| 11,651 | `boxed-expression/effects-inference.ts` `isFunctionValued` |
| 10,945 | `compilation/cse.ts` `opaqueSymbolDefinition` |
| 9,339 | `boxed-expression/effects-provenance.ts` `effectsContractStateOf` |
| 8,494 | `compilation/compile-assignment-checks.ts` `userFunctionSignature` |
| 7,829 | `function-utils.ts` `isApplicableDef` |
| 7,704 | `compilation/compile-assignment-checks.ts` `userFunctionParamsAreScalar` |
| 7,237 | `multi-clause.ts` `isGenericTarget` |
| 4,991 | `boxed-expression/box.ts` `makeCanonicalFunctionCore` |
| 3,146 | `boxed-expression/invisible-operator.ts` `isDeclaredFunction` |

The complete lists are in the scratchpad file named in section 7.

The flag `inferredType` of a free name is true in both modes, so a read of
the flag does not differ. The flag was not counted by site.

## 3. Compare mode

Full suite, 1,984 test files, 81,411 tests that ran.

| | Count |
|---|---|
| reads of the type of a free name through a symbol | 86,930,837 |
| of which the two answers differ | 8,347,180 (9.6%) |
| reads on the definition, no symbol at hand | 712,670 (0.8% of all reads) |
| of which the answer of today is not `unknown` | 382,508 |
| distinct read sites with a difference | 396 (332 through a symbol, 64 direct) |

By cause, for the reads through a symbol:

| Differing reads | Cause |
|---|---|
| 7,228,603 | the unit has no requirement for the name; the definition has a type from an earlier boxing |
| 863,081 | the unit has a wider type than the definition (other boxings narrowed further) |
| 246,993 | the symbol was made outside a boxing (from a name alone) |
| 6,447 | the unit has a narrower type than the definition (a rollback, a restore or a widening changed the definition) |
| 1,902 | the definition is `unknown` again and the unit has a type |
| 154 | the two types are not related, or the definition is `never` |

By read site (all causes), the largest:

| Differing reads | Site |
|---|---|
| 3,061,299 | `validate.ts` `excludedFromScalarInference` |
| 1,516,770 | `boxed-symbol.ts` `get isNumber` |
| 1,507,865 | `validate.ts` `checkNumericArgs` |
| 968,023 | `validate.ts` `couldBeNonReal` |
| 324,907 | `boxed-function.ts`, an anonymous function |
| 148,429 | `collection-utils.ts` `operandTypeCannotBeTuple` |
| 121,049 | `boxed-function.ts` `get type` |
| 88,620 | `matrix-operand.ts` `mayBeTensorProductOperand` |

The four largest are reads that boxing makes to decide whether to write a
requirement, so most differing reads come from the canonicalization of a
later expression.

Reads from a symbol made from a name alone, largest sites: `boxed-function.ts`
anonymous (32,975), `collection-utils.ts` `operandTypeCannotBeTuple`
(24,614), `boxed-symbol.ts` `get isInfinity` (22,535), `matrix-operand.ts`
`mayBeTensorProductOperand` (21,339), `validate.ts`
`excludedFromScalarInference` (17,962), `order.ts` `hasCollectionShape`
(15,991), `solve.ts` `unknownType` (7,245).

Tests: 40 fail in compare mode. 39 are in the order-independence test, which
asserts the behavior of the switch on. 1 is a defect of the prototype
(`checkpoint-journal.test.ts`: the new field `_freeNameMark` is not in the
snapshot of a value definition).

Tycho's corpus sample (98 of 585 states, 861 rows, each registered twice):
130,823 reads through a symbol, 10,356 differ (7.9%); 20 of them from a
symbol made from a name alone. 13,513 reads on the definition (9.4% of all
reads), 8,537 would differ. The largest direct sites there are
`isApplicableDef`, `isDeclaredFunction`, `makeCanonicalFunctionCore`,
`yieldInferredFunctionToOracle` and `calleeSignatureType`: the decision
whether a name is a function.

## 4. Switch on

523 of 81,411 tests fail (0.64%), in 163 files. No file failed to end. By
area of the test file: 267 engine, 219 compilation, 37 Epsil.

The requested split by cause cannot be made exactly by a program. Two
partial splits follow; the list of all failures with both labels is in the
scratchpad (section 7).

By the differing reads that the counts saw inside the failing test:

| Tests | Differing reads in the test |
|---|---|
| 306 | only reads where another unit gave the type |
| 89 | only reads from a symbol made from a name alone |
| 58 | both of the above |
| 40 | a read on the definition (alone or with the others) |
| 30 | none |

By the message of the failure:

| Tests | Message | Cause |
|---|---|---|
| 172 | a type was expected, `unknown` was received | breaking change 1 of section 5: the test reads the type of a name after a boxing |
| 79 | compile declines: "the input `x` has no type" | see below |
| 90 | `true` expected, `false` received (77 in compilation files) | mostly the same compile decline, not checked one by one |
| 18 | Epsil: "argument names unavailable" | a read on the definition: the signature of a callee |
| 12 | snapshot | not analyzed |
| 9 | `NaN` received | not analyzed (8 saw only name-alone reads) |
| 3 | stack overflow in compiled code | not analyzed |
| 7 | `false` expected, `true` received | not analyzed |
| 1 | `_freeNameMark` | defect of the prototype |
| 132 | other | not analyzed |

The compile decline is breaking change 1 seen through `compile()`. A
relation does not require a type of its operands: in a new engine,
`compile(ce.parse('x > 1'))` declines with the switch off too (checked with
a trace: no write on `x` during the compile), while `x^2 + 1`, `\sin(x) + y`
and `\sqrt{x}` compile in both modes. The failing tests share one engine
between tests (`compile.test.ts`: `compile(ce.box(['Greater', 'x', 0]))`),
and pass today only because an earlier expression of the file gave `x` the
type `number`. An earlier version of this report said that an operation
after the boxing writes the requirement; that was an inference and it was
wrong.

In the requested groups, as far as the evidence goes:

| Group | Tests |
|---|---|
| a breaking change of section 5 | at least 172 |
| a symbol made from a name alone | at most 147 (89 with no other differing read) |
| a breaking change of section 5, seen as a compile decline (an input typed only by an earlier expression) | 79, probably about 150 |
| a read on the definition | 18 to 40 |
| a cache keyed on a shared definition | none found; see section 6, item 5 |
| a defect of the prototype | 1, and 4 in the order test (below) |
| not analyzed | about 150 |

The order-independence test with the switch on: 51 pass, 10 fail. 6 of the
10 assert the reported type of step 1 (`number` after `x + 1`, where the
model says `unknown`). 4 are order dependence that remains: `N(2.3)` after
`x + N` (twice), `a(2)` after `Integrate(a t, t)`, and `y(2)` after
`x ↦ x + y`. These come from writes at boxing that the prototype does not
move: the declaration of a variable for a library name, and the declaration
of the free name of a function body.

## 5. Timings

Machine: 18 cores. All runs in the worktree under the box lock.

Full suite, three shards, 12 workers, with the counts on (not a timing of
the engine):

| Shard | Compare | Switch on | Load at start |
|---|---|---|---|
| 1 | 74 s (cold Jest cache) | 57 s | 5.2 / 26.4 |
| 2 | 78 s | 61 s | 34.4 / 26.0 |
| 3 | 55 s | 55 s | 29.2 / 26.9 |

Six slow test files, one worker, counts off, two rounds, load 1.9 to 2.9:

| File | Off (ms) | On (ms) |
|---|---|---|
| `integrate-symbolic-pole` | 16,640 / 15,628 | 16,437 / 16,321 |
| `quadrature-hidden-edge-jump` | 14,691 / 14,245 | 14,583 / 14,854 |
| `integration-rules-substitutions` | 10,882 / 10,473 | 11,328 / 11,371 |
| `calculus` | 9,111 / 8,947 | 9,117 / 9,046 |
| `integration-rules` | 7,385 / 7,367 | 10,430 / 10,205 |
| `rubi-utils` | 4,998 / 4,896 | 7,470 / 7,136 |

`integration-rules` and `rubi-utils` are about 40% slower with the switch
on. The added time is in the loading of the rule bundle (about 300 ms more
for each new engine; the tests themselves take the same time). The cause is
the engine-wide inference event that the prototype sends at each write in an
environment: today a later boxing finds the type already on the definition
and sends nothing, and with the switch on each unit infers again and clears
the caches. Checked on `integration-rules.test.ts`, two workers, load 9 to
12: off 11.2 and 11.3 s, on 14.3 s, on with the event suppressed
(`CE_BU_NO_EVENT=1`, an experiment flag added after the suite runs; the
patch holds it)
10.1 and 10.9 s. One of the 854 tests of the six files fails with the switch
on.

Parse-and-simplify loop, 2,000 rounds, three runs each, load 2.5 to 2.9:
off 2,855 to 3,097 ms; on 2,926 to 2,982 ms. No difference outside the
spread.

Tycho's corpus sample, counts off, two runs each, load 2.4 to 4.9: off
6,304 and 7,208 ms; on 6,812 and 6,049 ms. No difference outside the spread.

"Off" is the prototype in compare mode: it also builds the environment. The
tree without the prototype was not timed.

## 6. What must change in section 2 of the model

1. **"A symbol occurrence carries a reference to the environment of its
   unit" conflicts with "an expression built from boxed operands gets an
   environment whose parents are theirs".** The operands are the same
   objects in the old and in the new expression, so an occurrence cannot
   read the environment of the new expression. The prototype writes a
   requirement of the new expression in the environment of the occurrence,
   which changes what the older expression reports. The model must choose:
   copy the operands, pass the environment to each type read, or accept that
   a unit's environment grows after its boxing.
2. **`compile()` declines more often.** An input that no use in its own
   unit types (`x > 1`, `x = y`, a bare `x`) has the type `unknown`, and
   `compile()` refuses it. Today such an input often has a type from an
   earlier expression of the same engine. The model does not need to change
   for this, but it makes the case common: either the host declares its
   inputs, or `compile()` gets a rule for an input of type `unknown`. This is
   the largest group of failures after the type reports (79 by message,
   probably about 150).
3. **Reads with no symbol at hand get no rule.** 64 functions read the type
   on the definition; on Tycho's sample they are 9.4% of the reads, and most
   decide whether a name is a function. The model must say what they read:
   `unknown`, or an environment that the caller passes.
4. **A type is not the only write of a boxing.** The declaration of the name
   itself, the declaration of a variable for a library name, the inferred
   `function` declaration of a call head, and the declaration of the free
   name of a function body stay shared writes in the prototype, and 4 order
   cases fail because of them. The prototype still declares a free name with
   the type `unknown`, so `ce.lookupDefinition('x')` is defined after
   `ce.parse('x + 1')`; section 5, item 1 says it declares nothing.
5. **Caches (section 6, item 5 of the model) are not answered.** The
   prototype sends the engine-wide inference event at each write in an
   environment, so every type cache is cleared as today. No failure was
   traced to a cache. A cache that needs the environment in its key was not
   looked for: the memo of the merged facts on the value definition is one,
   and the prototype does not use it for a free name.
6. **Rollback and checkpoint.** A requirement in an environment is not
   journaled. The tests of rollback frames that read a type afterwards fail
   as breaking change 1; nothing else was seen.

Answers to section 6 of the model:

- Item 1 (cost of a read through an environment): no measurable cost on the
  parse loop and on Tycho's sample; two rule-heavy test files are 40%
  slower with the switch on, cause not known.
- Item 2 (symbols from a name alone): 246,993 of 86.9 million reads in the
  suite (0.28%), 20 of 130,823 on Tycho's sample; at most 147 failing tests.
- Item 5 (caches): not answered, see item 5 above.

## 7. Files

- `prototype.patch.txt`: the patch of the worktree against the base commit.
- Scratchpad of the session,
  `/private/tmp/claude-501/-Users-arno-dev-compute-engine/5206a194-0494-447a-9326-4a9f37a585b5/scratchpad/runs/`:
  `compare-summary.txt` and `on-summary.txt` (totals, sites, slowest files),
  `on-fails.json` (each failing test with its message and its group),
  `timing.txt`, the Jest logs and JSON results of each shard. This folder is
  temporary.

Left out: a handoff file in `docs/scratch` (the task allows one new file in
the main tree, this report, plus the patch); a review (nothing is
delivered); a timing of the tree without the prototype.

## 8. `compile()` and an input of type `unknown`

Answer of the session `compute-engine-ec` (2026-11-09), which owns the
internal JavaScript fragment target; it holds for that work only.

- The fragment target needs no default for an `unknown` input: it keeps the
  decline. It admits only an input with a declared scalar type
  (`typeOfSymbol()` in `compilation/javascript-fragment-target.ts`), which is
  the rule of `docs/COMPILATION-MODEL.md`, "Shapes are settled at compile
  time". A default would choose a representation that the host did not
  declare, and a wrong choice (real for a complex input) gives a wrong value,
  not a decline. An option of `compile()` that gives the types of the inputs
  is compatible with it, and nothing there needs it.
- Nothing in that target relies on a type that an earlier expression
  inferred. Its tests declare every input.
- For a user function it needs declared types and values only, never the
  inferred type of a free name.
- Not checked by either session: `opaqueSymbolDefinition`,
  `userFunctionSignature` and `userFunctionParamsAreScalar` on the other
  targets.
- A risk it named: the fragment reads the type of each symbol occurrence. If
  two occurrences of one undeclared name in one tree report different types,
  it gives two facts to one binding. In the prototype, all occurrences made
  by one boxing share one environment and report one type. Two occurrences
  can differ only in a tree built from operands of different boxings, which
  is item 1 of section 6. Not tested on the fragment target.

## 9. Decision: `ce.infer()` before `compile()`

Recorded as decision 4 of section 9 of the model document. `compile()` gets
no rule of its own for an input of type `unknown`. A host that wants the
types that its expressions infer calls `ce.infer(units)` first: it declares
the free names of those expressions with the meet of the types that their
environments hold, marked as inferred. The name then has a definition, so
every occurrence reads that type.

| Host code | Today | Model, no `infer()` | Model, with `infer()` |
|---|---|---|---|
| `a = parse('x + 1')`, `b = parse('x > 1')`, `compile(b)` | compiles (`a` wrote `x: number`) | declines (`x` is `unknown` in `b`) | `ce.infer([a, b])`, then `compile(b)` compiles |
| `b = parse('x > 1')` alone, `compile(b)` | declines | declines | declines: no use types `x` |
| `a = parse('x + 1')`, `c = parse('x(3)')`, `compile(a)` | depends on the order of the two parses | compiles (`a` types its own `x`) | after `ce.infer([a, c])` the types conflict, `x` is `unknown`, and `compile(a)` declines |

Limits:

- The third row is a new decline. The host avoids it by passing to
  `ce.infer()` only the expressions that belong together.
- `compile()` trusts an inferred type, as it does today. A value outside
  that type gives an unspecified result.
- Not measured: `ce.infer()` was outside the prototype. The 79 failures with
  the message "the input has no type" are expected to pass with a
  declaration or a call of `ce.infer()` in each test; they were not checked
  one by one.

Rejected: a default type for an `unknown` input (a wrong choice gives a
wrong value, not a decline); an option of `compile()` that gives the types
of the inputs (not needed when `ce.infer()` exists).

## 10. The failures that section 4 left unanalyzed

Read after the report, one example per file, not test by test.

- **Compilation files (219 failures).** Beside the 79 with the message "the
  input has no type", the others fail on the same decline seen another way:
  `success` is false, the result is `undefined` where `[NaN, NaN]` was
  expected, or the GLSL fragment refuses a symbol of type `unknown`. The
  examples read all compile an expression whose input got its type from an
  earlier expression of a shared engine. Decision 4 of the model document
  applies (a declaration or `ce.infer()`).
- **Epsil files (37 failures).** A static diagnostic is missing, or a named
  call finds no parameter names. The prototype gives each statement its own
  environment; the model makes a program one unit. This is a part of the
  model that the prototype did not build, not a breaking change.
- **Engine files (267 failures).** 172 read a type and get `unknown`. Of the
  others, the examples read are: a type reported in a list or a snapshot
  (the same change); a reading that no longer depends on an earlier
  expression (`x(y z)` is a call: breaking change 2); the provenance history
  and `narrowings()` (breaking change 5); and two cases not explained: a
  type with a fact (`complex & !0 | infinity` expected, `number` received,
  5 tests in `internals/`) and `ce-601-shared-evaluation.test.ts` (a probe
  compiled 132 times where fewer than 20 were expected, which may be the
  cache event).
