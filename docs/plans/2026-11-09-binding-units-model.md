# Binding units: binding is a result, computed for a unit and kept current

Status: DRAFT. The direction and the prototype of section 7 are approved
(2026-11-09, decisions 1 and 2 of section 9). The prototype is done
(`2026-11-09-binding-units-evidence/prototype-report.md`), and section 2 is
revised with decisions 4 to 6. Next: a one-page spec of slice 1 (section 8)
for approval. No code in the main tree before that.

This document replaces, as the plan of record, the three drafts of the same
day: `2026-11-09-function-readings-checked-on-use.md`,
`2026-11-09-inference-as-a-result.md` and
`2026-11-09-binding-a-set-of-definitions.md`. They are kept for their
measurements, which this document cites.

## 1. The cause

To bind an expression is to decide which definition each name means, which
reading each ambiguous form gets (`f(x)` a call or a product, `L_1` a name or
an element), and what type each free name has. Today the engine binds each
expression once, when it is boxed, and records the decisions as writes to the
shared definitions of the scope: it declares the names that have no
definition, and narrows their types. The expression boxed next reads those
writes. Nothing is bound again, except stored function bodies, through a
repair that runs when a name gets a definition.

Three kinds of defect follow, and Tycho ranks them in this order
(`~/dev/tycho/docs/scratch/2026-11-09-ce-set-binding-tycho-answer.md`):

1. Boxing writes the type of a free name, and a later expression or
   assignment meets it.
2. A reading depends on what was declared at the time of the boxing, and a
   later boxing cannot repair it.
3. A declared type is enforced at assignment, and the failure is a missing
   binding with no message.

Two attempts to remove one symptom while the shared writes stay each cost
more than planned, for the same reason:

- CE-1102 (`13c41f1c71b56da1c621b9a1d04951841907ee09`): a rule for "which
  stored bodies can see this binding". It needed four cases, and each of two
  review rounds found one that was missing.
- "Writes, but hides" (step 1 of `2026-11-09-inference-as-a-result.md`,
  patch in `2026-11-09-binding-units-evidence/`): a second view of a shared
  definition during a boxing. 827 lines, three full-suite runs to pass, and a
  dual review then found three high defects, because a definition is read
  through more than its type (the inferred flag, the write version, the
  caches keyed on it, the provenance).

Each mechanism existed only to imitate the model below, and would be deleted
when the model exists.

## 2. The model

**The state of the engine holds explicit definitions only**: what the host
or a program declared, assigned or defined. Each name has a counter that
moves at every change of a definition of that name, in any scope.

**A binding unit** is the thing that is bound as a whole:

| Unit | Made by |
|---|---|
| one expression | `ce.parse()`, `ce.box()`, `ce.expr()`, `ce.function()` from raw input |
| one function definition (its body) | `ce.assign()` or `ce.declare()` of a function |
| a set of definitions and readers | a batch call (section 5) |
| one program | an Epsil program, a `Block` that the host evaluates as a program |

**A unit has an environment.** It holds what binding decided for the unit:

- for each name it read: the definition that the lookup gave, with the
  counter of the name at that time (the stamp);
- for each ambiguous form: the reading that was chosen;
- for each free name with no definition: the type that the uses in the unit
  require. This is where inference writes. A name with no definition is the
  same symbol in every unit of a scope (`x - x` is `0` across two parses);
  only its inferred type belongs to the unit. Such a name has no definition
  at all: it is identified by its name and the scope that a declaration
  would go in, and `ce.lookupDefinition()` gives `undefined` for it
  (decision 6).
- the other decisions that a boxing writes on a scope today, for the same
  names: a variable made for a library name used as a value (`N + 1`), a
  call head read as a function (`f(x)`), the free name of a function body.

**The bound form is a cache.** It is computed from the raw form of the unit
and the definitions. A unit that the engine stores (a function body) keeps
its raw form, and is bound again before a use when a stamp no longer matches.
An expression that the host holds is a value and does not change; it can
answer whether its stamps still match, and the host binds the raw form again
when it wants the new reading.

**Types are read through the environment.** A symbol occurrence carries a
reference to the environment of its unit. Its type is: the type of its
definition when it has one; else the type in the environment.

