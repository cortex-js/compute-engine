# Slice 1 of binding units: host expressions as units, and `ce.infer()`

Status: revision 3, approved 2026-11-10. The implementation may start, with
step 1 of section 6 first. The plan
of record is `docs/plans/2026-11-09-binding-units-model.md` (sections 2, 8
and 9). This spec is slice 1 of its section 8. Decisions 4, 5 and 6 of its
section 9 are approved and are not reopened here. An approval of this spec
also approves these items of decision 3:

- breaking changes 1, 2 and 5 of section 5 of the model;
- the added changes of section 5 below;
- slice 1 as the first slice;
- the changes to the model that section 8 below lists.

Approved 2026-11-10: option (b) for checkpoints. They are deprecated in
slice 1 and removed after Tycho's move (rule 13).

Reviews: two rounds of `/review-spec` (Claude and Codex), on revisions 1 and
2. The findings of round 1 are in
`docs/scratch/BINDING_UNITS_SLICE_1_SPEC_REVIEW.md`. Revision 3 applies the
findings of round 2 and was not reviewed again.

## 1. The rule

**Units, free names and type reads**

1. **Boxing writes no definition.** `ce.parse()`, `ce.box()`, `ce.expr()`
   and `ce.function()` declare no name, and they do not narrow, widen or
   mark an existing definition. This includes a definition that is inferred
   or of type `unknown`.

   A name that has no definition when it is boxed becomes a **free name**: a
   canonical symbol with no definition. It keeps its name and its **home
   scope**. The home scope is the first scope up the chain that existed
   before the boxing and is not `noAutoDeclare`. For the free name `y` of
   the body of a function literal, this is the scope that the literal is
   written in. Today `_inferOnOuterBinding()` declares such a name there.

   For a free name:
   - `isCanonical` is true;
   - `valueDefinition` and `operatorDefinition` are `undefined`;
   - `ce.lookupDefinition(name)` is `undefined` until the name is declared;
   - `isFreeName(expr)` is true. This predicate gives the kind of the
     occurrence, and it stays true after a later declaration.
2. **One outermost boxing is one unit, with one environment.** Each symbol
   that the boxing makes keeps a reference to it. A use of a name puts a
   requirement on it (`x + 1` requires `number`). When the name has no
   explicit type, the requirement is written in the environment, under the
   key (home scope, name), with today's narrowing (`narrowInferredType()`).
   A name has no explicit type in three cases: it has no definition, its
   definition is inferred, or its definition has the type `unknown`.

   These readings also go in the environment and not on a scope:
   - the variable that today's boxing declares for a library name used as a
     value (`N` in `N + 1`);
   - the `function` reading of a call head (`f` in `f(x)`);
   - the declaration of the free name of a function literal's body (`y` in
     `x ↦ x + y`), under its home scope of rule 1.

   A `ce.function()` call with at least one boxed operand is not a new unit:
   - each symbol that it makes in place of an existing occurrence (a binder
     that boxes its body again) takes the environment of that occurrence;
   - each other symbol that it makes takes the environment of its first
     boxed operand.

   A `ce.function()` call whose operands are all raw is a unit.
