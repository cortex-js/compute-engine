# The macro kind

Status: APPROVED by the user on 2026-11-12 (session compute-engine-67):
decisions M1, M4, M5, M6 as first drafted, expansion in place, which
replaced M2 and M3, then M7 and M8. The checks with `tycho-desk` are
recorded in section 11. No code is written. It is slice 4 of `2026-11-09-binding-units-model.md` and step 4 of
`2026-11-11-bound-once-spec.md` (the "rule spec" below).
Consulted on 2026-11-12: `tycho-desk` (Tycho main with CE 0.187.1) and
`compute-engine-06` (the worktree of the rule spec).

"Today" in the tables is run on main at
`7305ef84b8e97bf25bc97dbcdaef2e6e48d81772`. "Proposed" is the expanded
form, written by hand and run on the same source, unless a cell says
"derived".

## 1. The rule

1. **A macro is a definition that keeps a raw body and has no value and no
   type of its own.**
2. **A macro is expanded in place, when a raw form is made canonical.** A
   macro name written in MathJSON or LaTeX input is replaced by the raw
   body of the macro, boxed at that place, in the scope of the occurrence
   and with its options (the canonical form asked for, `autoDeclare`); the
   root of the body takes the source range of the name. The name is not
   kept. A position where an operator takes a name is not an occurrence: a
   parameter, an index, the variable of `D`, `Solve` or `Limit`, the
   target of `Assign` or `Declare`. A symbol that code makes with
   `ce.symbol(name)` is not expanded either, so a working variable of an
   engine algorithm is never replaced by a body. **Nothing is expanded
   while an operation is in progress on the engine** (`evaluate()`, `N()`,
   `simplify()`, `compile()`, `replace()`, each part of an asynchronous
   evaluation): a name that library code boxes there is the symbol of rule
   7. So that this loses nothing, **a lazy call expands its raw operands
   when it is boxed**: a macro name at any depth of an operand whose
   boxing the operator defers (`Solve`, `FindRoot`, the body of `D`) is
   replaced by the raw body then, with the same exceptions for name
   positions and hidden names, found without a scope as in the structural
   form.
3. **The body is boxed by the same rule**, so a macro that it names is
   expanded too. A macro that reaches itself through macros is
   `macro-cycle`: `Error('macro-cycle', name)` at the occurrence. The
   engine keeps the set of the macro definitions being expanded for the
   length of one boxing call.
4. **A function is not a macro.** Its body is boxed once, in its own scope,
   and a macro named in the body is expanded there. A call is by
   reference: a function never takes a name from its caller.
5. **A macro is declared before a form that names it is boxed.** The
   engine never boxes a form again because a macro appeared or changed.
6. **A parameter, an index or a declared local of the same name hides the
   macro**, by the ordinary lexical lookup.
7. **A symbol that resolves to a macro definition** (a reader boxed before
   the declaration, a symbol from `ce.symbol()`) has no value and the type
   `unknown`, and evaluates to itself. No error is made for it.

So every name written in the body resolves from the scope of the
occurrence: a parameter or an index of the reader captures it, which is
what a macro is for. No text is substituted into a bound form, so no
capture can happen besides that one.

Rules of the rule spec that this assumes: rule 1 of its section 2 (an
occurrence resolves from the scope it was boxed in) and rule 4 (a
parameter, an index and a block local are names of their unit); C3 (the
home chain is fixed at boxing); D5 (a binder with a variable binds its
variable in a boxed operand); D8 for the locals of rule 6 (a local is the
name of a `Declare` at the top of a block). It does not need the
activations (D6) or slice 2 of the model (stored bodies with stamps).

**Why not a local.** The first version of this spec, and section 11 of
`2026-11-09-binding-a-set-of-definitions.md`, bound a macro as a block
local of its reader, so that two copies of a written draw stay one draw.
Tycho frames each written draw (`WithRandomSeed`), so two copies give one
number already. The local cost a block around every reader, a read-through
in `D`, `Integrate` and `Solve`, a rule for an inner scope, and row 10.

## 2. How a host declares one

```ts
ce.declare('A', { macro: ['Add', ['Power', 'x', 2], ['Power', 'y', 2]] });
```

- The body is raw MathJSON, any expression; `ce.declare` checks only that
  it is MathJSON, and refuses another field beside `macro` as it refuses
  an unknown field today. A body that boxes to an `Error` gives that
  `Error` at each occurrence. A host with LaTeX passes the `.json` of a
  raw parse.
- The definition is a value definition that carries the raw body
  (`def.value.macro`), with no value and the type `unknown`; rule 7 then
  needs no code. (The reviewed draft made it a third kind of definition;
  92 files test for the two kinds.) For the parser it is not a function.
- A macro is declared once in a scope: a second `ce.declare` of the name
  there is the error of today for a second declaration, and `ce.assign()`
  or an `Assign` on a macro name is an error. A host that changes a macro declares its
  set again in a new scope and boxes the readers again (Tycho does this at
  each edit of a row).