**An expression built from boxed operands writes in the environments of its
operands** (decision 5). The operands are the same objects in the old and in
the new expression, so an occurrence reads one environment only. A use in
the new expression (`ce.function('Add', [a, 1])` with `a` the boxed `x`)
writes its requirement in the environment of that occurrence. The
environment of a unit can therefore gain a requirement after its boxing; it
never loses one. An expression that the host holds can report a narrower
type later, and never a wider one.

A symbol that library code makes from a name alone has an empty environment
of its own, so its type is `unknown` until a use requires one: a rule that
needs `x: number` does not apply, and no rule applies wrongly.

**Code with no occurrence at hand reads no inferred type.** A free name has
no definition (decision 6), so a read on a definition cannot give its
inferred type. The code that decides whether a name is a function
(`isApplicableDef()`, `isDeclaredFunction()`, `makeCanonicalFunctionCore()`,
`calleeSignatureType()`) takes the occurrence or the environment as an
argument.

**A write in an environment sends no engine-wide event.** The caches of
today are keyed on versions of shared definitions, and an inference write
advances them for the whole engine. A unit that infers again what an earlier
unit inferred would clear them at each boxing: with that event kept, the
loading of the integration rules was about 30% slower. The type of an
expression is cached on the expression; a cache shared between expressions
that depends on an inferred type has the environment in its key.

**`compile()`** refuses an input of type `unknown`, as today. The host
commits the inferred types with `ce.infer()` first when it wants them
(decision 4).

**Nothing is written at boxing.** A scope changes only by a declaration, an
assignment, a definition, or a commit.

## 3. What the other pieces become

- **Order independence.** Two units do not read each other's environment, so
  the result of boxing an expression does not depend on what was boxed
  before. `x(3)` after `x + 1` is the call `x(3)`.
- **Check on use.** A stored function body is a unit with stamps. There is no
  registry of waiting definitions, no repair at a definition, and no rule for
  "who can see this binding": the lookup from the unit's own scope answers.
- **`ce.infer(units)`**: the commit. It declares the free names of the units
  in the current scope, with the meet of the types their environments give,
  marked as inferred. Independent of the order. Two types that conflict give
  `unknown`.
- **A batch**: one unit for a set of definitions and readers (a document).
  Reading and typing run as one loop in dependency order inside it, so a
  reading that depends on a type (`L_1`, `(A, B)`) is decided with every
  definition of the set known. It returns one result per member, and at an
  edit the members whose stamps moved.
- **A program**: one unit for its statements, bound statement by statement in
  its own scope, as today. A statement reads what an earlier statement
  inferred, because they share one environment. The prototype gave each
  statement its own environment, and static diagnostics of Epsil that rely
  on a type from an earlier statement were lost (37 failing tests in
  `test/epsil/`): slice 1 must make the program unit, or leave programs as
  they are.
- **A macro**: a definition that keeps its raw body and is bound inside each
  unit that reads it, as a local of that unit
  (`2026-11-09-binding-a-set-of-definitions.md`, section 11).
- **A declared type is a contract; an inferred type never is.** A refused
  assignment reports its cause.

## 4. What is removed

The registry of waiting definitions, its weak references, the repair wave,
its cascade, guard and deferred queue, and the selection rule of CE-1102
(`provisional-application.ts`, `function-utils.ts`); the declaration of a
free name at boxing and the narrowing write on a host definition
(`BoxedSymbol._inferWithoutFacts()` for a host name,
`_inferOnOuterBinding()`); the capture of narrowings for an inspectable
scope; the rollback and checkpoint entries for those writes. In Tycho, by its
own estimate, the code for the order of registration (about a quarter of
what exists because of how the engine binds), and its scratch scopes and
parameter shadows; with the macro kind, about 3,100 lines of inlining.

## 5. What changes for a user (breaking)

1. `ce.parse('x + 1')` declares nothing. `ce.box('x').type` is `unknown`
   until `x` is declared, assigned, or committed with `ce.infer()`.
2. A reading does not depend on an earlier expression: `x(3)` after `x + 1`
   is a call.
3. An invalid stored body is reported when the function is used, not when
   the name it reads is defined.
4. `withValues()` accepts a name that a stored body applies.
5. `InspectableScope.narrowings()` has nothing to report.