3. **Resolution.** For a type read, an evaluation, a compilation and a
   comparison, the definition of an occurrence of a name is found when the
   read happens:
   - It is the definition that `bindingInContext()` finds from the current
     context. That is today's resolution of a directly evaluated expression
     (`docs/SCOPING-MODEL.md`, "a directly evaluated expression reads the
     environment it is evaluated in").
   - For a free name, the resolution skips the variables of binders, because
     a free name was not inside a binder when it was boxed.
   - It also skips a library operator, for a name that the unit reads as a
     variable (rule 2, `N`).
4. **The type of an occurrence** whose resolved definition is absent,
   inferred or of type `unknown`, in this order:
   1. the type of the resolved definition, when that definition has an
      explicit type (in that case rule 4 does not apply);
   2. the meet of the type of the resolved definition and the entry of the
      environment, when the definition is inferred or of type `unknown`.
      When this meet is `never`, the type is the type of the definition.
      A definition is made by an assignment, an assumption or a commit, and
      evaluation reads that definition, so its type wins;
   3. the entry of the environment, when there is no definition;
   4. `unknown`.

   This applies to every occurrence of this kind, a free name or not: an
   `x` boxed after `ce.declare('x', 'unknown')` or after `ce.infer()` reads
   it too. The facts of assumptions are merged in, as today.

   A type cached on an expression keeps these items, and it is computed again
   when one of them changed:
   - the counter of each name that it resolved (model, section 2);
   - the counter of each environment that it read;
   - the current lexical scope at the time of the read.

   A pushed or popped scope therefore gives a new read.
5. **Evaluation.** A free name evaluates through its resolved definition. With
   no definition, or with a library operator skipped by rule 3, it stays
   symbolic. `a = ce.parse('x + 1'); ce.assign('x', 3); a.evaluate()` gives
   `4`, as today.
6. **Expressions built from boxed operands** (`ce.function('Add', [a, 1])`)
   write a requirement in the environment of the occurrence (decision 5).
   Inside an operation, rule 8 applies instead. An environment gains
   requirements and never loses one, except by an undo (rule 13).
7. **A free name is not an unbound symbol.** Today, "a symbol with no
   definition" means a raw symbol, a binding site or an operator name. Every
   site that reads it that way tests `isFreeName()` first:
   - `sameBinding()` (`compare.ts`): two occurrences are the same binding
     when both resolve (rule 3) to the same definition. When neither
     resolves, they are the same binding when both are free names with the
     same (home scope, name). A free name is never the variable of a binder.
     `isSame()` keeps its properties of an equivalence
     (`docs/SCOPING-MODEL.md`, "Symbol identity").
   - "No value definition" read as "an operator name": 53 sites in 26
     files.
   - "No operator definition" read as "not a function": 47 sites in 27
     files.
   - `valueDefinition?.inferredType` read as "an undeclared name": 41 sites
     in 15 files. These sites test `isFreeName()` or an inferred definition.
   - The 14 getters of `BoxedSymbol` that assume `_def` (`value`, `sgn`,
     `isOdd`, `isEven`, `re`, `im`, `bignumRe`, `bignumIm`, …) answer
     through the resolved definition. With none, they give what a valueless
     symbol of type `unknown` gives today.
   - The setters `value` and `type` on a free name are host writes: they
     declare the name in its home scope, as `ce.assign()` and `ce.declare()`
     do, and are journaled like them. Today `ce.box('w').value = 3` declares
     `w`; that stays the same.

**Operations**

8. **An operation has an environment of its own.** An operation is each
   public method of an expression that runs library code on its receiver:
   `evaluate()`, `N()`, `simplify()`, `expand()`, `factor()`, `subs()`,
   `replace()`, `match()`, `solve()`, `isEqual()` and `compile()`, and their
   async forms. The getters that only read (`sgn`, `isPositive`, …) are not
   operations. An operation opens an operation environment. Its parents are
   the environments of the occurrences of its input, which can be several
   units (decision 5).
   - **Who reads it.** Every occurrence that the operation reads, its input
     included, reads the operation environment first and then its own
     environment. Every symbol that the operation makes belongs to it,
     whether made by `ce.symbol()`, `ce.box()`, `ce.parse()` or
     `ce.function()`. A boxing that starts inside an operation joins it and
     does not start a unit.
   - **Lookup.** A read takes the entry of the operation environment for the
     name, when one exists. Otherwise, from each parent, it takes the entry
     for the name whose home scope is the home scope of the symbol, or the
     nearest ancestor of that scope that a parent holds. It meets those
     entries. When that meet is `never`, the read gives `unknown`. A symbol
     made inside a scope that the operation pushed therefore still finds the
     entry of its input.
   - **Writes.** A write goes to the operation environment only, also for an
     expression built from the input's operands (rule 6). An operation does
     not narrow the environment of the host's expression.
   - **Nesting.** Nested operations form a stack, which is restored on exit,
     also on a throw.
   - **Async.** An async operation captures its environment when it starts
     and carries it in its evaluation context. Each synchronous segment
     installs the environment and restores the previous one. The
     environment is never left installed across an `await`
     (`docs/EFFECTS-MODEL.md`).
   - **The result.** The symbols of the result keep the operation
     environment, with its parents. A later expression built from the
     result writes in it (rule 6). `ce.infer()` reads it through the chain
     (rule 11).
   - **`compile()`** gives each input the meet of the types that its
     occurrences report. When that meet is `never`, the compilation declines
     with `untyped-input`.
9. **No engine-wide event for a write in an environment.** An environment
   has a counter, which moves at each write. A cache shared between
   expressions that depends on the type of a free name has (environment,
   counter) in its key. The known caches are these:
   - the memo of merged facts on the value definition;
   - `compiledProbe()` (`symbolic/limit.ts`);
   - `opaqueSymbolDefinition()` (`compilation/cse.ts`).

   The implementation lists the others that it finds.
10. **Programs.** An Epsil run and an Epsil static check open one program
    environment for their dynamic extent. It is the bottom of the stack of
    rule 8.
    - Every outermost boxing during the extent (each `ce.box(stmt)`,
      `execute-epsil.ts:644`) joins it.
    - The evaluation of a statement, started by the run driver, writes in
      the program environment, so a later statement reads what an earlier
      statement required, also during its evaluation.
    - The operations that library code starts inside that evaluation write
      in their own environments (rule 8).
    - The pins of the static check that are keyed on a value definition
      (`static-diagnostics.ts:741, 2254`) are keyed on (home scope, name)
      for a free name.
    - The program environment is discarded when the run ends.

    A host `Block` boxed with one `ce.box()` is already one unit (rule 2).

**Commits and state**

11. **`ce.infer(exprs: ReadonlyArray<Expression>): InferResult`.**
    - For each key (home scope, name) in the environments of the occurrences
      of `exprs`, it collects the meet of their entries, through the
      environment chain of each occurrence (the parents of rule 8 included).
      The order of `exprs` does not change the result.
    - It computes the candidate type: that meet, met with the type of an
      inferred definition that the key's home scope already holds.
    - It declares the name in its home scope, marked as inferred, or narrows
      the inferred definition there to the candidate, when all of these
      hold:
      - the home scope is the current scope or an ancestor of it;
      - the name has no explicit definition in its home scope;
      - the candidate is neither `never` (a conflict) nor `unknown`.
    - Otherwise it changes nothing and reports the reason.
    - The library variables and call-head readings of rule 2 are committed
      in the same way: `N` as a variable that shadows the library `N` in that
      scope, and `f` with its function type.
    - The result is
      `type InferResult = { declared: { name: string; scope: Scope; type: Type }[]; skipped: { name: string; scope: Scope; reason: 'conflict' | 'untyped' | 'defined' | 'out-of-scope' }[] }`.
      It is sorted by name, then by the depth of the scope.
    - After a skip for a conflict, each expression keeps the type of its own
      unit (rule 4).
12. **`ce.assume()` keeps declaring the names it constrains.** It is a host
    statement, not a boxing.
13. **Trials, rollback frames and checkpoints.**
    - **Trials.** A trial runs in an environment that is thrown away when it
      ends, not under a rollback frame. There are two trials: the admission
      of an overloaded operator (`validate.ts:4407`) and the Epsil static
      check (`static-diagnostics.ts:634`). The declarations that the static
      check makes are in its own pushed scope, which the pop removes. A
      rollback frame journals no write in an environment. The frames stay
      in slice 1 only for the registry of waiting definitions, and are
      removed with it in slice 2.
    - **Checkpoints are deprecated.** `ce.checkpoint()`, `ce.restore()` and
      `ce.discard()` keep working in slice 1 and are marked deprecated in
      their documentation and in `CHANGELOG.md`, with `ce.withValues()` and
      `pushScope()`/`popScope()` named as the replacements. A write in an
      environment is not journaled, so a `restore()` does not undo a
      requirement written after the checkpoint on an expression boxed before
      it. `docs/CHECKPOINT-MODEL.md` states this limit with that example.
    - Tycho, the only known host that calls a checkpoint, moves its one use
      (`withValuesHidden()`, `src/plot-core/ce-module-registry.ts:947`) to
      `ce.withValues()`. Tycho checked that move on CE 0.185.1. The two
      uses inside CE, which make a library registration all-or-nothing
      (`group-theory.ts:1120`, `engine-library-bootstrap.ts:277`), check
      their input before they declare anything. The API is removed in a later
      release, after Tycho's move. That removal is not part of slice 1.
      Tycho made the move in its working tree on 2026-11-10; it is not
      committed. The removal also removes the internal
      `_restoreCheckpointSnapshot()`. Two Tycho tests inject a restore
      failure through it, so the release notes of the removal tell Tycho.
    - `ce.infer()` is a declaration. A checkpoint journals it, as it journals
      any declaration, while the API exists.
14. **Stored function bodies are not changed in slice 1.** The body given to
    `ce.assign()` or `ce.declare()` is boxed under rule 1, so its free names
    are free names. The registry of waiting definitions and its repair
    (`provisional-application.ts`) keep working on the definitions that a
    later declaration makes. The measurement of section 3 does not show that
    they do; it shows only that the registry tests that it ran pass. Step 1
    of section 6 checks it first.

## 2. Examples

Rows marked † differ from today. The "today" column was checked on the
current source.

| Host code | Today | Under slice 1 |
|---|---|---|
| `ce.parse('x + 1'); ce.lookupDefinition('x')` | a definition: `number`, inferred | † `undefined` |
| `ce.parse('x + 1'); ce.box('x').type` | `number` | † `unknown` |
| `a = ce.parse('x + 1'); a.op1.type` | `number` | `number` (its own unit) |
| `ce.parse('x + 1'); ce.parse('x(3)').json` | `["Multiply", 3, "x"]` | † the call `["x", 3]` |
| `a = ce.parse('x + 1'); ce.assign('x', 3); a.evaluate()` | `4` | `4` |
| `a = ce.parse('x + 1'); ce.pushScope(); ce.assign('x', 3); a.evaluate()` | `4` | `4` (rule 3) |
| `a = ce.parse('x + 1'); ce.declare('x', 'string'); a.op1.type` | `number` | † `string`: the definition is explicit (rule 4) |
| `a = ce.parse('x + 1'); ce.assign('x', ce.string('ab')); a.op1.type` | `string` (evaluation: an `incompatible-type` error) | `string` (rule 4: the meet is `never`, the definition wins) |
| `a = parse('x + 1'); b = parse('x > 1'); compile(b)` | compiles | † declines; after `ce.infer([a, b])` it compiles (`x: number`) |
| `a = parse('x + 1'); c = parse('x(3)'); ce.infer([a, c])` | depends on the order of the parses | `x` skipped as a conflict; `compile(a)` compiles with `x: number` |
| `ce.infer([a]); ce.infer([c])`, same `a` and `c` | | the second call skips `x` as a conflict; `x` stays `number` |
| `compile(ce.box(['D', ['Arctan2', 'y', 'x'], 'x']))` | compiles | compiles (rule 8) |
| `compile(ce.parse('x + 1').simplify())` | compiles | compiles (rule 8, the result) |
| `ce.assign('a', ce.parse('n + 1'))`, then `Apply((n) ↦ Σ_{n=1}^{3} a, 5)` | `3n + 3` | `3n + 3` (rule 7) |
| `ce.parse('N + 1').evaluate()`, `.N()` | `N + 1`, `N` a declared variable | `N + 1`, `N` a free name read as a variable |
| `compile(ce.parse('N + 1'))` | compiles (`_.N + 1`) | † declines (`N` has no type) until `ce.infer()` or a declaration |
| `ce.box('w').value = 3; ce.box('w').evaluate()` | `3` | `3` (rule 7) |

## 3. The cost of decision 6, measured

Measured in the worktree of the prototype (`/tmp/wt-compute-engine-1c`),
with the prototype switch on (`CE_BINDING_UNITS=1`) and a new flag
`CE_BU_NODEF=1`. The flag applies rule 1 to a free name in a scope that
existed before the boxing. It applies rules 2 and 5 in part, and does not
apply rules 3, 4 and 6 to 14. The numbers are therefore a lower bound for
rule 1 and an upper bound for what rules 7 and 8 must repair. The patch is
`docs/plans/2026-11-09-binding-units-evidence/prototype-nodef.patch.txt`.

**Sites that expect a definition on a canonical symbol** (text and syntax
searches over `src/`, tests excluded; counts of lines):

| What | Sites | Files |
|---|---|---|
| `this._def!` in `BoxedSymbol` | 14 | 1 |
| other `!` on a definition (`validate.ts:2967`, `compile-user-functions.ts:951`) | 2 | 2 |
| "no value definition" read as "an operator name" or "not a variable" | 53 | 26 |
| "no operator definition" read as "not a function" | 47 | 27 |
| `valueDefinition?.inferredType` read as "an undeclared name" | 41 | 15 |
| walks of `scope.bindings` that list or test names (inspection, `narrowings()`, hoisting with `bindings.has()`) | about 60 | 20 |
| `isCanonical` on any expression, not classified | 242 | |
| `ce.lookupDefinition()` callers, not classified | about 190 | 150 |

**Tests**, full suite in three shards, 1,971 files, about 81,400 tests:

| | Failing tests |
|---|---|
| switch on, a free name keeps a definition (prototype report, section 4) | 523 (0.64%) |
| switch on and `CE_BU_NODEF=1` | 2,754 (3.4%) |
| of which not failing in the line above | 2,257, in 358 files |
| of the 523, now passing | 26 (`ce-601` among them, section 4) |

Also with the flag, 4 files fail to load. In 3 of them a compilation at the
top of the file declines; the fourth, `dag-shared-walks.test.ts`, runs out of
memory. 2 files do not end in 150 s (`find-fit-pool`,
`find-fit-global-grid`). With the switch on alone, they end in 8 s and 6 s.

The new failures by cause. The groups come from the failure messages, are
approximate, and were not checked test by test:

| Tests | Cause | Rule |
|---|---|---|
| 1,290 | A compilation declines: 631 with "the input has no type"; the others as `success` false, no `run`, or `NaN`. Traced example: the compiler makes `y` from its name (`compile-admission.ts:181`) for the result of `D`, in no unit. | 8 |
| 182 | A free name read as a function name: `(x^1)^3` reports `x ∈ function ∉ number` (181 of them in `simplify.test.ts`). | 7 |
| 136 | Epsil, mostly compilation declines inside a program. | 10 |
| not counted | **A wrong value** (the capture row of section 2). `sameBinding()` (`compare.ts:84-92`) reads "no definition" as "the variable of the enclosing binder". | 7 |
| about 650 | Other messages, not analyzed. | |

## 4. The hard cases

1. **The program unit of Epsil:** rule 10. With one environment per
   statement, 37 Epsil tests failed (prototype report, section 10).
2. **Rollback and checkpoint:** rule 13. Option (b), the deprecation of
   checkpoints, was approved 2026-11-10. Tycho's answer (session
   `tycho-desk`, 2026-11-10):
   - Its only checkpoint use can move to `ce.withValues()`.
   - It uses no checkpoint for edits or undo. Undo is done by Yjs, and a
     registration pass uses a scope.
   - It relies on no rollback of inference.
