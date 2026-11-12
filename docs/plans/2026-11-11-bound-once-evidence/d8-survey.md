# D8 survey: a local of a block is declared

Read-only survey of the main tree (`/Users/arno/dev/compute-engine`) and of
Tycho's onboarding preludes. Counts come from the scripts named below (in the
session scratchpad). An estimate is marked as one.

## 1. LaTeX

The parser already does what D8 asks. `buildBlockFromSequence()`
(`latex-syntax/dictionary/definitions-core.ts:8165`) turns a `;` sequence into
a `Block`. The first `\coloneq` / `:=` of a name becomes
`Declare(name, "unknown", v)`, and a later one becomes `Assign`. A
`\operatorname{let}` statement becomes its `Declare`. `\mathrm{Assign}(k, v)`
stays an `Assign`. `where` clauses also give `Declare`s (`whereItem()`).

- `c \coloneq 5; 2c` gives `["Block",["Declare","c","'unknown'",5],["InvisibleOperator",2,"c"]]`
- `x := 1; x := x + 1; 2x` gives `["Block",["Declare","x","'unknown'",1],["Assign","x",["Add","x",1]],…]`
- `\operatorname{let} c: \operatorname{integer} \coloneq 5; c` gives `["Block",["Declare","c","'integer'",5],"c"]`

Edges:
- A single statement `c := 5` is `Assign`: it is not in a block.
- `\mathrm{let}\ c := 5` and `\operatorname{let} c: \mathbb{Z} := 5` give an
  `invalid-type` error statement. This is a parser defect, separate from D8.
- `:=` in an `\operatorname{if}` branch is `Assign`, and the whole input is
  `Delimiter(Sequence(…))`, not a `Block`.
- `(a, b) \coloneq (1, 2)` is an error (`assignment-to-library-function`).

No parser change is needed for D8. The only parser outputs that become errors
are an `Assign` in a branch or a loop body to a name that nothing declared,
and `\mathrm{Assign}` to an undeclared name.

## 2. Epsil

`c = 5` and `c := 5` compile to `Assign(c, 5)`. `let c = 5` compiles to
`Declare(c, Dictionary(value: 5))`, and `let c: integer = 5` to
`Declare(c, "integer", Dictionary(value: 5))`. `let c := 5` is a syntax error
(`unexpected-symbol :=`): the spec's spelling of the Epsil local does not parse
today. Either D8's text changes to `let c = 5`, or the parser accepts `:=`
after `let`.

A first assignment without `let` is accepted today:
- at the top level of a program (a session name);
- at the top level of a `do { … }` block or a function body (an implicit
  local).

It is rejected in a branch or a loop body (`first-assignment-in-branch`,
`static-diagnostics.ts`). `(a, b) = v` is `Equal`, not an assignment.

Assignments of a name not declared in scope (parse and walk,
`epsurvey.ts`):