Measured bounds, on the suite of about 81,000 tests
(`2026-11-09-binding-a-set-of-definitions.md`, section 7, and
`2026-11-09-inference-as-a-result.md`, "The result of step 1"):

| What an expression keeps of its own inferred types | Tests that change |
|---|---|
| everything, also in the expressions that its operations build | at most 0.31% |
| everything, but not in a symbol made from a name alone | between 0.31% and 0.74% |
| nothing (an undeclared name is `unknown` everywhere) | 2.6% in the third of the suite that ended, most of it compilation |

The model is the second row.

## 6. Not known

1. **The cost of reading a type through an environment.** About 125 sites
   read the type of a value definition without going through the symbol, and
   about 130 read whether it is inferred (text searches, estimates). On a
   Tycho sample they are 5% of 2.49 million type reads.
2. **How often an operation makes a symbol from a name alone**, and what is
   lost when it reads `unknown`. The bound is the difference between rows 1
   and 2 above.
3. **The memory of keeping a raw form** for each stored function body.
4. **The cost of the stamps**: one counter comparison per use of a stored
   body when no definition changed. On a Tycho sample, 6% of function bodies
   read a name that could change; whether a registration reads every body
   right after defining it was measured (80% are first read inside
   `ce.assign()`).
5. **Caches.** Today's caches are keyed on versions of shared definitions.
   A type that lives in an environment needs the environment in the key.

## 7. The prototype

Not to ship. It answers items 1, 2 and 5 of section 6 for the narrowest
slice that goes from end to end: **one host expression as a unit, with the
types of its free names in its environment**.

- In a worktree. Boxing an expression builds the environment AND makes
  today's writes (compare mode). Each read of the type of a free name with no
  explicit definition computes both answers and counts where they differ.
- Then a switch, off by default, that makes the environment the answer and
  stops the writes for such names.
- It reports: the read sites that had to change, by file; the number of
  differences in compare mode on the full suite and on Tycho's corpus sample;
  with the switch on, the failing tests grouped by cause (an approved
  behavior change of section 5, a symbol made from a name alone, a cache, a
  defect of the prototype); the time of the suite's slowest files and of a
  parse-and-simplify loop, on and off.
- It reuses the order-independence test of step 1
  (`2026-11-09-binding-units-evidence/inference-order-independence.test.ts.txt`).
- It stops and reports when it has these numbers, or when it finds that a
  part of section 2 cannot be built as written.

Approved or changed after the prototype: the model, and the order of the
slices of section 8.

## 8. The slices after the prototype

Each one is the final mechanism for its part, not a mechanism to replace
later.

How a slice proceeds:

1. A one-page spec (the rule, examples of input with the behavior today and
   under the proposal, the hard cases, what is left to later slices), with
   the measurements that the spec needs, reviewed with `/review-spec`. The
   code starts only after the user's approval of the spec.
2. After the approval, the implementation, by the ordinary rules of the
   repository (review, staging, CHANGELOG, the pages of
   `~/dev/cortexjs.io/docs/compute-engine/` for a breaking change).
3. The session that implements a slice adds to this section one paragraph
   with the result (the commit, what differs from the spec, the tests that
   changed) and marks the slice done.

The order of the slices is not approved yet (decision 3). A session takes
the next slice that is not marked done, and asks the user when the order
matters for its spec.

1. Host expressions as units (the prototype, finished): breaking changes 1,
   2 and 5; `ce.infer()`.
2. Stored function bodies as units, with stamps and check on use: breaking
   changes 3 and 4; the removal of the registry and the repair.
3. The batch: a set of definitions and readers as one unit, with Tycho's
   registration as the acceptance test.
4. The macro kind, with Tycho's four reference results as the acceptance
   test.
5. A refused assignment reports its cause.

## 9. Decisions

1. approved 2026-11-09: one model and a prototype; no further interim
   mechanism. Step 1 of `2026-11-09-inference-as-a-result.md` is not
   delivered and not fixed.
2. approved 2026-11-09: the prototype of section 7 as written, in a new
   session (the prompt is in section 10).