3. **Caches with no engine-wide event:** rule 9. In the prototype, the
   inference event was sent at each write in an environment. With it,
   `integration-rules` and `rubi-utils` were about 40% slower; without it,
   they were as fast as today (prototype report, section 5).
4. **The two failures that section 10 of the prototype report did not
   explain:**
   - **A type with a fact.** `complex & !0 | infinity` was expected and
     `number` received (5 tests in `internals/`, 1 in `fact-store-phase2`).
     The test reads `ce.expr('tau').type`, which is a new unit that does not
     use `tau` under `Imaginary`. Its type comes only from the assumption.
     This is breaking change 1. The tests read the type on the expression
     that uses `tau`.
   - **`ce-601-shared-evaluation.test.ts`.** 132 compiles of a probe, where
     fewer than 20 are expected. The inference event is not the cause: there
     are also 132 with `CE_BU_NO_EVENT=1`. With the switch on, the free `x`
     keeps a shared definition of type `unknown`, which counts as possibly
     callable. Each probe declares its own parameter `x`. That declaration
     "shadows a callable", so it moves the engine-wide definition version,
     which is in the key of the probe cache (`compiledProbe()`). The trace
     shows 132 such declarations with the switch on, and none with it off.
     With `CE_BU_NODEF=1` the free `x` has no definition, so the
     declaration shadows nothing, and the test passes.