| Source | Programs | In a block or function body | At program top level |
|---|---|---|---|
| `test/epsil/corpus` (`.epsil`) | 107 | 0 | 1 (1 file) |
| `src/epsil/docs` (```epsil blocks) | 1,348 (1 does not parse) | 10 (5 files) | 17 (8 files) |
| Tycho onboarding preludes (`prelude:` literals) | 13 | 0 | 0 |

Examples from the docs: `f = …` below a statement in `control-flow.md`;
`x = …` below a statement and `t = …` in a block, both in `declarations.md`.
Not counted: programs embedded as strings in `test/epsil/*.test.ts`, and Tycho
documents other than the onboarding preludes.

## 3. MathJSON tests

Files under `test/` with a `['Block', …]` literal that assigns a name that no
`Declare` in the next 600 characters declares: 212. This is an estimate and
too high: it counts a name declared further out or by `ce.declare`. The spec
says about 140.

33 of the 212 mention the mechanism by keyword (implicit local, assignment
local, first assignment, sweep, `_blockLocal`). Those whose subject is the
implicit local, by name, so they change meaning rather than spelling:
- `block-assignment-local-per-run`, `assignment-locals`, `block-assign-run-time`
- `ce-827-block-local-type-ignores-same-name-binding`, `block-locals-declaration-rules`, `compile-block-locals-rules`
- `block-scope-shadowing`, `block-scope-capture`, `closure-block-locals`
- `ce-583-block-local-list-no-copy`, `function-body-preboxed-block`
- `test/epsil/function-body-local-assignment`

The rest is mechanical: the first `Assign` becomes `Declare(name, value)`. A
test where a global of the same name exists changes meaning under D8 (the
global is written); this was not measured. Two of the 33,
`compile-javascript-structured-collections` and
`compile-javascript-structured-blocks`, belong to another session.

## 4. Engine sites that build a Block

No engine site builds a `Block` with an `Assign` to a name it does not
declare:
- `canonicalBlock` and `canonicalFunctionLiteral(Arguments)` wrap the user's
  statements;
- `pool-loop.ts` `poolLoopFunction` and `compile-declarations.ts`
  `destructureViaTemp` / `desugarPatternAssign` declare their temporaries;
- the `Assign`s in `equivalentAssign`, `addToSteps` and `lowerParallelHeads`
  write names that are in scope.

The front ends are the sources: `src/epsil/parser.ts` (`parseBlock`,
`parseProgramUnchecked`) and the LaTeX parser (section 1).

## 5. What D8 deletes (worktree; lines with doc comment / code only)

| Function | Lines |
|---|---|
| `sweepCanonicalizationBindings` | 143 / 93 |
| `isImplicitRunLocal` | 19 |
| `beginAsyncRun` + `endAsyncRun` | 56 + 22 |
| `declareRunAssignmentLocals` | 13 |
| `createBlockLocals` | 86 |
| `declareAssignmentLocals` | 42 |
| `markSweptBinding` | 24 |
| `sweptCallerBinding` | 59 |
| `sweptHomeBinding` | 40 |
| `sweptHomeOf` | 5 |
| `recordCanonicalLocal` | 16 |
| `readsNoOtherBinding` | 42 |
| `assignment-locals.ts` (the whole file) | 322 |

In total about 890 lines. Also:
- `_assignmentEvidence`: 19 lines in 6 files, and the "body free name with
  assignment evidence" kind of `readsActivation()`;
- `first-assignment-in-branch`: 5 sites in `control-structures.ts`, plus
  `core.ts`, `box.ts`, `compile-locals.ts` (2), `types-definitions.ts`, and
  3 in Epsil (`static-diagnostics.ts`, `execute-epsil.ts`,
  `error-explanations.ts`), with 6 doc mentions.

They become a "declaration below a statement" error and an "assignment to an
undeclared name" error.

Likely to fall with them (to measure when built):
- `closeOverBlockRun` (43) and `capturedRunOf` (35): they exist for run
  definitions;
- the swept-home branch of `bindingInContext`;
- `copyAssignmentLocals` (32);
- the run record of the asynchronous route;
- the compiler's assignment-local rules (`compile-locals.ts`).

## 6. Cases D8 does not decide

1. **The top level of a program.** `ce.box(['Block', ['Assign', 'c', 5], ['Multiply', 2, 'c']]).evaluate()`
   gives 10 today and leaves the global `c` without a value. Epsil's
   `s = 0; for i in 1..3 { s = s + i }; s` uses this too: 1 corpus program
   and 17 docs programs. Is a program's top-level `Block` (`runsAsProgram`) a
   block for D8, or is an assignment there a session declaration?
2. **An `Assign` outside any block.** `ce.box(['Assign', 'c', 5]).evaluate()`
   declares a global today. D8 says only "in a block".
3. **Destructuring.** `Block(Assign(Tuple(a, b), Tuple(1, 2)), a + b)` with no
   `a` or `b` in scope. Does `Declare(Tuple(a, b), v)` take its place? Epsil
   has `let (a, b) = …`; LaTeX has no form.
4. **Two `Declare`s of one name in one block.** `Block(Declare(x, 1), Declare(x, "x"), x)`:
   a redeclaration (error), or a new local with its own type?
5. **A read before the `Declare`.** `Block(c + 1, Declare(c, 5))`, with a
   global `c = 9`: does the first statement read the global or the local?
   (Epsil gives `read-before-declaration` today.)
6. **The type from the initial value.** `Function(Block(Declare(t, x + 1), t), x)`:
   "the type of the initial value as known at boxing" is the type of `x + 1`
   with `x` a parameter of type `unknown`. Is it `unknown`, or `number`?
7. **The spelling in Epsil.** `let c := 5` does not parse (section 2).