- `ce.lookupDefinition('A')` gives the macro definition, with its kind and
  its raw body. `ce.box('A')` is the body, boxed in the current scope.
- A macro has no parameters. LaTeX `A(x+1)` is a product, since `A` is not
  a function, and `A` is expanded; MathJSON `['A', 1]` stays `['A', 1]`
  and evaluates to itself, as for a name declared `unknown`. This replaces
  "the macro kind, with parameters" of section 6 of the rule spec; Tycho
  needs none (`tycho-desk`: a row with explicit parameters is a function
  and reads an axis as a global; for `c = |\cos a|` drawn as `y = c(x)` it
  declares a function itself).
- The batch (step 5) declares a macro with the same definition.

Where the code goes: the place where canonical boxing turns a name of the
input into a symbol (`boxed-expression/box.ts`), not `ce.symbol()`. The
engine substitutes a `holdUntil: 'never'` constant in `ce.symbol()`
(`engine-expression-entrypoints.ts`), which library code also calls for its
working variables (`ce.symbol('t')` in `solve-linear-system.ts`), so that
site is not used. Besides it: the walk that expands a tree with no scope
(the structural form and the raw operands of a lazy call share it, with
`ce.rebind()`), the parser's test of a function, and the refusals of
`ce.assign`, `Assign` and `ce.withValues`.

## 3. Examples

`x` and `y` have no value. A value row is `ce.assign()` today and a macro
under the proposal; a row with parameters is a function in both.

| # | Document | Read | Today | Proposed |
|---|---|---|---|---|
| 1 | `A = x^2 + y^2`, `f(x) = A + 1` | `f(3)` | `x^2 + y^2 + 1` | `y^2 + 10` |
| 2 | `A = x^2`, `B = A + 1`, `f(x) = B` | `f(3)` | `x^2 + 1` | `10` |
| 3 | `g(u) = u + x`, `f(x) = g(1)` | `f(3)` | `x + 1` | `x + 1` |
| 4 | `k(v) = v + x`, `A = x + k(1)`, `f(x) = A` | `f(3)` | `2x + 1` | `x + 4` |
| 5 | `A = x^2`, `g(u) = u + A`, `f(x) = g(1)` | `f(3)` | `x^2 + 1` | `x^2 + 1` |
| 6 | `A = x^2 + y^2` | the host expression `A + 1` | `x^2 + y^2 + 1` | the same; `.json` is `x^2 + y^2 + 1` |
| 7 | `A = k x` | `\sum_{k=1}^{3} A` | derived: `3kx` | `6x` |
| 8 | `A = x`, `f(x) = [A, \sum_{x=1}^{3} A]` | `f(10)` | derived: `[x, 3x]` | `[10, 6]` |
| 9 | `A = n·f(n-1)`, `f(n) = \{n = 0: 1, A\}` | `f(4)` | derived: an expression in `n` | `24` |
| 10 | `f(x) = A` assigned, then `A = x^2` declared (against rule 5) | `f(3)` | `x^2` | `A`, a symbol with no value |

Rows 1, 3, 4, 5 are Tycho's four reference results
(`2026-11-09-binding-a-set-of-definitions.md`, section 11), row 2 the fifth
of its answer; `tycho-desk` measured the five again on 2026-11-12 on both
of its routes, and row 9 gives `24` in Tycho today. Row 7: Tycho gives `6x`
inlined and `3kx` by reference, which it reports as its own defect; its
test "GY: under a sum over x" fixes the capture by an index.

What the engine stores: row 4, `f := x ↦ x + k(1)` (`k` is a function: its
`x` is the global one); row 5, `g := u ↦ u + x^2`; row 7,
`Sum(k·x, k, 1, 3)`.

## 4. Compiled code: one local per repeated body

The compiler sees the expanded form and no macro. A body that a reader
names several times is a repeated subexpression, which the targets share
today. Run today for `x·A + 1/A + A` with `A = \sin(x^2 + y^2)` expanded:

```js
(() => { const _cse1 = Math.sin((_.x * _.x) + (_.y * _.y)); return _.x * _cse1 + 1 / _cse1 + _cse1; })()
```

GLSL: `float _cse1 = _gpu_sin((x * x) + (y * y)); return x * _cse1 + 1.0 / _cse1 + _cse1;`.
The interval-js and Python targets emit one `_cse1` too. WGSL was not run.
Nothing is added to a target. The structured route (session
compute-engine-ef) shares or does not share by its own rules.

## 5. Three things Tycho needs before it deletes its inlining and threading

### 5a. A stored body and an inlined body mean the same thing

The engine gives one value for one MathJSON on both routes. The difference
is two lowerings of Tycho that run only where it inlines:

| Program | By reference | Inlined by Tycho |
|---|---|---|
| `y_r = [1,2,3]`, `d(x) = \max(0, x - y_r)`, `d(2)` | Tycho stores `Max(0, …)`: `1` | Tycho hands `ElementMax(0, …)`: `[1, 0, 0]` |
| `a(t) = [\cos t, \sin t]`, `A(t) = \sum_{i=0}^{2} a(2^i t)`, `A(0)[1]` | `At(A(0), 1)`: `3` | a `Sum` of cosines: `3` |

The rule: **a dialect meaning is lowered once, on the raw body, before the
body is handed to the engine; it reads no type at a call.**

- `max`, `min`. Tycho's lowering reads only the number of operands, so it
  can run on a stored body (`tycho-desk`). `ElementMax(0, x - y_r)` in a
  stored function gives the list, and `ElementMax(1, 2)` is `2` (run
  today). Nothing to do in the engine.
- `At`. The values agree. Tycho's lowering exists because the engine typed
  a `Sum` over a list-valued body as `number`, so the index typed `any` and
  the JavaScript target declined. On main today `A(t)` is `vector<2>`,
  `At(A(t), 1)` is `number`, and it compiles. Tycho runs its
  `list-index-lowering` tests without the lowering on a scratch build; a
  program that still declines or types `any` is an issue file.

### 5b. A parameter that takes a list whole

The engine keeps the rule it has for a global function, and this spec
changes none of it: **a parameter whose type admits a list takes the list
whole; a call maps over a list argument at any other parameter, an
`unknown` one included. The type of an undeclared parameter is inferred
from the body, through the functions the body calls.** Run today:

| Function (parameters undeclared) | Call | Result |
|---|---|---|
| `r(p) = \mathrm{ElementMax}(0, p_1)` | `r([3,-1])` | `3`: whole |
| `l(p) = \sqrt{p_1^2 + p_2^2}`, `k(p) = \mathrm{ElementMax}(0, l(p))` | `k([3,4])` | `5`: whole, through `l` |
| `tri(n) = \sum_{j=1}^{n} j` | `tri([1,2,3])` | `[1,3,6]`: mapped |
| `dd(p) = \mathrm{ElementMax}(0, p)` | `dd([1,-2,3])` | `[1,0,3]` |
| `m(L) = L_1 + L` | `m([3,4])` | error at the definition; Desmos, and Tycho inlined: `[6,7]` |

These are the Desmos results of Tycho's `broadcast-positions.ts`. The last
row is CE-1246, filed with this spec. A declared width is not what decides
(`list<number^2>` on a parameter refuses a list of pairs): Tycho leaves
the parameter undeclared or declares it without a width; the width that a
shader needs is the `byReference` option of the rule spec (C6).

### 5c. A shader helper that reads an input (decision M7)

Tycho threads `g(1)` to `g(1, x)` for a function that reads an axis,
because in its shaders the axes are locals of `main` and a helper cannot
see them. Under rule 4 `g(u) = u + x` is by reference and reads `x` as a
global. Run today, GLSL, `g(1)` with `x` declared `real`:

```glsl
float _fn_g(float u) { return u + x; }   // preamble
_fn_g(1.0)                                // code
```

The helper names `x` and takes no parameter for it. For Tycho to delete the
function half of its threading (`_fnImplicitParams`, the function half of
`_threadNode`), the GLSL and WGSL targets pass each compile input that a
helper reads, directly or through the helpers it calls, as a parameter of
the emitted helper. Without it Tycho keeps that half. It is a change of the
shader targets, not of the macro kind.

At a call under a binder of the same name (`\sum_{x=1}^{3} A` with
`A = x + k(1)`), the helper receives the INPUT `x`, not the index: the `x`
inside `k` is the global one. `tycho-desk` (2026-11-12, on the scratch
build): until this exists, a value row that reaches an axis through a
function cannot be a macro in Tycho, because Tycho registers `k` with a
threaded parameter and the `k(1)` of the raw body is then a wrong call. So
most of Tycho's deletion waits for M7: value rows that read an axis
directly are macros now; rows that reach one through a function, and the
function threading, come with M7; a value row drawn as a function of its
free name (`y = a(x)`) stays a Tycho function.

## 6. The hard cases

- **A reader boxed before the macro is declared** (row 10). Nothing is
  boxed again. By rule 2 of the rule spec the occurrence resolves to the
  macro definition once it exists, and rule 7 says what that is: a symbol
  with no value. No error (user, 2026-11-12: the literal reading is
  enough). Tycho keeps
  rule 5 at no new cost: it knows its macros from the raw rows before it
  registers anything, and registers the whole document again, in a new
  scope, at each edit of a row; it adds the order "macros first" in its
  registration and in the replay on a plot element's engine.
- **An expression that is already boxed.** `ce.function('Add', [e, 1])`
  boxes nothing again, and `e` holds no macro name any more. A binder built
  around a boxed reader binds its variable in the expanded body, by D5:
  `Sum(ce.box('A'), k, 1, 3)` with `A = k x` is `6x`.