## 5. Breaking changes

These are the changes of section 5 of the model, as they apply to slice 1:

- Change 1: boxing declares nothing.
- Change 2: a reading does not depend on an earlier expression.
- Change 5: `narrowings()` has nothing to report.

Decision 6 adds four more:

- `ce.lookupDefinition(name)`, `expr.valueDefinition` and the inspection of
  a scope do not see a name that was only boxed.
- An expression held by the host reads a later explicit declaration of a
  free name (the `string` row of section 2).
- A held expression is not narrowed by an operation on it (rule 8).
- A library name read as a variable (`N` in `N + 1`) has no type until it is
  declared or committed. Its compilation declines.
- `ce.checkpoint()`, `ce.restore()` and `ce.discard()` are deprecated
  (rule 13). A `restore()` does not undo a requirement that was written in
  an environment after the checkpoint.

Updated with the code:

- `CHANGELOG.md`;
- the pages of `~/dev/cortexjs.io/docs/compute-engine/` that show
  auto-declaration or inferred types;
- `ARCHITECTURE.md` (a call or a product, decided from an inferred
  `unknown`);
- `docs/COMPILATION-MODEL.md` (an input typed from its uses; `ce.infer()`
  before `compile()`);
- `docs/TYPE-SYSTEM.md`;
- `docs/SCOPING-MODEL.md` (free names, resolution, identity);
- `docs/CHECKPOINT-MODEL.md` (the deprecation, the replacements, and the
  limit of rule 13).

