# Binding a set of definitions together: what it would remove in a host

Status: Superseded as the plan of record by
`docs/plans/2026-11-09-binding-units-model.md` (2026-11-09). Kept for its
measurements. Earlier status: DRAFT for discussion, not a spec. No decision is asked yet. The
Tycho session `tycho-desk` is asked to correct the table of section 3 and to
answer the questions of section 4.

## 1. The observation

The engine binds each expression when it is created, one at a time, against
the definitions that exist at that moment. Binding is: which definition each
name means, whether `f(x)` is a call or a product, the types, and then the
canonical structure, which needs the definitions of the operators (an
operator is flattened or sorted only when its definition says it is
associative or commutative). Order independence is added afterwards, by
re-deriving stored function bodies when a name gets a definition
(`boxed-expression/provisional-application.ts`).

A host that holds a whole document does not work this way. Tycho parses the
heads of all rows, declares every head with a signature it derives itself,
then parses and assigns the bodies, and retries the rows that failed because
of their position (`~/dev/tycho/src/graph-paper/graph/document-ce-manager.ts`,
`_registerDefinitions()`). Epsil does a smaller version of the same thing:
its runner installs the `function` statements of a statement list before the
first statement runs.

Measured on the engine side (98 states of Tycho's Neyret corpus,
`docs/plans/2026-11-09-function-readings-checked-on-use.md`): the product
reading of `2a(t)`, for which the re-derivation was built, occurred 0 times;
at least 66 of 72 re-derivations changed neither the body nor its type; 80%
of function bodies were first read inside `ce.assign()`.

## 2. The idea

One engine call binds a set of definitions together:

1. Collect the heads: the names, the parameter names, the declared types that
   the host gives (a slider is `real`, an axis is a ranged real).
2. Resolve the names of every body with all heads known. A name of the set
   shadows a library name. `f(x)` is a call when `f` is a function of the
   set, with no dependence on the order of the rows.
3. Infer the types over the call graph, in dependency order, with one rule
   for a cycle. The inference is a result of this step. It does not write the
   type of a free name while an expression is boxed, so the order of the uses
   of a name does not change its type.
4. Canonicalize the bodies, now that every operator has its definition.
5. Return one result per definition: bound, or an error value that names the
   cause. No throw, and no retry by the host.

An edit binds the changed definitions again and the definitions that read
them; the others keep their bound form. A single `ce.assign()` stays, as a
set of one definition; a stored body is then kept current by the check on
use of the other plan.

## 3. The steps of Tycho that such a call could remove

From a read-only survey of `document-ce-manager.ts` (20,254 lines) and
`src/plot-core/ce-definitions.ts` made on 2026-11-09 by a sub-agent of the
CE session. The line references and the reasons were not checked against the
source by the CE session: Tycho corrects this table.