- **A held operand.** `Hold(A)` keeps the name, and `ReleaseHold` runs
  during an evaluation, so it gives the symbol `A`, not the body. An
  operand that an operator holds for its own use (`opaque`, `held` roles)
  keeps its names too. To revisit with the design pass on held arguments
  (ROADMAP CE-1258).
- **A rule** (`ce.rules()`, `replace()`): a part that is made canonical
  when the rule is created is expanded; a replacement that is made
  canonical when the rule is applied keeps the name.
- **A host callback that calls `ce.parse()` during an evaluation** gets no
  expansion.
- **Size.** There is no limit: a host that declares a chain of depth 25
  that doubles at each level gets a form of 2^25 nodes. A reader holds one copy of a body for each occurrence, and a
  chain multiplies (`B = A + A`, `C = B + B`). Measured by `tycho-desk` on
  its 688 corpus states (section 11): the largest expanded reader has
  1,097 nodes, the deepest chain of macros is 4.
- **The name is not kept.** `.json` and `.latex` of a reader show the
  expanded body. The raw form (`ce.parse(latex, { form: 'raw' })`) never
  expands, and a host that wants the names reads it. The head of a
  definition row is an occurrence like any other: `A = x^2 + y^2` boxed
  whole is `Equal(x^2 + y^2, x^2 + y^2)`, in both forms, so a host boxes
  the right side of such a row alone (Tycho: adoption work at the entry of
  its classification). No option to box without expansion is added.
- **The structural form** (decision M8). It
  expands too: the body is boxed structurally at the occurrence. A
  structural binder makes no scope, so the hiding of rule 6 is found from
  the operand roles of the binder heads that the engine knows, read from
  the table that `binderSitesOf()` reads (`src/epsil/`,
  `resolve-library-names.ts`), which works on unbound trees; the canonical
  and the structural form then agree on which occurrence is hidden. The
  form still keeps the name of a `holdUntil: 'never'` constant, as today.
  Why: two steps of Tycho's classification run recognizers of written
  shape on the expanded body (the mask parts of a restriction; a row whose
  shape is in a value, `A = (\cos t, \sin t)` with the row `A`), and the
  canonical form drops what they read (`tycho-desk`, 2026-11-12).
- **A body with an effect that is not framed** (`Random()`) is evaluated
  once per occurrence, which is the meaning of the engine's `Random()`.
  The Desmos meaning of a draw is Tycho's lowering.
- **Type.** A macro has none; `ce.box('A').type` is the type of the body
  in the current scope, and it differs between readers.

## 7. Capture

`subs()` avoids capture under `Sum` and under a function literal today
(`Sum(k·a, k).subs({a: k})` renames the index to `k_1`) and not under
`Integrate` (`Integrate(a·t, t).subs({a: t})` gives the integrand `t·t`;
both run today). The macro kind does not use it: an argument is the value
of a parameter in the activation of the call, and a macro body is raw text
boxed where its name is written, which is the capture that rule 2 states
and no other. `subs()` stays a tool of the host. Tycho's capture checks
(`argsWouldCapture()`, `walkBinders()`, `collectFreeSymbolsForCapture()`)
go with its inliner, and its `ceArg`/`ceIdx` renamings with the threading.

## 8. Left to later steps

- The batch (step 5), which also returns the inputs that each definition
  reaches; Tycho's classification reads them, and until then that part of
  `macro-arity.ts` stays.
- Style and colour expressions: not served by this slice. Their call of
  Tycho's threading goes; their snapshot values wait for `ce.withValues()`
  or the batch (rule spec, section 6, fourth row).
- The transport of a definition to another engine: Tycho's record carries
  "macro" and the raw body.

## 9. Acceptance

The engine:

1. A test for each rule of section 1, each bullet of section 2, each row
   of section 3 and each case of section 6, written with
   `ce.declare(…, { macro })`; and one per route by which a name is boxed
   (LaTeX, `ce.box` of JSON, a function body at `ce.assign`, a binder
   body, `ce.function` with a boxed operand, the raw form, `ce.symbol`, a
   macro named `t` with a `Solve` of a linear system). The time to box
   Tycho's document `neyret/sc3azg0frd` (the largest growth) is reported.
2. The JavaScript, GLSL, interval-js and Python targets compile rows 1 and
   7, and emit one local for the program of section 4; WGSL is run and
   reported. If M7 is approved: row 3 compiled to GLSL with `x` an input
   gives a helper that takes `x` as a parameter.
3. The rows of section 5a and the first four of 5b, as tests.
4. CHANGELOG, the `ce.declare` page of
   `~/dev/cortexjs.io/docs/compute-engine/`, `docs/SCOPING-MODEL.md`; the
   result paragraph lists the files changed and the lines added.

Tycho's adoption (the delivery rule of the rule spec, section 7: the kind
goes to Tycho when it can delete with it):