## 6. Acceptance

1. **First step of the implementation, with a stop condition.** Before the
   other rules, the implementation does three things:
   - find the causes of the hang (`find-fit-pool`, `find-fit-global-grid`)
     and of the out-of-memory failure (`dag-shared-walks`);
   - list the entry points of `provisional-application.ts` that read a
     definition of a free head, and say what each one does under rule 1;
   - run the tests of stored bodies under rule 1.

   If a cause is a loop that these rules do not prevent, or if the registry
   needs a declaration step, it stops and reports to the user.
2. Each row of section 2 is a test.
3. The order-independence test of the evidence folder (15 tests) passes,
   with these changes:
   - its helper `typeOf()` reads the type on an occurrence of the parsed
     expression, not on `ce.box(name)`, which is a new unit;
   - the test "the name stays declared after the first parse" asserts
     `undefined`;
   - the tests that assert `unknown` for a conflict are kept.

   The order cases `N(2.3)` after `x + N`, `a(2)` after `Integrate(a t, t)`
   and `y(2)` after `x ↦ x + y` pass. The result paragraph lists each
   assertion that changed.
4. `ce-601` passes, and the capture example of section 2 passes.
5. A test for each cache of rule 9: it reads a type, writes a requirement in
   the environment, and reads again. Also a read before a declaration in a
   pushed scope, during it, and after the pop.