| Step in Tycho | Why it exists (code comment) | Part of the idea that would remove it |
|---|---|---|
| `_preDeclareDefinitionHeads()`: declare every head before any body is parsed | "Per-cell parsing cannot bootstrap these declarations itself"; a name that collides with a library operator (`N(x, m, s)`) makes the row invalid | 1, 2 |
| Parse all rows again after the declarations | the first parse "can contain calls or atomic subscripts chosen before typing" | 2 |
| `_chooseDefinitionRows()`: which row defines a name | `F(x,y)=0` above the real definition registered `F` as the constant 0 | none: a host policy |
| Value cells requeued behind their dependencies | the engine folds `0·L` to `0` against a declared `L` with no value yet | 3, 4 |
| Second-chance queue for a row that is invalid because of its position | a forward reference to a head with no value fails the type checks of the body | 2, 3 |
| Retry of failed function registrations, up to 8 rounds | a body that reads a later definition has a type error, and its assignment binds nothing | 2, 3, 5 |
| `_registerRecursiveLambdas()` after the loop | the clauses of a function must all be present | 1 |
| `_prepareDefinitionBodies()`: types in dependency order in a scratch scope | a body boxed early cannot be re-read later (`L_1` as a symbol or as `At(L, 1)`) | 2, 3 |
| `_deriveSignaturesInterprocedural()` and `_deriveSignature()` | the evidence for a parameter type can be in a callee; a `number` parameter rejects a call that broadcasts | 3 |
| `_deriveValueType()` | "the declaration must admit the value the binding produces, or the assignment throws" | 3 |
| `_deriveComplexParamSlots()` | the GLSL target refuses a `vec2` argument for a real parameter; "Tycho knows the call sites" | 3, if the call sites are in the set |
| Parameter shadows, `withRowParamScope()`, `_expandBodyEntry()` | a free parameter gets `number` from its first use and then rejects a tuple | 3 |
| `_withScratchScope()` for analysis | usage inference must not write to the document scope | 3 |
| `_declareDocumentVariable()` | a document name must shadow `i`, `e`, `N`, `D`; the inferred type of an undeclared name "moved with the order of its uses" | 1, 2, 3 |
| Pop and push of the scope at each full registration, with a fingerprint to avoid it | a rebuild gives each symbol a new definition object, and the engine's memos check the identity of bindings | the edit rule of section 2 |
| `resolveSymbol` and `resolveApplication` hooks, `seedDocumentFunctionHeads()` | a new engine reads `f(x)` as `f·x` | 2; the coefficient policy for a name outside the set stays a host policy |
| Lowering of Desmos `\sum`, `\max`, `\min` over lists | "CE rejects collection bounds by design" | none: a dialect difference |

## 4. Questions for Tycho

1. Which rows of the table are wrong, out of date, or missing? Name the
   function and the reason.
2. For each row marked removable: would the call of section 2 really remove
   it, and what would Tycho still do? Say where the idea is too weak: a fact
   that only Tycho has (call sites of plotted expressions, the Desmos
   policies, the axes), a result Tycho needs that the call does not return.
3. What does Tycho need back for each definition: the signature, the value
   type, the list of names it reads, a validity result, something else?
4. On an edit, what does Tycho know: the rows that changed, or only the new
   document? Would "bind these changed definitions, the engine finds what
   depends on them" fit, or does Tycho need to control the order?
5. Which three of these steps cost the most today: in lines, in registration
   time, in defects? A count or a measurement where one exists.
6. Is there a step where the present behavior of the engine is what Tycho
   wants, and a batch call would make it worse?

## 5. The answer of Tycho (2026-11-09), and what it changes

The full answer is
`~/dev/tycho/docs/scratch/2026-11-09-ce-set-binding-tycho-answer.md`
(session `tycho-desk`, Tycho commit `3373c25d9`). It marks each statement as
read in the source or taken from a census by sub-agents. The points below are
from that file; the CE session did not check them against Tycho's source.

**Corrections to section 3.** The reasons of the table are right. The quote
"Tycho knows the call sites" is not in the source: `_deriveComplexParamSlots()`
exists because the `glsl` target refuses a `vec2` argument for a parameter
declared real. The row of the parameter shadows mixes two things:
`withRowParamScope()` belongs to registration, `_expandBodyEntry()` to Tycho's
own inlining of calls. Eleven steps are missing, and they are larger than the
listed ones (sizes are spans of lines with comments):