5. Its tests pass on a scratch build with every value row that Tycho's
   policy makes a macro declared as one (a row that reaches an axis or a
   name that no row defines; a slider, a list that an action writes and a
   computed collection stay values) and no threading of a value row; the
   threading of a function that reads an axis, and the tests that assert
   it, stay until 5c is built:
   `cy-function-implicit-params.test.ts` (the "CY", "GY" and "D-310"
   tests), `function-body-axis-binding.test.ts`,
   `free-name-value-definition.test.ts`, `cx-macro-transport.test.ts`.
   Their values and classifications stay; their assertions on Tycho's
   mechanism (`implicitParams`, `ceArg`, threaded calls) are removed. Its
   codegen audit: each changed record is explained by the rule.
6. Tycho deletes, in `document-ce-manager.ts`: the threading
   (`_threadMacroRefs`, `threadMacroRefsForRow`, `_threadNode`,
   `_scanMacroArities`, `_registerMacroLambda`, the `ceArg_` renamings,
   the four parameter fields) and the inlining (`expandFunctionRefs`,
   `_expandBoxedFixpoint`, `_buildFunction`, `_expandBodyEntry`,
   `_expandExpr`, `argsWouldCapture`, `walkBinders`,
   `collectFreeSymbolsForCapture`, the memos); `macro-arity.ts` except the
   reach of inputs. About 3,900 lines is its upper bound of 2026-11-11,
   not counted again. Then `list-index-lowering.ts` (669 lines) when 5a
   passes on its tests, and `broadcast-positions.ts` (367 lines) when
   CE-1246 is fixed. What stays: the `max`/`min` lowering (114 lines), run
   on every body; the policy of which rows are macros and which names are
   axes; a rewrite for a name that is read bare and also called
   (`c = |\cos a|` drawn as `y = c(x)`); the function half of the
   threading unless 5c is built; the structural expansion of FUNCTION
   bodies that classification reads (`expandFunctionRefsStructural` and
   what it needs of `_expandExpr`), until classification can decide from
   the type of a call; the items of section 8.

## 10. Decisions (user, 2026-11-12)

- **M1.** A macro is bound where it is written, in each scope, so an index
  inside a reader captures (row 7). Approved.
- **M2, M3.** Replaced: a macro is expanded in place (rule 2), not bound as
  a block local. Approved.
- **M4.** `ce.declare(name, { macro: rawJson })`. Approved.
- **M5.** No parameters. Approved.
- **M6.** A macro is declared before its readers are boxed (rule 5); the
  macro kind does not wait for slice 2. Approved.
- A reader boxed too early reads the name literally, with no error (rule
  7).
- **M7.** The shader targets pass the inputs that a helper reads as
  parameters of the helper (section 5c), as a task of its own after the
  macro kind; it is what lets Tycho delete the function half of its
  threading. Approved.
- **M8.** The structural form expands a macro, with the body boxed
  structurally and the hiding names found from the operand roles of the
  binder heads the engine knows (section 6). Approved.

## 11. Record

**Review** (`/review-spec`, Claude and Codex, 22 findings, on the version
with a block local). Most findings were consequences of the local (a held
body against a local computed early in compiled code, the hidden locals in
`.json`, the symbolic operations on a block, an engine-made local that
hides the macro in an inner scope) and have no object with rule 2. Kept:
which scope an occurrence belongs to (rule 2), a reader boxed too early,
the other targets, the acceptance split between the engine and Tycho.

**Second review** (the version with expansion in place, 18 findings).
Changed: expansion happens where a name of the input is boxed, not in
`ce.symbol()`, which engine algorithms call for their working variables;
the positions that take a name; rule 7 for a symbol that resolves to a
macro definition (it follows from rule 2 of the rule spec, with no
exception); the definition as a third kind and its readers; the call head;
a held operand and a rule; the cycle set; the acceptance routes; D8 as an
assumption of rule 6; the function threading stays until 5c. The
structural form was open then (M8). Not taken: a limit on the size of an expansion.

**The structural form, `tycho-desk`** (2026-11-12, read in
`classify-formula.ts`, nothing run): classification reads the structural
row through two hooks. Most uses need only the inputs that a macro reaches,
which Tycho's scan gives from the raw bodies. Two need the expanded body
in its written shape. Classification also looks inside function bodies for
structure (a polygon head, a point or a list that a function returns), so
the structural inliner of functions is not deleted by the macro kind; how
many corpus rows depend on it was not measured.

**The check of expansion in place with `tycho-desk`** (2026-11-12, Tycho
`aac4551a562ef8ab45278d4df405c05807ffe7cf`): it works.

- Size, measured with Tycho's
  `scripts/repros/2026-11-12-macro-expansion-size-census.mts` on 688 corpus
  states, the value rows that its policy makes macros, functions not
  expanded, no sharing (upper bounds): 102 states have a macro; the
  deepest chain is 4; the largest expanded reader is 1,097 nodes (1,081
  raw); the largest growth of one reader is 10 to 438 nodes; the largest
  growth of a document total is 14.69 times (72 to 1,058 nodes), the next
  5.19. One state has a macro that reaches itself by the script's matching
  (`art/ue1rgdbp3e`), not investigated. The time to box was not measured.
  Tycho's large expansions are chains of functions, which go by reference.