6. Tests of rule 8:
   - two units whose environments disagree, in two async operations that
     interleave on one engine;
   - an operation that builds `Sqrt(a.op1)` inside, after which `a.op1.type`
     is unchanged;
   - a name boxed again in a scope that `compile()` pushed.
7. Tests of rule 13:
   - a trial (an overloaded operator with two arms; an Epsil static check)
     leaves no entry in any environment and no declaration;
   - the two library registrations still undo a partial registration when
     their input is refused, with no checkpoint.
8. An Epsil test in which statement 2 relies on a type that is required
   only while statement 1 is evaluated.
9. The full suite is green. Each test changed for a breaking change of
   section 5 is listed, by change, in the result paragraph.
10. Timing, under the box lock: the six slow files and the
    parse-and-simplify loop of the prototype report, section 5, within the
    spread of today's tree.

## 7. Left to slices 2 to 5

- Slice 2: a stored function body as a unit with stamps; the removal of the
  registry and its repair (`provisional-application.ts`); breaking changes 3
  and 4.
- Slice 3: the batch.
- Slice 4: the macro kind.
- Slice 5: a refused assignment reports its cause.

## 8. Changes to the model, made at approval

- Section 2, the sentence "A symbol that library code makes from a name
  alone has an empty environment". New text: such a symbol belongs to the
  operation that makes it (rule 8), or has an empty environment outside any
  operation.
