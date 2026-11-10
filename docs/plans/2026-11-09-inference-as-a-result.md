# The inferred type of a free name is a result, and a commit writes it

Status: Superseded as the plan of record by
`docs/plans/2026-11-09-binding-units-model.md` (2026-11-09). Kept for its
measurements. Earlier status: steps 1 and 2 approved 2026-11-09 (decisions 1 to 3 at the end).
Step 1 was implemented in a worktree and reviewed on 2026-11-09; it is NOT
delivered, and the design of step 1 waits for a new decision ("The result
of step 1", at the end). Step 3 (the record) is not approved.

## The problem

Boxing an expression writes to the scope of the host. A name with no
definition is declared there, and each use narrows its type on that shared
definition (`BoxedSymbol._inferWithoutFacts()`,
`boxed-expression/boxed-symbol.ts`). The next expression is boxed against
what the earlier ones wrote.

```
ce.parse('x + 1')      // declares x in the current scope, type number
ce.parse('x(3)')       // today: 3x, because x is a number now
```

In the other order, `x(3)` is a call. So the result of boxing an expression
depends on which expressions were boxed before it, also expressions that the
host only analyzed and threw away.

Measured (`docs/plans/2026-11-09-binding-a-set-of-definitions.md`, section
7): on 98 documents of Tycho, 2,779 of 4,472 type writes made while boxing
land on a name of a scope that existed before the expression. Tycho ranks
this write as its first class of defects, and works around it with scratch
scopes, parameter shadows and a reset of the narrowings that
`InspectableScope.narrowings()` reports. In the engine's suite, at most 250
of 81,322 tests (0.31%) depend on a type that an earlier expression
inferred.

## The contract

1. **Boxing writes nothing to a scope that existed before it.** After
   `ce.parse('x + 1')`, with `x` not declared, `ce.lookupDefinition('x')` is
   `undefined` and no later boxing is affected.
2. **An expression keeps the types it inferred.** `x + 1` knows that it
   requires `x: number`. Its own validation, type, simplification,
   evaluation and compilation use that, as today.
3. **A name with no definition is the same symbol in every expression of a
   scope.** `ce.parse('x').sub(ce.parse('x'))` is `0`. Only the inferred
   type is per expression.
4. **A definition made later is seen.** After `ce.assign('x', 5)` or
   `ce.declare('x', 'integer')`, an expression boxed before reads that
   definition, and its own inferred type for `x` no longer applies.
5. **A commit writes the inferred types.** `ce.infer(expressions)` declares
   each undeclared free name of the expressions in the current scope, with
   the type that their evidence gives together, marked as inferred. The
   result does not depend on the order of the expressions. A program (an
   Epsil program, a `Block` that the host evaluates as a program) commits as
   it does today, statement by statement, in its own scope.

A declared type stays a contract. An inferred type, committed or not, is
never one: it does not refuse an assignment.

## The model

- **The evidence record.** Each outermost boxing has one record: a map from
  a free name with no definition to the type that the uses in this
  expression require. The narrowing rules are those of today; they write to
  the record, not to a definition.
- **The symbol.** An occurrence of such a name is bound to a placeholder of
  that name (one per name and scope, in no scope's bindings, so that lookup
  does not find it), and holds a reference to the record of its boxing. Its
  type is the type in the record. A sub-expression taken out of the
  expression keeps the reference.
- **Expressions made from expressions.** A boxing that receives boxed
  operands starts its record from theirs: for each name, the narrowing of
  the types they give, and no type when they conflict. The expressions that
  an evaluation, a simplification or a compilation of `E` builds use the
  record of `E`, which is in force for the length of that operation.
- **A later definition.** The engine counts the definition changes of each
  name (the per-name counter of
  `docs/plans/2026-11-09-function-readings-checked-on-use.md`). A symbol
  bound to a placeholder reads the counter before it answers; when it moved,
  the symbol looks the name up again from the scope it was boxed in.
- **What stays as it is.** A parameter, a local and the variable of a binder
  are declared in a scope that the expression creates; inference writes
  there as today (1,693 of the 4,472 writes of the sample).

The structure of an expression boxed before a definition can be out of date
after it (`x(3)` read as a call, then `x := 5`). That is so today, and it is
the subject of the other plan, not of this one.

## What changes for a user (breaking)

1. `ce.parse('x + 1')` no longer declares `x`. `ce.box('x').type` is
   `unknown` until `x` is declared, assigned, or committed with
   `ce.infer()`.
2. A reading no longer depends on an earlier expression: `x(3)` after
   `x + 1` is the call `x(3)`. To get the product, declare `x` or commit.
3. `InspectableScope.narrowings()` reports nothing for a boxing in the
   scope, because nothing is narrowed outside. It stays for one release,
   empty, then goes.

## What is removed

The write of a narrowing on the outer binding of a free name of a function
literal (`_inferOnOuterBinding()`) and the rebuild it requests; the capture
of narrowings for an inspectable scope; the rollback journal entries for a
type write on a host name (a record is dropped with its expression). The
resolve-only region (`ce._resolveOnly()`) keeps its other purpose (no
declaration for a partial canonical form).

## Results of step 0 (2026-11-09)

The two inventories are text searches by sub-agents, not reference searches;
their counts are estimates. The run-time counts are from counters in a
temporary worktree at `7520d089c99f414c1c0e479871177ddcaa7bf6ed`, on the
Tycho sample (98 Neyret states, two registrations each).

**Reads that do not go through the symbol.** About 125 sites read the type of
a value definition taken from a scope lookup or from a symbol's definition,
and about 130 read whether the type is inferred (to skip an argument check,
or to treat the name as a free variable); 16 sites write the type. At run
time, of 2.49 million reads of the type of a value definition, 1.95 million
go through `BoxedSymbol.type`, and 124,000 are direct reads of an inferred
type. So about 250 sites need a review, for about 5% of the reads. With a
placeholder that no lookup finds, each site that looks a name up takes its
"no definition" branch, and each must be checked for that.

**The record in force during an operation has no single place.** About 38
public operations build expressions from an expression: `evaluate`,
`evaluateAsync`, `simplify`, `solve`, `subs`, `replace`, the arithmetic
methods (`add`, `mul`, `neg`, …), the lazy getters (`canonical`, `type`,
`value`), `compile`, `expand`, `factor`. They share no funnel:
`withRootRepair()` sees only a boxing, and `evaluate` has one implementation
per class. An asynchronous operation would also need the record saved and
restored around each `await`. This part of the model is not acceptable as
written: it is a list of entry points that must stay complete.

**The order of the narrowing.** The rule is the meet of the two types, with
one exception for a scalar use under an operator that maps, followed by a
collection use (`narrowInferredType()`); the comment says the other order
gives the same type, through `excludedFromScalarInference()`
(`validate.ts`). A merge of records can therefore be independent of the
order. Not proved: a property test belongs to step 1.

**The cost of the check.** 303,000 of 2.06 million type reads through a
symbol (15%) are for a host name whose type is inferred or unknown. Only
those would read the counter.

## The model, revised after step 0

The contract stays. Two changes to the model:

1. **No record "in force".** A record is reached only through a symbol
   occurrence. An expression built from boxed operands starts from their
   records. A symbol that library code makes from a name alone, during an
   operation, has no inferred type: it reads `unknown`, which is the
   conservative answer (a rule that needs `x: number` does not apply; no rule
   applies wrongly). The census bounds the effect: between experiment 3 (250
   tests) and experiment 2 (599 tests).
2. **A first version that writes, but hides.** Before the record exists, the
   engine can give most of the contract with a small change, which is what
   experiment 3 of the census emulated:
   - the inferred type stays on the shared definition, as a set of the
     requirements seen, one per expression that used the name;
   - a boxing that the host starts reads the declared type of a host name
     only, and adds its own requirement at its end;
   - the type that the definition reports is the meet of the set, and
     `unknown` when two requirements conflict (`x + 1` and `x(3)`);
   - an inferred type never refuses an assignment.

   This gives contracts 2 to 5 and the order independence of contract 1. It
   does not give "nothing is written": after `ce.parse('x + 1')`, `x` is
   still declared, with the type `number`. A host that analyzes an
   expression and throws it away leaves a requirement behind; a call that
   boxes without recording one (the existing resolve-only region, made
   public) covers that case.

The first version is small (the write site, the boxing root, the type
getter of a value definition). The record is the larger change (about 250
sites to review) and can follow if "nothing is written" proves necessary.

## Steps

0. Done: see "Results of step 0".
1. The first version (the definition keeps a set of requirements; a boxing
   that the host starts reads declared types only): implement it, run the
   full suite and Tycho's corpus audit, report the tests that change against
   the bound of the census (250), and the property test of the order.
2. A public call that boxes without recording a requirement. Tycho reports
   which scratch scopes and shadows it can remove.
3. Only if "nothing is written" is still needed after step 2: the record,
   the placeholder and `ce.infer()`, with a compare run before the switch,
   and the removals above. `CHANGELOG.md`, "Breaking Changes"; the
   guides of cortexjs.io that show a type after a parse.
4. `docs/TYPE-SYSTEM.md` ("Inference provenance and rollback"),
   `docs/SCOPING-MODEL.md` (a section for a name with no definition).

## Done when

- The full suite passes; the tests changed for breaking changes 1 and 2 are
  counted in the report (the census bounds them at 250).
- Step 1: the result of boxing an expression is the same whatever was
  boxed before it in the scope (a property test over pairs of expressions
  of the suite, in both orders).
- Step 3 only: boxing any expression of the suite leaves the bindings and
  the types of the scopes that existed before it unchanged (an assertion in
  the test environment, on for the full suite).
- Tycho's corpus audit gives the same values, and Tycho reports which
  scratch scopes it removed.

## Decisions

1. approved 2026-11-09: **start with the first version** ("writes, but
   hides", step 1). `ce.parse('x + 1')`, then `ce.parse('x(3)')`: the second
   is the call `x(3)`, in both orders, and `x` is still declared after the
   first parse.
2. approved 2026-11-09: **two requirements that conflict give the name the
   type `unknown`.** After `x + 1` and `x(3)`, `ce.box('x').type` is
   `unknown`.
3. approved 2026-11-09: **a public way to box without leaving a
   requirement** (step 2), and `ce.infer()` later, with the record (step 3).

## The result of step 1 (2026-11-09)

An implementer built step 1 in the worktree `/tmp/wt-ce42-infer1` (base
`a9e36bada97cc1d91448a9daf51915aa95f2d6d5`): 827 lines added in 8 source
files and 19 test files. The full suite passes there (81,394 tests), after
three full runs of which the first two found defects of the implementation.
A test boxes 46 pairs of expressions in both orders with the same results.
Timing by the CE session: no difference on Tycho's registration; a loop of
20,000 parses with undeclared names, each simplified, is 8 to 21% slower
(under load, an estimate).

The dual review (Claude and Codex) found 14 defects, 3 of them high:

- The view that a host boxing has of a name hides the type but not the
  `inferredType` flag: after `ce.declare('k', 'unknown')`, `ce.parse('k(2)')`
  is a product the first time and a call the second time (both reviewers).
- A read of a name during a host boxing advances its write version, and a
  lazy collection that depends on the name computes again, so a random `Map`
  draws again (Codex).
- A narrowing made outside a host boxing writes the definition and drops the
  set of requirements, so the order dependence comes back (Claude, not
  traced by a test).

No fix was applied. The three have one cause: "writes, but hides" shows a
second view of one shared definition, and a definition is read through more
than its type (the inferred flag, the write version, the caches keyed on it,
the provenance). Each needs its own hidden view. The spec said this version
was small; that was wrong.

**One more measurement: no inference on a host name at all.** In a worktree
where boxing never writes an inferred type on a host name, one third of the
suite ended: 641 of 24,959 tests fail (2.6%); 366 files fail over the three
shards before the time limit. 826 of the failure messages are the refusal of
a compilation ("the input has no type"), 112 of the failing files are
compile tests; the others are evaluations and simplifications that need the
type of an undeclared name.