- The name: nothing in Tycho needs it from a boxed row, with the two
  statements now in section 6 (the head of a definition row, the raw
  form).
- An unframed draw: nothing relies on one draw per reader.
- Its tests: no value differs from the block local; the self-referential
  macro test becomes `macro-cycle`; D-316 keeps a small rewrite in Tycho;
  the GLSL tests of a function that reads an axis need section 5c.

**State of what this spec assumes** (`compute-engine-06`, 2026-11-12).
Step 1 of the rule spec is on main, commit
`d2f392f08a39b831669fa22430ad853096f993ad`: rules 1 and 4, C3, D5 and D8
are built, and `docs/SCOPING-MODEL.md` is rewritten. Three later items
touch this spec, and the implementer reads them first:

- D11: a `let` with a function literal is a variable that holds a function
  value, and a function statement in a block is a local. Both hide a macro
  of the same name (rule 6).
- `docs/plans/2026-11-12-program-operator-spec.md` (ROADMAP CE-1255,
  approved, not built): an Epsil program becomes one `Program(…)`
  expression whose statements are put in a canonical order. Rule 5 is
  about the engine's state when the program is boxed, so that order does
  not change it; a macro is declared by the host, not by a statement.
- ROADMAP CE-1258 (a design pass, planned): a held operand would record
  the scope it was boxed in. The case "A held operand" of section 6 is then
  decided again: a release could expand with the macros of that scope.

**Result** (implementer under `compute-engine-67`, 2026-11-12, worktree
base `2e6ca255ba4c364ac6f159e7e21cc5a257227a2a`, four review rounds
applied). Sections 1, 2, 3, 4, 6, 7 and acceptance items 1 to 3 are built.
The definition is a value definition with a `macro` field, the type
`unknown` and no value (`isMacroDef()`, `boxed-expression/macro.ts`), not a
third kind; each engine counts its macros (`ce._macroCount`) and keeps
their names (`ce._macroNames`), and an engine with none skips every test. Expansion happens only at boxing: while an
evaluation is in progress on the engine (an operation environment is in
place: `evaluate()`, `N()`, `simplify()`, `compile()`, a slice of
`evaluateAsync()`, `replace()`, ...; `anyMacroDeclared()`), a name that
resolves to a macro is the plain symbol of rule 7. Outside an evaluation it
is expanded at the two places of `box.ts` that box a symbol of the input
(`macroAt()`), in `BoxedSymbol.canonical` for a raw symbol made canonical
later, and in the raw operands of a lazy call before its handler, at any
depth (`expandMacroOperands()`, also for `Dictionary`): each macro name is
replaced by its raw body, expanded the same way while its macro is in the
cycle set, and the operands stay raw. That walk is the raw and structural
rebuild of `ce.rebind()` (`unboundRebuilder()`), with an explicit stack and
the hidden-name records of the structural form (`HiddenBinders`); it keeps
the metadata of a rebuilt node and never changes a node of the caller. A
name that stays a name is replaced by a fresh raw symbol that `canonical`
does not expand (`BoxedSymbol._keptName`). A position that takes a name is
read from the data: the roles `opaque` and `held`, in the call or in a lazy
call inside it, a symbol with the role `bound` or `clause`, a signature
parameter that names `symbol`, the binding sites and `Block` locals, and a
table of five operators (`Solve`, `NSolve`, `FindRoot`, `FindFit`, and
`Limit(f, To(x, a))` or `Limit(f, x, a[, d])` when `f` is not a `Function`
literal and holds `x`, the handler's own tests; the handler of `NLimit`
reads its second operand as the point). At such an operand the names are
the symbol, the symbol elements of a `List`, and the first operand of a
`Tuple`, `Pair`, `Element` or `To`; they hide the macro in the whole
call.
Raw boxing counts the raw nodes that can hold a macro name
(`ce._macroSuspects`): the raw operands of a lazy call whose boxing counted
none are not walked, and a node that a walk found to hold none is not
walked again. Differences from the text: the parse oracle
answers the type `any` for a macro, since a valueless name of type
`unknown` is a call by the one-uppercase-letter predicate rule; a held
operand keeps the name also at `ReleaseHold`, and a name in the replacement
of a rule stays the name (both are made canonical during an evaluation);
the occurrence of an early reader inside an operation takes the type of its
use, as a name declared `unknown` does (a bare early reader is `unknown`).
Rows 1 to 10 give the "Proposed" values; rows 1 and 7 compile on
JavaScript, GLSL, interval-js and Python, and the program of section 4
emits one `_cse1` on each; WGSL is not a target of this source tree.
Probes: 243 operand positions of the lazy operators give the hand-expanded
value, with the macro at the operand and one level inside it; 44
name-position programs (both forms) give the value of a plain variable. On
an engine with an unrelated macro, boxing `Solve` of a 16-level MathJSON
tree (65,535 nodes in the raw operand) and a program of lazy calls nested
6 deep take the time they take with no macro, within the noise of the
measure; at 22 levels the MathJSON boxing runs out of memory with or
without a macro (raw boxing boxes each path). The time to box
`neyret/sc3azg0frd` was not measured.