- Section 2, the sentence "with that event kept, the loading of the
  integration rules was about 30% slower". New text: the two rule-heavy test
  files were about 40% slower (prototype report, section 5).
- Section 2, the free name of a function body: its home scope is the scope
  that the literal is written in (rule 1).
- Section 5, the sentence "The model is the second row". Rule 8 changes it.
  The bound of that row was measured without rule 8 and does not apply.
- Section 3, `ce.infer()`, "Two types that conflict give `unknown`". New
  text: they are not declared (rule 11). Also, the names are declared in
  their home scope, not in the current scope. Row 3 of section 9 of the
  prototype report becomes: `compile(a)` compiles.

## 9. Questions for the user

Section 1 follows each recommendation below. If a question is not answered,
the implementation follows the recommendation.

1. **Rule 4: an explicit declaration made after the boxing.** In
   `a = ce.parse('x + 1'); ce.declare('x', 'string')`, what is
   `a.op1.type`?
   - Recommended: `string`. Every definition that the resolution finds is
     read the same way. Decision 4 already requires this for the inferred
     definition that `ce.infer()` makes.
   - The other option: `number`, as today, for an explicit declaration only.
     An explicit definition is then read by occurrences boxed after it, and
     an inferred one by every occurrence. This needs the stamp of the boxing
     in every type read.
2. **Rule 8: what an operation reads and writes.**
   - Recommended: rule 8 as written. An operation reads the environments of
     its input, and the host's expression is not narrowed by it.
   - Without rule 8, about 1,290 tests of compiled code decline. The host
     must call `ce.infer()` or declare each input before it compiles a
     derived expression.
   - Rule 8 itself is not measured.
3. **Rule 2: the three other boxing writes in slice 1.**
   - Recommended: yes. Breaking change 2 needs them.
   - Without them, the three order cases of acceptance item 3 keep depending
     on the order of the parses.

## 10. Implementation

### Step 1, result (2026-11-10)