3. To decide after the prototype: the model of section 2, the breaking
   changes of section 5, and the order of section 8. The result of the
   prototype is in `2026-11-09-binding-units-evidence/prototype-report.md`;
   its section 6 lists what section 2 had to change. Section 2 was revised
   on 2026-11-09 with decisions 4 to 6. Still to decide: the breaking
   changes of section 5 and the order of section 8.
4. approved 2026-11-09: `compile()` gets no handling of its own for an input
   of type `unknown`, and no default type. It keeps the decline. A host that
   wants the types that its expressions infer calls `ce.infer(units)` before
   `compile()`: the names then have a definition with an inferred type, and
   every occurrence reads it. An input that no expression types (`x > 1`
   alone) still declines, as today. The examples and the limits are in
   section 9 of the prototype report.
5. approved 2026-11-09: a requirement of an expression built from boxed
   operands goes in the environment of the occurrence. The other options
   were a copy of each operand symbol at each construction, and an
   environment argument on every type read.
6. approved 2026-11-09: boxing declares nothing. A free name has no
   definition and is identified by its name and scope. The prototype did not
   build this (it kept a declaration with the type `unknown`), so its cost
   is not measured: the spec of slice 1 measures the sites that expect a
   definition on a canonical symbol before code.

Tycho is not blocked by any of this: its workarounds exist and work. Nothing
is shipped to it ahead of the slices.

## 10. The prompt for the prototype session

```
Build the prototype of section 7 of
docs/plans/2026-11-09-binding-units-model.md. Read that document in full
first; it is the plan of record and its sections 2, 6 and 7 are the brief.
The prototype is an experiment in a worktree: it is not delivered to the
main tree, nothing is staged, and no file of the main tree changes except
the report in step 5.

Scope: one host expression as a binding unit, with the types of its free
names (names with no explicit definition) in the environment of the unit.
Not in scope: stored function bodies, the registry of waiting definitions
(provisional-application.ts), the batch, the macro kind, ce.infer().

1. Compare mode. Boxing an outermost expression builds its environment AND
   makes the writes of today. Each read of the type of a free name with no
   explicit definition computes both answers and counts where they differ,
   by read site. The places to start from: the narrowing write in
   BoxedSymbol._inferWithoutFacts() and the getter BoxedSymbol.type
   (boxed-expression/boxed-symbol.ts); the getters type and declaredType
   and the field inferredType of the value definition
   (boxed-expression/boxed-value-definition.ts); the outermost boxing,
   EngineBoxingState.withRootRepair() and isPersistentScope()
   (engine-boxing-state.ts). An expression built from boxed operands gets an
   environment whose parents are theirs; a symbol that library code makes
   from a name alone has an empty environment.
2. A switch, off by default (an environment variable), that makes the
   environment the answer and stops the writes for such names.
3. Measure, with the switch off (compare mode) and on:
   - the full suite, in three Jest shards with `--reporters=default`, each
     under `timeout -k 30 600` and the box lock (the performance tests can
     exceed the limit under an experiment: report the files that did not
     end, do not wait for them);
   - Tycho's corpus sample and the parse-and-simplify loop: the two scripts
     and the module redirect are in
     docs/plans/2026-11-09-binding-units-evidence/ (`*.txt`: copy them to
     your scratchpad, remove the suffix, set the worktree path);
   - the order-independence test of the same folder, with the switch on.
4. Stop when you have the numbers, or when a part of section 2 of the model
   cannot be built as written. Do not fix the suite to green with the switch
   on: the failures are the result. Apply the stop rule for tool calls.
5. Report, in a new file
   docs/plans/2026-11-09-binding-units-evidence/prototype-report.md and in
   your final message:
   - the read sites that had to change, by file, and the sites you found
     that read a type or the inferred flag without a symbol at hand;
   - compare mode: the number of differences, by read site and by cause;
   - switch on: the failing tests grouped by cause (a breaking change of
     section 5 of the model; a symbol made from a name alone; a cache keyed
     on a shared definition; a defect of the prototype; other), with counts;
   - the timings, on and off, with the machine load;
   - what in section 2 of the model must change, and why;
   - the path of the worktree, its `git diff --stat`, and a patch of it saved
     beside the report. Leave the worktree in place.

Do not repeat the measurements that the model document cites, and do not
build a mechanism that hides a shared definition behind a second view: that
was tried (the patch in the evidence folder) and rejected.
```