**Acceptance run by `tycho-desk`, interim** (2026-11-12, scratch build of
main `8c2d6f97fac86fe5e8b6093ed7cdd57df9d4ef39` plus this change). With no
macro declared: codegen audit 1,295 records unchanged, 0 changed; audit
time and the `othello` instrument equal to its base build within noise;
its test suite fails the same 42 tests as on the bound-once build. With
value rows declared macros behind a switch: its direct probes give the
expected values; `cx-macro-transport` passes 16 of 16; registering and
evaluating `neyret/sc3azg0frd` takes 33 to 35 ms against 18 to 19 ms, and
`art/2ki2hjsouf` is unchanged at about 800 ms. Its deletion is not done: it
first boxes the right side of a definition row alone, and the measured
line count is owed, split by what waits for M7 (section 5c).

**Acceptance run by `tycho-desk`, second report** (2026-11-13, same build,
switch `TYCHO_CE_MACRO=1`). The macro kind alone lets Tycho delete nothing:
deleted 0 lines, added 101 (experiment quality). A value row is declared a
macro when every implicit parameter is read lexically, it has no parameter
that reaches it through a function, and it is not a free-name row called as
a function; every other row keeps Tycho's lambda route, so each piece of
the threading code is still needed.

- Tests of item 5 of section 9 with the switch on: `cx-macro-transport` 16
  of 16, `free-name-value-definition` 12 of 12, `function-body-axis-binding`
  7 of 8 before a Tycho adaptation that a direct probe shows fixed (file not
  run again), `cy-function-implicit-params` 38 of 39 (the failure asserts
  the mechanism: it expects the call `s(x)`).