None of the stop conditions of acceptance item 1 was met.

- **The hang** of `find-fit-pool` and `find-fit-global-grid` is not a loop.
  `findFit()` compiles its model (`implicitCompileNumericResult()`,
  `nonlinear-fit.ts:665`). With no type for the free parameters, the
  compilation declines, and the fit runs each step through the interpreted
  `subs()` and `N()`. That makes it too slow for the time limit. Rule 8
  covers this: the compilation is an operation, and it reads the
  environments of its input.
- **The out-of-memory failure** of `dag-shared-walks` (test "a binder over a
  tower that holds its index rebuilds each node once") is a site of rule 7.
  `rebindToBindings()` (`binders.ts`) does not rebind a symbol with no
  definition, so the index `k` of a `Sum` built from a boxed body stayed
  free, and a later walk unfolded the shared tower. When the experiment
  rebinds a free name, the 19 tests of the file pass.
- **The registry of waiting definitions** needs no declaration step:
  - It records a head by name (`noteProvisionalApplication(name)`). It does
    so when `couldBecomeFunction(ce.lookupDefinition(name))` is true, and
    that is true for a name with no definition (`invisible-operator.ts`).
  - The repair runs at a later declaration and finds its dependents by name
    and scope (`utils.ts`, `repairProvisionalDependents()`).
  - The sites that decide the reading read `ce.lookupDefinition()` without
    the occurrence. These are rule 7 sites: they take the occurrence and
    read its type (rule 4).

### Phases

Each phase is committed with the full suite green. The new behavior is
behind an internal engine flag, `ce._bindingUnits`, which is off by default.
Tests turn it on per engine. The last phase turns it on, removes it and the
old mechanism, and updates the tests. The flag exists only during the work.

- **A, the core:** free names (rule 1); the unit environment with (home
  scope, name) keys and counters (rule 2, requirements on types);
  resolution, type reads and evaluation (rules 3 to 5); `isFreeName()`;
  rule 6.
- **B, the sites:** rule 7 (`sameBinding()`, `rebindToBindings()`, the 53,
  47 and 41 sites, the getters, the setters); the other readings of rule 2
  (`N`, `f`, the free name of a function body); the order-independence
  test. The reviews of phase A found these cases, to fix in phase B:
  - The getters of a free name (`re`, `sgn`, …) key their cycle guard on
    `this._def!`, so all free names share one guard. With `x := y`,
    `y := z` and `z := 2`, `x.re` gives `NaN`, not `2`.
  - The setters `value` and `type` on a free name throw.
  - The binder substitution in `library/utils.ts`
    (`substituteBinderValues()`, `evaluateBigOpTerm()`), and the
    substitution of a call of a function literal, replace every occurrence
    that has no definition, so they also replace a free name. With
    `a := n + 1`, `Apply((n) ↦ Σ_{n=1}^{3} a, 5)` gives `9`, not `3n + 3`.
    The test is marked `test.failing` in
    `test/compute-engine/binding-units-core.test.ts`.
- **C, operations, programs and caches:** rules 8, 9 and 10.
- **D, commits and state:** rules 11 to 13 (`ce.infer()`, `ce.assume()`,
  trials, the deprecation of checkpoints, the two library loads). The
  group-theory registration checks its input in the order and with the
  messages of `declareType()`, and on any other throw removes what it
  declared. `loadLibrary()` keeps its internal checkpoint until the release
  that removes the API: only `ce.declare()` knows everything that it
  refuses, so an exact pre-check would duplicate it. That release replaces
  the checkpoint with the removal of what the failed load declared.
- **E, the switch:** the flag on, then removed. The removed code is the
  declaration at boxing, the narrowing writes on definitions, and the
  capture of narrowings. Also: the test updates for the breaking changes,
  `CHANGELOG.md`, the documents of section 5, the timing of acceptance
  item 10, and the result paragraph of section 8 of the model.