| Missing step | Reason | Size |
|---|---|---|
| Tycho inlines the calls of document functions itself | Desmos reads a name of a value at the call (`s_x = mod(x, 1)` read inside `c(x, y)` means the `x` of the call); the engine reads it lexically | about 1,330 |
| Field macros: a value that reads a plot axis is a function of the axis | the engine has no such kind of definition | about 1,830 |
| Value binding policy: evaluate under a time limit, else bind the body | an evaluation with sliders gives a large tree; an `Error` value types the name `error` | about 650 |
| List width in a signature, and up to 3 more registrations of the document | the shader target needs `list<number^N>`; the engine then refuses a call of another width, with no message | about 260 |
| Subscript readings (`B_s` is a name or `At(B, s)`) | the reading depends on the declared type of `B` at parse time | about 300 |
| Recognizing a definition head from a raw parse | `f(x)` has two shapes, by what the engine knows of `f` then | about 630 |
| Evidence for parameter types from the syntax of the body | the engine's inference at assignment read `Add(tuple, M_0)` as `M_0: number` | about 1,175 |
| Epochs and about 45 maps cleared at each registration | a registration gives each name a new definition object | |
| Two ways to avoid a registration | a registration of an 89-row document cost about 0.9 s per click | about 500 |
| Each row is classified twice | registration classifies while the scope is being filled | |
| The registry of computed collections | needs the names a body reads, with bound names removed | about 520 |

**What the call of section 2 would remove.** The order problem: the head
declarations, the second parse (only if the call takes the source rows), the
second-chance queue, the 8 retry rounds. Tycho estimates this at about a
quarter of the code that exists because of how the engine binds (an estimate,
not a count).

**Where the idea is too weak.**

1. *Step 2 before step 3 cannot work.* A reading depends on a type, and the
   type on a body that is being read: `L_1` (a name, or `At(L, 1)` when `L` is
   a list), `2P` (a product or a tuple), `(A, B)` (`Tuple` or `PointList`),
   `O_x` inside the definition of `O`. Either reading and typing are one loop
   in dependency order, or the ambiguous forms stay in the bound expression
   and are decided at use. The second removes the order problem for these
   forms without a batch call, and is the check on use of the other plan
   applied to a reading.
2. *The call binds; Tycho's registration also evaluates each value.* The
   requeue of value cells, the time limits and the unevaluated bindings come
   from the evaluation. The call must say whether it evaluates. Tycho wants
   lazy evaluation for large lists, and a slider has a type and no value.
3. *A value over ambient names.* The two largest blocks (about 3,100 lines)
   exist because Desmos binds the names of a value at the call and the engine
   binds them where the value is written. The call does not touch them. A
   definition kind for it would reverse, for marked names only, a decision of
   the engine.
4. *One signature has two users.* The interpreter needs wide parameter types
   (a call broadcasts); a compile target needs narrow ones. The call should
   return the contract (what a call may pass) and the facts (what the calls of
   the set do pass) apart.
5. *Plotted rows.* About half of the rows of a document define nothing. They
   must be in the set as readers: they are the call sites of point 4, and the
   dependents Tycho must hear about at an edit.

**What Tycho wants kept.** One expression bound alone against the standing
definitions, writing nothing (a row being typed, a label, a hover value);
unbound trees with lexical queries (free names, binders); a host choice for
three cases where a document name must not shadow a library name; no value
required for a slider; one result per definition, never all or nothing.

**The defect classes that cost Tycho the most** (its judgment, not a count):

1. Usage inference writes the type of a free name while a row is boxed, also
   in an outer scope, and a later assignment then fails with no message.
2. The reading of a row depends on what is declared at the time of the parse,
   and a later box cannot repair it.
3. A declared type is enforced at assignment, and the failure is a missing
   binding.

## 6. What follows for the engine

The answer moves the weight away from the batch call. None of the three
defect classes is about the order of definitions as such; each is a property
of binding one expression:

- **A. Boxing an expression writes no type of a free name.** Inference is a
  result, read from the expression or from a bind step, not a change of a
  declaration. This is class 1, and it is what Tycho's scratch scopes, shadows
  and `narrowings()` reset exist for.
- **B. An ambiguous form keeps its reading open until the types are known.**
  `f(x)`, `L_1`, `2P`, `(A, B)` stay in the bound expression as they are
  written, with a reading that is computed and checked at use. This is class
  2, and it is the plan
  `docs/plans/2026-11-09-function-readings-checked-on-use.md`, made wider:
  from function bodies to every expression, and from "call or product" to the
  other readings.