- Its node suite, switch on against off: 6 more files fail. The causes are
  assertions on the mechanism (a lambda binding, a threaded call, the
  macro's name in transported LaTeX), Tycho's string route
  `expandFunctionRefs(latex)`, which reads a raw parse and so never
  expands, and one row of `graph-paper/with-self-read-rename`, whose value
  was not checked.
- Codegen audit, switch on against off (1,295 records off): 1,145
  unchanged, 11 changed code, 0 new declines, 139 only off, 54 only on, all
  in two documents. `art/hyvhlz4chj`: 3 records changed, the same 13
  series, values not compared. `neyret/62urmx2dcm`: 2 series off, 1 on.
  The cause is in Tycho: it lowers the body of a row before it publishes a
  lambda (`max`/`min` to `ElementMax`, list indexing, a `Sum` whose bounds
  are a list), and a raw macro body skips those lowerings. The engine
  refuses a list as the bound of a `Sum` in every spelling, on 0.187.1 and
  on this build. So the body Tycho declares must be its lowered body, and
  its lowering must run on a form where the other macros are still names;
  today it runs on boxed, typed forms. This is Tycho's largest
  prerequisite.
- Line counts, measured by script on `document-ce-manager.ts` (20,236
  lines). Deletable with M7: the threading, 1,311 lines (`_threadNode` 487,
  `_threadMacroRefs` 133, `_threadingRowHead` 120, `_threadFunctionCall`
  99, 13 smaller methods), and the publication of a value row as a lambda,
  140 lines; 1,451 lines in that file, not counting call sites, the
  `implicitParams`/`ambientParams` fields in 10 other files, and tests.
  Stays: the arity scan (144 lines) and `macro-arity.ts` (599), which
  classification reads; free-name and bound-name rows (185); the self-read
  rename (82) and `block-local-rename.ts` (604). Uncertain: a row with a
  free name that is read bare elsewhere needs "name to call with its free
  name", which may keep a reduced `_threadNode`.
- Audit time with the switch on: 46 s against 48 s off (one run each).

The figure of section 9 (about 3,900 lines deletable) is not confirmed: the
measured figure is 0 lines with this change alone and 1,451 lines in one
file once M7 is built and Tycho lowers raw bodies.

The values of `art/hyvhlz4chj` agree with the switch on (`tycho-desk`,
2026-11-13): Tycho's test of the document's colour chain against an
independent JavaScript model passes in both modes (tolerance 1e-6), and the
3 changed records differ only by the inlined helpers of the value rows and
renumbered temporaries. The emitted code of the records was not run.

**M7, as built** (implementer under `compute-engine-67`, 2026-11-13, on
main `9fb18f1b0a2d1d08086fc08f09a80770f36992ff`). The GLSL compile option
`callerLocals` (symbol names) and the same option of
`GLSLTarget.compileFunction()`. A shader function that reads a name of the
option, directly or through a function it calls, takes it as a trailing
parameter, after its own parameters and the extra parameters of an
invariant-prefix variant, in the sorted order of the names; the element-wise
wrapper takes the same parameters and passes them on. While a definition body
compiles, the `var` hook of the compilation root answers the parameter for a
read of such a name and records it in the definition on top of a stack; a
call appends the callee's names, resolved in the same way
(`gpu-caller-locals.ts`). `g(1)` with `g(u) := u + x` is
`float _fn_g(float u, float _in_x) { return u + _in_x; }` and
`_fn_g(1.0, x)`; `h(3)` with `h(x) := g(x) · y` is
`float _fn_h(float x, float _in_x, float _in_y) { return _in_y * _fn_g(x, _in_x); }`
and `_fn_h(3.0, x, y)`. Differences from the brief of the task:

- The parameter name is `_in_` and the name, with a suffix `_2`, `_3` when
  a symbol reachable from the function's literal (`reachableSymbolNames()`)
  or a parameter has that name. It is not taken from `registryLocalName()`,
  whose names depend on the names of the root expression, so the text of a
  function would differ between two compilations.
- Under a binder of the same name, a call in the code passes a temporary
  declared at the start of the code (`float _tv2 = x;`), for every binder,
  also an unrolled `Sum` whose code declares no `x`. In
  `compileFunction()`, any binder at all makes a declared parameter go
  through the temporary (the test compares the set of bound names with the
  one of the root). Both are sound and add one temporary.
- A `vars` source of a passed name that is not a read of a variable
  (`next()`) declines: as an argument it would run once per call, not once
  per read. A name of the option that has a value with no `vars` entry (it
  is written as its value) or that the target spells as a constant stays as
  without the option.
- `compileShader()` does not take the option. `compile()` and
  `canCompile()` of `compile-expression.ts` forward it. The two declines are
  found only while the code is written, so `canCompile()` with a non-empty
  option writes the code, drops it, and answers either decline (review
  finding).
- What can be at file scope and read an input: the ordinary definitions, the
  complex copies, the call-shape specializations, the invariant-prefix
  variants and the variants that read a list input (`f#bind…`) go through
  the `define` hook and follow the rule; the element-wise wrapper follows it;
  the shared calls of `gpu-shared-calls.ts`, the calls written in place
  (reserved parameter names, list-valued calls, point calls, applied
  derivatives) and a stored value are written into the code that reads them,
  so their reads are reads of that code (a stored value read in a function
  body reads the parameter); a function literal, and so a block local
  function, is outside the GLSL fragment; the pass counter and the `_gpu_*`
  helpers read no input; the multi-clause dispatch and the declared union
  dispatch are emitted on JavaScript only.

**M7, acceptance run by `tycho-desk`** (2026-11-13, archive of
`9fb18f1b0a2d1d08086fc08f09a80770f36992ff` plus M7; M7 is on main as
`56b680347ae5dbeaf162451149cdf4a52d4e12f3`). No engine defect found.

- Option absent: codegen audit unchanged against the macro build, 1,295
  records, 0 differences in the text of code and preamble.
- Function threading off, `callerLocals: ['t', 'x', 'y', 'z']` on every GLSL
  compile with no `vars`, value rows as macros: the direct programs give the
  expected values and the text of section 5c (`k(1) + y`, `h(3)`,
  `\sum_{x=1}^{3} (x + k(1))` = 39 with the statement form, a macro that
  reaches an axis through a function). Codegen audit against the same build
  with no switch: 0 new declines, 11 records with changed code, 908
  unchanged; 376 records only off and 291 only on are the same rows with
  another input text, and their values were not compared record by record.
  One GLSL record of the corpus has an `_in_` parameter
  (`neyret/iiypd8tktp`): Tycho's inliner removes most calls before the GLSL
  compile.
- Tycho's tests: 72 more fail with both switches (27 from threading off, 45
  from the macros), 1 is fixed. 47 are tests of the mechanism being
  removed; about 25 were not all read, and at least two are the raw-body
  lowering case. No failure that was traced is an engine fault.
- A defect in Tycho appears with threading off: its structural inliner of
  function bodies writes `v + x` into `\sum_{x=1}^{3} (x + k(1))`, where the
  index captures `x` (15 where the value is 39). It must rename the binder
  or keep the call.
- A helper with two texts in Tycho's two shader lanes: not found in the
  audit corpus; whether the audit compiles the colour lane of every
  document was not confirmed.
- Line counts in `document-ce-manager.ts`. Deleted now: 0. Dead once Tycho
  adopts a release with M7 and fixes that inliner: the function half of the
  threading, 202 lines, plus the ambient-parameter fields and their
  transport (not measured). Needs Tycho's lowering of raw bodies first: the
  rest of the threading, 1,109 lines, and the publication of value rows as
  lambdas, 140 lines. Stays: as in the second report.