- **C. A type is a result unless the host declares a contract, and a refused
  assignment reports its cause.** This is class 3.

With A, B and C, binding a set is mostly a loop over the definitions in
dependency order, and the batch call is a convenience for the result per
definition and for the edit rule. Without them, the batch call hides the
order problem and leaves the three classes.

Not decided here, and each needs the user: a definition kind for a value over
ambient names (point 3 above), whether the call takes rows or (name,
parameters, body), and whether `subs()` avoids capture or the engine inlines
a call on request (section 7 of Tycho's answer).

## 7. Census of the inference writes (2026-11-09)

Property A of section 6 says that boxing an expression writes no type of a
free name. Two measurements on `b9b37fca69133b1f90fa8c7aa5dbf6f5dc9ff9c5`, in
a temporary worktree.

**Where the writes land.** The write is in `BoxedSymbol._inferWithoutFacts()`
(`boxed-expression/boxed-symbol.ts`). On the Tycho sample of the other plan
(98 Neyret states, two registrations each):

| The narrowed name is | Writes |
|---|---|
| in a scope that existed before the expression was boxed | 2,779 |
| a parameter, a local or a binder variable of the expression | 1,651 |
| in a scope that the expression created | 42 |

**How many tests depend on a type inferred by an earlier expression.** In the
experiment, a type that boxing inferred for a name of a scope that existed
before is put back when the next expression is boxed. One third of the suite
(a Jest shard, 654 files, 25,022 tests run) ended: 103 files and 329 tests
failed (16% of the files, 1.3% of the tests). The two other shards did not
end in 600 seconds each: at least one test does not end under the
experiment, and it was not identified.

The count is an upper bound. The experiment also takes the type away from
the first expression itself once a second one is boxed, and a compilation
boxes: 28 of the 103 files are compile tests, and the log has 200 refusals
"the input `x` has no type", for expressions whose own boxing had inferred
the type. A design that keeps the inferred types with the expression does
not break these.

**The count, finished (2026-11-09, on
`d43d68f25aaea596b2518f3c28ca4dfb2aed8500`).** Three experiments on the full
suite (about 1,970 files, 81,322 tests run), each a stricter emulation of
"the boxing of an expression does not see a type that the boxing of an
earlier expression inferred for a name of a host scope":

| Experiment | Failing files | Failing tests |
|---|---|---|
| 1. The earlier type is removed when another expression is boxed, and not put back | 255 (13%) | 1.3% in the shard with totals |
| 2. The earlier type is hidden while another expression is boxed, and put back after | 152 (7.7%) | 599 (0.74%) |
| 3. As 2, but only for a boxing that the host starts: a boxing made inside an evaluation, a simplification or a compilation keeps the types | 71 (3.6%) | 250 (0.31%) |

The four files that did not end in experiment 1 are performance tests
(`find-fit-pool`, `find-fit-global-grid`, `compile-performance`,
`performance`): the experiment slows them, they do not loop.

Experiment 3 is the closest to a design where the inferred types stay with
the expression, and it is still an upper bound: the test for "inside an
evaluation" reads the names of the functions on the stack, and the remaining
failures in the integration, differential-equation and Rubi helper tests (at
least 58 of the 250, counted in the eight largest such test groups) are
probably boxings that this test did not recognize; this was not checked. The groups that show a real dependence between expressions:

- Epsil programs, where a statement reads a type that an earlier statement
  of the same program inferred (static checks of call arguments, named
  calls): at least 27 tests, in 11 files. A program is a set of statements, so
  the commit at the end of a batch, or statement by statement inside the
  program, keeps this.
- A reading that depends on an earlier use: `x(3)` after `x + 1` is the
  product `3x` today and the call `x(3)` in the experiment
  (`juxtaposition-application`, `latex-syntax/lenient-ambiguity`,
  `unapplied-operator-fallback`).
- Tests of the inference itself (`use-narrowing-evidence-guard`,
  `inference-provenance`, `inference-rollback`, `ce-473`, `tycho-321`,
  the matrix-cell inference tests).

## 8. Where the write could happen instead

The inference becomes a result: an expression, or a set of definitions,
reports the types that its free names need, and nothing is written to a
scope. A commit writes that result:

- an explicit call (`infer()`) for one expression or a list;
- the end of a batch call, as an option: one write from all the evidence of
  the set, so the result does not depend on the order inside the batch.

Both are the same operation. A host that only reads the inference never
commits. To decide: whether a plain `ce.parse()` outside a batch commits, as
today, or not. The census gives the price of "not" as at most 0.31% of the
tests (250 tests in 71 files), a part of them inside Epsil programs, which a
commit per program keeps.

## 9. A value that reads a plot axis: the proposal of Tycho

Section 8 of Tycho's answer (added 2026-11-09). The Desmos rule: a function
reads the plot axes as globals; a value is text pasted into its reader, so a
parameter of the reader captures the names written in the value. With
`A = x^2 + y^2` and `f(x) = A`, `f(3)` is `9 + y^2`.

Three rules: an axis, a slider and `t`, `u`, `v` are global inputs (a type,
no value at binding time); a value that reads an input in its own text, or
in the text of a value it reads, is a function with one named parameter per
input (`A(x:, y:)`), and a reader that binds the name passes it; a function
with explicit parameters gets no implicit parameter.

What it needs from the engine, each a decision: a parameter whose default is
the outer name of the same spelling
(`docs/plans/2026-10-31-parameter-default-values.md` refuses it today);
compiled code where a function reads an input that is a parameter of the
compiled kernel (the compile declines today); and who rewrites the
references, Tycho or the engine. Not known: how many documents have a value
read under a parameter of the same name; Tycho can count it on its corpus.

## 10. View of the CE session on section 9 (2026-11-09)

A view, not a design. What was read for it: rule R4 and the refusal of
`(x: number, k: number = x)` in
`docs/plans/2026-10-31-parameter-default-values.md`, "Default values of
optional parameters" in `docs/TYPE-SYSTEM.md`, and the refusal message in
`compilation/compile-folded-values.ts` (`foldCaptureRefusal()`). The code
that compiles a call of a user function (`compile-user-calls.ts`) was not
read.

**The engine can do it as a rule of binding, without implicit parameters.**
Tycho's own statement of the Desmos rule is "a value is text pasted into its
reader". With property B of section 6 (a stored body is bound when it is
used, from its raw operands), that rule is direct: a definition of the kind
"open value" keeps its raw body, and each reader that names it binds a copy
of that body in the reader's own scope. A parameter of the reader then
captures the names written in the value, and in the open values it reads,
because their text is bound there too. The names inside a function that the
value calls are not captured, because a function is bound once, in its own
scope. The four cases of Tycho's table come out of this with no rewrite of
references, no named parameter and no order of implicit parameters.

Under this reading the first engine gap of Tycho's section 8 (a parameter
default that reads the outer name of the same spelling) is not needed. A
symbol default exists today, but it is boxed once in the declaring scope
(R4), which is the opposite of what the reader needs, and the refusal of a
default that names a parameter is there because the interpreter and the
JavaScript default disagree. Building on defaults would mean a second
meaning for them.

**What it costs.** The body of an open value is bound once per reader, and
its type is a type per reader. A compiled reader holds a copy of the body;
Tycho inlines the text today, so the emitted code does not grow compared
with now. The decision of 2026-09-21 stays the default: only a definition
that the host declares as an open value is bound at its readers.

**What the call returns** (Tycho's condition 3). For each definition and each
reader, the inputs it reaches are the free names of its bound form that
resolve to a host input: through open values by construction, and through
functions by the names their bodies read. This is a lexical walk of bound
expressions, which the engine can give.

**The second gap stays open.** Rule 3 says that a function with explicit
parameters reads an input as a global, and a compiled kernel has that input
as a parameter. Whether the compiler can emit a user function that reads a
parameter of the kernel, on each target, is not known to this session: the
refusal that was read is for a stored value, not for a function. It needs a
reading of `compile-user-calls.ts` and a probe per target before anything is
said to Tycho about it.

Probe on `7520d089c99f414c1c0e479871177ddcaa7bf6ed` (2026-11-09), with `x`
declared `real`, `g(u) := u + x` and `k(v) := g(v)·x`, compiled with
`compile()`: on `javascript`, `g(1)`, `g(x)` and `k(2)` compile, and with the
input `x = 5` they give `6`, `10` and `35`, which are the values of a function
that reads the input `x`. On `glsl` and `interval-js` the same three calls
compile (`_fn_g(1.0)`, `_fn_g(x)`, `_fn_k(2.0)` on `glsl`); the emitted code
was not run. So a function with explicit parameters that reads an input of
the compiled code is not refused; the refusal that Tycho met is for a stored
value under a binder of the same name. Not probed: an input that is a
parameter of a compiled function literal or a loop index, which is where
that refusal applies.

On `glsl` the helper reads the input by name, with no parameter for it: the
preamble of `g(1)` is `float _fn_g(float u) { return u + x; }`, and
`freeSymbols` is `["x"]`. The shader that holds this code must declare `x` at
its global level, before the preamble. Tycho's 2-D shader lane does not: the
axis is a parameter of the function that wraps `code`
(`float userFn(float x, float y) { return <code>; }`,
`~/dev/tycho/src/plot/webgl/shader-templates.ts`, `injectUserFunction()`, as
read by `tycho-desk`), so a helper of the preamble that reads `x` would not
compile there. A slider is a uniform with a `#define`, global to the source,
and a helper can read it. Tycho does not meet the problem today because it
passes the axis as an explicit argument before the compile. Two ways to make
a function read the axis as a global on this lane, neither decided: Tycho
declares the axes as globals of the shader before the preamble and assigns
them in `userFn`; or the engine passes each input that a helper reads as an
extra parameter of the helper, and reports which inputs the preamble reads.
Tycho did not read its 3-D lane.
Tycho's `javascript` and `interval-js` lanes pass the axis as a free input of
`compile()` (`resolveCECompile()`, as read by `tycho-desk`), which is the
shape of the probe.

**Order.** This depends on property B. It is not a first step.

## 11. The macro kind: counts and four reference results from Tycho (2026-11-09)

The user named the definition kind of section 10 a macro. Two facts from
`tycho-desk` (its script is
`~/dev/tycho/scripts/repros/2026-11-09-value-over-axis-capture-census.mts`;
not checked by the CE session):

**How many documents need it.** Of 688 corpus states, 98 have a value or a
function that reads a plot axis. 93 of them have only the global reading (a
plotted row reads the value; no parameter captures a name). 5 need a
parameter of a reader to capture a name written in a value (4 states), or
the mixed case (1 state). 590 have none. The count of the capture case is a
lower bound: the script misses a reference written with a Greek base and a
subscript, and a value read under a summation index of the same name.

**What Tycho gives today for `f(3)`**, the reference results for a macro:

| Document | `f(3)` |
|---|---|
| `A = x^2 + y^2`, `f(x) = A + 1` | `y^2 + 10` |
| `g(u) = u + x`, `f(x) = g(1)` | `x + 1` |
| `k(v) = v + x`, `A = x + k(1)`, `f(x) = A` | `x + 4` |
| `A = x^2`, `g(u) = u + A`, `f(x) = g(1)` | `x^2 + 1` |

A function never takes an axis from its caller, also when it reads the axis
through a value (rows 2 and 4). So the fill rule differs by kind: the reader
binds the names of a macro; a function is bound once, in its own scope, and
a macro read inside a function is bound in the scope of that function. An
implicit parameter that the call site fills would give `4` for row 2.

**An effect is drawn once.** Measured by `tycho-desk` on the live Desmos
calculator on 2026-11-09
(`~/dev/tycho/scripts/repros/2026-11-09-desmos-argument-random-draws-gt.mjs`):
with `g(a) = a - a`, `g(random())` is `0`; with `s(a) = [a, a^2]`,
`s(random())` is `[r, r^2]` for one `r`; with `A = x + random()` and
`f(x) = A - A`, `f(2)` is `0`; and `random() - random()` is not `0`. So a
draw belongs to the place where `random()` is written, not to each copy of
the text. A macro cannot be a plain copy of text: the copies of an argument,
and the copies of the body of a macro inside one reader, must share one
evaluation of each sub-expression that has an effect. Not measured: whether
two different readers of one macro (`f(x) = A`, `h(x) = A`) share the draw.

**A macro is bound at its reader, not substituted into it.** The user
observed that after a substitution of text the simplifier cannot tell two
copies of one written draw from two written draws, so the rules that are
valid in a function body (`a - a` is `0`) would not be valid on an expanded
body. `tycho-desk` measured on 0.185.1 that the engine is right today for a
function call (`(a ↦ [a, a^2])(Random())` draws once) and for two written
draws (`Random() - Random()` is not folded): the risk is only in a
substitution.

The view of the CE session: do not substitute. When a reader `R` that names
a macro `A` is bound, the engine declares in the scope of `R` a local `A`
whose value is the raw body of the macro, bound in that scope. Every
occurrence of `A` in `R` is then the same symbol, resolved by the ordinary
lexical lookup. This is `f(x) = Block(A := x + Random(), A - A)` written by
the engine. Consequences: the simplifier sees one symbol, so the function
rules apply unchanged and no rule is special to a macro; an evaluation of
`R` evaluates the body of `A` once; a compiler emits one local; the bound
form of `R` does not grow with the number of occurrences. A macro with
parameters is the same thing with parameters: a function whose free names
are bound in the scope of its reader, and whose arguments are bound once, as
for any function.

**A Desmos draw is a constant of the document state, not an effect.**
Measured by `tycho-desk` on the live calculator on 2026-11-09
(`~/dev/tycho/scripts/repros/2026-11-09-desmos-value-draw-readers-gt.mjs`):
with `A = x + random()`, `f(x) = A` and `h(x) = A`, `[f(1), h(1)]` is
`[1 + r, 1 + r]` and `[f(1), f(2)]` is `[1 + r, 2 + r]`. A written
`random()` gives one number for the whole document state: the same for every
reader and for every call. With a fixed seed, the number depends on the seed
and on the place where `random()` is written, and on no other draw; whether
an untaken branch draws cannot be observed.

Correction by `tycho-desk` (same script, cases 3a to 3e): this holds for a
value row outside a binder only. Written in a function body, the draw is a
function of the seed, the place and the argument values
(`f(x) = x + random()`: `f(1)` and `f(2)` differ, two calls of `f(1)` agree).
Written in the body of a comprehension, it is drawn for each element.

So the Desmos meaning of a draw is not a rule of the macro kind, and not the
meaning of the engine's `Random()` (which draws at each evaluation). It is a
lowering of the dialect, and Tycho has it: its importer wraps each written
draw as `WithRandomSeed(seed, …)`, with a seed made from the document seed
and the index of the place, and leaves a draw in a comprehension body
unframed (`~/dev/tycho/src/graph-paper/desmos-import/README.md`, "Random",
as read by `tycho-desk`). With a framed draw, the local that a reader binds
for a macro gives the Desmos result whether it is evaluated once, per reader
or per call. The macro kind needs no rule about draws, and the one
requirement on the engine is one it meets today: a `WithRandomSeed` frame
gives the same draws at each evaluation.
